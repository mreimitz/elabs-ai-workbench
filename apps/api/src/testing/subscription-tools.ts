// Claude subscription MCP-tool wiring (planning/Roadmap/RM-09-claude-subscription/, WP 1.3).
//
// The subscription run path (claude-subscription-executor.ts) drives the owner's signed-in Claude
// through the Agent SDK. Unlike the AI-SDK path — which builds ONE AI-SDK tool per allow-listed MCP
// tool and routes each `tools/call` itself (tool-bridge.ts) — the Agent SDK connects/spawns the MCP
// servers INSIDE its child (D-CS9). So instead of a per-tool bridge, we translate the scenario's
// allow-listed servers into the SDK's `mcpServers` config map, and translate the per-tool allow-list
// into the SDK's `mcp__<serverKey>__<toolName>` tool-name PATTERNS.
//
// The RISK this resolves (plan §6): the SDK gates by SERVER + tool-name pattern, not the per-tool
// construction the bridge uses. So a server that exposes 5 tools but whose scenario allow-list names
// only 2 would, if we merely handed the SDK the server, expose all 5. This module produces:
//   1. `mcpServers`  — one entry per allow-listed server (stdio command/args/env OR http url/headers),
//   2. `allowedTools` — the exact `mcp__<serverKey>__<toolName>` pattern for EVERY allow-listed tool,
// and the executor pairs (2) with a DEFAULT-DENY `canUseTool` gate so a tool NOT in that pattern set
// is genuinely uncallable (verified in tests) — the faithful mapping the plan demands.
//
// Secret boundary (.claude/rules/mcp-and-security.md): the decrypted stdio `env` / http auth `headers`
// are placed into the SDK's `mcpServers` config the API hands to the child. They are NEVER returned to
// the web or logged — this module only shapes them; the caller (run-service) resolves them.
import type { InternalServerConfig } from "../servers/repository.js";

/**
 * The subset of the Agent SDK's `McpServerConfig` union we build (verified against the installed
 * `@anthropic-ai/claude-agent-sdk@0.3.206` `sdk.d.ts`: `McpStdioServerConfig` = `{ type?: 'stdio';
 * command; args?; env? }`, `McpHttpServerConfig` = `{ type: 'http'; url; headers? }`). The `type`
 * discriminant is set explicitly so the child never has to infer transport. Typed loosely at the
 * driver seam (`Record<string, unknown>`); the real driver casts to `Options["mcpServers"]`.
 */
export type SubscriptionMcpServerConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

/** One allow-listed server to wire: its stable key, decrypted config, resolved http headers, tools. */
export type SubscriptionServerInput = {
  /** Stable key = the `mcpServers` map key AND the `mcp__<key>__<tool>` pattern segment (per run). */
  key: string;
  /** The decrypted server config (stdio command/args/env OR streamable-http url). */
  config: InternalServerConfig;
  /**
   * Resolved auth headers for a streamable-http server — the SAME resolution the scan/AI-SDK path uses
   * (custom headers / bearer / api-key already live in `config.headers`; an OAuth server's current
   * access token is folded in as `Authorization: Bearer …` by the caller). Ignored for stdio.
   */
  headers?: Record<string, string>;
  /** The allow-listed tool names on this server (from `ScenarioService.resolveAllowedTools`). */
  toolNames: readonly string[];
};

/** The Agent-SDK tool wiring for a subscription run. */
export type SubscriptionToolWiring = {
  /** `driver.start({ mcpServers })` — one entry per allow-listed server that contributes ≥1 tool. */
  mcpServers: Record<string, SubscriptionMcpServerConfig>;
  /**
   * `mcp__<serverKey>__<toolName>` for EVERY allow-listed tool. The executor passes these as the SDK's
   * auto-allow `allowedTools` AND builds a default-deny `canUseTool` over this exact set, so anything
   * outside it (a non-allow-listed tool on a partially-allow-listed server, or a disallowed built-in)
   * cannot run.
   */
  allowedTools: string[];
};

/** The fully-qualified SDK tool name for one MCP tool on a server (the SDK's `mcp__server__tool` form). */
export function toolPattern(serverKey: string, toolName: string): string {
  return `mcp__${serverKey}__${toolName}`;
}

/**
 * Translate the resolved allow-list into the Agent SDK's `mcpServers` config + allow-pattern set.
 *
 * A server contributing NO allow-listed tool is dropped entirely (never wired, never patterned) — the
 * child never connects it, so its tools are unreachable. For a wired server, only the NAMED tools get
 * an allow pattern; any other tool the server happens to expose is absent from the set → uncallable
 * (the executor's default-deny gate denies it).
 */
export function buildSubscriptionToolWiring(
  servers: readonly SubscriptionServerInput[],
): SubscriptionToolWiring {
  const mcpServers: Record<string, SubscriptionMcpServerConfig> = {};
  const allowedTools: string[] = [];
  for (const server of servers) {
    if (server.toolNames.length === 0) continue; // no allow-listed tool → don't connect the server
    mcpServers[server.key] = toSdkServerConfig(server);
    for (const toolName of server.toolNames) allowedTools.push(toolPattern(server.key, toolName));
  }
  return { mcpServers, allowedTools };
}

/** Map one decrypted server config onto the SDK's stdio/http MCP-server config entry. */
function toSdkServerConfig(server: SubscriptionServerInput): SubscriptionMcpServerConfig {
  const { config } = server;
  if (config.transport === "stdio") {
    if (!config.command) {
      throw new Error(`Stdio MCP server "${config.name}" is missing its command`);
    }
    const entry: SubscriptionMcpServerConfig = { type: "stdio", command: config.command };
    if (config.args && config.args.length > 0) entry.args = [...config.args];
    if (config.env && Object.keys(config.env).length > 0) entry.env = { ...config.env };
    return entry;
  }
  if (!config.url) {
    throw new Error(`Streamable HTTP MCP server "${config.name}" is missing its URL`);
  }
  const entry: SubscriptionMcpServerConfig = { type: "http", url: config.url };
  const headers = server.headers ?? config.headers;
  if (headers && Object.keys(headers).length > 0) entry.headers = { ...headers };
  return entry;
}
