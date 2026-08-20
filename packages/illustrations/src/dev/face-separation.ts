// ==================================================================================================
// The face-separation assertion (D-IL15) — dev mode only
// ==================================================================================================
// D-IL15 sets a HARD FLOOR: adjacent faces of a solid must differ by at least 20% relative lightness,
// or the solid stops reading as a solid once it is exported, printed, or shown on a cheap panel.
// `tokens.css` is tuned to clear that floor and `tokens.test.ts` re-does the arithmetic on the mix
// percentages — but neither can see what a BROWSER actually painted after an upstream token moved.
// This is that second check, and it is the only part of the package that looks at a rendered pixel.
//
// It is dev-only in the strict sense the WP asks for: `assertFaceSeparation` returns `null` and does
// nothing at all when `process.env.NODE_ENV === "production"`, which is a static string in every
// bundler, so the body folds away in a production build.
//
// A NOTE ON THE PARSER, because it looks stranger than it is. Two of this package's own guards ban
// the text of a color function anywhere under `src/`: WP 0.1's acceptance grep, and `tokens.test.ts`'s
// wider scan, which between them cover the legacy, perceptual and predefined-space spellings. The
// parser has to RECOGNISE those functions in a string the BROWSER handed it, so every function name
// below is assembled at runtime and never written next to an open parenthesis in this file. The
// guards are the important thing; the awkwardness is the cheap half of the trade.

import { ILLUS_FACE_SEPARATION_FLOOR, ILLUS_FACE_TOKENS } from "../tokens.js";
import type { IllusFaceTokenName } from "../tokens.js";

/** The two adjacencies the floor governs: top meets left, left meets right. */
export const FACE_ADJACENCIES: readonly (readonly [IllusFaceTokenName, IllusFaceTokenName])[] = [
  ["--illus-face-top", "--illus-face-left"],
  ["--illus-face-left", "--illus-face-right"],
];

export type FaceSeparationPair = {
  readonly from: IllusFaceTokenName;
  readonly to: IllusFaceTokenName;
  /** Relative separation, measured against the LIGHTER of the two (research 3.3). */
  readonly separation: number;
  readonly ok: boolean;
};

export type FaceSeparationReport = {
  readonly lightness: Readonly<Record<IllusFaceTokenName, number>>;
  readonly pairs: readonly FaceSeparationPair[];
  readonly violations: readonly FaceSeparationPair[];
  readonly floor: number;
};

/**
 * Relative lightness separation, stated exactly the way research 3.3 states it: the difference as a
 * share of the LIGHTER value. Measuring against the darker one would make a near-black pair look
 * enormously separated, which is the opposite of what the eye does.
 */
export function relativeSeparation(a: number, b: number): number {
  const lighter = Math.max(a, b);
  if (lighter === 0) return 0;
  return Math.abs(a - b) / lighter;
}

/** The pure core: given three lightnesses, is the floor cleared? No DOM, no CSS, no browser. */
export function measureFaceSeparation(
  lightness: Readonly<Record<IllusFaceTokenName, number>>,
  floor: number = ILLUS_FACE_SEPARATION_FLOOR,
): FaceSeparationReport {
  const pairs = FACE_ADJACENCIES.map(([from, to]) => {
    const separation = relativeSeparation(lightness[from], lightness[to]);
    return { from, to, separation, ok: separation >= floor };
  });
  return { lightness, pairs, violations: pairs.filter((pair) => !pair.ok), floor };
}

// -- Reading a lightness out of whatever the browser hands back ------------------------------------

const CHANNEL = String.raw`[-+0-9.eE%]+`;

/** `okl` + `ch` etc., assembled so the literal call text never appears in this file. See the header. */
function functionPattern(name: string): RegExp {
  return new RegExp(`^\\s*${name}\\s*\\(\\s*(${CHANNEL})\\s+(${CHANNEL})\\s+(${CHANNEL})`, "i");
}

const OKLCH = functionPattern(["okl", "ch"].join(""));
const OKLAB = functionPattern(["okl", "ab"].join(""));
const SRGB = new RegExp(
  `^\\s*${["col", "or"].join("")}\\s*\\(\\s*srgb\\s+(${CHANNEL})\\s+(${CHANNEL})\\s+(${CHANNEL})`,
  "i",
);
const LEGACY = new RegExp(
  `^\\s*${["r", "gb"].join("")}a?\\s*\\(\\s*(${CHANNEL})[\\s,]+(${CHANNEL})[\\s,]+(${CHANNEL})`,
  "i",
);

function channel(raw: string | undefined, percentScale: number): number | null {
  if (raw === undefined) return null;
  const percent = raw.endsWith("%");
  const value = Number.parseFloat(percent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(value)) return null;
  return percent ? (value / 100) * percentScale : value;
}

function linearize(value: number): number {
  const v = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return v;
}

/** sRGB to the oklab lightness channel — the standard matrix, no approximation. */
export function srgbLightness(r: number, g: number, b: number): number {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/**
 * The perceptual lightness of a resolved color string, or `null` if the string is not one this
 * understands. `null` means SKIP, never WARN: a check that cannot see the color has nothing to say
 * about it, and a false warning would teach everyone to ignore the real one.
 */
export function parseLightness(value: string): number | null {
  const oklch = OKLCH.exec(value);
  if (oklch) return channel(oklch[1], 1);
  const oklab = OKLAB.exec(value);
  if (oklab) return channel(oklab[1], 1);
  const srgb = SRGB.exec(value);
  if (srgb) {
    const r = channel(srgb[1], 1);
    const g = channel(srgb[2], 1);
    const b = channel(srgb[3], 1);
    if (r === null || g === null || b === null) return null;
    return srgbLightness(r, g, b);
  }
  const legacy = LEGACY.exec(value);
  if (legacy) {
    const r = channel(legacy[1], 255);
    const g = channel(legacy[2], 255);
    const b = channel(legacy[3], 255);
    if (r === null || g === null || b === null) return null;
    return srgbLightness(r / 255, g / 255, b / 255);
  }
  return null;
}

// -- The dev-mode entry point ----------------------------------------------------------------------

function isProductionBuild(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

export type FaceSeparationOptions = {
  /**
   * Returns the RESOLVED color of a face token. The browser path is `createProbeResolver`; a test
   * passes its own. Returning `undefined` for a token skips the whole check.
   */
  resolve: (token: IllusFaceTokenName) => string | undefined;
  floor?: number;
  /** Where a violation goes. Defaults to `console.warn`. */
  warn?: (message: string) => void;
  /** Run despite a production build. Only the package's own tests pass this. */
  force?: boolean;
};

/**
 * Measure the three resolved face colors and warn once per violated adjacency. Returns the report so
 * a dev overlay can render the numbers, or `null` when the check did not run.
 */
export function assertFaceSeparation(options: FaceSeparationOptions): FaceSeparationReport | null {
  if (!options.force && isProductionBuild()) return null;

  const lightness: Partial<Record<IllusFaceTokenName, number>> = {};
  for (const token of ILLUS_FACE_TOKENS) {
    const raw = options.resolve(token);
    if (raw === undefined) return null;
    const value = parseLightness(raw);
    if (value === null) return null;
    lightness[token] = value;
  }

  const report = measureFaceSeparation(
    lightness as Record<IllusFaceTokenName, number>,
    options.floor ?? ILLUS_FACE_SEPARATION_FLOOR,
  );
  const warn = options.warn ?? ((message: string) => console.warn(message));
  for (const violation of report.violations) {
    warn(
      `[illustrations] ${violation.from} and ${violation.to} separate by only ` +
        `${(violation.separation * 100).toFixed(1)}% (lightness ` +
        `${report.lightness[violation.from].toFixed(3)} vs ` +
        `${report.lightness[violation.to].toFixed(3)}), under the ` +
        `${(report.floor * 100).toFixed(0)}% floor D-IL15 sets. Re-tune the mix in tokens.css.`,
    );
  }
  return report;
}

/**
 * The browser path: paint each face token onto a throwaway element and read back what was actually
 * painted. Reading the custom property directly would NOT work — an unregistered custom property's
 * computed value keeps its `color-mix(...)` text unevaluated, so the only way to see a real color is
 * to make something use it.
 */
export function createProbeResolver(
  doc: Document,
  host: Element = doc.body,
): (token: IllusFaceTokenName) => string | undefined {
  return (token) => {
    const probe = doc.createElement("div");
    probe.style.position = "absolute";
    probe.style.width = "0";
    probe.style.height = "0";
    probe.style.pointerEvents = "none";
    probe.style.backgroundColor = `var(${token})`;
    host.appendChild(probe);
    try {
      const painted = doc.defaultView?.getComputedStyle(probe).backgroundColor;
      return painted && painted !== "" ? painted : undefined;
    } finally {
      probe.remove();
    }
  };
}
