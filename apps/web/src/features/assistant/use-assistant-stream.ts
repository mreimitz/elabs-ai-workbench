import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantAuthSource,
  AssistantEvent,
  AssistantLimitErrorKind,
  AssistantStreamFrame,
} from "@mcp-token-footprint/shared";
import { openAssistantStream } from "../../lib/api";

/** One tool call inside an assistant turn — the settled `tool_call` event, plus its `tool_result`
 *  once it arrives (never — a still-running call). */
export type AssistantTimelineToolCall = {
  id: string; // the SDK's `toolUseId`
  toolName: string;
  input: unknown;
  result?: { value: unknown; isError: boolean };
};

/** A write-tool approval round-trip (WP 2.1 owns the interactive Allow/Deny UI; this WP renders it
 *  read-only so a request/decision is never silently dropped from the transcript). */
export type AssistantTimelinePermission = {
  id: string; // requestId
  toolName: string;
  input: unknown;
  diffPreview?: string;
  decision?: { behavior: "allow" | "deny"; updatedInput?: unknown };
};

/** A `ui_action` event. `isReplay` (WP 3.1, D-AS8/D-AS16) distinguishes "rendered from the persisted
 *  log" (`true` — an inert chip, the navigation already happened) from "just arrived live" (`false` —
 *  the executor navigates instantly then leaves a chip behind too) — see `liveSinceSeq` below. */
export type AssistantTimelineUiAction = {
  id: string;
  action: string;
  params: Record<string, unknown>;
  isReplay: boolean;
};

export type AssistantTimelineUserItem = { kind: "user"; id: string; text: string };

/**
 * One assistant turn — everything between a user message and the `turn_done` that closes it,
 * flattened into sibling facets (mirrors `TimelineAssistantTurn` in `features/testing/use-run-stream.ts`).
 * `streaming` is true only for the single, trailing, not-yet-closed turn while the thread is live.
 */
export type AssistantTimelineTurn = {
  kind: "assistant_turn";
  id: string;
  text?: string;
  toolCalls: AssistantTimelineToolCall[];
  permissions: AssistantTimelinePermission[];
  uiActions: AssistantTimelineUiAction[];
  limitError?: { message: string; source: AssistantAuthSource; kind?: AssistantLimitErrorKind };
  errorMessage?: string;
  streaming: boolean;
};

export type AssistantTimelineItem = AssistantTimelineUserItem | AssistantTimelineTurn;

/** Accumulated stream state, folded from the settled `AssistantEvent` log + live `assistant_delta`s. */
export type AssistantStreamState = {
  /** Settled events, seq-ascending, deduped by seq (the durable replay log). */
  events: AssistantEvent[];
  /** Live prose for the CURRENT unsettled turn — reset at every turn boundary (see {@link reduceAssistantFrame}). */
  deltaText: string;
  /** True from the moment a `user_message` settles until `turn_done`/`error`/`limit_error` closes it —
   *  independent of whether any tool_call/assistant_message has shown up yet for that turn, so the
   *  composer disables and the shimmer appears immediately, not only once the first token streams in. */
  awaitingResponse: boolean;
  /** The connection-lost sentinel OR the last genuine `error`/`limit_error` event's message. `null`
   *  once a fresh `user_message` supersedes a stale one (this thread stays usable after an error —
   *  unlike a run, which is terminal; run-stream never needs to clear its error for this reason). */
  error: string | null;
};

const EMPTY_STATE: AssistantStreamState = {
  events: [],
  deltaText: "",
  awaitingResponse: false,
  error: null,
};

/**
 * The sentinel `state.error` is set to on a PRE-terminal transport drop (see `useAssistantStream`).
 * Kept as a constant so the recovery path can recognise + clear exactly this message without
 * clobbering a genuine `error`/`limit_error` event's own message.
 */
const CONNECTION_LOST = "Assistant stream connection lost.";

/** Fold one settled `AssistantEvent` (never a delta — those are applied by the caller) into state. */
function reduceEvent(state: AssistantStreamState, event: AssistantEvent): AssistantStreamState {
  const events = [...state.events, event];
  switch (event.type) {
    case "user_message":
      // A fresh turn starts: clear any residual delta text from a prior turn and any stale error —
      // the owner is continuing the conversation, so an old failure is no longer the current state.
      return { events, deltaText: "", awaitingResponse: true, error: null };
    case "assistant_message":
      // The turn's final prose has settled — the live delta channel is now redundant for it.
      return { ...state, events, deltaText: "" };
    case "turn_done":
      return { ...state, events, deltaText: "", awaitingResponse: false };
    case "error":
      return { ...state, events, awaitingResponse: false, error: event.message };
    case "limit_error":
      return { ...state, events, awaitingResponse: false, error: event.message };
    default:
      // tool_call / tool_result / permission_request / permission_decision / ui_action — recorded in
      // `events` (the timeline builder below groups them into the open turn); no other state changes.
      return { ...state, events };
  }
}

/** Fold one wire frame (a settled event OR a transient delta) into state. Exported for the reducer
 *  unit tests; the hook itself applies frames one at a time as they arrive off the `EventSource`. */
export function reduceAssistantFrame(
  state: AssistantStreamState,
  frame: AssistantStreamFrame,
): AssistantStreamState {
  if (frame.type === "assistant_delta") {
    return { ...state, deltaText: state.deltaText + frame.text };
  }
  // WP R1.3 (D-AS22) — the three transient skill-workspace progress frames are NOT conversation state
  // (they carry no `seq`, are never persisted/replayed, and aren't a member of `AssistantEvent`) — this
  // dock ignores them here. A type-safe no-op, not a silent drop of a real event; R1.4 adds the
  // Files-view consumer that actually reads them off the same stream.
  if (
    frame.type === "workspace_opened" ||
    frame.type === "workspace_file_changed" ||
    frame.type === "workspace_committed"
  ) {
    return state;
  }
  return reduceEvent(state, frame);
}

/**
 * Reconstruct the ordered conversation timeline from the settled event log + the live delta text for
 * the current unsettled turn (mirrors `buildTimeline` in `features/testing/use-run-stream.ts`, but
 * simpler: `AssistantEvent` carries no `turnIndex` — an assistant thread only ever has ONE turn open
 * at a time, so turns are segmented purely by event order between `user_message`/`turn_done` boundaries).
 *
 * `liveSinceSeq` (WP 3.1, D-AS8/D-AS16) is the seq high-water mark the current subscription had
 * reached at the moment the server's replay→live handoff fired (`null` until that marker has arrived,
 * or if this thread has no live subscription at all — see `useAssistantStream`). A `ui_action` event
 * with `seq` at or below it is history (`isReplay: true`); above it, the event happened live in front
 * of this client. Defaults to `null` (everything replay/inert) so every existing call site — incl. the
 * pure unit tests below, which pass no 4th argument — keeps its prior, safe behavior: never treat an
 * event as live unless a subscription has explicitly proven it is.
 */
export function buildAssistantTimeline(
  events: AssistantEvent[],
  deltaText: string,
  awaitingResponse: boolean,
  liveSinceSeq: number | null = null,
): AssistantTimelineItem[] {
  const items: AssistantTimelineItem[] = [];
  let currentTurn: AssistantTimelineTurn | null = null;
  let turnSeq = 0;
  const callIndex = new Map<string, AssistantTimelineToolCall>();

  const openTurn = (): AssistantTimelineTurn => {
    if (currentTurn) return currentTurn;
    turnSeq += 1;
    currentTurn = {
      kind: "assistant_turn",
      id: `assistant-turn-${turnSeq}`,
      toolCalls: [],
      permissions: [],
      uiActions: [],
      streaming: false,
    };
    items.push(currentTurn);
    return currentTurn;
  };

  for (const event of events) {
    switch (event.type) {
      case "user_message":
        items.push({ kind: "user", id: `user-${items.length}`, text: event.text });
        currentTurn = null; // the next assistant-side event opens a fresh turn
        break;
      case "tool_call": {
        const turn = openTurn();
        const call: AssistantTimelineToolCall = {
          id: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
        };
        turn.toolCalls.push(call);
        callIndex.set(call.id, call);
        break;
      }
      case "tool_result": {
        const turn = openTurn();
        const id = event.toolUseId;
        const existing = callIndex.get(id);
        if (existing) {
          existing.result = { value: event.result, isError: event.isError === true };
        } else {
          // A result with no matching open call (redacted/out-of-order history) — surface it standalone
          // rather than drop it silently.
          const call: AssistantTimelineToolCall = {
            id,
            toolName: event.toolName,
            input: undefined,
            result: { value: event.result, isError: event.isError === true },
          };
          turn.toolCalls.push(call);
          callIndex.set(id, call);
        }
        break;
      }
      case "permission_request": {
        const turn = openTurn();
        turn.permissions.push({
          id: event.requestId,
          toolName: event.toolName,
          input: event.input,
          ...(event.diffPreview !== undefined ? { diffPreview: event.diffPreview } : {}),
        });
        break;
      }
      case "permission_decision": {
        const turn = openTurn();
        const match = turn.permissions.find((permission) => permission.id === event.requestId);
        if (match) {
          match.decision = {
            behavior: event.behavior,
            ...(event.updatedInput !== undefined ? { updatedInput: event.updatedInput } : {}),
          };
        }
        break;
      }
      case "ui_action": {
        const turn = openTurn();
        // Fail-safe: an event with no seq (shouldn't happen on the wire — every settled event is
        // seq-stamped before persistence) or a not-yet-known live boundary is treated as replay/inert.
        const isReplay =
          liveSinceSeq === null || event.seq === undefined ? true : event.seq <= liveSinceSeq;
        turn.uiActions.push({
          id: `${turn.id}-ui-${turn.uiActions.length}`,
          action: event.action,
          params: event.params,
          isReplay,
        });
        break;
      }
      case "assistant_message": {
        const turn = openTurn();
        turn.text = event.text;
        break;
      }
      case "limit_error": {
        const turn = openTurn();
        turn.limitError = {
          message: event.message,
          source: event.source,
          ...(event.kind !== undefined ? { kind: event.kind } : {}),
        };
        break;
      }
      case "error": {
        const turn = openTurn();
        turn.errorMessage = event.message;
        break;
      }
      case "turn_done":
        currentTurn = null; // the turn is fully closed — the next assistant-side event opens a new one
        break;
      default:
        break;
    }
  }

  // The trailing, not-yet-closed turn while the thread is awaiting a response: show the live delta
  // text (or nothing yet — the dock renders a "thinking" shimmer for that case) and mark it streaming.
  if (awaitingResponse) {
    const turn = openTurn();
    turn.streaming = true;
    if (turn.text === undefined && deltaText.length > 0) turn.text = deltaText;
  }

  return items;
}

/**
 * Subscribe to one assistant thread's frame stream and accumulate it into console-ready state.
 *
 * Pass `null` to subscribe to nothing (no thread selected yet); state resets to empty. Mirrors
 * `useRunStream` (`features/testing/use-run-stream.ts`) — `seq` dedup, replay-then-live, a per-turn
 * `streaming`/`awaitingResponse` flag, deltas building up while settled events reconcile — with one
 * deliberate, documented difference: an assistant thread's stream has **no terminal status** (a run's
 * stream is closed by the SERVER at the run's terminal `status`; a thread's stream stays open across
 * every turn until the client disconnects or the thread is deleted). So "terminal" here means "WE
 * ourselves ended this subscription" (switching threads / unmounting), tracked by `closedRef`, rather
 * than a server-reported finish — an `onerror` after that point is the expected close, not a drop.
 * Any `onerror` BEFORE that point is a genuine mid-turn drop; per `.claude/rules/loading-states.md`
 * it surfaces the connection-lost sentinel (never mid-stream as a hard failure) and self-clears once
 * the browser's automatic reconnect + replay catches back up.
 */
export function useAssistantStream(threadId: string | null): AssistantStreamState & {
  timeline: AssistantTimelineItem[];
} {
  const [state, setState] = useState<AssistantStreamState>(EMPTY_STATE);
  const activeRef = useRef(false);
  const closedRef = useRef(false);
  const lastSeqRef = useRef(-1);
  const droppedRef = useRef(false);
  // WP 3.1 (D-AS8/D-AS16) — the replay→live boundary for THIS subscription; see
  // `buildAssistantTimeline`'s doc comment. `null` until the server's `replay_complete` marker arrives.
  const [liveSinceSeq, setLiveSinceSeq] = useState<number | null>(null);

  useEffect(() => {
    setState(EMPTY_STATE);
    closedRef.current = false;
    lastSeqRef.current = -1;
    droppedRef.current = false;
    setLiveSinceSeq(null);

    if (!threadId) return;

    activeRef.current = true;
    const close = openAssistantStream(
      threadId,
      (frame) => {
        if (!activeRef.current) return;
        // Settled events carry a monotonic `seq`; a reconnect replays the full persisted log from the
        // start, so drop anything at or below the high-water mark. Deltas AND the WP R1.3 skill-
        // workspace progress frames carry no `seq` and are never replayed (the API never persists
        // them), so they always apply.
        if (
          frame.type !== "assistant_delta" &&
          frame.type !== "workspace_opened" &&
          frame.type !== "workspace_file_changed" &&
          frame.type !== "workspace_committed" &&
          typeof frame.seq === "number"
        ) {
          if (frame.seq <= lastSeqRef.current) return;
          lastSeqRef.current = frame.seq;
        }
        if (droppedRef.current) {
          droppedRef.current = false;
          setState((current) =>
            current.error === CONNECTION_LOST ? { ...current, error: null } : current,
          );
        }
        setState((current) => reduceAssistantFrame(current, frame));
      },
      () => {
        if (!activeRef.current) return;
        if (closedRef.current) return; // we intentionally ended this subscription — not a real drop
        droppedRef.current = true;
        setState((current) => (current.error ? current : { ...current, error: CONNECTION_LOST }));
      },
      () => {
        // The server just finished writing replay + switched to live: everything with `seq` at or
        // below our current high-water mark is history. Re-fires (monotonically) on every reconnect —
        // harmless, since reconnect replay is deduped away by `lastSeqRef` before it ever reaches
        // `setState` above, so nothing already-classified as live gets reclassified as replay.
        if (!activeRef.current) return;
        setLiveSinceSeq(lastSeqRef.current);
      },
    );

    return () => {
      activeRef.current = false;
      closedRef.current = true;
      close();
    };
  }, [threadId]);

  const timeline = useMemo(
    () =>
      buildAssistantTimeline(state.events, state.deltaText, state.awaitingResponse, liveSinceSeq),
    [state.events, state.deltaText, state.awaitingResponse, liveSinceSeq],
  );

  return { ...state, timeline };
}
