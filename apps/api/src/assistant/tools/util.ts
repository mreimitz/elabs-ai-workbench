// Assistant (WP 1.2) — small shared helpers for the in-process MCP read toolset. Kept dependency-free
// (no DB) so they're trivially unit-testable and reusable by every tool in `./index.ts`.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toErrorMessage } from "../../utils/errors.js";

/** A single compact JSON `CallToolResult` — every read tool's success shape. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** An `isError: true` `CallToolResult` carrying a short, model-legible message (never a stack trace). */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

/**
 * Run a tool body, converting a thrown repository error (typically an `httpError(404, …)` — "run not
 * found", "skill not found", …) into a clean `isError` result instead of an uncaught exception. Every
 * tool handler in `./index.ts` is wrapped in this so a bad id degrades to a readable message the agent
 * can react to (e.g. "try `runs_list` instead"), never a raw stack trace.
 */
export async function safeTool(
  body: () => Promise<CallToolResult> | CallToolResult,
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return errorResult(toErrorMessage(error));
  }
}

/** The result of {@link truncate} — a possibly-shortened array plus enough metadata to know it was cut. */
export type Truncated<T> = {
  items: T[];
  total: number;
  truncated: boolean;
};

/**
 * Cap `items` to at most `limit` entries, reporting the ORIGINAL length so a truncated tool result is
 * always self-describing (`.claude/rules/interaction-guidelines.md`-style "explicit truncated marker",
 * applied to tool payloads rather than UI lists). `limit <= 0` returns everything uncut (defensive —
 * every call site below passes a positive default).
 */
export function truncate<T>(items: readonly T[], limit: number): Truncated<T> {
  if (limit <= 0 || items.length <= limit) {
    return { items: [...items], total: items.length, truncated: false };
  }
  return { items: items.slice(0, limit), total: items.length, truncated: true };
}

/** Bound a string to `max` chars, appending an explicit `…+N chars truncated` marker when cut. */
export function boundText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…+${value.length - max} chars truncated`;
}

/**
 * Cap several array-valued fields of an object to `limit` entries each, returning a NEW object with
 * every capped field replaced and a sibling `${key}Truncated` boolean (+ `${key}Total` count) added.
 * Non-array / absent fields pass through untouched. Used by tools whose result embeds more than one
 * potentially-large list (e.g. `compare_run`'s matched/onlyInA/onlyInB × tool/resource/prompt).
 */
export function truncateFields<T extends object>(
  obj: T,
  keys: readonly (keyof T & string)[],
  limit: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      const capped = truncate(value, limit);
      out[key] = capped.items;
      out[`${key}Truncated`] = capped.truncated;
      out[`${key}Total`] = capped.total;
    }
  }
  return out;
}
