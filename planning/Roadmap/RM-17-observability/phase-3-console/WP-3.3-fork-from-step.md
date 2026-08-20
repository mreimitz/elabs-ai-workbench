---
type: "Work Package Spec"
title: "WP 3.3 \u2014 Fork-from-step: rerun endpoint + overrides + lineage"
description: "Phase: 3 \u2014 Console depth \u00b7 Size: L \u00b7 Depends on: 1.1 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.3 — Fork-from-step: rerun endpoint + overrides + lineage

**Phase:** 3 — Console depth · **Size:** L · **Depends on:** 1.1 · **Model:** Opus
**Gate:** owner-gated — `roadmap/unified-sessions/` Wave 1 merged (forked runs run under its clock/terminal contract).

## Objective

The bench-native "Open in Playground" (D-OB18): fork a run at a step with edited
prompt/model/temperature/skill-version into a NEW, fully persisted, gradeable, comparable run —
lineage-linked, previewed for cost, excluded from suite aggregates.

## Design

- API: `POST /api/runs/:id/rerun {fromStepId?, overrides?: {prompt?, model?, temperature?,
  skillVersionId?}}` →
  1. Validates: source run terminal; not a suite member (409, D-OB18); overrides against the
     environment (model must resolve for the same provider kind; `vendor_assistant` supports
     whole-run rerun only — capabilities decide, clear 422 otherwise).
  2. Reconstructs the conversation prefix up to `fromStepId` from persisted steps (byte-exact
     messages; the same replay-derivation discipline existing report/legacy projections use)
     and seeds a new engine run with that prefix + overridden final user prompt/params.
     `fromStepId` omitted ⇒ whole-run re-launch with overrides (works for every kind).
  3. Creates the run with `derived_from_run_id` + `fork_step_id` (MIGRATION — claim next free
     version), stamped normally (capabilities, the unified-sessions clock, rating pipeline all apply).
- Exclusions: suite aggregates/analytics ignore derived runs (they're never members); the runs
  feed hides them by default via RunFilter `derived` (1.1 reserved it) with a "show forks"
  chip.
- Estimate first: the console flow calls `POST /api/estimate/run-plan` with the fork plan and
  shows the preview before launch.
- Console UI: "Fork from here" on turn steps (capability-gated: `followUps`/engine kinds for
  mid-run fork; header "Re-run with changes" for whole-run) → dialog (prompt editor, model
  select from the environment's provider, temperature, skill version select) → preview → launch
  → navigates to the new console with a lineage banner ("Forked from run … at step …", link
  back). Compare workspace: "Compare with parent" chip pre-seeds parent vs derived.

## Files

- `apps/api/src/testing/{routes,run-service}.ts` + a new `fork.ts` (prefix reconstruction) (+ tests)
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `packages/shared/src/{types,schemas}.ts` (rerun wire, lineage fields — additive)
- `apps/web/src/features/testing/` fork dialog + lineage banner + feed "show forks" chip;
  Compare pre-seed wiring; `apps/web/src/lib/api.ts`
- Tests: prefix byte-identity, override validation matrix, suite-member 409, vendor 422 for
  mid-run, lineage persisted + filtered, estimate-preview invoked

## Acceptance

- [ ] Fork at step N: new run's seeded prefix is byte-identical to the parent's steps ≤ N
      (fixture assert); overridden prompt/params applied; stubbed engine completes and the
      derived run grades normally.
- [ ] Whole-run rerun works for all three kinds (stubbed); mid-run fork correctly refused where
      capabilities say so.
- [ ] Suite member fork → 409; derived runs absent from suite analytics fixtures and hidden by
      default in the feed.
- [ ] Lineage renders both directions (banner + parent's "forks" indicator) and Compare
      pre-seeds.
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Executor surgery + shared + migration ⇒ SOLO batch. Keep reconstruction in `fork.ts`, pure and
unit-tested — it is the risky heart of this WP.
