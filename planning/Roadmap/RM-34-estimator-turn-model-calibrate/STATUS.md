---
type: "Status Ledger"
title: "Estimator turn model — work-package status ledger · PRIORITY: MEDIUM"
description: "Living state for the estimator turn-model calibration plan, read and updated by /next-wp RM-34."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T16:40:00Z"
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

- [x] **WP 1.2 — the pure estimator consumes a measured profile** — done 2026-08-21 ·
      `wp/estimator-turns/1.2` (merged as `323e779`) ·
      spec: [`wp-1.2-estimator.md`](./wp-1.2-estimator.md).
      `estimate.ts` takes an optional `turnProfile` and reads BOTH the turn band and the per-turn
      output figure from it, falling back to `DEFAULT_TURN_PROFILE` — the three constants, published
      as an honest `basis: "default"`/`sampleSize: 0` rather than left off the wire. `service.ts` does
      the one history read per request and the D-ET2 ladder; `estimate.ts` stays pure and a
      source-grep test now enforces it.
      **The subtle correctness fix is the clamp's no-cap value.** `turnBand` used to fall back to
      `RUN_PLAN_ESTIMATE_TURNS_HIGH` as the cap when a scenario set no `maxTurns`; keeping that would
      have silently held every measured p90 down to 8 and reduced this whole item to a rename. It is
      now `Infinity`, and the clamp is applied LAST, over whichever band was chosen (D-ET6).
      **The design decision worth recording is what happens when a plan selects several tests.** The
      estimator carries ONE band per environment, so a pair-level profile may only stand for the
      environment when the selection IS that pair. Two selected tests with 51 and 8 runs are two
      measurements of two different things: taking the first is order-dependent, and averaging their
      percentiles invents a band nobody measured. The resolver therefore escalates to the narrowest
      level that genuinely COVERS the selection — the environment sample, which contains both. A test
      flips the two test ids and asserts the answer is unchanged. **Cost of the choice:** a
      three-test plan gets the environment band rather than the union of those three pairs' runs.
      That union would need a raw-sample accessor on `RunRepository` and is a real, small follow-up —
      recorded here, not smuggled in.
      **Validated by the orchestrator, not taken on report:** both diffs read in full; the gate re-run
      on the merged tree (typecheck clean · shared **260** · illustrations **833** · cli **87** · api
      **3648** · web **3792** pass, 0 fail · build 0 · biome clean over 1,749 files); and the four
      teeth **broken by the orchestrator's own hand and confirmed red**, then restored — clamping the
      constants first (3 red), letting a below-floor pair through instead of falling to the wider
      level (4 red), putting a turn spread back into `costUsd` (6 red, including RM-33's own
      `low === high` acceptance), and a `db/database.js` import in `estimate.ts` (1 red, the purity
      grep, naming the specifier).
      **Verified LIVE** against the built API on an isolated copy of the owner's database (port 8097;
      the real `data/app.sqlite` mtime unchanged before and after). All three measured bases answer
      with real numbers, and the widest one reproduces the orchestrator's own independent SQL exactly:
      `pair` n=51 → 5 / 9 / 16 turns @ 595 out/turn · `environment` n=79 → 5 / 8 / 16 @ 869 ·
      `global` n=122 → **4 / 6 / 16** @ 823. The multi-test escalation was confirmed on the wire:
      asking for that environment's 51-run and 28-run tests together returns `environment`, not either
      pair.
      **A note WP 2.1 must not lose:** on this database `basis: "default"` is now unreachable, because
      the global level always holds 122 completed runs. That is D-ET2 working correctly — `default`
      is the fresh-install answer — but it means the "empty history ⇒ `default`" check can only be
      made against an empty `runs` table, not by picking an unused environment (which correctly
      answers `global`).
      **Not verified:** performance. `measureTurnProfiles` is one scan of three narrow columns per
      estimate request and the launcher re-estimates on every selection change; it was not timed on a
      large `runs` table, and per the spec no cache was added. One new failure mode is deliberate: the
      endpoint now reads `runs`, so a failure there 500s rather than being swallowed into a
      `basis: "default"` that would read as "no history" instead of "the measurement broke".

### Phase 3 — surface + verify

- [x] **WP 1.3 — launcher and suite preview show the turn basis and sample size** — done 2026-08-21 ·
      `wp/estimator-turns/1.3` (merged as `ac48e09`) ·
      spec: [`wp-1.3-surface.md`](./wp-1.3-surface.md).
      One new module, `apps/web/src/features/testing/turn-basis.tsx`, holds `weakestTurnProfile()`
      and a `TurnBasisNote` line used by all three surfaces — launcher, suite run-confirm, and the
      fork dialog. Copy is operator language, not the enum's: "Turn count from **51** past runs of
      this test on this environment.", down to "Turn count is an assumption — no past runs to
      measure." for `default`, which is the honest label on the number the app has shown all along.
      `Text variant="meta" tone="muted"` from the design system, `tabular-nums` on the count, no tab
      stop, no tooltip — it is a sentence, not a control.
      **`ForkDialog` was in scope after all.** The spec allowed skipping it if it showed no band; it
      turns out to render `~tokens` / `~$` **mid-points**, driven by the same turn model. Leaving it
      would have made it the one surface where the number's provenance stayed invisible.
      **One edit beyond the literal scope, flagged by the agent and accepted:** the launcher's
      estimate tooltip said "by an assumed 1–8 turns", which is true only of the `default` basis and
      would otherwise have sat directly above a line citing 51 measured runs. Reworded to "by the
      number of turns the agent is expected to take".
      **Validated by the orchestrator, not taken on report:** the module read in full; the gate re-run
      on the merged tree (see WP 1.2's line — the same run covers both); and two teeth **broken by the
      orchestrator's own hand and confirmed red**, then restored — flipping weakest-basis-wins to
      strongest (6 red across all three surfaces) and letting a PARTLY annotated plan through instead
      of claiming nothing (1 red). The weakest-wins rule follows RM-33's suite cache rollups: the
      plan's band is a sum, so one unmeasured environment makes the total partly assumed.
      **Not verified — and this is the honest gap:** the agent's two-theme walk saw the real component
      at `light` and `dark` on a running app, but with `turnProfile` **injected at the browser network
      layer** (Playwright `page.route`), because WP 1.2 had not merged in its worktree. No source file
      was stubbed. So wording, placement and both-theme legibility are verified; the VALUES in that
      walk were not real. WP 1.2 has since merged and the orchestrator confirmed the endpoint now
      serves real profiles, but **nobody has yet looked at a real measured line in a browser** — that
      is WP 2.1's live pass.
- [ ] **WP 2.1 — re-measure the band live against recorded runs** — _status: in progress (agent D)_ —
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
