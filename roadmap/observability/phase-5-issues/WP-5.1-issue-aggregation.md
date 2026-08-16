# WP 5.1 — Issue aggregation: registry extension + deterministic clustering + lifecycle

**Phase:** 5 — Fleet issues · **Size:** L · **Depends on:** 1.2, 4.2 · **Model:** Opus

## Objective

Recurring failures become first-class issues (D-OB20): the existing rating-issues registry
grows a fleet dimension — deterministic clustering across runs, occurrence counts, first/last
seen, affected entities, an open/resolved/regressed lifecycle with auto-reopen. No LLM in this
WP (that's 5.2 opt-in).

## Design

- MIGRATION (claim next free version), extending the v26 rating-issues tables (D-OB20 — one
  registry, verify actual table names in `grading/issue-repository.ts` at claim time): add
  `cluster_key TEXT`, `occurrences INTEGER`, `first_seen_at`, `last_seen_at`,
  `affected_json` (servers/skills/tests/models), `lifecycle TEXT
  CHECK('open'|'resolved'|'regressed')`, `resolved_at NULL`, `resolution_note NULL`,
  `trend_json NULL` (per-day counts, derived-cached, recomputable) + an issue↔run link table if
  v26 lacks one.
- Deterministic cluster key: `bucket | fixTargetKind:fixTargetId | serverOrSkill |
  normalizedErrorSignature` — components from error-forensics output, guardrail
  `stopReasonCode`, and a documented error normalizer (strip ids/numbers/paths; unit-tested).
  Key construction is versioned (`cluster_key_version`) so future changes don't silently merge
  history.
- Sweep job (rides the 4.2 scheduler + on-demand `POST /api/issues/sweep`): folds terminal runs
  since the last sweep into issues — new key ⇒ new open issue; existing open ⇒ increment +
  update last_seen/affected/trend; **resolved key reappearing ⇒ lifecycle `regressed` +
  notification** (auto-reopen, the Engine behavior). Fully idempotent (re-sweep of the same
  window changes nothing).
- Lifecycle API: `GET /api/issues` (filter by lifecycle/entity/date), `GET /api/issues/:id`
  (detail + linked runs via RunFilter + drafted fixes from the underlying forensics rows),
  `POST /api/issues/:id/{resolve,ignore,reopen}` (note optional). Wire additive.
- Suite error-clustering (`suite-report-service`) stays as-is; where sensible its cluster
  signature reuses the same normalizer helper (extract, don't fork — verify feasibility, else
  document why not).

## Files

- `apps/api/src/grading/{issue-repository,issue-service,issue-routes}.ts` (extend) + a new
  `apps/api/src/grading/issue-clustering.ts` (key builder + normalizer + sweep) (+ tests)
- `apps/api/src/watch/scheduler.ts` (sweep registration)
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `packages/shared/src/{types,schemas}.ts`
- `apps/api/test/issues-*.test.ts`

## Acceptance

- [ ] Fixture corpus (mixed causes across servers/skills) clusters into the hand-computed
      issues; occurrences/first/last/affected/trend correct; idempotent re-sweep proven.
- [ ] Normalizer collapses id/number/path variance (table-driven test); key versioning stamped.
- [ ] Lifecycle transitions + regressed auto-reopen (+ notification emitted) tested.
- [ ] Existing per-run rating-issue behavior and AR contracts unchanged (existing tests green).
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Registry extension is the delicate part — read the v26 schema first-hand before writing the
migration. Everything here must be recomputable from runs + grades (derived doctrine): a
`POST /api/issues/rebuild` (drop derived fields, re-sweep history) proves it.
