import { describe, expect, test } from "vitest";
import {
  DASHBOARD_RANGE_KEY,
  DEFAULT_DASHBOARD_RANGE_SELECTION,
  parseDashboardRange,
  parseDashboardRangeValue,
  resolveDashboardRange,
  resolveDashboardRangeFromParams,
  sameDashboardRange,
  serializeDashboardRange,
  toCalendarDate,
  writeDashboardRange,
} from "./dashboard-range";

/**
 * dashboard-bento WP 2.2 (Defect 2) — the ONE Dashboard range.
 *
 * The two properties that carry the whole design are asserted first and directly:
 *   • a PRESET stays relative — it is never frozen into instants, so `?range=7d` still means "the
 *     last 7 days" tomorrow;
 *   • a CUSTOM range stays pinned — it means the same two days whenever the link is opened.
 * Everything else here is the compatibility surface: the legacy `?oRange=` / `?tFrom=`+`?tTo=` deep
 * links every previously-shipped Dashboard URL used must still resolve.
 */

const NOW = new Date("2026-08-20T12:00:00.000Z");
const LATER = new Date("2026-09-20T12:00:00.000Z");

describe("dashboard-range — a preset is a RULE, not two timestamps", () => {
  test("a preset serializes to its token alone; no instant ever reaches the URL", () => {
    expect(serializeDashboardRange({ kind: "preset", preset: "24h" })).toBe("24h");
    const written = writeDashboardRange(new URLSearchParams(), {
      kind: "preset",
      preset: "30d",
    });
    expect(written.get(DASHBOARD_RANGE_KEY)).toBe("30d");
    expect(written.toString()).not.toContain("T00:00");
  });

  test("the SAME preset resolves to a different (trailing) window as the clock moves", () => {
    const selection = { kind: "preset", preset: "7d" } as const;
    const today = resolveDashboardRange(selection, NOW);
    const nextMonth = resolveDashboardRange(selection, LATER);
    expect(today.to).toBe("2026-08-20T12:00:00.000Z");
    expect(today.from).toBe("2026-08-13T12:00:00.000Z");
    expect(nextMonth.to).toBe("2026-09-20T12:00:00.000Z");
    expect(nextMonth.from).toBe("2026-09-13T12:00:00.000Z");
  });

  test("each preset spans exactly its own trailing window", () => {
    expect(resolveDashboardRange({ kind: "preset", preset: "24h" }, NOW).from).toBe(
      "2026-08-19T12:00:00.000Z",
    );
    expect(resolveDashboardRange({ kind: "preset", preset: "30d" }, NOW).from).toBe(
      "2026-07-21T12:00:00.000Z",
    );
  });
});

describe("dashboard-range — a custom range is PINNED", () => {
  test("it resolves to the same instants whenever it is opened", () => {
    const selection = { kind: "custom", from: "2026-08-01", to: "2026-08-14" } as const;
    const a = resolveDashboardRange(selection, NOW);
    const b = resolveDashboardRange(selection, LATER);
    expect(a).toEqual(b);
    // Inclusive UTC day bounds — byte-identical to the window the retired Testing-tab
    // `metricsWindow` produced from `?tFrom=`/`?tTo=`, so a legacy link is not silently re-scoped.
    expect(a.from).toBe("2026-08-01T00:00:00.000Z");
    expect(a.to).toBe("2026-08-14T23:59:59.999Z");
    expect(a.preset).toBe("custom");
  });

  test("round-trips through the URL as one `from..to` value", () => {
    const selection = { kind: "custom", from: "2026-08-01", to: "2026-08-14" } as const;
    const written = writeDashboardRange(new URLSearchParams(), selection);
    expect(written.get(DASHBOARD_RANGE_KEY)).toBe("2026-08-01..2026-08-14");
    expect(parseDashboardRange(written)).toEqual(selection);
  });

  test("a reversed pair is swapped, not thrown away", () => {
    expect(parseDashboardRangeValue("2026-08-14..2026-08-01")).toEqual({
      kind: "custom",
      from: "2026-08-01",
      to: "2026-08-14",
    });
  });

  test("a single-day range reads as one date, not a range with two identical ends", () => {
    const range = resolveDashboardRange({ kind: "custom", from: "2026-08-14", to: "2026-08-14" });
    expect(range.description).toBe("Aug 14, 2026");
  });
});

describe("dashboard-range — the URL contract", () => {
  test("the DEFAULT preset is kept out of the URL entirely", () => {
    const written = writeDashboardRange(
      new URLSearchParams({ tab: "testing" }),
      DEFAULT_DASHBOARD_RANGE_SELECTION,
    );
    expect(written.has(DASHBOARD_RANGE_KEY)).toBe(false);
    expect(written.get("tab")).toBe("testing"); // unrelated keys survive
  });

  test("does not mutate the input params", () => {
    const original = new URLSearchParams({ tab: "issues" });
    writeDashboardRange(original, { kind: "preset", preset: "24h" });
    expect(original.has(DASHBOARD_RANGE_KEY)).toBe(false);
  });

  test("empty / malformed values fall back to the default rather than throwing", () => {
    expect(parseDashboardRange(new URLSearchParams())).toEqual(DEFAULT_DASHBOARD_RANGE_SELECTION);
    expect(parseDashboardRange(new URLSearchParams({ range: "90d" }))).toEqual(
      DEFAULT_DASHBOARD_RANGE_SELECTION,
    );
    expect(parseDashboardRange(new URLSearchParams({ range: "not..a..range" }))).toEqual(
      DEFAULT_DASHBOARD_RANGE_SELECTION,
    );
    expect(parseDashboardRange(new URLSearchParams({ range: "2026-13-99..2026-14-01" }))).toEqual(
      DEFAULT_DASHBOARD_RANGE_SELECTION,
    );
  });

  test("sameDashboardRange distinguishes kinds and values", () => {
    expect(
      sameDashboardRange({ kind: "preset", preset: "7d" }, { kind: "preset", preset: "7d" }),
    ).toBe(true);
    expect(
      sameDashboardRange({ kind: "preset", preset: "7d" }, { kind: "preset", preset: "30d" }),
    ).toBe(false);
    expect(
      sameDashboardRange(
        { kind: "custom", from: "2026-08-01", to: "2026-08-02" },
        { kind: "custom", from: "2026-08-01", to: "2026-08-02" },
      ),
    ).toBe(true);
    expect(
      sameDashboardRange(
        { kind: "preset", preset: "7d" },
        { kind: "custom", from: "2026-08-01", to: "2026-08-02" },
      ),
    ).toBe(false);
  });
});

describe("dashboard-range — legacy deep links still resolve", () => {
  test("Overview's `?oRange=` preset resolves as that preset", () => {
    expect(parseDashboardRange(new URLSearchParams({ oRange: "24h" }))).toEqual({
      kind: "preset",
      preset: "24h",
    });
  });

  test("Testing's `?tFrom=`/`?tTo=` pair resolves as a pinned custom range", () => {
    const range = resolveDashboardRangeFromParams(
      new URLSearchParams({ tab: "testing", tFrom: "2026-07-01", tTo: "2026-07-10" }),
      NOW,
    );
    expect(range.selection).toEqual({ kind: "custom", from: "2026-07-01", to: "2026-07-10" });
    expect(range.from).toBe("2026-07-01T00:00:00.000Z");
    expect(range.to).toBe("2026-07-10T23:59:59.999Z");
  });

  test("`?range=` wins over both legacy schemes when they disagree", () => {
    expect(
      parseDashboardRange(
        new URLSearchParams({ range: "30d", oRange: "24h", tFrom: "2026-07-01", tTo: "2026-07-10" }),
      ),
    ).toEqual({ kind: "preset", preset: "30d" });
  });

  test("writing drops the legacy keys so the URL converges on one param", () => {
    const written = writeDashboardRange(
      new URLSearchParams({ tab: "testing", oRange: "24h", tFrom: "2026-07-01", tTo: "2026-07-10", tServer: "srv-1" }),
      { kind: "preset", preset: "30d" },
    );
    expect(written.get(DASHBOARD_RANGE_KEY)).toBe("30d");
    expect(written.has("oRange")).toBe(false);
    expect(written.has("tFrom")).toBe(false);
    expect(written.has("tTo")).toBe(false);
    // A non-range facet is untouched.
    expect(written.get("tServer")).toBe("srv-1");
  });
});

describe("dashboard-range — prose + calendar helpers", () => {
  test("a preset describes itself in words", () => {
    expect(resolveDashboardRange({ kind: "preset", preset: "7d" }, NOW).description).toBe(
      "the last 7 days",
    );
  });

  test("a custom range describes itself as its two dates", () => {
    expect(
      resolveDashboardRange({ kind: "custom", from: "2026-08-01", to: "2026-08-14" }).description,
    ).toBe("Aug 1, 2026 \u2013 Aug 14, 2026");
  });

  test("toCalendarDate reads the viewer's own calendar day", () => {
    // Constructed from local Y/M/D so the assertion is timezone-independent.
    expect(toCalendarDate(new Date(2026, 7, 3, 15, 30))).toBe("2026-08-03");
  });
});
