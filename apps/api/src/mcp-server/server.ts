import {
  WORKBENCH_MCP_SERVER_NAME,
  WORKBENCH_MCP_SERVER_VERSION,
} from "@mcp-token-footprint/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkbenchResources } from "./resources.js";
import { buildWorkbenchToolDefinitions, type WorkbenchMcpDeps } from "./tools.js";

/**
 * Build a fresh `McpServer` carrying the workbench's read tools + report resources.
 *
 * A NEW instance is built per request (the mount is stateless — see `routes.ts`), which is cheap: the
 * tool definitions are closures over repository handles that already exist for the HTTP routes, and
 * nothing here opens a connection or touches the filesystem.
 *
 * `instructions` is the one place a host is told what this server is for; it is deliberately two
 * sentences, because it is paid for on every `initialize` (D-MCP5).
 */
export function createWorkbenchMcpServer(deps: WorkbenchMcpDeps): McpServer {
  const server = new McpServer(
    { name: WORKBENCH_MCP_SERVER_NAME, version: WORKBENCH_MCP_SERVER_VERSION },
    {
      instructions:
        "Read-only access to this MCP Token Footprint workbench: registered MCP servers and their " +
        "discovery scans, per-tool token footprints, model-compatibility findings, test runs and " +
        "their grades and reports, Agent Skills with their footprint and security surface, and " +
        "benchmark suites and collections. Nothing here starts a scan, launches a run, or changes " +
        "configuration.",
    },
  );

  for (const definition of buildWorkbenchToolDefinitions(deps)) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.inputSchema },
      // The SDK validates `args` against `inputSchema` before this runs, so a malformed call never
      // reaches the handler; the handler's own `safeTool` turns a bad-but-well-typed id (an unknown
      // run/scan/skill) into a readable `isError` result instead of a stack trace.
      (args: unknown) => definition.handler((args ?? {}) as Record<string, unknown>),
    );
  }

  registerWorkbenchResources(server, deps);
  return server;
}
