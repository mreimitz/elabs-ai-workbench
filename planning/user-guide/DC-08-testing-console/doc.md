---
type: "Documentation"
title: "Testing console & run sessions"
description: "How the workbench drives MCP servers through a real LLM agent loop and what a run session looks like across every backend."
tags: ["documentation", "DC-08"]
timestamp: "2026-08-21T11:54:11Z"
status: "current"
---

# Testing console & run sessions

## Subject

How the workbench drives MCP servers through a real LLM agent loop and what a run session looks like across every backend.

## Scope

**In:** Environments and tests, launching a run, the console, streaming and run control, replay, comparing runs, and the shared session contract.

**Out:** Grading and suite mass-runs, which are the benchmarks subject.

## Where the code lives

- `apps/api/src/testing/`
- `apps/web/src/features/testing/`

## Delivered increments

### RM-29 — Unified Sessions — one session experience across every run backend

Completed 2026-08-20. Roadmap item: [RM-29](/Roadmap/completed/RM-29-unified-sessions/item.md).

**Shipped:** A run session now behaves the same way whichever backend executed it: one terminal-state table so the same cause always ends a run the same way, an additive ended terminal plus a seen marker, a stall-based clock with no default wall-clock cap (a ten-minute stall plus a wait budget ends a run as wait-expired instead of killing a long healthy run), a persisted phase with queue visibility, a per-session capability manifest that drives which console tiles appear, one status module behind every label in the app, and a cursor-resumable event stream. An OpenAI-compatible endpoint was added alongside.

**Planned vs delivered:** The plan's concept document proposed an operator-pressed extend button and treated End session as completed; the locked decisions replaced both — the clock became stall-based and ended is its own terminal state. An OpenAI-compatibility facade was built as a parallel lane and merged with the rest, which the original waves did not name. Four review-driven fix packages were inserted mid-flight after adversarial reviews found phase-coherence, replay and protocol defects.

**Known gaps:** Full editability of the stall and wait timers was deferred to a follow-up, the estimated-token tiles for the vendor backend were left as they are pending an owner call, and the live acceptance walk against a real cloud tenant — including the compatibility facade — was never run.

**Where the code lives:**

- `packages/shared/src/session-contract.ts`
- `apps/api/src/testing/`
- `apps/web/src/features/testing/`

### RM-33 — Cache-aware token accounting & display

Completed 2026-08-21. Roadmap item: [RM-33](/Roadmap/completed/RM-33-cache-aware-token-accounting/item.md).

**Shipped:** The prompt-cache composition (uncached / cache read / cache write) behind every token and cost figure: run console tiles, tooltips, context popover and relationship note; Trace, Turns and Steps; the runs feed plus an opt-in Cache hit column; suite rollups; a three-series Analytics stack; the Testing dashboard's Prompt cache panel; three observability measures the chart composer and watch-rule editor inherit automatically; JSON and Markdown reports; the compare workspace and export; and the workbench MCP run summary. Migration v59 adds two nullable runs columns and backfills them from per-step data, recovering 141 of 163 real runs. The run-plan cost preview became cache-aware, and computeCostBreakdown is now the app's single cost formula.

**Planned vs delivered:** The accounting was already correct — cost had always priced a cache read at ~0.1x and a write at 1.25x — so the workstream became a display and roll-up problem rather than a counting fix. Three things changed shape mid-plan. WP 3.1's dashboard panel was split out as WP 3.3 rather than ticked undelivered. WP 2.1's cost band changed dimension from turns to caching, which the plan's own acceptance criterion forced. And a first cut of the v59 backfill wrote 0/0 for six merged-only runs holding 107k to 1.2M tokens of real cache; running it against a copy of the real database caught that and made the backfill a three-way decision. WP 3.1's tab-stop accessibility decision was also reversed mid-build on the linter's advice.

**Known gaps:** No hand-driven keyboard walk of the dashboard panel; its hover tooltip is unit-tested only because the dashboard chart stub no-ops ChartTooltip. The Step-log chip and compare delta rows have no two-theme or keyboard evidence. The estimate endpoint brackets a real run's cost but cannot land near it: the estimator's turn ceiling is 8 where the reference run took 19, so its absolute figures are proportionally low — the token model is now the dominant source of error and is a candidate for its own item. The DeltaMatrix table was deliberately left without cache columns, and fleet-report.ts was left alone because its aggregates are shaped differently. The judge-token aggregate asymmetry is recorded as a follow-up, not fixed.

**Where the code lives:**

- `packages/shared/src/token-usage.ts, packages/shared/src/types.ts, apps/api/src/providers/pricing.ts, apps/api/src/testing/accounting.ts, apps/api/src/db/database.ts, apps/api/src/observability/metrics.ts, apps/api/src/estimate/, apps/api/src/reports/, apps/web/src/components/TokenAmount.tsx, apps/web/src/features/dashboard/testing/CachePanel.tsx`
