# WP 5.6 — Session pack (live-run compatibility tests)

**Status:** ⬜ open.
**Depends:** WP 5.2; Phase 1 run engine (built); WP 5.5 (session severity rules help).

## Goal
Wire the 8 session-level tests onto the run engine so post-run compatibility is measured from real
execution data.

## Deliverables
- New per-step instrumentation: add `cumulative_tokens` to `run_steps` (additive `ALTER TABLE`,
  guarded — see `conventions.md` persistence rules) + derive per-turn tool-call / parallel-call
  counts and token-rate in `testing/accounting.ts` (not derivable from current `run_steps`).
- Session evaluators in the engine reading `ToolCallResult` (`responseTokens`/`durationMs`),
  `ContextSnapshot`/`peakContextTokens`, and the new cumulative column:
  `SESSION_TOOL_RESULT_SIZE`, `SESSION_CONTEXT_HIGHWATER`, `SESSION_CALLS_PER_TURN`,
  `SESSION_PARALLEL_CALLS`, `SESSION_TOOL_TIMEOUT`, `SESSION_CACHE_ELIGIBILITY` (static-eligibility
  is already arithmetic), `SESSION_COST_PER_TASK`, `SESSION_RATE_LIMIT_THROUGHPUT`.
- **Unify `SESSION_COST_PER_TASK`** + the run cost KPI onto the dataset pricing (already derived in
  WP 5.1) — removes the second pricing source.
- `POST /api/runs/:runId/compatibility` → session-level `CompatibilityResult[]`.
- The 2 `single_tool_exec` tests (`session.toolResult.size`, `session.toolCall.latencyVsTimeout`)
  off the tool playground, read-only-gated on tool annotations.

## Acceptance
- A completed run yields session results; a chatty tool trips `SESSION_TOOL_RESULT_SIZE`; an
  over-window run trips `SESSION_CONTEXT_HIGHWATER`; cost matches the unified dataset pricing.
  Gate green; redaction rules preserved (no secrets in any persisted compatibility payload).

## References
- `research/token-context-comparison/05-test-execution-modes.md` (modes), `06` (severity).
- `apps/api/src/testing/{accounting,run-repository}.ts`, `apps/api/src/db/schema.ts`.
