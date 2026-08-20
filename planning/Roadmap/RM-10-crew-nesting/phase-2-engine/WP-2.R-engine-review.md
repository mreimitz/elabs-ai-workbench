---
type: "Work Package Spec"
title: "WP 2.R \u2014 Adversarial review of the recursive execution heart (refute Phase 2's invariants)"
description: "Phase: 2 \u2014 engine \u00b7 Size: M \u00b7 Depends on: 2.1, 2.2, 2.3 \u00b7 Model: Opus"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.R — Adversarial review of the recursive execution heart (refute Phase 2's invariants)

**Phase:** 2 — engine · **Size:** M · **Depends on:** 2.1, 2.2, 2.3 · **Model:** Opus

## Objective
Actively try to **break** every safety invariant that Phase 2 (WP 2.1 spawn/recursion, 2.2 budget cascade, 2.3 grants/abort) claims to hold, per the refute doctrine (D-CN10, invariant §8, budgets-security.md §6). This is not a summary pass: each of the ten probes below is a concrete attack — a deep/branchy tree, a save-then-mutate cycle, a nested `auto` crew — expressed as a **test** that either fails to break the system (→ **REFUTED**, cite the product line + test that proves it holds) or succeeds (→ **FINDING** → a STATUS blocker + a `2.fix` WP). The WP is **read-only on product code**; it may only add tests and the review doc.

## Why / references
- **D-CN3** (whole-tree budget ceiling, monotone `min(requested, parentRemaining)`, cascading trip) — probes 1 & 4. Anchors: `clampPlanToBudgets` ceiling `planner.ts:492`; `runMission` budget block + `runSlot` + `tripBudget` `orchestrator.ts:707–758` (`:715–718`, `:755–756`); `isBudgetTripped` seam `topologies.ts:97–98`; the shared cost/abort/concurrency threaded through `TopologyContext` by 2.1/2.2.
- **D-CN4** (two-layer cycle + depth guard, run-time is belt-and-suspenders because the graph mutates between save and run) — probes 2 & 3. Anchors: author-time `createCrew`/`updateCrew` (WP 1.1, `repository.ts:405–464`); run-time visited-set + depth counter at the instantiation/spawn seam `instantiateCrewPlan` `topologies.ts:430–467` / `runOneAgent` `orchestrator.ts:840` (WP 2.1); `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS` (WP 0.3).
- **D-CN1/D-CN6** (no propose-gate relaxation) — the invariant behind probes 5 & 6. Anchors: `kind==='chat'` gate `orchestrator.ts:330`; withheld `mission.propose_plan` builtin `tools/builtins/index.ts:32–63`; `shouldAutoApprove` `orchestrator.ts:1246–1255` (call site `:412–413`); HITL approval gate `hitl.ts:65–79`, per-turn teardown `:318–342`, child-turn autonomy `orchestrator.ts:878–891`.
- **D-CN9** (transitive non-escalation; frozen scope vocab untouched) — probes 7 & 8. Anchors: `effectiveAgentGrants`/`intersectServerGrant` `tools/grants.ts:69–95`, applied `orchestrator.ts:663` (D-HF5); autonomy pin `planner.ts:459`/`:498`.
- **D-AH9 brief-only isolation** (context down = curated brief, never the parent transcript, at every level) — probe 9. Anchors: `orchestrator.ts:682–687`; README.md:67.
- **D-CN7** (event-sourced replay: a nested tree reconstructs from `hub_events` alone) — probe 10. Anchors: `reconstructMission` `board.ts:52`; additive parent-linkage on `agent_spawned`/`plan_proposed`.
- Refute posture + probe list: budgets-security.md §2 (R1–R6), §6 (invariant matrix); README §6 invariants 1–8; STATUS.md *Owner acceptance* (`2.R`/`5.R` reviewed line). Precedent review-tests: `apps/api/test/hub-wp1r-review.test.ts`, `hub-wp7r-adversarial.test.ts`, `hub-wp4r-final-review.test.ts`.

## Design
This WP runs the ten probes as adversarial tests against the **deterministic execution seam** already used by the existing suite — reuse the injectable stub agent-runner / model seam that `apps/api/test/hub-missions.test.ts` and `hub-topologies.test.ts` drive (`agentRunnerMode: "structured"` / DI-injected `runAgent`), so **no provider key is needed and no real child process is spawned**. Fixtures are built from saved crews with `crewId` members (the WP 0.1 shape) plus in-memory `HubMissionCaps` overrides; each probe stamps a tiny per-agent `costUsd` so the budget meter is exercised deterministically.

Verdict shape for the doc — for each probe, a heading with **`REFUTED`** or **`FINDING`**, the concrete attack, the test name that runs it, and the product `file:line` (an invariant is only REFUTED if a *test* pins it, not by inspection alone). Findings additionally get a STATUS blocker + a `2.fix` spec.

The ten probes:

1. **Budget monotonicity (D-CN3, R1/R3).** Build a branchy tree (root `parallel` of N crew-ref members, each a crew of M leaves) with a deliberately generous per-leaf `costUsd` and each child crew's saved `maxCostUsd` set *above* its share. Assert **aggregate spend ≤ root `min(requested, HUB_MISSION_MAX_BUDGET_USD)`**. Second variant: a child whose saved plan tries to *re-read* the env ceiling — assert the allocation is `min(requested, parentRemaining)`, never `caps.maxBudgetUsd` again (the R1 mechanism). Prove `sum(child allocations) ≤ parent.maxCostUsd` at every hand-down.
2. **Run-time cycle detection (D-CN4).** Save crew A→B (valid), then **mutate B→A directly in the repo/DB after save, before run** (bypassing the author-time guard), and execute. Assert the run-time visited-set rejects re-entry with a loud terminal error / honest-partial — **no infinite spawn, no `hub_sessions` row explosion** (assert a bounded session-row count).
3. **Depth-cap enforcement at run-time (D-CN4/D-CN10).** With `HUB_MISSION_MAX_DEPTH=2`, save a legal-at-author-time chain, then mutate it to depth 3 before run; assert the run-time depth counter rejects the over-depth expansion. Also assert `HUB_MISSION_MAX_DEPTH=1` reproduces today's semantics (a `crewId` unit is rejected).
4. **Cascading trip (D-CN3).** A tree where a parent budget trips **while a descendant sub-mission is in flight**; assert `tripBudget` propagates through the shared abort so in-flight descendants are aborted (not left running), the branch is marked `partial`, and `settleSkippedChild` settles every skipped descendant honestly. Regression-guard the BUG-4 `maxParallel ≥ agentCount` inertness *per level* (budgets-security.md §1 note).
5. **Nested `shouldAutoApprove` (D-CN1, R4).** A `threshold`/`always_ask` mission whose **direct** members look small (e.g. "3 agents / $0.50") but whose transitive tree is large; assert the auto-approve gate is evaluated over the **transitive** agent count + estimated cost (WP 2.2), so a large hidden tree cannot slip past `threshold` without a human.
6. **Nested HITL deny-never-runs (D-CN6).** A denied approval at a nested level must abort that sub-mission and **never silently run**; assert `releaseTurn` cleanup settles dangling nested awaiters (hitl.ts:318–342) and the parent synthesis honestly reflects the denied branch.
7. **Transitive grant intersection (D-CN9/D-HF5, R6).** A nested crew whose own Access names a *broader* server grant than its parent path; assert `effectiveAgentGrants` composes as level-2 ∩ level-1 ∩ level-0 — the nested crew can **never re-widen** beyond the root session `toolScope`.
8. **Transitive autonomy non-escalation (D-CN9, R5).** A nested crew saved with `autonomy: "auto"` under a parent `always_ask`; assert autonomy is `min` down the path — the nested `auto` cannot raise the parent's `always_ask`.
9. **Brief-only isolation at every level (D-AH9).** Assert a descendant sub-mission receives a **curated brief only**, never the parent transcript / parent session log — at depth 2 as well as depth 1 (probe the composed-brief threading, not `firstUserText` of a parent session).
10. **Event-sourced replay of a nested tree (D-CN7).** Run a ≥2-level tree, then reconstruct it **from `hub_events` alone** via the tree-aware `reconstructMission`; assert the replayed board equals the live board (spawns, reports, budget-trips, per-level cost roll-up) with no reliance on mutable mission rows.

If any probe **breaks**, it becomes a FINDING: append a `blocked` blocker line to `STATUS.md` naming the invariant + the failing test, and author a `phase-2-engine/WP-2.fix-<slug>.md` spec (same house-style header, Depends on 2.R) describing the minimal product fix. The failing probe stays in the test file as a documented reproduction (xtest / `.skip` with a `// FINDING:` comment referencing the blocker) so the gate stays green while the fix is pending. If every probe REFUTES, the doc records all ten as REFUTED and no `2.fix` is created.

## Files
- `roadmap/crew-nesting/phase-2-engine/2.R-review.md` *(create)* — the review deliverable: all 10 probes, each REFUTED (attack + test name + product `file:line`) or FINDING (+ blocker + `2.fix` pointer).
- `apps/api/test/hub-crew-nesting-wp2r-review.test.ts` *(create)* — the ten adversarial probes as deterministic tests over the injectable runner seam (no provider key, no real spawn); REFUTED probes assert the invariant holds, any FINDING kept as a documented reproduction.
- `roadmap/crew-nesting/STATUS.md` *(modify, append-only)* — Orchestration-log entry for the review; one `blocked` line per FINDING (none if all refute).
- `roadmap/crew-nesting/phase-2-engine/WP-2.fix-<slug>.md` *(create — only if a probe yields a FINDING)* — minimal-fix spec, house-style header, Depends on 2.R.

## Acceptance
- [ ] `roadmap/crew-nesting/phase-2-engine/2.R-review.md` exists and enumerates **all ten** probes (1 budget monotonicity, 2 run-time cycle, 3 depth cap, 4 cascading trip, 5 nested auto-approve, 6 nested HITL deny, 7 transitive grants, 8 transitive autonomy, 9 brief isolation, 10 nested replay), each explicitly labelled **REFUTED** or **FINDING**.
- [ ] Each REFUTED probe cites both a **product `file:line`** that enforces the invariant *and* the **named test** in `hub-crew-nesting-wp2r-review.test.ts` that exercises the attack.
- [ ] `apps/api/test/hub-crew-nesting-wp2r-review.test.ts` contains a distinct, concrete breaking attack for each of the ten probes; the budget-monotonicity test asserts aggregate spend ≤ root `min(requested, HUB_MISSION_MAX_BUDGET_USD)` for a branchy N×M tree; the cycle/depth tests **mutate the crew graph after save, before run** and assert a bounded (non-exploding) `hub_sessions` row count with a loud reject.
- [ ] The review is **read-only on product code**: `git diff --name-only` touches no file under `apps/api/src`, `apps/web/src`, or `packages/shared/src` — only `apps/api/test/*`, `roadmap/crew-nesting/*`.
- [ ] Every FINDING has (a) a `blocked` line in `STATUS.md` naming the invariant + failing test, and (b) a `phase-2-engine/WP-2.fix-<slug>.md` spec; if all ten refute, the doc says so and no blocker/`2.fix` is added.
- [ ] `SCOPE_EXEMPT_ACTION_TOOLS` / `ASSISTANT_ENTITY_KINDS` / `deriveAssistantScope` are not referenced-as-modified (D-CN9) — the review adds no scope names or entity kinds.
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **Parallel-safety: read-only, batchable.** 2.R modifies no product file, so it may run in the same batch as WP 3.1 (which owns `board.ts`) per the README build order (batch 7). Its only writes are the new test file, the review doc, and append-only STATUS lines.
- **Deterministic, no provider key.** Every probe drives the injectable structured-runner / stub-model seam already used by `hub-missions.test.ts` / `hub-topologies.test.ts` — no real child process, no network, no `provider_credentials`. A live ≥2-level nested mission, budget-exhaustion-mid-tree, and the cycle-reject UX remain **owner-acceptance** (STATUS *Owner acceptance*), not something this WP can fully verify.
- **Refute, don't summarise (D-CN10, invariant §8).** A probe that merely reads the code and asserts "looks correct" is not REFUTED — an invariant earns REFUTED only when a test actually mounts the attack and the system holds. Bias toward finding the break: probes 1, 4, and 5 (per-node-vs-per-tree budget, cascade-trip abort, hidden transitive tree past `threshold`) are the highest-risk per budgets-security.md §2 and must have the most adversarial fixtures.
- If a probe reveals a D-CN decision itself is wrong (not just an implementation bug), **STOP and write a STATUS blocker** rather than improvising a fix (README §2 house rule); the `2.fix` WP scopes only implementation corrections, never a decision reopening.
