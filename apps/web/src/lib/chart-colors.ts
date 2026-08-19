/**
 * The ONE place a `--chart-N` series colour is derived (WP 0.1, finding F5).
 *
 * The theme ramp is **twelve** tokens — `--chart-1` … `--chart-12` (see
 * `@elabs-ai/components-tokens/themes/{light,dark}.css` and `.claude/rules/styling-and-tokens.md`:
 * "charts cycle all twelve before repeating"). Call sites used to hand-roll
 * `var(--chart-${(i % 5) + 1})`, so the 6th series silently reused the 1st series' colour and a
 * legend stopped being trustworthy. Everything now routes through here.
 *
 * Two hard constraints this module encodes, both easy to get wrong by hand:
 *
 * 1. **The colour must be a `var(--chart-N)` reference.** `@elabs-ai/components-charts` gates its
 *    decoration/pattern generation on `isPaletteFill()`, which tests `/^var\(\s*--chart-/`. A raw
 *    hex is not merely a token-rule violation — it is silently ignored.
 * 2. **A legend swatch must NOT be a template-literal Tailwind class.** Tailwind extracts class
 *    names *statically*, so `` `bg-chart-${n}` `` is never seen by the scanner. Such a class works
 *    only if some *other* file spells the literal — today `bg-chart-1` … `bg-chart-12` all survive
 *    because `@elabs-ai/components-ui`'s dist spells all twelve and `app.css` `@source`s it
 *    (verified against the built CSS). That is a borrowed guarantee from a vendored package, not
 *    one this app holds: an upstream release that stops spelling a slot blanks that swatch with no
 *    error, no build warning and no failing test. {@link chartSwatchStyle} drops the dependency
 *    entirely and — the real win — pins a swatch and its series to the *same* token string.
 *
 * Pure and framework-free on purpose: no React import, no DOM, trivially unit-testable.
 */

/** How many `--chart-N` tokens the theme ramp provides before a series colour repeats. */
export const CHART_RAMP_LENGTH = 12;

/**
 * Resolve a 0-based series index to a 1-based ramp slot, cycling the ramp.
 *
 * `rampLength` narrows the cycle to the ramp's first N slots — used when a chart reserves a slot
 * for a non-categorical accent series (see `RunsErrorRatePanel`). It is clamped into
 * `1 … CHART_RAMP_LENGTH` so no caller can produce a `--chart-0` or a `--chart-13`. A negative or
 * fractional `index` is normalised rather than producing a broken token.
 */
function rampSlot(index: number, rampLength: number): number {
  const requested = Number.isFinite(rampLength) ? Math.trunc(rampLength) : CHART_RAMP_LENGTH;
  const size = Math.min(Math.max(requested, 1), CHART_RAMP_LENGTH);
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  // JS `%` keeps the sign of the dividend, so re-add `size` before the final modulo.
  return (((i % size) + size) % size) + 1;
}

/**
 * The CSS custom-property NAME for the nth series (0-based), e.g. `"--chart-1"`.
 *
 * Prefer {@link chartSeriesColor} for anything that takes a colour value; this exists for the rare
 * call site that needs the bare property name (a `--custom-prop: var(...)` assignment).
 */
export function chartSeriesToken(index: number, rampLength: number = CHART_RAMP_LENGTH): string {
  return `--chart-${rampSlot(index, rampLength)}`;
}

/**
 * The series colour for the nth series (0-based) as a `var(--chart-N)` reference — the form
 * `@elabs-ai/components-charts` requires (`Bar.fill`, `Line.stroke`, `ChartTooltip` row `color`,
 * `ChartSeriesSpec.color`).
 */
export function chartSeriesColor(index: number, rampLength: number = CHART_RAMP_LENGTH): string {
  return `var(${chartSeriesToken(index, rampLength)})`;
}

/**
 * Inline style for a legend swatch matching the nth series (0-based).
 *
 * Use this instead of a `` `bg-chart-${n}` `` class: Tailwind cannot see a class built by template
 * literal, so such a swatch only paints while some other file happens to spell that exact literal.
 * This keeps the swatch and the plotted series on one token by construction instead.
 */
export function chartSwatchStyle(
  index: number,
  rampLength: number = CHART_RAMP_LENGTH,
): { backgroundColor: string } {
  return { backgroundColor: chartSeriesColor(index, rampLength) };
}
