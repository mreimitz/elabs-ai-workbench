import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FootprintData, SectionEnvelope } from "../overview-contract";

/**
 * dashboard-bento WP 1.2 — `SurfaceMixTile`.
 *
 * FAITHFUL stub of the two `@elabs-ai/components-charts` parts this tile uses:
 *
 * - **`ChartCard`** reproduces the one behaviour the tile depends on — `loading` swaps the children
 *   for a skeleton in a live region. `RingChart` has NO `status` prop (only the cartesian families
 *   do), so this wrapper IS the tile's loading state; an inert stub would let a tile that rendered a
 *   ring over missing data pass.
 * - **`RingChart`/`Ring`** record the data, geometry and colours they were handed, and publish one
 *   real `<button>` per ring — the `ChartDatapointLayer` shape — ONLY when an `onDatapointClick` was
 *   passed, which is the library's documented opt-out and doubles as this suite's negative control.
 */

const captured = vi.hoisted(() => ({
  cards: [] as { loading?: boolean; height?: number }[],
  rings: [] as {
    data: { label: string; value: number; maxValue: number; color?: string }[];
    size?: number;
    accessibleLabel?: string;
    accessibleDescription?: string;
    handler: unknown;
  }[],
  ringChildren: [] as { index: number; color?: string }[],
}));

vi.mock("@elabs-ai/components-charts", async () => {
  const { createContext, useContext } = await import("react");

  type RingDatum = { label: string; value: number; maxValue: number; color?: string };
  type Ctx = {
    data: RingDatum[];
    onDatapointClick?: (
      point: { index: number; value: number; category: string; source: string },
      e: unknown,
    ) => void;
    datapointLabel?: (point: { index: number; value: number; category: string }) => string;
  };
  const RingCtx = createContext<Ctx | null>(null);

  const Target = (props: Record<string, unknown>) => <button type="button" {...props} />; // brand-ui-allow: test-only chart stub — mirrors ChartDatapointLayer's own <button> targets

  const ChartCard = ({
    title,
    height,
    loading = false,
    children,
  }: {
    title?: ReactNode;
    height?: number;
    loading?: boolean;
    children?: ReactNode;
  }) => {
    captured.cards.push({ loading, height });
    return (
      <div data-testid="chart-card">
        <div>{title}</div>
        {loading ? (
          <output aria-live="polite" data-testid="chart-card-skeleton">
            <span>Loading chart…</span>
          </output>
        ) : (
          children
        )}
      </div>
    );
  };

  const RingChart = ({
    data = [],
    size,
    accessibleLabel,
    accessibleDescription,
    onDatapointClick,
    datapointLabel,
    children,
  }: {
    data?: RingDatum[];
    size?: number;
    accessibleLabel?: string;
    accessibleDescription?: string;
    onDatapointClick?: Ctx["onDatapointClick"];
    datapointLabel?: Ctx["datapointLabel"];
    children?: ReactNode;
  }) => {
    captured.rings.push({
      data,
      size,
      accessibleLabel,
      accessibleDescription,
      handler: onDatapointClick,
    });
    return (
      <RingCtx value={{ data, onDatapointClick, datapointLabel }}>
        <div data-testid="ring-chart">
          {children}
          {onDatapointClick
            ? data.map((datum, index) => {
                const base = { index, value: datum.value, category: datum.label };
                return (
                  <Target
                    key={datum.label}
                    data-testid={`ring-dp:${index}`}
                    aria-label={
                      datapointLabel ? datapointLabel(base) : `${datum.label}: ${datum.value}`
                    }
                    onClick={(event: { detail?: number }) =>
                      onDatapointClick(
                        { ...base, source: event.detail === 0 ? "keyboard" : "pointer" },
                        event,
                      )
                    }
                  />
                );
              })
            : null}
        </div>
      </RingCtx>
    );
  };

  const Ring = ({ index, color }: { index: number; color?: string }) => {
    captured.ringChildren.push({ index, color });
    const ctx = useContext(RingCtx);
    return (
      <span data-testid={`ring:${index}`} data-color={color} data-label={ctx?.data[index]?.label} />
    );
  };

  return { ChartCard, RingChart, Ring };
});

import { SurfaceMixTile } from "./SurfaceMixTile";

function footprint(over: Partial<FootprintData> = {}): FootprintData {
  return {
    perServer: [],
    totalTokens: 200_000,
    deltaTokens: null,
    firstTimeServers: 0,
    mix: { toolTokens: 150_000, resourceTokens: 30_000, promptTokens: 20_000 },
    latestMeasuredAt: "2026-08-03T00:00:00.000Z",
    noActivityInWindow: false,
    ...over,
  };
}

function ready(over: Partial<FootprintData> = {}): SectionEnvelope<FootprintData> {
  return { state: "ready", data: footprint(over), error: null };
}

beforeEach(() => {
  captured.cards.length = 0;
  captured.rings.length = 0;
  captured.ringChildren.length = 0;
});

describe("SurfaceMixTile — self-hiding", () => {
  test("an EMPTY section renders nothing", () => {
    const { container } = render(
      <SurfaceMixTile section={{ state: "empty", data: null, error: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("a ready section whose scans produced NO mix renders nothing", () => {
    const { container } = render(<SurfaceMixTile section={ready({ mix: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("an all-zero surface renders nothing (three empty arcs are an empty box, and 0/0 is NaN)", () => {
    const { container } = render(
      <SurfaceMixTile
        section={ready({ mix: { toolTokens: 0, resourceTokens: 0, promptTokens: 0 } })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SurfaceMixTile — a window with no scan activity", () => {
  test("the mix is a STANDING measurement, so a quiet window does NOT remove the tile", () => {
    // Before the standing/windowed split this tile read its mix off the windowed scan metrics, so an
    // instance holding 103 scans whose newest was 19 days old saw it disappear on the 7-day default.
    render(<SurfaceMixTile section={ready({ perServer: [], noActivityInWindow: true })} />);
    expect(captured.rings).toHaveLength(1);
    expect(captured.rings[0]?.data).toHaveLength(3);
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });
});

describe("SurfaceMixTile — the props that actually reach the ring chart", () => {
  test("one ring per surface, each measured against the SAME total", () => {
    render(<SurfaceMixTile section={ready()} />);
    expect(captured.rings).toHaveLength(1);
    expect(captured.rings[0]?.data).toEqual([
      { label: "Tools", value: 150_000, maxValue: 200_000, color: "var(--chart-1)" },
      { label: "Resources", value: 30_000, maxValue: 200_000, color: "var(--chart-2)" },
      { label: "Prompts", value: 20_000, maxValue: 200_000, color: "var(--chart-3)" },
    ]);
  });

  test("every ring colour is a var(--chart-N) reference from the shared ramp", () => {
    render(<SurfaceMixTile section={ready()} />);
    expect(captured.ringChildren.map((r) => r.color)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
    ]);
    for (const ring of captured.ringChildren) expect(ring.color).toMatch(/^var\(--chart-\d+\)$/);
  });

  test("the chart carries an accessible name AND the split in words (colour is never the only signal)", () => {
    render(<SurfaceMixTile section={ready()} />);
    expect(captured.rings[0]?.accessibleLabel).toBe("Startup token surface mix");
    expect(captured.rings[0]?.accessibleDescription).toBe(
      "Tools 150,000 tokens, 75%; Resources 30,000 tokens, 15%; Prompts 20,000 tokens, 10%",
    );
  });

  test("the legend states each surface and its share", () => {
    render(<SurfaceMixTile section={ready()} />);
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });
});

describe("SurfaceMixTile — loading uses ChartCard (RingChart has no status prop)", () => {
  test("loading renders the ChartCard skeleton and NO ring", () => {
    render(<SurfaceMixTile section={{ state: "loading", data: null, error: null }} />);
    expect(captured.cards[0]?.loading).toBe(true);
    expect(screen.getByTestId("chart-card-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("ring-chart")).not.toBeInTheDocument();
    expect(captured.rings).toHaveLength(0);
  });

  test("a ready section renders the ring, not the skeleton", () => {
    render(<SurfaceMixTile section={ready()} />);
    expect(captured.cards[0]?.loading).toBe(false);
    expect(screen.getByTestId("ring-chart")).toBeInTheDocument();
  });

  test("an errored section surfaces its message instead of a chart", () => {
    render(
      <SurfaceMixTile section={{ state: "error", data: null, error: "scan metrics failed" }} />,
    );
    expect(screen.getByText("Surface mix unavailable")).toBeInTheDocument();
    expect(screen.getByText("scan metrics failed")).toBeInTheDocument();
    expect(captured.rings).toHaveLength(0);
  });
});

describe("SurfaceMixTile — drill-down", () => {
  test("activating a ring reports THAT surface (pointer and keyboard alike)", () => {
    const onOpenSegment = vi.fn();
    render(<SurfaceMixTile section={ready()} onOpenSegment={onOpenSegment} />);
    expect(typeof captured.rings[0]?.handler).toBe("function");

    fireEvent.click(screen.getByTestId("ring-dp:1"), { detail: 1 });
    expect(onOpenSegment).toHaveBeenCalledWith("resources");

    fireEvent.click(screen.getByTestId("ring-dp:2"), { detail: 0 });
    expect(onOpenSegment).toHaveBeenLastCalledWith("prompts");
  });

  test("each target's accessible name carries the surface, its tokens and its share", () => {
    render(<SurfaceMixTile section={ready()} onOpenSegment={vi.fn()} />);
    expect(screen.getByTestId("ring-dp:0")).toHaveAttribute(
      "aria-label",
      "Tools: 150,000 tokens, 75%",
    );
  });

  test("without a drill handler the chart publishes NO extra focusable targets (the library's opt-out)", () => {
    render(<SurfaceMixTile section={ready()} />);
    expect(captured.rings[0]?.handler).toBeUndefined();
    expect(screen.queryByTestId("ring-dp:0")).not.toBeInTheDocument();
  });
});

/** NEGATIVE CONTROL — the stub reports what it is handed, so a wrong prop would surface. */
describe("NEGATIVE CONTROL — the stub is not permissive", () => {
  test("a ChartCard mounted with loading=false renders its children; the stub records both props", async () => {
    const { ChartCard } = await import("@elabs-ai/components-charts");
    render(
      <ChartCard title="raw" height={42} loading={false}>
        <span data-testid="raw-child" />
      </ChartCard>,
    );
    expect(captured.cards[0]).toEqual({ loading: false, height: 42 });
    expect(screen.getByTestId("raw-child")).toBeInTheDocument();
  });

  test("a RingChart mounted with a raw colour records that raw colour (so the ramp assertions can fail)", async () => {
    const { Ring, RingChart } = await import("@elabs-ai/components-charts");
    render(
      <RingChart data={[{ label: "X", value: 1, maxValue: 2, color: "#ff0000" }]}>
        <Ring index={0} color="#ff0000" />
      </RingChart>,
    );
    expect(captured.ringChildren[0]?.color).toBe("#ff0000");
    expect(captured.rings[0]?.data[0]?.color).toBe("#ff0000");
  });
});
