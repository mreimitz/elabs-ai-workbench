# Advisor — work-package status ledger · **PRIORITY: MEDIUM**

Living state for the **advisor** plan, read and updated by `/next-wp advisor`. A box is ticked
**only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/advisor/<id>`.

> Plan + invariants in [`README.md`](./README.md). Absorbs testing WP 5.7
> (trends/recommendations) — when Phase 1 lands, tick 5.7 in `../testing/STATUS.md` with a
> pointer here. Phase 2 is **blocked on** Benchmarks 3.4/5.1 (`../benchmarks/STATUS.md`).
> Read-model only — no schema migration expected (claim via the decision-log convention if
> that changes).

## Phase 1 — Deterministic rules
- [ ] WP 1.1 — contract + rule engine core (`ADVISOR_VERSION`, evidence refs)
- [ ] WP 1.2 — rules: unused-tool trim, description bloat, loading-mode comparison, overlap
- [ ] WP 1.3 — UI: Advisor view + server/scenario panels (both themes)

## Phase 2 — Grade-aware
- [ ] WP 2.1 — quality-validated trims, skill-effect summaries, model-per-quality-bar
- [ ] WP 2.2 — fleet report export (JSON/MD)

## Decision log
_Entries: date · decision · rationale._

## Owner acceptance (owner-only)
- [ ] A real scenario shows an unused-tool trim with believable token savings, its evidence
      links resolve, and applying the suggestion manually then re-running confirms the estimate's
      direction; both themes — accepted: ____
