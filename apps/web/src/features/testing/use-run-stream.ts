import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnswersStepPayload,
  ContextSnapshot,
  CostBasis,
  RatingState,
  RunEvent,
  RunOutcome,
  RunPhase,
  RunQuestionOption,
  RunStatus,
  RunStep,
  StopReasonCode,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { isSettledRatingState } from "@mcp-token-footprint/shared";
import { openRunStream } from "../../lib/api";

/** Live KPI counters, as last reported by a `kpi` event. */
export type RunKpis = {
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  contextTokens: number;
  costUsd: number;
  /**
   * Claude subscription (WP 3.1, D-CS4/D-CS8) — HOW `costUsd` was derived, folded from the `kpi`
   * event's `costBasis`. `"subscription_reference"` marks a `claude_subscription` run's shadow price
   * (exact tokens × list rate; marginal cost $0) so the KPI rail can label the cost tile
   * "est. · subscription". Absent (or `"api_exact"`) for every ordinary API-metered run.
   */
  costBasis?: CostBasis;
};

/** The streaming-text channels accumulated from `delta` events (the in-flight assistant turn). */
export type RunDeltas = {
  text: string;
  reasoning: string;
};

/**
 * A live, not-yet-answered `ask_user` question (folded from a `question` event, removed on its
 * `question_resolved`). The console renders an answer form for each while the run is live; the answer
 * is POSTed to `POST /api/runs/:id/answers`, which resumes the paused tool call.
 */
export type RunQuestion = {
  questionId: string;
  prompt: string;
  options?: RunQuestionOption[];
  /** Whether a free-text answer is offered (default true — the server sends the resolved value). */
  allowOther: boolean;
};

/** Accumulated console state derived from an ordered `RunEvent` stream. */
export type RunStreamState = {
  /** Latest run status, or `null` until the first `status`/`kpi` event arrives. */
  status: RunStatus | null;
  /** Terminal outcome, once reported on a `status` event. */
  outcome?: RunOutcome;
  /** Why the run stopped, if reported. */
  stopReason?: string;
  /**
   * Unified Sessions (WP3.3, D-US1) — the MACHINE-READABLE terminal reason, mirrored from the
   * terminal `status` event's `stopReasonCode` (WP1.1's contract; WP3.1's `deriveRunStatusView` reads
   * it for the locked label table's "Stopped — time limit" / "Expired" / … rows). Undefined until a
   * terminal status carrying a code arrives; a run that ends with no distinct reason (e.g. a plain
   * `completed`) carries none, matching the wire.
   */
  stopReasonCode?: StopReasonCode;
  /**
   * Unified Sessions (WP3.3, D-US1) — the run's CURRENT orthogonal lifecycle phase, folded from the
   * latest `{type:"phase"}` event. `null` both before the first phase event AND once the server
   * explicitly clears it (`phase: null`, WP1.7 — a resolved wait/spin-up no longer lingers stale).
   * Drives the live "Queued — position N" / "Waiting for you" / "Stopping…" chips via
   * `deriveRunStatusView` (`lib/status.ts`).
   */
  phase: RunPhase | null;
  /** 1-based queue position while `phase === "queued"`, from the phase event's `detail.position`. */
  queuePosition: number | null;
  /**
   * Server-authored ISO-8601 deadline for the CURRENT phase's countdown — the wait budget armed while
   * `waiting_input`, or an opt-in wall cap while `running` (SessionClock, WP1.2). `null` when the
   * current phase carries no deadline. The client only RENDERS this value (`DeadlineCountdown` in
   * `RunBar.tsx`) — the SERVER owns deadline authority, never a client-authored timer.
   */
  phaseDeadlineAt: string | null;
  /**
   * Auto-Rating (AR11) — the post-run review axis, folded from `rating` events. `null` until the
   * first rating event; `pending`/`rating` = the review is still happening (the console reads
   * "Reviewing…"); `rated`/`failed`/`skipped` = settled. A post-terminal stream drop leaves this
   * AS-IS (an honest unknown, never an error) — a refresh re-reads the persisted state.
   */
  ratingState: RatingState | null;
  /** Ordered run steps (llm/tool/etc.), accumulated as `step` events arrive. */
  steps: RunStep[];
  /** Latest KPI snapshot, or `null` until the first `kpi` event. */
  kpis: RunKpis | null;
  /**
   * Streaming text/reasoning accumulated across the WHOLE run (legacy flat channels — kept for the
   * existing panes that read `deltas.text`/`deltas.reasoning`). NOTE: this never resets per turn, so
   * on a multi-turn run it is the concatenation of every turn's prose — use {@link deltasByTurn} for
   * per-turn streaming text.
   */
  deltas: RunDeltas;
  /**
   * Per-turn streaming text/reasoning, keyed by the `delta` event's `turnIndex` (engine-authored). The
   * in-flight (not-yet-settled) turn's live prose is read from here so it isn't conflated with earlier
   * turns' text (which the flat {@link deltas} would be). Empty for runs/events without a `turnIndex`.
   */
  deltasByTurn: Record<number, RunDeltas>;
  /** Last error message surfaced by an `error` event or a stream failure. */
  error: string | null;
  /**
   * Live, not-yet-answered `ask_user` questions (folded from `question`/`question_resolved` events),
   * in ask order. The console renders an answer form for each while the run is live; a reopened/replayed
   * finished run ends with this empty (every question carries its resolution event), so no stale form
   * shows. ADDITIVE — panes that don't consume it are unaffected.
   */
  questions: RunQuestion[];
  /**
   * Sticky-once-true when a terminal `error` event reported that an allow-listed OAuth server needs
   * interactive reauth (token expired mid-run). The console uses it to offer reauth + restart.
   */
  authRequired?: boolean;
  /**
   * F7 — the derived, ordered conversation timeline reconstructed from `steps` (+ the in-flight
   * `deltas` for the not-yet-settled turn). ADDITIVE: `steps`/`deltas`/`kpis`/`status` above are kept
   * exactly as-is for the existing panes; later waves consume this richer model instead. See
   * {@link buildTimeline}.
   */
  timeline: TimelineItem[];
};

// ── F7 — timeline model (exported; later waves import these) ─────────────────────────────────────

/** One tool call within an assistant turn: the engine's `tool_call` step paired with its result. */
export type TimelineToolCall = {
  /** Stable id (the engine `tool_call` step id when present, else the mcp/result step id). */
  id: string;
  toolName: string;
  serverId?: string;
  /** The opening `tool_call` step (preferred from the engine stream — it carries the args). */
  call: RunStep;
  /** The closing `tool_result` step, once it arrives. */
  result?: RunStep;
};

/** A user turn — the opener prompt or an interactive follow-up (from a `user_message` step). */
export type TimelineUserItem = {
  kind: "user";
  id: string;
  text: string;
};

/** An assistant turn — reasoning + prose + the tool calls it issued, closed by its `llm_response`. */
export type TimelineAssistantTurn = {
  kind: "assistant_turn";
  id: string;
  /** 0-based assistant-turn ordinal within the run. */
  turnIndex: number;
  /**
   * Observability (WP2.5, D-OB15) — the closing `llm_response` step's OWN `run_steps.id`, i.e. the real
   * persisted row `RunFeedbackInput.stepId` scopes to. Undefined until the turn settles (a still-
   * streaming turn, or one that never closed) — the hover feedback control gates on this rather than
   * `streaming` so it only ever targets a step that genuinely exists server-side.
   */
  stepId?: string;
  reasoningText?: string;
  assistantText?: string;
  toolCalls: TimelineToolCall[];
  /** Context snapshot from the closing `llm_response` step (settled turns only). */
  context?: ContextSnapshot;
  /** Provider-actual usage from the closing `llm_response` step (settled turns only). */
  usageActual?: TokenUsageActual;
  /**
   * Qlik Answers (WP 3.1) — the closing `llm_response` step's payload, narrowed to
   * {@link AnswersStepPayload} via {@link answersPayloadOf}, when this turn is a `qlik_answers` answer
   * (sources/citations, the assistant-version Etag, rejection). Undefined for every other run kind and
   * for a not-yet-settled turn (the payload only exists on the settled step).
   */
  answersPayload?: AnswersStepPayload;
  /** The turn's status — `running` while in-flight, else the `llm_response` step status. */
  status: RunStep["status"];
  /** True while this is the synthesized in-flight turn (text/reasoning from live deltas). */
  streaming: boolean;
};

export type TimelineItem = TimelineUserItem | TimelineAssistantTurn;

const EMPTY_STATE: RunStreamState = {
  status: null,
  ratingState: null,
  steps: [],
  kpis: null,
  deltas: { text: "", reasoning: "" },
  deltasByTurn: {},
  error: null,
  questions: [],
  timeline: [],
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
};

/**
 * The single sentinel a PRE-terminal stream drop sets on `state.error` (a genuine terminal `error`
 * event carries the run's own message). Kept as a constant so the recovery path can recognise +
 * clear exactly this message when the stream reconnects, without clobbering a real error.
 */
const CONNECTION_LOST = "Run stream connection lost.";

/**
 * Unified Sessions WP2.2 (D-US8) — how long the stream may go completely silent (no `RunEvent` of
 * ANY kind, including the server's 15s `{type:"ping"}` heartbeat from WP2.1) while PRE-terminal
 * before the client stops waiting on the browser's own `onerror`/reconnect and forces one itself. A
 * truly hung connection (e.g. a stalled proxy holding the socket open) never fires `onerror` at
 * all, so relying on that alone can leave the console silently stuck; this is the backstop. Set
 * generously above the 15s heartbeat so ordinary jitter (a couple of missed beats) never trips it.
 */
const WATCHDOG_STALE_MS = 45_000;

/**
 * Statuses that mean the run has finished. Auto-Rating (AR11): the server now emits one of these,
 * KEEPS the socket open through the post-terminal review, and closes only after a settled `rating`
 * event (`rated`/`failed`/`skipped`) — so the hook, too, closes the `EventSource` only once BOTH have
 * been seen. Closing prevents the browser auto-reconnecting into an endless replay of the persisted
 * event log (the API re-replays the whole log on every connect to a finished run).
 *
 * Non-terminal: `pending` and `running`. An interactive run that is awaiting the next user turn
 * stays `running` (this `RunStatus` union has no distinct "awaiting input" status — see
 * `packages/shared/src/constants.ts` `RUN_STATUSES`); the stream must stay open through that pause,
 * which is exactly what NOT closing on a non-terminal status gives us.
 *
 * Derived locally from the `RunStatus` union (shared exports no terminal helper, and `apps/web`
 * may not import from `apps/api` where `isTerminalStatus` lives). The exhaustive `switch` below
 * makes this break the typecheck if `RUN_STATUSES` ever gains a member, so the set can't silently
 * drift from the contract. Mirrors `apps/api/src/testing/run-manager.ts` `TERMINAL_STATUSES`.
 */
function isTerminalStatus(status: RunStatus): boolean {
  switch (status) {
    case "completed":
    case "stopped":
    case "error":
    case "aborted":
    // Unified Sessions WP1.1 (D-US2) — the new `ended` terminal (operator ended an interactive
    // session). Terminal, so the stream closes like any other terminal status. Minimal classification
    // arm the contract-drift guard above asks for; WP2.2/WP3.x own any richer treatment.
    case "ended":
      return true;
    case "pending":
    case "running":
      return false;
    default: {
      // Exhaustiveness guard: a new `RunStatus` member makes this a compile error until classified.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

// ── WP 0.2 / S13 — terminal-announcement gate (pure, unit-testable) ──────────────────────────────

/**
 * State for the run-console's terminal-announcement gate (the "Run completed"/stop/error toasts).
 * `armed` flips true only once a GENUINELY live (non-replay) phase was observed this session;
 * `announcedKey` de-dups so a settled phase toasts at most once per `(runId, phase)`.
 */
export type AnnounceGate = {
  /** True once a live (non-replay) phase was seen this session — the toast is now armed. */
  armed: boolean;
  /** The last `(runId, phase)` we announced, so replays/re-renders don't re-toast it. */
  announcedKey: string | null;
};

/** The gate before any observation: not armed, nothing announced. */
export const INITIAL_ANNOUNCE_GATE: AnnounceGate = { armed: false, announcedKey: null };

/**
 * One pure step of the terminal-announcement gate. Given the current gate and a single observation of
 * the console's run phase, returns the next gate plus whether to announce (toast) the terminal phase
 * NOW.
 *
 * The bug this fixes (S13 / T6a): opening an ALREADY-finished run re-streams its whole persisted
 * event log over SSE — including the historical `running` status — so `isLive` momentarily reads true
 * even though we never watched this run go live. Gating the arming on `!isReplay` means those
 * replayed historical `running` phases do NOT arm the gate, so opening a finished run is silent. A
 * genuinely live run (opened non-replay) still arms while `running` and announces exactly once on its
 * real live→terminal transition.
 *
 * Rules:
 *  - a live observation from a REPLAY (finished run being caught up) never arms and never announces;
 *  - a live observation from a genuine (non-replay) session arms the gate and clears the last
 *    announcement (so a subsequent settle can announce);
 *  - a terminal (non-live) observation announces once per `(runId, phase)` IFF the gate is armed.
 */
export function stepAnnounceGate(
  gate: AnnounceGate,
  obs: { isLive: boolean; isReplay: boolean; runId: string | null; phase: string },
): { gate: AnnounceGate; announce: boolean } {
  if (obs.isLive) {
    // Replay's historical `running` must never arm the toast; leave the gate untouched.
    if (obs.isReplay) return { gate, announce: false };
    return { gate: { armed: true, announcedKey: null }, announce: false };
  }
  // Terminal phase: only a run we watched go live this session announces its outcome.
  if (!gate.armed) return { gate, announce: false };
  const key = `${obs.runId ?? "?"}:${obs.phase}`;
  if (gate.announcedKey === key) return { gate, announce: false };
  return { gate: { ...gate, announcedKey: key }, announce: true };
}

/**
 * Unified Sessions (WP3.3, D-US2) — whether a run's terminal "finish" toast should be SUPPRESSED
 * because the OPERATOR THEMSELVES deliberately stopped or ended it (Stop / End session), as opposed to
 * the run stopping on its own (a guardrail, a provider error, …). A deliberate stop is an expected,
 * intentional disposition — re-announcing it as "Run stopped" is noise the operator doesn't need (they
 * just clicked the button that caused it).
 *
 * `RunConsole` tracks `userInitiated` LOCALLY (a ref flipped the instant Stop is clicked, before the
 * request even resolves — "the client knows locally" per the WP3.3 spec) and calls this from its
 * lifecycle-announcement effect before firing the phase's toast. `phase` is the display-level phase
 * string from `deriveRunBarView` (`"stopped"` for an aborted/user-stopped run); `"ended"` is included
 * defensively even though the announcement switch today has no case for it (End session's outcome
 * already toasts nothing via its `default` branch) — this keeps the predicate correct if that ever
 * changes. Kept PURE + exported (mirrors `stepAnnounceGate` above) so it is unit-testable without
 * mounting the console.
 */
export function suppressFinishToast(phase: string, userInitiated: boolean): boolean {
  return userInitiated && (phase === "stopped" || phase === "ended");
}

/**
 * Upsert a step by its stable KEY (`step.id`) into an `index`-ordered list, so a stream
 * replay/reconnect can never duplicate a row. F1: we key on `step.id` (already globally unique via
 * the `:step:`/`:acct:`/`:mcp:` prefixes) rather than `step.index`, and keep the list sorted by
 * `step.index` (now the single per-run monotonic ordinal stamped by `RunManager.emit`, so it is
 * reliably gapless + emission-ordered). Keying on `id` is belt-and-suspenders against any future
 * index collision; ordering by `index` still gives us the deterministic replay order for free.
 */
function upsertStep(steps: RunStep[], step: RunStep): RunStep[] {
  const at = steps.findIndex((existing) => existing.id === step.id);
  if (at === -1) {
    // Insert keeping ascending `index` order (events normally already arrive in order; this stays
    // correct even if a replay interleaves with late live events).
    const next = [...steps, step];
    next.sort((a, b) => a.index - b.index);
    return next;
  }
  const next = steps.slice();
  next[at] = step; // replace with the latest snapshot for this id (e.g. running → ok/error)
  return next;
}

// ── F7 — pure timeline reconstruction (exported; unit-testable without React) ───────────────────

/** Read a `toolCallId` off a step's redacted payload (both engine + mcp steps carry it — F5). */
function payloadToolCallId(step: RunStep): string | undefined {
  const p = step.payload;
  if (p && typeof p === "object" && "toolCallId" in p) {
    const id = (p as { toolCallId: unknown }).toolCallId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Qlik Answers (WP 3.1) — narrow an `llm_response` step's opaque `payload` to {@link AnswersStepPayload}
 * when it actually is one, so the sources panel + version-drift marker (`SourcesPanel.tsx`) can read it
 * without guessing at an `unknown`. The REGULAR engine's `llm_response` payload is `{ deltas, snapshot }`
 * (`apps/api/src/testing/accounting.ts`) and never carries a `promptMode`; the `qlik-answers-executor`
 * ALWAYS sets `promptMode` (`"oneshot"` on the opener/rejection, `"thread"` on interactive turns —
 * `apps/api/src/testing/qlik-answers-executor.ts`).
 *
 * `promptMode` is the discriminator (NOT `estimatedTokens`): `run-repository.ts`'s redaction replaces any
 * `…Tokens`-keyed non-number field with `"[redacted]"`, so a boolean `estimatedTokens: true` becomes a
 * string on the PERSISTED payload — a live run would narrow but a REPLAYED (re-read) run would not.
 * `promptMode` isn't secret-named, so it survives persistence; the panel works for live AND replayed runs.
 */
export function answersPayloadOf(payload: unknown): AnswersStepPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const mode = (payload as { promptMode?: unknown }).promptMode;
  if (mode !== "oneshot" && mode !== "thread") return undefined;
  return payload as AnswersStepPayload;
}

/**
 * F7 — reconstruct the ordered conversation timeline from the run's ordered `steps` (+ the per-turn
 * live `deltasByTurn` for the not-yet-settled turn). PURE: no React, no side effects — so it is
 * unit-testable on its own and later waves can reuse it.
 *
 * Steps are GROUPED BY their engine-authored `turnIndex` — NOT by emission/step order — because the
 * accounting `llm_response` step is emitted POST-DRAIN (after the stream loop settles) and can land
 * after its turn's tool steps, or even after a later turn's. Grouping by `turnIndex` makes turn
 * membership deterministic regardless of that timing. Each turn is created (and positioned in the
 * output) at the FIRST step that references it — its earliest `tool_call`, or, for a tool-less
 * terminal turn, its `llm_response` — and the late `llm_response` only fills that already-positioned
 * turn's prose/context/usage, so a late close never reorders the timeline. Walking `steps` in
 * `index` order:
 *   - a `user_message` step becomes a `{ kind: "user" }` item;
 *   - a `tool_call` step joins its turn's `toolCalls`. The engine stream step and the MCP-sink step
 *     are DE-DUPED by `toolCallId` (F5): the engine step is kept (it carries the args) and the mcp
 *     step's `serverId`/`durationMs` are merged in (a still-unmatched mcp step is merged after the
 *     walk, else dropped — never a fabricated card);
 *   - a `tool_result` step closes its matching entry (by `toolCallId`, else most-recent-same-tool);
 *   - an `llm_response` step settles its turn's `assistantText`/`reasoningText` (F2) + `context` +
 *     `usageActual` + status.
 *
 * Steps without a `turnIndex` (OLD runs persisted before this contract) fall back to a legacy
 * open/close heuristic. Finally, while the run is non-terminal and the trailing turn hasn't settled,
 * that turn is marked `streaming: true` and its prose comes from `deltasByTurn` (per-turn, so it is
 * not conflated with earlier turns), falling back to the flat `deltas` for untagged runs.
 */
export function buildTimeline(state: {
  steps: RunStep[];
  deltas: RunDeltas;
  deltasByTurn?: Record<number, RunDeltas>;
  status: RunStatus | null;
}): TimelineItem[] {
  const items: TimelineItem[] = [];
  // Assistant turns keyed by their engine-authored `turnIndex`. A turn is CREATED (and pushed into
  // `items`) at the FIRST step that references it — its earliest `tool_call`, or, for a tool-less
  // terminal turn, its `llm_response`. The POST-DRAIN `llm_response` of a tool-bearing turn then only
  // UPDATES the already-positioned turn, so a late-arriving close can never reorder the timeline.
  const turnsByIndex = new Map<number, TimelineAssistantTurn>();
  // toolCallId → its entry + the turn it lives in (for result matching + MCP-sink-step merge).
  const callIdToEntry = new Map<string, { entry: TimelineToolCall; turnIndex: number }>();
  // MCP-sink timing steps whose toolCallId hasn't matched an engine call yet (merged after the walk).
  const pendingMcp: RunStep[] = [];
  const settledTurns = new Set<number>();
  // Fallback ordinal for OLD runs whose steps predate `turnIndex` (no engine tag): mirror the legacy
  // open/close heuristic so those runs still segment best-effort (a user_message or a settled
  // llm_response begins the next turn). Tagged runs ignore this entirely.
  let fallbackTurn = 0;

  const getTurn = (ti: number): TimelineAssistantTurn => {
    let turn = turnsByIndex.get(ti);
    if (!turn) {
      turn = {
        kind: "assistant_turn",
        id: `turn-${ti}`,
        turnIndex: ti,
        toolCalls: [],
        status: "running",
        streaming: false,
      };
      turnsByIndex.set(ti, turn);
      items.push(turn);
    }
    return turn;
  };

  const mergeMcp = (entry: TimelineToolCall, mcp: RunStep): void => {
    if (!entry.serverId && mcp.serverId) entry.serverId = mcp.serverId;
    if (entry.call.durationMs === undefined && mcp.durationMs !== undefined) {
      entry.call = { ...entry.call, durationMs: mcp.durationMs };
    }
  };

  for (const step of state.steps) {
    const isMcp = step.id.includes(":mcp:");
    switch (step.type) {
      case "user_message": {
        items.push({ kind: "user", id: step.id, text: readStepText(step) });
        fallbackTurn += 1; // (fallback only) the next assistant work is a new turn
        break;
      }
      case "tool_call": {
        const callId = payloadToolCallId(step);
        if (isMcp) {
          // The MCP-sink step DUPLICATES the engine `tool_call` (F5): merge its timing/serverId onto
          // the engine entry by toolCallId rather than rendering a second card. Stash if the engine
          // call hasn't been seen yet (it usually precedes the mcp step, but don't assume order).
          const match = callId ? callIdToEntry.get(callId) : undefined;
          if (match) mergeMcp(match.entry, step);
          else pendingMcp.push(step);
          break;
        }
        const ti = step.turnIndex ?? fallbackTurn;
        const turn = getTurn(ti);
        const existing = callId ? callIdToEntry.get(callId) : undefined;
        if (existing) {
          existing.entry.call = step; // prefer the engine step (it carries the args)
          if (!existing.entry.serverId && step.serverId) existing.entry.serverId = step.serverId;
        } else {
          const entry: TimelineToolCall = {
            id: step.id,
            toolName: step.toolName ?? step.label,
            ...(step.serverId ? { serverId: step.serverId } : {}),
            call: step,
          };
          turn.toolCalls.push(entry);
          if (callId) callIdToEntry.set(callId, { entry, turnIndex: ti });
        }
        break;
      }
      case "tool_result": {
        const callId = payloadToolCallId(step);
        const match = callId ? callIdToEntry.get(callId) : undefined;
        if (match) {
          match.entry.result = step;
          if (!match.entry.serverId && step.serverId) match.entry.serverId = step.serverId;
          break;
        }
        // No matching open call (no toolCallId / out of order): attach to its turn — to the most-recent
        // unresolved same-tool entry, else surface it standalone so a result is never dropped.
        const ti = step.turnIndex ?? fallbackTurn;
        const turn = getTurn(ti);
        const target = [...turn.toolCalls]
          .reverse()
          .find((c) => c.result === undefined && c.toolName === (step.toolName ?? step.label));
        if (target) {
          target.result = step;
          if (!target.serverId && step.serverId) target.serverId = step.serverId;
        } else {
          turn.toolCalls.push({
            id: step.id,
            toolName: step.toolName ?? step.label,
            ...(step.serverId ? { serverId: step.serverId } : {}),
            call: step,
            result: step,
          });
        }
        break;
      }
      case "llm_response": {
        const ti = step.turnIndex ?? fallbackTurn;
        const turn = getTurn(ti);
        turn.stepId = step.id;
        if (step.assistantText !== undefined) turn.assistantText = step.assistantText;
        if (step.reasoningText !== undefined) turn.reasoningText = step.reasoningText;
        if (step.context !== undefined) turn.context = step.context;
        if (step.usageActual !== undefined) turn.usageActual = step.usageActual;
        const answers = answersPayloadOf(step.payload);
        if (answers) turn.answersPayload = answers;
        turn.status = step.status;
        turn.streaming = false;
        settledTurns.add(ti);
        fallbackTurn += 1; // (fallback only) the next assistant work is a new turn
        break;
      }
      // `llm_request` / `context_event` aren't conversation items here.
      default:
        break;
    }
  }

  // Merge any MCP-sink steps whose engine call arrived later (the callId map is now complete). A
  // timing-only step with no logical home (e.g. an old run's untagged mcp step) is dropped — never a
  // fabricated card.
  for (const mcp of pendingMcp) {
    const callId = payloadToolCallId(mcp);
    const match = callId ? callIdToEntry.get(callId) : undefined;
    if (match) mergeMcp(match.entry, mcp);
  }

  // Synthesize the IN-FLIGHT turn from the live per-turn deltas while the run is non-terminal and its
  // trailing turn hasn't settled (no closing llm_response yet). Prefer the per-turn channel (so the
  // current turn's prose isn't conflated with earlier turns'); fall back to the flat `deltas` for
  // runs/events that carry no `turnIndex`.
  const live = state.status === "running" || state.status === "pending";
  if (live) {
    const byTurn = state.deltasByTurn ?? {};
    const keys = Object.keys(byTurn).map(Number);
    if (keys.length > 0) {
      const inflight = Math.max(...keys);
      const d = byTurn[inflight];
      if (d && !settledTurns.has(inflight)) {
        const turn = getTurn(inflight);
        if (turn.assistantText === undefined && d.text.length > 0) turn.assistantText = d.text;
        if (turn.reasoningText === undefined && d.reasoning.length > 0)
          turn.reasoningText = d.reasoning;
        turn.streaming = true;
      }
    } else if (state.deltas.text.length > 0 || state.deltas.reasoning.length > 0) {
      // Legacy fallback: attach the flat live prose to the last unsettled turn, or a fresh trailing one.
      const open = [...turnsByIndex.values()].reverse().find((t) => !settledTurns.has(t.turnIndex));
      const turn =
        open ?? getTurn(turnsByIndex.size > 0 ? Math.max(...turnsByIndex.keys()) + 1 : 0);
      if (turn.assistantText === undefined && state.deltas.text.length > 0)
        turn.assistantText = state.deltas.text;
      if (turn.reasoningText === undefined && state.deltas.reasoning.length > 0)
        turn.reasoningText = state.deltas.reasoning;
      turn.streaming = true;
    }
  }

  return items;
}

/** Pull the `{ text }` string off a `user_message` step's redacted payload. */
function readStepText(step: RunStep): string {
  const p = step.payload;
  if (p && typeof p === "object" && "text" in p) {
    const t = (p as { text: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}

/** Fold one `RunEvent` into the accumulated console state. */
function reduce(state: RunStreamState, event: RunEvent): RunStreamState {
  switch (event.type) {
    case "status":
      return {
        ...state,
        status: event.status,
        outcome: event.outcome,
        stopReason: event.stopReason,
        // Unified Sessions (WP3.3) — mirror the machine-readable code alongside the human text; only
        // the terminal status event carries one, and the stream closes shortly after (isTerminalStatus
        // below), so there's nothing to "clear" on a later non-terminal event.
        stopReasonCode: event.stopReasonCode,
      };
    // Unified Sessions (WP3.3, D-US1) — the run's live lifecycle phase. `event.phase: null` explicitly
    // CLEARS it (WP1.7) — a resolved wait/spin-up must not leave a stale "Queued"/"Waiting for you"
    // chip showing. `detail` is replaced WHOLESALE each time (never merged): a phase event that carries
    // no `detail` (e.g. plain `stopping`) correctly drops any earlier queue position/deadline.
    case "phase":
      return {
        ...state,
        phase: event.phase,
        queuePosition: event.phase === "queued" ? (event.detail?.position ?? null) : null,
        phaseDeadlineAt: event.detail?.deadlineAt ?? null,
      };
    // Auto-Rating (AR11) — the post-run review axis, emitted AFTER the terminal `status` (it never
    // touches the run's own status/outcome). `pending`/`rating` = "Reviewing…"; a settled state
    // (`rated`/`failed`/`skipped`) is what lets the hook close the stream (see `useRunStream`).
    case "rating":
      return { ...state, ratingState: event.state };
    case "step":
      // Idempotent upsert-by-`index` (not a blind append) so any replay can't duplicate steps.
      return { ...state, steps: upsertStep(state.steps, event.step) };
    case "delta": // stamped monotonic `seq`, and the message handler drops any event with `seq <= lastAppliedSeq` // duplication is prevented one layer up in {@link useRunStream}: each event carries a server- // Deltas are pure-append with no stable key, so a REPLAY must not re-append them. That
    // (the reconnect's replayed suffix), so by the time a `delta` reaches this reducer it is a
    // genuinely new fragment — correct regardless of the server's bounded replay-buffer size.
    {
      const deltas =
        event.channel === "text"
          ? { ...state.deltas, text: state.deltas.text + event.text }
          : { ...state.deltas, reasoning: state.deltas.reasoning + event.text };
      // Also fold into the per-turn channel when the event carries a `turnIndex` (engine-authored),
      // so the in-flight turn's prose isn't conflated with earlier turns' text in the flat `deltas`.
      let deltasByTurn = state.deltasByTurn;
      if (typeof event.turnIndex === "number") {
        const prev = state.deltasByTurn[event.turnIndex] ?? { text: "", reasoning: "" };
        const next =
          event.channel === "text"
            ? { ...prev, text: prev.text + event.text }
            : { ...prev, reasoning: prev.reasoning + event.text };
        deltasByTurn = { ...state.deltasByTurn, [event.turnIndex]: next };
      }
      return { ...state, deltas, deltasByTurn };
    }
    case "kpi":
      return {
        ...state,
        kpis: {
          turns: event.turns,
          toolCalls: event.toolCalls,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          contextTokens: event.contextTokens,
          costUsd: event.costUsd,
          // Claude subscription (WP 3.1, D-CS4/D-CS8) — carry the event's cost basis through so the
          // KPI rail marks a subscription run's shadow-priced cost "est. · subscription". Persisted
          // `kpi` events keep this field (it isn't secret-named), so replayed runs surface it too.
          ...(event.costBasis ? { costBasis: event.costBasis } : {}),
        },
      };
    case "error":
      // `authRequired` is sticky once true: a terminal auth error stays flagged even if a later
      // (e.g. non-fatal accounting) error event carries no flag.
      return {
        ...state,
        error: event.message,
        authRequired: state.authRequired || event.authRequired === true,
      };
    // The agent called `ask_user` — surface the pending question so the console renders an answer form.
    // Idempotent upsert-by-`questionId` (a replay can't duplicate it); appends in ask order.
    case "question": {
      const question: RunQuestion = {
        questionId: event.questionId,
        prompt: event.prompt,
        ...(event.options && event.options.length > 0 ? { options: event.options } : {}),
        allowOther: event.allowOther !== false,
      };
      const others = state.questions.filter((q) => q.questionId !== event.questionId);
      return { ...state, questions: [...others, question] };
    }
    // The question was answered (or the run stopped first) — drop its form.
    case "question_resolved":
      return {
        ...state,
        questions: state.questions.filter((q) => q.questionId !== event.questionId),
      };
    default:
      return state;
  }
}

/**
 * Subscribe to a run's `RunEvent` stream and accumulate it into console state.
 *
 * Pass `null` to subscribe to nothing (e.g. before a run id exists); the state resets to empty.
 * The `EventSource` is opened in an effect keyed on `runId` and **closed in the effect's cleanup**,
 * so it is torn down on unmount and re-created when `runId` changes — no leaked connection.
 */
export function useRunStream(runId: string | null): RunStreamState {
  const [state, setState] = useState<RunStreamState>(EMPTY_STATE);
  // Guard against a late event landing after unmount/cleanup (e.g. an in-flight `onmessage`).
  const activeRef = useRef(false);
  // Set once a terminal `status` has been seen. After this, `onerror` is either the expected
  // end-of-stream signal (the API closes the socket after the settled rating event) or a benign
  // mid-review drop (e.g. an API restart) — NEITHER surfaces a "connection lost" error. Auto-Rating
  // (AR11): the server now keeps the socket OPEN through the post-terminal review and closes only
  // after a SETTLED rating event, so the client mirrors that — it closes on terminal + settled
  // rating, not on terminal alone (`ratingSettledRef` tracks the second half of the gate).
  const terminalRef = useRef(false);
  const ratingSettledRef = useRef(false);
  // ── Pre-terminal reconnect de-dup (server-stamped monotonic `seq`) ─────────────────────────────
  // The native `EventSource` auto-reconnects on a mid-run drop, and the API replays its in-order
  // event buffer FROM THE START before resuming live events. Deltas are pure-append, so a naive
  // replay double-counts every streamed token/reasoning fragment. Fix (F6): every live event carries
  // a per-run monotonic `seq` stamped by `RunManager.emit`; we track the highest applied `seq` and
  // drop any event with `seq <= lastAppliedSeq` (the replayed suffix). This is correct REGARDLESS of
  // the server's bounded replay-buffer size — unlike the old "skip N = events-applied" counter, which
  // over-skipped genuinely-new live events once a client had applied more events than the buffer held.
  // Unified Sessions WP2.2 (D-US8): this SAME guard is also the belt-and-braces protection against the
  // watchdog's own forced reconnect below replaying already-applied events — it needs no change to
  // serve double duty, since it dedupes on `seq` regardless of why a (re)connect happened.
  const lastSeqRef = useRef(-1);
  // True between a pre-terminal drop and the first freshly-applied event after reconnect — drives
  // clearing the "connection lost" sentinel once the stream actually recovers.
  const droppedRef = useRef(false);

  useEffect(() => {
    // Reset accumulated state + sequence bookkeeping whenever the subscription target changes.
    setState(EMPTY_STATE);
    terminalRef.current = false;
    ratingSettledRef.current = false;
    lastSeqRef.current = -1;
    droppedRef.current = false;

    if (!runId) {
      return;
    }

    activeRef.current = true;
    // Forward-declared so the handlers below (defined once) always close/reopen the CURRENT
    // connection: `connect()` reassigns this on every (re)connect — including the watchdog's forced
    // reconnect — and the closures read it at CALL time, so they always see the latest value.
    let close: () => void = () => {};

    // Unified Sessions WP2.2 (D-US8) — the 45s staleness watchdog. One `setTimeout`, re-armed by
    // EVERY received message (a real event OR the server's 15s ping — see `handleMessage`), so it
    // only ever fires after a genuine `WATCHDOG_STALE_MS` of total silence. Disabled once the run
    // goes terminal (`armWatchdog` becomes a no-op and `clearWatchdog` cancels any pending timer) —
    // a finished run's stream going quiet (e.g. mid post-terminal review) is expected, not a dead
    // socket, and the existing `terminalRef` contract already owns that distinction.
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
        // Neither a real event nor the 15s ping arrived for WATCHDOG_STALE_MS: treat the socket as
        // silently dead (the browser may never notice on its own — a truly hung connection fires no
        // `onerror`) and force a reconnect ourselves, surfacing the SAME "connection lost" banner a
        // real `onerror` drop shows (`RunConsole.tsx`'s `streamDropped` banner keys off this exact
        // sentinel). Re-arm immediately so a fresh connection that ALSO goes silent keeps retrying
        // every `WATCHDOG_STALE_MS` indefinitely — mirrors the browser's own unbounded auto-retry,
        // just watching for the case it can't detect itself.
        droppedRef.current = true;
        setState((current) =>
          current.error === CONNECTION_LOST ? current : { ...current, error: CONNECTION_LOST },
        );
        close();
        connect();
        armWatchdog();
      }, WATCHDOG_STALE_MS);
    };

    const handleMessage = (event: RunEvent) => {
      if (!activeRef.current) return;
      // Any message — a real event OR the ping — proves the socket is alive: re-arm before anything
      // else, so even a duplicate/replayed message (which the dedupe below drops) still counts.
      armWatchdog();
      // F6 — dedupe by the server-stamped monotonic `seq`: a reconnect (browser-driven OR the
      // watchdog's forced one) replays the bounded buffer from the start, so drop any event we've
      // already applied (`seq <= lastAppliedSeq`). Correct regardless of the buffer size — a client
      // that applied more events than the buffer holds no longer over-skips genuinely-new live
      // events. Events without a `seq` (the persisted-replay path for a finished run, which never
      // reconnects) are always applied.
      if (typeof event.seq === "number") {
        if (event.seq <= lastSeqRef.current) return; // replayed suffix — already applied
        lastSeqRef.current = event.seq;
      }
      // First genuinely-new event after a drop ⇒ the stream recovered: clear the sentinel (only
      // the connection-lost one, never a real terminal error message).
      if (droppedRef.current) {
        droppedRef.current = false;
        setState((current) =>
          current.error === CONNECTION_LOST ? { ...current, error: null } : current,
        );
      }
      setState((current) => reduce(current, event));
      // Auto-Rating (AR11) — close only on terminal status AND a settled rating (mirrors the
      // server, which now keeps the socket open through the post-terminal review and closes after
      // emitting `rated`/`failed`/`skipped`; finished-run replays synthesize that final rating
      // event). Closing ourselves stops the browser's reconnect-and-replay loop exactly as before —
      // just gated one event later.
      if (event.type === "status" && isTerminalStatus(event.status)) {
        terminalRef.current = true;
        clearWatchdog(); // terminal reached — the watchdog's job is done for this run
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
      // settled rating, or a drop mid-review (e.g. an API restart): close the source so the browser
      // doesn't reconnect into a seq-less persisted replay (which would double-fold deltas), keep
      // `ratingState` AS-IS (an honest unknown — a refresh re-reads the persisted state), and never
      // surface an error. Only a genuine PRE-terminal drop surfaces the "connection lost" banner;
      // its reconnect's re-replayed prefix is deduped by `seq` in `handleMessage`. The native
      // `EventSource` auto-reconnects itself here (same object ⇒ it sends `Last-Event-ID`
      // automatically per WP2.1) — the watchdog above stays armed underneath as a backstop in case
      // that auto-reconnect never actually produces another message.
      if (terminalRef.current) {
        close();
        return;
      }
      droppedRef.current = true;
      setState((current) => (current.error ? current : { ...current, error: CONNECTION_LOST }));
    };

    const connect = () => {
      close = openRunStream(runId, handleMessage, handleError);
    };

    connect();
    armWatchdog(); // start the clock immediately — even the FIRST message must land within 45s

    return () => {
      activeRef.current = false;
      clearWatchdog();
      close(); // closes the EventSource — no leak
    };
  }, [runId]);

  // F7 — derive the ordered timeline from the accumulated state. Memoized on the inputs it reads so
  // it only recomputes when steps/deltas/status change (not on every render). ADDITIVE: existing
  // fields on `state` are returned untouched for the current panes.
  const timeline = useMemo(
    () =>
      buildTimeline({
        steps: state.steps,
        deltas: state.deltas,
        deltasByTurn: state.deltasByTurn,
        status: state.status,
      }),
    [state.steps, state.deltas, state.deltasByTurn, state.status],
  );

  return { ...state, timeline };
}
