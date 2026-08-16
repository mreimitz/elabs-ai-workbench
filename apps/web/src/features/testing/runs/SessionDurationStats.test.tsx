import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RunFilter, RunMetricsResponse } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, getRunMetrics: vi.fn() };
});

import { getRunMetrics } from "../../../lib/api";
import { SessionDurationStats } from "./SessionDurationStats";

function metricsResponse(overrides: Partial<RunMetricsResponse> = {}): RunMetricsResponse {
  return {
    bucket: "week",
    timezone: "UTC",
    from: null,
    to: null,
    groupBy: "environment",
    measures: ["p50DurationMs", "p95DurationMs"],
    unavailableMeasures: [],
    series: [],
    ...overrides,
  };
}

function renderStats(filter: RunFilter) {
  return render(
    <TooltipProvider>
      <SessionDurationStats filter={filter} environmentLabel={(id) => `Env ${id}`} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getRunMetrics).mockReset();
});

describe("SessionDurationStats — visibility gate", () => {
  test("renders nothing when the active filter is NOT interactiveOnly (no fetch either)", () => {
    const { container } = renderStats({ pinned: true });
    expect(container).toBeEmptyDOMElement();
    expect(getRunMetrics).not.toHaveBeenCalled();
  });

  test("renders nothing once loaded with zero environments (an honest empty, not a stuck panel)", async () => {
    vi.mocked(getRunMetrics).mockResolvedValue(metricsResponse({ series: [] }));
    const { container } = renderStats({ interactiveOnly: true });
    await waitFor(() => expect(getRunMetrics).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test("a fetch failure hides the strip (best-effort — never blocks the table beneath it)", async () => {
    vi.mocked(getRunMetrics).mockRejectedValue(new Error("network down"));
    const { container } = renderStats({ interactiveOnly: true });
    await waitFor(() => expect(getRunMetrics).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("SessionDurationStats — query shape + rendering", () => {
  test("queries groupBy:environment + p50/p95 measures, passing the ACTIVE filter through as-is", async () => {
    vi.mocked(getRunMetrics).mockResolvedValue(metricsResponse());
    const filter: RunFilter = { interactiveOnly: true, scenarioId: ["scn-1"] };
    renderStats(filter);
    await waitFor(() =>
      expect(getRunMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          filter,
          groupBy: "environment",
          measures: ["p50DurationMs", "p95DurationMs"],
        }),
        expect.anything(),
      ),
    );
  });

  test("renders one chip per environment with its latest p50/p95", async () => {
    vi.mocked(getRunMetrics).mockResolvedValue(
      metricsResponse({
        series: [
          {
            measure: "p50DurationMs",
            group: "scn-1",
            capabilityClass: null,
            points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 5_000, n: 2 }],
          },
          {
            measure: "p95DurationMs",
            group: "scn-1",
            capabilityClass: null,
            points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 12_000, n: 2 }],
          },
        ],
      }),
    );
    renderStats({ interactiveOnly: true });
    expect(await screen.findByText("Env scn-1")).toBeInTheDocument();
    expect(screen.getByText(/p50 5\.00 s/)).toBeInTheDocument();
    expect(screen.getByText(/p95 12\.0 s/)).toBeInTheDocument();
  });

  test("marks a D-US3 wall-clock fallback series honestly (never hidden)", async () => {
    vi.mocked(getRunMetrics).mockResolvedValue(
      metricsResponse({
        series: [
          {
            measure: "p95DurationMs",
            group: "scn-1",
            capabilityClass: null,
            durationFallback: true,
            points: [{ bucketStart: "2026-07-08T00:00:00.000Z", value: 12_000, n: 2 }],
          },
        ],
      }),
    );
    renderStats({ interactiveOnly: true });
    expect(await screen.findByText(/p95 12\.0 s\*/)).toBeInTheDocument();
  });
});
