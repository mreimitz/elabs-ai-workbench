import { describe, expect, test } from "vitest";
import { CHART_RAMP_LENGTH, chartSeriesColor, chartSeriesToken, chartSwatchStyle } from "./chart-colors";

describe("CHART_RAMP_LENGTH", () => {
  test("is 12 — the ramp the themes actually ship", () => {
    // `@elabs-ai/components-tokens/themes/{light,dark}.css` define --chart-1 … --chart-12, and
    // .claude/rules/styling-and-tokens.md requires charts to cycle all twelve before repeating.
    expect(CHART_RAMP_LENGTH).toBe(12);
  });
});

describe("chartSeriesToken", () => {
  test("maps 0-based index to a 1-based token across the whole ramp", () => {
    const tokens = Array.from({ length: CHART_RAMP_LENGTH }, (_, i) => chartSeriesToken(i));
    expect(tokens).toEqual([
      "--chart-1",
      "--chart-2",
      "--chart-3",
      "--chart-4",
      "--chart-5",
      "--chart-6",
      "--chart-7",
      "--chart-8",
      "--chart-9",
      "--chart-10",
      "--chart-11",
      "--chart-12",
    ]);
  });

  test("uses all twelve distinct tokens before repeating — the regression this WP fixes", () => {
    const first12 = new Set(Array.from({ length: 12 }, (_, i) => chartSeriesToken(i)));
    expect(first12.size).toBe(12);
    // The old `(i % 5) + 1` collapsed to five, so index 5 collided with index 0.
    expect(chartSeriesToken(5)).not.toBe(chartSeriesToken(0));
  });
});

describe("chartSeriesColor", () => {
  test("cycles 1 → 12 then wraps (index 0, 11, 12, 25)", () => {
    expect(chartSeriesColor(0)).toBe("var(--chart-1)");
    expect(chartSeriesColor(11)).toBe("var(--chart-12)");
    expect(chartSeriesColor(12)).toBe("var(--chart-1)"); // wrap boundary
    expect(chartSeriesColor(25)).toBe("var(--chart-2)"); // 25 = 2*12 + 1
  });

  test("returns a `var(--chart-N)` reference — the only form the charts library honours", () => {
    // @elabs-ai/components-charts `isPaletteFill()` tests /^var\(\s*--chart-/ and SILENTLY ignores
    // anything else, so this shape is load-bearing, not cosmetic.
    const paletteFill = /^var\(\s*--chart-\d+\)$/;
    for (let i = 0; i < 30; i += 1) {
      expect(chartSeriesColor(i)).toMatch(paletteFill);
    }
  });

  test("never emits a raw colour literal", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(chartSeriesColor(i)).not.toMatch(/#[0-9a-f]{3}|rgb|hsl|oklch/i);
    }
  });

  test("honours a narrowed ramp so a chart can reserve a slot for an accent series", () => {
    // `RunsErrorRatePanel` cycles its grouped bars over the first 11 and keeps --chart-12 for the
    // error-rate line, so a 12th group can never collide with it.
    expect(chartSeriesColor(10, CHART_RAMP_LENGTH - 1)).toBe("var(--chart-11)");
    expect(chartSeriesColor(11, CHART_RAMP_LENGTH - 1)).toBe("var(--chart-1)");
    for (let i = 0; i < 40; i += 1) {
      expect(chartSeriesColor(i, CHART_RAMP_LENGTH - 1)).not.toBe("var(--chart-12)");
    }
  });

  test("clamps a bogus ramp length into 1 … CHART_RAMP_LENGTH", () => {
    expect(chartSeriesColor(3, 0)).toBe("var(--chart-1)"); // 0 → clamped to 1
    expect(chartSeriesColor(3, -5)).toBe("var(--chart-1)");
    expect(chartSeriesColor(13, 99)).toBe("var(--chart-2)"); // 99 → clamped to 12
    expect(chartSeriesColor(3, Number.NaN)).toBe("var(--chart-4)"); // falls back to 12
  });

  test("normalises a negative or fractional index instead of emitting a broken token", () => {
    expect(chartSeriesColor(-1)).toBe("var(--chart-12)");
    expect(chartSeriesColor(-13)).toBe("var(--chart-12)");
    expect(chartSeriesColor(2.7)).toBe("var(--chart-3)");
    expect(chartSeriesColor(Number.NaN)).toBe("var(--chart-1)");
  });
});

describe("chartSwatchStyle", () => {
  test("paints a legend swatch from the SAME token as the series it labels", () => {
    for (let i = 0; i < 15; i += 1) {
      expect(chartSwatchStyle(i)).toEqual({ backgroundColor: chartSeriesColor(i) });
    }
  });

  test("covers the whole ramp, including the slots past the old five-colour cycle", () => {
    // Tailwind extracts class names statically, so a `bg-chart-${n}` class is invisible to it and
    // paints only while some other file spells that literal — an inline style needs no such luck.
    expect(chartSwatchStyle(5)).toEqual({ backgroundColor: "var(--chart-6)" });
    expect(chartSwatchStyle(11)).toEqual({ backgroundColor: "var(--chart-12)" });
  });

  test("forwards a narrowed ramp", () => {
    expect(chartSwatchStyle(11, CHART_RAMP_LENGTH - 1)).toEqual({ backgroundColor: "var(--chart-1)" });
  });
});
