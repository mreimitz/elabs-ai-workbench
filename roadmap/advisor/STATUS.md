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
- [x] WP 1.1 — contract + rule engine core (`ADVISOR_VERSION`, evidence refs) — done 2026-08-18 · wp/advisor/1.1 (c13f964 + 4417ad5, merged 38246a1) · spec [`phase-1-deterministic/WP-1.1-contract-engine-core.md`](./phase-1-deterministic/WP-1.1-contract-engine-core.md). `ADVISOR_VERSION = 1` + the `Advisor*` wire contract (TS types **and** zod) in `packages/shared`; `apps/api/src/advisor/{types,registry,evidence,engine}.ts`. Engine: first-wins dedup on the stable recommendation id, a **strict total order** sort (severity → savings *unit-major then value desc* → id — units are never converted, which is what keeps the comparator transitive), `generatedAt` from an injected clock (so "byte-identical over the same inputs" includes the timestamp), and contract enforcement that **throws** (`AdvisorRuleContractError`) on no-evidence / unlabeled or basis-less savings / mismatched `ruleId` rather than dropping the finding silently. `AdvisorContext` exposes four narrow read ports (servers via `getPublic` = redacted only), no `db` handle. **Zero product rules registered** — deliberate, they are WP 1.2. No migration, no new dependency. 26 new api tests (`advisor-engine.test.ts`) cover every Acceptance item. Gate re-run by the orchestrator in the worktree: **typecheck · test · lint · build all green (exit 0)**; web 3103 passed / 302 files, Biome clean over 1419 files. **Not verified:** nothing was exercised against a running app or a real DB — the engine is pure and its context stubbed; the four repository ports are proven to match only at compile time, so whether WP 1.2's rules get the data they need through them is unproven until real rules exist. No UI/route (WP 1.3). Noted: `apps/api/test/hub-agent-handoff.test.ts` failed once under a standalone api-only run and passes 6/6 in isolation and inside the full `pnpm test` — a **pre-existing flake unrelated to this WP** (the diff touches no hub file).
- [ ] WP 1.2 — rules: unused-tool trim, description bloat, loading-mode comparison, overlap — depends: 1.1 — status: **in progress** (agent B · wp/advisor/1.2) · spec [`phase-1-deterministic/WP-1.2-rules.md`](./phase-1-deterministic/WP-1.2-rules.md)
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
