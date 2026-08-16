// Assistant Hub (WP0.5, §1.6) — the MCP-bridge adapter. Reuses `testing/tool-bridge.ts`'s translation
// (`buildMcpTool`, additively extracted from `buildTools` for this reuse — see that file's doc) rather
// than re-deriving the AI-SDK `jsonSchema()`/`execute()` wiring. This module's own job is the part the
// Testing bridge deliberately doesn't do: CROSS-SERVER COLLISION NAMESPACING (§1.6: "Verify cross-
// server name collisions are namespaced" — `HubToolPart.serverId`'s doc: "cross-server names are
// namespaced"). Testing's `buildTools` is scoped to ONE scenario's allow-list, already server-scoped
// enough that collisions are rare and it deliberately keeps "last-writer-wins" semantics; the Hub
// grants MULTIPLE servers into ONE session, so a same-named tool on two granted servers is a real,
// expected case.
import type { HubToolAnnotations, NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import type { Tool } from "ai";
import type { McpSession } from "../../mcp/client.js";
import type { BuildToolsOptions, OnTransportError, StepSink } from "../../testing/tool-bridge.js";
import { buildMcpTool } from "../../testing/tool-bridge.js";

/** One MCP tool discoverable on a granted server (the input catalog `grants.ts` resolves against). */
export type HubMcpCatalogEntry = {
  serverId: string;
  serverName?: string;
  def: NormalizedToolDefinition;
};

/**
 * One MCP tool RESOLVED for exposure to the model: its `exposedName` (the key the model calls it by —
 * namespaced only when it collides with another granted server's tool of the same name) alongside the
 * `serverId`/`def` needed to actually route the call.
 */
export type HubResolvedMcpTool = {
  source: "mcp";
  exposedName: string;
  serverId: string;
  serverName?: string;
  def: NormalizedToolDefinition;
  /** Extracted, typed annotations (R-MCP3) — undefined when the definition declared none. */
  annotations?: HubToolAnnotations;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract the typed {@link HubToolAnnotations} (R-MCP3) a scanned MCP tool declared, if any.
 * `NormalizedToolDefinition.annotations` is `unknown` on the wire (it round-trips whatever the server
 * sent) — this reads it defensively, field by field, never trusting its shape.
 */
export function extractToolAnnotations(def: NormalizedToolDefinition): HubToolAnnotations | undefined {
  const raw = isRecord(def.annotations) ? def.annotations : undefined;
  if (!raw) return undefined;
  const annotations: HubToolAnnotations = {};
  if (typeof raw.readOnlyHint === "boolean") annotations.readOnlyHint = raw.readOnlyHint;
  if (typeof raw.destructiveHint === "boolean") annotations.destructiveHint = raw.destructiveHint;
  if (typeof raw.idempotentHint === "boolean") annotations.idempotentHint = raw.idempotentHint;
  if (typeof raw.openWorldHint === "boolean") annotations.openWorldHint = raw.openWorldHint;
  if (typeof raw.title === "string") annotations.title = raw.title;
  return annotations;
}

/** Slugify a server id/name into the `mcp__<handle>__` namespace segment (mirrors the app's existing
 *  `mcp__<serverKey>__<toolName>` convention used by the Testing subscription-tool wiring and the
 *  compatibility evaluators' `namespacePrefix` — kept local here rather than importing across
 *  features, since neither of those modules is on this WP's reuse allowlist). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function namespacedName(serverId: string, toolName: string): string {
  return `mcp__${slugify(serverId)}__${toolName}`;
}

/**
 * Resolve exposed names for a flat list of granted MCP tools (R-MCP1's output — already
 * grant-filtered by `grants.ts`'s `resolveMcpGrants`). A tool name unique across the granted set keeps
 * its plain name; a name shared by two-or-more DIFFERENT servers gets namespaced on EVERY entry that
 * shares it (never just the second one — so which server "wins" the bare name never depends on
 * iteration order).
 */
export function resolveMcpCatalog(entries: HubMcpCatalogEntry[]): HubResolvedMcpTool[] {
  const byName = new Map<string, HubMcpCatalogEntry[]>();
  for (const entry of entries) {
    const list = byName.get(entry.def.name) ?? [];
    list.push(entry);
    byName.set(entry.def.name, list);
  }

  const resolved: HubResolvedMcpTool[] = [];
  for (const [name, list] of byName) {
    const collides = list.length > 1;
    for (const entry of list) {
      resolved.push({
        source: "mcp",
        exposedName: collides ? namespacedName(entry.serverId, name) : name,
        serverId: entry.serverId,
        serverName: entry.serverName,
        def: entry.def,
        annotations: extractToolAnnotations(entry.def),
      });
    }
  }
  return resolved;
}

/**
 * Build one AI-SDK `Tool` per resolved MCP entry, keyed by its (possibly namespaced) `exposedName`.
 * Routing/telemetry inside each tool still uses the tool's TRUE `def.name` against the right
 * `McpSession` — `buildMcpTool` guarantees that (see its doc): the exposed key is purely an external
 * naming concern, invisible to the actual `tools/call`.
 */
export function buildHubMcpTools(
  resolved: HubResolvedMcpTool[],
  sessions: Map<string, McpSession>,
  sink: StepSink,
  onTransportError?: OnTransportError,
  options?: BuildToolsOptions,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const entry of resolved) {
    tools[entry.exposedName] = buildMcpTool(
      entry.serverId,
      entry.def,
      sessions,
      sink,
      onTransportError,
      options,
    );
  }
  return tools;
}
