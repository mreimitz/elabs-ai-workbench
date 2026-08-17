import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RunFeedback, RunFeedbackSummary } from "@mcp-token-footprint/shared";
import { TooltipProvider, toast } from "@elabs-ai/components-ui";
import { FeedbackChips, FeedbackControl, FeedbackSummaryChip } from "./FeedbackControl";

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
    render(<FeedbackSummaryChip entry={{ key: "verdict", score: 1 }} />);
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
  });

  test("a thumbs-down 'verdict' entry still reads 'Your verdict' (icon carries the direction)", () => {
    render(<FeedbackSummaryChip entry={{ key: "verdict", score: -1 }} />);
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
  });

  test("a null-score 'verdict' entry (comment-only) renders nothing", () => {
    const { container } = render(<FeedbackSummaryChip entry={{ key: "verdict", score: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a non-'verdict' key falls back to a generic 'key: score' chip", () => {
    render(<FeedbackSummaryChip entry={{ key: "usefulness", score: 2 }} />);
    expect(screen.getByText("usefulness: 2")).toBeInTheDocument();
  });

  test("FeedbackChips renders nothing for an empty/absent feedback list (honest empty)", () => {
    const { container: empty } = render(<FeedbackChips feedback={[]} />);
    expect(empty).toBeEmptyDOMElement();
    const { container: absent } = render(<FeedbackChips feedback={undefined} />);
    expect(absent).toBeEmptyDOMElement();
  });

  test("FeedbackChips renders one chip per entry", () => {
    const feedback: RunFeedbackSummary[] = [
      { key: "verdict", score: 1 },
      { key: "usefulness", score: 3 },
    ];
    render(<FeedbackChips feedback={feedback} />);
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
    expect(screen.getByText("usefulness: 3")).toBeInTheDocument();
  });
});
