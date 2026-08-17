import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOL_VALIDATION_VERSION, toolDiagnosticsReportSchema } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { parseSkillflowAnnotations } from "../src/skillflow/annotations.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import {
  extractToolReferences,
  parseServerScope,
  validateToolReferences,
  type ServerScanHistory,
} from "../src/skillflow/tool-validation.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Hand-built server/scan fixtures for the PURE validator (no DB) ────────────────────────────────
// Alpha: latest {list_tables, run_query}; older {…, drop_table} → drop_table is stale.
// Beta:  latest {send_email}. Gamma: no completed scan → surfaces in `unscannedServers`.
const SERVERS: ServerScanHistory[] = [
  {
    serverId: "srv-alpha",
    serverName: "Alpha",
    scans: [
      { scanId: "a-2", toolNames: ["list_tables", "run_query"] }, // latest
      { scanId: "a-1", toolNames: ["list_tables", "run_query", "drop_table"] }, // older
    ],
  },
  {
    serverId: "srv-beta",
    serverName: "Beta",
    scans: [{ scanId: "b-1", toolNames: ["send_email"] }],
  },
  { serverId: "srv-gamma", serverName: "Gamma", scans: [] },
];

// ── (1) Extraction heuristic — conservative shape + context signal ────────────────────────────────

test("extraction: shape-matching backticked identifier WITH a context word is a reference", () => {
  const refs = extractToolReferences("# S\n\nCall the `list_tables` tool to list tables.\n");
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, line: r.line })),
    [{ name: "list_tables", line: 3 }],
  );
  assert.deepEqual(refs[0]!.anchor.startLine, 3);
  assert.deepEqual(refs[0]!.anchor.endLine, 3);
  assert.deepEqual(refs[0]!.anchor.headingPath, ["S"]);
});

test("extraction: context word on an ADJACENT line still admits the reference", () => {
  const refs = extractToolReferences("# S\n\nUse this next:\n`run_query`\n");
  assert.deepEqual(
    refs.map((r) => r.name),
    ["run_query"],
  );
});

test("extraction is conservative: no context word → not a reference", () => {
  assert.deepEqual(extractToolReferences("# S\n\nSee `list_tables` for details.\n"), []);
});

test("extraction is conservative: a bare single word is NEVER a reference (even with context)", () => {
  assert.deepEqual(extractToolReferences("# S\n\nCall the `search` tool now.\n"), []);
});

test("extraction: an identifier that itself contains a context word cannot self-admit", () => {
  // `use_widget` contains "use", but the context scan strips inline code first, so with no OTHER
  // context word on the line it is not admitted.
  assert.deepEqual(extractToolReferences("# S\n\nThe `use_widget` helper exists.\n"), []);
});

test("extraction: fenced code blocks and frontmatter are skipped", () => {
  const md = "---\ntool: `list_tables`\n---\n# S\n\n```\ncall the `run_query` tool\n```\n";
  assert.deepEqual(extractToolReferences(md), []);
});

test("extraction: namespaced server:tool shape is recognized", () => {
  const refs = extractToolReferences("# S\n\nInvoke the `acme:list_apps` tool.\n");
  assert.deepEqual(
    refs.map((r) => r.name),
    ["acme:list_apps"],
  );
});

// Skill IDE WP 8.1 (I9.2) — SINGLE implementation: the heuristic was lifted into `extract-tools.ts`
// and both the projector and this validator consume it. `tool-validation.ts` RE-EXPORTS the extract
// module's functions, so the two import sites resolve to the EXACT SAME function object (no fork).
test("single implementation: tool-validation re-exports extract-tools' functions (same object, byte-identical)", async () => {
  const extract = await import("../src/skillflow/extract-tools.js");
  assert.equal(
    extractToolReferences,
    extract.extractToolReferences,
    "extractToolReferences is the extract-tools export",
  );
  assert.equal(
    parseServerScope,
    extract.parseServerScope,
    "parseServerScope is the extract-tools export",
  );
  // And behavior matches on a shape+context reference through both import sites.
  const md = "# S\n\nCall the `list_tables` tool.\n";
  assert.deepEqual(extract.extractToolReferences(md), extractToolReferences(md));
});

// ── (2) Scope annotation parsing ──────────────────────────────────────────────────────────────────

test("scope: no annotation → null (all servers); annotation → lower-cased, trimmed names", () => {
  assert.equal(parseServerScope("# S\n\nCall the `run_query` tool.\n"), null);
  assert.deepEqual(parseServerScope("<!-- skillflow:servers Alpha, Beta -->\n# S\n"), [
    "alpha",
    "beta",
  ]);
});

// ── (3) Validation — clean / unknown+candidates / stale / scoped / unscanned ──────────────────────

function validate(md: string): ReturnType<typeof validateToolReferences> {
  return validateToolReferences(md, SERVERS);
}

test("clean: references to current tools produce no diagnostics", () => {
  const report = validate("# Ops\n\nCall the `list_tables` tool, then use the `run_query` tool.\n");
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.toolValidationVersion, TOOL_VALIDATION_VERSION);
});

test("unknown_tool: no match anywhere → diagnostic with top-3 fuzzy candidates", () => {
  const report = validate("# Ops\n\nUse the `list_all_tables` tool.\n");
  assert.equal(report.diagnostics.length, 1);
  const [d] = report.diagnostics;
  assert.equal(d!.kind, "unknown_tool");
  assert.equal(d!.name, "list_all_tables");
  assert.equal(d!.anchor?.startLine, 3);
  // Fuzzy near-match on the current tool surfaces as a candidate.
  assert.ok(
    d!.candidates.some(
      (c) => c.server === "Alpha" && c.tool === "list_tables" && c.confidence === "fuzzy",
    ),
    JSON.stringify(d!.candidates),
  );
  assert.ok(d!.candidates.length <= 3);
});

test("stale_tool: matched in an OLDER scan but absent from the latest → stale", () => {
  const report = validate("# Ops\n\nYou could call the `drop_table` tool before.\n");
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0]!.kind, "stale_tool");
  assert.equal(report.diagnostics[0]!.name, "drop_table");
});

test("scope narrows the server set: a Beta-only tool is unknown when scoped to Alpha", () => {
  const scoped = validate(
    "<!-- skillflow:servers Alpha -->\n# Ops\n\nCall the `send_email` tool.\n",
  );
  assert.equal(scoped.diagnostics.length, 1);
  assert.equal(scoped.diagnostics[0]!.kind, "unknown_tool");
  assert.equal(scoped.diagnostics[0]!.name, "send_email");
  // Scoped to Alpha only → the unscanned Gamma is out of scope, so it is NOT reported.
  assert.equal(scoped.unscannedServers, undefined);

  // Without the scope annotation, send_email is a current Beta tool → clean.
  const unscoped = validate("# Ops\n\nCall the `send_email` tool.\n");
  assert.deepEqual(unscoped.diagnostics, []);
});

test("unscanned servers are skipped (no false unknowns) and reported in unscannedServers", () => {
  const report = validate("# Ops\n\nUse the `run_query` tool.\n");
  assert.deepEqual(report.unscannedServers, ["Gamma"]);
});

test("validation is deterministic (same input → deep-equal report)", () => {
  const md = "# Ops\n\nUse the `list_all_tables` tool, then call the `drop_table` tool.\n";
  assert.deepEqual(validate(md), validate(md));
});

test("empty / unparseable SKILL.md degrades to an empty report", () => {
  assert.deepEqual(validateToolReferences("", SERVERS).diagnostics, []);
});

// ── (4) `skillflow:servers` is registered — never warns during annotation parsing / projection ────

test("annotations: skillflow:servers never warns (document-scope, not heading-bound)", () => {
  const lines = "<!-- skillflow:servers Alpha, Beta -->\n\n# Ops\n\nBody.\n".split("\n");
  const parsed = parseSkillflowAnnotations(lines);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.byTargetLine.size, 0);

  const graph = projectSkillGraph("<!-- skillflow:servers Alpha -->\n\n# Ops\n\nBody.\n", []);
  assert.ok(!graph.warnings.some((w) => /servers/.test(w)), JSON.stringify(graph.warnings));
});

// ── (5) Fixture test at the REPOSITORY level, through the real GET route ──────────────────────────

const NOW = "2026-07-05T00:00:00.000Z";
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

function seedServer(db: AppDatabase, id: string, name: string): void {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, created_at, updated_at)
     VALUES (@id, @name, 'stdio', @now, @now)`,
  ).run({ id, name, now: NOW });
}

function seedScan(
  db: AppDatabase,
  opts: { serverId: string; scanId: string; scannedAt: string; toolNames: string[] },
): void {
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, counting_version)
     VALUES (@id, @serverId, 'generic_o200k', @scannedAt, 'success', @n, 2)`,
  ).run({
    id: opts.scanId,
    serverId: opts.serverId,
    scannedAt: opts.scannedAt,
    n: opts.toolNames.length,
  });
  const insert = db.prepare(
    `INSERT INTO mcp_tool_scans (
       id, scan_id, tool_name, input_schema_json, raw_tool_json,
       total_tokens, name_tokens, description_tokens, schema_tokens, annotations_tokens, raw_bytes, contribution_percent
     ) VALUES (@id, @scanId, @toolName, NULL, '{}', 0, 0, 0, 0, 0, 0, 0)`,
  );
  opts.toolNames.forEach((toolName, i) =>
    insert.run({ id: `${opts.scanId}-t${i}`, scanId: opts.scanId, toolName }),
  );
}

/** Alpha (latest {list_tables, run_query} · older adds drop_table), Beta ({send_email}), Gamma (no scan). */
function seedFleet(db: AppDatabase): void {
  seedServer(db, "srv-alpha", "Alpha");
  seedServer(db, "srv-beta", "Beta");
  seedServer(db, "srv-gamma", "Gamma");
  seedScan(db, {
    serverId: "srv-alpha",
    scanId: "a-1",
    scannedAt: "2026-06-01T00:00:00.000Z",
    toolNames: ["list_tables", "run_query", "drop_table"],
  });
  seedScan(db, {
    serverId: "srv-alpha",
    scanId: "a-2",
    scannedAt: "2026-06-02T00:00:00.000Z",
    toolNames: ["list_tables", "run_query"],
  });
  seedScan(db, {
    serverId: "srv-beta",
    scanId: "b-1",
    scannedAt: "2026-06-02T00:00:00.000Z",
    toolNames: ["send_email"],
  });
}

function seedSkillVersion(skills: SkillRepository, skillId: string, skillMd: string): string {
  const files: SkillFileInput[] = [{ path: "SKILL.md", bytes: Buffer.from(skillMd, "utf8") }];
  return skills.createVersion(skillId, files, { sourceKind: "upload", importedFrom: "upload" })
    .version.id;
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

test("GET …/tool-diagnostics: repository-seeded scans drive clean/unknown/stale/unscanned via the real route", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  seedFleet(db);

  const skill = skills.create({ name: "ops", sourceType: "upload" });
  const md =
    "# Ops skill\n\n" +
    "Call the `list_tables` tool to enumerate tables.\n\n" +
    "Then use the `run_query` tool to fetch rows.\n\n" +
    "You could call the `drop_table` tool in the past.\n\n" +
    "Try the `list_all_tables` tool for everything at once.\n\n" +
    "A bare `search` word is fine to use.\n";
  const versionId = seedSkillVersion(skills, skill.id, md);

  const app = await makeRouteApp(skills, runs);
  const res = await app.inject({
    method: "GET",
    url: `/api/skills/${skill.id}/versions/${versionId}/tool-diagnostics`,
  });
  assert.equal(res.statusCode, 200, res.body);
  const report = toolDiagnosticsReportSchema.parse(res.json());

  assert.equal(report.toolValidationVersion, TOOL_VALIDATION_VERSION);
  // Gamma has no completed scan → surfaced, not turned into false unknowns.
  assert.deepEqual(report.unscannedServers, ["Gamma"]);

  const byName = new Map(report.diagnostics.map((d) => [d.name, d]));
  // list_tables + run_query are current → no diagnostics; `search` is a bare word → not extracted.
  assert.ok(!byName.has("list_tables"));
  assert.ok(!byName.has("run_query"));
  assert.ok(!byName.has("search"));
  // drop_table is stale (Alpha's older scan had it, the latest does not).
  assert.equal(byName.get("drop_table")?.kind, "stale_tool");
  // list_all_tables is unknown, with a fuzzy candidate on the current list_tables.
  const unknown = byName.get("list_all_tables");
  assert.equal(unknown?.kind, "unknown_tool");
  assert.ok(unknown?.candidates.some((c) => c.tool === "list_tables" && c.confidence === "fuzzy"));

  assert.equal(report.diagnostics.length, 2);
});

test("GET …/tool-diagnostics: scope annotation narrows the server set through the route", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  seedFleet(db);
  const skill = skills.create({ name: "ops", sourceType: "upload" });

  // Scoped to Alpha → the Beta-only `send_email` is unknown; unscanned Gamma is out of scope.
  const scopedVid = seedSkillVersion(
    skills,
    skill.id,
    "<!-- skillflow:servers Alpha -->\n# Ops\n\nCall the `send_email` tool.\n",
  );
  // Unscoped → `send_email` is a current Beta tool → clean.
  const openVid = seedSkillVersion(skills, skill.id, "# Ops\n\nCall the `send_email` tool.\n");

  const app = await makeRouteApp(skills, runs);
  const scoped = toolDiagnosticsReportSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/skills/${skill.id}/versions/${scopedVid}/tool-diagnostics`,
      })
    ).json(),
  );
  assert.equal(scoped.diagnostics.length, 1);
  assert.equal(scoped.diagnostics[0]!.kind, "unknown_tool");
  assert.equal(scoped.diagnostics[0]!.name, "send_email");
  assert.equal(scoped.unscannedServers, undefined);

  const open = toolDiagnosticsReportSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/skills/${skill.id}/versions/${openVid}/tool-diagnostics`,
      })
    ).json(),
  );
  assert.deepEqual(open.diagnostics, []);
});

test("GET …/tool-diagnostics: 404 on an unknown skill or version", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const skill = skills.create({ name: "ops", sourceType: "upload" });
  const versionId = seedSkillVersion(skills, skill.id, "# S\n\nCall the `run_query` tool.\n");

  const app = await makeRouteApp(skills, runs);
  const missingSkill = await app.inject({
    method: "GET",
    url: `/api/skills/nope/versions/${versionId}/tool-diagnostics`,
  });
  assert.equal(missingSkill.statusCode, 404);
  const missingVersion = await app.inject({
    method: "GET",
    url: `/api/skills/${skill.id}/versions/nope/tool-diagnostics`,
  });
  assert.equal(missingVersion.statusCode, 404);
});

// ── (6) Never-execute — static import scan on the validation module ───────────────────────────────

test("never-execute: tool-validation.ts imports no MCP client / session / tool-bridge / child_process", () => {
  const source = fs.readFileSync(path.resolve(here, "../src/skillflow/tool-validation.ts"), "utf8");
  const forbidden = [
    /openSession/,
    /from ["'][^"']*mcp\//,
    /tool-bridge/,
    /callTool/,
    /child_process/,
    /better-sqlite3/,
    /ScanRepository/,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(source),
      `tool-validation.ts must not reference ${pattern} — it reads only persisted scan data handed in by the route`,
    );
  }
});
