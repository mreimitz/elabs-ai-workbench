---
type: "Work Package Spec"
title: "WP 2.2 — advisor and quality thresholds, and the model merge chains, into the pack"
description: "Phase 2 of item.md. Ledger: STATUS.md. Only the unsafe-if-missing fallbacks stay compiled in."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:38:00Z"
status: "final"
---
# WP 2.2 — advisor and quality thresholds, and the model merge chains, into the pack

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). **Depends on WP 1.2.**
Independent of WP 2.1 — the two may run in parallel worktrees; they share no file.

## Scope

1. **`data-pack/advisor/thresholds.json`** — from `apps/api/src/advisor/rules/`:
   `DESCRIPTION_SHARE_THRESHOLD` (0.5), `MIN_DESCRIPTION_TOKENS` (100), `TOP_TOOLS` (5),
   `HIGH_SCAN_SHARE` (0.3) / `MEDIUM_SCAN_SHARE` (0.15), `OVERLAP_SIMILARITY_THRESHOLD` (0.7),
   `MEDIUM_OVERLAP_COUNT` (3), `HIGH_WASTE_SHARE` (0.5) / `MEDIUM_WASTE_SHARE` (0.2) — which appear
   **twice**, in `unused-tool-trim.ts` and `quality-validated-trim.ts`, and must become one keyed entry
   each, not two — plus `SUITE_RUN_WINDOW` (20), `PROVENANCE_SUITE_RUN_LIMIT` (10),
   `EVIDENCE_TOOL_LIMIT` (10), `EVIDENCE_RUN_LIMIT` (3).

   **Rule order stays in code.** `ADVISOR_RULES` in `registry.ts` is the first-wins dedup tie-break and
   is a behavioural contract, not a tunable — leave it.

   Each rule's recommendation prose already quotes its own thresholds (e.g. description-bloat's
   `"bloat" means a description is at least …`). Those strings must read the pack values, so an edited
   threshold cannot produce a report that misdescribes itself.

2. **`data-pack/quality/thresholds.json`** — from `packages/shared/src/constants.ts`:
   `DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING` (500), `DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING` (5000),
   `QUALITY_SEVERITY_WEIGHTS`, `DEFAULT_COMPARE_THRESHOLD` (0.6), `DEFAULT_LOOP_THRESHOLD` (3),
   `FAILURE_BUCKET_SCORE_THRESHOLD` (0.5), and `WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET` (3500) from
   `packages/shared/src/workbench-mcp.ts`.

   The two skill-quality ceilings already have env overrides (`SKILL_QUALITY_L1_TOKEN_CEILING` /
   `_L2_`) resolved in `apps/api/src/config/env.ts`. Precedence becomes **env → pack → compiled
   default**, and that order is asserted by test.

3. **`data-pack/models/overrides.json`** — the merge-chain layers that are pure data:
   `LEGACY_MODEL_CONTEXT_LIMITS` and `ROSTER_GAP_MODEL_CONTEXT_LIMITS` (`constants.ts:1249`/`:1297`),
   `LEGACY_MODEL_PRICING`, `ROSTER_GAP_MODEL_PRICING`, `ZERO_PRICE_MODELS` (`pricing.ts`),
   `MODEL_ID_ALIASES` and `DEFAULT_HEATMAP_MODELS` (`dataset.ts:28`/`:89`), and
   `ASSISTANT_DEFAULT_MODEL_ROSTER` + `ASSISTANT_DEFAULT_TITLE_MODEL` (`constants.ts:1575`/`:1617`).

   **The merge precedence is unchanged and is contract:** legacy → roster-gap → generated dataset,
   with the DB-backed `PricingRepository` resolver still winning over all of it. Moving the layers must
   not reorder them.

## D-DP3 — what does NOT become pack-only

`MODEL_CONTEXT_LIMITS` and the priced-model table keep a compiled-in floor. An unknown context window
disables a guardrail silently; an unpriced model makes `isModelPriced()` false, which **refuses** a
cost-capped run (issue #10) and makes `estimateCost()` return `0`, so a mission's `shouldAutoApprove`
compares planned spend against $0. A pack that fails to load must not be able to cause either. The
compiled floor is therefore a merge base, not a fallback that only applies when the pack is absent.

## Explicitly out of scope

`RUN_PLAN_ESTIMATE_*` and the turn-profile percentiles. RM-34 proved the estimator wrong on a second
axis (mode-blind per-turn prefix, intercept 93k–175k tokens high) and left a named follow-up; moving
those constants now would relocate a known-wrong model and make the follow-up harder to attribute.
Also out: `SKILL_MAX_*` ingest caps (they are a security limit on untrusted input, already env-tunable),
and `TOKEN_COUNTING_VERSION`.

## Acceptance

- [ ] **Byte-identity**: an advisor report over the existing fixtures, a skill quality report, and a
      compatibility heatmap are byte-identical before and after.
- [ ] The duplicated `HIGH_WASTE_SHARE` / `MEDIUM_WASTE_SHARE` pair becomes one definition; a
      source-scan test fails on a second copy (this repo's own lesson from the two `buildRunFilterWhere`
      copies).
- [ ] Advisor recommendation prose quotes the resolved pack values — change a threshold in a test pack
      and the sentence changes with it.
- [ ] Env → pack → compiled precedence proved for the two skill-quality ceilings.
- [ ] `pnpm mcp:self-scan` still passes with the budget read from the pack, and an edited budget in a
      test pack changes the verdict.
- [ ] Merge order for context limits and pricing is unchanged, asserted by a test that would fail if
      the layers were reordered.
- [ ] Gate green.

## Teeth

1. Reorder the model merge layers in the loader → the order test goes red.
2. Delete the compiled context-limit floor and load a pack missing a model → the guardrail-still-armed
   test goes red (D-DP3).
3. Edit `OVERLAP_SIMILARITY_THRESHOLD` in a test pack → the advisor report's matched-tool count and its
   quoted prose both move together.
