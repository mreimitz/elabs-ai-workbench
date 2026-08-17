import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  RatingIssue,
  RunReport as RunRatingReport,
  RunGrade,
  RunStep,
} from "@mcp-token-footprint/shared";
import { CLAUDE_CLI_PROVIDER_ID } from "@mcp-token-footprint/shared";

// Auto-Rating WP 3.1 — the Report tab consumes the SHARED composed RunReport via the NEW
// `getRunRatingReport` (GET /api/runs/:id/report), NOT the analytics `getRunReport`. Mock the api
// client — including `getRunGrades`, which the tab fetches alongside the report for the judges' own
// written reasoning (supplementary; a failure only omits the reasoning collapsibles).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRunRatingReport: vi.fn(),
    getRunGrades: vi.fn(),
    regradeRun: vi.fn(),
    listIssuesForRun: vi.fn(),
    listRunFeedback: vi.fn(),
  };
});

// The donut/radar module pulls `@elabs-ai/components-charts` (visx), which jsdom can't load — stubbed to sentinels
// (the ContextChart convention) so their mount/absence stays directly assertable.
vi.mock("./report-charts", () => ({
  ScoreDonut: ({ score, label }: { score: number; label: string }) => (
    <div data-testid="score-donut" data-label={label} data-score={score} />
  ),
  ScoreRadar: ({ axes }: { axes: unknown[] }) => (
    <div data-testid="score-radar" data-axes={axes.length} />
  ),
}));

import { TooltipProvider } from "@elabs-ai/components-ui";
import * as api from "../../lib/api";
import { ReportTab } from "./ReportTab";

// A finished run's steps — the report resolves cited/evidence step idxs against these. Step #2 is a
// turn-bearing llm_response (→ a `turn` nav ref); step #4 is a tool_call carrying a toolCallId (→ a
// `tool` nav ref). Minimal but type-complete.
const STEPS: RunStep[] = [
  {
    id: "s2",
    runId: "run_1",
    index: 2,
    type: "llm_response",
    label: "assistant",
    status: "ok",
    profileTokens: {},
    turnIndex: 1,
    payload: {},
  },
  {
    id: "s4",
    runId: "run_1",
    index: 4,
    type: "tool_call",
    label: "acme_get_app",
    status: "error",
    profileTokens: {},
    turnIndex: 1,
    payload: { toolCallId: "call_abc" },
  },
];

const OUTCOME_GRADE: RunGrade = {
  id: "g1",
  runId: "run_1",
  graderId: "outcome_judge",
  kind: "llm",
  status: "graded",
  score: 0.8,
  rawScore: 8,
  method: "single_sample",
  reasoning: "Reached the goal.",
  evidence: null,
  judgeProviderId: "prov_1",
  judgeModel: "gpt-4o",
  judgeTokensIn: 10,
  judgeTokensOut: 5,
  judgeCostUsd: 0.01,
  gradingVersion: 1,
  createdAt: "2026-07-11T00:00:00Z",
};

function makeReport(overrides: Partial<RunRatingReport> = {}): RunRatingReport {
  return {
    runId: "run_1",
    status: "completed",
    outcome: "completed",
    baseRating: {
      answerValidation: {
        verdict: "answered",
        score: 0.92,
        quotes: ["The app has 5 sheets."],
        citedSteps: [2],
      },
      insightSurplus: {
        verdict: "noise",
        score: 0.3,
        quotes: ["Also, here is unrelated market trivia."],
        citedSteps: [],
        surplusTokens: 1234,
      },
      errorForensics: [
        {
          id: "f1",
          description: "search_docs rejected its own documented limit param",
          category: "failed_tool_call",
          bucket: "mcp_server",
          fixTarget: "mcp_server",
          draftFix: "server: accept the documented `limit` param on search_docs",
          toolName: "search_docs",
          sentArguments: '{"limit":"ten"}',
          errorMessage: "limit must be an integer",
          evidenceSteps: [4],
          evidenceEventIds: ["ev_9"],
        },
      ],
    },
    expectationGrades: [OUTCOME_GRADE],
    assertionResults: [],
    kpis: {
      turns: 3,
      toolCalls: 2,
      peakContextTokens: 1000,
      tokensIn: 500,
      tokensOut: 200,
      costUsd: 0.02,
      durationMs: 1500,
    },
    judgeProvenance: { judgeProviderId: CLAUDE_CLI_PROVIDER_ID, judgeModel: "claude-sonnet-4-5" },
    ratingVersion: 1,
    generatedAt: "2026-07-11T00:00:00Z",
    ...overrides,
  };
}

/** The `answer_validation` base grader's own grade row — carries the judge's written reasoning. */
const ANSWER_VALIDATION_GRADE: RunGrade = {
  ...OUTCOME_GRADE,
  id: "g2",
  graderId: "answer_validation",
  reasoning: "The answer names all 5 sheets explicitly.",
};

function renderTab(props: Partial<Parameters<typeof ReportTab>[0]> = {}) {
  const onNavigate = vi.fn();
  render(
    // The expectation-grade chips carry explanatory Radix Tooltips, which read from a
    // `TooltipProvider` (mounted at the app root in production — main.tsx).
    <TooltipProvider>
      <MemoryRouter>
        <ReportTab runId="run_1" steps={STEPS} terminal onNavigate={onNavigate} {...props} />
      </MemoryRouter>
    </TooltipProvider>,
  );
  return { onNavigate };
}

/** One registry issue this run contributed to — minimal but type-complete. */
function makeIssue(overrides: Partial<RatingIssue> = {}): RatingIssue {
  return {
    id: "iss_1",
    targetKind: "mcp_server",
    targetId: "srv_1",
    targetName: "docs-server",
    title: "search_docs rejects its documented limit param",
    summary: "The tool advertises `limit` but errors when it is provided.",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "server: accept the documented `limit` param on search_docs",
    severity: "high",
    status: "open",
    timesSeen: 3,
    firstSeenAt: "2026-07-10T00:00:00Z",
    lastSeenAt: "2026-07-11T00:00:00Z",
    ratingVersion: 1,
    judgeProviderId: null,
    judgeModel: null,
    occurrences: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.getRunRatingReport).mockReset();
  vi.mocked(api.regradeRun).mockReset();
  // The supplementary issues section fetches on every report render — default to "none filed".
  vi.mocked(api.listIssuesForRun).mockReset();
  vi.mocked(api.listIssuesForRun).mockResolvedValue([]);
  // The supplementary judge-reasoning fetch — default to "no grade rows" (collapsibles absent).
  vi.mocked(api.getRunGrades).mockReset();
  vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [] });
  // WP 2.5 — the "Your feedback" line's supplementary fetch; default to "no feedback yet" (absent).
  vi.mocked(api.listRunFeedback).mockReset();
  vi.mocked(api.listRunFeedback).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReportTab", () => {
  test("renders the verdict header, base-rating cards, forensics + provenance from the SHARED report", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    renderTab();

    // Verdict header — answer + surplus verdicts + error-finding count. Each verdict shows in BOTH the
    // summary chip row and its detail card header, so match all.
    expect((await screen.findAllByText("Answered")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Noise").length).toBeGreaterThan(0);
    expect(screen.getByText("1 error finding")).toBeInTheDocument();

    // It fetched the NEW composed-report endpoint, not the analytics export.
    expect(api.getRunRatingReport).toHaveBeenCalledWith("run_1");

    // Surplus noise names its token cost.
    expect(screen.getByText("1,234 tokens")).toBeInTheDocument();

    // Forensics row: bucket chip + fixTarget chip + a clearly-labeled draft-fix SUGGESTION.
    expect(screen.getByText("MCP server")).toBeInTheDocument();
    expect(screen.getByText("Fix in MCP server")).toBeInTheDocument();
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    expect(screen.getByText(/accept the documented `limit` param/)).toBeInTheDocument();

    // The CONCRETE failure evidence — the actual wrong call + the exact error, shown verbatim.
    expect(screen.getByText(/Sent parameters · search_docs/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("Arguments actually sent on the failing tool call"),
    ).toHaveTextContent('{"limit":"ten"}');
    expect(screen.getByLabelText("Exact error returned")).toHaveTextContent(
      "limit must be an integer",
    );

    // Provenance — the Claude CLI judge with its model. D-MI5 (model-identity WP 2.3): the label is
    // qualified with "judge" so it never reads as the "Anthropic CLI" RUN provider (`claude_subscription`).
    expect(screen.getByText("Claude CLI judge (claude-sonnet-4-5)")).toBeInTheDocument();

    // Expectation grades (the SEPARATE dimension, AR6) render in their own card via the existing GradeChip.
    expect(screen.getByText("Expectation grades")).toBeInTheDocument();
  });

  test("WP 2.5 — 'Your feedback' renders RENDER-ONLY from the feedback API, separate from Rated by", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.listRunFeedback).mockResolvedValue([
      {
        id: "fb1",
        runId: "run_1",
        key: "verdict",
        score: 1,
        comment: "Nailed the sheet count.",
        source: "human",
        createdAt: "2026-07-16T00:00:00Z",
      },
    ]);
    renderTab();

    expect(await screen.findByText("Your feedback:")).toBeInTheDocument();
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
    expect(screen.getByText("“Nailed the sheet count.”")).toBeInTheDocument();
    // Never conflated with the judge "Rated by" line — both render, distinctly labeled.
    expect(screen.getByText("Rated by:")).toBeInTheDocument();
    expect(api.listRunFeedback).toHaveBeenCalledWith("run_1");
  });

  test("'Your feedback' renders nothing when the run carries no human feedback yet", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.listRunFeedback).mockResolvedValue([]);
    renderTab();

    await screen.findByText("Rated by:");
    expect(screen.queryByText("Your feedback:")).not.toBeInTheDocument();
  });

  test("cited/evidence step deep-links call onNavigate with a resolved nav ref", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    const { onNavigate } = renderTab();

    // The answer card cites step idx 2 (a turn) → rendered as "#3", reveal it in Chat. (A button's
    // accessible name is its text content, so match the "#N" label; the title carries the pane hint.)
    const answerLink = await screen.findByRole("button", { name: "#3" });
    expect(answerLink).toHaveAttribute(
      "title",
      expect.stringMatching(/reveal step #3 in the chat/i),
    );
    fireEvent.click(answerLink);
    expect(onNavigate).toHaveBeenCalledWith("chat", { kind: "turn", turnIndex: 1 });

    // The forensics finding cites step idx 4 (a tool call) → rendered as "#5", reveal it in the Trace.
    const traceLink = screen.getByRole("button", { name: "#5" });
    expect(traceLink).toHaveAttribute(
      "title",
      expect.stringMatching(/reveal step #5 in the trace/i),
    );
    fireEvent.click(traceLink);
    expect(onNavigate).toHaveBeenCalledWith("trace", {
      kind: "tool",
      toolCallId: "call_abc",
      turnIndex: 1,
    });
  });

  test("empty forensics renders the 'no errors detected' empty state", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(
      makeReport({
        baseRating: {
          answerValidation: { verdict: "answered", score: 1, quotes: [], citedSteps: [] },
          insightSurplus: { verdict: "none", score: null, quotes: [], citedSteps: [] },
          errorForensics: [],
        },
      }),
    );
    renderTab();
    expect(await screen.findByText("No errors detected")).toBeInTheDocument();
    expect(screen.getByText("No error findings")).toBeInTheDocument();
  });

  test("null provenance reads 'Not rated by a judge'", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(
      makeReport({ judgeProvenance: { judgeProviderId: null, judgeModel: null } }),
    );
    renderTab();
    expect(await screen.findByText("Not rated by a judge")).toBeInTheDocument();
  });

  test("a provider-credential judge reads as the provider judge", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(
      makeReport({ judgeProvenance: { judgeProviderId: "prov_42", judgeModel: "gpt-4o" } }),
    );
    renderTab();
    expect(await screen.findByText("Provider judge (gpt-4o)")).toBeInTheDocument();
  });

  test("shows a layout-shaped loading status while the report fetches (no content yet)", () => {
    // A never-resolving fetch keeps the tab in its loading state (the supplementary grades fetch
    // is held open too, so no state update lands outside the assertion window).
    vi.mocked(api.getRunRatingReport).mockReturnValue(new Promise<RunRatingReport>(() => {}));
    vi.mocked(api.getRunGrades).mockReturnValue(
      new Promise<{ grades: RunGrade[]; latest: RunGrade[] }>(() => {}),
    );
    renderTab();
    expect(screen.getByRole("status")).toHaveTextContent(/loading run report/i);
    // No verdict content yet.
    expect(screen.queryByText("Answered")).not.toBeInTheDocument();
  });

  test("error slot renders ONLY on a settled fetch failure", async () => {
    vi.mocked(api.getRunRatingReport).mockRejectedValue(new Error("boom"));
    renderTab();
    expect(await screen.findByText("Couldn’t load the run report")).toBeInTheDocument();
  });

  test("post-terminal ONLY: a still-live run shows 'Rating pending' and never fetches", () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    renderTab({ terminal: false });
    expect(screen.getByText("Rating pending")).toBeInTheDocument();
    expect(api.getRunRatingReport).not.toHaveBeenCalled();
    expect(api.getRunGrades).not.toHaveBeenCalled();
    // Not an error, not a loading skeleton.
    expect(screen.queryByText("Couldn’t load the run report")).not.toBeInTheDocument();
    expect(screen.queryByText(/loading run report/i)).not.toBeInTheDocument();
  });

  test("AR11 — terminal + unsettled rating shows 'Rating in progress…' and defers the fetch", () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    renderTab({ ratingState: "rating" });
    expect(screen.getByText("Rating in progress…")).toBeInTheDocument();
    expect(api.getRunRatingReport).not.toHaveBeenCalled();
    // Active, not passive: this is NOT the still-live "Rating pending" panel.
    expect(screen.queryByText("Rating pending")).not.toBeInTheDocument();
  });

  test("AR11 — a settled rating fetches immediately (the auto-refetch target state)", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    renderTab({ ratingState: "rated" });
    expect((await screen.findAllByText("Answered")).length).toBeGreaterThan(0);
    expect(api.getRunRatingReport).toHaveBeenCalledWith("run_1");
  });

  test("an outcome_judge grade row gets its own report-body card: score, status, reasoning, donut", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [OUTCOME_GRADE] });
    renderTab();

    // The card header carries the grader's full label + its honest status chip.
    expect(await screen.findByText("Outcome judge")).toBeInTheDocument();
    expect(screen.getByText("Graded")).toBeInTheDocument();
    // The judge's written reasoning renders VERBATIM in the body (not only in the right rail).
    expect(screen.getByText("Reached the goal.")).toBeInTheDocument();
    // The graded score carries its threshold-toned donut (sentinel from the report-charts stub).
    expect(
      screen
        .getAllByTestId("score-donut")
        .some((node) => node.getAttribute("data-label") === "Judge"),
    ).toBe(true);
  });

  test("score donuts render beside the answer/surplus cards; the radar needs ≥3 graded axes", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    // Three graded rows (answer_validation + insight_surplus + outcome_judge) → the radar draws.
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [
        OUTCOME_GRADE,
        { ...OUTCOME_GRADE, id: "g_av", graderId: "answer_validation", score: 0.92 },
        { ...OUTCOME_GRADE, id: "g_is", graderId: "insight_surplus", score: 0.3 },
      ],
    });
    renderTab();

    await screen.findAllByText("Answered");
    // Answer (0.92) + Surplus (0.3) donuts, plus the judge card's own.
    await waitFor(() => expect(screen.getAllByTestId("score-donut").length).toBeGreaterThan(1));
    expect(await screen.findByTestId("score-radar")).toHaveAttribute("data-axes", "3");
  });

  test("fewer than 3 graded axes draws NO radar (the chip row alone tells the story)", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [OUTCOME_GRADE] });
    renderTab();
    await screen.findAllByText("Answered");
    await waitFor(() => expect(api.getRunGrades).toHaveBeenCalled());
    expect(screen.queryByTestId("score-radar")).not.toBeInTheDocument();
  });

  test("Re-rate reuses regradeRun and refetches the report", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.regradeRun).mockResolvedValue({ inserted: [] });
    renderTab();

    await screen.findAllByText("Answered");
    expect(api.getRunRatingReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /re-rate/i }));
    await waitFor(() => expect(api.regradeRun).toHaveBeenCalledWith("run_1"));
    // The refetch fires after the regrade settles.
    await waitFor(() => expect(api.getRunRatingReport).toHaveBeenCalledTimes(2));
  });

  test("base-rating cards explain their scores and expose the judge's own reasoning", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [ANSWER_VALIDATION_GRADE],
    });
    renderTab();

    // Owner feedback 2026-07-12 — every score says what it means + how it was computed.
    expect(await screen.findByText(/Score 0–1 from the rating judge/)).toBeInTheDocument();
    expect(screen.getByText(/valuable grounded surplus raises the score/)).toBeInTheDocument();
    expect(
      screen.getByText(/deterministic inventory of everything that went wrong/i),
    ).toBeInTheDocument();
    // Chip guidance in the expectation-grades card.
    expect(screen.getByText(/hover a chip for what the grader/i)).toBeInTheDocument();

    // The judge's own reasoning (from the grades fetch) opens in a collapsible — only the
    // `answer_validation` row carries one here, so exactly one trigger renders.
    expect(api.getRunGrades).toHaveBeenCalledWith("run_1");
    const trigger = await screen.findByRole("button", { name: /judge reasoning/i });
    fireEvent.click(trigger);
    expect(
      await screen.findByText("The answer names all 5 sheets explicitly."),
    ).toBeInTheDocument();
  });

  test("a grades fetch failure only omits the reasoning collapsibles — the report is untouched", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.getRunGrades).mockRejectedValue(new Error("boom"));
    renderTab();

    expect((await screen.findAllByText("Answered")).length).toBeGreaterThan(0);
    expect(screen.getByText("Expectation grades")).toBeInTheDocument();
    await waitFor(() => expect(api.getRunGrades).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /judge reasoning/i })).not.toBeInTheDocument();
  });

  test("issues filed by this run render between forensics and expectation grades, linking to the targets", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.listIssuesForRun).mockResolvedValue([
      makeIssue(),
      makeIssue({
        id: "iss_2",
        targetKind: "skill",
        targetId: "skill_9",
        targetName: "acme-analysis",
        title: "SKILL.md promises a tool the scenario never exposes",
        severity: "medium",
        status: "resolved",
        timesSeen: 1,
      }),
    ]);
    renderTab();

    expect(await screen.findByText("Issues filed by this run")).toBeInTheDocument();
    expect(api.listIssuesForRun).toHaveBeenCalledWith("run_1");

    // Status + severity chips.
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();

    // Target labels + dedup counts.
    expect(screen.getByText("MCP server · docs-server")).toBeInTheDocument();
    expect(screen.getByText("skill · acme-analysis")).toBeInTheDocument();
    expect(screen.getByText("seen 3×")).toBeInTheDocument();
    expect(screen.getByText("seen 1×")).toBeInTheDocument();

    // Titles link to the target detail routes (their Issues tab lives there).
    const serverLink = screen.getByRole("link", { name: /rejects its documented limit/ });
    expect(serverLink).toHaveAttribute("href", "/servers/srv_1");
    const skillLink = screen.getByRole("link", { name: /promises a tool the scenario/ });
    expect(skillLink).toHaveAttribute("href", "/skills/skill_9");

    // Insights-first order: the section sits AFTER the forensics list and BEFORE the grades.
    const forensics = screen.getByText("Error forensics");
    const section = screen.getByText("Issues filed by this run");
    const grades = screen.getByText("Expectation grades");
    expect(
      forensics.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(section.compareDocumentPosition(grades) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("no issues filed → the section renders NOTHING (no empty-state noise inside the report)", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.listIssuesForRun).mockResolvedValue([]);
    renderTab();

    await screen.findAllByText("Answered");
    await waitFor(() => expect(api.listIssuesForRun).toHaveBeenCalledWith("run_1"));
    expect(screen.queryByText("Issues filed by this run")).not.toBeInTheDocument();
  });

  test("an issues fetch failure silently omits the section — the report itself is untouched", async () => {
    vi.mocked(api.getRunRatingReport).mockResolvedValue(makeReport());
    vi.mocked(api.listIssuesForRun).mockRejectedValue(new Error("boom"));
    renderTab();

    // The report still renders fully.
    expect((await screen.findAllByText("Answered")).length).toBeGreaterThan(0);
    expect(screen.getByText("Expectation grades")).toBeInTheDocument();
    // The supplementary section is simply absent — no error surface of its own.
    await waitFor(() => expect(api.listIssuesForRun).toHaveBeenCalled());
    expect(screen.queryByText("Issues filed by this run")).not.toBeInTheDocument();
  });
});
