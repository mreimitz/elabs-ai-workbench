---
type: "Work Package Spec"
title: "WP 5.2 — the base verdict as a CI assertable, and a verdict trend"
description: "Two suite-family assertion rules over the base rating plus one metrics measure, so the base verdict can gate a build and be watched over time."
tags: ["roadmap", "RM-06"]
timestamp: "2026-08-21T17:20:00Z"
status: "final"
---
# WP 5.2 — the base verdict as a CI assertable, and a verdict trend

> **Status: specified 2026-08-21.** Phase 5 of [`item.md`](./item.md); ledger
> [`STATUS.md`](./STATUS.md). The owner instructed BUILD on 2026-08-21, so this is live work, not
> backlog. AR1–AR16 untouched; **AR6** is the hard constraint — a base-rating score never enters
> `meanGrade` / `passRateAt05` / the quality×cost scatter, and this WP does not change that. It
> extends the CI assertion engine built by RM-08 (the
> [RM-08 ci ledger](/Roadmap/RM-08-ci/STATUS.md)), whose decisions **D-C7 · D-C8 · D-C9 ·
> D-C13 · D-C16 · D-C22** and **D-MCP4** govern everything below.

**Size:** M · **Depends on:** none open — WP 3.2 (its stated dependency) is done 2026-07-11, and
RM-08 Phases 1–3 (the assertions engine, the suite family, `no-new-security-findings`) are done
2026-08-20 · shared + API + CLI docs + Web · **no migration**

---

## Two corrections to the ledger line before anything is built

1. **The path `roadmap/ci/` is stale.** That folder no longer exists; the CI workstream is
   `planning/Roadmap/RM-08-ci/` (the [RM-08 ci ledger](/Roadmap/RM-08-ci/STATUS.md)), and it is
   **built**, not pending —
   all 11 WPs across Phases 1–3 plus Phase MCP completed 2026-08-20. This WP is therefore an
   *extension* of a live engine, not the thing that creates one.
2. **There is no single "base verdict" to assert.** The base rating is three separate facets
   (`RunBaseRating`, `packages/shared/src/types.ts:2600`), and no scalar verdict is persisted or
   composed anywhere:
   - `answerValidation: { verdict: "answered" | "partial" | "unanswered"; score: number | null;
     quotes; citedSteps }`
   - `insightSurplus: { verdict: "none" | "valuable" | "noise"; score; surplusTokens? }`
   - `errorForensics: ErrorFinding[]` — a list, with no verdict enum at all
   All three are ordinary append-only `run_grades` rows (AR1 — no per-run rating table); the
   `RunReport` is composed on read by `apps/api/src/grading/run-report.ts`. So "the base verdict as
   a CI assertable" must **name which facet it gates**. Inventing a composite score would both
   fabricate a number the app has never had and risk exactly the AR6 conflation the whole design
   avoids. This WP therefore gates two specific, already-persisted things and nothing else.

---

## Problem

**Nothing about run quality can fail a build except an expectation score.** The gate vocabulary is
nine rules (`ASSERTION_RULE_KINDS`, `packages/shared/src/ci-assertions.ts`), of which exactly two
are `family: "suite"`: `min-suite-score` reads `aggregates.meanGrade`, and `max-suite-cost` reads
`execCostUsd + judgeCostUsd`. `meanGrade` is selected by `PRIMARY_GRADER_PRIORITY`
(`apps/api/src/suites/orchestrator.ts:80` — `outcome_judge → trajectory_judge → rouge1 →
value_match → tool_hygiene → skillflow_conformance`), which excludes all three base graders **by
omission**. So a suite whose every run failed to answer its prompt, or which introduced a whole new
class of tool failure, passes `min-suite-score` untouched as long as its expectation graders are
happy — and a suite with no `test.expectations` at all has nothing to gate on whatsoever.

**And nothing renders the base verdict over time.** `RUN_METRICS_MEASURES`
(`packages/shared/src/constants.ts:423`) has thirteen members — `count`, `errorRate`,
`guardrailRate`, `p50DurationMs`, `p95DurationMs`, `tokensIn`, `tokensOut`, `costUsd`, `meanScore`,
`feedbackRate`, `cacheReadTokens`, `cacheWriteTokens`, `cacheHitRate` — and **not one of them is a
rating measure**. `meanScore` is explicitly not one: `apps/api/src/observability/metrics.ts:44`
imports the same `PRIMARY_GRADER_PRIORITY`. The nearest thing that exists is
`SuiteReportBaseline.perTest` (`types.ts:2756`), and that is a **single-step** delta against one
earlier report, not a series.

The good news is that the machinery to fix both already exists and needs extending, not inventing.

---

## Scope

### A — two new `family: "suite"` assertion rules

Both are **suite family** because that is where CI already lives: `assertionTargetSchema` has four
shapes in two families (`{server}`/`{scan}` → `scan`; `{suite}`/`{suiteRun}` → `suite`) and
**there is no `{run}` target and no `run` family**; `apps/cli/src/commands/` has `suite-run.ts` and
no single-run command. Adding a third family or a fifth target would be a much larger change than
this line asks for, and D-C13's single-family rule exists precisely so a gate file answers one
question. `ASSERTIONS_VERSION` stays **1** — every change here is additive (new union members, new
meta entries, new evaluators), and the repo's two example gate files must still validate unchanged.

**1. `min-answered-rate`** — `{ rule: "min-answered-rate", min: number 0..1 }`,
`needsBaseline: false`, `family: "suite"`. This is the base *verdict* gate the ledger line names.

- **Observed** = members whose latest `answer_validation` verdict is exactly `"answered"`, divided
  by members that produced a **parseable** `answer_validation` verdict.
- A member with no `answer_validation` grade row, or one whose `evidence_json` fails
  `answerValidationEvidence` parsing, is **excluded from both numerator and denominator** — never
  counted as a failure. This is the existing "a run with no graded score is EXCLUDED, counted in
  neither numerator nor denominator; it is NEVER treated as a 0" discipline
  (`apps/api/src/suites/orchestrator.ts:77`) and the D-CT6 "absent means UNKNOWN, never zero" rule.
- A denominator of **0 FAILS**, with a message saying so. It is not a skip: a gate that demanded a
  verdict and got none has not been satisfied. This mirrors `min-suite-score`'s `meanGrade: null`
  → fail exactly.
- **`partial` counts as not answered.** One clean meaning, and the operator sets the threshold. The
  message names both counts ("4 of 6 members answered the prompt") so a build log says what
  happened rather than printing a bare ratio.
- Boundary passes: `observed === min` is a pass.

**2. `no-new-rating-issues`** — `{ rule: "no-new-rating-issues", minSeverity?: "low"|"medium"|"high" }`,
`needsBaseline: true`, `family: "suite"`, default floor **`medium`**. This is
`no-new-security-findings` applied to rating, and it follows that rule's discipline exactly.

- **Set membership, never a count.** The identity of a problem is the triple
  `(rating_issues.target_kind, rating_issues.target_id, rating_issue_occurrences.finding_digest)`.
  All three are **existing persisted columns**, and the last is already the app's own per-finding
  identity — a stable hash of `category | bucket | fixTarget | normalized description`
  (`findingDigest`, `apps/api/src/grading/issue-service.ts:470`), carrying a
  `UNIQUE (issue_id, run_id, finding_digest)` constraint. **The gate computes no digest of its
  own**; it reads the column. A rule that failed because the same problem was seen twice more would
  be a count, and counts are exactly what `no-new-security-findings` was written to avoid.
- Each side's set is scoped by `rating_issue_occurrences.suite_run_id` — an existing column. The
  rule fails when the subject's set contains an identity the baseline's set does not, filtered to
  the severity floor; `added.length === 0` is a pass. `observed` is the number of added identities,
  `limit` is `0`, and `details` lists them through the existing `capAssertionDetails`.
- **The fleet columns are deliberately NOT read.** `cluster_key`, `cluster_key_version`,
  `lifecycle`, `occurrences`, `trend_json` and `affected_json` (migration v41) are written by the
  Observability **background sweep**, which is scheduler-driven. A gate that read them would return
  a different verdict depending on whether the sweep had run yet — the latency-dependent
  wrong-answer D-C16 exists to prevent. The per-run AR pipeline files its issues synchronously as
  part of rating, so once D-C16's settled-`ratingState` check passes, the identities this rule
  reads are final.
- **A version mismatch is a 400, not a suppressed pass.** If the subject's and the baseline's
  issues were produced under different `rating_issues.rating_version` values, the two sets are not
  on the same scale and the gate refuses with a **400 → exit 2**, naming both versions. This is
  D-C22 (the analyzer-version refusal) and D-C8 case 3 (`deltasComparable === false`) applied to
  the rating axis.
- D-C8's three outcomes are otherwise unchanged: no earlier completed+settled suite run of the same
  suite → a loud `skipped` and exit 0; a named-but-unresolvable baseline → 400.

**Everything else about the engine is unchanged.** D-C16 already refuses a suite run that is not
`completed`, and already refuses a `completed` one whose `ratingState` is `pending`/`rating`
(`apps/api/src/assertions/service.ts:338`) — which is exactly the guard these two rules need, and
is why they need no guard of their own. The suite-family target resolution, the baseline
resolution, and D-C14's always-resolve-a-named-baseline behaviour are all reused as-is.

**Ports.** `AssertionPorts` gains one narrow, structural read port, injected the way `security`
already is (a function, so a test hands it fixtures rather than a database):

```ts
ratings: {
  answerVerdicts: (suiteRunId: string) =>
    Array<{ runId: string; verdict: AnswerValidationVerdict | null }>;
  issueIdentities: (suiteRunId: string) =>
    Array<{ targetKind: RatingIssueTargetKind; targetId: string;
            findingDigest: string; severity: RatingIssueSeverity; ratingVersion: number }>;
}
```

Both are re-projections of already-persisted rows (D-MCP4): the first from `run_grades` through
`GradeRepository`, the second from `rating_issues` + `rating_issue_occurrences` through
`IssueRepository`. **The assertions engine reads the rating surface; it never writes to it.**

### B — the verdict trend

- **One new measure.** `RUN_METRICS_MEASURES` gains `"answeredRate"`, and
  `RUN_METRICS_MEASURE_UNITS` gains `answeredRate: "rate"` (the unit `errorRate` and
  `guardrailRate` already use, so the same-unit chart constraint keeps working).
- **One new aggregation branch**, in `apps/api/src/observability/metrics.ts` — the only module that
  owns metrics SQL. It follows the existing `meanScore` recipe **exactly** (`metrics.ts:394-424`):
  one `SELECT` over `run_grades` ordered `created_at ASC, rowid ASC`, last-write-wins per
  `(run_id, grader_id)` resolved in JS, then the verdict read out of `evidence_json` in JS.
  `metrics.ts` uses **no `json_extract` today and must not start** — parsing in JS keeps this a
  one-branch addition rather than a new SQL idiom.
- Same exclusion rule as the assertion: a run with no parseable `answer_validation` verdict is
  excluded from its bucket; a bucket with **zero** eligible runs emits **no point**, not a `0`
  (D-CT6 — a 0% answered rate and "we did not measure" must never look the same).
- **"Per server/skill" needs no new page and no new endpoint.** `RUN_METRICS_GROUP_BY`
  (`constants.ts:407`) already contains `server` and `skill`, so
  `GET /api/metrics/runs?measures=answeredRate&groupBy=skill` is the trend the ledger line asks
  for the moment the measure exists. Registering it in the shared tuple also makes it available
  **automatically** to the custom chart composer and the watch-rule editor — the same
  pick-up-for-free the cache measures got in
  [RM-33 cache-aware token accounting](/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md).
- **One rendered surface**, for discoverability: an **Answered rate** panel in the Dashboard's
  Testing tab, beside the existing `ScoreTrendPanel`
  (`apps/web/src/features/dashboard/testing/ScoreTrendPanel.tsx`) and built on the same recipe —
  ungrouped line, honest empty state. The per-server and per-skill breakdowns are reached through
  the composer's existing group-by rather than a bespoke panel on each detail page.
- **`feedbackRate` is the anti-pattern to avoid.** It is a registered measure that the API returns
  in `unavailableMeasures` because nothing computes it. `answeredRate` must never appear there.

### AR6, stated as a build instruction

`meanScore` keeps its meaning and its implementation: it still walks `PRIMARY_GRADER_PRIORITY`,
which excludes the three base graders by construction. `answeredRate` is a **separate, separately
named** measure that is never merged into it, and `min-answered-rate` is a **separate rule** that
never reads or alters `aggregates.meanGrade`. `no-new-rating-issues` reads issue identities, not
scores. This WP writes **no** `run_grades` row and mutates no grade — the table stays append-only.

---

## Files

**New**
- `apps/web/src/features/dashboard/testing/AnsweredRatePanel.tsx` (+ its co-located test)

**Modified — shared (contract-first, additive only)**
- `packages/shared/src/ci-assertions.ts` — `ASSERTION_RULE_KINDS` (append ×2), `ASSERTION_RULE_META`
  (two entries, both `family: "suite"`), two `.strict()` rule schemas into `assertionRuleSchema`
- `packages/shared/src/constants.ts` — `RUN_METRICS_MEASURES` + `RUN_METRICS_MEASURE_UNITS`
- `packages/shared/src/ci-assertions.test.ts`

**Modified — API**
- `apps/api/src/assertions/service.ts` — the `ratings` port, two entries in the `EVALUATORS` map
- `apps/api/src/index.ts` — bind the new port (the `registerAssertionRoutes` deps only)
- `apps/api/src/grading/grade-repository.ts` — one narrow read: base verdicts by suite run
- `apps/api/src/grading/issue-repository.ts` — one narrow read: issue identities by suite run
- `apps/api/src/observability/metrics.ts` — one `answeredRate` branch
- `apps/api/test/ci-assertions.test.ts`, and the observability metrics test file

**Modified — web**
- `apps/web/src/features/dashboard/testing/` — the section that mounts the new panel

**Modified — examples + docs**
- `mcpfp.assert.suite.example.json` (repo root) — extend it, or add a sibling; it must stay a valid
  **single-family** document (D-C13) and a test must read it off disk and prove it still validates
- the [DC-18 `mcpfp` CLI guide](/user-guide/DC-18-mcpfp-cli/22-mcpfp-cli.md) — the two rules and a
  worked gate file
- `apps/cli/test/assert.test.ts` — exit-code coverage for a failing rating gate

**No CLI source change expected.** `mcpfp help assert` renders its rule table **from**
`ASSERTION_RULE_META`, so the two rules appear there automatically — do not hand-write them into
`apps/cli/src/help.ts`.

**Zero-line diff — verify each with `git diff <base>..HEAD -- <path>`**
- `apps/api/src/suites/orchestrator.ts` and `apps/api/src/suites/analytics.ts` — `meanGrade` and
  `PRIMARY_GRADER_PRIORITY` untouched (**AR6**)
- `apps/api/src/grading/{grade-service,answer-validation,insight-surplus,error-forensics,issue-service,issue-clustering}.ts`
  — the rating pipeline is read, never changed
- `apps/api/src/db/**` — **no migration**; every column this WP reads exists (v26, v27, v41)
- `apps/api/src/compare/service.ts` — one differ, re-projected (D-MCP4)
- `packages/shared/src/security-posture.ts` and `apps/api/src/security/**`
- `packages/shared/src/api-tokens.ts` and `apps/api/src/api-tokens/**` — no scope change;
  `POST /api/assertions/evaluate` already needs only `read`
- `packages/shared/src/workbench-mcp.ts` and `apps/api/src/mcp-server/**` — no new MCP tool
- `apps/web/src/App.tsx` and `packages/shared/src/assistant-route-manifest.ts` — no new route
- `pnpm-lock.yaml` and every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable, no feature flag

**Orchestration note.** WP 5.1 also appends to `packages/shared/src/constants.ts`, in a different
region (skillflow vs. metrics). Every other file is disjoint, so the two can run in parallel
worktrees; expect at most an append-conflict in that one file, or serialize the two shared edits.
If this WP must be split, the clean seam is **A (the two rules)** and **B (the measure + panel)** —
they share no file.

---

## Acceptance

- [ ] **A1** — `min-answered-rate` and `no-new-rating-issues` exist, validate strictly, are both
      `family: "suite"`, appear in the generated `mcpfp help assert` table with correct summaries,
      and are the **only** rules added.
- [ ] **A2** — `ASSERTIONS_VERSION` is still **1**, and both `mcpfp.assert.example.json` and
      `mcpfp.assert.suite.example.json` still validate unchanged (proven by a test that reads them
      off disk).
- [ ] **A3 (D-C13)** — A document mixing either new rule with a `{server}`/`{scan}` target is a
      validation error whose issue path names the offending rule index. Asserted.
- [ ] **A4** — `min-answered-rate`: on a suite run with 4 `answered`, 1 `partial` and 1
      `unanswered` member, observed is `4/6`; `min: 0.6` passes and `min: 0.7` fails; the message
      names both counts. Boundary `observed === min` passes.
- [ ] **A5** — `min-answered-rate` **excludes** a member with no `answer_validation` row and a
      member whose `evidence_json` fails to parse — neither lands in the numerator or the
      denominator — and a suite run where **no** member produced a verdict **FAILS** with an
      explanatory message rather than skipping or passing.
- [ ] **A6** — `no-new-rating-issues` is decided by **set membership** on
      `(targetKind, targetId, findingDigest)`: an identity present in the subject and absent from
      the baseline **fails**; the same identity seen three times more in the subject than the
      baseline **passes**. A source-grep proves the rule computes no digest of its own and reads
      the persisted column.
- [ ] **A7** — `no-new-rating-issues` reads **none** of the v41 fleet columns (`cluster_key`,
      `cluster_key_version`, `lifecycle`, `occurrences`, `trend_json`, `affected_json`) — asserted
      by source-grep — so its verdict does not depend on whether the background sweep has run.
- [ ] **A8** — Two sides carrying different `rating_version` values are a **400 → exit 2** naming
      both versions, never a suppressed-to-zero pass. D-C8's other two outcomes are unchanged
      (no earlier settled suite run → loud `skipped` + exit 0; unresolvable named baseline → 400),
      proven by the existing D-C8 tests still passing **unmodified**.
- [ ] **A9 (D-C7)** — A failing rating gate exits `1` from `mcpfp assert` and nothing else in the
      CLI can emit `1`; a 400 from either rule exits `2`. The existing exit-code tests still pass
      unmodified.
- [ ] **A10 (AR6)** — `apps/api/src/suites/orchestrator.ts` and `analytics.ts` have a zero-line
      diff; `meanScore` over an unchanged fixture is byte-identical before and after; no
      `run_grades` row is written by anything in this WP.
- [ ] **A11** — `answeredRate` is returned by `GET /api/metrics/runs` as real series data and
      **never** appears in `unavailableMeasures`; `groupBy=server` and `groupBy=skill` both return
      correctly grouped series.
- [ ] **A12 (D-CT6)** — A time bucket whose runs produced no parseable verdict emits **no point**,
      not a `0`, and the panel renders that window as not measured rather than as a 0% answered
      rate. Asserted at both the API and the panel.
- [ ] **A13** — The Answered rate panel renders live data, an honest empty state, and a settled
      error state; and the measure is selectable in the custom chart composer and the watch-rule
      editor without either being edited (the RM-33 pick-up-for-free property).
- [ ] **A14 (docs)** — `22-mcpfp-cli.md` documents both rules with a worked suite gate file, and
      states that they read the base rating and therefore require a fully-rated suite run (D-C16).
- [ ] **A15 (no drive-by scope)** — Every zero-line-diff path above is clean; no migration, no
      dependency, no feature flag, no new route, no new MCP tool, no third assertion family, no new
      `AssertionTarget` member; no `STATUS.md` was edited by the implementer.
- [ ] **A16 (both themes + keyboard)** — The Answered rate panel reads correctly in `light` **and**
      `dark` against the **running app**, is keyboard reachable with a visible focus ring, and any
      icon-only control is an `IconButton` whose tooltip equals its `aria-label`.
- [ ] **A17 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
      Report exit codes and test counts; report any pre-existing failure as pre-existing rather
      than fixing it silently.

---

## Explicit non-goals

- **A third assertion family, a `{run}` target, or any single-run gate.** CI runs suites; the
  vocabulary stays two families and four targets. A run-level gate is a much larger change and is
  not what this line asks for.
- **A composite "base score".** The three base facets keep their own meanings; nothing here averages
  them, and nothing folds them into `meanGrade` (AR6).
- **Rules over `insight_surplus` or over `error_forensics` counts.** A gate vocabulary is easier to
  grow than to shrink (the WP 2.2 precedent), and a raw finding count is the kind of metric
  `no-new-security-findings` was written to avoid. `no-new-rating-issues` covers the forensics axis
  by identity instead.
- **Widening `AssertionSuiteRunRef` so `renderAssertionMarkdown` gains an answered-rate delta
  sentence.** The rules table already reports observed vs. limit for both new rules; changing the
  report's identity shape is a separate, additive change with its own wire consequences.
- **Any per-detail-page trend panel** on `/servers/:serverId` or `/skills/:skillId`. The group-by
  already answers "per server/skill"; a bespoke panel per entity is an IA decision, not this WP's.
- **Exposing assertions or metrics on the workbench MCP mount.** Neither is on it today, and adding
  either is an RM-08 decision.
- **Any change to the auto-rating pipeline, the judge chain, the issue registry schema, or the
  Observability sweep.**

---

## Open questions the owner should answer

1. **Does `partial` count as answered?** This spec says **no** — one clean meaning, with the
   threshold as the operator's dial. If the owner wants `partial` to count as a half or as a pass,
   say so before implementation: it changes what a build log means and cannot be changed later
   without invalidating every recorded gate result.
2. **Is `medium` the right default severity floor for `no-new-rating-issues`?**
   `no-new-security-findings` defaults to `warning`, the middle of its three; `medium` is the
   middle of `low | medium | high`. The default is what most gate files will inherit.
