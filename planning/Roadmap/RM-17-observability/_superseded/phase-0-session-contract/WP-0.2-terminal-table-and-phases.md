---
type: "Work Package Spec"
title: "WP 0.2 \u2014 One terminal table + phase events in all three executors"
description: "Phase: 0 \u2014 Session contract \u00b7 Size: L \u00b7 Depends on: 0.1 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "superseded"
---
# WP 0.2 — One terminal table + phase events in all three executors

**Phase:** 0 — Session contract · **Size:** L · **Depends on:** 0.1 · **Model:** Opus

## Objective

The same cause produces the same terminal on every executor (D-OB4), machine-readably. Emit
lifecycle phase events everywhere they are true, persist `stopReasonCode` + `lastPhase`, make
queued subscription runs visible, and decouple run concurrency from the auto-rating judge gate
(D-OB10).

## Design

- New `apps/api/src/testing/session-terminal.ts`: `terminalFor(cause) → {status, outcome,
  stopReasonCode}` implementing the concept C1 table (user_stop, session_ended, max_duration,
  idle, budget meters, context_overflow, provider errors). All three executors route every
  terminal through it: `engine.ts`, `claude-subscription-executor.ts`,
  `vendor-assistant-executor.ts`. Fixes verified divergences: vendor 30-min deadline must terminate
  `stopped/stopped_guardrail/max_duration` (today `aborted/aborted`); interactive clean-end
  paths align per the table.
- Phase events (from 0.1): subscription executor emits `phase: queued` (+ best-effort position
  in `detail`) BEFORE `gate.acquire()`; all executors emit `starting`/`running`; engine + vendor
  interactive `nextTurn` waits and `ask_user` waits emit `waiting_input`; the rating pipeline's
  existing "Reviewing…" state emits `reviewing`. Events flow through `RunManager.emit`
  (seq-stamped) like every other event.
- Persistence (MIGRATION — claim next free `user_version`, v28 expected): `runs` gains nullable
  `stop_reason_code` and `last_phase` columns; run repository writes them at terminal/phase
  transitions; run summary/detail responses include them (types from 0.1).
- Concurrency decouple: new env `SUBSCRIPTION_RUNS_MAX_CONCURRENCY` (default 1) with its own
  semaphore for subscription RUN execution; `AUTO_RATING_MAX_CONCURRENCY` keeps the judge gate
  only. `.env.example` + `config/env.ts` documented.
- `guardrailFromReason` string-sniffing in the web is NOT touched here (WP 0.5 retires it).

## Files

- `apps/api/src/testing/session-terminal.ts` (new) + `apps/api/test/session-terminal.test.ts`
- `apps/api/src/testing/engine.ts`, `apps/api/src/testing/claude-subscription-executor.ts`,
  `apps/api/src/testing/vendor-assistant-executor.ts`, `apps/api/src/testing/run-service.ts`
- `apps/api/src/testing/subscription-concurrency.ts`, `apps/api/src/config/env.ts`, `.env.example`
- `apps/api/src/testing/run-repository.ts`, `apps/api/src/db/database.ts`,
  `apps/api/src/db/schema.ts`, `apps/api/src/db/rows.ts`
- `apps/api/test/` — lifecycle tests (one per executor per cause), migration test extension

## Acceptance

- [ ] One lifecycle test PER executor asserting: wall-clock cap → `stopped/stopped_guardrail/
      max_duration`; user stop → `aborted/aborted/user_stop`; provider failure → `error` with a
      provider `stopReasonCode` — identical across executors (stubbed drivers, no live calls).
- [ ] the vendor deadline no longer maps to `aborted` (regression test cites the old behavior).
- [ ] `phase: queued` visible (test: gated subscription run emits it before permit; events
      persisted + replayable), `waiting_input` emitted on interactive waits on all executors.
- [ ] `stop_reason_code` + `last_phase` persisted and returned; old rows null-safe; fresh-DB and
      upgrade migration paths tested; migration version claimed in STATUS Decision log.
- [ ] Run concurrency no longer rides the judge gate (test: judge busy ≠ run queued).
- [ ] Replay of a pre-migration run renders unchanged (no phase events required).
- [ ] Gate green.

## Notes

Contested surfaces: executors + run-service + migration — this WP runs SOLO in its batch.
`session_ended` becomes *reachable* only in WP 0.3/0.6 (End-session affordance); the mapping
exists now.
