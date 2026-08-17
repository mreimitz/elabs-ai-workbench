/**
 * tokens-contrast.test.ts — WP 0.1 deliverable · findings 1 (contrast) + 11 (semantic split).
 *
 * A deterministic, browser-free WCAG AA gate on the app's EFFECTIVE color tokens. It resolves each
 * `--<role>` / `--<role>-foreground` token the way the browser does — the vendored
 * `@brand/tokens` themes.css BASE, with this app's `apps/web/src/styles/app.css` override layered on
 * top (same specificity, later source order → the override wins the cascade) — then converts
 * oklch → sRGB → WCAG relative luminance and asserts:
 *
 *   1. all 5 role⇄foreground on-fill pairs (primary · success · info · destructive · warning) clear
 *      the AA 4.5:1 body-text threshold in BOTH `qlik-bright` and `qlik-dark`, and
 *   2. the two semantic splits hold: `--success !== --primary` and `--ring !== --info` in both themes.
 *
 * WHY IT READS BOTH FILES (fails-red-then-green): with the app.css override REMOVED it reads only the
 * vendored base, where `qlik-bright --primary` (4.29), `--success` (4.29), `--info` (3.74) and
 * `qlik-dark --destructive` (3.02) FAIL, and `--success === --primary` / `--ring === --info` are
 * byte-identical — so the test is red on the pre-fix tokens. With the WP 0.1 override present it is
 * green. When @brand/tokens ships the fix upstream (upstream-gaps.md items 1–2) the override block is
 * deleted and this test still passes against the un-overridden base.
 *
 * The oklch→sRGB→WCAG math mirrors @brand/tokens' own color-contrast.ts (CSS Color 4 + WCAG 2.x);
 * it is inlined here because those helpers are not part of the package's public export surface.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── oklch → sRGB → WCAG (mirror of @brand/tokens/src/color-contrast.ts) ──────────────────────────

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

/** `@brand/tokens/styles.css` exports-maps to `dist/themes.css`. */
const themesCssPath = require.resolve("@brand/tokens/styles.css");
const baseCss = readFileSync(themesCssPath, "utf8");
const appCss = readFileSync(join(__dirname, "app.css"), "utf8");

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

const THEMES = ["qlik-bright", "qlik-dark"] as const;
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

// ── The gate ─────────────────────────────────────────────────────────────────────────────────────

describe("app token contrast — WCAG AA on-fill pairs (both acme themes)", () => {
  describe.each(THEMES)("%s", (theme) => {
    it.each(FILL_ROLES)("--%s ⇄ --%s-foreground ≥ 4.5:1", (role) => {
      const ratio = contrast(token(theme, `--${role}-foreground`), token(theme, `--${role}`));
      expect(
        ratio,
        `${theme} --${role} ⇄ --${role}-foreground = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA);
    });
  });
});

describe("app token semantic split — distinct role values (both acme themes)", () => {
  it.each(THEMES)("%s: --success !== --primary", (theme) => {
    expect(
      token(theme, "--success"),
      `${theme} --success (${token(theme, "--success")}) must differ from --primary (${token(theme, "--primary")})`,
    ).not.toBe(token(theme, "--primary"));
  });

  it.each(THEMES)("%s: --ring !== --info", (theme) => {
    expect(
      token(theme, "--ring"),
      `${theme} --ring (${token(theme, "--ring")}) must differ from --info (${token(theme, "--info")})`,
    ).not.toBe(token(theme, "--info"));
  });
});
