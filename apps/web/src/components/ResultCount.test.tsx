import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { formatFilteredCount, ResultCount } from "./ResultCount";

// Locks the WP 1.2 (finding 7) contract: a filtered-result count is a STABLE, always-present
// `role="status"` whose TEXT updates — unlike the app's `role="alert"`s, which are conditionally
// mounted/unmounted with the event they report. The test that matters most here re-renders the
// SAME element with new count props and asserts the DOM node identity never changes — only its
// text content does — because that persistence (not a mount/unmount) is what makes a screen
// reader's polite queue reliably pick up the update.

describe("ResultCount — the stable count readout (interface-craft WP 1.2, finding 7)", () => {
  test("renders as a role=status region with aria-live=polite and aria-atomic=true", () => {
    render(<ResultCount>12 of 90 rows</ResultCount>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("12 of 90 rows");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });

  test("the SAME DOM node stays mounted across a count change — only its text updates", () => {
    const { rerender } = render(<ResultCount>12 of 90 rows</ResultCount>);
    const before = screen.getByRole("status");

    rerender(<ResultCount>33 of 90 rows</ResultCount>);
    const after = screen.getByRole("status");

    // Same element identity (no unmount/remount) — this is the guarantee that distinguishes
    // ResultCount from the app's conditionally-mounted `role="alert"`s.
    expect(after).toBe(before);
    expect(after).toHaveTextContent("33 of 90 rows");
  });

  test("renders the standard tabular-nums count-badge visual (a @brand/ui Badge) inside the status region", () => {
    render(<ResultCount>90 scans</ResultCount>);
    const status = screen.getByRole("status");
    // The live-region role comes from the semantic `<output>` element itself (implicit role, no raw
    // `role` attribute — see the useSemanticElements rationale in ResultCount.tsx); the visual Badge
    // is its child.
    expect(status.tagName).toBe("OUTPUT");
    const badge = status.firstElementChild as HTMLElement;
    expect(badge.className).toContain("tabular-nums");
  });

  test("className is a layout-only escape hatch merged onto the inner badge", () => {
    render(<ResultCount className="my-layout-tweak">90 scans</ResultCount>);
    const badge = screen.getByRole("status").firstElementChild as HTMLElement;
    expect(badge.className).toContain("my-layout-tweak");
  });
});

// T10 hardening: the structured filteredCount/totalCount/noun API is the ONE place "N of M noun" is
// composed, so a caller can no longer hand the badge a string that claims to be filtered while
// actually being the bare unfiltered total (the bug this test guards against: a "101 scans" readout
// announced over an empty filtered table).
describe("ResultCount — structured filteredCount/totalCount/noun API (T10)", () => {
  test("reflects the FILTERED count, not the total, when they differ", () => {
    render(<ResultCount filteredCount={0} totalCount={101} noun="scans" />);
    const status = screen.getByRole("status");
    // The filtered count (0) must be visible in the announced text — never just the total.
    expect(status).toHaveTextContent("0 of 101 scans");
    expect(status).not.toHaveTextContent(/^101 scans$/);
  });

  test("collapses to just the total when filtered === total (no filter narrowing anything)", () => {
    render(<ResultCount filteredCount={12} totalCount={12} noun="issues" />);
    expect(screen.getByRole("status")).toHaveTextContent("12 issues");
  });

  test("formatFilteredCount composes the same text the component renders (single source of truth)", () => {
    expect(formatFilteredCount(5, 12, "issues")).toBe("5 of 12 issues");
    expect(formatFilteredCount(12, 12, "issues")).toBe("12 issues");
  });
});
