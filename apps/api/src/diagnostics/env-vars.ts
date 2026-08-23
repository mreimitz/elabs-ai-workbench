import type { DiagnosticsEnvStatus, DiagnosticsEnvVar } from "@mcp-token-footprint/shared";

// ==================================================================================================
// The recognised-environment-variable catalogue — planning/Roadmap/RM-18-platform/ WP 1.3
// ==================================================================================================
//
// This file is the reason the diagnostics bundle's secret-freedom is an argument about STRUCTURE
// rather than about a regex. The bundle never enumerates `process.env`; it walks THIS list and asks
// one question per name — "is it there?" — so there is no code path from a variable's VALUE into the
// document at all. Nothing is truncated, hashed or fingerprinted, because nothing is read.
//
// `defaulted` is the only judgement call in here, and it is mechanical: a variable read through
// `??`, through one of `config/env.ts`'s `readX(value, fallback)` helpers, or through a boolean
// comparison with an implied fallback (`=== "true"` / `!== "false"`) has a built-in default, so its
// absence is normal. A variable read bare — `process.env.X`, or `process.env.X?.trim() || undefined`
// — has none, so its absence means the thing it configures is genuinely OFF. That distinction is
// what makes the group diagnostic: a missing `MCP_SECRET_KEY` is a fact, a missing `PORT` is not.
//
// The list is kept honest by `apps/api/test/diagnostics.test.ts`, which reads `config/env.ts` and
// fails if the two disagree in either direction. A new env knob therefore cannot quietly become an
// unreported one, and a removed knob cannot linger here as a phantom.

/** One recognised variable: its name, and whether the app has a fallback when it is absent. */
export type RecognisedEnvVar = {
  name: string;
  /** True when `config/env.ts` supplies a built-in default for an absent value. */
  defaulted: boolean;
};

/**
 * Every variable `apps/api/src/config/env.ts` reads, in sorted order so the bundle is byte-stable
 * across builds. Values are NEVER read from this list — only membership and `defaulted`.
 */
export const RECOGNISED_ENV_VARS: readonly RecognisedEnvVar[] = [
  { name: "API_AUTH_REQUIRED", defaulted: true },
  // RM-17 Phase 6 (AM-OB13) — the deployment's own externally-reachable base URL, used ONLY to make
  // a link in an outbound webhook payload absolute. No fallback BY DESIGN (`config/env.ts`'s
  // `readBaseUrl` returns undefined rather than guessing an origin), so its absence is a real fact
  // about this deployment: outbound links go out as app-relative paths.
  { name: "APP_BASE_URL", defaulted: false },
  { name: "ASSISTANT_AUTO_TITLE", defaulted: true },
  { name: "ASSISTANT_DATA_DIR", defaulted: true },
  { name: "ASSISTANT_IDLE_TIMEOUT_MS", defaulted: true },
  { name: "ASSISTANT_MAX_ACTIVE_SESSIONS", defaulted: true },
  { name: "ASSISTANT_MAX_TURNS", defaulted: true },
  { name: "ASSISTANT_MODEL_ROSTER", defaulted: true },
  { name: "ASSISTANT_PERMISSION_TIMEOUT_MS", defaulted: true },
  { name: "ASSISTANT_RELEASE_GRACE_MS", defaulted: true },
  { name: "ASSISTANT_SESSION_RETENTION_DAYS", defaulted: true },
  { name: "ASSISTANT_SKILL_AUTHORING_DIR", defaulted: true },
  { name: "ASSISTANT_TITLE_MODEL", defaulted: true },
  { name: "ASSISTANT_TITLE_TIMEOUT_MS", defaulted: true },
  { name: "ATTACHMENTS_DIR", defaulted: true },
  { name: "AUTO_RATING_ENABLED", defaulted: true },
  { name: "AUTO_RATING_MAX_CONCURRENCY", defaulted: true },
  { name: "COLLECTIONS_DIR", defaulted: true },
  { name: "DATABASE_PATH", defaulted: true },
  { name: "DATA_DIR", defaulted: true },
  // RM-38 WP 3.1 — the startup reference-data-pack refresh. All three are defaulted: absent means
  // "check the published release asset with a 5 s per-request bound", which is the shipped
  // behaviour, not an off switch. DATA_PACK_URL set to the EMPTY STRING is the off switch, and this
  // group cannot distinguish that from unset — it reports presence, never a value. Said here
  // because an operator reading "DATA_PACK_URL: set" and expecting a fetch would be misled.
  { name: "DATA_PACK_CHECK_ON_START", defaulted: true },
  { name: "DATA_PACK_TIMEOUT_MS", defaulted: true },
  { name: "DATA_PACK_URL", defaulted: true },
  { name: "DEFAULT_TOKEN_PROFILE", defaulted: true },
  { name: "DOCKER_MODE", defaulted: true },
  { name: "HOST", defaulted: true },
  { name: "HUB_AGENT_RUNNER", defaulted: true },
  { name: "HUB_AUTONOMY_ASK_ABOVE_AGENTS", defaulted: true },
  { name: "HUB_AUTONOMY_ASK_ABOVE_USD", defaulted: true },
  { name: "HUB_AUTO_TITLE", defaulted: true },
  { name: "HUB_COMPACTION_KEEP_RECENT_TURNS", defaulted: true },
  { name: "HUB_COMPACTION_THRESHOLD_FRACTION", defaulted: true },
  { name: "HUB_DEFAULT_AUTONOMY", defaulted: true },
  { name: "HUB_FILE_MAX_BYTES", defaulted: true },
  { name: "HUB_GENUI_MAX_REPAIR_ATTEMPTS", defaulted: true },
  { name: "HUB_MAX_ACTIVE_SESSIONS", defaulted: true },
  { name: "HUB_MCP_OUTPUT_MAX_TOKENS", defaulted: true },
  { name: "HUB_MCP_OUTPUT_WARN_TOKENS", defaulted: true },
  { name: "HUB_MISSION_AGENT_MAX_DURATION_S", defaulted: true },
  { name: "HUB_MISSION_APPROVAL_TIMEOUT_S", defaulted: true },
  { name: "HUB_MISSION_DEFAULT_BUDGET_USD", defaulted: true },
  // No fallback: `process.env.X?.trim() || undefined`. Absent means the Hub uses the session model.
  { name: "HUB_MISSION_EXTRACTION_MODEL", defaulted: false },
  { name: "HUB_MISSION_EXTRACTION_TIMEOUT_S", defaulted: true },
  { name: "HUB_MISSION_MAX_AGENTS", defaulted: true },
  { name: "HUB_MISSION_MAX_BUDGET_USD", defaulted: true },
  { name: "HUB_MISSION_MAX_DEPTH", defaulted: true },
  { name: "HUB_MISSION_MAX_PARALLEL", defaulted: true },
  { name: "HUB_MISSION_MAX_TOTAL_AGENTS", defaulted: true },
  // No fallback — same shape as HUB_MISSION_EXTRACTION_MODEL.
  { name: "HUB_MISSION_SYNTHESIS_MODEL", defaulted: false },
  { name: "HUB_PROJECT_CONTEXT_MAX_CHARS", defaulted: true },
  { name: "HUB_SEARCH_DUCKDUCKGO", defaulted: true },
  // The three search-provider knobs and the SearxNG URL have no fallback: absent means that
  // provider is simply not wired. Two of them are API KEYS, which is precisely why this file
  // records only whether they are present.
  { name: "HUB_SEARCH_SERPER_KEY", defaulted: false },
  { name: "HUB_SEARCH_TAVILY_KEY", defaulted: false },
  { name: "HUB_SEARXNG_URL", defaulted: false },
  { name: "HUB_SESSION_IDLE_RELEASE_MS", defaulted: true },
  { name: "HUB_SESSION_RETENTION_DAYS", defaulted: true },
  { name: "HUB_SKILL_COMPACTION_TOKENS_PER_SKILL", defaulted: true },
  { name: "HUB_SKILL_COMPACTION_TOKENS_TOTAL", defaulted: true },
  { name: "HUB_SKILL_ENTRY_MAX_CHARS", defaulted: true },
  { name: "HUB_SKILL_LISTING_BUDGET_FRACTION", defaulted: true },
  { name: "HUB_SYNTHESIS_MODE", defaulted: true },
  { name: "HUB_TOOL_EAGER_MAX_TOKENS", defaulted: true },
  { name: "HUB_TOOL_LOADING_DEFAULT", defaulted: true },
  { name: "HUB_TOOL_PROMOTE_MAX_TOKENS", defaulted: true },
  { name: "HUB_TOOL_SEARCH_AUTO_FRACTION", defaulted: true },
  { name: "HUB_WEB_TOOLS", defaulted: true },
  { name: "HUB_WS_MAX_FILE_BYTES", defaulted: true },
  { name: "ISSUE_ASSIST_AFTER_SWEEP", defaulted: true },
  { name: "ISSUE_ASSIST_MAX_CONCURRENCY", defaulted: true },
  // The encryption key itself (`secretKey: process.env.MCP_SECRET_KEY`). No fallback — absent means
  // the API generates/reads `DATA_DIR/mcp-secret.key` instead, which is a real thing to know in a
  // bug report and is knowable from `set`/`unset` alone.
  { name: "MCP_SECRET_KEY", defaulted: false },
  { name: "MCP_SECRET_KEY_PATH", defaulted: true },
  { name: "OAUTH_REDIRECT_URL", defaulted: true },
  { name: "PORT", defaulted: true },
  { name: "SCAN_RETENTION_PER_SERVER", defaulted: true },
  { name: "SKILL_MAX_FILES", defaulted: true },
  { name: "SKILL_MAX_FILE_BYTES", defaulted: true },
  { name: "SKILL_MAX_TOTAL_BYTES", defaulted: true },
  { name: "SKILL_QUALITY_L1_TOKEN_CEILING", defaulted: true },
  { name: "SKILL_QUALITY_L2_TOKEN_CEILING", defaulted: true },
  { name: "SUBSCRIPTION_RUNS_MAX_CONCURRENCY", defaulted: true },
  { name: "WEB_DIST_PATH", defaulted: true },
  // npm-injected rather than operator-set, but `config.appVersion` reads it, so it is recognised and
  // the drift test would fail if it were left out.
  { name: "npm_package_version", defaulted: true },
];

/**
 * Classify one recognised variable WITHOUT reading its value.
 *
 * `env[name]` is touched exactly once, and only to ask whether it is present and non-blank. The
 * value is never returned, never stored and never compared to anything — the boolean is the whole
 * output. A blank-but-present variable counts as absent, matching how `config/env.ts`'s own
 * `readString`/`readPositiveInt` helpers treat `""`.
 */
export function classifyEnvVar(
  entry: RecognisedEnvVar,
  env: NodeJS.ProcessEnv = process.env,
): DiagnosticsEnvStatus {
  const present = (env[entry.name] ?? "").trim().length > 0;
  if (present) return "set";
  return entry.defaulted ? "default" : "unset";
}

/** The bundle's whole environment group: `{ name, status }` per recognised variable, nothing else. */
export function buildEnvironmentGroup(env: NodeJS.ProcessEnv = process.env): DiagnosticsEnvVar[] {
  return RECOGNISED_ENV_VARS.map((entry) => ({
    name: entry.name,
    status: classifyEnvVar(entry, env),
  }));
}
