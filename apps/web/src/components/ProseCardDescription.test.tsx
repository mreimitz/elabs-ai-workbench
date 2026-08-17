import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ProseCardDescription } from "./ProseCardDescription";

// D-IC9 / finding 9 (upstream-gaps.md #5) — genuine prose must not run to the full container width
// (measured 190ch worst case). Since v4 the cap is a first-class `measure` prop on
// `CardDescription` (`max-w-prose`, ~65ch) rather than an app-side class, so this asserts the
// wrapper turns that prop on: a real DOM query can't measure rendered pixel width in jsdom, but it
// CAN assert the cap class the prop produces, and that a caller can still opt out with its own
// `max-w-*`.
describe("ProseCardDescription — measure-capped CardDescription (D-IC9)", () => {
  test("renders the description text with the prose measure cap applied", () => {
    render(<ProseCardDescription>Some prose that should not run edge to edge.</ProseCardDescription>);
    const el = screen.getByText("Some prose that should not run edge to edge.");
    expect(el.className).toContain("max-w-prose");
  });

  test("renders a real <p> (CardDescription's element) with no visual regression to its own classes", () => {
    render(<ProseCardDescription>Body copy</ProseCardDescription>);
    const el = screen.getByText("Body copy");
    expect(el.tagName).toBe("P");
    // CardDescription's own visual is untouched. (Pre-v4 this could only assert a subset:
    // `text-muted-foreground` was merged away by the package's own tailwind-merge config even with
    // no wrapper at all. That upstream quirk is fixed in v4, so the full set is asserted here.)
    expect(el.className).toContain("text-sm");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).toContain("text-balance");
  });

  test("a caller-supplied className can still override the cap (tailwind-merge, last wins)", () => {
    render(<ProseCardDescription className="max-w-none">Wide by request</ProseCardDescription>);
    const el = screen.getByText("Wide by request");
    expect(el.className).toContain("max-w-none");
    expect(el.className).not.toContain("max-w-prose");
  });
});
