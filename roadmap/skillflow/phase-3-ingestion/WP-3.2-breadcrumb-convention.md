# WP 3.2 — Breadcrumb convention + gatekeeper verdict hardening

**Phase:** 3 · **Size:** M · **Depends on:** 3.1

## Objective
Turn gatekeeper misrouting detection from inference into **exact matching**: define the breadcrumb
convention (a trivial marker line a skill instructs the agent to emit at each gatekeeper decision),
detect it in both trace sources, and harden gatekeeper verdicts around it — including
expected-vs-actual route evidence.

## Why / references
D7(b). Without markers, gatekeeper verdicts rely on downstream deterministic signals (which
sub-routine's tools fired next); with markers they become exact. The convention must be something
Design Mode can inject (Phase 4) and any hand-written skill can adopt with one line of prose.

## Files
- `roadmap/skillflow/breadcrumb-convention.md` *(create)* — the spec: marker syntax (e.g. a single
  line `[skillflow:gate=<nodeId> route=<edgeId>]` emitted in assistant prose), the SKILL.md
  instruction sentence that requests it, matching rules (per-gatekeeper anchored ids from the
  graph IR), and the explicit degradation story for skills **without** markers (inference-only
  verdicts are labelled lower-confidence, never invented).
- `packages/shared/src/constants.ts` *(modify)* — marker regex/prefix constants (additive).
- `apps/api/src/skillflow/run-trace.ts` + `session-ingest.ts` *(modify)* — emit `marker` events on
  detection in assistant text (both sources, one shared matcher).
- `apps/api/src/skillflow/aligner.ts` *(modify)* — gatekeeper verdicts: marker present → exact
  expected-vs-actual route comparison (mismatch = fracture with both routes in the verdict
  `reason`); marker absent → existing inference path, verdict flagged `confidence: 'inferred'`
  (additive field).
- `apps/api/src/skillflow/annotations.ts` *(modify)* — a `skillflow:gate` annotation marks a
  heading as a gatekeeper and pins its stable node id (so marker ids survive reordering).
- `apps/api/test/skillflow-breadcrumbs.test.ts` *(create)* — marker parse (both sources), exact
  match, mismatch fracture, no-marker degradation, id stability across a heading move.

## Acceptance
- [ ] One documented convention; matcher shared by both normalizers; ids stable via annotation
      pinning.
- [ ] Gatekeeper verdicts distinguish exact vs. inferred confidence (additive contract field);
      mismatches carry expected + actual route evidence.
- [ ] Zero-marker skills keep working exactly as in Phase 2 (D2 — no regression for plain
      uploads).
- [ ] Repo gate green.

## Notes
The convention doc is a deliverable — Phase 4's editor and Phase 5's suggested edits both build on
it. Keep the marker trivially cheap (a few tokens) — it rides in every gated turn.
