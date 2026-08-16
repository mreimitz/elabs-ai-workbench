# WP 0.4 — Database schema (new tables)

**Phase:** 0 · **Size:** M · **Depends on:** 0.3

## Objective
Persist provider credentials, scenarios, tests, and full replayable runs. Decision #8 = full replay.

## Why / references
Data-model sketch in [`../../09-testing.md`](../../09-testing.md) §8; existing model in
[`../../03-data-model.md`](../../03-data-model.md). Follow the **idempotent append** rule in
`conventions.md` — add `CREATE TABLE IF NOT EXISTS` blocks, never rewrite existing ones.

## Files
- `apps/api/src/db/schema.ts` *(modify — append the SQL below to `schemaSql`)*
- `apps/api/src/db/rows.ts` *(modify — add row types + mappers for each table)*

## Design — DDL (append to `schemaSql`)
```sql
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama')),
  label TEXT NOT NULL,
  base_url TEXT,
  api_key_encrypted TEXT,            -- enc:v1:…  (SecretStore); never returned
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  model TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL DEFAULT '',
  default_profiles_json TEXT NOT NULL DEFAULT '[]',
  guardrails_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_servers (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  allowed_tools_json TEXT,           -- NULL = all tools allowed
  PRIMARY KEY (scenario_id, server_id)
);

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  system_prompt_override TEXT,
  added_profiles_json TEXT NOT NULL DEFAULT '[]',
  assertions_json TEXT,              -- reserved (phased)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_attachments (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('file','image','text')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,                -- DATA_DIR/attachments/<id>
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('automated','interactive')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','stopped','error','aborted')),
  outcome TEXT,
  stop_reason TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  turns INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  peak_context_tokens INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_request','llm_response','tool_call','tool_result','context_event')),
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  server_id TEXT,
  tool_name TEXT,
  profile_tokens_json TEXT NOT NULL DEFAULT '{}',
  usage_actual_json TEXT,
  context_snapshot_json TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'    -- REDACTED (WP 1.6)
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_test_started ON runs(test_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_idx ON run_steps(run_id, idx ASC);
CREATE INDEX IF NOT EXISTS idx_run_events_run_idx ON run_events(run_id, idx ASC);
CREATE INDEX IF NOT EXISTS idx_scenario_servers_scenario ON scenario_servers(scenario_id);
```

## Implementation steps
1. Append the DDL to the `schemaSql` template literal in `db/schema.ts` (after the existing tables).
2. Add row interfaces + `mapXRow()` mappers in `db/rows.ts` mirroring the existing ones (parse JSON
   columns with the `SecretStore.readJson`/`stableStringify` helpers where relevant).
3. Boot the API on a fresh DB and confirm tables/indexes are created; boot on an existing DB and
   confirm no errors (idempotent).

## Acceptance
- Fresh DB: all tables + indexes exist (`PRAGMA table_info`). Existing tables untouched.
- A repo round-trip test inserts and reads back one row per new table.
- `pnpm typecheck && pnpm test && pnpm build` green.

## Notes
- `provider_credentials.api_key_encrypted` is the **only** place a provider key lives, encrypted
  (WP 1.1). `ON DELETE RESTRICT` on `scenarios.provider_id` prevents orphaning a scenario's provider.
