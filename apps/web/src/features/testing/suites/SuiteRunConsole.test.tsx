import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Suite, SuiteRun } from "@mcp-token-footprint/shared";

// The console's three data hooks are mocked to inert, settled-empty state — this test locks the TAB
// STRIP (order + default), not the streaming/data behavior (each tab's own component has its tests).
vi.mock("./use-suite-stream", () => ({
  useSuiteStream: () => ({
    status: null,
    ratingState: null,
    aggregates: null,
    cells: {},
    error: null,
  }),
  // derive-cells imports the REAL cellKey from this module — keep it callable under the mock.
  cellKey: (cell: {
    testId: string;
    scenarioId: string;
    variantLabel?: string;
    repetition: number;
  }) => `${cell.testId}${cell.scenarioId}${cell.variantLabel ?? ""}${cell.repetition}`,
}));
vi.mock("./use-suite-members", () => ({
  useSuiteMembers: () => ({
    members: [],
    scoreById: new Map(),
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("./use-suite-analytics", () => ({
  useSuiteAnalytics: () => ({ analytics: null, loading: false, error: null, reload: vi.fn() }),
}));
// Heavy analytics children pull `@brand/charts` (visx) at module load — neutralized so importing the
// console doesn't drag the chart bundle into jsdom (mirrors RunConsole.test.tsx's convention). They
// never render here anyway (their tabs are inactive; analytics is null).
vi.mock("./SuiteScatter", () => ({ SuiteScatter: () => <div /> }));
vi.mock("./SuiteBreakdowns", () => ({ SuiteBreakdowns: () => <div /> }));

import { SuiteRunConsole, suiteHeaderTone, suiteStatusBadge } from "./SuiteRunConsole";

// jsdom omits matchMedia/ResizeObserver — Radix (Tabs/ScrollArea/DropdownMenu) reads them (mirrors
// EnvironmentEditor.test.tsx).
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const SUITE: Suite = {
  id: "suite_1",
  name: "Nightly bench",
  config: { repetitions: 1, maxConcurrency: 1 },
  testIds: [],
  scenarioIds: [],
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const SUITE_RUN: SuiteRun = {
  id: "sr_1",
  suiteId: "suite_1",
  status: "completed",
  configSnapshot: { repetitions: 1, maxConcurrency: 1 },
  startedAt: "2026-07-11T00:00:00.000Z",
  endedAt: "2026-07-11T00:05:00.000Z",
};

function renderConsole(suiteRun: SuiteRun = SUITE_RUN) {
  render(
    <MemoryRouter>
      <SuiteRunConsole
        suiteRunId="sr_1"
        suite={SUITE}
        suiteRun={suiteRun}
        tests={[]}
        scenarios={[]}
        providers={[]}
        onBack={vi.fn()}
        onOpenRun={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("SuiteRunConsole tab strip", () => {
  test("insights-first tab order: Report sits directly after Runs, before the statistics tabs", () => {
    renderConsole();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual([
      "Runs",
      "Report",
      "Matrix",
      "Breakdowns",
      "Quality × cost",
      "Failure buckets",
    ]);
  });

  test("the strip is the shared TabPanel — text-only triggers, no per-tab icons (owner feedback)", () => {
    renderConsole();
    for (const tab of screen.getAllByRole("tab")) {
      // No lucide glyphs inside a trigger — the suite console uses the same text-only tab shell as
      // the run console and every detail page (components/TabPanel.tsx).
      expect(tab.querySelector("svg")).toBeNull();
    }
  });

  test("Runs stays the DEFAULT tab for a finished run (Report is early, not default)", () => {
    renderConsole();
    expect(screen.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Report" })).toHaveAttribute("aria-selected", "false");
  });

  test("AR11 — a reviewing suite run spins its Report tab label and reads Reviewing… in the header", () => {
    renderConsole({ ...SUITE_RUN, ratingState: "rating" });
    expect(screen.getByText("Reviewing…")).toBeInTheDocument();
    // The Report trigger carries the in-flight spinner (the one sanctioned tab-label glyph).
    const report = screen.getByRole("tab", { name: /report/i });
    expect(report.querySelector("svg")).not.toBeNull();
  });

  test("a skill-effect (variant) suite run appends its Skill effect tab at the end", () => {
    renderConsole({
      ...SUITE_RUN,
      configSnapshot: {
        repetitions: 1,
        maxConcurrency: 1,
        variants: [{ label: "with-skill", scenarioId: "sc_1", skillOverrides: {} }],
      },
    });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual([
      "Runs",
      "Report",
      "Matrix",
      "Breakdowns",
      "Quality × cost",
      "Failure buckets",
      "Skill effect",
    ]);
  });
});

describe("suiteStatusBadge — review-aware suite chip (AR11)", () => {
  test("terminal + pending/rating → Reviewing… (blue spinner status)", () => {
    expect(suiteStatusBadge("completed", "rating")).toEqual({
      status: "running",
      label: "Reviewing…",
    });
    expect(suiteStatusBadge("capped", "pending")).toEqual({
      status: "running",
      label: "Reviewing…",
    });
  });

  test("settled/absent ratings render today's suite view — a FAILED review stays non-red", () => {
    expect(suiteStatusBadge("completed", "failed")).toEqual({
      status: "complete",
      label: "Completed",
    });
    expect(suiteStatusBadge("completed")).toEqual({ status: "complete", label: "Completed" });
    expect(suiteStatusBadge("capped", "rated")).toEqual({ status: "denied", label: "Cost-capped" });
  });

  test("a LIVE suite run stays Running, never Reviewing", () => {
    expect(suiteStatusBadge("running", "pending")).toEqual({
      status: "running",
      label: "Running",
    });
  });
});

// T10 ("numbers that do not reconcile") — a green "Completed" chip must not sit above a KPI rail
// reading "Pass rate 0.0%" (the critique's exact complaint): the header chip's TONE now reflects the
// graded OUTCOME once the suite has one, separate from the execution-state LABEL.
describe("suiteHeaderTone — tone by OUTCOME, not execution state (T10)", () => {
  test("a completed run with NO grades yet stays green — nothing to contradict", () => {
    expect(suiteHeaderTone("complete", null)).toBe("success");
  });

  test("a completed run with a poor pass rate (< 0.6) tones DANGER, not green", () => {
    expect(suiteHeaderTone("complete", 0)).toBe("danger");
    expect(suiteHeaderTone("complete", 0.3)).toBe("danger");
  });

  test("a completed run with a middling pass rate (0.6–<0.8) tones WARNING", () => {
    expect(suiteHeaderTone("complete", 0.7)).toBe("warning");
  });

  test("a completed run with a strong pass rate (>= 0.8) stays green", () => {
    expect(suiteHeaderTone("complete", 0.9)).toBe("success");
  });

  test("every non-'complete' status passes through the ordinary execution-state tone unchanged", () => {
    expect(suiteHeaderTone("running", 0)).toBe("info");
    expect(suiteHeaderTone("pending", 0)).toBe("pending");
    expect(suiteHeaderTone("failed", 0.9)).toBe("danger");
    expect(suiteHeaderTone("denied", 0)).toBe("warning");
    expect(suiteHeaderTone("skipped", 0)).toBe("neutral");
  });
});

describe("SuiteRunConsole — the header chip actually renders the outcome-aware tone (T10)", () => {
  test("a completed run with a 0% pass rate renders its chip with the DANGER tone, not success", () => {
    renderConsole({
      ...SUITE_RUN,
      status: "completed",
      aggregates: {
        cellsTotal: 2,
        cellsCompleted: 2,
        meanGrade: 0.1,
        gradeStdDev: 0,
        passRateAt05: 0,
        totalTokens: 100,
        execCostUsd: 0,
        judgeCostUsd: 0,
      },
    });
    const chip = screen.getByText("Completed");
    expect(chip.closest("[data-status]")).toHaveAttribute("data-status", "danger");
  });

  test("a completed run with NO aggregates yet still renders the plain green 'Completed' chip", () => {
    renderConsole({ ...SUITE_RUN, status: "completed", aggregates: undefined });
    const chip = screen.getByText("Completed");
    expect(chip.closest("[data-status]")).toHaveAttribute("data-status", "success");
  });
});
