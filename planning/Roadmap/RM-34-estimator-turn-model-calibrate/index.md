# Estimator turn model — calibrate the run-plan preview against measured run history

## Concepts

* [Estimator turn model — calibrate the run-plan preview against measured run history](item.md) - Replace the run-plan estimator's fixed 1/3/8-turn and flat 350-output-tokens-per-turn assumptions with a band measured from the app's OWN completed runs, keyed narrowest-first (environment+test, then environment, then global) with the static constants as the only fallback, and make the estimate declare which basis it used.
* [Estimator turn model — work-package status ledger · PRIORITY: MEDIUM](STATUS.md) - Living state for the estimator turn-model calibration plan, read and updated by /next-wp RM-34.
* [WP 1.1 — turn-profile contract + completed-runs percentile query](wp-1.1-turn-profile.md) - Phase 1 of item.md. Ledger: STATUS.md. Defines the measured turn profile on the wire and adds the completed-runs-only percentile query over runs.turns and output-tokens-per-turn that produces it.
* [WP 1.2 — the pure estimator consumes a measured profile](wp-1.2-estimator.md) - Phase 2 of item.md. Ledger: STATUS.md. Feeds the measured turn profile into the pure run-plan estimator, keeps maxTurns clamping last, and reports the basis on the wire.
* [WP 1.3 — launcher and suite preview show the turn basis and sample size](wp-1.3-surface.md) - Phase 3 of item.md. Ledger: STATUS.md. Makes the advisory band say where its turn model came from, so a measured estimate is distinguishable from a guessed one.
* [WP 2.1 — re-measure the band live against recorded runs](wp-2.1-calibration.md) - Phase 3 of item.md. Ledger: STATUS.md. The evidence WP: calls the live endpoint against real recorded runs and records how close the calibrated band now lands.
