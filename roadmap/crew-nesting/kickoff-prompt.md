# Crew-nesting — orchestrator kickoff prompt

Paste this into a **fresh session** at the repo root to drive the plan with parallel worktree
sub-agents. (A ready-to-paste standalone variant is the same content — this file *is* that prompt.)

---

You are the **orchestrator** for the **crew-nesting** plan (runtime-recursive hierarchical crews,
reopening D-AH9 narrowly). Drive it to done with **parallel worktree sub-agents**, validating each
work package against its Acceptance and the repo quality gate before ticking the ledger.

## Read first, in order
1. `roadmap/crew-nesting/README.md` — mission, the **D-CN1–D-CN10** locked decisions, the WP index,
   the dependency graph, the invariants.
2. `roadmap/crew-nesting/conventions.md` — crew-nesting doctrine (extends `roadmap/testing/conventions.md`).
3. `roadmap/crew-nesting/STATUS.md` — the **authoritative** ledger you select from and tick.
4. The `phase-*/WP-*.md` spec for each WP you dispatch (its Objective / Files / Acceptance).
5. Skim `roadmap/crew-nesting/references.md` for the exact file/line anchors.

## Gate before you start
- **Owner sign-off:** STATUS says "awaiting owner sign-off on the D-CN log". If the owner has **not**
  confirmed D-CN1–D-CN10 (and the three flagged defaults in README §3), do **Phase 0 + Phase 1** only
  (contract + author-time integrity — safe, additive, no behaviour change) and **STOP before Phase 2**
  (the execution engine reopens D-AH9). If confirmed, proceed through all phases.

## Operating rules
- **Selection:** an eligible WP is `[ ]` in STATUS with every `depends:` id already `[x]`. Honour the
  README build order (contract slice first). Never start a WP whose deps are open.
- **Batching (≤ 4 parallel):** read each candidate's **Files** section; **no two parallel agents may
  edit the same file.** Any WP touching `packages/shared/src/*`, `apps/api/src/db/*`,
  `apps/api/src/hub/missions/{orchestrator,topologies}.ts`, `App.tsx`, or `index.ts` runs **solo**
  (see STATUS "Parallel-safety"). Best windows: `{0.2, 0.3}` and `{3.2, 4.1, 4.2, 4.3}`.
- **Worktrees:** dispatch each WP into its own git worktree branched from the current integration SHA.
  Bake this into step 0 of every agent so it does not fork from a stale base:
  `git worktree add .worktrees/crew-nesting-<id> -b wp/crew-nesting/<id> <INTEGRATION_SHA>`.
- **Model per WP:** use the spec header's **Model** tag — **Opus** for 0.1, 0.2, 1.1, all of Phase 2,
  3.1, and the reviews (2.R/5.R); **Sonnet** for 0.3, 1.2, 3.2, 4.1, 4.2, 4.3; **Haiku** for 5.1.
- **Sub-agent gate (fast):** each agent runs `pnpm typecheck && pnpm lint` + its **targeted** tests
  (the full `pnpm test` ~5 min exceeds an agent's bash budget — do not run it inside the agent).
- **Integration gate (authoritative):** YOU run the full `pnpm typecheck && pnpm test && pnpm build &&
  pnpm lint` at the repo root after merging each batch, before ticking. Green + every Acceptance box
  literally true → integrate + tick `[x]` with `done YYYY-MM-DD · wp/crew-nesting/<id>` and an
  Orchestration-log line. Otherwise send the **same** agent back with an itemized fix list; ledger
  stays `in review`.
- **Reviews refute:** 2.R and 5.R are adversarial — the reviewer tries to *break* the invariants
  (budget monotonicity, cycle/depth, HITL/autonomy non-escalation, replay). Findings → STATUS blocker
  → a `.fix` WP; do not tick the phase closed until fixes land.
- **Never** fake a result, relax the propose gate (D-CN1), touch `ASSISTANT_ENTITY_KINDS` (D-CN9), or
  reopen a D-CN decision — a WP that thinks a decision is wrong STOPS and writes a STATUS blocker.
- **Honest reporting:** "done"/"green" = you actually ran the full gate. Lead with what you did not
  verify; visual claims cite the running app at `http://localhost:8080` in both themes.

## Start now
Read the three plan files, confirm the owner-sign-off gate, then open the first batch: **WP 0.1 solo**
(the shared contract — highest blast radius). Report the batch you're opening and why before dispatching.
