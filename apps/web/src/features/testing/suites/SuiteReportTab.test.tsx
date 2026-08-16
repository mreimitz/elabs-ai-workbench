import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SuiteReport } from "@mcp-token-footprint/shared";
import { CLAUDE_CLI_PROVIDER_ID } from "@mcp-token-footprint/shared";

// Auto-Rating WP 4.3 (AR7) — the suite console's cross-run report tab. Mock the api client (mirrors
// ReportTab.test.tsx's convention for the per-run Report tab).
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getSuiteReport: vi.fn(),
    regenerateSuiteReport: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { SuiteReportTab } from "./SuiteReportTab";

const TEST_NAME = new Map([["t1", "Answer accuracy"]]);

function makeReport(overrides: Partial<SuiteReport> = {}): SuiteReport {
  return {
    suiteRunId: "sr_1",
    testGroups: [
      {
        testId: "t1",
        runIds: ["run_1", "run_2"],
        score: { mean: 0.72, stdDev: 0.08 },
        costUsd: { mean: 0.0123, stdDev: 0.0041 },
        turns: { mean: 3.5, stdDev: 0.5 },
        toolPathVariance: 2,
        agreement: {
          summary: "2/2 runs conclude the missing `fields` param causes the failure.",
          agreeCount: 2,
          totalCount: 2,
          contradicts: false,
        },
      },
    ],
    errorClustering: [
      {
        label: "Failed tool call",
        description: "1 of 2 run(s) hit a failed_tool_call signal.",
        memberRunIds: ["run_1"],
        share: 0.5,
      },
    ],
    rootCauseRollup: [
      {
        bucket: "mcp_server",
        fixTarget: "mcp_server",
        draftFix: "server: accept the documented `limit` param on search_docs",
        frequency: 2,
        memberRunIds: ["run_1", "run_2"],
      },
    ],
    narrative: "Both runs agree on the root cause; the fix targets the MCP server.",
    judgeProvenance: { judgeProviderId: CLAUDE_CLI_PROVIDER_ID, judgeModel: "claude-sonnet-4-5" },
    ratingVersion: 1,
    generatedAt: "2026-07-11T00:00:00.000Z",
    skippedMembers: [],
    ...overrides,
  };
}

function renderTab(props: Partial<Parameters<typeof SuiteReportTab>[0]> = {}) {
  const onOpenRun = vi.fn();
  render(
    <SuiteReportTab
      suiteRunId="sr_1"
      isTerminal
      memberCount={2}
      testName={TEST_NAME}
      onOpenRun={onOpenRun}
      {...props}
    />,
  );
  return { onOpenRun };
}

beforeEach(() => {
  vi.mocked(api.getSuiteReport).mockReset();
  vi.mocked(api.regenerateSuiteReport).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SuiteReportTab", () => {
  test("renders consistency header, per-test-group variance, root-cause chips, error clustering + narrative", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(makeReport());
    const { onOpenRun } = renderTab();

    expect(api.getSuiteReport).toHaveBeenCalledWith("sr_1");

    // Consistency header.
    expect(await screen.findByText("Cross-run report")).toBeInTheDocument();
    expect(screen.getByText("1 test group")).toBeInTheDocument();
    expect(screen.getByText("1 agrees")).toBeInTheDocument();
    // D-MI5 (model-identity WP 2.3) — qualified "judge", never the "Anthropic CLI" run provider.
    expect(screen.getByText("Claude CLI judge (claude-sonnet-4-5)")).toBeInTheDocument();

    // Per-test-group row: resolved test name, agreement summary, variance readouts.
    expect(screen.getByText("Answer accuracy")).toBeInTheDocument();
    expect(screen.getByText(/2\/2 runs conclude the missing/)).toBeInTheDocument();
    expect(screen.getByText("0.72 ± 0.08")).toBeInTheDocument();

    // Root-cause roll-up: bucket + fix-target chips, frequency, a labeled draft-fix SUGGESTION.
    expect(screen.getByText("MCP server")).toBeInTheDocument();
    expect(screen.getByText("Fix in MCP server")).toBeInTheDocument();
    expect(screen.getByText("Representative suggested fix")).toBeInTheDocument();
    expect(screen.getByText(/accept the documented `limit` param/)).toBeInTheDocument();

    // Error clustering.
    expect(screen.getByText("Failed tool call")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();

    // Narrative.
    expect(screen.getByText(/Both runs agree on the root cause/)).toBeInTheDocument();

    // Owner feedback 2026-07-12 — every statistic carries a plain-language explainer: the column
    // legend under the test-group table + one muted line per roll-up/clustering section.
    expect(screen.getByText(/one judge call per test comparing/)).toBeInTheDocument();
    expect(screen.getByText(/population standard deviation/)).toBeInTheDocument();
    expect(screen.getByText(/distinct tool-call sequences across the runs/)).toBeInTheDocument();
    expect(screen.getByText(/deterministic, no extra judge call/)).toBeInTheDocument();
    expect(screen.getByText(/fraction of member runs that hit the category/)).toBeInTheDocument();
    // No baseline in this report → no baseline legend line.
    expect(screen.queryByText(/most recent earlier comparable suite run/)).not.toBeInTheDocument();

    // Run-id chips drill through to their own console (cited from BOTH the root-cause roll-up and the
    // error clustering table, so more than one "#run_1" chip is expected).
    const runChips = screen.getAllByRole("button", { name: /#run_1/ });
    expect(runChips.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(runChips[0]!);
    expect(onOpenRun).toHaveBeenCalledWith("run_1");
  });

  test("suite-report enrichment: partial-status badge, per-group findings bullets + the vs-previous-run delta line", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(
      makeReport({
        status: "partial",
        testGroups: [
          {
            testId: "t1",
            runIds: ["run_1", "run_2"],
            score: { mean: 0.72, stdDev: 0.08 },
            costUsd: { mean: 0.0123, stdDev: 0.0041 },
            turns: { mean: 3.5, stdDev: 0.5 },
            toolPathVariance: 2,
            agreement: {
              summary: "2/2 runs agree.",
              agreeCount: 2,
              totalCount: 2,
              contradicts: false,
            },
            findings: [
              "2 distinct tool-call paths for the same test",
              "1 run(s) hit Failed tool call",
            ],
          },
        ],
        baseline: {
          suiteRunId: "sr_0",
          generatedAt: "2026-07-10T00:00:00.000Z",
          perTest: [
            {
              testId: "t1",
              scoreMeanDelta: 0.2,
              costMeanDelta: -0.001,
              turnsMeanDelta: null,
              agreementFlipped: true,
            },
          ],
        },
      }),
    );
    renderTab();

    // The persisted row's status surfaces as a badge (only when partial/error).
    expect(await screen.findByText("Partial — some member ratings missing")).toBeInTheDocument();

    // Findings bullets render verbatim per test group.
    expect(screen.getByText("2 distinct tool-call paths for the same test")).toBeInTheDocument();
    expect(screen.getByText("1 run(s) hit Failed tool call")).toBeInTheDocument();

    // The compact "vs previous run" delta line: signed deltas, n/a for a null side, flip flagged.
    expect(
      screen.getByText(
        /vs previous run: Δ score \+0\.20 · Δ cost −\$0\.0010 · Δ turns n\/a · agreement flipped/,
      ),
    ).toBeInTheDocument();

    // A baseline-bearing report also explains WHAT it was compared against (legend line).
    expect(screen.getByText(/most recent earlier comparable suite run/)).toBeInTheDocument();
  });

  test("a ready report shows NO status badge (the badge is reserved for partial/error)", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(makeReport({ status: "ready" }));
    renderTab();
    expect(await screen.findByText("Cross-run report")).toBeInTheDocument();
    expect(screen.queryByText(/some member ratings missing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/report generation failed/)).not.toBeInTheDocument();
  });

  test("an error-status report shows the destructive status badge", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(makeReport({ status: "error" }));
    renderTab();
    expect(await screen.findByText("Error — report generation failed")).toBeInTheDocument();
  });

  test("a contradicting test group shows the destructive chip + the header's contradiction count", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(
      makeReport({
        testGroups: [
          {
            testId: "t1",
            runIds: ["run_1", "run_2"],
            score: { mean: 0.5, stdDev: 0.3 },
            costUsd: { mean: 0.01, stdDev: 0 },
            turns: { mean: 2, stdDev: 0 },
            toolPathVariance: 2,
            agreement: {
              summary: "Runs disagree on the cause.",
              agreeCount: 1,
              totalCount: 2,
              contradicts: true,
            },
          },
        ],
      }),
    );
    renderTab();
    expect(await screen.findByText("1 contradicts")).toBeInTheDocument();
    expect(screen.getByText(/Contradicts \(1\/2\)/)).toBeInTheDocument();
  });

  test("empty variance (zero graded members) reads 'n/a', never a forced 0", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(
      makeReport({
        testGroups: [
          {
            testId: "t1",
            runIds: ["run_1", "run_2"],
            score: { mean: null, stdDev: null },
            costUsd: { mean: null, stdDev: null },
            turns: { mean: null, stdDev: null },
            toolPathVariance: 1,
            agreement: { summary: "", agreeCount: 0, totalCount: 2, contradicts: false },
          },
        ],
      }),
    );
    renderTab();
    await screen.findByText("Answer accuracy");
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(3);
  });

  test("clean report (no root-cause findings, no error clusters, no narrative) renders honest empty states", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(
      makeReport({ rootCauseRollup: [], errorClustering: [], narrative: "" }),
    );
    renderTab();
    expect(await screen.findByText("Nothing to roll up")).toBeInTheDocument();
    expect(screen.getByText("No error clusters")).toBeInTheDocument();
    // An empty narrative reads as a muted line in the header — never a fake verdict.
    expect(screen.getByText(/No narrative composed yet/)).toBeInTheDocument();
  });

  test("insights-first: the narrative verdict LEADS the header, the static explainer is demoted below it", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(makeReport());
    renderTab();

    // The composed narrative renders inside the header card (the lead content of the tab)…
    const narrative = await screen.findByText(/Both runs agree on the root cause/);
    // …and precedes both the static "how this is built" explainer and the summary badge row.
    const explainer = screen.getByText(/Deterministic per-test-group variance/);
    const groupBadge = screen.getByText("1 test group");
    expect(
      narrative.compareDocumentPosition(explainer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      narrative.compareDocumentPosition(groupBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The old trailing Narrative card is gone — the narrative renders exactly once.
    expect(screen.getAllByText(/Both runs agree on the root cause/)).toHaveLength(1);
    expect(screen.queryByText("Narrative")).not.toBeInTheDocument();
  });

  test("no report yet + enough members → an empty state with a working Regenerate action", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(null);
    vi.mocked(api.regenerateSuiteReport).mockResolvedValue({ report: makeReport() });
    renderTab({ memberCount: 2 });

    expect(await screen.findByText("No cross-run report yet")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /regenerate/i });
    fireEvent.click(button);
    await waitFor(() => expect(api.regenerateSuiteReport).toHaveBeenCalledWith("sr_1"));
    expect(await screen.findByText("Cross-run report")).toBeInTheDocument();
  });

  test("no report yet + <2 members → an honest AR7 empty state with no Regenerate action", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(null);
    renderTab({ memberCount: 1 });
    expect(await screen.findByText("No cross-run report yet")).toBeInTheDocument();
    expect(screen.getByText(/at least 2 member runs/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  test("regenerate reporting insufficient_members shows the honest empty state (never a fake report)", async () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(null);
    vi.mocked(api.regenerateSuiteReport).mockResolvedValue({
      report: null,
      reason: "insufficient_members",
    });
    renderTab({ memberCount: 2 });

    const button = await screen.findByRole("button", { name: /regenerate/i });
    fireEvent.click(button);
    await waitFor(() => expect(api.regenerateSuiteReport).toHaveBeenCalledTimes(1));
    // Still the empty state — no fake report rendered.
    expect(screen.getByText("No cross-run report yet")).toBeInTheDocument();
  });

  test("shows a layout-shaped loading status while the report fetches (no content yet)", () => {
    vi.mocked(api.getSuiteReport).mockReturnValue(new Promise<SuiteReport | null>(() => {}));
    renderTab();
    expect(screen.getByRole("status")).toHaveTextContent(/loading suite report/i);
    expect(screen.queryByText("Cross-run report")).not.toBeInTheDocument();
  });

  test("error slot renders ONLY on a settled fetch failure, with a working retry", async () => {
    vi.mocked(api.getSuiteReport).mockRejectedValueOnce(new Error("boom"));
    renderTab();
    expect(await screen.findByText("Couldn’t load the suite report")).toBeInTheDocument();

    vi.mocked(api.getSuiteReport).mockResolvedValueOnce(makeReport());
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Cross-run report")).toBeInTheDocument();
  });

  test("post-terminal ONLY: a still-running suite run shows 'Report pending' and never fetches", () => {
    vi.mocked(api.getSuiteReport).mockResolvedValue(makeReport());
    renderTab({ isTerminal: false });
    expect(screen.getByText("Report pending")).toBeInTheDocument();
    expect(api.getSuiteReport).not.toHaveBeenCalled();
    expect(screen.queryByText("Couldn’t load the suite report")).not.toBeInTheDocument();
    expect(screen.queryByText(/loading suite report/i)).not.toBeInTheDocument();
  });
});
