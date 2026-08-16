import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SkillEditOp, SkillFileNode, SkillGraph } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { zipSync, type Zippable } from "fflate";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { applyEditOps, type AppliedEdit } from "../src/skillflow/roundtrip.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

// --- Fixture loading (same convention as skillflow-projector.test.ts) ----------------------------

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

function loadFixture(name: string): { skillMd: string; files: SkillFileNode[]; graph: SkillGraph } {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const files: SkillFileNode[] = paths.sort().map((p) => ({
    path: p,
    size: statSync(path.join(dir, p)).size,
    isBinary: false,
    isSkillMd: p === "SKILL.md",
    kind: classifyKind(p),
    tokenTotal: 0,
  }));
  const skillMd = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  return { skillMd, files, graph: projectSkillGraph(skillMd, files) };
}

// --- The mechanical byte-exactness proof ----------------------------------------------------------

/** Re-apply the returned splices to the original lines exactly as the engine does (bottom-up). */
function reapply(orig: string[], edits: AppliedEdit[]): string[] {
  const out = [...orig];
  const ordered = [...edits].sort(
    (a, b) => b.startLine - a.startLine || b.deletedLines - a.deletedLines,
  );
  for (const edit of ordered)
    out.splice(edit.startLine - 1, edit.deletedLines, ...edit.insertedLines);
  return out;
}

/**
 * Walk the original and result line arrays in parallel through the applied edits: every line
 * OUTSIDE the edit spans must be identical (compared as exact strings — trailing whitespace, blank
 * runs, and CRs included), and the lines inside each span must be exactly the edit's insertion.
 */
function assertUntouchedLinesIdentical(
  orig: string[],
  result: string[],
  edits: AppliedEdit[],
): void {
  const ordered = [...edits].sort(
    (a, b) => a.startLine - b.startLine || a.deletedLines - b.deletedLines,
  );
  let oi = 0;
  let ri = 0;
  for (const edit of ordered) {
    const start = edit.startLine - 1;
    const copyLen = start - oi;
    assert.deepEqual(
      result.slice(ri, ri + copyLen),
      orig.slice(oi, start),
      `lines ${oi + 1}–${start} (before the edit at line ${edit.startLine}) must be byte-identical`,
    );
    ri += copyLen;
    assert.deepEqual(
      result.slice(ri, ri + edit.insertedLines.length),
      edit.insertedLines,
      `the replacement at line ${edit.startLine} must be exactly the edit's insertion`,
    );
    ri += edit.insertedLines.length;
    oi = start + edit.deletedLines;
  }
  assert.deepEqual(
    result.slice(ri),
    orig.slice(oi),
    "lines after the last edit must be byte-identical",
  );
}

/** Every DELETED line range must fall inside one of the allowed anchor spans (1-based inclusive). */
function assertDeletionsWithinSpans(edits: AppliedEdit[], spans: Array<[number, number]>): void {
  for (const edit of edits) {
    if (edit.deletedLines === 0) continue; // pure insertion — its position is proven by the walk
    const endLine = edit.startLine + edit.deletedLines - 1;
    assert.ok(
      spans.some(([s, e]) => edit.startLine >= s && endLine <= e),
      `deleted range ${edit.startLine}–${endLine} lies outside every targeted anchor (${JSON.stringify(spans)})`,
    );
  }
}

function anchorSpan(graph: SkillGraph, nodeId: string): [number, number] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  assert.ok(node, `fixture graph has node "${nodeId}"`);
  return [node.anchor.startLine, node.anchor.endLine];
}

/** Apply ops and run the full mechanical proof; returns the result for intent assertions. */
function applyAndProve(
  fixture: { skillMd: string; files: SkillFileNode[]; graph: SkillGraph },
  ops: SkillEditOp[],
  allowedDeletionSpans: Array<[number, number]>,
) {
  const result = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, ops);
  const orig = fixture.skillMd.split("\n");
  const out = result.skillMd.split("\n");
  // (1) re-applying the returned splices to the original reproduces the result EXACTLY — proves
  //     the engine performed only these splices (no re-serialization anywhere else).
  assert.equal(
    reapply(orig, result.edits).join("\n"),
    result.skillMd,
    "splices reproduce the result",
  );
  // (2) parallel walk: every byte outside the edit spans is identical.
  assertUntouchedLinesIdentical(orig, out, result.edits);
  // (3) every deleted range lies inside a targeted node/edge anchor.
  assertDeletionsWithinSpans(result.edits, allowedDeletionSpans);
  return result;
}

// --- (E) The round-trip property, per fixture -----------------------------------------------------

test("zero-annotation: representative ops round-trip with byte-exact untouched prose", () => {
  const fixture = loadFixture("zero-annotation");
  const ops: SkillEditOp[] = [
    { op: "rename_node", nodeId: "generate-the-report", label: "Generate the summary report" },
    {
      op: "update_section_body",
      nodeId: "validate-the-data",
      body: "Run `scripts/validate.py` against the input file and check it exits 0 before continuing.",
    },
    {
      op: "add_subroutine",
      afterNodeId: "verify-the-output",
      title: "Ship it",
      body: "Hand the final report back to the user.",
    },
    { op: "set_annotation", nodeId: "gather-inputs", kind: "gatekeeper", id: "route-inputs" },
  ];
  const result = applyAndProve(fixture, ops, [
    anchorSpan(fixture.graph, "generate-the-report"),
    anchorSpan(fixture.graph, "validate-the-data"),
  ]);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);

  // (b) re-projecting the result reflects the edits.
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    reprojected.nodes.some((n) => n.label === "Generate the summary report"),
    "renamed label",
  );
  const added = reprojected.nodes.find((n) => n.id === "ship-it");
  assert.equal(added?.kind, "subroutine", "new subroutine node projected");
  const annotated = reprojected.nodes.find((n) => n.id === "route-inputs");
  assert.equal(annotated?.kind, "gatekeeper", "annotation id + kind honored");
  assert.equal(annotated?.source, "annotated");
  assert.ok(result.skillMd.includes("<!-- skillflow:gatekeeper id=route-inputs -->"));
});

test("github-style: representative ops round-trip with byte-exact untouched prose", () => {
  const fixture = loadFixture("github-style");
  const ops: SkillEditOp[] = [
    { op: "rename_node", nodeId: "summarize", label: "Summarize issues" },
    { op: "update_section_body", nodeId: "publish", body: "Reply with a single markdown block." },
    { op: "add_subroutine", afterNodeId: "publish", title: "Archive", body: "Store the digest." },
    { op: "set_annotation", nodeId: "fetch-issues", kind: "gatekeeper", id: "fetch-route" },
  ];
  const result = applyAndProve(fixture, ops, [
    anchorSpan(fixture.graph, "summarize"),
    anchorSpan(fixture.graph, "publish"),
  ]);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    reprojected.nodes.some((n) => n.label === "Summarize issues"),
    "renamed label",
  );
  const added = reprojected.nodes.find((n) => n.id === "archive");
  assert.equal(added?.kind, "subroutine", "new subroutine node projected");
  const annotated = reprojected.nodes.find((n) => n.id === "fetch-route");
  assert.equal(annotated?.kind, "gatekeeper", "annotation id + kind honored");
  // The untouched nested subsection survives with its heading path intact.
  const nested = reprojected.nodes.find((n) => n.label === "Handling rate limits");
  assert.ok(nested, "nested subsection untouched");
});

test("annotated: composing ops + set_edge_condition on an anchored gatekeeper edge", () => {
  const fixture = loadFixture("annotated");
  const csvEdge = fixture.graph.edges.find((e) => e.condition === "the input is CSV");
  assert.ok(csvEdge?.anchor, "fixture projects an anchored, condition-labelled gatekeeper edge");

  const ops: SkillEditOp[] = [
    // Three DISTINCT op types composing on the same section node ("Run the check").
    { op: "rename_node", nodeId: "run-the-check", label: "Run the validation" },
    {
      op: "update_section_body",
      nodeId: "run-the-check",
      body: "Run `scripts/validate.py` and require exit code 0.",
    },
    { op: "set_annotation", nodeId: "run-the-check", kind: "gate", id: "run-check-gate" },
    {
      op: "add_subroutine",
      afterNodeId: "check-output",
      title: "Report",
      body: "Summarize the outcome.",
    },
    { op: "set_edge_condition", edgeId: csvEdge.id, condition: "the input is TSV" },
  ];
  const spans: Array<[number, number]> = [
    anchorSpan(fixture.graph, "run-the-check"),
    [csvEdge.anchor.startLine, csvEdge.anchor.endLine],
  ];
  const result = applyAndProve(fixture, ops, spans);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  const gate = reprojected.nodes.find((n) => n.id === "run-check-gate");
  assert.equal(gate?.kind, "validation_gate", "gate annotation id honored on the renamed section");
  assert.equal(gate?.label, "Run the validation", "rename + annotation composed");
  assert.equal(gate?.source, "annotated");
  assert.ok(
    reprojected.edges.some((e) => e.condition === "the input is TSV"),
    "edge condition rewritten",
  );
  assert.ok(!result.skillMd.includes("the input is CSV"), "old condition text gone");
  const added = reprojected.nodes.find((n) => n.id === "report");
  assert.equal(added?.kind, "subroutine", "new subroutine node projected");
  // The pre-existing check-output annotation is untouched.
  assert.ok(result.skillMd.includes("<!-- skillflow:gate id=check-output -->"));
});

test("blank-scaffold: representative ops round-trip on the minimal scaffold", () => {
  const fixture = loadFixture("blank-scaffold");
  const ops: SkillEditOp[] = [
    { op: "rename_node", nodeId: "steps", label: "Plan" },
    {
      op: "update_section_body",
      nodeId: "steps",
      body: "Sketch the approach before writing anything.",
    },
    {
      op: "add_subroutine",
      afterNodeId: "steps",
      title: "Review",
      body: "Re-read the skill top to bottom.",
    },
    { op: "set_annotation", nodeId: "steps", kind: "gatekeeper", id: "steps-route" },
  ];
  const result = applyAndProve(fixture, ops, [anchorSpan(fixture.graph, "steps")]);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  const annotated = reprojected.nodes.find((n) => n.id === "steps-route");
  assert.equal(annotated?.kind, "gatekeeper", "annotation id + kind honored");
  assert.equal(annotated?.label, "Plan", "renamed label");
  const added = reprojected.nodes.find((n) => n.id === "review");
  assert.equal(added?.kind, "subroutine", "new subroutine node projected");
  assert.ok(
    result.skillMd.includes("Sketch the approach before writing anything."),
    "new body present",
  );
});

test("zero ops → the exact same string (===) on every fixture", () => {
  for (const name of ["zero-annotation", "github-style", "annotated", "blank-scaffold"]) {
    const fixture = loadFixture(name);
    const result = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, []);
    assert.equal(result.skillMd === fixture.skillMd, true, `${name}: identical string`);
    assert.deepEqual(result.edits, []);
    assert.deepEqual(result.warnings, []);
  }
});

test("removing an accessory node degrades to a warning + skip (never a text guess)", () => {
  const fixture = loadFixture("zero-annotation");
  const asset = fixture.graph.nodes.find((n) => n.kind === "asset");
  assert.ok(asset);
  const result = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, [
    { op: "remove_node", nodeId: asset.id },
  ]);
  assert.equal(result.skillMd === fixture.skillMd, true, "document untouched");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /accessory/);
});

// --- Route tests (POST /api/skills/:id/versions/:vid/edits) --------------------------------------

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function buildApp(): Promise<{ app: FastifyInstance; repo: SkillRepository }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const dataDir = path.join(
    os.tmpdir(),
    `skillflow-roundtrip-test-${Math.random().toString(36).slice(2)}`,
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
  return { app, repo };
}

const BOUNDARY = "----skillflowRoundtripBoundary";

function fixtureZip(name: string): Buffer {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const zippable: Zippable = {};
  for (const p of paths.sort()) {
    zippable[p] = new Uint8Array(readFileSync(path.join(dir, p)));
  }
  return Buffer.from(zipSync(zippable));
}

/** Seed a skill through the real upload ingest path (like skills-upload.test.ts does). */
async function seedSkill(app: FastifyInstance, fixture: string) {
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fixture}.zip"\r\n` +
        `Content-Type: application/zip\r\n\r\n`,
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

function postEdits(app: FastifyInstance, skillId: string, versionId: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${versionId}/edits`,
    payload: body as Record<string, unknown>,
  });
}

test("route happy path: edits → a real new immutable version 2 + diff, other files byte-identical", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;
  const v1 = (await app.inject({ url: `/api/skills/${skill.id}/versions/${vid}` })).json();

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: v1.treeSha,
    ops: [
      { op: "rename_node", nodeId: "generate-the-report", label: "Generate the summary report" },
      {
        op: "add_subroutine",
        afterNodeId: "verify-the-output",
        title: "Ship it",
        body: "Hand the final report back to the user.",
      },
    ],
    note: "rename + new step",
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.version.seq, 2, "a real version 2 exists");
  assert.equal(body.version.skillId, skill.id);
  assert.equal(body.version.importedFrom, "upload");
  assert.equal(body.version.sourceRef, "skillflow-edit");
  assert.equal(body.version.note, "rename + new step");
  assert.equal(body.version.manifestValid, true, "manifest stays valid after the edit");
  assert.deepEqual(body.warnings, []);

  // The response diff (WP 1.5 engine) names SKILL.md as modified — and nothing else changed.
  const skillMdEntry = body.diff.entries.find((e: { path: string }) => e.path === "SKILL.md");
  assert.equal(skillMdEntry?.status, "modified");
  const otherChanged = body.diff.entries.filter(
    (e: { path: string; status: string }) => e.path !== "SKILL.md" && e.status !== "unchanged",
  );
  assert.deepEqual(otherChanged, [], "no other file changed");

  // The new version's SKILL.md contains the edit.
  const v2md = repo.getFileContent(body.version.id, "SKILL.md");
  assert.ok(!v2md.isBinary && v2md.text.includes("## Generate the summary report"));
  assert.ok(!v2md.isBinary && v2md.text.includes("## Ship it"));

  // Every OTHER file is carried over byte-identical (same content-addressed blob sha).
  const fromMap = repo.getDiffFileMap(vid);
  const toMap = repo.getDiffFileMap(body.version.id);
  assert.equal(toMap.size, fromMap.size, "same file count");
  for (const [p, file] of fromMap) {
    if (p === "SKILL.md") continue;
    assert.equal(toMap.get(p)?.blobSha, file.blobSha, `${p} blob sha unchanged`);
  }
  assert.notEqual(toMap.get("SKILL.md")?.blobSha, fromMap.get("SKILL.md")?.blobSha);

  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 2);
});

test("stale baseTreeSha → 409 (anchors no longer valid)", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "blank-scaffold");
  const res = await postEdits(app, skill.id, skill.currentVersionId, {
    baseTreeSha: "0".repeat(64),
    ops: [{ op: "rename_node", nodeId: "steps", label: "Plan" }],
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /stale anchors/i);
});

test("conflicting op pair on one node → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;
  const v1 = (await app.inject({ url: `/api/skills/${skill.id}/versions/${vid}` })).json();
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: v1.treeSha,
    ops: [
      { op: "remove_node", nodeId: "gather-inputs" },
      { op: "update_section_body", nodeId: "gather-inputs", body: "New body." },
    ],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /conflicting ops/i);
});

test("unknown nodeId → 400 listing the valid node ids", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "blank-scaffold");
  const vid = skill.currentVersionId;
  const v1 = (await app.inject({ url: `/api/skills/${skill.id}/versions/${vid}` })).json();
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: v1.treeSha,
    ops: [{ op: "rename_node", nodeId: "no-such-node", label: "X" }],
  });
  assert.equal(res.statusCode, 400);
  const error = res.json().error as string;
  assert.match(error, /unknown nodeId "no-such-node"/);
  assert.match(error, /valid node ids: .*steps/);
});

test("empty op list → { unchanged: true } and NO new version row", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "github-style");
  const vid = skill.currentVersionId;
  const v1 = (await app.inject({ url: `/api/skills/${skill.id}/versions/${vid}` })).json();
  const res = await postEdits(app, skill.id, vid, { baseTreeSha: v1.treeSha, ops: [] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { unchanged: true, warnings: [] });

  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1, "no version spam");
});

test("edits route 404s on an unknown skill/version pairing", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "blank-scaffold");
  const other = await seedSkill(app, "github-style");
  // A real version id, but of ANOTHER skill → 404 (same guard as the graph route).
  const res = await postEdits(app, skill.id, other.currentVersionId, {
    baseTreeSha: "0".repeat(64),
    ops: [],
  });
  assert.equal(res.statusCode, 404);
});
