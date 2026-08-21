import type {
  ADVISOR_EVIDENCE_KINDS,
  ADVISOR_SAVINGS_UNITS,
  ADVISOR_SCOPE_KINDS,
  ADVISOR_SEVERITIES,
  ANSWER_VALIDATION_VERDICTS,
  ASSERTION_RESULT_STATUSES,
  ASSISTANT_AUTH_SOURCES,
  ASSISTANT_CREDENTIAL_KINDS,
  ASSISTANT_ENTITY_KINDS,
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_LIMIT_ERROR_KINDS,
  ASSISTANT_THREAD_STATUSES,
  ASSISTANT_WORKSPACE_CHANGE_KINDS,
  ASSISTANT_WORKSPACE_FRAME_TYPES,
  CONTEXT_SEGMENTS,
  DASHBOARD_CHART_SCAN_MEASURES,
  DASHBOARD_CHART_SOURCES,
  DASHBOARD_CHART_TYPES,
  DIGEST_SCHEDULE_MODES,
  DIGEST_WINDOW_KINDS,
  ERROR_FINDING_CATEGORIES,
  FIX_TARGETS,
  GRADE_KINDS,
  GRADE_STATUSES,
  GRADER_IDS,
  HUB_ACTOR_KINDS,
  HUB_APPROVAL_OPTION_KINDS,
  HUB_APPROVAL_RESOLUTIONS,
  HUB_ARTIFACT_EXPORT_FORMATS,
  HUB_ARTIFACT_KINDS,
  HUB_AUDIT_KINDS,
  HUB_AUTONOMY_LEVELS,
  HUB_CONFIDENCE_LEVELS,
  HUB_CREW_COLORS,
  HUB_ELICITATION_ACTIONS,
  HUB_ELICITATION_MODES,
  HUB_EVENT_TYPES,
  HUB_FILE_LINK_ROLES,
  HUB_FILE_LINK_TARGETS,
  HUB_LIMIT_RETRY_SOURCES,
  HUB_MEMORY_KINDS,
  HUB_MEMORY_SCOPES,
  HUB_MEMORY_SOURCES,
  HUB_MEMORY_STATUSES,
  HUB_MESSAGE_PART_TYPES,
  HUB_MISSION_STATUSES,
  HUB_REVIEW_COMMENT_DECISIONS,
  HUB_REVIEW_STATUSES,
  HUB_SESSION_KINDS,
  HUB_SESSION_MODES,
  HUB_SKILL_INVOCATION_MODES,
  HUB_TASK_STATUSES,
  HUB_TITLE_STATES,
  HUB_TOOL_PART_STATES,
  HUB_TOOL_SOURCES,
  HUB_TOPOLOGIES,
  HUB_USAGE_GROUP_BYS,
  HUB_WORKSPACE_CHANGE_KINDS,
  INSIGHT_SURPLUS_VERDICTS,
  ISSUE_ASSIST_PRIORITIES,
  JUDGE_METHODS,
  METRICS_BUCKETS,
  METRICS_TIMEZONE,
  PROVIDER_KINDS,
  QUALITY_SEVERITIES,
  RATING_ISSUE_LIFECYCLES,
  RATING_ISSUE_OCCURRENCE_CATEGORIES,
  RATING_STATES,
  REFERENCE_LOGIC_KINDS,
  REVIEW_RUBRIC_KEY_KINDS,
  ROOT_CAUSE_BUCKETS,
  RUN_METRICS_GROUP_BY,
  RUN_METRICS_MEASURES,
  RUN_MODES,
  RUN_OUTCOMES,
  RUN_PHASES,
  RUN_PLAN_SOURCES,
  RUN_SORT_DIRECTIONS,
  RUN_SORT_FIELDS,
  RUN_STATUSES,
  RUN_STEP_TYPES,
  SEARCH_CONTENT_CLASSES,
  SERVER_AUTH_TYPES,
  SERVER_TYPE_STATUSES,
  SESSION_COST_BASES,
  SESSION_LIVE_REASONING,
  SESSION_TOKEN_ACCOUNTING,
  SKILL_EDIT_OP_TYPES,
  SKILL_FILE_ENCODINGS,
  SKILL_FILE_KINDS,
  SKILL_GATE_EXPECTATIONS,
  SKILL_GRAPH_NODE_KINDS,
  SKILL_GRAPH_SOURCES,
  SKILL_SOURCE_TYPES,
  SKILL_VERSION_MODES,
  SKILLFLOW_STATIC_SUGGESTION_RULES,
  SKILLFLOW_SUGGESTION_RULES,
  SPAN_KINDS,
  STOP_REASON_CODES,
  SUITE_RUN_STATUSES,
  TEST_DIFFICULTIES,
  TOKEN_PROFILES,
  TOOL_CANDIDATE_CONFIDENCE,
  TOOL_DIAGNOSTIC_KINDS,
  TOOL_HYGIENE_SEVERITIES,
  TOOL_LOADING_MODES,
  TRACE_EVENT_TYPES,
  TRACE_SOURCES,
  TRACE_VERDICT_CONFIDENCE,
  TRACE_VERDICT_STATUSES,
  TRANSPORT_TYPES,
  TRIGGER_KINDS,
  WAITING_INPUT_REASONS,
  WATCH_NOTIFY_SEVERITIES,
  WATCH_RULE_TRIGGERS,
  WATCH_WINDOW_DURATIONS,
  WATCH_WINDOW_OPS,
} from "./constants.js";
// model-identity WP3.3 (D-MI10) — `HubUsageProviderCredentialBucket.billing` reuses the ONE billing
// vocabulary from the D-MI6 registry rather than re-declaring a parallel union here.
import type { ProviderKindBilling } from "./constants.js";
// RM-20 WP 2.2 (D-SP24) — `ServerReport.security` carries the posture section declared by the
// security-posture contract, rather than a second description of it here. That module imports only
// `zod`, so this direction of the dependency is the only one and there is no cycle.
import type { SecurityPostureSection } from "./security-posture.js";

export type TransportType = (typeof TRANSPORT_TYPES)[number];

export type ServerAuthType = (typeof SERVER_AUTH_TYPES)[number];

export type ServerTypeStatus = (typeof SERVER_TYPE_STATUSES)[number];

/**
 * Server type (planning/Roadmap/completed/RM-21-server-types, D-ST1/D-ST2): a first-class named group of MCP servers that
 * share one tool surface (e.g. "Acme-SaaS" = production fleet, "acme-stage" = beta/RC). Lifecycle
 * `status` lives on the type; each server references at most one type. Carries NO secrets and NO
 * connection config — the redaction model is untouched.
 */
export type ServerType = {
  id: string;
  name: string;
  status: ServerTypeStatus;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Number of servers currently assigned this type (computed on read). */
  memberCount: number;
};

export type ServerTypeInput = {
  name: string;
  status?: ServerTypeStatus;
  description?: string;
};

export type ServerTypeUpdate = {
  name?: string;
  status?: ServerTypeStatus;
  /** `null` explicitly clears the description; omitted keeps the current one. */
  description?: string | null;
};

export type TokenProfileId = (typeof TOKEN_PROFILES)[number];

export type ScanStatus = "running" | "success" | "failed";

export type ScanEventLevel = "info" | "warning" | "error";

export type NormalizedToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  raw: unknown;
};

export type TokenBreakdown = {
  totalTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  schemaTokens: number;
  annotationsTokens: number;
  rawBytes: number;
};

export type ServerConfigInput = {
  name: string;
  transport: TransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth?: ServerAuthInput;
  /**
   * Server type assignment (planning/Roadmap/completed/RM-21-server-types, additive — D-ST5). `null` explicitly clears the
   * assignment on update; omitted keeps the current value. Unknown ids are rejected (400).
   */
  typeId?: string | null;
};

export type ServerConfig = Omit<ServerConfigInput, "env" | "headers"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  hasEnvSecrets: boolean;
  hasHeaderSecrets: boolean;
  authType: ServerAuthType;
  authHeaderName?: string;
  // The configured OAuth client id (non-secret — a public client identifier), surfaced so the
  // edit form can prefill it. The client secret is never returned. Undefined unless oauth + set.
  oauthClientId?: string;
};

export type ServerConfigUpdate = Partial<ServerConfigInput>;

export type ServerAuthInput =
  | { type: "none" }
  | { type: "bearer"; token?: string }
  | { type: "api_key"; headerName: string; key?: string }
  | ({ type: "oauth" } & OAuthClientInput)
  | { type: "custom_headers"; headers?: Record<string, string> };

export type OAuthClientInput = {
  clientId?: string;
  clientSecret?: string;
};

export type ServerProbeRequest = {
  name?: string;
  url: string;
  auth?: ServerAuthInput;
};

export type ServerProbeResponse = {
  ok: boolean;
  url: string;
  authRequired: boolean;
  oauthAvailable: boolean;
  tools: number;
  durationMs: number;
  message: string;
  authMethods: ServerAuthType[];
  errorMessage?: string;
};

export type OAuthStartResponse = {
  serverId: string;
  status: "redirect" | "authorized";
  authorizationUrl?: string;
};

export type OAuthStatusResponse = {
  serverId: string;
  authenticated: boolean;
};

export type ScanSummary = {
  id: string;
  serverId: string;
  serverName: string;
  tokenProfile: TokenProfileId;
  scannedAt: string;
  status: ScanStatus;
  totalTools: number;
  totalTokens: number;
  totalRawBytes: number;
  averageTokensPerTool: number;
  largestToolName?: string;
  largestToolTokens: number;
  // Resource/prompt footprint (definition only). Additive; `totalTokens` stays TOOLS-ONLY.
  totalResources: number; // count of kind="resource" rows
  totalResourceTemplates: number; // count of kind="template" rows
  totalPrompts: number;
  totalResourceTokens: number; // sum over ALL resource rows (resources + templates)
  totalPromptTokens: number;
  largestResourceName?: string;
  largestResourceTokens: number;
  largestPromptName?: string;
  largestPromptTokens: number;
  // Token-counting methodology version this scan was produced under (see TOKEN_COUNTING_VERSION).
  // Lets the UI/compare detect scans counted under an older method (their totals are not directly
  // comparable to current ones). Older scans predating this stamp read as 1 (the legacy heuristic).
  countingVersion: number;
  errorMessage?: string;
  // True when a scan FAILED because the server's OAuth token needs interactive reauthentication
  // (only ever set for streamable-HTTP + oauth servers). Lets the UI offer a reauth prompt instead
  // of a dead-end error. Additive/optional — older scans + non-oauth failures lack it.
  authRequired?: boolean;
};

export type ToolScan = TokenBreakdown & {
  id: string;
  scanId: string;
  toolName: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  rawTool: unknown;
  contributionPercent: number;
};

/** A scanned MCP resource OR resource template (kind distinguishes them). Definition footprint only. */
export type ResourceKind = "resource" | "template";

export type ResourceScan = {
  id: string;
  scanId: string;
  kind: ResourceKind; // "resource" = concrete uri; "template" = uriTemplate
  uri: string; // the concrete uri, or the uriTemplate for kind="template"
  name?: string;
  description?: string;
  mimeType?: string;
  rawResource: unknown;
  totalTokens: number;
  uriTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  mimeTypeTokens: number;
  rawBytes: number;
  contributionPercent: number; // share of this scan's TOTAL resource tokens (resources+templates)
};

/** A scanned MCP prompt definition. Definition footprint only. */
export type PromptScan = {
  id: string;
  scanId: string;
  promptName: string;
  description?: string;
  arguments?: unknown; // the prompt's declared argument list
  rawPrompt: unknown;
  totalTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  argumentsTokens: number;
  rawBytes: number;
  contributionPercent: number; // share of this scan's total prompt tokens
};

/** Normalized MCP resource/template definition (kind distinguishes them) — counted, never read. */
export type NormalizedResourceDefinition = {
  kind: ResourceKind;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  raw: unknown;
};

/** Normalized MCP prompt definition — its declared name/description/arguments, never executed. */
export type NormalizedPromptDefinition = {
  name: string;
  description?: string;
  arguments?: unknown;
  raw: unknown;
};

export type ScanEvent = {
  id: string;
  scanId: string;
  level: ScanEventLevel;
  message: string;
  createdAt: string;
};

export type ScanDetail = ScanSummary & {
  tools: ToolScan[];
  resources: ResourceScan[];
  prompts: PromptScan[];
  events: ScanEvent[];
};

// --- Data-model maintenance: deletion + retention (issue #19) ----------------------------------
// Delete endpoints return WHAT was removed (the scan/run id + per-child-table counts) so a UI can
// confirm the cascade. Child rows are removed by the parent's `ON DELETE CASCADE` inside a txn.

/** Result of deleting a scan: the id plus how many child rows cascaded away, per table. */
export type ScanDeletionResult = {
  scanId: string;
  deletedTools: number;
  deletedResources: number;
  deletedPrompts: number;
  deletedEvents: number;
};

/** Result of deleting a run: the id plus how many child step/event rows cascaded away. */
export type RunDeletionResult = {
  runId: string;
  deletedSteps: number;
  deletedEvents: number;
};

/** Result of the "keep last N scans per server" retention prune: which scans were pruned. */
export type ScanRetentionResult = {
  keep: number;
  prunedScanIds: string[];
};

// --- Observability — retention classes (planning/Roadmap/RM-17-observability/, WP1.6) --------------------------
// Pin runs forever; prune the rest by class. A PINNED run is NEVER a prune candidate under ANY
// policy — enforced by the repository (`pinned = 0` is always part of the victim query), not just by
// convention. Pruning is OFF by default: an empty/absent policy (`byStatus: {}`) prunes nothing.

/**
 * One status's retention rule. A run of that status is a prune victim when it satisfies EITHER bound
 * (both may be set — the victim set is their union, not an intersection). Absent fields impose no
 * constraint for that bound.
 */
export type RunRetentionStatusRule = {
  /** Delete runs of this status whose `startedAt` is older than this many days. */
  olderThanDays?: number;
  /** Keep only the newest N runs of this status (by `startedAt`, globally — not per test/scenario); delete the rest. */
  keepNewest?: number;
};

/**
 * The run-retention prune policy (WP1.6). Keyed by {@link RunStatus}; only TERMINAL statuses
 * (`completed`/`stopped`/`error`/`aborted`/`ended`) are ever honored — an entry for `pending`/
 * `running` is accepted but silently ignored (a live run is never a prune candidate). Persisted in
 * the `app_settings` KV under {@link APP_SETTING_RUN_RETENTION_KEY} and edited via the Settings
 * Storage card; `POST /api/maintenance/prune-runs` uses the persisted policy unless the caller
 * supplies an explicit override in the request body. Defaults to `{ byStatus: {} }` — no status
 * configured, so pruning is OFF until the operator opts in.
 */
export type RunRetentionPolicy = {
  byStatus: Partial<Record<RunStatus, RunRetentionStatusRule>>;
};

/**
 * Result of `POST /api/maintenance/prune-runs` (WP1.6) — honesty-first, mirrors
 * {@link ScanRetentionResult}: real ids/counts, not just an `ok`. `policy` echoes the policy actually
 * applied (the request override, or the persisted one). Deletion goes through the SAME full run-delete
 * cascade `DELETE /api/runs/:id` uses (steps/events/grades/skills + the WP1.3 full-text purge), so
 * `deletedSteps`/`deletedEvents` mirror {@link RunDeletionResult}, summed across every pruned run.
 */
export type RunPruneResult = {
  policy: RunRetentionPolicy;
  prunedRunIds: string[];
  deletedSteps: number;
  deletedEvents: number;
};

/** Result of `POST`/`DELETE /api/runs/:id/pin` (WP1.6) — the run's pinned state after the call. */
export type RunPinResult = {
  runId: string;
  pinned: boolean;
};

/** Result of a DB maintenance op (WAL checkpoint / VACUUM). Bytes are best-effort file sizes. */
export type MaintenanceResult = {
  operation: "checkpoint" | "vacuum";
  ok: boolean;
  message: string;
};

/**
 * Result of `POST /api/maintenance/reindex-search` (Observability WP1.3, D-OB16) — the full-text index
 * (`run_search`, DERIVED state) was DROPPED and rebuilt from `runs`/`run_steps`/`run_grades`. `runs` is
 * how many runs were re-scanned; `documents` how many FTS rows were written.
 */
export type SearchReindexResult = {
  operation: "reindex-search";
  ok: boolean;
  message: string;
  runs: number;
  documents: number;
};

// --- Cross-server / tool-level comparison (north-star #4, audit §C4) --------------------------
// Comparing two scans — the SAME server over time OR two DIFFERENT servers — at the tool level.
// Tools are paired by exact name, then normalized name, then fuzzy similarity; the API computes
// this (apps/api/src/compare) and the web Compare view renders it. Deltas are always B − A.

/** How a tool in scan A was paired with a tool in scan B. */
export type ToolMatchBasis = "exact" | "normalized" | "fuzzy";

/** A tool as it appears in a comparison (the subset of `ToolScan` the diff needs). */
export type ComparedTool = {
  toolName: string;
  totalTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  schemaTokens: number;
  annotationsTokens: number;
  contributionPercent: number;
};

/** What changed in a matched tool's *definition* (beyond token counts), A → B. */
export type ToolDefinitionDelta = {
  descriptionChanged: boolean; // normalized description text differs
  schemaChanged: boolean; // canonical inputSchema differs
  annotationsChanged: boolean; // canonical annotations differ
};

/** A pair of tools matched across the two scans, with the token delta (B − A). */
export type ToolMatch = {
  a: ComparedTool;
  b: ComparedTool;
  basis: ToolMatchBasis;
  /** 0..1 similarity; 1 for exact/normalized, the fuzzy score otherwise. */
  similarity: number;
  deltaTokens: number;
  deltaPercent: number;
  /** What changed in the matched tool's definition (description/schema/annotations), A → B. */
  definitionDelta: ToolDefinitionDelta;
};

/** A resource as it appears in a comparison (subset of ResourceScan). */
export type ComparedResource = {
  kind: ResourceKind;
  uri: string;
  name?: string;
  mimeType?: string;
  totalTokens: number;
  contributionPercent: number;
};

/** A prompt as it appears in a comparison (subset of PromptScan). */
export type ComparedPrompt = {
  promptName: string;
  totalTokens: number;
  contributionPercent: number;
};

/** A pair of resources matched across the two scans, with the token delta (B − A). */
export type ResourceMatch = {
  a: ComparedResource;
  b: ComparedResource;
  basis: ToolMatchBasis;
  similarity: number;
  deltaTokens: number;
  deltaPercent: number;
};

/** A pair of prompts matched across the two scans, with the token delta (B − A). */
export type PromptMatch = {
  a: ComparedPrompt;
  b: ComparedPrompt;
  basis: ToolMatchBasis;
  similarity: number;
  deltaTokens: number;
  deltaPercent: number;
};

/** Lightweight reference to one side (one scan) of a comparison. */
export type ScanCompareRef = {
  scanId: string;
  serverId: string;
  serverName: string;
  tokenProfile: TokenProfileId;
  scannedAt: string;
  totalTools: number;
  totalTokens: number;
};

/** Result of comparing two scans at the tool level (same-server or cross-server). */
export type ScanComparison = {
  a: ScanCompareRef;
  b: ScanCompareRef;
  /** True when both scans are of the same server (the historical same-server diff case). */
  sameServer: boolean;
  /** True when both scans used the same token profile (deltas are otherwise profile-confounded). */
  sameProfile: boolean;
  /**
   * True only when the two scans' token counts are on the SAME scale and can be subtracted honestly —
   * i.e. same token profile AND same counting version. When false, every token delta below is
   * SUPPRESSED to 0 (raw deltas would conflate tokenizer/method differences with real surface change);
   * server/tool matching (matched/onlyInA/onlyInB, basis, definitionDelta) is still valid.
   */
  deltasComparable: boolean;
  /** B − A on scan totals. Suppressed to 0 when `deltasComparable` is false. */
  totalsDeltaTokens: number;
  totalsDeltaPercent: number;
  /** The fuzzy-match cutoff that produced this result (0..1). */
  threshold: number;
  matched: ToolMatch[];
  onlyInA: ComparedTool[];
  onlyInB: ComparedTool[];
  counts: { matched: number; onlyInA: number; onlyInB: number };
  resourceMatched: ResourceMatch[];
  resourceOnlyInA: ComparedResource[];
  resourceOnlyInB: ComparedResource[];
  resourceCounts: { matched: number; onlyInA: number; onlyInB: number };
  promptMatched: PromptMatch[];
  promptOnlyInA: ComparedPrompt[];
  promptOnlyInB: ComparedPrompt[];
  promptCounts: { matched: number; onlyInA: number; onlyInB: number };
};

export type HealthPayload = {
  ok: true;
  service: "mcp-token-footprint";
  version: string;
  databasePath: string;
  dataDirectory: string;
  dockerMode: boolean;
  defaultTokenProfile: TokenProfileId;
};

export type ToolCallResult = {
  toolName: string;
  isError: boolean;
  durationMs: number;
  tokenProfile: TokenProfileId;
  requestTokens: number;
  requestBytes: number;
  responseTokens: number;
  responseBytes: number;
  content: unknown;
  structuredContent?: unknown;
  raw: unknown;
  errorMessage?: string;
  // Set true when the call failed because the server's OAuth token needs interactive reauth (only
  // for streamable-HTTP + oauth servers). The web turns this into the reauth modal + a single retry.
  authRequired?: boolean;
};

export type ResourceReadResult = {
  uri: string;
  isError: boolean;
  durationMs: number;
  tokenProfile: TokenProfileId;
  requestTokens: number;
  requestBytes: number;
  responseTokens: number;
  responseBytes: number;
  contents: unknown; // MCP resource contents array
  raw: unknown;
  errorMessage?: string;
  // Set true when the read failed because the server's OAuth token needs interactive reauth (only
  // for streamable-HTTP + oauth servers). The web turns this into the reauth modal + a single retry.
  authRequired?: boolean;
};

export type PromptGetResult = {
  promptName: string;
  isError: boolean;
  durationMs: number;
  tokenProfile: TokenProfileId;
  requestTokens: number;
  requestBytes: number;
  responseTokens: number;
  responseBytes: number;
  description?: string;
  messages: unknown; // MCP prompt messages array
  raw: unknown;
  errorMessage?: string;
  // Set true when the get failed because the server's OAuth token needs interactive reauth (only
  // for streamable-HTTP + oauth servers). The web turns this into the reauth modal + a single retry.
  authRequired?: boolean;
};

// --- Server connectivity / test (preflight + reauth) -----------------------------------------

/**
 * Result of `POST /api/servers/:id/test` — a full `discoverTools` round-trip. `authRequired` is set
 * (only for streamable-HTTP + oauth servers) when the failure is an auth error, so the UI can offer
 * reauth instead of a dead-end toast. Was previously an inline type in the web layer.
 */
export type ServerTestResponse = {
  ok: boolean;
  serverId: string;
  tools: number;
  durationMs: number;
  errorMessage?: string;
  events: string[];
  authRequired?: boolean;
};

/**
 * Result of `POST /api/servers/:id/connectivity` — a LIGHTWEIGHT connect→close preflight (no
 * tools/list). Connecting exercises the MCP SDK's silent token refresh, so a still-refreshable
 * token passes with `ok:true`. `authRequired` (only for streamable-HTTP + oauth servers) means
 * interactive reauth is required; `oauthAvailable` reports whether OAuth metadata was discoverable.
 */
export type ConnectivityResponse = {
  serverId: string;
  ok: boolean;
  authRequired: boolean;
  oauthAvailable: boolean;
  message: string;
  errorMessage?: string;
};

// --- Testing (runs) contract ---------------------------------------------------------------

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type RunMode = (typeof RUN_MODES)[number];

/**
 * Testing IA (WP 1.1) — how a run plan was launched: a saved `suite`, a `collection` (all its tests ×
 * the chosen scenarios), or an `adhoc`/interactive plan. All three execute as a suite-run through the
 * one orchestrator; this value is also stamped additively on the resulting suite-run summary
 * ({@link SuiteRun.source}). See `runPlanInputSchema` in schemas.ts.
 */
export type RunPlanSource = (typeof RUN_PLAN_SOURCES)[number];

/** Per-scenario MCP tool-footprint strategy (`eager` full prefix vs `deferred` tool search). */
export type ToolLoadingMode = (typeof TOOL_LOADING_MODES)[number];

export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Terminal consequence of a run. The engine sets `completed`/`stopped_guardrail`/`context_overflow`/
 * `error`/`aborted`. `assertions_failed` is set POST-completion by the run-service assertion hook:
 * the run completed normally but at least one skill-gate assertion failed (SkillFlow WP 5.1
 * follow-up, owner decision 2026-07-03) — it never masks an engine outcome, and `unevaluable`
 * assertions never trigger it.
 */
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/**
 * Auto-Rating (AR11) — the post-run REVIEW axis (see {@link RATING_STATES}). Orthogonal to
 * {@link RunStatus}/{@link SuiteRunStatus}: rating never blocks or mutates a terminal status. Carried
 * additively on {@link RunSummary} and {@link SuiteRun}, and streamed as the `rating` member of
 * {@link RunEvent}/{@link SuiteRunEvent}.
 */
export type RatingState = (typeof RATING_STATES)[number];

export type RunStepType = (typeof RUN_STEP_TYPES)[number];

/**
 * Observability (WP3.1, D-OB17) — a step's ROLE in the run's step TREE (see {@link SPAN_KINDS}).
 * Orthogonal to {@link RunStepType} (the unchanged wire/DB step `type`); OPTIONAL on {@link RunStep}
 * (a pre-WP3.1 step carries none → renders flat).
 */
export type SpanKind = (typeof SPAN_KINDS)[number];

export type ContextSegment = (typeof CONTEXT_SEGMENTS)[number];

export type ModelParams = {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  reasoningEffort?: "low" | "medium" | "high";
};

// Redacted — never carries the key.
export type ProviderCredential = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  hasKey: boolean;
  /**
   * Claude subscription (WP 0.2, D-CS7) — true when the credential's auth is currently unresolvable:
   * a `claude_subscription` credential with no signed-in subscription (or no resolver configured).
   * The provider stays listed but runs refuse until the owner signs in again. Non-secret (a flag, never
   * a token); undefined for a credential that carries its own API key.
   */
  authBroken?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderCredentialInput = {
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  apiKey?: string;
};

export type ProviderCredentialUpdate = Partial<ProviderCredentialInput>;

// One model the provider's own API reports as available for a credential — the live roster that
// drives the scenario model picker (GET /api/providers/:id/models). The id is what gets stored on
// the scenario; displayName/contextWindow are populated only when the provider returns them.
export type AvailableModel = {
  id: string;
  displayName?: string;
  contextWindow?: number;
};

// Response of GET /api/providers/:id/models. `source` is always "provider" today (the list came
// from the provider API); it leaves room for a future "fallback" source without a breaking change.
export type AvailableModelsResponse = {
  models: AvailableModel[];
  source: "provider";
};

export type GuardrailConfig = {
  maxTurns?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  maxContextTokens?: number;
  maxCostUsd?: number;
  /**
   * Overall run wall-clock cap in milliseconds (issue #10). Unlike the accumulator budgets above, this
   * is time-based and enforced directly in the run loop (not by `check()`); when it elapses the run is
   * stopped so no run outlives it. Omitted ⇒ the engine's sane default applies.
   */
  maxRunDurationMs?: number;
};

// Reuse the existing token-profile union; "provider_actual" is handled as a separate lens, not a
// TokenCounter.
export type TokenProfileRef = TokenProfileId;

export type AllowedServer = {
  serverId: string;
  allowedTools: string[] | null; // null = all tools
};

export type Scenario = {
  id: string;
  name: string;
  providerId: string;
  model: string;
  params: ModelParams;
  systemPrompt: string;
  allowedServers: AllowedServer[];
  /** Skills attached to this scenario (Phase 2 — WP 2.1). Additive; existing scenarios default `[]`. */
  allowedSkills: AllowedSkill[];
  defaultProfiles: TokenProfileRef[];
  guardrails: GuardrailConfig;
  /** How MCP tool definitions are loaded for this scenario's runs (`eager` default vs `deferred`). */
  toolLoadingMode: ToolLoadingMode;
  createdAt: string;
  updatedAt: string;
};

export type ScenarioInput = Omit<Scenario, "id" | "createdAt" | "updatedAt">;

export type AttachmentKind = "file" | "image" | "text";

export type TestAttachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  bytes: number;
  createdAt: string;
};

// Upload payload for POST /api/tests/:id/attachments. v1 carries the blob as base64 inside JSON
// (no @fastify/multipart — owner-gated new dep; see WP 2.1).
export type TestAttachmentInput = {
  kind: AttachmentKind;
  name: string;
  contentBase64: string;
};

// --- SkillFlow validation-gate assertions (WP 5.1) -------------------------------------------
// A test's gate expectations, evaluated ONLY from a run's trace alignment (D4: no execution added).
// Additive on `Test` (the reserved `tests.assertions_json` column — D8); every field optional so an
// existing test carries none and behaves exactly as before.

/** What a `skillGates` assertion expects of the referenced node's alignment verdict. */
export type SkillGateExpectation = (typeof SKILL_GATE_EXPECTATIONS)[number];

/** "Node N of skill S must `pass` (verdict ok, gate genuinely reached) / be `visited`." */
export type TestSkillGate = {
  skillId: string;
  nodeId: string;
  expect: SkillGateExpectation;
};

/** "Gatekeeper G of skill S must have taken edge `expectedEdgeId` (traversed ≥ once)." */
export type TestSkillRoute = {
  skillId: string;
  gatekeeperId: string;
  expectedEdgeId: string;
};

/** The reserved `tests.assertions_json` payload — all fields optional/additive. */
export type TestAssertions = {
  skillGates?: TestSkillGate[];
  skillRoutes?: TestSkillRoute[];
  /** No verdict with status `fracture` across ALL of the run's attached skills' alignments. */
  noFractures?: boolean;
};

/** The evaluated status of one assertion (see {@link ASSERTION_RESULT_STATUSES}). */
export type AssertionResultStatus = (typeof ASSERTION_RESULT_STATUSES)[number];

/**
 * An assertion echoed back on its result — a discriminated union on `kind` so the UI can render it +
 * build the skill deep-link. `skillGate`/`skillRoute` carry their `skillId`; `noFractures` is run-wide.
 */
export type AssertionRef =
  | ({ kind: "skillGate" } & TestSkillGate)
  | ({ kind: "skillRoute" } & TestSkillRoute)
  | { kind: "noFractures" };

/**
 * One assertion's evaluation result (WP 5.1). `assertion` echoes the source assertion; `status` is the
 * honest verdict; `reason` explains it; `evidence` cites the trace-event `idx`s (when the underlying
 * verdict has them); `confidence` propagates the underlying verdict's `exact`/`inferred` tag.
 * `unevaluable` (misconfigured assertion) never fails a run.
 */
export type AssertionResult = {
  assertion: AssertionRef;
  status: AssertionResultStatus;
  reason: string;
  evidence?: number[];
  confidence?: TraceVerdictConfidence;
};

// --- Benchmarks — graded-tests contract (WP 1.1, B1–B5) --------------------------------------
// The output-quality grading vocabulary. WP 1.1 lands the FULL downstream surface (grader ids +
// finding shapes later graders consume) so no later WP re-touches this file. Everything here is
// ADDITIVE: a Test with no `expectations` and a run with no grades behave exactly as today.

/** A test's authored difficulty band (analytics metadata). */
export type Difficulty = (typeof TEST_DIFFICULTIES)[number];

/** A {@link ReferenceLogic} block's kind — a code snippet or prose. */
export type ReferenceLogicKind = (typeof REFERENCE_LOGIC_KINDS)[number];

/**
 * One grader in the roster (see {@link GRADER_IDS}) — either an expectation grader (runs only when
 * a test declares `expectations`) or one of the always-on base-rating graders (see
 * {@link BASE_RATING_GRADER_IDS}, Auto-Rating WP 1.1, AR1/AR6).
 */
export type GraderId = (typeof GRADER_IDS)[number];

/** A grade's family — deterministic (offline) or llm (judge-backed). */
export type GradeKind = (typeof GRADE_KINDS)[number];

/** A grade's honest evaluation status (see {@link GRADE_STATUSES}). */
export type GradeStatus = (typeof GRADE_STATUSES)[number];

/** How an LLM judge produced its score (an honest method stamp). */
export type JudgeMethod = (typeof JUDGE_METHODS)[number];

/** Severity of a {@link ToolHygieneFinding}. */
export type ToolHygieneSeverity = (typeof TOOL_HYGIENE_SEVERITIES)[number];

/** Reference logic handed to a judge as a DOCUMENT — never executed (B15). */
export type ReferenceLogic = { kind: ReferenceLogicKind; language?: string; body: string };

/** B1 ground-truth block on a Test. Every field optional — a test without it behaves as today. */
export type TestExpectations = {
  expectedInsight?: string;
  expectedValue?: unknown; // structured JSON
  referenceLogic?: ReferenceLogic;
  answerable?: boolean; // default true (a false value marks an unanswerable question)
  rubricOverride?: string;
};

/** One finding from the tool_hygiene grader (WP 2.1), carried in a grade's evidence. Shape front-loaded here. */
export type ToolHygieneFinding = {
  checkId: string;
  severity: ToolHygieneSeverity;
  stepIdx: number;
  message: string;
};

/** A persisted grade row (B2/B4/B5). Append-only; latest-per-grader wins for display. */
export type RunGrade = {
  id: string;
  runId: string;
  graderId: GraderId;
  kind: GradeKind;
  status: GradeStatus;
  score: number | null; // 0–1 normalized; null unless status === 'graded'
  rawScore: number | null; // grader-native (e.g. 0–10 judge); null otherwise
  method: string; // e.g. 'logprob_weighted' | 'single_sample' | a deterministic method name
  reasoning: string | null;
  evidence: unknown | null; // parsed evidence_json (e.g. ToolHygieneFinding[] or cited step idxs)
  judgeProviderId: string | null;
  judgeModel: string | null;
  judgeTokensIn: number;
  judgeTokensOut: number;
  judgeCostUsd: number; // SEPARATE ledger — never folded into run cost_usd (B5)
  gradingVersion: number;
  createdAt: string;
};

/** B3 default judge — references only, NEVER key material. */
export type JudgeSettings = { providerCredentialId: string | null; model: string | null };

/**
 * Which judge would rate a run NOW (Auto-Rating WP 2.3, AR3). The resolution chain is
 * `claude_cli` (Claude subscription signed in) → `provider` (a configured provider judge) → `none`
 * (no LLM judge — deterministic facets still emit, LLM facets go `unevaluable`).
 */
export type ResolvedJudgeSource = "claude_cli" | "provider" | "none";

/**
 * `GET/PUT /api/grading/judge-settings` response (Auto-Rating WP 2.3, AR3). Wraps the provider
 * {@link JudgeSettings} (references only) with the resolved judge source so Settings can show
 * "rating via Claude CLI (<model>)" vs "provider judge" vs "none". `cliAvailable` is a SERVER-SIDE
 * boolean (a Claude subscription is signed in) — the subscription token is NEVER included. `cliModel`
 * is the resolved CLI judge model (the persisted Settings value, default from the CLI-judge default).
 */
export type JudgeSettingsResolved = {
  settings: JudgeSettings;
  cliAvailable: boolean;
  cliModel: string;
  resolvedSource: ResolvedJudgeSource;
};

/** `PUT /api/grading/judge-settings` body (WP 2.3) — provider judge settings + optional CLI model. */
export type JudgeSettingsUpdate = JudgeSettings & { cliModel?: string };

export type Test = {
  id: string;
  name: string;
  userPrompt: string;
  systemPromptOverride?: string;
  addedProfiles: TokenProfileRef[];
  attachments: TestAttachment[];
  /** Validation-gate assertions (WP 5.1) — reserved `assertions_json` column (D8). Additive/optional. */
  assertions?: TestAssertions;
  /** B1 — ground-truth/grading block. Additive/optional; reserved `expectations_json` column (D8 pattern). */
  expectations?: TestExpectations;
  category?: string;
  difficulty?: Difficulty;
  /** Analytics metadata; existing tests hydrate to `[]` (supplied via `.default([])` in the input schema). */
  tags: string[];
  /**
   * Benchmarks (WP 4.1, B10) — collection membership. `collectionId` is the local id of the
   * {@link Collection} this test belongs to (NULL/undefined = local-only); `externalKey` is its
   * cross-system identity within that collection (stamped on membership; the local `id` never leaves
   * the API — see the on-disk {@link TestFile}). Both are managed by the collections membership
   * endpoints, NOT the test CRUD input (hence excluded from {@link TestInput}). Additive/optional.
   */
  collectionId?: string | null;
  externalKey?: string | null;
  /**
   * Observability (WP4.1) — a DRAFT test, currently only minted by a watch rule's `promote_to_test`
   * action from a terminal run. Additive/optional: absent (the default) reads exactly as a normal
   * test. A draft is a fully-editable test that is CLEARLY MARKED as needing review — it NEVER
   * auto-runs (nothing here triggers a run; the run engine is only ever driven by an explicit launch).
   * Serialized only when true (the omit-when-false discipline) so an ordinary test's shape is unchanged.
   */
  draft?: boolean;
  createdAt: string;
  updatedAt: string;
};

// The create/update payload. `tags` is OPTIONAL on the input (the zod schema fills it via
// `.default([])`) even though every hydrated `Test` carries it as a real array — the standard
// zod input-vs-output split. Testing IA (WP 2.3): `collectionId` is an OPTIONAL create/move knob —
// provided → validate + set; absent-on-create → default "Local"; absent-on-update → preserve. It is
// re-declared explicitly (as `string`, not `string | null`) rather than inherited from `Test` so the
// input type matches the zod schema. `externalKey` stays membership-managed (never a CRUD input).
export type TestInput = Omit<
  Test,
  "id" | "attachments" | "createdAt" | "updatedAt" | "tags" | "collectionId" | "externalKey"
> & {
  tags?: string[];
  collectionId?: string;
};

// --- Benchmarks — suites (WP 3.1, B7) --------------------------------------------------------
// A Suite is a first-class entity; a suite RUN is a test × scenario × repetition matrix executed as
// ordinary persisted runs (the orchestrator is WP 3.2 — not built here). WP 3.1 front-loads the FULL
// downstream suite/analytics/variant/failure-bucket contract so no later WP (3.2–3.5, 5.1) re-touches
// this file. Everything below is additive — a repo with no suites behaves exactly as today.

/** A suite run's lifecycle status (see {@link SUITE_RUN_STATUSES}). */
export type SuiteRunStatus = (typeof SUITE_RUN_STATUSES)[number];

/** WP 5.1 skill-effect axis (front-loaded). A variant overrides skill attachments on a base scenario. */
export type SuiteVariant = {
  label: string;
  scenarioId: string;
  skillOverrides: {
    attach?: { skillId: string; versionId: string | "latest" }[];
    detach?: string[];
  };
};

/** A suite's execution config. `repetitions`/`maxConcurrency` are bounded (see the SUITE_* constants). */
export type SuiteConfig = {
  repetitions: number; // 1..SUITE_MAX_REPETITIONS
  maxConcurrency: number; // 1..SUITE_MAX_CONCURRENCY
  aggregateCostCapUsd?: number;
  judgeOverride?: JudgeSettings; // reuse the WP 1.1 type
  variants?: SuiteVariant[]; // WP 5.1
};

/** A suite — its membership (ordered tests + a default scenario set) + execution config. */
export type Suite = {
  id: string;
  name: string;
  description?: string;
  config: SuiteConfig;
  testIds: string[]; // ordered membership (suite_tests.position)
  scenarioIds: string[]; // default scenario set
  /**
   * Benchmarks (WP 4.1, B10) — collection membership (same semantics as {@link Test}'s). Managed by
   * the collections membership endpoints, not suite CRUD; excluded from {@link SuiteInput}.
   */
  collectionId?: string | null;
  externalKey?: string | null;
  createdAt: string;
  updatedAt: string;
};

// Testing IA (WP 2.3) — `collectionId` is an OPTIONAL create/move knob with the same semantics as
// {@link TestInput}'s (provided → validate + set; absent-on-create → default "Local"; absent-on-update
// → preserve). Re-declared explicitly (as `string`) so the input type matches the zod schema;
// `externalKey` stays membership-managed and is never a CRUD input.
export type SuiteInput = Omit<
  Suite,
  "id" | "createdAt" | "updatedAt" | "collectionId" | "externalKey"
> & {
  collectionId?: string;
};

/** One matrix cell (WP 3.2/3.3). `variantLabel` present only for skill-effect suites. */
export type SuiteCell = {
  testId: string;
  scenarioId: string;
  variantLabel?: string;
  repetition: number;
  runId?: string;
  status: string;
  score?: number | null;
};

/** Rolled-up metrics of a suite run (WP 3.2/3.4). `failureBuckets` is derived + opt-in (WP 3.5). */
export type SuiteAggregates = {
  cellsTotal: number;
  cellsCompleted: number;
  meanGrade: number | null;
  gradeStdDev: number | null;
  passRateAt05: number | null;
  totalTokens: number;
  /**
   * RM-33 (D-CT2) — cache composition rolled up across the matrix. `totalTokens` is unchanged.
   * `undefined` when ANY member run's split is unknown: a partial sum would understate the fleet,
   * so the aggregate says "unknown" rather than a number that looks complete.
   */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  execCostUsd: number;
  judgeCostUsd: number;
  failureBuckets?: FailureBucket[]; // WP 3.5 (derived, opt-in)
};

/** One executed suite run (the matrix instance). `configSnapshot` freezes the config used. */
export type SuiteRun = {
  id: string;
  /**
   * Testing IA (WP 2.2, D-T5) — the owning saved suite, OPTIONAL: only a `source:'suite'` run has one.
   * A `collection`/`adhoc` plan (see {@link SuiteRun.source}) executes as a suite-run through the same
   * orchestrator but creates NO Suite row, so its `suiteId` is absent. Widened from a required `string`
   * (a pre-WP-2.2 suite run always had one); every reader must tolerate its absence.
   */
  suiteId?: string;
  status: SuiteRunStatus;
  configSnapshot: SuiteConfig;
  startedAt: string;
  endedAt?: string;
  aggregates?: SuiteAggregates;
  /**
   * Testing IA (WP 1.1) — how this suite run was launched (`suite` | `collection` | `adhoc`). Every
   * plan runs as a suite-run through the one orchestrator; `source` lets the unified Runs feed label
   * it. Additive/optional: a suite run produced before this field carries none; WP 2.2/3.2 stamp +
   * read it. See {@link RunPlanSource} + `runPlanInputSchema`.
   */
  source?: RunPlanSource;
  /**
   * Auto-Rating (AR11) — the suite-level review axis (see {@link RatingState}): `rating` while the
   * post-`finish()` suite-report hook runs, then a settled state. Always sent by current servers (the
   * column is NOT NULL, backfilled by migration v27); optional on the type only for wire additivity.
   * NEVER a new member of {@link SuiteRunStatus}.
   */
  ratingState?: RatingState;
};

/**
 * One executed member of a suite run — a persisted child {@link RunSummary} enriched with its
 * selected-grader `score` (+ attributed `variantLabel` for skill-effect suites). Read purely from
 * `runs` + `run_grades`, so it materialises IDENTICALLY for a LIVE and a FINISHED suite run (unlike
 * the live-only `cell` SSE events). Served by `GET /api/suite-runs/:id/members`. Extends
 * {@link RunSummary} so the Runs table can render it directly and the matrix can derive a
 * {@link SuiteCell} seed from it (`{testId, scenarioId, repetition, runId, status, score}`).
 */
export type SuiteRunMember = RunSummary & {
  /** The selected-grader (default primary-priority) score, or null when this run has no graded score. */
  score: number | null;
  /** WP 5.1 — variant label attributed from `run_skills` vs the config snapshot; absent otherwise. */
  variantLabel?: string;
};

/**
 * How much of each member run a suite-run report embeds. `summary` (default) carries per-cell
 * tokens/cost/status/score; `full` additionally embeds each member's complete run report
 * (steps/events/statistics). See `suiteRunReportQuerySchema`.
 */
export type SuiteRunReportEmbed = "summary" | "full";

/**
 * One event on a suite run's live SSE stream (WP 3.2/3.3, B8/B9). `cell` announces a matrix-cell state
 * transition (started → settled); `aggregates` carries a recomputed rolled-up snapshot; `status` is the
 * suite-run lifecycle. LIFTED from `apps/api/src/suites/suite-run-manager.ts` (where it was a local
 * envelope while WP 3.2 was API-only) so the web console can consume the stream contract-first —
 * `SuiteCell`/`SuiteAggregates`/`SuiteRunStatus`, the payloads, already live here.
 *
 * `seq` mirrors {@link RunEvent}'s: a per-run monotonic emission sequence stamped once by
 * `SuiteRunManager.emit` BEFORE buffering / fan-out, so an SSE client dedupes a reconnect's replayed
 * buffer by `seq > lastAppliedSeq`. Optional/additive: absent on the persisted-replay path (a finished
 * suite run's `/stream` synthesizes aggregates + terminal status once, with no reconnect overlap).
 */
export type SuiteRunEvent = (
  | { type: "cell"; cell: SuiteCell }
  | { type: "aggregates"; aggregates: SuiteAggregates }
  | { type: "status"; status: SuiteRunStatus }
  // Auto-Rating (AR11) — the suite-level review axis, emitted AFTER the terminal `status` (around the
  // post-`finish()` suite-report hook). Mirrors {@link RunEvent}'s `rating` member exactly; the suite
  // SSE stream closes only after a settled state (`rated`/`failed`/`skipped`) on top of the terminal.
  | { type: "rating"; state: RatingState }
  // Unified Sessions (WP2.3, D-US8 follow-up) — SSE keepalive event emitted on the suite stream every
  // ~15s in place of the old raw `: ping\n\n` SSE comment, mirroring {@link RunEvent}'s `ping` member
  // (WP1.1/WP2.1) EXACTLY: same shape, carries nothing but its `type` (+ the shared `seq` — a ping never
  // carries one). Closes the gap the WP2.R stream review found: a `: ping` comment is invisible to
  // `EventSource.onmessage`, so a client watchdog keyed off "any message" could false-trip on a
  // legitimately-quiet-but-alive suite run. Additive/ignorable — a consumer that ignores it is unaffected.
  | { type: "ping" }
) & {
  seq?: number;
};

/** WP 3.4 analytics (front-loaded) — one quality×cost scatter point per matrix subject. */
export type SuiteScatterPoint = {
  testId: string;
  scenarioId: string;
  variantLabel?: string;
  meanScore: number | null;
  meanTokens: number;
  meanCostUsd: number;
  reps: number;
};

/** WP 3.4 analytics (front-loaded) — a metadata-dimension breakdown slice (category/difficulty/tag). */
export type SuiteBreakdownSlice = {
  dimension: "category" | "difficulty" | "tag";
  key: string;
  scenarioId: string;
  meanScore: number | null;
  meanCostUsd: number;
  count: number;
};

/** WP 3.4 analytics (front-loaded) — the full analytics payload for a suite run. */
export type SuiteAnalytics = { scatter: SuiteScatterPoint[]; breakdowns: SuiteBreakdownSlice[] };

/** WP 3.5 (front-loaded) — a cluster of low-scoring runs sharing a failure characteristic. */
export type FailureBucket = {
  label: string;
  description: string;
  memberRunIds: string[];
  share: number;
};

/** WP 5.1 delta view (front-loaded) — base-vs-variant deltas for one test in a skill-effect suite. */
export type SuiteDeltaRow = {
  testId: string;
  baseLabel: string;
  variantLabel: string;
  gradeDelta: number | null;
  tokensDelta: number;
  costDelta: number;
};

// --- Benchmarks — collections & two-way git sync (WP 4.1, B10–B13) ----------------------------
// A Collection binds a set of tests/suites to a git repo so a team can share and version them. WP 4.1
// lands the entity + the ON-DISK file format + the sync-state shapes; the git engine (clone/commit/
// fetch/merge — WP 4.2) and the sync UI (WP 4.3) consume these, never redefine them.

/**
 * A synced collection (B10). REDACTED like {@link ProviderCredential}: it exposes only a `hasPat`
 * boolean — the PAT itself is encrypted at rest and NEVER returned by the API. `lastSyncedSha` is the
 * commit the working clone last converged on (NULL before the first sync — WP 4.2). Members are the
 * tests/suites whose `collectionId` points here; deleting a collection makes them local-only again.
 *
 * Testing IA (WP 1.1/2.1) — a collection may now be UNBOUND (local): `isDefault` marks the reserved,
 * undeletable "Local" collection (see {@link DEFAULT_COLLECTION_NAME}). The WRITE contract already
 * supports an unbound collection ({@link CollectionInput} + `collectionInputSchema`: the repo binding
 * is an optional group). WP 2.1 widens the READ-side repo fields to nullable (all three NULL for a
 * local collection, all three present for a bound one) atomically with the API null-guard in
 * `apps/api/src/collections/git-sync.ts` (`requireBinding`) so `/sync`, `/status`, `/resolve` on an
 * unbound collection answer an honest 400 (`REPO_NOT_BOUND_CODE`). `isDefault` is populated by the API
 * redactor from the `is_default` column (undefined ⇒ not default for older payloads).
 */
export type Collection = {
  id: string;
  name: string;
  isDefault?: boolean; // true only for the reserved, undeletable, never-repo-bound "Local" collection
  // (WP 2.1) NULL on a local/unbound collection; a bound collection carries all three (repoPath may be
  // "" = repo root). The git-sync engine narrows them via `requireBinding` or fails 400 REPO_NOT_BOUND.
  repoUrl: string | null;
  repoPath: string | null;
  branch: string | null;
  hasPat: boolean; // never the value
  lastSyncedSha?: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Create/update payload for a collection. `pat` is WRITE-ONLY (accepted, encrypted, never returned).
 *
 * Testing IA (WP 1.1) — the repo binding is an OPTIONAL group (see `collectionInputSchema`): supply
 * `repoUrl` + `repoPath` + `branch` together for a git-bound collection, or omit all three for a
 * local/unbound one. A partial binding, or a `pat` without a binding, is rejected at the schema.
 */
export type CollectionInput = {
  name: string;
  repoUrl?: string;
  repoPath?: string;
  branch?: string;
  pat?: string; // write-only, only valid with a repo binding
};

/**
 * The ON-DISK test file (B12). Carries NO local id, NO provider/server references, and NO secrets —
 * `externalKey` is the cross-system identity. Attachments are NOT written (their bytes never sync); a
 * test that had attachments serializes with `warnings: ["attachments-not-synced"]` so the omission is
 * explicit and reviewable. Serialized deterministically (stable key order, 2-space indent, trailing
 * newline) so git diffs stay clean.
 */
export type TestFile = {
  formatVersion: number; // COLLECTION_FILE_FORMAT_VERSION
  externalKey: string; // cross-system identity
  name: string;
  userPrompt: string;
  systemPromptOverride?: string;
  expectations?: TestExpectations; // reuse WP 1.1 type
  category?: string;
  difficulty?: Difficulty;
  tags: string[];
  addedProfiles: TokenProfileRef[];
  warnings?: string[]; // e.g. ["attachments-not-synced"] when the test had attachments
};

/**
 * The ON-DISK suite file (B12). References its member tests BY `externalKey` (ordered) + config — never
 * local ids. `scenarioHints` are informational scenario NAMES only; a suite's scenario binding is
 * resolved locally on import (never carried as local ids).
 */
export type SuiteFile = {
  formatVersion: number;
  externalKey: string;
  name: string;
  description?: string;
  config: SuiteConfig; // reuse WP 3.1 type
  testExternalKeys: string[]; // ordered refs by externalKey (NOT local ids)
  scenarioHints?: string[]; // informational scenario names only; binding happens locally
};

/** One file that diverged on both sides — the file path plus both parsed sides (WP 4.2/4.3 consume). */
export type SyncConflict = { path: string; local: string; remote: string };

/** A collection's live sync state relative to its remote (front-loaded for WP 4.2/4.3). */
export type CollectionSyncState = {
  ahead: number;
  behind: number;
  dirty: boolean;
  conflicts: SyncConflict[];
};

/** The result of a sync attempt (front-loaded for WP 4.2/4.3). */
export type CollectionSyncResult = {
  status: "unchanged" | "pushed" | "pulled" | "merged" | "conflicts";
  state: CollectionSyncState;
  message?: string;
};

export type TokenUsageActual = {
  /** Provider-billed input total — INCLUDES the cached slice (cache read + cache write). */
  inputTokens: number;
  outputTokens: number;
  /** Cache read + cache write, merged. Kept for the token KPIs (`tokensIn` / `cachedTokens`). */
  cachedInputTokens?: number;
  /** Cache-read (hit) tokens — billed at the discounted cache-read rate (`cachedInPer1M`). */
  cacheReadTokens?: number;
  /** Cache-write (creation) tokens — billed at 1.25× input (Anthropic 5-min cache). */
  cacheWriteTokens?: number;
  reasoningTokens?: number;
};

/**
 * RM-33 (D-CT2) — how faithfully a {@link TokenUsageActual} can answer "how much of the input was a
 * cache READ, and how much was a cache WRITE".
 *
 *  - `"exact"`  — the provider reported the split; read and write can be priced and shown separately.
 *  - `"merged"` — only the merged {@link TokenUsageActual.cachedInputTokens} survived (a legacy row,
 *    or a backend that reports one number). The whole cached slice is priced as a READ, because that
 *    is the only safe reading of a merged figure — and a surface MUST say the split is unavailable
 *    rather than imply the precision it does not have.
 *  - `"none"`   — no cache slice at all.
 */
export type CostBreakdownSplit = "exact" | "merged" | "none";

/**
 * RM-33 (D-CT5) — the four terms behind a single `costUsd`, plus the number that makes caching
 * legible. Produced by the API's `computeCostBreakdown`, which {@link CostBreakdownSplit} governs;
 * `estimateCost` is a thin caller of it, so there is exactly ONE cost formula in the app.
 */
export type CostBreakdown = {
  /** Input tokens billed at the full rate (`inPer1M`). */
  uncachedUsd: number;
  /** Cache-read tokens billed at `cachedInPer1M` (~0.1x input — a discount). */
  cacheReadUsd: number;
  /** Cache-write tokens billed at `cacheWritePer1M` (default 1.25x input — a PREMIUM). */
  cacheWriteUsd: number;
  outputUsd: number;
  /** The sum of the four terms. Identical to `estimateCost(...)` for the same inputs, by construction. */
  totalUsd: number;
  /**
   * What the SAME tokens would have cost with every input token at the full rate, minus `totalUsd`.
   * **This can be NEGATIVE** — a cache write costs more than an uncached token, so a write-heavy
   * turn genuinely spent extra. A surface that renders this as "savings" without honouring the sign
   * is lying about a premium.
   */
  savedVsUncachedUsd: number;
  /**
   * `false` ONLY when the model has no pricing entry at all — i.e. every USD field is `0` because we
   * cannot price it, not because it is free. Mirrors `isModelPriced`; an explicit zero-price local
   * model is `true`.
   */
  priced: boolean;
  split: CostBreakdownSplit;
};

export type ContextSnapshot = {
  total: number;
  limit: number;
  segments: Record<ContextSegment, number>;
};

/**
 * Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 0.1, D-CS8) — discriminates HOW a run's
 * `costUsd` was derived (D-CS4): reuse the "est." badge idea, don't invent a parallel one.
 *   - `"api_exact"`          — the default/normal path: a metered provider API call, real billed cost.
 *   - `"subscription_reference"` — the run went through a signed-in Claude subscription
 *     (`claude_subscription` {@link ProviderKind}); marginal cost is $0 (covered by the
 *     subscription), and `costUsd` is a SHADOW price = real, provider-exact token counts x the
 *     Anthropic list rate for the model used — a reference estimate for cost comparison, not a
 *     charge. UI/reports must label this "est. · subscription".
 * Optional/additive on every field that carries it ({@link RunSummary.costBasis}, the `kpi`
 * {@link RunEvent} variant): absent (or `"api_exact"`) means "normal, exactly-billed cost" — the
 * meaning of every run persisted before this field existed is unchanged.
 */
export type CostBasis = "api_exact" | "subscription_reference";

// ==================================================================================================
// Unified Sessions — session contract (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1)
// One shared lifecycle + capability vocabulary every run backend maps to. All additive: old persisted
// runs/events carry none of these fields and replay unchanged.
// ==================================================================================================

/**
 * Machine-readable terminal reason (closed union, {@link STOP_REASON_CODES}) carried alongside the
 * existing HUMAN {@link RunEvent} `stopReason` text and persisted in `runs.stop_reason_code` (WP1.6).
 * It is the single output stamped by the shared `terminalFor` table
 * (`apps/api/src/testing/session-terminal.ts`) and retires `guardrailFromReason`'s string-sniffing
 * (WP3.1). Additive/optional everywhere it appears — old rows/events have none.
 */
export type StopReasonCode = (typeof STOP_REASON_CODES)[number];

/**
 * A run's queryable, orthogonal lifecycle PHASE ({@link RUN_PHASES}, D-US1) — persisted (nullable) in
 * `runs.phase` (WP1.6) AND streamed as the additive `{type:"phase"}` {@link RunEvent} member.
 * Statuses ({@link RunStatus}) stay authoritative for running/terminal; phase layers on top (a
 * `running` run may be `waiting_input`/`stopping`, a `pending` run may be `queued`). Absent means
 * "no distinct phase".
 */
export type RunPhase = (typeof RUN_PHASES)[number];

/** Discriminates WHY a session is in the `waiting_input` phase ({@link WAITING_INPUT_REASONS}). */
export type WaitingInputReason = (typeof WAITING_INPUT_REASONS)[number];

/** How/whether a backend surfaces model reasoning ({@link SESSION_LIVE_REASONING}). */
export type SessionLiveReasoning = (typeof SESSION_LIVE_REASONING)[number];

/** Token-accounting fidelity of a backend ({@link SESSION_TOKEN_ACCOUNTING}). */
export type SessionTokenAccounting = (typeof SESSION_TOKEN_ACCOUNTING)[number];

/**
 * How a run's cost figure should be read ({@link SESSION_COST_BASES}). A superset of {@link CostBasis}
 * (its 2 members stay unchanged for their exhaustive consumers) plus the session-only basis `none`.
 */
export type SessionCostBasis = (typeof SESSION_COST_BASES)[number];

/**
 * The static-per-backend capability manifest (D-US4). Declared per adapter in
 * `apps/api/src/testing/session-capabilities.ts`, runtime-verifiable (a downgrade is recorded in
 * STATUS — README D-US4), persisted as `capabilities_json` (WP1.6) and emitted at session start. The
 * console gates on these facets instead of forking on `providerKind`, so a new backend renders
 * correctly with no new UI branch. Additive: a pre-contract run has none, and the console falls back
 * to credential-derived `providerKind` only for those.
 */
export type SessionCapabilities = {
  /** Streams assistant text deltas live. */
  liveText: boolean;
  /** Reasoning surface: none / raw text stream. */
  liveReasoning: SessionLiveReasoning;
  /** Emits `tool_call`/`tool_result` steps. */
  toolCalls: boolean;
  /** Context-window snapshots + % of limit are meaningful (drives the context tile/chart). */
  contextWindow: boolean;
  /** Token-count fidelity — exact (provider-reported) / none. */
  tokens: SessionTokenAccounting;
  /** Cost-figure basis — drives the cost tile's unit + accuracy marker. */
  costBasis: SessionCostBasis;
  /** Supports operator follow-up turns while live (`POST /api/runs/:id/turns`). */
  followUps: boolean;
  /** Exposes the agent-initiated `ask_user` question tool. */
  askUser: boolean;
  /**
   * Per-kind override for the SessionClock wait budget (ms) armed in `waiting_input` (D-US7).
   * Absent ⇒ the app/global default applies.
   */
  waitBudgetMs?: number;
};

/**
 * Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — CAPABILITY gate (D-US4: gate on the manifest,
 * never `providerKind === …`) for a MID-RUN fork: whether a run backend can be forked AT a step by
 * reconstructing + seeding its conversation prefix. True only for a session whose transcript is a
 * meaningful, replayable chat-completions history — i.e. it exposes context-window accounting AND
 * tool-call steps (the AI-SDK engine kinds). A `claude_subscription` child (`contextWindow:false`) is
 * excluded, so a mid-run fork of it is refused (422); a WHOLE-run re-launch (no `fromStepId`) still works for
 * EVERY kind. Absent capabilities (a pre-contract run) → false (conservative — no mid-run fork).
 */
export function supportsMidRunFork(capabilities: SessionCapabilities | undefined): boolean {
  return capabilities?.contextWindow === true && capabilities?.toolCalls === true;
}

/**
 * A still-open agent-initiated question recoverable from a reopened/replayed interactive run (D-US1 —
 * "open questions recoverable via GET"). Mirrors the emitted `question` {@link RunEvent} member minus
 * its resolution. Populated on {@link RunDetail.openQuestions} by WP1.6.
 */
export type RunOpenQuestion = {
  questionId: string;
  prompt: string;
  options?: RunQuestionOption[];
  allowOther?: boolean;
};

export type RunStep = {
  id: string;
  runId: string;
  index: number;
  type: RunStepType;
  label: string;
  status: "ok" | "error" | "running";
  durationMs?: number;
  serverId?: string;
  toolName?: string;
  // Estimator lenses — only the run's effective profiles are populated (a subset of the three);
  // provider-actual usage is the separate `usageActual` field. Partial by design (WP 1.3/1.4).
  profileTokens: Partial<Record<TokenProfileRef, number>>;
  // Byte size of a `tool_call`'s result payload (UTF-8 JSON), set on the MCP-bridge step. Drives the
  // byte-denominated SESSION_TOOL_RESULT_SIZE cap (e.g. OpenAI's 512KB). Optional/additive (only
  // tool-result steps carry it; older runs + other step types lack it).
  resultBytes?: number;
  usageActual?: TokenUsageActual; // provider-actual (llm steps)
  context?: ContextSnapshot; // snapshot after this step
  // WP 5.6 — running cumulative context tokens through this step (monotonic; tool defs + system +
  // history + tool results + output). Persisted in `run_steps.cumulative_tokens`; drives the
  // SESSION_CONTEXT_HIGHWATER session-compatibility test. Optional/additive (older runs lack it).
  cumulativeTokens?: number;
  // Engine-authored assistant-turn ordinal (0-based) shared by every step of one turn: the
  // `tool_call`/`tool_result` steps the engine emits in stream order AND the `llm_response` step the
  // accounting sink emits POST-DRAIN (after the stream loop settles). Because that closing
  // `llm_response` can land out of position, turn membership cannot be inferred from step order —
  // `turnIndex` makes grouping deterministic. Optional/additive (older runs + non-turn steps lack it).
  turnIndex?: number;
  // F2 — per-turn assistant prose + reasoning, settled on the `llm_response` step. Previously the only
  // place per-turn text lived was the two flat global delta accumulators (no per-step association), so
  // it could not be persisted/replayed per turn. Optional/additive (only llm_response steps carry it;
  // older runs lack it). Redacted + size-bounded on persistence like every other payload string.
  assistantText?: string;
  reasoningText?: string;
  // Track E — per-step wall-clock timing (Gantt foundation; findings/09 §3). Real wall-clock
  // captured at the step boundary: TOOL steps wrap `session.callTool` (tool-bridge); LLM steps wrap
  // each `streamText` step boundary (prior boundary -> onStepFinish). Both ISO-8601 strings, with
  // `startedAt <= endedAt`. Persisted in `run_steps.started_at`/`ended_at`. Optional/additive (older
  // runs + non-timed steps lack them); drives the run timeline / Gantt + real per-step LLM latency.
  startedAt?: string; // ISO-8601
  endedAt?: string; // ISO-8601
  // Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 0.1, D-CS4) — true when this step's
  // token/byte footprint was counted LOCALLY (our own estimator, e.g. tiktoken over the request/
  // response we assembled) rather than read from a provider-reported usage block. Set on steps
  // produced by the `claude_subscription` executor (which has no billed-usage API); ordinary API-metered
  // providers never set it. Optional/additive — older runs and every other kind's steps lack it,
  // meaning "provider-reported/exact" as they always have.
  meteringEstimated?: boolean;
  // Observability (planning/Roadmap/RM-17-observability/, WP3.1, D-OB17) — step-hierarchy metadata. Both OPTIONAL +
  // ADDITIVE + FORWARD-ONLY: a step persisted before WP3.1 carries NEITHER and renders FLAT (never
  // backfilled). `parentStepId` links this step to an EARLIER step of the SAME run (validated at
  // persist — a dangling/forward reference is dropped to `undefined`); the tree is a RENDERING of these
  // links over the flat, monotonic `index` ordering, NEVER a reordering. `spanKind` classifies this
  // step's ROLE in that tree ({@link SpanKind}) — a SEPARATE axis from `type`, which is unchanged.
  parentStepId?: string;
  spanKind?: SpanKind;
  payload: unknown; // redacted request/response/args/result
};

export type RunEvent =
  // `stopReasonCode` (Unified Sessions WP1.1) is the additive MACHINE-READABLE partner of the human
  // `stopReason` text — both optional; a run that ends without a distinct reason (e.g. `completed`)
  // carries neither, and every event persisted before this field parses unchanged.
  (
    | {
        type: "status";
        status: RunStatus;
        outcome?: RunOutcome;
        stopReason?: string;
        stopReasonCode?: StopReasonCode;
      }
    // Auto-Rating (AR11) — the post-run review axis, emitted AFTER the terminal `status` (the run's
    // terminal status/outcome are never touched by it). `rating` marks the review starting; a settled
    // state (`rated`/`failed`/`skipped`) marks it over — the SSE stream closes only after a settled
    // rating event on top of the terminal status. Mirrors the `status` event envelope exactly.
    | { type: "rating"; state: RatingState }
    | { type: "step"; step: RunStep }
    | { type: "delta"; channel: "text" | "reasoning"; text: string; turnIndex?: number }
    | {
        type: "kpi";
        turns: number;
        toolCalls: number;
        tokensIn: number;
        tokensOut: number;
        contextTokens: number;
        costUsd: number;
        // Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 0.1, D-CS8) — see {@link CostBasis}.
        // Optional/additive: absent (or `"api_exact"`) means the ordinary, exactly-billed `costUsd`
        // every consumer before this field already assumes.
        costBasis?: CostBasis;
        // RM-33 (D-CT1/D-CT2) — the cache composition of `tokensIn`, which stays GROSS and
        // cache-inclusive. OMITTED entirely when the run has seen no cache slice, so a non-caching
        // backend's event stays byte-identical to the pre-RM-33 shape. See {@link RunSummary}.
        cachedTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      }
    // `authRequired`/`serverIds` are set (additive/optional) when a run fails terminally because one
    // or more allow-listed OAuth servers need interactive reauth — the console offers reauth + restart.
    | { type: "error"; message: string; authRequired?: boolean; serverIds?: string[] }
    // Interactive user-question (ask-the-operator). Emitted when the agent calls the built-in `ask_user`
    // tool mid-run: the run PAUSES on the tool's `execute` promise until the operator answers via
    // `POST /api/runs/:id/answers` (→ `question_resolved`) or the run is stopped (→ resolved with a
    // `null` answer). Only ever emitted on an INTERACTIVE run (an automated/suite run never exposes the
    // tool, so its wire is byte-identical to before). Additive: a consumer that ignores it is unaffected.
    | {
        type: "question";
        /** Correlates the ask with its `question_resolved` and with the `POST …/answers` body. */
        questionId: string;
        /** The question text the operator is asked. */
        prompt: string;
        /** Optional predefined choices to offer as buttons (the operator may still free-type unless
         *  `allowOther` is false). */
        options?: RunQuestionOption[];
        /** Whether a free-text answer is allowed alongside/instead of the `options` (default true). */
        allowOther?: boolean;
      }
    // Settles a `question`: emitted once the operator answers (the chosen/typed `answer`) or the run is
    // stopped before answering (`answer: null`). The console clears the pending prompt on this. Persisted
    // like every event, so a replayed/reopened run never shows a stale, still-open question form.
    | { type: "question_resolved"; questionId: string; answer: string | null }
    // Unified Sessions (WP1.1, D-US1) — the run entered a new orthogonal lifecycle phase. Additive:
    // a consumer that ignores it is unaffected (statuses remain authoritative for running/terminal).
    // `detail` carries the phase-specific extras the console needs: `position` (1-based queue slot for
    // `queued`), `reason` (`next_turn | question` for `waiting_input`), and `deadlineAt` — a
    // server-authored ABSOLUTE ISO-8601 deadline the SessionClock (WP1.2) sets where it defines one
    // (wait budget while `waiting_input`, or the opt-in wall cap while `running`) so the client renders
    // an authoritative countdown without trusting its own clock.
    //
    // Unified Sessions (WP1.7, D-US1 follow-up) — `phase: null` CLEARS the transient phase back to "no
    // distinct phase" (the plain status stands): every executor emits it once a `waiting_input` wait
    // resumes normally (not a clock fire/abort) and once the `starting`/`queued` session-spin-up phase
    // gives way to ordinary running, so `runs.phase` never lingers stale (e.g. a resolved wait no longer
    // leaves the run reading `waiting_input`). Additive/backward-compatible: this widens an existing
    // required member from `RunPhase` to `RunPhase | null` — every event persisted before this WP always
    // carried a non-null `RunPhase`, so it still parses unchanged (see the session-contract backward-
    // compat test).
    | {
        type: "phase";
        phase: RunPhase | null;
        detail?: {
          position?: number;
          reason?: WaitingInputReason;
          deadlineAt?: string;
        };
      }
    // Unified Sessions (WP1.1, D-US8) — SSE keepalive event emitted on the stream every ~15 s (WP2.1)
    // in place of the old `: ping` comment, so a client watchdog can distinguish a live-but-quiet stream
    // from a dead socket. Carries nothing but its `type` (+ the shared `seq`). Additive/ignorable.
    | { type: "ping" }
  ) & {
    /**
     * F6 — per-run monotonic emission SEQUENCE, stamped once by `RunManager.emit` (the single choke
     * point every live event passes through) BEFORE buffering / fan-out / persistence. It lets an SSE
     * client dedupe a reconnect's replayed buffer by `seq > lastAppliedSeq` — correct regardless of the
     * server's bounded replay-buffer size (a client that applied more events than the buffer holds no
     * longer over-skips genuinely-new live events). Optional/additive: absent on the persisted-replay
     * path (`getRun`), which a finished-run stream sends once with no reconnect overlap.
     */
    seq?: number;
  };

export type RunSummary = {
  id: string;
  testId: string;
  scenarioId: string;
  mode: RunMode;
  status: RunStatus;
  outcome?: RunOutcome;
  startedAt: string;
  durationMs?: number;
  turns: number;
  toolCalls: number;
  peakContextTokens: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /**
   * RM-33 (D-CT1/D-CT2) — the prompt-cache composition of `tokensIn`. **`tokensIn` is unchanged**:
   * it stays the provider-billed GROSS input and still INCLUDES the cached slice. These are added
   * ALONGSIDE it, never subtracted from it.
   *   - `cachedTokens`     — cache read + cache write, MERGED (the legacy figure; `runs.cached_tokens`).
   *   - `cacheReadTokens`  — served from cache, billed at ~0.1x input (a discount).
   *   - `cacheWriteTokens` — written to cache, billed at 1.25x input (a PREMIUM, not a saving).
   * All optional/additive: a run persisted before RM-33 migration 59, or a backend that reports no
   * cache slice, carries none of them — and absent means UNKNOWN, never zero (D-CT3/D-CT6).
   */
  cachedTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /**
   * WP 5.1 — per-assertion results, present only when the run's test declared `assertions` AND the run
   * completed with resolved skills (evaluated from the trace alignment on completion; D4: read-only,
   * no execution). Additive/optional: a test with no assertions, or a non-completed run, carries none.
   * `unevaluable` results never fail a run — the run's `outcome` is deliberately left untouched by
   * assertion failure (this field carries the pass/fail signal). See the assertions evaluator (WP 5.1).
   */
  assertionResults?: AssertionResult[];
  /**
   * Benchmarks (WP 3.1, B7) — the suite run this run belongs to, present only when the run was
   * produced by a suite matrix (the WP 3.2 orchestrator). Additive/optional: a standalone run carries
   * neither field. `suiteRunId` is a denormalized reference (NOT an FK) so run history survives suite
   * / suite-run deletion; `repetition` is the 1-based repetition ordinal within its matrix cell.
   */
  suiteRunId?: string;
  repetition?: number;
  /**
   * Auto-Rating (AR11) — the post-run review axis (see {@link RatingState}). Always sent by current
   * servers (the column is NOT NULL, backfilled by migration v27); optional on the type only for wire
   * additivity, so an older consumer/fixture without it stays valid. NEVER a new member of
   * {@link RunStatus} — a run's terminal status is untouched by its review.
   */
  ratingState?: RatingState;
  /**
   * Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 0.1, D-CS8) — see {@link CostBasis}.
   * Optional/additive: absent (or `"api_exact"`) means the ordinary, exactly-billed `costUsd` every
   * run before this field existed already carries. Only a `claude_subscription`-kind run sets
   * `"subscription_reference"`.
   */
  costBasis?: CostBasis;
  // ── Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1) — additive run-lifecycle surface ─────────
  // All optional + NULL-safe for old rows; populated server-side by WP1.6 (persistence + GET). A run
  // persisted before this workstream carries none of them and reads exactly as it always has.
  /** Machine-readable terminal reason (paired with the human `outcome`/stopReason); see {@link StopReasonCode}. */
  stopReasonCode?: StopReasonCode;
  /** The run's current orthogonal lifecycle phase, when distinct from the plain status; see {@link RunPhase}. */
  phase?: RunPhase;
  /** ISO-8601 timestamp the session was ended/closed (set for `ended`, and any terminal disposition WP1.6 records). */
  endedAt?: string;
  /** Whether the operator has opened/acknowledged this run since it last needed attention (needs-attention feed, WP3.3). */
  seen?: boolean;
  /** The backend's capability manifest for this run (persisted `capabilities_json`); absent on pre-contract runs. */
  capabilities?: SessionCapabilities;
  /** Wall-clock spent actively working, EXCLUDING `waiting_input` pauses (D-US3; SessionClock, WP1.2). */
  activeDurationMs?: number;
  /** Total wall-clock from start to terminal, INCLUDING waits (D-US3). */
  totalDurationMs?: number;
  // ── Observability full-text search (planning/Roadmap/RM-17-observability/, WP1.3, D-OB16) — additive/optional ───
  // Present ONLY on a `GET /api/runs?q=…` hit (the FTS-joined feed); absent on every ordinary list row
  // and every consumer/fixture that never searches. Both are DERIVED (a snippet of the matched index
  // document), never authoritative — the run's own fields are unchanged.
  /** The FTS `snippet()` preview of the best-matching indexed document (with `[…]` match delimiters). */
  searchSnippet?: string;
  /** Which content class the best match came from (see {@link SearchContentClass}). */
  searchMatchKind?: SearchContentClass;
  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP1.6, D-OB…) — retention classes: whether this run is
   * PINNED, which exempts it from EVERY `POST /api/maintenance/prune-runs` policy. Additive/optional
   * for wire compatibility with older fixtures; the backing `runs.pinned` column is NOT NULL (default
   * `false`), so a current server always sends it. Makes the WP1.1 `RunFilter.pinned` placeholder LIVE.
   */
  pinned?: boolean;
  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP1.5, D-OB15) — a MINIMAL human-feedback aggregate chip:
   * this run's RUN-LEVEL (not step-scoped) feedback, one entry per distinct key (the latest write per
   * key wins). Absent when the run carries no run-level feedback. STRICTLY SEPARATE from grading —
   * never read by grading/suites/compare, never blended into any score/aggregate (AR6/D-OB15; see the
   * WP1.5 separation regression test). See {@link RunFeedback} for the full persisted shape.
   */
  feedback?: RunFeedbackSummary[];
  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — fork lineage. Present ONLY on a DERIVED run
   * (one created by `POST /api/runs/:id/rerun`): `derivedFromRunId` is the parent run it was forked
   * from, and `forkStepId` (when set) is the parent step it was forked AT (absent ⇒ a whole-run
   * re-launch). A derived run is NEVER a suite member and is HIDDEN by default from the runs feed
   * (`RunFilter.derived` default-exclude). Additive/optional: an ordinary (non-derived) run carries
   * neither and reads exactly as before. Backed by the nullable `runs.derived_from_run_id` /
   * `runs.fork_step_id` columns (migration v42).
   */
  derivedFromRunId?: string;
  forkStepId?: string;
};

/**
 * One content class indexed in the full-text `run_search` index (Observability WP1.3, D-OB16). The
 * `kind` a `run_search` row carries + the `matchKind` returned with a `q` search hit. See
 * `SEARCH_CONTENT_CLASSES` / `SEARCH_CONTENT_LIMITS` in constants.ts for the vocabulary + truncation caps.
 */
export type SearchContentClass = (typeof SEARCH_CONTENT_CLASSES)[number];

/** Per-level always-on token subtotals of a resolved skill version (default profile). */
export type RunSkillFootprint = {
  /** L1 — the `<available_skills>` metadata entry (always injected into the system prompt). */
  l1MetadataTokens: number;
  /** L2 — the SKILL.md body (inlined up front only when eager; otherwise disclosed on demand). */
  l2BodyTokens: number;
  /** L3 — bundled resource files (disclosed on demand via `read_skill_file`). */
  l3ResourceTokens: number;
  /** The resolved version's total footprint tokens. */
  totalTokens: number;
};

/**
 * One skill this run LOADED, with its always-on footprint and the realized disclosure usage in this
 * run — the data the run console needs to answer "was it loaded, was it used, what did it cost".
 * Present on {@link RunDetail.skills} and served standalone at `GET /api/runs/:id/skills`. Built
 * server-side from the `run_skills` resolution rows (WP 2.1) joined to the resolved version's token
 * subtotals, plus a scan of the run's read-only skill-disclosure steps (`skill://…` tool calls).
 */
export type RunSkill = {
  /** The attached skill's id (the `run_skills` resolution key). */
  skillId: string;
  /** Current skill name; falls back to the id when the skill was deleted after the run. */
  name: string;
  /** The resolved version label (e.g. `v1`), denormalized so it survives the version's deletion. */
  versionLabel: string;
  /** The resolved version id. */
  skillVersionId: string;
  /**
   * Eager attachment. When true this run inlined the full SKILL.md (the L1 `<available_skills>` entry
   * PLUS the L2 body) into the system prompt up front, so it is resident every turn. When false only
   * the L1 metadata is always-on and the L2/L3 body is disclosed on demand (see `disclosureReads`).
   */
  eager: boolean;
  /**
   * Always-on footprint of the resolved version by disclosure level (default profile), or `null` when
   * the resolved version was deleted after the run (the resolution history is kept, footprint isn't).
   */
  footprint: RunSkillFootprint | null;
  /**
   * Realized L2/L3 disclosure in THIS run: how many times the model read a file FROM THIS skill via the
   * read-only `read_skill_file` tool, and the summed result tokens those reads added to context. Zero
   * means the model never opened this skill (expected for an eager skill — its body is already inlined).
   */
  disclosureReads: number;
  disclosureTokens: number;
};

export type RunDetail = RunSummary & {
  steps: RunStep[];
  events: RunEvent[];
  /**
   * Skills this run loaded (each scenario attachment resolved to a concrete, immutable version) with
   * their always-on footprint + realized disclosure usage. Empty when the scenario had no attached
   * skills. Additive; older consumers ignore it. Also served standalone at `GET /api/runs/:id/skills`.
   */
  skills: RunSkill[];
  /**
   * Unified Sessions (WP1.1, D-US1) — still-open agent-initiated questions for a reopened interactive
   * session, so the console can re-render a pending prompt without replaying the live stream.
   * Populated by WP1.6 (reconstructed from the event log); absent/empty for non-interactive or
   * fully-resolved runs. Additive.
   */
  openQuestions?: RunOpenQuestion[];
  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — the DERIVED runs forked FROM this run (the
   * parent → child lineage direction; the child → parent direction is {@link RunSummary.derivedFromRunId}
   * on each child). Present (possibly empty) on a run's detail so the console can render a "forks"
   * indicator + link out; absent on wire fixtures that predate the field. Additive.
   */
  forks?: RunForkRef[];
};

/**
 * Observability (WP3.3, D-OB18) — a minimal lineage reference to a run that was forked FROM a parent
 * (used in {@link RunDetail.forks}). Just enough for the console to list + link each fork.
 */
export type RunForkRef = {
  runId: string;
  /** The parent step this fork was taken at (absent ⇒ a whole-run re-launch). */
  forkStepId?: string;
  status: RunStatus;
  startedAt: string;
};

export type RunStartRequest = {
  testId: string;
  scenarioId: string;
  mode: RunMode;
};

export type RunStartResponse = {
  runId: string;
  streamUrl: string;
};

/**
 * Observability (WP3.3, D-OB18) — body of `POST /api/runs/:id/rerun`. See `runRerunSchema` in
 * schemas.ts. Forks the terminal run at `:id` into a NEW derived run; the response is a
 * {@link RunStartResponse} (the derived run id + its SSE stream URL), identical to a fresh start.
 */
export type RunRerunOverrides = {
  prompt?: string;
  model?: string;
  temperature?: number;
  skillVersionId?: string;
};
export type RunRerunRequest = {
  fromStepId?: string;
  overrides?: RunRerunOverrides;
};

export type RunTurnRequest = {
  text: string;
};

/** A predefined answer choice offered by the agent's `ask_user` tool (see the `question` RunEvent). */
export type RunQuestionOption = {
  /** The choice shown to (and returned by) the operator. */
  label: string;
  /** Optional one-line hint about what picking this choice means. */
  description?: string;
};

/**
 * Body of `POST /api/runs/:id/answers` — the operator's answer to a live `question` (the counterpart of
 * {@link RunTurnRequest} for the agent-initiated ask). `questionId` correlates it to the emitted
 * `question` event; `answer` is the chosen option label or free-typed text.
 */
export type RunAnswerRequest = {
  questionId: string;
  answer: string;
};

export type CompareRow = RunSummary & {
  scenarioName: string;
  model: string;
};

// --- Observability — RunFilter grammar (planning/Roadmap/RM-17-observability/, WP1.1, D-OB1) ------------------
// ONE serializable, AND-combined filter object shared by the runs feed, saved views, chart
// drill-downs, watch rules and (later) the CLI. Every field is OPTIONAL; present fields are ANDed.
// The zod schema (`runFilterSchema`) lives in schemas.ts; the parse/serialize helpers + the pure
// per-run predicate (`matchesRunFilter`) live in `run-filter.ts`. Two consumers exist by design:
//   * the API run repository translates a RunFilter to parameterized SQL (`GET /api/runs`);
//   * a caller with a SINGLE materialized run (watch rules, WP4.1) evaluates the SAME object with
//     `matchesRunFilter(candidate, filter)` — NO SQL — over a {@link RunFilterCandidate}.
// Additive-only: this is a NEW type; nothing here removes/re-types an existing field.

/** A field of a run that can be sorted on in `GET /api/runs?sort=` (see {@link RUN_SORT_FIELDS}). */
export type RunSortField = (typeof RUN_SORT_FIELDS)[number];
export type RunSortDirection = (typeof RUN_SORT_DIRECTIONS)[number];
/** Parsed `sort=<field>[:<asc|desc>]` (default `startedAt` DESC when absent). */
export type RunSort = { field: RunSortField; direction: RunSortDirection };

/**
 * Human-feedback presence filter (D-OB16) — LIVE as of WP1.5 (the `run_feedback` backbone). `key`
 * matches a run carrying feedback (run- or step-level) under that key; `hasScore` matches a run
 * carrying any feedback score. An EMPTY `{}` imposes no constraint (matches every run) — only a
 * present `key`/`hasScore:true` actually narrows, mirroring every other optional RunFilter field.
 */
export type RunFeedbackFilter = {
  key?: string;
  hasScore?: boolean;
};

/**
 * The RunFilter grammar. All fields optional + AND-combined; an omitted field imposes no constraint.
 * Array fields match ANY of their values (SQL `IN`); an empty array is treated as "no constraint".
 */
export type RunFilter = {
  /** Run status incl. the additive `ended` terminal (D-US2). */
  status?: RunStatus[];
  outcome?: RunOutcome[];
  /** Machine-readable terminal reason (D-US1). */
  stopReasonCode?: StopReasonCode[];
  /** Persisted lifecycle phase (D-US1). */
  phase?: RunPhase[];
  /** Operator-acknowledged disposition (D-US1/D-US2). */
  seen?: boolean;
  /** Provider kind of the run's scenario's credential (joined via scenarios → provider_credentials). */
  providerKind?: ProviderKind[];
  /** The run's scenario model (joined via scenarios.model). */
  model?: string[];
  /** An MCP server the run's scenario allow-listed (joined via scenario_servers). */
  serverId?: string[];
  /**
   * The environment (scenario) dimension. The wire name stays `scenarioId` (the frozen scenario wire —
   * "environment" is a UI label only, never renamed on the wire; D-T-rename). Matches `runs.scenario_id`.
   */
  scenarioId?: string[];
  /** The owning suite (joined via suite_runs.suite_id). */
  suiteId?: string;
  /** The owning suite run (denormalized `runs.suite_run_id`). */
  suiteRunId?: string;
  testId?: string[];
  /** A skill the run resolved/loaded (joined via run_skills). */
  skillId?: string[];
  /** A collection the run's test OR suite belongs to (joined via tests/suites.collection_id). */
  collectionId?: string;
  /** Only interactive-mode runs. */
  interactiveOnly?: boolean;
  /**
   * "Needs attention" as a FILTERABLE property (owner-requested follow-up to the unified-sessions runs
   * feed). `true` keeps only runs matching the canonical `runNeedsAttention` rule (a LIVE run paused on
   * the operator — `running` + `waiting_input` — OR an unseen run that isn't currently running);
   * `false` keeps only runs that do NOT; absent imposes no constraint. Evaluated over the existing
   * `status`/`phase`/`seen` facets — no new column, no migration. The ONE rule lives in
   * `runNeedsAttention` (`run-filter.ts`); the API SQL and `matchesRunFilter` are kept in agreement by
   * the cross-check test, exactly as `pinned`/`derived` are.
   */
  needsAttention?: boolean;
  /**
   * Retention classes (WP1.6, D-OB…) — `runs.pinned`. `true` keeps only pinned runs, `false` only
   * unpinned; absent imposes no constraint. A pinned run is NEVER pruned by `prune-runs` regardless
   * of this filter (see {@link RunPruneResult}).
   */
  pinned?: boolean;
  /**
   * Fork lineage (D-OB … ) — FORWARD-COMPATIBLE with WP3.3, DEFAULT EXCLUDE. No `derived_from_run_id`
   * column exists yet, so no run is derived: absent/`false` imposes no constraint (nothing to exclude)
   * and `derived:true` matches nothing. WP3.3 makes default-exclude = `derived_from_run_id IS NULL`.
   */
  derived?: boolean;
  /** Latest-per-grader score lower/upper bound (0..1). Pair with `grader` to scope to one grader. */
  scoreGte?: number;
  scoreLte?: number;
  /** Optional grader id (see {@link GRADER_IDS}; a custom id is allowed) scoping the score bound. */
  grader?: string;
  costUsdGte?: number;
  costUsdLte?: number;
  /** Bound on total tokens (tokens_in + tokens_out). */
  tokensGte?: number;
  tokensLte?: number;
  /** Bound on the ACTIVE duration (activeDurationMs ?? totalDurationMs, D-US3; conventions §4). */
  durationMsGte?: number;
  durationMsLte?: number;
  /** Inclusive ISO-8601 lower/upper bound on `startedAt`. */
  dateFrom?: string;
  dateTo?: string;
  /** Human-feedback presence — LIVE as of WP1.5 (see {@link RunFeedbackFilter}). */
  feedback?: RunFeedbackFilter;
  /**
   * Full-text query (Observability WP1.3, D-OB16). Runs the FTS5 index (`run_search`) over the run's
   * indexed content classes ({@link SearchContentClass}) and JOINs the match into the runs feed, ANDed
   * with every other filter field. A hit carries a {@link RunSummary.searchSnippet} preview +
   * {@link RunSummary.searchMatchKind}. Prefix matching is on (each term matches by prefix). Only
   * meaningful on `GET /api/runs`; the metrics endpoints still reject it.
   */
  q?: string;
  /** Runs that ended in error (status `error` OR outcome `error`). `false` inverts it. */
  hasError?: boolean;
};

/** One grader's latest normalized score for a run (input to {@link matchesRunFilter}'s score check). */
export type RunCandidateScore = { grader: string; score: number };

/**
 * The materialized view of ONE run a caller passes to `matchesRunFilter` (watch rules, WP4.1) so the
 * same {@link RunFilter} evaluates WITHOUT SQL. Core run attributes mirror {@link RunSummary}; the
 * ENRICHED (normally joined) attributes must be supplied by the caller for any field it filters on —
 * a field left `undefined` cannot satisfy a filter that requires it (conservative "no match").
 */
export type RunFilterCandidate = {
  status: RunStatus;
  outcome?: RunOutcome;
  stopReasonCode?: StopReasonCode;
  phase?: RunPhase;
  seen?: boolean;
  mode: RunMode;
  scenarioId: string;
  testId: string;
  suiteRunId?: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  activeDurationMs?: number;
  totalDurationMs?: number;
  startedAt: string;
  // ── Enriched / joined attributes (supplied per-run by the caller) ──
  providerKind?: ProviderKind;
  model?: string;
  serverIds?: string[];
  skillIds?: string[];
  suiteId?: string;
  collectionIds?: string[];
  /** Latest-per-grader scores (WP1.1 grade reads). */
  scores?: RunCandidateScore[];
  /** Human-feedback keys present on the run — run- OR step-level (WP1.5, LIVE). */
  feedbackKeys?: string[];
  /** Whether the run carries any human-feedback score — run- OR step-level (WP1.5, LIVE). */
  hasFeedbackScore?: boolean;
  pinned?: boolean;
  derived?: boolean;
};

// --- Observability — human feedback (planning/Roadmap/RM-17-observability/, WP1.5, D-OB15) --------------------
// ONE generic primitive for human signal on a run: a score and/or a note, scoped to the run as a
// whole (`stepId` absent) or to one of its steps/turns (`stepId` set). STRICTLY SEPARATE from
// grading (AR6/D-OB15) — nothing in grading/suites/compare reads `run_feedback`; see the WP1.5
// separation regression test (`apps/api/test/run-feedback.test.ts`). The console UI that WRITES
// this is WP2.5; the review queue is WP4.5 — this WP is the table + API + the RunFilter
// integration (`RunFilter.feedback`, now LIVE — see `run-filter.ts`) + the minimal `RunSummary`
// aggregate chip above. Makes the WP1.1 `RunFilter.feedback` placeholder LIVE.

/** `'human'` is the only source this API writes today; `'auto'` exists for a FUTURE rule-written row
 *  (kept in the enum for the wire's sake — WP4.1's run-grader action does NOT write here; grades
 *  stay grades). */
export type RunFeedbackSource = "human" | "auto";

/** One persisted feedback row (`run_feedback`). */
export type RunFeedback = {
  id: string;
  runId: string;
  /** The `run_steps.id` this feedback is scoped to; absent for run-level feedback. */
  stepId?: string;
  /** Free-form key; defaults to `"verdict"` (thumbs up/down, conventionally score ±1). Arbitrary
   *  keys are allowed — rubric use lands in WP4.5. */
  key: string;
  score?: number;
  comment?: string;
  source: RunFeedbackSource;
  createdAt: string;
};

/**
 * Body of `POST /api/runs/:id/feedback` — an UPSERT keyed on (run, step, key, source='human'): a
 * re-thumb on the SAME (step, key) REPLACES the prior row rather than appending a new one. `key`
 * defaults to `"verdict"` when omitted. At least one of `score`/`comment` is required.
 */
export type RunFeedbackInput = {
  stepId?: string;
  key?: string;
  score?: number;
  comment?: string;
};

/** One key's aggregated RUN-LEVEL human feedback — the {@link RunSummary.feedback} chip entry. */
export type RunFeedbackSummary = {
  key: string;
  score: number | null;
};

// --- Observability — model pricing editor (planning/Roadmap/RM-17-observability/, WP2.6, D-OB22) ----------------
// A DB-backed, editable pricing map so per-model prices no longer require a code edit. The code
// table (`apps/api/src/providers/pricing.ts` `MODEL_PRICING`) is the SEED (`source: "seed"`, read-
// only) + the belt-and-braces fallback; owners add/override with `source: "user"` rows. All prices
// are USD **per 1M tokens**. Resolution (`PricingRepository.resolve`) picks the MOST-SPECIFIC match
// (exact > regex) whose `effectiveFrom <= at`, newest wins — so a future-dated entry is inert until
// its date. MONEY INVARIANT: a run stores its `costUsd` at run time; editing a price NEVER recomputes
// an already-recorded run — only NEW cost computations pick up the change.

/** Whether a pricing entry came from the code seed (`seed`, read-only) or an owner edit (`user`). */
export type ModelPricingSource = "seed" | "user";

/** One persisted pricing entry (`model_pricing`). Prices are USD per 1M tokens. */
export type ModelPricingEntry = {
  id: string;
  /** Provider label (e.g. `anthropic`, `openai`) — informational + organizational; resolution keys
   *  on `modelMatch`, not this field. */
  provider: string;
  /** Exact model id, or — when `isRegex` — a JavaScript `RegExp` source matched against the model id. */
  modelMatch: string;
  isRegex: boolean;
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache-read (discounted) input rate; when absent, cache reads bill at the full input rate. */
  cacheReadPerMTok?: number;
  /** Explicit cache-write rate; when absent, cache writes derive 1.25× the input rate (Anthropic). */
  cacheWritePerMTok?: number;
  /** ISO-8601. The entry is INERT for a cost computed before this instant (effective dating). */
  effectiveFrom: string;
  source: ModelPricingSource;
  createdAt: string;
};

/** Body of `POST /api/pricing` — creates a `user` entry. `effectiveFrom` defaults to now. */
export type ModelPricingInput = {
  provider: string;
  modelMatch: string;
  isRegex?: boolean;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  effectiveFrom?: string;
};

/** Body of `PATCH /api/pricing/:id` — partial edit of a `user` entry (`seed` entries are read-only). */
export type ModelPricingPatch = Partial<ModelPricingInput>;

// --- Observability — saved views (WP1.4) -------------------------------------------------------
// Name + reuse ANY {@link RunFilter}: selectable in the runs feed (WP2.3, later) and referenced by
// deep links. A view stores the FILTER — it NEVER snapshots results (derived-never-authoritative
// doctrine): re-running a saved view always re-executes the SAME filter against current data via
// `GET /api/runs?filter=<serializeRunFilter(view.filter)>` (see `run-filter.ts`).
//
// `columns`/`sort` are PRESENTATION hints the web UI owns (column visibility/order, a table sort) —
// opaque to the API beyond a byte-size cap (`RUN_VIEW_PRESENTATION_MAX_BYTES`); the API never reads
// or interprets their shape. Both are optional and independent of the RunFilter's own `sort`-style
// query concerns (`RunSort`, used by `GET /api/runs?sort=`).

/** A saved, named {@link RunFilter} + presentation hints (`GET/POST /api/run-views`, WP1.4). */
export type RunView = {
  id: string;
  /** Unique (case-insensitive), enforced at create/update time — a duplicate name is a 409. */
  name: string;
  filter: RunFilter;
  /** Opaque web-owned column visibility/order hint (size-capped, never interpreted by the API). */
  columns?: unknown;
  /** Opaque web-owned table-sort hint (size-capped, never interpreted by the API). */
  sort?: unknown;
  createdAt: string;
  updatedAt: string;
};

/** Create payload for a {@link RunView} (`POST /api/run-views`) — `name` + `filter` are required. */
export type RunViewInput = {
  name: string;
  filter: RunFilter;
  columns?: unknown;
  sort?: unknown;
};

/**
 * Update payload for a {@link RunView} (`PATCH /api/run-views/:id`) — every field is OPTIONAL; an
 * omitted field keeps its current stored value (a real partial update, unlike the full-replace
 * `RunViewInput`). Supplying `filter` re-validates it against {@link RunFilter}.
 */
export type RunViewPatch = {
  name?: string;
  filter?: RunFilter;
  columns?: unknown;
  sort?: unknown;
};

// --- Observability — watch rules (planning/Roadmap/RM-17-observability/, WP4.1, D-OB19/D-OB21) ----------------
// "When a run matches filter F, do action A." A rule is evaluated at the ONE post-terminal choke
// point (after the run reaches a terminal status AND its rating axis settles — see reviewRun in
// testing/run-service.ts) against the SAME shared {@link RunFilter} grammar the feed uses, via the
// pure `matchesRunFilter` predicate (no SQL). Rules are strictly POST-HOC OBSERVERS: an action can
// NEVER mutate run lifecycle/totals/grades or block the run pipeline; a throwing action is caught,
// audited as failed, and the next action + the run continue. Everything here is additive.

/** When a rule fires. `on_terminal` = per-run at the post-terminal choke point (WP4.1). `windowed`
 *  is RESERVED for WP4.2's aggregate/scheduled path — accepted + stored, never evaluated here. */
export type WatchRuleTrigger = (typeof WATCH_RULE_TRIGGERS)[number];

/** Severity carried by a `notify` action (INERT until WP4.3 lands the notification table). */
export type WatchNotifySeverity = (typeof WATCH_NOTIFY_SEVERITIES)[number];

/**
 * The CLOSED action set a rule executes, as PERSISTED / RETURNED. The `webhook` variant carries only
 * a `secretRef` (an opaque handle) — the target URL lives ENCRYPTED in the secret store, NEVER in
 * `watch_rules`, a response, or a log. Ordered execution + per-action audit + failure isolation are
 * the engine's job (`watch/engine.ts`).
 */
export type WatchAction =
  | { type: "notify"; severity: WatchNotifySeverity; template?: string }
  | { type: "pin" }
  | { type: "add_to_collection"; collectionId: string }
  | { type: "promote_to_test"; collectionId: string }
  | { type: "run_grader"; graderId: string }
  | { type: "webhook"; secretRef: string; template?: string };

/**
 * The action set as ACCEPTED on the wire (create/update). Identical to {@link WatchAction} EXCEPT the
 * `webhook` variant takes the plaintext `url` — the API mints a `secretRef`, encrypts the URL into the
 * secret store, and persists/returns only the ref (the redaction discipline: secret in, handle out).
 */
export type WatchActionInput =
  | { type: "notify"; severity: WatchNotifySeverity; template?: string }
  | { type: "pin" }
  | { type: "add_to_collection"; collectionId: string }
  | { type: "promote_to_test"; collectionId: string }
  | { type: "run_grader"; graderId: string }
  | { type: "webhook"; url: string; template?: string };

/** A trailing-window width for a windowed rule ({@link WATCH_WINDOW_DURATIONS}). Each aligns to a UTC
 *  grid so a completed window maps to exactly ONE metrics bucket (WP4.2). */
export type WatchWindowDuration = (typeof WATCH_WINDOW_DURATIONS)[number];

/** The comparison a windowed threshold uses ({@link WATCH_WINDOW_OPS}): value `op` threshold → breach. */
export type WatchWindowOp = (typeof WATCH_WINDOW_OPS)[number];

/**
 * A windowed rule's threshold config (WP4.2, D-OB19): "measure `op` threshold over `window`", evaluated
 * on grid-ALIGNED completed windows by the in-process scheduler. The measure math DELEGATES to the WP1.2
 * metrics service (`computeRunMetrics`) — this is NOT a second aggregation path. `bucket` is the metrics
 * bucket the window collapses to (derived from `window` by the evaluator, echoed here for transparency);
 * `grader` scopes scoring to one grader (folded into the effective RunFilter). `cooldownMinutes` dedupes
 * re-fires while continuously breached (recovery re-arms). Fields present are ANDed with the rule's
 * `filter`.
 */
export type WatchWindowConfig = {
  /** The metric to threshold — the SINGLE-SOURCE RUN_METRICS_MEASURES vocabulary. */
  measure: RunMetricsMeasure;
  /** Optional grader id scoping which runs count toward the score (folded into `filter.grader`). */
  grader?: string;
  /** Optional dimension to evaluate per-group; the window BREACHES if ANY group crosses the threshold. */
  groupBy?: RunMetricsGroupBy;
  /** The metrics bucket the aligned window collapses to (hour/day/week). */
  bucket: MetricsBucket;
  /** The trailing-window width. */
  window: WatchWindowDuration;
  op: WatchWindowOp;
  threshold: number;
  /** Minutes to suppress re-fires while continuously breached (0 = fire every breaching window). */
  cooldownMinutes: number;
};

/** One persisted watch rule (`watch_rules`). `sample` (0..1) is a DETERMINISTIC per-(rule,run) hash
 *  gate — the same run id always yields the same fire/skip decision (no RNG). `window` is the windowed
 *  threshold config (WP4.2), present only for a `windowed` rule. */
export type WatchRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: WatchRuleTrigger;
  filter: RunFilter;
  /** Deterministic sample rate in [0,1]; absent = always (1.0). */
  sample?: number;
  /** The windowed threshold config (WP4.2). Absent for an `on_terminal` rule (and for a `windowed`
   *  rule that has not yet been given a threshold — such a rule is inert). */
  window?: WatchWindowConfig;
  /** The end (ISO-8601, a grid boundary) of the most recent window the scheduler evaluated — the
   *  boot catch-up baseline (D-OB19). Absent until the rule has been evaluated at least once. */
  lastEvaluatedAt?: string;
  actions: WatchAction[];
  createdAt: string;
  updatedAt: string;
};

/** Create payload for a {@link WatchRule} (`POST /api/watch-rules`). `enabled` defaults to true. */
export type WatchRuleInput = {
  name: string;
  enabled?: boolean;
  trigger: WatchRuleTrigger;
  filter: RunFilter;
  sample?: number;
  window?: WatchWindowConfig;
  actions: WatchActionInput[];
};

/** Partial update payload (`PATCH /api/watch-rules/:id`) — an omitted field keeps its stored value.
 *  Supplying `actions` REPLACES the whole set (and rotates any webhook secrets). */
export type WatchRulePatch = {
  name?: string;
  enabled?: boolean;
  trigger?: WatchRuleTrigger;
  filter?: RunFilter;
  sample?: number;
  window?: WatchWindowConfig;
  actions?: WatchActionInput[];
};

/** The outcome payload of one audited {@link WatchRuleEvent} row (`result_json`). NEVER carries a
 *  secret (no webhook URL) — only a boolean + a human-readable, redacted detail/error. The
 *  `window*`/`value`/`late` fields (WP4.2) are set ONLY on windowed markers (`window_fire`/
 *  `window_recover`/`window_catchup`) — they carry the window identity so the scheduler can re-seed
 *  its fire/recover state from the audit log (no extra persisted state) and the audit shows the gap. */
export type WatchRuleEventResult = {
  ok: boolean;
  /** Human-readable outcome (e.g. "pinned run", "promoted draft test <id>", "webhook responded 204"). */
  detail?: string;
  /** Present when `ok` is false — a redacted failure reason. */
  error?: string;
  /** WP4.2 — the evaluated window's start (ISO-8601, a grid boundary). */
  windowStart?: string;
  /** WP4.2 — the evaluated window's end (ISO-8601, a grid boundary); also the marker row's `at`. */
  windowEnd?: string;
  /** WP4.2 — the measure value the threshold was checked against (the breach-direction extreme). */
  value?: number;
  /** WP4.2 — true when the window completed while the app was away (boot catch-up, "while you were away"). */
  late?: boolean;
};

/** One append-only audit row (`watch_rule_events`). `action` is the action type that ran, or a
 *  decision marker (`"sampled_out"`). `runId` is denormalized (no FK) so the audit survives run
 *  deletion. */
export type WatchRuleEvent = {
  id: string;
  ruleId: string;
  runId?: string;
  at: string;
  action: string;
  result: WatchRuleEventResult;
};

/** `POST /api/watch-rules/preview` body (WP4.2) — score a window config against history WITHOUT saving
 *  a rule (the pre-save check, drives the WP4.4 chart). `windows` = trailing completed windows to score
 *  (defaults to {@link WATCH_PREVIEW_DEFAULT_WINDOWS}); `asOf` anchors "now" (defaults to the request
 *  time) for a deterministic, reproducible preview. */
export type WatchWindowPreviewRequest = {
  filter: RunFilter;
  window: WatchWindowConfig;
  windows?: number;
  asOf?: string;
};

/** One scored window in a {@link WatchWindowPreview}. `value` is null when the window had no backing
 *  data (never fabricated → `wouldHaveFired` is then false). */
export type WatchWindowPreviewPoint = {
  windowStart: string;
  windowEnd: string;
  /** The breach-direction extreme measure value over the window; null when the window had no data. */
  value: number | null;
  /** How many runs (or graded/duration samples) backed the value. */
  n: number;
  /** Whether `value op threshold` held — i.e. the rule would have fired for this window. */
  wouldHaveFired: boolean;
};

/** `POST /api/watch-rules/preview` response (WP4.2). The per-window values MATCH the WP1.2 metrics
 *  service EXACTLY (same `computeRunMetrics` call, one point per aligned window — no second path). */
export type WatchWindowPreview = {
  window: WatchWindowConfig;
  /** The metrics bucket each aligned window collapses to (echoed for the chart/debugging). */
  bucket: MetricsBucket;
  /** Trailing completed windows, oldest first. */
  windows: WatchWindowPreviewPoint[];
};

// --- Observability — notification center (planning/Roadmap/RM-17-observability/, WP4.3, D-OB19) -----------------
// The persistent in-app notification center the `notify` watch action writes to — this UNBLOCKS the
// WP4.1 inert seam (`watch/actions.ts` `WatchActionServices.notify`, undefined until this WP): the
// action already calls it when present, so wiring a real implementation in `apps/api/src/index.ts` is
// the whole change (no engine edit). A notification is DERIVED from exactly one fired `notify` action:
// an ON-TERMINAL fire carries `runId` (the seam's `WatchNotifyRequest` carries no rule identity for
// this path — only a windowed fire's `window` does, via `ruleId`/`ruleName`), a WINDOWED fire carries
// `ruleId` + the measure/threshold/value/late detail. `linkPath` is an app route the bell deep-links to
// on click (a run console for an on-terminal fire, the rules list for a windowed one).

/** One persisted notification (`notifications`, v40). `read`/`late` are booleans on the wire (stored as
 *  0/1). `late` is true only for a windowed rule's BOOT-CATCH-UP fire (the window completed while the
 *  app was away, D-OB19) — the bell's "while you were away" chip. */
export type Notification = {
  id: string;
  at: string;
  severity: WatchNotifySeverity;
  title: string;
  body: string;
  /** An app route to deep-link to on click (absent only for a notification with no known context). */
  linkPath?: string;
  /** The firing rule's id — present only for a WINDOWED fire (the on-terminal seam carries no rule
   *  identity; see the module doc above). */
  ruleId?: string;
  /** The settled run's id — present only for an ON-TERMINAL fire. */
  runId?: string;
  read: boolean;
  late: boolean;
};

/** `GET /api/notifications` filters (all optional — an empty query returns every notification, newest
 *  first). `unread: true` restricts to `read = false`; `since`/`until` bound `at` (ISO-8601). */
export type NotificationListQuery = {
  unread?: boolean;
  severity?: WatchNotifySeverity;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

/** `GET /api/notifications` response — the matching page PLUS the total unread count. `unreadCount` is
 *  ALWAYS the global unread total (independent of whatever filter/page was requested) so the bell's
 *  badge is correct even while a filtered page is showing. */
export type NotificationListResult = {
  items: Notification[];
  total: number;
  unreadCount: number;
};

/** `POST /api/notifications/read-all` response — how many notifications were flipped to read. */
export type NotificationReadAllResult = {
  count: number;
};

/** `POST /api/maintenance/prune-notifications` result — mirrors {@link AssistantPruneResult}'s
 *  honesty-first shape (real ids, not just an `ok`). Only READ notifications older than
 *  `retentionDays` are pruned; an unread one is never a victim regardless of age. */
export type NotificationPruneResult = {
  retentionDays: number;
  prunedNotificationIds: string[];
};

// --- Auto-Rating — mandatory post-run rating contract (WP 1.1, AR1–AR16) ----------------------
// planning/Roadmap/RM-06-auto-rating/item.md. Extends the Benchmarks grading contract above: base rating is
// three always-on graders (see {@link GRADER_IDS} / `BASE_RATING_GRADER_IDS`) that write ordinary
// {@link RunGrade} rows; {@link RunReport} composes them on demand (no new per-run table, AR1) and
// {@link SuiteReport} is the one new persisted artifact (`suite_run_reports.report_json`, WP 4.1).
// Everything here is additive — a run/suite-run with no rating yet behaves exactly as today.

/** `error_forensics`' 5-bucket root-cause taxonomy (see {@link ROOT_CAUSE_BUCKETS}, AR4). */
export type RootCauseBucket = (typeof ROOT_CAUSE_BUCKETS)[number];

/** Mandatory per-finding fix target (see {@link FIX_TARGETS}, AR4/AR9) — never auto-applied. */
export type FixTarget = (typeof FIX_TARGETS)[number];

/** The raw-signal inventory category an {@link ErrorFinding} was extracted from (see {@link ERROR_FINDING_CATEGORIES}, AR4). */
export type ErrorFindingCategory = (typeof ERROR_FINDING_CATEGORIES)[number];

/** The `answer_validation` base grader's verdict (see {@link ANSWER_VALIDATION_VERDICTS}). */
export type AnswerValidationVerdict = (typeof ANSWER_VALIDATION_VERDICTS)[number];

/** The `insight_surplus` base grader's verdict (see {@link INSIGHT_SURPLUS_VERDICTS}, AR8). */
export type InsightSurplusVerdict = (typeof INSIGHT_SURPLUS_VERDICTS)[number];

/**
 * One entry in the `error_forensics` deterministic inventory (AR4/AR9). `category` is the raw
 * signal it was extracted from; `bucket`/`fixTarget` are the LLM root-cause classification's
 * output; `draftFix` is a concrete, labeled SUGGESTION — the app never auto-applies it. Every
 * finding must cite the evidence that justifies it (`evidenceSteps`/`evidenceEventIds` — at least
 * one non-empty, enforced by `errorFindingSchema`), the same step-citation deep-link mechanic as
 * {@link AssertionResult.evidence} / {@link TraceVerdict.evidence}.
 */
export type ErrorFinding = {
  /** A stable id (unique within one run's error_forensics inventory, e.g. a monotonic index string). */
  id: string;
  /** A short description of what went wrong. */
  description: string;
  category: ErrorFindingCategory;
  bucket: RootCauseBucket;
  fixTarget: FixTarget;
  /** A concrete, labeled fix suggestion — e.g. "add to SKILL.md: always pass `fields=…` to `acme_get_app`". Never auto-applied. */
  draftFix: string;
  /**
   * Concrete failure evidence lifted from the run's persisted (redacted) step payloads — so a filed
   * issue shows the ACTUAL wrong call, not just a category. `toolName`/`sentArguments` are set for
   * `failed_tool_call` findings (the args come from the sibling `tool_call` step); `errorMessage` is
   * the exact provider/tool/connection error text. All three are already redacted + length-bounded at
   * extraction and are OPTIONAL (older findings, non-tool categories, or a call with no captured args
   * lack them). They are grader-OWNED (never taken from the classification model — like id/evidence).
   */
  toolName?: string;
  /** A bounded JSON excerpt of the arguments actually sent on the failing tool call (redacted). */
  sentArguments?: string;
  /** The exact error text returned (tool-level error string, MCP `isError` content, or run-error message). */
  errorMessage?: string;
  /** Cited `run_steps.idx` values that support this finding. */
  evidenceSteps: number[];
  /** Cited `run_events.id` values that support this finding. */
  evidenceEventIds: string[];
  /**
   * Set when the underlying transcript had to be truncated/summarized before classification (e.g. a
   * very long run) — the finding's bucket/fixTarget may be less certain. Omitted when not truncated.
   */
  truncated?: boolean;
};

/**
 * The `answer_validation` base grader's evidence (AR1). `score` is null when unevaluable (e.g. the
 * run produced no final answer) — NEVER a forced 0; `verdict` still carries the honest signal
 * (`unanswered`) in that case. `quotes` are verbatim excerpts; `citedSteps` are `run_steps.idx`
 * values — the same deep-link mechanic as {@link AssertionResult.evidence}.
 */
export type AnswerValidationEvidence = {
  verdict: AnswerValidationVerdict;
  score: number | null;
  quotes: string[];
  citedSteps: number[];
};

/**
 * The `insight_surplus` base grader's evidence (AR8, double-edged): grounded/relevant beyond-ask
 * insight raises the score (`valuable`); unrequested padding lowers it (`noise`) and NAMES its
 * token cost via `surplusTokens` so it can be surfaced. `score` is null when unevaluable.
 */
export type InsightSurplusEvidence = {
  verdict: InsightSurplusVerdict;
  score: number | null;
  quotes: string[];
  citedSteps: number[];
  /** The token cost of the surplus — present when `verdict` is `noise` (padding); absent otherwise. */
  surplusTokens?: number;
};

/** The three base graders' verdicts/evidence, grouped as one dimension (AR6 — kept separate from expectation grades). */
export type RunBaseRating = {
  answerValidation: AnswerValidationEvidence;
  insightSurplus: InsightSurplusEvidence;
  errorForensics: ErrorFinding[];
};

/**
 * The composed, on-demand run rating + grading surface (AR1) — served by `GET /api/runs/:id/report`
 * and embedded in the run JSON/MD export. NOT persisted as its own row (base rating already lives in
 * ordinary {@link RunGrade} rows; this type is assembled fresh on every read). References existing
 * shared types rather than duplicating them: `kpis` is a `Pick` over {@link RunSummary}'s numeric
 * fields, `expectationGrades`/`judgeProvenance` reuse {@link RunGrade}, `assertionResults` reuses
 * {@link AssertionResult}. `ratingVersion` is stamped from {@link AUTO_RATING_VERSION} (AR15).
 */
export type RunReport = {
  runId: string;
  status: RunStatus;
  outcome?: RunOutcome;
  baseRating: RunBaseRating;
  /** Non-base ("expectation") grader rows for this run — latest-per-grader (may be empty). */
  expectationGrades: RunGrade[];
  /** Normalized to `[]` when the run's test declared no assertions (unlike {@link RunSummary.assertionResults}, which is absent instead). */
  assertionResults: AssertionResult[];
  kpis: Pick<
    RunSummary,
    | "turns"
    | "toolCalls"
    | "peakContextTokens"
    | "tokensIn"
    | "tokensOut"
    | "cachedTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "costUsd"
    | "durationMs"
  >;
  /** Which judge source produced the LLM-backed base-rating facets (AR2/AR3) — null/null when none ran. */
  judgeProvenance: Pick<RunGrade, "judgeProviderId" | "judgeModel">;
  ratingVersion: number;
  generatedAt: string;
};

/** Mean + standard deviation for one numeric dimension across a test-group's member runs (WP 4.1). Both null when unevaluable (e.g. zero graded members). */
export type SuiteReportVariance = {
  mean: number | null;
  stdDev: number | null;
};

/**
 * AR10 — one LLM agreement call's verdict for a test-group: whether the group's member runs' rated
 * conclusions agree or contradict each other. Exactly ONE call per test-group (never pairwise).
 */
export type SuiteTestGroupAgreement = {
  /** e.g. "3/3 runs conclude the missing `fields` param causes the failure". */
  summary: string;
  agreeCount: number;
  totalCount: number;
  contradicts: boolean;
};

/**
 * Deterministic + LLM-agreement analytics for one test's member runs within a suite run (WP 4.1/4.2).
 * `toolPathVariance` counts distinct observed tool-call-sequence shapes across the group's runs (0
 * or 1 = every run took the same path; higher = more divergence). `runIds` reuses {@link SuiteRunMember}'s id type.
 */
export type SuiteReportTestGroup = {
  testId: string;
  runIds: SuiteRunMember["id"][];
  score: SuiteReportVariance;
  costUsd: SuiteReportVariance;
  turns: SuiteReportVariance;
  toolPathVariance: number;
  agreement: SuiteTestGroupAgreement;
  /**
   * DETERMINISTIC, evidence-grounded highlight sentences for this test group (suite-report
   * enrichment) — derived ONLY from the already-computed facets (agreement contradiction, score
   * spread, tool-path divergence, cost outlier, error-cluster membership); never invented. Absent
   * on reports generated before this field existed; `[]` when nothing stands out.
   */
  findings?: string[];
};

/** One test's current-minus-baseline deltas in a {@link SuiteReportBaseline}. Null when either side is null. */
export type SuiteReportBaselinePerTest = {
  testId: string;
  scoreMeanDelta: number | null;
  costMeanDelta: number | null;
  turnsMeanDelta: number | null;
  /** True when the group's agreement `contradicts` verdict changed vs. the baseline report. */
  agreementFlipped: boolean;
};

/**
 * Cross-suite-run comparability (suite-report enrichment) — per-test deltas of THIS report against
 * the most recent EARLIER comparable suite run that has a persisted report (same `suiteId`, or —
 * for a suite-less plan run — an identical sorted set of member test ids). Best-effort at
 * generation time: omitted entirely when no comparable baseline exists.
 */
export type SuiteReportBaseline = {
  suiteRunId: SuiteRun["id"];
  /** The baseline report's `generatedAt` timestamp. */
  generatedAt: string;
  perTest: SuiteReportBaselinePerTest[];
};

/**
 * One cross-run root-cause roll-up entry (WP 4.2) — a fix clustered across the suite run's member
 * runs' {@link ErrorFinding}s by frequency, reusing {@link RootCauseBucket}/{@link FixTarget}.
 */
export type SuiteRootCauseRollupEntry = {
  bucket: RootCauseBucket;
  fixTarget: FixTarget;
  /** A representative draft fix for this cluster (e.g. the most frequent finding's `draftFix`). */
  draftFix: string;
  frequency: number;
  memberRunIds: SuiteRunMember["id"][];
};

/**
 * The persisted `suite_run_reports.report_json` payload (WP 4.1/4.2/4.3) — append-only, latest wins
 * (mirrors {@link RunGrade}'s discipline). Generated only for suite runs with ≥2 members (AR7).
 * `errorClustering` reuses the existing {@link FailureBucket} type (AR12 — clustering may auto-run
 * here); `suiteRunId` reuses {@link SuiteRun}'s id type. `ratingVersion` is stamped from
 * {@link AUTO_RATING_VERSION} (AR15).
 */
export type SuiteReport = {
  suiteRunId: SuiteRun["id"];
  testGroups: SuiteReportTestGroup[];
  errorClustering: FailureBucket[];
  rootCauseRollup: SuiteRootCauseRollupEntry[];
  narrative: string;
  /** Which judge source produced the per-test-group agreement calls (AR2/AR3) — null/null when none ran. */
  judgeProvenance: Pick<RunGrade, "judgeProviderId" | "judgeModel">;
  ratingVersion: number;
  generatedAt: string;
  /**
   * The persisted `suite_run_reports.status` (suite-report enrichment, additive): `ready` = every
   * member was rated, `partial` = some member ratings never landed within the bound, `error` = the
   * deterministic build crashed (an honest empty shell). Stamped into the report at generation time
   * AND echoed from the row at read time (`GET /api/suite-runs/:id/report`), so pre-stamp rows
   * still surface it. Absent only on a pre-stamp report read outside the API.
   */
  status?: "ready" | "partial" | "error";
  /** Cross-suite-run baseline deltas (see {@link SuiteReportBaseline}) — omitted when no comparable earlier run exists. */
  baseline?: SuiteReportBaseline;
};

// --- MCP × Model compatibility (Phase 5) -----------------------------------------------------
// Results-only wire contract. The test catalog + model dataset stay API-side (they track the
// fast-moving research schemas); only resolved results/heatmaps cross to the web. Source: the
// research compatibility suite (planning/Research/RS-01-token-context-comparison/outputs/03-compatibility-test-suite.md).

export type CompatibilityVerdict = "pass" | "warn" | "fail" | "na";

export type CompatibilitySeverity = "blocker" | "high" | "medium" | "low";

/**
 * Heatmap cell band. `green`/`amber`/`red` are POSITIVE evidence — a cell was actually scored
 * against this model's practical limits. `untested` is the ABSENCE of evidence: no applicable test
 * produced a verdict, so the roll-up score is `null`. It must NEVER inherit the colour or the
 * meaning of a passing cell — a gap in coverage is not a clean bill of health. See
 * {@link bandForScore}, the single source of truth both the runner and the web guardrail share.
 */
export type CompatibilityBand = "green" | "amber" | "red" | "untested";

/**
 * Map a rolled-up cell score to its band — the ONE definition of "what colour is this cell",
 * imported by the compatibility runner (where scores are computed) and by the web guardrail (which
 * locks the invariant). Pure + dependency-free so the two ends can never drift.
 *
 * - A blocker-level failure gates the cell to `red` regardless of score.
 * - A `null` score means nothing applicable scored the cell → `untested` (absence of evidence).
 *   This is checked AFTER the blocker gate but before every positive band, so a gap can never read
 *   as green.
 * - Otherwise: `red` below the practical floor (score < 60), `green` comfortably clear (score >= 90
 *   with no warnings), `amber` in the band between.
 */
export function bandForScore(
  score: number | null,
  opts: { blockerFail: boolean; anyWarn: boolean },
): CompatibilityBand {
  if (opts.blockerFail) return "red";
  if (score === null) return "untested";
  if (score < 60) return "red";
  if (score >= 90 && !opts.anyWarn) return "green";
  return "amber";
}

/** What the test evaluates against. `environment` = aggregate across all connected servers. */
export type CompatibilityLevel = "server" | "tool" | "session" | "environment";

/** A cited limit value pulled straight from the provenanced dataset (the "why + proof"). */
export type CompatibilityEvidence = {
  field: string;
  value: string | number | boolean | null;
  sourceUrl?: string | null;
  sourceTier?: number;
  confidence?: "high" | "medium" | "low" | "n/a";
};

/**
 * One tool's contribution to an AGGREGATE server-level test (e.g. the namespaced-name-length check
 * or the definition-footprint check evaluate every tool but report one number). Lets the UI list +
 * link the specific tools behind a server-level finding. `over` = a genuine offender (past the cap)
 * vs. just a top contributor.
 */
export type CompatibilityAffectedTool = {
  toolName: string;
  /**
   * The string the `value` actually measured, when it differs from the bare `toolName` — e.g. the
   * host-namespaced form `mcp__<server>__<tool>` for the namespaced-name-length check, whose char
   * count includes the prefix. The UI shows this (falling back to `toolName`) so the displayed name
   * reconciles with the number; navigation still keys off the bare `toolName`.
   */
  namespacedName?: string;
  value: number;
  unit?: string;
  over: boolean;
};

/** One (test × subject × model) outcome. */
export type CompatibilityResult = {
  testId: string;
  techName: string;
  userFacingName: string;
  level: CompatibilityLevel;
  subjectType: "server" | "tool" | "session" | "environment";
  /** Tool name for tool-level results; server/scan id otherwise. */
  subjectId: string;
  modelId: string;
  verdict: CompatibilityVerdict;
  /** Resolved per-model severity (not the catalog's flat intrinsic weight). */
  severity: CompatibilitySeverity | "na";
  /** Closed-vocabulary consequence kind, e.g. "request_rejected", "context_overflow". */
  failureMode: string;
  measured: { value: number | string | boolean | null; unit?: string };
  threshold: { value: number | string | boolean | null; unit?: string; source?: string };
  message: string;
  recommendation: string;
  /** Filled, model-specific rationale (from the severity resolver). */
  rationale: string;
  evidence: CompatibilityEvidence[];
  /** For aggregate server-level tests: the per-tool breakdown behind the single measured value. */
  affectedTools?: CompatibilityAffectedTool[];
};

/** A heatmap cell: one model's rolled-up verdict over a subject's applicable tests. */
export type CompatibilityCell = {
  modelId: string;
  /** 0..100; `null` when no applicable (non-na) test scored the cell. */
  score: number | null;
  band: CompatibilityBand;
  results: CompatibilityResult[];
};

export type CompatibilityModelRef = {
  id: string;
  providerId: string;
  displayName: string;
};

export type CompatibilityHeatmapRow = {
  subjectType: "server" | "tool" | "environment";
  subjectId: string;
  label: string;
  cells: CompatibilityCell[];
};

export type CompatibilityHeatmap = {
  view: "server" | "tool";
  /** Server-cell roll-up rule applied to tool rows. */
  rollup: "worst-tool" | "average-tool";
  /** Optional host-client target enabling the client-layer tests (e.g. "cursor"). */
  client?: string;
  models: CompatibilityModelRef[];
  rows: CompatibilityHeatmapRow[];
};

// --- Per-test report (the "Tests" tab on a server / tool) -------------------------------------
// The transpose of the heatmap: grouped by TEST, each carrying its per-model outcome. Powers the
// expandable test-results timeline. Only the relevant level is included per subject — server-level
// tests on a server, tool-level tests on a tool (environment + session tests live in their own views).

export type CompatibilityReportModel = {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  /** "saas" | "open_weight" — drives the hosted/open-weight grouping in the UI. */
  group: string;
};

export type CompatibilityTestEntry = {
  testId: string;
  techName: string;
  userFacingName: string;
  level: CompatibilityLevel;
  category: string;
  executionMode: string;
  /** What the test checks (catalog `what_it_does`). */
  whatItDoes: string;
  recommendation: string;
  /**
   * Tally of models by OUTCOME: passing models as `pass`, not-applicable as `na`, and only the
   * failing/warning models by their resolved severity. So a test that passes everywhere reads
   * "33 pass" — never a misleading "33 blocker".
   */
  statusCounts: Partial<Record<"pass" | "na" | CompatibilitySeverity, number>>;
  /** One result per model, in `report.models` order. */
  results: CompatibilityResult[];
};

export type CompatibilityTestReport = {
  subjectType: "server" | "tool";
  subjectId: string;
  subjectLabel: string;
  models: CompatibilityReportModel[];
  entries: CompatibilityTestEntry[];
};

// --- Tool-findings aggregation (server Overview findings + tool-list "Issues" column) -----------
// The single test-driven findings model, transposed two ways from the SAME tool×test×model run:
//  • `byTest`  — tool-level tests aggregated across tools (each carries the offending tools), so the
//                server view can show "Thin descriptions — 11 tools" with links, alongside server tests.
//  • `byTool`  — per-tool severity tally, for the tool-list "Issues" column.

/** A tool flagged by a tool-level test, with its worst severity across models. */
export type ToolFindingTool = {
  toolName: string;
  severity: CompatibilitySeverity;
};

/** One tool-level test aggregated across all tools (offending tools attached, worst-first). */
export type ToolFindingEntry = {
  testId: string;
  techName: string;
  userFacingName: string;
  category: string;
  failureMode: string;
  recommendation: string;
  /** Worst severity across the affected tools. */
  worstSeverity: CompatibilitySeverity;
  tools: ToolFindingTool[];
};

/** Per-tool severity tally (count of that tool's tool-tests by worst-across-models severity). */
export type ToolSeveritySummary = {
  toolName: string;
  counts: Partial<Record<CompatibilitySeverity, number>>;
  /** Total number of distinct tool-tests with a finding. */
  total: number;
};

export type ToolFindingsReport = {
  scanId: string;
  models: CompatibilityReportModel[];
  byTest: ToolFindingEntry[];
  byTool: ToolSeveritySummary[];
};

// --- Server-level Export Report (HTML → print-to-PDF) -----------------------------------------
// The aggregated payload behind the server-level report. ONE round-trip: the redacted server
// profile + the scan footprint + every server-level test (findings AND passes) + the tool-findings
// rollup + the full tool-test report for each FLAGGED tool (≥1 finding). Built by a pure function
// over a ScanDetail (apps/api/src/reports/server-report.ts) and rendered by the web report view
// from @elabs-ai/components-ui. Models are exactly the user-selected set, in column order.

export type ServerReport = {
  generatedAt: string;
  /** Redacted server config — secret values are never present (only hasEnvSecrets/hasHeaderSecrets). */
  server: ServerConfig;
  /** The scan this report is built from (tools / resources / prompts / events). */
  scan: ScanDetail;
  /** Selected models, in column order (same list across every per-model section). */
  models: CompatibilityReportModel[];
  /** Optional host-client target that enabled the client-gated tests (e.g. "cursor"). */
  client?: string;
  /** ALL server-level test entries (findings AND passes), worst-first. */
  serverTests: CompatibilityTestReport;
  /** Tool-level tests transposed two ways: byTest (offending tools) + byTool (issues tally). */
  toolFindings: ToolFindingsReport;
  /** Full tool-test report for each tool that has ≥1 finding (the "detail if flagged" set). */
  flaggedToolTests: CompatibilityTestReport[];
  /**
   * RM-20 WP 2.2 (D-SP24) — the security-posture section: the analyzer's own report for this scan,
   * or an honest reason one could not be produced. **Optional and additive** — absent when the
   * builder was handed no analyzer at all, which is how every pre-existing caller keeps producing
   * exactly the document it produced before. See `SecurityPostureSection` in `security-posture.ts`.
   */
  security?: SecurityPostureSection;
};

// --- Skills (Agent Skill registry + versioning) — Phase 1 contract ---------------------------
// Contract-first wire shapes for the Skills feature. The API is the only side that touches the
// network/filesystem/git and decrypted secrets; the web receives REDACTED data only (the single
// skill secret — a GitHub PAT — is never returned; exposed as `hasAuth: boolean`). Source of truth:
// planning/Research/RS-02-skill-registry/outputs/05-api-surface.md (types + zod), 03 (data model), 08 (attachment).

/** Where a skill was ingested from. */
export type SkillSourceType = (typeof SKILL_SOURCE_TYPES)[number];

/** How a file inside a skill version is classified (drives the tree + L2/L3 token accounting). */
export type SkillFileKind = (typeof SKILL_FILE_KINDS)[number];

/** Parsed SKILL.md frontmatter. `allowedTools` stays the raw space-separated string, per the spec. */
export type SkillManifest = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string; // raw space-separated string, per spec
  // Skill IDE WP 8.1 (I9.1) — the portable server-binding list: names of the MCP servers this skill is
  // authored against (tolerated metadata, order-preserving, survives GitHub sync / zip export, like
  // `keywords:`). Resolved to registered servers per-skill via `skill_server_bindings`; never guessed.
  // Additive/optional — a skill without `servers:` in its frontmatter carries none.
  servers?: string[];
};

/** api → web view of a skill (redacted: no PAT, only a `hasAuth` boolean on the GitHub binding). */
export type Skill = {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  sourceType: SkillSourceType;
  description?: string;
  currentVersionId?: string;
  versionCount: number;
  // GitHub binding (present when sourceType === 'github'):
  github?: { repoUrl: string; ref: string; subpath: string; lastSha?: string; hasAuth: boolean };
  createdAt: string;
  updatedAt: string;
};

/** Level subtotals of a skill version's token footprint (L1 metadata, L2 body, L3 resources). */
export type SkillTokenFootprint = {
  tokenProfile: TokenProfileId;
  l1MetadataTokens: number;
  l2BodyTokens: number;
  l3ResourceTokens: number;
  totalTokens: number;
};

/** An immutable version of a skill (a content-addressed tree snapshot + its footprint + manifest). */
export type SkillVersion = SkillTokenFootprint & {
  id: string;
  skillId: string;
  seq: number;
  versionLabel: string;
  treeSha: string;
  sourceKind: SkillSourceType;
  sourceRef?: string;
  manifest: SkillManifest;
  manifestValid: boolean;
  manifestErrors: string[];
  fileCount: number;
  totalBytes: number;
  importedFrom: "upload" | "github-pull";
  note?: string;
  createdAt: string;
};

/** One file in a skill version's flat file list (the UI builds the tree). */
export type SkillFileNode = {
  path: string; // posix, relative to skill root
  size: number;
  isBinary: boolean;
  isSkillMd: boolean;
  kind: SkillFileKind;
  tokenTotal: number;
};

/** One file's content: text inline for text files; a download path for binary files. */
export type SkillFileContent =
  | { path: string; isBinary: false; text: string; tokenTotal: number }
  | { path: string; isBinary: true; size: number; downloadPath: string };

/** One file's change between two skill versions (token delta = to − from). */
export type SkillDiffEntry = {
  status: "added" | "removed" | "modified" | "renamed" | "unchanged";
  path: string;
  fromPath?: string; // for renames
  kind: SkillFileNode["kind"];
  fromTokens?: number;
  toTokens?: number;
  tokenDelta: number;
  binary: boolean;
};

/** Full-tree diff between two skill versions: per-file entries + a rollup + a manifest-field diff. */
export type SkillDiff = {
  skillId: string;
  fromVersionId: string;
  toVersionId: string;
  entries: SkillDiffEntry[];
  rollup: {
    filesAdded: number;
    filesRemoved: number;
    filesModified: number;
    filesRenamed: number;
    bytesDelta: number;
    l1Delta: number;
    l2Delta: number;
    l3Delta: number;
    totalDelta: number;
  };
  manifestDiff: { field: string; from?: string; to?: string }[];
};

/** GitHub discovery (probe) result — which SKILL.md dirs a repo/ref exposes (no persistence). */
export type SkillRepoProbe = {
  repoUrl: string;
  ref: string;
  ok: boolean;
  requiresAuth: boolean;
  commitSha?: string;
  candidates: { subpath: string; name?: string; description?: string }[]; // one per SKILL.md found
  message: string;
  errorMessage?: string;
};

// --- Skill scenario attachment (Phase 2 — WP 2.1 extends `Scenario` with `allowedSkills`) --------

/** How an attached skill selects its version: track `latest` at run time, or `pinned` (fixed id). */
export type SkillVersionMode = (typeof SKILL_VERSION_MODES)[number];

/** A skill attached to a scenario. `pinnedVersionId` is required iff `versionMode === 'pinned'`. */
export type AllowedSkill = {
  skillId: string;
  versionMode: SkillVersionMode;
  pinnedVersionId?: string; // required iff versionMode === 'pinned'
  // Eager toggle (WP 2.3): when true, the resolved version's full SKILL.md body is inlined into the
  // run's system prompt up front (a deliberate worst-case comparison) — in addition to the always-on
  // L1 `<available_skills>` block. Off by default. Additive/optional; older attachments read false.
  eager?: boolean;
};

// --- Skill usage (UX WP 3.3, G11/S20) — where a skill lives in the app ----------------------------
// The read-only "usage" projection of a skill: which environments (scenarios) it is attached to, and
// its most recent runs. Powers the skill Overview "usage" panel ("Used by N environments · last run …")
// and the one-click "Test this skill" launch. Read-only over `scenario_skills` + `run_skills`.

/** One environment (scenario) a skill is attached to, with the version-selection mode. */
export type SkillUsageEnvironment = {
  scenarioId: string;
  name: string;
  versionMode: SkillVersionMode;
  /** Present iff `versionMode === 'pinned'` — the fixed version the attachment pins to. */
  pinnedVersionId?: string;
  /** The eager inline toggle on the attachment (WP 2.3). */
  eager: boolean;
};

/** One recent run that RESOLVED this skill (any version), for the "last run" affordance. */
export type SkillUsageRun = {
  runId: string;
  status: RunStatus;
  outcome?: RunOutcome;
  startedAt: string;
  /** The concrete skill version the run resolved (denormalized display label from `run_skills`). */
  versionLabel: string;
  /** The environment the run executed in (denormalized for the run link's context). */
  scenarioId: string;
  scenarioName?: string;
};

/** A skill's usage across the app — attached environments + recent runs. `GET /api/skills/:id/usage`. */
export type SkillUsage = {
  skillId: string;
  environments: SkillUsageEnvironment[];
  /** Recent runs that resolved this skill, newest first (capped by the API). */
  runs: SkillUsageRun[];
};

// --- SkillFlow (graph IR + trace vocabulary + session-trace) — Phase 1 contract (WP 1.0) ------
// Three shapes: (1) the skill graph IR — a design-time model projected from SKILL.md; (2) the
// normalized trace-event vocabulary — the alphabet a session (internal run OR uploaded log) speaks;
// (3) the session-trace shape — a trace aligned against the graph. Projection + alignment are
// deterministic and land in later WPs; this WP freezes the contract. All later additions are
// ADDITIVE fields only. Source of truth: planning/Roadmap/RM-23-skillflow/00-architecture.md (D2/D6/D7/D8).

/** A skill graph node kind (aligned with `SKILL_FILE_KINDS`, not a parallel taxonomy — D8). */
export type SkillGraphNodeKind = (typeof SKILL_GRAPH_NODE_KINDS)[number];

/** How a node/edge entered the graph: `inferred` from structure/prose, or `annotated` from a comment. */
export type SkillGraphSource = (typeof SKILL_GRAPH_SOURCES)[number];

/** A node/edge's anchor back into the markdown: the heading path plus a (1-based) line range. */
export type SkillGraphAnchor = {
  headingPath: string[];
  startLine: number;
  endLine: number;
};

/** An entry point's trigger kind (Skill IDE I1) — a `/command` or a natural-language keyword. */
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** Fields every graph node carries, regardless of kind. */
export type SkillGraphNodeCommon = {
  id: string;
  label: string;
  anchor: SkillGraphAnchor;
  source: SkillGraphSource;
  /**
   * Skill IDE WP 1.1 (I1) — the flow this node belongs to (the owning entry point's node id, or the
   * skill's default body flow). ADDITIVE: absent ⇒ `DEFAULT_SKILL_FLOW_ID` (`'main'`). Existing
   * (pre-IDE) graphs carry no `flowId` and read as one `main` flow — no regression.
   */
  flowId?: string;
};

/**
 * A node in the skill graph IR — a discriminated union on `kind`. Kind-specific fields: `asset`
 * references a bundled file (`path` + a reused `SkillFileKind`); `validation_gate` names a `script`
 * and its `expectation`; `loop_guard` may cap iterations; `entry_point` (Skill IDE I1) heads a flow
 * with a `trigger` (a /command or keyword); `gatekeeper`/`subroutine` add nothing required beyond
 * the common fields.
 */
export type SkillGraphNode =
  | (SkillGraphNodeCommon & { kind: "gatekeeper" })
  | (SkillGraphNodeCommon & { kind: "subroutine" })
  | (SkillGraphNodeCommon & { kind: "asset"; path: string; fileKind: SkillFileKind })
  | (SkillGraphNodeCommon & { kind: "validation_gate"; script: string; expectation: string })
  | (SkillGraphNodeCommon & { kind: "loop_guard"; maxIterations?: number })
  | (SkillGraphNodeCommon & {
      kind: "entry_point";
      trigger: { type: TriggerKind; value: string };
    })
  // Skill IDE WP 8.1 (I9.2) — an ACCESSORY leaf citing an MCP tool a section references, projected
  // from TEXT EVIDENCE ALONE (the conservative extraction heuristic; the projector never reads scans).
  // `toolName` is the backticked reference verbatim; `serverName` is populated later by the validation
  // overlay / binding resolution (never guessed by the projector). Additive — a skill with no tool
  // references projects no `tool_ref` node (regression-locked).
  | (SkillGraphNodeCommon & { kind: "tool_ref"; toolName: string; serverName?: string });

/**
 * A directed edge in the skill graph. `condition` labels a gatekeeper branch; `anchor` is optional.
 * `flowId` (Skill IDE WP 1.1/I1) is ADDITIVE — absent ⇒ `DEFAULT_SKILL_FLOW_ID` (`'main'`); a
 * cross-flow edge (e.g. "see /other") carries the source flow's id.
 */
export type SkillGraphEdge = {
  id: string;
  from: string;
  to: string;
  condition?: string;
  anchor?: SkillGraphAnchor;
  flowId?: string;
};

/**
 * The skill graph IR: nodes + edges + projector warnings (e.g. a reference to a missing file).
 * `flows` (Skill IDE WP 1.1/I1) is ADDITIVE — the ordered flow list (one per entry point + the
 * default `main` flow); absent ⇒ a single implicit `main` flow. `entryNodeId` names the flow's
 * `entry_point` node (absent for the default body flow).
 */
export type SkillGraph = {
  nodes: SkillGraphNode[];
  edges: SkillGraphEdge[];
  warnings: string[];
  flows?: Array<{ id: string; label: string; entryNodeId?: string }>;
};

/** One normalized trace-event type (the shared vocabulary — D6). */
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

/**
 * A normalized trace event — a discriminated union on `type`. `idx` is the event's 0-based position
 * in the trace (the aligner cites these in verdict `evidence`); `at` is an optional ISO timestamp.
 * Payloads are typed per type: `skill_file_read` carries `{ skill, path }`, `script_result` carries
 * `{ script?, exitCode }`, `marker` carries `{ raw, gateId?, routeId? }`.
 */
export type TraceEvent =
  | {
      type: "turn";
      idx: number;
      at?: string;
      payload: { role?: "assistant" | "user"; text?: string };
    }
  | { type: "tool_call"; idx: number; at?: string; payload: { tool: string; args?: unknown } }
  | {
      type: "tool_result";
      idx: number;
      at?: string;
      payload: { tool?: string; status?: string; bytes?: number; result?: unknown };
    }
  | {
      type: "skill_file_read";
      idx: number;
      at?: string;
      payload: { skill: string; path: string; bytes?: number };
    }
  | {
      type: "script_result";
      idx: number;
      at?: string;
      payload: { script?: string; exitCode: number; stdout?: string; stderr?: string };
    }
  | {
      type: "subagent_spawn";
      idx: number;
      at?: string;
      payload: { label?: string; prompt?: string };
    }
  | {
      type: "marker";
      idx: number;
      at?: string;
      payload: { raw: string; gateId?: string; routeId?: string };
    }
  | { type: "user_message"; idx: number; at?: string; payload: { text: string } };

/** A per-node/per-edge conformance verdict status (D7). */
export type TraceVerdictStatus = (typeof TRACE_VERDICT_STATUSES)[number];

/** WP 3.2 — a verdict's evidentiary confidence (see {@link TRACE_VERDICT_CONFIDENCE}). */
export type TraceVerdictConfidence = (typeof TRACE_VERDICT_CONFIDENCE)[number];

/**
 * A conformance verdict against one design element — at least one of `nodeId`/`edgeId` is present
 * (enforced by the zod schema). `evidence` cites the trace-event `idx`s that justify it. `confidence`
 * (WP 3.2, additive) is `'exact'` when the evidence includes a breadcrumb `marker` or a `script_result`
 * (deterministic hard evidence), `'inferred'` otherwise — e.g. every verdict on a marker-less trace.
 */
export type TraceVerdict = {
  nodeId?: string;
  edgeId?: string;
  status: TraceVerdictStatus;
  reason: string;
  evidence: number[];
  confidence?: TraceVerdictConfidence;
};

/**
 * The result of aligning a trace against a graph: per-node visit counts, per-edge traversal counts,
 * the verdicts, the `idx`s of events that matched no design element, and the algorithm version
 * stamps (never compare alignments computed under different projector/aligner versions).
 */
export type TraceAlignment = {
  nodeVisits: Record<string, number>;
  edgeTraversals: Record<string, number>;
  verdicts: TraceVerdict[];
  unmatchedEvents: number[];
  projectorVersion: number;
  alignerVersion: number;
};

/** Where a trace came from (only this app's own test runs — owner decision 2026-07-03). */
export type TraceSource = (typeof TRACE_SOURCES)[number];

/**
 * A trace: its `source` (an internal test run), a `ref` back to that source, the resolved
 * `skillVersionId` it is aligned against, the normalized event stream, and the alignment.
 */
export type SessionTrace = {
  source: TraceSource;
  ref: string;
  skillVersionId: string;
  events: TraceEvent[];
  alignment: TraceAlignment;
};

/** Response of the graph route (`GET /api/skills/:id/versions/:vid/graph`) — graph + version stamp. */
export type SkillGraphResponse = {
  graph: SkillGraph;
  projectorVersion: number;
};

/**
 * Response of `GET /api/runs/:runId/trace` (WP 2.1) — the normalized run→trace event stream, with the
 * resolved `skillVersionId` the run exercised, but NO alignment yet (that lands in a later WP). A
 * deliberately lighter shape than {@link SessionTrace} (whose `alignment` is required).
 */
export type RunTraceResponse = {
  source: "run";
  ref: string;
  skillVersionId: string;
  events: TraceEvent[];
};

/** Create-skill body for the blank source (D3) — the third `skillImportSchema` member. */
export type BlankSkillImportInput = {
  source: "blank";
  name: string;
  displayName?: string;
  description: string;
};

// --- SkillFlow Phase 4 (WP 4.1) — graph-level edit ops → SKILL.md round-trip ------------------
// The write half of Design Mode: a set of graph-level operations applied to a version's SKILL.md
// through the projected anchors, preserving every untouched byte (D5), submitted as a NEW immutable
// version via the existing ingest path. Ops that cannot be applied without guessing degrade to a
// warning + skip (never a corrupted document).

/** One graph-edit operation type (discriminant of {@link SkillEditOp}). */
export type SkillEditOpType = (typeof SKILL_EDIT_OP_TYPES)[number];

/**
 * A graph-level edit operation — a discriminated union on `op`. Section ops (`rename_node`,
 * `update_section_body`, `add_subroutine`, `remove_node`, `reorder`, `add_asset_ref`,
 * `set_gate_expectation`, `set_annotation`) target a SECTION node's id (a node whose anchor starts
 * at a heading line); `set_edge_condition` targets an edge id. `afterNodeId: null` means "at the
 * start" for `reorder` and "at the document end" for `add_subroutine`.
 */
export type SkillEditOp =
  | { op: "rename_node"; nodeId: string; label: string }
  | { op: "update_section_body"; nodeId: string; body: string }
  | { op: "add_subroutine"; afterNodeId: string | null; title: string; body?: string }
  | { op: "remove_node"; nodeId: string }
  | { op: "reorder"; nodeId: string; afterNodeId: string | null }
  | { op: "set_edge_condition"; edgeId: string; condition: string }
  | { op: "add_asset_ref"; nodeId: string; path: string; sentence?: string }
  | { op: "set_gate_expectation"; nodeId: string; expectation: string }
  | { op: "set_annotation"; nodeId: string; kind: "gatekeeper" | "gate"; id: string }
  // --- Skill IDE WP 1.1 (I2/I3) — IDE op vocabulary (types only; semantics in later WPs) ---------
  // Canvas + trigger-manager + workspace interactions compile to these anchored text / tree edits.
  // Command ops (I2): a /command entry point and its flow.
  | { op: "add_command"; command: string; title?: string; body?: string; afterFlowId?: string }
  | { op: "rename_command"; nodeId: string; command: string }
  | { op: "delete_command"; nodeId: string }
  // Trigger/keyword op (I7): replace the skill's keyword trigger set.
  | { op: "set_keywords"; keywords: string[] }
  // Asset connect/disconnect (I2): wire a step to a bundled file (or unwire it).
  | { op: "connect_asset"; nodeId: string; path: string; sentence?: string }
  | { op: "disconnect_asset"; nodeId: string; path: string }
  // Tree/file ops (I3): folders are implicit path prefixes; SKILL.md can't be renamed/deleted.
  | { op: "add_file"; path: string; content: string; encoding?: SkillFileEncoding }
  | { op: "update_file"; path: string; content: string; encoding?: SkillFileEncoding }
  | { op: "rename_file"; from: string; to: string }
  | { op: "delete_file"; path: string }
  // Skill IDE WP 8.1 (I9.3) — reference a bound server's tool from a SECTION node (append a reference
  // sentence to its body). A 400-STUB this WP; the anchored-splice semantics land in WP 8.3.
  | { op: "add_tool_ref"; nodeId: string; server: string; tool: string; sentence?: string };

/** Encoding of an `add_file`/`update_file` op's `content` (I3). Absent ⇒ `utf8`. */
export type SkillFileEncoding = (typeof SKILL_FILE_ENCODINGS)[number];

/**
 * Body of `POST /api/skills/:id/versions/:vid/edits`. `baseTreeSha` is the tree the client
 * projected its graph from — a mismatch with the version's `tree_sha` means the anchors are stale
 * and the request is rejected with 409 (never a best-effort guess).
 */
export type SkillEditsRequest = {
  baseTreeSha: string;
  ops: SkillEditOp[];
  note?: string;
};

/**
 * Response of the edits route: either a real new immutable version plus the diff vs. the base
 * version (WP 1.5 diff engine), or `{ unchanged: true }` when the ops left the tree byte-identical
 * (empty op list, or every op degraded to a warning + skip). `warnings` lists the skipped ops.
 */
export type SkillEditsResponse =
  | { unchanged: true; warnings?: string[] }
  | { version: SkillVersion; diff: SkillDiff; warnings?: string[] };

/**
 * Body of `POST /api/skills/:id/versions/:vid/restore` — restore an older version as the new latest.
 * The version to restore FROM is the `:vid` path param; the body only carries an optional `note` that
 * overrides the auto-generated "Restored from v{seq}". The response reuses {@link SkillEditsResponse}:
 * a new head version + the diff vs the previous latest, or `{ unchanged: true }` when the chosen
 * version's tree already equals the current head (nothing to restore).
 */
export type RestoreSkillVersionRequest = {
  note?: string;
};

// --- Skill IDE Phase 9 (WP 9.1, I10) — live-draft engine: stateless previews + content-canonical save ---
// The I10 foundation: ONE canonical draft (SKILL.md text + pending tree ops + an op intent log), both
// views live. Two PURE, stateless endpoints project/splice a draft without persisting anything, and a
// content-canonical save turns the draft into a new immutable version — the staged-op audit riding
// along as version metadata so op-level granularity survives the move to text-canonical saves.

/**
 * Body of `POST /api/skillflow/apply-preview` (I10.1) — the STATELESS splice: apply a batch of
 * anchored text/graph ops to `content` and return the edited text. `files` (optional) lets the
 * projection resolve asset/gate references exactly as the persisted edits path does, so the preview
 * is byte-identical to a real save by construction. Nothing is persisted; no scan/MCP read.
 */
export type ApplyPreviewRequest = {
  content: string;
  ops: SkillEditOp[];
  files?: SkillFileNode[];
};

/**
 * Response of apply-preview: the edited `content` (byte-identical to the persisted-path splice) plus
 * the degrade warnings the SAME engine emits (an op that can't be applied without guessing degrades
 * to a warning + skip). An op whose anchors don't resolve against `content` is a 400-with-reason on
 * the route (there is no persisted version to 409 against here).
 */
export type ApplyPreviewResponse = {
  content: string;
  warnings: string[];
};

/**
 * Body of `POST /api/skillflow/project-preview` (I10.2) — project `content` into a live `SkillGraph`.
 * `files` (optional) matches the persisted projection (asset/gate nodes resolve against the tree).
 * Same projector as the persisted graph route — one implementation, one version stamp.
 */
export type ProjectPreviewRequest = {
  content: string;
  files?: SkillFileNode[];
};

/** Response of project-preview: the projected graph + its warnings + the `SKILLFLOW_PROJECTOR_VERSION`
 *  stamp (never compare projections from different projector versions). */
export type ProjectPreviewResponse = {
  graph: SkillGraph;
  warnings: string[];
  projectorVersion: number;
};

/**
 * One entry of a save's op INTENT LOG (I10.3) — the audit that survives the content-canonical save:
 * the staged op plus an optional human-readable `summary` and staging timestamp `at`. Persisted as
 * version metadata (`intent_log_json`) so op-level granularity isn't lost when the draft saves as
 * text (the diff shows WHAT changed; the intent log records the OPS that produced it).
 */
export type SkillIntentLogEntry = {
  op: SkillEditOp;
  summary?: string;
  at?: string;
};

/**
 * Body of `POST /api/skills/:id/save-draft` (I10.3) — the content-canonical save of the live draft.
 * `baseVersionId` is the head the draft was forked from (409 when the head moved — someone saved a
 * newer version since); `content` is the final SKILL.md; `treeOps` are pending file/tree ops applied
 * to the base tree at save; `intentLog` is the op audit attached to the new version's metadata.
 */
export type SaveSkillDraftRequest = {
  baseVersionId: string;
  content: string;
  treeOps: SkillEditOp[];
  intentLog: SkillIntentLogEntry[];
  note?: string;
};

// --- SkillFlow Phase 5 (WP 5.2) — the feedback loop: fracture verdicts → suggested edits ---------
// Deterministic-only (D7's LLM-assisted branch is owner-gated and out of scope here): a pure
// function of a version's graph + its trace alignment, never auto-applied. Every suggestion is
// presented as a reviewable `SkillEditOp[]` batch (routed through the SAME WP 4.1/4.2 apply path),
// or — when a rule has something to say but nothing safe to auto-draft — an ADVISORY suggestion
// whose `ops` is the empty array (the UI renders it with no "apply" affordance).

/** One deterministic suggestion rule id (kebab-case; see {@link SKILLFLOW_SUGGESTION_RULES}). */
export type SkillSuggestionRule = (typeof SKILLFLOW_SUGGESTION_RULES)[number];

/** The verdict a suggestion was derived from — at least one of `nodeId`/`edgeId` names it. */
export type SkillSuggestionVerdictRef = {
  nodeId?: string;
  edgeId?: string;
  status: TraceVerdictStatus;
};

/**
 * A single deterministic suggestion: which verdict it came from (`verdictRef`), which rule produced
 * it, a human-readable `rationale`, and the `ops` batch. `id` is DETERMINISTIC — derived from
 * `rule` + the verdict's node/edge id (never `Date.now()`/randomness) — so the same `(graph,
 * alignment)` always yields the same suggestion ids. `ops: []` marks an ADVISORY suggestion (a
 * rationale worth surfacing, but nothing this deterministic engine will draft on the author's
 * behalf); a non-empty `ops` is guaranteed to have already passed `validateEditOps` against the
 * SAME graph — the no-corruption guarantee (WP 5.2).
 */
export type SkillSuggestion = {
  id: string;
  verdictRef: SkillSuggestionVerdictRef;
  rule: SkillSuggestionRule;
  rationale: string;
  ops: SkillEditOp[];
};

// --- Skill IDE WP 4.2 — STATIC (trace-less) optimization suggestions -----------------------------
// The static optimizer surfaces suggestions from a version's projected graph + file tree + token
// footprint alone (no run/alignment). It shares the `SkillEditOp[]` fix-op vocabulary with the trace
// engine and the quality engine (the "unified shape"), but carries its OWN rule vocabulary
// (`SKILLFLOW_STATIC_SUGGESTION_RULES`) and an optional `target` anchor rather than a trace
// `verdictRef` — a static suggestion has no verdict. Kept a distinct type (not a widened
// `SkillSuggestion`) so the trace-rule union `SkillSuggestionRule` — over which the web renders a
// TOTAL label map — stays exactly the five trace rules.

/** One static (trace-less) optimization rule id (kebab-case; see {@link SKILLFLOW_STATIC_SUGGESTION_RULES}). */
export type SkillStaticSuggestionRule = (typeof SKILLFLOW_STATIC_SUGGESTION_RULES)[number];

/** What a static suggestion is about — the section node it edits and/or the file path it concerns. */
export type SkillStaticSuggestionTarget = {
  nodeId?: string;
  path?: string;
};

/**
 * A single deterministic STATIC suggestion (WP 4.2): which rule produced it, a human-readable
 * `rationale`, the reviewable `ops` batch, and an optional `target` anchor. `id` is DETERMINISTIC —
 * derived from `rule` + the target — so the same `(graph, files, footprint)` always yields the same
 * ids. `ops: []` marks an ADVISORY suggestion (a rationale worth surfacing, but nothing this
 * deterministic engine will draft on the author's behalf); a non-empty `ops` is guaranteed to have
 * already passed `validateEditOps` against the SAME graph/files — the no-corruption guarantee.
 */
export type SkillStaticSuggestion = {
  id: string;
  rule: SkillStaticSuggestionRule;
  rationale: string;
  ops: SkillEditOp[];
  target?: SkillStaticSuggestionTarget;
};

/**
 * Response of `GET /api/skills/:id/versions/:vid/suggestions` — the (trace) suggestion list plus the
 * algorithm-version stamps the underlying graph/alignment were computed under (mirrors
 * {@link TraceAlignment}'s stamping rule — never silently compare suggestions computed under
 * different projector/aligner versions). WP 4.2 adds `staticSuggestions`: when the route is called
 * WITHOUT a `runId` it returns trace-less static optimization suggestions here (with `suggestions`
 * empty and `alignerVersion` 0 — no alignment ran); a `runId` call keeps returning the trace
 * `suggestions` with `staticSuggestions` absent/empty. The field is additive/optional so existing
 * (trace-only) consumers compile unchanged.
 */
export type SkillSuggestionsResponse = {
  suggestions: SkillSuggestion[];
  staticSuggestions?: SkillStaticSuggestion[];
  projectorVersion: number;
  alignerVersion: number;
};

// --- Skill IDE Phase 1 (WP 1.1) — quality / tool-validation / trigger / publish shapes ----------
// The additive contract for the Skill IDE engines. Every shape is typed + zod'd + round-trip tested
// here; the ENGINES that produce them (deterministic, versioned, never executing skill content —
// I4/I5/I6/I8) land in later WPs. Source of truth: planning/Roadmap/RM-22-skill-ide/00-architecture.md (I1–I8).

/** Severity of a quality finding (I4) — drives the score weight and the UI band. */
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

/**
 * One deterministic quality finding (I4): a `ruleId` (kebab-case rule name), its `severity`, a
 * human-readable `message`, an optional `anchor` back into SKILL.md, and an optional `fix` — a
 * reviewable `SkillEditOp[]` batch (routed through the SAME apply path as every other edit; never
 * auto-applied). No model calls anywhere.
 */
export type QualityFinding = {
  ruleId: string;
  severity: QualitySeverity;
  message: string;
  anchor?: SkillGraphAnchor;
  fix?: SkillEditOp[];
};

/**
 * A skill version's quality report (I4): the findings, a 0–100 integer `score` derived from
 * `QUALITY_SEVERITY_WEIGHTS` (its single source of truth), a per-rule finding tally, and the
 * `qualityEngineVersion` stamp (never silently compare reports across engine versions).
 */
export type QualityReport = {
  findings: QualityFinding[];
  score: number; // 0–100 integer
  ruleCounts: Record<string, number>; // ruleId → number of findings
  qualityEngineVersion: number;
};

/** An MCP tool-reference diagnostic's kind (I5) — never scanned, no MCP calls (persisted scans only). */
export type ToolDiagnosticKind = (typeof TOOL_DIAGNOSTIC_KINDS)[number];

/** How confidently a close-match candidate matches a referenced tool name (reuses the compare basis). */
export type ToolCandidateConfidence = (typeof TOOL_CANDIDATE_CONFIDENCE)[number];

/** A close-match candidate for an unknown/stale tool reference — which server/tool, and how sure. */
export type ToolDiagnosticCandidate = {
  server: string;
  tool: string;
  confidence: ToolCandidateConfidence;
};

/**
 * One tool-reference diagnostic (I5): the `kind`, the referenced `name`, an optional `anchor` back
 * into SKILL.md, and close-match `candidates` (exact→normalized→fuzzy, reusing the compare feature).
 */
export type ToolDiagnostic = {
  kind: ToolDiagnosticKind;
  name: string;
  anchor?: SkillGraphAnchor;
  candidates: ToolDiagnosticCandidate[];
};

/** The tool-reference validation report (I5): diagnostics + the `toolValidationVersion` stamp. */
export type ToolDiagnosticsReport = {
  diagnostics: ToolDiagnostic[];
  toolValidationVersion: number;
  /**
   * Names of scoped registered servers with zero completed scans (WP 5.1) — skipped by the matcher
   * (they'd otherwise produce false `unknown_tool`s) and surfaced here so the author knows validation
   * couldn't cover them. Omitted when every scoped server has at least one completed scan.
   */
  unscannedServers?: string[];
};

/**
 * A skill's trigger surface (I7): its `description`, its `keywords`, and its `commands` (each a
 * trigger `value` plus the owning `nodeId`/`flowId`). Powers the trigger-manager panel.
 */
export type TriggerSurface = {
  description: string;
  keywords: string[];
  commands: Array<{ value: string; nodeId: string; flowId: string }>;
};

/**
 * A cross-skill trigger collision (I7): a trigger `value` of a given `kind` (`command`/`keyword`)
 * claimed by more than one skill (`skillIds`) — surfaced so an enterprise catalog stays unambiguous.
 */
export type TriggerCollision = {
  value: string;
  kind: TriggerKind;
  skillIds: string[];
};

/**
 * Body of the publish-to-GitHub route (I6). `repoName` must match `GITHUB_REPO_NAME_PATTERN`;
 * `private` sets the new repo's visibility; `token` is a PAT (accepted here, never returned —
 * argv-only credential-helper handling like `SkillGitService`); `bindAsSource` optionally binds the
 * new repo as the skill's `github` source so pull/upstream work immediately.
 */
export type PublishToGithubInput = {
  repoName: string;
  private: boolean;
  token?: string;
  bindAsSource: boolean;
};

/** Result of publish-to-GitHub (I6): the created `repoUrl` and whether it was `bound` as the source. */
export type PublishToGithubResult = {
  repoUrl: string;
  bound: boolean;
};

/** How a skill push-back reaches the source repo: commit to the tracked branch, or a new branch + PR. */
export type SkillPushMode = "direct" | "pr";

/**
 * Body of the push-to-GitHub route (push a skill version BACK to its bound source repo).
 * `mode: "direct"` commits onto the tracked ref and pushes it (merge-first, never force);
 * `mode: "pr"` pushes a new head `branch` and opens a pull request against the tracked ref via the
 * GitHub REST API. `token` is a PAT override (falls back to the skill's stored auth — accepted here,
 * never returned; argv-only credential handling like `SkillGitService`).
 */
export type SkillPushToGithubInput = {
  mode: SkillPushMode;
  commitMessage?: string; // default: "Update <skill> to <version_label>"
  branch?: string; // pr mode: head branch name (default: "skill/<slug>-<version_label>")
  prTitle?: string; // pr mode (default: the commit message)
  prBody?: string; // pr mode
  token?: string; // PAT override; never echoed back
};

// --- GitHub account (Settings sign-in via the OAuth DEVICE FLOW) ----------------------------------
// One app-wide GitHub identity so every skill GitHub operation (import / pull / push / PR / publish)
// can act as the signed-in user. Requires an owner-registered GitHub OAuth App with the device flow
// enabled — its CLIENT ID is configuration (not a secret); the resulting access token is stored
// ENCRYPTED (SecretStore) and never returned by the API. Precedence for any one operation stays:
// explicit dialog token → the skill's stored PAT → the signed-in account.

/** The redacted app-wide GitHub account state (never carries the token). */
export type GithubAccountStatus = {
  connected: boolean;
  /** True once an OAuth App client id is configured (the device flow can start). */
  clientIdConfigured: boolean;
  /** The configured OAuth App client id (public configuration, not a secret). */
  clientId?: string;
  login?: string;
  name?: string;
  avatarUrl?: string;
  /** OAuth scopes granted to the token (from GitHub's `x-oauth-scopes`). */
  scopes?: string[];
  connectedAt?: string;
};

/** A started device-flow: show `userCode` + `verificationUri`, then poll with `flowId`. */
export type GithubDeviceStart = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number; // seconds until the user code expires
  interval: number; // MINIMUM seconds between polls
};

/** One poll of a device flow: still waiting (poll again after `interval`) or signed in. */
export type GithubDevicePoll =
  | { status: "pending"; interval: number }
  | { status: "connected"; account: GithubAccountStatus };

/**
 * Result of push-to-GitHub. `unchanged` = the version's tree is identical to the repo content at the
 * tracked subpath — nothing was committed or pushed. For `mode: "pr"`, `prUrl`/`prNumber` identify
 * the created pull request.
 */
export type SkillPushToGithubResult = {
  mode: SkillPushMode;
  repoUrl: string;
  branch: string; // the branch pushed to (tracked ref for direct; the head branch for pr)
  unchanged: boolean;
  commitSha?: string; // the new commit (absent when unchanged)
  prUrl?: string;
  prNumber?: number;
};

// --- Skill IDE WP 8.1 (I9.1) — server binding (portable name → local resolution) -----------------
// A skill's frontmatter carries a PORTABLE `servers:` name list; the IDE resolves each name to an
// EXACT registered server through a per-skill development binding (`skill_server_bindings`). An
// unresolved name is an honest `serverId: null` (unbound) — features degrade, the resolver NEVER
// guesses. Read-only over the registered-server list (name → id, no secrets decrypted).

/**
 * One skill→server binding: the portable `serverName` (as it appears in frontmatter / the picker) and
 * the registered `serverId` it resolves to, or `null` when no registered server matches (unbound).
 *
 * Server-types WP 3.1 (D-ST3) adds two ADDITIVE, strictly-optional fields carried ONLY when the entry
 * resolved through a server TYPE (they are absent for exact-server matches and persisted overrides, so
 * every pre-existing binding response stays byte-compatible):
 * - `typeId` — the matched {@link ServerType} id when the frontmatter name named a server type. In
 *   practice a matched type always yields its id; the `| null` keeps the field shape open.
 * - `resolvedVia` — `"type"` when the binding resolved to a type's REPRESENTATIVE member server (the
 *   member with the newest successful scan). Left undefined for a plain registered-server match and for
 *   the unbound (`null`) / unresolved state. A type match sets `resolvedVia: "type"` even when the type
 *   currently has NO scanned member (then `serverId` is still `null` — honest unbound, but the UI can
 *   tell it named a real type). The `"server"` value is reserved for future use; today a server match
 *   leaves `resolvedVia` undefined so existing responses stay byte-identical.
 */
export type SkillServerBinding = {
  serverName: string;
  serverId: string | null;
  typeId?: string | null;
  resolvedVia?: "server" | "type";
};

/**
 * Body of `PUT /api/skills/:id/bindings` — the full binding set to upsert (REPLACE semantics: the
 * skill's `skill_server_bindings` rows become exactly these). A `serverId: null` row is an explicit
 * unbound state. GET returns the same {@link SkillServerBinding}[] shape (frontmatter `servers:` order).
 */
export type SkillBindingsInput = {
  bindings: SkillServerBinding[];
};

// --- Skill IDE WP 8.2 (I9.3) — editor assistance: bound-tools from the bound servers' scans --------
// The read-only surface behind Monaco completion + hover in the skill editor. For each RESOLVED
// binding (a `servers:` name mapped to a registered server), the server's LATEST completed scan's
// tools are projected as a flat, editor-friendly list — description, a compact param summary parsed
// from the tool's input schema, and the definition token cost. Read from PERSISTED scans only
// (`ScanRepository`); fetching it NEVER opens an MCP connection (I5/I9 never-scan discipline).

/**
 * One top-level input-schema parameter of a bound tool: its `name`, JSON-schema `type` (a joined
 * union like `"string | null"` when the schema declares several, `"enum"` for an untyped enum, or
 * `"unknown"` when the schema omits a type), and whether it's in the schema's `required` array.
 */
export type BoundToolParam = {
  name: string;
  type: string;
  required: boolean;
};

/**
 * One tool exposed by a server the skill is bound to (Skill IDE WP 8.2 —
 * `GET /api/skills/:id/versions/:vid/bound-tools`). `serverId`/`serverName` name the RESOLVED
 * binding it came from (every entry is from a resolved binding — unresolved bindings and resolved
 * servers with no completed scan contribute nothing). `definitionTokens` is the tool's definition
 * token cost from its latest completed scan (`mcp_tool_scans.total_tokens` — the serialized provider
 * payload). Additive/read-only; the editor renders it into completion items + a hover popup.
 */
export type BoundTool = {
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  schemaParams: BoundToolParam[];
  definitionTokens: number;
};

// --- Skill IDE WP 8.4 (I9.4) — scaffold a NEW skill from a server's tool surface -------------------
// Start a skill FROM a registered server: the API reads the server's LATEST COMPLETED scan itself
// (persisted reads only — never opens an MCP connection) and composes a spec-valid SKILL.md —
// frontmatter (`name`, a `description` stub or the caller's, `servers: [<server name>]`), an intro,
// then ONE `##` section per selected tool (its scan description's FIRST SENTENCE + a backticked tool
// reference the projector lifts into a `tool_ref`) — creating the skill (v1) through the SAME
// blank-skill create path AND a `skill_server_bindings` row resolved to the source server.

/**
 * Body of `POST /api/skills/scaffold-from-server` (Skill IDE WP 8.4). `serverId` names the source
 * server; `name` is the skill's manifest name/slug (validated server-side against the Agent Skills
 * name rules); `tools` are the selected tool names from the server's latest completed scan (≥1). The
 * client never sends tool descriptions/token costs — the route resolves the server + reads the scan.
 *
 * Server-types WP 3.2 (B) adds ONE additive, strictly-optional field: `bindTypeName`. When omitted
 * (every pre-existing caller), the scaffold binds the source SERVER exactly as before. When set, the
 * source server is used ONLY as the tool-surface (it is the type's D-ST3 representative the client
 * resolved), and the scaffolded skill's frontmatter `servers:` names the TYPE instead — so the new
 * skill binds to the type, not a single box (the resolver maps it to the representative at read time).
 * The route validates it against the registered types (400 unknown), and refuses when the type name is
 * ALSO a registered server name (WP 3.1 precedence would resolve the frontmatter entry to that server,
 * not the type — 400). No persisted binding override is created in this mode; type resolution is left
 * dynamic. Strictly additive: an omitted field keeps every existing scaffold-from-server byte-compatible.
 */
export type ScaffoldFromServerInput = {
  serverId: string;
  name: string;
  displayName?: string;
  description?: string;
  tools: string[];
  bindTypeName?: string;
};

/**
 * Result of a successful scaffold: the created {@link Skill} (v1 already registered) and its resolved
 * {@link SkillServerBinding}[] (the source server, so palette/completion are immediately live).
 */
export type ScaffoldFromServerResult = {
  skill: Skill;
  bindings: SkillServerBinding[];
};

// --- UX overhaul WP 3.5 (G7, D-UX12) — run-plan cost preview ----------------------------------
// The launcher shows an advisory "≈ tokens · $ range" for the current selection (tests ×
// environments × repetitions), served by `GET /api/estimate/run-plan`. Additive, read-only; the
// endpoint reads persisted scan footprints + the server-side pricing tables and computes a rough
// low/mid/high band. It is NOT the run cost — it blocks nothing and is always labeled an estimate.

/** A rough low/mid/high band. `low ≤ mid ≤ high`. Tokens (integers) or USD (fractional) depending on use. */
export type EstimateRange = { low: number; mid: number; high: number };

/** One environment's contribution to a run-plan estimate. */
export type RunPlanEstimateEnvironment = {
  environmentId: string;
  name: string;
  model: string;
  /**
   * Whether the model has a KNOWN price (a real per-token rate OR an explicit free/local entry). When
   * `false` the model is genuinely unpriced — its tokens are still counted, but it is EXCLUDED from the
   * plan `costUsd` range and labeled (see {@link reason}). Never blocks the run.
   */
  priced: boolean;
  /**
   * A short human note when this environment is not fully estimable — e.g. "Unpriced model" or
   * "No scanned server footprint". Absent when the environment estimates cleanly.
   */
  reason?: string;
  /** Σ latest-completed-scan token totals over this environment's allowed servers (tool definitions). */
  footprintTokens: number;
  /** Whether this environment sets a per-run cost cap (`guardrails.maxCostUsd`). Drives the warn rows. */
  hasCostCap: boolean;
  /** Total tokens this environment contributes across its `testCount × repetitions` runs. */
  tokens: EstimateRange;
  /** USD range across this environment's runs. Omitted (undefined) when {@link priced} is `false`. */
  costUsd?: EstimateRange;
};

/** The advisory estimate for a whole run plan (the `GET /api/estimate/run-plan` response). */
export type RunPlanEstimate = {
  testCount: number;
  environmentCount: number;
  repetitions: number;
  /** `testCount × environmentCount × repetitions`. */
  totalRuns: number;
  /** Total tokens across the whole plan — every environment, priced or not. */
  tokens: EstimateRange;
  /** USD across PRICED environments only; unpriced environments are excluded (see {@link unpricedEnvironmentCount}). */
  costUsd: EstimateRange;
  /** How many environments could not be priced (tokens counted, dollars not). */
  unpricedEnvironmentCount: number;
  /** How many environments have NO per-run cost cap — advisory warn rows; blocks nothing. */
  uncappedEnvironmentCount: number;
  environments: RunPlanEstimateEnvironment[];
};

// ==================================================================================================
// Assistant (WP 0.1) — shared contract
// ==================================================================================================
// Embedded Claude agent chat (planning/Roadmap/RM-02-assistant/00-plan.md, decisions D-AS1…D-AS18). This WP
// freezes the wire + persistence contract; the session engine (WP 1.1), in-process MCP toolset
// (WP 1.2), and dock UI (WP 1.3) build on it. Naming (hard rule, D-AS9): the feature is
// "Assistant" everywhere — UI copy must never say "Claude Code" (Anthropic Agent SDK policy).

export type AssistantCredentialKind = (typeof ASSISTANT_CREDENTIAL_KINDS)[number];
export type AssistantAuthSource = (typeof ASSISTANT_AUTH_SOURCES)[number];
export type AssistantThreadStatus = (typeof ASSISTANT_THREAD_STATUSES)[number];
export type AssistantEntityKind = (typeof ASSISTANT_ENTITY_KINDS)[number];
export type AssistantEventType = (typeof ASSISTANT_EVENT_TYPES)[number];
/** Why a `limit_error` fired (WP 3.3) — see {@link ASSISTANT_LIMIT_ERROR_KINDS}'s doc. */
export type AssistantLimitErrorKind = (typeof ASSISTANT_LIMIT_ERROR_KINDS)[number];
/** A TRANSIENT skill-workspace stream-frame's `type` (WP R1.3) — see {@link ASSISTANT_WORKSPACE_FRAME_TYPES}'s doc. */
export type AssistantWorkspaceFrameType = (typeof ASSISTANT_WORKSPACE_FRAME_TYPES)[number];
/** A `workspace_file_changed` frame's change kind (WP R1.3) — see {@link ASSISTANT_WORKSPACE_CHANGE_KINDS}'s doc. */
export type AssistantWorkspaceChangeKind = (typeof ASSISTANT_WORKSPACE_CHANGE_KINDS)[number];

/**
 * `GET /api/assistant/auth/status` (WP 0.2). Never carries the token itself — `signedIn` +
 * `tokenAgeDays` are all the UI needs for status/expiry-warning display; `models` is the roster the
 * SDK/plan reports (populated once WP 1.2 lands; an empty array until then).
 */
export type AssistantAuthStatus = {
  signedIn: boolean;
  tokenCreatedAt?: string;
  tokenAgeDays?: number;
  fallbackConfigured: boolean;
  /** The referenced `provider_credentials` row id (kind `anthropic`), when a fallback is set. */
  fallbackProviderCredentialId?: string;
  models: string[];
};

/**
 * Response of `POST /api/assistant/auth/oauth/start` (WP 0.2). The API spawns `claude setup-token`
 * in a PTY, parses the printed authorization URL, and returns it with a single-flight `flowId`; the
 * owner authorizes in their browser, then posts the code back to `…/oauth/complete` with this
 * `flowId`. Carries NO token — the token is captured server-side and stored encrypted, never returned.
 */
export type AssistantAuthStartResponse = {
  flowId: string;
  authUrl: string;
};

/**
 * `GET /api/assistant/models` (WP 1.2) — the thread model picker's roster. See
 * {@link ASSISTANT_DEFAULT_MODEL_ROSTER}'s doc for why this is a static list rather than a live
 * SDK-reported one.
 */
export type AssistantModelsResponse = {
  models: string[];
};

/**
 * A chat thread (`assistant_threads`). `entityKind`/`entityId` are the OPTIONAL pin set when the
 * thread was opened from a page hook (D-AS15 — "threads pinned to the current entity" in the dock's
 * thread switcher); a thread opened from the global dock carries neither. `sdkSessionId` is the
 * Agent SDK's own session id, persisted so a parked/idle thread can `resume` (D-AS6) — it is never
 * meaningful to the UI beyond "a session exists to resume".
 */
export type AssistantThread = {
  id: string;
  title: string;
  entityKind?: AssistantEntityKind;
  entityId?: string;
  model: string;
  authSource: AssistantAuthSource;
  sdkSessionId?: string;
  status: AssistantThreadStatus;
  /**
   * Per-thread auto-accept toggle (D-AS4) — default OFF. When on, auto-allows create/update writes
   * and workspace file edits; **deletes always ask**, even with auto-accept on.
   */
  autoAccept: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Every user message carries the current route/entity/tab (D-AS7) so "this run" / "this skill"
 * resolves without the user pasting ids — rendered into a structured context block appended to the
 * message (`system-prompt.ts`, WP 1.2). `route` is the app's current URL path (e.g.
 * `/testing/runs/:runId`); `tab` is an optional sub-view within that route.
 */
export type AssistantContextEnvelope = {
  route: string;
  entityKind?: AssistantEntityKind;
  entityId?: string;
  tab?: string;
};

/**
 * The settled, replayable event log persisted to `assistant_events` (append-only, per-thread
 * monotonic `seq` — never renumbered, never mutated). Mirrors `RunEvent`'s discriminated-union +
 * trailing `seq` shape (see `testing/run-manager.ts`). Streaming text deltas are NOT a member of
 * this union — only SETTLED events persist; the SSE stream additionally carries transient delta
 * frames the dock renders live but the repository never stores (00-plan.md §3.1).
 */
export type AssistantEvent = (
  | { type: "user_message"; text: string; envelope?: AssistantContextEnvelope }
  | { type: "assistant_message"; text: string }
  | { type: "tool_call"; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; toolName: string; result: unknown; isError?: boolean }
  | {
      type: "permission_request";
      requestId: string;
      toolName: string;
      input: unknown;
      /** Rendered diff (e.g. a skill-workspace file change) when the write has one to preview. */
      diffPreview?: string;
    }
  | {
      type: "permission_decision";
      requestId: string;
      behavior: "allow" | "deny";
      /** The (possibly owner-edited) input the tool actually ran with, when `behavior` is `allow`. */
      updatedInput?: unknown;
    }
  | {
      type: "ui_action";
      /**
       * One of the D-AS8/D-AS16 `ui.*` tools — `navigate` | `open_run_turn` | `open_skill` |
       * `open_diff` — executed instantly client-side against the addressable-view registry
       * (WP 3.1). A replayed event renders as an inert chip (the navigation already happened).
       */
      action: string;
      params: Record<string, unknown>;
    }
  | {
      type: "limit_error";
      message: string;
      /**
       * Which auth source hit the limit — drives the explicit "retry on API key" action (D-AS14);
       * never a silent fallback.
       */
      source: AssistantAuthSource;
      /**
       * WP 3.3 — `auth` (credential itself failed) vs `rate_limit` (capacity/rate limit); drives
       * whether the dock's banner also hints at re-signing-in. Optional so an event persisted before
       * this field existed still replays (the banner just omits the kind-specific hint for it).
       */
      kind?: AssistantLimitErrorKind;
    }
  | {
      type: "source_switch";
      /** The explicit "retry on the other source" action (D-AS14) — NEVER fired by a normal message. */
      from: AssistantAuthSource;
      to: AssistantAuthSource;
    }
  | { type: "error"; message: string }
  | { type: "turn_done"; turnIndex?: number }
) & {
  /**
   * Per-thread monotonic sequence (`assistant_events.seq`), stamped once at the single emit choke
   * point (the session manager, WP 1.1) before persistence/fan-out — mirrors `RunEvent.seq`.
   * Optional here because a freshly-constructed (not-yet-persisted) event has none yet.
   */
  seq?: number;
  createdAt?: string;
};

/**
 * A freshly-constructed {@link AssistantEvent} BEFORE the session manager stamps its `seq`/`createdAt`
 * (WP 1.1) — the shape a caller hands to `AssistantRepository.appendEvent`. A DISTRIBUTIVE omit over the
 * union: a plain `Omit<AssistantEvent, "seq" | "createdAt">` collapses to `{ type }` (union `keyof` keeps
 * only the shared key), dropping every per-variant field; distributing over each member preserves them.
 */
export type AssistantEventInput = AssistantEvent extends infer T
  ? T extends unknown
    ? Omit<T, "seq" | "createdAt">
    : never
  : never;

/**
 * A transient streaming text delta (WP 1.1). NOT an {@link AssistantEvent} — it is never persisted to
 * `assistant_events` (00-plan.md §3.1: "deltas are ~80% of volume; the repository never stores them").
 * The session manager streams these over SSE so the dock can render assistant prose token-by-token as
 * it arrives; the settled `assistant_message` event (which IS persisted) carries the final text. A
 * delta has no `seq` — it is fire-and-forget and dropped entirely on replay.
 */
export type AssistantStreamDelta = { type: "assistant_delta"; text: string };

/**
 * The three TRANSIENT skill-workspace progress frames (WP R1.3, D-AS22) — see
 * {@link ASSISTANT_WORKSPACE_FRAME_TYPES}'s doc for the full rationale. Like
 * {@link AssistantStreamDelta}, NONE of these carry a `seq` and none are ever persisted or replayed;
 * they exist purely so a live subscriber can watch the skill-workspace edit loop (D-AS13) happen in
 * real time. `workspace_opened` fires once, right after a `skills_open_workspace` tool call
 * materializes a skill's files onto disk; `workspace_file_changed` fires once per SUCCESSFUL native
 * `Edit`/`Write`/`MultiEdit` call whose target file lands inside that materialized tree (a write
 * elsewhere — e.g. the session's scratch cwd — fires nothing); `workspace_committed` fires once a
 * `skills_commit_workspace` call actually mints a new skill version (its `unchanged: true` dedup path
 * fires nothing — there is no new version to announce).
 */
export type AssistantWorkspaceFrame =
  | {
      type: "workspace_opened";
      skillId: string;
      versionId: string;
      /**
       * A SLIM per-file listing — `path` + `size` only, no `isBinary`. This is a live progress
       * notification, not the full listing; the R1.4 Files view fetches the richer
       * {@link AssistantWorkspaceFileNode} shape (which adds `isBinary`) from the live-workspace
       * files GET route on demand.
       */
      files: Array<{ path: string; size: number }>;
    }
  | {
      type: "workspace_file_changed";
      skillId: string;
      /** Posix path relative to the skill's own workspace directory (never absolute — the thread +
       *  skill workspace-root prefix is stripped before this frame is built). */
      path: string;
      changeKind: AssistantWorkspaceChangeKind;
    }
  | { type: "workspace_committed"; skillId: string; versionId: string };

/**
 * One frame on the assistant SSE stream (`GET /api/assistant/threads/:id/stream`, WP 1.1). Either a
 * settled {@link AssistantEvent} (persisted, carries a monotonic `seq` — the durable replay log), a
 * transient {@link AssistantStreamDelta} (rendered live, never persisted, no `seq`), or a transient
 * {@link AssistantWorkspaceFrame} (WP R1.3 — same "live-only, no `seq`" contract as the delta; the
 * dock's conversation reducer ignores these three, they are not conversation state). A reconnecting
 * client replays the persisted `AssistantEvent`s and dedups new live ones by `seq`; delta and
 * workspace frames are live-only. WP 1.3 (the dock) consumes this union.
 */
export type AssistantStreamFrame = AssistantEvent | AssistantStreamDelta | AssistantWorkspaceFrame;

/**
 * One file in a LIVE (on-disk) skill workspace tree — `GET
 * /api/assistant/threads/:id/workspace/:skillId/files` (WP R1.3). Distinct from the transient
 * `workspace_opened` frame's slimmer `{path,size}` shape above: this is the FULL live listing (adds
 * `isBinary`) the R1.4 Files view fetches on demand, not a streamed notification.
 */
export type AssistantWorkspaceFileNode = {
  path: string;
  size: number;
  isBinary: boolean;
};

/** `GET /api/assistant/threads/:id/workspace/:skillId/files` response (WP R1.3) — the live,
 *  possibly-agent-edited tree of one open skill workspace. 400 if that skill has no open workspace
 *  on this thread. */
export type AssistantWorkspaceFilesResponse = {
  skillId: string;
  files: AssistantWorkspaceFileNode[];
};

/**
 * `GET /api/assistant/threads/:id/workspace/:skillId/file?path=…` response (WP R1.3) — one file's
 * content read straight off the live workspace: inline text for a text file, or a binary flag + size
 * (never a download path — unlike the skills registry's persisted {@link SkillFileContent}, this is a
 * live/ephemeral view over an in-progress edit, not a stored, downloadable blob). Secret-free by
 * construction: it only ever reads inside a skill's materialized workspace directory, never app data.
 */
export type AssistantWorkspaceFileContent =
  | { path: string; isBinary: false; text: string }
  | { path: string; isBinary: true; size: number };

/**
 * `GET /api/assistant/threads/:id` (WP 1.1) — a thread plus its full persisted replay log (every settled
 * {@link AssistantEvent}, `seq`-ascending). The dock hydrates a reopened thread from this, then attaches
 * the SSE stream for new frames.
 */
export type AssistantThreadDetail = AssistantThread & { events: AssistantEvent[] };

/**
 * Result of `POST /api/maintenance/prune-assistant` (WP 3.3) — mirrors {@link ScanRetentionResult}'s
 * honesty-first shape (real ids/counts, not just an `ok`). Three independent passes, all reported:
 * day-based thread retention (`retentionDays` — 0 means the day-gated passes below are no-ops),
 * orphaned `ws/`/`threads/` directories for threads no longer in the DB (unconditional GC, not
 * day-gated), and stale SDK session-transcript directories under the app's OWN scoped
 * `CLAUDE_CONFIG_DIR` (day-gated, same window).
 */
export type AssistantPruneResult = {
  retentionDays: number;
  prunedThreadIds: string[];
  removedOrphanWorkspaceDirs: number;
  removedOrphanScratchDirs: number;
  removedStaleSessionDirs: number;
};

/**
 * Result of `POST /api/maintenance/prune-hub` (Assistant Hub, planning/Roadmap/RM-03-assistant-hub/, WP4.3) — mirrors
 * {@link AssistantPruneResult}'s honesty-first shape. Three independent passes, all reported: day-based
 * ROOT-session retention (`retentionDays` — 0 means that pass is a no-op; a root's mission, if any, must
 * ALSO have reached a terminal status — see `hub/retention.ts`), orphaned `hub/ws/<sessionId>/`
 * workspace directories for a session id no longer in the DB (unconditional GC, not day-gated), and a
 * files sweep (also unconditional): `hub_file_links` rows whose polymorphic target no longer exists,
 * then any `hub_files` blob left with zero remaining links.
 */
export type HubPruneResult = {
  retentionDays: number;
  prunedSessionIds: string[];
  removedOrphanWorkspaceDirs: number;
  prunedDanglingFileLinks: number;
  prunedUnlinkedFiles: number;
};

// --- Assistant (WP 0.1) — W3 tool-factory contract (FROZEN for WP 1.1 / WP 1.2) -----------------
// WP 1.1 (session manager) and WP 1.2 (read toolset) are built IN PARALLEL against this interface
// (execution-plan.md wave W3), so it is locked here rather than re-negotiated later. `packages/
// shared` must never import the Agent SDK or any `apps/api` type (architecture.md: shared -> api is
// forbidden), so every capability below is deliberately typed `unknown` — an OPAQUE, documented
// placeholder naming the concrete apps/api repository/service that satisfies it. WP 1.2's real
// `buildAssistantTools` narrows each field to its concrete type LOCALLY (in apps/api) without
// changing this contract.

/**
 * The dependencies an in-process MCP tool factory receives (WP 1.2,
 * `apps/api/src/assistant/tools/index.ts`). One field per capability area named in the plan's §3.2
 * tool inventory; each is an opaque handle to the existing apps/api repository/service of the same
 * name (documented, not imported — see the section banner above). `envelope` is the CURRENT
 * message's context envelope (route/entity/tab), refreshed per message by the session manager.
 */
export interface AssistantToolContext {
  /**
   * The owning thread's id — tools that need to scope a side effect (e.g. a skill workspace path,
   * D-AS13) key off this.
   */
  threadId: string;
  /** The envelope of the message currently being answered (see {@link AssistantContextEnvelope}). */
  envelope?: AssistantContextEnvelope;
  /** `apps/api/src/testing/run-repository.ts` (`RunRepository`) — `runs_get/list/search`. */
  runs: unknown;
  /**
   * `apps/api/src/suites/*` + `apps/api/src/grading/grade-repository.ts` — `suite_runs_get/list`
   * plus their grades.
   */
  suiteRuns: unknown;
  /**
   * `apps/api/src/skills/repository.ts` (`SkillRepository`) — `skills_get/versions/files/diff`,
   * and (Phase 2, D-AS13) the materialized-workspace open/commit tools.
   */
  skills: unknown;
  /** `apps/api/src/scans/repository.ts` — `scans_get/list/tools`. */
  scans: unknown;
  /**
   * `apps/api/src/servers/repository.ts` — `servers_list`. REDACTED configs only — reuses the
   * existing `hasEnvSecrets`/`hasHeaderSecrets` redaction; no secret value ever reaches the agent.
   */
  servers: unknown;
  /** `apps/api/src/compare/*` — `compare_run`. */
  compare: unknown;
  /** `apps/api/src/compatibility/*` — `compatibility_heatmap`. */
  compatibility: unknown;
  /** `apps/api/src/testing/test-repository.ts` — `tests_list/get` (+ Phase 2 create/update). */
  tests: unknown;
  /**
   * `apps/api/src/testing/scenario-repository.ts` — `environments_list/get` (wire entity kind
   * `scenario` — see {@link ASSISTANT_ENTITY_KINDS}).
   */
  environments: unknown;
  /** `apps/api/src/collections/*` — `collections_list/get` (+ Phase 2 write tools). */
  collections: unknown;
  /** `apps/api/src/reports/*` (`createRunMarkdownReport`) — the cheap single-call run-context tool. */
  reports: unknown;
}

/**
 * Opaque placeholder for the Agent SDK's `createSdkMcpServer(...)` return value. `packages/shared`
 * cannot import `@anthropic-ai/claude-agent-sdk` (an apps/api-only runtime dep, added in WP 0.3), so
 * this is documented rather than concrete — WP 1.2's real factory returns
 * `ReturnType<typeof createSdkMcpServer>` and narrows this alias locally, in apps/api.
 */
export type AssistantMcpServer = unknown;

/**
 * The FROZEN factory signature `apps/api/src/assistant/tools/index.ts` implements at WP 1.2, and
 * that WP 1.1's session manager calls (with an empty/stub toolset until WP 1.2 merges — see
 * execution-plan.md wave W3) to build the `mcpServers` option passed to the SDK's `query()`.
 */
export type BuildAssistantTools = (deps: AssistantToolContext) => AssistantMcpServer;

// --- Rating Issues registry (Auto-Rating follow-on) ----------------------------------------------
// Formalizes the `error_forensics` findings (see {@link ErrorFinding}) into DISTINCT, deduplicated,
// PERSISTENT issues against the skills and MCP servers a run used, with occurrences linking every
// contributing run. Created/enhanced after every run rating by the CLI-first judge chain (dedup is
// one schema-constrained judge call per finding-target pair; a deterministic (bucket, fixTarget)
// match is the no-judge fallback). Lifecycle: open → resolved, with AUTOMATIC re-open when a
// resolved issue is seen again. Everything here is additive.

/** What a rating issue is filed against (mirrors `RATING_ISSUE_TARGET_KINDS` — the actionable `FIX_TARGETS`). */
export type RatingIssueTargetKind = "skill" | "mcp_server";

/** Issue lifecycle (mirrors `RATING_ISSUE_STATUSES`) — a resolved issue seen again re-opens automatically. */
export type RatingIssueStatus = "open" | "resolved";

/** Judge-assigned severity (mirrors `RATING_ISSUE_SEVERITIES`); an enhance only ever raises it (max wins). */
export type RatingIssueSeverity = "low" | "medium" | "high";

/**
 * The category one {@link RatingIssueOccurrence} was filed under (mirrors
 * `RATING_ISSUE_OCCURRENCE_CATEGORIES`): every {@link ErrorFindingCategory} (auto-rating provenance)
 * plus `manual` — an occurrence the owner filed by hand via the Assistant's `rating_issue_file` tool.
 */
export type RatingIssueOccurrenceCategory = (typeof RATING_ISSUE_OCCURRENCE_CATEGORIES)[number];

/**
 * One contributing run of a {@link RatingIssue}. `runId`/`suiteRunId` are DENORMALIZED references
 * (not FKs) so the issue history survives run deletion; `message` is a bounded excerpt of the
 * finding's description as seen in THAT run. Reprocessing a run never duplicates an occurrence
 * (unique per issue + run + finding digest).
 */
export type RatingIssueOccurrence = {
  runId: string;
  suiteRunId?: string;
  category: RatingIssueOccurrenceCategory;
  /** Bounded excerpt of the contributing finding's description. */
  message: string;
  /**
   * Concrete failure evidence for THIS sighting, carried through from the contributing
   * {@link ErrorFinding} (see its fields): the tool whose call failed, a bounded/redacted excerpt of
   * the arguments actually sent, and the exact error text returned — so an occurrence shows the real
   * wrong call, not just a category. All optional (older occurrences / non-tool categories lack them).
   */
  toolName?: string;
  sentArguments?: string;
  errorMessage?: string;
  createdAt: string;
};

/**
 * One DISTINCT, persistent issue against a skill or MCP server — the deduplicated roll-up of every
 * `error_forensics` finding that described the same underlying problem on the same target.
 * `targetName` is denormalized so display/export survive the target's later deletion;
 * `skillVersionId` pins the version the issue was FIRST seen on (skill targets only). Judge
 * provenance (`judgeProviderId`/`judgeModel`) stamps the source that last shaped
 * title/summary/draftFix — null when only the deterministic fallback ever touched it.
 */
export type RatingIssue = {
  id: string;
  targetKind: RatingIssueTargetKind;
  targetId: string;
  /** Denormalized display name (skill name / server name) — survives target deletion. */
  targetName: string;
  /** The skill version the issue was first seen on (skill targets only). */
  skillVersionId?: string;
  title: string;
  summary: string;
  bucket: RootCauseBucket;
  fixTarget: FixTarget;
  /** A concrete, labeled fix suggestion — never auto-applied. */
  draftFix: string;
  severity: RatingIssueSeverity;
  status: RatingIssueStatus;
  /** How many times this underlying problem was observed (across all contributing runs). */
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Stamped when resolved; cleared on (automatic or manual) re-open. */
  resolvedAt?: string;
  /** The `AUTO_RATING_VERSION` the issue was created under. */
  ratingVersion: number;
  judgeProviderId: string | null;
  judgeModel: string | null;
  /** Contributing runs, oldest first. */
  occurrences: RatingIssueOccurrence[];
  /**
   * Fleet aggregation (Observability WP5.1, D-OB20) — PRESENT only on a FLEET issue (a deterministically
   * clustered recurring failure produced by the sweep); ABSENT on an ordinary per-run auto-rating issue.
   * All fields are DERIVED caches recomputable from runs + grades (see `POST /api/issues/rebuild`).
   */
  fleet?: RatingIssueFleet;
};

// --- Fleet issue aggregation (Observability WP5.1, D-OB20) -------------------------------------
// The fleet dimension of a rating issue: the deterministic cluster identity + its derived
// aggregates + the open/resolved/regressed lifecycle. See constants.ts for the vocabulary and
// `issue-clustering.ts` (API) for the cluster-key builder + error normalizer.

/** A fleet issue's lifecycle (mirrors `RATING_ISSUE_LIFECYCLES`) — a resolved cluster reappearing auto-`regressed`s. */
export type RatingIssueLifecycle = (typeof RATING_ISSUE_LIFECYCLES)[number];

/**
 * The distinct entities a recurring fleet issue spans, aggregated (deduplicated, sorted) across every
 * contributing run. A DERIVED cache — recomputable from the contributing runs. `servers`/`skills`
 * carry ids; `tests` the run test ids; `models` the scenario models.
 */
export type RatingIssueAffected = {
  servers: string[];
  skills: string[];
  tests: string[];
  models: string[];
};

/** One day's failure count for a fleet issue's sparkline. `day` is a UTC `YYYY-MM-DD`; DERIVED, sorted ascending. */
export type RatingIssueTrendPoint = {
  day: string;
  count: number;
};

/**
 * The additive fleet block on a {@link RatingIssue}. `clusterKey`/`clusterKeyVersion` are the stable
 * deterministic identity (a key-version bump never merges old + new history); `lifecycle` is the
 * operator-facing state (auto-`regressed` on reappearance of a resolved cluster); `occurrenceCount`
 * (the distinct contributing runs), `firstSeenAt`/`lastSeenAt`, `affected`, and `trend` are DERIVED
 * caches restored byte-identically by `POST /api/issues/rebuild`. `resolutionNote`/`resolvedAt` carry
 * the operator's disposition (not derived).
 */
export type RatingIssueFleet = {
  clusterKey: string;
  clusterKeyVersion: number;
  lifecycle: RatingIssueLifecycle;
  /** Distinct contributing runs (one occurrence per (cluster, run) — a derived count). */
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  affected: RatingIssueAffected;
  trend: RatingIssueTrendPoint[];
  /** Operator disposition when resolved/ignored (not derived). */
  resolutionNote?: string;
  /** Stamped when resolved/ignored; cleared on (auto or manual) reopen (not derived). */
  resolvedAt?: string;
};

/**
 * The result of one `POST /api/issues/sweep` (or a scheduled sweep tick): how much history it folded
 * and which fleet issues it opened / regressed. `sweptThrough` is the new watermark (the window's
 * upper bound). Fully idempotent — a re-sweep of the same window reports 0 added / 0 regressed.
 */
export type IssueSweepResult = {
  runsScanned: number;
  occurrencesAdded: number;
  issuesOpened: number;
  issuesRegressed: number;
  sweptThrough: string;
};

/**
 * The result of `POST /api/issues/rebuild` — the derived-once PROOF: every fleet issue + occurrence is
 * dropped and re-swept from ALL terminal runs, reproducing byte-identical derived caches.
 */
export type IssueRebuildResult = {
  issueCount: number;
  occurrenceCount: number;
  runsScanned: number;
};

// ── Scheduled digest report (Observability WP5.5, D-OB22) ──────────────────────────────────────────
// The "since your last visit" briefing, persisted + scheduled: a window-over-window comparison built
// ENTIRELY from the WP1.2 metrics services (`computeRunMetrics`/`computeScanMetrics`) + the WP5.1
// issues registry — the composer only ARRANGES already-derived numbers (DERIVED-ONCE; see
// `apps/api/src/reports/digest.ts`). Persisted as `digest_reports` (migration v43); rendered as JSON
// (this shape) + Markdown (`digest-markdown.ts`), mirroring the `server`/`run`/`suite-run` report
// family's `GET …/{json,markdown}` route shape.

export type DigestWindowKind = (typeof DIGEST_WINDOW_KINDS)[number];
/** The persisted schedule's mode: `off`, or one of {@link DigestWindowKind}. */
export type DigestScheduleMode = (typeof DIGEST_SCHEDULE_MODES)[number];

/** `GET`/`PUT /api/reports/digest/schedule` — off | daily | weekly, + the UTC hour a completed window
 *  becomes due at (the window boundaries themselves are calendar-aligned, independent of this hour —
 *  see the composer doc). */
export type DigestSchedule = {
  mode: DigestScheduleMode;
  hourUtc: number;
};

/** A single derived figure shown current-vs-previous — EVERY field here is read (or summed) directly
 *  from a metrics-service response; the composer never recomputes one from raw rows. */
export type DigestMetricDelta = {
  current: number;
  previous: number;
  delta: number;
};

/** Headline counts — runs, error-rate Δ, and cost Δ split by {@link SessionCostBasis} (NEVER blended
 *  across capability classes, mirroring D-OB14). `errorRate` is `null` only when NEITHER window had
 *  any run (an honest empty, never a fabricated 0%). */
export type DigestHeadline = {
  runs: DigestMetricDelta;
  errorRate: DigestMetricDelta | null;
  costByBasis: Partial<Record<SessionCostBasis, DigestMetricDelta>>;
};

/** One issue reference in the digest's new/regressed/resolved lists — a fleet issue (WP5.1) whose
 *  first-seen/last-seen/resolved timestamp fell inside this window. `linkPath` deep-links to the
 *  issue's fleet detail view. */
export type DigestIssueRef = {
  id: string;
  title: string;
  severity: RatingIssueSeverity;
  targetKind: RatingIssueTargetKind;
  targetName: string;
  linkPath: string;
};

/** The dimension a {@link DigestMover} swung on — mirrors the `RUN_METRICS_GROUP_BY` values the
 *  composer actually groups by for this report (a deliberate subset — server/model/suite are the
 *  operationally actionable ones for a briefing). */
export type DigestMoverDimension = "server" | "model" | "suite";

/** One entity (server/model/suite) with the biggest error-rate or cost swing between the two windows.
 *  `label` is a display name when resolvable (server), else the raw key (model string / suite id). */
export type DigestMover = {
  dimension: DigestMoverDimension;
  key: string;
  label: string;
  errorRate: DigestMetricDelta | null;
  costUsd: DigestMetricDelta;
};

export type DigestNotableRunReason = "top_cost" | "guardrail_stop";

/** One run worth calling out — the window's costliest run(s) and/or a guardrail stop. Carries only
 *  denormalized ids (mirrors the notification sink's own `Test ${testId}` convention) — the digest
 *  composer adds no extra name-resolution dependency beyond what it already has. */
export type DigestNotableRun = {
  runId: string;
  testId: string;
  scenarioId: string;
  costUsd: number;
  stopReasonCode: string | null;
  reason: DigestNotableRunReason;
  linkPath: string;
};

/** One server/profile scan-footprint mover — read straight off `computeScanMetrics`'s own
 *  bucket-over-bucket delta (`deltaTotalTokens`/`deltaComparable`); the composer never re-derives it. */
export type DigestScanMover = {
  serverId: string;
  serverName: string | null;
  tokenProfile: string;
  totalTokens: number | null;
  deltaTotalTokens: number | null;
  deltaComparable: boolean;
};

/**
 * One persisted digest report (`digest_reports`, migration v43). `late` marks a scheduler
 * boot-catch-up generation (the window completed while the app was away, mirroring the windowed
 * watch-rule `late` flag, D-OB19) — never set on a manual `POST /api/reports/digest/generate`.
 */
export type DigestReport = {
  id: string;
  windowKind: DigestWindowKind;
  windowFrom: string;
  windowTo: string;
  prevWindowFrom: string;
  prevWindowTo: string;
  generatedAt: string;
  late: boolean;
  headline: DigestHeadline;
  newIssues: DigestIssueRef[];
  regressedIssues: DigestIssueRef[];
  resolvedIssues: DigestIssueRef[];
  movers: DigestMover[];
  notableRuns: DigestNotableRun[];
  scanMovers: DigestScanMover[];
};

/** `POST /api/reports/digest/generate?window=daily|weekly` response — just enough to route to the
 *  full report (`GET /api/reports/digest/:id/json`) without re-shipping the whole payload twice. */
export type DigestGenerateResult = {
  id: string;
  windowKind: DigestWindowKind;
  late: boolean;
};

/** `POST /api/maintenance/prune-digests` result — mirrors {@link NotificationPruneResult}'s
 *  honesty-first shape (real ids, not just an `ok`). */
export type DigestPruneResult = {
  retentionDays: number;
  prunedDigestIds: string[];
};

// ── LLM assist for issue clustering (Observability WP5.2, D-OB20, OPT-IN) ──────────────────────────
// The OPT-IN LLM overlay over the deterministic fleet clusters (WP5.1). Everything here is ADDITIVE
// and lives in an `app_settings` JSON document (a planned non-migration); the deterministic
// `rating_issues` rows are NEVER mutated by the assist pass. See constants.ts for the vocabulary +
// storage key and `issue-assist.ts` (API) for the schema-constrained judge pass + reversible merge.

/** The priority the assist SUGGESTS for a merge group ({@link ISSUE_ASSIST_PRIORITIES}). Never auto-applied. */
export type IssueAssistPriority = (typeof ISSUE_ASSIST_PRIORITIES)[number];

/**
 * One APPLIED assist merge group — the reversible overlay the opt-in LLM pass produced for a set of
 * near-duplicate fleet issues. `issueIds` are the members (≥1); `primaryIssueId` is the one surfaced
 * (the others are merged UNDER it). `title`/`summary`/`suggestedPriority`/`rationale` are AI-written
 * and MARKED (`aiAssisted:true`, `model`, `assistedAt`); the deterministic per-issue fallback text is
 * ALWAYS retained on each underlying row. `suggestedPriority` is SURFACED only — the issue rows'
 * `severity` is untouched. An unmerge drops the group and restores the originals (which were never
 * changed). A single-member group is a pure AI re-titling (no merge); a ≥2-member group is a merge.
 */
export type IssueAssistGroup = {
  id: string;
  issueIds: string[];
  primaryIssueId: string;
  title: string;
  summary: string;
  suggestedPriority: IssueAssistPriority;
  rationale: string;
  aiAssisted: true;
  /** The judge model that authored this group (chain-actual provenance — `claude_cli` reads its model). */
  model: string | null;
  assistedAt: string;
};

/**
 * The SEPARATE assist judge-cost ledger (B5 discipline) — assist LLM cost is kept apart from run cost
 * AND from grade cost. A running total across every applied assist call, surfaced in issue settings.
 * A CLI (subscription) call records real tokens at cost 0 (AR13); a provider call records its estimate.
 */
export type IssueAssistLedger = {
  /** How many successful assist judge calls have been recorded. */
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** The source + ISO timestamp of the most recent recorded call (null until the first). */
  lastProviderId: string | null;
  lastModel: string | null;
  lastAt: string | null;
};

/** The persisted assist overlay: the applied merge groups + the separate cost ledger. */
export type IssueAssistState = {
  groups: IssueAssistGroup[];
  ledger: IssueAssistLedger;
};

/**
 * The result of a refine call (`POST /api/issues/assist/refine` or `/api/issues/:id/assist/refine`).
 * `ran` is false when the pass was SKIPPED (assist off, no judge resolvable, an unpriced provider
 * model, no open fleet issues, a judge failure, or a malformed/zod-invalid response) — `skipReason`
 * names which, and NOTHING is mutated (safe degradation). When `ran` is true, `applied` are the merge
 * groups written this call and `cost` is the ledger delta this call recorded (0/absent on the CLI path).
 */
export type IssueAssistResult = {
  ran: boolean;
  skipReason?: string;
  /** The merge groups applied by THIS call (empty when the judge proposed no valid group). */
  applied: IssueAssistGroup[];
  /** This call's judge-cost delta (null when nothing was spent / recorded). */
  cost: {
    judgeProviderId: string | null;
    judgeModel: string | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  } | null;
};

/** The response of `POST /api/issues/assist/:groupId/unmerge` — the dropped group + the restored issue ids. */
export type IssueAssistUnmergeResult = {
  removed: IssueAssistGroup;
  restoredIssueIds: string[];
};

// ── Observability — metrics endpoints (planning/Roadmap/RM-17-observability/, WP1.2, D-OB13/D-OB14) ──────────────
// The time-bucketed, group-able aggregate contract over runs + scans, computed ON DEMAND (no rollup
// cache — every number recomputable from persisted rows; repeated calls identical). The query vocabulary
// (buckets / groupBy / measures) is pinned in constants.ts; the query zod lives in schemas.ts.

/** Time-bucket granularity for a metrics series ({@link METRICS_BUCKETS}). Floored in UTC. */
export type MetricsBucket = (typeof METRICS_BUCKETS)[number];

/** A `GET /api/metrics/runs?groupBy=` dimension ({@link RUN_METRICS_GROUP_BY}). */
export type RunMetricsGroupBy = (typeof RUN_METRICS_GROUP_BY)[number];

/** A `GET /api/metrics/runs?measures=` measure ({@link RUN_METRICS_MEASURES}). */
export type RunMetricsMeasure = (typeof RUN_METRICS_MEASURES)[number];

/** One bucket's aggregate value for a run-metrics series. Empty buckets are OMITTED (never zero-filled). */
export type RunMetricsPoint = {
  /** ISO-8601 UTC bucket START (`hour`/`day`/`week` floor). */
  bucketStart: string;
  /** The measure's value for this bucket + group (+ capability class, for split measures). */
  value: number;
  /** How many runs backed this value. For `server`/`skill` groupBy a run is counted once per membership. */
  n: number;
};

/**
 * One measure's series for one group (and, for a capability-split token/cost measure, one capability
 * class). D-OB14: token/cost measures return ONE series PER class — the aggregation NEVER blends classes.
 */
export type RunMetricsSeries = {
  measure: RunMetricsMeasure;
  /** The group-key value (a model/provider/server/… id), or `null` when the query is ungrouped. */
  group: string | null;
  /**
   * The capability class this series is labelled with — the `tokens` class (`exact`/`estimated`/`none`)
   * for `tokensIn`/`tokensOut`, the `costBasis` class (`api_exact`/`subscription_reference`/`questions`/
   * `none`) for `costUsd`, `questions` for the `questions` measure. `null` for a non-split measure.
   */
  capabilityClass: string | null;
  /**
   * `p50DurationMs`/`p95DurationMs` only — `true` when AT LEAST ONE run in the series had no
   * `activeDurationMs` and its `totalDurationMs` was used instead (D-US3 fallback, MARKED per WP1.2).
   */
  durationFallback?: boolean;
  /** Non-empty buckets only, ascending by `bucketStart`. */
  points: RunMetricsPoint[];
};

/** `GET /api/metrics/runs` response. */
export type RunMetricsResponse = {
  bucket: MetricsBucket;
  timezone: typeof METRICS_TIMEZONE;
  /** The echoed window bounds (ISO-8601), or `null` when unbounded on that side. */
  from: string | null;
  to: string | null;
  groupBy: RunMetricsGroupBy | null;
  /** The echoed requested measures. */
  measures: RunMetricsMeasure[];
  /**
   * Requested measures with no backing computation yet (currently only `feedbackRate`) — the
   * `run_feedback` table itself exists as of WP1.5, but this measure isn't wired into the metrics
   * aggregation yet.
   */
  unavailableMeasures: RunMetricsMeasure[];
  series: RunMetricsSeries[];
};

/** One bucket's per-server footprint snapshot for `GET /api/metrics/scans`. */
export type ScanMetricsPoint = {
  /** ISO-8601 UTC bucket START. */
  bucketStart: string;
  /** Scans of this server+profile started in this bucket (any status). */
  scanCount: number;
  /** failed / (success + failed) within the bucket; 0 when no scan reached a terminal state. */
  failureRate: number;
  /** `counting_version` of the representative (latest SUCCESS) scan; `null` when the bucket had none. */
  countingVersion: number | null;
  /** Whole-surface tokens (tools + resources + prompts) of the representative scan; `null` if none. */
  totalTokens: number | null;
  /** Token splits of the representative scan (`null` when the bucket had no success scan). */
  toolTokens: number | null;
  resourceTokens: number | null;
  promptTokens: number | null;
  totalTools: number | null;
  totalResources: number | null;
  totalResourceTemplates: number | null;
  totalPrompts: number | null;
  /** Δ `totalTokens` vs the previous point; `null` when not comparable (see `deltaComparable`). */
  deltaTotalTokens: number | null;
  /**
   * `false` when the delta is not comparable: the first point, either point lacked a success scan, or
   * the two points' `countingVersion` differ (scans under different counting methods are never silently
   * compared — CLAUDE.md §7 / the `counting_version` guard).
   */
  deltaComparable: boolean;
};

/** One server's (per token profile) scan-footprint time series. */
export type ScanMetricsSeries = {
  serverId: string;
  serverName: string | null;
  tokenProfile: string;
  /** Non-empty buckets only, ascending by `bucketStart`. */
  points: ScanMetricsPoint[];
};

/** `GET /api/metrics/scans` response. */
export type ScanMetricsResponse = {
  bucket: MetricsBucket;
  timezone: typeof METRICS_TIMEZONE;
  from: string | null;
  to: string | null;
  servers: ScanMetricsSeries[];
};

// ── Observability — custom chart composer (planning/Roadmap/RM-17-observability/, WP2.7, D-OB22) ─────────────────
// A user-defined chart on the Testing dashboard: measure(s) [same-unit only] + filter/groupBy/bucket
// + chart type, persisted + cloneable (`GET/POST /api/dashboard-charts`, `GET/PATCH/DELETE
// /api/dashboard-charts/:id`, `POST /api/dashboard-charts/:id/clone`, `POST
// /api/dashboard-charts/reorder`). The composer renders ONLY what `/api/metrics/*` already returns —
// this is NOT a second aggregation path (no client-side aggregation; D-OB14's capability-class split
// is enforced by the metrics service regardless of chart config).

export type DashboardChartType = (typeof DASHBOARD_CHART_TYPES)[number];
export type DashboardChartSource = (typeof DASHBOARD_CHART_SOURCES)[number];
/** The `source: "scans"` measure vocabulary — a subset of {@link ScanMetricsPoint}'s own fields. */
export type DashboardChartScanMeasure = (typeof DASHBOARD_CHART_SCAN_MEASURES)[number];

/** A `source: "runs"` chart queries `GET /api/metrics/runs` UNMODIFIED — the SAME filter/groupBy/
 *  bucket/measures vocabulary the WP1.2 service and the WP2.2 prebuilt panels already use. */
export type DashboardChartRunsConfig = {
  source: "runs";
  /** Same-unit constraint enforced by the shared zod on write (see {@link RUN_METRICS_MEASURE_UNITS}). */
  measures: RunMetricsMeasure[];
  filter: RunFilter;
  groupBy?: RunMetricsGroupBy;
  bucket: MetricsBucket;
  chartType: DashboardChartType;
};

/** A `source: "scans"` chart queries `GET /api/metrics/scans` UNMODIFIED — `computeScanMetrics` is
 *  already grouped by (server, tokenProfile); the only extra scope is an optional single `serverId`. */
export type DashboardChartScansConfig = {
  source: "scans";
  measures: DashboardChartScanMeasure[];
  serverId?: string;
  bucket: MetricsBucket;
  chartType: DashboardChartType;
};

export type DashboardChartConfig = DashboardChartRunsConfig | DashboardChartScansConfig;

/** One persisted custom chart (`dashboard_charts`, migration v45). */
export type DashboardChart = {
  id: string;
  name: string;
  config: DashboardChartConfig;
  /** Display order among the operator's custom panels — a dense 0..N-1 sequence, renumbered after
   *  every create/delete and rewritten wholesale by `POST /api/dashboard-charts/reorder`. */
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type DashboardChartInput = {
  name: string;
  config: DashboardChartConfig;
};

/** A real partial update — every field optional; an omitted field keeps its stored value. Never
 *  carries `position` (use {@link DashboardChartReorderInput}). */
export type DashboardChartPatch = {
  name?: string;
  config?: DashboardChartConfig;
};

/**
 * `POST /api/dashboard-charts/reorder` body — the FULL current chart id set, in the desired display
 * order. A missing, foreign, or duplicate id is a 400 (never a silent partial reorder).
 */
export type DashboardChartReorderInput = {
  orderedIds: string[];
};

// ── Review queue lite (planning/Roadmap/RM-17-observability/, WP4.5, D-OB22) ────────────────────────────────────
// Structured human review WITHOUT multi-annotator/reservation machinery (single owner): a persisted,
// named RUBRIC — a checklist of keys, each `thumbs`/`scale5`/`note` — walked keyboard-first over a
// filtered set of runs (`GET/POST /api/review-rubrics`, `PATCH/DELETE /api/review-rubrics/:id`). A
// "review session" itself is EPHEMERAL — a source RunFilter + a picked rubric, chosen at review time
// in the web UI — and is NEVER persisted as its own entity; only the rubric is. Every verdict a
// reviewer records is written through the EXISTING WP1.5 `run_feedback` API (`POST
// /api/runs/:id/feedback`, source `'human'`, `key` = the rubric key's own name) — this type carries NO
// feedback data of its own, and a run counts "reviewed" only once EVERY rubric key has a
// `run_feedback` row (derived client-side from {@link RunSummary.feedback}, never persisted).

export type ReviewRubricKeyKind = (typeof REVIEW_RUBRIC_KEY_KINDS)[number];

/** One question on a rubric — becomes one `run_feedback` row (keyed by `key`) per reviewed run. */
export type ReviewRubricKeyDef = {
  /** Free-form; becomes the `run_feedback.key` a reviewer's answer is written under. Unique within
   *  the rubric (case-insensitive), enforced at write time. */
  key: string;
  description?: string;
  kind: ReviewRubricKeyKind;
};

/** One persisted rubric (`review_rubrics`, migration v46). */
export type ReviewRubric = {
  id: string;
  /** Unique (case-insensitive), enforced at create/update time — a duplicate name is a 409. */
  name: string;
  instructions?: string;
  /** At least one key; capped at {@link REVIEW_RUBRIC_MAX_KEYS} — a rubric is a checklist, not a form
   *  builder. Key names are unique within the rubric (case-insensitive). */
  keys: ReviewRubricKeyDef[];
  createdAt: string;
  updatedAt: string;
};

export type ReviewRubricInput = {
  name: string;
  instructions?: string;
  keys: ReviewRubricKeyDef[];
};

/** A real partial update — every field optional; an omitted field keeps its stored value. Supplying
 *  `keys` REPLACES the whole array (not a per-key merge) — mirrors how `DashboardChartPatch.config`
 *  replaces its whole config rather than deep-merging. */
export type ReviewRubricPatch = {
  name?: string;
  instructions?: string;
  keys?: ReviewRubricKeyDef[];
};

// ==================================================================================================
// Assistant Hub — shared contract (planning/Roadmap/RM-03-assistant-hub/, WP0.1, D-AH1…20)
// The full-page, multi-model, multi-agent Assistant. ADDITIVE ONLY: nothing above changes. The SESSION
// LIFECYCLE is REUSED verbatim from Unified Sessions (D-AH3 / §1.2): a hub session's `status` is a
// {@link RunStatus}, its `phase` a {@link RunPhase}, its terminal reason a {@link StopReasonCode}, its
// capability manifest a {@link SessionCapabilities}, its `phase` detail reuses {@link WaitingInputReason},
// and its cost basis a {@link SessionCostBasis} — never forked here. `hub_events` is APPEND-ONLY: a
// session's full state is reconstructible from its event log alone (R-SES1 / AG-UI rule).
// ==================================================================================================

// --- Enum-derived unions (mirror the HUB_* constants) ---------------------------------------------
export type HubSessionMode = (typeof HUB_SESSION_MODES)[number];
export type HubSessionKind = (typeof HUB_SESSION_KINDS)[number];
export type HubTopology = (typeof HUB_TOPOLOGIES)[number];
export type HubAutonomyLevel = (typeof HUB_AUTONOMY_LEVELS)[number];
export type HubTitleState = (typeof HUB_TITLE_STATES)[number];
export type HubEventType = (typeof HUB_EVENT_TYPES)[number];
/** WP4.2 (D-AH13) — the audit timeline's coarse kind taxonomy (see {@link HUB_AUDIT_KINDS}). */
export type HubAuditKind = (typeof HUB_AUDIT_KINDS)[number];
export type HubToolPartState = (typeof HUB_TOOL_PART_STATES)[number];
export type HubToolSource = (typeof HUB_TOOL_SOURCES)[number];
export type HubApprovalOptionKind = (typeof HUB_APPROVAL_OPTION_KINDS)[number];
export type HubApprovalResolution = (typeof HUB_APPROVAL_RESOLUTIONS)[number];
export type HubTaskStatus = (typeof HUB_TASK_STATUSES)[number];
export type HubMessagePartType = (typeof HUB_MESSAGE_PART_TYPES)[number];
export type HubActorKind = (typeof HUB_ACTOR_KINDS)[number];
export type HubMissionStatus = (typeof HUB_MISSION_STATUSES)[number];
export type HubConfidence = (typeof HUB_CONFIDENCE_LEVELS)[number];
export type HubArtifactKind = (typeof HUB_ARTIFACT_KINDS)[number];
export type HubArtifactExportFormat = (typeof HUB_ARTIFACT_EXPORT_FORMATS)[number];
export type HubReviewStatus = (typeof HUB_REVIEW_STATUSES)[number];
export type HubReviewCommentDecision = (typeof HUB_REVIEW_COMMENT_DECISIONS)[number];
export type HubFileLinkRole = (typeof HUB_FILE_LINK_ROLES)[number];
export type HubFileLinkTarget = (typeof HUB_FILE_LINK_TARGETS)[number];
export type HubWorkspaceChangeKind = (typeof HUB_WORKSPACE_CHANGE_KINDS)[number];
export type HubMemoryKind = (typeof HUB_MEMORY_KINDS)[number];
export type HubMemorySource = (typeof HUB_MEMORY_SOURCES)[number];
export type HubMemoryStatus = (typeof HUB_MEMORY_STATUSES)[number];
export type HubLimitRetrySource = (typeof HUB_LIMIT_RETRY_SOURCES)[number];
export type HubElicitationAction = (typeof HUB_ELICITATION_ACTIONS)[number];
export type HubElicitationMode = (typeof HUB_ELICITATION_MODES)[number];
// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP0.1) — additive closed unions (D-HUX8/10/11/16).
/** A memory entry's SCOPE (D-HUX11): `profile` (global) · `project` · `agent` · `crew` — most-specific
 *  wins at injection. An un-scoped legacy row reads as `profile` (WP1.5 migration). */
export type HubMemoryScope = (typeof HUB_MEMORY_SCOPES)[number];
/** A saved crew's optional accent — one of the five theme-aware chart tokens (`--chart-1…5`), never a
 *  raw color (D-HUX8). Rendered only as small name-paired accents, never a fill or text color. */
export type HubCrewColor = (typeof HUB_CREW_COLORS)[number];
/** The dimension the workforce Usage tab groups spend/tokens by (D-HUX10). */
export type HubUsageGroupBy = (typeof HUB_USAGE_GROUP_BYS)[number];

// --- Shared value shapes --------------------------------------------------------------------------

/** Token/context accounting on a settled message or turn. `contextTokens` = the window snapshot after
 *  the turn; the cache/reasoning facets are additive and provider-dependent. */
export type HubUsage = {
  tokensIn: number;
  tokensOut: number;
  contextTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** hub-fixes WP5.1 (RC5, D-HF2) — how many provider-native `web.search` calls the model made this
   *  turn (provider-executed, so NOT counted against `maxToolCalls`). Surfaced as "web searches: N" in
   *  usage views; the provider bills these separately and the API reports no per-search token/cost, so
   *  this is a truthful COUNT, never a fabricated dollar figure. Absent/0 ⇒ no web searches. */
  webSearches?: number;
};

/**
 * A numbered source (§1.7 / D-AH10). ANY tool result carrying sources becomes numbered inline citations
 * (`[n]`) with a per-message + per-session Sources panel. `title` is required (a source always has a
 * label); the refs tie a citation back to its origin so it survives agent reports + synthesis
 * (`agentRef`) and resolves against a tool call (`toolCallRef`) or an attached file (`fileRef`).
 */
export type HubCitation = {
  id: string;
  title: string;
  url?: string;
  snippet?: string;
  toolCallRef?: string;
  agentRef?: string;
  fileRef?: string;
};

/** Per-role / per-agent HARD-CAP budgets (D-AH9 — enforced server-side regardless of the autonomy dial). */
export type HubBudgets = {
  maxTurns?: number;
  maxTokens?: number;
  maxToolCalls?: number;
  maxCostUsd?: number;
  maxDurationMs?: number;
};

/** Mission-level hard caps (D-AH9): fan-out width, parallelism, total spend, and a per-agent default. */
export type HubMissionBudgets = {
  maxAgents?: number;
  maxParallel?: number;
  maxCostUsd?: number;
  perAgent?: HubBudgets;
};

/** A server's grant: `"all"` its granted tools, or an explicit tool-name allowlist (D-AH7 / R-MCP1). */
export type HubServerToolGrant = "all" | string[];

/**
 * Tool grants for a role or session (D-AH7): per registered MCP server → `all` | tool-name allowlist,
 * plus the in-process hub `builtins` the role/session may call. A server ABSENT from `servers` grants
 * none of its tools — ungranted tools are absent from the model context entirely, not blocked at call
 * time (R-MCP1).
 */
export type HubToolGrants = {
  servers: Record<string, HubServerToolGrant>;
  builtins: string[];
};

/** Live MCP tool annotations shown on approval cards (R-MCP3) — from the scanned + metered definition. */
export type HubToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
  icon?: string;
};

/**
 * Approval payload on a tool part (R-MCP3 / R-UX1). `options` are the affirmative choices offered
 * (deny is always available and not enumerated); `grants` are the session-scoped grant scopes an
 * `always` choice would create; `isAutomatic` marks a dial-approved (auto-run) call; `resolution` is the
 * terminal decision once the operator (or the dial) responds (absent while `approval-requested`).
 */
export type HubToolApproval = {
  options: HubApprovalOptionKind[];
  grants?: string[];
  isAutomatic?: boolean;
  resolution?: HubApprovalResolution;
  note?: string;
};

/** Progress + cancellation on a running tool part (R-MCP5). Every running row also has an elapsed ticker. */
export type HubToolProgress = {
  progressToken?: string;
  progress?: number;
  total?: number;
  message?: string;
  cancellable?: boolean;
  cancelled?: boolean;
};

/** Per-call request/response metering (R-MCP7 — the playground mechanics reused). */
export type HubCallMetering = {
  requestTokens?: number;
  responseTokens?: number;
  requestBytes?: number;
  responseBytes?: number;
  durationMs?: number;
};

/**
 * The UI-VISIBLE result channel of a tool call (R-GUI3 split from `modelContent`) — rendered, never sent
 * to the model. Carries typed structured content, a spilled-workspace reference (R-MCP7 output cap), or a
 * promoted file/artifact reference. `kind` discriminates the renderer.
 */
export type HubToolArtifact = {
  kind: string;
  data?: unknown;
  text?: string;
  mimeType?: string;
  /** Workspace-relative path when an oversized result spilled to a file (R-MCP7). */
  spillPath?: string;
  fileRef?: string;
  artifactRef?: string;
};

/**
 * A tool-call message part (R-UX1 / R-MCP): the full inline state machine plus `args` + raw `argsText`
 * (R-GUI3) and the SPLIT result channels `modelContent` (model-visible) vs `artifact` (UI-visible). The
 * same shape is the payload of a `tool_call` event and an ordered part of a settled `assistant_message`.
 */
export type HubToolPart = {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  source: HubToolSource;
  /** The registered MCP server id when `source === "mcp"` (cross-server names are namespaced). */
  serverId?: string;
  title?: string;
  state: HubToolPartState;
  /** Parsed (possibly partial) arguments — `input-streaming` → `input-available` (R-UX1 / R-GUI3). */
  args?: unknown;
  /** Raw argument text as streamed, independent of a successful parse (R-GUI3). */
  argsText?: string;
  annotations?: HubToolAnnotations;
  approval?: HubToolApproval;
  progress?: HubToolProgress;
  /** MODEL-VISIBLE result (fed back into context) — R-GUI3 split. */
  modelContent?: unknown;
  /** UI-VISIBLE result (rendered only) — R-GUI3 split. */
  artifact?: HubToolArtifact;
  /** A failed step (R-MCP6 `isError`) — model-visible self-correction, never a session error. */
  isError?: boolean;
  errorText?: string;
  /** Citation ids extracted from this result (§1.7), resolved against the message `citations[]`. */
  citationIds?: string[];
  metering?: HubCallMetering;
};

/**
 * A node in the declarative generative-UI tree (R-GUI2): a FLAT, recursive catalog node. `$type` is a
 * catalog component id (an enum at validate time — the allowlist is the security boundary); `$key` is a
 * stable identity for streaming/reconciliation; `props` carry data ONLY (tokens only, no colors/styles —
 * R-GUI8; URLs validated at render). Children stream parent-first; unresolved children are dropped, never
 * rendered as null holes (R-GUI3).
 */
export type HubGenUiNode = {
  $type: string;
  $key?: string;
  props?: Record<string, unknown>;
  children?: HubGenUiNode[];
};

/**
 * A generative-UI message part (R-GUI3, the "data widget"). Carries the validated allowlisted `spec`
 * tree, the `specVersion` stamped at emit, `args` + raw `argsText` for streaming safety, and the latest
 * per-message `state` (mirror of the `ui_state` event stream — R-GUI5).
 */
export type HubGenerativeUiPart = {
  type: "generative-ui";
  key?: string;
  spec: HubGenUiNode;
  specVersion?: string;
  args?: unknown;
  argsText?: string;
  state?: unknown;
};

export type HubTextPart = { type: "text"; text: string };
export type HubReasoningPart = { type: "reasoning"; text: string };
export type HubCitationPart = { type: "citation"; citationId: string };

/** A reference to an artifact version (used as a message part and in reports / artifactsTouched). */
export type HubArtifactRef = {
  artifactId: string;
  versionId?: string;
  version?: number;
  title?: string;
};

export type HubArtifactRefPart = { type: "artifact_ref" } & HubArtifactRef;

/**
 * One ordered part of a settled `assistant_message` (R-SES2 — no flat strings). Renderers switch on the
 * part `type` (and, for a tool part, its R-UX1 `state`).
 */
export type HubMessagePart =
  | HubTextPart
  | HubReasoningPart
  | HubToolPart
  | HubCitationPart
  | HubArtifactRefPart
  | HubGenerativeUiPart;

/** Regenerate/branch variant linkage on an assistant turn (MessageBranch, WP2.5). Siblings share a group. */
export type HubMessageVariantRef = {
  variantGroupId: string;
  variantIndex: number;
  variantCount?: number;
};

/** A durable branch/fork of a session (R-SES1 lineage / R-SES6 rewind; carried by `branch_created`). */
export type HubBranchRef = {
  branchSessionId: string;
  fromSessionId: string;
  /** The event seq the branch forked at (event-sourced lineage). */
  fromSeq?: number;
  fromMessageId?: string;
  label?: string;
};

/** A live task-widget item (R-SES4): status + dependencies, reconciled by id, event-sourced. */
export type HubTaskItem = {
  id: string;
  title: string;
  status: HubTaskStatus;
  /** Ids of tasks that must complete first. */
  dependsOn?: string[];
  note?: string;
};

// --- Structured agent report (D-AH9) --------------------------------------------------------------

/** One finding in a structured agent report; `citationIds` resolve against the report `citations[]`. */
export type HubAgentFinding = {
  summary: string;
  detail?: string;
  citationIds?: string[];
  confidence?: HubConfidence;
};

/**
 * The STRUCTURED agent report (D-AH9 — zod contract, not a transcript dump): findings, citations,
 * artifacts, confidence and open questions. Its citations carry `agentRef` and are preserved through
 * synthesis (§1.7); confidence + open questions render visibly in mission results (R-UX9).
 */
export type HubAgentReport = {
  agentSessionId?: string;
  roleName?: string;
  summary?: string;
  findings: HubAgentFinding[];
  citations: HubCitation[];
  artifacts: HubArtifactRef[];
  confidence: HubConfidence;
  openQuestions: string[];
  /**
   * Crew nesting (WP0.1 / D-CN5) — the recursive up-flow envelope. When a report rolls up a NESTED
   * sub-mission (a `crewId` member expanded into its own mission), `subMissionId` names that mission,
   * `topology` its shape, `childReports` the reports of that mission's own agents (self-referencing,
   * so an arbitrarily deep tree flows up as one structure), and `depth` this report's distance from the
   * root (root = 0). All optional + additive: a flat (non-nested) report omits them entirely.
   */
  subMissionId?: string;
  topology?: HubTopology;
  childReports?: HubAgentReport[];
  depth?: number;
};

// --- Roles (hub_agents), crews (hub_crews) — D-AH7 -----------------------------------------------

/**
 * A role definition in the library (D-AH7): name, system prompt, default model, MCP-server-AND-per-tool
 * grants + hub built-ins, skills, a main `target` (objective), an `expectedOutcome` (the structured-output
 * contract description — the runtime shape is {@link HubAgentReport}), and hard-cap budgets.
 */
/**
 * **Model identity (D-MI1, `planning/Roadmap/RM-16-model-identity/`).** The id of the `provider_credentials` row that
 * OWNS the chosen model — i.e. *which* credential runs it, not merely which model id was picked.
 *
 * Why it exists: **a model id does not identify a provider.** The signed-in Claude subscription
 * deliberately reports Anthropic's CANONICAL ids (see `apps/api/src/providers/subscription-models.ts`,
 * so `resolvePrice` / {@link MODEL_CONTEXT_LIMITS} exact-key lookups keep working) — therefore
 * `claude-sonnet-5` names BOTH an `anthropic` API model and a `claude_subscription` one. Without this
 * field the API re-guessed the provider from the model NAME (`inferHubModelKind`), whose return type
 * structurally EXCLUDES `claude_subscription`, so a subscription session silently ran on the metered
 * API key and failed with "your credit balance is too low".
 *
 * Semantics:
 * - **present** ⇒ AUTHORITATIVE. The resolver uses exactly this credential and never re-infers.
 * - **absent / `null`** ⇒ a legacy row (persisted before this field existed) ⇒ the historical
 *   name-heuristic fallback, unchanged, so every stored session/agent replays byte-identically.
 *
 * Additive and optional everywhere it appears — `model` stays required and byte-identical, so `/api`
 * stays versionless. Persisted on `hub_sessions` / `hub_agents` (migration **v55**, `ON DELETE SET
 * NULL` — a deleted credential degrades a historical session to the legacy path rather than making the
 * credential undeletable), and inside the `hub_crews.members_json` / `hub_missions.plan_json` blobs for
 * the nested shapes (no DDL — they are JSON columns).
 */
export type HubProviderCredentialId = string;

export type HubAgentRole = {
  id: string;
  name: string;
  /** WP0.1 (D-HUX8, P2) — an optional persona/display name shown in the workforce UI; the role `name`
   *  (title) is the fallback. The avatar reuses the existing `icon` field (no new avatar wire field). */
  displayName?: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  defaultModel: string;
  /** The credential that owns {@link defaultModel} — see {@link HubProviderCredentialId}. `null` on a
   *  role saved before this field existed (⇒ heuristic fallback), or after its credential was deleted.
   *  Stays OPTIONAL by design: a library agent must remain definable before any credential exists, so
   *  it is required only on execution surfaces, never at authoring time. */
  providerCredentialId?: HubProviderCredentialId | null;
  toolGrants: HubToolGrants;
  skills: HubSkillAttachment[];
  target: string;
  expectedOutcome: string;
  budgets?: HubBudgets;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type HubAgentRoleInput = {
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  defaultModel: string;
  /** See {@link HubProviderCredentialId}. Optional — an agent may be authored before any credential
   *  exists (the `QuickCreate` / `FormSections` free-text-model escape hatch). */
  providerCredentialId?: HubProviderCredentialId;
  toolGrants?: HubToolGrants;
  skills?: HubSkillAttachmentInput[];
  target: string;
  expectedOutcome: string;
  budgets?: HubBudgets;
};

export type HubAgentRolePatch = {
  name?: string;
  /** `null` clears the persona name back to the role-title fallback (mirrors `icon`/`description`). */
  displayName?: string | null;
  description?: string | null;
  icon?: string | null;
  systemPrompt?: string;
  defaultModel?: string;
  /** See {@link HubProviderCredentialId}. `null` explicitly UNPINS the credential (back to the
   *  heuristic), mirroring `displayName`/`description`/`budgets`' own explicit-clear convention;
   *  absent ⇒ no change. */
  providerCredentialId?: HubProviderCredentialId | null;
  toolGrants?: HubToolGrants;
  skills?: HubSkillAttachmentInput[];
  target?: string;
  expectedOutcome?: string;
  budgets?: HubBudgets | null;
  archived?: boolean;
};

// --- Skills for the hub (WP2.4, R-SK1…R-SK6/R-SK8) -------------------------------------------------
//
// Attachment lives at TWO levels, with different runtime mechanics (R-SK3's last clause / R-SK7):
//   • SESSION (`hub_session_skills`, mirrors `scenario_skills`): the L1 name+description catalog is
//     injected into the prompt under a listing-token BUDGET (R-SK1), and `invocationMode !== "user_only"`
//     entries become callable via the enum-constrained `skills.load` built-in (R-SK2) — the model reads
//     L2/L3 ON DEMAND. `invocationMode` is meaningful here.
//   • ROLE (`hub_agents.skills`, the library — D-AH7): a mission subagent gets its role-level skills'
//     FULL L2 body preloaded straight into its isolated brief (the "subagent-skills pattern") — there is
//     no catalog, no on-demand load, no user in the loop to slash-invoke. `invocationMode` is carried for
//     contract symmetry (scenario-attachment parity, R-SK8) but is NOT read by the role-brief preload —
//     every role-attached skill is always fully inlined regardless of its value.
// Skills are READ + METERED, never executed, at either level (the app invariant).

export type HubSkillInvocationMode = (typeof HUB_SKILL_INVOCATION_MODES)[number];

/** One skill attached at session or role level (D-AH7 / R-SK3 / R-SK8). `pinned` requires
 *  `pinnedVersionId`; `latest` resolves the skill's `currentVersionId` at read/turn time — the SAME
 *  `versionMode`/`pinnedVersionId` vocabulary the Testing feature's `AllowedSkill` uses (attachment
 *  parity), reusing {@link SkillVersionMode} rather than forking it. */
export type HubSkillAttachment = {
  skillId: string;
  versionMode: SkillVersionMode;
  pinnedVersionId?: string;
  invocationMode: HubSkillInvocationMode;
};

/** The write shape (`versionMode`/`invocationMode` default server-side to `"latest"`/`"model_invocable"`
 *  when omitted — see `hubSkillAttachmentInputSchema`). */
export type HubSkillAttachmentInput = {
  skillId: string;
  versionMode?: SkillVersionMode;
  pinnedVersionId?: string;
  invocationMode?: HubSkillInvocationMode;
};

/** R-SK4 — the SKILL.md frontmatter fields beyond `name`/`description`/`license`/`compatibility`/
 *  `allowed-tools`/`metadata` (which the Skills registry's {@link SkillManifest} already parses and
 *  the Hub carries via `version.manifest`). These are read directly off the raw YAML block (best-effort,
 *  never thrown) because the registry's manifest parser does not model them — "surfaced, never silently
 *  dropped" per R-SK4, with `portable: false` fields called out as client-specific (agentskills.io
 *  clients other than this app may not honor them). `extra` carries any further unrecognized top-level
 *  keys verbatim so nothing is lost even as the frontmatter vocabulary grows.
 */
export type HubSkillFrontmatterSuperset = {
  whenToUse?: string;
  context?: string;
  agent?: string;
  model?: string;
  effort?: string;
  paths?: string[];
  metadataVersion?: string;
  metadataAuthor?: string;
  extra?: Record<string, string>;
};

/** A session/role skill attachment resolved to a concrete version + its frontmatter + footprint
 *  (R-SK4/R-SK5/R-SK8) — the read shape the Hub's skills panel + context inspector render. Unresolvable
 *  (deleted skill/version) attachments are simply omitted, never thrown (mirrors `resolveAllowedSkills`). */
export type HubResolvedSkillAttachment = {
  skillId: string;
  versionMode: SkillVersionMode;
  pinnedVersionId?: string;
  invocationMode: HubSkillInvocationMode;
  skillName: string;
  skillDescription: string;
  versionId: string;
  versionLabel: string;
  isLatest: boolean;
  footprint: SkillTokenFootprint;
  frontmatter: HubSkillFrontmatterSuperset;
};

/** R-SK1 — the state of one skill's L1 catalog entry after the listing-budget algorithm runs.
 *  `excluded` = a `user_only` attachment (never in the model's catalog at all). `name_only` covers BOTH
 *  a manual `name_only` attachment and an auto-demoted `model_invocable` one — the demotion reason is
 *  reported separately (`demoted`) so the UI can explain WHY (R-SK1's live-cost promise). */
export type HubSkillListingState = "full" | "name_only" | "excluded";

export type HubSkillListingEntry = {
  skillId: string;
  name: string;
  state: HubSkillListingState;
  /** True when `state === "name_only"` because the budget algorithm demoted a `model_invocable`
   *  attachment (least-recently-invoked first) — false for a manually-set `name_only` attachment. */
  demoted: boolean;
  loadable: boolean;
  /** This entry's OWN rendered line measured in isolation by the app's TokenCounter (0 when
   *  `state === "excluded"`) — the per-skill L1 contribution R-SK5's session-true metering itemizes. */
  tokens: number;
};

/** R-SK1 — the L1 listing's measured cost against its budget (the "actual token cost renders live"
 *  promise). `budgetTokens` = `floor(contextWindow * HUB_SKILL_LISTING_BUDGET_FRACTION)`; `usedTokens` is
 *  measured by the app's own TokenCounter over the RENDERED text (post-truncation/demotion). Zero
 *  attachments (or all `user_only`) ⇒ `entries: []`, `usedTokens: 0`, no catalog text at all. */
export type HubSkillListing = {
  entries: HubSkillListingEntry[];
  budgetTokens: number;
  usedTokens: number;
  contextWindow: number;
};

/** R-SK5 — one skill's SESSION-TRUE metering: L1 (always, per the listing state) + L2/L3 realized via
 *  `skills.load` this session (persisted, summed from the event log — never re-estimated). `invoked`
 *  mirrors `HubSkillListingEntry` demotion eligibility (an invoked skill is never a demotion candidate
 *  while more-idle attachments remain). */
export type HubSkillSessionUsage = {
  skillId: string;
  name: string;
  l1Tokens: number;
  l2Tokens: number;
  l3Tokens: number;
  totalTokens: number;
  invoked: boolean;
  loadedPaths: string[];
};

/** `GET /api/hub/sessions/:id/skills` response (§1.4 additive route, WP2.4) — the resolved attachments,
 *  the current L1 listing (budget + per-entry state), and the session-true usage breakdown (R-SK5). */
export type HubSessionSkillsView = {
  attachments: HubResolvedSkillAttachment[];
  listing: HubSkillListing;
  usage: HubSkillSessionUsage[];
};

/** A crew member = EXACTLY ONE of a library role id (`agentId`) or a NESTED saved-crew id (`crewId` —
 *  crew nesting, WP0.1 / D-CN5), plus optional per-member overrides (D-AH7 saved crews). Exactly-one is
 *  enforced by `hubCrewMemberSchema`'s `.strict().superRefine`; a `crewId` member is inert (never
 *  executed) until the recursion engine lands in WP2.1. */
export type HubCrewMember = {
  agentId?: string;
  /** A nested saved-crew reference — mutually exclusive with `agentId` (crew nesting, D-CN5). */
  crewId?: string;
  model?: string;
  /** The credential owning this member's {@link model} override — see {@link HubProviderCredentialId}.
   *  Only meaningful alongside `model`; absent ⇒ inherit the referenced agent's own pin. */
  providerCredentialId?: HubProviderCredentialId;
  systemPromptOverride?: string;
  toolGrants?: HubToolGrants;
  skillIds?: string[];
  target?: string;
  expectedOutcome?: string;
  budgets?: HubBudgets;
};

/** A saved crew (D-AH7): a named team (roles + overrides + topology) instantiable by user or planner. */
export type HubCrew = {
  id: string;
  name: string;
  description?: string;
  /** WP0.1 (D-HUX8) — the crew's optional theme-aware accent (`--chart-1…5`), rendered only as small
   *  name-paired accents. Absent ⇒ no explicit accent. */
  color?: HubCrewColor;
  /** An optional avatar icon (owner request) — same encoding as the role `icon` (`parseHubIcon`:
   *  `lucide:<name>` / a `data:` URI / bare-token legacy). Absent ⇒ the `Persona` glyph seeded by id. */
  icon?: string;
  topology: HubTopology;
  members: HubCrewMember[];
  createdAt: string;
  updatedAt: string;
  /**
   * Crew nesting (WP0.1 / D-CN5) — computed-on-read crew-summary counts (the `ServerType.memberCount`
   * precedent: present on the read shape, absent otherwise). `memberCrewIds` are the ids of the crew's
   * direct nested-crew members; `memberAgentCount`/`memberCrewCount` are its direct agent/crew member
   * counts; `totalAgentCount` is the recursive (cycle-safe) agent count across the whole nested tree.
   * Populated by WP1.1 — this WP only defines the fields.
   */
  memberCrewIds?: string[];
  memberAgentCount?: number;
  memberCrewCount?: number;
  totalAgentCount?: number;
};

export type HubCrewInput = {
  name: string;
  description?: string;
  color?: HubCrewColor;
  icon?: string;
  topology: HubTopology;
  members: HubCrewMember[];
};

export type HubCrewPatch = {
  name?: string;
  description?: string | null;
  /** `null` clears the accent back to no explicit color. */
  color?: HubCrewColor | null;
  /** `null` clears the icon back to the default (member-strip / `Persona` fallback). */
  icon?: string | null;
  topology?: HubTopology;
  members?: HubCrewMember[];
};

// --- Missions (hub_missions) — D-AH6 / D-AH8 / D-AH9 ---------------------------------------------

/**
 * A planned agent in a proposed mission plan (D-AH6): a role snapshot (library or ad-hoc) with model,
 * grants, skills, an isolated `brief` (never the whole parent transcript — D-AH9), target/expected
 * outcome, budgets, a `rationale` ("because your prompt asks X…" — R-UX6) and a cost estimate.
 */
export type HubPlannedAgent = {
  key: string;
  roleId?: string;
  name: string;
  systemPrompt: string;
  model: string;
  /** The credential this planned agent's {@link model} runs on — see {@link HubProviderCredentialId}.
   *  Carried through the parent→child spawn so a child NEVER re-guesses its provider; absent ⇒ inherit
   *  the parent session's pin, then the heuristic. */
  providerCredentialId?: HubProviderCredentialId;
  toolGrants: HubToolGrants;
  skillIds: string[];
  brief: string;
  target: string;
  expectedOutcome: string;
  budgets?: HubBudgets;
  rationale?: string;
  estimatedCostUsd?: number;
  /** Crew nesting (WP0.1 / D-CN5) — set when this plan element expands a NESTED saved crew rather than a
   *  single role; the recursion engine reads it in WP2.1. Absent for an ordinary single-role agent. */
  crewId?: string;
};

/** The FROZEN mission plan (D-AH6) — snapshotted at approval, editable only as `plan_updated` before that. */
export type HubMissionPlan = {
  topology: HubTopology;
  autonomy: HubAutonomyLevel;
  agents: HubPlannedAgent[];
  rationale?: string;
  estimatedCostUsd?: number;
  budgets?: HubMissionBudgets;
  /**
   * hub-fixes WP4.4 (D-HF3) — the number of DEBATE rounds when `topology === "debate"`: round 1 is the
   * parallel independent openings, each further round a parallel rebuttal round where every debater sees
   * the OTHERS' latest reports. `1` = openings only (no rebuttal); default `2` (openings + one rebuttal);
   * capped at `3`. Ignored for non-debate topologies. Absent ⇒ the runtime default (2).
   */
  debateRounds?: number;
};

/**
 * `POST /api/hub/sessions/:id/mission` — the in-band planner turn's body.
 *
 * model-identity WP6.1 (F7) lifted this from a route-local zod object to a shared wire type, because it
 * gained the two fields that make a model choice mean something. The composer renders its model-override
 * chip on a mission session's first message, but the request carried only `{ text }` and the body schema
 * is `.strict()`, so the operator's explicit pick was dropped with no signal — the planner silently ran
 * on the session's model instead. Both fields are ADDITIVE and optional; absent ⇒ the session's own
 * model + pin, byte-identical to before.
 */
export type HubMissionProposeInput = {
  text: string;
  /** WP2.2 — instantiate a SAVED CREW (D-AH7) deterministically instead of running the planner model. */
  crewId?: string;
  /** Per-request model override for the PLANNER turn (the composer's chip). Absent ⇒ `session.model`. */
  model?: string;
  /** The credential owning {@link model} — see {@link HubProviderCredentialId}. Only meaningful
   *  alongside `model`; absent ⇒ the session's own pin, then the heuristic. */
  providerCredentialId?: HubProviderCredentialId;
};

/** A mission (D-AH8): parented to a chat session; agents run as child hub sessions (`kind:'agent'`). */
export type HubMission = {
  id: string;
  sessionId: string;
  status: HubMissionStatus;
  topology: HubTopology;
  autonomy: HubAutonomyLevel;
  plan: HubMissionPlan;
  budgets?: HubMissionBudgets;
  costUsd?: number;
  agentSessionIds: string[];
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Crew nesting (WP0.1 / D-CN5) — the parent mission that spawned this one (absent on a ROOT mission)
   *  and this mission's depth from the root (root = 0). Additive response-only fields. */
  parentMissionId?: string;
  depth?: number;
};

// --- Projects (hub_projects) — D-AH11(c) ---------------------------------------------------------

export type HubProject = {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type HubProjectInput = { name: string; description?: string; instructions?: string };
export type HubProjectPatch = {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  archived?: boolean;
};

// --- Sessions (hub_sessions) — §1.2 (Unified Sessions contract REUSED) -----------------------------

/**
 * End-user UX pass — the saved Agents & Crews a session scopes in (the new-session modal's "Agents &
 * Crews" tab). A PREFERRED POOL fed to the mission planner as candidates (owner decision): the planner
 * prefers and faithfully reuses these saved roles (referencing each by `roleId`, hydrated from the
 * library so its real prompt/tools/skills/model are used), and MAY still add or expand roles to fit the
 * task. Empty/absent ⇒ no preference (the planner invents a team from scratch — the prior behavior).
 * Only affects mission PLANNING (Mission mode, or Auto that plans a mission); a plain Chat/Research
 * session ignores it. `crewIds` reference `hub_crews`; `agentIds` reference the `hub_agents` role
 * library. Stored inline on the session as `roster_json` (mirrors `toolScope`).
 */
export type HubSessionRoster = {
  crewIds: string[];
  agentIds: string[];
};

/**
 * A hub session. The lifecycle fields (`status`/`phase`/`stopReasonCode`/`capabilities`/durations/
 * `waitDeadlineAt`) are the Unified-Sessions contract REUSED verbatim (D-AH3) — the console gates on
 * `capabilities`, never on a provider kind. Mission fields (`topology`/`autonomy`/`crewId`) are set only
 * in mission mode; `parentSessionId`/`missionId` are set only on an `agent` child session.
 */
export type HubSession = {
  id: string;
  projectId?: string | null;
  kind: HubSessionKind;
  parentSessionId?: string | null;
  missionId?: string | null;
  title: string;
  titleState: HubTitleState;
  mode: HubSessionMode;
  topology?: HubTopology;
  autonomy?: HubAutonomyLevel;
  crewId?: string | null;
  model: string;
  /** The credential this session's turns actually run on — see {@link HubProviderCredentialId}. `null`
   *  ⇒ not pinned (a pre-v55 session, or one whose credential was since deleted): the turn falls back
   *  to the name heuristic. Exposed on the READ wire so the UI can show the true provider (and warn
   *  when it is unpinned) instead of re-deriving it from the model name. */
  providerCredentialId?: HubProviderCredentialId | null;
  status: RunStatus;
  phase?: RunPhase | null;
  stopReasonCode?: StopReasonCode;
  capabilities?: SessionCapabilities;
  budgets?: HubBudgets;
  promptVersion?: string;
  /** End-user UX pass — the session's MCP tool SCOPE. `null`/absent ⇒ "auto": every reachable scanned
   *  server is granted and the model discovers tools via `tool_search` (the Claude-Desktop default).
   *  Present ⇒ "scoped": only the picked servers/tools are granted (set once at create via the
   *  new-session modal's MCP & tools tab). Skills scope by contrast rides `hub_session_skills` (no
   *  attachments ⇒ the full registry is offered for prompt-driven pick; attachments ⇒ that set only). */
  toolScope?: HubToolGrants | null;
  /** End-user UX pass — the saved Agents & Crews scoped into this session (a preferred pool the mission
   *  planner draws from / expands; see {@link HubSessionRoster}). `null`/absent ⇒ none. */
  roster?: HubSessionRoster | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  // --- WP0.1 (D-HUX4, P4) — session-list stat fields the Sessions DataTable needs. All ADDITIVE +
  // optional: an old session payload that omits them still parses; the API populates them in WP1.4.
  // (`tokensIn`/`tokensOut`/`costUsd`/`updatedAt` are the table's other stat columns — already present.)
  /** Settled user↔assistant turn count for the Sessions table `turns` column. */
  turns?: number;
  /** The most recent terminal error message (Sessions table `last error` column + tooltip); `null`/
   *  absent ⇒ no error. */
  lastError?: string | null;
  /** WP0.1 (P4) — archived out of the default Sessions list (soft-hide; no hard delete this workstream).
   *  A `Show archived` toggle reveals archived rows. Absent/`false` ⇒ active. */
  archived?: boolean;
  /** Active wall-clock, EXCLUDING `waiting_input` pauses (D-US3 / SessionClock). */
  activeDurationMs?: number;
  totalDurationMs?: number;
  /** Absolute ISO deadline the SessionClock armed while waiting on the operator (D-US7). */
  waitDeadlineAt?: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt?: string | null;
  seen: boolean;
};

export type HubSessionCreateInput = {
  mode: HubSessionMode;
  model: string;
  /** The credential to run {@link model} on — see {@link HubProviderCredentialId}. The picker knows it
   *  (every roster row is fetched per credential), so it must be SENT: this is the field whose absence
   *  made an "Anthropic CLI" session run on the metered API key. Absent ⇒ heuristic fallback. */
  providerCredentialId?: HubProviderCredentialId;
  projectId?: string;
  title?: string;
  /** Mission mode only. */
  topology?: HubTopology;
  autonomy?: HubAutonomyLevel;
  crewId?: string;
  /** End-user UX pass — optional MCP tool SCOPE picked in the new-session modal's "MCP & tools" tab.
   *  Absent ⇒ auto (every reachable server, tool-search). Present ⇒ only these servers/tools. */
  toolScope?: HubToolGrants;
  /** End-user UX pass — optional skills to attach at create (the modal's "Skills" tab, "Pick" mode).
   *  Absent/empty ⇒ auto (the full skill registry is offered for prompt-driven pick). */
  skills?: HubSkillAttachmentInput[];
  /** End-user UX pass — optional saved Agents & Crews to scope in at create (the modal's "Agents &
   *  Crews" tab). A preferred pool for the mission planner; see {@link HubSessionRoster}. Absent/empty
   *  ⇒ no preference (the planner invents a team from scratch). */
  roster?: HubSessionRoster;
};

export type HubSessionPatch = {
  title?: string;
  model?: string;
  /** Re-pin the session's credential — see {@link HubProviderCredentialId}. Absent ⇒ no change; `null`
   *  ⇒ explicitly unpin (back to the heuristic), mirroring {@link toolScope}/{@link roster}'s own
   *  absent/present/`null` convention. Without this, a mis-pinned session could never be corrected. */
  providerCredentialId?: HubProviderCredentialId | null;
  autonomy?: HubAutonomyLevel;
  /** WP0.1 (P4) — archive/unarchive a session from the Sessions table overflow menu (mirrors the
   *  role/project archive flag). No hard delete this workstream. */
  archived?: boolean;
  /** hub-fixes WP1.2 (RC3 — kills the "write-once" trap) — edit the session's MCP tool scope after
   *  create. Absent ⇒ no change; `null` ⇒ clear back to auto (every reachable scanned server); a
   *  {@link HubToolGrants} object ⇒ replace the scope with exactly that. Mirrors
   *  `HubSessionCreateInput.toolScope`'s own absent/present convention, plus the explicit-clear `null`
   *  {@link HubAgentRolePatch.budgets} already uses elsewhere in this file. */
  toolScope?: HubToolGrants | null;
  /** Edit the session's Agents & Crews roster after create. Absent ⇒ no change; `null` ⇒ clear to none;
   *  a {@link HubSessionRoster} ⇒ replace it. Mirrors {@link toolScope}'s absent/present/`null`
   *  convention. */
  roster?: HubSessionRoster | null;
  /** hub-fixes WP6.2 (RC7 — the composer stops conflating mode with autonomy) — switch the session's
   *  `mode` after create, from the composer's own mode chip. Absent ⇒ no change; no `null`/"clear"
   *  value exists here (unlike {@link toolScope}) since a session always has exactly one of the four
   *  {@link HubSessionMode} values, never an "unset" one. The API route additionally guards a
   *  `mission`<->`auto` swap to only when the session's mission (if any) has already reached a
   *  terminal status — see `apps/api/src/hub/routes.ts`'s PATCH handler. */
  mode?: HubSessionMode;
};

/** POST /api/hub/sessions/:id/messages (§1.4): text + attachments + per-message model override (D-AH4). */
export type HubSendMessageInput = {
  text: string;
  model?: string;
  /** The credential for this turn's {@link model} override — see {@link HubProviderCredentialId}. Only
   *  meaningful alongside `model`; absent ⇒ the session's own pin, then the heuristic. This is what
   *  makes the limit-error "retry on the other source" action actually switch source. */
  providerCredentialId?: HubProviderCredentialId;
  attachmentFileIds?: string[];
  /** WP3.3 / R-SES8 — a directive that AIMS any compaction this turn triggers (what to preserve/focus).
   *  Forwarded verbatim to the summarizer; recorded on the resulting `compaction` event for audit. */
  compactionAim?: string;
  /** End-user UX pass — saved agents `@`-mentioned in the composer (their `hub_agents` ids). Present ⇒
   *  the session HANDS the task off to exactly those saved agents as subagents (a deterministic team,
   *  no planner — approved per the autonomy dial), instead of running a normal chat turn. Resolution is
   *  by id (the web resolves `@Name` → id). Absent/empty ⇒ a normal message. */
  mentionedAgentIds?: string[];
};

/** Rolling session summary for long threads (D-AH11(b) — marked in-transcript, expandable). */
export type HubSessionSummary = {
  id: string;
  sessionId: string;
  uptoSeq: number;
  content: string;
  tokens: number;
  createdAt: string;
};

// --- Artifacts (hub_artifacts / hub_artifact_versions) — D-AH12 ----------------------------------

export type HubArtifactVersion = {
  id: string;
  artifactId: string;
  /** 1-based, monotonic; versions are IMMUTABLE. */
  version: number;
  content: string;
  note?: string;
  authorKind: HubActorKind;
  authorRef?: string;
  createdAt: string;
};

export type HubArtifact = {
  id: string;
  sessionId?: string | null;
  projectId?: string | null;
  kind: HubArtifactKind;
  title: string;
  latestVersion: number;
  currentVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

// --- Reviews (hub_reviews) — D-AH12 --------------------------------------------------------------

/** Where a review comment is anchored in the artifact (a quoted span and/or an offset/line range). */
export type HubReviewAnchor = {
  quote?: string;
  startOffset?: number;
  endOffset?: number;
  startLine?: number;
  endLine?: number;
};

export type HubReviewComment = {
  id: string;
  anchor?: HubReviewAnchor;
  body: string;
  /** A suggested replacement for the anchored span (accept → a new immutable version). */
  suggestedEdit?: string;
  decision: HubReviewCommentDecision;
  authorKind: HubActorKind;
  authorRef?: string;
  createdAt: string;
};

export type HubReview = {
  id: string;
  artifactId: string;
  baseVersion: number;
  status: HubReviewStatus;
  reviewerKind: HubActorKind;
  reviewerRef?: string;
  comments: HubReviewComment[];
  createdAt: string;
  updatedAt: string;
};

/**
 * The response of `PATCH /api/hub/reviews/:id` (WP3.5): the updated {@link HubReview} plus, ONLY when
 * the decision just applied was `accepted` on a comment carrying a `suggestedEdit`, the new immutable
 * {@link HubArtifactVersion} that acceptance produced (D-AH12 — accept/reject per suggestion → a new
 * version). Absent `resultingVersion` covers every other case: a status-only patch, a `rejected`
 * decision, or an `accepted` decision on a comment with no `suggestedEdit` (acknowledged, no version).
 */
export type HubReviewDecisionResult = {
  review: HubReview;
  resultingVersion?: HubArtifactVersion;
};

// --- Files (hub_files / hub_file_links) — D-AH12 -------------------------------------------------

/** A content-addressed uploaded file (sha256 identity). The blob content is fetched via GET, not on the wire object. */
export type HubFile = {
  id: string;
  sha256: string;
  mime: string;
  bytes: number;
  filename?: string;
  createdAt: string;
};

export type HubFileLink = {
  id: string;
  fileId: string;
  role: HubFileLinkRole;
  targetKind: HubFileLinkTarget;
  targetId: string;
  createdAt: string;
};

// POST /api/hub/projects/:id/files body (WP3.1) — a pinned TEXT snippet; see
// `hubProjectPinnedFileInputSchema`'s doc.
export type HubProjectPinnedFileInput = { filename: string; content: string };

/** A pinned project file WITH its decoded text content — `GET /api/hub/projects/:id/files/:fileId`'s
 *  response (list/metadata calls stay `HubFile[]`, mirroring `HubFile`'s own "content is fetched via
 *  GET, not on the wire object" doc). */
export type HubFileWithContent = HubFile & { content: string };

/**
 * WP3.4 (R-SES6) — one content-addressed workspace snapshot: a manifest of the session workspace's
 * file tree at the moment it was taken (each entry's bytes are stored once, keyed by sha256, under the
 * workspace's own `_snapshots/blobs/` directory — a git-like content store, NOT a DB row; there is no
 * `hub_workspace_snapshots` table). `fileCount`/`totalBytes` summarize the manifest for a picker list.
 */
export type HubWorkspaceSnapshot = {
  id: string;
  label?: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
};

/**
 * WP3.4 (R-MCP9) — one MCP resource attached to a session (@-mention/picker over scanned + live
 * `resources/list` + templates). Event-sourced (`resource_attached`/`resource_removed`, no new table)
 * so the currently-attached set is reconstructible from `hub_events` alone (R-SES1). `tokens` is the
 * MEASURED cost of the resource's actual content (the app's own TokenCounter over the fetched body,
 * not just the descriptor) — a "metered context item" per R-MCP9. Attaching NEVER auto-injects the
 * resource into the model's context (auto-inclusion is OFF by default, R-MCP9) — it only makes the
 * resource a visible, metered candidate the user can reference.
 */
export type HubResourceAttachment = {
  id: string;
  serverId: string;
  serverName?: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  /** MCP resource `annotations.audience` (`["user","assistant"]`) when the server declared any. */
  audience?: string[];
  /** MCP resource `annotations.priority` (0–1) when the server declared one. */
  priority?: number;
  /** MCP resource `annotations.lastModified` (ISO 8601) when the server declared one. */
  lastModified?: string;
  tokens?: number;
  attachedAt: string;
};

// --- Memory (hub_memory) — D-AH11(a) -------------------------------------------------------------

export type HubMemory = {
  id: string;
  kind: HubMemoryKind;
  content: string;
  source: HubMemorySource;
  status: HubMemoryStatus;
  /** WP0.1 (D-HUX11) — the memory's scope. Absent ⇒ `profile` (the pre-scope behavior a legacy row
   *  keeps; WP1.5's migration backfills it). */
  scope?: HubMemoryScope;
  /** The owning project/agent/crew id for a `project`/`agent`/`crew`-scoped entry; absent/`null` for
   *  `profile` scope (global). */
  scopeId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HubMemoryInput = {
  kind: HubMemoryKind;
  content: string;
  /** Optional on the wire — the API defaults an omitted scope to `profile` (WP1.5). A scoped write
   *  carries the owning entity id in `scopeId`. */
  scope?: HubMemoryScope;
  scopeId?: string;
};
export type HubMemoryPatch = {
  content?: string;
  status?: HubMemoryStatus;
  /** WP2.7 (D-HUX11) — move the row to a different scope at accept/edit time (the save-proposal's
   *  scope picker: the model's default scope isn't final until the owner accepts it — they may pick a
   *  different owner before saving). Omitted ⇒ scope unchanged. A `project`/`crew`/`agent` scope
   *  requires `scopeId` (mirrors the create-path entity guard, `HubRepository.resolveMemoryScope`);
   *  `profile` must NOT carry one. */
  scope?: HubMemoryScope;
  scopeId?: string;
};

// --- Effective memory (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP1.5 → WP2.7 promotion, D-HUX11) ---------------
// The session's RESOLVED memory stack — profile → project → crew → agent, most-specific-wins on a
// normalized-content conflict. Computed by `apps/api/src/hub/memory-resolver.ts`'s
// `buildSessionEffectiveMemory`/`resolveEffectiveMemory` and surfaced on the additive `effectiveMemory`
// field of `GET /api/hub/sessions/:id/context` (`HubContextInspector` below). WP1.5 shipped the type
// LOCAL to `apps/api` (the shared wire was frozen for that WP); WP2.7 promotes it here so the web
// consumes it typed end to end instead of defensively narrowing an untyped payload.

/** A memory row as it appears in the resolved effective stack, TAGGED with the scope it was injected
 *  from (its provenance for the D-HUX11 "each entry tagged with its scope" transparency read). */
export type HubEffectiveMemoryEntry = {
  id: string;
  kind: HubMemoryKind;
  content: string;
  source: HubMemorySource;
  status: HubMemoryStatus;
  /** The scope this entry was injected from. */
  scope: HubMemoryScope;
  /** The owning entity id (`null` for `profile`). */
  scopeId: string | null;
  /** The owning entity's display name, when resolved (absent for `profile` or a dangling owner). */
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
};

/** An entry shadowed by a more-specific conflicting entry (most-specific-wins) — surfaced for
 *  transparency, never hidden (D-HUX11's "conflict rule shown transparently"). */
export type HubEffectiveMemoryOverride = HubEffectiveMemoryEntry & {
  /** The scope of the entry that won the conflict. */
  overriddenByScope: HubMemoryScope;
  /** The id of the entry that won the conflict. */
  overriddenById: string;
};

/** One row of the per-scope breakdown (present layers only, in injection order). */
export type HubEffectiveMemoryLayerSummary = {
  scope: HubMemoryScope;
  scopeId: string | null;
  ownerName?: string;
  /** Surviving (injected) entries from this layer. */
  activeCount: number;
  /** Entries from this layer shadowed by a more-specific scope. */
  overriddenCount: number;
};

/** The resolved effective-memory stack for a session. `entries` is the injected set in injection
 *  order (profile → project → crew → agent); `overridden` is the shadowed set; `layers`/`order`
 *  describe the present scopes. `totalActive` is `entries.length` (a collapsed-count convenience). */
export type HubEffectiveMemory = {
  /** The scopes present for this session, in injection order (profile → project → crew → agent). */
  order: HubMemoryScope[];
  /** The surviving (injected) entries, in injection order, each tagged with its scope + owner. */
  entries: HubEffectiveMemoryEntry[];
  /** Entries shadowed by a more-specific conflicting entry (most-specific-wins), for transparency. */
  overridden: HubEffectiveMemoryOverride[];
  /** Per-scope breakdown (present layers only). */
  layers: HubEffectiveMemoryLayerSummary[];
  totalActive: number;
};

// --- Events (hub_events) — §1.3 CLOSED union, append-only, replay-complete (R-SES1) ---------------
// Streaming text deltas are forwarded over SSE but NOT persisted (settled events only). Each event on
// the wire also carries the {@link HubEventEnvelope} (`seq`/`at`), mirroring the RunEvent `& { seq? }`.

/** The phase-change detail bag (mirrors the Unified-Sessions phase-event detail; `reason` is a {@link WaitingInputReason}). */
export type HubPhaseEventDetail = {
  position?: number;
  reason?: WaitingInputReason;
  deadlineAt?: string;
};

/** A settled user turn. */
export type HubUserMessageEvent = {
  type: "user_message";
  messageId: string;
  text: string;
  model?: string;
  attachmentFileIds?: string[];
};

/**
 * R-SES3 — a durable steering message typed WHILE the session is running. Persisted immediately (survives
 * restart; losing one is a bug) and injected as a `user_message` at the next step boundary.
 */
export type HubQueuedUserMessageEvent = {
  type: "queued_user_message";
  queuedMessageId: string;
  text: string;
  model?: string;
  /**
   * model-identity WP6.1 (F4) — the credential the operator REQUESTED for this steering message's
   * {@link model} override (see {@link HubProviderCredentialId}). Before this the whole field was
   * dropped at `enqueue`, so a mid-turn "Retry on the other auth source" silently queued onto the
   * running credential with nothing anywhere recording what had been asked for.
   *
   * **This is a record of the REQUEST, not of what ran.** The running turn's model resolution is fixed
   * before the steering loop drains, so a queued override cannot change the credential (or the model)
   * the injected turn actually executes on — honouring it would mean rebuilding the provider model
   * mid-turn, and for a `claude_subscription` credential, switching executors entirely. The injected
   * `user_message` is therefore stamped with what genuinely ran; this event preserves the ask, so the
   * transcript shows both facts and asserts neither falsely.
   */
  providerCredentialId?: HubProviderCredentialId;
  attachmentFileIds?: string[];
};

/**
 * The SETTLED assistant message (R-SES2): `model`, `usage`, `citations`, artifacts-touched, and the
 * ORDERED typed `parts` array (no flat strings). `promptVersion` stamps the prompt architecture (D-AH14).
 */
export type HubAssistantMessageEvent = {
  type: "assistant_message";
  messageId: string;
  model: string;
  parts: HubMessagePart[];
  usage?: HubUsage;
  citations: HubCitation[];
  artifactsTouched: HubArtifactRef[];
  promptVersion?: string;
  costUsd?: number;
  costBasis?: SessionCostBasis;
  finishReason?: string;
  variant?: HubMessageVariantRef;
};

/** A settled reasoning summary for a turn (streaming reasoning deltas are not persisted). */
export type HubReasoningEvent = { type: "reasoning"; messageId?: string; text: string };

/** A tool-call lifecycle checkpoint — the {@link HubToolPart} at an `input`/`approval` settled state. */
export type HubToolCallEvent = { type: "tool_call"; messageId?: string; part: HubToolPart };

/** A tool call settling (R-UX1 output states) with the R-GUI3 split channels + per-call metering. */
export type HubToolResultEvent = {
  type: "tool_result";
  toolCallId: string;
  state: "output-available" | "output-error" | "output-denied";
  modelContent?: unknown;
  artifact?: HubToolArtifact;
  isError?: boolean;
  errorText?: string;
  citations?: HubCitation[];
  metering?: HubCallMetering;
};

/**
 * R-GUI5 — a per-message generative-UI state change (client-side state ops that NEVER re-enter the
 * model). Event-sourced so the widget state is rehydrated on replay (R-SES1). `key` selects the widget.
 */
export type HubUiStateEvent = {
  type: "ui_state";
  messageId: string;
  key?: string;
  state: unknown;
  source?: HubActorKind;
  specVersion?: string;
};

/** A phase change — REUSES the Unified-Sessions {@link RunPhase} vocabulary (null clears the phase). */
export type HubPhaseEvent = { type: "phase"; phase: RunPhase | null; detail?: HubPhaseEventDetail };

/** A turn settling with final usage/cost (the subscription `turn_done.usage` shape generalized). */
export type HubTurnDoneEvent = {
  type: "turn_done";
  messageId?: string;
  usage?: HubUsage;
  costUsd?: number;
  costBasis?: SessionCostBasis;
};

export type HubPlanProposedEvent = {
  type: "plan_proposed";
  missionId: string;
  plan: HubMissionPlan;
  /** Crew nesting (WP3.1 / D-CN7, R-SES1) — the mission id of the PARENT mission this event's mission
   *  descends from. Absent on the ROOT mission's `plan_proposed`; present on every nested sub-mission's
   *  (emitted directly by the recursion engine, never via `proposePlan` — D-CN1). The load-bearing
   *  linkage that lets the board reducer reconstruct the whole mission TREE from `hub_events` alone. */
  parentMissionId?: string;
  /** Crew nesting (WP3.1 / D-CN7) — the `key` of the parent mission's CREW-NODE planned agent (the slot
   *  carrying `crewId`) that expanded into this sub-mission. Present iff {@link parentMissionId} is. */
  parentAgentKey?: string;
};
export type HubPlanUpdatedEvent = {
  type: "plan_updated";
  missionId: string;
  plan: HubMissionPlan;
  editedBy?: HubActorKind;
};
export type HubPlanApprovedEvent = {
  type: "plan_approved";
  missionId: string;
  autonomy?: HubAutonomyLevel;
  approvedBy?: HubActorKind;
  /** True when auto-approved by the autonomy dial rather than the operator. */
  auto?: boolean;
};
export type HubMissionStartedEvent = {
  type: "mission_started";
  missionId: string;
  agentSessionIds: string[];
};
export type HubAgentSpawnedEvent = {
  type: "agent_spawned";
  missionId: string;
  agentSessionId: string;
  key: string;
  roleName: string;
  model: string;
  brief?: string;
  index?: number;
  /** Crew nesting (WP3.1 / D-CN7, R-SES1) — the PARENT mission id of THIS event's mission (`missionId`).
   *  Absent on the root mission's spawns; present on every nested sub-mission's per-member spawn. The
   *  belt-and-suspenders MIRROR of {@link HubPlanProposedEvent.parentMissionId} (the load-bearing copy
   *  is on `plan_proposed`), so the reducer stays robust to event ordering. */
  parentMissionId?: string;
  /** Crew nesting (WP3.1 / D-CN7) — the parent crew-node planned agent's `key` (mirror of
   *  {@link HubPlanProposedEvent.parentAgentKey}). Present iff {@link parentMissionId} is. */
  parentAgentKey?: string;
};
export type HubAgentReportEvent = {
  type: "agent_report";
  missionId: string;
  agentSessionId: string;
  report: HubAgentReport;
  /** hub-fixes WP2.4 — the agent's REAL accumulated cost/tokens (the same total the orchestrator syncs
   *  onto the child session row), so the board can show real per-agent spend from the event log alone
   *  (R-SES1) — never a separate session fetch. Absent on a pre-fix log (replay-compatible; the board
   *  simply shows no cost for that agent, honestly, rather than fabricating one). */
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
};
export type HubMissionSynthesisEvent = {
  type: "mission_synthesis";
  missionId: string;
  /** The synthesis `assistant_message` this points at (which cites the agent reports — §1.7). */
  messageId?: string;
  /** True when synthesized from a budget-tripped / partial run (honestly marked — R-UX9). */
  partial?: boolean;
  agentReportRefs?: string[];
};

/**
 * assistant-hub v1-fixes (F2) — the mission's MODEL-VISIBLE outcome record. `text` is a compact,
 * pre-rendered digest (per-agent finding summaries + ALL open questions, agent-attributed) that
 * `reconstructMessages` folds into every LATER turn's context as an assistant turn — so the parent
 * session can always quote what its agents found, without re-injecting the full reports. The full
 * structured reports stay reachable on demand via the `mission.report` builtin (F3).
 */
export type HubMissionDigestEvent = {
  type: "mission_digest";
  missionId: string;
  text: string;
  agentReportRefs?: string[];
};

/** assistant-hub v1-fixes (F7) — the mission's deduped open questions, agent-attributed, persisted so
 *  the UI can offer "investigate as a follow-up mission" and the planner can seed follow-up briefs. */
export type HubMissionFollowupsEvent = {
  type: "mission_followups";
  missionId: string;
  followups: Array<{ question: string; agentSessionId?: string; roleName?: string }>;
};

/**
 * hub-fixes WP2.5 (D-HF6) — a mission CHILD agent's approval-gated tool call, MIRRORED onto the PARENT
 * (mission board) log so the board's approval queue is reconstructible from the parent event log ALONE
 * (R-SES1), exactly like every other board surface. Only ever emitted under an `always_ask` mission
 * (the autonomy that queues every gated child call to the board); an `auto`/`threshold` mission gates
 * destructive/unannotated calls silently (auto-declined, no board card — never a hidden stall). The
 * decision is made on the board and routed to the CHILD session's existing `/approvals` route
 * (`agentSessionId` + `toolCallId`); the child turn's own `approval_requested`/`approval_responded`
 * events still live on the child log unchanged. Carries the same card context as
 * {@link HubApprovalRequestedEvent}.
 */
export type HubAgentApprovalRequestedEvent = {
  type: "agent_approval_requested";
  missionId: string;
  agentSessionId: string;
  /** The child agent's role label (for the board card), from its `agent_spawned`. */
  roleName?: string;
  toolCallId: string;
  toolName: string;
  source: HubToolSource;
  serverId?: string;
  annotations?: HubToolAnnotations;
  options: HubApprovalOptionKind[];
};

/** hub-fixes WP2.5 (D-HF6) — the terminal decision on an {@link HubAgentApprovalRequestedEvent},
 *  mirrored to the board so its queue clears. `reason` distinguishes an operator's decision from an
 *  auto-deny after the `HUB_MISSION_APPROVAL_TIMEOUT_S` budget elapsed (a mission must terminate — a
 *  silent stall is a defect). */
export type HubAgentApprovalRespondedEvent = {
  type: "agent_approval_responded";
  missionId: string;
  agentSessionId: string;
  toolCallId: string;
  resolution: HubApprovalResolution;
  reason: "decided" | "timeout";
};

export type HubArtifactCreatedEvent = {
  type: "artifact_created";
  artifactId: string;
  kind: HubArtifactKind;
  title: string;
  versionId: string;
  version: number;
};
export type HubArtifactUpdatedEvent = {
  type: "artifact_updated";
  artifactId: string;
  versionId: string;
  version: number;
  note?: string;
};
export type HubReviewOpenedEvent = {
  type: "review_opened";
  reviewId: string;
  artifactId: string;
  baseVersion: number;
};
export type HubReviewDecidedEvent = {
  type: "review_decided";
  reviewId: string;
  artifactId: string;
  status?: HubReviewStatus;
  commentId?: string;
  decision?: HubReviewCommentDecision;
  resultingVersionId?: string;
  resultingVersion?: number;
};

export type HubMemoryProposedEvent = {
  type: "memory_proposed";
  memoryId?: string;
  kind: HubMemoryKind;
  content: string;
  /** WP0.1 (D-HUX11) — the scope an assistant save-proposal targets (default: the most-specific
   *  sensible owner). Absent ⇒ `profile`. */
  scope?: HubMemoryScope;
  scopeId?: string | null;
};
export type HubMemorySavedEvent = {
  type: "memory_saved";
  memoryId: string;
  kind: HubMemoryKind;
  content: string;
  source: HubMemorySource;
  scope?: HubMemoryScope;
  scopeId?: string | null;
};
export type HubFileUploadedEvent = {
  type: "file_uploaded";
  fileId: string;
  filename?: string;
  mime: string;
  bytes: number;
  role?: HubFileLinkRole;
};
export type HubWorkspaceFileChangedEvent = {
  type: "workspace_file_changed";
  path: string;
  change: HubWorkspaceChangeKind;
  bytes?: number;
  sha256?: string;
};

/** WP3.4 / R-MCP9 — an MCP resource attached to the session (event-sourced, {@link HubResourceAttachment}
 *  minus `attachedAt`, which the event's own envelope `at`/`createdAt` already carries on replay). */
export type HubResourceAttachedEvent = {
  type: "resource_attached";
  id: string;
  serverId: string;
  serverName?: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  audience?: string[];
  priority?: number;
  lastModified?: string;
  tokens?: number;
};

/** WP3.4 / R-MCP9 — a previously attached resource removed from the session's attached set. */
export type HubResourceRemovedEvent = { type: "resource_removed"; id: string };

/**
 * WP2.3 / R-MCP3 / R-UX1 — an approval-gated tool call PAUSED for the operator's decision. The turn
 * enters `waiting_input` (reason `approval`) until an `approval_responded` (or an auto-run marked
 * `isAutomatic`) settles it. Carries the same annotation + option context the `ApprovalCard` shows, so
 * the card is reconstructible from `hub_events` alone (R-SES1) — the tool part it refers to is already
 * in the log at `input-available`.
 */
export type HubApprovalRequestedEvent = {
  type: "approval_requested";
  toolCallId: string;
  toolName: string;
  messageId?: string;
  source: HubToolSource;
  serverId?: string;
  annotations?: HubToolAnnotations;
  /** The affirmative choices offered (deny is always available, never enumerated). */
  options: HubApprovalOptionKind[];
  /** True when the dial auto-approved this call — rendered as an automatic run, not a pending card. */
  isAutomatic?: boolean;
  /** The autonomy dial in force when the card was raised (audit/telemetry — R-UX7). */
  autonomy?: HubAutonomyLevel;
};

/** WP2.3 — the terminal decision on an {@link HubApprovalRequestedEvent} (R-UX1 `approval-responded`). */
export type HubApprovalRespondedEvent = {
  type: "approval_responded";
  toolCallId: string;
  resolution: HubApprovalResolution;
  /** True when resolved by the dial (auto-run), not the operator. */
  isAutomatic?: boolean;
};

/**
 * WP2.3 / R-MCP4 — an MCP server `elicitation/create` surfaced to the operator. Form mode carries a flat
 * `requestedSchema` (rendered through the existing schema→form generator); URL mode carries a `url`
 * shown with domain emphasis, never auto-opened/prefetched. The session enters `waiting_input` (reason
 * `elicitation`) until an `elicitation_responded`. Every elicitation is an event (R-MCP4).
 */
export type HubElicitationRequestedEvent = {
  type: "elicitation_requested";
  elicitationId: string;
  serverId?: string;
  serverName?: string;
  toolCallId?: string;
  message: string;
  mode: HubElicitationMode;
  /** Flat JSON schema (form mode) — the MCP `requestedSchema`, rendered through the schema→form generator. */
  requestedSchema?: unknown;
  /** The full URL (url mode) — shown with domain emphasis; never auto-opened/prefetched (R-MCP4/R-MCP12). */
  url?: string;
};

/** WP2.3 — the terminal response to an {@link HubElicitationRequestedEvent} (R-MCP4). */
export type HubElicitationRespondedEvent = {
  type: "elicitation_responded";
  elicitationId: string;
  action: HubElicitationAction;
  /** True when auto-declined by the credential-shaped-field guard (a secret was requested — R-MCP4/12). */
  autoDeclined?: boolean;
  reason?: string;
};

/**
 * The agent-initiated interactive `ask_user` question (mirrors the Testing `question` {@link RunEvent}
 * member — the hub reuses the SAME `ask_user` tool primitive, not the SDK-native `AskUserQuestion`).
 * Emitted when a foreground turn's model asks the operator to pick a predefined choice or type an
 * answer; the turn PAUSES (`waiting_input`, reason `"question"`) until `POST …/answers` resolves it.
 * Exposed only on interactive foreground sessions (`SessionCapabilities.askUser`), never on mission
 * agent/synthesis turns.
 */
export type HubQuestionEvent = {
  type: "question";
  /** Correlates the ask with its `question_resolved` and with the `POST …/answers` body. */
  questionId: string;
  /** The question text the operator is asked. */
  prompt: string;
  /** Optional predefined choices to offer (each a one-click submit). */
  options?: RunQuestionOption[];
  /** Whether the operator may type a free-text answer instead of picking an option (default true). */
  allowOther?: boolean;
};

/** Settles a {@link HubQuestionEvent}: the chosen/typed `answer`, or `null` when the session was
 *  stopped/aborted before an answer. Append-only like every event, so a replayed session never shows a
 *  stale, still-open question card. */
export type HubQuestionResolvedEvent = {
  type: "question_resolved";
  questionId: string;
  answer: string | null;
};

/**
 * WP3.3 / R-SES8 — a compaction checkpoint: from this point BACKWARD (up to `uptoSeq`) the earlier turns
 * are represented to the MODEL by the rolling {@link HubSessionSummary} `summaryId`, not their full text.
 * Order of operations per the reference harness: cold tool outputs cleared FIRST (`clearedToolOutputs`),
 * then the cold region summarized. Invoked-skill bodies re-attach within the R-SK2 budget
 * (`reattachedSkillIds`). `windowBefore`/`windowAfter` are the measured context-window token totals so
 * the saving is honest + inspectable. The transcript renders an expandable "earlier turns compacted"
 * marker from this event alone (R-SES1); the persisted events are NOT deleted — only what the model sees
 * shrinks (the human still sees the full history).
 */
export type HubCompactionEvent = {
  type: "compaction";
  /** The `hub_session_summaries` row this checkpoint points at. */
  summaryId: string;
  /** Events with `seq <= uptoSeq` are now folded into the summary (the compaction boundary). */
  uptoSeq: number;
  /** The rolling summary content (shown expandable in-transcript). */
  summary: string;
  /** The summary's own measured token cost. */
  summaryTokens: number;
  /** How many cold tool outputs were cleared (hot/cold split, step 1) — 0 on a summary-only compaction. */
  clearedToolOutputs: number;
  /** The measured tokens those cleared cold tool outputs had occupied (informational). */
  clearedToolOutputTokens?: number;
  /** The measured context-window tokens BEFORE this compaction (system + summary + history). */
  windowBefore: number;
  /** The measured context-window tokens AFTER (system + new summary + hot region). */
  windowAfter: number;
  /** The skill ids whose loaded bodies were re-attached within the R-SK2 budget (compaction-protected). */
  reattachedSkillIds?: string[];
  /** The user's steering directive for this summary, when supplied (R-SES8 "user can aim the summary"). */
  userAim?: string;
};

/** Branch/fork created (R-SES1 lineage / R-SES6 rewind) — carries the {@link HubBranchRef}. */
export type HubBranchCreatedEvent = { type: "branch_created" } & HubBranchRef;

/**
 * A provider/subscription LIMIT error (D-AH17 / R-SES11): surfaces the OTHER source(s) to retry on —
 * never a silent switch. Partial output before it is preserved with a cut-off note (a separate `error`
 * or the settled message).
 */
export type HubLimitErrorEvent = {
  type: "limit_error";
  message: string;
  retrySources?: HubLimitRetrySource[];
  limitKind?: string;
  provider?: string;
};

/** A provider/transport error (mirrors the RunEvent error member — auth-required + affected servers). */
export type HubErrorEvent = {
  type: "error";
  message: string;
  authRequired?: boolean;
  serverIds?: string[];
  recoverable?: boolean;
};

/**
 * hub-fixes WP1.3 (RC3.4) — one granted MCP server's connection outcome. The wire mirror of
 * {@link HubMcpServerStatusEvent} minus its envelope/`type`; also embedded (latest-per-server) in
 * {@link HubContextToolsLayer}'s `serverStatuses` for the rail's per-server chip.
 */
export type HubMcpServerStatusEntry = {
  serverId: string;
  serverName: string;
  status: "connected" | "error";
  /** A short human-readable failure reason — present only when `status: "error"`. */
  message?: string;
  /** True when the failure is a REAUTH-able authentication error (401/403 on an OAuth streamable-HTTP
   *  server) — the UI offers an "Authenticate" action (the ServerWizard reauth flow) instead of a
   *  passive "unreachable" notice. Absent/false ⇒ a transport failure (nothing to authenticate). */
  authRequired?: boolean;
};

/**
 * hub-fixes WP1.3 (RC3.4) — a granted MCP server's live connection outcome at TURN-START toolset
 * resolution. Persisted (and forwarded live over SSE) only when the status CHANGES from the session's
 * last known state for that server — deduped in `HubSessionService`, never emitted every turn — so the
 * rail's chip stays accurate without flooding the transcript. `error` means the server WAS granted but
 * its connection failed to open THIS turn: it is dropped from the turn's tool surface (graceful
 * degradation, D-AS17) but never SILENTLY — the prompt's own "Unreachable this turn" trailing line
 * (built from the same per-turn outcome, independent of this event's dedup — the model needs the truth
 * every turn, not just on change) replaces the pre-fix "No MCP tools are granted in this session"
 * fallback that RC3.4 named.
 */
export type HubMcpServerStatusEvent = HubMcpServerStatusEntry & { type: "mcp_server_status" };

/** SSE keepalive (mirrors the RunEvent `ping`). */
export type HubPingEvent = { type: "ping" };

/** The common envelope on every wire event — a per-session monotonic `seq` + an optional ISO timestamp. */
export type HubEventEnvelope = { seq?: number; at?: string };

/**
 * The full closed hub event union (§1.3). A discriminated union on `type` intersected with
 * {@link HubEventEnvelope}, mirroring `RunEvent`'s `& { seq? }` shape. Every member is persisted (append-
 * only); replaying them reconstructs a session's full state (R-SES1).
 */
export type HubEvent = (
  | HubUserMessageEvent
  | HubQueuedUserMessageEvent
  | HubAssistantMessageEvent
  | HubReasoningEvent
  | HubToolCallEvent
  | HubToolResultEvent
  | HubUiStateEvent
  | HubPhaseEvent
  | HubTurnDoneEvent
  | HubPlanProposedEvent
  | HubPlanUpdatedEvent
  | HubPlanApprovedEvent
  | HubMissionStartedEvent
  | HubAgentSpawnedEvent
  | HubAgentReportEvent
  | HubMissionSynthesisEvent
  | HubMissionDigestEvent
  | HubMissionFollowupsEvent
  | HubAgentApprovalRequestedEvent
  | HubAgentApprovalRespondedEvent
  | HubArtifactCreatedEvent
  | HubArtifactUpdatedEvent
  | HubReviewOpenedEvent
  | HubReviewDecidedEvent
  | HubMemoryProposedEvent
  | HubMemorySavedEvent
  | HubFileUploadedEvent
  | HubWorkspaceFileChangedEvent
  | HubResourceAttachedEvent
  | HubResourceRemovedEvent
  | HubApprovalRequestedEvent
  | HubApprovalRespondedEvent
  | HubElicitationRequestedEvent
  | HubElicitationRespondedEvent
  | HubQuestionEvent
  | HubQuestionResolvedEvent
  | HubCompactionEvent
  | HubBranchCreatedEvent
  | HubLimitErrorEvent
  | HubErrorEvent
  | HubMcpServerStatusEvent
  | HubPingEvent
) &
  HubEventEnvelope;

// --- Live HITL decision wire (WP2.3, §1.4) --------------------------------------------------------

/** POST /api/hub/sessions/:id/decisions — an operator's decision on a pending approval-gated tool call
 *  (R-MCP3 / R-UX1). `resolution` mirrors {@link HubApprovalResolution} (`allow-once`/`always`/`deny`). */
export type HubApprovalDecisionInput = {
  toolCallId: string;
  resolution: HubApprovalResolution;
};

/** POST /api/hub/sessions/:id/elicitation — an operator's response to a pending MCP elicitation
 *  (R-MCP4). `accept` carries flat primitive `content`; `decline`/`cancel` carry none. */
export type HubElicitationResponseInput = {
  elicitationId: string;
  action: HubElicitationAction;
  content?: Record<string, string | number | boolean | string[]>;
};

/**
 * Body of `POST /api/hub/sessions/:id/answers` — the operator's answer to a live {@link HubQuestionEvent}
 * (the hub counterpart of the Testing {@link RunAnswerRequest}). `questionId` correlates it to the emitted
 * `question` event; `answer` is the chosen option label or free-typed text.
 */
export type HubAnswerRequest = {
  questionId: string;
  answer: string;
};

/**
 * A still-open agent-initiated question recoverable from a reopened/replayed interactive session
 * (mirrors the Testing {@link RunOpenQuestion}). Populated on {@link HubSessionDetail.openQuestions} —
 * every `question` with no later `question_resolved` of the same `questionId`.
 */
export type HubOpenQuestion = RunOpenQuestion;

/** POST /api/hub/missions/:id/agents/:agentSessionId/steer — inject a durable steering message into a
 *  running mission agent's child session (R-SES3 / R-UX4). */
export type HubAgentSteerInput = {
  text: string;
};

/** POST /api/hub/sessions/:id/ui-state — a per-message generative-UI client-state snapshot (WP2.6,
 *  R-GUI5). A client-side interaction that never re-enters the model but must replay-rehydrate; appended
 *  as the `ui_state` event. `key` scopes state to one widget within the message (a message may hold more
 *  than one `present` widget). */
export type HubUiStateInput = {
  messageId: string;
  key?: string;
  state: unknown;
};

/** GET /api/hub/sessions/:id (§1.4) — the session plus its full replay event log (R-SES1). Also carries
 *  the still-open agent-initiated questions (additive) so a non-streaming read re-renders the answer
 *  card without waiting for an SSE replay; derived from the event log, never a separate source of truth. */
export type HubSessionDetail = {
  session: HubSession;
  events: HubEvent[];
  mission?: HubMission;
  openQuestions?: HubOpenQuestion[];
};

// --- Usage telemetry (WP4.1, R-UX6/R-UX8) ----------------------------------------------------------
//
// `GET /api/hub/usage` — spend/token ROLLUPS over `hub_sessions.{cost_usd,tokens_in,tokens_out}` (the
// running per-session totals the turn engine already accumulates — never re-derived from the event
// log), bucketed a few honest ways, plus the mission list + the R-UX6 plan-acceptance signal. This is
// a METRIC surface (R-UX6: "watch the signal, no gate") — nothing here blocks or grades a run.

/** One aggregation bucket (by model / provider / mode / day). `key` is the raw grouping value (a model
 *  id, an inferred provider kind, a session mode, or a `YYYY-MM-DD` date); `label` is what the UI
 *  displays (may differ from `key` for provider/mode, which have friendlier names). */
export type HubUsageBucket = {
  key: string;
  label: string;
  sessions: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
};

/**
 * model-identity WP3.3 (D-MI10) — one PER-CREDENTIAL provider bucket: "which key is actually being
 * billed for this spend". Additive alongside {@link HubUsageAggregates.byProvider} (the kind-level
 * roll-up, which is preserved unchanged) because a kind bucket cannot answer that question at all once
 * an operator holds two credentials of the same kind.
 *
 * Attribution reads the session's PERSISTED `provider_credential_id` (migration v55, D-MI1/D-MI2) — the
 * credential that actually ran the turn — and only falls back to the model-NAME heuristic for a row
 * where that column is NULL (a pre-v55 session, or one whose credential was since deleted; `ON DELETE
 * SET NULL`). That distinction is the whole point of the field: the heuristic's return type
 * structurally excludes `claude_subscription`, so before this WP every subscription session's spend was
 * reported as plain "Anthropic" — in the one report an operator would open to catch exactly that.
 */
export type HubUsageProviderCredentialBucket = HubUsageBucket & {
  /** The provider kind this spend was billed under. `null` only when nothing could be resolved (an
   *  unpinned session on a model name the heuristic does not recognize) — the "Other" bucket. */
  providerKind: ProviderKind | null;
  /** The `provider_credentials.id` this session was pinned to, or `null` for an UNPINNED bucket
   *  (see `unpinned`). Never a secret — an id and a label only. */
  credentialId: string | null;
  /** How that kind is paid for (D-MI6 `PROVIDER_KIND_META`). Presentation only — this drives a badge,
   *  never a pricing calculation. `null` alongside a `null` `providerKind`. */
  billing: ProviderKindBilling | null;
  /** `true` ⇒ this bucket's attribution is a GUESS from the model name, not a recorded fact: no
   *  credential was persisted on those sessions. Surfaced so a reader can tell measured from inferred
   *  instead of the two being silently blended. */
  unpinned: boolean;
};

/** One mission's usage row for the Usage view's mission breakdown. `approvedUnedited` is the R-UX6
 *  per-mission signal (undefined for a mission never approved — the metric only applies past that
 *  gate); `costUsd` is the mission's own rollup (`hub_missions.cost_usd`), which mirrors the sum of its
 *  agent sessions' `costUsd` but is read directly rather than re-summed. */
export type HubUsageMissionSummary = {
  missionId: string;
  sessionId: string;
  sessionTitle: string;
  topology: HubTopology;
  status: HubMissionStatus;
  agentCount: number;
  costUsd: number;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  approvedUnedited?: boolean;
};

/** R-UX6 — "watch the >85%-unedited-acceptance signal in usage telemetry (metric only, no gate)":
 *  among missions that reached approval, how many were approved with NO `plan_updated` edit event
 *  first. `approvedMissions === 0` ⇒ `uneditedPercent: 0` (nothing to report yet, never NaN). */
export type HubPlanAcceptanceMetric = {
  approvedMissions: number;
  uneditedApprovals: number;
  uneditedPercent: number;
};

/** `GET /api/hub/usage` response. `byModel`/`byProvider` aggregate EVERY session (top-level chat/
 *  research/mission threads AND mission-agent children — an agent may run a different, often cheaper,
 *  model, and its real spend counts toward the total); `byMode`/`byDay` aggregate top-level (`kind:
 *  "chat"`) sessions only (an agent child's `mode` column is always `"chat"` regardless of its actual
 *  role, so including it there would mislabel spend as ordinary chat use). */
export type HubUsageAggregates = {
  range: { from?: string; to?: string; projectId?: string };
  totals: { sessions: number; costUsd: number; tokensIn: number; tokensOut: number };
  byModel: HubUsageBucket[];
  /** Kind-level roll-up (`key` = a {@link ProviderKind}, `label` = its D-MI6 registry label). Since
   *  model-identity WP3.3 the kind comes from the session's PERSISTED credential where it has one, so
   *  `claude_subscription` spend finally appears as its own **"Anthropic CLI"** bucket instead of being
   *  laundered into "Anthropic" by a heuristic that could not express it. */
  byProvider: HubUsageBucket[];
  /** model-identity WP3.3 (D-MI10) — the same spend split PER CREDENTIAL, so two keys of the same kind
   *  are distinguishable and an unpinned (heuristic) bucket is visibly separate from a measured one. */
  byProviderCredential: HubUsageProviderCredentialBucket[];
  byMode: HubUsageBucket[];
  byDay: HubUsageBucket[];
  missions: HubUsageMissionSummary[];
  planAcceptance: HubPlanAcceptanceMetric;
};

// --- Workforce Usage tab (WP0.1, D-HUX10) — group-by rollups + per-entity summaries ---------------
// ADDITIVE wire for the workforce Usage tab (D-HUX10). A rollup groups spend/tokens by one
// {@link HubUsageGroupBy} dimension; `agent`/`crew`/`project` groupings include an explicit
// UNATTRIBUTED "no agent" row so a total is never silently short. Per-entity summaries back the card
// 30-day strip + the profile Usage sub-page.

/**
 * One grouped usage row (D-HUX10): the group key + label + spend/token/session totals for a single
 * bucket under the current {@link HubUsageGroupBy}. `key` is `null` for the explicit UNATTRIBUTED
 * bucket (spend with no owning agent/crew/project — never dropped, D-HUX10); `unattributed` flags that
 * row so the UI can label it "No agent" reliably even where the key would otherwise be ambiguous. The
 * bucket totals reconcile exactly against the range total (WP1.6's sum-of-buckets invariant).
 */
export type HubUsageRow = {
  groupBy: HubUsageGroupBy;
  /** The entity/grouping value — an agent/crew/project id, a model id, or a session mode; `null` marks
   *  the unattributed "no agent" bucket. */
  key: string | null;
  /** What the UI displays (a persona/crew/model/project name, a mode label, or "No agent"). */
  label: string;
  /** True only for the explicit unattributed bucket (agent/crew/project groupings). */
  unattributed?: boolean;
  sessions: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
};

/**
 * A per-ENTITY usage summary (D-HUX10): the rolling totals + a daily strip for one agent/crew (or any
 * {@link HubUsageGroupBy} entity), backing the workforce card's 30-day sparkline and the profile Usage
 * sub-page. `strip` reuses {@link HubUsageBucket} (one bucket per day, `key`/`label` = `YYYY-MM-DD`,
 * oldest→newest, zero-spend days included so the sparkline is evenly spaced).
 */
export type HubUsageSummary = {
  /** Which dimension `id` is keyed on (`agent`/`crew`/…). */
  groupBy: HubUsageGroupBy;
  id: string;
  label: string;
  totals: { sessions: number; costUsd: number; tokensIn: number; tokensOut: number };
  strip: HubUsageBucket[];
};

// --- Context inspector (WP4.1, R-SES7 — "the flagship dogfood surface") ---------------------------
//
// `GET /api/hub/sessions/:id/context` itemizes a session's context window by layer, using the app's
// OWN counters end to end (never a fabricated/guessed number — the same discipline `hub/prompting`'s
// per-section budget gate and the Scans feature's tool-footprint numbers already hold to). Two
// complementary breakdowns ride together: (1) `promptSections` — the §1.8 authored LAYER list
// (`HUB_PROMPT_SECTION_BUDGETS`), assembled with the session's REAL current tool-list/skills-catalog/
// memory/project text so "tools"/"memory"/"project"/"genui" totals include their actual injected
// bodies, not just the authored frame; (2) `tools`/`skills`/`memory`/`project`/`history` — RESOURCE-
// TYPE layers that don't reduce to prose (the granted MCP tool definitions' protocol-level JSON-schema
// cost, eager-resident vs deferred; each attached skill's session-true L1/L2/L3; the memory/project
// body measured on its own; the reconstructed conversation). `memory`/`project`'s bodies are ALSO
// embedded inside `promptSections` (their real content IS the section) — `estimatedTotalTokens` adds
// `promptSections` + `tools.residentTokens` + `skills.totalTokens` + `history.tokens` (tool-definition
// JSON and skill L2/L3 bodies are NOT part of the system-prompt text — they ride the request's other
// fields — so adding them is correct, not double-counting; see `hub/context-inspector.ts`).
//
// This is a snapshot of what the NEXT turn would see (current memory/project/tool/skill state) — a
// PAST turn's exact assembled prompt isn't persisted section-by-section (only its `promptVersion` +
// final `usage` are), so `lastActualTokensIn` (the last settled turn's REAL provider-reported
// `tokensIn`, when any turn has settled) rides alongside as an honest cross-check — never blended into
// `estimatedTotalTokens`.

/** One §1.8 prompt section's measurement — the wire mirror of the API-internal
 *  `HubPromptSectionMeasurement` (`hub/prompting/types.ts`), the SAME numbers the budget gate asserts. */
export type HubContextPromptSection = {
  id: string;
  title: string;
  tokens: number;
  budgetTokens: number;
  withinBudget: boolean;
};

/** One MCP tool's measured protocol-level definition cost (the JSON schema actually sent to the
 *  provider, via the app's own `TokenCounter.countToolDefinition` — R-MCP2's dogfood numbers). */
export type HubContextToolItem = {
  serverId: string;
  serverName: string;
  name: string;
  tokens: number;
};

/** The granted MCP tool-definition layer: `resident` (currently in context) vs `deferred` (name-known,
 *  discoverable via `tool_search`, NOT resident) — `mode`/`totalTokens`/`residentTokens`/
 *  `savingsPercent` are `hub/tools/loading.ts`'s `ToolLoadingResolution`, verbatim. `builtins` lists
 *  the granted first-party tool names only (their schemas are small/fixed and not separately budgeted —
 *  the MCP catalog is where R-MCP2's token story actually plays out). */
export type HubContextToolsLayer = {
  mode: "eager" | "deferred";
  totalTokens: number;
  residentTokens: number;
  savingsPercent: number;
  resident: HubContextToolItem[];
  deferred: HubContextToolItem[];
  builtins: { name: string }[];
  /** hub-fixes WP1.2 (RC3) — whether this snapshot reflects the session's explicit `toolScope`
   *  ("scoped": only its listed servers/tools) or every reachable scanned server ("auto" — the
   *  pre-WP1.2 default, still what an unscoped session gets). Additive/optional so an older
   *  cached/mocked payload (or a builder that hasn't been updated to set it) still parses. */
  scopeMode?: "scoped" | "auto";
  /** hub-fixes WP1.3 (RC3.4) — the LATEST known connection status per server this session has ever
   *  attempted to open (read from its persisted `mcp_server_status` event log at request time) — the
   *  rail's per-server chip data. A server the session has never attempted (or a pre-WP1.3 session) is
   *  simply absent from this list; optional so an older/cached payload still parses. */
  serverStatuses?: HubMcpServerStatusEntry[];
};

/** The attached-skills layer — literally `GET /api/hub/sessions/:id/skills`'s `usage` array (R-SK5's
 *  session-true L1/L2/L3 metering), summed for the inspector's headline number. */
export type HubContextSkillsLayer = {
  usage: HubSkillSessionUsage[];
  totalTokens: number;
};

export type HubContextMemoryLayer = { tokens: number; itemCount: number };
export type HubContextProjectLayer = {
  tokens: number;
  projectId?: string;
  projectName?: string;
} | null;
export type HubContextHistoryLayer = { tokens: number; messageCount: number };

/** `GET /api/hub/sessions/:id/context` (WP4.1, R-SES7). See the section doc above for the shape's
 *  reasoning; `tools`/`skills` are best-effort approximations for an `agent`-kind (mission member)
 *  session — its actual role-level grants can differ from the default "every connected server" set
 *  this snapshot assumes — but are exact for a top-level `chat`/`research`/`mission` session, which is
 *  the v1 (server-level grants only) reality for every top-level session today. */
export type HubContextInspector = {
  sessionId: string;
  model: string;
  contextWindow: number;
  promptSections: HubContextPromptSection[];
  promptTotalTokens: number;
  tools: HubContextToolsLayer;
  skills: HubContextSkillsLayer;
  memory: HubContextMemoryLayer;
  project: HubContextProjectLayer;
  history: HubContextHistoryLayer;
  estimatedTotalTokens: number;
  lastActualTokensIn?: number;
  /** WP1.5 (D-HUX11) — the session's resolved effective memory stack (profile → project → crew →
   *  agent). Additive/optional: every real response carries it (`apps/api/src/hub/context-inspector.ts`
   *  always builds it), but it stays optional here so an older cached/mocked payload still parses. */
  effectiveMemory?: HubEffectiveMemory;
};

// --- Audit timeline (WP4.2, D-AH13, R-UX7) -----------------------------------------------------------

/**
 * GET /api/hub/audit — one row of the global, filterable Audit timeline: a tool call, an approval
 * decision, a mission-agent spawn, or a model call, normalized from `hub_events` (a READ projection —
 * building this list never mutates the append-only log). `tool_call`/`approval` rows MERGE the
 * initiating event (`tool_call`/`approval_requested`) with its settled counterpart
 * (`tool_result`/`approval_responded`) by `toolCallId`, exactly like `use-hub-stream.ts`'s
 * `buildHubTimeline` does client-side for the transcript — one row per real-world action, not one per
 * raw event.
 *
 * `annotations` (readOnlyHint/destructiveHint/idempotentHint/openWorldHint) rides along on every
 * `tool_call`/`approval` row so the timeline can label an irreversible external write inline (R-UX7's
 * "irreversible external writes labeled at approval time"); the R-UX7 undo HALF (artifact-version
 * revert, memory delete, workspace-snapshot restore) is already live where those actions happen
 * (`ArtifactCanvas`'s revert button, `ScopedMemoryList`'s delete, the meta rail Outputs section's
 * snapshot Restore action) — this view's own contribution is visibility + the deep link back to where
 * that undo lives.
 *
 * `rootSessionId` is the session id the Audit view's deep link actually opens: the row's own
 * `sessionId` for a `chat` session, or that session's `parentSessionId` for an `agent` (mission-member)
 * session — mission-level events (`agent_spawned` etc.) are themselves already logged on the PARENT
 * session (`hub/missions/orchestrator.ts` appends them to `mission.sessionId` directly, never to the
 * child), so only `tool_call`/`approval`/`model_call` rows that happened INSIDE a mission member's own
 * turn need this redirect — the app has no standalone per-agent transcript view yet, so the mission
 * board on the parent session (where that agent's card lives) is the honest landing spot.
 */
export type HubAuditEntry = {
  /** Stable row key — the toolCallId for `tool_call`/`approval` rows, the raw event id otherwise. */
  id: string;
  kind: HubAuditKind;
  /** The initiating event's timestamp (ISO). */
  at: string;
  /** When the settled counterpart (`tool_result`/`approval_responded`) arrived, if it has. */
  settledAt?: string;
  sessionId: string;
  sessionKind: HubSessionKind;
  sessionTitle: string;
  rootSessionId: string;
  missionId?: string | null;
  /** The settled `assistant_message` this row's turn belongs to, when resolvable — the Audit view's
   *  transcript deep-link anchor for a `chat`-kind `rootSessionId`. */
  messageId?: string;

  // tool_call / approval
  toolCallId?: string;
  toolName?: string;
  source?: HubToolSource;
  serverId?: string;
  annotations?: HubToolAnnotations;

  // tool_call
  state?: "pending" | "output-available" | "output-error" | "output-denied";
  isError?: boolean;

  // approval
  resolution?: HubApprovalResolution | "pending";
  isAutomatic?: boolean;
  autonomy?: HubAutonomyLevel;

  // spawn
  agentSessionId?: string;
  roleName?: string;

  // spawn + model_call
  model?: string;

  // model_call
  usage?: HubUsage;
  costUsd?: number;
  costBasis?: SessionCostBasis;
  finishReason?: string;
};

/** GET /api/hub/audit's page envelope — newest-first; `nextBefore` (the opaque cursor of the last row)
 *  is present only when more rows exist behind it. */
export type HubAuditPage = { entries: HubAuditEntry[]; nextBefore?: string };

// --- Advisor — evidenced recommendations (WP 1.1) ---------------------------------------------
// planning/Roadmap/RM-01-advisor/. Deterministic, versioned advice derived from persisted measurements. The app
// NEVER auto-applies any of this: a report is a set of suggestions, each carrying the entities it
// was derived from, the assumptions it rests on, and — where it claims a saving — an explicitly
// labeled estimate plus the basis to reproduce that number by hand.

export type AdvisorScopeKind = (typeof ADVISOR_SCOPE_KINDS)[number];
export type AdvisorEvidenceKind = (typeof ADVISOR_EVIDENCE_KINDS)[number];
export type AdvisorSeverity = (typeof ADVISOR_SEVERITIES)[number];
export type AdvisorSavingsUnit = (typeof ADVISOR_SAVINGS_UNITS)[number];

/** What a report was computed over. `id` is the server/scenario id; the `fleet` scope carries none. */
export type AdvisorScope = {
  kind: AdvisorScopeKind;
  id?: string;
};

/** A typed pointer at a real, persisted entity a finding was derived from — enough for the UI to
 *  render a drill-through link without a second lookup. `label` is display text only (a server or
 *  tool name); `id` is the entity's real primary key. */
export type AdvisorEvidenceRef = {
  kind: AdvisorEvidenceKind;
  id: string;
  label: string;
};

/** An estimate envelope. `estimate` is the literal `true` — a savings number is ALWAYS an estimate
 *  here and is labeled as one in the type itself, never inferred from context — and `basis` states
 *  in one line how the number was computed, so an operator can reproduce it by hand from the cited
 *  evidence (README invariant: "estimates are labeled ... and reproducible from the cited inputs"). */
export type AdvisorSavings = {
  value: number;
  unit: AdvisorSavingsUnit;
  /** Always `true`: the advisor never publishes a savings figure as a measurement. */
  estimate: true;
  /** How `value` was arrived at, e.g. "sum of the 12 never-called tools' definition tokens". */
  basis: string;
};

/** One evidenced suggestion. `id` is the STABLE dedup key across rules and across reports (the same
 *  finding computed twice must produce the same id); `ruleId` is the rule that emitted it. */
export type AdvisorRecommendation = {
  id: string;
  ruleId: string;
  title: string;
  detail: string;
  severity: AdvisorSeverity;
  /** Present only when the rule can name a defensible estimate AND its basis. */
  savings?: AdvisorSavings;
  /** At least one — a recommendation with nothing to drill into is a contract violation. */
  evidence: AdvisorEvidenceRef[];
  /**
   * WP 2.1 — the grade-side provenance (`GRADING_VERSION` + the suite-run ids read). REQUIRED of a
   * grade-aware rule (the engine refuses the finding without it) and absent on every deterministic
   * Phase 1 rule, which reads no grades at all. See {@link AdvisorGradeProvenance}.
   */
  gradeProvenance?: AdvisorGradeProvenance;
  /** What the suggestion takes for granted, stated plainly (e.g. "the last 20 runs are
   *  representative of normal use"). May be empty when a rule genuinely assumes nothing. */
  assumptions: string[];
};

/** An honest gap: the rule applied to this scope but could not run, and says exactly what was
 *  missing. Never a guess, never a zero passed off as a measurement (README invariant 3). */
export type AdvisorInsufficientData = {
  ruleId: string;
  reason: string;
};

/** The advisor's read-model response. Deterministic: the same inputs under the same
 *  `advisorVersion` produce a byte-identical report, including the ordering of both arrays. */
export type AdvisorReport = {
  /** `ADVISOR_VERSION` — reports from different versions are never silently compared. */
  advisorVersion: number;
  /** ISO-8601 timestamp from the engine's injected clock. */
  generatedAt: string;
  scope: AdvisorScope;
  recommendations: AdvisorRecommendation[];
  insufficientData: AdvisorInsufficientData[];
};

/** Query for `GET /api/advisor/report` (WP 1.2). `id` names the server/environment a scoped report
 *  is computed over and is ABSENT for `fleet`. The zod partner rejects BOTH a missing id on a scoped
 *  request and a stray id on a fleet one, so a caller can never get back a report over something
 *  other than what they asked for. */
export type AdvisorReportQuery = {
  scope: AdvisorScopeKind;
  id?: string;
};

// --- Advisor — grade-aware provenance (WP 2.1) ------------------------------------------------
// planning/Roadmap/RM-01-advisor/phase-2-grade-aware/. A Phase 2 rule reads GRADES, which are themselves versioned
// and derived from specific suite runs. Recording both on the finding is what lets an operator (and
// a later report) tell "this trim was validated against suite run X under grading version 1" apart
// from "this trim rests on a newer, differently-computed grade" — the never-silently-compare rule
// `ADVISOR_VERSION` / `TOKEN_COUNTING_VERSION` / `GRADING_VERSION` all follow.

/**
 * The grade-side provenance of one grade-aware recommendation.
 *
 * `suiteRunIds` are the EXACT suite runs whose members supplied the scores the finding rests on —
 * ascending and deduped, so the same finding computed twice serializes identically. It is never
 * empty: a rule with no suite-run evidence has nothing to be grade-aware ABOUT, and must emit an
 * {@link AdvisorInsufficientData} entry instead of a recommendation.
 */
export type AdvisorGradeProvenance = {
  /** `GRADING_VERSION` at the time the grades were written/read. */
  gradingVersion: number;
  /** The suite runs read, ascending + deduped. Always at least one. */
  suiteRunIds: string[];
};

// --- Advisor — fleet report (WP 2.2) ----------------------------------------------------------
// The aggregate, on-demand report behind `GET /api/reports/fleet/{json,markdown}`: what the fleet
// looks like right now (servers + scan drift, environment costs, suite grades, a posture summary
// when one exists) with the fleet-scope `AdvisorReport` attached.
//
// THE HONEST-GAP RULE (README invariant 3) is encoded structurally: every section carries an
// optional `gap`, and a section with nothing in it ALWAYS carries one naming what is missing. A
// zero is never published as a measurement — "no runs yet" and "runs that cost $0.00" are different
// facts, and the report says which one it is.

/** A scan as the fleet report cites it — identity plus the totals a drift figure is read from. */
export type FleetScanRef = {
  scanId: string;
  scannedAt: string;
  tokenProfile: TokenProfileId;
  /** `TOKEN_COUNTING_VERSION` this scan was produced under (CLAUDE.md §7). */
  countingVersion: number;
  totalTools: number;
  totalTokens: number;
};

/** How a server's tool surface moved between its two most recent SUCCESSFUL scans (`previousScan`
 *  → the entry's `latestScan`). Computed with the same matcher the Compare workspace uses. */
export type FleetServerDrift = {
  previousScan: FleetScanRef;
  /** Tools present only in the newer scan. */
  toolsAdded: number;
  /** Tools present only in the older scan. */
  toolsRemoved: number;
  /** Matched tools whose description, schema or annotations changed. */
  toolsChanged: number;
  /**
   * Newer − older on the scan totals, and the same as a percentage of the older total. BOTH are
   * `null` when the two scans are not on a comparable counting scale (different token profile or
   * counting version) — a suppressed delta is reported as absent, never as a `0` that would read as
   * "nothing changed".
   */
  deltaTokens: number | null;
  deltaPercent: number | null;
  /** False → the two token deltas above are `null`, and why. */
  deltasComparable: boolean;
};

/** One registered MCP server in the fleet, with its latest measured footprint and its drift. */
export type FleetServerEntry = {
  serverId: string;
  serverName: string;
  transport: TransportType;
  /** The most recent SUCCESSFUL scan, or `null` when the server has never been scanned cleanly. */
  latestScan: FleetScanRef | null;
  /** Present only when the server has at least two successful scans to compare. */
  drift: FleetServerDrift | null;
  /** Names what is missing whenever `latestScan` or `drift` is `null`. */
  gap?: string;
};

export type FleetServersSection = {
  entries: FleetServerEntry[];
  /** Present when there is nothing to report at all (no servers configured). */
  gap?: string;
};

/**
 * One environment's (UI label for a `Scenario`) measured spend.
 *
 * Billed and subscription-reference costs are kept in SEPARATE fields and are never added together:
 * a `claude_subscription` run's `costUsd` is a shadow reference price (exact tokens × list price),
 * not a charge anyone paid (see `SUBSCRIPTION_COST_FOOTNOTE`), so one total spanning both would be a
 * number that means nothing.
 */
export type FleetEnvironmentEntry = {
  scenarioId: string;
  name: string;
  model: string;
  toolLoadingMode: ToolLoadingMode;
  /** Every persisted run of this environment — cost accrues on failed and stopped runs too. */
  runs: number;
  /** How many of `runs` reached `completed`. */
  completedRuns: number;
  /** Sum of `costUsd` over runs billed through a provider key. */
  billedCostUsd: number;
  billedRuns: number;
  /** `billedCostUsd / billedRuns`, or `null` when no run was billed. */
  meanBilledCostUsd: number | null;
  /** Sum of `costUsd` over Claude-subscription runs — a REFERENCE price, never a billed charge. */
  subscriptionReferenceCostUsd: number;
  subscriptionReferenceRuns: number;
  tokensIn: number;
  tokensOut: number;
  /** Present when the environment has no runs at all (so every figure above is a structural zero). */
  gap?: string;
};

export type FleetEnvironmentsSection = {
  entries: FleetEnvironmentEntry[];
  /** Present when no environment is configured, or none has ever been run. */
  gap?: string;
};

/** One executed suite run and the grades it produced, read straight off its persisted aggregates. */
export type FleetSuiteEntry = {
  suiteRunId: string;
  /** The owning saved suite — absent for a `collection`/`adhoc` plan, which creates no suite row. */
  suiteId?: string;
  /** The suite's name, or a plain description of the plan when there is no saved suite. */
  label: string;
  source?: RunPlanSource;
  status: SuiteRunStatus;
  startedAt: string;
  endedAt?: string;
  cellsTotal: number;
  cellsCompleted: number;
  meanGrade: number | null;
  gradeStdDev: number | null;
  passRateAt05: number | null;
  totalTokens: number;
  execCostUsd: number;
  judgeCostUsd: number;
  /** Present when the run carries no aggregates, or aggregates with no graded score. */
  gap?: string;
};

export type FleetSuitesSection = {
  /** Most recent first, capped at `FLEET_REPORT_SUITE_RUN_LIMIT`. */
  entries: FleetSuiteEntry[];
  /** How many suite runs exist in total, so a truncated list never reads as the whole history. */
  totalSuiteRuns: number;
  /** Present when no suite run exists, or none of the listed runs produced a grade. */
  gap?: string;
};

/**
 * A security-posture roll-up, if some analyzer produced one.
 *
 * The analyzer itself is `planning/Roadmap/RM-20-security-posture/` and is NOT built yet, so today this section
 * always renders its gap. The shape is deliberately generic (a version stamp, an optional score,
 * severity tallies, per-subject rows) — enough for the report to render a summary, and small enough
 * that the security-posture plan's own contract (its WP 1.1) can feed it without this file having
 * pre-committed to findings vocabulary it does not own.
 */
export type FleetPostureSubject = {
  kind: "server" | "skill";
  id: string;
  name: string;
  /** The subject's own posture score, or `null` when the analyzer produced none. */
  score: number | null;
  findings: number;
};

export type FleetPostureSummary = {
  /** The analyzer version this summary was produced under — never mixed across versions. */
  analyzerVersion: number;
  /** The fleet-wide score, or `null` when the analyzer produced none. */
  score: number | null;
  /** Finding tallies by the analyzer's own severity labels, in the analyzer's own order. */
  findingCounts: { severity: string; count: number }[];
  subjects: FleetPostureSubject[];
};

export type FleetPostureSection = {
  /** `null` whenever no posture analyzer has produced a summary — then `gap` says so. */
  summary: FleetPostureSummary | null;
  gap?: string;
};

/** The fleet-scope `AdvisorReport`, verbatim — the same document `GET /api/advisor/report?scope=fleet`
 *  returns, so the two surfaces can never disagree. Rules registered later (WP 2.1's grade-aware
 *  ones) flow in automatically; nothing here names a rule id. */
export type FleetAdvisorSection = {
  report: AdvisorReport;
  /** Present when the advisor produced neither a recommendation nor an honest gap. */
  gap?: string;
};

/** `GET /api/reports/fleet/json`. The Markdown twin renders exactly this — no second data path. */
export type FleetReport = {
  /** `ADVISOR_VERSION` — fleet reports from different advisor versions are never silently compared. */
  advisorVersion: number;
  /** ISO-8601, from the advisor context's injected clock (so the whole report is one instant). */
  generatedAt: string;
  servers: FleetServersSection;
  environments: FleetEnvironmentsSection;
  suites: FleetSuitesSection;
  posture: FleetPostureSection;
  advisor: FleetAdvisorSection;
};
