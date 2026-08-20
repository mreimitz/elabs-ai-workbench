import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SECURITY_SCORE_BANDS,
  SECURITY_SEVERITIES,
  type SecurityScoreBand,
} from "@mcp-token-footprint/shared";
import { FindingSeverityBadge, severityLabel } from "./FindingSeverityBadge";
import { PostureScore, postureBandLabel } from "./PostureScore";

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

  it("puts the score in the chip variant's accessible name, so the band is never the only cue", () => {
    render(<PostureScore score={{ value: 62, band: "high", analyzerVersion: 1 }} variant="chip" />);
    expect(
      screen.getByRole("img", { name: "Security posture High risk, score 62 of 100" }),
    ).toBeTruthy();
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
