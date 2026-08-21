import type { TokenProfileId } from "@mcp-token-footprint/shared";

export type ServerRow = {
  id: string;
  name: string;
  transport: "stdio" | "streamable_http";
  command: string | null;
  args_json: string;
  url: string | null;
  headers_json: string;
  env_json: string;
  auth_type: "none" | "bearer" | "api_key" | "oauth" | "custom_headers";
  auth_header_name: string | null;
  type_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ServerTypeRow = {
  id: string;
  name: string;
  status: "production" | "release_candidate" | "beta" | "deprecated";
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type OAuthCredentialRow = {
  server_id: string;
  client_information_json: string | null;
  tokens_json: string | null;
  code_verifier: string | null;
  discovery_state_json: string | null;
  created_at: string;
  updated_at: string;
};

export type OAuthFlowRow = {
  state: string;
  server_id: string;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
};

export type ScanRow = {
  id: string;
  server_id: string;
  server_name: string;
  token_profile: TokenProfileId;
  scanned_at: string;
  status: "running" | "success" | "failed";
  total_tools: number;
  total_tokens: number;
  total_raw_bytes: number;
  average_tokens_per_tool: number;
  largest_tool_name: string | null;
  largest_tool_tokens: number;
  total_resources: number;
  total_resource_templates: number;
  total_prompts: number;
  total_resource_tokens: number;
  total_prompt_tokens: number;
  largest_resource_name: string | null;
  largest_resource_tokens: number;
  largest_prompt_name: string | null;
  largest_prompt_tokens: number;
  error_message: string | null;
  counting_version: number;
};

export type ToolScanRow = {
  id: string;
  scan_id: string;
  tool_name: string;
  description: string | null;
  input_schema_json: string | null;
  annotations_json: string | null;
  raw_tool_json: string;
  total_tokens: number;
  name_tokens: number;
  description_tokens: number;
  schema_tokens: number;
  annotations_tokens: number;
  raw_bytes: number;
  contribution_percent: number;
};

export type ResourceScanRow = {
  id: string;
  scan_id: string;
  kind: "resource" | "template";
  uri: string;
  name: string | null;
  description: string | null;
  mime_type: string | null;
  raw_resource_json: string;
  total_tokens: number;
  uri_tokens: number;
  name_tokens: number;
  description_tokens: number;
  mimetype_tokens: number;
  raw_bytes: number;
  contribution_percent: number;
};

export type PromptScanRow = {
  id: string;
  scan_id: string;
  prompt_name: string;
  description: string | null;
  arguments_json: string | null;
  raw_prompt_json: string;
  total_tokens: number;
  name_tokens: number;
  description_tokens: number;
  arguments_tokens: number;
  raw_bytes: number;
  contribution_percent: number;
};

export type ScanEventRow = {
  id: string;
  scan_id: string;
  level: "info" | "warning" | "error";
  message: string;
  created_at: string;
};

export type ProviderCredentialRow = {
  id: string;
  kind:
    | "anthropic"
    | "openai"
    | "google"
    | "openai_compatible"
    | "ollama"
    // Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 0.2, D-CS6/D-CS7): admitted by migration
    // v28's widened CHECK. No `api_key_encrypted` is ever stored for this kind — auth resolves from
    // `assistant_credentials` at run time (see `providers/subscription-auth.ts`).
    | "claude_subscription";
  label: string;
  base_url: string | null;
  api_key_encrypted: string | null;
  created_at: string;
  updated_at: string;
};

export type ScenarioRow = {
  id: string;
  name: string;
  provider_id: string;
  model: string;
  params_json: string;
  system_prompt: string;
  default_profiles_json: string;
  guardrails_json: string;
  tool_loading_mode: string;
  created_at: string;
  updated_at: string;
};

export type ScenarioServerRow = {
  scenario_id: string;
  server_id: string;
  allowed_tools_json: string | null;
};

export type ScenarioSkillRow = {
  scenario_id: string;
  skill_id: string;
  version_mode: "latest" | "pinned";
  pinned_version_id: string | null;
  eager: number; // 0/1 — WP 2.3 eager toggle
};

export type TestRow = {
  id: string;
  name: string;
  user_prompt: string;
  system_prompt_override: string | null;
  added_profiles_json: string;
  assertions_json: string | null;
  // Benchmarks (WP 1.1) — additive. Existing tests hydrate: expectations/category/difficulty NULL,
  // tags_json '[]'; a test without them behaves exactly as before.
  expectations_json: string | null;
  category: string | null;
  difficulty: string | null;
  tags_json: string;
  // Benchmarks (WP 4.1, B10) — collection membership. collection_id NULL = local-only; external_key is
  // the cross-system identity within that collection (NULL until exported/imported). Additive.
  collection_id: string | null;
  external_key: string | null;
  // Observability (WP4.1) — draft flag (promote_to_test). INTEGER NOT NULL DEFAULT 0 → 0 for every
  // existing test. Read as `draft: true` only when 1 (the omit-when-false hydrate discipline).
  draft: number;
  created_at: string;
  updated_at: string;
};

export type TestAttachmentRow = {
  id: string;
  test_id: string;
  kind: "file" | "image" | "text";
  name: string;
  path: string;
  bytes: number;
  created_at: string;
};

export type RunRow = {
  id: string;
  test_id: string;
  scenario_id: string;
  mode: "automated" | "interactive";
  status: "pending" | "running" | "completed" | "stopped" | "error" | "aborted" | "ended";
  outcome: string | null;
  stop_reason: string | null;
  started_at: string;
  duration_ms: number | null;
  turns: number;
  tool_calls: number;
  peak_context_tokens: number;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  // RM-33 (D-CT3) — NULL means "unknown" (a run persisted before migration v59 with no usage-bearing
  // steps to backfill from), NEVER "zero cache". Consumers must branch on null, not coalesce it.
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number;
  error_message: string | null;
  // WP 5.1 — JSON array of AssertionResult (validation-gate assertions evaluated from the trace
  // alignment on completion), or NULL when the test declared none / the run wasn't evaluated.
  assertion_results_json: string | null;
  // Benchmarks (WP 3.1, B7) — the suite run this run belongs to (denormalized, NOT FK'd — run history
  // survives suite deletion), and the 1-based repetition ordinal within its matrix cell. Both NULL for
  // a standalone (non-suite) run.
  suite_run_id: string | null;
  repetition: number | null;
  // Auto-Rating (AR11) — the post-run review axis (see RATING_STATES in shared). NOT NULL (default
  // 'pending'); migration v27 backfills existing rows. Orthogonal to `status` — never a new status.
  rating_state: string;
  // Claude subscription (WP 3.1, D-CS4/D-CS8) — HOW `cost_usd` was derived (shared CostBasis): NULL
  // (= 'api_exact', the ordinary exactly-billed cost) for every non-subscription run, or
  // 'subscription_reference' for a `claude_subscription` run's shadow price. Migration v29 adds the
  // column (existing runs backfill NULL); finalized from the terminal kpi's `costBasis`.
  cost_basis: string | null;
  // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — additive session-lifecycle columns. ALL
  // NULL-safe for every run persisted before this workstream (migration v31 backfills nothing but the
  // shape itself — a pre-existing row simply reads these as NULL/0). See schema.ts's `runs` DDL
  // comment for what each column means.
  phase: string | null;
  stop_reason_code: string | null;
  ended_at: string | null;
  seen: number;
  capabilities_json: string | null;
  active_duration_ms: number | null;
  total_duration_ms: number | null;
  // Observability (WP1.6) — retention classes: a pinned run is NEVER pruned. NOT NULL DEFAULT 0;
  // migration v35 adds this on an existing DB (every pre-v35 run reads back unpinned).
  pinned: number;
  // Observability (WP3.3, D-OB18) — fork lineage. A DERIVED run records the parent run it was forked
  // FROM and the parent step it was forked AT (NULL fork_step_id = whole-run re-launch). BOTH NULL for
  // an ordinary run. Denormalized (NOT FK'd — run history survives the parent's deletion). Migration
  // v42 adds them (existing runs read back NULL). Makes the WP1.1 `derived` RunFilter placeholder LIVE.
  derived_from_run_id: string | null;
  fork_step_id: string | null;
};

export type RunStepRow = {
  id: string;
  run_id: string;
  idx: number;
  type:
    | "llm_request"
    | "llm_response"
    | "tool_call"
    | "tool_result"
    | "context_event"
    | "user_message";
  label: string;
  status: string;
  duration_ms: number | null;
  server_id: string | null;
  tool_name: string | null;
  profile_tokens_json: string;
  usage_actual_json: string | null;
  context_snapshot_json: string | null;
  cumulative_tokens: number | null;
  assistant_text: string | null;
  reasoning_text: string | null;
  turn_index: number | null;
  result_bytes: number | null;
  started_at: string | null;
  ended_at: string | null;
  payload_json: string;
  // Observability (WP3.1, D-OB17) — step-hierarchy metadata. Both nullable/additive: a step persisted
  // before WP3.1 (migration v37) reads these back NULL and renders flat. `parent_step_id` references an
  // EARLIER run_steps.id of the same run (app-validated at persist, NOT a DB FK); `span_kind` is the
  // tree-role classifier (SpanKind in shared).
  parent_step_id: string | null;
  span_kind: string | null;
};

export type RunEventRow = {
  id: string;
  run_id: string;
  idx: number;
  type: string;
  payload_json: string;
  created_at: string;
};

// Benchmarks (WP 1.1) — one output-quality grade for a run (append-only; latest-per-grader wins for
// display). judge_* is a SEPARATE cost ledger, never folded into runs.cost_usd (B5).
export type RunGradeRow = {
  id: string;
  run_id: string;
  grader_id: string;
  kind: "deterministic" | "llm";
  status: "graded" | "unevaluable" | "error";
  score: number | null;
  raw_score: number | null;
  method: string;
  reasoning: string | null;
  evidence_json: string | null;
  judge_provider_id: string | null;
  judge_model: string | null;
  judge_tokens_in: number;
  judge_tokens_out: number;
  judge_cost_usd: number;
  grading_version: number;
  created_at: string;
};

// Benchmarks Phase 6 (WP 6.1, migration v60) — one HUMAN verdict on one grade row. APPEND-ONLY (a
// changed mind inserts a second row; newest per grade_id wins for display). A SEPARATE dimension from
// grading (AR6): nothing in grading/suites/compare reads this table, and there is deliberately no
// numeric column here that could be averaged into a score.
export type GradeFeedbackRow = {
  id: string;
  grade_id: string;
  verdict: "agree" | "disagree";
  note: string | null;
  created_at: string;
};

// The `grade_feedback` row JOINed to its grade's `run_id` — the shape the repository maps onto the
// public `GradeFeedback` wire type (the table itself never stores `run_id` twice).
export type GradeFeedbackJoinedRow = GradeFeedbackRow & { run_id: string };

// Generic app-settings KV (WP 1.3 keeps the default judge here under the 'judge' key).
export type AppSettingRow = {
  key: string;
  value_json: string;
  updated_at: string;
};

// Rating Issues registry (migration v26) — one DISTINCT, deduplicated issue against a skill /
// MCP server. target_id/target_name are denormalized (not FK'd) so issue history survives target
// deletion; judge_* stamps the source that last shaped title/summary/draft_fix (NULL = deterministic).
export type RatingIssueRow = {
  id: string;
  target_kind: "skill" | "mcp_server";
  target_id: string;
  target_name: string;
  skill_version_id: string | null;
  title: string;
  summary: string;
  bucket: string;
  fix_target: string;
  draft_fix: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved";
  times_seen: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  rating_version: number;
  judge_provider_id: string | null;
  judge_model: string | null;
  // Fleet issue aggregation (migration v41, WP5.1) — all nullable/additive. NULL on a per-run AR issue;
  // populated on a deterministically-clustered FLEET issue. occurrences/affected_json/trend_json are
  // DERIVED caches (recomputable from runs + grades via POST /api/issues/rebuild).
  cluster_key: string | null;
  cluster_key_version: number | null;
  occurrences: number | null;
  affected_json: string | null;
  lifecycle: "open" | "resolved" | "regressed" | null;
  resolution_note: string | null;
  trend_json: string | null;
};

// One contributing run of a rating issue. run_id/suite_run_id are denormalized (not FK'd) so the
// history survives run deletion; UNIQUE (issue_id, run_id, finding_digest) makes reprocessing a no-op.
export type RatingIssueOccurrenceRow = {
  id: string;
  issue_id: string;
  run_id: string;
  suite_run_id: string | null;
  finding_digest: string;
  category: string;
  message: string;
  // Concrete failure evidence (migration v30) — the tool, its sent args excerpt, and the exact error.
  // Nullable/additive: occurrences written before v30 have NULLs.
  tool_name: string | null;
  sent_arguments: string | null;
  error_message: string | null;
  created_at: string;
  // Fleet aggregation (migration v41, WP5.1) — the contributing run's terminal time (the sweep's
  // sighting time), so the fleet issue's first/last-seen + trend derive from when the failure happened.
  // Nullable: a non-sweep (auto-rating) occurrence leaves it NULL.
  observed_at: string | null;
};

// Benchmarks (WP 3.1, B7) — a suite: ordered test membership + a default scenario set + execution
// config (config ⇄ config_json). The matrix orchestrator is WP 3.2.
export type SuiteRow = {
  id: string;
  name: string;
  description: string | null;
  config_json: string;
  // Benchmarks (WP 4.1, B10) — collection membership (same semantics as TestRow's). Additive.
  collection_id: string | null;
  external_key: string | null;
  created_at: string;
  updated_at: string;
};

// Benchmarks (WP 4.1, B10) — a synced collection (git-backed set of tests/suites). pat_encrypted is
// the encrypted PAT (SecretStore); it is NEVER returned by the API (redacted to a `hasPat` boolean).
// Testing IA (WP 1.2/2.1, D-T4) — the git binding is OPTIONAL: `repo_url`/`repo_path`/`branch` are all
// NULL for a LOCAL (unbound) collection and all present for a bound one. `is_default` = 1 marks the one
// reserved, undeletable, never-repo-bound "Local" collection (0 for every other).
export type CollectionRow = {
  id: string;
  name: string;
  repo_url: string | null;
  repo_path: string | null;
  branch: string | null;
  pat_encrypted: string | null;
  last_synced_sha: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
};

// One ordered test membership row of a suite (position drives the ordered hydration of Suite.testIds).
export type SuiteTestRow = {
  suite_id: string;
  test_id: string;
  position: number;
};

// One default-scenario membership row of a suite.
export type SuiteScenarioRow = {
  suite_id: string;
  scenario_id: string;
};

// One executed suite run (the matrix instance). config_snapshot_json freezes the config used;
// aggregates_json holds the rolled-up SuiteAggregates (NULL until the orchestrator writes it — WP 3.2).
// Testing IA (WP 2.2, D-T5): suite_id is now NULLABLE (a collection/adhoc plan run has no owning Suite),
// and `source`/`plan_json` record which of the three plan sources launched the run + the serialized plan
// (both NULL on a pre-v16 row and `plan_json` NULL for a plain suite run).
export type SuiteRunRow = {
  id: string;
  suite_id: string | null;
  status: "pending" | "running" | "completed" | "capped" | "stopped" | "error";
  config_snapshot_json: string;
  started_at: string;
  ended_at: string | null;
  aggregates_json: string | null;
  source: string | null;
  plan_json: string | null;
  // Auto-Rating (AR11) — the suite-level review axis around the post-`finish()` report hook (see
  // RATING_STATES in shared). NOT NULL (default 'pending'); migration v27 backfills existing rows.
  rating_state: string;
};

// Auto-Rating (WP 4.1) — one persisted suite-run cross-run report. APPEND-ONLY, latest-per-suite-run
// wins (mirrors run_grades). report_json is the serialized SuiteReport; the judge_* columns are the
// SEPARATE judge ledger (0/null on the deterministic pass, filled by WP 4.2's agreement calls).
export type SuiteRunReportRow = {
  id: string;
  suite_run_id: string;
  status: "ready" | "partial" | "error";
  report_json: string;
  rating_version: number;
  judge_provider_id: string | null;
  judge_model: string | null;
  judge_tokens_in: number;
  judge_tokens_out: number;
  judge_cost_usd: number;
  created_at: string;
};

// WP 2.1 — one skill version a run RESOLVED at run time. skill_id/skill_version_id are DENORMALIZED
// (not FK'd) so a run's history survives the later deletion of the skill it exercised; version_label
// is a denormalized display label for the same reason.
export type RunSkillRow = {
  run_id: string;
  skill_id: string;
  skill_version_id: string;
  version_label: string;
  eager: number; // 0/1
};

export type SkillRow = {
  id: string;
  name: string;
  display_name: string;
  slug: string;
  source_type: "upload" | "github";
  description: string | null;
  current_version_id: string | null;
  github_repo_url: string | null;
  github_ref: string | null;
  github_subpath: string | null;
  github_auth_ref: string | null;
  github_last_sha: string | null;
  created_at: string;
  updated_at: string;
};

export type SkillVersionRow = {
  id: string;
  skill_id: string;
  seq: number;
  version_label: string;
  tree_sha: string;
  source_kind: "upload" | "github";
  source_ref: string | null;
  manifest_json: string;
  manifest_valid: number;
  manifest_errors_json: string;
  token_profile: TokenProfileId;
  file_count: number;
  total_bytes: number;
  l1_metadata_tokens: number;
  l2_body_tokens: number;
  l3_resource_tokens: number;
  total_tokens: number;
  imported_from: "upload" | "github-pull";
  note: string | null;
  /** Skill IDE WP 9.1 (I10.3): the live-draft save's op intent-log JSON (audit); NULL for non-draft versions. */
  intent_log_json: string | null;
  created_at: string;
};

export type SkillFileRow = {
  id: string;
  version_id: string;
  path: string;
  blob_sha: string;
  size: number;
  is_binary: number;
  is_skill_md: number;
  kind: "skill_md" | "reference" | "script" | "asset" | "other";
  token_total: number;
};

// Skill IDE WP 8.1 (I9.1) — a per-skill server binding row. `server_id` is NULLable (the honest
// unbound state); the PRIMARY KEY is (skill_id, server_name).
export type SkillServerBindingRow = {
  skill_id: string;
  server_name: string;
  server_id: string | null;
};

// --- Assistant (WP 0.1, migration v20) ------------------------------------------------------------
// Embedded Claude agent chat (planning/Roadmap/RM-02-assistant/00-plan.md §4). All three tables are additive
// (`CREATE TABLE IF NOT EXISTS`, the v17 `skill_server_bindings` pattern — see db/database.ts v20).

// One stored credential (D-AS1/D-AS2). Today only `kind = 'claude_oauth'` is written; the API-key
// fallback is a REFERENCE to an existing `provider_credentials` row, never duplicated here.
// `token_encrypted` is `SecretStore`-encrypted (`enc:v1:…`) and is NEVER returned by any route —
// only `AssistantRepository.getDecrypted()` (INTERNAL ONLY) reads it back to plaintext.
export type AssistantCredentialRow = {
  id: string;
  kind: "claude_oauth";
  token_encrypted: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};

// One chat thread. `entity_kind`/`entity_id` are the OPTIONAL pin (D-AS15); both NULL for a thread
// opened from the global dock. `sdk_session_id` is the Agent SDK's own session id, persisted so a
// parked/idle thread can `resume` (D-AS6) — NULL until the first turn completes.
export type AssistantThreadRow = {
  id: string;
  title: string;
  entity_kind: string | null;
  entity_id: string | null;
  model: string;
  auth_source: "subscription" | "api_key";
  sdk_session_id: string | null;
  status: "idle" | "running" | "error";
  auto_accept: number; // 0/1
  created_at: string;
  updated_at: string;
};

// One settled, append-only event in a thread's replayable log. `seq` is a PER-THREAD monotonic
// ordinal (1, 2, 3…, enforced by `UNIQUE (thread_id, seq)`) — mirrors `run_events.idx`.
export type AssistantEventRow = {
  id: string;
  thread_id: string;
  seq: number;
  type: string;
  payload_json: string;
  created_at: string;
};

// Observability — a saved view (WP1.4): a named, reusable RunFilter + opaque presentation hints.
// `filter_json` is a validated RunFilter (never re-validated on read — write-time validation is the
// only gate); `columns_json`/`sort_json` are web-owned JSON blobs the API never interprets.
export type RunViewRow = {
  id: string;
  name: string;
  filter_json: string;
  columns_json: string | null;
  sort_json: string | null;
  created_at: string;
  updated_at: string;
};

// Observability — a custom chart composer chart (WP2.7, D-OB22): a user-defined measure(s)/filter/
// groupBy/bucket/chartType config, persisted + cloneable. `config_json` is a validated
// DashboardChartConfig (re-validated on every read, mirroring RunViewRow's filter_json discipline
// above). `position` is a dense 0..N-1 display order, renumbered after every create/delete and
// rewritten wholesale by a reorder call.
export type DashboardChartRow = {
  id: string;
  name: string;
  config_json: string;
  position: number;
  created_at: string;
  updated_at: string;
};

// Observability — human feedback (WP1.5, D-OB15): a score/note on a run or one of its steps.
// `step_id` NULL = run-level; `score`/`comment` are each independently nullable (at least one is
// present — enforced by `runFeedbackInputSchema`, not the DB). `source` is 'human' for every row the
// API writes today ('auto' is unwired — see the shared `RunFeedbackSource` doc).
export type RunFeedbackRow = {
  id: string;
  run_id: string;
  step_id: string | null;
  key: string;
  score: number | null;
  comment: string | null;
  source: "human" | "auto";
  created_at: string;
};

// Observability — watch rules (WP4.1, D-OB19/D-OB21; WP4.2). `filter_json`/`actions_json` are validated
// JSON (the shared RunFilter zod + the closed action union); `window_json` holds the validated WP4.2
// windowed threshold config (NULL for on_terminal); `last_evaluated_at` (v39) is the WP4.2 boot-catch-up
// baseline — the grid-boundary end of the last window the scheduler evaluated (NULL until first eval).
export type WatchRuleRow = {
  id: string;
  name: string;
  enabled: number;
  trigger: "on_terminal" | "windowed";
  filter_json: string;
  sample: number | null;
  window_json: string | null;
  actions_json: string;
  last_evaluated_at: string | null;
  /** AM-OB10 (v61) — paused until this ISO-8601 instant; NULL = not paused (and a PAST value simply
   *  resolves to not-paused on read, which is why there is no sweep). */
  paused_until: string | null;
  /** AM-OB10 (v61) — minimum minutes between action dispatches for an `on_terminal` rule; NULL/0 =
   *  no limit. */
  min_interval_minutes: number | null;
  created_at: string;
  updated_at: string;
};

// Append-only audit row. `run_id` is denormalized (no FK) so it survives run deletion; `result_json`
// never carries a secret (a redacted { ok, detail?, error? } payload only).
export type WatchRuleEventRow = {
  id: string;
  rule_id: string;
  run_id: string | null;
  at: string;
  action: string;
  result_json: string;
};

// The encrypted webhook-URL store row (SecretStore ciphertext; never returned). Cascade-deleted with
// its owning rule.
export type WatchSecretRow = {
  ref: string;
  rule_id: string;
  encrypted_value: string;
  created_at: string;
};

// Observability — notification center (WP4.3, D-OB19; v40). One row per fired `notify` watch action.
// `rule_id`/`run_id` are denormalized (no FK) so a notification survives rule/run deletion; `read`/
// `late` are booleans stored as 0/1.
export type NotificationRow = {
  id: string;
  at: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  link_path: string | null;
  rule_id: string | null;
  run_id: string | null;
  read: number;
  late: number;
};

// Observability — scheduled digest report (WP5.5, D-OB22; v43). One row per generated digest,
// append-only. `report_json` holds the whole serialized DigestReport; `window_kind`/`window_from`/
// `window_to` are denormalized off it for cheap listing/scheduling queries. `late` is a boolean
// stored as 0/1 (a scheduler boot-catch-up generation only).
export type DigestReportRow = {
  id: string;
  window_kind: "daily" | "weekly";
  window_from: string;
  window_to: string;
  generated_at: string;
  late: number;
  report_json: string;
};

// Observability — DB-backed model pricing map (WP2.6, D-OB22; v44). Prices are USD per 1M tokens.
// `is_regex` is a boolean stored as 0/1; `cache_read_per_mtok`/`cache_write_per_mtok` are each
// independently nullable (NULL => derive). `source` is 'seed' (read-only, from the code table) or
// 'user' (owner-added, overrides a seed via a newer `effective_from`).
export type ModelPricingRow = {
  id: string;
  provider: string;
  model_match: string;
  is_regex: number;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
  effective_from: string;
  created_at: string;
  source: "seed" | "user";
};

// Observability — review queue lite (WP4.5, D-OB22; v46): a persisted, named RUBRIC (a checklist of
// keys, each thumbs/scale5/note). `keys_json` is a validated ReviewRubricKeyDef[] (re-validated on
// every read, mirroring RunViewRow/DashboardChartRow's toPublic discipline). A "review session" is
// EPHEMERAL config (a source filter + this rubric, picked at review time) — never persisted; every
// verdict a reviewer records is written through the EXISTING run_feedback table (WP1.5), never here.
export type ReviewRubricRow = {
  id: string;
  name: string;
  instructions: string | null;
  keys_json: string;
  created_at: string;
  updated_at: string;
};

// --- Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.2, migration v47) ---------------------------------
// The full-page, multi-model, multi-agent Assistant (`hub` domain, D-AH2). All 13 tables are
// brand-new + additive (the v20/v40/.../v46 "CREATE TABLE IF NOT EXISTS" pattern — see
// db/schema.ts's "Assistant Hub" section + db/database.ts v47). Owned exclusively by
// `hub/repository.ts`, the only code that touches these tables directly.

export type HubProjectRow = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

// The role library (D-AH7). `tool_grants_json` is a serialized HubToolGrants blob;
// `skill_ids_json` a serialized HubSkillAttachment[] blob (WP2.4 — the column name predates the
// WP2.4 upgrade from a plain string[] to a versioned/invocation-mode-aware attachment; the name is
// kept to avoid a schema migration for a JSON-TEXT column whose only reader/writer is this file).
// display_name (migration v49, Assistant Hub UX WP1.0s, D-HUX8/P2): an optional persona/display
// name; NULL on every pre-v49 row (falls back to `name`, the role title). No avatar column — the
// avatar reuses `icon` above (P2).
export type HubAgentRow = {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  icon: string | null;
  system_prompt: string;
  default_model: string;
  tool_grants_json: string;
  skill_ids_json: string;
  target: string;
  expected_outcome: string;
  budgets_json: string | null;
  // provider_credential_id (migration v55, model identity D-MI1): the credential that OWNS
  // `default_model`. NULL on every pre-v55 role, on one authored before any credential existed, and
  // after its credential was deleted (ON DELETE SET NULL) ⇒ the unchanged name-heuristic fallback.
  provider_credential_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

// One SESSION-level skill attachment (WP2.4, R-SK1…R-SK3/R-SK8) — mirrors `ScenarioSkillRow`
// exactly, plus `invocation_mode` (model_invocable/user_only/name_only, R-SK3). No per-row `eager`
// column: session-level attachment always uses the L1-catalog + on-demand `skills.load` mechanic
// (never the Testing feature's "inline the whole body up front" eager toggle).
export type HubSessionSkillRow = {
  session_id: string;
  skill_id: string;
  version_mode: "latest" | "pinned";
  pinned_version_id: string | null;
  invocation_mode: "model_invocable" | "user_only" | "name_only";
};

// A saved crew (D-AH7). `members_json` is a serialized HubCrewMember[] blob.
// color (migration v49, Assistant Hub UX WP1.0s, D-HUX8): the optional `chart-1`..`chart-5` accent;
// NULL on every pre-v49 row (no explicit accent) and validated at the app layer by
// `hubCrewColorSchema`/`HUB_CREW_COLORS` — the DB CHECK lives only in schema.ts's fresh-DB baseline.
export type HubCrewRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  topology: string;
  members_json: string;
  created_at: string;
  updated_at: string;
};

// One hub session — the lifecycle columns (status/phase/stop_reason_code/capabilities_json/
// *_duration_ms/wait_deadline_at/ended_at/seen) REUSE the Unified-Sessions contract verbatim
// (D-AH3/§1.2), mirroring RunRow's shape.
export type HubSessionRow = {
  id: string;
  project_id: string | null;
  kind: "chat" | "agent";
  parent_session_id: string | null;
  mission_id: string | null;
  title: string;
  title_state: "pending" | "auto" | "manual";
  mode: "chat" | "research" | "mission" | "auto";
  topology: string | null;
  autonomy: string | null;
  crew_id: string | null;
  model: string;
  // provider_credential_id (migration v55, model identity D-MI1): the credential this session's turns
  // actually run on — AUTHORITATIVE when set (the resolver never re-infers from the model name, which is
  // what lets a claude_subscription session reach the subscription executor). NULL on every pre-v55
  // session and after its credential is deleted (ON DELETE SET NULL) ⇒ the unchanged heuristic.
  provider_credential_id: string | null;
  status: string;
  phase: string | null;
  stop_reason_code: string | null;
  capabilities_json: string | null;
  budgets_json: string | null;
  prompt_version: string | null;
  // End-user UX pass (migration v50) — the session's MCP tool SCOPE (a HubToolGrants blob). NULL ⇒
  // "auto" (all reachable servers + tool_search). Set ⇒ resolveHubMcpGrants narrows to it.
  tool_scope_json: string | null;
  // End-user UX pass (migration v52) — the session's Agents & Crews ROSTER (a HubSessionRoster
  // {crewIds,agentIds} blob). NULL ⇒ none. A preferred pool fed to the mission planner.
  roster_json: string | null;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  active_duration_ms: number | null;
  total_duration_ms: number | null;
  wait_deadline_at: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  seen: number; // 0/1
  // Assistant Hub UX WP1.4 (D-HUX4, P4) — migration v49 landed the column; this WP is the first to
  // read/write it through the repository (archive-only soft-hide, mirrors hub_agents.archived_at).
  archived_at: string | null;
};

// A mission (D-AH6/D-AH8). `plan_json` is the HubMissionPlan blob (mutable up to approval, then
// FROZEN at the app level); `agent_session_ids_json` a denormalized string[] mirror. The crew-nesting
// lineage columns (D-CN6, v54): `parent_mission_id` self-FK (NULL on a ROOT), `depth` distance from
// the root (0 on a root/legacy row), `root_mission_id` denormalised whole-tree key (a root
// self-references its own id; DB-internal, NOT a wire field per D-CN5).
export type HubMissionRow = {
  id: string;
  session_id: string;
  status: string;
  topology: string;
  autonomy: string;
  plan_json: string;
  budgets_json: string | null;
  cost_usd: number;
  agent_session_ids_json: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  parent_mission_id: string | null;
  depth: number;
  root_mission_id: string | null;
};

// Append-only, per-session replayable event log (R-SES1). `seq` is a PER-SESSION monotonic ordinal
// enforced by UNIQUE (session_id, seq) — mirrors AssistantEventRow.seq / run_events.idx.
export type HubEventRow = {
  id: string;
  session_id: string;
  seq: number;
  type: string;
  payload_json: string;
  created_at: string;
};

// Typed, versioned artifact (D-AH12). `current_version_id` is a forward FK to
// hub_artifact_versions.
export type HubArtifactRow = {
  id: string;
  session_id: string | null;
  project_id: string | null;
  kind: "markdown" | "code" | "html" | "table" | "json";
  title: string;
  latest_version: number;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
};

// An IMMUTABLE artifact version (D-AH12) — 1-based, monotonic per artifact.
export type HubArtifactVersionRow = {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  note: string | null;
  author_kind: "user" | "assistant" | "agent" | "system";
  author_ref: string | null;
  created_at: string;
};

// Artifact review (D-AH12). `comments_json` is a serialized HubReviewComment[] blob.
export type HubReviewRow = {
  id: string;
  artifact_id: string;
  base_version: number;
  status: "open" | "resolved" | "cancelled";
  reviewer_kind: "user" | "assistant" | "agent" | "system";
  reviewer_ref: string | null;
  comments_json: string;
  created_at: string;
  updated_at: string;
};

// A content-addressed uploaded file (D-AH12). `content` carries the raw bytes directly (no separate
// blob-dedup table, unlike skills' skill_blobs).
export type HubFileRow = {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  filename: string | null;
  content: Buffer;
  created_at: string;
};

// A file's link to an app target (D-AH12). `target_id` is a DENORMALIZED polymorphic reference —
// no single FK could span project/session/message/artifact.
export type HubFileLinkRow = {
  id: string;
  file_id: string;
  role: "upload" | "pinned" | "produced";
  target_kind: "project" | "session" | "message" | "artifact";
  target_id: string;
  created_at: string;
};

// Memory (D-AH11) — a visible, editable store.
export type HubMemoryRow = {
  id: string;
  kind: "profile" | "preference" | "instruction";
  content: string;
  source: "user" | "assistant_proposed";
  status: "proposed" | "active" | "archived";
  created_at: string;
  updated_at: string;
};

// A rolling per-session summary (D-AH11(b)). `upto_seq` is the last hub_events.seq it covers.
export type HubSessionSummaryRow = {
  id: string;
  session_id: string;
  upto_seq: number;
  content: string;
  tokens: number;
  created_at: string;
};
