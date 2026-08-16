// Assistant Hub UX (roadmap/assistant-hub-ux/, WP1.6) — worktask 1: "make from/to/projectId actually
// filter (verify + tests — flagged unexercised)".
//
// The pre-existing `hub-usage.test.ts` only proved `from`/`to`/`projectId` filtering by calling
// `buildHubUsageAggregates` DIRECTLY — the real HTTP query-string path through
// `GET /api/hub/usage` (zod-parsed `request.query`) was never exercised. This file closes that gap, and
// separately proves + fixes a real bug worktask 1 flags: filtering by `projectId` used to run a naive SQL
// `WHERE project_id = X`, which silently dropped every mission-agent child's spend from a project-scoped
// view (an agent child's own `project_id` column is never set — see `missions/orchestrator.ts`'s
// `createSession` call). `buildHubUsageAggregates` (apps/api/src/hub/usage.ts) now resolves the EFFECTIVE
// project (inherited from the parent for an agent child) before matching.
//
// Proves:
//   1. `GET /api/hub/usage?from=&to=` narrows `totals` over the real HTTP query string.
//   2. `GET /api/hub/usage?projectId=` narrows `totals` over the real HTTP query string.
//   3. THE FIX: a projectId-filtered view still counts a mission-agent child's real spend (inherited
//      from its parent mission), matching `byModel`'s own documented "every session" contract instead of
//      silently shrinking once a project filter is applied.
//   4. Combining `from`+`to`+`projectId` narrows on all three simultaneously.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type { HubMissionPlan, HubToolGrants, HubUsageAggregates } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { buildHubUsageAggregates } from "../src/hub/usage.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

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

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

async function buildApp(): Promise<{ repo: HubRepository; db: AppDatabase; port: number }> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
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
  return { repo, db, port };
}

// ── (1) from/to over the REAL query string ──────────────────────────────────────────────────────

test("GET /api/hub/usage?from=&to= — narrows totals over the real HTTP query string", async () => {
  const { repo, db, port } = await buildApp();
  const early = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", early.id);
  repo.setSessionLifecycle(early.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });

  const late = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run("2026-06-01T00:00:00.000Z", late.id);
  repo.setSessionLifecycle(late.id, { costUsd: 3, tokensIn: 3, tokensOut: 3 });

  const unfiltered = (await (await fetch(`http://127.0.0.1:${port}/api/hub/usage`)).json()) as HubUsageAggregates;
  assert.equal(unfiltered.totals.sessions, 2);

  const filtered = (await (
    await fetch(`http://127.0.0.1:${port}/api/hub/usage?from=2026-03-01&to=2026-12-31`)
  ).json()) as HubUsageAggregates;
  assert.equal(filtered.totals.sessions, 1);
  assert.equal(filtered.totals.costUsd, 3);
  assert.deepEqual(filtered.range, { from: "2026-03-01", to: "2026-12-31" });
});

// ── (2) projectId over the REAL query string ────────────────────────────────────────────────────

test("GET /api/hub/usage?projectId= — narrows totals over the real HTTP query string", async () => {
  const { repo, port } = await buildApp();
  const project = repo.createProject({ name: "Proj A" });
  const inProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8", projectId: project.id });
  repo.setSessionLifecycle(inProject.id, { costUsd: 1, tokensIn: 1, tokensOut: 1 });
  const outside = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  repo.setSessionLifecycle(outside.id, { costUsd: 5, tokensIn: 5, tokensOut: 5 });

  const filtered = (await (
    await fetch(`http://127.0.0.1:${port}/api/hub/usage?projectId=${project.id}`)
  ).json()) as HubUsageAggregates;
  assert.equal(filtered.totals.sessions, 1);
  assert.equal(filtered.totals.costUsd, 1);
  assert.equal(filtered.range.projectId, project.id);
});

// ── (3) THE FIX: projectId-filtered view still counts an agent child's inherited spend ─────────────

test("buildHubUsageAggregates — projectId filtering counts a mission-agent child's spend (inherited from its parent), never silently dropping it", () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const repo = new HubRepository(db);

  const project = repo.createProject({ name: "Proj A" });
  const missionParent = repo.createSession({
    mode: "mission",
    model: "claude-opus-4-8",
    projectId: project.id,
  });
  repo.setSessionLifecycle(missionParent.id, { costUsd: 0.1, tokensIn: 1, tokensOut: 1 });

  const mission = repo.createMission({
    sessionId: missionParent.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: planFixture(),
  });
  // The agent child NEVER carries its own project_id (mirrors missions/orchestrator.ts's createSession
  // call) — only its parent does.
  const child = repo.createSession({
    mode: "chat",
    model: "gemini-2.5-pro",
    kind: "agent",
    parentSessionId: missionParent.id,
    missionId: mission.id,
  });
  repo.updateMission(mission.id, { agentSessionIds: [child.id] });
  repo.setSessionLifecycle(child.id, { costUsd: 4, tokensIn: 40, tokensOut: 16 });
  assert.equal(repo.getSession(child.id).projectId ?? null, null, "sanity: the child truly has no project_id of its own");

  const unfiltered = buildHubUsageAggregates(repo, {}, () => undefined);
  assert.equal(unfiltered.totals.sessions, 2);
  assert.equal(unfiltered.totals.costUsd, 4.1);

  const filtered = buildHubUsageAggregates(repo, { projectId: project.id }, () => undefined);
  assert.equal(filtered.totals.sessions, 2, "the agent child is NOT silently dropped by the project filter");
  assert.equal(filtered.totals.costUsd, 4.1);
  const geminiBucket = filtered.byModel.find((b) => b.key === "gemini-2.5-pro");
  assert.equal(geminiBucket?.costUsd, 4, "byModel still includes the agent child's real spend once project-filtered");
});

// ── (4) from + to + projectId together ──────────────────────────────────────────────────────────

test("GET /api/hub/usage — from+to+projectId compose (all three narrow at once)", async () => {
  const { repo, db, port } = await buildApp();
  const project = repo.createProject({ name: "Proj A" });

  const inRangeInProject = repo.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    projectId: project.id,
  });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run(
    "2026-03-15T00:00:00.000Z",
    inRangeInProject.id,
  );
  repo.setSessionLifecycle(inRangeInProject.id, { costUsd: 2, tokensIn: 2, tokensOut: 2 });

  const outOfRangeInProject = repo.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    projectId: project.id,
  });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run(
    "2025-01-01T00:00:00.000Z",
    outOfRangeInProject.id,
  );
  repo.setSessionLifecycle(outOfRangeInProject.id, { costUsd: 100, tokensIn: 1, tokensOut: 1 });

  const inRangeOutsideProject = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run(
    "2026-03-15T00:00:00.000Z",
    inRangeOutsideProject.id,
  );
  repo.setSessionLifecycle(inRangeOutsideProject.id, { costUsd: 50, tokensIn: 1, tokensOut: 1 });

  const url =
    `http://127.0.0.1:${port}/api/hub/usage?from=2026-01-01&to=2026-12-31&projectId=${project.id}`;
  const filtered = (await (await fetch(url)).json()) as HubUsageAggregates;
  assert.equal(filtered.totals.sessions, 1, "only the in-range, in-project session");
  assert.equal(filtered.totals.costUsd, 2);
});
