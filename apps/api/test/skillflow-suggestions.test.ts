import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  skillSuggestionsResponseSchema,
  type SkillEditOp,
  type SkillFileNode,
  type SkillGraph,
  type SkillStaticSuggestion,
  type SkillSuggestion,
  type TraceEvent,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { alignTrace } from "../src/skillflow/aligner.js";
import { validateEditOps } from "../src/skillflow/edit-ops.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { applyEditOps, type AppliedEdit } from "../src/skillflow/roundtrip.js";
import { buildStaticSuggestions, buildSuggestions } from "../src/skillflow/suggestions.js";
import { applyTreeOps } from "../src/skillflow/tree-ops.js";
import { DEFAULT_INGEST_CAPS } from "../src/skills/caps.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

// --- Fixture loading (same conventions as skillflow-aligner.test.ts / skillflow-roundtrip.test.ts) ---

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

// --- The WP 4.1 mechanical byte-exactness proof (roundtrip.ts's helpers aren't exported — the WP
// 5.2 brief says to assert outside-span equality manually when that's the case, so this is a small,
// self-contained copy of the same proof `skillflow-roundtrip.test.ts` runs) ------------------------

function reapply(orig: string[], edits: AppliedEdit[]): string[] {
  const out = [...orig];
  const ordered = [...edits].sort(
    (a, b) => b.startLine - a.startLine || b.deletedLines - a.deletedLines,
  );
  for (const edit of ordered)
    out.splice(edit.startLine - 1, edit.deletedLines, ...edit.insertedLines);
  return out;
}

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
      `lines ${oi + 1}-${start} (before the edit at line ${edit.startLine}) must be byte-identical`,
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

/** Apply ops, prove byte-exactness outside the touched spans, and return the applied result. */
function applyAndProveBytes(
  fixture: { skillMd: string; files: SkillFileNode[]; graph: SkillGraph },
  ops: SkillEditOp[],
) {
  const result = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, ops);
  const orig = fixture.skillMd.split("\n");
  const out = result.skillMd.split("\n");
  assert.equal(
    reapply(orig, result.edits).join("\n"),
    result.skillMd,
    "splices reproduce the result",
  );
  assertUntouchedLinesIdentical(orig, out, result.edits);
  return result;
}

function suggestionsFor(suggestions: SkillSuggestion[], rule: string): SkillSuggestion[] {
  return suggestions.filter((s) => s.rule === rule);
}

// --- Rule 1: missing-breadcrumbs ------------------------------------------------------------------

test("missing-breadcrumbs: a marker-less gatekeeper suggests pin + breadcrumb append; ops validate and round-trip", () => {
  const fixture = loadFixture("zero-annotation");
  // Zero events (or nothing that touches gather-inputs) → no marker/script_result evidence
  // anywhere, so EVERY verdict is 'inferred' (the honest WP 2.1/3.2 zero-annotation reality) and
  // nothing fractures — isolating this rule from the others.
  const events: TraceEvent[] = [
    { type: "turn", idx: 0, payload: { role: "assistant", text: "Starting." } },
  ];
  const alignment = alignTrace(fixture.graph, events);
  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);

  // Nothing invented for verdicts with no rule (the root subroutine, the never-visited gate/loop
  // guard with no fracture, the two never-visited assets whose section also never ran, …).
  assert.equal(
    suggestions.length,
    1,
    `expected exactly one suggestion: ${JSON.stringify(suggestions)}`,
  );

  const [suggestion] = suggestionsFor(suggestions, "missing-breadcrumbs");
  assert.ok(suggestion, "a missing-breadcrumbs suggestion was produced");
  assert.equal(suggestion.verdictRef.nodeId, "gather-inputs");
  assert.equal(suggestion.verdictRef.status, "unvisited");
  assert.equal(
    suggestion.id,
    "missing-breadcrumbs:gather-inputs",
    "deterministic id (rule:nodeId)",
  );
  assert.equal(suggestion.ops.length, 2, "set_annotation (pin, unannotated) + update_section_body");
  assert.deepEqual(suggestion.ops[0], {
    op: "set_annotation",
    nodeId: "gather-inputs",
    kind: "gatekeeper",
    id: "gather-inputs",
  });
  const bodyOp = suggestion.ops[1] as Extract<SkillEditOp, { op: "update_section_body" }>;
  assert.equal(bodyOp.op, "update_section_body");
  assert.equal(bodyOp.nodeId, "gather-inputs");
  assert.match(bodyOp.body, /\[skillflow:gate=gather-inputs route=<the-branch-you-chose>\]/);
  assert.ok(
    bodyOp.body.startsWith("Locate the export file the user attached."),
    "original body prose preserved verbatim before the appended sentence",
  );

  // (a) the ops validate against the SAME graph.
  assert.deepEqual(validateEditOps(fixture.graph, suggestion.ops), []);

  // (b) applying + re-projecting: the gatekeeper survives (now annotated, same id), and the body
  // carries the instruction sentence — with every byte outside the touched spans preserved exactly.
  const result = applyAndProveBytes(fixture, suggestion.ops);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);
  assert.ok(result.skillMd.includes("<!-- skillflow:gatekeeper id=gather-inputs -->"));
  assert.ok(result.skillMd.includes("[skillflow:gate=gather-inputs route=<the-branch-you-chose>]"));

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  const gatekeeper = reprojected.nodes.find((n) => n.id === "gather-inputs");
  assert.equal(
    gatekeeper?.kind,
    "gatekeeper",
    "the gatekeeper survives re-projection under the SAME id",
  );
  assert.equal(gatekeeper?.source, "annotated", "now pinned by the set_annotation op");

  // Idempotency: re-running the engine against the EDITED SKILL.md (still no marker events actually
  // fired) no longer suggests missing-breadcrumbs — the body already documents the marker syntax.
  const secondAlignment = alignTrace(reprojected, events);
  const secondSuggestions = buildSuggestions(result.skillMd, reprojected, secondAlignment, events);
  assert.deepEqual(suggestionsFor(secondSuggestions, "missing-breadcrumbs"), []);
});

// --- Rule 2: loop-detected -------------------------------------------------------------------------

test("loop-detected: an over-visited loop-guard section suggests tightening its retry cap; ops validate and round-trip", () => {
  const fixture = loadFixture("zero-annotation");
  // Four markers naming the "validate-the-data" subroutine directly (no script_result at all, so
  // the validation gate itself never fractures — isolates this from gate-failed-consistently) —
  // over the loop guard's declared maxIterations of 3.
  const events: TraceEvent[] = Array.from({ length: 4 }, (_, i) => ({
    type: "marker" as const,
    idx: i,
    payload: { raw: "[skillflow:gate=validate-the-data]", gateId: "validate-the-data" },
  }));
  const alignment = alignTrace(fixture.graph, events);
  const fractureVerdict = alignment.verdicts.find((v) => v.nodeId === "validate-the-data-loop");
  assert.equal(
    fractureVerdict?.status,
    "fracture",
    "the loop guard fractures (visited 4 > maxIterations 3)",
  );

  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);
  const [suggestion] = suggestionsFor(suggestions, "loop-detected");
  assert.ok(suggestion, "a loop-detected suggestion was produced");
  assert.equal(suggestion.verdictRef.nodeId, "validate-the-data-loop");
  assert.equal(suggestion.id, "loop-detected:validate-the-data-loop");
  assert.equal(suggestion.ops.length, 1);

  const op = suggestion.ops[0] as Extract<SkillEditOp, { op: "update_section_body" }>;
  assert.equal(op.op, "update_section_body");
  assert.equal(op.nodeId, "validate-the-data", "appended to the loop guard's OWNING section");
  // The fixture's "Validate the data" section already declares "at most 3 times" — this rule
  // TIGHTENS the cap (guardMax - 1 = 2) rather than duplicating the same number.
  assert.match(op.body, /Tighten the retry cap here: repeat at most 2 times/);
  assert.match(suggestion.rationale, /already declares retry language/);

  assert.deepEqual(validateEditOps(fixture.graph, suggestion.ops), []);

  const result = applyAndProveBytes(fixture, suggestion.ops);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);
  assert.ok(result.skillMd.includes("Tighten the retry cap here: repeat at most 2 times"));

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  const guard = reprojected.nodes.find((n) => n.id === "validate-the-data-loop");
  assert.equal(guard?.kind, "loop_guard", "the loop guard survives re-projection");
  assert.equal(
    guard?.maxIterations,
    3,
    "the ORIGINAL declared cap is untouched — the new sentence is additive",
  );
});

// --- Rule 3: asset-never-visited -------------------------------------------------------------------

test("asset-never-visited: an unvisited asset whose section DID run is advisory-only (no ops)", () => {
  const fixture = loadFixture("zero-annotation");
  // Only assets/template.html is read — its section ("Generate the report") runs (`ok`), but
  // reference/format-spec.md is never read.
  const events: TraceEvent[] = [
    {
      type: "skill_file_read",
      idx: 0,
      payload: { skill: "data-report", path: "assets/template.html" },
    },
  ];
  const alignment = alignTrace(fixture.graph, events);
  assert.equal(alignment.verdicts.find((v) => v.nodeId === "generate-the-report")?.status, "ok");
  assert.equal(
    alignment.verdicts.find((v) => v.nodeId === "asset-format-spec-md")?.status,
    "unvisited",
  );
  assert.equal(alignment.verdicts.find((v) => v.nodeId === "asset-template-html")?.status, "ok");

  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);
  const [suggestion] = suggestionsFor(suggestions, "asset-never-visited");
  assert.ok(suggestion, "an asset-never-visited suggestion was produced");
  assert.equal(suggestion.verdictRef.nodeId, "asset-format-spec-md");
  assert.equal(suggestion.verdictRef.status, "unvisited");
  assert.deepEqual(suggestion.ops, [], "advisory-only — no ops");
  assert.match(suggestion.rationale, /reference\/format-spec\.md/);
  assert.match(suggestion.rationale, /never read/);

  // The VISITED asset gets no such suggestion.
  assert.equal(
    suggestions.find(
      (s) => s.rule === "asset-never-visited" && s.verdictRef.nodeId === "asset-template-html",
    ),
    undefined,
  );
});

// --- Rule 4: gate-failed-consistently ---------------------------------------------------------------

test("gate-failed-consistently: a validation_gate fracture backed by exit-code evidence is advisory-only", () => {
  const fixture = loadFixture("zero-annotation");
  const events: TraceEvent[] = [
    {
      type: "script_result",
      idx: 0,
      payload: { script: "scripts/validate.py", exitCode: 1 },
    },
  ];
  const alignment = alignTrace(fixture.graph, events);
  const gateVerdict = alignment.verdicts.find((v) => v.nodeId === "gate-validate-py");
  assert.equal(gateVerdict?.status, "fracture");
  assert.equal(gateVerdict?.confidence, "exact", "real script_result evidence");

  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);
  const [suggestion] = suggestionsFor(suggestions, "gate-failed-consistently");
  assert.ok(suggestion, "a gate-failed-consistently suggestion was produced");
  assert.equal(suggestion.verdictRef.nodeId, "gate-validate-py");
  assert.deepEqual(
    suggestion.ops,
    [],
    "advisory-only — SkillFlow won't guess script vs. expectation",
  );
  assert.match(suggestion.rationale, /scripts\/validate\.py exited 1/);
});

test("gate-failed-consistently does NOT fire on the tool-error degradation path (no script_result evidence)", () => {
  const fixture = loadFixture("zero-annotation");
  // The internal-run degradation path (WP 2.2's bindToolErrorsToGate): a failed tool result
  // deterministically linked to the gate's script, but with NO script_result event at all — no exit
  // code to quote, so this rule must not invent one.
  const events: TraceEvent[] = [
    {
      type: "skill_file_read",
      idx: 0,
      payload: { skill: "data-report", path: "scripts/validate.py" },
    },
    { type: "tool_call", idx: 1, payload: { tool: "run_validate.py" } },
    { type: "tool_result", idx: 2, payload: { tool: "run_validate.py", status: "error" } },
  ];
  const alignment = alignTrace(fixture.graph, events);
  const gateVerdict = alignment.verdicts.find((v) => v.nodeId === "gate-validate-py");
  assert.equal(gateVerdict?.status, "fracture", "bound via the deterministic tool-error link");
  assert.equal(gateVerdict?.confidence, "inferred", "no marker/script_result evidence");

  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);
  assert.deepEqual(suggestionsFor(suggestions, "gate-failed-consistently"), []);
});

// --- Rule 5: marker-route-mismatch ------------------------------------------------------------------

/**
 * RM-30 WP 7.8 — the shared `zero-annotation` fixture's "If the input is CSV … Otherwise if JSON …"
 * is an INTRA-STEP rule, not routing, and the tightened `extractConditions` correctly stops lifting
 * it into branch labels. This helper rewrites that one sentence in memory into a REAL routing branch
 * (each arm names a destination) so the branch-shaped rules below still exercise what they were
 * written to exercise. The fixture FILE is deliberately left byte-unchanged — every other suite that
 * reads it keeps seeing the honest, branch-free graph.
 */
function routingZeroAnnotation(): { skillMd: string; files: SkillFileNode[]; graph: SkillGraph } {
  const base = loadFixture("zero-annotation");
  const skillMd = base.skillMd.replace(
    "If the input is CSV, treat the first row as a header and every other row as a record. Otherwise if\nJSON, expect a top-level array of objects with consistent keys.",
    "If the input is CSV, go to Validate the data. Otherwise if JSON, go to Validate the data.",
  );
  assert.notEqual(
    skillMd,
    base.skillMd,
    "the fixture was actually rewritten into a routing branch",
  );
  return { skillMd, files: base.files, graph: projectSkillGraph(skillMd, base.files) };
}

test("marker-route-mismatch: a bogus marker route is advisory-only (no deterministic replacement to draft)", () => {
  const fixture = routingZeroAnnotation();
  const events: TraceEvent[] = [
    {
      type: "marker",
      idx: 0,
      payload: {
        raw: "[skillflow:gate=gather-inputs route=r-xml]",
        gateId: "gather-inputs",
        routeId: "r-xml",
      },
    },
  ];
  const alignment = alignTrace(fixture.graph, events);
  const verdict = alignment.verdicts.find((v) => v.nodeId === "gather-inputs");
  assert.equal(verdict?.status, "fracture");
  assert.equal(verdict?.edgeId, "r-xml");
  assert.equal(verdict?.confidence, "exact");

  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);
  // The marker itself is real evidence, so missing-breadcrumbs (which requires 'inferred'
  // confidence) must NOT also fire for this same gatekeeper.
  assert.deepEqual(suggestionsFor(suggestions, "missing-breadcrumbs"), []);

  const [suggestion] = suggestionsFor(suggestions, "marker-route-mismatch");
  assert.ok(suggestion, "a marker-route-mismatch suggestion was produced");
  assert.equal(suggestion.verdictRef.nodeId, "gather-inputs");
  assert.equal(suggestion.verdictRef.edgeId, "r-xml");
  assert.deepEqual(
    suggestion.ops,
    [],
    "advisory-only — no deterministic replacement condition to draft",
  );
  assert.match(suggestion.rationale, /route "r-xml"/);
  assert.match(suggestion.rationale, /CSV/);
  assert.match(suggestion.rationale, /JSON/);
});

// --- No rule → no suggestion -------------------------------------------------------------------------

test("no-rule verdicts never get an invented suggestion (an ordinary unvisited subroutine)", () => {
  const fixture = loadFixture("zero-annotation");
  const events: TraceEvent[] = [];
  const alignment = alignTrace(fixture.graph, events);
  assert.equal(
    alignment.verdicts.find((v) => v.nodeId === "verify-the-output")?.status,
    "unvisited",
  );
  assert.equal(alignment.verdicts.find((v) => v.nodeId === "data-report")?.status, "unvisited");

  const suggestions = buildSuggestions(fixture.skillMd, fixture.graph, alignment, events);
  assert.equal(
    suggestions.find((s) => s.verdictRef.nodeId === "verify-the-output"),
    undefined,
    "a plain unvisited subroutine (no gate/loop/asset attached) has no matching rule",
  );
  assert.equal(
    suggestions.find((s) => s.verdictRef.nodeId === "data-report"),
    undefined,
    "the root subroutine has no matching rule either",
  );
});

// =================================================================================================
// Skill IDE WP 4.2 — STATIC (trace-less) optimization suggestions
// =================================================================================================

/** Build an in-memory fixture (skillMd + flat file list + projected graph) from an inline document. */
function inlineFixture(
  skillMd: string,
  extraPaths: string[] = [],
): { skillMd: string; files: SkillFileNode[]; graph: SkillGraph } {
  const files: SkillFileNode[] = ["SKILL.md", ...extraPaths].map((p) => ({
    path: p,
    size: Buffer.byteLength(p === "SKILL.md" ? skillMd : ""),
    isBinary: false,
    isSkillMd: p === "SKILL.md",
    kind: classifyKind(p),
    tokenTotal: 0,
  }));
  return { skillMd, files, graph: projectSkillGraph(skillMd, files) };
}

function staticFor(suggestions: SkillStaticSuggestion[], rule: string): SkillStaticSuggestion[] {
  return suggestions.filter((s) => s.rule === rule);
}

// --- Rule: split-oversized-body -------------------------------------------------------------------

test("split-oversized-body: L2 over ceiling moves the largest section body to reference/<slug>.md; ops validate and round-trip", () => {
  const bigBody = Array.from(
    { length: 8 },
    (_, i) => `Detailed paragraph ${i + 1} of the large step, describing the procedure at length.`,
  ).join("\n\n");
  const skillMd = [
    "---",
    "name: big-skill",
    "description: A skill with one very large section that should be split out to a reference file.",
    "---",
    "",
    "# Big Skill",
    "",
    "Intro paragraph.",
    "",
    "## Small Step",
    "",
    "Short body.",
    "",
    "## Large Step",
    "",
    bigBody,
    "",
    "## Wrap Up",
    "",
    "Done.",
    "",
  ].join("\n");
  const fixture = inlineFixture(skillMd);
  const manifest = parseSkillManifest(skillMd).manifest;
  const largeNode = fixture.graph.nodes.find((n) => n.label === "Large Step");
  assert.ok(largeNode, "the Large Step section projects as a node");

  // L2 forced over the 5000 ceiling; L1 well under → only split fires.
  const suggestions = buildStaticSuggestions({
    skillMd,
    manifest,
    graph: fixture.graph,
    files: fixture.files,
    footprint: { l1: 20, l2: 9000 },
    l1Ceiling: 500,
    l2Ceiling: 5000,
  });

  const [split] = staticFor(suggestions, "split-oversized-body");
  assert.ok(
    split,
    `a split-oversized-body suggestion was produced: ${JSON.stringify(suggestions)}`,
  );
  assert.equal(
    split.id,
    `split-oversized-body:${largeNode!.id}`,
    "deterministic id (rule:sectionNodeId)",
  );
  assert.equal(split.ops.length, 2, "add_file + update_section_body");

  const addFile = split.ops[0] as Extract<SkillEditOp, { op: "add_file" }>;
  assert.equal(addFile.op, "add_file");
  assert.equal(
    addFile.path,
    "reference/large-step.md",
    "largest section slug → reference/<slug>.md",
  );
  assert.ok(
    addFile.content.startsWith("# Large Step\n\n"),
    "reference file leads with the section heading",
  );
  assert.ok(
    addFile.content.includes("Detailed paragraph 1"),
    "the moved body is carried into the reference file",
  );

  const bodyOp = split.ops[1] as Extract<SkillEditOp, { op: "update_section_body" }>;
  assert.equal(bodyOp.op, "update_section_body");
  assert.equal(bodyOp.nodeId, largeNode!.id, "the pointer replaces the LARGEST section's body");
  assert.match(bodyOp.body, /reference\/large-step\.md/);
  assert.match(bodyOp.body, /moved out of SKILL\.md/);
  assert.deepEqual(split.target, { nodeId: largeNode!.id, path: "reference/large-step.md" });

  // (a) the ops validate against the SAME graph + file list (the no-corruption guarantee).
  assert.deepEqual(validateEditOps(fixture.graph, split.ops, fixture.files), []);

  // (b) the TEXT op round-trips byte-exact through applyEditOps (untouched prose preserved).
  const result = applyAndProveBytes(fixture, [bodyOp]);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);
  assert.ok(result.skillMd.includes("reference/large-step.md"));
  assert.ok(
    !result.skillMd.includes("Detailed paragraph 1"),
    "the large body is gone from SKILL.md after the split",
  );

  // (c) the TREE op applies through applyTreeOps — the reference file materializes with the moved body.
  const treeResult = applyTreeOps(
    [{ path: "SKILL.md", content: Buffer.from(skillMd, "utf8") }],
    [addFile],
    DEFAULT_INGEST_CAPS,
  );
  const ref = treeResult.files.find((f) => f.path === "reference/large-step.md");
  assert.ok(ref, "the reference file was added to the tree");
  assert.equal(
    ref!.content.toString("utf8"),
    addFile.content,
    "reference file content matches the drafted op verbatim",
  );
});

test("split-oversized-body: does NOT fire when L2 is within the ceiling", () => {
  const skillMd =
    "---\nname: lean\ndescription: A lean skill whose body is comfortably under the ceiling.\n---\n\n# Lean\n\n## Step\n\nShort.\n";
  const fixture = inlineFixture(skillMd);
  const suggestions = buildStaticSuggestions({
    skillMd,
    manifest: parseSkillManifest(skillMd).manifest,
    graph: fixture.graph,
    files: fixture.files,
    footprint: { l1: 20, l2: 100 },
    l1Ceiling: 500,
    l2Ceiling: 5000,
  });
  assert.deepEqual(staticFor(suggestions, "split-oversized-body"), []);
});

test("split-oversized-body: L2 over ceiling but no movable section body → advisory (no ops)", () => {
  // Headings only — every section body is empty, so there is nothing safe to auto-move.
  const skillMd =
    "---\nname: headings-only\ndescription: A skill whose content is entirely in nested headings.\n---\n\n# Root\n\n## Alpha\n\n### Beta\n";
  const fixture = inlineFixture(skillMd);
  const suggestions = buildStaticSuggestions({
    skillMd,
    manifest: parseSkillManifest(skillMd).manifest,
    graph: fixture.graph,
    files: fixture.files,
    footprint: { l1: 20, l2: 9000 },
    l1Ceiling: 500,
    l2Ceiling: 5000,
  });
  const [split] = staticFor(suggestions, "split-oversized-body");
  assert.ok(split, "an advisory split suggestion still surfaces the over-budget finding");
  assert.deepEqual(split.ops, [], "advisory-only — no movable body to draft ops for");
  assert.match(split.rationale, /over the 5000-token ceiling/);
});

// --- Rule: dedupe-keywords ------------------------------------------------------------------------

test("dedupe-keywords: duplicate frontmatter keywords (case-insensitive) suggest set_keywords; ops validate and round-trip", () => {
  const skillMd = [
    "---",
    "name: kw-skill",
    "description: A skill whose keyword trigger list contains duplicate entries.",
    "keywords:",
    "  - report",
    "  - Report",
    "  - pdf",
    "  - report",
    "---",
    "",
    "# KW Skill",
    "",
    "Body.",
    "",
  ].join("\n");
  const fixture = inlineFixture(skillMd);
  const suggestions = buildStaticSuggestions({
    skillMd,
    manifest: parseSkillManifest(skillMd).manifest,
    graph: fixture.graph,
    files: fixture.files,
    footprint: { l1: 20, l2: 100 },
    l1Ceiling: 500,
    l2Ceiling: 5000,
  });

  const [dedupe] = staticFor(suggestions, "dedupe-keywords");
  assert.ok(dedupe, "a dedupe-keywords suggestion was produced");
  assert.equal(dedupe.id, "dedupe-keywords:keywords");
  assert.equal(dedupe.ops.length, 1);
  const op = dedupe.ops[0] as Extract<SkillEditOp, { op: "set_keywords" }>;
  assert.equal(op.op, "set_keywords");
  assert.deepEqual(
    op.keywords,
    ["report", "pdf"],
    "case-insensitive dedupe, first-seen casing kept",
  );

  assert.deepEqual(validateEditOps(fixture.graph, dedupe.ops), []);

  // Apply + re-project: exactly the two deduped keyword entry points survive.
  const applied = applyEditOps(skillMd, fixture.files, fixture.graph, dedupe.ops);
  assert.equal(applied.warnings.length, 0, `no warnings expected: ${applied.warnings.join(" | ")}`);
  const reprojected = projectSkillGraph(applied.skillMd, fixture.files);
  const keywordLabels = reprojected.nodes
    .filter((n) => n.kind === "entry_point" && n.trigger.type === "keyword")
    .map((n) => n.label);
  assert.deepEqual(
    keywordLabels,
    ["report", "pdf"],
    "the applied frontmatter carries only the deduped keywords",
  );
});

test("dedupe-keywords: unique keywords produce no suggestion; no keywords produce no suggestion", () => {
  const unique =
    "---\nname: kw\ndescription: A skill with a unique keyword list and nothing to dedupe.\nkeywords:\n  - report\n  - pdf\n---\n\n# KW\n\nBody.\n";
  const uf = inlineFixture(unique);
  assert.deepEqual(
    staticFor(
      buildStaticSuggestions({
        skillMd: unique,
        manifest: parseSkillManifest(unique).manifest,
        graph: uf.graph,
        files: uf.files,
        footprint: { l1: 20, l2: 100 },
        l1Ceiling: 500,
        l2Ceiling: 5000,
      }),
      "dedupe-keywords",
    ),
    [],
  );

  const none =
    "---\nname: kw\ndescription: A skill with no keyword trigger surface at all.\n---\n\n# KW\n\nBody.\n";
  const nf = inlineFixture(none);
  assert.deepEqual(
    staticFor(
      buildStaticSuggestions({
        skillMd: none,
        manifest: parseSkillManifest(none).manifest,
        graph: nf.graph,
        files: nf.files,
        footprint: { l1: 20, l2: 100 },
        l1Ceiling: 500,
        l2Ceiling: 5000,
      }),
      "dedupe-keywords",
    ),
    [],
  );
});

// --- Rule: remove-unused-asset (advisory) ---------------------------------------------------------

test("remove-unused-asset: a bundled file referenced by no section is advisory-only; a referenced script is not flagged", () => {
  const fixture = loadFixture("messy-quality"); // assets/orphan.txt unused; scripts/cleanup.sh referenced
  const suggestions = buildStaticSuggestions({
    skillMd: fixture.skillMd,
    manifest: parseSkillManifest(fixture.skillMd).manifest,
    graph: fixture.graph,
    files: fixture.files,
    footprint: { l1: 20, l2: 100 }, // forced small → only remove-unused-asset can fire
    l1Ceiling: 500,
    l2Ceiling: 5000,
  });

  const unused = staticFor(suggestions, "remove-unused-asset");
  assert.equal(unused.length, 1, `exactly the orphan file is flagged: ${JSON.stringify(unused)}`);
  assert.equal(unused[0]!.id, "remove-unused-asset:assets/orphan.txt");
  assert.deepEqual(unused[0]!.target, { path: "assets/orphan.txt" });
  assert.deepEqual(unused[0]!.ops, [], "advisory-only — removing a file is an authoring call");
  assert.match(unused[0]!.rationale, /referenced by no section/);

  assert.equal(
    unused.find((s) => s.id.includes("cleanup.sh")),
    undefined,
    "the referenced script is NOT flagged as unused",
  );
});

// --- Rule: tighten-description (advisory) ---------------------------------------------------------

test("tighten-description: L1 over ceiling is advisory-only; under ceiling produces nothing", () => {
  const skillMd =
    "---\nname: verbose\ndescription: A very long, meandering description that keeps going and going well past what the router needs to route on it reliably.\n---\n\n# Verbose\n\nBody.\n";
  const fixture = inlineFixture(skillMd);
  const manifest = parseSkillManifest(skillMd).manifest;

  const over = staticFor(
    buildStaticSuggestions({
      skillMd,
      manifest,
      graph: fixture.graph,
      files: fixture.files,
      footprint: { l1: 640, l2: 100 },
      l1Ceiling: 500,
      l2Ceiling: 5000,
    }),
    "tighten-description",
  );
  assert.equal(over.length, 1);
  assert.equal(over[0]!.id, "tighten-description:description");
  assert.deepEqual(over[0]!.ops, [], "advisory-only — no single deterministic rewrite to draft");
  assert.match(over[0]!.rationale, /over the 500-token ceiling/);

  const under = staticFor(
    buildStaticSuggestions({
      skillMd,
      manifest,
      graph: fixture.graph,
      files: fixture.files,
      footprint: { l1: 200, l2: 100 },
      l1Ceiling: 500,
      l2Ceiling: 5000,
    }),
    "tighten-description",
  );
  assert.deepEqual(under, []);
});

// --- No-corruption invariant across ALL fixtures --------------------------------------------------

test("buildStaticSuggestions never emits broken ops: on every fixture, non-empty ops pass validateEditOps", () => {
  const fixtureNames = readdirSync(skillsDir).filter((name) =>
    statSync(path.join(skillsDir, name)).isDirectory(),
  );
  assert.ok(fixtureNames.length > 0, "there is at least one fixture");

  for (const name of fixtureNames) {
    const fixture = loadFixture(name);
    // Force BOTH budget ceilings to 1 so split (real ops) + tighten (advisory) both attempt to fire.
    const suggestions = buildStaticSuggestions({
      skillMd: fixture.skillMd,
      manifest: parseSkillManifest(fixture.skillMd).manifest,
      graph: fixture.graph,
      files: fixture.files,
      footprint: { l1: 9999, l2: 9999 },
      l1Ceiling: 1,
      l2Ceiling: 1,
    });
    // Determinism: a second identical run is deep-equal.
    const again = buildStaticSuggestions({
      skillMd: fixture.skillMd,
      manifest: parseSkillManifest(fixture.skillMd).manifest,
      graph: fixture.graph,
      files: fixture.files,
      footprint: { l1: 9999, l2: 9999 },
      l1Ceiling: 1,
      l2Ceiling: 1,
    });
    assert.deepEqual(again, suggestions, `[${name}] static suggestions are deterministic`);

    for (const suggestion of suggestions) {
      if (suggestion.ops.length === 0) continue; // advisory — nothing to validate
      assert.deepEqual(
        validateEditOps(fixture.graph, suggestion.ops, fixture.files),
        [],
        `[${name}] suggestion ${suggestion.id} emits ops that must pass validateEditOps`,
      );
    }
  }
});

// --- Route tests (GET /api/skills/:id/versions/:vid/suggestions) -----------------------------------

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

const NOW = "2026-07-03T00:00:00.000Z";

function seedParents(db: AppDatabase, scenarioId: string, testId: string): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'Report', 'Generate the report.', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });
}

function seedRun(db: AppDatabase, runId: string, scenarioId: string, testId: string): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES (@id, @testId, @scenarioId, 'automated', 'completed', @now)`,
  ).run({ id: runId, testId, scenarioId, now: NOW });
}

function seedStep(
  db: AppDatabase,
  runId: string,
  step: {
    idx: number;
    type: string;
    label: string;
    status?: string;
    toolName?: string;
    payload?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, payload_json)
     VALUES (@id, @runId, @idx, @type, @label, @status, @toolName, @payloadJson)`,
  ).run({
    id: `${runId}:step:${step.idx}`,
    runId,
    idx: step.idx,
    type: step.type,
    label: step.label,
    status: step.status ?? "ok",
    toolName: step.toolName ?? null,
    payloadJson: JSON.stringify(step.payload ?? {}),
  });
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

function seedFixtureSkill(
  skills: SkillRepository,
  fixtureName = "zero-annotation",
  skillName = "data-report",
): { skillId: string; versionId: string } {
  const dir = path.join(skillsDir, fixtureName);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const inputs: SkillFileInput[] = paths
    .sort()
    .map((p) => ({ path: p, bytes: readFileSync(path.join(dir, p)) }));
  const skill = skills.create({ name: skillName, sourceType: "upload" });
  const created = skills.createVersion(skill.id, inputs, {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: created.version.id };
}

test("GET …/versions/:vid/suggestions: 200 happy path is schema-valid; 400/404/409 mirror the trace route", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 11));
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);

  const { skillId, versionId } = seedFixtureSkill(skills);
  const other = skills.createVersion(
    skillId,
    [
      {
        path: "SKILL.md",
        bytes: Buffer.from("# Data Report v2\n\n## Steps\n\nDo the thing.\n", "utf8"),
      },
    ],
    { sourceKind: "upload", importedFrom: "upload" },
  );

  seedParents(db, "scn-1", "test-1");
  seedRun(db, "run-1", "scn-1", "test-1");
  // A minimal internal-run stream: no markers, no script results — the honest zero-annotation
  // reality, which is exactly what should surface a missing-breadcrumbs suggestion.
  seedStep(db, "run-1", {
    idx: 0,
    type: "user_message",
    label: "User request",
    payload: { text: "Go." },
  });
  db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
     VALUES ('run-1', @skillId, @versionId, 'v1', 0)`,
  ).run({ skillId, versionId });

  const app = await makeRouteApp(skills, runs);

  const ok = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/suggestions?runId=run-1`,
  });
  assert.equal(ok.statusCode, 200, ok.body);
  const response = skillSuggestionsResponseSchema.parse(ok.json());
  assert.ok(
    response.suggestions.length > 0,
    "at least the missing-breadcrumbs suggestion surfaces",
  );
  assert.ok(response.suggestions.some((s) => s.rule === "missing-breadcrumbs"));
  assert.ok(response.projectorVersion >= 1);
  assert.ok(response.alignerVersion >= 1);

  // 409: aligning against a version the run did not run.
  const mismatch = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${other.version.id}/suggestions?runId=run-1`,
  });
  assert.equal(mismatch.statusCode, 409);
  assert.ok(
    String((mismatch.json() as { error: string }).error).includes("did not run skill version"),
  );

  // WP 4.2: NO runId → 200 with static (trace-less) optimization suggestions (was 400 pre-4.2).
  const staticRes = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/suggestions`,
  });
  assert.equal(staticRes.statusCode, 200, staticRes.body);
  const staticJson = skillSuggestionsResponseSchema.parse(staticRes.json());
  assert.deepEqual(staticJson.suggestions, [], "static branch returns no trace suggestions");
  assert.ok(
    Array.isArray(staticJson.staticSuggestions),
    "static branch returns a staticSuggestions array",
  );
  assert.equal(staticJson.alignerVersion, 0, "no aligner ran for the static branch");
  assert.ok(staticJson.projectorVersion >= 1);

  // 404: unknown run.
  const badRun = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/suggestions?runId=nope`,
  });
  assert.equal(badRun.statusCode, 404);

  // 404: a version id belonging to a DIFFERENT skill.
  const otherSkill = seedFixtureSkill(skills);
  const badSkill = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${otherSkill.versionId}/suggestions?runId=run-1`,
  });
  assert.equal(badSkill.statusCode, 404);
});

test("GET …/versions/:vid/suggestions (no runId): static branch surfaces a real optimization suggestion end-to-end", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 11));
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);

  // messy-quality bundles assets/orphan.txt (referenced by nothing) → remove-unused-asset advisory.
  const { skillId, versionId } = seedFixtureSkill(skills, "messy-quality", "messy-quality");
  const app = await makeRouteApp(skills, runs);

  const res = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/suggestions`,
  });
  assert.equal(res.statusCode, 200, res.body);
  const json = skillSuggestionsResponseSchema.parse(res.json());
  const unused = (json.staticSuggestions ?? []).filter((s) => s.rule === "remove-unused-asset");
  assert.ok(
    unused.some((s) => s.target?.path === "assets/orphan.txt"),
    `the unused orphan asset is surfaced: ${JSON.stringify(json.staticSuggestions)}`,
  );
});
