---
type: "Work Package Spec"
title: "WP 6.3 (AM-OB3) — the last two unaddressable pieces of dashboard chart state"
description: "Tab, time range and chart drill-down are already URL-addressable; this closes the residual — a URL-persisted bucket granularity and a panel-level anchor."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.3 (AM-OB3) — the last two unaddressable pieces of dashboard chart state

## Verification finding

**Most of this item shipped. Two narrow pieces did not, and one of them has no UI control to be
addressable *from*.**

Already built:

- **Tab** — `apps/web/src/features/dashboard/DashboardView.tsx:104-123`. Tabs are
  `["overview", "testing", "issues"]` (`:31`); `DEFAULT_TAB = "overview"` (`:33`) is deliberately
  omitted from the URL (`:113-115`); `RETIRED_TABS` (`:41`) maps `?tab=scans → overview` and an effect
  strips the stale param (`:125-137`). (Note for anyone reading the old plan: there is **no `ScansTab`
  component any more** — the scans surface is `ScansStripPanel` inside `TestingTab` plus Overview
  tiles.)
- **Time range, page-level and shared by all three tabs** —
  `apps/web/src/features/dashboard/dashboard-range.ts:57` `DASHBOARD_RANGE_KEY = "range"`. The contract
  is `?range=24h|7d|30d` (a trailing preset stored as a *token*, so a shared link does not silently
  age) or `?range=2026-08-01..2026-08-14` (a pinned custom range); the default `7d` writes nothing.
  `parseDashboardRange` `:177`, `writeDashboardRange` `:193`, `resolveDashboardRange` `:242`; legacy
  `?oRange=`/`?tFrom=`/`?tTo=` are read-only compatibility keys (`:60`, `:180-184`). Wired at
  `DashboardView.tsx:143-152` and passed to every tab as a resolved prop.
- **Testing-tab facets** — `?tGroupBy`, `?tProvider`, `?tServer`, `?tEnv`, `?tSuite`, `?tModel`
  (`apps/web/src/features/dashboard/testing/dashboard-url-state.ts:83-90`, parse `:116`, write `:147`,
  consumed at `TestingTab.tsx:66-76`).
- **Issues tab** — `?issue=<id>` opens the detail Sheet
  (`apps/web/src/features/issues-fleet/IssuesFleetTab.tsx:34-36, 150, 217`).
- **Drill-down carries full, self-describing filter state.** `TestingTab.tsx:131`
  `onDrill = (filter) => navigate(drillDownHref(filter))`; `drillDownFilter`
  (`dashboard-url-state.ts:235`) composes the facets (`baseRunFilter` `:176`) + the resolved window as
  `dateFrom`/`dateTo` (`metricsWindow` `:196`) + the clicked dimension; `drillDownHref` (`:250`)
  produces `/testing/runs?filter=<serializeRunFilter(...)>` — the **same** codec `RunsView` parses, so
  hydration is byte-for-byte (`run-filter-url.test.ts:84`). `bucketRangeIso` (`:258`) narrows the
  window to exactly the clicked bar. Per-panel click surfaces exist on error rate, cost, cache,
  duration, tokens, score trend, guardrail stops and both leaderboards.

Not built:

- **Bucket granularity is derived-only and has no URL key and no UI control.** `resolveBucket`
  (`dashboard-url-state.ts:220`) computes `hour | day | week` purely from the window span (≤2d → hour,
  ≤60d → day, else week) and is called inside the data hook
  (`use-testing-dashboard-data.ts:124`). There is **no `tBucket` key**. You cannot deep-link "this
  range, but hourly" — and you cannot *choose* it in the UI either, so there is currently no state to
  serialize.
- **No panel-level address.** No `?panel=` param, and `panel-shell.tsx` sets no element `id` and no
  scroll anchor (grep returns nothing). You cannot link someone to a specific panel on a long tab.
- **No custom-chart address.** Custom charts are DB-persisted rows (`CustomChartsSection.tsx:36`) but
  carry no URL identity.
- **`OverviewTab` reads no search params at all** (grep for `searchParams|params.get|navigate(` in
  `overview/OverviewTab.tsx` returns nothing); it consumes the resolved `range` prop only. Its tiles do
  emit hrefs (e.g. `overview-derive.ts:625` → `/dashboard?tab=issues&issue=…`).
- **The prebuilt panels are stateless**, so there is genuinely almost no per-panel selection to
  serialize: a `useState` sweep across `apps/web/src/features/dashboard/**/*.tsx` finds local state
  only in `ChartComposerDialog.tsx:87-91,498`, `CustomChartsSection.tsx:36-45` (dialog plumbing) and
  `WaitingForYouCard.tsx:24` (a fetched count).

**Verdict: PARTIALLY BUILT — residual only.**

Residual, and it is small: (1) a bucket-granularity **control** plus its `?tBucket=` key — note the
control does not exist, so this is a new affordance, not just serialization; (2) a panel-level anchor
(`?panel=<id>` + stable ids on `panel-shell` + scroll-into-view on load), which also gives custom
charts an address for free if their id is the anchor.

**If the owner wants to trim Phase 6, this is the cheapest item to drop.** The operator-visible promise
— "send someone a link to what I am looking at" — is already met by `?tab=` + `?range=` + the facet
params + a drill-down link that carries the exact clicked bucket. What remains is a convenience
(jump-to-panel) and a capability the UI does not yet offer at all (choosing a bucket).

## Goal

Afterwards an operator can send a link that lands the reader on a *specific panel* of the dashboard,
already scrolled to it, and can override the automatically-chosen time bucket — so "look at the error
rate panel, hourly, over last Tuesday" is one pasteable URL instead of four spoken instructions.

## Scope

- **`apps/web/src/features/dashboard/testing/dashboard-url-state.ts`** — add an optional `tBucket`
  key. `resolveBucket` (`:220`) keeps its span-derived value as the **default**; the param overrides it
  when present and valid. An out-of-range override (hour buckets over a 90-day window) must be clamped
  or refused with a visible note, never silently used to build a query that returns thousands of
  buckets.
- **A bucket control in the Testing-tab toolbar** — a small `Select`/`SegmentedField` (brand-ui only)
  beside the existing controls, defaulting to "Auto" so today's behaviour is what an untouched
  dashboard still does and the param stays absent.
- **`apps/web/src/features/dashboard/testing/panel-shell.tsx`** — give each panel a stable `id`
  derived from a panel key, and render a copy-link affordance in the panel header (`IconButton` per
  `.claude/rules/icon-affordances.md`).
- **`apps/web/src/features/dashboard/DashboardView.tsx`** — read `?panel=`, and on mount scroll that
  panel into view. A `?panel=` naming an unknown panel is ignored silently; it must never blank the
  page or clear the tab.
- **Custom charts** inherit the anchor by using their persisted row id as the panel key.

## Files

Modify:

- `apps/web/src/features/dashboard/testing/dashboard-url-state.ts`
- `apps/web/src/features/dashboard/testing/dashboard-url-state.test.ts`
- `apps/web/src/features/dashboard/testing/use-testing-dashboard-data.ts`
- `apps/web/src/features/dashboard/testing/panel-shell.tsx`
- `apps/web/src/features/dashboard/TestingTab.tsx` (the toolbar row)
- `apps/web/src/features/dashboard/TestingTab.test.tsx`
- `apps/web/src/features/dashboard/DashboardView.tsx`
- `apps/web/src/features/dashboard/DashboardView.test.tsx`
- `apps/web/src/features/dashboard/testing/CustomChartPanel.tsx` (pass the row id as the panel key)

Untouched on purpose: `apps/web/src/features/dashboard/dashboard-range.ts` (the `?range=` contract is
correct and carries legacy compatibility — do not reopen it), all of `packages/shared/**`, all of
`apps/api/**`.

## Non-goals

- No change to `?range=`, `?tab=`, the six `t*` facet params, or `drillDownHref`. Those are shipped,
  tested, and shared with the runs feed.
- No panel reordering, no drag-and-resize grid, no dashboard-layout persistence. Langfuse's
  react-grid-layout dashboards are explicitly not being imported.
- No per-panel time range (the page has **one** clock by owner decision — see the
  `dashboard-range.ts:1-14` module doc recording that "one page, three clocks" was the defect this
  replaced). A bucket override is a resolution control, not a second window.
- Not the runs feed's URL state; that is AM-OB1.

## Dependencies

- Depends on shipped WP 2.1 (dashboard tabs) and WP 2.2 (panels + drill-down), plus the
  dashboard-bento work that unified the range control — all done.
- No dependency on any other Phase 6 item.
- File-disjoint from every other Phase 6 item **except** AM-OB7, which also edits under
  `apps/web/src/features/dashboard/testing/`. AM-OB7 touches the composer files
  (`ChartComposerDialog`, `CustomChartCanvas`); this WP touches `panel-shell` + the toolbar; they
  overlap only on `CustomChartPanel.tsx`. Batching them is possible but should be a deliberate choice.

## Migration

**None.** Web-only. `apps/api/src/db/{database,schema}.ts` must be a zero-line diff.

## Acceptance

1. A bucket control exists in the Testing-tab toolbar, defaults to "Auto", and choosing a non-auto
   value writes `?tBucket=`; reloading restores it. "Auto" writes no param, so an untouched
   `/dashboard?tab=testing` URL is byte-identical to today's.
2. A bucket that would produce an unreasonable number of points for the active window is clamped or
   refused **visibly** — never silently honoured.
3. Every panel has a stable `id` and a copy-link affordance; opening the copied URL in a fresh tab
   lands on the right tab, range and panel, scrolled into view.
4. `?panel=` naming an unknown or removed panel is ignored without clearing the tab or range.
5. A custom chart's panel link uses its persisted row id and survives a reload.
6. Existing drill-down click-through still produces a byte-identical `/testing/runs?filter=…` URL
   (`run-filter-url.test.ts:84` still passes unchanged).
7. Both themes and a keyboard-only pass over the bucket control and the copy-link affordance (tooltip
   text == `aria-label`, per D-TB5) — or recorded as an owner-acceptance line rather than claimed.
8. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
