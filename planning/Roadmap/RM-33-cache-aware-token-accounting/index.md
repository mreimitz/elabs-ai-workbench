# Cache-aware token accounting & display

## Concepts

* [Cache-aware token accounting & display](item.md) - Surface the prompt-cache composition (uncached / cache read / cache write) behind every token and cost figure in the app, roll the split up onto runs and suites so it is filterable and chartable, and make the launch cost preview cache-aware.
* [Cache-aware token accounting & display — work-package status ledger · PRIORITY: HIGH](STATUS.md) - Living state for the cache-aware token accounting plan, read and updated by /next-wp cache-aware-token-accounting.
* [WP 1.1 — the cache-aware contract: kpi/summary/aggregate fields, CostBreakdown, one pricing code path](wp-1.1-contract.md) - Phase 1 of item.md. Ledger: STATUS.md. Contract-only: shared types + zod, plus computeCostBreakdown extracted from estimateCost.
* [WP 1.2 — emit, persist and roll up the cache split (migration 59)](wp-1.2-persistence.md) - Phase 1 of item.md. Ledger: STATUS.md. Emits the split on the kpi event, persists nullable run columns backfilled from run_steps, maps them into RunSummary, rolls them up onto SuiteAggregates.
* [WP 2.1 — cache-aware run-plan cost preview](wp-2.1-estimate.md) - Phase 2 of item.md. Ledger: STATUS.md. Stops the estimate endpoint re-pricing the whole prefix at full rate every turn; returns a range bracketing cached and uncached.
* [WP 2.2 — cacheReadTokens / cacheWriteTokens / cacheHitRate observability measures](wp-2.2-metrics.md) - Phase 2 of item.md. Ledger: STATUS.md. Makes the cache split chartable over time, excluding pre-migration runs rather than zero-filling them.
* [WP 3.1 — one token display grammar: TokenAmount across console, runs feed, suites and dashboard](wp-3.1-display.md) - Phase 3 of item.md. Ledger: STATUS.md. Introduces the app's first token formatter and converts every hand-written token display to it, so the cache split is one hover away everywhere.
* [WP 3.2 — reports, compare export and the workbench MCP run summary](wp-3.2-exports.md) - Phase 3 of item.md. Ledger: STATUS.md. Carries the cache split and cost breakdown into every machine-readable surface.
* [WP 3.3 — the Testing dashboard's built-in cache panel](wp-3.3-dashboard.md) - Phase 3 of item.md. Ledger: STATUS.md. Split out of WP 3.1 rather than dropped: charts the cache measures on the dashboard, with the unavailable state instead of a fake 0%.
* [WP 4.1 — front page, changelog and the user-guide subject](wp-4.1-record.md) - Phase 4 of item.md. Ledger: STATUS.md. The §11 hard rule: the front page follows the work, in the same commit as the last tick.
