/**
 * compat-band.guardrail.test.ts — design-remediation T6 guardrail (critique: an UNTESTED
 * compatibility cell — score === null — used to be painted `green`, so "we verified this pairing is
 * safe" and "nothing scored this pairing" read IDENTICALLY: same colour, same `—`, an accessible
 * name that said "score n/a, 0 concerns".)
 *
 * The fix adds a fourth band, `untested`, that is the ABSENCE of evidence and must never inherit the
 * colour or the meaning of positive evidence. This guardrail locks that on BOTH sides of the wire:
 *
 *  1. The pure band mapping (the single source of truth the runner + the web share): a null score
 *     with no blocker-fail resolves to `untested`, never green.
 *  2. The render metadata (`BAND_META`): `untested` is a distinct NEUTRAL treatment — it shares no
 *     token with a passing (green) cell, it carries a hatch + its own glyph so meaning survives
 *     greyscale/colour-blindness, and every band's label is a decoded MEANING, not a colour name.
 *
 * If a future change routes a coverage gap back to green, or lets `untested` borrow the success
 * tint, or relabels the legend by hue, this goes RED.
 */
import { describe, expect, it } from "vitest";
import { type CompatibilityBand, bandForScore } from "@mcp-token-footprint/shared";
import { BAND_META, BAND_TOOLTIP, HATCH_STYLE } from "../features/compatibility/meta";

const BANDS: CompatibilityBand[] = ["green", "amber", "red", "untested"];
const COLOUR_WORDS = ["green", "amber", "red", "untested", "grey", "gray", "yellow"];

describe("GUARDRAIL — absence of evidence is never positive evidence (T6)", () => {
  it("a null score with no blocker-fail is `untested`, not green", () => {
    expect(bandForScore(null, { blockerFail: false, anyWarn: false })).toBe("untested");
    // ...and it is emphatically NOT the band a comfortably-passing cell gets.
    expect(bandForScore(null, { blockerFail: false, anyWarn: false })).not.toBe(
      bandForScore(95, { blockerFail: false, anyWarn: false }),
    );
  });

  it("the blocker gate still precedes the null → untested check (a blocker fail is red)", () => {
    expect(bandForScore(null, { blockerFail: true, anyWarn: false })).toBe("red");
  });

  it("positive evidence keeps its bands (green ≥90 clean · red <60 · amber between)", () => {
    expect(bandForScore(95, { blockerFail: false, anyWarn: false })).toBe("green");
    expect(bandForScore(90, { blockerFail: false, anyWarn: true })).toBe("amber"); // a warn blocks green
    expect(bandForScore(75, { blockerFail: false, anyWarn: false })).toBe("amber");
    expect(bandForScore(50, { blockerFail: false, anyWarn: false })).toBe("red");
  });
});

describe("GUARDRAIL — `untested` renders as a distinct neutral, never the success tint (T6)", () => {
  it("every band has render metadata (the union is fully covered)", () => {
    for (const band of BANDS) expect(BAND_META[band], `BAND_META missing ${band}`).toBeTruthy();
    expect(Object.keys(BAND_META).sort()).toEqual([...BANDS].sort());
  });

  it("`untested` shares NO token with the passing (green) band", () => {
    const untested = BAND_META.untested;
    const green = BAND_META.green;
    // The whole defect: the untested cell must not look like a faint pass.
    expect(untested.cell).not.toBe(green.cell);
    expect(untested.dot).not.toBe(green.dot);
    // It borrows none of the positive-evidence colour tokens (success/warning/destructive)…
    for (const token of ["success", "warning", "destructive"]) {
      expect(untested.cell).not.toContain(token);
      expect(untested.dot).not.toContain(token);
    }
    // …and it IS a neutral (muted) surface.
    expect(untested.cell).toContain("muted");
  });

  it("only the green band uses the success token — a gap never wears it", () => {
    for (const band of BANDS) {
      if (band === "green") continue;
      expect(BAND_META[band].cell, `${band} must not use the success tint`).not.toContain(
        "success",
      );
    }
  });

  it("each band carries a DISTINCT glyph so meaning survives greyscale / colour-blindness", () => {
    const glyphs = BANDS.map((band) => BAND_META[band].glyph);
    for (const [i, glyph] of glyphs.entries())
      expect(glyph, `${BANDS[i]} is missing a glyph`).toBeTruthy();
    expect(new Set(glyphs).size, "band glyphs must be distinct").toBe(BANDS.length);
  });

  it("only `untested` carries the hatch texture (the 'no evidence' cue)", () => {
    expect(BAND_META.untested.hatch).toBe(true);
    for (const band of ["green", "amber", "red"] as const)
      expect(BAND_META[band].hatch, `${band} should not be hatched`).toBeFalsy();
  });

  it("the hatch is token-driven — a CSS var, never a raw colour literal", () => {
    const image = String(HATCH_STYLE.backgroundImage ?? "");
    expect(image).toContain("var(--");
    expect(image).not.toMatch(/#[0-9a-fA-F]{3}/);
    expect(image).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
  });
});

describe("GUARDRAIL — the legend decodes MEANINGS, not colour names (T6)", () => {
  it("no band label is a colour word — labels say what the band means", () => {
    for (const band of BANDS) {
      const label = BAND_META[band].label.toLowerCase();
      expect(COLOUR_WORDS, `band "${band}" label "${label}" is a colour name`).not.toContain(label);
    }
  });

  it("`untested` is decoded to a plain-language meaning + accessible name", () => {
    expect(BAND_META.untested.label).toBe("Not tested");
    expect(BAND_META.untested.srLabel).toBe("not tested");
    // Its tooltip explains it is a coverage gap, not a clean result.
    expect(BAND_TOOLTIP.untested.toLowerCase()).toMatch(/gap|no applicable|not a clean/);
  });

  it("every band has a lower-case srLabel fragment for accessible names", () => {
    for (const band of BANDS) {
      const sr = BAND_META[band].srLabel;
      expect(sr, `${band} missing srLabel`).toBeTruthy();
      expect(sr).toBe(sr.toLowerCase());
    }
  });
});
