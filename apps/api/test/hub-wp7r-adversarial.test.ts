// hub-fixes WP 7.R — adversarial review probes. These LOCK the security-relevant invariants the
// workstream claims, attacking them the way the spec's §"Invariants to probe" demands: forged plan
// JSON, hostile tool_search queries, repeated-search promotion, and the SSRF address/redirect matrix.
// Every probe here is offline (no network, no provider). Where an existing suite already pins an
// invariant, this file references it in a comment rather than duplicating — it adds only the genuinely
// UNCOVERED adversarial edges found in the 7.R review (see roadmap/hub-fixes/review-7R.md).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubToolGrants, NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { effectiveAgentGrants, resolveMcpGrants, type HubMcpServerCatalog } from "../src/hub/tools/grants.js";
import { resolveMcpCatalog } from "../src/hub/tools/mcp-bridge.js";
import { createToolSearchBuiltin } from "../src/hub/tools/tool-search.js";
import { resolveHubToolRegistry } from "../src/hub/tools/registry.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import {
  assertPublicHttpUrl,
  guardedFetch,
  isBlockedIp,
  WebFetchError,
  type WebFetchTransport,
} from "../src/hub/tools/builtins/web.js";

const counter = getTokenCounter("generic_o200k");

function tool(name: string, description = "", schema: unknown = { type: "object" }): NormalizedToolDefinition {
  return { name, description, inputSchema: schema, raw: { name, description } };
}

// ── INV1 — Grant confinement: a FORGED plan cannot escape a scoped parent ─────────────────────────
//
// The spec's INV1 forged-plan attack: a mission plan (model-authored or forged) grants a server the
// parent session's scope excludes. TWO independent defenses must both hold:
//   (a) `effectiveAgentGrants` (the spawn seam) intersects plan ∩ parent → the out-of-scope server is
//       DROPPED before the child session is even created;
//   (b) even if a child somehow carried the forged grant, `resolveMcpGrants` only ever yields entries
//       for servers actually in the resolved catalog — an ungranted/unknown server never materializes.

test("INV1: a forged plan granting servers the SCOPED parent excludes is dropped by effectiveAgentGrants (defense a)", () => {
  const parentScope: HubToolGrants = { servers: { qlik: "all" }, builtins: [] };
  // The forged plan tries to reach two servers the parent never granted, plus tighten qlik to a subset.
  const forgedPlan: HubToolGrants = {
    servers: { qlik: "all", secretdb: "all", filesystem: ["rm", "read"] },
    builtins: ["memory.propose_save"],
  };
  const effective = effectiveAgentGrants(forgedPlan, parentScope);
  assert.deepEqual(Object.keys(effective.servers), ["qlik"], "only the in-scope server survives");
  assert.equal(effective.servers.qlik, "all");
  assert.ok(!("secretdb" in effective.servers), "secretdb (outside parent scope) is dropped entirely");
  assert.ok(!("filesystem" in effective.servers), "filesystem (outside parent scope) is dropped entirely");
});

test("INV1: intersecting a plan's 'all' with a parent ALLOWLIST narrows to the allowlist (no widening)", () => {
  const parentScope: HubToolGrants = { servers: { qlik: ["qlik_search"] }, builtins: [] };
  const forgedPlan: HubToolGrants = { servers: { qlik: "all" }, builtins: [] };
  const effective = effectiveAgentGrants(forgedPlan, parentScope);
  assert.deepEqual(effective.servers.qlik, ["qlik_search"], "plan 'all' is bounded to the parent's allowlist");
});

test("INV1: resolveMcpGrants never yields tools for a server absent from the catalog (defense b)", () => {
  // Even handed the FORGED grant directly (simulating a bypass of defense a), the catalog is ground truth.
  const forgedChildGrant: HubToolGrants = {
    servers: { qlik: "all", secretdb: "all", filesystem: ["rm"] },
    builtins: [],
  };
  const catalog = new Map<string, HubMcpServerCatalog>([
    ["qlik", { serverName: "Qlik", tools: [tool("qlik_search", "search app data")] }],
  ]);
  const entries = resolveMcpGrants(forgedChildGrant, catalog);
  const serverIds = [...new Set(entries.map((e) => e.serverId))];
  assert.deepEqual(serverIds, ["qlik"], "ungranted/unknown servers never materialize as callable tools");
  assert.deepEqual(entries.map((e) => e.def.name), ["qlik_search"]);
});

// ── INV2 — Promotion safety ───────────────────────────────────────────────────────────────────────
//
// (Existing coverage: hub-tool-registry.test.ts pins per-search cap + "promotion starts empty each
//  turn" + ungranted-name-not-promoted. These probes add the HOSTILE-QUERY and CUMULATIVE-search edges.)

test("INV2: a hostile tool_search query naming UNGRANTED tools promotes nothing (only the deferred catalog is searchable)", async () => {
  const deferred = resolveMcpCatalog([
    { serverId: "qlik", def: tool("qlik_search", "search app data") },
  ]);
  const promoted = new Set<string>();
  const search = createToolSearchBuiltin(deferred, { promoted, tokenCounter: counter, maxTokens: 1_000_000 });
  const res = await search.execute(
    { query: "delete_all_users admin drop_table secret exfiltrate" },
    {} as never,
  );
  const mc = res.modelContent as { matches: unknown[]; promoted?: string[] };
  assert.equal(mc.matches.length, 0, "no ungranted tool ever matches (it isn't in the deferred catalog)");
  assert.equal(promoted.size, 0, "nothing is promoted from a hostile query");
});

test("INV2: the promoted set is PER-TURN — a fresh registry resolution starts empty (no cross-turn carryover)", async () => {
  const grants: HubToolGrants = { servers: { alpha: "all" }, builtins: [] };
  const mcpCatalog = new Map<string, HubMcpServerCatalog>([
    ["alpha", { serverName: "Alpha", tools: [tool("search_web", "Search the web"), tool("fetch_url", "Fetch a URL")] }],
  ]);
  const input = {
    grants,
    mcpCatalog,
    loadingPreference: "deferred" as const,
    tokenCounter: counter,
    contextWindow: 200_000,
    autoFraction: 0.1,
  };
  const turn1 = await resolveHubToolRegistry(input);
  await turn1.toolSearch?.execute({ query: "search" }, {} as never);
  assert.ok(turn1.promoted.size >= 1, "turn 1 promoted at least one match");
  const turn2 = await resolveHubToolRegistry(input); // a NEW turn re-resolves the registry
  assert.equal(turn2.promoted.size, 0, "turn 2 begins with an empty promotion set (no leak from turn 1)");
});

// ACCEPTED-RISK (documented in review-7R.md §INV2): the promotion cap is PER-SEARCH, not per-turn. This
// probe DEMONSTRATES that repeated searches accumulate promotions beyond a single per-search budget. It
// is NOT a grant-confinement break (every promoted tool is granted); it is bounded by the 20-step turn
// cap and the granted catalog, and the model pays for its own context. Locked here so any future change
// to per-search-vs-per-turn capping is a deliberate, reviewed decision.
test("INV2 (accepted-risk, LOCKED): repeated tool_search calls accumulate promotions past ONE per-search cap", async () => {
  const many: NormalizedToolDefinition[] = [];
  for (let i = 0; i < 8; i++) many.push(tool(`report_tool_${i}`, `Generates report number ${i} ${"detail ".repeat(30)}`));
  const deferred = resolveMcpCatalog(many.map((def) => ({ serverId: "srv", def })));
  const promoted = new Set<string>();
  // A tiny per-search cap so each single search promotes ~1 tool.
  const search = createToolSearchBuiltin(deferred, { promoted, tokenCounter: counter, maxTokens: 80 });

  // One search alone is capped:
  await search.execute({ query: "report_tool_0" }, {} as never);
  const afterOne = promoted.size;
  assert.ok(afterOne >= 1, "one search promotes at least one match");

  // …but eight distinct searches accumulate well past a single per-search budget.
  for (let i = 1; i < 8; i++) await search.execute({ query: `report_tool_${i}` }, {} as never);
  assert.ok(
    promoted.size > afterOne,
    "cumulative promotion across searches exceeds a single per-search cap (per-search, not per-turn — see review-7R.md)",
  );
});

// ── INV6 — SSRF / web.fetch guard: adversarial address + redirect matrix ──────────────────────────
//
// (Existing coverage: hub-web-builtins.test.ts pins the core private/loopback/redirect-to-private +
//  deny-if-any-resolved-IP-blocked cases. These probes add the LITERAL-URL evasions the spec names:
//  IPv4-mapped/NAT64 literals, decimal/hex/octal host normalization, and the DNS-name → resolve-time
//  private catch that assertPublicHttpUrl deliberately can't decide statically.)

test("INV6: IPv4-mapped + NAT64 literal URLs to private targets are refused; a NAT64 of a PUBLIC v4 is allowed", () => {
  // v4-mapped IPv6 literal wrapping the cloud-metadata address.
  assert.throws(() => assertPublicHttpUrl("http://[::ffff:169.254.169.254]/latest/meta-data"), WebFetchError);
  // v4-mapped loopback.
  assert.throws(() => assertPublicHttpUrl("http://[::ffff:127.0.0.1]/"), WebFetchError);
  // NAT64 (64:ff9b::/96) wrapping a private v4 (10.0.0.1).
  assert.equal(isBlockedIp("64:ff9b::a00:1"), true, "NAT64 of a private v4 is blocked");
  // NAT64 wrapping a PUBLIC v4 (8.8.8.8) is judged by the embedded v4 → allowed.
  assert.equal(isBlockedIp("64:ff9b::808:808"), false, "NAT64 of a public v4 is allowed (judged by embedded v4)");
  // v4-mapped public is likewise allowed.
  assert.equal(isBlockedIp("::ffff:8.8.8.8"), false);
});

test("INV6: decimal / hex / octal host encodings normalize to the dotted quad and are blocked statically", () => {
  // Node's WHATWG URL parser normalizes these numeric hosts to 127.0.0.1, which the literal guard catches.
  for (const raw of ["http://2130706433/", "http://0x7f000001/", "http://017700000001/"]) {
    assert.throws(() => assertPublicHttpUrl(raw), WebFetchError, `numeric loopback host blocked: ${raw}`);
  }
});

test("INV6: a DNS NAME resolving to a private IP passes the static check but is refused at connect time (resolve-then-validate)", async () => {
  // assertPublicHttpUrl can only decide IP LITERALS statically — a name like `localhost` is allowed HERE…
  assert.doesNotThrow(() => assertPublicHttpUrl("http://localhost/"));
  assert.doesNotThrow(() => assertPublicHttpUrl("http://metadata.internal/"));
  // …and refused by guardedFetch once it resolves to a private address (the real defense for names).
  const transport: WebFetchTransport = {
    async resolveHostIps(host) {
      if (host === "localhost") return ["127.0.0.1"];
      if (host === "metadata.internal") return ["169.254.169.254"];
      return ["93.184.216.34"];
    },
    async fetchOnce() {
      return { status: 200, contentType: "text/html", body: "<p>ok</p>", truncated: false };
    },
  };
  await assert.rejects(() => guardedFetch("http://localhost/", transport), WebFetchError);
  await assert.rejects(() => guardedFetch("http://metadata.internal/", transport), WebFetchError);
});

test("INV6: a redirect to a non-http scheme or an embedded-credential URL is refused (redirect re-enters the full guard)", async () => {
  const transport: WebFetchTransport = {
    async resolveHostIps() {
      return ["93.184.216.34"];
    },
    async fetchOnce({ url }) {
      if (url.hostname === "toscheme.example") {
        return { status: 302, location: "file:///etc/passwd", body: "", truncated: false };
      }
      if (url.hostname === "tocreds.example") {
        return { status: 302, location: "https://user:pass@internal.example/", body: "", truncated: false };
      }
      return { status: 200, contentType: "text/plain", body: "x", truncated: false };
    },
  };
  await assert.rejects(() => guardedFetch("http://toscheme.example/", transport), WebFetchError);
  await assert.rejects(() => guardedFetch("http://tocreds.example/", transport), WebFetchError);
});
