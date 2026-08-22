import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SECURITY_SCORE_BANDS,
  SECURITY_SCORE_BAND_MINIMUM,
  SECURITY_SEVERITIES,
  type SecurityFinding,
  type SecurityScoreBand,
  type SecuritySeverity,
  computeSecurityScore,
} from "@mcp-token-footprint/shared";
import { FindingSeverityBadge, severityLabel } from "./FindingSeverityBadge";
import { PostureScore, ScoreScaleHint, postureBandLabel } from "./PostureScore";

/** A minimal finding of a given severity — only `severity` reaches `computeSecurityScore`. */
function severityFinding(severity: SecuritySeverity): SecurityFinding {
  return {
    ruleId: "schema.undescribed-parameter",
    severity,
    anchor: { kind: "server" },
    message: "fixture",
  } as SecurityFinding;
}

// The two vocabularies this feature adds. Both are exhaustive over a contract tuple on purpose: a
// nineteenth rule severity or a fifth band would fail these tests rather than render as a blank
// chip, which is the failure mode a `Record` lookup has when the contract moves underneath it.

describe("the posture band vocabulary (D-SP3)", () => {
  it("names every band the contract declares, and no two the same", () => {
    const labels = SECURITY_SCORE_BANDS.map(postureBandLabel);
    expect(labels).toEqual(["Clean", "Low risk", "Medium risk", "High risk"]);
    expect(new Set(labels).size).toBe(SECURITY_SCORE_BANDS.length);
  });

  it("renders the band it was GIVEN, for every band, without looking at the number", () => {
    // Each pair is deliberately inconsistent with `computeSecurityScore`'s own thresholds. A
    // component that re-derived the band would print something else for at least three of them.
    const pairs: [number, SecurityScoreBand][] = [
      [0, "clean"],
      [100, "low"],
      [100, "medium"],
      [100, "high"],
    ];
    for (const [value, band] of pairs) {
      const { unmount } = render(<PostureScore score={{ value, band, analyzerVersion: 1 }} />);
      expect(screen.getByText(postureBandLabel(band))).toBeTruthy();
      unmount();
    }
  });

  // RM-37 WP 0.5 (action 5) — a bare "15" beside a token count and a tool count is a third
  // unlabelled number. The denominator is what makes it a score.
  it("prints the score OUT OF 100, not as a bare number", () => {
    render(<PostureScore score={{ value: 15, band: "high", analyzerVersion: 4 }} />);
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("/ 100")).toBeTruthy();
    // The accessible name still says it in words, so the "/ 100" can stay decorative.
    expect(screen.getByLabelText("Posture score 15 of 100")).toBeTruthy();
  });

  it("puts the score in the chip variant's accessible name, so the band is never the only cue", () => {
    render(<PostureScore score={{ value: 62, band: "high", analyzerVersion: 1 }} variant="chip" />);
    expect(
      screen.getByRole("img", { name: "Security posture High risk, score 62 of 100" }),
    ).toBeTruthy();
  });
});

// RM-37 WP 0.5 (action 5). The header of `PostureScore.tsx` says that writing `value >= 90` in that
// file is the bug — so this asserts the hint against the CONTRACT's table, not against literals. A
// view that retyped a threshold would keep passing a snapshot test and silently disagree with the
// gate the first time a band moved; this one cannot.
describe("the score scale hint reads the contract's thresholds", () => {
  it("names every band with its own inclusive floor", () => {
    render(<ScoreScaleHint />);
    for (const band of SECURITY_SCORE_BANDS) {
      expect(screen.getByText(postureBandLabel(band))).toBeTruthy();
    }
    expect(screen.getByText(`${SECURITY_SCORE_BAND_MINIMUM.low} and above`)).toBeTruthy();
    expect(screen.getByText(`${SECURITY_SCORE_BAND_MINIMUM.medium} and above`)).toBeTruthy();
    expect(screen.getByText(`${SECURITY_SCORE_BAND_MINIMUM.high} and above`)).toBeTruthy();
    // `clean` is not a range — it means nothing at all was found, and says so.
    expect(screen.getByText("100 — nothing found")).toBeTruthy();
  });

  it("bands a score at each printed floor exactly as the hint claims", () => {
    // The hint would be a LIE if a score sitting on a printed floor did not actually band that way.
    // This runs the contract's own scorer at each floor rather than trusting the table twice.
    for (const band of SECURITY_SCORE_BANDS) {
      const floor = SECURITY_SCORE_BAND_MINIMUM[band];
      // `info` deducts 1 apiece and is capped at 10, so any score from 90..100 is reachable with
      // info findings alone; below that, `error` (15 apiece, uncapped) covers the rest.
      const findings =
        floor >= 90
          ? Array.from({ length: 100 - floor }, () => severityFinding("info"))
          : Array.from({ length: Math.ceil((100 - floor) / 15) }, () => severityFinding("error"));
      expect(computeSecurityScore(findings).band).toBe(band);
    }
  });
});

describe("the finding severity vocabulary (D-SP5)", () => {
  it("names every severity the contract declares", () => {
    expect(SECURITY_SEVERITIES.map(severityLabel)).toEqual(["Error", "Warning", "Info"]);
  });

  it("renders each severity as its own chip", () => {
    for (const severity of SECURITY_SEVERITIES) {
      const { unmount } = render(<FindingSeverityBadge severity={severity} />);
      expect(screen.getByText(severityLabel(severity))).toBeTruthy();
      unmount();
    }
  });
});
