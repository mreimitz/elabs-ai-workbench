import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * RM-36 WP 2.1 — finding **P1-6**: "at 768px the primary actions of the two busiest pages become
 * unreachable".
 *
 * This is a **layout-real** check, not a class-level one: it runs the built SPA in Chromium at a
 * real viewport and reads `getBoundingClientRect()`. jsdom performs no layout at all (every rect is
 * zeros), so the same assertion is meaningless in `pnpm test` — it has to live here, in
 * `pnpm test:e2e`.
 *
 * WHAT IT ASSERTS. For each route × viewport × theme: every element that is (a) interactive and
 * (b) carries a non-empty accessible name must have its right edge inside the viewport, UNLESS it
 * sits inside a genuinely horizontally-scrollable ancestor (the dense runs table and the console's
 * step log both scroll internally on purpose — their columns are *reachable*, just not all at once).
 * Plus: the page's PRIMARY call to action must be visible and inside the viewport.
 *
 * WHY THE "no horizontal scroller" CLAUSE MATTERS. The defect was never "something is off-screen".
 * The page `scrollWidth` EQUALS its `clientWidth` and no ancestor scrolls, so the overflow is
 * **clipped** by `app-shell-main`'s `overflow:hidden` — "+ New run" measured x-right 958px in a
 * 768px viewport and could not be reached by any means. An element that overflows *into a scroller*
 * is a different, acceptable thing, so the check has to tell the two apart rather than banning
 * overflow outright.
 *
 * 1024 and 1280 are checked too — they are the widths WP 2.1's acceptance requires to stay clean.
 */

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** The two routes finding P1-6 measured, plus a second console fixture (an AUTOMATED run). */
const CASES = [
  { route: "/testing/runs", label: "runs feed", primary: "New run" },
  {
    route: "/testing/runs/us-engine-ended",
    label: "run console (interactive, ended)",
    primary: "Re-run with changes",
  },
  {
    route: "/testing/runs/us-engine-stalled",
    label: "run console (automated, stalled)",
    primary: "Re-run with changes",
  },
] as const;

const WIDTHS = [768, 1024, 1280] as const;
const THEMES = ["light", "dark"] as const;

type Clipped = { name: string; tag: string; right: number; classes: string };

/**
 * Runs INSIDE the page. Returns every interactive, accessibly-named element whose right edge is past
 * the viewport with no horizontally-scrollable ancestor to reach it through.
 */
const COLLECT_CLIPPED = () => {
  const INTERACTIVE =
    'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="combobox"], [tabindex]:not([tabindex="-1"])';

  const scrollsHorizontally = (el: Element): boolean => {
    const style = getComputedStyle(el);
    const scrollable =
      style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowX === "overlay";
    return scrollable && el.scrollWidth > el.clientWidth + 1;
  };

  const reachableByScrolling = (el: Element): boolean => {
    let node: Element | null = el;
    while (node) {
      if (scrollsHorizontally(node)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const out: Clipped[] = [];
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    const he = el as HTMLElement;
    if (he.closest('[aria-hidden="true"]')) continue;
    const name = (he.getAttribute("aria-label") ?? he.innerText ?? "").trim();
    if (name.length === 0) continue;
    const rect = he.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right <= window.innerWidth + 1) continue;
    if (reachableByScrolling(he)) continue;
    out.push({
      name,
      tag: he.tagName,
      right: Math.round(rect.right),
      classes: (he.className || "").toString().slice(0, 80),
    });
  }
  return out;
};

test.beforeAll(async () => {
  const dataDir = process.env.E2E_DATA_DIR;
  if (!dataDir) throw new Error("E2E_DATA_DIR not set by playwright.config.ts");
  // Same seeding recipe the Unified Sessions walk in `smoke.spec.ts` uses: write the runs straight
  // into the SQLite the built API serves, via the reusable harness. No provider key, no live LLM.
  const apiRequire = createRequire(path.resolve(rootDir, "..", "apps", "api", "package.json"));
  const Database = apiRequire("better-sqlite3") as typeof import("better-sqlite3");
  const { seedSessionGrid } = await import("../apps/api/test/support/session-seed-grid.js");
  const db = new Database(path.join(dataDir, "app.sqlite"));
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  try {
    seedSessionGrid(db);
  } finally {
    db.close();
  }
});

for (const { route, label, primary } of CASES) {
  for (const width of WIDTHS) {
    test(`P1-6 · ${label} keeps every named control on the page at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const theme of THEMES) {
        await page.goto(route);
        await page.evaluate((value) => {
          localStorage.setItem("brand-ui-theme", value);
          localStorage.setItem("mcp-token-footprint.theme-preference", value);
        }, theme);
        await page.reload();

        // The primary call to action must be there at all before we ask where it is.
        const cta = page.getByRole("button", { name: primary, exact: true }).first();
        await expect(cta, `${label} @ ${width}px (${theme}): "${primary}" must render`).toBeVisible({
          timeout: 20_000,
        });

        const box = await cta.boundingBox();
        expect(box, `${label} @ ${width}px (${theme}): "${primary}" must have a box`).not.toBeNull();
        expect(
          Math.round((box?.x ?? 0) + (box?.width ?? 0)),
          `${label} @ ${width}px (${theme}): "${primary}" right edge must be inside the viewport`,
        ).toBeLessThanOrEqual(width);

        const clipped = (await page.evaluate(COLLECT_CLIPPED)) as Clipped[];
        expect(
          clipped,
          `${label} @ ${width}px (${theme}): ${clipped.length} named control(s) overflow the viewport with NO horizontally-scrollable ancestor — i.e. clipped and unreachable:\n${clipped
            .map((c) => `  • ${c.tag} "${c.name}" right=${c.right}px  [${c.classes}]`)
            .join("\n")}`,
        ).toEqual([]);

        // Kept for the two-theme visual check the WP asks for (`test-results/` is gitignored).
        await page.screenshot({
          path: `test-results/wp21-${label.replace(/[^a-z0-9]+/gi, "-")}-${width}-${theme}.png`,
          fullPage: false,
        });
      }
    });
  }
}

/**
 * The runs feed's degrade is a COLLAPSE, so the acceptance clause "…or reachable from a visible
 * overflow control" has to be shown, not asserted away: at 768px the two navigation actions and the
 * Group-by picker must actually be inside the `⋯` menu; at 1024px and 1280px they must still be
 * inline toolbar controls with no `⋯` at all (that is the "1024/1280 unchanged" half).
 */
test("P1-6 · runs feed — the collapsed actions live in the ⋯ menu at 768px and stay inline above it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/testing/runs");

  const overflow = page.getByRole("button", { name: "More run actions", exact: true });
  await expect(overflow).toBeVisible({ timeout: 20_000 });
  // Collapsed: not standalone toolbar controls any more.
  await expect(page.getByRole("button", { name: "Compare runs", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review these…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Group by" })).toHaveCount(0);
  // …but reachable, which is the whole point of collapsing rather than clipping.
  await overflow.click();
  await expect(page.getByRole("menuitem", { name: "Compare runs" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Review these…" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "No grouping" })).toBeVisible();
  await page.keyboard.press("Escape");

  for (const width of [1024, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/testing/runs");
    await expect(page.getByRole("button", { name: "Compare runs", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Review these…", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Group by" })).toBeVisible();
    await expect(page.getByRole("button", { name: "More run actions", exact: true })).toHaveCount(0);
  }
});
