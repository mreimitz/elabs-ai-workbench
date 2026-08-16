import { describe, expect, it } from "vitest";
import type { SkillGraph, ToolDiagnostic } from "@mcp-token-footprint/shared";
import { collectSkillProblems } from "./explainers";
import { formatUnknownToolWarning } from "./tool-references";

// Skill Studio WP 7.5 (SI7) — the LIVE unknown-tool findings ride the problems panel's existing
// `warnings` channel; `collectSkillProblems` recognizes the exact format (built + parsed by the same
// module, so the two ends can't drift), re-classifies each to the `tool` source with a line pin, and
// drops it when the persisted diagnostics already report the same name.

const graph: SkillGraph = {
  nodes: [
    {
      id: "n-search",
      kind: "subroutine",
      label: "Search the model",
      anchor: { headingPath: ["Search the model"], startLine: 10, endLine: 20 },
      source: "inferred",
    },
  ],
  edges: [],
  warnings: [],
};

const collect = (warnings: string[], diagnostics: ToolDiagnostic[] = []) =>
  collectSkillProblems({
    graph,
    warnings,
    quality: null,
    diagnostics,
    formatDiagnostic: (d) => `Unknown tool ${d.name}`,
  });

describe("collectSkillProblems — live unknown-tool warnings (WP 7.5)", () => {
  it("re-classifies a live unknown-tool warning to the tool source with a line + node pin", () => {
    const warning = formatUnknownToolWarning({ name: "qlik_serach", line: 12, count: 1 });
    const problems = collect([warning]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      source: "tool",
      severity: "warning",
      elementId: "ref:tool",
      message: warning,
      line: 12,
      nodeId: "n-search", // line 12 falls inside the subroutine's anchor span
    });
  });

  it("keeps the line pin even when no node spans the line", () => {
    const warning = formatUnknownToolWarning({ name: "qlik_serach", line: 99, count: 2 });
    const problems = collect([warning]);
    expect(problems[0]).toMatchObject({ source: "tool", line: 99 });
    expect(problems[0]?.nodeId).toBeUndefined();
  });

  it("drops the live row when the persisted diagnostics already report the same name", () => {
    const warning = formatUnknownToolWarning({ name: "qlik_serach", line: 12, count: 1 });
    const diagnostics: ToolDiagnostic[] = [
      {
        kind: "unknown_tool",
        name: "qlik_serach",
        anchor: { headingPath: [], startLine: 12, endLine: 12 },
        candidates: [],
      },
    ];
    const problems = collect([warning], diagnostics);
    // Exactly ONE row for the issue — the persisted diagnostic (richer: close-match candidates).
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ source: "tool", message: "Unknown tool qlik_serach" });
  });

  it("leaves genuine projector warnings on the projector source", () => {
    const problems = collect([
      `gatekeeper "Search the model" branch targets are not resolvable to sections.`,
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ source: "projector", nodeId: "n-search" });
  });

  it("handles a mixed warnings list (projector + live tool) in one pass", () => {
    const live = formatUnknownToolWarning({ name: "made_up_tool", line: 15, count: 1 });
    const problems = collect(["No markdown headings found after frontmatter.", live]);
    expect(problems.map((p) => p.source)).toEqual(["projector", "tool"]);
    expect(problems[1]).toMatchObject({ elementId: "ref:tool", line: 15 });
  });
});
