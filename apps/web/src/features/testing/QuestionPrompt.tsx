import { useCallback, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Text, Textarea } from "@brand/ui";
import { AgentMessage, MessageContent } from "@brand/ai";
import { HelpCircle, Send } from "lucide-react";
import { answerQuestion } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import type { RunQuestion } from "./use-run-stream";
import { notifyError } from "../../lib/notify";

/**
 * The answer surface for the agent's built-in `ask_user` tool. When the agent pauses a live interactive
 * run to ask a question (a `question` RunEvent → `stream.questions`), one card renders per open question
 * with the prompt, any predefined `options` (each a one-click submit), and a free-text fallback. Answering
 * POSTs to `POST /api/runs/:id/answers` (`answerQuestion`), which resumes the paused tool call; the card
 * then disappears when the server emits the matching `question_resolved` event. Rendered only on a live
 * interactive run (the caller gates on that), so a finished/replayed run never shows a stale form.
 *
 * Unified Sessions WP 3.2 (D-US4) — also self-gates on `askUser` (`SessionCapabilities.askUser`): a
 * backend that doesn't expose the agent-initiated `ask_user` tool never renders a question card even
 * if `questions` were somehow non-empty (defensive; today only the AI-SDK engine sets `askUser:true`).
 */
export function QuestionPrompt({
  runId,
  questions,
  askUser,
}: {
  runId: string | null;
  questions: RunQuestion[];
  /** The session's `SessionCapabilities.askUser` facet. */
  askUser: boolean;
}) {
  if (runId === null || questions.length === 0 || !askUser) return null;
  return (
    <div className="flex flex-col gap-4">
      {questions.map((question) => (
        <QuestionCard key={question.questionId} runId={runId} question={question} />
      ))}
    </div>
  );
}

function QuestionCard({ runId, question }: { runId: string; question: RunQuestion }) {
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState("");
  const options = question.options ?? [];
  // Free-text is offered whenever the agent allows it OR when it gave no options to pick from (a
  // question with neither options nor free-text would be unanswerable).
  const allowText = question.allowOther || options.length === 0;

  const submit = useCallback(
    async (answer: string) => {
      const trimmed = answer.trim();
      if (submitting || trimmed.length === 0) return;
      setSubmitting(true);
      try {
        await answerQuestion(runId, question.questionId, trimmed);
        // Success: the run emits `question_resolved`, which removes this card. Stay disabled until then
        // so a double-click can't post a second answer to the already-resolved question.
      } catch (error) {
        notifyError("Couldn’t send the answer.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
        setSubmitting(false);
      }
    },
    [runId, question.questionId, submitting],
  );

  return (
    <AgentMessage>
      <MessageContent>
        <Card className="border-primary/40">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <HelpCircle className="size-4 shrink-0 text-primary" aria-hidden />
            <CardTitle className="text-subtitle">The agent is asking you a question</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Text className="whitespace-pre-wrap text-pretty">{question.prompt}</Text>

            {options.length > 0 ? (
              <div className="flex flex-col gap-2">
                {options.map((option) => (
                  <Button
                    key={option.label}
                    variant="outline"
                    className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                    disabled={submitting}
                    onClick={() => void submit(option.label)}
                  >
                    <span className="font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="text-caption text-muted-foreground">{option.description}</span>
                    ) : null}
                  </Button>
                ))}
              </div>
            ) : null}

            {allowText ? (
              <div className="flex flex-col gap-2">
                {options.length > 0 ? (
                  <Text variant="meta">Or type your own answer</Text>
                ) : null}
                <Textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Type your answer…"
                  rows={2}
                  disabled={submitting}
                  aria-label="Your answer"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void submit(text);
                    }
                  }}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={submitting || text.trim().length === 0}
                    onClick={() => void submit(text)}
                  >
                    <Send className="size-4" aria-hidden />
                    {submitting ? "Sending…" : "Send answer"}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </MessageContent>
    </AgentMessage>
  );
}
