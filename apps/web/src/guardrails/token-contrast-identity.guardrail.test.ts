/**
 * token-contrast-identity.guardrail.test.ts — interface-craft WP 4.1 guardrail (D-IC1 + D-IC2).
 *
 * This is the CI GUARDRAIL layer, distinct from — and additive to — the phase gate
 * `apps/web/src/styles/tokens-contrast.test.ts`. Where the phase test proves the tokens are right,
 * THIS file's job is to make that un-droppable: if the `apps/web/src/styles/app.css` override block
 * were deleted or weakened, if a theme stylesheet stopped being imported, or if the phase test were
 * deleted/loosened, this guardrail goes RED. It asserts four independent things:
 *
 *   1. every `--<role>` ⇄ `--<role>-foreground` fill pair clears WCAG AA 4.5:1 in BOTH themes,
 *      computed on the EFFECTIVE tokens (the per-theme stylesheet + app.css override layered on
 *      top, the same resolution the browser does);
 *   2. D-IC2 — `--success !== --primary` AND `--ring !== --info` in both themes (the semantic split
 *      that a naive re-merge collapses back to byte-identical values);
 *   3. STRUCTURAL — app.css opts in to BOTH theme stylesheets (since v4 `styles.css` is engine-only
 *      and carries no `[data-theme]` blocks, so importing it alone renders the app unthemed), each
 *      resolves on disk, and the app's override block appears AFTER those imports so it wins the
 *      same-specificity cascade. It also pins the LIGHT focus-ring fix (`--ring` +
 *      `--sidebar-ring`): upstream v4 ships `--ring: var(--primary)` — the brand lime — which
 *      measures 1.30–1.42:1 on light and is invisible focus for a keyboard user. That override is
 *      an accessibility commitment, not a preference, so dropping it must go red.
 *   4. META — the phase gate still exists and still carries its load-bearing assertions (the 4.5
 *      threshold, the 3:1 non-text ring threshold, both themes, all five fill roles, the identity
 *      splits, and that it reads the per-theme stylesheets rather than the engine-only styles.css)
 *      — so the primary gate can't be quietly deleted or weakened out from under this one.
 *
 * The oklch→sRGB→WCAG math mirrors the package's own color-contrast module (CSS Color 4 + WCAG 2.x),
 * inlined because those helpers aren't part of the package's public export surface. Self-containment
 * is deliberate: a guardrail must not depend on the thing it guards.
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
 * Since v4 theme CSS is OPT-IN: `styles.css` is the ENGINE only and carries no `[data-theme]`
 * blocks; each theme ships as its own stylesheet. Read exactly the ones `app.css` imports.
 */
const BASE_CSS_SPECIFIER: Record<string, string> = {
  light: "@elabs-ai/components-tokens/themes/light.css",
  dark: "@elabs-ai/components-tokens/themes/dark.css",
};

const appCssPath = join(__dirname, "..", "styles", "app.css");
const appCss = readFileSync(appCssPath, "utf8");

/** Every `[data-theme="name"] { … }` block body in a stylesheet (there may be more than one). */
function themeBlockBodies(css: string, name: string): string[] {
  const re = new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1] ?? "");
}

/**
 * All custom-property declarations in a block body → map (last write wins). Captures ANY value:
 * v4 themes alias roles at the token layer (`--ring: var(--primary)`), and an oklch-only regex
 * would drop exactly the tokens this guardrail exists to watch.
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

// ── 1. D-IC1 — on-fill contrast (effective tokens, both themes) ──────────────────────────────────

describe("GUARDRAIL D-IC1 — on-fill contrast ≥ 4.5:1 (effective tokens, both themes)", () => {
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

describe("GUARDRAIL D-IC2 — role identity split (effective tokens, both themes)", () => {
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

describe("GUARDRAIL — app.css imports BOTH themes and its override wins the cascade", () => {
  it("opts in to a theme stylesheet for BOTH themes (v4 styles.css is engine-only)", () => {
    for (const theme of THEMES) {
      expect(
        appCss,
        `app.css must @import the ${theme} theme — since v4 styles.css carries no [data-theme] blocks, ` +
          "so importing it alone renders the app unthemed",
      ).toContain(`@import "@elabs-ai/components-tokens/themes/${theme}.css"`);
    }
  });

  it("each theme stylesheet actually resolves on disk and defines its own [data-theme] block", () => {
    for (const theme of THEMES) {
      const specifier = BASE_CSS_SPECIFIER[theme] as string;
      const css = readFileSync(require.resolve(specifier), "utf8");
      expect(
        themeBlockBodies(css, theme).length,
        `${specifier} must define a [data-theme="${theme}"] block`,
      ).toBeGreaterThan(0);
    }
  });

  it("defines a [data-theme] override block for BOTH themes", () => {
    for (const theme of THEMES) {
      expect(
        themeBlockBodies(appCss, theme).length,
        `app.css must carry a [data-theme="${theme}"] override block`,
      ).toBeGreaterThan(0);
    }
  });

  it("the override block layers AFTER the theme @imports (so it wins the cascade)", () => {
    const lastImportIdx = Math.max(
      ...THEMES.map((t) => appCss.indexOf(`@import "@elabs-ai/components-tokens/themes/${t}.css"`)),
    );
    const overrideIdx = appCss.indexOf('[data-theme="light"] {');
    expect(lastImportIdx, "app.css must import the theme stylesheets").toBeGreaterThanOrEqual(0);
    expect(overrideIdx, "app.css must carry the light override block").toBeGreaterThanOrEqual(0);
    expect(
      overrideIdx,
      "the [data-theme] override must appear AFTER the theme @imports to win same-specificity cascade",
    ).toBeGreaterThan(lastImportIdx);
  });

  it("the light override re-points BOTH focus-ring tokens (the v4 accessibility fix)", () => {
    // Upstream v4 sets `--ring: var(--primary)` — the brand lime — which measures 1.30–1.42:1 on
    // light: invisible focus for a keyboard user. The light theme also nests a DARK sidebar rail
    // inside a light content area, so --sidebar-ring needs its own value; overriding --ring alone
    // would drag the rail's ring down with it (upstream aliases --sidebar-ring: var(--ring)).
    const light = tokenMap(themeBlockBodies(appCss, "light").join("\n"));
    for (const role of ["--ring", "--sidebar-ring"]) {
      expect(
        light[role],
        `the light override must set ${role} — without it the focus ring fails WCAG 2.4.7 / 1.4.11`,
      ).toBeTruthy();
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

  it("still asserts the 3:1 non-text focus-ring threshold (the v4 regression gate)", () => {
    expect(phaseTest).toMatch(/NON_TEXT_AA\s*=\s*3\b/);
    expect(phaseTest).toMatch(/toBeGreaterThanOrEqual\(NON_TEXT_AA\)/);
    expect(
      phaseTest,
      "the phase gate must still measure BOTH ring tokens — the light theme's dark sidebar rail " +
        "needs --sidebar-ring tuned separately from --ring",
    ).toContain('"--sidebar-ring"');
  });

  it("reads the PER-THEME stylesheets, not the engine-only styles.css", () => {
    // Since v4, `styles.css` has no [data-theme] blocks. A gate pointed at it resolves every token
    // to undefined and silently asserts nothing, so pin the source it reads.
    for (const theme of THEMES) {
      expect(
        phaseTest,
        `the phase gate must resolve ${theme} from its own theme stylesheet`,
      ).toContain(`@elabs-ai/components-tokens/themes/${theme}.css`);
    }
  });
});
