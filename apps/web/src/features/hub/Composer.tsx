import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  SpeechInput,
  usePromptInputController,
} from "@brand/ai";
import { Button, cn, Popover, PopoverContent, PopoverTrigger, Text } from "@brand/ui";
import type {
  HubAutonomyLevel,
  HubSendMessageInput,
  HubSession,
  HubSessionMode,
} from "@mcp-token-footprint/shared";
import {
  ArrowUp,
  Globe,
  ListChecks,
  MessageSquare,
  Paperclip,
  Pin,
  Search,
  Slash,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getErrorMessage } from "../../lib/errors";
import { updateHubSession, uploadHubFile } from "../../lib/api";
import { AutonomyModeSelect } from "./AutonomyModeSelect";
import {
  ComposerCommandList,
  filterComposerCommands,
  McpPromptArgsDialog,
  resolvePromptText,
  useComposerCommandCatalog,
  type ComposerCommandItem,
  type McpPromptCommandItem,
} from "./ComposerCommands";
import { HubModelPicker } from "./HubModelPicker";
import {
  findHubModelOption,
  hubModelWireFields,
  type HubModelCredentialIssue,
  type HubModelOption,
} from "./use-hub-models";
import { MentionEditor, type MentionEditorHandle } from "./MentionEditor";
import { notifyError } from "../../lib/notify";

/**
 * Assistant Hub (WP1.3, §1.9) — the composer: `PromptInput*` + a per-message `ModelSelector` override
 * (R-SES10) + durable queue-while-running (R-SES3) + an explicit Stop.
 *
 * A hub session's turn engine has a real durable steering queue (R-SES3) — a message typed while a
 * turn is running is persisted as `queued_user_message` and injected at the next step boundary,
 * surviving a restart — so this composer NEVER disables the input while running.
 *
 * The single Send↔Stop control (owner feedback 2026-07-26, revising the earlier "two separate
 * controls" model): one primary button occupies the action slot and MORPHS with state — while a turn
 * runs and the composer is EMPTY it is Stop (the `PromptInputSubmit` streaming square → `onStop`); the
 * moment the operator types a follow-up it flips back to Send (queue-or-send), provided the session's
 * capability manifest allows follow-ups while live (`capabilities.followUps`, D-US4). This mirrors the
 * dock's own `PromptInputSubmit` status machine, but layered over the hub's durable queue instead of
 * the dock's send-blocking.
 *
 * WP2.5 (composer power features) adds, layered onto the above without changing it:
 *  - a slash-command menu (`/` — {@link ComposerCommandList}) for skills (R-SK3's slash portion) and
 *    MCP prompts (R-MCP8, incl. the argument form + "result injected as user content");
 *  - a "Plan first" toggle (R-SES5) — chat/research only (mission mode already has its own in-band
 *    plan → approve flow); a lightweight, fully client-side v1: it prefixes the outgoing message with
 *    an explicit plan-first instruction rather than a structured plan-card part, since that would need
 *    turn-engine/prompt-architecture support this WP doesn't own — see `withPlanFirstDirective`'s doc;
 *  - `SpeechInput` voice dictation (feature-detected by the library itself; degrades to a disabled
 *    button with no crash where the browser lacks both Web Speech API and MediaRecorder support).
 *
 * WP3.4 adds Attachments: a paperclip button opens the SAME `PromptInputProvider` attachment picker
 * `PromptInput`'s own `onSubmit` already threads (`message.files`, data-URL `FileUIPart`s) — no second
 * upload mechanism. Picked files render as `Attachment` chips (removable) above the textarea; on send,
 * each is turned back into real bytes and uploaded (`uploadHubFile`, linked to THIS session — D-AH12)
 * BEFORE the message posts, so the resulting `hub_files` ids travel as `attachmentFileIds` on the very
 * same `HubSendMessageInput` (turn-engine.ts's `reconstructMessages` folds them into the model's
 * context — text inlines, everything else becomes a multimodal `file` part).
 *
 * The whole thing is wrapped in `PromptInputProvider` so a sibling component (here, the inline command
 * list + keyboard handling) can read/write the SAME live text the textarea shows via
 * `usePromptInputController()` — required for slash-trigger detection and command insertion; the
 * textarea becomes a normal CONTROLLED input once a provider is present (`@brand/ai`'s own documented
 * behavior), so passing `value`/`onChange` here is correct in both the real library and this feature's
 * tests (`test-support/brand-ai-mock.tsx`'s `PromptInputTextarea` stub has no context awareness of its
 * own — the explicit `value`/`onChange` below is what makes it controlled either way).
 *
 * hub-fixes WP6.2 (RC7) adds `SessionModeChip`, next to the model chip: the session's actual MODE
 * (chat/research/mission/auto), previously invisible in the composer and easy to confuse with
 * `AutonomyModeSelect`'s "Auto" autonomy level (the owner's own reported misreading). It owns its PATCH
 * directly (see the component's doc) rather than through a parent-owned callback like `onAutonomyChange`.
 *
 * ui-wave U4 (owner feedback) — a VISUAL/STRUCTURAL pass only (no prop, callback, or keyboard change):
 * the control row regroups into quiet icon buttons left, mic (ghost) + Send (the single solid-primary
 * action, disabled while empty) right.
 *
 * owner-feedback (2026-07-27) — the status strip lives INSIDE the frame. U4 had lifted it out above the
 * card, which read as a stray caption floating over the composer instead of part of it. It is now the
 * dock composer's exact shape (`features/assistant/AssistantComposer.tsx`): a `Sparkles` strip at the
 * top of the `rounded-xl border bg-card p-1.5` shell, with the input well recessed flush beneath it
 * (`rounded-t-none`) so the well's own top border reads as the divider. Always on, with the same
 * three-state text machine as the dock — except the running state carries the hub's durable-queue
 * affordance (R-SES3) rather than the dock's send-blocking wording.
 */
export function Composer(props: {
  session: HubSession;
  turnRunning: boolean;
  /** Accepted (202) once the API has queued/kicked off the message — never awaits the reply. */
  onSend: (input: HubSendMessageInput) => Promise<void>;
  onStop: () => void;
  models: HubModelOption[];
  modelsLoading: boolean;
  /** D-MI7 (WP 4.1) — credentials that produced no row; listed disabled-and-visible in the picker. */
  unavailableCredentials?: readonly HubModelCredentialIssue[];
  /**
   * Autonomy AS A COMPOSER MODE (the {@link AutonomyModeSelect} footer control, replacing the old
   * `ViewToolbar` dial). The session's current level; the parent owns the write (optimistic PATCH,
   * restore on failure) — this composer just surfaces it and reports a change. Shown in ALL modes
   * (unlike "Plan first", which is chat/research-only).
   */
  autonomy: HubAutonomyLevel;
  onAutonomyChange: (next: HubAutonomyLevel) => void;
  /**
   * WP1.3 (D-HUX13) — a width/alignment affordance ONLY: "centered" narrows the composer to a
   * hero-width block for a fresh session's floating invitation; "docked" (the default, today's
   * unchanged full-width behavior) is the normal in-session composer. The actual center→dock
   * TRANSFORM animation is owned by whatever positions this element (see `EmptySessionIntro`,
   * which renders this component via a render-prop passing its own resolved dock position) — this
   * prop never touches send logic, layout OUTSIDE the composer's own box, or the API surface.
   */
  dockPosition?: "centered" | "docked";
}) {
  return (
    <PromptInputProvider initialInput="">
      <ComposerInner {...props} />
    </PromptInputProvider>
  );
}

/** A message starting with "/" and nothing else yet (no space) — the slash-command trigger pattern.
 *  Exported for the unit tests; a leading "/" mid-typed-message (e.g. a literal file path) never
 *  matches once a space follows it, so the menu naturally steps out of the way of ordinary text. */
export const SLASH_TRIGGER_RE = /^\/(\S*)$/;

/** R-SES5 v1: prefixes the message with an explicit plan-first instruction rather than a dedicated
 *  structured "plan" part — the assistant's proposed plan renders as ordinary prose in chat/research
 *  mode (unlike mission mode's `MissionPlanCard`, which is a real structured-output part WP1.7 owns).
 *  A richer, part-based Intent Preview needs prompt-architecture (WP0.3) + turn-engine (WP1.1) support
 *  this composer-only WP doesn't own; exported so the exact wording is unit-tested and easy to revise. */
export function withPlanFirstDirective(text: string): string {
  return `Before doing anything else, propose a short, numbered plan for how you'll approach this and pause for my go-ahead — don't start acting yet.\n\n${text}`;
}

/** WP3.4 — the attachment picker only ever produces `data:` URLs client-side (no server round-trip
 *  until send); this turns one back into real bytes to upload. Synchronous (`atob`, not `fetch`) so it
 *  works identically in the browser and under vitest/jsdom. Exported for the unit test. */
export function dataUrlToFile(url: string, filename: string, mediaType: string): File {
  const commaIndex = url.indexOf(",");
  const header = url.slice(5, commaIndex); // e.g. "image/png;base64"
  const data = url.slice(commaIndex + 1);
  const bytes = header.endsWith(";base64")
    ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(data));
  return new File([bytes], filename, { type: mediaType });
}

/** hub-fixes WP6.2 (RC7) — the SESSION mode's icon/label/hint, keyed by `HubSessionMode`, so
 *  `SessionModeChip`'s trigger and its popover rows read from exactly one source of truth. */
const HUB_SESSION_MODE_META: Record<
  HubSessionMode,
  { label: string; icon: LucideIcon; hint: string }
> = {
  auto: {
    label: "Auto mode",
    icon: Wand2,
    hint: "Routes each message on its own: answers directly, proposes a mission for multi-step work, or asks first when it's genuinely unsure.",
  },
  chat: {
    label: "Chat",
    icon: MessageSquare,
    hint: "Always answers directly, one turn at a time — never proposes a mission on its own.",
  },
  research: {
    label: "Research",
    icon: Search,
    hint: "Tuned for multi-source research answers with citations — never proposes a mission on its own.",
  },
  mission: {
    label: "Mission",
    icon: Users,
    hint: "Runs a crew of agents against an approved plan — set when this session was created.",
  },
};

/** hub-fixes WP6.2 (RC7) — the modes `SessionModeChip`'s popover offers as a SWITCH TARGET from
 *  `current`. `mission` is never an offered target — entering it keeps its existing create-time/crew
 *  semantics (this chip only ever helps a session step DOWN out of it, never into it); a `mission`-mode
 *  session may switch to `auto` only, mirroring the API's running-mission guard
 *  (`apps/api/src/hub/routes.ts`'s PATCH handler refuses it while a mission is still in flight). Every
 *  other pair among auto/chat/research swaps freely. Exported for the unit test. */
export function switchableSessionModes(current: HubSessionMode): HubSessionMode[] {
  if (current === "mission") return ["auto"];
  return (["auto", "chat", "research"] as const).filter((mode) => mode !== current);
}

function ComposerInner({
  session,
  turnRunning,
  onSend,
  onStop,
  models,
  modelsLoading,
  unavailableCredentials,
  autonomy,
  onAutonomyChange,
  dockPosition = "docked",
}: {
  session: HubSession;
  turnRunning: boolean;
  onSend: (input: HubSendMessageInput) => Promise<void>;
  onStop: () => void;
  models: HubModelOption[];
  modelsLoading: boolean;
  /** D-MI7 (WP 4.1) — credentials that produced no row; listed disabled-and-visible in the picker. */
  unavailableCredentials?: readonly HubModelCredentialIssue[];
  autonomy: HubAutonomyLevel;
  onAutonomyChange: (next: HubAutonomyLevel) => void;
  dockPosition?: "centered" | "docked";
}) {
  const controller = usePromptInputController();
  const { value: text, setInput } = controller.textInput;
  const { attachments } = controller;
  const editorRef = useRef<MentionEditorHandle | null>(null);

  const [sending, setSending] = useState(false);
  // D-MI1/D-MI8 (WP 3.1) — the override is the whole ROSTER ROW (credential × model), not a bare model
  // id: a per-message switch to "the subscription Sonnet" is only expressible if the credential
  // travels with it. `null` ⇒ no override (this session's own pinned model/credential).
  const [overrideModel, setOverrideModel] = useState<HubModelOption | null>(null);
  const [repinning, setRepinning] = useState(false);
  const [planFirst, setPlanFirst] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [argPromptItem, setArgPromptItem] = useState<McpPromptCommandItem | null>(null);

  // A fresh session starts on its own default model, with no lingering plan-first/menu state.
  useEffect(() => {
    setOverrideModel(null);
    setRepinning(false);
    setPlanFirst(false);
    setMenuDismissed(false);
  }, [session.id]);

  /**
   * D-MI7 (WP 4.1) — RE-PIN the session onto the model currently overridden for the next message.
   * Offered only while an override is in force AND it differs from the session's own pin (by
   * credential × model, so re-pinning the metered `claude-sonnet-5` onto the SUBSCRIPTION twin is a
   * real, offerable change rather than a no-op).
   *
   * This is the entry point the WP-3.1 carry-forward flagged as missing: `HubSessionPatch` has
   * carried `providerCredentialId` since WP 1.1 and the resolver has honoured it since WP 2.1, but
   * nothing in `apps/web` ever PATCHed `session.model`, so the credential could only ever be pinned
   * at create time. `hubModelWireFields` sends BOTH fields — the one helper that makes dropping the
   * credential impossible.
   */
  const repinTarget =
    overrideModel &&
    !(
      overrideModel.modelId === session.model &&
      overrideModel.credentialId === (session.providerCredentialId ?? overrideModel.credentialId)
    )
      ? overrideModel
      : null;

  const handleRepin = useCallback(
    async (target: HubModelOption): Promise<void> => {
      setRepinning(true);
      try {
        await updateHubSession(session.id, hubModelWireFields(target));
        // The override has become the session's own model — keeping it set would imply a per-message
        // override that no longer overrides anything.
        setOverrideModel(null);
      } catch (error) {
        notifyError("Couldn’t pin the model to this session", {
          description: getErrorMessage(error),
        });
      } finally {
        setRepinning(false);
      }
    },
    [session.id],
  );

  // Any edit re-arms the menu after an Escape dismissal (typing again means the operator isn't done).
  useEffect(() => {
    setMenuDismissed(false);
  }, [text]);

  const slashMatch = SLASH_TRIGGER_RE.exec(text);
  const slashQuery = slashMatch?.[1] ?? null;
  const commandsOpen = slashQuery !== null && !menuDismissed;

  const catalog = useComposerCommandCatalog(commandsOpen);
  const filteredCommands = useMemo(
    () => filterComposerCommands(catalog.items, slashQuery ?? ""),
    [catalog.items, slashQuery],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [slashQuery, filteredCommands.length]);

  // An external text set (slash resolve / voice): update BOTH the controller (slash detection) and the
  // mention editor's own content (it manages its contenteditable DOM imperatively — see MentionEditor).
  const insertPromptText = useCallback(
    (resolvedText: string) => {
      setInput(resolvedText);
      editorRef.current?.setPlainText(resolvedText);
      editorRef.current?.focus();
    },
    [setInput],
  );

  const selectCommand = useCallback(
    (item: ComposerCommandItem) => {
      if (item.kind === "skill") {
        insertPromptText(`/${item.slug} `);
        return;
      }
      if (item.args.length > 0) {
        setArgPromptItem(item);
        return;
      }
      void resolvePromptText(item, {}).then((result) => {
        if (result.ok) {
          insertPromptText(result.text);
        } else {
          notifyError("Couldn’t get the prompt", { description: result.error });
          editorRef.current?.focus();
        }
      });
    },
    [insertPromptText],
  );

  // Slash-command keyboard nav — the mention editor delegates Arrow/Enter/Escape here while the `/` popup
  // is open (the `@` popup handles its own nav first). Retains the exact behavior the textarea had.
  const handleSlashKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!commandsOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
      if (filteredCommands.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const item = filteredCommands[highlightedIndex] ?? filteredCommands[0];
        if (item) selectCommand(item);
      }
    },
    [commandsOpen, filteredCommands, highlightedIndex, selectCommand],
  );

  const submit = useCallback(async () => {
    const serialized = editorRef.current?.serialize() ?? { text: "", mentionedAgentIds: [] };
    const trimmed = serialized.text.trim();
    if (sending || trimmed.length === 0) return;
    setSending(true);
    // OPTIMISTIC clear: free the composer immediately for follow-up typing (queue-while-running) so the
    // just-sent message never lingers and fast keystrokes aren't wiped by a late clear. It also keeps
    // the editor aligned with `@brand/ai` PromptInput, which clears the controller synchronously on a
    // button submit. Restored below if the send fails.
    editorRef.current?.clear();
    setInput("");
    try {
      // WP3.4 — upload every picked attachment (linked to THIS session, D-AH12) BEFORE the message
      // posts, so the resulting file ids travel on the SAME send as `attachmentFileIds`.
      const attachmentFileIds = await Promise.all(
        attachments.files.map(async (part) => {
          const file = dataUrlToFile(part.url, part.filename ?? "attachment", part.mediaType);
          const uploaded = await uploadHubFile(file, { sessionId: session.id, role: "upload" });
          return uploaded.id;
        }),
      );
      const outgoing = planFirst ? withPlanFirstDirective(trimmed) : trimmed;
      await onSend({
        text: outgoing,
        // D-MI1 — model AND its credential, or neither. A `model` without a `providerCredentialId`
        // falls back to the session's pin server-side, which is exactly the silent mis-route this
        // workstream exists to close.
        ...(overrideModel ? hubModelWireFields(overrideModel) : {}),
        ...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {}),
        // End-user UX pass — `@`-mentioned saved agents → a deterministic team handoff (approve-first).
        ...(serialized.mentionedAgentIds.length > 0
          ? { mentionedAgentIds: serialized.mentionedAgentIds }
          : {}),
      });
      attachments.clear();
    } catch (error) {
      notifyError("Couldn’t send message", { description: getErrorMessage(error) });
      // Restore the text so it isn't lost, and re-sync the controller (the library may have cleared it
      // on a button submit) so the editor and controller never diverge. (A rare failure reverts any
      // @-mention chip to plain text — re-mention to restore the handoff.)
      editorRef.current?.setPlainText(serialized.text);
      setInput(serialized.text);
    } finally {
      setSending(false);
    }
  }, [sending, overrideModel, planFirst, onSend, attachments, session.id, setInput]);

  // The single Send↔Stop control (owner feedback): while a turn runs, an EMPTY composer shows Stop;
  // typing a follow-up flips it back to Send — but only when the session's capability manifest allows a
  // follow-up while live (`followUps`, D-US4; absent ⇒ the hub's historical always-queue behavior). The
  // `submitted` spinner (this request's own 202-in-flight) always wins over both.
  const hasText = text.trim().length > 0;
  const canQueueWhileRunning = session.capabilities?.followUps !== false;
  const showStop = turnRunning && !sending && (!hasText || !canQueueWhileRunning);
  const sendStatus = sending
    ? ("submitted" as const)
    : showStop
      ? ("streaming" as const)
      : undefined;
  const allowPlanFirst = session.mode !== "mission"; // mission mode has its own in-band plan → approve

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5",
        dockPosition === "centered" && "mx-auto w-full",
      )}
      data-dock-position={dockPosition}
    >
      {/* owner-feedback (2026-07-26): the DOCK composer's two-tone look — a white/`bg-card` outer card,
          PADDED (`p-1.5`), wrapping a GRAY (`bg-muted`) inner input surface (below). The earlier
          single-surface pass had flattened the inner field to the same colour as the card, so there was
          no visible frame ("the white area around the gray input is missing"). The padding IS the white
          frame; the muted inner field is the offset. Elevation rides the per-theme `--composer-elevation`
          token (styles/app.css) since this theme ships no Tailwind `--shadow-*` tokens. */}
      <div
        className="rounded-xl border border-border bg-card p-1.5 transition-shadow"
        style={{ boxShadow: "var(--composer-elevation)" }}
      >
        {/* owner-feedback (2026-07-27): the status strip sits INSIDE the frame, at the top of the card
            — the dock composer's exact shape. The one STATE that must never be lost is R-SES3's
            queue-while-running affordance, which is why the running text says the follow-up QUEUES
            rather than the dock's "responding…". */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-meta text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {sending
              ? "Sending…"
              : turnRunning
                ? "The assistant is replying — a new message queues and sends next."
                : "Awaiting your input"}
          </span>
        </div>
        <PromptInput
          onSubmit={() => {
            // The submit BUTTON routes here (the form submit). Enter is handled by MentionEditor →
            // `onSubmit` directly (a contenteditable never submits the form). `submit` reads the editor.
            void submit();
          }}
          // `h-auto` is REQUIRED: the underlying `@brand/ui` InputGroup only grows past its fixed `h-9`
          // when it detects a real `<textarea>` (`has-[textarea]:h-auto`). MentionEditor is a
          // contenteditable, so we force the grow here — otherwise `overflow-hidden` clips the editor +
          // the whole footer row (attach/model/…/Send). owner-feedback (2026-07-26): the InputGroup now
          // carries a MUTED/gray fill (`bg-muted`) so it reads as an inset field inside the padded white
          // card above — the dock composer's two-tone. Its own focus-visible ring is kept (no `ring-0`).
          // owner-feedback (2026-07-27): `rounded-t-none` squares the top edge so the well sits FLUSH
          // under the status strip above it (the dock's recessed-well shape) — its own top border then
          // reads as the divider between status and input.
          surfaceClassName="h-auto rounded-t-none rounded-b-lg bg-muted"
        >
          <PromptInputBody>
            {attachments.files.length > 0 ? (
              // px-4 pt-3 aligns the chip tray with the editor's own inset — one shared gutter now
              // that both sit directly on the single surface. ui-wave U4 (owner feedback).
              <Attachments className="px-4 pt-3" data-testid="composer-attachments">
                {attachments.files.map((part) => (
                  <Attachment
                    key={part.id}
                    data={part}
                    onRemove={() => attachments.remove(part.id)}
                  >
                    <AttachmentPreview />
                    <AttachmentInfo />
                    <AttachmentRemove />
                  </Attachment>
                ))}
              </Attachments>
            ) : null}
            {/* owner-feedback (2026-07-26): the input row — the editor grows, and voice dictation is
                pinned to its RIGHT edge (moved up out of the footer). `w-full` so the row spans the
                whole surface (the editor was `w-full` for this reason before it was wrapped); `min-w-0
                flex-1` lets the editor fill the space; `items-start` keeps the mic on the first line as
                the editor grows downward. */}
            <div className="flex w-full items-start">
              <div className="min-w-0 flex-1">
                <MentionEditor
                  ref={editorRef}
                  onChange={setInput}
                  onSubmit={() => void submit()}
                  slashOpen={commandsOpen}
                  onSlashKeyDown={handleSlashKeyDown}
                  placeholder={
                    turnRunning
                      ? "Type a follow-up — it queues… (/ commands · @ agents)"
                      : "Ask the assistant… (/ commands · @ agents)"
                  }
                />
              </div>
              <SpeechInput
                lang="en-US"
                aria-label="Voice input"
                title="Voice input (Chrome/Edge — degrades gracefully elsewhere)"
                // The library ships SpeechInput as a SOLID primary circle — a second accent competing
                // with Send. Overridden to a quiet ghost icon; while recording, the library's own pulse
                // rings + stop glyph still carry the recording accent, so the state stays legible.
                className="mt-1.5 mr-1.5 size-8 shrink-0 rounded-lg bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                onTranscriptionChange={(transcript) => {
                  // Append (not replace) so an already-inserted @-mention chip — and its agent id — is
                  // preserved; `appendText`'s own emitChange keeps the controller text in sync.
                  editorRef.current?.appendText(transcript);
                }}
              />
            </div>
          </PromptInputBody>
          {/* One control row, two legible groups — the quiet inputs on the left (all ICON-ONLY now,
              owner feedback 2026-07-26: the labelled chips ate the row; each button's value lives in its
              tooltip + aria-label), the single Send↔Stop action on the right. The row hugs the surface
              edge at px-2 pb-2 pt-1. */}
          <PromptInputFooter className="px-2 pb-2 pt-1">
            <PromptInputTools className="flex-wrap gap-1">
              <PromptInputButton
                type="button"
                variant="ghost"
                size="icon-sm"
                tooltip="Attach a file"
                aria-label="Attach a file"
                onClick={() => attachments.openFileDialog()}
              >
                <Paperclip className="size-3.5" aria-hidden="true" />
              </PromptInputButton>
              <PromptInputButton
                type="button"
                variant="ghost"
                size="icon-sm"
                tooltip="Commands — skills, MCP prompts (type /)"
                aria-label="Commands"
                onClick={() => {
                  if (text.trim().length === 0) {
                    setInput("/");
                    editorRef.current?.setPlainText("/");
                  }
                  setMenuDismissed(false);
                  editorRef.current?.focus();
                }}
              >
                <Slash className="size-3.5" aria-hidden="true" />
              </PromptInputButton>
              <MessageModelPicker
                models={models}
                modelsLoading={modelsLoading}
                unavailableCredentials={unavailableCredentials}
                selected={overrideModel}
                sessionModel={session.model}
                sessionCredentialId={session.providerCredentialId ?? null}
                onChange={setOverrideModel}
              />
              {/* D-MI7 / WP 4.1 carry-forward — the RE-PIN entry point. Until now nothing in
                  `apps/web` ever PATCHed `session.model`, so WP 3.1's "the credential travels on the
                  model patch" was locked at the wire level only. It appears exactly where the
                  operator has just expressed the choice: pick an override, then keep it. */}
              {repinTarget ? (
                <PromptInputButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={repinning}
                  aria-label={`Pin ${repinTarget.modelId} as this session's model`}
                  tooltip={`Pin ${repinTarget.modelId} as this session's model — later messages use it too`}
                  onClick={() => void handleRepin(repinTarget)}
                >
                  <Pin className="size-3.5" aria-hidden="true" />
                </PromptInputButton>
              ) : null}
              {/* Session MODE — next to the model chip, deliberately separate from the autonomy chip
                  after it (hub-fixes WP6.2/RC7: conflating the two produced the owner's "Auto"
                  misreading). */}
              <SessionModeChip session={session} />
              {/* Autonomy AS A MODE — shown in ALL modes (unlike "Plan first"). */}
              <AutonomyModeSelect value={autonomy} onChange={onAutonomyChange} />
              {allowPlanFirst ? (
                <PromptInputButton
                  type="button"
                  variant={planFirst ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-pressed={planFirst}
                  aria-label="Plan first"
                  tooltip="Plan first — ask the assistant to propose a plan before acting"
                  onClick={() => setPlanFirst((current) => !current)}
                >
                  <ListChecks className="size-3.5" aria-hidden="true" />
                </PromptInputButton>
              ) : null}
            </PromptInputTools>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* owner-feedback (2026-07-26): ONE morphing action in the send slot — while a turn runs
                  on an EMPTY composer it is Stop (`streaming` square → `onStop`), and the moment a
                  follow-up is typed it flips back to Send (queue-or-send, when the session allows it).
                  Its disabled state also surfaces the empty-composer affordance (`submit` still guards
                  empty text). Mirrors the dock's PromptInputSubmit status machine. */}
              <PromptInputSubmit
                status={sendStatus}
                onStop={showStop ? onStop : undefined}
                disabled={sending || (!showStop && !hasText)}
                aria-label={showStop ? "Stop" : "Send message"}
                className="size-9 rounded-lg"
              >
                {sendStatus === undefined ? <ArrowUp className="size-4" /> : undefined}
              </PromptInputSubmit>
            </div>
          </PromptInputFooter>
        </PromptInput>

        {commandsOpen ? (
          <ComposerCommandList
            query={slashQuery ?? ""}
            items={filteredCommands}
            loading={catalog.loading}
            highlightedIndex={highlightedIndex}
            onHighlight={setHighlightedIndex}
            onSelect={selectCommand}
          />
        ) : null}
      </div>

      <McpPromptArgsDialog
        item={argPromptItem}
        open={argPromptItem !== null}
        onOpenChange={(open) => {
          if (!open) setArgPromptItem(null);
        }}
        onResolved={(resolvedText) => {
          setArgPromptItem(null);
          insertPromptText(resolvedText);
        }}
      />
    </div>
  );
}

/** hub-fixes WP6.2 (RC7) — the composer's MODE chip: shows the session's actual `mode`
 *  (chat/research/mission/auto) with its own icon + label, next to the model chip. Deliberately
 *  separate from `AutonomyModeSelect` (that chip governs AUTONOMY — how freely the assistant acts
 *  without asking; this one governs MODE — what kind of turn the session runs at all). Conflating the
 *  two is exactly what produced the owner's "Auto" misreading (RC7's evidence). Clicking the chip
 *  explains the current mode and, where allowed (see {@link switchableSessionModes}), offers a switch.
 *
 *  The write is optimistic-then-confirmed, restored on failure — same discipline
 *  `AssistantView.tsx`'s `handleAutonomyChange` uses for the autonomy chip's PATCH, except this chip
 *  owns the PATCH itself (`updateHubSession`) rather than routing through a parent callback:
 *  `AssistantView.tsx` isn't part of this WP's file set, and `Composer.tsx` already calls the API
 *  directly for its OTHER self-contained action (`uploadHubFile`, for attachments) — the same pattern,
 *  applied here. A rejected switch (the API's running-mission guard, 409) reverts the optimistic value
 *  and surfaces a toast, same as every other composer action's failure path. */
function SessionModeChip({ session, disabled }: { session: HubSession; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<HubSessionMode>(session.mode);
  const [pending, setPending] = useState(false);

  // A different session (switching threads) or the prop catching up after our own PATCH resolves
  // resyncs the local mirror — mirrors `ComposerInner`'s own per-session reset effect above.
  useEffect(() => {
    setMode(session.mode);
  }, [session.mode, session.id]);

  const meta = HUB_SESSION_MODE_META[mode];
  const ModeIcon = meta.icon;
  const targets = switchableSessionModes(mode);

  const handleSwitch = useCallback(
    (next: HubSessionMode) => {
      if (next === mode || pending) return;
      const previous = mode;
      setMode(next);
      setPending(true);
      setOpen(false);
      void updateHubSession(session.id, { mode: next })
        .then((updated) => setMode(updated.mode))
        .catch((error: unknown) => {
          setMode(previous); // restore the previous chip value on a rejected/failed switch
          notifyError("Couldn’t change mode", { description: getErrorMessage(error) });
        })
        .finally(() => setPending(false));
    },
    [mode, pending, session.id],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* owner-feedback: icon-only — the mode's icon carries the state, the tooltip + aria-label
            carry the label + explanation. */}
        <PromptInputButton
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || pending}
          aria-label={`Session mode: ${meta.label}`}
          tooltip={`Mode: ${meta.label} — ${meta.hint}`}
        >
          <ModeIcon className="size-3.5" aria-hidden="true" />
        </PromptInputButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <Text variant="meta" tone="muted" className="block px-2 py-1.5">
          Session mode
        </Text>
        <div className="px-2 pb-1.5 text-caption leading-snug text-muted-foreground">
          {meta.hint}
        </div>
        {targets.length > 0 ? (
          <ul className="flex flex-col gap-0.5 border-t pt-1">
            {targets.map((target) => {
              const targetMeta = HUB_SESSION_MODE_META[target];
              const TargetIcon = targetMeta.icon;
              return (
                <li key={target}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSwitch(target)}
                    className="h-auto w-full items-start justify-start gap-2 whitespace-normal px-2 py-1.5 text-left"
                  >
                    <TargetIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-body font-medium leading-tight">
                        Switch to {targetMeta.label}
                      </span>
                      <span className="text-caption leading-snug text-muted-foreground">
                        {targetMeta.hint}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The per-message model override trigger (R-SES10) — the shared {@link HubModelPicker} behind the
 *  composer's own icon-only chip, defaulting to the session's own model when nothing is overridden.
 *
 *  D-MI1/D-MI8 (WP 3.1): a picked entry is the whole roster ROW, so the credential behind it reaches
 *  `HubSendMessageInput.providerCredentialId`.
 *
 *  D-MI7 (WP 4.1): the hand-rolled palette this used to be is gone. It passed `value={model.modelId}`
 *  and no `keywords` — the reason the palette could not be searched by provider — and it had to
 *  EXCLUDE the session's own row from "Switch model" (by credential × model) to stop a pinned session
 *  from listing its own model twice. The shared picker instead shows the session's row like any other,
 *  with the `Check` marking whichever is currently in force, plus a "Use this session's default" row
 *  that clears the override. */
function MessageModelPicker({
  models,
  modelsLoading,
  unavailableCredentials,
  selected,
  sessionModel,
  sessionCredentialId,
  onChange,
}: {
  models: HubModelOption[];
  modelsLoading: boolean;
  unavailableCredentials?: readonly HubModelCredentialIssue[];
  selected: HubModelOption | null;
  sessionModel: string;
  sessionCredentialId: string | null;
  onChange: (model: HubModelOption | null) => void;
}) {
  const label = selected?.modelId ?? sessionModel;
  const sessionRow = findHubModelOption(models, sessionModel, sessionCredentialId);

  return (
    <HubModelPicker
      models={models}
      loading={modelsLoading}
      unavailable={unavailableCredentials ?? []}
      // With no override in force the palette marks the session's OWN row as current — resolved by
      // credential × model, so a session pinned to the metered twin doesn't light up the subscription
      // one (and vice versa).
      value={selected ?? sessionRow ?? null}
      // A session pinned to a model that is no longer in the roster (deleted credential, legacy row)
      // still shows what it is running on rather than an empty trigger.
      fallbackModelId={selected ? null : sessionModel}
      onChange={onChange}
      clearOption={{
        label: "Use this session's default",
        hint: sessionModel,
        onClear: () => onChange(null),
      }}
      dialogTitle="Choose a model for this message"
      trigger={
        /* owner-feedback: icon-only — the tooltip + aria-label carry the (often long) model id, which
           was eating the footer row before. */
        <PromptInputButton
          variant="ghost"
          size="icon-sm"
          tooltip={`Model for this message — ${label}`}
          aria-label={`Model: ${label}`}
        >
          <Globe className="size-3.5" aria-hidden="true" />
        </PromptInputButton>
      }
    />
  );
}
