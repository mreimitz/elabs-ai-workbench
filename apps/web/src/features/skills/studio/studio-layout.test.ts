import { beforeEach, describe, expect, test } from "vitest";
import {
  APP_SIDEBAR_WIDTH_PX,
  readStudioRailCollapsed,
  STUDIO_COLLAPSED_RAIL_WIDTH_PX,
  STUDIO_CONTEXT_PANEL_WIDTH_PX,
  STUDIO_LEFT_RAIL_WIDTH_PX,
  studioCentreShareOfPage,
  studioCentreShareOfViewport,
  studioCentreWidthPx,
  writeStudioRailCollapsed,
} from "./studio-layout";

// ── RM-30 WP 7.1 acceptance: "centre surface ≥60% viewport width at 1600×1000 with both rails open,
//    more when collapsed" ──────────────────────────────────────────────────────────────────────────
// jsdom has no layout engine, so this pins the ARITHMETIC the flex row performs. It is not a guess:
// the constants were CALIBRATED against the running app at 1600×1000 (Chromium via Playwright,
// `getBoundingClientRect` on each region), and the numbers below are the ones the browser painted.
//
// Measured with the pre-calibration widths (w-60 / w-64): centre 937px = 58.6% — a real miss, caused
// by the design system's ~13.125px root making `w-60` paint at 197px rather than the 240px a 16px
// root would give. The rails were trimmed to `w-56` and re-measured rather than the bar being
// re-interpreted.

const VIEWPORT = 1600;
const BOTH_OPEN = { leftCollapsed: false, contextCollapsed: false };
const DEFAULT_STATE = { leftCollapsed: false, contextCollapsed: true };
const BOTH_COLLAPSED = { leftCollapsed: true, contextCollapsed: true };

describe("studioCentreWidthPx", () => {
  test("is what the flex row leaves after the two rails and the app sidebar", () => {
    expect(studioCentreWidthPx(VIEWPORT, BOTH_OPEN)).toBe(
      VIEWPORT - APP_SIDEBAR_WIDTH_PX - STUDIO_LEFT_RAIL_WIDTH_PX - STUDIO_CONTEXT_PANEL_WIDTH_PX,
    );
  });

  test("collapsing a rail gives the width back to the centre", () => {
    expect(studioCentreWidthPx(VIEWPORT, DEFAULT_STATE)).toBeCloseTo(
      studioCentreWidthPx(VIEWPORT, BOTH_OPEN) +
        STUDIO_CONTEXT_PANEL_WIDTH_PX -
        STUDIO_COLLAPSED_RAIL_WIDTH_PX,
      5,
    );
  });

  test("never goes negative on a narrow viewport", () => {
    expect(studioCentreWidthPx(320, BOTH_OPEN)).toBe(0);
  });
});

describe("the ≥60% centre-surface bar at 1600×1000", () => {
  test("BOTH rails open clears 60% of the VIEWPORT — the acceptance bar as written", () => {
    expect(studioCentreShareOfViewport(VIEWPORT, BOTH_OPEN)).toBeGreaterThanOrEqual(0.6);
  });

  test("…and the pre-calibration rails would NOT have — the bar has real margin, not luck", () => {
    // `w-60` + `w-64` at this app's root: 197 + 210 = 407px of rail → 937px of centre.
    const preCalibrationCentre = VIEWPORT - APP_SIDEBAR_WIDTH_PX - 197 - 210;
    expect(preCalibrationCentre / VIEWPORT).toBeLessThan(0.6);
    // The shipped widths beat that by a margin measured in tens of px, not ones.
    expect(studioCentreWidthPx(VIEWPORT, BOTH_OPEN) - preCalibrationCentre).toBeGreaterThan(20);
  });

  test("the DEFAULT state (context panel collapsed) is comfortably clear", () => {
    expect(studioCentreShareOfViewport(VIEWPORT, DEFAULT_STATE)).toBeGreaterThanOrEqual(0.65);
  });

  test("collapsing gives MORE — strictly monotone in the direction the WP requires", () => {
    const open = studioCentreShareOfViewport(VIEWPORT, BOTH_OPEN);
    const oneOpen = studioCentreShareOfViewport(VIEWPORT, DEFAULT_STATE);
    const none = studioCentreShareOfViewport(VIEWPORT, BOTH_COLLAPSED);
    expect(oneOpen).toBeGreaterThan(open);
    expect(none).toBeGreaterThan(oneOpen);
  });

  test("against the width the ROUTE controls it is clear by a wide margin", () => {
    expect(studioCentreShareOfPage(VIEWPORT, BOTH_OPEN)).toBeGreaterThanOrEqual(0.7);
  });
});

describe("rail collapse persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("an unset flag reads as the caller's default — left open, context collapsed", () => {
    expect(readStudioRailCollapsed("left", false)).toBe(false);
    expect(readStudioRailCollapsed("context", true)).toBe(true);
  });

  test("round-trips per rail under distinct keys", () => {
    writeStudioRailCollapsed("left", true);
    expect(readStudioRailCollapsed("left", false)).toBe(true);
    // The other rail is untouched.
    expect(readStudioRailCollapsed("context", true)).toBe(true);

    writeStudioRailCollapsed("context", false);
    expect(readStudioRailCollapsed("context", true)).toBe(false);
    expect(readStudioRailCollapsed("left", false)).toBe(true);
  });
});
