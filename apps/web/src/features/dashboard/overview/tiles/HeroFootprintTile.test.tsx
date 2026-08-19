import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FootprintData, SectionEnvelope } from "../overview-contract";

/**
 * dashboard-bento WP 1.2 — `HeroFootprintTile`.
 *
 * **Why this stub is FAITHFUL and not inert.** Every other web suite mocks
 * `@elabs-ai/components-charts` with no-ops (its barrel pulls a broken `@visx/gradient` subpath
 * under jsdom), so a tile that passed the WRONG chart props — or none — would still go green. This
 * stub reproduces the three contracts the tile is responsible for, following
 * `features/dashboard/testing/{datapoint-clicks,time-axis-charts}.test.tsx`:
 *
 * 1. the container RECORDS the props it received (`xDataKey`, `status`, the handlers, the a11y name);
 * 2. it builds each row's x exactly as a TIME axis does — `new Date(row[xDataKey]).toISOString()` —
 *    so forgetting `xDataKey="x"` throws "Invalid time value" here, the real regression;
 * 3. each `Line` publishes one real `<button>` per plotted point (the shape `ChartDatapointLayer`
 *    renders) ONLY when the chart got an `onDatapointClick`, deriving the activation `source` with
 *    the library's own rule (`event.detail === 0 ? "keyboard" : "pointer"`).
 *
 * The negative control at the bottom proves the stub can fail.
 */

const captured = vi.hoisted(() => ({
  charts: [] as {
    xDataKey?: string;
    status?: string;
    loadingLabel?: string;
    accessibleLabel?: string;
    handler: unknown;
    label: unknown;
    rowCount: number;
  }[],
  lines: [] as { dataKey: string; stroke?: string }[],
  tooltips: [] as {
    rows?: (point: Record<string, unknown>) => { color: string; label: string; value: string }[];
  }[],
  activations: [] as { seriesKey: string; index: number; source: string }[],
}));

vi.mock("@elabs-ai/components-charts", async () => {
  const { createContext, useContext } = await import("react");

  type StubPoint = {
    datum: Record<string, unknown>;
    index: number;
    seriesKey: string;
    seriesLabel: string;
    value: number | undefined;
    category: unknown;
  };
  type Ctx = {
    data: Record<string, unknown>[];
    xDataKey: string;
    onDatapointClick?: (point: StubPoint & { source: string }, event: unknown) => void;
    datapointLabel?: (point: StubPoint) => string;
  };
  const ChartCtx = createContext<Ctx | null>(null);

  const Target = (props: Record<string, unknown>) => <button type="button" {...props} />; // brand-ui-allow: test-only chart stub — mirrors ChartDatapointLayer's own <button> targets

  const LineChart = ({
    data = [],
    xDataKey = "date",
    status,
    loadingLabel,
    accessibleLabel,
    onDatapointClick,
    datapointLabel,
    children,
  }: {
    data?: Record<string, unknown>[];
    xDataKey?: string;
    status?: string;
    loadingLabel?: string;
    accessibleLabel?: string;
    onDatapointClick?: Ctx["onDatapointClick"];
    datapointLabel?: Ctx["datapointLabel"];
    children?: ReactNode;
  }) => {
    captured.charts.push({
      xDataKey,
      status,
      loadingLabel,
      accessibleLabel,
      handler: onDatapointClick,
      label: datapointLabel,
      rowCount: data.length,
    });
    // A time-scale axis does exactly this; an undefined x → Invalid Date → throws, as in production.
    for (const row of data) new Date(row[xDataKey] as string | number | Date).toISOString();
    return (
      <ChartCtx value={{ data, xDataKey, onDatapointClick, datapointLabel }}>
        <div data-testid="line-chart">{children}</div>
      </ChartCtx>
    );
  };

  const Line = ({ dataKey, stroke }: { dataKey: string; stroke?: string }) => {
    captured.lines.push({ dataKey, stroke });
    const ctx = useContext(ChartCtx);
    if (!ctx?.onDatapointClick) return null; // the library's documented opt-out: no handler, no targets
    const handler = ctx.onDatapointClick;
    return (
      <>
        {ctx.data.map((datum, index) => {
          const value = datum[dataKey];
          if (typeof value !== "number") return null;
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

  const ChartTooltip = (props: {
    rows?: (point: Record<string, unknown>) => { color: string; label: string; value: string }[];
  }) => {
    captured.tooltips.push(props);
    return null;
  };

  return { LineChart, Line, ChartTooltip, Grid: () => null, XAxis: () => null };
});

import { HeroFootprintTile } from "./HeroFootprintTile";

const BUCKET_A = "2026-08-01T00:00:00.000Z";
const BUCKET_B = "2026-08-02T00:00:00.000Z";

function footprint(over: Partial<FootprintData> = {}): FootprintData {
  return {
    perServer: [
      {
        serverId: "srv_9f3ab21c",
        serverName: "Alpha",
        points: [
          { bucketStart: BUCKET_A, value: 100_000 },
          { bucketStart: BUCKET_B, value: 120_000 },
        ],
      },
      {
        serverId: "srv_2c118be4",
        serverName: "Bravo",
        points: [
          { bucketStart: BUCKET_A, value: 50_000 },
          { bucketStart: BUCKET_B, value: 60_000 },
        ],
      },
    ],
    totalTokens: 180_000,
    deltaTokens: 30_000,
    firstTimeServers: 0,
    mix: { toolTokens: 150_000, resourceTokens: 20_000, promptTokens: 10_000 },
    ...over,
  };
}

function ready(over: Partial<FootprintData> = {}): SectionEnvelope<FootprintData> {
  return { state: "ready", data: footprint(over), error: null };
}

function renderTile(section: SectionEnvelope<FootprintData>) {
  const onOpenServer = vi.fn();
  const view = render(<HeroFootprintTile section={section} onOpenServer={onOpenServer} />);
  return { ...view, onOpenServer };
}

beforeEach(() => {
  captured.charts.length = 0;
  captured.lines.length = 0;
  captured.tooltips.length = 0;
  captured.activations.length = 0;
});

describe("HeroFootprintTile — self-hiding", () => {
  test("an EMPTY section renders nothing at all (never an empty box in the bento)", () => {
    const { container } = renderTile({ state: "empty", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("a settled section with null data also renders nothing", () => {
    const { container } = renderTile({ state: "ready", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("HeroFootprintTile — the figures it states", () => {
  test("shows the fleet total and a signed Δ described in words, not colour alone", () => {
    renderTile(ready());
    expect(screen.getByText("180,000")).toBeInTheDocument();
    expect(screen.getByText("+30,000 vs previous")).toBeInTheDocument();
  });

  test("growth is UNFAVORABLE for startup tokens (amber worse-tone, D-IC3)", () => {
    renderTile(ready({ deltaTokens: 30_000 }));
    expect(screen.getByText("+30,000 vs previous").className).toContain("text-warning-text");
  });

  test("a shrinking footprint is the win (success tone) — the polarity is not reversed", () => {
    renderTile(ready({ deltaTokens: -12_500 }));
    expect(screen.getByText("-12,500 vs previous").className).toContain("text-success-text");
  });

  test("a NULL delta renders no delta at all — never a fabricated +0", () => {
    renderTile(ready({ deltaTokens: null }));
    expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument();
    expect(screen.getByText("180,000")).toBeInTheDocument();
  });

  test("a zero delta says so in words (a bare 0 beside a total explains nothing)", () => {
    renderTile(ready({ deltaTokens: 0 }));
    expect(screen.getByText("No change vs previous")).toBeInTheDocument();
  });

  test("discloses servers measured for the FIRST time, so a new server's whole figure isn't read as growth", () => {
    renderTile(ready({ firstTimeServers: 1 }));
    expect(screen.getByText("Includes 1 server measured for the first time")).toBeInTheDocument();
    renderTile(ready({ firstTimeServers: 3 }));
    expect(screen.getByText("Includes 3 servers measured for the first time")).toBeInTheDocument();
  });

  test("the legend names every server (the lines are keyed by opaque ids)", () => {
    renderTile(ready());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });
});

describe("HeroFootprintTile — the props that actually reach the chart", () => {
  test("xDataKey is 'x' — the rows carry the timestamp there, and a time axis throws on anything else", () => {
    renderTile(ready());
    expect(captured.charts).toHaveLength(1);
    expect(captured.charts[0]?.xDataKey).toBe("x");
    // Two buckets pivoted into two rows, both parsed as real Dates by the stub above.
    expect(captured.charts[0]?.rowCount).toBe(2);
  });

  test("every series colour is a var(--chart-N) reference from the shared ramp (a raw hex is silently ignored)", () => {
    renderTile(ready());
    expect(captured.lines.map((l) => l.dataKey)).toEqual(["srv_9f3ab21c", "srv_2c118be4"]);
    expect(captured.lines[0]?.stroke).toBe("var(--chart-1)");
    expect(captured.lines[1]?.stroke).toBe("var(--chart-2)");
    for (const line of captured.lines) expect(line.stroke).toMatch(/^var\(--chart-\d+\)$/);
  });

  test("the tooltip rows are coloured from the SAME ramp slot as their line", () => {
    renderTile(ready());
    const rows =
      captured.tooltips[0]?.rows?.({ srv_9f3ab21c: 120_000, srv_2c118be4: 60_000 }) ?? [];
    expect(rows.map((r) => r.color)).toEqual(["var(--chart-1)", "var(--chart-2)"]);
    expect(rows.map((r) => r.label)).toEqual(["Alpha", "Bravo"]);
    expect(rows[0]?.value).toBe("120,000 tokens");
  });

  test("a bucket a server has no scan for reads 'no scan' in the tooltip — never a fabricated 0", () => {
    renderTile(ready());
    const rows = captured.tooltips[0]?.rows?.({ srv_9f3ab21c: 120_000 }) ?? [];
    expect(rows[1]?.value).toBe("no scan");
  });

  test("loading rides the chart's OWN status prop (no bespoke spinner, no collapsed layout)", () => {
    renderTile({ state: "loading", data: null, error: null });
    expect(captured.charts[0]?.status).toBe("loading");
    expect(captured.charts[0]?.loadingLabel).toBe("Loading footprint…");
  });

  test("a ready section renders the chart in the ready status", () => {
    renderTile(ready());
    expect(captured.charts[0]?.status).toBe("ready");
  });

  test("the chart carries an accessible name", () => {
    renderTile(ready());
    expect(captured.charts[0]?.accessibleLabel).toBe(
      "Fleet footprint tokens over time, one line per server",
    );
  });
});

describe("HeroFootprintTile — drill-down", () => {
  test("activating a point opens THAT server (pointer)", () => {
    const { onOpenServer } = renderTile(ready());
    expect(typeof captured.charts[0]?.handler).toBe("function");
    fireEvent.click(screen.getByTestId("dp:srv_2c118be4:1"), { detail: 1 });
    expect(onOpenServer).toHaveBeenCalledTimes(1);
    expect(onOpenServer).toHaveBeenCalledWith("srv_2c118be4");
  });

  test("a KEYBOARD activation reaches the same target", () => {
    const { onOpenServer } = renderTile(ready());
    fireEvent.click(screen.getByTestId("dp:srv_9f3ab21c:0"), { detail: 0 });
    expect(onOpenServer).toHaveBeenCalledWith("srv_9f3ab21c");
    expect(captured.activations[0]?.source).toBe("keyboard");
  });

  test("each target's accessible name is the server NAME and its real figure, not the opaque id", () => {
    renderTile(ready());
    const label = screen.getByTestId("dp:srv_9f3ab21c:1").getAttribute("aria-label") ?? "";
    expect(label).toContain("Alpha");
    expect(label).toContain("120,000 tokens");
    expect(label).not.toContain("srv_9f3ab21c");
  });

  test("every datapoint target is a real focusable button with an accessible name", () => {
    renderTile(ready());
    const target = screen.getByTestId("dp:srv_9f3ab21c:0");
    expect(target.tagName).toBe("BUTTON");
    expect(target.getAttribute("aria-label")).toBeTruthy();
    target.focus();
    expect(document.activeElement).toBe(target);
  });
});

describe("HeroFootprintTile — error", () => {
  test("an errored section surfaces the message instead of swallowing it", () => {
    renderTile({ state: "error", data: null, error: "metrics endpoint returned 500" });
    expect(screen.getByText("Footprint unavailable")).toBeInTheDocument();
    expect(screen.getByText("metrics endpoint returned 500")).toBeInTheDocument();
    expect(captured.charts).toHaveLength(0);
  });
});

/**
 * NEGATIVE CONTROL — without this, "the tile passes the right chart props" would be an assertion
 * about a mock that could equally be satisfied by a mock that ignores props.
 */
describe("NEGATIVE CONTROL — the stub is not permissive", () => {
  test("a chart mounted WITHOUT onDatapointClick records undefined and publishes no targets", async () => {
    const { LineChart, Line } = await import("@elabs-ai/components-charts");
    render(
      <LineChart data={[{ x: new Date(BUCKET_A), a: 3 }]} xDataKey="x">
        <Line dataKey="a" />
      </LineChart>,
    );
    expect(captured.charts[0]?.handler).toBeUndefined();
    expect(screen.queryByTestId("dp:a:0")).not.toBeInTheDocument();
  });

  test("a chart that forgets xDataKey THROWS the real 'Invalid time value' regression", async () => {
    const { LineChart } = await import("@elabs-ai/components-charts");
    expect(() => render(<LineChart data={[{ x: new Date(BUCKET_A) }]}>{null}</LineChart>)).toThrow(
      /Invalid time value/,
    );
  });

  test("the stub records the stroke it is actually handed (so a wrong colour would show up)", async () => {
    const { LineChart, Line } = await import("@elabs-ai/components-charts");
    render(
      <LineChart data={[{ x: new Date(BUCKET_A), a: 3 }]} xDataKey="x">
        <Line dataKey="a" stroke="#ff0000" />
      </LineChart>,
    );
    expect(captured.lines[0]?.stroke).toBe("#ff0000");
  });
});
