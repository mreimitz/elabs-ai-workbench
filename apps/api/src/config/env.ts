import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSISTANT_DEFAULT_AUTO_TITLE,
  ASSISTANT_DEFAULT_MODEL_ROSTER,
  ASSISTANT_DEFAULT_PERMISSION_TIMEOUT_MS,
  ASSISTANT_DEFAULT_RELEASE_GRACE_MS,
  ASSISTANT_DEFAULT_TITLE_MODEL,
  ASSISTANT_DEFAULT_TITLE_TIMEOUT_MS,
  DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING,
  DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING,
  DEFAULT_TOKEN_PROFILE,
  type HubAutonomyLevel,
  HUB_AUTONOMY_LEVELS,
  HUB_FILE_MAX_BYTES,
  HUB_MISSION_MAX_DEPTH,
  HUB_MISSION_MAX_TOTAL_AGENTS,
  HUB_WS_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_TOTAL_BYTES,
  type ToolLoadingMode,
  TOOL_LOADING_MODES,
  type TokenProfileId,
  TOKEN_PROFILES,
} from "@mcp-token-footprint/shared";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function readTokenProfile(value: string | undefined): TokenProfileId {
  if (value && (TOKEN_PROFILES as readonly string[]).includes(value)) {
    return value as TokenProfileId;
  }

  return DEFAULT_TOKEN_PROFILE;
}

const dataDirectory = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, "data"));

/** Parse a positive-integer env override; fall back to the shared-constant default otherwise. */
function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Parse a non-negative-integer env override (0 allowed, e.g. "disabled"); fall back otherwise. */
function readNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** Parse a boolean env override (`true/1/yes/on` vs `false/0/no/off`, case-insensitive); fall back otherwise. */
function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/** Parse a non-empty trimmed string env override; fall back to the given default otherwise. */
function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Parse the deployment's own base URL (RM-17 Phase 6, AM-OB13) — the origin the app is reachable at
 * from OUTSIDE itself, used to make a link in an OUTBOUND payload openable.
 *
 * Deliberately has NO fallback. There is no honest way to guess it: `HOST`/`PORT` describe the
 * socket the process binds, not the address a Slack message's reader can reach, and `127.0.0.1` in
 * a ticket is worse than a bare path because it looks clickable and is not. A value that is not an
 * absolute `http(s)` URL is treated as ABSENT for the same reason — a half-typed origin would
 * fabricate a wrong link rather than fall back to the honest relative one.
 */
function readBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  // Normalize away a trailing slash so the ONE joiner (`watch/outbound-link.ts`) never produces `//`.
  return trimmed.replace(/\/+$/, "");
}

/** Parse a Hub tool-loading PREFERENCE env override (`eager`/`deferred`/`auto`); fall back to `auto`
 *  (WP1.1 / D-HF1 — the flipped default: eager under the token threshold, deferred-with-promotion
 *  above). `auto` is the Hub-internal `HubToolLoadingPreference` superset of the wire `ToolLoadingMode`,
 *  collapsed to a real mode by `hub/tools/loading.ts` — see the `hubToolLoadingDefault` field's doc. */
export function readHubToolLoadingPreference(value: string | undefined): ToolLoadingMode | "auto" {
  if (value && ((TOOL_LOADING_MODES as readonly string[]).includes(value) || value === "auto")) {
    return value as ToolLoadingMode | "auto";
  }
  return "auto";
}

/** hub-fixes WP2.1 (D-HF7) — parse the mission agent-runner rollback seam `HUB_AGENT_RUNNER`
 *  (`session`/`structured`); default `session` (the new turn-engine-based runner). `structured` keeps the
 *  old one-shot `generateObject` runner wired for one release. Anything else falls back to `session`. */
export function readHubAgentRunner(value: string | undefined): "session" | "structured" {
  return value === "structured" ? "structured" : "session";
}

/** hub-fixes WP3.2 (D-HF4) — parse the mission-synthesis path `HUB_SYNTHESIS_MODE` (`turn`/`text`);
 *  default `turn` (the synthesis runs as a REAL turn of the parent session, so the final answer can use
 *  the GenUI `present` widgets). `text` keeps the pre-fix tool-less `generateText` synthesis wired for one
 *  release (a byte-compatible fallback the turn path ALSO falls back to on any failure). Anything else ⇒
 *  `turn`. */
export function readHubSynthesisMode(value: string | undefined): "turn" | "text" {
  return value === "text" ? "text" : "turn";
}

/** Parse a `HubAutonomyLevel` env override (`always_ask`/`threshold`/`auto`); fall back to the safe
 *  `always_ask` (WP2.3, D-AH6) — the dial governs live HITL tool-approval gating. */
function readAutonomyLevel(value: string | undefined): HubAutonomyLevel {
  if (value && (HUB_AUTONOMY_LEVELS as readonly string[]).includes(value)) {
    return value as HubAutonomyLevel;
  }
  return "always_ask";
}

/** Parse a `(0, 1]` fraction env override; fall back otherwise. Used for the Hub's tool-search `auto`
 *  heuristic threshold (a fraction of the model's context window). */
function readFraction(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

/** Parse a positive-float env override (e.g. a USD budget); fall back otherwise. Used for the Hub's
 *  mission cost caps / autonomy dollar thresholds (`HUB_MISSION_DEFAULT_BUDGET_USD`, etc.). */
function readPositiveFloat(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse a comma-separated env override into a trimmed, non-empty string list; fall back otherwise. */
function readStringList(value: string | undefined, fallback: readonly string[]): string[] {
  if (value === undefined || value.trim() === "") return [...fallback];
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : [...fallback];
}

export const config = {
  appVersion: process.env.npm_package_version ?? "0.1.0",
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8080),
  dataDirectory,
  databasePath: path.resolve(process.env.DATABASE_PATH ?? path.join(dataDirectory, "app.sqlite")),
  // Testing-feature multimodal attachments. Defaults under DATA_DIR so they persist on the same
  // /data volume as the DB + secret key in Docker. NOTE: provider API keys are intentionally NOT
  // read from env — they live encrypted in the DB via the UI (apps/api/src/providers). Per-model
  // pricing for the cost KPI/spend cap is maintained in code at apps/api/src/providers/pricing.ts.
  attachmentsDir: path.resolve(
    process.env.ATTACHMENTS_DIR ?? path.join(dataDirectory, "attachments"),
  ),
  // Benchmarks (WP 4.2, B11) — base dir for per-collection git working clones (`<collectionsDir>/<id>`).
  // Under DATA_DIR so clones live on the same persistent /data volume in Docker and NEVER inside the
  // repo tree. Each collection's clone is created on first sync and re-cloned on corruption.
  collectionsDir: path.resolve(
    process.env.COLLECTIONS_DIR ?? path.join(dataDirectory, "collections"),
  ),
  secretKeyPath: path.resolve(
    process.env.MCP_SECRET_KEY_PATH ?? path.join(dataDirectory, "mcp-secret.key"),
  ),
  secretKey: process.env.MCP_SECRET_KEY,
  oauthRedirectUrl:
    process.env.OAUTH_REDIRECT_URL ??
    `http://127.0.0.1:${Number(process.env.PORT ?? 8080)}/api/oauth/callback`,
  /**
   * RM-17 Phase 6 (AM-OB13) — the base URL this deployment is reachable at from outside itself
   * (e.g. `http://localhost:8081`). Used ONLY to turn an app path into an absolute URL in an
   * OUTBOUND payload (a webhook body). `undefined` when unset or unparseable, and every consumer
   * then emits the app-relative path unchanged — see `apps/api/src/watch/outbound-link.ts`.
   *
   * NOT derived from `oauthRedirectUrl` above, even though that one carries an origin: its default
   * is a loopback address the app invented for itself, and inheriting it would silently put
   * `http://127.0.0.1:8080/...` into somebody else's ticket.
   */
  appBaseUrl: readBaseUrl(process.env.APP_BASE_URL),
  webDistPath: path.resolve(
    process.env.WEB_DIST_PATH ?? path.join(repoRoot, "apps", "web", "dist"),
  ),
  defaultTokenProfile: readTokenProfile(process.env.DEFAULT_TOKEN_PROFILE),
  // Skills-registry ingest caps (zip-bomb / oversized-tree guard). Enforced on BOTH the upload and
  // GitHub ingestion paths; env overrides fall back to the shared-constant defaults. Skill content
  // is never executed — see apps/api/src/skills/caps.ts and .claude/rules/mcp-and-security.md.
  skillMaxFileBytes: readPositiveInt(process.env.SKILL_MAX_FILE_BYTES, SKILL_MAX_FILE_BYTES),
  skillMaxTotalBytes: readPositiveInt(process.env.SKILL_MAX_TOTAL_BYTES, SKILL_MAX_TOTAL_BYTES),
  skillMaxFiles: readPositiveInt(process.env.SKILL_MAX_FILES, SKILL_MAX_FILES),
  // Skill IDE quality engine (WP 4.1, I4) token-budget ceilings — the L1 (metadata) and L2 (body)
  // levels above which the quality engine raises an `l1-budget`/`l2-budget` warning. Env overrides
  // fall back to the shared-constant defaults (500 / 5000), the SKILL_MAX_* pattern.
  skillQualityL1TokenCeiling: readPositiveInt(
    process.env.SKILL_QUALITY_L1_TOKEN_CEILING,
    DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING,
  ),
  skillQualityL2TokenCeiling: readPositiveInt(
    process.env.SKILL_QUALITY_L2_TOKEN_CEILING,
    DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING,
  ),
  // Retention (issue #19): "keep last N scans per server". 0 = disabled (keep everything) — the
  // default, so retention is opt-in and never silently discards history. When > 0, a successful scan
  // prunes older scans for that server (apps/api/src/scans/service.ts) and the maintenance endpoint
  // can prune on demand across all servers.
  scanRetentionPerServer: readNonNegativeInt(process.env.SCAN_RETENTION_PER_SERVER, 0),
  // Service tokens (planning/Roadmap/RM-08-ci/ WP 1.1, D-C2) — force token auth on LOOPBACK too. Default false: a
  // request from 127.0.0.0/8 / ::1 passes exactly as it did before service tokens existed, so the
  // browser UI on the host is unaffected. A request from any OTHER address always requires a valid
  // `Authorization: Bearer mcpfp_…` regardless of this setting — that part is not configurable.
  // Turning this on locks the host's own browser out too (it presents no token), which also makes
  // Settings › API tokens unreachable, since a token may never manage tokens: mint the tokens you
  // need first, then switch this on. See apps/api/src/api-tokens/guard.ts.
  apiAuthRequired: readBoolean(process.env.API_AUTH_REQUIRED, false),
  // Assistant (planning/Roadmap/RM-02-assistant/, WP 0.3) — the embedded Claude agent chat. All agent state
  // (SDK CLAUDE_CONFIG_DIR, HOME, materialized skill workspaces) lives under this dir so it
  // persists on the same /data volume as the DB in Docker and never touches the operator's real
  // ~/.claude state. See apps/api/src/assistant/spawn-env.ts for how it's used to build the SDK
  // child process env.
  assistantDataDir: path.resolve(
    process.env.ASSISTANT_DATA_DIR ?? path.join(dataDirectory, "assistant"),
  ),
  // Refinement R1 (WP R1.2, D-AS20/D-AS21) — the bundled, read-only skill-authoring reference
  // directory added to a skill-scoped session's `additionalDirectories` (session-manager.ts's
  // `startSession`). Resolved relative to THIS MODULE (via `packageRoot`, computed above from
  // `import.meta.url`), NOT `process.cwd()`, so it resolves correctly whether the API runs from
  // source (`apps/api/src` under tsx, dev) or from the build (`apps/api/dist`, prod/Docker) — both
  // sit two directories above `apps/api`, so `packageRoot` lands on the same `apps/api` root either
  // way and `resources/skill-authoring` is a sibling of `src`/`dist`. Override only for a
  // non-standard layout; see apps/api/resources/skill-authoring/skill-creator/SKILL.md for what's
  // bundled (a distilled fallback — the real Anthropic skill-creator could not be vendored offline).
  assistantSkillAuthoringDir: path.resolve(
    process.env.ASSISTANT_SKILL_AUTHORING_DIR ??
      path.join(packageRoot, "resources", "skill-authoring"),
  ),
  // Turn cap for the WHOLE warm session, passed to the SDK's `query({ options: { maxTurns } })`. NOT
  // reset per message — one query() (session-manager.ts's startSession) serves every message a warm
  // session handles until it's parked/aborted, so this budget is shared across all of them; a fresh
  // one only starts on the next park/resume. See ASSISTANT_DEFAULT_MAX_TURNS's doc in packages/shared.
  assistantMaxTurns: readPositiveInt(process.env.ASSISTANT_MAX_TURNS, 50),
  // How long an idle assistant session is kept warm before its child process is parked.
  assistantIdleTimeoutMs: readPositiveInt(process.env.ASSISTANT_IDLE_TIMEOUT_MS, 600_000),
  // Max concurrent live SDK child processes across all threads.
  assistantMaxActiveSessions: readPositiveInt(process.env.ASSISTANT_MAX_ACTIVE_SESSIONS, 2),
  // WP 2.1 — how long a gated write's permission_request waits for an owner decision before it
  // auto-denies (fail-closed). A permission prompt has no park deadline of its own, so this bound
  // stops a forgotten approval card from wedging a turn open forever.
  assistantPermissionTimeoutMs: readPositiveInt(
    process.env.ASSISTANT_PERMISSION_TIMEOUT_MS,
    ASSISTANT_DEFAULT_PERMISSION_TIMEOUT_MS,
  ),
  // Thread/event + session-JSONL + materialized-workspace pruning window in days — WP 3.3's
  // POST /api/maintenance/prune-assistant (apps/api/src/assistant/retention.ts). 0 = disabled (keep
  // everything) — same opt-in-retention convention as scanRetentionPerServer.
  assistantSessionRetentionDays: readNonNegativeInt(
    process.env.ASSISTANT_SESSION_RETENTION_DAYS,
    0,
  ),
  // WP 1.2 — `GET /api/assistant/models` roster (see ASSISTANT_DEFAULT_MODEL_ROSTER's doc: a static
  // default because the SDK's live `supportedModels()` needs an already-running session).
  assistantModelRoster: readStringList(
    process.env.ASSISTANT_MODEL_ROSTER,
    ASSISTANT_DEFAULT_MODEL_ROSTER,
  ),
  // R2.2 (D-AS25) — grace (ms) between a turn completing and the thread's live SDK session being
  // released (parked; cap slot freed, sdkSessionId kept for resume). 0 (default) = release the moment
  // the turn ends, so the "too many sessions" cap 409 essentially disappears — see the shared const's
  // doc. A few seconds keeps the child warm for instant follow-ups at the cost of holding a slot.
  assistantReleaseGraceMs: readNonNegativeInt(
    process.env.ASSISTANT_RELEASE_GRACE_MS,
    ASSISTANT_DEFAULT_RELEASE_GRACE_MS,
  ),
  // R2.2 (D-AS26) — best-effort LLM-refined title after the first turn. ON by default; a bounded,
  // NON-cap-counted one-shot on assistantTitleModel that silently falls back to the deterministic title
  // on any error/timeout. Set ASSISTANT_AUTO_TITLE=false to run the deterministic title only (no spend).
  assistantAutoTitle: readBoolean(process.env.ASSISTANT_AUTO_TITLE, ASSISTANT_DEFAULT_AUTO_TITLE),
  // R2.2 (D-AS26) — the cheap model the title one-shot runs on (defaults to the cheapest roster tier).
  assistantTitleModel: readString(process.env.ASSISTANT_TITLE_MODEL, ASSISTANT_DEFAULT_TITLE_MODEL),
  // R2.2 (D-AS26) — hard timeout (ms) for the title one-shot; on timeout the deterministic title is kept.
  assistantTitleTimeoutMs: readPositiveInt(
    process.env.ASSISTANT_TITLE_TIMEOUT_MS,
    ASSISTANT_DEFAULT_TITLE_TIMEOUT_MS,
  ),
  // Auto-Rating (planning/Roadmap/RM-06-auto-rating/, WP 2.2, AR14) — max concurrent Claude-CLI judge one-shots. Each
  // CLI judge spawns a Claude Agent SDK child (~1 GiB resident), so the CLI-judge chain acquires this
  // semaphore before spawning and releases it in a finally. Default 1 (serial) bounds memory on a
  // constrained box; raise it only where headroom allows. Positive-int, opt-in via env; never blocks a
  // run (AR11 — grading is out-of-band).
  autoRatingMaxConcurrency: readPositiveInt(process.env.AUTO_RATING_MAX_CONCURRENCY, 1),
  // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.4, D-US6) — max concurrent subscription-RUN
  // Agent-SDK children, DECOUPLED from `autoRatingMaxConcurrency` (the CLI-judge budget
  // claude-cli-judge.ts draws from): each budget is its OWN semaphore/counter
  // (subscription-concurrency.ts's `SubscriptionConcurrencyPool.runs` vs `.shared`), so a suite of
  // queuing subscription runs can never starve — or be starved by — the judge's own budget, and a
  // `queued` phase (with 1-based position) is emitted while a run waits for this gate (D-US1). Default
  // 2: each child is ~1 GiB resident (same budget-sizing rationale as `autoRatingMaxConcurrency`, which
  // defaults to a more conservative 1 since a judge one-shot has no operator watching it queue);
  // positive-int, opt-in via env.
  subscriptionRunsMaxConcurrency: readPositiveInt(process.env.SUBSCRIPTION_RUNS_MAX_CONCURRENCY, 2),
  // Auto-Rating ops kill-switch (WP 1.2, AR5) — the base-rating graders are PRODUCT-mandatory (they run
  // on every terminal run: completed/stopped/error/aborted) but ops-STOPPABLE. Set AUTO_RATING_ENABLED=
  // false to skip the MANDATORY graders entirely (expectation grading is UNAFFECTED). Default true; only
  // the literal "false" disables (mirrors dockerMode's `=== "true"`). No per-test opt-out. Injected into
  // GradeService (apps/api/src/index.ts) so grading stays offline-testable.
  autoRatingEnabled: process.env.AUTO_RATING_ENABLED !== "false",
  // Observability (planning/Roadmap/RM-17-observability/, WP5.2, D-OB20) — the OPT-IN LLM assist pass over the
  // deterministic fleet clusters. Its OWN setting + OWN concurrency, DELIBERATELY separate from
  // Auto-Rating's (the Q7 lesson): the assist pass draws on `issueAssistMaxConcurrency`, NOT
  // `autoRatingMaxConcurrency`, so bounding one never bounds the other.
  //   - ISSUE_ASSIST_MAX_CONCURRENCY — max concurrent assist PASSES. Its OWN semaphore, injected in
  //     index.ts (SubscriptionConcurrencyPool.shared is the CLI-judge child budget; this bounds the
  //     assist passes themselves). Default 1 (serial); positive-int, opt-in.
  issueAssistMaxConcurrency: readPositiveInt(process.env.ISSUE_ASSIST_MAX_CONCURRENCY, 1),
  //   - ISSUE_ASSIST_AFTER_SWEEP — run the assist pass automatically after each fleet-issue sweep.
  //     Default FALSE (the assist is manual — the issues UI's "Refine with AI" endpoint drives it).
  //     Only the literal true/1/yes/on enables it; even when enabled, an assist error NEVER breaks the
  //     sweep (the after-sweep hook is fully guarded).
  issueAssistEnabledAfterSweep: readBoolean(process.env.ISSUE_ASSIST_AFTER_SWEEP, false),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.5) — tool-registry defaults consumed by
  // `hub/tools/loading.ts` (R-MCP2, the deferred/tool-search/auto heuristic) and
  // `hub/tools/output-caps.ts` (R-MCP7, the warn/cap + workspace-spill path). Note for later WPs:
  // `config/env.ts` now carries these `HUB_*` knobs alongside the pre-existing `ASSISTANT_*`/
  // `AUTO_RATING_*`/etc. ones — additive only, per the file's hot-file discipline.
  //   - HUB_TOOL_LOADING_DEFAULT — WP1.1 (D-HF1) flips this from "deferred" to "auto": a full-page,
  //     multi-server Hub session carries a large granted MCP surface, but "deferred" with no promotion
  //     path meant NO MCP tool was ever callable (RC1). "auto" now loads eager when the granted catalog
  //     fits the token threshold and deferred-WITH-PROMOTION (tool_search hits become callable in later
  //     steps of the same turn) when it doesn't. Accepts eager/deferred/auto.
  hubToolLoadingDefault: readHubToolLoadingPreference(process.env.HUB_TOOL_LOADING_DEFAULT),
  //   - HUB_TOOL_SEARCH_AUTO_FRACTION — the `auto` loading-mode heuristic: eager iff ALL granted MCP
  //     tool definitions fit within this fraction of the model's context window (R-MCP2).
  hubToolSearchAutoFraction: readFraction(process.env.HUB_TOOL_SEARCH_AUTO_FRACTION, 0.1),
  //   - HUB_TOOL_EAGER_MAX_TOKENS — WP1.1 (D-HF1) absolute upper bound (tokens) on the `auto`-resolves-
  //     eager threshold: `auto` loads eager iff the granted catalog fits within
  //     `min(contextWindow * HUB_TOOL_SEARCH_AUTO_FRACTION, HUB_TOOL_EAGER_MAX_TOKENS)`, so a huge
  //     context window can never let a large catalog load eager and blow the budget. Default 40_000.
  hubToolEagerMaxTokens: readPositiveInt(process.env.HUB_TOOL_EAGER_MAX_TOKENS, 40_000),
  //   - HUB_TOOL_PROMOTE_MAX_TOKENS — WP1.1 (D-HF1) per-`tool_search` promotion token cap: one search
  //     can promote (make resident-callable) at most this many tokens of deferred-tool definitions;
  //     over-cap matches are returned as data with a "narrow your query" note. Default 20_000.
  hubToolPromoteMaxTokens: readPositiveInt(process.env.HUB_TOOL_PROMOTE_MAX_TOKENS, 20_000),
  //   - HUB_MCP_OUTPUT_WARN_TOKENS / HUB_MCP_OUTPUT_MAX_TOKENS — a tool result at/under WARN is passed
  //     through untouched; above WARN (but at/under MAX) is passed through with a size warning; above
  //     MAX spills to the session workspace as a file + a reference card (R-MCP7).
  hubMcpOutputWarnTokens: readPositiveInt(process.env.HUB_MCP_OUTPUT_WARN_TOKENS, 10_000),
  hubMcpOutputMaxTokens: readPositiveInt(process.env.HUB_MCP_OUTPUT_MAX_TOKENS, 25_000),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.4, D-AH12) — the upload size cap
  // (`hub/files/caps.ts`'s zip-bomb-guard pattern). Env-overridable, defaulting to the shared
  // constant like `SKILL_MAX_FILE_BYTES`'s own `SKILL_MAX_FILE_BYTES` env override above.
  hubFileMaxBytes: readPositiveInt(process.env.HUB_FILE_MAX_BYTES, HUB_FILE_MAX_BYTES),
  // Wave-3 adversarial-review F2 — the workspace-write size cap (`hub/workspace.ts`'s
  // `writeWorkspaceTextFile`, called from the `files.write`/`files.edit` built-ins and the R-MCP7
  // output-cap spill path). Env-overridable, defaulting to the shared constant like
  // `hubFileMaxBytes` above; `writeWorkspaceTextFile` itself also falls back to the SAME shared
  // constant when no explicit cap is threaded in, so the guard is active even before this config
  // value is wired into a call site.
  hubWsMaxFileBytes: readPositiveInt(process.env.HUB_WS_MAX_FILE_BYTES, HUB_WS_MAX_FILE_BYTES),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.1) — session-engine knobs consumed by
  // `hub/session-service.ts` (§1.5). Additive only, alongside the WP0.5 `HUB_TOOL_*`/`HUB_MCP_*`
  // knobs above — never touching them. Stall/wait budgets are NOT knobs here: they inherit the
  // Unified-Sessions `SessionClock` defaults (10-min stall / 10-min wait, `session-clock.ts`), per
  // execution-plan §1.10 ("stall/wait inheriting the Unified-Sessions defaults").
  //   - HUB_MAX_ACTIVE_SESSIONS — max concurrent LIVE hub turns (the active-session registry cap; a
  //     dispatch beyond it 409s, mirroring the dock's `assistantMaxActiveSessions`). Default 4.
  hubMaxActiveSessions: readPositiveInt(process.env.HUB_MAX_ACTIVE_SESSIONS, 4),
  //   - HUB_SESSION_IDLE_RELEASE_MS — release-on-reply grace (ms) between a turn settling and its live
  //     slot being freed (D-AS25 lesson). Default 0 = release the instant the turn ends, so the cap
  //     essentially never wedges; a few seconds keeps the session warm for instant follow-ups.
  hubSessionIdleReleaseMs: readNonNegativeInt(process.env.HUB_SESSION_IDLE_RELEASE_MS, 0),
  //   - HUB_AUTO_TITLE — best-effort deterministic-then-LLM-refine session title after the first turn
  //     (D-AS26 pattern). ON by default; the LLM refine is a bounded, non-blocking one-shot that
  //     silently falls back to the deterministic title on any error/timeout (and is a no-op unless a
  //     title-refine seam is wired). Set HUB_AUTO_TITLE=false to keep the deterministic title only.
  hubAutoTitle: readBoolean(process.env.HUB_AUTO_TITLE, true),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.7) — MISSION knobs consumed by `hub/missions/*`
  // (§1.4/§1.5, D-AH6/D-AH8/D-AH9). Additive only, alongside the WP0.5/WP1.1 `HUB_*` knobs above.
  // These are HARD CAPS + autonomy thresholds enforced server-side regardless of the plan's own
  // `budgets` or any autonomy dial (D-AH9): a plan's `maxAgents`/`maxParallel`/`maxCostUsd` are
  // clamped DOWN to these, never up.
  //   - HUB_MISSION_MAX_AGENTS — the widest fan-out a single mission may spawn (excess planned agents
  //     are dropped at propose/edit time). Default 6.
  hubMissionMaxAgents: readPositiveInt(process.env.HUB_MISSION_MAX_AGENTS, 6),
  //   - HUB_MISSION_MAX_PARALLEL — max agents running CONCURRENTLY; the rest queue (subscription
  //     memory wall + the D-CS10 semaphore — the planner should prefer API-keyed models for wide
  //     fan-outs; the board shows the queue honestly via `Queue*`). Default 3.
  hubMissionMaxParallel: readPositiveInt(process.env.HUB_MISSION_MAX_PARALLEL, 3),
  //   - HUB_MISSION_DEFAULT_BUDGET_USD — the mission-wide total cost cap applied when the plan names
  //     no `maxCostUsd`; a tripped budget stops cleanly and synthesizes partially (honestly marked).
  //     Default $2.00.
  hubMissionDefaultBudgetUsd: readPositiveFloat(process.env.HUB_MISSION_DEFAULT_BUDGET_USD, 2.0),
  //   - HUB_MISSION_MAX_BUDGET_USD — the ABSOLUTE ceiling on a mission's `maxCostUsd` (D-AH9: total
  //     cost is a HARD cap, not a dial) — a plan/crew/edit naming a `maxCostUsd` above this is clamped
  //     down to it regardless (unlike `HUB_MISSION_DEFAULT_BUDGET_USD` above, which only supplies a
  //     value when the plan names none). Generous but bounded; must stay >= the default budget.
  //     Default $10.00.
  hubMissionMaxBudgetUsd: readPositiveFloat(process.env.HUB_MISSION_MAX_BUDGET_USD, 10.0),
  //   - HUB_MISSION_MAX_DEPTH — crew-nesting (planning/Roadmap/RM-10-crew-nesting/, D-CN3/D-CN10) the max nesting
  //     depth a mission tree may reach (root = depth 1; a nested sub-mission adds a level). Default 2
  //     (root + one nested level). Setting this to 1 reproduces today's exact pre-nesting behavior (a
  //     `crewId` member is rejected at author time as over-depth) — enforcement of the ceiling itself
  //     lands in WP 1.1 (author-time) and WP 2.1 (run-time); this only parses and threads the number.
  hubMissionMaxDepth: readPositiveInt(process.env.HUB_MISSION_MAX_DEPTH, HUB_MISSION_MAX_DEPTH),
  //   - HUB_MISSION_MAX_TOTAL_AGENTS — crew-nesting (D-CN3/D-CN10) the transitive whole-tree leaf-agent
  //     ceiling, backstopping the existing per-mission `HUB_MISSION_MAX_AGENTS`. Default 24. Enforcement
  //     (the whole-tree cascade check) lands in WP 2.2, not here.
  hubMissionMaxTotalAgents: readPositiveInt(
    process.env.HUB_MISSION_MAX_TOTAL_AGENTS,
    HUB_MISSION_MAX_TOTAL_AGENTS,
  ),
  //   - HUB_AUTONOMY_ASK_ABOVE_AGENTS / HUB_AUTONOMY_ASK_ABOVE_USD — the `threshold` autonomy dial's
  //     ceilings: a `threshold` mission auto-launches only when its agent count AND estimated cost are
  //     at/under BOTH; otherwise it waits for explicit approval (`always_ask` always waits; `auto`
  //     always launches — hard caps still apply). Defaults 3 agents / $1.00.
  hubAutonomyAskAboveAgents: readPositiveInt(process.env.HUB_AUTONOMY_ASK_ABOVE_AGENTS, 3),
  hubAutonomyAskAboveUsd: readPositiveFloat(process.env.HUB_AUTONOMY_ASK_ABOVE_USD, 1.0),
  //   - HUB_MISSION_APPROVAL_TIMEOUT_S — hub-fixes WP2.5 (D-HF6) the auto-deny budget (seconds) for an
  //     `always_ask` mission's board approval cards: a gated child tool call queued to the board and
  //     left unanswered this long is auto-denied so the mission always TERMINATES (a silent stall is a
  //     defect; the agent then proceeds honestly without that call). Default 300 (5 min). Irrelevant to
  //     `auto`/`threshold` missions (they auto-decline gated calls immediately, no board card).
  hubMissionApprovalTimeoutS: readPositiveInt(process.env.HUB_MISSION_APPROVAL_TIMEOUT_S, 300),
  //   - HUB_AGENT_RUNNER — hub-fixes WP2.1 (RC2, D-HF7) the mission agent-runner rollback seam.
  //     `session` (default) runs each planned agent as a REAL child hub session through the turn engine
  //     (granted MCP tools callable, real usage/cost, live transcript) then extracts a structured
  //     `HubAgentReport`; `structured` keeps the OLD one-shot `generateObject` runner wired for one
  //     release (byte-compatible fallback). Anything else ⇒ `session`.
  hubAgentRunner: readHubAgentRunner(process.env.HUB_AGENT_RUNNER),
  //   - HUB_SYNTHESIS_MODE — hub-fixes WP3.2 (RC4, D-HF4) the mission-synthesis path. `turn` (default)
  //     runs the synthesis as a REAL turn of the parent session through the turn engine WITH the GenUI
  //     `present` tools granted (MCP tools are NOT — synthesis reasons over the agent reports, it never
  //     re-queries), so the final answer can render Table/StatGroup/Chart widgets plus prose. `text` keeps
  //     the pre-fix tool-less `generateText` synthesizer (a byte-compatible fallback the `turn` path also
  //     falls back to on any turn failure). Anything else ⇒ `turn`.
  hubSynthesisMode: readHubSynthesisMode(process.env.HUB_SYNTHESIS_MODE),
  //   - HUB_MISSION_EXTRACTION_MODEL — hub-fixes (Defect 2) override the model used for a mission agent's
  //     bounded report-EXTRACTION call. Absent ⇒ the parent/mission session model (structured-capable,
  //     since it ran the planner), so a facade agent-model never runs the extraction on itself.
  hubMissionExtractionModel: process.env.HUB_MISSION_EXTRACTION_MODEL?.trim() || undefined,
  //   - HUB_MISSION_SYNTHESIS_MODEL — assistant-hub v1-fixes (F1) override the model that runs the mission
  //     SYNTHESIS turn. Absent ⇒ the parent session's model when structured-capable, else the first
  //     structured-capable plan model (never an `assistant|…` facade model — the facade drops the system
  //     prompt that carries the reports digest, which produced the blind synthesis of the analysis doc).
  hubMissionSynthesisModel: process.env.HUB_MISSION_SYNTHESIS_MODEL?.trim() || undefined,
  //   - HUB_MISSION_EXTRACTION_TIMEOUT_S — hub-fixes (Defect 4) bound the post-turn report-EXTRACTION call
  //     (seconds → ms). It runs after the child turn's clock stops, so nothing else caps it; on timeout the
  //     runner falls back to the deterministic prose projection. Default 120s; 0 disables the cap.
  hubMissionExtractionTimeoutS: readNonNegativeInt(process.env.HUB_MISSION_EXTRACTION_TIMEOUT_S, 120),
  //   - HUB_MISSION_AGENT_MAX_DURATION_S — hub-fixes (Defect 4) an OVERALL per-agent wall cap (seconds → ms)
  //     for a mission slot (child turn + extraction). A wedged agent is aborted so it can't stall the whole
  //     parallel join. Default 0 (off — the per-turn maxDurationMs + extraction timeout are the primary nets).
  hubMissionAgentMaxDurationS: readNonNegativeInt(process.env.HUB_MISSION_AGENT_MAX_DURATION_S, 0),
  //   - HUB_DEFAULT_AUTONOMY — the autonomy dial applied to a session that sets none (WP2.3, D-AH6).
  //     `always_ask` (default) gates every side-effecting MCP tool call on an approval card; `auto`
  //     auto-runs read-only-on-trusted tools; `threshold` behaves like `auto` at the tool floor (its
  //     agent/cost ceilings govern MISSION launch). HARD caps are enforced server-side regardless.
  hubDefaultAutonomy: readAutonomyLevel(process.env.HUB_DEFAULT_AUTONOMY),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP2.4, R-SK1/R-SK2) — SKILL attachment knobs consumed by
  // `hub/skill-attachments.ts` (the L1 listing budget + least-recently-invoked demotion) and
  // `hub/tools/builtins/skills.ts` (the `skills.load` on-demand compaction-protection budgets).
  // Additive only, alongside the WP0.5/1.1/1.7 `HUB_*` knobs above.
  //   - HUB_SKILL_LISTING_BUDGET_FRACTION — the L1 catalog's token ceiling as a fraction of the
  //     model's context window (R-SK1). Default 0.01 (1%).
  hubSkillListingBudgetFraction: readFraction(process.env.HUB_SKILL_LISTING_BUDGET_FRACTION, 0.01),
  //   - HUB_SKILL_ENTRY_MAX_CHARS — per-entry description truncation in the L1 catalog (R-SK1).
  //     Default 1536.
  hubSkillEntryMaxChars: readPositiveInt(process.env.HUB_SKILL_ENTRY_MAX_CHARS, 1536),
  //   - HUB_SKILL_COMPACTION_TOKENS_PER_SKILL / HUB_SKILL_COMPACTION_TOKENS_TOTAL — the `skills.load`
  //     on-demand budget (R-SK2): what a single skill / the whole session may load into context,
  //     compaction-protected. Defaults 5,000 / 25,000.
  hubSkillCompactionTokensPerSkill: readPositiveInt(
    process.env.HUB_SKILL_COMPACTION_TOKENS_PER_SKILL,
    5_000,
  ),
  hubSkillCompactionTokensTotal: readPositiveInt(
    process.env.HUB_SKILL_COMPACTION_TOKENS_TOTAL,
    25_000,
  ),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.3, R-SES8) — CONTEXT-WINDOW compaction knobs consumed by
  // `hub/compaction.ts` (clear-tool-outputs-first → summarize; thrash-stop; skill re-attach). Additive
  // only, alongside the WP2.4 `HUB_SKILL_*` knobs above.
  //   - HUB_COMPACTION_THRESHOLD_FRACTION — compact when the reconstructed history reaches this fraction
  //     of the model's context window. Default 0.75 (below 1.0 so we compact BEFORE the provider rejects
  //     an over-window request).
  hubCompactionThresholdFraction: readFraction(process.env.HUB_COMPACTION_THRESHOLD_FRACTION, 0.75),
  //   - HUB_COMPACTION_KEEP_RECENT_TURNS — how many recent user turns stay HOT (verbatim, never cleared
  //     or summarized) through a compaction. Default 4.
  hubCompactionKeepRecentTurns: readPositiveInt(process.env.HUB_COMPACTION_KEEP_RECENT_TURNS, 4),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP2.6, R-GUI4) — the bounded machine-hinted GenUI repair loop.
  //   - HUB_GENUI_MAX_REPAIR_ATTEMPTS — how many times a `present`/`prompt_user` spec that fails the
  //     catalog allowlist is fed typed errors back to the model to re-emit before the tool gives up and
  //     returns a recovery envelope (rendered as an honest recovery card; the model falls back to
  //     markdown). Default 2. A repair attempt is one re-emit; the initial call is not counted.
  hubGenuiMaxRepairAttempts: readNonNegativeInt(process.env.HUB_GENUI_MAX_REPAIR_ATTEMPTS, 2),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.1, D-AH11c) — the project INSTRUCTIONS + PINNED FILES
  // LAYER 6b injection cap (`prompting/budgets.ts`'s "the injected memory/project bodies are capped
  // by the turn engine" contract — the layer's own `budgetTokens` covers only the static framing
  // prose). `hub/turn-engine.ts` truncates the assembled project-context string to this many
  // characters before handing it to `projectLayer`/`assembleSessionPrompt`'s `project` injection.
  // Default 8,000 chars (~2,000 tokens at a rough 4-chars/token ratio).
  hubProjectContextMaxChars: readPositiveInt(process.env.HUB_PROJECT_CONTEXT_MAX_CHARS, 8_000),
  // Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.3) — root-session/workspace/file retention window in
  // days for `POST /api/maintenance/prune-hub` (apps/api/src/hub/retention.ts). 0 = disabled (keep
  // everything) — the SAME opt-in-retention convention as `scanRetentionPerServer`/
  // `assistantSessionRetentionDays`; safe-by-default, an operator turns it on explicitly.
  hubSessionRetentionDays: readNonNegativeInt(process.env.HUB_SESSION_RETENTION_DAYS, 0),
  // Assistant Hub (hub-fixes WP5.1, RC5, D-HF2) — the web-tools kill switch. When enabled (the default),
  // a session's model-native `web.search` + the app-level `web.fetch` built-in are grantable and
  // (capability-permitting) default-granted. `HUB_WEB_TOOLS=off` removes BOTH everywhere — top-level
  // sessions AND mission agents — and the tools prompt says so when a scope requested one. Consumed by
  // `hub/session-service.ts`'s `composeWebTools` seam via `HubSessionServiceConfig.webToolsEnabled`.
  hubWebToolsEnabled: readBoolean(process.env.HUB_WEB_TOOLS, true),
  // assistant-hub v1-fixes (F6) — the app-level web-search FALLBACK provider chain, used whenever a
  // session's model has no provider-native search (subscription, openai_compatible, ollama, facade
  // models). Order: Tavily key → Serper key → self-hosted SearXNG URL → keyless DuckDuckGo scrape
  // (always available, honestly labeled degraded). `HUB_SEARCH_DUCKDUCKGO=off` disables the scrape.
  hubSearchTavilyKey: process.env.HUB_SEARCH_TAVILY_KEY?.trim() || undefined,
  hubSearchSerperKey: process.env.HUB_SEARCH_SERPER_KEY?.trim() || undefined,
  hubSearxngUrl: process.env.HUB_SEARXNG_URL?.trim() || undefined,
  hubSearchDuckduckgo: readBoolean(process.env.HUB_SEARCH_DUCKDUCKGO, true),
  dockerMode: process.env.DOCKER_MODE === "true" || dataDirectory === "/data",
};
