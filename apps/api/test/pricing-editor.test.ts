// Observability WP2.6 (D-OB22) — DB-backed model pricing editor. Proves the MONEY-CORRECTNESS
// invariants that are the review focus:
//
//   1. SEED PARITY — a freshly migrated DB reproduces the code table's prices EXACTLY (every row),
//      and `estimateCost` is byte-identical with the DB resolver installed vs. the code table.
//   2. PRECEDENCE — exact > regex; within a tier the newest `effective_from <= at` wins; a
//      future-dated entry is INERT until its date (fake-clock via the `at` parameter).
//   3. HISTORICAL-COST IMMUTABILITY — editing a price changes NEW computations only; a recorded
//      run's `cost_usd` is BYTE-IDENTICAL after any pricing edit (nothing recomputes it).
//   4. REGEX SAFETY — an invalid regex is rejected 400 at write (create + patch); a malformed
//      stored pattern never crashes resolution.
//   5. FALLBACK — with the resolver installed, a DB miss falls back to the code table (logged).
//   6. UNPRICED GUARDRAIL UNCHANGED — a genuinely unknown model stays price-unknown (isModelPriced
//      false / cost 0) with AND without the resolver (the cost-cap-rejects-unpriced behavior).
//   7. CRUD — round-trips over `/api/pricing`; `seed` rows are read-only (patch/delete → 400).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { ModelPricingEntry, TokenUsageActual } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { PricingRepository } from "../src/providers/pricing-repository.js";
import { registerPricingRoutes } from "../src/providers/pricing-routes.js";
import {
  buildSeedPricingRows,
  estimateCost,
  installPricingResolver,
  isModelPriced,
  MODEL_PRICING,
  resetPricingResolver,
} from "../src/providers/pricing.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-07-16T00:00:00.000Z";
const dbs: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  // CRITICAL: never leak an installed resolver into another test file — restore the code-table default.
  resetPricingResolver();
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  dbs.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

async function setup(): Promise<{ db: AppDatabase; repo: PricingRepository; app: FastifyInstance }> {
  const db = openFresh();
  const repo = new PricingRepository(db);
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerPricingRoutes(app, repo);
  await app.ready();
  apps.push(app);
  return { db, repo, app };
}

let seq = 0;
/** Seed one provider/scenario/test + a completed run with a recorded `cost_usd`; returns the run id. */
function seedRun(db: AppDatabase, costUsd: number): string {
  const n = seq++;
  const providerId = `prov-${n}`;
  const scenarioId = `scn-${n}`;
  const testId = `test-${n}`;
  const runId = `run-${n}`;
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(providerId, "openai", "OpenAI", NOW, NOW);
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run(scenarioId, `Scenario ${n}`, providerId, "gpt-4o", NOW, NOW);
  db.prepare("INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES (?,?,?,?,?)").run(
    testId,
    `Test ${n}`,
    "go",
    NOW,
    NOW,
  );
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd, tokens_in, tokens_out)
     VALUES (?,?,?,'automated','completed',?,?,?,?)`,
  ).run(runId, testId, scenarioId, NOW, costUsd, 0, 0);
  return runId;
}

const SAMPLE_USAGE: TokenUsageActual = {
  inputTokens: 12_345,
  outputTokens: 6_789,
  cacheReadTokens: 2_000,
  cacheWriteTokens: 500,
};

// ── (1) Seed parity ──────────────────────────────────────────────────────────────────────────────

test("seed parity — a freshly migrated DB reproduces EVERY code-table price exactly", () => {
  const db = openFresh();
  const repo = new PricingRepository(db);
  const models = Object.keys(MODEL_PRICING);
  assert.ok(models.length >= 20, "sanity: the code table has many models to check");

  for (const model of models) {
    const code = MODEL_PRICING[model];
    assert.ok(code, `code table has ${model}`);
    const resolved = repo.resolve(model);
    assert.ok(resolved, `DB resolves ${model}`);
    assert.equal(resolved.inPer1M, code.inPer1M, `${model} input rate`);
    assert.equal(resolved.outPer1M, code.outPer1M, `${model} output rate`);
    assert.equal(resolved.cachedInPer1M, code.cachedInPer1M, `${model} cache-read rate`);
    // Seed rows never carry an explicit cache-WRITE rate — it stays derived (parity with the code path).
    assert.equal(resolved.cacheWritePer1M, undefined, `${model} cache-write stays derived`);
  }

  const seedCount = db.prepare("SELECT COUNT(*) AS n FROM model_pricing WHERE source='seed'").get() as {
    n: number;
  };
  assert.equal(seedCount.n, models.length, "exactly one seed row per code-table model");
  assert.equal(buildSeedPricingRows().length, models.length, "seed builder matches the code table");
});

test("seed parity — estimateCost is byte-identical with the DB resolver installed vs. the code table", () => {
  const db = openFresh();
  for (const model of Object.keys(MODEL_PRICING)) {
    resetPricingResolver();
    const codeCost = estimateCost(model, SAMPLE_USAGE);
    installPricingResolver(new PricingRepository(db));
    const dbCost = estimateCost(model, SAMPLE_USAGE);
    resetPricingResolver();
    assert.equal(dbCost, codeCost, `estimateCost parity for ${model}`);
  }
});

// ── (2) Precedence + effective dating ──────────────────────────────────────────────────────────────

test("precedence — an EXACT match beats a regex match regardless of price", () => {
  const db = openFresh();
  const repo = new PricingRepository(db);
  // A regex row that matches every gpt-*, priced absurdly high…
  repo.create({ provider: "openai", modelMatch: "^gpt-", isRegex: true, inputPerMTok: 999, outputPerMTok: 999 });
  // …and a much cheaper EXACT row for gpt-4o.
  repo.create({ provider: "openai", modelMatch: "gpt-4o", isRegex: false, inputPerMTok: 1, outputPerMTok: 2 });

  assert.equal(repo.resolve("gpt-4o")?.inPer1M, 1, "exact wins over regex even when pricier");
  // A gpt id with NO exact row (not seeded) falls through to the regex.
  assert.equal(repo.resolve("gpt-4o-2099-01-01")?.inPer1M, 999, "no exact match → the regex applies");
});

test("precedence — newest effective_from wins; a FUTURE-dated row is inert until its date (fake clock)", () => {
  const db = openFresh();
  const repo = new PricingRepository(db);
  const model = "gpt-4o";
  repo.create({
    provider: "openai",
    modelMatch: model,
    inputPerMTok: 10,
    outputPerMTok: 10,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  });
  repo.create({
    provider: "openai",
    modelMatch: model,
    inputPerMTok: 20,
    outputPerMTok: 20,
    effectiveFrom: "2030-01-01T00:00:00.000Z",
  });

  // Before the 2030 row: it is INERT; the 2026 row wins.
  assert.equal(repo.resolve(model, { at: "2027-06-01T00:00:00.000Z" })?.inPer1M, 10, "future row inert");
  // After it: the newest effective row wins.
  assert.equal(
    repo.resolve(model, { at: "2031-01-01T00:00:00.000Z" })?.inPer1M,
    20,
    "newest effective_from wins once effective",
  );
  // Before EITHER user row (but after the far-past seed): the seed baseline applies.
  const seed = MODEL_PRICING[model];
  assert.ok(seed);
  assert.equal(
    repo.resolve(model, { at: "2020-01-01T00:00:00.000Z" })?.inPer1M,
    seed.inPer1M,
    "before any user row, the seed applies",
  );
});

// ── (3) Historical-cost immutability (the LangSmith invariant) ─────────────────────────────────────

test("money — editing a price changes NEW costs only; a recorded run's cost_usd is byte-identical", () => {
  const db = openFresh();
  const repo = new PricingRepository(db);
  installPricingResolver(repo);
  const model = "gpt-4o";
  const usage: TokenUsageActual = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  // Compute + PERSIST a run cost at the seed price (P1).
  const c1 = estimateCost(model, usage);
  assert.ok(c1 > 0, "sanity: the seeded model is priced");
  const runId = seedRun(db, c1);
  const before = (db.prepare("SELECT cost_usd FROM runs WHERE id = ?").get(runId) as { cost_usd: number })
    .cost_usd;
  assert.equal(before, c1, "the run stored its computed cost");

  // EDIT the price sharply upward (effective now).
  repo.create({ provider: "openai", modelMatch: model, inputPerMTok: 500, outputPerMTok: 500 });

  // The recorded run is NEVER recomputed — byte-identical.
  const after = (db.prepare("SELECT cost_usd FROM runs WHERE id = ?").get(runId) as { cost_usd: number })
    .cost_usd;
  assert.equal(after, before, "recorded cost_usd is BYTE-IDENTICAL after the price edit");

  // But a NEW computation reflects the edit.
  const c2 = estimateCost(model, usage);
  assert.notEqual(c2, c1, "a new computation reflects the edited price");
  assert.equal(c2, 1000, "500/1M in + 500/1M out over 1M+1M tokens = $1000");
});

// ── (4) Regex safety ───────────────────────────────────────────────────────────────────────────────

test("regex safety — an invalid regex is rejected 400 at write (create AND patch)", async () => {
  const { app } = await setup();

  const badCreate = await app.inject({
    method: "POST",
    url: "/api/pricing",
    payload: { provider: "openai", modelMatch: "(unclosed", isRegex: true, inputPerMTok: 1, outputPerMTok: 1 },
  });
  assert.equal(badCreate.statusCode, 400, "invalid regex rejected at create");

  const ok = await app.inject({
    method: "POST",
    url: "/api/pricing",
    payload: { provider: "openai", modelMatch: "^gpt-", isRegex: true, inputPerMTok: 1, outputPerMTok: 1 },
  });
  assert.equal(ok.statusCode, 201);
  const id = (ok.json() as ModelPricingEntry).id;

  const badPatch = await app.inject({
    method: "PATCH",
    url: `/api/pricing/${id}`,
    payload: { modelMatch: "(also-unclosed" },
  });
  assert.equal(badPatch.statusCode, 400, "invalid regex rejected at patch (over the effective value)");
});

test("regex safety — a malformed STORED pattern never crashes resolution", () => {
  const db = openFresh();
  const repo = new PricingRepository(db);
  // Insert a malformed regex row DIRECTLY, bypassing the write-time compile check.
  db.prepare(
    `INSERT INTO model_pricing
       (id, provider, model_match, is_regex, input_per_mtok, output_per_mtok,
        cache_read_per_mtok, cache_write_per_mtok, effective_from, created_at, source)
     VALUES ('bad','openai','(unclosed',1,1,1,NULL,NULL,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z','user')`,
  ).run();

  assert.doesNotThrow(() => repo.resolve("gpt-4o"), "a malformed pattern must not crash resolution");
  const seed = MODEL_PRICING["gpt-4o"];
  assert.ok(seed);
  assert.equal(repo.resolve("gpt-4o")?.inPer1M, seed.inPer1M, "the bad row just doesn't match; the seed resolves");
});

test("money — a NEGATIVE price is rejected 400 (never corrupt the spend cap)", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/pricing",
    payload: { provider: "openai", modelMatch: "gpt-x", inputPerMTok: -1, outputPerMTok: 1 },
  });
  assert.equal(res.statusCode, 400);
});

// ── (5) Belt-and-braces fallback ─────────────────────────────────────────────────────────────────

test("fallback — with the resolver installed, a DB miss falls back to the code table", () => {
  const db = openFresh();
  const repo = new PricingRepository(db);
  installPricingResolver(repo);
  // Remove the seed row so the DB no longer prices gpt-4o (the code table still does).
  db.prepare("DELETE FROM model_pricing WHERE model_match = 'gpt-4o' AND source = 'seed'").run();
  assert.equal(repo.resolve("gpt-4o"), undefined, "sanity: the DB now misses gpt-4o");

  const seed = MODEL_PRICING["gpt-4o"];
  assert.ok(seed);
  const cost = estimateCost("gpt-4o", { inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cost, seed.inPer1M, "estimateCost still prices via the code-table fallback");
  assert.equal(isModelPriced("gpt-4o"), true, "still reported as priced via the fallback");
});

// ── (6) Unpriced guardrail unchanged ─────────────────────────────────────────────────────────────

test("unpriced guardrail — a genuinely unknown model stays price-unknown (with AND without the resolver)", () => {
  const db = openFresh();
  const model = "totally-unknown-model-xyz";
  const usage: TokenUsageActual = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  resetPricingResolver();
  assert.equal(isModelPriced(model), false, "unpriced with no resolver (pre-WP2.6 behavior)");
  assert.equal(estimateCost(model, usage), 0, "cost 0 with no resolver");

  installPricingResolver(new PricingRepository(db));
  assert.equal(isModelPriced(model), false, "STILL unpriced with the DB resolver (DB + code both miss)");
  assert.equal(estimateCost(model, usage), 0, "cost still 0 → the spend cap still rejects it");
});

// ── (7) CRUD + seed read-only ─────────────────────────────────────────────────────────────────────

test("CRUD — user rows round-trip; seed rows are read-only (patch/delete → 400)", async () => {
  const { app } = await setup();

  const listed = await app.inject({ method: "GET", url: "/api/pricing" });
  assert.equal(listed.statusCode, 200);
  const all = listed.json() as ModelPricingEntry[];
  assert.ok(all.length >= 20, "the seed populated the list");
  const seed = all.find((e) => e.source === "seed");
  assert.ok(seed, "there are seed rows");

  const patchSeed = await app.inject({
    method: "PATCH",
    url: `/api/pricing/${seed.id}`,
    payload: { inputPerMTok: 1 },
  });
  assert.equal(patchSeed.statusCode, 400, "a seed row is read-only");
  const delSeed = await app.inject({ method: "DELETE", url: `/api/pricing/${seed.id}` });
  assert.equal(delSeed.statusCode, 400, "a seed row can't be deleted");

  const created = await app.inject({
    method: "POST",
    url: "/api/pricing",
    payload: { provider: "anthropic", modelMatch: "claude-custom", inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
  });
  assert.equal(created.statusCode, 201);
  const entry = created.json() as ModelPricingEntry;
  assert.equal(entry.source, "user");
  assert.equal(entry.inputPerMTok, 3);
  assert.equal(entry.cacheReadPerMTok, 0.3);
  assert.ok(entry.effectiveFrom, "effectiveFrom defaulted to now");

  const patched = await app.inject({
    method: "PATCH",
    url: `/api/pricing/${entry.id}`,
    payload: { outputPerMTok: 20 },
  });
  assert.equal(patched.statusCode, 200);
  const patchedEntry = patched.json() as ModelPricingEntry;
  assert.equal(patchedEntry.outputPerMTok, 20, "patch applied");
  assert.equal(patchedEntry.inputPerMTok, 3, "patch preserves untouched fields");

  const del = await app.inject({ method: "DELETE", url: `/api/pricing/${entry.id}` });
  assert.equal(del.statusCode, 204);
  const after = await app.inject({ method: "GET", url: `/api/pricing/${entry.id}` });
  assert.equal(after.statusCode, 404, "the deleted user row is gone");
});
