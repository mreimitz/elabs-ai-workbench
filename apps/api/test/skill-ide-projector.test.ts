import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SKILL_FLOW_ID,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphEdge,
  type SkillGraphNode,
  skillGraphSchema,
} from "@mcp-token-footprint/shared";
import { projectSkillGraph } from "../src/skillflow/projector.js";

const toolRefNodes = (graph: SkillGraph) =>
  graph.nodes.filter(
    (node): node is Extract<SkillGraphNode, { kind: "tool_ref" }> => node.kind === "tool_ref",
  );

// Skill IDE WP 1.2 — projector v2 (per-command entry points, per-entry flows, keyword triggers,
// cross-flow references) + the zero-command regression lock. The pre-plan (v1) SkillFlow behavior
// is covered by `skillflow-projector.test.ts`; this file asserts only the additive flow semantics.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

// --- Fixture loading (mirrors SkillRepository's classification, as in skillflow-projector.test) ---

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

const entryPoints = (graph: SkillGraph) =>
  graph.nodes.filter(
    (node): node is Extract<SkillGraphNode, { kind: "entry_point" }> => node.kind === "entry_point",
  );

const flowIdOf = (n: SkillGraphNode | SkillGraphEdge) => n.flowId ?? DEFAULT_SKILL_FLOW_ID;

// --- (a) command + keyword entry points ---------------------------------------------------------

test("multi-command fixture projects 2 command entry points + 2 keyword entry points", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);

  const entries = entryPoints(graph);
  const commands = entries.filter((e) => e.trigger.type === "command");
  const keywords = entries.filter((e) => e.trigger.type === "keyword");

  assert.equal(commands.length, 2, "two /command entry points");
  assert.equal(keywords.length, 2, "two keyword entry points");

  // `/report daily` → trigger value is the first token; label is the full heading text.
  const report = commands.find((c) => c.trigger.value === "/report");
  assert.ok(report, "the /report command exists (value = first token)");
  assert.equal(report?.label, "/report daily", "label is the full heading text");

  const analyze = commands.find((c) => c.trigger.value === "/analyze");
  assert.ok(analyze, "the /analyze command exists");

  // Keyword entry points carry the frontmatter keyword phrases and live on the main flow.
  assert.deepEqual(
    keywords.map((k) => k.trigger.value).sort(),
    ["analyze data", "daily report"],
    "keyword values come from frontmatter keywords:",
  );
  for (const kw of keywords)
    assert.equal(flowIdOf(kw), DEFAULT_SKILL_FLOW_ID, "keyword entries are on the main flow");

  // Each keyword entry edges to the first main-flow node (the skill body head).
  const firstMain = graph.nodes.find((n) => flowIdOf(n) === DEFAULT_SKILL_FLOW_ID);
  assert.ok(firstMain, "there is a main-flow body node");
  for (const kw of keywords) {
    assert.ok(
      graph.edges.some((e) => e.from === kw.id && e.to === firstMain?.id),
      `keyword ${kw.trigger.value} edges to the first main node`,
    );
  }

  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

// --- (b) disjoint flows for the two command sections --------------------------------------------

test("the two command sections project into disjoint flows (every derived node/edge tagged)", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);

  const analyze = entryPoints(graph).find((e) => e.trigger.value === "/analyze");
  const report = entryPoints(graph).find((e) => e.trigger.value === "/report");
  assert.ok(analyze && report);

  // A flow's id is its entry node id — so the two command flows are disjoint by construction.
  assert.notEqual(analyze?.id, report?.id);
  assert.equal(
    flowIdOf(analyze as SkillGraphNode),
    analyze?.id,
    "entry node belongs to its own flow",
  );

  // Every node in a command flow carries that entry's id, and the two node sets never overlap.
  const analyzeNodes = graph.nodes.filter((n) => flowIdOf(n) === analyze?.id).map((n) => n.id);
  const reportNodes = graph.nodes.filter((n) => flowIdOf(n) === report?.id).map((n) => n.id);
  assert.ok(
    analyzeNodes.length >= 3,
    "analyze flow has the entry + its subtree (heading, subsections, refs)",
  );
  assert.ok(reportNodes.length >= 2, "report flow has the entry + its subtree");
  assert.equal(
    analyzeNodes.filter((id) => reportNodes.includes(id)).length,
    0,
    "the flows are disjoint",
  );

  // Intra-flow edges stay inside their flow (only the cross-flow ref edge below leaves a flow).
  const analyzeInternal = graph.edges.filter(
    (e) => analyzeNodes.includes(e.from) && analyzeNodes.includes(e.to),
  );
  for (const e of analyzeInternal) assert.equal(flowIdOf(e), analyze?.id);

  // The entry node points at its flow's content (an entry with a non-empty section is not terminal).
  assert.ok(
    graph.edges.some((e) => e.from === analyze?.id),
    "analyze entry points to its first content node",
  );
  assert.ok(
    graph.edges.some((e) => e.from === report?.id),
    "report entry points to its first content node",
  );
});

// --- (c) flows[] with correct ids + entryNodeIds ------------------------------------------------

test("flows[] lists main first, then one flow per command entry (label = trigger value)", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);

  assert.ok(graph.flows, "flows populated");
  const flows = graph.flows ?? [];
  assert.equal(flows[0]?.id, DEFAULT_SKILL_FLOW_ID, "main flow is first");
  assert.equal(flows[0]?.label, "Main flow");
  assert.equal(flows[0]?.entryNodeId, undefined, "the body flow has no entry node");

  const analyze = entryPoints(graph).find((e) => e.trigger.value === "/analyze");
  const report = entryPoints(graph).find((e) => e.trigger.value === "/report");

  const analyzeFlow = flows.find((f) => f.entryNodeId === analyze?.id);
  const reportFlow = flows.find((f) => f.entryNodeId === report?.id);
  assert.ok(analyzeFlow && reportFlow, "one flow per command entry, keyed by entryNodeId");
  assert.equal(analyzeFlow?.label, "/analyze", "flow label is the trigger value");
  assert.equal(reportFlow?.label, "/report", "flow label is the trigger value (first token)");
  assert.equal(flows.length, 3, "main + two command flows");

  // Every flow referenced by a node exists in flows[] (no dangling flow ids).
  const flowIds = new Set(flows.map((f) => f.id));
  for (const node of graph.nodes)
    assert.ok(flowIds.has(flowIdOf(node)), `node ${node.id} flow is declared`);
});

// --- (d) cross-flow reference → edge + warning --------------------------------------------------

test("a 'see /analyze' reference in the report flow projects a cross-flow edge + warning", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);

  const analyze = entryPoints(graph).find((e) => e.trigger.value === "/analyze");
  assert.ok(analyze);

  // An edge from a report-flow node into the analyze entry node, tagged with the SOURCE flow.
  const crossEdge = graph.edges.find((e) => e.to === analyze?.id && flowIdOf(e) === "report-daily");
  assert.ok(crossEdge, "a cross-flow edge lands on the /analyze entry node");
  const fromNode = graph.nodes.find((n) => n.id === crossEdge?.from);
  assert.equal(
    flowIdOf(fromNode as SkillGraphNode),
    "report-daily",
    "the edge originates in the report flow",
  );

  assert.ok(
    graph.warnings.some((w) => w.startsWith("cross-flow reference:") && w.includes("/analyze")),
    "a 'cross-flow reference' warning is emitted",
  );
});

// --- (e) annotation-pinned command id is stable across reorder ----------------------------------

test("a skillflow:command annotation pins the entry id, stable across reordering the commands", () => {
  const analyzeBlock = [
    "<!-- skillflow:command id=cmd-analyze -->",
    "## /analyze",
    "",
    "Run the analysis over the export.",
    "",
  ].join("\n");
  const reportBlock = ["## /report", "", "Produce the report from the analyzed data.", ""].join(
    "\n",
  );

  const build = (first: string, second: string) =>
    [
      "---",
      "name: reorder",
      "description: A fixture used to test id stability under reorder.",
      "---",
      "",
      "# Reorder",
      "",
      "Intro body.",
      "",
      first,
      second,
    ].join("\n");

  const graphA = projectSkillGraph(build(analyzeBlock, reportBlock), []);
  const graphB = projectSkillGraph(build(reportBlock, analyzeBlock), []);

  for (const graph of [graphA, graphB]) {
    const pinned = graph.nodes.find((n) => n.id === "cmd-analyze");
    assert.ok(pinned, "the annotated entry keeps its pinned id 'cmd-analyze'");
    assert.equal(pinned?.kind, "entry_point");
    assert.equal(
      pinned?.source,
      "annotated",
      "a skillflow:command annotation marks the node annotated",
    );
    assert.ok(pinned?.kind === "entry_point" && pinned.trigger.value === "/analyze");
    // The pinned id also names its flow, regardless of document position.
    assert.equal(flowIdOf(pinned as SkillGraphNode), "cmd-analyze");
    assert.ok((graph.flows ?? []).some((f) => f.entryNodeId === "cmd-analyze"));
  }
});

// --- (f) determinism ----------------------------------------------------------------------------

test("multi-command projection is deterministic (same input → deep-equal graph)", () => {
  const { skillMd, files } = loadFixture("multi-command");
  assert.deepEqual(projectSkillGraph(skillMd, files), projectSkillGraph(skillMd, files));
});

// --- (g) anchors valid --------------------------------------------------------------------------

test("every multi-command node is anchored (startLine ≤ endLine; heading nodes name their heading)", () => {
  const { skillMd, files, raw } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);

  for (const node of graph.nodes) {
    assert.ok(node.anchor.startLine <= node.anchor.endLine, `${node.id}: startLine ≤ endLine`);
    assert.ok(node.anchor.startLine >= 1, `${node.id}: startLine within file`);
    // Keyword entry points anchor to the frontmatter block (no heading path); heading-derived nodes
    // must have their heading text on the anchored line.
    const isKeyword = node.kind === "entry_point" && node.trigger.type === "keyword";
    if (isKeyword) {
      assert.deepEqual(node.anchor.headingPath, [], "keyword entries carry no heading path");
      continue;
    }
    assert.ok(node.anchor.headingPath.length > 0, `${node.id}: non-empty heading path`);
    const headingText = node.anchor.headingPath[node.anchor.headingPath.length - 1] ?? "";
    const rawLine = raw[node.anchor.startLine - 1] ?? "";
    assert.ok(
      rawLine.includes(headingText),
      `${node.id}: line ${node.anchor.startLine} contains "${headingText}"`,
    );
  }

  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

// --- (h) zero-command regression lock -----------------------------------------------------------
//
// The flow-compatibility lock (conventions.md): a zero-command skill must project IDENTICALLY to its
// pre-plan (v2/pre-IDE) graph, modulo the DOCUMENTED additive delta ONLY:
//   1. every node gains `flowId: 'main'`,
//   2. every edge gains `flowId: 'main'`,
//   3. the graph gains `flows: [{ id: 'main', label: 'Main flow' }]`,
//   4. keyword entry points appear IFF the frontmatter carries `keywords:` (zero-annotation has none).
// The comparison is implemented (not asserted by eye): we strip the additive fields from the v3
// output and deep-compare against a frozen snapshot of the pre-plan projection captured from the base
// projector. The snapshot lives at fixtures/skillflow/zero-annotation.v2-graph.json.

// RM-30 WP 7.8 SUPERSEDES the "modulo the additive delta" form of this lock, and does so
// deliberately rather than by accident. Two of that work package's three projector changes are NOT
// additive — duplicate file/tool boxes merge (node ids move) and narrative prose stops becoming a
// branch label (edges disappear) — which is exactly why `SKILLFLOW_PROJECTOR_VERSION` went to 5.
//
// So the lock now compares the FULL v5 projection against a frozen v5 snapshot (a stronger lock: no
// field is stripped before comparing), and the v2 snapshot keeps its own, narrower job below — proving
// a graph serialized before WP 7.8, with no `kind` on any edge, still parses.
//
// What moved between the two snapshots, and why, is asserted explicitly further down rather than left
// to a reader diffing two JSON files.

test("zero-command lock: zero-annotation projects the frozen v5 graph, byte for byte", () => {
  const { skillMd, files } = loadFixture("zero-annotation");
  const graph = projectSkillGraph(skillMd, files);

  // Every node/edge is on the main flow (no command/keyword sections here).
  for (const node of graph.nodes)
    assert.equal(node.flowId, DEFAULT_SKILL_FLOW_ID, `node ${node.id} on main flow`);
  for (const edge of graph.edges)
    assert.equal(edge.flowId, DEFAULT_SKILL_FLOW_ID, `edge ${edge.id} on main flow`);

  // Exactly the single main flow (no command flows).
  assert.deepEqual(graph.flows, [{ id: DEFAULT_SKILL_FLOW_ID, label: "Main flow" }]);

  // No keyword entry points (zero-annotation frontmatter has no keywords:).
  assert.equal(entryPoints(graph).length, 0, "no entry-point nodes for a zero-command skill");

  const snapshot = JSON.parse(
    readFileSync(path.join(here, "fixtures/skillflow/zero-annotation.v5-graph.json"), "utf8"),
  );
  assert.deepEqual(graph, snapshot, "current projection === frozen v5 snapshot");
});

test("a pre-WP-7.8 graph — no edge `kind` anywhere — still parses (the additive proof)", () => {
  const v2 = JSON.parse(
    readFileSync(path.join(here, "fixtures/skillflow/zero-annotation.v2-graph.json"), "utf8"),
  ) as { edges: SkillGraphEdge[] };

  // The fixture is genuinely pre-grammar — if someone ever regenerates it WITH kinds, this test would
  // silently stop proving anything, so assert the premise before the conclusion.
  assert.ok(v2.edges.length > 0, "the pre-WP-7.8 fixture actually carries edges");
  for (const edge of v2.edges) {
    assert.equal(edge.kind, undefined, `pre-WP-7.8 edge ${edge.id} carries no kind`);
  }

  const parsed = skillGraphSchema.parse(v2);
  assert.equal(parsed.edges.length, v2.edges.length, "every kindless edge survived parsing");
  for (const edge of parsed.edges)
    assert.equal(edge.kind, undefined, "kind stays absent, not zeroed");
});

test("the v2 → v5 delta on zero-annotation is exactly the three documented changes", () => {
  const v2 = JSON.parse(
    readFileSync(path.join(here, "fixtures/skillflow/zero-annotation.v2-graph.json"), "utf8"),
  ) as { nodes: SkillGraphNode[]; edges: SkillGraphEdge[]; warnings: string[] };
  const { skillMd, files } = loadFixture("zero-annotation");
  const v5 = projectSkillGraph(skillMd, files);

  // (1) Every edge is now kinded. (Nothing else about an edge changed shape.)
  for (const edge of v5.edges) assert.ok(edge.kind, `edge ${edge.id} carries a kind`);

  // (2) The two spurious CONDITION edges are gone — "If the input is CSV … Otherwise if JSON …" is an
  //     intra-step rule, not routing, and it used to draw a fork that pointed both arms at the SAME
  //     next section. One plain `then` edge replaces them, and the apologetic warning goes with them.
  assert.equal(v2.edges.filter((e) => e.condition !== undefined).length, 2, "v2 had two");
  assert.equal(v5.edges.filter((e) => e.condition !== undefined).length, 0, "v5 has none");
  assert.equal(v2.warnings.length, 1, "v2 warned it could not resolve them");
  assert.deepEqual(v5.warnings, [], "v5 has nothing to apologise for");
  assert.equal(v5.edges.length, v2.edges.length - 1, "exactly one edge fewer");

  // (3) Node identity is UNCHANGED for this fixture — it cites each file from exactly one section, so
  //     the box merge has nothing to merge here. (The merge itself is proved on its own fixture below.)
  assert.deepEqual(
    v5.nodes.map((n) => n.id),
    v2.nodes.map((n) => n.id),
    "no node id moved on this fixture",
  );
});

// --- (i) tool_ref projection (Skill IDE WP 8.1 / I9.2) ------------------------------------------
//
// The multi-command fixture EXTENDED (in-memory) with TWO backticked tool references — one in each
// command flow — must project two accessory `tool_ref` leaf nodes + `calls` edges from the owning
// section, from TEXT EVIDENCE alone. The shared fixture FILE is left untouched (so the roundtrip /
// quality / aligner suites that consume it keep seeing tool-ref-free graphs — the zero-reference
// regression lock below); the extension lives here.

/** The multi-command fixture with a backticked tool reference injected into each command's intro. */
function extendedMultiCommand(): { skillMd: string; files: SkillFileNode[] } {
  const { skillMd, files } = loadFixture("multi-command");
  const ext = skillMd
    .replace(
      "Run the analysis pipeline over the user's export and surface the key findings.",
      "Run the analysis pipeline over the user's export and surface the key findings.\nFirst call the `list_datasets` tool to enumerate the available exports.",
    )
    .replace(
      "Produce the formatted daily report from an already-analyzed dataset.",
      "Produce the formatted daily report from an already-analyzed dataset.\nUse the `render_report` tool to format the summary.",
    );
  assert.notEqual(ext, skillMd, "the fixture was actually extended with two references");
  return { skillMd: ext, files };
}

test("extended multi-command projects two tool_ref accessory nodes with the right toolName + owner", () => {
  const { skillMd, files } = extendedMultiCommand();
  const graph = projectSkillGraph(skillMd, files);

  const refs = toolRefNodes(graph);
  assert.equal(refs.length, 2, "exactly two tool_ref nodes (one per injected reference)");

  // toolName is the citation verbatim; serverName is NEVER set by the projector (text evidence only).
  assert.deepEqual(refs.map((r) => r.toolName).sort(), ["list_datasets", "render_report"]);
  for (const ref of refs) {
    assert.equal(ref.serverName, undefined, "the projector never binds a server (overlay's job)");
    assert.equal(ref.source, "inferred", "text-projected → inferred");
    assert.equal(ref.label, ref.toolName, "label mirrors the cited tool name");
  }

  // Each tool_ref is cited by a `calls` edge FROM its owning command's flow; the node carries that flow.
  const analyze = entryPoints(graph).find((e) => e.trigger.value === "/analyze")!;
  const report = entryPoints(graph).find((e) => e.trigger.value === "/report")!;
  const listRef = refs.find((r) => r.toolName === "list_datasets")!;
  const renderRef = refs.find((r) => r.toolName === "render_report")!;

  assert.ok(
    graph.edges.some((e) => e.from === analyze.id && e.to === listRef.id),
    "a calls edge runs from the /analyze entry to its list_datasets reference",
  );
  assert.ok(
    graph.edges.some((e) => e.from === report.id && e.to === renderRef.id),
    "a calls edge runs from the /report entry to its render_report reference",
  );
  assert.equal(flowIdOf(listRef), analyze.id, "the tool_ref inherits its owner's flow");
  assert.equal(flowIdOf(renderRef), report.id, "the tool_ref inherits its owner's flow");

  // RM-30 WP 7.8 — the id is pinned by tool NAME alone. It used to carry the citation's line number
  // (`…-l12`), which was right when a box existed per MENTION and wrong now that one box serves every
  // mention of the same tool.
  for (const ref of refs) {
    assert.equal(ref.id, `tool-ref-${ref.toolName.replace(/_/g, "-")}`, "id pinned by tool name");
  }

  assert.doesNotThrow(() => skillGraphSchema.parse(graph));
});

test("tool_ref nodes are leaf ACCESSORIES the side-column layout picks up with ZERO layout changes", () => {
  // The hand-rolled layout (graph-layout.ts) places any node with NO outgoing edge (and not
  // section-like) as an accessory in a side column at its OWNER's row. A tool_ref is exactly that —
  // a leaf with a single incoming `calls` edge from a section — so it needs NO layout change. We prove
  // the graph-level invariants the layout keys on (unchanged file) + that positions are DETERMINISTIC.
  const { skillMd, files } = extendedMultiCommand();
  const graph = projectSkillGraph(skillMd, files);
  const idToNode = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const ref of toolRefNodes(graph)) {
    assert.equal(
      graph.edges.filter((e) => e.from === ref.id).length,
      0,
      "tool_ref is a leaf (no outgoing edges)",
    );
    const incoming = graph.edges.filter((e) => e.to === ref.id);
    assert.equal(incoming.length, 1, "exactly one incoming calls edge (its owner)");
    const owner = idToNode.get(incoming[0]!.from)!;
    assert.notEqual(owner.kind, "tool_ref", "the owner is a real section, not another tool_ref");
  }

  // Determinism: same input → deep-equal graph (so the pure layout yields STABLE positions).
  assert.deepEqual(
    projectSkillGraph(skillMd, files),
    graph,
    "projection is deterministic (stable node positions)",
  );
});

// --- (j) zero-reference regression lock ---------------------------------------------------------
//
// Every fixture ships WITH NO tool references (verified: none carry a backticked snake/kebab/namespaced
// identifier), so the tool_ref emission must add EXACTLY nothing to them — no tool_ref node, no calls
// edge. This is the additive-only guarantee for the projector v4 bump: a skill citing no tool projects
// identically to v3 (the zero-annotation frozen-snapshot lock above proves byte-identity for one).

test("zero-reference regression lock: no shipped fixture projects any tool_ref node or edge", () => {
  for (const name of [
    "annotated",
    "blank-scaffold",
    "github-style",
    "multi-command",
    "zero-annotation",
    "messy-quality",
  ]) {
    const { skillMd, files } = loadFixture(name);
    const graph = projectSkillGraph(skillMd, files);
    const refs = toolRefNodes(graph);
    assert.equal(refs.length, 0, `${name} must project zero tool_ref nodes`);
    const refIds = new Set(refs.map((r) => r.id));
    assert.equal(
      graph.edges.filter((e) => refIds.has(e.to)).length,
      0,
      `${name} must project zero calls edges`,
    );
  }
});

// --- (k) projector purity / never-scan (I9.2) --------------------------------------------------

test("purity: projector.ts + extract-tools.ts read FILE BYTES only (no scan / MCP / DB / network)", () => {
  for (const rel of ["../src/skillflow/projector.ts", "../src/skillflow/extract-tools.ts"]) {
    const source = readFileSync(path.resolve(here, rel), "utf8");
    for (const pattern of [
      /ScanRepository/,
      /openSession/,
      /callTool/,
      /child_process/,
      /better-sqlite3/,
      /from ["'][^"']*mcp\//,
      /\bfetch\(/,
    ]) {
      assert.ok(
        !pattern.test(source),
        `${rel} must not reference ${pattern} (I9.2 never-scan / purity)`,
      );
    }
  }
});
