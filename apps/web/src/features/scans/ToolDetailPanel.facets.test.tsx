import type { ToolScan } from "@mcp-token-footprint/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// The panel renders a Monaco `CodeEditor` for the raw tool; the real package pulls a `.css` import
// that jsdom cannot load. Mocked per-test, the convention this repo already uses (see
// `ResourcePromptRun.test.tsx`, `AssistantDiffCard.test.tsx`).
vi.mock("@elabs-ai/components-editor", () => ({ CodeEditor: () => null, DiffEditor: () => null }));

vi.mock("../../lib/api", () => ({
  getServerTests: vi.fn(async () => ({ models: [], entries: [], subjectType: "server" })),
  getToolTests: vi.fn(async () => ({ models: [], entries: [], subjectType: "tool" })),
  callTool: vi.fn(),
}));

import { facetSegments, TokenDistribution } from "../../components/TokenViz";
import { ToolDetailPanel } from "./ToolDetailPanel";

/**
 * The server's Token distribution card and a tool's own detail panel must show the SAME arithmetic.
 * They used to disagree: the panel drew its own four-segment bar and rescaled it to their sum, so
 * `qlik_add_chart` read Name 4 · Description 303 · Schema 2,197 · Annotations 7 — 2,511 against a
 * stated total of 2,601 — and `qlik_get_full_glossary_export` showed 120 of its 2,028 tokens.
 *
 * These render the REAL panel, not the bar in isolation: the defect was the panel handing the bar
 * the wrong denominator, so a test that mounts the bar directly cannot see it come back.
 */
function tool(over: Partial<ToolScan>): ToolScan {
  return {
    id: "t1",
    scanId: "s1",
    toolName: "qlik_add_chart",
    description: "Add a visualization to a sheet.",
    inputSchema: {},
    annotations: {},
    rawTool: {},
    contributionPercent: 4,
    totalTokens: 2601,
    nameTokens: 4,
    descriptionTokens: 303,
    schemaTokens: 2197,
    annotationsTokens: 7,
    rawBytes: 10_900,
    ...over,
  } as ToolScan;
}

function renderPanel(over: Partial<ToolScan> = {}) {
  return render(
    <TooltipProvider>
      <ToolDetailPanel tool={tool(over)} />
    </TooltipProvider>,
  );
}

function labelled(container: HTMLElement): string[] {
  return [...container.querySelectorAll("li")].map((li) => li.textContent?.trim() ?? "");
}

describe("ToolDetailPanel — the token budget accounts for every token it states", () => {
  test("the fifth segment is present and carries the tokens the four facets miss", async () => {
    renderPanel();
    expect(await screen.findByText("Output schema + envelope")).toBeInTheDocument();
    // 2,601 − (4 + 303 + 2,197 + 7) = 90 — what the old four-segment bar dropped.
    expect(screen.getByText("90 · 3.5%")).toBeInTheDocument();
  });

  test("the bar is scaled to the tool's STATED total, not to the facet sum", async () => {
    renderPanel();
    await screen.findByText("Output schema + envelope");
    // Against the facet sum (2,511) the schema would read 87.5%; against the real total it is 84.5%.
    // This is the assertion that catches the denominator regressing.
    expect(screen.getByText("2,197 · 84.5%")).toBeInTheDocument();
    expect(screen.queryByText("2,197 · 87.5%")).not.toBeInTheDocument();
  });

  test("a tool whose output schema dominates reads as such, not as 120 tokens", async () => {
    renderPanel({
      toolName: "qlik_get_full_glossary_export",
      totalTokens: 2028,
      nameTokens: 8,
      descriptionTokens: 67,
      schemaTokens: 38,
      annotationsTokens: 7,
    });
    await screen.findByText("Output schema + envelope");
    expect(screen.getByText("1,908 · 94.1%")).toBeInTheDocument();
  });

  test("the panel explains the segment, in the same words the server card uses", async () => {
    renderPanel();
    expect(
      await screen.findByText(/Everything in the definition that the four parts above/),
    ).toBeInTheDocument();
  });

  test("the panel's segment rows match the server card's, row for row", async () => {
    const panel = renderPanel();
    await screen.findByText("Output schema + envelope");
    const panelRows = labelled(panel.container).filter((row) =>
      /Name|Description|Schema|Annotations|Output schema/.test(row),
    );
    panel.unmount();

    const split = { name: 4, description: 303, schema: 2197, annotations: 7 };
    const card = render(
      <TooltipProvider>
        <TokenDistribution
          facets={split}
          rows={[]}
          surface={{ tools: 2601, resources: 0, prompts: 0 }}
        />
      </TooltipProvider>,
    );
    expect(labelled(card.container).slice(-5)).toEqual(panelRows);
    // …and both are the one function, so neither can drift on its own.
    expect(facetSegments(split, 2601).map((s) => s.label)).toEqual([
      "Name",
      "Description",
      "Schema",
      "Annotations",
      "Output schema + envelope",
    ]);
  });
});
