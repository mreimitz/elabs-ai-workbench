import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SuiteAnalytics, SuiteScatterPoint } from "@mcp-token-footprint/shared";
import { CHART_RAMP_LENGTH, chartSeriesColor } from "../../../lib/chart-colors";
import type { SuiteMatrixRef } from "./SuiteMatrix";

/**
 * WP 0.1 (finding F5) — series colour + legend swatch conformance for the two suite analytics views.
 *
 * Two defects this locks, neither of which the existing suites could see:
 *
 * 1. **Colours repeated after five series.** Both views built their own five-slot token cycle
 *    against a twelve-token ramp, so the 6th environment was painted the same colour as the 1st —
 *    in views whose entire job is telling environments apart.
 * 2. **The legend swatches painted only by borrowed luck.** They were a *template-literal* Tailwind
 *    class built from the series index. Tailwind extracts class names STATICALLY, so it never sees
 *    that string; the utility exists only because some other file spells the literal. Today all twelve
 *    survive because `@elabs-ai/components-ui`'s dist spells `bg-chart-1` … `bg-chart-12` and
 *    `app.css` `@source`s it — a guarantee held by a vendored package, not by this app, and one an
 *    upstream release can withdraw silently. Both legends now paint from an inline `var(--chart-N)`
 *    style, which is why the assertions below read `style.backgroundColor` and forbid the class.
 *
 * The other suite tests stub `@elabs-ai/components-charts` with INERT no-ops, so a wrong `fill` prop
 * passes them silently. This suite stubs it FAITHFULLY at the one contract that matters — a series
 * mark records the colour it was handed — so a mis-coloured series fails here.
 */

const captured = vi.hoisted(() => ({
  scatterFills: [] as (string | undefined)[],
  barFills: [] as (string | undefined)[],
}));

vi.mock("@elabs-ai/components-charts", () => {
  const Chart = ({ children }: { children?: ReactNode }) => <div data-testid="chart">{children}</div>;
  return {
    ScatterChart: Chart,
    BarChart: Chart,
    // Faithful at the prop that matters: each series mark records the fill it actually received.
    Scatter: ({ fill }: { fill?: string }) => {
      captured.scatterFills.push(fill);
      return null;
    },
    Bar: ({ fill }: { fill?: string }) => {
      captured.barFills.push(fill);
      return null;
    },
    Grid: () => null,
    YAxis: () => null,
    BarXAxis: () => null,
    ChartTooltip: () => null,
  };
});

import { SuiteBreakdowns } from "./SuiteBreakdowns";
import { SuiteScatter } from "./SuiteScatter";

/** More environments than the old five-colour cycle could serve without repeating. */
const SCENARIO_COUNT = 8;
const SCENARIOS: SuiteMatrixRef[] = Array.from({ length: SCENARIO_COUNT }, (_, i) => ({
  id: `s${i + 1}`,
  name: `Env ${i + 1}`,
}));

function scatterPoint(scenarioId: string): SuiteScatterPoint {
  return { testId: "t1", scenarioId, meanScore: 0.5, meanTokens: 100, meanCostUsd: 0.01, reps: 1 };
}

const SCATTER_ANALYTICS: SuiteAnalytics = {
  scatter: SCENARIOS.map((s) => scatterPoint(s.id)),
  breakdowns: [],
};

const BREAKDOWN_ANALYTICS: SuiteAnalytics = {
  scatter: [],
  breakdowns: SCENARIOS.map((s) => ({
    dimension: "category" as const,
    key: "retrieval",
    scenarioId: s.id,
    meanScore: 0.5,
    meanCostUsd: 0.01,
    count: 1,
  })),
};

/** Every legend swatch, in DOM order, as the `background-color` it actually paints. */
function swatchColors(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("li > span[aria-hidden]")).map(
    (el) => el.style.backgroundColor,
  );
}

describe("SuiteScatter series colours", () => {
  test("gives each environment its own ramp colour past the old five-colour cycle", () => {
    captured.scatterFills.length = 0;
    render(
      <SuiteScatter
        analytics={SCATTER_ANALYTICS}
        scenarios={SCENARIOS}
        testName={new Map([["t1", "Test A"]])}
        grader=""
        onGraderChange={() => {}}
        cells={{}}
        onOpenRun={() => {}}
      />,
    );

    const expected = SCENARIOS.map((_, i) => chartSeriesColor(i));
    expect(captured.scatterFills).toEqual(expected);
    // The regression itself: the 6th environment is no longer the 1st environment's colour.
    expect(captured.scatterFills[5]).toBe("var(--chart-6)");
    expect(new Set(captured.scatterFills).size).toBe(SCENARIO_COUNT);
  });

  test("paints legend swatches from the same tokens — as an inline style, not a dynamic class", () => {
    render(
      <SuiteScatter
        analytics={SCATTER_ANALYTICS}
        scenarios={SCENARIOS}
        testName={new Map([["t1", "Test A"]])}
        grader=""
        onGraderChange={() => {}}
        cells={{}}
        onOpenRun={() => {}}
      />,
    );

    expect(swatchColors()).toEqual(SCENARIOS.map((_, i) => chartSeriesColor(i)));
    // No swatch may carry a `bg-chart-*` class — Tailwind cannot see one built by template literal,
    // so it paints only while an unrelated file happens to spell that exact literal.
    for (const el of document.querySelectorAll("li > span[aria-hidden]")) {
      expect(el.className).not.toMatch(/bg-chart-/);
    }
  });
});

describe("SuiteBreakdowns series colours", () => {
  test("colours bars and legend swatches off the same 12-token ramp", () => {
    captured.barFills.length = 0;
    render(
      <SuiteBreakdowns
        analytics={BREAKDOWN_ANALYTICS}
        scenarios={SCENARIOS}
        graderLabel="Primary grader"
      />,
    );

    const expected = SCENARIOS.map((_, i) => chartSeriesColor(i));
    expect(captured.barFills).toEqual(expected);
    expect(captured.barFills[5]).toBe("var(--chart-6)");
    expect(swatchColors()).toEqual(expected);
    for (const el of document.querySelectorAll("li > span[aria-hidden]")) {
      expect(el.className).not.toMatch(/bg-chart-/);
    }
  });
});

describe("the ramp both views share", () => {
  test("is the full twelve tokens, so a suite is only re-coloured past twelve environments", () => {
    expect(CHART_RAMP_LENGTH).toBe(12);
    expect(chartSeriesColor(11)).toBe("var(--chart-12)");
    expect(chartSeriesColor(12)).toBe(chartSeriesColor(0));
  });
});

/** Guard the empty case so the assertions above cannot silently pass on zero rendered swatches. */
test("the fixtures actually render swatches", () => {
  render(
    <SuiteBreakdowns
      analytics={BREAKDOWN_ANALYTICS}
      scenarios={SCENARIOS}
      graderLabel="Primary grader"
    />,
  );
  expect(swatchColors().length).toBeGreaterThan(0);
  expect(screen.getAllByText("Env 6").length).toBeGreaterThan(0);
});
