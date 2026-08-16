import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
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

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

// Create a skill with two versions; returns the ids of the skill + both versions (v1 older, v2 current).
function seedSkillWithTwoVersions(skills: SkillRepository): {
  skillId: string;
  v1: string;
  v2: string;
} {
  const skill = skills.create({ name: "pdf", sourceType: "upload" });
  const first = skills.createVersion(skill.id, [file("SKILL.md", "v1 body")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  const second = skills.createVersion(skill.id, [file("SKILL.md", "v2 body")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  assert.equal(first.unchanged, false);
  assert.equal(second.unchanged, false);
  return { skillId: skill.id, v1: first.version.id, v2: second.version.id };
}

test("scenario create persists + hydrates allowedSkills (latest + pinned)", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 1)));
  const scenarios = new ScenarioRepository(db);

  const a = seedSkillWithTwoVersions(skills);
  const b = seedSkillWithTwoVersions(skills);

  const created = scenarios.create({
    name: "With skills",
    providerId: provider,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [
      { skillId: a.skillId, versionMode: "latest" },
      { skillId: b.skillId, versionMode: "pinned", pinnedVersionId: b.v1 },
    ],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  // Persisted rows exist.
  const rows = db
    .prepare("SELECT * FROM scenario_skills WHERE scenario_id = ? ORDER BY skill_id ASC")
    .all(created.id) as Array<{
    skill_id: string;
    version_mode: string;
    pinned_version_id: string | null;
  }>;
  assert.equal(rows.length, 2);

  // Hydrated back on get(): latest has no pinnedVersionId; pinned carries its id.
  const reloaded = scenarios.get(created.id);
  const latest = reloaded.allowedSkills.find((s) => s.skillId === a.skillId);
  const pinned = reloaded.allowedSkills.find((s) => s.skillId === b.skillId);
  // `eager` defaults false (WP 2.3) and round-trips on every attachment.
  assert.deepEqual(latest, { skillId: a.skillId, versionMode: "latest", eager: false });
  assert.deepEqual(pinned, {
    skillId: b.skillId,
    versionMode: "pinned",
    pinnedVersionId: b.v1,
    eager: false,
  });

  // list() sees them too.
  assert.deepEqual(scenarios.list()[0]?.allowedSkills, reloaded.allowedSkills);
});

test("scenario update re-upserts allowedSkills", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 2)));
  const scenarios = new ScenarioRepository(db);
  const a = seedSkillWithTwoVersions(skills);

  const created = scenarios.create({
    name: "S",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: a.skillId, versionMode: "pinned", pinnedVersionId: a.v2 }],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  assert.equal(created.allowedSkills.length, 1);

  // Update to clear the attachment.
  const cleared = scenarios.update(created.id, {
    name: "S",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });
  assert.deepEqual(cleared.allowedSkills, []);
  const rows = db.prepare("SELECT * FROM scenario_skills WHERE scenario_id = ?").all(created.id);
  assert.equal(rows.length, 0);
});

test("existing scenario (allowedSkills omitted) defaults to []", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const scenarios = new ScenarioRepository(db);

  // Mirrors an old client / old test that never sent allowedSkills — zod defaults it to [].
  const created = scenarios.create({
    name: "Legacy",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    defaultProfiles: [],
    guardrails: {},
  } as never);

  assert.deepEqual(created.allowedSkills, []);
  assert.deepEqual(scenarios.get(created.id).allowedSkills, []);
});

test("deleting a pinned version is blocked with a 409", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const scenarios = new ScenarioRepository(db);
  const a = seedSkillWithTwoVersions(skills);

  scenarios.create({
    name: "Pinner",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: a.skillId, versionMode: "pinned", pinnedVersionId: a.v1 }],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  // versionPinnedBy reads scenario_skills.
  assert.equal(skills.versionPinnedBy(a.v1).length, 1);
  assert.equal(skills.versionPinnedBy(a.v2).length, 0);

  // Delete of the pinned version → 409, and the version survives.
  assert.throws(
    () => skills.deleteVersion(a.v1),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 409,
  );
  assert.ok(skills.getVersion(a.v1));

  // Deleting the whole skill is also blocked (would cascade the pinned version away).
  assert.throws(
    () => skills.deleteSkill(a.skillId),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 409,
  );
});

test("deleting an unpinned version is allowed", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 4)));
  const scenarios = new ScenarioRepository(db);
  const a = seedSkillWithTwoVersions(skills);

  // Pin v1; v2 is unpinned.
  scenarios.create({
    name: "Pinner",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: a.skillId, versionMode: "pinned", pinnedVersionId: a.v1 }],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  // v2 (unpinned, and the current version) deletes fine per the normal cascade.
  skills.deleteVersion(a.v2);
  assert.throws(() => skills.getVersion(a.v2));
  // v1 still there and still current now.
  assert.ok(skills.getVersion(a.v1));
});

test("latest-mode attachment does not block deleting the skill's versions", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 5)));
  const scenarios = new ScenarioRepository(db);
  const a = seedSkillWithTwoVersions(skills);

  scenarios.create({
    name: "Latest",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [{ skillId: a.skillId, versionMode: "latest" }],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  });

  // No pin → versionPinnedBy empty → an old version deletes per cascade.
  assert.equal(skills.versionPinnedBy(a.v1).length, 0);
  skills.deleteVersion(a.v1);
  assert.throws(() => skills.getVersion(a.v1));
});
