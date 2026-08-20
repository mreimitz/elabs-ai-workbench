---
type: "Work Package Spec"
title: "WP 6.1 \u2014 auto session mode + chat-vs-mission clarify card"
description: "Phase: 6 \u00b7 Size: L \u00b7 Depends on: 2.1, 3.1 \u00b7 Model: Opus \u00b7 Agent profile: API engine + web"
tags: ["roadmap", "RM-13"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 6.1 — `auto` session mode + chat-vs-mission clarify card

**Phase:** 6 · **Size:** L · **Depends on:** 2.1, 3.1 · **Model:** Opus · **Agent profile:** API engine + web

## Objective

A session no longer needs its mode picked forever at creation. New `auto` mode routes per message:
plain questions get chat answers; mission-shaped asks produce a mission proposal; when it is
ambiguous, the model asks first with a structured clarify card ("Quick answer, or a mission with
N agents ≈ $X?"). This implements the owner's expectation #2 and kills RC7.

## Why / evidence

`analysis.md` RC7: mode is create-time only (D-AH5; `ComposerCommands.tsx:60-64` documents modes
deliberately omitted from patching); `proposePlan` refuses non-mission sessions
(`orchestrator.ts:177`); `askUser` is coerced off (`capabilities.ts:89`) but the GenUI
`prompt_user` tool exists and is the right clarify vehicle. The live defect session was
mission-mode, so EVERY prompt became a mission; the owner expected per-prompt judgment.

## Design

- **Shared (additive):** `"auto"` joins the hub session mode union + schemas; `NewSessionDialog`
  defaults new sessions to `auto` (existing modes remain selectable; existing sessions untouched).
- **Prompt (mode-addenda):** `auto` addendum teaches the routing rubric: answer directly when one
  turn + granted tools suffice; call `mission.propose_plan` when the task decomposes into parallel
  or adversarial work; when genuinely unsure AND estimated mission cost is non-trivial, call
  `prompt_user` with options `["Quick answer", "Run a mission (est. $X, N agents)"]`, then act on
  the choice. Never silently start a mission (the plan-approval gate still applies per autonomy).
- **API:** `mission.propose_plan` becomes grantable in `auto` mode (lift `orchestrator.ts:177` to
  accept `mission` OR `auto`); everything downstream (plan card, approval, board) unchanged.
- **Memory of choice:** the clarify card's answer applies to that message; a session-level
  preference ("always just answer" / "always propose") is stored as a lightweight session field
  ONLY if trivially additive; otherwise defer with a note (do not build a preferences subsystem).
- **Docs:** user-guide section on modes gains `auto` and the D-AH5 copy is amended (recorded as a
  deliberate revision in this plan's README, not a reopening of D-AH5's dialog design).

## Files (exclusive)

- `packages/shared/src/types.ts`, `schemas.ts` (mode union, additive)
- `apps/api/src/hub/prompting/layers/mode-addenda.ts`, `apps/api/src/hub/missions/orchestrator.ts` (mode gate), `apps/api/src/hub/session-service.ts` (mission-builtin grant condition; later batch than 2.1/3.2 edits)
- `apps/web/src/features/hub/NewSessionDialog.tsx` (default + copy), `ConversationPane.tsx` (nothing expected — `prompt_user` renders via the existing GenUI path; verify only)
- `e2e/smoke.spec.ts` + stub: auto-session seed covering all three routes (direct answer / clarify → mission / direct mission)
- `user-guide/16-assistant-hub.md`

## Acceptance

- [ ] Stubbed auto session: trivial prompt ⇒ plain answer, no mission events; mission-shaped prompt ⇒ `plan_proposed`; ambiguous fixture ⇒ `prompt_user` card, and each choice leads to the right path.
- [ ] `proposePlan` accepts auto-mode sessions; mission-mode behavior unchanged; chat/research still never propose.
- [ ] Plan-approval autonomy gate still applies after routing (no silent mission start; test).
- [ ] Additive shared diff; pre-fix session replay unaffected.
- [ ] Gate + e2e green.
