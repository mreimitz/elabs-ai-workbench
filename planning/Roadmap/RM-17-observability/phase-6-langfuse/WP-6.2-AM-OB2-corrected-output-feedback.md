---
type: "Work Package Spec"
title: "WP 6.2 (AM-OB2) — corrected_output as a feedback kind, feeding promote-to-test"
description: "A human-supplied corrected answer stored as a first-class feedback key, surfaced in the console and review queue, pre-filling the expectation on promote-to-test, and carried in the exported report."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.2 (AM-OB2) — `corrected_output` as a feedback kind, feeding promote-to-test

## Verification finding

**The storage already exists. The capture, the plumbing, and the two recorded follow-ups it rides on do not.**

What is on `main`:

- **The `run_feedback` table already accepts this datum unchanged.** `apps/api/src/db/schema.ts:807-818`
  defines `key TEXT NOT NULL DEFAULT 'verdict'`, a nullable `score REAL`, **and a nullable free-text
  `comment TEXT`**. The table comment (`schema.ts:796-806`) states outright that arbitrary keys are
  allowed and that the upsert identity is application-enforced.
- **The key space is open, not a frozen union.** `RunFeedback.key` is `string`
  (`packages/shared/src/types.ts:2133-2151`); `runFeedbackInputSchema`
  (`packages/shared/src/schemas.ts:1078-1091`) validates `key` as `z.string().trim().min(1).optional()`
  with **no enum**, and `.refine`s only that *at least one* of `score`/`comment` is present — so a
  comment-only row is already valid. `packages/shared/src/constants.ts` holds **no** list of allowed
  feedback keys. The literal `"verdict"` is hardcoded in three places
  (`apps/api/src/observability/feedback.ts:29`, `apps/web/src/features/testing/FeedbackControl.tsx:31`,
  `apps/web/src/features/testing/RunBar.tsx:501`) rather than living in `shared`.
- **The writer exists.** `RunFeedbackRepository.upsert` (`apps/api/src/observability/feedback.ts:50`)
  upserts on `(run_id, step_id, key, source='human')` via `findExisting` (`feedback.ts:105-121`);
  routes are `GET`/`POST /api/runs/:id/feedback` and `DELETE /api/runs/:id/feedback/:feedbackId`
  (`apps/api/src/observability/routes.ts:123-141`). `POST /api/runs/:id/feedback` with
  `{ key: "corrected_output", comment: "…" }` **persists and reads back today, with no code change at
  all.**
- **The review queue already writes free text through this exact path.** A `note`-kind rubric key calls
  `putRunFeedback(runId, { key, comment })` with no score
  (`apps/web/src/features/review/ReviewView.tsx:271`, called from `:333`/`:505`); rubric key kinds are
  `REVIEW_RUBRIC_KEY_KINDS = ["thumbs", "scale5", "note"]` (`constants.ts:1590`).

What is **not** on `main`:

- **No capture affordance for a corrected answer.** `FeedbackControl.tsx` hardcodes `key: VERDICT_KEY`
  on both its write paths (`:76-104` thumbs, `:106-127` note), so there is no way to write any other
  key from the console. `RunFeedbackHeader` (`RunBar.tsx:493-512`) and the per-turn controls
  (`ConversationPane.tsx:180-184`, `use-turn-feedback.ts:29`) filter to `key === "verdict"`.
- **The promote-to-test REST endpoint does not exist.** `promoteRunToTest(deps, runId, collectionId)`
  (`apps/api/src/watch/promote.ts:38`) is reached from exactly two callers — the watch action executor
  (`apps/api/src/watch/actions.ts:108`, `case "promote_to_test"`) and the assistant tool
  `tests_create_draft` (`apps/api/src/assistant/tools/issue-loop-tools.ts:39,318`). **No
  `POST /api/runs/:id/promote-to-test` route is registered anywhere in `apps/api/src`** — a repo-wide
  grep finds the literal in only two API files, both of them comments in `issue-loop-tools.ts`. The web
  client (`apps/web/src/lib/api.ts:1693-1697`) issues a real POST and its own doc block at `:1684-1693`
  marks itself **STUBBED**; the console button (`RunBar.tsx:479` → `PromoteToTestMenu` `:521-540` →
  `apps/web/src/features/watch/PromoteToTestDialog.tsx`) therefore **404s in production** and passes
  only against a mocked fetch. This is the ledger's own recorded follow-up (`STATUS.md:459-464`,
  `:665-666`).
- **The exported report carries no `humanFeedback` block.** `grep -rn "feedback"` over
  `apps/api/src/reports/` and `packages/shared/src/report-derive.ts` returns **zero** matches;
  `createRunJsonReport` (`apps/api/src/reports/reports.ts:188-199`) and `assemble()`
  (`apps/api/src/reports/run-report-assembly.ts:63-84`) inject no feedback source, and the `RunReport`
  type (`types.ts:2614-2640`) has no feedback field. This is the ledger's WP-2.5 deferral
  (`STATUS.md:308`, `:667-668`).
- **`promoteRunToTest` copies the source test's expectations verbatim** (`promote.ts:49-50`), and its
  `PromoteDeps` (`promote.ts:25-32`) holds only `runs`, `tests`, `testRepo` — no feedback repository.

One trap for the implementer: **`fetchRunFeedbackSummaries` selects only `run_id, key, score`**
(`feedback.ts:167-205`), so a comment-only `corrected_output` row surfaces on `RunSummary.feedback` as
`{ key, score: null }` **with the text dropped**, and `FeedbackSummaryChip` returns `null` for
`score === null`. Any surface that needs the corrected text must call the full
`GET /api/runs/:id/feedback` list, not the summary.

**Verdict: PARTIALLY BUILT — residual only.**

Residual: (1) name the key once in `shared` and add a capture affordance in the console + review queue;
(2) **register the missing `POST /api/runs/:id/promote-to-test` route** and give `promoteRunToTest` a
feedback read so a corrected answer pre-fills `expectations.expectedInsight`; (3) add the
`humanFeedback` block to the run report, JSON and Markdown; (4) make the summary path honest about a
text-only row. **No migration is required** — this corrects the Phase 6 ledger header's expectation
that AM-OB2 would need one.

## Goal

Today an operator who reads a bad answer can leave a thumbs-down and a note, but the note is an opinion
attached to a run and nothing downstream can use it. Afterwards they can write **the answer the run
should have given**, in the console or the review queue, and that corrected answer becomes the
expectation of the regression test created by "Promote to test" — closing the loop from "this was
wrong" to "this can never silently regress again" without retyping anything. The corrected answer also
travels in the exported run report, so a report handed to someone else carries the human's correction
beside the model's output.

## Scope

- **`packages/shared`** — add `RUN_FEEDBACK_KEY_CORRECTED_OUTPUT = "corrected_output"` and
  `RUN_FEEDBACK_KEY_VERDICT = "verdict"` to `constants.ts`, replacing the three hardcoded `"verdict"`
  literals. The key stays a **free `string` on the wire** (`types.ts:2133`) — these are named
  well-known keys, **not** a new frozen union; nothing in `runFeedbackInputSchema` becomes an enum.
  Add the `humanFeedback` block to the `RunReport` type and its zod schema.
- **`apps/api/src/watch/promote.ts`** — extend `PromoteDeps` (`:25-32`) with the feedback repository;
  in `promoteRunToTest` (`:38`), after copying the source expectations (`:49-50`), overlay
  `expectations.expectedInsight` from the run's `corrected_output` human feedback row when one exists.
  The source expectations remain the base; the correction is an overlay, never a wipe.
- **`apps/api/src/testing/routes.ts`** — register `POST /api/runs/:id/promote-to-test`, body
  `{ collectionId }`, calling the existing `promoteRunToTest` (do **not** re-implement it) and
  returning the created test id. This closes the ledger's recorded stub, and is the reason the console
  button starts working at all.
- **`apps/api/src/reports/{reports.ts,run-report-assembly.ts}`** — `assemble()` reads
  `RunFeedbackRepository.list(runId)`; the JSON report gains a `humanFeedback` block and the Markdown
  report a `## Human feedback` section, with the corrected answer rendered as its own labelled
  sub-block distinct from the verdict and any notes.
- **`apps/api/src/observability/feedback.ts`** — `fetchRunFeedbackSummaries` (`:167-205`) additionally
  reports whether a row carries text (a boolean, not the text itself — the summary stays cheap), so a
  list surface can show "has a correction" instead of silently rendering nothing.
- **`apps/web/src/features/testing/FeedbackControl.tsx`** — take the feedback `key` as a prop instead
  of hardcoding `VERDICT_KEY`, and add a corrected-answer editor (a `Textarea` inside the existing
  `Popover`, brand-ui only) writing `{ key: "corrected_output", comment }`. `FeedbackSummaryChip` must
  render a comment-only row rather than returning `null`.
- **`apps/web/src/features/review/ReviewView.tsx`** — surface the corrected answer as a first-class
  field in the review pane. It is reachable today only if an operator happens to hand-define a `note`
  rubric key; make it explicit and always present.
- **`apps/web/src/features/watch/PromoteToTestDialog.tsx`** — show the corrected answer that will be
  pre-filled, so promoting is not a blind action.

## Files

Add:

- `apps/api/test/promote-to-test-route.test.ts`
- `apps/api/test/run-report-human-feedback.test.ts`

Modify:

- `packages/shared/src/constants.ts` — ⚠ **contended** (the plan's known cross-WP contention surface;
  AM-OB4, AM-OB6, AM-OB7, AM-OB10, AM-OB11, AM-OB12 all touch it)
- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended**
- `apps/api/src/watch/promote.ts`
- `apps/api/src/watch/actions.ts` (only if `PromoteDeps` construction moves)
- `apps/api/src/testing/routes.ts` — ⚠ **contended** (the runs route file)
- `apps/api/src/observability/feedback.ts`
- `apps/api/src/reports/reports.ts`
- `apps/api/src/reports/run-report-assembly.ts`
- `apps/web/src/features/testing/FeedbackControl.tsx`
- `apps/web/src/features/testing/RunBar.tsx`
- `apps/web/src/features/testing/ConversationPane.tsx` (only if the per-turn key filter must widen)
- `apps/web/src/features/review/ReviewView.tsx`
- `apps/web/src/features/watch/PromoteToTestDialog.tsx`
- `apps/web/src/features/watch/PromoteToTestDialog.test.tsx` (drop the "stubbed" note once the route lands)
- `apps/web/src/lib/api.ts` (delete the STUBBED doc block at `:1684-1693`)
- the co-located tests for each touched web component

## Non-goals

- **Human feedback still never blends into grades.** D-OB15 / AR6 hold with no exception: a
  `corrected_output` row is **not** a grade, is not read by any grader, and never enters `run_grades`,
  `meanScore`, `passRateAt05`, suite aggregates, or issue scoring. It changes what a *newly created
  test* expects; it never re-scores the run it came from, and it never re-scores any past run.
- No auto-promotion. Writing a correction never creates a test by itself — promotion stays an explicit
  operator action.
- No new feedback **source**; `source` stays `'human' | 'auto'`, and a corrected output is always
  `'human'`.
- No frozen key enum. Naming two well-known keys must not close the open key space the review rubrics
  rely on.
- No structured-output correction UI: `expectations.expectedValue` stays untouched; this WP fills
  `expectedInsight` only.

## Dependencies

- **Absorbs two of the ledger's own recorded follow-ups** (`STATUS.md:665-668`): the on-demand
  promote-to-test REST endpoint, and the report-export `humanFeedback` block. Neither has a work
  package of its own, and both are prerequisites for this item to be useful, so this WP owns them.
- No dependency on any other Phase 6 item.
- ⚠ **Parallel-safety:** shares `packages/shared/src/{constants,types,schemas}.ts` with most of Phase
  6, and shares `apps/api/src/testing/routes.ts` with AM-OB4 if that item touches the runs route. Do
  not batch with AM-OB4 or AM-OB6.

## Migration

**None.** This is the one place this spec contradicts the Phase 6 ledger header, which lists AM-OB2 as
one of two items "expected to" need a migration. It does not: `run_feedback.key` is a free-form `TEXT`
column with an open key space, and `run_feedback.comment` is an unbounded nullable `TEXT` column, both
shipped by WP 1.5. Do **not** claim a `user_version` for this work package, and do not add a
`feedback_kind` column — the data already fits the shipped schema exactly.

## Acceptance

1. `POST /api/runs/:id/feedback` with `{ key: "corrected_output", comment: "…" }` round-trips through
   `GET /api/runs/:id/feedback`, and a second POST for the same run **updates** rather than
   duplicating (the `(run_id, step_id, key, source)` upsert identity holds for the new key).
2. `POST /api/runs/:id/promote-to-test` exists, is registered, and returns the created test id; an API
   test asserts it, and the STUBBED doc block in `apps/web/src/lib/api.ts` is gone.
3. Promoting a run that has a `corrected_output` row produces a draft test whose
   `expectations.expectedInsight` equals the corrected text; promoting a run **without** one produces a
   draft test whose expectations are byte-identical to today's (`promote.ts:49-50` behaviour
   preserved), proven by a test that runs both paths.
4. The console lets an operator write and edit a corrected answer without leaving the run, and the
   review queue shows the same value; a comment-only row renders in the feedback chip rather than
   disappearing.
5. `GET /api/reports/run/:id/json` carries a `humanFeedback` block including the corrected answer, and
   the Markdown export renders it as a labelled section; both asserted by test.
6. **AR6 / D-OB15 regression guard:** a test asserts that a run carrying a `corrected_output` row has
   byte-identical `run_grades`, `meanScore` and suite-aggregate output to the same run without one.
   That test must fail if any grader is ever wired to read feedback.
7. No `user_version` claimed; `apps/api/src/db/{database,schema}.ts` are a zero-line diff.
8. Both themes (`light`/`dark`) and a keyboard-only pass over the new console affordance, the review
   field and the promote dialog — or, if not walked against the running app, recorded as an
   owner-acceptance line rather than claimed.
9. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
