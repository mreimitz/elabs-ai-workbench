---
type: "Work Package Spec"
title: "WP 5.2 \u2014 LLM assist for issue clustering (opt-in)"
description: "Phase: 5 \u2014 Fleet issues \u00b7 Size: M \u00b7 Depends on: 5.1 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.2 — LLM assist for issue clustering (opt-in)

**Phase:** 5 — Fleet issues · **Size:** M · **Depends on:** 5.1 · **Model:** Opus

## Objective

An opt-in LLM pass over deterministic clusters (D-OB20): merge near-duplicate issues, write
human titles/summaries, and suggest priority — through the existing CLI-first judge chain, on
its own concurrency, with its own cost ledger. OFF by default; deterministic results remain the
substrate.

## Design

- Trigger: manual ("Refine with AI" on the issues list / per issue) and an optional
  setting to run after each sweep (default OFF). Never blocks the sweep.
- Pass over open issues: input = cluster key parts + top-N linked-run forensics summaries
  (schema-constrained prompt, mirroring the error-forensics prompt discipline); output
  (zod-validated) = {mergeGroups: [[issueId,…]], title, summary, suggestedPriority, rationale}.
  Merges are recorded as merge links (reversible — an unmerge restores originals; deterministic
  keys keep accruing to their own rows underneath).
- Judge resolution: the existing CLI → provider → skip chain (`grading/judge-chain.ts`),
  **its own semaphore + setting** (not `AUTO_RATING_MAX_CONCURRENCY` — the unified Q7 lesson),
  cost recorded to the separate judge cost ledger (B5 discipline) and shown in issue settings.
- Provenance: AI-written title/summary marked (`aiAssisted: true`, model + timestamp);
  deterministic fallback text always retained.

## Files

- `apps/api/src/grading/issue-assist.ts` (new) + issue-service/routes extension
- `apps/api/src/config/env.ts` (+.env.example) — assist concurrency/enable
- `packages/shared` (assist wire — additive)
- `apps/api/test/issue-assist.test.ts` (fake JudgeGenerate: merge/title/priority parsing,
  unmerge restore, cost ledger rows, OFF-by-default)

## Acceptance

- [ ] With a fake judge: merges apply + unmerge restores; titles/summaries stamped as
      aiAssisted; suggested priority surfaces but never auto-applies.
- [ ] Chain fallback + skip behavior per judge-chain contract; own semaphore proven (judge gate
      busy ≠ assist blocked and vice versa); costs land in the judge ledger.
- [ ] Default OFF; sweep unaffected when assist errors (isolation test).
- [ ] Gate green.

## Notes

**Owner-gated for live validation** (real CLI/subscription or provider key) — stub-tested only
in the gate; listed under owner-acceptance. Schema-constrained output is the review focus.
