import { describe, expect, test } from "vitest";
import {
  DELTA_BADGE_VARIANT,
  DELTA_BAR_TONE,
  DELTA_CELL_WASH,
  DELTA_TEXT_TONE,
  type DeltaOutcome,
  deltaOutcome,
  deltaTextTone,
} from "./delta";

// The single delta convention (interface-craft WP 2.2, D-IC3 / D-UX9). These locks are what make
// "worse" one identical amber tone across Scans + every Compare/Suite surface, and "better" one
// identical green — the whole point of routing all six surfaces through this module.

describe("deltaOutcome — direction-aware classification", () => {
  test("lower-is-better metric (tokens/cost/latency): a rise is worse, a drop is better", () => {
    expect(deltaOutcome(100, false)).toBe("worse");
    expect(deltaOutcome(-100, false)).toBe("better");
  });

  test("higher-is-better metric (score/quality/pass): a rise is better, a drop is worse", () => {
    expect(deltaOutcome(0.1, true)).toBe("better");
    expect(deltaOutcome(-0.1, true)).toBe("worse");
  });

  test("a tie / missing / NaN delta is neutral — never a better/worse judgement", () => {
    expect(deltaOutcome(0, false)).toBe("neutral");
    expect(deltaOutcome(0, true)).toBe("neutral");
    expect(deltaOutcome(null, false)).toBe("neutral");
    expect(deltaOutcome(undefined, true)).toBe("neutral");
    expect(deltaOutcome(Number.NaN, false)).toBe("neutral");
  });
});

describe("DELTA_TEXT_TONE — the one tone mapping (better→success, worse→WARNING amber, neutral→muted)", () => {
  test("better is success-green, worse is warning-AMBER (not destructive-red), neutral is muted", () => {
    expect(DELTA_TEXT_TONE.better).toBe("text-success-text");
    expect(DELTA_TEXT_TONE.worse).toBe("text-warning-text");
    expect(DELTA_TEXT_TONE.neutral).toBe("text-muted-foreground");
  });

  test("worse is amber, never red — red is reserved for structural removal (D-UX9)", () => {
    expect(DELTA_TEXT_TONE.worse).not.toContain("destructive");
    expect(DELTA_TEXT_TONE.worse).not.toContain("primary");
  });

  test("better never falls back to --primary (the SuiteDeltas bug this WP fixes)", () => {
    expect(DELTA_TEXT_TONE.better).not.toContain("primary");
  });
});

describe("deltaTextTone — classify + map in one call", () => {
  test("maps each surface's delta to the shared tone token", () => {
    // More tokens is worse → amber.
    expect(deltaTextTone(500, false)).toBe("text-warning-text");
    // Fewer tokens is better → green.
    expect(deltaTextTone(-500, false)).toBe("text-success-text");
    // A higher grade is better → green.
    expect(deltaTextTone(0.05, true)).toBe("text-success-text");
    // A lower grade is worse → amber.
    expect(deltaTextTone(-0.05, true)).toBe("text-warning-text");
    // A tie → muted.
    expect(deltaTextTone(0, true)).toBe("text-muted-foreground");
    expect(deltaTextTone(null, false)).toBe("text-muted-foreground");
  });
});

describe("the fill / wash / badge variants agree on outcome (one meaning per colour)", () => {
  const outcomes: DeltaOutcome[] = ["better", "worse", "neutral"];

  test("every representation defines exactly the three outcomes", () => {
    for (const rec of [DELTA_TEXT_TONE, DELTA_BAR_TONE, DELTA_CELL_WASH, DELTA_BADGE_VARIANT]) {
      expect(Object.keys(rec).sort()).toEqual([...outcomes].sort());
    }
  });

  test("worse is amber (warning), not destructive-red, in every representation", () => {
    expect(DELTA_BAR_TONE.worse).toBe("bg-warning");
    expect(DELTA_CELL_WASH.worse).toContain("bg-warning");
    expect(DELTA_BADGE_VARIANT.worse).toBe("warning");
    for (const rec of [DELTA_BAR_TONE, DELTA_CELL_WASH]) {
      expect(rec.worse).not.toContain("destructive");
    }
  });

  test("better is success-green in every representation", () => {
    expect(DELTA_BAR_TONE.better).toBe("bg-success");
    expect(DELTA_CELL_WASH.better).toContain("bg-success");
    expect(DELTA_BADGE_VARIANT.better).toBe("success");
  });
});
