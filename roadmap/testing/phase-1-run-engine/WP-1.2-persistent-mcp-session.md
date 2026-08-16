# WP 1.2 — Persistent MCP session

**Phase:** 1 · **Size:** M · **Depends on:** —

## Objective
Add a **persistent** MCP connection that stays open for a whole run, so the agent loop can issue many
`tools/call`s over one connection per server — instead of the current connect-once-per-call behavior.

## Why / references
`apps/api/src/mcp/client.ts` today: both `discoverTools()` and `callTool()` open a fresh `Client` +
transport and `close()` in `finally`. Correct for scans/playground, wrong for an agent loop (10+ tool
calls per run = 10+ process spawns / HTTP handshakes). See [`../references.md`](../references.md) →
*MCP TypeScript SDK*. Keep the existing functions intact (additive change).

## Files
- `apps/api/src/mcp/client.ts` *(modify — add a session abstraction; reuse `createTransport`)*

## Design — sketch
```ts
export type McpSession = {
  listTools(): Promise<unknown>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>; // resolves even on tool error
  close(): Promise<void>;
};

export async function openSession(
  config: InternalServerConfig,
  options: DiscoveryOptions = {}      // { authProvider } — same as discoverTools
): Promise<McpSession> {
  const client = new Client({ name: "mcp-token-footprint", version: "0.1.0" }, { capabilities: {} });
  const transport = createTransport(config, options);          // reuse the existing private helper
  await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
  return {
    listTools: () => withTimeout(client.listTools(), MCP_TIMEOUT_MS, "MCP tools/list"),
    callTool: (name, args) =>
      withTimeout(client.callTool({ name, arguments: args }), MCP_TIMEOUT_MS, "MCP tools/call"),
    close: () => client.close().catch(() => undefined),
  };
}
```
- A run opens **one session per allowed server** at start (a `Map<serverId, McpSession>`), reuses them
  for every tool call, and closes them all on completion/stop/error (the run-service owns lifecycle,
  WP 1.3).
- `createTransport` is already private in `client.ts` — export-internal or reuse in-module.
- The OAuth `authProvider` for streamable-HTTP servers is obtained the same way `ScanService` does via
  `OAuthService`; pass it through `options`.

## Implementation steps
1. Refactor so `createTransport` is reachable by `openSession` (same module — no API change needed).
2. Add `openSession` + `McpSession`. Leave `discoverTools`/`callTool` untouched.
3. Reuse `withTimeout` (`apps/api/src/utils/timeout.ts`) and `MCP_TIMEOUT_MS`.

## Acceptance
- A test opens a session against a stub/echo MCP server, issues **N sequential** `callTool`s on one
  connection, then `close()`s cleanly; no connection leak; timeouts honored.
- Existing scan/playground paths still pass their tests (no regression).

## Notes
- `callTool` **resolves** with `{ isError, content, … }` on a tool-level failure and **throws** only on
  transport/request failure (MCP SDK semantics) — the loop (WP 1.3) handles both.
