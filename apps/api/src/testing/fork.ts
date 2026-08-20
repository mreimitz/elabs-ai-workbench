// Observability — fork-from-step prefix reconstruction (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18).
//
// The PURE, DETERMINISTIC heart of "Open in Playground": given a persisted run's ordered `run_steps`
// and a fork point (`fromStepId`), rebuild the conversation PREFIX (a `ModelMessage[]`) up to and
// INCLUDING that step, so a NEW derived run can be seeded with it + an overridden final user turn.
//
// It is the SAME replay-derivation discipline the report/legacy (`traceFromRun`, `deriveLegacyAnswerStep`)
// projections use: read the persisted step payloads VERBATIM and map them into the target vocabulary —
// here the AI-SDK `ModelMessage` union — never re-summarizing, never inventing data. NO DB access, NO
// side effects, NO run mutation: it takes plain `RunStep[]` in and returns messages out, so it is
// unit-testable against a byte-identity fixture (WP3.3 acceptance #1). The mapping mirrors the engine's
// own step emission (`engine.ts`): a `tool_call` step carries `{ toolCallId, args }`, a `tool_result`
// step carries `{ toolCallId, result }` (or `{ toolCallId, error }`), and the run's assistant prose
// lands on the `llm_response` step's `assistantText` — so the reconstruction is a faithful inverse.
//
// Validity invariant: the produced sequence is ALWAYS a well-formed provider transcript. Every
// reconstructed `tool-call` part is IMMEDIATELY followed by its matching `tool-result` (paired by
// `toolCallId`); a tool call with no persisted result within the prefix (a fork that cut mid-call) is
// DROPPED rather than left dangling, so a real provider never rejects the seeded messages. The engine's
// duplicate MCP-side `tool_call` step (`${runId}:mcp:N`, which carries only `{ isError, toolCallId }`,
// no args) is de-duplicated by `toolCallId` so a call is reconstructed exactly once.

import type { ModelMessage } from "ai";
import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * Thrown when `fromStepId` does not name a step of the run being forked. Carries `statusCode`/`code` so
 * the central Fastify error handler renders it as a 422 without `fork.ts` importing an API util (keeping
 * this module pure + framework-free). The rerun route validates the id belongs to a REPLAYABLE turn
 * before this, so in practice this only fires on a stale/garbage id.
 */
export class ForkStepNotFoundError extends Error {
  readonly statusCode = 422;
  readonly code = "FORK_STEP_NOT_FOUND";
  constructor(stepId: string) {
    super(`Fork step "${stepId}" is not a step of this run`);
    this.name = "ForkStepNotFoundError";
  }
}

/** The reconstructed fork prefix + the located fork step's persisted ordinal (for lineage/telemetry). */
export type ForkReconstruction = {
  /** The conversation prefix — every message up to and including the fork step, provider-ready. */
  messages: ModelMessage[];
  /** The `run_steps.idx` of the located fork step (monotonic emission order). */
  forkStepIndex: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** A tool call awaiting its result (so the pair can be emitted as one valid call → result sequence). */
type PendingToolCall = { toolCallId: string; toolName: string; input: unknown };

/**
 * Map a persisted `tool_result` step's payload to an AI-SDK `ToolResultPart.output`. The engine stores
 * the opaque MCP output under `result` for an ordinary result (`{ isError }` and all), or an `error`
 * message string for a thrown tool-error step. It is serialized to a TEXT output — deterministic + always
 * a valid `ToolResultOutput` (the opaque MCP value is `unknown`, not a typed `JSONValue`), and redaction
 * already happened at persist time, so this never re-exposes a secret. A non-serializable value degrades
 * to `""` (never throws — the reconstruction must stay pure).
 */
function toToolOutput(payload: Record<string, unknown>): { type: "text"; value: string } {
  const source = "result" in payload ? payload.result : "error" in payload ? { error: payload.error } : null;
  let value: string;
  try {
    value = JSON.stringify(source) ?? "";
  } catch {
    value = "";
  }
  return { type: "text", value };
}

/**
 * Reconstruct the conversation prefix for a fork at `fromStepId`. `steps` is a run's persisted
 * `run_steps` (any order; sorted by `index` here). Throws {@link ForkStepNotFoundError} when the id
 * isn't present. PURE — no DB, no I/O, no mutation of `steps`.
 *
 * Mapping (`run_steps.type` → messages):
 *  - `user_message`   → `{ role:"user", content:<payload.text> }`
 *  - `llm_response`   → `{ role:"assistant", content:<assistantText> }` (only when non-empty — an
 *                       empty/tool-only turn contributes no standalone assistant message)
 *  - `tool_call`      → collected as a pending call (`{ toolCallId, toolName, input:args }`),
 *                       de-duplicated by `toolCallId` (the engine's MCP-side duplicate is dropped)
 *  - `tool_result`    → flushes the pending call as an `assistant[tool-call]` + `tool[tool-result]` pair
 *  - everything else  → skipped (`context_event`, `llm_request`, `tool_io` children, …)
 *
 * A pending call with no result inside the prefix (a fork cutting mid-call) is dropped so the sequence
 * stays valid.
 */
export function reconstructForkPrefix(steps: RunStep[], fromStepId: string): ForkReconstruction {
  const ordered = [...steps].sort((a, b) => a.index - b.index);
  const cutAt = ordered.findIndex((step) => step.id === fromStepId);
  if (cutAt === -1) throw new ForkStepNotFoundError(fromStepId);
  const forkStep = ordered[cutAt];
  if (forkStep === undefined) throw new ForkStepNotFoundError(fromStepId); // unreachable (index found)
  const prefix = ordered.slice(0, cutAt + 1);

  const messages: ModelMessage[] = [];
  const seenToolCallIds = new Set<string>();
  let pending: PendingToolCall | undefined;

  for (const step of prefix) {
    const payload = asRecord(step.payload);
    switch (step.type) {
      case "user_message": {
        pending = undefined; // a new user turn abandons any dangling mid-call (keeps the sequence valid)
        messages.push({ role: "user", content: stringField(payload, "text") ?? "" });
        break;
      }
      case "llm_response": {
        pending = undefined;
        if (typeof step.assistantText === "string" && step.assistantText.length > 0) {
          messages.push({ role: "assistant", content: step.assistantText });
        }
        break;
      }
      case "tool_call": {
        const toolCallId = stringField(payload, "toolCallId") ?? `fork:tc:${step.index}`;
        if (seenToolCallIds.has(toolCallId)) break; // engine's MCP-side duplicate — already reconstructed
        seenToolCallIds.add(toolCallId);
        pending = {
          toolCallId,
          toolName: step.toolName ?? step.label ?? "tool",
          input: "args" in payload ? payload.args : {},
        };
        break;
      }
      case "tool_result": {
        if (!pending) break; // a result with no matching call in the prefix — nothing to pair
        const resultCallId = stringField(payload, "toolCallId");
        if (resultCallId !== undefined && resultCallId !== pending.toolCallId) break; // mismatched pair
        messages.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              input: pending.input,
            },
          ],
        });
        messages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              output: toToolOutput(payload),
            },
          ],
        });
        pending = undefined;
        break;
      }
      default:
        break; // context_event / llm_request / tool_io child — not part of the transcript
    }
  }

  return { messages, forkStepIndex: forkStep.index };
}
