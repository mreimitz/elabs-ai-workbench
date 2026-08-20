// Assistant (WP 1.2) — the per-message context envelope renderer (planning/Roadmap/RM-02-assistant/00-plan.md
// §3.2: "Every user message carries a context envelope (current route, entity kind + id, active
// tab) appended as structured context, so 'this run' resolves without the user pasting ids").
//
// PURE function, no DB/session access — WP 1.1's session manager calls this once per outgoing user
// message (appending its output to the message text before feeding it to the SDK's streaming-input
// `query()`), so it must not have side effects or depend on anything beyond its argument.
import type { AssistantContextEnvelope } from "@mcp-token-footprint/shared";

/**
 * Render a message's {@link AssistantContextEnvelope} into a structured, model-legible context block.
 * Fenced with an unambiguous tag pair so the agent can visually separate "where the owner currently is
 * in the app" from the owner's actual question. R1.1 (D-AS19): the trailer is now an INSTRUCTION, not a
 * hint — the pinned entity still resolves vague references like "this run", AND it defines the WRITE
 * SCOPE: writes are confined to the pinned entity; a write to any other entity (or any write when no
 * entity is pinned) is refused by the system. Reads stay unrestricted across the whole app. Returns an
 * empty string when the envelope carries no `route` (defensive: the frozen shared type requires
 * `route`, but a caller could still pass an empty one).
 */
export function renderContextEnvelope(envelope: AssistantContextEnvelope): string {
  if (!envelope.route) return "";

  const lines = ["<app-context>", `Current page: ${envelope.route}`];
  const pinned = Boolean(envelope.entityKind && envelope.entityId);
  if (pinned) {
    lines.push(`Pinned entity: ${envelope.entityKind} ${envelope.entityId}`);
  } else if (envelope.entityKind) {
    lines.push(`Pinned entity kind: ${envelope.entityKind}`);
  }
  if (envelope.tab) {
    lines.push(`Active tab: ${envelope.tab}`);
  }
  if (pinned) {
    lines.push(
      "This is the entity the owner currently has open. Use it to resolve vague references like " +
        '"this run" or "this skill" to a concrete id via a tool call. It also SETS YOUR WRITE SCOPE: ' +
        "you may read broadly across the app, but you may only create/update/delete THIS entity — a " +
        "write aimed at any other entity will be denied by the system.",
    );
  } else {
    lines.push(
      "No entity is pinned, so you are READ-ONLY on this page: you may read broadly across the app, " +
        "but every write is disabled until the owner opens a specific entity's page.",
    );
  }
  lines.push("</app-context>");
  return lines.join("\n");
}

/**
 * Append a rendered envelope to a user message's text, separated by a blank line. Returns `text`
 * unchanged when there is no envelope (an unpinned/global-dock message) or it renders empty.
 */
export function appendContextEnvelope(text: string, envelope?: AssistantContextEnvelope): string {
  if (!envelope) return text;
  const rendered = renderContextEnvelope(envelope);
  return rendered ? `${text}\n\n${rendered}` : text;
}
