import type { RunStep, TraceEvent } from "@mcp-token-footprint/shared";
import { READ_SKILL_FILE_TOOL } from "../testing/skill-context.js";
import type { RunRepository } from "../testing/run-repository.js";
import { extractMarkers } from "./markers.js";

/**
 * WP 2.1 — the run→trace normalizer (D6: internal runs are trace source #1). Reads a persisted run's
 * `run_steps` (ordered by `idx`) and maps them into the shared normalized trace-event vocabulary
 * ({@link TraceEvent}) that the aligner (a later WP) consumes. It is strictly READ-ONLY over run data
 * — it never mutates a run, never registers a tool, and never executes anything (the never-execute
 * invariant, D4, is untouched).
 *
 * The `run_steps.idx` is preserved as the event `idx` (the aligner cites these in verdict evidence),
 * so skipped step types leave GAPS in the idx sequence by design — event order still follows the
 * stored step order.
 *
 * ## Mapping (`run_steps.type` → `TraceEvent.type`)
 *
 * | run step | trace event | notes |
 * | --- | --- | --- |
 * | `llm_response` | `turn` | `role:"assistant"` + `text` from the redacted `assistant_text` column. |
 * | `user_message` | `user_message` | `text` from the step payload. |
 * | `tool_call` (`read_skill_file`) | `skill_file_read` | `{ skill, path }` parsed from the step's `args`. |
 * | `tool_call` (other) | `tool_call` | `{ tool }` only — `args` intentionally omitted. |
 * | `tool_result` | `tool_result` | `{ tool, status, bytes }`; NO exit code (not reliably present — see below). |
 * | `context_event` | — | skipped (an internal accounting/notice checkpoint, not a trace event). |
 * | `llm_request` | — | skipped (the request side of a turn; the response is the `turn`). |
 *
 * ## Breadcrumb markers (WP 3.2)
 * After the idx-preserving pass above, a SECOND pass scans every `llm_response` step's
 * `assistant_text` for breadcrumb markers ({@link extractMarkers}, `markers.ts` — the ONE matcher
 * both normalizers share) and appends one `marker` `TraceEvent` per match.
 *
 * **idx assignment.** A marker cannot reuse its owning step's `run_steps.idx` — that idx already
 * names the `turn` event, and idxs must stay unique within the returned array (the aligner cites them
 * 1:1 as verdict evidence). Remapping every event to a fresh sequential idx was ruled out: it would
 * break the documented idx-GAP behavior from WP 2.1 (skipped `llm_request`/`context_event` steps leave
 * gaps on purpose) and the tests that assert on it. Instead, marker events get idxs that continue
 * AFTER the highest idx already produced by the main pass, assigned in encounter order (the order
 * their owning `llm_response` steps appear). This is safe because both the aligner and the evidence
 * pane only ever look up an event by membership/`idx` within the SAME returned array — nothing
 * depends on markers being positioned chronologically relative to other idxs, only on citing an idx
 * that genuinely exists in the array (see `assertValidAlignment` in the test suite).
 *
 * ## Deliberately NOT done here
 * - **Exit codes / `script_result`.** A `tool_result` step persists the tool's opaque MCP output under
 *   `payload.result` (or `{ error }` for a tool-error); there is no reliable, structured exit-code field
 *   across MCP tools, so exit codes are NOT invented — `tool_result` steps stay `tool_result` events.
 *   (WP 2.2 owns exit-code evidence if/when a structured source exists.)
 */
export type RunTraceDeps = {
  /** Read-only run access — only {@link RunRepository.getRun} is used. */
  runs: Pick<RunRepository, "getRun">;
};

/** Normalize a persisted run's steps into the shared trace-event stream. 404s if the run is unknown. */
export function traceFromRun(deps: RunTraceDeps, runId: string): TraceEvent[] {
  const { steps } = deps.runs.getRun(runId); // ordered by `run_steps.idx`; throws 404 if run is missing
  const events: TraceEvent[] = [];
  for (const step of steps) {
    const event = mapStep(step);
    if (event) events.push(event);
  }
  appendMarkerEvents(events, steps);
  return events;
}

/**
 * WP 3.2 — second pass: scan every `llm_response` step's assistant text for breadcrumb markers and
 * append one `marker` event per match, in encounter order, with idxs continuing after the highest
 * idx the main pass already produced (see the module doc's "idx assignment" note — this can never
 * collide with a real `run_steps.idx`, and evidence/membership is all that's ever checked).
 */
function appendMarkerEvents(events: TraceEvent[], steps: RunStep[]): void {
  let nextIdx = events.reduce((max, event) => Math.max(max, event.idx), -1) + 1;
  for (const step of steps) {
    if (step.type !== "llm_response" || !step.assistantText) continue;
    const at = step.startedAt ?? step.endedAt;
    const { markers } = extractMarkers(step.assistantText);
    for (const marker of markers) {
      events.push({
        type: "marker",
        idx: nextIdx,
        ...(at ? { at } : {}),
        payload: {
          raw: marker.raw,
          ...(marker.gateId ? { gateId: marker.gateId } : {}),
          ...(marker.routeId ? { routeId: marker.routeId } : {}),
        },
      });
      nextIdx += 1;
    }
  }
}

/** Map one persisted step to a trace event, or `null` for a skipped type (`context_event`, `llm_request`). */
function mapStep(step: RunStep): TraceEvent | null {
  const idx = step.index; // the persisted `run_steps.idx` (the mapper reconstructs it onto `.index`)
  const at = step.startedAt ?? step.endedAt;
  const payload = asRecord(step.payload);

  switch (step.type) {
    case "llm_response":
      // Breadcrumb markers embedded in `assistant_text` are NOT parsed here — `appendMarkerEvents`
      // (WP 3.2) runs a second pass over the same steps and emits additional `marker` events.
      return {
        type: "turn",
        idx,
        ...(at ? { at } : {}),
        payload: { role: "assistant", ...(step.assistantText ? { text: step.assistantText } : {}) },
      };

    case "user_message":
      return {
        type: "user_message",
        idx,
        ...(at ? { at } : {}),
        payload: { text: stringField(payload, "text") ?? "" },
      };

    case "tool_call": {
      const read = skillFileRead(step.toolName, payload);
      if (read) {
        return {
          type: "skill_file_read",
          idx,
          ...(at ? { at } : {}),
          payload: read,
        };
      }
      return {
        type: "tool_call",
        idx,
        ...(at ? { at } : {}),
        // Other tool calls: name only — `args` are intentionally omitted from the trace vocabulary here.
        payload: { tool: step.toolName || step.label || "tool" },
      };
    }

    case "tool_result":
      return {
        type: "tool_result",
        idx,
        ...(at ? { at } : {}),
        payload: {
          ...(step.toolName ? { tool: step.toolName } : {}),
          status: step.status,
          // Byte size of the tool result payload when the step carries one (drives no verdicts here).
          ...(typeof step.resultBytes === "number" ? { bytes: step.resultBytes } : {}),
        },
      };

    case "context_event":
    case "llm_request":
      // Skipped: neither is a trace event. `context_event` is an internal accounting/notice checkpoint;
      // `llm_request` is the request half of a turn (the `llm_response` carries the observable turn).
      return null;

    default:
      return null;
  }
}

/**
 * Parse the `{ skill, path }` of a `read_skill_file` tool call from the persisted step payload. The
 * real engine-side shape is `{ toolCallId, args: { skill, path } }` (the AI-SDK tool input under
 * `args`); a defensive fallback also reads a top-level `{ skill, path }`. Returns `null` (→ the caller
 * falls back to a plain `tool_call`) unless BOTH are non-empty strings, so the resulting
 * `skill_file_read` event always satisfies its schema (skill + path required). This also naturally
 * demotes the MCP-side duplicate `read_skill_file` step (which persists only `{ isError }`, no args)
 * to a plain `tool_call`.
 */
function skillFileRead(
  toolName: string | undefined,
  payload: Record<string, unknown>,
): { skill: string; path: string } | null {
  if (toolName !== READ_SKILL_FILE_TOOL) return null;
  // Real engine shape nests the tool input under `args`; fall back to a top-level `{ skill, path }`.
  const nested = payload.args;
  const args =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : payload;
  const skill = stringField(args, "skill");
  const path = stringField(args, "path");
  if (!skill || !path) return null;
  return { skill, path };
}

/** A record view of an unknown value (or `undefined` for non-objects), for safe field reads. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read a string field, or `undefined` when absent/non-string/empty. */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
