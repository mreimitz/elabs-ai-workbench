import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SKILL_GRAPH_NODE_KINDS } from "@mcp-token-footprint/shared";
import type { QualityReport, SkillGraph, ToolDiagnostic } from "@mcp-token-footprint/shared";
// Skill IDE WP 9.4 (I10.5) — the education layer's LOAD-BEARING guarantees. We import the EXACT web
// modules the IDE renders from (both pure — no React/brand-ui — like WP 9.3's snippet test), so this
// test and the running UI can never drift:
//   • the explainer registry (`explainers.ts`) — the SINGLE source every education surface resolves
//     through (code hovers, node-panel "What is this?", canvas legend, problems panel), and
//   • the snippet catalog (`snippet-specs.ts`) — proof that WP 9.3's completion docs read the SAME
//     registry (`explainerId ∈ EXPLAINERS`).
import {
  collectSkillProblems,
  EDGE_KIND_EXPLAINER_IDS,
  explainerFor,
  EXPLAINERS,
  NODE_KIND_EXPLAINER_IDS,
  SKILL_AUTHORING_GUIDE,
} from "../../web/src/features/skills/design/code-intel/explainers.js";
import { SNIPPET_SPECS } from "../../web/src/features/skills/design/code-intel/snippet-specs.js";

// --- The authoring guide: parse its real headings → GitHub-slugged anchors --------------------------
// The rule↔guide contract: every registry anchor must resolve to a real heading in the guide. We build
// the set of valid `docs/skill-authoring.md#<slug>` anchors from the file itself (GitHub's slug rules),
// so adding a registry entry with a bad anchor — or renaming a guide heading — fails this test.

const GUIDE_PATH = fileURLToPath(new URL("../../../docs/skill-authoring.md", import.meta.url));

/** GitHub's heading-anchor slug: lowercase, drop everything but ascii alnum/space/hyphen, spaces→`-`
 *  (multiple removed/space runs collapse to multiple hyphens exactly like GitHub does). */
function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 \-]+/g, "")
    .replace(/ /g, "-");
}

/** Every `docs/skill-authoring.md#<slug>` anchor a real heading in the guide resolves to. */
function guideAnchors(): Set<string> {
  const md = readFileSync(GUIDE_PATH, "utf8");
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    anchors.add(`${SKILL_AUTHORING_GUIDE}#${githubSlug(heading[2] ?? "")}`);
  }
  return anchors;
}

// --- (1) rule↔guide contract: every registry anchor resolves to a real heading ----------------------

test("every explainer guideAnchor resolves to a real heading in the guide", () => {
  const anchors = guideAnchors();
  // Sanity: the parser actually found the guide's section headings (not an empty/moved file).
  assert.ok(
    anchors.has(`${SKILL_AUTHORING_GUIDE}#1-identity--triggering-l1`),
    "guide section 1 parsed",
  );
  assert.ok(
    anchors.has(`${SKILL_AUTHORING_GUIDE}#5-tool--mcp-server-references`),
    "guide section 5 parsed",
  );
  // Sanity: a bogus anchor is NOT accepted (the slugger isn't trivially permissive).
  assert.ok(!anchors.has(`${SKILL_AUTHORING_GUIDE}#does-not-exist`), "unknown anchor rejected");

  for (const entry of Object.values(EXPLAINERS)) {
    assert.ok(
      entry.guideAnchor.startsWith(`${SKILL_AUTHORING_GUIDE}#`),
      `${entry.id} anchor points at the guide`,
    );
    assert.ok(
      anchors.has(entry.guideAnchor),
      `${entry.id} guideAnchor "${entry.guideAnchor}" resolves to a real heading`,
    );
  }
});

// --- (2) registry integrity: keys, titles, teaching copy --------------------------------------------

test("every registry entry is well-formed (id === key, non-empty title + short)", () => {
  for (const [key, entry] of Object.entries(EXPLAINERS)) {
    assert.equal(entry.id, key, `entry id matches its key (${key})`);
    assert.ok(entry.title.trim().length > 0, `${key} has a title`);
    assert.ok(entry.short.trim().length >= 20, `${key} has a real teaching line`);
  }
});

// --- (3) full element coverage (the WP's element vocabulary) -----------------------------------------

test("the registry covers the full element vocabulary", () => {
  // The 6 node kinds + `tool_ref` — keyed by the shared canonical kind ids.
  for (const kind of SKILL_GRAPH_NODE_KINDS) {
    assert.ok(explainerFor(kind), `node kind "${kind}" has an explainer`);
  }
  assert.deepEqual(
    [...NODE_KIND_EXPLAINER_IDS],
    [...SKILL_GRAPH_NODE_KINDS],
    "legend node ids == shared kinds",
  );

  // Edge kinds.
  for (const id of EDGE_KIND_EXPLAINER_IDS) {
    assert.ok(explainerFor(id), `edge kind "${id}" has an explainer`);
  }

  // Frontmatter keys, annotation keywords, the breadcrumb marker, triggers, and the inline refs the
  // WP 9.3 construct hover looks up — each must exist so exactly one lookup teaches them everywhere.
  const required = [
    "frontmatter:name",
    "frontmatter:description",
    "frontmatter:keywords",
    "frontmatter:servers",
    "annotation:gatekeeper",
    "annotation:gate",
    "annotation:command",
    "annotation:servers",
    "breadcrumb:marker",
    "trigger:command",
    "trigger:keyword",
    "ref:asset",
    "ref:tool",
  ];
  for (const id of required) {
    assert.ok(explainerFor(id), `required element "${id}" has an explainer`);
  }
});

// --- (4) single source: WP 9.3's snippet catalog resolves through THIS registry ---------------------

test("every snippet's explainerId resolves in the single-source registry (9.3 consumes it)", () => {
  assert.ok(SNIPPET_SPECS.length > 0, "the snippet catalog is non-empty");
  for (const spec of SNIPPET_SPECS) {
    assert.ok(
      explainerFor(spec.explainerId),
      `snippet "${spec.id}" teaches explainer "${spec.explainerId}" — which must exist in EXPLAINERS`,
    );
  }
});

// --- (5) the problems panel aggregation: three sources, one list, triple deep links -----------------

test("collectSkillProblems aggregates projector + quality + tool, each with registry-backed anchors", () => {
  // A tiny graph with a gatekeeper section spanning SKILL.md lines 3–5.
  const gate = {
    id: "n-gate",
    kind: "gatekeeper" as const,
    label: "Decide the route",
    anchor: { headingPath: ["Decide the route"], startLine: 3, endLine: 5 },
    source: "inferred" as const,
  };
  const graph: SkillGraph = { nodes: [gate], edges: [], warnings: [] };

  const quality: QualityReport = {
    findings: [
      {
        ruleId: "gatekeeper-no-breadcrumb",
        severity: "warning",
        message: "This gatekeeper has no breadcrumb marker.",
        anchor: { headingPath: ["Decide the route"], startLine: 4, endLine: 5 },
      },
    ],
    score: 90,
    ruleCounts: { "gatekeeper-no-breadcrumb": 1 },
    qualityEngineVersion: 1,
  };

  const diagnostics: ToolDiagnostic[] = [
    {
      kind: "unknown_tool",
      name: "make_report",
      anchor: { headingPath: [], startLine: 4, endLine: 4 },
      candidates: [],
    },
  ];

  const problems = collectSkillProblems({
    graph,
    warnings: [
      `gatekeeper "Decide the route" branch targets are not resolvable to sections; routed to the next section.`,
    ],
    quality,
    diagnostics,
    formatDiagnostic: (d) => `Unknown tool ${d.name}`,
  });

  assert.equal(problems.length, 3, "one problem per source");
  const bySource = Object.fromEntries(problems.map((p) => [p.source, p]));
  assert.ok(bySource.projector && bySource.quality && bySource.tool, "all three sources present");

  // Projector warning attributes to the named section → node + line (a live, triple-linkable problem).
  assert.equal(bySource.projector!.nodeId, "n-gate");
  assert.equal(bySource.projector!.line, 3);
  assert.equal(bySource.projector!.elementId, "gatekeeper");

  // Quality finding pins to its owning node + anchor line.
  assert.equal(bySource.quality!.nodeId, "n-gate");
  assert.equal(bySource.quality!.line, 4);
  assert.equal(bySource.quality!.severity, "warning");

  // Tool diagnostic is always about a tool reference.
  assert.equal(bySource.tool!.elementId, "ref:tool");
  assert.equal(bySource.tool!.line, 4);

  // Single source: EVERY problem's guide anchor comes from the registry and resolves to a real heading.
  const anchors = guideAnchors();
  for (const problem of problems) {
    const entry = explainerFor(problem.elementId);
    assert.ok(entry, `problem element "${problem.elementId}" has an explainer`);
    assert.ok(anchors.has(entry!.guideAnchor), `problem anchor "${entry!.guideAnchor}" resolves`);
  }
});

test("collectSkillProblems always surfaces live projector warnings even with no persisted findings", () => {
  const problems = collectSkillProblems({
    graph: null,
    warnings: ["No markdown headings found after frontmatter; nothing to project."],
    quality: null,
    diagnostics: [],
    formatDiagnostic: (d) => d.name,
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.source, "projector");
  assert.ok(
    explainerFor(problems[0]!.elementId),
    "even an unattributed warning resolves to an element",
  );
});
