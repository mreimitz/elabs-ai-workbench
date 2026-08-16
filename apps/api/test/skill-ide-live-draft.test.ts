import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ProjectPreviewResponse,
  SkillEditOp,
  SkillFileNode,
  SkillGraph,
  SkillIntentLogEntry,
} from "@mcp-token-footprint/shared";
import { SKILLFLOW_PROJECTOR_VERSION } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { zipSync, type Zippable } from "fflate";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { isSectionNode } from "../src/skillflow/edit-ops.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { applyEditOps, applyOpsToContent } from "../src/skillflow/roundtrip.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 9.1 (I10) — the live-draft engine. The LOAD-BEARING acceptance: for every op fixture,
// apply-preview equals the persisted-path splice BYTE-FOR-BYTE, and project-preview equals the
// persisted projection — because both call the SAME shared code. Plus the content-canonical save
// (intent log → metadata, 409 on a moved head) and the 400-with-reason for unresolvable-anchor ops.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

// --- Fixture loading (same convention as skill-ide-roundtrip.test.ts) ------------------------------

function classifyKind(p: string): SkillFileNode["kind"] {
  if (p === "SKILL.md") return "skill_md";
  if (p.startsWith("scripts/")) return "script";
  if (p.startsWith("reference/") || p.startsWith("references/")) return "reference";
  if (p.startsWith("assets/")) return "asset";
  const lower = p.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "reference";
  return "other";
}

function walkFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

function fixtureFiles(name: string): SkillFileNode[] {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  return paths.sort().map((p) => ({
    path: p,
    size: statSync(path.join(dir, p)).size,
    isBinary: false,
    isSkillMd: p === "SKILL.md",
    kind: classifyKind(p),
    tokenTotal: 0,
  }));
}

function loadFixture(name: string): { skillMd: string; files: SkillFileNode[]; graph: SkillGraph } {
  const files = fixtureFiles(name);
  const skillMd = readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
  return { skillMd, files, graph: projectSkillGraph(skillMd, files) };
}

// Every checked-in SkillFlow fixture — the "for EVERY existing op fixture / all fixtures" acceptance.
const FIXTURES = [
  "annotated",
  "blank-scaffold",
  "github-style",
  "multi-command",
  "zero-annotation",
];

/**
 * A VALID op batch derived from a fixture's projected graph — real ids only, so it passes
 * `validateEditOps` (both the preview route and the edits route validate). Every op here is a
 * text/graph splice (no tree ops); the batch exercises rename / body / annotation / add-section, plus
 * a command op when the fixture has a `/command` flow.
 */
function opsFor(graph: SkillGraph): SkillEditOp[] {
  const ops: SkillEditOp[] = [];
  const sections = graph.nodes.filter(isSectionNode);
  const first = sections[0];
  const second = sections[1];
  if (first) {
    ops.push({ op: "rename_node", nodeId: first.id, label: `${first.label} (edited)` });
  }
  if (second) {
    ops.push({
      op: "update_section_body",
      nodeId: second.id,
      body: "Rewritten body.\n\nWith a paragraph.",
    });
    ops.push({
      op: "set_annotation",
      nodeId: second.id,
      kind: "gatekeeper",
      id: "pinned-gate-9-1",
    });
  }
  // Insert AFTER the first section (not at EOF) so it can't collide with the EOF add_command below.
  ops.push({
    op: "add_subroutine",
    afterNodeId: first?.id ?? null,
    title: "Live Draft Preview Section",
    body: "Added.",
  });
  const command = graph.nodes.find(
    (n): n is Extract<SkillGraph["nodes"][number], { kind: "entry_point" }> =>
      n.kind === "entry_point" && n.trigger.type === "command",
  );
  if (command) {
    ops.push({ op: "add_command", command: "/preview91", title: "Preview command" });
  }
  return ops;
}

// --- Test harness (an in-memory DB + the real routes) ---------------------------------------------

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function buildApp(): Promise<{
  app: FastifyInstance;
  repo: SkillRepository;
  db: AppDatabase;
}> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const dataDir = path.join(
    os.tmpdir(),
    `skill-ide-live-draft-${Math.random().toString(36).slice(2)}`,
  );
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const git = new SkillGitService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const publish = new SkillPublishService(repo, { dataDir });
  const runs = new RunRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillRoutes(app, repo, ingest, git, publish);
  await registerSkillflowRoutes(app, repo, runs);
  await app.ready();
  apps.push(app);
  return { app, repo, db };
}

const BOUNDARY = "----skillIdeLiveDraftBoundary";

function fixtureZip(name: string): Buffer {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const zippable: Zippable = {};
  for (const p of paths.sort()) zippable[p] = new Uint8Array(readFileSync(path.join(dir, p)));
  return Buffer.from(zipSync(zippable));
}

async function seedSkill(app: FastifyInstance, fixture: string) {
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fixture}.zip"\r\n` +
        "Content-Type: application/zip\r\n\r\n",
    ),
    fixtureZip(fixture),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: "/api/skills",
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string; currentVersionId: string };
}

function post(app: FastifyInstance, url: string, body: unknown) {
  return app.inject({ method: "POST", url, payload: body as Record<string, unknown> });
}

// ── (1) apply-preview ≡ persisted-path splice, byte-for-byte (single implementation) ──────────────

for (const fixture of FIXTURES) {
  test(`apply-preview ≡ persisted splice byte-for-byte — ${fixture}`, async () => {
    const { app } = await buildApp();
    const { skillMd, files, graph } = loadFixture(fixture);
    const ops = opsFor(graph);

    // What the persisted edits route computes for its SKILL.md before createVersion — the SAME shared
    // splice engine (`applyOpsToContent`). Also cross-checked against the raw `applyEditOps` to prove
    // the shared wrapper adds no divergence.
    const persistedSplice = applyOpsToContent(skillMd, files, ops).skillMd;
    assert.equal(
      persistedSplice,
      applyEditOps(skillMd, files, projectSkillGraph(skillMd, files), ops).skillMd,
      "applyOpsToContent must equal the raw project+applyEditOps composition",
    );

    // The apply-preview endpoint, sent the SAME content + ops + files.
    const res = await post(app, "/api/skillflow/apply-preview", { content: skillMd, ops, files });
    assert.equal(res.statusCode, 200, res.body);
    const preview = res.json() as { content: string; warnings: string[] };
    assert.equal(
      preview.content,
      persistedSplice,
      "apply-preview content ≡ persisted splice byte-for-byte",
    );

    // …and equal to what a REAL save actually writes: POST the edits route, then read the new SKILL.md.
    const skill = await seedSkill(app, fixture);
    const version = (
      await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}` })
    ).json();
    const editsRes = await post(
      app,
      `/api/skills/${skill.id}/versions/${skill.currentVersionId}/edits`,
      {
        baseTreeSha: version.treeSha,
        ops,
      },
    );
    assert.equal(editsRes.statusCode, 201, editsRes.body);
    const saved = editsRes.json();
    const savedFile = (
      await app.inject({
        url: `/api/skills/${skill.id}/versions/${saved.version.id}/file?path=SKILL.md`,
      })
    ).json() as { isBinary: boolean; text?: string };
    assert.equal(
      savedFile.text,
      preview.content,
      "the persisted save's SKILL.md ≡ apply-preview output",
    );
  });
}

// ── (2) project-preview ≡ persisted projection, for all fixtures ──────────────────────────────────

for (const fixture of FIXTURES) {
  test(`project-preview ≡ persisted projection — ${fixture}`, async () => {
    const { app } = await buildApp();
    const { skillMd, files } = loadFixture(fixture);
    const skill = await seedSkill(app, fixture);

    const previewRes = await post(app, "/api/skillflow/project-preview", {
      content: skillMd,
      files,
    });
    assert.equal(previewRes.statusCode, 200, previewRes.body);
    const preview = previewRes.json() as ProjectPreviewResponse;
    assert.equal(
      preview.projectorVersion,
      SKILLFLOW_PROJECTOR_VERSION,
      "stamped with the projector version",
    );

    const graphRes = await app.inject({
      url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}/graph`,
    });
    assert.equal(graphRes.statusCode, 200, graphRes.body);
    const persisted = graphRes.json() as { graph: SkillGraph; projectorVersion: number };

    assert.deepEqual(
      preview.graph,
      persisted.graph,
      "project-preview graph ≡ persisted graph route",
    );
    assert.deepEqual(
      preview.warnings,
      persisted.graph.warnings,
      "warnings mirror the projected graph's",
    );
  });
}

// ── (3) apply-preview refuses an unresolvable-anchor op with a 400-with-reason (no 409 target) ────

test("apply-preview: an op whose nodeId doesn't resolve against content → 400-with-reason", async () => {
  const { app } = await buildApp();
  const { skillMd, files } = loadFixture("multi-command");
  const res = await post(app, "/api/skillflow/apply-preview", {
    content: skillMd,
    files,
    ops: [{ op: "rename_node", nodeId: "no-such-node-id", label: "X" }],
  });
  assert.equal(res.statusCode, 400, res.body);
});

test("apply-preview: empty content projects an empty graph and applies no ops (total, never throws)", async () => {
  const { app } = await buildApp();
  const res = await post(app, "/api/skillflow/apply-preview", { content: "", ops: [] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as { content: string }).content, "");
});

// ── (4) save-draft: content-canonical, intent log → metadata, one version, diff matches ───────────

test("save-draft: draft content saves as ONE new version whose SKILL.md ≡ the draft + intent log in metadata", async () => {
  const { app, db } = await buildApp();
  const { skillMd, files } = loadFixture("multi-command");
  const skill = await seedSkill(app, "multi-command");
  const head = skill.currentVersionId;

  const graph = projectSkillGraph(skillMd, files);
  const ops = opsFor(graph);
  const draftContent = applyOpsToContent(skillMd, files, ops).skillMd;
  assert.notEqual(draftContent, skillMd, "the derived draft actually changed the document");

  const intentLog: SkillIntentLogEntry[] = ops.map((op) => ({
    op,
    summary: `staged ${op.op}`,
    at: "2026-07-05T00:00:00.000Z",
  }));

  const res = await post(app, `/api/skills/${skill.id}/save-draft`, {
    baseVersionId: head,
    content: draftContent,
    treeOps: [],
    intentLog,
    note: "live-draft save",
  });
  assert.equal(res.statusCode, 201, res.body);
  const saved = res.json();
  assert.equal(saved.version.seq, 2, "one new version (seq 2)");
  assert.equal(saved.version.note, "live-draft save");

  // The saved SKILL.md is byte-identical to the draft content.
  const savedFile = (
    await app.inject({
      url: `/api/skills/${skill.id}/versions/${saved.version.id}/file?path=SKILL.md`,
    })
  ).json() as { isBinary: boolean; text?: string };
  assert.equal(savedFile.text, draftContent, "saved SKILL.md ≡ the draft content");

  // The op intent log rode along into version metadata (`intent_log_json`).
  const row = db
    .prepare("SELECT intent_log_json FROM skill_versions WHERE id = ?")
    .get(saved.version.id) as { intent_log_json: string | null };
  assert.ok(row.intent_log_json, "intent_log_json persisted");
  assert.deepEqual(
    JSON.parse(row.intent_log_json as string),
    intentLog,
    "intent log preserved verbatim",
  );

  // The diff base → new is non-empty (the draft changed the tree).
  assert.ok(
    saved.diff.entries.some((e: { status: string }) => e.status !== "unchanged"),
    "diff reflects the draft",
  );

  // A seeded upload (v1) carries no intent log — the column is NULL for non-draft versions.
  const v1 = db.prepare("SELECT intent_log_json FROM skill_versions WHERE id = ?").get(head) as {
    intent_log_json: string | null;
  };
  assert.equal(v1.intent_log_json, null, "an uploaded version has a NULL intent log");
});

test("save-draft: a moved head → 409 (never a silent overwrite)", async () => {
  const { app } = await buildApp();
  const { skillMd, files } = loadFixture("multi-command");
  const skill = await seedSkill(app, "multi-command");
  const v1 = skill.currentVersionId;

  // Someone saves a new version first (head moves to v2).
  const graph = projectSkillGraph(skillMd, files);
  const first = applyOpsToContent(skillMd, files, [
    { op: "rename_node", nodeId: graph.nodes.filter(isSectionNode)[0]!.id, label: "First edit" },
  ]).skillMd;
  const firstSave = await post(app, `/api/skills/${skill.id}/save-draft`, {
    baseVersionId: v1,
    content: first,
    treeOps: [],
    intentLog: [],
  });
  assert.equal(firstSave.statusCode, 201, firstSave.body);

  // A second draft still forked from v1 (the OLD head) must 409 — the head moved to v2.
  const stale = await post(app, `/api/skills/${skill.id}/save-draft`, {
    baseVersionId: v1,
    content: `${skillMd}\n\nStale edit.\n`,
    treeOps: [],
    intentLog: [],
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.match(stale.json().error, /head moved/i);
});

test("save-draft: a byte-identical draft → { unchanged: true } (createVersion tree_sha dedupe)", async () => {
  const { app } = await buildApp();
  const { skillMd } = loadFixture("multi-command");
  const skill = await seedSkill(app, "multi-command");

  const res = await post(app, `/api/skills/${skill.id}/save-draft`, {
    baseVersionId: skill.currentVersionId,
    content: skillMd,
    treeOps: [],
    intentLog: [],
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().unchanged, true, "an unchanged draft creates no new version");
});
