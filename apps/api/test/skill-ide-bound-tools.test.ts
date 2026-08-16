import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { BoundTool } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillBindingRepository } from "../src/skills/binding-repository.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 8.2 (I9.3) — the bound-tools API behind Monaco completion + hover. Covers: resolution
// reuse (frontmatter `servers:` → registered id → the server's LATEST COMPLETED scan's tools); the
// STATUS-AWARE latest-scan choice (newest `success`, never a newer failed/running scan, never an older
// success); schemaParams parsing (name/type/required from the input schema); definitionTokens =
// mcp_tool_scans.total_tokens; honest degradation (unbound skill / no completed scan / missing scans
// DI ⇒ `[]`); 404 guards; and the never-scan discipline (persisted reads only).

const here = path.dirname(fileURLToPath(import.meta.url));
const dbs: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const app of apps.splice(0)) await app.close();
});

function track(db: AppDatabase): AppDatabase {
  dbs.push(db);
  return db;
}

// ── Harness: a skills app WITH (or WITHOUT) the ScanRepository DI ─────────────────────────────────

type Harness = {
  app: FastifyInstance;
  repo: SkillRepository;
  serverRepo: ServerRepository;
  bindingRepo: SkillBindingRepository;
  scans: ScanRepository;
  db: AppDatabase;
};

async function buildApp(opts: { withScans?: boolean } = {}): Promise<Harness> {
  const withScans = opts.withScans ?? true;
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new SkillRepository(db, secrets);
  const serverRepo = new ServerRepository(db, secrets);
  const bindingRepo = new SkillBindingRepository(db);
  const scans = new ScanRepository(db);
  const dataDir = path.join(
    os.tmpdir(),
    `skill-ide-bound-tools-${Math.random().toString(36).slice(2)}`,
  );
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const git = new SkillGitService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const publish = new SkillPublishService(repo, { dataDir });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  // The `scans` DI is positioned after `servers` and before `options`. Omitting it (the pre-8.2 test
  // callers' pattern) makes it `undefined` at runtime — the bound-tools route degrades to `[]`.
  if (withScans) {
    await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo, scans);
  } else {
    await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo);
  }
  await app.ready();
  apps.push(app);
  return { app, repo, serverRepo, bindingRepo, scans, db };
}

// ── Seeding helpers ──────────────────────────────────────────────────────────────────────────────

/** A skill whose SKILL.md frontmatter declares `servers:` — returns both ids the routes need. */
function seedSkill(
  repo: SkillRepository,
  servers: string[] | undefined,
): { skillId: string; versionId: string } {
  const skill = repo.create({ name: "bound-tools-skill", sourceType: "upload" });
  const frontmatter = servers ? `servers:\n${servers.map((s) => `  - ${s}`).join("\n")}\n` : "";
  const md = `---\nname: bound-tools-skill\ndescription: A fixture for the WP 8.2 bound-tools route.\n${frontmatter}---\n\n# Bound Tools Skill\n\nCall a tool.\n`;
  const parsed = parseSkillManifest(md);
  const version = repo.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from(md, "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: parsed.manifest,
      manifestValid: parsed.valid,
      manifestErrors: parsed.errors,
    },
  );
  const versionId = version.version?.id ?? repo.getPublic(skill.id).currentVersionId;
  assert.ok(versionId, "seeded skill has a current version");
  return { skillId: skill.id, versionId };
}

const seedServer = (serverRepo: ServerRepository, name: string) =>
  serverRepo.create({ name, transport: "stdio", command: "echo" }).id;

/** A tool row with a controllable name/tokens/schema for the bound-tools projection. */
function toolInsert(
  name: string,
  totalTokens: number,
  inputSchema: unknown,
  description?: string,
): ToolScanInsert {
  return {
    toolName: name,
    description,
    inputSchema,
    annotations: undefined,
    rawTool: { name },
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 4,
    schemaTokens: 6,
    annotationsTokens: 0,
    rawBytes: 64,
    contributionPercent: 0,
  };
}

/**
 * Seed one scan for a server at a CONTROLLED `scanned_at` (so newest-first ordering is deterministic —
 * two scans created in the same millisecond would otherwise tie). Completes it to `success` with the
 * given tools, or fails it (no tools) when `status: "failed"`. `running` leaves it in-flight.
 */
function seedScan(
  db: AppDatabase,
  scans: ScanRepository,
  serverId: string,
  opts: { scannedAt: string; status: "success" | "failed" | "running"; tools?: ToolScanInsert[] },
): string {
  const running = scans.createRunningScan(serverId, "generic_o200k");
  db.prepare("UPDATE mcp_scans SET scanned_at = ? WHERE id = ?").run(opts.scannedAt, running.id);
  if (opts.status === "success") {
    const tools = opts.tools ?? [];
    const totalTokens = tools.reduce((sum, t) => sum + t.totalTokens, 0);
    scans.completeScan(
      running.id,
      {
        totalTools: tools.length,
        totalTokens,
        totalRawBytes: 100,
        averageTokensPerTool: tools.length ? totalTokens / tools.length : 0,
        largestToolName: tools[0]?.toolName ?? null,
        largestToolTokens: tools[0]?.totalTokens ?? 0,
        totalResources: 0,
        totalResourceTemplates: 0,
        totalPrompts: 0,
        totalResourceTokens: 0,
        totalPromptTokens: 0,
        largestResourceName: null,
        largestResourceTokens: 0,
        largestPromptName: null,
        largestPromptTokens: 0,
      },
      tools,
    );
  } else if (opts.status === "failed") {
    scans.failScan(running.id, "boom");
  }
  return running.id;
}

const getBoundTools = async (app: FastifyInstance, skillId: string, versionId: string) => {
  const res = await app.inject({ url: `/api/skills/${skillId}/versions/${versionId}/bound-tools` });
  return res;
};

const byName = (tools: BoundTool[]) => new Map(tools.map((t) => [t.toolName, t] as const));

// ── (1) Resolution + status-aware latest scan ────────────────────────────────────────────────────

test("bound-tools returns the LATEST COMPLETED scan's tools for each resolved binding", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  // Oldest success (old_tool) → newer success (current_tool) → NEWEST failed (must be ignored).
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("old_tool", 10, { type: "object" }, "stale")],
  });
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-02T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("current_tool", 42, { type: "object" }, "the live one")],
  });
  seedScan(db, scans, alpha, { scannedAt: "2026-01-03T00:00:00.000Z", status: "failed" });

  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);

  const res = await getBoundTools(app, skillId, versionId);
  assert.equal(res.statusCode, 200, res.body);
  const tools = res.json() as BoundTool[];
  assert.deepEqual(
    tools.map((t) => t.toolName),
    ["current_tool"],
    "the newest SUCCESS scan wins (not the older success, not the newer failed scan)",
  );
  assert.equal(tools[0]?.serverName, "Alpha");
  assert.equal(tools[0]?.serverId, alpha);
  assert.equal(tools[0]?.definitionTokens, 42, "definitionTokens = mcp_tool_scans.total_tokens");
  assert.equal(tools[0]?.description, "the live one");
});

test("bound-tools ignores a newer RUNNING scan (only success scans are considered)", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("done_tool", 7, { type: "object" })],
  });
  seedScan(db, scans, alpha, { scannedAt: "2026-01-05T00:00:00.000Z", status: "running" });

  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);
  const tools = (await getBoundTools(app, skillId, versionId)).json() as BoundTool[];
  assert.deepEqual(
    tools.map((t) => t.toolName),
    ["done_tool"],
    "a running scan never surfaces as the latest",
  );
});

test("bound-tools aggregates across MULTIPLE resolved bindings", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  const beta = seedServer(serverRepo, "Beta");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("a_tool", 11, { type: "object" })],
  });
  seedScan(db, scans, beta, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("b_tool", 22, { type: "object" })],
  });
  const { skillId, versionId } = seedSkill(repo, ["Alpha", "Beta"]);

  const map = byName((await getBoundTools(app, skillId, versionId)).json() as BoundTool[]);
  assert.deepEqual([...map.keys()].sort(), ["a_tool", "b_tool"]);
  assert.equal(map.get("a_tool")?.serverName, "Alpha");
  assert.equal(map.get("b_tool")?.serverName, "Beta");
});

// ── (2) schemaParams parsing ─────────────────────────────────────────────────────────────────────

test("bound-tools parses schemaParams (name + type + required) from the tool's input schema", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  const schema = {
    type: "object",
    properties: {
      q: { type: "string" },
      limit: { type: ["integer", "null"] },
      mode: { enum: ["fast", "slow"] },
      flag: {},
    },
    required: ["q", "mode"],
  };
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("search", 99, schema)],
  });
  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);

  const tools = (await getBoundTools(app, skillId, versionId)).json() as BoundTool[];
  const params = new Map(tools[0]?.schemaParams.map((p) => [p.name, p]) ?? []);
  assert.deepEqual(params.get("q"), { name: "q", type: "string", required: true });
  assert.deepEqual(params.get("limit"), { name: "limit", type: "integer | null", required: false });
  assert.deepEqual(params.get("mode"), { name: "mode", type: "enum", required: true });
  assert.deepEqual(params.get("flag"), { name: "flag", type: "unknown", required: false });
});

test("bound-tools yields an empty schemaParams for a tool without a properties object", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("no_params", 5, { type: "object" })],
  });
  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);
  const tools = (await getBoundTools(app, skillId, versionId)).json() as BoundTool[];
  assert.deepEqual(tools[0]?.schemaParams, []);
});

// ── (3) Honest degradation ───────────────────────────────────────────────────────────────────────

test("bound-tools for an UNBOUND skill (no frontmatter servers) is an empty list", async () => {
  const { app, repo } = await buildApp();
  const { skillId, versionId } = seedSkill(repo, undefined);
  const res = await getBoundTools(app, skillId, versionId);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), [], "an unbound skill registers no editor tools");
});

test("bound-tools skips a frontmatter server that resolves to no registered server (unbound name)", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha"); // "Ghost" is deliberately NOT registered
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("a_tool", 3, { type: "object" })],
  });
  const { skillId, versionId } = seedSkill(repo, ["Alpha", "Ghost"]);
  const tools = (await getBoundTools(app, skillId, versionId)).json() as BoundTool[];
  assert.deepEqual(
    tools.map((t) => t.toolName),
    ["a_tool"],
    "the unresolved 'Ghost' contributes nothing",
  );
});

test("bound-tools skips a resolved server that has NO completed scan", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  // Alpha is registered + bound, but its only scan FAILED — no completed scan to read.
  seedScan(db, scans, alpha, { scannedAt: "2026-01-01T00:00:00.000Z", status: "failed" });
  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);
  assert.deepEqual(
    (await getBoundTools(app, skillId, versionId)).json(),
    [],
    "no completed scan ⇒ nothing",
  );
});

test("bound-tools tolerates a caller that omits the ScanRepository DI (returns [])", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp({ withScans: false });
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("a_tool", 3, { type: "object" })],
  });
  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);
  const res = await getBoundTools(app, skillId, versionId);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(
    res.json(),
    [],
    "no scans DI ⇒ the route degrades to the honest empty set (never a 500)",
  );
});

// ── (4) 404 guards ───────────────────────────────────────────────────────────────────────────────

test("bound-tools 404s on an unknown version, and on a version of a DIFFERENT skill", async () => {
  const { app, repo } = await buildApp();
  const { skillId } = seedSkill(repo, ["Alpha"]);
  const other = seedSkill(repo, ["Alpha"]);

  assert.equal(
    (await getBoundTools(app, skillId, "nope")).statusCode,
    404,
    "unknown version → 404",
  );
  // A real version, but of the OTHER skill → 404 (cross-skill access guard).
  assert.equal(
    (await getBoundTools(app, skillId, other.versionId)).statusCode,
    404,
    "cross-skill version → 404",
  );
});

// ── (5) Never-scan discipline — persisted reads only, status-aware ───────────────────────────────

test("bound-tools reads PERSISTED scans only — the returned data is exactly what was seeded, never a live probe", async () => {
  // The seeded server's command is `echo`, which is NOT a real MCP server. If the route opened a live
  // MCP connection it would fail / return different tools; instead it returns the seeded scan verbatim,
  // proving it read persisted `mcp_tool_scans` (I5/I9 never-scan).
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("persisted_only", 123, { type: "object" }, "from the DB")],
  });
  const { skillId, versionId } = seedSkill(repo, ["Alpha"]);
  const tools = (await getBoundTools(app, skillId, versionId)).json() as BoundTool[];
  assert.deepEqual(
    tools.map((t) => t.toolName),
    ["persisted_only"],
  );
  assert.equal(tools[0]?.definitionTokens, 123);
});

test("routes.ts uses the STATUS-AWARE latest scan (listSummariesByServer), not getLatestForServer", () => {
  const source = fs.readFileSync(path.resolve(here, "../src/skills/routes.ts"), "utf8");
  assert.ok(
    source.includes("listSummariesByServer("),
    "bound-tools reads the status-filtered scan list",
  );
  // Match a CALL (`getLatestForServer(`), not a prose mention — the route's own comment names the
  // method it deliberately avoids, so a bare substring check would false-positive on the comment.
  assert.ok(
    !source.includes("getLatestForServer("),
    "must NOT call getLatestForServer (it ignores status and could surface a failed/running scan)",
  );
});
