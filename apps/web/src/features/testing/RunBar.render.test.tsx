import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Button, TooltipProvider, toast } from "@elabs-ai/components-ui";
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
    // AM-OB13 — the same reason: the terminal-run overflow menu also mounts (closed)
    // `SendToWebhookDialog`, whose own behaviour is covered by `SendToWebhookDialog.test.tsx`.
    listWatchRules: vi.fn().mockResolvedValue([]),
    getRunWebhookPayload: vi.fn(),
    sendRunToWebhook: vi.fn(),
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

/**
 * RM-17 Phase 6 (AM-OB2) — the corrected-answer control beside the verdict thumbs: an operator can
 * write "what this run should have said" WITHOUT leaving the console. These cases pin the WIRING
 * (the header mounts it, hands it the right row, and writes the right key); the control's own
 * behaviour is `FeedbackControl.test.tsx`.
 */
describe("RunBar — corrected-answer header control (AM-OB2)", () => {
  test("renders beside the verdict thumbs whenever a run exists, live or replay", async () => {
    renderBar({ runId: "run-1" });
    expect(
      await screen.findByRole("button", { name: "Write the corrected answer" }),
    ).toBeInTheDocument();
  });

  test("is absent on the pre-run surface — there is no answer to correct yet", () => {
    renderBar({ runId: null });
    expect(
      screen.queryByRole("button", { name: "Write the corrected answer" }),
    ).not.toBeInTheDocument();
  });

  test("the ONE mount fetch feeds both controls: an existing correction shows as editable", async () => {
    mockListRunFeedback.mockResolvedValueOnce([
      {
        id: "fb-1",
        runId: "run-1",
        key: "verdict",
        score: 1,
        source: "human",
        createdAt: "2026-08-22T00:00:00Z",
      },
      {
        id: "fb-2",
        runId: "run-1",
        key: "corrected_output",
        comment: "It should have said 42.",
        source: "human",
        createdAt: "2026-08-22T00:00:01Z",
      },
    ]);
    renderBar({ runId: "run-1" });

    await waitFor(() => expect(mockListRunFeedback).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "Edit the corrected answer" }),
    ).toBeInTheDocument();
    // The verdict half of the same fetch still lands.
    expect(
      screen.getByRole("button", { name: "Clear your thumbs-up verdict" }),
    ).toBeInTheDocument();
  });

  test("a STEP-scoped correction does not fill the run-level control", async () => {
    mockListRunFeedback.mockResolvedValueOnce([
      {
        id: "fb-3",
        runId: "run-1",
        stepId: "run-1:step:2",
        key: "corrected_output",
        comment: "this ONE turn was wrong",
        source: "human",
        createdAt: "2026-08-22T00:00:02Z",
      },
    ]);
    renderBar({ runId: "run-1" });

    expect(
      await screen.findByRole("button", { name: "Write the corrected answer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit the corrected answer" }),
    ).not.toBeInTheDocument();
  });
});

// ── RM-36 WP 2.1 (audit finding P1-6) — the CLASS-LEVEL half of the responsive guard ─────────────
//
// HONEST SCOPE: this asserts the class recipe, NOT pixels. jsdom runs no layout engine at all —
// `getBoundingClientRect()` returns zeros here — so nothing in `pnpm test` can observe that a
// control has left the viewport. The LAYOUT-REAL check is `e2e/responsive-actions.spec.ts`
// (Chromium, real viewports, real `getBoundingClientRect()`), and that is what actually proved both
// the defect and the fix. This block is only the fast tripwire that catches someone re-introducing
// the exact classes the fix removed, without waiting for `pnpm test:e2e`.
describe("RunBar responsive recipe (class-level, NOT layout)", () => {
  test("the bar wraps instead of pinning a fixed height, so an over-wide row cannot be clipped", () => {
    const { container } = renderBar({ isReplay: true, runId: "run-1" });
    const bar = container.querySelector("header");
    expect(bar).not.toBeNull();
    const classes = (bar?.className ?? "").split(/\s+/);
    expect(classes).toContain("flex-wrap");
    expect(classes).toContain("min-h-12");
    // A FIXED height is what made the overflow unclippable-but-unreachable; it must not come back.
    expect(classes).not.toContain("h-12");
  });

  test("the action cluster wraps internally and is not shrink-0", () => {
    const { container } = renderBar({ isReplay: true, runId: "run-1" });
    const cluster = container.querySelector("header > div.ml-auto");
    expect(cluster).not.toBeNull();
    const classes = (cluster?.className ?? "").split(/\s+/);
    expect(classes).toContain("flex-wrap");
    expect(classes).toContain("justify-end");
    // `shrink-0` prevented the cluster from ever narrowing, so its internal wrap could never fire.
    expect(classes).not.toContain("shrink-0");
  });
});

describe("RunBar — the terminal-run overflow menu (WP4.4 + AM-OB13)", () => {
  /** Open the menu the way a keyboard user does: focus the trigger, press Enter. */
  async function openMenu() {
    const trigger = screen.getByRole("button", { name: "More actions for this run" });
    // `act` because focusing the trigger also opens its Radix tooltip (D-TB5's one affordance),
    // which is a second state update the assertion below would otherwise race.
    await act(async () => {
      trigger.focus();
    });
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    return trigger;
  }

  test("a TERMINAL run offers both ways out of this page: promote, and send to a webhook", async () => {
    renderBar({
      identity: identity("automated"),
      view: deriveRunBarView("completed", "completed", undefined),
    });
    await openMenu();
    expect(await screen.findByText("Promote to test…")).toBeInTheDocument();
    expect(screen.getByText("Send to webhook…")).toBeInTheDocument();
  });

  test("D-TB5 — the trigger's accessible name IS its tooltip text (one `label`, not a `title`)", () => {
    renderBar({
      identity: identity("automated"),
      view: deriveRunBarView("completed", "completed", undefined),
    });
    const trigger = screen.getByRole("button", { name: "More actions for this run" });
    // `IconButton` derives both from one prop, so the only way they diverge is by not using it.
    expect(trigger).toHaveAttribute("aria-label", "More actions for this run");
    expect(trigger).not.toHaveAttribute("title");
  });

  test("a LIVE run offers neither — there is nothing settled to promote or send yet", () => {
    renderBar({ identity: identity("automated") });
    expect(
      screen.queryByRole("button", { name: "More actions for this run" }),
    ).not.toBeInTheDocument();
  });

  test("the pre-run surface (no runId) offers neither", () => {
    renderBar({
      runId: null,
      identity: identity("automated"),
      view: deriveRunBarView("completed", "completed", undefined),
    });
    expect(
      screen.queryByRole("button", { name: "More actions for this run" }),
    ).not.toBeInTheDocument();
  });
});
