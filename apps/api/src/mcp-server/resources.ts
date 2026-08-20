import {
  WORKBENCH_MCP_RESOURCE_TEMPLATES,
  workbenchRunReportUri,
  workbenchScanReportUri,
} from "@mcp-token-footprint/shared";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { createJsonReport, createMarkdownReport } from "../reports/reports.js";
import { buildRunJsonReport, buildRunMarkdownReport } from "../reports/run-report-assembly.js";
import type { WorkbenchMcpDeps } from "./tools.js";

// ==================================================================================================
// Workbench MCP server — report RESOURCES (planning/Roadmap/RM-08-ci/mcp-server.md, WP M.1)
// ==================================================================================================
// The big documents — a run report, a scan report — are exposed as MCP **resources** rather than
// (only) tools so a host can pull one on demand without paying for it inside a tool result. Each is a
// URI template with a `list` callback, so `resources/list` shows the actual runs and scans this
// install holds rather than an opaque pattern.
//
// The document bodies come from the SAME builders the HTTP export routes use — `createJsonReport` /
// `createMarkdownReport` for scans, and `run-report-assembly.ts` for runs (D-MCP4). Nothing is
// re-derived here.

/** How many entries `resources/list` enumerates per template (newest first). */
const RESOURCE_LIST_LIMIT = 50;

function textResource(uri: URL, mimeType: string, text: string): ReadResourceResult {
  return { contents: [{ uri: uri.href, mimeType, text }] };
}

/** Register the four report resource templates on `server`. */
export function registerWorkbenchResources(server: McpServer, deps: WorkbenchMcpDeps): void {
  const listRuns = (format: "markdown" | "json") => () => ({
    resources: deps.runs
      .listRuns({})
      .slice(0, RESOURCE_LIST_LIMIT)
      .map((run) => ({
        uri: workbenchRunReportUri(run.id, format),
        name: `Run ${run.id} report`,
        description: `${run.status} run started ${run.startedAt}`,
        mimeType: format === "json" ? "application/json" : "text/markdown",
      })),
  });

  const listScans = (format: "markdown" | "json") => () => ({
    resources: deps.scans
      .listSummaries()
      .slice(0, RESOURCE_LIST_LIMIT)
      .map((scan) => ({
        uri: workbenchScanReportUri(scan.id, format),
        name: `Scan ${scan.id} report`,
        description: `${scan.status} scan of server ${scan.serverId} at ${scan.scannedAt}`,
        mimeType: format === "json" ? "application/json" : "text/markdown",
      })),
  });

  server.registerResource(
    "run-report-markdown",
    new ResourceTemplate(WORKBENCH_MCP_RESOURCE_TEMPLATES.runMarkdown, {
      list: listRuns("markdown"),
    }),
    {
      title: "Run report (Markdown)",
      description: "One test run's full report — rating, config, statistics, step breakdown.",
      mimeType: "text/markdown",
    },
    (uri, variables) =>
      textResource(
        uri,
        "text/markdown",
        buildRunMarkdownReport(deps.runReports, String(variables.runId)),
      ),
  );

  server.registerResource(
    "run-report-json",
    new ResourceTemplate(WORKBENCH_MCP_RESOURCE_TEMPLATES.runJson, { list: listRuns("json") }),
    {
      title: "Run report (JSON)",
      description: "The same run report as a machine-readable document.",
      mimeType: "application/json",
    },
    (uri, variables) =>
      textResource(
        uri,
        "application/json",
        JSON.stringify(buildRunJsonReport(deps.runReports, String(variables.runId)), null, 2),
      ),
  );

  server.registerResource(
    "scan-report-markdown",
    new ResourceTemplate(WORKBENCH_MCP_RESOURCE_TEMPLATES.scanMarkdown, {
      list: listScans("markdown"),
    }),
    {
      title: "Scan report (Markdown)",
      description: "One discovery scan's token-footprint report, every tool listed.",
      mimeType: "text/markdown",
    },
    (uri, variables) =>
      textResource(
        uri,
        "text/markdown",
        createMarkdownReport(deps.scans.getDetail(String(variables.scanId))),
      ),
  );

  server.registerResource(
    "scan-report-json",
    new ResourceTemplate(WORKBENCH_MCP_RESOURCE_TEMPLATES.scanJson, { list: listScans("json") }),
    {
      title: "Scan report (JSON)",
      description: "The same scan report as a machine-readable document.",
      mimeType: "application/json",
    },
    (uri, variables) =>
      textResource(
        uri,
        "application/json",
        JSON.stringify(createJsonReport(deps.scans.getDetail(String(variables.scanId))), null, 2),
      ),
  );
}
