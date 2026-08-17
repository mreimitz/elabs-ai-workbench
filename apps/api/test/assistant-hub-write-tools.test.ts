// Assistant operability (roadmap/assistant-operability/, WP 5.1, D-AO7) — the Hub WRITE toolset
// (hub_agent_create/hub_agent_update/hub_crew_create/hub_crew_update), exercised DIRECTLY against a
// seeded fixture `HubRepository`: each tool's `.handler(args, {})` is called exactly as the SDK would
// call it — no SDK session, no MCP protocol round-trip (unit level, mirroring
// assistant-hub-read-tools.test.ts). Proves: create returns the compact entity WITH its id and
// persists it; the create → id → crew chain the owner's "Council + 5 agents" scenario needs; update
// mutates + returns; and invalid input (missing systemPrompt / unknown id) degrades to a SAFE isError
// result via safeTool, never an uncaught throw.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  buildHubWriteToolDefinitions,
  type HubWriteToolDeps,
} from "../src/assistant/tools/hub-write-tools.js";
import { HubRepository } from "../src/hub/repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** model-identity WP6.1 (F5) — the write tools now validate pins through the shared credential guard,
 *  so each fixture repo gets a `ProviderRepository` over the SAME connection (mirroring
 *  `assistant-hub-read-tools.test.ts`) rather than every call site guessing which db a repo belongs to. */
const providersByRepo = new WeakMap<HubRepository, ProviderRepository>();

/** The two credentials the F5 tests turn on: a usable one and an auth-broken one. Inserted directly —
 *  no key material is involved. (The third D-MI9 refusal reason, a non-hub-eligible KIND, has no
 *  reachable fixture today: every live `ProviderKind` is hub-eligible, so `assertHubModelKind` stands
 *  as the enforcement point for a future non-eligible kind rather than a currently-firing branch.) */
const PIN_OK = "prov-anthropic";
const PIN_BROKEN = "prov-broken";

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const at = "2026-07-27T00:00:00.000Z";
  const insert = db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(PIN_OK, "anthropic", "Anthropic", at, at);
  insert.run(PIN_BROKEN, "claude_subscription", "Anthropic CLI", at, at);
  const repo = new HubRepository(db);
  // No signed-in subscription resolver ⇒ the `claude_subscription` credential reads back auth-broken,
  // which is exactly the third refusal reason.
  providersByRepo.set(repo, new ProviderRepository(db, new SecretStore(crypto.randomBytes(32))));
  return repo;
}

function depsFor(repo: HubRepository): HubWriteToolDeps {
  const providers = providersByRepo.get(repo);
  if (!providers) throw new Error("no ProviderRepository registered for this HubRepository");
  return { hub: repo, providers };
}

/** Look up one tool definition by name from a deps bag's toolset (fails loudly if it's missing). */
function toolFor(deps: HubWriteToolDeps, name: string) {
  const def = buildHubWriteToolDefinitions(deps).find((d) => d.name === name);
  if (!def) throw new Error(`no tool registered named "${name}"`);
  return def;
}

/** Call a tool and return its raw CallToolResult (so a test can assert on `isError`). */
async function callRaw(
  deps: HubWriteToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const def = toolFor(deps, name);
  return def.handler(args as never, {});
}

/** Call a tool and parse its single JSON text content block (asserting it did NOT error). */
async function call<T = unknown>(
  deps: HubWriteToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await callRaw(deps, name, args);
  assert.equal(result.isError, undefined, `${name} unexpectedly errored`);
  const block = result.content[0] as { type: "text"; text: string };
  assert.equal(block.type, "text");
  return JSON.parse(block.text) as T;
}

const AGENT_ARGS = {
  name: "Researcher",
  systemPrompt: "You are a careful researcher.",
  defaultModel: "claude-opus-4-8",
  target: "Research a topic thoroughly.",
  expectedOutcome: "A cited findings report.",
};

// ── hub_agent_create ───────────────────────────────────────────────────────────────────────────────

test("hub_agent_create returns the created role WITH an id + persists it in the repository", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);

  const created = await call<{ id: string; name: string; defaultModel: string }>(
    deps,
    "hub_agent_create",
    {
      ...AGENT_ARGS,
      displayName: "Rex",
      icon: "lucide:search",
      toolGrants: { servers: { "srv-1": "all" }, builtins: ["artifacts.create"] },
      skills: [{ skillId: "skill-1" }],
      budgets: { maxCostUsd: 5 },
    },
  );

  assert.ok(created.id, "the created role echoes its id (for chaining into a crew)");
  assert.equal(created.name, "Researcher");
  assert.equal(created.defaultModel, "claude-opus-4-8");
  // The (potentially long) system prompt is compacted out of the echo (summarizeAgentRole).
  assert.equal("systemPrompt" in created, false);

  // Persisted: a fresh repository read returns the same role.
  const persisted = repo.getAgentRole(created.id);
  assert.equal(persisted.name, "Researcher");
  assert.equal(persisted.systemPrompt, "You are a careful researcher.");
  assert.equal(repo.listAgentRoles().length, 1);
});

test("hub_agent_create with a missing required field (systemPrompt) is a safe isError, not a throw", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);

  const result = await callRaw(deps, "hub_agent_create", {
    name: "Researcher",
    defaultModel: "claude-opus-4-8",
    target: "Research a topic thoroughly.",
    expectedOutcome: "A cited findings report.",
    // systemPrompt deliberately omitted → the shared schema's `.min(1)` requirement fails.
  });
  assert.equal(result.isError, true, "missing systemPrompt → validation error, safeTool-wrapped");
  // Nothing was persisted from an invalid create.
  assert.equal(repo.listAgentRoles().length, 0);
});

// ── hub_agent_update ─────────────────────────────────────────────────────────────────────────────

test("hub_agent_update mutates only the sent fields + returns the updated role", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const created = repo.createAgentRole(AGENT_ARGS);

  const updated = await call<{ id: string; name: string; defaultModel: string }>(
    deps,
    "hub_agent_update",
    { agentId: created.id, defaultModel: "gpt-5.5", displayName: "Rex v2" },
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.defaultModel, "gpt-5.5");
  assert.equal(updated.name, "Researcher", "unsent fields are unchanged");

  const persisted = repo.getAgentRole(created.id);
  assert.equal(persisted.defaultModel, "gpt-5.5");
  assert.equal(persisted.displayName, "Rex v2");
  assert.equal(persisted.systemPrompt, "You are a careful researcher.");
});

test("hub_agent_update on an unknown agentId is a safe isError (typed 404), not a throw", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const result = await callRaw(deps, "hub_agent_update", {
    agentId: "does-not-exist",
    displayName: "x",
  });
  assert.equal(result.isError, true);
});

// ── hub_crew_create + the create → id → crew chain ─────────────────────────────────────────────────

test("hub_crew_create references freshly-created agent ids — the owner's 'Council + N agents' chain", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);

  // 1. Create five agents through the WRITE TOOL, collecting each returned id (exactly what the agent
  //    does when asked to "create the crew and the agents").
  const agentIds: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const created = await call<{ id: string }>(deps, "hub_agent_create", {
      ...AGENT_ARGS,
      name: `Council Member ${i + 1}`,
    });
    agentIds.push(created.id);
  }
  assert.equal(new Set(agentIds).size, 5, "five distinct agent ids");

  // 2. Create the crew referencing those five ids.
  const crew = await call<{
    id: string;
    name: string;
    topology: string;
    memberCount: number;
    memberAgentIds: string[];
  }>(deps, "hub_crew_create", {
    name: "The Council",
    topology: "debate",
    members: agentIds.map((agentId) => ({ agentId })),
  });

  assert.ok(crew.id, "the created crew echoes its id");
  assert.equal(crew.name, "The Council");
  assert.equal(crew.topology, "debate");
  assert.equal(crew.memberCount, 5);
  assert.deepEqual(crew.memberAgentIds.slice().sort(), agentIds.slice().sort());

  // Persisted end-to-end.
  const persisted = repo.getCrew(crew.id);
  assert.equal(persisted.members.length, 5);
  assert.equal(repo.listAgentRoles().length, 5);
});

test("hub_crew_create with a missing required field (topology) is a safe isError, not a throw", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const agent = repo.createAgentRole(AGENT_ARGS);
  const result = await callRaw(deps, "hub_crew_create", {
    name: "Bad Crew",
    members: [{ agentId: agent.id }],
  });
  assert.equal(result.isError, true, "missing topology → validation error, safeTool-wrapped");
  assert.equal(repo.listCrews().length, 0);
});

// ── crew nesting (WP1.2, D-CN5) — hub_crew_create/hub_crew_update accept crewId members ───────────

test("hub_crew_create accepts a crewId member (nesting a sub-crew), persists it, and echoes memberCrewIds/memberCrewCount", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const agent = repo.createAgentRole(AGENT_ARGS);
  const child = repo.createCrew({
    name: "Child Crew",
    topology: "parallel",
    members: [{ agentId: agent.id }],
  });

  const parent = await call<{
    id: string;
    memberCrewIds: string[];
    memberAgentIds: string[];
    memberAgentCount: number;
    memberCrewCount: number;
  }>(deps, "hub_crew_create", {
    name: "Parent Crew",
    topology: "parallel",
    members: [{ crewId: child.id }],
  });

  assert.deepEqual(parent.memberCrewIds, [child.id]);
  assert.deepEqual(parent.memberAgentIds, []);
  assert.equal(parent.memberAgentCount, 0);
  assert.equal(parent.memberCrewCount, 1);

  // Persisted end-to-end: a fresh repository read (the same substrate hub_crews_list/GET
  // /api/hub/crews/:id read from) shows the crewId member intact, not silently stripped.
  const persisted = repo.getCrew(parent.id);
  assert.equal(persisted.members.length, 1);
  assert.equal(persisted.members[0]?.crewId, child.id);
  assert.equal(persisted.members[0]?.agentId, undefined);
});

test("hub_crew_create's response carries a recursively-computed totalAgentCount for a 2-level nesting fixture (C→B→2 agents ⇒ 2)", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const a1 = repo.createAgentRole({ ...AGENT_ARGS, name: "A1" });
  const a2 = repo.createAgentRole({ ...AGENT_ARGS, name: "A2" });

  // Crew B: 2 direct agent members.
  const crewB = await call<{ id: string; totalAgentCount?: number }>(deps, "hub_crew_create", {
    name: "Crew B",
    topology: "parallel",
    members: [{ agentId: a1.id }, { agentId: a2.id }],
  });
  assert.equal(crewB.totalAgentCount, 2, "B's own rollup: 2 direct agents, no nesting");

  // Crew C: a single crewId member nesting B (no direct agents of its own).
  const crewC = await call<{
    id: string;
    memberAgentCount: number;
    memberCrewCount: number;
    totalAgentCount?: number;
  }>(deps, "hub_crew_create", {
    name: "Crew C",
    topology: "parallel",
    members: [{ crewId: crewB.id }],
  });
  assert.equal(crewC.memberAgentCount, 0);
  assert.equal(crewC.memberCrewCount, 1);
  assert.equal(crewC.totalAgentCount, 2, "C's recursive rollup walks into B: 0 direct + B's 2 = 2");
});

test("a hub_crew_create whose members would create a cycle degrades cleanly (a create can only reference EXISTING crews, so over-depth/missing are the reachable rejections)", async () => {
  // Per the repository's own note (`repository.ts` createCrew): a CREATE can only reference crews
  // that already exist, so it cannot itself CLOSE a cycle — but the SAME author-time guard still
  // rejects a missing crewId cleanly (not a crash), proving the create path degrades safely too.
  const repo = openRepo();
  const deps = depsFor(repo);
  const result = await callRaw(deps, "hub_crew_create", {
    name: "Ghost Crew",
    topology: "parallel",
    members: [{ crewId: "does-not-exist" }],
  });
  assert.equal(result.isError, true, "a missing crewId is a safe isError, not a throw");
  const block = result.content[0] as { type: "text"; text: string };
  assert.match(block.text, /does not exist/i);
  assert.equal(repo.listCrews().length, 0, "the rejected crew was never persisted");
});

// ── hub_crew_update ──────────────────────────────────────────────────────────────────────────────

test("hub_crew_update mutates + returns the updated crew (members REPLACES the roster)", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const a1 = repo.createAgentRole({ ...AGENT_ARGS, name: "A1" });
  const a2 = repo.createAgentRole({ ...AGENT_ARGS, name: "A2" });
  const crew = repo.createCrew({
    name: "Crew",
    topology: "parallel",
    members: [{ agentId: a1.id }],
  });

  const updated = await call<{
    id: string;
    topology: string;
    memberCount: number;
    memberAgentIds: string[];
  }>(deps, "hub_crew_update", {
    crewId: crew.id,
    topology: "pipeline",
    members: [{ agentId: a1.id }, { agentId: a2.id }],
  });
  assert.equal(updated.id, crew.id);
  assert.equal(updated.topology, "pipeline");
  assert.equal(updated.memberCount, 2);
  assert.deepEqual(updated.memberAgentIds.slice().sort(), [a1.id, a2.id].sort());

  const persisted = repo.getCrew(crew.id);
  assert.equal(persisted.topology, "pipeline");
  assert.equal(persisted.members.length, 2);
});

test("hub_crew_update on an unknown crewId is a safe isError (typed 404), not a throw", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const result = await callRaw(deps, "hub_crew_update", {
    crewId: "does-not-exist",
    topology: "parallel",
  });
  assert.equal(result.isError, true);
});

// ── crew nesting (WP1.2, D-CN5) — hub_crew_update accepts a mixed agentId/crewId roster ───────────

test("hub_crew_update replacing members with a mix of agentId- and crewId-members succeeds; memberCrewIds lists exactly the crew-reference members", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const agent = repo.createAgentRole(AGENT_ARGS);
  const child = repo.createCrew({
    name: "Child Crew",
    topology: "parallel",
    members: [{ agentId: agent.id }],
  });
  const crew = repo.createCrew({ name: "Crew", topology: "parallel", members: [{ agentId: agent.id }] });

  const updated = await call<{
    memberCount: number;
    memberAgentIds: string[];
    memberCrewIds: string[];
    memberAgentCount: number;
    memberCrewCount: number;
    totalAgentCount?: number;
  }>(deps, "hub_crew_update", {
    crewId: crew.id,
    members: [{ agentId: agent.id }, { crewId: child.id }],
  });

  assert.equal(updated.memberCount, 2);
  assert.deepEqual(updated.memberAgentIds, [agent.id]);
  assert.deepEqual(updated.memberCrewIds, [child.id], "memberCrewIds lists exactly the crew-reference members");
  assert.equal(updated.memberAgentCount, 1);
  assert.equal(updated.memberCrewCount, 1);
  // Recursive rollup: crew's own agent (1) + child's rollup (1) = 2.
  assert.equal(updated.totalAgentCount, 2);

  const persisted = repo.getCrew(crew.id);
  assert.equal(persisted.members.length, 2);
});

test("a hub_crew_update whose members would create a cycle comes back as a clean isError naming the offending crew, not a throw", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const agent = repo.createAgentRole(AGENT_ARGS);
  const root = repo.createCrew({ name: "Root Crew", topology: "parallel", members: [{ agentId: agent.id }] });
  // Child references root (root → ... wait, direction is child → root): fine on its own (not cyclic).
  const child = repo.createCrew({ name: "Child Crew", topology: "parallel", members: [{ crewId: root.id }] });

  // Now update root to reference child — root → child → root closes a mutual cycle.
  const result = await callRaw(deps, "hub_crew_update", {
    crewId: root.id,
    members: [{ crewId: child.id }],
  });
  assert.equal(result.isError, true, "a cyclic members replacement is a safe isError, not a throw");
  const block = result.content[0] as { type: "text"; text: string };
  assert.match(block.text, /cycle/i);
  assert.match(block.text, /Root Crew/, "the error names the offending crew (Root Crew closes the cycle)");

  // The rejected patch never persisted — root's members are unchanged.
  const persisted = repo.getCrew(root.id);
  assert.deepEqual(persisted.members, [{ agentId: agent.id }]);
});

// ── model-identity WP6.1 (F5) — the dock write tools enforce the SAME D-MI9 guard as the routes ────
//
// These four tools call `HubRepository` DIRECTLY, so they bypassed the route guards entirely: an
// auth-broken pin was accepted silently and an unknown one died on the FK as a raw
// SQLITE_CONSTRAINT. New tests — a tool that never called the validator cannot be surfaced by mutating
// one. (A refusal reaches the model as a safe `isError`, `safeTool`'s contract, not an HTTP status.)

/** The text of a tool result's single content block. */
function textOf(result: CallToolResult): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

test("F5: hub_agent_create refuses an unusable pin for every reachable reason and persists nothing", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);

  for (const [pin, match] of [
    ["prov-does-not-exist", /no longer exists/],
    [PIN_BROKEN, /authentication is broken/],
  ] as const) {
    const result = await callRaw(deps, "hub_agent_create", {
      ...AGENT_ARGS,
      providerCredentialId: pin,
    });
    assert.equal(result.isError, true, `${pin} ⇒ a refusal, not a silent write`);
    assert.match(textOf(result), match, `${pin} ⇒ the same vocabulary the routes use`);
  }
  assert.equal(repo.listAgentRoles().length, 0, "nothing was persisted by a refused create");

  // A usable pin still writes — the guard refuses, it does not reject everything.
  const ok = await call<{ id: string }>(deps, "hub_agent_create", {
    ...AGENT_ARGS,
    providerCredentialId: PIN_OK,
  });
  assert.equal(repo.getAgentRole(ok.id).providerCredentialId, PIN_OK);
});

test("F5: hub_agent_update refuses an unusable re-pin and leaves the existing pin intact; null unpins", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const role = repo.createAgentRole({ ...AGENT_ARGS, providerCredentialId: PIN_OK });

  const refused = await callRaw(deps, "hub_agent_update", {
    agentId: role.id,
    providerCredentialId: PIN_BROKEN,
  });
  assert.equal(refused.isError, true);
  assert.equal(repo.getAgentRole(role.id).providerCredentialId, PIN_OK, "the pin is unchanged");

  // An explicit `null` is a deliberate unpin (D-MI1), never a 409 — the absent/null/id convention.
  await call(deps, "hub_agent_update", { agentId: role.id, providerCredentialId: null });
  assert.equal(repo.getAgentRole(role.id).providerCredentialId, null);

  // Absent ⇒ nothing validated: a rename must not become a credential check.
  await call(deps, "hub_agent_update", { agentId: role.id, name: "Renamed" });
  assert.equal(repo.getAgentRole(role.id).name, "Renamed");
});

test("F5: hub_crew_create / hub_crew_update refuse an unusable MEMBER pin (the fifth write binding)", async () => {
  const repo = openRepo();
  const deps = depsFor(repo);
  const agent = repo.createAgentRole(AGENT_ARGS);

  const refused = await callRaw(deps, "hub_crew_create", {
    name: "Crew",
    topology: "parallel",
    members: [{ agentId: agent.id, model: "gpt-4o", providerCredentialId: PIN_BROKEN }],
  });
  assert.equal(refused.isError, true, "an auth-broken member pin is refused, not accepted silently");
  assert.match(textOf(refused), /authentication is broken/);
  assert.equal(repo.listCrews().length, 0, "nothing was persisted");

  // An unknown member pin used to be accepted outright (no FK protects `members_json`).
  const unknown = await callRaw(deps, "hub_crew_create", {
    name: "Crew",
    topology: "parallel",
    members: [{ agentId: agent.id, providerCredentialId: "prov-nope" }],
  });
  assert.equal(unknown.isError, true);
  assert.match(textOf(unknown), /no longer exists/);

  // A usable one writes and round-trips; a members REPLACEMENT is then validated too.
  const crew = await call<{ id: string }>(deps, "hub_crew_create", {
    name: "Crew",
    topology: "parallel",
    members: [{ agentId: agent.id, providerCredentialId: PIN_OK }],
  });
  assert.equal(repo.getCrew(crew.id).members[0]?.providerCredentialId, PIN_OK);

  const badPatch = await callRaw(deps, "hub_crew_update", {
    crewId: crew.id,
    members: [{ agentId: agent.id, providerCredentialId: PIN_BROKEN }],
  });
  assert.equal(badPatch.isError, true);
  assert.equal(
    repo.getCrew(crew.id).members[0]?.providerCredentialId,
    PIN_OK,
    "the refused replacement never persisted",
  );
});

// ── inventory ────────────────────────────────────────────────────────────────────────────────────

test("buildHubWriteToolDefinitions registers exactly the four D-AO7 Hub write tools with real descriptions", () => {
  const repo = openRepo();
  const defs = buildHubWriteToolDefinitions(depsFor(repo));
  assert.deepEqual(
    defs.map((d) => d.name).sort(),
    ["hub_agent_create", "hub_agent_update", "hub_crew_create", "hub_crew_update"],
  );
  for (const def of defs) {
    assert.ok(def.description.length > 10, `${def.name} needs a real description`);
  }
});
