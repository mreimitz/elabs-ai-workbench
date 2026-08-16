import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  triggerCollisionSchema,
  triggerSurfaceSchema,
  type TriggerCollision,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import {
  collisionKey,
  getTriggerCollisions,
  getTriggerSurface,
  stemPlural,
} from "../src/skillflow/triggers.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 6.1 (I7) — the trigger-surface manager + cross-skill collision report. Everything here
// is PURE over persisted skill versions (project the graph, read the manifest); no MCP call, nothing
// executed. The load-bearing acceptance test: two skills sharing `/report` + one keyword are reported
// exactly ONCE (per kind) with BOTH skill ids.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function makeRepo(): SkillRepository {
  return new SkillRepository(createDatabase() as AppDatabase, new SecretStore(Buffer.alloc(32, 7)));
}

/** Create a skill + one version from a lone SKILL.md; returns { skillId, versionId }. */
function seedSkill(
  skills: SkillRepository,
  name: string,
  skillMd: string,
): { skillId: string; versionId: string } {
  const skill = skills.create({ name, sourceType: "upload" });
  const files: SkillFileInput[] = [{ path: "SKILL.md", bytes: Buffer.from(skillMd, "utf8") }];
  const versionId = skills.createVersion(skill.id, files, {
    sourceKind: "upload",
    importedFrom: "upload",
  }).version.id;
  return { skillId: skill.id, versionId };
}

async function makeRouteApp(
  skills: SkillRepository,
  runs: RunRepository,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillflowRoutes(app, skills, runs);
  apps.push(app);
  return app;
}

// A skill authored with a frontmatter description + keyword list and a `/report` command section.
function skillMd(opts: {
  name: string;
  description: string;
  keywords: string[];
  commands: string[];
}): string {
  const kw = opts.keywords.map((k) => `  - ${k}`).join("\n");
  const commandSections = opts.commands
    .map((c) => `## ${c}\n\nRun the ${c} flow. Produce the output.\n`)
    .join("\n");
  return (
    `---\n` +
    `name: ${opts.name}\n` +
    `description: ${opts.description}\n` +
    (opts.keywords.length > 0 ? `keywords:\n${kw}\n` : "") +
    `---\n\n` +
    `# ${opts.name}\n\nDo the work.\n\n` +
    commandSections
  );
}

// ── (1) stemPlural — the documented, conservative regular-plural fold ──────────────────────────────

test("stemPlural: regular 's' plurals fold; 'ss' and short/irregular tokens are left intact", () => {
  assert.equal(stemPlural("reports"), "report");
  assert.equal(stemPlural("invoices"), "invoice");
  assert.equal(stemPlural("boxes"), "box"); // sibilant 'es'
  assert.equal(stemPlural("watches"), "watch"); // 'ch' + es
  assert.equal(stemPlural("process"), "process"); // trailing 'ss' untouched
  assert.equal(stemPlural("report"), "report"); // already singular
  assert.equal(stemPlural("cts"), "cts"); // ≤ 3 chars: untouched
  assert.equal(stemPlural("queries"), "querie"); // irregular NOT specially folded (documented)
});

test("collisionKey: case/separator collapse (normalizeName) then plural fold", () => {
  assert.equal(collisionKey("/Report"), collisionKey("/report"));
  assert.equal(collisionKey("/report"), collisionKey("/reports"));
  assert.equal(collisionKey("Weekly-Report"), collisionKey("weekly report"));
  assert.notEqual(collisionKey("/status"), collisionKey("/state"));
});

// ── (2) getTriggerSurface — description + keywords + command entry points ──────────────────────────

test("getTriggerSurface: derives description + keywords + command entry points from the projection", () => {
  const skills = makeRepo();
  const { versionId } = seedSkill(
    skills,
    "alpha",
    skillMd({
      name: "alpha",
      description: "Alpha does reporting.",
      keywords: ["analytics", "weekly report"],
      commands: ["/report", "/analyze"],
    }),
  );

  const surface = triggerSurfaceSchema.parse(getTriggerSurface(skills, versionId));
  assert.equal(surface.description, "Alpha does reporting.");
  assert.deepEqual([...surface.keywords].sort(), ["analytics", "weekly report"]);
  const commandValues = surface.commands.map((c) => c.value).sort();
  assert.deepEqual(commandValues, ["/analyze", "/report"]);
  // Every command carries its owning node + flow so the UI can deep-link into its Design-tab flow.
  for (const command of surface.commands) {
    assert.ok(command.nodeId.length > 0, "command has a nodeId");
    assert.ok(command.flowId.length > 0, "command has a flowId");
  }
});

test("getTriggerSurface: empty/absent SKILL.md degrades to an empty surface (no throw)", () => {
  const skills = makeRepo();
  const { versionId } = seedSkill(skills, "empty", "");
  const surface = getTriggerSurface(skills, versionId);
  assert.equal(surface.description, "");
  assert.deepEqual(surface.keywords, []);
  assert.deepEqual(surface.commands, []);
});

// ── (3) ACCEPTANCE — two skills sharing /report + one keyword → reported ONCE with both ids ─────────

test("getTriggerCollisions: shared /report + shared keyword reported exactly once, each with both ids", () => {
  const skills = makeRepo();
  const a = seedSkill(
    skills,
    "alpha",
    skillMd({
      name: "alpha",
      description: "A.",
      keywords: ["analytics", "alpha-only"],
      commands: ["/report"],
    }),
  );
  const b = seedSkill(
    skills,
    "beta",
    skillMd({
      name: "beta",
      description: "B.",
      keywords: ["analytics", "beta-only"],
      commands: ["/report"],
    }),
  );
  // A third skill with entirely distinct triggers must not add or perturb any collision.
  seedSkill(
    skills,
    "gamma",
    skillMd({
      name: "gamma",
      description: "C.",
      keywords: ["gamma-topic"],
      commands: ["/summarize"],
    }),
  );

  const collisions = getTriggerCollisions(skills).map((c) => triggerCollisionSchema.parse(c));

  // Exactly two collisions: the /report command (error) and the `analytics` keyword (warning).
  const commandCollisions = collisions.filter((c) => c.kind === "command");
  const keywordCollisions = collisions.filter((c) => c.kind === "keyword");
  assert.equal(commandCollisions.length, 1, JSON.stringify(collisions));
  assert.equal(keywordCollisions.length, 1, JSON.stringify(collisions));

  const bothIds = [a.skillId, b.skillId].sort();
  const [reportCollision] = commandCollisions;
  assert.equal(collisionKey(reportCollision!.value), collisionKey("/report"));
  assert.deepEqual([...reportCollision!.skillIds].sort(), bothIds);

  const [keywordCollision] = keywordCollisions;
  assert.equal(keywordCollision!.value, "analytics");
  assert.deepEqual([...keywordCollision!.skillIds].sort(), bothIds);

  // The command collision (error) sorts before the keyword overlap (warning).
  assert.equal(collisions[0]!.kind, "command");
});

test("getTriggerCollisions: a clean registry (no shared triggers) reports nothing", () => {
  const skills = makeRepo();
  seedSkill(
    skills,
    "one",
    skillMd({ name: "one", description: "1.", keywords: ["k-one"], commands: ["/one"] }),
  );
  seedSkill(
    skills,
    "two",
    skillMd({ name: "two", description: "2.", keywords: ["k-two"], commands: ["/two"] }),
  );
  assert.deepEqual(getTriggerCollisions(skills), []);
});

test("getTriggerCollisions: normalized + plural collisions across skills (case, separators, plural)", () => {
  const skills = makeRepo();
  const a = seedSkill(
    skills,
    "aa",
    skillMd({ name: "aa", description: "a", keywords: [], commands: ["/report"] }),
  );
  // A different case + a plural of the same command → still one collision across the two skills.
  const b = seedSkill(
    skills,
    "bb",
    skillMd({ name: "bb", description: "b", keywords: [], commands: ["/Reports"] }),
  );

  const collisions = getTriggerCollisions(skills);
  assert.equal(collisions.length, 1, JSON.stringify(collisions));
  assert.equal(collisions[0]!.kind, "command");
  assert.deepEqual([...collisions[0]!.skillIds].sort(), [a.skillId, b.skillId].sort());
});

test("getTriggerCollisions: a skill listing the same value twice is not a self-collision", () => {
  const skills = makeRepo();
  // One skill with a keyword and its plural — one skill, so no cross-skill collision.
  seedSkill(
    skills,
    "solo",
    skillMd({
      name: "solo",
      description: "s",
      keywords: ["invoice", "invoices"],
      commands: ["/report"],
    }),
  );
  assert.deepEqual(getTriggerCollisions(skills), []);
});

// ── (4) Routes — the surface + collisions endpoints over the real registry ─────────────────────────

test("GET …/versions/:vid/triggers returns the schema-valid surface; 404 on an unknown skill", async () => {
  const skills = makeRepo();
  const runs = new RunRepository((skills as unknown as { db: AppDatabase }).db);
  const { skillId, versionId } = seedSkill(
    skills,
    "alpha",
    skillMd({
      name: "alpha",
      description: "Alpha.",
      keywords: ["analytics"],
      commands: ["/report"],
    }),
  );
  const app = await makeRouteApp(skills, runs);

  const ok = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/triggers`,
  });
  assert.equal(ok.statusCode, 200, ok.body);
  const surface = triggerSurfaceSchema.parse(ok.json());
  assert.equal(surface.description, "Alpha.");
  assert.deepEqual(surface.keywords, ["analytics"]);
  assert.deepEqual(
    surface.commands.map((c) => c.value),
    ["/report"],
  );

  const missing = await app.inject({
    method: "GET",
    url: `/api/skills/does-not-exist/versions/${versionId}/triggers`,
  });
  assert.equal(missing.statusCode, 404, missing.body);
});

test("GET /api/skills/trigger-collisions renders the report (and empty array when clean)", async () => {
  const skills = makeRepo();
  const runs = new RunRepository((skills as unknown as { db: AppDatabase }).db);
  const app = await makeRouteApp(skills, runs);

  // Clean registry (one skill) → empty report, not shadowed by /api/skills/:id.
  seedSkill(
    skills,
    "solo",
    skillMd({ name: "solo", description: "s", keywords: ["k"], commands: ["/only"] }),
  );
  const clean = await app.inject({ method: "GET", url: "/api/skills/trigger-collisions" });
  assert.equal(clean.statusCode, 200, clean.body);
  assert.deepEqual(clean.json(), []);

  // Add a colliding skill and re-fetch → one command collision reported once with both ids.
  seedSkill(
    skills,
    "solo2",
    skillMd({ name: "solo2", description: "s2", keywords: ["x"], commands: ["/only"] }),
  );
  const dirty = await app.inject({ method: "GET", url: "/api/skills/trigger-collisions" });
  assert.equal(dirty.statusCode, 200, dirty.body);
  const collisions = (dirty.json() as TriggerCollision[]).map((c) =>
    triggerCollisionSchema.parse(c),
  );
  const commandCollisions = collisions.filter((c) => c.kind === "command");
  assert.equal(commandCollisions.length, 1, dirty.body);
  assert.equal(collisionKey(commandCollisions[0]!.value), collisionKey("/only"));
  assert.equal(commandCollisions[0]!.skillIds.length, 2);
});
