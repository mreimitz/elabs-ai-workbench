import { useEffect, useMemo, useState } from "react";
import type {
  RunFeedback,
  RunPhase as SessionPhase,
  ServerConfig,
  SessionCapabilities,
  Test,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  ErrorState,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import {
  AgentMessage,
  ChatShell,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  MessageAction,
  MessageActions,
  MessageContent,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Shimmer,
  Task,
  TaskContent,
  TaskTrigger,
  UserMessage,
} from "@elabs-ai/components-ai";
import { ArrowUp, Check, Copy, FileText, MessageSquare } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { apiGet } from "../../lib/api";
import { formatBytes, formatDuration, formatNumber } from "../../lib/format";
import type {
  RunStreamState,
  TimelineAssistantTurn,
  TimelineItem,
  TimelineUserItem,
} from "./use-run-stream";
import type { deriveRunBarView } from "./RunBar";
import { ToolCallCard } from "./ToolCallCard";
import { Composer } from "./Composer";
import { QuestionPrompt } from "./QuestionPrompt";
import { ChatMarkdown } from "./ChatMarkdown";
import { FeedbackControl } from "./FeedbackControl";
import { useTurnFeedback } from "./use-turn-feedback";
import {
  consoleAnchor,
  scrollToConsoleAnchor,
  toolAnchorValue,
  toolCallIdOfStep,
  turnAnchorValue,
  userAnchorValue,
  type ConsoleNavRef,
  type ConsoleNavTarget,
} from "./console-anchors";
import { notifyError } from "../../lib/notify";

type Phase = ReturnType<typeof deriveRunBarView>["phase"];

export type ConversationPaneProps = {
  test: Test;
  mode: "automated" | "interactive";
  runId: string | null;
  stream: RunStreamState;
  phase: Phase;
  /**
   * Unified Sessions (WP3.3, D-US1) — the run's LIVE orthogonal lifecycle phase (from
   * `use-run-stream`'s folded `{type:"phase"}` events), distinct from the coarser `phase` above
   * (which never itself distinguishes "running-but-paused-on-the-operator" from "running-and-
   * streaming"). Composer-area concern ONLY: while `"stopping"` (the terminal verdict is written and
   * the loop is winding down — WP1.1's stop-ordering), the composer is held closed even though the
   * coarse `phase` still reads "running" — sending a new turn into a session that's already ending
   * would race the shutdown. `undefined`/`null` (a caller without it, or no distinct live phase) is a
   * no-op — composer gating is unchanged from before this field existed.
   */
  livePhase?: SessionPhase | null;
  /** The lifted cross-highlight selection (shared with the right-pane packet log, WP 3.6). */
  selectedStepId: string | null;
  onSelectStep: (stepId: string | null) => void;
  /**
   * T6f — review mode: the run is terminal (opened read-only for review). In review the transcript
   * opens at the TOP (turn 1 — the opener prompt) instead of auto-scrolled to the last token, and a
   * "jump to top" affordance appears once scrolled down (symmetric to the always-present
   * scroll-to-bottom "jump to end"). Live runs keep the stick-to-bottom behaviour so new tokens stay
   * in view. Known at mount for a finished run (the route resolves the run's terminal status first),
   * so the initial scroll position is correct without a post-mount jump.
   */
  reviewMode: boolean;
  /**
   * WP 3.2 — a nonce'd chat-scroll target from a cross-representation link (a turn in the rail, a
   * context-window column, an Analytics→Errors card, or a Trace row). Null when nothing is pending;
   * the chat scrolls to the target's anchor whenever the nonce changes. A `tool` ref falls back to
   * its containing turn (the chat anchors turns, not individual tool cards).
   */
  navTarget: ConsoleNavTarget | null;
  /** WP 3.2 — reveal the Trace tab at this call/turn (a chat tool card's "View in trace"). */
  onShowInTrace: (ref: ConsoleNavRef) => void;
  /**
   * Unified Sessions WP 3.2 (D-US4) — the run's resolved session capability manifest, threaded
   * through from `RunConsole` (the same value it already passes to `KpiRail`). GATING ONLY (this pane
   * is a seam — WP 3.3 owns the composer-area affordances like End-session/waiting chips): drives
   * — `capabilities.liveReasoning`: `"none"` hides the Reasoning disclosure entirely; `"raw"` keeps
   *   the verbatim stream (today's default);
   * — `capabilities.followUps`: gates whether the composer accepts a follow-up send;
   * — `capabilities.askUser`: gates the `QuestionPrompt` (ask-the-operator) card.
   */
  capabilities: SessionCapabilities;
  /**
   * Auto-Rating (AR11) — true while the TERMINAL run's post-run review is still in flight
   * (`ratingState` pending|rating). Renders a small shimmer "Reviewing & rating run…" row below the
   * last message (the same in-flight affordance as the "Thinking…" shimmer); it disappears once the
   * rating settles. Never shown for a still-live run.
   */
  reviewing?: boolean;
};

/**
 * Left pane (UI §3): the streaming conversation as a SEQUENCED AGENTIC TIMELINE. We consume Wave-1's
 * ordered, turn-segmented `stream.timeline` ({@link TimelineItem}) and render it as a FLAT SERIES OF
 * SIBLING BLOCKS inside `ConversationContent` (the `@elabs-ai/components-ai` reference sequences a turn flat — not
 * one wrapping card). Per timeline item:
 *   - a user turn (opener prompt or interactive follow-up) → `UserMessage` > `MessageContent`;
 *   - each assistant turn IN CHRONOLOGICAL ORDER → its `Reasoning` disclosure, then its prose
 *     (`AgentMessage` + `ChatMarkdown` — the announcement precedes the calls it triggers, like a
 *     real Claude session), then its tool calls as one-line collapsed rows (≥2 fold into a `Task`);
 *     while in-flight with nothing to show yet, a `Shimmer` "Thinking…" affordance.
 *
 * The terminal/error notices + the empty/pending state render as foot-of-transcript siblings. Each
 * tool block keeps the cross-pane Inspect (a composed `@elabs-ai/components-ui` Button, lifted `selectedStepId`).
 * Data is the accumulated stream — no fabricated content, only what the run actually emitted.
 */
export function ConversationPane({
  test,
  mode,
  runId,
  stream,
  phase,
  livePhase,
  selectedStepId,
  onSelectStep,
  reviewMode,
  navTarget,
  onShowInTrace,
  capabilities,
  reviewing = false,
}: ConversationPaneProps) {
  const timeline = stream.timeline;
  const isLive = phase === "running" || phase === "pending";
  // Unified Sessions WP 3.2 (D-US4) — a backend that doesn't support operator follow-ups
  // (`capabilities.followUps === false`) never accepts a composer send even in interactive mode.
  // Every current backend declares `followUps:true`, so this is a no-op today; it's the declarative
  // gate a future backend without follow-up support needs with zero new UI branches.
  // Unified Sessions WP3.3 (D-US1) — also held closed while `livePhase === "stopping"`: the terminal
  // verdict is already written and the loop is winding down, so a new turn would race the shutdown.
  // The composer's own status strip already reads "The run isn't awaiting a turn right now." for a
  // disabled send (`Composer.tsx`), so this needs no separate copy here.
  const canSend =
    mode === "interactive" && isLive && capabilities.followUps && livePhase !== "stopping";

  // Interactive: always show the composer (it self-disables when not awaiting a turn, or when the
  // backend doesn't support follow-ups). Automated: show the quiet locked note only while the run is
  // live — not at the foot of a finished one.
  const showComposer = mode === "interactive" || isLive;

  // Track the FIRST user item: only the opener carries the test's attachment chips (matching the old
  // UserTurn which read `test.attachments` on the seeded turn). Interactive follow-ups are text-only.
  let seenUser = false;

  // Server id → human name for the tool rows (cosmetic lookup — a failure quietly falls back to raw
  // ids; run/tool errors themselves still surface loudly through the run stream).
  const serverNames = useServerNames();
  // Observability WP 2.5 (D-OB15) — per-turn "Your verdict" feedback, keyed by the turn's OWN
  // `run_steps.id` (its settled `llm_response` step). Fetched ONCE per run here (batched — mirrors
  // `useServerNames`'s cosmetic-lookup shape) rather than once per turn, so a long transcript doesn't
  // fan out into N redundant identical list calls.
  const [feedbackByStepId, feedbackHandlers] = useTurnFeedback(runId);
  // Show the per-row server chip only when the run actually spans MORE THAN ONE server — on a
  // single-server run the chip is pure repetition (a real Claude session doesn't label every call).
  const multiServer = useMemo(() => {
    const ids = new Set<string>();
    for (const item of timeline) {
      if (item.kind !== "assistant_turn") continue;
      for (const call of item.toolCalls) if (call.serverId) ids.add(call.serverId);
    }
    return ids.size > 1;
  }, [timeline]);

  // The canonical chat surface (v1.5.0): a frameless `ChatShell variant="bare"` — the transcript
  // fades to transparent at the top/bottom scrims and the `Composer` floats on the pane background —
  // with `Conversation` (sticks to the latest token as the run streams) holding the flat turn blocks.
  // The host `ResizablePanel` gives the bounded height that makes the transcript scroll + composer stick.
  return (
    <ChatShell
      variant="bare"
      className="h-full min-h-0"
      composer={
        showComposer ? (
          // Same centered column as the transcript so the composer aligns with the messages.
          <div className="mx-auto w-full max-w-3xl px-2">
            <Composer runId={runId} mode={mode} canSend={canSend} />
          </div>
        ) : undefined
      }
    >
      {/* T6f — in review mode open at the TOP (`initial={false}` on the underlying stick-to-bottom):
          the transcript starts at turn 1 (the opener prompt) rather than snapped to the last token.
          Live runs keep `initial="smooth"` so the stream stays pinned to the newest token. The
          function-children form hands us the stick-to-bottom context so the review-only "jump to top"
          button can drive the same scroll container the built-in "jump to end" button uses. */}
      <Conversation className="min-h-0 flex-1" initial={reviewMode ? false : "smooth"}>
        {(ctx) => (
          <>
            {/* Claude-style reading column: centered, width-capped, with generous side padding so
                messages never run edge-to-edge in a wide pane. */}
            <ConversationContent className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-6 pt-4 pb-24">
              {timeline.map((item) => {
                if (item.kind === "user") {
                  const isFirstUser = !seenUser;
                  seenUser = true;
                  return (
                    <UserTurn
                      key={item.id}
                      item={item}
                      attachments={isFirstUser ? test.attachments : []}
                    />
                  );
                }
                return (
                  <AssistantTurn
                    key={item.id}
                    turn={item}
                    selectedStepId={selectedStepId}
                    onSelectStep={onSelectStep}
                    onShowInTrace={onShowInTrace}
                    serverNames={serverNames}
                    multiServer={multiServer}
                    testId={test.id}
                    runId={runId}
                    feedback={item.stepId ? feedbackByStepId.get(item.stepId) : undefined}
                    onFeedbackChange={feedbackHandlers.onChange}
                    liveReasoning={capabilities.liveReasoning}
                  />
                );
              })}

              {timeline.length === 0 ? <PendingAssistant phase={phase} /> : null}

              {/* The agent's `ask_user` prompts — rendered at the foot of the live conversation (where
                  the operator acts) with a one-click option / free-text answer form. Live interactive
                  runs only; a finished/replayed run clears these via `question_resolved`, and the
                  question + answer stay visible in history as the `ask_user` tool-call card. WP 3.2
                  (D-US4) — `QuestionPrompt` itself also self-gates on `askUser`; passed through so a
                  backend without the tool (`capabilities.askUser === false`) never shows the form even
                  if `stream.questions` were somehow non-empty (defensive). */}
              {isLive ? (
                <QuestionPrompt
                  runId={runId}
                  questions={stream.questions}
                  askUser={capabilities.askUser}
                />
              ) : null}

              <TerminalNotice phase={phase} streamError={stream.error} mode={mode} />

              {/* AR11 — the post-run review's in-flight affordance, BELOW the last message (the same
                  shimmer pattern as the "Thinking…" row). Only while terminal + unsettled rating;
                  it disappears once the review settles (rated/failed/skipped). */}
              {reviewing && !isLive ? (
                <AgentMessage>
                  <MessageContent>
                    <Shimmer>Reviewing &amp; rating run…</Shimmer>
                  </MessageContent>
                </AgentMessage>
              ) : null}
            </ConversationContent>
            {/* WP 3.2 — scroll the chat to a cross-link target (turn/tool) when its nonce changes. */}
            <ChatAnchorScroller scrollRef={ctx.scrollRef} navTarget={navTarget} />
            {/* Jump to end (scroll-to-bottom) — always available; shows only when not at the bottom. */}
            <ConversationScrollButton />
            {/* Jump to top — review only, symmetric affordance; shows once scrolled away from turn 1. */}
            {reviewMode ? <ScrollToTopButton scrollRef={ctx.scrollRef} /> : null}
          </>
        )}
      </Conversation>
    </ChatShell>
  );
}

/**
 * T6f / F9 — the "jump to top" affordance for review mode. Symmetric to the built-in
 * `ConversationScrollButton` (jump-to-end, bottom-centre): a floating button pinned to the top-centre
 * of the transcript that scrolls the conversation back to turn 1. It reads the stick-to-bottom
 * context's `scrollRef` (the actual scroll container) rather than importing the internal hook, and
 * shows only once the user has scrolled meaningfully away from the top so it doesn't clutter the
 * default at-top review position.
 */
function ScrollToTopButton({ scrollRef }: { scrollRef: { current: HTMLElement | null } }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setShow(el.scrollTop > 120);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [scrollRef]);

  if (!show) return null;
  return (
    <IconButton
      type="button"
      variant="outline"
      size="icon"
      label="Jump to the start of the conversation"
      onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
      className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full"
    >
      <ArrowUp aria-hidden className="size-4" />
    </IconButton>
  );
}

/**
 * WP 3.2 — the chat's cross-link scroller. Renders nothing; on each new `navTarget.nonce` it resolves
 * the target ref to a `data-console-anchor` within the conversation's own scroll container and scrolls
 * to it (a `tool` ref falls back to its turn — the chat anchors turns). Deferred to the next frame so
 * the scroll runs after the freshly-revealed Chat tab has laid out (the Radix Tabs remount the newly
 * active pane). Keyed on the nonce so re-navigating to the SAME turn still fires.
 */
function ChatAnchorScroller({
  scrollRef,
  navTarget,
}: {
  scrollRef: { current: HTMLElement | null };
  navTarget: ConsoleNavTarget | null;
}) {
  const nonce = navTarget?.nonce ?? null;
  useEffect(() => {
    if (!navTarget) return;
    const raf = requestAnimationFrame(() => {
      scrollToConsoleAnchor(scrollRef.current, navTarget.ref);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce is the intended re-trigger key.
  }, [nonce]);
  return null;
}

/**
 * A user turn — the opener prompt or an interactive follow-up — as `@elabs-ai/components-ai` `UserMessage` >
 * `MessageContent`. The opener's attachment chips (the test's attachments) render as `Badge`s inside;
 * follow-ups pass no attachments (the v1 `sendTurn` wire is text-only).
 */
function UserTurn({
  item,
  attachments,
}: {
  item: TimelineUserItem;
  attachments: Test["attachments"];
}) {
  const prompt = item.text.trim();
  return (
    // Observability (WP3.4) — anchored so the in-run search's "prompt" hits (which have no
    // `turnIndex` of their own) can scroll the chat to this user turn (`navigateTo("chat", { kind:
    // "user", stepId })`), mirroring how `AssistantTurn` anchors itself below.
    <div className="min-w-0" {...consoleAnchor(userAnchorValue(item.id))}>
      <UserMessage>
        <MessageContent>
          <div className="flex flex-col gap-3">
            {prompt.length > 0 ? (
              <Text className="min-w-0 whitespace-pre-wrap break-words">{prompt}</Text>
            ) : (
              <Text tone="muted">No prompt text.</Text>
            )}
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((attachment) => (
                  <Badge key={attachment.id} variant="secondary" className="gap-1 font-normal">
                    <FileText className="size-3" aria-hidden />
                    <span className="truncate" title={attachment.name}>
                      {attachment.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatBytes(attachment.bytes)}
                    </span>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </MessageContent>
      </UserMessage>
    </div>
  );
}

/**
 * One assistant turn, FLATTENED into sibling blocks (NOT a wrapping card) in CHRONOLOGICAL order —
 * the order the model actually emitted things, which is how a real Claude session reads:
 *
 *   1. the `Reasoning` disclosure (thinking precedes everything),
 *   2. the turn's PROSE (the model announces what it's about to do — "Now describing the app…"),
 *   3. THEN the tool calls that announcement triggered.
 *
 * (The previous tools-before-prose order rendered every narrative backwards: the call appeared,
 * already completed, ABOVE the sentence that announced it.)
 *
 * Tool calls render as one-line collapsed {@link ToolCallCard} rows. Two or more calls in a turn
 * fold into a `@elabs-ai/components-ai` `Task` ("Used N tools · duration") — open while the turn is live so the
 * activity streams in view, collapsed when reviewing a finished run. While the turn is streaming
 * with nothing to show yet, a `Shimmer` stands in.
 */
function AssistantTurn({
  turn,
  selectedStepId,
  onSelectStep,
  onShowInTrace,
  serverNames,
  multiServer,
  testId,
  runId,
  feedback,
  onFeedbackChange,
  liveReasoning,
}: {
  turn: TimelineAssistantTurn;
  selectedStepId: string | null;
  onSelectStep: (stepId: string | null) => void;
  onShowInTrace: (ref: ConsoleNavRef) => void;
  serverNames: Record<string, string>;
  multiServer: boolean;
  testId: string;
  runId: string | null;
  /**
   * Observability WP 2.5 (D-OB15) — this turn's own "Your verdict" row (keyed off `turn.stepId` by
   * the caller's batched `useTurnFeedback`), or `undefined` when unset/not-yet-settled.
   */
  feedback: RunFeedback | undefined;
  /** Propagates a write from this turn's `FeedbackControl` back up into the shared per-run map. */
  onFeedbackChange: (stepId: string, next: RunFeedback | undefined) => void;
  /**
   * Unified Sessions WP 3.2 (D-US4) — `capabilities.liveReasoning`: `"none"` renders no Reasoning
   * disclosure at all (defensive — a backend that declares no reasoning surface never shows one even
   * if a stray `reasoningText` were present); `"raw"` keeps the verbatim stream.
   */
  liveReasoning: SessionCapabilities["liveReasoning"];
}) {
  const reasoning = liveReasoning === "none" ? undefined : turn.reasoningText?.trim();
  const prose = turn.assistantText?.trim();
  const reasoningTokens = turn.usageActual?.reasoningTokens;
  const toolRows = turn.toolCalls.map((call) => {
    const toolCallId = toolCallIdOfStep(call.call);
    return (
      <ToolCallCard
        key={call.id}
        call={call}
        selected={selectedStepId === call.id || selectedStepId === call.result?.id}
        onInspect={() => onSelectStep(selectedStepId === call.id ? null : call.id)}
        // WP 3.2 — reveal this call in the Trace tree (tool ref, chat-side turn fallback).
        onShowInTrace={
          toolCallId
            ? () => onShowInTrace({ kind: "tool", toolCallId, turnIndex: turn.turnIndex })
            : undefined
        }
        serverName={call.serverId ? (serverNames[call.serverId] ?? call.serverId) : undefined}
        showServerChip={multiServer}
      />
    );
  });

  // Observability WP 2.5 (D-OB15) — a local, definitely-typed capture of the turn's step id for the
  // feedback control's `onChange` closure below (avoids re-deriving/casting `turn.stepId` inside it).
  const feedbackStepId = turn.stepId;

  // WP 3.2 — the turn's flat sibling blocks are grouped under one anchored wrapper so a cross-link
  // (turn index / context column / error card / Trace row) can scroll the chat to this turn. The
  // wrapper preserves the exact `gap-4` rhythm (it's a flex column with the same gap), so the flat
  // series of blocks reads identically to before (2.5's layout) while gaining a scroll target.
  return (
    <div
      className="flex min-w-0 flex-col gap-4"
      {...consoleAnchor(turnAnchorValue(turn.turnIndex))}
    >
      {reasoning && reasoning.length > 0 ? (
        // WP 6.2 (item A) — while a turn is LIVE we no longer force the disclosure closed. Passing
        // `defaultOpen={undefined}` lets `@elabs-ai/components-ai` `Reasoning` use its own `defaultOpen ?? isStreaming`
        // → open while streaming, auto-collapse ~1s after it settles (its intended behavior). A
        // finished/REPLAYED turn (`streaming` false at mount, never streamed) keeps `defaultOpen={false}`
        // so review opens collapsed, exactly as before. Applies to every run kind (the library default).
        <Reasoning
          className="min-w-0"
          isStreaming={turn.streaming}
          defaultOpen={turn.streaming ? undefined : false}
        >
          <ReasoningTrigger
            getThinkingMessage={(isStreaming) =>
              isStreaming
                ? "Thinking…"
                : typeof reasoningTokens === "number" && reasoningTokens > 0
                  ? `Thought process · ${formatNumber(reasoningTokens)} tok`
                  : "Thought process"
            }
          />
          <ReasoningContent>{reasoning}</ReasoningContent>
        </Reasoning>
      ) : null}

      {/* Tool calls render BEFORE the answer (chronological): the model calls tools, then writes its
          final answer. On the subscription path an entire turn's tools land in ONE turn, so the fold
          belongs between the prompt/reasoning and the settled answer — matching the Assistant dock and
          the API-keyed multi-turn layout (where tools were already earlier turns). */}
      {turn.toolCalls.length === 1 ? (
        <div className="min-w-0">{toolRows}</div>
      ) : turn.toolCalls.length > 1 ? (
        // Collapsed by default when reviewing; a LIVE turn mounts open (its status is still
        // `running` at mount) so streamed activity stays in view. Uncontrolled after that — the
        // user's own toggle always wins.
        <Task className="min-w-0" defaultOpen={turn.status === "running"}>
          <TaskTrigger title={taskTitle(turn)} />
          <TaskContent>
            <div className="flex min-w-0 flex-col gap-1.5">{toolRows}</div>
          </TaskContent>
        </Task>
      ) : null}

      {prose && prose.length > 0 ? (
        <AgentMessage className="group/msg">
          <MessageContent>
            <ChatMarkdown text={prose} streaming={turn.streaming} />
          </MessageContent>
          {/* Copy the COMPLETE message (its raw markdown) — hover/focus-revealed like a real Claude
              session; hidden while streaming so a partial answer can't be copied. Always copies the
              verbatim `assistantText` (= `prose`), never the block projection. */}
          {!turn.streaming ? <CopyMessageAction text={prose} /> : null}
          {/* Observability WP 2.5 (D-OB15) — per-turn "Your verdict" thumbs, hover/focus-revealed like
              Copy above, sharing the SAME `group/msg` (from the enclosing `AgentMessage`). Gated on
              `turn.stepId` (only set once the closing `llm_response` has actually persisted — see
              `use-run-stream.ts`) rather than `turn.streaming` alone, so it never targets a step that
              doesn't exist server-side yet. `hideLabel` keeps the row compact; the tooltip still names
              it "Your verdict" so it never reads as a grade. */}
          {feedbackStepId && runId ? (
            <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
              <FeedbackControl
                runId={runId}
                stepId={feedbackStepId}
                current={feedback}
                onChange={(next) => onFeedbackChange(feedbackStepId, next)}
                size="sm"
                hideLabel
              />
            </div>
          ) : null}
        </AgentMessage>
      ) : null}

      {(!prose || prose.length === 0) &&
      turn.streaming &&
      turn.toolCalls.length === 0 &&
      (!reasoning || reasoning.length === 0) ? (
        <AgentMessage>
          <MessageContent>
            <Shimmer>Thinking…</Shimmer>
          </MessageContent>
        </AgentMessage>
      ) : null}
    </div>
  );
}

/**
 * The assistant message's hover-revealed action row: copy the whole message's raw markdown to the
 * clipboard (`@elabs-ai/components-ai` `MessageActions`/`MessageAction`). Revealed on message hover AND on
 * keyboard focus (`group-focus-within`), so it stays reachable without a pointer; the icon flips to
 * a check for a moment as confirmation, and a clipboard failure surfaces as a toast (never silent).
 */
function CopyMessageAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <MessageActions className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
      <MessageAction
        tooltip={copied ? "Copied" : "Copy message"}
        label="Copy message"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            notifyError("Couldn’t copy to the clipboard.", {
              description: "Select and copy the text manually instead.",
            });
          }
        }}
      >
        {copied ? (
          <Check aria-hidden className="size-3.5 text-primary" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </MessageAction>
    </MessageActions>
  );
}

/** "Used 3 tools · 4.2 s" — the per-turn activity fold's one-line summary. */
function taskTitle(turn: TimelineAssistantTurn): string {
  const n = turn.toolCalls.length;
  const totalMs = turn.toolCalls.reduce((sum, c) => {
    const ms = c.result?.durationMs ?? c.call.durationMs;
    return typeof ms === "number" ? sum + ms : sum;
  }, 0);
  const running = turn.toolCalls.some((c) => !c.result && c.call.status === "running");
  const base = `Used ${n} tool${n === 1 ? "" : "s"}`;
  if (running) return `${base}…`;
  return totalMs > 0 ? `${base} · ${formatDuration(totalMs)}` : base;
}

/**
 * Server id → display name, fetched once per pane mount. Purely cosmetic (the tool rows fall back
 * to raw ids while loading / on failure), so a lookup error degrades silently rather than surfacing
 * a toast — run and tool errors themselves still flow through the run stream.
 */
function useServerNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    apiGet<ServerConfig[]>("/api/servers")
      .then((servers) => {
        if (!alive) return;
        setNames(Object.fromEntries(servers.map((s) => [s.id, s.name])));
      })
      .catch(() => {
        /* cosmetic lookup — rows keep showing raw server ids */
      });
    return () => {
      alive = false;
    };
  }, []);
  return names;
}

/** Honest empty/pending state before the first item of the timeline — the `@elabs-ai/components-ai`
 *  `ConversationEmptyState` (the chat-specific empty state; replaces the generic `EmptyState`,
 *  2026-07-12 brand-ui alignment). */
function PendingAssistant({ phase }: { phase: Phase }) {
  if (phase === "error" || phase === "context_overflow") return null; // the terminal notice covers it
  return (
    <ConversationEmptyState
      icon={<MessageSquare aria-hidden className="size-6" />}
      title="Waiting for the first token"
      description="The conversation — user turns, the assistant's reasoning, tool calls, and its messages — streams in here as the run produces them."
    />
  );
}

/** Terminal/error states rendered inline at the foot of the transcript. D-US11 naming pass: the
 *  copy names the container "session" for an interactive run, "run" otherwise. */
function TerminalNotice({
  phase,
  streamError,
  mode,
}: {
  phase: Phase;
  streamError: string | null;
  mode: "automated" | "interactive";
}) {
  const noun = mode === "interactive" ? "session" : "run";
  if (phase === "context_overflow") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Context window exceeded</AlertTitle>
        <AlertDescription>
          The conversation outgrew the model's context limit and the {noun} stopped. The transcript
          up to the overflow is preserved above for inspection.
        </AlertDescription>
      </Alert>
    );
  }
  if (phase === "error") {
    return (
      <ErrorState
        title={`Couldn’t complete the ${noun}.`}
        description={
          streamError
            ? `${streamError} See the step log on the right for details.`
            : `The ${noun} ended with an error. See the step log on the right for details.`
        }
      />
    );
  }
  return null;
}
