import { RUN_SEARCH_DDL } from "../observability/search.js";

export const schemaSql = `
CREATE TABLE IF NOT EXISTS server_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'production' CHECK (status IN ('production', 'release_candidate', 'beta', 'deprecated')),
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable_http')),
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  env_json TEXT NOT NULL DEFAULT '{}',
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key', 'oauth', 'custom_headers')),
  auth_header_name TEXT,
  type_id TEXT REFERENCES server_types(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_oauth_credentials (
  server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  client_information_json TEXT,
  tokens_json TEXT,
  code_verifier TEXT,
  discovery_state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_oauth_flows (
  state TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS mcp_scans (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  token_profile TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  total_tools INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_raw_bytes INTEGER NOT NULL DEFAULT 0,
  average_tokens_per_tool REAL NOT NULL DEFAULT 0,
  largest_tool_name TEXT,
  largest_tool_tokens INTEGER NOT NULL DEFAULT 0,
  total_resources INTEGER NOT NULL DEFAULT 0,
  total_resource_templates INTEGER NOT NULL DEFAULT 0,
  total_prompts INTEGER NOT NULL DEFAULT 0,
  total_resource_tokens INTEGER NOT NULL DEFAULT 0,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  largest_resource_name TEXT,
  largest_resource_tokens INTEGER NOT NULL DEFAULT 0,
  largest_prompt_name TEXT,
  largest_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  counting_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mcp_tool_scans (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  description TEXT,
  input_schema_json TEXT,
  annotations_json TEXT,
  raw_tool_json TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  name_tokens INTEGER NOT NULL,
  description_tokens INTEGER NOT NULL,
  schema_tokens INTEGER NOT NULL,
  annotations_tokens INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  contribution_percent REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_resource_scans (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('resource', 'template')),
  uri TEXT NOT NULL,
  name TEXT,
  description TEXT,
  mime_type TEXT,
  raw_resource_json TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  uri_tokens INTEGER NOT NULL,
  name_tokens INTEGER NOT NULL,
  description_tokens INTEGER NOT NULL,
  mimetype_tokens INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  contribution_percent REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_prompt_scans (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  prompt_name TEXT NOT NULL,
  description TEXT,
  arguments_json TEXT,
  raw_prompt_json TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  name_tokens INTEGER NOT NULL,
  description_tokens INTEGER NOT NULL,
  arguments_tokens INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  contribution_percent REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_scans_server_scanned_at
  ON mcp_scans(server_id, scanned_at DESC);

-- Observability metrics (WP1.2, D-OB13) — the cross-server time-axis window scan (a range on
-- scanned_at) that GET /api/metrics/scans runs on demand; the server-scoped index above cannot serve a
-- scanned_at range without a leading server_id. Also added by migration v32 for existing DBs (fresh DBs
-- skip migrations — see db/database.ts).
CREATE INDEX IF NOT EXISTS idx_mcp_scans_scanned_at ON mcp_scans(scanned_at);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_scans_scan_tokens
  ON mcp_tool_scans(scan_id, total_tokens DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_resource_scans_scan_tokens
  ON mcp_resource_scans(scan_id, total_tokens DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_prompt_scans_scan_tokens
  ON mcp_prompt_scans(scan_id, total_tokens DESC);

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_created
  ON scan_events(scan_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_flows_server
  ON mcp_oauth_flows(server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  -- Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 0.2, D-CS6): 'claude_subscription' is
  -- admitted here. On an existing DB the CHECK is widened by migration v28's table rebuild (SQLite
  -- cannot ALTER a CHECK in place) and narrowed again by v56's rebuild, which drops the retired
  -- Answers-integration kind. A 'claude_subscription' row never carries an api_key_encrypted value — its
  -- auth resolves from assistant_credentials at run time (D-CS7).
  kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama','claude_subscription')),
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
  tool_loading_mode TEXT NOT NULL DEFAULT 'eager' CHECK (tool_loading_mode IN ('eager', 'deferred')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_servers (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  allowed_tools_json TEXT,           -- NULL = all tools allowed
  PRIMARY KEY (scenario_id, server_id)
);

-- Benchmarks (WP 4.1, B10) — a Collection binds a set of tests/suites to a git repo for team sharing +
-- versioning. Defined before \`tests\`/\`suites\` so their \`collection_id\` FK references it. The PAT is
-- encrypted (SecretStore) and NEVER returned by the API; \`last_synced_sha\` is written by the WP 4.2 git
-- engine (NULL before the first sync). Deleting a collection sets member \`collection_id\` → NULL (the
-- member becomes local-only again — see the FK below).
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  -- Testing IA (WP 1.2, D-T4): the git binding is OPTIONAL — a collection may be LOCAL (no repo). The
  -- three repo columns are all-present-or-all-NULL (enforced app-level, WP 2.1); a bound collection has
  -- all three, a local one has none. Migration v16 makes them nullable on an existing DB.
  repo_url TEXT, repo_path TEXT, branch TEXT,
  pat_encrypted TEXT,                      -- enc:v1:… (SecretStore); NEVER returned
  last_synced_sha TEXT,
  -- Testing IA (WP 1.2, D-T4): exactly one row (the reserved "Local" collection) carries is_default = 1;
  -- it is undeletable + never repo-bound (enforced app-level in WP 2.1). ensureLocalCollection() (db init)
  -- seeds/guarantees it on every startup and re-homes collection-less members to it.
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  system_prompt_override TEXT,
  added_profiles_json TEXT NOT NULL DEFAULT '[]',
  assertions_json TEXT,              -- reserved (phased)
  expectations_json TEXT,            -- Benchmarks B1 ground-truth block (WP 1.1); NULL = behaves as pre-1.1
  category TEXT,                     -- analytics metadata (optional)
  difficulty TEXT,                   -- analytics metadata: 'easy' | 'medium' | 'hard' (optional)
  tags_json TEXT NOT NULL DEFAULT '[]',
  -- Benchmarks (WP 4.1, B10) — collection membership. collection_id NULL = local-only; deleting the
  -- collection sets it back to NULL (member becomes local-only). external_key is the cross-system
  -- identity within that collection (NULL until exported/imported). Additive; existing tests → NULL.
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  external_key TEXT,
  -- Observability (WP4.1) — a DRAFT test (minted only by a watch rule's promote_to_test action).
  -- Additive; INTEGER NOT NULL DEFAULT 0 → every existing test reads back non-draft. Never auto-runs.
  draft INTEGER NOT NULL DEFAULT 0,
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
  -- Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1/WP1.6, D-US2) — 'ended' is the additive terminal
  -- status of an INTERACTIVE session the operator deliberately closed via "End session" (never
  -- fake-'completed', never 'aborted'). Migration v31 widens this CHECK on an existing DB (SQLite
  -- cannot ALTER a CHECK in place — table rebuild, mirrors v5/v28's widening pattern).
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','stopped','error','aborted','ended')),
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
  error_message TEXT,
  -- WP 5.1 — validation-gate assertion results, evaluated from the run's trace alignment on
  -- completion (D4: read-only, no execution). JSON array of AssertionResult; NULL when the test
  -- declared no assertions / the run wasn't evaluated. Additive; migration v11 backfills existing DBs.
  assertion_results_json TEXT,
  -- Benchmarks (WP 3.1, B7) — the suite run this run belongs to (NULL for a standalone run).
  -- INTENTIONALLY NOT a foreign key to suite_runs — same rationale as run_steps.server_id: a run is
  -- immutable HISTORY that must survive suite / suite-run deletion. Deleting a suite cascade-drops its
  -- suite_runs aggregate rows but NEVER the child runs, so a dangling suite_run_id here is expected and
  -- harmless. Additive; migration v14 backfills existing runs to NULL.
  suite_run_id TEXT,
  repetition INTEGER,                -- WP 3.1: 1-based repetition ordinal within the matrix cell (NULL for standalone runs)
  -- Auto-Rating (AR11) — the post-run REVIEW axis (shared RATING_STATES), a separate dimension from
  -- \`status\` (rating never blocks/mutates the terminal status): 'pending' until the review starts,
  -- 'rating' while it runs, then a settled 'rated'/'failed'/'skipped'. Migration v27 backfills
  -- existing DBs (terminal rows -> 'rated' when base-rating grades exist, else 'skipped').
  rating_state TEXT NOT NULL DEFAULT 'pending',
  -- Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 3.1, D-CS4/D-CS8) — HOW this run's
  -- \`cost_usd\` was derived (shared CostBasis). NULL / 'api_exact' = the ordinary, exactly-billed cost
  -- every run before this carried; 'subscription_reference' = a \`claude_subscription\` run's SHADOW
  -- price (exact tokens x the model's list rate; marginal cost \$0 — a reference estimate, not a
  -- charge). Finalized from the run's terminal \`kpi\` \`costBasis\`; the UI/reports label it
  -- "est. · subscription". Additive/nullable; migration v29 backfills existing runs to NULL.
  cost_basis TEXT,
  -- Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — additive session-lifecycle surface. ALL
  -- NULL-safe for every run persisted before this workstream (reads as absent/false, behaves exactly
  -- as before); migration v31 adds these on an existing DB (folded into the same rebuild that widens
  -- the \`status\` CHECK above, mirroring \`widenRunStepsTypeCheck\`'s dynamic-column-copy technique).
  -- Populated by the WP1.6 persistence layer (the RunManager emit choke point + the new /end,/seen
  -- routes) and by the executors (WP1.3/1.4/1.5) once they adopt SessionClock/capabilities:
  --  * phase              — the run's queryable lifecycle phase (RUN_PHASES), mirrors the last
  --                         \`{type:"phase"}\` event that passed through RunManager.emit; NULL = no
  --                         distinct phase (the plain status stands).
  --  * stop_reason_code   — the machine-readable terminal reason (STOP_REASON_CODES), stamped from
  --                         the terminal \`status\` event's \`stopReasonCode\` on finalize; NULL for a
  --                         run terminated before this contract (or by an executor that hasn't
  --                         adopted \`terminalFor\` yet).
  --  * ended_at           — ISO-8601 timestamp the run reached ANY terminal disposition (set by
  --                         \`finalize()\` on every terminal status, not just 'ended'); NULL while
  --                         still pending/running.
  --  * seen               — whether the operator has opened/acknowledged this run since it last
  --                         needed attention (needs-attention feed, WP3.3). Defaults false (0); set
  --                         true only via \`POST /api/runs/:id/seen\`.
  --  * capabilities_json  — the backend's SessionCapabilities manifest for this run (JSON), emitted
  --                         at session start by the executor; NULL on a pre-contract run.
  --  * active_duration_ms — wall-clock spent actively working, EXCLUDING waiting_input pauses
  --                         (SessionClock, WP1.2); NULL until an executor supplies it on the emit path.
  --  * total_duration_ms  — total wall-clock from start to terminal, INCLUDING waits; NULL until an
  --                         executor supplies it on the emit path.
  phase TEXT,
  stop_reason_code TEXT,
  ended_at TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT,
  active_duration_ms INTEGER,
  total_duration_ms INTEGER,
  -- Observability (planning/Roadmap/RM-17-observability/, WP1.6) — retention classes: a PINNED run is NEVER pruned by
  -- \`POST /api/maintenance/prune-runs\`, regardless of policy. NOT NULL DEFAULT 0 so every existing run
  -- reads back unpinned; migration v35 adds this on an existing DB (\`ensureColumn\`, the v29 pattern — a
  -- plain additive column, no table rebuild). Makes the WP1.1 \`pinned\` RunFilter placeholder LIVE (see
  -- \`buildRunFilterWhere\` in run-repository.ts / metrics.ts and \`matchesRunFilter\` in shared).
  pinned INTEGER NOT NULL DEFAULT 0,
  -- Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — fork lineage. A DERIVED run (created by
  -- \`POST /api/runs/:id/rerun\`) records the PARENT run it was forked FROM and the parent STEP it was
  -- forked AT (NULL \`fork_step_id\` = a whole-run re-launch). BOTH NULL for an ordinary run. Deliberately
  -- NOT an FK (like \`suite_run_id\`): run history is immutable and must survive the parent's deletion, so
  -- a dangling \`derived_from_run_id\` is expected + harmless. Additive/nullable; migration v42 adds them on
  -- an existing DB (\`ensureColumn\`). Makes the WP1.1 \`derived\` RunFilter placeholder LIVE (default-exclude
  -- = \`derived_from_run_id IS NULL\` in \`buildRunFilterWhere\` / metrics.ts and \`matchesRunFilter\` in shared);
  -- a derived run is NEVER a suite member and is hidden from the runs feed unless \`derived:true\`.
  derived_from_run_id TEXT,
  fork_step_id TEXT,
  -- RM-33 (planning/Roadmap/RM-33-cache-aware-token-accounting/, WP 1.2, D-CT3) — the read/write halves of
  -- \`cached_tokens\` above, which merges a ~0.1x cache-read DISCOUNT with a 1.25x cache-write PREMIUM
  -- into one number that reads as savings either way.
  -- BOTH NULLABLE ON PURPOSE: NULL means "this run predates the split", a state the metrics layer must
  -- be able to EXCLUDE from a bucket rather than average as a fabricated zero (D-CT6). Migration v59
  -- adds them on an existing DB and backfills both from \`run_steps.usage_actual_json\`, which has always
  -- carried the full TokenUsageActual. Appended LAST to mirror v59's \`ensureColumn\` append order (an
  -- upgraded DB gets them here), so \`PRAGMA table_info(runs)\` is identical on both paths — the classic
  -- v-N drift bug, and it is test-pinned.
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER
);

-- Benchmarks (WP 3.1, B7) — suites. A suite is a first-class entity (ordered test membership +
-- default scenario set + execution config); a suite RUN (WP 3.2 orchestrator) is the test × scenario ×
-- repetition matrix executed as ordinary persisted \`runs\` (which carry a denormalized suite_run_id).
-- Deleting a suite cascade-drops its membership + suite_runs aggregate rows, but NEVER the child runs
-- (runs.suite_run_id is deliberately NOT an FK — runs are history). Migration v14 creates these on an
-- existing DB; on a fresh DB the CREATE … IF NOT EXISTS below already made them at the latest shape.
CREATE TABLE IF NOT EXISTS suites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  -- Benchmarks (WP 4.1, B10) — collection membership (same semantics as tests.collection_id/external_key).
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  external_key TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suite_tests (
  suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
  test_id  TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (suite_id, test_id)
);
CREATE TABLE IF NOT EXISTS suite_scenarios (
  suite_id    TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  PRIMARY KEY (suite_id, scenario_id)
);
CREATE TABLE IF NOT EXISTS suite_runs (
  id TEXT PRIMARY KEY,
  -- Testing IA (WP 1.2, D-T5): suite_id is OPTIONAL — interactive/ad-hoc and collection plans execute as
  -- suite-runs with NO owning Suite row (no auto-created Suite). Still FK'd to suites (ON DELETE CASCADE)
  -- so a real suite's runs are cleaned up when it is deleted; NULL for a source that has no suite. Migration
  -- v16 drops the NOT NULL on an existing DB.
  suite_id TEXT REFERENCES suites(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','capped','stopped','error')),
  config_snapshot_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL, ended_at TEXT,
  aggregates_json TEXT,
  -- Testing IA (WP 1.2, D-T5): what launched this suite-run and the inline run-plan it executed.
  source TEXT,          -- 'suite' | 'collection' | 'adhoc' (NULL on pre-v16 rows)
  plan_json TEXT,       -- serialized run-plan for a collection/adhoc source (NULL for a plain suite run)
  -- Auto-Rating (AR11) — the suite-level REVIEW axis (shared RATING_STATES) around the post-finish()
  -- suite-report hook; a separate dimension from \`status\`. Migration v27 backfills existing DBs
  -- (terminal rows -> 'rated' when a suite_run_reports row exists, else 'skipped').
  rating_state TEXT NOT NULL DEFAULT 'pending'
);

-- Auto-Rating (WP 4.1, AR7/AR11/AR12/AR15) — the mandatory cross-run report for a suite run with >= 2
-- members. APPEND-ONLY, latest-per-suite-run wins (mirrors run_grades discipline): report_json holds
-- the serialized SuiteReport (deterministic variance / tool-path / error-clustering now; LLM agreement +
-- narrative + root-cause roll-up filled by WP 4.2). status records honest degradation — 'partial' when
-- a member's rating hadn't landed within the bounded wait, 'error' when generation itself failed (the
-- suite run's own status/aggregates are NEVER touched — AR11). rating_version stamps AUTO_RATING_VERSION
-- (AR15); the judge_* columns are the SEPARATE judge ledger (B5) — 0/null on the deterministic pass, filled
-- by WP 4.2's agreement calls. FK ON DELETE CASCADE ties a report's lifetime to its suite run.
CREATE TABLE IF NOT EXISTS suite_run_reports (
  id                TEXT PRIMARY KEY,
  suite_run_id      TEXT NOT NULL REFERENCES suite_runs(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('ready','partial','error')),
  report_json       TEXT NOT NULL,
  rating_version    INTEGER NOT NULL,
  judge_provider_id TEXT,
  judge_model       TEXT,
  judge_tokens_in   INTEGER NOT NULL DEFAULT 0,
  judge_tokens_out  INTEGER NOT NULL DEFAULT 0,
  judge_cost_usd    REAL NOT NULL DEFAULT 0,   -- SEPARATE judge ledger (B5); 0/null on the deterministic pass
  created_at        TEXT NOT NULL              -- append-only; latest-per-suite-run wins for display
);
CREATE INDEX IF NOT EXISTS idx_suite_run_reports_run ON suite_run_reports(suite_run_id, created_at ASC);

-- Benchmarks (WP 4.1) — the per-collection UNIQUE indexes on (collection_id, external_key) for tests +
-- suites are created by migration v15 (db/database.ts), NOT here. They reference the additive
-- collection_id/external_key columns, which on an UPGRADE from a pre-v15 on-disk DB are added by v15's
-- ensureColumn AFTER schema.ts runs — so creating the index here would fail with "no such column" on
-- the existing (pre-v15) tests table. v15 always runs on a fresh DB too (from user_version 0), so the
-- indexes still exist on a fresh database.

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_request','llm_response','tool_call','tool_result','context_event','user_message')),
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  -- server_id is intentionally NOT a foreign key to mcp_servers (issue #19 cascade review). A run is
  -- an immutable historical transcript: it must survive the later deletion of the server it exercised
  -- (deleting a server should not rewrite or blank out past runs' accounting). server_id here is a
  -- denormalized label reference for display, so a dangling id after a server delete is expected and
  -- harmless. Run deletion cascades the other direction (runs -> run_steps), which is FK-enforced.
  server_id TEXT,
  tool_name TEXT,
  profile_tokens_json TEXT NOT NULL DEFAULT '{}',
  usage_actual_json TEXT,
  context_snapshot_json TEXT,
  cumulative_tokens INTEGER,                 -- WP 5.6: running cumulative context tokens through this step (NULL on older steps)
  assistant_text TEXT,                       -- F2: per-turn assistant prose on llm_response (redacted; NULL on other/older steps)
  reasoning_text TEXT,                       -- F2: per-turn reasoning text on llm_response (redacted; NULL on other/older steps)
  turn_index INTEGER,                        -- engine-authored assistant-turn ordinal shared by a turn's steps (NULL on non-turn/older steps)
  result_bytes INTEGER,                      -- byte size of a tool_call result payload (NULL on non-tool/older steps); drives the byte-cap SESSION_TOOL_RESULT_SIZE
  started_at TEXT,                           -- Track E: per-step wall-clock start (ISO; NULL on non-timed/older steps)
  ended_at TEXT,                             -- Track E: per-step wall-clock end (ISO; NULL on non-timed/older steps)
  payload_json TEXT NOT NULL DEFAULT '{}',   -- REDACTED (WP 1.6)
  -- Observability (WP3.1, D-OB17) — step-hierarchy metadata. BOTH nullable/additive: a step persisted
  -- before WP3.1 has them NULL and renders FLAT (never backfilled). parent_step_id links this step to
  -- an EARLIER run_steps row of the SAME run (validated at persist -- NOT a DB foreign key, mirroring
  -- server_id: a run is immutable history and parent links are app-validated denormalized refs).
  -- span_kind is the tree-role classifier (SPAN_KINDS in shared). Appended LAST to mirror the v37
  -- migration ensureColumn append order (existing DBs get them there); its index lives ONLY in v37.
  parent_step_id TEXT,
  span_kind TEXT
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
-- Observability metrics (WP1.2, D-OB13) — the time-axis window scan (a range on started_at) that GET
-- /api/metrics/runs runs on demand, and the status-scoped variant (errorRate / status filters). Also
-- added by migration v32 for existing DBs (a fresh DB is stamped at LATEST and skips migrations, so both
-- paths must carry these — see db/database.ts).
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started_at);
-- Suite-run member lookup index (runs.suite_run_id, started_at) lives in migration v19, NOT here:
-- suite_run_id is a v14-added column, and schemaSql runs BEFORE v14 on a pre-v14 upgrade (it CREATEs
-- the runs table IF NOT EXISTS, a no-op against the old shape), so an index on it here would fail with
-- "no such column". The migration runs after v14 has added the column (fresh DBs run every migration too).
-- idx_runs_pinned (runs.pinned, WP1.6) is the SAME hazard for the SAME reason — pinned is a v35-added
-- column, so its index lives ONLY in migration v35 (db/database.ts), never here.
-- idx_run_steps_parent_step_id (run_steps.parent_step_id, WP3.1) is the SAME hazard once more —
-- parent_step_id is a v37-added column, so its index lives ONLY in migration v37 (db/database.ts).
CREATE INDEX IF NOT EXISTS idx_run_steps_run_idx ON run_steps(run_id, idx ASC);
CREATE INDEX IF NOT EXISTS idx_run_events_run_idx ON run_events(run_id, idx ASC);
CREATE INDEX IF NOT EXISTS idx_scenario_servers_scenario ON scenario_servers(scenario_id);

-- Benchmarks (WP 1.1) — output-quality grades. Append-only grade history for a run; the latest row
-- per (run_id, grader_id) wins for display. Judge cost is a SEPARATE ledger (judge_*), never folded
-- into runs.cost_usd (B5). A run with no grades behaves exactly as a pre-Benchmarks run.
CREATE TABLE IF NOT EXISTS run_grades (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  grader_id          TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('deterministic','llm')),
  status             TEXT NOT NULL CHECK (status IN ('graded','unevaluable','error')),
  score              REAL,               -- 0–1 normalized; NULL unless graded
  raw_score          REAL,               -- grader-native (e.g. 0–10 judge); NULL otherwise
  method             TEXT NOT NULL,
  reasoning          TEXT,
  evidence_json      TEXT,
  judge_provider_id  TEXT,
  judge_model        TEXT,
  judge_tokens_in    INTEGER NOT NULL DEFAULT 0,
  judge_tokens_out   INTEGER NOT NULL DEFAULT 0,
  judge_cost_usd     REAL NOT NULL DEFAULT 0,   -- SEPARATE grading ledger (B5)
  grading_version    INTEGER NOT NULL,
  created_at         TEXT NOT NULL              -- append-only; latest-per-grader wins for display
);
CREATE INDEX IF NOT EXISTS idx_run_grades_run ON run_grades(run_id, created_at ASC);

-- Benchmarks Phase 6 (WP 6.1, migration v60) — a HUMAN verdict on ONE grade row: "the grader got
-- this right" (agree) / "the grader got this wrong" (disagree), with an optional note. APPEND-ONLY,
-- exactly like the run_grades rows it comments on: a changed mind INSERTs a new row and the newest
-- row per grade_id is what a surface displays. The repository (grading/grade-feedback-repository.ts)
-- exposes no update and no delete at all.
--
-- AR6 — this table is a SEPARATE dimension and NEVER a grade. Nothing in grading/suites/compare
-- reads it; no score, aggregate, meanGrade, passRateAt05 or quality×cost point is derived from it.
-- There is deliberately no column on run_grades pointing here, so a human verdict cannot change
-- what any historical expectation metric means (see the "grades untouched" regression test in
-- apps/api/test/grade-feedback.test.ts).
--
-- Distinct from Observability's run_feedback (D-OB15): that one is a generic score/note on a RUN or
-- STEP and UPSERTS. This one targets a GRADE and appends. The verdict column is a two-value CHECK on
-- purpose — there is no numeric column here that could be mistaken for, or averaged into, a score.
-- ON DELETE CASCADE: deleting a run cascades run_grades, which cascades these.
CREATE TABLE IF NOT EXISTS grade_feedback (
  id          TEXT PRIMARY KEY,
  grade_id    TEXT NOT NULL REFERENCES run_grades(id) ON DELETE CASCADE,
  verdict     TEXT NOT NULL CHECK (verdict IN ('agree','disagree')),
  note        TEXT,
  created_at  TEXT NOT NULL             -- append-only; latest-per-grade wins for display
);
CREATE INDEX IF NOT EXISTS idx_grade_feedback_grade ON grade_feedback(grade_id, created_at ASC);

-- Generic app-settings key/value store. WP 1.3 keeps the default judge (JudgeSettings) here under
-- the 'judge' key. Values are JSON blobs; references only, never key material.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Rating Issues registry (Auto-Rating follow-on, migration v26) — DISTINCT, deduplicated, persistent
-- issues distilled from error_forensics findings against the skills / MCP servers a run used.
-- target_id/target_name are DENORMALIZED (not FK'd) so issue history survives target deletion.
-- Lifecycle: open -> resolved, automatic re-open on re-sighting. judge_provider_id/judge_model stamp
-- the source that last shaped title/summary/draft_fix (NULL = deterministic fallback only).
CREATE TABLE IF NOT EXISTS rating_issues (
  id                 TEXT PRIMARY KEY,
  target_kind        TEXT NOT NULL CHECK (target_kind IN ('skill','mcp_server')),
  target_id          TEXT NOT NULL,
  target_name        TEXT NOT NULL,
  skill_version_id   TEXT,
  title              TEXT NOT NULL,
  summary            TEXT NOT NULL,
  bucket             TEXT NOT NULL,
  fix_target         TEXT NOT NULL,
  draft_fix          TEXT NOT NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  times_seen         INTEGER NOT NULL DEFAULT 1,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  resolved_at        TEXT,
  rating_version     INTEGER NOT NULL,
  judge_provider_id  TEXT,
  judge_model        TEXT,
  -- Fleet issue aggregation (Observability WP5.1, D-OB20). ALL nullable/additive — an ordinary per-run
  -- auto-rating issue leaves them NULL (its behavior is UNCHANGED); a FLEET issue (deterministically
  -- clustered by the sweep) carries them. The DERIVED caches (occurrences/affected_json/trend_json)
  -- are recomputable from runs + grades (see POST /api/issues/rebuild). Declared here in the baseline
  -- (fresh DB) AND added by migration v41 via ensureColumn (existing DB); the cluster INDEX lives ONLY
  -- in the migration (never here) — see the v35 idx_runs_pinned footgun.
  cluster_key         TEXT,                 -- the deterministic cluster identity (NULL = a per-run AR issue)
  cluster_key_version INTEGER,              -- CLUSTER_KEY_VERSION the key was built under (namespacing)
  occurrences         INTEGER,              -- DERIVED: distinct contributing runs (cache of the link rows)
  affected_json       TEXT,                 -- DERIVED: { servers, skills, tests, models } (aggregated)
  lifecycle           TEXT CHECK (lifecycle IN ('open','resolved','regressed')),
  resolution_note     TEXT,                 -- operator disposition on resolve/ignore (not derived)
  trend_json          TEXT                  -- DERIVED: per-UTC-day failure counts (sparkline cache)
);
CREATE INDEX IF NOT EXISTS idx_rating_issues_target ON rating_issues(target_kind, target_id, status);

-- One contributing run of a rating issue. run_id/suite_run_id are DENORMALIZED (not FK'd) so the
-- issue history survives run deletion; the UNIQUE key makes reprocessing a run a strict no-op
-- (an INSERT OR IGNORE on the same issue + run + finding digest never duplicates).
CREATE TABLE IF NOT EXISTS rating_issue_occurrences (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES rating_issues(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  suite_run_id    TEXT,
  finding_digest  TEXT NOT NULL,
  category        TEXT NOT NULL,
  message         TEXT NOT NULL,
  -- Concrete failure evidence (v30): the failing tool, a redacted excerpt of the arguments actually
  -- sent, and the exact error text — so a filed issue shows the real wrong call, not just a category.
  tool_name       TEXT,
  sent_arguments  TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL,
  -- Fleet issue aggregation (Observability WP5.1, D-OB20) — the CONTRIBUTING RUN's terminal timestamp
  -- as recorded by the sweep (NOT the row's insertion time), so the fleet issue's first/last-seen +
  -- per-day trend derive from WHEN the failure happened, and survive the run's later deletion.
  -- Nullable/additive: an auto-rating (non-sweep) occurrence leaves it NULL.
  observed_at     TEXT,
  UNIQUE (issue_id, run_id, finding_digest)
);
CREATE INDEX IF NOT EXISTS idx_rating_issue_occurrences_issue
  ON rating_issue_occurrences(issue_id, created_at ASC);

-- Skills registry (Agent Skills) — content-addressed blob model. See planning/Research/RS-02-skill-registry/outputs/03-data-model.md.
-- The logical skill (stable identity across versions).
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                 -- SKILL.md \`name\` (== skill dir name)
  display_name TEXT NOT NULL,         -- user-facing label (defaults to name)
  slug TEXT NOT NULL UNIQUE,          -- url-safe unique key within the app
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'github')),
  description TEXT,                    -- cached from the current version's frontmatter
  current_version_id TEXT REFERENCES skill_versions(id) ON DELETE SET NULL,
  -- GitHub binding (NULL for uploads):
  github_repo_url TEXT,
  github_ref TEXT,
  github_subpath TEXT,
  github_auth_ref TEXT,               -- encrypted PAT blob (SecretStore); never returned
  github_last_sha TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- An immutable snapshot of the skill's folder tree.
CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,               -- 1,2,3… monotonic per skill
  version_label TEXT NOT NULL,        -- metadata.version || git short-sha || "v{seq}"
  tree_sha TEXT NOT NULL,             -- sha256 over the sorted (path, blob_sha) list
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'github')),
  source_ref TEXT,                    -- upload filename | git commit sha
  manifest_json TEXT NOT NULL DEFAULT '{}',
  manifest_valid INTEGER NOT NULL DEFAULT 1,
  manifest_errors_json TEXT NOT NULL DEFAULT '[]',
  token_profile TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  l1_metadata_tokens INTEGER NOT NULL DEFAULT 0,
  l2_body_tokens INTEGER NOT NULL DEFAULT 0,
  l3_resource_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  imported_from TEXT NOT NULL CHECK (imported_from IN ('upload', 'github-pull')),
  note TEXT,
  intent_log_json TEXT,               -- Skill IDE WP 9.1 (I10.3): the live-draft save's op intent log (audit)
  created_at TEXT NOT NULL,
  UNIQUE (skill_id, seq)
);

-- Deduplicated file contents (content-addressed).
CREATE TABLE IF NOT EXISTS skill_blobs (
  sha256 TEXT PRIMARY KEY,
  content BLOB NOT NULL,              -- raw bytes (text or binary)
  size INTEGER NOT NULL,
  is_binary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- The path→blob map for a version, plus per-file metrics.
CREATE TABLE IF NOT EXISTS skill_files (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,                 -- posix path relative to skill root
  blob_sha TEXT NOT NULL REFERENCES skill_blobs(sha256),
  size INTEGER NOT NULL,
  is_binary INTEGER NOT NULL DEFAULT 0,
  is_skill_md INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('skill_md','reference','script','asset','other')),
  token_total INTEGER NOT NULL DEFAULT 0,
  UNIQUE (version_id, path)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_seq ON skill_versions(skill_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_skill_files_version ON skill_files(version_id, path ASC);
CREATE INDEX IF NOT EXISTS idx_skill_files_blob ON skill_files(blob_sha);

-- Skills attached to a test scenario (Phase 2 — WP 2.1). Mirrors scenario_servers, adding the one
-- thing servers lack: version selection (auto-\`latest\` or a \`pinned\` fixed version). See
-- planning/Research/RS-02-skill-registry/outputs/03-data-model.md + 08-scenario-attachment.md.
CREATE TABLE IF NOT EXISTS scenario_skills (
  scenario_id       TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  skill_id          TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version_mode      TEXT NOT NULL DEFAULT 'latest' CHECK (version_mode IN ('latest','pinned')),
  pinned_version_id TEXT REFERENCES skill_versions(id) ON DELETE CASCADE,
  -- Eager toggle (WP 2.3): 1 = additionally inline the full SKILL.md body up front. Off by default.
  eager             INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scenario_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_scenario_skills_skill ON scenario_skills(skill_id);

-- Skills a run RESOLVED at run time (SkillFlow — WP 2.1). \`resolveAllowedSkills\` picks a concrete
-- version per attachment at run start (latest → the skill's current version; pinned → a fixed id);
-- this table records that resolution so Trace Mode can list "runs that exercised this skill version".
-- One row per resolved attachment (PRIMARY KEY(run_id, skill_id)).
--
-- skill_id / skill_version_id are DENORMALIZED references, intentionally NOT foreign-keyed to
-- skills / skill_versions — same rationale as run_steps.server_id: a run is an immutable historical
-- transcript that must survive the later deletion of the skill it exercised (deleting a skill must
-- not rewrite or blank out past runs' history). A dangling id after a skill/version delete is
-- expected and harmless; version_label is a denormalized display label so the run's history stays
-- readable even once the version row is gone. Run deletion cascades the other direction
-- (runs -> run_skills), which IS FK-enforced.
CREATE TABLE IF NOT EXISTS run_skills (
  run_id           TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  skill_id         TEXT NOT NULL,        -- denormalized (see comment above); NOT FK'd to skills
  skill_version_id TEXT NOT NULL,        -- denormalized; the concrete resolved version, NOT FK'd
  version_label    TEXT NOT NULL DEFAULT '', -- denormalized display label (survives version deletion)
  eager            INTEGER NOT NULL DEFAULT 0, -- 1 = the attachment inlined the full SKILL.md body (WP 2.3)
  PRIMARY KEY (run_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_run_skills_version ON run_skills(skill_version_id);

-- Per-skill server bindings (Skill IDE WP 8.1 / I9.1). A skill's PORTABLE frontmatter \`servers:\`
-- name list is resolved to EXACT registered servers here: (skill, server_name) -> registered
-- server_id, editable in a picker. server_id is NULLable — an honest "unbound" state (no registered
-- server chosen / matched) rather than a guess. skill_id CASCADE-deletes with its skill; server_id
-- SET NULL when the referenced server is deleted (the binding survives as unbound, not dangling).
CREATE TABLE IF NOT EXISTS skill_server_bindings (
  skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  server_id   TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
  PRIMARY KEY (skill_id, server_name)
);

-- RM-30 WP 7.8 (design decision 5, migration v62) — where the author dragged each box on the skill
-- canvas. Kept HERE and not in SKILL.md, deliberately: SKILL.md's body is what the model reads and
-- this app meters it as the L2 footprint, so a position comment would be invisible to a reader and
-- fully visible to the tokenizer. A tool whose purpose is measuring context cost must not inflate
-- that cost to store cosmetics. (Two further consequences ruled the in-file option out: every
-- version is an immutable snapshot, so nudging a box would either dirty the draft or be discarded;
-- and layout churn would show up in every version diff.)
--
-- Keyed per SKILL, not per version, so an arrangement survives saving a new version. Node ids are
-- DERIVED from the document, so restructuring a skill orphans some rows — an orphan is simply not
-- found at read time and that ONE box falls back to automatic layout. Nothing prunes them: they are
-- a few bytes each, and a row that looks orphaned today comes back to life if the heading returns.
CREATE TABLE IF NOT EXISTS skill_box_positions (
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, node_id)
);

-- NOTE: the external Claude Code session-log tables (session_traces + session_trace_events, WP 3.1)
-- were removed by owner decision 2026-07-03 — Trace Mode sources are ONLY this app's own test runs.
-- A fresh DB never creates them (they are absent here); an existing DB drops them via migration v12
-- (see db/database.ts). The trace-event vocabulary, markers, and aligner stay source-agnostic.

-- Assistant (WP 0.1, migration v20) — embedded Claude agent chat (planning/Roadmap/RM-02-assistant/00-plan.md §4).
-- One stored credential (D-AS1/D-AS2). Only kind = 'claude_oauth' is written today; the API-key
-- fallback REFERENCES an existing provider_credentials row (kind 'anthropic') and is never
-- duplicated here. token_encrypted is SecretStore-encrypted (enc:v1:…) and NEVER returned by any
-- route — only the repository's INTERNAL-ONLY getDecrypted() reads it back to plaintext.
CREATE TABLE IF NOT EXISTS assistant_credentials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claude_oauth')),
  token_encrypted TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- One chat thread. entity_kind/entity_id are the OPTIONAL pin to an app entity (D-AS15 — "threads
-- pinned to the current entity" in the dock's thread switcher); both NULL for a thread opened from
-- the global dock. sdk_session_id is the Agent SDK's own session id, persisted so a parked/idle
-- thread can resume (D-AS6) — NULL until the first turn completes. auto_accept is the per-thread
-- write-approval toggle (D-AS4; default OFF — deletes always ask regardless of this flag).
CREATE TABLE IF NOT EXISTS assistant_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  entity_kind TEXT,
  entity_id TEXT,
  model TEXT NOT NULL,
  auth_source TEXT NOT NULL CHECK (auth_source IN ('subscription', 'api_key')),
  sdk_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
  auto_accept INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_threads_entity
  ON assistant_threads(entity_kind, entity_id, updated_at DESC);

-- Append-only, per-thread REPLAYABLE event log — the settled AssistantEvent vocabulary only
-- (streaming text deltas are never persisted; see types.ts AssistantEvent). seq is a PER-THREAD
-- monotonic ordinal (1, 2, 3…), enforced by the UNIQUE constraint below — mirrors run_events.idx.
CREATE TABLE IF NOT EXISTS assistant_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (thread_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_assistant_events_thread_seq ON assistant_events(thread_id, seq ASC);

-- Assistant sign-in settings (WP 0.2, migration v21) — a single-row (id = 1) config table for the
-- API-key FALLBACK pointer (D-AS14). It stores only a REFERENCE to an existing provider_credentials
-- row (kind 'anthropic'); the key itself is never duplicated here. ON DELETE SET NULL auto-clears the
-- fallback if that provider credential is later deleted, so status can never point at a dangling row.
CREATE TABLE IF NOT EXISTS assistant_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fallback_provider_credential_id TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL,
  updated_at TEXT
);

-- Observability — saved views (WP1.4): name + reuse ANY RunFilter, selectable in the runs feed
-- (WP2.3, later) and referenced by deep links. A view stores the FILTER — it NEVER snapshots
-- results (derived-never-authoritative doctrine); re-running one re-executes \`filter_json\` fresh
-- through GET /api/runs. \`filter_json\` is validated against the shared RunFilter zod schema on
-- write (apps/api/src/observability/views.ts); \`columns_json\`/\`sort_json\` are presentation hints
-- the web owns — opaque to the API beyond a byte-size cap. Case-insensitive UNIQUE name
-- (server_types pattern) backstops the repository's pre-check against a race.
CREATE TABLE IF NOT EXISTS run_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  filter_json TEXT NOT NULL,
  columns_json TEXT,
  sort_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Observability — human feedback (WP1.5, D-OB15): a GENERIC score/note primitive on a run or one of
-- its steps (turns), STRICTLY SEPARATE from grading (AR6) — nothing in grading/suites/compare reads
-- this table (see apps/api/test/run-feedback.test.ts's separation regression test). Default key
-- 'verdict' with score -1/+1 for thumbs; arbitrary keys are allowed (rubric use, WP4.5). \`source\`
-- distinguishes a human-entered row from a future rule-written one ('auto' is unwired today — every
-- row the API currently writes is 'human'). \`step_id\` scopes feedback to one run_steps row (NULL =
-- run-level); the API additionally validates a given step_id belongs to the SAME run (the FK alone
-- can't express that cross-column constraint). Upsert identity (run_id, step_id, key, source) is
-- enforced in APPLICATION code (observability/feedback.ts), not a UNIQUE index — SQLite's NULL != NULL
-- semantics would let a UNIQUE(run_id, step_id, key, source) silently admit duplicate run-level
-- (step_id IS NULL) rows for the same key.
CREATE TABLE IF NOT EXISTS run_feedback (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES run_steps(id) ON DELETE CASCADE,
  key TEXT NOT NULL DEFAULT 'verdict',
  score REAL,
  comment TEXT,
  source TEXT NOT NULL CHECK (source IN ('human','auto')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_feedback_run_id ON run_feedback(run_id);
CREATE INDEX IF NOT EXISTS idx_run_feedback_run_key ON run_feedback(run_id, key);

-- Observability — watch rules (WP4.1, D-OB19/D-OB21): "when a run matches filter F, do action A",
-- evaluated at the ONE post-terminal choke point. Rules are strictly POST-HOC OBSERVERS — an action
-- can NEVER mutate a run's lifecycle/totals/grades or block the run pipeline. filter_json reuses the
-- shared RunFilter grammar; actions_json is the CLOSED, zod-validated action set. sample (0..1) is a
-- deterministic per-(rule,run) hash gate. window_json holds the WP4.2 windowed threshold config (NULL
-- for on_terminal); last_evaluated_at is the WP4.2 boot-catch-up baseline (added by the v39 migration
-- for existing DBs). The three tables' DDL is IDENTICAL to the v38 migration up (all brand-new tables —
-- safe in both schema.ts baseline AND the migration; no "column doesn't exist yet" ordering hazard).
CREATE TABLE IF NOT EXISTS watch_rules (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  trigger           TEXT NOT NULL CHECK (trigger IN ('on_terminal','windowed')),
  filter_json       TEXT NOT NULL,
  sample            REAL,             -- 0..1 deterministic sample rate; NULL = always
  window_json       TEXT,             -- WP4.2 windowed threshold config JSON; NULL for on_terminal
  actions_json      TEXT NOT NULL,
  last_evaluated_at TEXT,             -- WP4.2 — end (grid boundary) of the last window the scheduler evaluated; NULL until first eval
  paused_until         TEXT,          -- AM-OB10 (v61) — paused until this instant; NULL = not paused. PAUSED != DISABLED: a paused rule still evaluates + records state, it only suppresses action dispatch, and the pause expires on its own (no sweep)
  min_interval_minutes INTEGER,       -- AM-OB10 (v61) — minimum minutes between action dispatches for an on_terminal rule; NULL = no limit (the windowed analogue is window_json.cooldownMinutes)
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_rules_enabled ON watch_rules(enabled, trigger);

-- Append-only audit of every rule evaluation that produced an effect: one row per executed action
-- (action = the action type), plus a sampled_out marker row when a matched rule was sampled out.
-- run_id is DENORMALIZED (no FK) so the audit survives run deletion. result_json NEVER carries a
-- secret (no webhook URL) — a redacted { ok, detail?, error? } payload only.
CREATE TABLE IF NOT EXISTS watch_rule_events (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
  run_id      TEXT,
  at          TEXT NOT NULL,
  action      TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_rule_events_rule ON watch_rule_events(rule_id, at);
CREATE INDEX IF NOT EXISTS idx_watch_rule_events_run ON watch_rule_events(run_id);

-- The ENCRYPTED secret store for a webhook action's target URL (WP4.1 — runtime/secret boundary). A
-- webhook action in watch_rules.actions_json holds only an opaque secretRef; the URL is encrypted
-- (SecretStore, the same AES-GCM the provider/MCP secrets use) and stored HERE, keyed by that ref, so
-- it NEVER lands in watch_rules, a response, or a log. Cascade-deleted with its owning rule.
CREATE TABLE IF NOT EXISTS watch_secrets (
  ref             TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
  encrypted_value TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_secrets_rule ON watch_secrets(rule_id);

-- Observability — notification center (WP4.3, D-OB19): the persistent record the \`notify\` watch
-- action writes to (unblocking the WP4.1 inert seam). ONE row per fired \`notify\` action. \`link_path\`/
-- \`rule_id\`/\`run_id\` are DENORMALIZED (no FK) so a notification survives rule/run deletion — the same
-- "audit outlives its subject" discipline as watch_rule_events.run_id. \`read\`/\`late\` are booleans
-- stored as 0/1 (\`late\` = a windowed rule's boot-catch-up fire, "while you were away").
CREATE TABLE IF NOT EXISTS notifications (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,
  severity  TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  link_path TEXT,
  rule_id   TEXT,
  run_id    TEXT,
  read      INTEGER NOT NULL DEFAULT 0,
  late      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_at ON notifications(at);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

-- Observability — scheduled digest report (WP5.5, D-OB22, migration v43): ONE row per generated
-- digest (append-only — never updated/deleted except by prune). \`report_json\` holds the whole
-- serialized DigestReport (headline + issues + movers + notable runs + scan movers) — every number in
-- it was DELEGATED to the WP1.2 metrics services + the WP5.1 issues registry at generation time (the
-- composer only arranges; see reports/digest.ts). \`window_kind\`/\`window_from\`/\`window_to\` are the
-- report's own window (denormalized off report_json for cheap listing/scheduling queries without a
-- JSON parse); \`late\` mirrors the windowed watch-rule flag (D-OB19) — set only on a scheduler
-- boot-catch-up generation, never on a manual \`POST /api/reports/digest/generate\`. Brand-new table:
-- SAFE in both this baseline (a fresh DB) and the v43 migration (an upgrade path) — the v40
-- notifications pattern, no "column doesn't exist yet" ordering hazard.
CREATE TABLE IF NOT EXISTS digest_reports (
  id           TEXT PRIMARY KEY,
  window_kind  TEXT NOT NULL CHECK (window_kind IN ('daily','weekly')),
  window_from  TEXT NOT NULL,
  window_to    TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  late         INTEGER NOT NULL DEFAULT 0,
  report_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_digest_reports_kind_window ON digest_reports(window_kind, window_to);
CREATE INDEX IF NOT EXISTS idx_digest_reports_generated_at ON digest_reports(generated_at);

-- Observability — DB-backed model pricing map (WP2.6, D-OB22, migration v44): editable per-model
-- prices (USD per 1M tokens) so pricing no longer requires a code edit. Seeded from the code table
-- (\`providers/pricing.ts\` MODEL_PRICING) at migration time; \`source\` distinguishes a read-only
-- \`seed\` row from an owner-added \`user\` row (a newer user row OVERRIDES a seed). \`model_match\` is an
-- exact model id or — when \`is_regex\` — a regex source; resolution (\`PricingRepository.resolve\`)
-- picks the most-specific match (exact > regex) whose \`effective_from <= at\`, newest winning, so a
-- future-dated row is inert until its date. \`cache_write_per_mtok\` NULL => the write rate derives
-- from the input rate. Brand-new table: SAFE in both this baseline (a fresh DB) and the v44 migration
-- (an upgrade path) — the v40/v43 pattern, no "column doesn't exist yet" ordering hazard. The SEED
-- rows are inserted by the migration (data, not DDL), never here.
CREATE TABLE IF NOT EXISTS model_pricing (
  id                   TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  model_match          TEXT NOT NULL,
  is_regex             INTEGER NOT NULL DEFAULT 0,
  input_per_mtok       REAL NOT NULL,
  output_per_mtok      REAL NOT NULL,
  cache_read_per_mtok  REAL,
  cache_write_per_mtok REAL,
  effective_from       TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  source               TEXT NOT NULL CHECK (source IN ('seed','user'))
);
CREATE INDEX IF NOT EXISTS idx_model_pricing_match ON model_pricing(model_match);
CREATE INDEX IF NOT EXISTS idx_model_pricing_source ON model_pricing(source);

-- Observability — custom chart composer (WP2.7, D-OB22, migration v45): user-defined charts on the
-- Testing dashboard — measure(s) [same-unit constraint] + filter/groupBy/bucket + chart type,
-- persisted + cloneable. \`config_json\` is a validated DashboardChartConfig (the shared
-- \`dashboardChartConfigSchema\`, apps/api/src/observability/dashboard-charts.ts) — same-unit
-- multi-measure ONLY; the composer renders ONLY what /api/metrics/* already returns (no client-side
-- aggregation). \`position\` is a dense 0..N-1 display order. Brand-new table: SAFE in both this
-- baseline (a fresh DB) and the v45 migration (an upgrade path) — the v40/v43/v44 pattern, no "column
-- doesn't exist yet" ordering hazard.
CREATE TABLE IF NOT EXISTS dashboard_charts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  config_json TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_charts_position ON dashboard_charts(position);

-- Observability — review queue lite (WP4.5, D-OB22, migration v46): a persisted, named RUBRIC for
-- structured human review — a checklist of keys, each \`thumbs\`/\`scale5\`/\`note\`
-- (\`keys_json\`, a validated ReviewRubricKeyDef[] — apps/api/src/observability/rubrics.ts). A "review
-- session" itself is DELIBERATELY EPHEMERAL (a source RunFilter/saved view + a rubric, picked at
-- review time in the web UI) — NOT a new persisted entity; only the rubric lives here. Every verdict a
-- reviewer records is written through the EXISTING WP1.5 \`run_feedback\` table (source='human', key =
-- the rubric key's own name) — this table carries NO feedback data of its own, and grading/suites/
-- compare stay untouched (D-OB15/AR6 — see the WP1.5 separation regression test, which this WP does
-- not modify). Case-insensitive UNIQUE name (server_types/run_views/dashboard_charts pattern). Brand-
-- new table: SAFE in both this baseline (a fresh DB) and the v46 migration (an upgrade path) — the
-- v40/v43/v44/v45 pattern, no "column doesn't exist yet" ordering hazard.
CREATE TABLE IF NOT EXISTS review_rubrics (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  instructions TEXT,
  keys_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.2, migration v47, D-AH1…D-AH20) ------------------------
-- The full-page, multi-model, multi-agent Assistant (\`hub\` domain, D-AH2). 13 BRAND-NEW tables,
-- additive only — nothing above this section is touched, and the hub NEVER writes the testing tables
-- (runs/run_steps/run_events/suites/grading) — see apps/api/src/hub/repository.ts, the only code that
-- touches these tables directly. \`hub_session_skills\` (migration v48, WP2.4) and four additive columns
-- — \`hub_memory.scope\`/\`scope_id\`, \`hub_agents.display_name\`, \`hub_crews.color\`,
-- \`hub_sessions.archived_at\` (migration v49, Assistant Hub UX WP1.0s) — landed later; see each
-- column's own comment below for its rationale.
--
-- hub_sessions REUSES the Unified-Sessions lifecycle vocabulary VERBATIM (D-AH3/§1.2) rather than
-- forking it: status/phase/stop_reason_code/capabilities_json/*_duration_ms/wait_deadline_at/
-- ended_at/seen mirror \`runs\`' columns; \`status\`'s CHECK list is the same RUN_STATUSES snapshot
-- \`runs.status\` carries today. \`phase\`/\`stop_reason_code\` deliberately carry NO CHECK, mirroring
-- \`runs.phase\`/\`runs.stop_reason_code\` — those unions are additive-later and a CHECK would need a
-- SQLite table-rebuild to widen (the exact pain \`runs.status\`'s v31 widening documents).
--
-- hub_events is APPEND-ONLY with a PER-SESSION monotonic \`seq\` (UNIQUE (session_id, seq), mirrors
-- \`assistant_events.seq\`) — a session's full state must be reconstructible from its event log alone
-- (R-SES1, the AG-UI rule). \`type\` carries no CHECK either, mirroring \`run_events\`/\`assistant_events\`
-- not CHECKing \`type\` — the HUB_EVENT_TYPES union is additive-later and validated at the
-- repository/service layer via the shared zod schema, not a DB CHECK.
--
-- FORWARD REFERENCES: \`hub_sessions.mission_id\` -> \`hub_missions(id)\` and
-- \`hub_artifacts.current_version_id\` -> \`hub_artifact_versions(id)\` reference tables defined LATER in
-- this file. SQLite resolves FK targets by name at DML time, not at CREATE TABLE parse time, so a
-- forward reference to a not-yet-created table is legal — verified empirically with better-sqlite3
-- (a child row insert against a not-yet-created parent table fails as expected once both tables
-- exist and a bad reference is inserted; a valid one succeeds). By the time this whole script has
-- run, every table exists.
CREATE TABLE IF NOT EXISTS hub_projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  instructions TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);

-- The role library (D-AH7): a reusable agent definition a mission planner (or the user) can draw
-- from. tool_grants_json is a HubToolGrants blob ({servers: {name -> "all"|string[]}, builtins:
-- string[]}); skill_ids_json is a plain string[] blob.
-- display_name (migration v49, D-HUX8/P2, Assistant Hub UX WP1.0s): an optional persona/display name
-- shown in the workforce UI; the role \`name\` (title) is the fallback. No new avatar column — the avatar
-- reuses the existing \`icon\` field above (P2). Plain nullable TEXT (no CHECK) in BOTH the baseline and
-- the v49 migration \`ensureColumn\` — content is free text, validated only at the zod/app layer.
CREATE TABLE IF NOT EXISTS hub_agents (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  display_name      TEXT,
  description       TEXT,
  icon              TEXT,
  system_prompt     TEXT NOT NULL,
  default_model     TEXT NOT NULL,
  tool_grants_json  TEXT NOT NULL DEFAULT '{"servers":{},"builtins":[]}',
  skill_ids_json    TEXT NOT NULL DEFAULT '[]',
  target            TEXT NOT NULL,
  expected_outcome  TEXT NOT NULL,
  budgets_json      TEXT,
  -- provider_credential_id (migration v55, model identity D-MI1): the provider_credentials row that OWNS
  -- \`default_model\` — WHICH credential runs it, not merely which model id was picked. A model id does not
  -- identify a provider (the Claude subscription reports Anthropic's canonical ids on purpose), so without
  -- this the API re-guessed the provider from the model NAME and could never select the subscription.
  -- NULL ⇒ unpinned (a pre-v55 role, one authored before any credential existed, or one whose credential
  -- was deleted) ⇒ the unchanged name-heuristic fallback. ON DELETE SET NULL, matching hub_sessions below.
  provider_credential_id TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  archived_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_agents_archived ON hub_agents(archived_at);

-- A saved crew (D-AH7): a named team of library roles + per-member overrides, instantiable by the
-- user or a mission planner. members_json is a HubCrewMember[] blob.
-- color (migration v49, D-HUX8, Assistant Hub UX WP1.0s): the crew's optional theme-aware accent — one
-- of the five \`--chart-1…5\` tokens, rendered ONLY as small name-paired accents (avatar ring, card top
-- border, org-chart tint), never a fill or text color, never a raw hex value. The CHECK constraining the
-- admitted values lives ONLY in this baseline DDL (a fresh DB); the v49 migration's \`ensureColumn\` adds
-- the column WITHOUT a CHECK (SQLite's ADD COLUMN cannot carry one cleanly) — the shared zod schema
-- (\`hubCrewColorSchema\`/\`HUB_CREW_COLORS\`) already validates every write at the app layer, the same
-- CHECK-in-baseline-only pattern documented at v23/v28/v31 for other widened/added columns.
CREATE TABLE IF NOT EXISTS hub_crews (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  color        TEXT CHECK (color IS NULL OR color IN ('chart-1','chart-2','chart-3','chart-4','chart-5')),
  -- Optional avatar icon (owner request) — same encoding as hub_agents.icon (lucide/data-URI/none).
  -- Plain nullable TEXT (no CHECK) in BOTH the baseline and the v53 migration's ADD COLUMN.
  icon         TEXT,
  topology     TEXT NOT NULL CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One hub session: a user-facing \`chat\` thread, or an \`agent\` (a mission member — carries
-- parent_session_id + mission_id, D-AH8). See the file-level note above for the lifecycle-column
-- REUSE + forward-reference rationale.
CREATE TABLE IF NOT EXISTS hub_sessions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('chat','agent')),
  parent_session_id   TEXT REFERENCES hub_sessions(id) ON DELETE CASCADE,
  mission_id          TEXT REFERENCES hub_missions(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  title_state         TEXT NOT NULL DEFAULT 'pending' CHECK (title_state IN ('pending','auto','manual')),
  mode                TEXT NOT NULL CHECK (mode IN ('chat','research','mission','auto')),
  topology            TEXT CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
  autonomy            TEXT CHECK (autonomy IN ('always_ask','threshold','auto')),
  crew_id             TEXT REFERENCES hub_crews(id) ON DELETE SET NULL,
  model               TEXT NOT NULL,
  -- provider_credential_id (migration v55, model identity D-MI1): the provider_credentials row this
  -- session's turns actually run on. AUTHORITATIVE when set — the resolver uses exactly this credential
  -- and never re-infers from the model name, which is what routes a claude_subscription session to the
  -- subscription executor instead of the metered Anthropic API key. NULL ⇒ not pinned (a pre-v55 session,
  -- or one whose credential was since deleted) ⇒ the unchanged heuristic. ON DELETE SET NULL — NOT the
  -- Testing feature's RESTRICT: this is a historical REPLAY table, so RESTRICT would make a credential
  -- permanently undeletable once any session had used it.
  provider_credential_id TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','completed','stopped','error','aborted','ended')),
  phase               TEXT,
  stop_reason_code    TEXT,
  capabilities_json   TEXT,
  budgets_json        TEXT,
  prompt_version      TEXT,
  -- tool_scope_json (migration v50, end-user UX pass): the session's MCP tool SCOPE, a HubToolGrants
  -- blob. NULL ⇒ "auto" (every reachable scanned server granted, tool_search discovery — the
  -- Claude-Desktop default). Set once at create via the new-session modal's MCP & tools tab ⇒
  -- "scoped": resolveHubMcpGrants grants only the listed servers/tools. NULL for every pre-v50 session.
  tool_scope_json     TEXT,
  -- roster_json (migration v52, end-user UX pass): the session's Agents & Crews ROSTER, a
  -- HubSessionRoster blob ({crewIds,agentIds}). NULL/absent ⇒ none. A preferred pool fed to the mission
  -- planner (it prefers + hydrates these saved roles, may still expand). NULL for every pre-v52 session.
  roster_json         TEXT,
  cost_usd            REAL NOT NULL DEFAULT 0,
  tokens_in           INTEGER NOT NULL DEFAULT 0,
  tokens_out          INTEGER NOT NULL DEFAULT 0,
  active_duration_ms  INTEGER,
  total_duration_ms   INTEGER,
  wait_deadline_at    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  ended_at            TEXT,
  seen                INTEGER NOT NULL DEFAULT 0,
  archived_at         TEXT
);
-- archived_at (migration v49, D-HUX4/P4, Assistant Hub UX WP1.0s): archive-only soft-hide out of the
-- default Sessions table (mirrors \`hub_agents.archived_at\` — no hard delete this workstream, retention
-- stays a later maintenance feature). The API projects \`archived = archived_at IS NOT NULL\` (HubSession
-- wire field) rather than exposing the timestamp raw. NULL for every session before this WP.
CREATE INDEX IF NOT EXISTS idx_hub_sessions_project_updated ON hub_sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_sessions_kind_updated ON hub_sessions(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_sessions_parent ON hub_sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_hub_sessions_mission ON hub_sessions(mission_id);

-- SESSION-level skill attachment (WP2.4, R-SK1…R-SK3/R-SK8) — mirrors scenario_skills exactly, plus
-- invocation_mode (R-SK3: model_invocable default / user_only / name_only). Whole-list
-- delete-then-reinsert on write (HubRepository.replaceSessionSkills), same as replaceSkills.
CREATE TABLE IF NOT EXISTS hub_session_skills (
  session_id        TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  skill_id          TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version_mode      TEXT NOT NULL DEFAULT 'latest' CHECK (version_mode IN ('latest','pinned')),
  pinned_version_id TEXT REFERENCES skill_versions(id) ON DELETE CASCADE,
  invocation_mode   TEXT NOT NULL DEFAULT 'model_invocable'
                     CHECK (invocation_mode IN ('model_invocable','user_only','name_only')),
  PRIMARY KEY (session_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_session_skills_skill ON hub_session_skills(skill_id);

-- A mission (D-AH6/D-AH8): parented to a chat session; its agents run as child hub_sessions
-- (kind='agent'). plan_json is the HubMissionPlan blob — mutable via plan_updated events up to
-- approval, then FROZEN (app-level discipline, not DB-enforced); agent_session_ids_json is the
-- denormalized string[] mirror of HubMission.agentSessionIds (also derivable via
-- hub_sessions.mission_id — kept for cheap reads).
CREATE TABLE IF NOT EXISTS hub_missions (
  id                       TEXT PRIMARY KEY,
  session_id               TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  status                   TEXT NOT NULL DEFAULT 'proposed'
                            CHECK (status IN ('proposed','approved','running','synthesizing','completed','stopped','failed')),
  topology                 TEXT NOT NULL CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
  autonomy                 TEXT NOT NULL CHECK (autonomy IN ('always_ask','threshold','auto')),
  plan_json                TEXT NOT NULL,
  budgets_json             TEXT,
  cost_usd                 REAL NOT NULL DEFAULT 0,
  agent_session_ids_json   TEXT NOT NULL DEFAULT '[]',
  started_at               TEXT,
  ended_at                 TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  -- Crew nesting (D-CN2/D-CN5/D-CN6): the runtime-recursive-tree lineage. parent_mission_id is the
  -- self-FK to the mission that spawned this one (NULL on a ROOT; ON DELETE CASCADE drops a subtree
  -- without touching siblings); depth is the distance from the root (root = 0); root_mission_id is
  -- the denormalised whole-tree key (a root self-references its own id) for an O(1) getMissionTree
  -- rollup. All nullable/defaulted so pre-nesting rows and callers stay valid; no CHECK on any (the
  -- CHECK-in-baseline-only discipline — there is none to place). The tree is expressed ONLY by
  -- parent_mission_id; every mission keeps session_id = the root chat session (chat propose-gate intact).
  parent_mission_id        TEXT REFERENCES hub_missions(id) ON DELETE CASCADE,
  depth                    INTEGER NOT NULL DEFAULT 0,
  root_mission_id          TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_missions_session ON hub_missions(session_id);

-- Append-only, per-session REPLAYABLE event log (§1.3, R-SES1 — the AG-UI rule: a session's full
-- state is reconstructible from this log alone). seq is a PER-SESSION monotonic ordinal (1, 2, 3…),
-- enforced by UNIQUE (session_id, seq) — mirrors assistant_events.seq / run_events.idx.
CREATE TABLE IF NOT EXISTS hub_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_hub_events_session_seq ON hub_events(session_id, seq ASC);

-- Typed, versioned artifacts (D-AH12). session_id/project_id are each optional (a session-scoped
-- scratch artifact vs. a project-pinned one); current_version_id is a FORWARD reference to
-- hub_artifact_versions (defined below — see the file-level note above).
CREATE TABLE IF NOT EXISTS hub_artifacts (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT REFERENCES hub_sessions(id) ON DELETE SET NULL,
  project_id          TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('markdown','code','html','table','json')),
  title               TEXT NOT NULL,
  latest_version      INTEGER NOT NULL DEFAULT 0,
  current_version_id  TEXT REFERENCES hub_artifact_versions(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_artifacts_session ON hub_artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_hub_artifacts_project ON hub_artifacts(project_id);

-- IMMUTABLE artifact versions (D-AH12) — 1-based, monotonic per artifact; never updated after insert.
CREATE TABLE IF NOT EXISTS hub_artifact_versions (
  id           TEXT PRIMARY KEY,
  artifact_id  TEXT NOT NULL REFERENCES hub_artifacts(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  content      TEXT NOT NULL,
  note         TEXT,
  author_kind  TEXT NOT NULL CHECK (author_kind IN ('user','assistant','agent','system')),
  author_ref   TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (artifact_id, version)
);
CREATE INDEX IF NOT EXISTS idx_hub_artifact_versions_artifact ON hub_artifact_versions(artifact_id, version ASC);

-- Artifact review (D-AH12): a critic (or the user) opens anchored comments against a base version;
-- each comment carries its own accept/reject decision (accept -> a NEW immutable version, app-level).
-- comments_json is a HubReviewComment[] blob.
CREATE TABLE IF NOT EXISTS hub_reviews (
  id             TEXT PRIMARY KEY,
  artifact_id    TEXT NOT NULL REFERENCES hub_artifacts(id) ON DELETE CASCADE,
  base_version   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  reviewer_kind  TEXT NOT NULL CHECK (reviewer_kind IN ('user','assistant','agent','system')),
  reviewer_ref   TEXT,
  comments_json  TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_reviews_artifact ON hub_reviews(artifact_id, created_at ASC);

-- Content-addressed uploads (D-AH12). sha256 is the content identity; dedup-by-content is an
-- APPLICATION-level concern (see hub/repository.ts) — a new upload of already-seen bytes still gets
-- its own row/id so each upload event has independent link/lifecycle history. content is the raw
-- bytes (no separate blob table, unlike skills' skill_blobs — the plan's table list carries content
-- directly on hub_files).
CREATE TABLE IF NOT EXISTS hub_files (
  id          TEXT PRIMARY KEY,
  sha256      TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  filename    TEXT,
  content     BLOB NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_files_sha256 ON hub_files(sha256);

-- A file's link to an app target (D-AH12): upload / project-pinned / assistant-produced. target_id is
-- a DENORMALIZED polymorphic reference (project/session/message/artifact — no single FK could span
-- all four), matching the run_steps.server_id / rating_issue_occurrences.run_id precedent elsewhere
-- in this schema.
CREATE TABLE IF NOT EXISTS hub_file_links (
  id           TEXT PRIMARY KEY,
  file_id      TEXT NOT NULL REFERENCES hub_files(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('upload','pinned','produced')),
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('project','session','message','artifact')),
  target_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_file_links_file ON hub_file_links(file_id);
CREATE INDEX IF NOT EXISTS idx_hub_file_links_target ON hub_file_links(target_kind, target_id);

-- Memory (D-AH11): a VISIBLE, editable store. The assistant may PROPOSE (source
-- 'assistant_proposed', status 'proposed') — never write silently; the user's save moves it to
-- 'active'; either can be 'archived'. Nothing injected is hidden.
-- scope/scope_id (migration v49, D-HUX11, Assistant Hub UX WP1.0s): a memory entry's scope — \`profile\`
-- (global, the DEFAULT so every existing row reads back unchanged) · \`project\` · \`agent\` · \`crew\` —
-- with \`scope_id\` naming the owning project/agent/crew for a scoped entry (NULL for \`profile\`).
-- Most-specific-wins at injection time (app-level, not DB-enforced). The CHECK constraining \`scope\`'s
-- admitted values lives ONLY in this baseline DDL (a fresh DB); the v49 migration's \`ensureColumn\` adds
-- both columns WITHOUT a CHECK (SQLite ADD COLUMN can't cleanly carry one) — the shared zod schema
-- (\`hubMemoryScopeSchema\`/\`HUB_MEMORY_SCOPES\`) already validates every write at the app layer, the same
-- CHECK-in-baseline-only pattern documented at v23/v28/v31/hub_crews.color above.
CREATE TABLE IF NOT EXISTS hub_memory (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('profile','preference','instruction')),
  content     TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('user','assistant_proposed')),
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','archived')),
  scope       TEXT NOT NULL DEFAULT 'profile' CHECK (scope IN ('profile','project','agent','crew')),
  scope_id    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_memory_status ON hub_memory(status);

-- Rolling per-session summary for long threads (D-AH11(b)), marked in-transcript and expandable.
-- upto_seq is the last hub_events.seq the summary covers.
CREATE TABLE IF NOT EXISTS hub_session_summaries (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  upto_seq    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  tokens      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_session_summaries_session ON hub_session_summaries(session_id, upto_seq DESC);

-- Service tokens (planning/Roadmap/RM-08-ci/ WP 1.1, D-C2) — the credential a headless caller (CI, the mcpfp CLI,
-- an external agent on the MCP mount) presents instead of a browser session. Stored HASHED: the
-- plaintext is returned exactly once by POST /api/tokens and is unrecoverable from this row.
-- \`token_hash\` is the SHA-256 hex of the FULL plaintext (\`mcpfp_…\` marker included) and is UNIQUE, so
-- authentication is a single indexed lookup rather than a scan-and-compare. A plain SHA-256 is
-- deliberate: the input is a 256-bit random secret this app generated, not a human password, so a slow
-- KDF would only add latency to the hot auth path (see API_TOKEN_HASH_ALGORITHM in packages/shared).
-- \`token_prefix\` is display-only (\`mcpfp_ab12cd34…\`). \`scopes_json\` holds a JSON array of the frozen
-- ApiTokenScope vocabulary (D-C4); its admitted values are validated by the shared zod schema at the
-- app layer, not by a CHECK (a JSON array can't carry one). No FK: a token belongs to the instance,
-- not to any row in it.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  expires_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_created_at ON api_tokens(created_at DESC);

-- Observability — full-text search over run content (WP1.3, D-OB16). DERIVED state: the FTS5 index +
-- its docmap are rebuildable from runs/run_steps/run_grades (see observability/search.ts for the DDL,
-- which is the single source of truth reused by the v33 migration + reindex). Placed LAST so the
-- run_search_map -> runs(id) FK references an already-created runs table on a fresh DB.
${RUN_SEARCH_DDL}`;
