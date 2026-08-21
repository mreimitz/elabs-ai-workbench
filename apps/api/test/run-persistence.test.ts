import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { NormalizedToolDefinition, RunEvent, RunStep } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { McpSession } from "../src/mcp/client.js";

// Derive the low-level provider stream-part type from the mock model's own doStream signature (same
// trick as agent-loop.test.ts / accounting.test.ts — no extra dependency, always matches the SDK).
type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type LanguageModelV3StreamPart = MockStreamResult["stream"] extends ReadableStream<infer P>
  ? P
  : never;

import { AccountingSink } from "../src/testing/accounting.js";
import { runAgentLoop, type AccountingHooks, type EngineConfig } from "../src/testing/engine.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { createAccountingStepSink } from "../src/testing/run-service.js";
import { buildTools, type AllowedTool } from "../src/testing/tool-bridge.js";

// ── In-memory DB (schemaSql + foreign_keys = ON), per testing-schema.test.ts ────────────────────

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** Seed the FK parents (provider → scenario, test) a `runs` row needs. */
function seedParents(db: AppDatabase, testId: string, scenarioId: string): void {
  const now = "2026-06-20T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'List files', 'Use the tools, then answer.', '[]', @now, @now)`,
  ).run({ id: testId, now });
}

// ── Mock model + stub MCP (no provider key, no child process) ───────────────────────────────────

// A provider API key sentinel that must NEVER reach the DB (the redaction acceptance).
const PROVIDER_KEY = "sk-ant-SUPERSECRET-PROVIDER-KEY-0001";
// A secret tool argument value flagged by its key name (`apiKey`); must be absent from payload_json.
const TOOL_ARG_SECRET = "tool-arg-secret-value-XYZ";

const TOOL_DEFS: NormalizedToolDefinition[] = [
  {
    name: "alpha",
    description: "Alpha tool — fetches a value for a key",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, apiKey: { type: "string" } },
    },
    raw: {},
  },
];

function defFor(name: string): NormalizedToolDefinition {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no def for ${name}`);
  return def;
}

function stubSession(): McpSession {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (name: string) => ({ content: [{ type: "text", text: `${name}:ok` }] }),
    close: async () => undefined,
  };
}

const USAGE = {
  inputTokens: { total: 137, noCache: 119, cacheRead: 11, cacheWrite: 7 },
  outputTokens: { total: 23, text: 23, reasoning: 0 },
} as const;

function streamOf(chunks: LanguageModelV3StreamPart[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

/** Mock model: call one tool (with a secret arg), then answer. Two provider round-trips. */
function mockToolThenAnswer(toolInput: unknown) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "alpha",
            input: JSON.stringify(toolInput),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "The final answer." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

function hooksFor(accounting: AccountingSink): AccountingHooks {
  return {
    onLlmStep: async (step) => {
      await accounting.llmStep({
        requestMessages: step.response.messages,
        responseContent: step.content,
        usage: step.usage,
        providerMetadata: step.providerMetadata,
        requestBody: step.request.body,
        // F2 — per-turn prose + reasoning settle on the llm_response step.
        text: step.text,
        reasoningText: step.reasoningText,
      });
    },
    onOverflow: (message) => accounting.emitOverflowStep(message),
    // F3 — the engine's FINAL kpi reads the accounting sink's rolled-up totals (single KPI source).
    getRunKpis: () => {
      const k = accounting.runKpis;
      return {
        turns: k.turns,
        toolCalls: k.toolCalls,
        tokensIn: k.tokensIn,
        tokensOut: k.tokensOut,
        costUsd: k.costUsd,
        peakContextTokens: k.peakContextTokens,
      };
    },
    // RM-33 — the cache composition of the final kpi, delegated to the sink (one omit-when-absent rule).
    cacheKpiFields: () => accounting.cacheKpiFields(),
  };
}

function baseConfig(over: Partial<EngineConfig> & { model: EngineConfig["model"] }): EngineConfig {
  return {
    model: over.model,
    system: "You are a test harness.",
    userPrompt: "Use the tools, then answer.",
    tools: over.tools ?? {},
    maxTurns: 20,
    profiles: ["generic_o200k", "generic_cl100k"],
    ...over,
  };
}

/** Drive one full run (engine + accounting) through a RunManager whose persistence sink is `repo`. */
async function driveRun(
  db: AppDatabase,
  runId: string,
  testId: string,
  scenarioId: string,
  toolInput: unknown,
): Promise<RunRepository> {
  const repo = new RunRepository(db);
  repo.createRun(runId, { testId, scenarioId, mode: "automated" });
  const manager = new RunManager(repo); // the fan-out → persistence sink wiring (WP 1.6)
  manager.create(runId);

  const sessions = new Map<string, McpSession>([["srv", stubSession()]]);
  const allowed: AllowedTool[] = [{ serverId: "srv", def: defFor("alpha") }];
  const accounting = new AccountingSink(
    {
      runId,
      profiles: ["generic_o200k", "generic_cl100k"],
      system: "You are a test harness.",
      allowedTools: allowed.map((a) => a.def),
      model: "claude-sonnet-4",
      providerKind: "anthropic",
    },
    (e) => manager.emit(runId, e),
  );
  const sink = createAccountingStepSink(manager, runId, accounting);
  const tools = buildTools(allowed, sessions, sink);

  const model = mockToolThenAnswer(toolInput);
  await runAgentLoop(runId, baseConfig({ model, tools, accounting: hooksFor(accounting) }), (e) =>
    manager.emit(runId, e),
  );

  // The persistence sink runs on a microtask (the manager isolates it) — let the queue drain.
  await new Promise((resolve) => setImmediate(resolve));
  return repo;
}

// ── Acceptance 1: a completed run reloads with ordered steps + events, totals, context series ────

test("a completed run reloads from DB with ordered steps + events, finalized totals, context series", async () => {
  const db = createDatabase();
  seedParents(db, "test-1", "scn-1");
  const runId = "run-complete";

  const repo = await driveRun(db, runId, "test-1", "scn-1", { key: "x" });
  const detail = repo.getRun(runId);

  // Totals finalized: terminal status + a non-zero token/turn rollup.
  assert.equal(detail.status, "completed", "run reloads as completed");
  assert.equal(detail.outcome, "completed");
  assert.ok(detail.turns >= 2, "turns finalized (>=2 provider round-trips)");
  assert.equal(detail.toolCalls, 1, "tool_calls finalized");
  assert.ok(detail.tokensIn > 0, "tokens_in finalized from provider-actual");
  assert.ok(detail.tokensOut > 0, "tokens_out finalized from provider-actual");
  assert.ok(detail.peakContextTokens > 0, "peak_context_tokens finalized");
  assert.ok(typeof detail.durationMs === "number", "duration_ms finalized");

  // Events are present and strictly ordered by idx (exact replay log).
  assert.ok(detail.events.length > 0, "events persisted");
  // The first persisted event is the engine's `running` status; the last is the terminal status.
  const firstStatus = detail.events.find(
    (e): e is Extract<RunEvent, { type: "status" }> => e.type === "status",
  );
  assert.equal(firstStatus?.status, "running", "first status event is running");
  const lastEvent = detail.events[detail.events.length - 1];
  assert.equal(lastEvent?.type, "status");
  assert.equal(
    (lastEvent as Extract<RunEvent, { type: "status" }>).status,
    "completed",
    "last event is terminal completed",
  );

  // Steps present and GLOBALLY ordered by their persisted `run_steps.idx`: gapless, unique, strictly
  // increasing `[0,1,2,…,n-1]`. This must FAIL on the old behavior that stamped `idx = step.index`
  // (three independent per-component counters → duplicates like `[0,0,0,1,1]`). We read the raw
  // `run_steps.idx` column directly (the mapper reconstructs `step.index` from the stored payload, not
  // from the column) so the assertion is about the persisted ordering, not the engine ordinal.
  assert.ok(detail.steps.length > 0, "steps persisted");
  const persistedStepIdxs = (
    db
      .prepare("SELECT idx FROM run_steps WHERE run_id = ? ORDER BY rowid ASC")
      .all(runId) as Array<{
      idx: number;
    }>
  ).map((r) => r.idx);
  assert.deepEqual(
    persistedStepIdxs,
    persistedStepIdxs.map((_, i) => i),
    "run_steps.idx is gapless, unique, and strictly increasing [0,1,…,n-1] (globally ordered, not per-component)",
  );
  const withContext = detail.steps.filter(
    (s): s is RunStep & { context: NonNullable<RunStep["context"]> } => s.context !== undefined,
  );
  assert.ok(withContext.length >= 2, "context series intact across the llm steps");
  for (const s of withContext) {
    assert.ok(s.context.total > 0, "snapshot total is non-zero");
    assert.ok(typeof s.context.segments.tool_defs === "number", "snapshot segments reconstructed");
  }

  // getRun reconstructs enough to drive replay: each step round-trips its profile lenses.
  const acctStep = detail.steps.find((s) => s.type === "llm_response");
  assert.ok(acctStep, "an accounting llm step reloaded");
  assert.ok(
    typeof acctStep.profileTokens.generic_o200k === "number",
    "profileTokens reconstructed",
  );
  assert.ok(acctStep.usageActual, "usageActual reconstructed");

  // Observability WP3.1 (D-OB17) — a REAL engine tool call now persists a `tool_io` CHILD nested under
  // its MCP-bridge tool-call step (the accounting sink emits it after the parent). One tool call → one
  // child; it links to the tool_call step that carries a serverId (the MCP-bridge step, not the engine's
  // zero-token stream step); and it carries the request/response byte sizes + timing.
  const toolIo = detail.steps.filter((s) => s.spanKind === "tool_io");
  assert.equal(toolIo.length, 1, "exactly one tool_io child for the run's single MCP tool call");
  const io = toolIo[0]!;
  const parent = detail.steps.find((s) => s.id === io.parentStepId);
  assert.ok(
    parent,
    "the tool_io child's parentStepId resolves to a persisted step of the same run",
  );
  assert.equal(parent.type, "tool_call", "the tool_io child nests under a tool_call step");
  assert.ok(parent.serverId, "the parent is the MCP-bridge tool_call step (carries a serverId)");
  assert.ok(
    parent.index < io.index,
    "the child's idx is AFTER its parent (monotonic, never reordered)",
  );
  const ioPayload = io.payload as {
    requestBytes?: number;
    responseBytes?: number;
    durationMs?: number;
  };
  assert.ok(typeof ioPayload.requestBytes === "number", "tool_io carries the request byte size");
  assert.ok(typeof ioPayload.responseBytes === "number", "tool_io carries the response byte size");
  assert.ok(typeof ioPayload.durationMs === "number", "tool_io carries the roundtrip duration");
});

// ── Acceptance 2: redaction — secret tool arg absent; no provider key anywhere in run tables ─────

test("redaction: a secret tool argument is absent and no provider key appears in any run table", async () => {
  const db = createDatabase();
  seedParents(db, "test-2", "scn-1");
  const runId = "run-redact";

  // The model calls the tool with a flagged-secret argument (`apiKey`) carrying a sentinel value, and
  // a payload field that also literally contains the provider key string.
  await driveRun(db, runId, "test-2", "scn-1", {
    key: "x",
    apiKey: TOOL_ARG_SECRET,
    note: `caller key ${PROVIDER_KEY}`,
  });

  // Dump every persisted column across all three run tables and scan it. `runs` keys on `id`; the
  // child tables key on `run_id`.
  const haystacks: string[] = [];
  const runRows = db.prepare("SELECT * FROM runs WHERE id = ?").all(runId) as Array<
    Record<string, unknown>
  >;
  for (const row of runRows) haystacks.push(JSON.stringify(row));
  for (const table of ["run_steps", "run_events"] as const) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE run_id = ?`).all(runId) as Array<
      Record<string, unknown>
    >;
    for (const row of rows) haystacks.push(JSON.stringify(row));
  }
  const blob = haystacks.join("\n");

  assert.ok(blob.length > 0, "rows were persisted for the run");
  // The flagged-secret tool-argument value must have been stripped before persisting payload_json.
  assert.ok(
    !blob.includes(TOOL_ARG_SECRET),
    "the secret tool-argument value is absent from stored payloads",
  );
  // The provider API key string must NOT appear anywhere in runs/run_steps/run_events.
  assert.ok(!blob.includes(PROVIDER_KEY), "no provider key string appears in any run table");
  // Sanity: the redaction marker is present where a secret field was stripped.
  assert.ok(blob.includes("[redacted]"), "secret fields were replaced with a redaction marker");
});

// ── Acceptance 3: a leftover `running` row becomes `aborted` on restart; still opens read-only ───

test("a running run is reconciled to aborted on restart and still opens read-only", async () => {
  const db = createDatabase();
  seedParents(db, "test-3", "scn-1");
  const runId = "run-orphan";

  // Simulate a crash mid-run: createRun leaves a `running` row + a couple of partial steps/events.
  const repo = new RunRepository(db);
  repo.createRun(runId, { testId: "test-3", scenarioId: "scn-1", mode: "automated" });
  const manager = new RunManager(repo);
  manager.create(runId);
  manager.emit(runId, { type: "status", status: "running" });
  manager.emit(runId, {
    type: "step",
    step: {
      id: `${runId}:partial`,
      runId,
      index: 0,
      type: "tool_call",
      label: "alpha",
      status: "ok",
      profileTokens: { generic_o200k: 5 },
      payload: { isError: false },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  // Before restart: the row is `running`.
  assert.equal(repo.getSummary(runId).status, "running", "partial run is left running");

  // Restart routine (what index.ts calls on startup).
  const reconciled = repo.abortOrphanedRuns();
  assert.ok(reconciled >= 1, "the orphaned running run was reconciled");

  // After restart: the partial record opens read-only and is marked aborted.
  const detail = repo.getRun(runId);
  assert.equal(detail.status, "aborted", "the orphaned run is now aborted");
  assert.ok(detail.steps.length >= 1, "the partial step record still opens read-only");
  assert.ok(detail.events.length >= 1, "the partial event record still opens read-only");
});

// ── Claude subscription (WP 3.1, D-CS4/D-CS8): the terminal kpi's costBasis is persisted on the runs
//    row and surfaced by getSummary / listRuns (Runs feed) / compareRuns (Compare) — the WP 2.2 data
//    gap fix — for a subscription run, and is ABSENT for an ordinary API-keyed run. ─────────────────

test("costBasis: a subscription run's kpi basis is persisted + surfaced by summary/list/compare; a normal run has none", () => {
  const db = createDatabase();
  seedParents(db, "test-cb", "scn-1");
  const repo = new RunRepository(db);

  // A subscription run: its terminal kpi carries `costBasis: "subscription_reference"` (the
  // shadow-price marker the claude_subscription executor stamps — WP 1.5/0.1).
  repo.createRun("run-sub", { testId: "test-cb", scenarioId: "scn-1", mode: "automated" });
  repo.onEvent("run-sub", {
    type: "kpi",
    turns: 2,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 120,
    costUsd: 0.5,
    costBasis: "subscription_reference",
  });
  repo.onEvent("run-sub", { type: "status", status: "completed", outcome: "completed" });

  // A normal (API-keyed) run: its kpi carries NO costBasis (every ordinary run — the default path).
  repo.createRun("run-api", { testId: "test-cb", scenarioId: "scn-1", mode: "automated" });
  repo.onEvent("run-api", {
    type: "kpi",
    turns: 2,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 120,
    costUsd: 0.5,
  });
  repo.onEvent("run-api", { type: "status", status: "completed", outcome: "completed" });

  // The persisted column: subscription writes the basis; normal writes NULL.
  const subRow = db.prepare("SELECT cost_basis FROM runs WHERE id = 'run-sub'").get() as {
    cost_basis: string | null;
  };
  const apiRow = db.prepare("SELECT cost_basis FROM runs WHERE id = 'run-api'").get() as {
    cost_basis: string | null;
  };
  assert.equal(
    subRow.cost_basis,
    "subscription_reference",
    "subscription run persists cost_basis from the terminal kpi",
  );
  assert.equal(apiRow.cost_basis, null, "normal run persists NULL cost_basis");

  // getSummary (→ toRunSummary) surfaces the marker off the runs row (no live kpi event needed).
  assert.equal(repo.getSummary("run-sub").costBasis, "subscription_reference");
  assert.equal(
    repo.getSummary("run-api").costBasis,
    undefined,
    "a normal run carries no costBasis marker",
  );

  // listRuns (the Runs feed) maps through toRunSummary, so both rows see the correct basis.
  const byId = new Map(repo.listRuns({ testId: "test-cb" }).map((r) => [r.id, r]));
  assert.equal(byId.get("run-sub")?.costBasis, "subscription_reference");
  assert.equal(byId.get("run-api")?.costBasis, undefined);

  // compareRuns (the Compare workspace) also maps through toRunSummary — the WP 2.2 gap this fix closes.
  const compareById = new Map(repo.compareRuns(["run-sub", "run-api"]).map((r) => [r.id, r]));
  assert.equal(
    compareById.get("run-sub")?.costBasis,
    "subscription_reference",
    "compareRuns surfaces the subscription marker",
  );
  assert.equal(compareById.get("run-api")?.costBasis, undefined);
});

// ── RM-33 WP 1.2 (D-CT1/D-CT2/D-CT3) — the cache split survives to the run row AND onto the wire ──
//
// `runs.cached_tokens` has existed since the run engine shipped. It was written on every finalize and
// then mapped NOWHERE: the column was correct and no consumer could ever read it. This closes that,
// and adds the two halves the merged column cannot express.

test("RM-33 — a finalized run persists the cache split and exposes it on RunSummary", async () => {
  const db = createDatabase();
  seedParents(db, "test-1", "scn-1");
  const runId = "run-cache-split";

  const repo = await driveRun(db, runId, "test-1", "scn-1", { key: "x" });
  const detail = repo.getRun(runId);

  // Two provider round-trips at USAGE each.
  assert.equal(detail.cacheReadTokens, USAGE.inputTokens.cacheRead * 2, "cache reads reached the row");
  assert.equal(
    detail.cacheWriteTokens,
    USAGE.inputTokens.cacheWrite * 2,
    "cache writes reached the row — and are NOT merged into the read half",
  );
  assert.equal(
    detail.cachedTokens,
    (USAGE.inputTokens.cacheRead + USAGE.inputTokens.cacheWrite) * 2,
    "the merged legacy figure is finally readable too — it was write-only before RM-33",
  );

  // D-CT1 — `tokensIn` is unchanged and still GROSS: the split is a DECOMPOSITION of it, never an
  // addition to it. If a future change ever "helpfully" subtracts the cached slice, this goes red.
  assert.equal(detail.tokensIn, USAGE.inputTokens.total * 2, "tokensIn stays the gross provider total");
  assert.ok(
    (detail.cacheReadTokens ?? 0) + (detail.cacheWriteTokens ?? 0) < detail.tokensIn,
    "the cache slice is a strict subset of tokensIn for this fixture",
  );

  // And the row itself carries real integers, not NULLs.
  const row = db
    .prepare("SELECT cache_read_tokens AS r, cache_write_tokens AS w FROM runs WHERE id = ?")
    .get(runId) as { r: number | null; w: number | null };
  assert.deepEqual(row, { r: USAGE.inputTokens.cacheRead * 2, w: USAGE.inputTokens.cacheWrite * 2 });
});

test("RM-33 — a run whose provider reports no split reads back as UNKNOWN, not zero", async () => {
  // D-CT3/D-CT6 at the persistence boundary. A `0` here would be a claim we cannot support: it would
  // tell the metrics layer this run demonstrably had no cache, and drag every cache-hit-rate average
  // that includes it toward zero. NULL says "nobody told us", and the metrics layer excludes it.
  const db = createDatabase();
  seedParents(db, "test-2", "scn-2");
  const runId = "run-cache-unknown";

  const repo = new RunRepository(db);
  repo.createRun(runId, { testId: "test-2", scenarioId: "scn-2", mode: "automated" });
  const manager = new RunManager(repo); // the fan-out → persistence sink wiring (WP 1.6)
  manager.create(runId);

  // A kpi with NO cache keys at all — exactly what the omit-when-absent emit produces for a backend
  // that reports no cache detail — followed by a terminal status.
  manager.emit(runId, {
    type: "kpi",
    turns: 1,
    toolCalls: 0,
    tokensIn: 100,
    tokensOut: 10,
    contextTokens: 100,
    costUsd: 0.001,
  });
  manager.emit(runId, { type: "status", status: "completed", outcome: "completed" });
  await new Promise((resolve) => setImmediate(resolve));

  const row = db
    .prepare("SELECT cache_read_tokens AS r, cache_write_tokens AS w FROM runs WHERE id = ?")
    .get(runId) as { r: number | null; w: number | null };
  assert.deepEqual(row, { r: null, w: null }, "SQL NULL, never 0");

  const detail = repo.getRun(runId);
  assert.equal(detail.cacheReadTokens, undefined, "absent on the wire, never 0");
  assert.equal(detail.cacheWriteTokens, undefined);
  assert.equal(detail.tokensIn, 100, "…while the gross totals are unaffected");
});

test("RM-33 — a MERGED-ONLY run keeps its merged figure and leaves the split UNKNOWN", async () => {
  // The shape real data exposed: 6 runs in a 163-run database whose steps carry `cachedInputTokens`
  // and neither half, persisted by an extractor that predates the split. They hold 107k–1.2M tokens of
  // genuine cache. Writing 0/0 for them — which the first cut of this WP did — asserts "this run had
  // no cache" about a run that plainly did, and mislabels its economics too, since a cache READ is a
  // 0.1x discount and a cache WRITE a 1.25x premium. The merged number survives; the split does not
  // get invented.
  const db = createDatabase();
  seedParents(db, "test-3", "scn-3");
  const runId = "run-cache-merged";

  const repo = new RunRepository(db);
  repo.createRun(runId, { testId: "test-3", scenarioId: "scn-3", mode: "automated" });
  const manager = new RunManager(repo);
  manager.create(runId);

  // A persisted step in the historical shape: merged only.
  manager.emit(runId, {
    type: "step",
    step: {
      id: "s:acct:0",
      index: 0,
      type: "llm_response",
      label: "turn 1",
      status: "ok",
      profileTokens: {},
      usageActual: { inputTokens: 107138, outputTokens: 300, cachedInputTokens: 107133 },
      payload: {},
    },
  });
  // …and the kpi an older/replaying emitter produces for it: merged present, halves absent.
  manager.emit(runId, {
    type: "kpi",
    turns: 1,
    toolCalls: 0,
    tokensIn: 107138,
    tokensOut: 300,
    contextTokens: 107138,
    costUsd: 0.02,
    cachedTokens: 107133,
  });
  manager.emit(runId, { type: "status", status: "completed", outcome: "completed" });
  await new Promise((resolve) => setImmediate(resolve));

  const detail = repo.getRun(runId);
  assert.equal(detail.cachedTokens, 107133, "the merged figure survives — it is real information");
  assert.equal(detail.cacheReadTokens, undefined, "the split is UNKNOWN, not zero");
  assert.equal(detail.cacheWriteTokens, undefined);

  const row = db
    .prepare("SELECT cache_read_tokens AS r, cache_write_tokens AS w FROM runs WHERE id = ?")
    .get(runId) as { r: number | null; w: number | null };
  assert.deepEqual(row, { r: null, w: null }, "SQL NULL on the row too");
});
