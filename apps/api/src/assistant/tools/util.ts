// Assistant (WP 1.2) — small shared helpers for the in-process MCP read toolset. Kept dependency-free
// (no DB) so they're trivially unit-testable and reusable by every tool in `./index.ts`.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RunStep } from "@mcp-token-footprint/shared";
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

// ── Run-step compaction ─────────────────────────────────────────────────────────────────────────
// Shared by the Assistant read toolset (`./index.ts`) and the workbench MCP server's `runs_get`
// (`apps/api/src/mcp-server/tools.ts`). It lives HERE rather than in `./index.ts` because that module
// statically imports `@anthropic-ai/claude-agent-sdk`, which the MCP mount must never pull in — and
// D-MCP4 forbids the MCP layer keeping a second copy of a derivation the app already has.

/** Longest assistant/reasoning prose kept per step before an explicit truncation marker. */
export const MAX_STEP_TEXT_CHARS = 1_500;
/** Longest serialized `payload` preview kept per step. */
export const MAX_PAYLOAD_PREVIEW_CHARS = 500;

/** `JSON.stringify` that never throws on a cyclic/exotic payload. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable]";
  }
}

/**
 * A run step, compacted for an agent: drops the raw `payload` in favor of a bounded preview and
 * flattens `context` to its two scalar fields — everything a trace-reading agent needs, nothing that
 * would blow up a run with hundreds of steps.
 */
export function compactStep(step: RunStep): Record<string, unknown> {
  const out: Record<string, unknown> = {
    index: step.index,
    type: step.type,
    label: step.label,
    status: step.status,
    profileTokens: step.profileTokens,
  };
  if (step.durationMs !== undefined) out.durationMs = step.durationMs;
  if (step.serverId !== undefined) out.serverId = step.serverId;
  if (step.toolName !== undefined) out.toolName = step.toolName;
  if (step.turnIndex !== undefined) out.turnIndex = step.turnIndex;
  if (step.usageActual !== undefined) out.usageActual = step.usageActual;
  if (step.context !== undefined) {
    out.contextTotal = step.context.total;
    out.contextLimit = step.context.limit;
  }
  if (step.cumulativeTokens !== undefined) out.cumulativeTokens = step.cumulativeTokens;
  if (step.assistantText !== undefined)
    out.assistantText = boundText(step.assistantText, MAX_STEP_TEXT_CHARS);
  if (step.reasoningText !== undefined)
    out.reasoningText = boundText(step.reasoningText, MAX_STEP_TEXT_CHARS);
  if (step.payload !== undefined && step.payload !== null) {
    out.payloadPreview = boundText(safeStringify(step.payload), MAX_PAYLOAD_PREVIEW_CHARS);
  }
  return out;
}
