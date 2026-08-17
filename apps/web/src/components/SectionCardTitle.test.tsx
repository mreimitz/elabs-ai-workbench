import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CardTitle } from "@elabs-ai/components-ui";
import { SectionCardTitle } from "./SectionCardTitle";

// Locks the D-IC5 contract (interface-review finding 6): a section title is a REAL heading — an
// `<h2>`/`<h3>` exposing `role="heading"` at the chosen `aria-level` — while keeping the exact
// `text-title` visual of `@elabs-ai/components-ui` CardTitle (so the outline gains structure with no visual
// change). Decorative titles keep `CardTitle`; that split is what this component makes queryable.

describe("SectionCardTitle — section titles are semantic headings (D-IC5)", () => {
  test("renders a real heading element with role=heading at aria-level 2 by default", () => {
    render(<SectionCardTitle>Since your last visit</SectionCardTitle>);
    // `getByRole("heading", { level: 2 })` resolves via the accessibility tree — it succeeds only
    // if the node computes to role=heading at aria-level 2 (a native <h2>'s IMPLICIT level, which is
    // never a literal DOM attribute), so this asserts both the role and the level.
    const heading = screen.getByRole("heading", { name: "Since your last visit", level: 2 });
    expect(heading.tagName).toBe("H2");
  });

  test("level={3} renders an <h3> at aria-level 3 (for a nested sub-section)", () => {
    render(<SectionCardTitle level={3}>Token distribution</SectionCardTitle>);
    const heading = screen.getByRole("heading", { name: "Token distribution", level: 3 });
    expect(heading.tagName).toBe("H3");
  });

  test("carries the exact `text-title` visual of @elabs-ai/components-ui CardTitle (same look, real heading)", () => {
    const { container: sectionContainer } = render(<SectionCardTitle>Findings</SectionCardTitle>);
    const heading = screen.getByRole("heading", { name: "Findings" });
    // The visual is the CardTitle look: `text-title leading-none`.
    expect(heading.className).toContain("text-title");
    expect(heading.className).toContain("leading-none");

    // Cross-check against the real CardTitle: identical class set, only the TAG differs (div → h2).
    const { container: cardContainer } = render(<CardTitle>Findings</CardTitle>);
    const cardTitle = cardContainer.firstElementChild as HTMLElement;
    expect(cardTitle.tagName).toBe("DIV");
    expect(cardTitle.className).toBe(heading.className);
    // Sanity: the section title is NOT a div (that is the whole point).
    expect(sectionContainer.querySelector("h2")).not.toBeNull();
  });

  test("className is merged for layout only and passes through arbitrary HTML attributes", () => {
    render(
      <SectionCardTitle className="mb-2" id="findings-title" data-testid="st">
        Findings
      </SectionCardTitle>,
    );
    const heading = screen.getByTestId("st");
    expect(heading.className).toContain("mb-2");
    expect(heading.className).toContain("text-title");
    expect(heading).toHaveAttribute("id", "findings-title");
  });
});
