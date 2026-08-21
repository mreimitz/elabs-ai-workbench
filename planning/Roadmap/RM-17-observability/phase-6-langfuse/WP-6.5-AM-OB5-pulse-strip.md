---
type: "Work Package Spec"
title: "WP 6.5 (AM-OB5) — a sqrt-scaled pulse strip above the runs feed"
description: "A compact bucketed bar strip over the filtered run set — count, cost or p95 duration — where a click narrows the feed to that bucket and a drag selects a range."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.5 (AM-OB5) — a sqrt-scaled pulse strip above the runs feed

## Verification finding

**Nothing chart-like renders above the runs table today, but almost all the data plumbing this needs
already exists.**

Not built:

- `apps/web/src/features/testing/RunsView.tsx` (1451 lines) renders its fixed chrome above the table at
  `:847-876`: `RunsTotalsStrip` (`:850`, defined `:1164-1195` — four `KpiStat` tiles: Rows, Tokens,
  Spend, Failure rate), `RunsCompareBar` (`:856`) and `SessionDurationStats` (`:873`). All numeric text.
  **`RunsView.tsx` imports nothing from `@elabs-ai/components-charts` at all** (import block `:1-79`).
- `SessionDurationStats.tsx` does call `GET /api/metrics/runs` (`:43-51`, `bucket: "week"`,
  `measures: ["p50DurationMs","p95DurationMs"]`) but renders `KpiStat` text only, and only when
  `filter.interactiveOnly === true` (`:31`).
- **No brush anywhere in the app.** A grep for `brush|Brush|onRangeSelect|onSelectRange` across
  `apps/web/src` returns **zero hits**. The only chart interaction props the app uses are
  `onDatapointClick` (11 call sites) and `datapointLabel` (2); `copyValueOnActivate` and
  `maxInteractiveDatapoints` are never used.

Already built, and directly reusable:

- **The endpoint is done.** `GET /api/metrics/runs` (`apps/api/src/observability/routes.ts:63-80`)
  takes the **full `RunFilter` grammar** (`parseRunFilterFromQuery` — byte-identical to `GET /api/runs`,
  so "the currently filtered run set" is free), a `bucket`, an optional `groupBy` and a `measures`
  list. **All three metrics AM-OB5 asks for already exist** in `RUN_METRICS_MEASURES`
  (`packages/shared/src/constants.ts:423-442`): `count`, `costUsd`, `p95DurationMs` (and `p50DurationMs`
  for the documented p50 option). The web client wrapper is `getRunMetrics`
  (`apps/web/src/lib/api.ts:1534-1546`).
- **Empty buckets are already omitted, never zero-filled** — `RunMetricsPoint`
  (`packages/shared/src/types.ts:4870-4918`, note at `:4869` and `:4898`). AM-OB5's "empty buckets
  render as gaps" is therefore a *client-side derivation* problem, not a server one, and the server is
  already honest in exactly the way this needs.
- **The brush is not an upstream gap.** `@elabs-ai/components-charts` v4 exports `ChartBrush`
  (`.d.ts:1163`), `ChartBrushLayout` (`:1167-1188`), `ChartBrushSelectionOverlay` (`:1137`) and
  `ChartBrushTrackOverlay` (`:1203`), all in the barrel at `:4477`. `ChartBrushProps`
  (`:1143-1162`) carries `onSelectionChange?: (domain: ChartBrushSelection | null) => void` with
  `ChartBrushSelection = { start: Date; end: Date }` (`:1139-1142`), plus `brushDirection`,
  `selection`/`initialSelection` and styling props; charts take an `xDomain` override documented as
  "use with brush so main chart and strip share the same scale" (`:1111`). **Nothing needs raising
  upstream and nothing may be hand-rolled** — but there is also **zero in-repo precedent**, so this WP
  is the first user of these primitives.

One real constraint the amendment's own spec does not survive contact with:

- **`METRICS_BUCKETS = ["hour", "day", "week"]`** (`packages/shared/src/constants.ts:397`), timezone
  fixed UTC (`METRICS_TIMEZONE`, `:401`), week starting Monday 00:00 UTC. **There is no `minute`
  bucket.** The research spec's "adaptive buckets, 1 minute → 1 week" cannot be honoured without adding
  a `minute` member to the shared vocabulary and teaching the metrics bucketing to produce it — which
  also lands it in the chart composer and the watch-rule editor, since all three read that one
  constant. That is a decision, not a detail; see Scope.

**Verdict: NOT BUILT.**

## Goal

Today an operator scanning the runs feed sees a flat list and four totals; a spike of failures last
Tuesday afternoon is invisible until they guess the right date filter. Afterwards a compact bar strip
sits above the table showing the shape of the filtered run set over time — bars scaled by square root
so a spike is visible without flattening the baseline, gaps where nothing ran — and clicking a bar or
dragging across several narrows the feed to exactly that window, with browser Back restoring what they
had.

## Scope

- **The strip component**, new, under `apps/web/src/features/testing/runs/`: takes the active
  `RunFilter` plus the resolved window, calls `getRunMetrics` with one of `count | costUsd |
  p95DurationMs` (metric selectable, `count` default; `p50DurationMs` offered as the documented
  alternative), and renders a `BarChart` from `@elabs-ai/components-charts`.
- **Square-root height scale.** This is the item's whole visual thesis. Implement it as an explicit,
  pure, unit-tested transform of the value → bar height, not as an incidental chart prop, so the test
  can assert it (a 100× value is a 10× bar).
- **Gaps, not zeros.** The API omits empty buckets; the strip must render them as **absent bars over a
  continuous x-domain**, which means deriving the full bucket grid client-side and leaving holes — the
  opposite of zero-filling. A zero-filled baseline would read as "we ran and got nothing" instead of
  "we did not run" (conventions §2).
- **Adaptive bucket** derived from the active window, following the shipped precedent
  (`dashboard-url-state.ts:220` `resolveBucket`, and `IssueOccurrencesPanel.tsx:19-27`
  `resolveIssueBucket`): ≤2 days → hour, ≤60 days → day, else week.
- **Bucket vocabulary decision — make it explicitly and record it in the ledger.** Either
  (a) add `"minute"` to `METRICS_BUCKETS` and implement it in the metrics bucketing, accepting that it
  appears in the composer and the watch editor too; or (b) ship the strip on the existing
  hour/day/week vocabulary and record the deviation from the research spec. **(b) is the recommended
  default** — the bench's own run volumes make a minute bucket mostly empty, and widening a shared
  vocabulary to serve one new surface is the more expensive of the two.
- **Click → filter.** A bar click sets `dateFrom`/`dateTo` on the active `RunFilter` to that bucket's
  exact bounds, reusing `bucketRangeIso` (`apps/web/src/features/dashboard/testing/dashboard-url-state.ts:258`)
  rather than recomputing bounds. Because the feed's filter lives in the URL
  (`run-filter-url.ts`), **browser Back restores the previous view for free** — do not add a bespoke
  history stack.
- **Drag → range**, via the upstream `ChartBrush` / `ChartBrushLayout` primitives and their
  `onSelectionChange` callback, mapped to the same `dateFrom`/`dateTo` write.
- **Auto-disable honestly.** Langfuse disables Pulse when the active filters cannot be represented in
  the aggregate. Our equivalent: the metrics route **rejects `filter.q`** outright
  (`routes.ts:66-68` throws `RunFilterError`), so when the feed has a full-text query active the strip
  must render a short explanatory note — never a silently different, unfiltered series.

## Files

Add:

- `apps/web/src/features/testing/runs/RunsPulseStrip.tsx`
- `apps/web/src/features/testing/runs/RunsPulseStrip.test.tsx` (**faithful-stub — see Acceptance 6**)
- `apps/web/src/features/testing/runs/pulse-scale.ts` (the sqrt transform + bucket-grid derivation, pure)
- `apps/web/src/features/testing/runs/pulse-scale.test.ts`

Modify:

- `apps/web/src/features/testing/RunsView.tsx` — ⚠ **contended with AM-OB1**, which moves this
  component's presentation state into the URL. **Do not batch WP 6.5 with WP 6.1.**
- `apps/web/src/features/testing/RunsView.test.tsx`

Modify **only if** the bucket decision goes to option (a):

- `packages/shared/src/constants.ts` ⚠ **contended**
- `apps/api/src/observability/metrics.ts` ⚠ **highly contended** (AM-OB4, AM-OB12)
- `apps/api/test/metrics-runs.test.ts`

Untouched on purpose: `apps/api/src/db/**`, the `?filter=` codec, `dashboard-url-state.ts`
(`bucketRangeIso` is imported, not edited).

## Non-goals

- No new endpoint and no new measure. `GET /api/metrics/runs` already answers this question.
- No hand-rolled brush, no hand-rolled bar chart, no second charting approach. `ChartBrush` /
  `ChartBrushLayout` exist upstream; use them (`.claude/rules/brand-ui-only.md`).
- No zero-filling and no interpolation across gaps.
- No strip on the Suites peer tab in this WP.
- No new URL param: the strip writes through the existing `?filter=` `dateFrom`/`dateTo`, which is
  what makes Back work.

## Dependencies

- Depends on shipped WP 1.1 (`RunFilter`), WP 1.2 (metrics endpoint) and WP 2.3 (the feed + its
  `?filter=` URL state) — all done.
- ⚠ **Conflicts with AM-OB1** on `RunsView.tsx`. Sequence them; AM-OB1 first is the better order,
  because it settles that component's state ownership before a new consumer is added.
- No other Phase 6 dependency.

## Migration

**None** on the recommended path (option b). Option (a) — adding a `minute` bucket — is still **not** a
migration: `METRICS_BUCKETS` is a code constant and buckets are computed at query time. No
`user_version` is claimed either way, and `apps/api/src/db/{database,schema}.ts` must be a zero-line
diff.

## Acceptance

1. A bar strip renders above the runs table, over the **currently active filter**, with a metric
   selector offering count / cost / p95 duration (and p50 as the documented alternative).
2. The height scale is square root: a unit test on the pure transform asserts a 100× value produces a
   10× bar, and that a single outlier does not flatten the rest of the series to invisibility.
3. Buckets with no runs render as **gaps on a continuous axis**, not as zero-height bars — asserted by
   a test over a fixture series with a hole in the middle. No zero-fill anywhere in the derivation.
4. Clicking a bar narrows the feed to that bucket's exact window (`bucketRangeIso` bounds), the URL
   changes, and browser Back restores the previous filter.
5. Dragging across bars selects the spanned range and applies it as one `dateFrom`/`dateTo` write.
6. **Faithful-stub chart test (mandatory, and the reason this criterion is spelled out).** The panel
   suites mock `@elabs-ai/components-charts` as inert no-ops — 32 files do, listed in this WP's
   verification work — so a chart wired with wrong props passes the gate silently; that blind spot is
   recorded in the ledger for 2026-07-17. Copy the pattern from
   `apps/web/src/features/dashboard/testing/time-axis-charts.test.tsx` (the `vi.hoisted()` captured-prop
   array plus a stub that re-implements the one contract that actually breaks — there, defaulting
   `xDataKey` to `"date"` and running each row through `new Date(row[xDataKey]).toISOString()`), and
   from `apps/web/src/features/dashboard/testing/datapoint-clicks.test.tsx:57-110` for the
   click-target fidelity, **including its negative control at `:548`** (a chart mounted without
   `onDatapointClick` renders no targets). For the brush, the stub must expose
   `onSelectionChange` as a real invocable handler. **Verify the stub bites: break a prop deliberately
   and watch the test go red before ticking.**
7. With a full-text query active on the feed, the strip renders an explanatory note rather than a
   series computed from a different filter (the metrics route rejects `filter.q` at
   `routes.ts:66-68`).
8. The strip does not shift the table's layout on load — a placeholder of the eventual height is
   reserved (`.claude/rules/loading-states.md`).
9. Both themes and a keyboard pass: the metric selector is reachable, bars are focusable or an
   equivalent keyboard path to the same filtering exists — or recorded as an owner-acceptance line
   rather than claimed.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
