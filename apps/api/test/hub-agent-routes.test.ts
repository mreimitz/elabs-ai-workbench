// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP2.1, §1.4 / D-AH7) — the role-library + saved-crew REST
// surface over a REAL `HubRepository`, mirroring `hub-artifact-routes.test.ts`'s harness (a real
// `HubSessionService` with no model ever invoked — agent/crew routes never touch the turn engine, so
// `resolveModel` is never called here).
//
// Proves (acceptance): create/list/get/patch/delete for both `hub_agents` and `hub_crews`; archive is a
// PATCH `{ archived: true }` that drops the role from the default list but keeps it under
// `?includeArchived=true`, and `{ archived: false }` restores it; 404s on an unknown id for every verb;
// a request body failing `hubAgentRoleInputSchema`/`hubCrewInputSchema` validation is rejected (400).
//
// WP1.7 (Assistant Hub UX, D-HUX8/P2) additionally proves: the optional `displayName` (role persona
// name) and `color` (crew `chart-1…5` accent) round-trip through create/get/list/patch, `null` on
// patch clears each back to its fallback (role title / no explicit accent), and an invalid `color`
// is rejected with 400 on both create and patch (loud validation, never silently coerced). Old-row
// (pre-existing NULL `display_name`/`color`) read-back coverage lives at the repository layer in
// `hub-repository.test.ts` alongside the rest of the CRUD round-trips.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubRepository } from "../src/hub/repository.js";
import { HubSessionService } from "../src/hub/session-service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { toErrorMessage } from "../src/utils/errors.js";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const harnesses: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-agent-routes-"));
  tempDirs.push(dir);
  return dir;
}

type Harness = { baseUrl: string; repo: HubRepository };

async function makeApp(): Promise<Harness> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: () => {
      throw new Error("agent/crew routes never resolve a model");
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo };
}

async function postJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function roleInput(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: "Research Analyst",
    systemPrompt: "You research topics thoroughly and cite every claim.",
    defaultModel: "claude-sonnet-4-5",
    target: "Investigate the assigned topic",
    expectedOutcome: "A structured HubAgentReport with findings + citations",
    ...overrides,
  };
}

async function createRole(
  h: Harness,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<HubAgentRole> {
  const res = await postJson(h, "/api/hub/agents", roleInput(overrides));
  assert.equal(res.status, 201);
  return (await res.json()) as HubAgentRole;
}

// ── Roles (hub_agents) ──────────────────────────────────────────────────────────────────────────────

test("POST /api/hub/agents creates a role; GET list/detail reflect it", async () => {
  const h = await makeApp();
  const role = await createRole(h, { name: "Research Analyst" });
  assert.equal(role.name, "Research Analyst");
  assert.deepEqual(role.toolGrants, { servers: {}, builtins: [] });
  assert.deepEqual(role.skills, []);
  assert.equal(role.archivedAt, null);

  const listRes = await fetch(`${h.baseUrl}/api/hub/agents`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as HubAgentRole[];
  assert.ok(list.some((r) => r.id === role.id));

  const getRes = await fetch(`${h.baseUrl}/api/hub/agents/${role.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(((await getRes.json()) as HubAgentRole).id, role.id);
});

test("POST /api/hub/agents carries the full D-AH7 definition through (grants, skills, budgets)", async () => {
  const h = await makeApp();
  const role = await createRole(h, {
    description: "Deep-dives a topic across the registered MCP tools.",
    icon: "search",
    toolGrants: { servers: { srv1: "all", srv2: ["fetch", "search"] }, builtins: ["files.read"] },
    skills: [
      { skillId: "skill-1", versionMode: "latest", invocationMode: "model_invocable" },
      { skillId: "skill-2", versionMode: "latest", invocationMode: "model_invocable" },
    ],
    budgets: { maxTurns: 10, maxCostUsd: 1.5 },
  });
  assert.equal(role.description, "Deep-dives a topic across the registered MCP tools.");
  assert.equal(role.icon, "search");
  assert.deepEqual(role.toolGrants, {
    servers: { srv1: "all", srv2: ["fetch", "search"] },
    builtins: ["files.read"],
  });
  assert.deepEqual(role.skills, [
    { skillId: "skill-1", versionMode: "latest", invocationMode: "model_invocable" },
    { skillId: "skill-2", versionMode: "latest", invocationMode: "model_invocable" },
  ]);
  assert.deepEqual(role.budgets, { maxTurns: 10, maxCostUsd: 1.5 });
});

test("POST /api/hub/agents 400s on a body failing hubAgentRoleInputSchema", async () => {
  const h = await makeApp();
  const res = await postJson(h, "/api/hub/agents", { name: "" }); // missing required fields too
  assert.equal(res.status, 400);
});

// WP1.7 (D-HUX8/P2) — the optional persona `displayName` round-trips through create/get/list/patch;
// `icon` (the existing field, unchanged) still carries the avatar — no new avatar field is added.
test("POST /api/hub/agents carries displayName through; PATCH updates + null clears it back to the fallback", async () => {
  const h = await makeApp();
  const noPersona = await createRole(h, { name: "Research Analyst" });
  assert.equal(noPersona.displayName, undefined, "omitted when not given");

  const role = await createRole(h, { name: "Research Analyst", displayName: "Ada", icon: "search" });
  assert.equal(role.displayName, "Ada");
  assert.equal(role.icon, "search", "avatar still reuses icon, not a new field");

  const getRes = await fetch(`${h.baseUrl}/api/hub/agents/${role.id}`);
  assert.equal(((await getRes.json()) as HubAgentRole).displayName, "Ada");

  const list = (await (await fetch(`${h.baseUrl}/api/hub/agents`)).json()) as HubAgentRole[];
  assert.ok(list.some((r) => r.id === role.id && r.displayName === "Ada"));

  const renamed = await patchJson(h, `/api/hub/agents/${role.id}`, { displayName: "Ada Lovelace" });
  assert.equal(((await renamed.json()) as HubAgentRole).displayName, "Ada Lovelace");

  const cleared = await patchJson(h, `/api/hub/agents/${role.id}`, { displayName: null });
  assert.equal(((await cleared.json()) as HubAgentRole).displayName, undefined);
});

test("PATCH /api/hub/agents/:id updates fields; archive drops from the default list, restore brings it back", async () => {
  const h = await makeApp();
  const role = await createRole(h);

  const renamed = await patchJson(h, `/api/hub/agents/${role.id}`, { name: "Senior Analyst" });
  assert.equal(renamed.status, 200);
  assert.equal(((await renamed.json()) as HubAgentRole).name, "Senior Analyst");

  const archived = await patchJson(h, `/api/hub/agents/${role.id}`, { archived: true });
  assert.equal(archived.status, 200);
  const archivedRole = (await archived.json()) as HubAgentRole;
  assert.ok(archivedRole.archivedAt);

  const defaultList = (await (await fetch(`${h.baseUrl}/api/hub/agents`)).json()) as HubAgentRole[];
  assert.ok(!defaultList.some((r) => r.id === role.id));

  const withArchived = (await (
    await fetch(`${h.baseUrl}/api/hub/agents?includeArchived=true`)
  ).json()) as HubAgentRole[];
  assert.ok(withArchived.some((r) => r.id === role.id));

  const restored = await patchJson(h, `/api/hub/agents/${role.id}`, { archived: false });
  assert.equal(restored.status, 200);
  assert.equal(((await restored.json()) as HubAgentRole).archivedAt, null);
  const restoredList = (await (
    await fetch(`${h.baseUrl}/api/hub/agents`)
  ).json()) as HubAgentRole[];
  assert.ok(restoredList.some((r) => r.id === role.id));
});

test("GET/PATCH/DELETE /api/hub/agents/:id 404 on an unknown id", async () => {
  const h = await makeApp();
  assert.equal((await fetch(`${h.baseUrl}/api/hub/agents/does-not-exist`)).status, 404);
  assert.equal((await patchJson(h, "/api/hub/agents/does-not-exist", { name: "X" })).status, 404);
  assert.equal(
    (await fetch(`${h.baseUrl}/api/hub/agents/does-not-exist`, { method: "DELETE" })).status,
    404,
  );
});

test("DELETE /api/hub/agents/:id hard-deletes the role", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const res = await fetch(`${h.baseUrl}/api/hub/agents/${role.id}`, { method: "DELETE" });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${h.baseUrl}/api/hub/agents/${role.id}`)).status, 404);
});

// ── Crews (hub_crews) ───────────────────────────────────────────────────────────────────────────────

async function createCrew(h: Harness, memberAgentId: string): Promise<HubCrew> {
  const res = await postJson(h, "/api/hub/crews", {
    name: "Research Team",
    topology: "parallel",
    members: [{ agentId: memberAgentId }],
  });
  assert.equal(res.status, 201);
  return (await res.json()) as HubCrew;
}

test("POST /api/hub/crews creates a crew referencing library roles; GET list/detail reflect it", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const crew = await createCrew(h, role.id);
  assert.equal(crew.name, "Research Team");
  assert.equal(crew.topology, "parallel");
  assert.equal(crew.members.length, 1);
  assert.equal(crew.members[0]?.agentId, role.id);

  const listRes = await fetch(`${h.baseUrl}/api/hub/crews`);
  assert.equal(listRes.status, 200);
  assert.ok(((await listRes.json()) as HubCrew[]).some((c) => c.id === crew.id));

  const getRes = await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(((await getRes.json()) as HubCrew).id, crew.id);
});

test("POST /api/hub/crews 400s on a body failing hubCrewInputSchema", async () => {
  const h = await makeApp();
  const res = await postJson(h, "/api/hub/crews", { name: "Team" }); // missing topology/members
  assert.equal(res.status, 400);
});

// WP1.7 (D-HUX8) — the optional theme-aware `color` accent round-trips through create/get/list/patch;
// `null` on patch clears it back to no explicit accent.
test("POST /api/hub/crews carries color through; PATCH updates + null clears it back", async () => {
  const h = await makeApp();
  const role = await createRole(h);

  const noAccent = await createCrew(h, role.id);
  assert.equal(noAccent.color, undefined, "omitted when not given");

  const res = await postJson(h, "/api/hub/crews", {
    name: "Ops Team",
    color: "chart-3",
    topology: "parallel",
    members: [{ agentId: role.id }],
  });
  assert.equal(res.status, 201);
  const crew = (await res.json()) as HubCrew;
  assert.equal(crew.color, "chart-3");

  const getRes = await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`);
  assert.equal(((await getRes.json()) as HubCrew).color, "chart-3");

  const list = (await (await fetch(`${h.baseUrl}/api/hub/crews`)).json()) as HubCrew[];
  assert.ok(list.some((c) => c.id === crew.id && c.color === "chart-3"));

  const recolored = await patchJson(h, `/api/hub/crews/${crew.id}`, { color: "chart-5" });
  assert.equal(((await recolored.json()) as HubCrew).color, "chart-5");

  const cleared = await patchJson(h, `/api/hub/crews/${crew.id}`, { color: null });
  assert.equal(((await cleared.json()) as HubCrew).color, undefined);
});

// Avatar icons (owner request) — the optional `icon` (same encoding as the role `icon`:
// `lucide:<name>` / a `data:` URI) round-trips through create/get/list/patch; `null` on patch clears
// it back to the default (member-strip / Persona fallback).
test("POST /api/hub/crews carries icon through; PATCH updates + null clears it back", async () => {
  const h = await makeApp();
  const role = await createRole(h);

  const noIcon = await createCrew(h, role.id);
  assert.equal(noIcon.icon, undefined, "omitted when not given");

  const res = await postJson(h, "/api/hub/crews", {
    name: "Icon Team",
    icon: "lucide:users",
    topology: "parallel",
    members: [{ agentId: role.id }],
  });
  assert.equal(res.status, 201);
  const crew = (await res.json()) as HubCrew;
  assert.equal(crew.icon, "lucide:users");

  const getRes = await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`);
  assert.equal(((await getRes.json()) as HubCrew).icon, "lucide:users");

  const list = (await (await fetch(`${h.baseUrl}/api/hub/crews`)).json()) as HubCrew[];
  assert.ok(list.some((c) => c.id === crew.id && c.icon === "lucide:users"));

  const reicon = await patchJson(h, `/api/hub/crews/${crew.id}`, { icon: "lucide:brain" });
  assert.equal(((await reicon.json()) as HubCrew).icon, "lucide:brain");

  const cleared = await patchJson(h, `/api/hub/crews/${crew.id}`, { icon: null });
  assert.equal(((await cleared.json()) as HubCrew).icon, undefined);
});

// WP1.7 (D-HUX8) — validation is loud: `color` is restricted to the 5-value admitted set
// (`HUB_CREW_COLORS`, chart-1..chart-5); anything else is rejected with 400, on both create and
// patch, never silently coerced or persisted.
test("color validation: an invalid crew color 400s on both create and patch", async () => {
  const h = await makeApp();
  const role = await createRole(h);

  const badCreate = await postJson(h, "/api/hub/crews", {
    name: "Bad Team",
    color: "crimson",
    topology: "parallel",
    members: [{ agentId: role.id }],
  });
  assert.equal(badCreate.status, 400);

  const chart6 = await postJson(h, "/api/hub/crews", {
    name: "Bad Team",
    color: "chart-6",
    topology: "parallel",
    members: [{ agentId: role.id }],
  });
  assert.equal(chart6.status, 400);

  const crew = await createCrew(h, role.id);
  const badPatch = await patchJson(h, `/api/hub/crews/${crew.id}`, { color: "not-a-color" });
  assert.equal(badPatch.status, 400);

  // Rejected writes never persist — the crew keeps reading back with no accent.
  const getRes = await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`);
  assert.equal(((await getRes.json()) as HubCrew).color, undefined);
});

test("PATCH /api/hub/crews/:id updates topology + members (per-member overrides survive)", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const crew = await createCrew(h, role.id);

  const res = await patchJson(h, `/api/hub/crews/${crew.id}`, {
    topology: "pipeline",
    members: [{ agentId: role.id, model: "gpt-4o", target: "Override target" }],
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as HubCrew;
  assert.equal(updated.topology, "pipeline");
  assert.equal(updated.members[0]?.model, "gpt-4o");
  assert.equal(updated.members[0]?.target, "Override target");
});

// Crew nesting (WP1.2, D-CN5) — a member may reference another crew's id (crewId) instead of an
// agentId, nesting a sub-crew; round-trips through create/list/get/patch exactly like an agentId
// member always has (`HubCrewMember` is typed against the WP0.1-widened shared schema — no new route
// behavior needed).
test("POST /api/hub/crews accepts a crewId member (nesting a sub-crew); GET list/detail reflect it", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const child = await createCrew(h, role.id);

  const res = await postJson(h, "/api/hub/crews", {
    name: "Parent Crew",
    topology: "parallel",
    members: [{ crewId: child.id }],
  });
  assert.equal(res.status, 201);
  const parent = (await res.json()) as HubCrew;
  assert.equal(parent.members.length, 1);
  assert.equal(parent.members[0]?.crewId, child.id);
  assert.equal(parent.members[0]?.agentId, undefined);

  const list = (await (await fetch(`${h.baseUrl}/api/hub/crews`)).json()) as HubCrew[];
  const listed = list.find((c) => c.id === parent.id);
  assert.equal(listed?.members[0]?.crewId, child.id);

  const getRes = await fetch(`${h.baseUrl}/api/hub/crews/${parent.id}`);
  const fetched = (await getRes.json()) as HubCrew;
  assert.equal(fetched.members[0]?.crewId, child.id);
});

test("PATCH /api/hub/crews/:id replacing members with a mixed agentId/crewId roster persists the nested reference", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const child = await createCrew(h, role.id);
  const parent = await createCrew(h, role.id); // starts with a single agentId member

  const res = await patchJson(h, `/api/hub/crews/${parent.id}`, {
    members: [{ agentId: role.id }, { crewId: child.id }],
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as HubCrew;
  assert.equal(updated.members.length, 2);
  assert.ok(updated.members.some((m) => m.crewId === child.id));
  assert.ok(updated.members.some((m) => m.agentId === role.id));
});

// Crew nesting (WP1.2, D-CN4) — the SAME author-time cycle guard WP1.1 wired into the repository
// choke point (`createCrew`/`updateCrew`) surfaces as a 400 (never a 500) through the generic
// `error.statusCode` handler path, mirroring the "color validation 400s on both create and patch"
// pattern above — no new error-mapping code needed here.
test("cyclic crew nesting: a crewId member closing a cycle 400s (not 500) on both create and patch", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const root = await createCrew(h, role.id); // root: 1 agentId member

  // A CREATE can only reference EXISTING crews, so it cannot itself close a cycle — but it uniformly
  // rejects a MISSING crewId with the same 400 (never a 500), proving the create path degrades safely.
  const missingCreate = await postJson(h, "/api/hub/crews", {
    name: "Ghost Crew",
    topology: "parallel",
    members: [{ crewId: "does-not-exist" }],
  });
  assert.equal(missingCreate.status, 400);

  // child references root (child → root) — a valid nested reference on its own.
  const childRes = await postJson(h, "/api/hub/crews", {
    name: "Child Crew",
    topology: "parallel",
    members: [{ crewId: root.id }],
  });
  assert.equal(childRes.status, 201);
  const child = (await childRes.json()) as HubCrew;

  // Now PATCH root to reference child — root → child → root closes a mutual cycle.
  const cyclicPatch = await patchJson(h, `/api/hub/crews/${root.id}`, {
    members: [{ crewId: child.id }],
  });
  assert.equal(cyclicPatch.status, 400, "a cyclic members replacement is a 400, not a 500");

  // Rejected writes never persist — root's members are unchanged.
  const getRes = await fetch(`${h.baseUrl}/api/hub/crews/${root.id}`);
  const persisted = (await getRes.json()) as HubCrew;
  assert.equal(persisted.members[0]?.agentId, role.id);
});

test("GET/PATCH/DELETE /api/hub/crews/:id 404 on an unknown id", async () => {
  const h = await makeApp();
  assert.equal((await fetch(`${h.baseUrl}/api/hub/crews/does-not-exist`)).status, 404);
  assert.equal((await patchJson(h, "/api/hub/crews/does-not-exist", { name: "X" })).status, 404);
  assert.equal(
    (await fetch(`${h.baseUrl}/api/hub/crews/does-not-exist`, { method: "DELETE" })).status,
    404,
  );
});

test("DELETE /api/hub/crews/:id hard-deletes the crew", async () => {
  const h = await makeApp();
  const role = await createRole(h);
  const crew = await createCrew(h, role.id);
  const res = await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`, { method: "DELETE" });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${h.baseUrl}/api/hub/crews/${crew.id}`)).status, 404);
});
