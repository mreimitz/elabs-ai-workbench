import { ILLUSTRATION_REGISTRY } from "@mcp-token-footprint/illustrations";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { ThemeProvider } from "@elabs-ai/components-tokens";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { IllustrationsGallery } from "./IllustrationsGallery";

/** The gallery reads the live theme, exactly as the app root supplies it in `main.tsx`. */
const withTheme = (element: ReactElement) => (
  <ThemeProvider defaultTheme="light">
    <TooltipProvider>{element}</TooltipProvider>
  </ThemeProvider>
);

describe("IllustrationsGallery — the catalog (RM-14 WP 0.3)", () => {
  test("renders every registry entry on a cold load, with no query params at all", () => {
    render(withTheme(<IllustrationsGallery />));
    for (const entry of ILLUSTRATION_REGISTRY) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^Open ${escapeRegExp(entry.title)}`) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(`${ILLUSTRATION_REGISTRY.length} illustrations`)).toBeInTheDocument();
  });

  test("draws the entities LIVE — each card carries the real component, labelled from its entry", () => {
    const { container } = render(withTheme(<IllustrationsGallery />));
    const drawn = [...container.querySelectorAll("[data-illus-entity]")].map((node) =>
      node.getAttribute("data-illus-entity"),
    );
    expect(new Set(drawn)).toEqual(new Set(ILLUSTRATION_REGISTRY.map((entry) => entry.id)));
    for (const entry of ILLUSTRATION_REGISTRY) {
      // Twice each, and both are wanted: once as the card's visible caption, once as the drawing's
      // own `<desc>` — the a11y text D-IL12 makes mandatory, taken from the same registry field.
      expect(screen.getAllByText(entry.description)).toHaveLength(2);
    }
  });

  test("filters the grid by search, and offers a way back from an empty result", () => {
    render(withTheme(<IllustrationsGallery />));
    const search = screen.getByLabelText("Search illustrations");

    fireEvent.change(search, { target: { value: "stdio" } });
    expect(screen.getByRole("button", { name: /^Open MCP Server/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open Skill/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(`1 of ${ILLUSTRATION_REGISTRY.length} illustrations`),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "kubernetes" } });
    expect(screen.getByText("No illustrations match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the whole catalog" }));
    expect(screen.getByRole("button", { name: /^Open Skill/ })).toBeInTheDocument();
  });

  test("the port overlay toggle draws the declared ports, and only when it is on (D-IL7)", () => {
    const { container } = render(withTheme(<IllustrationsGallery />));
    expect(container.querySelectorAll("[data-illus-port]")).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("Show port overlay"));

    const drawn = [...container.querySelectorAll("[data-illus-port]")].map((node) =>
      node.getAttribute("data-illus-port"),
    );
    // Every port every catalogued entity declares, drawn once per card.
    const declared = ILLUSTRATION_REGISTRY.flatMap((entry) => Object.keys(entry.ports));
    expect(drawn.sort()).toEqual(declared.sort());
  });

  test("opening a card opens the detail with that component's states x sizes matrix", () => {
    render(withTheme(<IllustrationsGallery />));
    fireEvent.click(screen.getByRole("button", { name: /^Open Agent \/ LLM/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Agent / LLM" })).toBeInTheDocument();
    for (const section of ["States", "Sizes", "Facing", "Registry entry"]) {
      expect(within(dialog).getByRole("heading", { name: section })).toBeInTheDocument();
    }
  });

  test("paints no colour of its own — every fill and stroke in every drawing is an --illus-* token", () => {
    const { container } = render(withTheme(<IllustrationsGallery />));
    expectOnlyIllusTokens(container);
  });
});

describe("IllustrationsGallery — the primitives tab (the WP 0.2 sheet, reachable at last)", () => {
  test("shows the whole drawing vocabulary: every connector kind and every entity state", () => {
    const { container } = render(withTheme(<IllustrationsGallery />));
    selectTab("Primitives");

    expect(
      screen.getByRole("img", {
        name: "Every illustration primitive shipped by WP 0.2, drawn on one sheet",
      }),
    ).toBeInTheDocument();

    const sheet = container.querySelector("svg[data-illus-sheet]");
    expect(sheet).not.toBeNull();
    const kinds = [...(sheet?.querySelectorAll("[data-illus-connector]") ?? [])].map((node) =>
      node.getAttribute("data-illus-connector"),
    );
    expect(new Set(kinds)).toEqual(new Set(["flow", "read", "write", "publish", "loop", "signal"]));

    const states = [...(sheet?.querySelectorAll("[data-illus-state]") ?? [])].map((node) =>
      node.getAttribute("data-illus-state"),
    );
    expect(new Set(states)).toEqual(new Set(["idle", "active", "highlight", "dimmed", "error"]));
  });

  test("the sheet paints only --illus-* tokens too", () => {
    const { container } = render(withTheme(<IllustrationsGallery />));
    selectTab("Primitives");
    expectOnlyIllusTokens(container);
  });
});

/**
 * D-IL5 asserted on RENDERED output rather than on source text: a component can import a token
 * correctly and still paint a literal somewhere. `url(#illus-…)` is the paper grid's own pattern.
 */
function expectOnlyIllusTokens(container: HTMLElement): void {
  for (const svg of container.querySelectorAll("svg")) {
    for (const node of svg.querySelectorAll("*")) {
      for (const property of ["fill", "stroke"] as const) {
        const inline = (node as SVGElement).style.getPropertyValue(property);
        const attribute = node.getAttribute(property);
        for (const value of [inline, attribute]) {
          if (!value || value === "none") continue;
          expect(value).toMatch(/^(var\(--illus-|url\(#illus-)/);
        }
      }
    }
  }
}

/**
 * Radix's `TabsTrigger` listens for pointer-down and focus, not click — a bare `fireEvent.click`
 * never changes the tab in jsdom. `mouseDown` is what the component actually reacts to.
 */
function selectTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
