import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { buildRunPlanEstimate } from "../src/estimate/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Qlik Answers (WP 3.2) — `buildRunPlanEstimate` must roll up `RunPlanEstimate.answersQuestions` from
// the REAL provider kind (a DB lookup via `ProviderRepository`, never a stripped/live-only payload
// flag — see the WP 1.2 gap note in roadmap/qlik-answers/STATUS.md). One question per test × repetition
// for every `qlik_answers` environment in the selection; omitted entirely for an all-LLM plan.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

test("a plan with ONE qlik_answers environment: answersQuestions = testCount × repetitions", () => {
  const db = createDatabase();
  const providers = new ProviderRepository(db, new SecretStore(crypto.randomBytes(32)));
  const provider = providers.create({ kind: "qlik_answers", label: "Qlik", baseUrl: undefined });

  const scenarioRepo = new ScenarioRepository(db);
  const scans = new ScanRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, undefined, providers);
  const scenario = scenarioService.create({
    name: "Qlik env",
    providerId: provider.id,
    model: "asst-123",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  const testRepository = new TestRepository(db);
  const testService = new TestService(testRepository);
  const t1 = testService.create({ name: "t1", userPrompt: "What were Q3 revenues?" });
  const t2 = testService.create({ name: "t2", userPrompt: "What is the churn rate?" });
  const t3 = testService.create({ name: "t3", userPrompt: "Summarize the pipeline." });

  const estimate = buildRunPlanEstimate(
    { scenarios: scenarioService, tests: testService, scans, providers },
    { testIds: [t1.id, t2.id, t3.id], environmentIds: [scenario.id], repetitions: 4 },
  );

  // 3 tests × 1 qlik_answers environment × 4 reps = 12 questions.
  assert.equal(estimate.answersQuestions, 12);
  assert.equal(estimate.testCount, 3);
  assert.equal(estimate.repetitions, 4);
});

test("an all-LLM plan (no qlik_answers environment) omits answersQuestions entirely", () => {
  const db = createDatabase();
  const providers = new ProviderRepository(db, new SecretStore(crypto.randomBytes(32)));
  const provider = providers.create({ kind: "anthropic", label: "Claude", baseUrl: undefined });

  const scenarioRepo = new ScenarioRepository(db);
  const scans = new ScanRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, undefined, providers);
  const scenario = scenarioService.create({
    name: "Claude env",
    providerId: provider.id,
    model: "claude-sonnet-4-20250514",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  const testRepository = new TestRepository(db);
  const testService = new TestService(testRepository);
  const t1 = testService.create({ name: "t1", userPrompt: "Hello" });

  const estimate = buildRunPlanEstimate(
    { scenarios: scenarioService, tests: testService, scans, providers },
    { testIds: [t1.id], environmentIds: [scenario.id], repetitions: 2 },
  );

  assert.equal(estimate.answersQuestions, undefined);
});

test("a MIXED plan sums questions across only the qlik_answers environments", () => {
  const db = createDatabase();
  const providers = new ProviderRepository(db, new SecretStore(crypto.randomBytes(32)));
  const qlikProvider = providers.create({
    kind: "qlik_answers",
    label: "Qlik",
    baseUrl: undefined,
  });
  const llmProvider = providers.create({ kind: "anthropic", label: "Claude", baseUrl: undefined });

  const scenarioRepo = new ScenarioRepository(db);
  const scans = new ScanRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, undefined, providers);
  const base = {
    params: {},
    systemPrompt: "",
    allowedServers: [] as const,
    allowedSkills: [] as const,
    defaultProfiles: [] as const,
    guardrails: {},
    toolLoadingMode: "eager" as const,
  };
  const qlikEnv1 = scenarioService.create({
    ...base,
    name: "Qlik env 1",
    providerId: qlikProvider.id,
    model: "asst-1",
  });
  const qlikEnv2 = scenarioService.create({
    ...base,
    name: "Qlik env 2",
    providerId: qlikProvider.id,
    model: "asst-2",
  });
  const llmEnv = scenarioService.create({
    ...base,
    name: "Claude env",
    providerId: llmProvider.id,
    model: "claude-sonnet-4-20250514",
  });

  const testRepository = new TestRepository(db);
  const testService = new TestService(testRepository);
  const t1 = testService.create({ name: "t1", userPrompt: "Q1" });
  const t2 = testService.create({ name: "t2", userPrompt: "Q2" });

  const estimate = buildRunPlanEstimate(
    { scenarios: scenarioService, tests: testService, scans, providers },
    {
      testIds: [t1.id, t2.id],
      environmentIds: [qlikEnv1.id, qlikEnv2.id, llmEnv.id],
      repetitions: 1,
    },
  );

  // 2 tests × 2 qlik_answers environments × 1 rep = 4 questions; the third (LLM) environment is excluded.
  assert.equal(estimate.answersQuestions, 4);
  assert.equal(estimate.environmentCount, 3);
});
