import { describe, expect, test } from "vitest";
import {
  DEFAULT_OVERVIEW_PRESET,
  isOverviewPreset,
  OVERVIEW_PRESETS,
  OVERVIEW_RANGE_KEY,
  parseOverviewPreset,
  resolveOverviewRange,
  writeOverviewPreset,
} from "./overview-url-state";

/**
 * dashboard-bento WP 1.4 — the Overview tab's URL-persisted window control.
 *
 * These lock the three things a reviewer would otherwise have to take on trust: the default never
 * appears in the URL (so `/dashboard` stays the clean canonical link), unrelated params survive a
 * window change, and the preset→window math is the trailing span it claims to be.
 */

const NOW = new Date("2026-08-19T12:34:56.000Z");

describe("parseOverviewPreset", () => {
  test("an absent key falls back to the default preset", () => {
    expect(parseOverviewPreset(new URLSearchParams())).toBe(DEFAULT_OVERVIEW_PRESET);
  });

  test("a recognised preset round-trips out of the URL", () => {
    for (const preset of OVERVIEW_PRESETS) {
      const params = new URLSearchParams(`${OVERVIEW_RANGE_KEY}=${preset}`);
      expect(parseOverviewPreset(params)).toBe(preset);
    }
  });

  test("an unrecognised value falls back rather than throwing", () => {
    expect(parseOverviewPreset(new URLSearchParams(`${OVERVIEW_RANGE_KEY}=90d`))).toBe(
      DEFAULT_OVERVIEW_PRESET,
    );
    expect(parseOverviewPreset(new URLSearchParams(`${OVERVIEW_RANGE_KEY}=`))).toBe(
      DEFAULT_OVERVIEW_PRESET,
    );
  });
});

describe("isOverviewPreset", () => {
  test("accepts exactly the three offered windows", () => {
    expect(OVERVIEW_PRESETS.every((preset) => isOverviewPreset(preset))).toBe(true);
    expect(isOverviewPreset("1h")).toBe(false);
    expect(isOverviewPreset(null)).toBe(false);
    expect(isOverviewPreset(undefined)).toBe(false);
  });
});

describe("writeOverviewPreset", () => {
  test("the DEFAULT preset is removed from the URL, never written", () => {
    const written = writeOverviewPreset(new URLSearchParams(), DEFAULT_OVERVIEW_PRESET);
    expect(written.has(OVERVIEW_RANGE_KEY)).toBe(false);
    expect(written.toString()).toBe("");
  });

  test("switching back to the default clears a previously written key", () => {
    const params = new URLSearchParams(`${OVERVIEW_RANGE_KEY}=30d`);
    expect(writeOverviewPreset(params, DEFAULT_OVERVIEW_PRESET).has(OVERVIEW_RANGE_KEY)).toBe(
      false,
    );
  });

  test("a non-default preset is written, and the input params are never mutated", () => {
    const params = new URLSearchParams();
    const written = writeOverviewPreset(params, "24h");
    expect(written.get(OVERVIEW_RANGE_KEY)).toBe("24h");
    expect(params.has(OVERVIEW_RANGE_KEY)).toBe(false);
  });

  test("unrelated params (the host's ?tab=, the Testing tab's t* keys) survive untouched", () => {
    const params = new URLSearchParams("tab=overview&tGroupBy=server&issue=iss-1");
    const written = writeOverviewPreset(params, "30d");
    expect(written.get("tab")).toBe("overview");
    expect(written.get("tGroupBy")).toBe("server");
    expect(written.get("issue")).toBe("iss-1");
    expect(written.get(OVERVIEW_RANGE_KEY)).toBe("30d");

    const cleared = writeOverviewPreset(written, DEFAULT_OVERVIEW_PRESET);
    expect(cleared.get("tab")).toBe("overview");
    expect(cleared.has(OVERVIEW_RANGE_KEY)).toBe(false);
  });
});

describe("resolveOverviewRange", () => {
  test("`to` is the injected clock and the preset is carried through", () => {
    for (const preset of OVERVIEW_PRESETS) {
      const range = resolveOverviewRange(preset, NOW);
      expect(range.to).toBe(NOW.toISOString());
      expect(range.preset).toBe(preset);
    }
  });

  test("each preset reaches back exactly its trailing span", () => {
    const spans: Record<string, number> = {
      "24h": 24 * 3_600_000,
      "7d": 7 * 86_400_000,
      "30d": 30 * 86_400_000,
    };
    for (const preset of OVERVIEW_PRESETS) {
      const range = resolveOverviewRange(preset, NOW);
      expect(Date.parse(range.to) - Date.parse(range.from)).toBe(spans[preset]);
    }
  });

  test("the bounds are ISO-8601 instants (what the metrics endpoints take)", () => {
    const range = resolveOverviewRange("7d", NOW);
    expect(range.from).toBe("2026-08-12T12:34:56.000Z");
    expect(range.to).toBe("2026-08-19T12:34:56.000Z");
  });
});
