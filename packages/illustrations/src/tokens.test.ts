import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ILLUS_FACE_SEPARATION_FLOOR,
  ILLUS_FACE_TOKENS,
  ILLUS_TOKEN_BINDINGS,
  ILLUS_TOKEN_NAMES,
} from "./tokens.js";

// WP 0.1 ships one CSS file and its machine-readable mirror, so this is what there is to hold
// honest: that the two agree in BOTH directions, that every binding really reads the upstream token
// it claims, and that D-IL5's "no color literal, ever" is a test rather than a promise. The last one
// duplicates the acceptance grep on purpose — a grep somebody has to remember to run is not a guard.

const CSS_PATH = fileURLToPath(new URL("./tokens.css", import.meta.url));
const CSS = readFileSync(CSS_PATH, "utf8");

/** Comments carry the arithmetic behind the tuned mixes; they are not declarations. */
const CSS_WITHOUT_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

type Block = { selector: string; declarations: Map<string, string> };

/**
 * A deliberately small reader — enough to see which `--illus-*` property each selector block
 * declares, and to what. It is not a CSS parser and does not need to be: this file is 2 blocks of
 * flat custom properties, and a real parser would be a new dependency (D-IL3).
 */
function readBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of css.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace === -1) continue;
    const selector = chunk.slice(0, brace).trim();
    const declarations = new Map<string, string>();
    for (const match of chunk.slice(brace + 1).matchAll(/(--illus-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const [, name, value] = match;
      if (name && value) declarations.set(name, value.trim());
    }
    blocks.push({ selector, declarations });
  }
  return blocks;
}

const BLOCKS = readBlocks(CSS_WITHOUT_COMMENTS);
const ROOT = BLOCKS.find((block) => block.selector === ":root");
const DARK = BLOCKS.find((block) => block.selector === '[data-theme="dark"]');

describe("tokens.css — the one mapping file (D-IL5)", () => {
  it("declares its bindings on :root and re-tunes only faces per theme", () => {
    assert.ok(ROOT, "expected a :root block");
    assert.ok(DARK, 'expected a [data-theme="dark"] block');
    assert.equal(BLOCKS.length, 2, "tokens.css should be exactly the two blocks it documents");
  });

  it("declares every token tokens.ts claims, and claims every token it declares", () => {
    const declared = new Set<string>();
    for (const block of BLOCKS) for (const name of block.declarations.keys()) declared.add(name);
    assert.deepEqual([...declared].sort(), [...ILLUS_TOKEN_NAMES].sort());
  });

  it("binds each token to the upstream variable tokens.ts names", () => {
    assert.ok(ROOT);
    for (const [token, upstream] of Object.entries(ILLUS_TOKEN_BINDINGS)) {
      const value = ROOT.declarations.get(token);
      assert.ok(value, `${token} is not declared in :root`);
      assert.ok(
        value.includes(`var(${upstream})`),
        `${token} should read var(${upstream}), but reads ${value}`,
      );
    }
  });

  it("derives every face from --illus-surface and --illus-ink, never from a literal", () => {
    assert.ok(ROOT);
    const [top, left, right] = ILLUS_FACE_TOKENS;
    assert.equal(ROOT.declarations.get(top), "var(--illus-surface)");
    for (const face of [left, right]) {
      const value = ROOT.declarations.get(face);
      assert.ok(value, `${face} is not declared in :root`);
      assert.match(
        value,
        /^color-mix\(in oklch, var\(--illus-surface\), var\(--illus-ink\) \d+%\)$/,
      );
    }
  });

  it("re-tunes both side faces on the dark stage, and only those", () => {
    assert.ok(DARK);
    const [top, left, right] = ILLUS_FACE_TOKENS;
    assert.deepEqual([...DARK.declarations.keys()].sort(), [left, right].sort());
    assert.equal(DARK.declarations.has(top), false, "the top face is the surface in every theme");
  });

  it("keeps the right face further from the surface than the left one, in both themes", () => {
    // The lighting rule (D-IL2) is an ORDER: the right face is always the more separated of the two.
    // The absolute direction flips between themes; the order does not, and that is what is testable
    // without resolving CSS. WP 0.2's dev assertion measures the resolved separation itself.
    const mix = (value: string | undefined): number => Number(/(\d+)%/.exec(value ?? "")?.[1]);
    assert.ok(ROOT && DARK);
    const [, left, right] = ILLUS_FACE_TOKENS;
    for (const block of [ROOT, DARK]) {
      const from = block.declarations.get(left);
      const to = block.declarations.get(right);
      if (!from || !to) continue;
      assert.ok(
        mix(to) > mix(from),
        `${block.selector}: the right face must sit further from the surface than the left`,
      );
    }
  });

  it("tunes the two themes differently — a single tuning cannot clear the floor in both", () => {
    assert.ok(ROOT && DARK);
    for (const face of ILLUS_FACE_TOKENS.slice(1)) {
      assert.notEqual(
        ROOT.declarations.get(face),
        DARK.declarations.get(face),
        `${face} carries the same mix in both themes, which the arithmetic in tokens.css rules out`,
      );
    }
  });

  it("pins the separation floor at research 3.3's value, not merely at some number", () => {
    // 20%, exactly. If this constant moves, the two arithmetic tests below quietly start measuring
    // a different promise than the one tokens.css documents — so the value itself is pinned here,
    // once, and a change to it has to be a deliberate edit to this line.
    assert.equal(ILLUS_FACE_SEPARATION_FLOOR, 0.2);
  });
});

// ── The arithmetic behind the tuning (research 3.3) ──────────────────────────────────────────────
// tokens.css claims, in prose, that its four mix percentages clear a 20% adjacent-face separation
// floor and — on the light stage — land inside research 3.3's ratio bands. A comment cannot go red.
// This can: it reads the percentages back OUT of the CSS and recomputes the claim, so editing a mix
// without redoing the arithmetic fails the gate.
//
// This is NOT WP 0.2's job. WP 0.2 measures the RESOLVED values a browser computes, in dev mode,
// which catches an upstream token bump this test cannot see. Both should exist: this one is the
// unit test over arithmetic the file already asserts in words.
describe("tokens.css — the tuned mixes really clear the separation floor", () => {
  /**
   * The oklch LIGHTNESS channel of the only two tokens a face is derived from, copied from the
   * INSTALLED @elabs-ai/components-tokens@4.0.0 theme stylesheets:
   *
   *   apps/web/node_modules/@elabs-ai/components-tokens/dist/themes/light.css
   *       --card L 1.000  ·  --foreground L 0.300
   *   apps/web/node_modules/@elabs-ai/components-tokens/dist/themes/dark.css
   *       --card L 0.250  ·  --foreground L 0.950
   *
   * Copied on purpose rather than re-read from `node_modules`: a test that followed the installed
   * files would silently absorb an upstream bump instead of failing on it. When brand-ui moves,
   * THIS is where the new numbers land — and the failure that sends you here is the point.
   *
   * Keyed by the selector that declares each theme's face mixes. Light is the app's default, so it
   * lives on `:root`; dark overrides the two side faces only.
   */
  const THEME_LIGHTNESS: ReadonlyArray<{
    selector: string;
    theme: string;
    surface: number;
    ink: number;
  }> = [
    { selector: ":root", theme: "light", surface: 1.0, ink: 0.3 },
    { selector: '[data-theme="dark"]', theme: "dark", surface: 0.25, ink: 0.95 },
  ];

  /** Research 3.3's target band for each side face, as a share of the top face's lightness. */
  const LIGHT_RATIO_BANDS = {
    left: { min: 0.75, max: 0.8 },
    right: { min: 0.55, max: 0.6 },
  } as const;

  /**
   * The mix fraction a face declaration carries, read back out of tokens.css — never hardcoded
   * here, so that editing the CSS is what moves this test. The top face mixes nothing: it IS the
   * surface, in every theme.
   */
  function mixFraction(face: string, block: Block): number {
    const value = block.declarations.get(face) ?? ROOT?.declarations.get(face);
    assert.ok(value, `${face} resolves to no declaration for ${block.selector}`);
    if (value === "var(--illus-surface)") return 0;
    const digits = /(\d+)%\)$/.exec(value)?.[1];
    assert.ok(digits, `${face} declares no mix percentage: ${value}`);
    return Number(digits) / 100;
  }

  /** What a mix of surface toward ink does to the lightness channel, at fraction `p`. */
  const mixedLightness = (surface: number, ink: number, p: number): number =>
    surface * (1 - p) + ink * p;

  /** Relative separation, stated the way research 3.3 states it: against the LIGHTER of the pair. */
  const separation = (a: number, b: number): number => Math.abs(a - b) / Math.max(a, b);

  function facesFor(entry: (typeof THEME_LIGHTNESS)[number]) {
    const block = BLOCKS.find((candidate) => candidate.selector === entry.selector);
    assert.ok(block, `tokens.css declares no ${entry.selector} block`);
    const [top, left, right] = ILLUS_FACE_TOKENS;
    return {
      top: mixedLightness(entry.surface, entry.ink, mixFraction(top, block)),
      left: mixedLightness(entry.surface, entry.ink, mixFraction(left, block)),
      right: mixedLightness(entry.surface, entry.ink, mixFraction(right, block)),
    };
  }

  it("clears the adjacent-face separation floor in both themes", () => {
    for (const entry of THEME_LIGHTNESS) {
      const faces = facesFor(entry);
      for (const [from, to] of [
        ["top", "left"],
        ["left", "right"],
      ] as const) {
        const measured = separation(faces[from], faces[to]);
        assert.ok(
          measured >= ILLUS_FACE_SEPARATION_FLOOR,
          `${entry.theme}: ${from} to ${to} separates by ${(measured * 100).toFixed(1)}% ` +
            `(L ${faces[from].toFixed(3)} vs ${faces[to].toFixed(3)}), under the ` +
            `${(ILLUS_FACE_SEPARATION_FLOOR * 100).toFixed(0)}% floor. Re-tune the mix in tokens.css.`,
        );
      }
    }
  });

  it("lands the light stage inside research 3.3's ratio bands", () => {
    const light = THEME_LIGHTNESS.find((entry) => entry.theme === "light");
    assert.ok(light, "the light stage is declared above");
    const faces = facesFor(light);
    for (const face of ["left", "right"] as const) {
      const band = LIGHT_RATIO_BANDS[face];
      const ratio = faces[face] / faces.top;
      assert.ok(
        ratio >= band.min && ratio <= band.max,
        `light: the ${face} face is ${(ratio * 100).toFixed(1)}% of the top face, outside the ` +
          `${(band.min * 100).toFixed(0)}-${(band.max * 100).toFixed(0)}% band research 3.3 asks for.`,
      );
    }
  });

  it("holds the dark stage to the floor ONLY, and records why the bands do not apply", () => {
    // The light bands are deliberately not applied here, and that is the WP 0.1 deviation on the
    // record rather than an omission. On a dark stage `--card` sits at L 0.250 with only
    // `--background` (L 0.210) beneath it, so mixing toward ink cannot darken a face by 20% — it
    // LIGHTENS the side faces instead, which research 3.3 explicitly accepts as how lighting flips
    // on a dark ground. Expressed as a share of the top face those faces therefore exceed 100%, and
    // a band written for the light stage would reject a file behaving exactly as designed.
    //
    // The flip inverts D-IL2's "top lightest -> right darkest" on dark, which is an OWNER-ACCEPTANCE
    // question a gate cannot settle. What the gate CAN hold is the invariant that survives it: the
    // order of the three faces, and the separation between them (asserted in both themes above).
    const dark = THEME_LIGHTNESS.find((entry) => entry.theme === "dark");
    assert.ok(dark, "the dark stage is declared above");
    const faces = facesFor(dark);
    assert.ok(
      faces.left > faces.top && faces.right > faces.left,
      "on dark the side faces catch light, in the same top -> left -> right order",
    );
    assert.ok(
      faces.left / faces.top > LIGHT_RATIO_BANDS.left.max,
      "a light-stage ratio band would reject the dark tuning by construction — hence floor only",
    );
  });
});

describe("no color literal anywhere in this package (D-IL5)", () => {
  // The same question WP 0.1's acceptance grep asks, asked by the GATE so nobody has to remember to
  // run it. Every file under `src/` is scanned, this one INCLUDED, which is why neither pattern
  // below is written out whole: spelled literally they would be exactly what they forbid. The hash
  // is escaped, and the function names are joined at runtime so no `name(` pair ever appears here.
  const HEX_COLOR = /\u0023[0-9a-f]{3,8}\b/i;
  const COLOR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "oklch", "oklab", "lab", "lch", "color"];
  const COLOR_CALL = new RegExp(`\\b(?:${COLOR_FUNCTIONS.join("|")})\\(`, "i");

  const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

  /**
   * RECURSIVE, and it has to be. WP 0.2 put the primitives in `src/primitives/`, the dev assertion
   * in `src/dev/` and the preview sheet in `src/preview/` — a flat `readdirSync` would have walked
   * straight past every file that actually draws something while still reporting green.
   */
  function readSources(dir: string, prefix = ""): (readonly [string, string])[] {
    const found: (readonly [string, string])[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const label = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) found.push(...readSources(path, label));
      else found.push([label, readFileSync(path, "utf8")] as const);
    }
    return found;
  }

  const SOURCES = readSources(SRC_DIR);

  it("scans every file in src/, at every depth, including this one", () => {
    assert.ok(SOURCES.length >= 4, `expected the package's sources, found ${SOURCES.length}`);
    assert.ok(SOURCES.some(([name]) => name === "tokens.css"));
    assert.ok(
      SOURCES.some(([name]) => name.includes("/")),
      "the scan must reach the subdirectories the primitives live in",
    );
  });

  it("carries no hex color anywhere", () => {
    for (const [name, source] of SOURCES) {
      assert.doesNotMatch(source, HEX_COLOR, `${name} carries a hex color`);
    }
  });

  it("carries no raw color function call anywhere", () => {
    // `color-mix(in oklch, ...)` names an interpolation SPACE, not a color, and does not match:
    // the function name there is `color-mix`, and the `oklch` in it is followed by a comma rather
    // than an open paren. The ban is on a color function CALL — the only shape a literal can take.
    for (const [name, source] of SOURCES) {
      assert.doesNotMatch(source, COLOR_CALL, `${name} carries a raw color value`);
    }
  });
});
