import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { jsonSchema, tool, type JSONSchema7, type Tool, type ToolExecutionOptions } from "ai";
import type { McpSession } from "../mcp/client.js";

/**
 * One allow-listed MCP tool tagged with the server it lives on. The run service flattens
 * `ScenarioService.resolveAllowedTools()` (which returns `{ serverId, tools }[]`) into this list so
 * the bridge knows which {@link McpSession} to route each `tools/call` to.
 */
export type AllowedTool = {
  serverId: string;
  def: NormalizedToolDefinition;
};

/**
 * Shape of an MCP `tools/call` result as the bridge interprets it. The MCP SDK resolves the call
 * even on a tool-level failure (`isError: true`); a transport/request failure throws (handled in
 * {@link buildTools}).
 */
export type McpToolResult = {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

/**
 * The outcome handed to the {@link StepSink}. Tool output is **untrusted** — it is passed through as
 * opaque data (never `eval`'d, never echoed as a secret). `transportError` is set only when the
 * `callTool` promise rejected (transport/request failure), in which case `result` is absent.
 */
export type ToolCallOutcome = {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  durationMs: number;
  /**
   * Track E — real wall-clock around `session.callTool`, captured with `Date.now()` (ISO-8601). The
   * run service stamps these onto the MCP-sink `tool_call` step so the run timeline / Gantt has a
   * per-tool-call start/end. `startedAt <= endedAt` by construction.
   */
  startedAt: string; // ISO-8601
  endedAt: string; // ISO-8601
  /** Present on a resolved call (including a tool-level `isError: true`). */
  result?: McpToolResult;
  /** True when the MCP call resolved with `isError: true`. */
  isError: boolean;
  /** Set only on a transport/request failure (the `callTool` promise rejected). */
  transportError?: string;
  /**
   * F5 — the AI SDK `toolCallId` for this call, captured from the tool `execute`'s second options
   * argument (`ToolCallOptions.toolCallId`, verified in the installed `ai` v6 / `@ai-sdk/provider-utils`
   * types). Lets the UI CORRELATE the MCP-sink step with the engine's stream `tool_call`/`tool_result`
   * steps (which already carry `toolCallId` in their payload) so each logical call de-dupes to one.
   * Undefined only if the SDK ever omits it.
   */
  toolCallId?: string;
};

/**
 * Observability (WP3.1, D-OB17) — the MCP request/response sizes + timing of ONE `tools/call`, i.e. the
 * payload a `tool_io` CHILD step carries UNDER its parent `tool_call` step (D-OB17's "MCP roundtrip
 * detail"). Derived purely from a settled {@link ToolCallOutcome} by {@link toolIoDetail}; ENGINE-PATH
 * only (the subscription child owns its MCP internally; `qlik_answers` has no tools — its capability
 * manifest already says so). This is the tool-bridge's contribution to the step tree; a sink pairs it
 * with the parent `tool_call` step's id via `RunStep.parentStepId` to persist the child.
 */
export type ToolIoDetail = {
  toolName: string;
  serverId: string;
  /** UTF-8 byte size of the request arguments (the model → tool payload). */
  requestBytes: number;
  /** UTF-8 byte size of the response payload (the tool → model result); undefined on a transport error. */
  responseBytes?: number;
  durationMs: number;
  startedAt: string; // ISO-8601
  endedAt: string; // ISO-8601
  isError: boolean;
};

/** UTF-8 byte size of a JSON-serializable value; undefined when it can't be serialized. */
function jsonByteLength(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Observability (WP3.1, D-OB17) — derive the {@link ToolIoDetail} of a settled MCP `tools/call` from
 * its {@link ToolCallOutcome} (request bytes from the args, response bytes from the result, plus the
 * bridge's wall-clock timing). PURE — no I/O, never throws. A sink turns this into a `tool_io` child
 * step under the call's `tool_call` parent (`spanKind: "tool_io"`, `parentStepId` = the parent step id).
 */
export function toolIoDetail(outcome: ToolCallOutcome): ToolIoDetail {
  return {
    toolName: outcome.toolName,
    serverId: outcome.serverId,
    requestBytes: jsonByteLength(outcome.args) ?? 0,
    responseBytes: outcome.result === undefined ? undefined : jsonByteLength(outcome.result),
    durationMs: outcome.durationMs,
    startedAt: outcome.startedAt,
    endedAt: outcome.endedAt,
    isError: outcome.isError,
  };
}

/**
 * The measurement seam. WP 1.3 ships a minimal default ({@link defaultStepSink}) that forwards
 * tool-call info as `step` RunEvents via the run manager. WP 1.4 replaces/wraps this with real
 * token accounting (request/response tokens per profile, provider-actual usage). Keep it small and
 * typed so the swap is mechanical.
 */
export type StepSink = {
  /**
   * Called once per MCP `tools/call`, after it settles (resolved or transport-failed). Implementors
   * must not throw; the engine relies on `execute` returning the raw tool result to the model.
   */
  toolCall(outcome: ToolCallOutcome): void | Promise<void>;
};

/**
 * Reports a fatal MCP transport failure (the `callTool` promise rejected). The AI SDK turns a thrown
 * `execute` into a non-fatal `tool-error` part and keeps looping; calling this lets the orchestrator
 * mark the whole run errored (per WP 1.3: a transport error FAILS the run, unlike a tool-level
 * `isError:true` which is just a failed step). Carries the first transport error message.
 */
export type OnTransportError = (
  message: string,
  ctx: { serverId: string; toolName: string },
) => void;

/**
 * Options shaping how the tools are built. `deferLoading` opts the whole allow-list into Anthropic
 * **deferred** tool loading: each tool is tagged `providerOptions.anthropic.deferLoading = true`, so
 * the provider strips its definition from the prompt prefix and the model discovers it on demand via
 * the tool-search tool (registered separately by the run service). A no-op for non-Anthropic models —
 * the run service only sets this when the provider/model actually supports tool search.
 */
export type BuildToolsOptions = {
  /** Mark every built tool for Anthropic deferred loading (the `deferred` tool-loading mode). */
  deferLoading?: boolean;
};

/**
 * Build ONE AI SDK tool for a single allow-listed MCP tool — the per-tool body {@link buildTools}
 * loops over. Additive extraction (Assistant Hub WP0.5, `hub/tools/mcp-bridge.ts`): IDENTICAL
 * behavior to the code previously inlined in `buildTools`'s loop, factored out so a caller that needs
 * to key the built tool under a DIFFERENT exposed name (e.g. the Hub's cross-server collision
 * namespacing, `mcp__<server>__<tool>`) can do so without re-deriving the MCP `execute()` wiring.
 * The returned tool's `execute()` always calls `session.callTool(def.name, …)` and reports to the
 * {@link StepSink} under `def.name` — i.e. it is keyed for ROUTING/telemetry by the tool's TRUE name
 * regardless of what map key a caller stores it under. `buildTools` itself is unchanged behavior
 * (same "last-writer-wins on a duplicate name" semantics as before this extraction) — verified by the
 * existing testing test suite staying green.
 */
export function buildMcpTool(
  serverId: string,
  def: NormalizedToolDefinition,
  sessions: Map<string, McpSession>,
  sink: StepSink,
  onTransportError?: OnTransportError,
  options?: BuildToolsOptions,
): Tool {
  // Per-tool provider options carrying the Anthropic deferred-loading flag, attached only in
  // `deferred` mode (omitted entirely in eager mode so the request is byte-for-byte unchanged).
  const deferredProviderOptions = options?.deferLoading
    ? { anthropic: { deferLoading: true } }
    : undefined;

  return tool({
    description: def.description,
    inputSchema: jsonSchema((def.inputSchema as JSONSchema7 | undefined) ?? { type: "object" }),
    ...(deferredProviderOptions ? { providerOptions: deferredProviderOptions } : {}),
    execute: async (
      args: unknown,
      options: ToolExecutionOptions<unknown>,
    ): Promise<McpToolResult> => {
      const session = sessions.get(serverId);
      if (!session) {
        // An allow-listed server without an open session is an orchestration bug, not a tool
        // failure — surface it loudly so the run fails with a clear message.
        throw new Error(`No open MCP session for server "${serverId}" (tool "${def.name}")`);
      }

      // F5 — the AI SDK passes `toolCallId` on the execute options (`ToolCallOptions.toolCallId`).
      // Thread it through to the StepSink so the MCP-side step can correlate with the engine's
      // stream tool_call/tool_result steps.
      const toolCallId = options?.toolCallId;
      const callArgs = (args ?? {}) as Record<string, unknown>;
      const started = performance.now();
      // Track E — real wall-clock around the MCP call (ISO). `performance.now()` stays the
      // monotonic source for `durationMs`; `Date.now()` gives the absolute start/end the timeline needs.
      const startedAt = new Date().toISOString();
      try {
        const result = (await session.callTool(def.name, callArgs)) as McpToolResult;
        const durationMs = performance.now() - started;
        const endedAt = new Date().toISOString();
        await sink.toolCall({
          serverId,
          toolName: def.name,
          args: callArgs,
          durationMs,
          startedAt,
          endedAt,
          result,
          isError: result?.isError === true,
          toolCallId,
        });
        // Hand the raw result back to the model. A tool-level `isError: true` is data the model
        // can react to (per MCP semantics) — it does NOT fail the run.
        return result;
      } catch (error) {
        const durationMs = performance.now() - started;
        const endedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        await sink.toolCall({
          serverId,
          toolName: def.name,
          args: callArgs,
          durationMs,
          startedAt,
          endedAt,
          isError: true,
          transportError: message,
          toolCallId,
        });
        // A transport/request failure must FAIL the run. The AI SDK turns a thrown `execute` into a
        // non-fatal `tool-error` part and keeps looping, so signal the orchestrator to fail the run
        // explicitly, then rethrow so the SDK still records the failed tool step.
        onTransportError?.(message, { serverId, toolName: def.name });
        throw error instanceof Error ? error : new Error(message);
      }
    },
  });
}

/**
 * Build one AI SDK tool per **allow-listed** MCP tool. Tools excluded by the scenario allow-list are
 * simply never built, so the model never sees them and cannot call them — the allow-list is enforced
 * **by construction**, not by a runtime guard.
 *
 * The MCP `inputSchema` is passed straight through with `jsonSchema()` (no zod re-derivation). Each
 * `execute` routes to the right {@link McpSession.callTool}, reports to the {@link StepSink}, and
 * hands the raw (untrusted) tool result back to the model. A transport failure (a rejected
 * `callTool`) is reported via `onTransportError` so the run can be failed, then rethrown.
 *
 * When {@link BuildToolsOptions.deferLoading} is set, each tool carries
 * `providerOptions.anthropic.deferLoading = true` so its definition is withheld from the prefix
 * (Anthropic tool search) — the run service pairs this with the tool-search tool in the tool set.
 */
export function buildTools(
  allowed: AllowedTool[],
  sessions: Map<string, McpSession>,
  sink: StepSink,
  onTransportError?: OnTransportError,
  options?: BuildToolsOptions,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};

  for (const { serverId, def } of allowed) {
    // Last-writer-wins on a duplicate tool name across servers; the resolved allow-list is already
    // server-scoped, so duplicates are rare. The bridge keeps the routing for whichever it built.
    tools[def.name] = buildMcpTool(serverId, def, sessions, sink, onTransportError, options);
  }

  return tools;
}
