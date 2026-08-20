// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP1.5, D-HUX11) — scoped memory CRUD + the entity guard +
// the repository-backed effective-stack builder + the additive `effectiveMemory` on the session context
// payload + the scoped proposal flow. The PURE ordering/conflict logic is proved in
// `hub-memory-resolver.test.ts`; this file proves the wiring over a REAL migrated DB (v49) and the real
// route. No model is ever invoked (memory + context routes never touch the turn engine).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { HubAgentRole, HubMemory } from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { buildSessionEffectiveMemory } from "../src/hub/memory-resolver.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService } from "../src/hub/session-service.js";
import { memoryProposeSave } from "../src/hub/tools/builtins/memory.js";
import type { HubToolExecutionContext } from "../src/hub/tools/types.js";
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

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

function statusCodeOf(err: unknown): number | undefined {
  return (err as { statusCode?: number }).statusCode;
}

function makeRole(repo: HubRepository, name = "Researcher"): HubAgentRole {
  return repo.createAgentRole({
    name,
    systemPrompt: "You research.",
    defaultModel: "test-model",
    target: "the web",
    expectedOutcome: "a cited answer",
  });
}

// ── Repository: scoped create + the entity guard ─────────────────────────────────────────────────────

test("createMemory defaults to profile scope with a null scopeId (a pre-scope write is unchanged)", () => {
  const repo = openRepo();
  const memory = repo.createMemory({ kind: "preference", content: "Prefers concise answers." });
  assert.equal(memory.scope, "profile");
  assert.equal(memory.scopeId, null);
});

test("createMemory persists a project/crew/agent scope + scopeId when the owning entity exists", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo" });
  const crew = repo.createCrew({ name: "Alpha", topology: "parallel", members: [] });
  const role = makeRole(repo);

  const p = repo.createMemory({ kind: "instruction", content: "Ship weekly.", scope: "project", scopeId: project.id });
  assert.equal(p.scope, "project");
  assert.equal(p.scopeId, project.id);
  const c = repo.createMemory({ kind: "preference", content: "Debate first.", scope: "crew", scopeId: crew.id });
  assert.equal(c.scope, "crew");
  assert.equal(c.scopeId, crew.id);
  const a = repo.createMemory({ kind: "instruction", content: "Cite sources.", scope: "agent", scopeId: role.id });
  assert.equal(a.scope, "agent");
  assert.equal(a.scopeId, role.id);
});

test("the entity guard rejects: a scoped write with no scopeId (400), an unknown owner (404), and a profile write carrying a scopeId (400)", () => {
  const repo = openRepo();
  // scoped, but no scopeId
  assert.throws(
    () => repo.createMemory({ kind: "preference", content: "x", scope: "project" }),
    (e) => statusCodeOf(e) === 400,
  );
  // scoped at a phantom owner
  assert.throws(
    () => repo.createMemory({ kind: "preference", content: "x", scope: "agent", scopeId: "role-does-not-exist" }),
    (e) => statusCodeOf(e) === 404,
  );
  // profile scope must NOT carry an owner
  assert.throws(
    () => repo.createMemory({ kind: "preference", content: "x", scope: "profile", scopeId: "anything" }),
    (e) => statusCodeOf(e) === 400,
  );
});

test("listMemory filters by scope + scopeId; an omitted scope still returns every scope (turn-engine/inspector path unchanged)", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo" });
  repo.createMemory({ kind: "preference", content: "Global." });
  repo.createMemory({ kind: "instruction", content: "Project-only.", scope: "project", scopeId: project.id });

  assert.equal(repo.listMemory({ status: "active" }).length, 2); // all scopes
  const profileOnly = repo.listMemory({ status: "active", scope: "profile" });
  assert.equal(profileOnly.length, 1);
  assert.equal(profileOnly[0]?.content, "Global.");
  const projectOnly = repo.listMemory({ status: "active", scope: "project", scopeId: project.id });
  assert.equal(projectOnly.length, 1);
  assert.equal(projectOnly[0]?.content, "Project-only.");
});

// ── Repository-backed builder over a real session ────────────────────────────────────────────────────

test("buildSessionEffectiveMemory stacks profile + project for a project session, tagged with the project name", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo Project" });
  repo.createMemory({ kind: "preference", content: "Likes concise prose." });
  repo.createMemory({ kind: "instruction", content: "Ship on Fridays.", scope: "project", scopeId: project.id });
  const session = repo.createSession({ mode: "chat", model: "test-model", projectId: project.id });

  const effective = buildSessionEffectiveMemory(repo, session.id);
  assert.deepEqual(effective.order, ["profile", "project"]);
  assert.equal(effective.entries.length, 2);
  const projectEntry = effective.entries.find((e) => e.scope === "project");
  assert.equal(projectEntry?.ownerName, "Demo Project");
  assert.equal(projectEntry?.scopeId, project.id);
});

test("buildSessionEffectiveMemory adds a crew layer from the session's crewId", () => {
  const repo = openRepo();
  const crew = repo.createCrew({ name: "Alpha crew", topology: "parallel", members: [] });
  repo.createMemory({ kind: "preference", content: "Crew rule.", scope: "crew", scopeId: crew.id });
  const session = repo.createSession({ mode: "mission", model: "test-model", crewId: crew.id });

  const effective = buildSessionEffectiveMemory(repo, session.id);
  assert.deepEqual(effective.order, ["profile", "crew"]);
  const crewEntry = effective.entries.find((e) => e.scope === "crew");
  assert.equal(crewEntry?.ownerName, "Alpha crew");
});

test("buildSessionEffectiveMemory applies most-specific-wins over real rows (project shadows a conflicting profile row)", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo" });
  repo.createMemory({ kind: "instruction", content: "Answer in German." });
  repo.createMemory({ kind: "instruction", content: "answer in german.", scope: "project", scopeId: project.id });
  const session = repo.createSession({ mode: "chat", model: "test-model", projectId: project.id });

  const effective = buildSessionEffectiveMemory(repo, session.id);
  assert.equal(effective.entries.length, 1);
  assert.equal(effective.entries[0]?.scope, "project");
  assert.equal(effective.overridden.length, 1);
  assert.equal(effective.overridden[0]?.scope, "profile");
  assert.equal(effective.overridden[0]?.overriddenByScope, "project");
});

test("deleting a session's project drops the project layer without throwing (ON DELETE SET NULL cascade)", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Doomed" });
  repo.createMemory({ kind: "preference", content: "Global." });
  const session = repo.createSession({ mode: "chat", model: "test-model", projectId: project.id });
  // hub_sessions.project_id is ON DELETE SET NULL — deleting the project nulls the link, so the builder
  // sees no projectId and adds no project layer. (The `tryOwnerName` skip is the belt-and-suspenders
  // guard for a truly dangling id the schema can't produce here.)
  repo.deleteProject(project.id);

  const effective = buildSessionEffectiveMemory(repo, session.id);
  assert.deepEqual(effective.order, ["profile"]);
  assert.equal(effective.entries.length, 1);
});

test("an agent-kind mission child resolves its role via the mission plan → an agent layer appears", () => {
  const repo = openRepo();
  const role = makeRole(repo, "Analyst");
  repo.createMemory({ kind: "instruction", content: "Always double-check figures.", scope: "agent", scopeId: role.id });
  repo.createMemory({ kind: "preference", content: "Global profile fact." });

  const parent = repo.createSession({ mode: "mission", model: "test-model" });
  const mission = repo.createMission({
    sessionId: parent.id,
    topology: "parallel",
    autonomy: "auto",
    plan: {
      topology: "parallel",
      autonomy: "auto",
      agents: [
        {
          key: "a1",
          roleId: role.id,
          name: "Analyst",
          systemPrompt: "Analyze.",
          model: "test-model",
          toolGrants: { servers: {}, builtins: [] },
          skillIds: [],
          brief: "Analyze the numbers.",
          target: "the dataset",
          expectedOutcome: "a checked summary",
        },
      ],
    },
  });
  const child = repo.createSession({
    mode: "chat",
    model: "test-model",
    kind: "agent",
    parentSessionId: parent.id,
    missionId: mission.id,
  });
  repo.updateMission(mission.id, { agentSessionIds: [child.id] });

  const effective = buildSessionEffectiveMemory(repo, child.id);
  assert.deepEqual(effective.order, ["profile", "agent"]);
  const agentEntry = effective.entries.find((e) => e.scope === "agent");
  assert.equal(agentEntry?.scopeId, role.id);
  assert.equal(agentEntry?.ownerName, "Analyst");
});

test("old session (no scoped memory at all) resolves to a profile-only stack — unaffected", () => {
  const repo = openRepo();
  repo.createMemory({ kind: "preference", content: "A" });
  repo.createMemory({ kind: "instruction", content: "B" });
  const session = repo.createSession({ mode: "chat", model: "test-model" });

  const effective = buildSessionEffectiveMemory(repo, session.id);
  assert.deepEqual(effective.order, ["profile"]);
  assert.equal(effective.entries.length, 2);
  assert.equal(effective.overridden.length, 0);
});

// ── The scoped proposal built-in (proposal flow gains a scope) ───────────────────────────────────────

test("memory.propose_save carries a scope through to the row + the memory_proposed event", async () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo" });
  const session = repo.createSession({ mode: "chat", model: "test-model" });

  await memoryProposeSave.execute(
    { kind: "instruction", content: "Track the Q3 rollout.", scope: "project", scopeId: project.id },
    { repository: repo, sessionId: session.id } as unknown as HubToolExecutionContext,
  );

  const proposed = repo.listMemory({ status: "proposed", scope: "project", scopeId: project.id });
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0]?.source, "assistant_proposed");

  const event = repo.listEvents(session.id).find((e) => e.type === "memory_proposed");
  assert.ok(event);
  assert.equal(event?.type === "memory_proposed" && event.scope, "project");
  assert.equal(event?.type === "memory_proposed" && event.scopeId, project.id);
});

test("memory.propose_save without a scope stays global profile memory (unchanged)", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "chat", model: "test-model" });
  const result = await memoryProposeSave.execute(
    { kind: "preference", content: "Prefers bullet points." },
    { repository: repo, sessionId: session.id } as unknown as HubToolExecutionContext,
  );
  const memoryId = (result.modelContent as { memoryId: string }).memoryId;
  const memory = repo.getMemory(memoryId);
  assert.equal(memory.scope, "profile");
  assert.equal(memory.scopeId, null);
});

// ── Routes: scoped POST + the context payload's effectiveMemory ──────────────────────────────────────

type Harness = { baseUrl: string; repo: HubRepository };

async function makeApp(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const repo = new HubRepository(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-memory-scopes-"));
  tempDirs.push(dir);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: () => {
      throw new Error("memory/context routes never resolve a model");
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: dir,
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

test("POST /api/hub/memory accepts a scoped write and echoes scope/scopeId; a bad owner 404s; a profile+scopeId 400s", async () => {
  const h = await makeApp();
  const project = h.repo.createProject({ name: "Demo" });

  const ok = await fetch(`${h.baseUrl}/api/hub/memory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "instruction", content: "Ship weekly.", scope: "project", scopeId: project.id }),
  });
  assert.equal(ok.status, 201);
  const created = (await ok.json()) as HubMemory;
  assert.equal(created.scope, "project");
  assert.equal(created.scopeId, project.id);

  const badOwner = await fetch(`${h.baseUrl}/api/hub/memory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "instruction", content: "x", scope: "crew", scopeId: "crew-nope" }),
  });
  assert.equal(badOwner.status, 404);

  const profileWithOwner = await fetch(`${h.baseUrl}/api/hub/memory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "preference", content: "x", scope: "profile", scopeId: project.id }),
  });
  assert.equal(profileWithOwner.status, 400);
});

test("GET /api/hub/sessions/:id/context exposes the effectiveMemory stack (profile → project, most-specific-wins)", async () => {
  const h = await makeApp();
  const project = h.repo.createProject({ name: "Demo Project" });
  h.repo.createMemory({ kind: "instruction", content: "Answer in German." });
  h.repo.createMemory({ kind: "instruction", content: "answer in german.", scope: "project", scopeId: project.id });
  h.repo.createMemory({ kind: "preference", content: "Likes concise prose." });
  const session = h.repo.createSession({ mode: "chat", model: "claude-opus-4-8", projectId: project.id });

  const res = await fetch(`${h.baseUrl}/api/hub/sessions/${session.id}/context`);
  assert.equal(res.status, 200);
  const payload = (await res.json()) as {
    effectiveMemory: {
      order: string[];
      entries: { scope: string; content: string }[];
      overridden: { scope: string; overriddenByScope: string }[];
    };
  };
  assert.deepEqual(payload.effectiveMemory.order, ["profile", "project"]);
  // "Answer in German." conflicts across profile+project → project wins; "Likes concise prose." survives.
  const contents = payload.effectiveMemory.entries.map((e) => e.content).sort();
  assert.deepEqual(contents, ["Likes concise prose.", "answer in german."]);
  assert.equal(payload.effectiveMemory.overridden.length, 1);
  assert.equal(payload.effectiveMemory.overridden[0]?.overriddenByScope, "project");
});

test("PATCH .../memory/:id?sessionId= accept flow stamps the saved row's scope onto the memory_saved event", async () => {
  const h = await makeApp();
  const project = h.repo.createProject({ name: "Demo" });
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  const proposed = h.repo.createMemory({
    kind: "instruction",
    content: "Track the rollout.",
    source: "assistant_proposed",
    scope: "project",
    scopeId: project.id,
  });

  const res = await fetch(`${h.baseUrl}/api/hub/memory/${proposed.id}?sessionId=${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(res.status, 200);

  const saved = h.repo.listEvents(session.id).find((e) => e.type === "memory_saved");
  assert.ok(saved);
  assert.equal(saved?.type === "memory_saved" && saved.scope, "project");
  assert.equal(saved?.type === "memory_saved" && saved.scopeId, project.id);
});

// ── WP2.7 (D-HUX11) — the save-proposal scope picker: PATCH may MOVE a row to a different scope ───────
// "the scope picker's chosen owner in the SAME request" (`ConversationPane.tsx`'s `MemoryProposalChip`).
// The route itself is UNCHANGED — `hubMemoryPatchSchema` grew `scope`/`scopeId` (additive) and
// `HubRepository.updateMemory` now applies them via the SAME entity guard `createMemory` uses
// (`resolveMemoryScope`), so this exercises the real route end to end.

test("HubRepository.updateMemory: a content/status-only patch leaves the row's scope untouched (pre-WP2.7 behavior)", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo" });
  const memory = repo.createMemory({
    kind: "instruction",
    content: "Ship weekly.",
    scope: "project",
    scopeId: project.id,
  });
  const updated = repo.updateMemory(memory.id, { content: "Ship weekly, no exceptions." });
  assert.equal(updated.scope, "project");
  assert.equal(updated.scopeId, project.id);
});

test("HubRepository.updateMemory: a patch naming a scope MOVES the row (project → profile, and profile → crew)", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Demo" });
  const crew = repo.createCrew({ name: "Alpha", topology: "parallel", members: [] });

  const inProject = repo.createMemory({
    kind: "instruction",
    content: "Ship weekly.",
    scope: "project",
    scopeId: project.id,
  });
  const movedToProfile = repo.updateMemory(inProject.id, { scope: "profile" });
  assert.equal(movedToProfile.scope, "profile");
  assert.equal(movedToProfile.scopeId, null);

  const inProfile = repo.createMemory({ kind: "preference", content: "Prefers concise answers." });
  const movedToCrew = repo.updateMemory(inProfile.id, { scope: "crew", scopeId: crew.id });
  assert.equal(movedToCrew.scope, "crew");
  assert.equal(movedToCrew.scopeId, crew.id);
});

test("HubRepository.updateMemory: the scope-move reuses the create-path entity guard (400 no scopeId, 404 phantom owner, 400 profile+scopeId)", () => {
  const repo = openRepo();
  const memory = repo.createMemory({ kind: "preference", content: "x" });
  assert.throws(
    () => repo.updateMemory(memory.id, { scope: "project" }),
    (e) => statusCodeOf(e) === 400,
  );
  assert.throws(
    () => repo.updateMemory(memory.id, { scope: "crew", scopeId: "crew-does-not-exist" }),
    (e) => statusCodeOf(e) === 404,
  );
  assert.throws(
    () => repo.updateMemory(memory.id, { scope: "profile", scopeId: "anything" }),
    (e) => statusCodeOf(e) === 400,
  );
});

test("PATCH /api/hub/memory/:id?sessionId= accepting WITH a different chosen scope lands the memory_saved event at the NEW scope (D-HUX11 acceptance: proposals land in the chosen scope)", async () => {
  const h = await makeApp();
  const project = h.repo.createProject({ name: "Demo" });
  const session = h.repo.createSession({ mode: "chat", model: "test-model" });
  // The model proposed it globally (profile); the owner's scope picker chose "this project" before
  // clicking Save — exactly `MemoryProposalChip`'s flow.
  const proposed = h.repo.createMemory({
    kind: "instruction",
    content: "Track the rollout.",
    source: "assistant_proposed",
  });
  assert.equal(proposed.scope, "profile");

  const res = await fetch(`${h.baseUrl}/api/hub/memory/${proposed.id}?sessionId=${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "active", scope: "project", scopeId: project.id }),
  });
  assert.equal(res.status, 200);
  const landed = (await res.json()) as HubMemory;
  assert.equal(landed.scope, "project");
  assert.equal(landed.scopeId, project.id);

  // The now-project-scoped row is what a project session's effective stack resolves.
  const projectSession = h.repo.createSession({
    mode: "chat",
    model: "test-model",
    projectId: project.id,
  });
  const effective = buildSessionEffectiveMemory(h.repo, projectSession.id);
  assert.equal(effective.entries.some((e) => e.id === proposed.id && e.scope === "project"), true);

  const saved = h.repo.listEvents(session.id).find((e) => e.type === "memory_saved");
  assert.ok(saved);
  assert.equal(saved?.type === "memory_saved" && saved.scope, "project");
  assert.equal(saved?.type === "memory_saved" && saved.scopeId, project.id);
});

test("PATCH /api/hub/memory/:id rejects an accept-with-scope-move at a phantom owner (404) or profile+scopeId (400)", async () => {
  const h = await makeApp();
  const proposed = h.repo.createMemory({
    kind: "instruction",
    content: "x",
    source: "assistant_proposed",
  });

  const badOwner = await fetch(`${h.baseUrl}/api/hub/memory/${proposed.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "active", scope: "crew", scopeId: "crew-nope" }),
  });
  assert.equal(badOwner.status, 404);

  const profileWithOwner = await fetch(`${h.baseUrl}/api/hub/memory/${proposed.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "active", scope: "profile", scopeId: "anything" }),
  });
  assert.equal(profileWithOwner.status, 400);
});
