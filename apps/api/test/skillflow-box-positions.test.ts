import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { skillBoxPositionsResponseSchema } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// RM-30 WP 7.8 (design decision 5) — canvas box positions live in the APP'S OWN DATABASE, per skill,
// and NEVER in `SKILL.md`.
//
// That choice is the reason this work package is allowed one migration, and its entire justification
// is a byte count: `SKILL.md`'s body is what the model reads, and this app meters it as the L2
// footprint. A hidden position comment is invisible to a reader and fully visible to the tokenizer —
// a tool whose purpose is measuring context cost must not inflate that cost to store cosmetics. So
// the load-bearing assertion in this file is not "positions round-trip"; it is "`SKILL.md` is
// byte-for-byte identical, and its token footprint unchanged, across a box move".

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

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

function walkFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

async function makeRouteApp(
  skills: SkillRepository,
  runs: RunRepository,
): Promise<FastifyInstance> {
  const { registerSkillflowRoutes } = await import("../src/skillflow/routes.js");
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

function seedFixtureSkill(
  skills: SkillRepository,
  name: string,
): { skillId: string; versionId: string } {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const inputs: SkillFileInput[] = paths
    .sort()
    .map((p) => ({ path: p, bytes: readFileSync(path.join(dir, p)) }));
  const skill = skills.create({ name, sourceType: "upload" });
  const created = skills.createVersion(skill.id, inputs, {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: created.version.id };
}

// ── THE decision's justification ─────────────────────────────────────────────────────────────────

test("SKILL.md is BYTE-UNCHANGED by a box move — the whole reason positions are not stored in it", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  const readSkillMd = () => skills.getFileContent(versionId, "SKILL.md").text as string;
  const before = readSkillMd();
  const beforeSha = createHash("sha256").update(before, "utf8").digest("hex");
  const beforeVersion = skills.getVersion(versionId);
  const beforeVersionCount = skills.listVersions(skillId).length;

  // Move three boxes, twice each — the way a real drag session writes.
  for (const round of [1, 2]) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/skills/${skillId}/box-positions`,
      payload: {
        positions: [
          { nodeId: "gather-inputs", x: 120 * round, y: 40 * round },
          { nodeId: "validate-the-data", x: 500 * round, y: -80 * round },
          { nodeId: "asset-template-html", x: 900.5, y: 220.25 },
        ],
      },
    });
    assert.equal(response.statusCode, 200, response.body);
  }

  const after = readSkillMd();
  assert.equal(after, before, "SKILL.md text is identical");
  assert.equal(
    createHash("sha256").update(after, "utf8").digest("hex"),
    beforeSha,
    "…and identical by digest, not just by ===",
  );

  // Nothing about the VERSION moved either: no new version, same tree sha, same metered footprint.
  const afterVersion = skills.getVersion(versionId);
  assert.equal(skills.listVersions(skillId).length, beforeVersionCount, "no version was created");
  assert.equal(afterVersion.treeSha, beforeVersion.treeSha, "the tree sha is unchanged");
  assert.equal(afterVersion.l2BodyTokens, beforeVersion.l2BodyTokens, "L2 body tokens unchanged");
  assert.equal(
    afterVersion.totalTokens,
    beforeVersion.totalTokens,
    "the total footprint unchanged",
  );

  // And the positions really were written — otherwise the byte-equality above proves nothing.
  const saved = skillBoxPositionsResponseSchema.parse(
    (await app.inject({ method: "GET", url: `/api/skills/${skillId}/box-positions` })).json(),
  );
  assert.equal(saved.positions.length, 3);
  assert.deepEqual(
    saved.positions.find((p) => p.nodeId === "gather-inputs"),
    { nodeId: "gather-inputs", x: 240, y: 80 },
    "the second round overwrote the first (upsert, not append)",
  );
});

// ── Persistence, orphans, and the way back ───────────────────────────────────────────────────────

test("positions persist per SKILL, so they survive a new version rather than dying with the old one", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  await app.inject({
    method: "PUT",
    url: `/api/skills/${skillId}/box-positions`,
    payload: { positions: [{ nodeId: "gather-inputs", x: 10, y: 20 }] },
  });

  // Save a NEW version of the same skill (a section added — exactly the case decision 5 calls out).
  const original = skills.getFileContent(versionId, "SKILL.md").text as string;
  skills.createVersion(
    skillId,
    [
      { path: "SKILL.md", bytes: Buffer.from(`${original}\n## Newly added\n\nSomething new.\n`) },
      ...["reference/format-spec.md", "assets/template.html", "scripts/validate.py"].map((p) => ({
        path: p,
        bytes: Buffer.from(skills.getFileContent(versionId, p).text ?? ""),
      })),
    ],
    { sourceKind: "upload", importedFrom: "upload" },
  );

  const after = skillBoxPositionsResponseSchema.parse(
    (await app.inject({ method: "GET", url: `/api/skills/${skillId}/box-positions` })).json(),
  );
  assert.deepEqual(after.positions, [{ nodeId: "gather-inputs", x: 10, y: 20 }]);
});

test("an ORPHANED position is simply returned — the reader ignores it, one box lays out automatically", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId } = seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  await app.inject({
    method: "PUT",
    url: `/api/skills/${skillId}/box-positions`,
    payload: {
      positions: [
        { nodeId: "gather-inputs", x: 1, y: 2 },
        { nodeId: "a-heading-that-was-renamed-away", x: 3, y: 4 },
      ],
    },
  });

  const saved = skillBoxPositionsResponseSchema.parse(
    (await app.inject({ method: "GET", url: `/api/skills/${skillId}/box-positions` })).json(),
  );
  // The API does NOT prune an orphan: a heading that comes back should find its position waiting.
  // The canvas matches by node id, so an id nothing matches costs that one box its saved place and
  // nothing else — never a broken canvas, and never a silently dropped row.
  assert.equal(saved.positions.length, 2);
  assert.ok(saved.positions.some((p) => p.nodeId === "a-heading-that-was-renamed-away"));
});

test("DELETE is Auto-arrange: it forgets the whole arrangement and is idempotent", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId } = seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  await app.inject({
    method: "PUT",
    url: `/api/skills/${skillId}/box-positions`,
    payload: {
      positions: [
        { nodeId: "a", x: 1, y: 1 },
        { nodeId: "b", x: 2, y: 2 },
      ],
    },
  });

  const cleared = await app.inject({
    method: "DELETE",
    url: `/api/skills/${skillId}/box-positions`,
  });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(skillBoxPositionsResponseSchema.parse(cleared.json()).positions, []);

  // Twice is fine — an operator may click it again.
  const again = await app.inject({ method: "DELETE", url: `/api/skills/${skillId}/box-positions` });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(skills.listBoxPositions(skillId), []);
});

test("a PUT names only the boxes it moved — everything else is left alone", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId } = seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  await app.inject({
    method: "PUT",
    url: `/api/skills/${skillId}/box-positions`,
    payload: {
      positions: [
        { nodeId: "a", x: 1, y: 1 },
        { nodeId: "b", x: 2, y: 2 },
      ],
    },
  });
  await app.inject({
    method: "PUT",
    url: `/api/skills/${skillId}/box-positions`,
    payload: { positions: [{ nodeId: "a", x: 9, y: 9 }] },
  });

  assert.deepEqual(skills.listBoxPositions(skillId), [
    { nodeId: "a", x: 9, y: 9 },
    { nodeId: "b", x: 2, y: 2 },
  ]);
});

test("a hostile or nonsense position is refused at the door, not persisted", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId } = seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  for (const positions of [
    [{ nodeId: "a", x: Number.NaN, y: 0 }],
    [{ nodeId: "a", x: 0, y: 1e12 }],
    [{ nodeId: "", x: 0, y: 0 }],
    [{ nodeId: "a", x: "left", y: 0 }],
  ]) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/skills/${skillId}/box-positions`,
      payload: { positions },
    });
    assert.equal(response.statusCode, 400, `refused: ${JSON.stringify(positions)}`);
  }
  assert.deepEqual(skills.listBoxPositions(skillId), [], "nothing was written");
});

test("404s on an unknown skill, for read, write and clear alike", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const app = await makeRouteApp(skills, runs);

  for (const [method, payload] of [
    ["GET", undefined],
    ["PUT", { positions: [] }],
    ["DELETE", undefined],
  ] as const) {
    const response = await app.inject({
      method,
      url: "/api/skills/does-not-exist/box-positions",
      ...(payload ? { payload } : {}),
    });
    assert.equal(response.statusCode, 404, `${method} 404s`);
  }
});

test("deleting the skill takes its positions with it (no orphan table growth)", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId } = seedFixtureSkill(skills, "zero-annotation");
  skills.saveBoxPositions(skillId, [{ nodeId: "a", x: 1, y: 1 }]);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM skill_box_positions").get() as { n: number }).n,
    1,
  );
  db.prepare("DELETE FROM skills WHERE id = ?").run(skillId);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM skill_box_positions").get() as { n: number }).n,
    0,
    "the ON DELETE CASCADE fires",
  );
});

// ── Exactly one migration ────────────────────────────────────────────────────────────────────────

test("this work package took EXACTLY ONE migration, and a fresh DB and an upgraded one agree", () => {
  // The WP's budget is one migration, for this and only this. v62 is it — one step past v61.
  assert.equal(LATEST_SCHEMA_VERSION, 62);

  /** The `skill_box_positions` DDL as this database actually holds it, whitespace-normalized. */
  const ddlOf = (db: AppDatabase): string | undefined => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='skill_box_positions'")
      .get() as { sql: string } | undefined;
    return row ? row.sql.replace(/\s+/g, " ").trim() : undefined;
  };

  // A FRESH database: the schema.ts baseline, where applyMigrations no-ops every step.
  const freshDdl = ddlOf(createDatabase());
  assert.ok(freshDdl, "a fresh DB has the table from the baseline schema");

  // A PRE-v62 database: the same baseline with this one table cut out, stamped one version back.
  const upgraded = new Database(":memory:");
  databases.push(upgraded);
  upgraded.pragma("foreign_keys = ON");
  const withoutTable = schemaSql.replace(
    /CREATE TABLE IF NOT EXISTS skill_box_positions \([\s\S]*?\);\n/,
    "",
  );
  assert.notEqual(withoutTable, schemaSql, "the baseline really was cut down (the regex matched)");
  upgraded.exec(withoutTable);
  assert.equal(ddlOf(upgraded as unknown as AppDatabase), undefined, "…and the table is absent");
  upgraded.pragma(`user_version = ${LATEST_SCHEMA_VERSION - 1}`);

  applyMigrations(upgraded as unknown as AppDatabase);

  assert.equal(
    ddlOf(upgraded as unknown as AppDatabase),
    freshDdl,
    "the migration lands the SAME shape a fresh DB gets from the baseline",
  );
  assert.equal(upgraded.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION);
});
