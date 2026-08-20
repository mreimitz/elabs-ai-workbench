---
type: "Work Package Spec"
title: "WP 2.2 \u2014 Whole-tree budget cascade (monotone, cascading trip, honest-partial)"
description: "Phase: 2 \u2014 Recursive execution engine \u00b7 Size: L \u00b7 Depends on: 2.1, 0.3 \u00b7 Model: Opus"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.2 — Whole-tree budget cascade (monotone, cascading trip, honest-partial)

**Phase:** 2 — Recursive execution engine · **Size:** L · **Depends on:** 2.1, 0.3 · **Model:** Opus

## Objective
Make `HUB_MISSION_MAX_BUDGET_USD` a **whole-tree** ceiling and the auto-approve/estimate/agent-count gate a **whole-tree** decision (D-CN3, closing R4/R1/R3). At propose time the gate is computed over the fully resolved crew tree — transitive leaf-agent count, max depth, tree-bounded cost estimate — not just the root's direct members. At run time the existing cost trip becomes a **cascading meter**: every descendant allocation is a strict subdivision `min(requested, parentRemaining)` that **never re-reads env caps below the root**, a parent trip aborts in-flight descendants, and a tripped nested budget produces an honest partial sub-report whose incompleteness flows up into the parent synthesis. The single load-bearing property — `sum(child allocations) ≤ parent allocation` at every level, so aggregate spend can **never** exceed the root `min(requested, HUB_MISSION_MAX_BUDGET_USD)` — is proven by a monotone-non-increasing property test.

## Why / references
- **D-CN3** — whole-tree ceiling; monotone-non-increasing cascade; shared cost accumulator + abort + limiter threaded via `TopologyContext`; new `HUB_MISSION_MAX_TOTAL_AGENTS` backstop.
- **D-CN10** — `HUB_MISSION_MAX_DEPTH` default 2, `HUB_MISSION_MAX_TOTAL_AGENTS` default 24; `MAX_DEPTH=1` reproduces today.
- **D-CN9** — frozen scope vocabulary untouched; propose gate not relaxed.
- Budget clamp (static, root): `planner.ts:459` `clampPlanToBudgets`, ceiling line **`:492`**; caps type `:46–63`; `estimatePlanCostUsd:319`, `estimateAgentCostUsd:305`.
- Auto-approve gate: `orchestrator.ts:412–413` (call site) + `shouldAutoApprove:1246`; propose path `:372–420`; `caps` getter `:287`.
- Budget trip (dynamic): `orchestrator.ts:707–758` (`budgetCap:711`, `tripBudget:715`, `runSlot:725`, `cumulativeCost += result.costUsd:755`, `budgetCap > 0` guard `:756`).
- Trip seam into strategies: `topologies.ts:97–98` (`isBudgetTripped`), `runSlotPool:148` (checks it `:158`), `TopologyContext:90`.
- `HubAgentRunResult.costUsd`: `orchestrator.ts:134` (a crew-ref slot's `costUsd` = the nested mission's **total**, flowed up by 2.1).
- Honest-partial: `synthesis.ts:275` `PARTIAL_PREFIX`; `orchestrator.ts:785` (`partial` marking); `HubAgentReport` `confidence`/`openQuestions` (`types.ts:5486–5487`).
- Map §1–§3 (the two dollar knobs, BUG-4 per-level amplification, R1/R3b/R3c, the monotone property).
- WP 1.1 memoised **cycle-safe recursive crew-resolution helper** (in `missions/topologies.ts` per README §5.3) — reused here to walk the tree at propose.

## Design

**A — Propose-time whole-tree gate (`orchestrator.ts:372–420` + `planner.ts`).**
Today `shouldAutoApprove(autonomy, plan.agents.length, estimatePlanCostUsd(plan), caps)` (`:413`) only sees the root's **direct** members — so a `threshold` crew of two `crewId` members hiding hundreds of transitive agents auto-launches (R4). Add a pure `planner.ts` export `summarizeMissionTree(rootResolution, caps)` that walks the resolved crew graph via the WP 1.1 recursive resolver (carrying a visited-set + depth counter — belt-and-suspenders with author-time) and returns `{ transitiveAgentCount, maxDepth, estimatedCostUsd }`, where `estimatedCostUsd` sums each leaf's `estimateAgentCostUsd` **bounded by the allocation** handed to its subtree (so the estimate is itself monotone). In `proposePlan`, after the root `clampPlanToBudgets`, resolve the tree once and:
- feed `tree.transitiveAgentCount` + `tree.estimatedCostUsd` into `shouldAutoApprove` (not `plan.agents.length` / flat `estimatePlanCostUsd`);
- enforce `HUB_MISSION_MAX_TOTAL_AGENTS` — `tree.transitiveAgentCount > caps.maxTotalAgents` ⇒ loud `httpError(400, …)` (D-CN4: never a silent skip), mirroring the depth reject;
- assert `tree.maxDepth ≤ caps.maxDepth` as a defensive backstop (a mutated graph could slip a too-deep crew past author-time; the primary run-time depth guard is 2.1's).

A flat mission (no `crewId` members) has `transitiveAgentCount === plan.agents.length` and `maxDepth === 0`, so every existing propose test is byte-unchanged. The root `clampPlanToBudgets` (`:492`) is **untouched** — the root is the only place `caps.maxBudgetUsd`/`defaultBudgetUsd` are read.

**B — The monotone allocation primitive (`planner.ts`).**
Add `allocateChildBudget(childRequestedUsd, parentRemainingUsd): number` = `Math.max(0, Math.min(childRequestedUsd, parentRemainingUsd))`. It takes **no `caps` argument** — it is structurally impossible for it to re-read an env ceiling (that re-read is R1/R3b). This is the single hand-down: at each level a `reservable` pool starts at the parent's already-clamped `maxCostUsd` and is **decremented as each child is allocated** (`reservable -= childCap`), so `sum(childCaps) ≤ parentCap` holds **regardless of parallelism** — the reservation happens at spawn, not at settle, which is what defeats the BUG-4 per-level amplification (§2 R1: N parallel children each reading the same live remaining could otherwise each get the full remaining). The requested value for a nested crew is `crew.budgets?.maxCostUsd` (or `caps.defaultBudgetUsd` **only at the root** — a nested crew that names none inherits `parentRemaining` via the `min`, never a fresh env default).

**C — Run-time cascading meter (`orchestrator.ts:707–758`).**
Keep `budgetCap = plan.budgets?.maxCostUsd ?? this.caps.defaultBudgetUsd` (`:711`) — root only. Introduce a per-mission `reservableUsd = budgetCap` ledger owned by `runMission`. When `runSlot` fires for a **crew-ref** slot (2.1's sub-mission unit), synchronously reserve `childCap = allocateChildBudget(childRequested, reservableUsd); reservableUsd -= childCap;` (single-threaded ⇒ atomic before the awaited nested run), then spawn the nested `runTopology` with `childCap` as its **own** `budgetCap` and its own `reservableUsd`. Leaf agents are unchanged: they meter into `cumulativeCost` and the parent trips on crossing. Because a crew-ref slot's `result.costUsd` is the nested mission's **total** (flowed up by 2.1), `cumulativeCost += result.costUsd` (`:755`) already rolls children up — the meter is cascading with no re-plumbing of the accumulator.

Two correctness fixes at this seam:
- **Cascading trip / abort-in-flight (topologies.ts:97).** A parent `tripBudget()` (`:715`) already `abort()`s each `control.agentAborts` entry; for a crew-ref slot that abort is chained (by 2.1) into the nested `missionAbort`, halting its in-flight descendants. Additionally, the nested `TopologyContext.isBudgetTripped` must be **composed** — `() => nestedTripped || parentIsBudgetTripped()` — so a nested strategy's launch loop (`runSlotPool:158` and each strategy's between-launch check) stops the instant an **ancestor** trips, not only its own level. The orchestrator builds this composed predicate when constructing the nested context; `topologies.ts` only widens the `isBudgetTripped` **contract doc** to "true once THIS level's OR ANY ANCESTOR's hard budget has tripped" and confirms every strategy consults it between launches (they already do).
- **The `budgetCap > 0` zero-allocation trap (R3c).** Today `if (budgetCap > 0 && cumulativeCost >= budgetCap) tripBudget()` (`:756`) treats a `0` cap as *unlimited* — fatal for a child allocated `0` because `reservableUsd` hit zero. Fix: a crew-ref slot with `childCap <= 0` is **never spawned** — it settles honestly as a skipped/partial contributor (report `undefined`, `partial` set), exactly as an over-budget skip does today. Because the cascade always hands down an explicit numeric `childCap`, a `0` below the root unambiguously means *exhausted*, not *default*.

**D — Honest-partial propagation up.**
When a nested `runTopology` returns `outcome.partial` (its budget tripped or an ancestor aborted it), the projection 2.1 stamps into the single `HubAgentReport` must reflect incompleteness: lower `confidence` to `"low"` and append an `openQuestions` line naming the truncation ("Sub-crew stopped early — budget exhausted; findings are partial."). Set the crew-ref slot's `HubAgentRunResult` so `collectReports`/`TopologyOutcome.partial` carries up, and the parent `synthesize(... partial ...)` (`:790`) already prepends `PARTIAL_PREFIX`. A tripped nested budget therefore surfaces as a marked-partial parent answer, never a silent truncation.

## Files
- `apps/api/src/hub/missions/planner.ts` *(modify)* — add `allocateChildBudget` (no-caps monotone hand-down) + `summarizeMissionTree` (transitive count / max depth / tree-bounded cost via the WP 1.1 resolver); `estimatePlanCostUsd`/`estimateAgentCostUsd` reused as the per-leaf basis; root `clampPlanToBudgets:492` untouched.
- `apps/api/src/hub/missions/orchestrator.ts` *(modify)* — `proposePlan`: whole-tree gate into `shouldAutoApprove` + `HUB_MISSION_MAX_TOTAL_AGENTS`/depth backstop; `runMission`: `reservableUsd` ledger, crew-ref allocation + nested `runTopology` budget hand-down, composed nested `isBudgetTripped`, parent-trip aborts descendants, `childCap <= 0` skip (R3c), honest-partial marking on the nested→report projection.
- `apps/api/src/hub/missions/topologies.ts` *(modify)* — widen the `TopologyContext.isBudgetTripped` contract doc to include ancestor trips; confirm every strategy honors it between launches (no behavior change to the flat pool).
- `apps/api/test/hub-mission-budget-cascade.test.ts` *(create)* — the CRITICAL monotone property test + propose-gate + run-time cascade suite (below).
- `apps/api/test/hub-topologies.test.ts` *(modify, if needed)* — a nested composed-trip assertion only if the seam-doc change touches an existing expectation.

## Acceptance
- [ ] `allocateChildBudget(req, remaining) === Math.max(0, Math.min(req, remaining))`, and its signature takes **no `caps`** parameter.
- [ ] **CRITICAL — monotone property test:** over randomized branchy/deep trees of requested budgets, (a) at **every** node `sum(child allocations) ≤ node allocation`, and (b) `sum(leaf allocations) ≤ root allocation === min(rootRequested, caps.maxBudgetUsd)`. Never violated across the generated cases.
- [ ] `grep` proves `caps.maxBudgetUsd` / `caps.defaultBudgetUsd` are read **only** at the root (`clampPlanToBudgets` + the `budgetCap:711` line); no nested-allocation path references either.
- [ ] Propose gate is whole-tree: a `threshold` mission whose two direct `crewId` members expand to a transitive agent count > `caps.askAboveAgents` (or tree est cost > `caps.askAboveUsd`) does **not** auto-approve (it waits for explicit approval), whereas the same flat count would have.
- [ ] `HUB_MISSION_MAX_TOTAL_AGENTS` is enforced at propose: a tree exceeding it throws a loud `400`, never silently drops a subtree.
- [ ] Run-time cascading trip: a nested mission that trips its budget yields a sub-report with `confidence === "low"` and an `openQuestions` truncation note, and the parent synthesis carries `PARTIAL_PREFIX`.
- [ ] A parent budget trip aborts in-flight nested descendants — the nested `missionAbort` fires and the nested `isBudgetTripped()` returns `true` after the ancestor trip (asserted via a stubbed runner).
- [ ] R3c guarded: a child allocated `0` is settled as a skipped/partial contributor and **never** run unbounded (the `budgetCap > 0`→unlimited inversion is closed).
- [ ] Flat missions unaffected: `hub-missions.test.ts` + `hub-topologies.test.ts` stay green; `summarizeMissionTree` returns `transitiveAgentCount === plan.agents.length`, `maxDepth === 0` for a crew with no `crewId` members.
- [ ] Untouched: `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope` (D-CN9), the `kind === 'chat'` propose gate (`orchestrator.ts:330`), and the root `clampPlanToBudgets` ceiling line (`:492`).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **Sequential after 2.1, not parallel** — both edit the contested hot files `orchestrator.ts` + `topologies.ts` (README §5.6; conventions "run solo"). This WP assumes 2.1 already landed: the crew-ref `runSlot` unit, the nested `runTopology` spawn, `HubAgentRunResult.costUsd` = nested total, and the transcript→`HubAgentReport` projection. If any of those is absent, STOP and write a STATUS blocker rather than re-implementing 2.1's seam here.
- **No wire/DB change** — `HubMissionCaps.maxTotalAgents`/`maxDepth` arrive from 0.3; `HUB_MISSION_MAX_TOTAL_AGENTS`/`HUB_MISSION_MAX_DEPTH` constants from 0.1/0.3. This WP is pure engine + tests, additive.
- **Fully stub-tested** — no live provider: inject a deterministic runner whose per-slot `costUsd` is scripted so the cascade/trip/partial paths are exercised offline. The monotone property test is over the pure `allocateChildBudget`/`summarizeMissionTree` functions (no I/O). Live nested budget-exhaustion mid-tree and the both-theme cost-meter walk are **owner-acceptance** (README §7) — do not claim them verified.
