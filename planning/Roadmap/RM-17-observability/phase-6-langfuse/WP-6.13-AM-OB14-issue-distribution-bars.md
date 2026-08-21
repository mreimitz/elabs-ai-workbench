---
type: "Work Package Spec"
title: "WP 6.13 (AM-OB14) — give the issue-list trend bars a real time axis"
description: "The issue list already renders per-row bars; they discard the day keys, so gaps vanish and rows are not comparable. This is the smallest residual in Phase 6 and a strong drop candidate."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.13 (AM-OB14) — give the issue-list trend bars a real time axis

## Verification finding

**More of this is built than the amendment credits. The issue list already has per-row bars. What it
does not have is a time axis under them.**

Already built:

- **The occurrence-over-time chart exists**, as the amendment says, but it lives in the **detail
  sheet**, not the list: `apps/web/src/features/issues-fleet/IssueOccurrencesPanel.tsx`, mounted at
  `IssueDetail.tsx:90`. It is a categorical `BarChart` (`:138-166`) with `xDataKey="bucketLabel"` — a
  formatted **string** x, justified at `:133-134` ("`BarChart` is the CATEGORICAL chart … unlike
  Line/Area/Composed, which need real `Date`s"). Bucket-aware labels are real:
  `formatOccurrenceBucketLabel` (`:49-61`) renders `hour` → "Jul 14, 3 PM", `week` → "Wk of Jul 14",
  `day` → "Jul 14"; `resolveIssueBucket` (`:19-27`) adapts ≤2 days → hour, ≤60 days → day, else week.
  Its data comes from `getRunMetrics({ filter: buildIssueRunFilter(issue), bucket, measures: ["count"] })`
  (`:71-74`) — the shared metrics endpoint, **not** the issue's own `fleet.trend`. Empty buckets are
  never zero-filled (`:127-128`). It drills through: `onDatapointClick` → `bucketRangeIso` →
  `drillDownHref` → the runs feed scoped to that bucket (`:145-151`).
- **The issue LIST already renders a per-row bar chart.** `IssueTriageTable.tsx` imports
  `IssueSparkline` (`:9`) and adds a **Trend** column at `:99-109`, gated by `hasTrendData` (`:55`) so
  the column disappears entirely when no issue has trend data. `IssueSparkline.tsx:14-30` renders
  `<Sparkline values={sparklineValues(issue)} variant="bar" width={72} height={24} label={…} />`, with
  an em-dash when there are no values.
  Full column list: title, lifecycle, occurrences, trend (conditional), firstSeen, lastSeen, affected,
  bucket, timesSeen — nine columns on a non-virtualized `DataTable`.
- **The data is already on the wire, per issue.** `RatingIssueFleet.trend: RatingIssueTrendPoint[]`
  (`packages/shared/src/types.ts:4605-4619`), where `RatingIssueTrendPoint = { day: string; count: number }`
  (`:4591-4595`), hanging off `RatingIssue.fleet?` (`:4568`). Derived server-side by
  `recomputeFleetDerived(issueId)` (`apps/api/src/grading/issue-repository.ts:422-457`), which buckets
  `observed_at ?? created_at` by `iso.slice(0, 10)` (`:433`), sorts ascending and stores `trend_json`
  (parsed back `:678`). The list route already returns it (`listAllIssues`,
  `apps/web/src/lib/api.ts:1470`).

The actual defect:

- **`sparklineValues()` throws the day keys away.** `apps/web/src/features/issues-fleet/issue-lib.ts:141-143`
  maps `point.count` and drops `point.day` entirely. Because `trend` is **sparse** — only days with at
  least one occurrence appear — the resulting bars sit adjacent regardless of the gaps between them.
  An issue that fired on three consecutive days and one that fired on three days spread over a month
  render **identically**. There is no time axis, no shared domain across rows, and therefore no
  row-to-row comparability, which is the entire point of a distribution bar.
- **`Sparkline` upstream cannot fix this.** `SparklineProps` (`@elabs-ai/components-charts@4.0.0`
  `.d.ts:3924-3937`) is `values: number[]`, `variant?: "bar"|"line"`, `emphasizeLast?`, `label?`,
  `width?`, `height?` — **no x-domain, no gap semantics, no per-bar tooltip, no click**. Passing a
  padded array with zeros would be a lie under conventions §2 (a zero bar reads as "we looked and there
  were none", a gap reads as "nothing happened"), so the fix is a different composition, not a
  different prop.
- **Granularity is hard-coded to day.** `trend` has no hour or week variant and the issues routes take
  no bucket parameter. The detail panel's per-issue `getRunMetrics` call is the flexible alternative,
  but that is **one HTTP request per issue**, which does not scale to a table.

**Verdict: PARTIALLY BUILT — residual only.**

Residual: pad the sparse `trend` onto a shared, gap-honest time domain derived client-side from the
`day` keys that are already present but discarded, and render it as bars that are comparable
row-to-row. That is one pure function plus one small component swap.

**This is the strongest drop candidate in Phase 6 after AM-OB3.** The list already shows a trend bar
per row; what is missing is comparability, which matters only when an operator is scanning many issues
at once. If Phase 6 needs trimming, drop this one and keep the detail panel's honest chart.

## Goal

Afterwards two rows of the issue list can be compared at a glance: bars sit on the same time axis, a
week with no occurrences is a visible gap rather than a vanished column, and "this one is flaring up
now" is distinguishable from "this one fired three times last spring".

## Scope

- **`apps/web/src/features/issues-fleet/issue-lib.ts`** — replace `sparklineValues()` (`:141-143`)
  with a pure function that keeps the `day` keys, derives a **shared domain across the visible rows**
  (so every row's bars align), and returns a series that marks empty buckets as **absent** rather than
  zero. Unit-test it directly; this is where the whole item's correctness lives.
- **`apps/web/src/features/issues-fleet/IssueSparkline.tsx`** — render that series. Upstream
  `Sparkline` cannot express gaps or a domain, so compose a minimal `BarChart` following the pattern
  `IssueOccurrencesPanel.tsx:138-166` already proves (categorical x, bucket-aware labels via the
  exported `formatOccurrenceBucketLabel` at `:49-61`, `Bar fill="var(--chart-1)"`). **Reuse that
  formatter — do not write a second one.** Keep the cell small; a table cell is not a panel.
- **Keep the `hasTrendData` gate** (`IssueTriageTable.tsx:55`) so the column still disappears when no
  issue has data, and keep the em-dash empty state.
- **Cheap by construction:** derive everything from the `trend` already returned by
  `GET /api/issues`. **No per-row HTTP request** — the per-issue `getRunMetrics` pattern the detail
  panel uses is correct for one issue and wrong for a table.
- If a hover value is added, it must be reachable by keyboard, not hover-only.

## Files

Modify:

- `apps/web/src/features/issues-fleet/issue-lib.ts`
- `apps/web/src/features/issues-fleet/issue-lib.test.ts`
- `apps/web/src/features/issues-fleet/IssueSparkline.tsx`
- `apps/web/src/features/issues-fleet/IssueTriageTable.tsx` (pass the shared domain down)
- `apps/web/src/features/issues-fleet/IssueTriageTable.test.tsx` — note this suite is **already
  semi-faithful** (`:7-11` echoes `Sparkline`'s `values` into `data-values`, so trend content is
  assertable); keep that property when the component changes.

Untouched on purpose: `apps/web/src/features/issues-fleet/IssueOccurrencesPanel.tsx` (correct as it
stands — import its formatter, do not edit it), `apps/api/src/grading/**`, `packages/shared/**`,
`apps/api/src/db/**`.

**This item is file-disjoint from every other Phase 6 item** — it is safe to batch with anything.

## Non-goals

- **Explicitly out of scope: embedding-scatter topic visuals.** Clustering stays **deterministic over
  the forensics buckets** — this is a locked position, restated by the amendment and by the research
  bundle, which calls Braintrust's embedding scatter "the expensive showpiece we don't need"
  (`planning/Research/RS-05-langfuse-landscape/notes/03-charts-viz-inventory.md`, Cross-cutting §5). No
  embeddings, no dimensionality reduction, no topic model, no new dependency for any of that. This WP
  must not become a foothold for it.
- **No zero-filling to fake a continuous series.** A padded zero is a different claim from a gap
  (conventions §2).
- No per-row HTTP request, and no new endpoint or bucket parameter on the issues routes.
- No change to the day granularity of `recomputeFleetDerived` — hour/week variants would be a server
  change for a 72-pixel cell.
- No change to the detail panel's chart.
- No new column on the issue table; this upgrades the one that is already there.

## Dependencies

- Depends on shipped WP 5.1 (issue aggregation, which derives `trend`) and WP 5.3 + the post-acceptance
  Issues-tab redesign (which built the table and the occurrence panel) — all done.
- No dependency on any other Phase 6 item. File-disjoint from all of them.

## Migration

**None.** Web-only, over data the API already returns. `apps/api/src/db/{database,schema}.ts` must be a
zero-line diff.

## Acceptance

1. Two issues with the same total occurrence count but different distributions over time render
   **visibly differently** in the list — asserted by a test on the pure derivation, not by eyeballing.
2. Bars across the visible rows sit on a **shared domain**, so a bar at the same horizontal position
   means the same date in every row.
3. A period with no occurrences renders as a **gap**, and a test asserts the derivation emits an
   absent marker rather than a `0` for it.
4. The derivation reads only the `trend` already present on the issue; a test asserts **no additional
   fetch per row**.
5. The `hasTrendData` gate and the em-dash empty state still behave as today.
6. **Faithful-stub chart test (mandatory).** The Issues suites mock `@elabs-ai/components-charts` as
   inert no-ops — `IssueDetail.test.tsx:9` stubs `Sparkline: () => null` and `BarChart` as a bare div,
   `IssuesFleetTab.test.tsx:24` and `IssueOccurrencesPanel.test.ts:7` likewise — the blind spot recorded
   in the ledger for 2026-07-17. Follow
   `apps/web/src/features/dashboard/testing/time-axis-charts.test.tsx` (`vi.hoisted()` captured props +
   a stub re-implementing the one contract that actually breaks) and keep
   `IssueTriageTable.test.tsx:7-11`'s existing property of echoing the values into the DOM so content
   stays assertable. The stub must capture the x-domain and the per-row series so criteria 2 and 3 are
   provable through the component, not only through the pure function. **Verify the stub bites: break a
   prop deliberately and watch it go red before ticking.**
7. No embeddings, no scatter, no dimensionality reduction, and no new runtime dependency —
   verifiable from the diff.
8. Both themes and a keyboard pass over the trend cell, including any hover value, which must have a
   keyboard-reachable equivalent — or recorded as an owner-acceptance line rather than claimed.
9. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
