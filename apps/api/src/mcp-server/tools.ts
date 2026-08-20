import {
  WORKBENCH_MCP_DEFAULT_LIST_LIMIT,
  WORKBENCH_MCP_TOOL_SCHEMAS,
  type RunPlanEstimate,
  type RunPlanInput,
  type WorkbenchMcpToolName,
  deriveSkillSecuritySurface,
  runPlanInputSchema,
} from "@mcp-token-footprint/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import {
  boundText,
  compactStep,
  errorResult,
  jsonResult,
  safeTool,
  truncate,
  truncateFields,
} from "../assistant/tools/util.js";
import type { CollectionRepository } from "../collections/repository.js";
import { DEFAULT_HEATMAP_MODELS } from "../compatibility/dataset.js";
import { buildHeatmap, buildToolFindings } from "../compatibility/service.js";
import { buildRunPlanEstimate, type EstimateDeps } from "../estimate/service.js";
import type { GradeRepository } from "../grading/grade-repository.js";
import {
  buildRunJsonReport,
  buildRunMarkdownReport,
  type RunReportSources,
} from "../reports/run-report-assembly.js";
import type { ScanRepository } from "../scans/repository.js";
import type { ScanService } from "../scans/service.js";
import type { ServerRepository } from "../servers/repository.js";
import type { SkillRepository } from "../skills/repository.js";
import type { SuiteOrchestrator } from "../suites/orchestrator.js";
import { resolveRunPlan, type RunPlanDeps } from "../suites/plan-routes.js";
import type { SuiteRepository } from "../suites/repository.js";
import type { SuiteRunRepository } from "../suites/suite-run-repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import { toErrorMessage } from "../utils/errors.js";

// ==================================================================================================
// Workbench MCP server — the tool surface (roadmap/ci/mcp-server.md, WP M.1 reads + WP M.3 writes)
// ==================================================================================================
// Every handler below is a thin re-projection of a repository or service call that ALREADY exists in
// this app (D-MCP4: "no logic in the MCP layer"). Where a derivation was only reachable from a React
// component or from an Agent-SDK-bound module, it was MOVED to a place both callers can reach
// (`deriveSkillSecuritySurface` in `packages/shared`, `compactStep` in `assistant/tools/util.ts`) —
// never copied. The three write tools hold to the same rule harder, not less: each is a CALL into the
// service the HTTP route calls (`ScanService.runScan`, `SuiteOrchestrator.startSuiteRun` /
// `resolveRunPlan` + `startPlanRun`), never a copy of what that service does.
//
// **Read-first, and nothing deletes (D-MCP3).** 21 handlers read. Three act — `scan_run`,
// `suite_run_start`, `run_plan_start` — each behind its own service-token scope, because a headless
// caller has no interactive approval step and scope IS the consent. No handler deletes, prunes,
// revokes, mints a token, or edits configuration, at any scope, at any phase.
//
// **No secrets** (`.claude/rules/mcp-and-security.md`). Every handler reads only the REDACTED
// projections: `ServerRepository.list()` (which carries `hasEnvSecrets`/`hasHeaderSecrets` booleans,
// never a value), `CollectionRepository.list()` (`hasPat`, never the token), `SkillRepository`'s
// public views. The decrypting siblings — `servers.getInternal()`, `collections.decryptPat()`,
// `skills.getInternal()` — exist on those repositories but are never called here, and no
// provider-credential or OAuth store is in the deps bag at all. A test asserts a real secret value
// never crosses the wire; treat that test as the contract when adding a tool.
//
// **Every list result is bounded** (`truncate`) and self-describing (`total` + `truncated`) — with no
// exemption for entities that are low-cardinality on a dev box, because a fleet install is exactly
// where an unbounded dump hurts and a bare `{ servers: [...] }` envelope leaves a host unable to tell
// "8 servers" from "the first 8 of 400". If you add a list tool, it takes `limit` and it emits both
// markers; a bare `deps.x.list()` in a handler is the bug this comment exists to prevent.

/** The repositories/services the tools project. Deliberately narrow — see the banner. */
export type WorkbenchMcpDeps = {
  servers: ServerRepository;
  scans: ScanRepository;
  runs: RunRepository;
  grades: GradeRepository;
  skills: SkillRepository;
  suites: SuiteRepository;
  suiteRuns: SuiteRunRepository;
  collections: CollectionRepository;
  /** The run-report assembly the HTTP export routes use (`reports/run-report-assembly.ts`). */
  runReports: RunReportSources;
  /** The scan service the HTTP scan route uses — `runScan` is re-projected verbatim (D-MCP4). */
  scanService: ScanService;
  /** The suite orchestrator behind `POST /api/suites/:id/run` and `POST /api/run-plans`. */
  suiteOrchestrator: SuiteOrchestrator;
  /** The run-plan resolver's dependencies (`suites`/`collections`/`tests` services). */
  runPlans: RunPlanDeps;
  /** The launcher's advisory estimate (`buildRunPlanEstimate`) — D-MCP12. */
  estimate: EstimateDeps;
};

/** One SDK-neutral tool definition: what to register, and what to run. */
export type WorkbenchMcpToolDefinition = {
  name: WorkbenchMcpToolName;
  description: string;
  /** A ZodRawShape from `WORKBENCH_MCP_TOOL_SCHEMAS` — what `McpServer.registerTool` consumes. */
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
};

/** Longest text-file body returned by `skills_file_content` before an explicit truncation marker. */
const MAX_FILE_TEXT_CHARS = 20_000;
/** Longest report document returned inline by `run_report` (use the resource for the full document). */
const MAX_REPORT_CHARS = 60_000;
/** Default per-page size for `scans_tools` and the per-run step trace. */
const DEFAULT_PAGE_LIMIT = 150;

const LIST_LIMIT = WORKBENCH_MCP_DEFAULT_LIST_LIMIT;

/**
 * Bind one tool's shape to its handler with the argument type INFERRED from the shape, so a handler
 * cannot read a field the declared schema does not have. The single cast is contained here.
 */
function defineTool<S extends z.ZodRawShape>(
  name: WorkbenchMcpToolName,
  inputSchema: S,
  description: string,
  handler: (args: z.infer<z.ZodObject<S>>) => CallToolResult | Promise<CallToolResult>,
): WorkbenchMcpToolDefinition {
  return {
    name,
    description,
    inputSchema,
    handler: (args) => safeTool(() => handler(args as z.infer<z.ZodObject<S>>)),
  };
}

/** A run's `RunDetail`, compacted for a host: bounded step trace, no raw event log. */
function compactRun(
  detail: ReturnType<RunRepository["getRun"]>,
  stepLimit: number,
): Record<string, unknown> {
  const steps = truncate(detail.steps, stepLimit);
  return {
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
}

/** The SKILL.md body of a version, or `""` when it has none / it is binary. */
function readSkillMdBody(skills: SkillRepository, versionId: string): string {
  const skillMd = skills.listFiles(versionId).find((file) => file.isSkillMd);
  if (!skillMd) return "";
  const content = skills.getFileContent(versionId, skillMd.path);
  return content.isBinary ? "" : content.text;
}

/** What every launch tool carries back: the advisory preview, or an honest note saying why not. */
type AdvisoryEstimate = { estimate: RunPlanEstimate | null; estimateNote?: string };

/**
 * The launcher's advisory cost preview (D-MCP12) — {@link buildRunPlanEstimate}, the SAME function
 * `GET /api/estimate/run-plan` calls, re-projected rather than re-derived, so an agent and the UI see
 * one number rather than two that drift.
 *
 * It is **advisory only**: it never blocks a launch, and a model with no pricing entry is reported
 * unpriced rather than as zero (that is `buildRunPlanEstimate`'s own behaviour, preserved by calling
 * it instead of copying it). If it throws for ANY reason the launch still proceeds and the result
 * carries `estimate: null` plus a one-line note — a cost preview must never be the reason a launch
 * fails.
 */
function advisoryEstimate(
  deps: WorkbenchMcpDeps,
  input: { testIds: string[]; environmentIds: string[]; repetitions: number },
): AdvisoryEstimate {
  try {
    return { estimate: buildRunPlanEstimate(deps.estimate, input) };
  } catch (error) {
    return {
      estimate: null,
      estimateNote: `Cost preview unavailable (${toErrorMessage(error)}). The launch was unaffected.`,
    };
  }
}

/**
 * Build the {@link RunPlanInput} a flat `run_plan_start` call describes, then validate it with the
 * EXISTING `runPlanInputSchema` — the same parser `POST /api/run-plans` uses (D-MCP4). The MCP SDK's
 * `inputSchema` is a ZodRawShape and cannot express a discriminated union, so the union member is
 * reassembled here and the wire contract is enforced by the one parser that owns it: a `collection`
 * with no `collectionId`, or an `adhoc` with no `testIds`, fails THERE, not in a hand-written check.
 */
function buildRunPlanInput(args: {
  source: "collection" | "adhoc";
  collectionId?: string;
  testIds?: string[];
  scenarioIds?: string[];
  repetitions?: number;
  maxConcurrency?: number;
  aggregateCostCapUsd?: number;
}): RunPlanInput {
  const overrides = {
    ...(args.repetitions !== undefined ? { repetitions: args.repetitions } : {}),
    ...(args.maxConcurrency !== undefined ? { maxConcurrency: args.maxConcurrency } : {}),
    ...(args.aggregateCostCapUsd !== undefined
      ? { aggregateCostCapUsd: args.aggregateCostCapUsd }
      : {}),
  };
  const candidate =
    args.source === "collection"
      ? { source: "collection", collectionId: args.collectionId, scenarioIds: args.scenarioIds, ...overrides }
      : { source: "adhoc", testIds: args.testIds, scenarioIds: args.scenarioIds, ...overrides };
  return runPlanInputSchema.parse(candidate);
}

/**
 * Build every tool — the 21 reads, then the three Actions. Exported separately from the `McpServer`
 * factory so tests can call one handler directly, without a transport or a protocol round-trip.
 */
export function buildWorkbenchToolDefinitions(
  deps: WorkbenchMcpDeps,
): WorkbenchMcpToolDefinition[] {
  const S = WORKBENCH_MCP_TOOL_SCHEMAS;
  return [
    // ── Servers & scans ───────────────────────────────────────────────────────────────────────
    defineTool(
      "servers_list",
      S.servers_list,
      "List every registered MCP server with its redacted config (transport, command/url, auth kind). " +
        "Secret values are never included — only hasEnvSecrets/hasHeaderSecrets booleans.",
      (args) => {
        const capped = truncate(deps.servers.list(), args.limit ?? LIST_LIMIT);
        return jsonResult({
          servers: capped.items,
          total: capped.total,
          truncated: capped.truncated,
        });
      },
    ),

    defineTool(
      "scans_list",
      S.scans_list,
      "List discovery-scan summaries, newest first, optionally for one server. Summaries only — use " +
        "scans_get or scans_tools for a scan's detail.",
      (args) => {
        const rows = args.serverId
          ? deps.scans.listSummariesByServer(args.serverId)
          : deps.scans.listSummaries();
        const capped = truncate(rows, args.limit ?? LIST_LIMIT);
        return jsonResult({
          scans: capped.items,
          total: capped.total,
          truncated: capped.truncated,
        });
      },
    ),

    defineTool(
      "scans_get",
      S.scans_get,
      "Get one scan's summary: server, token profile, tool/resource/prompt totals and the largest " +
        "contributors.",
      (args) => jsonResult(deps.scans.getSummary(args.scanId)),
    ),

    defineTool(
      "scans_latest",
      S.scans_latest,
      "Get the most recent completed scan for one server, tools included. Returns null when the " +
        "server has never scanned successfully.",
      (args) => {
        const detail = deps.scans.getLatestForServer(args.serverId);
        if (!detail) return jsonResult({ scan: null });
        const tools = truncate(detail.tools, DEFAULT_PAGE_LIMIT);
        return jsonResult({
          scan: { ...detail, tools: tools.items },
          toolsTotal: tools.total,
          toolsTruncated: tools.truncated,
        });
      },
    ),

    defineTool(
      "scans_tools",
      S.scans_tools,
      "Page through a scan's per-tool token footprints (name, per-facet tokens, contribution %), " +
        "ranked by cost. Pass offset to continue.",
      (args) => {
        const detail = deps.scans.getDetail(args.scanId);
        const offset = args.offset ?? 0;
        const limit = args.limit ?? DEFAULT_PAGE_LIMIT;
        const page = detail.tools.slice(offset, offset + limit);
        return jsonResult({
          tools: page,
          total: detail.tools.length,
          offset,
          truncated: offset + page.length < detail.tools.length,
        });
      },
    ),

    defineTool(
      "compatibility_heatmap",
      S.compatibility_heatmap,
      "Score a scan's tools against model context/tool-schema limits, as a server×model or tool×model " +
        "heatmap. Defaults to a representative model set.",
      (args) => {
        const scan = deps.scans.getDetail(args.scanId);
        const heatmap = buildHeatmap(scan, args.models ?? DEFAULT_HEATMAP_MODELS, {
          view: args.view ?? "server",
          rollup: args.rollup ?? "worst-tool",
        });
        return jsonResult(truncateFields(heatmap, ["rows"], LIST_LIMIT));
      },
    ),

    defineTool(
      "compatibility_findings",
      S.compatibility_findings,
      "List a scan's tool-level compatibility findings: per test the offending tools and worst " +
        "severity, plus a per-tool severity tally. Use compatibility_heatmap for the model matrix.",
      (args) => {
        const scan = deps.scans.getDetail(args.scanId);
        const findings = buildToolFindings(scan, args.models ?? DEFAULT_HEATMAP_MODELS);
        return jsonResult(truncateFields(findings, ["byTest", "byTool"], LIST_LIMIT));
      },
    ),

    // ── Runs & reports ────────────────────────────────────────────────────────────────────────
    defineTool(
      "runs_list",
      S.runs_list,
      "List test runs, newest first, optionally filtered by test, environment (scenarioId), status " +
        "and an ISO startedAt range. Summaries only.",
      (args) => {
        let rows = deps.runs.listRuns({
          testId: args.testId,
          scenarioId: args.scenarioId,
          status: args.status,
        });
        if (args.since) rows = rows.filter((row) => row.startedAt >= (args.since as string));
        if (args.until) rows = rows.filter((row) => row.startedAt < (args.until as string));
        const capped = truncate(rows, args.limit ?? LIST_LIMIT);
        return jsonResult({ runs: capped.items, total: capped.total, truncated: capped.truncated });
      },
    ),

    defineTool(
      "runs_get",
      S.runs_get,
      "Get one run's summary plus its step trace (tool calls, turns, token/context usage, resolved " +
        "skills). Check stepsTruncated; run_report gives the same run as one document.",
      (args) => jsonResult(compactRun(deps.runs.getRun(args.runId), args.stepLimit ?? LIST_LIMIT)),
    ),

    defineTool(
      "runs_grades",
      S.runs_grades,
      "Get a run's quality grades — the latest row per grader (score, status, method, cost) plus how " +
        "many grade rows exist in total.",
      (args) => {
        const latest = deps.grades.latestByGrader(args.runId);
        return jsonResult({
          runId: args.runId,
          grades: latest,
          allGradesTotal: deps.grades.listByRun(args.runId).length,
        });
      },
    ),

    defineTool(
      "run_report",
      S.run_report,
      "Get a run's full report (rating, config, statistics, step breakdown) as Markdown (default) or " +
        "JSON. Long reports are bounded — read workbench://reports/run/<id>.md for the whole document.",
      (args) => {
        if (args.format === "json") {
          return jsonResult(buildRunJsonReport(deps.runReports, args.runId));
        }
        const markdown = buildRunMarkdownReport(deps.runReports, args.runId);
        return {
          content: [{ type: "text" as const, text: boundText(markdown, MAX_REPORT_CHARS) }],
        };
      },
    ),

    // ── Skills ────────────────────────────────────────────────────────────────────────────────
    defineTool(
      "skills_list",
      S.skills_list,
      "List registered Agent Skills: name, source (upload/GitHub), current version id, version count.",
      (args) => {
        const capped = truncate(deps.skills.list(), args.limit ?? LIST_LIMIT);
        return jsonResult({
          skills: capped.items,
          total: capped.total,
          truncated: capped.truncated,
        });
      },
    ),

    defineTool(
      "skills_get",
      S.skills_get,
      "Get one skill's metadata. Use skills_versions for its history.",
      (args) => jsonResult(deps.skills.getPublic(args.skillId)),
    ),

    defineTool(
      "skills_versions",
      S.skills_versions,
      "List a skill's versions, newest first, each with its L1 metadata / L2 body / L3 resource token " +
        "footprint.",
      (args) => jsonResult({ versions: deps.skills.listVersions(args.skillId) }),
    ),

    defineTool(
      "skills_files",
      S.skills_files,
      "List the files in one skill version — path, size, kind, per-file tokens. The tree, not the " +
        "contents.",
      (args) => jsonResult({ files: deps.skills.listFiles(args.versionId) }),
    ),

    defineTool(
      "skills_file_content",
      S.skills_file_content,
      "Read one file from a skill version. Text is returned bounded with a truncation marker; a binary " +
        "file returns metadata only.",
      (args) => {
        const file = deps.skills.getFileContent(args.versionId, args.path);
        if (file.isBinary) return jsonResult(file);
        const bounded = boundText(file.text, MAX_FILE_TEXT_CHARS);
        return jsonResult({
          ...file,
          text: bounded,
          truncated: bounded.length !== file.text.length,
        });
      },
    ),

    defineTool(
      "skills_security",
      S.skills_security,
      "Security surface of one skill version: how many bundled scripts and in which languages, whether " +
        "SKILL.md references the network, file/byte totals, and the version's token footprint. Skill " +
        "content is inspected, never executed.",
      (args) => {
        const version = deps.skills.getVersion(args.versionId);
        const files = deps.skills.listFiles(args.versionId);
        return jsonResult({
          versionId: version.id,
          skillId: version.skillId,
          versionLabel: version.versionLabel,
          footprint: {
            tokenProfile: version.tokenProfile,
            l1MetadataTokens: version.l1MetadataTokens,
            l2BodyTokens: version.l2BodyTokens,
            l3ResourceTokens: version.l3ResourceTokens,
            totalTokens: version.totalTokens,
          },
          security: deriveSkillSecuritySurface(files, readSkillMdBody(deps.skills, args.versionId)),
        });
      },
    ),

    // ── Suites & collections ──────────────────────────────────────────────────────────────────
    defineTool(
      "suites_list",
      S.suites_list,
      "List benchmark suites (the test × environment × repetition matrices a suite run executes).",
      (args) => {
        const capped = truncate(deps.suites.list(), args.limit ?? LIST_LIMIT);
        return jsonResult({
          suites: capped.items,
          total: capped.total,
          truncated: capped.truncated,
        });
      },
    ),

    defineTool(
      "suite_runs_list",
      S.suite_runs_list,
      "List suite runs, newest first, optionally scoped to one suite and/or status.",
      (args) => {
        let rows = deps.suiteRuns.listRuns(args.suiteId);
        if (args.status) rows = rows.filter((row) => row.status === args.status);
        const capped = truncate(rows, args.limit ?? LIST_LIMIT);
        return jsonResult({
          suiteRuns: capped.items,
          total: capped.total,
          truncated: capped.truncated,
        });
      },
    ),

    defineTool(
      "suite_runs_get",
      S.suite_runs_get,
      "Get one suite run: status, config snapshot, cached aggregates, and its member run ids each with " +
        "their latest grade per grader.",
      (args) => {
        const suiteRun = deps.suiteRuns.getRun(args.suiteRunId);
        const members = truncate(
          deps.suiteRuns.listChildRunIds(args.suiteRunId),
          args.memberLimit ?? LIST_LIMIT,
        );
        return jsonResult({
          ...suiteRun,
          memberRunIds: members.items,
          memberRunsTotal: members.total,
          memberRunsTruncated: members.truncated,
          memberGrades: members.items.map((runId) => ({
            runId,
            grades: deps.grades.latestByGrader(runId),
          })),
        });
      },
    ),

    defineTool(
      "collections_list",
      S.collections_list,
      "List collections — the home tests and suites are organised in, with their optional GitHub " +
        "binding. Never returns the GitHub token, only whether one is set.",
      (args) => {
        const capped = truncate(deps.collections.list(), args.limit ?? LIST_LIMIT);
        return jsonResult({
          collections: capped.items,
          total: capped.total,
          truncated: capped.truncated,
        });
      },
    ),

    // ── Actions (write — WP M.3) ──────────────────────────────────────────────────────────────
    // Three tools, one per execute scope (D-MCP10). Each is a CALL into the service the HTTP route
    // calls; each states in its description what it costs, which scope it needs, and which read tool
    // finishes the job (D-MCP11). None of them waits, and none of them deletes.
    defineTool(
      "scan_run",
      S.scan_run,
      "Start a discovery scan of a registered MCP server and wait for it: opens a REAL connection to " +
        "that server, so it takes as long as that server does. Needs the `scan:run` scope on top of " +
        "`read`. Returns a summary; call scans_get with the scanId for the per-tool breakdown.",
      async (args) => {
        const detail = await deps.scanService.runScan(args.serverId, args.tokenProfile);
        const summary = {
          scanId: detail.id,
          serverId: detail.serverId,
          serverName: detail.serverName,
          status: detail.status,
          scannedAt: detail.scannedAt,
          totalTools: detail.totalTools,
          totalTokens: detail.totalTokens,
          totalRawBytes: detail.totalRawBytes,
          tokenProfile: detail.tokenProfile,
          countingVersion: detail.countingVersion,
          ...(detail.errorMessage ? { errorMessage: detail.errorMessage } : {}),
          next: "Call scans_get with this scanId for the per-tool breakdown.",
        };
        // The REQUEST succeeded; the SCAN may not have. A failed scan comes back as an `isError`
        // result carrying the same summary, so an agent cannot read a zero-tool row as a clean bill
        // of health — the same distinction `mcpfp scan` draws with exit 2 (D-C7).
        if (detail.status !== "success") {
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(summary) }] };
        }
        return jsonResult(summary);
      },
    ),

    defineTool(
      "suite_run_start",
      S.suite_run_start,
      "Start a saved benchmark suite's matrix run (its tests × environments × repetitions). SPENDS " +
        "provider tokens against the configured cost caps. Needs the `suites:run` scope on top of " +
        "`read`. Returns immediately with a suiteRunId and an advisory cost estimate; poll " +
        "suite_runs_get.",
      (args) => {
        // Read the suite FIRST: an unknown id 404s once, here, before anything is estimated or
        // started, and its stored membership is what the estimate must be built from.
        const suite = deps.runPlans.suites.get(args.suiteId);
        const estimate = advisoryEstimate(deps, {
          testIds: suite.testIds,
          environmentIds: suite.scenarioIds,
          repetitions: suite.config.repetitions,
        });
        const suiteRun = deps.suiteOrchestrator.startSuiteRun(args.suiteId);
        return jsonResult({
          suiteRunId: suiteRun.id,
          suiteId: args.suiteId,
          status: suiteRun.status,
          startedAt: suiteRun.startedAt,
          source: suiteRun.source,
          ...estimate,
          next: "Call suite_runs_get with this suiteRunId for status, members and grades.",
        });
      },
    ),

    defineTool(
      "run_plan_start",
      S.run_plan_start,
      "Launch a collection run (every test in a collection) or an ad-hoc run plan (explicit tests) " +
        "against the given environments. SPENDS provider tokens against the configured cost caps. " +
        "Needs the `runs:launch` scope on top of `read`. Returns a suiteRunId immediately plus an " +
        "advisory cost estimate; poll suite_runs_get. Saved suites go through suite_run_start.",
      (args) => {
        // D-MCP10, said twice on purpose. The enum has no `"suite"` member, so the SDK refuses it
        // before this runs; an agent that reaches here with one anyway is TOLD which tool to use,
        // because `runs:launch` must never be a back door onto a saved suite — that would make
        // `suites:run` decorative, and a scope nobody has to hold is not consent.
        if ((args.source as string) === "suite") {
          return errorResult(
            "run_plan_start does not run saved suites. Call suite_run_start with the suite's id — " +
              "that is a separate permission (`suites:run`), and holding `runs:launch` does not " +
              "grant it.",
          );
        }
        const input = buildRunPlanInput(args);
        const resolved = resolveRunPlan(input, deps.runPlans);
        // Resolve and estimate BEFORE starting, so a plan that cannot resolve never leaves a
        // `suite_runs` row behind.
        const estimate = advisoryEstimate(deps, {
          testIds: resolved.testIds,
          environmentIds: resolved.scenarioIds,
          repetitions: resolved.config.repetitions,
        });
        const suiteRun = deps.suiteOrchestrator.startPlanRun(resolved);
        return jsonResult({
          suiteRunId: suiteRun.id,
          status: suiteRun.status,
          startedAt: suiteRun.startedAt,
          source: suiteRun.source,
          testCount: resolved.testIds.length,
          environmentCount: resolved.scenarioIds.length,
          ...estimate,
          next: "Call suite_runs_get with this suiteRunId for status, members and grades.",
        });
      },
    ),
  ];
}
