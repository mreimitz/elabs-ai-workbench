import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  AssertionResult,
  GuardrailConfig,
  RunDetail,
  RunEvent,
  RunMode,
  RunStatus,
  RunStep,
  Scenario,
  SessionCapabilities,
  Test,
} from "@mcp-token-footprint/shared";
import { MODEL_CONTEXT_LIMITS } from "@mcp-token-footprint/shared";
import { SearchInput } from "@elabs-ai/components-data";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
} from "lucide-react";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { IconButton } from "../../components/IconButton";
import { getRun, markRunSeen, startRun, stopRun } from "../../lib/api";
import { useMcpAuth } from "../servers/McpAuthProvider";
import { clearServerVerified } from "../servers/oauth-helpers";
import { formatNumber } from "../../lib/format";
import { getErrorMessage } from "../../lib/errors";
import { isTerminalRunStatus } from "../../lib/status";
import { InlineError } from "../../components/InlineError";
import {
  RunBar,
  deriveRunBarView,
  isReviewInFlight,
  useElapsed,
  type RunBarMode,
  type RunIdentity,
  type TrippedMeter,
} from "./RunBar";
import {
  buildTimeline,
  INITIAL_ANNOUNCE_GATE,
  stepAnnounceGate,
  suppressFinishToast,
  useRunStream,
  type AnnounceGate,
  type RunKpis,
  type RunStreamState,
} from "./use-run-stream";
import { ConversationPane } from "./ConversationPane";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { TraceTimeline } from "./TraceTimeline";
// WP 3.5 — the RIGHT monitoring pane (KPI rail + context-window chart).
import { KpiRail } from "./KpiRail";
import { ContextChart } from "./ContextChart";
// WP 3.2 — the turn index in the rail + the cross-representation navigation contract.
import { TurnIndex } from "./TurnIndex";
import type { ConsoleNavRef, ConsoleNavTarget, ConsolePane } from "./console-anchors";
// WP 3.6 — the RIGHT bottom zone: virtualized step/packet log + the packet inspector.
import { StepLog } from "./StepLog";
import { PacketInspector } from "./PacketInspector";
import { dedupeToolSteps } from "./dedupe-tool-steps";
// WP 3.10 — the Console panel: the live, human-readable event-stream narration (DevTools "Console"),
// shown as a sibling tab to the Network step log in the right pane's bottom zone.
import { ConsolePanel } from "./ConsolePanel";
// WP 3.9 — the Application panel: a turn-grouped responses browser (Tree + read-only preview) plus an
// honest Artifacts placeholder, shown as a third tab beside Network/Console in the right pane.
import { ApplicationPanel } from "./ApplicationPanel";
// WP 5.1 — validation-gate assertion results (evaluated from the trace alignment on completion).
import { AssertionResults } from "./AssertionResults";
// WP 1.4 (Benchmarks) — output-quality grades for a finished run (score tiles + judge reasoning).
import { GradePanel } from "./GradePanel";
// Auto-Rating WP 3.1 (AR1/AR6/AR11) — the canonical rating+grading surface: a fourth left-pane tab that
// self-loads the composed RunReport (base rating + expectation grades + assertions + provenance).
import { ReportTab } from "./ReportTab";
// WP 6.3 (#6) — the shared full-width-centered tab shell (D-UX16) for the console's Chat/Trace/Analytics strip.
import { TabPanel, TabPanelContent, type TabPanelTab } from "../../components/TabPanel";
// Observability WP 3.4 — in-run search (the ONE match helper/hook, two data sources) + view lenses.
import { HighlightedSnippet } from "./SearchHighlight";
import { TurnsLens } from "./TurnsLens";
import { useRunSearch } from "./use-run-search";
import type { SearchHit } from "./run-search";
import { notifyError } from "../../lib/notify";

// A-1 (toolbar-reach WP 0.1) — the run console's ONE left-pane view switcher.
// ---------------------------------------------------------------------------
// Chat/Steps/Turns (the former "Console view" ToggleGroup lens) and Trace/Analytics/Report were the
// SAME axis — "how do I want to read this run" — but were split across a `ToggleGroup` and a
// `TabPanel` that both wrote one `leftView` state with DISJOINT value sets, so the segmented control
// mis-reported state in both directions. They are merged into the single `TabPanel` strip below.
//
// This ordered tuple is the ONE source of truth for BOTH the strip's `tabs` and the `?lens=` / nav
// coercion, which is what makes the invariant hold: every value here has a matching
// `TabPanelContent` in the strip, and no code path may set `leftView` to a value outside it (proven
// by `RunConsole.test.tsx`). Order is the visible left-to-right order of the pills.
export const LEFT_VIEW_TABS = [
  { value: "chat", label: "Chat" },
  { value: "steps", label: "Steps" },
  { value: "turns", label: "Turns" },
  // Historical mapping: the "Trace" pill's value is `raw` (findings/09 §2 named the tab `raw`).
  { value: "raw", label: "Trace" },
  { value: "analytics", label: "Analytics" },
  { value: "report", label: "Report" },
] as const;

/** A value the run console's left-pane tab strip actually renders. */
export type LeftView = (typeof LEFT_VIEW_TABS)[number]["value"];

/** The set of strip values, in strip order — the allow-list every `leftView` write must stay within. */
export const LEFT_VIEW_VALUES: readonly LeftView[] = LEFT_VIEW_TABS.map((tab) => tab.value);

/** Type guard: is `value` a value the strip renders? */
export function isLeftView(value: string | null | undefined): value is LeftView {
  return value != null && (LEFT_VIEW_VALUES as readonly string[]).includes(value);
}

/**
 * Coerce a `?lens=` URL param (or any external string) to a value the strip can render. The legacy
 * lens name `conversation` maps to `chat`; any current strip value (`steps`/`turns`/`raw`/`analytics`/
 * `report`) passes through so a deep link restores it; anything else — including `null`/absent/junk —
 * falls back to `chat`. This is the ONLY seam that turns URL/nav input into `leftView`, so it is where
 * the "never land `leftView` off-strip" guarantee is enforced (its return is always a `LeftView`).
 */
export function coerceLeftView(value: string | null | undefined): LeftView {
  if (value === "conversation") return "chat";
  return isLeftView(value) ? value : "chat";
}

/**
 * The left-pane tab a cross-representation nav intent (`navigateTo`) reveals: the Trace pane is the
 * `raw` tab, every other cross-link (turn / insight / error / user step) reveals `chat`. Both are
 * strip values, so `navigateTo` can never land `leftView` off-strip.
 */
export function paneToLeftView(pane: ConsolePane): LeftView {
  return pane === "trace" ? "raw" : "chat";
}

/**
 * The Run console (WP 3.3): the locked two-pane frame + lifecycle. This is the container WP 3.4–3.7
 * fill — the conversation pane (left) and the monitoring inspector (right) land in later WPs, so
 * here they are honest "coming next" placeholders. What IS wired now: the run-bar with live status
 * + guardrail meters + Stop, the pre-run state with the resolved frozen config + launch actions, and
 * the full run-lifecycle mapping (every terminal outcome surfaced via toast + inline, never silent).
 *
 * The console drives one of two targets:
 * - **pre-run** (`runId === null`): show the frozen config; `▷ Run automated` / `💬 Run interactive`
 *   start a run via the existing `startRun` helper, then this same surface streams it.
 * - **existing run** (`runId` set): a run already started elsewhere (a row in `RunsView`) — stream
 *   it live or replay it.
 */

export type RunConsoleTarget =
  | { kind: "prerun"; test: Test; scenario: Scenario }
  | {
      kind: "run";
      runId: string;
      test: Test;
      scenario: Scenario;
      mode: RunMode;
      /**
       * Replay (WP 3.7): open this run READ-ONLY with the step scrubber. `RunsView` sets it for a
       * row whose run is already terminal. It's a hint — the console ALSO falls into replay once the
       * streamed status turns terminal (a run that finishes while open becomes scrubbable), so a
       * finished run is read-only either way.
       */
      replay?: boolean;
    };

export type RunConsoleProps = {
  target: RunConsoleTarget;
  /** Provider label for the model chip (resolved from the credential, falls back to the kind). */
  providerLabel: string;
  /**
   * Unified Sessions WP 3.2 (D-US4) — the run's resolved session capability manifest, resolved by
   * `RunConsoleRoute` from the persisted run (`capabilities_json`) or, for a pre-contract/not-yet-
   * started run, a credential-derived fallback (the ONLY place left in the console that still
   * consults `providerKind`). Drives every kind-aware facet of this console declaratively — the KPI
   * rail's tile list, the context chart/turn-0 baseline gate, the rail Insights panel, and (via
   * `ConversationPane`) live reasoning rendering, the follow-up composer, and the ask-user prompt.
   */
  capabilities: SessionCapabilities;
  /**
   * Route hook: when a run is STARTED from the pre-run surface, the route navigates to
   * `/testing/runs/:runId` (replace) instead of streaming in place — so a refresh reattaches by id
   * and Back returns to the runs list. When provided, `launch` hands the new run id here and does
   * NOT stream locally (the `:runId` route remounts and reattaches via SSE replay). When omitted,
   * the console streams in place (legacy behaviour).
   */
  onRunStarted?: (runId: string) => void;
  /**
   * WP 4.4 (audit §H5) — the lossless drill loop's return leg. Set ONLY when this console was opened
   * from the Compare Workspace's step drawer ("Open in console ↗", which passes the whole compare URL
   * as `?returnTo=`). When present, a persistent "← Back to comparison" pill shows and returns to the
   * exact compare URL (mode + focus preserved); browser Back also restores the workspace. Omitted for
   * every other entry into the console, so the normal console is untouched.
   */
  onBackToCompare?: () => void;
  /**
   * WP 3.1 (Assistant, D-AS8/D-AS16) — a deep-linked turn anchor from `?turn=<index>` (0-based; see
   * `RunConsoleRoute.tsx`). Set ONLY for an existing-run target opened with that query param present.
   * Consumed exactly ONCE, on mount, to reveal the Chat tab and scroll/focus that turn via the same
   * `navigateTo`/`console-anchors.ts` mechanism the turn rail already uses — this is the run console's
   * first URL-level turn deep link (previously the cross-pane nav was in-memory React state only).
   */
  initialTurnIndex?: number;
  /**
   * A-3 (toolbar-reach WP0.2) — the "Re-run with changes" fork launcher, rendered inside `RunBar`'s
   * action cluster (next to Replay/Export). Owned by `RunConsoleRoute` (it opens the `ForkDialog`);
   * this console just forwards it to the bar. Absent for pre-run/live consoles (only a terminal run
   * gets the fork affordance).
   */
  reRunAction?: ReactNode;
};

// UI §2: ~58% conversation / ~42% monitoring. The pane split is persisted by the upstream
// `ResizablePanelGroup` itself (react-resizable-panels) via `autoSaveId` → localStorage.
const SPLIT_AUTOSAVE_ID = "mcp-token-footprint.run-console.split";

export function RunConsole({
  target,
  providerLabel,
  capabilities,
  onRunStarted,
  onBackToCompare,
  initialTurnIndex,
  reRunAction,
}: RunConsoleProps) {
  // Observability WP 3.4 — URL-persisted in-run search + lens state (`?lens=&find=`). Read ONCE at
  // mount (this component remounts fresh per run id — see `RunConsoleRoute`'s `key={consoleKey}` — so
  // a mount-time read is the correct "deep link opens here" seed, mirroring `initialTurnIndex` above).
  const [searchParams, setSearchParams] = useSearchParams();

  // The run id we are streaming. Pre-run starts at null; an existing-run target seeds it.
  const [runId, setRunId] = useState<string | null>(target.kind === "run" ? target.runId : null);
  const [mode, setMode] = useState<RunBarMode>(
    target.kind === "run" ? toBarMode(target.mode) : "automated",
  );
  const [starting, setStarting] = useState<RunMode | null>(null);
  const [stopping, setStopping] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(
    // An existing run's wall-clock start is unknown to the client; elapsed is only meaningful for a
    // run we kicked off here, so seed it null and let the live `running` phase drive the ticker.
    null,
  );

  // Unified Sessions (WP3.3, D-US1) — mark an EXISTING run opened/acknowledged the instant its console
  // mounts, clearing it from the Runs feed's "Needs attention" section on next load. Fires for every
  // entry into an existing run (a feed click, a direct/deep `/testing/runs/:runId` URL, a re-open) —
  // the console is the ONE choke point every path funnels through (`RunConsoleRoute`), so this is the
  // single most robust place to wire it, not the feed's row handlers. Best-effort: a failure here would
  // otherwise surface as a toast for a purely cosmetic bookkeeping call, so it's swallowed quietly (the
  // run's own errors still flow loudly through the stream).
  const openedRunId = target.kind === "run" ? target.runId : null;
  useEffect(() => {
    if (!openedRunId) return;
    void markRunSeen(openedRunId).catch(() => {});
  }, [openedRunId]);

  // Unified Sessions (WP3.3, D-US2) — set the INSTANT the operator clicks Stop, before the request even
  // resolves ("the client knows locally" — the server's own `markUserInitiatedStop` is for a different
  // purpose, cross-session bookkeeping). Read by the lifecycle-announcement effect below to suppress the
  // terminal "Run stopped" toast for a deliberate stop (never for a guardrail/error the operator didn't
  // cause). Reset per run so a stale `true` from a previous run in the same mounted instance can't
  // suppress an UNRELATED later run's legitimate toast.
  const userInitiatedStopRef = useRef(false);
  useEffect(() => {
    userInitiatedStopRef.current = false;
  }, [runId]);

  // Cross-pane selection (WP 3.4): the conversation's tool cards and the right-pane packet log
  // (WP 3.6) highlight the same step. Lifted here so both panes share one source of truth.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  // Task C3 #1 — the active inspector panel (Network / Console / Application), lifted here so the
  // global PacketInspector `Sheet` can be GATED off on the Application tab, which has its OWN in-pane
  // tree + preview surface (avoids two competing detail surfaces fighting over `selectedStepId`).
  const [inspectorTab, setInspectorTab] = useState("network");
  // findings/09 §2 + A-1 (toolbar-reach WP 0.1) — the LEFT-pane view, lifted + controlled here, and
  // the run console's ONE view switcher (Chat · Steps · Turns · Trace · Analytics · Report — see
  // `LEFT_VIEW_TABS`). Chat is the best-effort `ConversationPane` render; Steps/Turns are the former
  // "Console view" lenses; Trace (`raw`) is the verbatim event tree; Analytics + Report round it out.
  // Typed `string` (as before) so the controlled `TabPanel`'s `onValueChange={setLeftView}` stays
  // assignable; the value is nonetheless kept on-strip at every write site (mount coercion +
  // `paneToLeftView`), never widened past `LEFT_VIEW_VALUES`. Seeded from `?lens=` on mount through
  // `coerceLeftView` (legacy `conversation`→`chat`; any strip value restores; junk/absent → `chat`).
  const [leftView, setLeftView] = useState<string>(() => coerceLeftView(searchParams.get("lens")));

  // Observability WP 3.4 — the in-run search query, seeded from `?find=` on mount and written back
  // (debounced) so the URL stays a shareable deep link into this exact search. "chat"/"steps"/"turns"
  // above double as the lens; `?lens=` is written on every `leftView` change (not just these three —
  // reaching Trace/Analytics/Report the normal way is still a valid, just un-lensed, URL state).
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("find") ?? "");
  // Observability WP 3.4 — the StepLog "Filtered only"/"Show all" toggle, lifted here so BOTH StepLog
  // mounts (the right-pane Network tab AND the new left-pane Steps lens) stay in sync. Not URL-persisted
  // (the spec's own `?lens=&find=` contract doesn't include it).
  const [matchFilterMode, setMatchFilterMode] = useState<"filtered" | "all">("filtered");

  // Write `leftView`/`searchQuery` back into the URL. `replace:true` on both so tab switches and
  // keystrokes never spam browser history; the functional updater preserves every OTHER existing
  // param (`returnTo`, `turn`, …) untouched. The search-query write is debounced so a fast typist
  // doesn't fire a `replaceState` per keystroke.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (leftView === "chat") next.delete("lens");
        else next.set("lens", leftView);
        return next;
      },
      { replace: true },
    );
  }, [leftView, setSearchParams]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (searchQuery.trim().length > 0) next.set("find", searchQuery);
          else next.delete("find");
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchQuery, setSearchParams]);

  // WP 3.2 (G9/S20) — cross-representation navigation. A turn in the rail, a context-window column,
  // an Analytics→Errors card, or a Trace row all cross-link to the matching block in the chat (and a
  // Trace row ↔ a chat block both ways). The intent is lifted here: `navigateTo` reveals the target
  // left-pane tab and stamps a nonce'd target the destination pane resolves to a `data-console-anchor`
  // and scrolls to (see `console-anchors.ts`). A ref keeps the nonce monotonic across re-navigations.
  const [navTarget, setNavTarget] = useState<ConsoleNavTarget | null>(null);
  const navSeqRef = useRef(0);
  const navigateTo = useCallback((pane: ConsolePane, ref: ConsoleNavRef) => {
    navSeqRef.current += 1;
    // Reveal the target left-pane tab (Trace → `raw`, everything else → `chat`; both on-strip), then
    // hand the pane a fresh nonce'd target.
    setLeftView(paneToLeftView(pane));
    setNavTarget({ pane, ref, nonce: navSeqRef.current });
  }, []);

  // WP 3.1 (Assistant, D-AS8/D-AS16) — consume a `?turn=` deep link exactly once: reveal Chat and
  // scroll/focus that turn via the SAME `navigateTo` the turn rail uses. Only meaningful for an
  // EXISTING run (a fresh pre-run surface has no turns yet); guarded by a ref so re-renders (nonce
  // bumps, prop identity churn) never re-trigger it.
  const initialTurnConsumedRef = useRef(false);
  useEffect(() => {
    if (initialTurnConsumedRef.current) return;
    if (initialTurnIndex === undefined || target.kind !== "run") return;
    initialTurnConsumedRef.current = true;
    navigateTo("chat", { kind: "turn", turnIndex: initialTurnIndex });
  }, [initialTurnIndex, target, navigateTo]);

  // S1 — stack the monitoring rail under the conversation below 1200px (see the panel group below).
  const stackRail = useMediaQuery("(max-width: 1199.98px)");

  const { ensureAuthenticated } = useMcpAuth();
  const stream = useRunStream(runId);
  // Unified Sessions (WP3.3) — forward the live phase/stopReasonCode the SSE hook now folds so the
  // badge renders the locked table's "Queued — position N" / "Waiting for you" / "Stopping…" overlays
  // (`deriveRunStatusView`, via `deriveRunBarView`). Reads the RAW `stream` (not the as-of-k
  // `viewStream`) — like `status`/`outcome`/`stopReason` above it, the header badge always reflects the
  // run's true CURRENT state, never the scrub position.
  const view = deriveRunBarView(
    stream.status,
    stream.outcome,
    stream.stopReason,
    stream.stopReasonCode,
    stream.phase,
    stream.queuePosition,
  );

  // ── Replay (WP 3.7) ───────────────────────────────────────────────────────────────────────────
  // A run is replayed (read-only + scrubbable) when it's already terminal: either the row opened it
  // with the `replay` hint, OR the streamed status has turned terminal (a run that finishes while
  // open also becomes read-only — never offer Stop / composer-send on a finished run).
  const targetWantsReplay = target.kind === "run" && target.replay === true;
  const streamIsTerminal = stream.status !== null && isTerminalRunStatus(stream.status);
  const isReplay = runId !== null && (targetWantsReplay || streamIsTerminal);

  // Auto-Rating (AR11) — true while the TERMINAL run's post-run review is still in flight
  // (`ratingState` pending|rating, from the `rating` SSE events). Drives the "Reviewing…" status
  // chip, the chat's in-flight review row, the Report-tab-label spinner, and the Report tab's active
  // loading state — all of which settle together on `rated`/`failed`/`skipped`.
  const reviewing = streamIsTerminal && isReviewInFlight(stream.ratingState);

  // The scrubber's as-of step index, defaulting to the LAST step (the run as it ended). `null` until
  // the user moves it, so a still-streaming finished run keeps snapping to the latest step.
  const [asOfStep, setAsOfStep] = useState<number | null>(null);
  // Per-step cumulative KPI snapshots, reconstructed PURELY from the persisted event log (the
  // interleaved `kpi` events carry exact cumulative totals — incl. cost — at each point), keyed by
  // STEP ID (stable; the hook orders steps by `step.index` while the event log is in emission order,
  // so a positional map could drift — an id map can't). Fetched once per finished run; scrubbing then
  // reads it with zero network. Falls back to deriving from the sliced steps if the fetch hasn't
  // landed or failed.
  const [kpiByStepId, setKpiByStepId] = useState<Map<string, RunKpis> | null>(null);
  // WP 5.1 — the run's validation-gate assertion results (present only on a completed run whose test
  // declared assertions). Fetched alongside the replay-KPI snapshot below; null when none/not loaded.
  const [assertionResults, setAssertionResults] = useState<AssertionResult[] | null>(null);
  // A genuine failure of the replay-snapshot fetch is tracked (not swallowed to a bare `null`): the
  // as-of-k KPIs still fall back to the from-steps derivation, but we surface a small retry so a
  // failed load reads as "couldn't load exact snapshots", not "no data". `nonce` drives retry.
  const [kpiSnapshotError, setKpiSnapshotError] = useState<string | null>(null);
  const [kpiRetryNonce, setKpiRetryNonce] = useState(0);
  // Unified Sessions (WP3.3, D-US3) — the finished run's active-vs-total wall-clock split
  // (`RunDetail.activeDurationMs`/`totalDurationMs`), piggybacked on this SAME replay fetch (no extra
  // network call) since `getRun` already returns the full `RunSummary` fields. `null` when either
  // figure is absent (a pre-contract run persisted before this workstream).
  const [durations, setDurations] = useState<{ activeMs: number; totalMs: number } | null>(null);
  useEffect(() => {
    if (!isReplay || runId === null) {
      setKpiByStepId(null);
      setKpiSnapshotError(null);
      setAssertionResults(null);
      setDurations(null);
      return;
    }
    let cancelled = false;
    setKpiSnapshotError(null);
    void getRun(runId)
      .then((detail) => {
        if (!cancelled) {
          setKpiByStepId(withSummaryTotals(kpiSnapshotsByStepId(detail.events), detail));
          // WP 5.1 — surface any validation-gate assertion results on the finished run.
          setAssertionResults(detail.assertionResults ?? null);
          setDurations(
            detail.activeDurationMs != null && detail.totalDurationMs != null
              ? { activeMs: detail.activeDurationMs, totalMs: detail.totalDurationMs }
              : null,
          );
        }
      })
      .catch((error) => {
        // Non-fatal: the as-of-k KPIs fall back to the from-steps derivation below — but record the
        // failure so it isn't indistinguishable from a run that simply has no snapshots.
        if (!cancelled) {
          setKpiByStepId(null);
          setKpiSnapshotError(getErrorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isReplay, runId, kpiRetryNonce]);

  const stepCount = stream.steps.length;
  const lastStepIndex = Math.max(0, stepCount - 1);
  // Clamp the as-of index into the available steps; default = last step (the finished run).
  const asOfIndex = asOfStep === null ? lastStepIndex : Math.min(asOfStep, lastStepIndex);

  // The as-of-k stream: in replay, SLICE the accumulated state to `[0..k]` and reconstruct the KPIs /
  // deltas at k — a PURE function of `stream` + `k` (no network). The existing panes render whatever
  // state they're handed, so this drives the conversation truncation, the chart playhead (its right
  // edge), the Network/Console logs, and the KPI rail — all consistently to step k. Outside replay
  // the panes see the raw live stream unchanged.
  const viewStream = useMemo<RunStreamState>(() => {
    if (!isReplay) return stream;
    return sliceStreamAsOf(stream, asOfIndex, kpiByStepId);
  }, [isReplay, stream, asOfIndex, kpiByStepId]);

  // Task C3 #2 — the Network badge counts LOGICAL steps, not the raw transcript: each tool call emits
  // two `tool_call` rows (engine `:step:` + MCP-sink `:mcp:`) that the Network/Console panels collapse
  // into one, so the badge must count the de-duped list (same transform the StepLog applies) to match
  // what the log actually shows.
  const logicalStepCount = useMemo(
    () => dedupeToolSteps(viewStream.steps).length,
    [viewStream.steps],
  );

  // Observability WP 3.4 — in-run search. The live scan always runs over `viewStream` (so it honors
  // the as-of-k replay slice, S1, exactly like every other pane); the REPLAY-only FTS supplement is
  // additionally queried once the run is terminal. See `use-run-search.ts`/`run-search.ts`.
  const runSearch = useRunSearch({
    query: searchQuery,
    timeline: viewStream.timeline,
    runError: viewStream.error,
    isReplay,
    runId,
    testId: target.test.id,
  });

  // Navigate to the active match — but ONLY in response to an EXPLICIT next()/prev() (the n/p keys or
  // the prev/next buttons), never as a passive side effect of `activeHit` merely becoming non-null
  // (typing a query, new live data streaming in, or — critically — a `?find=` deep link seeding a
  // match on MOUNT while `?lens=` asked for "Steps"/"Turns": that must NOT get yanked back to
  // Conversation just because a match happens to exist). `explicitNavRef` is armed by `handleNext`/
  // `handlePrev` immediately before they call the hook's `next`/`prev`, and consumed (cleared) the
  // first time the resulting `activeHit` change is observed here.
  const explicitNavRef = useRef(false);
  const activeHit = runSearch.activeHit;
  const activeHitId = activeHit?.id ?? null;
  useEffect(() => {
    if (!activeHit || !explicitNavRef.current) return;
    explicitNavRef.current = false;
    if (activeHit.kind === "prompt" && activeHit.stepId) {
      navigateTo("chat", { kind: "user", stepId: activeHit.stepId });
    } else if (activeHit.turnIndex !== null) {
      navigateTo("chat", { kind: "turn", turnIndex: activeHit.turnIndex });
    } else if (activeHit.toolCallId) {
      navigateTo("chat", {
        kind: "tool",
        toolCallId: activeHit.toolCallId,
        ...(activeHit.turnIndex !== null ? { turnIndex: activeHit.turnIndex } : {}),
      });
    }
    if (activeHit.stepId) setSelectedStepId(activeHit.stepId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id string, see comment above
  }, [activeHitId, navigateTo]);

  const handleSearchNext = useCallback(() => {
    explicitNavRef.current = true;
    runSearch.next();
  }, [runSearch]);
  const handleSearchPrev = useCallback(() => {
    explicitNavRef.current = true;
    runSearch.prev();
  }, [runSearch]);

  // Keyboard `n`/`p` cycle the active match — ignored while typing in ANY text field (the search box
  // itself, the composer, …) so the letters type normally there. A ref carries the latest next/prev
  // closures so the listener subscribes ONCE per run rather than churning on every render.
  const searchNavRef = useRef({ next: handleSearchNext, prev: handleSearchPrev });
  searchNavRef.current = { next: handleSearchNext, prev: handleSearchPrev };
  useEffect(() => {
    // A pre-run console (no `runId` yet) never shows the search bar at all — see the render below —
    // so this early-return is defense-in-depth, not load-bearing. (`runId === null` is used directly
    // rather than the `isPreRun` alias, which is declared further down this component.)
    if (runId === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const el = event.target as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable === true;
      if (typing) return;
      if (event.key === "n") {
        event.preventDefault();
        searchNavRef.current.next();
      } else if (event.key === "p") {
        event.preventDefault();
        searchNavRef.current.prev();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runId]);

  // When a live run reaches `running` for the first time, start the elapsed clock.
  useEffect(() => {
    if (stream.status === "running" && startedAtMs === null) {
      setStartedAtMs(Date.now());
    }
  }, [stream.status, startedAtMs]);

  // findings/09 §2 (sheet-bug fix): the replay playhead is DECOUPLED from the shared `selectedStepId`.
  // Previously an effect mirrored the as-of-k step into `selectedStepId`, which is the ONLY thing that
  // opens the right `PacketInspector` Sheet — so scrubbing (and now the single Replay reset) would pop
  // the Sheet uninvited. That mirroring effect is removed: the Sheet now opens ONLY on an explicit
  // click (a tool-card Inspect, a StepLog row, or a Console row). Replay never opens it.

  const elapsedMs = useElapsed(startedAtMs, view.phase === "running");

  const scenario = target.scenario;
  const guardrails = scenario.guardrails;

  // WP 3.5 — the model's context window keys the KPI headline % + the chart's limit line. A provider
  // limit error is ground truth regardless of this seed map (handled API-side); 0 ⇒ "limit unknown".
  const contextLimit = MODEL_CONTEXT_LIMITS[scenario.model] ?? 0;

  // The turn-0 baseline (system + tool defs) is the static footprint the budget starts from. It is
  // computed API-side, so the first streamed step carrying a `context` snapshot is its earliest
  // observable form; surface that snapshot (and its total) as the pre-model baseline for the chart.
  // Always the run's true turn-0 (step 0 is always ≤ any as-of k), so it reads from the full stream.
  const baselineSnapshot = useMemo(
    () => stream.steps.find((step) => step.context != null)?.context ?? null,
    [stream.steps],
  );
  const baselineContextTokens = baselineSnapshot?.total ?? 0;

  // WP 3.5 S1 — ONE current-context-tokens source for BOTH the KPI headline Context % and the chart's
  // utilisation badge (Acceptance: "Context % matches the chart total / limit"). The authoritative
  // value is the latest `ContextSnapshot.total` — the same measured composition the chart plots — so
  // both readouts agree even if the `kpi` event's `contextTokens` momentarily lags the `step.context`
  // snapshot mid-stream. Fall back to the turn-0 baseline before the first live snapshot, then to the
  // `kpi` figure only if no snapshot has arrived at all. Reads `viewStream` so in replay the headline
  // and chart agree on the AS-OF-K total (the latest snapshot at or before step k), not the final.
  const currentContextTokens = useMemo(() => {
    for (let i = viewStream.steps.length - 1; i >= 0; i -= 1) {
      const snapshot = viewStream.steps[i]?.context;
      if (snapshot != null) return snapshot.total;
    }
    return baselineContextTokens || (viewStream.kpis?.contextTokens ?? 0);
  }, [viewStream.steps, viewStream.kpis, baselineContextTokens]);

  const identity: RunIdentity = {
    testName: target.test.name,
    scenarioName: scenario.name,
    model: scenario.model,
    mode,
  };

  // The tripped meter is best-attributed by whichever guardrail is closest to (or over) its cap at
  // the terminal `stopped_guardrail` outcome; fall back to the stop-reason hint from the bar view.
  const trippedMeter = useMemo<TrippedMeter>(() => {
    if (view.phase !== "stopped_guardrail") return null;
    const fromReason = view.trippedMeter;
    if (fromReason) return fromReason;
    return closestTrippedMeter(stream.kpis, guardrails);
  }, [guardrails, stream.kpis, view.phase, view.trippedMeter]);

  const barView = { ...view, trippedMeter };

  // ── Lifecycle announcements (toast + inline). Fire once per terminal phase. ──────────────────
  // Only TOAST a terminal outcome for a run we watched go GENUINELY live this session. Opening a
  // FINISHED run for replay re-streams the whole persisted event log over SSE — INCLUDING its
  // historical `running` status — so `view.isLive` momentarily reads true even though we never
  // watched this run go live; without gating that would fire a stale "Run completed" toast just for
  // opening it (S13 / T6a). `stepAnnounceGate` arms only on a non-replay live phase, so replay stays
  // silent while a genuine live→terminal transition still toasts once. The inline terminal rendering
  // (Alert / ErrorState in the conversation pane) still shows for replay; only the toast is gated.
  const announceGateRef = useRef<AnnounceGate>(INITIAL_ANNOUNCE_GATE);
  // D-US11 naming pass: interactive container = "session", automated/suite = "run" (labels only).
  const nounCap = mode === "interactive" ? "Session" : "Run";
  useEffect(() => {
    const { gate, announce } = stepAnnounceGate(announceGateRef.current, {
      isLive: view.isLive,
      isReplay,
      runId,
      phase: view.phase,
    });
    announceGateRef.current = gate;
    if (!announce) return;
    // Unified Sessions (WP3.3, D-US2) — never toast a "finish" the OPERATOR THEMSELVES caused (a
    // deliberate Stop click). `userInitiatedStopRef` is set locally the instant Stop is clicked, before
    // the request even resolves; End session's own outcome (`ended`) already falls through this
    // switch's `default` untouched, so the guard is exercised only by the Stop → `stopped` path today.
    if (suppressFinishToast(view.phase, userInitiatedStopRef.current)) return;
    switch (view.phase) {
      case "completed":
        toast.success(`${nounCap} completed`);
        break;
      case "assertions_failed":
        notifyError("Couldn’t pass all assertions.", {
          description: `The ${mode === "interactive" ? "session" : "run"} completed, but at least one skill-gate assertion failed. Check Trace for the failing checks.`,
        });
        break;
      case "stopped_guardrail":
        notifyError(`${nounCap} stopped by guardrail`, {
          description: trippedMeter ? `${capitalize(trippedMeter)} cap reached.` : undefined,
        });
        break;
      case "context_overflow":
        notifyError("Context window exceeded", {
          description: "The conversation outgrew the model's context limit.",
        });
        break;
      case "error": {
        const reason = stream.error ?? stream.stopReason;
        notifyError(`Couldn’t complete the ${mode === "interactive" ? "session" : "run"}.`, {
          description: reason ? `${reason} See Trace for details.` : "See Trace for details.",
        });
        break;
      }
      case "stopped":
        toast(`${nounCap} stopped`);
        break;
      default:
        break;
    }
  }, [isReplay, runId, stream.error, stream.stopReason, trippedMeter, view.isLive, view.phase, mode, nounCap]);

  // A pre-terminal stream drop (the hook sets `error` without a terminal status). Surfaced in ONE
  // place — a persistent inline banner below (not a transient toast) — since the drop is contextual
  // to this console and the hook auto-clears it once the `EventSource` reconnects and resumes events.
  const streamDropped = stream.error !== null && view.isLive;

  // Reactive backstop (WP rare path): a run that died mid-flight because an OAuth token expired comes
  // back as a terminal error with `authRequired`. Open the reauth modal (bypassing the preflight
  // throttle, since we KNOW it just failed) so the user can sign in and re-launch. We do NOT auto-
  // restart — a partial run was already streamed/billed. Fires once per run, and never on replay of an
  // old failed run (gated on the announce gate's `armed` flag — true only once this session watched
  // the run go genuinely live, so a replayed historical `error` never re-opens reauth).
  const reauthHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stream.authRequired || view.phase !== "error" || !announceGateRef.current.armed) return;
    const key = runId ?? "?";
    if (reauthHandledRef.current === key) return;
    reauthHandledRef.current = key;
    const ids = scenario.allowedServers.map((s) => s.serverId);
    ids.forEach(clearServerVerified);
    void ensureAuthenticated(ids).then((gate) => {
      if (gate.ok) toast("Reauthenticated — run again to continue.");
    });
  }, [stream.authRequired, view.phase, runId, scenario.allowedServers, ensureAuthenticated]);

  const launch = useCallback(
    async (launchMode: RunMode) => {
      if (starting) return;
      setStarting(launchMode);
      setMode(toBarMode(launchMode));
      try {
        // Proactive (throttled) preflight: make sure every allow-listed OAuth server is authenticated
        // BEFORE we open sessions + spend provider tokens. The gate skips servers verified within the
        // window and opens the reauth modal for any that need it; a cancelled reauth aborts quietly.
        const gate = await ensureAuthenticated(scenario.allowedServers.map((s) => s.serverId));
        if (!gate.ok) return;
        const response = await startRun({
          testId: target.test.id,
          scenarioId: scenario.id,
          mode: launchMode,
        });
        // Route-driven start: hand the id up so the route navigates to `/testing/runs/:runId` and
        // the console remounts there (reattaching via SSE replay). Otherwise stream in place.
        if (onRunStarted) {
          onRunStarted(response.runId);
        } else {
          setStartedAtMs(Date.now());
          setRunId(response.runId);
        }
      } catch (error) {
        notifyError(`Couldn’t start the ${launchMode === "interactive" ? "session" : "run"}.`, {
          description: `${getErrorMessage(error)} Try again.`,
        });
      } finally {
        setStarting(null);
      }
    },
    [
      ensureAuthenticated,
      onRunStarted,
      scenario.allowedServers,
      scenario.id,
      starting,
      target.test.id,
    ],
  );

  const handleStop = useCallback(async () => {
    if (!runId || stopping) return;
    // Unified Sessions (WP3.3, D-US2) — flip the moment the operator clicks, BEFORE the request even
    // resolves: the lifecycle-announcement effect reads this to suppress the terminal "Run stopped"
    // toast for a deliberate stop. Reset on failure — if the stop request itself didn't go through,
    // any eventual terminal (a natural finish, a guardrail) wasn't caused by it and should still toast.
    userInitiatedStopRef.current = true;
    setStopping(true);
    try {
      await stopRun(runId);
      toast(`Stopping ${mode === "interactive" ? "session" : "run"}…`);
    } catch (error) {
      userInitiatedStopRef.current = false;
      notifyError(`Couldn’t stop the ${mode === "interactive" ? "session" : "run"}.`, {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setStopping(false);
    }
  }, [runId, stopping, mode]);

  const isPreRun = runId === null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Run console">
      {/* WP 4.4 (§H5) — the drill-loop return pill: only when opened from the Compare Workspace. It
          returns to the exact compare URL (mode + focus preserved); browser Back does the same. */}
      {onBackToCompare ? (
        <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={onBackToCompare}>
            <ArrowLeft aria-hidden />
            <span>Back to comparison</span>
          </Button>
        </div>
      ) : null}
      <RunBar
        identity={{ ...identity, model: `${providerLabel} · ${scenario.model}` }}
        view={barView}
        elapsedMs={elapsedMs}
        stopping={stopping}
        onStop={() => void handleStop()}
        runId={runId}
        deadlineAt={stream.phaseDeadlineAt}
        durations={durations}
        isReplay={isReplay}
        reviewing={reviewing}
        replayAction={
          isReplay && runId !== null ? (
            <ReplayControls
              runId={runId}
              atStart={asOfStep === null || asOfStep <= 0}
              onReplay={() => setAsOfStep(0)}
            />
          ) : undefined
        }
        {...(reRunAction ? { reRunAction } : {})}
      />

      {/* Observability WP 3.4 — the in-run search + view-lens header. Nothing to search/no lens to
          switch before a run exists. */}
      {isPreRun ? null : (
        <RunSearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          hits={runSearch.hits}
          activeIndex={runSearch.activeIndex}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          ftsLoading={runSearch.ftsLoading}
        />
      )}

      {streamDropped ? (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <InlineError
            title="Run stream connection lost"
            detail={`${stream.error ?? "Reconnecting…"} The console will resume automatically when the connection recovers.`}
          />
        </div>
      ) : null}

      {isReplay && kpiSnapshotError ? (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <InlineError
            title="Couldn’t load exact KPI snapshots"
            detail={`Scrubbed KPIs are approximated from steps. ${kpiSnapshotError}`}
            onRetry={() => setKpiRetryNonce((n) => n + 1)}
          />
        </div>
      ) : null}

      <AdaptivePanelGroup
        autoSaveId={SPLIT_AUTOSAVE_ID}
        className="min-h-0 flex-1"
        // S1 — below 1200px the side-by-side split collapses the monitoring rail to a sliver of
        // cut-off digits, so stack it UNDER the conversation instead (`vertical`). `AdaptivePanelGroup`
        // already forces vertical below its 768px mobile breakpoint; this raises that to 1200px for the
        // console's denser two-pane layout so the rail always reads at full width.
        desktopDirection={stackRail ? "vertical" : "horizontal"}
      >
        <ResizablePanel defaultSize={58} minSize={30} className="min-w-0">
          {isPreRun ? (
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-4 p-4">
                <PreRunPanel
                  test={target.test}
                  scenario={scenario}
                  providerLabel={providerLabel}
                  starting={starting}
                  onLaunch={(m) => void launch(m)}
                />
              </div>
            </ScrollArea>
          ) : (
            // findings/09 §2 + WP 6.3 (#6) — the LEFT pane is Chat / Trace / Analytics on the shared
            // `TabPanel` (full-width centered strip, D-UX16 — the same tab shell every detail page uses).
            // The strip is pinned (never scrolls); each `TabPanelContent scroll={false}` fills `flex-1
            // min-h-0` and lets its child own the scroll — Chat keeps its self-scrolling conversation
            // (ChatShell), Trace its own ScrollArea, Analytics its own inner tabs. Inactive content
            // unmounts (brand `TabsContent` default), but the run STREAM state lives in this parent
            // (`use-run-stream`), so switching tabs never tears down the stream — no streaming regression.
            <TabPanel
              value={leftView}
              onValueChange={setLeftView}
              // A little top breathing room so the centered pills don't jam the pane's top edge; the
              // default `gap-4` is the shared strip→content offset every TabPanel uses.
              className="pt-3"
              // A-1 (toolbar-reach WP 0.1) — the strip is the run console's ONE view switcher; its
              // values ARE `LEFT_VIEW_TABS` (Chat · Steps · Turns · Trace · Analytics · Report), so
              // every value here has a matching `TabPanelContent` below. Steps/Turns were folded in
              // from the deleted "Console view" ToggleGroup. Only the Report label is dynamic: while
              // the post-terminal review is in flight it carries a small spinner (AR11) so the strip
              // itself says "the report is being written" without opening the tab.
              tabs={LEFT_VIEW_TABS.map(
                (entry): TabPanelTab =>
                  entry.value === "report"
                    ? {
                        value: "report",
                        label: reviewing ? (
                          <span className="flex items-center gap-1.5">
                            Report
                            <Loader2
                              aria-hidden
                              className="size-3.5 animate-spin motion-reduce:animate-none"
                            />
                            <span className="sr-only">(rating in progress)</span>
                          </span>
                        ) : (
                          "Report"
                        ),
                      }
                    : { value: entry.value, label: entry.label },
              )}
            >
              {/* Chat: the run conversation owns its own scroll (ChatShell + Conversation stick-to-bottom),
                  so `scroll={false}` — an outer scroll would double-scroll and defeat the sticky composer. */}
              <TabPanelContent value="chat" scroll={false}>
                {/* interface-craft WP 1.2 (finding 7) — the SSE run stream had no live region: streamed
                    turns/tool-calls/status transitions were silent to a screen reader. `role="log"
                    aria-live="polite"` is the same pattern `AgentTranscript.tsx:62-64` already uses for
                    a mission child's transcript — copied here. `h-full min-h-0` passes the definite
                    height straight through from `TabPanelContent`'s body div to `ConversationPane`'s own
                    `h-full` `ChatShell` (see `ConversationPane.tsx:207-209`), so this wrapper adds an
                    accessible boundary without perturbing the scroll/composer layout. Loading/streaming
                    discipline is unchanged: `ConversationPane`/`use-run-stream` still build content up
                    and only surface a TERMINAL, settled error (`TerminalNotice`); this region never
                    announces a mid-stream transient because nothing here changes what renders, only
                    what wraps it. SR announcement itself is NOT exercised by jsdom tests — structural
                    only (`RunConsole.test.tsx` asserts the role/aria-live attributes are present). */}
                <div
                  className="h-full min-h-0"
                  role="log"
                  aria-live="polite"
                  aria-label="Run conversation transcript"
                  data-testid="run-console-transcript-log"
                >
                  <ConversationPane
                    test={target.test}
                    // Read-only replay: force the non-interactive mode so the pane never renders a
                    // (dead, disabled) composer — there's nothing to send into a finished run. The true
                    // mode still shows on the run-bar identity badge.
                    mode={isReplay ? "automated" : mode}
                    runId={runId}
                    stream={viewStream}
                    phase={barView.phase}
                    // Unified Sessions (WP3.3, D-US1) — the RAW live phase (not the as-of-k slice —
                    // composer gating is a live-only concern; replay already forces `mode="automated"`
                    // above, hiding the composer regardless).
                    livePhase={stream.phase}
                    selectedStepId={selectedStepId}
                    onSelectStep={setSelectedStepId}
                    reviewMode={isReplay}
                    // AR11 — a small in-flight "Reviewing & rating run…" row below the last message
                    // while the terminal run's post-run review hasn't settled.
                    reviewing={reviewing}
                    // WP 3.2 — a nonce'd chat-scroll target (from a turn/context-bar/error/trace link).
                    navTarget={navTarget?.pane === "chat" ? navTarget : null}
                    // WP 3.2 — a chat tool card's "View in trace" reveals the Trace tab at that call.
                    onShowInTrace={(ref) => navigateTo("trace", ref)}
                    // Unified Sessions WP 3.2 (D-US4) — drives the reasoning-render seam, the follow-up
                    // composer, and the ask-user prompt declaratively (`liveReasoning`/`followUps`/
                    // `askUser`), replacing the old `providerKind` fork.
                    capabilities={capabilities}
                  />
                </div>
              </TabPanelContent>
              {/* Observability WP 3.4 — the "Steps" lens: the SAME tree StepLog the right-pane Network
                  tab renders, given the left pane's full width for dense scanning. Not a pill in the
                  visible strip above (only reachable via the search bar's lens switcher / `?lens=`) —
                  it owns its own scroll like Trace/Analytics. */}
              <TabPanelContent value="steps" scroll={false}>
                <StepLog
                  steps={viewStream.steps}
                  selectedStepId={selectedStepId}
                  onSelectStep={setSelectedStepId}
                  kpiByStepId={kpiByStepId}
                  costBasis={capabilities.costBasis}
                  highlightQuery={searchQuery}
                  matchFilterMode={matchFilterMode}
                  onMatchFilterModeChange={setMatchFilterMode}
                />
              </TabPanelContent>
              {/* Observability WP 3.4 — the "Turns" lens: per-turn summary cards for fast scanning of a
                  long interactive session (the LangSmith Threads-view idea). */}
              <TabPanelContent value="turns" scroll={false}>
                <TurnsLens
                  runId={runId}
                  timeline={viewStream.timeline}
                  steps={viewStream.steps}
                  onSelectTurn={(turnIndex) => navigateTo("chat", { kind: "turn", turnIndex })}
                  highlightQuery={searchQuery}
                />
              </TabPanelContent>
              {/* Trace: the whole run as a turn-grouped, collapsible event tree (git-branch style) —
                  events in sequence with bottom-up KPI chips and expandable sent/received/args/result
                  leaves. Reads `viewStream` so in replay it truncates as-of-k; the verbatim assistant
                  text is preserved as each turn's "Response" leaf. It owns its own ScrollArea. */}
              <TabPanelContent value="raw" scroll={false}>
                <TraceTimeline
                  stream={viewStream}
                  kpiByStepId={kpiByStepId}
                  // WP 3.2 — a nonce'd trace-scroll target + a trace row's "Show in chat" link.
                  navTarget={navTarget?.pane === "trace" ? navTarget : null}
                  onShowInChat={(ref) => navigateTo("chat", ref)}
                />
              </TabPanelContent>
              {/* Analytics: reads `viewStream`; it owns its own inner tabs + scroll. */}
              <TabPanelContent value="analytics" scroll={false}>
                {/* WP 3.2 — Analytics→Errors cards cross-link to the failing step in Chat AND Trace. */}
                <AnalyticsPanel runId={runId} stream={viewStream} onNavigate={navigateTo} />
              </TabPanelContent>
              {/* Auto-Rating WP 3.1 — the Report tab self-loads the composed RunReport (post-terminal only;
                  gated on `isReplay` — the same finished-run signal the right-rail GradePanel uses). It
                  resolves cited/evidence step idxs against the FULL run steps (`stream.steps`, not the
                  as-of-k slice) and reuses `navigateTo` to reveal them in Chat/Trace. Default `scroll` —
                  the report is a plain vertical card stack, so the tab body owns the scroll. */}
              <TabPanelContent value="report">
                {runId ? (
                  <ReportTab
                    runId={runId}
                    steps={stream.steps}
                    terminal={isReplay}
                    ratingState={stream.ratingState}
                    onNavigate={navigateTo}
                  />
                ) : null}
              </TabPanelContent>
            </TabPanel>
          )}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={42} minSize={25} className="min-w-0">
          {/* The Radix ScrollArea viewport wraps its content in a `display:table; min-width:100%`
              box that AUTO-SIZES to its content's min-content — so a wide child (the Network step
              log, or the 2-up KPI grid) inflates the wrapper past the pane and spills off-screen
              (a `width:100%` can't beat table auto-layout). Force that wrapper to `display:block` so
              it stays at the pane width; the KPI grid + chart reflow in, and any genuinely-wide child
              (the step log) gets its own scroll inside the pane instead of stretching everything. */}
          <ScrollArea className="h-full border-l border-border bg-card [&>[data-radix-scroll-area-viewport]>div]:block!">
            <div className="flex flex-col gap-4 p-4">
              {/* WP 3.5 monitoring pane: live KPI rail + the context-window timeline. Both the KPI
                  headline Context % and the chart's utilisation badge read ONE current-context value
                  (`currentContextTokens`, the latest `step.context` total) so they always agree (S1).
                  The turn-0 baseline card stays above as the pre-run footprint until a snapshot lands. */}
              <KpiRail
                kpis={viewStream.kpis}
                contextLimit={contextLimit}
                guardrails={guardrails}
                currentContextTokens={currentContextTokens}
                capabilities={capabilities}
                // Observability (WP 3.2) — the hotspots strip: jump-links to the slowest/costliest/
                // largest-context-jump step. `kpiByStepId` is the SAME replay-only cumulative snapshot
                // map `StepLog`'s per-step economics chips read below (null while a run is still live —
                // the costliest hotspot simply doesn't render yet, never a stale/zero pick).
                steps={viewStream.steps}
                kpiByStepId={kpiByStepId}
                onSelectStep={setSelectedStepId}
              />
              {/* Unified Sessions WP 3.2 (D-US4) — both context-window surfaces are gated on
                  `capabilities.contextWindow` instead of a `providerKind` check: a backend with no
                  meaningful context window (today `acme_answers` and `claude_subscription`) never gets
                  a turn-0 baseline that can't fulfill its promise, or a chart with nothing real to
                  plot. Every kind that declares `contextWindow:true` renders both, byte-identically. */}
              {isPreRun && capabilities.contextWindow ? (
                <BaselineFootprint scenario={scenario} />
              ) : null}
              {capabilities.contextWindow ? (
                <ContextChart
                  steps={viewStream.steps}
                  contextLimit={contextLimit}
                  baseline={baselineSnapshot}
                  outcome={viewStream.outcome}
                  currentContextTokens={currentContextTokens}
                  // WP 3.2 — the per-turn "jump to turn" strip under the columns scrolls the chat.
                  onSelectTurn={(turnIndex) => navigateTo("chat", { kind: "turn", turnIndex })}
                />
              ) : null}
              {/* WP 3.2 — the turn index: a clickable list of turns w/ per-turn tokens → scroll chat. */}
              {isPreRun ? null : (
                <TurnIndex
                  steps={viewStream.steps}
                  onSelectTurn={(turnIndex) => navigateTo("chat", { kind: "turn", turnIndex })}
                />
              )}
              {/* WP 5.1 — gate assertion results (completed run whose test declared assertions). */}
              {runId && assertionResults && assertionResults.length > 0 ? (
                <AssertionResults results={assertionResults} runId={runId} />
              ) : null}
              {/* WP 1.4 — output-quality grades for a FINISHED run (grades are a post-run artifact, so
                  gate on the replay/terminal state; the panel handles its own load/empty/error). Evidence
                  step links drive the SAME `selectedStepId` the Network log uses (opens the inspector).
                  Auto-Rating WP 3.2 — the panel is now a compact summary that links to the left-pane
                  Report tab via the SAME `leftView` tab-switch mechanic the run-bar/turn-index/etc. use. */}
              {runId && isReplay ? (
                <GradePanel
                  runId={runId}
                  steps={viewStream.steps}
                  onSelectStep={setSelectedStepId}
                  onOpenReport={() => setLeftView("report")}
                />
              ) : null}
              {/* WP 3.6 + 3.10 monitoring bottom zone — a minimal panel switcher (DevTools panel tabs):
                  NETWORK is the structured, virtualized step/packet log (WP 3.6); CONSOLE is the live,
                  human-readable event-stream narration (WP 3.10). Both read the SAME `stream` state and
                  drive the SAME lifted `selectedStepId` — selecting a row in either opens the
                  `PacketInspector` (below) and cross-highlights the matching left tool card (WP 3.4).
                  Each panel virtualizes its own rows within a fixed body height, so it stays smooth at
                  50+ events inside this outer ScrollArea. */}
              {isPreRun ? null : (
                <Card>
                  <CardContent className="pt-6">
                    <Tabs value={inspectorTab} onValueChange={setInspectorTab}>
                      <TabsList>
                        <TabsTrigger value="network">
                          <span className="flex items-center gap-2">
                            Network
                            <Badge
                              variant="secondary"
                              className="tabular-nums font-normal"
                              aria-label={`${logicalStepCount} step${logicalStepCount === 1 ? "" : "s"}`}
                              title={`${logicalStepCount} step${logicalStepCount === 1 ? "" : "s"}`}
                            >
                              {formatNumber(logicalStepCount)}
                            </Badge>
                          </span>
                        </TabsTrigger>
                        <TabsTrigger value="console">Console</TabsTrigger>
                        <TabsTrigger value="application">Application</TabsTrigger>
                      </TabsList>
                      <TabsContent value="network" className="mt-4">
                        <StepLog
                          steps={viewStream.steps}
                          selectedStepId={selectedStepId}
                          onSelectStep={setSelectedStepId}
                          // Observability (WP 3.2) — once any step carries WP3.1's `parentStepId`, the
                          // log renders as a collapsible tree with per-step economics chips, sourced
                          // from the SAME replay-only cumulative snapshot map the KPI rail's hotspots
                          // strip reads above. Both are optional/undefined for a still-live run — the
                          // tree still renders, just duration-only until the snapshot lands.
                          kpiByStepId={kpiByStepId}
                          costBasis={capabilities.costBasis}
                          // Observability (WP 3.4) — the SAME console-header search + filter-to-matches
                          // toggle as the left-pane "Steps" lens (lifted `matchFilterMode` keeps both
                          // StepLog mounts in sync when both happen to be visible at once).
                          highlightQuery={searchQuery}
                          matchFilterMode={matchFilterMode}
                          onMatchFilterModeChange={setMatchFilterMode}
                        />
                      </TabsContent>
                      <TabsContent value="console" className="mt-4">
                        <ConsolePanel
                          steps={viewStream.steps}
                          deltas={viewStream.deltas}
                          status={viewStream.status}
                          outcome={viewStream.outcome}
                          stopReason={viewStream.stopReason}
                          error={viewStream.error}
                          selectedStepId={selectedStepId}
                          onSelectStep={setSelectedStepId}
                        />
                      </TabsContent>
                      <TabsContent value="application" className="mt-4">
                        <ApplicationPanel
                          steps={viewStream.steps}
                          selectedStepId={selectedStepId}
                          onSelectStep={setSelectedStepId}
                          finalText={viewStream.deltas.text}
                          finalReasoning={viewStream.deltas.reasoning}
                        />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>
      </AdaptivePanelGroup>

      {/* WP 3.6 — the packet inspector slides in from the right when a step is selected (from the
          step log OR a left tool card); closing it clears the shared selection.
          Task C3 #1 — SUPPRESSED on the Application tab: that tab owns its OWN in-pane tree + preview
          (SplitPanel + ArtifactPreview), so popping this global Sheet over it would mean two competing
          detail surfaces. Selecting an Application node still drives the shared `selectedStepId` (so the
          in-pane preview fills + the conversation cross-highlights) — it just doesn't open the Sheet.
          Network + Console keep the slide-in Sheet. */}
      <PacketInspector
        selectedStepId={selectedStepId}
        steps={viewStream.steps}
        suppressed={inspectorTab === "application"}
        onClose={() => setSelectedStepId(null)}
      />
    </section>
  );
}

/**
 * The single replay control set (findings/09 §2) — replaces the retired transport scrubber. Sits in
 * the run-bar's right cluster (only in replay):
 * - `Replay` (lucide `RotateCcw`): resets the playhead to step 0 (`setAsOfStep(0)`), then the as-of-k
 *   slicing the parent already does plays the run back from the start (the auto-advance ticker the old
 *   scrubber had is gone — the slider/playhead are retired; this is the single reset affordance). It is
 *   PURE state — it never touches `selectedStepId`, so it never opens the PacketInspector Sheet.
 * - `Export session log` (▾): downloads the finished run as Markdown / JSON via the report endpoints
 *   (`GET /api/reports/run/:id/{markdown,json}`) — plain `<a>` navigation (mirrors `ScansView`); the
 *   server sets `content-disposition: attachment` on the Markdown so it downloads, JSON opens in a tab.
 */
function ReplayControls({
  runId,
  atStart,
  onReplay,
}: {
  runId: string;
  /** True when the playhead is already parked at step 0 (the Replay reset is then a no-op → disabled). */
  atStart: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onReplay} disabled={atStart}>
        <RotateCcw aria-hidden />
        <span>Replay</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Download aria-hidden />
            <span>Export session log</span>
            <ChevronDown aria-hidden className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={`/api/reports/run/${runId}/markdown`}>Markdown</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/reports/run/${runId}/json`} target="_blank" rel="noreferrer">
              JSON
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Observability WP 3.4 — the console-header in-run search row. Purely presentational over
 * `useRunSearch`'s result; every hit/highlight/navigation decision is made upstream
 * (`run-search.ts`/`use-run-search.ts`/`RunConsole`'s navigation effect) — this renders the query
 * box plus the match count + prev/next stepper.
 *
 * A-1 (toolbar-reach WP 0.1) — the "Console view" lens ToggleGroup that used to sit at the right of
 * this row was DELETED: it wrote the same `leftView` as the tab strip below but with a disjoint value
 * set, so it mis-reported state. Chat/Steps/Turns now live in that one `TabPanel` strip. The search
 * field is unchanged.
 */
function RunSearchBar({
  query,
  onQueryChange,
  hits,
  activeIndex,
  onNext,
  onPrev,
  ftsLoading,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  hits: SearchHit[];
  /** -1 when there are no hits. */
  activeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  ftsLoading: boolean;
}) {
  const hasQuery = query.trim().length > 0;
  const activeHit = activeIndex >= 0 ? hits[activeIndex] : undefined;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search this run… (n / p to step through matches)"
          label="Search this run"
          className="max-w-sm"
        />
        {hasQuery ? (
          <>
            <Text
              as="span"
              variant="meta"
              tone="muted"
              className="shrink-0 tabular-nums"
              aria-live="polite"
            >
              {hits.length === 0 ? "No matches" : `${activeIndex + 1} / ${hits.length}`}
              {ftsLoading ? "…" : ""}
            </Text>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={onPrev}
                disabled={hits.length === 0}
                disabledReason="No matches to navigate"
                label="Previous match (p)"
              >
                <ChevronUp aria-hidden className="size-4" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={onNext}
                disabled={hits.length === 0}
                disabledReason="No matches to navigate"
                label="Next match (n)"
              >
                <ChevronDown aria-hidden className="size-4" />
              </IconButton>
            </div>
            {activeHit ? (
              <Text as="span" variant="meta" tone="muted" className="min-w-0 truncate">
                {activeHit.label} · <HighlightedSnippet snippet={activeHit.snippet} />
              </Text>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Pre-run (UI §6): the resolved frozen config + the two launch actions. */
function PreRunPanel({
  test,
  scenario,
  providerLabel,
  starting,
  onLaunch,
}: {
  test: Test;
  scenario: Scenario;
  providerLabel: string;
  starting: RunMode | null;
  onLaunch: (mode: RunMode) => void;
}) {
  const allowedToolsCount = scenario.allowedServers.reduce(
    (sum, server) => sum + (server.allowedTools === null ? 0 : server.allowedTools.length),
    0,
  );
  const hasAllTools = scenario.allowedServers.some((server) => server.allowedTools === null);
  const profiles =
    scenario.defaultProfiles.length > 0 ? scenario.defaultProfiles.join(", ") : "none";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center justify-between gap-2">
              Ready to run
              <Badge variant="outline" className="font-normal">
                not started
              </Badge>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Text variant="meta" tone="muted">
            Confirm the frozen harness, then launch. The config is locked for the duration of the
            run.
          </Text>
          <Descriptions columns={2} layout="horizontal">
            <DescriptionsItem label="Test">{test.name}</DescriptionsItem>
            <DescriptionsItem label="Environment">{scenario.name}</DescriptionsItem>
            <DescriptionsItem label="Provider">{providerLabel}</DescriptionsItem>
            <DescriptionsItem label="Model">{scenario.model}</DescriptionsItem>
            <DescriptionsItem label="Allowed tools" numeric>
              {hasAllTools ? "all" : formatNumber(allowedToolsCount)}
            </DescriptionsItem>
            <DescriptionsItem label="Profiles">{profiles}</DescriptionsItem>
            <DescriptionsItem label="Attachments" numeric>
              {formatNumber(test.attachments.length)}
            </DescriptionsItem>
            <DescriptionsItem label="Guardrails">
              {describeGuardrails(scenario.guardrails)}
            </DescriptionsItem>
          </Descriptions>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onLaunch("automated")} disabled={starting !== null}>
              <Play aria-hidden />
              <span>{starting === "automated" ? "Starting…" : "Run automated"}</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => onLaunch("interactive")}
              disabled={starting !== null}
            >
              <MessageSquare aria-hidden />
              <span>{starting === "interactive" ? "Starting…" : "Run interactive"}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The right-pane turn-0 baseline (UI §6): the static footprint the scenario starts with (system +
 * selected tool defs) before the model runs. The exact figures reuse the scan/token machinery,
 * which is wired in the monitoring WPs (3.5+); until then this shows the composition the budget will
 * start from with a clearly-labelled placeholder — no fabricated run numbers.
 */
function BaselineFootprint({ scenario }: { scenario: Scenario }) {
  const serverCount = scenario.allowedServers.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center justify-between gap-2">
            Turn-0 baseline
            <Badge variant="outline" className="font-normal">
              static
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Text variant="meta" tone="muted">
          The footprint the run starts with — the system prompt plus the selected tool definitions —
          before the model says a word.
        </Text>
        <Descriptions columns={1} layout="horizontal">
          <DescriptionsItem label="System prompt" numeric>
            {scenario.systemPrompt.trim().length > 0
              ? `${formatNumber(scenario.systemPrompt.length)} chars`
              : "empty"}
          </DescriptionsItem>
          <DescriptionsItem label="Servers in scope" numeric>
            {formatNumber(serverCount)}
          </DescriptionsItem>
        </Descriptions>
        <Alert>
          <AlertTitle>Token baseline pending</AlertTitle>
          <AlertDescription>
            The exact turn-0 token cost (system + tool defs, per profile) renders here once the
            monitoring chart lands (WP 3.5). No estimate is shown until it can be computed from the
            scan/token data.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function describeGuardrails(guardrails: GuardrailConfig): string {
  const parts: string[] = [];
  if (guardrails.maxTurns) parts.push(`${formatNumber(guardrails.maxTurns)} turns`);
  if (guardrails.maxTokens) parts.push(`${formatNumber(guardrails.maxTokens)} tokens`);
  if (guardrails.maxCostUsd) parts.push(`$${guardrails.maxCostUsd.toFixed(2)} cap`);
  return parts.length > 0 ? parts.join(" · ") : "none set";
}

/** When the engine doesn't name the tripped guardrail, infer it as the meter closest to its cap. */
function closestTrippedMeter(kpis: RunKpis | null, guardrails: GuardrailConfig): TrippedMeter {
  if (!kpis) return null;
  const ratios: { meter: Exclude<TrippedMeter, null>; ratio: number }[] = [];
  if (guardrails.maxTurns) ratios.push({ meter: "turns", ratio: kpis.turns / guardrails.maxTurns });
  if (guardrails.maxTokens) {
    ratios.push({
      meter: "tokens",
      ratio: (kpis.tokensIn + kpis.tokensOut) / guardrails.maxTokens,
    });
  }
  if (guardrails.maxCostUsd)
    ratios.push({ meter: "spend", ratio: kpis.costUsd / guardrails.maxCostUsd });
  if (ratios.length === 0) return null;
  return ratios.reduce((best, current) => (current.ratio > best.ratio ? current : best)).meter;
}

function toBarMode(mode: RunMode): RunBarMode {
  return mode === "interactive" ? "interactive" : "automated";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A minimal `matchMedia` subscription — true while the query matches. Used to raise the console's
 * pane-stacking breakpoint to 1200px (the shared `AdaptivePanelGroup` only stacks below 768px, which
 * is too narrow for this dense two-pane layout — see S1). SSR-safe (defaults to `false` when
 * `matchMedia` is unavailable, e.g. jsdom) and re-subscribes when the query string changes.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// ── Replay reconstruction (WP 3.7) ───────────────────────────────────────────────────────────────
// All pure: an as-of-k console view is a deterministic function of the run's accumulated steps + k
// (plus the optional persisted `kpi`-by-step-id map for exact cumulative cost). No network per scrub.
// `isTerminalRunStatus` (a finished run is opened read-only + scrubbable) is the shared WP3.fix
// classifier from `lib/status.ts` — see the import above.

/**
 * Coerce a persisted numeric field to a finite number. The replay path rebuilds KPIs from the
 * persisted event log, where the API's secret-redaction over-matches the `*token*` count fields and
 * stores them as the string `"[redacted]"` (see `run-repository.ts`). `Number("[redacted]")` is NaN,
 * which would render literally as "NaN" in the KPI rail — so anything non-finite collapses to 0.
 * Future runs persist real counts (the redaction bug is fixed server-side); this keeps already-
 * persisted runs from showing NaN on replay.
 */
function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Walk the persisted event log and tag every `step` event with the cumulative `kpi` in effect at
 * that point (the rolled-up totals — incl. exact cost — that the engine emitted alongside it). The
 * engine emits `kpi` right AFTER its step, so a step's snapshot is the next `kpi` that follows it;
 * steps that emit no immediate `kpi` (e.g. a bare `tool_call`) inherit the most recent one. Keyed by
 * stable `step.id` so it can't drift from the hook's `index`-ordered step list.
 */
function kpiSnapshotsByStepId(events: RunEvent[]): Map<string, RunKpis> {
  const byId = new Map<string, RunKpis>();
  let running: RunKpis | null = null;
  // Step ids still awaiting the `kpi` that the engine emits right after them.
  let pendingIds: string[] = [];

  for (const event of events) {
    if (event.type === "step") {
      // A step inherits the latest-known cumulative kpi immediately (correct for tool_call steps and
      // a safe lower bound for llm steps until their trailing kpi lands and overwrites it below).
      if (running) byId.set(event.step.id, running);
      pendingIds.push(event.step.id);
    } else if (event.type === "kpi") {
      running = {
        turns: finiteNumber(event.turns),
        toolCalls: finiteNumber(event.toolCalls),
        tokensIn: finiteNumber(event.tokensIn),
        tokensOut: finiteNumber(event.tokensOut),
        contextTokens: finiteNumber(event.contextTokens),
        costUsd: finiteNumber(event.costUsd),
        // Claude subscription (WP 3.1, D-CS4/D-CS8) — carry the cost basis so a replayed/scrubbed run's
        // KPI rail still marks the shadow-priced cost "est. · subscription".
        ...(event.costBasis ? { costBasis: event.costBasis } : {}),
      };
      // This kpi is the post-state of the steps emitted since the previous kpi — stamp them with it.
      for (const id of pendingIds) byId.set(id, running);
      pendingIds = [];
    }
  }
  return byId;
}

/**
 * Stamp the final step's KPI snapshot with the run SUMMARY's cumulative totals. A run's summary
 * (`tokensIn`/`tokensOut`/`turns`/…) always equals its final cumulative KPI and — unlike the per-event
 * replay log — is never redacted. For older runs whose persisted `*token*` counts were redacted to
 * `"[redacted]"` (now fixed at the source in `run-repository.ts`), this recovers the true end-state
 * totals on replay instead of the 0 the redacted events reconstruct to; for clean runs it's a no-op
 * (the values already match). Context stays at the per-step snapshot (`step.context.total`, never
 * redacted) — the summary only carries the PEAK, which isn't the end-state context.
 */
function withSummaryTotals(map: Map<string, RunKpis>, detail: RunDetail): Map<string, RunKpis> {
  if (detail.steps.length === 0) return map;
  const lastStep = detail.steps.reduce((latest, step) =>
    step.index > latest.index ? step : latest,
  );
  const prev = map.get(lastStep.id);
  map.set(lastStep.id, {
    turns: detail.turns,
    toolCalls: detail.toolCalls,
    tokensIn: detail.tokensIn,
    tokensOut: detail.tokensOut,
    contextTokens: prev?.contextTokens ?? detail.peakContextTokens,
    costUsd: detail.costUsd,
    // Claude subscription (WP 3.1, D-CS4/D-CS8) — the run summary now carries `costBasis` (persisted
    // via the v29 data fix); prefer it, falling back to the per-event snapshot's basis. Keeps the
    // final KPI-rail tile's "est. · subscription" marker correct on a replayed subscription run.
    ...(detail.costBasis ?? prev?.costBasis
      ? { costBasis: detail.costBasis ?? prev?.costBasis }
      : {}),
  });
  return map;
}

/**
 * Derive the cumulative KPIs at step k straight from the sliced steps — the fallback used before (or
 * if) the persisted `kpi`-by-id map is available. Turns/tool-calls/tokens/context are EXACT from the
 * step records; cost is the one figure the steps don't carry (it's only on the `kpi` events), so it
 * is left at 0 here and the id-map path supplies the real number.
 */
function deriveKpisFromSteps(steps: RunStep[]): RunKpis {
  let turns = 0;
  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let contextTokens = 0;
  for (const step of steps) {
    if (step.type === "llm_response") turns += 1;
    if (step.type === "tool_call") toolCalls += 1;
    if (step.usageActual) {
      tokensIn += finiteNumber(step.usageActual.inputTokens);
      tokensOut += finiteNumber(step.usageActual.outputTokens);
    }
    if (step.context) contextTokens = finiteNumber(step.context.total);
  }
  return { turns, toolCalls, tokensIn, tokensOut, contextTokens, costUsd: 0 };
}

/**
 * The as-of-k console view: slice the accumulated `stream` to the first `k + 1` steps and rebuild the
 * KPIs/deltas at k. The existing panes render whatever they're given, so this single slice drives the
 * conversation truncation (its tool cards come from the sliced steps), the chart playhead (its right
 * edge = the last sliced column), the Network/Console logs, and the KPI rail — all consistent at k.
 *
 * KPIs prefer the exact persisted snapshot for the k-th step (by id); otherwise they fall back to the
 * from-steps derivation. The in-flight assistant prose (`deltas`) isn't keyed to steps, so it's only
 * surfaced when scrubbed to the LAST step (the run as it ended) and cleared otherwise — truncating to
 * k never shows the final message before its step.
 */
function sliceStreamAsOf(
  stream: RunStreamState,
  k: number,
  kpiByStepId: Map<string, RunKpis> | null,
): RunStreamState {
  const steps = stream.steps.slice(0, k + 1);
  const atEnd = k >= stream.steps.length - 1;
  const lastStep = steps[steps.length - 1];
  const kpis =
    (lastStep && kpiByStepId?.get(lastStep.id)) ??
    (steps.length > 0 ? deriveKpisFromSteps(steps) : null);

  // Final assistant prose/reasoning belongs to the end of the run; only show it at the last step.
  const deltas = atEnd ? stream.deltas : { text: "", reasoning: "" };
  const deltasByTurn = atEnd ? stream.deltasByTurn : {};

  return {
    status: stream.status,
    // The review axis isn't step-keyed — it rides through unchanged at any playhead position.
    ratingState: stream.ratingState,
    ...(stream.outcome !== undefined && atEnd ? { outcome: stream.outcome } : {}),
    ...(stream.stopReason !== undefined && atEnd ? { stopReason: stream.stopReason } : {}),
    // Unified Sessions (WP3.3) — like `outcome`/`stopReason` above, the run's live-phase/terminal-code
    // facets only "exist" once scrubbed to the end; mid-scrub they read as "no distinct phase" (a
    // historical step doesn't have a queue position or a stopping countdown of its own).
    ...(stream.stopReasonCode !== undefined && atEnd ? { stopReasonCode: stream.stopReasonCode } : {}),
    phase: atEnd ? stream.phase : null,
    queuePosition: atEnd ? stream.queuePosition : null,
    phaseDeadlineAt: atEnd ? stream.phaseDeadlineAt : null,
    steps,
    kpis,
    deltas,
    deltasByTurn,
    // A terminal error only "exists" once scrubbed to the end (it ended the run there).
    error: atEnd ? stream.error : null,
    // Replay is a finished run — no open `ask_user` questions (the console gates the form on live anyway).
    questions: [],
    // F7 — keep the derived timeline consistent with the sliced steps/deltas/status (additive). In
    // replay the status is terminal, so the in-flight (deltas) branch is inert; turns reconstruct
    // deterministically from the sliced steps' `turnIndex`.
    timeline: buildTimeline({ steps, deltas, deltasByTurn, status: stream.status }),
  };
}
