// ==================================================================================================
// The --illus-* token set, as data (D-IL5)
// ==================================================================================================
// The machine-readable mirror of `tokens.css`. It exists so that "the closed --illus-* set" is a
// thing code can enumerate rather than a claim in a comment: `tokens.test.ts` holds the two files to
// each other, WP 0.2's dev-mode face-separation assertion needs the face token names, and the
// gallery's dev overlay needs the list to print resolved values.
//
// **It renders nothing and it declares no color.** The values here are TOKEN NAMES — strings that
// name a CSS custom property. There is no hex, no channel triple, and no fallback chain: every
// upstream token named below was verified present in both shipped themes of the installed
// @elabs-ai/components-tokens, so a fallback would only ever hide a future upstream removal.

/**
 * Each `--illus-*` custom property and the upstream `@elabs-ai/components-tokens` variable its
 * declaration in `tokens.css` reads. This is research 3.4's mapping table, verbatim.
 *
 * `--illus-shadow` is the one entry whose declaration is not a bare `var()`: it is the ink at
 * roughly 7% alpha, derived with `color-mix`. It still READS `--foreground`, which is what the
 * contract test checks, so the mapping stays honest.
 */
export const ILLUS_TOKEN_BINDINGS = {
  "--illus-paper": "--background",
  "--illus-grid": "--grid-line",
  "--illus-grid-major": "--grid-line-major",
  "--illus-ink": "--foreground",
  "--illus-ink-muted": "--muted-foreground",
  "--illus-guide": "--rule",
  "--illus-surface": "--card",
  "--illus-surface-sunken": "--surface-muted",
  "--illus-accent": "--primary",
  "--illus-accent-contrast": "--primary-foreground",
  "--illus-accent-2": "--chart-3",
  "--illus-ok": "--success",
  "--illus-warn": "--warning",
  "--illus-error": "--destructive",
  "--illus-shadow": "--foreground",
} as const;

export type IllusTokenName = keyof typeof ILLUS_TOKEN_BINDINGS;

/**
 * The three solid faces (D-IL2's lighting rule, research 3.3). They are NOT bindings: each is
 * derived from `--illus-surface` and `--illus-ink` by `color-mix(in oklch, ...)`, at percentages
 * tuned per theme inside `tokens.css` — the one sanctioned place for that tuning.
 *
 * Ordered lightest-first for the light stage, which is also the order the separation floor is
 * measured along. WP 0.2 adds the assertion that measures it.
 */
export const ILLUS_FACE_TOKENS = [
  "--illus-face-top",
  "--illus-face-left",
  "--illus-face-right",
] as const;

export type IllusFaceTokenName = (typeof ILLUS_FACE_TOKENS)[number];

/**
 * Every custom property this package defines. A component may read one of these and nothing else —
 * that closure is what D-IL5 buys, and what makes a third theme a one-file change.
 */
export const ILLUS_TOKEN_NAMES: readonly (IllusTokenName | IllusFaceTokenName)[] = [
  ...(Object.keys(ILLUS_TOKEN_BINDINGS) as IllusTokenName[]),
  ...ILLUS_FACE_TOKENS,
];

/**
 * The relative lightness separation two adjacent faces must keep (research 3.3). Declared here so
 * WP 0.2's dev-mode assertion and any export check read ONE number. It is a ratio, not a percent:
 * `(lighter - darker) / lighter >= 0.2`.
 */
export const ILLUS_FACE_SEPARATION_FLOOR = 0.2;
