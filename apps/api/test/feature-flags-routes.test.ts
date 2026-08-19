import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  APP_SETTING_FEATURES_KEY,
  DEFAULT_APP_FEATURE_FLAGS,
  FEATURE_DISABLED_ERROR_CODE,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerFeatureRoutes } from "../src/features/routes.js";
import { FeatureFlagsService } from "../src/features/service.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";

// Settings › Features — the feature-flag routes AND the `onRequest` guard, over a real Fastify app
// and a real SQLite `app_settings` KV. The point of these tests is the GUARD: hiding the nav is not
// an off-switch, so a disabled feature's API prefixes must answer 403 even to a caller that never
// saw the UI (a stale tab, a bookmark, a direct curl). Fully offline — no MCP, no provider key.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = {
  baseUrl: string;
  settings: AppSettingsRepository;
  features: FeatureFlagsService;
};

async function makeApp(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const settings = new AppSettingsRepository(db);
  const features = new FeatureFlagsService(settings);

  const app = Fastify({ logger: false });
  // The same mapping the real app installs (`apps/api/src/index.ts`), including the additive
  // machine-readable `code` a typed httpError carries — that is what the web client keys off.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const statusCode = typeof typed.statusCode === "number" ? typed.statusCode : 500;
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply.code(statusCode).send({ error: error.message, ...(code ? { code } : {}) });
  });

  registerFeatureRoutes(app, features);

  // Two stand-ins for the routes the Assistant feature owns, registered AFTER the guard exactly the
  // way `index.ts` registers the real ones — this also proves the root hook covers later routes.
  app.get("/api/assistant/threads", async () => ({ ok: true }));
  app.get("/api/hub/sessions", async () => ({ ok: true }));
  // A route no feature owns — must stay reachable no matter what is switched off.
  app.get("/api/scans", async () => ({ ok: true }));

  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, settings, features };
}

test("GET /api/features returns every feature enabled on a fresh database", async () => {
  const h = await makeApp();
  const response = await fetch(`${h.baseUrl}/api/features`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { flags: DEFAULT_APP_FEATURE_FLAGS });
});

test("PUT /api/features persists the patch and echoes the full map", async () => {
  const h = await makeApp();
  const response = await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assistant: false }),
  });
  assert.equal(response.status, 200);
  // The response echoes the COMPLETE map (every registered feature), not just the patched key —
  // built from the defaults here so registering another feature does not edit this assertion.
  const patched = { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false };
  assert.deepEqual(await response.json(), { flags: patched });

  // Persisted, not just cached: a fresh service over the same DB reads the stored value back. The KV
  // holds the RESOLVED full map (`FeatureFlagsService.setFlags` merges the patch over the defaults),
  // so a stored blob is always complete rather than a sparse diff.
  assert.deepEqual(h.settings.get(APP_SETTING_FEATURES_KEY), patched);
  assert.equal(new FeatureFlagsService(h.settings).getFlags().assistant, false);

  const readBack = await fetch(`${h.baseUrl}/api/features`);
  assert.deepEqual(await readBack.json(), { flags: patched });
});

test("PUT /api/features rejects an unknown feature id with 400", async () => {
  const h = await makeApp();
  const response = await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ghost: false }),
  });
  assert.equal(response.status, 400);
  // The unknown id changed nothing.
  assert.equal(h.features.getFlags().assistant, true);
});

test("the guard passes every request through while the feature is ON", async () => {
  const h = await makeApp();
  for (const path of ["/api/assistant/threads", "/api/hub/sessions", "/api/scans"]) {
    assert.equal((await fetch(`${h.baseUrl}${path}`)).status, 200, path);
  }
});

test("turning the Assistant off 403s BOTH of its API prefixes, with a machine-readable code", async () => {
  const h = await makeApp();
  await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assistant: false }),
  });

  for (const path of ["/api/assistant/threads", "/api/hub/sessions"]) {
    const response = await fetch(`${h.baseUrl}${path}`);
    assert.equal(response.status, 403, path);
    const body = (await response.json()) as { error: string; code?: string };
    assert.equal(body.code, FEATURE_DISABLED_ERROR_CODE, path);
    assert.match(body.error, /Settings › Features/);
  }
});

test("a disabled feature never blocks unrelated routes or the flags endpoint itself", async () => {
  const h = await makeApp();
  await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assistant: false }),
  });

  assert.equal((await fetch(`${h.baseUrl}/api/scans`)).status, 200);
  // Still readable AND still writable — otherwise the switch could never be flipped back on.
  assert.equal((await fetch(`${h.baseUrl}/api/features`)).status, 200);
  const back = await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assistant: true }),
  });
  assert.equal(back.status, 200);
  assert.equal((await fetch(`${h.baseUrl}/api/assistant/threads`)).status, 200);
});

test("the guard matches on the path only — a query string does not smuggle a request past it", async () => {
  const h = await makeApp();
  h.features.setFlags({ assistant: false });
  const response = await fetch(`${h.baseUrl}/api/hub/sessions?limit=5`);
  assert.equal(response.status, 403);
});

test("a corrupt stored blob resolves to ENABLED rather than taking the feature down", async () => {
  const h = await makeApp();
  // Write a shape that is valid JSON but not the flag map (the failure mode a hand-edited DB has).
  h.settings.put(APP_SETTING_FEATURES_KEY, "assistant=false");
  assert.equal(h.features.refresh().assistant, true);
  assert.equal((await fetch(`${h.baseUrl}/api/assistant/threads`)).status, 200);
});
