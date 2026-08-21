---
type: "Roadmap Item"
title: "Cache-aware token accounting & display"
description: "Surface the prompt-cache composition (uncached / cache read / cache write) behind every token and cost figure in the app, roll the split up onto runs and suites so it is filterable and chartable, and make the launch cost preview cache-aware."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T11:54:11Z"
status: "done"
---

# Cache-aware token accounting & display

## Goal

Surface the prompt-cache composition (uncached / cache read / cache write) behind every token and cost figure in the app, roll the split up onto runs and suites so it is filterable and chartable, and make the launch cost preview cache-aware.

## Why it matters

Per-step capture and cost pricing are already cache-aware, but nothing downstream shows it: the run KPI rail reports a gross Tokens-up of ~958k where a single Analytics chart reveals ~99.99% of it was served from cache. Cache reads cost 0.1x and cache writes cost 1.25x, so a merged cached number reads as savings even when it is a premium; the estimate endpoint re-prices the whole prefix every turn and over-states a cached run by roughly 3x; and cached tokens cannot be charted over time at all.

## Milestones

- [x] WP 1.1 — shared contract + `computeCostBreakdown` as the single pricing code path
- [x] WP 1.2 — emit the split on the `kpi` event, persist nullable run columns (migration 59) with backfill, roll up onto suite aggregates
- [x] WP 2.1 — cache-aware run-plan cost preview (range: cached prefix ↔ no caching)
- [x] WP 2.2 — `cacheReadTokens` / `cacheWriteTokens` / `cacheHitRate` observability measures
- [x] WP 3.1 — one token display grammar (`TokenAmount`) across console, runs feed, suites and dashboard
- [x] WP 3.2 — reports, compare export and the workbench MCP run summary
- [x] WP 4.1 — README + CHANGELOG + user-guide subject

Per-WP state is the [`STATUS.md`](./STATUS.md) ledger — authoritative. Locked decisions **D-CT1–D-CT6**
live there too.

## Linked research

- [RS-05](/Research/RS-05-langfuse-landscape/topic.md)
