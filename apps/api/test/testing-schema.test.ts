import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type {
  ProviderCredentialRow,
  RunEventRow,
  RunRow,
  RunStepRow,
  ScenarioRow,
  ScenarioServerRow,
  TestAttachmentRow,
  TestRow,
} from "../src/db/rows.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  // Mirror the app (apps/api/src/db/database.ts) which sets foreign_keys = ON.
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function tableColumns(db: AppDatabase, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function tableExists(db: AppDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

function indexExists(db: AppDatabase, index: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(index) as { name: string } | undefined;
  return row !== undefined;
}

const EXPECTED_COLUMNS: Record<string, string[]> = {
  provider_credentials: [
    "id",
    "kind",
    "label",
    "base_url",
    "api_key_encrypted",
    "created_at",
    "updated_at",
  ],
  scenarios: [
    "id",
    "name",
    "provider_id",
    "model",
    "params_json",
    "system_prompt",
    "default_profiles_json",
    "guardrails_json",
    "tool_loading_mode",
    "created_at",
    "updated_at",
  ],
  scenario_servers: ["scenario_id", "server_id", "allowed_tools_json"],
  tests: [
    "id",
    "name",
    "user_prompt",
    "system_prompt_override",
    "added_profiles_json",
    "assertions_json",
    // Benchmarks (WP 1.1) — additive graded-tests columns.
    "expectations_json",
    "category",
    "difficulty",
    "tags_json",
    // Benchmarks (WP 4.1, B10) — additive collection-membership columns.
    "collection_id",
    "external_key",
    // Observability (WP4.1) — additive draft flag (promote_to_test).
    "draft",
    "created_at",
    "updated_at",
  ],
  test_attachments: ["id", "test_id", "kind", "name", "path", "bytes", "created_at"],
  runs: [
    "id",
    "test_id",
    "scenario_id",
    "mode",
    "status",
    "outcome",
    "stop_reason",
    "started_at",
    "duration_ms",
    "turns",
    "tool_calls",
    "peak_context_tokens",
    "tokens_in",
    "tokens_out",
    "cached_tokens",
    "cost_usd",
    "error_message",
    "assertion_results_json",
    // Benchmarks (WP 3.1, B7) — additive suite-linkage columns (denormalized; NOT FKs).
    "suite_run_id",
    "repetition",
    // Auto-Rating (rating visibility, v27) — the additive post-terminal review axis (AR11).
    "rating_state",
    // Claude subscription (WP 3.1, D-CS4/D-CS8, v29) — additive cost BASIS ('subscription_reference'
    // for a claude_subscription run's shadow price, NULL/'api_exact' otherwise).
    "cost_basis",
    // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6, v31) — additive session-lifecycle columns.
    "phase",
    "stop_reason_code",
    "ended_at",
    "seen",
    "capabilities_json",
    "active_duration_ms",
    "total_duration_ms",
    // Observability (planning/Roadmap/RM-17-observability/, WP1.6, v35) — additive retention-classes column: a
    // pinned run is NEVER pruned by POST /api/maintenance/prune-runs.
    "pinned",
    // Observability (planning/Roadmap/RM-17-observability/, WP3.3, v42) — additive fork-lineage columns: a DERIVED
    // run records the parent it was forked FROM and the step it was forked AT.
    "derived_from_run_id",
    "fork_step_id",
    // RM-33 (planning/Roadmap/RM-33-cache-aware-token-accounting/, WP 1.2, v59) — the read/write halves of
    // `cached_tokens`. Nullable: NULL means the split is UNKNOWN (a run persisted before v59), never
    // "no cache" — the metrics layer excludes an unknown run rather than averaging a fabricated zero.
    "cache_read_tokens",
    "cache_write_tokens",
  ],
  run_steps: [
    "id",
    "run_id",
    "idx",
    "type",
    "label",
    "status",
    "duration_ms",
    "server_id",
    "tool_name",
    "profile_tokens_json",
    "usage_actual_json",
    "context_snapshot_json",
    "cumulative_tokens",
    // F2 — per-turn assistant prose + reasoning, settled on the llm_response step (redacted on write).
    "assistant_text",
    "reasoning_text",
    // Engine-authored assistant-turn ordinal shared by a turn's steps (deterministic turn grouping).
    "turn_index",
    // Byte size of a tool_call result payload — drives the byte-cap SESSION_TOOL_RESULT_SIZE.
    "result_bytes",
    // Track E — per-step wall-clock timing (Gantt foundation; findings/09 §3).
    "started_at",
    "ended_at",
    "payload_json",
    // Observability WP3.1 (D-OB17) — step-hierarchy metadata (parentStepId link + span-kind role).
    "parent_step_id",
    "span_kind",
  ],
  run_events: ["id", "run_id", "idx", "type", "payload_json", "created_at"],
};

const EXPECTED_INDEXES = [
  "idx_runs_test_started",
  "idx_runs_scenario",
  "idx_run_steps_run_idx",
  "idx_run_events_run_idx",
  "idx_scenario_servers_scenario",
];

test("fresh DB creates all 8 new tables with their expected columns", () => {
  const db = createDatabase();

  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    assert.equal(tableExists(db, table), true, `table ${table} should exist`);
    assert.deepEqual(tableColumns(db, table), columns, `columns of ${table}`);
  }
});

test("fresh DB creates the 5 new indexes", () => {
  const db = createDatabase();

  for (const index of EXPECTED_INDEXES) {
    assert.equal(indexExists(db, index), true, `index ${index} should exist`);
  }
});

test("existing tables and indexes remain untouched", () => {
  const db = createDatabase();

  for (const table of [
    "mcp_servers",
    "mcp_oauth_credentials",
    "mcp_oauth_flows",
    "mcp_scans",
    "mcp_tool_scans",
    "scan_events",
  ]) {
    assert.equal(tableExists(db, table), true, `existing table ${table} should still exist`);
  }
  for (const index of [
    "idx_mcp_scans_server_scanned_at",
    "idx_mcp_tool_scans_scan_tokens",
    "idx_scan_events_scan_created",
    "idx_mcp_oauth_flows_server",
  ]) {
    assert.equal(indexExists(db, index), true, `existing index ${index} should still exist`);
  }
});

test("inserts and reads back one row per new table respecting FK ordering", () => {
  const db = createDatabase();

  // provider_credentials (referenced by scenarios)
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES (@id, @kind, @label, @base_url, @api_key_encrypted, @created_at, @updated_at)`,
  ).run({
    id: "prov-1",
    kind: "anthropic",
    label: "Claude",
    base_url: null,
    api_key_encrypted: "enc:v1:abc",
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });
  const providerRow = db
    .prepare("SELECT * FROM provider_credentials WHERE id = 'prov-1'")
    .get() as ProviderCredentialRow;
  assert.deepEqual(providerRow, {
    id: "prov-1",
    kind: "anthropic",
    label: "Claude",
    base_url: null,
    api_key_encrypted: "enc:v1:abc",
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });

  // mcp_servers (existing table; referenced by scenario_servers) — insert before scenario_servers
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'Filesystem', 'stdio', 'npx', '[]', NULL, '{}', '{}', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z')`,
  ).run();

  // scenarios (references provider_credentials)
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, @name, @provider_id, @model, @params_json, @system_prompt, @default_profiles_json, @guardrails_json, @created_at, @updated_at)`,
  ).run({
    id: "scn-1",
    name: "Baseline",
    provider_id: "prov-1",
    model: "claude-opus-4",
    params_json: '{"temperature":0}',
    system_prompt: "You are helpful.",
    default_profiles_json: '["generic_o200k"]',
    guardrails_json: '{"maxTurns":10}',
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });
  const scenarioRow = db.prepare("SELECT * FROM scenarios WHERE id = 'scn-1'").get() as ScenarioRow;
  assert.deepEqual(scenarioRow, {
    id: "scn-1",
    name: "Baseline",
    provider_id: "prov-1",
    model: "claude-opus-4",
    params_json: '{"temperature":0}',
    system_prompt: "You are helpful.",
    default_profiles_json: '["generic_o200k"]',
    guardrails_json: '{"maxTurns":10}',
    // Column default backfills the new tool-loading mode for an insert that omits it.
    tool_loading_mode: "eager",
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });

  // scenario_servers (references scenarios + mcp_servers)
  db.prepare(
    `INSERT INTO scenario_servers (scenario_id, server_id, allowed_tools_json)
     VALUES (@scenario_id, @server_id, @allowed_tools_json)`,
  ).run({ scenario_id: "scn-1", server_id: "srv-1", allowed_tools_json: '["read_file"]' });
  const scenarioServerRow = db
    .prepare("SELECT * FROM scenario_servers WHERE scenario_id = 'scn-1' AND server_id = 'srv-1'")
    .get() as ScenarioServerRow;
  assert.deepEqual(scenarioServerRow, {
    scenario_id: "scn-1",
    server_id: "srv-1",
    allowed_tools_json: '["read_file"]',
  });

  // tests (referenced by test_attachments + runs)
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, system_prompt_override, added_profiles_json, assertions_json, created_at, updated_at)
     VALUES (@id, @name, @user_prompt, @system_prompt_override, @added_profiles_json, @assertions_json, @created_at, @updated_at)`,
  ).run({
    id: "test-1",
    name: "List files",
    user_prompt: "List the files in /tmp",
    system_prompt_override: null,
    added_profiles_json: "[]",
    assertions_json: null,
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });
  const testRow = db.prepare("SELECT * FROM tests WHERE id = 'test-1'").get() as TestRow;
  assert.deepEqual(testRow, {
    id: "test-1",
    name: "List files",
    user_prompt: "List the files in /tmp",
    system_prompt_override: null,
    added_profiles_json: "[]",
    assertions_json: null,
    // Benchmarks (WP 1.1) — additive columns default to NULL / '[]' on an insert that omits them.
    expectations_json: null,
    category: null,
    difficulty: null,
    tags_json: "[]",
    // Benchmarks (WP 4.1) — collection membership columns default to NULL (local-only) on an omitting insert.
    collection_id: null,
    external_key: null,
    // Observability (WP4.1) — the draft flag defaults to 0 (non-draft) on an omitting insert.
    draft: 0,
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });

  // test_attachments (references tests)
  db.prepare(
    `INSERT INTO test_attachments (id, test_id, kind, name, path, bytes, created_at)
     VALUES (@id, @test_id, @kind, @name, @path, @bytes, @created_at)`,
  ).run({
    id: "att-1",
    test_id: "test-1",
    kind: "file",
    name: "spec.txt",
    path: "/data/attachments/att-1",
    bytes: 1234,
    created_at: "2026-06-20T00:00:00.000Z",
  });
  const attachmentRow = db
    .prepare("SELECT * FROM test_attachments WHERE id = 'att-1'")
    .get() as TestAttachmentRow;
  assert.deepEqual(attachmentRow, {
    id: "att-1",
    test_id: "test-1",
    kind: "file",
    name: "spec.txt",
    path: "/data/attachments/att-1",
    bytes: 1234,
    created_at: "2026-06-20T00:00:00.000Z",
  });

  // runs (references tests + scenarios)
  db.prepare(
    `INSERT INTO runs (
       id, test_id, scenario_id, mode, status, outcome, stop_reason, started_at, duration_ms,
       turns, tool_calls, peak_context_tokens, tokens_in, tokens_out, cached_tokens, cost_usd, error_message
     ) VALUES (
       @id, @test_id, @scenario_id, @mode, @status, @outcome, @stop_reason, @started_at, @duration_ms,
       @turns, @tool_calls, @peak_context_tokens, @tokens_in, @tokens_out, @cached_tokens, @cost_usd, @error_message
     )`,
  ).run({
    id: "run-1",
    test_id: "test-1",
    scenario_id: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "ok",
    stop_reason: null,
    started_at: "2026-06-20T00:00:00.000Z",
    duration_ms: 4200,
    turns: 3,
    tool_calls: 2,
    peak_context_tokens: 5000,
    tokens_in: 1200,
    tokens_out: 800,
    cached_tokens: 100,
    cost_usd: 0.0123,
    error_message: null,
  });
  const runRow = db.prepare("SELECT * FROM runs WHERE id = 'run-1'").get() as RunRow;
  assert.deepEqual(runRow, {
    id: "run-1",
    test_id: "test-1",
    scenario_id: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "ok",
    stop_reason: null,
    started_at: "2026-06-20T00:00:00.000Z",
    duration_ms: 4200,
    turns: 3,
    tool_calls: 2,
    peak_context_tokens: 5000,
    tokens_in: 1200,
    tokens_out: 800,
    cached_tokens: 100,
    cost_usd: 0.0123,
    error_message: null,
    // WP 5.1 — additive column; NULL when the run's test declared no assertions.
    assertion_results_json: null,
    // Benchmarks (WP 3.1, B7) — additive columns; NULL for a standalone (non-suite) run.
    suite_run_id: null,
    repetition: null,
    // Auto-Rating (rating visibility, v27) — the review axis; every insert starts 'pending'.
    rating_state: "pending",
    // Claude subscription (WP 3.1, D-CS4/D-CS8, v29) — additive cost BASIS; NULL until a subscription
    // run's terminal kpi stamps 'subscription_reference'.
    cost_basis: null,
    // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6, v31) — additive session-lifecycle columns;
    // NULL/0(false) until the RunManager emit choke point or the /end,/seen routes populate them.
    phase: null,
    stop_reason_code: null,
    ended_at: null,
    seen: 0,
    capabilities_json: null,
    active_duration_ms: null,
    total_duration_ms: null,
    // Observability (planning/Roadmap/RM-17-observability/, WP1.6, v35) — additive retention-classes column;
    // every insert starts unpinned (0/false).
    pinned: 0,
    // Observability (planning/Roadmap/RM-17-observability/, WP3.3, v42) — additive fork-lineage columns; an ordinary
    // (non-forked) run reads them back NULL.
    derived_from_run_id: null,
    fork_step_id: null,
    // RM-33 (WP 1.2, v59) — an inserted run that declared no cache reads them back NULL = "unknown",
    // which is the honest default: nothing has told us about this run's cache either way yet.
    cache_read_tokens: null,
    cache_write_tokens: null,
  });

  // run_steps (references runs)
  db.prepare(
    `INSERT INTO run_steps (
       id, run_id, idx, type, label, status, duration_ms, server_id, tool_name,
       profile_tokens_json, usage_actual_json, context_snapshot_json, cumulative_tokens,
       assistant_text, reasoning_text, turn_index, result_bytes, started_at, ended_at, payload_json
     ) VALUES (
       @id, @run_id, @idx, @type, @label, @status, @duration_ms, @server_id, @tool_name,
       @profile_tokens_json, @usage_actual_json, @context_snapshot_json, @cumulative_tokens,
       @assistant_text, @reasoning_text, @turn_index, @result_bytes, @started_at, @ended_at, @payload_json
     )`,
  ).run({
    id: "step-1",
    run_id: "run-1",
    idx: 0,
    type: "tool_call",
    label: "read_file",
    status: "ok",
    duration_ms: 120,
    server_id: "srv-1",
    tool_name: "read_file",
    profile_tokens_json: '{"generic_o200k":42}',
    usage_actual_json: '{"input":10,"output":5}',
    context_snapshot_json: null,
    cumulative_tokens: 4321,
    // F2 — present on llm_response steps; null on a tool_call step like this one.
    assistant_text: null,
    reasoning_text: null,
    turn_index: 0,
    result_bytes: 8192,
    // Track E — per-step wall-clock timing (ISO; round-tripped verbatim).
    started_at: "2026-06-20T00:00:01.000Z",
    ended_at: "2026-06-20T00:00:01.120Z",
    payload_json: '{"redacted":true}',
  });
  const stepRow = db.prepare("SELECT * FROM run_steps WHERE id = 'step-1'").get() as RunStepRow;
  assert.deepEqual(stepRow, {
    id: "step-1",
    run_id: "run-1",
    idx: 0,
    type: "tool_call",
    label: "read_file",
    status: "ok",
    duration_ms: 120,
    server_id: "srv-1",
    tool_name: "read_file",
    profile_tokens_json: '{"generic_o200k":42}',
    usage_actual_json: '{"input":10,"output":5}',
    context_snapshot_json: null,
    cumulative_tokens: 4321,
    assistant_text: null,
    reasoning_text: null,
    turn_index: 0,
    result_bytes: 8192,
    started_at: "2026-06-20T00:00:01.000Z",
    ended_at: "2026-06-20T00:00:01.120Z",
    payload_json: '{"redacted":true}',
    // Observability WP3.1 (D-OB17) — additive step-hierarchy columns, unset by this INSERT → NULL (flat).
    parent_step_id: null,
    span_kind: null,
  });

  // run_events (references runs)
  db.prepare(
    `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
     VALUES (@id, @run_id, @idx, @type, @payload_json, @created_at)`,
  ).run({
    id: "evt-1",
    run_id: "run-1",
    idx: 0,
    type: "run_started",
    payload_json: '{"mode":"automated"}',
    created_at: "2026-06-20T00:00:00.000Z",
  });
  const eventRow = db.prepare("SELECT * FROM run_events WHERE id = 'evt-1'").get() as RunEventRow;
  assert.deepEqual(eventRow, {
    id: "evt-1",
    run_id: "run-1",
    idx: 0,
    type: "run_started",
    payload_json: '{"mode":"automated"}',
    created_at: "2026-06-20T00:00:00.000Z",
  });
});

test("foreign keys are enforced (scenario requires an existing provider)", () => {
  const db = createDatabase();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
           VALUES ('scn-x', 'Orphan', 'missing-provider', 'm', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z')`,
        )
        .run(),
    /FOREIGN KEY constraint failed/,
  );
});

test("applying schemaSql twice is idempotent (no error)", () => {
  const db = createDatabase();
  assert.doesNotThrow(() => db.exec(schemaSql));
  // The new tables still exist after re-applying.
  for (const table of Object.keys(EXPECTED_COLUMNS)) {
    assert.equal(tableExists(db, table), true, `table ${table} should still exist after re-apply`);
  }
});
