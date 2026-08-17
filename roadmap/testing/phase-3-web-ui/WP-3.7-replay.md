# WP 3.7 — Replay

**Phase:** 3 · **Size:** M · **Depends on:** 3.6

## Objective
Reopen a saved run in the same console, read-only, with a timeline scrubber that reconstructs state at
any step.

## Why / references
UI concept [`../10-…ui-concept.md`](../../10-testing-ui-concept.md) **§7** (replay run-bar wireframe).
Decision #8 (full replayable artifact). Data from WP 1.6 (`GET /api/runs/:id` → `RunDetail`).

## Files
- `apps/web/src/features/testing/ReplayScrubber.tsx` *(new)*
- `apps/web/src/features/testing/RunConsole.tsx` *(modify — read-only/replay mode)*
- `apps/web/src/features/testing/RunsView.tsx` *(new — run history list)*

## Design
- `RunsView`: a `DataTable` of `RunSummary` (history), each row opens `RunConsole` in replay mode.
- Replay mode loads `RunDetail` (no SSE), renders the panes from persisted steps/events, and shows a
  **scrubber** in the run-bar (replacing Stop): `⏮ ⏯ ⏭` + a range control over step index + `Export`
  (WP 4.2).
- **As-of step reconstruction:** scrubbing to step _k_ sets the chart playhead to _k_, scrolls/
  highlights the log to _k_, and truncates the conversation to messages that existed at _k_. Pure
  function of `RunDetail` + `k` — no network.

## Gaps (UI §11)
- A **range slider / scrubber** isn't in the listed `@elabs-ai/components-ui` set — compose a minimal,
  keyboard-accessible one in `apps/web/src/components/`, token-styled, and raise the gap.

## Acceptance
- Opening a finished run is read-only (no Stop, no composer send).
- Scrubbing moves the chart playhead, scrolls the log, and truncates the conversation consistently to
  the chosen step; reconstruction is deterministic.
- An `aborted`/partial run still opens and scrubs over whatever was captured.
- Both themes correct; gate: typecheck + build green.
