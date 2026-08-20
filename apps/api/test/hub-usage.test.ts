// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.1, R-UX6/R-UX8) — `GET /api/hub/usage` aggregates.
//
// Proves (acceptance):
//   1. Totals + byModel/byProvider sum EVERY session (top-level + mission-agent children).
//   2. byMode/byDay only bucket top-level (`kind:"chat"`) sessions — an agent child's `mode` column is
//      always "chat" regardless of its actual role, so it must never pollute the mode/day rollups.
//   3. `from`/`to`/`projectId` filter sessions AND missions consistently.
//   4. R-UX6 — the plan-acceptance metric: a mission approved with NO `plan_updated` event counts as
//      "unedited"; one WITH a `plan_updated` before approval counts as edited; a mission still
//      `proposed` (never approved) is excluded from `approvedMissions` entirely.
//   5. `GET /api/hub/usage` round-trips through the real route.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type { HubMissionPlan, HubToolGrants } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { buildHubUsageAggregates } from "../src/hub/usage.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const counter = getTokenCounter("generic_o200k");

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

function planFixture(): HubMissionPlan {
  return {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      {
        key: "a",
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

// ── (1)/(2) totals + model/provider (all sessions) vs mode/day (top-level only) ────────────────────

test("buildHubUsageAggregates — byModel/byProvider include agent children; byMode/byDay don't", () => {
  const repo = openRepo();
  const chat = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, chat.id, { costUsd: 1, tokensIn: 100, tokensOut: 50 });

  const research = repo.createSession({ mode: "research", model: "gpt-5.5" });
  withUsage(repo, research.id, { costUsd: 2, tokensIn: 200, tokensOut: 80 });

  // A mission-agent child (kind:"agent", mode always "chat" per the orchestrator's own convention).
  const mission = repo.createMission({ sessionId: chat.id, topology: "parallel", autonomy: "always_ask", plan: planFixture() });
  const agent = repo.createSession({
    mode: "chat",
    model: "gemini-2.5-pro",
    kind: "agent",
    parentSessionId: chat.id,
    missionId: mission.id,
  });
  withUsage(repo, agent.id, { costUsd: 0.5, tokensIn: 40, tokensOut: 10 });

  const result = buildHubUsageAggregates(repo, {}, () => undefined);

  assert.equal(result.totals.sessions, 3);
  assert.equal(result.totals.costUsd, 3.5);
  assert.equal(result.totals.tokensIn, 340);

  // byModel includes all three models (agent's model included).
  const modelKeys = result.byModel.map((b) => b.key).sort();
  assert.deepEqual(modelKeys, ["claude-opus-4-8", "gemini-2.5-pro", "gpt-5.5"]);

  // byMode/byDay only see the TWO top-level sessions — the agent's cost never shows up bucketed by
  // "mode" (it would misleadingly inflate "chat" mode spend with mission-agent spend).
  const modeTotal = result.byMode.reduce((sum, b) => sum + b.sessions, 0);
  assert.equal(modeTotal, 2);
  const chatBucket = result.byMode.find((b) => b.key === "chat");
  assert.equal(chatBucket?.costUsd, 1, "the agent's 0.5 must NOT be folded into the chat mode bucket");

  const dayTotal = result.byDay.reduce((sum, b) => sum + b.sessions, 0);
  assert.equal(dayTotal, 2);
});

test("buildHubUsageAggregates — byProvider labels via the injected resolver, unknowns as 'other'", () => {
  const repo = openRepo();
  const a = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, a.id, { costUsd: 1, tokensIn: 10, tokensOut: 5 });
  const b = repo.createSession({ mode: "chat", model: "some-self-hosted-model" });
  withUsage(repo, b.id, { costUsd: 2, tokensIn: 10, tokensOut: 5 });

  // model-identity WP3.3 — the resolver now takes the SESSION (so it can read the persisted
  // credential); this case still exercises the pure model-name path, unchanged.
  const result = buildHubUsageAggregates(repo, {}, (session) =>
    session.model.startsWith("claude") ? { kind: "anthropic" } : undefined,
  );
  const anthropic = result.byProvider.find((p) => p.key === "anthropic");
  const other = result.byProvider.find((p) => p.key === "other");
  assert.equal(anthropic?.label, "Anthropic");
  assert.equal(anthropic?.sessions, 1);
  assert.equal(other?.label, "Other");
  assert.equal(other?.sessions, 1);
});

// ── (3) range + project filtering ───────────────────────────────────────────────────────────────

test("buildHubUsageAggregates — from/to filters by createdAt (inclusive)", () => {
  const repo = openRepo();
  const db = databases[databases.length - 1] as AppDatabase;
  const early = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", early.id);
  withUsage(repo, early.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });

  const late = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run("2026-06-01T00:00:00.000Z", late.id);
  withUsage(repo, late.id, { costUsd: 3, tokensIn: 3, tokensOut: 3 });

  const result = buildHubUsageAggregates(repo, { from: "2026-03-01" }, () => undefined);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.costUsd, 3);
});

test("buildHubUsageAggregates — projectId filters both sessions and missions consistently", () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Proj A" });
  const inProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8", projectId: project.id });
  withUsage(repo, inProject.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });
  const outsideProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, outsideProject.id, { costUsd: 5, tokensIn: 5, tokensOut: 5 });

  repo.createMission({ sessionId: inProject.id, topology: "parallel", autonomy: "always_ask", plan: planFixture() });
  repo.createMission({ sessionId: outsideProject.id, topology: "parallel", autonomy: "always_ask", plan: planFixture() });

  const result = buildHubUsageAggregates(repo, { projectId: project.id }, () => undefined);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.costUsd, 1);
  assert.equal(result.missions.length, 1);
  assert.equal(result.missions[0]?.sessionId, inProject.id);
});

// ── (4) R-UX6 — the plan-acceptance metric ──────────────────────────────────────────────────────

test("buildHubUsageAggregates — R-UX6: unedited vs edited approvals, proposed-only excluded", () => {
  const repo = openRepo();

  const s1 = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const m1 = repo.createMission({ sessionId: s1.id, topology: "parallel", autonomy: "always_ask", plan: planFixture() });
  repo.updateMission(m1.id, { status: "completed" }); // approved, never edited

  const s2 = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const m2 = repo.createMission({ sessionId: s2.id, topology: "parallel", autonomy: "always_ask", plan: planFixture() });
  repo.appendEvent(s2.id, { type: "plan_updated", missionId: m2.id, plan: planFixture() });
  repo.updateMission(m2.id, { status: "completed" }); // approved, WAS edited

  const s3 = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  repo.createMission({ sessionId: s3.id, topology: "parallel", autonomy: "always_ask", plan: planFixture() });
  // m3 stays "proposed" — never approved.

  const result = buildHubUsageAggregates(repo, {}, () => undefined);
  assert.equal(result.planAcceptance.approvedMissions, 2, "only m1/m2 reached approval");
  assert.equal(result.planAcceptance.uneditedApprovals, 1, "only m1 was unedited");
  assert.equal(result.planAcceptance.uneditedPercent, 50);

  const m1Row = result.missions.find((m) => m.missionId === m1.id);
  const m2Row = result.missions.find((m) => m.missionId === m2.id);
  const m3Row = result.missions.find((m) => m.sessionId === s3.id);
  assert.equal(m1Row?.approvedUnedited, true);
  assert.equal(m2Row?.approvedUnedited, false);
  assert.equal(m3Row?.approvedUnedited, undefined, "a never-approved mission carries no signal either way");
});

test("buildHubUsageAggregates — zero approved missions yields uneditedPercent 0, never NaN", () => {
  const repo = openRepo();
  const result = buildHubUsageAggregates(repo, {}, () => undefined);
  assert.equal(result.planAcceptance.approvedMissions, 0);
  assert.equal(result.planAcceptance.uneditedPercent, 0);
});

// ── (5) the real route ──────────────────────────────────────────────────────────────────────────

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

test("GET /api/hub/usage — round-trips through the real route", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  withUsage(repo, session.id, { costUsd: 1.25, tokensIn: 100, tokensOut: 20 });

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

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/usage`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { totals: { sessions: number; costUsd: number } };
  assert.equal(body.totals.sessions, 1);
  assert.equal(body.totals.costUsd, 1.25);
});
