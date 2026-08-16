import { describe, expect, test } from "vitest";
import {
  defaultUsageControls,
  parseUsageControlsFromSearchParams,
  summaryDaysFor,
  usageRangeQuery,
  writeUsageControlsToSearchParams,
  type UsageControls,
} from "./usage-url-state";

describe("usage-url-state — URL round-trip (WP2.6 acceptance: drill state lives in the URL)", () => {
  test("defaultUsageControls is all-time, grouped by agent, no project narrow", () => {
    expect(defaultUsageControls()).toEqual({
      from: undefined,
      to: undefined,
      groupBy: "agent",
      projectId: undefined,
    });
  });

  test("the default control set writes a CLEAN url (no params)", () => {
    const params = writeUsageControlsToSearchParams(new URLSearchParams(), defaultUsageControls());
    expect(params.toString()).toBe("");
  });

  test("parse(write(controls)) round-trips exactly for a fully-set control set", () => {
    const controls: UsageControls = {
      from: "2026-06-01",
      to: "2026-06-30",
      groupBy: "crew",
      projectId: "proj_42",
    };
    const written = writeUsageControlsToSearchParams(new URLSearchParams(), controls);
    const parsed = parseUsageControlsFromSearchParams(written);
    expect(parsed).toEqual(controls);
  });

  test("round-trips through a real query string (encode/decode, not just the URLSearchParams object)", () => {
    const controls: UsageControls = {
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy: "model",
      projectId: "p-1",
    };
    const written = writeUsageControlsToSearchParams(new URLSearchParams(), controls);
    const reparsed = parseUsageControlsFromSearchParams(new URLSearchParams(written.toString()));
    expect(reparsed).toEqual(controls);
  });

  test("writeUsageControlsToSearchParams preserves an unrelated param already on the URL", () => {
    const params = new URLSearchParams("tab=usage&scope=crew:eng");
    const written = writeUsageControlsToSearchParams(params, {
      from: undefined,
      to: undefined,
      groupBy: "model",
      projectId: undefined,
    });
    expect(written.get("tab")).toBe("usage");
    expect(written.get("scope")).toBe("crew:eng");
    expect(written.get("uGroupBy")).toBe("model");
  });

  test("malformed/unknown values fall back to the default field-by-field, never throw", () => {
    const params = new URLSearchParams("uFrom=not-a-date&uGroupBy=bogus&uProject=");
    const parsed = parseUsageControlsFromSearchParams(params);
    expect(parsed).toEqual(defaultUsageControls());
  });

  test("a valid groupBy but no other params parses correctly", () => {
    const parsed = parseUsageControlsFromSearchParams(new URLSearchParams("uGroupBy=mode"));
    expect(parsed.groupBy).toBe("mode");
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });

  test("usageRangeQuery omits unset fields (an honest 'all time' server query)", () => {
    expect(usageRangeQuery(defaultUsageControls())).toEqual({});
    expect(
      usageRangeQuery({ from: "2026-01-01", to: undefined, groupBy: "agent", projectId: "p1" }),
    ).toEqual({ from: "2026-01-01", projectId: "p1" });
  });

  test("summaryDaysFor defaults to 30 when no range is selected", () => {
    expect(summaryDaysFor(defaultUsageControls())).toBe(30);
  });

  test("summaryDaysFor sizes to the selected range's span, clamped to [1, 90]", () => {
    expect(
      summaryDaysFor({
        from: "2026-06-01",
        to: "2026-06-10",
        groupBy: "agent",
        projectId: undefined,
      }),
    ).toBe(10);
    // A same-day range is 1 day, never 0.
    expect(
      summaryDaysFor({
        from: "2026-06-01",
        to: "2026-06-01",
        groupBy: "agent",
        projectId: undefined,
      }),
    ).toBe(1);
    // A > 90 day span clamps to the route's upper bound.
    expect(
      summaryDaysFor({
        from: "2025-01-01",
        to: "2026-06-30",
        groupBy: "agent",
        projectId: undefined,
      }),
    ).toBe(90);
  });
});
