import {
  SEVERITY_RAMP,
  SEVERITY_RAMP_STEPS,
  type SeverityRampStep,
  severityRampLabel,
  severityRampTone,
} from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import { SEVERITY_META as ISSUES_SEVERITY_META } from "../issues-fleet/issue-lib";
import { ADVISOR_SEVERITY_META } from "./advisor-format";

/**
 * RM-37 WP 0.5 (action 8) — the cross-feature conformance test.
 * ==================================================================================================
 * Before the single `SEVERITY_RAMP` (`packages/shared/src/severity-ramp.ts`), four features each
 * declared their own severity → chip map by hand, and they disagreed: Advisor rendered "High" as a
 * red `destructive` chip, Issues rendered "High" as a red `destructive` chip too — by coincidence,
 * not by construction — and Compatibility rendered its own "High" as amber `warning`. Nothing here
 * stopped a future edit to any ONE of those literals from silently making the word mean something
 * different on one page than on another.
 *
 * This file is the guard against that regression. It does not re-test the ramp itself (that lives
 * in `packages/shared`, already built and out of scope for this slice) — it tests that Advisor's
 * and Issues' own maps are still thin, honest projections of the ramp, and that the one rung both
 * features actually share ("high") renders as the literal same object.
 *
 * The mutation probe (see the WP report) confirmed this test goes RED the moment either map's
 * `variant` is hand-edited back to a literal that disagrees with the ramp.
 */

describe("Advisor's severity chip map is a thin projection of SEVERITY_RAMP", () => {
  const advisorRampStep: Record<keyof typeof ADVISOR_SEVERITY_META, SeverityRampStep> = {
    high: "high",
    medium: "medium",
    info: "low",
  };

  for (const [severity, step] of Object.entries(advisorRampStep) as [
    keyof typeof ADVISOR_SEVERITY_META,
    SeverityRampStep,
  ][]) {
    it(`ADVISOR_SEVERITY_META.${severity} reads its tone AND label off ramp step "${step}"`, () => {
      expect(ADVISOR_SEVERITY_META[severity].variant).toBe(severityRampTone(step));
      expect(ADVISOR_SEVERITY_META[severity].label).toBe(severityRampLabel(step));
    });
  }

  it('renders Advisor\'s mildest wire value ("info") as "Low" — the same rung as Issues\' "low", not a bespoke fourth tone', () => {
    expect(ADVISOR_SEVERITY_META.info).toEqual({ label: "Low", variant: "outline" });
  });
});

describe("Issues' severity chip map is a thin projection of SEVERITY_RAMP", () => {
  const issuesRampStep: Record<keyof typeof ISSUES_SEVERITY_META, SeverityRampStep> = {
    high: "high",
    medium: "medium",
    low: "low",
  };

  for (const [severity, step] of Object.entries(issuesRampStep) as [
    keyof typeof ISSUES_SEVERITY_META,
    SeverityRampStep,
  ][]) {
    it(`ISSUES_SEVERITY_META.${severity} reads its tone AND label off ramp step "${step}"`, () => {
      expect(ISSUES_SEVERITY_META[severity].variant).toBe(severityRampTone(step));
      expect(ISSUES_SEVERITY_META[severity].label).toBe(severityRampLabel(step));
    });
  }
});

describe("the cross-feature invariant this work package exists to enforce", () => {
  it('Advisor\'s "high" and Issues\' "high" are the SAME chip — same variant, same label', () => {
    // This is the assertion that would have caught the original defect directly: two features
    // rendering the same severity WORD as two different colours. Compare the whole object, not
    // just the variant, so a label drift (e.g. one side silently renaming "High" to "Critical")
    // fails here too.
    expect(ADVISOR_SEVERITY_META.high).toEqual(ISSUES_SEVERITY_META.high);
  });

  it('Advisor\'s "medium" and Issues\' "medium" are the SAME chip', () => {
    expect(ADVISOR_SEVERITY_META.medium).toEqual(ISSUES_SEVERITY_META.medium);
  });

  it('Advisor\'s "low" rung (info) and Issues\' "low" are the SAME chip', () => {
    expect(ADVISOR_SEVERITY_META.info).toEqual(ISSUES_SEVERITY_META.low);
  });
});

describe("non-vacuity guard — the ramp itself must still carry four DISTINCT tones", () => {
  // Without this, every assertion above could pass by every rung collapsing onto one tone (e.g. if
  // a future edit made `severityRampTone` always return "destructive"). Pin the ramp's shape
  // directly so that degenerate case is caught here, not just trusted from `packages/shared`.
  it("SEVERITY_RAMP_STEPS still has exactly four steps, worst-first", () => {
    expect(SEVERITY_RAMP_STEPS).toEqual(["critical", "high", "medium", "low"]);
  });

  it("all four ramp steps map to four DISTINCT Badge variants", () => {
    const variants = SEVERITY_RAMP_STEPS.map((step) => SEVERITY_RAMP[step].variant);
    expect(new Set(variants).size).toBe(4);
  });

  it("all four ramp steps carry four DISTINCT labels", () => {
    const labels = SEVERITY_RAMP_STEPS.map((step) => SEVERITY_RAMP[step].label);
    expect(new Set(labels).size).toBe(4);
  });
});
