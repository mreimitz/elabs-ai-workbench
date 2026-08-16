import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PromptScan,
  ResourceKind,
  ResourceScan,
  ScanDetail,
  ToolScan,
} from "@mcp-token-footprint/shared";
import {
  matchTools,
  normalizeName,
  similarity,
  tokenize,
  type MatchableTool,
} from "../src/compare/matching.js";
import { buildComparison } from "../src/compare/service.js";

// --- fixtures (no DB, no network) -------------------------------------------------------------

function tool(
  toolName: string,
  totalTokens: number,
  description?: string,
  inputSchema?: unknown,
  annotations?: unknown,
): ToolScan {
  return {
    id: `tool_${toolName}`,
    scanId: "scan",
    toolName,
    description,
    inputSchema,
    annotations,
    rawTool: {},
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 3,
    schemaTokens: totalTokens - 5,
    annotationsTokens: 0,
    rawBytes: totalTokens * 4,
    contributionPercent: 0,
  };
}

function resource(
  uri: string,
  totalTokens: number,
  opts: { kind?: ResourceKind; name?: string; mimeType?: string; description?: string } = {},
): ResourceScan {
  return {
    id: `res_${uri}`,
    scanId: "scan",
    kind: opts.kind ?? "resource",
    uri,
    name: opts.name,
    description: opts.description,
    mimeType: opts.mimeType,
    rawResource: {},
    totalTokens,
    uriTokens: 2,
    nameTokens: 1,
    descriptionTokens: 1,
    mimeTypeTokens: 1,
    rawBytes: totalTokens * 4,
    contributionPercent: 0,
  };
}

function prompt(promptName: string, totalTokens: number, description?: string): PromptScan {
  return {
    id: `prompt_${promptName}`,
    scanId: "scan",
    promptName,
    description,
    arguments: undefined,
    rawPrompt: {},
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 1,
    argumentsTokens: totalTokens - 3,
    rawBytes: totalTokens * 4,
    contributionPercent: 0,
  };
}

function scan(overrides: Partial<ScanDetail> & { tools: ToolScan[] }): ScanDetail {
  const totalTokens = overrides.tools.reduce((sum, t) => sum + t.totalTokens, 0);
  return {
    id: "scan_a",
    serverId: "server_1",
    serverName: "Server One",
    tokenProfile: "generic_o200k",
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    totalTools: overrides.tools.length,
    totalTokens,
    totalRawBytes: totalTokens * 4,
    averageTokensPerTool: 0,
    largestToolTokens: 0,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    resources: [],
    prompts: [],
    events: [],
    ...overrides,
  };
}

function m(toolName: string, description?: string): MatchableTool {
  return { toolName, description };
}

// --- normalizeName + tokenize ----------------------------------------------------------------

test("normalizeName collapses casing and separators", () => {
  assert.equal(normalizeName("get_user"), "getuser");
  assert.equal(normalizeName("getUser"), "getuser");
  assert.equal(normalizeName("Get-User"), "getuser");
  assert.equal(normalizeName("  Get User 2  "), "getuser2");
  assert.equal(normalizeName(""), "");
});

test("tokenize splits on non-alphanumeric and camelCase, drops empties", () => {
  assert.deepEqual([...tokenize("getUserById")].sort(), ["by", "get", "id", "user"]);
  assert.deepEqual([...tokenize("get_user")].sort(), ["get", "user"]);
  assert.deepEqual([...tokenize("__Get--User__")].sort(), ["get", "user"]);
  assert.deepEqual([...tokenize("listV2Items")].sort(), ["items", "list", "v", "2"].sort());
  assert.deepEqual([...tokenize("")], []);
});

// --- similarity (Jaccard) --------------------------------------------------------------------

test("similarity is 1 for identical token sets", () => {
  assert.equal(similarity(m("getUser"), m("get_user")), 1);
  assert.equal(similarity(m("listItems", "all items"), m("list_items", "all items")), 1);
});

test("similarity is 0 for disjoint token sets", () => {
  assert.equal(similarity(m("alpha"), m("bravo")), 0);
  // Two empty token sets carry no signal -> 0.
  assert.equal(similarity(m(""), m("")), 0);
});

test("similarity is the expected Jaccard for partial overlap", () => {
  // A = {get, user}, B = {get, account}. intersection {get}=1, union {get,user,account}=3.
  assert.equal(similarity(m("getUser"), m("getAccount")), 1 / 3);
  // Name + description combine into one set. A = {get,user,fetch,profile},
  // B = {get,user}. intersection 2, union 4 -> 0.5.
  assert.equal(similarity(m("getUser", "fetch profile"), m("getUser")), 0.5);
});

// --- matchTools ------------------------------------------------------------------------------

test("matchTools pairs exact names with basis exact", () => {
  const result = matchTools([m("getUser"), m("listItems")], [m("getUser"), m("deleteItem")], 0.6);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.basis, "exact");
  assert.equal(result.matched[0]!.similarity, 1);
  assert.equal(result.matched[0]!.a.toolName, "getUser");
  assert.deepEqual(
    result.onlyInA.map((t) => t.toolName),
    ["listItems"],
  );
  assert.deepEqual(
    result.onlyInB.map((t) => t.toolName),
    ["deleteItem"],
  );
});

test("matchTools pairs normalized names (get_user vs getUser) with basis normalized", () => {
  const result = matchTools([m("get_user")], [m("getUser")], 0.6);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.basis, "normalized");
  assert.equal(result.matched[0]!.similarity, 1);
  assert.equal(result.onlyInA.length, 0);
  assert.equal(result.onlyInB.length, 0);
});

test("matchTools fuzzy-matches a pair at/above threshold and drops one below", () => {
  // getUser vs getAccount = 1/3 ≈ 0.333. At threshold 0.3 it matches; at 0.6 it does not.
  const above = matchTools([m("getUser")], [m("getAccount")], 0.3);
  assert.equal(above.matched.length, 1);
  assert.equal(above.matched[0]!.basis, "fuzzy");
  assert.ok(Math.abs(above.matched[0]!.similarity - 1 / 3) < 1e-9);

  const below = matchTools([m("getUser")], [m("getAccount")], 0.6);
  assert.equal(below.matched.length, 0);
  assert.deepEqual(
    below.onlyInA.map((t) => t.toolName),
    ["getUser"],
  );
  assert.deepEqual(
    below.onlyInB.map((t) => t.toolName),
    ["getAccount"],
  );
});

test("matchTools reports tools present only in A and only in B", () => {
  const result = matchTools([m("onlyA")], [m("onlyB")], 0.6);
  assert.equal(result.matched.length, 0);
  assert.deepEqual(
    result.onlyInA.map((t) => t.toolName),
    ["onlyA"],
  );
  assert.deepEqual(
    result.onlyInB.map((t) => t.toolName),
    ["onlyB"],
  );
});

test("matchTools greedy assignment does not double-assign a tool", () => {
  // A: userProfile (tokens {user,profile}), userSettings ({user,settings}).
  // B: userProfileData ({user,profile,data}) -> best match for userProfile (2/3).
  //    userInfo ({user,info}) -> weak match for userSettings (1/3).
  // Greedy should take the strongest pair first (userProfile↔userProfileData) and must not
  // reuse userProfileData for userSettings.
  const result = matchTools(
    [m("userProfile"), m("userSettings")],
    [m("userProfileData"), m("userInfo")],
    0.3,
  );
  assert.equal(result.matched.length, 2);
  const byA = new Map(result.matched.map((pair) => [pair.a.toolName, pair.b.toolName]));
  assert.equal(byA.get("userProfile"), "userProfileData");
  assert.equal(byA.get("userSettings"), "userInfo");
  // No B tool used twice.
  const usedB = result.matched.map((pair) => pair.b.toolName);
  assert.equal(new Set(usedB).size, usedB.length);
});

test("matchTools is deterministic on similarity ties", () => {
  // Both B tools tie at similarity 0.5 against aTool ({get,user}). Greedy + stable tie-break
  // (A name, then B name) must pick the alphabetically-first B name first.
  const a = [m("getUser")];
  const b = [m("userGet", "extra"), m("getThing")];
  const r1 = matchTools(a, b, 0.3);
  const r2 = matchTools([...a], [b[1]!, b[0]!], 0.3); // reversed B order
  assert.equal(r1.matched.length, 1);
  assert.equal(r2.matched.length, 1);
  // Same winner regardless of input order.
  assert.equal(r1.matched[0]!.b.toolName, r2.matched[0]!.b.toolName);
});

// --- buildComparison -------------------------------------------------------------------------

test("buildComparison computes totals delta (B − A), counts, and flags", () => {
  const a = scan({
    id: "scan_a",
    serverId: "server_1",
    tokenProfile: "generic_o200k",
    tools: [tool("getUser", 100), tool("listItems", 50), tool("legacyTool", 30)],
  });
  const b = scan({
    id: "scan_b",
    serverId: "server_1",
    tokenProfile: "generic_o200k",
    tools: [tool("getUser", 120), tool("listItems", 40), tool("brandNew", 70)],
  });

  const result = buildComparison(a, b, 0.6);

  // totals: A = 180, B = 230 -> delta +50.
  assert.equal(result.totalsDeltaTokens, 50);
  assert.ok(Math.abs(result.totalsDeltaPercent - (50 / 180) * 100) < 1e-9);

  // getUser + listItems match exactly; legacyTool only in A; brandNew only in B.
  assert.equal(result.counts.matched, 2);
  assert.equal(result.counts.onlyInA, 1);
  assert.equal(result.counts.onlyInB, 1);
  assert.deepEqual(
    result.onlyInA.map((t) => t.toolName),
    ["legacyTool"],
  );
  assert.deepEqual(
    result.onlyInB.map((t) => t.toolName),
    ["brandNew"],
  );

  // sameServer/sameProfile both true here.
  assert.equal(result.sameServer, true);
  assert.equal(result.sameProfile, true);
  assert.equal(result.threshold, 0.6);

  // Per-match delta (B − A) on getUser: 120 - 100 = +20, +20%.
  const getUserMatch = result.matched.find((pair) => pair.a.toolName === "getUser");
  assert.ok(getUserMatch);
  assert.equal(getUserMatch!.deltaTokens, 20);
  assert.ok(Math.abs(getUserMatch!.deltaPercent - 20) < 1e-9);
  assert.equal(getUserMatch!.basis, "exact");

  // ComparedTool shape: no matcher-only field (description/inputSchema/annotations) leaks through.
  for (const compared of [getUserMatch!.a, getUserMatch!.b, result.onlyInA[0]!]) {
    assert.ok(!("description" in compared));
    assert.ok(!("inputSchema" in compared));
    assert.ok(!("annotations" in compared));
  }
});

// --- buildComparison: tool-level definition delta --------------------------------------------

test("buildComparison flags a description-only change on a matched pair", () => {
  // Same exact name and same tokens, but the description text differs A → B.
  const a = scan({ id: "scan_a", tools: [tool("getUser", 100, "fetch a user")] });
  const b = scan({ id: "scan_b", tools: [tool("getUser", 100, "fetch a user account")] });
  const result = buildComparison(a, b, 0.6);

  const match = result.matched.find((pair) => pair.a.toolName === "getUser");
  assert.ok(match);
  assert.equal(match!.definitionDelta.descriptionChanged, true);
  assert.equal(match!.definitionDelta.schemaChanged, false);
  assert.equal(match!.definitionDelta.annotationsChanged, false);
});

test("buildComparison flags an inputSchema change on a matched pair", () => {
  const a = scan({
    id: "scan_a",
    tools: [
      tool("getUser", 100, "same", { type: "object", properties: { id: { type: "string" } } }),
    ],
  });
  const b = scan({
    id: "scan_b",
    tools: [
      tool("getUser", 100, "same", { type: "object", properties: { id: { type: "number" } } }),
    ],
  });
  const result = buildComparison(a, b, 0.6);

  const match = result.matched.find((pair) => pair.a.toolName === "getUser");
  assert.ok(match);
  assert.equal(match!.definitionDelta.schemaChanged, true);
  assert.equal(match!.definitionDelta.descriptionChanged, false);
  assert.equal(match!.definitionDelta.annotationsChanged, false);
});

test("buildComparison flags an annotations change on a matched pair", () => {
  const a = scan({
    id: "scan_a",
    tools: [tool("getUser", 100, "same", undefined, { readOnlyHint: true })],
  });
  const b = scan({
    id: "scan_b",
    tools: [tool("getUser", 100, "same", undefined, { readOnlyHint: false })],
  });
  const result = buildComparison(a, b, 0.6);

  const match = result.matched.find((pair) => pair.a.toolName === "getUser");
  assert.ok(match);
  assert.equal(match!.definitionDelta.annotationsChanged, true);
  assert.equal(match!.definitionDelta.descriptionChanged, false);
  assert.equal(match!.definitionDelta.schemaChanged, false);
});

test("buildComparison reports no definition change when description/schema/annotations are identical", () => {
  const schema = { type: "object", properties: { id: { type: "string" } } };
  const annotations = { readOnlyHint: true };
  const a = scan({
    id: "scan_a",
    tools: [tool("getUser", 100, "fetch a user", schema, annotations)],
  });
  // Distinct (but deep-equal) objects on the B side — canonicalization must treat them as unchanged.
  const b = scan({
    id: "scan_b",
    tools: [
      tool(
        "getUser",
        100,
        "fetch a user",
        { type: "object", properties: { id: { type: "string" } } },
        { readOnlyHint: true },
      ),
    ],
  });
  const result = buildComparison(a, b, 0.6);

  const match = result.matched.find((pair) => pair.a.toolName === "getUser");
  assert.ok(match);
  assert.equal(match!.definitionDelta.descriptionChanged, false);
  assert.equal(match!.definitionDelta.schemaChanged, false);
  assert.equal(match!.definitionDelta.annotationsChanged, false);
});

test("buildComparison sets sameServer/sameProfile false across servers/profiles", () => {
  const a = scan({
    id: "scan_a",
    serverId: "server_1",
    tokenProfile: "generic_o200k",
    tools: [tool("x", 10)],
  });
  const b = scan({
    id: "scan_b",
    serverId: "server_2",
    tokenProfile: "generic_cl100k",
    tools: [tool("x", 10)],
  });
  const result = buildComparison(a, b, 0.6);
  assert.equal(result.sameServer, false);
  assert.equal(result.sameProfile, false);
});

test("buildComparison SUPPRESSES token deltas when the two scans use different token profiles", () => {
  // Different profiles → counts are on different tokenizer scales → deltas are not comparable.
  const a = scan({
    id: "scan_a",
    serverId: "server_1",
    tokenProfile: "generic_o200k",
    tools: [tool("getUser", 100), tool("legacy", 30)],
  });
  const b = scan({
    id: "scan_b",
    serverId: "server_1",
    tokenProfile: "generic_cl100k",
    tools: [tool("getUser", 140), tool("brandNew", 50)],
  });

  const result = buildComparison(a, b, 0.6);

  // Flagged non-comparable, and every token delta is suppressed to 0 (no misleading raw delta).
  assert.equal(result.sameProfile, false);
  assert.equal(result.deltasComparable, false);
  assert.equal(result.totalsDeltaTokens, 0);
  assert.equal(result.totalsDeltaPercent, 0);
  const getUser = result.matched.find((pair) => pair.a.toolName === "getUser");
  assert.ok(getUser);
  assert.equal(getUser!.deltaTokens, 0);
  assert.equal(getUser!.deltaPercent, 0);

  // Matching itself is intact — the surfaces are still paired/split, only the token deltas are gone.
  assert.equal(result.counts.matched, 1);
  assert.deepEqual(
    result.onlyInA.map((t) => t.toolName),
    ["legacy"],
  );
  assert.deepEqual(
    result.onlyInB.map((t) => t.toolName),
    ["brandNew"],
  );
  // The raw per-side totals are still exposed (the UI can show them side by side, just not a delta).
  assert.equal(getUser!.a.totalTokens, 100);
  assert.equal(getUser!.b.totalTokens, 140);
});

test("buildComparison suppresses deltas when the counting version differs (same profile)", () => {
  const a = scan({
    id: "scan_a",
    tokenProfile: "generic_o200k",
    countingVersion: 1,
    tools: [tool("x", 100)],
  });
  const b = scan({
    id: "scan_b",
    tokenProfile: "generic_o200k",
    countingVersion: 2,
    tools: [tool("x", 150)],
  });
  const result = buildComparison(a, b, 0.6);

  assert.equal(result.sameProfile, true);
  assert.equal(result.deltasComparable, false);
  assert.equal(result.totalsDeltaTokens, 0);
  assert.equal(result.matched[0]!.deltaTokens, 0);
});

test("buildComparison keeps deltas when profile AND counting version match", () => {
  const a = scan({
    id: "scan_a",
    tokenProfile: "generic_o200k",
    countingVersion: 2,
    tools: [tool("x", 100)],
  });
  const b = scan({
    id: "scan_b",
    tokenProfile: "generic_o200k",
    countingVersion: 2,
    tools: [tool("x", 150)],
  });
  const result = buildComparison(a, b, 0.6);

  assert.equal(result.deltasComparable, true);
  assert.equal(result.totalsDeltaTokens, 50);
  assert.equal(result.matched[0]!.deltaTokens, 50);
});

test("buildComparison guards deltaPercent at 0 base tokens", () => {
  // A-side tool has 0 tokens -> per-match deltaPercent must be 0 (no divide-by-zero).
  const a = scan({ id: "scan_a", tools: [tool("newTool", 0)] });
  const b = scan({ id: "scan_b", tools: [tool("newTool", 80)] });
  const result = buildComparison(a, b, 0.6);

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.deltaTokens, 80);
  assert.equal(result.matched[0]!.deltaPercent, 0);

  // Scan-total guard: A total is 0 -> totalsDeltaPercent is 0 too.
  assert.equal(result.totalsDeltaTokens, 80);
  assert.equal(result.totalsDeltaPercent, 0);
});

test("buildComparison echoes the threshold and builds both ScanCompareRefs", () => {
  const a = scan({ id: "scan_a", serverId: "s1", serverName: "Alpha", tools: [tool("x", 10)] });
  const b = scan({ id: "scan_b", serverId: "s2", serverName: "Beta", tools: [tool("x", 10)] });
  const result = buildComparison(a, b, 0.42);

  assert.equal(result.threshold, 0.42);
  assert.equal(result.a.scanId, "scan_a");
  assert.equal(result.a.serverName, "Alpha");
  assert.equal(result.a.totalTokens, 10);
  assert.equal(result.b.scanId, "scan_b");
  assert.equal(result.b.serverName, "Beta");
});

// --- buildComparison: resource + prompt diff -------------------------------------------------

test("buildComparison diffs resources by uri and prompts by name (matched + delta, only-in)", () => {
  const a = scan({
    id: "scan_a",
    serverId: "server_1",
    tools: [tool("getUser", 100)],
    resources: [
      resource("mcp://docs/readme", 40, { name: "Readme", mimeType: "text/markdown" }),
      resource("mcp://docs/legacy", 25, { name: "Legacy" }),
    ],
    prompts: [prompt("summarize", 30, "Summarize a document"), prompt("retired", 12)],
  });
  const b = scan({
    id: "scan_b",
    serverId: "server_1",
    tools: [tool("getUser", 100)],
    resources: [
      resource("mcp://docs/readme", 55, { name: "Readme", mimeType: "text/markdown" }),
      resource("mcp://docs/changelog", 18, { name: "Changelog" }),
    ],
    prompts: [prompt("summarize", 42, "Summarize a document"), prompt("brandNew", 20)],
  });

  const result = buildComparison(a, b, 0.6);

  // Resources: shared uri matches exactly; legacy only in A, changelog only in B.
  assert.equal(result.resourceCounts.matched, 1);
  assert.equal(result.resourceCounts.onlyInA, 1);
  assert.equal(result.resourceCounts.onlyInB, 1);
  assert.equal(result.resourceMatched.length, 1);
  const resMatch = result.resourceMatched[0]!;
  assert.equal(resMatch.a.uri, "mcp://docs/readme");
  assert.equal(resMatch.b.uri, "mcp://docs/readme");
  assert.equal(resMatch.basis, "exact");
  assert.equal(resMatch.deltaTokens, 15); // 55 - 40
  assert.ok(Math.abs(resMatch.deltaPercent - (15 / 40) * 100) < 1e-9);
  assert.deepEqual(
    result.resourceOnlyInA.map((r) => r.uri),
    ["mcp://docs/legacy"],
  );
  assert.deepEqual(
    result.resourceOnlyInB.map((r) => r.uri),
    ["mcp://docs/changelog"],
  );

  // Prompts: shared name matches exactly; retired only in A, brandNew only in B.
  assert.equal(result.promptCounts.matched, 1);
  assert.equal(result.promptCounts.onlyInA, 1);
  assert.equal(result.promptCounts.onlyInB, 1);
  assert.equal(result.promptMatched.length, 1);
  const promptMatch = result.promptMatched[0]!;
  assert.equal(promptMatch.a.promptName, "summarize");
  assert.equal(promptMatch.b.promptName, "summarize");
  assert.equal(promptMatch.basis, "exact");
  assert.equal(promptMatch.deltaTokens, 12); // 42 - 30
  assert.ok(Math.abs(promptMatch.deltaPercent - (12 / 30) * 100) < 1e-9);
  assert.deepEqual(
    result.promptOnlyInA.map((p) => p.promptName),
    ["retired"],
  );
  assert.deepEqual(
    result.promptOnlyInB.map((p) => p.promptName),
    ["brandNew"],
  );

  // Wire ComparedResource/ComparedPrompt carry only their projected keys — no matcher-only
  // toolName/description leaks onto the wire.
  for (const compared of [resMatch.a, resMatch.b, result.resourceOnlyInA[0]!]) {
    assert.ok(!("toolName" in compared));
    assert.ok(!("description" in compared));
    assert.deepEqual(
      Object.keys(compared).sort(),
      ["contributionPercent", "kind", "mimeType", "name", "totalTokens", "uri"].sort(),
    );
  }
  for (const compared of [promptMatch.a, promptMatch.b, result.promptOnlyInA[0]!]) {
    assert.ok(!("toolName" in compared));
    assert.ok(!("description" in compared));
    assert.deepEqual(
      Object.keys(compared).sort(),
      ["contributionPercent", "promptName", "totalTokens"].sort(),
    );
  }
});

test("buildComparison fuzzy/normalized-matches resources and prompts across name variants", () => {
  // Resource uris differ, but the names overlap strongly -> fuzzy match over name+description.
  // Prompt names normalize equal (get_user vs getUser).
  const a = scan({
    id: "scan_a",
    serverId: "server_1",
    tools: [tool("x", 10)],
    resources: [resource("https://a.example/user/profile", 30, { name: "User Profile" })],
    prompts: [prompt("get_user", 20)],
  });
  const b = scan({
    id: "scan_b",
    serverId: "server_2",
    tools: [tool("x", 10)],
    resources: [resource("https://b.example/user/profile", 36, { name: "User Profile" })],
    prompts: [prompt("getUser", 28)],
  });

  const result = buildComparison(a, b, 0.5);

  assert.equal(result.resourceMatched.length, 1);
  assert.equal(result.resourceMatched[0]!.basis, "fuzzy");
  assert.equal(result.resourceMatched[0]!.deltaTokens, 6); // 36 - 30

  assert.equal(result.promptMatched.length, 1);
  assert.equal(result.promptMatched[0]!.basis, "normalized");
  assert.equal(result.promptMatched[0]!.deltaTokens, 8); // 28 - 20
});

test("buildComparison guards resource/prompt deltaPercent at 0 base tokens", () => {
  const a = scan({
    id: "scan_a",
    tools: [tool("x", 10)],
    resources: [resource("mcp://new", 0, { name: "New" })],
    prompts: [prompt("fresh", 0)],
  });
  const b = scan({
    id: "scan_b",
    tools: [tool("x", 10)],
    resources: [resource("mcp://new", 50, { name: "New" })],
    prompts: [prompt("fresh", 40)],
  });
  const result = buildComparison(a, b, 0.6);

  assert.equal(result.resourceMatched[0]!.deltaTokens, 50);
  assert.equal(result.resourceMatched[0]!.deltaPercent, 0);
  assert.equal(result.promptMatched[0]!.deltaTokens, 40);
  assert.equal(result.promptMatched[0]!.deltaPercent, 0);
});

test("buildComparison yields empty resource/prompt diffs when both scans have none", () => {
  const a = scan({ id: "scan_a", tools: [tool("x", 10)] });
  const b = scan({ id: "scan_b", tools: [tool("x", 12)] });
  const result = buildComparison(a, b, 0.6);

  assert.deepEqual(result.resourceMatched, []);
  assert.deepEqual(result.resourceOnlyInA, []);
  assert.deepEqual(result.resourceOnlyInB, []);
  assert.deepEqual(result.resourceCounts, { matched: 0, onlyInA: 0, onlyInB: 0 });
  assert.deepEqual(result.promptMatched, []);
  assert.deepEqual(result.promptOnlyInA, []);
  assert.deepEqual(result.promptOnlyInB, []);
  assert.deepEqual(result.promptCounts, { matched: 0, onlyInA: 0, onlyInB: 0 });
});
