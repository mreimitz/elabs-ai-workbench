---
type: "Work Package Spec"
title: "WP 1.2 — emit, persist and roll up the cache split (migration 59)"
description: "Phase 1 of item.md. Ledger: STATUS.md. Emits the split on the kpi event, persists nullable run columns backfilled from run_steps, maps them into RunSummary, rolls them up onto SuiteAggregates."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:06:00Z"
status: "final"
---
# WP 1.2 — emit, persist and roll up the cache split

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.1 (the optional wire fields must exist first).
**Consumed by:** WP 2.2 (metrics read the new columns), WP 3.1 (every display), WP 3.2 (exports).

The split is captured per step today and then thrown away on the way up. This WP carries it all the
way to the run row and the suite aggregate.

---

## The three places it is lost today

1. **The `kpi` event drops it.** `apps/api/src/testing/accounting.ts:446-451` accumulates
   `this.kpis.cachedTokens`, but the emit at `:576-587` sends only
   `turns, toolCalls, tokensIn, tokensOut, contextTokens, costUsd, costBasis?`.
2. **`runs.cached_tokens` is write-only.** Written at `apps/api/src/testing/run-repository.ts:351,380`
   (re-accumulated from step events at `:166-173` precisely *because* the kpi event lacks it), row
   type at `apps/api/src/db/rows.ts:226` — and then **never mapped into `RunSummary`** by the mapper
   at `run-repository.ts:1565-1600`.
3. **Suite aggregates never had it.** `apps/api/src/suites/orchestrator.ts:191` is
   `Σ (child.tokensIn + child.tokensOut)`.

---

## Scope

### 1. `apps/api/src/testing/accounting.ts` — carry and emit the split

- Add `cacheReadTokens` / `cacheWriteTokens` to the kpi accumulator (`:58`, its reset at `:295`) and
  accumulate them alongside the existing `cachedTokens` at `:446-451`. `extractProviderUsage`
  (`:190-248`) already produces them — **do not touch it**.
- Emit `cacheReadTokens` / `cacheWriteTokens` / `cachedTokens` on the `kpi` event (`:576-587`), each
  **omitted when the run has never seen a cache slice** (so a non-caching provider's event is
  byte-identical to today's — additive means additive).
- `SessionStats.totals` (`:527-539`) already carries `cachedTokens`; add the two split members there
  too so the compatibility session (`apps/api/src/compatibility/session.ts:496-500`) sees them.

### 2. Migration — claimed `user_version` **59** (D-CT3)

In `apps/api/src/db/database.ts` (current tail is v58 at `:1849`; `LATEST_SCHEMA_VERSION` auto-derives
at `:1869`), append:

```
{ version: 59, up: (db) => { … } }
```

- `ensureColumn` two **nullable** `INTEGER` columns on `runs`: `cache_read_tokens`,
  `cache_write_tokens`. **No `NOT NULL DEFAULT 0`** — a pre-migration run must read as *absent*, not
  as *zero cache* (D-CT3).
- **Backfill from the already-persisted steps**, which makes historical runs immediately useful:

```sql
UPDATE runs SET
  cache_read_tokens  = (SELECT SUM(COALESCE(json_extract(s.usage_actual_json,'$.cacheReadTokens'),0))
                        FROM run_steps s WHERE s.run_id = runs.id AND s.usage_actual_json IS NOT NULL),
  cache_write_tokens = (SELECT SUM(COALESCE(json_extract(s.usage_actual_json,'$.cacheWriteTokens'),0))
                        FROM run_steps s WHERE s.run_id = runs.id AND s.usage_actual_json IS NOT NULL)
WHERE EXISTS (SELECT 1 FROM run_steps s
              WHERE s.run_id = runs.id AND s.usage_actual_json IS NOT NULL);
```

  A run with no step carrying `usage_actual_json` is left **NULL**. A run whose steps carry usage but
  no cache keys backfills to `0` — which is honest: we know it had no cache.
- Mirror the two columns in the baseline `apps/api/src/db/schema.ts` `runs` DDL (beside
  `cached_tokens`, `:262`) so a fresh DB has them, and in `apps/api/src/db/rows.ts:226`
  (`cache_read_tokens: number | null; cache_write_tokens: number | null;`).
- Add nothing else. One migration, two columns, one backfill.

### 3. `apps/api/src/testing/run-repository.ts` — persist and finally expose

- Track `cacheReadTokens`/`cacheWriteTokens` on the finalize cursor beside the existing `cachedTokens`
  (`:166-173`, `:1209`), preferring the kpi event's values now that they exist and falling back to the
  step re-accumulation (which must stay — a run can terminate before a kpi event lands).
- Persist both in the finalize UPDATE (`:351`, `:380`).
- **Map `cachedTokens`, `cacheReadTokens`, `cacheWriteTokens` into `RunSummary`** (`:1565-1600`),
  passing `null` through as `undefined` rather than `0`.
- Leave the `tokens` sort/filter expression (`:1288`, `:1357-1359`) exactly as it is — D-CT1.

### 4. `apps/api/src/suites/orchestrator.ts` — roll up

At `:191`, add `cacheReadTokens` / `cacheWriteTokens` to `SuiteAggregates` beside `totalTokens`. A
member whose columns are NULL contributes **unknown**: if any member is unknown the aggregate is
reported as `undefined` rather than a total that silently understates. Keep `totalTokens` unchanged
(D-CT1). `execCostUsd` / `judgeCostUsd` are untouched — the judge ledger stays separate (B5).

---

## Out of scope

The estimate endpoint, metrics measures, any UI, any report or export. `HubUsage` and the hub turn
engine already carry the split (`apps/api/src/hub/turn-engine.ts:1326-1347`) — **do not touch them**.

---

## Acceptance

1. **Migration test.** Open a fixture DB stamped at `user_version = 58` with `runs` + `run_steps`
   rows whose `usage_actual_json` carries known `cacheReadTokens`/`cacheWriteTokens`; migrate; assert
   (a) both columns equal the per-run step sums, (b) a run with **no** usage-bearing step is still
   `NULL`, (c) a run whose steps carry usage but no cache keys is `0`, (d) `user_version` is 59.
2. **A fresh DB and a migrated DB have the identical `runs` schema** — the existing schema-parity test
   pattern; if none exists, add one comparing `PRAGMA table_info(runs)` between the two paths.
3. **`RunSummary` now carries the fields.** An API test drives a run to terminal and asserts
   `GET /api/runs/:id` returns `cachedTokens`/`cacheReadTokens`/`cacheWriteTokens`, and that
   `cacheReadTokens + cacheWriteTokens === cachedTokens` for that run.
4. **The kpi event carries the split, and omits it when there is none.** Two SSE tests: a
   cache-bearing stub emits the fields; a no-cache stub emits an event **deep-equal to today's**.
5. **`tokensIn` is unchanged.** A test asserts the persisted `tokens_in` for a fixed stubbed usage
   sequence equals the value the same fixture produced before this WP — the D-CT1 tooth.
6. **Suite aggregate honesty.** A suite with one NULL-cache member reports the cache aggregates as
   absent, not as the sum of the known members.
7. Every teeth check above **verified red before green** — break the backfill, break the omit-when-
   absent rule, break the NULL-member rule, watch each fail, restore.
8. No new dependency. No feature flag. Exactly one migration.
9. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
