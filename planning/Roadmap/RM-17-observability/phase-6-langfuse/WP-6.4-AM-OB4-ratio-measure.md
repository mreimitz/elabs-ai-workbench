---
type: "Work Package Spec"
title: "WP 6.4 (AM-OB4) — a ratio measure whose numerator carries its own filter"
description: "A metrics measure expressed as numerator ÷ denominator, each side with its own RunFilter, unlocking arbitrary share metrics and finally implementing the declared-but-inert feedbackRate."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.4 (AM-OB4) — a ratio measure whose numerator carries its own filter

## Verification finding

**No ratio mechanism exists. Every layer carries exactly one filter for the whole query.**

The shipped measure set is 13 names, declared once in
`packages/shared/src/constants.ts:423-442` (`RUN_METRICS_MEASURES`) — `count`, `errorRate`,
`guardrailRate`, `p50DurationMs`, `p95DurationMs`, `tokensIn`, `tokensOut`, `costUsd`, `meanScore`,
`feedbackRate`, `cacheReadTokens`, `cacheWriteTokens`, `cacheHitRate`. The type is derived
(`types.ts:4867`) and the zod is `z.enum(RUN_METRICS_MEASURES)` (`schemas.ts:2949`).
`apps/api/src/observability/metrics.ts` declares **no** measure list of its own — it switches on the
shared union in `scalarPoint` (`:613-653`) and `splitPoints` (`:656-670`).

What the existing ratios actually do — worth copying, because it is a good pattern:

- One SQL pass (`metrics.ts:343-351`) materializes `RunRowForMetrics[]`; a per-(group, bucket)
  accumulator `BucketAcc` (`:286-302`) is folded in one loop (`:462-515`); ratios are then a division
  in `scalarPoint`. `errorRate` = `acc.errorCount / acc.count` (`:621-622`), `guardrailRate` =
  `acc.guardrailCount / acc.count` (`:623-624`).
- **`cacheHitRate` is the closest existing analogue to what this item asks for** (`:634-649`): it
  divides over a **separate** `acc.cache` sub-accumulator whose `n` deliberately differs from
  `acc.count`, because the numerator qualifies only over runs with a *known* cache split
  (`:296-300`, `:500-509`), and it returns `null` — omitting the bucket — when `n === 0 || grossIn === 0`.
  But that qualifying condition is **hardcoded**, not caller-supplied.
- `meanScore` is the one measure needing a second query, against `run_grades` (`:397-404`, gated by
  `wantMeanScore` at `:341`).
- `passRateAt05` is **not** a metrics measure at all — it is a suite aggregate computed at
  `apps/api/src/suites/orchestrator.ts:203` and never exposed through `/api/metrics/runs`.

What does not exist:

- **No per-measure filter, anywhere.** `RunMetricsParams` (`metrics.ts:253-260`) is
  `{ filter: RunFilter; from?; to?; bucket; groupBy?; measures: RunMetricsMeasure[] }` — one filter, N
  measures. The route (`apps/api/src/observability/routes.ts:63-80`) parses `?filter=` once and takes a
  flat `?measures=` list; it is a GET with no body. `DashboardChartRunsConfig`
  (`types.ts:4984-4993`) is `{ source, measures, filter, groupBy?, bucket, chartType }` with a
  `.strict()` zod (`schemas.ts:2990-3003`), so an extra per-measure key is a 400 today.
- The **only** measure-scoped modifier in the whole app is `WatchWindowConfig.grader`
  (`types.ts:2320`, `schemas.ts:1251`), and it is not a numerator filter — it is folded into the whole
  query's filter at `apps/api/src/watch/engine.ts:405`.
- **`feedbackRate` is a declared name with no implementation**: `constants.ts:433`, unit `"rate"` at
  `:506`, permanently short-circuited at `metrics.ts:567` (`if (measure === "feedbackRate") continue;`)
  and always reported in `unavailableMeasures` (`metrics.ts:534`). Its backing store `run_feedback`
  **does** exist (migration v36, `apps/api/src/db/database.ts:878-909`) and the filter path already
  queries it (`metrics.ts:166-173`) — only the measure is missing. This is the ledger's recorded
  follow-up (`STATUS.md:667`).
- **No `grader` parameter on `meanScore`** — it always selects via `PRIMARY_GRADER_PRIORITY`
  (imported at `metrics.ts:44`, applied `:415-423`) and the grade query at `:397-404` has **no
  `grader_id` predicate**. `RunFilter.grader` (`types.ts:2050`) is honoured in `buildRunFilterWhere`
  (`metrics.ts:144-157`) but it narrows **which runs count**, not **which score is meaned**. The
  comment at `watch/engine.ts:401-405` saying it "scopes scoring to that grader" **overstates what the
  code does** — worth correcting while in this file.

**The `buildRunFilterWhere` duplication is real, and worse than the ledger records.** Copy A is
`apps/api/src/observability/metrics.ts:48-183`; copy B is the module-private one at
`apps/api/src/testing/run-repository.ts:1490-1651` (called from `:858`); the shared pure predicate is
`matchesRunFilter` (`packages/shared/src/run-filter.ts`, with a note at `:232` naming both copies). The
metrics header claims at `:19-20` that "**Both** translations are anchored to the SAME shared
`matchesRunFilter` predicate by cross-check tests" — but the cross-check
(`apps/api/test/runs-filter.test.ts:658`, 35 filter cases at `:660-696`) exercises
`runs.queryRuns(filter)`, i.e. **only copy B**. `apps/api/test/metrics-runs.test.ts` never imports
`matchesRunFilter`; its closest coverage is one composed case at `:374`. **The metrics replica is not
pinned to the predicate and the two copies can silently drift.**

**Verdict: NOT BUILT.**

## Goal

Today the only shares an operator can chart are the four hardcoded ones someone thought of in advance
(error rate, guardrail rate, cache hit rate, and a `feedbackRate` that returns nothing). Afterwards
they can express any share as a measure — "what fraction of runs on this server used a skill", "what
fraction of failures were guardrail stops", "what fraction of runs got human feedback" — by naming a
numerator filter beside the chart's own filter, and that measure works identically in the dashboard,
the chart composer and a windowed watch rule, because all three read the same vocabulary.

## Scope

- **`packages/shared`** — add a `ratio` measure whose configuration is
  `{ numerator: RunFilter; denominator?: RunFilter }`, carried **alongside** the existing flat
  `measures: RunMetricsMeasure[]` rather than replacing it. Additive only: `RUN_METRICS_MEASURES` gains
  a `"ratio"` member, `RUN_METRICS_MEASURE_UNITS` maps it to `"rate"`, and the metrics request gains an
  optional ratio-config field. `DashboardChartRunsConfig`'s `.strict()` zod widens to accept it. The
  denominator defaults to the query's own filter, so the common case stays one filter.
- **Wire shape decision to make at pickup, and record it in the ledger:** `GET /api/metrics/runs`
  is a GET with no body (`routes.ts:63-80`) and `?filter=` is already a JSON blob, so the ratio config
  should ride as a second JSON param rather than forcing a POST. **Do not convert the endpoint to
  POST** — the dashboard, the composer, the watch engine and the digest all call it.
- **`apps/api/src/observability/metrics.ts`** — extend `BucketAcc` (`:286-302`) with a
  caller-configured numerator counter, folded in the **same single pass** (`:462-515`) using
  `matchesRunFilter` from `shared` against each already-materialized `RunRowForMetrics`. This is the
  key design point: the numerator must **not** become a second SQL query. Follow the `acc.cache`
  precedent for honesty — return `null` and omit the bucket when the denominator is 0, never 0.0.
- **Implement `feedbackRate` as the first instance of the new machinery** — a named ratio
  (numerator: runs with human feedback; denominator: the query filter) rather than a fourteenth
  bespoke branch. Remove the `continue` at `metrics.ts:567` and the `unavailableMeasures` entry at
  `:534`. This closes the ledger's recorded follow-up *with* the new mechanism instead of beside it.
- **Pin the metrics `buildRunFilterWhere` replica.** Either extract the SQL builder to a shared
  location both copies use (the ledger's own suggestion at `STATUS.md:146-152`), or — the minimum
  acceptable outcome — extend the `runs-filter.test.ts:658` cross-check table to run every one of its
  35 cases against `computeRunMetrics` as well, so copy A is pinned to `matchesRunFilter` too. This WP
  is the one that touches filter translation in `metrics.ts`, so it owns closing this.
- **Correct the overstated comment** at `apps/api/src/watch/engine.ts:401-405`.
- **UI** — the chart composer (`ChartComposerDialog.tsx`) and the watch-rule editor
  (`RuleEditorDialog.tsx`) both render `RUN_METRICS_MEASURES` directly, so a ratio needs a numerator
  filter editor in both. Reuse the existing `RunFilterBar` composition rather than a second filter UI.

## Files

Modify:

- `packages/shared/src/constants.ts` — ⚠ **contended**
- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended**
- `apps/api/src/observability/metrics.ts` — ⚠ **highly contended**: AM-OB12 also extends the measure
  surface here. **Do not batch WP 6.4 with WP 6.12** — WP 6.12 depends on this one.
- `apps/api/src/observability/routes.ts`
- `apps/api/src/watch/engine.ts` (the comment correction, and the measure passthrough)
- `apps/api/test/metrics-runs.test.ts`
- `apps/api/test/runs-filter.test.ts` (the cross-check extension)
- `apps/web/src/features/dashboard/testing/ChartComposerDialog.tsx` — ⚠ shared with AM-OB7
- `apps/web/src/features/dashboard/testing/ChartComposerDialog.test.tsx`
- `apps/web/src/features/dashboard/testing/custom-chart-query.ts`
- `apps/web/src/features/watch/RuleEditorDialog.tsx` — ⚠ shared with AM-OB10
- `apps/web/src/features/watch/rule-form.ts` — ⚠ shared with AM-OB10 and AM-OB11

## Non-goals

- **Not a BI tool.** `DASHBOARD_CHART_MAX_MEASURES = 4` (`constants.ts:474`) and the same-unit
  constraint stay. A ratio is one measure, not an expression language; no arithmetic beyond
  numerator ÷ denominator, no nesting, no derived-of-derived.
- No second SQL query for the numerator, and no client-side aggregation (the composer renders only
  what the metrics service returns — `constants.ts:462-465`).
- No zero-fill. A bucket whose denominator is 0 is **omitted or marked**, never rendered as 0%
  (conventions §2, and the `cacheHitRate` precedent at `metrics.ts:645-649`).
- The `grader`-on-`meanScore` follow-up is **not** in scope — it is not a ratio, it is a selection
  rule. It is recorded here only because this WP touches the same lines and should not make it harder.
- No change to suite analytics' `passRateAt05` (`suites/orchestrator.ts:203`), which is a different
  computation over a different population.

## Dependencies

- Depends on shipped WP 1.1 (the `RunFilter` grammar and `matchesRunFilter`), WP 1.2 (the metrics
  service), WP 1.5 (`run_feedback`, which makes `feedbackRate` implementable) and WP 2.7 (the composer)
  — all done.
- **AM-OB12 depends on this WP** (it needs the ratio to express a verdict share).
- **AM-OB7 depends on this WP** for its "+ ratio" clause, though AM-OB7's other clauses do not.
- ⚠ Shares `metrics.ts` with AM-OB12, `ChartComposerDialog.tsx` with AM-OB7, and
  `RuleEditorDialog.tsx`/`rule-form.ts` with AM-OB10 and AM-OB11. Run this one **before** all four.

## Migration

**None.** The measure vocabulary lives in code (`packages/shared/src/constants.ts`), and the chart
config is a JSON blob in the existing `dashboard_charts` row. `apps/api/src/db/{database,schema}.ts`
must be a zero-line diff and no `user_version` is claimed.

## Acceptance

1. `GET /api/metrics/runs` accepts a ratio measure with an explicit numerator filter and returns a
   series whose values equal (numerator matches ÷ denominator matches) per bucket, verified against
   hand-counted fixture rows.
2. A bucket whose denominator is 0 is **absent from the series or explicitly null** — a test asserts
   it is never `0`.
3. The numerator is computed in the **same single row scan** as the denominator: a source-walk test
   asserts `computeRunMetrics` issues no additional `SELECT` for the ratio (the existing `wantMeanScore`
   second query at `metrics.ts:397-404` is the only permitted extra).
4. `feedbackRate` returns real values, is no longer listed in `unavailableMeasures`, and the
   `continue` at `metrics.ts:567` is gone — pinned by a test over seeded `run_feedback` rows.
5. **AR6 / D-OB15 guard:** `feedbackRate` and any feedback-numerator ratio are their own series and do
   not alter `meanScore`, `run_grades`, or any suite aggregate — asserted by a test.
6. The metrics `buildRunFilterWhere` replica is pinned to `matchesRunFilter`: the 35-case cross-check
   table now runs against `computeRunMetrics` too, and **deliberately breaking one branch of the
   metrics copy turns that table red** (verify by mutation, do not assume).
7. A ratio measure is selectable in the chart composer and in the windowed watch-rule editor, with a
   numerator filter editor reusing the existing filter bar; a saved chart round-trips through
   `dashboard_charts`.
8. The overstated comment at `watch/engine.ts:401-405` now describes what `RunFilter.grader` actually
   does (narrows the run set, does not select which grader's score is meaned).
9. No `user_version` claimed; DB files a zero-line diff.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
