import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";

// UX WP 3.3 (G11/S20) — `SkillRepository.getUsage` powers `GET /api/skills/:id/usage`: the environments
// a skill is attached to (`scenario_skills`) + its most-recent runs (`run_skills`). Read-only projection.

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

function seedProvider(db: AppDatabase, id = "prov-1"): string {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES (@id, 'anthropic', 'Claude', NULL, 'enc:v1:abc', @ts, @ts)`,
  ).run({ id, ts: "2026-06-20T00:00:00.000Z" });
  return id;
}

function seedTest(db: AppDatabase, id = "test-1"): string {
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, 'A test', 'hi', @ts, @ts)`,
  ).run({ id, ts: "2026-06-20T00:00:00.000Z" });
  return id;
}

function seedRun(
  db: AppDatabase,
  opts: {
    id: string;
    testId: string;
    scenarioId: string;
    startedAt: string;
    status?: string;
    outcome?: string;
  },
): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at)
     VALUES (@id, @testId, @scenarioId, 'automated', @status, @outcome, @startedAt)`,
  ).run({
    id: opts.id,
    testId: opts.testId,
    scenarioId: opts.scenarioId,
    status: opts.status ?? "completed",
    outcome: opts.outcome ?? "completed",
    startedAt: opts.startedAt,
  });
}

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

function seedSkill(skills: SkillRepository, name: string): { skillId: string; versionId: string } {
  const skill = skills.create({ name, sourceType: "upload" });
  const v = skills.createVersion(skill.id, [file("SKILL.md", `# ${name}\n`)], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  assert.equal(v.unchanged, false);
  return { skillId: skill.id, versionId: v.unchanged ? "" : v.version.id };
}

test("getUsage reports attached environments + recent runs, newest first", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 1)));
  const scenarios = new ScenarioRepository(db);

  const skill = seedSkill(skills, "pdf");

  // Two environments attach the skill — one latest, one pinned.
  const envLatest = scenarios.create({
    name: "Zeta env",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.skillId, versionMode: "latest" }],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  const envPinned = scenarios.create({
    name: "Alpha env",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [
      { skillId: skill.skillId, versionMode: "pinned", pinnedVersionId: skill.versionId },
    ],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  const testId = seedTest(db);
  // Two runs resolved the skill; an older run + a newer run.
  seedRun(db, {
    id: "run-old",
    testId,
    scenarioId: envLatest.id,
    startedAt: "2026-06-20T10:00:00.000Z",
  });
  seedRun(db, {
    id: "run-new",
    testId,
    scenarioId: envPinned.id,
    startedAt: "2026-06-21T10:00:00.000Z",
  });
  for (const runId of ["run-old", "run-new"]) {
    db.prepare(
      `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
       VALUES (@runId, @skillId, @versionId, @label, 0)`,
    ).run({ runId, skillId: skill.skillId, versionId: skill.versionId, label: "v1" });
  }

  const usage = skills.getUsage(skill.skillId);

  // Environments — sorted by name; version mode + pin round-trips.
  assert.equal(usage.skillId, skill.skillId);
  assert.equal(usage.environments.length, 2);
  assert.deepEqual(
    usage.environments.map((e) => e.name),
    ["Alpha env", "Zeta env"],
  );
  const alpha = usage.environments.find((e) => e.name === "Alpha env");
  assert.equal(alpha?.versionMode, "pinned");
  assert.equal(alpha?.pinnedVersionId, skill.versionId);
  assert.equal(alpha?.eager, false);

  // Runs — newest first, capped, with the denormalized scenario name + version label.
  assert.equal(usage.runs.length, 2);
  assert.equal(usage.runs[0]?.runId, "run-new");
  assert.equal(usage.runs[0]?.scenarioName, "Alpha env");
  assert.equal(usage.runs[0]?.versionLabel, "v1");
  assert.equal(usage.runs[0]?.status, "completed");
  assert.equal(usage.runs[1]?.runId, "run-old");
});

test("getUsage is empty (not a throw) for an unattached, never-run skill", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 2)));
  const skill = seedSkill(skills, "lonely");

  const usage = skills.getUsage(skill.skillId);
  assert.deepEqual(usage, { skillId: skill.skillId, environments: [], runs: [] });
});

test("getUsage 404s for an unknown skill id", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  assert.throws(
    () => skills.getUsage("nope"),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 404,
  );
});
