import type { ServerConfig } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub (roadmap/assistant-hub/, WP4.4 — R-MCP13) — the bundled RESEARCH-SERVER RECIPE: a
 * curated list of well-known search/fetch MCP servers offered as ready-to-fill config templates in
 * the "Add MCP server" wizard (`ServerWizard.tsx`). Each preset only prefills the CONNECTION shape
 * (transport/command/args) and the env variable NAME the server expects — never a value. The owner
 * still pastes their own key through the wizard's existing encrypted env-variable field; there is
 * **no bundled vendor key and no built-in search engine** (D-AH10 stands — research power comes
 * entirely from MCP servers the owner registers).
 *
 * These are all published stdio MCP server packages launched via `npx` — the same "Local command"
 * transport every other stdio server in this app uses, so no new transport/auth surface is needed.
 * See `user-guide/16-assistant-hub.md`'s "Set up a research server" section for the walkthrough.
 */
export type ResearchServerPreset = {
  id: string;
  /** Short label shown on the preset's picker button. */
  label: string;
  /** One-line description of what the server searches/fetches. */
  description: string;
  /** Prefilled server name (the owner can still rename it). */
  name: string;
  command: string;
  args: string[];
  /** Env variable NAME(s) the server expects — prefilled with an EMPTY value (never a real key). */
  envKeys: string[];
  /** Where to get an API key / read the package's own docs. */
  docsUrl: string;
};

export const RESEARCH_SERVER_PRESETS: readonly ResearchServerPreset[] = [
  {
    id: "tavily",
    label: "Tavily",
    description: "Web search + page extraction, purpose-built for LLM agents.",
    name: "Tavily Search",
    command: "npx",
    args: ["-y", "tavily-mcp"],
    envKeys: ["TAVILY_API_KEY"],
    docsUrl: "https://github.com/tavily-ai/tavily-mcp",
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web + local search over the Brave Search API.",
    name: "Brave Search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: ["BRAVE_API_KEY"],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    id: "exa",
    label: "Exa",
    description: "Neural search and page content, tuned for research agents.",
    name: "Exa Search",
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    envKeys: ["EXA_API_KEY"],
    docsUrl: "https://github.com/exa-labs/exa-mcp-server",
  },
] as const;

/** Loose keyword match against a preset name/id — also used to flag a server the owner registered
 *  by hand (not through a preset) as "research-capable" for the Assistant's research-mode empty
 *  state (see `hasResearchCapableServer`). Intentionally simple and explainable: a name/tool-surface
 *  heuristic, never a live capability probe (this app never inspects tool semantics automatically). */
const RESEARCH_KEYWORDS = ["search", "tavily", "brave", "exa", "fetch", "web", "browse", "crawl"];

function looksResearchCapable(name: string): boolean {
  const lower = name.toLowerCase();
  return RESEARCH_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * R-MCP13's "research mode empty state" signal: does at least one REGISTERED server look
 * research-capable by name? (Hub sessions grant every registered, reachable, scanned server at
 * once in v1 — `apps/api/src/index.ts#resolveHubMcpGrants` — so "granted" and "registered" are the
 * same set today; this stays a client-side heuristic over the servers list, not a tool-schema probe.)
 */
export function hasResearchCapableServer(servers: readonly Pick<ServerConfig, "name">[]): boolean {
  return servers.some((server) => looksResearchCapable(server.name));
}

/**
 * hub-fixes WP5.2 (RC5, D-HF2) — the "does this read as wanting the web" signal for the mission
 * plan-card's inline notice (`MissionPlanCard.tsx`): the SAME simple keyword heuristic
 * `looksResearchCapable` already applies to a server's NAME, run instead over an agent's/plan's own
 * PROSE (brief, target, expected outcome, rationale). Still intentionally simple/explainable — never
 * a semantic model — and used only to decide whether to surface the "no research server registered"
 * notice, never to gate anything the model can actually call. `undefined`/empty entries are skipped
 * (every caller passes optional fields straight through).
 */
export function missionTextWantsWebCapability(...texts: readonly (string | undefined)[]): boolean {
  return texts.some((text) => text !== undefined && looksResearchCapable(text));
}
