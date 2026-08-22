import {
  COMPATIBILITY_SEVERITY_LABEL,
  COMPATIBILITY_SEVERITY_RAMP_STEP,
  SEVERITY_RAMP_STEPS,
  severityRampLabel,
  severityRampTone,
} from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import { OUTCOME_META, SEVERITY_META } from "./meta";

/**
 * RM-37 WP 0.5 (action 7) — Compatibility's severity chip map is LIMIT language, not the ramp's
 * adjectives, but its TONE must still be a thin projection of the one shared `SEVERITY_RAMP`
 * (`packages/shared/src/severity-ramp.ts`) — the same invariant Advisor and Issues are held to in
 * `../advisor/severity-ramp-conformance.test.ts`. Before this WP, `SEVERITY_META` hand-declared both
 * the label ("Blocker") and the variant as literals; nothing stopped a future edit from drifting the
 * colour away from the ramp. This file pins the derivation so that regression is caught here.
 *
 * Compatibility is the ONE feature the ramp's own module doc calls out as deliberately NOT using
 * `severityRampLabel` — a model limit reads better as "Exceeds limit" than as "Critical" — so this
 * test checks the label against `COMPATIBILITY_SEVERITY_LABEL` instead, and only the TONE against
 * the ramp.
 */

describe("Compatibility's SEVERITY_META is a thin projection of SEVERITY_RAMP (tone) + COMPATIBILITY_SEVERITY_LABEL (label)", () => {
  const severities = ["blocker", "high", "medium", "low"] as const;

  for (const severity of severities) {
    const step = COMPATIBILITY_SEVERITY_RAMP_STEP[severity];

    it(`SEVERITY_META.${severity} reads its TONE off ramp step "${step}"`, () => {
      expect(SEVERITY_META[severity].variant).toBe(severityRampTone(step));
    });

    it(`SEVERITY_META.${severity} reads its LABEL off COMPATIBILITY_SEVERITY_LABEL, not severityRampLabel`, () => {
      expect(SEVERITY_META[severity].label).toBe(COMPATIBILITY_SEVERITY_LABEL[severity]);
    });
  }

  it('deliberately does NOT use the ramp\'s own adjective labels ("Critical"/"High"/"Medium"/"Low") — a model limit is named by the limit, not a mood word', () => {
    for (const severity of severities) {
      const step = COMPATIBILITY_SEVERITY_RAMP_STEP[severity];
      expect(SEVERITY_META[severity].label).not.toBe(severityRampLabel(step));
    }
  });

  it("na shares the neutral secondary chip, off-ramp", () => {
    expect(SEVERITY_META.na).toEqual({ label: "N/A", variant: "secondary" });
  });
});

describe("OUTCOME_META follows SEVERITY_META (no second, independently-drifting copy)", () => {
  it("pass/blocker/high/medium/low all match SEVERITY_META's rungs", () => {
    expect(OUTCOME_META.blocker).toEqual(SEVERITY_META.blocker);
    expect(OUTCOME_META.high).toEqual(SEVERITY_META.high);
    expect(OUTCOME_META.medium).toEqual(SEVERITY_META.medium);
    expect(OUTCOME_META.low).toEqual(SEVERITY_META.low);
  });
});

describe("non-vacuity guard — the four compatibility severities still carry four DISTINCT tones", () => {
  // Without this, every assertion above could pass by every rung collapsing onto one tone/label.
  it("SEVERITY_RAMP_STEPS still has exactly four steps, worst-first", () => {
    expect(SEVERITY_RAMP_STEPS).toEqual(["critical", "high", "medium", "low"]);
  });

  it("all four compatibility severities map to four DISTINCT Badge variants", () => {
    const variants = (["blocker", "high", "medium", "low"] as const).map(
      (s) => SEVERITY_META[s].variant,
    );
    expect(new Set(variants).size).toBe(4);
  });

  it("all four compatibility severities carry four DISTINCT limit-language labels", () => {
    const labels = (["blocker", "high", "medium", "low"] as const).map((s) => SEVERITY_META[s].label);
    expect(new Set(labels).size).toBe(4);
  });

  it('"blocker" is the ONLY compatibility severity on the ramp\'s scarce "critical"/destructive rung', () => {
    expect(COMPATIBILITY_SEVERITY_RAMP_STEP.blocker).toBe("critical");
    expect(SEVERITY_META.blocker.variant).toBe("destructive");
    for (const severity of ["high", "medium", "low"] as const) {
      expect(SEVERITY_META[severity].variant).not.toBe("destructive");
    }
  });
});
