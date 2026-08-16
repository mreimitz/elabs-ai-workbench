import { useMemo } from "react";
import type { RunFeedback, RunStep } from "@mcp-token-footprint/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Text } from "@brand/ui";
import { AlertTriangle, ArrowRight, ListOrdered, Loader2 } from "lucide-react";
import { formatDuration, formatNumber } from "../../lib/format";
import { FeedbackControl } from "./FeedbackControl";
import { HighlightMatch } from "./SearchHighlight";
import { deriveTurnSummaries, type TurnSummary } from "./turn-summary";
import { useTurnFeedback } from "./use-turn-feedback";
import type { TimelineItem } from "./use-run-stream";

export type TurnsLensProps = {
  runId: string | null;
  timeline: TimelineItem[];
  steps: RunStep[];
  /** Reveal the chat and scroll it to this 0-based turn (the same cross-representation nav every
   *  other pane uses). */
  onSelectTurn: (turnIndex: number) => void;
  /** Observability (WP3.4) — the console-header in-run search query. Highlighted here (never
   *  filtered — a long session is exactly what this lens exists to scan, so hiding non-matching
   *  turns would defeat the point; use the search's prev/next to jump between matches instead). */
  highlightQuery?: string;
};

/**
 * Observability (WP3.4) — the "Turns" lens (the LangSmith Threads-view idea, scoped to this console):
 * one compact card per assistant turn — the first line of the preceding prompt, the first line of the
 * reply, and duration/tokens/tool-count/feedback chips — so a long interactive session can be scanned
 * at a glance instead of scrolled turn-by-turn in the full transcript. Pure presentation over
 * `deriveTurnSummaries` (`turn-summary.ts`); "Jump to turn" reuses the SAME cross-representation
 * navigation the turn index / context chart / trace rows already use.
 */
export function TurnsLens({ runId, timeline, steps, onSelectTurn, highlightQuery = "" }: TurnsLensProps) {
  const rows = useMemo(() => deriveTurnSummaries(timeline, steps), [timeline, steps]);
  // Observability WP2.5 (D-OB15) — the SAME batched per-run feedback lookup `ConversationPane` uses;
  // exported from there so both panes share one shape without a redundant SIMULTANEOUS fetch (they're
  // mutually exclusive tabs — see `useTurnFeedback`'s doc comment).
  const [feedbackByStepId, feedbackHandlers] = useTurnFeedback(runId);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ListOrdered aria-hidden />}
        title="No turns yet"
        description="Turn summaries appear as the run produces assistant replies."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <TurnCard
          key={row.turnIndex}
          row={row}
          runId={runId}
          feedback={row.stepId ? feedbackByStepId.get(row.stepId) : undefined}
          onFeedbackChange={feedbackHandlers.onChange}
          onSelectTurn={onSelectTurn}
          highlightQuery={highlightQuery}
        />
      ))}
    </div>
  );
}

function TurnCard({
  row,
  runId,
  feedback,
  onFeedbackChange,
  onSelectTurn,
  highlightQuery,
}: {
  row: TurnSummary;
  runId: string | null;
  feedback: RunFeedback | undefined;
  onFeedbackChange: (stepId: string, next: RunFeedback | undefined) => void;
  onSelectTurn: (turnIndex: number) => void;
  highlightQuery: string;
}) {
  const stepId = row.stepId;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">Turn {row.turnNo}</span>
              {row.hasError ? (
                <AlertTriangle aria-hidden className="size-4 shrink-0 text-destructive" />
              ) : null}
              {row.streaming ? (
                <Badge variant="outline" className="shrink-0 gap-1 font-normal">
                  <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
                  In progress
                </Badge>
              ) : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto shrink-0 gap-1 px-2 py-1 font-normal"
              onClick={() => onSelectTurn(row.turnIndex)}
            >
              <span>Jump to turn</span>
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="min-w-0">
          <Text variant="meta" tone="muted">
            Prompt
          </Text>
          {row.promptFirstLine ? (
            <Text className="min-w-0 truncate" title={row.promptFirstLine}>
              <HighlightMatch text={row.promptFirstLine} query={highlightQuery} />
            </Text>
          ) : (
            <Text tone="muted" className="italic">
              (no prompt)
            </Text>
          )}
        </div>
        <div className="min-w-0">
          <Text variant="meta" tone="muted">
            Reply
          </Text>
          {row.replyFirstLine ? (
            <Text className="min-w-0 truncate" title={row.replyFirstLine}>
              <HighlightMatch text={row.replyFirstLine} query={highlightQuery} />
            </Text>
          ) : (
            <Text tone="muted" className="italic">
              {row.streaming ? "Thinking…" : "(no reply)"}
            </Text>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {row.durationMs != null ? (
            <Text as="span" variant="meta" tone="muted" className="tabular-nums">
              {formatDuration(row.durationMs)}
            </Text>
          ) : null}
          {row.tokensIn > 0 ? (
            <Text as="span" variant="meta" tone="muted" className="tabular-nums">
              {formatNumber(row.tokensIn)}↑
            </Text>
          ) : null}
          {row.tokensOut > 0 ? (
            <Text as="span" variant="meta" tone="muted" className="tabular-nums">
              {formatNumber(row.tokensOut)}↓
            </Text>
          ) : null}
          {row.toolCalls > 0 ? (
            <Badge variant="outline" className="font-normal tabular-nums">
              {formatNumber(row.toolCalls)} tool{row.toolCalls === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {runId && stepId ? (
            <FeedbackControl
              runId={runId}
              stepId={stepId}
              current={feedback}
              onChange={(next) => onFeedbackChange(stepId, next)}
              size="sm"
              hideLabel
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
