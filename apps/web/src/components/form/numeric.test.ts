import { describe, expect, test } from "vitest";
import { clampNumber, decimalsFromStep, normalizeNumber, roundToDecimals } from "./numeric";

describe("roundToDecimals", () => {
  test("kills the float-arithmetic artifact class (0.1 + 0.2)", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: the artifact exists
    expect(roundToDecimals(0.1 + 0.2, 2)).toBe(0.3);
  });

  test("rounds to the requested precision", () => {
    expect(roundToDecimals(0.3000000004, 2)).toBe(0.3);
    expect(roundToDecimals(0.126, 2)).toBe(0.13);
    expect(roundToDecimals(0.124, 2)).toBe(0.12);
    expect(roundToDecimals(1.005, 2)).toBe(1.0);
    expect(roundToDecimals(2, 0)).toBe(2);
    expect(roundToDecimals(2.7, 0)).toBe(3);
  });

  test("clamps the precision to the toFixed domain and ignores non-finite input", () => {
    expect(roundToDecimals(1.23456789, 30)).toBeCloseTo(1.23456789, 8);
    expect(roundToDecimals(1.5, -2)).toBe(2); // negative decimals treated as 0
    expect(Number.isNaN(roundToDecimals(Number.NaN, 2))).toBe(true);
    expect(roundToDecimals(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("clampNumber", () => {
  test("clamps into [min, max]", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(42, 0, 10)).toBe(10);
  });

  test("treats undefined bounds as open on that side", () => {
    expect(clampNumber(-99, undefined, 10)).toBe(-99);
    expect(clampNumber(99, 0, undefined)).toBe(99);
    expect(clampNumber(99, undefined, undefined)).toBe(99);
  });
});

describe("normalizeNumber", () => {
  test("clamps first, then rounds to precision", () => {
    // 1.239 is in-range and rounds to 1.24; out-of-range snaps to the bound then rounds.
    expect(normalizeNumber(1.239, { min: 0, max: 2, decimals: 2 })).toBe(1.24);
    expect(normalizeNumber(5, { min: 0, max: 2, decimals: 2 })).toBe(2);
    expect(normalizeNumber(0.1 + 0.2, { min: 0, max: 1, decimals: 2 })).toBe(0.3);
  });

  test("skips rounding when no decimals given", () => {
    expect(normalizeNumber(1.239, { min: 0, max: 2 })).toBe(1.239);
  });
});

describe("decimalsFromStep", () => {
  test("infers fractional digits from the step", () => {
    expect(decimalsFromStep(1)).toBe(0);
    expect(decimalsFromStep(0.1)).toBe(1);
    expect(decimalsFromStep(0.05)).toBe(2);
    expect(decimalsFromStep(0.001)).toBe(3);
  });

  test("defaults to 0 for missing/non-finite step and caps at 6", () => {
    expect(decimalsFromStep(undefined)).toBe(0);
    expect(decimalsFromStep(Number.NaN)).toBe(0);
    expect(decimalsFromStep(0.00000001)).toBeLessThanOrEqual(6);
  });
});
