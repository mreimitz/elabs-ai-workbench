---
type: "Work Package Spec"
title: "WP 3.2 \u2014 synthesis through the turn engine with GenUI"
description: "Phase: 3 \u00b7 Size: M \u00b7 Depends on: 2.1 \u00b7 Model: Opus \u00b7 Agent profile: API engine"
tags: ["roadmap", "RM-13"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.2 — synthesis through the turn engine with GenUI

**Phase:** 3 · **Size:** M · **Depends on:** 2.1 · **Model:** Opus · **Agent profile:** API engine

## Objective

The mission's final answer becomes a real turn of the parent session with the GenUI `present`
tools available, so the synthesis can compose Table/StatGroup/Chart widgets plus prose (D-HF4).
`generateText` remains the fallback.

## Why / evidence

`analysis.md` RC4 second half: `synthesizeMission` calls `createTextSynthesizer` → bare
`generateText({model, system, prompt})` with no tools (`synthesis.ts:306-319`), bypassing
session-service, so `present`/`prompt_user` are never in scope and the answer is markdown-only by
construction. The owner's requirement: "the answer should use all the ai components we have".

## Design

- New synthesizer path: execute the synthesis as a parent-session turn via `HubSessionService`
  with (a) the existing synthesis system layers + agent-report source list, (b) GenUI tools granted
  (top-level session ⇒ already eligible per `session-service.ts` kind gate), (c) MCP tools NOT
  granted for this turn (synthesis reasons over reports; it does not re-query), (d) the citation
  contract unchanged (merged citations + `[n]` markers).
- The synthesis turn emits the normal `assistant_message` (+ any genui tool parts) and the
  `mission_synthesis` marker event exactly as today (same messageId linkage; replay-compatible).
- Failure or `HUB_SYNTHESIS_MODE=text` env ⇒ current `generateText` path (kept intact).
- Prompt nudge: "prefer a compact GenUI table/stat presentation for rankings and comparisons;
  prose for reasoning" (the GenUI catalog layer already teaches the components).

## Files (exclusive)

- `apps/api/src/hub/missions/synthesis.ts`, `missions/orchestrator.ts` (call site), `apps/api/src/hub/session-service.ts` (synthesis-turn entry seam; later batch than WP 2.1)
- `apps/api/src/config/env.ts`, `.env.example` (`HUB_SYNTHESIS_MODE`)
- `e2e/fixtures/hub-stub-llm-server.ts` (a synthesis fixture that emits a `present` call), `e2e/smoke.spec.ts`
- Tests: synthesis-as-turn integration (stub), fallback path, replay compatibility of the event sequence

## Acceptance

- [ ] Stubbed mission ends with an assistant message whose parts include a rendered-eligible genui part; board + transcript render it (existing GenUiPart path).
- [ ] Citations still merge/re-number and weave as chips (with WP 3.1 in place).
- [ ] Event sequence stays replay-compatible for pre-fix logs (fixture test).
- [ ] Fallback mode byte-compatible with today's synthesis (snapshot).
- [ ] Gate + e2e green.
