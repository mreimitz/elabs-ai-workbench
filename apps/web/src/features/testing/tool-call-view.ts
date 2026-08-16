/**
 * Pure view helpers for the chat's tool rows (`ToolCallCard`): the collapsed-row args one-liner and
 * the MCP result-envelope unwrapping. Kept import-light (no components) so they unit-test in a plain
 * node environment.
 */

/** Collapsed-row args summary cap — keep the one-liner a glance, not a payload. */
const ARGS_SUMMARY_MAX_CHARS = 96;

/**
 * A human one-line summary of the call's arguments for the collapsed row (the way Claude shows
 * `query: "Demo Banking"` beside the tool name). Scalars render as `key: value`; nested
 * objects/arrays compress to `key: {…}` / `key: [n]`. Truncated with an ellipsis at
 * {@link ARGS_SUMMARY_MAX_CHARS}. Returns null when there is nothing meaningful to show.
 */
export function summarizeArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  if (typeof args !== "object") return truncate(String(args), ARGS_SUMMARY_MAX_CHARS);
  const entries = Array.isArray(args)
    ? args.map((v, i) => [String(i), v] as const)
    : Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return null;
  const parts = entries.map(([key, value]) => `${key}: ${previewValue(value)}`);
  return truncate(parts.join(" · "), ARGS_SUMMARY_MAX_CHARS);
}

/** Short scalar/compound preview for {@link summarizeArgs}. */
function previewValue(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return `"${truncate(value, 40)}"`;
    case "number":
    case "boolean":
      return String(value);
    case "object":
      return Array.isArray(value) ? `[${value.length}]` : "{…}";
    default:
      return "…";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type McpContentPart = { type?: unknown; text?: unknown };

/**
 * Unwrap an MCP `tools/call` result envelope for display. Preference order:
 *  1. `structuredContent` (the tool's typed payload) when present;
 *  2. the `content` text parts — a single part parses JSON-in-string into the real object,
 *     multiple parts return an array of parsed/plain parts;
 *  3. anything that isn't an envelope passes through untouched (already-shaped output).
 */
export function unwrapToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = value as { content?: unknown; structuredContent?: unknown };
  if (v.structuredContent !== undefined && v.structuredContent !== null) return v.structuredContent;
  if (!Array.isArray(v.content)) return value;
  const texts = (v.content as McpContentPart[])
    .filter(
      (part) =>
        part && typeof part === "object" && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => parseMaybeJson(part.text as string));
  if (texts.length === 0) return value; // non-text content (images, resources) → show the envelope
  return texts.length === 1 ? texts[0] : texts;
}

/** Best-effort error text out of an MCP error envelope (`isError: true` + text content). */
export function mcpErrorText(value: unknown): string {
  const unwrapped = unwrapToolResult(value);
  if (typeof unwrapped === "string") return unwrapped;
  try {
    return JSON.stringify(unwrapped, null, 2);
  } catch {
    return "Tool failed.";
  }
}

/** Parse a JSON-looking string into its object (pretty-printed downstream); pass prose through. */
function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}
