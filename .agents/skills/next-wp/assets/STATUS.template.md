# PLAN_NAME — work-package status ledger

Living state for the PLAN_NAME plan, read and updated by the `next-wp` skill (and the `/next-wp`
command). It picks the next open WPs whose dependencies are done, runs them with parallel worktree
sub-agents, and ticks a box only when that WP's Acceptance is met and the quality gate is green.

**Legend:** `[ ]` open · `[x]` done. A trailing `status:` note marks `in progress` / `in review`.
Done lines record the date + branch: `… — done YYYY-MM-DD · wp/PLAN_NAME/<id>`.

## Phase 0 — PHASE_TITLE
- [ ] WP 0.1 — GOAL — depends: — — status: open
- [ ] WP 0.2 — GOAL — depends: 0.1 — status: open

## Phase 1 — PHASE_TITLE
- [ ] WP 1.1 — GOAL — depends: 0.2 — status: open

<!-- Repeat per phase. One line per work package. Seed every WP open; never pre-tick.
     Replace PLAN_NAME / PHASE_TITLE / GOAL and the ids+deps from the actual WP specs. -->
