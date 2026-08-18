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
- [ ] WP 1.1 — contract + rule engine core (`ADVISOR_VERSION`, evidence refs) — depends: — — status: **in progress** (agent A · wp/advisor/1.1) · spec [`phase-1-deterministic/WP-1.1-contract-engine-core.md`](./phase-1-deterministic/WP-1.1-contract-engine-core.md)
- [ ] WP 1.2 — rules: unused-tool trim, description bloat, loading-mode comparison, overlap — depends: 1.1 — status: open (blocked on 1.1)
- [ ] WP 1.3 — UI: Advisor view + server/scenario panels (both themes) — depends: 1.2 — status: open (blocked on 1.2)

## Phase 2 — Grade-aware
- [ ] WP 2.1 — quality-validated trims, skill-effect summaries, model-per-quality-bar — depends: 1.2 + benchmarks 3.4/5.1 — status: **blocked** (owner-gated: benchmarks 3.4/5.1)
- [ ] WP 2.2 — fleet report export (JSON/MD) — depends: 1.2 — status: open (blocked on 1.2)

## Decision log
_Entries: date · decision · rationale._

- **2026-08-18 · plan scaffolded to the `/next-wp` layout.** The plan was README+STATUS only, so
  `conventions.md` and one spec per WP (`phase-1-deterministic/`, `phase-2-grade-aware/`) were
  authored from the README's WP index — no scope change, just Files/Acceptance made explicit so the
  runner can pick parallel-safe batches and validate against a checklist.
- **2026-08-18 · WP 1.1 ships no product rules.** The four deterministic rules and the
  `GET /api/advisor/report` route stay in WP 1.2; 1.1 is contract + engine seam + determinism/dedup/
  insufficient-data behavior only. Rationale: the invariants (versioned, deterministic, honest gaps,
  labeled estimates) are testable without any rule, and 1.2 then lands four rules against a locked seam.
- **2026-08-18 · testing WP 5.7 stays open until advisor Phase 1 lands** (per README:
  supersedes-and-extends). Tick it in `../testing/STATUS.md` with a pointer here once 1.3 is green.

## Owner acceptance (owner-only)
- [ ] A real scenario shows an unused-tool trim with believable token savings, its evidence
      links resolve, and applying the suggestion manually then re-running confirms the estimate's
      direction; both themes — accepted: ____
