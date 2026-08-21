import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { GradeFeedback } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { GradeFeedbackControl, latestFeedbackByGrade } from "./GradeFeedbackControl";

// Benchmarks WP 6.1 — `GradeFeedbackControl` is a CONTROLLED component: it never fetches (the
// caller owns the read side, one call per run), so only the WRITE call needs stubbing.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, appendGradeFeedback: vi.fn() };
});

import { appendGradeFeedback } from "../../lib/api";

const mockAppend = vi.mocked(appendGradeFeedback);

function row(over: Partial<GradeFeedback> = {}): GradeFeedback {
  return {
    id: "fb-1",
    gradeId: "grade-1",
    runId: "run-1",
    verdict: "agree",
    createdAt: "2026-08-21T00:00:00Z",
    ...over,
  };
}

function renderControl(props: Partial<Parameters<typeof GradeFeedbackControl>[0]> = {}) {
  const onAppended = vi.fn();
  render(
    <TooltipProvider>
      <GradeFeedbackControl
        gradeId="grade-1"
        graderLabel="Outcome judge"
        current={undefined}
        onAppended={onAppended}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onAppended };
}

beforeEach(() => {
  mockAppend.mockReset();
});

describe("GradeFeedbackControl — round-trip (Acceptance #1)", () => {
  test("clicking 'grader was wrong' POSTs the verdict and reports the saved row", async () => {
    const saved = row({ verdict: "disagree" });
    mockAppend.mockResolvedValueOnce(saved);
    const { onAppended } = renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Outcome judge: Grader was wrong" }));

    await waitFor(() =>
      expect(mockAppend).toHaveBeenCalledWith("grade-1", { verdict: "disagree" }),
    );
    await waitFor(() => expect(onAppended).toHaveBeenCalledWith(saved));
  });

  test("switching verdicts APPENDS a new one (never a delete, never an update)", async () => {
    mockAppend.mockResolvedValueOnce(row({ verdict: "disagree", id: "fb-2" }));
    renderControl({ current: row({ verdict: "agree" }) });

    fireEvent.click(screen.getByRole("button", { name: "Outcome judge: Grader was wrong" }));

    await waitFor(() => expect(mockAppend).toHaveBeenCalledTimes(1));
    expect(mockAppend).toHaveBeenCalledWith("grade-1", { verdict: "disagree" });
  });

  test("re-clicking the verdict already on record writes NOTHING (append-only has no un-say)", () => {
    renderControl({ current: row({ verdict: "agree" }) });

    fireEvent.click(screen.getByRole("button", { name: "Outcome judge: Grader was right" }));

    expect(mockAppend).not.toHaveBeenCalled();
  });

  test("the current verdict is reflected as the pressed thumb", () => {
    renderControl({ current: row({ verdict: "disagree" }) });

    // `aria-pressed`, not `data-state`: the Radix Tooltip trigger writes its OWN `data-state`
    // (open/closed) onto the same element, so the toggle's state must be read from the ARIA
    // attribute — which is also the one a screen reader announces.
    expect(screen.getByRole("button", { name: "Outcome judge: Grader was wrong" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Outcome judge: Grader was right" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("GradeFeedbackControl — the note", () => {
  test("a note is saved WITH the standing verdict, in one appended row", async () => {
    mockAppend.mockResolvedValueOnce(row({ verdict: "disagree", note: "Missed the filter." }));
    renderControl({ current: row({ verdict: "disagree" }) });

    fireEvent.click(screen.getByRole("button", { name: /add a note to your call/i }));
    fireEvent.change(await screen.findByLabelText(/why\?/i), {
      target: { value: "Missed the filter." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockAppend).toHaveBeenCalledWith("grade-1", {
        verdict: "disagree",
        note: "Missed the filter.",
      }),
    );
  });

  test("with no verdict yet, Save is disabled and SAYS WHY (a note rides on a verdict)", async () => {
    renderControl({ current: undefined });

    fireEvent.click(screen.getByRole("button", { name: /add a note to your call/i }));
    const save = await screen.findByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    expect(
      screen.getByText(/Pick “grader was right” or “grader was wrong” first/),
    ).toBeInTheDocument();
    expect(mockAppend).not.toHaveBeenCalled();
  });
});

describe("GradeFeedbackControl — copy is never a grade (AR6)", () => {
  test("the control renders no score, no percentage, and asks about the GRADER", () => {
    const { container } = render(
      <TooltipProvider>
        <GradeFeedbackControl
          gradeId="grade-1"
          graderLabel="Outcome judge"
          current={row({ verdict: "agree" })}
          onAppended={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("This grade:")).toBeInTheDocument();
    // No number of any kind can be read off this control — nothing here is a score.
    expect(container.textContent ?? "").not.toMatch(/\d/);
    // And the accessible names name the GRADER's correctness, never a quality judgement of the run.
    expect(screen.getByRole("button", { name: /Grader was right/ })).toBeInTheDocument();
  });
});

describe("latestFeedbackByGrade", () => {
  test("reduces an oldest-first history to the NEWEST verdict per grade", () => {
    const latest = latestFeedbackByGrade([
      row({ id: "a", gradeId: "g1", verdict: "agree" }),
      row({ id: "b", gradeId: "g1", verdict: "disagree" }),
      row({ id: "c", gradeId: "g2", verdict: "agree" }),
    ]);

    expect(latest.get("g1")?.id).toBe("b");
    expect(latest.get("g2")?.id).toBe("c");
    expect(latest.size).toBe(2);
  });
});
