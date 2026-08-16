import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Button, TooltipProvider, toast } from "@brand/ui";
import { deriveRunBarView, RunBar, type RunIdentity } from "./RunBar";

// Unified Sessions (WP3.3) — component-level coverage the pure-function `RunBar.test.ts` can't reach:
// the End-session confirm → POST + 409 flow, the live deadline countdown, the active/total duration
// readout, and the D-US11 session-vs-run naming pass. `lib/api` is mocked for `endRun` — every other
// export (notably the real `ApiError` class) stays the actual module, so `error instanceof ApiError`
// in `RunBar.tsx` matches an error constructed with the SAME class reference here. WP 2.5 also mocks
// `listRunFeedback` (the header's own self-fetch on mount, mirroring `EndSessionControl`'s shape) so
// every test here never hits a real network call for it. Observability WP4.4 mocks
// `listCollections`/`promoteRunToTest` — the terminal-run "Promote to test" menu's `PromoteToTestDialog`
// (`features/watch/`) is mounted (closed) on every terminal-run render here, so it needs a `<Router>`
// ancestor (its toast action calls `useNavigate`) and its own API calls stubbed, even though no test
// in this file opens it (its own behavior is covered by `PromoteToTestDialog.test.tsx`).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    endRun: vi.fn(),
    listRunFeedback: vi.fn().mockResolvedValue([]),
    putRunFeedback: vi.fn(),
    listCollections: vi.fn().mockResolvedValue([]),
    promoteRunToTest: vi.fn(),
  };
});

import { ApiError, endRun, listRunFeedback, putRunFeedback } from "../../lib/api";

const mockEndRun = vi.mocked(endRun);
const mockListRunFeedback = vi.mocked(listRunFeedback);
const mockPutRunFeedback = vi.mocked(putRunFeedback);

function identity(mode: "automated" | "interactive"): RunIdentity {
  return { testName: "Flights on-time", scenarioName: "BARC on-time", model: "gpt-x", mode };
}

function renderBar(props: Partial<Parameters<typeof RunBar>[0]> = {}) {
  const view = props.view ?? deriveRunBarView("running", undefined, undefined);
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RunBar
          identity={identity("interactive")}
          view={view}
          elapsedMs={0}
          stopping={false}
          onStop={() => {}}
          runId="run-1"
          {...props}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockEndRun.mockReset();
  mockListRunFeedback.mockReset();
  mockListRunFeedback.mockResolvedValue([]);
  mockPutRunFeedback.mockReset();
});

describe("RunBar — End-session control (WP3.3, D-US2)", () => {
  test("does not render for an automated run", () => {
    renderBar({ identity: identity("automated") });
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();
  });

  test("does not render without a runId (the pre-run surface)", () => {
    renderBar({ runId: null });
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();
  });

  test("renders for an interactive run and is absent in replay (the replay controls take its place)", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
  });

  test("does not render in replay — the replay action slot takes over", () => {
    renderBar({
      isReplay: true,
      view: deriveRunBarView("completed", "completed", undefined),
      replayAction: <Button>Replay</Button>,
    });
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();
  });

  test("confirm → POST /api/runs/:id/end", async () => {
    mockEndRun.mockResolvedValueOnce(undefined);

    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    // Radix's focus trap marks the REST of the page `aria-hidden` while the dialog is open — including
    // the trigger button — so exactly ONE "End session" button is queryable now: the dialog's own
    // confirm action.
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));

    await waitFor(() => expect(mockEndRun).toHaveBeenCalledWith("run-1"));
  });

  test("a 409 surfaces the SERVER's own reason in the error toast", async () => {
    mockEndRun.mockRejectedValueOnce(
      new ApiError(409, "End session is only valid for a live interactive run"),
    );
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);

    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Couldn’t end the session.",
        expect.objectContaining({
          description: "End session is only valid for a live interactive run",
        }),
      ),
    );
    errorSpy.mockRestore();
  });

  test("a non-409 failure surfaces a generic message, not the raw error", async () => {
    mockEndRun.mockRejectedValueOnce(new Error("network down"));
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);

    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Couldn’t end the session.",
        expect.objectContaining({ description: "network down Try again." }),
      ),
    );
    errorSpy.mockRestore();
  });
});

describe("RunBar — re-run action (A-3, toolbar-reach WP0.2)", () => {
  test("renders the supplied re-run action inside the action cluster (next to Replay/Export)", () => {
    renderBar({
      isReplay: true,
      view: deriveRunBarView("completed", "completed", undefined),
      replayAction: <Button>Replay</Button>,
      reRunAction: <Button>Re-run with changes</Button>,
    });
    // The fork launcher is folded into the bar's cluster, alongside the replay controls — not on its
    // own chrome row above the console (A-3).
    expect(screen.getByRole("button", { name: "Re-run with changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
  });

  test("renders nothing extra when no re-run action is supplied (live / non-forkable run)", () => {
    renderBar({
      isReplay: true,
      view: deriveRunBarView("completed", "completed", undefined),
      replayAction: <Button>Replay</Button>,
    });
    expect(
      screen.queryByRole("button", { name: "Re-run with changes" }),
    ).not.toBeInTheDocument();
  });
});

describe("RunBar — D-US11 naming pass (session vs run)", () => {
  test("Stop dialog reads 'session' for an interactive run", () => {
    renderBar({ identity: identity("interactive") });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Stop this session?")).toBeInTheDocument();
  });

  test("Stop dialog reads 'run' for an automated run", () => {
    renderBar({ identity: identity("automated"), runId: null });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Stop this run?")).toBeInTheDocument();
  });
});

describe("RunBar — deadline countdown (WP3.3, D-US1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders a live mm:ss countdown to the server-authored deadline while live", () => {
    renderBar({
      view: deriveRunBarView("running", undefined, undefined, undefined, "waiting_input"),
      deadlineAt: "2026-07-16T12:05:00.000Z", // 5 minutes out
    });
    expect(screen.getByText("Expires in 05:00")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Expires in 04:00")).toBeInTheDocument();
  });

  test("never renders once the run is terminal, even if a stale deadlineAt is passed", () => {
    renderBar({
      view: deriveRunBarView("completed", "completed", undefined),
      deadlineAt: "2026-07-16T12:05:00.000Z",
    });
    expect(screen.queryByText(/Expires in|Ends in/)).not.toBeInTheDocument();
  });

  test("floors at 00:00, never a negative countdown, once the deadline has passed", () => {
    renderBar({
      view: deriveRunBarView("running", undefined, undefined, undefined, "waiting_input"),
      deadlineAt: "2026-07-16T11:59:00.000Z", // already in the past
    });
    expect(screen.getByText("Expires in 00:00")).toBeInTheDocument();
  });
});

describe("RunBar — active vs total duration (WP3.3, D-US3)", () => {
  test("renders the active/total split, tabular-nums, in replay only", () => {
    renderBar({
      isReplay: true,
      view: deriveRunBarView("stopped", "stopped_guardrail", undefined, "wait_expired"),
      durations: { activeMs: 130_000, totalMs: 900_000 },
      replayAction: <Button>Replay</Button>,
    });
    expect(screen.getByText("Active 2m 10s of 15m 0s total")).toBeInTheDocument();
  });

  test("renders nothing extra when durations are unknown (pre-contract run)", () => {
    renderBar({
      isReplay: true,
      view: deriveRunBarView("completed", "completed", undefined),
      durations: null,
      replayAction: <Button>Replay</Button>,
    });
    expect(screen.queryByText(/Active .* of .* total/)).not.toBeInTheDocument();
  });
});

/**
 * Observability WP 2.5 (D-OB15) — the run-level "Your verdict" header control. Self-contained
 * (mirrors `EndSessionControl`'s shape): fetches its own current value via `listRunFeedback` on
 * mount, writes via `FeedbackControl` on click. Editable BOTH live and in replay — it sits outside
 * the live/replay branch in `RunBar.tsx` on purpose (see the WP design note there).
 */
describe("RunBar — run-level feedback header (WP 2.5, D-OB15)", () => {
  test("renders for a live run (runId set)", async () => {
    renderBar({ runId: "run-1" });
    expect(await screen.findByRole("button", { name: "Your verdict: thumbs up" })).toBeInTheDocument();
  });

  test("is absent on the pre-run surface (runId null — no session exists yet)", () => {
    renderBar({ runId: null });
    expect(screen.queryByRole("button", { name: "Your verdict: thumbs up" })).not.toBeInTheDocument();
  });

  test("also renders in replay — feedback is editable on a finished run", async () => {
    renderBar({
      runId: "run-1",
      isReplay: true,
      view: deriveRunBarView("completed", "completed", undefined),
      replayAction: <Button>Replay</Button>,
    });
    expect(await screen.findByRole("button", { name: "Your verdict: thumbs up" })).toBeInTheDocument();
  });

  test("fetches the run's existing run-level verdict on mount and reflects it as pressed", async () => {
    mockListRunFeedback.mockResolvedValueOnce([
      {
        id: "fb-1",
        runId: "run-1",
        key: "verdict",
        score: 1,
        source: "human",
        createdAt: "2026-07-16T00:00:00Z",
      },
    ]);
    renderBar({ runId: "run-1" });

    await waitFor(() => expect(mockListRunFeedback).toHaveBeenCalledWith("run-1"));
    expect(await screen.findByRole("button", { name: "Clear your thumbs-up verdict" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("clicking a thumb writes RUN-level feedback (no stepId) via the header control", async () => {
    mockPutRunFeedback.mockResolvedValueOnce({
      id: "fb-2",
      runId: "run-1",
      key: "verdict",
      score: 1,
      source: "human",
      createdAt: "2026-07-16T00:00:01Z",
    });
    renderBar({ runId: "run-1" });

    fireEvent.click(await screen.findByRole("button", { name: "Your verdict: thumbs up" }));

    await waitFor(() =>
      expect(mockPutRunFeedback).toHaveBeenCalledWith("run-1", { key: "verdict", score: 1 }),
    );
  });
});
