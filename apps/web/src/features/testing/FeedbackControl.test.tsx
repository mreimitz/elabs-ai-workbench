import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RunFeedback, RunFeedbackSummary } from "@mcp-token-footprint/shared";
import { TooltipProvider, toast } from "@elabs-ai/components-ui";
import {
  CorrectedOutputControl,
  FeedbackChips,
  FeedbackControl,
  FeedbackSummaryChip,
} from "./FeedbackControl";

// WP 2.5 (D-OB15) — `FeedbackControl` is a CONTROLLED component: it never fetches on its own (the
// caller — `RunBar`'s header, `ConversationPane`'s per-turn map — owns the read side), so this file
// only ever needs to stub the WRITE calls.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, putRunFeedback: vi.fn(), deleteRunFeedback: vi.fn() };
});

import { deleteRunFeedback, putRunFeedback } from "../../lib/api";

const mockPut = vi.mocked(putRunFeedback);
const mockDelete = vi.mocked(deleteRunFeedback);

function row(over: Partial<RunFeedback> = {}): RunFeedback {
  return {
    id: "fb-1",
    runId: "run-1",
    key: "verdict",
    score: 1,
    source: "human",
    createdAt: "2026-07-16T00:00:00Z",
    ...over,
  };
}

function renderControl(props: Partial<Parameters<typeof FeedbackControl>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <FeedbackControl runId="run-1" current={undefined} onChange={onChange} {...props} />
    </TooltipProvider>,
  );
  return { onChange };
}

beforeEach(() => {
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe("FeedbackControl — thumb round-trip (Acceptance #1)", () => {
  test("clicking thumbs-up (unset → up) POSTs a run-level 'verdict' upsert and reports the saved row", async () => {
    const saved = row({ score: 1 });
    mockPut.mockResolvedValueOnce(saved);
    const { onChange } = renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Your verdict: thumbs up" }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", { key: "verdict", score: 1 }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    // Never touches the delete endpoint on a plain set.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test("re-thumb REPLACES: clicking the OTHER thumb while one is active POSTs the new score, never deletes first", async () => {
    const saved = row({ score: -1 });
    mockPut.mockResolvedValueOnce(saved);
    const { onChange } = renderControl({ current: row({ score: 1 }) });

    fireEvent.click(screen.getByRole("button", { name: "Your verdict: thumbs down" }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", { key: "verdict", score: -1 }),
    );
    expect(mockDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
  });

  test("clicking the ALREADY-active thumb clears it (a deliberate take-it-back, not a re-send)", async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    const current = row({ id: "fb-existing", score: 1 });
    const { onChange } = renderControl({ current });

    // The active thumb reads "Clear your thumbs-up verdict" once pressed.
    fireEvent.click(screen.getByRole("button", { name: "Clear your thumbs-up verdict" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("run-1", "fb-existing"));
    expect(mockPut).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
  });

  test("turn-level targeting: a stepId prop rides along on the write, scoping it to that step", async () => {
    mockPut.mockResolvedValueOnce(row({ stepId: "run-1:step:9", score: 1 }));
    renderControl({ stepId: "run-1:step:9" });

    fireEvent.click(screen.getByRole("button", { name: "Your verdict: thumbs up" }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", {
        key: "verdict",
        score: 1,
        stepId: "run-1:step:9",
      }),
    );
  });

  test("a write failure surfaces a toast and never calls onChange (terminal-failure-only error)", async () => {
    mockPut.mockRejectedValueOnce(new Error("network down"));
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    const { onChange } = renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Your verdict: thumbs up" }));

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Couldn’t save the verdict.",
        expect.objectContaining({ description: "network down Try again." }),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("the pressed state reflects the CURRENT prop — controlled, no internal fetch", () => {
    renderControl({ current: row({ score: -1 }) });
    expect(screen.getByRole("button", { name: "Clear your thumbs-down verdict" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Your verdict: thumbs up" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("FeedbackControl — the note popover saves explicitly", () => {
  test("typing a note and clicking Save POSTs the comment and reports the saved row", async () => {
    const saved = row({ score: 1, comment: "Great answer." });
    mockPut.mockResolvedValueOnce(saved);
    const { onChange } = renderControl({ current: row({ score: 1 }) });

    fireEvent.click(screen.getByRole("button", { name: "Add a note to your verdict" }));
    fireEvent.change(await screen.findByLabelText("Your note (optional)"), {
      target: { value: "Great answer." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", {
        key: "verdict",
        score: 1,
        comment: "Great answer.",
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
  });

  test("Cancel discards the draft without writing", () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "Add a note to your verdict" }));
    fireEvent.change(screen.getByLabelText("Your note (optional)"), {
      target: { value: "discarded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe("FeedbackChips / FeedbackSummaryChip — read-only rendering (feed + report)", () => {
  test("a thumbs-up 'verdict' entry renders the distinct 'Your verdict' chip", () => {
    render(<FeedbackSummaryChip entry={{ key: "verdict", score: 1, hasComment: false }} />);
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
  });

  test("a thumbs-down 'verdict' entry still reads 'Your verdict' (icon carries the direction)", () => {
    render(<FeedbackSummaryChip entry={{ key: "verdict", score: -1, hasComment: false }} />);
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
  });

  // AM-OB2 — a `verdict` row with a note but no thumb used to render NOTHING, so "the operator wrote
  // something" and "nobody touched this run" looked identical.
  test("a null-score 'verdict' entry WITH text renders a 'Your note' chip, not nothing", () => {
    render(<FeedbackSummaryChip entry={{ key: "verdict", score: null, hasComment: true }} />);
    expect(screen.getByText("Your note")).toBeInTheDocument();
  });

  test("a null-score 'verdict' entry with NO text still renders nothing (there is nothing to say)", () => {
    const { container } = render(
      <FeedbackSummaryChip entry={{ key: "verdict", score: null, hasComment: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("a captured 'corrected_output' renders its own chip, distinct from a verdict", () => {
    render(
      <FeedbackSummaryChip entry={{ key: "corrected_output", score: null, hasComment: true }} />,
    );
    expect(screen.getByText("Corrected answer")).toBeInTheDocument();
    expect(screen.queryByText("Your verdict")).not.toBeInTheDocument();
  });

  test("a non-'verdict' key falls back to a generic 'key: score' chip", () => {
    render(<FeedbackSummaryChip entry={{ key: "usefulness", score: 2, hasComment: false }} />);
    expect(screen.getByText("usefulness: 2")).toBeInTheDocument();
  });

  test("a scoreless rubric key with a note reads 'key: note' rather than a bare key", () => {
    render(<FeedbackSummaryChip entry={{ key: "notes", score: null, hasComment: true }} />);
    expect(screen.getByText("notes: note")).toBeInTheDocument();
  });

  test("FeedbackChips renders nothing for an empty/absent feedback list (honest empty)", () => {
    const { container: empty } = render(<FeedbackChips feedback={[]} />);
    expect(empty).toBeEmptyDOMElement();
    const { container: absent } = render(<FeedbackChips feedback={undefined} />);
    expect(absent).toBeEmptyDOMElement();
  });

  test("FeedbackChips renders one chip per entry", () => {
    const feedback: RunFeedbackSummary[] = [
      { key: "verdict", score: 1, hasComment: false },
      { key: "usefulness", score: 3, hasComment: false },
    ];
    render(<FeedbackChips feedback={feedback} />);
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
    expect(screen.getByText("usefulness: 3")).toBeInTheDocument();
  });
});

// ── AM-OB2 — the feedback key is a prop, and the corrected answer is its own control ────────────────

describe("FeedbackControl — the feedback key is a prop (AM-OB2)", () => {
  test("defaults to 'verdict' so every pre-AM-OB2 call site writes exactly what it did before", async () => {
    mockPut.mockResolvedValueOnce(row({ score: 1 }));
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "Your verdict: thumbs up" }));
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", { key: "verdict", score: 1 }),
    );
  });

  test("an explicit feedbackKey rides on the write instead of the hardcoded literal", async () => {
    mockPut.mockResolvedValueOnce(row({ key: "helpful", score: 1 }));
    renderControl({ feedbackKey: "helpful" });
    fireEvent.click(screen.getByRole("button", { name: "Your verdict: thumbs up" }));
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", { key: "helpful", score: 1 }),
    );
  });
});

describe("CorrectedOutputControl — write the answer the run should have given (AM-OB2)", () => {
  function renderCorrection(current?: RunFeedback) {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <CorrectedOutputControl runId="run-1" current={current} onChange={onChange} />
      </TooltipProvider>,
    );
    return { onChange };
  }

  test("typing an answer and saving POSTs a comment-only 'corrected_output' row (no score)", async () => {
    const saved = row({ id: "fb-c", key: "corrected_output", score: undefined, comment: "42." });
    mockPut.mockResolvedValueOnce(saved);
    const { onChange } = renderCorrection();

    fireEvent.click(screen.getByRole("button", { name: "Write the corrected answer" }));
    fireEvent.change(await screen.findByLabelText("Corrected answer"), {
      target: { value: "42." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("run-1", { key: "corrected_output", comment: "42." }),
    );
    // A corrected answer is NOT a grade — no score is ever written with it (AR6/D-OB15).
    expect(mockPut.mock.calls[0]?.[1]).not.toHaveProperty("score");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
  });

  test("emptying the box DELETES the row rather than persisting a blank correction", async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    const current = row({ id: "fb-c", key: "corrected_output", score: undefined, comment: "old" });
    const { onChange } = renderCorrection(current);

    fireEvent.click(screen.getByRole("button", { name: "Edit the corrected answer" }));
    fireEvent.change(await screen.findByLabelText("Corrected answer"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("run-1", "fb-c"));
    expect(mockPut).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
  });

  test("a write failure surfaces a toast and never reports a saved correction", async () => {
    mockPut.mockRejectedValueOnce(new Error("network down"));
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    const { onChange } = renderCorrection();

    fireEvent.click(screen.getByRole("button", { name: "Write the corrected answer" }));
    fireEvent.change(await screen.findByLabelText("Corrected answer"), {
      target: { value: "should have said X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Couldn’t save the corrected answer.",
        expect.objectContaining({ description: "network down Try again." }),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("the trigger names the state: writing a new answer vs editing an existing one", () => {
    const { unmount } = render(
      <TooltipProvider>
        <CorrectedOutputControl runId="run-1" current={undefined} onChange={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Write the corrected answer" })).toBeInTheDocument();
    unmount();

    render(
      <TooltipProvider>
        <CorrectedOutputControl
          runId="run-1"
          current={row({ key: "corrected_output", score: undefined, comment: "x" })}
          onChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Edit the corrected answer" })).toBeInTheDocument();
  });
});
