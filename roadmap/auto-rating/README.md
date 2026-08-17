# Auto-Rating — mandatory post-run validation & reports · **PRIORITY: HIGH**

Owner directive (2026-07-11): **every run gets rated, automatically, no configuration required.**
After every terminal run the app must validate the initial user prompt against the end result
(was the question answered? did the model deliver *more* insight than asked — and was that surplus
valuable or noise?), inventory every error in the session, and classify each error's root cause —
split first-class between **fixable-in-a-skill** and **fixable-in-the-MCP-server**. Every
multi-member suite-run additionally gets an automatic cross-run report (consistency, process,
costs, errors). The default judge is the **Claude CLI (assistant subscription) when available**.
This is **not a parallel structure**: it blends into the existing Benchmarks grading system
(`run_grades`, graders, judge ledger) and surfaces as a new **Report tab** on the run console and
the suite-run console.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp auto-rating`). Extends
[`roadmap/benchmarks/`](../benchmarks/) (B1–B15; **B15 amended**, see AR12) and builds on the
testing-ia one-engine model (D-T3: everything is a plan → suite-run).

## What we're building

1. **Base rating = three always-on graders** joining the existing roster (append-only
   `run_grades`, latest-per-grader wins, `GRADING_VERSION` discipline — nothing new persisted
   per run beyond grade rows):
   - **`answer_validation`** — does the final assistant answer address the test's initial
     prompt? Verdict `answered | partial | unanswered` + 0–1 score, evidence quotes + cited
     steps (same evidence deep-link mechanic as the outcome judge).
   - **`insight_surplus`** — beyond-ask insight, **double-edged** (AR8): grounded, relevant
     surplus raises the score; padding/unrequested dumps lower it and get their token cost
     named. Verdict `none | valuable | noise`.
   - **`error_forensics`** — a **deterministic inventory** of everything that went wrong
     (error events, failed tool calls, guardrail stops, context overflow, MCP connection
     failures, `assertions_failed`) + LLM root-cause classification per finding into **5
     buckets** (`skill`, `mcp_server`, `model_behavior`, `test_setup`, `provider_infra`), each
     finding carrying a mandatory **`fixTarget: skill | mcp_server | none`** and a **drafted
     concrete fix** (AR4/AR9) — e.g. "add to SKILL.md: always pass `fields=…` to
     `acme_get_app`" vs "server: `search_docs` rejects its own documented `limit` param".
2. **One judge resolution chain for ALL LLM graders** (AR2/AR3), used by `outcome_judge`,
   `trajectory_judge`, and the new base graders alike:
   **Claude CLI (assistant subscription, if signed in) → configured provider judge
   (`app_settings['judge']`) → none** (LLM facets emit `unevaluable`; deterministic facets
   always emit). Which source rated is stamped on every grade row (judge provenance).
3. **Per-run Report** — composed on demand, no new per-run table (AR1):
   `GET /api/runs/:id/report` assembles base rating + expectation grades + assertion results +
   KPIs + judge provenance into one `RunReport`. The run console gets a fourth left-pane tab
   **Report** (Chat | Trace | Analytics | **Report**) as the canonical rating+grading surface.
   The run JSON/MD exports gain the grades/rating block (today they contain none).
4. **Suite auto-report** — after every suite-run with **≥2 members** (AR7): persisted
   (`suite_run_reports`, migration vNEXT), containing deterministic cross-run analytics
   (per-test-group score/cost/turn/tool-path variance, error clustering — failure buckets now
   auto-run, AR12) + **one LLM agreement call per test-group** ("3/3 runs conclude X" vs "runs
   contradict each other", AR10) + a narrative with cross-run root-cause roll-up (top
   skill-fixes / server-fixes by frequency). Suite console gets a **Report** tab; suite-run
   export gains the report; `POST /api/suite-runs/:id/report` regenerates (append-only).

## How it blends in (the seams — verified against the code)

- **Post-terminal hook exists:** `apps/api/src/testing/run-service.ts` `start()` already chains
  `evaluateRunAssertions` → `gradeRun` on the settled run promise. Base rating joins that chain.
  Two gates are relaxed **for mandatory graders only**: they run on **all terminal statuses**
  (AR5 — `completed, stopped, error, aborted`; answer facets go `unevaluable` when there's no
  final answer, forensics always runs) and **without `test.expectations`**
  (`grading/grade-service.ts` short-circuit becomes per-grader). Expectation graders keep
  today's completed-only + expectations gates unchanged.
- **Grader interface unchanged:** mandatory-ness is a new roster concept (e.g.
  `MANDATORY_GRADERS` alongside the roster injected in `apps/api/src/index.ts`), new ids added
  to the `GRADER_IDS` union (additive shared-contract change).
- **Claude CLI judge = a new `JudgeGenerate` implementation** over
  `apps/api/src/assistant/session-driver.ts` (`SdkAgentSessionDriver`) **directly — never
  through `AssistantSessionManager`** (no thread, no permission machinery, no active-session
  cap): tools-less one-shot (`mcpServers: {}`, `maxTurns: 1`), judge system prompt (never the
  assistant persona, D-AS9), `buildAssistantSpawnEnv`, throwaway cwd + SDK-transcript cleanup.
  The driver currently **drops token usage** — WP 2.1 adds an additive usage field to
  `DriverEvent` so the judge ledger stays real (AR13).
- **Auth:** a new public "judge auth" resolver on the assistant auth service (subscription if
  signed in). D-AS14's no-silent-fallback stays true for the interactive dock; the background
  chain CLI → provider judge is an explicit owner decision here (AR2), and the report always
  shows which source rated.
- **Suite hook:** `suites/orchestrator.ts` `finish()` → generate the suite report when members
  ≥ 2. **Ordering risk:** member grading runs in each run's own floating promise chain *after*
  `handle.done` — WP 4.1 must make the post-run hook awaitable from the orchestrator (or
  bounded-poll `run_grades`) so the suite report never reads half-rated members; degraded
  `partial` report on timeout, never a hang.

## Locked decisions (owner, 2026-07-11)

| # | Decision |
|---|---|
| AR1 | **Blend-in**: base rating = always-on graders writing `run_grades`; per-run report is composed on demand (no per-run report table); suite report is the only new persisted artifact. |
| AR2 | **Judge chain**: Claude CLI (subscription) → configured provider judge → deterministic-only. Automatic provider-API spend on fallback is accepted. |
| AR3 | **One judge resolution for all LLM graders** (existing `outcome_judge`/`trajectory_judge` included) — one Settings surface, one ledger, consistent behavior. |
| AR4 | **Root-cause taxonomy**: 5 buckets (`skill`, `mcp_server`, `model_behavior`, `test_setup`, `provider_infra`) **plus** a mandatory per-finding `fixTarget: skill \| mcp_server \| none` — the skill-vs-server split stays first-class. |
| AR5 | **Rate every terminal run** (incl. error/stopped/aborted/overflow). Root-cause analysis matters most on failures. |
| AR6 | **Separate dimension**: base-rating scores never enter `meanGrade`/`passRateAt05`/quality×cost scatter — existing expectation metrics keep their meaning. Base verdicts get their own chip/column surfaces. |
| AR7 | **Suite report only when ≥2 members**; single-member plans get the session report only. |
| AR8 | **Insight surplus is double-edged**: valuable surplus scores up, noise/padding scores down with its token cost named. |
| AR9 | **Findings describe + draft a concrete fix** (labeled suggestion, never auto-applied). |
| AR10 | **Suite consistency = deterministic variance + one LLM agreement call per test-group** (not pairwise). |
| AR11 | **Async, never blocking**: rating extends the Benchmarks invariant — it never blocks, fails, or mutates a run/suite-run; the Report tab fills in post-terminal. |
| AR12 | **B15 amendment**: failure-bucket clustering may auto-run as part of the mandatory suite report (manual endpoint stays). Noted in `../benchmarks/00-architecture.md`. |
| AR13 | **CLI judge usage is captured**: ledger rows carry `judge_provider_id='claude_cli'`, real token counts, `judge_cost_usd=0` (subscription). Never folded into run cost (B5 upheld). |
| AR14 | **Rating concurrency semaphore**, default 1 (env `AUTO_RATING_MAX_CONCURRENCY`) — each CLI child is ~1 GiB; suite `maxConcurrency` multiplies runs, ratings queue behind the semaphore. |
| AR15 | **Versioning**: `AUTO_RATING_VERSION = 1` in shared constants; methods stamped `answer_validation_v1` etc.; grade rows keep the `GRADING_VERSION` stamp. Versioned methods never silently aggregated. |
| AR16 | **Rate-limit handling for background rating**: on a CLI limit error, fall through the AR2 chain for that call and stamp provenance (no dock banner involvement; D-AS14 remains interactive-only). |

**Defaults — confirmed by owner at kickoff (2026-07-11):**
- CLI judge model default `claude-sonnet-4-5` (assistant thread default), selectable from the
  assistant roster in Settings → grading.
- Ops kill-switch `AUTO_RATING_ENABLED` (default `true`) — product-mandatory, ops-stoppable
  (mirrors how "mandatory" features stay debuggable). No per-test opt-out.
- Re-rate reuses `POST /api/runs/:id/grade` (roster now includes base graders; `graderIds`
  subset works) — no new per-run endpoint besides the composed `GET /api/runs/:id/report`.

## Data model & contract (additive)

- **No per-run table.** New table `suite_run_reports` (id, `suite_run_id` FK CASCADE, `status`
  (`ready | partial | error`), `report_json`, `rating_version`, judge ledger columns
  (`judge_provider_id/model/tokens_in/tokens_out/cost_usd`), `created_at`) — append-only,
  latest wins. Migration claims the next free `user_version` (**v22 expected** —
  `apps/api/src/db/database.ts` `MIGRATIONS` is at v21 today; re-verify at claim time against
  sibling ledgers, per convention).
- **`packages/shared` first** (contract-first): extend `GRADER_IDS` with the three base ids;
  new types + zod — `RootCauseBucket`, `FixTarget`, `ErrorFinding`, `AnswerValidationEvidence`,
  `InsightSurplusEvidence`, `RunReport` (composed), `SuiteReport`, `AUTO_RATING_VERSION`.
- **API (additive):** `GET /api/runs/:id/report` · `GET/POST /api/suite-runs/:id/report` ·
  judge-settings response gains resolved-source info (CLI availability + model) · run and
  suite-run exports include the rating/grades block.

## UI

- **Run console** (`apps/web/src/features/testing/RunConsole.tsx`): left `TabPanel` gains
  **Report** — verdict header (answered/surplus/error count), answer card with evidence
  step-links, surplus card, forensics list (bucket chip + fixTarget chip + draft fix +
  step deep-links), expectation grades, assertions, judge provenance + Re-rate. The right-rail
  `GradePanel` slims to a compact summary linking to the tab (WP 3.2). Post-terminal only —
  never renders mid-stream; skeleton while rating; error only on settled failure
  (`.claude/rules/loading-states.md`).
- **Runs feed** (`RunsView.tsx`): base-verdict chip alongside (not inside) the expectation
  `GradeChip` (AR6); suite matrix gains a verdict column.
- **Suite console** (`suites/SuiteRunConsole.tsx`): `ConsoleTab` union += `report`, following
  the `failures`/`delta` self-loading `AnalyticsTab` frame.
- Both themes, keyboard reachable, `tabular-nums` on numbers — the usual bar.

## WP index

### Phase 1 — Contract & always-on core (API)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Shared contract: base grader ids, taxonomy/report types + zod, `AUTO_RATING_VERSION` | — | M |
| 1.2 | Grading seam: mandatory roster, gate relaxation (all-terminal + no-expectations, per-grader), tests | 1.1 | M |
| 1.3 | `error_forensics`: deterministic inventory + LLM classification + draft fixes (schema-constrained JSON) | 1.2 | L |
| 1.4 | `answer_validation` + `insight_surplus` rubrics (transcript digest reuse from `judge.ts`) | 1.2 | M |
| 1.5 | Composed `GET /api/runs/:id/report` + run-export grades/rating block | 1.3, 1.4 | M |

### Phase 2 — Claude CLI judge (one judge for all)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Driver usage capture: additive `DriverEvent` usage field (assistant behavior unchanged, D-AS11 untouched) | — | S |
| 2.2 | `createClaudeCliJudgeGenerate`: raw-driver one-shot, judge auth resolver, semaphore, throwaway cwd + transcript cleanup, timeout | 2.1 | L |
| 2.3 | Resolution chain in `judgeResolver` (CLI → provider → none) + Settings surface + provenance on grade rows | 2.2 | M |

### Phase 3 — Web run report
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | Run console **Report** tab (canonical surface, loading-states compliant, both themes) | 1.5 | L |
| 3.2 | Verdict chips (runs feed + suite matrix, AR6-separate) + `GradePanel` slimming | 3.1 | M |

### Phase 4 — Suite auto-report
| WP | Title | Depends on | Size |
|---|---|---|---|
| 4.1 | Migration (`suite_run_reports`) + orchestrator post-`finish()` hook (≥2 members) + awaitable member-rating seam + deterministic analytics (variance, error clustering / auto failure buckets) | 1.3 | L |
| 4.2 | Per-test-group LLM agreement + narrative + cross-run root-cause roll-up | 4.1, 2.3 (works on provider judge alone) | M |
| 4.3 | Suite console **Report** tab + suite-run export block + regenerate endpoint | 4.2 | M |

### Phase 5 — Cross-links (backlog, owner-gated)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 5.1 | `fixTarget: skill` findings → SkillFlow suggestion drafts / Skill IDE deep-links; `mcp_server` findings → server detail + future Advisor evidence | 4.3 | M |
| 5.2 | Base verdict as a CI assertable (feeds `roadmap/ci/`); verdict trend per server/skill over time | 3.2 | S |

**Parallel execution map** (one worktree sub-agent per WP; `packages/shared` and `run-service`
writers serialize across workstreams as always): batch 1: **1.1** solo → batch 2: **1.2 ∥ 2.1**
→ batch 3: **1.3 ∥ 1.4 ∥ 2.2** → batch 4: **1.5 ∥ 2.3** → batch 5: **3.1 ∥ 4.1** → batch 6:
**3.2 ∥ 4.2** → batch 7: **4.3**.

## Invariants

- Rating **never blocks, fails, or mutates** a run or suite-run (Benchmarks grading invariants
  extended verbatim to base rating and suite reports).
- Judge/graders **never execute anything** — B15's core stands; they read persisted runs,
  scans, skills, expectations only.
- **Append-only** artifacts, latest wins; honest statuses (`unevaluable` is never a failure and
  never a 0); versioned methods never silently aggregated.
- Judge cost is a **separate ledger** (B5); CLI rows: real tokens, cost 0, provenance stamped.
- **Honest degradation**: no judge available → deterministic facets + `unevaluable` LLM facets,
  never a fake score, never a silent skip.
- **Draft fixes are labeled suggestions** — the app never auto-applies them (Advisor invariant
  mirrored); every finding must cite its evidence (step/event ids).
- Base-rating scores never change the meaning of existing expectation metrics (AR6).

## Risks / watch items

- **Orchestrator ordering** (member grades vs `finish()`): WP 4.1's awaitable seam is the fix;
  bounded wait → `partial` report, never a hang.
- **CLI child memory** (~1 GiB): AR14 semaphore; watch suite wall-clock — ratings queue.
- **No logprobs via CLI**: `outcome_judge` runs `single_sample` under the CLI (method stamp
  stays honest); calibration work remains Benchmarks Phase 6 (owner-gated, untouched).
- **Transcript churn**: the SDK writes JSONL per call — WP 2.2 uses a throwaway cwd + cleanup;
  `prune-assistant` retention is not repurposed.
- **Judge hallucination in draft fixes**: schema-constrained output, required evidence refs,
  "suggestion" framing in UI.
- **Long transcripts**: reuse the existing judge digest/truncation approach; stamp truncation
  in evidence so a clipped rating is visible.

## Relationship to other plans

- **benchmarks** — extends it; B15 amended (AR12); Phase 6 calibration unaffected.
- **assistant** — reuses driver + spawn-env + auth store; D-AS11 (no assistant metering)
  untouched (usage capture is consumed by grading only); D-AS14 scope clarified as
  interactive-only, with AR16 governing background behavior.
- **advisor** — `error_forensics` fixTargets and suite reports become Advisor evidence sources
  (WP 5.1 pointer when Advisor Phase 1 lands).
- **ci** — the base verdict becomes an assertable (`mcpfp assert`) once `roadmap/ci/` Phase 1
  exists (WP 5.2 pointer).
- **skill-ide / skillflow** — skill-fixable findings feed the existing fracture→suggestion
  loop and IDE deep-links (Phase 5).

## Definition of done (every WP)

Gate green from repo root (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) +
per-WP acceptance; ledger discipline per [`STATUS.md`](./STATUS.md). Owner acceptance requires
a live walk with a signed-in Claude subscription (CLI judge) **or** a provider key (fallback
judge) — listed in the ledger.
