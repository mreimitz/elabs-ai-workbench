// Unified Sessions WP1.1 — the shared terminal table (apps/api/src/testing/session-terminal.ts).
// Locks the EXACT terminal triple every executor must produce for each cause, and proves the cause
// union is exhaustive at compile time (the `Record<TerminalCause, …>` below fails to typecheck if a
// cause is missing) and at runtime (every enumerated cause round-trips through `terminalFor`).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunOutcome, RunStatus, StopReasonCode } from "@mcp-token-footprint/shared";
import { RUN_OUTCOMES, RUN_STATUSES, STOP_REASON_CODES } from "@mcp-token-footprint/shared";
import {
  TERMINAL_CAUSES,
  type TerminalCause,
  type TerminalVerdict,
  terminalFor,
} from "../src/testing/session-terminal.js";

// The authoritative table straight from the plan (execution-plan §1). A `Record<TerminalCause, …>`
// REQUIRES every member of the closed cause union to have exactly one entry — so this const is itself
// a compile-time exhaustiveness proof; the runtime asserts below lock the values.
const EXPECTED: Record<TerminalCause, TerminalVerdict> = {
  user_stop: { status: "aborted", outcome: "aborted", stopReasonCode: "user_stop" },
  session_ended: { status: "ended", outcome: "ended", stopReasonCode: "session_ended" },
  max_duration: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "max_duration" },
  stalled: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "stalled" },
  wait_expired: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "wait_expired" },
  max_turns: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "max_turns" },
  max_tool_calls: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "max_tool_calls" },
  max_tokens: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "max_tokens" },
  max_context_tokens: {
    status: "stopped",
    outcome: "stopped_guardrail",
    stopReasonCode: "max_context_tokens",
  },
  max_cost: { status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "max_cost" },
  context_overflow: {
    status: "stopped",
    outcome: "context_overflow",
    stopReasonCode: "context_overflow",
  },
  provider_error: { status: "error", outcome: "error", stopReasonCode: "provider_error" },
  auth: { status: "error", outcome: "error", stopReasonCode: "auth" },
  rate_limit: { status: "error", outcome: "error", stopReasonCode: "rate_limit" },
};

test("terminalFor maps every cause to its exact expected triple", () => {
  for (const cause of Object.keys(EXPECTED) as TerminalCause[]) {
    assert.deepEqual(terminalFor(cause), EXPECTED[cause], `terminalFor(${cause})`);
  }
});

test("TERMINAL_CAUSES enumerates exactly the causes in the table (both directions)", () => {
  const enumerated = [...TERMINAL_CAUSES].sort();
  const tabled = (Object.keys(EXPECTED) as TerminalCause[]).sort();
  assert.deepEqual(enumerated, tabled);
  // No duplicates slipped into the exported list.
  assert.equal(new Set(TERMINAL_CAUSES).size, TERMINAL_CAUSES.length);
});

test("every terminalFor triple is drawn from the shared vocabularies", () => {
  const statuses = new Set<RunStatus>(RUN_STATUSES);
  const outcomes = new Set<RunOutcome>(RUN_OUTCOMES);
  const codes = new Set<StopReasonCode>(STOP_REASON_CODES);
  for (const cause of TERMINAL_CAUSES) {
    const v = terminalFor(cause);
    assert.ok(statuses.has(v.status), `status ${v.status} in RUN_STATUSES`);
    assert.ok(outcomes.has(v.outcome), `outcome ${v.outcome} in RUN_OUTCOMES`);
    assert.ok(codes.has(v.stopReasonCode), `code ${v.stopReasonCode} in STOP_REASON_CODES`);
  }
});

test("the additive `ended` members are present in both vocabularies (D-US2)", () => {
  assert.ok((RUN_STATUSES as readonly string[]).includes("ended"));
  assert.ok((RUN_OUTCOMES as readonly string[]).includes("ended"));
  // Appended, never reordered — the pre-existing leading members keep their positions.
  assert.equal(RUN_STATUSES[0], "pending");
  assert.equal(RUN_OUTCOMES[0], "completed");
});

test("terminalFor is a pure lookup — repeated calls return fresh, equal objects", () => {
  const a = terminalFor("stalled");
  const b = terminalFor("stalled");
  assert.deepEqual(a, b);
  assert.notEqual(a, b); // a new object each call (no shared mutable singleton)
});
