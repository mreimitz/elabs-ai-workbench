# Benchmarks — implementation plan (work packages) · **PRIORITY: HIGH (parallel with Skill IDE)**

Executable plan adding **output-quality grading, suite mass-runs, quality×cost analytics, and
GitHub-synced Collections** to the Testing feature, driven by `/next-wp benchmarks`.
Locked decisions: [`00-architecture.md`](./00-architecture.md) (B1–B15).
Shared rules: [`conventions.md`](./conventions.md). Living state: [`STATUS.md`](./STATUS.md).

Owner directive (2026-07-04): adopt the quality-measurement concept from the
`insights-bench` prototype (see
[`../research/insights-bench-assessment.md`](../research/insights-bench-assessment.md)) —
enhance the Test entity for much richer tests, add parallel mass-runs of multiple tests, and
import/export/**two-way sync** tests with folders of GitHub repos.

## What we're building (on top of Testing/Skills/SkillFlow)

1. **Graded tests**: an additive `expectations` block on Test (expected insight, structured
   value, reference logic, answerable flag, rubric) + analytics metadata (category, difficulty,
   tags). Existing tests are untouched.
2. **Graders** behind a `Grader` interface (the `TokenCounter` pattern): deterministic ROUGE-1 +
   value-match, an LLM-as-judge with logprob-weighted scoring (existing provider credentials +
   pricing — zero new SDKs), auto-run on completion, append-only `run_grades` with a separate
   judge-cost ledger, `GRADING_VERSION` stamped.
3. **Process grading**: deterministic tool-hygiene (arguments validated against the server's
   latest scan schemas + misuse signals), the ported trajectory-vs-reference-code judge, and a
   scored SkillFlow-conformance summary.
4. **Suites**: first-class entity; a suite run executes tests × scenarios × repetitions (default
   concurrency 3, soft-stop aggregate cost cap) as ordinary persisted runs; live suite console
   (matrix grid + KPI rail), metadata breakdowns, the **quality×cost scatter**, and opt-in
   LLM-clustered failure buckets.
5. **Collections + GitHub sync**: explicit Collection entity per repo+path+branch (encrypted
   PAT), one-JSON-file-per-test + suite manifests, **real-git-merge two-way sync** with a
   conflict-resolution UI, and a one-time InsightBench importer.
6. **Skill-effect A/B**: run a suite across scenario variants (± attached skill / version pin)
   and read the grade/token/cost delta per test.

## WP index

### Phase 1 — Grading foundation
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Contract: `expectations` + test metadata + `Grade` shapes + judge settings (types/zod/migration) | — | M |
| 1.2 | Grader engine: `Grader` interface, `rouge1`, `value_match`, post-completion hook, `run_grades` | 1.1 | L |
| 1.3 | LLM judge (outcome): G-Eval prompt, logprob weighting, judge settings API, re-grade endpoint | 1.2 | L |
| 1.4 | UI: Grade panel in run console, grade chips in runs list + compare, judge settings in Settings | 1.3 | M |

### Phase 2 — Process grading
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | `tool_hygiene` grader: scan-schema argument validation + misuse signals | 1.2 | L |
| 2.2 | `trajectory_judge`: rubric port, run_steps → operations digest, grade record | 1.3 | M |
| 2.3 | `skillflow_conformance` scored grader over existing alignment verdicts | 1.2 | S |

### Phase 3 — Suites & mass-run
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | Contract + schema: suites, suite_tests/scenarios, suite_runs, runs+= (types/zod/migration) | 1.1 | M |
| 3.2 | Orchestrator: cell queue, concurrency, repetitions, soft-stop cap, suite SSE, stop/reconcile | 3.1 | L |
| 3.3 | Suite console UI: matrix grid, KPI rail, drill-through, suite CRUD screens | 3.2 | L |
| 3.4 | Analytics: metadata breakdowns + quality×cost scatter + suite report export | 3.2 | L |
| 3.5 | Failure buckets: opt-in LLM clustering of low-score judge reasons | 3.4 | M |

### Phase 4 — Collections & GitHub two-way sync
| WP | Title | Depends on | Size |
|---|---|---|---|
| 4.1 | Contract + schema: collections, membership, file format + externalKey, (de)serializers | 1.1 | M |
| 4.2 | Git engine: working clones, export/commit, fetch+merge, conflict model, PAT discipline | 4.1 | L |
| 4.3 | Sync UI: collection manager, status (ahead/behind/dirty), diff preview, conflict resolution | 4.2 | L |
| 4.4 | InsightBench importer (colleague's `questions.json` → collection/suite/tests) — API + fixture in W4; the "Import" button folds into 4.3 (its target screen is built there). See STATUS decision log 2026-07-04. | 4.1 | M |

### Phase 5 — Skill-effect A/B
| WP | Title | Depends on | Size |
|---|---|---|---|
| 5.1 | Suite variant axis (± skill / version pin) + per-test delta view | 3.4 | L |

### Phase 6 — Judge calibration & trust · **BACKLOG (owner-added 2026-07-04; NOT in the W1–W6 mission)**
| WP | Title | Depends on | Size |
|---|---|---|---|
| 6.1 | Grade feedback (`agree`/`disagree` + note) + calibration set | 1.4 | M |
| 6.2 | Agreement analytics per judge model/version + judge-change re-grade guard | 6.1 | M |

## Dependency graph / build order

```
1.1 → 1.2 ─┬→ 1.3 → 1.4
           ├→ 2.1
           ├→ 2.3
1.3 ───────┴→ 2.2
1.1 → 3.1 → 3.2 ─┬→ 3.3
                 └→ 3.4 → 3.5
                        └→ 5.1
1.1 → 4.1 ─┬→ 4.2 → 4.3
           └→ 4.4
```

Recommended waves: **W1** 1.1 (solo, contract) → **W2** 1.2 ∥ 3.1 ∥ 4.1 → **W3** 1.3 ∥ 2.1 ∥ 3.2 ∥ 4.2 →
**W4** 1.4 ∥ 2.2 ∥ 2.3 ∥ 3.3 ∥ 4.4 → **W5** 3.4 ∥ 4.3 → **W6** 3.5 ∥ 5.1. Parallel batches honor
minimal file overlap; `packages/shared`, `db/schema.ts`, and `run-service` writers serialize
(1.1 / 3.1 / 4.1 all touch shared+schema — they may merge into one contract WP at execution time
if `/next-wp` prefers; the ledger rules).

## Definition of done (every WP)

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, plus the WP's
Acceptance met. Contract-first, API runtime/secret boundary, grading-never-blocks-runs and
never-execute invariants, `@brand/*` only + two themes — see
[`conventions.md`](./conventions.md).
