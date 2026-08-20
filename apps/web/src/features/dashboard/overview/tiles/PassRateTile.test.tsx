import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { RunHealthData, SectionEnvelope } from "../overview-contract";

/**
 * dashboard-bento WP 1.2 — `PassRateTile`.
 *
 * Same faithful `Sparkline` stub as `StartupCostTile.test.tsx` (the charts barrel is jsdom-hostile,
 * and an inert mock would let a wrong series pass), with `MetricCard` left REAL.
 *
 * The headline assertion of this file is the POLARITY: this is the one tile on the bento where a
 * rising number is the win. Backwards here would paint an improving fleet in the failure colour,
 * which is precisely the class of defect the plan calls out.
 *
 * Since WP 2.2 (Defect 5) the delta renders through the shared `MetricDelta`/`lib/delta.ts` rather
 * than `MetricCard`'s own `delta`/`positiveIsGood` props, so the merged bento carries ONE tone
 * vocabulary (amber = worse, never the destructive red). `MetricDelta` reproduces `MetricCard`'s
 * `data-polarity` + accessible-label contract verbatim, so every pre-existing assertion still holds.
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

import { PassRateTile } from "./PassRateTile";

const BUCKETS = [
  "2026-08-01T00:00:00.000Z",
  "2026-08-02T00:00:00.000Z",
  "2026-08-03T00:00:00.000Z",
];

function runHealth(over: Partial<RunHealthData> = {}): RunHealthData {
  return {
    runCount: 24,
    passRatePercent: 91.5,
    passRateDeltaPoints: 3.2,
    runsOverTime: [
      { bucketStart: BUCKETS[0] as string, value: 6 },
      { bucketStart: BUCKETS[1] as string, value: 9 },
      { bucketStart: BUCKETS[2] as string, value: 9 },
    ],
    costByBasis: [{ basis: "api_exact", currentUsd: 4.5, previousUsd: 3.5 }],
    ...over,
  };
}

function ready(over: Partial<RunHealthData> = {}): SectionEnvelope<RunHealthData> {
  return { state: "ready", data: runHealth(over), error: null };
}

function renderTile(section: SectionEnvelope<RunHealthData>) {
  return render(<PassRateTile section={section} />);
}

describe("PassRateTile — self-hiding", () => {
  test("an EMPTY section renders nothing", () => {
    const { container } = renderTile({ state: "empty", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("a settled section with null data renders nothing", () => {
    const { container } = renderTile({ state: "ready", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PassRateTile — polarity (the opposite of every other tile here)", () => {
  test("a RISING pass rate is FAVORABLE — positiveIsGood is true", () => {
    const { container } = renderTile(ready({ passRateDeltaPoints: 3.2 }));
    const delta = container.querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("+3.2 pts");
    expect(delta?.getAttribute("data-polarity")).toBe("good");
  });

  test("a FALLING pass rate is unfavorable", () => {
    const { container } = renderTile(ready({ passRateDeltaPoints: -1.4 }));
    const delta = container.querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("-1.4 pts");
    expect(delta?.getAttribute("data-polarity")).toBe("bad");
  });

  test("the Δ is stated in percentage POINTS, so it cannot be misread as a relative change", () => {
    renderTile(ready({ passRateDeltaPoints: 3.2 }));
    expect(screen.getByText(/pts/)).toBeInTheDocument();
  });

  test("a RISING pass rate is the success tone; a FALLING one is amber, never destructive red", () => {
    // WP 2.2, Defect 5 — the tile renders its delta through `MetricDelta`/`lib/delta.ts` (D-IC3),
    // not `MetricCard`'s own `positiveIsGood` colouring, so the whole merged bento shares one tone
    // vocabulary: amber = worse, green = better, muted = neutral.
    const rising = renderTile(ready({ passRateDeltaPoints: 3.2 })).container;
    expect(rising.querySelector("[data-polarity]")?.className).toContain("text-success-text");
    cleanup();
    const falling = renderTile(ready({ passRateDeltaPoints: -1.4 })).container;
    expect(falling.querySelector("[data-polarity]")?.className).toContain("text-warning-text");
    expect(falling.querySelector("[data-polarity]")?.className).not.toContain(
      "text-destructive-text",
    );
  });

  test("keeps MetricCard's accessible-label form so screen readers hear the same sentence", () => {
    const { container } = renderTile(ready({ passRateDeltaPoints: 3.2 }));
    expect(container.querySelector("[data-polarity]")?.getAttribute("aria-label")).toBe(
      "up +3.2 pts, favorable",
    );
  });

  test("a NULL delta renders no delta node", () => {
    const { container } = renderTile(ready({ passRateDeltaPoints: null }));
    expect(container.querySelector("[data-polarity]")).toBeNull();
  });
});

describe("PassRateTile — the figure", () => {
  test("states the rate and the run count behind it", () => {
    renderTile(ready());
    expect(screen.getByText("91.5%")).toBeInTheDocument();
    expect(screen.getByText("24 runs in this window")).toBeInTheDocument();
  });

  test("no terminal run yet reads 'n/a' — never a fabricated 0% (which would read as total failure)", () => {
    renderTile(ready({ passRatePercent: null, passRateDeltaPoints: null, runCount: 3 }));
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText("3 runs, none terminal yet")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });
});

describe("PassRateTile — the sparkline", () => {
  test("plots the run cadence, normalised to the window minimum, and NAMES what it plots", () => {
    renderTile(ready());
    const spark = screen.getByTestId("sparkline");
    expect((spark.getAttribute("data-values") ?? "").split(",").map(Number)).toEqual([0, 3, 3]);
    expect(spark.getAttribute("data-variant")).toBe("line");
    expect(spark.getAttribute("data-emphasize-last")).toBe("true");
    // The label states the REAL counts and says these are runs, not pass rates — a series on this
    // tile that silently meant something else would be worse than no series at all.
    expect(spark.getAttribute("aria-label")).toBe(
      "Runs per bucket: 6 → 9 across the last 3 buckets",
    );
  });

  test("a single bucket draws no sparkline", () => {
    renderTile(ready({ runsOverTime: [{ bucketStart: BUCKETS[0] as string, value: 4 }] }));
    expect(screen.queryByTestId("sparkline")).toBeNull();
  });
});

describe("PassRateTile — load and error states", () => {
  test("loading uses MetricCard's own loading shape", () => {
    const { container } = renderTile({ state: "loading", data: null, error: null });
    expect(screen.queryByText("91.5%")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="bento-grid-item"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  test("an errored section surfaces its message", () => {
    renderTile({ state: "error", data: null, error: "run metrics failed" });
    expect(screen.getByText("Run health unavailable")).toBeInTheDocument();
    expect(screen.getByText("run metrics failed")).toBeInTheDocument();
  });
});

/** NEGATIVE CONTROL — the Sparkline stub reflects real props (so the series assertions can fail). */
describe("NEGATIVE CONTROL — the stub is not permissive", () => {
  test("a Sparkline mounted directly records exactly the props it received", async () => {
    const { Sparkline } = await import("@elabs-ai/components-charts");
    render(<Sparkline values={[1, 2]} variant="bar" label="raw" />);
    const spark = screen.getByTestId("sparkline");
    expect(spark.getAttribute("data-values")).toBe("1,2");
    expect(spark.getAttribute("data-variant")).toBe("bar");
    expect(spark.getAttribute("aria-label")).toBe("raw");
  });
});
