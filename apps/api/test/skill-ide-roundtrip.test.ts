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
import { validateEditOps } from "../src/skillflow/edit-ops.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { applyEditOps, type AppliedEdit } from "../src/skillflow/roundtrip.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// WP 2.1 — the edit-ops v2 vocabulary (command CRUD, keywords, asset connect/disconnect) learned by
// the round-trip engine. Every test proves the SAME sacred invariants as the WP 4.1 ops: the bytes
// OUTSIDE the touched anchor span are identical, and re-projecting the result reflects the edit.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

// --- Fixture loading (same convention as skillflow-roundtrip.test.ts) -----------------------------

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

/** Project an ad-hoc in-memory SKILL.md (used for pin-preservation / no-frontmatter cases). */
function fromString(skillMd: string, files: SkillFileNode[] = []) {
  return { skillMd, files, graph: projectSkillGraph(skillMd, files) };
}

// --- The mechanical byte-exactness proof (same as skillflow-roundtrip.test.ts) --------------------

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

function assertDeletionsWithinSpans(edits: AppliedEdit[], spans: Array<[number, number]>): void {
  for (const edit of edits) {
    if (edit.deletedLines === 0) continue;
    const endLine = edit.startLine + edit.deletedLines - 1;
    assert.ok(
      spans.some(([s, e]) => edit.startLine >= s && endLine <= e),
      `deleted range ${edit.startLine}–${endLine} lies outside every allowed span (${JSON.stringify(spans)})`,
    );
  }
}

function anchorSpan(graph: SkillGraph, nodeId: string): [number, number] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  assert.ok(node, `graph has node "${nodeId}"`);
  return [node.anchor.startLine, node.anchor.endLine];
}

/** The full document span occupied by a whole flow (its first section start → its last body end). */
function flowSpan(graph: SkillGraph, flowId: string): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = -1;
  for (const node of graph.nodes) {
    if ((node.flowId ?? "main") === flowId) {
      min = Math.min(min, node.anchor.startLine);
      max = Math.max(max, node.anchor.endLine);
    }
  }
  assert.ok(max >= 0, `graph has a flow "${flowId}"`);
  return [min, max];
}

function applyAndProve(
  fixture: { skillMd: string; files: SkillFileNode[]; graph: SkillGraph },
  ops: SkillEditOp[],
  allowedDeletionSpans: Array<[number, number]>,
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
  assertDeletionsWithinSpans(result.edits, allowedDeletionSpans);
  return result;
}

// --- (A) The round-trip property, every WP 2.1 op, on the multi-command fixture --------------------

test("multi-command: WP 2.1 ops (rename/connect/disconnect/set_keywords/add_command) round-trip byte-exact", () => {
  const fixture = loadFixture("multi-command");
  const ops: SkillEditOp[] = [
    { op: "rename_command", nodeId: "report-daily", command: "/summary" },
    {
      op: "connect_asset",
      nodeId: "run-the-checks",
      path: "reference/spec.md",
      sentence: "Cross-check the column layout in `reference/spec.md` before trusting the counts.",
    },
    { op: "disconnect_asset", nodeId: "load-the-input", path: "reference/spec.md" },
    { op: "set_keywords", keywords: ["quarterly review", "kpi digest"] },
    {
      op: "add_command",
      command: "/digest",
      title: "weekly",
      body: "Roll up the week.",
      afterFlowId: "report-daily",
    },
  ];
  const result = applyAndProve(fixture, ops, [
    anchorSpan(fixture.graph, "report-daily"), // rename rewrites the heading line
    anchorSpan(fixture.graph, "load-the-input"), // disconnect removes the referencing line
    anchorSpan(fixture.graph, "keyword-analyze-data"), // set_keywords splices the frontmatter block
  ]);
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  // rename_command: the /report entry now triggers on /summary, its extra title word kept.
  assert.ok(
    reprojected.nodes.some((n) => n.kind === "entry_point" && n.trigger.value === "/summary"),
    "renamed command triggers on /summary",
  );
  assert.ok(
    !reprojected.nodes.some((n) => n.kind === "entry_point" && n.trigger.value === "/report"),
    "old /report gone",
  );
  assert.ok(result.skillMd.includes("## /summary daily"), "trailing title word preserved");
  // add_command: a new /digest entry point exists.
  assert.ok(
    reprojected.nodes.some((n) => n.kind === "entry_point" && n.trigger.value === "/digest"),
    "new /digest command",
  );
  // set_keywords: keyword entry points replaced.
  assert.ok(
    reprojected.nodes.some((n) => n.trigger?.value === "quarterly review"),
    "new keyword entry",
  );
  assert.ok(
    !reprojected.nodes.some((n) => n.trigger?.value === "analyze data"),
    "old keyword gone",
  );
  // connect_asset moved spec.md's reference to run-the-checks; disconnect removed it from load-the-input.
  const specAtRunChecks = reprojected.edges.some(
    (e) =>
      e.from === "run-the-checks" &&
      reprojected.nodes.find((n) => n.id === e.to)?.path === "reference/spec.md",
  );
  const specAtLoad = reprojected.edges.some(
    (e) =>
      e.from === "load-the-input" &&
      reprojected.nodes.find((n) => n.id === e.to)?.path === "reference/spec.md",
  );
  assert.ok(specAtRunChecks, "connect_asset: spec.md now referenced from run-the-checks");
  assert.ok(!specAtLoad, "disconnect_asset: spec.md no longer referenced from load-the-input");
});

// --- (B) add_command placement + trailing-newline discipline --------------------------------------

test("add_command with no afterFlowId appends a /command section at the document end", () => {
  const fixture = loadFixture("multi-command");
  const result = applyAndProve(
    fixture,
    [{ op: "add_command", command: "/export", body: "Write a CSV." }],
    [],
  );
  assert.equal(result.warnings.length, 0);
  assert.ok(
    result.skillMd.endsWith("## /export\n\nWrite a CSV.\n"),
    "appended at EOF with one blank separator",
  );
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    reprojected.nodes.some((n) => n.kind === "entry_point" && n.trigger.value === "/export"),
  );
});

test("add_command afterFlowId inserts after the reference flow's last section", () => {
  const fixture = loadFixture("multi-command");
  const result = applyAndProve(
    fixture,
    [{ op: "add_command", command: "/export", afterFlowId: "analyze" }],
    [],
  );
  assert.equal(result.warnings.length, 0);
  // The new command lands between the analyze flow and the /report daily flow (not at EOF).
  const idx = result.skillMd.split("\n").indexOf("## /export");
  const reportIdx = result.skillMd.split("\n").indexOf("## /report daily");
  const checksIdx = result.skillMd.split("\n").indexOf("### Run the checks");
  assert.ok(
    idx > checksIdx && idx < reportIdx,
    "inserted after the analyze flow, before /report daily",
  );
});

test("add_command at EOF without a trailing newline keeps the no-trailing-newline style (newline lands inside the span)", () => {
  const base = loadFixture("multi-command");
  const noNewline = base.skillMd.replace(/\n$/, "");
  assert.ok(!noNewline.endsWith("\n"), "fixture prepared without a trailing newline");
  const fixture = fromString(noNewline, base.files);
  const result = applyAndProve(fixture, [{ op: "add_command", command: "/export", body: "x" }], []);
  assert.equal(result.warnings.length, 0);
  // The original last bytes are untouched; the separating newline is created inside the inserted span.
  assert.ok(result.skillMd.startsWith(noNewline), "every original byte preserved verbatim");
  assert.ok(!result.skillMd.endsWith("\n"), "no trailing newline was invented outside the span");
  assert.ok(result.skillMd.endsWith("## /export\n\nx"), "the new section is the inserted span");
});

// --- (C) rename_command preserves a skillflow:command pin -----------------------------------------

test("rename_command rewrites only the /token and preserves a skillflow:command pin", () => {
  const md = [
    "---",
    "name: pin-test",
    "---",
    "",
    "# Pin Test",
    "",
    "<!-- skillflow:command id=pinned-run -->",
    "## /run daily",
    "",
    "Do the run.",
    "",
  ].join("\n");
  const fixture = fromString(md);
  assert.equal(
    fixture.graph.nodes.find((n) => n.id === "pinned-run")?.trigger?.value,
    "/run",
    "pin projects the entry id",
  );

  const result = applyAndProve(
    fixture,
    [{ op: "rename_command", nodeId: "pinned-run", command: "/execute" }],
    [anchorSpan(fixture.graph, "pinned-run")],
  );
  assert.equal(result.warnings.length, 0);
  assert.ok(result.skillMd.includes("## /execute daily"), "token rewritten, title word kept");
  assert.ok(
    result.skillMd.includes("<!-- skillflow:command id=pinned-run -->"),
    "annotation pin untouched",
  );

  const reprojected = projectSkillGraph(result.skillMd, []);
  const entry = reprojected.nodes.find((n) => n.id === "pinned-run");
  assert.equal(entry?.kind, "entry_point");
  assert.equal(entry?.trigger?.value, "/execute", "pinned id preserved, trigger value changed");
});

// --- (D) delete_command: whole flow removed; shared assets + cross-flow refs survive ---------------

test("delete_command removes the whole flow; the bundled file survives and a cross-flow reference is left untouched", () => {
  const fixture = loadFixture("multi-command");
  const result = applyAndProve(
    fixture,
    [{ op: "delete_command", nodeId: "analyze" }],
    [flowSpan(fixture.graph, "analyze")],
  );
  assert.equal(result.warnings.length, 0);
  // The /analyze flow and its sections are gone.
  assert.ok(!result.skillMd.includes("## /analyze"), "analyze heading removed");
  assert.ok(!result.skillMd.includes("### Load the input"), "flow subsection removed");
  // The cross-flow reference in the OTHER flow is left byte-for-byte (now dangling) — never edited.
  assert.ok(
    result.skillMd.includes("see /analyze first"),
    "cross-flow reference in /report flow untouched",
  );
  // /report flow untouched.
  assert.ok(result.skillMd.includes("## /report daily"), "sibling command untouched");
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    !reprojected.nodes.some((n) => n.kind === "entry_point" && n.trigger.value === "/analyze"),
    "no /analyze entry",
  );
  // The bundled files themselves are never deleted by a text edit (roundtrip only rewrites SKILL.md).
  assert.ok(
    fixture.files.some((f) => f.path === "reference/spec.md"),
    "shared asset file still present",
  );
  assert.ok(
    fixture.files.some((f) => f.path === "scripts/check.py"),
    "shared script file still present",
  );
});

test("delete_command removes a flow containing an annotated gatekeeper, leaving outside sections intact", () => {
  const md = [
    "---",
    "name: gk",
    "---",
    "",
    "# GK",
    "",
    "## /run",
    "",
    "Kick off the run.",
    "",
    "<!-- skillflow:gatekeeper id=router -->",
    "### Route the input",
    "",
    "If the input is CSV, do A. Otherwise do B.",
    "",
    "## Wrap up",
    "",
    "See /run when done.",
    "",
  ].join("\n");
  const fixture = fromString(md);
  assert.equal(
    fixture.graph.nodes.find((n) => n.id === "router")?.kind,
    "gatekeeper",
    "annotated gatekeeper projects",
  );

  const result = applyAndProve(
    fixture,
    [{ op: "delete_command", nodeId: "run" }],
    [flowSpan(fixture.graph, "run")],
  );
  assert.equal(result.warnings.length, 0);
  assert.ok(!result.skillMd.includes("## /run"), "command heading removed");
  assert.ok(
    !result.skillMd.includes("skillflow:gatekeeper id=router"),
    "the flow's gatekeeper annotation removed with it",
  );
  assert.ok(!result.skillMd.includes("### Route the input"), "gatekeeper section removed");
  assert.ok(result.skillMd.includes("## Wrap up"), "outside section preserved");
  assert.ok(
    result.skillMd.includes("See /run when done."),
    "dangling cross-flow reference preserved verbatim",
  );

  const reprojected = projectSkillGraph(result.skillMd, []);
  assert.ok(!reprojected.nodes.some((n) => n.id === "router"), "gatekeeper gone from the graph");
  assert.ok(!reprojected.nodes.some((n) => n.kind === "entry_point"), "no command entry left");
});

// --- (E) set_keywords: frontmatter block spliced surgically ---------------------------------------

test("set_keywords updates an existing keywords block, preserving surrounding frontmatter byte-exactly", () => {
  const fixture = loadFixture("multi-command");
  const result = applyAndProve(
    fixture,
    [{ op: "set_keywords", keywords: ["quarterly review"] }],
    [anchorSpan(fixture.graph, "keyword-analyze-data")],
  );
  assert.equal(result.warnings.length, 0);
  const lines = result.skillMd.split("\n");
  // Unrelated frontmatter lines are identical.
  assert.equal(lines[0], "---");
  assert.equal(lines[1], "name: multi-command");
  assert.ok(
    lines[2]?.startsWith("description: A skill exposing two slash commands"),
    "description untouched",
  );
  assert.equal(lines[3], "keywords:");
  assert.equal(lines[4], "  - quarterly review");
  assert.equal(lines[5], "---", "closing frontmatter delimiter still directly after the block");
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(reprojected.nodes.some((n) => n.trigger?.value === "quarterly review"));
  assert.ok(!reprojected.nodes.some((n) => n.trigger?.value === "daily report"));
});

test("set_keywords inserts a keywords block into frontmatter that has none, keeping unrelated keys", () => {
  const fixture = loadFixture("github-style");
  const result = applyAndProve(
    fixture,
    [{ op: "set_keywords", keywords: ["status digest", "issue triage"] }],
    [],
  );
  assert.equal(result.warnings.length, 0);
  // Every unrelated key survives verbatim (name/description/license/metadata.*).
  for (const key of [
    "name: github-style",
    "license: MIT",
    "metadata:",
    "  author: example-org",
    '  version: "0.3.0"',
  ]) {
    assert.ok(result.skillMd.includes(key), `unrelated frontmatter "${key}" preserved`);
  }
  assert.ok(
    result.skillMd.includes("keywords:\n  - status digest\n  - issue triage"),
    "keywords block inserted",
  );
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    reprojected.nodes.some((n) => n.trigger?.value === "status digest"),
    "keyword entry projected",
  );
});

test("set_keywords creates a minimal frontmatter block when the document has none", () => {
  const fixture = fromString("# Title\n\nHello there.\n");
  const result = applyAndProve(fixture, [{ op: "set_keywords", keywords: ["ad hoc"] }], []);
  assert.equal(result.warnings.length, 0);
  assert.ok(
    result.skillMd.startsWith("---\nkeywords:\n  - ad hoc\n---\n"),
    "frontmatter minted at byte 0",
  );
  assert.ok(
    result.skillMd.endsWith("# Title\n\nHello there.\n"),
    "original body preserved verbatim",
  );
  const reprojected = projectSkillGraph(result.skillMd, []);
  assert.ok(reprojected.nodes.some((n) => n.trigger?.value === "ad hoc"));
});

test("set_keywords on the regression-locked zero-annotation fixture is an additive delta (only keyword entries added)", () => {
  const fixture = loadFixture("zero-annotation");
  const before = projectSkillGraph(fixture.skillMd, fixture.files);
  const result = applyAndProve(fixture, [{ op: "set_keywords", keywords: ["make report"] }], []);
  assert.equal(result.warnings.length, 0);
  const after = projectSkillGraph(result.skillMd, fixture.files);
  // Every pre-existing (non-entry_point) node is unchanged in id + kind.
  const beforeNonEntry = before.nodes
    .filter((n) => n.kind !== "entry_point")
    .map((n) => `${n.id}:${n.kind}`)
    .sort();
  const afterNonEntry = after.nodes
    .filter((n) => n.kind !== "entry_point")
    .map((n) => `${n.id}:${n.kind}`)
    .sort();
  assert.deepEqual(
    afterNonEntry,
    beforeNonEntry,
    "structure nodes untouched by the additive keyword delta",
  );
  assert.equal(
    before.nodes.filter((n) => n.kind === "entry_point").length,
    0,
    "fixture had no entry points",
  );
  assert.ok(
    after.nodes.some((n) => n.trigger?.value === "make report"),
    "the one new keyword entry appears",
  );
  // Frontmatter body is byte-preserved outside the inserted keywords block.
  assert.ok(result.skillMd.includes("name: data-report"), "name key preserved");
  assert.ok(result.skillMd.includes("## Gather inputs"), "document body untouched");
});

// --- (F) connect_asset aliases add_asset_ref; disconnect_asset guards against guessing -------------

test("connect_asset produces byte-identical output to add_asset_ref on the same target", () => {
  const fixture = loadFixture("multi-command");
  const args = {
    nodeId: "run-the-checks",
    path: "reference/spec.md",
    sentence: "Also read `reference/spec.md`.",
  };
  const viaAdd = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, [
    { op: "add_asset_ref", ...args },
  ]);
  const viaConnect = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, [
    { op: "connect_asset", ...args },
  ]);
  assert.equal(
    viaConnect.skillMd,
    viaAdd.skillMd,
    "connect_asset is a pure alias of add_asset_ref",
  );
  assert.deepEqual(viaConnect.edits, viaAdd.edits);
});

test("disconnect_asset removes the single referencing line and the reference disappears from the graph", () => {
  const fixture = loadFixture("multi-command");
  const before = fixture.graph.edges.some(
    (e) =>
      e.from === "load-the-input" &&
      fixture.graph.nodes.find((n) => n.id === e.to)?.path === "reference/spec.md",
  );
  assert.ok(before, "fixture wires load-the-input → spec.md");
  const result = applyAndProve(
    fixture,
    [{ op: "disconnect_asset", nodeId: "load-the-input", path: "reference/spec.md" }],
    [anchorSpan(fixture.graph, "load-the-input")],
  );
  assert.equal(result.warnings.length, 0);
  assert.ok(!result.skillMd.includes("reference/spec.md"), "the only reference line was removed");
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    !reprojected.nodes.some((n) => n.path === "reference/spec.md"),
    "asset node no longer projected",
  );
});

test("disconnect_asset warns and skips when the path is referenced on two lines (never guesses)", () => {
  const md = [
    "---",
    "name: multi-ref",
    "---",
    "",
    "# Multi Ref",
    "",
    "## Step",
    "",
    "First read `reference/spec.md` carefully.",
    "Then re-read `reference/spec.md` once more before continuing.",
    "",
  ].join("\n");
  const fixture = fromString(md, [
    {
      path: "reference/spec.md",
      size: 1,
      isBinary: false,
      isSkillMd: false,
      kind: "reference",
      tokenTotal: 0,
    },
  ]);
  const result = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, [
    { op: "disconnect_asset", nodeId: "step", path: "reference/spec.md" },
  ]);
  assert.equal(result.skillMd, md, "document untouched — no guessing which line to cut");
  assert.equal(result.edits.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /referenced on 2 lines/);
});

test("zero WP 2.1 ops → the exact same string (===)", () => {
  const fixture = loadFixture("multi-command");
  const result = applyEditOps(fixture.skillMd, fixture.files, fixture.graph, []);
  assert.equal(result.skillMd === fixture.skillMd, true);
  assert.deepEqual(result.edits, []);
});

// --- (F2) Skill IDE WP 8.3 — add_tool_ref: append a reference sentence that re-projects as a tool_ref -

test("add_tool_ref appends the default `Call \\`<tool>\\`.` sentence, byte-exact, and re-projects as a tool_ref node", () => {
  const fixture = loadFixture("multi-command");
  // Precondition: this fixture references NO MCP tools (its backticked spans are file paths, which the
  // conservative heuristic never treats as tool names), so any tool_ref after the edit is ours alone.
  assert.equal(
    fixture.graph.nodes.filter((n) => n.kind === "tool_ref").length,
    0,
    "fixture starts with zero tool references",
  );

  // A pure body-append (deleteCount 0) — allow NO deletion spans; the byte-exactness harness proves
  // every original line is preserved verbatim.
  const result = applyAndProve(
    fixture,
    [{ op: "add_tool_ref", nodeId: "run-the-checks", server: "analytics", tool: "list_items" }],
    [],
  );
  assert.equal(result.warnings.length, 0, `no warnings expected: ${result.warnings.join(" | ")}`);
  assert.ok(
    result.skillMd.includes("Call `list_items`."),
    "the default reference sentence was appended",
  );
  // Exactly ONE new sentence — the only diff vs the original is that single appended paragraph.
  assert.equal(
    result.skillMd.split("Call `list_items`.").length - 1,
    1,
    "the reference sentence appears exactly once",
  );

  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  const toolRefs = reprojected.nodes.filter((n) => n.kind === "tool_ref");
  assert.equal(toolRefs.length, 1, "exactly one tool_ref node projects from the appended sentence");
  assert.equal(
    toolRefs[0]?.kind === "tool_ref" ? toolRefs[0].toolName : undefined,
    "list_items",
    "the tool_ref carries the referenced tool name",
  );
  // The projector wires a `calls` edge from the referencing section to the new tool_ref leaf.
  const refId = toolRefs[0]!.id;
  assert.ok(
    reprojected.edges.some((e) => e.from === "run-the-checks" && e.to === refId),
    "a calls edge links the section to the tool_ref",
  );
});

test("add_tool_ref honors a custom sentence override (still re-projects the tool_ref)", () => {
  const fixture = loadFixture("multi-command");
  const result = applyAndProve(
    fixture,
    [
      {
        op: "add_tool_ref",
        nodeId: "run-the-checks",
        server: "analytics",
        tool: "list_items",
        sentence: "When counts look wrong, call `list_items` to cross-check the source rows.",
      },
    ],
    [],
  );
  assert.equal(result.warnings.length, 0);
  assert.ok(
    result.skillMd.includes(
      "When counts look wrong, call `list_items` to cross-check the source rows.",
    ),
    "the caller's sentence was used verbatim",
  );
  assert.ok(!result.skillMd.includes("Call `list_items`."), "the default sentence was NOT used");
  const reprojected = projectSkillGraph(result.skillMd, fixture.files);
  assert.ok(
    reprojected.nodes.some((n) => n.kind === "tool_ref" && n.toolName === "list_items"),
    "the overridden sentence still projects a tool_ref (it carries a call context word + backtick ref)",
  );
});

test("validateEditOps: add_tool_ref on a section is applicable; on an accessory node it errors (stub is gone)", () => {
  const fixture = loadFixture("multi-command");
  // On a heading-anchored section → no errors (the WP 8.1 "not yet implemented" 400-stub is removed).
  assert.deepEqual(
    validateEditOps(
      fixture.graph,
      [{ op: "add_tool_ref", nodeId: "run-the-checks", server: "analytics", tool: "list_items" }],
      fixture.files,
    ),
    [],
    "add_tool_ref on a section validates clean",
  );
  // On an accessory (asset) node → the same "not a section" rejection add_asset_ref/connect_asset give.
  const errors = validateEditOps(
    fixture.graph,
    [{ op: "add_tool_ref", nodeId: "asset-spec-md", server: "analytics", tool: "list_items" }],
    fixture.files,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /not a section/i);
});

// --- (G) Route tests: validation → 400, and a real new immutable version -------------------------

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
    `skill-ide-roundtrip-test-${Math.random().toString(36).slice(2)}`,
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

const BOUNDARY = "----skillIdeRoundtripBoundary";

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

function postEdits(app: FastifyInstance, skillId: string, versionId: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${versionId}/edits`,
    payload: body as Record<string, unknown>,
  });
}

async function baseTreeSha(app: FastifyInstance, skillId: string, vid: string): Promise<string> {
  const v = (await app.inject({ url: `/api/skills/${skillId}/versions/${vid}` })).json();
  return v.treeSha as string;
}

test("route: duplicate /command token → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "multi-command");
  const vid = skill.currentVersionId;
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await baseTreeSha(app, skill.id, vid),
    ops: [{ op: "add_command", command: "/analyze", title: "again" }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /already exists/i);
});

test("route: delete_command + an op inside its flow → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "multi-command");
  const vid = skill.currentVersionId;
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await baseTreeSha(app, skill.id, vid),
    ops: [
      { op: "delete_command", nodeId: "analyze" },
      { op: "connect_asset", nodeId: "run-the-checks", path: "reference/spec.md" },
    ],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /cannot be combined/i);
});

test("route: connect_asset targeting a non-section (accessory) node → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "multi-command");
  const vid = skill.currentVersionId;
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await baseTreeSha(app, skill.id, vid),
    ops: [{ op: "connect_asset", nodeId: "asset-spec-md", path: "reference/spec.md" }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /not a section/i);
});

test("route: add_tool_ref on a section → a real new version whose SKILL.md re-projects the tool_ref", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "multi-command");
  const vid = skill.currentVersionId;
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await baseTreeSha(app, skill.id, vid),
    ops: [
      { op: "add_tool_ref", nodeId: "run-the-checks", server: "analytics", tool: "list_items" },
    ],
    note: "reference list_items",
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.version.seq, 2, "a real version 2 exists");
  assert.deepEqual(body.warnings, []);
  const v2md = repo.getFileContent(body.version.id, "SKILL.md");
  assert.ok(
    !v2md.isBinary && v2md.text.includes("Call `list_items`."),
    "reference sentence persisted",
  );
  const reprojected = projectSkillGraph(v2md.isBinary ? "" : v2md.text, []);
  assert.ok(
    reprojected.nodes.some((n) => n.kind === "tool_ref" && n.toolName === "list_items"),
    "the persisted version re-projects the tool_ref",
  );
});

test("route: add_tool_ref targeting a non-section (accessory) node → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "multi-command");
  const vid = skill.currentVersionId;
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await baseTreeSha(app, skill.id, vid),
    ops: [{ op: "add_tool_ref", nodeId: "asset-spec-md", server: "analytics", tool: "list_items" }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /not a section/i);
});

test("route: a WP 2.1 batch produces a real new version 2, other files byte-identical", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "multi-command");
  const vid = skill.currentVersionId;
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await baseTreeSha(app, skill.id, vid),
    ops: [
      { op: "rename_command", nodeId: "report-daily", command: "/summary" },
      { op: "set_keywords", keywords: ["quarterly review"] },
    ],
    note: "rename + keywords",
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.version.seq, 2, "a real version 2 exists");
  assert.equal(body.version.sourceRef, "skillflow-edit");
  assert.deepEqual(body.warnings, []);

  const v2md = repo.getFileContent(body.version.id, "SKILL.md");
  assert.ok(!v2md.isBinary && v2md.text.includes("## /summary daily"), "renamed command persisted");
  assert.ok(!v2md.isBinary && v2md.text.includes("  - quarterly review"), "keywords persisted");

  // Every non-SKILL.md file carried over byte-identical (same content-addressed blob sha).
  const fromMap = repo.getDiffFileMap(vid);
  const toMap = repo.getDiffFileMap(body.version.id);
  assert.equal(toMap.size, fromMap.size, "same file count");
  for (const [p, file] of fromMap) {
    if (p === "SKILL.md") continue;
    assert.equal(toMap.get(p)?.blobSha, file.blobSha, `${p} blob sha unchanged`);
  }
  assert.notEqual(toMap.get("SKILL.md")?.blobSha, fromMap.get("SKILL.md")?.blobSha);
});
