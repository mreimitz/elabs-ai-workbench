import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type {
  BoundTool,
  ScaffoldFromServerResult,
  SkillFileNode,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { SkillBindingRepository } from "../src/skills/binding-repository.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 8.4 (I9.4) — scaffold a NEW skill from a server's tool surface. Covers: a valid skill
// out of a seeded fixture server (manifest parses, frontmatter `servers:` = the source server, ONE
// `##` section + ONE `tool_ref` per selected tool, bindings resolved to the source server, bound-tools
// immediately live); the status-aware latest-success scan as the source (persisted reads only — the
// `echo` server proves never-scan); servers WITHOUT a completed scan are refused (400); slug/name
// collisions → 409; unknown tool → 400; unknown server → 404.

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

type Harness = {
  app: FastifyInstance;
  repo: SkillRepository;
  serverRepo: ServerRepository;
  bindingRepo: SkillBindingRepository;
  scans: ScanRepository;
  db: AppDatabase;
};

async function buildApp(): Promise<Harness> {
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
    `skill-ide-scaffold-${Math.random().toString(36).slice(2)}`,
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
  await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo, scans);
  await app.ready();
  apps.push(app);
  return { app, repo, serverRepo, bindingRepo, scans, db };
}

const seedServer = (serverRepo: ServerRepository, name: string) =>
  serverRepo.create({ name, transport: "stdio", command: "echo" }).id;

function toolInsert(name: string, totalTokens: number, description?: string): ToolScanInsert {
  return {
    toolName: name,
    description,
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
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

/** Seed one scan for a server at a CONTROLLED `scanned_at` (deterministic newest-first ordering). */
function seedScan(
  db: AppDatabase,
  scans: ScanRepository,
  serverId: string,
  opts: { scannedAt: string; status: "success" | "failed"; tools?: ToolScanInsert[] },
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
  } else {
    scans.failScan(running.id, "boom");
  }
  return running.id;
}

async function scaffold(app: FastifyInstance, body: unknown) {
  return app.inject({ method: "POST", url: "/api/skills/scaffold-from-server", payload: body });
}

/** Count `tool_ref` nodes in the projected graph of a skill's current version. */
function toolRefLabels(repo: SkillRepository, skillId: string): string[] {
  const versionId = repo.getPublic(skillId).currentVersionId;
  assert.ok(versionId, "the created skill has a current version");
  const md = repo.getFileContent(versionId, "SKILL.md");
  assert.ok(!md.isBinary && typeof md.text === "string", "SKILL.md is text");
  const files: SkillFileNode[] = repo.listFiles(versionId);
  const graph = projectSkillGraph(md.text, files);
  return graph.nodes.filter((node) => node.kind === "tool_ref").map((node) => node.label);
}

// ── (1) Happy path — a valid skill with one section + one tool_ref per selected tool ──────────────

test("scaffold-from-server creates a valid skill with one section + one tool_ref per selected tool", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [
      toolInsert("get_widget", 40, "Fetches a widget by id. Returns the full record."),
      toolInsert("list_widgets", 55, "Lists widgets with paging."),
      toolInsert("delete_widget", 33, "Deletes a widget permanently."),
    ],
  });

  const res = await scaffold(app, {
    serverId: alpha,
    name: "widget-helper",
    displayName: "Widget Helper",
    tools: ["get_widget", "delete_widget"],
  });
  assert.equal(res.statusCode, 201, res.body);
  const result = res.json() as ScaffoldFromServerResult;

  // The created skill is v1 with a resolved binding to the SOURCE server.
  assert.equal(result.skill.name, "widget-helper");
  assert.equal(result.skill.slug, "widget-helper");
  assert.equal(result.skill.versionCount, 1);
  assert.deepEqual(
    result.bindings,
    [{ serverName: "Alpha", serverId: alpha }],
    "bound to the source server",
  );

  // The manifest parses valid and declares `servers: [Alpha]`.
  const versionId = repo.getPublic(result.skill.id).currentVersionId!;
  const md = repo.getFileContent(versionId, "SKILL.md");
  assert.ok(!md.isBinary && md.text);
  const parsed = parseSkillManifest(md.text ?? "");
  assert.equal(parsed.valid, true, `manifest should parse valid: ${parsed.errors.join("; ")}`);
  assert.equal(parsed.manifest.name, "widget-helper");
  assert.deepEqual(parsed.manifest.servers, ["Alpha"]);

  // ONE `##` heading + ONE `tool_ref` per SELECTED tool (not the unselected `list_widgets`).
  const headings = (md.text ?? "").match(/^## .+$/gm) ?? [];
  assert.deepEqual(
    headings,
    ["## get_widget", "## delete_widget"],
    "one section per selected tool, in scan order",
  );
  assert.deepEqual(toolRefLabels(repo, result.skill.id).sort(), ["delete_widget", "get_widget"]);

  // The description's FIRST SENTENCE seeds the section body (not the whole description).
  assert.ok((md.text ?? "").includes("Fetches a widget by id."), "first sentence present");
  assert.ok(
    !(md.text ?? "").includes("Returns the full record."),
    "only the first sentence is used",
  );
});

// ── (2) Bound-tools are immediately live for the new skill (palette/completion) ────────────────────

test("scaffold-from-server: the new skill's bound-tools are immediately live", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [
      toolInsert("get_widget", 40, "Fetches a widget."),
      toolInsert("list_widgets", 55, "Lists widgets."),
    ],
  });

  const result = (
    await scaffold(app, { serverId: alpha, name: "wh", tools: ["get_widget"] })
  ).json() as ScaffoldFromServerResult;
  const versionId = repo.getPublic(result.skill.id).currentVersionId!;

  const bt = await app.inject({
    url: `/api/skills/${result.skill.id}/versions/${versionId}/bound-tools`,
  });
  assert.equal(bt.statusCode, 200, bt.body);
  const tools = bt.json() as BoundTool[];
  // The whole bound server's tool surface is exposed to the editor (both tools), server-resolved.
  assert.deepEqual(tools.map((t) => t.toolName).sort(), ["get_widget", "list_widgets"]);
  assert.ok(tools.every((t) => t.serverId === alpha && t.serverName === "Alpha"));
});

// ── (3) A tool with no description still yields one section + one tool_ref ─────────────────────────

test("scaffold-from-server tolerates a tool with no scan description (still one tool_ref)", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("run_report", 12, undefined)],
  });

  const result = (
    await scaffold(app, { serverId: alpha, name: "reporter", tools: ["run_report"] })
  ).json() as ScaffoldFromServerResult;
  assert.deepEqual(toolRefLabels(repo, result.skill.id), ["run_report"]);
});

// ── (4) Servers WITHOUT a completed scan are refused ──────────────────────────────────────────────

test("scaffold-from-server 400s when the server has no completed scan (only failed/none)", async () => {
  const { app, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha"); // only a FAILED scan
  seedScan(db, scans, alpha, { scannedAt: "2026-01-01T00:00:00.000Z", status: "failed" });
  const beta = seedServer(serverRepo, "Beta"); // NO scan at all

  const a = await scaffold(app, { serverId: alpha, name: "a-skill", tools: ["x"] });
  assert.equal(a.statusCode, 400, a.body);
  assert.match((a.json() as { error: string }).error, /no completed scan/i);

  const b = await scaffold(app, { serverId: beta, name: "b-skill", tools: ["x"] });
  assert.equal(b.statusCode, 400, b.body);
});

// ── (5) Slug/name collision → 409 ─────────────────────────────────────────────────────────────────

test("scaffold-from-server 409s on a slug/name collision", async () => {
  const { app, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("get_widget", 40, "Fetches a widget.")],
  });

  const first = await scaffold(app, { serverId: alpha, name: "dupe", tools: ["get_widget"] });
  assert.equal(first.statusCode, 201, first.body);

  const clash = await scaffold(app, { serverId: alpha, name: "dupe", tools: ["get_widget"] });
  assert.equal(clash.statusCode, 409, clash.body);
  assert.match((clash.json() as { error: string }).error, /already exists/i);
});

// ── (6) Unknown tool → 400, unknown server → 404 ──────────────────────────────────────────────────

test("scaffold-from-server 400s on a tool not in the latest scan", async () => {
  const { app, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("get_widget", 40, "Fetches a widget.")],
  });
  const res = await scaffold(app, { serverId: alpha, name: "s", tools: ["nope_tool"] });
  assert.equal(res.statusCode, 400, res.body);
  assert.match((res.json() as { error: string }).error, /not in the latest scan/i);
});

test("scaffold-from-server 404s on an unknown server", async () => {
  const { app } = await buildApp();
  const res = await scaffold(app, { serverId: "no-such-server", name: "s", tools: ["x"] });
  assert.equal(res.statusCode, 404, res.body);
});

// ── (7) Validation — an empty tool set / invalid name is rejected ─────────────────────────────────

test("scaffold-from-server rejects an empty tool selection (zod min 1)", async () => {
  const { app, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("get_widget", 40, "Fetches a widget.")],
  });
  const res = await scaffold(app, { serverId: alpha, name: "s", tools: [] });
  assert.equal(res.statusCode, 400, res.body);
});

test("scaffold-from-server uses the LATEST success scan as the source (not an older one)", async () => {
  const { app, repo, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  // Older success exposes `old_tool`; newer success exposes `new_tool` — only the newer is scaffoldable.
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("old_tool", 9, "The stale one.")],
  });
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-02T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("new_tool", 9, "The live one.")],
  });

  const stale = await scaffold(app, { serverId: alpha, name: "stale", tools: ["old_tool"] });
  assert.equal(stale.statusCode, 400, "the old scan's tool is no longer scaffoldable");

  const live = (
    await scaffold(app, { serverId: alpha, name: "live", tools: ["new_tool"] })
  ).json() as ScaffoldFromServerResult;
  assert.deepEqual(toolRefLabels(repo, live.skill.id), ["new_tool"]);
});
