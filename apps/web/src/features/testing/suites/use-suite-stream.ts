import { useEffect, useRef, useState } from "react";
import type {
  RatingState,
  SuiteAggregates,
  SuiteCell,
  SuiteRunEvent,
  SuiteRunStatus,
} from "@mcp-token-footprint/shared";
import { isSettledRatingState } from "@mcp-token-footprint/shared";
import { openSuiteRunStream } from "../../../lib/api";

/**
 * The accumulated suite-console state derived from an ordered {@link SuiteRunEvent} stream — the
 * suite-scope analogue of `RunStreamState` in `../use-run-stream.ts`.
 *
 * The suite stream carries three event kinds — matrix `cell` transitions, rolled-up `aggregates`
 * snapshots, and the suite-run `status` lifecycle — so this state is just those three folded in, plus
 * a terminal-only `error`. Cells BUILD UP as they arrive (`status: running` on start, then the child's
 * settled status), keyed so a repeat/replay upserts rather than duplicates; the console overlays them
 * on the suite's test×scenario axes.
 */
export type SuiteStreamState = {
  /** Latest suite-run status, or `null` until the first `status`/`aggregates` event arrives. */
  status: SuiteRunStatus | null;
  /**
   * Auto-Rating (AR11) — the suite-level review axis, folded from `rating` events. `null` until the
   * first rating event; `pending`/`rating` = the post-run suite review is still happening (the
   * console reads "Reviewing…"); `rated`/`failed`/`skipped` = settled. A post-terminal drop leaves
   * it AS-IS (an honest unknown, never an error).
   */
  ratingState: RatingState | null;
  /** Latest rolled-up aggregates snapshot, or `null` until the first `aggregates` event. */
  aggregates: SuiteAggregates | null;
  /** Matrix cells seen so far, keyed by {@link cellKey}. Upserted (never duplicated) on replay. */
  cells: Record<string, SuiteCell>;
  /** Last error — set ONLY on a terminal, settled failure (never mid-stream). */
  error: string | null;
};

const EMPTY_STATE: SuiteStreamState = {
  status: null,
  ratingState: null,
  aggregates: null,
  cells: {},
  error: null,
};

/**
 * The single sentinel a PRE-terminal stream drop sets on `state.error` (a genuine terminal failure
 * carries its own status). Kept as a constant so the reconnect path can recognise + clear exactly this
 * message without clobbering a real error. Mirrors `use-run-stream.ts` `CONNECTION_LOST`.
 */
const CONNECTION_LOST = "Suite run stream connection lost.";

/**
 * Unified Sessions WP2.2 (D-US8) — mirrors `use-run-stream.ts` `WATCHDOG_STALE_MS`: how long the
 * stream may go completely silent while PRE-terminal before the client gives up on the browser's own
 * `onerror`/reconnect and forces one itself.
 *
 * WP2.3 (D-US8 follow-up) closed the ping-parity gap this doc used to describe: the suite stream's
 * server side (`apps/api/src/suites/routes.ts`) now emits a real `{type:"ping"}` `SuiteRunEvent` every
 * 15s (was the old raw `: ping\n\n` SSE comment, invisible to `EventSource.onmessage` — it never
 * reached this hook, so a legitimately-quiet-but-alive suite run — a member run > 45s with no
 * suite-level event — could false-trip this watchdog). `handleMessage` below re-arms on ANY message
 * before the reducer runs, so the ping resets the clock exactly like a real `cell`/`aggregates`/
 * `status`/`rating` event; `reduce()`'s `default` branch leaves state untouched for the ping's
 * unrecognized `type`, and it carries no `seq` (mirrors `RunEvent`'s `ping`) so the dedupe below simply
 * always applies it. One residual asymmetry remains, unchanged by WP2.3 (out of scope — WP2.R judged it
 * a nice-to-have): the suite stream still has no `id:`/`Last-Event-ID` cursor resume, so a forced
 * reconnect here falls back to whatever the manager's bounded buffer (or the persisted snapshot for a
 * finished run) replays on a plain connect. That stays LOSSLESS-enough in practice: `lastSeqRef` below
 * dedupes anything replayed that this client already applied, and the accumulated `cells`/`aggregates`
 * state is never reset by a reconnect (only by a `suiteRunId` change), so a forced reconnect can only
 * ever ADD state, never roll it back — the same class of edge case `use-run-stream.ts`'s own forced
 * reconnect accepts (see its `armWatchdog` doc).
 */
const WATCHDOG_STALE_MS = 45_000;

/**
 * Stable key for one matrix cell — a specific test × scenario × (variant) × repetition. `variantLabel`
 * is folded in so skill-effect suites (WP 5.1) don't collide base + variant cells. The console groups
 * by `${testId}\x00${scenarioId}` to roll a whole (test, scenario) cell's repetitions together.
 */
export function cellKey(
  cell: Pick<SuiteCell, "testId" | "scenarioId" | "variantLabel" | "repetition">,
): string {
  return `${cell.testId}\x00${cell.scenarioId}\x00${cell.variantLabel ?? ""}\x00${cell.repetition}`;
}

/**
 * A terminal {@link SuiteRunStatus} means the suite run has FINISHED. Auto-Rating (AR11): the server
 * emits one of these, keeps the socket open through the post-terminal suite review, and closes only
 * after a settled `rating` event — so the hook, too, closes the `EventSource` only once BOTH have
 * been seen (no auto-reconnect into an endless replay of the persisted snapshot). Non-terminal:
 * `pending`, `running`.
 *
 * The exhaustive `switch` makes this break the typecheck if `SUITE_RUN_STATUSES` ever gains a member,
 * so the set can't silently drift from the contract. Mirrors `apps/api/src/suites/suite-run-manager.ts`
 * `TERMINAL_SUITE_STATUSES` + `use-run-stream.ts` `isTerminalStatus`.
 */
function isTerminalSuiteStatus(status: SuiteRunStatus): boolean {
  switch (status) {
    case "completed":
    case "capped":
    case "stopped":
    case "error":
      return true;
    case "pending":
    case "running":
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Fold one {@link SuiteRunEvent} into the accumulated console state (idempotent — replay-safe). */
function reduce(state: SuiteStreamState, event: SuiteRunEvent): SuiteStreamState {
  switch (event.type) {
    case "cell":
      // Upsert by the stable cell key so a reconnect's replayed buffer can't duplicate a cell — the
      // latest snapshot for a key (running → completed/error) replaces the prior one.
      return { ...state, cells: { ...state.cells, [cellKey(event.cell)]: event.cell } };
    case "aggregates":
      return { ...state, aggregates: event.aggregates };
    case "status":
      return { ...state, status: event.status };
    // Auto-Rating (AR11) — the suite-level review axis, emitted AFTER the terminal `status` (it
    // never touches the suite run's own status). Mirrors `use-run-stream.ts`'s `rating` fold.
    case "rating":
      return { ...state, ratingState: event.state };
    // WP2.3 (D-US8 follow-up) — the SSE keepalive. A pure watchdog-reset no-op: `handleMessage`
    // already re-armed the watchdog before calling `reduce` (see below), so folding it here is
    // explicitly a no-op — cells/aggregates/status/ratingState are untouched. Explicit (rather than
    // falling through to `default`) so the ping's presence in the state machine is documented, not
    // just accidentally safe.
    case "ping":
      return state;
    default:
      return state;
  }
}

/**
 * Subscribe to a suite run's {@link SuiteRunEvent} stream and accumulate it into console state — the
 * suite-scope analogue of `useRunStream`. Pass `null` to subscribe to nothing (state resets to empty).
 *
 * The discipline mirrors `use-run-stream.ts` exactly (loading-states rule):
 *   - `terminalRef` swallows the EXPECTED post-terminal socket close (end-of-run `onerror` is not a
 *     failure) and closes the `EventSource` so there is no reconnect-and-replay loop;
 *   - only a genuine PRE-terminal drop surfaces the `CONNECTION_LOST` banner, cleared once the stream
 *     recovers (the first freshly-applied event after a drop);
 *   - `lastSeqRef` dedupes a reconnect's replayed buffer by the server-stamped monotonic `seq`
 *     (`seq <= lastAppliedSeq` ⇒ already applied), so cells/aggregates aren't re-folded.
 */
export function useSuiteStream(suiteRunId: string | null): SuiteStreamState {
  const [state, setState] = useState<SuiteStreamState>(EMPTY_STATE);
  const activeRef = useRef(false);
  const terminalRef = useRef(false);
  // Auto-Rating (AR11) — the second half of the close gate: the suite stream now stays open through
  // the post-terminal review and closes only after a settled rating event (mirrors the server).
  const ratingSettledRef = useRef(false);
  // Unified Sessions WP2.2 (D-US8): this SAME guard doubles as the belt-and-braces protection
  // against the watchdog's own forced reconnect below replaying already-applied events — mirrors
  // `use-run-stream.ts`'s `lastSeqRef`.
  const lastSeqRef = useRef(-1);
  const droppedRef = useRef(false);

  useEffect(() => {
    setState(EMPTY_STATE);
    terminalRef.current = false;
    ratingSettledRef.current = false;
    lastSeqRef.current = -1;
    droppedRef.current = false;

    if (!suiteRunId) {
      return;
    }

    activeRef.current = true;
    // Forward-declared so the handlers below (defined once) always close/reopen the CURRENT
    // connection — mirrors `use-run-stream.ts`'s `connect()` restructuring exactly.
    let close: () => void = () => {};

    // Unified Sessions WP2.2 (D-US8) — the 45s staleness watchdog (see the `WATCHDOG_STALE_MS` doc
    // above for the suite-stream-specific caveat: it is message-aware, not ping-aware, since the
    // suite SSE route has no real ping event yet). Same debounced-`setTimeout` shape as the run
    // stream's watchdog.
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const armWatchdog = () => {
      clearWatchdog();
      if (terminalRef.current) return; // pre-terminal only — post-terminal silence is expected
      watchdogTimer = setTimeout(() => {
        if (!activeRef.current || terminalRef.current) return;
        // No cell/aggregates/status/rating event arrived for WATCHDOG_STALE_MS: treat the socket as
        // silently dead and force a reconnect, surfacing the SAME "connection lost" banner a real
        // `onerror` drop shows (`SuiteRunConsole.tsx`'s "Live updates interrupted" alert keys off
        // this exact sentinel). Re-arm immediately so a fresh connection that ALSO goes silent keeps
        // retrying every `WATCHDOG_STALE_MS` indefinitely.
        droppedRef.current = true;
        setState((current) =>
          current.error === CONNECTION_LOST ? current : { ...current, error: CONNECTION_LOST },
        );
        close();
        connect();
        armWatchdog();
      }, WATCHDOG_STALE_MS);
    };

    const handleMessage = (event: SuiteRunEvent) => {
      if (!activeRef.current) return;
      // Any message proves the socket is alive: re-arm before anything else, so even a duplicate/
      // replayed message (which the dedupe below drops) still counts.
      armWatchdog();
      // Dedupe by the server-stamped monotonic `seq`: a reconnect replays the bounded buffer from the
      // start, so drop any event we've already applied. Events without a `seq` (the persisted-replay
      // path for a finished run, which never reconnects) are always applied.
      if (typeof event.seq === "number") {
        if (event.seq <= lastSeqRef.current) return; // replayed suffix — already applied
        lastSeqRef.current = event.seq;
      }
      if (droppedRef.current) {
        droppedRef.current = false;
        setState((current) =>
          current.error === CONNECTION_LOST ? { ...current, error: null } : current,
        );
      }
      setState((current) => reduce(current, event));
      // Auto-Rating (AR11) — close only on terminal status AND a settled rating (mirrors the
      // server, which keeps the socket open through the post-terminal suite review and closes
      // after `rated`/`failed`/`skipped`; finished-run replays synthesize that final event).
      if (event.type === "status" && isTerminalSuiteStatus(event.status)) {
        terminalRef.current = true;
        clearWatchdog(); // terminal reached — the watchdog's job is done for this suite run
      }
      if (event.type === "rating" && isSettledRatingState(event.state)) {
        ratingSettledRef.current = true;
      }
      if (terminalRef.current && ratingSettledRef.current) {
        close();
      }
    };

    const handleError = () => {
      if (!activeRef.current) return;
      // A POST-terminal socket close is always benign — the clean end-of-run close after the
      // settled rating, or a drop mid-review (e.g. an API restart): close the source (no reconnect-
      // and-replay), keep `ratingState` AS-IS, and never surface an error. Only a genuine
      // PRE-terminal drop surfaces the "connection lost" banner; the watchdog above stays armed
      // underneath as a backstop in case the browser's own auto-reconnect never recovers.
      if (terminalRef.current) {
        close();
        return;
      }
      droppedRef.current = true;
      setState((current) => (current.error ? current : { ...current, error: CONNECTION_LOST }));
    };

    const connect = () => {
      close = openSuiteRunStream(suiteRunId, handleMessage, handleError);
    };

    connect();
    armWatchdog(); // start the clock immediately — even the FIRST message must land within 45s

    return () => {
      activeRef.current = false;
      clearWatchdog();
      close();
    };
  }, [suiteRunId]);

  return state;
}
