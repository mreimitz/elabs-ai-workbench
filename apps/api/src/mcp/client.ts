import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { InternalServerConfig } from "../servers/repository.js";
import { withTimeout } from "../utils/timeout.js";

export type DiscoveryEvent = (
  level: "info" | "warning" | "error",
  message: string,
) => void | Promise<void>;

/**
 * Assistant Hub (WP2.3, R-MCP4) — the elicitation-response an `openSession` caller supplies to handle a
 * server's `elicitation/create` (form or URL mode). It receives the raw request params and returns an
 * MCP `ElicitResult` (`accept` with flat-primitive `content`, or `decline`/`cancel`). Purely additive:
 * callers that don't pass one (every existing caller — the Testing bridge, playground, discovery) get
 * the old behavior (no elicitation capability advertised, no handler registered).
 */
export type McpElicitationHandler = (params: unknown) => Promise<{
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}>;

export type DiscoveryResult = {
  tools: unknown[];
  rawToolsList: unknown;
  resources: unknown[];
  rawResourcesList: unknown;
  resourceTemplates: unknown[];
  rawResourceTemplatesList: unknown;
  prompts: unknown[];
  rawPromptsList: unknown;
};

export type DiscoveryOptions = {
  authProvider?: OAuthClientProvider;
  /** WP2.3 (R-MCP4) — when set (persistent hub sessions only), the client advertises the `elicitation`
   *  capability (form + URL) and routes each `elicitation/create` here. Ignored by the one-shot helpers. */
  elicitationHandler?: McpElicitationHandler;
};

const MCP_TIMEOUT_MS = 30_000;

export async function discoverTools(
  config: InternalServerConfig,
  onEvent: DiscoveryEvent,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const client = new Client(
    {
      name: "mcp-token-footprint",
      version: "0.1.0",
    },
    {
      capabilities: {},
    },
  );
  const transport = createTransport(config, options);

  try {
    await onEvent("info", "Initializing MCP client");
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
    await onEvent("info", "MCP initialize completed");

    const rawToolsList = await withTimeout(client.listTools(), MCP_TIMEOUT_MS, "MCP tools/list");
    const tools = readTools(rawToolsList);
    await onEvent("info", `MCP tools/list returned ${tools.length} tools`);

    // Resources, resource templates, and prompts ride the SAME connection, capability-gated.
    // A server that doesn't advertise the capability is treated as empty (no call, no error); a
    // server that advertises but errors on the call degrades to [] with a warning so tools still scan.
    const caps = client.getServerCapabilities();

    const resourcesResult = caps?.resources
      ? await listResourcesSafe(client, onEvent)
      : { list: undefined, items: [] };
    const rawResourcesList = resourcesResult.list;
    const resources = resourcesResult.items;
    await onEvent("info", `MCP resources/list returned ${resources.length} resources`);

    const templatesResult = caps?.resources
      ? await listResourceTemplatesSafe(client, onEvent)
      : { list: undefined, items: [] };
    const rawResourceTemplatesList = templatesResult.list;
    const resourceTemplates = templatesResult.items;
    await onEvent(
      "info",
      `MCP resources/templates/list returned ${resourceTemplates.length} resource templates`,
    );

    const promptsResult = caps?.prompts
      ? await listPromptsSafe(client, onEvent)
      : { list: undefined, items: [] };
    const rawPromptsList = promptsResult.list;
    const prompts = promptsResult.items;
    await onEvent("info", `MCP prompts/list returned ${prompts.length} prompts`);

    return {
      tools,
      rawToolsList,
      resources,
      rawResourcesList,
      resourceTemplates,
      rawResourceTemplatesList,
      prompts,
      rawPromptsList,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Capability-gated `resources/list` over the open connection. The capability check happens in the
 * caller; here we defend against a server that advertises `resources` but errors on the call — the
 * whole scan must not fail because of it, so it degrades to an empty list with a warning.
 */
async function listResourcesSafe(
  client: Client,
  onEvent: DiscoveryEvent,
): Promise<{ list: unknown; items: unknown[] }> {
  try {
    const list = await withTimeout(client.listResources(), MCP_TIMEOUT_MS, "MCP resources/list");
    return { list, items: readResources(list) };
  } catch (error) {
    await onEvent("warning", `MCP resources/list failed: ${errorText(error)}`);
    return { list: undefined, items: [] };
  }
}

async function listResourceTemplatesSafe(
  client: Client,
  onEvent: DiscoveryEvent,
): Promise<{ list: unknown; items: unknown[] }> {
  try {
    const list = await withTimeout(
      client.listResourceTemplates(),
      MCP_TIMEOUT_MS,
      "MCP resources/templates/list",
    );
    return { list, items: readResourceTemplates(list) };
  } catch (error) {
    await onEvent("warning", `MCP resources/templates/list failed: ${errorText(error)}`);
    return { list: undefined, items: [] };
  }
}

async function listPromptsSafe(
  client: Client,
  onEvent: DiscoveryEvent,
): Promise<{ list: unknown; items: unknown[] }> {
  try {
    const list = await withTimeout(client.listPrompts(), MCP_TIMEOUT_MS, "MCP prompts/list");
    return { list, items: readPrompts(list) };
  } catch (error) {
    await onEvent("warning", `MCP prompts/list failed: ${errorText(error)}`);
    return { list: undefined, items: [] };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createTransport(config: InternalServerConfig, options: DiscoveryOptions) {
  if (config.transport === "stdio") {
    if (!config.command) {
      throw new Error("Stdio server command is required");
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: {
        ...getDefaultEnvironment(),
        ...(config.env ?? {}),
      },
    });
  }

  if (!config.url) {
    throw new Error("Streamable HTTP server URL is required");
  }

  return new StreamableHTTPClientTransport(new URL(config.url), {
    authProvider: options.authProvider,
    requestInit: {
      headers: config.headers ?? {},
    },
  });
}

function readTools(value: unknown): unknown[] {
  if (value && typeof value === "object" && Array.isArray((value as { tools?: unknown[] }).tools)) {
    return (value as { tools: unknown[] }).tools;
  }

  return [];
}

function readResources(value: unknown): unknown[] {
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { resources?: unknown[] }).resources)
  ) {
    return (value as { resources: unknown[] }).resources;
  }

  return [];
}

function readResourceTemplates(value: unknown): unknown[] {
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { resourceTemplates?: unknown[] }).resourceTemplates)
  ) {
    return (value as { resourceTemplates: unknown[] }).resourceTemplates;
  }

  return [];
}

function readPrompts(value: unknown): unknown[] {
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { prompts?: unknown[] }).prompts)
  ) {
    return (value as { prompts: unknown[] }).prompts;
  }

  return [];
}

export async function callTool(
  config: InternalServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  options: DiscoveryOptions = {},
): Promise<unknown> {
  const client = new Client(
    { name: "mcp-token-footprint", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = createTransport(config, options);

  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
    return await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      MCP_TIMEOUT_MS,
      "MCP tools/call",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Lightweight connectivity preflight: open the MCP connection (the `initialize` handshake) and
 * immediately close — NO `tools/list`. For a streamable-HTTP server with an OAuth `authProvider`,
 * connecting exercises the SDK's silent token refresh, so a still-refreshable token passes here;
 * only a token that truly needs interactive reauth surfaces a 401 (→ `isAuthRequiredError`). Used by
 * the reauth gate's throttled preflight so we don't pay a full discovery to answer "can I use this?".
 */
export async function checkConnection(
  config: InternalServerConfig,
  options: DiscoveryOptions = {},
): Promise<void> {
  const client = new Client(
    { name: "mcp-token-footprint", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = createTransport(config, options);

  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function readResource(
  config: InternalServerConfig,
  uri: string,
  options: DiscoveryOptions = {},
): Promise<unknown> {
  const client = new Client(
    { name: "mcp-token-footprint", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = createTransport(config, options);

  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
    return await withTimeout(client.readResource({ uri }), MCP_TIMEOUT_MS, "MCP resources/read");
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function getPrompt(
  config: InternalServerConfig,
  name: string,
  args: Record<string, string>,
  options: DiscoveryOptions = {},
): Promise<unknown> {
  const client = new Client(
    { name: "mcp-token-footprint", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = createTransport(config, options);

  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
    return await withTimeout(
      client.getPrompt({ name, arguments: args }),
      MCP_TIMEOUT_MS,
      "MCP prompts/get",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * A persistent MCP connection kept open for the lifetime of a run, so the agent loop can issue
 * many `tools/call`s over a single connection per server instead of reconnecting per call.
 *
 * Unlike {@link discoverTools} / {@link callTool} (which connect-once-per-call and close in a
 * `finally`), a session opens one {@link Client} + transport, exposes them for reuse, and only
 * tears the connection down when {@link McpSession.close} is invoked.
 */
export type McpSession = {
  /** `tools/list` over the persistent connection. */
  listTools(): Promise<unknown>;
  /**
   * `tools/call` over the persistent connection. Resolves with the tool result even on a
   * tool-level failure (`{ isError: true, content, … }`, per MCP SDK semantics); throws only on
   * transport/request failure (including timeouts). The caller (run loop) handles both.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Closes the underlying connection. Never throws. */
  close(): Promise<void>;
};

/**
 * Opens a persistent MCP session. The OAuth `authProvider` for streamable-HTTP servers is passed
 * through `options` exactly as {@link discoverTools} does (obtained by the caller via OAuthService).
 */
export async function openSession(
  config: InternalServerConfig,
  options: DiscoveryOptions = {},
): Promise<McpSession> {
  // WP2.3 (R-MCP4): a hub session opts into elicitation by supplying a handler — the client then
  // advertises the `elicitation` capability (form + URL) and routes every `elicitation/create` there.
  // Every other caller passes no handler → capabilities stay `{}` (unchanged behavior).
  const client = new Client(
    { name: "mcp-token-footprint", version: "0.1.0" },
    { capabilities: options.elicitationHandler ? { elicitation: { form: {}, url: {} } } : {} },
  );
  if (options.elicitationHandler) {
    const handler = options.elicitationHandler;
    // Tool output / server requests are UNTRUSTED (`.claude/rules/mcp-and-security.md`): the hub-side
    // handler is what refuses credential-shaped fields + surfaces the request to the operator — this
    // just forwards the raw params and passes the operator's `ElicitResult` straight back.
    client.setRequestHandler(ElicitRequestSchema, (request) => handler(request.params));
  }
  const transport = createTransport(config, options);

  // H-11 — the persistent-session path RETURNS the live client (it does not close in a `finally` like
  // the one-shot helpers), so a failed/hung `connect` would otherwise leak the spawned stdio child (or
  // the open HTTP connection): `connect()` spawns the child, and `withTimeout` rejects on hang WITHOUT
  // cancelling the underlying operation. Close the client ONLY on the connect failure, then rethrow —
  // the session itself owns (and later closes) the client on success, so we must not double-close.
  try {
    await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }

  return {
    listTools: () => withTimeout(client.listTools(), MCP_TIMEOUT_MS, "MCP tools/list"),
    callTool: (name, args) =>
      withTimeout(client.callTool({ name, arguments: args }), MCP_TIMEOUT_MS, "MCP tools/call"),
    close: () => client.close().catch(() => undefined),
  };
}
