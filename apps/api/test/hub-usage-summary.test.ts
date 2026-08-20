// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP1.6, D-HUX10) — `GET /api/hub/usage/summary`
// per-entity usage summaries: `buildHubUsageSummary` (apps/api/src/hub/usage.ts).
//
// Proves:
//   1. The daily `strip` is zero-filled and oldest→newest over the trailing window (default 30 days),
//      even when a day has no sessions at all — the sparkline stays evenly spaced.
//   2. `totals` reconciles EXACTLY against `sum(strip[].{sessions,costUsd,tokensIn,tokensOut})` — the
//      per-entity counterpart to the rollup's sum(rows)===total invariant (worktask 4).
//   3. A session outside the trailing window doesn't leak into either `totals` or `strip`.
//   4. `days` resizes the window (a wider window picks up older spend the default 30-day one excludes).
//   5. An unknown agent/crew/project id 404s (never a fabricated empty summary for a real entity kind).
//   6. `model`/`mode` need no backing entity — an id with zero matching sessions returns an honest
//      all-zero summary rather than a 404.
//   7. `GET /api/hub/usage/summary` round-trips through the real route, incl. `days` bounds (1..90).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { HubUsageSummary } from "@mcp-token-footprint/shared";
import { toErrorMessage } from "../src/utils/errors.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { buildHubUsageSummary } from "../src/hub/usage.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

/** The real app (`index.ts`) registers a central error handler (ZodError -> 400, else
 *  `error.statusCode` -> 500) — a raw `Fastify()` test instance has none, so a validation/404 error
 *  would otherwise surface as an undifferentiated 500. Mirrors the pattern other route tests use (e.g.
 *  `assistant-auth.test.ts`) to exercise the REAL status codes the route contract promises. */
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

function setCreatedAt(db: AppDatabase, sessionId: string, iso: string): void {
  db.prepare("UPDATE hub_sessions SET created_at = ? WHERE id = ?").run(iso, sessionId);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

// ── (1)/(2) zero-filled strip + exact reconciliation ────────────────────────────────────────────

test("buildHubUsageSummary — the strip is zero-filled, oldest→newest, and sum(strip) === totals exactly", () => {
  const { repo, db } = openRepo();
  const project = repo.createProject({ name: "Proj A" });

  const today = repo.createSession({ mode: "chat", model: "claude-opus-4-8", projectId: project.id });
  setCreatedAt(db, today.id, isoDaysAgo(0));
  repo.setSessionLifecycle(today.id, { costUsd: 1, tokensIn: 10, tokensOut: 4 });

  const threeDaysAgo = repo.createSession({ mode: "chat", model: "gpt-5.5", projectId: project.id });
  setCreatedAt(db, threeDaysAgo.id, isoDaysAgo(3));
  repo.setSessionLifecycle(threeDaysAgo.id, { costUsd: 2, tokensIn: 20, tokensOut: 8 });

  const summary = buildHubUsageSummary(repo, "project", project.id, { days: 7 });
  assert.equal(summary.groupBy, "project");
  assert.equal(summary.id, project.id);
  assert.equal(summary.label, "Proj A");
  assert.equal(summary.strip.length, 7, "exactly `days` buckets");

  // Oldest -> newest.
  for (let i = 1; i < summary.strip.length; i += 1) {
    assert.ok((summary.strip[i - 1]?.key ?? "") < (summary.strip[i]?.key ?? ""));
  }
  // Most days have zero sessions — the sparkline stays evenly spaced, never sparse.
  const zeroDays = summary.strip.filter((b) => b.sessions === 0);
  assert.equal(zeroDays.length, 5);

  const summedFromStrip = summary.strip.reduce(
    (acc, b) => ({
      sessions: acc.sessions + b.sessions,
      costUsd: acc.costUsd + b.costUsd,
      tokensIn: acc.tokensIn + b.tokensIn,
      tokensOut: acc.tokensOut + b.tokensOut,
    }),
    { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
  );
  assert.deepEqual(summedFromStrip, summary.totals, "sum(strip) === totals, exactly — the WP1.6 invariant");
  assert.deepEqual(summary.totals, { sessions: 2, costUsd: 3, tokensIn: 30, tokensOut: 12 });
});

// ── (3)/(4) window boundaries ───────────────────────────────────────────────────────────────────

test("buildHubUsageSummary — a session outside the window is excluded; a wider `days` picks it back up", () => {
  const { repo, db } = openRepo();
  const role = repo.createAgentRole({
    name: "Researcher",
    systemPrompt: "p",
    defaultModel: "m",
    target: "t",
    expectedOutcome: "o",
  });
  const missionParent = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const mission = repo.createMission({
    sessionId: missionParent.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: {
      topology: "parallel",
      autonomy: "always_ask",
      agents: [
        {
          key: "a",
          roleId: role.id,
          name: "Researcher",
          systemPrompt: "p",
          model: "gpt-4o",
          toolGrants: { servers: {}, builtins: [] },
          skillIds: [],
          brief: "b",
          target: "t",
          expectedOutcome: "o",
        },
      ],
    },
  });
  const child = repo.createSession({
    mode: "chat",
    model: "gpt-4o",
    kind: "agent",
    parentSessionId: missionParent.id,
    missionId: mission.id,
  });
  repo.updateMission(mission.id, { agentSessionIds: [child.id] });
  setCreatedAt(db, child.id, isoDaysAgo(45));
  repo.setSessionLifecycle(child.id, { costUsd: 9, tokensIn: 90, tokensOut: 40 });

  const narrow = buildHubUsageSummary(repo, "agent", role.id, { days: 30 });
  assert.deepEqual(narrow.totals, { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });

  const wide = buildHubUsageSummary(repo, "agent", role.id, { days: 60 });
  assert.deepEqual(wide.totals, { sessions: 1, costUsd: 9, tokensIn: 90, tokensOut: 40 });
  assert.equal(wide.strip.length, 60);
});

// ── (5) unknown entity 404s ─────────────────────────────────────────────────────────────────────

test("buildHubUsageSummary — an unknown agent/crew/project id throws (404), never a fabricated summary", () => {
  const { repo } = openRepo();
  assert.throws(() => buildHubUsageSummary(repo, "agent", "role-does-not-exist"), /404|not found/i);
  assert.throws(() => buildHubUsageSummary(repo, "crew", "crew-does-not-exist"), /404|not found/i);
  assert.throws(() => buildHubUsageSummary(repo, "project", "project-does-not-exist"), /404|not found/i);
});

// ── (6) model/mode have no backing entity — zero matches is an honest all-zero summary ─────────────

test("buildHubUsageSummary(groupBy:'model'|'mode') — no backing entity; zero-match ids return an all-zero summary, not a 404", () => {
  const { repo } = openRepo();
  const modelSummary = buildHubUsageSummary(repo, "model", "some-model-nobody-used", { days: 7 });
  assert.equal(modelSummary.label, "some-model-nobody-used");
  assert.deepEqual(modelSummary.totals, { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });

  const modeSummary = buildHubUsageSummary(repo, "mode", "research", { days: 7 });
  assert.equal(modeSummary.label, "Research");
  assert.deepEqual(modeSummary.totals, { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
});

// ── (7) the real route ──────────────────────────────────────────────────────────────────────────

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

async function buildApp(repo: HubRepository, db: AppDatabase): Promise<{ app: FastifyInstance; port: number }> {
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
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
  return { app, port };
}

test("GET /api/hub/usage/summary — round-trips through the real route", async () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const repo = new HubRepository(db);
  const crew = repo.createCrew({ name: "Crew X", topology: "parallel", members: [] });
  const session = repo.createSession({ mode: "mission", model: "claude-opus-4-8", crewId: crew.id });
  repo.setSessionLifecycle(session.id, { costUsd: 2.5, tokensIn: 25, tokensOut: 10 });

  const { port } = await buildApp(repo, db);

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/usage/summary?groupBy=crew&id=${crew.id}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as HubUsageSummary;
  assert.equal(body.label, "Crew X");
  assert.equal(body.strip.length, 30, "default window is 30 days");
  assert.equal(body.totals.costUsd, 2.5);

  const withDays = await fetch(
    `http://127.0.0.1:${port}/api/hub/usage/summary?groupBy=crew&id=${crew.id}&days=5`,
  );
  assert.equal(withDays.status, 200);
  const withDaysBody = (await withDays.json()) as HubUsageSummary;
  assert.equal(withDaysBody.strip.length, 5);

  // Out-of-bounds `days` is rejected (zod min/max), not silently clamped.
  const tooWide = await fetch(
    `http://127.0.0.1:${port}/api/hub/usage/summary?groupBy=crew&id=${crew.id}&days=91`,
  );
  assert.equal(tooWide.status, 400);
  const tooNarrow = await fetch(
    `http://127.0.0.1:${port}/api/hub/usage/summary?groupBy=crew&id=${crew.id}&days=0`,
  );
  assert.equal(tooNarrow.status, 400);

  // Missing required params (groupBy, id) are rejected.
  const missingId = await fetch(`http://127.0.0.1:${port}/api/hub/usage/summary?groupBy=crew`);
  assert.equal(missingId.status, 400);

  // An unknown crew id surfaces as a real 404 through the route, not a swallowed empty summary.
  const unknown = await fetch(`http://127.0.0.1:${port}/api/hub/usage/summary?groupBy=crew&id=nope`);
  assert.equal(unknown.status, 404);
});
