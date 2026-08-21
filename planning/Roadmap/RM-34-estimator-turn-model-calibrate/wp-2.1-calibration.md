---
type: "Work Package Spec"
title: "WP 2.1 — re-measure the band live against recorded runs"
description: "Phase 3 of item.md. Ledger: STATUS.md. The evidence WP: calls the live endpoint against real recorded runs and records how close the calibrated band now lands."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T16:35:00Z"
status: "final"
---
# WP 2.1 — re-measure the band live against recorded runs

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.2 and WP 1.3.

## Why this is its own work package

The whole item exists because a **live call** — not a fixture — found the turn model wanting. RM-33's
acceptance box for `GET /api/estimate/run-plan` overreached by asking the band to "land near" a real
run's cost, and the live call is what exposed that it could not. This WP is the matching honesty
step for the fix: measure the calibrated estimator the same way, and write down what it actually
achieves, including where it still misses.

**This WP may conclude the estimator is still wrong.** That is a valid outcome and gets recorded as
one; it does not get papered over to tick a box.

## Scope

Against the **running app on an isolated copy of the database** — never the live file (this is the
RM-33 practice; a read-only copy in the session scratchpad):

1. Pick at least **three** recorded completed runs spanning the measured range — the data has runs at
   5, ~10 and 19–20 turns, across at least two environments (`BARC-Benchmark-Sonnet`,
   `Banking Analyst - Qlik`). Include the run RM-33 calibrated against, `4LnBMey0w53EnDRNG__TH`
   (958,457 gross input tokens, **$0.798** billed, 19 turns), so the two items are comparable.
2. For each, call `GET /api/estimate/run-plan` with that run's own environment and test, one
   repetition, and record: the token band, the dollar band, the reported `turnProfile` basis and
   sample size, and the run's actual turns / gross tokens / billed cost.
3. **Exclude the run itself from its own profile if the sample is small enough for it to dominate**,
   or state plainly that it was included and what that means. A model validated on a sample
   containing the thing it is predicting is not validated — say which situation applies rather than
   quietly leaving it ambiguous.
4. Record, per run: does the token band **bracket** the actual? Does the dollar band? By what factor
   is the midpoint off? Compare each figure against what the **pre-WP-1.2 estimator** produced for
   the same input, so the improvement is a measured delta and not a claim.
5. Confirm the D-ET1 fallback. **Note what the orchestrator already found**: on the owner's database
   `basis: "default"` is now UNREACHABLE, because the `global` level always holds 122 completed runs
   — an environment with no runs of its own correctly answers `global`, not `default`. That is D-ET2
   working. So this check needs an **empty `runs` table** (a scratch database), not an unused
   environment. Confirm both: unused environment ⇒ `global`, empty database ⇒ `default` with the
   original 1 / 3 / 8 band and `sampleSize: 0`.

## What the orchestrator already measured (your baseline — reproduce it, do not trust it)

Live against the built API on an isolated copy of the owner's database, 2026-08-21, after WP 1.2 and
WP 1.3 merged. All three measured bases answer:

| Basis | n | turns low/mid/high | output tokens/turn |
| --- | --- | --- | --- |
| `pair` (BARC-Benchmark-Sonnet × its 51-run test) | 51 | 5 / 9 / 16 | 595 |
| `environment` (same environment, two tests selected ⇒ escalated) | 79 | 5 / 8 / 16 | 869 |
| `global` | 122 | 4 / 6 / 16 | 823 |

For that `pair` selection at one repetition the endpoint returns tokens **325,764 / 586,303 /
1,042,247** and cost **$0.675 – $3.241**. Those 51 real runs actually span **103,372 – 1,099,077**
gross tokens (mean 432,508) and **$0.114 – $0.876** (mean **$0.453**), at a mean of **10.0** turns.

**So the token band now lands well** — its high end (1,042,247) sits within 5% of the real maximum
(1,099,077), and the measured mid of 9 turns is within one turn of the observed mean of 10.

## The finding you must investigate first

**The dollar band's LOW end is now above the typical run's actual cost** — $0.675 against a $0.453
mean — and this is a direct consequence of the turn fix colliding with an RM-33 design choice.

RM-33 WP 2.1 deliberately moved the dollar band onto the CACHING axis: both ends are evaluated at
the same `turns.high`, so `low` means "this many turns, cached" and `high` means "this many turns,
uncached". That was sound when `turns.high` was **8**, which sat *below* this pair's real mean of 10.
Now `turns.high` is the measured **p90 of 16**, so the dollar floor is a p90 figure — the cheapest
pricing of the busiest plausible run, which is not a floor an operator would read it as.

Note the same change makes the low end an *excellent* predictor of a long cached run: the reference
run `4LnBMey0w53EnDRNG__TH` took 19 turns and billed **$0.7985**, and $0.675 at 16 turns scales to
almost exactly that. The band is not wrong — it is answering a different question than the label
implies.

**Decide and record, do not silently fix.** Your options, and this is a genuine judgement call:
(a) leave it and fix the LABEL, since the band is honest about caching and the token band already
carries the turn spread; (b) evaluate the dollar `low` at `turns.low`/`turns.mid` — which reopens
RM-33's D-CT2 reasoning and would break its `no cachedInPer1M ⇒ low === high` acceptance, so it is
**not** yours to change here; (c) surface both dimensions. Write up which you recommend and why, and
if it needs code, it becomes its own work package.

Then write the results into `STATUS.md`'s WP 2.1 entry as the evidence, and:

- Update `README.md`'s capability table and add a `CHANGELOG.md` entry, per the repo's
  "front page follows the work" rule — **in the same commit as the tick**, and only from figures
  actually observed here.
- Record the delivery in **`planning/user-guide/DC-08-testing-console/`** — the orchestrator checked,
  and that subject already owns the launcher and its cost preview. Its *Known gaps* section for RM-33
  literally names this defect ("the estimator's turn ceiling is 8 where the reference run took 19 …
  a candidate for its own item"), so this item's increment closes a gap that subject already records.
  **Do not create a new subject.** The estimate preview is user-facing behaviour whose meaning
  changed — the number now depends on the operator's own run history — which is worth a paragraph
  they can read.

## Out of scope

- Any further change to the turn model. If this WP finds a defect, it is recorded as a finding and
  becomes its own work package — not fixed inline, where it would escape review.
- Re-running or launching any real LLM run. Every figure here comes from **already-recorded** runs
  and the read-only estimate endpoint; this WP needs no provider key and spends nothing.

## Acceptance

- [ ] At least three recorded runs measured live, spanning at least two environments and a turn
      count of ≥ 15, each with the full before/after comparison above.
- [ ] Run `4LnBMey0w53EnDRNG__TH` measured, and its result stated against RM-33's recorded figures
      ($0.798 billed; the old band $0.4198–$1.5912 at an 8-turn ceiling against 19 actual turns).
- [ ] The sample-contamination question answered explicitly for each run (excluded, or included and
      what that means).
- [ ] The fallback confirmed live BOTH ways: unused environment ⇒ `global`, empty `runs`
      table ⇒ `default` with the 1 / 3 / 8 band and `sampleSize: 0`.
- [ ] The dollar-band-floor finding above investigated, with a recommendation recorded.
- [ ] A real measured basis line seen in a BROWSER, in both themes — WP 1.3's own walk used
      injected values because WP 1.2 had not merged yet, so this is still unseen.
- [ ] Findings recorded in `STATUS.md`, including any way the estimator is still wrong.
- [ ] `README.md` capability table + `CHANGELOG.md` updated from observed figures, in the tick commit.
- [ ] `user-guide/DC-08-testing-console/` records the delivery, and its RM-33 *Known gaps*
      entry naming this defect is reconciled with what actually shipped.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, and `pnpm okf:validate`
      clean after the bundle edits.

## Verification the orchestrator will do

Re-run at least one of the live calls independently and confirm the numbers in the report match. A
figure that cannot be reproduced does not go in the ledger.
