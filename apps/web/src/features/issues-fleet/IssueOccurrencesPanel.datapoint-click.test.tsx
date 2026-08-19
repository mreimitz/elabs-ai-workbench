import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { bucketRangeIso, drillDownHref } from "../dashboard/testing/dashboard-url-state";

/**
 * WP 0.2 (finding F4) — the issue-detail occurrences chart is DIRECTLY clickable.
 *
 * Same reasoning as `features/dashboard/testing/datapoint-clicks.test.tsx`: the sibling suites stub
 * `@elabs-ai/components-charts` with inert no-ops, so a panel that forgot `onDatapointClick` would
 * pass them silently. This stub is FAITHFUL at the two contracts that matter — the container records
 * the interaction props it was handed, and the series mark renders one real `<button>` per plotted
 * point (what the vendored `ChartDatapointLayer` does), deriving the activation source with the
 * library's own `event.detail === 0 ? "keyboard" : "pointer"` rule.
 *
 * The panel's own `.test.ts` sibling stays as-is: it covers the pure `formatOccurrenceBucketLabel`.
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

const captured = vi.hoisted(() => ({ charts: [] as { handler: unknown }[] }));

vi.mock("@elabs-ai/components-charts", async () => {
  const { createContext, useContext } = await import("react");

  type Ctx = { data: Record<string, unknown>[]; xDataKey: string; onDatapointClick?: StubClickHandler };
  const ChartCtx = createContext<Ctx | null>(null);

  const Target = (props: Record<string, unknown>) => <button type="button" {...props} />; // brand-ui-allow: test-only @elabs-ai/components-charts stub — mirrors ChartDatapointLayer's own <button> targets

  return {
    BarChart: ({
      data = [],
      xDataKey = "date",
      onDatapointClick,
      children,
    }: {
      data?: Record<string, unknown>[];
      xDataKey?: string;
      onDatapointClick?: StubClickHandler;
      children?: ReactNode;
    }) => {
      captured.charts.push({ handler: onDatapointClick });
      return (
        <ChartCtx value={{ data, xDataKey, onDatapointClick }}>
          <div data-testid="chart">{children}</div>
        </ChartCtx>
      );
    },
    Bar: ({ dataKey }: { dataKey: string }) => {
      const ctx = useContext(ChartCtx);
      if (!ctx?.onDatapointClick) return null;
      const handler = ctx.onDatapointClick;
      return (
        <>
          {ctx.data.map((datum, index) => {
            const value = datum[dataKey];
            if (typeof value !== "number") return null;
            return (
              <Target
                key={`${dataKey}:${index}`}
                data-testid={`dp:${dataKey}:${index}`}
                aria-label={`${dataKey}: ${value}`}
                onClick={(event: { detail?: number }) =>
                  handler(
                    {
                      datum,
                      index,
                      seriesKey: dataKey,
                      seriesLabel: dataKey,
                      value,
                      category: datum[ctx.xDataKey],
                      source: event.detail === 0 ? "keyboard" : "pointer",
                    },
                    event,
                  )
                }
              />
            );
          })}
        </>
      );
    },
    BarXAxis: () => null,
    ChartTooltip: () => null,
    Grid: () => null,
    Sparkline: () => null,
  };
});

const mockGetRunMetrics = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getRunMetrics: (...args: unknown[]) => mockGetRunMetrics(...args) };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { OPEN_FLEET_ISSUE } from "./issue-fixtures";
import { IssueOccurrencesPanel } from "./IssueOccurrencesPanel";

const BUCKET_A = "2026-07-01T00:00:00.000Z";
const BUCKET_B = "2026-07-03T00:00:00.000Z";

const METRICS = {
  bucket: "day" as const,
  timezone: "UTC" as const,
  from: null,
  to: null,
  groupBy: null,
  measures: ["count"],
  unavailableMeasures: [],
  series: [
    {
      measure: "count" as const,
      group: null,
      capabilityClass: null,
      points: [
        { bucketStart: BUCKET_A, value: 2, n: 2 },
        { bucketStart: BUCKET_B, value: 5, n: 5 },
      ],
    },
  ],
};

/** The href the panel must navigate to for the SECOND bar — composed with the same shared helpers
 *  the panel uses, so this pins the path rather than restating its arithmetic. */
const EXPECTED_HREF = drillDownHref({
  dateFrom: bucketRangeIso(BUCKET_B, "day").from,
  dateTo: bucketRangeIso(BUCKET_B, "day").to,
});

async function renderPanel() {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <IssueOccurrencesPanel issue={OPEN_FLEET_ISSUE} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
}

beforeEach(() => {
  captured.charts.length = 0;
  mockNavigate.mockReset();
  mockGetRunMetrics.mockReset();
  mockGetRunMetrics.mockResolvedValue(METRICS);
});

describe("IssueOccurrencesPanel — the chart is the click surface", () => {
  test("the chart really receives onDatapointClick (not merely a handler defined in the component)", async () => {
    await renderPanel();
    expect(typeof captured.charts[0]?.handler).toBe("function");
  });

  test("clicking a bar opens the runs feed scoped to exactly THAT bucket's window", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("dp:count:1"), { detail: 1 });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(EXPECTED_HREF);
  });

  test("keyboard activation (Enter/Space → click with detail 0) reaches the SAME destination", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("dp:count:1"), { detail: 0 });
    expect(mockNavigate).toHaveBeenCalledWith(EXPECTED_HREF);
  });

  test("a different bar drills into ITS bucket, not the first one", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("dp:count:0"), { detail: 1 });
    expect(mockNavigate).toHaveBeenCalledWith(
      drillDownHref({
        dateFrom: bucketRangeIso(BUCKET_A, "day").from,
        dateTo: bucketRangeIso(BUCKET_A, "day").to,
      }),
    );
  });

  test("every datapoint target is a real focusable button with an accessible name", async () => {
    await renderPanel();
    const target = screen.getByTestId("dp:count:1");
    expect(target.tagName).toBe("BUTTON");
    expect(target.getAttribute("aria-label")).toBeTruthy();
    target.focus();
    expect(document.activeElement).toBe(target);
  });
});
