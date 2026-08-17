// The single status vocabulary for the whole app (audit §S3, UX-overhaul conventions §3).
//
// One wire value → one {label, tone} decision, so a scan `success`, a run `completed`, a tool-call
// `Complete` and a trace `ok` all render as the SAME green "Completed" chip — never nine renderings
// of one concept. `StatusBadge` (components/StatusBadge.tsx) is the only place this table is
// rendered; nothing else maps a status string to a colour.
//
// The wire unions this covers live in `@mcp-token-footprint/shared` (`RUN_STATUSES`, `RUN_OUTCOMES`,
// `ScanStatus`); this mapping is typed against `string` on purpose so it also absorbs future/unknown
// values SAFELY (see `deriveStatusView` fallback) rather than crashing an adopter.

import type {
  RatingIssueLifecycle,
  RatingState,
  RunOutcome,
  RunPhase,
  RunStatus,
  ScanStatus,
  StopReasonCode,
} from "@mcp-token-footprint/shared";

/**
 * Visual tone buckets. These are semantic (not colours) — the component maps each to `@elabs-ai/components-tokens`
 * utilities so both themes stay correct:
 * - `success` → green outline    - `danger` → red filled       - `warning` → amber outline
 * - `info`    → blue outline+spin - `neutral` → gray outline    - `pending` → gray dashed
 */
export type StatusTone = "success" | "danger" | "warning" | "info" | "neutral" | "pending";

/** A rendered status: either a coloured chip, or (for N/A) plain text with no chip at all. */
export type StatusView =
  | { kind: "chip"; label: string; tone: StatusTone; spinner: boolean; dashed: boolean }
  | { kind: "none"; label: string };

/** All the status strings this app is known to emit — used only to keep the mapping honest in tests. */
export type KnownStatus = RunStatus | RunOutcome | ScanStatus;

function chip(
  label: string,
  tone: StatusTone,
  opts?: { spinner?: boolean; dashed?: boolean },
): StatusView {
  return {
    kind: "chip",
    label,
    tone,
    spinner: opts?.spinner ?? false,
    dashed: opts?.dashed ?? false,
  };
}

/** Turn a raw snake_case/opaque token into a sentence-case label (no raw snake_case ever leaks to UI). */
function humanize(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  if (words.length === 0) return "Unknown";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * The authoritative wire-value → {label, tone} table (UX-overhaul conventions §3), copied exactly.
 *
 * | Wire value(s)                        | Label               | Tone                     |
 * |--------------------------------------|---------------------|--------------------------|
 * | success, completed, complete, ok     | Completed           | green outline            |
 * | failed, error                        | Failed              | red filled               |
 * | aborted                              | Aborted             | gray outline             |
 * | stopped_guardrail                    | Stopped (guardrail) | amber outline            |
 * | running, streaming                   | Running             | blue outline + spinner   |
 * | reviewing                            | Reviewing…          | blue outline + spinner   |
 * | unscanned, pending                   | Pending             | gray dashed              |
 * | N/A (na, none, null, "")             | —                   | plain text, NO chip      |
 *
 * DEFENSIVE: any value NOT in the table returns a neutral gray chip with a humanized label — it never
 * throws and never returns `undefined` (that is what hard-crashed the Runs feed via React #130 when a
 * malformed outcome fell through an exhaustive switch; every adopter of this mapping inherits safety).
 */
export function deriveStatusView(raw: string | null | undefined): StatusView {
  if (raw === null || raw === undefined) return { kind: "none", label: "—" };
  const value = raw.trim().toLowerCase();

  switch (value) {
    case "":
    case "na":
    case "n/a":
    case "none":
      return { kind: "none", label: "—" };

    case "success":
    case "completed":
    case "complete":
    case "ok":
      return chip("Completed", "success");

    case "failed":
    case "error":
      return chip("Failed", "danger");

    case "aborted":
      return chip("Aborted", "neutral");

    case "stopped_guardrail":
      return chip("Stopped (guardrail)", "warning");

    case "running":
    case "streaming":
      return chip("Running", "info", { spinner: true });

    // Auto-Rating (AR11) — a TERMINAL run/suite whose post-run review hasn't settled yet
    // (`ratingState` pending|rating). Same blue+spinner presentation as `running` but its own label,
    // so "the run finished, the review is still happening" never reads as "still executing".
    case "reviewing":
      return chip("Reviewing…", "info", { spinner: true });

    case "unscanned":
    case "pending":
      return chip("Pending", "pending", { dashed: true });

    default:
      // Unknown/malformed/other-known-outcome (e.g. `context_overflow`, `assertions_failed`,
      // `stopped`): a calm neutral chip, sentence-cased. Safe, honest, never a crash.
      return chip(humanize(raw), "neutral");
  }
}

// ====================================================================================================
// Unified Sessions (roadmap/unified-sessions/, WP3.1, D-US5) — the ONE run/session status derivation.
//
// The LOCKED label table (execution-plan.md §1 / README D-US5) is a run/session-specific vocabulary,
// distinct from `deriveStatusView` above (which stays the GENERIC raw-wire-value mapper shared by scans,
// step statuses, and every other non-run surface — its existing behavior/tests are untouched here). A
// run's terminal disposition needs FIVE inputs to render correctly — `status`, `outcome`,
// `stopReasonCode`, `phase`, and the orthogonal Auto-Rating `ratingState` overlay (AR11) — which the
// generic single-string mapper can't express (e.g. it has no way to distinguish `stopped`+`max_turns`
// from `stopped`+`wait_expired`). `deriveRunStatusView` is that ONE derivation; every run/session-status
// surface in this app renders through it (directly, or via a caller that has the richer inputs).
// ====================================================================================================

/**
 * WP3.fix (WP3.R Defect 1) — the ONE terminal-status classifier for a run/session console: a run in
 * one of these `RunStatus` values is FINISHED and opens read-only + scrubbable (replay mode: no live
 * composer, a "Locked" chip, Replay/Export controls) rather than the live shell. Before this fix,
 * `RunConsole.tsx` and `RunConsoleRoute.tsx` each carried an identical private copy of this function
 * that OMITTED `ended` — an operator-ended interactive session (`status: "ended"`) therefore opened
 * in the live shell instead of replay. Exhaustive switch: a future `RunStatus` member breaks the build
 * until classified here (mirrors `apps/api/src/testing/run-manager.ts` `TERMINAL_STATUSES` and
 * `use-run-stream.ts`'s own local `isTerminalStatus`, which already handled `ended` correctly and stays
 * separate — it drives SSE-stream-close semantics, not console replay-mode gating).
 */
export function isTerminalRunStatus(status: RunStatus): boolean {
  switch (status) {
    case "completed":
    case "stopped":
    case "error":
    case "aborted":
    case "ended":
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

/** The ONE derivation's input — mirrors the additive Unified Sessions fields on `RunSummary`/`RunEvent`
 *  (`apps/api/src/testing/session-terminal.ts` `terminalFor()` is the single writer of the
 *  status/outcome/stopReasonCode triple; this is the read-side counterpart). Every field beyond `status`
 *  is optional — a caller that doesn't have the richer facets yet (e.g. the live SSE console before
 *  WP3.2/3.3 thread `phase`/`stopReasonCode` through its reducer) still renders a correct, if coarser,
 *  chip via the same table. */
export type RunStatusInput = {
  status: RunStatus;
  outcome?: RunOutcome | null;
  /** Machine-readable terminal reason (retires `guardrailFromReason` string-sniffing, WP3.1). */
  stopReasonCode?: StopReasonCode | null;
  /** The run's current orthogonal lifecycle phase (queued/starting/waiting_input/stopping), if known. */
  phase?: RunPhase | null;
  /** 1-based queue position, when known — sourced from the live `{type:"phase"}` event's
   *  `detail.position` (not yet persisted on `RunSummary`, so this is `undefined` for a snapshot read). */
  queuePosition?: number | null;
  /** Auto-Rating (AR11) post-run review axis — a TERMINAL run whose review hasn't settled overlays as
   *  "Reviewing…" regardless of its own outcome (a failed review never turns the run red). */
  ratingState?: RatingState | null;
};

/** True while the Auto-Rating (AR11) post-run review is still in flight (`pending`|`rating`). Settled
 *  (`rated`/`failed`/`skipped`) or absent (pre-Auto-Rating payload / no rating event yet) reads settled,
 *  so older data renders exactly as it did before the review axis existed. The canonical predicate —
 *  `RunBar.isReviewInFlight` re-exports this for its existing external consumers. */
export function isReviewPending(ratingState: RatingState | null | undefined): boolean {
  return ratingState === "pending" || ratingState === "rating";
}

/** The chip every TERMINAL run/session shows while its post-run review hasn't settled — ONE constant so
 *  every adopter (the live console badge, a runs-feed cell, …) renders byte-identical "Reviewing…". */
export const REVIEWING_STATUS_VIEW: StatusView = chip("Reviewing…", "info", { spinner: true });

/** `stopReasonCode` → the "Stopped — …" suffix (locked table row: `stopped` + a budget-meter/stall
 *  code). Exhaustively the 7 guardrail-meter codes; every other code is handled by its own table row
 *  (`wait_expired`) or doesn't reach the `stopped` status at all (see
 *  `apps/api/src/testing/session-terminal.ts` `terminalFor()` — the single writer this mirrors). */
const GUARDRAIL_STOP_REASON_SUFFIX: Partial<Record<StopReasonCode, string>> = {
  max_duration: "time limit",
  max_turns: "turn limit",
  max_tokens: "token limit",
  max_context_tokens: "context limit",
  max_cost: "cost limit",
  max_tool_calls: "tool-call limit",
  stalled: "stalled",
};

/**
 * The LOCKED label table (execution-plan.md §1 / README D-US5), rendered EXACTLY: every row is one
 * `if`, in the table's own precedence order — live phase first, then the Auto-Rating overlay (which
 * wins over every other terminal label), then the outcome-specific overrides (`assertions_failed`,
 * `context_overflow`), then the plain terminal statuses. A legacy/pre-contract `stopped` run (no
 * `stopReasonCode` — persisted before this workstream) falls back to the generic wire vocabulary
 * (`deriveStatusView`) so it still renders its historical "Stopped (guardrail)"-style label, never a
 * raw/off-table string.
 */
export function deriveRunStatusView(input: RunStatusInput): StatusView {
  const { status, outcome, stopReasonCode, phase, queuePosition, ratingState } = input;

  // ── Live (non-terminal): pending / running, + their phase overlays ──────────────────────────────
  if (status === "pending") {
    if (phase === "queued") {
      return chip(
        queuePosition != null ? `Queued — position ${queuePosition}` : "Queued",
        "pending",
        { dashed: true },
      );
    }
    // `starting` (permit acquired, spinning up) has no distinct row in the locked table — reads as
    // plain "Pending" until the run flips to `running`.
    return chip("Pending", "pending", { dashed: true });
  }

  if (status === "running") {
    if (phase === "waiting_input") return chip("Waiting for you", "info");
    if (phase === "stopping") return chip("Stopping…", "neutral", { spinner: true });
    return chip("Running", "info", { spinner: true });
  }

  // ── Terminal: completed / ended / stopped / error / aborted ─────────────────────────────────────
  // The Auto-Rating overlay wins over every other terminal label (AR11) — a run finishing as anything
  // (clean, guardrail-stopped, failed, aborted) reads "Reviewing…" while its post-run review is open.
  if (isReviewPending(ratingState)) return REVIEWING_STATUS_VIEW;

  if (outcome === "assertions_failed") return chip("Assertions failed", "warning");
  if (outcome === "context_overflow" || stopReasonCode === "context_overflow") {
    return chip("Context overflow", "warning");
  }

  if (status === "completed") return chip("Completed", "success");
  if (status === "ended") return chip("Ended", "success");

  if (status === "stopped") {
    const guardrailSuffix = stopReasonCode ? GUARDRAIL_STOP_REASON_SUFFIX[stopReasonCode] : undefined;
    if (guardrailSuffix) return chip(`Stopped — ${guardrailSuffix}`, "warning");
    if (stopReasonCode === "wait_expired") return chip("Expired", "neutral");
    // Pre-contract run (no machine-readable code yet) — render its historical wire label rather than
    // a generic "Stopped" (e.g. `stopped_guardrail` → "Stopped (guardrail)").
    return deriveStatusView(outcome ?? status);
  }

  if (status === "error") return chip("Failed", "danger");
  if (status === "aborted") return chip("Stopped by you", "neutral");

  // Exhaustive over every current `RunStatus`; a future additive member still renders safely.
  return deriveStatusView(outcome ?? status);
}

/** Tone for the LEGACY closed `@elabs-ai/components-ui` `StatusBadge` enum (`pending|running|complete|failed|denied|
 *  skipped`) that a few pre-WP3.1 helpers still return (e.g. `suiteStatusBadge`, `runStatusBadgeStatus`
 *  in `RunBar.tsx`) — bridges those call sites onto the app-local `StatusBadge` renderer so even a
 *  surface that can't yet supply the full {@link RunStatusInput} still renders through ONE component. */
export const CLOSED_BADGE_STATUS_TONE: Record<
  "pending" | "running" | "complete" | "failed" | "denied" | "skipped",
  StatusTone
> = {
  pending: "pending",
  running: "info",
  complete: "success",
  failed: "danger",
  denied: "warning",
  skipped: "neutral",
};

// ====================================================================================================
// Fleet issues (roadmap/observability/, WP5.3) — the registry's OWN 3-state lifecycle dimension
// (open/resolved/regressed), a strict superset of the per-run `RatingIssueStatus` (open/resolved)
// `IssuesPanel.tsx` already renders with its own plain-Badge AR6 pattern. `regressed` gets the SAME
// visual weight as a hard failure (red FILLED) — a resolved cluster reappearing is exactly as
// actionable as a fresh one, arguably more so (the fix didn't hold).
// ====================================================================================================

/** Fleet issue lifecycle chip (open=amber outline, regressed=red filled, resolved=green/muted
 *  outline) — mirrors `deriveStatusView`'s {label, tone} shape so it renders through the same
 *  `StatusBadge` component (via its `view` override), never a bespoke chip. */
export function deriveIssueLifecycleView(lifecycle: RatingIssueLifecycle): StatusView {
  switch (lifecycle) {
    case "regressed":
      return chip("Regressed", "danger");
    case "open":
      return chip("Open", "warning");
    case "resolved":
      return chip("Resolved", "success");
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

/** Count-chip tones — same buckets minus the process-only ones. */
export type CountTone = "success" | "danger" | "warning" | "info" | "neutral";

/**
 * VALUE-AWARE count colouring (conventions §3: "a zero renders neutral, never red/green"). A count of
 * 0 is never alarming (the audit's "0 fractures" in red, "0 ok" in green) — zero collapses to neutral
 * regardless of the requested tone; any non-zero count keeps its tone.
 */
export function countChipTone(value: number, tone: CountTone = "neutral"): CountTone {
  return value === 0 ? "neutral" : tone;
}
