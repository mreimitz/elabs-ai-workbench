# WP 5.1 — Validation-gate expectations unified with `tests.assertions_json`

**Phase:** 5 · **Size:** M · **Depends on:** 2.2

## Objective
Make validation gates first-class test expectations: a test can declare gate assertions
("gate X of skill Y must pass", "route Z must be taken", "no loop fractures"), evaluated **from
the run's trace alignment** — so the same gate definition drives the visual overlay and a headless
pass/fail, with zero new execution surface.

## Why / references
D4 (gates run only in the attached session; this app observes) and D8 (`tests.assertions_json` is
the reserved, phased column — reuse it, don't invent a parallel assertion format). This is the
"validation gates as first-class tests" tier from the architecture — the skill-level integration
tier above the existing tool-level tests.

## Files
- `packages/shared/src/{types,schemas}.ts` *(modify)* — `TestAssertions` (additive):
  `skillGates: [{ skillId, nodeId, expect: 'pass'|'visited' }]`, `skillRoutes: [{ skillId,
  gatekeeperId, expectedEdgeId }]`, `noFractures?: boolean`; plus the per-run
  `AssertionResult[]` response shape.
- `apps/api/src/testing/test-service.ts` *(modify)* — accept/validate `assertions_json` on test
  CRUD (column already exists — no migration).
- `apps/api/src/skillflow/assertions.ts` *(create)* — `evaluateAssertions(assertions, alignment) →
  AssertionResult[]` (pure; consumes WP 2.2 output, no re-alignment logic).
- `apps/api/src/testing/run-service.ts` *(modify)* — after a run completes with skill assertions
  present: normalize → align → evaluate → persist results (additive `runs.assertion_results_json`
  via `ensureColumn`) and fold into `runs.outcome` per existing outcome semantics.
- `apps/web/src/features/testing/…` *(modify, minimal)* — assertions editor on the test form
  (pickers fed by the attached skills' graphs) + pass/fail chips on the run console; deep-link a
  failed gate assertion into the skill's Trace tab.
- `apps/api/test/skillflow-assertions.test.ts` *(create)* — evaluation matrix (pass/fail per
  assertion kind), run-completion wiring with a mock model, outcome folding, absent-assertions
  no-op.

## Acceptance
- [ ] A test with gate assertions runs headlessly and reports per-assertion pass/fail derived
      **only** from the trace alignment (no execution added anywhere).
- [ ] Same definition powers both surfaces: the failed assertion links to the exact red node in
      the Trace tab.
- [ ] Tests without assertions behave exactly as today (additive everywhere).
- [ ] Repo gate green.

## Notes
Touches `run-service.ts` again — run **solo**. If `runs.outcome` semantics are ambiguous for
partial assertion failure, surface the question to the owner in the WP note rather than deciding
silently.
