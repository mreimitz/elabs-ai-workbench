---
type: "Work Package Spec"
title: "Benchmarks \u2014 shared conventions"
description: "The testing and skillflow"
tags: ["roadmap", "RM-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Benchmarks — shared conventions

The [`testing`](/Roadmap/RM-26-testing/conventions.md) and [`skillflow`](/Roadmap/RM-23-skillflow/conventions.md)
conventions apply verbatim (contract-first in `packages/shared`, runtime/secret boundary,
`@elabs-ai/components-*`-only UI in both themes, honest reporting, gate =
`pnpm typecheck && pnpm test && pnpm build && pnpm lint`). Additions specific to this workstream:

## Grading invariants

- **Grading never blocks, fails, or mutates a run.** Graders execute post-completion (the WP 5.1
  assertion-hook point). A judge error/timeout becomes a `run_grades` row with status `error`;
  run status/outcome/SSE are untouched.
- **Graders never execute anything.** No code execution, no MCP calls, no skill execution — they
  read persisted `run_steps`, scans, alignments, and expectations only. `referenceLogic` is a
  *document* handed to a judge, never run.
- **Append-only grades.** Re-grading inserts new rows; history is provenance. Display selects the
  latest per grader id.
- **Honest statuses.** `unevaluable` (missing expectations facet, no parseable value, no
  referenceLogic, judge unconfigured) is never a failure and never a 0 score.
- **Versioned methods.** Every grade row stamps `grading_version`, grader id, and `method`
  (`logprob_weighted` vs `single_sample`); scores across different versions/methods are never
  silently aggregated together (guard like cross-profile compare deltas).
- **Judge cost is a separate ledger** (`judge_cost_usd` on grade rows). Never fold into run
  `cost_usd`. Unpriced judge models are rejected (same rule as runs).

## Suite invariants

- A suite-run cell **is a normal run** — full persistence, replay, console, per-run guardrails.
  No shortcut execution path.
- Cells are isolated: each opens its own MCP sessions (`openSession`); never share a stdio child
  across concurrent cells.
- Aggregate cost cap is **soft-stop**: stop scheduling, let in-flight finish, mark `capped`.
  Partial suite results are first-class, never discarded.
- Aggregates cached on `suite_runs.aggregates_json` are derived data — recomputable from child
  runs + grades; never the source of truth.

## Sync invariants

- PAT handling inherited from the skills git machinery: encrypted at rest, argv-only credential
  helper, never on disk, never in responses/logs, redacted errors, SSRF DNS guard, subprocess
  timeouts. **No force-push, ever.** Sync only on explicit user action.
- Exported files contain **no secrets and no local-only references** (no provider ids, server
  ids, credential material). `externalKey` is the cross-system identity; local `id` never leaks.
- Serialization is deterministic (stable key order, 2-space indent, trailing newline) so git
  diffs stay reviewable.
- Working clones live under `DATA_DIR/collections/<id>` (git-ignored territory), never in the
  repo tree.

## Naming

Feature name is **Benchmarks** (nav item, routes under `/testing/*` for suites/runs and
`/testing/collections`). Code lives in `apps/api/src/{grading,suites,collections}/` and
`apps/web/src/features/{testing,benchmarks}/` — follow existing feature-folder style
(repository/service/routes split, thin routes).
