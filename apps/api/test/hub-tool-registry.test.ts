// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.5, §1.6) — grants resolution (R-MCP1), the MCP-bridge
// collision-namespacing adapter, the deferred/auto tool-loading heuristic with MEASURED tokens
// (R-MCP2), and the composed registry.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubToolGrants, NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { ALL_BUILTIN_NAMES } from "../src/hub/tools/builtins/index.js";
import { resolveBuiltinGrants, resolveMcpGrants, type HubMcpServerCatalog } from "../src/hub/tools/grants.js";
import {
  extractToolAnnotations,
  resolveMcpCatalog,
  type HubMcpCatalogEntry,
} from "../src/hub/tools/mcp-bridge.js";
import { isAlwaysLoaded, resolveToolLoading } from "../src/hub/tools/loading.js";
import { createToolSearchBuiltin, searchDeferredTools } from "../src/hub/tools/tool-search.js";
import { formatToolListText, resolveHubToolRegistry } from "../src/hub/tools/registry.js";
import { readHubToolLoadingPreference } from "../src/config/env.js";
import { HUB_PROMPT_SECTION_BUDGETS } from "../src/hub/prompting/budgets.js";
import { toolsLayer } from "../src/hub/prompting/layers/tools.js";

function tool(name: string, description = "", schema: unknown = { type: "object" }): NormalizedToolDefinition {
  return { name, description, inputSchema: schema, raw: { name, description } };
}

// ── Grants (R-MCP1: ungranted absent from context entirely) ────────────────────────────────────

test("resolveMcpGrants: a server absent from grants.servers contributes NO tools", () => {
  const grants: HubToolGrants = { servers: {}, builtins: [] };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-a", { tools: [tool("search")] }],
  ]);
  assert.deepEqual(resolveMcpGrants(grants, catalog), []);
});

test("resolveMcpGrants: an explicit tool allowlist excludes ungranted tools on a granted server", () => {
  const grants: HubToolGrants = { servers: { "srv-a": ["search"] }, builtins: [] };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-a", { tools: [tool("search"), tool("delete_everything")] }],
  ]);
  const entries = resolveMcpGrants(grants, catalog);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.def.name, "search");
});

test("resolveMcpGrants: 'all' grants the server's full catalog", () => {
  const grants: HubToolGrants = { servers: { "srv-a": "all" }, builtins: [] };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["srv-a", { tools: [tool("search"), tool("fetch")] }],
  ]);
  assert.equal(resolveMcpGrants(grants, catalog).length, 2);
});

test("resolveMcpGrants: a granted server id absent from the catalog map yields nothing (never throws)", () => {
  const grants: HubToolGrants = { servers: { "deleted-server": "all" }, builtins: [] };
  assert.deepEqual(resolveMcpGrants(grants, new Map()), []);
});

test("resolveBuiltinGrants: empty grants.builtins grants NOTHING (absent-means-none, symmetric with servers)", () => {
  const grants: HubToolGrants = { servers: {}, builtins: [] };
  assert.deepEqual(resolveBuiltinGrants(grants), []);
});

test("resolveBuiltinGrants: an explicit name list grants exactly those built-ins", () => {
  const grants: HubToolGrants = { servers: {}, builtins: ["files.read", "tasks.list"] };
  const resolved = resolveBuiltinGrants(grants).map((t) => t.name).sort();
  assert.deepEqual(resolved, ["files.read", "tasks.list"]);
});

test("resolveBuiltinGrants: every ALL_BUILTIN_NAMES entry is grantable by name", () => {
  const grants: HubToolGrants = { servers: {}, builtins: ALL_BUILTIN_NAMES };
  assert.equal(resolveBuiltinGrants(grants).length, ALL_BUILTIN_NAMES.length);
});

// ── MCP-bridge collision-namespacing (§1.6: "verify cross-server name collisions are namespaced") ─

test("collision-namespacing: two stub servers exposing the SAME tool name both get namespaced, distinctly", () => {
  const entries: HubMcpCatalogEntry[] = [
    { serverId: "server-alpha", def: tool("search", "Search alpha") },
    { serverId: "server-beta", def: tool("search", "Search beta") },
  ];
  const resolved = resolveMcpCatalog(entries);
  assert.equal(resolved.length, 2);
  const names = resolved.map((r) => r.exposedName);
  assert.equal(new Set(names).size, 2, "exposed names must be distinct");
  assert.ok(names.every((n) => n !== "search"), "a colliding name is never left bare");
  assert.ok(names.some((n) => n.includes("server_alpha") || n.includes("server-alpha".replace(/-/g, "_"))));
  const bySource = new Map(resolved.map((r) => [r.serverId, r.exposedName]));
  assert.notEqual(bySource.get("server-alpha"), bySource.get("server-beta"));
});

test("no collision: a unique tool name across granted servers keeps its bare name", () => {
  const entries: HubMcpCatalogEntry[] = [
    { serverId: "server-alpha", def: tool("search") },
    { serverId: "server-beta", def: tool("fetch") },
  ];
  const resolved = resolveMcpCatalog(entries);
  const names = resolved.map((r) => r.exposedName).sort();
  assert.deepEqual(names, ["fetch", "search"]);
});

test("a THIRD server joining a two-way collision is also namespaced (not just the second)", () => {
  const entries: HubMcpCatalogEntry[] = [
    { serverId: "one", def: tool("search") },
    { serverId: "two", def: tool("search") },
    { serverId: "three", def: tool("search") },
  ];
  const resolved = resolveMcpCatalog(entries);
  const names = new Set(resolved.map((r) => r.exposedName));
  assert.equal(names.size, 3);
});

test("extractToolAnnotations reads readOnlyHint/destructiveHint/etc. defensively; absent/malformed → undefined", () => {
  const withAnnotations = tool("safe_read");
  (withAnnotations as { annotations?: unknown }).annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Safe Read",
  };
  assert.deepEqual(extractToolAnnotations(withAnnotations), {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Safe Read",
  });
  assert.equal(extractToolAnnotations(tool("no_annotations")), undefined);

  const malformed = tool("weird");
  (malformed as { annotations?: unknown }).annotations = "not an object";
  assert.equal(extractToolAnnotations(malformed), undefined);
});

// ── Deferred loading + auto heuristic with MEASURED tokens (R-MCP2) ────────────────────────────

test("eager mode: residentTokens equals totalTokens (everything is resident)", async () => {
  const counter = getTokenCounter("generic_o200k");
  const granted = [
    { serverId: "srv", def: tool("alpha", "Does alpha things", { type: "object", properties: { x: { type: "string" } } }) },
    { serverId: "srv", def: tool("beta", "Does beta things") },
  ];
  const resolution = await resolveToolLoading("eager", granted, {
    tokenCounter: counter,
    contextWindow: 200_000,
    autoFraction: 0.1,
  });
  assert.equal(resolution.mode, "eager");
  assert.equal(resolution.residentTokens, resolution.totalTokens);
  assert.equal(resolution.savingsPercent, 0);
  assert.ok(resolution.totalTokens > 0, "measured tokens must be a real positive number");
});

test("deferred mode: residentTokens is 0 with no alwaysLoad pins, producing real measured savings", async () => {
  const counter = getTokenCounter("generic_o200k");
  const granted = [
    { serverId: "srv", def: tool("alpha", "Does alpha things") },
    { serverId: "srv", def: tool("beta", "Does beta things") },
  ];
  const resolution = await resolveToolLoading("deferred", granted, {
    tokenCounter: counter,
    contextWindow: 200_000,
    autoFraction: 0.1,
  });
  assert.equal(resolution.mode, "deferred");
  assert.equal(resolution.residentTokens, 0);
  assert.equal(resolution.savingsPercent, 100);
});

test("deferred mode: an alwaysLoad pin keeps exactly that tool's tokens resident", async () => {
  const counter = getTokenCounter("generic_o200k");
  const granted = [
    { serverId: "srv", def: tool("alpha", "Does alpha things") },
    { serverId: "srv", def: tool("beta", "Does beta things") },
  ];
  const resolution = await resolveToolLoading("deferred", granted, {
    tokenCounter: counter,
    contextWindow: 200_000,
    autoFraction: 0.1,
    alwaysLoad: { srv: ["alpha"] },
  });
  assert.ok(resolution.residentTokens > 0);
  assert.ok(resolution.residentTokens < resolution.totalTokens);
});

test("isAlwaysLoaded: 'all' pins the whole server; an explicit list pins only named tools; absent pins nothing", () => {
  assert.equal(isAlwaysLoaded({ srv: "all" }, "srv", "anything"), true);
  assert.equal(isAlwaysLoaded({ srv: ["alpha"] }, "srv", "alpha"), true);
  assert.equal(isAlwaysLoaded({ srv: ["alpha"] }, "srv", "beta"), false);
  assert.equal(isAlwaysLoaded(undefined, "srv", "alpha"), false);
  assert.equal(isAlwaysLoaded({}, "srv", "alpha"), false);
});

test("auto heuristic: a small granted catalog under the fraction threshold resolves to eager (MEASURED)", async () => {
  const counter = getTokenCounter("generic_o200k");
  const granted = [{ serverId: "srv", def: tool("one_tool", "A single small tool.") }];
  const resolution = await resolveToolLoading("auto", granted, {
    tokenCounter: counter,
    contextWindow: 200_000,
    autoFraction: 0.1,
  });
  assert.equal(resolution.mode, "eager");
});

test("auto heuristic: a granted catalog whose MEASURED tokens exceed the fraction resolves to deferred", async () => {
  const counter = getTokenCounter("generic_o200k");
  // A big, verbose description pushes this single tool's measured definition tokens over a tiny
  // context window's threshold, forcing the auto heuristic to deferred.
  const granted = [{ serverId: "srv", def: tool("verbose_tool", "x ".repeat(2000)) }];
  const resolution = await resolveToolLoading("auto", granted, {
    tokenCounter: counter,
    contextWindow: 1000,
    autoFraction: 0.1,
  });
  assert.equal(resolution.mode, "deferred");
  assert.ok(resolution.totalTokens > 100, `expected a real measured token count, got ${resolution.totalTokens}`);
});

// ── tool_search (discovery over the deferred catalog) ───────────────────────────────────────────

test("searchDeferredTools matches by name and description, case-insensitively, capped at limit", () => {
  const catalog = resolveMcpCatalog([
    { serverId: "srv", def: tool("search_web", "Search the public web for pages.") },
    { serverId: "srv", def: tool("fetch_url", "Fetch a specific URL's contents.") },
    { serverId: "srv", def: tool("send_email", "Send an email.") },
  ]);
  const byName = searchDeferredTools(catalog, "SEARCH");
  assert.equal(byName.length, 1);
  assert.equal(byName[0]?.name, "search_web");

  const byDescription = searchDeferredTools(catalog, "url");
  assert.equal(byDescription.length, 1);
  assert.equal(byDescription[0]?.name, "fetch_url");

  const capped = searchDeferredTools(catalog, "e", 1);
  assert.equal(capped.length, 1);
});

// ── Composed registry ────────────────────────────────────────────────────────────────────────────

test("resolveHubToolRegistry composes grants + namespacing + loading + tool_search end-to-end", async () => {
  const grants: HubToolGrants = {
    servers: { alpha: "all", beta: ["search"] },
    builtins: ["files.read", "tasks.list"],
  };
  const mcpCatalog = new Map<string, HubMcpServerCatalog>([
    ["alpha", { serverName: "Alpha", tools: [tool("search", "Alpha search"), tool("write", "Alpha write")] }],
    ["beta", { serverName: "Beta", tools: [tool("search", "Beta search"), tool("delete", "never granted")] }],
  ]);

  const resolution = await resolveHubToolRegistry({
    grants,
    mcpCatalog,
    loadingPreference: "deferred",
    tokenCounter: getTokenCounter("generic_o200k"),
    contextWindow: 200_000,
    autoFraction: 0.1,
    alwaysLoad: { alpha: ["write"] },
  });

  assert.deepEqual(resolution.builtins.map((t) => t.name).sort(), ["files.read", "tasks.list"]);

  // "search" collides across alpha/beta → both namespaced; "write" is unique → bare; "delete" never
  // granted at all (beta's allowlist is ["search"] only) → absent entirely (R-MCP1).
  const allExposed = [...resolution.mcpResident, ...resolution.mcpDeferred].map((t) => t.exposedName);
  assert.ok(!allExposed.includes("search"), "colliding name must not appear bare");
  assert.ok(allExposed.includes("write"));
  assert.ok(!allExposed.some((n) => n.includes("delete")));
  assert.equal(allExposed.length, 3); // alpha.search, beta.search, alpha.write

  // alwaysLoad pinned alpha.write → resident even in deferred mode; the two "search" entries are deferred.
  assert.equal(resolution.mcpResident.length, 1);
  assert.equal(resolution.mcpResident[0]?.def.name, "write");
  assert.equal(resolution.mcpDeferred.length, 2);
  assert.ok(resolution.toolSearch, "tool_search must be present when something is deferred");

  const searchResult = await resolution.toolSearch?.execute({ query: "search" }, {} as never);
  const matches = (searchResult?.modelContent as { matches: unknown[] }).matches;
  assert.equal(matches.length, 2);

  assert.ok(resolution.toolListText.length > 0);
});

test("resolveHubToolRegistry: eager mode has no deferred catalog and no tool_search", async () => {
  const grants: HubToolGrants = { servers: { alpha: "all" }, builtins: [] };
  const mcpCatalog = new Map<string, HubMcpServerCatalog>([
    ["alpha", { tools: [tool("search")] }],
  ]);
  const resolution = await resolveHubToolRegistry({
    grants,
    mcpCatalog,
    loadingPreference: "eager",
    tokenCounter: getTokenCounter("generic_o200k"),
    contextWindow: 200_000,
    autoFraction: 0.1,
  });
  assert.equal(resolution.mcpDeferred.length, 0);
  assert.equal(resolution.toolSearch, undefined);
  assert.equal(resolution.mcpResident.length, 1);
});

// ── WP1.1 (hub-fixes, D-HF1) — auto absolute cap + default flip + deferred promotion ──────────────

test("readHubToolLoadingPreference (WP1.1 / D-HF1): the code default flips deferred → auto", () => {
  assert.equal(readHubToolLoadingPreference(undefined), "auto", "unset defaults to auto");
  assert.equal(readHubToolLoadingPreference(""), "auto", "blank defaults to auto");
  assert.equal(readHubToolLoadingPreference("nonsense"), "auto", "an unrecognized value falls back to auto");
  assert.equal(readHubToolLoadingPreference("eager"), "eager");
  assert.equal(readHubToolLoadingPreference("deferred"), "deferred");
  assert.equal(readHubToolLoadingPreference("auto"), "auto");
});

test("auto heuristic (WP1.1): the absolute eagerMaxTokens cap forces deferred where the fraction alone would allow eager", async () => {
  const counter = getTokenCounter("generic_o200k");
  // A few-hundred-token catalog: well under a 1M window * 0.1 fraction (100k), but OVER a tiny cap.
  const granted = [{ serverId: "srv", def: tool("verbose", "x ".repeat(400)) }];
  const withoutCap = await resolveToolLoading("auto", granted, {
    tokenCounter: counter,
    contextWindow: 1_000_000,
    autoFraction: 0.1,
  });
  assert.equal(withoutCap.mode, "eager", "fraction-only: the huge window loads eager");
  const withCap = await resolveToolLoading("auto", granted, {
    tokenCounter: counter,
    contextWindow: 1_000_000,
    autoFraction: 0.1,
    eagerMaxTokens: 50,
  });
  assert.equal(withCap.mode, "deferred", "the absolute cap forces deferred regardless of the window");
});

test("auto heuristic (WP1.1): a small catalog under BOTH thresholds still resolves eager", async () => {
  const counter = getTokenCounter("generic_o200k");
  const granted = [{ serverId: "srv", def: tool("tiny", "one small tool") }];
  const resolution = await resolveToolLoading("auto", granted, {
    tokenCounter: counter,
    contextWindow: 200_000,
    autoFraction: 0.1,
    eagerMaxTokens: 40_000,
  });
  assert.equal(resolution.mode, "eager");
});

test("resolveHubToolRegistry (WP1.1): deferred mode exposes deferredNames + an empty promoted set; tool_search promotes into it", async () => {
  const grants: HubToolGrants = { servers: { alpha: "all" }, builtins: [] };
  const mcpCatalog = new Map<string, HubMcpServerCatalog>([
    ["alpha", { serverName: "Alpha", tools: [tool("search_web", "Search the web"), tool("fetch_url", "Fetch a URL")] }],
  ]);
  const resolution = await resolveHubToolRegistry({
    grants,
    mcpCatalog,
    loadingPreference: "deferred",
    tokenCounter: getTokenCounter("generic_o200k"),
    contextWindow: 200_000,
    autoFraction: 0.1,
  });
  assert.deepEqual([...resolution.deferredNames].sort(), ["fetch_url", "search_web"]);
  assert.equal(resolution.promoted.size, 0, "promotion starts empty each turn");

  await resolution.toolSearch?.execute({ query: "web" }, {} as never);
  assert.ok(
    resolution.promoted.has("search_web"),
    "a tool_search hit promotes into the SAME set the turn engine's prepareStep reads",
  );
  assert.ok(!resolution.promoted.has("fetch_url"), "a non-matching tool is not promoted");
});

test("resolveHubToolRegistry (WP1.1): eager mode has empty deferredNames + promoted (byte-compatible)", async () => {
  const grants: HubToolGrants = { servers: { alpha: "all" }, builtins: [] };
  const mcpCatalog = new Map<string, HubMcpServerCatalog>([["alpha", { tools: [tool("search")] }]]);
  const resolution = await resolveHubToolRegistry({
    grants,
    mcpCatalog,
    loadingPreference: "eager",
    tokenCounter: getTokenCounter("generic_o200k"),
    contextWindow: 200_000,
    autoFraction: 0.1,
  });
  assert.equal(resolution.deferredNames.size, 0);
  assert.equal(resolution.promoted.size, 0);
});

test("createToolSearchBuiltin (WP1.1): promotion is token-capped — over-cap matches stay data-only with a note", async () => {
  const counter = getTokenCounter("generic_o200k");
  const desc = "Repeated search tool description with enough words to cost real tokens. ".repeat(6);
  const catalog = resolveMcpCatalog([
    { serverId: "srv", def: tool("alpha_search", desc) },
    { serverId: "srv", def: tool("bravo_search", desc) },
    { serverId: "srv", def: tool("gamma_search", desc) },
  ]);
  const per = (await counter.countToolDefinition(catalog[0]!.def)).totalTokens;
  assert.ok(per > 0, "the definition has a real measured token cost");

  const promoted = new Set<string>();
  // A cap that admits exactly ONE definition (the first fits; the second would push the running total
  // over the cap).
  const search = createToolSearchBuiltin(catalog, {
    promoted,
    tokenCounter: counter,
    maxTokens: per + Math.floor(per / 2),
  });
  const res = await search.execute({ query: "search" }, {} as never);
  const mc = res.modelContent as { matches: unknown[]; promoted: string[]; note?: string };
  assert.equal(mc.matches.length, 3, "all three are still discoverable as data");
  assert.equal(mc.promoted.length, 1, "only the first fits the per-search promotion budget");
  assert.equal(promoted.size, 1, "the shared promoted set carries exactly the promoted name");
  assert.ok(promoted.has("alpha_search"));
  assert.ok(mc.note && mc.note.length > 0, "a 'narrow your query' note is returned for the over-cap matches");
});

test("createToolSearchBuiltin (WP1.1): a generous cap promotes every match with no note", async () => {
  const counter = getTokenCounter("generic_o200k");
  const catalog = resolveMcpCatalog([
    { serverId: "srv", def: tool("alpha_search", "Alpha") },
    { serverId: "srv", def: tool("bravo_search", "Bravo") },
  ]);
  const promoted = new Set<string>();
  const search = createToolSearchBuiltin(catalog, { promoted, tokenCounter: counter, maxTokens: 1_000_000 });
  const res = await search.execute({ query: "search" }, {} as never);
  const mc = res.modelContent as { promoted: string[]; note?: string };
  assert.deepEqual(mc.promoted.sort(), ["alpha_search", "bravo_search"]);
  assert.equal(promoted.size, 2);
  assert.equal(mc.note, undefined, "no over-cap matches → no note");
});

// ── WP1.4 (hub-fixes, analysis.md RC1) — formatToolListText compression + the tools prompt budget ──

test("formatToolListText (WP1.4): deferred mode is ONE summary line PER SERVER, capped at 3 sample names", () => {
  const catalog = resolveMcpCatalog([
    { serverId: "srv-a", serverName: "Alpha", def: tool("search", "Search things") },
    { serverId: "srv-a", serverName: "Alpha", def: tool("fetch", "Fetch things") },
    { serverId: "srv-a", serverName: "Alpha", def: tool("write", "Write things") },
    { serverId: "srv-a", serverName: "Alpha", def: tool("list", "List things") },
    { serverId: "srv-b", serverName: "Beta", def: tool("ping", "Ping") },
  ]);
  const text = formatToolListText(catalog, "deferred");
  assert.equal(
    text,
    "**Alpha**: 4 tools (searchable) — e.g. `search`, `fetch`, `write`\n**Beta**: 1 tools (searchable) — e.g. `ping`",
    "deferred mode must summarize per server, not list every bare tool name",
  );
  // The 4th tool on Alpha ("list") is never named directly — that's the whole point of the compression.
  assert.ok(!text.includes("`list`"), "sample is capped at 3 names, not the full per-server list");
});

test("formatToolListText: deferred mode with no serverName falls back to the raw serverId as the label", () => {
  const catalog = resolveMcpCatalog([{ serverId: "srv-unnamed", def: tool("search") }]);
  const text = formatToolListText(catalog, "deferred");
  assert.equal(text, "**srv-unnamed**: 1 tools (searchable) — e.g. `search`");
});

test("formatToolListText: eager mode is UNCHANGED — one line per TOOL with full name + description", () => {
  const catalog = resolveMcpCatalog([
    { serverId: "srv-a", serverName: "Alpha", def: tool("search", "Search things") },
    { serverId: "srv-a", serverName: "Alpha", def: tool("fetch", "Fetch things") },
    { serverId: "srv-b", serverName: "Beta", def: tool("ping", "Ping") },
  ]);
  const text = formatToolListText(catalog, "eager");
  assert.equal(
    text,
    "**Alpha**: `search` — Search things; `fetch` — Fetch things\n**Beta**: `ping` — Ping",
    "eager mode must still list every tool with its full name + description",
  );
});

test("formatToolListText: eager mode falls back to 'no description' for a tool with none", () => {
  const bare: NormalizedToolDefinition = { name: "bare", inputSchema: { type: "object" }, raw: { name: "bare" } };
  const catalog = resolveMcpCatalog([{ serverId: "srv-a", serverName: "Alpha", def: bare }]);
  const text = formatToolListText(catalog, "eager");
  assert.equal(text, "**Alpha**: `bare` — no description");
});

test("formatToolListText: an empty catalog renders an empty string in either mode", () => {
  assert.equal(formatToolListText([], "deferred"), "");
  assert.equal(formatToolListText([], "eager"), "");
});

test("WP1.4 (RC1): a 5-server / 280-tool deferred catalog's rendered tools section fits HUB_PROMPT_SECTION_BUDGETS.tools", async () => {
  const counter = getTokenCounter("generic_o200k");
  // Mirrors the live defect session's shape (analysis.md RC1/§2): 5 granted servers, ~280 total tools.
  const serverNames = [
    "acme-demo",
    "filesystem-tools",
    "github-integration",
    "postgres-analytics",
    "web-research",
  ];
  const descriptions = [
    "Search across the connected workspace for matching records and return a ranked list.",
    "Read the contents of a resource by its identifier and return the raw payload.",
    "Create or update a record with the given fields, validating against the schema first.",
    "Delete a record permanently; this action cannot be undone once confirmed.",
    "List all available items in a collection, optionally filtered by a query string.",
  ];
  const entries: HubMcpCatalogEntry[] = [];
  for (const serverName of serverNames) {
    for (let i = 0; i < 56; i++) {
      entries.push({
        serverId: serverName,
        serverName,
        def: tool(`${serverName.replace(/-/g, "_")}_tool_${i}`, descriptions[i % descriptions.length]!),
      });
    }
  }
  assert.equal(entries.length, 280);

  const catalog = resolveMcpCatalog(entries);
  const listText = formatToolListText(catalog, "deferred");
  const rendered = toolsLayer.render({ loadingMode: "deferred", toolListText: listText });
  const tokens = await counter.countText(rendered);

  assert.ok(
    tokens <= HUB_PROMPT_SECTION_BUDGETS.tools,
    `5-server/280-tool deferred "tools" section is ${tokens} tokens, over its ${HUB_PROMPT_SECTION_BUDGETS.tools}-token budget`,
  );
  // The whole point of WP1.4: the compressed list is nowhere near the old ~6,000-token failure mode.
  assert.ok(tokens < 1000, `expected the compressed section well under 1,000 tokens, got ${tokens}`);
});

test("WP1.4: the prompt still forbids inventing names and still points at tool_search in deferred mode", () => {
  const catalog = resolveMcpCatalog([{ serverId: "srv", serverName: "Srv", def: tool("alpha") }]);
  const listText = formatToolListText(catalog, "deferred");
  const rendered = toolsLayer.render({ loadingMode: "deferred", toolListText: listText });
  assert.ok(rendered.includes("Do NOT invent tool or server names"));
  assert.ok(rendered.includes("call `tool_search`"));
  assert.ok(rendered.includes("ONLY tools available"));
});
