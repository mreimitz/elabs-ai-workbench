# WP — Judge live preview + bounded re-rate window

> **Status: PROPOSED 2026-08-18 — owner-gated backlog** (same posture as this folder's
> Phase 5). Two small grading-domain features imported from the landscape research
> ([`research/langfuse-landscape/01-gap-analysis.md`](../../research/langfuse-landscape/01-gap-analysis.md)
> §G7; Braintrust "rewind" in §02). Follows the single-WP-doc precedent of
> [`wp-ai-pattern-grader.md`](./wp-ai-pattern-grader.md). AR1–AR16 untouched; AR6
> (append-only `run_grades`, expectation metrics keep their meaning) is the hard constraint
> both features are designed around.

## Part A — Judge-settings live preview

**Problem.** Editing judge settings (model chain, prompts, thresholds) is blind: the effect
shows up only on the *next* runs. Langfuse previews evaluator edits against the last 24h of
live data; that pattern transfers directly.

**Scope.** In the judge-settings UI, a read-only preview panel: "against your last N
terminal runs (default 20), this configuration would have applied to X runs; sample
verdicts for 3 of them." Preview executions run through the existing CLI-first judge chain
with a hard per-preview spend cap and **do not persist grades** — preview results are
ephemeral, clearly labeled, never written to `run_grades`.

**Acceptance.** Preview renders for both a deterministic-only and an LLM-judge config;
spend cap enforced (unpriced judge model → rejected, mirroring the run-engine rule);
nothing appears in any run's Report tab afterward; both themes + keyboard.

## Part B — Bounded re-rate window ("re-rate since")

**Problem.** After a judge-prompt or grader fix, historical ratings are stale but replayable
runs are right there. Braintrust's online-scoring "rewind" (re-process from a timestamp) is
the shape; ours must respect append-only history.

**Scope.** An owner-initiated action: "re-rate terminal runs since <timestamp/last N>"
(bounded, default cap 50) using the current judge settings. Implementation rules:

- **Append, never overwrite** (AR6): re-rating writes new `run_grades` rows tagged with a
  rating revision; the Report tab shows the latest revision with a "re-rated <date>,
  supersedes <date>" note and access to prior revisions.
- `ratingState` transitions reuse the existing axis (`rated → rating → rated`); "Reviewing…"
  chips surface exactly as on first rating.
- Cost guardrail: pre-flight estimate (runs × judge cost) with confirm; soft-stop cap
  mid-batch (suite-runner precedent).
- Suite reports referencing re-rated members recompute their aggregates lazily, flagged as
  "contains re-rated members."

**Acceptance.** A re-rated run keeps its original grades queryable; compare workspace and
suite analytics read the latest revision consistently; batch respects the cap and is
resumable after restart (startup orphan-reconciliation precedent); gate green.

## Explicit non-goals

No automatic/scheduled re-rating (owner-initiated only); no re-rating of expectation grades
from Benchmarks (only the auto-rating dimensions); no judge-config versioning UI beyond the
revision tag (config history is out of scope here).
