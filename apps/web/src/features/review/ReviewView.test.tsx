import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReviewRubric, RunDetail, RunFeedback, RunSummary } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listReviewRubrics: vi.fn(),
    queryRunsFiltered: vi.fn(),
    getRun: vi.fn(),
    listRunFeedback: vi.fn(),
    putRunFeedback: vi.fn(),
    listTests: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
  };
});

import {
  getRun,
  listReviewRubrics,
  listRunFeedback,
  putRunFeedback,
  queryRunsFiltered,
} from "../../lib/api";
import { ReviewView } from "./ReviewView";

const mockListRubrics = vi.mocked(listReviewRubrics);
const mockQueryRuns = vi.mocked(queryRunsFiltered);
const mockGetRun = vi.mocked(getRun);
const mockListFeedback = vi.mocked(listRunFeedback);
const mockPutFeedback = vi.mocked(putRunFeedback);

const THUMBS_RUBRIC: ReviewRubric = {
  id: "rub-1",
  name: "Quick verdict",
  keys: [{ key: "helpful", kind: "thumbs" }],
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

const TWO_KEY_RUBRIC: ReviewRubric = {
  id: "rub-2",
  name: "Two questions",
  keys: [
    { key: "helpful", kind: "thumbs" },
    { key: "notes", kind: "note" },
  ],
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

function fixtureRun(id: string): RunSummary {
  return {
    id,
    testId: `test-${id}`,
    scenarioId: `scn-${id}`,
    mode: "automated",
    status: "completed",
    startedAt: "2026-07-16T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 100,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
  } as RunSummary;
}

function fixtureDetail(id: string): RunDetail {
  return { ...fixtureRun(id), steps: [], events: [], skills: [] } as RunDetail;
}

let feedbackSeq = 0;
function renderView(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TooltipProvider>
        <ReviewView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** Reflects the current route's search string, so `runIndex` persistence is observable (mirrors the
 *  identical `LocationProbe` pattern in `features/testing/RunsView.test.tsx`). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderViewWithLocationProbe(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TooltipProvider>
        <LocationProbe />
        <ReviewView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  feedbackSeq = 0;
  mockListRubrics.mockReset();
  mockQueryRuns.mockReset();
  mockGetRun.mockReset();
  mockListFeedback.mockReset();
  mockPutFeedback.mockReset();

  mockGetRun.mockImplementation((id: string) => Promise.resolve(fixtureDetail(id)));
  mockListFeedback.mockResolvedValue([]);
  mockPutFeedback.mockImplementation((runId: string, input) => {
    feedbackSeq += 1;
    const saved: RunFeedback = {
      id: `fb-${feedbackSeq}`,
      runId,
      key: input.key ?? "verdict",
      source: "human",
      createdAt: "2026-07-17T00:00:00.000Z",
      ...(input.score !== undefined ? { score: input.score } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    };
    return Promise.resolve(saved);
  });
});

describe("ReviewView — keyboard-only completion (acceptance #2)", () => {
  test("pressing the thumbs-up digit on each run's focused key completes a 3-run queue via the keyboard alone", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2"), fixtureRun("run-3")]);

    renderView("/testing/runs/review?rubricId=rub-1");

    expect(await screen.findByText("Run 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("0/3 reviewed")).toBeInTheDocument();

    // Run 1 — digit "1" on the (only, auto-focused) thumbs key commits AND advances (no mouse used).
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(mockPutFeedback).toHaveBeenNthCalledWith(1, "run-1", { key: "helpful", score: 1 }));
    await screen.findByText("Run 2 of 3");

    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(mockPutFeedback).toHaveBeenNthCalledWith(2, "run-2", { key: "helpful", score: 1 }));
    await screen.findByText("Run 3 of 3");

    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(mockPutFeedback).toHaveBeenNthCalledWith(3, "run-3", { key: "helpful", score: 1 }));

    // The last run has no further run to advance to — the queue clamps in place.
    await screen.findByText("Run 3 of 3");
    await waitFor(() => expect(screen.getByText("3/3 reviewed")).toBeInTheDocument());
    expect(mockPutFeedback).toHaveBeenCalledTimes(3);
  });

  test("thumbs-down (digit '2') is also keyboard-reachable and reflected in the progress count", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1")]);
    renderView("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 1");
    fireEvent.keyDown(window, { key: "2" });

    await waitFor(() =>
      expect(mockPutFeedback).toHaveBeenCalledWith("run-1", { key: "helpful", score: -1 }),
    );
    await waitFor(() => expect(screen.getByText("1/1 reviewed")).toBeInTheDocument());
  });
});

describe("ReviewView — skip (j/k navigation, Enter-with-no-value)", () => {
  test("`j` moves to the next run WITHOUT writing any feedback — a run can be skipped entirely", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2")]);
    renderView("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 2");
    fireEvent.keyDown(window, { key: "j" });

    await screen.findByText("Run 2 of 2");
    expect(mockPutFeedback).not.toHaveBeenCalled();
    expect(screen.getByText("0/2 reviewed")).toBeInTheDocument();
  });

  test("`k` moves back to the previous run; the boundary clamps rather than wrapping", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2")]);
    renderView("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 2");
    fireEvent.keyDown(window, { key: "k" }); // already at the first run — clamps, stays put
    await screen.findByText("Run 1 of 2");

    fireEvent.keyDown(window, { key: "j" });
    await screen.findByText("Run 2 of 2");
    fireEvent.keyDown(window, { key: "k" });
    await screen.findByText("Run 1 of 2");
  });

  test("Enter on a key with no value picked SKIPS that key (advances without writing); arrow keys cycle key focus", async () => {
    mockListRubrics.mockResolvedValue([TWO_KEY_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1")]);
    renderView("/testing/runs/review?rubricId=rub-2");

    await screen.findByText("Run 1 of 1");
    // Focus starts on key 0 ("helpful"); move to key 1 ("notes") via the arrow key.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    // Enter with nothing typed in the note just skips — no write, no crash at the queue's end.
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(mockPutFeedback).not.toHaveBeenCalled());
    expect(screen.getByText("0/1 reviewed")).toBeInTheDocument();
  });
});

describe("ReviewView — rubric picker gate", () => {
  test("with no rubric selected, the two-pane review surface does not render", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1")]);
    renderView("/testing/runs/review");

    expect(await screen.findByText("Pick a rubric to start reviewing")).toBeInTheDocument();
    expect(screen.queryByText("Run 1 of 1")).not.toBeInTheDocument();
  });
});

/**
 * Grading shortcuts swallow the app's own shortcuts and commit scores (design-remediation T11, P1) —
 * the key handler matched on `event.key` with no modifier guard, and every branch (including the
 * digit branches, which COMMIT A GRADE) called `preventDefault()`. A reviewer reaching for a chord
 * like ⌘K/⌃J/⌘1 must not silently score the run. The fix early-returns on any modifier.
 */
describe("ReviewView — modifier chords never commit a grade (T11)", () => {
  test("Cmd+1 (a modifier chord) does NOT commit a grade — the digit branch never runs", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1")]);
    renderView("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 1");
    fireEvent.keyDown(window, { key: "1", metaKey: true });

    await waitFor(() => expect(mockPutFeedback).not.toHaveBeenCalled());
    expect(screen.getByText("0/1 reviewed")).toBeInTheDocument();
  });

  test("Ctrl+J (a modifier chord) does NOT navigate the queue — j/k stay a plain, unmodified shortcut", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2")]);
    renderView("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 2");
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    // Stays on run 1 — a modifier chord bails out before the "j" branch ever runs.
    expect(screen.getByText("Run 1 of 2")).toBeInTheDocument();
  });

  test("a bare (unmodified) digit still commits, proving the guard targets modifiers only", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1")]);
    renderView("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 1");
    fireEvent.keyDown(window, { key: "1" });

    await waitFor(() =>
      expect(mockPutFeedback).toHaveBeenCalledWith("run-1", { key: "helpful", score: 1 }),
    );
  });
});

/**
 * Review survives a refresh (design-remediation T11, P1) — `runIndex` used to be an unpersisted
 * `useState`, so a refresh at run 150 of 200 restarted at run 1. It now lives in the URL's
 * `?runIndex=` search param.
 */
describe("ReviewView — runIndex persists to the URL (T11)", () => {
  test("moving to the next run writes `runIndex` into the URL", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2"), fixtureRun("run-3")]);
    renderViewWithLocationProbe("/testing/runs/review?rubricId=rub-1");

    await screen.findByText("Run 1 of 3");
    expect(screen.getByTestId("location")).not.toHaveTextContent("runIndex=1");

    fireEvent.keyDown(window, { key: "j" });

    await screen.findByText("Run 2 of 3");
    expect(screen.getByTestId("location")).toHaveTextContent("runIndex=1");
  });

  test("a deep link with `?runIndex=1` restores the queue pointer to run 2 of N (the refresh case)", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2"), fixtureRun("run-3")]);
    renderView("/testing/runs/review?rubricId=rub-1&runIndex=1");

    await screen.findByText("Run 2 of 3");
  });

  test("an out-of-range `runIndex` from a stale/shorter queue clamps to the last valid run", async () => {
    mockListRubrics.mockResolvedValue([THUMBS_RUBRIC]);
    mockQueryRuns.mockResolvedValue([fixtureRun("run-1"), fixtureRun("run-2")]);
    renderView("/testing/runs/review?rubricId=rub-1&runIndex=99");

    await screen.findByText("Run 2 of 2");
  });
});
