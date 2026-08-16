// Assistant (Refinement R2.2, D-AS26) — thread auto-titling helpers.
//
// PURE + SDK-free by design: this module holds (1) the deterministic message-derived title slug — the
// instant, free title set on a thread's first user message and the GUARANTEED FLOOR the LLM-refine
// silently falls back to — and (2) the small prompt strings the best-effort one-shot LLM refine uses.
// It touches no DB, no SDK, no network, so it is trivially unit-testable and the session manager can
// call `deterministicTitle` synchronously on the send path without any I/O.
import { ASSISTANT_TITLE_MAX_LENGTH } from "@mcp-token-footprint/shared";

/** A real single-character ellipsis (U+2026) — one code unit, so truncation math stays exact. */
const ELLIPSIS = "…";

/**
 * Derive a deterministic, human-readable title from a user's first message. Trims, collapses ALL
 * internal whitespace (including newlines/tabs) to single spaces, prefers a sentence-ish prefix when
 * the message opens with a short sentence, and caps the result at `maxLength` characters — appending a
 * real `…` (never overshooting the cap) when it has to truncate, cutting on a word boundary where one
 * is reasonably close. Returns `""` for empty/whitespace-only input, so the caller can no-op cleanly
 * (never overwriting a title with an empty string).
 */
export function deterministicTitle(
  text: string,
  maxLength: number = ASSISTANT_TITLE_MAX_LENGTH,
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";

  // Prefer the first sentence when the message opens with one that fits — a natural, tidy title.
  const sentence = collapsed.match(/^(.+?[.!?])(?:\s|$)/);
  const candidate = sentence?.[1] && sentence[1].length <= maxLength ? sentence[1] : collapsed;
  if (candidate.length <= maxLength) return candidate;

  // Too long: reserve one char for the ellipsis, then cut back to a word boundary if one is within
  // the back half (avoids chopping mid-word when a space is close; keeps a single long token whole up
  // to the cap otherwise). Strip any trailing whitespace/punctuation before the ellipsis.
  const clipped = candidate.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(maxLength / 2) ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}${ELLIPSIS}`;
}

/**
 * The tiny system prompt for the title one-shot (D-AS26). Deliberately terse: the one-shot has no
 * tools and one job — emit a crisp title and nothing else. (Not UI copy; still avoids the
 * self-naming the app forbids elsewhere.)
 */
export const ASSISTANT_TITLE_SYSTEM_PROMPT =
  "You write a very short title for a chat conversation. Reply with ONLY the title: at most 6 words, " +
  "plain text, no surrounding quotes and no trailing punctuation.";

/**
 * Build the single user message handed to the title one-shot: the first user message + the assistant's
 * first reply, each whitespace-collapsed and length-bounded so the refine stays cheap regardless of how
 * long the real turn was.
 */
export function buildTitlePrompt(userMessage: string, assistantReply: string): string {
  const clip = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 500);
  return [
    "Write a short title (max 6 words) for this conversation.",
    "",
    `User: ${clip(userMessage)}`,
    "",
    `Assistant: ${clip(assistantReply)}`,
    "",
    "Title:",
  ].join("\n");
}
