import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { RunMode, ScenarioInput } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ScanRepository } from "../src/scans/repository.js";
import {
  assertNoQlikAnswersVariants,
  checkMemberCompatibility,
} from "../src/suites/member-compatibility.js";
import {
  SuiteOrchestrator,
  type ResolvedRunPlan,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import { SuiteReportService } from "../src/suites/suite-report-service.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Qlik Answers (WP 1.4, D-QA6) — the clean-session invariant's 3 enforcement layers, tested entirely
// OFFLINE (real in-memory SQLite, no tenant/provider contact):
//   1. write-time  — ScenarioService.create/update reject a qlik_answers scenario carrying servers/skills.
//   2. plan-time   — SuiteOrchestrator skips an incompatible member instead of running it (D-QA6); an
//                    all-skip plan 400s; a skill-effect variant plan targeting the kind 400s.
//   3. executor    — ALREADY structural (WP 1.1/1.2); see `qlik-answers-run-service.test.ts`'s "opens NO
//                    MCP session" test, cited (not duplicated) at the bottom of this file.

const NOW = "2026-07-11T00:00:00.000Z";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function openFresh(): AppDatabase {
  const db = createDatabase();
  applyMigrations(db);
  return db;
}

function tempAttachmentsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-qlik-clean-session-"));
  tempDirs.push(dir);
  return dir;
}

/** Seed a `qlik_answers` + a plain `anthropic` provider credential; returns their ids. */
function seedProviders(db: AppDatabase): { qlik: string; anthropic: string } {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-qlik', 'qlik_answers', 'Qlik', 'https://acme.us.qlikcloud.com', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-anthropic', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  return { qlik: "prov-qlik", anthropic: "prov-anthropic" };
}

function seedServer(db: AppDatabase, id = "srv-1"): string {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES (@id, 'Stub', 'stdio', 'noop', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ id, now: NOW });
  return id;
}

/** A minimal skill row + a 'latest' scenario_skills attachment (used to simulate a legacy skill-carrying row). */
function seedSkillAttachment(db: AppDatabase, scenarioId: string, skillId = "sk-1"): void {
  db.prepare(
    `INSERT INTO skills (id, name, display_name, slug, source_type, created_at, updated_at)
     VALUES (@id, 'Skill', 'Skill', @slug, 'upload', @now, @now)`,
  ).run({ id: skillId, slug: `${skillId}-slug`, now: NOW });
  db.prepare(
    `INSERT INTO scenario_skills (scenario_id, skill_id, version_mode, pinned_version_id, eager)
     VALUES (@scenarioId, @skillId, 'latest', NULL, 0)`,
  ).run({ scenarioId, skillId });
}

function scenarioInput(providerId: string, model: string, over: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    name: "Env",
    providerId,
    model,
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
    ...over,
  };
}

// ── Part 1 — write-time (layer 1): ScenarioService.create/update ────────────────────────────────────

function makeScenarioService(db: AppDatabase, withProviders = true) {
  const scans = new ScanRepository(db);
  const scenarioRepo = new ScenarioRepository(db);
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const providers = new ProviderRepository(db, secrets);
  const service = withProviders
    ? new ScenarioService(scenarioRepo, scans, undefined, providers)
    : new ScenarioService(scenarioRepo, scans);
  return { service, scenarioRepo, providers };
}

test("layer 1 (write-time): create() rejects a qlik_answers scenario with a non-empty allowedServers", () => {
  const db = createDatabase();
  const { qlik } = seedProviders(db);
  seedServer(db);
  const { service } = makeScenarioService(db);
  assert.throws(
    () =>
      service.create(
        scenarioInput(qlik, "asst-1", {
          allowedServers: [{ serverId: "srv-1", allowedTools: null }],
        }),
      ),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    "a qlik_answers scenario with a server attached is a 400",
  );
});

test("layer 1: create() rejects a qlik_answers scenario with a non-empty allowedSkills", () => {
  const db = createDatabase();
  const { qlik } = seedProviders(db);
  const { service } = makeScenarioService(db);
  assert.throws(
    () =>
      service.create(
        scenarioInput(qlik, "asst-1", {
          allowedSkills: [{ skillId: "sk-x", versionMode: "latest", eager: false }],
        }),
      ),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    "a qlik_answers scenario with a skill attached is a 400",
  );
});

test("layer 1: create() with empty servers/skills stays valid for a qlik_answers scenario (the norm)", () => {
  const db = createDatabase();
  const { qlik } = seedProviders(db);
  const { service } = makeScenarioService(db);
  const scenario = service.create(scenarioInput(qlik, "asst-1"));
  assert.equal(scenario.providerId, qlik);
  assert.deepEqual(scenario.allowedServers, []);
  assert.deepEqual(scenario.allowedSkills, []);
});

test("layer 1: update() rejects adding servers to an existing qlik_answers scenario", () => {
  const db = createDatabase();
  const { qlik } = seedProviders(db);
  seedServer(db);
  const { service } = makeScenarioService(db);
  const scenario = service.create(scenarioInput(qlik, "asst-1"));
  assert.throws(
    () =>
      service.update(
        scenario.id,
        scenarioInput(qlik, "asst-1", {
          allowedServers: [{ serverId: "srv-1", allowedTools: null }],
        }),
      ),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
  );
  // The row is unchanged (the rejected update never applied).
  assert.deepEqual(service.get(scenario.id).allowedServers, []);
});

test("layer 1: a NON-qlik_answers scenario with servers still succeeds (unaffected, regression check)", () => {
  const db = createDatabase();
  const { anthropic } = seedProviders(db);
  seedServer(db);
  const { service } = makeScenarioService(db);
  const scenario = service.create(
    scenarioInput(anthropic, "claude-sonnet-4", {
      allowedServers: [{ serverId: "srv-1", allowedTools: null }],
    }),
  );
  assert.equal(scenario.allowedServers.length, 1);
});

test("layer 1: without the providers dependency wired, the check is skipped (optional-DI back-compat)", () => {
  const db = createDatabase();
  const { qlik } = seedProviders(db);
  seedServer(db);
  const { service } = makeScenarioService(db, /* withProviders */ false);
  const scenario = service.create(
    scenarioInput(qlik, "asst-1", { allowedServers: [{ serverId: "srv-1", allowedTools: null }] }),
  );
  assert.equal(scenario.allowedServers.length, 1, "no crash, and no rejection, when providers isn't wired");
});

// ── Part 2 — direct unit coverage of the plan-time compatibility helpers ────────────────────────────

test("checkMemberCompatibility: undefined for a non-qlik_answers scenario regardless of servers/attachments", () => {
  const db = createDatabase();
  const { anthropic } = seedProviders(db);
  seedServer(db);
  const scenarioRepo = new ScenarioRepository(db);
  const providers = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const testRepo = new TestRepository(db);
  const scenario = scenarioRepo.create(
    scenarioInput(anthropic, "claude-sonnet-4", {
      allowedServers: [{ serverId: "srv-1", allowedTools: null }],
    }),
  );
  const testRow = new TestService(testRepo, tempAttachmentsDir()).create({
    name: "T",
    userPrompt: "p",
    addedProfiles: [],
    systemPromptOverride: "custom",
  });
  const reason = checkMemberCompatibility(
    { scenarios: scenarioRepo, tests: testRepo, providers },
    testRow.id,
    scenario.id,
  );
  assert.equal(reason, undefined);
});

test("checkMemberCompatibility: undefined for an unresolvable scenario/test (never masks an unrelated 404)", () => {
  const db = createDatabase();
  const scenarioRepo = new ScenarioRepository(db);
  const providers = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const testRepo = new TestRepository(db);
  const reason = checkMemberCompatibility(
    { scenarios: scenarioRepo, tests: testRepo, providers },
    "no-such-test",
    "no-such-scenario",
  );
  assert.equal(reason, undefined);
});

test("assertNoQlikAnswersVariants: throws 400 only when a variant targets a qlik_answers scenario", () => {
  const db = createDatabase();
  const { qlik, anthropic } = seedProviders(db);
  const scenarioRepo = new ScenarioRepository(db);
  const providers = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const qlikScenario = scenarioRepo.create(scenarioInput(qlik, "asst-1"));
  const anthropicScenario = scenarioRepo.create(scenarioInput(anthropic, "claude-sonnet-4"));

  assert.doesNotThrow(() =>
    assertNoQlikAnswersVariants({ scenarios: scenarioRepo, providers }, [
      { label: "base", scenarioId: anthropicScenario.id, skillOverrides: {} },
    ]),
  );
  assert.throws(
    () =>
      assertNoQlikAnswersVariants({ scenarios: scenarioRepo, providers }, [
        { label: "base", scenarioId: anthropicScenario.id, skillOverrides: {} },
        { label: "vs-qlik", scenarioId: qlikScenario.id, skillOverrides: {} },
      ]),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
  );
});

// ── Part 3 — plan-time (layer 2): the orchestrator's cell-building + scheduling ─────────────────────

type Started = { testId: string; scenarioId: string };

/** A self-completing stub run starter — inserts a real (completed) `runs` row and resolves immediately. */
function makeAutoStub(db: AppDatabase): {
  startRun: SuiteRunStarter;
  stopRun: SuiteRunStopper;
  started: Started[];
} {
  const started: Started[] = [];
  const startRun: SuiteRunStarter = (testId: string, scenarioId: string, mode: RunMode) => {
    const runId = nanoid();
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, duration_ms, cost_usd)
       VALUES (@id, @testId, @scenarioId, @mode, 'completed', 'completed', @now, 0, 0)`,
    ).run({ id: runId, testId, scenarioId, mode, now: NOW });
    started.push({ testId, scenarioId });
    const done: RunHandle["done"] = Promise.resolve({
      status: "completed",
      outcome: "completed",
      turns: 0,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
    });
    return { runId, mode, done };
  };
  const stopRun: SuiteRunStopper = () => undefined;
  return { startRun, stopRun, started };
}

/** The full orchestrator stack, wired with the D-QA6 `compat` deps (scenarios/tests/providers). */
function makeOrchestratorHarness(db: AppDatabase) {
  const scenarioRepo = new ScenarioRepository(db);
  const testRepo = new TestRepository(db);
  const providers = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const suiteRepo = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const manager = new SuiteRunManager();
  const stub = makeAutoStub(db);
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    runs,
    suiteRuns,
    suiteRepo,
    grades,
    manager,
    undefined,
    undefined,
    { scenarios: scenarioRepo, tests: testRepo, providers },
  );
  return { db, scenarioRepo, testRepo, providers, suiteRepo, suiteRuns, grades, runs, manager, stub, orchestrator };
}

function countRuns(db: AppDatabase, testId: string, scenarioId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE test_id = ? AND scenario_id = ?")
    .get(testId, scenarioId) as { n: number };
  return row.n;
}

test("plan-time (D-QA6): only the qlik_answers × incompatible-test pairing is skipped; every other pairing runs", async () => {
  const db = openFresh();
  const h = makeOrchestratorHarness(db);
  const { qlik, anthropic } = seedProviders(db);
  const qlikScenario = h.scenarioRepo.create(scenarioInput(qlik, "asst-1"));
  const anthropicScenario = h.scenarioRepo.create(scenarioInput(anthropic, "claude-sonnet-4"));
  const testService = new TestService(h.testRepo, tempAttachmentsDir());
  const cleanTest = testService.create({ name: "Clean", userPrompt: "p", addedProfiles: [] });
  const attachTest = testService.create({ name: "Attach", userPrompt: "p", addedProfiles: [] });
  testService.addAttachment(attachTest.id, {
    kind: "text",
    name: "note.txt",
    contentBase64: Buffer.from("hi").toString("base64"),
  });

  const plan: ResolvedRunPlan = {
    source: "adhoc",
    suiteId: null,
    testIds: [cleanTest.id, attachTest.id],
    scenarioIds: [qlikScenario.id, anthropicScenario.id],
    config: { repetitions: 1, maxConcurrency: 4 },
    planJson: null,
  };
  const run = h.orchestrator.startPlanRun(plan);
  await h.orchestrator.whenSettled(run.id);

  const finished = h.suiteRuns.getRun(run.id);
  assert.equal(finished.aggregates?.cellsTotal, 4, "2 tests × 2 scenarios = 4 members");
  assert.equal(
    finished.aggregates?.cellsCompleted,
    3,
    "3 of 4 members ran; the incompatible pairing was skipped, not run",
  );
  assert.deepEqual(finished.aggregates?.skippedMembers, [
    { testId: attachTest.id, scenarioId: qlikScenario.id, reason: "incompatible" },
  ]);

  // The skipped pairing never became a run row; every other pairing did, exactly once.
  assert.equal(countRuns(db, attachTest.id, qlikScenario.id), 0, "the incompatible pairing never ran");
  assert.equal(countRuns(db, cleanTest.id, qlikScenario.id), 1);
  assert.equal(countRuns(db, cleanTest.id, anthropicScenario.id), 1);
  assert.equal(countRuns(db, attachTest.id, anthropicScenario.id), 1, "attachments are fine for a non-qlik kind");
  assert.equal(h.stub.started.length, 3);
});

test("plan-time: a test with systemPromptOverride against a qlik_answers environment is skipped", async () => {
  const db = openFresh();
  const h = makeOrchestratorHarness(db);
  const { qlik } = seedProviders(db);
  const qlikScenario = h.scenarioRepo.create(scenarioInput(qlik, "asst-1"));
  const testRow = new TestService(h.testRepo, tempAttachmentsDir()).create({
    name: "Override",
    userPrompt: "p",
    addedProfiles: [],
    systemPromptOverride: "Custom system prompt",
  });

  const plan: ResolvedRunPlan = {
    source: "adhoc",
    suiteId: null,
    testIds: [testRow.id],
    scenarioIds: [qlikScenario.id],
    config: { repetitions: 2, maxConcurrency: 4 },
    planJson: null,
  };
  // Both repetitions of the ONLY member are incompatible → every cell skips → 400 (see the all-skip test
  // below for the dedicated assertion); here assert the skip itself via the checker directly too.
  const reason = checkMemberCompatibility(
    { scenarios: h.scenarioRepo, tests: h.testRepo, providers: h.providers },
    testRow.id,
    qlikScenario.id,
  );
  assert.equal(reason, "incompatible");
  assert.throws(
    () => h.orchestrator.startPlanRun(plan),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
  );
});

test("plan-time: a legacy qlik_answers scenario still carrying MCP servers skips EVERY member, even a clean test", async () => {
  const db = openFresh();
  const h = makeOrchestratorHarness(db);
  const { qlik, anthropic } = seedProviders(db);
  seedServer(db);
  // Bypass ScenarioService (which would reject this) — simulate a pre-WP-1.4 row via the repository directly.
  const legacyScenario = h.scenarioRepo.create(
    scenarioInput(qlik, "asst-1", { allowedServers: [{ serverId: "srv-1", allowedTools: null }] }),
  );
  const anthropicScenario = h.scenarioRepo.create(scenarioInput(anthropic, "claude-sonnet-4"));
  const cleanTest = new TestService(h.testRepo, tempAttachmentsDir()).create({
    name: "Clean",
    userPrompt: "p",
    addedProfiles: [],
  });

  const plan: ResolvedRunPlan = {
    source: "adhoc",
    suiteId: null,
    testIds: [cleanTest.id],
    scenarioIds: [legacyScenario.id, anthropicScenario.id],
    config: { repetitions: 1, maxConcurrency: 4 },
    planJson: null,
  };
  const run = h.orchestrator.startPlanRun(plan);
  await h.orchestrator.whenSettled(run.id);

  const finished = h.suiteRuns.getRun(run.id);
  assert.deepEqual(finished.aggregates?.skippedMembers, [
    { testId: cleanTest.id, scenarioId: legacyScenario.id, reason: "incompatible" },
  ]);
  assert.equal(countRuns(db, cleanTest.id, legacyScenario.id), 0);
  assert.equal(countRuns(db, cleanTest.id, anthropicScenario.id), 1);
});

test("plan-time: a legacy qlik_answers scenario still carrying a skill attachment also skips", async () => {
  const db = openFresh();
  const h = makeOrchestratorHarness(db);
  const { qlik } = seedProviders(db);
  const legacyScenario = h.scenarioRepo.create(scenarioInput(qlik, "asst-1"));
  seedSkillAttachment(db, legacyScenario.id);
  const cleanTest = new TestService(h.testRepo, tempAttachmentsDir()).create({
    name: "Clean",
    userPrompt: "p",
    addedProfiles: [],
  });

  const reason = checkMemberCompatibility(
    { scenarios: h.scenarioRepo, tests: h.testRepo, providers: h.providers },
    cleanTest.id,
    legacyScenario.id,
  );
  assert.equal(reason, "incompatible", "a legacy skill-carrying qlik_answers scenario is incompatible");
});

test("plan-time: a plan whose every member is incompatible is rejected with 400 — nothing is scheduled", () => {
  const db = openFresh();
  const h = makeOrchestratorHarness(db);
  const { qlik } = seedProviders(db);
  const qlikScenario = h.scenarioRepo.create(scenarioInput(qlik, "asst-1"));
  const testService = new TestService(h.testRepo, tempAttachmentsDir());
  const attachTest = testService.create({ name: "Attach", userPrompt: "p", addedProfiles: [] });
  testService.addAttachment(attachTest.id, {
    kind: "text",
    name: "note.txt",
    contentBase64: Buffer.from("hi").toString("base64"),
  });

  const plan: ResolvedRunPlan = {
    source: "adhoc",
    suiteId: null,
    testIds: [attachTest.id],
    scenarioIds: [qlikScenario.id],
    config: { repetitions: 3, maxConcurrency: 4 },
    planJson: null,
  };
  assert.throws(
    () => h.orchestrator.startPlanRun(plan),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    "an all-skip plan is a 400, mirroring the empty-collection precedent",
  );
  assert.equal(h.stub.started.length, 0, "nothing was scheduled for the rejected plan");
  assert.equal(h.suiteRuns.listRuns().length, 0, "no suite_runs row was created for the rejected plan");
});

test("plan-time: a skill-effect variant plan targeting a qlik_answers scenario is rejected with 400 (fail-fast)", () => {
  const db = openFresh();
  const h = makeOrchestratorHarness(db);
  const { qlik } = seedProviders(db);
  const qlikScenario = h.scenarioRepo.create(scenarioInput(qlik, "asst-1"));
  const testRow = new TestService(h.testRepo, tempAttachmentsDir()).create({
    name: "T",
    userPrompt: "p",
    addedProfiles: [],
  });
  const suite = h.suiteRepo.create({
    name: "Variant vs qlik",
    config: {
      repetitions: 1,
      maxConcurrency: 4,
      variants: [{ label: "base", scenarioId: qlikScenario.id, skillOverrides: {} }],
    },
    testIds: [testRow.id],
    scenarioIds: [],
  });

  assert.throws(
    () => h.orchestrator.startSuiteRun(suite.id),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
  );
  assert.equal(h.stub.started.length, 0, "no cell was ever started");
  assert.equal(h.suiteRuns.listRuns(suite.id).length, 0, "no suite_runs row was created");
});

test("plan-time: without the compat dependency wired, no member is ever skipped (optional-DI back-compat)", async () => {
  const db = openFresh();
  const scenarioRepo = new ScenarioRepository(db);
  const testRepo = new TestRepository(db);
  const suiteRepo = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const manager = new SuiteRunManager();
  const stub = makeAutoStub(db);
  // NO 10th `compat` arg — mirrors every pre-WP-1.4 orchestrator construction.
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    runs,
    suiteRuns,
    suiteRepo,
    grades,
    manager,
  );
  const { qlik } = seedProviders(db);
  seedServer(db);
  // A legacy-shaped row that WOULD skip if `compat` were wired.
  const qlikScenario = scenarioRepo.create(
    scenarioInput(qlik, "asst-1", {
      allowedServers: [{ serverId: "srv-1", allowedTools: null }],
    }),
  );
  const testRow = new TestService(testRepo, tempAttachmentsDir()).create({
    name: "T",
    userPrompt: "p",
    addedProfiles: [],
  });

  const plan: ResolvedRunPlan = {
    source: "adhoc",
    suiteId: null,
    testIds: [testRow.id],
    scenarioIds: [qlikScenario.id],
    config: { repetitions: 1, maxConcurrency: 4 },
    planJson: null,
  };
  const run = orchestrator.startPlanRun(plan);
  await orchestrator.whenSettled(run.id);
  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.aggregates?.skippedMembers, undefined, "no compat deps → nothing is ever skipped");
  assert.equal(stub.started.length, 1);
});

// ── Part 4 — surfaced in the suite report ────────────────────────────────────────────────────────

/** Insert a finished suite_runs row carrying the given (already-derived) aggregates. */
function seedSuiteRunWithAggregates(db: AppDatabase, aggregatesJson: string): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, ended_at, source, aggregates_json)
     VALUES (@id, NULL, 'completed', '{}', @now, @now, 'adhoc', @aggregatesJson)`,
  ).run({ id, now: NOW, aggregatesJson });
  return id;
}

function seedReportParents(db: AppDatabase, scenarioId: string, testIds: string[]): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, 'Scenario', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  );
  for (const id of testIds) insertTest.run({ id, name: `Test ${id}`, now: NOW });
}

function seedFinishedRun(db: AppDatabase, testId: string, scenarioId: string, suiteRunId: string): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, suite_run_id, repetition)
     VALUES (@id, @testId, @scenarioId, 'automated', 'completed', 'completed', @now, @suiteRunId, 1)`,
  ).run({ id, testId, scenarioId, suiteRunId, now: NOW });
  return id;
}

test("suite report: echoes the suite run's skipped-incompatible members alongside the graded test groups", async () => {
  const db = openFresh();
  seedReportParents(db, "scn-1", ["t1", "t2"]);
  const skipped = [{ testId: "t2", scenarioId: "scn-1", reason: "incompatible" as const }];
  const suiteRunId = seedSuiteRunWithAggregates(
    db,
    JSON.stringify({
      cellsTotal: 3,
      cellsCompleted: 2,
      meanGrade: null,
      gradeStdDev: null,
      passRateAt05: null,
      totalTokens: 0,
      execCostUsd: 0,
      judgeCostUsd: 0,
      skippedMembers: skipped,
    }),
  );
  // ≥2 members is the AR7 gate for report generation (a real, unrelated run pairing — distinct from the
  // skipped test's OWN pairing so the report generates even though t2 never ran).
  const r1 = seedFinishedRun(db, "t1", "scn-1", suiteRunId);
  const r2 = seedFinishedRun(db, "t1", "scn-1", suiteRunId);
  const grades = new GradeRepository(db);
  grades.insert({ runId: r1, graderId: "outcome_judge", kind: "llm", status: "graded", score: 0.8, method: "single_sample" });
  grades.insert({ runId: r2, graderId: "outcome_judge", kind: "llm", status: "graded", score: 0.6, method: "single_sample" });

  const service = new SuiteReportService({
    suiteRuns: new SuiteRunRepository(db),
    runs: new RunRepository(db),
    grades,
    reports: new SuiteReportRepository(db),
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "a report was generated (≥2 members)");
  assert.deepEqual(result?.report.skippedMembers, skipped);
});

test("suite report: skippedMembers is [] when the suite run skipped nothing (every pre-WP-1.4 report)", async () => {
  const db = openFresh();
  seedReportParents(db, "scn-1", ["t1"]);
  const suiteRunId = seedSuiteRunWithAggregates(
    db,
    JSON.stringify({
      cellsTotal: 2,
      cellsCompleted: 2,
      meanGrade: null,
      gradeStdDev: null,
      passRateAt05: null,
      totalTokens: 0,
      execCostUsd: 0,
      judgeCostUsd: 0,
    }),
  );
  const r1 = seedFinishedRun(db, "t1", "scn-1", suiteRunId);
  const r2 = seedFinishedRun(db, "t1", "scn-1", suiteRunId);
  const grades = new GradeRepository(db);
  grades.insert({ runId: r1, graderId: "outcome_judge", kind: "llm", status: "graded", score: 0.8, method: "single_sample" });
  grades.insert({ runId: r2, graderId: "outcome_judge", kind: "llm", status: "graded", score: 0.6, method: "single_sample" });

  const service = new SuiteReportService({
    suiteRuns: new SuiteRunRepository(db),
    runs: new RunRepository(db),
    grades,
    reports: new SuiteReportRepository(db),
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result);
  assert.deepEqual(result?.report.skippedMembers, []);
});

// ── Part 5 — layer 3 (executor, structural) — CITED, not duplicated ─────────────────────────────────
//
// The executor can never attach an MCP session/tool bridge/skill context for a qlik_answers run — this
// is a STRUCTURAL property of `RunService.execute()`'s early-return `resolveAnswers()` branch (WP 1.2),
// which returns BEFORE `resolve()` (the only place that opens MCP sessions) ever runs. It is already
// locked by a test from WP 1.2:
//
//   apps/api/test/qlik-answers-run-service.test.ts
//     test("automated: a qlik_answers run routes to the executor, opens NO MCP session, and completes")
//       — asserts `h.sessionCalls` is `[]` for a qlik_answers run (vs. `["srv-1"]` for the sibling
//         non-qlik run in the very next test), i.e. zero MCP sessions were ever opened.
//
// No new test is added here per the WP's own guidance ("cite it" when one already exists from WP 1.2).
