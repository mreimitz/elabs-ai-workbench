import { z } from "zod";
import type { ApiTokenScope } from "./api-tokens.js";
import {
  RUN_STATUSES,
  SUITE_MAX_CONCURRENCY,
  SUITE_MAX_REPETITIONS,
  SUITE_RUN_STATUSES,
  TOKEN_PROFILES,
} from "./constants.js";

// ==================================================================================================
// Workbench MCP server — the shared contract for the app's OWN MCP surface (planning/Roadmap/RM-08-ci/mcp-server.md)
// ==================================================================================================
// The MCP bench must be MCP-operable: an external agent (a Claude Code session in a skill repo, a CI
// job) connects to this app over streamable HTTP and reads what it has already measured — scans,
// runs, skills, suites, grades, compatibility — without a browser.
//
// This module is the SINGLE declaration of that surface, and it lives in `packages/shared` on purpose:
//
//   • **D-MCP1** — the mount path the Fastify API serves and any client dials.
//   • **D-MCP4 (one tool registry)** — the tool NAMES and their zod ARGUMENT SHAPES are declared once
//     here, so the streamable-HTTP mount today and the `mcpfp` CLI later resolve to one definition
//     rather than two drifting copies. The MCP SDK's `registerTool` takes a **ZodRawShape** for
//     `inputSchema`, so the shapes below are plain objects of zod fields, NOT `z.object(...)` wrappers.
//   • **D-MCP5 (dogfood gate)** — the token budget the serialized `tools/list` payload must stay under,
//     measured with the app's own counter.
//
// **D-MCP3 — read-first, and deletes never arrive.** WP M.1 shipped 21 read tools; WP M.3 adds exactly
// three WRITE tools (`scan_run`, `suite_run_start`, `run_plan_start`), one per execute scope in the
// frozen D-C4 vocabulary, each reachable by a token only when that token was granted the scope. Nothing
// on this surface deletes, prunes, revokes, or edits configuration, at any scope, at any phase. A tool
// name added to `WORKBENCH_MCP_TOOL_NAMES` that the server does not register (or vice versa) fails
// `pnpm test` — the list is a gate, not documentation.

/** The path the streamable-HTTP MCP mount is served on (D-MCP1: same process, no sidecar). */
export const WORKBENCH_MCP_MOUNT_PATH = "/api/mcp";

/** `serverInfo.name` reported by `initialize`. */
export const WORKBENCH_MCP_SERVER_NAME = "mcp-token-footprint";

/** `serverInfo.version` reported by `initialize`. Bump when the tool/resource surface changes shape. */
export const WORKBENCH_MCP_SERVER_VERSION = "1.0.0";

/** The URI scheme every workbench MCP resource lives under. */
export const WORKBENCH_MCP_RESOURCE_SCHEME = "workbench";

/**
 * Every read tool the mount registers, in registration order. A gate test asserts this set-equals what
 * `tools/list` actually returns, so a tool added to the server without being declared here — or
 * declared here and never wired — is a build failure rather than a silent surface change.
 */
export const WORKBENCH_MCP_READ_TOOL_NAMES = [
  // Servers & scans
  "servers_list",
  "scans_list",
  "scans_get",
  "scans_latest",
  "scans_tools",
  "compatibility_heatmap",
  "compatibility_findings",
  // Runs & reports
  "runs_list",
  "runs_get",
  "runs_grades",
  "run_report",
  // Skills
  "skills_list",
  "skills_get",
  "skills_versions",
  "skills_files",
  "skills_file_content",
  "skills_security",
  // Suites, collections
  "suites_list",
  "suite_runs_list",
  "suite_runs_get",
  "collections_list",
] as const;

export type WorkbenchMcpReadToolName = (typeof WORKBENCH_MCP_READ_TOOL_NAMES)[number];

/** O(1) membership set over {@link WORKBENCH_MCP_READ_TOOL_NAMES}. */
export const WORKBENCH_MCP_READ_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  WORKBENCH_MCP_READ_TOOL_NAMES,
);

/**
 * The WRITE tools (WP M.3). Three, one per execute scope in the frozen D-C4 vocabulary — and that is
 * not a coincidence: a scope with no tool is decorative, and a tool with no scope of its own is a
 * privilege the operator cannot decline. Nothing here deletes (D-MCP3, at every phase).
 *
 * Each one is a re-projection of a service the HTTP API already exposes (D-MCP4), and each answers
 * with a TICKET rather than an outcome (D-MCP11): `scan_run` returns a compact scan summary because
 * `ScanService.runScan` is synchronous, and the two launch tools return the `running` suite-run id
 * because the orchestrator is asynchronous by construction. Polling is `scans_get` / `suite_runs_get`,
 * which already exist and are already `read` — no write tool blocks, and none invents a `wait` mode.
 */
export const WORKBENCH_MCP_WRITE_TOOL_NAMES = [
  "scan_run",
  "suite_run_start",
  "run_plan_start",
] as const;

export type WorkbenchMcpWriteToolName = (typeof WORKBENCH_MCP_WRITE_TOOL_NAMES)[number];

/** Every tool the mount registers — reads and writes, in registration order. */
export const WORKBENCH_MCP_TOOL_NAMES = [
  ...WORKBENCH_MCP_READ_TOOL_NAMES,
  ...WORKBENCH_MCP_WRITE_TOOL_NAMES,
] as const;

export type WorkbenchMcpToolName = WorkbenchMcpReadToolName | WorkbenchMcpWriteToolName;

/** O(1) membership set over {@link WORKBENCH_MCP_WRITE_TOOL_NAMES}. */
export const WORKBENCH_MCP_WRITE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  WORKBENCH_MCP_WRITE_TOOL_NAMES,
);

/**
 * The scope each registered tool needs from a **token-authenticated** caller (WP M.2).
 *
 * Every tool in WP M.1's read surface is `read`; WP M.3's write tools name their execute scope here
 * and nowhere else, so "what does this tool cost me in consent" is answered by one table rather than
 * by reading handlers. A test asserts this record's key set equals the registered tool names
 * **exactly** — a new tool with no scope, or a scope for a tool that does not exist, fails the gate,
 * and the mount additionally refuses an unmapped tool at dispatch (fail closed, belt and braces).
 *
 * Two things this map deliberately does NOT decide:
 *
 *   • **Whether enforcement applies at all.** A tokenless loopback caller is trusted with the whole
 *     mount (D-MCP7) — the same posture the rest of the API already has, where `curl` on the host can
 *     `POST /api/runs` with no credential. The mount does not get a stricter rule than the API it is
 *     mounted on; `API_AUTH_REQUIRED=true` is the one switch that changes that, for everything at once.
 *   • **Whether the caller may open the mount.** That is the route rule (`API_TOKEN_ROUTE_SCOPES`:
 *     `POST /api/mcp → read`, D-MCP8). A token-authenticated caller that reached a tool at all
 *     therefore already holds `read` — which is why every read tool below naming `read` restates the
 *     door rule rather than adding a second gate, and why a write-capable agent needs `read` **plus**
 *     its execute scope.
 */
export const WORKBENCH_MCP_TOOL_SCOPES: Record<string, ApiTokenScope> = {
  // ── Servers & scans ─────────────────────────────────────────────────────────────────────────
  servers_list: "read",
  scans_list: "read",
  scans_get: "read",
  scans_latest: "read",
  scans_tools: "read",
  compatibility_heatmap: "read",
  compatibility_findings: "read",

  // ── Runs & reports ──────────────────────────────────────────────────────────────────────────
  runs_list: "read",
  runs_get: "read",
  runs_grades: "read",
  run_report: "read",

  // ── Skills ──────────────────────────────────────────────────────────────────────────────────
  skills_list: "read",
  skills_get: "read",
  skills_versions: "read",
  skills_files: "read",
  skills_file_content: "read",
  skills_security: "read",

  // ── Suites, collections ─────────────────────────────────────────────────────────────────────
  suites_list: "read",
  suite_runs_list: "read",
  suite_runs_get: "read",
  collections_list: "read",

  // ── Actions (write — WP M.3) ────────────────────────────────────────────────────────────────
  // One tool per execute scope, and the scope decides the tool (D-MCP10). `run_plan_start` refuses a
  // `suite` source and names `suite_run_start` instead, so a `runs:launch` token can never run a saved
  // suite through the generic plan endpoint — without that refusal `suites:run` would be decorative.
  // Each of these needs `read` TOO, because `read` is the price of admission to the mount (D-MCP8).
  scan_run: "scan:run",
  suite_run_start: "suites:run",
  run_plan_start: "runs:launch",
};

/** Hard ceiling on any `limit` argument — a host asking for more gets a validation error, not a dump. */
export const WORKBENCH_MCP_MAX_LIST_LIMIT = 200;

/** Rows a list-shaped tool returns when the caller passes no `limit`. */
export const WORKBENCH_MCP_DEFAULT_LIST_LIMIT = 50;

/**
 * Token budget for the serialized `tools/list` payload — the definition footprint an external host
 * pays on EVERY conversation just to know this server exists (D-MCP5: we measure ourselves with our
 * own scanner).
 *
 * How this number was chosen: the 21-tool surface measures **2,206 tokens** under the app's default
 * `generic_o200k` profile (`apps/api/test/workbench-mcp-server.test.ts` prints the live figure on every
 * run, so the real cost is never a guess), and **2,224 tokens** when the app's own discovery scanner
 * is pointed at the running mount — the two agree to within 1%, which is the whole point of measuring
 * ourselves the way we measure everyone else. The budget was set at **3,000**: about 35% headroom,
 * enough for the WP M.3 write tools and a few longer descriptions without ceremony, tight enough that
 * a careless paragraph trips the gate instead of quietly costing every host a thousand tokens a turn.
 * WP M.4 turns this same assertion into a CI job that scans the running mount with our own scanner.
 *
 * **Raised to 3,500 on 2026-08-20, deliberately, to pay for parameter descriptions.** The 24-tool
 * surface measured 2,749 tokens with **no parameter described anywhere**; our own security analyzer
 * reported that 49 times, and it was right — an agent could not tell whether `runs_list.since` wanted
 * an ISO instant or a run id. Describing all 49 costs **+434 tokens** (about 8.9 each), taking the
 * mount to 3,183.
 *
 * The raise is recorded here rather than done quietly, because raising a budget you just failed is
 * the wrong instinct by default. Three things were checked before it:
 *
 *   1. **Is there fat to trim instead?** No. Schema envelopes are 1,900 of the 3,183 tokens and are
 *      structural; the tool descriptions are already dense, and the only genuinely cuttable text — the
 *      "needs the `x` scope" sentence on the three write tools — is worth ~33 tokens against a
 *      183-token shortfall, and it earns its place by letting an agent avoid a call it cannot make.
 *   2. **Could we describe fewer?** Yes — roughly half the parameters are `limit`, whose meaning is
 *      self-evident. But leaving them undescribed to keep a number under a line we drew ourselves is
 *      precisely what we would criticise a vendor for, and the analyzer would still report them.
 *   3. **Is the new headroom honest?** 3,500 leaves ~10% over the measured 3,183 — the same
 *      proportion the original 3,000 left over its own 2,749, so the gate stays as tight as it was.
 */
// RM-38 WP 2.2 — the number itself is now AUTHORED in `data-pack/quality/thresholds.json` and
// rendered into `pack-defaults.generated.ts`. This re-export keeps the name (and the reasoning
// above) where every reader already looks; `apps/api` reads the RUNTIME pack's value through
// `workbenchMcpDefinitionTokenBudget()`, so a pack update moves the gate with no code edit.
export { WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET } from "./pack-defaults.generated.js";

// ── Tool argument shapes (ZodRawShape — see the banner) ───────────────────────────────────────────

const idField = z.string().min(1);
const limitField = z.number().int().positive().max(WORKBENCH_MCP_MAX_LIST_LIMIT).optional();

/**
 * **Every parameter below carries a description, and these two helpers are why it costs so little.**
 *
 * The mount used to declare 49 parameters with no description at all, which our own security analyzer
 * reported 49 times (`schema.undescribed-parameter`) — and it was right: its rationale is that an
 * undescribed parameter is *"a correctness problem before it is a cost problem: guessed arguments mean
 * failed calls and retries"*. An agent reading `runs_list` could not tell whether `since` wanted an
 * ISO instant or a run id.
 *
 * They are deliberately TERSE — three to eight words, no sentences of ceremony — because this text is
 * paid for on every single turn by every host that loads the mount, and
 * {@link WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET} is a gate we hold ourselves to (D-MCP5). Where a
 * parameter takes an id, the description names the tool that produces it, which is the one thing a
 * caller cannot infer from the type.
 */
const id = (says: string) => idField.describe(says);
const optionalId = (says: string) => z.string().optional().describe(says);
const limit = (says: string) => limitField.describe(says);

/**
 * The argument shape of every tool, keyed by tool name. Each value is a **ZodRawShape** (a plain
 * object of zod fields) because that is what `McpServer.registerTool({ inputSchema })` consumes; wrap
 * one in `z.object(...)` at a call site that needs a parser instead.
 *
 * **Every list-shaped tool takes `limit`** — no exceptions for entities that happen to be
 * low-cardinality today. A fleet install with hundreds of registered servers must not dump all of
 * them into a host's context, and a caller that cannot tell "8 servers" from "the first 8 of 400"
 * has been handed a worse answer than either bound would give. The handler pairs the field with
 * `truncate(...)` so the result always carries `total` + `truncated`.
 */
export const WORKBENCH_MCP_TOOL_SCHEMAS = {
  // ── Servers & scans ─────────────────────────────────────────────────────────────────────────
  servers_list: { limit: limit("Max servers to return.") },
  scans_list: {
    serverId: optionalId("Only scans of this server."),
    limit: limit("Max scans to return."),
  },
  scans_get: { scanId: id("Scan id, from scans_list.") },
  scans_latest: { serverId: id("Server id, from servers_list.") },
  scans_tools: {
    scanId: id("Scan id, from scans_list."),
    limit: limit("Max tools to return."),
    offset: z.number().int().nonnegative().optional().describe("Tools to skip, for paging."),
  },
  compatibility_heatmap: {
    scanId: id("Scan id, from scans_list."),
    models: z
      .array(z.string())
      .max(20)
      .optional()
      .describe("Model ids; default every known model."),
    view: z.enum(["server", "tool"]).optional().describe("Rows are servers, or tools."),
    rollup: z
      .enum(["worst-tool", "average-tool"])
      .optional()
      .describe("How tool rows collapse to one verdict."),
  },
  compatibility_findings: {
    scanId: id("Scan id, from scans_list."),
    models: z
      .array(z.string())
      .max(20)
      .optional()
      .describe("Model ids; default every known model."),
  },

  // ── Runs & reports ──────────────────────────────────────────────────────────────────────────
  runs_list: {
    testId: optionalId("Only runs of this test."),
    scenarioId: optionalId("Only runs in this environment."),
    status: z.enum(RUN_STATUSES).optional().describe("Only runs in this state."),
    since: z.string().optional().describe("ISO 8601 instant; runs started at or after it."),
    until: z.string().optional().describe("ISO 8601 instant; runs started before it."),
    limit: limit("Max runs to return."),
  },
  runs_get: {
    runId: id("Run id, from runs_list."),
    stepLimit: limit("Max steps to return."),
  },
  runs_grades: { runId: id("Run id, from runs_list.") },
  run_report: {
    runId: id("Run id, from runs_list."),
    format: z.enum(["markdown", "json"]).optional().describe("Rendering; default markdown."),
  },

  // ── Skills ──────────────────────────────────────────────────────────────────────────────────
  skills_list: { limit: limit("Max skills to return.") },
  skills_get: { skillId: id("Skill id, from skills_list.") },
  skills_versions: { skillId: id("Skill id, from skills_list.") },
  skills_files: { versionId: id("Version id, from skills_versions.") },
  skills_file_content: {
    versionId: id("Version id, from skills_versions."),
    path: id("Path inside the skill, from skills_files."),
  },
  skills_security: { versionId: id("Version id, from skills_versions.") },

  // ── Suites, collections ─────────────────────────────────────────────────────────────────────
  suites_list: { limit: limit("Max suites to return.") },
  suite_runs_list: {
    suiteId: optionalId("Only runs of this suite."),
    status: z.enum(SUITE_RUN_STATUSES).optional().describe("Only suite runs in this state."),
    limit: limit("Max suite runs to return."),
  },
  suite_runs_get: {
    suiteRunId: id("Suite run id, from suite_runs_list."),
    memberLimit: limit("Max member runs to return."),
  },
  collections_list: { limit: limit("Max collections to return.") },

  // ── Actions (write — WP M.3) ────────────────────────────────────────────────────────────────
  // `run_plan_start`'s shape is FLAT and permissive here, strict at the handler: `registerTool`'s
  // `inputSchema` is a ZodRawShape and cannot express the discriminated union `RunPlanInput` really
  // is. The handler rebuilds the union member and hands it to the EXISTING `runPlanInputSchema` — the
  // same parser `POST /api/run-plans` uses (D-MCP4: never a hand-written second check) — so a
  // `collection` with no `collectionId`, or an `adhoc` with no `testIds`, fails there and surfaces as
  // a readable `isError` result.
  //
  // `source` deliberately has NO `"suite"` member (D-MCP10): the enum refuses it inside the SDK before
  // the handler runs, and the handler refuses the string again with a sentence naming `suite_run_start`
  // so an agent that guesses is told what to use instead of being handed a schema dump.
  //
  // `judgeOverride` and `variants` are deliberately NOT exposed: they are the two plan knobs that
  // reference provider credentials and skill versions, a headless agent has no business tuning them,
  // and leaving them off keeps the definition footprint down (D-MCP5). An agent that needs them saves
  // a suite and calls `suite_run_start`.
  scan_run: {
    serverId: id("Server id, from servers_list."),
    tokenProfile: z.enum(TOKEN_PROFILES).optional().describe("Tokenizer; default the app's."),
  },
  suite_run_start: { suiteId: id("Suite id, from suites_list.") },
  run_plan_start: {
    source: z
      .enum(["collection", "adhoc"])
      .describe("collection: every test in one. adhoc: these."),
    collectionId: optionalId("Required when source is collection."),
    testIds: z
      .array(z.string())
      .max(WORKBENCH_MCP_MAX_LIST_LIMIT)
      .optional()
      .describe("Required when source is adhoc."),
    scenarioIds: z
      .array(z.string())
      .max(WORKBENCH_MCP_MAX_LIST_LIMIT)
      .optional()
      .describe("Environments to run against."),
    repetitions: z
      .number()
      .int()
      .min(1)
      .max(SUITE_MAX_REPETITIONS)
      .optional()
      .describe("Times to repeat each pair."),
    maxConcurrency: z
      .number()
      .int()
      .min(1)
      .max(SUITE_MAX_CONCURRENCY)
      .optional()
      .describe("Member runs in parallel."),
    aggregateCostCapUsd: z
      .number()
      .positive()
      .optional()
      .describe("Soft USD ceiling for the plan."),
  },
} satisfies Record<WorkbenchMcpToolName, z.ZodRawShape>;

/** Build the report resource URI for one run. */
export function workbenchRunReportUri(runId: string, format: "markdown" | "json"): string {
  return `${WORKBENCH_MCP_RESOURCE_SCHEME}://reports/run/${runId}.${format === "json" ? "json" : "md"}`;
}

/** Build the report resource URI for one scan. */
export function workbenchScanReportUri(scanId: string, format: "markdown" | "json"): string {
  return `${WORKBENCH_MCP_RESOURCE_SCHEME}://reports/scan/${scanId}.${format === "json" ? "json" : "md"}`;
}

/** The four resource URI TEMPLATES the mount registers (the `resources/templates/list` surface). */
export const WORKBENCH_MCP_RESOURCE_TEMPLATES = {
  runMarkdown: `${WORKBENCH_MCP_RESOURCE_SCHEME}://reports/run/{runId}.md`,
  runJson: `${WORKBENCH_MCP_RESOURCE_SCHEME}://reports/run/{runId}.json`,
  scanMarkdown: `${WORKBENCH_MCP_RESOURCE_SCHEME}://reports/scan/{scanId}.md`,
  scanJson: `${WORKBENCH_MCP_RESOURCE_SCHEME}://reports/scan/{scanId}.json`,
} as const;

// ── Agent onboarding (WP M.4) ─────────────────────────────────────────────────────────────────────

/** The path the `llms.txt`-style usage doc is served on — a plain-text sibling of the mount itself. */
export const WORKBENCH_MCP_LLMS_TXT_PATH = `${WORKBENCH_MCP_MOUNT_PATH}/llms.txt`;

/**
 * One family of read tools: the heading the usage doc groups them under, and the one sentence that
 * says WHEN to reach for that family rather than another.
 */
export type WorkbenchMcpToolFamily = {
  label: string;
  /** "Reach for these when…" — written for an agent choosing between families, not for a changelog. */
  when: string;
  tools: readonly WorkbenchMcpToolName[];
};

/**
 * The families the served usage doc (`GET /api/mcp/llms.txt`) groups the surface into.
 *
 * They live here, beside the tool names themselves, because they are part of the SAME declaration: a
 * tool added to {@link WORKBENCH_MCP_TOOL_NAMES} without a family would silently drop out of the
 * document an external agent onboards from. `workbench-mcp.test.ts` asserts the families **partition**
 * the tool list exactly — every tool in exactly one family, no family naming a tool that does not
 * exist — so classifying a new tool is a build requirement, not a convention.
 */
export const WORKBENCH_MCP_TOOL_FAMILIES: readonly WorkbenchMcpToolFamily[] = [
  {
    label: "Servers & scans",
    when:
      "Reach for these to answer what a registered MCP server costs a model before a word is " +
      "generated — its tools, their per-tool token footprint, and how that surface fits inside " +
      "each model's limits.",
    tools: [
      "servers_list",
      "scans_list",
      "scans_get",
      "scans_latest",
      "scans_tools",
      "compatibility_heatmap",
      "compatibility_findings",
    ],
  },
  {
    label: "Runs & reports",
    when:
      "Reach for these to answer what actually happened in a test session — the step trace, the " +
      "token/cost totals, the quality grades, and the composed run report.",
    tools: ["runs_list", "runs_get", "runs_grades", "run_report"],
  },
  {
    label: "Skills",
    when:
      "Reach for these to inspect a registered Agent Skill — its versions, its file tree and " +
      "contents, its L1/L2/L3 token footprint, and its security surface (bundled scripts, network " +
      "references).",
    tools: [
      "skills_list",
      "skills_get",
      "skills_versions",
      "skills_files",
      "skills_file_content",
      "skills_security",
    ],
  },
  {
    label: "Suites & collections",
    when:
      "Reach for these to work at the batch level — the benchmark matrices, their mass-run results " +
      "with per-member grades, and the collections tests and suites are organised in.",
    tools: ["suites_list", "suite_runs_list", "suite_runs_get", "collections_list"],
  },
  {
    label: "Actions",
    when:
      "Reach for these to make the workbench DO something: run a discovery scan, start a saved " +
      "benchmark suite, or launch a collection/ad-hoc run plan. Each needs its own token scope on " +
      "top of `read`, and each returns a ticket to poll with `scans_get` or `suite_runs_get` " +
      "rather than waiting. Nothing here deletes anything.",
    tools: ["scan_run", "suite_run_start", "run_plan_start"],
  },
];
