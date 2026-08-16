# WP 4.5 — Review queue lite

**Phase:** 4 — Watch rules · **Size:** M · **Depends on:** 1.5, 2.5 · **Model:** Sonnet

## Objective

Structured human review without multi-annotator machinery (D-OB22, single owner): define a
rubric, walk a filtered set of runs keyboard-first, record verdicts as `run_feedback`, track
progress. Deliberately NOT LangSmith's queues — no reservations, no reviewer states.

## Design

- A "review session" is ephemeral config, not a new entity: pick a source (saved view or
  current feed filter) + a rubric. Rubrics persisted (MIGRATION — claim next free version:
  `review_rubrics(id, name, instructions, keys_json)` where keys_json = [{key, description,
  kind: thumbs|scale5|note}]).
- Review surface (routed view): left = run summary + conversation preview (reuse existing
  preview components read-only); right = rubric form (thumbs/scale/note per key) writing
  `run_feedback` rows (source human, the rubric key names); footer progress (`7/23 reviewed`,
  derived: a run counts reviewed when every rubric key has a row).
- Keyboard: next/prev (`j`/`k`), key focus cycling, submit-and-advance (Enter). Skip allowed.
- Entry points: runs feed toolbar "Review these…" (takes the active filter), Settings-adjacent
  rubric management (list/create/edit rubrics, FormDialog tier).
- Pairwise comparison is explicitly out (Compare workspace already owns side-by-side; noted in
  README non-goals).

## Files

- `apps/api/src/observability/rubrics.ts` + routes (+ tests),
  `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `packages/shared/src/{types,schemas}.ts`
- `apps/web/src/features/review/` (new view + rubric management) + feed toolbar entry,
  `apps/web/src/lib/api.ts`
- Tests: rubric CRUD, progress derivation, feedback writes per key, keyboard flow (component)

## Acceptance

- [ ] Rubric CRUD round-trips; review flow writes one feedback row per key per run
      (upsert on re-review); progress math correct incl. skips.
- [ ] Keyboard-only completion of a 3-run fixture queue possible (test simulates keys).
- [ ] All output is `run_feedback` — grades untouched (separation test still green).
- [ ] Migration claimed + both paths tested; both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Keep it lite: any temptation to add assignment/reservation states is team-server scope. The
review data pays off in RunFilter (`feedback.*`) and the digest.
