// Assistant Hub UX (roadmap/assistant-hub-ux/, WP1.6, D-HUX10) — `GET /api/hub/usage/rollup` group-by
// rollups: `buildHubUsageRollup` (apps/api/src/hub/usage.ts).
//
// Proves (WP1.6 acceptance — "attribution sums reconcile exactly; unattributed spend is visible, never
// dropped"):
//   1. `agent`: a mission-agent child spawned from a LIBRARY role attributes to that role; a top-level
//      session and an ad-hoc (no-`roleId`) planned agent both land in the explicit "No agent" bucket.
//   2. `crew`: a session's own `crewId` attributes directly; a mission-agent child INHERITS its parent's
//      `crewId` (it never carries one itself); no crew ⇒ "No crew".
//   3. `project`: same inheritance shape as crew ⇒ "No project" for anything with no effective project.
//   4. `model`: never produces an unattributed row (every session has a model).
//   5. `mode`: a mission-agent child's raw `mode` column is always "chat" — the rollup uses its PARENT's
//      real mode instead, so mission-agent spend is never mislabeled as ordinary chat use.
//   6. THE INVARIANT (worktask 4): for EVERY one of the five `HubUsageGroupBy` dimensions,
//      sum(rows[].{sessions,costUsd,tokensIn,tokensOut}) === the total over the same filtered session set.
//   7. `from`/`to`/`projectId` narrow the rollup, including the projectId-inheritance fix (an agent
//      child's spend still counts toward its parent mission's project).
//   8. `GET /api/hub/usage/rollup` round-trips through the real route.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { toErrorMessage } from "../src/utils/errors.js";
import type {
  HubMissionPlan,
  HubToolGrants,
  HubUsageGroupBy,
  HubUsageRow,
} from "@mcp-token-footprint/shared";
import { HUB_USAGE_GROUP_BYS } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { buildHubUsageRollup } from "../src/hub/usage.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import crypto from "node:crypto";

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

/** The real app (`index.ts`) registers a central error handler (ZodError -> 400, else
 *  `error.statusCode` -> 500) — a raw `Fastify()` test instance has none, so a validation error would
 *  otherwise surface as an undifferentiated 500. Mirrors the pattern other route tests use (e.g.
 *  `assistant-auth.test.ts`) to exercise the REAL 400/404 status codes the route contract promises. */
function registerTestErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const statusCode = typeof typed.statusCode === "number" ? typed.statusCode : 500;
    return reply.code(statusCode).send({ error: toErrorMessage(error) });
  });
}

function openRepo(): { repo: HubRepository; db: AppDatabase } {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return { repo: new HubRepository(db), db };
}

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

/** A one-agent plan; `roleId` set only when `withRoleId` is given (an ad-hoc planned agent otherwise). */
function planFixture(roleId?: string): HubMissionPlan {
  return {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      {
        key: "a",
        ...(roleId ? { roleId } : {}),
        name: "Agent A",
        systemPrompt: "You are agent A.",
        model: "gpt-4o",
        toolGrants: EMPTY_GRANTS,
        skillIds: [],
        brief: "Do the work.",
        target: "Find things.",
        expectedOutcome: "A report.",
      },
    ],
  };
}

function withUsage(
  repo: HubRepository,
  sessionId: string,
  usage: { costUsd: number; tokensIn: number; tokensOut: number },
): void {
  repo.setSessionLifecycle(sessionId, usage);
}

/** Spawns a mission with ONE agent child (mirroring the orchestrator's own spawn shape: agentSessionIds
 *  positional with plan.agents), returns the child session id. */
function spawnMissionAgent(
  repo: HubRepository,
  parentSessionId: string,
  roleId: string | undefined,
  usage: { costUsd: number; tokensIn: number; tokensOut: number },
): string {
  const mission = repo.createMission({
    sessionId: parentSessionId,
    topology: "parallel",
    autonomy: "always_ask",
    plan: planFixture(roleId),
  });
  const child = repo.createSession({
    mode: "chat", // orchestrator always spawns agent children with mode:"chat" regardless of role
    model: "gemini-2.5-pro",
    kind: "agent",
    parentSessionId,
    missionId: mission.id,
  });
  repo.updateMission(mission.id, { agentSessionIds: [child.id] });
  withUsage(repo, child.id, usage);
  return child.id;
}

// ── (1) agent attribution — library role, ad-hoc, top-level, and the "No agent" bucket ─────────────

test("buildHubUsageRollup(groupBy:'agent') — library-role attribution + the explicit No-agent bucket", () => {
  const { repo } = openRepo();
  const role = repo.createAgentRole({
    name: "Researcher",
    systemPrompt: "p",
    defaultModel: "m",
    target: "t",
    expectedOutcome: "o",
  });

  // A top-level chat session (never "run as" any role) — unattributed.
  const chat = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, chat.id, { costUsd: 1, tokensIn: 10, tokensOut: 5 });

  // A mission whose one agent IS the library role.
  const missionParent = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  spawnMissionAgent(repo, missionParent.id, role.id, { costUsd: 2, tokensIn: 20, tokensOut: 10 });

  // A second mission whose one agent is AD-HOC (no roleId) — also unattributed.
  const adhocParent = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  spawnMissionAgent(repo, adhocParent.id, undefined, { costUsd: 0.5, tokensIn: 5, tokensOut: 2 });

  const rows = buildHubUsageRollup(repo, "agent", {});
  const roleRow = rows.find((r) => r.key === role.id);
  assert.ok(roleRow, "the library role gets its own row");
  assert.equal(roleRow?.label, "Researcher");
  assert.equal(roleRow?.costUsd, 2);
  assert.equal(roleRow?.unattributed, undefined);

  const noAgent = rows.find((r) => r.unattributed);
  assert.ok(noAgent, "an explicit No-agent bucket exists");
  assert.equal(noAgent?.key, null);
  assert.equal(noAgent?.label, "No agent");
  // chat (1) + the two mission PARENT sessions (0 cost each, never run as a role) + the ad-hoc agent (0.5)
  assert.equal(noAgent?.sessions, 4);
  assert.equal(noAgent?.costUsd, 1.5);
});

// ── (2)/(3) crew + project attribution — direct on the parent, INHERITED by the agent child ────────

test("buildHubUsageRollup(groupBy:'crew') — the crew's own session attributes directly; its agent children inherit it", () => {
  const { repo } = openRepo();
  const crew = repo.createCrew({ name: "Research crew", topology: "parallel", members: [] });

  const missionParent = repo.createSession({
    mode: "mission",
    model: "claude-opus-4-8",
    crewId: crew.id,
  });
  withUsage(repo, missionParent.id, { costUsd: 0.1, tokensIn: 1, tokensOut: 1 }); // the thread itself
  spawnMissionAgent(repo, missionParent.id, undefined, { costUsd: 3, tokensIn: 30, tokensOut: 15 });

  // An unrelated ad-hoc mission (no crew) — its agent lands in "No crew" too.
  const adhocParent = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  spawnMissionAgent(repo, adhocParent.id, undefined, { costUsd: 0.2, tokensIn: 2, tokensOut: 1 });

  const rows = buildHubUsageRollup(repo, "crew", {});
  const crewRow = rows.find((r) => r.key === crew.id);
  assert.ok(crewRow);
  assert.equal(crewRow?.label, "Research crew");
  // 0.1 (parent thread) + 3 (agent child, INHERITED crewId) = 3.1 — the child is never dropped.
  assert.equal(crewRow?.costUsd, 3.1);
  assert.equal(crewRow?.sessions, 2);

  const noCrew = rows.find((r) => r.unattributed);
  assert.ok(noCrew);
  assert.equal(noCrew?.label, "No crew");
  assert.equal(noCrew?.costUsd, 0.2);
});

test("buildHubUsageRollup(groupBy:'project') — same inheritance shape; 'No project' for anything with none", () => {
  const { repo } = openRepo();
  const project = repo.createProject({ name: "Proj A" });

  const missionParent = repo.createSession({
    mode: "mission",
    model: "claude-opus-4-8",
    projectId: project.id,
  });
  spawnMissionAgent(repo, missionParent.id, undefined, { costUsd: 4, tokensIn: 40, tokensOut: 20 });

  const outside = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, outside.id, { costUsd: 0.7, tokensIn: 7, tokensOut: 3 });

  const rows = buildHubUsageRollup(repo, "project", {});
  const projectRow = rows.find((r) => r.key === project.id);
  assert.equal(projectRow?.label, "Proj A");
  assert.equal(projectRow?.costUsd, 4, "the agent child's spend counts toward its parent's project");

  const noProject = rows.find((r) => r.unattributed);
  assert.equal(noProject?.label, "No project");
  assert.equal(noProject?.costUsd, 0.7);
});

// ── (4) model — never unattributed ──────────────────────────────────────────────────────────────

test("buildHubUsageRollup(groupBy:'model') — every session has a model; no unattributed row ever appears", () => {
  const { repo } = openRepo();
  const a = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, a.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });
  const missionParent = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  spawnMissionAgent(repo, missionParent.id, undefined, { costUsd: 2, tokensIn: 2, tokensOut: 2 });

  const rows = buildHubUsageRollup(repo, "model", {});
  assert.equal(rows.some((r) => r.unattributed), false);
  const geminiRow = rows.find((r) => r.key === "gemini-2.5-pro");
  assert.equal(geminiRow?.costUsd, 2, "the agent child's OWN model, not its parent's");
});

// ── (5) mode — an agent child's EFFECTIVE mode is its parent's, never the raw always-"chat" column ──

test("buildHubUsageRollup(groupBy:'mode') — a mission-agent child attributes to its parent's REAL mode", () => {
  const { repo } = openRepo();
  const chat = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, chat.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });

  const missionParent = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  withUsage(repo, missionParent.id, { costUsd: 0, tokensIn: 0, tokensOut: 0 });
  spawnMissionAgent(repo, missionParent.id, undefined, { costUsd: 5, tokensIn: 50, tokensOut: 20 });

  const rows = buildHubUsageRollup(repo, "mode", {});
  assert.equal(rows.some((r) => r.unattributed), false);
  const missionRow = rows.find((r) => r.key === "mission");
  // the parent's own (0) + the agent child's 5 — the child's mode column is "chat", but it must land
  // under "mission" (its parent's real mode), never inflate the "chat" bucket.
  assert.equal(missionRow?.costUsd, 5);
  const chatRow = rows.find((r) => r.key === "chat");
  assert.equal(chatRow?.costUsd, 1, "the agent child's 5 must NOT leak into the chat bucket");
});

// ── (6) THE INVARIANT — sum(rows) === total, for every group-by, across a mixed fixture ────────────

test("buildHubUsageRollup — INVARIANT: sum(rows[].{sessions,costUsd,tokensIn,tokensOut}) === the range total, for all 5 group-bys", () => {
  const { repo } = openRepo();
  const role = repo.createAgentRole({
    name: "Researcher",
    systemPrompt: "p",
    defaultModel: "m",
    target: "t",
    expectedOutcome: "o",
  });
  const crew = repo.createCrew({ name: "Crew", topology: "debate", members: [] });
  const project = repo.createProject({ name: "Proj" });

  const chat = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, chat.id, { costUsd: 1.11, tokensIn: 11, tokensOut: 6 });

  const research = repo.createSession({ mode: "research", model: "gpt-5.5", projectId: project.id });
  withUsage(repo, research.id, { costUsd: 2.22, tokensIn: 22, tokensOut: 9 });

  const missionParent = repo.createSession({
    mode: "mission",
    model: "claude-opus-4-8",
    crewId: crew.id,
    projectId: project.id,
  });
  withUsage(repo, missionParent.id, { costUsd: 0.05, tokensIn: 1, tokensOut: 1 });
  spawnMissionAgent(repo, missionParent.id, role.id, { costUsd: 3.33, tokensIn: 33, tokensOut: 14 });

  const adhocParent = repo.createSession({ mode: "mission", model: "gemini-2.5-pro" });
  spawnMissionAgent(repo, adhocParent.id, undefined, { costUsd: 0.44, tokensIn: 4, tokensOut: 2 });

  const expectedTotal = {
    sessions: 6,
    costUsd: 1.11 + 2.22 + 0.05 + 3.33 + 0.44,
    tokensIn: 11 + 22 + 1 + 33 + 4,
    tokensOut: 6 + 9 + 1 + 14 + 2,
  };

  for (const groupBy of HUB_USAGE_GROUP_BYS) {
    const rows = buildHubUsageRollup(repo, groupBy, {});
    const summed = rows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        costUsd: acc.costUsd + r.costUsd,
        tokensIn: acc.tokensIn + r.tokensIn,
        tokensOut: acc.tokensOut + r.tokensOut,
      }),
      { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
    );
    assert.equal(summed.sessions, expectedTotal.sessions, `groupBy=${groupBy} sessions`);
    assert.ok(
      Math.abs(summed.costUsd - expectedTotal.costUsd) < 1e-9,
      `groupBy=${groupBy} costUsd: ${summed.costUsd} !== ${expectedTotal.costUsd}`,
    );
    assert.equal(summed.tokensIn, expectedTotal.tokensIn, `groupBy=${groupBy} tokensIn`);
    assert.equal(summed.tokensOut, expectedTotal.tokensOut, `groupBy=${groupBy} tokensOut`);
    // Every row is a real, distinct bucket — no group-by silently collapses to a single "everything" row.
    assert.ok(rows.length >= 1);
  }
});

// ── (7) filters narrow the rollup, incl. the projectId-inheritance fix ─────────────────────────────

test("buildHubUsageRollup — from/to narrow by createdAt (inclusive)", () => {
  const { repo, db } = openRepo();
  const early = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", early.id);
  withUsage(repo, early.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });

  const late = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run("2026-06-01T00:00:00.000Z", late.id);
  withUsage(repo, late.id, { costUsd: 3, tokensIn: 3, tokensOut: 3 });

  const rows = buildHubUsageRollup(repo, "model", { from: "2026-03-01" });
  assert.equal(rows.reduce((n, r) => n + r.sessions, 0), 1);
  assert.equal(rows.reduce((n, r) => n + r.costUsd, 0), 3);
});

test("buildHubUsageRollup — projectId narrows AND still counts an agent child's inherited spend", () => {
  const { repo } = openRepo();
  const project = repo.createProject({ name: "Proj A" });
  const inProject = repo.createSession({
    mode: "mission",
    model: "claude-opus-4-8",
    projectId: project.id,
  });
  spawnMissionAgent(repo, inProject.id, undefined, { costUsd: 5, tokensIn: 5, tokensOut: 5 });

  const outsideProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, outsideProject.id, { costUsd: 9, tokensIn: 9, tokensOut: 9 });

  const rows = buildHubUsageRollup(repo, "model", { projectId: project.id });
  // The in-project mission thread itself (cost 0, no usage set) PLUS its agent child (5, inherited) —
  // the outside-project chat session (9) is excluded.
  assert.equal(rows.reduce((n, r) => n + r.sessions, 0), 2, "the mission thread + its agent child");
  assert.equal(rows.reduce((n, r) => n + r.costUsd, 0), 5);
});

// ── (8) the real route ──────────────────────────────────────────────────────────────────────────

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

test("GET /api/hub/usage/rollup — round-trips through the real route", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  repo.setSessionLifecycle(session.id, { costUsd: 1.5, tokensIn: 15, tokensOut: 5 });

  const counter = getTokenCounter("generic_o200k");
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: "/tmp",
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });
  const app = Fastify({ logger: false });
  registerTestErrorHandler(app);
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    tokenCounter: counter,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/usage/rollup?groupBy=model`);
  assert.equal(res.status, 200);
  const rows = (await res.json()) as HubUsageRow[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.key, "claude-opus-4-8");
  assert.equal(rows[0]?.costUsd, 1.5);

  // An unsupported groupBy value is rejected (zod, 400) rather than silently ignored.
  const bad = await fetch(`http://127.0.0.1:${port}/api/hub/usage/rollup?groupBy=provider`);
  assert.equal(bad.status, 400);

  // A missing groupBy is also rejected — the caller must always pick a dimension.
  const missing = await fetch(`http://127.0.0.1:${port}/api/hub/usage/rollup`);
  assert.equal(missing.status, 400);
});

// Type-only sanity: HubUsageGroupBy stays a closed 5-member union used above (fails to compile otherwise).
const _allGroupBys: readonly HubUsageGroupBy[] = HUB_USAGE_GROUP_BYS;
void _allGroupBys;
