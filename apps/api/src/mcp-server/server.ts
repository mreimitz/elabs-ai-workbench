import {
  WORKBENCH_MCP_SERVER_NAME,
  WORKBENCH_MCP_SERVER_VERSION,
  WORKBENCH_MCP_TOOL_SCOPES,
  type ApiTokenScope,
} from "@mcp-token-footprint/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerWorkbenchResources } from "./resources.js";
import {
  buildWorkbenchToolDefinitions,
  type WorkbenchMcpDeps,
  type WorkbenchMcpToolDefinition,
} from "./tools.js";

// ==================================================================================================
// Workbench MCP server — the per-request server, and the per-tool SCOPE GATE (WP M.2)
// ==================================================================================================
// The mount is stateless (a fresh `McpServer` per POST — see `routes.ts`), so the caller's authority
// is a PARAMETER here rather than state anywhere. That is the whole trick that makes per-tool scopes
// cheap: there is no session to attach an identity to and no identity to invalidate.
//
// **D-MCP7 — a tokenless loopback caller keeps FULL access, including tools a token would need a
// scope for.** That is the posture the rest of this API already has: `curl` on the host can
// `POST /api/runs` today with no credential, and the mount does not get a stricter rule than the API
// it is mounted on. Scope enforcement therefore applies ONLY to a request that authenticated with a
// token (`grantedScopes !== null`). The one switch that changes this is the existing
// `API_AUTH_REQUIRED=true`, which forces token auth on loopback for the whole API, mount included —
// there is deliberately no second, mount-only knob (an off-switch beside an auth check is the
// foot-gun WP 1.1 called out; two overlapping auth knobs is that foot-gun twice).

/** Who is calling, and what they are allowed to do — built per request by `routes.ts`. */
export type WorkbenchMcpCaller = {
  /**
   * The scopes the calling token holds, or **`null` for a trusted tokenless loopback call** (D-MCP7),
   * which means every tool is allowed. `null` is not "no scopes" — it is "no token was involved".
   */
  grantedScopes: readonly ApiTokenScope[] | null;
  /** `mcpfp_ab12cd34` — the DISPLAY prefix, for the audit line. `null` when there is no token. */
  tokenPrefix: string | null;
  /** One audit line per tool call. Injected so a test can capture it without a logger. */
  audit: (entry: { tool: string; ok: boolean; durationMs: number; refusedScope?: string }) => void;
};

/** A caller with no token and no audit sink — the shape a non-HTTP embedding (the self-scan) uses. */
export const TRUSTED_LOCAL_CALLER: WorkbenchMcpCaller = {
  grantedScopes: null,
  tokenPrefix: null,
  audit: () => undefined,
};

/**
 * Test seam (WP M.2 acceptance A8). Production calls `createWorkbenchMcpServer(deps, caller)` with
 * nothing here, so the registered surface is exactly `buildWorkbenchToolDefinitions` +
 * `WORKBENCH_MCP_TOOL_SCOPES`. It exists because the scope gate has to be provable NOW, and WP M.3's
 * write tools — the only tools that will ever need a scope other than `read` — do not exist yet.
 * It is unreachable from HTTP: `registerWorkbenchMcpRoutes` never forwards a request-derived value
 * into it, and an injected tool with no scope entry is refused like any other unmapped tool.
 */
export type WorkbenchMcpServerOverrides = {
  tools?: readonly WorkbenchMcpToolDefinition[];
  toolScopes?: Readonly<Record<string, ApiTokenScope>>;
};

/**
 * May `caller` invoke `toolName`? `null` when it may; otherwise the scope it is missing.
 *
 * **Fails closed twice over.** A tool that is absent from the scope map is refused rather than
 * allowed — the key-set test in `apps/api/test/mcp-server-scopes.test.ts` is what normally catches an
 * undeclared tool, and this is the belt behind that brace, so a tool that somehow shipped without a
 * declaration cannot be reached by a token instead of being loudly broken.
 */
export function missingScopeForTool(
  toolName: string,
  caller: WorkbenchMcpCaller,
  toolScopes: Readonly<Record<string, ApiTokenScope>> = WORKBENCH_MCP_TOOL_SCOPES,
): string | null {
  // D-MCP7: no token was involved at all — this is the open local path, unchanged by this WP.
  if (caller.grantedScopes === null) return null;
  const required = toolScopes[toolName];
  if (required === undefined) return `${toolName} (undeclared)`;
  return caller.grantedScopes.includes(required) ? null : required;
}

/**
 * The refusal an agent actually reads. It is a normal `isError` **result**, not a transport error and
 * not a thrown exception, because an `isError` result is what an MCP host shows the model — which is
 * the only way an agent learns what to ask its operator for.
 */
function scopeRefusal(toolName: string, missing: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          `This tool needs the \`${missing}\` scope. The token you connected with does not have it — ` +
          "create one in Settings › API tokens (a token also needs `read` to reach this server at " +
          `all). Tool: ${toolName}.`,
      },
    ],
  };
}

/**
 * Wrap one tool definition's handler with the scope gate + the audit line. One place, so every tool
 * — the 21 read tools today, WP M.3's write tools tomorrow — is gated identically and emits exactly
 * one audit entry per call whether it was allowed, refused, or failed.
 */
export function withScopeEnforcement(
  definition: WorkbenchMcpToolDefinition,
  caller: WorkbenchMcpCaller,
  toolScopes?: Readonly<Record<string, ApiTokenScope>>,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args) => {
    const startedAt = Date.now();
    const missing = missingScopeForTool(definition.name, caller, toolScopes);
    if (missing !== null) {
      caller.audit({
        tool: definition.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        refusedScope: missing,
      });
      return scopeRefusal(definition.name, missing);
    }
    // `safeTool` inside the definition already turns a bad id into a readable `isError` result, so a
    // handler rejection here is genuinely exceptional — audit it, then let it propagate unchanged.
    try {
      const result = await definition.handler(args);
      caller.audit({
        tool: definition.name,
        ok: result.isError !== true,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      caller.audit({ tool: definition.name, ok: false, durationMs: Date.now() - startedAt });
      throw error;
    }
  };
}

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
export function createWorkbenchMcpServer(
  deps: WorkbenchMcpDeps,
  caller: WorkbenchMcpCaller = TRUSTED_LOCAL_CALLER,
  overrides?: WorkbenchMcpServerOverrides,
): McpServer {
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

  const definitions = overrides?.tools ?? buildWorkbenchToolDefinitions(deps);
  for (const definition of definitions) {
    const guarded = withScopeEnforcement(definition, caller, overrides?.toolScopes);
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.inputSchema },
      // The SDK validates `args` against `inputSchema` before this runs, so a malformed call never
      // reaches the handler; the handler's own `safeTool` turns a bad-but-well-typed id (an unknown
      // run/scan/skill) into a readable `isError` result instead of a stack trace.
      (args: unknown) => guarded((args ?? {}) as Record<string, unknown>),
    );
  }

  // Resources need no per-resource scope in this WP, and that is a decision rather than an omission:
  // D-MCP8 means every token-authenticated caller that reached the mount at all already holds `read`,
  // and every registered resource is a read of a report this app has already produced. A write
  // resource would change that — there are none, and D-MCP3 keeps it that way.
  registerWorkbenchResources(server, deps);
  return server;
}
