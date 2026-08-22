import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  authorableEdgeRule,
  authorableTargetKinds,
  canAuthorEdgeFrom,
  entryPointIds,
  isLegalEdge,
  reachFromEntry,
  SKILL_EDGE_KINDS,
  SKILL_EDGE_RULES,
  SKILL_GRAPH_NODE_KINDS,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphNode,
} from "@mcp-token-footprint/shared";
import { extractConditions, projectSkillGraph } from "../src/skillflow/projector.js";

// RM-30 WP 7.8 — the edge grammar, the projector's conformance to it, the box merge, and the
// `extractConditions` tightening. The three teeth this file grows (no kindless edge · the measured
// mis-parse · one box per file) are the ones the WP asks to be broken and watched go red.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

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

function loadFixture(name: string): { skillMd: string; files: SkillFileNode[] } {
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
  return { skillMd: readFileSync(path.join(dir, "SKILL.md"), "utf8"), files };
}

const FIXTURES = ["zero-annotation", "annotated", "github-style", "multi-command", "messy-quality"];

/** Every fixture skill's graph, so a rule is asserted across the whole corpus, not one document. */
function everyFixtureGraph(): Array<{ name: string; graph: SkillGraph }> {
  return FIXTURES.map((name) => {
    const { skillMd, files } = loadFixture(name);
    return { name, graph: projectSkillGraph(skillMd, files) };
  });
}

// ── (1) The legality table is ONE definition ─────────────────────────────────────────────────────

test("the legal-pair table is one frozen definition with no second copy in the source tree", () => {
  // Structural: the exported array is frozen, so a consumer cannot mutate the shared rule set.
  assert.ok(Object.isFrozen(SKILL_EDGE_RULES), "SKILL_EDGE_RULES is frozen");
  assert.ok(SKILL_EDGE_RULES.length > 0, "the table is not empty");

  // No duplicate triple — a pair listed twice would let one copy drift from the other.
  const triples = SKILL_EDGE_RULES.map((r) => `${r.kind} ${r.from} ${r.to}`);
  assert.equal(new Set(triples).size, triples.length, "no duplicate (kind, from, to) triple");

  // Every rule names REAL node kinds and a REAL edge kind (no typo'd member sitting inert).
  for (const rule of SKILL_EDGE_RULES) {
    assert.ok(SKILL_EDGE_KINDS.includes(rule.kind), `${rule.kind} is a real edge kind`);
    assert.ok(SKILL_GRAPH_NODE_KINDS.includes(rule.from), `${rule.from} is a real node kind`);
    assert.ok(SKILL_GRAPH_NODE_KINDS.includes(rule.to), `${rule.to} is a real node kind`);
  }

  // A drag must resolve to at most ONE rule per pair, or the connect handler would have to guess.
  const authorablePairs = SKILL_EDGE_RULES.filter((r) => r.authorable).map(
    (r) => `${r.from} ${r.to}`,
  );
  assert.equal(
    new Set(authorablePairs).size,
    authorablePairs.length,
    "an authorable (from, to) pair maps to exactly one rule",
  );

  // THE no-second-copy check: nothing outside `packages/shared/src/skill-flow-grammar.ts` may declare
  // its own legality table. A second copy is the failure this repo has already been bitten by (two
  // byte-identical `buildRunFilterWhere` bodies, one silently unpinned), so it is gated, not trusted.
  const repoRoot = path.join(here, "../../..");
  const OWNER = path.join(repoRoot, "packages/shared/src/skill-flow-grammar.ts");
  assert.ok(statSync(OWNER).isFile(), "the owning module is where this check thinks it is");
  const offenders: string[] = [];
  let scanned = 0;
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith("."))
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (full === OWNER) continue;
      scanned += 1;
      const text = readFileSync(full, "utf8");
      // A second table would have to spell the rule out: an array of literal edge-kind strings paired
      // with node kinds. Catch the declaration form, not an import or a single comparison.
      if (/(?:SKILL_EDGE_RULES|EDGE_LEGALITY|LEGAL_EDGE(?:_PAIRS)?)\s*[:=]/.test(text)) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  for (const root of ["packages/shared/src", "apps/api/src", "apps/web/src"]) {
    scan(path.join(repoRoot, root));
  }
  // The scan must not pass vacuously — if the roots ever move, this goes red instead of going quiet.
  assert.ok(scanned > 500, `the source scan actually walked the tree (saw ${scanned} files)`);
  assert.deepEqual(offenders, [], "only skill-flow-grammar.ts declares the legality table");
});

test("authoring is a strict subset of legal, and a leaf may not start an edge", () => {
  // Exactly one authorable relationship exists today: a section drag onto a bundled file.
  assert.deepEqual(
    SKILL_EDGE_RULES.filter((r) => r.authorable)
      .map((r) => `${r.from}->${r.to}`)
      .sort(),
    ["gatekeeper->asset", "subroutine->asset", "validation_gate->asset"],
  );
  assert.equal(authorableEdgeRule("subroutine", "asset")?.kind, "uses");

  // A file or a tool points nowhere — that is what makes the drag simply not snap.
  assert.equal(canAuthorEdgeFrom("asset"), false);
  assert.equal(canAuthorEdgeFrom("tool_ref"), false);
  assert.deepEqual(authorableTargetKinds("asset"), []);
  assert.deepEqual([...authorableTargetKinds("subroutine")], ["asset"]);

  // A trigger may never be the target of a DRAG, even though the projector's cross-flow reference
  // lands on one (legal, not authorable — the deliberate deviation recorded in the module header).
  assert.equal(authorableEdgeRule("subroutine", "entry_point"), undefined);
  assert.equal(isLegalEdge("uses", "subroutine", "entry_point"), true);

  // Branch is defined but not authorable (design decision 6 — no affordance draws one by hand).
  assert.equal(isLegalEdge("branch", "gatekeeper", "subroutine"), true);
  assert.deepEqual(
    SKILL_EDGE_RULES.filter((r) => r.kind === "branch" && r.authorable),
    [],
  );
});

// ── (2) No edge the projector emits is kindless, and every one is legal ──────────────────────────

test("no edge the projector emits is kindless, and every one satisfies the legality table", () => {
  let checked = 0;
  for (const { name, graph } of everyFixtureGraph()) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
    assert.ok(graph.edges.length > 0, `${name} projects at least one edge`);
    for (const edge of graph.edges) {
      assert.ok(edge.kind, `${name}: edge ${edge.id} carries a kind`);
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      assert.ok(from && to, `${name}: edge ${edge.id} has both endpoints`);
      assert.ok(
        isLegalEdge(edge.kind, from.kind, to.kind),
        `${name}: ${edge.kind} ${from.kind} -> ${to.kind} (${edge.id}) is legal`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `a meaningful number of edges was checked (got ${checked})`);
});

test("a keyword entry triggers, a nested subsection is contained, and a /command starts its own", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const kindOf = (id: string) => byId.get(id)?.kind;

  const fromEntry = graph.edges.filter((e) => kindOf(e.from) === "entry_point");
  assert.ok(
    fromEntry.length > 0,
    "the fixture has command/keyword entry points with outgoing edges",
  );
  for (const edge of fromEntry) {
    // An entry point either STARTS a section, or REACHES FOR an accessory / another command.
    const expected = kindOf(edge.to) === "entry_point" ? "uses" : undefined;
    if (expected) assert.equal(edge.kind, expected);
    else assert.ok(edge.kind === "triggers" || edge.kind === "uses", `entry edge ${edge.id}`);
  }

  // Nesting under a body section is `contains`; every accessory link is `uses`.
  for (const edge of graph.edges) {
    const from = kindOf(edge.from);
    const to = kindOf(edge.to);
    if (to === "asset" || to === "tool_ref" || to === "loop_guard") {
      assert.equal(edge.kind, "uses", `accessory edge ${edge.id}`);
    }
    if (from === "subroutine" && to === "subroutine") {
      assert.ok(edge.kind === "then" || edge.kind === "contains", `section edge ${edge.id}`);
    }
  }
});

// ── (3) One box per file / per tool, many `uses` edges in ────────────────────────────────────────

const FOUR_CITATIONS = `---
name: four-citations
description: A skill whose four steps all read the same bundled file, used to prove the box merge.
---

# Four citations

## Step one

Read \`reference/spec.md\` and note the field list. Call the \`acme_search\` tool first.

## Step two

Re-read \`reference/spec.md\` for the optional fields.

## Step three

Consult \`reference/spec.md\` again before formatting. Call the \`acme_search\` tool once more.

## Step four

Check \`reference/spec.md\` one last time.
`;

const FOUR_CITATION_FILES: SkillFileNode[] = [
  { path: "SKILL.md", size: 1, isBinary: false, isSkillMd: true, kind: "skill_md", tokenTotal: 0 },
  {
    path: "reference/spec.md",
    size: 1,
    isBinary: false,
    isSkillMd: false,
    kind: "reference",
    tokenTotal: 0,
  },
];

test("a file cited from four steps yields ONE box and four `uses` edges", () => {
  const graph = projectSkillGraph(FOUR_CITATIONS, FOUR_CITATION_FILES);

  const assets = graph.nodes.filter(
    (n): n is Extract<SkillGraphNode, { kind: "asset" }> => n.kind === "asset",
  );
  assert.equal(assets.length, 1, "exactly one asset box for the one file");
  const box = assets[0] as Extract<SkillGraphNode, { kind: "asset" }>;
  assert.equal(box.path, "reference/spec.md");

  const into = graph.edges.filter((e) => e.to === box.id);
  assert.equal(into.length, 4, "four citing sections, four edges");
  for (const edge of into) assert.equal(edge.kind, "uses");
  assert.equal(new Set(into.map((e) => e.from)).size, 4, "one edge per distinct citing section");
});

test("a tool cited twice yields ONE box — its definition rides into context once, not twice", () => {
  const graph = projectSkillGraph(FOUR_CITATIONS, FOUR_CITATION_FILES);
  const tools = graph.nodes.filter((n) => n.kind === "tool_ref");
  assert.equal(tools.length, 1, "one box for `acme_search`, cited in two sections");
  assert.equal(tools[0]?.id, "tool-ref-acme-search", "id pinned by tool name, not by line");
  const into = graph.edges.filter((e) => e.to === tools[0]?.id);
  assert.equal(into.length, 2, "two citing sections, two `uses` edges");
  for (const edge of into) assert.equal(edge.kind, "uses");
});

// ── (4) extractConditions: the MEASURED mis-parse, as a named regression ─────────────────────────

// The exact sentence from the registered corpus (qlik-freeform-analyst) that the design doc's
// Evidence section measured. Under the OLD extractor these two ordinary sentences produced the whole
// corpus's ONLY "branch targets are not resolvable" warning — two condition labels on one edge,
// drawing a fork that does not fork. Nothing about it is a routing decision.
const MEASURED_MISPARSE =
  "Follow one finding into the next the way you would exploring a dashboard by hand. " +
  "If the answer is complete after one query, deliver it. If it takes twenty queries because one " +
  "finding kept leading somewhere else, that's fine too.";

test("regression (measured 2026-08-22): narrative prose is NOT a branch label", () => {
  assert.deepEqual(
    extractConditions(MEASURED_MISPARSE),
    [],
    "the corpus's only 'unresolvable branch' was a mis-parse and is now no branch at all",
  );

  // The two labels the OLD extractor produced, named so a regression is recognisable on sight.
  for (const ghost of [
    "the answer is complete after one query",
    "it takes twenty queries because one finding kept leading somewhere else",
  ]) {
    assert.ok(
      !extractConditions(MEASURED_MISPARSE).includes(ghost),
      `the old label "${ghost}" is gone`,
    );
  }
});

test("a real routing condition — one that names a destination — is still extracted", () => {
  assert.deepEqual(extractConditions("If the export is CSV, go to Step 2."), ["the export is CSV"]);
  assert.deepEqual(extractConditions("If the schema is clean, proceed to Phase 2 enrichment."), [
    "the schema is clean",
  ]);
  assert.deepEqual(extractConditions("If it fails, otherwise if it passes, skip to Report."), [
    "it fails",
    "it passes",
  ]);

  // Sentence-scoped: a later sentence's destination must not launder an earlier plain conditional.
  assert.deepEqual(
    extractConditions("If the row is empty, drop it. Then proceed to Step 2."),
    [],
    "the destination has to sit in the same sentence as the condition",
  );
});

test("intra-step conditionals — the common real-world shape — stay out of the graph", () => {
  // Straight from the measured corpus: retry policy, validation rules, timeout handling.
  const intraStep = [
    "If a query times out (30s), do NOT retry the exact same query.",
    "If the field is missing, treat it as null.",
    "If validation fails, fix the obvious problem and repeat until it passes, at most 3 times.",
  ];
  for (const sentence of intraStep) {
    assert.deepEqual(extractConditions(sentence), [], `not a branch: ${sentence}`);
  }
});

// ── (5) Reachability — what an entry point actually puts in front of the model ───────────────────

test("an entry-point flow is forward reachability, and each item is always- or maybe-read", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);
  const entries = entryPointIds(graph);
  assert.ok(entries.length > 0, "the fixture has entry points");

  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  for (const entryId of entries) {
    const reach = reachFromEntry(graph, entryId);
    assert.ok(reach.always.includes(entryId), "the entry point itself is always read");
    assert.deepEqual(
      reach.always.filter((id) => reach.maybe.includes(id)),
      [],
      "always and maybe are disjoint",
    );
    // Nothing reached by an accessory edge can be certain: an accessory is `uses`, which is a maybe.
    for (const id of reach.always) {
      const kind = byId.get(id)?.kind;
      assert.ok(
        kind === "entry_point" ||
          kind === "subroutine" ||
          kind === "gatekeeper" ||
          kind === "validation_gate",
        `${id} (${kind}) is a section, so it can be always-read`,
      );
    }
  }
});

test("a step reachable from two entry points appears in BOTH flows", () => {
  const SHARED = `---
name: shared-step
description: Two commands that both reach the same shared step, proving flows may overlap.
---

# Shared

## /analyze

Run the analysis. Then see /report for formatting.

### Collect inputs

Gather what the user attached.

## /report

Format the summary.
`;
  const graph = projectSkillGraph(SHARED, [
    {
      path: "SKILL.md",
      size: 1,
      isBinary: false,
      isSkillMd: true,
      kind: "skill_md",
      tokenTotal: 0,
    },
  ]);
  const analyze = graph.nodes.find(
    (n) => n.kind === "entry_point" && n.trigger.value === "/analyze",
  );
  const report = graph.nodes.find((n) => n.kind === "entry_point" && n.trigger.value === "/report");
  assert.ok(analyze && report, "both commands projected");

  const fromAnalyze = reachFromEntry(graph, analyze.id);
  // /analyze STARTS its own subsection…
  assert.ok(fromAnalyze.always.includes("collect-inputs"), "its own subsection is always read");
  // …and REACHES /report over the cross-flow reference, which is a `uses` edge, so only a maybe.
  assert.ok(fromAnalyze.maybe.includes(report.id), "the cross-flow reference is a maybe");

  const fromReport = reachFromEntry(graph, report.id);
  assert.ok(fromReport.always.includes(report.id));
  assert.ok(
    !fromReport.always.includes("collect-inputs") && !fromReport.maybe.includes("collect-inputs"),
    "/report does not reach /analyze's subsection — reachability is directional",
  );
});

test("a keyword's flow is the WHOLE skill — no per-keyword subset is computed", () => {
  const KEYWORDED = `---
name: keyworded
description: A skill with two keyword triggers, proving a keyword loads the entire document.
keywords:
  - analyse data
  - build a report
---

# Keyworded

## First

Do the first thing, reading \`reference/spec.md\`.

## Second

Do the second thing.
`;
  const graph = projectSkillGraph(KEYWORDED, [
    {
      path: "SKILL.md",
      size: 1,
      isBinary: false,
      isSkillMd: true,
      kind: "skill_md",
      tokenTotal: 0,
    },
    {
      path: "reference/spec.md",
      size: 1,
      isBinary: false,
      isSkillMd: false,
      kind: "reference",
      tokenTotal: 0,
    },
  ]);
  const keywords = graph.nodes.filter(
    (n) => n.kind === "entry_point" && n.trigger.type === "keyword",
  );
  assert.equal(keywords.length, 2, "two keyword entry points");

  const sectionIds = graph.nodes
    .filter((n) => n.kind !== "asset" && n.kind !== "tool_ref" && n.kind !== "loop_guard")
    .map((n) => n.id)
    .sort();

  for (const keyword of keywords) {
    const reach = reachFromEntry(graph, keyword.id);
    assert.equal(reach.wholeSkill, true, "flagged as the whole skill, not a computed subset");
    assert.deepEqual(
      reach.always,
      sectionIds,
      "EVERY section is always read, including the other keyword's",
    );
    assert.deepEqual(reach.maybe, ["asset-spec-md"], "the bundled file is still only a maybe");
  }

  // The two keywords therefore have IDENTICAL flows — the point of the decision.
  assert.deepEqual(
    reachFromEntry(graph, keywords[0]?.id ?? "").always,
    reachFromEntry(graph, keywords[1]?.id ?? "").always,
  );
});

test("reachability degrades honestly on a KINDLESS (pre-WP-7.8) graph rather than over-promising", () => {
  const graph: SkillGraph = {
    nodes: [
      {
        id: "entry",
        kind: "entry_point",
        label: "/go",
        anchor: { headingPath: ["/go"], startLine: 1, endLine: 2 },
        source: "inferred",
        trigger: { type: "command", value: "/go" },
      },
      {
        id: "step",
        kind: "subroutine",
        label: "Step",
        anchor: { headingPath: ["Step"], startLine: 3, endLine: 4 },
        source: "inferred",
      },
    ],
    // No `kind` — exactly what a graph serialized before this work package looks like.
    edges: [{ id: "e1", from: "entry", to: "step" }],
    warnings: [],
  };
  const reach = reachFromEntry(graph, "entry");
  assert.deepEqual(reach.always, ["entry"], "only the entry itself is certain");
  assert.deepEqual(reach.maybe, ["step"], "an unkinded edge is a maybe, never a promised floor");
});

test("reachFromEntry is pure: same graph twice, deep-equal, and a bad id is empty not a throw", () => {
  const { skillMd, files } = loadFixture("multi-command");
  const graph = projectSkillGraph(skillMd, files);
  const entry = entryPointIds(graph)[0] as string;
  assert.deepEqual(reachFromEntry(graph, entry), reachFromEntry(graph, entry));
  assert.deepEqual(reachFromEntry(graph, "no-such-node"), {
    entryNodeId: "no-such-node",
    always: [],
    maybe: [],
    wholeSkill: false,
  });
  // A node that exists but is not an entry point is equally not a flow.
  const section = graph.nodes.find((n) => n.kind === "subroutine") as SkillGraphNode;
  assert.deepEqual(reachFromEntry(graph, section.id).always, []);
});
