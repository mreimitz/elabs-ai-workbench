// Assistant Hub (WP2.6, R-GUI5) — per-widget generative-UI state: the two-tier interactivity engine.
//
// TIER 1 (client-side ops that NEVER re-enter the model): field edits + form resets. They update local
// state and are persisted as a `ui_state` event (via `onPersistUiState`) so a replay/reconnect
// rehydrates the exact same widget state (R-GUI5 / R-SES1) — but they are NOT sent to the model.
//
// TIER 2 (deliberate to-assistant actions): a Form submit / a `send` Button. These build a DUAL-AUDIENCE
// message (the shared `buildGenuiSubmitMessage`: a human-friendly line the user sees + the machine
// `formState` snapshot the model reads) and send it as the user's next turn (`onSubmit`).
//
// State shape (persisted verbatim in the `ui_state` event): `{ forms: { [formName]: { values, submitted } } }`.

import { useCallback, useMemo, useState } from "react";
import {
  buildGenuiSubmitMessage,
  type HubActorKind,
} from "@mcp-token-footprint/shared";

export type GenuiFormEntry = {
  values: Record<string, unknown>;
  submitted?: boolean;
};

export type GenuiWidgetState = {
  forms: Record<string, GenuiFormEntry>;
};

/** The handlers a GenUI widget needs to round-trip (from the ConversationPane; absent ⇒ read-only). */
export type GenuiWidgetHandlers = {
  /** Persist a client-side state snapshot as a `ui_state` event (R-GUI5) — replay-rehydrated, never to
   *  the model. Absent ⇒ interactivity is read-only (e.g. inside a regenerate variant). */
  onPersistUiState?: (messageId: string, key: string | undefined, state: unknown) => void;
  /** Send a to-assistant message as the user's next turn (dual-audience). Absent ⇒ read-only. */
  onSubmit?: (text: string) => void;
};

/** The render context threaded to every catalog node so interactive leaves can round-trip. */
export type GenuiRenderContext = {
  interactive: boolean;
  formValues: (formName: string) => Record<string, unknown> | undefined;
  formSubmitted: (formName: string) => boolean;
  onFormChange: (formName: string, values: Record<string, unknown>) => void;
  /** A Form submit (R-GUI5 tier 2). `humanMessage`/`llmMessage` come from the spec (or are derived). */
  onFormSubmit: (input: {
    formName: string;
    values: Record<string, unknown>;
    humanMessage?: string;
    llmMessage?: string;
  }) => void;
  /** A `send` Button (R-GUI5 tier 2). */
  onSend: (message: string) => void;
  /** A `reset` Button (R-GUI5 tier 1 — client-only). Clears this widget's form values. */
  onReset: () => void;
};

function coerceState(raw: unknown): GenuiWidgetState {
  if (raw && typeof raw === "object" && "forms" in raw && typeof (raw as GenuiWidgetState).forms === "object") {
    return { forms: { ...(raw as GenuiWidgetState).forms } };
  }
  return { forms: {} };
}

/**
 * Manage one GenUI widget's interactive state (R-GUI5). `messageId`/`widgetKey` scope the `ui_state`
 * events; `initialState` is the replayed latest `ui_state` (rehydration). Returns the render context
 * + the current state (the context is `interactive: false` when no handlers are wired — a read-only
 * render, e.g. a regenerate variant).
 */
export function useGenuiWidgetState(input: {
  messageId?: string;
  widgetKey?: string;
  initialState?: unknown;
  handlers?: GenuiWidgetHandlers;
  /** Who is emitting a submitted turn — always "user" for a real interaction (informational). */
  actor?: HubActorKind;
}): { state: GenuiWidgetState; ctx: GenuiRenderContext } {
  const [state, setState] = useState<GenuiWidgetState>(() => coerceState(input.initialState));
  const { messageId, widgetKey, handlers } = input;
  const interactive = !!handlers?.onPersistUiState || !!handlers?.onSubmit;

  const persist = useCallback(
    (next: GenuiWidgetState) => {
      setState(next);
      if (messageId && handlers?.onPersistUiState) {
        handlers.onPersistUiState(messageId, widgetKey, next);
      }
    },
    [messageId, widgetKey, handlers],
  );

  const ctx = useMemo<GenuiRenderContext>(
    () => ({
      interactive,
      formValues: (formName) => state.forms[formName]?.values,
      formSubmitted: (formName) => !!state.forms[formName]?.submitted,
      onFormChange: (formName, values) => {
        persist({ forms: { ...state.forms, [formName]: { ...state.forms[formName], values } } });
      },
      onFormSubmit: ({ formName, values, humanMessage, llmMessage }) => {
        persist({ forms: { ...state.forms, [formName]: { values, submitted: true } } });
        const text = buildGenuiSubmitMessage({
          humanFriendlyMessage: humanMessage?.trim() || `Submitted the "${formName}" form.`,
          ...(llmMessage ? { llmFriendlyMessage: llmMessage } : {}),
          surfaceName: formName,
          surfaceId: widgetKey ?? formName,
          formState: values,
        });
        handlers?.onSubmit?.(text);
      },
      onSend: (message) => {
        const text = message.trim();
        if (text) handlers?.onSubmit?.(text);
      },
      onReset: () => {
        const cleared: Record<string, GenuiFormEntry> = {};
        for (const [name, entry] of Object.entries(state.forms)) {
          cleared[name] = { ...entry, values: {}, submitted: false };
        }
        persist({ forms: cleared });
      },
    }),
    [interactive, state, persist, handlers, widgetKey],
  );

  return { state, ctx };
}
