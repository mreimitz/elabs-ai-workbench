import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

/**
 * Unit coverage for {@link RunRepository.listRunSkillSummaries} — the builder behind `RunDetail.skills`
 * and `GET /api/runs/:id/skills` (the run-console Skills panel). It answers the three questions the
 * console otherwise hides: was a skill LOADED (which version, eager vs. metadata-only), was it USED
 * (per-skill `read_skill_file` reads + their realized tokens), and what did it COST (the version's
 * L1/L2/L3 footprint). FK enforcement is OFF so the read path is exercised in isolation from the
 * runs/tests/scenarios parents it would otherwise require — none of them affect what's under test.
 */

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

function seedRun(db: AppDatabase, runId: string): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES (?, 't1', 's1', 'automated', 'completed', '2026-07-04T00:00:00.000Z')`,
  ).run(runId);
}

/** Insert one skill-disclosure step exactly as the skill-context meter persists it. */
function insertDisclosureStep(
  db: AppDatabase,
  args: { runId: string; idx: number; serverId: string; tokens: number; status?: string },
): void {
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, server_id, tool_name, profile_tokens_json)
     VALUES (@id, @runId, @idx, 'tool_call', 'read_skill_file', @status, @serverId, 'read_skill_file', @pt)`,
  ).run({
    id: `step-${args.idx}`,
    runId: args.runId,
    idx: args.idx,
    status: args.status ?? "ok",
    serverId: args.serverId,
    pt: JSON.stringify({ generic_o200k: args.tokens }),
  });
}

function versionFootprint(db: AppDatabase, versionId: string) {
  return db
    .prepare(
      `SELECT l1_metadata_tokens AS l1, l2_body_tokens AS l2, l3_resource_tokens AS l3, total_tokens AS total
         FROM skill_versions WHERE id = ?`,
    )
    .get(versionId) as { l1: number; l2: number; l3: number; total: number };
}

test("listRunSkillSummaries: eager load, per-skill disclosure reads + tokens, real footprint", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 1)));
  const runs = new RunRepository(db);

  const skill = skills.create({ name: "pdf", sourceType: "upload" });
  const version = skills.createVersion(
    skill.id,
    [
      file("SKILL.md", "# PDF\nExtract text, fill forms, merge."),
      file("reference/notes.md", "long notes"),
    ],
    { sourceKind: "upload", importedFrom: "upload" },
  ).version;
  const fp = versionFootprint(db, version.id);

  const runId = "run-eager";
  seedRun(db, runId);
  runs.recordRunSkills(runId, [
    { skillId: skill.id, skillVersionId: version.id, versionLabel: "v1", eager: true },
  ]);

  // Two settled reads attributed to THIS skill (40 + 60), one list-all call (skill://*, excluded from
  // per-skill), and one still-running read for this skill (excluded — only settled steps count).
  insertDisclosureStep(db, { runId, idx: 0, serverId: `skill://${skill.id}`, tokens: 40 });
  insertDisclosureStep(db, { runId, idx: 1, serverId: `skill://${skill.id}`, tokens: 60 });
  insertDisclosureStep(db, { runId, idx: 2, serverId: "skill://*", tokens: 10 });
  insertDisclosureStep(db, {
    runId,
    idx: 3,
    serverId: `skill://${skill.id}`,
    tokens: 999,
    status: "running",
  });

  const summaries = runs.listRunSkillSummaries(runId);
  assert.equal(summaries.length, 1);
  const only = summaries[0]!;
  assert.equal(only.skillId, skill.id);
  assert.equal(only.name, "pdf");
  assert.equal(only.versionLabel, "v1");
  assert.equal(only.skillVersionId, version.id);
  assert.equal(only.eager, true);
  assert.deepEqual(only.footprint, {
    l1MetadataTokens: fp.l1,
    l2BodyTokens: fp.l2,
    l3ResourceTokens: fp.l3,
    totalTokens: fp.total,
  });
  // Only the two settled skill://<id> reads count; skill://* and the running step are excluded.
  assert.equal(only.disclosureReads, 2);
  assert.equal(only.disclosureTokens, 100);
});

test("listRunSkillSummaries: unopened metadata-only skill + deleted version → footprint null", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 2)));
  const runs = new RunRepository(db);

  const skill = skills.create({ name: "unused", sourceType: "upload" });
  const version = skills.createVersion(skill.id, [file("SKILL.md", "body")], {
    sourceKind: "upload",
    importedFrom: "upload",
  }).version;

  const runId = "run-plain";
  seedRun(db, runId);
  // A metadata-only (non-eager) attachment the model never opens.
  runs.recordRunSkills(runId, [
    { skillId: skill.id, skillVersionId: version.id, versionLabel: "v1", eager: false },
  ]);
  // A second resolution whose version no longer exists (deleted after the run) — history survives, but
  // the footprint is unrecoverable and the name falls back to the id.
  runs.recordRunSkills(runId, [
    { skillId: "ghost-skill", skillVersionId: "ghost-version", versionLabel: "v7", eager: false },
  ]);

  const summaries = runs.listRunSkillSummaries(runId);
  assert.equal(summaries.length, 2);

  const live = summaries.find((s) => s.skillId === skill.id)!;
  assert.equal(live.name, "unused");
  assert.equal(live.eager, false);
  assert.equal(live.disclosureReads, 0);
  assert.equal(live.disclosureTokens, 0);
  assert.ok(live.footprint, "a present version keeps its footprint");

  const ghost = summaries.find((s) => s.skillId === "ghost-skill")!;
  assert.equal(ghost.name, "ghost-skill", "name falls back to the id when the skill row is gone");
  assert.equal(ghost.versionLabel, "v7");
  assert.equal(ghost.footprint, null, "deleted version → null footprint");
});

test("listRunSkillSummaries: a run with no resolved skills returns []", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  const runId = "run-empty";
  seedRun(db, runId);
  assert.deepEqual(runs.listRunSkillSummaries(runId), []);
});
