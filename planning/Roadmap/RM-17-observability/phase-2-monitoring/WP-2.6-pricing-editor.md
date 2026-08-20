---
type: "Work Package Spec"
title: "WP 2.6 \u2014 Pricing editor: model pricing map \u2192 DB + Settings UI"
description: "Phase: 2 \u2014 Monitoring surfaces \u00b7 Size: M \u00b7 Depends on: \u2014 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.6 — Pricing editor: model pricing map → DB + Settings UI

**Phase:** 2 — Monitoring surfaces · **Size:** M · **Depends on:** — · **Model:** Opus

## Objective

Model pricing stops requiring a code edit (D-OB22): a DB-backed pricing map with regex model
matching and effective dates, editable in Settings, with the code table as the seed — and the
invariant that already-recorded run costs are NEVER rewritten.

## Design

- MIGRATION (claim next free version): `model_pricing(id, provider, model_match TEXT [exact or
  regex, flagged], input_per_mtok REAL, output_per_mtok REAL, cache_read_per_mtok REAL NULL,
  cache_write_per_mtok REAL NULL, effective_from TEXT, created_at, source TEXT
  CHECK('seed'|'user'))`. Seed rows generated from `providers/pricing.ts` at migration time.
- Resolution: `resolvePricing(provider, model, at)` — most-specific match (exact > regex),
  newest `effective_from <= at` wins; falls back to the code table if the DB has no match
  (belt-and-braces), logs when fallback happens. All existing cost-computation call sites
  (engine accounting, estimate service, launch preview) switch to the resolver; run rows keep
  storing computed `costUsd` at run time — historical costs never recomputed (LangSmith
  invariant, test-enforced).
- Settings UI: a Pricing card — table of entries (provider, match, prices, effective date,
  source chip), add/edit/duplicate/delete for `user` rows; `seed` rows read-only but
  overridable by a newer user row. Unpriced-model guardrail behavior unchanged (a model with no
  match still rejects costed runs).
- Wire: additive CRUD `GET/POST/PATCH/DELETE /api/pricing` with zod validation (regex compile
  check server-side).

## Files

- `apps/api/src/providers/pricing.ts` (becomes seed + fallback), new
  `apps/api/src/providers/pricing-repository.ts` + routes wiring
- `apps/api/src/testing/accounting.ts` / estimate service call sites (resolver adoption)
- `apps/api/src/db/{database,schema,rows}.ts` (migration + seed)
- `packages/shared/src/{types,schemas}.ts` (additive)
- `apps/web/src/features/settings/SettingsView.tsx` + pricing card component
- Tests: resolution precedence, effective dating, regex safety, fallback, historical-cost
  immutability, CRUD, unpriced rejection unchanged

## Acceptance

- [ ] Seeded DB reproduces the code table's prices exactly (parity test across all seed rows).
- [ ] Precedence: exact > regex; newest effective_from wins; future-dated entries inert until
      their date (fake clock test).
- [ ] Editing a price changes NEW run costs only; a persisted run's costUsd is byte-identical
      after any pricing edit (regression test).
- [ ] Invalid regex rejected 400; CRUD round-trips; Settings card functional.
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Money correctness is the review focus — hence Opus despite the modest size. Independent of the
metrics chain; schedulable early whenever the migration slot is free.
