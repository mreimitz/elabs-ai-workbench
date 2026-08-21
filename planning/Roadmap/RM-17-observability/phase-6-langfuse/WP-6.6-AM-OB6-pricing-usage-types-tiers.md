---
type: "Work Package Spec"
title: "WP 6.6 (AM-OB6) — pricing scope-up: usage types, tiers, and a drift check"
description: "Reasoning/audio/image usage types through accounting and pricing, condition-evaluated price tiers on top of effective-dating, and a price-drift check that files an issue. The migration-bearing item of Phase 6."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.6 (AM-OB6) — pricing scope-up: usage types, tiers, and a drift check

## Verification finding

**The pricing editor shipped and is solid. All four parts of this item are unbuilt, and part (d) has
nothing to build against.**

The shipped pricing editor (WP 2.6) — do not rebuild any of this:

- Table `model_pricing` (`apps/api/src/db/schema.ts:922-936`), created and seeded by migration
  **v44** (`apps/api/src/db/database.ts:1158-1198`). Columns: `id`, `provider`, `model_match`,
  `is_regex`, `input_per_mtok`, `output_per_mtok`, `cache_read_per_mtok`, `cache_write_per_mtok`,
  `effective_from`, `created_at`, `source ('seed'|'user')`.
- `PricingRepository` (`apps/api/src/providers/pricing-repository.ts:33`) with `list` `:36`,
  `create` `:53`, `update` `:97`, `delete` `:133` and **`resolve(model, opts)` `:140`**. Resolution
  order (documented `:5-11`): rows matching the model **and** `effective_from <= at`; exact beats
  regex; newest `effective_from` wins within a tier, so a future-dated row is inert.
- Routes `apps/api/src/providers/pricing-routes.ts:17`; Settings UI `PricingSection()` at
  `apps/web/src/features/settings/SettingsView.tsx:2072` (registered `:174`, `:271`, rendered
  `:680-681`); client wrappers `apps/web/src/lib/api.ts:654-671`; wire types
  `packages/shared/src/types.ts:2178`/`:2199`/`:2211`. Eleven tests at
  `apps/api/test/pricing-editor.test.ts`.

Part by part:

**(a) Usage types — reasoning is captured but never priced; audio and image do not exist at all.**

- `MODEL_PRICING` entries carry exactly three fields — `{ inPer1M, outPer1M, cachedInPer1M? }`
  (`apps/api/src/providers/pricing.ts:279-286`). The resolved shape adds one more, DB-only:
  `ResolvedPrice = { inPer1M, outPer1M, cachedInPer1M?, cacheWritePer1M? }` (`:129-134`). **No
  reasoning, audio or image rate on either type.**
- `computeCostBreakdown` (`pricing.ts:231`) → `computeCostBreakdownForPrice` (`:254`) prices **four
  terms only** (`:270-292`): uncached input, cache read, cache write (`CACHE_WRITE_MULTIPLIER`
  `:186`), output. **`reasoningTokens` is never read by the formula.**
- Reasoning tokens **are** captured: `extractProviderUsage` reads
  `usage.outputTokenDetails?.reasoningTokens` (`apps/api/src/testing/accounting.ts:210`, OpenAI raw
  fallback `:233-234`, written `:253`), accumulated `:63`/`:472`, emitted into report totals `:564`,
  on the wire at `types.ts:1377`, rendered in `PacketInspector.tsx:271,293,408` and
  `ConversationPane.tsx:458,507`. They are simply **not priced and not a `runs` column** and not a
  metrics measure.
- **Audio and image are absent everywhere.** A repo-wide grep for
  `audioTokens|imageTokens|audio_tokens|image_tokens|inputAudio|cachedAudio` across `apps/` and
  `packages/` returns **zero hits**. No modality dimension exists in usage, pricing, or schema.
- The one seam to extend is `extractProviderUsage` (`accounting.ts:197`), whose own doc block at
  `:180-195` states "**All provider field knowledge lives in this ONE switch**".

**(b) Tiers — no tier or condition concept exists.** `model_pricing` has no conditions column, no
context-length threshold, no volume tier. Effective-dating is the only dimension. (The word "tier" in
`pricing-repository.ts:8-9` is prose about match specificity, not price tiers.)

**(c) Price drift — no check exists, and the rating-issue registry cannot currently hold the result.**
`fileManualRatingIssue(issues, input)` (`apps/api/src/grading/issue-service.ts:384`, input type
`:359-372`) is the programmatic filing API, already used by the Assistant's `rating_issue_file` action
(`apps/api/src/assistant/tools/action-tools.ts:227`). But `targetKind` is constrained to
`["skill","mcp_server"]` — `RATING_ISSUE_TARGET_KINDS` (`packages/shared/src/constants.ts:1515`)
**and** a DB `CHECK (target_kind IN ('skill','mcp_server'))` (`apps/api/src/db/schema.ts:528`) — and
`runId` is required (`issue-service.ts:368`, it supplies a NOT NULL contributing-run link). **A price
drift has neither a skill/server target nor a run.** Neither `ROOT_CAUSE_BUCKETS`
(`constants.ts:1057`) nor `FIX_TARGETS` (`:1067`) has a pricing member.

**(d) Provider-ingested cost — there is nothing to take precedence over anything.** Every dollar in
the app is inferred from tokens × price. Even the subscription path shadow-prices:
`claude-subscription-executor.ts:835` does `totals.costUsd += estimateCost(model, usageActual)`, with
`:35-38` and `:795-798` calling it a shadow reference. `providerCost` has **zero** hits repo-wide. The
only place a provider-reported charge is even referenced is `apps/api/scripts/assistant-smoke.ts:93`,
which `console.log`s the Agent SDK's `total_cost_usd` in a dev script and never persists it.
`CostBasis` is `"api_exact" | "subscription_reference"` (`types.ts:1443`) — and `"api_exact"` means
"the tokens were metered by a paid API", **not** "the provider told us the dollars" (`:1431-1442`).
The only precedence machinery that exists is `resolvePrice`'s DB-over-code fallback
(`pricing.ts:163-179`).

Binding constraints from RM-33 (`planning/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md`):

- **D-CT5 — one pricing code path.** `computeCostBreakdown` is the app's single cost formula;
  `estimateCost` (`pricing.ts:306-311`) is a one-line caller. There are ~18 indirect call sites (the
  run accounting sink `accounting.ts:460`, the spend guardrail `engine.ts:582,819,824`, the
  subscription executor, hub turn engine + orchestrator, seven judge ledgers, the suite report service,
  the compatibility session). A source-grep test pins it: `apps/api/test/estimate.test.ts:333-360`
  asserts `estimate.ts` holds no `Per1M` arithmetic and no `1e6`/`1_000_000` of its own; the identity
  test is `apps/api/test/pricing.test.ts:245`. **Every new usage type must be priced inside
  `computeCostBreakdownForPrice`, nowhere else.**
- **D-CT2 — a cache read and a cache write are never merged in a new surface.** They are two terms with
  opposite economics (a ~0.1× discount and a 1.25× premium). `CostBreakdownSplit`
  (`types.ts:1391`) reports `"exact" | "merged" | "none"` so a caller can tell a real split from a
  legacy merged row.
- **D-CT6 — absent means unknown, never zero.** Migration v59 (`database.ts:1882-1935`) added
  **nullable** `runs.cache_read_tokens` / `cache_write_tokens` and its backfill deliberately leaves
  merged-only rows NULL rather than zeroing them.

**Migration head is v59** (`apps/api/src/db/database.ts:1882`, `LATEST_SCHEMA_VERSION` auto-derived at
`:1939`). **Next free `user_version` is 60** — re-verify at claim time against sibling ledgers.

**Verdict: NOT BUILT.**

## Goal

Afterwards the bench's cost figures stop being blind to how models are actually billed in 2026: a
reasoning-heavy run costs what it really cost, a model whose price steps up above a context threshold
is priced at the right step, and if a provider changes a published rate the bench notices and says so
instead of quietly reporting stale dollars for months.

## Scope — four separable parts

This is the largest item in Phase 6 and the only one that needs a migration. **The four parts are
genuinely separable**; if the owner wants a smaller unit of work, split at these seams rather than
descoping within a part.

**(a) Usage types — additive, through one seam.**
Extend `TokenUsageActual` (`packages/shared/src/types.ts:1367-1378`) with the modality/type fields the
AI SDK already exposes, extend `extractProviderUsage` (`accounting.ts:197` — the one switch) to
populate them, extend `ResolvedPrice` and `computeCostBreakdownForPrice` (`pricing.ts:254`) with the
matching rate terms, and add the columns to `model_pricing`. **Reasoning first** (it is already
captured and is a real 2026 cost driver); audio and image only if a provider the bench actually uses
reports them — an unpopulated rate column is worse than no column.
**D-CT2 by analogy:** each new usage type is its own term with its own rate; do not fold reasoning
into `outputTokens` and do not present one merged "extras" figure.
**D-CT6 by analogy:** a run with no reported reasoning tokens is *unknown*, not zero — the accounting
must not manufacture a 0 that a chart would render as "no reasoning used".

**(b) Price tiers on top of effective-dating.**
A condition-evaluated tier means a `model_pricing` row can carry a predicate (initially: an input-size
threshold) that must hold for the row to be a candidate. Implement it **inside
`PricingRepository.resolve`** (`pricing-repository.ts:140`), extending the documented candidate rule
(`:5-11`) with one more filter step — a tier is more specific than a plain row, and ties still break by
`effective_from`. The predicate vocabulary must be **closed and tiny** (one condition kind to start);
this is a pricing table, not a rules engine.
Note this changes `resolve`'s signature to need the usage being priced, which is a real ripple: verify
every `resolvePrice` caller at pickup.

**(c) A price-drift check that files an issue.**
Deterministic, scheduled through the existing in-process ticker (conventions §10 — the scheduler is
honest about downtime and marks late work "while you were away"). It compares the effective resolved
price per model against a reference and files a finding on divergence.
**Two decisions to make and record, because the registry does not fit today:**
1. `RATING_ISSUE_TARGET_KINDS` is `["skill","mcp_server"]` in *both* a shared constant
   (`constants.ts:1515`) and a DB CHECK (`schema.ts:528`), and `runId` is required. A price-drift
   finding is neither. Either widen the vocabulary (**a migration, and a change to a security-adjacent
   frozen list — owner-gated**) or file the finding somewhere else. **Recommended: do not widen the
   rating-issue registry.** A drift is an operations alert, not a run-quality issue; the honest home is
   the shipped notification centre (`apps/api/src/watch/notifications.ts`), which already has an
   in-app inbox and needs no new vocabulary.
2. **Where the reference price comes from.** Fetching provider price pages from the API process is a
   network dependency inside the runtime boundary and is **owner-gated** — it is the one part of this
   item that could introduce outbound traffic the bench does not have today. The offline alternative is
   to diff the DB against the in-code `MODEL_PRICING` table (`pricing.ts:279-286`), which catches
   "someone edited a price and forgot why" and needs no network at all. **Recommended: start
   offline.**

**(d) Provider-ingested cost takes precedence — RECOMMEND DROPPING.**
There is no ingested cost anywhere in the app to give precedence to. The single provider-reported
charge that exists (`total_cost_usd` in `assistant-smoke.ts:93`) is `console.log`ged by a dev script.
Building a precedence rule now means building the losing half of a comparison that has no winning
half — and `CostBasis` would need a third member to say "the provider told us", which is a wire change
in service of no data. **Revisit when a provider the bench uses actually returns an authoritative cost
into a persisted path.** If the owner keeps it, it must be sequenced *after* whatever first ingests a
real cost, not before.

## Files

Add:

- `apps/api/src/providers/price-drift.ts` (part c)
- `apps/api/test/price-drift.test.ts`
- `apps/api/test/pricing-tiers.test.ts`

Modify:

- `apps/api/src/db/database.ts` — ⚠ **MIGRATION-BEARING, see below**
- `apps/api/src/db/schema.ts` — ⚠ **MIGRATION-BEARING**
- `apps/api/src/providers/pricing.ts` (`ResolvedPrice`, `computeCostBreakdownForPrice`, `MODEL_PRICING`)
- `apps/api/src/providers/pricing-repository.ts` (`resolve` candidate rule)
- `apps/api/src/providers/pricing-routes.ts`
- `apps/api/src/testing/accounting.ts` (`extractProviderUsage` — the one provider switch)
- `apps/api/src/watch/scheduler.ts` (part c tick)
- `apps/api/src/watch/notifications.ts` (part c, on the recommended path)
- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended**
- `packages/shared/src/constants.ts` — ⚠ **contended**
- `apps/web/src/features/settings/SettingsView.tsx` (the `PricingSection` form gains the new rate
  fields and the tier condition) — ⚠ large shared file
- `apps/api/test/pricing.test.ts`, `apps/api/test/pricing-editor.test.ts`,
  `apps/api/test/estimate.test.ts`, `apps/api/test/migrations.test.ts`

⚠ **Every `LATEST_SCHEMA_VERSION` literal in existing tests moves.** The ledger records six such
version-lock bumps for a single migration (WP 1.3's 32→33). Expect the same and do not weaken an
assertion to avoid it.

## Non-goals

- **No second cost formula.** D-CT5 is absolute: pricing arithmetic lives in
  `computeCostBreakdownForPrice` and nowhere else, and `apps/api/test/estimate.test.ts:333-360` will
  catch a violation in `estimate.ts` (note: that grep is scoped to that one file — do not read it as
  whole-tree protection).
- **No merging of cache read and cache write**, and no merging of a new usage type into an existing
  one (D-CT2).
- **No zero-filled usage.** An unreported usage type is unknown (D-CT6).
- No retroactive re-pricing of historical runs. `runs.cost_usd` is what was computed at the time; a
  price correction changes future computation, not the past.
- No general condition/rules language in the pricing table.
- No change to the `maxTokens` guardrail's par-counting of cache reads — RM-33 explicitly left that
  behaviour alone (`STATUS.md:65-72`) because it is a *context* budget, and changing it moves a safety
  limit.

## Dependencies

- Depends on shipped observability WP 2.6 (the pricing editor) and on **RM-33** in full
  (`planning/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md` — D-CT1–D-CT6). Read that
  ledger before starting; it is binding, not background.
- **AM-OB8 depends on this WP** for its per-span cache/usage-type segment stacks. AM-OB8's "scale bars
  by tokens/cost" half does not.
- ⚠ Shares `packages/shared/**` with most of Phase 6 and `metrics.ts`-adjacent surfaces with AM-OB4 /
  AM-OB12. **Runs alone.**

## Migration

**YES — and this is the migration-bearing work package of Phase 6.** Say so loudly in the batch plan:
**exactly one migration-bearing WP may be in flight at a time** (conventions §8).

- Verify the next free `user_version` **at claim time**, against `apps/api/src/db/database.ts`
  `MIGRATIONS` **and** every sibling `planning/Roadmap/*/STATUS.md` ledger. As read for this spec the
  head is **v59** (`database.ts:1882`) so the next free is **v60** — re-verify, do not trust this
  number.
- **Record the claim in the RM-17 STATUS decision log before writing the migration.**
- New rate columns on `model_pricing` and the tier predicate follow the **v59 column pattern**:
  `ensureColumn` + a `tableExists` guard in the migration, and the same columns appended to the end of
  the `schema.ts` baseline column list, so `PRAGMA table_info` matches on both the fresh-DB and
  upgrade paths. If part (c) needs a new table instead, follow the **v40/v43/v44/v45 pattern**:
  identical DDL **and** indexes in both `schema.ts` and the migration step, because `applyMigrations`
  runs every step even on a fresh DB stamped at 0 (`database.ts:1164-1169`, `:1954-1970`).
- Both paths tested (`apps/api/test/migrations.test.ts`).
- **If the owner chooses to widen `RATING_ISSUE_TARGET_KINDS`** for part (c), that is a *second*
  schema change (the `CHECK` at `schema.ts:528`) touching a frozen vocabulary — treat it as
  owner-gated and prefer the notification-centre alternative.

## Acceptance

1. A reasoning-token rate is stored per pricing row, resolved by `PricingRepository.resolve`, and
   priced as **its own term** inside `computeCostBreakdownForPrice` — asserted by a test that a
   reasoning-heavy usage record costs more than the same record without reasoning.
2. **D-CT5 holds:** the identity `computeCostBreakdown(...).totalUsd === estimateCost(...)`
   (`apps/api/test/pricing.test.ts:245`) still passes, the four-term re-sum test (`:249-258`) is
   extended to the new terms, and the `estimate.ts` source-grep (`estimate.test.ts:333-360`) still
   passes. No new file contains `Per1M` arithmetic.
3. **D-CT2 holds:** no new surface merges cache read with cache write, and no new usage type is folded
   into an existing figure — asserted by a test over the breakdown shape.
4. **D-CT6 holds:** a usage record with no reported reasoning/audio/image is `undefined` in the
   breakdown, not `0`, and is excluded from (not zero-filled into) any aggregate.
5. A tiered row applies only when its condition holds; when it does not, resolution falls through to
   the untiered row for the same model, and effective-dating still breaks ties. A future-dated tier is
   still inert.
6. The drift check runs on the scheduler, detects a divergence on a seeded fixture, and files exactly
   one finding (deduplicating on re-run rather than filing daily) — with no outbound network call in
   the test (conventions §12).
7. The Settings pricing form edits the new fields and the tier condition in both themes with a keyboard
   pass — or recorded as owner-acceptance rather than claimed.
8. Migration: the claimed `user_version` is recorded in the RM-17 decision log; fresh-DB and
   upgrade-from-previous paths both tested green; every moved `LATEST_SCHEMA_VERSION` literal in
   existing tests is updated without weakening an assertion.
9. Part (d) is either explicitly dropped in the decision log with the reason, or implemented against a
   real ingested-cost source — **not** implemented speculatively.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
