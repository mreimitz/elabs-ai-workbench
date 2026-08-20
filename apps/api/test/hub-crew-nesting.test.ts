// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP1.1, D-CN4/D-CN5/D-CN10) — the author-time integrity heart.
//
// Behavior lock for:
//   1. `crew-resolution.ts` is PURE (no repository/service import; operates over a plain `Map` + caps).
//   2. The AUTHOR-TIME, cycle-REJECTING guard (`assertCrewGraphValid`, wired into the repository's
//      `createCrew`/`updateCrew` choke point): loud `httpError(400)` on a self-cycle (A→A), a mutual
//      cycle (A→B→A), a missing `crewId`, and nesting at depth ≥ `maxCrewDepth`. `maxCrewDepth = 1`
//      (D-CN10 off-switch) rejects ANY `crewId` member; a `{agentId}`-only crew is accepted; a valid
//      2-level crew is accepted at `maxCrewDepth = 2`.
//   3. A members-LESS `updateCrew` patch (e.g. rename) runs NO member validation and succeeds even when
//      an unrelated crew has since changed (or been deleted out from under a nested reference).
//   4. The READ/instantiate-time, cycle-TOLERANT rollup (`resolveCrewRollup`): diamond correctness (a
//      shared sub-crew counted once per referencing path), termination on a deliberately cyclic Map
//      (bounded count, no loop/throw), and `capped: true` past `maxTotalAgents`.
//   5. `summarizeCrew`'s per-kind split (`memberCrewIds`/`memberAgentCount`/`memberCrewCount`,
//      optional `totalAgentCount`) with `memberCount`/`memberAgentIds` byte-identical for a legacy crew.
//   6. `hub_crews_list` surfaces each crew's `totalAgentCount`.
//
// The two cycle postures are load-bearing (WP1.1 note): `assertCrewGraphValid` THROWS on a cycle;
// `resolveCrewRollup` TOLERATES one. Both are exercised below over the SAME cyclic fixtures.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubCrew, HubCrewMember } from "@mcp-token-footprint/shared";
import {
  buildHubReadToolDefinitions,
  summarizeCrew,
} from "../src/assistant/tools/hub-read-tools.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  assertCrewGraphValid,
  resolveCrewRollup,
} from "../src/hub/missions/crew-resolution.js";
import { HubRepository } from "../src/hub/repository.js";

const NOW = "2026-07-26T00:00:00.000Z";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(caps?: { maxCrewDepth: number; maxTotalAgents: number }): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return caps ? new HubRepository(db, caps) : new HubRepository(db);
}

/** A plain in-memory crew (no repository) — the substrate the pure helpers walk. */
function crewOf(id: string, members: HubCrewMember[]): HubCrew {
  return { id, name: `Crew ${id}`, topology: "parallel", members, createdAt: NOW, updatedAt: NOW };
}

function mapOf(...crews: HubCrew[]): Map<string, HubCrew> {
  return new Map(crews.map((c) => [c.id, c] as const));
}

/** Assert `fn` throws a loud 400 `httpError` whose message matches `match`. */
function assert400(fn: () => void, match: RegExp): void {
  assert.throws(fn, (err: unknown) => {
    const e = err as { statusCode?: number; message?: string };
    assert.equal(e.statusCode, 400, "expected a 400 httpError, not a silent skip");
    assert.match(e.message ?? "", match);
    return true;
  });
}

// ── (1) crew-resolution.ts is PURE (no repository/service import) ───────────────────────────────────

test("crew-resolution.ts imports only shared types + httpError — no repository/service/db module", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/hub/missions/crew-resolution.ts", import.meta.url)),
    "utf8",
  );
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ["../../utils/errors.js", "@mcp-token-footprint/shared", "@mcp-token-footprint/shared"].sort(),
    "crew-resolution.ts must import ONLY shared + httpError (pure, repo-free)",
  );
  for (const spec of imports) {
    assert.doesNotMatch(spec ?? "", /repository|service|\/db\//, `forbidden import: ${spec}`);
  }
});

// ── (2) assertCrewGraphValid — the cycle-REJECTING author-time DFS (table-driven) ──────────────────

const REJECT_CASES: Array<{
  name: string;
  crews: HubCrew[];
  rootId: string;
  maxCrewDepth: number;
  match: RegExp;
}> = [
  {
    name: "self-reference A→A is a cycle",
    crews: [crewOf("A", [{ crewId: "A" }])],
    rootId: "A",
    maxCrewDepth: 2,
    match: /cycle/i,
  },
  {
    name: "mutual A→B→A is a cycle",
    crews: [crewOf("A", [{ crewId: "B" }]), crewOf("B", [{ crewId: "A" }])],
    rootId: "A",
    maxCrewDepth: 2,
    match: /cycle/i,
  },
  {
    name: "a crewId absent from the crew set is missing",
    crews: [crewOf("A", [{ crewId: "ghost" }])],
    rootId: "A",
    maxCrewDepth: 2,
    match: /does not exist/i,
  },
  {
    name: "reaching a node at depth ≥ maxCrewDepth(2) is over-depth (3-level chain)",
    crews: [
      crewOf("A", [{ crewId: "B" }]),
      crewOf("B", [{ crewId: "C" }]),
      crewOf("C", [{ agentId: "role-x" }]),
    ],
    rootId: "A",
    maxCrewDepth: 2,
    match: /exceeds the maximum depth of 2/i,
  },
  {
    name: "maxCrewDepth=1 rejects ANY crewId member (over-depth)",
    crews: [crewOf("A", [{ crewId: "B" }]), crewOf("B", [{ agentId: "role-x" }])],
    rootId: "A",
    maxCrewDepth: 1,
    match: /exceeds the maximum depth of 1/i,
  },
];

for (const c of REJECT_CASES) {
  test(`assertCrewGraphValid rejects: ${c.name}`, () => {
    assert400(
      () => assertCrewGraphValid({ rootId: c.rootId, crewsById: mapOf(...c.crews), maxCrewDepth: c.maxCrewDepth }),
      c.match,
    );
  });
}

const ACCEPT_CASES: Array<{ name: string; crews: HubCrew[]; rootId: string; maxCrewDepth: number }> = [
  {
    name: "a valid 2-level crew (root + one crewId child) at maxCrewDepth=2",
    crews: [crewOf("A", [{ crewId: "B" }]), crewOf("B", [{ agentId: "role-x" }])],
    rootId: "A",
    maxCrewDepth: 2,
  },
  {
    name: "an {agentId}-only crew at maxCrewDepth=1",
    crews: [crewOf("A", [{ agentId: "r1" }, { agentId: "r2" }])],
    rootId: "A",
    maxCrewDepth: 1,
  },
  {
    name: "a diamond (A→B→D, A→C→D) is NOT a cycle (accepted at maxCrewDepth=3)",
    crews: [
      crewOf("A", [{ crewId: "B" }, { crewId: "C" }]),
      crewOf("B", [{ crewId: "D" }]),
      crewOf("C", [{ crewId: "D" }]),
      crewOf("D", [{ agentId: "role-x" }]),
    ],
    rootId: "A",
    maxCrewDepth: 3,
  },
];

for (const c of ACCEPT_CASES) {
  test(`assertCrewGraphValid accepts: ${c.name}`, () => {
    assert.doesNotThrow(() =>
      assertCrewGraphValid({ rootId: c.rootId, crewsById: mapOf(...c.crews), maxCrewDepth: c.maxCrewDepth }),
    );
  });
}

// ── (2b) The repository CHOKE POINT actually calls the guard (createCrew + updateCrew) ─────────────

test("createCrew rejects a missing crewId member (loud 400 at the repository choke point)", () => {
  const repo = openRepo();
  assert400(
    () =>
      repo.createCrew({ name: "A", topology: "parallel", members: [{ crewId: "does-not-exist" }] }),
    /does not exist/i,
  );
  assert.equal(repo.listCrews().length, 0, "the rejected crew was never persisted");
});

test("createCrew rejects an over-depth chain at maxCrewDepth=2", () => {
  const repo = openRepo({ maxCrewDepth: 2, maxTotalAgents: 24 });
  const c = repo.createCrew({ name: "C", topology: "parallel", members: [{ agentId: "role-x" }] });
  const b = repo.createCrew({ name: "B", topology: "parallel", members: [{ crewId: c.id }] }); // depth 1 — ok
  assert400(
    () => repo.createCrew({ name: "A", topology: "parallel", members: [{ crewId: b.id }] }), // A→B→C = depth 2
    /exceeds the maximum depth of 2/i,
  );
});

test("createCrew: maxCrewDepth=1 rejects a crewId member but accepts an {agentId}-only crew", () => {
  const repo = openRepo({ maxCrewDepth: 1, maxTotalAgents: 24 });
  const leaf = repo.createCrew({ name: "leaf", topology: "parallel", members: [{ agentId: "role-x" }] });
  assert.equal(leaf.members.length, 1, "an {agentId}-only crew is accepted at maxCrewDepth=1");
  assert400(
    () => repo.createCrew({ name: "nester", topology: "parallel", members: [{ crewId: leaf.id }] }),
    /exceeds the maximum depth of 1/i,
  );
});

test("createCrew accepts a valid 2-level crew at maxCrewDepth=2", () => {
  const repo = openRepo({ maxCrewDepth: 2, maxTotalAgents: 24 });
  const child = repo.createCrew({ name: "child", topology: "parallel", members: [{ agentId: "role-x" }] });
  const parent = repo.createCrew({ name: "parent", topology: "parallel", members: [{ crewId: child.id }] });
  assert.deepEqual(
    parent.members.map((m) => m.crewId),
    [child.id],
    "the nested crewId round-trips (persisted, not silently stripped)",
  );
});

test("updateCrew rejects a self-cycle (A→A) introduced by a members patch", () => {
  const repo = openRepo();
  const a = repo.createCrew({ name: "A", topology: "parallel", members: [{ agentId: "role-x" }] });
  assert400(() => repo.updateCrew(a.id, { members: [{ crewId: a.id }] }), /cycle/i);
});

test("updateCrew rejects a mutual cycle (A→B→A) introduced by a members patch", () => {
  const repo = openRepo();
  const a = repo.createCrew({ name: "A", topology: "parallel", members: [{ agentId: "role-x" }] });
  const b = repo.createCrew({ name: "B", topology: "parallel", members: [{ crewId: a.id }] }); // B→A — fine
  assert400(() => repo.updateCrew(a.id, { members: [{ crewId: b.id }] }), /cycle/i); // now A→B→A
});

// ── (3) A members-LESS patch runs NO member validation ────────────────────────────────────────────

test("updateCrew with a members-less (rename) patch skips validation, even with a now-dangling nested ref", () => {
  const repo = openRepo({ maxCrewDepth: 2, maxTotalAgents: 24 });
  const child = repo.createCrew({ name: "child", topology: "parallel", members: [{ agentId: "role-x" }] });
  const parent = repo.createCrew({ name: "parent", topology: "parallel", members: [{ crewId: child.id }] });
  // Pull the referenced crew out from under `parent`: its members_json now points at a missing crew.
  repo.deleteCrew(child.id);
  // A rename touches no members → NO graph re-check → succeeds despite the dangling reference.
  const renamed = repo.updateCrew(parent.id, { name: "parent-renamed" });
  assert.equal(renamed.name, "parent-renamed");
  assert.deepEqual(renamed.members.map((m) => m.crewId), [child.id], "members left untouched");
  // Sanity: a MEMBERS patch to the same dangling reference WOULD now be rejected.
  assert400(() => repo.updateCrew(parent.id, { members: [{ crewId: child.id }] }), /does not exist/i);
});

// ── (4) resolveCrewRollup — cycle-TOLERANT recursive rollup ────────────────────────────────────────

test("resolveCrewRollup: a diamond counts the shared sub-crew ONCE PER referencing path", () => {
  // A→B→D, A→C→D; D has 1 agent. Each of B and C instantiates its own copy of D → total 2.
  const map = mapOf(
    crewOf("A", [{ crewId: "B" }, { crewId: "C" }]),
    crewOf("B", [{ crewId: "D" }]),
    crewOf("C", [{ crewId: "D" }]),
    crewOf("D", [{ agentId: "role-x" }]),
  );
  const out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map });
  assert.equal(out.totalAgentCount, 2, "D counted once via B and once via C");
  assert.equal(out.capped, false);
});

test("resolveCrewRollup: a direct agent + nested crew sum (no cycle)", () => {
  // A: 2 agents + crewId B; B: 3 agents → 2 + 3 = 5.
  const map = mapOf(
    crewOf("A", [{ agentId: "a1" }, { agentId: "a2" }, { crewId: "B" }]),
    crewOf("B", [{ agentId: "b1" }, { agentId: "b2" }, { agentId: "b3" }]),
  );
  const out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map });
  assert.equal(out.totalAgentCount, 5);
  assert.equal(out.capped, false);
});

test("resolveCrewRollup TERMINATES on a mutual cycle (A↔B) — bounded count, no throw/loop", () => {
  const map = mapOf(
    crewOf("A", [{ agentId: "a1" }, { crewId: "B" }]),
    crewOf("B", [{ agentId: "b1" }, { crewId: "A" }]),
  );
  let out: { totalAgentCount: number; capped: boolean } | undefined;
  assert.doesNotThrow(() => {
    out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map });
  });
  // A's agent (1) + B's agent (1); the B→A re-entry edge is skipped (tolerated).
  assert.equal(out?.totalAgentCount, 2, "cycle re-entry skipped → bounded count");
  assert.equal(out?.capped, false);
});

test("resolveCrewRollup TERMINATES on a self-cycle (A→A) — skips its own re-entry edge", () => {
  const map = mapOf(crewOf("A", [{ agentId: "a1" }, { crewId: "A" }]));
  const out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map });
  assert.equal(out.totalAgentCount, 1);
  assert.equal(out.capped, false);
});

test("resolveCrewRollup: a missing nested crewId is skipped (count concern, not existence)", () => {
  const map = mapOf(crewOf("A", [{ agentId: "a1" }, { crewId: "ghost" }]));
  const out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map });
  assert.equal(out.totalAgentCount, 1);
  assert.equal(out.capped, false);
});

test("resolveCrewRollup: capped=true once the running total exceeds maxTotalAgents", () => {
  const map = mapOf(
    crewOf("A", [
      { agentId: "a1" },
      { agentId: "a2" },
      { agentId: "a3" },
      { agentId: "a4" },
      { agentId: "a5" },
    ]),
  );
  const out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map, maxTotalAgents: 3 });
  assert.equal(out.capped, true, "5 agent slots > cap of 3 → capped");
  assert.equal(out.totalAgentCount, 3, "clamped to the ceiling");
});

test("resolveCrewRollup: defaults maxTotalAgents to the shared constant (24) when omitted", () => {
  // 10 agents is well under HUB_MISSION_MAX_TOTAL_AGENTS (24) → not capped.
  const members = Array.from({ length: 10 }, (_, i) => ({ agentId: `a${i}` }));
  const map = mapOf(crewOf("A", members));
  const out = resolveCrewRollup({ crew: map.get("A")!, crewsById: map });
  assert.equal(out.totalAgentCount, 10);
  assert.equal(out.capped, false);
});

// ── (5) summarizeCrew — per-kind split + legacy byte-identity ──────────────────────────────────────

test("summarizeCrew: per-kind counts on a MIXED crew; totalAgentCount only when passed", () => {
  const crew = crewOf("A", [{ agentId: "r1" }, { agentId: "r2" }, { crewId: "child" }]);

  const bare = summarizeCrew(crew);
  assert.equal(bare.memberCount, 3, "all members (agents + nested crews)");
  assert.deepEqual(bare.memberAgentIds, ["r1", "r2"]);
  assert.deepEqual(bare.memberCrewIds, ["child"]);
  assert.equal(bare.memberAgentCount, 2);
  assert.equal(bare.memberCrewCount, 1);
  assert.equal("totalAgentCount" in bare, false, "totalAgentCount absent when no opts passed");

  const withTotal = summarizeCrew(crew, { totalAgentCount: 7 });
  assert.equal(withTotal.totalAgentCount, 7, "totalAgentCount spread when provided");
});

test("summarizeCrew: a legacy {agentId}-only crew keeps memberCount/memberAgentIds byte-identical; crew kind is empty", () => {
  const crew = crewOf("legacy", [{ agentId: "r1" }, { agentId: "r2" }]);
  const out = summarizeCrew(crew);
  // Byte-identical to the pre-WP1.1 output for these two fields.
  assert.equal(out.memberCount, 2);
  assert.deepEqual(out.memberAgentIds, crew.members.map((m) => m.agentId));
  // New per-kind fields: no nested crews.
  assert.deepEqual(out.memberCrewIds, []);
  assert.equal(out.memberCrewCount, 0);
  assert.equal(out.memberAgentCount, 2);
});

// ── (6) hub_crews_list exposes each crew's totalAgentCount ─────────────────────────────────────────

async function callHubCrewsList(repo: HubRepository) {
  const def = buildHubReadToolDefinitions({ hub: repo }).find((d) => d.name === "hub_crews_list");
  if (!def) throw new Error("hub_crews_list not registered");
  const result = await def.handler({} as never, {});
  assert.equal(result.isError, undefined, "hub_crews_list errored unexpectedly");
  const block = result.content[0] as { type: "text"; text: string };
  return JSON.parse(block.text) as { crews: Array<Record<string, unknown>>; total: number };
}

test("hub_crews_list returns totalAgentCount for each crew (flat + nested)", async () => {
  const repo = openRepo({ maxCrewDepth: 2, maxTotalAgents: 24 });
  const child = repo.createCrew({
    name: "child",
    topology: "parallel",
    members: [{ agentId: "r1" }, { agentId: "r2" }],
  });
  const parent = repo.createCrew({
    name: "parent",
    topology: "parallel",
    members: [{ agentId: "r3" }, { crewId: child.id }],
  });

  const out = await callHubCrewsList(repo);
  assert.equal(out.total, 2);
  const byId = new Map(out.crews.map((c) => [c.id as string, c]));
  assert.equal(byId.get(child.id)?.totalAgentCount, 2, "flat crew → 2 agents");
  // parent: its own agent r3 (1) + child's rollup (2) = 3.
  assert.equal(byId.get(parent.id)?.totalAgentCount, 3, "nested crew → recursive total");
  assert.equal(byId.get(parent.id)?.memberCrewCount, 1);
  assert.equal(byId.get(parent.id)?.memberAgentCount, 1);
});
