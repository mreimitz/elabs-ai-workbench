// Assistant Hub (WP0.5, §1.6, R-MCP2) — the `tool_search` built-in: how a deferred-mode session
// DISCOVERS a granted MCP tool definition that isn't currently resident in its context. This is a
// PROVIDER-AGNOSTIC, in-app mechanism — distinct from `providers/registry.ts`'s
// `deferredToolSearchTool()`/`supportsToolSearch()`, which lean on Anthropic's own native deferred-
// loading (non-Haiku models only). The Hub must work across `anthropic`/`openai`/`google`/
// `openai_compatible`/`ollama` (WP1.1's turn engine), so it needs its own tool that works everywhere.
//
// Scope note (WP0.5): this module's job WAS pure DISCOVERY (return matching definitions as data,
// deterministically and offline — a small case-insensitive name/description match, no new dependency).
// WP1.1 (D-HF1, RC1) closes the loop: a discovered tool is now PROMOTED into a per-turn `promoted` set
// the turn engine reads in `prepareStep` to activate it for the SAME turn's next step. Promotion is
// token-capped (`HUB_TOOL_PROMOTE_MAX_TOKENS`) so one search can never resident-load a huge slice of the
// deferred catalog; over-cap matches are still returned as data with a "narrow your query" note.
import { z } from "zod";
import type { TokenCounter } from "../../token-counting/types.js";
import type { HubResolvedMcpTool } from "./mcp-bridge.js";
import type { HubBuiltinTool } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Fallback promotion token cap when the registry doesn't thread one in (tests). Mirrors the
 *  `HUB_TOOL_PROMOTE_MAX_TOKENS` env default. */
export const DEFAULT_PROMOTE_MAX_TOKENS = 20_000;

/** Per-turn promotion machinery threaded into `createToolSearchBuiltin` (D-HF1). `promoted` is the SAME
 *  mutable set the turn engine's `prepareStep` reads to activate a discovered tool; `tokenCounter` prices
 *  each match's definition so the cumulative promotion stays under `maxTokens`. */
export type ToolSearchPromotion = {
  promoted: Set<string>;
  tokenCounter: TokenCounter;
  maxTokens?: number;
};

const searchInput = z
  .object({
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(MAX_LIMIT).optional(),
  })
  .strict();

export type ToolSearchMatch = {
  name: string;
  serverId: string;
  description?: string;
  inputSchema?: unknown;
};

/** Pure search over a deferred catalog — the function `createToolSearchBuiltin` wraps as a tool. Case-
 *  insensitive substring match against the exposed name and description; capped at `limit` results
 *  (definition order preserved for stable output). */
export function searchDeferredTools(
  catalog: readonly HubResolvedMcpTool[],
  query: string,
  limit = DEFAULT_LIMIT,
): ToolSearchMatch[] {
  const needle = query.toLowerCase();
  const matches: ToolSearchMatch[] = [];
  for (const entry of catalog) {
    const haystack = `${entry.exposedName} ${entry.def.description ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    matches.push({
      name: entry.exposedName,
      serverId: entry.serverId,
      description: entry.def.description,
      inputSchema: entry.def.inputSchema,
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

/**
 * Build the `tool_search` built-in over ONE turn's deferred catalog (the granted MCP tools NOT
 * currently resident — `registry.ts`'s `mcpDeferred`). A fresh instance per turn/session since the
 * catalog is session-specific; there is no static export (unlike the other built-ins) for that reason.
 *
 * WP1.1 (D-HF1): when `promotion` is threaded in, each match is PROMOTED (added to the shared per-turn
 * `promoted` set the turn engine's `prepareStep` reads) as long as the CUMULATIVE promoted-definition
 * token cost stays within `promotion.maxTokens`. Matches are promoted greedily in discovery order; the
 * first match that would push the running total over the cap — and every match after it — is returned
 * as data only (never promoted) with a "narrow your query" note. Because promotion draws EXCLUSIVELY
 * from `deferredCatalog` (the granted-but-deferred set), an ungranted tool can never be promoted.
 */
export function createToolSearchBuiltin(
  deferredCatalog: readonly HubResolvedMcpTool[],
  promotion?: ToolSearchPromotion,
): HubBuiltinTool {
  return {
    name: "tool_search",
    source: "builtin",
    description:
      "Search the granted MCP tool catalog by task description to discover a tool definition not currently resident in your context (deferred loading mode). A match becomes callable on your next step. Search BEFORE claiming a capability is missing.",
    inputSchema: searchInput,
    annotations: { readOnlyHint: true },
    async execute(input) {
      const { query, limit } = searchInput.parse(input);
      const matches = searchDeferredTools(deferredCatalog, query, limit ?? DEFAULT_LIMIT);

      if (!promotion) {
        return { modelContent: { matches, totalDeferred: deferredCatalog.length } };
      }

      const cap = promotion.maxTokens ?? DEFAULT_PROMOTE_MAX_TOKENS;
      const byExposedName = new Map(deferredCatalog.map((t) => [t.exposedName, t]));
      const promotedNow: string[] = [];
      const overCap: string[] = [];
      let running = 0;
      let capped = false;
      for (const match of matches) {
        const entry = byExposedName.get(match.name);
        if (!entry) continue; // defensive — `matches` always derive from `deferredCatalog`.
        if (capped) {
          overCap.push(match.name);
          continue;
        }
        const { totalTokens } = await promotion.tokenCounter.countToolDefinition(entry.def);
        if (running + totalTokens > cap) {
          // This match (and everything after it) exceeds the per-search promotion budget.
          capped = true;
          overCap.push(match.name);
          continue;
        }
        running += totalTokens;
        promotion.promoted.add(match.name);
        promotedNow.push(match.name);
      }

      return {
        modelContent: {
          matches,
          totalDeferred: deferredCatalog.length,
          promoted: promotedNow,
          ...(overCap.length > 0
            ? {
                note: `Promoted ${promotedNow.length} tool(s) into your active set (now callable on your next step). ${overCap.length} match(es) exceeded the per-search token budget and were NOT loaded — narrow your query to promote them: ${overCap.join(", ")}.`,
              }
            : {}),
        },
      };
    },
  };
}
