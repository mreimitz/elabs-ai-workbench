# crew-nesting — work-package status ledger

Living state for the crew-nesting plan, read and updated by the `next-wp` skill (and the `/next-wp`
command). It picks the next open WPs whose dependencies are done, runs them with parallel worktree
sub-agents, and ticks a box only when that WP's Acceptance is met and the quality gate is green.

**Plan:** [`README.md`](./README.md) (mission + D-CN log + WP index + dependency graph) ·
[`conventions.md`](./conventions.md) (doctrine) · per-WP specs under `phase-*/`.

**Legend:** `[ ]` open · `[x]` done. A trailing `status:` note marks `in progress` / `in review` /
`blocked` / `owner-gated`. Done lines record the date + branch: `… — done YYYY-MM-DD ·
wp/crew-nesting/<id>`. Model tier and dependencies are on each WP's spec header; the README index
mirrors them.

**Status:** ✅ **ALL 5 PHASES COMPLETE + gate-green (2026-07-27).** All **16 WPs** (0.1, 0.2, 0.3,
1.1, 1.2, 2.1, 2.2, 2.3, 2.R, 3.1, 3.2, 4.1, 4.2, 4.3, 5.R, 5.1) are done and integrated on
**`feat/crew-nesting`** (tip below). Both adversarial refute-reviews (**2.R: 10/10 probes REFUTED**;
**5.R: 21/21 probes REFUTED**) found **zero** findings — no `2.fix`/`5.fix`. Authoritative full gate
green on the merged result: typecheck ✅ · **api 3235 pass / 0 cancelled** · **web 307 files / 3101
pass** · build ✅ · lint ✅ (1460 files) — the ONE red test is a **pre-existing `hub-workspace.test.ts`
same-millisecond snapshot-ordering flake** (file + source byte-identical to `main`, passes ~2/3 of
isolated re-runs, entirely unrelated to crew-nesting — an owner follow-up outside this plan's scope,
NOT a crew-nesting failure). The frozen scope boundary (D-CN9 — `ASSISTANT_ENTITY_KINDS` /
`SCOPE_WRITE_TOOLS` / `deriveAssistantScope`) and the `kind:'chat'` propose gate are **untouched**
throughout; migration **v54** is the only DB change (additive nullable columns).

**Owner CONFIRMED the D-CN log (D-CN1–D-CN10) + all three flagged defaults (`HUB_MISSION_MAX_DEPTH=2`,
`HUB_MISSION_MAX_TOTAL_AGENTS=24`, `session_id` = the root chat session) on 2026-07-26** — narrowly
reopening D-AH9 per D-CN1. `feat/crew-nesting` is **NOT merged to `main`** (forked from `main` @
`6454137e`; **owner merges after acceptance** — see the Owner-acceptance section for the live-app /
both-theme / keyboard walks an agent cannot self-certify).

---

## Phase 0 — Contract & foundation
- [x] WP 0.1 — shared contract: `crewId` member (`agentId`→optional + `superRefine` + `.strict()`), `crewId?` on `HubPlannedAgent`, nesting fields on `HubAgentReport`/`HubMission`, crew-summary counts, `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS`; guard every `member.agentId` deref — depends: — — status: done 2026-07-26 · wp/crew-nesting/0.1
- [x] WP 0.2 — migration **v54** (`hub_missions.parent_mission_id`/`depth`/`root_mission_id`) + repository create/get/list + row mappers + `listChildMissions`/`getMissionTree`; both migration paths + version-literal locks — depends: 0.1 — status: done 2026-07-26 · wp/crew-nesting/0.2
- [x] WP 0.3 — env caps (`HUB_MISSION_MAX_DEPTH`, `HUB_MISSION_MAX_TOTAL_AGENTS`) + `HubMissionCaps` fields + `index.ts` wiring — depends: 0.1 — status: done 2026-07-26 · wp/crew-nesting/0.3

## Phase 1 — Author-time integrity
- [x] WP 1.1 — repository author-time cycle/exists/depth validation + memoised cycle-safe recursive crew-resolution helper + `summarizeCrew` nested counts — depends: 0.1, 0.2, 0.3 — status: done 2026-07-26 · wp/crew-nesting/1.1
- [x] WP 1.2 — dock write tools + HTTP CRUD accept `crewId` members + echo `memberCrewIds` + `hub_crews_list` nested counts; assert scope-exempt set-equality unchanged — depends: 1.1 — status: done 2026-07-26 · wp/crew-nesting/1.2

## Phase 2 — Recursive execution engine
- [x] WP 2.1 — sub-mission spawn + recursion at `runSlot`/`runOneAgent` → nested `runTopology` → project to one `HubAgentReport`; threaded shared abort/cost/concurrency; run-time visited-set + depth guard; sub-mission rows — depends: 1.1, 0.2 — status: done 2026-07-26 · wp/crew-nesting/2.1
- [x] WP 2.2 — whole-tree budget cascade + transitive auto-approve/estimate/total-agent/depth at propose; monotone `min(requested, parentRemaining)`; cascading trip; honest-partial up — depends: 2.1, 0.3 — status: done 2026-07-26 · wp/crew-nesting/2.2
- [x] WP 2.3 — transitive grant intersection + `missionUnreadyServers` recursion + nested settle/abort/steer reachable from top-level stop — depends: 2.1 — status: done 2026-07-26 · wp/crew-nesting/2.3
- [x] WP 2.R — adversarial review of the execution heart (refute budget monotonicity, cycle/depth, HITL deny, autonomy non-escalation, isolation, cascading abort) — depends: 2.1, 2.2, 2.3 — status: done 2026-07-27 · wp/crew-nesting/2.R · **ALL 10 REFUTED, no 2.fix**

## Phase 3 — Board, replay & reporting
- [x] WP 3.1 — event-sourced hierarchy: additive parent-linkage on board events + API `board.ts` tree reducer + per-level cost/timing roll-up + nested-tree replay-from-events test — depends: 2.1 — status: done 2026-07-26 · wp/crew-nesting/3.1
- [x] WP 3.2 — run report (JSON + Markdown) hierarchical trace + per-level attribution; legacy flat mission still renders — depends: 3.1 — status: done 2026-07-27 · wp/crew-nesting/3.2

## Phase 4 — UI
- [x] WP 4.1 — crew editor sub-crew add path + author-time cycle/depth warning + nested-member render — depends: 1.2 — status: done 2026-07-27 · wp/crew-nesting/4.1
- [x] WP 4.2 — org rail/chart N-level (`Tree` + nested `FlowGroupNode`) + recursive cycle-safe counts + card/directory kind disambiguation — depends: 1.1 — status: done 2026-07-27 · wp/crew-nesting/4.2
- [x] WP 4.3 — mission board/topology hierarchical trace: web reducer tree-aware + `MissionExpandDialog` nested drill + `MissionPlanCard` nested rows + per-level meter — depends: 3.1 — status: done 2026-07-27 · wp/crew-nesting/4.3

## Phase 5 — Hardening & close
- [x] WP 5.R — final full-tree adversarial security review (complete probe set) — depends: 2.R, 3.1, 3.2, 4.1, 4.2, 4.3 — status: done 2026-07-27 · wp/crew-nesting/5.R · **ALL 21 REFUTED, no 5.fix**
- [x] WP 5.1 — `CLAUDE.md` registration (SoT list + capability row) + user-guide doc + owner-acceptance seeding + gate-green close — depends: 5.R — status: done 2026-07-27 · wp/crew-nesting/5.1

---

## Parallel-safety (batching rules for the orchestrator)

Contested hot files — a WP touching any of these runs **solo** (never in the same batch as another
WP touching it):
- `packages/shared/src/{types,schemas,constants}.ts` → WP 0.1 (solo).
- `apps/api/src/db/{schema,database,rows}.ts` → WP 0.2 (solo).
- `apps/api/src/hub/missions/{orchestrator,topologies}.ts` → WP 1.1 (resolution helper), 2.1, 2.2, 2.3
  all touch these → **strictly sequential** (1.1 → 2.1 → 2.2 → 2.3).
- `apps/api/src/config/env.ts` + `apps/api/src/index.ts` → WP 0.3 (disjoint from 0.2 → may batch with it).
- `apps/api/src/hub/missions/board.ts` → WP 3.1 (disjoint from the read-only 2.R → may batch).
- Web WPs 3.2/4.1/4.2/4.3 touch disjoint files (report / `MembersSection` / org-chart / mission-board)
  → safe to batch up to 4 in parallel.

Good parallelism windows: `{0.2, 0.3}`, then `{3.2, 4.1, 4.2, 4.3}`. Everything else serialises on the
shared/db/orchestrator hot files.

---

## Decision log
_Entries: date · decision · rationale._ Kickoff locks **D-CN1–D-CN10** in [`README.md`](./README.md) §3.

- **Kickoff · 2026-07-26 · owner chose *true runtime recursion* over flatten-to-depth-1, and
  *plan-first* over implement-now.** Rationale: hierarchical org modelling needs per-subtree topology
  preserved at execution, which the single-plan flatten cannot express; and reopening a locked
  decision (D-AH9) warrants a reviewed plan + owner sign-off before code. D-CN1 scopes the reopening
  as narrowly as possible (deterministic crew composition only; agents still never spawn).
- **Open · 2026-07-26 · three defaults flagged for owner confirmation** (README §3 callout):
  `HUB_MISSION_MAX_DEPTH` default = 2, `HUB_MISSION_MAX_TOTAL_AGENTS` default = 24, and keeping
  `hub_missions.session_id` = the root chat session (rather than relaxing the `kind:'chat'` propose
  gate). Not blocking authoring; must be confirmed before Phase 2 starts.
- **Confirmed · 2026-07-26 · owner signed off on the full D-CN log + all three defaults as specified.**
  D-CN1–D-CN10 accepted; `MAX_DEPTH=2`, `MAX_TOTAL_AGENTS=24`, `session_id` = root chat session kept
  (the `kind:'chat'` propose gate is NOT relaxed). This is the explicit authorization to run Phase 2 —
  the narrow D-AH9 reopening (D-CN1). No default changed from the recommended values.

---

## Owner acceptance (owner-only)

Checks an agent cannot verify (need provider keys / the running app / a both-theme visual walk).
All code is built + gate-green + adversarially reviewed (2.R + 5.R, all probes REFUTED); these are the
running-app / live-provider / rendered-visual walks that remain before the owner merges
`feat/crew-nesting → main`. (Seeded by WP 5.1 + the 5.R residual-risk summary.)

- [x] Confirm the **D-CN log** (README §3) and the three flagged defaults before kickoff — accepted: **2026-07-26** (owner confirmed D-CN1–D-CN10 + all three defaults exactly as specified: `MAX_DEPTH=2`, `MAX_TOTAL_AGENTS=24`, `session_id` = root chat session; Phase 2 unlocked)
- [ ] A **live nested mission ≥ 2 levels** with real models (e.g. Chief Operating Agent → {Strategy Crew (parallel, root agents), Intelligence Crew (parallel) → {Data Analyst, BI sub-crew}}) runs, preserves each subtree's own topology, synthesises an honest answer, and shows per-level cost attribution in the JSON + Markdown run reports — accepted: ____
- [ ] **Budget exhaustion mid-tree**: a real root allocation (e.g. $5) splits across levels; a child crew's budget trip cleanly aborts in-flight siblings and marks the branch **partial** (not a silent truncation); aggregate spend never exceeds the root `HUB_MISSION_MAX_BUDGET_USD` — accepted: ____
- [ ] **Cycle rejection** (author time): saving a crew with a `crewId` member that transitively reaches itself shows a clear, actionable error and rejects the save; **depth-cap** (a crew ≥ `HUB_MISSION_MAX_DEPTH+1` deep) is likewise rejected with a user-facing message; a graph mutated between save and run is rejected at **run time** too — accepted: ____
- [ ] **Transitive grant intersection** (D-HF5 across N levels): a child crew with `@read` Access on a server inside a parent with `@admin` shows the child's `@read` intersection (never escalated to `@admin`); the security model holds on full-tree traversal — accepted: ____
- [ ] **Live HITL awaiter cleanup** (5.R residual-risk): a denied approval / stop on a nested level settles dangling awaiters on the real `runAgentTurn`/`releaseTurn` session-runner path (the path the stub bypasses) — accepted: ____
- [ ] **Both-theme (`qlik-bright` + `qlik-dark`) + keyboard walk** of: the N-level org chart/rail (arrow/Tab/Enter roving, cycle placeholders), the nested **mission-board drill** (the first `Dialog`-in-`Dialog` in the app — focus trap + ESC ordering), the crew-editor **Sub-crew add path** + cycle warning, and the **per-level cost meter** — accepted: ____
- [ ] The **run report** (JSON + Markdown) renders the hierarchical trace with per-level cost/timing + honest partial marking on budget-exhausted children — accepted: ____
- [ ] **`2.R` + `5.R` adversarial reviews reviewed** (`phase-2-engine/2.R-review.md`, `phase-5-close/5.R-review.md`); any residual risk accepted — accepted: ____
- [ ] **(Pre-existing, out of scope) `hub-workspace.test.ts` flake** acknowledged — a same-millisecond snapshot-ordering timing flake in code byte-identical to `main`, unrelated to crew-nesting; decide separately whether to harden it — accepted: ____

---

## Orchestration log
_(Append-only. One entry per batch open / WP completion / blocker. Never rewrite history.)_

- 2026-07-26 — Plan authored (README + conventions + references + STATUS + kickoff + 15 WP specs).
  Awaiting owner sign-off on the D-CN log before the first batch opens.
- 2026-07-26 — Orchestrator kickoff. **Owner-sign-off gate resolved: owner HELD at Phase 1** (D-CN log
  not confirmed) → running Phase 0 + Phase 1 only; **stop before Phase 2** (D-AH9 reopening). Created
  integration branch `feat/crew-nesting` @ `6454137e` (main), not merged to main.
- 2026-07-26 — Batch 1 `{0.1}` SOLO (Opus) opened + **WP 0.1 done** (`wp/crew-nesting/0.1` @
  `47fe0fd4`). Authoritative full gate green in the integration worktree: typecheck ✅ · test ✅
  (shared 85/85 · api 3096/3096 · web 3010 pass/5 skip) · build ✅ · lint ✅. D-CN9 verified (no diff
  to `assistant-scope.ts`; `assistant-scope.test.ts` 23/23). Next: batch 2 `{0.2, 0.3}` from
  `feat/crew-nesting` tip.
- 2026-07-26 — Batch 2 `{0.2 (Opus), 0.3 (Sonnet)}` opened (disjoint files) + **both done** and merged
  into `feat/crew-nesting` (clean 3-way, no conflicts): WP 0.2 `wp/crew-nesting/0.2` @ `fb1e7ab9`
  (v54 re-confirmed free; 13 version-lock test files bumped 53→54, incl. `watch-rules.test.ts` beyond
  the spec's 12), WP 0.3 `wp/crew-nesting/0.3` @ `9ac29a4c`. Authoritative full gate green on the
  MERGED result: typecheck ✅ · api 3112/3112 ✅ · web 304 files/3010 pass ✅ · build ✅ · lint ✅.
  (First gate run flagged 1 api failure — `hub-workspace.test.ts` snapshot-ordering — ruled a
  **pre-existing same-millisecond timing flake**: file byte-identical to `main`, 20/20 green on 3
  isolated re-runs + clean on the full re-run; unrelated to the db/env changes.) **Phase 0 complete.**
  Next: WP 1.1 SOLO (Opus).
- 2026-07-26 — WP 1.1 SOLO (Opus) **done** (`wp/crew-nesting/1.1` @ `76d31613`) + merged into
  `feat/crew-nesting`. Pure `crew-resolution.ts` (cycle-REJECTING `assertCrewGraphValid` +
  cycle-TOLERANT memoised `resolveCrewRollup`), repository `createCrew`/`updateCrew` author-time
  guards (members-patch-scoped), `summarizeCrew` per-kind + recursive counts, `HubRepository`
  caps DI. Authoritative full gate green on the merged result: typecheck ✅ · api 3138/3138 ✅ (+26
  crew-nesting tests, no flake) · web 304 files/3010 pass ✅ · build ✅ · lint ✅. D-CN9 verified
  (zero diff to the four scope identifiers). Next (final Phase-1 WP): WP 1.2 (Sonnet).
- 2026-07-26 — WP 1.2 (Sonnet) **done** (`wp/crew-nesting/1.2` @ `95abefea`) + merged into
  `feat/crew-nesting`. Dock write tools (`hub_crew_create`/`hub_crew_update`) + HTTP CRUD
  (`POST`/`PATCH /api/hub/crews`) accept `crewId` members; 1.1's cycle/depth rejections surface as a
  clean `isError` tool result AND a 400 (not 500) on both HTTP paths; `summarizeCrewWithRollup` echoes
  nested counts; `hub_crews_list` description refreshed. Authoritative full gate green on the merged
  result: typecheck ✅ · api 3147/3147 ✅ (+9 tests, no flake) · web 304 files/3010 pass ✅ · build ✅
  · lint ✅. D-CN9 verified (zero diff to `assistant-scope.ts`/`constants.ts` scope vocab;
  `assistant-scope.test.ts` incl. D-AO7 green). **Phase 1 complete.**
- 2026-07-26 — **ORCHESTRATOR STOP at the owner-hold boundary.** Phases 0 + 1 (all 5 WPs) shipped +
  gate-green on `feat/crew-nesting`. Phase 2 (recursive execution engine, the narrow D-AH9 reopening)
  is **NOT** started — awaiting owner confirmation of the D-CN log + three defaults (see the
  Owner-acceptance box below). No further batches will open until that sign-off lands.
- 2026-07-26 — **OWNER SIGN-OFF RECEIVED.** Owner confirmed D-CN1–D-CN10 + all three flagged defaults
  as specified (no changes). Phase 2 unlocked. Opening **WP 2.1 SOLO (Opus)** — sub-mission spawn +
  recursion at `runSlot`/`runOneAgent` (the D-AH9 reopening, D-CN1/D-CN2) — from `feat/crew-nesting`
  tip. Phase 2 is strictly sequential (2.1 → 2.2 → 2.3 → 2.R) on the shared `orchestrator.ts`/
  `topologies.ts` hot files.
- 2026-07-26 — **WP 2.1 SOLO (Opus) done** (`wp/crew-nesting/2.1` @ `38378785`) + merged into
  `feat/crew-nesting`. The recursion heart: `MissionRunRuntime` (ONE shared abort/cost/limiter across
  all levels), `runMissionLevel`/`buildRunSlot` (crew vs leaf branch), `runSubCrew` (guard → resolve
  → child plan → child `hub_missions` row [`session_id`=root, `parent_mission_id`/`depth`/
  `root_mission_id`] → nested `runTopology` → project to ONE stamped `HubAgentReport`), run-time
  visited-set + depth guard (loud reject → honest partial). Authoritative full gate green on the merged
  result: typecheck ✅ · api 3156/3156 ✅ (+9 tests, no flake) · web 304 files/3010 pass ✅ · build ✅
  · lint ✅. Proven: shared-accumulator aggregate ≤ root ceiling (cap $3 / 5×$1 leaves → 3 run),
  global concurrency ≤ root maxParallel, child-row lineage + `session_id`=root, **propose gate + scope
  vocab UNTOUCHED** (D-CN1/D-CN9). 4 deliberate deviations noted (reused `composeCrewBrief`;
  `rootMissionId` via `runtime.rootMissionId`; no redundant `updateMission`; per-level token
  attribution deferred to 3.2) — none reopen a D-CN decision. Next (sequential): WP 2.2 (Opus).
- 2026-07-26 — **WP 2.2 (Opus) done** (`wp/crew-nesting/2.2` @ `6655061e`) + merged into
  `feat/crew-nesting`. Whole-tree budget cascade: `allocateChildBudget` (no-`caps` monotone primitive)
  + `summarizeMissionTree` (transitive count/depth/allocation-bounded cost); propose-time whole-tree
  gate feeds the tree count/cost into `shouldAutoApprove` + enforces `maxTotalAgents`→400 + depth
  backstop; run-time cascading meter with per-level `reservableUsd` + composed `isBudgetTripped`
  (this-OR-any-ancestor) + R3c zero-alloc skip + Design-D honest-partial. Authoritative full gate
  green on the merged result: typecheck ✅ · api 3166/3166 ✅ (0 cancelled, +10 tests incl. the
  **400-randomized-tree monotone property test**) · web 304 files/3010 pass ✅ · build ✅ · lint ✅.
  Proven: aggregate ≤ root `min(requested, maxBudgetUsd)` at every node; caps read ONLY at root (grep);
  root `clampPlanToBudgets` ceiling + propose gate + scope vocab UNTOUCHED (D-CN3/D-CN9). Reconciled
  ONE WP-2.1 locked test (run-time overflow → the true D-CN4 mutate-after-save backstop; strengthens
  coverage). **Follow-up (owner/2.R):** WP 2.1's `hub-crew-nesting-engine` "stop reaches in-flight
  nested leaf" test is intermittently `cancelled` (node:test blocking-abort artifact; present on the
  base commit, not a regression) — flagged for test-stability hardening. Next (sequential): WP 2.3.
- 2026-07-26 — **WP 2.3 (Opus) done** (`wp/crew-nesting/2.3` @ `ca27f6c0`) + merged into
  `feat/crew-nesting`. Transitive non-escalation across N levels: injected `parentScope` + per-level
  `control` on `MissionLevel`, `subCrewParentScope` (threads the enclosing slot's `L1∩L0` effective
  grants, never re-derived from the sub-mission's root session — D-CN6 re-widen hazard closed);
  `missionUnreadyServers` recurses into crew-ref units via `resolveCrew` under the visited/depth guard
  (nested unready server → `approve()` blocks the whole tree, named); `this.running` sub-mission
  registry + downward `missionAbort` cascade so `stop`/`stopAgent`/`steerAgent` reach any depth (bodies
  unchanged). Authoritative full gate green on the merged result: typecheck ✅ · api 3175/3175 ✅
  (0 cancelled, +9 tests) · web 304 files/3010 pass ✅ · build ✅ · lint ✅. `unionRosterServerGrants`
  NOT applied to nested (no upward widen); D-CN9 scope vocab + propose gate UNTOUCHED. **Phase 2 engine
  (2.1+2.2+2.3) complete.** Two notes: (a) crew-ref *empty* grant = "no added restriction" (pass
  enclosing scope through) so level-2 scope = transitive intersection not ∅, explicit grants still
  narrow — **2.R probe 7 must adversarially confirm non-escalation holds**; (b) **the WP-2.1 flaky
  "stop reaches nested leaf" test is now FIXED** — 2.3 root-caused it (`getMissionBySession`
  DESC-LIMIT-1 tie returned the sub-mission id, making 2.1's `stop(subId)` a no-op) and the new
  `this.running` sub-mission entry makes it cascade (0 cancelled across the merged gate + 6 isolated
  runs). Next (sequencing decision): **WP 3.1 SOLO before WP 2.R** — 2.R's probe 10 (nested tree
  replay) needs 3.1's tree-aware `reconstructMission` + parent-linkage events to be a real probe.
- 2026-07-26 — **WP 3.1 SOLO (Opus) done** (`wp/crew-nesting/3.1` @ `b7765d74`) + merged into
  `feat/crew-nesting`. Event-sourced hierarchy: additive optional `parentMissionId?`/`parentAgentKey?`
  on `HubPlanProposedEvent`/`HubAgentSpawnedEvent` (shared, no `/api/v2`, no migration); tree-aware
  `reconstructMission` + new `reconstructMissionById(events, missionId)` (both over one pure
  `buildMissionTree`) with root-identity fix (root = latest `plan_proposed` with NO `parentMissionId`),
  per-level cost roll-up (crew node = Σ children, own projected cost NOT double-counted). Authoritative
  full gate green on the merged result: typecheck ✅ · api 3180/3180 ✅ (0 cancelled) · web 304
  files/3010 pass ✅ · build ✅ · lint ✅. **Spec-gap resolved (foreseen, not a D-CN reopening):** WP 2.1
  created the child `hub_missions` row but never emitted its `plan_proposed`; 3.1's replay requires it,
  and the spec's Sequencing note authorized adding it — so `runSubCrew` now emits the sub-mission
  `plan_proposed` **as an event** (D-CN1 intact: NOT via the gated `proposePlan()`/withheld builtin; no
  `plan_approved`/HITL follows, `plan_approved` count == 0). No `apps/web` file touched (web reducer =
  WP 4.3). Next (sequencing): **WP 2.R** (engine refute-review, all 10 probes now real).
- 2026-07-27 — **WP 2.R (Opus) done** (`wp/crew-nesting/2.R` @ `74142d63`) + merged into
  `feat/crew-nesting`. **ALL TEN PROBES REFUTED — no FINDING, no `2.fix`.** 17 concrete deterministic
  attacks (stub-runner seam, no provider), each failing to break its invariant: budget monotonicity
  (aggregate ≤ root `min(requested, maxBudgetUsd)`, no descendant re-reads env caps), run-time
  cycle/depth (mutate-after-save → loud reject, bounded rows), cascading trip at depth 2, whole-tree
  `shouldAutoApprove`, nested HITL deny, transitive grants, autonomy non-escalation, brief-only
  isolation, nested-tree replay. **Two spec-mandated scrutiny points cleared:** (7) 2.3's empty
  crew-ref grant is SAFE — `subCrewParentScope` returns enclosing-unchanged or a strict subset, never
  wider (3-level root-dropped-server drop proven); (6) 3.1's sub-mission `plan_proposed` does NOT route
  through the propose gate — one event + zero `plan_approved`, `createMission` direct, `kind==='chat'`
  gate never consulted for a child (D-CN1 intact). Read-only proof: `git diff` of `apps/{api,web}/src`
  + `packages/shared/src` empty; only the review test + `2.R-review.md` added. Authoritative full gate
  green: typecheck ✅ · api 3197/3197 ✅ (+17 probes, 0 cancelled) · web 304 files/3010 pass ✅ · build
  ✅ · lint ✅. **Phase 2 COMPLETE (engine + review).** Two residual notes in the review doc are scope
  clarifications, not defects. Next: **batch {3.2, 4.1, 4.2, 4.3}** (report + 3 UI WPs, disjoint, 4
  parallel).
- 2026-07-27 — **Batch {3.2, 4.1, 4.2, 4.3} (all Sonnet) done** + merged into `feat/crew-nesting`
  (clean, no conflicts — disjoint files): WP 3.2 `ee9f409c` (run-report hierarchical trace +
  `mission-trace.ts`, `## Mission trace` Markdown, legacy flat unchanged, `version` stays 1); WP 4.1
  `c7b4c5a6` (crew-editor Role/Sub-crew add path + client-side cycle/depth warn/filter, kind-branched
  accordion, "Open sub-crew" route reuse); WP 4.2 `01830f82` (org rail/chart N-level via a pure
  cycle-safe `crew-membership.ts` closure + `useTreeKeyboard` + recursive `@xyflow` `parentId`
  box-in-box + cycle/depth placeholders, `buildCrewMemberLayout`/`CrewTopologyGraph` untouched); WP 4.3
  `1f7834f1` (mission-board tree reducer + `childBoard`/`rollup`, sub-crew topology node, nested
  `MissionExpandDialog` drill dialog, `PlannedCrewCard` rows). Combined authoritative full gate green:
  typecheck ✅ · api 3207/3207 ✅ (+10) · web 306 files/3093 pass (+83 crew-nesting UI tests) ✅ ·
  build ✅ · lint ✅ (1458 files). **Phases 3 + 4 COMPLETE.** Owner-acceptance visual/keyboard/
  both-theme walks (nested rail/chart, nested mission-board drill dialog, crew-editor add path,
  per-level cost meter) are seeded for the owner — no agent self-certifies them. Next: **WP 5.R**
  (final full-tree adversarial review).
- 2026-07-27 — **WP 5.R (Opus) done** (`wp/crew-nesting/5.R` @ `f543750f`) + merged into
  `feat/crew-nesting`. **ALL 21 PROBES REFUTED — no FINDING, no `5.fix`, no decision-level blocker.**
  Whole-feature capstone (29 api + 8 web concrete adversarial probes at depth ≥ 2): whole-tree budget
  aggregation (P-BUD1-4), author+run-time cycle/depth incl. mutate-after-save + `MAX_DEPTH=1` reproduces
  today (P-CYC1-4), no-propose-gate-relaxation (P-GATE1), nested `shouldAutoApprove`/HITL deny/autonomy
  `min` (P-HITL/P-AUT), transitive grant intersection + `missionUnreadyServers` recursion + frozen scope
  (P-GRA/P-SCOPE1), brief-only isolation + per-subtree topology + best-of-N judge blindness
  (P-ISO/P-TOPO), nested-tree replay API+web + domain isolation (0 foreign-table rows) + legacy-flat
  unchanged (P-REP1-3). **P-REG1: NO regression after Phases 3–4** (2.R suite 17/17 + scope 23/23 green
  on the integrated base). Read-only proof: only 2 test files + `5.R-review.md`. Authoritative full gate
  on the merged result: typecheck ✅ · api **3235 pass / 0 cancelled** · web 307 files/3101 pass ✅ ·
  build ✅ · lint ✅ (1460 files) — with **ONE pre-existing flake**, `hub-workspace.test.ts`
  "listWorkspaceSnapshots … newest-first" (same-millisecond snapshot-ordering timing flake): file +
  source **byte-identical to `main`**, reproducibly nondeterministic (passed 2 of 3 isolated re-runs),
  entirely unrelated to crew-nesting (5.R added only test files). **⚠ Owner follow-up: pre-existing
  repo flake, out of crew-nesting scope** — not fixed here (would require touching `hub-workspace`
  source, which this plan must not). Next (final): **WP 5.1** (registration + docs + owner-acceptance
  seeding + close).
- 2026-07-27 — **WP 5.1 (Haiku) done** (`wp/crew-nesting/5.1` @ `60340648`) + merged. `CLAUDE.md`
  registration (crew-nesting `STATUS.md` in the SoT list + a north-star capability row) +
  `user-guide/17-crew-nesting.md` (~730-word operator guide). Docs-only (2 markdown files, zero
  code/test impact); final typecheck ✅ · build ✅ · lint ✅ on the merged tip; the test dimension is
  the 5.R gate's (identical code). STATUS Owner-acceptance seeded by the orchestrator (5.1's 7-item
  checklist + the 5.R residual-risk items).
- 2026-07-27 — **🎉 PLAN COMPLETE. All 16 WPs (Phases 0–5) done + integrated + gate-green on
  `feat/crew-nesting`.** Both refute-reviews clean (2.R 10/10, 5.R 21/21 — no findings). Migration
  v54; frozen scope boundary + `kind:'chat'` propose gate untouched. **`feat/crew-nesting` is NOT
  merged to `main`** — owner merges after the Owner-acceptance walks above (live nested mission,
  both-theme + keyboard, budget-exhaustion trace, cycle/depth UX, transitive grants, run-report
  rendering). One pre-existing `hub-workspace.test.ts` flake (unrelated, out of scope) flagged for the
  owner. Per-WP done-branches: 0.1 `47fe0fd4` · 0.2 `fb1e7ab9` · 0.3 `9ac29a4c` · 1.1 `76d31613` ·
  1.2 `95abefea` · 2.1 `38378785` · 2.2 `6655061e` · 2.3 `ca27f6c0` · 2.R `74142d63` · 3.1 `b7765d74`
  · 3.2 `ee9f409c` · 4.1 `c7b4c5a6` · 4.2 `01830f82` · 4.3 `1f7834f1` · 5.R `f543750f` · 5.1
  `60340648`.
