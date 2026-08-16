import { describe, expect, test } from "vitest";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { defaultControls, type TestingDashboardControls } from "./dashboard-url-state";
import {
  composeChartRunFilter,
  composeChartRunFilterForControls,
  composeChartScanServerId,
  NEVER_MATCHES_SENTINEL,
} from "./custom-chart-query";

const NOW = new Date("2026-07-17T12:00:00.000Z");

describe("composeChartRunFilter — the AND composition rule", () => {
  test("disjoint fields (the common case): both sides' constraints survive untouched", () => {
    const global: RunFilter = { model: ["claude-sonnet-4"] };
    const chart: RunFilter = { status: ["error"], scoreGte: 0.5 };
    expect(composeChartRunFilter(global, chart)).toEqual({
      model: ["claude-sonnet-4"],
      status: ["error"],
      scoreGte: 0.5,
    });
  });

  test("a field set on only one side passes through unchanged", () => {
    expect(composeChartRunFilter({ serverId: ["srv-1"] }, {})).toEqual({ serverId: ["srv-1"] });
    expect(composeChartRunFilter({}, { serverId: ["srv-1"] })).toEqual({ serverId: ["srv-1"] });
  });

  test("list-valued dimension fields set on BOTH sides intersect (true AND of two IN-lists)", () => {
    const global: RunFilter = { serverId: ["a", "b", "c"] };
    const chart: RunFilter = { serverId: ["b", "c", "d"] };
    expect(composeChartRunFilter(global, chart).serverId).toEqual(["b", "c"]);
  });

  test("an EMPTY intersection is represented by the never-matches sentinel (never silently unconstrained)", () => {
    const global: RunFilter = { serverId: ["a"] };
    const chart: RunFilter = { serverId: ["b"] };
    expect(composeChartRunFilter(global, chart).serverId).toEqual([NEVER_MATCHES_SENTINEL]);
  });

  test("providerKind/model/status/outcome/stopReasonCode/phase/scenarioId/skillId all intersect", () => {
    const global: RunFilter = {
      providerKind: ["anthropic", "openai"],
      model: ["m1", "m2"],
      status: ["completed", "error"],
      outcome: ["completed", "error"],
      stopReasonCode: ["max_turns", "max_tokens"],
      phase: ["starting", "waiting_input"],
      scenarioId: ["e1", "e2"],
      skillId: ["s1", "s2"],
    };
    const chart: RunFilter = {
      providerKind: ["anthropic"],
      model: ["m2"],
      status: ["completed"],
      outcome: ["error"],
      stopReasonCode: ["max_turns"],
      phase: ["waiting_input"],
      scenarioId: ["e2"],
      skillId: ["s2"],
    };
    const composed = composeChartRunFilter(global, chart);
    expect(composed.providerKind).toEqual(["anthropic"]);
    expect(composed.model).toEqual(["m2"]);
    expect(composed.status).toEqual(["completed"]);
    expect(composed.outcome).toEqual(["error"]);
    expect(composed.stopReasonCode).toEqual(["max_turns"]);
    expect(composed.phase).toEqual(["waiting_input"]);
    expect(composed.scenarioId).toEqual(["e2"]);
    expect(composed.skillId).toEqual(["s2"]);
  });

  test("numeric range pairs take the TIGHTER bound on each side (true AND of two inequalities)", () => {
    const global: RunFilter = { scoreGte: 0.3, scoreLte: 0.9, costUsdLte: 5, durationMsGte: 1000 };
    const chart: RunFilter = { scoreGte: 0.5, scoreLte: 0.8, costUsdLte: 2, tokensGte: 100 };
    const composed = composeChartRunFilter(global, chart);
    expect(composed.scoreGte).toBe(0.5); // max(0.3, 0.5)
    expect(composed.scoreLte).toBe(0.8); // min(0.9, 0.8)
    expect(composed.costUsdLte).toBe(2); // min(5, 2) — only chart set costUsdLte's counterpart
    expect(composed.durationMsGte).toBe(1000); // only global set it
    expect(composed.tokensGte).toBe(100); // only chart set it
  });

  test("a scalar/object field set on both sides: the chart's own value wins (documented exception)", () => {
    const global: RunFilter = { suiteId: "suite-global", pinned: true };
    const chart: RunFilter = { suiteId: "suite-chart", pinned: false };
    const composed = composeChartRunFilter(global, chart);
    expect(composed.suiteId).toBe("suite-chart");
    expect(composed.pinned).toBe(false);
  });

  test("never touches dateFrom/dateTo — that's the caller's (composeChartRunFilterForControls's) job", () => {
    const composed = composeChartRunFilter({ dateFrom: "2026-01-01T00:00:00.000Z" }, {});
    expect(composed.dateFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(composed.dateTo).toBeUndefined();
  });
});

describe("composeChartRunFilterForControls — the global window is ALWAYS applied", () => {
  const controls: TestingDashboardControls = { ...defaultControls(NOW), serverId: ["srv-1"] };

  test("folds in the resolved global window + composes the dimension filter", () => {
    const composed = composeChartRunFilterForControls(controls, { status: ["error"] });
    expect(composed.dateFrom).toBe("2026-07-11T00:00:00.000Z");
    expect(composed.dateTo).toBe("2026-07-17T23:59:59.999Z");
    expect(composed.serverId).toEqual(["srv-1"]);
    expect(composed.status).toEqual(["error"]);
  });

  test("a chart-local dateFrom/dateTo (should never be set by the composer UI) is OVERRIDDEN by the global window", () => {
    const composed = composeChartRunFilterForControls(controls, {
      dateFrom: "2020-01-01T00:00:00.000Z",
      dateTo: "2020-01-02T00:00:00.000Z",
    });
    expect(composed.dateFrom).toBe("2026-07-11T00:00:00.000Z");
    expect(composed.dateTo).toBe("2026-07-17T23:59:59.999Z");
  });
});

describe("composeChartScanServerId", () => {
  test("the chart's own serverId always wins when set", () => {
    const controls: TestingDashboardControls = { ...defaultControls(NOW), serverId: ["srv-a", "srv-b"] };
    expect(composeChartScanServerId(controls, "srv-chart")).toBe("srv-chart");
  });

  test("falls back to the global bar's single server selection when the chart sets none", () => {
    const controls: TestingDashboardControls = { ...defaultControls(NOW), serverId: ["srv-only"] };
    expect(composeChartScanServerId(controls, undefined)).toBe("srv-only");
  });

  test("an unscoped chart shows ALL servers when the global bar has 0 or ≥2 servers selected", () => {
    const none: TestingDashboardControls = { ...defaultControls(NOW), serverId: [] };
    const many: TestingDashboardControls = { ...defaultControls(NOW), serverId: ["a", "b"] };
    expect(composeChartScanServerId(none, undefined)).toBeUndefined();
    expect(composeChartScanServerId(many, undefined)).toBeUndefined();
  });
});
