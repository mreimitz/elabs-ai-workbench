---
type: "Status Ledger"
title: "Auto-Rating \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Living state for the auto-rating plan, read and updated by /next-wp auto-rating. A box is"
tags: ["roadmap", "RM-06"]
timestamp: "2026-08-21T22:20:00Z"
status: "active"
---
# Auto-Rating — work-package status ledger · **PRIORITY: HIGH**

Living state for the **auto-rating** plan, read and updated by `/next-wp auto-rating`. A box is
ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/auto-rating/<id>`.

> Plan + locked decisions AR1–AR16 in [`README.md`](./item.md). Extends the Benchmarks
> grading system (`../benchmarks/`, B15 amended per AR12 — amendment noted in
> `../benchmarks/00-architecture.md`). **Kickoff done (owner, 2026-07-11):** both proposed
> defaults confirmed — CLI judge model `claude-sonnet-4-5` (Settings-selectable) and the
> `AUTO_RATING_ENABLED` kill-switch (default `true`). WP 4.1 still claims the migration
> `user_version` at claim time (**v22 expected** — `apps/api/src/db/database.ts` `MIGRATIONS`
> is at v21 today; re-verify + check sibling ledgers). **Execute in parallel** per README
> §Parallel execution map
> (batch 1: 1.1 solo · batch 2: 1.2 ∥ 2.1 · batch 3: 1.3 ∥ 1.4 ∥ 2.2 · batch 4: 1.5 ∥ 2.3 ·
> batch 5: 3.1 ∥ 4.1 · batch 6: 3.2 ∥ 4.2 · batch 7: 4.3) — one worktree sub-agent per WP;
> `packages/shared` and `run-service` writers serialize across workstreams.
>
> ⚠️ **Contention override (2026-07-11):** other workstream sessions are running in parallel
> and may hold `packages/shared` / `apps/api/src/testing/run-service.ts`. **Start with
> WP 2.1** (assistant driver only — no contested files, no dependencies). Take **WP 1.1 only
> when no other session is writing `packages/shared`**, then resume the normal batch map
> (1.2 also touches `run-service` — same check). Remove this note once the parallel sessions
> have finished merging.

## Phase 1 — Contract & always-on core (API)
- [x] WP 1.1 — shared contract: base grader ids (`answer_validation`, `insight_surplus`,
      `error_forensics`), taxonomy/report types + zod, `AUTO_RATING_VERSION`
      — done 2026-07-11 · wp/auto-rating/1.1
- [x] WP 1.2 — grading seam: mandatory roster; gates relaxed per-grader (all terminal statuses,
      no-expectations); expectation graders unchanged; tests lock the matrix
      — done 2026-07-11 · wp/auto-rating/1.2
- [x] WP 1.3 — `error_forensics`: deterministic inventory (error events, failed tool calls,
      guardrail stops, overflow, assertions_failed) + LLM 5-bucket classification + `fixTarget`
      + draft fixes (schema-constrained, evidence-cited)
      — done 2026-07-11 · wp/auto-rating/1.3
- [x] WP 1.4 — `answer_validation` + `insight_surplus` (double-edged) rubrics
      — done 2026-07-11 · wp/auto-rating/1.4
- [x] WP 1.5 — composed `GET /api/runs/:id/report` + run-export grades/rating block
      — done 2026-07-11 · wp/auto-rating/1.5

## Phase 2 — Claude CLI judge (one judge for all LLM graders)
- [x] WP 2.1 — driver usage capture: additive `DriverEvent` usage field (D-AS11 untouched)
      — done 2026-07-11 · wp/auto-rating/2.1
- [x] WP 2.2 — `createClaudeCliJudgeGenerate`: raw-driver one-shot (`maxTurns: 1`, tools-less,
      judge system prompt), judge auth resolver (subscription-if-available), AR14 semaphore,
      throwaway cwd + transcript cleanup, timeout — done 2026-07-11 · wp/auto-rating/2.2
- [x] WP 2.3 — resolution chain in `judgeResolver` (CLI → provider judge → none) + Settings
      surface + provenance stamped on grade rows (AR16 limit fall-through)
      — done 2026-07-11 · wp/auto-rating/2.3

## Phase 3 — Web run report
- [x] WP 3.1 — run console **Report** tab (verdict header, answer/surplus cards, forensics list
      with fixTarget chips + draft fixes + step deep-links, expectation grades, assertions,
      provenance, Re-rate; loading-states compliant; both themes)
      — done 2026-07-11 · wp/auto-rating/3.1 (rendered both-theme/keyboard walk = owner-acceptance)
- [x] WP 3.2 — base-verdict chips in runs feed + suite matrix (AR6 separate dimension) +
      `GradePanel` slimmed to summary-linking-to-tab
      — done 2026-07-11 · wp/auto-rating/3.2 (also fixed a latent AR6 conflation bug in
      `grade-format.pickPrimaryGrade`; rendered both-theme/keyboard walk = owner-acceptance)

## Phase 4 — Suite auto-report
- [x] WP 4.1 — migration `suite_run_reports` (claim next free user_version; v22 expected) + orchestrator
      post-`finish()` hook (≥2 members, AR7) + awaitable member-rating seam (bounded wait →
      `partial`) + deterministic analytics (per-test-group variance, auto failure buckets AR12)
      — done 2026-07-11 · wp/auto-rating/4.1
- [x] WP 4.2 — per-test-group LLM agreement (one call per group, AR10) + narrative + cross-run
      root-cause roll-up (top skill-fixes / server-fixes by frequency)
      — done 2026-07-11 · wp/auto-rating/4.2
- [x] WP 4.3 — suite console **Report** tab + suite-run export block +
      `POST /api/suite-runs/:id/report` regenerate (append-only)
      — done 2026-07-11 · wp/auto-rating/4.3 (rendered both-theme/keyboard walk = owner-acceptance)

## Phase 5 — Cross-links · **UNPARKED 2026-08-21 — owner said BUILD**

> **Owner instruction received 2026-08-21** (via `RM-35` D-2, which offered *build* or *split to a
> new RM item so RM-06 can retire on its owner walk alone*). The owner chose **build**, so this
> phase stays inside RM-06 and RM-06 does **not** retire until it is done. The "do not pick up
> without owner instruction" gate is now **satisfied, not removed** — it did its job.
- [ ] WP 5.1 — rating findings → skill/server links + rating-sourced SkillFlow suggestions —
      spec [`wp-5.1-cross-links.md`](./wp-5.1-cross-links.md) (**M**, no migration; depends on
      nothing open — its stated dep WP 4.3 is done). **Scope was much larger than this line implied
      and is now much smaller: the Issues-tab half ALREADY SHIPS.** `IssuesPanel` describes itself as
      "the ONE Issues-tab surface, shared by the MCP-server detail view and the skill inspector" and
      is mounted on **both** (`ServersView.tsx:918`, `SkillInspector.tsx:801`), behind
      `GET /api/{servers,skills}/:id/issues`; `RatingIssueService.resolveTargets`
      (`issue-service.ts:156`) already resolves a bare `FixTarget` into concrete ids, and
      `rating_issues` already persists `targetKind`/`targetId`/`targetName`/`skillVersionId`. **The
      real remaining gap is narrow — nothing turns that id into a LINK**: `/skills/` and `/servers/`
      appear nowhere in either issues feature directory, and every web consumer of `fixTarget` renders
      a chip. Two corrections to the old line: the "when Advisor Phase 1 lands" conditional is
      **stale** (Advisor Phases 1–2 done 2026-08-18), and the Advisor rule itself is an explicit
      **non-goal**, deferred to an RM-01 Phase 3 WP, because Advisor's rule registry order is pinned
      by a test in RM-01's file set
- [ ] WP 5.2 — base rating as two suite-family CI assertions + an `answeredRate` trend measure —
      spec [`wp-5.2-verdict-ci-assertable.md`](./wp-5.2-verdict-ci-assertable.md) (**M — was sized S
      in `item.md`; corrected**, no migration: every column it reads exists at v26/v27/v41). It
      **extends the built RM-08 assertion engine** rather than creating one. Three corrections to the
      old line: `roadmap/ci/` is **stale** (now `planning/Roadmap/RM-08-ci/`, and complete — 11 WPs,
      Phases 1–3 + Phase MCP); **"base verdict" does not exist as a value** — the base rating is three
      facets (`answerValidation`, `insightSurplus`, `errorForensics`) and no scalar verdict is
      persisted, so the spec gates the facets rather than inventing a composite, which would also
      risk **AR6**; and "verdict trend per server/skill" had no home — resolved through the existing
      metrics grammar, since `RUN_METRICS_GROUP_BY` already contains `server` and `skill`
      (`constants.ts:411,415`), so one new measure reaches the chart composer and watch rules with
      **no new endpoint and no new page**
- [ ] WP 5.3 — judge-settings live preview + bounded re-rate window — **proposed 2026-08-19**
      (landscape research; spec [`wp-judge-preview-and-rerate.md`](./wp-judge-preview-and-rerate.md))
      — owner-gated, append-only per AR6

## Decision log
_Entries: date · decision · rationale._

- 2026-07-11 · AR1–AR16 locked by owner (see README) — mandatory post-run rating blending into
  Benchmarks grading; CLI-first judge chain for all LLM graders; 5-bucket taxonomy +
  skill/server fixTarget; all-terminal rating; AR6 separate analytics dimension; suite report
  ≥2 members with variance + per-group LLM agreement.
- 2026-07-11 · B15 amended (AR12): failure buckets may auto-run inside the mandatory suite
  report; manual endpoint retained.
- 2026-07-11 · **Kickoff defaults confirmed by owner** (proposed → locked): CLI judge model
  defaults to `claude-sonnet-4-5` (selectable from the assistant roster in Settings → grading);
  ops kill-switch `AUTO_RATING_ENABLED` (default `true`), no per-test opt-out.
- 2026-07-11 · Execution started as a parallel workstream while other sessions run; contention
  override in the header note — WP 2.1 first, 1.1/1.2 gated on `packages/shared` /
  `run-service` being free.
- 2026-07-11 · **Integration target = `ux/integration`, not `main`.** Verified: `ux/integration`
  is 237 commits ahead of `main`; `main` has none of the base code (`apps/api/src/assistant`,
  `grading`, `suites` all absent on `main`). All auto-rating WPs build on and merge into
  `ux/integration` (the shared branch the concurrent assistant/benchmarks sessions also use);
  the orchestrator's "merge to main" rule maps to `ux/integration` here. Never pushed to origin.
- 2026-07-11 · `DriverEvent` confirmed API-internal (`apps/api/src/assistant/session-driver.ts`,
  not `packages/shared`) — WP 2.1 touches **no** contested surface, consistent with the
  contention override. SDK usage source = `SDKResultSuccess.usage` (`NonNullableUsage`,
  snake_case) on the `result` message → carried on the `turn_done` DriverEvent; judge ledger
  consumes `inputTokens`/`outputTokens` (`grading/judge.ts`).
- 2026-07-11 · **WP 2.1 done + merged** → `ux/integration` `fcca74f` (FF). Added a new SDK-free
  `DriverUsage` type + optional `usage` on `turn_done`, defensively populated from the SDK
  `result` message for both success/error subtypes; +4 co-located driver tests. Gate re-run by
  orchestrator in the worktree: typecheck · lint (661 files) · test (1294 pass/0 fail) · build —
  all green. Merged after **two rebases** onto a fast-moving `ux/integration` (concurrent
  assistant session merged R3.1 `fe007c8`, then a docs-only `b5964a8`); final base delta since
  the green gate was docs-only, so the gate transferred.
- 2026-07-11 · **Contention confirmed: `packages/shared` is actively written by the concurrent
  session** — R3.1 (`fe007c8`) touched `packages/shared/src/{schemas.ts,index.ts}` +
  `assistant-starters.ts`. **WP 1.1 (shared contract) and WP 1.2 (also touches `run-service`)
  stay gated** until the owner confirms those surfaces are free. Next: **WP 2.2** (Opus, depends
  on 2.1 — now unblocked; assistant driver + new grading files only, no contested surface).
- 2026-07-11 · **WP 2.2 done + merged** → `ux/integration` `7a39176` (FF, after 2 rebases past
  concurrent assistant merges R1.4/R1.5 + ledger ticks). New `grading/claude-cli-judge.ts`
  (`createClaudeCliJudgeGenerate` + `ClaudeCliJudgeError{kind}` + `AsyncSemaphore` +
  `createThrowawayWorkspace`); additive `AssistantAuthService.resolveJudgeAuth()` (decrypted
  server-side only, `getStatus()` still redacted); `AUTO_RATING_MAX_CONCURRENCY` (default 1) in
  env + `.env.example`; +12 fake-driver tests. Confirmed **no `packages/shared` change** needed
  (`JudgeGenerate` is API-internal). Orchestrator re-gated in the worktree: typecheck · lint
  (669) · test (1306/0) · build — all green. **Contract additions for WP 2.3:** error kinds
  `auth|rate_limit|timeout|driver` (2.3 catches `auth`/`rate_limit` to fall through);
  `CLI_JUDGE_DEFAULT_MODEL = "claude-sonnet-4-5"`; CLI judge is NOT yet wired into `index.ts` /
  the resolution chain / Settings (WP 2.3 owns that). **Owner-acceptance (not faked):** live
  subscription / real CLI child / real transcript cleanup — tests use the scripted fake driver.
  With 2.1+2.2 done, Phase 2 remainder is **WP 2.3** (formally depends on 2.2 ✓). But 2.3 adds a
  resolved-source field to the judge-settings response (`packages/shared`) and wires the chain in
  `index.ts` — **both contested surfaces** — so 2.3 is gated on `shared`/`index.ts` being free
  (same gate as 1.1/1.2), not on 1.1 itself. **No auto-rating WP is currently runnable without
  touching a contested surface** → pausing for owner to confirm `packages/shared` (and
  `run-service.ts` / `index.ts`) are free before starting 1.1 / 1.2 / 2.3.
- 2026-07-11 · **Owner confirmed all three contested surfaces FREE** (`packages/shared`,
  `testing/run-service.ts`, `index.ts`). Resumed the normal batch map.
- 2026-07-11 · **WP 1.1 done + merged** → `ux/integration` `1f1b918` (clean FF). `GRADER_IDS`
  extended append-only (6→9; a strengthened contract test asserts the original six keep order +
  the three appended); `AUTO_RATING_VERSION=1`, `ROOT_CAUSE_BUCKETS`, `FIX_TARGETS`,
  `ERROR_FINDING_CATEGORIES`, verdict enums, `BASE_RATING_GRADER_IDS` (AR6 key); types
  `ErrorFinding`/`AnswerValidationEvidence`/`InsightSurplusEvidence`/`RunBaseRating`/`RunReport`/
  `SuiteReport` (+ variance/agreement/rollup helpers) reference existing types (Pick over
  `RunSummary`/`RunGrade`, reuse `AssertionResult`/`FailureBucket`/`SuiteRun`); zod in sync incl.
  an AR9 evidence-citation `.refine()`. **Two disclosed out-of-scope mechanical fixes** required
  by the union extension (both accepted): `apps/web/.../grade-format.ts` `Record<GraderId,…>`
  label maps (+3 plain labels; real AR6 chips are WP 3.1/3.2) and `benchmarks-contract.test.ts`
  (`length===6`→`9` + append-only asserts). Orchestrator re-gated in the worktree: typecheck ·
  lint (671) · test (1306/0) · build — all green. **Next: WP 1.2** (Opus, grading seam — depends
  on 1.1 ✓; touches `run-service.ts`/`grade-service.ts`/`index.ts`). 1.2 runs **solo** — it and
  WP 2.3 both write `index.ts`, so they serialize (1.2 first per the batch map).
- 2026-07-11 · **WP 1.2 done + merged** → `ux/integration` `d196641` (clean FF). `Grader.mandatory?:
  boolean` flag; `grade-service.gradeRun` now decides eligibility **per grader** (`isEligible`):
  mandatory → runs on any terminal status w/o expectations, gated only by the injected
  `AUTO_RATING_ENABLED` (default true) ops kill-switch; expectation graders → `run.status===
  "completed" && test.expectations` (byte-for-byte today's gate). `run-service` post-terminal hook
  now fires `gradeRun` on **all** terminal statuses (guards intact, `evaluateRunAssertions`
  untouched). `index.ts` edit minimal (kill-switch wiring only — no base graders registered here).
  Tests loop all 4 statuses × {expectations,none} + kill-switch + re-grade eligibility (fake
  graders); regression tests retained. Orchestrator re-gated: typecheck · lint (671) · test
  (1310/0) · build — green. **Deliberate semantic refinement (noted):** expectation graders are
  now `completed`-gated *inside* grade-service (previously only the run-service hook enforced
  completed-only), so **re-grading a NON-completed run via `POST /api/runs/:id/grade` no longer
  produces expectation grades** — matches the locked AR5 spec and `evaluateRunAssertions`'s
  completed-only rule; no test relied on the old behavior. **Next batch: WP 1.3 ∥ WP 1.4** (Opus;
  the two real base graders — new files). Both register a grader into `index.ts`'s roster, so they
  share `index.ts` — run in parallel worktrees, merge 1.3 first, then 1.4 rebases (trivial
  roster-array reconcile). WP 2.3 follows (rewires judge resolution for ALL LLM graders).
- 2026-07-11 · **WP 1.3 + WP 1.4 done + merged** (parallel Opus, disjoint new files) →
  `ux/integration` `499b376` (1.3 `error_forensics`), `5edb269`+`b0cf1d1` (1.4
  `answer_validation`+`insight_surplus`), then orchestrator wiring `333571a`. **1.3**: deterministic
  inventory over all 6 `ERROR_FINDING_CATEGORIES` (read-only) → `ErrorFinding[]` validated against
  `errorFindingSchema`; ONE schema-constrained LLM call refines bucket/`fixTarget`/`draftFix`;
  clean run → `graded 1.0`, judge-independent operational-health score (per-category severity
  penalties), inventory-only fallback (distinct method) when no/unpriced/failed judge; event
  evidence cites replay ordinals (`event:<i>`) since `RunDetail.events` doesn't surface DB
  `run_events.id` (steps prefer `RunStep.index`) — **note for WP 3.1/1.5 deep-links**. **1.4**:
  shared `base-rating-judge.ts` plumbing (tolerant verdict/rating parse → null-not-0, app-computed
  `citedSteps`, clip+truncation disclosure, separate cost ledger); `answer_validation`
  (`answered|partial|unanswered`) + double-edged `insight_surplus` (`none|valuable|noise`, padding
  LOWERS score, `surplusTokens` counted via `generic_o200k` over quoted padding spans). Both
  in-grader **unpriced-model + unconfigured-judge guards** (mandatory graders auto-run, so they
  self-guard → `unevaluable`, no spend); version-stamped methods (AR15). **Wiring** (`333571a`):
  all three registered in `index.ts`'s `graderRoster` with the existing provider judge
  (`judgeResolver`+`createProviderJudgeGenerate`) — WP 2.3 upgrades that to the CLI-first chain.
  Orchestrator gated 1.3 alone, the combined 1.3+1.4 state, and the fully-wired state: typecheck ·
  lint (678) · test (**1343**/0) · build — all green. **Phase 1 core complete** (1.1–1.4 + wiring;
  1.5 report endpoint remains). **Next: WP 2.3** (Sonnet — judge resolution chain CLI→provider→none
  + Settings + provenance; touches `packages/shared` [judge-settings resolved-source] + `index.ts`
  + `grading/routes.ts`). Then **WP 1.5** (composed report endpoint).
- 2026-07-11 · **WP 2.3 re-tiered Sonnet→Opus** (orchestrator judgment): actual blast radius ~17
  files — provenance must reach all five grader ledger sites AND stay correct on CLI→provider
  fall-through — matching the MODEL MAP's own "judgment-heavy / high blast radius" Opus criterion.
- 2026-07-11 · **WP 2.3 done + merged** → `ux/integration` `a0d93b8` (5 commits, clean FF).
  **Phase 2 complete.** New `grading/judge-chain.ts`: `chainJudgeResolver` (widened — "a judge is
  available" is true for CLI-subscription OR provider; returns the `claude_cli` sentinel settings
  when signed in so the base graders' CLI-aware pricing guard never blocks the free path) +
  `createJudgeChainGenerate` (tries CLI → on ANY `ClaudeCliJudgeError` falls through to a
  *configured* provider [AR16], else surfaces → grader `error`; re-resolves live). **Provenance**
  via additive `JudgeProvenance` on `JudgeGenerateResult` (API-internal); all 4 ledger sites prefer
  `result.judge* ?? settings.*` → CLI rows = `claude_cli`/cost 0/real tokens (AR13), fall-through
  rows = the ACTUAL provider id/model/estimated cost. One chain wired to all 5 LLM graders in
  `index.ts`. Shared additive: `CLAUDE_CLI_PROVIDER_ID`, `APP_SETTING_JUDGE_CLI_MODEL_KEY`,
  `ResolvedJudgeSource`, `JudgeSettingsResolved` (cliAvailable/cliModel/resolvedSource — **no
  token**), `JudgeSettingsUpdate`. `GET/PUT /api/grading/judge-settings` return the resolved source;
  CLI model persisted (`judge_cli_model`, default `claude-sonnet-4-5`); unpriced-provider guard
  kept (+ defense-in-depth on fall-through). Settings UI panel + CLI model select. Orchestrator
  re-gated: typecheck · lint (681) · test (**1364**/0) · build — green. **Owner-acceptance:** live
  subscription CLI judge + provider fall-through; Settings both-theme/keyboard walk of the new
  "Rating source" panel (tests/typecheck/build/lint only verified here). **Next: WP 1.5** (composed
  `GET /api/runs/:id/report` + run-export block), then Phase 3 (web) / Phase 4 (suite report).
- 2026-07-11 · **Migration claim: WP 4.1 takes `user_version = 22`.** Verified at claim time —
  `apps/api/src/db/database.ts` `MIGRATIONS` max is **v21** (`LATEST_SCHEMA_VERSION` auto-derived);
  no sibling `roadmap/*/STATUS.md` ledger claims v22 (benchmarks@15, skill-ide@17/18 historical,
  security-posture expects none, ci defers to the registry). `suite_run_reports` lands as an
  additive `CREATE TABLE IF NOT EXISTS` (the v13/v15/v17 pattern, NOT a v16-style rebuild);
  version-literal test locks (`benchmarks-*-contract.test.ts` `LATEST_SCHEMA_VERSION` 21→22) get the
  fix-forward. Re-verify v22 is still free at merge (bump to v23 if a concurrent session claims it).
- 2026-07-11 · **Batch dispatched: WP 1.5 (Sonnet) ∥ WP 4.1 (Opus).** Overlap = `index.ts` only, in
  different regions (1.5 report route vs 4.1 suite-report/orchestrator wiring) → merge 1.5 first,
  4.1 rebases (git auto-merges disjoint regions). **Ordering note (4.1):** run-service `done` already
  awaits `gradeRun` (run-service.ts:255) and the orchestrator awaits each cell's `handle.done` before
  `finish()`, so members are rated at `finish()` — 4.1 verifies this + adds a bounded-wait fallback
  (→ `partial`, never a hang), per the README risk.
- 2026-07-11 · **WP 1.5 + WP 4.1 done + merged** (parallel Sonnet ∥ Opus) → `ux/integration`
  `eacd892` (1.5) + `5478ff9` (4.1). **Phase 1 complete** (1.1–1.5 + wiring); Phase 4 foundation
  laid. **1.5**: read-only `RunReportService.compose` assembles `RunReport` from persisted
  `RunSummary` + latest-per-grader grades — base facets parsed from each base grade's `evidence`
  (WP 1.1 zod; `unevaluable`→score null; absent→documented default facet), `expectationGrades`
  EXCLUDES `BASE_RATING_GRADER_IDS` (AR6), provenance from the first base grade that actually
  rated; `GET /api/runs/:id/report` (404 on unknown); additive `rating` block on run JSON + a
  Markdown "Rating & grades" section (existing exports byte-identical when omitted). **4.1**:
  migration **v22** (`suite_run_reports`, additive `CREATE TABLE IF NOT EXISTS` + FK CASCADE +
  judge-ledger cols; forward-safe proven; version-literal locks fixed-forward across
  benchmarks-*/skill-ide/migrations tests); `SuiteReportService`/`SuiteReportRepository`
  (append-only, latest-per-suite-run); orchestrator post-`finish()` hook generates a `SuiteReport`
  ONLY for **≥2 members** (AR7), **fully guarded** (post-finalize, `try/catch`, optional-injected →
  no-report path unchanged; honest `partial`/`error` rows; never blocks/mutates the suite run,
  AR11). **Ordering CONFIRMED:** `handle.done` includes grading, so members are rated at
  `finish()`; a bounded poll (30s/250ms, injectable) → `partial` on timeout, never a hang.
  Deterministic analytics: per-test-group variance (mean+pop-stdDev) for score/cost/turns
  (score = `computeSuiteAggregates`'s primary-grader outcome, AR6-separate), `toolPathVariance`,
  and **deterministic** error clustering by `error_forensics` category (NO judge call — the
  judge-backed clustering + agreement + narrative + rootCauseRollup are honest placeholders for
  **WP 4.2**). `getToolCallSequence` added to `RunRepository` (run-service untouched). Both re-gated
  by orchestrator (1.5 alone; the rebased combined 1.5+4.1): typecheck · lint (686) · test
  (**1389**/0) · build — green; `index.ts` auto-merged (disjoint regions). **Remaining: Phase 3
  (WP 3.1 run Report tab, WP 3.2 verdict chips) + Phase 4 tail (WP 4.2 LLM agreement, WP 4.3 suite
  Report tab).** Phase 5 (5.1/5.2) is owner-gated backlog — not picked up.
- 2026-07-11 · **WP 3.1 done + merged** → `ux/integration` `de20249`. Run console gains a fourth
  left-pane **Report** tab (`ReportTab.tsx`) on the shared `TabPanel` — verdict header +
  answer/surplus cards (surplusTokens named on `noise`) + forensics list (bucket + fixTarget chips,
  labeled draft fix, step deep-links via the console's `navigateTo`) + expectation grades
  (existing `GradeChip`) + assertions + judge provenance + Re-rate (reuses `POST
  /api/runs/:id/grade`). Consumes the **shared** `RunReport` (aliased `RunRatingReport`) via a NEW
  `getRunRatingReport` → `GET /api/runs/:id/report` — deliberately NOT the pre-existing analytics
  `RunReport`/`/api/reports/run/:id/json` (name-collision avoided). Loading-states compliant
  (post-terminal only, skeleton, settled-error). No api/shared change; GradePanel left for 3.2.
- 2026-07-11 · **WP 3.2 + WP 4.3 done + merged** (parallel Sonnet, fully disjoint files) →
  `ux/integration` `30a9fcc` (3.2) + `04905a2` (4.3). **All of Phases 1–4 (13 WPs) complete.**
  **3.2** (web-only): `BaseVerdictChip` in the runs feed ALONGSIDE the expectation `GradeChip`
  (AR6) + an AR6-separate base-verdict marker per suite-matrix cell + `GradePanel` slimmed to a
  compact summary that opens the Report tab (full grader detail moved to a closed collapsible,
  nothing deleted). **Also fixed a latent AR6 bug** — `grade-format.pickPrimaryGrade` had no
  base-id exclusion, so a base grade could be silently shown as "the" expectation chip when a run
  had no expectation grade (the common case); now `filterExpectationGrades` excludes
  `BASE_RATING_GRADER_IDS`. **4.3** (web+api): `GET /api/suite-runs/:id/report` (latest; 404→null)
  + `POST` regenerate (append-only, `<2` members → `{report:null, reason:"insufficient_members"}`,
  AR7); additive `suiteReport` block on the suite-run JSON + a "## 7. Cross-run rating report"
  Markdown section (absent when none); suite console **Report** tab (`ConsoleTab += "report"`,
  self-loading) — consistency header, per-test-group agreement + variance, root-cause roll-up
  (bucket/fixTarget chips + draft fix), error clustering, narrative, provenance, Regenerate;
  loading-states compliant; `index.ts` two-arg dep-threading only. Orchestrator gated 3.2 and the
  rebased 4.3: typecheck · lint (696) · test (API **1406**/0 + web) · build — all green.
  **KNOWN FOLLOW-UP (4.3, noted):** `GET` returns the bare `SuiteReport`, not the persisted row's
  `status` (`ready`/`partial`/`error`), so the tab can't yet visually flag a `partial` report (some
  member ratings didn't land in WP 4.1's bounded wait) vs `ready` — the report *content* is honest,
  only the ready/partial badge is unsurfaced. A small additive follow-up (thread `status` through
  the GET envelope + a badge) would close it; deferred to owner (not a Phase-5 item).
- 2026-07-11 · **WORKSTREAM COMPLETE (Phases 1–4).** All 13 non-backlog WPs merged to
  `ux/integration` behind a green gate (final: typecheck · lint (696) · test API **1406**/0 + web ·
  build). Phase 5 (5.1 skill/server cross-links, 5.2 CI assertable + verdict trend) remains
  **owner-gated backlog** — not started. What remains is **owner-acceptance only** (below) — live
  subscription/provider-key walks + both-theme/keyboard UI walks — which the orchestrator cannot
  self-certify. Not pushed to origin (owner-gated).

- 2026-07-12 · **Owner-reported live defect fixed + registry extension (post-workstream session).**
  (1) **Root cause of "suite validation doesn't work":** every grader's 60s `callWithTimeout` also
  counted the CLI judge's AR14 **queue wait** (semaphore=1), so under suite load calls 4+ timed out
  while queued (`judge call timed out after 60000ms` on live runs). Fix: tight per-call bounds moved
  INSIDE the chain legs (CLI one-shot 120s post-acquire `CLI_JUDGE_ONESHOT_TIMEOUT_MS`; provider 60s
  per call inside `createProviderJudgeGenerate`), grader-level bounds become a 15-min never-hang
  backstop (`DEFAULT_JUDGE_QUEUE_BACKSTOP_MS`); forensics/failure-bucket/agreement bounds aligned.
  (2) Failure-bucket clustering moved onto the SAME CLI-first judge chain (AR2 now true everywhere).
  (3) Suite report: persisted `ready/partial/error` status echoed additively into the report (GET +
  exports + UI badge — closes the WP 4.3 known follow-up); deterministic per-test-group `findings`
  highlights; `baseline` delta vs the previous comparable suite run (per-test Δ score/cost/turns +
  agreement flips) for cross-suite-run comparability. (4) Run + suite-run exports (JSON+MD)
  restructured insights-first (Rating/Cross-run report → Summary → Statistics → Details → Appendix
  config). (5) **Rating Issues registry** (migration **v26**, owner-decided): deduplicated
  `rating_issues` + `rating_issue_occurrences` per skill/MCP-server target, created-or-enhanced by
  the CLI judge after EVERY run rating (open → resolved, auto re-open; deterministic fallback; never
  loses a finding), Issues tabs in server detail + skill inspector (resolve/reopen, run deep-links,
  MD/JSON developer export, "Fix with assistant" on open skill issues), run Report tab "Issues filed
  by this run" (`GET /api/issues?runId=`). (6) Fixed adhoc/collection suite-run console 404 ("Suite
  not found" — synthesized suite shell). Gate green (typecheck · API tests **1624**/0 · web 94 files
  856 pass · build · lint 770 files clean).

- 2026-07-12 · **Rating visibility (`ratingState` axis) + report redesign (post-workstream
  session, gate being verified — this session did not itself run
  `pnpm typecheck && pnpm test && pnpm build && pnpm lint`; the coordinating session runs and
  reports it).** (1) **Rating visibility:** additive `RATING_STATES`
  (`pending|rating|rated|failed|skipped`) landed in `packages/shared`; new `rating_state` columns
  on `runs` + `suite_runs` (migration **v27**, honest backfill — terminal rows with a persisted
  base-grade row → `rated`, every other terminal row → `skipped`, nothing invented). `RunService`'s
  post-terminal review chain now transitions `pending → rating → rated|failed` (`skipped` when no
  `GradeService` is injected), `finally`-guaranteed so a rating crash can never strand a run at
  `rating` forever. New additive SSE event `{type:"rating", state}` on both the run stream and the
  suite stream; a stream now closes only after the terminal run status AND a settled rating event
  have both been observed (a finished-run replay synthesizes one so a late subscriber still sees
  the transition). The re-rate endpoint transitions through the same states. Consistent with AR11
  — run/suite `status` axes are untouched and rating still never blocks/mutates a run;
  `ratingState` is a strictly additive third axis alongside `status` and the grade rows themselves.
  (2) **Web:** a "Reviewing…" spinner status now renders anywhere a run/suite status already
  renders (runs feed, suite-run rows, Compare, run console, suite console); the chat pane shows a
  "Reviewing & rating run…" `Shimmer` below the last message while `ratingState==="rating"`; the
  Report tab label itself carries a spinner; `ReportTab`/`SuiteReportTab` show an active "Rating in
  progress…" state, defer their fetch, and auto-refetch once rating settles; Re-rate disables
  itself while a background rating is in flight.
  (3) **Report redesign (owner feedback 2026-07-12):** new Outcome-judge and Trajectory-judge cards
  in the report body (score, reasoning, cited steps, donut); a new `scoreTone()` helper maps score
  thresholds to a tone (`<0.6` danger, `0.6–<0.8` warning, `≥0.8` success), applied to
  `ScoreReadout`, `GradeChip`, and `GradePanel` tiles; `@elabs-ai/components-charts` `RingChart` donuts on the
  score cards (score text left, donut right); a `RadarChart` on the run-rating card when ≥3 graded
  axes are present (chip fallback below that).
  **Known follow-ups (noted, not fixed this session):** the `SkillUsageRun` projection doesn't
  carry `ratingState` yet, so the skill-usage/trace picker can't show "Reviewing…" there without a
  wire addition; the warning-tone score chips currently borrow the `awaiting-approval`
  `StatusBadge` state as a stand-in — a real upstream `warning` `StatusBadge` state may be worth
  raising. **A follow-up deterministic grader is planned** — replace `rouge1` with an `ai_pattern`
  AI-writing-slop detector (owner-decided 2026-07-12, not started) — see
  [`wp-ai-pattern-grader.md`](./wp-ai-pattern-grader.md).

## Owner acceptance (owner-only)
- [ ] With a **signed-in Claude subscription**: a run rates automatically via the CLI judge
      (provenance shows `claude_cli`, tokens real, cost 0); pull the subscription → next run
      falls back to the provider judge; remove that too → deterministic-only report with
      honest `unevaluable` LLM facets — accepted: ____
- [ ] A deliberately broken run (bad tool arg / guardrail stop) yields an error_forensics
      finding whose bucket, fixTarget, and draft fix are believable, and whose evidence links
      resolve to the right steps — accepted: ____
- [ ] A ≥2-member suite with repetitions produces a suite report whose consistency verdict
      matches a human read of the member answers; costs/variance arithmetic spot-checked —
      accepted: ____
- [ ] Report tabs (run + suite) in **both themes** + keyboard walk; runs-feed verdict chip
      never conflated with expectation grades (AR6) — accepted: ____
- [ ] A live run watched end-to-end: `ratingState` visibly flips Reviewing → Completed (or
      Failed) in every surface it renders (runs feed, suite rows, Compare, run console, suite
      console, chat shimmer, Report tab label) — accepted: ____
- [ ] **Both-theme** walk of the report redesign: Outcome/Trajectory judge donuts, the
      run-rating `RadarChart`, `scoreTone()` thresholds on `ScoreReadout`/`GradeChip`/
      `GradePanel`, and the "Reviewing…" chips — accepted: ____
- [ ] Re-rate walk: triggering Re-rate visibly disables the control and shows the
      rating-in-progress state until the new report settles — accepted: ____
