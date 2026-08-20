---
type: "Work Package Spec"
title: "WP 3.5 \u2014 KPI rail + context-window chart"
description: "Phase: 3 \u00b7 Size: L \u00b7 Depends on: 3.3, 0.1"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.5 — KPI rail + context-window chart

**Phase:** 3 · **Size:** L · **Depends on:** 3.3, 0.1

## Objective
The right-pane top zones: live KPI counters and the context-window timeline — the feature's
centerpiece.

## Why / references
UI concept [`../10-…ui-concept.md`](../../../Research/RS-11-testing-ui-concept/notes/testing-ui-concept.md) **§4 Zone A** (KPI rail wireframe)
and **§4 Zone B** (context-window chart wireframe). Data model:
[`../references.md`](../references.md) → *Braintrust — token usage* (utilization %, composition,
per-step) and *Klipfolio* (critical metric upper-left, 5–10 KPIs). Chart lib = `@elabs-ai/components-charts`
(WP 0.1). Events `kpi` + `step.context` from WP 1.4/2.2.

> **Reframed (doc 12):** this becomes the persistent **KPI strip** + the **Timeline** panel
> ([`../../12-testing-inspector-devtools.md`](../12-testing-inspector-devtools.md) §2, §3.3).
> `@elabs-ai/components-charts` is now **vendored** — build the KPI strip on `MetricGrid` and the context chart on
> `AreaChart`/`LiveLineChart`/`ComposedChart` (no fallback needed).

## Files (new)
- `apps/web/src/features/testing/KpiRail.tsx`
- `apps/web/src/features/testing/ContextChart.tsx`

## Design — KPI rail (UI §4 Zone A)
A 3-up grid of `MetricCard` (extend `components/TokenViz.tsx`), `tabular-nums`, fed by `RunEvent {kpi}`:
**Context %** (headline, upper-left), **Tokens ↑**, **Tokens ↓**, **Tool calls**, **Turns (x/max)**,
**Est. cost** (label it *estimated*, WP 1.5). `Tokens` cards show provider-actual with an "est. Δ"
affordance when an estimator lens diverges (WP 1.4).

## Design — context chart (UI §4 Zone B)
- **Stacked area** over step/turn index: series = `system / tool_defs / history / tool_results /
  output` from each `ContextSnapshot`, colored **only** with `--chart-1..5` (theme-aware).
- A horizontal **limit line** at the model's context max; a utilization % badge.
- **Event markers:** tool-result injections, native context-management actions (decision #3), and the
  **overflow point** (destructive token) if `outcome:"context_overflow"`.
- Hover → composition breakdown tooltip. Replay (WP 3.7) drives a **playhead**.
- Start from the **turn-0 baseline** (system + tool defs) so the static footprint is visible before
  the model speaks (set up by WP 3.3 pre-run).

## Gaps / fallback (UI §11)
If `@elabs-ai/components-charts` can't cleanly render a streaming stacked-area + limit line, compose a constrained
renderer from `@elabs-ai/components-ui` `Progress`/primitives the way `TokenViz` is built — record the decision
here. Throttle updates to animation frames during streaming (`.claude/rules/interaction-guidelines.md`).

## Acceptance
- Counters tick live during a run; Context % matches the chart total / limit.
- The chart fills per turn, shows composition + the limit line, marks overflow, and starts from the
  turn-0 footprint baseline.
- Reads correctly in BOTH `light` and `dark` (where low-contrast fills can fail); `tabular-nums`
  everywhere.
- Gate: typecheck + build green; manual check at `http://localhost:8080`.
