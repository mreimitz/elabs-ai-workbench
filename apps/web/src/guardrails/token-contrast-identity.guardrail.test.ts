/**
 * token-contrast-identity.guardrail.test.ts — interface-craft WP 4.1 guardrail (D-IC1 + D-IC2).
 *
 * This is the CI GUARDRAIL layer, distinct from — and additive to — the WP 0.1 phase deliverable
 * `apps/web/src/styles/tokens-contrast.test.ts` (which this WP is contractually forbidden to edit).
 * Where the phase test proves the fix once, THIS file's job is to make the fix un-droppable: if the
 * `apps/web/src/styles/app.css` D-IC1/D-IC2 override block were deleted or weakened (a re-merge from
 * the un-fixed vendored base), or if the phase test itself were deleted/loosened, this guardrail goes
 * RED. It asserts four independent things:
 *
 *   1. D-IC1 — every `--<role>` ⇄ `--<role>-foreground` fill pair clears WCAG AA 4.5:1 in BOTH
 *      acme themes, computed on the EFFECTIVE tokens (vendored themes.css base + app.css override
 *      layered on top, same resolution the browser does). Remove the override → contrast goes red.
 *   2. D-IC2 — `--success !== --primary` AND `--ring !== --info` in both themes (the semantic split
 *      that a naive re-merge collapses back to byte-identical values).
 *   3. STRUCTURAL — the app.css override block is present for both themes AND appears AFTER the
 *      `@import "@elabs-ai/components-tokens/styles.css"` (so it wins the cascade — moving it before the import
 *      would silently un-fix everything while every value still "looks right" in the file).
 *   4. META — the WP 0.1 phase gate `tokens-contrast.test.ts` still exists and still carries its
 *      load-bearing assertions (the 4.5 threshold, both themes, all five fill roles, the two identity
 *      checks) — so the primary gate can't be quietly deleted or weakened out from under this one.
 *
 * The oklch→sRGB→WCAG math mirrors @elabs-ai/components-tokens' own color-contrast.ts (CSS Color 4 + WCAG 2.x),
 * inlined because those helpers aren't part of the package's public export surface. Self-containment
 * is deliberate: a guardrail must not depend on the thing it guards.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── oklch → sRGB → WCAG (mirror of @elabs-ai/components-tokens/src/color-contrast.ts) ──────────────────────────

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function parseOklch(input: string): Oklch {
  const m = input.trim().match(/^oklch\(\s*([^)]+)\)$/i);
  const body = m?.[1];
  if (body == null) throw new Error(`Not an oklch() color: ${input}`);
  const coords = (body.split("/")[0] ?? "").trim();
  const parts = coords.split(/\s+/).filter(Boolean);
  if (parts.length < 3) throw new Error(`Malformed oklch(): ${input}`);
  const [l, c, h] = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  if ([l, c, h].some((n) => Number.isNaN(n))) throw new Error(`Non-numeric oklch: ${input}`);
  return { l, c, h };
}

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToSrgb(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

function oklchToSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const [lr, lg, lb] = oklabToLinearSrgb(l, c * Math.cos(hr), c * Math.sin(hr));
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21) between two raw `oklch(...)` strings. */
function contrast(fg: string, bg: string): number {
  const lf = relativeLuminance(oklchToSrgb(parseOklch(fg)));
  const lb = relativeLuminance(oklchToSrgb(parseOklch(bg)));
  const [hi, lo] = lf >= lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Read the BASE (vendored themes.css) + the app OVERRIDE (app.css) and resolve the cascade ─────

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** `@elabs-ai/components-tokens/styles.css` exports-maps to `dist/themes.css`. */
const themesCssPath = require.resolve("@elabs-ai/components-tokens/styles.css");
const baseCss = readFileSync(themesCssPath, "utf8");
const appCssPath = join(__dirname, "..", "styles", "app.css");
const appCss = readFileSync(appCssPath, "utf8");

/** Every `[data-theme="name"] { … }` block body in a stylesheet (there may be more than one). */
function themeBlockBodies(css: string, name: string): string[] {
  const re = new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1] ?? "");
}

/** All `--token: oklch(...)` declarations in a block body → map (last write wins). */
function tokenMap(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(oklch\([^;]+\))\s*;/g)) {
    if (m[1] && m[2]) map[m[1]] = m[2].trim();
  }
  return map;
}

/** Effective per-theme tokens: base themes.css, then every app.css override block layered on top. */
function resolveTheme(name: string): Record<string, string> {
  const effective: Record<string, string> = {};
  for (const body of themeBlockBodies(baseCss, name)) Object.assign(effective, tokenMap(body));
  for (const body of themeBlockBodies(appCss, name)) Object.assign(effective, tokenMap(body));
  return effective;
}

const THEMES = ["light", "dark"] as const;
const TOKENS: Record<string, Record<string, string>> = Object.fromEntries(
  THEMES.map((t) => [t, resolveTheme(t)]),
);

/** The 5 fill roles whose `-foreground` ink is rendered on a colored plate. */
const FILL_ROLES = ["primary", "success", "info", "destructive", "warning"] as const;
const AA = 4.5;

function token(theme: string, name: string): string {
  const v = TOKENS[theme]?.[name];
  if (!v) throw new Error(`${theme} is missing ${name}`);
  return v;
}

// ── 1. D-IC1 — on-fill contrast (effective tokens, both themes) ──────────────────────────────────

describe("GUARDRAIL D-IC1 — on-fill contrast ≥ 4.5:1 (effective tokens, both acme themes)", () => {
  describe.each(THEMES)("%s", (theme) => {
    it.each(FILL_ROLES)("--%s ⇄ --%s-foreground clears AA", (role) => {
      const ratio = contrast(token(theme, `--${role}-foreground`), token(theme, `--${role}`));
      expect(
        ratio,
        `${theme} --${role} ⇄ --${role}-foreground = ${ratio.toFixed(2)}:1 (must be ≥ ${AA})`,
      ).toBeGreaterThanOrEqual(AA);
    });
  });
});

// ── 2. D-IC2 — semantic identity split (effective tokens, both themes) ────────────────────────────

describe("GUARDRAIL D-IC2 — role identity split (effective tokens, both acme themes)", () => {
  it.each(THEMES)("%s: --success is not byte-identical to --primary", (theme) => {
    expect(
      token(theme, "--success"),
      `${theme} --success (${token(theme, "--success")}) must differ from --primary (${token(theme, "--primary")})`,
    ).not.toBe(token(theme, "--primary"));
  });

  it.each(THEMES)("%s: --ring is not byte-identical to --info", (theme) => {
    expect(
      token(theme, "--ring"),
      `${theme} --ring (${token(theme, "--ring")}) must differ from --info (${token(theme, "--info")})`,
    ).not.toBe(token(theme, "--info"));
  });
});

// ── 3. STRUCTURAL — the override block is present AND wins the cascade ─────────────────────────────

describe("GUARDRAIL D-IC1/D-IC2 — app.css override block present + after the token import", () => {
  it("defines a [data-theme] override block for BOTH acme themes", () => {
    for (const theme of THEMES) {
      expect(
        themeBlockBodies(appCss, theme).length,
        `app.css must carry a [data-theme="${theme}"] override block`,
      ).toBeGreaterThan(0);
    }
  });

  it("the override block layers AFTER @import '@elabs-ai/components-tokens/styles.css' (so it wins the cascade)", () => {
    const importIdx = appCss.indexOf('@import "@elabs-ai/components-tokens/styles.css"');
    const overrideIdx = appCss.indexOf('[data-theme="light"]');
    expect(importIdx, "app.css must import @elabs-ai/components-tokens/styles.css").toBeGreaterThanOrEqual(0);
    expect(overrideIdx, "app.css must carry the light override block").toBeGreaterThanOrEqual(0);
    expect(
      overrideIdx,
      "the [data-theme] override must appear AFTER the token @import to win same-specificity cascade",
    ).toBeGreaterThan(importIdx);
  });

  it("the override actually re-points the roles the split/contrast fix depends on", () => {
    // light: all four (primary/info/success/ring) are re-pointed in-block.
    const bright = tokenMap(themeBlockBodies(appCss, "light").join("\n"));
    for (const role of ["--primary", "--info", "--success", "--ring"]) {
      expect(bright[role], `light override must set ${role}`).toBeTruthy();
    }
    // dark: the split roles + the destructive-ink fix.
    const dark = tokenMap(themeBlockBodies(appCss, "dark").join("\n"));
    for (const role of ["--success", "--ring", "--destructive-foreground"]) {
      expect(dark[role], `dark override must set ${role}`).toBeTruthy();
    }
  });
});

// ── 4. META — the WP 0.1 phase gate can't be silently deleted or weakened ─────────────────────────

describe("GUARDRAIL D-IC1/D-IC2 — the phase gate tokens-contrast.test.ts stays strong", () => {
  const phaseTestPath = join(__dirname, "..", "styles", "tokens-contrast.test.ts");
  let phaseTest = "";
  try {
    phaseTest = readFileSync(phaseTestPath, "utf8");
  } catch {
    phaseTest = "";
  }

  it("the WP 0.1 phase gate file still exists", () => {
    expect(phaseTest, "apps/web/src/styles/tokens-contrast.test.ts must not be deleted").not.toBe("");
  });

  it("still asserts the AA 4.5 threshold, both themes, all five fill roles, and both identity splits", () => {
    // Threshold + gate. (`const AA = 4.5` and a `toBeGreaterThanOrEqual` on the ratio.)
    expect(phaseTest).toMatch(/AA\s*=\s*4\.5/);
    expect(phaseTest).toMatch(/toBeGreaterThanOrEqual\(AA\)/);
    // Both themes.
    expect(phaseTest).toContain("light");
    expect(phaseTest).toContain("dark");
    // All five fill roles are enumerated in the gate.
    for (const role of FILL_ROLES) {
      expect(phaseTest, `phase gate must still cover the ${role} role`).toContain(`"${role}"`);
    }
    // The two identity splits.
    expect(phaseTest).toContain("--success !== --primary");
    expect(phaseTest).toContain("--ring !== --info");
  });
});
