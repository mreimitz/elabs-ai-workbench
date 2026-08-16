# Phase 1 — Grading foundation (WP specs)

## WP 1.1 — Contract: expectations + metadata + Grade shapes + judge settings
**Size:** M · **Depends on:** — · shared + API migration

**Objective:** the wire contract for everything graded (B1–B5), additive-only.

**Files:** `packages/shared/src/types.ts` + `schemas.ts` + `constants.ts` (`TestExpectations`,
`ReferenceLogic`, test `category`/`difficulty`/`tags`, `RunGrade`, `GradeStatus`,
`GraderId` union, `JudgeSettings`, `GRADING_VERSION = 1`, difficulty/tag constants);
`apps/api/src/db/database.ts` (migration: `tests` += `expectations_json`, `category`,
`difficulty`, `tags_json`; new `run_grades` per 00-architecture) + `schema.ts`;
`apps/api/src/testing/test-repository.ts`/`test-service.ts`/`routes.ts` (CRUD accepts the new
fields); tests `apps/api/test/benchmarks-contract.test.ts`.

**Rules:** every new Test field optional — an existing test round-trips byte-identically.
Judge settings persist as a reference (`providerCredentialId` + `model`), never key material.
Zod rejects `referenceLogic.kind` outside `'code' | 'text'` and difficulty outside the enum.

**Acceptance:** migration brings an existing DB forward (fresh DB stamped); test CRUD
round-trips expectations + metadata; pre-existing tests list/update unchanged; gate green.

## WP 1.2 — Grader engine: interface, deterministic graders, post-completion hook
**Size:** L · **Depends on:** 1.1 · API

**Objective:** the `Grader` seam (B2) + the two free graders + persistence + auto-trigger (B4).

**Files:** `apps/api/src/grading/` (new: `grader.ts` interface + registry, `rouge1.ts`,
`value-match.ts`, `grade-repository.ts`, `grade-service.ts`, `routes.ts` →
`GET /api/runs/:id/grades`); `apps/api/src/testing/run-service.ts` (invoke grading at the same
post-completion point as the assertion hook — grading failures logged, never propagated);
tests `apps/api/test/grading-engine.test.ts`.

**Rules:** `rouge1` = in-house unigram F1 over normalized tokens of (final assistant text) vs
(`expectedInsight` + stringified `expectedValue`) — no dependency, property-tested against
hand-computed examples. `value_match` parses the last JSON block in the final assistant message;
key-wise compare against `expectedValue` (numbers with relative tolerance 1e-6); no JSON block →
status `unevaluable`. Grades append-only; latest-per-grader selected for display. Runs without
expectations produce zero grade rows (no noise).

**Acceptance:** completed run with expectations auto-gains rouge1 (+value_match when parseable);
run without expectations gains none; a thrown grader never changes run status (test proves it);
append-only proven by re-grade; gate green.

## WP 1.3 — LLM judge (outcome) + judge settings + re-grade
**Size:** L · **Depends on:** 1.2 · API

**Objective:** the G-Eval outcome judge (B3) with honest method stamping and separate cost.

**Files:** `apps/api/src/grading/judge.ts` (prompt template — ported/adapted from the
insights-bench rubric with `<rating>` tag protocol + parse fallbacks; logprob-weighted expected
rating when the provider exposes logprobs, else temperature-0 single sample; `method` stamped),
`judge-settings` persistence + `GET/PUT /api/grading/judge-settings`,
`POST /api/runs/:id/grade` (re-grade: all graders or a named subset); judge pricing via
`apps/api/src/providers/pricing.ts` (unpriced model → 400, same rule as runs); judge usage →
`judge_tokens_*`/`judge_cost_usd` on the grade row. Tests with a stubbed provider
(`grading-judge.test.ts`) — no live API calls in the suite.

**Rules:** judge input = question (test userPrompt), expected (insight + value), predicted (the
run's final assistant text), optional `rubricOverride`. Judge output parsing is defensive
(tag → first-number → error status). Judge never sees secrets (payloads already redacted).
Rate-limit/backoff bounded — a stuck judge yields status `error`, never a hung run.

**Acceptance:** stubbed-provider tests cover: rating parse paths, logprob weighting math
(hand-computed expected value), unconfigured judge → `unevaluable`, judge error → `error` row,
re-grade appends with fresh `grading_version`/timestamps; judge cost recorded and NOT added to
run `cost_usd` (asserted); gate green.

## WP 1.4 — UI: Grade panel + chips + judge settings
**Size:** M · **Depends on:** 1.3 · Web-only

**Objective:** grades visible where runs live; judge configured where providers live.

**Files:** `apps/web/src/features/testing/` — run console gains a **Grade panel** (per-grader
`MetricCard` score + status badge, judge reasoning in a collapsible, evidence links, "Re-grade"
action with busy state); runs list + run compare gain grade chips (score badge, `tabular-nums`);
`SettingsView` gains the default-judge block (provider credential Select + model Select, reusing
the provider/models API); test editor gains the **Expectations** section (insight textarea,
structured-value JSON editor via existing `CodeBlock`/editor composition, referenceLogic,
answerable Switch, category/difficulty/tags inputs).

**Acceptance:** live walk against the running app: create a test with expectations → run →
grades appear without reload (SSE/refetch), re-grade works, judge reasoning readable; ungraded
runs show an honest empty state, `unevaluable` is visually distinct from a low score; both
themes; keyboard reachable; gate green.
