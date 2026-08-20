---
type: "Work Package Spec"
title: "Benchmarks \u2014 architecture & locked decisions"
description: "New workstream adding output-quality measurement to the Testing feature: graded tests"
tags: ["roadmap", "RM-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Benchmarks — architecture & locked decisions

New workstream adding **output-quality measurement** to the Testing feature: graded tests
(ground truth + LLM-as-judge + deterministic graders), **suite mass-runs** (test × scenario
matrix, parallel, repetitions), result analytics (quality × cost), and **Collections** synced
two-way with GitHub repos. Concept origin: the `insights-bench` prototype analyzed in
[`../research/insights-bench-assessment.md`](../../Research/RS-08-insights-bench-assessment/notes/insights-bench-assessment.md) —
we adopt its methodology (G-Eval judge with logprob weighting, trajectory-vs-reference judging,
`answerable:false` semantics), not its execution machinery (our run engine already captures
exactly, not self-reported, what that pipeline begs the agent to record).

All Testing conventions and the SkillFlow decisions (D1–D8, as amended) remain binding. Owner
decisions below were locked 2026-07-04 (Q&A with owner).

## Locked decisions

### B1 — Ground truth is a generalized `expectations` block on Test (additive)
`Test` gains optional `expectations`: `{ expectedInsight?: string; expectedValue?: unknown
(structured JSON); referenceLogic?: { kind: 'code' | 'text'; language?: string; body: string };
answerable?: boolean (default true); rubricOverride?: string }` — persisted in a new
`tests.expectations_json` column (same D8 additive pattern as `assertions_json`). Test also
gains optional analytics metadata: `category?`, `difficulty?: 'easy'|'medium'|'hard'`,
`tags?: string[]`. A test without expectations behaves exactly as today. The shape is a
**superset** of the insights-bench fields (`gt_insight`, `gt_insight_value`, `gt_code`,
answerable detection), so its data imports losslessly without baking research naming into our
contract.

### B2 — Graders live behind a `Grader` interface, deterministic baseline included
Mirroring `TokenCounter`: `Grader { id, kind: 'deterministic' | 'llm'; grade(ctx): GradeResult }`
in `apps/api/src/grading/`. v1 deterministic graders: **`rouge1`** (in-house unigram-F1 — trivial
math, **no new dependency**) and **`value_match`** (compares `expectedValue` against a parseable
JSON block in the final assistant message; when none exists the result is honest-status
`unevaluable`, never a fail — same status discipline as assertion results). Every grade carries
`gradingVersion` (`GRADING_VERSION` constant, starts at 1) + the grader id + method, so grades
from different methods are never silently compared (the `counting_version` discipline applied to
grading).

### B3 — Judge = global setting, per-suite override, existing provider credentials
Settings gains a **default judge**: a reference to an existing encrypted `provider_credentials`
row + model id. Suites may override (B7). Judge calls run through the existing provider layer and
are priced via `pricing.ts`; an unpriced judge model is rejected exactly like an unpriced run
model. **No Gemini/Vertex or any new SDK dependency.** Logprob-weighted rating (the
insights-bench technique: expected value over the top-k rating-token candidates) is used **when
the provider exposes logprobs**; otherwise single-sample at temperature 0 — the grade records
`method: 'logprob_weighted' | 'single_sample'` honestly.

### B4 — Auto-grade on completion; grading NEVER blocks or fails a run
When a completed run's test has `expectations`: deterministic graders always run (free);
the LLM judge runs automatically when a judge is configured. Grading executes **post-completion**
(same hook point as the WP 5.1 assertion evaluator): a judge failure/timeout yields a grade row
with status `error`, never mutates run status, never blocks SSE close. Manual **re-grade**
endpoint re-runs graders (old grade rows are kept — grades are append-only history, latest wins
for display) so a judge-model upgrade can re-score without losing provenance.

### B5 — Grading cost is a separate ledger
Grade rows carry their own `judge_tokens_in/out` + `judge_cost_usd`. Run `cost_usd` stays **pure
agent cost** (the app's core signal). Suite aggregates show execution cost and grading cost side
by side.

### B6 — Process grading = three graders; no golden-run reference
1. **`tool_hygiene`** (deterministic-first): validates every `tool_call` step's arguments against
   the tool's `inputSchema` from the server's **latest completed scan** (`mcp_tool_scans` — same
   read-only reuse as Skill IDE I5): missing required fields, wrong top-level types, unknown
   properties, enum violations (documented in-house subset — **no ajv dependency in v1**; adding
   a full JSON-Schema validator is owner-gated). Plus trace-derived signals: calls to tools
   outside the scenario's allowed set, tool-error rate, identical-call redundancy,
   error→immediate-retry patterns. Produces findings + a 0–1 score.
2. **`trajectory_judge`** (LLM): the insights-bench rubric ported — compares the run's tool-call
   chain (from `run_steps`, redacted payloads) against `expectations.referenceLogic`
   (dimensions/measures/filters/groupings/sort, omissions, redundancy; 0–10 rubric + written
   comparison + reason). Only runs when `referenceLogic` is present.
3. **`skillflow_conformance`** (deterministic): derives a 0–1 score from the run's existing
   SkillFlow alignment verdicts (gates passed/visited, routes taken, fractures) — a scored
   summary over the WP 5.1 machinery, read-only, no LLM.

Golden-run-as-reference was considered and **not** selected — out of scope.

### B7 — Suite = first-class entity; suite run = test × scenario × repetition matrix
New `suites` entity: named, ordered set of tests + default scenario set + config
`{ repetitions (default 1, max 5), maxConcurrency (default 3), aggregateCostCapUsd?,
judgeOverride? }`. A **suite run** executes every cell (test × scenario × repetition) as a
normal, fully persisted run (child runs carry `suite_run_id` + `repetition` — additive columns).
Repetitions ship **day one**: aggregates report mean ± spread, directly fixing the prototype's
single-run weakness. Child runs are ordinary runs everywhere else (console, replay, delete
guards).

### B8 — Orchestration: isolated cells, bounded concurrency, soft-stop aggregate cap
The engine is untouched — each cell opens its own MCP sessions via `openSession` exactly like a
manual run (stateful servers stay isolated per cell). A suite orchestrator schedules cells with
`maxConcurrency`; when cumulative cost (completed + in-flight runs' current accounting) reaches
`aggregateCostCapUsd`, it **stops scheduling new cells, lets in-flight finish**, and marks the
suite run `capped` (partial results are first-class). Per-run guardrails still apply per cell.
Suite progress streams over SSE (run-manager pattern lifted to suite level); startup orphan
reconciliation covers suite runs like runs.

### B9 — Analytics v1 (all four, in this order)
(1) **Suite console**: live matrix grid (tests × scenarios; repetition roll-up per cell),
per-cell status/score, aggregate KPIs (mean grade ± spread, pass rate @0.5, tokens, exec cost,
judge cost), drill-through to any child run console. (2) **Metadata breakdowns**: score/cost
distributions sliced by `category`/`difficulty`/`tags`, grouped by scenario (model/server).
(3) **Quality × cost scatter** — the signature view: X = tokens or cost, Y = grade, one point per
test×scenario (repetitions averaged), colored by scenario. (4) **Failure buckets**: opt-in LLM
clustering of low-score judge reasons into a failure taxonomy (judge-priced, explicitly
triggered — never automatic).

### B10 — Collections: explicit entity, a test lives in ≤ 1 collection
New `collections` entity = an owned set of tests + suites bound to one repo + path + branch
(PAT encrypted at rest like provider credentials). Membership is explicit
(`tests.collection_id` / `suites.collection_id`, nullable = local-only). **Multiple collections
= multiple repos**; no tag-implied membership, no duplication.

### B11 — Sync is full two-way via REAL git merge, always an explicit action
Each collection keeps a working clone under `DATA_DIR/collections/<id>` (never inside the repo
tree). Sync: export local state → commit → `git fetch` → merge (no rebase-rewrite of remote
history, **no force-push ever**); merge conflicts surface as a per-file conflict list in the UI
with take-local / take-remote / edited-content resolution, then commit + push. Credential
discipline inherited verbatim from the skills git machinery (argv-only PAT helper, SSRF DNS
guard, redacted errors, subprocess timeouts). Sync runs only when the user clicks — **no
background auto-sync**. Secrets can never leak: test/suite files contain no credentials by
construction (B12).

### B12 — On-disk format: one JSON file per test + suite manifests
`<path>/tests/<kebab-name>.json` (full test incl. expectations + metadata, zod-validated, stable
key order + trailing newline for clean diffs) and `<path>/suites/<name>.json` (ordered test refs
+ suite config). Identity across systems is a generated **`externalKey`** stamped into the file
and the DB row (DB `id` stays local). Attachments are **not** synced in v1 (files reference
attachment names; a test with attachments exports with a warning). Provider/scenario/server
references are **not** exported — suites store scenario names as informational hints only;
binding to real scenarios happens locally.

### B13 — InsightBench importer
A one-time importer converts the colleague's `questions.json` (and the answered result files)
into a chosen collection: app → `tags: [app]` + category/difficulty, question → test
(`acme_question` → userPrompt, `gt_insight`/`gt_insight_value` → expectations,
`gt_code` → `referenceLogic { kind:'code', language:'python' }`), unanswerable-pattern detection
→ `answerable:false` (port of `convert_to_benchmarks.py` regexes). Import only — we never write
his format back.

### B14 — Parallel workstream
Runs **in parallel with Skill IDE** via `/next-wp benchmarks`, own
[`STATUS.md`](./STATUS.md) ledger, owner arbitrates WP by WP. `packages/shared` and
`run-service` writers serialize across workstreams as always.

### B15 — Non-goals (this plan)
- **No external hosted-agent adapters** (e.g. the vendor DAA API): graded results come only from this
  app's own run engine — consistent with the SkillFlow D6 amendment (external session-JSONL
  removed 2026-07-03).
- Judge/graders **never execute anything** (no code run, no MCP calls; they read persisted runs,
  scans, and expectations).
- No background sync, no webhooks, no multi-user.
- No golden-run trajectory reference (B6).
- Failure-bucket taxonomy never runs unprompted (B9.4). **Amended 2026-07-11 (owner,
  auto-rating AR12):** the mandatory suite report in [`../auto-rating/`](../RM-06-auto-rating/) may
  invoke failure-bucket clustering automatically after a suite-run with ≥2 members; the manual
  `POST /api/suite-runs/:id/failure-buckets` endpoint stays.

## Data model (new/changed — `apps/api/src/db/schema.ts`, versioned migration)

```
tests               += expectations_json TEXT, category TEXT, difficulty TEXT,
                       tags_json TEXT NOT NULL DEFAULT '[]', collection_id TEXT NULL
run_grades          (id, run_id FK CASCADE, grader_id, kind, status
                       ('graded','unevaluable','error'), score REAL NULL /*0–1 normalized*/,
                       raw_score REAL NULL, method TEXT, reasoning TEXT, evidence_json TEXT,
                       judge_provider_id TEXT NULL, judge_model TEXT NULL,
                       judge_tokens_in INT, judge_tokens_out INT, judge_cost_usd REAL,
                       grading_version INT, created_at)   -- append-only
suites              (id, name, description, config_json, collection_id TEXT NULL,
                       created_at, updated_at)
suite_tests         (suite_id FK, test_id FK, position)   -- ordered membership
suite_scenarios     (suite_id FK, scenario_id FK)         -- default scenario set
suite_runs          (id, suite_id FK, status ('pending','running','completed','capped',
                       'stopped','error'), config_snapshot_json, started_at, ended_at,
                       aggregates_json)
runs                += suite_run_id TEXT NULL, repetition INT NULL   -- additive
collections         (id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha,
                       created_at, updated_at)
settings/judge      -- default judge (provider_credential_id + model) stored like other
                       app settings (no plaintext keys; references only)
```

API families (versionless, additive): `grading/` (`GET /api/runs/:id/grades`,
`POST /api/runs/:id/grade`), `suites/` (CRUD + `POST /api/suites/:id/run`,
`GET /api/suite-runs/:id` + `/stream`, `POST /api/suite-runs/:id/stop`), `collections/`
(CRUD + `POST /api/collections/:id/sync`, conflict resolution, `POST /api/collections/import/insightbench`).
Contract-first: every shape lands in `packages/shared` (types + zod) before API before web.

## UI surface (routes, `@elabs-ai/components-*` only, both themes)

- Run console: **Grade panel** (per-grader score cards, judge reasoning, re-grade action) +
  grade chips in runs list and run compare.
- `/testing/suites`, `/testing/suites/:suiteId` (definition), `/testing/suite-runs/:suiteRunId`
  (live console: matrix grid, KPI rail, scatter + breakdown tabs, failure-bucket tab).
- `/testing/collections` (+ detail: sync status ahead/behind/dirty, diff preview, conflict
  resolution screen).
