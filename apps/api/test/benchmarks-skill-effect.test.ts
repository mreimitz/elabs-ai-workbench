import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { afterEach, test } from "node:test";
import type { RunMode, SuiteInput, SuiteRunEvent, SuiteVariant } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import {
  attributeVariant,
  buildSuiteDeltas,
  computeSuiteDeltas,
  type DeltaChildRun,
} from "../src/suites/analytics.js";
import {
  SuiteOrchestrator,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService, applySkillOverrides } from "../src/testing/scenario-service.js";

// WP 5.1 (Benchmarks, B14) — the SKILL-EFFECT axis: a suite run gains variants (± attached skill /
// version pin), and a per-test delta view answers "does attaching skill X make the agent better,
// cheaper, or both?" on the SAME suite run. Tested entirely OFFLINE: a STUBBED run starter (no real
// runs / providers / MCP) drives the matrix; the delta rollup is hand-checked; override resolution is
// asserted against fixture scenario attachments AND the recorded run-skill rows; a deleted-skill variant
// fails at suite-run START (before scheduling).

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-04T00:00:00.000Z";

/** A fresh in-memory DB at the latest schema, migrated + stamped (mirrors openDatabase()). */
function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** Seed a provider + scenarios + tests so the runs / suite-membership FKs resolve. */
function seedParents(db: AppDatabase, scenarioIds: string[], testIds: string[]): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  const insertScenario = db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, @name, 'prov-1', 'claude-sonnet-4', @now, @now)`,
  );
  for (const id of scenarioIds) insertScenario.run({ id, name: `Scenario ${id}`, now: NOW });
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  );
  for (const id of testIds) insertTest.run({ id, name: `Test ${id}`, now: NOW });
}

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

/** Register a one-version skill and return its ids (so a variant can attach / a scenario can pin it). */
function seedSkill(skills: SkillRepository, name: string): { skillId: string; versionId: string } {
  const skill = skills.create({ name, sourceType: "upload" });
  const created = skills.createVersion(skill.id, [file("SKILL.md", `# ${name}\nBody.`)], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: created.version.id };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── An auto-completing stub run starter (offline) ─────────────────────────────────────────────────
// Each start inserts a real `runs` row (so linkRunToSuite + getSummary resolve) and hands back a handle
// whose `done` resolves `completed` on the next microtask. It records every start's (testId, scenarioId,
// skillOverrides), and — optionally — writes `run_skills` reflecting the variant's resolved skills so the
// delta attribution has real recorded skills to key off.

type Started = {
  testId: string;
  scenarioId: string;
  skillOverrides?: SuiteVariant["skillOverrides"];
};

function makeAutoStub(
  db: AppDatabase,
  onStart?: (runId: string, overrides: SuiteVariant["skillOverrides"] | undefined) => void,
): { startRun: SuiteRunStarter; stopRun: SuiteRunStopper; started: Started[] } {
  const started: Started[] = [];
  const startRun: SuiteRunStarter = (testId, scenarioId, mode: RunMode, skillOverrides) => {
    const runId = nanoid();
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, duration_ms)
       VALUES (@id, @testId, @scenarioId, @mode, 'completed', 'completed', @now, 0)`,
    ).run({ id: runId, testId, scenarioId, mode, now: NOW });
    started.push({ testId, scenarioId, skillOverrides });
    onStart?.(runId, skillOverrides);
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

// ── (1) Matrix cardinality with the variant axis ──────────────────────────────────────────────────

test("with variants the matrix is test × VARIANT × repetition, each cell carrying its variantLabel", async () => {
  const db = openFresh();
  seedParents(db, ["scn-a", "scn-b"], ["t1", "t2"]);
  const suites = new SuiteRepository(db);
  const variants: SuiteVariant[] = [
    { label: "base", scenarioId: "scn-a", skillOverrides: {} },
    { label: "variant", scenarioId: "scn-b", skillOverrides: {} },
  ];
  const suite = suites.create({
    name: "Skill effect",
    config: { repetitions: 2, maxConcurrency: 8, variants },
    testIds: ["t1", "t2"],
    scenarioIds: [],
  });

  const stub = makeAutoStub(db);
  const manager = new SuiteRunManager();
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    new RunRepository(db),
    new SuiteRunRepository(db),
    suites,
    new GradeRepository(db),
    manager,
  );

  const run = orchestrator.startSuiteRun(suite.id);
  const cellEvents: Extract<SuiteRunEvent, { type: "cell" }>[] = [];
  manager.subscribe(run.id, (event) => {
    if (event.type === "cell") cellEvents.push(event);
  });
  await orchestrator.whenSettled(run.id);

  // 2 tests × 2 variants × 2 reps = 8 cells.
  assert.equal(stub.started.length, 8, "8 variant cells started");
  // Each variant contributes half the cells, on its OWN scenario.
  assert.equal(stub.started.filter((s) => s.scenarioId === "scn-a").length, 4, "base ran on scn-a");
  assert.equal(
    stub.started.filter((s) => s.scenarioId === "scn-b").length,
    4,
    "variant ran on scn-b",
  );

  // Every started cell surfaced a `variantLabel`, split evenly base/variant. A cell emits twice (running
  // → settled), both carrying its runId, so dedupe by runId to count DISTINCT cells.
  const labelByRun = new Map<string, string | undefined>();
  for (const event of cellEvents) {
    if (event.cell.runId !== undefined) labelByRun.set(event.cell.runId, event.cell.variantLabel);
  }
  const labels = [...labelByRun.values()];
  assert.equal(labels.length, 8, "8 distinct cells emitted");
  assert.ok(
    labels.every((label) => label === "base" || label === "variant"),
    "every cell tagged a variant",
  );
  assert.equal(labels.filter((l) => l === "base").length, 4);
  assert.equal(labels.filter((l) => l === "variant").length, 4);
});

test("without variants the matrix stays test × scenario × repetition (no variantLabel)", async () => {
  const db = openFresh();
  seedParents(db, ["scn-a", "scn-b"], ["t1", "t2"]);
  const suites = new SuiteRepository(db);
  const suite = suites.create({
    name: "Plain",
    config: { repetitions: 2, maxConcurrency: 8 },
    testIds: ["t1", "t2"],
    scenarioIds: ["scn-a", "scn-b"],
  });

  const stub = makeAutoStub(db);
  const manager = new SuiteRunManager();
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    new RunRepository(db),
    new SuiteRunRepository(db),
    suites,
    new GradeRepository(db),
    manager,
  );

  const run = orchestrator.startSuiteRun(suite.id);
  const cellEvents: Extract<SuiteRunEvent, { type: "cell" }>[] = [];
  manager.subscribe(run.id, (event) => {
    if (event.type === "cell") cellEvents.push(event);
  });
  await orchestrator.whenSettled(run.id);

  assert.equal(stub.started.length, 8, "2 tests × 2 scenarios × 2 reps = 8 cells");
  assert.ok(
    stub.started.every((s) => s.skillOverrides === undefined),
    "no cell carries an override",
  );
  assert.ok(
    cellEvents.every((event) => event.cell.variantLabel === undefined),
    "a plain matrix never stamps a variantLabel",
  );
});

// ── (2) Override resolution — attach/detach change what resolves + what is recorded ────────────────

test("resolveAllowedSkills applies a variant's attach/detach against the scenario's base attachments", () => {
  const db = openFresh();
  seedParents(db, [], []);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 1)));
  const scenarios = new ScenarioRepository(db);
  const service = new ScenarioService(scenarios, new ScanRepository(db), skills);

  const pdf = seedSkill(skills, "pdf");
  const csv = seedSkill(skills, "csv");

  // Base scenario attaches ONLY pdf (latest).
  const scenario = scenarios.create({
    name: "Base",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: pdf.skillId, versionMode: "latest" }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  const idsOf = (overrides?: SuiteVariant["skillOverrides"]) =>
    new Set(service.resolveAllowedSkills(scenario.id, overrides).map((s) => s.skillId));

  // No overrides → the scenario's base attachments (pdf only).
  assert.deepEqual(idsOf(), new Set([pdf.skillId]), "base resolves to pdf only");
  // attach csv → pdf + csv.
  assert.deepEqual(
    idsOf({ attach: [{ skillId: csv.skillId, versionId: "latest" }] }),
    new Set([pdf.skillId, csv.skillId]),
    "attach adds csv on top of the base pdf",
  );
  // detach pdf → nothing.
  assert.deepEqual(idsOf({ detach: [pdf.skillId] }), new Set(), "detach removes the base pdf");
  // attach csv + detach pdf → csv only (the classic swap).
  assert.deepEqual(
    idsOf({ attach: [{ skillId: csv.skillId, versionId: "latest" }], detach: [pdf.skillId] }),
    new Set([csv.skillId]),
    "attach + detach swaps pdf for csv",
  );

  // A pinned attach resolves to the pinned version id (not the current one).
  const pinned = service.resolveAllowedSkills(scenario.id, {
    attach: [{ skillId: csv.skillId, versionId: csv.versionId }],
  });
  assert.equal(
    pinned.find((s) => s.skillId === csv.skillId)?.versionId,
    csv.versionId,
    "pinned attach honors the version",
  );

  // Pure helper: attach preserves an already-attached skill's eager flag (only version/mode change).
  const merged = applySkillOverrides(
    [{ skillId: pdf.skillId, versionMode: "latest", eager: true }],
    { attach: [{ skillId: pdf.skillId, versionId: pdf.versionId }] },
  );
  assert.deepEqual(merged, [
    { skillId: pdf.skillId, versionMode: "pinned", pinnedVersionId: pdf.versionId, eager: true },
  ]);
});

test("the override actually changes what a run RECORDS — base lacks the attached skill, the variant has it", () => {
  const db = openFresh();
  seedParents(db, ["scn"], ["t1"]);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 2)));
  const scenarios = new ScenarioRepository(db);
  const service = new ScenarioService(scenarios, new ScanRepository(db), skills);
  const runs = new RunRepository(db);

  const pdf = seedSkill(skills, "pdf");
  // Base scenario attaches nothing; the variant attaches pdf.
  const scenario = scenarios.create({
    name: "Empty base",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  // Mirror the run-service seam for two runs: resolve with/without the override, then record what resolved.
  const record = (runId: string, overrides?: SuiteVariant["skillOverrides"]) => {
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at) VALUES (@id, 't1', @scn, 'automated', 'completed', @now)`,
    ).run({ id: runId, scn: scenario.id, now: NOW });
    const resolved = service.resolveAllowedSkills(scenario.id, overrides);
    runs.recordRunSkills(
      runId,
      resolved.map((s) => ({
        skillId: s.skillId,
        skillVersionId: s.versionId,
        versionLabel: s.versionLabel,
        eager: s.eager,
      })),
    );
  };

  record("run-base");
  record("run-variant", { attach: [{ skillId: pdf.skillId, versionId: "latest" }] });

  const baseSkillIds = runs.getRunSkills("run-base").map((r) => r.skill_id);
  const variantSkillIds = runs.getRunSkills("run-variant").map((r) => r.skill_id);
  assert.deepEqual(baseSkillIds, [], "the base run recorded NO skills");
  assert.deepEqual(
    variantSkillIds,
    [pdf.skillId],
    "the +pdf variant run recorded the attached skill",
  );
});

// ── (3) Delta rollup — hand-computed, base vs variant, meaned over reps ────────────────────────────

test("computeSuiteDeltas hand-check: mean over reps, signed deltas, null grade when a side is ungraded", () => {
  // Test A: base graded [0.4, 0.6] (mean 0.5), +skill graded [0.8, 0.9] (mean 0.85).
  //         base tokens [1000, 1100] (1050), +skill [900, 700] (800). base cost [0.2,0.2], +skill [0.1,0.1].
  // Test B: base has NO graded score → gradeDelta must be null (never a fake 0), tokens/cost still compared.
  const children: DeltaChildRun[] = [
    { runId: "a1", testId: "A", variantLabel: "base", score: 0.4, tokens: 1000, costUsd: 0.2 },
    { runId: "a2", testId: "A", variantLabel: "base", score: 0.6, tokens: 1100, costUsd: 0.2 },
    { runId: "a3", testId: "A", variantLabel: "+skill", score: 0.8, tokens: 900, costUsd: 0.1 },
    { runId: "a4", testId: "A", variantLabel: "+skill", score: 0.9, tokens: 700, costUsd: 0.1 },
    { runId: "b1", testId: "B", variantLabel: "base", score: null, tokens: 500, costUsd: 0.05 },
    { runId: "b2", testId: "B", variantLabel: "+skill", score: null, tokens: 600, costUsd: 0.07 },
  ];

  const rows = computeSuiteDeltas(children, "base");
  assert.equal(rows.length, 2, "one row per (test × non-base variant)");

  const a = rows.find((r) => r.testId === "A");
  assert.ok(a && a.gradeDelta !== null);
  assert.ok(Math.abs((a.gradeDelta ?? 0) - 0.35) < 1e-9, "gradeDelta = 0.85 − 0.5 = 0.35");
  assert.ok(Math.abs(a.tokensDelta - -250) < 1e-9, "tokensDelta = 800 − 1050 = −250 (cheaper)");
  assert.ok(Math.abs(a.costDelta - -0.1) < 1e-9, "costDelta = 0.1 − 0.2 = −0.1");

  const b = rows.find((r) => r.testId === "B");
  assert.ok(b, "test B still produces a row (cost is comparable)");
  assert.equal(b?.gradeDelta, null, "no graded side → gradeDelta is null, not 0");
  assert.ok(Math.abs((b?.tokensDelta ?? 0) - 100) < 1e-9, "tokensDelta = 600 − 500 = 100");
});

test("buildSuiteDeltas end-to-end: attributes runs by recorded skills, then rolls up base-vs-variant", () => {
  const db = openFresh();
  seedParents(db, ["scn"], ["t1"]);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);

  const variants: SuiteVariant[] = [
    { label: "base", scenarioId: "scn", skillOverrides: {} },
    {
      label: "+pdf",
      scenarioId: "scn",
      skillOverrides: { attach: [{ skillId: "sk-pdf", versionId: "latest" }] },
    },
  ];

  // 1 test × 2 variants × 2 reps. Base runs record NO skills; +pdf runs record sk-pdf (denormalized —
  // run_skills.skill_id is not FK'd, so a real skill row isn't needed for the delta fixture).
  const seedRun = (
    id: string,
    opts: { skills?: string[]; score: number; tokensIn: number; tokensOut: number; cost: number },
  ) => {
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, duration_ms, tokens_in, tokens_out, cost_usd)
       VALUES (@id, 't1', 'scn', 'automated', 'completed', 'completed', @now, 0, @tin, @tout, @cost)`,
    ).run({ id, now: NOW, tin: opts.tokensIn, tout: opts.tokensOut, cost: opts.cost });
    if (opts.skills?.length) {
      runs.recordRunSkills(
        id,
        opts.skills.map((skillId) => ({
          skillId,
          skillVersionId: `${skillId}-v1`,
          versionLabel: "v1",
          eager: false,
        })),
      );
    }
    grades.insert({
      runId: id,
      graderId: "outcome_judge",
      kind: "llm",
      status: "graded",
      score: opts.score,
      method: "logprob_weighted",
      judgeCostUsd: 0,
    });
  };

  // base: scores 0.5, 0.7 → mean 0.6; tokens 1000 each; cost 0.10 each.
  seedRun("base-1", { score: 0.5, tokensIn: 600, tokensOut: 400, cost: 0.1 });
  seedRun("base-2", { score: 0.7, tokensIn: 600, tokensOut: 400, cost: 0.1 });
  // +pdf: scores 0.8, 0.9 → mean 0.85; tokens 1200 each; cost 0.15 each.
  seedRun("pdf-1", { skills: ["sk-pdf"], score: 0.8, tokensIn: 800, tokensOut: 400, cost: 0.15 });
  seedRun("pdf-2", { skills: ["sk-pdf"], score: 0.9, tokensIn: 800, tokensOut: 400, cost: 0.15 });

  const runIds = ["base-1", "base-2", "pdf-1", "pdf-2"];
  const rows = buildSuiteDeltas(runs, grades, variants, runIds, "base");

  assert.equal(rows.length, 1, "one delta row: +pdf vs base");
  const row = rows[0];
  assert.equal(row?.testId, "t1");
  assert.equal(row?.baseLabel, "base");
  assert.equal(row?.variantLabel, "+pdf");
  assert.ok(
    Math.abs((row?.gradeDelta ?? 0) - 0.25) < 1e-9,
    "gradeDelta = 0.85 − 0.6 = 0.25 (better)",
  );
  assert.ok(
    Math.abs((row?.tokensDelta ?? 0) - 200) < 1e-9,
    "tokensDelta = 1200 − 1000 = 200 (costlier context)",
  );
  assert.ok(Math.abs((row?.costDelta ?? 0) - 0.05) < 1e-9, "costDelta = 0.15 − 0.10 = 0.05");

  // A suite run WITHOUT variants yields honest empty (no variant axis to diff).
  assert.deepEqual(buildSuiteDeltas(runs, grades, [], runIds, "base"), []);
});

test("attributeVariant matches a run to at most one variant by scenario + recorded skills", () => {
  const variants: SuiteVariant[] = [
    { label: "base", scenarioId: "scn", skillOverrides: {} },
    {
      label: "+pdf",
      scenarioId: "scn",
      skillOverrides: { attach: [{ skillId: "sk-pdf", versionId: "latest" }] },
    },
  ];
  assert.equal(attributeVariant(variants, "scn", new Set()), "base", "no recorded skill → base");
  assert.equal(
    attributeVariant(variants, "scn", new Set(["sk-pdf"])),
    "+pdf",
    "the attached skill present → the most-specific variant wins",
  );
  assert.equal(
    attributeVariant(variants, "other-scn", new Set()),
    null,
    "a run on a different scenario matches no variant",
  );
});

// ── (4) A deleted-skill variant fails at suite-run START, before any cell is scheduled ─────────────

test("a variant attaching a deleted skill fails at suite-run START (before scheduling), not mid-suite", () => {
  const db = openFresh();
  seedParents(db, ["scn"], ["t1"]);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const real = seedSkill(skills, "real");
  const suites = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);

  const suite = suites.create({
    name: "Ghost skill",
    config: {
      repetitions: 2,
      maxConcurrency: 4,
      variants: [
        { label: "base", scenarioId: "scn", skillOverrides: {} },
        // Attaches a skill id that does not exist.
        {
          label: "+ghost",
          scenarioId: "scn",
          skillOverrides: { attach: [{ skillId: "sk-does-not-exist", versionId: "latest" }] },
        },
      ],
    },
    testIds: ["t1"],
    scenarioIds: [],
  });

  const stub = makeAutoStub(db);
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    new RunRepository(db),
    suiteRuns,
    suites,
    new GradeRepository(db),
    new SuiteRunManager(),
    skills, // wired → variant validation is active
  );

  assert.throws(
    () => orchestrator.startSuiteRun(suite.id),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    "startSuiteRun rejects the deleted-skill variant with a typed 400",
  );
  // Fail-fast: nothing was scheduled and no suite_runs row was created (not a half-run matrix).
  assert.equal(stub.started.length, 0, "no cell was ever started");
  assert.equal(suiteRuns.listRuns(suite.id).length, 0, "no suite_runs row was created");

  // A variant pinning a version that belongs to a DIFFERENT (here nonexistent) version also fails fast.
  const suite2 = suites.create({
    name: "Ghost version",
    config: {
      repetitions: 1,
      maxConcurrency: 1,
      variants: [
        {
          label: "+bad",
          scenarioId: "scn",
          skillOverrides: { attach: [{ skillId: real.skillId, versionId: "ver-ghost" }] },
        },
      ],
    },
    testIds: ["t1"],
    scenarioIds: [],
  });
  assert.throws(
    () => orchestrator.startSuiteRun(suite2.id),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    "a pinned-to-a-missing-version variant also fails at start",
  );
  assert.equal(stub.started.length, 0, "still nothing scheduled");
});
