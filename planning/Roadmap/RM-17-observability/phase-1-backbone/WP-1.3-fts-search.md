---
type: "Work Package Spec"
title: "WP 1.3 \u2014 Full-text search: FTS5 index + backfill + q= + reindex"
description: "Phase: 1 \u2014 Backbone \u00b7 Size: L \u00b7 Depends on: 1.1 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.3 — Full-text search: FTS5 index + backfill + q= + reindex

**Phase:** 1 — Backbone · **Size:** L · **Depends on:** 1.1 · **Model:** Opus

## Objective

"Find the run where it said …" in under a second: an SQLite FTS5 index over run content
(D-OB16), populated at persistence time, backfilled once, queryable through the RunFilter `q`
field, rebuildable via maintenance.

## Design

- Preflight: verify FTS5 is compiled into the bundled better-sqlite3
  (`SELECT * FROM pragma_compile_options WHERE compile_options LIKE '%FTS5%'`). If absent, STOP
  and ask the owner (conventions §deps).
- MIGRATION (claim next free version): `run_search` FTS5 virtual table
  `(run_id UNINDEXED, step_id UNINDEXED, kind UNINDEXED, content)` + a small docmap if needed.
  Indexed content classes + truncation (constants in `packages/shared`):
  - `prompt` / `assistant` — user prompts, assistant/answer text (≤2 kB/field)
  - `tool` — tool name + serialized args (≤1 kB)
  - `tool_result` — result text (≤1 kB; skip non-text and base64-looking payloads)
  - `error` — error strings + human `stopReason`
  - `rating` — judge verdict text, forensics summaries + fix targets (from `run_grades`)
  - `meta` — run title, environment name, model id
- Write path: hook the existing persistence choke point (run repository step/terminal writes and
  the grading persistence for `rating` rows) — never the executors. Idempotent per (run, step,
  kind).
- Read path: RunFilter `q` → FTS `MATCH` joined with the 1.1 SQL translation; result includes
  match kind + snippet (`snippet()`) for feed preview. Prefix matching via FTS5 defaults;
  document the tokenizer choice (`unicode61`).
- Backfill: one-shot migration-adjacent job over existing runs (batched, resumable) + progress
  logging; `POST /api/maintenance/reindex-search` drops + rebuilds (extends the maintenance
  family). Deleting a run purges its rows (hook the existing run delete).

## Files

- `apps/api/src/observability/search.ts` (new) + tests
- `apps/api/src/testing/run-repository.ts` (write hooks), `apps/api/src/grading/grade-repository.ts`
  (rating hook), run delete path
- `apps/api/src/db/{database,maintenance}.ts` (migration + reindex)
- `packages/shared/src/constants.ts` (truncation limits), `apps/api/test/search-*.test.ts`

## Acceptance

- [ ] Each content class indexed + findable (fixture per class); binary/base64 tool results
      skipped (test with an image-bearing payload).
- [ ] Truncation enforced (oversized fixture indexes only the cap).
- [ ] `q` composes with other RunFilter fields; snippets returned; run delete purges.
- [ ] Backfill indexes a pre-existing seeded corpus; reindex endpoint rebuilds to identical
      results; both migration paths tested.
- [ ] Search p95 < 1 s on the 1.2 50k-run corpus (reuse the perf harness).
- [ ] Gate green.

## Notes

Migration-bearing — serialize. The FTS table is derived state (conventions §1): losing it must
never lose truth; reindex restores it fully.
