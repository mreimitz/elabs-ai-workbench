---
type: "Work Package Spec"
title: "WP 3.3 — the Testing dashboard's built-in cache panel"
description: "Phase 3 of item.md. Ledger: STATUS.md. Split out of WP 3.1 rather than dropped: charts the cache measures on the dashboard, with the unavailable state instead of a fake 0%."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T15:30:00Z"
status: "final"
---
# WP 3.3 — the Testing dashboard's built-in cache panel

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Rules that bind this WP:
`.claude/rules/brand-ui-only.md`, `.claude/rules/styling-and-tokens.md` (two themes),
`.claude/rules/library-first.md`.

**Depends on:** WP 2.2 (the measures + their `unavailableMeasures` behaviour).
**Split out of WP 3.1**, which shipped the console/feed grammar but not this panel. It is an open box
rather than a silent omission.

## What already works without this WP

`RUN_METRICS_MEASURES` is the single source for BOTH the custom chart composer
(`apps/web/src/features/dashboard/testing/ChartComposerDialog.tsx:386`) and the windowed watch-rule
editor (`apps/web/src/features/watch/RuleEditorDialog.tsx:393`), and both iterate it directly — so an
operator can ALREADY compose a cache-hit-rate chart and alert on it. What is missing is the built-in
panel: the thing a person sees without first knowing to go and build it.

## Scope

### 1. Request the measures

`apps/web/src/features/dashboard/testing/use-testing-dashboard-data.ts:139` currently asks for
`["tokensIn", "tokensOut"]`. Add a request for `["cacheReadTokens", "cacheWriteTokens", "cacheHitRate"]`.

**Do not fold them into the existing tokens request.** `cacheHitRate` is a `rate` and the others are
`tokens`; the dashboard's same-unit constraint is real, and mixing them in one series bag invites a
blended axis. A separate `getRunMetrics` call is the honest shape and matches how `costUsd` and
`meanScore` are already requested separately.

### 2. Derive

Extend `apps/web/src/features/dashboard/testing/metrics-derive.ts` with a `buildCacheResult(series)`
alongside `buildTokensResult`, returning the per-bucket rows plus the capability classes present.
`cacheReadTokens`/`cacheWriteTokens` are capability-split (one series per class, D-OB14 — never
blended); `cacheHitRate` is a single unlabelled series.

### 3. The panel

A new `CachePanel` in `apps/web/src/features/dashboard/testing/`, composed from the existing
`ChartPanel`/`PanelEmptyState` shell so it matches its neighbours exactly.

- **Grouped bars, not stacked**, for read vs write — same reasoning as `TokensPanel`: stacking implies
  a meaningful sum across an accounting boundary. Label them with what they cost (`~0.1×` / `1.25×`),
  the wording WP 3.1 established.
- A hit-rate line or a second small panel, whichever reads better against the neighbours — but it must
  be visibly a RATE, not a token count.
- **Drill-down**: reuse `drillDownFilter` + `bucketRangeIso` exactly as `TokensPanel` does, so
  activating a bar opens the runs feed scoped to that bucket's window. A capability class is an
  accounting facet, not a `RunFilter` dimension — it stays out of the filter (the `TokensPanel`
  precedent; do not invent a "runs with cached tokens" filter).
- Colours come from the `--chart-*` ramp via `chartSeriesColor`/`chartSwatchStyle`. **No raw colours.**
- Register it in the dashboard's Testing tab beside `TokensPanel`.

### 4. The unavailable state — the load-bearing requirement

When the API returns the measures in `unavailableMeasures` (a window whose runs all predate migration
v59), the panel renders an explicit "not measured for these runs" state.

**It must never render a 0% line, and never an empty chart that reads as "no runs".** A 0% cache-hit
line is indistinguishable from a caching regression, which is the single most misleading thing this
panel could do. Check how the existing panels surface an unavailable measure and follow it; if none
does, `PanelEmptyState` with honest copy is correct.

## Out of scope

New measures, new filters, any API change (WP 2.2 already shipped the endpoint), the chart composer
and the watch-rule editor (both already inherit the measures).

## Acceptance

1. The Testing dashboard renders a cache panel beside the Tokens panel, in **both themes**, verified
   against the RUNNING app — not a mock, not a test.
2. Read and write are visually distinct and each is labelled with its rate multiplier.
3. A window whose runs have no known split renders the unavailable state. **A test proves it renders
   neither a 0-valued point nor a bare empty chart** — break it deliberately and watch it go red.
4. Activating a bar drills into the runs feed scoped to that bucket, and the capability class does NOT
   enter the filter.
5. No raw colour literal; `pnpm exec brand-ui audit` clean on the changed files.
6. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
