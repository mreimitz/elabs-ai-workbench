import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { runPlanEstimateSchema } from "@mcp-token-footprint/shared";
import { type AppDatabase, applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerEstimateRoutes } from "../src/estimate/routes.js";
import { resetPricingResolver } from "../src/providers/pricing.js";
import { ScanRepository } from "../src/scans/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// RM-33 WP 2.1 — the `GET /api/estimate/run-plan` WIRE, end to end over the real route + services.
//
// Two things are pinned here that a pure-math test cannot reach:
//  1. The response is ADDITIVE — every field it carried before WP 2.1 is still there under the same
//     name, and the body validates against the `.strict()` shared schema, so an undeclared extra key
//     is a failure rather than an undocumented one.
//  2. The service passes the WHOLE resolved price through. It used to narrow it to
//     `{ inPer1M, outPer1M }`, throwing `cachedInPer1M` away — which is exactly what made the preview
//     cache-blind. The only way to observe that from here is a REAL model id whose entry publishes a
//     cache-read rate: if the narrowing came back, `cachingAssumed` goes false and the band collapses.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  resetPricingResolver();
});

const NOW = "2026-08-21T00:00:00.000Z";

/** A model whose pricing entry publishes a cache-read rate ($3 / $15 / $0.3 — see `pricing.ts`). */
const CACHING_MODEL = "claude-sonnet-4-6";

type Harness = { base: string; testId: string; environmentId: string };

async function makeHarness(model = CACHING_MODEL): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });

  const scenarios = new ScenarioService(new ScenarioRepository(db));
  const tests = new TestService(new TestRepository(db));
  const scans = new ScanRepository(db);

  const environment = scenarios.create({
    name: "Cached environment",
    providerId: "prov-1",
    model,
    params: {},
    systemPrompt: "You are a careful analyst.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  const testRow = tests.create({
    name: "A test",
    userPrompt: "Summarise the fleet.",
    addedProfiles: [],
    tags: [],
  });

  const app = Fastify({ logger: false });
  // The same error mapping the real app installs (`apps/api/src/index.ts`).
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });
  // RM-34 WP 1.2 — the real repository over the same in-memory DB. This harness seeds no runs, so
  // every environment resolves to `basis: "default"` — which is exactly the pre-RM-34 arithmetic.
  await registerEstimateRoutes(app, { scenarios, tests, scans, runs: new RunRepository(db) });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);

  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  return {
    base: `http://127.0.0.1:${address.port}`,
    testId: testRow.id,
    environmentId: environment.id,
  };
}

async function estimate(h: Harness): Promise<unknown> {
  const url = `${h.base}/api/estimate/run-plan?testIds=${h.testId}&environmentIds=${h.environmentId}&repetitions=1`;
  const response = await fetch(url);
  const raw = await response.text();
  assert.equal(response.status, 200, raw);
  return JSON.parse(raw);
}

test("WP2.1 (Acceptance 5) — the response is additive: every pre-WP-2.1 field survives, verbatim", async () => {
  const h = await makeHarness();
  const body = (await estimate(h)) as Record<string, unknown>;

  // The exact key set the endpoint answered with BEFORE this WP. None may be removed or renamed.
  for (const key of [
    "testCount",
    "environmentCount",
    "repetitions",
    "totalRuns",
    "tokens",
    "costUsd",
    "unpricedEnvironmentCount",
    "uncappedEnvironmentCount",
    "environments",
  ]) {
    assert.ok(key in body, `the estimate lost the pre-WP-2.1 field ${key}`);
  }
  const row = (body.environments as Array<Record<string, unknown>>)[0];
  assert.ok(row);
  for (const key of [
    "environmentId",
    "name",
    "model",
    "priced",
    "footprintTokens",
    "hasCostCap",
    "tokens",
    "costUsd",
  ]) {
    assert.ok(key in row, `the environment row lost the pre-WP-2.1 field ${key}`);
  }

  // …and nothing UNDECLARED slipped onto the wire: the shared schema is `.strict()`.
  const parsed = runPlanEstimateSchema.parse(body);
  assert.equal(parsed.totalRuns, 1);
  assert.equal(parsed.environments.length, 1);
});

test("WP2.1 — the service hands the estimator the WHOLE resolved price, cache rates included", async () => {
  const h = await makeHarness(CACHING_MODEL);
  const body = runPlanEstimateSchema.parse(await estimate(h));

  assert.equal(body.cachingAssumed, true, `${CACHING_MODEL} publishes a cache-read rate`);
  assert.equal(body.environments[0]?.cachingAssumed, true);
  assert.ok(
    body.costUsd.low < body.costUsd.high,
    "a cache-priced model must produce an OPEN band; a collapsed one means the price was narrowed again",
  );
  assert.ok(body.costUsd.low > 0, "the low end is a discount, not a free run");
});

test("WP2.1 — an unpriced model still reports unpriced, with no dollars and no caching claim", async () => {
  const h = await makeHarness("not-a-real-model-id");
  const body = runPlanEstimateSchema.parse(await estimate(h));

  assert.equal(body.unpricedEnvironmentCount, 1);
  assert.equal(body.environments[0]?.priced, false);
  assert.equal(body.environments[0]?.reason, "Unpriced model");
  assert.equal(body.environments[0]?.costUsd, undefined);
  assert.equal(body.cachingAssumed, false);
  assert.equal(body.costUsd.low, 0);
  assert.equal(body.costUsd.high, 0);
});
