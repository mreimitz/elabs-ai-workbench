import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { JudgeSettingsResolved } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { CLI_JUDGE_DEFAULT_MODEL } from "../src/grading/claude-cli-judge.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import type { GradeService } from "../src/grading/grade-service.js";
import { registerGradingRoutes } from "../src/grading/routes.js";
import { RunReportService } from "../src/grading/run-report.js";
import { RunRepository } from "../src/testing/run-repository.js";

// Auto-Rating (WP 2.3) — the judge-settings routes: the resolved-source response + CLI-model persistence
// + the unpriced-PROVIDER guard. A real Fastify app + in-memory DB; `cliAvailable` is a plain fake boolean
// (no SDK, no subscription). Live CLI behaviour is OWNER-ACCEPTANCE — never faked here.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function makeApp(
  cliAvailable: boolean,
): Promise<{ app: FastifyInstance; settings: AppSettingsRepository }> {
  const db: AppDatabase = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const settings = new AppSettingsRepository(db);

  const app = Fastify({ logger: false });
  // Mirror index.ts's central error handler so a ZodError surfaces as 400 (the PUT parse path).
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });
  // The judge-settings routes never touch `grades` — a stub is sufficient for this suite. The report
  // service is real (cheap, real repos over the same in-memory db) — this suite doesn't exercise
  // `/api/runs/:id/report` but a stub would be a lie about what's wired.
  const runReports = new RunReportService(new GradeRepository(db), new RunRepository(db));
  await registerGradingRoutes(
    app,
    {} as unknown as GradeService,
    settings,
    { cliAvailable: () => cliAvailable },
    runReports,
  );
  apps.push(app);
  return { app, settings };
}

test("GET judge-settings: fresh install → provider {null,null}, CLI default model, resolvedSource none (no CLI, no provider)", async () => {
  const { app } = await makeApp(false);
  const res = await app.inject({ method: "GET", url: "/api/grading/judge-settings" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as JudgeSettingsResolved;
  assert.deepEqual(body.settings, { providerCredentialId: null, model: null });
  assert.equal(body.cliAvailable, false);
  assert.equal(
    body.cliModel,
    CLI_JUDGE_DEFAULT_MODEL,
    "CLI judge model default is claude-sonnet-4-5",
  );
  assert.equal(CLI_JUDGE_DEFAULT_MODEL, "claude-sonnet-4-5");
  assert.equal(body.resolvedSource, "none");
});

test("GET judge-settings: a signed-in subscription → cliAvailable true, resolvedSource claude_cli (token never exposed)", async () => {
  const { app } = await makeApp(true);
  const res = await app.inject({ method: "GET", url: "/api/grading/judge-settings" });
  const body = res.json() as JudgeSettingsResolved;
  assert.equal(body.cliAvailable, true);
  assert.equal(body.resolvedSource, "claude_cli");
  // The response never carries a token/secret — only references + a boolean.
  assert.equal(JSON.stringify(body).includes("sk-ant"), false);
});

test("PUT judge-settings: a priced provider model + a CLI model persists both; resolvedSource follows CLI availability", async () => {
  const { app, settings } = await makeApp(false);
  const put = await app.inject({
    method: "PUT",
    url: "/api/grading/judge-settings",
    payload: {
      providerCredentialId: "prov-1",
      model: "claude-sonnet-4",
      cliModel: "claude-opus-4-1",
    },
  });
  assert.equal(put.statusCode, 200);
  const body = put.json() as JudgeSettingsResolved;
  assert.deepEqual(body.settings, { providerCredentialId: "prov-1", model: "claude-sonnet-4" });
  assert.equal(body.cliModel, "claude-opus-4-1", "the CLI judge model is persisted");
  assert.equal(
    body.resolvedSource,
    "provider",
    "no CLI signed in but a provider is configured → provider",
  );

  // Reloading reflects the stored values.
  const get = (
    await app.inject({ method: "GET", url: "/api/grading/judge-settings" })
  ).json() as JudgeSettingsResolved;
  assert.equal(get.settings.model, "claude-sonnet-4");
  assert.equal(get.cliModel, "claude-opus-4-1");
  // The CLI model lives in its own KV, independent of the provider judge KV.
  assert.equal(settings.get("judge_cli_model"), "claude-opus-4-1");
});

test("PUT judge-settings: an unpriced PROVIDER model → 400 (the provider judge would spend uncapped)", async () => {
  const { app } = await makeApp(true);
  const res = await app.inject({
    method: "PUT",
    url: "/api/grading/judge-settings",
    payload: { providerCredentialId: "prov-1", model: "totally-made-up-model-zzz" },
  });
  assert.equal(res.statusCode, 400);
  assert.match((res.json() as { error: string }).error, /no known pricing/);
});

test("PUT judge-settings: the CLI model is NOT pricing-guarded (a subscription is cost 0) — an unpriced provider is still rejected", async () => {
  const { app } = await makeApp(true);
  // A CLI model that isn't in the pricing table is accepted (subscription, cost 0) when the provider is cleared.
  const ok = await app.inject({
    method: "PUT",
    url: "/api/grading/judge-settings",
    payload: { providerCredentialId: null, model: null, cliModel: "claude-some-future-model" },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as JudgeSettingsResolved;
  assert.equal(body.cliModel, "claude-some-future-model");
  assert.equal(body.resolvedSource, "claude_cli", "signed in → CLI rates even with no provider");
});
