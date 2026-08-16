import { useEffect, useMemo, useRef, useState } from "react";
import {
  hubTaskItemSchema,
  type HubCitation,
  type HubEvent,
  type HubLimitRetrySource,
  type HubMessagePart,
  type HubOpenQuestion,
  type HubTaskItem,
  type HubToolPart,
  type HubUsage,
  type RunPhase,
  type SessionCostBasis,
  type WaitingInputReason,
} from "@mcp-token-footprint/shared";
import { openHubSessionStream, type HubSseFrame } from "../../lib/api";

/**
 * Assistant Hub (roadmap/assistant-hub/, WP1.3, §1.4/§1.9) — the SSE client for one hub session.
 *
 * Mirrors `features/testing/use-run-stream.ts` (seq-dedup, replay-then-live, terminal-ONLY errors —
 * `.claude/rules/loading-states.md`) but a hub session has NO per-request terminal status: it is a
 * long-lived thread across many turns, exactly like the Assistant dock's `use-assistant-stream.ts`
 * (which this hook is the closer structural twin of). So "terminal" here means "the caller itself
 * ended this subscription" (a session switch / unmount), tracked by `closedRef`, never a server-
 * reported finish — an `onerror` after that point is the expected close, not a drop. Any `onerror`
 * BEFORE that point is a genuine mid-turn transport drop and surfaces the connection-lost sentinel
 * (self-clearing once the browser's automatic reconnect + `Last-Event-ID` replay catches back up).
 *
 * A key data quirk this hook works around (see `buildHubTimeline`'s doc comment): the turn engine
 * (`apps/api/src/hub/turn-engine.ts`) persists a tool-call `HubMessagePart` inside the settled
 * `assistant_message.parts` array frozen at `state: "input-available"` — it never merges the later
 * `tool_result` event back onto that part object before persistence. So the CURRENT terminal state of
 * a tool call (`output-available`/`output-error`/`output-denied`) is only knowable by correlating the
 * standalone `tool_call`/`tool_result` events by `toolCallId`, exactly like `use-run-stream.ts`'s
 * `buildTimeline` already does for the testing engine's own step pairs. `buildHubTimeline` does that
 * correlation and swaps the fresher, merged part into the settled message's rendered parts array so
 * every part still renders in its ORIGINAL settled order (R-SES2) with an ACCURATE R-UX1 state.
 */

// ── Timeline model (exported; ConversationPane consumes these) ──────────────────────────────────────

export type HubTimelineUserItem = {
  kind: "user";
  id: string;
  text: string;
  model?: string;
};

/** An un-injected `queued_user_message` (R-SES3) — a steering message typed while a turn was running
 *  that hasn't been injected as a `user_message` yet (survives restart; see `pendingHubQueuedMessages`). */
export type HubTimelineQueuedItem = {
  kind: "queued";
  id: string;
  queuedMessageId: string;
  text: string;
  model?: string;
};

/** One tool call within a turn — the settled `tool_call` part MERGED with its `tool_result` (if any
 *  arrived), so `part.state` always reflects the true R-UX1 terminal state. `startedAt` (the opening
 *  `tool_call` event's envelope timestamp) drives the R-UX3 per-row elapsed ticker while running. */
export type HubTimelineToolCall = {
  id: string;
  part: HubToolPart;
  startedAt?: string;
};

/** One assistant turn — everything between a (queued-)user message and its `turn_done`. */
export type HubTimelineAssistantTurn = {
  kind: "assistant_turn";
  id: string;
  messageId?: string;
  model?: string;
  /** The ORDERED rendered parts (R-SES2) — tool_call parts here are the MERGED, accurate-state ones
   *  (see the module doc), not the frozen ones the persisted `assistant_message` itself carries. */
  parts: HubMessagePart[];
  toolCalls: HubTimelineToolCall[];
  usage?: HubUsage;
  citations: HubCitation[];
  costUsd?: number;
  costBasis?: SessionCostBasis;
  finishReason?: string;
  limitError?: {
    message: string;
    retrySources?: HubLimitRetrySource[];
    limitKind?: string;
    provider?: string;
  };
  errorMessage?: string;
  authRequired?: boolean;
  /** hub-fixes WP1.3 (RC3.4) — granted MCP servers that DROPPED at this turn's toolset resolution
   *  (folded from any `mcp_server_status` events with `status: "error"` that landed while this turn was
   *  opening — see the module doc's event ordering note). A future consumer (the ConversationPane inline
   *  notice this WP's spec calls for; WP3.1 owns that file) renders this list; this mapping alone is
   *  this WP's deliverable, proven by `buildHubTimeline`'s own tests. Deduped per turn by `serverId`. */
  mcpServerIssues?: {
    serverId: string;
    serverName: string;
    message?: string;
    /** A reauth-able auth failure (401/403 on an oauth-http server) — the pane offers "Authenticate". */
    authRequired?: boolean;
  }[];
  /** True only for the single, trailing, not-yet-settled turn while the session is live. */
  streaming: boolean;
};

/**
 * NOTE: `HubTimelineQueuedItem` is intentionally NOT a member of this union — a still-pending
 * `queued_user_message` is surfaced separately via {@link pendingHubQueuedMessages} (a distinct "up
 * next" tray the composer/pane render below the settled timeline), not interleaved into it. Once a
 * queued message is actually injected it arrives as a real `user_message` and appears here normally
 * — interleaving a synthetic placeholder that later gets replaced by the real one would flash/duplicate.
 */
export type HubTimelineItem = HubTimelineUserItem | HubTimelineAssistantTurn;

/**
 * WP2.3 (R-MCP4) — an active MCP elicitation surfaced to the operator, derived from the live
 * `elicitation_requested`/`elicitation_responded` events. Rendered by `ConversationPane`'s
 * `ElicitationPanel` (form mode via the schema→form generator, or URL mode). `elicitationId` is the
 * handle the response route (`submit`/`decline`) resolves.
 */
export type HubElicitationRequest = {
  elicitationId?: string;
  toolCallId?: string;
  toolName?: string;
  message: string;
  mode: "form" | "url";
  /** Flat JSON schema (form mode) — rendered through the app's existing schema→form generator. */
  schema?: unknown;
  /** The full URL (url mode) — shown with domain emphasis; never auto-opened/prefetched (R-MCP4/12). */
  url?: string;
};

/** Accumulated stream state, folded from the settled `HubEvent` log + live `stream_delta` frames. */
export type HubStreamState = {
  /** Settled events, seq-ascending, deduped by seq (the durable replay log — R-SES1). */
  events: HubEvent[];
  /** Live text/reasoning accumulated per in-flight `messageId` (never persisted — settled parts carry
   *  the final text). Cleared lazily; a settled/old messageId's entry is simply never read again. */
  deltaText: Record<string, string>;
  deltaReasoning: Record<string, string>;
  /** The CURRENT in-flight assistant message id, while a turn is running and hasn't settled yet.
   *  `null` once the turn's `assistant_message`/`turn_done` has been applied. */
  liveMessageId: string | null;
  /** True from a settled `user_message` until `turn_done`/`limit_error`/`error` closes the turn. */
  turnRunning: boolean;
  /** The session's current orthogonal lifecycle phase (D-US1), folded from `{type:"phase"}` events. */
  phase: RunPhase | null;
  queuePosition: number | null;
  phaseDeadlineAt: string | null;
  waitingReason: WaitingInputReason | null;
  /** The connection-lost sentinel OR the last genuine `error`/`limit_error` event's message — cleared
   *  by the next settled `user_message` (the session stays usable after an error, unlike a run). */
  error: string | null;
  /** Sticky once true: a terminal `error` event reported that an OAuth server needs interactive reauth. */
  authRequired: boolean;
  /** WP2.3 (R-MCP4) — the currently-pending MCP elicitation (form/URL), or null. Set on
   *  `elicitation_requested`, cleared on the matching `elicitation_responded`. */
  pendingElicitation: HubElicitationRequest | null;
  /** The still-open agent-initiated `ask_user` questions (each a `question` with no later
   *  `question_resolved`), rendered as answer cards. Upserted on `question`, removed on
   *  `question_resolved`. Recovered on replay from the append-only log alone (R-SES1). */
  openQuestions: HubOpenQuestion[];
};

const EMPTY_STATE: HubStreamState = {
  events: [],
  deltaText: {},
  deltaReasoning: {},
  liveMessageId: null,
  turnRunning: false,
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
  waitingReason: null,
  error: null,
  authRequired: false,
  pendingElicitation: null,
  openQuestions: [],
};

/** Set on a PRE-close transport drop; cleared by the next freshly-applied frame. Kept as a constant so
 *  the recovery path recognizes + clears exactly this sentinel, never a genuine error message. */
const CONNECTION_LOST = "Assistant session stream connection lost.";

/** Fold one SETTLED `HubEvent` into state (never a delta — {@link reduceHubFrame} applies those). */
export function reduceHubEvent(state: HubStreamState, event: HubEvent): HubStreamState {
  const events = [...state.events, event];
  switch (event.type) {
    case "user_message":
      // A fresh turn starts: the in-flight message id isn't known yet (populated by the first tool
      // call / delta of the new pass), and a stale error from a prior turn no longer applies.
      return { ...state, events, turnRunning: true, liveMessageId: null, error: null };
    case "queued_user_message":
      // Durable steering (R-SES3) — recorded in `events`; `pendingHubQueuedMessages` derives the
      // still-pending subset for the composer's queue indicator. Doesn't change `turnRunning` (a
      // message can only queue while a turn is already running).
      return { ...state, events };
    case "tool_call":
      return { ...state, events, liveMessageId: event.messageId ?? state.liveMessageId };
    case "assistant_message":
      return {
        ...state,
        events,
        liveMessageId: state.liveMessageId === event.messageId ? null : state.liveMessageId,
      };
    case "turn_done":
      return { ...state, events, turnRunning: false, liveMessageId: null };
    case "limit_error":
      return { ...state, events, turnRunning: false, liveMessageId: null, error: event.message };
    case "error":
      return {
        ...state,
        events,
        turnRunning: false,
        liveMessageId: null,
        error: event.message,
        authRequired: state.authRequired || event.authRequired === true,
      };
    case "phase":
      return {
        ...state,
        events,
        phase: event.phase,
        queuePosition: event.phase === "queued" ? (event.detail?.position ?? null) : null,
        phaseDeadlineAt: event.detail?.deadlineAt ?? null,
        waitingReason: event.phase === "waiting_input" ? (event.detail?.reason ?? null) : null,
      };
    case "elicitation_requested":
      // WP2.3 (R-MCP4) — an MCP elicitation is now pending; surface it for `ElicitationPanel`.
      return {
        ...state,
        events,
        pendingElicitation: {
          elicitationId: event.elicitationId,
          message: event.message,
          mode: event.mode,
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          ...(event.requestedSchema !== undefined ? { schema: event.requestedSchema } : {}),
          ...(event.url ? { url: event.url } : {}),
        },
      };
    case "elicitation_responded":
      // Clear the pending elicitation once its matching response settles (incl. an auto-declined one).
      return {
        ...state,
        events,
        pendingElicitation:
          state.pendingElicitation?.elicitationId === event.elicitationId
            ? null
            : state.pendingElicitation,
      };
    case "question":
      // An agent-initiated `ask_user` — upsert the open-question card (idempotent on replay by id).
      return {
        ...state,
        events,
        openQuestions: [
          ...state.openQuestions.filter((q) => q.questionId !== event.questionId),
          {
            questionId: event.questionId,
            prompt: event.prompt,
            ...(event.options && event.options.length > 0 ? { options: event.options } : {}),
            ...(event.allowOther !== undefined ? { allowOther: event.allowOther } : {}),
          },
        ],
      };
    case "question_resolved":
      // The question settled (answered or stopped) — remove its card.
      return {
        ...state,
        events,
        openQuestions: state.openQuestions.filter((q) => q.questionId !== event.questionId),
      };
    default:
      // tool_result / reasoning / ui_state / mission·artifact·memory·file·workspace·review·branch /
      // mcp_server_status (hub-fixes WP1.3) events — recorded in `events` for `buildHubTimeline`/
      // `deriveHubTasks` to read; no extra top-level state.
      return { ...state, events };
  }
}

/** Fold one wire frame (a settled event OR a transient delta) into state. Exported for reducer unit
 *  tests; the hook applies frames one at a time as they arrive off the `EventSource`. */
export function reduceHubFrame(state: HubStreamState, frame: HubSseFrame): HubStreamState {
  if (frame.type === "stream_delta") {
    const key = frame.messageId;
    if (frame.channel === "text") {
      return {
        ...state,
        liveMessageId: key,
        deltaText: { ...state.deltaText, [key]: (state.deltaText[key] ?? "") + frame.text },
      };
    }
    return {
      ...state,
      liveMessageId: key,
      deltaReasoning: {
        ...state.deltaReasoning,
        [key]: (state.deltaReasoning[key] ?? "") + frame.text,
      },
    };
  }
  if (frame.type === "ping") return state; // heartbeat only — never persisted, never rendered
  return reduceHubEvent(state, frame);
}

// ── Pure derivations (exported; unit-testable without React) ────────────────────────────────────────

/** The still-pending steering messages (R-SES3): a `queued_user_message` with no later `user_message`
 *  carrying its id as `messageId` (the engine's own injection correlation — mirrors the API's
 *  `HubSteeringQueue.reconstructPending`, reimplemented here since `apps/web` cannot import `apps/api`). */
export function pendingHubQueuedMessages(events: readonly HubEvent[]): HubTimelineQueuedItem[] {
  const injected = new Set(
    events
      .filter((e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message")
      .map((e) => e.messageId),
  );
  return events
    .filter(
      (e): e is Extract<HubEvent, { type: "queued_user_message" }> =>
        e.type === "queued_user_message",
    )
    .filter((e) => !injected.has(e.queuedMessageId))
    .map((e) => ({
      kind: "queued",
      id: e.queuedMessageId,
      queuedMessageId: e.queuedMessageId,
      text: e.text,
      ...(e.model ? { model: e.model } : {}),
    }));
}

/**
 * R-SES4 — reconstruct the live task-widget list by replaying `tasks.create`/`tasks.update`
 * tool-call/tool-result pairs (`output-available` only), reconciled by id, in `seq` order. Pure port
 * of the API's `apps/api/src/hub/tools/builtins/tasks.ts` `reconstructTasks` (there is deliberately no
 * `hub_tasks` table — task state transitions ARE the event log, R-SES1) — kept in sync by design: both
 * read only the same generic `tool_call`/`tool_result` shape every OTHER tool call also produces.
 */
export function deriveHubTasks(events: readonly HubEvent[]): HubTaskItem[] {
  const toolNameByCallId = new Map<string, string>();
  const tasks = new Map<string, HubTaskItem>();
  const order: string[] = [];

  for (const event of events) {
    if (event.type === "tool_call") {
      toolNameByCallId.set(event.part.toolCallId, event.part.toolName);
      continue;
    }
    if (event.type !== "tool_result" || event.state !== "output-available") continue;
    const toolName = toolNameByCallId.get(event.toolCallId);
    if (toolName !== "tasks.create" && toolName !== "tasks.update") continue;
    const parsed = hubTaskItemSchema.safeParse(event.modelContent);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (!tasks.has(item.id)) order.push(item.id);
    tasks.set(item.id, item);
  }

  return order.map((id) => tasks.get(id)).filter((item): item is HubTaskItem => item !== undefined);
}

function upsertToolCall(
  index: Map<string, HubTimelineToolCall>,
  part: HubToolPart,
  startedAt?: string,
): HubTimelineToolCall {
  const existing = index.get(part.toolCallId);
  if (existing) {
    existing.part = part;
    return existing;
  }
  const entry: HubTimelineToolCall = {
    id: part.toolCallId,
    part,
    ...(startedAt ? { startedAt } : {}),
  };
  index.set(part.toolCallId, entry);
  return entry;
}

/**
 * Reconstruct the ordered conversation timeline from the settled event log + the live delta text/
 * reasoning for the current unsettled turn. See the module doc for why tool parts are MERGED rather
 * than read verbatim off the settled `assistant_message.parts` array.
 */
export function buildHubTimeline(state: HubStreamState): HubTimelineItem[] {
  const items: HubTimelineItem[] = [];
  const toolIndex = new Map<string, HubTimelineToolCall>();
  let currentTurn: HubTimelineAssistantTurn | null = null;

  const openTurn = (messageId?: string): HubTimelineAssistantTurn => {
    if (currentTurn) return currentTurn;
    currentTurn = {
      kind: "assistant_turn",
      id: messageId ?? `assistant-${items.length}`,
      ...(messageId ? { messageId } : {}),
      parts: [],
      toolCalls: [],
      citations: [],
      streaming: true,
    };
    items.push(currentTurn);
    return currentTurn;
  };

  for (const event of state.events) {
    switch (event.type) {
      case "user_message":
        items.push({
          kind: "user",
          id: event.messageId,
          text: event.text,
          ...(event.model ? { model: event.model } : {}),
        });
        currentTurn = null; // the next assistant-side event opens a fresh turn
        break;
      case "tool_call": {
        const turn = openTurn(event.messageId);
        if (!turn.messageId && event.messageId) turn.messageId = event.messageId;
        const entry = upsertToolCall(toolIndex, event.part, event.at);
        turn.toolCalls.push(entry);
        break;
      }
      case "tool_result": {
        const existing = toolIndex.get(event.toolCallId);
        const merged: HubToolPart = existing
          ? {
              ...existing.part,
              state: event.state,
              modelContent: event.modelContent,
              ...(event.artifact ? { artifact: event.artifact } : {}),
              ...(event.isError !== undefined ? { isError: event.isError } : {}),
              ...(event.errorText !== undefined ? { errorText: event.errorText } : {}),
              ...(event.metering ? { metering: event.metering } : {}),
            }
          : {
              // A result with no matching open call (out-of-order/foreign) — synthesize a standalone
              // part rather than drop it silently (mirrors use-run-stream.ts's own fallback).
              type: "tool_call",
              toolCallId: event.toolCallId,
              toolName: "unknown",
              source: "builtin",
              state: event.state,
              modelContent: event.modelContent,
              ...(event.artifact ? { artifact: event.artifact } : {}),
              ...(event.isError !== undefined ? { isError: event.isError } : {}),
              ...(event.errorText !== undefined ? { errorText: event.errorText } : {}),
            };
        const entry = upsertToolCall(toolIndex, merged);
        if (!existing) openTurn().toolCalls.push(entry);
        break;
      }
      case "approval_requested": {
        // WP2.3 (R-MCP3/R-UX1) — move the tool part into the `approval-requested` state with its card
        // context (annotations + option kinds), so `ApprovalCard` renders inline. An auto-run
        // (`isAutomatic`) is marked, not surfaced as a pending card.
        const existing = toolIndex.get(event.toolCallId);
        if (existing) {
          existing.part = {
            ...existing.part,
            state: "approval-requested",
            ...(event.annotations ? { annotations: event.annotations } : {}),
            approval: {
              options: event.options,
              ...(event.isAutomatic ? { isAutomatic: event.isAutomatic } : {}),
            },
          };
        }
        break;
      }
      case "approval_responded": {
        const existing = toolIndex.get(event.toolCallId);
        if (existing) {
          existing.part = {
            ...existing.part,
            state: "approval-responded",
            approval: {
              ...(existing.part.approval ?? { options: [] }),
              resolution: event.resolution,
              ...(event.isAutomatic ? { isAutomatic: event.isAutomatic } : {}),
            },
          };
        }
        break;
      }
      case "assistant_message": {
        const turn = openTurn(event.messageId);
        turn.messageId = event.messageId;
        turn.model = event.model;
        if (event.usage) turn.usage = event.usage;
        turn.citations = event.citations;
        if (event.costUsd !== undefined) turn.costUsd = event.costUsd;
        if (event.costBasis) turn.costBasis = event.costBasis;
        if (event.finishReason) turn.finishReason = event.finishReason;
        // The ordered rendered parts (R-SES2): walk the settled order, swapping any tool_call part for
        // its merged, accurate-state entry (see the module doc) so the array stays in ORIGINAL order.
        turn.parts = event.parts.map((part) =>
          part.type === "tool_call" ? (toolIndex.get(part.toolCallId)?.part ?? part) : part,
        );
        turn.streaming = false;
        break;
      }
      case "turn_done": {
        const turn = openTurn(event.messageId);
        turn.streaming = false;
        currentTurn = null; // closed — a later pass (e.g. after steering) opens a new turn
        break;
      }
      case "limit_error": {
        const turn = openTurn();
        turn.limitError = {
          message: event.message,
          ...(event.retrySources ? { retrySources: event.retrySources } : {}),
          ...(event.limitKind ? { limitKind: event.limitKind } : {}),
          ...(event.provider ? { provider: event.provider } : {}),
        };
        turn.streaming = false;
        break;
      }
      case "error": {
        const turn = openTurn();
        turn.errorMessage = event.message;
        if (event.authRequired) turn.authRequired = true;
        turn.streaming = false;
        break;
      }
      // hub-fixes WP1.3 (RC3.4) — a granted MCP server dropped at THIS turn's toolset resolution. It
      // lands right after the turn's opening `user_message` (toolset resolution runs before the model
      // ever streams anything — see `session-service.ts`'s `resolveToolset`), so `openTurn()` here
      // attaches it to the turn that's about to run. Only `status: "error"` is transcript-worthy — a
      // `connected` event needs no inline notice (the rail chip already reflects it); deduped per turn
      // by `serverId` so a re-emitted event (unlikely — the API itself already dedupes on change)
      // never double-lists the same server.
      case "mcp_server_status": {
        if (event.status !== "error") break;
        const turn = openTurn();
        const issues = turn.mcpServerIssues ?? [];
        if (!issues.some((issue) => issue.serverId === event.serverId)) {
          issues.push({
            serverId: event.serverId,
            serverName: event.serverName,
            ...(event.message ? { message: event.message } : {}),
            ...(event.authRequired ? { authRequired: true } : {}),
          });
        }
        turn.mcpServerIssues = issues;
        break;
      }
      // reasoning / ui_state / phase / mission·artifact·memory·file·workspace·review·branch events:
      // not (yet) part of the WP1.3 turn transcript — later WPs (missions/artifacts/citations) render
      // them from the same `events` log without this builder changing shape.
      default:
        break;
    }
  }

  // Synthesize the in-flight turn's live prose while the session is running and the trailing turn
  // hasn't settled (no `assistant_message`/`turn_done` yet for it).
  if (state.turnRunning && state.liveMessageId) {
    const turn = openTurn(state.liveMessageId);
    if (!turn.messageId) turn.messageId = state.liveMessageId;
    const liveText = state.deltaText[state.liveMessageId];
    const liveReasoning = state.deltaReasoning[state.liveMessageId];
    if (turn.streaming) {
      const liveParts: HubMessagePart[] = [];
      if (liveReasoning) liveParts.push({ type: "reasoning", text: liveReasoning });
      for (const entry of turn.toolCalls) liveParts.push(entry.part);
      if (liveText) liveParts.push({ type: "text", text: liveText });
      if (liveParts.length > 0) turn.parts = liveParts;
    }
  }

  return items;
}

/**
 * Subscribe to one hub session's frame stream and accumulate it into console-ready state. Pass `null`
 * to subscribe to nothing (no session selected yet); state resets to empty.
 */
export function useHubStream(sessionId: string | null): HubStreamState & {
  timeline: HubTimelineItem[];
  tasks: HubTaskItem[];
  pendingQueued: HubTimelineQueuedItem[];
} {
  const [state, setState] = useState<HubStreamState>(EMPTY_STATE);
  const activeRef = useRef(false);
  const closedRef = useRef(false);
  const droppedRef = useRef(false);
  // Reconnect de-dup (mirrors `use-run-stream.ts`/`use-assistant-stream.ts`): the server's `id: <seq>`
  // line lets the browser's native `EventSource` reconnect send `Last-Event-ID`, and the server's own
  // cursor-filtered replay (`streamHubSession`'s `lastWrittenSeq`) already avoids resending anything —
  // but a defensive client-side floor is cheap insurance against the SSE spec's own known edge case (a
  // connection dropping mid-write can re-deliver the last frame) and keeps this hook's contract
  // identical to its two siblings. `stream_delta`/`ping` frames carry no `seq` and always apply.
  const lastSeqRef = useRef(-1);

  // Reset the stream state SYNCHRONOUSLY the moment `sessionId` changes — not a render later. The
  // effect below still (re)opens the SSE connection, but if the state reset lived ONLY there, the
  // first render after a session switch would still expose the PREVIOUS session's `timeline` /
  // `turnRunning` (the effect runs post-commit). That one stale render is enough to (a) flash the
  // prior session's transcript and (b) mis-seed AssistantView's per-session first-prompt choreography
  // (a freshly-opened EMPTY session latching "docked" from the old session's timeline, hiding the
  // welcome emblem). Adjusting state during render when a prop changed is the sanctioned React
  // pattern (react.dev "You Might Not Need an Effect" — storing info from previous renders).
  const [streamSessionId, setStreamSessionId] = useState(sessionId);
  if (streamSessionId !== sessionId) {
    setStreamSessionId(sessionId);
    setState(EMPTY_STATE);
    lastSeqRef.current = -1;
  }

  useEffect(() => {
    setState(EMPTY_STATE);
    closedRef.current = false;
    droppedRef.current = false;
    lastSeqRef.current = -1;

    if (!sessionId) return;

    activeRef.current = true;
    const close = openHubSessionStream(
      sessionId,
      (frame) => {
        if (!activeRef.current) return;
        if (
          frame.type !== "stream_delta" &&
          frame.type !== "ping" &&
          typeof frame.seq === "number"
        ) {
          if (frame.seq <= lastSeqRef.current) return; // replayed suffix — already applied
          lastSeqRef.current = frame.seq;
        }
        if (droppedRef.current) {
          droppedRef.current = false;
          setState((current) =>
            current.error === CONNECTION_LOST ? { ...current, error: null } : current,
          );
        }
        setState((current) => reduceHubFrame(current, frame));
      },
      () => {
        if (!activeRef.current) return;
        if (closedRef.current) return; // we intentionally ended this subscription — not a real drop
        droppedRef.current = true;
        setState((current) => (current.error ? current : { ...current, error: CONNECTION_LOST }));
      },
    );

    return () => {
      activeRef.current = false;
      closedRef.current = true;
      close();
    };
  }, [sessionId]);

  const timeline = useMemo(() => buildHubTimeline(state), [state]);
  const tasks = useMemo(() => deriveHubTasks(state.events), [state.events]);
  const pendingQueued = useMemo(() => pendingHubQueuedMessages(state.events), [state.events]);

  return { ...state, timeline, tasks, pendingQueued };
}
