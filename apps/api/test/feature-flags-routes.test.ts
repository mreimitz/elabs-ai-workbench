import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  APP_FEATURE_META,
  APP_SETTING_FEATURES_KEY,
  DEFAULT_APP_FEATURE_FLAGS,
  FEATURE_DISABLED_ERROR_CODE,
  featureForPath,
  pathMatchesPrefix,
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

  // Stand-ins for the routes the two assistant features own, registered AFTER the guard exactly the
  // way `index.ts` registers the real ones — this also proves the root hook covers later routes.
  // `/api/assistant/threads` belongs to the DOCK (`app_assistant`), `/api/hub/sessions` to the
  // WORKSPACE (`assistant`), and `/api/assistant/auth/status` to NEITHER — it is the shared Claude
  // sign-in the workspace's own subscription adapter runs on, so the dock's switch must not touch it.
  app.get("/api/assistant/threads", async () => ({ ok: true }));
  app.get("/api/assistant/auth/status", async () => ({ ok: true }));
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
  for (const path of [
    "/api/assistant/threads",
    "/api/assistant/auth/status",
    "/api/hub/sessions",
    "/api/scans",
  ]) {
    assert.equal((await fetch(`${h.baseUrl}${path}`)).status, 200, path);
  }
});

// ── The two assistants are INDEPENDENT switches ───────────────────────────────────────────────────
//
// They were a single `assistant` flag until 2026-08-21, so switching the full-page workspace off also
// killed the right-hand dock — the defect these three tests pin closed. `assistant` owns `/api/hub`,
// `app_assistant` owns `/api/assistant`, and neither owns `/api/assistant/auth` (the shared Claude
// sign-in, which the workspace's own subscription adapter runs on).

test("turning the workspace off 403s /api/hub and leaves the dock's endpoints alone", async () => {
  const h = await makeApp();
  await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assistant: false }),
  });

  const blocked = await fetch(`${h.baseUrl}/api/hub/sessions`);
  assert.equal(blocked.status, 403);
  const body = (await blocked.json()) as { error: string; code?: string };
  assert.equal(body.code, FEATURE_DISABLED_ERROR_CODE);
  assert.match(body.error, /Settings › Features/);

  // THE REGRESSION: the dock is a different feature and must keep answering.
  for (const path of ["/api/assistant/threads", "/api/assistant/auth/status"]) {
    assert.equal((await fetch(`${h.baseUrl}${path}`)).status, 200, path);
  }
});

test("turning the dock off 403s /api/assistant and leaves the workspace alone", async () => {
  const h = await makeApp();
  await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_assistant: false }),
  });

  const blocked = await fetch(`${h.baseUrl}/api/assistant/threads`);
  assert.equal(blocked.status, 403);
  const body = (await blocked.json()) as { error: string; code?: string };
  assert.equal(body.code, FEATURE_DISABLED_ERROR_CODE);
  assert.match(body.error, /Settings › Features/);

  // The workspace is a different feature and must keep answering.
  assert.equal((await fetch(`${h.baseUrl}/api/hub/sessions`)).status, 200);
});

test("the shared Claude sign-in survives the dock being switched off", async () => {
  const h = await makeApp();
  h.features.setFlags({ app_assistant: false });

  // `/api/assistant/auth/*` sits UNDER the dock's own `/api/assistant` prefix but is exempted from it:
  // Settings › Assistant drives this sign-in and the Hub's subscription adapter runs on the credential
  // it stores, so a switched-off dock must not lock the owner out of the workspace.
  for (const path of ["/api/assistant/auth", "/api/assistant/auth/status"]) {
    assert.equal(h.features.blockingFeature(path), undefined, path);
  }
  assert.equal((await fetch(`${h.baseUrl}/api/assistant/auth/status`)).status, 200);

  // The exemption is a prefix, not a substring: a sibling that merely STARTS with the same letters is
  // still the dock's, and still blocked.
  assert.equal(h.features.blockingFeature("/api/assistant/authorize")?.id, "app_assistant");

  // Switching BOTH off still leaves the sign-in reachable — it belongs to neither feature.
  h.features.setFlags({ assistant: false });
  assert.equal((await fetch(`${h.baseUrl}/api/assistant/auth/status`)).status, 200);
});

test("a disabled feature never blocks unrelated routes or the flags endpoint itself", async () => {
  const h = await makeApp();
  await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_assistant: false }),
  });

  assert.equal((await fetch(`${h.baseUrl}/api/scans`)).status, 200);
  // Still readable AND still writable — otherwise the switch could never be flipped back on.
  assert.equal((await fetch(`${h.baseUrl}/api/features`)).status, 200);
  const back = await fetch(`${h.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_assistant: true }),
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
  const resolved = h.features.refresh();
  assert.equal(resolved.assistant, true);
  assert.equal(resolved.app_assistant, true);
  assert.equal((await fetch(`${h.baseUrl}/api/assistant/threads`)).status, 200);
  assert.equal((await fetch(`${h.baseUrl}/api/hub/sessions`)).status, 200);
});

// ── Path shapes — a percent-encoded path must not slip past the feature guard ─────────────────────
//
// Same defect class as the service-token guard (see `api-tokens-guard.test.ts`): Fastify's router
// percent-decodes before matching while `request.url` stays raw, so a guard that prefix-matched the
// raw string read `/%61pi/assistant/threads` (`%61` = `a`) as "no feature owns this" and waved it
// through to the real handler. That defeats this guard's entire purpose — "a stale tab, a bookmarked
// deep link, or a direct curl" could keep driving a switched-off feature and keep spending on it.
//
// Both halves are asserted: the status, AND that the request reached no application handler.

test("a percent-encoded path cannot slip past the feature guard while the feature is OFF", async () => {
  const h = await makeApp();
  // Both off: the list below spans BOTH features' prefixes, so each entry is genuinely owned.
  h.features.setFlags({ assistant: false, app_assistant: false });

  for (const path of [
    "/api/assistant/threads", // the plain form — the baseline
    "/%61pi/assistant/threads", // %61 = 'a' — the bypass this pins closed
    "/api/%61ssistant/threads", // an encoded byte in a later segment
    "/%61pi/%68ub/sessions", // several encoded segments at once
    "/api/hub/sessions?limit=5", // a query string never hid the path, and still doesn't
  ]) {
    const response = await fetch(`${h.baseUrl}${path}`);
    assert.equal(response.status, 403, path);
    const body = (await response.json()) as { error: string; code?: string };
    assert.equal(body.code, FEATURE_DISABLED_ERROR_CODE, path);
  }
});

test("normalization does not make the feature guard block routes no feature owns", async () => {
  const h = await makeApp();
  h.features.setFlags({ assistant: false, app_assistant: false });

  // An unrelated route stays reachable in BOTH spellings — the hardening must not turn into a
  // blanket refusal of anything containing an escape.
  for (const path of ["/api/scans", "/%61pi/scans"]) {
    const response = await fetch(`${h.baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { ok: true }, path);
  }

  // …and the flags endpoint itself is still reachable however it is spelled, so the switch can
  // always be flipped back on.
  assert.equal((await fetch(`${h.baseUrl}/%61pi/features`)).status, 200);
});

test("blockingFeature matches the decoded path directly (the unit behind the two tests above)", async () => {
  const h = await makeApp();
  h.features.setFlags({ assistant: false, app_assistant: false });

  assert.equal(h.features.blockingFeature("/api/assistant/x")?.id, "app_assistant");
  assert.equal(h.features.blockingFeature("/%61pi/assistant/x")?.id, "app_assistant");
  assert.equal(h.features.blockingFeature("/api/%61ssistant/x")?.id, "app_assistant");
  assert.equal(h.features.blockingFeature("/api/hub/x")?.id, "assistant");
  assert.equal(h.features.blockingFeature("/%61pi/hub/x")?.id, "assistant");
  // The exemption relaxes only on the plain spelling. An ENCODED spelling of it stays blocked, and
  // that asymmetry is deliberate — the same one the service-token guard documents (D-MCP9): a rule
  // that *governs* matches the union of every interpretation, a rule that *relaxes* must not. Fastify
  // would decode `%61uth` and dispatch to the sign-in handler, so relaxing on a candidate the guard
  // has not itself decoded would hand an attacker a spelling that walks past the switch. Refusing an
  // oddly-spelled sign-in is a nuisance; waving one through is a hole.
  assert.equal(h.features.blockingFeature("/api/assistant/auth/status"), undefined);
  assert.equal(h.features.blockingFeature("/api/assistant/%61uth/status")?.id, "app_assistant");
  assert.equal(h.features.blockingFeature("/api/scans"), undefined);
  assert.equal(h.features.blockingFeature("/%61pi/scans"), undefined);
  // A malformed escape decodes to nothing; it owns no feature and Fastify 400s it before the hook.
  assert.equal(h.features.blockingFeature("/%zz/api/assistant/x"), undefined);
});

// ── The exemption is a reviewed list, not a shape that can drift ──────────────────────────────────
//
// `app_assistant` governs `/api/assistant` MINUS `/api/assistant/auth`. Because the governed prefix is
// the whole tree, a NEW dock endpoint is covered automatically — the risk runs the other way: the
// exemption is a deliberate hole in a guard, and a hole widens by accident. So this walks the real
// route file and asserts the exempted set is EXACTLY the sign-in surface. Adding any route under
// `/api/assistant/auth`, or moving a dock route under it, turns this red and forces the decision to
// be made on purpose.

/** Every `/api/*` literal the assistant route file registers, any verb. */
async function declaredAssistantRoutes(): Promise<string[]> {
  const source = await readFile(new URL("../src/assistant/routes.ts", import.meta.url), "utf8");
  const paths = [
    ...source.matchAll(/\.(?:get|post|put|delete|patch)\s*\(\s*"(\/api\/[^"]+)"/g),
  ].map((match) => match[1] as string);
  // A sanity floor: if this reads zero the regex has drifted and every assertion below is vacuous.
  assert.ok(paths.length >= 15, `expected assistant route literals, got ${paths.length}`);
  return paths;
}

test("the dock flag's exemption covers exactly the shared sign-in, and nothing else", async () => {
  const declared = await declaredAssistantRoutes();
  const meta = APP_FEATURE_META.app_assistant;

  const owned = declared.filter((path) =>
    meta.apiPrefixes.some((prefix) => pathMatchesPrefix(path, prefix)),
  );
  // Partitioned by the LIVE matcher, not by re-implementing it here.
  const exempt = [...new Set(owned.filter((path) => featureForPath(path, "api") === undefined))];
  const governed = [...new Set(owned.filter((path) => featureForPath(path, "api")?.id === meta.id))];

  // Every owned path lands on exactly one side.
  assert.equal(exempt.length + governed.length, new Set(owned).size);

  // The exempt side, spelled out. This is the reviewed list — changing it is the point of the test.
  assert.deepEqual(exempt.sort(), [
    "/api/assistant/auth",
    "/api/assistant/auth/fallback",
    "/api/assistant/auth/oauth/cancel",
    "/api/assistant/auth/oauth/complete",
    "/api/assistant/auth/oauth/start",
    "/api/assistant/auth/status",
    "/api/assistant/auth/token",
  ]);

  // …and the dock's own working endpoints are on the governed side, so the exemption did not swallow
  // the feature it is carved out of.
  for (const path of [
    "/api/assistant/threads",
    "/api/assistant/models",
    "/api/assistant/starters",
  ]) {
    assert.ok(governed.includes(path), `${path} should be governed by the dock flag`);
  }
});
