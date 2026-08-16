/**
 * type-scale.guardrail.test.ts — T1 (design-remediation) guardrail: the type scale keeps real
 * hierarchy.
 *
 * The critique measured the whole product living between 11–22px: display(h1) computed to 18px
 * against 13px body — a 1.38× ratio — and title(h3) rendered at the same size as body. T1 rebuilt
 * the scale in `apps/web/src/styles/app.css` (the `[data-density="compact"]` type block — the app
 * ships compact by default, so this is what renders). This guardrail makes that rebuild
 * un-droppable: if someone re-compresses the scale (a re-merge of the old dense pass, or trims the
 * KPI rung back toward body), the invariants below go RED.
 *
 * jsdom does NOT compute Tailwind/CSS-var font sizes, so — like `prose-measure.guardrail.test.ts`
 * and `token-contrast-identity.guardrail.test.ts` — this asserts on the PARSED token rem values read
 * straight from the stylesheet, not on `getComputedStyle`.
 *
 * It asserts, on the effective compact `--text-<role>` tokens:
 *   1. HEADROOM   — display : body ≥ 1.6× (the "no hierarchy" defect was 1.38×).
 *   2. HERO RUNG  — a KPI/headline-metric step exists STRICTLY ABOVE h1 (kpi > display), so the
 *                   number this product exists to produce is not styled as a caption.
 *   3. MONOTONIC  — meta < caption < body < subtitle < title < display, and kpi ≥ display, so every
 *                   role is a distinct, ordered step (title == body was the h3-reads-as-body defect).
 *   4. LOCKSTEP   — the raw Tailwind steps moved with the roles: --text-2xl (the raw h1 rung the
 *                   critique measured at 18px) tracks display, and --text-3xl tracks the KPI rung —
 *                   so @brand/* components that consume the raw steps directly grow in step with the
 *                   semantic roles instead of drifting back to the old compressed values.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCssPath = join(__dirname, "..", "styles", "app.css");
const appCss = readFileSync(appCssPath, "utf8");

/**
 * Every `--text-<name>: <n>rem` SIZE declaration in the stylesheet → px (rem × 16), last write wins.
 * The `[& name]:` char class is `[a-z0-9]+`, which never matches the `-` in a `--text-<name>--line-height`
 * companion (there is no `:` directly after the size name there), so line-height rows are excluded.
 * The `--text-*` size tokens live ONLY in the compact type block, so scanning the whole file is
 * unambiguous (the print block rescales via `font-size`, not `--text-*`).
 */
function textSizesPx(css: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of css.matchAll(/--text-([a-z0-9]+):\s*([\d.]+)rem\s*;/gi)) {
    const name = m[1];
    const rem = Number(m[2]);
    if (name && !Number.isNaN(rem)) out[name] = rem * 16;
  }
  return out;
}

const SIZES = textSizesPx(appCss);

/** Semantic role tokens, in the order the scale must strictly ascend (kpi sits at/above display). */
const ROLE_ORDER = ["meta", "caption", "body", "subtitle", "title", "display"] as const;

function px(role: string): number {
  const v = SIZES[role];
  if (v == null) throw new Error(`app.css is missing a --text-${role} size declaration`);
  return v;
}

describe("GUARDRAIL T1 — the type scale is present and complete", () => {
  it.each([...ROLE_ORDER, "kpi"])("defines a --text-%s size token", (role) => {
    expect(SIZES[role], `app.css must declare --text-${role}`).toBeTypeOf("number");
    expect(SIZES[role], `--text-${role} must be a positive size`).toBeGreaterThan(0);
  });
});

describe("GUARDRAIL T1 — real typographic headroom", () => {
  it("display : body clears 1.6× (the 'no hierarchy' defect was ~1.38×)", () => {
    const ratio = px("display") / px("body");
    expect(
      ratio,
      `--text-display (${px("display")}px) / --text-body (${px("body")}px) = ${ratio.toFixed(3)}× — must be ≥ 1.6×`,
    ).toBeGreaterThanOrEqual(1.6);
  });

  it("a headline-metric (KPI) rung exists STRICTLY above the h1/display step", () => {
    expect(
      px("kpi"),
      `--text-kpi (${px("kpi")}px) must be strictly larger than --text-display (${px("display")}px) — the headline number must out-size h1`,
    ).toBeGreaterThan(px("display"));
  });
});

/** Each adjacent (smaller, larger) pair the scale must strictly ascend through. */
const ASCENDING_PAIRS: ReadonlyArray<readonly [string, string]> = ROLE_ORDER.slice(0, -1).map(
  (role, i) => [role, ROLE_ORDER[i + 1] ?? role] as const,
);

describe("GUARDRAIL T1 — the scale is strictly monotonic", () => {
  it.each(ASCENDING_PAIRS)("--text-%s < --text-%s", (smaller, larger) => {
    expect(
      px(larger),
      `--text-${larger} (${px(larger)}px) must be strictly larger than --text-${smaller} (${px(smaller)}px)`,
    ).toBeGreaterThan(px(smaller));
  });

  it("kpi ≥ display (the top two rungs, headline metric at/above h1)", () => {
    expect(px("kpi")).toBeGreaterThanOrEqual(px("display"));
  });
});

describe("GUARDRAIL T1 — raw Tailwind steps moved in lockstep with the roles", () => {
  it("--text-2xl (the raw h1 rung, measured 18px in the defect) tracks display", () => {
    expect(SIZES["2xl"], "app.css must declare --text-2xl").toBeTypeOf("number");
    expect(
      SIZES["2xl"],
      `--text-2xl (${SIZES["2xl"]}px) must reach the display/h1 rung (${px("display")}px), not fall back to the old 18px`,
    ).toBeGreaterThanOrEqual(px("display"));
  });

  it("--text-3xl (the raw KPI rung) tracks the headline-metric rung, above display", () => {
    expect(SIZES["3xl"], "app.css must declare --text-3xl").toBeTypeOf("number");
    expect(
      SIZES["3xl"],
      `--text-3xl (${SIZES["3xl"]}px) must reach the KPI headline rung, above display (${px("display")}px)`,
    ).toBeGreaterThan(px("display"));
  });

  it("the smallest raw step (--text-xs) is at least 12px (no sub-12px floor)", () => {
    expect(SIZES.xs, "app.css must declare --text-xs").toBeTypeOf("number");
    expect(SIZES.xs, `--text-xs (${SIZES.xs}px) must be ≥ 12px`).toBeGreaterThanOrEqual(12);
  });
});
