import { useCallback, useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputButton,
} from "@brand/ai";
import { Badge } from "@brand/ui";
import { ArrowUp, Globe, PenLine, Sparkles, TriangleAlert } from "lucide-react";
import type { AssistantThread } from "@mcp-token-footprint/shared";
import { getErrorMessage } from "../../lib/errors";
import type { ScopeChipCopy } from "./assistant-scope-chip";
import { notifyError } from "../../lib/notify";

export type AssistantComposerPrefill = { nonce: number; text: string };

/**
 * The dock's footer (UI §3.5) — the brand-ui composer pattern (`ai-composer--empty-state-scene` is
 * the reference), composed from the exported `PromptInput*` primitives rather than the closed
 * `Composer` wrapper. Why not the wrapper: the vendored v1.6.0 `Composer` hard-codes an `ArrowUp`
 * as `PromptInputSubmit`'s children, and `PromptInputSubmit` renders `children ?? statusIcon` — so
 * the submitted (spinner) and streaming (stop square) states could NEVER appear, which made a live
 * turn look un-interruptible. Composing the identical two-tone frame from the same primitives the
 * wrapper uses (status strip + recessed `PromptInput` well) restores the real send-state machine:
 * ready → ArrowUp, submitted → Spinner, streaming → stop square that calls `onStop`. This is the
 * sanctioned library-first path for an upstream gap (see .claude/rules/library-first.md); if a
 * `@brand/ai` release forwards `sendStatus` icons through `Composer`, fold this back onto it.
 *
 * Reference-alignment (owner request 2026-07-12):
 * - The auto-accept ("write mode") control is an icon-only `PromptInputButton` you CLICK to flip —
 *   no Switch, no label text. Pressed state = filled `secondary` variant + `aria-pressed`.
 * - The model selector is the reference's ghost pill (globe + name + chevron) — a real `Select`
 *   dressed by `PromptInputSelectTrigger` (borderless, muted, hover-accent), not a bordered form
 *   `SelectTrigger`.
 *
 * Thread lifecycle (lazily creating a thread on the FIRST send from a blank dock) stays the
 * caller's concern (`AssistantDockContent`) — this component only owns the input well + controls.
 *
 * Prefilling from a page hook (`openAssistant({ prompt })`): `PromptInput`/`PromptInputTextarea`
 * read an optional lifted-state controller from context (`PromptInputProvider`), remounted via
 * `key` per prefill request — the sanctioned way to prime the field.
 */
export function AssistantComposer({
  composerKey,
  streaming,
  prefill,
  activeThread,
  models,
  nearExpiry,
  scopeChip,
  onSelectModel,
  onToggleAutoAccept,
  onSubmit,
  onStop,
}: {
  /** Remount key for the prefill provider — typically `${threadId}:${prefill?.nonce}` (see the
   *  containing dock): a new thread OR a new prefill request both prime a fresh input well. */
  composerKey: string;
  /** True while the thread is awaiting/streaming a response — turns the send button into Stop. */
  streaming: boolean;
  /** A one-shot prefilled prompt from `openAssistant({ prompt })`. */
  prefill: AssistantComposerPrefill | null;
  /** The active thread — drives the auto-accept mode button and model select. */
  activeThread: AssistantThread | null;
  /** The selectable model roster (empty until loaded — the select stays hidden). */
  models: string[];
  /** WP 3.3 — the subscription token-expiry warning, surfaced beside the auth-source badge. */
  nearExpiry: boolean;
  /** WP R1.5 (D-AS23) — "scope is visible": what the assistant may WRITE to on this page. */
  scopeChip: ScopeChipCopy;
  onSelectModel: (model: string) => void;
  onToggleAutoAccept: (autoAccept: boolean) => void;
  /** Send a message — resolves once the API has accepted it (202), NOT once the reply completes.
   *  May lazily create a thread first (a blank dock has none yet). */
  onSubmit: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [sending, setSending] = useState(false);

  const submit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      // Don't send while a turn is still streaming (WP 1.3 review): PromptInput's Enter handler
      // routes to submit even while the button shows Stop, so a second Enter would otherwise queue
      // a message mid-turn and mis-bucket the running turn's late events.
      if (sending || streaming || trimmed.length === 0) return;
      setSending(true);
      try {
        await onSubmit(trimmed);
      } catch (error) {
        notifyError("Couldn’t send the message.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      } finally {
        setSending(false);
      }
    },
    [sending, streaming, onSubmit],
  );

  // The real send-state machine (forwarded to PromptInputSubmit): submitted → Spinner,
  // streaming → stop square (click calls onStop), ready → ArrowUp (the reference's icon).
  const sendStatus = sending
    ? ("submitted" as const)
    : streaming
      ? ("streaming" as const)
      : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* The status strip above the frame: scope chip left (truncating), auth/expiry badges right.
          These are STATUS (which credential, which write scope) — actions live in the well's footer. */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Badge
          variant={scopeChip.scoped ? "outline" : "secondary"}
          className="min-w-0 truncate font-normal"
          title={
            scopeChip.scoped
              ? "What the assistant's writes are confined to on this page"
              : "No entity is open here, so every write is refused"
          }
        >
          {scopeChip.text}
        </Badge>
        <div className="flex shrink-0 items-center gap-1.5">
          {activeThread ? (
            <Badge
              variant="outline"
              className="font-normal"
              title="Which credential this thread uses"
            >
              {activeThread.authSource === "subscription" ? "Subscription" : "API key"}
            </Badge>
          ) : null}
          {/* WP 3.3 — the token-expiry warning, surfaced here too (not just Settings). */}
          {nearExpiry ? (
            <Badge
              variant="warning"
              className="gap-1 font-normal"
              title="This subscription token is close to its one-year expiry. Sign in again in Settings to refresh it."
            >
              <TriangleAlert aria-hidden className="size-3" />
              <span>Expiring soon</span>
            </Badge>
          ) : null}
        </div>
      </div>

      <PromptInputProvider
        key={`${composerKey}:${prefill?.nonce ?? 0}`}
        initialInput={prefill?.text ?? ""}
      >
        {/* The Composer wrapper's exact two-tone "double card" frame (rounded-xl bg-card shell,
            muted Sparkles status strip, recessed sharp-top well) — kept literal so this reads
            identically to every other composer in the app and to the Storybook reference. */}
        <div className="rounded-xl border bg-card p-1.5 shadow-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-meta text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>
              {sending
                ? "Sending…"
                : streaming
                  ? "The assistant is responding…"
                  : "Awaiting your input"}
            </span>
          </div>
          <PromptInput
            onSubmit={(message) => {
              void submit(message.text ?? "");
            }}
            surfaceClassName="rounded-t-none rounded-b-lg"
          >
            <PromptInputBody>
              <PromptInputTextarea placeholder="Ask the assistant…" />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                {activeThread ? (
                  <AutoAcceptModeButton thread={activeThread} onToggle={onToggleAutoAccept} />
                ) : null}
                {models.length > 0 ? (
                  <PromptInputSelect
                    value={activeThread?.model}
                    onValueChange={onSelectModel}
                    disabled={!activeThread}
                  >
                    <PromptInputSelectTrigger
                      size="sm"
                      className="w-auto min-w-0 max-w-44 gap-1.5 rounded-full"
                      aria-label="Model"
                    >
                      <Globe className="size-4" aria-hidden="true" />
                      <PromptInputSelectValue placeholder="Model" />
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent>
                      {models.map((model) => (
                        <PromptInputSelectItem key={model} value={model}>
                          {model}
                        </PromptInputSelectItem>
                      ))}
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                ) : null}
              </PromptInputTools>
              <div className="flex items-center gap-1">
                <PromptInputSubmit
                  status={sendStatus}
                  onStop={streaming ? onStop : undefined}
                  className="rounded-full"
                >
                  {/* Children only in the READY state — while sending/streaming, fall through to
                      PromptInputSubmit's own status icons (Spinner / stop square). */}
                  {sendStatus === undefined ? <ArrowUp className="size-4" /> : undefined}
                </PromptInputSubmit>
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </PromptInputProvider>
    </div>
  );
}

/**
 * The per-thread auto-accept "write mode" control (WP 2.1, D-AS4) — an icon-only toggle BUTTON
 * (owner request 2026-07-12: no Switch, no label text). Click flips the mode; pressed state reads
 * as the filled `secondary` variant + `aria-pressed`, and the tooltip spells out the carve-out:
 * create/update writes run without asking, but DELETES still always ask.
 */
function AutoAcceptModeButton({
  thread,
  onToggle,
}: {
  thread: AssistantThread;
  onToggle: (autoAccept: boolean) => void;
}) {
  const on = thread.autoAccept;
  return (
    <PromptInputButton
      aria-pressed={on}
      aria-label={`Auto-accept writes ${on ? "on" : "off"} — create and update writes ${on ? "run without asking" : "ask first"}; deletes always ask`}
      variant={on ? "secondary" : "ghost"}
      tooltip={
        on
          ? "Auto-accept writes: on — deletes always ask. Click to turn off."
          : "Auto-accept writes: off — every write asks. Click to turn on."
      }
      onClick={() => onToggle(!on)}
    >
      <PenLine className="size-4" />
    </PromptInputButton>
  );
}
