import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { AdvisorTeaserData, SectionEnvelope } from "../overview-contract";
import { AdvisorTile } from "./AdvisorTile";

// Fixtures are LOCAL on purpose (WP 1.3): WP 1.1's hook is built in parallel, so this suite pins the
// tile against the committed CONTRACT only.

function teaser(overrides: Partial<AdvisorTeaserData> = {}): AdvisorTeaserData {
  return {
    title: "Trim 14 unused tools from Alpha",
    detail:
      "No run has called these tools in the last 30 days, but every turn still pays for them.",
    savingsLabel: "31,000 tokens",
    severity: "high",
    href: "/advisor?scope=server&id=srv-a",
    ...overrides,
  };
}

function ready(data: AdvisorTeaserData): SectionEnvelope<AdvisorTeaserData> {
  return { state: "ready", data, error: null };
}

function renderTile(section: SectionEnvelope<AdvisorTeaserData>, onRetry?: () => void) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <AdvisorTile section={section} onRetry={onRetry} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("AdvisorTile — the recommendation", () => {
  test("renders the title as a link to the contract's href, plus the detail", () => {
    renderTile(ready(teaser()));
    expect(screen.getByRole("link", { name: "Trim 14 unused tools from Alpha" })).toHaveAttribute(
      "href",
      "/advisor?scope=server&id=srv-a",
    );
    expect(screen.getByText(/No run has called these tools/)).toBeInTheDocument();
  });

  test("offers the way through to the full fleet report", () => {
    renderTile(ready(teaser()));
    expect(screen.getByRole("link", { name: "See all recommendations" })).toHaveAttribute(
      "href",
      "/advisor",
    );
  });
});

describe("AdvisorTile — severity is stated in TEXT, never colour alone", () => {
  test.each([
    ["high", "High severity"],
    ["medium", "Medium severity"],
    ["low", "Low severity"],
  ] as const)("%s renders the words '%s'", (severity, label) => {
    renderTile(ready(teaser({ severity })));
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("AdvisorTile — no fabricated figure (WP 1.3 hard requirement 4)", () => {
  test("a savings label is printed VERBATIM inside a sentence that says it is an estimate", () => {
    renderTile(ready(teaser({ savingsLabel: "31,000 tokens" })));
    expect(screen.getByText("Estimated saving 31,000 tokens")).toBeInTheDocument();
    // The word "Estimate" also appears as a chip, so the figure can never read as a measurement.
    expect(screen.getByText("Estimate")).toBeInTheDocument();
  });

  test("a null savings label renders NOTHING — no zero, no dash, no empty block", () => {
    const { container } = renderTile(ready(teaser({ savingsLabel: null })));
    expect(screen.queryByText(/Estimated saving/)).not.toBeInTheDocument();
    expect(screen.queryByText("Estimate")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0 tokens/);
    // The recommendation itself is still fully rendered.
    expect(
      screen.getByRole("link", { name: "Trim 14 unused tools from Alpha" }),
    ).toBeInTheDocument();
  });

  test("a unit the app does not know is still printed as the advisor formatted it", () => {
    renderTile(ready(teaser({ savingsLabel: "$0.0042/run" })));
    expect(screen.getByText("Estimated saving $0.0042/run")).toBeInTheDocument();
  });
});

describe("AdvisorTile — section states", () => {
  test("SELF-HIDES when the advisor section is empty", () => {
    const { container } = renderTile({ state: "empty", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("SELF-HIDES when the section settled ready with no data", () => {
    const { container } = renderTile({ state: "ready", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("an error is surfaced, never shown as 'no advice'", () => {
    renderTile({ state: "error", data: null, error: "advisor report failed" });
    expect(screen.getByText(/Couldn’t load advisor recommendations/)).toBeInTheDocument();
    expect(screen.getByText("advisor report failed")).toBeInTheDocument();
  });

  test("loading renders a layout-shaped placeholder", () => {
    const { container } = renderTile({ state: "loading", data: null, error: null });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
