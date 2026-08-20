---
type: "Work Package Spec"
title: "Phase 3 \u2014 Suites & mass-run (WP specs)"
description: "Size: M \u00b7 Depends on: 1.1 \u00b7 shared + API migration"
tags: ["roadmap", "RM-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 3 — Suites & mass-run (WP specs)

## WP 3.1 — Contract + schema: suites, suite runs, run linkage
**Size:** M · **Depends on:** 1.1 · shared + API migration

**Objective:** the suite wire contract + persistence (B7), additive on runs.

**Files:** `packages/shared` (`Suite`, `SuiteConfig` `{ repetitions ≤5, maxConcurrency,
aggregateCostCapUsd?, judgeOverride? }`, `SuiteRun`, `SuiteRunStatus`
(`pending|running|completed|capped|stopped|error`), cell/aggregate shapes + zod);
migration: `suites`, `suite_tests` (ordered), `suite_scenarios`, `suite_runs`, `runs` +=
`suite_run_id`, `repetition`; `apps/api/src/suites/` (new: repository + service + routes —
suite CRUD only in this WP); tests `benchmarks-suites-contract.test.ts`.

**Acceptance:** suite CRUD round-trips (ordered tests, scenario set, config validated: reps 1–5,
concurrency 1–8); existing runs unaffected by the migration (NULL linkage); deleting a suite
does NOT cascade child runs of past suite runs (runs are history — same principle as
`run_steps.server_id`); gate green.

## WP 3.2 — Orchestrator: cells, concurrency, cap, SSE, stop
**Size:** L · **Depends on:** 3.1 · API

**Objective:** mass-run execution (B8) without touching the engine.

**Files:** `apps/api/src/suites/orchestrator.ts` (cell list = tests × scenarios × repetitions;
bounded worker pool at `maxConcurrency`, default 3; each cell calls the **existing**
run-service start path — a cell is a normal run); soft-stop: cumulative
`cost_usd`(completed) + live accounting(in-flight) ≥ cap → stop scheduling, drain, status
`capped`; `POST /api/suites/:id/run`, `GET /api/suite-runs/:id` (+ list),
`GET /api/suite-runs/:id/stream` (SSE: cell status transitions, aggregate ticks — run-manager
buffering pattern reused at suite scope), `POST /api/suite-runs/:id/stop` (stop scheduling +
stop in-flight child runs via existing stop), `DELETE /api/suite-runs/:id` (children kept,
linkage cleared — or cascade? **locked: keep children**, delete only the parent + linkage);
startup reconciliation marks orphaned `running` suite runs `error` (same as runs). Tests
`benchmarks-orchestrator.test.ts` with a stubbed run starter.

**Acceptance:** stubbed tests prove: full matrix scheduled exactly once per cell, concurrency
bound honored (max in-flight observed = config), cap soft-stop (no new cells, in-flight finish,
status `capped`), stop mid-suite, orphan reconciliation; aggregates (mean grade ± stddev, pass
rate, tokens, exec cost, judge cost) recomputable from children and cached on completion;
auto-grading fires per cell (1.2/1.3 untouched); gate green.

## WP 3.3 — Suite console UI + suite CRUD screens
**Size:** L · **Depends on:** 3.2 · Web-only

**Objective:** the live mass-run surface (B9.1).

**Files:** `apps/web/src/features/testing/suites/` — `/testing/suites` (list + create/edit:
ordered test picker with drag order, scenario multi-select, config form incl. repetitions +
cap), `/testing/suite-runs/:suiteRunId` (console: **matrix grid** tests × scenarios, cell =
repetition roll-up chip with status/score, live via SSE; KPI rail: progress, mean grade ±
spread, pass rate, tokens, exec cost + judge cost side by side; drill-through: cell click →
child run console route). Routes + breadcrumbs registered in `App.tsx`.

**Acceptance:** live walk: define a 2-test × 2-scenario × 2-rep suite against a stub MCP server,
run it, watch cells fill, cap a run and see `capped` state, drill into a child run; loading =
layout-shaped placeholders, streaming builds up, errors only at terminal states
(loading-states rule); both themes; gate green.

## WP 3.4 — Analytics: breakdowns, quality×cost scatter, export
**Size:** L · **Depends on:** 3.2 · API + Web

**Objective:** the views that justify the feature (B9.2–B9.3) + report parity.

**Files:** API: `GET /api/suite-runs/:id/analytics` (server-computed: distributions + slices by
`category`/`difficulty`/`tags` × scenario; scatter points `{testId, scenarioId, meanScore,
meanTokens, meanCostUsd, reps}`), `GET /api/reports/suite-run/:id/{json,markdown}` (reports
family extension). Web: analytics tabs on the suite-run console — breakdown charts
(`@elabs-ai/components-charts`), the **quality×cost scatter** (X tokens|cost toggle, Y = grade dimension
selector incl. process graders, color by scenario, point → cell drill-through), CSV-free honest
empty states when no grades exist.

**Acceptance:** analytics endpoint unit-tested against a fixture suite run (hand-computed
slices/means); scatter renders with correct axes/toggles on live data; report export includes
grades + aggregates and every cited link resolves; both themes; gate green.

## WP 3.5 — Failure buckets (opt-in LLM clustering)
**Size:** M · **Depends on:** 3.4 · API + Web

**Objective:** the prototype's failure taxonomy (§1.3/1.4) as a repeatable, explicitly-triggered
analysis (B9.4).

**Files:** `apps/api/src/grading/failure-buckets.ts` — input: a suite run's grade rows with
score < threshold (default 0.5) + their `reasoning`; one judge call batch → clusters
`{ label, description, memberRunIds, share }`; persisted on `suite_runs.aggregates_json`
(derived data), judge cost on the grading ledger; `POST /api/suite-runs/:id/failure-buckets`.
Web: a Failure-buckets tab (trigger button with cost notice, cluster table → member drill-down).

**Acceptance:** stubbed-judge test: clustering parse + membership integrity (every member is a
real low-score run); re-trigger overwrites the derived clusters (grades untouched); never runs
unprompted (no auto-trigger path exists — asserted); gate green.
