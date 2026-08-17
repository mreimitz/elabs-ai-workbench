import { useCallback, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Text, Textarea } from "@elabs-ai/components-ui";
import { AgentMessage, MessageContent } from "@elabs-ai/components-ai";
import { HelpCircle, Send } from "lucide-react";
import type { HubOpenQuestion } from "@mcp-token-footprint/shared";
import { answerHubQuestion } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/**
 * The answer surface for a hub agent's interactive `ask_user` tool — the SAME primitive the Testing
 * console renders (`features/testing/QuestionPrompt.tsx`), adapted to the hub's session shapes. When the
 * agent pauses a live foreground turn to ask a question (a `question` HubEvent → `stream.openQuestions`),
 * one card renders per open question with the prompt, any predefined `options` (each a one-click submit),
 * and a free-text fallback. Answering POSTs to `POST /api/hub/sessions/:id/answers`
 * (`answerHubQuestion`), which resumes the paused tool; the card disappears when the server emits the
 * matching `question_resolved` event.
 *
 * Self-gates on `askUser` (`SessionCapabilities.askUser`): a session whose backend does not expose the
 * agent-initiated `ask_user` tool never renders a question card even if `questions` were somehow
 * non-empty (mission agents / synthesis turns set `askUser:false`).
 */
export function HubQuestionPrompt({
  sessionId,
  questions,
  askUser,
}: {
  sessionId: string | null;
  questions: HubOpenQuestion[];
  /** The session's `SessionCapabilities.askUser` facet. */
  askUser: boolean;
}) {
  if (sessionId === null || questions.length === 0 || !askUser) return null;
  return (
    <div className="flex flex-col gap-4">
      {questions.map((question) => (
        <HubQuestionCard key={question.questionId} sessionId={sessionId} question={question} />
      ))}
    </div>
  );
}

function HubQuestionCard({
  sessionId,
  question,
}: {
  sessionId: string;
  question: HubOpenQuestion;
}) {
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
        await answerHubQuestion(sessionId, question.questionId, trimmed);
        // Success: the session emits `question_resolved`, which removes this card. Stay disabled until
        // then so a double-click can't post a second answer to the already-resolved question.
      } catch (error) {
        notifyError("Couldn’t send answer", { description: getErrorMessage(error) });
        setSubmitting(false);
      }
    },
    [sessionId, question.questionId, submitting],
  );

  return (
    <AgentMessage>
      <MessageContent>
        <Card className="border-primary/40">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <HelpCircle className="size-4 shrink-0 text-primary" aria-hidden />
            <CardTitle className="text-subtitle">The assistant is asking you a question</CardTitle>
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
                {options.length > 0 ? <Text variant="meta">Or type your own answer</Text> : null}
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
