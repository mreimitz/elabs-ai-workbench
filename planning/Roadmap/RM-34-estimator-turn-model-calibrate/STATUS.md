---
type: "Status Ledger"
title: "Estimator turn model — work-package status ledger · PRIORITY: MEDIUM"
description: "Living state for the estimator turn-model calibration plan, read and updated by /next-wp RM-34."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T13:25:00Z"
status: "active"
---
# Estimator turn model — work-package status ledger · **PRIORITY: MEDIUM**

Living state for the **estimator turn model** plan, read and updated by `/next-wp RM-34`. A box is
ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/estimator-turns/<id>`.

> Plan, measured evidence and locked decisions D-ET1–D-ET8 in [`item.md`](./item.md).
> Origin: the live acceptance call in
> [`RM-33`](/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md), which fixed the
> estimator's pricing and recorded its turn model as the dominant remaining error.

## The finding this plan exists to fix

The estimator's **pricing** is now correct and its **token model** is not.

- `apps/api/src/estimate/estimate.ts` draws turns from three constants — `1 / 3 / 8` — that were
  never measured, and charges a flat `350` output tokens per turn.
- Measured over the owner's 122 completed runs: **p10 = 4 · p50 = 6 · p90 = 16** turns (max 20), and
  a mean of **1,148** output tokens per turn. `8` is the ~66th percentile, not a ceiling; `350` is
  low by 3.3×. Both errors point the same way.
- Turn count is strongly environment-dependent and internally consistent within an environment
  (BARC-Benchmark-Sonnet: 79 runs, 5–20, mean 9.8 · Banking Analyst - Qlik: 26 runs, 4–9, mean 5.4),
  and still stochastic within one (environment, test) pair (51 runs spanning 5–19). So the band
  stays a band — its **ends** move onto measured ground.
- Every column needed is already persisted (`runs.turns`, `runs.tokens_out`, `runs.status`,
  `runs.scenario_id`, `runs.test_id`). Nothing reads them for this. **No migration.**

## Work packages

### Phase 1 — measure

- [ ] **WP 1.1 — turn-profile contract + completed-runs percentile query** —
      spec: [`wp-1.1-turn-profile.md`](./wp-1.1-turn-profile.md). Depends on: —.
      Files: `packages/shared/src/{constants,types,schemas}.ts`,
      `apps/api/src/testing/run-repository.ts`.

### Phase 2 — consume

- [ ] **WP 1.2 — the pure estimator consumes a measured profile** —
      spec: [`wp-1.2-estimator.md`](./wp-1.2-estimator.md). Depends on: WP 1.1.
      Files: `apps/api/src/estimate/{estimate,service}.ts`, `apps/api/src/index.ts`.

### Phase 3 — surface + verify

- [ ] **WP 1.3 — launcher and suite preview show the turn basis and sample size** —
      spec: [`wp-1.3-surface.md`](./wp-1.3-surface.md). Depends on: WP 1.1 (wire type only —
      runs in parallel with WP 1.2; the file sets are disjoint).
      Files: `apps/web/src/features/testing/run-launcher/RunLauncher.tsx`,
      `apps/web/src/features/testing/suites/SuiteDetail.tsx`,
      `apps/web/src/features/testing/ForkDialog.tsx` (+ their tests).
- [ ] **WP 2.1 — re-measure the band live against recorded runs** —
      spec: [`wp-2.1-calibration.md`](./wp-2.1-calibration.md). Depends on: WP 1.2, WP 1.3.
      Also carries the `README.md` / `CHANGELOG.md` update and the `user-guide/DC-NN` delivery record.

## Batches

| Batch | WPs | Why |
| --- | --- | --- |
| 1 | 1.1 | Solo — it owns the shared contract every other WP reads. |
| 2 | 1.2 · 1.3 | Parallel — disjoint file sets (api/estimate vs web/testing), both need only 1.1. |
| 3 | 2.1 | Solo — the live evidence pass, plus the front-page and delivery record. |

## Owner-acceptance

_(populated as boxes tick — anything needing the owner's own hands or judgement)_

## Log

_(decisions and per-WP outcomes are appended here as boxes tick)_
