---
type: "Documentation"
title: "Observability"
description: "How the workbench monitors its own fleet of runs: metrics over time, search, watch rules and issues."
tags: ["documentation", "DC-11"]
timestamp: "2026-08-21T15:31:35Z"
status: "current"
---

# Observability

## Subject

How the workbench monitors its own fleet of runs: metrics over time, search, watch rules and issues.

## Scope

**In:** The dashboard tabs, the runs feed, saved views and the filter grammar, console depth, watch rules, notifications and fleet issues.

**Out:** The rating of an individual run, which is the benchmarks subject.

## Where the code lives

- `apps/api/src/observability/`
- `apps/web/src/features/observability/`

## Delivered increments

### RM-11 — Dashboard bento — the homepage Overview

Completed 2026-08-21. Roadmap item: [RM-11](/Roadmap/completed/RM-11-dashboard-bento/item.md).

**Shipped:** The dashboard landing surface rebuilt on the bento grid across 12 work packages (Phases 0-2). Phase 0 switched on four capabilities the design system already shipped and the app never used: the chart series ramp now cycles all twelve --chart-* tokens instead of five, chart onDatapointClick drill-through is enabled and the stale workaround retired, and metric tiles carry trend + sparkline with one featured tile. Phase 1 made Overview the default tab: a hero footprint chart, KPI tiles, and attention/movers/advisor list tiles, all derived client-side by use-overview-data with NO new API endpoint, inside a BentoGrid shell. Phase 2 answered owner feedback: scan-inventory tiles (Servers, Tools scanned, Resources, Prompts) with both tables as bento tiles, ONE page-level toolbar in the correct order with a shared timeline and Scans merged in (spotlight removed), the fleet footprint plotting every server held at its last successful scan rather than only recently-scanned ones, and footprint lines differentiated by STROKE pattern rather than colour alone (D-DB4).

**Planned vs delivered:** Phase 1 needed an unplanned close-out work package (WP 1.5) for three defects a real browser found that jsdom could not. Phase 2 did not exist in the original plan at all; it was added on 2026-08-20 in response to owner feedback on the shipped Phase 1 surface, and contributed four of the twelve work packages.

**Known gaps:** The item carries no owner-acceptance section, so no live both-theme or keyboard walk of the Overview tab was ever recorded as a gated item. The surface was exercised in a browser during the WP 1.5 close-out and during the Phase 2 owner-feedback round, but there is no signed checklist for it.

**Where the code lives:**

- `apps/web/src/features/dashboard/overview/ (OverviewTab.tsx, use-overview-data.ts) and apps/web/src/features/dashboard/ (DashboardView.tsx, DashboardRangeControl.tsx, dashboard-range.ts)`

### RM-33 — Cache-aware token accounting & display

Completed 2026-08-21. Roadmap item: [RM-33](/Roadmap/completed/RM-33-cache-aware-token-accounting/item.md).

**Shipped:** The prompt-cache composition (uncached / cache read / cache write) behind every token and cost figure: run console tiles, tooltips, context popover and relationship note; Trace, Turns and Steps; the runs feed plus an opt-in Cache hit column; suite rollups; a three-series Analytics stack; the Testing dashboard's Prompt cache panel; three observability measures the chart composer and watch-rule editor inherit automatically; JSON and Markdown reports; the compare workspace and export; and the workbench MCP run summary. Migration v59 adds two nullable runs columns and backfills them from per-step data, recovering 141 of 163 real runs. The run-plan cost preview became cache-aware, and computeCostBreakdown is now the app's single cost formula.

**Planned vs delivered:** The accounting was already correct — cost had always priced a cache read at ~0.1x and a write at 1.25x — so the workstream became a display and roll-up problem rather than a counting fix. Three things changed shape mid-plan. WP 3.1's dashboard panel was split out as WP 3.3 rather than ticked undelivered. WP 2.1's cost band changed dimension from turns to caching, which the plan's own acceptance criterion forced. And a first cut of the v59 backfill wrote 0/0 for six merged-only runs holding 107k to 1.2M tokens of real cache; running it against a copy of the real database caught that and made the backfill a three-way decision. WP 3.1's tab-stop accessibility decision was also reversed mid-build on the linter's advice.

**Known gaps:** No hand-driven keyboard walk of the dashboard panel; its hover tooltip is unit-tested only because the dashboard chart stub no-ops ChartTooltip. The Step-log chip and compare delta rows have no two-theme or keyboard evidence. The estimate endpoint brackets a real run's cost but cannot land near it: the estimator's turn ceiling is 8 where the reference run took 19, so its absolute figures are proportionally low — the token model is now the dominant source of error and is a candidate for its own item. The DeltaMatrix table was deliberately left without cache columns, and fleet-report.ts was left alone because its aggregates are shaped differently. The judge-token aggregate asymmetry is recorded as a follow-up, not fixed.

**Where the code lives:**

- `packages/shared/src/token-usage.ts, packages/shared/src/types.ts, apps/api/src/providers/pricing.ts, apps/api/src/testing/accounting.ts, apps/api/src/db/database.ts, apps/api/src/observability/metrics.ts, apps/api/src/estimate/, apps/api/src/reports/, apps/web/src/components/TokenAmount.tsx, apps/web/src/features/dashboard/testing/CachePanel.tsx`
