// Unified Sessions — the ONE shared terminal table (roadmap/unified-sessions/, WP1.1, D-US1/D-US2).
//
// Every run backend (the AI-SDK engine, the Claude-subscription child, the Qlik Answers wrapper) ends
// a run through this single function, so the SAME cause produces the SAME terminal triple everywhere
// (status, outcome, stopReasonCode) — the invariant WP1.R adversarially checks. Before this module the
// three executors each hand-rolled their own status/outcome mapping and only carried a HUMAN stopReason
// string (sniffed back apart by `guardrailFromReason`), which is exactly how the Qlik deadline used to
// mis-terminate as `aborted`. Here the mapping is closed, exhaustive (compile-time `never` guard), and
// the machine-readable {@link StopReasonCode} rides alongside the human text the executor still writes.

import type { RunOutcome, RunStatus, StopReasonCode } from "@mcp-token-footprint/shared";

/**
 * The executor-facing INPUT to {@link terminalFor}: why a run is ending. Membership is deliberately 1:1
 * with {@link StopReasonCode} (each cause's machine code is the same literal), but the two are distinct
 * roles — a `TerminalCause` is what an executor detected; the returned `stopReasonCode` is what gets
 * persisted/streamed. Keeping the union closed here (not `string`) is what makes the table exhaustive.
 */
export type TerminalCause =
  | "user_stop" // operator pressed Stop
  | "session_ended" // operator ended an interactive session (End-session action, D-US2)
  | "max_duration" // opt-in wall cap elapsed (D-US3)
  | "stalled" // stall detector fired: no events for the stall window while running (D-US3)
  | "wait_expired" // wait budget exhausted while waiting_input (D-US3)
  | "max_turns" // budget meter
  | "max_tool_calls" // budget meter (WP1.7 — closes the WP1.1 gap; see STOP_REASON_CODES)
  | "max_tokens" // budget meter
  | "max_context_tokens" // budget meter
  | "max_cost" // budget meter
  | "context_overflow" // model context window exceeded
  | "prompt_rejected" // Qlik AE-4 "Prompt is rejected" (assistant guardrail)
  | "provider_error" // provider/transport failure
  | "auth" // auth/credential failure
  | "rate_limit"; // 429 / rate limited

/** The terminal triple a run is finalized with — the shared, machine-readable disposition. */
export type TerminalVerdict = {
  status: RunStatus;
  outcome: RunOutcome;
  stopReasonCode: StopReasonCode;
};

/** A guardrail STOP (`stopped` / `stopped_guardrail`) with the given machine code. */
function guardrailStop(stopReasonCode: StopReasonCode): TerminalVerdict {
  return { status: "stopped", outcome: "stopped_guardrail", stopReasonCode };
}

/** A hard ERROR terminal (`error` / `error`) with the given machine code. */
function errorTerminal(stopReasonCode: StopReasonCode): TerminalVerdict {
  return { status: "error", outcome: "error", stopReasonCode };
}

/**
 * Map an ending cause to its shared terminal triple. Pure + total — the `never` default makes the
 * `switch` exhaustive at compile time, so adding a {@link TerminalCause} without handling it here (or
 * dropping a member) fails typecheck. The exhaustive table test locks the exact triples at runtime.
 */
export function terminalFor(cause: TerminalCause): TerminalVerdict {
  switch (cause) {
    case "user_stop":
      return { status: "aborted", outcome: "aborted", stopReasonCode: "user_stop" };
    case "session_ended":
      return { status: "ended", outcome: "ended", stopReasonCode: "session_ended" };
    case "max_duration":
      return guardrailStop("max_duration");
    case "stalled":
      return guardrailStop("stalled");
    case "wait_expired":
      return guardrailStop("wait_expired");
    case "max_turns":
      return guardrailStop("max_turns");
    case "max_tool_calls":
      return guardrailStop("max_tool_calls");
    case "max_tokens":
      return guardrailStop("max_tokens");
    case "max_context_tokens":
      return guardrailStop("max_context_tokens");
    case "max_cost":
      return guardrailStop("max_cost");
    case "context_overflow":
      return { status: "stopped", outcome: "context_overflow", stopReasonCode: "context_overflow" };
    case "prompt_rejected":
      return guardrailStop("prompt_rejected");
    case "provider_error":
      return errorTerminal("provider_error");
    case "auth":
      return errorTerminal("auth");
    case "rate_limit":
      return errorTerminal("rate_limit");
    default: {
      // Exhaustiveness guard: if a new TerminalCause is added without a case above, this fails to
      // compile (the value is no longer `never`). Never reached at runtime.
      const unhandled: never = cause;
      throw new Error(`unhandled terminal cause: ${String(unhandled)}`);
    }
  }
}

/**
 * Every {@link TerminalCause} the closed union contains, in declaration order — the exhaustive input
 * list the table test iterates (and any future cause-driven adopter can enumerate). Kept in lock-step
 * with the union by the same test.
 */
export const TERMINAL_CAUSES = [
  "user_stop",
  "session_ended",
  "max_duration",
  "stalled",
  "wait_expired",
  "max_turns",
  "max_tool_calls",
  "max_tokens",
  "max_context_tokens",
  "max_cost",
  "context_overflow",
  "prompt_rejected",
  "provider_error",
  "auth",
  "rate_limit",
] as const satisfies readonly TerminalCause[];
