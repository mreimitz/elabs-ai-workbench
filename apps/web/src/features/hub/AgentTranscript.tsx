// Assistant Hub · hub-fixes WP4.3 (RC6.4) — a SLIM, READ-ONLY transcript of ONE mission child
// session, streamed over the same SSE contract the main console uses. Since WP2.1, a mission agent
// IS a real hub session (`agentSessionId`), so its turns/tool-calls are live-streamable exactly like
// any other session — this component subscribes via {@link useHubStream} and renders the timeline
// without any of ConversationPane's authoring affordances (no composer, no approve/deny buttons, no
// steering). It is what the expand modal's right panel and the board detail box's Live tab show.
//
// It observes; it never drives. Approval is surfaced as a read-only "awaiting approval" marker — the
// actual decision happens on the mission board (WP2.4), never here. Follows `.claude/rules/
// loading-states.md`: a layout-shaped skeleton while nothing has arrived (loading), content built up
// as it streams (isStreaming), and an error slot that only renders on a settled/terminal failure.

import {
  AgentMessage,
  MessageContent,
  MessageResponse,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Shimmer,
  Tool,
  ToolContent,
  ToolDetails,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@elabs-ai/components-ai";
import { Alert, AlertDescription, AlertTitle, Badge, Skeleton, Text } from "@elabs-ai/components-ui";
import type { HubMessagePart, HubToolPart } from "@mcp-token-footprint/shared";
import { MD_TABLE_COMPONENTS } from "../testing/ChatMarkdown";
import { mcpErrorText, summarizeArgs, unwrapToolResult } from "../testing/tool-call-view";
import { prettyToolName } from "./hub-tool-parts";
import {
  useHubStream,
  type HubTimelineAssistantTurn,
  type HubTimelineUserItem,
} from "./use-hub-stream";

export type AgentTranscriptProps = {
  /** The child hub session to stream (a mission agent's `agentSessionId`). */
  sessionId: string;
  /** An accessible label for the transcript region (SR). Defaults to a generic label. */
  ariaLabel?: string;
};

/**
 * Stream + render one mission child session's transcript, read-only. The heavy lifting (replay-then-
 * live, seq-dedup, terminal-ONLY error, unsubscribe-on-unmount) lives in {@link useHubStream}; this is
 * just its presentation. Unsubscription is automatic — unmounting this component (modal close, tab
 * switch, node deselection) tears the subscription down via the hook's effect cleanup, so no polling
 * loop is ever left behind.
 */
export function AgentTranscript({ sessionId, ariaLabel }: AgentTranscriptProps) {
  const { timeline, error } = useHubStream(sessionId);
  const empty = timeline.length === 0;

  return (
    // `role="log"` + polite live region so a screen reader announces streamed turns as they land.
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid="agent-transcript"
      role="log"
      aria-live="polite"
      aria-label={ariaLabel ?? "Agent session transcript"}
    >
      {/* Terminal-only (loading-states.md): the hook sets `error` only on a genuine pre-close drop or a
          settled error/limit event — never mid-stream — so this slot never flashes while tokens flow. */}
      {error ? (
        <Alert variant="warning" data-testid="agent-transcript-error">
          <AlertTitle>Session stream interrupted</AlertTitle>
          <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      {empty && !error ? (
        <TranscriptLoading />
      ) : (
        timeline.map((item) =>
          item.kind === "user" ? (
            <TranscriptUser key={item.id} item={item} />
          ) : (
            <TranscriptTurn key={item.id} turn={item} />
          ),
        )
      )}
    </div>
  );
}

/** Loading = "no content yet" (loading-states.md): a layout-shaped skeleton, not a collapsing spinner. */
function TranscriptLoading() {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="agent-transcript-loading">
      <Text tone="muted" className="text-caption">
        Waiting for the agent to start…
      </Text>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** The agent's brief — the first user message injected into the child session. */
function TranscriptUser({ item }: { item: HubTimelineUserItem }) {
  if (item.text.trim().length === 0) return null;
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid="agent-transcript-brief"
    >
      <Text tone="muted" className="text-caption font-medium">
        Brief
      </Text>
      <Text className="min-w-0 break-words text-caption">{item.text}</Text>
    </div>
  );
}

/** One assistant turn — its ordered parts (reasoning → tool calls → answer), plus a "Thinking…"
 *  shimmer while a live turn has produced nothing yet (R-UX3 — dead air is a defect), and a
 *  terminal error/limit notice once (and only once) the turn has settled into a failed state. */
function TranscriptTurn({ turn }: { turn: HubTimelineAssistantTurn }) {
  const hasContent = turn.parts.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="agent-transcript-turn">
      {turn.parts.map((part, i) => (
        <TranscriptPart key={i} part={part} streaming={turn.streaming} />
      ))}

      {!hasContent && turn.streaming ? (
        <Shimmer className="text-caption">Thinking…</Shimmer>
      ) : null}

      {/* Terminal notices — rendered only for a SETTLED turn (`streaming` is false once an error /
          limit event lands), so they never interrupt a live stream. */}
      {turn.errorMessage ? (
        <Alert variant="destructive" data-testid="agent-transcript-turn-error">
          <AlertTitle>Couldn’t finish this turn</AlertTitle>
          <AlertDescription className="min-w-0 break-words">{turn.errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {turn.limitError ? (
        <Alert variant="warning" data-testid="agent-transcript-turn-limit">
          <AlertTitle>The agent hit a provider limit</AlertTitle>
          <AlertDescription className="min-w-0 break-words">{turn.limitError.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** One ordered message part (R-SES2). Only text / reasoning / tool_call are surfaced in the slim
 *  transcript — citation / artifact_ref / generative-ui parts belong to the full ConversationPane. */
function TranscriptPart({ part, streaming }: { part: HubMessagePart; streaming: boolean }) {
  switch (part.type) {
    case "text":
      return part.text.trim().length > 0 ? (
        <AgentMessage emphasis="answer">
          <MessageContent>
            {/* ui-wave U2 (owner feedback) — bare Streamdown's own table block carries a raw-fullscreen
                expand; the shared map routes tables through `ExpandableTable`, whose expand opens the
                app's normal Dialog instead. */}
            <MessageResponse components={MD_TABLE_COMPONENTS}>{part.text}</MessageResponse>
          </MessageContent>
        </AgentMessage>
      ) : null;
    case "reasoning":
      return part.text.trim().length > 0 ? (
        <Reasoning isStreaming={streaming}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      ) : null;
    case "tool_call":
      return <TranscriptToolCall part={part} />;
    default:
      return null;
  }
}

/** A read-only tool-call card (the R-UX1 state machine, minus the decision buttons). An
 *  approval-gated call shows an "awaiting approval" marker — the decision is made on the board. */
function TranscriptToolCall({ part }: { part: HubToolPart }) {
  const name = prettyToolName(part.toolName);
  const summary = summarizeArgs(part.args) ?? undefined;
  const hasOutput = part.state === "output-available" || part.state === "output-error";
  const waitingApproval = part.state === "approval-requested";
  return (
    <Tool defaultOpen={waitingApproval}>
      <ToolHeader
        type="dynamic-tool"
        state={part.state}
        toolName={part.toolName}
        title={name}
        summary={summary}
      />
      <ToolContent>
        {waitingApproval ? (
          <div
            className="flex min-w-0 flex-wrap items-center gap-1.5"
            data-testid="agent-transcript-approval-waiting"
          >
            <Badge variant="outline">Awaiting approval</Badge>
            <Text tone="muted" className="min-w-0 text-caption">
              Paused for a decision on the mission board.
            </Text>
          </div>
        ) : null}
        <ToolDetails label="Details" defaultOpen={false}>
          {part.args !== undefined ? <ToolInput input={part.args} /> : null}
          {hasOutput ? <TranscriptToolOutput part={part} /> : null}
        </ToolDetails>
      </ToolContent>
    </Tool>
  );
}

function TranscriptToolOutput({ part }: { part: HubToolPart }) {
  if (part.isError) {
    return <ToolOutput output={undefined} errorText={part.errorText ?? mcpErrorText(part.modelContent)} />;
  }
  return <ToolOutput output={unwrapToolResult(part.modelContent)} errorText={undefined} />;
}
