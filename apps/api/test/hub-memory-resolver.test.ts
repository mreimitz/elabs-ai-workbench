// Assistant Hub UX (roadmap/assistant-hub-ux/, WP1.5, D-HUX11) — the PURE effective-memory resolver
// (`hub/memory-resolver.ts`'s `resolveEffectiveMemory`). No DB: exhaustively proves the injection ORDER
// (profile → project → crew → agent) and the CONFLICT rule (most-specific-wins, transparently shown),
// plus the excluded cases (archived/proposed rows, skipped layers) the acceptance calls out. The
// repository-backed builder + route payload are proved separately in `hub-memory-scopes.test.ts`.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubMemory, HubMemoryScope } from "@mcp-token-footprint/shared";
import {
  HUB_MEMORY_SCOPE_ORDER,
  type HubEffectiveMemoryLayerInput,
  resolveEffectiveMemory,
} from "../src/hub/memory-resolver.js";

let seq = 0;
function mem(overrides: Partial<HubMemory> & { content: string }): HubMemory {
  seq += 1;
  return {
    id: overrides.id ?? `m${seq}`,
    kind: overrides.kind ?? "preference",
    content: overrides.content,
    source: overrides.source ?? "user",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? `2026-07-18T00:00:${String(seq).padStart(2, "0")}.000Z`,
    updatedAt: overrides.updatedAt ?? "2026-07-18T00:00:00.000Z",
  };
}

function layer(
  scope: HubMemoryScope,
  scopeId: string | null,
  entries: HubMemory[],
  ownerName?: string,
): HubEffectiveMemoryLayerInput {
  return { scope, scopeId, entries, ...(ownerName ? { ownerName } : {}) };
}

// ── Injection order ────────────────────────────────────────────────────────────────────────────────

test("the specificity/injection order is profile → project → crew → agent (NOT the HUB_MEMORY_SCOPES declaration order)", () => {
  assert.deepEqual([...HUB_MEMORY_SCOPE_ORDER], ["profile", "project", "crew", "agent"]);
});

test("distinct entries inject in order profile → project → crew → agent, each tagged with its scope + owner", () => {
  const result = resolveEffectiveMemory([
    // Deliberately passed OUT of order — the resolver must sort, not trust input order.
    layer("agent", "role-1", [mem({ content: "Agent fact" })], "Researcher"),
    layer("profile", null, [mem({ content: "Profile fact" })]),
    layer("crew", "crew-1", [mem({ content: "Crew fact" })], "Alpha crew"),
    layer("project", "proj-1", [mem({ content: "Project fact" })], "Demo"),
  ]);

  assert.deepEqual(
    result.entries.map((e) => e.scope),
    ["profile", "project", "crew", "agent"],
  );
  assert.deepEqual(result.order, ["profile", "project", "crew", "agent"]);
  assert.equal(result.overridden.length, 0);
  assert.equal(result.totalActive, 4);

  const agent = result.entries.find((e) => e.scope === "agent");
  assert.equal(agent?.scopeId, "role-1");
  assert.equal(agent?.ownerName, "Researcher");
  const profile = result.entries.find((e) => e.scope === "profile");
  assert.equal(profile?.scopeId, null);
});

test("layers passed in reverse still resolve to the canonical injection order (order is resolver-owned)", () => {
  const reversed = resolveEffectiveMemory([
    layer("agent", "role-1", [mem({ content: "A" })]),
    layer("crew", "crew-1", [mem({ content: "C" })]),
    layer("project", "proj-1", [mem({ content: "P" })]),
    layer("profile", null, [mem({ content: "F" })]),
  ]);
  assert.deepEqual(reversed.order, ["profile", "project", "crew", "agent"]);
  assert.deepEqual(
    reversed.entries.map((e) => e.content),
    ["F", "P", "C", "A"],
  );
});

// ── Most-specific-wins conflict resolution ──────────────────────────────────────────────────────────

test("a two-scope conflict resolves to the MORE specific entry; the loser is recorded as overridden (not dropped)", () => {
  const profileRow = mem({ id: "p", content: "Use bullet points." });
  const agentRow = mem({ id: "a", content: "use  BULLET points." }); // same statement, normalized
  const result = resolveEffectiveMemory([
    layer("profile", null, [profileRow]),
    layer("agent", "role-1", [agentRow], "Researcher"),
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.id, "a"); // agent (most specific) wins
  assert.equal(result.entries[0]?.scope, "agent");

  assert.equal(result.overridden.length, 1);
  assert.equal(result.overridden[0]?.id, "p");
  assert.equal(result.overridden[0]?.scope, "profile");
  assert.equal(result.overridden[0]?.overriddenByScope, "agent");
  assert.equal(result.overridden[0]?.overriddenById, "a");
});

test("crew beats project; project beats profile (specificity ladder)", () => {
  const crewWins = resolveEffectiveMemory([
    layer("project", "proj-1", [mem({ id: "proj", content: "Ship weekly." })]),
    layer("crew", "crew-1", [mem({ id: "crew", content: "ship weekly." })]),
  ]);
  assert.equal(crewWins.entries[0]?.id, "crew");
  assert.equal(crewWins.overridden[0]?.id, "proj");

  const projectWins = resolveEffectiveMemory([
    layer("profile", null, [mem({ id: "prof", content: "Ship weekly." })]),
    layer("project", "proj-1", [mem({ id: "proj", content: "ship weekly." })]),
  ]);
  assert.equal(projectWins.entries[0]?.id, "proj");
  assert.equal(projectWins.overridden[0]?.id, "prof");
});

test("a full four-scope conflict chain: agent wins, profile+project+crew all overridden (in injection order)", () => {
  const result = resolveEffectiveMemory([
    layer("profile", null, [mem({ id: "prof", content: "Answer in German." })]),
    layer("project", "proj-1", [mem({ id: "proj", content: "answer in german." })]),
    layer("crew", "crew-1", [mem({ id: "crew", content: "Answer in  German." })]),
    layer("agent", "role-1", [mem({ id: "agent", content: "ANSWER IN GERMAN." })]),
  ]);
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ["agent"],
  );
  assert.deepEqual(
    result.overridden.map((e) => e.id),
    ["prof", "proj", "crew"],
  );
  for (const o of result.overridden) {
    assert.equal(o.overriddenByScope, "agent");
    assert.equal(o.overriddenById, "agent");
  }
});

test("non-conflicting entries at multiple scopes ALL survive (conflict is per statement, not per scope)", () => {
  const result = resolveEffectiveMemory([
    layer("profile", null, [mem({ content: "Likes concise prose." })]),
    layer("agent", "role-1", [mem({ content: "Owns the pricing table." })]),
  ]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.overridden.length, 0);
});

// ── Exclusions: archived / proposed rows never inject ────────────────────────────────────────────────

test("archived and proposed rows are excluded (neither injected nor listed as overridden)", () => {
  const result = resolveEffectiveMemory([
    layer("profile", null, [
      mem({ id: "active", content: "Active fact." }),
      mem({ id: "archived", content: "Old fact.", status: "archived" }),
      mem({ id: "proposed", content: "Maybe fact.", status: "proposed" }),
    ]),
  ]);
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ["active"],
  );
  assert.equal(result.overridden.length, 0);
});

test("an archived entry does NOT win a conflict against a real active one at a less specific scope", () => {
  // profile has an ACTIVE row; agent has only an ARCHIVED same-statement row → the active profile survives.
  const result = resolveEffectiveMemory([
    layer("profile", null, [mem({ id: "prof", content: "Use tabs." })]),
    layer("agent", "role-1", [mem({ id: "agentArchived", content: "use tabs.", status: "archived" })]),
  ]);
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ["prof"],
  );
  assert.equal(result.overridden.length, 0);
});

// ── Missing layers / old sessions ────────────────────────────────────────────────────────────────────

test("missing entities: a profile-only stack (an old/legacy session) returns just profile — order=[profile]", () => {
  const result = resolveEffectiveMemory([
    layer("profile", null, [mem({ content: "One" }), mem({ content: "Two" })]),
  ]);
  assert.deepEqual(result.order, ["profile"]);
  assert.equal(result.entries.length, 2);
  assert.ok(result.entries.every((e) => e.scope === "profile"));
  assert.equal(result.overridden.length, 0);
});

test("an empty stack resolves to an empty result (no layers at all)", () => {
  const result = resolveEffectiveMemory([]);
  assert.deepEqual(result.order, []);
  assert.equal(result.entries.length, 0);
  assert.equal(result.overridden.length, 0);
  assert.equal(result.totalActive, 0);
});

test("a present-but-empty scoped layer keeps its place in `order`/`layers` with zero counts", () => {
  const result = resolveEffectiveMemory([
    layer("profile", null, [mem({ content: "F" })]),
    layer("project", "proj-1", [], "Empty project"),
  ]);
  assert.deepEqual(result.order, ["profile", "project"]);
  const projectLayer = result.layers.find((l) => l.scope === "project");
  assert.equal(projectLayer?.activeCount, 0);
  assert.equal(projectLayer?.overriddenCount, 0);
  assert.equal(projectLayer?.ownerName, "Empty project");
});

// ── Per-layer summary + deterministic same-scope dedup ───────────────────────────────────────────────

test("layer summaries count survivors vs overridden per scope", () => {
  const result = resolveEffectiveMemory([
    layer("profile", null, [
      mem({ id: "p1", content: "Shared statement." }),
      mem({ id: "p2", content: "Profile-only statement." }),
    ]),
    layer("agent", "role-1", [mem({ id: "a1", content: "shared statement." })]),
  ]);
  const profileLayer = result.layers.find((l) => l.scope === "profile");
  const agentLayer = result.layers.find((l) => l.scope === "agent");
  assert.equal(profileLayer?.activeCount, 1); // only the profile-only statement survives
  assert.equal(profileLayer?.overriddenCount, 1); // the shared one is shadowed by agent
  assert.equal(agentLayer?.activeCount, 1);
  assert.equal(agentLayer?.overriddenCount, 0);
});

test("same-scope duplicate content dedups deterministically (newer createdAt wins), the older overridden by its own scope", () => {
  const older = mem({ id: "older", content: "Duplicate.", createdAt: "2026-07-18T00:00:01.000Z" });
  const newer = mem({ id: "newer", content: "duplicate.", createdAt: "2026-07-18T00:00:09.000Z" });
  const result = resolveEffectiveMemory([layer("profile", null, [older, newer])]);
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ["newer"],
  );
  assert.equal(result.overridden.length, 1);
  assert.equal(result.overridden[0]?.id, "older");
  assert.equal(result.overridden[0]?.overriddenByScope, "profile");
  assert.equal(result.overridden[0]?.overriddenById, "newer");
});
