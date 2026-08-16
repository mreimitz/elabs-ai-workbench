// Observability WP1.1 — RunFilter grammar: serialize/parse round-trip, query parsing (filter= JSON +
// aliases), sort/pagination parsing, and the pure `matchesRunFilter` predicate (the reuse path watch
// rules drive). The SQL translation of the SAME grammar is exercised + cross-checked against this
// predicate in apps/api/test/runs-filter.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { runFilterSchema } from "./schemas.js";
import {
  hasRunQueryParams,
  matchesRunFilter,
  parseRunFilter,
  parseRunFilterFromQuery,
  parseRunPagination,
  parseRunSort,
  runNeedsAttention,
  RunFilterError,
  serializeRunFilter,
} from "./run-filter.js";
import type { RunFilter, RunFilterCandidate } from "./types.js";

// ── Compile-time drift guard: the hand-written RunFilter type and the zod schema must stay in sync ──
type SchemaFilter = z.infer<typeof runFilterSchema>;
const _typeToSchema: SchemaFilter = {} as RunFilter;
const _schemaToType: RunFilter = {} as SchemaFilter;
void _typeToSchema;
void _schemaToType;

// ── Serialize / parse round-trip (acceptance #2) ─────────────────────────────────────────────────

test("serialize → parse → identical object (round-trip)", () => {
  const filter: RunFilter = {
    status: ["completed", "error"],
    outcome: ["stopped_guardrail"],
    stopReasonCode: ["max_turns"],
    phase: ["waiting_input"],
    seen: true,
    providerKind: ["anthropic"],
    model: ["claude-sonnet-4"],
    serverId: ["srv-1", "srv-2"],
    scenarioId: ["scn-1"],
    suiteId: "suite-1",
    suiteRunId: "sr-1",
    testId: ["t-1"],
    skillId: ["sk-1"],
    collectionId: "col-1",
    interactiveOnly: true,
    needsAttention: true,
    pinned: false,
    derived: true,
    scoreGte: 0.5,
    scoreLte: 0.9,
    grader: "outcome_judge",
    costUsdGte: 0.01,
    costUsdLte: 2,
    tokensGte: 100,
    tokensLte: 5000,
    durationMsGte: 1000,
    durationMsLte: 60000,
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-16T00:00:00.000Z",
    feedback: { key: "helpful", hasScore: true },
    hasError: false,
  };
  const round = parseRunFilter(serializeRunFilter(filter));
  assert.deepStrictEqual(round, runFilterSchema.parse(filter));
});

test("serialize is byte-stable regardless of input key order", () => {
  const a: RunFilter = { testId: ["t-1"], status: ["completed"] };
  const b: RunFilter = { status: ["completed"], testId: ["t-1"] };
  assert.equal(serializeRunFilter(a), serializeRunFilter(b));
});

test("malformed filter JSON → RunFilterError (400)", () => {
  assert.throws(
    () => parseRunFilter("{not json"),
    (err: unknown) => {
      assert.ok(err instanceof RunFilterError);
      assert.equal((err as RunFilterError).statusCode, 400);
      return true;
    },
  );
});

test("non-object filter JSON → RunFilterError (400)", () => {
  assert.throws(() => parseRunFilter("[1,2,3]"), RunFilterError);
  assert.throws(() => parseRunFilter("42"), RunFilterError);
});

test("invalid field value → ZodError", () => {
  assert.throws(() => parseRunFilter('{"status":["nope"]}'), z.ZodError);
});

test("unknown key is rejected (strict schema)", () => {
  assert.throws(() => parseRunFilter('{"bogus":1}'), z.ZodError);
});

// ── Query parsing: filter= JSON + ergonomic aliases ──────────────────────────────────────────────

test("parseRunFilterFromQuery reads the canonical filter= JSON", () => {
  const parsed = parseRunFilterFromQuery({ filter: '{"status":["running"],"testId":["t-1"]}' });
  assert.deepStrictEqual(parsed, { status: ["running"], testId: ["t-1"] });
});

test("aliases overlay the JSON base; array aliases split commas + flatten repeats", () => {
  const parsed = parseRunFilterFromQuery({
    filter: '{"status":["running"]}',
    status: "completed,error",
    testId: ["t-1", "t-2,t-3"],
    suiteId: "suite-1",
  });
  assert.deepStrictEqual(parsed, {
    status: ["completed", "error"],
    testId: ["t-1", "t-2", "t-3"],
    suiteId: "suite-1",
  });
});

test("a bad alias value still fails validation (→ ZodError)", () => {
  assert.throws(() => parseRunFilterFromQuery({ status: "not-a-status" }), z.ZodError);
});

test("hasRunQueryParams detects filter/sort/limit/offset/aliases, ignores unrelated", () => {
  assert.equal(hasRunQueryParams({}), false);
  assert.equal(hasRunQueryParams({ page: "2" }), false);
  assert.equal(hasRunQueryParams({ filter: "{}" }), true);
  assert.equal(hasRunQueryParams({ sort: "costUsd" }), true);
  assert.equal(hasRunQueryParams({ limit: "10" }), true);
  assert.equal(hasRunQueryParams({ offset: "10" }), true);
  assert.equal(hasRunQueryParams({ status: "completed" }), true);
  assert.equal(hasRunQueryParams({ q: "hi" }), true);
});

// ── Sort + pagination parsing ────────────────────────────────────────────────────────────────────

test("parseRunSort: field-only defaults to desc, explicit dir honored, empty → undefined", () => {
  assert.deepStrictEqual(parseRunSort("costUsd"), { field: "costUsd", direction: "desc" });
  assert.deepStrictEqual(parseRunSort("startedAt:asc"), { field: "startedAt", direction: "asc" });
  assert.equal(parseRunSort(undefined), undefined);
  assert.equal(parseRunSort(""), undefined);
});

test("parseRunSort rejects unknown field / direction (400)", () => {
  assert.throws(() => parseRunSort("bogus"), RunFilterError);
  assert.throws(() => parseRunSort("costUsd:sideways"), RunFilterError);
});

test("parseRunPagination: positive limit, non-negative offset, junk ignored", () => {
  assert.deepStrictEqual(parseRunPagination({ limit: "10", offset: "5" }), {
    limit: 10,
    offset: 5,
  });
  assert.deepStrictEqual(parseRunPagination({ limit: "0" }), {});
  assert.deepStrictEqual(parseRunPagination({ limit: "-3", offset: "-1" }), {});
  assert.deepStrictEqual(parseRunPagination({ limit: "abc" }), {});
  assert.deepStrictEqual(parseRunPagination({ offset: "2" }), { offset: 2 });
});

// ── matchesRunFilter — one assertion per field family (+ combined AND) ────────────────────────────

function candidate(overrides: Partial<RunFilterCandidate> = {}): RunFilterCandidate {
  return {
    status: "completed",
    outcome: "completed",
    mode: "automated",
    scenarioId: "scn-1",
    testId: "t-1",
    costUsd: 0.5,
    tokensIn: 100,
    tokensOut: 200,
    startedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

test("status / outcome / stopReasonCode / phase", () => {
  assert.equal(matchesRunFilter(candidate({ status: "error" }), { status: ["error"] }), true);
  assert.equal(matchesRunFilter(candidate({ status: "completed" }), { status: ["error"] }), false);
  assert.equal(matchesRunFilter(candidate({ outcome: "aborted" }), { outcome: ["aborted"] }), true);
  assert.equal(
    matchesRunFilter(candidate({ outcome: undefined }), { outcome: ["aborted"] }),
    false,
  );
  assert.equal(
    matchesRunFilter(candidate({ stopReasonCode: "max_turns" }), { stopReasonCode: ["max_turns"] }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ phase: "waiting_input" }), { phase: ["stopping"] }),
    false,
  );
});

test("seen / interactiveOnly / hasError", () => {
  assert.equal(matchesRunFilter(candidate({ seen: true }), { seen: true }), true);
  assert.equal(matchesRunFilter(candidate({ seen: false }), { seen: true }), false);
  assert.equal(matchesRunFilter(candidate({ seen: undefined }), { seen: false }), true);
  assert.equal(
    matchesRunFilter(candidate({ mode: "interactive" }), { interactiveOnly: true }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ mode: "automated" }), { interactiveOnly: true }),
    false,
  );
  assert.equal(matchesRunFilter(candidate({ status: "error" }), { hasError: true }), true);
  assert.equal(
    matchesRunFilter(candidate({ outcome: "error", status: "completed" }), { hasError: true }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ status: "completed", outcome: "completed" }), { hasError: false }),
    true,
  );
});

test("needsAttention — the canonical rule exposed as a filter (owner-requested)", () => {
  // The ONE rule, tested directly: pendingInput OR (unseen && !running); `seen === false` strict.
  assert.equal(runNeedsAttention({ status: "running", phase: "waiting_input" }), true);
  assert.equal(runNeedsAttention({ status: "running", phase: "starting", seen: false }), false);
  assert.equal(runNeedsAttention({ status: "error", seen: false }), true);
  assert.equal(runNeedsAttention({ status: "completed", seen: true }), false);
  assert.equal(runNeedsAttention({ status: "running", seen: false }), false); // running-non-waiting
  assert.equal(runNeedsAttention({ status: "completed" }), false); // absent seen ≠ unseen

  // The SAME rule through the RunFilter predicate: `true` requires a match, `false` a non-match.
  const waiting = candidate({ status: "running", phase: "waiting_input", seen: false });
  assert.equal(matchesRunFilter(waiting, { needsAttention: true }), true);
  assert.equal(matchesRunFilter(waiting, { needsAttention: false }), false);
  const unseenTerminal = candidate({ status: "error", seen: false });
  assert.equal(matchesRunFilter(unseenTerminal, { needsAttention: true }), true);
  const seenTerminal = candidate({ status: "completed", seen: true });
  assert.equal(matchesRunFilter(seenTerminal, { needsAttention: true }), false);
  assert.equal(matchesRunFilter(seenTerminal, { needsAttention: false }), true);
  const runningMidTurn = candidate({ status: "running", seen: false });
  assert.equal(matchesRunFilter(runningMidTurn, { needsAttention: true }), false);
  assert.equal(matchesRunFilter(runningMidTurn, { needsAttention: false }), true);
  // Absent field imposes no constraint.
  assert.equal(matchesRunFilter(seenTerminal, {}), true);
});

test("providerKind / model / scenarioId / testId (enriched + core)", () => {
  assert.equal(
    matchesRunFilter(candidate({ providerKind: "anthropic" }), { providerKind: ["anthropic"] }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ providerKind: undefined }), { providerKind: ["anthropic"] }),
    false,
  );
  assert.equal(matchesRunFilter(candidate({ model: "gpt-5" }), { model: ["gpt-5"] }), true);
  assert.equal(
    matchesRunFilter(candidate({ scenarioId: "scn-9" }), { scenarioId: ["scn-9"] }),
    true,
  );
  assert.equal(matchesRunFilter(candidate({ testId: "t-2" }), { testId: ["t-1"] }), false);
});

test("serverId / skillId (array intersection)", () => {
  assert.equal(matchesRunFilter(candidate({ serverIds: ["a", "b"] }), { serverId: ["b"] }), true);
  assert.equal(matchesRunFilter(candidate({ serverIds: ["a"] }), { serverId: ["b"] }), false);
  assert.equal(matchesRunFilter(candidate({ serverIds: undefined }), { serverId: ["b"] }), false);
  assert.equal(matchesRunFilter(candidate({ skillIds: ["sk-1"] }), { skillId: ["sk-1"] }), true);
});

test("suiteId / suiteRunId / collectionId", () => {
  assert.equal(matchesRunFilter(candidate({ suiteId: "s1" }), { suiteId: "s1" }), true);
  assert.equal(matchesRunFilter(candidate({ suiteId: undefined }), { suiteId: "s1" }), false);
  assert.equal(matchesRunFilter(candidate({ suiteRunId: "sr1" }), { suiteRunId: "sr1" }), true);
  assert.equal(
    matchesRunFilter(candidate({ collectionIds: ["col-1", "col-2"] }), { collectionId: "col-2" }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ collectionIds: [] }), { collectionId: "col-2" }),
    false,
  );
});

test("score with optional grader", () => {
  const scored = candidate({
    scores: [
      { grader: "outcome_judge", score: 0.8 },
      { grader: "tool_hygiene", score: 0.2 },
    ],
  });
  assert.equal(matchesRunFilter(scored, { scoreGte: 0.5 }), true); // any grader ≥ 0.5
  assert.equal(matchesRunFilter(scored, { scoreGte: 0.5, grader: "tool_hygiene" }), false); // tool_hygiene is 0.2
  assert.equal(
    matchesRunFilter(scored, { scoreGte: 0.5, scoreLte: 0.9, grader: "outcome_judge" }),
    true,
  );
  assert.equal(matchesRunFilter(candidate({ scores: [] }), { scoreGte: 0.5 }), false); // ungraded run
});

test("cost / tokens / duration / date windows", () => {
  assert.equal(
    matchesRunFilter(candidate({ costUsd: 1.5 }), { costUsdGte: 1, costUsdLte: 2 }),
    true,
  );
  assert.equal(matchesRunFilter(candidate({ costUsd: 3 }), { costUsdLte: 2 }), false);
  assert.equal(
    matchesRunFilter(candidate({ tokensIn: 100, tokensOut: 200 }), { tokensGte: 250 }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ tokensIn: 100, tokensOut: 50 }), { tokensGte: 250 }),
    false,
  );
  // duration = active ?? total; a run with neither can't satisfy a duration bound.
  assert.equal(
    matchesRunFilter(candidate({ activeDurationMs: 5000 }), { durationMsGte: 1000 }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ totalDurationMs: 5000 }), { durationMsGte: 1000 }),
    true,
  ); // fallback
  assert.equal(matchesRunFilter(candidate({}), { durationMsGte: 1000 }), false); // neither → excluded
  assert.equal(
    matchesRunFilter(candidate({ startedAt: "2026-07-10T00:00:00.000Z" }), {
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-15T00:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    matchesRunFilter(candidate({ startedAt: "2026-07-20T00:00:00.000Z" }), {
      dateTo: "2026-07-15T00:00:00.000Z",
    }),
    false,
  );
});

test("pinned / derived / feedback — the conservative no-match branch on a candidate that sets none of them", () => {
  // `pinned` (WP1.6) and `feedback` (WP1.5) are backed by REAL tables/columns; `derived` remains
  // forward-compatible (no backing column until WP3.3). This candidate() fixture sets none of the
  // three, so every "true"/presence side conservatively matches nothing — see run-feedback.test.ts /
  // runs-filter.test.ts for the LIVE match branch against real feedback rows.
  assert.equal(matchesRunFilter(candidate(), { pinned: true }), false);
  assert.equal(matchesRunFilter(candidate(), { pinned: false }), true);
  assert.equal(matchesRunFilter(candidate(), { derived: true }), false);
  assert.equal(matchesRunFilter(candidate(), {}), true); // absent derived → default exclude is a no-op today
  assert.equal(matchesRunFilter(candidate(), { feedback: { key: "helpful" } }), false);
  assert.equal(matchesRunFilter(candidate(), { feedback: { hasScore: true } }), false);
  assert.equal(matchesRunFilter(candidate(), { feedback: {} }), true); // empty feedback = no constraint
});

test("combined AND semantics: all present fields must hold", () => {
  const c = candidate({ status: "completed", providerKind: "anthropic", costUsd: 1.2 });
  assert.equal(
    matchesRunFilter(c, { status: ["completed"], providerKind: ["anthropic"], costUsdLte: 2 }),
    true,
  );
  assert.equal(matchesRunFilter(c, { status: ["completed"], providerKind: ["openai"] }), false);
  assert.equal(matchesRunFilter(c, { status: ["error"], providerKind: ["anthropic"] }), false);
});

test("empty filter matches everything", () => {
  assert.equal(matchesRunFilter(candidate(), {}), true);
});
