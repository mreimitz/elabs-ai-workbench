import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Label,
  Spinner,
  Switch,
  Text,
} from "@brand/ui";
import {
  AgentMessage,
  ChatShell,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  MessageContent,
  Shimmer,
  Suggestion,
  Task,
  TaskContent,
  TaskTrigger,
  UserMessage,
} from "@brand/ai";
import { Check, ChevronDown, MessageSquare, Pencil, Plus, Settings, Sparkles } from "lucide-react";
import {
  ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS,
  type AssistantAuthSource,
  type AssistantAuthStatus,
  type AssistantEntityKind,
  type AssistantStarter,
  type AssistantThread,
} from "@mcp-token-footprint/shared";
import {
  ApiError,
  createAssistantThread,
  getAssistantModels,
  getAssistantThread,
  listAssistantThreads,
  retrySourceAssistantThread,
  sendAssistantMessage,
  sendAssistantPermissionDecision,
  stopAssistantThread,
  updateAssistantThread,
} from "../../lib/api";
import { IconButton } from "../../components/IconButton";
import { getErrorMessage } from "../../lib/errors";
import { formatRelativeTime } from "../../lib/format";
import { scopeChipCopy } from "./assistant-scope-chip";
// Gen-UI (dock chat enhancement): the structured-block parser + the enhanced message body
// (metric tiles, in-app entity links) + the quiet copy action. See assistant-message.ts.
import { parseAssistantMessage } from "./assistant-message";
import { AssistantMessageBody, AssistantTurnActions } from "./AssistantMessageBody";
import { useAssistant, type AssistantEntityRef } from "./assistant-context";
import { AssistantComposer, type AssistantComposerPrefill } from "./AssistantComposer";
// WP 2.2 — the skill-workspace commit diff card (see AssistantDiffCard.tsx for the extraction helper).
import { AssistantDiffCard, extractCommitWorkspaceDiff } from "./AssistantDiffCard";
// WP 3.3 (D-AS14) — the terminal limit-error banner (retry-on-other-source + re-sign-in hint).
import { AssistantLimitErrorBanner } from "./AssistantLimitErrorBanner";
import { AssistantPermissionCard } from "./AssistantPermissionCard";
import { AssistantToolCallCard } from "./AssistantToolCallCard";
// WP 3.1 (D-AS8/D-AS16) — the inert ui_action chip; see its own file for why it never navigates.
import { AssistantUiActionChip } from "./AssistantUiActionChip";
// WP R3.2 — the dock empty-state's data-aware session-starter chips.
import { useAssistantStarters } from "./use-assistant-starters";
import {
  useAssistantStream,
  type AssistantTimelineTurn,
  type AssistantTimelineUserItem,
} from "./use-assistant-stream";
import { notifyError } from "../../lib/notify";

/**
 * The global Assistant dock (UI §3.5) — built from `@brand/ai` (`ChatShell`, `Conversation*`,
 * `Composer`, `Shimmer`) + `@brand/ui`, styled/behaving like the run console's `ConversationPane.tsx`
 * (this WP's explicit style/behavior reference). Gated on auth: renders nothing chat-shaped while
 * signed out (D-AS-alignment — the dock/toggle are hidden entirely at the `AppShell` level too; this
 * inner gate is defense-in-depth for the rarer case where auth status changes while the dock is open).
 */
export function AssistantDock() {
  const { authStatus, authConfigured } = useAssistant();

  if (authStatus === null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (!authConfigured) return <SignedOutPanel />;
  return <AssistantDockContent />;
}

function SignedOutPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center p-6">
      <EmptyState
        icon={<Sparkles aria-hidden />}
        title="App assistant isn't signed in"
        description="Sign in with your Claude subscription — or set an API-key fallback — in Settings to enable the app assistant."
        actions={
          <Button asChild>
            <Link to="/settings">
              <Settings aria-hidden />
              <span>Open Settings</span>
            </Link>
          </Button>
        }
      />
    </div>
  );
}

/** Put `thread` at the front of `list`, replacing any existing row with the same id (never a duplicate). */
function mergeThreadIntoList(list: AssistantThread[], thread: AssistantThread): AssistantThread[] {
  return [thread, ...list.filter((existing) => existing.id !== thread.id)];
}

/** Human noun for the switcher's honest "Threads for this <kind>" label (D-AS24). Covers the full
 *  9-kind vocabulary even though only a handful are derivable from today's routes (see
 *  `resolveEntityPin` in `assistant-context.tsx`) — this map shouldn't need touching if that grows. */
const ENTITY_KIND_LABELS: Record<AssistantEntityKind, string> = {
  run: "run",
  scenario: "scenario",
  skill: "skill",
  scan: "scan",
  server: "server",
  test: "test",
  collection: "collection",
  suite_run: "suite run",
  compare: "compare",
};

function AssistantDockContent() {
  const {
    pendingRequest,
    clearPendingRequest,
    currentEnvelope,
    executeUiAction,
    authStatus,
    setActiveAssistantThreadId,
    consumeFreshSessionOpen,
  } = useAssistant();
  // Fresh-session-on-open (owner refinement): when THIS mount was triggered by a plain expand of the
  // dock (toggle / ⌘J, no page-hook payload), open on the blank "Start a conversation" state instead of
  // resuming the last thread. Read once at mount (the flag is set before the dock remounts); a `false`
  // here (a page reload, or the direct-render tests) keeps the pre-existing auto-select-most-recent
  // behavior. Past threads stay one click away in the switcher, and a first message lazily creates a
  // thread pinned to the current entity.
  const [openBlank] = useState(consumeFreshSessionOpen);
  // D-AS24 — the entity the CURRENT page names (if any); derived from primitives (not the `useAssistant()`
  // envelope object, which is a fresh reference every render) so callbacks that depend on it don't churn.
  const pinnedEntityKind = currentEnvelope.entityKind;
  const pinnedEntityId = currentEnvelope.entityId;
  const pinnedEntity: AssistantEntityRef | undefined =
    pinnedEntityKind && pinnedEntityId ? { kind: pinnedEntityKind, id: pinnedEntityId } : undefined;
  // WP R1.5 (D-AS23) — "scope is visible": the header's chip, re-derived every render straight from
  // the current envelope (cheap + pure), so it tracks navigation automatically like everything else
  // keyed off `currentEnvelope`.
  const scopeChip = scopeChipCopy(currentEnvelope);

  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // The active thread's OWN data, tracked independently of `threads` (the switcher's, now server-FILTERED,
  // list) — see the correctness note on `selectActiveThread` below: once `threads` only holds the current
  // scope, the active thread can legitimately be absent from it (e.g. it's pinned to a different entity
  // than the page you've since navigated to), and the header must still render its real title/date rather
  // than falling back to "New conversation".
  const [activeThreadObj, setActiveThreadObj] = useState<AssistantThread | null>(null);
  // The switcher's "All threads" escape hatch (D-AS24) — only meaningful while `pinnedEntity` is set;
  // an unscoped page is always the global list regardless of this flag.
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  // The prefill is only valid for the thread it was resolved against — a manual thread switch after
  // an unsent prefill must not leak that text into the newly-selected thread's composer.
  const [prefill, setPrefill] = useState<
    (AssistantComposerPrefill & { threadId: string | null }) | null
  >(null);

  const activeThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // WP R1.4 (D-AS22) — report the active thread id up to `AssistantProvider` (see
  // `activeAssistantThreadId`'s doc in `assistant-context.tsx`) so surfaces outside the dock (the Skills
  // Files view) know which thread's live skill-workspace to read. A SEPARATE mount-only effect clears it
  // on unmount (the dock closing) rather than folding that into the effect above, so switching threads
  // never flashes a spurious `null` in between.
  useEffect(() => {
    setActiveAssistantThreadId(activeThreadId);
  }, [activeThreadId, setActiveAssistantThreadId]);
  useEffect(() => () => setActiveAssistantThreadId(null), [setActiveAssistantThreadId]);

  /** Set BOTH the active id and its full object together — the one invariant that keeps the header's
   *  data honest regardless of whether `thread` also happens to be in the current filtered `threads` list. */
  const selectActiveThread = useCallback((thread: AssistantThread) => {
    setActiveThreadId(thread.id);
    setActiveThreadObj(thread);
  }, []);

  // The switcher's list — server-filtered to `pinnedEntity` unless the owner toggled "All threads" on,
  // or the page is unscoped to begin with (D-AS24). Re-runs (see the effect below) whenever the entity
  // kind/id or the toggle changes.
  const refreshThreads = useCallback(async (): Promise<void> => {
    try {
      const kind = pinnedEntityKind;
      const id = pinnedEntityId;
      const list =
        kind && id && !showAllThreads
          ? await listAssistantThreads({ kind, id })
          : await listAssistantThreads();
      setThreads(list);
    } catch (error) {
      notifyError("Couldn’t load your conversations.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setThreadsLoaded(true);
    }
  }, [pinnedEntityKind, pinnedEntityId, showAllThreads]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  useEffect(() => {
    void getAssistantModels()
      .then((response) => setModels(response.models))
      .catch(() => {
        // Best-effort — the model Select just stays empty; nothing else depends on this list.
      });
  }, []);

  /** Re-fetch just the active thread's own row (title/date/etc.) — used after a turn settles, since a
   *  background title refinement (R2.2) or a fresh `updatedAt` might not otherwise reach the header when
   *  the active thread falls outside the current filtered switcher scope (see `selectActiveThread`'s
   *  doc comment). Also patches the matching row in `threads` when it happens to be present there. */
  const refreshActiveThread = useCallback(async (id: string): Promise<void> => {
    try {
      const detail = await getAssistantThread(id);
      if (activeThreadIdRef.current !== id) return; // stale — the owner switched threads meanwhile
      setActiveThreadObj(detail);
      setThreads((current) =>
        current.some((t) => t.id === id) ? current.map((t) => (t.id === id ? detail : t)) : current,
      );
    } catch {
      // Best-effort — the header just keeps showing the last known title/date.
    }
  }, []);

  // Resolve a pending `openAssistant({ prompt?, entity? })` request exactly once per nonce: pin/reuse
  // (or create) an entity-linked thread, then register the prefill against whichever thread ends up
  // active.
  const handledNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingRequest || handledNonceRef.current === pendingRequest.nonce) return;
    handledNonceRef.current = pendingRequest.nonce;
    const { nonce, entity, prompt } = pendingRequest;
    let cancelled = false;

    async function resolve(): Promise<void> {
      let targetThreadId = activeThreadIdRef.current;
      if (entity) {
        try {
          const pinned = await listAssistantThreads(entity);
          if (cancelled) return;
          const [mostRecent] = pinned;
          if (mostRecent) {
            targetThreadId = mostRecent.id;
            setThreads((current) => mergeThreadIntoList(current, mostRecent));
            selectActiveThread(mostRecent);
          } else {
            const created = await createAssistantThread({
              entityKind: entity.kind,
              entityId: entity.id,
            });
            if (cancelled) return;
            targetThreadId = created.id;
            setThreads((current) => mergeThreadIntoList(current, created));
            selectActiveThread(created);
          }
        } catch (error) {
          if (!cancelled)
            notifyError("Couldn’t open a conversation for this item.", {
              description: `${getErrorMessage(error)} Try again.`,
            });
        }
      }
      if (!cancelled && prompt) setPrefill({ nonce, text: prompt, threadId: targetThreadId });
      if (!cancelled) clearPendingRequest();
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [pendingRequest, clearPendingRequest, selectActiveThread]);

  // Default selection once threads have loaded: the most recently active thread IN THE CURRENT (possibly
  // scoped) list, unless a pending request is about to choose one itself — OR this is a fresh expand
  // (`openBlank`), where the dock deliberately stays on the blank "Start a conversation" state.
  useEffect(() => {
    if (openBlank || activeThreadId !== null || !threadsLoaded || pendingRequest) return;
    const [mostRecent] = threads;
    if (mostRecent) selectActiveThread(mostRecent);
  }, [openBlank, activeThreadId, threadsLoaded, pendingRequest, threads, selectActiveThread]);

  const stream = useAssistantStream(activeThreadId);

  // Refresh the switcher (fresh titles/ordering) + the active thread's own row once a turn SETTLES
  // (awaiting -> not-awaiting) — this is where R2.2's server-side title refinement becomes visible.
  // Guarded by a ref (not a dep) so it fires exactly once per settle, never on every render/poll.
  const prevAwaitingRef = useRef(false);
  useEffect(() => {
    const wasAwaiting = prevAwaitingRef.current;
    prevAwaitingRef.current = stream.awaitingResponse;
    if (!wasAwaiting || stream.awaitingResponse) return;
    void refreshThreads();
    const id = activeThreadIdRef.current;
    if (id) void refreshActiveThread(id);
  }, [stream.awaitingResponse, refreshThreads, refreshActiveThread]);

  // WP 3.1 (D-AS8/D-AS16) — the LIVE half of the ui_* navigation feature: execute each freshly-arrived
  // LIVE ui_action exactly once (`executedUiActionIdsRef` — a plain Set survives across the timeline's
  // per-render rebuild, since `buildAssistantTimeline` re-derives stable positional ids from the same
  // append-only event log). A REPLAYED action (`isReplay: true` — rendered from the persisted log on
  // thread open/switch/reload) is intentionally skipped here; it still renders via
  // `AssistantUiActionChip` below, just without ever calling `executeUiAction`.
  const executedUiActionIdsRef = useRef<Set<string>>(new Set());
  // Reset the executed-set on a thread switch: ui_action ids are per-thread positional
  // (`assistant-turn-N-ui-M`, re-derived per timeline from each thread's own log), so a new thread's
  // `assistant-turn-1-ui-0` would otherwise collide with the previous thread's already-executed one and
  // its live navigation would be silently dropped. Declared BEFORE the executor effect so it clears
  // first on the thread-switch render (React runs effects in declaration order).
  useEffect(() => {
    executedUiActionIdsRef.current = new Set();
  }, [activeThreadId]);
  useEffect(() => {
    for (const item of stream.timeline) {
      if (item.kind !== "assistant_turn") continue;
      for (const uiAction of item.uiActions) {
        if (uiAction.isReplay) continue;
        if (executedUiActionIdsRef.current.has(uiAction.id)) continue;
        executedUiActionIdsRef.current.add(uiAction.id);
        executeUiAction(uiAction.action, uiAction.params);
      }
    }
  }, [stream.timeline, executeUiAction]);

  const handleSelectThread = useCallback(
    (thread: AssistantThread) => selectActiveThread(thread),
    [selectActiveThread],
  );

  // D-AS24 — pin a freshly-created thread to the current page's entity (when there is one); an
  // unscoped page creates an unpinned (global) thread, exactly as before.
  const handleNewThread = useCallback(async () => {
    try {
      const created = await createAssistantThread(
        pinnedEntityKind && pinnedEntityId
          ? { entityKind: pinnedEntityKind, entityId: pinnedEntityId }
          : {},
      );
      setThreads((current) => mergeThreadIntoList(current, created));
      selectActiveThread(created);
    } catch (error) {
      notifyError("Couldn’t start a new conversation.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  }, [pinnedEntityKind, pinnedEntityId, selectActiveThread]);

  const handleModelChange = useCallback(
    async (model: string) => {
      const id = activeThreadIdRef.current;
      if (id) {
        try {
          const updated = await updateAssistantThread(id, { model });
          setThreads((current) =>
            current.map((thread) => (thread.id === updated.id ? updated : thread)),
          );
          // Only refresh the HEADER's object if this is still the active thread — the owner may have
          // switched away while the PATCH was in flight, and a late response must never clobber
          // whatever they're looking at now.
          if (activeThreadIdRef.current === id) setActiveThreadObj(updated);
          return;
        } catch (error) {
          // A fresh "New thread" isn't persisted until its first message (and a dev DB reset can
          // leave a stale active id), so PATCHing it 404s — NOT a real failure. Fall through and
          // CREATE a thread with the chosen model so the selection actually takes effect and the
          // next message runs on it. Any other error is real and surfaced.
          if (!(error instanceof ApiError && error.status === 404)) {
            notifyError("Couldn’t change the model.", {
              description: `${getErrorMessage(error)} Try again.`,
            });
            return;
          }
        }
      }
      // No persisted thread (blank dock, or the not-yet-saved thread above) → create one WITH the
      // model, pinned to the current entity like the send / new-thread flows.
      try {
        const created = await createAssistantThread({
          ...(pinnedEntityKind && pinnedEntityId
            ? { entityKind: pinnedEntityKind, entityId: pinnedEntityId }
            : {}),
          model,
        });
        setThreads((current) => mergeThreadIntoList(current, created));
        selectActiveThread(created);
      } catch (error) {
        notifyError("Couldn’t change the model.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    },
    [pinnedEntityKind, pinnedEntityId, selectActiveThread],
  );

  const handleStop = useCallback(() => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    void stopAssistantThread(id).catch((error: unknown) => {
      notifyError("Couldn’t stop the assistant.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    });
  }, []);

  // Per-thread auto-accept (D-AS4): create/update writes run without asking; DELETES still always ask.
  const handleToggleAutoAccept = useCallback(
    async (autoAccept: boolean) => {
      const id = activeThreadIdRef.current;
      if (id) {
        try {
          const updated = await updateAssistantThread(id, { autoAccept });
          setThreads((current) =>
            current.map((thread) => (thread.id === updated.id ? updated : thread)),
          );
          if (activeThreadIdRef.current === id) setActiveThreadObj(updated);
          return;
        } catch (error) {
          // A thread whose server row is gone (a stale active id after a dev DB reset, or one deleted
          // concurrently) 404s — NOT a real failure, and the reason the "Could not change auto-accept /
          // Not found" toast was appearing. Fall through and CREATE a thread carrying the chosen write
          // mode so the toggle takes effect (mirrors handleModelChange). Any other error is real.
          if (!(error instanceof ApiError && error.status === 404)) {
            notifyError("Couldn’t change auto-accept.", {
              description: `${getErrorMessage(error)} Try again.`,
            });
            return;
          }
        }
      }
      // No persisted thread (or the stale one above) → create one WITH the setting, pinned to the
      // current entity like the send / new-thread / model-change flows.
      try {
        const created = await createAssistantThread({
          ...(pinnedEntityKind && pinnedEntityId
            ? { entityKind: pinnedEntityKind, entityId: pinnedEntityId }
            : {}),
          autoAccept,
        });
        setThreads((current) => mergeThreadIntoList(current, created));
        selectActiveThread(created);
      } catch (error) {
        notifyError("Couldn’t change auto-accept.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    },
    [pinnedEntityKind, pinnedEntityId, selectActiveThread],
  );

  // D-AS26 (render half) — inline rename. The header/UI already trimmed and confirmed non-empty before
  // calling this; the PATCH schema (`title: z.string().trim().min(1)`) would reject an empty title with
  // a 400, so we cancel client-side instead of ever sending one.
  const handleRenameThread = useCallback(async (title: string) => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    try {
      const updated = await updateAssistantThread(id, { title });
      setThreads((current) =>
        current.map((thread) => (thread.id === updated.id ? updated : thread)),
      );
      if (activeThreadIdRef.current === id) setActiveThreadObj(updated);
    } catch (error) {
      notifyError("Couldn’t rename the conversation.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  }, []);

  // Decide a gated write (WP 2.1). The settled `permission_decision` arrives on the SSE stream and flips
  // the card inert; `decidingIds` just disables the buttons for the in-flight POST so it can't double-send.
  const [decidingIds, setDecidingIds] = useState<ReadonlySet<string>>(new Set());
  const handlePermissionDecision = useCallback(
    async (requestId: string, behavior: "allow" | "deny") => {
      const id = activeThreadIdRef.current;
      if (!id) return;
      setDecidingIds((current) => new Set(current).add(requestId));
      try {
        await sendAssistantPermissionDecision(id, { requestId, behavior });
      } catch (error) {
        notifyError("Couldn’t record your decision.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      } finally {
        setDecidingIds((current) => {
          const next = new Set(current);
          next.delete(requestId);
          return next;
        });
      }
    },
    [],
  );

  // WP 3.3 (D-AS14) — the limit-error banner's "Retry on …" action. The ONLY place a thread's
  // authSource ever changes on this side is here, via an explicit owner click — never automatically.
  const [retryingSource, setRetryingSource] = useState(false);
  const handleRetrySource = useCallback(async (source: AssistantAuthSource) => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    setRetryingSource(true);
    try {
      const updated = await retrySourceAssistantThread(id, source);
      setThreads((current) =>
        current.map((thread) => (thread.id === updated.id ? updated : thread)),
      );
      if (activeThreadIdRef.current === id) setActiveThreadObj(updated);
    } catch (error) {
      notifyError("Couldn’t retry with the other sign-in method.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setRetryingSource(false);
    }
  }, []);

  // Send a message — lazily creating a thread first when the dock is blank (no thread selected yet),
  // so the empty state's own "send a message to start a new one" is actually true. `envelope` is read
  // fresh here (not captured earlier) so it reflects the route at the moment of SENDING, not opening.
  // The lazily-created thread is pinned to the current entity too (mirrors `handleNewThread`).
  const handleSendMessage = useCallback(
    async (text: string) => {
      let id = activeThreadIdRef.current;
      if (!id) {
        const created = await createAssistantThread(
          pinnedEntityKind && pinnedEntityId
            ? { entityKind: pinnedEntityKind, entityId: pinnedEntityId }
            : {},
        );
        setThreads((current) => mergeThreadIntoList(current, created));
        selectActiveThread(created);
        id = created.id;
      }
      await sendAssistantMessage(id, text, currentEnvelope);
      setPrefill(null);
    },
    [currentEnvelope, pinnedEntityKind, pinnedEntityId, selectActiveThread],
  );

  // Gen-UI follow-up chips: a click SENDS the suggestion as the next message (no re-typing). Same
  // path as the composer's submit; failures surface via toast since there's no input well to hold
  // the text on error.
  const handleFollowup = useCallback(
    async (prompt: string) => {
      try {
        await handleSendMessage(prompt);
      } catch (error) {
        notifyError("Couldn’t send the follow-up.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    },
    [handleSendMessage],
  );

  // The active thread's data, tracked independently of the (now filtered) switcher list — see
  // `selectActiveThread`'s doc comment. Never derived via `threads.find(...)`.
  const activeThread = activeThreadObj;
  const activePrefill = prefill && prefill.threadId === activeThreadId ? prefill : null;
  // WP 3.3 — the subscription token-expiry warning, surfaced in the dock too (not just Settings). Only
  // meaningful for a subscription-source thread; mirrors SettingsView.tsx's AssistantCard exactly.
  const nearExpiry =
    activeThread?.authSource === "subscription" &&
    (authStatus?.signedIn ?? false) &&
    typeof authStatus?.tokenAgeDays === "number" &&
    authStatus.tokenAgeDays >= ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The dock's header bar renders OUTSIDE ChatShell (whose built-in header slot is a hardcoded
          `h-12` row) so it can be `h-14` + `border-b` — the exact height and rule of the main
          content's TopNav, keeping the two top bars visually level across the split. */}
      <div className="flex h-14 shrink-0 items-center border-b border-border px-3">
        <AssistantHeader
          threads={threads}
          threadsLoaded={threadsLoaded}
          activeThread={activeThread}
          pinnedEntity={pinnedEntity}
          showAllThreads={showAllThreads}
          onToggleShowAllThreads={setShowAllThreads}
          onSelectThread={handleSelectThread}
          onNewThread={() => void handleNewThread()}
          onRenameThread={(title) => void handleRenameThread(title)}
        />
      </div>
      <ChatShell
        variant="bare"
        // `bg-transparent` overrides ChatShell's own `bg-background` so the dock renders on the SAME
        // `bg-sidebar` surface as the left navigation sidebar (the aside in `AppShell.tsx` owns it).
        className="min-h-0 flex-1 bg-transparent"
        composer={
          <AssistantComposer
            composerKey={activeThreadId ?? "none"}
            streaming={stream.awaitingResponse}
            prefill={activePrefill}
            activeThread={activeThread}
            models={models}
            nearExpiry={nearExpiry}
            scopeChip={scopeChip}
            onSelectModel={(model) => void handleModelChange(model)}
            onToggleAutoAccept={(autoAccept) => void handleToggleAutoAccept(autoAccept)}
            onSubmit={handleSendMessage}
            onStop={handleStop}
          />
        }
      >
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="flex min-w-0 flex-col gap-4 p-4">
            {stream.timeline.length === 0 ? (
              <PendingPanel hasThread={activeThreadId !== null} />
            ) : (
              stream.timeline.map((item, index) =>
                item.kind === "user" ? (
                  <UserTurn key={item.id} item={item} />
                ) : (
                  <AssistantTurnBlock
                    key={item.id}
                    turn={item}
                    isLastItem={index === stream.timeline.length - 1}
                    authStatus={authStatus}
                    retryingSource={retryingSource}
                    onRetrySource={(source) => void handleRetrySource(source)}
                    onDecidePermission={(requestId, behavior) =>
                      void handlePermissionDecision(requestId, behavior)
                    }
                    onFollowup={(prompt) => void handleFollowup(prompt)}
                    followupsEnabled={!stream.awaitingResponse}
                    decidingIds={decidingIds}
                  />
                ),
              )
            )}
            {stream.error ? (
              <Alert variant="destructive">
                <AlertTitle>Connection issue</AlertTitle>
                <AlertDescription>{stream.error}</AlertDescription>
              </Alert>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </ChatShell>
    </div>
  );
}

/**
 * The dock's header — a SINGLE `h-12`-fitting row of thread IDENTITY only (switcher + rename). The
 * control cluster (auto-accept, auth-source/expiry badges, model select, stop) used to live here too
 * and visibly overflowed the `ChatShell` header's fixed single row at the dock's default ~26% width
 * (it was `shrink-0`, so it pushed out of the visible area instead of shrinking); those controls now
 * live in the composer zone (`AssistantComposer.tsx`), where chat products put them.
 */
function AssistantHeader({
  threads,
  threadsLoaded,
  activeThread,
  pinnedEntity,
  showAllThreads,
  onToggleShowAllThreads,
  onSelectThread,
  onNewThread,
  onRenameThread,
}: {
  threads: AssistantThread[];
  threadsLoaded: boolean;
  activeThread: AssistantThread | null;
  pinnedEntity?: AssistantEntityRef;
  showAllThreads: boolean;
  onToggleShowAllThreads: (showAll: boolean) => void;
  onSelectThread: (thread: AssistantThread) => void;
  onNewThread: () => void;
  onRenameThread: (title: string) => void;
}) {
  // D-AS24 — `threads` IS the switcher's list now (the server filter, not a client-side re-derivation);
  // just cap how many rows render. The label says honestly which scope is showing.
  const listedThreads = threads.slice(0, 12);
  const title = activeThread?.title ?? (threadsLoaded ? "New conversation" : "Loading…");
  const dateLabel = activeThread ? formatRelativeTime(activeThread.updatedAt) : null;
  const scopeLabel =
    pinnedEntity && !showAllThreads
      ? `Threads for this ${ENTITY_KIND_LABELS[pinnedEntity.kind]}`
      : "All threads";

  // D-AS26 (render half) — inline rename of the active thread's title. Enter/blur commits, Escape
  // cancels; an empty (trimmed) title cancels instead of sending (the caller would coerce it server-side,
  // but we never send it in the first place).
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  function startRename(): void {
    if (!activeThread) return;
    setRenameValue(activeThread.title);
    setRenaming(true);
  }
  function commitRename(): void {
    setRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== activeThread?.title) onRenameThread(trimmed);
  }
  function cancelRename(): void {
    setRenaming(false);
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {renaming ? (
        <Input
          autoFocus
          aria-label="Thread title"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
          autoComplete="off"
          className="h-8 min-w-0 flex-1"
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 flex-1 justify-start gap-1.5 px-2 py-1"
            >
              <MessageSquare aria-hidden className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col items-start text-start">
                <span className="min-w-0 max-w-full truncate" title={title}>
                  {title}
                </span>
                {dateLabel ? (
                  <Text variant="caption" tone="muted" as="span" className="tabular-nums">
                    {dateLabel}
                  </Text>
                ) : null}
              </span>
              <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={onNewThread}>
              <Plus aria-hidden />
              <span>New thread</span>
            </DropdownMenuItem>
            {pinnedEntity ? (
              <DropdownMenuItem
                onSelect={(event) => event.preventDefault()}
                className="justify-between gap-2"
              >
                {/* Deliberately NOT the same string as the section heading below ("All threads") — this
                      is the ACTION ("show every thread"), the heading is the CURRENT scope; matching text
                      for two different things reads as a bug during a11y/visual review. */}
                <Label htmlFor="assistant-show-all-threads" className="cursor-pointer font-normal">
                  Show all threads
                </Label>
                <Switch
                  id="assistant-show-all-threads"
                  checked={showAllThreads}
                  onCheckedChange={onToggleShowAllThreads}
                  aria-label={`Show all threads, not just this ${ENTITY_KIND_LABELS[pinnedEntity.kind]}'s${showAllThreads ? " (on)" : ""}`}
                />
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{scopeLabel}</DropdownMenuLabel>
            {listedThreads.length === 0 ? (
              <DropdownMenuItem disabled>
                {threadsLoaded ? "No threads yet" : "Loading…"}
              </DropdownMenuItem>
            ) : (
              listedThreads.map((thread) => (
                <DropdownMenuItem
                  key={thread.id}
                  onSelect={() => onSelectThread(thread)}
                  className="gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  <Text variant="caption" tone="muted" as="span" className="shrink-0 tabular-nums">
                    {formatRelativeTime(thread.updatedAt)}
                  </Text>
                  {thread.id === activeThread?.id ? (
                    <Check aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {!renaming && activeThread ? (
        <IconButton
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={startRename}
          label="Rename thread"
        >
          <Pencil aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

function UserTurn({ item }: { item: AssistantTimelineUserItem }) {
  const text = item.text.trim();
  return (
    <UserMessage>
      <MessageContent>
        {text.length > 0 ? (
          <Text className="min-w-0 whitespace-pre-wrap break-words">{text}</Text>
        ) : (
          <Text tone="muted">No message text.</Text>
        )}
      </MessageContent>
    </UserMessage>
  );
}

function AssistantTurnBlock({
  turn,
  isLastItem,
  authStatus,
  retryingSource,
  onRetrySource,
  onDecidePermission,
  onFollowup,
  followupsEnabled,
  decidingIds,
}: {
  turn: AssistantTimelineTurn;
  isLastItem: boolean;
  authStatus: AssistantAuthStatus | null;
  retryingSource: boolean;
  onRetrySource: (source: AssistantAuthSource) => void;
  onDecidePermission: (requestId: string, behavior: "allow" | "deny") => void;
  /** Send a follow-up chip's prompt as a new message (gen-UI: click = send, no re-typing). */
  onFollowup: (prompt: string) => void;
  /** False while a response is in flight anywhere in the thread — chips hide rather than queue. */
  followupsEnabled: boolean;
  decidingIds: ReadonlySet<string>;
}) {
  const prose = turn.text?.trim();
  // Gen-UI: parse the structured `followups` / `metrics` blocks out of the raw markdown (pure,
  // streaming-safe — see assistant-message.ts). Chips render only on the LAST settled turn.
  const parsed = useMemo(
    () => parseAssistantMessage(prose ?? "", turn.streaming),
    [prose, turn.streaming],
  );
  const hasBody = parsed.segments.length > 0;
  const showFollowups =
    isLastItem && !turn.streaming && followupsEnabled && parsed.followups.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Tool calls render as one-line collapsed rows (AssistantToolCallCard), mirroring the run
          console. A single call shows directly; two or more fold into a `@brand/ai` `Task`
          ("Used N tools") — open while the turn is live so streamed activity stays in view, collapsed
          once settled (uncontrolled after mount, so the owner's own toggle always wins). */}
      {turn.toolCalls.length === 1 ? (
        <div className="min-w-0">
          {turn.toolCalls.map((call) => (
            <AssistantToolCallCard key={call.id} call={call} />
          ))}
        </div>
      ) : turn.toolCalls.length > 1 ? (
        <Task className="min-w-0" defaultOpen={turn.streaming}>
          <TaskTrigger title={toolTaskTitle(turn)} />
          <TaskContent>
            <div className="flex min-w-0 flex-col gap-1.5">
              {turn.toolCalls.map((call) => (
                <AssistantToolCallCard key={call.id} call={call} />
              ))}
            </div>
          </TaskContent>
        </Task>
      ) : null}

      {/* WP 2.2 (D-AS13) — a skills_commit_workspace call that actually minted a new version (carries a
          diff, not the unchanged: true dedup path) additionally renders a compact diff card below the
          raw tool-call card above, so a skill edit reads as a result, not just a JSON blob. */}
      {turn.toolCalls.map((call) => {
        const commit = extractCommitWorkspaceDiff(call);
        return commit ? <AssistantDiffCard key={`${call.id}-diff`} {...commit} /> : null;
      })}

      {turn.permissions.map((permission) => (
        <AssistantPermissionCard
          key={permission.id}
          permission={permission}
          onDecide={onDecidePermission}
          deciding={decidingIds.has(permission.id)}
        />
      ))}

      {/* WP 3.1 (D-AS8/D-AS16) — the inert ui_action chip; the live-navigate side effect is a
          separate concern owned by the executor effect up in AssistantDockContent. */}
      {turn.uiActions.map((uiAction) => (
        <AssistantUiActionChip key={uiAction.id} uiAction={uiAction} />
      ))}

      {turn.limitError ? (
        <AssistantLimitErrorBanner
          message={turn.limitError.message}
          source={turn.limitError.source}
          kind={turn.limitError.kind}
          authStatus={authStatus}
          interactive={isLastItem}
          retrying={retryingSource}
          onRetry={onRetrySource}
        />
      ) : null}

      {turn.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>The assistant hit an error</AlertTitle>
          <AlertDescription>{turn.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {hasBody ? (
        <AgentMessage emphasis="answer">
          <MessageContent>
            <AssistantMessageBody parsed={parsed} streaming={turn.streaming} />
          </MessageContent>
        </AgentMessage>
      ) : turn.streaming && turn.toolCalls.length === 0 ? (
        <AgentMessage>
          <MessageContent>
            <Shimmer>Thinking…</Shimmer>
          </MessageContent>
        </AgentMessage>
      ) : null}

      {/* Settled-turn affordances: a single quiet copy action, and — on the LAST turn only — the
          model's own follow-up chips (structured `followups` block). A click SENDS the prompt. */}
      {hasBody && !turn.streaming ? <AssistantTurnActions parsed={parsed} /> : null}
      {showFollowups ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {parsed.followups.map((followup) => (
            <Suggestion
              key={followup}
              suggestion={followup}
              onClick={() => onFollowup(followup)}
              className="h-auto gap-1.5 whitespace-normal rounded-full py-1.5 pl-2.5 pr-3 text-left text-body"
            >
              <Sparkles aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{followup}</span>
            </Suggestion>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Used 3 tools" — the tool-fold's one-line summary (assistant threads carry no per-call duration,
 *  so there's no "· 4.2 s" suffix like the run console has); an ellipsis while the turn is live. */
function toolTaskTitle(turn: AssistantTimelineTurn): string {
  const n = turn.toolCalls.length;
  const base = `Used ${n} tool${n === 1 ? "" : "s"}`;
  return turn.streaming ? `${base}…` : base;
}

/**
 * WP R3.2 (D-AS27/D-AS28/D-AS29) — the dock's empty state. Below the existing title/description, a
 * row of `@brand/ai` `Suggestion` chips (session starters, curated + data-aware per the current page)
 * prefills the composer on click — never sends (`openAssistant({prompt, entity})` only ever fills the
 * composer; see `assistant-context.tsx`). Chips are additive: while loading, on a fetch error, or when
 * the endpoint returns zero starters, `actions` stays `undefined` and today's plain empty state renders
 * exactly as before — a starters outage must never break the dock's baseline "say something" state.
 */
function PendingPanel({ hasThread }: { hasThread: boolean }) {
  const { currentEnvelope, openAssistant } = useAssistant();
  const entityKind = currentEnvelope.entityKind;
  const entityId = currentEnvelope.entityId;
  const tab = currentEnvelope.tab;
  const route = currentEnvelope.route;
  const { starters, loading } = useAssistantStarters({ entityKind, entityId, tab, route });

  const handleStarterClick = useCallback(
    (starter: AssistantStarter) => {
      const entity = entityKind && entityId ? { kind: entityKind, id: entityId } : undefined;
      openAssistant({ prompt: starter.prompt, entity });
    },
    [openAssistant, entityKind, entityId],
  );

  // The chat-specific `@brand/ai` `ConversationEmptyState` (2026-07-12 brand-ui alignment; replaces
  // the generic `EmptyState`). It has no `actions` slot (passing `children` would REPLACE its whole
  // icon/title/description face), so the starter-chip row renders as a SIBLING below it inside the
  // same centering column.
  return (
    <div className="flex size-full min-w-0 flex-col items-center justify-center">
      <ConversationEmptyState
        className="size-auto flex-none"
        icon={<MessageSquare aria-hidden className="size-6" />}
        title={hasThread ? "Say something to get started" : "Start a conversation"}
        description={
          hasThread
            ? "Ask about a scan, a run, a skill, or anything else in the app — the assistant can read your data."
            : "Send a message to start a new conversation."
        }
      />
      {!loading && starters.length > 0 ? (
        // NOT `@brand/ai`'s `Suggestions` here: that wrapper is a horizontal `ScrollArea` whose
        // inner row is `w-max` with a HIDDEN scrollbar — at the dock's narrow default width the
        // chips visibly overflowed both edges with no way to reach them. A wrapping row keeps
        // every chip visible at any dock width instead.
        <div className="-mt-4 flex min-w-0 max-w-full flex-wrap items-center justify-center gap-2 px-8 pb-8">
          {starters.map((starter) => (
            <Suggestion
              key={starter.id}
              suggestion={starter.label}
              onClick={() => handleStarterClick(starter)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
