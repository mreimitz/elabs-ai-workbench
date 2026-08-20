import { TooltipProvider } from "@elabs-ai/components-ui";
import { ThemeProvider } from "@elabs-ai/components-tokens";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { IllustrationPrimitivesPreview } from "./IllustrationPrimitivesPreview";

/** The preview reads the live theme, exactly as the app root supplies it in `main.tsx`. */
const withTheme = (element: ReactElement) => (
  <ThemeProvider defaultTheme="light">
    <TooltipProvider>{element}</TooltipProvider>
  </ThemeProvider>
);

// The preview is dev scaffolding, so this test is deliberately small — but it is not nothing. It
// pins the two things that would make the WP 0.2 screenshots a lie: that the sheet actually renders
// inside the app's own chrome, and that what it renders is the whole vocabulary rather than a
// subset somebody trimmed to make a layout fit.

describe("IllustrationPrimitivesPreview", () => {
  test("renders the primitives sheet inside the app page frame", () => {
    render(withTheme(<IllustrationPrimitivesPreview />));
    expect(screen.getByRole("heading", { name: "Illustration primitives" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Every illustration primitive shipped by WP 0.2, drawn on one sheet",
      }),
    ).toBeInTheDocument();
  });

  test("shows every connector kind and every entity state", () => {
    const { container } = render(withTheme(<IllustrationPrimitivesPreview />));
    const kinds = [...container.querySelectorAll("[data-illus-connector]")].map((node) =>
      node.getAttribute("data-illus-connector"),
    );
    expect(new Set(kinds)).toEqual(new Set(["flow", "read", "write", "publish", "loop", "signal"]));

    const states = [...container.querySelectorAll("[data-illus-state]")].map((node) =>
      node.getAttribute("data-illus-state"),
    );
    expect(new Set(states)).toEqual(new Set(["idle", "active", "highlight", "dimmed", "error"]));
  });

  test("paints no colour of its own — every fill and stroke is an --illus-* token", () => {
    const { container } = render(withTheme(<IllustrationPrimitivesPreview />));
    const svg = container.querySelector("svg[data-illus-sheet]");
    expect(svg).not.toBeNull();
    for (const node of svg?.querySelectorAll("*") ?? []) {
      for (const property of ["fill", "stroke"] as const) {
        const inline = (node as SVGElement).style.getPropertyValue(property);
        const attribute = node.getAttribute(property);
        for (const value of [inline, attribute]) {
          if (!value || value === "none" || value === "") continue;
          expect(value).toMatch(/^(var\(--illus-|url\(#illus-)/);
        }
      }
    }
  });
});
