import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ProseCardDescription } from "./ProseCardDescription";

// D-IC9 / finding 9 (upstream-gaps.md #5) — `CardDescription` has no measure cap, so genuine prose
// runs to the full container width (measured 190ch worst case). This locks the app-side override:
// a real DOM query can't measure rendered pixel width in jsdom, but it CAN assert the cap class is
// present by construction (`max-w-[68ch]` bounds the line to ~68 characters regardless of container
// width) and that a caller can still opt out with its own `max-w-*`.
describe("ProseCardDescription — measure-capped CardDescription (D-IC9)", () => {
  test("renders the description text with the ~68ch measure cap applied", () => {
    render(<ProseCardDescription>Some prose that should not run edge to edge.</ProseCardDescription>);
    const el = screen.getByText("Some prose that should not run edge to edge.");
    expect(el.className).toContain("max-w-[68ch]");
  });

  test("renders a real <p> (CardDescription's element) with no visual regression to its own classes", () => {
    render(<ProseCardDescription>Body copy</ProseCardDescription>);
    const el = screen.getByText("Body copy");
    expect(el.tagName).toBe("P");
    // CardDescription's own visual is untouched. NOTE: `text-muted-foreground` is present in
    // vendor CardDescription's source (`cn("text-sm text-muted-foreground text-wrap-balance", …)`)
    // but is merged away by @elabs-ai/components-ui's own tailwind-merge config even with NO wrapper/className at
    // all (a pre-existing upstream quirk, reproduced independently of this wrapper) — so this only
    // asserts the classes that do survive, to avoid asserting a false regression.
    expect(el.className).toContain("text-sm");
    expect(el.className).toContain("text-wrap-balance");
  });

  test("a caller-supplied className can still override the cap (tailwind-merge, last wins)", () => {
    render(<ProseCardDescription className="max-w-none">Wide by request</ProseCardDescription>);
    const el = screen.getByText("Wide by request");
    expect(el.className).toContain("max-w-none");
    expect(el.className).not.toContain("max-w-[68ch]");
  });
});
