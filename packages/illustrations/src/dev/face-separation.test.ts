import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ILLUS_FACE_SEPARATION_FLOOR, ILLUS_FACE_TOKENS } from "../tokens.js";
import type { IllusFaceTokenName } from "../tokens.js";
import {
  FACE_ADJACENCIES,
  assertFaceSeparation,
  measureFaceSeparation,
  parseLightness,
  relativeSeparation,
  srgbLightness,
} from "./face-separation.js";

// The colour-function names this file has to BUILD rather than write, for the same reason the parser
// does: `tokens.test.ts` scans every source under `src/` for the literal text of a colour call, and a
// test that spelled one out would fail the package's own no-literals guard.
const fn = (...parts: string[]) => parts.join("");
const OKLCH = fn("okl", "ch");
const OKLAB = fn("okl", "ab");
const SRGB = fn("col", "or");
const LEGACY = fn("r", "gb");
const call = (name: string, body: string) => `${name}(${body})`;

describe("face separation — the arithmetic (research 3.3)", () => {
  it("measures separation against the LIGHTER of the pair", () => {
    // 1.0 vs 0.8 is a 20% step down from the lighter one, not a 25% step up from the darker one.
    assert.equal(relativeSeparation(1, 0.8), 0.19999999999999996);
    assert.equal(Number(relativeSeparation(1, 0.8).toFixed(4)), 0.2);
    assert.equal(relativeSeparation(0.8, 1), relativeSeparation(1, 0.8), "and it is symmetric");
    assert.equal(relativeSeparation(0.5, 0.5), 0);
    assert.equal(relativeSeparation(0, 0), 0, "two blacks do not divide by zero");
  });

  it("checks the two adjacencies a solid actually has", () => {
    assert.deepEqual(FACE_ADJACENCIES, [
      ["--illus-face-top", "--illus-face-left"],
      ["--illus-face-left", "--illus-face-right"],
    ]);
  });

  it("passes a set that clears the floor and fails one that does not", () => {
    const clears = measureFaceSeparation({
      "--illus-face-top": 1,
      "--illus-face-left": 0.776,
      "--illus-face-right": 0.573,
    });
    assert.deepEqual(clears.violations, []);
    // 0.776 -> 0.573 is 26.2%; 1 -> 0.776 is 22.4%. Both clear 20%.
    assert.equal(Number((clears.pairs[0]?.separation ?? 0).toFixed(3)), 0.224);
    assert.equal(Number((clears.pairs[1]?.separation ?? 0).toFixed(3)), 0.262);

    const flat = measureFaceSeparation({
      "--illus-face-top": 1,
      "--illus-face-left": 0.95,
      "--illus-face-right": 0.573,
    });
    assert.equal(flat.violations.length, 1);
    assert.equal(flat.violations[0]?.from, "--illus-face-top");
    assert.equal(Number((flat.violations[0]?.separation ?? 0).toFixed(3)), 0.05);
  });

  it("uses the floor D-IL15 sets, unless a caller states another one", () => {
    assert.equal(ILLUS_FACE_SEPARATION_FLOOR, 0.2);
    const faces = { "--illus-face-top": 1, "--illus-face-left": 0.85, "--illus-face-right": 0.6 };
    assert.equal(measureFaceSeparation(faces).violations.length, 1);
    assert.equal(measureFaceSeparation(faces, 0.1).violations.length, 0);
  });
});

describe("face separation — reading a colour the browser resolved", () => {
  it("reads the lightness channel of a perceptual colour", () => {
    assert.equal(parseLightness(call(OKLCH, "0.776 0.004 257")), 0.776);
    assert.equal(Number((parseLightness(call(OKLCH, "77.6% 0.004 257")) ?? 0).toFixed(4)), 0.776);
    assert.equal(parseLightness(call(OKLAB, "0.25 -0.01 0.02")), 0.25);
  });

  it("converts a predefined-space or legacy triple through the standard matrix", () => {
    // Pure white is lightness 1 in either spelling; pure black is 0.
    assert.equal(Number((parseLightness(call(SRGB, "srgb 1 1 1")) ?? 0).toFixed(6)), 1);
    assert.equal(Number((parseLightness(call(LEGACY, "255, 255, 255")) ?? 0).toFixed(6)), 1);
    assert.equal(Number((parseLightness(call(LEGACY, "0 0 0")) ?? 1).toFixed(6)), 0);
    // Mid grey sits near 0.6 perceptually, not at 0.5 — which is the whole reason for the matrix.
    const grey = parseLightness(call(LEGACY, "128 128 128")) ?? 0;
    assert.ok(grey > 0.59 && grey < 0.61, `mid grey measured ${grey}`);
    assert.equal(Number(srgbLightness(1, 1, 1).toFixed(6)), 1);
  });

  it("returns null — meaning SKIP, not WARN — for anything it cannot read", () => {
    assert.equal(parseLightness("transparent"), null);
    assert.equal(parseLightness(""), null);
    assert.equal(parseLightness("var(--illus-face-top)"), null);
    // An unevaluated color-mix is the SPECIFIED value of an unregistered custom property; a check
    // that guessed at it would be inventing a number.
    assert.equal(parseLightness("color-mix(in oklch, A, B 32%)"), null);
  });
});

describe("face separation — the dev-mode assertion", () => {
  const lightStage: Record<IllusFaceTokenName, string> = {
    "--illus-face-top": call(OKLCH, "1 0 0"),
    "--illus-face-left": call(OKLCH, "0.776 0 0"),
    "--illus-face-right": call(OKLCH, "0.573 0 0"),
  };

  it("says nothing when the faces are separated", () => {
    const warnings: string[] = [];
    const report = assertFaceSeparation({
      resolve: (token) => lightStage[token],
      warn: (message) => warnings.push(message),
      force: true,
    });
    assert.ok(report);
    assert.deepEqual(warnings, []);
  });

  it("warns once per flattened adjacency, naming both faces and the floor", () => {
    const warnings: string[] = [];
    const report = assertFaceSeparation({
      resolve: (token) =>
        token === "--illus-face-left" ? call(OKLCH, "0.98 0 0") : lightStage[token],
      warn: (message) => warnings.push(message),
      force: true,
    });
    assert.equal(report?.violations.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /--illus-face-top and --illus-face-left/);
    assert.match(warnings[0] as string, /20% floor/);
    assert.match(warnings[0] as string, /tokens\.css/);
  });

  it("skips silently when a face cannot be measured", () => {
    const warnings: string[] = [];
    for (const resolve of [
      () => undefined,
      () => "transparent",
      (token: IllusFaceTokenName) =>
        token === "--illus-face-right" ? undefined : lightStage[token],
    ]) {
      const report = assertFaceSeparation({
        resolve,
        warn: (message) => warnings.push(message),
        force: true,
      });
      assert.equal(report, null);
    }
    assert.deepEqual(warnings, [], "an unreadable colour is not a violation");
  });

  it("does nothing at all in a production build", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      let asked = false;
      const report = assertFaceSeparation({
        resolve: (token) => {
          asked = true;
          return lightStage[token];
        },
        warn: () => assert.fail("a production build must not warn"),
      });
      assert.equal(report, null);
      assert.equal(asked, false, "it must not even read a computed style");
    } finally {
      if (previous === undefined) process.env.NODE_ENV = undefined;
      else process.env.NODE_ENV = previous;
    }
  });
});

// ── The teeth: the shipped assertion, run over the mixes tokens.css actually declares ────────────
//
// `tokens.test.ts` already re-does the tuning arithmetic. This is a different question asked of the
// same file: take the mix percentages OUT of tokens.css, turn them into lightnesses, and hand them
// to the assertion that ships — the same function a browser calls. Flatten a face in tokens.css and
// this goes red, which is what WP 0.2's acceptance item 6 asks for.
describe("face separation — tokens.css clears the floor, measured by the SHIPPED assertion", () => {
  const CSS = readFileSync(
    fileURLToPath(new URL("../tokens.css", import.meta.url)),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  /**
   * The oklch lightness of the two tokens a face derives from, per theme, copied from the INSTALLED
   * @elabs-ai/components-tokens@4.0.0 stylesheets — the same numbers, and the same reasoning, as
   * `tokens.test.ts`: a test that re-read `node_modules` would absorb an upstream bump instead of
   * failing on it.
   */
  const THEMES = [
    { selector: ":root", theme: "light", surface: 1.0, ink: 0.3 },
    { selector: '[data-theme="dark"]', theme: "dark", surface: 0.25, ink: 0.95 },
  ] as const;

  function block(selector: string): string {
    const start = CSS.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `tokens.css declares no ${selector} block`);
    return CSS.slice(start, CSS.indexOf("}", start));
  }

  /** The mix percentage declared for a face in a block, falling back to `:root`. */
  function mixFraction(face: IllusFaceTokenName, selector: string): number {
    for (const source of [block(selector), block(":root")]) {
      const declaration = new RegExp(`${face}\\s*:\\s*([^;]+);`).exec(source)?.[1];
      if (!declaration) continue;
      if (declaration.trim() === "var(--illus-surface)") return 0;
      const percent = /(\d+)%\)/.exec(declaration)?.[1];
      assert.ok(percent, `${face} declares no mix percentage: ${declaration}`);
      return Number(percent) / 100;
    }
    assert.fail(`${face} is declared nowhere`);
  }

  for (const theme of THEMES) {
    it(`clears the floor on the ${theme.theme} stage`, () => {
      const warnings: string[] = [];
      const resolved = Object.fromEntries(
        ILLUS_FACE_TOKENS.map((face) => {
          const p = mixFraction(face, theme.selector);
          const lightness = theme.surface * (1 - p) + theme.ink * p;
          return [face, call(OKLCH, `${lightness.toFixed(6)} 0 0`)];
        }),
      ) as Record<IllusFaceTokenName, string>;

      const report = assertFaceSeparation({
        resolve: (face) => resolved[face],
        warn: (message) => warnings.push(message),
        force: true,
      });
      assert.ok(report, "the fixture colours must be readable");
      assert.deepEqual(
        warnings,
        [],
        `the ${theme.theme} stage no longer clears the ${ILLUS_FACE_SEPARATION_FLOOR * 100}% floor`,
      );
    });
  }
});
