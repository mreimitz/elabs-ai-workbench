import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BrandLogo } from "@elabs-ai/components-icons";

// The brand mark ships TWICE in this app: as the sidebar app icon (`AppIcon morph="mark"`, which
// renders `BrandLogo variant="mark"`) and as the browser-tab favicon (`public/favicon.svg`). The
// favicon renders outside the app, so it cannot use the component or the theme tokens — it is a
// hand-synced copy, and a copy drifts. This test is the teeth on that: it compares the actual drawn
// geometry, so re-tuning the mark upstream (a `@elabs-ai/components-icons` bump) fails the gate
// instead of shipping two different logos in one product.
//
// Colour is deliberately EXCLUDED from the comparison: the component carries tokens
// (`var(--brand-mark-ring)` / `var(--brand-mark-tail)`) while the standalone asset must carry
// literals resolved from those same tokens.
//
// `import.meta.url` is an http URL under vite/jsdom, so the asset is resolved from the process cwd
// instead: `apps/web` when vitest runs (its own `test` script, and `pnpm -r … test` from the root),
// with the repo root accepted too so an ad-hoc invocation from either place works. A missing file
// throws rather than silently skipping — the whole point is that the copy cannot go unchecked.
const FAVICON_PATH = ["public/favicon.svg", "apps/web/public/favicon.svg"]
  .map((rel) => resolve(process.cwd(), rel))
  .find((path) => existsSync(path));
if (FAVICON_PATH === undefined) throw new Error("favicon.svg not found from cwd " + process.cwd());
const FAVICON = readFileSync(FAVICON_PATH, "utf8");

/** Every drawn shape's coordinates, in document order. */
function geometry(svg: string): string[] {
  const attrs = (tag: string, names: string[]) =>
    [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => {
      const el = m[0] ?? "";
      const read = (n: string) => el.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1] ?? "";
      return `${tag}:${names.map(read).join(",")}`;
    });
  return [
    ...attrs("rect", ["x", "y", "width", "height", "stroke-dasharray", "stroke-width"]),
    ...attrs("circle", ["cx", "cy", "r"]),
    ...attrs("line", ["x1", "y1", "x2", "y2"]),
  ];
}

describe("the favicon is the same mark as the sidebar app icon", () => {
  const { container } = render(<BrandLogo variant="mark" title="AI Workbench" />);
  const component = geometry(container.innerHTML);

  test("the component draws something to compare (guards a vacuous pass)", () => {
    // square + clip circle + outline circle + 2 register dots + hatch + 2 stray strokes
    expect(component.length).toBeGreaterThan(10);
  });

  test("the favicon's geometry matches BrandLogo's mark shape-for-shape", () => {
    expect(geometry(FAVICON)).toEqual(component);
  });

  test("the favicon paints no `currentColor` (it has no surrounding text colour to inherit)", () => {
    // Comments stripped first — the file DOCUMENTS why the component's `currentColor` ink had to be
    // pinned to a literal here, and that prose must not satisfy the check.
    expect(FAVICON.replace(/<!--[\s\S]*?-->/g, "")).not.toContain("currentColor");
  });
});
