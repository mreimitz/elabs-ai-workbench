---
type: "Roadmap Item"
title: "Estimator turn model — calibrate the run-plan preview against measured run history"
description: "Replace the run-plan estimator's fixed 1/3/8-turn and flat 350-output-tokens-per-turn assumptions with a band measured from the app's OWN completed runs, keyed narrowest-first (environment+test, then environment, then global) with the static constants as the only fallback, and make the estimate declare which basis it used."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T14:05:00Z"
status: "active"
---

# Estimator turn model — calibrate the run-plan preview against measured run history

## Goal

Replace the run-plan estimator's fixed 1/3/8-turn and flat 350-output-tokens-per-turn assumptions with a band measured from the app's OWN completed runs, keyed narrowest-first (environment+test, then environment, then global) with the static constants as the only fallback, and make the estimate declare which basis it used.

## Why it matters

RM-33 WP 2.1 fixed the estimator's PRICING and left its TOKEN model untouched; the live acceptance call then showed the turn model is now the dominant source of error. Measured on the owner's own database: completed runs have a median of 6 turns and a p90 of 16 against a hard ceiling of 8, and produce a mean of 1,148 output tokens per turn against an assumed 350 — so a real 19-turn run cannot be reproduced at any price. The evidence the estimator needs is already persisted in runs.turns / runs.tokens_out; nothing is measuring it.

## Milestones

- [x] Phase 1 — measure: shared turn-profile contract + a completed-runs-only percentile query over runs.turns and output-tokens-per-turn
- [ ] Phase 2 — consume: the pure estimator takes a measured profile per environment, keeps maxTurns clamping, and reports its turn basis on the wire
- [ ] Phase 3 — surface + verify: launcher and suite preview show the basis and sample size; the band is re-measured live against recorded runs

## Linked research

No linked research yet. The evidence for this item is **measured, not surveyed** — see
*The measurement* below, and [`RM-33`](/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md),
whose live acceptance call is what exposed the gap.

## The defect

`apps/api/src/estimate/estimate.ts` models a run's tokens as:

```ts
const perTurnPrefix = env.footprintTokens + env.systemPromptTokens;
const input  = turns * perTurnPrefix + test.promptTokens;
const output = turns * RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN;   // 350, flat
```

with `turns` drawn from three constants frozen when the preview shipped
(`packages/shared/src/constants.ts`):

```ts
RUN_PLAN_ESTIMATE_TURNS_LOW  = 1;
RUN_PLAN_ESTIMATE_TURNS_MID  = 3;
RUN_PLAN_ESTIMATE_TURNS_HIGH = 8;
RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN = 350;
```

Neither number was ever measured. RM-33 WP 2.1 corrected the *pricing* applied to these tokens and
recorded the turn model as a known, deliberately-out-of-scope gap; the live acceptance call for
`GET /api/estimate/run-plan` then found it to be **the dominant remaining source of error** — the
band's high/low *ratio* agrees with a real run to within 1%, while its *absolute* figures cannot,
because the ceiling is 8 turns where the run took 19.

## The measurement

Queried read-only against an isolated copy of the owner's own database (163 runs; **completed only**,
122 runs — a `stopped`/`aborted`/`error` run's turn count is a truncation artifact, not a measurement
of how long the task takes):

| Quantity | Assumed | Measured |
| --- | --- | --- |
| Turns — low | 1 | **p10 = 4** |
| Turns — mid | 3 | **p50 = 6** |
| Turns — high | 8 | **p90 = 16** (max 20) |
| Output tokens per turn | 350 flat | **mean 1,148** |

`8` is therefore not a ceiling; it is roughly the **66th percentile**, and the output-per-turn
constant is low by **3.3x**. The two errors compound in the same direction, so the preview
under-states a long run on both axes at once.

Turn count is also **strongly environment-dependent, and internally consistent within an
environment** — which is what makes a measured model worth building rather than just a bigger
constant:

| Environment | completed runs | turns min–max | mean | output tokens/turn |
| --- | --- | --- | --- | --- |
| BARC-Benchmark-Sonnet | 79 | 5–20 | 9.8 | 1,036 |
| Banking Analyst - Qlik | 26 | 4–9 | 5.4 | 422 |
| BARC-Benchmark-Free | 5 | 6–7 | 6.4 | 711 |
| Banking Analyst - SQL | 2 | 9–11 | 10.0 | 416 |

And it stays genuinely stochastic *within* one (environment, test) pair — the largest pair holds 51
runs spanning **5–19** turns. **The band must stay a band**; this item moves its ends onto measured
ground, it does not pretend to predict a single number.

## Locked decisions

- **D-ET1 — history-first, never history-only.** A measured profile is used when one exists; the
  existing constants remain the fallback and are never deleted. A fresh install, a new environment,
  and a never-run test must all still produce a preview.
- **D-ET2 — narrowest key that clears the sample floor wins, and levels are never mixed.** Lookup
  order is `(environmentId, testId)` -> `(environmentId)` -> global. A level with fewer than
  `RUN_PLAN_TURN_PROFILE_MIN_SAMPLES` completed runs falls through whole; blending a 2-run pair into
  its environment's 79 runs would produce a figure nobody measured.
- **D-ET3 — completed runs only.** `stopped`, `aborted` and `error` runs were cut short; their turn
  counts measure the interruption, not the task, and including them biases the model low. (Measured:
  the six `stopped` runs average 17.7 turns, the 22 `error` runs 4.5 — noise in both directions.)
- **D-ET4 — output tokens per turn is measured on the same key as turns**, from
  `tokens_out / turns` over the same completed sample, and falls back to the same constant. It is
  part of the profile, not a separate lookup — a profile that measured turns but assumed output would
  be internally inconsistent.
- **D-ET5 — the estimate declares its basis.** The response carries, per environment, which basis
  produced its turn band (`pair` · `environment` · `global` · `default`) and the sample size behind
  it. An advisory number whose provenance is invisible cannot be judged, and the launcher currently
  shows a band with no way to tell a measured one from a guessed one.
- **D-ET6 — `maxTurns` still clamps, last.** A scenario guardrail is a hard operator constraint; a
  measured p90 above it is not evidence the run will exceed it. Clamping applies to the measured band
  exactly as it does to the constants, and `low <= mid <= high` is preserved.
- **D-ET7 — additive only.** No migration (every column read already exists — `runs.turns`,
  `runs.tokens_out`, `runs.status`, `runs.scenario_id`, `runs.test_id`), no new runtime dependency,
  no feature flag, and response fields are added beside the existing ones so no consumer breaks.
- **D-ET8 — the estimator stays pure.** `estimate.ts` gains no DB access; the service resolves the
  profile and passes it in, exactly as it already does for footprints and pricing.

## Work packages

| WP | Title | Depends on |
| --- | --- | --- |
| [1.1](./wp-1.1-turn-profile.md) | Turn-profile contract + completed-runs percentile query | — |
| [1.2](./wp-1.2-estimator.md) | The pure estimator consumes a measured profile | 1.1 |
| [1.3](./wp-1.3-surface.md) | Launcher + suite preview show the basis and sample size | 1.1 |
| [2.1](./wp-2.1-calibration.md) | Re-measure the band live against recorded runs | 1.2, 1.3 |

Ledger: [`STATUS.md`](./STATUS.md) — authoritative.
