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

  it("names a separation floor the tuning is aimed at", () => {
    assert.ok(ILLUS_FACE_SEPARATION_FLOOR > 0 && ILLUS_FACE_SEPARATION_FLOOR < 1);
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
  const SOURCES = readdirSync(SRC_DIR).map(
    (name) => [name, readFileSync(join(SRC_DIR, name), "utf8")] as const,
  );

  it("scans every file in src/, including this one", () => {
    assert.ok(SOURCES.length >= 4, `expected the package's sources, found ${SOURCES.length}`);
    assert.ok(SOURCES.some(([name]) => name === "tokens.css"));
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
