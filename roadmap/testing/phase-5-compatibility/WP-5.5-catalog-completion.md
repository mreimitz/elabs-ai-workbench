# WP 5.5 — Catalog completion (severity rules + design-quality tests)

**Status:** ◍ partial — doc-drift fixed 2026-06-21 (README 28→31; doc 06 → 6 flat / 14 ruled / 11
pending + level breakdown). Rule authoring + design tests open.
**Depends:** WP 5.2 (engine consumes whatever the catalog declares).

## Goal
Complete the catalog so every cell is model-specific + cited, and onboard the design-quality tests.

## Deliverables
1. **Author the 11 pending `model_severity` rule sets** (predicate → severity + consequence +
   evidence_fields + rationale_template), per `06-impact-and-model-severity.md` §2–3:
   `SERVER_TOOL_COUNT_CONTEXT`, `SERVER_REQUEST_SIZE`, `SERVER_CLIENT_TOOL_CAP`,
   `SERVER_NAMESPACED_NAME_LENGTH`, `TOOL_SCHEMA_PRESENT`, `TOOL_DEFINITION_TOKENS`,
   `SESSION_TOOL_RESULT_SIZE`, `SESSION_CONTEXT_HIGHWATER`, `SESSION_PARALLEL_CALLS`,
   `SESSION_CACHE_ELIGIBILITY`, `SESSION_RATE_LIMIT_THROUGHPUT`. Edit `tests/test-catalog.json` →
   `pnpm build:model-data` → the bundled copy + drift test pick it up.
2. **Add the 8 design-quality tests** (from `04-mcp-builder-skill-gap-analysis.md` / `05` §4) as
   non-blocker catalog entries with evaluators: `tool.annotations.coherent`, `tool.naming.convention`,
   `tool.description.quality`, `tool.pagination.supported`, `tool.output.dualFormat`,
   `server.transport.stdioHygiene` (static), `tool.output.truncationGuard` (single_tool_exec),
   `session.task.successRate` (live_session). Reference the best-practice docs in each.
3. Bump `catalog_version`.

## Acceptance
- Catalog QA test still green (now N×33, no defaults left for the 11); fixture-parity unchanged for
  the original demo; new evaluators unit-tested; doc counts match the catalog.

## References
- `research/token-context-comparison/{04-mcp-builder-skill-gap-analysis,05-test-execution-modes,06-impact-and-model-severity}.md`
- Reference resolver: `tests/resolve_model_severity.py`; TS port `apps/api/src/compatibility/resolve.ts`.
