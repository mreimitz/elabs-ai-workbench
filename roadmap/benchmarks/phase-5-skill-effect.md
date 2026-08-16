# Phase 5 — Skill-effect A/B (WP spec)

## WP 5.1 — Suite variant axis + per-test delta view
**Size:** L · **Depends on:** 3.4 · shared + API + Web

**Objective:** answer "does attaching skill X make the agent better, cheaper, or both?" with
the same suite run — the payoff of combining Skills (Phase 2 attachment) with grading, and a
feed for SkillFlow's fracture→suggestion loop.

**Files:** `packages/shared` (additive `SuiteConfig.variants?: SuiteVariant[]` — a variant =
`{ label, scenarioId, skillOverrides: { attach?: {skillId, versionId|'latest'}[], detach?:
skillId[] } }`); orchestrator: the matrix gains the variant axis (tests × variants ×
repetitions; a variant resolves to the base scenario with skill attachments overridden at
run-resolution time — `apps/api/src/testing/resolution.ts` + `skill-context.ts` reused, engine
untouched); analytics: `GET /api/suite-runs/:id/deltas?base=<variantLabel>` (per-test delta of
grade/tokens/cost vs the base variant, mean over repetitions, spread disclosed). Web: a
**Variants** section in the suite editor (base + N variants, skill pickers reusing the scenario
attachment UI) and a **Delta tab** on the suite-run console (per-test table: base vs variant
grade/tokens/cost with signed deltas, `tabular-nums`; roll-up header; link into the skill's
Trace tab for fractured runs).

**Rules:** variants never mutate the underlying scenario row — overrides live in the suite-run
config snapshot (a past suite run replays its exact variant definitions). A variant referencing
a deleted skill fails validation at run start, not mid-suite. Grading/judge settings identical
across variants (the comparison must be apples-to-apples; judge override applies suite-wide).

**Acceptance:** stubbed orchestrator test: matrix cardinality with variants, override resolution
(attached skill present in one variant's runs, absent in base — asserted from run skill
records); delta endpoint hand-computed on fixtures; live walk: a 2-test suite × (base, +skill)
shows a readable delta table; both themes; gate green.
