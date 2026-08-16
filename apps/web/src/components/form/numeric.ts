/**
 * Pure numeric helpers shared by the form primitives (`SliderNumber`, `BoundedNumber`).
 *
 * These exist so the two behaviours the audit calls out — **bounds clamping** and **killing the
 * `0.30000000000000004` float artifact** (S12: continuous 0–1 floats shown as steppers) — live in
 * ONE tested place rather than being re-derived inside each control.
 */

/**
 * Round `value` to `decimals` fractional digits, returning a clean float.
 *
 * Floating-point step arithmetic leaks artifacts like `0.1 + 0.2 === 0.30000000000000004`; rounding
 * to the control's declared precision removes them. `decimals` is clamped to a sane `[0, 20]` range
 * (the `Number.prototype.toFixed` domain). A non-finite input is returned unchanged.
 */
export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const places = Math.min(20, Math.max(0, Math.trunc(decimals)));
  // toFixed avoids the `Math.round(v * 10**p) / 10**p` overflow class for large magnitudes.
  return Number.parseFloat(value.toFixed(places));
}

/** Clamp `value` into `[min, max]`. Undefined bounds are treated as open on that side. */
export function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number" && next < min) next = min;
  if (typeof max === "number" && next > max) next = max;
  return next;
}

/**
 * Clamp then round — the single normalisation a numeric control applies before emitting a value.
 * Order matters: clamp first (so an out-of-range entry snaps to the bound) then round to precision.
 */
export function normalizeNumber(
  value: number,
  opts: { min?: number; max?: number; decimals?: number },
): number {
  const clamped = clampNumber(value, opts.min, opts.max);
  return typeof opts.decimals === "number" ? roundToDecimals(clamped, opts.decimals) : clamped;
}

/**
 * Infer a sensible fractional-digit count from a `step` (e.g. `0.05` → 2) when a control isn't given
 * an explicit `decimals`. Integer or missing steps → 0. Capped at 6 to avoid runaway precision.
 */
export function decimalsFromStep(step?: number): number {
  if (typeof step !== "number" || !Number.isFinite(step)) return 0;
  const text = String(step);
  const dot = text.indexOf(".");
  if (dot < 0) return 0;
  return Math.min(6, text.length - dot - 1);
}
