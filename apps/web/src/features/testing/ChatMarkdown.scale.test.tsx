import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

/**
 * The two chat type scales (RM-39, owner-directed 2026-09-10).
 *
 * The run console reads at the app's body rung; the assistant dock reads one rung below it, because
 * it is a ~400px column beside the page rather than a full-width reading surface. These pin the rung
 * each scale lands on — a RUNG, never a pixel size, so the assertion still holds if the theme or the
 * density moves both of them together.
 *
 * jsdom applies no CSS, so this asserts the class that selects the rung, which is the decision this
 * component makes. What 12px versus 14px actually looks like is a browser question.
 */
function proseClasses(ui: React.ReactElement): string {
  const { container } = render(ui);
  // The prose wrapper is the element carrying the heading-ladder overrides.
  const el = container.querySelector<HTMLElement>('[class*="[&_h1]"]');
  expect(el, "the prose wrapper must render").not.toBeNull();
  return el?.className ?? "";
}

/**
 * The wrapper's OWN type rung, isolated from the `[&_hN]:` heading overrides that sit in the same
 * class list. A first cut of this file matched the whole string, so it read the heading ladder's
 * `text-meta` and stayed green when the prose rung itself was reverted to `text-body` — a probe
 * caught that. Splitting on whitespace and taking only bare `text-*` tokens is what makes the
 * assertion about the thing it names.
 */
function proseRung(ui: React.ReactElement): string[] {
  return proseClasses(ui)
    .split(/\s+/)
    .filter((token) => /^text-[a-z]+$/.test(token));
}

describe("ChatMarkdown — the two type scales", () => {
  test("the DEFAULT scale is the app's body rung (the run console)", () => {
    expect(proseRung(<ChatMarkdown text="Hello there." />)).toContain("text-body");
  });

  test('scale="compact" steps the prose one rung down (the assistant dock)', () => {
    const rung = proseRung(<ChatMarkdown text="Hello there." scale="compact" />);
    expect(rung).toContain("text-meta");
    // …and it is genuinely a STEP DOWN, not the body rung with a smaller ladder beside it.
    expect(rung).not.toContain("text-body");
  });

  test("the heading ladder steps down WITH the prose, and h1 stays above it", () => {
    const compact = proseClasses(<ChatMarkdown text="# Title" scale="compact" />);
    // h1 sits one rung above the compact prose (body over meta) …
    expect(compact).toContain("[&_h1]:!text-body");
    // … and the rest land on the prose rung itself.
    expect(compact).toContain("[&_h2]:!text-meta");
    expect(compact).toContain("[&_h6]:!text-meta");
  });

  test("neither scale uses a RAW Tailwind type utility", () => {
    // `text-sm` / `text-base` bypass the semantic scale entirely — the styling rule wants the
    // token-backed rungs, which are what move with the theme.
    for (const scale of ["body", "compact"] as const) {
      const cls = proseClasses(<ChatMarkdown text="Hello." scale={scale} />);
      expect(cls, `${scale} must not carry a raw type utility`).not.toMatch(
        /\btext-(sm|base|lg|xl)\b/,
      );
    }
  });
});
