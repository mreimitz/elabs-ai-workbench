import { z } from "zod";
import type { ApiTokenScope } from "./api-tokens.js";
import { RUN_STATUSES, SUITE_RUN_STATUSES } from "./constants.js";

// ==================================================================================================
// Workbench MCP server — the shared contract for the app's OWN MCP surface (roadmap/ci/mcp-server.md)
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
// **D-MCP3 — this surface is READ-ONLY.** Nothing here starts a scan, launches a run, mutates config,
// or deletes anything. Write tools arrive in WP M.3, behind explicit service-token scopes, and deletes
// never do. A tool name added to `WORKBENCH_MCP_READ_TOOL_NAMES` that the server does not register
// (or vice versa) fails `pnpm test` — the list is a gate, not documentation.

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
 * ourselves the way we measure everyone else. The budget is set at **3,000**: about 35% headroom,
 * enough for the WP M.3 write tools and a few longer descriptions without ceremony, tight enough that
 * a careless paragraph trips the gate instead of quietly costing every host a thousand tokens a turn.
 * WP M.4 turns this same assertion into a CI job that scans the running mount with our own scanner.
 */
export const WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET = 3000;

// ── Tool argument shapes (ZodRawShape — see the banner) ───────────────────────────────────────────

const idField = z.string().min(1);
const limitField = z.number().int().positive().max(WORKBENCH_MCP_MAX_LIST_LIMIT).optional();

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
  servers_list: { limit: limitField },
  scans_list: { serverId: z.string().optional(), limit: limitField },
  scans_get: { scanId: idField },
  scans_latest: { serverId: idField },
  scans_tools: {
    scanId: idField,
    limit: limitField,
    offset: z.number().int().nonnegative().optional(),
  },
  compatibility_heatmap: {
    scanId: idField,
    models: z.array(z.string()).max(20).optional(),
    view: z.enum(["server", "tool"]).optional(),
    rollup: z.enum(["worst-tool", "average-tool"]).optional(),
  },
  compatibility_findings: { scanId: idField, models: z.array(z.string()).max(20).optional() },

  // ── Runs & reports ──────────────────────────────────────────────────────────────────────────
  runs_list: {
    testId: z.string().optional(),
    scenarioId: z.string().optional(),
    status: z.enum(RUN_STATUSES).optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    limit: limitField,
  },
  runs_get: { runId: idField, stepLimit: limitField },
  runs_grades: { runId: idField },
  run_report: { runId: idField, format: z.enum(["markdown", "json"]).optional() },

  // ── Skills ──────────────────────────────────────────────────────────────────────────────────
  skills_list: { limit: limitField },
  skills_get: { skillId: idField },
  skills_versions: { skillId: idField },
  skills_files: { versionId: idField },
  skills_file_content: { versionId: idField, path: idField },
  skills_security: { versionId: idField },

  // ── Suites, collections ─────────────────────────────────────────────────────────────────────
  suites_list: { limit: limitField },
  suite_runs_list: {
    suiteId: z.string().optional(),
    status: z.enum(SUITE_RUN_STATUSES).optional(),
    limit: limitField,
  },
  suite_runs_get: { suiteRunId: idField, memberLimit: limitField },
  collections_list: { limit: limitField },
} satisfies Record<WorkbenchMcpReadToolName, z.ZodRawShape>;

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
  tools: readonly WorkbenchMcpReadToolName[];
};

/**
 * The families the served usage doc (`GET /api/mcp/llms.txt`) groups the surface into.
 *
 * They live here, beside the tool names themselves, because they are part of the SAME declaration: a
 * tool added to {@link WORKBENCH_MCP_READ_TOOL_NAMES} without a family would silently drop out of the
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
];
