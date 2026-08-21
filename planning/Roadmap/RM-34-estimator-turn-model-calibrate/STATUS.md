---
type: "Status Ledger"
title: "Estimator turn model — work-package status ledger · PRIORITY: MEDIUM"
description: "Living state for the estimator turn-model calibration plan, read and updated by /next-wp RM-34."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T14:08:00Z"
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

- [x] **WP 1.1 — turn-profile contract + completed-runs percentile query** — done 2026-08-21 ·
      `wp/estimator-turns/1.1` (merged as `4ce9ced`) ·
      spec: [`wp-1.1-turn-profile.md`](./wp-1.1-turn-profile.md).
      `packages/shared` gains `RunPlanTurnProfile` / `RunPlanTurnBasis`, a `.strict()` zod schema, the
      `RUN_PLAN_TURN_PERCENTILE_{LOW,MID,HIGH}` = 0.1/0.5/0.9 band ends and the
      `RUN_PLAN_TURN_PROFILE_MIN_SAMPLES` = 3 floor; `RunPlanEstimateEnvironment` gains an optional
      `turnProfile`. `RunRepository.measureTurnProfiles` returns pair / environment / global samples
      from **one** pass over `status = 'completed' AND turns > 0`.
      **611 insertions, 0 deletions** — the diff literally cannot have changed an existing field, and
      `RUN_PLAN_ESTIMATE_TURNS_{LOW,MID,HIGH}` / `_OUTPUT_TOKENS_PER_TURN` still read 1 / 3 / 8 / 350
      (D-ET1's fallback is intact, and a shared test now pins those four values).
      **The design decision worth recording is `outputTokensPerTurn` = Σ`tokens_out` ÷ Σ`turns`, not
      the mean of the per-run ratios.** The estimator multiplies output by a turn count, so a 20-turn
      run must weigh twenty times a 1-turn one; a mean of ratios gives them equal say. On the WP's own
      fixture (2 turns @ 200 · 18 turns @ 18,000) the two read **910** vs **550**.
      Percentiles are **nearest-rank**, so every end the launcher will show is a turn count some run
      actually took — an interpolated p90 of 15.7 is a number no run ever produced. At the n = 3 floor
      the three ranks are 1 / 2 / 3, i.e. that sample's own min / median / max.
      **Validated by the orchestrator, not taken on report:** the full diff was read; the gate re-run
      independently in the worktree (typecheck clean · shared **260** · api **3633** · web **3767**
      pass, 0 fail · build exit 0 · biome clean over 1,735 files); and the three teeth **broken by the
      orchestrator's own hand and confirmed red**, then restored — widening the query to all statuses
      (2 red), switching the percentile to linear interpolation (7 red), and swapping in a
      mean-of-per-run-ratios (2 red).
      **Not verified:** nothing visual — this WP renders nothing. The query was never run against the
      owner's real database; the figures quoted in its code comments come from this plan's own
      measurement pass, and WP 2.1 is where the live check happens. `EXPLAIN QUERY PLAN` reports the
      existing `idx_runs_status_started` already serves the query, so **no index was added**.

### Phase 2 — consume

- [ ] **WP 1.2 — the pure estimator consumes a measured profile** — _status: in progress (agent B)_ —
      spec: [`wp-1.2-estimator.md`](./wp-1.2-estimator.md). Depends on: WP 1.1.
      Files: `apps/api/src/estimate/{estimate,service}.ts`, `apps/api/src/index.ts`.

### Phase 3 — surface + verify

- [ ] **WP 1.3 — launcher and suite preview show the turn basis and sample size** — _status: in progress (agent C)_ —
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
