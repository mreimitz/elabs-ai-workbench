import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { describe, expect, test, vi } from "vitest";
import type { ReasoningSection } from "@mcp-token-footprint/shared";

// ChatMarkdown pulls `@brand/ai` (Streamdown) which jsdom can't load — stub it to a sentinel that
// echoes the section's markdown so we assert content without the markdown engine (matches
// AnswersAnswerView.test.tsx's convention).
vi.mock("./ChatMarkdown", () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

import { AnswersReasoning } from "./AnswersReasoning";

// Test harness (toolbar-reach Phase 3): the answers table now mounts a Radix Tooltip via `IconButton`
// (ExpandableTable toolbar); the app root supplies `TooltipProvider`, so inject it for every render.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);

/**
 * WP 5.4 (D-QA11) — the structured reasoning renderer: recognized pipeline phases render as titled
 * markdown, `assets` as a compact table, `draft` collapses ONLY when it duplicates the final answer,
 * and `raw`/unrecognized content still renders verbatim (never dropped).
 */
describe("AnswersReasoning", () => {
  test("renders nothing for an empty sections array", () => {
    const { container } = render(<AnswersReasoning sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("understanding / rewritten / classification / prose render their titled (or untitled) markdown", () => {
    const sections: ReasoningSection[] = [
      { kind: "understanding", title: "Understanding", markdown: "The user wants carrier delays." },
      { kind: "rewritten", title: "Rewritten Question", markdown: "Which carrier has the most delays?" },
      { kind: "classification", title: "Classification", markdown: "Analytical question." },
      { kind: "prose", markdown: "Some unrecognized narrative line." },
    ];
    render(<AnswersReasoning sections={sections} />);

    expect(screen.getByText("Understanding")).toBeInTheDocument();
    expect(screen.getByText("The user wants carrier delays.")).toBeInTheDocument();
    expect(screen.getByText("Rewritten Question")).toBeInTheDocument();
    expect(screen.getByText("Which carrier has the most delays?")).toBeInTheDocument();
    expect(screen.getByText("Classification")).toBeInTheDocument();
    expect(screen.getByText("Analytical question.")).toBeInTheDocument();
    // "prose" carries no title in the parser's output — just the flowing text.
    expect(screen.getByText("Some unrecognized narrative line.")).toBeInTheDocument();
  });

  test("a prose/understanding/rewritten/classification section with no title falls back to a default label", () => {
    render(
      <AnswersReasoning
        sections={[{ kind: "understanding", markdown: "Untitled understanding text." }]}
      />,
    );
    expect(screen.getByText("Understanding")).toBeInTheDocument();
    expect(screen.getByText("Untitled understanding text.")).toBeInTheDocument();
  });

  test("an `assets` section renders a table with asset · type · similarity · glossary match", () => {
    render(
      <AnswersReasoning
        sections={[
          {
            kind: "assets",
            title: "Master Dimensions",
            rows: [
              { asset: "Carrier.airline_name", type: "dimension", similarity: 0.876, glossary: "airline, carrier" },
              { asset: "Flight.delay_minutes", type: "measure" },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Master Dimensions")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Asset" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Similarity" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Glossary match" })).toBeInTheDocument();

    expect(screen.getByRole("cell", { name: "Carrier.airline_name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "dimension" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0.876" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "airline, carrier" })).toBeInTheDocument();

    // A row with no similarity/glossary shows an honest em dash, never a blank cell.
    expect(screen.getByRole("cell", { name: "Flight.delay_minutes" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "measure" })).toBeInTheDocument();
  });

  test("an `assets` section gains the download + expand toolbar (WP 6.1)", () => {
    render(
      <AnswersReasoning
        sections={[
          { kind: "assets", title: "Master Dimensions", rows: [{ asset: "X", similarity: 0.5 }] },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Download table as CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  test("similarity cells carry tabular-nums and right-align", () => {
    render(
      <AnswersReasoning
        sections={[{ kind: "assets", rows: [{ asset: "X", similarity: 0.5 }] }]}
      />,
    );
    const cell = screen.getByRole("cell", { name: "0.5" });
    expect(cell.className).toContain("tabular-nums");
    expect(cell.className).toContain("text-right");
  });

  test("an `assets` section with zero rows renders nothing (no table, no visible text)", () => {
    const { container } = render(<AnswersReasoning sections={[{ kind: "assets", rows: [] }]} />);
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  test("a `draft` that duplicates the answer is COLLAPSED by default — text present but not expanded", () => {
    render(
      <AnswersReasoning
        sections={[
          {
            kind: "draft",
            title: "Carrier delay summary",
            markdown: "American Airlines had the most delays in Q1.",
            duplicatesAnswer: true,
          },
        ]}
      />,
    );

    // The disclosure trigger is visible…
    expect(screen.getByRole("button", { name: /Carrier delay summary/ })).toBeInTheDocument();
    expect(screen.getByText("Same as answer")).toBeInTheDocument();
    // …but the draft text itself is not expanded/visible until opened.
    expect(screen.queryByText("American Airlines had the most delays in Q1.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Carrier delay summary/ }));
    expect(screen.getByText("American Airlines had the most delays in Q1.")).toBeInTheDocument();
  });

  test("a `draft` that does NOT duplicate the answer renders directly, expanded/inline", () => {
    render(
      <AnswersReasoning
        sections={[
          {
            kind: "draft",
            title: "An earlier, different draft",
            markdown: "A completely different analysis path.",
            duplicatesAnswer: false,
          },
        ]}
      />,
    );

    expect(screen.getByText("An earlier, different draft")).toBeInTheDocument();
    expect(screen.getByText("A completely different analysis path.")).toBeInTheDocument();
    // No collapse trigger for a non-duplicate draft.
    expect(screen.queryByText("Same as answer")).not.toBeInTheDocument();
  });

  test("a `raw` section renders its markdown verbatim, with no title", () => {
    render(
      <AnswersReasoning
        sections={[{ kind: "raw", markdown: "Whole unparsed reasoning blob, verbatim." }]}
      />,
    );
    expect(screen.getByText("Whole unparsed reasoning blob, verbatim.")).toBeInTheDocument();
  });
});
