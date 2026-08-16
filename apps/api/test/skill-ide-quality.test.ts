import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  QUALITY_ENGINE_VERSION,
  QUALITY_SEVERITY_WEIGHTS,
  qualityReportSchema,
  type QualityFinding,
  type QualityReport,
  type SkillFileNode,
  type SkillGraph,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { validateEditOps } from "../src/skillflow/edit-ops.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import {
  analyzeSkillQuality,
  computeQualityScore,
  qualityGuideAnchor,
  QUALITY_RULE_IDS,
  type SkillQualityInput,
} from "../src/skillflow/quality.js";
import { countLevels, type SkillFootprintFile } from "../src/skills/footprint.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 4.1 (I4) — the deterministic, versioned, scored quality engine. Pure over
// (manifest, files, graph, footprint); emits + shape-validates `fix` ops but NEVER applies/executes.
// Fixture matrix: a deliberately-messy skill scores low with the expected findings; the clean
// zero-annotation fixture scores high; every `fix` batch passes validateEditOps; determinism; the
// Rule↔guide contract (every emitted ruleId has a docs/skill-authoring.md heading anchor).

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");
const guidePath = path.join(here, "..", "..", "..", "docs", "skill-authoring.md");

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

type Fixture = {
  skillMd: string;
  files: SkillFileNode[];
  footprintFiles: SkillFootprintFile[];
  graph: SkillGraph;
};

function loadFixture(name: string): Fixture {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  paths.sort();
  const files: SkillFileNode[] = paths.map((p) => ({
    path: p,
    size: statSync(path.join(dir, p)).size,
    isBinary: false,
    isSkillMd: p === "SKILL.md",
    kind: classifyKind(p),
    tokenTotal: 0,
  }));
  const footprintFiles: SkillFootprintFile[] = paths.map((p) => ({
    path: p,
    isBinary: false,
    text: readFileSync(path.join(dir, p), "utf8"),
  }));
  const skillMd = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  return { skillMd, files, footprintFiles, graph: projectSkillGraph(skillMd, files) };
}

/** Run the engine over a fixture with the real (or overridden) ceilings, computing L1/L2 for real. */
async function analyzeFixture(
  name: string,
  ceilings: { l1?: number; l2?: number } = {},
): Promise<QualityReport> {
  const fixture = loadFixture(name);
  const parsed = parseSkillManifest(fixture.skillMd);
  const levels = await countLevels(fixture.footprintFiles, parsed.manifest, parsed.body);
  return analyzeSkillQuality({
    skillMd: fixture.skillMd,
    manifest: parsed.manifest,
    files: fixture.files,
    graph: fixture.graph,
    footprint: { l1: levels.l1, l2: levels.l2 },
    l1Ceiling: ceilings.l1 ?? 500,
    l2Ceiling: ceilings.l2 ?? 5000,
  });
}

/** Build an engine input from an inline SKILL.md + manifest, for rules with no fixture. */
function inlineInput(
  skillMd: string,
  description: string,
  footprint: { l1: number; l2: number },
  ceilings: { l1?: number; l2?: number } = {},
): SkillQualityInput {
  const graph = projectSkillGraph(skillMd, []);
  return {
    skillMd,
    manifest: { name: "t", description },
    files: [],
    graph,
    footprint,
    l1Ceiling: ceilings.l1 ?? 500,
    l2Ceiling: ceilings.l2 ?? 5000,
  };
}

function ruleIds(report: QualityReport): string[] {
  return report.findings.map((f) => f.ruleId);
}

/** Every `fix` batch a report emits must validate against the SAME graph (the WP acceptance). */
function assertFixesValidate(graph: SkillGraph, report: QualityReport): void {
  for (const finding of report.findings) {
    if (!finding.fix) continue;
    assert.ok(
      finding.fix.length > 0,
      `${finding.ruleId}: an attached fix must be a non-empty batch`,
    );
    assert.deepEqual(
      validateEditOps(graph, finding.fix),
      [],
      `${finding.ruleId}: its fix ops must pass validateEditOps against the graph`,
    );
  }
}

// --- Fixture matrix -------------------------------------------------------------------------------

test("messy fixture scores low and emits the expected findings; every fix validates", async () => {
  const fixture = loadFixture("messy-quality");
  const report = await analyzeFixture("messy-quality");

  // A clearly-low score (well under the clean fixtures' 90s), schema-valid + version-stamped.
  assert.equal(qualityReportSchema.safeParse(report).success, true);
  assert.equal(report.qualityEngineVersion, QUALITY_ENGINE_VERSION);
  assert.ok(report.score <= 60, `messy score should be low, got ${report.score}`);

  // The expected rule set the deliberately-messy skill trips.
  const expected = [
    "manifest-incomplete", // weak description "A helper." (<20 chars) → warning
    "trigger-hygiene", // no keywords + generic description → info
    "broken-ref", // skillflow:gate on a section naming no resolvable script → error
    "unused-asset", // assets/orphan.txt referenced by no section → info
    "script-undocumented", // scripts/cleanup.sh referenced with no verify language → warning
    "gatekeeper-no-breadcrumb", // "Choose a path" gatekeeper has no marker → warning
    "command-collision-internal", // two `## /report …` entry points → error
  ].sort();
  assert.deepEqual([...new Set(ruleIds(report))].sort(), expected);

  // Two errors (broken-ref, command-collision) drive the low score.
  const errors = report.findings
    .filter((f) => f.severity === "error")
    .map((f) => f.ruleId)
    .sort();
  assert.deepEqual(errors, ["broken-ref", "command-collision-internal"]);

  // The score equals the documented formula over its own findings (single source of truth).
  assert.equal(report.score, computeQualityScore(report.findings));

  // Both drafted fixes (script-undocumented, gatekeeper-no-breadcrumb) validate against the graph.
  assertFixesValidate(fixture.graph, report);
  assert.ok(
    report.findings.some((f) => f.ruleId === "script-undocumented" && f.fix?.length === 1),
    "script-undocumented drafts an append-expectation fix",
  );
  assert.ok(
    report.findings.some((f) => f.ruleId === "gatekeeper-no-breadcrumb" && f.fix?.length === 2),
    "gatekeeper-no-breadcrumb reuses the SkillFlow missing-breadcrumbs ops (pin + body append)",
  );
});

test("the clean zero-annotation fixture scores high", async () => {
  const fixture = loadFixture("zero-annotation");
  const report = await analyzeFixture("zero-annotation");

  assert.ok(report.score >= 90, `clean fixture should score high, got ${report.score}`);
  // A routing / cross-flow projector warning is NOT a broken reference — the clean fixture has no
  // broken-ref/error findings; its single warning is the honest missing-breadcrumb on its gatekeeper.
  assert.equal(report.findings.filter((f) => f.severity === "error").length, 0);
  assert.deepEqual([...new Set(ruleIds(report))], ["gatekeeper-no-breadcrumb"]);
  assertFixesValidate(fixture.graph, report);
});

test("the other clean fixtures do not error; every fix across the matrix validates", async () => {
  for (const name of ["github-style", "multi-command", "annotated", "blank-scaffold"]) {
    const fixture = loadFixture(name);
    const report = await analyzeFixture(name);
    assert.equal(
      qualityReportSchema.safeParse(report).success,
      true,
      `${name} report is schema-valid`,
    );
    assert.equal(
      report.findings.filter((f) => f.severity === "error").length,
      0,
      `${name} (a well-formed fixture) has no error-severity findings`,
    );
    assertFixesValidate(fixture.graph, report);
  }
});

// --- Individual rules with no fixture (targeted inline inputs) -------------------------------------

test("l1-budget / l2-budget fire only when the level exceeds its ceiling", () => {
  const skillMd =
    "---\nname: t\ndescription: A specific description that is comfortably long enough.\n---\n\n# Title\n\nBody.\n";
  const desc = "A specific description that is comfortably long enough.";

  const over = analyzeSkillQuality(inlineInput(skillMd, desc, { l1: 640, l2: 9000 }));
  assert.deepEqual(
    ruleIds(over)
      .filter((r) => r.endsWith("-budget"))
      .sort(),
    ["l1-budget", "l2-budget"],
  );
  for (const f of over.findings.filter((r) => r.ruleId.endsWith("-budget"))) {
    assert.equal(f.severity, "warning");
    assert.equal(f.fix, undefined, "budget findings have no fix");
  }

  const under = analyzeSkillQuality(inlineInput(skillMd, desc, { l1: 100, l2: 100 }));
  assert.equal(
    ruleIds(under).some((r) => r.endsWith("-budget")),
    false,
  );

  // The env-style ceiling overrides are honored: a tiny ceiling flags an otherwise-fine level.
  const tight = analyzeSkillQuality(
    inlineInput(skillMd, desc, { l1: 100, l2: 100 }, { l1: 1, l2: 1 }),
  );
  assert.deepEqual(
    ruleIds(tight)
      .filter((r) => r.endsWith("-budget"))
      .sort(),
    ["l1-budget", "l2-budget"],
  );
});

test("manifest-incomplete: missing description is an error, a weak (<20 char) one is a warning", () => {
  const missing = analyzeSkillQuality(inlineInput("# X\n\ntext\n", "", { l1: 2, l2: 2 }));
  const missingFinding = missing.findings.find((f) => f.ruleId === "manifest-incomplete");
  assert.equal(missingFinding?.severity, "error");

  const weak = analyzeSkillQuality(inlineInput("# X\n\ntext\n", "too short", { l1: 5, l2: 5 }));
  const weakFinding = weak.findings.find((f) => f.ruleId === "manifest-incomplete");
  assert.equal(weakFinding?.severity, "warning");

  const good = analyzeSkillQuality(
    inlineInput("# X\n\ntext\n", "A properly specific description, well over twenty characters.", {
      l1: 5,
      l2: 5,
    }),
  );
  assert.equal(
    good.findings.some((f) => f.ruleId === "manifest-incomplete"),
    false,
  );
});

test("orphan-section: a section unreachable from any root is flagged (warning)", () => {
  // Two sibling H3s with no H1/H2 ancestor: Alpha is the main-flow head (a root); Beta has no
  // incoming edge and is not a root → orphan.
  const md =
    "---\nname: t\ndescription: A specific description that is comfortably long enough.\n---\n\n### Alpha\n\nAlpha text.\n\n### Beta\n\nBeta text.\n";
  const report = analyzeSkillQuality(
    inlineInput(md, "A specific description that is comfortably long enough.", { l1: 10, l2: 10 }),
  );
  const orphans = report.findings.filter((f) => f.ruleId === "orphan-section");
  assert.equal(orphans.length, 1, `exactly Beta is orphaned: ${JSON.stringify(ruleIds(report))}`);
  assert.equal(orphans[0]?.severity, "warning");
  assert.match(orphans[0]?.message ?? "", /Beta/);
});

// --- Score formula + determinism ------------------------------------------------------------------

test("computeQualityScore is the documented formula over the shared weights, clamped to 0–100", () => {
  assert.equal(computeQualityScore([]), 100);
  assert.equal(
    computeQualityScore([
      { ruleId: "a", severity: "error", message: "" },
      { ruleId: "b", severity: "warning", message: "" },
      { ruleId: "c", severity: "info", message: "" },
    ]),
    100 -
      QUALITY_SEVERITY_WEIGHTS.error -
      QUALITY_SEVERITY_WEIGHTS.warning -
      QUALITY_SEVERITY_WEIGHTS.info,
  );
  // Floored at 0 — a pile of errors can't drive the score negative.
  const manyErrors: QualityFinding[] = Array.from({ length: 20 }, (_, i) => ({
    ruleId: `e${i}`,
    severity: "error",
    message: "",
  }));
  assert.equal(computeQualityScore(manyErrors), 0);
});

test("determinism: the same input yields a deep-equal report", async () => {
  for (const name of ["messy-quality", "zero-annotation", "multi-command"]) {
    const a = await analyzeFixture(name);
    const b = await analyzeFixture(name);
    assert.deepEqual(a, b, `${name} must be deterministic`);
  }
});

// --- Rule ↔ guide contract ------------------------------------------------------------------------

/** Parse `docs/skill-authoring.md`: the first backticked token of every `##`/`###` heading is an anchor. */
function guideAnchors(): Set<string> {
  const anchors = new Set<string>();
  for (const line of readFileSync(guidePath, "utf8").split("\n")) {
    if (!/^#{2,6}\s/.test(line)) continue;
    const match = line.match(/`([^`]+)`/);
    if (match?.[1]) anchors.add(match[1]);
  }
  return anchors;
}

test("Rule↔guide contract: every quality ruleId has a matching heading anchor in the guide", () => {
  const anchors = guideAnchors();
  for (const ruleId of QUALITY_RULE_IDS) {
    assert.ok(
      anchors.has(ruleId),
      `docs/skill-authoring.md is missing a heading anchor (\`${ruleId}\`) for the rule that emits it`,
    );
    assert.equal(qualityGuideAnchor(ruleId), `docs/skill-authoring.md#${ruleId}`);
  }
});

test("every ruleId emitted across the fixture matrix resolves to a guide anchor", async () => {
  const anchors = guideAnchors();
  const emitted = new Set<string>();
  for (const name of readdirSync(skillsDir)) {
    if (!statSync(path.join(skillsDir, name)).isDirectory()) continue;
    for (const id of ruleIds(await analyzeFixture(name))) emitted.add(id);
  }
  // Add the rules only reachable via inline inputs so the coverage claim is honest.
  emitted.add("l1-budget");
  emitted.add("l2-budget");
  emitted.add("orphan-section");
  for (const ruleId of emitted) {
    assert.ok(anchors.has(ruleId), `emitted ruleId "${ruleId}" has no guide anchor`);
  }
});

// --- Route: GET /api/skills/:id/versions/:vid/quality ---------------------------------------------

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

async function makeRouteApp(
  skills: SkillRepository,
  runs: RunRepository,
): Promise<FastifyInstance> {
  // Route registration needs the real engine + config; register the whole skillflow route set.
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

test("GET …/versions/:vid/quality: 200 returns a schema-valid report matching the pure engine; 404s", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);
  const { skillId, versionId } = seedFixtureSkill(skills, "messy-quality");
  const app = await makeRouteApp(skills, runs);

  const ok = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/quality`,
  });
  assert.equal(ok.statusCode, 200, ok.body);
  const report = qualityReportSchema.parse(ok.json());
  assert.equal(report.qualityEngineVersion, QUALITY_ENGINE_VERSION);
  assert.ok(report.score <= 60, `messy fixture scores low over the route: ${report.score}`);
  // The route's report equals the pure engine's (same projection + footprint + defaults).
  const direct = await analyzeFixture("messy-quality");
  assert.deepEqual(report, direct);

  // 404: unknown skill, and a version that belongs to a different skill.
  const badSkill = await app.inject({
    method: "GET",
    url: `/api/skills/does-not-exist/versions/${versionId}/quality`,
  });
  assert.equal(badSkill.statusCode, 404);

  const other = seedFixtureSkill(skills, "zero-annotation");
  const mismatch = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${other.versionId}/quality`,
  });
  assert.equal(mismatch.statusCode, 404);
});
