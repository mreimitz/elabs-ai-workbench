/**
 * hub-ux.test.ts — Tests for hub-ux constants and helpers
 */

import { describe, it, expect } from "vitest";
import {
  META_RAIL_WIDTH_PX,
  META_RAIL_SHEET_BREAKPOINT_PX,
  META_RAIL_SHRINK_INTENT,
  CREW_COLORS,
  CREW_COLOR_KEYS,
  crewAccentClasses,
  resolveIntroDockState,
  CANVAS_GRID_CELL_SIZE_PX,
  CANVAS_GRID_DOT_SIZE_PX,
  CANVAS_GRID_OPACITY,
  canvasGridBackgroundStyle,
  CHOREOGRAPHY_DURATION_MS,
  CHOREOGRAPHY_DURATION_CLASS,
  CHOREOGRAPHY_EASING,
  CHOREOGRAPHY_EASING_CLASS,
  CHOREOGRAPHY_TRANSITION_PROPERTY,
  choreographyTransitionClass,
  CHOREOGRAPHY_CENTER_TO_DOCK_OFFSET_PX,
  canvasGridMaskStyle,
  CHAT_CANVAS_DECORATION_LEVEL,
  COMPOSER_CLEARANCE_EXTRA_PX,
  composerClearancePx,
  type ChartColorKey,
} from "./hub-ux";

describe("hub-ux constants", () => {
  describe("D-HUX3: Meta-rail dimensions", () => {
    it("exports the correct meta-rail width", () => {
      expect(META_RAIL_WIDTH_PX).toBe(360);
    });

    it("exports the correct sheet breakpoint", () => {
      expect(META_RAIL_SHEET_BREAKPOINT_PX).toBe(1100);
    });

    it("exports the shrink-0 intent", () => {
      expect(META_RAIL_SHRINK_INTENT).toBe("shrink-0");
    });
  });

  describe("D-HUX8: Crew colors", () => {
    it("exports exactly 5 crew color keys", () => {
      expect(CREW_COLOR_KEYS).toHaveLength(5);
      expect(CREW_COLOR_KEYS).toEqual(["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]);
    });

    it("maps each crew color key to itself", () => {
      for (const key of CREW_COLOR_KEYS) {
        expect(CREW_COLORS[key]).toBe(key);
      }
    });

    it("returns accent classes for a valid color", () => {
      const classes = crewAccentClasses("chart-1");
      expect(classes.ring).toContain("ring-[var(--chart-1)]");
      expect(classes.borderTop).toContain("border-t-[var(--chart-1)]");
      expect(classes.dot).toContain("bg-[var(--chart-1)]");
    });

    it("returns fallback classes for null/undefined color", () => {
      const classesNull = crewAccentClasses(null);
      expect(classesNull.ring).toBe("ring-border");
      expect(classesNull.borderTop).toBe("border-t-border");
      expect(classesNull.dot).toBe("bg-muted-foreground");

      const classesUndefined = crewAccentClasses(undefined);
      expect(classesUndefined.ring).toBe("ring-border");
    });

    it("returns fallback classes for invalid color key", () => {
      const classes = crewAccentClasses("invalid" as ChartColorKey);
      expect(classes.ring).toBe("ring-border");
    });

    it("all crew color keys map correctly", () => {
      for (const key of CREW_COLOR_KEYS) {
        const classes = crewAccentClasses(key);
        expect(classes.ring).toContain(`--${key}`);
        expect(classes.borderTop).toContain(`--${key}`);
        expect(classes.dot).toContain(`--${key}`);
      }
    });
  });

  describe("D-HUX12: Canvas grid", () => {
    it("exports correct grid cell and dot sizes", () => {
      expect(CANVAS_GRID_CELL_SIZE_PX).toBe(12); // owner-feedback: denser than the original 14
      expect(CANVAS_GRID_DOT_SIZE_PX).toBe(1);
    });

    it("returns background style with correct radial-gradient", () => {
      const style = canvasGridBackgroundStyle();
      expect(style.backgroundImage).toContain("radial-gradient");
      expect(style.backgroundImage).toContain("var(--canvas-grid)");
      expect(style.backgroundImage).toContain("1px");
      expect(style.backgroundSize).toBe("12px 12px");
      expect(style.backgroundPosition).toBe("0 0");
    });

    it("uses semantic --canvas-grid token (no raw colors)", () => {
      const style = canvasGridBackgroundStyle();
      expect(style.backgroundImage).toContain("var(--canvas-grid)");
      expect(style.backgroundImage).not.toMatch(/#[0-9a-fA-F]/);
      expect(style.backgroundImage).not.toMatch(/rgba?\(/);
    });

    it("exports a FLIPPED mask style — transparent at the top, solid toward the bottom", () => {
      const mask = canvasGridMaskStyle();
      expect(mask.maskImage).toContain("linear-gradient");
      expect(mask.maskImage).toContain("transparent");
      // owner-feedback: `transparent` leads (top) and `black` trails (bottom) — the opposite of the
      // original, which faded OUT toward the bottom before the composer.
      const image = String(mask.maskImage);
      expect(image.indexOf("transparent")).toBeLessThan(image.lastIndexOf("black"));
      expect(mask.WebkitMaskImage).toBe(mask.maskImage);
    });

    it("dials the grid layer a little quieter (a valid opacity multiplier < 1)", () => {
      expect(CANVAS_GRID_OPACITY).toBeGreaterThan(0);
      expect(CANVAS_GRID_OPACITY).toBeLessThan(1);
    });

    it("keeps canvasGridBackgroundStyle's own shape unchanged (no mask keys leaked in)", () => {
      const style = canvasGridBackgroundStyle();
      expect(style).not.toHaveProperty("maskImage");
      expect(style).not.toHaveProperty("WebkitMaskImage");
    });

    it("exports the chat canvas's default (non-minimal) decoration level", () => {
      expect(CHAT_CANVAS_DECORATION_LEVEL).toBeGreaterThan(0);
      expect(CHAT_CANVAS_DECORATION_LEVEL).toBeLessThanOrEqual(10);
    });
  });

  describe("D-HUX13: Choreography animation", () => {
    it("exports choreography duration within spec", () => {
      expect(CHOREOGRAPHY_DURATION_MS).toBeGreaterThanOrEqual(240);
      expect(CHOREOGRAPHY_DURATION_MS).toBeLessThanOrEqual(280);
    });

    it("exports duration class as duration-*", () => {
      expect(CHOREOGRAPHY_DURATION_CLASS).toMatch(/^duration-\d+$/);
    });

    it("exports cubic-bezier easing (standard)", () => {
      expect(CHOREOGRAPHY_EASING).toContain("cubic-bezier");
    });

    it("exports easing class", () => {
      expect(CHOREOGRAPHY_EASING_CLASS).toBe("ease-out");
    });

    it("exports transform as the transition property", () => {
      expect(CHOREOGRAPHY_TRANSITION_PROPERTY).toBe("transform");
    });

    it("choreography transition class includes motion-reduce", () => {
      const classes = choreographyTransitionClass();
      expect(classes).toContain("transition-transform");
      expect(classes).toContain(CHOREOGRAPHY_DURATION_CLASS);
      expect(classes).toContain(CHOREOGRAPHY_EASING_CLASS);
      expect(classes).toContain("motion-reduce:transition-none");
    });

    it("exports center-to-dock offset", () => {
      expect(CHOREOGRAPHY_CENTER_TO_DOCK_OFFSET_PX).toBeGreaterThan(0);
    });
  });

  describe("WP1.R-C: composer clearance", () => {
    it("adds the fixed extra to a measured composer height (rounded)", () => {
      expect(composerClearancePx(100)).toBe(100 + COMPOSER_CLEARANCE_EXTRA_PX);
      expect(composerClearancePx(0)).toBe(COMPOSER_CLEARANCE_EXTRA_PX);
      // A tall composer (multi-line + attachment chips + Stop) reserves MORE than the old fixed 160px.
      expect(composerClearancePx(220)).toBeGreaterThan(160);
      expect(composerClearancePx(133.4)).toBe(133 + COMPOSER_CLEARANCE_EXTRA_PX);
    });

    it("clamps a non-finite / negative height to just the extra (never negative)", () => {
      expect(composerClearancePx(Number.NaN)).toBe(COMPOSER_CLEARANCE_EXTRA_PX);
      expect(composerClearancePx(-50)).toBe(COMPOSER_CLEARANCE_EXTRA_PX);
      expect(composerClearancePx(Number.POSITIVE_INFINITY)).toBe(COMPOSER_CLEARANCE_EXTRA_PX);
    });
  });

  describe("D-HUX13: resolveIntroDockState (fresh-session welcome vs. docked)", () => {
    it("a fresh EMPTY session (turns 0/absent, quiet stream) is CENTERED — the welcome emblem shows", () => {
      expect(
        resolveIntroDockState({ turns: 0, turnRunning: false, timelineLength: 0 }),
      ).toBe("centered");
      expect(
        resolveIntroDockState({ turnRunning: false, timelineLength: 0 }),
      ).toBe("centered");
      expect(
        resolveIntroDockState({ turns: null, turnRunning: false, timelineLength: 0 }),
      ).toBe("centered");
    });

    it("a session with real history (turns > 0) is DOCKED even before its stream has replayed", () => {
      // The bug: seeding off the stream alone left `timelineLength` 0 until async replay, so a history
      // session flashed centered. `turns` is synchronous with the switch, so it docks instantly.
      expect(
        resolveIntroDockState({ turns: 3, turnRunning: false, timelineLength: 0 }),
      ).toBe("docked");
    });

    it("a fresh session flips to DOCKED once the live stream reports the first turn (the glide)", () => {
      expect(
        resolveIntroDockState({ turns: 0, turnRunning: true, timelineLength: 0 }),
      ).toBe("docked");
      expect(
        resolveIntroDockState({ turns: 0, turnRunning: false, timelineLength: 1 }),
      ).toBe("docked");
    });
  });
});
