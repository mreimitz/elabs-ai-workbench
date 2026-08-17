// Unified Sessions WP2.3 — backward-compat + additivity lock for the SuiteRunEvent contract, the
// suite-scope sibling of `session-contract.test.ts`'s RunEvent lock.
//
// The critical guarantee: adding the `ping` member (D-US8 follow-up, suite-stream ping parity with
// `RunEvent`'s `ping` from WP1.1/WP2.1) did NOT break parsing of pre-existing SuiteRunEvent shapes —
// none of them carry `ping`, and every one must still parse against the additively-extended
// `suiteRunEventSchema`. The second half exercises the NEW `ping` member.

import assert from "node:assert/strict";
import { test } from "node:test";
import { suiteRunEventSchema } from "./schemas.js";
import type { SuiteRunEvent } from "./types.js";

// ── Pre-WP2.3 SuiteRunEvent shapes — must all still parse ──────────────────────────────────────────
const OLD_EVENTS: SuiteRunEvent[] = [
  {
    type: "cell",
    cell: { testId: "t1", scenarioId: "s1", repetition: 0, status: "running" },
    seq: 0,
  },
  {
    type: "cell",
    cell: {
      testId: "t1",
      scenarioId: "s1",
      variantLabel: "skill-on",
      repetition: 1,
      runId: "run-1",
      status: "completed",
      score: 0.8,
    },
    seq: 1,
  },
  {
    type: "cell",
    cell: { testId: "t1", scenarioId: "s2", repetition: 0, status: "error" },
    seq: 2,
  },
  {
    type: "aggregates",
    aggregates: {
      cellsTotal: 4,
      cellsCompleted: 2,
      meanGrade: 0.75,
      gradeStdDev: 0.1,
      passRateAt05: 1,
      totalTokens: 1200,
      execCostUsd: 0.02,
      judgeCostUsd: 0.01,
    },
    seq: 3,
  },
  { type: "status", status: "running", seq: 4 },
  { type: "status", status: "completed" },
  { type: "rating", state: "rated", seq: 5 },
];

test("all pre-WP2.3 SuiteRunEvent shapes still parse against the extended schema", () => {
  for (const ev of OLD_EVENTS) {
    assert.doesNotThrow(() => suiteRunEventSchema.parse(ev), `old event ${ev.type} should still parse`);
  }
});

// ── The new `ping` member parses ────────────────────────────────────────────────────────────────
test('the new `ping` keepalive member parses (mirrors RunEvent\'s `ping`)', () => {
  assert.doesNotThrow(() => suiteRunEventSchema.parse({ type: "ping" } satisfies SuiteRunEvent));
  // A ping is never stamped with a `seq` (see the suite heartbeat's `writeEvent` call), but the schema
  // still tolerates one defensively, exactly like `runEventSchema` does.
  assert.doesNotThrow(() =>
    suiteRunEventSchema.parse({ type: "ping", seq: 99 } satisfies SuiteRunEvent),
  );
});

test("an unknown discriminant is rejected (the union stays closed)", () => {
  const res = suiteRunEventSchema.safeParse({ type: "totally_new_kind" });
  assert.equal(res.success, false);
});
