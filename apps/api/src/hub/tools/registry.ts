// Assistant Hub (WP0.5, §1.6) — the top-level tool-registry resolution: "one registry, three sources"
// composed into what a session's turn actually sees. Ties together grants (grants.ts), MCP namespacing
// (mcp-bridge.ts), the deferred/auto loading heuristic (loading.ts), and the built-in catalog
// (builtins/index.ts). Also produces the `toolListText` the prompting layer (WP0.3,
// `hub/prompting/layers/tools.ts`) injects verbatim — "compiled by the tool registry (WP0.5)".
import type { HubToolGrants, ToolLoadingMode } from "@mcp-token-footprint/shared";
import type { TokenCounter } from "../../token-counting/types.js";
import { ALL_BUILTINS } from "./builtins/index.js";
import { resolveBuiltinGrants, resolveMcpGrants, type HubMcpServerCatalog } from "./grants.js";
import { resolveMcpCatalog, type HubResolvedMcpTool } from "./mcp-bridge.js";
import {
  isAlwaysLoaded,
  resolveToolLoading,
  type HubAlwaysLoadPins,
  type HubToolLoadingPreference,
  type ToolLoadingResolution,
} from "./loading.js";
import { createToolSearchBuiltin } from "./tool-search.js";
import type { HubBuiltinTool } from "./types.js";

export type HubToolRegistryInput = {
  grants: HubToolGrants;
  /** Every granted MCP server's full discoverable tool catalog (from its latest scan) — this module
   *  has no scan/DB access itself. */
  mcpCatalog: ReadonlyMap<string, HubMcpServerCatalog>;
  loadingPreference: HubToolLoadingPreference;
  tokenCounter: TokenCounter;
  contextWindow: number;
  autoFraction: number;
  /** WP1.1 (D-HF1) — absolute token cap on the `auto`-resolves-eager threshold
   *  (`HUB_TOOL_EAGER_MAX_TOKENS`). Forwarded to `resolveToolLoading`; absent ⇒ pure fraction heuristic. */
  eagerMaxTokens?: number;
  /** WP1.1 (D-HF1) — per-`tool_search` promotion token cap (`HUB_TOOL_PROMOTE_MAX_TOKENS`). Bounds how
   *  much of the deferred catalog a single search can make resident-callable. */
  promoteMaxTokens?: number;
  alwaysLoad?: HubAlwaysLoadPins;
  /** Defaults to {@link ALL_BUILTINS} — a caller resolving a restricted role passes a narrower list. */
  availableBuiltins?: readonly HubBuiltinTool[];
};

export type HubToolRegistryResolution = {
  builtins: HubBuiltinTool[];
  /** Fully-defined MCP tools resident in the model's context right now (all of `mcp` in eager mode;
   *  only the alwaysLoad-pinned subset in deferred mode). */
  mcpResident: HubResolvedMcpTool[];
  /** Granted MCP tools whose NAMES/SERVERS are known but whose full definitions are NOT resident —
   *  discoverable via `toolSearch`. Always `[]` in eager mode. */
  mcpDeferred: HubResolvedMcpTool[];
  /** Present iff `mcpDeferred.length > 0` — the per-turn `tool_search` built-in over exactly that set. */
  toolSearch?: HubBuiltinTool;
  /** WP1.1 (D-HF1) — the exposed names of every deferred tool (i.e. `mcpDeferred`). The turn engine
   *  gates these OFF each step (via `prepareStep`/`activeTools`) until they appear in `promoted`. Empty
   *  in eager mode (nothing is deferred). */
  deferredNames: Set<string>;
  /** WP1.1 (D-HF1) — the per-turn mutable promotion set the `toolSearch` built-in adds to and the turn
   *  engine reads: a promoted deferred tool becomes active for the SAME turn's next step. Starts empty. */
  promoted: Set<string>;
  loading: ToolLoadingResolution;
  toolListText: string;
};

export async function resolveHubToolRegistry(
  input: HubToolRegistryInput,
): Promise<HubToolRegistryResolution> {
  const builtins = resolveBuiltinGrants(input.grants, input.availableBuiltins ?? ALL_BUILTINS);
  const grantedEntries = resolveMcpGrants(input.grants, input.mcpCatalog);
  const mcp = resolveMcpCatalog(grantedEntries);

  const loading = await resolveToolLoading(
    input.loadingPreference,
    mcp.map((tool) => ({ serverId: tool.serverId, def: tool.def })),
    {
      tokenCounter: input.tokenCounter,
      contextWindow: input.contextWindow,
      autoFraction: input.autoFraction,
      ...(input.eagerMaxTokens !== undefined ? { eagerMaxTokens: input.eagerMaxTokens } : {}),
      alwaysLoad: input.alwaysLoad,
    },
  );

  const isPinned = (tool: HubResolvedMcpTool) =>
    isAlwaysLoaded(input.alwaysLoad, tool.serverId, tool.def.name);
  const mcpResident = loading.mode === "eager" ? mcp : mcp.filter(isPinned);
  const mcpDeferred = loading.mode === "eager" ? [] : mcp.filter((tool) => !isPinned(tool));

  // WP1.1 (D-HF1) — the per-turn promotion set the `tool_search` built-in adds to and the turn engine
  // reads via `prepareStep`. `deferredNames` is the gate list: every deferred tool is inactive each step
  // until it appears in `promoted`.
  const promoted = new Set<string>();
  const deferredNames = new Set(mcpDeferred.map((tool) => tool.exposedName));
  const toolSearch =
    mcpDeferred.length > 0
      ? createToolSearchBuiltin(mcpDeferred, {
          promoted,
          tokenCounter: input.tokenCounter,
          ...(input.promoteMaxTokens !== undefined ? { maxTokens: input.promoteMaxTokens } : {}),
        })
      : undefined;

  const toolListText = formatToolListText(mcp, loading.mode);

  return { builtins, mcpResident, mcpDeferred, toolSearch, deferredNames, promoted, loading, toolListText };
}

/** WP1.4 (D-HF-tools-budget) — how many sample tool names a deferred-mode server summary line quotes. */
const DEFERRED_SAMPLE_SIZE = 3;

/**
 * The `HubPromptToolsInjection.toolListText` body (§1.8 LAYER 3), grouped per server.
 *
 * **Eager mode** — unchanged: one line per TOOL, full name + description (the model already has the
 * full definition resident, so a human-readable recap costs little extra).
 *
 * **Deferred mode** (WP1.4) — one line per SERVER, not per tool: `<serverName>: <N> tools
 * (searchable) — e.g. <up to 3 sample names>`. With WP1.1 promotion, the model never needs the bare
 * name list up front — `tool_search` finds tools by task description — so spelling out all N names
 * here was pure token cost (RC1/analysis.md: 6,000 tokens against a 400-token section budget on a
 * real 5-server catalog). A per-server summary keeps the section honest (server names + counts + a
 * taste of what's there) at a small, budgetable size regardless of catalog width.
 */
export function formatToolListText(granted: readonly HubResolvedMcpTool[], mode: ToolLoadingMode): string {
  if (granted.length === 0) return "";

  const byServer = new Map<string, HubResolvedMcpTool[]>();
  for (const tool of granted) {
    const list = byServer.get(tool.serverId) ?? [];
    list.push(tool);
    byServer.set(tool.serverId, list);
  }

  const lines: string[] = [];
  for (const [serverId, tools] of byServer) {
    const label = tools[0]?.serverName ?? serverId;
    if (mode === "eager") {
      const items = tools
        .map((t) => `\`${t.exposedName}\` — ${t.def.description ?? "no description"}`)
        .join("; ");
      lines.push(`**${label}**: ${items}`);
    } else {
      const sample = tools
        .slice(0, DEFERRED_SAMPLE_SIZE)
        .map((t) => `\`${t.exposedName}\``)
        .join(", ");
      lines.push(`**${label}**: ${tools.length} tools (searchable) — e.g. ${sample}`);
    }
  }
  return lines.join("\n");
}
