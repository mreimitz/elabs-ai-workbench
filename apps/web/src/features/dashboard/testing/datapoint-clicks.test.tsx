import type { ReactNode } from "react";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { RunMetricsSeries, ScanMetricsPoint, ScanMetricsSeries } from "@mcp-token-footprint/shared";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { bucketRangeIso, defaultControls, drillDownFilter } from "./dashboard-url-state";

/**
 * WP 0.2 (finding F4) — the dashboard's chart panels are DIRECTLY clickable.
 *
 * Until this WP every panel carried a comment asserting that `@elabs-ai/components-charts` "v1.6.0
 * exposes no per-bar/point `onClick`", and bolted a `DrillList` underneath as the only click
 * surface. The app is on **v4.0.0**, where `onDatapointClick` is a first-class prop on every
 * interactive chart container, fires for pointer AND keyboard activation, and rides a
 * `ChartDatapointLayer` of real `<button>`s rendered OUTSIDE the aria-hidden `<svg>`.
 *
 * **Why this suite exists at all.** Every other web chart suite stubs
 * `@elabs-ai/components-charts` with INERT no-ops (the barrel pulls a broken `@visx/gradient`
 * subpath under Vitest/jsdom), so a panel that simply FORGOT `onDatapointClick` would still pass
 * the gate — the mock never looks at the props it is handed. This suite therefore stubs the package
 * FAITHFULLY at the two contracts that matter, following `time-axis-charts.test.tsx` and
 * `features/testing/suites/suite-series-colors.test.tsx`:
 *
 * 1. the chart container RECORDS the interaction props it received, and
 * 2. each series mark renders one real `<button>` per plotted datapoint — the same shape the real
 *    `ChartDatapointLayer` renders — deriving the activation `source` with the library's own rule
 *    (`event.detail === 0 ? "keyboard" : "pointer"`, verified in the package's `dist/index.js`).
 *
 * So a missing handler here means zero buttons and a recorded `undefined` — see the explicit
 * negative control at the bottom, which proves this suite fails on a chart that omits the prop.
 *
 * The real chart's geometry (scales, hit-box layout) is jsdom-hostile and NOT reproduced; what is
 * reproduced is the contract the panels are responsible for — the handler they pass, the target it
 * resolves to, and that a keyboard activation reaches it. Real focus order and the visible focus
 * ring can only be confirmed in a browser.
 */

type StubDatapoint = {
  datum: Record<string, unknown>;
  index: number;
  seriesKey: string;
  seriesLabel: string;
  value: number | undefined;
  category: unknown;
  source: "pointer" | "keyboard";
};
type StubClickHandler = (point: StubDatapoint, event: unknown) => void;
type StubLabel = (point: Omit<StubDatapoint, "source">) => string;

const captured = vi.hoisted(() => ({
  /** One entry per chart CONTAINER mounted, in mount order. */
  charts: [] as { handler: unknown; label: unknown }[],
  /** Every activation the stub forwarded, so a test can read the `source` the chart reported. */
  activations: [] as { seriesKey: string; index: number; source: string }[],
}));

vi.mock("@elabs-ai/components-charts", async () => {
  const { createContext, useContext } = await import("react");

  type Ctx = {
    data: Record<string, unknown>[];
    xDataKey: string;
    onDatapointClick?: StubClickHandler;
    datapointLabel?: StubLabel;
  };
  const ChartCtx = createContext<Ctx | null>(null);

  // Rendered via a single-line raw <button> because that is EXACTLY what the vendored
  // `ChartDatapointLayer` renders (`type="button"`, an aria-label, a click handler).
  const Target = (props: Record<string, unknown>) => <button type="button" {...props} />; // brand-ui-allow: test-only @elabs-ai/components-charts stub — mirrors ChartDatapointLayer's own <button> targets

  const Chart = ({
    data = [],
    xDataKey = "date",
    onDatapointClick,
    datapointLabel,
    children,
  }: {
    data?: Record<string, unknown>[];
    xDataKey?: string;
    onDatapointClick?: StubClickHandler;
    datapointLabel?: StubLabel;
    children?: ReactNode;
  }) => {
    captured.charts.push({ handler: onDatapointClick, label: datapointLabel });
    return (
      <ChartCtx value={{ data, xDataKey, onDatapointClick, datapointLabel }}>
        <div data-testid="chart">{children}</div>
      </ChartCtx>
    );
  };

  /** A series mark: publishes one keyboard/pointer target per plotted point, exactly as the real
   *  `Bar`/`Line`/`SeriesBar` register with the datapoint layer. Renders NOTHING when the chart got
   *  no `onDatapointClick` — the library's documented opt-out (no extra DOM, no new focusables). */
  const Series = ({ dataKey }: { dataKey: string }) => {
    const ctx = useContext(ChartCtx);
    if (!ctx?.onDatapointClick) return null;
    const handler = ctx.onDatapointClick;
    return (
      <>
        {ctx.data.map((datum, index) => {
          const value = datum[dataKey];
          if (typeof value !== "number") return null; // the real charts skip a non-numeric point
          const base = {
            datum,
            index,
            seriesKey: dataKey,
            seriesLabel: dataKey,
            value,
            category: datum[ctx.xDataKey],
          };
          return (
            <Target
              key={`${dataKey}:${index}`}
              data-testid={`dp:${dataKey}:${index}`}
              aria-label={ctx.datapointLabel ? ctx.datapointLabel(base) : `${dataKey}: ${value}`}
              onClick={(event: { detail?: number }) => {
                // The library's OWN rule for telling a keyboard activation from a pointer one.
                const source = event.detail === 0 ? "keyboard" : "pointer";
                captured.activations.push({ seriesKey: dataKey, index, source });
                handler({ ...base, source }, event);
              }}
            />
          );
        })}
      </>
    );
  };

  return {
    LineChart: Chart,
    AreaChart: Chart,
    BarChart: Chart,
    ComposedChart: Chart,
    Line: Series,
    Bar: Series,
    SeriesBar: Series,
    BarXAxis: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Grid: () => null,
    ChartTooltip: () => null,
  };
});

import { CostPanel } from "./CostPanel";
import { DurationPanel } from "./DurationPanel";
import { GuardrailStopsPanel } from "./GuardrailStopsPanel";
import { RunsErrorRatePanel } from "./RunsErrorRatePanel";
import { ScansStripPanel } from "./ScansStripPanel";
import { ScoreTrendPanel } from "./ScoreTrendPanel";
import { TokensPanel } from "./TokensPanel";

function render(ui: ReactNode) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

const CONTROLS = { ...defaultControls(new Date("2026-07-17T00:00:00.000Z")), from: "2026-07-01", to: "2026-07-10" };

/** TWO buckets, deliberately non-adjacent: every test activates the SECOND datapoint, so a panel
 *  that hardcoded "the first bucket" (or ignored the datum entirely) fails. */
const BUCKET_A = "2026-07-01T00:00:00.000Z";
const BUCKET_B = "2026-07-03T00:00:00.000Z";

/** The expected drill filter for BUCKET_B, composed with the SAME shared helpers the panels use —
 *  so this suite pins "goes through `drillDownFilter`+`bucketRangeIso`", not a copy of their math. */
const BUCKET_B_FILTER = drillDownFilter(CONTROLS, {
  dateFrom: bucketRangeIso(BUCKET_B, "day").from,
  dateTo: bucketRangeIso(BUCKET_B, "day").to,
});

function runSeries(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

function pts(values: [number, number]) {
  return [
    { bucketStart: BUCKET_A, value: values[0], n: 4 },
    { bucketStart: BUCKET_B, value: values[1], n: 4 },
  ];
}

const RUNS_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "count", group: "claude-sonnet-4", points: pts([8, 11]) }),
  runSeries({ measure: "count", group: "gpt-5", points: pts([5, 2]) }),
  runSeries({ measure: "errorRate", group: null, points: pts([0.1, 0.25]) }),
];

const GUARDRAIL_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "count", group: "max_turns", points: pts([3, 6]) }),
  runSeries({ measure: "count", group: "stalled", points: pts([1, 2]) }),
];

const DURATION_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "p50DurationMs", points: pts([1200, 1500]) }),
  runSeries({ measure: "p95DurationMs", points: pts([4200, 5100]) }),
];

const SCORE_SERIES: RunMetricsSeries[] = [runSeries({ measure: "meanScore", points: pts([0.7, 0.85]) })];

// Distinct classes per direction so each direction's chart has its OWN target ids (the panel renders
// one `BarChart` for Input and one for Output).
const TOKENS_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "tokensIn", capabilityClass: "exact", points: pts([1000, 1400]) }),
  runSeries({ measure: "tokensOut", capabilityClass: "estimated", points: pts([500, 620]) }),
];

const COST_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "costUsd", capabilityClass: "api_exact", points: pts([1.5, 2.25]) }),
];

/** An opaque server id — the case that makes the accessible datapoint name matter. */
const SERVER_ID = "srv_9f3ab21c";

function scanPoint(bucketStart: string, totalTokens: number): ScanMetricsPoint {
  return {
    bucketStart,
    scanCount: 1,
    failureRate: 0,
    countingVersion: 2,
    totalTokens,
    toolTokens: totalTokens - 200,
    resourceTokens: 100,
    promptTokens: 100,
    totalTools: 5,
    totalResources: 1,
    totalResourceTemplates: 0,
    totalPrompts: 1,
    deltaTotalTokens: null,
    deltaComparable: false,
  };
}

const SCAN_SERIES: ScanMetricsSeries[] = [
  {
    serverId: SERVER_ID,
    serverName: "Alpha",
    tokenProfile: "generic_o200k",
    points: [scanPoint(BUCKET_A, 1200), scanPoint(BUCKET_B, 1450)],
  },
];

/** Activate a datapoint the way a POINTER does (a real click carries `detail >= 1`). */
function clickDatapoint(testId: string) {
  fireEvent.click(screen.getByTestId(testId), { detail: 1 });
}

/** Activate a datapoint the way the KEYBOARD does: Enter/Space on the layer's `<button>` dispatches
 *  a click with `detail === 0`, which is exactly how the real `ChartDatapointLayer` decides the
 *  activation was a keyboard one. */
function keyboardActivateDatapoint(testId: string) {
  fireEvent.click(screen.getByTestId(testId), { detail: 0 });
}

beforeEach(() => {
  captured.charts.length = 0;
  captured.activations.length = 0;
});

describe("Dashboard panels — the CHART is the click surface (onDatapointClick actually reaches it)", () => {
  test("RunsErrorRatePanel: a bar opens the runs feed scoped to exactly THAT bar's bucket", () => {
    const onDrill = vi.fn();
    render(
      <RunsErrorRatePanel
        series={RUNS_SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => `Model ${g}`}
        onDrill={onDrill}
      />,
    );
    // The prop is genuinely on the chart — not merely defined in the component.
    expect(typeof captured.charts[0]?.handler).toBe("function");

    clickDatapoint("dp:claude-sonnet-4:1");
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill.mock.calls[0]![0]).toEqual(BUCKET_B_FILTER);
  });

  test("RunsErrorRatePanel: the error-rate POINT and the bar under it resolve to the SAME target", () => {
    const onDrill = vi.fn();
    render(
      <RunsErrorRatePanel
        series={RUNS_SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={onDrill}
      />,
    );
    clickDatapoint("dp:claude-sonnet-4:1");
    clickDatapoint("dp:errorRatePercent:1");
    expect(onDrill.mock.calls[1]![0]).toEqual(onDrill.mock.calls[0]![0]);
  });

  test("RunsErrorRatePanel: the group is NOT folded into the filter (a stacked bar means 'this bucket')", () => {
    const onDrill = vi.fn();
    render(
      <RunsErrorRatePanel
        series={RUNS_SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={onDrill}
      />,
    );
    clickDatapoint("dp:claude-sonnet-4:1");
    clickDatapoint("dp:gpt-5:1");
    expect(onDrill.mock.calls[1]![0]).toEqual(onDrill.mock.calls[0]![0]);
    expect(onDrill.mock.calls[0]![0].model).toBeUndefined();
  });

  test("RunsErrorRatePanel: each target's accessible name is the HUMANIZED group, not the raw dataKey", () => {
    render(
      <RunsErrorRatePanel
        series={RUNS_SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => `Model ${g}`}
        onDrill={vi.fn()}
      />,
    );
    expect(screen.getByTestId("dp:claude-sonnet-4:1")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Model claude-sonnet-4"),
    );
    expect(screen.getByTestId("dp:errorRatePercent:1")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Error rate"),
    );
  });

  test("GuardrailStopsPanel: a bar and the breakdown row for the SAME reason produce an IDENTICAL filter", () => {
    const onDrill = vi.fn();
    render(<GuardrailStopsPanel series={GUARDRAIL_SERIES} controls={CONTROLS} onDrill={onDrill} />);
    expect(typeof captured.charts[0]?.handler).toBe("function");

    clickDatapoint("dp:max_turns:1");
    fireEvent.click(screen.getByRole("button", { name: /open runs for max turns/i }));

    expect(onDrill).toHaveBeenCalledTimes(2);
    // The whole point of routing both through one `drillToCode`: they cannot disagree.
    expect(onDrill.mock.calls[0]![0]).toEqual(onDrill.mock.calls[1]![0]);
    expect(onDrill.mock.calls[0]![0].stopReasonCode).toEqual(["max_turns"]);
  });

  test("GuardrailStopsPanel: a DIFFERENT reason's bar scopes to THAT code", () => {
    const onDrill = vi.fn();
    render(<GuardrailStopsPanel series={GUARDRAIL_SERIES} controls={CONTROLS} onDrill={onDrill} />);
    clickDatapoint("dp:stalled:0");
    expect(onDrill.mock.calls[0]![0].stopReasonCode).toEqual(["stalled"]);
  });

  test("GuardrailStopsPanel: the target's accessible name is the humanized reason", () => {
    render(<GuardrailStopsPanel series={GUARDRAIL_SERIES} controls={CONTROLS} onDrill={vi.fn()} />);
    expect(screen.getByTestId("dp:max_turns:1")).toHaveAttribute("aria-label", expect.stringContaining("Max turns"));
  });

  test("DurationPanel: p50 and p95 points both open that bucket's window", () => {
    const onDrill = vi.fn();
    render(<DurationPanel series={DURATION_SERIES} controls={CONTROLS} bucket="day" onDrill={onDrill} />);
    expect(typeof captured.charts[0]?.handler).toBe("function");

    clickDatapoint("dp:p50:1");
    clickDatapoint("dp:p95:1");
    expect(onDrill.mock.calls[0]![0]).toEqual(BUCKET_B_FILTER);
    expect(onDrill.mock.calls[1]![0]).toEqual(BUCKET_B_FILTER);
  });

  test("ScoreTrendPanel: a point opens that bucket's graded runs", () => {
    const onDrill = vi.fn();
    render(<ScoreTrendPanel series={SCORE_SERIES} controls={CONTROLS} bucket="day" onDrill={onDrill} />);
    expect(typeof captured.charts[0]?.handler).toBe("function");

    clickDatapoint("dp:meanScore:1");
    expect(onDrill.mock.calls[0]![0]).toEqual(BUCKET_B_FILTER);
  });

  test("TokensPanel: a capability-class bar scopes to its BUCKET — never to a fabricated class filter", () => {
    const onDrill = vi.fn();
    render(<TokensPanel series={TOKENS_SERIES} controls={CONTROLS} bucket="day" onDrill={onDrill} />);
    // Two charts (Input + Output), each of which must have got the handler.
    expect(captured.charts).toHaveLength(2);
    expect(captured.charts.every((c) => typeof c.handler === "function")).toBe(true);

    clickDatapoint("dp:exact:1"); // the Input chart
    expect(onDrill.mock.calls[0]![0]).toEqual(BUCKET_B_FILTER);
    // Narrower than the header's whole-window action — this really is the bucket that was clicked.
    expect(onDrill.mock.calls[0]![0].dateFrom).toBe(BUCKET_B);
    expect(onDrill.mock.calls[0]![0].capabilityClass).toBeUndefined();

    clickDatapoint("dp:estimated:1"); // the Output chart — same target, no class dimension invented
    expect(onDrill.mock.calls[1]![0]).toEqual(BUCKET_B_FILTER);
  });

  test("CostPanel: a cost-basis bar scopes to its bucket", () => {
    const onDrill = vi.fn();
    render(<CostPanel series={COST_SERIES} controls={CONTROLS} bucket="day" onDrill={onDrill} />);
    expect(typeof captured.charts[0]?.handler).toBe("function");

    clickDatapoint("dp:api_exact:1");
    expect(onDrill.mock.calls[0]![0]).toEqual(BUCKET_B_FILTER);
  });

  test("ScansStripPanel: a point opens the SERVER DETAIL page (footprint data, not run data) — same as its row", () => {
    const onOpenServer = vi.fn();
    render(<ScansStripPanel series={SCAN_SERIES} onOpenServer={onOpenServer} />);
    expect(typeof captured.charts[0]?.handler).toBe("function");

    clickDatapoint(`dp:${SERVER_ID}:1`);
    fireEvent.click(screen.getByRole("button", { name: /open runs for alpha/i }));

    expect(onOpenServer).toHaveBeenCalledTimes(2);
    expect(onOpenServer.mock.calls[0]).toEqual([SERVER_ID]);
    expect(onOpenServer.mock.calls[1]).toEqual([SERVER_ID]);
  });

  test("ScansStripPanel: the target's accessible name is the server NAME, not its opaque id", () => {
    render(<ScansStripPanel series={SCAN_SERIES} onOpenServer={vi.fn()} />);
    const label = screen.getByTestId(`dp:${SERVER_ID}:1`).getAttribute("aria-label") ?? "";
    expect(label).toContain("Alpha");
    expect(label).not.toContain(SERVER_ID);
  });
});

describe("Keyboard activation reaches the same target as a pointer (the handler takes both)", () => {
  test("RunsErrorRatePanel: an Enter/Space activation (click detail 0) drills identically", () => {
    const onDrill = vi.fn();
    render(
      <RunsErrorRatePanel
        series={RUNS_SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={onDrill}
      />,
    );
    keyboardActivateDatapoint("dp:claude-sonnet-4:1");
    expect(onDrill.mock.calls[0]![0]).toEqual(BUCKET_B_FILTER);
    // …and the chart really did report it as a KEYBOARD activation, not a pointer one.
    expect(captured.activations[0]?.source).toBe("keyboard");
  });

  test("every datapoint target is a real, focusable button carrying an accessible name", () => {
    render(<GuardrailStopsPanel series={GUARDRAIL_SERIES} controls={CONTROLS} onDrill={vi.fn()} />);
    const target = screen.getByTestId("dp:max_turns:1");
    expect(target.tagName).toBe("BUTTON");
    expect(target.getAttribute("aria-label")).toBeTruthy();
    target.focus();
    expect(document.activeElement).toBe(target);
  });

  test("GuardrailStopsPanel: keyboard activation scopes to the same stopReasonCode as a click", () => {
    const onDrill = vi.fn();
    render(<GuardrailStopsPanel series={GUARDRAIL_SERIES} controls={CONTROLS} onDrill={onDrill} />);
    clickDatapoint("dp:stalled:1");
    keyboardActivateDatapoint("dp:stalled:1");
    expect(onDrill.mock.calls[1]![0]).toEqual(onDrill.mock.calls[0]![0]);
    expect(captured.activations.map((a) => a.source)).toEqual(["pointer", "keyboard"]);
  });

  test("ScansStripPanel: keyboard activation opens the same server", () => {
    const onOpenServer = vi.fn();
    render(<ScansStripPanel series={SCAN_SERIES} onOpenServer={onOpenServer} />);
    keyboardActivateDatapoint(`dp:${SERVER_ID}:0`);
    expect(onOpenServer).toHaveBeenCalledWith(SERVER_ID);
    expect(captured.activations[0]?.source).toBe("keyboard");
  });
});

/**
 * The negative control. Without this, "the panels pass `onDatapointClick`" would be an assertion
 * about a mock that could equally be satisfied by a mock that ignores props. Here a chart is mounted
 * WITHOUT the prop through the very same stub: it records `undefined` and publishes no targets — so
 * a panel that regressed to the old no-click behaviour fails every assertion above.
 */
describe("NEGATIVE CONTROL — the stub is not permissive", () => {
  test("a chart mounted without onDatapointClick records undefined and renders NO datapoint targets", async () => {
    const { BarChart, Bar } = await import("@elabs-ai/components-charts");
    render(
      <BarChart data={[{ bucketStart: BUCKET_A, bucketLabel: "Jul 1", count: 3 }]} xDataKey="bucketLabel">
        <Bar dataKey="count" />
      </BarChart>,
    );
    expect(captured.charts).toHaveLength(1);
    expect(captured.charts[0]?.handler).toBeUndefined();
    expect(screen.queryByTestId("dp:count:0")).not.toBeInTheDocument();
  });

  test("…and the same chart WITH the prop does publish a target (so the check above can fail)", async () => {
    const { BarChart, Bar } = await import("@elabs-ai/components-charts");
    render(
      <BarChart
        data={[{ bucketStart: BUCKET_A, bucketLabel: "Jul 1", count: 3 }]}
        xDataKey="bucketLabel"
        onDatapointClick={() => {}}
      >
        <Bar dataKey="count" />
      </BarChart>,
    );
    expect(screen.getByTestId("dp:count:0")).toBeInTheDocument();
  });
});
