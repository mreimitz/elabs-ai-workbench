import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { HubOpenQuestion } from "@mcp-token-footprint/shared";

// `@elabs-ai/components-ai` can't load in jsdom — stub AgentMessage/MessageContent to passthroughs. `@elabs-ai/components-ui`
// (Button/Card/Textarea/Text/toast) loads fine and renders for real.
vi.mock("@elabs-ai/components-ai", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { AgentMessage: Pass, MessageContent: Pass };
});
vi.mock("../../lib/api", () => ({ answerHubQuestion: vi.fn(() => Promise.resolve()) }));

import { HubQuestionPrompt } from "./HubQuestionPrompt";
import { answerHubQuestion } from "../../lib/api";

const mockAnswer = vi.mocked(answerHubQuestion);

describe("HubQuestionPrompt", () => {
  test("renders nothing without a sessionId or without questions", () => {
    const q: HubOpenQuestion = { questionId: "q1", prompt: "Pick", allowOther: true };
    const { container: a } = render(
      <HubQuestionPrompt sessionId={null} questions={[q]} askUser={true} />,
    );
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(
      <HubQuestionPrompt sessionId="s-1" questions={[]} askUser={true} />,
    );
    expect(b).toBeEmptyDOMElement();
    render(<HubQuestionPrompt sessionId="s-1" questions={[q]} askUser={true} />);
    expect(screen.getByText("Pick")).toBeInTheDocument();
  });

  test("renders nothing when askUser:false, even with an open question", () => {
    const q: HubOpenQuestion = { questionId: "q1", prompt: "Pick", allowOther: true };
    const { container } = render(
      <HubQuestionPrompt sessionId="s-1" questions={[q]} askUser={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("clicking a predefined option posts that option's label", async () => {
    mockAnswer.mockClear();
    const q: HubOpenQuestion = {
      questionId: "q1",
      prompt: "Which environment?",
      options: [{ label: "staging" }, { label: "prod" }],
      allowOther: true,
    };
    render(<HubQuestionPrompt sessionId="s-1" questions={[q]} askUser={true} />);
    fireEvent.click(screen.getByRole("button", { name: "prod" }));
    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith("s-1", "q1", "prod"));
  });

  test("free-text answer posts the typed value", async () => {
    mockAnswer.mockClear();
    const q: HubOpenQuestion = { questionId: "q2", prompt: "Anything?", allowOther: true };
    render(<HubQuestionPrompt sessionId="s-1" questions={[q]} askUser={true} />);
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "custom answer" } });
    fireEvent.click(screen.getByRole("button", { name: /send answer/i }));
    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith("s-1", "q2", "custom answer"));
  });

  test("options + allowOther:false offers NO free-text box", () => {
    const q: HubOpenQuestion = {
      questionId: "q3",
      prompt: "Pick exactly one",
      options: [{ label: "a" }, { label: "b" }],
      allowOther: false,
    };
    render(<HubQuestionPrompt sessionId="s-1" questions={[q]} askUser={true} />);
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a" })).toBeInTheDocument();
  });
});
