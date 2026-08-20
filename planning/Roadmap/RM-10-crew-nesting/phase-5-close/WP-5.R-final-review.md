---
type: "Work Package Spec"
title: "WP 5.R \u2014 Final full-tree adversarial security review"
description: "Phase: 5 \u2014 Hardening & close \u00b7 Size: M \u00b7 Depends on: 2.R, 3.1, 3.2, 4.1, 4.2, 4.3 \u00b7 Model: Opus"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.R — Final full-tree adversarial security review

**Phase:** 5 — Hardening & close · **Size:** M · **Depends on:** 2.R, 3.1, 3.2, 4.1, 4.2, 4.3 · **Model:** Opus

## Objective
Run the complete adversarial probe set **end-to-end across the whole feature** (execution engine + board/replay + UI) as a capstone *refute* pass — after every Phase 2–4 WP has landed — and prove each crew-nesting invariant holds under real topologies at depth ≥ 2, or record a blocker. This is the D-CN10 close-out review, the final gate before 5.1: it re-verifies every invariant `2.R` already refuted still holds after Phases 3–4 (board, report, UI) landed, plus the invariants only reachable once the whole tree is assembled (whole-tree budget aggregation, nested-tree replay, UI cycle-reject UX). It is **read-only on product code**; it may add tests. Any surviving refutation becomes a STATUS blocker + a `5.fix` WP; the deliverable is [`roadmap/crew-nesting/phase-5-close/5.R-review.md`](../phase-5-close/5.R-review.md) plus a residual-risk summary for owner acceptance.

## Why / references
- **D-CN10** — every phase closes with an adversarial review that *refutes* its invariants; findings → STATUS blockers → a `.fix` WP. `5.R` is the whole-feature capstone.
- **D-CN3 (budget monotonicity)** — aggregate spend across the tree ≤ root `min(requested, HUB_MISSION_MAX_BUDGET_USD)`; `planner.ts:492` (the ceiling line) stays the *root* clamp; every descendant is `min(requested, parentRemaining)`, never re-reads env caps; shared cost/abort/concurrency via `TopologyContext`. Run-time trip: `orchestrator.ts:707–758` (`runSlot`/`tripBudget`), the `budgetCap > 0` guard `:756`.
- **D-CN4 (two-layer cycle/depth guard)** — author-time reject in the repository (`repository.ts:405–464`, `createCrew`/`updateCrew`) *and* run-time visited-set + depth counter in the instantiation/spawn engine (`topologies.ts:430` `instantiateCrewPlan`; the WP2.1 `runSlot`/`runOneAgent` recursion at `orchestrator.ts:725`/`:840`).
- **D-CN1/D-CN6 (no propose-gate relaxation)** — `proposePlan`'s `session.kind === 'chat'` gate (`orchestrator.ts:330`) and the withheld `mission.propose_plan` builtin (`tools/builtins/index.ts:32–63`) stay exactly as they are; a sub-mission row is born only inside the deterministic recursion engine. `hub_missions.session_id` = the root chat session; the tree is expressed only by `parent_mission_id` (migration v54, `database.ts` / `schema.ts:1136`).
- **D-CN9 (frozen security boundary + transitive non-escalation)** — `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope` (`assistant-scope.ts`) untouched; the four `hub_*` tools stay in `SCOPE_EXEMPT_ACTION_TOOLS:119` (`:123–126`), write-classified ⇒ approval-gated. `effectiveAgentGrants` (`grants.ts:69–95`) intersects transitively; autonomy is `min` down the path; brief-only context at every level.
- **D-CN7/R-SES1 (event-sourced replay)** — a nested-tree mission reconstructs from `hub_events` alone; API `board.ts` (`reconstructMission:52`) and the web `MissionBoard` reducer both tree-aware (WP3.1/4.3).
- **D-CN8 (UI cycle-reject UX)** — crew editor `MembersSection.tsx` (`addMember:60`) author-time cycle/depth warning; `validateCrewProfileForm:43`; nested-member render; both themes (WP4.1).
- **HITL/autonomy** — `hitl.ts` approval gate `:65–79`, per-turn teardown `:318–342`; `shouldAutoApprove` (`orchestrator.ts:1246`) evaluated over the *transitive* tree (WP2.2), not just direct members.
- Invariant sources: budgets-security map §6 (the nine `x.R` invariants), §1–§3 (budget cascade), §4 (cycle guards), §5 (depth cap); BUG-4/INV4 (`assistant-hub/STATUS.md:386–390`); the four prior reviews (`:56,65,73,80`).

## Design
A **refute** pass, not a summary. For each probe below, construct the adversarial input/fixture that *would* break the invariant if the implementation is wrong, run it, and reach a verdict: **REFUTED** (cite the proof — a passing adversarial test at `file:line`, or the exact code path that makes the attack structurally impossible) or **FINDING** (cite the failing repro). All probing is stub-driven behind the existing injectable seams (the `e2e/fixtures/hub-stub-llm-server.ts` deterministic model + the `agentRunnerMode:'structured'` runner + injectable fetch) — **no provider key, no real tenant, no live child spawn**. Where `2.R` already refuted an invariant on the engine, re-run its repro against the *now-integrated* code (Phases 3–4 changed `board.ts`, the report, and the web reducers) to prove no regression.

**Probe set** — every item gets an explicit verdict in `5.R-review.md`; none may be left "n/a":

| # | Invariant (D-CN) | Adversarial attack / seam | Proof of refutation |
|---|---|---|---|
| P-BUD1 | Whole-tree budget aggregation (D-CN3) | Branchy tree: root `parallel` of 3 crews, each a `pipeline` of 3, depth 2 (≥ 12 leaves). Sum leaf `costUsd` + each sub-synthesis + `best_of_n` `extraCostUsd`. | `sum(all tree spend) ≤ root.maxCostUsd = min(requested, HUB_MISSION_MAX_BUDGET_USD)`; assert **no** descendant allocation re-reads `caps.maxBudgetUsd`/`defaultBudgetUsd`; each hand-down is `min(requested, parentRemaining)`. |
| P-BUD2 | BUG-4 recurrence (INV4) | A nested level with `maxParallel ≥ agentCount` (all leaves launch in one wave). | The **shared** cumulative accumulator (threaded via `TopologyContext`, not a fresh per-mission closure) still trips the tree budget after leaves settle; branch marked honest-partial. |
| P-BUD3 | Cascading trip abort (D-CN3) | Force a parent budget trip while a descendant sub-mission is in flight. | The **shared** abort signal aborts in-flight descendants (not a fresh `AbortController` per level); descendants settle `partial`, not silently truncated (`PARTIAL_PREFIX`). |
| P-BUD4 | Zero-alloc ≠ unlimited (D-CN3) | Hand a child a `0`/`undefined` remaining allocation. | The `budgetCap > 0` guard (`orchestrator.ts:756`) treats it as *deny/zero*, never "unlimited". |
| P-CYC1 | Author-time cycle/exists/depth (D-CN4) | `updateCrew` saving A whose member `crewId` transitively reaches A; a non-existent `crewId`; nesting past `HUB_MISSION_MAX_DEPTH`. | Loud validation error at write, never a silent skip (WP1.1 repo helper). |
| P-CYC2 | Run-time cycle guard (D-CN4) | Mutate the crew graph *between save and run* so an author-valid graph becomes cyclic at execution. | Run-time visited-set + depth counter in the spawn engine rejects re-entry/over-depth — no infinite spawn, no `hub_sessions` bomb. |
| P-CYC3 | Depth cap + total-agent backstop (D-CN10) | Over-depth tree; a wide-but-shallow tree exceeding `HUB_MISSION_MAX_TOTAL_AGENTS`; `HUB_MISSION_MAX_DEPTH=1`. | Both caps bite; **`MAX_DEPTH=1` reproduces today's semantics exactly** (a `crewId` member is rejected at author time as over-depth). |
| P-CYC4 | UI cycle-reject UX (D-CN8) | Author-time cycle/depth in `MembersSection`. | The picker disables/warns; `validateCrewProfileForm` carries the cycle+depth rule; reads correctly in both themes (both-theme visual = owner-acceptance, noted). |
| P-GATE1 | No propose-gate relaxation (D-CN1) | Attempt to reach a sub-mission via an agent session / the `mission.propose_plan` builtin. | `proposePlan`'s `kind==='chat'` gate (`orchestrator.ts:330`) and the withheld builtin (`builtins/index.ts:32–63`) are byte-unchanged; sub-mission rows are created only by the recursion engine. |
| P-HITL1 | Nested `shouldAutoApprove` over the tree (D-CN3) | A `threshold` mission that looks small (3 direct members) but hides hundreds of transitive agents. | The auto-approve gate is computed over the **transitive** tree agent-count + estimated cost (WP2.2), not the direct member count. |
| P-HITL2 | Nested HITL deny-never-runs | Deny an approval at a nested level. | That sub-mission aborts and never silently runs; `releaseTurn`/per-turn teardown (`hitl.ts:318–342`) settles dangling nested awaiters. |
| P-AUT1 | Transitive autonomy non-escalation (D-CN9) | A nested crew whose saved def names `autonomy:'auto'` under a parent `always_ask`. | Autonomy is `min` down the path; the nested `auto` can never raise the parent's `always_ask`. |
| P-GRA1 | Transitive grant intersection (D-CN9/D-HF5) | A nested crew's own Access naming a broader server/tool grant than its parent chain. | `effectiveAgentGrants` composes `L2 ∩ L1 ∩ L0`; a nested crew can only narrow, never re-widen. |
| P-GRA2 | `missionUnreadyServers` recursion | A nested crew referencing an unready MCP server. | The pre-run readiness gate (`orchestrator.ts:563`) recurses into nested crews' grants (WP2.3). |
| P-SCOPE1 | Frozen scope vocabulary (D-CN9) | — | `assistant-scope.test.ts` set-equality green; `SCOPE_EXEMPT_ACTION_TOOLS` name-set unchanged; `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope` untouched; the two `hub_crew_*` tools stay write-classified + approval-gated. |
| P-ISO1 | Brief-only context at every level (D-CN9) | Try to observe the parent transcript leaking into a nested sub-mission. | Context flows down as a curated brief at every level; the nested "ask" is threaded explicitly, never read from an agent session log (exec-engine §3 #12). |
| P-TOPO1 | Per-subtree topology fidelity (D-CN2) | A `pipeline` sub-crew inside a `parallel` parent. | The sub-crew runs under **its own** topology; the parent consumes its synthesised answer as one stamped `HubAgentReport` via the `HubAgentRunResult` channel. |
| P-TOPO2 | best-of-N judge blindness across levels (R-SK7) | A nested `best_of_n` whose result flows up into a parent judge. | The nested judge sees only anonymized `{label, report}`; no child authoring model/role leaks into a parent judge. |
| P-REP1 | Nested-tree replay-from-events (D-CN7) | Reconstruct a completed nested-tree mission from `hub_events` alone. | Both the API `board.ts` tree reducer and the web `MissionBoard` reducer rebuild the tree; per-level cost/timing roll-up is correct (WP3.1/4.3). |
| P-REP2 | Domain isolation + additive lineage (D-CN6) | — | Nested missions write only hub tables (0 foreign-table rows); every tree mission keeps `session_id` = root chat session; the tree is expressed only by `parent_mission_id`; v54 columns are additive nullable. |
| P-REP3 | Legacy flat mission unchanged (WP3.2) | A pre-nesting flat mission. | Reconstructs and renders in the run report (JSON + Markdown) unchanged. |
| P-REG1 | No Phase 3–4 regression | Re-run every `2.R`-refuted repro against the integrated tree. | Each still holds after `board.ts`, the report, and the web reducers changed. |

**Deliverable structure (`5.R-review.md`):** (1) scope + refute method; (2) the probe ledger table above with a per-probe verdict + cited proof/repro; (3) a Findings section (each finding: severity, minimal repro, the seam it breaks, the proposed `5.fix` WP); (4) the `2.R` regression re-check; (5) a **residual-risk summary** seeding STATUS Owner-acceptance (the live-provider / running-app / both-theme checks an agent cannot perform). If the review finds itself needing to relax the propose gate or touch `ASSISTANT_ENTITY_KINDS` to make a probe pass, that is a *finding about the plan* — STOP and write a blocker, do not improvise (house rule).

## Files
- `roadmap/crew-nesting/phase-5-close/5.R-review.md` *(create)* — the review deliverable (probe ledger + findings + regression re-check + residual-risk summary).
- `apps/api/test/crew-nesting-final-review.test.ts` *(create)* — additive adversarial probes over the engine/budget/cycle/grants/HITL/replay (P-BUD*, P-CYC1–3, P-GATE1, P-HITL*, P-AUT1, P-GRA*, P-SCOPE1, P-ISO1, P-TOPO*, P-REP1–3, P-REG1), stub-driven, no provider key.
- `apps/web/src/features/hub/crew-nesting-final-review.test.tsx` *(create)* — UI cycle-reject UX (P-CYC4) + web `MissionBoard` nested-reducer replay (P-REP1 web half).
- `roadmap/crew-nesting/STATUS.md` *(modify, conditional)* — append a blocker line + a `5.fix` WP entry to the ledger + orchestration log **only if a finding survives**; the residual-risk items seed the Owner-acceptance section.
- `roadmap/crew-nesting/phase-5-close/WP-5.fix-*.md` *(create, conditional)* — one `5.fix` WP spec per surviving finding (else none).

**Read-only on all product code** — this WP adds no non-test change under `apps/api/src/**`, `apps/web/src/**` (excluding `*.test.*`), or `packages/shared/src/**`.

## Acceptance
- [ ] `roadmap/crew-nesting/phase-5-close/5.R-review.md` exists; **every** probe P-BUD1…P-REG1 has an explicit **REFUTED** (proof cited: test name @ `file:line` or code path) or **FINDING** (repro cited) verdict — no probe left blank or "n/a".
- [ ] Budget: an adversarial branchy-tree test proves `sum(tree spend) ≤ root min(requested, HUB_MISSION_MAX_BUDGET_USD)`; no descendant re-reads env caps (`min(requested, parentRemaining)` at every hand-down); a parent trip aborts in-flight descendants → honest-partial, not truncation; `budgetCap > 0` guard denies a zero allocation.
- [ ] Cycle/depth: author-time reject (transitive cycle, non-existent `crewId`, over-depth) **and** run-time visited-set reject (graph mutated between save and run) both proven; `HUB_MISSION_MAX_TOTAL_AGENTS` backstop bites; `HUB_MISSION_MAX_DEPTH=1` reproduces today's semantics (a `crewId` member rejected at author time).
- [ ] HITL/autonomy: nested `shouldAutoApprove` evaluated over the transitive tree; a nested deny aborts + never runs (awaiters settled); transitive autonomy is `min` down the path (nested `auto` cannot raise a parent `always_ask`).
- [ ] Grants/scope: transitive intersection composes (`L2 ∩ L1 ∩ L0`, never re-widens); `missionUnreadyServers` recurses; `assistant-scope.test.ts` set-equality green, `SCOPE_EXEMPT_ACTION_TOOLS` name-set unchanged, `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope` verified untouched.
- [ ] Isolation/topology: brief-only context at every level (no parent-transcript leak); each nested crew runs its own topology and projects to one stamped `HubAgentReport`; a nested `best_of_n` judge sees only anonymized `{label, report}`.
- [ ] Replay/persistence: a nested-tree mission reconstructs from `hub_events` alone (API `board.ts` + web `MissionBoard` reducers); domain isolation 0 foreign-table rows; `session_id` = root chat session with the tree expressed only by `parent_mission_id`; a legacy flat mission still reconstructs + reports unchanged.
- [ ] Propose gate (D-CN1): `proposePlan`'s `kind==='chat'` gate and the withheld `mission.propose_plan` builtin verified unchanged — sub-mission rows created only by the recursion engine.
- [ ] `2.R`-refuted invariants re-verified to still hold after Phases 3–4 landed (P-REG1); no regression introduced by 3.1/3.2/4.1/4.2/4.3.
- [ ] Every surviving FINDING → a STATUS blocker line + a `5.fix` WP spec; if zero findings, the review states that explicitly. Residual-risk summary (live/running-app/both-theme) seeded into STATUS Owner-acceptance.
- [ ] `git diff` shows only the review doc + the two test files (+ conditional STATUS/`5.fix`) — **no product-code change**.
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **Solo, tail of the plan.** Read-only on product code; it only adds new test files (no contested hot file — `orchestrator.ts`/`topologies.ts`/`board.ts`/`shared` are all untouched here), so it can run alone after all of Phase 2–4 + `2.R` complete. It gates 5.1.
- **Refute, don't summarise (D-CN10, invariant §6.8):** the pass tries to *break* every invariant; a green existing suite is not a pass — each probe needs its own adversarial fixture. Where `2.R` already covered an engine invariant, this WP's job is the *integration/regression* re-check plus the invariants only reachable once board/report/UI exist (whole-tree replay, per-level roll-up, UI cycle-reject UX).
- **Stub-tested (no provider key, no real tenant):** drive the deterministic stub model + `agentRunnerMode:'structured'` + injectable fetch; never spawn a real child or contact a tenant.
- **Owner-acceptance boundary:** the live nested mission ≥ 2 levels, real mid-tree budget exhaustion, and the both-theme + keyboard walk of the nested org chart / mission board / cycle-reject UX stay in STATUS Owner-acceptance — do not claim them as verified; seed them from the residual-risk summary.
- **Do not improvise past a D-CN decision:** if a probe can only pass by relaxing the propose gate, adding a scope tool/entity kind, or re-reading env budget caps below the root, that is a finding about the design — write a blocker, never "fix" it by weakening the boundary.
