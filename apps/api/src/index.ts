import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { type GraderId, type HealthPayload } from "@mcp-token-footprint/shared";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAdvisorRoutes } from "./advisor/routes.js";
import { registerApiTokenGuard } from "./api-tokens/guard.js";
import { ApiTokenRepository } from "./api-tokens/repository.js";
import { registerApiTokenRoutes } from "./api-tokens/routes.js";
import { ApiTokenService } from "./api-tokens/service.js";
import { registerAssertionRoutes } from "./assertions/routes.js";
import { AssistantAuthService } from "./assistant/auth-service.js";
import {
  ClaudeOauthFlowManager,
  NodePtyDriver,
  resolveClaudeSetupTokenSpawn,
} from "./assistant/claude-auth.js";
import { AssistantRepository } from "./assistant/repository.js";
import { registerAssistantRoutes } from "./assistant/routes.js";
import { AssistantSessionManager } from "./assistant/session-manager.js";
import { SdkAgentSessionDriver } from "./assistant/session-driver.js";
import { buildAssistantTools, type AssistantToolDeps } from "./assistant/tools/index.js";
import { renderContextEnvelope } from "./assistant/context-envelope.js";
import { CollectionGitSyncService } from "./collections/git-sync.js";
import { InsightBenchImporter } from "./collections/insightbench-import.js";
import { CollectionRepository } from "./collections/repository.js";
import { registerCollectionRoutes } from "./collections/routes.js";
import { CollectionService } from "./collections/service.js";
import { registerCompareRoutes } from "./compare/routes.js";
import { registerEstimateRoutes } from "./estimate/routes.js";
import {
  registerCompatibilityRoutes,
  registerRunCompatibilityRoutes,
} from "./compatibility/routes.js";
import { config } from "./config/env.js";
import { openDatabase } from "./db/database.js";
import { registerMaintenanceRoutes } from "./db/maintenance.js";
// CI & headless automation — Phase MCP WP M.1 (roadmap/ci/mcp-server.md): the workbench's OWN
// read-only MCP server, mounted on this same Fastify instance at `/api/mcp` (D-MCP1) behind the
// `mcp_server` feature flag (D-MCP6). It re-projects the repositories constructed below — it never
// constructs its own.
import { registerWorkbenchMcpRoutes } from "./mcp-server/routes.js";
import { GithubAccountService } from "./github-account/service.js";
import { registerGithubAccountRoutes } from "./github-account/routes.js";
import { createAnswerValidationGrader } from "./grading/answer-validation.js";
import { AppSettingsRepository } from "./grading/app-settings-repository.js";
import { registerFeatureRoutes } from "./features/routes.js";
import { FeatureFlagsService } from "./features/service.js";
import { createClaudeCliJudgeGenerate } from "./grading/claude-cli-judge.js";
import { createErrorForensicsGrader } from "./grading/error-forensics.js";
import { FailureBucketService } from "./grading/failure-buckets.js";
import { GradeRepository } from "./grading/grade-repository.js";
import { GradeService } from "./grading/grade-service.js";
import { DETERMINISTIC_GRADERS } from "./grading/grader.js";
import { createInsightSurplusGrader } from "./grading/insight-surplus.js";
import { IssueAssistService, IssueAssistStore } from "./grading/issue-assist.js";
import { IssueSweepService } from "./grading/issue-clustering.js";
import { RatingIssueRepository } from "./grading/issue-repository.js";
import { registerRatingIssueRoutes } from "./grading/issue-routes.js";
import { RatingIssueService } from "./grading/issue-service.js";
import { IssueVerificationStore } from "./grading/issue-verification.js";
import {
  chainJudgeResolver,
  createJudgeChainGenerate,
  readProviderJudge,
  resolveCliJudgeModel,
} from "./grading/judge-chain.js";
import { createOutcomeJudge, createProviderJudgeGenerate } from "./grading/judge.js";
import { registerGradingRoutes } from "./grading/routes.js";
import { RunReportService } from "./grading/run-report.js";
import { SkillflowConformanceGrader } from "./grading/skillflow-conformance.js";
import { ToolHygieneGrader } from "./grading/tool-hygiene.js";
import { createTrajectoryJudge } from "./grading/trajectory-judge.js";
// Assistant Hub (roadmap/assistant-hub/, WP1.2) — sessions API + SSE. `HubRepository`/`HubSessionService`
// are WP1.1's; `createHubModelResolver`/`reconcileOrphanHubSessions`/`reconcileOrphanHubMissions`/
// `registerHubRoutes` are this WP's / WP4.3's (orphan reconciliation breadth).
import { HubRepository } from "./hub/repository.js";
import { beginHubCitationTurn } from "./hub/citations.js";
import { formatRoleSkillsContent, resolveHubSkillAttachments } from "./hub/skill-attachments.js";
import type { HubMcpGrantInputs, HubModelResolution } from "./hub/session-service.js";
import { HubResourcePool } from "./hub/session-service.js";
import { DEFAULT_CHAT_BUILTIN_NAMES, type HubMcpServerCatalog } from "./hub/tools/index.js";
import { createFallbackWebSearchTool } from "./hub/tools/builtins/web-search-fallback.js";
import { openSession, type McpSession } from "./mcp/client.js";
import { isAuthRequiredError, isOAuthHttpServer } from "./mcp/auth-error.js";
import type {
  HubMcpServerStatusEntry,
  HubServerToolGrant,
  HubSession,
  HubSkillAttachment,
  NormalizedToolDefinition,
} from "@mcp-token-footprint/shared";
import {
  createHubModelResolver,
  hubEligibleCredentials,
  reconcileOrphanHubMissions,
  reconcileOrphanHubSessions,
  registerHubRoutes,
} from "./hub/routes.js";
import {
  formatModelRoster,
  type HubRosterModel,
  tierForModel,
} from "./hub/missions/roster.js";
import { HubSessionService } from "./hub/session-service.js";
import { createHubSubscriptionAdapter } from "./hub/subscription-adapter.js";
import { createHubSubscriptionMcpResolver } from "./hub/subscription-tools.js";
import { pruneHubData } from "./hub/retention.js";
import type { HubNotifySink } from "./hub/turn-engine.js";
// Assistant Hub (roadmap/assistant-hub/, WP1.7) — the mission orchestrator (propose → approve → run →
// synthesize). Production model seams (planner/agent-runner/synthesizer) wrap AI-SDK generateObject/
// generateText over the same provider store the session service resolves models from.
import {
  createSessionAgentRunner,
  createStructuredAgentRunner,
  createStructuredJudge,
  createStructuredPlanner,
  createTextSynthesizer,
  HubMissionService,
} from "./hub/missions/index.js";
import { getTokenCounter } from "./token-counting/profiles.js";
import { OAuthRepository } from "./oauth/repository.js";
import { registerOAuthRoutes } from "./oauth/routes.js";
import { OAuthService } from "./oauth/service.js";
import { registerObservabilityRoutes } from "./observability/routes.js";
import { PricingRepository } from "./providers/pricing-repository.js";
import { registerPricingRoutes } from "./providers/pricing-routes.js";
import { installPricingResolver } from "./providers/pricing.js";
import { ProviderRepository } from "./providers/repository.js";
import { registerProviderRoutes } from "./providers/routes.js";
import { ProviderService } from "./providers/service.js";
import { AssistantSubscriptionAuth } from "./providers/subscription-auth.js";
import { SubscriptionModelResolver } from "./providers/subscription-models.js";
import { DigestReportRepository, DigestScheduleService } from "./reports/digest.js";
import { registerReportRoutes } from "./reports/routes.js";
import { ScanRepository } from "./scans/repository.js";
import { registerScanRoutes } from "./scans/routes.js";
import { ScanService } from "./scans/service.js";
import { registerSecurityRoutes } from "./security/routes.js";
import { loadSecretKey, SecretStore } from "./secrets/secret-store.js";
import { ServerRepository } from "./servers/repository.js";
import { registerServerRoutes } from "./servers/routes.js";
import { ServerTypeRepository } from "./server-types/repository.js";
import { registerServerTypeRoutes } from "./server-types/routes.js";
import { SkillGitService } from "./skills/git-service.js";
import { SkillIngestService } from "./skills/ingest-service.js";
import { SkillBindingRepository } from "./skills/binding-repository.js";
import { SkillPublishService } from "./skills/publish-service.js";
import { SkillPushService } from "./skills/push-service.js";
import { SkillRepository } from "./skills/repository.js";
import { registerSkillRoutes } from "./skills/routes.js";
import { registerSkillflowRoutes } from "./skillflow/routes.js";
import { SuiteOrchestrator } from "./suites/orchestrator.js";
import { registerRunPlanRoutes } from "./suites/plan-routes.js";
import { SuiteRepository } from "./suites/repository.js";
import { registerSuiteRoutes } from "./suites/routes.js";
import { SuiteReportRepository } from "./suites/suite-report-repository.js";
import { SuiteReportService } from "./suites/suite-report-service.js";
import { SuiteRunManager } from "./suites/suite-run-manager.js";
import { SuiteRunRepository } from "./suites/suite-run-repository.js";
import { SuiteService } from "./suites/service.js";
import { RunManager } from "./testing/run-manager.js";
import { RunRepository } from "./testing/run-repository.js";
import { RunService } from "./testing/run-service.js";
import { AsyncSemaphore, SubscriptionConcurrencyPool } from "./testing/subscription-concurrency.js";
import { ScenarioRepository } from "./testing/scenario-repository.js";
import { ScenarioService } from "./testing/scenario-service.js";
import { TestRepository } from "./testing/test-repository.js";
import { TestService } from "./testing/test-service.js";
import { registerTestingRoutes } from "./testing/routes.js";
import { createGracefulShutdown, installShutdownHandlers } from "./shutdown.js";
import { WatchEngine, WatchWindowEvaluator } from "./watch/engine.js";
import { registerNotificationRoutes } from "./watch/notification-routes.js";
import {
  createNotifySink,
  NotificationHub,
  NotificationRepository,
} from "./watch/notifications.js";
import { promoteRunToTest } from "./watch/promote.js";
import { WatchRuleRepository } from "./watch/repository.js";
import { registerWatchRoutes } from "./watch/routes.js";
import { WatchScheduler } from "./watch/scheduler.js";
import { registerWatchTestFireRoute } from "./watch/webhook.js";
import type { WatchActionServices } from "./watch/actions.js";
import { toErrorMessage } from "./utils/errors.js";

const server = Fastify({ logger: true });
const db = openDatabase();
// Observability WP2.6 (D-OB22) — install the DB-backed pricing resolver BEFORE any run/estimate can
// price a model, so `estimateCost`/`isModelPriced` resolve edited prices from `model_pricing` (the
// code table stays the seed + belt-and-braces fallback). Recorded run costs are NEVER recomputed.
const pricingRepository = new PricingRepository(db);
installPricingResolver(pricingRepository);
const secretStore = new SecretStore(
  loadSecretKey({ explicitKey: config.secretKey, keyPath: config.secretKeyPath }),
);
const servers = new ServerRepository(db, secretStore);
const serverTypes = new ServerTypeRepository(db);
const migratedSecretRows = servers.migratePlaintextSecrets();
if (migratedSecretRows > 0) {
  server.log.info(
    { migratedSecretRows },
    "Migrated plaintext MCP server secrets to encrypted storage",
  );
}
const oauthRepository = new OAuthRepository(db, secretStore);
// Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7) — the assistant credential store is
// constructed HERE (ahead of its usual home near the session engine below) so a `claude_subscription`
// provider credential can resolve its auth from the SAME signed-in subscription (`assistant_credentials`)
// the embedded Assistant dock uses. `AssistantRepository` has no dependency on `ProviderRepository`, so
// this ordering introduces no cycle (unlike `AssistantAuthService`, which DOES depend on
// `ProviderRepository` for its fallback-pointer validation and is still constructed later).
const assistantRepository = new AssistantRepository(db, secretStore);
const subscriptionAuth = new AssistantSubscriptionAuth(assistantRepository);
const providerRepository = new ProviderRepository(db, secretStore, subscriptionAuth);
const migratedProviderKeyRows = providerRepository.migratePlaintextSecrets();
if (migratedProviderKeyRows > 0) {
  server.log.info(
    { migratedProviderKeyRows },
    "Migrated plaintext provider API keys to encrypted storage",
  );
}
const providers = new ProviderService(providerRepository);

// --- Assistant Hub (roadmap/assistant-hub/, WP1.2): sessions API + SSE, over WP1.1's turn engine ---
// On restart, any MISSION left mid-flight (`approved`/`running`/`synthesizing`) lost its in-memory
// orchestrator FIRST (missions/orchestrator.ts's async `runMission` loop — the process is gone) →
// reconcile it to `failed` + abort its still-non-terminal agent children (WP4.3 — a plain session-level
// sweep alone would miss a `pending` child spawned but never started; see that function's own doc).
// THEN reconcile any hub session still left `running` on its own (a plain chat/research turn, or a
// mission agent that was mid-flight itself — already touched above, so idempotent) to `aborted`,
// mirroring the orphaned-scan/run/assistant-thread reconciliation elsewhere in this file.
const hubRepository = new HubRepository(db, {
  maxCrewDepth: config.hubMissionMaxDepth,
  maxTotalAgents: config.hubMissionMaxTotalAgents,
});
const reconciledHubMissions = reconcileOrphanHubMissions(hubRepository);
if (reconciledHubMissions > 0) {
  server.log.warn(
    { reconciledHubMissions },
    "Reconciled orphaned in-flight hub missions to failed on startup",
  );
}
const reconciledHubSessions = reconcileOrphanHubSessions(hubRepository);
if (reconciledHubSessions > 0) {
  server.log.warn(
    { reconciledHubSessions },
    "Reconciled orphaned running hub sessions to aborted on startup",
  );
}
// WP1.5 seam-close (assistant-hub orchestrator): `hubSessionService` is constructed BELOW, after
// `assistantAuth` + `subscriptionConcurrency` exist, so its `subscriptionExecutor` can bind the live
// subscription adapter (it needs both). Nothing between here and that construction references the
// service (the mount is far below). `citationPostPass`/`resolveToolset` stay at their built-ins/default
// until WP1.4 wires MCP grants + citations.

// On startup, reclaim OAuth flow rows past their TTL (issue #10) so stale flows can't be replayed and
// don't accumulate forever.
const sweptOAuthFlows = oauthRepository.sweepExpiredFlows();
if (sweptOAuthFlows > 0) {
  server.log.info({ sweptOAuthFlows }, "Swept expired OAuth flow rows on startup");
}
const oauthService = new OAuthService(servers, oauthRepository);
const scans = new ScanRepository(db);
// On restart, any scan still marked `running` lost its in-memory session (the process is gone) →
// reconcile it to `failed` (issue #10), mirroring the orphaned-run reconciliation below.
const failedOrphanScans = scans.abortOrphanedScans();
if (failedOrphanScans > 0) {
  server.log.warn({ failedOrphanScans }, "Marked orphaned running scans as failed on startup");
}
const scanService = new ScanService(servers, scans, oauthService);

// --- Skills registry (Phase 1) — created before the scenario/run services so Phase 2 attachment
// resolution (`resolveAllowedSkills`) + the read-only `read_skill_file` disclosure tool can read
// skill versions' files.
const skills = new SkillRepository(db, secretStore);
// Skill IDE WP 8.1 (I9.1) — per-skill server bindings (name → registered id, editable in a picker).
const skillBindings = new SkillBindingRepository(db);

// --- Testing (WP 2.1): scenario & test CRUD + attachments + resolution helpers ---
const scenarioRepository = new ScenarioRepository(db);
const scenarioService = new ScenarioService(scenarioRepository, scans, skills);
const testRepository = new TestRepository(db);
const testService = new TestService(testRepository);

// --- Testing (WP 1.6): run persistence (full replay) ---
// The RunRepository is the persistence sink fed every RunEvent by the RunManager fan-out, so a run is
// written incrementally as the loop emits. On restart, any run still marked `running` lost its
// in-memory session (the process is gone) → reconcile it to `aborted` so the partial record opens
// read-only.
const runRepository = new RunRepository(db);
const abortedOrphanRuns = runRepository.abortOrphanedRuns();
if (abortedOrphanRuns > 0) {
  server.log.warn({ abortedOrphanRuns }, "Marked orphaned running runs as aborted on startup");
}
const runManager = new RunManager(runRepository);

// --- Assistant (WP 0.2): Claude subscription sign-in (D-AS1/D-AS2/D-AS14). The auth service is
// constructed HERE (ahead of the session engine below) because the Auto-Rating judge chain (WP 2.3)
// needs `assistantAuth`'s server-side `resolveJudgeAuth` for the CLI-first judge. It owns the encrypted
// credential store + the API-key fallback pointer; the flow manager drives `claude setup-token` in a
// real PTY (NodePtyDriver). The token is stored encrypted and NEVER returned by any route or written to
// a log. `assistantRepository` itself was already constructed further up (ahead of `providerRepository`,
// roadmap/claude-subscription/ WP 0.2) so a `claude_subscription` provider credential can resolve its
// auth from this SAME store.
// On restart, any assistant thread still marked `running` lost its in-memory SDK child → reconcile it
// to `idle` (keeping its parked SDK session id so the next message resumes) + append a synthesized
// `error` event, mirroring the orphaned-run/scan reconciliation above.
const reconciledAssistantThreads = assistantRepository.reconcileOrphanThreads();
if (reconciledAssistantThreads > 0) {
  server.log.warn(
    { reconciledAssistantThreads },
    "Reconciled orphaned running assistant threads to idle on startup",
  );
}
const assistantFlowManager = new ClaudeOauthFlowManager({
  driver: new NodePtyDriver(),
  resolveSpawn: () => resolveClaudeSetupTokenSpawn(config.assistantDataDir),
});
const assistantAuth = new AssistantAuthService(
  assistantRepository,
  providerRepository,
  assistantFlowManager,
);

// --- Benchmarks (WP 1.2): output-quality grading (append-only run_grades; free deterministic graders) ---
// The GradeService is passed to the RunService so a cleanly-completed run is auto-graded post-completion
// (a fully-guarded hook that never blocks/mutates the run).
const gradeRepository = new GradeRepository(db);
// Auto-Rating WP 1.5 (AR1) — composes the on-demand RunReport from the persisted run + its latest-per-
// grader grade rows (pure read, never grades/executes/mutates — AR11). Shared by the report endpoint
// (`registerGradingRoutes` below) and the run export (`registerReportRoutes`) so both surfaces agree.
const runReportService = new RunReportService(gradeRepository, runRepository);
// Grader roster: the free deterministic set (WP 1.2) + the scan-schema-aware tool_hygiene grader
// (WP 2.1, reads each server's latest completed scan read-only) + the G-Eval outcome judge (WP 1.3,
// B3 — one provider call at temp 0, logprob-weighted when available; its cost lands ONLY in the
// run_grades judge_* ledger per B5; unconfigured → self-reports `unevaluable`, a no-op until a default
// judge is set in grading settings). Other W3 WPs append their graders to THIS array.
const appSettings = new AppSettingsRepository(db);
// Settings › Features (feature flags) — the operator's on/off switches for whole app capabilities,
// persisted in the SAME `app_settings` KV (key `app.features`; no table, no migration). Registered
// FIRST, before any feature's own routes, because `registerFeatureRoutes` also installs the root
// `onRequest` guard that 403s requests belonging to a disabled feature (`/api/assistant`, `/api/hub`
// while the Assistant is off). Hiding the UI alone is not an off-switch — a stale tab or a direct
// curl would still start sessions and spend provider tokens.
const featureFlags = new FeatureFlagsService(appSettings);
registerFeatureRoutes(server, featureFlags);
// Service tokens (roadmap/ci/ WP 1.1, D-C2) — the credential a headless caller (CI, the mcpfp CLI, an
// external agent on the MCP mount) presents instead of a browser session. The guard is a root
// `onRequest` hook, registered right AFTER the feature guard on purpose: a switched-off feature should
// read as switched off (403 feature_disabled), not as an auth problem. Posture: loopback stays open
// (the browser UI is unaffected), any non-loopback caller must present a valid bearer token, and
// API_AUTH_REQUIRED=true extends that to loopback. There is deliberately NO feature flag over this —
// an off-switch on an auth check is a foot-gun.
const apiTokenRepository = new ApiTokenRepository(db);
const apiTokenService = new ApiTokenService(apiTokenRepository);
registerApiTokenGuard(server, apiTokenService, { authRequired: config.apiAuthRequired });
registerApiTokenRoutes(server, apiTokenService);
// Auto-Rating (WP 2.3, AR2/AR3/AR16) — the ONE judge resolution chain shared by ALL FIVE LLM graders
// (outcome/trajectory judges + the three mandatory base-rating graders): Claude CLI (subscription, if
// signed in) → configured provider judge → none. Built ONCE here and passed to every LLM grader so the
// resolution + provenance are uniform (a grade row records the ACTUAL source that rated it — `claude_cli`
// + cost 0 for the subscription, or the provider + estimated cost). The CLI leg drives the raw SDK
// driver directly (never AssistantSessionManager) with the server-side subscription token and the AR14
// concurrency semaphore; the provider leg is today's `createProviderJudgeGenerate`. `readProviderJudge`
// is the SAME KV the routes read, so "a provider is configured" means one thing everywhere.
// WP 2.1 (D-CS2/D-CS10) — the ONE process-wide subscription concurrency pool. Its `.shared` gate is the
// SINGLE runs+judge budget: it is injected into the Auto-Rating CLI judge (just below). The pool's
// per-provider gate additionally caps how many run children a single provider's suite matrix can have
// admitted (D-CS2). Unified Sessions (WP1.4/WP1.7, D-US6) — its THIRD constructor arg,
// `config.subscriptionRunsMaxConcurrency`, sizes the DECOUPLED `.runs` gate `new RunService(...)` (further
// down) now injects instead of `.shared`: a subscription RUN child and a CLI JUDGE child (each ~1 GiB) no
// longer draw from the same semaphore, so a suite of subscription runs can't contend with (or starve) an
// in-flight CLI judge. The `maxPerProvider` (2nd) arg is left `undefined` so it keeps defaulting to
// `maxConcurrency`, unchanged from before this WP.
const subscriptionConcurrency = new SubscriptionConcurrencyPool(
  config.autoRatingMaxConcurrency,
  undefined,
  config.subscriptionRunsMaxConcurrency,
);

// Assistant Hub MCP tool grants v1 (WP1.4, R-MCP1 / §1.6) — a hub session may call the tools of every
// registered MCP server that has a completed scan (`{server → all}`; per-session/per-tool narrowing is
// WP2.1). The scanned catalog (already normalized + metered) supplies the tool definitions; a process-
// lifetime session pool supplies the live connection — one child per server, reused across turns, since
// a fresh session per chat message would respawn every stdio server on every reply. Best-effort by
// design (D-AS17 posture): a server that fails to open (down / needs interactive OAuth) is skipped for
// the turn and the chat proceeds on whatever connected + the built-ins — an MCP outage never breaks chat.
//
// hub-fixes WP1.3 (RC3.4): the failure is never SILENT anymore. `getHubMcpSession` now reports WHY a
// server didn't open, and `resolveHubMcpGrants` carries every attempted server's outcome (connected or
// not) on `HubMcpGrantInputs.serverStatuses` — `HubSessionService` turns that into a persisted
// `mcp_server_status` event (deduped on change) and a truthful "Unreachable this turn" prompt line,
// instead of the old drop-and-forget that could silently empty out to the misleading "No MCP tools are
// granted" fallback. The cache itself moved into `HubResourcePool` (`hub/session-service.ts`) so its
// eviction (this WP's `POST /api/hub/servers/:id/reconnect`) is unit-testable in isolation.
const hubMcpSessions = new HubResourcePool<McpSession>();
async function getHubMcpSession(
  serverId: string,
): Promise<
  | { session: McpSession; reason?: undefined; authRequired?: undefined }
  | { session: undefined; reason: string; authRequired: boolean }
> {
  try {
    const session = await hubMcpSessions.get(serverId, () => {
      const serverConfig = servers.getInternal(serverId);
      // WP2.3 (R-MCP4): route this server's `elicitation/create` to whichever hub session's turn is
      // driving it — the session-service holds the coordinator + the serverId→session routing. Declines
      // safely when no turn is active (the coordinator's own fallback). Additive; other transports
      // unaffected.
      const options = {
        ...(isOAuthHttpServer(serverConfig)
          ? { authProvider: oauthService.createProvider(serverConfig.id) }
          : {}),
        elicitationHandler: (params: unknown) =>
          hubSessionService.handleElicitation(serverId, params, { serverName: serverConfig.name }),
      };
      return openSession(serverConfig, options);
    });
    return { session };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Classify a REAUTH-able auth failure (401/403 on an OAuth streamable-HTTP server) so the UI can
    // offer an "Authenticate" action instead of a passive "unreachable" notice. Only oauth-http servers
    // can be re-authenticated through the ServerWizard flow, so a non-oauth 401 (e.g. a bad API key) is
    // NOT flagged — its Authenticate button would no-op. Guarded: a since-deleted server ⇒ not auth.
    let authRequired = false;
    if (isAuthRequiredError(error)) {
      try {
        authRequired = isOAuthHttpServer(servers.getInternal(serverId));
      } catch {
        authRequired = false;
      }
    }
    server.log.warn({ err: error, serverId }, "hub: MCP session open failed; skipping this turn");
    return { session: undefined, reason, authRequired };
  }
}

/**
 * hub-fixes (Defect 1c) — is an MCP server usable by a HEADLESS mission agent this run? An OAuth
 * streamable-HTTP server needs a valid token ALREADY (a background mission child can't run the interactive
 * OAuth flow, so its tools would be stripped and the agent would run tool-less); a deleted/unknown server
 * is never ready. Non-OAuth servers (stdio / api-key / none) are ready once registered. Mirrors
 * `getHubMcpSession`'s own auth classification; feeds the mission pre-run readiness gate.
 */
function isHubServerRunReady(serverId: string): { ready: boolean; serverName?: string } {
  try {
    const serverConfig = servers.getInternal(serverId);
    if (!isOAuthHttpServer(serverConfig)) return { ready: true, serverName: serverConfig.name };
    return { ready: oauthService.status(serverConfig.id).authenticated, serverName: serverConfig.name };
  } catch {
    return { ready: false }; // unregistered/deleted — nothing to run against
  }
}
/**
 * hub-fixes WP2.3 (RC2.4) — the parent session's REACHABLE MCP catalog for the mission PLANNER (the
 * `HubMissionService.mcpCatalog` dep → `proposePlan`'s `buildPlannerServerCatalog`). Same scope-aware
 * `{serverId → {serverName, tools}}` snapshot the `resolveHubMcpGrants` catalog section below builds —
 * mirrored deliberately so this never opens a live connection: the planner proposes grants over what is
 * REGISTERED + SCANNED, not what happens to connect at propose time. A scoped session yields only its
 * listed servers; an auto session yields every scanned server. Wiring this at the composition root is
 * what makes WP2.2/2.3's propose-path grant proposal LIVE (it was stub-tested in the service before).
 */
function resolveReachableMcpCatalog(session: HubSession): Map<string, HubMcpServerCatalog> {
  const scope = session.toolScope ?? null;
  const catalog = new Map<string, HubMcpServerCatalog>();
  for (const summary of servers.list()) {
    const grant: HubServerToolGrant | undefined = scope ? scope.servers[summary.id] : "all";
    if (grant === undefined) continue; // scoped-out server (auto always yields "all")
    const defs = scans.getLatestForServer(summary.id)?.tools ?? [];
    if (defs.length === 0) continue; // never scanned / no tools → nothing to propose over
    catalog.set(summary.id, {
      serverName: summary.name,
      tools: defs.map(
        (t): NormalizedToolDefinition => ({
          name: t.toolName,
          ...(t.description !== undefined ? { description: t.description } : {}),
          ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
          ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
          raw: t.rawTool,
        }),
      ),
    });
  }
  return catalog;
}

async function resolveHubMcpGrants(session: HubSession): Promise<HubMcpGrantInputs | null> {
  const registered = servers.list();
  if (registered.length === 0) return null;
  // End-user UX pass — a "scoped" session (the new-session modal's MCP & tools tab) carries an explicit
  // `toolScope`: grant ONLY its listed servers (each "all" or a tool-name allowlist). An "auto" session
  // (`toolScope` null — the Claude-Desktop default) grants every reachable scanned server so the model
  // discovers tools via `tool_search`. Absent-from-the-scope ⇒ not granted this turn.
  const scope = session.toolScope ?? null;
  const catalog = new Map<string, HubMcpServerCatalog>();
  const grantServers: Record<string, HubServerToolGrant> = {};
  const grantServerNames = new Map<string, string>();
  for (const summary of registered) {
    const grant: HubServerToolGrant | undefined = scope ? scope.servers[summary.id] : "all";
    if (grant === undefined) continue; // scoped-out server (auto always yields "all")
    const defs = scans.getLatestForServer(summary.id)?.tools ?? [];
    if (defs.length === 0) continue; // never scanned / no tools → nothing to grant
    catalog.set(summary.id, {
      serverName: summary.name,
      tools: defs.map(
        (t): NormalizedToolDefinition => ({
          name: t.toolName,
          ...(t.description !== undefined ? { description: t.description } : {}),
          ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
          ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
          raw: t.rawTool,
        }),
      ),
    });
    grantServers[summary.id] = grant;
    grantServerNames.set(summary.id, summary.name);
  }
  if (Object.keys(grantServers).length === 0) return null;

  const sessions = new Map<string, McpSession>();
  // hub-fixes WP1.3 (RC3.4) — every server this turn ATTEMPTED to open, connected or not. Always
  // returned (even when every attempt failed) so the caller can surface the drop instead of silently
  // falling back to built-ins with no explanation.
  const serverStatuses: HubMcpServerStatusEntry[] = [];
  for (const serverId of Object.keys(grantServers)) {
    const serverName = grantServerNames.get(serverId) ?? serverId;
    const outcome = await getHubMcpSession(serverId);
    if (outcome.session) {
      sessions.set(serverId, outcome.session);
      serverStatuses.push({ serverId, serverName, status: "connected" });
    } else {
      delete grantServers[serverId]; // unreachable this turn — don't expose tools we can't route
      catalog.delete(serverId);
      serverStatuses.push({
        serverId,
        serverName,
        status: "error",
        message: outcome.reason,
        ...(outcome.authRequired ? { authRequired: true } : {}),
      });
    }
  }

  // hub-fixes WP1.2 (RC3.5) — honor the scope's `builtins` selection too (previously always
  // `DEFAULT_CHAT_BUILTIN_NAMES`, ignoring a scoped session's own choice). Absent scope OR an
  // explicit empty list both fall back to the full default set — an empty `builtins: []` must never
  // brick a session down to zero built-ins. Mirrors `hub/routes.ts`'s `buildHubContextMcpCatalogProvider`
  // (the context inspector's read-only snapshot of this same rule).
  const builtins = scope && scope.builtins.length > 0 ? scope.builtins : DEFAULT_CHAT_BUILTIN_NAMES;

  // hub-fixes WP1.3 (RC3.4) — even when EVERY granted server failed to open, this still returns a real
  // result (never `null`): `catalog`/`grantServers` end up empty either way, so the resulting toolset is
  // built-ins-only regardless — the ONLY thing returning non-null here changes is that `serverStatuses`
  // (and therefore the status events + the prompt's "Unreachable this turn" line) reach the caller
  // instead of being silently thrown away with the old `if (sessions.size === 0) return null`.
  return {
    grants: { servers: grantServers, builtins },
    catalog,
    sessions,
    // v1 metering seam: the hub turn engine already persists tool_call/tool_result events; per-call
    // request/response token accounting (R-MCP7 metering) is a later WP — a no-op sink for now.
    sink: { toolCall: () => {} },
    serverStatuses,
  };
}

// Assistant Hub session service (WP1.1) — constructed HERE (moved down from the repository init by the
// WP1.5 orchestrator seam-close) so `subscriptionExecutor` binds the live `claude_subscription` adapter:
// the AgentSessionDriver loop under the SHARED D-CS10 `.runs` gate (never `.shared`), reusing the same
// `resolveJudgeAuth` seam the Testing/dock subscription paths use. AI-SDK kinds resolve via
// `createHubModelResolver`; WP1.4 wires the MCP grant provider + the citation apparatus (§1.7).
const hubSessionService = new HubSessionService({
  repository: hubRepository,
  tokenCounter: getTokenCounter(config.defaultTokenProfile),
  // model-identity WP2.1 (D-MI1) — the resolver now honors an explicit `providerCredentialId` (the
  // session's persisted pin / a per-message override) and only falls back to the model-name heuristic
  // when none is pinned; `server.log` makes that fallback visible instead of silent.
  resolveModel: createHubModelResolver(providerRepository, server.log),
  mcpGrantsProvider: (ctx) => resolveHubMcpGrants(ctx.session),
  // Assistant Hub skill attachment (WP2.4, R-SK1…R-SK3) — session-level attachments (`hub_session_skills`,
  // read via `hubRepository`) resolved against the SAME `SkillRepository` instance the Skills feature
  // and the dock's assistant tools already share (`skills`, constructed above). Always resolvable
  // (never gated on a live connection, unlike MCP grants) — a deleted skill/version is simply skipped
  // (`resolveHubSkillAttachments`), never breaks the turn.
  skillCatalogProvider: (ctx) => {
    // End-user UX pass — session-level skill scope. "Pick" (the modal attached a specific set, or the
    // Skills panel did) ⇒ that set only. "Auto" (no attachments) ⇒ offer the FULL skill registry so the
    // model can pick skills by prompt (the Claude-Desktop default the owner asked for). Either way the
    // model still only LOADS on demand (L1 catalog + `skills.load`), budget-demoted — nothing eager.
    const attached = hubRepository.listSessionSkills(ctx.session.id);
    const attachments: HubSkillAttachment[] =
      attached.length > 0
        ? attached
        : skills.list().map(
            (s): HubSkillAttachment => ({
              skillId: s.id,
              versionMode: "latest",
              invocationMode: "model_invocable",
            }),
          );
    return { resolved: resolveHubSkillAttachments(skills, attachments), reader: skills };
  },
  beginCitationTurn: beginHubCitationTurn,
  subscriptionExecutor: createHubSubscriptionAdapter({
    repository: hubRepository,
    driver: new SdkAgentSessionDriver(),
    resolveAuth: () => assistantAuth.resolveJudgeAuth(),
    concurrency: subscriptionConcurrency.runs,
    // model-identity WP3.2 (D-MI3) — the session's granted MCP servers, translated into Agent-SDK
    // `mcpServers` + `mcp__<serverId>__<toolName>` allow patterns. Same grant rule as
    // `resolveHubMcpGrants` above (scoped session ⇒ its listed servers; auto ⇒ every scanned server),
    // but NO `McpSession` is opened: the SDK child connects/spawns them itself (D-CS9). Decrypted
    // stdio env / http auth headers therefore go into the CHILD's config only — never to the web,
    // never logged (`.claude/rules/mcp-and-security.md`).
    resolveMcpTools: createHubSubscriptionMcpResolver({
      listServers: () => servers.list(),
      getServerConfig: (serverId) => servers.getInternal(serverId),
      listScannedToolNames: (serverId) =>
        (scans.getLatestForServer(serverId)?.tools ?? []).map((tool) => tool.toolName),
      oauthAccessToken: (serverConfig) =>
        isOAuthHttpServer(serverConfig)
          ? oauthService.createProvider(serverConfig.id).tokens()?.access_token
          : undefined,
      logger: { warn: (message) => server.log.warn(message) },
    }),
    // web-access-fix (2026-07-27) — the SAME kill switch the AI-SDK path's `composeWebTools` reads, so
    // `HUB_WEB_TOOLS=off` removes the web tools on BOTH executors. On (the default) the adapter blocks
    // its hub list, which permits the SDK's native `WebSearch`/`WebFetch` — without this a
    // subscription-backed session had no internet at all (see `HUB_SUBSCRIPTION_DISALLOWED_TOOLS`).
    webToolsEnabled: config.hubWebToolsEnabled,
    logger: { warn: (message) => server.log.warn(message) },
  }),
  // hub-fixes WP6.1 (RC7) — the `auto`-mode chat-vs-mission ROUTING BRIDGE seam: when a top-level `auto`
  // session's routing turn calls the `mission.propose_plan` builtin, `dispatchMessage` hands the ask to
  // the mission orchestrator here (proposal streams over the same sink; the autonomy gate still governs
  // launch). `hubMissionService` is declared just below — this closure only reads it at turn time (long
  // after construction), so it breaks the session-service↔mission-service construction cycle cleanly.
  // `echoUserMessage: false` because `dispatchMessage` already persisted the ask before the routing turn.
  proposeMissionForTurn: async ({ sessionId, text, sink }) => {
    await hubMissionService.proposePlan({ sessionId, text, sink, echoUserMessage: false });
  },
  // End-user UX pass — the `@`-mention HANDOFF bridge: a message that mentions saved agents hands the ask
  // to the mission orchestrator as a deterministic explicit-agent team (approve-first — the autonomy dial
  // still gates launch). Same construction-cycle-breaking closure shape as `proposeMissionForTurn`;
  // `echoUserMessage: false` because `dispatchMessage` already persisted the ask.
  handoffToAgentsForTurn: async ({ sessionId, text, agentIds, sink }) => {
    await hubMissionService.proposePlan({ sessionId, text, sink, agentIds, echoUserMessage: false });
  },
  config: {
    maxActiveSessions: config.hubMaxActiveSessions,
    idleReleaseMs: config.hubSessionIdleReleaseMs,
    autoTitle: config.hubAutoTitle,
    dataDir: config.dataDirectory,
    toolLoadingDefault: config.hubToolLoadingDefault,
    autoFraction: config.hubToolSearchAutoFraction,
    // hub-fixes WP1.1 follow-up (carried into WP1.3, which owns the rest of this file's hub-fixes
    // edits): thread the two env OVERRIDES through — `HubSessionServiceConfig.eagerMaxTokens`/
    // `promoteMaxTokens` were added in WP1.1 but never wired here, so `HUB_TOOL_EAGER_MAX_TOKENS`/
    // `HUB_TOOL_PROMOTE_MAX_TOKENS` were inert (only the service's own built-in defaults applied).
    eagerMaxTokens: config.hubToolEagerMaxTokens,
    promoteMaxTokens: config.hubToolPromoteMaxTokens,
    skillListingBudgetFraction: config.hubSkillListingBudgetFraction,
    skillEntryMaxChars: config.hubSkillEntryMaxChars,
    skillLoadBudgets: {
      perSkillTokens: config.hubSkillCompactionTokensPerSkill,
      totalTokens: config.hubSkillCompactionTokensTotal,
    },
    // WP2.3 — the live-HITL autonomy dial applied when a session sets none (D-AH6/R-MCP3).
    defaultAutonomy: config.hubDefaultAutonomy,
    // WP2.6 — the bounded declarative-GenUI repair-loop budget (R-GUI4).
    genuiMaxRepairAttempts: config.hubGenuiMaxRepairAttempts,
    // WP3.3 — context-window compaction (R-SES8): compact at 75% of the window, keeping 4 recent turns
    // hot. The summarizer defaults to the deterministic offline one (no `summarizer` dep wired) — the
    // constraint-recall fidelity guarantee holds regardless of the summarizer.
    compactionThresholdFraction: config.hubCompactionThresholdFraction,
    compactionKeepRecentTurns: config.hubCompactionKeepRecentTurns,
    // WP3.1 — the project instructions + pinned files LAYER 6b injection cap (D-AH11c).
    projectContextMaxChars: config.hubProjectContextMaxChars,
    // WP3.4 — the live MCP output-cap thresholds (R-MCP7).
    outputCapWarnTokens: config.hubMcpOutputWarnTokens,
    outputCapMaxTokens: config.hubMcpOutputMaxTokens,
    // hub-fixes WP5.1 — the web-tools kill switch (`HUB_WEB_TOOLS=off` removes web.search + web.fetch).
    webToolsEnabled: config.hubWebToolsEnabled,
  },
  // assistant-hub v1-fixes (F6) — the app-level `web.search` fallback chain (Tavily → Serper →
  // SearXNG → DuckDuckGo), used whenever the session's model has no provider-native search so every
  // model kind gets working web search. Kill-switched together with the rest of the web tools.
  ...(config.hubWebToolsEnabled
    ? {
        webSearchFallback: createFallbackWebSearchTool({
          ...(config.hubSearchTavilyKey ? { tavilyKey: config.hubSearchTavilyKey } : {}),
          ...(config.hubSearchSerperKey ? { serperKey: config.hubSearchSerperKey } : {}),
          ...(config.hubSearxngUrl ? { searxngUrl: config.hubSearxngUrl } : {}),
          duckduckgo: config.hubSearchDuckduckgo,
        }),
      }
    : {}),
});
// Assistant Hub mission orchestrator (WP1.7) — extends the hub with propose → approve → parallel child
// sessions → synthesis (D-AH6/8/9). Hard caps + autonomy thresholds come from env; the model seams
// build AI-SDK models from the SAME provider store the session service resolves from. `hubBuildModel`
// throws for a model with no AI-SDK builder (e.g. a subscription model) — the planner should prefer
// API-keyed models for wide fan-outs (README §6 memory wall).
// model-identity WP2.1 (D-MI1) — the optional second parameter is the credential that OWNS `modelId`
// (a planned agent's / a role's `providerCredentialId`). Additive: every existing call site passes one
// argument and keeps the unchanged heuristic, and the `(modelId: string) => LanguageModel` seam type the
// orchestrator's planner/agent-runner/synthesizer/judge declare is still satisfied.
const hubBuildModel = (modelId: string, providerCredentialId?: string) => {
  // `createHubModelResolver` is synchronous (it reads the in-memory provider store) — the resolver's
  // wire type allows a Promise for future async resolvers, but this production one never returns one.
  const resolution = createHubModelResolver(
    providerRepository,
    server.log,
  )(modelId, providerCredentialId) as HubModelResolution;
  if (!resolution.buildModel) {
    throw new Error(
      `Model "${modelId}" cannot back a mission agent (no AI-SDK model builder — e.g. a subscription model).`,
    );
  }
  return resolution.buildModel();
};
// The mission-planner MODEL ROSTER (LAYER 8, D-AH6) — the live, tier-tagged list of the SAME models a
// user can assign to a hub agent (every hub-eligible credential's roster, `GET /api/providers/:id/models`),
// so the planner routes each agent to a REAL model id instead of emitting a bare tier label like
// `"balanced"` (the bug this fixes). Cached briefly (per-credential lists are already cached in the
// ProviderService); a failing credential is tolerated (`Promise.allSettled`) and an empty/failed roster
// returns undefined — the orchestration layer then renders its placeholder and the `normalizePlannedModels`
// guard still prevents a tier label from reaching a child session.
let hubMissionRosterCache: { text: string | undefined; expiresAt: number } | undefined;
const HUB_MISSION_ROSTER_TTL_MS = 60_000;
async function buildHubMissionModelRoster(): Promise<string | undefined> {
  const now = Date.now();
  if (hubMissionRosterCache && hubMissionRosterCache.expiresAt > now) return hubMissionRosterCache.text;
  let text: string | undefined;
  try {
    const settled = await Promise.allSettled(
      hubEligibleCredentials(providerRepository).map(async (credential) => ({
        kind: credential.kind,
        credentialId: credential.id,
        models: await providers.listModels(credential.id, subscriptionModelResolver),
      })),
    );
    // model-identity WP4.2 (D-MI8, blast-radius rows 15+16) — dedupe per CREDENTIAL × model, not on the
    // bare model id. The old global `seen.has(model.id)` swallowed one of every colliding twin (the
    // subscription roster deliberately emits Anthropic's canonical ids), so the planner was shown only
    // ONE `claude-sonnet-5` and *which* one flipped with `ORDER BY updated_at DESC` — the exact defect
    // the web roster had. Each surviving entry carries its `credentialId`, which `formatModelRoster`
    // renders as a `pin=` ONLY for an ambiguous id.
    const seen = new Set<string>();
    const rosterModels: HubRosterModel[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const model of result.value.models) {
        const key = `${result.value.credentialId}::${model.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rosterModels.push({
          modelId: model.id,
          kind: result.value.kind,
          credentialId: result.value.credentialId,
          ...(model.displayName ? { displayName: model.displayName } : {}),
          tier: tierForModel(model.id, result.value.kind),
        });
      }
    }
    text = rosterModels.length > 0 ? formatModelRoster(rosterModels) : undefined;
  } catch {
    text = undefined;
  }
  hubMissionRosterCache = { text, expiresAt: now + HUB_MISSION_ROSTER_TTL_MS };
  return text;
}
const hubMissionService = new HubMissionService({
  repository: hubRepository,
  config: {
    maxAgents: config.hubMissionMaxAgents,
    maxParallel: config.hubMissionMaxParallel,
    defaultBudgetUsd: config.hubMissionDefaultBudgetUsd,
    maxBudgetUsd: config.hubMissionMaxBudgetUsd,
    // crew-nesting (D-CN3/D-CN10) — the nested-crew-tree hard caps; parsed/threaded only here (no
    // enforcement yet — that lands in WP 1.1/2.1/2.2).
    maxDepth: config.hubMissionMaxDepth,
    maxTotalAgents: config.hubMissionMaxTotalAgents,
    askAboveAgents: config.hubAutonomyAskAboveAgents,
    askAboveUsd: config.hubAutonomyAskAboveUsd,
    defaultAutonomy: config.hubDefaultAutonomy,
    // hub-fixes WP2.1 (RC2, D-HF7) — the agent-runner selector wired to `HUB_AGENT_RUNNER`. `session`
    // (default) runs the turn-engine-based runner just below; `structured` keeps the old one-shot path.
    agentRunnerMode: config.hubAgentRunner,
    // hub-fixes WP2.5 (D-HF6) — the always_ask mission board-approval auto-deny budget (env
    // `HUB_MISSION_APPROVAL_TIMEOUT_S`, seconds → ms): a mission must terminate, never stall on a card.
    missionApprovalTimeoutMs: config.hubMissionApprovalTimeoutS * 1000,
    // hub-fixes WP3.2 (RC4, D-HF4) — the mission-synthesis path selector wired to `HUB_SYNTHESIS_MODE`.
    // `turn` (default) runs the synthesis as a REAL turn of the parent session with GenUI tools (the
    // `runSynthesisTurn` seam below); `text` forces the pre-fix tool-less `generateText` synthesizer.
    synthesisMode: config.hubSynthesisMode,
    // hub-fixes (Defect 2) — optional override (env `HUB_MISSION_EXTRACTION_MODEL`) for the model that
    // extracts a mission agent's structured report. Absent ⇒ the parent/mission model (set per-agent by
    // the orchestrator), so a facade agent-model never runs the extraction call on itself.
    ...(config.hubMissionExtractionModel
      ? { missionExtractionModel: config.hubMissionExtractionModel }
      : {}),
    // assistant-hub v1-fixes (F1) — optional override (env `HUB_MISSION_SYNTHESIS_MODEL`) for the mission
    // SYNTHESIS turn's model; absent, the orchestrator prefers the parent session's structured-capable
    // model and never lets an `assistant|…` facade model run the synthesis blind.
    ...(config.hubMissionSynthesisModel
      ? { missionSynthesisModel: config.hubMissionSynthesisModel }
      : {}),
    // hub-fixes (Defect 4) — the OVERALL per-agent wall cap (env `HUB_MISSION_AGENT_MAX_DURATION_S`, s→ms;
    // 0 ⇒ off): a wedged agent can't stall the whole parallel join.
    agentMaxDurationMs: config.hubMissionAgentMaxDurationS * 1000,
  },
  planner: createStructuredPlanner({ buildModel: hubBuildModel }),
  // The LAYER-8 model roster (see `buildHubMissionModelRoster` above): the planner is shown the live,
  // tier-tagged list of assignable models so it emits a concrete model id per agent, not a tier label.
  roster: () => buildHubMissionModelRoster(),
  // model-identity WP4.2 (D-MI4) — the one fact a model id cannot carry: which PROVIDER runs a planned
  // agent. EVERY credential is listed, not just the hub-eligible ones, because this map doubles as the
  // known-id set a hallucinated (or since-deleted) planner pin is stripped against — narrowing it would
  // turn a deliberate-but-ineligible pin into a silent swap instead of the resolver's honest 409 (D-MI9).
  // A cheap in-memory read of the provider store; no decryption, no secret ever leaves it.
  providerCredentialKinds: () =>
    new Map(providerRepository.list().map((credential) => [credential.id, credential.kind])),
  // hub-fixes WP2.3 (RC2.4) — supply the parent session's reachable, scope-aware MCP catalog so
  // `proposePlan` injects the "Grantable MCP servers" section (WP2.2) into the planner prompt and
  // strips hallucinated server ids at propose time. This is the live activation of the propose-path
  // grant proposal that WP2.2/2.3 built + stub-tested at the service level.
  mcpCatalog: resolveReachableMcpCatalog,
  // hub-fixes (Defect 1c) — the pre-run readiness gate's server-auth probe (over `servers` + `oauthService`,
  // keeping the orchestrator MCP/OAuth-free): block a mission whose plan grants an unauthenticated server
  // instead of spawning a tool-less agent.
  isServerRunReady: isHubServerRunReady,
  // hub-fixes WP2.1 (RC2, D-HF7) — the turn-engine agent runner (production default): each planned agent
  // runs as a REAL child hub session through `hubSessionService.runAgentTurn` (granted MCP tools callable,
  // real usage/cost, live transcript) then a bounded structured extraction yields the report. `structured`
  // (the rollback env) keeps the tool-less one-shot generateObject runner wired for one release (D-HF7).
  runAgent:
    config.hubAgentRunner === "structured"
      ? createStructuredAgentRunner({ buildModel: hubBuildModel })
      : createSessionAgentRunner({
          runAgentTurn: (turnInput) => hubSessionService.runAgentTurn(turnInput),
          repository: hubRepository,
          buildModel: hubBuildModel,
          // hub-fixes (Defect 4) — bound the post-turn extraction (env `HUB_MISSION_EXTRACTION_TIMEOUT_S`,
          // s→ms) so a hung provider call can't freeze the mission; on timeout it falls back to projection.
          extractionTimeoutMs: config.hubMissionExtractionTimeoutS * 1000,
        }),
  synthesizer: createTextSynthesizer({ buildModel: hubBuildModel }),
  // hub-fixes WP3.2 (RC4, D-HF4) — the synthesis-TURN seam: the mission's final answer runs as a REAL turn
  // of the parent session through `hubSessionService.runSynthesisTurn` (GenUI `present` tools granted, MCP
  // tools NOT — synthesis reasons over the reports), so the answer can use widgets plus prose. On any
  // failure (or `HUB_SYNTHESIS_MODE=text`) the `synthesizer` text path above is used unchanged.
  runSynthesisTurn: (input) => hubSessionService.runSynthesisTurn(input),
  // WP2.2 — the BLIND judge for the best_of_n topology (D-AH6): a structured-output call that ranks
  // ANONYMIZED attempts (label + body only — never the authoring model/role, R-SK7).
  judge: createStructuredJudge({ buildModel: hubBuildModel }),
  // WP2.2 — resolve a SAVED CREW (D-AH7) + its member roles for deterministic instantiation (a mission
  // proposed with a `crewId` expands the crew here instead of running the planner model). Unresolvable →
  // undefined (the service 404s a bad crewId).
  resolveCrew: (crewId) => {
    try {
      const crew = hubRepository.getCrew(crewId);
      const wanted = new Set(crew.members.map((member) => member.agentId));
      const roles = hubRepository
        .listAgentRoles({ includeArchived: true })
        .filter((role) => wanted.has(role.id));
      return { crew, roles };
    } catch {
      return undefined;
    }
  },
  // End-user UX pass — resolve the session's Agents & Crews ROSTER (the new-session "Agents & Crews"
  // tab) into concrete saved roles + resolved crews, for the planner's PREFERRED-POOL seeding + role
  // hydration. One role listing (includeArchived) is shared across both arrays. A deleted/unknown agent
  // or crew id is silently dropped (resolution parity with resolveCrew); a crew whose member roles were
  // ALL hard-deleted (no resolvable role left to reuse) is also dropped — so it never becomes an empty,
  // non-reusable crew line in the planner prompt and an all-gone roster falls back to prior behavior.
  resolveRoster: (roster) => {
    const allRoles = hubRepository.listAgentRoles({ includeArchived: true });
    const roleById = new Map(allRoles.map((role) => [role.id, role]));
    const roles = roster.agentIds
      .map((id) => roleById.get(id))
      .filter((role): role is NonNullable<typeof role> => role !== undefined);
    const crews = roster.crewIds
      .map((crewId) => {
        try {
          const crew = hubRepository.getCrew(crewId);
          const wanted = new Set(crew.members.map((member) => member.agentId));
          const crewRoles = allRoles.filter((role) => wanted.has(role.id));
          if (crewRoles.length === 0) return undefined; // every member role deleted → nothing to reuse
          return { crew, roles: crewRoles };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    return { roles, crews };
  },
  // End-user UX pass — resolve the prompt's `@`-mentioned agent ids into their saved roles for a
  // deterministic team handoff. Order preserved; a deleted/unknown id is dropped (the orchestrator 400s
  // if nothing resolves). Uses the same includeArchived listing as resolveCrew/resolveRoster.
  resolveAgents: (agentIds) => {
    const roleById = new Map(
      hubRepository.listAgentRoles({ includeArchived: true }).map((role) => [role.id, role]),
    );
    return agentIds
      .map((id) => roleById.get(id))
      .filter((role): role is NonNullable<typeof role> => role !== undefined);
  },
  // Assistant Hub skill attachment (WP2.4, R-SK3) — a planned agent's `skillIds` preload FULL L2 bodies
  // into its isolated brief (the subagent-skills pattern), over the SAME `skills` SkillRepository the
  // session-level catalog resolves from above.
  resolveRoleSkills: (skillIds) => formatRoleSkillsContent(skills, skillIds),
  logger: { warn: (msg) => server.log.warn(msg) },
});
// The LIVE Claude-subscription model roster resolver (roadmap/claude-subscription/ follow-up): asks the
// Agent SDK's `Query.supportedModels()` (the CLI picker's own source) through a SHORT-LIVED child,
// caches it (~1h, keyed on the sign-in), and draws that ~1 GiB child from the SAME shared runs+judge gate
// so it can't blow the memory budget alongside runs/judges. ANY error/timeout/not-signed-in → the static
// `ASSISTANT_DEFAULT_MODEL_ROSTER` fallback. It backs THREE surfaces below: the provider Model dropdown
// (`registerProviderRoutes`), the Assistant dock roster (`registerAssistantRoutes`), and the run-path
// unknown-model guard (`new RunService(...)` — reads its cache only, no hot-path spawn).
const subscriptionModelResolver = new SubscriptionModelResolver({
  driver: new SdkAgentSessionDriver(),
  resolveAuth: () => assistantAuth.resolveJudgeAuth(),
  gate: subscriptionConcurrency.shared,
});
const cliAvailable = (): boolean => assistantAuth.resolveJudgeAuth() !== null;
const resolveCliModel = (): string => resolveCliJudgeModel(appSettings);
const resolveProviderJudge = (): ReturnType<typeof readProviderJudge> =>
  readProviderJudge(appSettings);
const judgeChainGenerate = createJudgeChainGenerate({
  cliGenerate: createClaudeCliJudgeGenerate({
    driver: new SdkAgentSessionDriver(),
    resolveJudgeAuth: () => assistantAuth.resolveJudgeAuth(),
    // D-CS10 — the judge draws on `.shared`. Unified Sessions (WP1.4/WP1.7, D-US6) DECOUPLED the
    // subscription RUN path from this gate: `new RunService(..., subscriptionConcurrency)` below now
    // acquires the SEPARATE `.runs` gate, not `.shared` — so a suite of runs can no longer contend
    // with (or starve) an in-flight judge here.
    gate: subscriptionConcurrency.shared,
  }),
  providerGenerate: createProviderJudgeGenerate(providers),
  cliAvailable,
  resolveCliModel,
  resolveProviderJudge,
});
const resolveChainJudge = chainJudgeResolver({
  cliAvailable,
  resolveCliModel,
  resolveProviderJudge,
});
const outcomeJudge = createOutcomeJudge({
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});
// The trajectory judge (WP 2.2, B6.2) shares the SAME judge chain; it only grades runs whose test
// carries `expectations.referenceLogic` (its `appliesTo` skips the rest with no wasted judge call). Its
// cost also lands ONLY in the run_grades judge_* ledger (B5).
const trajectoryJudge = createTrajectoryJudge({
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});
// Auto-Rating base-rating graders (WP 1.3/1.4) — the three ALWAYS-ON `mandatory` graders
// (`error_forensics`/`answer_validation`/`insight_surplus`, see `BASE_RATING_GRADER_IDS`). They run on
// EVERY terminal run (AR5), gated only by `AUTO_RATING_ENABLED`; their LLM cost lands ONLY in the
// run_grades judge_* ledger (B5/AR13). They share the SAME CLI-first chain as the outcome/trajectory
// judges (WP 2.3). The deterministic parts (the forensics inventory) run judge-independently.
const errorForensics = createErrorForensicsGrader({
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});
const answerValidation = createAnswerValidationGrader({
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});
const insightSurplus = createInsightSurplusGrader({
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});
const graderRoster = [
  ...DETERMINISTIC_GRADERS,
  new ToolHygieneGrader(scans),
  new SkillflowConformanceGrader(),
  outcomeJudge,
  trajectoryJudge,
  errorForensics,
  answerValidation,
  insightSurplus,
];
const gradeService = new GradeService(gradeRepository, testService, runRepository, graderRoster, {
  // Auto-Rating ops kill-switch (WP 1.2, AR5) — false skips the mandatory base-rating graders only.
  autoRatingEnabled: config.autoRatingEnabled,
  // Observability (WP3.1, D-OB17) — real runs persist the `rating` span + `judge_call` children (the
  // step tree WP3.2 renders). Off by default in the service so direct-construction grading tests are
  // unaffected; turned on here for the running server.
  emitReviewSpans: true,
});

// --- Rating Issues registry (Auto-Rating follow-on): DISTINCT, deduplicated, persistent issues
// against the skills / MCP servers a run used, distilled from every rated run's error_forensics
// findings (occurrences link the contributing runs; open → resolved → automatic re-open). Dedup is
// one triage call per finding-target pair through the SAME CLI-first judge chain instances the
// graders use (AR2 — resolveChainJudge/judgeChainGenerate above), with a deterministic
// (bucket, fixTarget) fallback so no finding is ever lost. Wired into the RunService post-grading
// hook + the manual re-grade route below; processing NEVER affects run completion or grading.
const ratingIssueRepository = new RatingIssueRepository(db);
const ratingIssueService = new RatingIssueService({
  issues: ratingIssueRepository,
  runs: runRepository,
  grades: gradeRepository,
  scenarios: scenarioService,
  servers,
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});

// --- Benchmarks (WP 4.1): collections. A Collection binds tests/suites to a git repo (B10); the PAT
// is encrypted (reusing the shared `secretStore`) and never returned. Constructed HERE (ahead of the
// run engine) because the Observability watch engine's collection actions reuse it.
const collectionRepository = new CollectionRepository(db, secretStore);
const collectionService = new CollectionService(collectionRepository);

// --- Observability (WP4.1, D-OB19/D-OB21): watch rules — "when a run matches F, do A", evaluated at
// the SINGLE post-terminal choke point (run-service.ts `reviewRun`) as strictly POST-HOC OBSERVERS.
// The webhook URL is held ENCRYPTED (reusing `secretStore`); the CLOSED action set reuses the existing
// pin/collection/grade/test-create services (no reimplementation).
const watchRuleRepository = new WatchRuleRepository(db, secretStore);

// --- Observability (WP4.3, D-OB19): the notification center — UNBLOCKS the WP4.1 `notify` seam below
// (it was left `undefined`; the `notify` action already calls it when present, so this is the whole
// wire-up — NO change to watch/engine.ts or watch/actions.ts). `notificationHub` is the process-wide
// pub/sub `GET /api/notifications/stream` subscribes to; `createNotifySink` turns a fired `notify`
// action into a persisted row + a hub publish. The WP4.2 windowed evaluator shares the SAME
// `watchActionServices.notify` below, so a windowed rule's fire lands a notification for free.
const notificationRepository = new NotificationRepository(db);
const notificationHub = new NotificationHub();
const notifySink = createNotifySink({
  repository: notificationRepository,
  hub: notificationHub,
  getRunSummary: (runId) => runRepository.getSummary(runId),
});

// --- Observability (WP5.1, D-OB20): fleet issue aggregation — the DETERMINISTIC sweep that clusters
// recurring `error_forensics` findings ACROSS runs into first-class fleet issues (open/resolved/
// regressed lifecycle, occurrence counts, affected entities, per-day trend). NO LLM (that's the opt-in
// WP5.2). It EXTENDS the v26 rating-issues registry (fleet issues carry a `cluster_key`; the per-run
// auto-rating pipeline above is untouched). The `regressed` auto-reopen reuses the WP4.3 notification
// infrastructure directly (a warning notification, persisted + hub-published). Rides the scheduler tick
// below AND the on-demand `POST /api/issues/sweep`.
const issueSweepService = new IssueSweepService({
  issues: ratingIssueRepository,
  runs: runRepository,
  grades: gradeRepository,
  scenarios: scenarioService,
  servers,
  notifyRegression: (notice) => {
    const notification = notificationRepository.create({
      severity: "warning",
      title: `Issue regressed: ${notice.title}`,
      body: `A resolved recurring issue on ${notice.targetKind === "skill" ? "skill" : "MCP server"} "${notice.targetName}" reappeared in run ${notice.runId}.`,
      linkPath: `/dashboard?tab=issues&issue=${notice.issueId}`,
      runId: notice.runId,
    });
    notificationHub.publish(notification);
  },
});

// --- Observability (WP5.2, D-OB20): LLM assist for issue clustering — the OPT-IN pass OVER the
// deterministic fleet clusters. It merges near-duplicate fleet issues (reversibly), writes human
// titles/summaries, and SUGGESTS a priority — through the SAME CLI-first judge chain the graders use
// (`resolveChainJudge`/`judgeChainGenerate`), but on its OWN concurrency (a private
// `AsyncSemaphore(config.issueAssistMaxConcurrency)`, DELIBERATELY separate from the Auto-Rating
// CLI-judge budget — the Q7 lesson) and its OWN cost ledger (the assist overlay in `app_settings`, kept
// apart from run + grade cost — B5). OFF by default: it runs only via the manual refine endpoints, or
// after each sweep when `ISSUE_ASSIST_AFTER_SWEEP=true` (guarded so an assist error never breaks the
// sweep). It NEVER mutates the deterministic `rating_issues` rows — the cluster keys keep accruing
// underneath, an unmerge fully restores, AI text is marked, and the suggested priority never auto-applies.
const issueAssistService = new IssueAssistService({
  issues: ratingIssueRepository,
  store: new IssueAssistStore(appSettings),
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
  gate: new AsyncSemaphore(config.issueAssistMaxConcurrency),
  enabledAfterSweep: config.issueAssistEnabledAfterSweep,
});

// --- Observability (WP5.4, D-OB20): the assistant issue-loop verification-run link store. A plain
// `app_settings` JSON document (NO schema change) mapping each issue to the fork re-runs launched to
// prove a fix, so the issue detail can show "verification runs". Read by the assistant's `runs_rerun`
// tool (which records the link) and the `GET /api/issues/:id/verification-runs` route below.
const issueVerificationStore = new IssueVerificationStore(appSettings);

// --- Observability (WP5.5, D-OB22): the scheduled digest report — a window-over-window briefing
// (headline counts, movers, notable runs, issue churn) built ENTIRELY from the WP1.2 metrics services +
// the WP5.1 issues registry (DERIVED-ONCE — `reports/digest.ts` composes, never re-aggregates). Rides
// the SAME singleton scheduler ticker as the windowed eval + the WP5.1 sweep (below), via the additive
// `onDigest` seam; delivery reuses the WP4.3 notification infrastructure directly (severity `info`,
// deep-linked to the routed digest view — QUIET, badge not toast, mirroring the regression notice above).
const digestRepository = new DigestReportRepository(db);
const digestSchedule = new DigestScheduleService(
  { db, runs: runRepository, issues: ratingIssueRepository },
  appSettings,
  digestRepository,
  (report) => {
    const notification = notificationRepository.create({
      severity: "info",
      title: `${report.windowKind === "daily" ? "Daily" : "Weekly"} digest ready`,
      body: `${report.headline.runs.current} runs · ${report.newIssues.length} new issue${report.newIssues.length === 1 ? "" : "s"} · ${report.movers.length} mover${report.movers.length === 1 ? "" : "s"}.`,
      linkPath: `/reports/digest/${report.id}`,
      late: report.late,
    });
    notificationHub.publish(notification);
  },
);

const watchActionServices: WatchActionServices = {
  pinRun: (runId) => {
    runRepository.setPinned(runId, true);
  },
  addRunToCollection: (runId, collectionId) => {
    const run = runRepository.getSummary(runId);
    collectionService.assignTest(collectionId, run.testId);
  },
  promoteRunToTest: (runId, collectionId) =>
    promoteRunToTest(
      { runs: runRepository, tests: testService, testRepo: testRepository },
      runId,
      collectionId,
    ),
  runGrader: async (runId, graderId) => {
    // An unknown graderId simply matches no registered grader (a benign no-op — the action audits ok
    // but appends nothing); a known one appends its grade (append-only, never a run-total mutation).
    await gradeService.gradeRun(runId, { graderIds: [graderId as GraderId] });
  },
  resolveWebhookUrl: (secretRef) => watchRuleRepository.resolveWebhookUrl(secretRef),
  notify: notifySink,
};
const watchEngine = new WatchEngine(watchRuleRepository, runRepository, watchActionServices);

// Observability (WP4.2, D-OB19) — WINDOWED rules: trailing-window thresholds evaluated by an in-process
// ticker. The evaluator DELEGATES all measure math to the WP1.2 metrics service (`computeRunMetrics`,
// reading `db`) — there is NO second aggregation path — and reuses the SAME action set + audit path as
// the on-terminal engine. The scheduler is a SINGLETON started after `listen()` (boot catch-up once,
// then every 5 min) and stopped by the graceful-shutdown module.
const watchWindowEvaluator = new WatchWindowEvaluator(db, watchRuleRepository, watchActionServices);
// The fleet-issue sweep (WP5.1) rides the SAME singleton ticker (boot catch-up once, then every tick)
// via the additive `onSweep` seam — independently guarded from the windowed evaluation. `nowMs` is the
// scheduler's injectable clock, so a fake-timer test drives the sweep deterministically.
const watchScheduler = new WatchScheduler({
  evaluator: watchWindowEvaluator,
  onSweep: (nowMs) => {
    issueSweepService.runSweep({ nowMs });
    // WP5.2 (OPT-IN) — run the LLM assist pass after the deterministic sweep ONLY when enabled (default
    // OFF). `maybeRunAfterSweep` is fully guarded (never throws, never blocks the sweep), so a fire-and-
    // forget call here can never affect the clustering — the assist is a strict post-hoc observer.
    void issueAssistService.maybeRunAfterSweep();
  },
  // WP5.5 — the scheduled digest tick (`DigestScheduleService.maybeGenerateDue`, a strict no-op when
  // the persisted schedule mode is `off`). Independently guarded by the scheduler itself.
  onDigest: (nowMs, opts) => {
    digestSchedule.maybeGenerateDue(nowMs, opts);
  },
  log: server.log,
});

const runService = new RunService(
  scenarioService,
  testService,
  providerRepository,
  servers,
  oauthService,
  runManager,
  runRepository,
  undefined,
  undefined,
  skills,
  gradeService,
  ratingIssueService,
  // Claude subscription run path (roadmap/claude-subscription/, WP 1.2). The run driver is the SAME
  // raw Agent-SDK driver kind the Auto-Rating CLI judge uses (a fresh instance — one driver per run).
  new SdkAgentSessionDriver(),
  // D-CS7 — subscription-ONLY auth: `resolveJudgeAuth()` reads the signed-in `claude_oauth`
  // subscription and NEVER consults the API-key fallback (see auth-service.ts), so a subscription RUN
  // can only run on the subscription; not signed in → `null` → the executor's honest `auth` error. It
  // reads the SAME credential the provider repo's `authBroken` signal + `buildAssistantSpawnEnv`
  // (judge path) consume, so "signed in?" means one thing everywhere.
  () => assistantAuth.resolveJudgeAuth(),
  // WP 2.1 (D-CS2) + Unified Sessions (WP1.4/WP1.7, D-US6) — the SAME pool whose `.shared` gate is
  // injected into the CLI judge above; `resolveClaudeSubscription` (run-service.ts) reads this pool's
  // SEPARATE `.runs` gate for a run's own concurrency (decoupled from the judge budget), plus the
  // per-provider gate that caps a single provider's runs regardless of which pool gate they draw on.
  subscriptionConcurrency,
  // The LIVE roster resolver (consumed here as a SupportedModelIdSource) — rejects a run whose selected
  // model the signed-in subscription does NOT offer, reading the resolver's CACHE only (no hot-path spawn).
  subscriptionModelResolver,
  // Observability (WP4.1) — the post-terminal watch-rule OBSERVER (fired once from `reviewRun`).
  watchEngine,
);

// --- Benchmarks (WP 3.1): suite CRUD. A suite is a first-class entity (ordered tests + default
// scenario set + config). --- WP 3.2 (B8): the test × scenario × repetition matrix ORCHESTRATOR.
const suiteRepository = new SuiteRepository(db);
const suiteService = new SuiteService(suiteRepository);
// Suite RUN persistence + the mass-run orchestrator. On restart, any suite run still marked
// running/pending lost its in-memory orchestrator → reconcile it to `error` (its child runs are
// separately reconciled to `aborted` above). Each cell is started as an ORDINARY run via
// runService.start (full persistence/replay/guardrails/auto-grading), so cells are isolated + graded
// with zero extra plumbing; the orchestrator only schedules (bounded), enforces the soft-stop cost cap,
// and rolls up derived aggregates.
const suiteRunRepository = new SuiteRunRepository(db);
const orphanSuiteRuns = suiteRunRepository.reconcileOrphans();
if (orphanSuiteRuns > 0) {
  server.log.warn({ orphanSuiteRuns }, "Marked orphaned running suite runs as error on startup");
}
const suiteRunManager = new SuiteRunManager();
// Auto-Rating (WP 4.1/4.2, AR7/AR10/AR11): the mandatory cross-run suite report (persisted, append-only).
// Generated by the orchestrator's post-`finish()` hook ONLY for suite runs with ≥2 members; a generation
// crash/slow rating degrades to a persisted `error`/`partial` row and NEVER touches the suite run. WP 4.2
// wires in the SAME judge-chain instances the graders use (`resolveChainJudge`/`judgeChainGenerate`,
// built above) so the per-test-group agreement calls (AR10, exactly one per group) share the CLI-first
// resolution + provenance; a judge failure degrades that group's facet honestly and never fails the report.
const suiteReportRepository = new SuiteReportRepository(db);
const suiteReportService = new SuiteReportService({
  suiteRuns: suiteRunRepository,
  runs: runRepository,
  grades: gradeRepository,
  reports: suiteReportRepository,
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});
const suiteOrchestrator = new SuiteOrchestrator(
  runService.start.bind(runService),
  runService.stop.bind(runService),
  runRepository,
  suiteRunRepository,
  suiteRepository,
  gradeRepository,
  suiteRunManager,
  // WP 5.1 — validate skill-effect variants (each `attach` skill/version still exists) up front, so a
  // deleted-skill variant fails the whole suite run at START rather than mid-suite.
  skills,
  // WP 4.1 — the post-`finish()` suite-report hook (never blocks/fails/mutates the suite run).
  (suiteRunId) => suiteReportService.generate(suiteRunId),
);
// --- Benchmarks (WP 3.5, B9.4): OPT-IN failure-bucket clustering. Now on the SAME CLI-first judge
// chain as every other LLM grading surface (AR2 — the signed-in Claude CLI is the default judge
// everywhere; a configured provider judge is the fall-through). Triggered ONLY by
// POST /api/suite-runs/:id/failure-buckets — NEVER auto-run. Its cost lands on the derived
// suite-aggregate judgeCostUsd ledger (grading side; CLI rows cost 0), never a run's cost; grades stay
// untouched.
const failureBucketService = new FailureBucketService({
  suiteRuns: suiteRunRepository,
  runs: runRepository,
  grades: gradeRepository,
  resolveJudge: resolveChainJudge,
  generate: judgeChainGenerate,
});

// (collectionRepository/collectionService are constructed ahead of the run engine above — the watch
// engine's collection actions reuse them.)
// --- Benchmarks (WP 4.2): two-way git sync (B11). Real-git export→commit→fetch→merge→push against a
// per-collection working clone under DATA_DIR/collections/<id> (never inside the repo tree). Uses the
// SHARED git-credential module (argv-only PAT, SSRF DNS guard, subprocess timeout, redacted errors);
// never force-pushes. The PAT is read internally via collectionRepository.decryptPat, never returned.
const collectionGitSync = new CollectionGitSyncService(
  db,
  collectionRepository,
  testRepository,
  suiteRepository,
  { baseDir: config.collectionsDir },
);
// --- Benchmarks (WP 4.4): one-way InsightBench import (B13). Converts a colleague's questions.json into
// graded tests + one suite (optionally into a collection). Import ONLY — no exporter (we never write his
// format back). Reuses the existing test/suite/collection repositories.
const insightBenchImporter = new InsightBenchImporter(
  testRepository,
  suiteRepository,
  collectionRepository,
);

// --- Skills (WP 1.3): upload ingestion + core registry routes ---
// Ingest caps (zip-bomb guard) shared by both ingestion paths; env-overridable via config.
const skillCaps = {
  maxFiles: config.skillMaxFiles,
  maxFileBytes: config.skillMaxFileBytes,
  maxTotalBytes: config.skillMaxTotalBytes,
};
const skillIngest = new SkillIngestService(skills, {
  dataDir: config.dataDirectory,
  tokenProfile: config.defaultTokenProfile,
  caps: skillCaps,
});
// App-wide GitHub account (Settings sign-in via the OAuth device flow): the LAST auth fallback for
// every skill GitHub operation. Token stored encrypted in the `app_settings` KV; never returned.
const githubAccount = new GithubAccountService(appSettings, secretStore);
const githubAccountToken = () => githubAccount.token();
const skillGit = new SkillGitService(skills, {
  dataDir: config.dataDirectory,
  tokenProfile: config.defaultTokenProfile,
  caps: skillCaps,
  accountToken: githubAccountToken,
});
const skillPublish = new SkillPublishService(skills, {
  dataDir: config.dataDirectory,
});
const skillPush = new SkillPushService(skills, {
  dataDir: config.dataDirectory,
});

// --- Assistant (WP 1.1): the session engine. Drives interactive threads on the Claude Agent SDK through
// the injected `AgentSessionDriver` seam (SdkAgentSessionDriver = the real `query()` streaming loop).
// `buildTools` defaults to the EMPTY in-process SDK MCP server; WP 1.2's real `buildAssistantTools`
// factory (+ its `toolContextBase` repo bag and canonical `renderEnvelope`) swaps in here with a one-line
// change post-merge. The sign-out kill-hook (WP 0.2 seam) ends every live session when the owner signs out.
// WP 1.2 wiring (orchestrator, post-merge): the real read toolset + canonical envelope renderer replace
// WP 1.1's empty-stub defaults. WP 1.2's tools are STATELESS reads over these repositories, so the
// static half of the bag closes over the repo handles directly; WP 2.2 adds the one STATEFUL exception
// (`threadId`, filled in per-session below) for the skill-workspace tools.
const assistantToolDeps: Omit<AssistantToolDeps, "threadId"> = {
  runs: runRepository,
  suiteRuns: suiteRunRepository,
  grades: gradeRepository,
  skills,
  scans,
  servers,
  tests: testRepository,
  environments: scenarioRepository,
  collections: collectionRepository,
  // WP 2.3 — the app-data write toolset's two additional deps (see tools/index.ts's
  // `AssistantToolDeps` banner): `testService` for blob-aware test delete/attachment writes,
  // `suites` (SuiteRepository) for suites_create/update/delete. Both instances already exist above
  // for the Testing/Benchmarks routes; reused here, not recreated.
  testService,
  suites: suiteRepository,
  // Cross-entity action tools (owner refinement): the live MCP bridge (`ScanService`, line ~163) for
  // `mcp_tools_list`/`mcp_tool_call`, and the Rating Issues registry for `rating_issue_file`/
  // `rating_issues_list`. Both already exist above for the scan/grading routes. See action-tools.ts.
  scanService,
  issues: ratingIssueRepository,
  // Observability WP5.4 — the issue-loop tools' two extra deps: `runService` (the live launcher
  // `runs_rerun` forks a linked run through) and `verification` (the app_settings-backed issue⇆run link
  // store the fork run is recorded on). Both already exist above; reused here, not recreated.
  runService,
  verification: issueVerificationStore,
  // Assistant-operability WP 3.1 — the Hub read tools' one dependency (hub_agents_list/
  // hub_crews_list/hub_usage_summary). The SAME `hubRepository` instance constructed above for the
  // Hub routes; reused here, not recreated.
  hub: hubRepository,
  // model-identity WP3.3 (D-MI10) — `hub_usage_summary` attributes spend to the credential a session is
  // PINNED to (`hub_sessions.provider_credential_id`), not a model-name guess. The SAME
  // `providerRepository` constructed above; reused here, not recreated (its `list()` is redacted).
  providers: providerRepository,
  assistantDataDir: config.assistantDataDir,
};
const assistantSessionManager = new AssistantSessionManager({
  repository: assistantRepository,
  providers: providerRepository,
  driver: new SdkAgentSessionDriver(),
  // WP 2.2 (D-AS13): thread the session's real threadId through so the workspace tools
  // (skills_open_workspace / skills_commit_workspace) resolve THIS thread's workspace root.
  buildTools: (ctx) => buildAssistantTools({ ...assistantToolDeps, threadId: ctx.threadId }),
  // Adapt 1.2's `renderContextEnvelope` (requires a defined envelope) to the manager's
  // EnvelopeRenderer (accepts `undefined` → empty block for an unpinned/global-dock message).
  renderEnvelope: (envelope) => (envelope ? renderContextEnvelope(envelope) : ""),
  config: {
    maxTurns: config.assistantMaxTurns,
    idleTimeoutMs: config.assistantIdleTimeoutMs,
    maxActiveSessions: config.assistantMaxActiveSessions,
    assistantDataDir: config.assistantDataDir,
    permissionTimeoutMs: config.assistantPermissionTimeoutMs,
    // R2.2 (D-AS25/D-AS26) — release-on-reply grace + auto-title refine settings.
    releaseGraceMs: config.assistantReleaseGraceMs,
    autoTitle: config.assistantAutoTitle,
    titleModel: config.assistantTitleModel,
    titleTimeoutMs: config.assistantTitleTimeoutMs,
    // R1.2 (D-AS20/D-AS21) — the bundled read-only skill-authoring reference dir, added to
    // additionalDirectories ONLY on a skill-scoped session start (session-manager.ts's startSession).
    assistantSkillAuthoringDir: config.assistantSkillAuthoringDir,
  },
  // R1.2 (D-AS20) — the same SkillRepository instance `assistantToolDeps.skills` above uses, wired
  // SEPARATELY so the session manager can render the `<skill-context>` awareness block per message
  // (renderMessage/renderSkillContext) without forcing the frozen AssistantToolContextBase contract
  // (which is missing compare/compatibility/reports on this concrete deps bag) to fit.
  skills,
  logger: server.log,
});
assistantAuth.setSignOutHook(() => assistantSessionManager.killAllSessions());

server.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "Validation failed",
      issues: error.issues,
    });
  }

  const typedError = error as Error & { statusCode?: number; code?: string };
  const statusCode = typeof typedError.statusCode === "number" ? typedError.statusCode : 500;
  server.log.error(error);
  // Surface a machine-readable `code` (e.g. REPO_NOT_BOUND) additively — ONLY when a typed httpError set
  // both statusCode and code, so native/unexpected errors don't leak an internal code. Backward-compatible.
  const code =
    typeof typedError.statusCode === "number" && typeof typedError.code === "string"
      ? typedError.code
      : undefined;
  return reply.code(statusCode).send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
});

server.get(
  "/api/health",
  async (): Promise<HealthPayload> => ({
    ok: true,
    service: "mcp-token-footprint",
    version: config.appVersion,
    databasePath: config.databasePath,
    dataDirectory: config.dataDirectory,
    dockerMode: config.dockerMode,
    defaultTokenProfile: config.defaultTokenProfile,
  }),
);

await registerServerRoutes(server, servers, scanService, oauthService);
await registerServerTypeRoutes(server, serverTypes);
await registerProviderRoutes(server, providers, subscriptionModelResolver);
await registerPricingRoutes(server, pricingRepository);
await registerScanRoutes(server, scans, scanService);
await registerMaintenanceRoutes(
  server,
  db,
  scans,
  {
    repository: assistantRepository,
    isThreadLive: (threadId) => assistantSessionManager.isLive(threadId),
    assistantDataDir: config.assistantDataDir,
  },
  runRepository,
  appSettings,
  notificationRepository,
  digestRepository,
  { repository: hubRepository, dataDir: config.dataDirectory },
);
await registerCompareRoutes(server, scans);
// Security posture (roadmap/security-posture/, WP 1.2) — `GET /api/scans/:scanId/security`: the
// eleven deterministic rules over an already-persisted scan, scored by the shared contract. Read-only
// and computed on read (D-SP8 — nothing is persisted, no migration); the OAuth port is the narrow
// scope-NAMES projection of D-SP9, never token material.
await registerSecurityRoutes(server, { scans, servers, oauth: oauthRepository });
// CI assertions (roadmap/ci/, WP 1.3) — `POST /api/assertions/evaluate`: evaluate a versioned
// `mcpfp.assert.json` against an ALREADY-persisted scan and return an itemized report. Read-only
// (D-C9 — it never runs a scan), and every baseline question re-projects `buildComparison` above
// rather than adding a second differ (D-MCP4). No migration, no feature flag, no web route.
await registerAssertionRoutes(server, { scans, servers });
// Advisor (roadmap/advisor/, WP 1.2) — `GET /api/advisor/report`: deterministic, versioned
// recommendations derived from data the app already persists (scans + runs + environments). Read-only;
// the four rules see only the narrow read ports built here, never a DB handle or a secret.
await registerAdvisorRoutes(server, {
  servers,
  scans,
  scenarios: scenarioRepository,
  runs: runRepository,
  // WP 2.1 — the grade-aware side: suite runs + their members' grades + skill names. Still
  // read-only, still no provider key (a grade is read from `run_grades`, never re-judged here).
  grades: gradeRepository,
  suiteRuns: suiteRunRepository,
  skills,
});
// UX overhaul WP 3.5 (G7, D-UX12) — advisory run-plan cost preview (reads footprints + pricing; no key).
await registerEstimateRoutes(server, {
  scenarios: scenarioService,
  tests: testService,
  scans,
});
await registerCompatibilityRoutes(server, scans);
await registerRunCompatibilityRoutes(server, runRepository, scenarioService);
// Observability (WP1.2/WP1.4, D-OB13/D-OB14) — on-demand time-bucketed metrics over runs + scans, plus
// saved-view CRUD (name + reuse a RunFilter). No secrets, no MCP; the aggregation SQL lives in
// observability/metrics.ts and the saved-view persistence in observability/views.ts.
await registerObservabilityRoutes(server, db);
// Observability (WP4.1, D-OB19/D-OB21) — watch-rule CRUD + audit log (on_terminal rules fire at the
// single post-terminal choke point, run-service.ts `reviewRun`, as a strictly post-hoc OBSERVER). WP4.2
// adds `POST /api/watch-rules/preview` (the windowed evaluator scores a window config against history).
await registerWatchRoutes(server, watchRuleRepository, watchWindowEvaluator);
// Observability (WP4.3, D-OB19) — the notification center (list/read/read-all/stream) + the webhook
// channel's test-fire button. `resolveWebhookUrl` is the SAME repository method the engine uses.
await registerNotificationRoutes(server, notificationRepository, notificationHub);
await registerWatchTestFireRoute(server, watchRuleRepository, (secretRef) =>
  watchRuleRepository.resolveWebhookUrl(secretRef),
);
await registerReportRoutes(
  server,
  scans,
  servers,
  runRepository,
  testService,
  scenarioService,
  suiteRunRepository,
  gradeRepository,
  suiteService,
  runReportService,
  suiteReportRepository,
  digestRepository,
  digestSchedule,
  // Advisor WP 2.2 — the fleet report (`GET /api/reports/fleet/{json,markdown}`) reads the SAME
  // advisor ports registered above (WP 2.1 widened them with the graded side), so its
  // recommendations come from the one advisor service rather than a second copy of the rules.
  {
    servers,
    scans,
    scenarios: scenarioRepository,
    runs: runRepository,
    grades: gradeRepository,
    suiteRuns: suiteRunRepository,
    skills,
  },
);
// Workbench MCP server (Phase MCP, WP M.1 reads + WP M.3 writes) — tools + report resources over the
// SAME repositories and services every route above uses. `runReports` is the run-report assembly the
// export routes were just given, so a report read over MCP and one downloaded over HTTP are the same
// document; `scanService`, `suiteOrchestrator`, `runPlans` and `estimate` are literally the instances
// `POST /api/servers/:id/scan`, `POST /api/suites/:id/run`, `POST /api/run-plans` and
// `GET /api/estimate/run-plan` are wired with, so the mount re-projects those routes rather than
// owning a second copy of what they do (D-MCP4). The mount never constructs its own service.
registerWorkbenchMcpRoutes(server, {
  servers,
  scans,
  runs: runRepository,
  grades: gradeRepository,
  skills,
  suites: suiteRepository,
  suiteRuns: suiteRunRepository,
  collections: collectionRepository,
  runReports: {
    runs: runRepository,
    tests: testService,
    scenarios: scenarioService,
    runReports: runReportService,
  },
  scanService,
  suiteOrchestrator,
  runPlans: {
    suites: suiteService,
    collections: collectionService,
    tests: testService,
  },
  estimate: {
    scenarios: scenarioService,
    tests: testService,
    scans,
  },
});
await registerOAuthRoutes(server, oauthService);
await registerTestingRoutes(
  server,
  scenarioService,
  testService,
  runService,
  runRepository,
  runManager,
);
await registerSuiteRoutes(
  server,
  suiteService,
  suiteOrchestrator,
  suiteRunRepository,
  suiteRunManager,
  runRepository,
  gradeRepository,
  testService,
  failureBucketService,
  suiteReportService,
  suiteReportRepository,
);
await registerGradingRoutes(
  server,
  gradeService,
  appSettings,
  { cliAvailable },
  runReportService,
  ratingIssueService,
  // AR11 — the rating axis around a manual re-grade (`rating` → `rated`/`failed`, persisted onto the
  // runs row + appended to the run_events replay log; the live channel is gone by re-rate time).
  runRepository,
);
// Rating Issues registry — reads + the manual resolve/re-open + the per-target MD/JSON exports.
await registerRatingIssueRoutes(
  server,
  ratingIssueRepository,
  issueSweepService,
  issueAssistService,
  // WP5.4 — the verification-run link store + the run repo to hydrate each linked run's live status.
  issueVerificationStore,
  runRepository,
);
await registerCollectionRoutes(server, collectionService, collectionGitSync, insightBenchImporter);
// --- Testing IA (WP 2.2, D-T5): the ONE execution engine. `POST /api/run-plans` accepts a plan from any
// of the three sources (suite · collection · adhoc) and runs it as a suite-run through the SAME
// orchestrator (`startPlanRun`) — no forked mass-run path. Collection/adhoc plans create no Suite row.
await registerRunPlanRoutes(server, suiteOrchestrator, {
  suites: suiteService,
  collections: collectionService,
  tests: testService,
});
await registerSkillRoutes(
  server,
  skills,
  skillIngest,
  skillGit,
  skillPublish,
  skillBindings,
  servers,
  scans,
  // Server-types WP 3.1 (D-ST3) — the type registry so a skill's frontmatter `servers:` entry that
  // names a TYPE resolves to the type's representative member server.
  serverTypes,
  {
    maxUploadBytes: config.skillMaxTotalBytes,
    push: skillPush,
    githubAccountToken,
    // H-4 — thread the SAME env-overridable ingest caps `SkillIngestService`/`SkillGitService`/
    // `registerSkillflowRoutes` already receive, so save-draft's tree-op apply and the blank/server-
    // scaffold create paths (both accept caller-supplied file content) actually honor a tightened
    // `SKILL_MAX_*` override instead of silently falling back to the compiled-in default.
    caps: skillCaps,
  },
);
registerGithubAccountRoutes(server, githubAccount);
await registerSkillflowRoutes(server, skills, runRepository, skillCaps);
await registerAssistantRoutes(server, {
  auth: assistantAuth,
  sessions: assistantSessionManager,
  models: config.assistantModelRoster,
  // The LIVE Claude-subscription roster resolver (the SAME one the provider Model dropdown uses) so the
  // dock's model list MATCHES the picker; falls back internally to the static `models` above.
  subscriptionModels: subscriptionModelResolver,
  // WP R1.3 (D-AS13/D-AS22) — the live-workspace read routes' base dir (same value the session
  // manager already resolves `workspaceRootFor` under).
  assistantDataDir: config.assistantDataDir,
  // WP R3.1 (D-AS27/D-AS28) — `GET /api/assistant/starters`'s dependency bag: a narrow subset of the
  // same repository handles `assistantToolDeps` already closes over above, plus the skill quality
  // engine's L2 ceiling (the one conditional that needs a config value — see `starters.ts`).
  starters: {
    scans,
    servers,
    runs: runRepository,
    suiteRuns: suiteRunRepository,
    skills,
    skillQualityL2TokenCeiling: config.skillQualityL2TokenCeiling,
  },
});
// Assistant Hub (roadmap/assistant-hub/, WP4.3, R-SES9/R-UX11) — the notification-center hook for the
// hub's three signals (waiting_input / mission-terminal / session budget-trip), reusing the SAME
// `notificationRepository`/`notificationHub` the WP4.3 (Observability) notification center + the issue-
// regression/digest notices above already publish through — no new transport. Wrapped in try/catch:
// this runs off a fire-and-forget sink/`.then()` (never blocks a response), so a failure here (e.g. a
// session deleted in the race between the event firing and this read) must never surface as an
// unhandled rejection — it's logged and dropped, exactly like `dispatchMessage`'s own `.catch` beside it.
const hubNotify: HubNotifySink = (event) => {
  try {
    const session = hubRepository.getSession(event.sessionId);
    if (event.kind === "waiting_input") {
      const body =
        event.reason === "elicitation"
          ? "A tool is asking for more information to continue."
          : event.reason === "approval"
            ? "A tool call needs your approval to continue."
            : event.reason === "question"
              ? "The assistant has a question for you."
              : "This session is waiting for your next message.";
      const notification = notificationRepository.create({
        severity: "info",
        title: `Waiting for you: ${session.title}`,
        body,
        linkPath: `/assistant?session=${event.sessionId}`,
      });
      notificationHub.publish(notification);
      return;
    }
    if (event.kind === "mission_terminal") {
      const severity =
        event.status === "failed" ? "critical" : event.status === "stopped" ? "warning" : "info";
      const body =
        event.status === "completed"
          ? "The mission finished and synthesized its results."
          : event.status === "stopped"
            ? "The mission was stopped and synthesized a partial result."
            : "The mission failed to run to completion.";
      const notification = notificationRepository.create({
        severity,
        title: `Mission ${event.status}: ${session.title}`,
        body,
        linkPath: `/assistant?session=${event.sessionId}`,
      });
      notificationHub.publish(notification);
      return;
    }
    // session_budget_trip
    const notification = notificationRepository.create({
      severity: "warning",
      title: `Budget limit hit: ${session.title}`,
      body: `The session stopped early after tripping its "${event.stopReasonCode}" budget.`,
      linkPath: `/assistant?session=${event.sessionId}`,
    });
    notificationHub.publish(notification);
  } catch (error) {
    server.log.warn({ err: error, event }, "hub notify failed (best-effort, dropped)");
  }
};

// Assistant Hub (roadmap/assistant-hub/, WP1.2) — projects/sessions CRUD + turns + SSE, mounted at
// /api/hub/*. Missions/agents/crews/artifacts/library/memory blocks are additive seams later WPs (1.6,
// 1.7, 2.1, …) add to `hub/routes.ts` itself — this mount line does not change as they land.
await registerHubRoutes(server, {
  repository: hubRepository,
  sessionService: hubSessionService,
  providers: providerRepository,
  missionService: hubMissionService,
  // WP2.4 — the session-skills routes' resolution + measurement deps, over the SAME `skills`
  // SkillRepository + token-counter instances the session engine itself uses.
  skillReader: skills,
  skillListingBudgetFraction: config.hubSkillListingBudgetFraction,
  skillEntryMaxChars: config.hubSkillEntryMaxChars,
  tokenCounter: getTokenCounter(config.defaultTokenProfile),
  // WP3.4 — uploads/workspace/resource-attachment (D-AH12, R-SES6, R-MCP9): `dataDir` resolves a
  // session's workspace root (`hub/workspace.ts`); `scans`/`scanService` are the SAME instances the
  // MVP scan feature already constructs (`registerScanRoutes`'s own deps, above) — the resource
  // picker's catalog + attach-time measurement reuse them rather than opening a second connection path.
  dataDir: config.dataDirectory,
  scans,
  scanService,
  fileCaps: { maxBytes: config.hubFileMaxBytes },
  // WP4.1 — usage rollups (DB-only, no extra deps) + the context inspector's `tools` layer, which
  // snapshots the SAME registered-server + latest-scan catalog `resolveHubMcpGrants` above reads
  // (minus its live-session half — the inspector only measures definitions, never calls a tool).
  servers,
  toolLoadingDefault: config.hubToolLoadingDefault,
  toolSearchAutoFraction: config.hubToolSearchAutoFraction,
  projectContextMaxChars: config.hubProjectContextMaxChars,
  // WP4.3 (R-SES9/R-UX11) — the notification-center sink (`waiting_input` / `session_budget_trip`
  // fires); see the `hubNotify` closure above.
  notify: hubNotify,
  // hub-fixes WP1.3 (RC3.4) — the reconnect route's whole job: force-evict a server's cached hub MCP
  // session (best-effort closing whatever it resolved to) so the NEXT turn's `getHubMcpSession` opens a
  // fresh connection instead of reusing a broken/stale one. Same `hubMcpSessions` pool `resolveHubMcpGrants`
  // above reads from.
  evictHubMcpSession: (serverId) => hubMcpSessions.evict(serverId),
});
if (fs.existsSync(config.webDistPath)) {
  await server.register(fastifyStatic, {
    root: config.webDistPath,
    prefix: "/",
  });

  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }

    return reply.sendFile("index.html");
  });
} else {
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }

    return reply.code(404).send({
      error: `Web build not found at ${path.relative(process.cwd(), config.webDistPath)}`,
    });
  });
}

await server.listen({ port: config.port, host: config.host });

// Observability (WP4.2, D-OB19) — start the windowed-rule ticker AFTER the server is up. `start()` runs
// the boot catch-up ONCE (evaluating windows that completed while the app was away — late-flagged, gap
// recorded in the audit) then schedules the interval. Guarded so a catch-up failure never blocks boot;
// the interval keeps running regardless. Stopped by the graceful-shutdown module below.
void watchScheduler.start().catch((error) => {
  server.log.error({ err: error }, "watch scheduler failed to start (windowed rules inactive)");
});

// H-9 — graceful shutdown. Without this, `docker compose stop` / Ctrl-C under bare `pnpm start` dropped
// in-flight requests, left the SQLite `-wal` sidecar un-checkpointed, and orphaned MCP/Agent-SDK
// children + any in-flight `claude setup-token` PTY. Teardown (ordered, fault-isolated) closes the
// server, aborts every live run/suite so it stops spending, kills the assistant sessions + auth PTY,
// checkpoints the WAL, and closes the DB. The seams are composed here; the logic lives in `shutdown.ts`
// so it's unit-testable without booting the server.
const shutdown = createGracefulShutdown({
  closeServer: () => server.close(),
  // Observability (WP4.2) — stop the windowed-rule ticker so no evaluation fires during teardown.
  stopWatchScheduler: () => watchScheduler.stop(),
  stopActiveRuns: () => {
    // Enumerate the DB's live (`running`) runs and cross-check the in-memory manager (mirrors the F3
    // active-run lookup) so we only stop runs live IN THIS PROCESS; `stop` aborts the provider/MCP loop.
    for (const summary of runRepository.listRuns({ status: "running" })) {
      if (runService.isActive(summary.id)) {
        try {
          runService.stop(summary.id);
        } catch {
          // Already settled between the list + the stop — nothing to abort.
        }
      }
    }
  },
  stopActiveSuiteRuns: () => {
    for (const suiteRun of suiteRunRepository.listRuns()) {
      if (
        (suiteRun.status === "running" || suiteRun.status === "pending") &&
        suiteOrchestrator.isActive(suiteRun.id)
      ) {
        try {
          suiteOrchestrator.stop(suiteRun.id);
        } catch {
          // Already settled — the orchestrator's stop is a no-op / 404.
        }
      }
    }
  },
  cancelAuthFlow: () => assistantFlowManager.cancel(),
  killAssistantSessions: () => assistantSessionManager.killAllSessions(),
  checkpointDb: () => {
    db.pragma("wal_checkpoint(TRUNCATE)");
  },
  closeDb: () => db.close(),
  log: server.log,
});
installShutdownHandlers(shutdown);
