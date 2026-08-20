---
type: "Work Package Spec"
title: "WP 2.1 \u2014 Scan inventory tiles + the two tables as bento tiles"
description: "Owner feedback 2026-08-20, item 3: \"Overview and scans can be merged from my perspective. Bring the"
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.1 — Scan inventory tiles + the two tables as bento tiles

Owner feedback 2026-08-20, item 3: *"Overview and scans can be merged from my perspective. Bring the
Measure tiles with graph over to the Overview tab, enhance them so they look better. the two tables
can be at the bottom end of the bento with full width grid size."*

This WP creates the **new tile components only**. WP 2.2 composes them and retires the Scans tab.

## Files (yours exclusively — all NEW)

- `apps/web/src/features/dashboard/overview/tiles/InventoryTile.tsx` (+ `.test.tsx`)
- `apps/web/src/features/dashboard/overview/tiles/LargestToolTile.tsx` (+ `.test.tsx`)
- `apps/web/src/features/dashboard/overview/tiles/FootprintTableTile.tsx` (+ `.test.tsx`)
- `apps/web/src/features/dashboard/overview/tiles/RecentScansTile.tsx` (+ `.test.tsx`)

**Do NOT edit** `OverviewTab.tsx`, `DashboardView.tsx`, `ScansTab.tsx`, `overview-contract.ts`,
`use-overview-data.ts`, or any existing tile — WP 2.2 owns all of those.

## Required exports (WP 2.2 composes against these EXACT signatures)

```ts
export function InventoryTile(props: {
  servers: ServerConfig[]; scans: ScanSummary[];
}): JSX.Element | null;

export function LargestToolTile(props: { scans: ScanSummary[] }): JSX.Element | null;

export function FootprintTableTile(props: {
  servers: ServerConfig[]; scans: ScanSummary[];
  onOpenServer: (serverId: string) => void;
}): JSX.Element | null;

export function RecentScansTile(props: {
  scans: ScanSummary[]; onOpenScan: (scanId: string) => void;
}): JSX.Element | null;
```

Each renders its own `<BentoGridItem>`. Sizes: `InventoryTile` = `md` (2×1);
`LargestToolTile` = `sm`; `FootprintTableTile` and `RecentScansTile` = `span={{ col: 4 }}`
(full width, at the bottom of the grid).

## What to bring across, and what to deliberately DROP

`ScansTab.tsx` currently renders 8 `MetricCard`s. Three would **duplicate** tiles the Overview
already has — do NOT re-render them:

| ScansTab tile | Fate |
| --- | --- |
| Total startup tokens | **DROP** — `StartupCostTile` already shows it |
| Unscanned · Failed | **DROP** — `AttentionTile` already surfaces both, with actions |
| Servers · Resources · Prompts · Tools scanned | **MERGE into `InventoryTile`** (one 2×1 tile, four figures) |
| Largest single tool | **KEEP** as `LargestToolTile` |
| "Latest server footprint" table | `FootprintTableTile`, full width |
| "Recent scan activity" table | `RecentScansTile`, full width |

## "Enhance them so they look better" — the owner's actual complaint

The current tiles render an **80×20 `Sparkline` floating in a much wider card** (I confirmed this in
the browser). Fix that:
- Let each sparkline **fill its tile's width** — `Sparkline` extends `SVGAttributes` and scales to
  its CSS box, so give it `className="h-10 w-full"` (or similar) rather than leaving the 80×20
  default adrift. Verify against the `.d.ts` before assuming.
- Keep the delta + the real figures in the accessible label.
- `InventoryTile`'s four figures each get their own small trend line; they must not become four
  cramped columns at narrow widths — wrap sensibly.

## Reuse, do not re-derive

`ScansTab.tsx` already computes every figure and both tables (`latestScansByServer`,
`buildScanDeltaIndex`, `rankedColumns`, `recentColumns`, `RESPONSIVE_TABLE_SCROLL_CLASS`,
`clickableRowTableProps`, `shouldPaginate`). **Read it and reuse its logic and its `col`/`navCol`
column helpers** — do not invent a second, subtly different footprint table. You may not EDIT
`ScansTab.tsx`; copy or extract into your own files and note what you duplicated.

Sparkline normalisation is mandatory and already solved in `ScansTab.tsx`'s `trendProps`:
`Sparkline` is **zero-baselined** (`max = Math.max(...values, 0)`, no `min`), so absolute totals draw
a flat line — normalise to the window minimum and keep real figures in the label.

`positiveIsGood` is **false** for token/resource/prompt/tool growth (more startup context is worse).

## Acceptance
- [ ] Four tiles with the exact exported signatures above, each rendering its own `BentoGridItem` at the stated size.
- [ ] Each returns `null` when it has nothing to show (no empty boxes).
- [ ] Sparklines fill their tile width and are normalised; labels carry real figures. Tested.
- [ ] Both tables keep the existing columns, row-click behaviour, pagination and responsive scroll.
- [ ] `positiveIsGood` correct (growth is bad) — tested.
- [ ] No raw colour; series via `chartSeriesColor`; semantic tokens only; reads in both themes.
- [ ] Faithful-stub test for anything passing props to a chart (the repo's chart mocks are no-ops).
- [ ] Gate delta vs the 3 pre-existing `main` failures: zero.
