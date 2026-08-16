import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { RunQuestion } from "./use-run-stream";

// `@brand/ai` can't load in jsdom (see RunConsole.test) — stub AgentMessage/MessageContent to
// passthroughs. `@brand/ui` (Button/Card/Textarea/Text/toast) loads fine and renders for real.
vi.mock("@brand/ai", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { AgentMessage: Pass, MessageContent: Pass };
});
vi.mock("../../lib/api", () => ({ answerQuestion: vi.fn(() => Promise.resolve()) }));

import { QuestionPrompt } from "./QuestionPrompt";
import { answerQuestion } from "../../lib/api";

const mockAnswer = vi.mocked(answerQuestion);

describe("QuestionPrompt", () => {
  test("renders nothing without a runId or without questions", () => {
    const { container: a } = render(<QuestionPrompt runId={null} questions={[]} askUser={true} />);
    expect(a).toBeEmptyDOMElement();
    const q: RunQuestion = { questionId: "q1", prompt: "Pick", allowOther: true };
    const { container: b } = render(
      <QuestionPrompt runId="run-1" questions={[]} askUser={true} />,
    );
    expect(b).toBeEmptyDOMElement();
    // Sanity: with a question it is NOT empty.
    render(<QuestionPrompt runId="run-1" questions={[q]} askUser={true} />);
    expect(screen.getByText("Pick")).toBeInTheDocument();
  });

  test("WP 3.2 (D-US4) — renders nothing when askUser:false, even with an open question", () => {
    const q: RunQuestion = { questionId: "q1", prompt: "Pick", allowOther: true };
    const { container } = render(
      <QuestionPrompt runId="run-1" questions={[q]} askUser={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Pick")).not.toBeInTheDocument();
  });

  test("clicking a predefined option posts that option's label", async () => {
    mockAnswer.mockClear();
    const q: RunQuestion = {
      questionId: "q1",
      prompt: "Which environment?",
      options: [{ label: "staging" }, { label: "prod" }],
      allowOther: true,
    };
    render(<QuestionPrompt runId="run-1" questions={[q]} askUser={true} />);
    fireEvent.click(screen.getByRole("button", { name: "prod" }));
    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith("run-1", "q1", "prod"));
  });

  test("free-text answer posts the typed value", async () => {
    mockAnswer.mockClear();
    const q: RunQuestion = { questionId: "q2", prompt: "Anything?", allowOther: true };
    render(<QuestionPrompt runId="run-1" questions={[q]} askUser={true} />);
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "custom answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send answer/i }));
    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith("run-1", "q2", "custom answer"));
  });

  test("a question with options and allowOther:false offers NO free-text box", () => {
    const q: RunQuestion = {
      questionId: "q3",
      prompt: "Pick exactly one",
      options: [{ label: "a" }, { label: "b" }],
      allowOther: false,
    };
    render(<QuestionPrompt runId="run-1" questions={[q]} askUser={true} />);
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a" })).toBeInTheDocument();
  });
});
