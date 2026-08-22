/**
 * HelpButton.test.tsx — RM-18 WP 1.2, acceptance items 6 and 7.
 *
 * D-TB5 (`.claude/rules/icon-affordances.md`) is asserted on the RENDERED control, not on the source:
 * the accessible name is present, and there is no native `title` — `title` is invisible to assistive
 * technology, which is the whole reason the rule exists.
 *
 * The route→guide behaviour is asserted by navigating: the control resolves to the mapped subject on
 * a feature page, and to the index (never nothing) on an unmapped one.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HelpButton } from "./HelpButton";

/** Renders the current pathname so a click's destination is observable. */
function Landing() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderAt(pathname: string) {
  return render(
    // The app root mounts one `TooltipProvider` (`main.tsx`), and inside the shell `SidebarProvider`
    // supplies another — `IconButton`'s Radix tooltip requires one, so the harness mounts it too.
    <MemoryRouter initialEntries={[pathname]}>
      <TooltipProvider>
        <HelpButton />
        <Routes>
          <Route path="*" element={<Landing />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("HelpButton", () => {
  it("carries an accessible name and NO native title (D-TB5)", () => {
    renderAt("/servers");
    const button = screen.getByRole("button", { name: /^Help — / });
    expect(button).toBeInTheDocument();
    expect(button.getAttribute("title")).toBeNull();
  });

  it("names the two outcomes differently, so the label is honest about which it is", () => {
    const mapped = renderAt("/servers");
    expect(screen.getByRole("button", { name: "Help — open the guide for this page" })).toBeVisible();
    mapped.unmount();

    renderAt("/advisor");
    expect(screen.getByRole("button", { name: "Help — open the user guide" })).toBeVisible();
  });

  it("navigates to the mapped subject from a feature page", () => {
    renderAt("/scans/scan_42");
    fireEvent.click(screen.getByRole("button", { name: /^Help — / }));
    expect(screen.getByTestId("pathname")).toHaveTextContent("/docs/scans-and-footprint");
  });

  it("falls back to the guide index rather than dead-ending on an unmapped page", () => {
    renderAt("/advisor");
    fireEvent.click(screen.getByRole("button", { name: /^Help — / }));
    expect(screen.getByTestId("pathname")).toHaveTextContent("/docs");
  });
});
