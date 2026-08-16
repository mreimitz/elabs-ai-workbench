import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AssistantAuthService } from "../src/assistant/auth-service.js";
import type { AssistantSessionManager } from "../src/assistant/session-manager.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";
import { ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository } from "../src/scans/repository.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

// Assistant Refinement R3 (WP R3.1) — `GET /api/assistant/starters` wired through the REAL Fastify
// route (zod query parsing → `deriveStarters`), mirroring `assistant-models-route.test.ts`'s pattern:
// `auth`/`sessions` are never exercised by this route (routes stay thin — see `routes.ts`), so bare
// casts stand in for them; `deriveStarters` itself is exhaustively covered by `assistant-starters.test.ts`.

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function buildApp(): FastifyInstance {
  const app = Fastify();
  // Mirrors the central error handler `index.ts` registers app-wide (ZodError -> 400) — a bare
  // Fastify() instance in a route test has no such handler, so an unmapped thrown ZodError would
  // otherwise 500 (Fastify's own default), same fix as every other *-route.test.ts in this suite.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    throw error;
  });
  apps.push(app);
  return app;
}

function buildDb(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db);
  databases.push(db);
  return db;
}

async function registerWithStarterDeps(app: FastifyInstance, db: AppDatabase) {
  const secrets = new SecretStore(Buffer.alloc(32, 3));
  await registerAssistantRoutes(app, {
    auth: {} as AssistantAuthService,
    sessions: {} as AssistantSessionManager,
    models: [],
    starters: {
      scans: new ScanRepository(db),
      servers: new ServerRepository(db, secrets),
      runs: new RunRepository(db),
      suiteRuns: new SuiteRunRepository(db),
      skills: new SkillRepository(db, secrets),
      skillQualityL2TokenCeiling: 5000,
    },
  });
}

test("GET /api/assistant/starters with no query returns the global base set", async () => {
  const app = buildApp();
  await registerWithStarterDeps(app, buildDb());

  const res = await app.inject({ method: "GET", url: "/api/assistant/starters" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.surface, "global");
  assert.equal(body.version, 1);
  assert.deepEqual(
    body.starters.map((s: { id: string }) => s.id),
    ["global.most-expensive-server", "global.token-savings", "global.recent-failures"],
  );
});

test("GET /api/assistant/starters?entityKind=collection&entityId=… returns the collection surface with its action starter", async () => {
  const app = buildApp();
  await registerWithStarterDeps(app, buildDb());

  const res = await app.inject({
    method: "GET",
    url: "/api/assistant/starters?entityKind=collection&entityId=col-1",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.surface, "collection");
  assert.ok(body.starters.some((s: { id: string }) => s.id === "collection.organize"));
});

test("GET /api/assistant/starters?route=… resolves compare/compatibility without an entity pin", async () => {
  const app = buildApp();
  await registerWithStarterDeps(app, buildDb());

  const compareRes = await app.inject({
    method: "GET",
    url: `/api/assistant/starters?route=${encodeURIComponent("/compare/scans")}`,
  });
  assert.equal(compareRes.json().surface, "compare");

  const compatRes = await app.inject({
    method: "GET",
    url: `/api/assistant/starters?route=${encodeURIComponent("/testing/compatibility")}`,
  });
  assert.equal(compatRes.json().surface, "compatibility");
});

test("GET /api/assistant/starters?entityKind=<invalid> is rejected with 400 (zod enum validation)", async () => {
  const app = buildApp();
  await registerWithStarterDeps(app, buildDb());

  const res = await app.inject({
    method: "GET",
    url: "/api/assistant/starters?entityKind=not-a-kind",
  });
  assert.equal(res.statusCode, 400);
});

test("GET /api/assistant/starters is a pure read: never mutates the DB, and never touches auth/sessions", async () => {
  const app = buildApp();
  const db = buildDb();
  await registerWithStarterDeps(app, db);

  const countBefore = (db.prepare("SELECT COUNT(*) AS n FROM mcp_servers").get() as { n: number })
    .n;
  const res = await app.inject({
    method: "GET",
    url: "/api/assistant/starters?entityKind=server&entityId=nope",
  });
  assert.equal(res.statusCode, 200);
  const countAfter = (db.prepare("SELECT COUNT(*) AS n FROM mcp_servers").get() as { n: number }).n;
  assert.equal(countAfter, countBefore);
});
