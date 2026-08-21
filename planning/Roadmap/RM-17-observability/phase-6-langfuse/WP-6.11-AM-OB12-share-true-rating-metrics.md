---
type: "Work Package Spec"
title: "WP 6.11 (AM-OB12) — share-of-verdict metrics over grades and auto-ratings"
description: "The item asks for boolean share-true metrics; the shipped rating model has no booleans, only three-valued verdicts. This makes those verdicts filterable so AM-OB4's ratio can express their share."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.11 (AM-OB12) — share-of-verdict metrics over grades and auto-ratings

## Verification finding

**This item's premise does not match the shipped data model. There are essentially no boolean grade or
rating fields to take a share of, and there is no hallucination flag anywhere in the app.**

`run_grades` (`apps/api/src/db/schema.ts:492-510`) has **no boolean column**: `status`
(`'graded'|'unevaluable'|'error'`), `score REAL` (0–1, nullable), `raw_score`, `method`, `reasoning`,
`evidence_json`, judge provenance/cost, `grading_version`, `created_at`. The `RunGrade` wire type
mirrors it exactly.

The auto-rating outputs are **three-valued enums, not booleans** (`packages/shared/src/types.ts`):

- `AnswerValidationEvidence` (`:2578-2583`) — `verdict: "answered" | "partial" | "unanswered"`
  (`ANSWER_VALIDATION_VERDICTS`, `constants.ts:1083`), plus `score: number|null`, `quotes`,
  `citedSteps`.
- `InsightSurplusEvidence` (`:2590-2597`) — `verdict: "none" | "valuable" | "noise"`
  (`constants.ts:1089`), plus `score`, `quotes`, `citedSteps`, `surplusTokens?`.
- `ErrorFinding` (`:2534-2571`) — `category`/`bucket`/`fixTarget` enums, and **the one boolean on the
  whole rating surface: `truncated?: boolean` (`:2570`)**, which is a data-quality caveat about the
  transcript, not a quality signal.
- `RunBaseRating` (`:2600-2604`) groups the three.

Elsewhere, `AssertionResult` (`:893-899`) is `status: AssertionResultStatus` — an enum, **not** a
`passed: boolean`. The only other booleans near this surface are `truncated` inside the grader
implementations (`apps/api/src/grading/answer-validation.ts:77,113,213`, `insight-surplus.ts:78`).

**There is no hallucination flag.** A repo-wide grep for `hallucin` across `apps/` and `packages/`
returns only mission-planner defences against hallucinated ids
(`apps/api/src/grading/failure-buckets.ts:142,171,176`, `issue-service.ts:232`,
`hub/missions/orchestrator.ts:296,352`) and test strings — nothing attached to a grade or a rating. The
amendment's worked example ("hallucination-flag rate") cannot be built because the flag does not exist.

The nearest genuinely boolean-shaped persisted signal is **human feedback, which is not a grade**:
`run_feedback` stores thumbs as `score` −1/+1 (`schema.ts:799`) and rubric key kinds are
`["thumbs","scale5","note"]` (`REVIEW_RUBRIC_KEY_KINDS`, `constants.ts:1590`). A thumbs share is
exactly what the declared-but-inert `feedbackRate` measure would compute — and **AM-OB4 (WP 6.4) already
owns implementing that**, so it must not be duplicated here. It is also governed by D-OB15/AR6: a
feedback share is its own lens and never a grade.

What the metrics layer exposes today: **exactly one grade-derived measure**, `meanScore`
(`apps/api/src/observability/metrics.ts:341`, `:397-424`, `:631-633`). No count-of-verdict, no
share-true, no per-verdict breakdown. A windowed watch rule's measure vocabulary is
`RUN_METRICS_MEASURES` **verbatim** — `watchWindowConfigSchema` uses `z.enum(RUN_METRICS_MEASURES)`
(`packages/shared/src/schemas.ts:1248-1259`) and the editor renders the same array
(`apps/web/src/features/watch/RuleEditorDialog.tsx:393-396`) — and evaluation delegates entirely to
`computeRunMetrics` (`apps/api/src/watch/engine.ts:395-428`). So **a windowed rule cannot evaluate any
grade or rating verdict over a window today**, because no such measure exists.

And the filter grammar cannot name one either: `RunFilter`
(`packages/shared/src/schemas.ts:1026-1063`, `.strict()`) has 33 fields — `scoreGte`, `scoreLte`,
`grader` and `feedback{key,hasScore}` are the only grading-adjacent ones. **There is no verdict,
bucket, fix-target or rating-state field.**

**Verdict: NOT BUILT — and the item needs reframing before it is buildable.**

The honest reframe, which delivers the operator value the item was reaching for: **make the rating
verdicts expressible in `RunFilter`, and let AM-OB4's ratio compute their share.** "What fraction of
runs came back `unanswered` this week" is then a ratio with a numerator filter — no fourteenth bespoke
measure, no boolean invented to fit a shape the data does not have.

## Goal

Afterwards an operator can ask "what share of runs on this environment came back unanswered", "what
share produced noise instead of insight", or "what share tripped a given error bucket" — and can put a
watch rule on the answer, so a quality drift shows up as an alert rather than as something noticed by
accident three weeks later.

## Scope

- **`packages/shared` — extend `RunFilter` with the rating dimensions**, additively: the answer
  verdict (`ANSWER_VALIDATION_VERDICTS`), the insight verdict (`INSIGHT_SURPLUS_VERDICTS`), and the
  error-forensics bucket / fix target (`ROOT_CAUSE_BUCKETS` `constants.ts:1057`, `FIX_TARGETS`
  `:1067`). Each is an array field matching the existing style (`status`, `outcome`,
  `stopReasonCode`). The vocabularies **already exist and are frozen** — reuse them, do not mint new
  ones.
- **`packages/shared/src/run-filter.ts` — teach `matchesRunFilter` the new fields.** This is the pure
  predicate the watch engine evaluates per run without SQL, and it is the anchor for the SQL
  cross-check.
- **The two SQL translations** — `apps/api/src/observability/metrics.ts:48-183` and the module-private
  copy at `apps/api/src/testing/run-repository.ts:1490-1651`. The verdict lives inside
  `run_grades.evidence_json`, so this needs a JSON extraction in a join, and it must be indexed
  thoughtfully or it will be the slowest filter in the grammar. **Verify query cost at pickup against
  the 500 ms budget the ledger records for WP 1.2.**
- **Once the fields exist, the share is a ratio** — nothing further is needed in the measure
  vocabulary, because AM-OB4's ratio takes a numerator filter. This is the whole reason this WP depends
  on that one.
- **The filter bar** (`apps/web/src/features/testing/runs/RunFilterBar.tsx`) gains controls for the new
  dimensions, so the operator can reach them from the feed as well as from a chart config.

## Files

Modify:

- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended** (`runFilterSchema` is `.strict()`)
- `packages/shared/src/run-filter.ts` (`matchesRunFilter`)
- `packages/shared/src/run-filter.test.ts`
- `apps/api/src/observability/metrics.ts` — ⚠ **highly contended with AM-OB4**
- `apps/api/src/testing/run-repository.ts` — ⚠ **contended**
- `apps/api/test/runs-filter.test.ts` (the 35-case cross-check table gains the new fields)
- `apps/api/test/metrics-runs.test.ts`
- `apps/web/src/features/testing/runs/RunFilterBar.tsx`
- `apps/web/src/features/testing/runs/RunFilterBar.test.tsx`

Untouched on purpose: `apps/api/src/grading/**` (the graders are not changed — this reads what they
already persist), `apps/api/src/db/**`.

## Non-goals

- **No invented boolean.** Do not add a `hallucinated` flag, and do not collapse a three-valued verdict
  into a boolean to make a "share-true" fit — `partial` is not `false`, and flattening it would destroy
  the distinction the grader exists to make.
- **`feedbackRate` belongs to AM-OB4**, which implements it as the first instance of the ratio
  machinery. Do not implement it here too.
- **D-OB15 / AR6 hold.** Making a verdict filterable does not make human feedback a grade, and a
  feedback-numerator ratio stays a separate lens that never enters `meanGrade`, `passRateAt05`, scatter,
  suite aggregates or issue scoring.
- No new grader, no re-rating of historical runs, no change to `grading_version`.
- No fourteenth bespoke measure. If this WP finds itself adding one, the ratio is not doing its job and
  that is a signal to stop and reconsider.

## Dependencies

- **Hard dependency on AM-OB4 (WP 6.4)** — the ratio measure is what turns a filterable verdict into a
  share. Without it this WP delivers filtering only, which is useful but is not the item.
- Depends on shipped WP 1.1 (the filter grammar), WP 1.2 (metrics) and the auto-rating work in
  **RM-06** (which produced the verdict vocabularies) — all done.
- ⚠ Shares `metrics.ts` with AM-OB4 and `run-repository.ts` with nothing else in Phase 6. **Run
  strictly after AM-OB4; never batched with it.**

## Migration

**None.** `RunFilter` is a wire contract, not a table, and the verdicts are already persisted inside
`run_grades.evidence_json`. `apps/api/src/db/{database,schema}.ts` must be a zero-line diff and no
`user_version` is claimed.

⚠ If the JSON extraction turns out too slow to meet the recorded 500 ms metrics budget, the answer is
an **index** — which *is* a migration, and would make this a migration-bearing WP. Measure before
assuming, and if it becomes one, say so in the batch plan and claim the next free `user_version`
properly.

## Acceptance

1. `RunFilter` can express each new rating dimension; `runFilterSchema` accepts them and still rejects
   unknown keys (`.strict()`).
2. `matchesRunFilter` and **both** SQL translations agree on every new field — the
   `apps/api/test/runs-filter.test.ts:658` cross-check table is extended and, per AM-OB4's acceptance,
   runs against `computeRunMetrics` as well. **Deliberately break one branch and watch the table go
   red before ticking.**
3. A ratio measure with a verdict numerator returns the correct share against hand-counted fixture
   rows, and a bucket with a zero denominator is omitted or null — never `0` (conventions §2).
4. A windowed watch rule can threshold that ratio, and its historical preview reflects the same values.
5. Query cost for a verdict-filtered metrics query is measured and reported against the recorded
   500 ms budget; if an index is needed, it is added as a properly claimed migration rather than
   quietly skipped.
6. **AR6 / D-OB15 guard:** a test asserts that adding a verdict filter or a feedback-numerator ratio
   leaves `meanScore`, `run_grades` and every suite aggregate byte-identical.
7. The filter bar exposes the new dimensions and they round-trip through `?filter=` unchanged (the
   existing byte-stability tests still pass).
8. No new measure was added to `RUN_METRICS_MEASURES` — asserted by a test on the constant's length, so
   a future agent cannot quietly reintroduce the bespoke-measure path.
9. Both themes and a keyboard pass over the new filter controls — or recorded as an owner-acceptance
   line rather than claimed.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
