---
type: "Work Package Spec"
title: "WP 1.3 \u2014 Agent loop + MCP tool bridge (Anthropic first)"
description: "Phase: 1 \u00b7 Size: L \u00b7 Depends on: 1.1, 1.2, 0.3"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.3 — Agent loop + MCP tool bridge (Anthropic first)

**Phase:** 1 · **Size:** L · **Depends on:** 1.1, 1.2, 0.3

## Objective
The core loop: model ↔ tool calls ↔ MCP ↔ results, streaming, with the scenario's **allow-list
enforced by construction** (the model can only see selected tools). Anthropic only in this WP;
breadth in WP 2.3.

## Why / references
Scope decisions #1 (both run modes), #6 (allow-list). [`../references.md`](../references.md) → *AI SDK
— Tool Calling* and *Loop Control* (`streamText`, `tools`, `stopWhen`, `stepCountIs`, `onStepFinish`),
*MCP TypeScript SDK* (callTool error model). UI legibility goals: [`../10-…ui-concept.md`](../../../Research/RS-11-testing-ui-concept/notes/testing-ui-concept.md) §3.

## Files (new)
- `apps/api/src/testing/tool-bridge.ts`  — MCP defs → AI SDK tools
- `apps/api/src/testing/engine.ts`       — the `streamText` loop
- `apps/api/src/testing/run-service.ts`  — orchestration (resolve scenario+test, sessions, lifecycle)
- `apps/api/src/testing/run-manager.ts`  — in-memory active runs + per-run `EventEmitter`

## Design — tool bridge
Build one AI SDK tool per **allowed** MCP tool. Pass the MCP `inputSchema` straight through with
`jsonSchema()` (no zod re-derivation). `execute` routes to the persistent session and is the
measurement seam (WP 1.4 wraps it).
```ts
import { jsonSchema, tool } from "ai";
export function buildTools(allowed: NormalizedToolDefinition[], sessions: Map<string, McpSession>, sink: StepSink) {
  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (const def of allowed) {
    tools[def.name] = tool({
      description: def.description,
      parameters: jsonSchema(def.inputSchema ?? { type: "object" }),
      execute: async (args) => {
        const started = performance.now();
        const session = sessions.get(serverIdFor(def));         // resolved from scenario allow-list
        const result = await session.callTool(def.name, args);  // resolves even if isError
        await sink.toolCall(def, args, result, performance.now() - started); // WP 1.4 measures + emits
        return result;
      },
    });
  }
  return tools; // tools EXCLUDED by the allow-list are simply never built → model cannot call them
}
```

## Design — engine loop
```ts
import { streamText, stepCountIs } from "ai";
const result = streamText({
  model: modelFor(cred, scenario.model),     // WP 1.1
  system: test.systemPromptOverride ?? scenario.systemPrompt,   // decision #13
  messages,                                  // opener = test.userPrompt (+ attachments, WP 2.1)
  tools,
  stopWhen: stepCountIs(scenario.guardrails.maxTurns ?? 20),    // WP 1.5 adds budget stops
  onStepFinish: (step) => accounting.onStep(step),              // WP 1.4 / 1.5
  ...providerOptions(cred, scenario),        // escape hatch (e.g. Anthropic cache_control / thinking) WP 2.3
});
for await (const part of result.fullStream) {
  // text-delta / reasoning → RunEvent {delta}; tool-call/tool-result → steps; finish → usage
  runManager.emit(runId, toRunEvent(part));
}
```
- **Modes:** automated = run to completion; interactive = after the stream settles, wait for the next
  user turn (WP 2.2 posts it) and continue with appended messages. Same engine, different driver.
- Tool output is untrusted: never `eval`, never echo secrets, hand straight back to the model + sink.

## run-manager
A `Map<runId, EventEmitter>` plus run state. `emit(runId, RunEvent)` fans out to (a) the SSE subscriber
(WP 2.2) and (b) the persistence sink (WP 1.6). On terminal state, flush + cleanup.

## Implementation steps
1. Resolve the effective config: scenario (provider, model, system, guardrails, allow-list, default
   profiles) ∪ test (prompt, override, added profiles).
2. Open one `McpSession` per allowed server (WP 1.2); build tools (allow-list filtered).
3. Run the loop; emit `RunEvent`s via `run-manager`.
4. Always close sessions in `finally`; set terminal status.

## Acceptance
- A test with a stub MCP server (≥2 tools) drives ≥2 tool calls then a final answer; the loop ends on
  natural stop.
- **Allow-list:** a tool excluded by the scenario is absent from the offered `tools` set — assert it
  is never callable.
- A tool that returns `isError:true` is surfaced as a failed step (not a thrown run); a transport
  error fails the run with a clear message.
- Gate green.
