// Assistant Hub — hub-fixes WP2.3 (D-HF5): the grant-inheritance rule, `effectiveAgentGrants` (pure,
// `apps/api/src/hub/tools/grants.ts`). Table-driven — no DB, no model, no MCP session; this is the ONE
// documented rule for what a mission agent may actually touch (plan grants ∩ parent session scope),
// unit-tested in isolation before the orchestrator applies it at spawn (see `hub-missions.test.ts` for
// the spawn-time + negative test, and the propose-path catalog carry-forward).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubAgentRole, HubServerToolGrant, HubToolGrants } from "@mcp-token-footprint/shared";
import {
  effectiveAgentGrants,
  unionRosterServerGrantsIntoScope,
  unionServerGrant,
} from "../src/hub/tools/grants.js";

const grants = (over: Partial<HubToolGrants>): HubToolGrants => ({
  servers: {},
  builtins: [],
  ...over,
});

test("effectiveAgentGrants: a null parent (auto/unscoped) passes the plan grants through unchanged", () => {
  const plan = grants({ servers: { qlik: "all", files: ["read_file"] }, builtins: ["memory.save"] });
  const effective = effectiveAgentGrants(plan, null);
  assert.deepEqual(effective, plan, "unscoped parent ⇒ identity — nothing to bound against");
});

test('effectiveAgentGrants: "all" (plan) ∩ list (parent) = the parent\'s list', () => {
  const plan = grants({ servers: { qlik: "all" } });
  const parent = grants({ servers: { qlik: ["search", "list_apps"] } });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective.servers, { qlik: ["search", "list_apps"] });
});

test('effectiveAgentGrants: list (plan) ∩ "all" (parent) = the plan\'s own list', () => {
  const plan = grants({ servers: { qlik: ["search"] } });
  const parent = grants({ servers: { qlik: "all" } });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective.servers, { qlik: ["search"] });
});

test('effectiveAgentGrants: "all" ∩ "all" = "all"', () => {
  const plan = grants({ servers: { qlik: "all" } });
  const parent = grants({ servers: { qlik: "all" } });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective.servers, { qlik: "all" });
});

test("effectiveAgentGrants: list ∩ list = the SET INTERSECTION of tool names", () => {
  const plan = grants({ servers: { qlik: ["search", "list_apps", "get_measure"] } });
  const parent = grants({ servers: { qlik: ["search", "get_measure", "delete_app"] } });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(
    effective.servers.qlik,
    ["search", "get_measure"],
    "only tool names present in BOTH the plan and the parent scope survive, plan order preserved",
  );
});

test("effectiveAgentGrants: a server outside the parent's scope is DROPPED entirely (not an empty list)", () => {
  const plan = grants({ servers: { qlik: "all", files: ["read_file"] } });
  const parent = grants({ servers: { qlik: "all" } }); // no "files" entry at all
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective.servers, { qlik: "all" });
  assert.equal("files" in effective.servers, false, "dropped means ABSENT, never {files: []}");
});

test("effectiveAgentGrants: a server the plan never asked for stays absent regardless of parent scope", () => {
  const plan = grants({ servers: { qlik: "all" } });
  const parent = grants({ servers: { qlik: "all", files: "all" } }); // parent allows more than the plan wants
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective.servers, { qlik: "all" }, "intersection never GRANTS something the plan didn't ask for");
});

test("effectiveAgentGrants: builtins intersect like servers — set intersection when the parent restricts them", () => {
  const plan = grants({ builtins: ["memory.save", "artifacts.create", "tasks.add"] });
  const parent = grants({ builtins: ["memory.save", "tasks.add"] });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective.builtins, ["memory.save", "tasks.add"]);
});

test("effectiveAgentGrants: builtins — an EMPTY parent builtins list means unset, so the plan's own builtins pass through", () => {
  const plan = grants({ builtins: ["memory.save", "artifacts.create"] });
  const parent = grants({ builtins: [] });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(
    effective.builtins,
    ["memory.save", "artifacts.create"],
    "empty parent builtins ⇒ 'unset', mirroring resolveHubMcpGrants's RC3.5 convention — never bricks to zero",
  );
});

test("effectiveAgentGrants: a fully scoped-out plan (every server dropped) still returns a valid empty grants object", () => {
  const plan = grants({ servers: { ghost: "all" }, builtins: ["memory.save"] });
  const parent = grants({ servers: { qlik: "all" }, builtins: [] });
  const effective = effectiveAgentGrants(plan, parent);
  assert.deepEqual(effective, { servers: {}, builtins: ["memory.save"] });
});

// ── Crew nesting (WP2.3 / D-CN9) — TRANSITIVE composition down a nested crew path (L2 ∩ L1 ∩ L0) ───────

test("effectiveAgentGrants composes TRANSITIVELY: L2 ∩ (L1 ∩ L0) === the direct triple intersection", () => {
  // L0 = the root chat-session scope; L1 = a mid crew-ref's scope; L2 = a level-2 role's own Access.
  const L0 = grants({
    servers: { qlik: "all", files: ["read_file", "write_file"] },
    builtins: ["memory.save", "tasks.add"],
  });
  const L1 = grants({
    servers: { qlik: ["search", "list_apps"], files: "all", ghost: "all" },
    builtins: ["memory.save", "artifacts.create"],
  });
  const L2 = grants({
    servers: { qlik: "all", files: ["read_file"], other: "all" },
    builtins: ["memory.save", "tasks.add", "artifacts.create"],
  });

  // Composing DOWN the path (the orchestrator's threading: each nested level's parentScope is the already-
  // effective grants of the enclosing level) equals applying the associative intersection triple.
  const composed = effectiveAgentGrants(L2, effectiveAgentGrants(L1, L0));

  // The hand-computed L2 ∩ L1 ∩ L0:
  //  qlik  — L1 narrows to [search, list_apps]; L0="all" ⇒ kept; L2="all" ⇒ [search, list_apps].
  //  files — L1="all"; L0=[read_file, write_file]; L2=[read_file] ⇒ [read_file].
  //  ghost — L0 has no ghost ⇒ dropped at L1∩L0 ⇒ never reachable at L2.
  //  other — L1∩L0 has no other ⇒ L2's `other` is dropped (intersection never GRANTS).
  //  builtins — L0=[memory.save, tasks.add]; L1∩L0=[memory.save]; L2 ∩ [memory.save] = [memory.save].
  assert.deepEqual(composed, {
    servers: { qlik: ["search", "list_apps"], files: ["read_file"] },
    builtins: ["memory.save"],
  });
});

test("effectiveAgentGrants: a server/tool L1 dropped is NOT re-granted by an L2 plan (no re-widen — R6/D-CN9)", () => {
  const L0 = grants({ servers: { qlik: "all", files: "all" } });
  // L1 (the enclosing crew-ref) drops `files` ENTIRELY and narrows qlik down to [search].
  const l1l0 = effectiveAgentGrants(grants({ servers: { qlik: ["search"] } }), L0);
  assert.deepEqual(l1l0.servers, { qlik: ["search"] }, "L1 ∩ L0 already dropped files + narrowed qlik");

  // A level-2 plan RE-REQUESTS files:"all" and qlik:"all" — the transitive intersection can only NARROW.
  const composed = effectiveAgentGrants(grants({ servers: { qlik: "all", files: "all" } }), l1l0);
  assert.equal("files" in composed.servers, false, "files, dropped at L1, is never re-granted at L2");
  assert.deepEqual(composed.servers.qlik, ["search"], "qlik stays bounded to L1's [search], not re-widened to all");
});

test("effectiveAgentGrants: builtins compose transitively down the path (crew nesting WP2.3)", () => {
  const L0 = grants({ builtins: ["a", "b", "c"] });
  const L1 = grants({ builtins: ["b", "c", "d"] });
  const L2 = grants({ builtins: ["c", "d", "e"] });
  // L1 ∩ L0 builtins = [b, c]; L2 ∩ [b, c] = [c] — only a built-in present at EVERY level survives.
  const composed = effectiveAgentGrants(L2, effectiveAgentGrants(L1, L0));
  assert.deepEqual(composed.builtins, ["c"]);
});

// ── hub-fixes (Defect 1a) — the roster-scope UNION (the dual of effectiveAgentGrants' intersection) ────

test('unionServerGrant: "all" on either side wins', () => {
  assert.equal(unionServerGrant("all", ["search"]), "all");
  assert.equal(unionServerGrant(["search"], "all"), "all");
  assert.equal(unionServerGrant("all", "all"), "all");
});

test("unionServerGrant: list ∪ list = the SET UNION of tool names (a tool granted by EITHER survives)", () => {
  const merged = unionServerGrant(["search", "list_apps"], ["list_apps", "get_measure"]) as string[];
  assert.deepEqual([...merged].sort(), ["get_measure", "list_apps", "search"]);
});

function roleWithServers(id: string, servers: Record<string, HubServerToolGrant>): HubAgentRole {
  return {
    id,
    name: id,
    systemPrompt: "",
    defaultModel: "gpt-4o",
    toolGrants: { servers, builtins: [] },
    skills: [],
    target: "",
    expectedOutcome: "",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

test("unionRosterServerGrantsIntoScope: a role's server is unioned into an empty (scoped) session scope", () => {
  const scope = grants({ servers: {}, builtins: ["memory.propose_save"] });
  const unioned = unionRosterServerGrantsIntoScope(scope, [roleWithServers("r1", { qlik: "all" })]);
  assert.deepEqual(unioned.servers, { qlik: "all" }, "the Qlik server the role needs is now reachable");
  assert.deepEqual(unioned.builtins, ["memory.propose_save"], "built-ins are untouched");
});

test("unionRosterServerGrantsIntoScope: returns the SAME reference when the role adds nothing new", () => {
  const scope = grants({ servers: { qlik: "all" } });
  const unioned = unionRosterServerGrantsIntoScope(scope, [roleWithServers("r1", { qlik: "all" })]);
  assert.equal(unioned, scope, "no change ⇒ identity (so callers can compare by reference)");
});

test("unionRosterServerGrantsIntoScope: unions a role's allowlist with the scope's existing allowlist", () => {
  const scope = grants({ servers: { qlik: ["search"] } });
  const unioned = unionRosterServerGrantsIntoScope(scope, [roleWithServers("r1", { qlik: ["list_apps"] })]);
  assert.deepEqual(
    [...(unioned.servers.qlik as string[])].sort(),
    ["list_apps", "search"],
    "both the scope's and the role's tools survive",
  );
});
