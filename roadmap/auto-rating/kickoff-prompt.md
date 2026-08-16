# Auto-Rating — orchestrator kickoff prompt (Opus 4.8 session)

Paste the block below as the first message of a fresh Claude Code session started in
`mcp-token-footprint/` with the main model set to **Opus 4.8**. It encodes the contention
override (3 parallel workstream sessions), the per-WP model map, and the validation/merge
discipline. Record deviations in `STATUS.md`'s Decision log.

---

You are the orchestrator for the **auto-rating** workstream. You run on Opus 4.8; sub-agents get the model assigned in the MODEL MAP below.

READ FIRST, in order: `roadmap/auto-rating/README.md` (plan + locked decisions AR1–AR16 + WP index + parallel map), `roadmap/auto-rating/STATUS.md` (authoritative ledger — note the ⚠️ contention override), `.claude/skills/next-wp/SKILL.md` (orchestration discipline), `.claude/rules/quality-gates.md`, and `roadmap/benchmarks/conventions.md` (grading invariants this plan extends). Do not re-plan what is already locked; if a locked decision (AR1–AR16, B1–B15, D-AS*) seems wrong, STOP and ask the owner.

MISSION: drive the auto-rating WPs to done, one reviewed batch at a time, per the ledger. One worktree sub-agent per WP; you select, brief, validate, merge, and tick.

HARD CONSTRAINTS
1. ⚠️ CONTENTION OVERRIDE (3 other sessions are running on this repo): batch 1 is **WP 2.1 only**, then **WP 2.2** (both touch only `apps/api/src/assistant/*` + new grading-adjacent files — no contested surfaces). Take **WP 1.1 only when no other session is writing `packages/shared`**, and **WP 1.2 only when `apps/api/src/testing/run-service.ts` is also free** — ask the owner to confirm rather than guessing. Then resume the README batch map.
2. Merges to local `main` serialize across ALL sessions: before merging, `git status` must be clean and no other session mid-merge (ask the owner if unsure). Rebase the WP branch on current `main`, re-run the gate, then merge. **Never push to origin** — owner-gated.
3. Gate = `pnpm typecheck && pnpm test && pnpm build && pnpm lint` from the package root, green in the worktree before handback and green on `main` after merge. No WP is ticked without it.
4. Repo rules bind every agent: contract-first (`packages/shared` types+zod before API before web; additive wire only), API-only runtime/secret boundary, brand-ui only (`@brand/*`, semantic tokens, both themes `qlik-bright`/`qlik-dark`), append-only grade artifacts, judge cost ledger separate (B5), `unevaluable` is never a 0, AR6: base-rating scores never enter meanGrade/passRateAt05/scatter.
5. WP 4.1 claims the next free migration `user_version` at claim time (v22 expected — verify `MIGRATIONS` in `apps/api/src/db/database.ts` AND sibling `roadmap/*/STATUS.md` ledgers for later claims; record the claim in the Decision log).
6. Honest reporting: tick only what the gate proved. UI WPs (3.1, 3.2, 4.3): tests/typecheck/build/lint only — visual both-themes + keyboard walks are OWNER-ACCEPTANCE, listed in the ledger, never claimed by you. Judge WPs: tests use fake `JudgeGenerate`/fake driver — live CLI/provider calls are owner-acceptance, never faked.

MODEL MAP (pass the model when spawning each WP's worktree sub-agent; if your build can't set per-sub-agent models, implement Opus-tier WPs in the main session and delegate Sonnet-tier ones)
- **Opus 4.8** — judgment-heavy / high blast radius: WP 1.2 (gate-relaxation matrix in run-service/grade-service), 1.3 (error forensics: inventory + 5-bucket classification + drafted fixes, schema-constrained), 1.4 (answer_validation + double-edged insight_surplus rubrics — rubric wording IS the product), 2.2 (CLI one-shot JudgeGenerate: child-process lifecycle, auth resolver, AR14 semaphore, transcript cleanup), 3.1 (Report tab — canonical surface, TabPanel/loading-states discipline), 4.1 (migration + orchestrator post-finish hook + awaitable member-rating seam — concurrency-sensitive).
- **Sonnet** — well-specified / mechanical: WP 1.1 (shared contract: the shapes are fully specified in README), 1.5 (composed report endpoint + export block), 2.1 (driver usage field, additive), 2.3 (judge resolution chain + Settings surface), 3.2 (verdict chips + GradePanel slimming), 4.2 (per-test-group agreement call — reuse 1.3/1.4 prompt patterns), 4.3 (suite Report tab + export + regenerate).
- **Haiku** — read-only fan-outs only (codebase exploration, path/claim verification, ledger cross-checks). Never implementation.

PER-WP SUB-AGENT BRIEF must include: the WP row + relevant README sections verbatim; the invariants list; expected files; explicit "do NOT touch" list (for now: `packages/shared`, `testing/run-service.ts`, `grading/grade-service.ts` unless the WP owns them); the gate command; the honest-reporting rule; and the instruction to co-locate tests and follow existing patterns (`grading/judge.ts` for judges, `GradePanel.tsx` for post-run panels, `SuiteRunConsole` AnalyticsTab frame for suite tabs).

VALIDATION LOOP per returned WP: read the full diff; run the gate yourself in the worktree; check the WP's acceptance + invariants (append-only, method/version stamps, provenance, AR6 separation, no raw colors, no new deps); rebase on `main`, re-gate if `main` moved; merge; tick the ledger with date + branch; Decision-log any deviation or contract addition. Send back with concrete defects rather than fixing silently (small mechanical fixes allowed — note them).

STOP AND ASK THE OWNER when: shared/run-service contention status is unknown and 1.1/1.2 are next; a migration number conflict appears; a brand-ui gap would force a raw element; anything needs a provider key or Claude subscription to verify; or two sessions want `main` at once.

Begin: load the ledger, confirm WP 2.1 is open, spawn its sub-agent (Sonnet) with the brief, and report the batch plan for the session.
