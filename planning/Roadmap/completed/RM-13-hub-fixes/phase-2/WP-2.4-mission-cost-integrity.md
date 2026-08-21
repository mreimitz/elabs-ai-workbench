---
type: "Work Package Spec"
title: "WP 2.4 \u2014 mission cost/budget integrity"
description: "Phase: 2 \u00b7 Size: M \u00b7 Depends on: 2.1 \u00b7 Model: Sonnet \u00b7 Agent profile: API + board"
tags: ["roadmap", "RM-13"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.4 — mission cost/budget integrity

**Phase:** 2 · **Size:** M · **Depends on:** 2.1 · **Model:** Sonnet · **Agent profile:** API + board

## Objective

Mission budgets become real: per-agent cost/tokens come from the session runner, the budget trip
actually fires, the board and usage views show true spend, and the planner's estimate is a stated
heuristic instead of `0`.

## Why / evidence

`analysis.md` side findings: the old runner hardcoded `costUsd: 0`; live mission shows
`costUsd: 0`, `estimatedCostUsd: 0` while the card advertises "budget $2.00"; session-level
`costUsd/tokensIn/tokensOut` stayed `0` for the mission turn. `isBudgetTripped` can never trip on
zeros (`topologies.ts` context), so `maxCostUsd` is decorative.

## Design

- Runner already returns real numbers after WP 2.1: aggregate them onto the mission row per report
  (existing `updateMission` path) and roll child-session usage into the parent's usage views
  (`hub/usage.ts` buckets gain nothing new; verify child sessions are counted — they are sessions).
- Budget trip: evaluate against accumulated real cost incl. the running agent's session totals
  (poll the child session row at slot boundaries; no mid-turn kill beyond the existing abort seam).
- Planner estimate: simple stated heuristic (agents × per-agent token envelope × model rate from
  the existing cost basis) labeled "estimate" on the card; never `0` for a non-empty plan.
- Board: budget bar shows spent/max from real numbers; per-agent cards show their session cost.

## Files (exclusive)

- `apps/api/src/hub/missions/orchestrator.ts` (aggregation + trip check), `missions/planner.ts` (estimate), `missions/topologies.ts` (trip evaluation seam only)
- `apps/web/src/features/hub/MissionBoard.tsx` (spend display; coordinate with WP 4.2/4.3 batches)
- Tests: trip fires at threshold (stub costs), aggregation math, estimate > 0, board rendering

## Acceptance

- [ ] Stubbed mission where agent costs cross `maxCostUsd` ⇒ topology stops early, mission marked partial with the existing budget-trip semantics.
- [ ] Mission + parent usage reflect child session totals (rollup test).
- [ ] Plan estimate non-zero + labeled; board shows real spend per agent and total.
- [ ] Gate green.
