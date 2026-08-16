// Observability WP1.3 (D-OB16) — full-text search: FTS5 index + backfill + `q=` + reindex.
// Drives the REAL persistence choke point (RunRepository.createRun/onEvent + GradeRepository.insert)
// so the live write hooks are exercised exactly as production writes them.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { SEARCH_CONTENT_LIMITS, type RunEvent, type RunStep } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { backfillSearch, buildFtsMatch, reindexSearch } from "../src/observability/search.js";
import { RunRepository } from "../src/testing/run-repository.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-06-20T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** Seed provider → scenario + test (FK parents of a `runs` row). `testName`/`prompt` carry search needles. */
function seedParents(
  db: AppDatabase,
  opts: {
    scenarioId: string;
    testId: string;
    scenarioName?: string;
    testName?: string;
    userPrompt?: string;
    model?: string;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, @name, 'prov-1', @model, @now, @now)`,
  ).run({
    id: opts.scenarioId,
    name: opts.scenarioName ?? "Baseline environment",
    model: opts.model ?? "claude-sonnet-4",
    now: NOW,
  });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, @prompt, @now, @now)`,
  ).run({
    id: opts.testId,
    name: opts.testName ?? "A test",
    prompt: opts.userPrompt ?? "Do the thing.",
    now: NOW,
  });
}

function step(runId: string, index: number, partial: Partial<RunStep> & { type: RunStep["type"] }): RunStep {
  return {
    id: `${runId}:s${index}`,
    runId,
    index,
    label: partial.label ?? partial.type,
    status: partial.status ?? "ok",
    profileTokens: {},
    payload: partial.payload ?? null,
    ...partial,
  };
}

/** Emit an ordered event through the persistence sink (the live write hook path). */
function emit(runs: RunRepository, runId: string, event: RunEvent): void {
  runs.onEvent(runId, event);
}

/** Fetch the stored FTS rows for one run (run_id, step_id, kind, content), ordered stably. */
function docsForRun(db: AppDatabase, runId: string): Array<Record<string, string>> {
  return db
    .prepare(
      "SELECT run_id AS runId, step_id AS stepId, kind, content FROM run_search WHERE run_id = ? ORDER BY kind, step_id, content",
    )
    .all(runId) as Array<Record<string, string>>;
}

function allDocs(db: AppDatabase): Array<Record<string, string>> {
  return db
    .prepare(
      "SELECT run_id AS runId, step_id AS stepId, kind, content FROM run_search ORDER BY run_id, kind, step_id, content",
    )
    .all() as Array<Record<string, string>>;
}

// ── Preflight: FTS5 is compiled into the bundled better-sqlite3 (WP1.3 DESIGN assertion) ──────────

test("FTS5 is compiled in (pragma_compile_options) and MATCH + snippet() work", () => {
  const db = createDatabase();
  const opt = db
    .prepare("SELECT * FROM pragma_compile_options WHERE compile_options LIKE '%FTS5%'")
    .all();
  assert.ok(opt.length > 0, "the bundled better-sqlite3 must be compiled with ENABLE_FTS5");
  // Functional proof: MATCH + snippet() on our real virtual table (created by schemaSql).
  db.prepare("INSERT INTO run_search (run_id, step_id, kind, content) VALUES ('r','0','assistant','the quick brown fox')").run();
  const row = db
    .prepare(
      "SELECT snippet(run_search, 3, '[', ']', '…', 4) AS s FROM run_search WHERE run_search MATCH 'quick'",
    )
    .get() as { s: string };
  assert.match(row.s, /\[quick\]/, "snippet() highlights the matched term");
});

// ── buildFtsMatch — tokenization + prefix + injection safety ──────────────────────────────────────

test("buildFtsMatch tokenizes to quoted prefix terms; punctuation-only → null", () => {
  assert.equal(buildFtsMatch("Revenue Growth"), '"revenue"* "growth"*');
  assert.equal(buildFtsMatch('search AND "inject" OR *'), '"search"* "and"* "inject"* "or"*');
  assert.equal(buildFtsMatch("   !!!  "), null, "no searchable token → null");
  assert.equal(buildFtsMatch(""), null);
});

// ── Each content class is indexed + findable (a fixture per class) ─────────────────────────────────

test("each content class (meta, prompt, assistant, tool, tool_result, error, rating) is indexed + findable", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);

  seedParents(db, {
    scenarioId: "scn-1",
    testId: "test-1",
    // meta = testName + scenarioName + model → needles: narwhal, pangolin, opusmodelxyz
    testName: "Quarterly narwhal report",
    scenarioName: "Pangolin environment",
    model: "opusmodelxyz",
    // opener prompt needle: aardvark
    userPrompt: "Summarize the aardvark findings for Q3.",
  });

  const runId = "run-classes";
  runs.createRun(runId, { testId: "test-1", scenarioId: "scn-1", mode: "automated" });

  // prompt (interactive user turn) needle: flamingo
  emit(runs, runId, {
    type: "step",
    step: step(runId, 0, { type: "user_message", label: "user", payload: { text: "Follow up: the flamingo question." } }),
  });
  // tool needle: wolverine (in args)
  emit(runs, runId, {
    type: "step",
    step: step(runId, 1, {
      type: "tool_call",
      toolName: "search_docs",
      payload: { toolCallId: "c1", args: { query: "wolverine migration" } },
    }),
  });
  // tool_result needle: kangaroo (MCP text content)
  emit(runs, runId, {
    type: "step",
    step: step(runId, 2, {
      type: "tool_result",
      toolName: "search_docs",
      payload: { toolCallId: "c1", result: { content: [{ type: "text", text: "found kangaroo records" }] } },
    }),
  });
  // assistant needle: platypus
  emit(runs, runId, {
    type: "step",
    step: step(runId, 3, {
      type: "llm_response",
      label: "assistant",
      assistantText: "The revenue grew strongly in the platypus region.",
    }),
  });
  emit(runs, runId, {
    type: "kpi",
    turns: 1,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 120,
    costUsd: 0.01,
  });
  // error needle (human stopReason): salamander
  emit(runs, runId, {
    type: "status",
    status: "error",
    outcome: "error",
    stopReason: "Aborted on a salamander overflow condition.",
  });

  // rating needle: ocelot (judge reasoning) + fixtarget marmoset (evidence)
  grades.insert({
    runId,
    graderId: "outcome_judge",
    kind: "llm",
    status: "graded",
    score: 0.4,
    method: "logprob_weighted",
    reasoning: "The answer omitted the ocelot metric entirely.",
    evidence: { fixTarget: "add the marmoset breakdown", buckets: ["missing_data"] },
  });

  const find = (q: string) => runs.queryRuns({ q });
  const kindOf = (q: string) => find(q)[0]?.searchMatchKind;

  assert.equal(find("narwhal").length, 1, "meta: test name is findable");
  assert.equal(kindOf("narwhal"), "meta");
  assert.equal(find("pangolin").length, 1, "meta: environment name is findable");
  assert.equal(find("opusmodelxyz").length, 1, "meta: model id is findable");
  assert.equal(find("aardvark").length, 1, "prompt: the test opener is findable");
  assert.equal(kindOf("aardvark"), "prompt");
  assert.equal(find("flamingo").length, 1, "prompt: an interactive user turn is findable");
  assert.equal(find("wolverine").length, 1, "tool: the tool call args are findable");
  assert.equal(kindOf("wolverine"), "tool");
  assert.equal(find("kangaroo").length, 1, "tool_result: the result TEXT is findable");
  assert.equal(kindOf("kangaroo"), "tool_result");
  assert.equal(find("platypus").length, 1, "assistant: the assistant prose is findable");
  assert.equal(kindOf("platypus"), "assistant");
  assert.equal(find("salamander").length, 1, "error: the human stopReason is findable");
  assert.equal(kindOf("salamander"), "error");
  assert.equal(find("ocelot").length, 1, "rating: the judge verdict text is findable");
  assert.equal(kindOf("ocelot"), "rating");
  assert.equal(find("marmoset").length, 1, "rating: forensics fix targets are findable");

  // A hit carries a snippet preview with the match delimiters.
  const hit = find("platypus")[0];
  assert.ok(hit?.searchSnippet && hit.searchSnippet.includes("[platypus]"), "hit carries a snippet");
});

// ── Binary / base64 tool results are SKIPPED (D-OB16) ─────────────────────────────────────────────

test("a base64/binary image tool result is NOT indexed (no tool_result document)", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, { scenarioId: "scn-b", testId: "test-b", userPrompt: "irrelevant opener" });
  const runId = "run-binary";
  runs.createRun(runId, { testId: "test-b", scenarioId: "scn-b", mode: "automated" });

  // A long base64 image payload (both a `data:` URI form AND a bare base64 run under `data`).
  const base64Blob = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg${"AB".repeat(80)}`;
  emit(runs, runId, {
    type: "step",
    step: step(runId, 0, {
      type: "tool_result",
      toolName: "render_image",
      payload: {
        toolCallId: "c1",
        result: { content: [{ type: "image", data: base64Blob, mimeType: "image/png" }] },
      },
    }),
  });

  const toolResultDocs = db
    .prepare("SELECT COUNT(*) AS n FROM run_search WHERE run_id = ? AND kind = 'tool_result'")
    .get(runId) as { n: number };
  assert.equal(toolResultDocs.n, 0, "an image-only tool result produces NO tool_result document");
  // And the base64 text itself is not searchable.
  assert.equal(runs.queryRuns({ q: "iVBORw0KGgo" }).length, 0, "the base64 payload is not indexed");

  // Control: a TEXT result in the same run IS indexed.
  emit(runs, runId, {
    type: "step",
    step: step(runId, 1, {
      type: "tool_result",
      toolName: "search",
      payload: { toolCallId: "c2", result: { content: [{ type: "text", text: "readable dolphin text" }] } },
    }),
  });
  assert.equal(runs.queryRuns({ q: "dolphin" }).length, 1, "a text result in the same run IS indexed");
});

// ── Truncation: an oversized field indexes only up to its cap ──────────────────────────────────────

test("oversized content is truncated to the class cap", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, { scenarioId: "scn-t", testId: "test-t", userPrompt: "opener" });
  const runId = "run-trunc";
  runs.createRun(runId, { testId: "test-t", scenarioId: "scn-t", mode: "automated" });

  const huge = `hippopotamus ${"padding ".repeat(4000)}`; // ~30k chars
  emit(runs, runId, {
    type: "step",
    step: step(runId, 0, { type: "llm_response", label: "assistant", assistantText: huge }),
  });

  const row = db
    .prepare("SELECT content FROM run_search WHERE run_id = ? AND kind = 'assistant'")
    .get(runId) as { content: string } | undefined;
  assert.ok(row, "the assistant document exists");
  assert.ok(
    (row?.content.length ?? 0) <= SEARCH_CONTENT_LIMITS.assistant,
    `stored content (${row?.content.length}) must be <= the assistant cap (${SEARCH_CONTENT_LIMITS.assistant})`,
  );
  assert.equal(runs.queryRuns({ q: "hippopotamus" }).length, 1, "the head of the field is still findable");
});

// ── `q` composes with other RunFilter fields; snippet returned; run delete purges ─────────────────

test("q composes with other filters; snippets returned; deleting a run purges its documents", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedParents(db, { scenarioId: "scn-c", testId: "test-c", userPrompt: "opener" });

  const build = (runId: string, status: "completed" | "error") => {
    runs.createRun(runId, { testId: "test-c", scenarioId: "scn-c", mode: "automated" });
    emit(runs, runId, {
      type: "step",
      step: step(runId, 0, { type: "llm_response", label: "assistant", assistantText: "the revenue analysis is complete" }),
    });
    emit(runs, runId, { type: "kpi", turns: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, contextTokens: 15, costUsd: 0 });
    emit(runs, runId, { type: "status", status, outcome: status === "error" ? "error" : "completed" });
  };
  build("run-ok", "completed");
  build("run-err", "error");

  // q alone matches both runs.
  assert.equal(runs.queryRuns({ q: "revenue" }).length, 2, "q alone matches both runs");
  // q AND status → only the completed one (composition).
  const composed = runs.queryRuns({ q: "revenue", status: ["completed"] });
  assert.equal(composed.length, 1, "q composes with a status filter");
  assert.equal(composed[0]?.id, "run-ok");
  assert.ok(composed[0]?.searchSnippet?.includes("[revenue]"), "the hit carries a snippet");
  assert.equal(composed[0]?.searchMatchKind, "assistant");
  // q AND hasError → only the errored one.
  assert.equal(runs.queryRuns({ q: "revenue", hasError: true })[0]?.id, "run-err");
  // A non-matching q returns nothing.
  assert.equal(runs.queryRuns({ q: "zzzznotpresent" }).length, 0);

  // Delete purges the run's documents.
  runs.delete("run-ok");
  assert.equal(docsForRun(db, "run-ok").length, 0, "run delete purged all FTS documents for the run");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM run_search_map WHERE run_id = 'run-ok'").get() as { n: number }).n,
    0,
    "run delete purged the docmap rows",
  );
  assert.equal(runs.queryRuns({ q: "revenue" }).length, 1, "only the surviving run is still searchable");
});

// ── Backfill of a pre-existing (raw-seeded, never-live-indexed) corpus ─────────────────────────────

test("backfill indexes a pre-existing corpus that was never live-indexed", () => {
  const db = createDatabase();
  seedParents(db, {
    scenarioId: "scn-bf",
    testId: "test-bf",
    testName: "Legacy chinchilla suite",
    userPrompt: "answer about the tardigrade colony",
  });
  // Raw-insert a run + a step + a grade WITHOUT the repository hooks (simulating pre-v33 history).
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, stop_reason, started_at)
     VALUES ('run-legacy', 'test-bf', 'scn-bf', 'automated', 'error', 'error', 'crashed on a quokka fault', @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, assistant_text, payload_json)
     VALUES ('st-1', 'run-legacy', 0, 'llm_response', 'assistant', 'ok', 'the axolotl summary', '{}')`,
  ).run();
  db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, reasoning, grading_version, created_at)
     VALUES ('gr-1', 'run-legacy', 'outcome_judge', 'llm', 'graded', 0.5, 'logprob_weighted', 'noted the wombat gap', 1, @now)`,
  ).run({ now: NOW });

  // Before backfill: nothing is indexed.
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM run_search").get() as { n: number }).n, 0);

  const result = backfillSearch(db);
  assert.equal(result.runs, 1, "one run backfilled");
  assert.ok(result.documents >= 5, "meta + opener + assistant + error + rating documents written");

  const runs = new RunRepository(db);
  assert.equal(runs.queryRuns({ q: "chinchilla" }).length, 1, "meta backfilled");
  assert.equal(runs.queryRuns({ q: "tardigrade" }).length, 1, "opener backfilled");
  assert.equal(runs.queryRuns({ q: "axolotl" }).length, 1, "assistant backfilled");
  assert.equal(runs.queryRuns({ q: "quokka" }).length, 1, "terminal stopReason backfilled");
  assert.equal(runs.queryRuns({ q: "wombat" }).length, 1, "rating backfilled");
});

// ── Reindex rebuilds to IDENTICAL results ─────────────────────────────────────────────────────────

test("reindex drops + rebuilds the index to IDENTICAL documents", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  seedParents(db, { scenarioId: "scn-r", testId: "test-r", testName: "Reindex badger", userPrompt: "the mongoose opener" });

  for (const runId of ["run-a", "run-b"]) {
    runs.createRun(runId, { testId: "test-r", scenarioId: "scn-r", mode: "automated" });
    emit(runs, runId, {
      type: "step",
      step: step(runId, 0, { type: "tool_call", toolName: "lookup", payload: { args: { term: `capybara-${runId}` } } }),
    });
    emit(runs, runId, {
      type: "step",
      step: step(runId, 1, { type: "llm_response", label: "assistant", assistantText: `answer for ${runId} meerkat` }),
    });
    emit(runs, runId, { type: "kpi", turns: 1, toolCalls: 1, tokensIn: 10, tokensOut: 5, contextTokens: 15, costUsd: 0 });
    emit(runs, runId, { type: "status", status: "completed", outcome: "completed", stopReason: "done gecko" });
    grades.insert({ runId, graderId: "outcome_judge", kind: "llm", status: "graded", score: 0.9, method: "logprob_weighted", reasoning: `verdict ${runId} lemur` });
  }

  const before = allDocs(db);
  assert.ok(before.length > 0, "documents exist before reindex");

  const result = reindexSearch(db);
  assert.equal(result.operation, "reindex-search");
  assert.equal(result.runs, 2);

  const after = allDocs(db);
  assert.deepEqual(after, before, "reindex reproduces byte-identical documents");
  // And search still works post-reindex.
  assert.equal(runs.queryRuns({ q: "capybara" }).length, 2, "tool docs survive reindex");
  assert.equal(runs.queryRuns({ q: "meerkat" }).length, 2, "assistant docs survive reindex");
  assert.equal(runs.queryRuns({ q: "lemur" }).length, 2, "rating docs survive reindex");
});
