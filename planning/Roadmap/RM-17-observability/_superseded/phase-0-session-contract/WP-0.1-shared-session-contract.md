---
type: "Work Package Spec"
title: "WP 0.1 \u2014 Shared session-contract types"
description: "Phase: 0 \u2014 Session contract \u00b7 Size: M \u00b7 Depends on: \u2014 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "superseded"
---
# WP 0.1 — Shared session-contract types

**Phase:** 0 — Session contract · **Size:** M · **Depends on:** — · **Model:** Opus

## Objective

Land the additive wire vocabulary the whole workstream builds on, in `packages/shared` only:
machine-readable stop reasons, lifecycle phases, the capability manifest, and the duration split.
No behavior change in this WP — types, zod schemas, constants, and their tests.

## Design

- `StopReasonCode` closed union (additive): `user_stop | session_ended | max_duration | idle |
  max_turns | max_tokens | max_cost | max_questions | context_overflow | stalled |
  provider_error | auth | rate_limit` (extensible). Optional `stopReasonCode` field on the
  `status` RunEvent payload and on the run summary/detail types, alongside the existing
  free-form `stopReason` (kept verbatim).
- `SessionPhase` union: `queued | starting | running | waiting_input | reviewing |
  deadline_warning`. New additive RunEvent `{type:"phase", phase, detail?}` (concept C1).
  Optional `lastPhase` on run summary types.
- `SessionCapabilities` type per concept C3: `liveText`, `liveReasoning: "none"|"raw"|"structured"`,
  `toolCalls`, `contextWindow`, `tokens: "exact"|"estimated"|"none"`,
  `costBasis: "api_exact"|"subscription_reference"|"questions"|"none"`, `followUps`, `askUser`,
  optional `identity`. New additive RunEvent `{type:"capabilities", capabilities}` and optional
  `capabilities` on run detail.
- Durations: optional `activeDurationMs` and `totalDurationMs` on run summary/report types
  (D-OB5). Existing duration fields untouched.
- Constants: default idle timeout (10 min), deadline-warning lead (5 min), extend increment
  (15 min) — named in `constants.ts` (D-OB8 + adopted extend default).
- Zod schemas for every new shape in `schemas.ts`; exhaustive-union tests.

## Files

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/constants.ts`
- `packages/shared/src/*.test.ts` (co-located or existing test file extension)

## Acceptance

- [ ] All new types/schemas/constants exported and unit-tested (parse + reject cases).
- [ ] Every addition is optional/additive: existing API + web code compiles with **zero**
      changes outside `packages/shared`.
- [ ] `RunEvent` union gains `phase` and `capabilities` members only; no existing member changed.
- [ ] `RUN_STATUSES` / outcome unions untouched (D-OB3).
- [ ] Gate green.

## Notes

This WP owns `packages/shared` for its batch (contested surface — solo). Downstream WPs (0.2,
0.3, 0.4, 1.1) consume these types; do not partially implement their behavior here.
