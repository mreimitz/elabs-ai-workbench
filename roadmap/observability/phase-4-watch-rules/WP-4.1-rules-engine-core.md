# WP 4.1 — Rules engine core: watch_rules + on-terminal evaluation + actions

**Phase:** 4 — Watch rules · **Size:** L · **Depends on:** 1.1, 1.6 · **Model:** Opus

## Objective

User-defined "when a run matches F, do A" (D-OB19/D-OB21): rules evaluated at the existing
terminal/rating choke point against the RunFilter grammar, executing a closed action set —
including the bench-native killer, promote-to-test.

## Design

- MIGRATION (claim next free version): `watch_rules(id, name, enabled, trigger TEXT
  CHECK('on_terminal'|'windowed'), filter_json, sample REAL NULL, window_json NULL [for 4.2],
  actions_json, created_at, updated_at)` + `watch_rule_events(id, rule_id, run_id NULL, at,
  action, result_json)` (audit log).
- New `apps/api/src/watch/` module. On-terminal path: after a run reaches terminal AND its
  rating settles (hook the same seam the auto-rating post-finish uses — one choke point, no
  executor edits), evaluate every enabled `on_terminal` rule: RunFilter predicate against the
  single run (the factored evaluator from 1.1), optional `sample` (deterministic hash of
  run id — reproducible, no RNG), then execute actions in a fixed order, each audited,
  failures isolated (one action failing never blocks others or the run pipeline — rules are
  strictly post-hoc observers).
- Action set (closed union, `actions_json` zod-validated):
  - `notify {severity, template?}` — writes a notification (table lands in 4.3; until then the
    action is accepted but inert behind a feature check — implementer lands 4.1+4.3 in either
    order per ledger; document the seam)
  - `pin` — sets `runs.pinned` (1.6)
  - `add_to_collection {collectionId}` — existing collections service
  - `promote_to_test {collectionId}` — creates a DRAFT test from the run: prompt from the
    run's first user prompt, environment binding, attachments carried, expectations seeded from
    the run's expected-answer/forensics where present; clearly marked draft (never auto-runs)
  - `run_grader {graderId}` — enqueues an extra grade via the existing grading service
  - `webhook {secretRef, template?}` — POST with templated JSON (rule, run summary, link path);
    URL held in the encrypted secret store, never in `watch_rules`
- CRUD routes `/api/watch-rules` (+ audit list). Wire additive in `packages/shared`.

## Files

- `apps/api/src/watch/{engine,actions,routes}.ts` (new) + tests
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `apps/api/src/grading/grade-service.ts` or run-service post-finish seam (single hook — verify
  the exact seam at claim time; contested surface)
- `packages/shared/src/{types,schemas}.ts`
- `apps/api/test/watch-*.test.ts` (incl. webhook against a local test receiver)

## Acceptance

- [ ] Rule CRUD + validation (bad filter/action → 400); enable/disable honored.
- [ ] On-terminal evaluation fires exactly once per run after rating settles; matches per
      RunFilter fixtures; deterministic sampling proven (same run id → same decision).
- [ ] Every action executes + audits; one failing action (webhook 500) isolates; the run
      pipeline is unaffected by any rule outcome (test: rule throwing never changes run state).
- [ ] promote_to_test creates the documented draft test (fixture asserts field mapping,
      draft flag, no auto-run).
- [ ] Webhook secret never appears in responses/logs; local-receiver test covers template +
      appended fields.
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

The choke-point hook + migration make this SOLO. Rules are observers: repeat it in code
comments — no rule may mutate run lifecycle.
