---
type: "Status Ledger"
title: "Estimator turn model — work-package status ledger · PRIORITY: MEDIUM"
description: "Living state for the estimator turn-model calibration plan, read and updated by /next-wp RM-34."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T20:10:00Z"
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
- [ ] **WP 2.1 — re-measure the band live against recorded runs** — _status: evidence gathered
      2026-08-21, box left for the orchestrator_ — spec: [`wp-2.1-calibration.md`](./wp-2.1-calibration.md).
      Depends on: WP 1.2, WP 1.3. Also carries the `README.md` / `CHANGELOG.md` update and the
      [`DC-08`](/user-guide/DC-08-testing-console/doc.md) delivery record.

      **The headline, stated plainly: the turn model is fixed and the estimator is still wrong.**
      RM-34 set out to move the turn band's ends onto measured ground, and measured live it did
      exactly that — but sharpening the turn axis did **not** make the token band better overall,
      because it exposed a second, larger error on the tokens-per-turn axis that the old
      under-stated turn count had been masking. Both facts are below, with the numbers.

      **Method.** Built tree at `8bb888a`, served on `127.0.0.1:8097` against an **isolated copy** of
      the owner's database in the session scratchpad (`DATA_DIR`/`DATABASE_PATH` both pointed at the
      copy). The real `data/app.sqlite` was **untouched** — md5 `1762bcdadae9…` and mtime
      `2026-08-21T16:22:34+0200` identical before and after. (Its `-wal` grew during the session;
      `lsof` attributes that to PID 22253, a `tsx` dev server started at 16:22:34, i.e. the owner's
      own `pnpm dev:api`, not this work.) A **second** instance on `:8098` served a copy with
      `DELETE FROM runs` applied, which is both the D-ET1 `default` check and the pre-RM-34 baseline.
      Every wire figure below was independently recomputed from the same copy with hand-written
      nearest-rank SQL, and **all of them reproduce exactly**.

      **The pre-RM-34 baseline is not an estimate.** The empty-`runs` instance returns
      `basis: "default"`, `sampleSize: 0`, turns `1 / 3 / 8`, `outputTokensPerTurn: 350`, and for the
      reference pair a cost band of **$0.4198–$1.5912** — which is, to the cent, the figure RM-33
      recorded before RM-34 existed. So "the `default` path is byte-identical to the pre-RM-34
      arithmetic" is now confirmed against an externally-recorded number, not just a code comment.
      A hand-computation from the four constants gives the same tokens (64,980 / 194,760 / 519,210).

      **Every basis observed live** (each reproduced by independent SQL):

      | Basis | selection | n | turns low/mid/high | output tok/turn |
      | --- | --- | --- | --- | --- |
      | `pair` | BARC-Benchmark-Sonnet × barc-flights | 51 | 5 / 9 / 16 | 594.79 |
      | `pair` | BARC-Benchmark-Sonnet × barc-taxi | 28 | 5 / 7 / 18 | 1,395.25 |
      | `pair` | Banking Analyst - Qlik × Banking-Benchmark-Enhanced | 16 | 4 / 5 / 6 | 372.47 |
      | `environment` | BARC-Benchmark-Sonnet, both tests selected ⇒ escalated | 79 | 5 / 8 / 16 | 868.82 |
      | `environment` | Banking Analyst - Qlik, via a two-environment plan | 26 | 4 / 5 / 7 | 417.81 |
      | `global` | `answers-as-model` — an environment with **zero** completed runs | 122 | 4 / 6 / 16 | 823.27 |
      | `default` | empty `runs` table | 0 | 1 / 3 / 8 | 350 |

      **D-ET1 / D-ET2 fallback confirmed BOTH ways, as the spec required.** An unused environment
      answers `global` (n=122) — *not* `default` — exactly as WP 1.2 warned; only an empty `runs`
      table produces `default` with the 1 / 3 / 8 band and `sampleSize: 0`. The D-ET2 escalation was
      re-confirmed on the wire: selecting that environment's 51-run and 28-run tests together returns
      `environment`, not either pair.

      **The five measured runs.** Actual "gross tokens" is `tokens_in + tokens_out`; the estimates are
      one repetition of that run's own environment and test.

      | Run | env × test | turns | gross | billed | basis | tokens NOW | ✔ | tokens PRE | ✔ | $ NOW | ✔ | $ PRE | ✔ |
      | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
      | `y3dESje2NEQY9YHKUbjMg` | BARC × flights | 5 | 103,372 | $0.1141 | pair 51 | 325,764–1,042,247 | **✗ under** | 64,980–519,210 | ✓ | 0.68–3.24 | ✗ under | 0.42–1.59 | ✗ under |
      | `H4uIlGDWBiSRc7U9z-SdM` | Banking × Enhanced | 5 | 231,765 | $0.4795 | pair 16 | 197,124–295,655 | ✓ | 49,305–394,006 | ✓ | 0.29–0.91 | ✓ | 0.33–1.22 | ✓ |
      | `qK3v00QxWiKXZx06zChmD` | BARC × flights | 10 | 412,687 | $0.4239 | pair 51 | 325,764–1,042,247 | ✓ | 64,980–519,210 | ✓ | 0.68–3.24 | **✗ under** | 0.42–1.59 | ✓ |
      | `4LnBMey0w53EnDRNG__TH` | BARC × flights | 19 | 966,904 | $0.7985 | pair 51 | 325,764–1,042,247 | **✓** | 64,980–519,210 | **✗ over** | 0.68–3.24 | ✓ | 0.42–1.59 | ✓ |
      | `wDQ-o0xqHUjs5MLnL5pkk` | BARC × taxi | 20 | 1,201,672 | $0.9494 | pair 28 | 329,874–1,187,033 | ✗ over 1.2% | 65,088–519,318 | ✗ over 2.3× | 0.95–3.86 | ✓ | 0.42–1.59 | ✓ |

      **The RM-33 reference run is the clean win.** `4LnBMey0w53EnDRNG__TH` (19 turns, 966,904 gross,
      **$0.7985** billed) now sits **inside** the token band, where the pre-RM-34 band topped out at
      519,210 — 1.86× below it. Its dollar band brackets as it did before, but the old band's
      $0.4198–$1.5912 bracketed by being generically wide, whereas $0.6755–$3.2409 brackets a run the
      token model can now actually reproduce. That is the specific defect this item was chartered on,
      and it is closed.

      **Sample contamination, answered per run (leave-one-out, D-ET3 sample recomputed without it).**
      Every one of the five is `completed` with `turns > 0`, so **every one is inside its own
      profile's sample** — none was excluded, and here is what that is worth:

      | Run | full band | leave-one-out band | ends move? | out/turn shift |
      | --- | --- | --- | --- | --- |
      | `y3dESje2NEQY9YHKUbjMg` | 5 / 9 / 16 (n=51) | 5 / 9 / 16 (n=50) | no change at all | +0.08% |
      | `H4uIlGDWBiSRc7U9z-SdM` | 4 / 5 / 6 (n=16) | 4 / 5 / 6 (n=15) | no change at all | −0.06% |
      | `qK3v00QxWiKXZx06zChmD` | 5 / 9 / 16 (n=51) | 5 / 8 / 16 (n=50) | ends unmoved; mid 9→8 | +0.37% |
      | `4LnBMey0w53EnDRNG__TH` | 5 / 9 / 16 (n=51) | 5 / 8 / 16 (n=50) | ends unmoved; mid 9→8 | +0.98% |
      | `wDQ-o0xqHUjs5MLnL5pkk` | 5 / 7 / 18 (n=28) | 5 / 7 / 17 (n=27) | **high 18→17** | **+5.11%** |

      Four of the five do not move their own band's ends, so their brackets stand. The two mid shifts
      (9→8) are a nearest-rank **parity** artifact — `ceil(0.5 × 51) = 26` against `ceil(0.5 × 50) = 25`
      — not the run's own weight. **The one genuine contamination is `wDQ-o0xqHUjs5MLnL5pkk`**: it is
      its pair's maximum, and removing it pulls the p90 from 18 to 17 and the per-turn output up 5.1%.
      Under its own leave-one-out profile that run's token band would top out lower still, so its
      "✗ over by 1.2%" would become a wider miss. Stated plainly: **that run's near-bracket is
      partly an artefact of predicting a run the model was fitted on.**

      **The finding the spec asked for first — the dollar band's floor — investigated, with numbers.**
      The spec's framing is right but understates it. Measured over each pair's **whole** completed
      sample, not just the hand-picked runs:

      | Pair | n | actual cost range | $ band NOW | inside | $ band PRE | inside |
      | --- | --- | --- | --- | --- | --- | --- |
      | BARC × flights | 51 | $0.1141–$0.8761 (mean $0.4529) | $0.6755–$3.2409 | **9/51 (18%)** | $0.4198–$1.5912 | 26/51 (51%) |
      | BARC × taxi | 28 | $0.3223–$0.9494 (mean $0.5266) | $0.9485–$3.8625 | **1/28 (4%)** | $0.4202–$1.5916 | 19/28 (68%) |
      | Banking × Enhanced | 16 | $0.2437–$0.7731 (mean $0.4003) | $0.2904–$0.9138 | 9/16 (56%) | $0.3282–$1.2156 | 9/16 (56%) |

      On `barc-taxi` the dollar band now contains **one run in twenty-eight**; the other twenty-seven
      all cost *less than its floor*. **Recommendation: option (c), surface both dimensions — as its
      own work package.** Reasoning: (a) "fix the label" is refuted by that 4% — the problem is not
      that the label is imprecise, it is that the interval does not contain the answer, and no wording
      rescues a range that excludes 96% of outcomes. (b) is out of bounds here and was not attempted.
      (c) restores "low ≤ what you will pay ≤ high" while keeping RM-33's D-CT2 read/write separation
      intact — concretely, price the cached end at `turns.low` and the uncached end at `turns.high`,
      and render the caching assumption as its own labelled line rather than *being* the band. The
      cost of (c), and precisely why it is not an inline edit: it breaks RM-33's
      `no cachedInPer1M ⇒ low === high` acceptance, so it needs an owner decision. **Caveat for
      whoever picks it up:** (c) alone will not centre the band, because the deeper defect is below.

      **The second finding — and the reason the token band did not improve.** The estimator models
      `gross ≈ (footprint + system + outputPerTurn) × turns + prompt`, i.e. an affine relation with an
      intercept of ~0. Least-squares fits over the same samples say otherwise:

      | Pair | measured fit | R² | estimator's per-turn term | slope ratio |
      | --- | --- | --- | --- | --- |
      | BARC × flights (51) | `gross ≈ 60,613 × turns − 174,807` | 0.947 | 65,135 | 1.07× |
      | BARC × taxi (28) | `gross ≈ 49,571 × turns − 105,679` | 0.843 | 65,935 | 1.33× |
      | Banking × Enhanced (16) | `gross ≈ 63,902 × turns − 93,228` | 0.570 | 49,265 | 0.77× |

      **The slope is close (0.77×–1.33×); the intercept is off by 93k–175k tokens, always upward.**
      That fixed over-statement is a rounding error on a 19-turn run and a 2–3× error on a 5-turn one,
      which is exactly the shape of the misses above. **Recorded as a finding, not fixed** — it is a
      different axis from this item's, and belongs to its own work package.

      **Mechanism — reviewed 2026-08-21, and split into what is PROVEN and what is still a
      hypothesis.** The code facts were re-derived from source by a second agent and hold exactly:

      * `apps/api/src/estimate/estimate.ts:8` states the premise in the file's own header —
        "…re-sent to the model on every agent turn **(eager tool loading)**".
      * `apps/api/src/estimate/estimate.ts:148-153` (`runTokens`) charges
        `turns × (footprintTokens + systemPromptTokens)` unconditionally; `runUsage` (`:185-186`)
        re-prices the identical term.
      * **The estimator cannot see the mode at all.** `EstimateEnvInput` (`estimate.ts:63-87`) has no
        tool-loading field, and `apps/api/src/estimate/service.ts` never reads `toolLoadingMode` —
        a repo-wide grep puts every reader in `advisor/`, `testing/` and `reports/`, none in
        `estimate/`. So the over-charge is **mode-blind by construction**, which is the defect worth
        recording regardless of how much of the intercept it explains.
      * `apps/api/src/testing/tool-bridge.ts:166-175` tags each tool
        `providerOptions.anthropic.deferLoading = true` in deferred mode.

      **What is NOT proven, and should not be repeated as fact:**

      1. **Nothing in this repository strips a tool definition.** `tool-bridge.ts` sets a provider
         flag; the stripping is Anthropic-side behaviour asserted in a comment. "`tool-bridge.ts`
         confirms deferred strips each tool definition from the prompt prefix" overstates what the
         file shows.
      2. **The "peaked at 27k–34k of live context" figure is circular and, taken literally,
         contradicts the run data.** `apps/api/src/testing/accounting.ts:363` and `:651` set
         `tool_defs` to **0** in deferred mode, and `stripDeferredToolDefs` (`:395`) removes the
         deferred catalog from the lens — so the app's own context snapshot excludes the tool
         catalog *by construction* in deferred mode and cannot be used as evidence that the catalog
         was not billed. Separately: run `4LnBMey0w53EnDRNG__TH` recorded 966,904 gross tokens over
         19 turns, i.e. **~50k input tokens per model call** — a context that truly peaked at 34k
         could not produce that. The two figures are inconsistent by ~1.5×.
      3. **The Banking pair is direct counter-evidence to the strong form.** If the estimator
         over-charged the per-turn prefix on every deferred pair, its slope would exceed the measured
         slope everywhere. On `Banking × Enhanced` the ratio is **0.77×** — the measured per-turn
         cost is *higher* than the estimator's. "Always upward" is true of the intercept, not of the
         slope.
      4. **The effective mode was never recorded.** `run-service.ts:1389-1393` downgrades a requested
         `deferred` to `eager` unless `supportsToolSearch(kind, model)` (Anthropic, non-Haiku), and
         the effective mode is persisted **nowhere** (`advisor/rules/loading-mode.ts:4` says so
         outright). The scenario's *requested* mode is what was read here; that these runs actually
         executed deferred is an inference from the model id.

      **What the numbers do support.** The intercepts are close to a small whole number of turns'
      worth of prefix — 174,807/64,540 ≈ **2.7 turns**, 105,679/64,540 ≈ **1.6**, 93,228/48,893 ≈
      **1.9** — with slopes at 0.75–1.0× of the full footprint. That is the signature of *the first
      one to three turns being cheap and the prefix then being carried in full*, i.e. a **ramp-in**,
      not of a catalog that is absent throughout. Two competing explanations were tested against
      source and **refuted**: a turn-counting mismatch (`runs.turns` comes from `kpis.turns`,
      incremented once per settled `llmStep` at `accounting.ts:463`, which is exactly the model call
      the estimator charges a prefix for), and conversation-growth convexity (a quadratic fitted
      through the three flights runs gives a curvature term of ≈ −20, i.e. the relation is linear
      over 5–19 turns, not convex). **The follow-up work package should measure the per-turn billed
      input directly from `run_steps` before assuming a cause.**

      **Consequence, stated without varnish.** Judged the way an operator reads the launcher — "will my
      run land in this range?" — the change is **not** an improvement:

      | | turn band coverage | token band coverage | token mid error |
      | --- | --- | --- | --- |
      | BARC × flights (51) | 49% → **96%** | 59% → **45%** | 2.06× → 2.06× |
      | BARC × taxi (28) | 61% → **93%** | 75% → **29%** | 1.69× → 1.95× |
      | Banking × Enhanced (16) | 100% → 94% | 94% → **44%** | 1.41× → **1.38×** |

      **RM-34's own deliverable is verified and good** — the turn band brackets 93–96% of real runs
      where the 1/3/8 constants managed 49–61% on the two BARC pairs, and it does so with *informative*
      ends (4–6 for Banking, not 1–8). **What RM-34 did not deliver, and never claimed to, is a better
      token or dollar figure**: the token mid-point's mean error factor is 1.90× against the old 1.82×
      — a wash — and band coverage fell on all three pairs. The old band covered more by being anchored
      far too low and stretching up (0 of 95 runs fell *below* a PRE token band, on any pair); the new
      one is centred on measured turns but inherits an over-stated per-turn prefix, so it now misses
      *under* at the short end. Fixing the intercept is what would convert RM-34's correct turn model
      into a correct token band.

      **Seen in a BROWSER, in both themes — WP 1.3's open box, now closed with REAL values.** At
      `http://127.0.0.1:8097/testing/runs` → **New run** → *Single / interactive run* → test
      `barc-flights` + environment `BARC-Benchmark-Sonnet` → *Next*, the launcher's Estimated cost
      block reads `≈ 325,764–1,042,247 tokens · $0.68–$3.24 (estimate)` above the line **"Turn count
      from 51 past runs of this test on this environment."** The network trace confirms the values are
      served, not injected: one `GET /api/estimate/run-plan?testIds=YuOH1I4oI3aMn3FLipHXY&…` returning
      `basis: "pair"`, `sampleSize: 51`. Rendered at 12px `Text variant="meta" tone="muted"` with
      `font-variant-numeric: tabular-nums` on the `51`; **light** `oklch(0.5 0.012 257)` on
      `oklch(1 0 0)` = **6.00:1**, **dark** `oklch(0.72 0.01 257)` on `oklch(0.25 0.014 257)` =
      **6.45:1**, both clear of WCAG AA. The `default` variant was walked too, on the empty-history
      instance at `:8098`: **"Turn count is an assumption — no past runs to measure."**, same treatment,
      both themes, sitting under the pre-RM-34 band `≈ 64,980–519,210 tokens · $0.42–$1.59`.

      **Not verified.** No keyboard-only walk of the launcher (the line carries no tab stop by design,
      but the surrounding wizard was driven programmatically, not by hand). The suite run-confirm and
      fork-dialog surfaces were **not** re-walked with real values — only the launcher was; WP 1.3's
      injected-value walk remains the only visual evidence for those two. No run was launched and no
      provider key was used, per scope. Performance is still untimed (WP 1.2's open note stands).

## Batches

| Batch | WPs | Why |
| --- | --- | --- |
| 1 | 1.1 | Solo — it owns the shared contract every other WP reads. |
| 2 | 1.2 · 1.3 | Parallel — disjoint file sets (api/estimate vs web/testing), both need only 1.1. |
| 3 | 2.1 | Solo — the live evidence pass, plus the front-page and delivery record. |

## Owner-acceptance

- **The judgement call this item hands back (WP 2.1).** The dollar band's floor is now a p90-length
  figure: on `BARC-Benchmark-Sonnet × barc-taxi` it contains **1 of 28** real runs, and the other 27
  cost less than its floor. WP 2.1 recommends **option (c)** — price the cached end at `turns.low`
  and the uncached end at `turns.high`, and surface the caching assumption as its own line rather
  than as the band — which needs an owner decision because it breaks RM-33's
  `no cachedInPer1M ⇒ low === high` acceptance. Deliberately **not** fixed here.
- **The follow-up WP this item found and did not fix.** The turns→tokens mapping over-states the
  measured runs by a roughly constant 93k–175k tokens (fits in the WP 2.1 entry). The **proven**
  defect is that the estimator charges the full scanned tool footprint from turn one and **never
  sees `tool_loading_mode`** (`EstimateEnvInput` has no such field; `estimate/service.ts` never reads
  one), while both measured environments *request* `deferred`. Whether that alone accounts for the
  intercept is **not established** — see the reviewed mechanism breakdown in the WP 2.1 entry, which
  records three specific supports that do not hold and one pair whose slope runs the other way.
  Until the intercept is modelled, RM-34's correct turn band still produces a token band whose
  coverage is *lower* than the pre-RM-34 one (45% / 29% / 44% against 59% / 75% / 94%).
- **Hand walks not done.** A keyboard-only pass over the launcher's estimate block, and a real-value
  two-theme look at the **suite run-confirm** and **fork dialog** basis lines — only the launcher was
  re-walked with live values; WP 1.3's injected-value walk is still the only evidence for those two.

## Log

- **2026-08-21 · WP 2.1** — measured live against an isolated copy of the owner's database (the real
  `data/app.sqlite` md5 and mtime unchanged). The turn model is confirmed working — 93–96% of real
  runs fall inside the measured turn band, against 49–61% for the 1/3/8 constants — and the RM-33
  reference run `4LnBMey0w53EnDRNG__TH` now sits inside the token band where it previously sat 1.86×
  above it. The item's own goal is met. Two defects are recorded rather than fixed: the dollar band's
  floor is a p90 figure (4% coverage on one pair), and the turns→tokens mapping carries an unmodelled
  ~100–175k-token over-statement that makes the token band's overall coverage *worse* than before.
  Both are named in Owner-acceptance above as follow-up work packages.
- **2026-08-21 · WP 2.1 review (RM-35 WP 3.2).** Agent D's evidence was left uncommitted in an
  abandoned worktree, rescued verbatim as `71d7b60`, and reviewed on `wp/roadmap-cleanup/3.2`.
  **Touches no application code** — six documentation files only. The arithmetic was independently
  recomputed and **every stated figure reconciles exactly**: the `default` band (64,980 / 194,760 /
  519,210) pins the per-turn prefix at 64,540 and the flights prompt at 90 tokens, from which all
  three pairs' measured bands (325,764–1,042,247 · 329,874–1,187,033 · 197,124–295,655) and all six
  dollar ends ($0.6755–$3.2409 · $0.9485–$3.8625 · $0.2904–$0.9138, and the PRE figures incl.
  RM-33's externally-recorded $0.4198–$1.5912) fall out at Anthropic Sonnet's $3/$15 with a 1.25×
  write and a 0.1× read. The two BARC pairs' per-turn terms differ by exactly their
  output-tokens-per-turn difference (65,935 − 65,135 = 800 ≈ 1,395.25 − 594.79). All three slope
  ratios and the two band-miss percentages (1.2% over, 2.3×) reproduce. The **first finding** — the
  chartered defect is closed — stands. The **second finding**'s phenomenon (an affine fit with a
  large negative intercept) stands; its stated **mechanism** was cut back to what the code actually
  supports — see the mechanism breakdown in the WP 2.1 entry above. The README / CHANGELOG /
  CLAUDE.md wording was tightened so the front page does not read as an overall improvement: the
  turn band improved, the token and dollar bands did not. Gate re-run on the integration branch.
