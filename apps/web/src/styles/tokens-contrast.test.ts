/**
 * tokens-contrast.test.ts — the app's WCAG gate on its EFFECTIVE color tokens.
 *
 * A deterministic, browser-free check. It resolves each token the way the browser does — the
 * installed `@elabs-ai/components-tokens` PER-THEME stylesheet as the base, with this app's
 * `apps/web/src/styles/app.css` override layered on top (same specificity, later source order → the
 * override wins the cascade) — then converts oklch → sRGB → WCAG relative luminance and asserts:
 *
 *   1. all 5 role⇄foreground on-fill pairs (primary · success · info · destructive · warning) clear
 *      the AA 4.5:1 body-text threshold in BOTH `light` and `dark`;
 *   2. the two semantic splits hold: `--success !== --primary` and `--ring !== --info`; and
 *   3. the FOCUS RING clears the 3:1 non-text threshold (WCAG 2.4.7 / 1.4.11) against every surface
 *      it can be drawn on, in both themes.
 *
 * (3) is the load-bearing one post-v4. Upstream ships `--ring: var(--primary)` — the brand lime —
 * which on `light` measures 1.30–1.42:1 and is invisible focus for a keyboard user. That is a
 * documented, deliberate upstream tradeoff, so this app overrides `--ring` / `--sidebar-ring` in a
 * `[data-theme="light"]` block (see app.css). This assertion is what stops that override being
 * dropped in a future re-merge. `dark` is left on the upstream lime, which measures 12.46:1.
 *
 * (1) and (2) are now satisfied by upstream on its own — v4 fixed the four AA failures and the
 * role collapses this file was originally written against. They stay as regression gates.
 *
 * WHY IT READS THE PER-THEME FILES: since v4 theme CSS is opt-in and `styles.css` is engine-only,
 * carrying no `[data-theme]` blocks. Reading `styles.css` here would resolve every token to
 * `undefined`. It reads exactly the two stylesheets `app.css` imports.
 *
 * The oklch→sRGB→WCAG math mirrors the package's own color-contrast module (CSS Color 4 + WCAG 2.x);
 * it is inlined here because those helpers are not part of the package's public export surface.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── oklch → sRGB → WCAG (mirror of the tokens package's own color-contrast module) ──────────────

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

// ── Read the BASE (per-theme stylesheet) + the app OVERRIDE (app.css) and resolve the cascade ────

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Since v4, theme CSS is OPT-IN: `@elabs-ai/components-tokens/styles.css` is the ENGINE only and
 * carries no `[data-theme]` blocks at all. Each theme ships as its own stylesheet, which the app
 * imports explicitly in `app.css`. Read exactly the files `app.css` imports — reading `styles.css`
 * here would silently resolve every token to `undefined` and pass nothing.
 */
const BASE_CSS_SPECIFIER: Record<string, string> = {
  light: "@elabs-ai/components-tokens/themes/light.css",
  dark: "@elabs-ai/components-tokens/themes/dark.css",
};

const appCss = readFileSync(join(__dirname, "app.css"), "utf8");

/** Every `[data-theme="name"] { … }` block body in a stylesheet (there may be more than one). */
function themeBlockBodies(css: string, name: string): string[] {
  const re = new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1] ?? "");
}

/**
 * All custom-property declarations in a block body → map (last write wins).
 *
 * Captures ANY value, not just `oklch(...)`: v4 themes alias roles at the token layer
 * (`--ring: var(--primary)`, `--sidebar-ring: var(--ring)`), so an oklch-only regex would drop
 * exactly the tokens this file has to assert on. `deref` below resolves the indirection.
 */
function tokenMap(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    if (m[1] && m[2]) map[m[1]] = m[2].trim();
  }
  return map;
}

/** Follow `var(--other)` aliases to the concrete value (bounded, so a cycle can't hang the run). */
function deref(map: Record<string, string>, value: string | undefined): string | undefined {
  let current = value;
  for (let hops = 0; current?.startsWith("var(") && hops < 8; hops++) {
    current = map[current.slice(4, -1).trim()];
  }
  return current;
}

/** Effective per-theme tokens: the theme stylesheet, then every app.css override block on top. */
function resolveTheme(name: string): Record<string, string> {
  const specifier = BASE_CSS_SPECIFIER[name];
  if (!specifier) throw new Error(`No base stylesheet mapped for theme "${name}"`);
  const baseCss = readFileSync(require.resolve(specifier), "utf8");

  const raw: Record<string, string> = {};
  for (const body of themeBlockBodies(baseCss, name)) Object.assign(raw, tokenMap(body));
  for (const body of themeBlockBodies(appCss, name)) Object.assign(raw, tokenMap(body));

  // Flatten aliases so callers always see a concrete color, and drop anything that isn't one
  // (shadow ramps, numeric scalars) so a bad read fails loudly instead of comparing garbage.
  const effective: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    const value = deref(raw, raw[key]);
    if (value?.startsWith("oklch(")) effective[key] = value;
  }
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

// ── The gate ─────────────────────────────────────────────────────────────────────────────────────

/** WCAG 2.4.7 / 1.4.11 — a focus indicator is non-text UI; it needs 3:1 against adjacent color. */
const NON_TEXT_AA = 3;

/**
 * The surfaces a focus ring can land on, split by which ring token governs them. The light theme
 * puts a DARK sidebar rail inside a light content area, so one blue cannot serve both — which is
 * exactly why the theme contract carries a separate `--sidebar-ring`.
 */
const RING_SURFACES: Record<string, readonly string[]> = {
  "--ring": ["--background", "--card", "--muted", "--popover", "--accent", "--input", "--border"],
  "--sidebar-ring": ["--sidebar", "--sidebar-accent", "--sidebar-border"],
};

describe("app token contrast — WCAG AA on-fill pairs (both themes)", () => {
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

describe("focus ring visibility — WCAG 2.4.7 / 1.4.11 non-text 3:1 (both themes)", () => {
  describe.each(THEMES)("%s", (theme) => {
    for (const [ringToken, surfaces] of Object.entries(RING_SURFACES)) {
      it.each(surfaces)(`${ringToken} vs %s ≥ 3:1`, (surface) => {
        const ratio = contrast(token(theme, ringToken), token(theme, surface));
        expect(
          ratio,
          `${theme} ${ringToken} (${token(theme, ringToken)}) on ${surface} = ${ratio.toFixed(2)}:1 — ` +
            "a keyboard user must be able to SEE focus. Upstream ships --ring: var(--primary) " +
            "(brand lime), which fails this on light; app.css overrides it there.",
        ).toBeGreaterThanOrEqual(NON_TEXT_AA);
      });
    }
  });
});

describe("app token semantic split — distinct role values (both themes)", () => {
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
