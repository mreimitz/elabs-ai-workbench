import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SKILLFLOW_PROJECTOR_VERSION,
  type SkillFileNode,
  skillGraphResponseSchema,
  skillGraphSchema,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { SkillRepository } from "../src/skills/repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

// --- Fixture loading ----------------------------------------------------------------------------

/** Classify a file path the way `SkillRepository` does (so fixture inputs match the real store). */
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

function loadFixture(name: string): { skillMd: string; files: SkillFileNode[]; raw: string[] } {
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
  return { skillMd, files, raw: skillMd.split(/\r?\n/) };
}

const countKind = (graph: ReturnType<typeof projectSkillGraph>, kind: string) =>
  graph.nodes.filter((node) => node.kind === kind).length;

// --- (a) zero-annotation fixture: rich graph from inference alone (D2) ---------------------------

test("zero-annotation fixture projects a rich graph from inference alone", () => {
  const { skillMd, files } = loadFixture("zero-annotation");
  const graph = projectSkillGraph(skillMd, files);

  assert.ok(countKind(graph, "subroutine") >= 4, "at least 4 subroutine nodes");
  assert.ok(countKind(graph, "asset") >= 2, "at least 2 asset nodes");
  assert.ok(countKind(graph, "validation_gate") >= 1, "at least 1 validation gate");
  assert.equal(countKind(graph, "gatekeeper"), 1, "the CSV/JSON branching section is a gatekeeper");

  // The gatekeeper is the "Gather inputs" (CSV/JSON) section.
  const gatekeeper = graph.nodes.find((node) => node.kind === "gatekeeper");
  assert.ok(gatekeeper && gatekeeper.anchor.headingPath.includes("Gather inputs"));

  // The loop guard comes from "repeat until … at most 3 times".
  const loop = graph.nodes.find((node) => node.kind === "loop_guard");
  assert.ok(loop, "a loop guard is present");
  assert.equal(loop?.kind === "loop_guard" ? loop.maxIterations : undefined, 3);

  // The validation gate names the script + carries an expectation sentence.
  const gate = graph.nodes.find((node) => node.kind === "validation_gate");
  assert.ok(gate?.kind === "validation_gate" && gate.script === "scripts/validate.py");
  assert.ok(gate?.kind === "validation_gate" && gate.expectation.length > 0);

  // Asset nodes reference the two bundled files, reusing their file kind.
  const assetPaths = graph.nodes
    .filter((n) => n.kind === "asset")
    .map((n) => (n.kind === "asset" ? n.path : ""));
  assert.ok(assetPaths.includes("assets/template.html"));
  assert.ok(assetPaths.includes("reference/format-spec.md"));

  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

// --- (b) github-style fixture: sections incl. a nested ### subsection ----------------------------

test("github-style fixture projects sections including a depth-2 ### subsection", () => {
  const { skillMd, files } = loadFixture("github-style");
  const graph = projectSkillGraph(skillMd, files);

  // The nested "### Handling rate limits" becomes its own node with a depth-2 heading path.
  const nested = graph.nodes.find((node) => node.anchor.headingPath.length === 2);
  assert.ok(nested, "a nested subsection node exists");
  assert.deepEqual(nested?.anchor.headingPath, ["Fetch issues", "Handling rate limits"]);

  // The script + exit-code language yields a validation gate; the reference file an asset.
  assert.ok(countKind(graph, "validation_gate") >= 1);
  const gate = graph.nodes.find((node) => node.kind === "validation_gate");
  assert.ok(gate?.kind === "validation_gate" && gate.script === "scripts/fetch.sh");
  const asset = graph.nodes.find((node) => node.kind === "asset");
  assert.ok(asset?.kind === "asset" && asset.path === "reference/api-notes.md");

  // Top-level sections are present (GitHub Style, Fetch issues, Summarize, Publish).
  const labels = graph.nodes.map((node) => node.label);
  for (const label of ["GitHub Style", "Fetch issues", "Summarize", "Publish"]) {
    assert.ok(labels.includes(label), `has a node for "${label}"`);
  }

  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

// --- (c) annotated fixture: annotations override kind + id, source 'annotated' -------------------

test("annotated fixture honors gatekeeper/gate annotations (stable ids, source 'annotated')", () => {
  const { skillMd, files } = loadFixture("annotated");
  const graph = projectSkillGraph(skillMd, files);

  const gatekeeper = graph.nodes.find((node) => node.id === "route-input");
  assert.ok(gatekeeper, "gatekeeper node has the annotated id 'route-input'");
  assert.equal(gatekeeper?.kind, "gatekeeper");
  assert.equal(gatekeeper?.source, "annotated");

  const gate = graph.nodes.find((node) => node.id === "check-output");
  assert.ok(gate, "validation gate has the annotated id 'check-output'");
  assert.equal(gate?.kind, "validation_gate");
  assert.equal(gate?.source, "annotated");
  // The gate resolves its script from the check it refers to ("the check above").
  assert.ok(gate?.kind === "validation_gate" && gate.script === "scripts/validate.py");

  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

// --- (d) blank scaffold: a minimal graph (one node for the "Steps" section) ----------------------

test("blank-scaffold fixture projects a minimal graph (the Steps section) with no warnings", () => {
  const { skillMd, files } = loadFixture("blank-scaffold");
  const graph = projectSkillGraph(skillMd, files);

  assert.ok(graph.nodes.length >= 1, "at least one node");
  assert.equal(graph.nodes[0]?.label, "Steps");
  assert.equal(graph.nodes[0]?.kind, "subroutine");
  assert.deepEqual(graph.warnings, []);
  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

// --- (e) determinism: same input → deep-equal output --------------------------------------------

test("projection is deterministic (same input → deep-equal graph)", () => {
  for (const name of ["zero-annotation", "github-style", "annotated", "blank-scaffold"]) {
    const { skillMd, files } = loadFixture(name);
    assert.deepEqual(projectSkillGraph(skillMd, files), projectSkillGraph(skillMd, files), name);
  }
});

// --- (f) anchor correctness ---------------------------------------------------------------------

test("every node is anchored: startLine ≤ endLine, non-empty heading path, line contains the heading", () => {
  for (const name of ["zero-annotation", "github-style", "annotated", "blank-scaffold"]) {
    const { skillMd, files, raw } = loadFixture(name);
    const graph = projectSkillGraph(skillMd, files);
    for (const node of graph.nodes) {
      assert.ok(
        node.anchor.startLine <= node.anchor.endLine,
        `${name} ${node.id}: startLine ≤ endLine`,
      );
      assert.ok(node.anchor.headingPath.length > 0, `${name} ${node.id}: non-empty heading path`);
      const headingText = node.anchor.headingPath[node.anchor.headingPath.length - 1] ?? "";
      const rawLine = raw[node.anchor.startLine - 1] ?? "";
      assert.ok(
        rawLine.includes(headingText),
        `${name} ${node.id}: line ${node.anchor.startLine} ("${rawLine}") contains "${headingText}"`,
      );
    }
  }
});

// --- (g) garbage input → empty graph + warnings, never throws ------------------------------------

test("garbage / degenerate input degrades to an empty graph plus warnings (never throws)", () => {
  const junkInputs = [
    "",
    "   \n\t\n  ",
    "  not markdown at all just bytes",
    "just a paragraph of prose with no headings whatsoever",
    "---\nname: only-frontmatter\ndescription: nothing else\n---\n",
  ];
  for (const input of junkInputs) {
    const graph = projectSkillGraph(input, []);
    assert.deepEqual(graph.nodes, [], `no nodes for ${JSON.stringify(input.slice(0, 20))}`);
    assert.deepEqual(graph.edges, []);
    assert.ok(graph.warnings.length > 0, "at least one warning");
    assert.doesNotThrow(() => skillGraphSchema.parse(graph));
  }
});

// --- Route tests (fastify inject + in-memory DB) -------------------------------------------------

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function seedVersion(
  repo: SkillRepository,
  fixtureName: string,
): { skillId: string; versionId: string } {
  const dir = path.join(skillsDir, fixtureName);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const skill = repo.create({ name: fixtureName, sourceType: "upload" });
  const result = repo.createVersion(
    skill.id,
    paths.sort().map((p) => ({ path: p, bytes: readFileSync(path.join(dir, p)) })),
    { sourceKind: "upload", importedFrom: "upload" },
  );
  return { skillId: skill.id, versionId: result.version.id };
}

async function buildApp(): Promise<{ app: FastifyInstance; repo: SkillRepository }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillflowRoutes(app, repo);
  await app.ready();
  apps.push(app);
  return { app, repo };
}

test("GET graph → 200 with a schema-valid graph + projector version stamp", async () => {
  const { app, repo } = await buildApp();
  const { skillId, versionId } = seedVersion(repo, "zero-annotation");

  const res = await app.inject({ url: `/api/skills/${skillId}/versions/${versionId}/graph` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const parsed = skillGraphResponseSchema.parse(body);
  assert.equal(parsed.projectorVersion, SKILLFLOW_PROJECTOR_VERSION);
  assert.ok(parsed.graph.nodes.length > 0, "non-empty graph over a real version");
});

test("GET graph → 404 for an unknown skill or version", async () => {
  const { app, repo } = await buildApp();
  const { skillId, versionId } = seedVersion(repo, "zero-annotation");

  const badSkill = await app.inject({ url: `/api/skills/nope/versions/${versionId}/graph` });
  assert.equal(badSkill.statusCode, 404);

  const badVersion = await app.inject({ url: `/api/skills/${skillId}/versions/nope/graph` });
  assert.equal(badVersion.statusCode, 404);
});

test("GET graph → 200 empty-graph-plus-warnings when the version has no SKILL.md (not a 500)", async () => {
  const { app, repo } = await buildApp();
  // A version with only a reference file — no SKILL.md blob to project.
  const skill = repo.create({ name: "no-skill-md", sourceType: "upload" });
  const result = repo.createVersion(
    skill.id,
    [{ path: "reference/notes.md", bytes: Buffer.from("just a note") }],
    { sourceKind: "upload", importedFrom: "upload" },
  );

  const res = await app.inject({
    url: `/api/skills/${skill.id}/versions/${result.version.id}/graph`,
  });
  assert.equal(res.statusCode, 200);
  const parsed = skillGraphResponseSchema.parse(res.json());
  assert.deepEqual(parsed.graph.nodes, []);
  assert.ok(parsed.graph.warnings.length > 0);
});
