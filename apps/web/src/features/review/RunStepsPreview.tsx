import type { RunStep } from "@mcp-token-footprint/shared";
import { Badge, Card, EmptyState, Text } from "@elabs-ai/components-ui";
import { Bot, User, Wrench } from "lucide-react";
import { formatDuration } from "../../lib/format";

/** Pull the `{ text }` string off a `user_message` step's redacted payload (mirrors
 *  `use-run-stream.ts`'s private `readStepText` — a tiny, stable read, not worth importing a
 *  non-exported internal). */
function userMessageText(step: RunStep): string {
  const p = step.payload;
  if (p && typeof p === "object" && "text" in p) {
    const t = (p as { text: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}

/**
 * Observability WP4.5 (D-OB22) — the review surface's left-pane conversation preview: a compact,
 * STRICTLY READ-ONLY rendering of a run's `steps` (prompts, assistant replies, tool calls). Built
 * directly from `getRun`'s `steps` (a plain REST fetch) rather than the run console's live/replay
 * `ConversationPane` + `useRunStream` (which streams over SSE and carries its OWN write affordances,
 * e.g. per-turn thumbs) — this pane exists purely for a reviewer to ORIENT before answering the
 * rubric on the right; every write in this WP goes through the rubric form, never this pane.
 */
export function RunStepsPreview({ steps }: { steps: RunStep[] }) {
  const visible = steps.filter(
    (step) =>
      step.type === "user_message" || step.type === "llm_response" || step.type === "tool_call",
  );

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<Bot aria-hidden />}
        title="Nothing to preview yet"
        description="This run has no recorded prompt/response/tool-call steps."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {visible.map((step) => (
        <li key={step.id}>
          <Card className="p-3">
            {step.type === "user_message" ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <User aria-hidden className="size-3.5 text-muted-foreground" />
                  <Text variant="meta" tone="muted">
                    Prompt
                  </Text>
                </div>
                <Text className="whitespace-pre-wrap break-words">
                  {userMessageText(step) || "(empty)"}
                </Text>
              </div>
            ) : step.type === "llm_response" ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Bot aria-hidden className="size-3.5 text-muted-foreground" />
                  <Text variant="meta" tone="muted">
                    Assistant
                  </Text>
                  {step.durationMs !== undefined ? (
                    <Text variant="meta" tone="muted" className="tabular-nums">
                      · {formatDuration(step.durationMs)}
                    </Text>
                  ) : null}
                  {step.status === "error" ? (
                    <Badge variant="destructive" className="font-normal">
                      error
                    </Badge>
                  ) : null}
                </div>
                <Text className="whitespace-pre-wrap break-words">
                  {step.assistantText || step.reasoningText || "(no text)"}
                </Text>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Wrench aria-hidden className="size-3.5 text-muted-foreground" />
                <Text variant="meta" tone="muted">
                  Tool call
                </Text>
                <Badge variant="outline" className="font-normal">
                  {step.toolName ?? step.label}
                </Badge>
                {step.status === "error" ? (
                  <Badge variant="destructive" className="font-normal">
                    error
                  </Badge>
                ) : null}
              </div>
            )}
          </Card>
        </li>
      ))}
    </ol>
  );
}
