---
type: "Status Ledger"
title: "Cache-aware token accounting & display — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the cache-aware token accounting plan, read and updated by /next-wp cache-aware-token-accounting."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T12:15:00Z"
status: "active"
---
# Cache-aware token accounting & display — work-package status ledger · **PRIORITY: HIGH**

Living state for the **cache-aware token accounting** plan, read and updated by
`/next-wp cache-aware-token-accounting`. A box is ticked **only** when the WP's Acceptance is met and
the gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/cache-tokens/<id>`.

> Plan + invariants in [`item.md`](./item.md). Concrete form of **AM-OB6(a)** in
> [`../RM-17-observability/amendment-2026-08-langfuse.md`](../RM-17-observability/amendment-2026-08-langfuse.md),
> but wider in scope (Testing · Suites · Compare · Estimate · workbench MCP), so it lives as its own
> item rather than folded into RM-17.

## The finding this plan exists to fix

The **accounting is already correct; the display is not.**

- `apps/api/src/testing/accounting.ts:190-248` captures the full split from the AI SDK v7 normalized
  `usage.inputTokenDetails.{cacheReadTokens,cacheWriteTokens}`, with provider fallbacks (Anthropic
  `cacheReadInputTokens`/`cacheCreationInputTokens`, OpenAI `prompt_tokens_details.cached_tokens`).
- `packages/shared/src/types.ts:1359-1370` (`TokenUsageActual`) already carries all four slices.
- `apps/api/src/providers/pricing.ts:210-234` already prices them correctly
  (`CACHE_WRITE_MULTIPLIER = 1.25`, cache read at `cachedInPer1M`), which is why an observed run
  shows **$0.80** rather than the **$3.00** a naive `958,457 × $3/M` would give.
- Anthropic caching is deliberately on — `apps/api/src/providers/registry.ts:114-132` sends
  `providerOptions.anthropic.cacheControl = { type: "ephemeral" }`.

Downstream of that, everything is cache-blind: the `kpi` run event drops `cachedTokens`
(`accounting.ts:446-451` vs `:576-587`); `runs.cached_tokens` is write-only (never mapped into
`RunSummary`, `run-repository.ts:1565-1600`); exactly **three** web files touch cached at all
(`AnalyticsPanel.tsx`, `analytics-derive.ts`, `PacketInspector.tsx`); there is **no** cached
observability measure (`constants.ts:423-441`); and the run-plan estimate re-prices the whole prefix
every turn at the full input rate (`estimate.ts:60-78`, `service.ts:77-87` discards the cache rates).

## Locked decisions

- **D-CT1 — `tokensIn` / `tokensOut` keep their current meaning** (provider-billed gross, cache slice
  included, as `types.ts:1360` already documents). Redefining them would silently rewrite every
  historical number and chart. The split is added **alongside**, never by subtraction.
- **D-CT2 — cache read and cache write are never merged in a NEW surface.** Read is a 0.1× discount,
  write is a 1.25× premium; one "cached" bar mixing them reads as savings when it may be a premium.
  The legacy merged `cachedInputTokens` stays on the wire for old rows, **tagged** (`split:
  "merged"`) so a surface says the split is unavailable rather than implying precision.
- **D-CT3 — one migration, additive and NULL-safe.** New `runs` columns are **nullable** so a
  pre-migration run reads as *absent*, never as *zero cache*. Claimed `user_version`: **59**
  (current `LATEST_SCHEMA_VERSION` is 58, `apps/api/src/db/database.ts:1849,1869`).
- **D-CT4 — no new runtime dependency, no new feature flag, no new entity kind.**
- **D-CT5 — one pricing code path.** `estimateCost` becomes a thin caller of
  `computeCostBreakdown`; a test pins `computeCostBreakdown(...).totalUsd === estimateCost(...)` so
  the two can never drift. No second cost formula anywhere, including the estimate endpoint.
- **D-CT6 — never a fake zero.** A run whose cache columns are NULL is **excluded** from a metrics
  bucket (and reported via `unavailableMeasures`), never zero-filled — the existing
  `observability/metrics.ts:571-576` rule.

## Deliberately NOT changed (flagged, not silently altered)

- **The `maxTokens` guardrail counts cache reads at par** — `apps/api/src/testing/engine.ts:573`
  (`state.tokens += usage.inputTokens + usage.outputTokens`) and the carry-over at `:815-816`. As a
  *context* budget that is right; as a *spend* budget it is wrong. The **cost**-cap guardrail is
  already cache-aware (it routes through `estimateCost`). Behaviour stays; WP 5 states it in the
  guardrail meter's tooltip. Changing it would move a safety limit.
- **Legacy rows price cache writes as reads** — `pricing.ts:218-222`: with only the merged
  `cachedInputTokens` available, all of it is treated as cache-read (0.1×). That is the only safe
  reading of a merged number, so it stays — surfaced via `CostBreakdown.split: "merged"`.

## Phase 1 — Contract & accounting

- [x] WP 1.1 — shared contract + `computeCostBreakdown` (the single pricing code path)
      — done 2026-08-21 · spec: [`wp-1.1-contract.md`](./wp-1.1-contract.md).
      **Contract + one pure extraction — no persisted number changed, no event emitted, nothing
      rendered.** Six files: a new `packages/shared/src/token-usage.ts` (`usageSplitKind`,
      `cacheHitRate`, `usageInputSlices`) with its test, one export line in `index.ts`, additive
      optional fields in `types.ts` (the `kpi` `RunEvent`, `RunSummary`, `RunReport.kpis` via its
      `Pick`, `SuiteAggregates`) plus the new `CostBreakdown`/`CostBreakdownSplit`, their zod mirrors
      + a `.strict()` `costBreakdownSchema` in `schemas.ts`, and the `estimateCost` →
      `computeCostBreakdown` extraction in `apps/api/src/providers/pricing.ts`.
      **The arithmetic is untouched** — `computeCostBreakdown` is the old `estimateCost` body with the
      four terms named and returned, and `estimateCost` now reads
      `computeCostBreakdown(...).totalUsd`. Decisions **D-CT1–D-CT6** recorded above.
      **Teeth verified red before green, then restored** (`git status` clean afterwards): (1) giving
      `estimateCost` its own arithmetic again — dropping the output term — turned **3** tests red incl.
      the D-CT5 identity; (2) wrapping `savedVsUncachedUsd` in `Math.max(0, …)` turned the
      cache-write-premium test red; (3) returning `0` instead of `null` from `cacheHitRate` for a
      merged record turned the D-CT6 test red.
      **Gate green:** `typecheck` clean · shared **250** (+12) · cli **87** · api **3573** (+6) · web
      **3702 passed / 5 skipped** · `build` clean · `lint` clean (1676 files).
      **Two judgement calls worth recording.** (a) `usageSplitKind` treats *either* half of the split
      being present as `"exact"` — deliberately mirroring the `hasSplit` test the pricing function has
      always used, so a record can never be PRICED as an exact split while being DISPLAYED as merged.
      (b) `cachedInputTokens: 0` classifies as `"none"`, not `"merged"` — a reported zero is a positive
      statement that nothing was cached, and degrading it to the lossy mode would lose real
      information. Both are pinned by tests.
      **Not verified:** nothing was run against the running app — this WP adds no route, no event and
      no UI. `FleetSuiteEntry` (`types.ts:7181`) is aggregate-shaped and was deliberately left alone;
      it is WP 3.2's call whether the fleet report carries the split.
- [x] WP 1.2 — emit the split on the `kpi` event, persist nullable run columns (migration **59**,
      backfilled from `run_steps`), map them into `RunSummary`, roll up onto `SuiteAggregates`
      — done 2026-08-21 · spec: [`wp-1.2-persistence.md`](./wp-1.2-persistence.md).
      **Migration 59** adds two NULLABLE `runs` columns and backfills them from the already-persisted
      `run_steps.usage_actual_json`. `AccountingSink` now carries the split and emits it via one shared
      `cacheKpiFields()` helper used by BOTH kpi emitters (the sink's per-turn one and the engine's
      final one at `engine.ts:902` — the latter is what `finalize` persists from, so without it the
      split reached the live console and was dropped on the way to the database).
      `toRunSummary` finally maps `cachedTokens` — a column written on every finalize since the run
      engine shipped and mapped **nowhere**, so the number was correct and no consumer could read it.
      `computeSuiteAggregates` rolls the split up **all-or-nothing**.
      **A real-data check caught a defect in the first cut of this WP.** Run against a COPY of the
      owner's 163-run database (never the live file), the backfill wrote `0/0` for **six** runs whose
      steps carry a merged `cachedInputTokens` and neither half — runs holding **107k–1.2M tokens of
      genuine cache**. That is the exact D-CT6 lie this workstream exists to remove: it asserts "no
      cache" about a run that plainly cached, and mislabels its economics too (a read is a 0.1x
      discount, a write a 1.25x premium). The backfill became a **three-way** decision — split
      reported ⇒ sum · merged-only ⇒ **NULL** (unknowable), with `cached_tokens` keeping the merged
      figure · no cache mentioned ⇒ a real `0` — and the live path grew a second flag (`sawExactSplit`
      beside `sawCacheSlice`) so it cannot make the same claim. Re-verified on a fresh copy: **unknown
      13→19, zero 8→2, `cached_tokens <> read+write` mismatches 6→0**, 141 runs recovered real reads,
      142 real writes, **0** D-CT1 violations (the split never exceeds the gross it decomposes), 163
      runs migrated in **286 ms**.
      **Teeth verified red before green, then restored** (`git status` clean): (A) `?? 0` instead of
      `?? null` on finalize → the unknown-not-zero test red; (B) `some()` instead of `every()` on the
      suite roll-up → both all-or-nothing tests red; (C) deleting the omit-when-absent guard → the
      pre-RM-33-event-verbatim test red; (D) disabling the migration backfill → the recovery test red.
      **Gate green:** `typecheck` clean · shared **250** · illustrations **252** · cli **87** · api
      **3585** (+12) · web **3702 passed / 5 skipped** · `build` clean · `lint` clean.
      **One correction made to my own work, recorded rather than quietly dropped:** a first version of
      the merged-only accounting test claimed to exercise a merged-only provider, but the CURRENT
      extractor derives `cachedInputTokens` by summing the halves and so cannot produce that shape —
      merged-only is purely historical and reaches the row through REPLAY. The test was rescoped to
      what it actually proves (silence in ⇒ silence out) and the real guard is tested where it lives,
      in `run-persistence.test.ts` and the migration.
      **Also updated:** the version-literal locks across 13 test files (58 → 59) and the `runs` column
      list in `testing-schema.test.ts`. The two new columns are appended LAST in the `schema.ts`
      baseline so a fresh DB and a migrated DB have byte-identical `PRAGMA table_info(runs)` — the
      classic v-N drift bug, now pinned by `tableShape` equality.
      **Not verified:** nothing was run against the running app, and the owner's live
      `data/app.sqlite` was NOT migrated — only a scratchpad copy. No UI reads any of these fields
      yet; that is WP 3.1.

## Phase 2 — Derived numbers

- [ ] WP 2.1 — cache-aware run-plan cost preview (range: cached prefix ↔ no caching)
      · spec: [`wp-2.1-estimate.md`](./wp-2.1-estimate.md) · depends on WP 1.1
- [x] WP 2.2 — `cacheReadTokens` / `cacheWriteTokens` / `cacheHitRate` observability measures
      — done 2026-08-21 · spec: [`wp-2.2-metrics.md`](./wp-2.2-metrics.md).
      Three measures added to `RUN_METRICS_MEASURES`; the two token ones joined
      `CAPABILITY_SPLIT_MEASURES` (same `tokens` class as `tokensIn`/`tokensOut`, so D-OB14's
      no-blending rule applies unchanged), while `cacheHitRate` stays a single unlabelled series on the
      `errorRate` precedent. `metrics.ts` selects the two v59 columns and accumulates them in a
      **separate** per-bucket map from `tokens`, with its own `n` and its own `grossIn`.
      **The separate accumulator is the design decision, not an implementation detail.** A bucket can
      hold 40 runs whose gross tokens are all known and only 12 whose split is. Sharing one
      accumulator would force a choice between dropping 28 runs from `tokensIn` or inventing a zero
      split for them. Keeping `grossIn` beside the cache sums also makes `cacheHitRate` divide
      like-for-like: on the test fixture it reads **70%** (1,400 reads / 2,000 gross of the two known
      runs) where dividing by all three runs' 7,000 gross would have read **20%** — an invented
      collapse that looks exactly like a caching regression.
      Cache **writes are excluded from the hit-rate numerator**: a write is a 1.25x premium, and
      counting it as a "hit" would render an expensive turn as a saving (D-CT2). A window holding runs
      but no known split reports the measures in `unavailableMeasures` and emits no series — neither an
      empty chart ("no runs") nor a 0% line ("caching stopped working").
      **Teeth verified red before green, then restored:** (E) zero-filling the unknown run instead of
      excluding it → 2 tests red; (F) counting writes as hits → the hit-rate test red; (G) dividing by
      every run's gross instead of the known runs' → 4 tests red.
      **Gate green:** `typecheck` clean · shared **250** · illustrations **252** · cli **87** · api
      **3589** (+4) · web **3702 passed / 5 skipped** · `build` clean · `lint` clean.
      **Deliberately not done:** no new `RunFilter` predicate. `metrics.ts` carries a documented,
      cross-check-tested REPLICA of the runs repository's `buildRunFilterWhere` (module header
      `:17-20`); adding a filter means editing both, and the measures were the ask.
      **Not verified:** no UI consumes these yet (WP 3.1), and nothing was run against the running app.

## Phase 3 — Surfaces

- [ ] WP 3.1 — one token display grammar (`TokenAmount`) across console, runs feed, suites, dashboard
      · spec: [`wp-3.1-display.md`](./wp-3.1-display.md) · depends on WP 1.2, WP 2.2
- [ ] WP 3.2 — reports, compare export, workbench MCP run summary
      · spec: [`wp-3.2-exports.md`](./wp-3.2-exports.md) · depends on WP 1.2

## Phase 4 — Record

- [ ] WP 4.1 — README capability row + CHANGELOG + `/new-docu` user-guide subject
      · spec: [`wp-4.1-record.md`](./wp-4.1-record.md) · depends on every box above

## Owner-acceptance (not tickable by an agent)

- [ ] Open a real cached run's console in **both themes**: the Tokens ↑ tile's cache sub-line, the
      Est. cost breakdown popover incl. "saved vs uncached", and the three-series Analytics stack all
      reconcile with each other and with `GET /api/reports/run/:id/json`.
- [ ] Hover a Trace turn chip — the split explains why that turn's cost sits far below list rate.
- [ ] `/dashboard` Testing tab: the cache-hit-rate series renders, and a window made only of
      **pre-migration** runs shows the measure as *unavailable*, not `0%`.
- [ ] `POST /api/estimate/run-plan` for a plan matching a finished cached run returns a range whose
      low end lands near that run's real cost and whose high end lands near its uncached cost.
- [ ] Keyboard walk of every changed surface (tooltips reachable, visible focus).

## Log

_(decisions and per-WP outcomes are appended here as boxes tick)_
