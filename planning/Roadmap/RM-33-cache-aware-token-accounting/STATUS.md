---
type: "Status Ledger"
title: "Cache-aware token accounting & display — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the cache-aware token accounting plan, read and updated by /next-wp cache-aware-token-accounting."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T17:20:00Z"
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

- [x] WP 2.1 — cache-aware run-plan cost preview (range: cached prefix ↔ no caching)
      — done 2026-08-21 · `wp/cache-tokens/2.1` · spec: [`wp-2.1-estimate.md`](./wp-2.1-estimate.md).
      The launcher's dollar preview charged every input token at full list rate and re-charged the
      re-sent prefix on every turn. Measured against the owner's run `4LnBMey0w53EnDRNG__TH` —
      958,457 gross input tokens, actually billed **$0.798** — it predicted **$3.00**, ~3.8×. It now
      reads **$0.744–$2.917**.
      **The dollar band's dimension changed, deliberately: it spreads on CACHING, not on turns.**
      Low models the re-sent prefix as one cache write (1.25×) plus reads (~0.1×); high is the old
      full-rate arithmetic, unchanged to the cent. Both ends sit at the same (high) turn count so they
      are comparable, and the turn spread stays on the TOKEN band where it always was. This was forced
      by the spec's own acceptance #2 (`no cachedInPer1M ⇒ low === high`) — a turn spread can never
      collapse. **Checked before merging:** the only consumer (`SuiteDetail.tsx:554`) renders the band
      as an unlabelled `low–high (estimate)` beside the token range, so no caller was relying on the
      turn reading.
      `low`/`high` are **min/max, not "cached is cheaper"**: on a one-turn plan the whole prefix is a
      1.25× write with no read to offset it, so caching genuinely costs more and the old number becomes
      the LOWER bound. The band brackets both rather than asserting an order the arithmetic does not
      always produce. `computeCostBreakdownForPrice` was extracted so the estimator cannot re-enter
      `resolvePrice` behind its service's back — D-CT5 is tighter than before.
      **Validated by the orchestrator, not taken on report:** diff reviewed; gate re-run in the
      worktree (typecheck clean · api **3601** pass / 0 fail · build · lint); and **two teeth broken by
      hand** — adding a second cost formula to `estimate.ts` (only the D-CT5 source-grep test caught
      it, which is exactly why that test exists) and restoring the service's price narrowing that
      caused the original defect (only the route-level test caught it) — each confirmed red, then
      restored. The acceptance fixture's arithmetic was **re-derived independently**:
      66,883×3 + 832,540×0.3 + 59,034×3.75 + 8,447×15, /1e6 = **$0.7984935**, the persisted cost
      exactly — which also cross-checks WP 1.1's pricing formula against a real bill.
      **Not verified:** nothing visual — this WP adds no UI, and the band was checked numerically
      against a recorded run. The estimator's turn ceiling (8) and flat 350-tokens/turn output model
      mean it can never reproduce a 19-turn run's totals; the fixture matches gross INPUT exactly and
      absorbs the rest in a stated 10% tolerance. Re-modelling turns was explicitly out of scope.
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

- [x] WP 3.1 — one token display grammar (`TokenAmount`) across the console, runs feed and suites
      — done 2026-08-21 · spec: [`wp-3.1-display.md`](./wp-3.1-display.md).
      **`apps/web/src/components/TokenAmount.tsx`** is the app's FIRST token formatter — before it,
      `lib/format.ts` had none and ~15 sites each hand-wrote `formatNumber(x)` plus a literal `↑`,
      which is precisely why the cache composition could not be surfaced consistently. It renders the
      GROSS figure unchanged and carries the breakdown in a tooltip, with three distinct behaviours:
      an **exact** split names uncached / cache read (~0.1×) / cache write (**1.25×, a premium**) plus
      the hit rate; a **merged** record says the split is unavailable rather than guessing; and **no
      cache reported** renders byte-identically to the markup it replaced.
      **Converted:** KPI rail (both tiles + the context popover's new indented cache rows), Trace
      chips (`TraceNode`/`trace-tree` — where a cache-inclusive token count sat beside a
      cache-discounted cost with nothing to reconcile them), Turns lens, Step log's Tokens ↑ column,
      Packet inspector (`Cached input` → the two named halves; `Input` relabelled **gross** so the
      rows below read as a decomposition, not an addition), the runs feed cell + a new opt-in
      **Cache hit** column, and the suite KPI rail.
      **Analytics is now three series, not two.** `deriveCachedTokenRows` returns
      uncached / cacheRead / cacheWrite, with a merged-only turn routed to its own labelled series.
      The Overview "Cached" tile's description changed from "900 of input" — which says nothing about
      whether that was a discount or a premium — to "800 read · 100 written".
      **The relationship note now answers the question that started this workstream.** It read
      "Tokens ↑/↓ are cumulative sends/receives…"; it now adds "counted gross — 96.8% of what was sent
      was served from cache and billed at a fraction of the rate", and reverts to the old wording
      verbatim when the split is unknown (test-pinned).
      **One a11y decision reversed mid-build, on the linter's advice and after re-thinking it.** The
      first cut made the figure `tabIndex={0}` so a keyboard user could reach the tooltip, mirroring
      `IconButton`. `a11y/noNoninteractiveTabindex` flagged it and was RIGHT: a runs table renders
      dozens of token cells, and each becoming a tab stop turns scanning into an obstacle course. The
      tab stop is gone; the breakdown is not, because the `sr-only` node is always in the DOM and
      wired via `aria-describedby` — so assistive tech and touch (where a tooltip never fires) both
      get it. The opposite trade-off from `IconButton`'s disabled-reason stop is deliberate: there the
      reason is otherwise unreachable, here it is not. Recorded in the component's docblock.
      **Teeth verified red before green, then restored:** (H) attributing a merged figure to
      cache-read → red; (I) netting the gross figure by the cached slice → 3 red; (J) folding cache
      write into the read series → 2 red; (K) attributing a merged chart row to cacheRead → red.
      **Tooth J initially did NOT bite** — no test covered the new three-series derivation, so I wrote
      seven (`deriveCachedTokenRows`) and re-ran it. Worth recording: the teeth check found a real
      coverage gap, not just a passing formality.
      **Gate green:** `typecheck` clean · shared **250** · illustrations **252** · cli **87** · api
      **3589** · web **3726 passed / 5 skipped** (+24 web) · `build` clean · `lint` clean.
      **VERIFIED AGAINST THE RUNNING APP, both themes.** The built API was started on port 8099
      against an ISOLATED COPY of the owner's database in the scratchpad — the live `data/app.sqlite`
      was never opened, never migrated and never written. Chromium screenshots at 1600×1100 in
      `light` and `dark` (the theme set through the app's real `brand-ui-theme` +
      `mcp-token-footprint.theme-preference` keys, so `ThemeProvider` genuinely applies it).
      On run `SHsiRblmacvEOJi4gkalE` (369,841 gross input):
      the Tokens ↑ tile reads **"sent · 96.2% from cache"**; the relationship note reads *"…counted
      gross — 96.2% of what was sent was served from cache and billed at a fraction of the rate"*; and
      the Analytics **"Input token composition"** panel's accessible description reads *"Uncached: 9.
      Cache read: 355,791 (billed ~0.1×). Cache write: 14,041 (billed 1.25× — a premium). 96.2% served
      from cache"* — 9 uncached tokens out of 369,841. Both themes render correctly.
      **Three defects the screenshots caught that the test suite did not**, each fixed and re-verified:
      (1) **the rail showed no cache line at all on a real run** — a finished console REPLAYS its
      persisted `kpi` events, and every pre-RM-33 run's events carry no cache fields, so the fields
      never reached the rail even though migration v59 had recovered them; fixed with
      `withCacheFromSteps`, which fills them in from the per-step `usageActual` the steps have always
      carried (this is the path almost every console view actually takes, so without it WP 3.1 would
      have shipped visibly doing nothing); (2) **a tripled arrow** — the tile's label already says
      "Tokens ↑" and it carries an ArrowUp icon, so the value's affix was noise; dropped; (3) **the
      three-series chart had no legend**, making a cache read indistinguishable from a cache write at
      a glance — which is the one distinction the split exists to make; added `CompositionLegend`,
      which names each colour with what it costs and lists only the series actually present.
      **Still not verified:** a keyboard walk (owner-acceptance below), and the dashboard panel, which
      moved to WP 3.3 rather than being quietly dropped.
      **Pre-existing, not introduced:** `KpiRail.test.tsx` emits two "nested `<p>`" React warnings;
      the count is identical before and after this WP (verified by stashing the file), and the cause
      is the Est. cost tile, which this WP does not touch.

- [x] WP 3.3 — the Testing dashboard's built-in cache panel — done 2026-08-21 ·
      `wp/cache-tokens/3.3` · spec: [`wp-3.3-dashboard.md`](./wp-3.3-dashboard.md).
      A **Prompt cache** panel beside Tokens: grouped bars for cache reads (~0.1×) against writes
      (1.25×), each labelled with what it costs, plus a hit-rate line on its own right-hand % axis. No
      combined "cached" figure anywhere, so a premium can never read as a saving. A bar drills into the
      runs feed scoped to that bucket's window; the capability class stays out of the filter (the
      `TokensPanel` precedent — it is an accounting facet, not a `RunFilter` dimension).
      **The load-bearing case, verified on REAL data rather than a fixture:** the owner's database has
      a genuine pre-v59 window, and over it the API returns all three measures in `unavailableMeasures`
      while `count` still emits points. The panel renders **"Cache split not measured"** with copy that
      says why — *"Shown as unmeasured rather than as a zero, because a zero here would look exactly
      like caching that had stopped working."* Never a 0% line, never a bare empty chart.
      **Validated by the orchestrator:** scope checked (nothing outside `apps/web/src/features/dashboard/`);
      full gate re-run on the MERGED result (typecheck clean · shared **250** · illustrations **582** ·
      cli **87** · api **3601** · web **3752 passed / 5 skipped** · build · lint); **two teeth broken by
      hand** — ignoring `unavailableMeasures` (4 red) and merging the write series into the read key
      (4 red) — each confirmed and restored; and the panel **re-screenshotted independently in both
      themes** against the running app on an isolated DB copy, showing 51,879,269 read vs 6,909,927
      write over a 141-run window, plus the not-measured state over the legacy window.
      **Two judgement calls recorded:** the tooltip reads `n/a` for an absent value where `TokensPanel`
      uses `?? 0` (here absent means "nobody measured"; a *reported* zero still reads `0`); and the
      legend deliberately carries no window-wide hit-rate number, because the API's per-bucket `n` is a
      run count, not the gross-token denominator, so weighting by it would be indefensible arithmetic.
      **Not verified:** no human keyboard-focus walk of this panel (a datapoint was activated by real
      `focus()` + Enter and the drill fired, but the focus ring was not inspected), and no rendered
      hover tooltip — the dashboard suite's chart stub no-ops `ChartTooltip`, so `cacheTooltipRows` is
      proven by unit test only.
      **An orchestrator note, not a defect:** on the dashboard's DEFAULT 7-day range the owner's data
      has zero runs, so the whole Testing tab shows "No runs in this window" and no panel renders at
      all. That is correct behaviour; it is recorded here because it made the first verification pass
      look like a missing panel until the range was widened.
      WP 3.1's spec included a dashboard cache-hit-rate chart; it is NOT built, so its box stays open
      rather than being ticked inside a WP that did not deliver it.
      **What already works without it:** `RUN_METRICS_MEASURES` is the single source for BOTH the
      custom chart composer (`ChartComposerDialog.tsx:386`) and the windowed watch-rule editor
      (`RuleEditorDialog.tsx:393`), and both iterate it directly — so as of WP 2.2 an operator can
      already compose a cache-hit-rate chart and set an alert on it ("cache hit rate ≤ 50% over 24h")
      with no further code. What is missing is only the BUILT-IN panel and its drill-down.
      **Scope when picked up:** request the three measures alongside `tokensIn`/`tokensOut` in
      `use-testing-dashboard-data.ts`, extend `buildTokensResult`, and render the unavailable state —
      never a 0% line — when the API reports the measures in `unavailableMeasures`.
- [ ] WP 3.2 — reports, compare export, workbench MCP run summary
      · spec: [`wp-3.2-exports.md`](./wp-3.2-exports.md) · depends on WP 1.2

## Phase 4 — Record

- [ ] WP 4.1 — README capability row + CHANGELOG + `/new-docu` user-guide subject
      · spec: [`wp-4.1-record.md`](./wp-4.1-record.md) · depends on every box above

## Owner-acceptance (not tickable by an agent)

- [x] Open a real cached run's console in **both themes** — done 2026-08-21 by screenshot against an
      isolated copy of the real database (see WP 3.1). The Tokens ↑ sub-line, the relationship note
      and the three-series Analytics stack all agree at 96.2%, and match
      `GET /api/runs/:id`'s `cacheReadTokens`/`cacheWriteTokens`.
      **Still owner's to judge:** whether the wording and the chart colours read well to you.
- [x] Hover a Trace turn chip — done 2026-08-21, verified in **both themes** against the running app
      (isolated DB copy, never the live file). On run `SHsiRblmacvEOJi4gkalE` the Trace tab renders 25
      cache-bearing chips; hovering Turn 1's `34,735↑` opens *"Uncached: 3 · Cache read: 34,732 (billed
      ~0.1×) · 100.0% served from cache"*. That turn's cost chip reads **$0.0126** where 34,735 tokens
      at list rate would be ~$0.104 — the chip and the cost now reconcile, which was the specific
      complaint (a cache-inclusive token count sitting beside a cache-discounted cost with nothing to
      connect them). The same text is also present as an `sr-only` node on every chip, so it reaches
      assistive tech and touch without a hover.
      **Still owner's to judge:** whether the tooltip wording reads well to you.
- [ ] `/dashboard` Testing tab: the cache-hit-rate series renders, and a window made only of
      **pre-migration** runs shows the measure as *unavailable*, not `0%`.
- [ ] `POST /api/estimate/run-plan` for a plan matching a finished cached run returns a range whose
      low end lands near that run's real cost and whose high end lands near its uncached cost.
      **Blocked until WP 2.1 is built** — the estimate endpoint is still cache-blind.
- [x] Keyboard walk — done 2026-08-21, driven against the running app (isolated DB copy). Measured on
      the run console's Trace lens, which renders the densest concentration of token figures:
      **26** figures carry a cache breakdown · **0** of them are tab stops · **26/26** resolve to real
      `aria-describedby` description text · **40** tab stops walked with **0** lacking a focus
      indicator · **0** tab stops are a bare token number.
      That is the evidence for WP 3.1's reversed a11y decision: the breakdown is reachable by assistive
      tech and by touch (both of which get the `sr-only` copy without hover), while a Trace table of
      dozens of numbers adds **no** new tab stops. The one focusable element that also carries a
      description is the context-window `IconButton` — focusable on purpose, since its disabled reason
      is otherwise unreachable.
      **Still owner's to judge:** driving it by hand, and whether the focus order feels right.

## Log

_(decisions and per-WP outcomes are appended here as boxes tick)_
