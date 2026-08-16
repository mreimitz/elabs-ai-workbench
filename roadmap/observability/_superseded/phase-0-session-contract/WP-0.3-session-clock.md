# WP 0.3 — SessionClock: one clock policy for all executors

**Phase:** 0 — Session contract · **Size:** L · **Depends on:** 0.2 · **Model:** Opus

## Objective

Extract the three per-executor deadline copies into one injected `SessionClock` implementing
concept C2: the wall clock pauses while waiting for a human, idle is bounded uniformly, the
deadline warns before it kills, budgets are extendable and visible, and hung runs are caught by
a stall detector. Persist the duration split (D-OB5).

## Design

- New `apps/api/src/testing/session-clock.ts`, owned by run-service, injected into all three
  executors (replaces their local `DEFAULT_MAX_RUN_DURATION_MS` copies and the engine-only idle
  logic). Behavior:
  1. Wall-clock cap configurable: app-settings default (Settings → Testing; reuse the
     `app_settings` repository pattern from grading) → per-environment `guardrails.maxRunDurationMs`
     (exists) → per-launch override (additive field on run-plan/launch wire). `0` = no limit.
  2. Clock pauses in `waiting_input` (phase events from 0.2 drive it): `activeDurationMs` accrues
     only outside waits; `totalDurationMs` is wall time. Both persisted on the run row
     (MIGRATION — claim next free version) and returned (types from 0.1).
  3. Idle timeout uniform (D-OB8): one configurable value (default 10 min) applied to `nextTurn`
     AND `ask_user` waits on ALL executors — wire `idleTimeoutMs` through `resolve()` at last;
     add the wait-race to subscription + qlik interactive loops. Idle fire →
     `terminalFor("idle")`.
  4. Warn-then-stop: at T−5 min emit `phase: deadline_warning`; `POST /api/runs/:id/extend`
     (+15 min per call, adopted default) honored by the clock, audited as a `context_event` step,
     forbidden for suite members (409).
  5. Stall detector: no events of any type for N min (configurable, default 5) while `running` →
     `terminalFor("stalled")`.
- Existing behavior preserved where correct: deadline created after `gate.acquire()` (queue time
  never eats budget).

## Files

- `apps/api/src/testing/session-clock.ts` (new) + `apps/api/test/session-clock.test.ts`
- `apps/api/src/testing/{engine,claude-subscription-executor,qlik-answers-executor,run-service}.ts`
- `apps/api/src/testing/routes.ts` (extend endpoint), `apps/api/src/testing/ask-user-tool.ts`
- `packages/shared` (launch-override + extend wire — additive; coordinate: this WP owns shared
  for its batch)
- `apps/api/src/db/{database,schema,rows}.ts` (duration columns migration)
- Settings surface: `apps/api/src/grading/app-settings-repository.ts` (or extracted shared
  app-settings module — implementer's call, note it), `apps/web/src/features/settings/SettingsView.tsx`
  (Testing defaults card)

## Acceptance

- [ ] Fake-timer tests: pause-in-waiting (active vs total diverge), uniform idle fire on all
      three executors, deadline warning at T−5, extend honored + audited + rejected for suite
      members, stall fire, `0` = unlimited.
- [ ] No executor contains its own deadline/idle constant anymore (grep-proof in test).
- [ ] `activeDurationMs`/`totalDurationMs` persisted, returned, null-safe for old runs.
- [ ] Settings default editable + persisted; per-launch override round-trips the wire.
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Contested surfaces (executors, run-service, shared, migration) — runs SOLO. Web countdown/extend
UI is WP 0.6; this WP ships the API + settings card only.
