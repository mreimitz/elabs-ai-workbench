import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * WP 3.2 (UX overhaul · G9/S20) — the cross-representation link layer for the run console.
 *
 * A terminal run is navigable: a turn in the rail, a context-window column, an error card, and a
 * Trace row all cross-link to the matching block in the chat (and vice versa). The mechanism is a
 * small, pure "anchor" contract shared by every console pane:
 *
 *   - Each pane tags its scroll targets with a `data-console-anchor="<value>"` attribute
 *     ({@link consoleAnchor}) — a TURN block (`turn:<turnIndex>`) or a TOOL call (`tool:<toolCallId>`).
 *   - A navigation intent ({@link ConsoleNavTarget}) names a pane + a semantic ref; the target pane
 *     resolves the ref to an anchor value and scrolls its own scroll container to it
 *     ({@link scrollToConsoleAnchor}).
 *
 * Anchor VALUES (not DOM ids) are used with a scoped `querySelectorAll` walk so a value can contain
 * any character (tool-call ids, step ids with `:mcp:` separators) without CSS-selector escaping, and
 * so the same value can legitimately exist in more than one pane — each pane only ever searches
 * inside its own container.
 */

/** The attribute every console scroll target carries. */
export const CONSOLE_ANCHOR_ATTR = "data-console-anchor";

/** The two left-pane representations that share anchors — Chat and Trace (the "raw" tab). */
export type ConsolePane = "chat" | "trace";

/**
 * A semantic navigation reference. A `turn` targets an assistant turn (0-based `turnIndex`, matching
 * `TimelineAssistantTurn.turnIndex`). A `tool` targets a specific tool call by its `toolCallId`, with
 * an optional `turnIndex` fallback for panes that only anchor at turn granularity (the chat pane).
 * An `insight` (WP 7.1, D-QA9) targets a `Acme.Snapshot` insight cited in a `acme_answers` answer —
 * the REVERSE leg of the rail↔chat link: a rail insight row resolves to the matching citation chip
 * in the chat ({@link citationAnchorValue}), falling back to the whole turn when that snapshot is
 * cited by no text block. A `user` (Observability WP3.4) targets a USER turn (the opener prompt or an
 * interactive follow-up) by its own `run_steps.id` — the in-run search's "prompt" hits are the first
 * thing in the chat with no `turnIndex` of their own to anchor on.
 */
export type ConsoleNavRef =
  | { kind: "turn"; turnIndex: number }
  | { kind: "tool"; toolCallId: string; turnIndex?: number }
  | { kind: "insight"; turnIndex: number; snapshotIndex: number }
  | { kind: "user"; stepId: string };

/** A navigation intent: which pane to reveal, what to scroll to, and a monotonic re-trigger nonce. */
export type ConsoleNavTarget = {
  pane: ConsolePane;
  ref: ConsoleNavRef;
  /** Monotonically increasing so re-navigating to the SAME ref still fires the pane's scroll effect. */
  nonce: number;
};

/** The anchor value for an assistant turn (0-based index). */
export function turnAnchorValue(turnIndex: number): string {
  return `turn:${turnIndex}`;
}

/** The anchor value for a tool call (its provider `toolCallId`). */
export function toolAnchorValue(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

/**
 * Acme Answers (WP 5.3 · WP 7.1, D-QA9) — the anchor value for a `Acme.Snapshot` insight, now
 * TURN-QUALIFIED (`insight:<turnIndex>:<snapshotIndex>`). `snapshotIndex` is 0-based into that turn's
 * `AnswersStepPayload.snapshots`; the turn prefix is what makes the value unique across a multi-turn
 * run (a bare `insight:0` collided on every turn's first snapshot). Mirrors
 * {@link turnAnchorValue}/{@link toolAnchorValue} so a snapshot insight joins the same
 * scoped-attribute anchor namespace.
 *
 * CONTRACT (WP 7.1, cross-pane): the RAIL `InsightsPanel` row for `(turnIndex, snapshotIndex)` is the
 * FORWARD scroll TARGET — its `<li>` spreads `{...consoleAnchor(insightAnchorValue(turnIndex,
 * snapshotIndex))}`. The answer's citation chip is the forward SOURCE ({@link scrollToInsight}) — it
 * searches document-wide (the target now lives in the OTHER pane) for this turn-qualified value. A
 * missing target (a dangling out-of-range citation, or a rail not yet mounted) is a harmless no-op.
 */
export function insightAnchorValue(turnIndex: number, snapshotIndex: number): string {
  return `insight:${turnIndex}:${snapshotIndex}`;
}

/** Observability (WP3.4) — the anchor value for a USER turn (`user:<stepId>`), by its own
 *  `run_steps.id` — the opener prompt / an interactive follow-up have no `turnIndex` of their own. */
export function userAnchorValue(stepId: string): string {
  return `user:${stepId}`;
}

/**
 * Acme Answers (WP 7.1, D-QA9) — the anchor value for a citation chip in the answer text
 * (`citation:<turnIndex>:<snapshotIndex>`). This is the REVERSE scroll TARGET: a rail insight row's
 * "Show in answer" resolves an `insight` {@link ConsoleNavRef} to this value (via
 * {@link anchorValueForRef}) so the chat scrolls to the matching chip; it falls back to the turn
 * ({@link fallbackAnchorValueForRef}) when the snapshot is cited by no text block.
 */
export function citationAnchorValue(turnIndex: number, snapshotIndex: number): string {
  return `citation:${turnIndex}:${snapshotIndex}`;
}

/**
 * The primary anchor value a nav ref resolves to. Exhaustive over {@link ConsoleNavRef.kind} — a new
 * ref kind added without a case here is a COMPILE error (the switch would then not return on every
 * path), which is deliberate: this is the single place ref→anchor mapping lives.
 */
export function anchorValueForRef(ref: ConsoleNavRef): string {
  switch (ref.kind) {
    case "turn":
      return turnAnchorValue(ref.turnIndex);
    case "tool":
      return toolAnchorValue(ref.toolCallId);
    case "insight":
      // The REVERSE leg lands on the citation chip in the answer text (WP 7.1, D-QA9).
      return citationAnchorValue(ref.turnIndex, ref.snapshotIndex);
    case "user":
      return userAnchorValue(ref.stepId);
  }
}

/**
 * The fallback anchor value for a ref, tried when the primary isn't present in a pane. A tool ref
 * falls back to its containing turn (the chat pane anchors turns, not individual tool cards), so an
 * error-card jump still lands on the right turn there; an insight ref falls back to its turn (a
 * snapshot cited by no text block has no chip to land on). Returns `null` when there's no fallback.
 * Exhaustive over {@link ConsoleNavRef.kind} for the same compile-time-guard reason as
 * {@link anchorValueForRef}.
 */
export function fallbackAnchorValueForRef(ref: ConsoleNavRef): string | null {
  switch (ref.kind) {
    case "turn":
      return null;
    case "tool":
      return typeof ref.turnIndex === "number" ? turnAnchorValue(ref.turnIndex) : null;
    case "insight":
      return turnAnchorValue(ref.turnIndex);
    case "user":
      return null;
  }
}

/** Spread onto a JSX element to make it a console scroll target: `<div {...consoleAnchor(value)} />`. */
export function consoleAnchor(value: string): Record<string, string> {
  return { [CONSOLE_ANCHOR_ATTR]: value };
}

/** The `toolCallId` a tool step belongs to (from its `{ toolCallId, … }` payload), or undefined. */
export function toolCallIdOfStep(step: Pick<RunStep, "payload">): string | undefined {
  const p = step.payload;
  if (p && typeof p === "object") {
    const v = (p as Record<string, unknown>).toolCallId;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** Find a scroll target by anchor value WITHIN a container (no CSS escaping — a scoped attribute walk). */
export function findConsoleAnchor(
  container: HTMLElement | null,
  value: string,
): HTMLElement | null {
  if (!container) return null;
  const nodes = container.querySelectorAll<HTMLElement>(`[${CONSOLE_ANCHOR_ATTR}]`);
  for (const node of nodes) {
    if (node.getAttribute(CONSOLE_ANCHOR_ATTR) === value) return node;
  }
  return null;
}

/**
 * Scroll a pane's container to a nav ref (primary anchor, then fallback) and flash it. Returns true
 * when a target was found and scrolled. Pure DOM — safe to call from a pane's nonce-keyed effect.
 */
export function scrollToConsoleAnchor(container: HTMLElement | null, ref: ConsoleNavRef): boolean {
  if (!container) return false;
  let el = findConsoleAnchor(container, anchorValueForRef(ref));
  if (!el) {
    const fb = fallbackAnchorValueForRef(ref);
    if (fb) el = findConsoleAnchor(container, fb);
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  flashConsoleAnchor(el);
  return true;
}

/**
 * Scroll a container to a RAW anchor value (not a `ConsoleNavRef`) and flash it. The value-first
 * sibling of {@link scrollToConsoleAnchor}, for anchors outside the turn/tool `ConsoleNavRef` grammar
 * (e.g. a snapshot insight — {@link insightAnchorValue}). Returns true when a target was found.
 */
export function scrollToConsoleAnchorValue(container: HTMLElement | null, value: string): boolean {
  const el = findConsoleAnchor(container, value);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  flashConsoleAnchor(el);
  return true;
}

/**
 * Acme Answers (WP 7.1, D-QA9) — scroll from a citation chip (`source`) in the ANSWER to its insight
 * row in the RAIL ({@link insightAnchorValue}). The FORWARD leg of the rail↔chat link. The target now
 * lives in the OTHER pane, so the lookup is DOCUMENT-WIDE (`source.ownerDocument.body`); the anchor is
 * turn-qualified (`insight:<turnIndex>:<snapshotIndex>`), so a document-wide search still hits exactly
 * one target — the same snapshot index in a DIFFERENT turn can never collide. Pure DOM and
 * best-effort: a missing target (a dangling out-of-range citation, or the rail not mounted) is a
 * silent no-op — never a throw.
 */
export function scrollToInsight(
  source: HTMLElement | null,
  turnIndex: number,
  snapshotIndex: number,
): boolean {
  if (!source) return false;
  return scrollToConsoleAnchorValue(
    source.ownerDocument.body,
    insightAnchorValue(turnIndex, snapshotIndex),
  );
}

/**
 * A brief token-backed outline pulse so the eye lands on the linked element. Uses the `--ring` token
 * (never a raw color) via inline style so it needs no runtime-generated Tailwind class, and restores
 * whatever inline styling was there before after the pulse.
 */
export function flashConsoleAnchor(el: HTMLElement): void {
  const prev = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    borderRadius: el.style.borderRadius,
  };
  el.style.outline = "2px solid var(--ring)";
  el.style.outlineOffset = "2px";
  if (!prev.borderRadius) el.style.borderRadius = "0.5rem";
  const restore = () => {
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.outlineOffset;
    el.style.borderRadius = prev.borderRadius;
  };
  if (typeof window !== "undefined") {
    window.setTimeout(restore, 1600);
  }
}
