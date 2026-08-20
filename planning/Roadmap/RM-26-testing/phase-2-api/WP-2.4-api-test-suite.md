---
type: "Work Package Spec"
title: "WP 2.4 \u2014 API test suite"
description: "Phase: 2 \u00b7 Size: M \u00b7 Depends on: 2.2, 2.3"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.4 — API test suite

**Phase:** 2 · **Size:** M · **Depends on:** 2.2, 2.3

## Objective
Lock the engine's behavior with tests so later changes don't silently break token math, guardrails,
the allow-list, redaction, or the run state machine.

## Why / references
`conventions.md` → Testing (node test runner via `tsx`, `apps/api/test/*.test.ts`; style in
`server-routes.test.ts`, `secret-store.test.ts`). Stub the model + MCP so tests are deterministic and
keyless.

## Files (new)
- `apps/api/test/run-state-machine.test.ts`
- `apps/api/test/guardrails.test.ts`
- `apps/api/test/allow-list.test.ts`
- `apps/api/test/provider-credentials-redaction.test.ts`
- `apps/api/test/token-context-accounting.test.ts`
- `apps/api/test/sse-stream.test.ts`

## Test design
- **Stub model:** a fake `LanguageModel` that emits a scripted sequence (text → tool-call → tool-result
  → finish with a known `usage`) so the loop, accounting, and SSE are deterministic without a real key.
- **Stub MCP:** a fake `McpSession` (in-memory tools) so `callTool` returns canned results incl. an
  `isError:true` case and a thrown-transport case.

## What each test asserts
- **state machine:** pending→running→completed; stop→aborted; overflow→context_overflow; error path.
- **guardrails:** each of maxTurns/maxToolCalls/maxTokens/maxContextTokens/maxCostUsd fires and names
  itself; default `stepCountIs(20)` applies when unset.
- **allow-list:** excluded tools are never offered; per-tool toggle + `null`(=all) resolve correctly.
- **redaction:** secret tool args never reach `run_steps.payload_json`; no provider key in any row or
  API response.
- **accounting:** estimator lens + provider-actual both present with delta; `tool_defs` slice grows
  when a tool is added (the thesis); cached/reasoning mapped.
- **SSE:** ordered events incl. a late-subscriber buffer replay; terminal event closes the stream;
  client disconnect tears down emitter + sessions.

## Acceptance
- `pnpm --filter @mcp-token-footprint/api test` green; full gate green.
- Tests run **without** network/keys (everything stubbed); any key-gated test self-skips.
