import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AlertTitle } from "@elabs-ai/components-ui";
import { AlertHeading } from "./AlertHeading";

// Locks the fix for critique 2026-07-25T20-00-10Z item 2 (T9): `@elabs-ai/components-ui` AlertTitle always renders
// a literal <h5>, producing H1→H5 jumps. AlertHeading renders a REAL heading at the level the call
// site asks for, with the exact AlertTitle visual, so the outline stays correct with no visual change.

describe("AlertHeading — alert titles at the correct outline level", () => {
  test("defaults to <h5> (aria-level 5) — matches @elabs-ai/components-ui AlertTitle's own hardcoded level", () => {
    render(<AlertHeading>Something failed</AlertHeading>);
    const heading = screen.getByRole("heading", { name: "Something failed", level: 5 });
    expect(heading.tagName).toBe("H5");
  });

  test("level={2} renders a real <h2> at aria-level 2 (an alert that IS the page's main content)", () => {
    render(<AlertHeading level={2}>Scan failed</AlertHeading>);
    const heading = screen.getByRole("heading", { name: "Scan failed", level: 2 });
    expect(heading.tagName).toBe("H2");
  });

  test("level={3} renders a real <h3> at aria-level 3 (nested under a card's own h2)", () => {
    render(<AlertHeading level={3}>Unauthorized</AlertHeading>);
    const heading = screen.getByRole("heading", { name: "Unauthorized", level: 3 });
    expect(heading.tagName).toBe("H3");
  });

  test("carries the exact visual of @elabs-ai/components-ui AlertTitle (same look, real + correct heading level)", () => {
    const { container: headingContainer } = render(<AlertHeading level={2}>Findings</AlertHeading>);
    const heading = screen.getByRole("heading", { name: "Findings" });
    expect(heading.className).toContain("font-medium");
    expect(heading.className).toContain("leading-none");
    expect(heading.className).toContain("tracking-tight");

    // Cross-check against the real AlertTitle: identical class set, only the TAG differs (h5 → h2).
    const { container: titleContainer } = render(<AlertTitle>Findings</AlertTitle>);
    const alertTitle = titleContainer.firstElementChild as HTMLElement;
    expect(alertTitle.tagName).toBe("H5");
    expect(alertTitle.className).toBe(heading.className);
    expect(headingContainer.querySelector("h2")).not.toBeNull();
  });

  test("className is merged for layout only and passes through arbitrary HTML attributes", () => {
    render(
      <AlertHeading level={2} className="mb-2" id="scan-failed-title" data-testid="ah">
        Findings
      </AlertHeading>,
    );
    const heading = screen.getByTestId("ah");
    expect(heading.className).toContain("mb-2");
    expect(heading.className).toContain("font-medium");
    expect(heading).toHaveAttribute("id", "scan-failed-title");
  });
});
