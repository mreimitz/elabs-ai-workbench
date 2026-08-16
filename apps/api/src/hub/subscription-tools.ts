// Assistant Hub — the `claude_subscription` chat session's REAL MCP tool wiring
// (roadmap/model-identity/, WP3.2, locked decision **D-MI3**).
//
// ## Why this module exists
//
// model-identity WP2.1 made the Hub model resolver honor an explicit `providerCredentialId`, which
// made the `claude_subscription` branch in `hub/session-service.ts` REACHABLE for the first time.
// That exposed a second defect: `hub/subscription-adapter.ts` wired only the `ask_user` bridge into
// the Agent-SDK child and passed `tools: {}` to the prompt assembler, while `hubCapabilitiesForKind`
// reports `toolCalls: true`. A correctly-routed subscription chat session was therefore **tool-less
// while claiming tools**. The owner decided (D-MI3) to WIRE REAL TOOLS rather than degrade the
// capability.
//
// ## The approach — ported from the Testing path, not re-invented
//
// The Agent SDK connects/spawns MCP servers INSIDE its own child (D-CS9), so — unlike the AI-SDK hub
// turn engine, which builds one in-process AI-SDK tool per granted MCP tool and routes every
// `tools/call` itself (`hub/tools/*` over live `McpSession`s) — there is no per-tool bridge here.
// Instead the session's granted servers are translated into the SDK's `mcpServers` config map plus
// `mcp__<serverKey>__<toolName>` allow patterns. That translation is EXACTLY what the Testing feature
// already proved (`testing/subscription-tools.ts`'s `buildSubscriptionToolWiring`, driven by
// `testing/run-service.ts`'s `resolveSubscriptionTools`), so this module REUSES it verbatim; all it
// owns is the hub-shaped question "which servers/tools does THIS session grant?" and the prompt-facing
// listing text.
//
// The grant rule mirrors `index.ts`'s `resolveHubMcpGrants` (the AI-SDK path's own resolver) so both
// backends grant the same surface for the same session:
//   • a SCOPED session (`session.toolScope`) grants only its listed servers — each `"all"` or an
//     explicit tool-name allowlist;
//   • an AUTO session (`toolScope` null — the Claude-Desktop default) grants every registered server
//     that has a completed scan;
//   • a server with no scanned tools (never scanned / empty catalog) is skipped — nothing to grant;
//   • an explicit allowlist is INTERSECTED with the scanned catalog, so a since-removed tool never
//     gets an allow pattern (the AI-SDK path builds tools strictly from the catalog too).
// A server that contributes no tool is dropped entirely by `buildSubscriptionToolWiring` — the child
// never connects it, so its tools are unreachable.
//
// ## Secret boundary (`.claude/rules/mcp-and-security.md`) — non-negotiable
//
// The returned `mcpServers` map carries DECRYPTED stdio `env` and streamable-HTTP auth `headers`
// (including an OAuth server's current access token). That value has exactly ONE destination: the
// Agent-SDK child config (`driver.start({ mcpServers })`). It is never returned to the web, never
// persisted, never logged, and never placed in an error message. Everything this module exposes for
// logging/telemetry/prompting — `toolListText`, `servers[]` — carries NAMES ONLY, by construction.
//
// ## Degradation
//
// Resolving is best-effort, matching the hub's D-AS17 posture: one unusable server (a stdio row with
// no command, an unreadable config) is skipped with a name-only warning rather than failing the turn.
// A session that grants nothing resolves to `null`, and the adapter's driver options stay
// byte-identical to the pre-WP3.2 tool-less shape.

import type { HubServerToolGrant, HubSession } from "@mcp-token-footprint/shared";
import type { InternalServerConfig } from "../servers/repository.js";
import {
  buildSubscriptionToolWiring,
  type SubscriptionMcpServerConfig,
  type SubscriptionServerInput,
} from "../testing/subscription-tools.js";

/**
 * One granted server's PROMPT-FACING summary — names only, never config, never secrets. Also what a
 * caller may safely log.
 */
export type HubSubscriptionServerSummary = {
  serverId: string;
  serverName: string;
  /** The allow-listed tool names on this server (bare names, not `mcp__…` patterns). */
  toolNames: string[];
};

/**
 * The Agent-SDK tool wiring for ONE hub subscription chat session.
 *
 * `mcpServers` is SECRET-BEARING (decrypted stdio env / http auth headers) and goes into the child
 * config only. `allowedTools` / `toolListText` / `servers` are name-only and safe to log or inject
 * into a prompt.
 */
export type HubSubscriptionToolWiring = {
  mcpServers: Record<string, SubscriptionMcpServerConfig>;
  /** `mcp__<serverId>__<toolName>` for every granted tool — the SDK auto-allow set AND the
   *  default-deny `canUseTool` set the adapter builds over it. */
  allowedTools: string[];
  /** The LAYER-3 (`tools`) prompt injection: the granted surface, by fully-qualified tool name. */
  toolListText: string;
  /** Name-only per-server summary (telemetry/tests). */
  servers: HubSubscriptionServerSummary[];
};

/**
 * The adapter's DI seam: resolve a session's granted MCP surface, or `null` when it grants nothing.
 * Production wires {@link createHubSubscriptionMcpResolver} at the composition root (`index.ts`,
 * where the server/scan/OAuth stores live); tests inject a stub — no real MCP server is ever contacted
 * by this seam (the child, not the API, connects them).
 */
export type HubSubscriptionMcpResolver = (
  session: HubSession,
) => HubSubscriptionToolWiring | null | Promise<HubSubscriptionToolWiring | null>;

/** The narrow store seams {@link createHubSubscriptionMcpResolver} needs (all synchronous reads). */
export type HubSubscriptionMcpResolverDeps = {
  /** Every registered MCP server (id + display name) — `ServerRepository.list()` in production. */
  listServers: () => readonly { id: string; name: string }[];
  /** The DECRYPTED config for one server — `ServerRepository.getInternal(id)` in production. */
  getServerConfig: (serverId: string) => InternalServerConfig;
  /** The latest completed scan's tool NAMES for one server (empty ⇒ never scanned / no tools). */
  listScannedToolNames: (serverId: string) => readonly string[];
  /** The current OAuth access token for a streamable-HTTP server, when it has one. Placed into the
   *  child's `Authorization: Bearer …` header only — the same credential the scan path uses. */
  oauthAccessToken?: (config: InternalServerConfig) => string | undefined;
  /** Name-only warnings for a skipped server. NEVER receives a config or a secret. */
  logger?: { warn?: (message: string) => void };
};

/**
 * Build the production {@link HubSubscriptionMcpResolver}.
 *
 * Deliberately mirrors `index.ts`'s `resolveHubMcpGrants` scope rule (see the module header) with ONE
 * structural difference: it opens **no** `McpSession`. The Agent-SDK child owns the connections
 * (D-CS9), so probing them here would spawn a second copy of every stdio server for no benefit — and
 * would make an unreachable server silently vanish from the surface the child is about to connect
 * itself. Connection failures therefore degrade in the child (a driver error → an honest terminal),
 * exactly as they do for a Testing subscription run.
 */
export function createHubSubscriptionMcpResolver(
  deps: HubSubscriptionMcpResolverDeps,
): HubSubscriptionMcpResolver {
  return (session: HubSession): HubSubscriptionToolWiring | null => {
    const scope = session.toolScope ?? null;
    const mcpServers: Record<string, SubscriptionMcpServerConfig> = {};
    const allowedTools: string[] = [];
    const summaries: HubSubscriptionServerSummary[] = [];

    for (const summary of deps.listServers()) {
      const grant: HubServerToolGrant | undefined = scope ? scope.servers[summary.id] : "all";
      if (grant === undefined) continue; // scoped-out server (an auto session always yields "all")

      const scanned = deps.listScannedToolNames(summary.id);
      if (scanned.length === 0) continue; // never scanned / no tools → nothing to grant
      const toolNames = grant === "all" ? [...scanned] : intersect(scanned, grant);
      if (toolNames.length === 0) continue; // the allowlist named nothing this scan still exposes

      // A single unusable server must never break the turn (D-AS17 posture): skip it with a
      // NAME-ONLY warning. Shaping is done PER SERVER (one `buildSubscriptionToolWiring` call each,
      // then merged) precisely so its throw for a stdio row with no command / an http row with no
      // URL lands in THIS catch and costs only that one server.
      try {
        const config = deps.getServerConfig(summary.id);
        const headers =
          config.transport === "streamable_http" ? resolveHeaders(config, deps) : undefined;
        const input: SubscriptionServerInput = {
          key: summary.id,
          config,
          ...(headers ? { headers } : {}),
          toolNames,
        };
        const one = buildSubscriptionToolWiring([input]);
        Object.assign(mcpServers, one.mcpServers);
        allowedTools.push(...one.allowedTools);
        summaries.push({ serverId: summary.id, serverName: summary.name, toolNames });
      } catch (error) {
        // NAME-ONLY: never interpolate the config, the env, the headers or the URL.
        deps.logger?.warn?.(
          `hub subscription: MCP server "${summary.name}" could not be wired for this session ` +
            `(${error instanceof Error ? error.message : "unusable configuration"}); skipping it.`,
        );
      }
    }

    if (summaries.length === 0) return null;
    return {
      mcpServers,
      allowedTools,
      toolListText: formatHubSubscriptionToolList(summaries),
      servers: summaries,
    };
  };
}

/**
 * The LAYER-3 (`tools`) prompt injection for a subscription session.
 *
 * Two things it must get right:
 *   1. **Fully-qualified names.** The child sees `mcp__<serverId>__<toolName>`, so listing bare tool
 *      names would violate the layer's own rule 1 ("do NOT invent tool or server names").
 *   2. **An honest built-ins correction.** The shared tools layer opens with "Built-ins (always
 *      present): `tasks.*`, `artifacts.*`, `files.*`, `memory.propose_save`" — true on the AI-SDK
 *      path, FALSE here: those are in-process AI-SDK tools the Agent-SDK child cannot reach, and every
 *      SDK-native tool is on the disallow list. Silence would leave the model reaching for tools it
 *      does not have; one line of truth is cheaper than a wasted turn.
 */
export function formatHubSubscriptionToolList(
  servers: readonly HubSubscriptionServerSummary[],
): string {
  if (servers.length === 0) return "";
  const lines = servers.map(
    (s) =>
      `- **${s.serverName}** — ${s.toolNames.map((t) => `\`mcp__${s.serverId}__${t}\``).join(", ")}`,
  );
  return [
    ...lines,
    "",
    "Call these by their fully-qualified names exactly as written. They are the ONLY tools available " +
      "in this session — the built-ins listed above (`tasks.*`, `artifacts.*`, `files.*`, " +
      "`memory.propose_save`, `skills.load`) are NOT available here, so do not attempt them.",
  ].join("\n");
}

/**
 * Split the SDK's fully-qualified `mcp__<serverKey>__<toolName>` name back into its parts, or `null`
 * when it isn't one (an SDK-native tool, or the `ask_user` bridge). The server key is a nanoid server
 * id, which never contains `__`, so the FIRST `__` after the `mcp__` prefix is the separator — a tool
 * name containing `__` therefore round-trips intact.
 *
 * Used by the adapter to stamp `HubToolPart.serverId` on a persisted `tool_call`, so the console's
 * per-server chips work on a subscription session exactly as they do on the AI-SDK path.
 */
export function parseSubscriptionToolName(
  qualified: string,
): { serverId: string; toolName: string } | null {
  if (!qualified.startsWith("mcp__")) return null;
  const rest = qualified.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator <= 0) return null;
  const serverId = rest.slice(0, separator);
  const toolName = rest.slice(separator + 2);
  if (!toolName) return null;
  return { serverId, toolName };
}

/** `scanned ∩ allowlist`, preserving the SCAN's order and dropping duplicates. */
function intersect(scanned: readonly string[], allowed: readonly string[]): string[] {
  const wanted = new Set(allowed);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of scanned) {
    if (!wanted.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The auth headers for a streamable-HTTP MCP server the child will connect — the SAME resolution the
 * scan / AI-SDK / Testing-subscription paths use. Custom-header / bearer / api-key auth is already
 * decrypted into `config.headers` by the server repository; an OAuth server carries no static header,
 * so its CURRENT access token is folded in as `Authorization: Bearer …`. There is no interactive
 * refresh inside the child, so an expired/absent token degrades honestly (the child's connection
 * fails → a driver error → an honest terminal). Placed into the child's config only.
 */
function resolveHeaders(
  config: InternalServerConfig,
  deps: HubSubscriptionMcpResolverDeps,
): Record<string, string> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  const token = deps.oauthAccessToken?.(config);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
