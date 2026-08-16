# WP 1.6 — Run persistence (full replay)

**Phase:** 1 · **Size:** M · **Depends on:** 1.4

## Objective
Persist the **entire** run incrementally so it is fully replayable (decision #8) and a crash still
yields a partial, openable record.

## Why / references
Decision #8 (full replayable artifact). Retention/redaction per `conventions.md` security + scope §7
and `.claude/rules/mcp-and-security.md`. Tables defined in WP 0.4 (`runs`, `run_steps`, `run_events`).

## Files (new)
- `apps/api/src/testing/run-repository.ts`

## Design
- Subscribe to the run's event stream (WP 1.3 `run-manager`). Write **as the loop emits**:
  - `runs` row created at start (`status:"running"`).
  - each `step` → `run_steps` (with `profile_tokens_json`, `usage_actual_json`,
    `context_snapshot_json`, redacted `payload_json`).
  - each `RunEvent` → `run_events` (ordered `idx`) for exact replay.
  - on terminal event → finalize `runs` totals (`turns`, `tool_calls`, `peak_context_tokens`,
    `tokens_in/out`, `cached_tokens`, `cost_usd`, `duration_ms`, `status`, `outcome`, `stop_reason`).
- **Redaction (mandatory):** before writing `payload_json`, strip known-secret tool-argument fields
  (reuse the playground's redaction approach) and **never** write provider keys or MCP secrets.
- Read side: `getRun(id)` → `RunDetail` (joins steps + events ordered by `idx`); `listRuns(filter)` →
  `RunSummary[]` (for the Runs history + Compare, WP 3.8).

## Implementation steps
1. Implement the repository (SQL owns inserts/selects; service orchestrates) per `conventions.md`
   layering, mirroring `ScanRepository`.
2. Hook it to `run-manager` so writes happen incrementally, not just at the end.
3. On API restart, mark any `status:"running"` rows as `aborted` (their in-memory session is gone).

## Acceptance
- A completed run reloads from DB with steps, events (ordered), totals, and the context series intact;
  re-running `getRun` reconstructs enough to drive replay (WP 3.7).
- A redaction test: a tool argument flagged secret is absent from stored `payload_json`; no provider
  key appears anywhere in `runs`/`run_steps`/`run_events`.
- Killing the process mid-run leaves a partial record that opens read-only and is marked `aborted`.
- Gate green.

## Notes
- Keep payloads bounded (truncate very large tool results with a "+N bytes" marker) so the DB doesn't
  bloat; the full raw is available via the live stream and, if needed, a capped stored copy.
