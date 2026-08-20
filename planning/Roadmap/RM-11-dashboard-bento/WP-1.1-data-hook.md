---
type: "Work Package Spec"
title: "WP 1.1 \u2014 use-overview-data (the Overview tab's data layer)"
description: "Produce the OverviewData declared in"
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.1 — `use-overview-data` (the Overview tab's data layer)

Produce the `OverviewData` declared in
`apps/web/src/features/dashboard/overview/overview-contract.ts` (already committed — read it first;
it is the contract WP 1.2/1.3 build their tiles against, in parallel with you).

## Goal

One hook, `useOverviewData(range)`, that fills every section of `OverviewData` from **existing**
endpoints. **No new API endpoint. No migration. No new dependency.**

## Files

- `apps/web/src/features/dashboard/overview/use-overview-data.ts` (+ `.test.ts`)
- `apps/web/src/features/dashboard/overview/overview-derive.ts` (+ `.test.ts`) — put every pure
  derivation here, React-free, so it is testable without rendering. Mirrors
  `features/dashboard/testing/metrics-derive.ts`.
- `apps/web/src/lib/api.ts` — **additive only** if a wrapper is genuinely missing.

**Do NOT touch** `overview-contract.ts` (shared), any file under `overview/tiles/` (WP 1.2/1.3),
`OverviewTab.tsx` or `DashboardView.tsx` (WP 1.4), or anything under `features/dashboard/testing/`.

## Sources (all existing — verify each against `apps/web/src/lib/api.ts`)

| Section | Source |
| --- | --- |
| `footprint` | `GET /api/metrics/scans` (`getScanMetrics`) — per (server, tokenProfile) points with `totalTokens`/`toolTokens`/`resourceTokens`/`promptTokens`/`deltaTotalTokens`/`deltaComparable` |
| `runHealth` | `GET /api/metrics/runs` (`getRunMetrics`) — measures `count`, `errorRate`, `costUsd` |
| `attention` | `GET /api/issues` (`useFleetIssues`/`listIssues`) + the `servers`/`scans` already loaded by `App.tsx` |
| `advisor` | `GET /api/advisor/report?scope=fleet` (`getAdvisorReport`) |

## The traps — Phase 0 shipped defects on three of these

1. **Cost fans out per capability class.** `costUsd` returns ONE SERIES PER `capabilityClass`
   (`api_exact` / `subscription_reference` / …). Map each to its own `CostBasisFigure`. **Summing
   them is a defect, not a simplification** (D-OB14).
2. **Empty buckets are omitted, never zero-filled.** Densify the x-axis yourself before handing a
   series to a tile, or a sparkline will lie about cadence. `metrics-derive.ts` already solves this —
   reuse its approach rather than re-deriving it.
3. **A delta must cover the same population as its value.** This is the exact defect WP 0.3 shipped:
   summing Δ only over servers that *have* a previous scan, beside a value totalling *all* servers,
   made a 100,000→590,000 fleet growth render as a favorable shrink. Compute `deltaTokens` over the
   same population as `totalTokens`, with a first-measured server contributing its whole figure, and
   report `firstTimeServers` so the tile can disclose it. `value − delta` must always equal the
   fleet's previous measured total.
4. **`deltaComparable: false` means REFUSE to subtract** (different `counting_version` / no success
   scan) — surface `null`, never `0`. A `0` reads as "nothing moved".
5. **`feedbackRate` is permanently unavailable** — do not design around it.
6. **No rollup cache**; budget is <500 ms per metrics call. Fetch the sections in parallel, abort
   in-flight requests when `range` changes, and do not fan out one request per server.

## Acceptance

- [ ] `useOverviewData(range)` returns `OverviewData`; every section independently reaches
      `loading → ready | empty | error` and an error in one section never blanks the others.
- [ ] `costByBasis` has one entry per capability class present; a test proves two bases are **never**
      summed.
- [ ] `deltaTokens` covers the same population as `totalTokens`; a test uses the fixture
      `A@Jan 100000 → A@Feb 90000 → B added @Mar 500000` and asserts the delta is `+490000`
      (**not** `-10000`) with `firstTimeServers === 1`.
- [ ] A non-comparable delta (`deltaComparable: false`, or no prior scan anywhere) yields `null`.
- [ ] Series handed to tiles are densified; a gap in the source produces a real gap, not a shifted point.
- [ ] Requests abort on `range` change (test the abort, not just the happy path).
- [ ] All derivation is pure and unit-tested in `overview-derive.ts` without rendering.
- [ ] Gate green from the repo root **except** the 2 pre-existing api failures noted below.

## Not in scope
Any tile or JSX (WP 1.2/1.3). The tab shell or routing (WP 1.4). Any API change.
