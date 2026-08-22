import { useEffect, useState, type ReactNode } from "react";
import type {
  RatingState,
  RunFeedback,
  RunOutcome,
  RunPhase as SessionPhase,
  RunStatus,
  StopReasonCode,
} from "@mcp-token-footprint/shared";
import {
  RUN_FEEDBACK_KEY_CORRECTED_OUTPUT,
  RUN_FEEDBACK_KEY_VERDICT,
} from "@mcp-token-footprint/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@elabs-ai/components-ui";
import { Clock, Lock, LogOut, MoreHorizontal, Square, TestTube2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError, endRun, listRunFeedback } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDuration } from "../../lib/format";
import {
  deriveRunStatusView,
  deriveStatusView,
  isReviewPending,
  REVIEWING_STATUS_VIEW,
  type StatusView,
} from "../../lib/status";
import { CorrectedOutputControl, FeedbackControl } from "./FeedbackControl";
import { PromoteToTestDialog } from "../watch/PromoteToTestDialog";
import { notifyError } from "../../lib/notify";

/**
 * The run toolbar — ONE row, no more (header redesign 2026-07-11). The console header exists for
 * exactly two things: instant orientation (what state is this run in, in which harness) and the
 * one control that has no other home (Stop while live; Replay + Export in replay). Everything
 * else was a duplicate and has moved to its single home:
 * - run identity (test · model) → the app breadcrumb (`Runs / <test> · <model>`), which is also
 *   the way back to the runs list (the old Back button + title text were redundant with it);
 * - turns / tokens / spend / caps → the right-pane KPI rail + context chart (the old guardrail
 *   meter row restated them); a tripped guardrail still announces itself via the status badge
 *   ("Stopped (guardrail)") and the terminal toast that names the cap;
 * - "Analyze this run" → the Assistant dock owns run analysis; no header button.
 *
 * Layout: [StatusBadge (+elapsed)] [Locked chip, replay only] [env · provider · model · mode,
 * truncating] ····· [Stop | Replay + Export]. Pure presentation — `RunConsole` owns the stream
 * and the actual stop call.
 */

export type RunBarMode = "automated" | "interactive";

/** Resolved, frozen run identity shown as the toolbar's context line. */
export type RunIdentity = {
  testName: string;
  scenarioName: string;
  model: string;
  mode: RunBarMode;
};

/** Which guardrail tripped a `stopped_guardrail` outcome, when we can attribute it. */
export type TrippedMeter = "turns" | "tokens" | "spend" | null;

/** The display-level run phase derived from the raw status/outcome contract. */
export type RunPhase =
  | "pending"
  | "running"
  | "completed"
  // Unified Sessions (WP3.1, D-US2) — the operator deliberately ended an interactive session
  // (`status`/`outcome` "ended", `stopReasonCode` "session_ended"). Its OWN clean-terminal phase,
  // distinct from `completed` (WP1.1 stubbed this onto `completed`; WP3.1 gives it the locked
  // table's own "Ended" label/tone — still green, but never conflated with a normal finish).
  | "ended"
  | "assertions_failed"
  | "stopped_guardrail"
  | "context_overflow"
  | "error"
  | "stopped";

export type RunBarView = {
  phase: RunPhase;
  /** True while the run can still be stopped (Stop is enabled). */
  isLive: boolean;
  trippedMeter: TrippedMeter;
  /**
   * Unified Sessions (WP3.1) — the label+tone the badge actually renders, computed via the ONE locked-
   * table derivation (`lib/status.ts` `deriveRunStatusView`) from the SAME status/outcome/stopReasonCode
   * this view was built from. Additive: existing readers of `phase`/`isLive`/`trippedMeter` (toasts,
   * guardrail-meter highlighting) are unaffected.
   */
  statusView: StatusView;
};

/**
 * Map the raw run contract (`RunStatus` + optional `RunOutcome` + `stopReason`/`stopReasonCode`) onto
 * the display phase the bar renders. Terminal outcomes win; while running we show `running`; before
 * the first event we show `pending`. `aborted`/`stopped` both render as a neutral "Stopped" phase (the
 * BADGE itself — `statusView` — still distinguishes them per the locked table: "Stopped by you" vs the
 * specific guardrail/expiry/rejection label).
 *
 * `stopReason` is the free-form human text (kept for callers that only have that, e.g. toast copy);
 * `stopReasonCode` is the machine-readable partner (Unified Sessions WP1.1) — when a caller has it,
 * `trippedMeter`/`statusView` read it instead of sniffing the free-form string. Optional/additive: a
 * caller that hasn't been updated to thread `stopReasonCode` through yet (the live SSE console, until
 * WP3.2/3.3) still renders a correct, if coarser, phase + badge.
 *
 * `livePhase`/`queuePosition` (Unified Sessions WP3.3, D-US1) are the run's LIVE orthogonal lifecycle
 * phase (from `use-run-stream`'s folded `{type:"phase"}` events) — when supplied, `statusView` renders
 * the locked table's "Queued — position N" / "Waiting for you" / "Stopping…" overlays via
 * `deriveRunStatusView`. Optional/additive: a caller without them (or a terminal run, where they're
 * moot) still renders the exact same terminal chip as before.
 */
export function deriveRunBarView(
  status: RunStatus | null,
  outcome: RunOutcome | undefined,
  stopReason: string | undefined,
  stopReasonCode?: StopReasonCode,
  livePhase?: SessionPhase | null,
  queuePosition?: number | null,
): RunBarView {
  const statusView = deriveRunStatusView({
    status: status ?? "pending",
    outcome,
    stopReasonCode,
    phase: livePhase,
    queuePosition,
  });

  if (outcome) {
    switch (outcome) {
      case "completed":
        return { phase: "completed", isLive: false, trippedMeter: null, statusView };
      // Unified Sessions (WP3.1, D-US2) — the operator ended an interactive session cleanly. Its own
      // phase (see the `RunPhase` doc above); the badge's actual label/tone comes from `statusView`.
      case "ended":
        return { phase: "ended", isLive: false, trippedMeter: null, statusView };
      // Owner decision 2026-07-03 (WP 5.1 follow-up): a completed run whose skill-gate assertions
      // failed. The run finished cleanly, so it stays a terminal, non-live phase.
      case "assertions_failed":
        return { phase: "assertions_failed", isLive: false, trippedMeter: null, statusView };
      case "stopped_guardrail":
        return {
          phase: "stopped_guardrail",
          isLive: false,
          trippedMeter: guardrailFromStopReasonCode(stopReasonCode),
          statusView,
        };
      case "context_overflow":
        return { phase: "context_overflow", isLive: false, trippedMeter: null, statusView };
      case "error":
        return { phase: "error", isLive: false, trippedMeter: null, statusView };
      case "aborted":
        return { phase: "stopped", isLive: false, trippedMeter: null, statusView };
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  }

  switch (status) {
    case null:
    case "pending":
      return { phase: "pending", isLive: true, trippedMeter: null, statusView };
    case "running":
      return { phase: "running", isLive: true, trippedMeter: null, statusView };
    case "completed":
      return { phase: "completed", isLive: false, trippedMeter: null, statusView };
    // Unified Sessions (WP3.1, D-US2) — the `ended` terminal status. See the `RunPhase` doc above.
    case "ended":
      return { phase: "ended", isLive: false, trippedMeter: null, statusView };
    case "stopped":
    case "aborted":
      return { phase: "stopped", isLive: false, trippedMeter: null, statusView };
    case "error":
      return { phase: "error", isLive: false, trippedMeter: null, statusView };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Unified Sessions (WP3.1) — which guardrail tripped a `stopped_guardrail` outcome, read from the
 * MACHINE-READABLE `stopReasonCode` (closed union). Retires the old `guardrailFromReason` free-text
 * keyword sniff (`.includes("turn")` etc., which could mis-fire on a human-authored stopReason that
 * happened to contain one of those substrings) — this is an exhaustive, typo-proof switch instead.
 * `undefined` (a caller without the code yet) yields `null`, same as the old function's "no match".
 */
function guardrailFromStopReasonCode(code: StopReasonCode | undefined): TrippedMeter {
  switch (code) {
    case "max_turns":
      return "turns";
    case "max_tokens":
    case "max_context_tokens":
      return "tokens";
    case "max_cost":
      return "spend";
    default:
      return null;
  }
}

/** Map a display phase onto the `@elabs-ai/components-ui` `StatusBadge` closed status enum — still used by the
 *  legacy `runStatusBadgeStatus`/`runStatusBadgeView` bridge for surfaces this WP doesn't own (they
 *  render via `@elabs-ai/components-ui`'s own `StatusBadge`, not the app-local one `RunBar`'s own badge now uses). */
function phaseStatus(phase: RunPhase): "pending" | "running" | "complete" | "failed" | "denied" {
  switch (phase) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
    // An ended session is a clean, non-alarming terminal — same "complete" (green) bucket as a normal
    // finish in this coarse 5-value enum; its own wording ("Ended") lives in `statusView`/`deriveRunStatusView`.
    case "ended":
      return "complete";
    case "error":
    case "context_overflow":
    // A failed skill-gate assertion is a failure-ish terminal — same `failed` badge as error/overflow.
    case "assertions_failed":
      return "failed";
    case "stopped_guardrail":
    case "stopped":
      return "denied";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/**
 * Map a raw run status (+ optional outcome) onto the `@elabs-ai/components-ui` closed-enum `StatusBadge`/`StatusIcon`
 * status — the COARSE 5-value bucket a few surfaces genuinely need on purpose: the Runs-table
 * `statusFacet` (a closed filter value space this WP doesn't own, `runs-table-model.ts`
 * `STATUS_FACETS`), the suite-rollup aggregate (`TestGroupRow`/`SuiteTableRows`' "· N error" count and
 * `suiteStatusBadge` — a coarser aggregate BY DESIGN, WP3.R), and a decorative status dot
 * (`CompareBar`'s `StatusIcon`, aria-hidden). Every surface rendering a run's OWN status as a visible
 * label/chip should use {@link runStatusBadgeView} instead (the full locked-table view, D-US5).
 * `ratingState` is optional so the coarse bucket stays review-aware ("Reviewing…" reads as the
 * `running` bucket) wherever a caller has it, without forcing every 2-arg call site to change.
 */
export function runStatusBadgeStatus(
  status: RunStatus,
  outcome: RunOutcome | undefined,
  ratingState?: RatingState | null,
): "pending" | "running" | "complete" | "failed" | "denied" {
  const view = deriveRunBarView(status, outcome, undefined);
  if (!view.isLive && isReviewInFlight(ratingState)) return "running";
  return phaseStatus(view.phase);
}

/**
 * The GENERIC-vocabulary label for a run's terminal state (`deriveStatusView`, blind to
 * `stopReasonCode`/`phase`) — e.g. `stopped_guardrail` always reads "Stopped (guardrail)", never the
 * locked table's specific "Expired"/"Stopped — time limit"/etc. WP3.fix (D-US5) moved every run-status
 * CHIP surface off this and onto {@link runStatusBadgeView} (the precise locked-table label); kept as
 * a plain, still-correct standalone helper for any caller that only has `status`/`outcome`.
 */
export function runOutcomeLabel(status: RunStatus, outcome: RunOutcome | undefined): string {
  // Route through the shared S3 vocabulary (WP 1.1) so no raw snake_case leaks to the UI:
  // stopped_guardrail → "Stopped (guardrail)", assertions_failed → "Assertions failed", etc.
  return deriveStatusView(outcome ?? status).label;
}

// ── Auto-Rating (AR11) — the "Reviewing…" presentation over the terminal status ─────────────────

/**
 * True while a post-run review is still in flight (`pending` — queued, or `rating` — the judges are
 * running). The three SETTLED states end the review: `rated` is done, `skipped` behaves like settled,
 * and `failed` deliberately does NOT turn the run red — the run's own terminal chip stays as-is and
 * the Report tab surfaces the rating failure. `undefined`/`null` (a pre-Auto-Rating payload, or no
 * rating event yet) reads as settled so older data renders exactly as before.
 *
 * Unified Sessions (WP3.1) — the underlying predicate now lives in `lib/status.ts` (`isReviewPending`,
 * the ONE derivation's own review-overlay check); this re-exports it under its original name so every
 * existing importer (`ReportTab`, `TestGroupRow`, `SuiteRunConsole`, …) keeps working unchanged.
 */
export function isReviewInFlight(ratingState: RatingState | null | undefined): boolean {
  return isReviewPending(ratingState);
}

/** The one status+label pair the suite-ROLLUP aggregate renders while its post-run review is in
 *  flight (`TestGroupRow`/`SuiteRunConsole`'s `suiteStatusBadge` — the coarser aggregate, WP3.R
 *  excludes it from the D-US5 sweep). A run's OWN status chip reads {@link REVIEWING_STATUS_VIEW}
 *  (`lib/status.ts`) via {@link runStatusBadgeView} instead. */
export const REVIEWING_BADGE = { status: "running", label: "Reviewing…" } as const;

/**
 * WP3.fix (D-US5 conformance sweep) — the bridge every "render a run's OWN status as a chip" surface
 * routes through: assembles the {@link RunStatusInput} the LOCKED table (`lib/status.ts`
 * `deriveRunStatusView`, execution-plan.md §1) needs from the same positional facets this module's
 * callers already have (`status`/`outcome`/`ratingState`, now ALSO `stopReasonCode`/`phase` — both
 * optional so every pre-existing 2–3-arg call site keeps compiling and rendering exactly as before,
 * just with the label/tone corrected wherever the richer facets are available). Returns the full
 * {@link StatusView} (label + tone + spinner/dashed) — render it via the app-local `StatusBadge`'s
 * `view` prop (`components/StatusBadge.tsx`), NEVER `@elabs-ai/components-ui`'s own closed 7-state `StatusBadge`
 * (its enum can't express `stopped_guardrail`'s amber or `aborted`'s gray-outline, see
 * `brand-ui-only.md`). Before this widening, callers built their OWN coarse label via
 * {@link runOutcomeLabel} (the GENERIC vocabulary, blind to `stopReasonCode`/`phase`) — the WP3.R
 * Defect-2 root cause (e.g. `wait_expired` rendered "Stopped (guardrail)" instead of "Expired").
 */
export function runStatusBadgeView(
  status: RunStatus,
  outcome: RunOutcome | undefined,
  ratingState?: RatingState | null,
  stopReasonCode?: StopReasonCode | null,
  phase?: SessionPhase | null,
): StatusView {
  return deriveRunStatusView({ status, outcome, ratingState, stopReasonCode, phase });
}

export type RunBarProps = {
  identity: RunIdentity;
  view: RunBarView;
  /** Wall-clock elapsed milliseconds, shown next to "Running". */
  elapsedMs: number;
  /** True while the stop request is in flight (disables the confirm action). */
  stopping: boolean;
  onStop: () => void;
  /**
   * Unified Sessions (WP3.3) — the run this bar is showing, so the (self-contained) End-session
   * control can POST `/api/runs/:id/end` directly. `null` in the pre-run state (no session exists
   * yet) — End session never renders without one.
   */
  runId: string | null;
  /**
   * Unified Sessions (WP3.3, D-US1) — the server-authored ISO-8601 deadline for the run's CURRENT
   * live phase (the wait budget while `waiting_input`, or an opt-in wall cap while `running`), when
   * one is set. Renders a live countdown (`DeadlineCountdown`) next to the status badge; the client
   * only DISPLAYS this value — the server owns the deadline (no client-authored timer expiry).
   */
  deadlineAt?: string | null;
  /**
   * Unified Sessions (WP3.3, D-US3) — the finished run's active-vs-total wall-clock split
   * (`RunSummary.activeDurationMs`/`totalDurationMs`, fetched once alongside the replay KPI
   * snapshot). `activeMs` excludes `waiting_input` pauses; `totalMs` includes them — the gap between
   * the two is how long the session sat waiting on the operator. Shown only in replay, next to the
   * "Locked" chip; `null`/absent (pre-contract run, or not yet fetched) renders nothing extra.
   */
  durations?: { activeMs: number; totalMs: number } | null;
  /**
   * Replay (findings/09 §2): a finished run is read-only + scrubbable. When `true` the bar drops
   * the destructive Stop button (a finished run can't be stopped) and shows the "Locked" chip plus
   * the `replayAction` controls instead.
   */
  isReplay?: boolean;
  /**
   * The replay control set (findings/09 §2), shown ONLY in replay: the parent (`RunConsole`)
   * supplies the Replay (reset-to-start) button + the Export-session-log control. `undefined` ⇒
   * nothing rendered.
   */
  replayAction?: ReactNode;
  /**
   * A-3 (toolbar-reach WP0.2) — the "Re-run with changes" (fork) launcher, folded into this action
   * cluster next to Replay/Export instead of a standalone chrome row above the console (which held a
   * single button on its own full-width bordered line — what D-TB2 forbids). Supplied by
   * `RunConsoleRoute` (which owns the `ForkDialog` it opens) only for a TERMINAL run; `undefined`
   * everywhere else, so a live/pre-run bar is unchanged.
   */
  reRunAction?: ReactNode;
  /**
   * Auto-Rating (AR11) — true while the TERMINAL run's post-run review is still in flight
   * (`ratingState` pending|rating). The status chip then reads "Reviewing…" (blue + spinner) instead
   * of the terminal label; it flips to the normal terminal chip once the review settles. Ignored
   * while the run is still live (a live run is "Running", never "Reviewing").
   */
  reviewing?: boolean;
};

export function RunBar({
  identity,
  view,
  elapsedMs,
  stopping,
  onStop,
  runId,
  deadlineAt,
  durations,
  isReplay = false,
  replayAction,
  reRunAction,
  reviewing = false,
}: RunBarProps) {
  const showReviewing = reviewing && !view.isLive;
  // Unified Sessions (WP3.1) — the ONE locked-table derivation (`lib/status.ts`), rendered through the
  // app-local `StatusBadge` (no more bypassing it via `@elabs-ai/components-ui`'s own closed-enum StatusBadge here).
  // The "Reviewing…" overlay short-circuits to the same shared constant every other reviewing surface
  // uses; otherwise the label/tone come straight off `view.statusView` (computed in `deriveRunBarView`
  // from the same status/outcome/stopReasonCode), with the live elapsed-time suffix appended for Running.
  const badgeView = showReviewing ? REVIEWING_STATUS_VIEW : view.statusView;
  const badgeLabel =
    (badgeView.kind === "chip" ? badgeView.label : "") +
    (!showReviewing && view.phase === "running" ? ` ${formatElapsed(elapsedMs)}` : "");
  // D-US11 naming pass: interactive container = "session", automated/suite = "run" (labels only —
  // the wire stays `RunBarMode`/"runs" throughout).
  const isInteractive = identity.mode === "interactive";
  const noun = isInteractive ? "session" : "run";
  return (
    // RM-36 WP 2.1 (finding P1-6) — the row WRAPS instead of clipping. Measured at 768×900 the
    // console's content column is 512px wide while this row's non-flexible children (badge · Locked ·
    // durations · the action cluster) need ~890px; the row itself stayed exactly 512px, so the excess
    // was CLIPPED by `app-shell-main`'s `overflow:hidden` — "Re-run with changes" sat at x-right 1120
    // with NO horizontal scroller anywhere in the ancestor chain, i.e. unreachable, not off-screen.
    // Three layout-only changes fix it, and none of them fires while the row fits:
    //   • `flex-wrap` + `min-h-12` (was a fixed `h-12`) — a row that fits is still exactly 48px tall
    //     and pixel-identical; a row that does not now grows a second line instead of clipping.
    //   • the identity `Text` below takes `flex-1` (basis 0) so its long max-content width can never
    //     be what FORCES the wrap — it yields first, exactly as the old `truncate` did.
    //   • the action cluster drops `shrink-0` and wraps INTERNALLY, so it can also degrade on its own
    //     line rather than escaping it (the same recipe upstream `ViewToolbar` documents).
    // Deliberately content-driven, not breakpoint-driven: at 1280px nothing wraps (verified), so the
    // roomy widths are untouched; the row only reflows where it was previously losing controls.
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-4 py-1.5">
      <StatusBadge view={badgeView}>{badgeLabel}</StatusBadge>
      {/* Unified Sessions (WP3.3, D-US1) — the live countdown to the server-authored deadline for the
          current phase (a wait budget while "Waiting for you", or an opt-in wall cap while running).
          Only meaningful while live; a terminal run has no active deadline. */}
      {view.isLive && deadlineAt ? (
        <DeadlineCountdown deadlineAt={deadlineAt} phase={view.statusView} />
      ) : null}
      {/* T6b — a finished run is read-only: ONE "Locked" info chip (with a tooltip explaining the
          jargon). Only in replay — a live run isn't immutable, so it carries no lock.
          `TooltipTrigger` (a Radix button, reset by Tailwind base) hosts the Badge so the trigger
          is genuinely interactive + keyboard-focusable without a hand-rolled tabindex. */}
      {isReplay ? (
        <Tooltip>
          <TooltipTrigger className="inline-flex cursor-default rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Badge variant="outline" className="gap-1 font-normal">
              <Lock aria-hidden className="size-3" />
              Locked
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Finished {noun}s are immutable.</TooltipContent>
        </Tooltip>
      ) : null}
      {/* Unified Sessions (WP3.3, D-US3) — active-vs-total duration, once known (replay only — the
          split is fetched alongside the replay KPI snapshot). `tabular-nums` so the two figures line
          up across rows/renders. */}
      {isReplay && durations ? (
        <Text variant="meta" tone="muted" className="tabular-nums shrink-0">
          Active {formatDuration(durations.activeMs)} of {formatDuration(durations.totalMs)} total
        </Text>
      ) : null}
      {/* The frozen harness context — the ONLY place on this screen that names the environment,
          provider/model, and mode (the test name lives in the breadcrumb). Truncates, never wraps.
          RM-36 WP 2.1: `flex-1` (flex-basis 0) so this line's max-content width is NOT what decides
          where the wrapping row breaks — it grows into whatever space is left and truncates when
          there is none, which is exactly what `min-w-0 truncate` did in the old non-wrapping row. */}
      <Text variant="meta" tone="muted" className="min-w-0 flex-1 truncate">
        {identity.scenarioName} · {identity.model} ·{" "}
        <span className="capitalize">{identity.mode}</span>
      </Text>
      {/* RM-36 WP 2.1 — the action cluster wraps internally and may shrink. It used to be `shrink-0`
          with no wrap, so once its buttons were wider than the row (768px viewport: ~530px of buttons
          in a 480px row) it simply escaped the row's box and was clipped. `justify-end` keeps every
          wrapped line right-aligned, so the cluster still reads as one right-hand group. */}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {/* Observability WP 2.5 (D-OB15) — run-level human feedback: editable live AND in replay
            (that's the point — see the WP design doc), so it sits OUTSIDE the replay/live branch
            below. `runId === null` (the pre-run surface, no session exists yet) shows nothing. */}
        {runId ? <RunFeedbackHeader runId={runId} /> : null}
        {/* A finished run is read-only — no Stop/End; the replay controls sit here instead. A live
            run keeps End session (interactive only) + the destructive Stop. */}
        {isReplay ? (
          replayAction
        ) : (
          <>
            {isInteractive && runId ? (
              <EndSessionControl runId={runId} disabled={!view.isLive} />
            ) : null}
            <StopControl disabled={!view.isLive} stopping={stopping} onStop={onStop} noun={noun} />
          </>
        )}
        {/* A-3 (toolbar-reach WP0.2) — the "Re-run with changes" fork launcher lives here now (next to
            Replay/Export, same class of thing), not on its own chrome row above the console. Present
            only for a terminal run (RunConsoleRoute supplies it); `undefined` renders nothing. */}
        {reRunAction}
        {/* Observability WP4.4 (D-OB21) — the console's "Promote to test" affordance: any TERMINAL
            run, live or replay. `runId === null` (pre-run) never shows it — nothing to promote.
            Self-contained (mirrors EndSessionControl/RunFeedbackHeader) — RunConsole needs no
            change to host it. */}
        {!view.isLive && runId ? <PromoteToTestMenu runId={runId} noun={noun} /> : null}
      </div>
    </header>
  );
}

/**
 * Observability WP 2.5 (D-OB15) — the run-level "Your verdict" thumbs, self-contained (mirrors
 * `EndSessionControl`'s shape): fetches its OWN current value on mount via a best-effort
 * `listRunFeedback` (a cosmetic lookup — like `useServerNames`, a failed/slow fetch just starts the
 * control unset rather than blocking or erroring the header) and owns the write round-trip through
 * `FeedbackControl`. Scoped to the run as a whole (`stepId` omitted) — per-turn feedback lives inline
 * in `ConversationPane`'s `AssistantTurn` rows instead.
 */
function RunFeedbackHeader({ runId }: { runId: string }) {
  const [current, setCurrent] = useState<RunFeedback | undefined>(undefined);
  // RM-17 Phase 6 (AM-OB2) — the run-level `corrected_output` row, fetched by the SAME best-effort
  // call. Its own state, not a second field on the verdict row: clearing a note and clearing a
  // correction are different actions, and the two keys upsert independently server-side.
  const [correction, setCorrection] = useState<RunFeedback | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setCurrent(undefined);
    setCorrection(undefined);
    listRunFeedback(runId)
      .then((rows) => {
        if (!alive) return;
        const runLevel = rows.filter((row) => row.stepId === undefined);
        setCurrent(runLevel.find((row) => row.key === RUN_FEEDBACK_KEY_VERDICT));
        setCorrection(runLevel.find((row) => row.key === RUN_FEEDBACK_KEY_CORRECTED_OUTPUT));
      })
      .catch(() => {
        /* cosmetic lookup — the control simply starts unset, like useServerNames */
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <FeedbackControl runId={runId} current={current} onChange={setCurrent} size="sm" hideLabel />
      <CorrectedOutputControl
        runId={runId}
        current={correction}
        onChange={setCorrection}
        size="sm"
      />
    </div>
  );
}

/**
 * Observability WP4.4 (D-OB21) — the "Promote to test" console affordance: an overflow menu (one
 * item today; room to grow) that opens the collection-picker dialog from `features/watch/`. Fully
 * self-contained — like `EndSessionControl`/`RunFeedbackHeader` above, it owns its own open state
 * so `RunConsole` needs no change to host it.
 */
function PromoteToTestMenu({ runId, noun }: { runId: string; noun: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="ghost" size="icon-sm" label={`More actions for this ${noun}`}>
            <MoreHorizontal aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <TestTube2 aria-hidden />
            <span>Promote to test…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PromoteToTestDialog open={open} onOpenChange={setOpen} runId={runId} />
    </>
  );
}

function StopControl({
  disabled,
  stopping,
  onStop,
  noun,
}: {
  disabled: boolean;
  stopping: boolean;
  onStop: () => void;
  /** D-US11 naming — "session" for an interactive run, "run" otherwise. */
  noun: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={disabled || stopping}>
          <Square aria-hidden />
          <span>Stop</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            The {noun} halts immediately and is recorded as aborted. The transcript and metrics
            captured so far are kept, but the model will not finish its turn.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep going</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" disabled={stopping} onClick={onStop}>
              Stop {noun}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Unified Sessions (WP3.3, D-US2) — the End-session control: interactive sessions only, self-contained
 * (owns its own `POST /api/runs/:id/end` call + confirm dialog, mirroring `StopControl`'s shape) so
 * `RunConsole` needs nothing beyond forwarding `runId`. Interactive sessions end as **Ended**, never a
 * fake `completed`/`aborted` (the server enforces this — see `terminalFor("session_ended")`); a 409
 * (not live / not interactive / already terminal — a race with a natural finish, or a second click)
 * surfaces the SERVER's own reason text in the error toast rather than a generic message.
 */
function EndSessionControl({ runId, disabled }: { runId: string; disabled: boolean }) {
  const [ending, setEnding] = useState(false);

  const handleEnd = async () => {
    setEnding(true);
    try {
      await endRun(runId);
      toast("Ending session…");
    } catch (error) {
      const description =
        error instanceof ApiError && error.status === 409
          ? error.message
          : `${getErrorMessage(error)} Try again.`;
      notifyError("Couldn’t end the session.", { description });
    } finally {
      setEnding(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || ending}>
          <LogOut aria-hidden />
          <span>End session</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End this session?</AlertDialogTitle>
          <AlertDialogDescription>
            The session ends immediately and is recorded as Ended. The transcript and metrics
            captured so far are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep going</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button disabled={ending} onClick={() => void handleEnd()}>
              End session
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Unified Sessions (WP3.3, D-US1) — a LIVE countdown to a server-authored deadline (the wait budget
 * armed while `waiting_input`, or an opt-in wall cap while `running`). The client only RENDERS
 * `deadlineAt` — it recomputes the remaining time from `Date.now()` every second purely for display;
 * it never expires/stops the run itself (the SERVER's own `SessionClock` owns that). `phase` is the
 * already-derived status view (its `label`, e.g. "Waiting for you", picks the countdown's wording) so
 * this stays a pure presentational read, no separate phase-string parsing.
 */
function DeadlineCountdown({ deadlineAt, phase }: { deadlineAt: string; phase: StatusView }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, Date.parse(deadlineAt) - now);
  const label = phase.kind === "chip" && phase.label === "Waiting for you" ? "Expires in" : "Ends in";
  return (
    <Badge variant="outline" className="gap-1 font-normal tabular-nums">
      <Clock aria-hidden className="size-3" />
      {/* mm:ss, floor-clamped at 0 — never a negative number while the terminal event lands. */}
      <span>
        {label} {formatElapsed(remainingMs)}
      </span>
    </Badge>
  );
}

/** mm:ss elapsed, `tabular-nums` friendly. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A self-contained elapsed-time ticker. Returns the elapsed ms since `startedAtMs`, ticking once a
 * second while `running`, and freezing on the last value when the run ends. Kept here so the bar
 * owns its own clock and `RunConsole` stays declarative.
 */
export function useElapsed(startedAtMs: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || startedAtMs === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, startedAtMs]);
  if (startedAtMs === null) return 0;
  return Math.max(0, now - startedAtMs);
}
