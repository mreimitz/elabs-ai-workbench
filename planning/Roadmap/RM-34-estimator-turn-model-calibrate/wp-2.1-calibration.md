---
type: "Work Package Spec"
title: "WP 2.1 — re-measure the band live against recorded runs"
description: "Phase 3 of item.md. Ledger: STATUS.md. The evidence WP: calls the live endpoint against real recorded runs and records how close the calibrated band now lands."
tags: ["roadmap", "RM-34"]
timestamp: "2026-08-21T14:15:00Z"
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
5. Confirm the D-ET1 fallback on a genuinely empty case — an environment with no completed runs still
   returns a usable band, labelled `default`.

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
- [ ] The empty-history fallback confirmed live, reporting `default`.
- [ ] Findings recorded in `STATUS.md`, including any way the estimator is still wrong.
- [ ] `README.md` capability table + `CHANGELOG.md` updated from observed figures, in the tick commit.
- [ ] `user-guide/DC-08-testing-console/` records the delivery, and its RM-33 *Known gaps*
      entry naming this defect is reconciled with what actually shipped.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, and `pnpm okf:validate`
      clean after the bundle edits.

## Verification the orchestrator will do

Re-run at least one of the live calls independently and confirm the numbers in the report match. A
figure that cannot be reproduced does not go in the ledger.
