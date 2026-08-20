---
type: "Work Package Spec"
title: "WP 5.2 \u2014 Trace \u2192 suggested SKILL.md edit (feedback loop)"
description: "Phase: 5 \u00b7 Size: M \u00b7 Depends on: 4.1, 5.1"
tags: ["roadmap", "RM-23"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.2 — Trace → suggested SKILL.md edit (feedback loop)

**Phase:** 5 · **Size:** M · **Depends on:** 4.1, 5.1

## Objective
Close the loop: from a fracture verdict, generate a **suggested edit** to the skill — presented as
a reviewable WP 4.1 edit-op set (with diff preview), never auto-applied. Deterministic suggestions
first; optional LLM-assisted suggestions are **owner-gated** and clearly labelled.

## Why / references
The architecture's end state: trace → insight → skill improvement. WP 4.1 gives the safe apply
path (anchored ops → new immutable version); WP 5.1 gives the fracture taxonomy to key suggestions
off.

## Files
- `apps/api/src/skillflow/suggestions.ts` *(create)* — deterministic rules keyed by verdict class:
  missing-marker gatekeeper → suggest the breadcrumb instruction sentence (WP 3.2 convention);
  loop fracture → suggest a loop-guard annotation with the observed count; asset never visited →
  suggest referencing or removing it; failed gate with a consistently different route taken →
  suggest updating the routing condition text. Output = `{ verdictRef, rationale, ops: EditOp[] }`.
- `apps/api/src/skillflow/routes.ts` *(modify)* — `GET /api/skills/:id/versions/:vid/suggestions?
  runId=…|sessionId=…` (pure, derived from the alignment).
- **LLM-assisted branch (owner-gated, may be deferred to its own follow-up WP):** if approved,
  reuse the existing Testing provider credentials to draft prose-level suggestions for drift-style
  fractures; results labelled `origin: 'llm'`, never mixed silently with deterministic ones, and
  never required for the feature to function.
- `apps/web/src/features/skills/trace/SuggestionCard.tsx` *(create)* — per-fracture suggestion
  card in the evidence pane: rationale + diff preview → "Apply as new version" (routes through the
  WP 4.2 save dialog, same review + note flow).
- `apps/api/test/skillflow-suggestions.test.ts` *(create)* — one fixture per rule; ops validate
  against WP 4.1 (applying a suggestion round-trips); no suggestion invents content for verdicts
  it has no rule for.

## Acceptance
- [ ] Every deterministic rule produces applicable ops (verified by running them through the
      round-trip engine in tests); suggestions are advisory — nothing applies without the explicit
      WP 4.2 save flow.
- [ ] The demo loop works end-to-end: run → red node → suggestion → apply → new version → re-run →
      green (fixture-level in tests; live walk is the owner acceptance).
- [ ] LLM branch absent or owner-approved + labelled; deterministic path fully functional without
      any model call (D7).
- [ ] Repo gate green.

## Notes
This completes the plan's north star. Keep suggestion rules conservative — a wrong suggestion
erodes trust in the whole tracer; "no suggestion" is a valid output.
