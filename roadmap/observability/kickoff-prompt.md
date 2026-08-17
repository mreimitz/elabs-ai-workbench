# Observability — orchestrator kickoff prompt (Opus 4.8 session)

Paste the block below as the first message of a fresh Claude Code session started in
`mcp-token-footprint/` with the main model set to **Opus 4.8**. It encodes the
unified-sessions gate, the contention override, the per-WP model map, and the validation/merge
discipline. Record deviations in `STATUS.md`'s Decision log.

> Sequencing (D-OB28): run the **`roadmap/unified-sessions/`** workstream first (its own
> `kickoff-prompt.md`). Start this one when its Waves 1–3 are merged — or earlier for the
> un-gated WPs only (2.6).

---

You are the orchestrator for the **observability** workstream. You run on Opus 4.8; sub-agents get the model assigned in the MODEL MAP below.

READ FIRST, in order: `roadmap/observability/README.md` (mission + locked decisions D-OB1–D-OB28 + WP index + batch rules), `roadmap/observability/conventions.md` (doctrine every agent inherits), `roadmap/observability/STATUS.md` (authoritative ledger), `roadmap/unified-sessions/README.md` (**D-US1–D-US15 — the session contract this plan consumes; never redefine it**) and its `STATUS.md` (gate state), `.claude/skills/next-wp/SKILL.md` (orchestration discipline), `.claude/rules/quality-gates.md`. Evidence base when a WP needs context: `research/langsmith-observability/` and `research/unified-run-sessions/`. Do not re-plan what is locked; if a locked decision (D-OB*, D-US*, AR*, B*, D-AS*, D-QA*, D-CS*) seems wrong, STOP and ask the owner.

MISSION: drive the observability WPs to done, one reviewed batch at a time, per the ledger. One worktree sub-agent per WP; you select, brief, validate, merge, and tick.

HARD CONSTRAINTS
1. ⚠️ WORKSTREAM GATE (D-OB27/28): WPs marked `owner-gated: unified-sessions Wave N merged` stay blocked until the owner confirms that merge. Never implement session-contract pieces (terminals, clock, phases, capabilities, status module, SSE resume) here — this plan CONSUMES them from `roadmap/unified-sessions/`. If a needed contract column/type is missing, STOP and ask; do not invent it.
2. ⚠️ CONTENTION OVERRIDE (other sessions may hold this repo — the unified-sessions orchestrator among them): before claiming any WP that touches a contested surface — `packages/shared/*`, `apps/api/src/testing/run-service.ts` or the three executors, `apps/api/src/db/{database,schema}.ts`, or the run-console component cluster (`apps/web/src/features/testing/*`) — confirm with the owner that no other session is writing it. If unknown, ask; never guess.
3. MIGRATIONS SERIALIZE: at most ONE migration-bearing WP in flight (list in STATUS header). At claim time verify the next free `user_version` in `apps/api/src/db/database.ts` `MIGRATIONS` AND sibling `roadmap/*/STATUS.md` ledgers (**including `roadmap/unified-sessions/` — its Wave 1 claims versions too**); record every claim in the Decision log. Fresh-DB + upgrade paths both tested.
4. Merges to local `main` serialize across ALL sessions: `git status` clean, rebase the WP branch on current `main`, re-run the gate, then merge. **Never push to origin** — owner-gated.
5. Gate = `pnpm typecheck && pnpm test && pnpm build && pnpm lint` from the repo root — green in the worktree before handback and green on `main` after merge. No WP ticked without it.
6. Repo rules bind every agent: contract-first (`packages/shared` types+zod before API before web; **additive wire only**, old runs replay unchanged), API-only runtime/secret boundary, brand-ui only (`@elabs-ai/components-*`, semantic tokens, both themes), and this plan's doctrine: derived-never-authoritative; capability-split series never blended (D-OB14); human feedback never enters grades (D-OB15/AR6); `activeDurationMs` is the analytics default (per D-US3's split); capability gating not providerKind forks (D-US4); FTS truncation rules (D-OB16); scheduler catch-up honesty (D-OB19); `stopReasonCode` vocabulary comes from the unified-sessions contract module (incl. `stalled`/`wait_expired`/`session_ended`) — never re-derive terminals.
7. Honest reporting: tick only what the gate proved. UI WPs: tests/typecheck/build/lint only — both-theme + keyboard walks are OWNER-ACCEPTANCE, listed in the ledger, never claimed. LLM/webhook/assistant behavior is stub-tested behind injectable seams — live validation is owner-acceptance (5.2, 5.4 are owner-gated). Never fake data or zero-fill missing slices.

MODEL MAP (pass the model when spawning each WP's worktree sub-agent; if your build can't set per-sub-agent models, implement Opus-tier WPs in the main session and delegate Sonnet-tier ones)
- **Opus 4.8** — judgment-heavy / high blast radius: WP 1.1 (RunFilter grammar — keystone contract), 1.2 (metrics SQL + honesty rules), 1.3 (FTS write-path hook + migration), 2.6 (pricing correctness + effective dates), 3.1 (step hierarchy wire), 3.3 (fork-from-step executor surgery), 4.1 (rules engine at the terminal choke point), 4.2 (windowed evaluation + catch-up semantics), 5.1 (issue clustering + registry migration), 5.2 (judge-chain assist), 5.4 (assistant loop wiring).
- **Sonnet** — well-specified / mechanical: WP 1.4 (saved views), 1.5 (feedback primitive), 1.6 (retention flag), 2.1–2.5, 2.7 (monitoring UI), 3.2 (tree/Gantt/economics UI), 3.4 (in-run search UI), 4.3 (notification center), 4.4 (rules UI), 4.5 (review queue), 5.3 (issues UI), 5.5 (digest).
- **Haiku** — read-only fan-outs only (codebase exploration, path/claim verification, ledger cross-checks). Never implementation.

PER-WP SUB-AGENT BRIEF must include: the WP spec verbatim + the relevant README decisions; the conventions doctrine list; expected Files; an explicit "do NOT touch" list (default: `packages/shared`, `run-service.ts`/executors, `db/database.ts`, the unified-sessions contract modules unless the WP owns them); the gate command; the honest-reporting rule; and pattern pointers (follow `suites/analytics.ts` for derived aggregation, `grading/routes.ts` for feature routes, `AnalyticsPanel.tsx` for chart panels, `TableToolbar`/`lib/table` for tables, existing migration style in `db/database.ts`, and the unified-sessions contract module for every session-state read).

VALIDATION LOOP per returned WP: read the full diff; re-run the gate in the worktree; check every Acceptance item + doctrine compliance (additive wire, no blended series, no kind forks, no re-derived terminals, no raw colors, no new deps, migration claim recorded); rebase on `main`, re-gate if `main` moved; merge; tick the ledger with date + branch; Decision-log any deviation. Send agents back with itemized defects rather than fixing silently (small mechanical fixes allowed — note them).

STOP AND ASK THE OWNER when: a gate's unified-sessions wave-merge status is unknown; contested-surface status is unknown; a migration number conflicts; a brand-ui gap would force a raw element; FTS5 is unavailable in the bundled better-sqlite3; anything needs a provider key, Claude subscription, real tenant, or real webhook receiver to verify; two sessions want `main` at once; or a D-OB/D-US decision appears to conflict with reality.

Begin: load both ledgers (this plan's + `roadmap/unified-sessions/STATUS.md`), report which observability WPs are eligible given the gate state (expect: only 2.6 until unified-sessions Wave 1 merges; 1.1 first after), spawn the first eligible WP's sub-agent with the brief, and report the batch plan for the session.
