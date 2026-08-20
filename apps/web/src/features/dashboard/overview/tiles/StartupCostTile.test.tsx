import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FootprintData, SectionEnvelope } from "../overview-contract";

/**
 * dashboard-bento WP 1.2 — `StartupCostTile`.
 *
 * `@elabs-ai/components-charts` is stubbed (its barrel is jsdom-hostile) but the stub is FAITHFUL:
 * `Sparkline` renders the `values`/`variant`/`emphasizeLast`/`label` it was handed into readable
 * attributes, so a series that was NOT normalised — or a label that lost the real figures — fails
 * here instead of passing silently. The negative control at the bottom mounts the stub directly to
 * prove it reflects props rather than ignoring them.
 *
 * `MetricCard` is the REAL `@elabs-ai/components-ui` component. Since WP 2.2 (Defect 5) the tile no
 * longer hands it `delta`/`deltaDirection`/`positiveIsGood` — those paint an unfavourable delta RED,
 * while this app reserves red for structural removal and colours a worsening magnitude AMBER
 * (D-IC3, `lib/delta.ts`). The delta now renders through the shared `MetricDelta`, which reproduces
 * `MetricCard`'s `data-polarity` + accessible-label contract verbatim — so every assertion below is
 * unchanged, and the tone assertions are new.
 */

vi.mock("@elabs-ai/components-charts", () => ({
  Sparkline: ({
    values,
    variant,
    emphasizeLast,
    label,
  }: {
    values: number[];
    variant?: string;
    emphasizeLast?: boolean;
    label?: string;
  }) => (
    <svg
      role="img"
      aria-label={label}
      data-testid="sparkline"
      data-values={values.join(",")}
      data-variant={variant}
      data-emphasize-last={String(Boolean(emphasizeLast))}
    />
  ),
}));

import { StartupCostTile } from "./StartupCostTile";

const BUCKETS = [
  "2026-08-01T00:00:00.000Z",
  "2026-08-02T00:00:00.000Z",
  "2026-08-03T00:00:00.000Z",
];

/** A realistic fleet shape: three measurements ~2% apart — the series a zero-baselined sparkline
 *  would draw as a flat line if it were handed the absolutes. */
function footprint(over: Partial<FootprintData> = {}): FootprintData {
  return {
    perServer: [
      {
        serverId: "srv-a",
        serverName: "Alpha",
        points: BUCKETS.map((bucketStart, i) => ({ bucketStart, value: 580_000 + i * 5_000 })),
      },
    ],
    // WP 2.3 contract additions — `StartupCostTile` draws its sparkline from the WINDOW (`perServer`)
    // and reads neither of these; pinned empty so a future crossover would fail rather than pass.
    standingSeries: [],
    unmeasuredServers: [],
    totalTokens: 590_000,
    deltaTokens: 10_000,
    firstTimeServers: 0,
    mix: { toolTokens: 500_000, resourceTokens: 60_000, promptTokens: 30_000 },
    latestMeasuredAt: "2026-08-03T00:00:00.000Z",
    noActivityInWindow: false,
    ...over,
  };
}

function ready(over: Partial<FootprintData> = {}): SectionEnvelope<FootprintData> {
  return { state: "ready", data: footprint(over), error: null };
}

function renderTile(section: SectionEnvelope<FootprintData>) {
  return render(<StartupCostTile section={section} />);
}

function sparkline() {
  return screen.queryByTestId("sparkline");
}

describe("StartupCostTile — self-hiding", () => {
  test("an EMPTY section renders nothing", () => {
    const { container } = renderTile({ state: "empty", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("a settled section with null data renders nothing", () => {
    const { container } = renderTile({ state: "ready", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StartupCostTile — the figure and its delta", () => {
  test("states the fleet total and what it is made of", () => {
    renderTile(ready());
    expect(screen.getByText("590,000")).toBeInTheDocument();
    expect(screen.getByText("Tools + resources + prompts, latest scans")).toBeInTheDocument();
  });

  test("GROWTH is unfavorable — positiveIsGood is false for startup tokens", () => {
    const { container } = renderTile(ready({ deltaTokens: 10_000 }));
    const delta = container.querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("+10,000");
    expect(delta?.getAttribute("data-polarity")).toBe("bad");
  });

  test("a SHRINKING footprint is favorable (the polarity is not merely 'always bad')", () => {
    const { container } = renderTile(ready({ deltaTokens: -4_000 }));
    const delta = container.querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("-4,000");
    expect(delta?.getAttribute("data-polarity")).toBe("good");
  });

  test("a NULL delta renders no delta node at all — never a fabricated 0", () => {
    const { container } = renderTile(ready({ deltaTokens: null }));
    expect(container.querySelector("[data-polarity]")).toBeNull();
    expect(screen.getByText("590,000")).toBeInTheDocument();
  });

  test("a genuine zero says 'No change' rather than floating a bare 0", () => {
    renderTile(ready({ deltaTokens: 0 }));
    expect(screen.getByText("No change")).toBeInTheDocument();
  });

  // ── WP 2.2, Defect 5 — ONE delta tone on the merged bento ──────────────────────────────────────
  test("a GROWING footprint is amber (the app's rule), never the destructive red", () => {
    const { container } = renderTile(ready({ deltaTokens: 10_000 }));
    const delta = container.querySelector("[data-polarity]");
    expect(delta?.className).toContain("text-warning-text");
    expect(delta?.className).not.toContain("text-destructive-text");
  });

  test("a SHRINKING footprint is the success tone", () => {
    const { container } = renderTile(ready({ deltaTokens: -4_000 }));
    expect(container.querySelector("[data-polarity]")?.className).toContain("text-success-text");
  });

  test("keeps MetricCard's accessible-label form so screen readers hear the same sentence", () => {
    const { container } = renderTile(ready({ deltaTokens: 10_000 }));
    expect(container.querySelector("[data-polarity]")?.getAttribute("aria-label")).toBe(
      "up +10,000, unfavorable",
    );
  });

  test("discloses first-time measurements as evidence under the figure", () => {
    renderTile(ready({ firstTimeServers: 2 }));
    expect(screen.getByText("Includes 2 servers measured for the first time")).toBeInTheDocument();
  });
});

describe("StartupCostTile — a window with no scan activity", () => {
  // The figure is a STANDING measurement (latest successful scan per server, all history); only the
  // sparkline is windowed. A quiet window used to empty this tile off the bento entirely.
  const quiet = (over: Partial<FootprintData> = {}) =>
    ready({
      perServer: [],
      noActivityInWindow: true,
      latestMeasuredAt: "2026-07-20T00:00:00.000Z",
      ...over,
    });

  test("still states the fleet's startup tokens and its Δ — the tile does NOT vanish", () => {
    renderTile(quiet());
    expect(screen.getByText("590,000")).toBeInTheDocument();
    expect(screen.getByText(/\+10,000/)).toBeInTheDocument();
  });

  test("the footer says there were no scans in this window, and when it was last measured", () => {
    renderTile(quiet());
    expect(screen.getByText(/No scans in this window — last measured/)).toBeInTheDocument();
  });

  test("no sparkline is drawn for a window with nothing in it (never a flat line at zero)", () => {
    renderTile(quiet());
    expect(sparkline()).toBeNull();
  });

  test("with no 'last measured' timestamp the note stays honest and simply says less", () => {
    renderTile(quiet({ latestMeasuredAt: null }));
    expect(screen.getByText("No scans in this window")).toBeInTheDocument();
  });

  test("the first-measured disclosure is still stated alongside it", () => {
    renderTile(quiet({ firstTimeServers: 2 }));
    expect(screen.getByText(/No scans in this window/)).toBeInTheDocument();
    expect(screen.getByText("Includes 2 servers measured for the first time")).toBeInTheDocument();
  });
});

describe("StartupCostTile — the sparkline (Sparkline is ZERO-baselined, so the series is normalised)", () => {
  test("normalises to the window minimum and keeps the REAL figures in the label", () => {
    renderTile(ready());
    const spark = sparkline();
    const values = (spark?.getAttribute("data-values") ?? "").split(",").map(Number);
    expect(values).toEqual([0, 5_000, 10_000]);
    // Degenerate-shape guard: the drawn series must span the box. The absolutes (580000, 585000,
    // 590000) would sit in the top 2% of a 0..max box — a visually flat line.
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
    expect(spark?.getAttribute("data-variant")).toBe("line");
    expect(spark?.getAttribute("data-emphasize-last")).toBe("true");
    expect(spark?.getAttribute("aria-label")).toBe(
      "Startup tokens: 580,000 → 590,000 across the last 3 measurements",
    );
  });

  test("the fleet series sums the servers per bucket, carrying a server's last known figure forward", () => {
    renderTile(
      ready({
        perServer: [
          {
            serverId: "srv-a",
            serverName: "Alpha",
            points: [
              { bucketStart: BUCKETS[0] as string, value: 100_000 },
              { bucketStart: BUCKETS[1] as string, value: 90_000 },
            ],
          },
          // Bravo appears only in the LAST bucket — the "added a server" case that must show as the
          // step it is (0 before it was measured), not erase the series.
          {
            serverId: "srv-b",
            serverName: "Bravo",
            points: [{ bucketStart: BUCKETS[2] as string, value: 500_000 }],
          },
        ],
        totalTokens: 590_000,
      }),
    );
    const values = (sparkline()?.getAttribute("data-values") ?? "").split(",").map(Number);
    // absolutes 100,000 → 90,000 → 590,000, normalised to the window minimum (90,000)
    expect(values).toEqual([10_000, 0, 500_000]);
    expect(sparkline()?.getAttribute("aria-label")).toBe(
      "Startup tokens: 100,000 → 590,000 across the last 3 measurements",
    );
  });

  test("a single measurement draws NO sparkline (a series needs at least two points)", () => {
    renderTile(
      ready({
        perServer: [
          {
            serverId: "srv-a",
            serverName: "Alpha",
            points: [{ bucketStart: BUCKETS[0] as string, value: 1_000 }],
          },
        ],
      }),
    );
    expect(sparkline()).toBeNull();
  });
});

describe("StartupCostTile — load and error states", () => {
  test("loading uses MetricCard's own layout-shaped loading, not a spinner or a blank tile", () => {
    const { container } = renderTile({ state: "loading", data: null, error: null });
    expect(screen.queryByText("590,000")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="bento-grid-item"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  test("an errored section surfaces its message", () => {
    renderTile({ state: "error", data: null, error: "scan metrics failed" });
    expect(screen.getByText("Startup tokens unavailable")).toBeInTheDocument();
    expect(screen.getByText("scan metrics failed")).toBeInTheDocument();
  });
});

/** NEGATIVE CONTROL — proves the Sparkline stub reflects the props it is handed, so the assertions
 *  above are about the tile's series and not about an inert mock. */
describe("NEGATIVE CONTROL — the stub is not permissive", () => {
  test("a Sparkline mounted directly records exactly the props it received", async () => {
    const { Sparkline } = await import("@elabs-ai/components-charts");
    render(<Sparkline values={[7, 8, 9]} variant="bar" label="raw" />);
    const spark = screen.getByTestId("sparkline");
    expect(spark.getAttribute("data-values")).toBe("7,8,9");
    expect(spark.getAttribute("data-variant")).toBe("bar");
    expect(spark.getAttribute("data-emphasize-last")).toBe("false");
    expect(spark.getAttribute("aria-label")).toBe("raw");
  });
});
