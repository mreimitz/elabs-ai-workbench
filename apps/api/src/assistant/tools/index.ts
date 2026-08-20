// Assistant (WP 1.2) — the in-process MCP read toolset (planning/Roadmap/RM-02-assistant/00-plan.md §3.2). One
// `createSdkMcpServer` instance whose tools call the EXISTING app repositories directly (same
// process — no HTTP hop, no secrets over the wire). Every tool here is a READ (never gated by the
// Phase 2 approval protocol) and calls into repository/service code that already exists elsewhere in
// this app; this module owns none of that logic, only the tool-shaped adapter around it.
//
// Contract: `packages/shared` freezes `AssistantToolContext`/`BuildAssistantTools` as OPAQUE
// placeholders (every capability field typed `unknown`) because `shared` cannot import the Agent SDK
// or any apps/api type. `AssistantToolDeps` below is the concrete, apps/api-local narrowing the plan
// calls for ("WP 1.2's real buildAssistantTools narrows each field to its concrete type LOCALLY …
// without changing this [shared] contract") — same capability areas as `AssistantToolContext`, minus
// `threadId`/`envelope` (this WP's tools are read-only and stateless; a write-capable tool that needs
// the thread id is Phase 2's concern) and with `compare`/`compatibility`/`reports` folded into the
// `scans`/`runs`/`tests`/`environments` repositories they actually operate over — those three are
// PURE functions (`buildComparison`/`buildHeatmap`/`createRunMarkdownReport`), not stateful services
// with their own DB access, so there is nothing additional to inject for them.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  DEFAULT_COMPARE_THRESHOLD,
  RUN_STATUSES,
  SUITE_RUN_STATUSES,
} from "@mcp-token-footprint/shared";
import { z } from "zod";
import { buildComparison } from "../../compare/service.js";
import { DEFAULT_HEATMAP_MODELS } from "../../compatibility/dataset.js";
import { buildHeatmap } from "../../compatibility/service.js";
import type { CollectionRepository } from "../../collections/repository.js";
import type { GradeRepository } from "../../grading/grade-repository.js";
import type { RatingIssueRepository } from "../../grading/issue-repository.js";
import { createRunMarkdownReport } from "../../reports/reports.js";
import type { ScanRepository } from "../../scans/repository.js";
import type { ScanService } from "../../scans/service.js";
import type { ServerRepository } from "../../servers/repository.js";
import { SkillDiffService } from "../../skills/diff-service.js";
import type { SkillRepository } from "../../skills/repository.js";
import type { SuiteRepository } from "../../suites/repository.js";
import type { SuiteRunRepository } from "../../suites/suite-run-repository.js";
import type { RunRepository } from "../../testing/run-repository.js";
import type { ScenarioRepository } from "../../testing/scenario-repository.js";
import type { TestRepository } from "../../testing/test-repository.js";
import type { TestService } from "../../testing/test-service.js";
import { workspaceRootFor } from "../workspace.js";
// WP 3.1 — the ui_* navigation-only tool definitions (D-AS8/D-AS16), owned by their own file so this
// merges trivially with WP 2.2's parallel workspace-tool additions. SINGLE import + spread point; see
// `buildAssistantToolDefinitions` below.
import { buildUiToolDefinitions } from "./ui-tools.js";
import { boundText, compactStep, jsonResult, safeTool, truncate, truncateFields } from "./util.js";
// WP 2.2 — the skill-workspace edit-loop tools (D-AS13), a SEPARATE module (this file is shared with
// WP 3.1's `ui_*` tools) included below via one import + one spread so the two WPs' additions merge
// without touching each other's hunks. See `workspace-tools.ts` for the tool definitions themselves.
import { buildWorkspaceToolDefinitions } from "./workspace-tools.js";
// WP 2.3 — the app-data WRITE tools (D-AS3: tests/environments/attachments/skill attachments/server
// config/collections/suites), a SEPARATE module (same reasoning as workspace-tools.js above) included
// via one import + one spread. See `write-tools.ts` for the tool definitions + the secrets-discipline
// banner (servers_update_config / collections_modify never carry a secret field, by construction).
import { buildWriteToolDefinitions } from "./write-tools.js";
// Cross-entity ACTION tools (owner refinement) — invoke a registered MCP server's tools + file a rating
// issue against a skill/server a run used. A SEPARATE module (same one-import-one-spread pattern); its
// two WRITE-shaped tools are scope-EXEMPT (see `action-tools.ts` + `SCOPE_EXEMPT_ACTION_TOOLS` in shared).
import { buildActionToolDefinitions } from "./action-tools.js";
// Observability WP5.4 — the assistant ISSUE LOOP tools (analyze → fix draft → regression test → fork
// rerun). A SEPARATE module (same one-import-one-spread pattern); its READ tools auto-allow, its three
// gated action tools ride an apps/api-local scope exemption (SHARED-FREE — see `issue-loop-tools.ts` +
// `isIssueLoopActionTool` in session-manager.ts). All still approval-gated by the D-AS4 classifier.
import type { IssueLoopRunLauncher } from "./issue-loop-tools.js";
import { buildIssueLoopToolDefinitions } from "./issue-loop-tools.js";
import type { IssueVerificationStore } from "../../grading/issue-verification.js";
// Assistant-operability WP 3.1 — the Hub READ tools (hub_agents_list/hub_crews_list/
// hub_usage_summary), backing the route-keyed `agents`/`hub` starter chips from WP 2.1. A SEPARATE
// module (same one-import-one-spread pattern); all three are READS (auto-allowed, see
// `hub-read-tools.ts`'s own banner) — no scope-map change (D-AO3).
import { buildHubReadToolDefinitions } from "./hub-read-tools.js";
// Assistant-operability WP 5.1 — the Hub WRITE tools (hub_agent_create/update, hub_crew_create/update),
// D-AO7. A SEPARATE module (same one-import-one-spread pattern); its four tools are scope-EXEMPT,
// approval-gated ACTION writes (the `mcp_tool_call`/`rating_issue_file` precedent — see
// `hub-write-tools.ts` + `SCOPE_EXEMPT_ACTION_TOOLS` in shared). NOT new `ASSISTANT_ENTITY_KINDS` (D-AO3).
import { buildHubWriteToolDefinitions } from "./hub-write-tools.js";
import type { HubRepository } from "../../hub/repository.js";
// model-identity WP3.3 (D-MI10) — the Hub read tools' credential store; see `AssistantToolDeps.providers`.
import type { ProviderRepository } from "../../providers/repository.js";

/**
 * The concrete dependency bag `buildAssistantTools` needs — one field per repository the read
 * toolset calls directly. See the module banner above for how this maps onto the frozen
 * `AssistantToolContext` capability areas.
 */
export interface AssistantToolDeps {
  runs: RunRepository;
  suiteRuns: SuiteRunRepository;
  grades: GradeRepository;
  skills: SkillRepository;
  scans: ScanRepository;
  servers: ServerRepository;
  tests: TestRepository;
  environments: ScenarioRepository;
  collections: CollectionRepository;
  /**
   * WP 2.3 — the app-data WRITE toolset's dependencies. `testService` is `TestService` (not the bare
   * `tests: TestRepository` above) because deleting a test / adding an attachment both touch the
   * filesystem (blob cleanup / blob write) — logic that lives in the service; `suites` has no read-tool
   * use today (the read toolset never lists/gets suites directly — `suite_runs_get`/`suite_runs_list`
   * cover the run side) but the write tools need it for `suites_create`/`suites_update`/`suites_delete`.
   */
  testService: TestService;
  suites: SuiteRepository;
  /**
   * Cross-entity ACTION tools (owner refinement) — `mcp_tools_list`/`mcp_tool_call` invoke a registered
   * MCP server through the app's in-process bridge (secrets stay in apps/api), so they need the live
   * `ScanService`; `rating_issue_file`/`rating_issues_list` need the `RatingIssueRepository`. Both
   * instances already exist for the scan/grading routes; reused here, not recreated. See `action-tools.ts`.
   */
  scanService: ScanService;
  issues: RatingIssueRepository;
  /**
   * Observability WP5.4 — the assistant issue-loop tools' two extra deps. `runService` is the live run
   * launcher `runs_rerun` forks a linked run through (structural — a fake in tests, never a real run);
   * `verification` is the app_settings-backed issue⇆run link store the fork run is annotated onto. The
   * loop's OTHER deps (`issues`, `runs`, `tests`, `testService`, `collections`) are already in this bag.
   */
  runService: IssueLoopRunLauncher;
  verification: IssueVerificationStore;
  /**
   * Assistant-operability WP 3.1 — the Hub read tools' dependency. The SAME `HubRepository`
   * instance `index.ts` already constructs for the Hub routes (`hubRepository`); reused here, not
   * recreated. See `hub-read-tools.ts`.
   */
  hub: HubRepository;
  /**
   * model-identity WP3.3 (D-MI10) — the Hub read tools' second dependency: the provider-credential
   * store, so `hub_usage_summary` attributes spend to the credential a session is PINNED to rather
   * than re-guessing it from the model name (which cannot express `claude_subscription` at all). The
   * SAME `providerRepository` instance `index.ts` already constructs; reused, not recreated. Its
   * `list()` is REDACTED (ids/labels/kinds, never a key). See `hub-read-tools.ts`.
   */
  providers: ProviderRepository;
  /**
   * WP 2.2 (D-AS13) — THIS session's thread id, resolved fresh per session start (see
   * `session-manager.ts`'s `startSession`, which calls `buildTools(toolCtx)` with the live
   * `AssistantToolContext`). Combined with `assistantDataDir` to derive the workspace tools' root —
   * every other field above is a static, module-scope repository handle; this one and the next are the
   * two per-session exceptions.
   */
  threadId: string;
  /** WP 2.2 — the base dir the workspace tools' root is computed under (`<assistantDataDir>/ws/<threadId>/`,
   *  see `workspace.ts`'s `workspaceRootFor`). Same value as `AssistantSessionConfig.assistantDataDir`. */
  assistantDataDir: string;
}

// ── Compaction / pagination defaults ────────────────────────────────────────────────────────────
// Every list/collection result is capped so a single tool call can never blow up the agent's
// context; every cap is reported back via an explicit `truncated`/`Truncated` marker (never a
// silent drop) per the WP brief ("paginate/truncate big payloads with an explicit truncated: true
// marker").
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_STEP_LIMIT = 150;
const DEFAULT_EVENT_LIMIT = 150;
const DEFAULT_TOOL_LIMIT = 150;
const MAX_FILE_TEXT_CHARS = 20_000;
const MAX_REPORT_CHARS = 60_000;

const limitSchema = z.number().int().positive().max(MAX_LIST_LIMIT).optional();

/**
 * Build the read toolset's raw tool definitions (pre-`createSdkMcpServer`). Exported separately from
 * {@link buildAssistantTools} so tests can call `.handler(args, {})` on one definition directly — unit
 * level, no SDK session, no MCP protocol round-trip (ground rule: "Test each tool DIRECTLY against a
 * seeded fixture DB").
 */
export function buildAssistantToolDefinitions(deps: AssistantToolDeps) {
  return [
    // ── Runs ──────────────────────────────────────────────────────────────────────────────────
    tool(
      "runs_get",
      "Get one test run's summary plus its step-by-step trace (tool calls, LLM turns, token/context " +
        "usage, resolved skills). Large runs are truncated — check the `stepsTruncated`/`eventsTruncated` " +
        "markers and narrow with stepLimit/eventLimit, or call run_report_markdown for the same run as a " +
        "single readable document instead of raw steps.",
      {
        runId: z.string().min(1),
        includeEvents: z
          .boolean()
          .optional()
          .describe(
            "Also return the raw settled event log (rarely needed — steps already cover the trace).",
          ),
        stepLimit: z.number().int().positive().max(2000).optional(),
        eventLimit: z.number().int().positive().max(2000).optional(),
      },
      async (args) =>
        safeTool(() => {
          const detail = deps.runs.getRun(args.runId);
          const steps = truncate(detail.steps, args.stepLimit ?? DEFAULT_STEP_LIMIT);
          const out: Record<string, unknown> = {
            id: detail.id,
            testId: detail.testId,
            scenarioId: detail.scenarioId,
            mode: detail.mode,
            status: detail.status,
            outcome: detail.outcome,
            startedAt: detail.startedAt,
            durationMs: detail.durationMs,
            turns: detail.turns,
            toolCalls: detail.toolCalls,
            peakContextTokens: detail.peakContextTokens,
            tokensIn: detail.tokensIn,
            tokensOut: detail.tokensOut,
            costUsd: detail.costUsd,
            assertionResults: detail.assertionResults,
            suiteRunId: detail.suiteRunId,
            repetition: detail.repetition,
            skills: detail.skills,
            steps: steps.items.map(compactStep),
            stepsTotal: steps.total,
            stepsTruncated: steps.truncated,
          };
          if (args.includeEvents) {
            const events = truncate(detail.events, args.eventLimit ?? DEFAULT_EVENT_LIMIT);
            out.events = events.items;
            out.eventsTotal = events.total;
            out.eventsTruncated = events.truncated;
          }
          return jsonResult(out);
        }),
    ),

    tool(
      "runs_list",
      "List test runs, optionally filtered by test id, environment (scenario) id, and/or status. " +
        "Newest first. Summaries only — call runs_get for one run's step trace.",
      {
        testId: z.string().optional(),
        scenarioId: z.string().optional(),
        status: z.enum(RUN_STATUSES).optional(),
        limit: limitSchema,
      },
      async (args) =>
        safeTool(() => {
          const rows = deps.runs.listRuns({
            testId: args.testId,
            scenarioId: args.scenarioId,
            status: args.status,
          });
          const capped = truncate(rows, args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            runs: capped.items,
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    tool(
      "runs_search",
      "Search test runs with a richer filter than runs_list: test, environment (scenario), status, " +
        "a skill id that must have been resolved into the run, and/or a startedAt date range. Newest " +
        "first.",
      {
        testId: z.string().optional(),
        scenarioId: z.string().optional(),
        status: z.enum(RUN_STATUSES).optional(),
        skillId: z.string().optional().describe("Only runs that resolved/loaded this skill."),
        since: z.string().optional().describe("ISO-8601 inclusive lower bound on startedAt."),
        until: z.string().optional().describe("ISO-8601 exclusive upper bound on startedAt."),
        limit: limitSchema,
      },
      async (args) =>
        safeTool(() => {
          let rows = deps.runs.listRuns({
            testId: args.testId,
            scenarioId: args.scenarioId,
            status: args.status,
          });
          if (args.since) rows = rows.filter((row) => row.startedAt >= (args.since as string));
          if (args.until) rows = rows.filter((row) => row.startedAt < (args.until as string));
          if (args.skillId) {
            const skillId = args.skillId;
            rows = rows.filter((row) =>
              deps.runs.getRunSkills(row.id).some((s) => s.skill_id === skillId),
            );
          }
          const capped = truncate(rows, args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            runs: capped.items,
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    tool(
      "run_report_markdown",
      "Get a run's full session-log report as Markdown in one call: session header (test/environment " +
        "config verbatim), statistics, and a step-by-step breakdown. Cheaper than runs_get plus separate " +
        "test/environment lookups when you need the whole story for a summary or a failure writeup.",
      { runId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          const run = deps.runs.getRun(args.runId);
          const test = deps.tests.get(run.testId);
          const scenario = deps.environments.get(run.scenarioId);
          const markdown = createRunMarkdownReport(run, { test, scenario });
          const bounded =
            markdown.length > MAX_REPORT_CHARS
              ? `${markdown.slice(0, MAX_REPORT_CHARS)}\n\n…[truncated: report exceeds ${MAX_REPORT_CHARS} ` +
                "chars — call runs_get for a compact JSON view of the remaining steps instead]"
              : markdown;
          return { content: [{ type: "text" as const, text: bounded }] };
        }),
    ),

    // ── Suite runs (Benchmarks) ──────────────────────────────────────────────────────────────────
    tool(
      "suite_runs_get",
      "Get one suite run (a Benchmarks test-suite execution matrix): status, config snapshot, cached " +
        "aggregates, and its member run ids — each with its latest grade per grader, unless includeGrades " +
        "is set to false.",
      {
        suiteRunId: z.string().min(1),
        includeGrades: z.boolean().optional(),
        memberLimit: limitSchema,
      },
      async (args) =>
        safeTool(() => {
          const suiteRun = deps.suiteRuns.getRun(args.suiteRunId);
          const allMemberIds = deps.suiteRuns.listChildRunIds(args.suiteRunId);
          const capped = truncate(allMemberIds, args.memberLimit ?? DEFAULT_LIST_LIMIT);
          const out: Record<string, unknown> = {
            ...suiteRun,
            memberRunIds: capped.items,
            memberRunsTotal: capped.total,
            memberRunsTruncated: capped.truncated,
          };
          if (args.includeGrades !== false) {
            out.memberGrades = capped.items.map((runId) => ({
              runId,
              grades: deps.grades.latestByGrader(runId),
            }));
          }
          return jsonResult(out);
        }),
    ),

    tool(
      "suite_runs_list",
      "List suite runs (Benchmarks test-suite executions), optionally scoped to one suite and/or " +
        "status. Newest first.",
      {
        suiteId: z.string().optional(),
        status: z.enum(SUITE_RUN_STATUSES).optional(),
        limit: limitSchema,
      },
      async (args) =>
        safeTool(() => {
          let rows = deps.suiteRuns.listRuns(args.suiteId);
          if (args.status) rows = rows.filter((row) => row.status === args.status);
          const capped = truncate(rows, args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            suiteRuns: capped.items,
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    // ── Skills ───────────────────────────────────────────────────────────────────────────────────
    tool(
      "skills_get",
      "Get one Agent Skill's metadata: display name, description, source (upload/GitHub), current " +
        "version id, version count. Call skills_versions for its version history.",
      { skillId: z.string().min(1) },
      async (args) => safeTool(() => jsonResult(deps.skills.getPublic(args.skillId))),
    ),

    tool(
      "skills_versions",
      "List a skill's versions, newest first, each with its L1/L2/L3 token footprint.",
      { skillId: z.string().min(1) },
      async (args) =>
        safeTool(() => jsonResult({ versions: deps.skills.listVersions(args.skillId) })),
    ),

    tool(
      "skills_files",
      "List the files in one skill version — path, size, kind, per-file token total. This is the " +
        "file TREE, not file contents; call skills_file_content for one file's text.",
      { versionId: z.string().min(1) },
      async (args) => safeTool(() => jsonResult({ files: deps.skills.listFiles(args.versionId) })),
    ),

    tool(
      "skills_file_content",
      "Get one file's content from a skill version. A binary file returns metadata only (no content); " +
        "a text file returns its text, bounded to a size cap with an explicit truncation marker.",
      { versionId: z.string().min(1), path: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          const file = deps.skills.getFileContent(args.versionId, args.path);
          if (file.isBinary) return jsonResult(file);
          const bounded = boundText(file.text, MAX_FILE_TEXT_CHARS);
          return jsonResult({
            ...file,
            text: bounded,
            truncated: bounded.length !== file.text.length,
          });
        }),
    ),

    tool(
      "skills_diff",
      "Full-tree diff between two versions of the SAME skill: added/removed/modified/renamed files " +
        "with per-file token deltas, plus a manifest field diff (name/description/license/…).",
      { fromVersionId: z.string().min(1), toVersionId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          const diffService = new SkillDiffService(deps.skills);
          const diff = diffService.diffVersions(args.fromVersionId, args.toVersionId);
          return jsonResult(truncateFields(diff, ["entries"], DEFAULT_LIST_LIMIT));
        }),
    ),

    // ── Scans ────────────────────────────────────────────────────────────────────────────────────
    tool(
      "scans_get",
      "Get one scan's summary: server, token profile, totals for tools/resources/prompts, and the " +
        "largest contributors. Call scans_tools for the full per-tool breakdown.",
      { scanId: z.string().min(1) },
      async (args) => safeTool(() => jsonResult(deps.scans.getSummary(args.scanId))),
    ),

    tool(
      "scans_list",
      "List scans, newest first, optionally scoped to one server.",
      { serverId: z.string().optional(), limit: limitSchema },
      async (args) =>
        safeTool(() => {
          const rows = args.serverId
            ? deps.scans.listSummariesByServer(args.serverId)
            : deps.scans.listSummaries();
          const capped = truncate(rows, args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            scans: capped.items,
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    tool(
      "scans_tools",
      "List a scan's per-tool token breakdown (name, token totals by facet, contribution %), ranked " +
        "by token cost, highest first. Paginated — pass offset to page through the rest.",
      {
        scanId: z.string().min(1),
        limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
      async (args) =>
        safeTool(() => {
          const detail = deps.scans.getDetail(args.scanId);
          const offset = args.offset ?? 0;
          const limit = args.limit ?? DEFAULT_TOOL_LIMIT;
          const page = detail.tools.slice(offset, offset + limit);
          return jsonResult({
            tools: page,
            total: detail.tools.length,
            offset,
            truncated: offset + page.length < detail.tools.length,
          });
        }),
    ),

    // ── Servers ──────────────────────────────────────────────────────────────────────────────────
    tool(
      "servers_list",
      "List every configured MCP server with its REDACTED config — transport, command/url, non-secret " +
        "auth metadata. Secret values (env vars, headers, tokens) are NEVER included, only booleans for " +
        "whether they're set (hasEnvSecrets/hasHeaderSecrets).",
      {},
      async () => safeTool(() => jsonResult({ servers: deps.servers.list() })),
    ),

    // ── Compare & compatibility ──────────────────────────────────────────────────────────────────
    tool(
      "compare_run",
      "Compare two scans at the tool/resource/prompt level — the same server over time, or two " +
        "different servers — returning matched/added/removed entries with token deltas. Despite the " +
        "name this compares SCANS, not test runs: pass two scan ids (see scans_list).",
      {
        scanIdA: z.string().min(1),
        scanIdB: z.string().min(1),
        threshold: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Fuzzy-match similarity threshold (0-1); default 0.6."),
      },
      async (args) =>
        safeTool(() => {
          const a = deps.scans.getDetail(args.scanIdA);
          const b = deps.scans.getDetail(args.scanIdB);
          const comparison = buildComparison(a, b, args.threshold ?? DEFAULT_COMPARE_THRESHOLD);
          const compact = truncateFields(
            comparison,
            [
              "matched",
              "onlyInA",
              "onlyInB",
              "resourceMatched",
              "resourceOnlyInA",
              "resourceOnlyInB",
              "promptMatched",
              "promptOnlyInA",
              "promptOnlyInB",
            ],
            DEFAULT_LIST_LIMIT,
          );
          return jsonResult(compact);
        }),
    ),

    tool(
      "compatibility_heatmap",
      "Score one scan's tools against a set of model context/tool-schema limits, producing a " +
        "server×model or tool×model compatibility heatmap (green/amber/red bands). Defaults to a small " +
        "representative model set when models is omitted.",
      {
        scanId: z.string().min(1),
        models: z.array(z.string()).max(20).optional(),
        view: z.enum(["server", "tool"]).optional(),
        rollup: z.enum(["worst-tool", "average-tool"]).optional(),
        client: z
          .string()
          .optional()
          .describe("Optional host-client target (e.g. 'cursor') enabling client-layer tests."),
      },
      async (args) =>
        safeTool(() => {
          const scan = deps.scans.getDetail(args.scanId);
          const heatmap = buildHeatmap(scan, args.models ?? DEFAULT_HEATMAP_MODELS, {
            view: args.view ?? "server",
            rollup: args.rollup ?? "worst-tool",
            client: args.client,
          });
          return jsonResult(truncateFields(heatmap, ["rows"], DEFAULT_LIST_LIMIT));
        }),
    ),

    // ── Tests & Environments ─────────────────────────────────────────────────────────────────────
    tool(
      "tests_list",
      "List all tests (prompt + assertions/expectations + attachments + tags), newest-updated first.",
      { limit: limitSchema },
      async (args) =>
        safeTool(() => {
          const capped = truncate(deps.tests.list(), args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            tests: capped.items,
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    tool(
      "tests_get",
      "Get one test's full definition: prompt, system-prompt override, assertions, expectations, " +
        "attachments, tags, collection membership.",
      { testId: z.string().min(1) },
      async (args) => safeTool(() => jsonResult(deps.tests.get(args.testId))),
    ),

    // Backed by ScenarioRepository — the wire/DB entity is still named "scenario" (the Testing-IA
    // rename is UI-label-only, wire frozen; see ASSISTANT_ENTITY_KINDS' doc in packages/shared). The
    // tool is named `environments_*` to match what the owner actually sees in the app.
    tool(
      "environments_list",
      "List all Environments (provider + model + system prompt + guardrails + allowed servers/skills " +
        "— internally 'scenario'), newest-updated first.",
      { limit: limitSchema },
      async (args) =>
        safeTool(() => {
          const capped = truncate(deps.environments.list(), args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            environments: capped.items,
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    tool(
      "environments_get",
      "Get one Environment's full config: provider/model, params, system prompt, default token " +
        "profiles, guardrails, allowed servers + tools, attached skills.",
      { environmentId: z.string().min(1) },
      async (args) => safeTool(() => jsonResult(deps.environments.get(args.environmentId))),
    ),

    // ── Collections ──────────────────────────────────────────────────────────────────────────────
    tool(
      "collections_list",
      "List Benchmarks collections — the test/suite organizational + optional GitHub-sync home — " +
        "including the undeletable default 'Local' collection.",
      {},
      async () => safeTool(() => jsonResult({ collections: deps.collections.list() })),
    ),

    tool(
      "collections_get",
      "Get one collection's config (name, optional GitHub repo binding, last synced commit). Never " +
        "returns the GitHub PAT — only whether one is set (hasPat).",
      { collectionId: z.string().min(1) },
      async (args) => safeTool(() => jsonResult(deps.collections.get(args.collectionId))),
    ),

    // ── WP 2.2 — skill-workspace edit-loop tools (D-AS13, `skills_open_workspace` +
    // `skills_commit_workspace`). See `workspace-tools.ts` — one spread, no other change needed here
    // when that module's tool list changes.
    ...buildWorkspaceToolDefinitions({
      skills: deps.skills,
      workspaceRoot: workspaceRootFor(deps.assistantDataDir, deps.threadId),
    }),
    // WP 3.1 — ui_* navigation-only tools (D-AS8/D-AS16); see ./ui-tools.ts.
    ...buildUiToolDefinitions(),
    // WP 2.3 — the app-data write tools (D-AS3); see ./write-tools.ts.
    ...buildWriteToolDefinitions({
      tests: deps.testService,
      environments: deps.environments,
      servers: deps.servers,
      collections: deps.collections,
      suites: deps.suites,
      skills: deps.skills,
    }),
    // Cross-entity action tools (owner refinement); see ./action-tools.ts.
    ...buildActionToolDefinitions({
      scanService: deps.scanService,
      issues: deps.issues,
      skills: deps.skills,
      servers: deps.servers,
      runs: deps.runs,
    }),
    // Observability WP5.4 — the assistant issue-loop tools; see ./issue-loop-tools.ts.
    ...buildIssueLoopToolDefinitions({
      issues: deps.issues,
      runs: deps.runs,
      tests: deps.tests,
      testService: deps.testService,
      collections: deps.collections,
      runService: deps.runService,
      verification: deps.verification,
    }),
    // Assistant-operability WP 3.1 — the Hub read tools; see ./hub-read-tools.ts.
    ...buildHubReadToolDefinitions({ hub: deps.hub, providers: deps.providers }),
    // Assistant-operability WP 5.1 — the Hub write tools (D-AO7); see ./hub-write-tools.ts. Reuses the
    // SAME `hub` dep as the read tools — scope-exempt, approval-gated, no AssistantToolDeps change.
    ...buildHubWriteToolDefinitions({ hub: deps.hub, providers: deps.providers }),
  ];
}

/**
 * `buildAssistantTools(deps): SdkMcpServer` — the frozen WP 1.2 factory signature (see the module
 * banner + `packages/shared`'s `BuildAssistantTools`). Wraps {@link buildAssistantToolDefinitions} in
 * `createSdkMcpServer`, producing an in-process MCP server the SDK's `query({ options: { mcpServers } })`
 * accepts directly (`instance` is a live `McpServer` — same process, no HTTP hop, no secrets over the
 * wire — confirmed against the pinned `@anthropic-ai/claude-agent-sdk` `.d.ts`).
 */
export function buildAssistantTools(
  deps: AssistantToolDeps,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: "app",
    version: "1.0.0",
    tools: buildAssistantToolDefinitions(deps),
  });
}
