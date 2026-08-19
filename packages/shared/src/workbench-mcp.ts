import { z } from "zod";
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

/** Hard ceiling on any `limit` argument — a host asking for more gets a validation error, not a dump. */
export const WORKBENCH_MCP_MAX_LIST_LIMIT = 200;

/** Rows a list-shaped tool returns when the caller passes no `limit`. */
export const WORKBENCH_MCP_DEFAULT_LIST_LIMIT = 50;

/**
 * Token budget for the serialized `tools/list` payload — the definition footprint an external host
 * pays on EVERY conversation just to know this server exists (D-MCP5: we measure ourselves with our
 * own scanner).
 *
 * How this number was chosen: the 21-tool surface measures **2,149 tokens** under the app's default
 * `generic_o200k` profile (`apps/api/test/workbench-mcp-server.test.ts` prints the live figure on every
 * run, so the real cost is never a guess), and **2,167 tokens** when the app's own discovery scanner
 * is pointed at the running mount — the two agree to within 1%, which is the whole point of measuring
 * ourselves the way we measure everyone else. The budget is set at **3,000**: about 40% headroom,
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
 */
export const WORKBENCH_MCP_TOOL_SCHEMAS = {
  // ── Servers & scans ─────────────────────────────────────────────────────────────────────────
  servers_list: {},
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
  suites_list: {},
  suite_runs_list: {
    suiteId: z.string().optional(),
    status: z.enum(SUITE_RUN_STATUSES).optional(),
    limit: limitField,
  },
  suite_runs_get: { suiteRunId: idField, memberLimit: limitField },
  collections_list: {},
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
