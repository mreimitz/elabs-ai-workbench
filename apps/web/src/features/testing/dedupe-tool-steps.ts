import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * De-dupe the DOUBLE `tool_call` rows the run transcript emits per logical tool call (Task C3 #2).
 *
 * Every logical MCP tool call produces TWO `tool_call` steps in the persisted/streamed transcript:
 *
 *  1. the **engine** step — id `${runId}:step:${i}`, emitted from `apps/api/src/testing/engine.ts`
 *     off the AI-SDK `tool-call` part. It carries the call ARGS (`payload: { toolCallId, args }`)
 *     but has no MCP-side timing/size.
 *  2. the **MCP-sink** step — id `${runId}:mcp:${i}`, emitted from `apps/api/src/testing/run-service.ts`
 *     after the `tools/call` settles. It carries the MCP-side `durationMs`, `serverId`, and the tool
 *     RESULT's token size (`profileTokens` under the primary lens — the value the session-compatibility
 *     tests read off the persisted step), but a thin payload (`{ isError }` / `{ transportError }`).
 *
 * Plus the `tool_result` step. So one logical call shows as three rows; the two `tool_call` rows are
 * the noise the owner sees ("not properly sorted / cluttered").
 *
 * This collapses the pair into ONE logical `tool_call` row by **merging the MCP-sink step's
 * `durationMs` / `serverId` / result-token-size onto the engine row** (the engine row keeps its
 * `toolCallId` + args payload, which the inspector/conversation need) and **dropping the standalone
 * `:mcp:` duplicate**. It is a WEB-DISPLAY transform only — persistence, the API, and the
 * compatibility tests (which read the PERSISTED `:mcp:` step) are untouched.
 *
 * Matching the MCP-sink step to its engine step:
 *  - **Primary — by `toolCallId`** when the MCP-sink payload carries one. (Wave 1 F5 adds `toolCallId`
 *    to the `:mcp:` step; once it lands this is an exact match.)
 *  - **Fallback — by order within the same tool name.** Today the `:mcp:` payload is just
 *    `{ isError }` (no `toolCallId`), so we pair the N-th MCP-sink `tool_call` of a given tool with
 *    the N-th engine `tool_call` of that tool — both fire once per logical call, in order, so the
 *    N-th of each is the same call. Robust whether or not F5 has landed.
 *
 * The returned list preserves the engine row's position (and thus its monotonic `step.index`), so the
 * existing `index`-sorted ordering in `StepLog` / `ConsolePanel` is unchanged — live === replay.
 */
export function dedupeToolSteps(steps: RunStep[]): RunStep[] {
  // A step is an MCP-sink step iff its id is `${runId}:mcp:${i}` (nanoid run ids never contain ":",
  // so the marker is unambiguous). Only `tool_call` MCP-sink steps are duplicates to collapse.
  const isMcpStep = (step: RunStep): boolean => step.id.includes(":mcp:");

  // Index the engine `tool_call` steps so each MCP-sink `tool_call` can find its partner. We key both
  // by `toolCallId` (exact, F5) AND queue them per-tool-name (the order-based fallback for today).
  const engineByCallId = new Map<string, RunStep>();
  const engineQueueByTool = new Map<string, RunStep[]>();
  for (const step of steps) {
    if (step.type !== "tool_call" || isMcpStep(step)) continue;
    const callId = toolCallId(step);
    if (callId !== undefined) engineByCallId.set(callId, step);
    const toolKey = step.toolName ?? step.label;
    const queue = engineQueueByTool.get(toolKey);
    if (queue) queue.push(step);
    else engineQueueByTool.set(toolKey, [step]);
  }

  // The MCP-sink merge for an engine step, keyed by the engine step's id (so the merge is applied
  // where the engine row sits in the list, preserving its index/position).
  const mergeByEngineId = new Map<string, RunStep>();
  // Per-tool consumption cursor for the order-based fallback (mirrors the build order above).
  const fallbackCursor = new Map<string, number>();

  for (const step of steps) {
    if (step.type !== "tool_call" || !isMcpStep(step)) continue;

    // Find the partner engine step: by `toolCallId` first, else the next unconsumed engine call of
    // the same tool (order-based fallback — both lists are in emission order).
    const callId = toolCallId(step);
    let engine = callId !== undefined ? engineByCallId.get(callId) : undefined;
    if (!engine) {
      const toolKey = step.toolName ?? step.label;
      const queue = engineQueueByTool.get(toolKey);
      if (queue) {
        const at = fallbackCursor.get(toolKey) ?? 0;
        engine = queue[at];
        fallbackCursor.set(toolKey, at + 1);
      }
    }
    // No engine partner (shouldn't happen) — keep the MCP-sink row rather than silently drop it.
    if (!engine) continue;

    mergeByEngineId.set(engine.id, mergeMcpOntoEngine(engine, step));
  }

  // Emit each row once: engine `tool_call` rows are replaced by their merged form; the standalone
  // `:mcp:` `tool_call` duplicates are dropped; everything else passes through unchanged. Order +
  // each surviving row's `index` are preserved, so the downstream `index` sort is unaffected.
  const out: RunStep[] = [];
  for (const step of steps) {
    if (step.type === "tool_call" && isMcpStep(step)) continue; // dropped (folded into the engine row)
    out.push(step.type === "tool_call" ? (mergeByEngineId.get(step.id) ?? step) : step);
  }
  return out;
}

/**
 * Merge the MCP-sink step's MCP-side fields onto the engine `tool_call` row: take the engine row
 * (its `toolCallId` + args payload, position, and `index`) and overlay `durationMs` / `serverId` /
 * the result-token-size lens + the failed status from the MCP-sink step. The merged row is the ONE
 * logical tool-call row shown in the log.
 */
function mergeMcpOntoEngine(engine: RunStep, mcp: RunStep): RunStep {
  return {
    ...engine,
    // MCP-side timing/size — only present on the sink step.
    ...(mcp.durationMs !== undefined ? { durationMs: mcp.durationMs } : {}),
    ...(mcp.serverId !== undefined ? { serverId: mcp.serverId } : {}),
    // The result-token-size lens (drives the cost-weight bar / token trailer) lives on the sink step;
    // merge it in WITHOUT dropping any lens the engine row already carries.
    profileTokens: { ...engine.profileTokens, ...mcp.profileTokens },
    // The MCP-sink step fires only AFTER the `tools/call` settles, so its status is the call's true
    // terminal state ("ok" / "error"). Adopt it so the merged row doesn't read as perpetually
    // "running" (the engine `tool_call` is emitted "running" and only its sibling `tool_result`
    // settles in the raw transcript).
    status: mcp.status,
  };
}

/** The `toolCallId` carried in a step's redacted payload (`{ toolCallId, … }`), or undefined. */
function toolCallId(step: RunStep): string | undefined {
  const payload = step.payload;
  if (payload && typeof payload === "object" && "toolCallId" in payload) {
    const id = (payload as { toolCallId: unknown }).toolCallId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}
