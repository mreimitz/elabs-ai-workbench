---
type: "Work Package Spec"
title: "WP 3.1 \u2014 Step hierarchy: parentStepId + spanKind wire + emitters"
description: "Phase: 3 \u2014 Console depth \u00b7 Size: L \u00b7 Depends on: \u2014 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.1 — Step hierarchy: parentStepId + spanKind wire + emitters

**Phase:** 3 — Console depth · **Size:** L · **Depends on:** — · **Model:** Opus
**Gate:** owner-gated — `roadmap/unified-sessions/` Wave 1 merged (executors settle first; this WP touches the same emit paths).

## Objective

Steps become a tree where real nesting exists (D-OB17): rating/judge calls under a rating span,
MCP roundtrip detail under its tool-call step, compatibility probes under their step —
forward-only, replay-safe, enabling true per-subtree rollups (3.2).

## Design

- Wire (`packages/shared`, additive): `RunStep` gains optional `parentStepId` and
  `spanKind` (`turn | tool_call | tool_io | rating | judge_call | probe | context_event | …` —
  derive the exact union from existing step types + new children). `step` RunEvent carries them.
- Persistence: MIGRATION (claim next free version) — nullable `parent_step_id`, `span_kind` on
  `run_steps` (+ index on parent). Old rows null ⇒ flat (never backfilled).
- Emitters (each behind the existing choke points, no executor-local sequencing changes):
  - Auto-rating pipeline emits a `rating` span step per run review with its judge calls as
    children (`judge_call`) carrying model/duration/token detail where known.
  - MCP tool bridge emits optional `tool_io` child steps (request/response sizes + timing)
    under the existing tool-call step — engine path only (subscription child owns its MCP
    internally; vendor has no tools — capabilities already say so).
  - Compatibility probe runs attach their probe steps under a `probe` parent.
- Ordering invariant: children carry normal monotonic `seq`/`index`; the tree is a rendering of
  parent links, never a reordering. Replay of mixed old/new runs stays stable.

## Files

- `packages/shared/src/{types,schemas}.ts`
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `apps/api/src/testing/{run-manager,run-repository,tool-bridge}.ts`,
  `apps/api/src/grading/grade-service.ts` (rating span emission),
  `apps/api/src/compatibility/runner.ts`
- Tests: per-emitter tree shape, old-run flat replay, seq monotonicity with children

## Acceptance

- [ ] New runs produce the documented tree shapes (fixture per emitter); parent links always
      reference an earlier step of the same run (validated at persist).
- [ ] Pre-migration runs replay flat and unchanged (regression fixture).
- [ ] No change to grading contracts or `assistantText` byte-identity (existing tests green).
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

High blast radius (shared + run persistence + grading emission) — runs SOLO. UI consumption is
3.2; nothing renders differently after this WP alone.
