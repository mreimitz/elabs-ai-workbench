// Unified Sessions WP1.1 — backward-compat + additivity lock for the session contract.
//
// The critical guarantee: adding the `phase`/`ping` RunEvent members and the optional `stopReasonCode`
// on the `status` member did NOT break parsing of OLD persisted events. Every event shape below is a
// faithful copy of what the run-repository has persisted for years (the redacted RunEvent JSON — none
// of them carry `phase`/`ping`/`stopReasonCode`), and every one must still parse against the additively
// extended `runEventSchema`. The second half exercises the NEW members + the capability schema.

import assert from "node:assert/strict";
import { test } from "node:test";
import { RUN_OUTCOMES, RUN_PHASES, RUN_STATUSES, STOP_REASON_CODES } from "./constants.js";
import {
  runEventSchema,
  runPhaseSchema,
  sessionCapabilitiesSchema,
  stopReasonCodeSchema,
} from "./schemas.js";
import type { RunEvent, SessionCapabilities } from "./types.js";

// ── Old persisted RunEvent shapes (pre-WP1.1) — must all still parse ─────────────────────────────
const OLD_EVENTS: RunEvent[] = [
  // status: the historical shape — no stopReasonCode.
  { type: "status", status: "running", seq: 0 },
  { type: "status", status: "completed", outcome: "completed", seq: 12 },
  {
    type: "status",
    status: "stopped",
    outcome: "stopped_guardrail",
    stopReason: "turn limit reached",
    seq: 30,
  },
  { type: "status", status: "error", outcome: "error", stopReason: "boom" },
  { type: "rating", state: "rated", seq: 40 },
  {
    type: "step",
    step: {
      id: "s1",
      runId: "r1",
      index: 0,
      type: "tool_call",
      label: "search",
      status: "ok",
      // a smattering of the many additive optional facets a real step carries — all passthrough
      profileTokens: { generic_o200k: 42 },
      toolName: "search",
      turnIndex: 0,
      payload: { redacted: true },
    },
    seq: 3,
  },
  { type: "delta", channel: "text", text: "hello", turnIndex: 0, seq: 4 },
  { type: "delta", channel: "reasoning", text: "thinking", seq: 5 },
  {
    type: "kpi",
    turns: 2,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 50,
    contextTokens: 400,
    costUsd: 0.01,
    costBasis: "subscription_reference",
    seq: 6,
  },
  { type: "error", message: "reauth needed", authRequired: true, serverIds: ["srv-1"], seq: 7 },
  {
    type: "question",
    questionId: "q1",
    prompt: "Which region?",
    options: [{ label: "EU", description: "Europe" }, { label: "US" }],
    allowOther: true,
    seq: 8,
  },
  { type: "question_resolved", questionId: "q1", answer: "EU", seq: 9 },
  { type: "question_resolved", questionId: "q1", answer: null, seq: 10 },
];

test("all pre-WP1.1 RunEvent shapes still parse against the extended schema", () => {
  for (const ev of OLD_EVENTS) {
    assert.doesNotThrow(() => runEventSchema.parse(ev), `old event ${ev.type} should still parse`);
  }
});

// ── The NEW additive members parse ───────────────────────────────────────────────────────────────
test("the new `phase` member parses (with each detail shape)", () => {
  const events: RunEvent[] = [
    { type: "phase", phase: "queued", detail: { position: 3 }, seq: 1 },
    { type: "phase", phase: "starting", seq: 2 },
    { type: "phase", phase: "waiting_input", detail: { reason: "next_turn" }, seq: 3 },
    {
      type: "phase",
      phase: "waiting_input",
      detail: { reason: "question", deadlineAt: "2026-07-16T12:00:00.000Z" },
      seq: 4,
    },
    { type: "phase", phase: "stopping", seq: 5 },
  ];
  for (const ev of events) assert.doesNotThrow(() => runEventSchema.parse(ev));
});

// WP1.7 — `phase` additively widened to accept `null` (clears the transient phase; see the `RunEvent`
// `phase` member's doc in types.ts).
test("the additively-widened `phase: null` clears the transient phase and parses", () => {
  assert.doesNotThrow(() =>
    runEventSchema.parse({ type: "phase", phase: null, seq: 6 } satisfies RunEvent),
  );
});

test("the additive step-hierarchy fields (`parentStepId`/`spanKind`) parse; an out-of-union spanKind is rejected (WP3.1)", () => {
  // A WP3.1 step carrying BOTH new fields parses.
  assert.doesNotThrow(() =>
    runEventSchema.parse({
      type: "step",
      step: {
        id: "child",
        runId: "r1",
        index: 5,
        type: "context_event",
        label: "claude-opus-4",
        status: "ok",
        profileTokens: {},
        parentStepId: "parent",
        spanKind: "judge_call",
        payload: {},
      },
      seq: 12,
    } satisfies RunEvent),
  );
  // A step with NEITHER field (a pre-WP3.1 shape) still parses — they are optional/additive.
  assert.doesNotThrow(() =>
    runEventSchema.parse({
      type: "step",
      step: {
        id: "flat",
        runId: "r1",
        index: 0,
        type: "tool_call",
        label: "t",
        status: "ok",
        payload: {},
      },
    }),
  );
  // An out-of-union spanKind is rejected (the vocabulary stays closed).
  const bad = runEventSchema.safeParse({
    type: "step",
    step: {
      id: "x",
      runId: "r1",
      index: 0,
      type: "tool_call",
      label: "t",
      status: "ok",
      spanKind: "not_a_span_kind",
      payload: {},
    },
  });
  assert.equal(bad.success, false, "an unknown spanKind must not parse");
});

test("the new `ping` keepalive member parses", () => {
  assert.doesNotThrow(() => runEventSchema.parse({ type: "ping", seq: 99 } satisfies RunEvent));
  assert.doesNotThrow(() => runEventSchema.parse({ type: "ping" } satisfies RunEvent));
});

test("the additive `stopReasonCode` on `status` parses and rejects an out-of-union code", () => {
  assert.doesNotThrow(() =>
    runEventSchema.parse({
      type: "status",
      status: "stopped",
      outcome: "stopped_guardrail",
      stopReason: "the stall detector tripped",
      stopReasonCode: "stalled",
    } satisfies RunEvent),
  );
  const bad = runEventSchema.safeParse({
    type: "status",
    status: "stopped",
    stopReasonCode: "not_a_code",
  });
  assert.equal(bad.success, false);
});

test("`ended` is an accepted status + outcome on a status event (D-US2)", () => {
  assert.doesNotThrow(() =>
    runEventSchema.parse({
      type: "status",
      status: "ended",
      outcome: "ended",
      stopReasonCode: "session_ended",
    } satisfies RunEvent),
  );
});

test("an unknown discriminant is rejected (the union stays closed)", () => {
  const res = runEventSchema.safeParse({ type: "totally_new_kind" });
  assert.equal(res.success, false);
});

// ── Vocabularies + capability schema ─────────────────────────────────────────────────────────────
test("STOP_REASON_CODES / RUN_PHASES round-trip through their enum schemas", () => {
  for (const code of STOP_REASON_CODES) assert.equal(stopReasonCodeSchema.parse(code), code);
  for (const phase of RUN_PHASES) assert.equal(runPhaseSchema.parse(phase), phase);
  assert.equal(STOP_REASON_CODES.length, 14);
  assert.equal(RUN_PHASES.length, 4);
});

test("`ended` was appended (not reordered) to the status + outcome vocabularies", () => {
  assert.equal(RUN_STATUSES[RUN_STATUSES.length - 1], "ended");
  assert.equal(RUN_OUTCOMES[RUN_OUTCOMES.length - 1], "ended");
  // Pre-existing leading members are unmoved.
  assert.deepEqual(RUN_STATUSES.slice(0, 6), [
    "pending",
    "running",
    "completed",
    "stopped",
    "error",
    "aborted",
  ]);
});

test("sessionCapabilitiesSchema accepts a full manifest and infers to SessionCapabilities", () => {
  const manifest: SessionCapabilities = {
    liveText: true,
    liveReasoning: "raw",
    toolCalls: false,
    contextWindow: false,
    tokens: "none",
    costBasis: "none",
    followUps: true,
    askUser: false,
    waitBudgetMs: 1_800_000,
  };
  const parsed = sessionCapabilitiesSchema.parse(manifest);
  assert.deepEqual(parsed, manifest);
});

test("sessionCapabilitiesSchema rejects an out-of-union cost basis", () => {
  const res = sessionCapabilitiesSchema.safeParse({
    liveText: true,
    liveReasoning: "raw",
    toolCalls: true,
    contextWindow: true,
    tokens: "exact",
    costBasis: "bitcoin",
    followUps: true,
    askUser: true,
  });
  assert.equal(res.success, false);
});
