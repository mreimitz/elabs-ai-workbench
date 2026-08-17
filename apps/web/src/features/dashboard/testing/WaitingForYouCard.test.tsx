import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RunSummary } from "@mcp-token-footprint/shared";

// `MetricCard` is a real `@elabs-ai/components-charts` export, but importing ANYTHING from that package's barrel
// under Vitest/jsdom resolves a broken deep `@visx/gradient` subpath used by its (unrelated, unused
// here) Gantt chart — a pre-existing, environment-only issue (see `ScansTab.test.tsx`'s longer note;
// `DashboardView.test.tsx`/`TestingTab.test.tsx` mock around the same class of issue). A thin
// pass-through keeps this test's assertions on label/value/description/link intact.
vi.mock("@elabs-ai/components-charts", () => ({
  MetricCard: ({ label, value, description }: { label: string; value: string; description?: string }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
      {description ? <span>{description}</span> : null}
    </div>
  ),
}));

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, queryRunsFiltered: vi.fn() };
});

import { queryRunsFiltered } from "../../../lib/api";
import { RUN_VIEW_PRESETS, WAITING_FOR_YOU_FILTER } from "../../testing/runs/run-filter-url";
import { WaitingForYouCard } from "./WaitingForYouCard";

function run(id: string, over: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "interactive",
    status: "running",
    phase: "waiting_input",
    startedAt: "2026-07-16T00:00:00.000Z",
    turns: 2,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(queryRunsFiltered).mockReset();
});

function renderCard() {
  return render(
    <MemoryRouter>
      <WaitingForYouCard />
    </MemoryRouter>,
  );
}

describe("WaitingForYouCard — counts match the lens filter (WP 2.4 acceptance #2)", () => {
  test("queries the EXACT SAME RunFilter the 'Waiting for you' lens preset applies", async () => {
    vi.mocked(queryRunsFiltered).mockResolvedValue([]);
    renderCard();
    await waitFor(() => expect(queryRunsFiltered).toHaveBeenCalledWith(WAITING_FOR_YOU_FILTER));
    // Byte-identical to the preset's own filter object, not a hand-duplicated copy that could drift.
    const preset = RUN_VIEW_PRESETS.find((p) => p.id === "preset:waiting-for-you");
    expect(WAITING_FOR_YOU_FILTER).toEqual(preset?.filter);
  });

  test("renders the fetched count", async () => {
    vi.mocked(queryRunsFiltered).mockResolvedValue([run("r-1"), run("r-2"), run("r-3")]);
    renderCard();
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("sessions paused for your input")).toBeInTheDocument();
  });

  test("a zero count still renders (calm, informative — never hidden at zero)", async () => {
    vi.mocked(queryRunsFiltered).mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText("0")).toBeInTheDocument();
    expect(screen.getByText("sessions paused for your input")).toBeInTheDocument();
  });

  test("a fetch failure hides the card (best-effort, never a dashboard-blocking error)", async () => {
    vi.mocked(queryRunsFiltered).mockRejectedValue(new Error("network down"));
    const { container } = renderCard();
    await waitFor(() => expect(queryRunsFiltered).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test("deep-links to the runs feed with the waiting-for-you filter", async () => {
    vi.mocked(queryRunsFiltered).mockResolvedValue([run("r-1")]);
    renderCard();
    const link = await screen.findByRole("link", { name: /waiting for you/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("/testing/runs?filter="));
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain('"phase":["waiting_input"]');
  });
});
