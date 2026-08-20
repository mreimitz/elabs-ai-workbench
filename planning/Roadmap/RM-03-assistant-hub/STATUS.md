---
type: "Status Ledger"
title: "assistant-hub \u2014 work-package status ledger"
description: "Living state for the assistant-hub plan (README \u00b7"
tags: ["roadmap", "RM-03"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---
# assistant-hub — work-package status ledger

Living state for the `assistant-hub` plan ([README](./item.md) ·
[execution-plan](./execution-plan.md) · [kickoff](./kickoff-prompt.md)), read and updated by the
orchestrator / the `next-wp` skill. A box is ticked **only** when the WP's Acceptance is met and
the quality gate is green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

**Legend:** `[ ]` open · `[x]` done. A trailing `status:` note marks `in progress` / `in review` /
`blocked`. Done lines record the date + branch: `… — done YYYY-MM-DD · wp/assistant-hub/<id>`.

**Decisions locked 2026-07-17 (owner planning session): D-AH1…D-AH20 — see README. Do not reopen.**
**Requirements annex added 2026-07-17 (owner-requested SOTA research): [`requirements.md`](./requirements.md)
(R-SES/R-MCP/R-SK/R-UX; MUST-graded items are part of the owning WP's Acceptance per the annex's
WP impact map). Evidence: [`research/agentic-session-sota/`](/Research/RS-06-agentic-session-sota/) docs 00–03.**
**R-catalog v2 same day (owner-requested GenUI research + scope selection): added R-GUI1–8
(declarative generative UI — evidence doc 04: Thesys OpenUI · CopilotKit · assistant-ui, incl.
the system-prompt playbook for WP 0.3), R-UX13 (artifact share/export), R-MCP13 (research-server
recipe), and new WP 2.6.**
**Correction (owner recheck vs the LIVE brand-ui Storybook, same day): charts and the review
workflow are NOT upstream gaps — `Charts/AutoChart` (LLM-tool-call-native `ChartSpec`, adopted
as the R-GUI chart contract) and `AI/ChangeReview` (hunk-by-hunk AI-edit trust gate; WP 3.5's
surface) exist in the live library; the vendored agent kit 1.6.0 lags it. Every UI WP verifies
against the running Storybook / `pnpm exec brand-ui`, never the tarball manifest alone (doc 04
§5 corrected).**

## Gates (D-AH16) — check before any implementation batch

- [x] Unified Sessions **Wave 1 merged** (contract modules importable) — VERIFIED 2026-07-17:
      workstream COMPLETE (all WPs ticked in `roadmap/unified-sessions/STATUS.md`);
      `apps/api/src/testing/{session-terminal,session-capabilities,session-clock}.ts` present on main.
- [x] Observability core phases done **or** owner released capacity — VERIFIED 2026-07-17: all 27
      WPs (Phases 1–5) merged to local `main` + owner released capacity (start order recorded above);
      migration head **v46** (next free **v47**, re-verify at WP0.2 claim).
- Early-start exceptions while gated: WP 0.3 (prompt architecture), WP 0.4 (shell/nav, only if
  `AppShell.tsx` is uncontended), docs.

## Wave 0 — Contract & foundation
- [x] WP 0.1 — shared hub contract (types/zod/constants; Opus) — done 2026-07-17 · wp/assistant-hub/0.1
- [x] WP 0.2 — migration (next free user_version) + repositories (Sonnet) — done 2026-07-17 · wp/assistant-hub/0.2 (user_version v47)
- [x] WP 0.3 — prompt architecture (layered, versioned, token-budgeted; Opus) — done 2026-07-17 · wp/assistant-hub/0.3
- [x] WP 0.4 — nav item + /assistant shell + dock relabel "App assistant" (Sonnet) — done 2026-07-17 · wp/assistant-hub/0.4
- [x] WP 0.5 — tool registry core (built-ins, grants, MCP-bridge adapter; Sonnet) — done 2026-07-17 · wp/assistant-hub/0.5

**✅ WAVE 0 COMPLETE (2026-07-17) — `feat/assistant-hub` @ 47eeacc.** All 5 WPs merged; wave-close
gate fully green: typecheck 0 · test 0 (shared **67** · api **2453** · web **1651**/5skip) · **build 0**
(24.3s) · **lint 0** (1088 files). Migration head **v47**. No wave-0 review WP (reviews start 1.R).

## Wave 1 — Vertical showcase
- [x] WP 1.1 — turn engine, AI-SDK path (Opus) — done 2026-07-17 · wp/assistant-hub/1.1
- [x] WP 1.2 — sessions API + SSE (Sonnet) — done 2026-07-17 · wp/assistant-hub/1.2 (+ WP1.5 seam-close)
- [x] WP 1.3 — conversation UI (Sonnet) — done 2026-07-17 · wp/assistant-hub/1.3
- [x] WP 1.4 — MCP tools + citations v1 (Opus) — done 2026-07-17 · wp/assistant-hub/1.4 (3 gaps → WP1.R)
- [x] WP 1.5 — claude_subscription adapter (Sonnet) — done 2026-07-17 · wp/assistant-hub/1.5 (index.ts seam-close pending after 1.2)
- [x] WP 1.6 — artifacts v1, markdown canvas (Sonnet) — done 2026-07-17 · wp/assistant-hub/1.6
- [x] WP 1.7 — mission v1: plan → approve → parallel → board → synthesize (Opus) — done 2026-07-17 · wp/assistant-hub/1.7
- [x] WP 1.R — Wave-1 adversarial review (Opus) — DONE 2026-07-17 · wp/assistant-hub/1.R. **Wave-1 CLOSED 2026-07-18** — bounded fixes merged (feat @ `45924bc`): BUG-4 cost-cap, GAP-E mission user-triggerable, LOW-a11y SessionRail Button, INV2 citation attribution (INV2+INV4 probes un-skipped + passing). Full gate GREEN (typecheck; **api 2550/0-fail**; **web 1764**/5skip; build 26s; lint 1134). GAP-A/GAP-B → WP2.3 per owner (see below).

## Wave 2 — Harness depth
- [x] WP 2.1 — role library + Agents view (Sonnet) — done 2026-07-18 · wp/assistant-hub/2.1 (integrated @ cba01a4; skillIds→skills reconciled vs WP2.4)
- [x] WP 2.2 — crews + topologies (pipeline/debate/best-of-N + mission graph; Opus) — done 2026-07-18 · wp/assistant-hub/2.2 (integrated @ bb89591; blind best-of-N judge; @elabs-ai/components-flow mission graph)
- [ ] WP 2.3 — autonomy dial + hard budgets + steering **+ live HITL approval-gating + MCP elicitation (GAP-A/GAP-B folded in per owner 2026-07-18)** (Sonnet→Opus for the HITL seam) — depends: 1.7 — status: open. **Expanded scope:** add approval-requested/elicitation events to the `HubEvent` union (additive), turn-engine HITL interception (pause→`waiting_input`-for-decision→resume), decision/response route, MCP-client elicitation handler; drives the existing WP0.5 approval-policy + WP1.4 cards live (R-MCP3/4, R-UX1-approval). **✅ DONE 2026-07-18 · wp/assistant-hub/2.3 (integrated @ bb89591)** — 4 additive `HubEvent`s (approval/elicitation ×req/resp), turn-engine HITL seam (auto-run path byte-identical), decision/elicitation/autonomy/steer routes, live `ApprovalCard`/`ElicitationPanel` + `AutonomyDial`, credential-field refusal; all stub-proven. **Owner-acceptance:** live MCP `elicitation/create` round-trip (needs a real eliciting server) + both-theme walk. GAP-A/GAP-B CLOSED.
- [x] WP 2.4 — skills for hub (session + role attach; Sonnet) — done 2026-07-18 · wp/assistant-hub/2.4 (migration **v48** `hub_session_skills`; integrated @ cba01a4)
- [x] WP 2.5 — composer power features (slash commands, branch/regenerate, voice; Sonnet) — done 2026-07-18 · wp/assistant-hub/2.5 (integrated @ cba01a4; modes/crews slash categories deferred to 2.2)
- [x] WP 2.6 — declarative GenUI: catalog→prompt compiler, validator + repair loop, allowlisted renderer, two-tier interactivity (Opus) — done 2026-07-18 · wp/assistant-hub/2.6 (integrated @ 474c43f; shared allowlist validator; R-GUI7 trace-grouping light — flagged)
- [x] WP 2.R — Wave-2 adversarial review incl. GenUI security (Opus) — review DONE 2026-07-18 · wp/assistant-hub/2.R (34 probes; hard invariants HOLD: topology ordering, best-of-N judge blindness, autonomy refusal, HITL deny-never-runs, GenUI allowlist/URL/repair security, domain isolation runtime-proven). **2 fixes → wp/assistant-hub/2.fix:** (a) regenerate variants event-sourced on reload (R-SES1, WP2.5); (b) `HUB_MISSION_MAX_BUDGET_USD` hard ceiling (D-AH9, WP1.7/2.3). **Owner-acceptance (c):** `Chart.spec` passthrough — tokens-only inside a ChartSpec is delegated to `@elabs-ai/components-charts` AutoChart (unverifiable in jsdom; verify AutoChart ignores non-token colors in a real browser). **✅ 2.fix merged; WAVE 2 CLOSED 2026-07-18 · feat @ `c5a105b`** — full gate green (typecheck; api 2639/0-fail; web 1867/5skip; build; lint 1184).

## Wave 3 — Knowledge, files & review
- [x] WP 3.1 — projects + pinned context (Sonnet) — done 2026-07-18 · wp/assistant-hub/3.1 (B14 integrated @ 4bd94d8; AssistantView `activeAside` union)
- [x] WP 3.2 — memory + Memory view (propose→save; Sonnet) — done 2026-07-18 · wp/assistant-hub/3.2 (B14 @ 4bd94d8; propose-chip→explicit-save, nothing silent)
- [x] WP 3.3 — summaries & compaction (Opus) — done 2026-07-18 · wp/assistant-hub/3.3 (B14 @ 4bd94d8; clear-then-summarize, thrash-stop, constraint-recall verbatim)
- [x] WP 3.4 — uploads + workspace + file tools (Sonnet) — done 2026-07-18 · wp/assistant-hub/3.4 (B14 @ 4bd94d8; confinement-tested, output-cap spill, content-addressed snapshots). **Follow-up (owner):** MCP resource catalog is scanned-only (no live `resources/list`); resource picker not session-grant-scoped.
- [x] WP 3.5 — artifact diff + review workflow (Sonnet) — done 2026-07-18 · wp/assistant-hub/3.5 (integrated @ f1d10c4; `@elabs-ai/components-editor` DiffEditor + critic → `AI/ChangeReview` accept/reject → new version + revert). **Owner-acceptance:** live critic run (provider key).
- [x] WP 3.R — Wave-3 adversarial review (Opus) — review DONE 2026-07-18 · wp/assistant-hub/3.R (19 probes; **5/6 invariants HOLD confirmed**: memory-injection exactness, compaction fidelity vs adversarial summarizer, upload safety, review lineage immutability, domain isolation [runtime 0 foreign-table rows]). **3 LOW workspace findings → wp/assistant-hub/3.fix (WP0.5/3.4 primitive):** F1 symlink-write escape (realpath-check parent before create), F2 missing workspace write cap (`HUB_WS_MAX_FILE_BYTES`), F3 non-deterministic snapshot ordering flake (add id tiebreaker). **✅ 3.fix merged; WAVE 3 CLOSED 2026-07-18 · feat @ `5b35dc0`** — full gate green (typecheck; api 2720/0-fail; web 1926/5skip; build; lint 1207). **Follow-up (minor):** `HUB_WS_MAX_FILE_BYTES` env override not yet threaded to call sites (cap live via default).

## Wave 4 — Enterprise polish
- [x] WP 4.1 — usage telemetry view + **context inspector** (Sonnet) — done 2026-07-18 · wp/assistant-hub/4.1 (B17 integrated @ c2fe1ca; real per-layer token counts — the dogfood surface). **Owner-acceptance:** both-theme chart walk.
- [x] WP 4.2 — audit timeline view (Sonnet) — done 2026-07-18 · wp/assistant-hub/4.2 (B17 @ c2fe1ca; `hub_events` projection + deep-link into session replay)
- [x] WP 4.3 — hardening (orphans, prune-hub, limits, kind breadth; Sonnet) — done 2026-07-18 · wp/assistant-hub/4.3 (B17 @ c2fe1ca; session+mission boot reconcile, `prune-hub`, retry-on-other-source banner, notify wiring, Docker `/data/hub/**`). **Owner-acceptance:** live crash-mid-mission reconcile + notification delivery.
- [x] WP 4.4 — e2e + a11y walks + user guide + CLAUDE.md row (Sonnet) — done 2026-07-18 · wp/assistant-hub/4.4 (integrated @ ce6fe93; e2e runs the REAL hub engine via an in-process OpenAI-compat stub — chat→artifact + full mission propose→approve→board→synthesis; `user-guide/16-assistant-hub.md`; dock retitled "App assistant"; research-server presets [Tavily/Brave/Exa, no bundled keys] + research empty-state link; CHANGELOG; CLAUDE.md row → Built; `owner-acceptance-walk.md`). **Note:** pre-existing `metrics-perf` p95 benchmark flakes under concurrent load (not hub-related; owner follow-up).
- [x] WP 4.R — final review + owner-acceptance assembly (Opus) — done 2026-07-18 · wp/assistant-hub/4.R (integrated @ e5ffa26; **10 real-engine seeds** drive the production planner/agent/synth/judge AI-SDK seams for every mode + all 4 topologies + budget-trip + branch + review — all PASS, all replay from `hub_events`; every invariant HOLDS; **no confirmed defects**).

---

## ✅ WORKSTREAM COMPLETE — 2026-07-18 · `feat/assistant-hub` @ `e5ffa26`

**All 31 WPs (Waves 0–4) + 4 adversarial reviews + all review-fixes are implemented, integrated, and
gate-green.** Final gate: `typecheck` clean · **api 2763/0-fail** · **web 1950/5-skip** · `build` ok ·
`lint` clean (1222 files). Migrations claimed: **v47** (WP0.2 hub tables) + **v48** (WP2.4 hub_session_skills).
GAP-A/GAP-B (live HITL + MCP elicitation) folded into WP2.3 per owner (2026-07-18) and delivered.
Owner merges `feat/assistant-hub → main`.

**Non-blocking follow-ups (owner-decided scheduling):**
- **Per-agent cost metering:** the production `createStructuredAgentRunner` reports `costUsd: 0` (one
  `generateObject`, no per-agent token metering) → a mission's hard **cost** cap can't be tripped by real
  agent spend (agent-count + per-turn caps still bound it). Wire real per-agent token/cost accounting
  (WP1.7/4.1). Documented in `orchestrator.ts` + `hub-wp1r-review.test.ts`.
- `HUB_WS_MAX_FILE_BYTES` env override not threaded to call sites (cap live via default 5 MB).
- MCP resource catalog is scanned-only (no live `resources/list`); research empty-state uses a name heuristic.
- Mission planner/synthesizer prompts don't yet see memory/project context (main chat/research turns do).
- Pre-existing `metrics-perf` p95 benchmark flakes under concurrent test load (not hub-related).

**WP 0.3 input (2026-07-17): [`system-prompt-draft.md`](./system-prompt-draft.md) — the assembled
v0 reference draft of the layered runtime prompt (10 layers + role-agent template + per-layer
token budgets), incl. the LAYER-8 orchestration contract (parallel-task taxonomy P/S, model-tier
routing rules 1–7). WP 0.3 implements it as versioned modules; it does not bypass the WP.**
**Upstream filing (2026-07-17): [`brand-ui-upstream-prompt.md`](./brand-ui-upstream-prompt.md) —
the coding-agent prompt for the 7 brand-ui gaps (A–G), discharged from WP 2.6's filing duty.**
**Implementation start (2026-07-17): owner released capacity — [`orchestrator-prompt.md`](./orchestrator-prompt.md)
is the operational start order (batch schedule B1–B19, per-WP model assignment, subagent
template, validation loop). It expands kickoff-prompt.md; the plan docs stay authoritative.**

## Orchestration log

*(Append-only. One entry per batch open / WP completion / blocker. Never rewrite history.)*

- 2026-07-17 — **Orchestration started.** §1 gate checks run + PASSED (both D-AH16 gates ticked
  above): Unified Sessions complete (contract modules present on main), Observability complete +
  capacity released, migration head **v46**, brand-ui **v1.9.0** committed+clean on main, baseline
  `pnpm typecheck` on main **exit 0**, no `hub_*`/`Hub*` scaffolding yet. Branch `feat/assistant-hub`
  cut @ `992dcf3` (main `2c57ed7` + this orchestrator-docs commit). **Batch 1 dispatched** —
  parallel worktree subagents, zero file overlap: **WP 0.1** (Opus, shared hub contract →
  `wp/assistant-hub/0.1` @ `.claude/worktrees/ah-wp01`) ∥ **WP 0.4** (Sonnet, nav+/assistant shell+
  dock relabel → `wp/assistant-hub/0.4` @ `.claude/worktrees/ah-wp04`). B2 (0.2 ∥ 0.3) gates on 0.1.

## Orchestration log

*(Orchestrator appends dispatch/validation notes; a haiku bookkeeper records each WP done. Append-only.)*

- 2026-07-17 — **Gates verified + Wave 0 started.** §1 gate checks all green: Unified Sessions
  complete + merged to main (shared `session-clock.ts`/`session-terminal.ts`/`session-capabilities.ts`
  present in `apps/api/src/testing/`); Observability Phases 1–5 complete + merged; working tree clean;
  baseline `pnpm typecheck` green on `main` @ `992dcf3`; brand-ui **v1.9.0** vendored + wired (committed
  `2c57ed7`); migration head **v46** → next free `user_version` **v47** (WP0.2 re-verifies at claim).
  `feat/assistant-hub` @ `992dcf3` (= main). **Batch 1 dispatched** (parallel worktree subagents,
  disjoint files — `packages/shared` vs `apps/web`): **WP0.1** (Opus, `wp/assistant-hub/0.1`, worktree
  `ah-wp01`) + **WP0.4** (Sonnet, `wp/assistant-hub/0.4`, worktree `ah-wp04`). Both based at `992dcf3`.
  Awaiting completion → orchestrator re-runs the gate per worktree + checks every Acceptance item before
  ticking. Nothing merged/ticked yet.

- 2026-07-17 — **WP0.4 DONE** · verdict PASS · gate re-verified by orchestrator (independent
  `typecheck` exit 0 all 3 projects; web **1651 pass / 5 skip** incl. new `AssistantView.test.tsx`;
  agent also ran api 2329, lint 1045 clean, build exit 0; dock `AssistantDock.test` 36/36 unchanged).
  Files: `AppShell.tsx` (nav group below Dashboard + 6 dock-copy relabels), `App.tsx` (lazy
  `/assistant` route), NEW `features/hub/AssistantView.{tsx,test.tsx}` (brand-ui-only `ChatShell`
  scaffold, disabled starter chips, tokens-only), `AssistantDock.tsx` (signed-out copy → "App
  assistant"). Merged `--no-ff` → `feat/assistant-hub` **@ 0c3b291**. Worktree removed.
  **Owner-acceptance (not faked):** live both-theme + keyboard visual walk of `/assistant` scaffold
  + dock relabel (tokens-only by construction; agent could not render a browser here). **WP0.1 still
  running** (B1); B2 (0.2 ∥ 0.3) opens when 0.1 lands + is validated.

- 2026-07-17 — **WP0.1 DONE** · verdict PASS · authoritative post-merge gate green in the
  integration worktree (install 0; `typecheck` exit 0 all 3 projects — proves old shared consumers
  untouched; `test` exit 0 = shared **67** [17 new hub round-trip tests] · api **2329** · web
  **1651**). Additive-only verified (numstat 0 deletions in `types/schemas/constants.ts`); the
  Unified-Sessions contract is **reused not forked** (`RunStatus`/`RunPhase`/`StopReasonCode`/
  `SessionCapabilities`/`SessionCostBasis`/`WaitingInputReason`; grep found no competing
  definitions). **Adjudicated reconciliation (ACCEPTED, not a decision reopened):** `HUB_EVENT_TYPES`
  has **28** members = §1.3's 26 + `queued_user_message` (R-SES3, annex-MUST names a persisted queued
  event) + `ui_state` (R-GUI5, annex-MUST requires per-message UI state event-sourced) — the annex's
  WP-impact map is authoritative and binds both MUSTs to WP0.1; downstream: WP1.1 emits
  `queued_user_message`, WP2.6 emits `ui_state`, WP1.2 SSE forwards both. MUST R-ids covered:
  R-SES1/2/3/4, R-UX1, R-GUI3/5. Merged `--no-ff` → `feat/assistant-hub` **@ 5eea725** (clean 3-way
  vs WP0.4; both present). Worktree removed. **B2 opened** (both gate on 0.1, now merged): **WP0.2**
  (Sonnet, migration [claims **v47**] + repositories → `wp/assistant-hub/0.2`) ∥ **WP0.3** (Opus,
  prompt architecture → `wp/assistant-hub/0.3`), disjoint files (`db/*`+`hub/repository.ts` vs
  `hub/prompting/**`), off `feat/assistant-hub` @ 5eea725.

- 2026-07-17 — **WP0.3 DONE** · verdict PASS · flagship prompt-architecture (D-AH14). NEW
  `hub/prompting/**` (13 layer modules + assemble/budgets/types/version/index); 42 tests + 8
  committed snapshots (chat/research/mission-planner/synthesizer/critic + role variants). Every
  section under its TokenCounter budget (orchestration 855/900, genui 407/450, …). Playbook (doc-04
  §4) elements present + asserted; `HUB_PROMPT_VERSION="hub-prompt-1.0.0"`; typed WP2.6 catalog seam.
  Accepted design note: `mission` split into 3 prompt-assembly modes (planner/synthesizer/critic) —
  faithful to §1.8's explicit 5-mode enumeration; the 3-value `HUB_SESSION_MODES` is unchanged.
  Fence clean (only `hub/prompting/**` + test/snapshots; 0 deletions). Merged `--no-ff` →
  `feat/assistant-hub` **@ 5c37f9c**. **Gate note:** the first post-merge run showed api 2370/1-fail
  under concurrent load with WP0.2's agent — re-run ISOLATED = **2371/2371 pass**, confirming the
  documented parallel-load timing flake, NOT a WP0.3 defect. Owner-acceptance: no live model run
  (this WP emits prompt strings; behavior vs a real provider needs a key). Worktree removed.

- 2026-07-17 — **WP0.2 DONE** · verdict PASS · migration **user_version v47** (13 `hub_*` tables in
  `schema.ts` baseline + v47 `up`; both fresh + upgrade-from-v46 paths tested; inserted before the FTS
  block per repo rule). NEW `hub/repository.ts` (CRUD for all 13 entities + append-only events with
  per-session **monotonic seq** + ordered replay + txn-safe artifact/version); `Hub*Row` types in
  `rows.ts`; 12 test files bumped 46→47 (mechanical, verified equal +/-, no assertion weakened).
  **2 real bugs found+fixed:** artifact FK ordering (insert version before pointing at it) and the
  migration-rewind FK pragma (two-way `hub_sessions↔hub_missions` ref). **Domain isolation
  runtime-asserted** (hub never writes runs/run_steps/run_events/suites — grep + row-count). Accepted
  deviations: test at `test/hub-repository.test.ts` (the api runner is a flat `test/*.test.ts` glob —
  a `src/**` test would never run); `rows.ts` row types (same db layer, additive). Merged `--no-ff` →
  `feat/assistant-hub` **@ c126279**. Authoritative combined ISOLATED gate: typecheck 0; shared **67**
  · api **2389** · web **1651**/5skip, 0 fail. Worktree removed. **B3 opened: WP0.5** (tool registry
  core → `wp/assistant-hub/0.5`), now dep-unblocked (0.1+0.2 done); WP0.3 runs done in parallel.

- 2026-07-17 — **WP0.5 DONE + WAVE 0 CLOSED** · verdict PASS · NEW `hub/tools/**` (11 built-ins
  incl. `tasks.*` [R-SES4]; mcp-bridge + collision namespacing; per-server/tool grants [R-MCP1,
  ungranted absent from context]; deferred/auto loading with the app's TokenCounter measuring real
  savings [R-MCP2 — stub 200-tool CRM: eager 23,200 → deferred 0 → pinned-10 = **95% saved**];
  annotation approval-policy core [R-MCP3, untrusted can only tighten]; 10K/25K output caps + workspace
  spill [R-MCP7]; structured-output validation [R-MCP6]) + `hub/workspace.ts` (traversal+symlink
  guarded, **never executes**). Additive-only: `buildMcpTool` extracted from `testing/tool-bridge.ts`
  (behavior-neutral — testing suite green) + 4 `HUB_*` env knobs in `config/env.ts`/`.env.example`.
  No new dep. Sound scoped decisions (tasks-as-events since §1.3 has no `hub_tasks`; `mission.propose_plan`
  validate-only → WP1.7; `serverTrusted` as caller input, no fabricated column; reused `schema-check.ts`
  vs adding `ajv`). 64 tests. Merged `--no-ff` → `feat/assistant-hub` **@ 47eeacc**. **Wave-0 close gate
  (full): typecheck·test·build·lint all 0.** Worktree removed. **Wave 1 opened — B4: WP1.1** (turn
  engine, Opus, solo — highest blast radius; deps 0.2/0.3/0.5 all merged).

- 2026-07-17 — **WP1.1 DONE** · verdict PASS · NEW `hub/{turn-engine,session-service,capabilities}.ts`
  — the §1.5 pipeline for the 5 AI-SDK kinds (assemble→stream→persist-settled-only→meter→terminal via
  `terminalFor`/`SessionClock`), steering queue [R-SES3], Stop-preserves-work + limit→retry-on-other-
  source [R-SES11], per-message model override + cost basis [R-SES10], phase events [R-UX3], auto-title,
  release-on-reply. Correct scoping: R-MCP5 progress/cancel **UI** → WP1.4 (timeout side wired here);
  R-SES8 compaction hook seam present → WP3.3. US modules **reused not forked** (grep-clean). No new dep;
  no testing-table writes; fence clean (imports `testing/` + reads hub/repo·prompting·tools, modifies
  none). 18 tests. Merged `--no-ff` → `feat/assistant-hub` **@ b4e2109**; isolated gate: typecheck 0,
  test 0 (shared 67 · api **2471** · web 1651/5skip). Worktree removed. **DI seams for downstream:**
  `HubTurnSink{onEvent,onDelta}` (WP1.2) · `HubCitationPostPass`+`HubToolsetResolver` (WP1.4) ·
  `HubSubscriptionExecutor`/`HubModelResolver` branch, subscription = 501-stub until wired (WP1.5).
  **B5 opened: WP1.2** (sessions API + SSE → `wp/assistant-hub/1.2`, owns `hub/routes.ts` + `index.ts`
  mount) ∥ **WP1.5** (subscription adapter → `wp/assistant-hub/1.5`, owns `hub/subscription-adapter.ts`).
  WP1.2 leaves `subscriptionExecutor` at the 501 default; the one-line `index.ts` wiring of WP1.5's
  adapter is an **orchestrator seam-close after both merge** (US pattern) — keeps them disjoint/parallel.

- 2026-07-17 — **[architectural follow-up — NON-BLOCKING, owner-decision candidate]** WP1.1 confirms
  `hub/` imports **4** modules from `testing/`: the mandated US trio (`session-clock`/`session-terminal`/
  `session-capabilities`) **+ `accounting.ts`** (`extractProviderUsage`, `isContextOverflowError`). Per
  README §6 the cross-domain import is the **sanctioned default** (not a fork) — gate green, no
  duplication. The optional neutral-module move (→ `apps/api/src/sessions/`) would touch `testing/`'s
  many importers **and** the (complete) Unified-Sessions ledger, so it is DEFERRED, not done mid-wave.
  Recommend the owner decide whether to schedule a coordinated `testing/`→`sessions/` extraction (would
  also relocate the provider-usage mapping) so both domains import from a neutral home. Recorded per
  README §6 "record the outcome in STATUS."

- 2026-07-17 — **WP1.5 DONE** (standalone) · verdict PASS · NEW `hub/subscription-adapter.ts` —
  `createHubSubscriptionAdapter(deps) → HubSubscriptionExecutor`: `AgentSessionDriver` loop under the
  shared D-CS10 `.runs` semaphore; `queued`-with-position phase; exact tokens from `turn_done.usage`;
  shadow cost `costBasis:"subscription_reference"` (D-AH17); `limit_error`→retry-on-other-source
  (`retrySourcesFor` reused); Stop preserves partial work; settled-events-only; steering at turn
  boundaries. Reuses driver+pool (no fork); 2 files only; no new dep; no testing-table writes; 7
  tests (stubbed driver — no real child). Merged `--no-ff` → `feat/assistant-hub` **@ b8c0a6f**
  (dead code until wired), typecheck green. **PENDING orchestrator seam-close (after WP1.2):** one
  line in `index.ts` → `subscriptionExecutor: createHubSubscriptionAdapter({ repository, driver: new
  SdkAgentSessionDriver(), resolveAuth: <linked-auth>, concurrency: pool.runs })`. Worktree kept until
  seam-close verified.
  **[FOLLOW-UP — non-blocking, WP1.R/owner]** subscription sessions currently carry continuity WITHIN
  a dispatch (steering) but NOT ACROSS separate messages: each dispatch spins a fresh throwaway child
  with only the opener (no `sdkSessionId` resume — the hub schema has no such column). Options: an
  additive `hub_sessions.sdk_session_id` column + resume, OR reconstruct `hub_events` history into the
  child prompt (as the AI-SDK path does via `reconstructMessages`). Deliberately NOT improvised by
  WP1.5 (out of its adapter scope). WP1.R adjudicates / owner decides.

- 2026-07-17 — **WP1.2 DONE + WP1.5 seam-close DONE** · verdict PASS · NEW `hub/routes.ts`
  (projects+sessions CRUD, turns, SSE on the `streamRun` template [id:<seq>, replay-then-live,
  Last-Event-ID resume, ping], stop/end/seen/branch, 409-no-credential gate, startup orphan
  reconciliation) + additive `index.ts` (service construction + mount). 13 tests (real listen+fetch
  for genuine SSE reads). Merged `--no-ff` → `feat/assistant-hub` **@ 4201371**. **Seam-close @ ad93b80**
  (orchestrator, US WP1.7 pattern): moved the `HubSessionService` construction below the subscription
  pool + `assistantAuth` and bound `subscriptionExecutor: createHubSubscriptionAdapter({repository,
  driver: SdkAgentSessionDriver, resolveAuth: resolveJudgeAuth, concurrency: subscriptionConcurrency.runs})`
  — `claude_subscription` hub sessions now run under the shared D-CS10 `.runs` gate (no longer 501).
  Combined isolated gate: typecheck 0 · shared **67** · api **2494** · web **1651**/5skip, 0 fail.
  Worktrees (1.2 + 1.5) removed. **B6 opened: WP1.3** (conversation UI, Sonnet, solo — after 1.2).
  **[FOLLOW-UP — non-blocking, owner/later-WP]** WP1.2 surfaced a WP0.1-contract gap: `HubSession.model`
  is a bare string with no paired credential id, so `createHubModelResolver` disambiguates by name-prefix
  heuristic (claude-→anthropic, gpt-/o<n>→openai, gemini-→google; prefer non-broken; fallback first
  eligible). Works for one-credential-per-provider but misroutes with two same-kind creds or a
  self-hosted `openai_compatible`/`ollama` id. Candidate additive refinement: a per-session/per-message
  `credentialId` binding. Recorded; owner/WP1.R decides.
  **[COORDINATION NOTE]** During WP1.2 a concurrent (owner/mirror) session edited `hub/routes.ts` INSIDE
  the WP worktree mid-task (improved `/end` to check `status==="ended"` specifically, and the branch route
  to use `sessionService.createSession`). The subagent verified both edits correct and kept them; final
  committed branch is coherent (3 files, clean tree, gate green). Flagging that a sibling session is making
  CODE edits in assistant-hub worktrees (not just STATUS prose) — outcome verified good here, but the owner
  should be aware.

- 2026-07-17 — **WP1.3 DONE** · verdict PASS · NEW `features/hub/**` (`use-hub-stream` SSE client
  [replay-then-live · seq-dedup · terminal-only errors, mirrors `use-run-stream`], SessionRail,
  NewSessionDialog mode picker, ConversationPane [ordered typed parts R-SES2 + inline R-UX1 7-state
  tool machine + task widget R-SES4 + context gauge R-SES7], Composer [ModelSelector per-message
  override R-SES10 + queue-while-running R-SES3 + Stop], AssistantView rewired from the WP0.4 scaffold)
  + additive `lib/api.ts` hub client. brand-ui verified vs the LIVE library (nothing missing); tokens-only
  (both themes by construction). **18 files — verified NO stray reformat** (agent self-caught a repo-wide
  `pnpm format` touching 313 files + discarded it; I confirmed exactly 18 owned files, clean tree,
  `api.ts` additive 99+/0−, zero raw colors). 67 tests. Merged `--no-ff` → `feat/assistant-hub`
  **@ c693711**; post-merge gate: typecheck 0 · web **1717**/5skip (181 files) · api 2494 unchanged.
  Worktree removed. Documented deferrals: approve/deny disabled until WP1.4 wires the backend;
  citation/artifact/genui parts render safe placeholders → WP1.4/1.6/2.6; project grouping (recency
  buckets for now) → WP3.1. **[FOLLOW-UP — for WP1.4]** WP1.3 found a real engine gap: a live
  `tool_result` must merge onto the settled `assistant_message`'s otherwise-frozen part; worked around
  client-side in `use-hub-stream.ts` (documented) — WP1.4 (which owns tool-part + citation rendering)
  should confirm the settled-event shape carries the tool result cleanly, or fold the merge server-side.
  **Owner-acceptance:** live both-theme + keyboard walk of `/assistant`. **B7 opened: WP1.4** (MCP +
  citations, Opus → `wp/assistant-hub/1.4`) ∥ **WP1.6** (artifacts v1, Sonnet → `wp/assistant-hub/1.6`),
  disjoint files (1.4: citations.ts·session-service·index.ts·ConversationPane·SourcesPanel; 1.6:
  routes.ts artifact block·ArtifactCanvas·AssistantView).

- 2026-07-17 — **WP1.6 DONE** · verdict PASS · additive artifact route block in `hub/routes.ts`
  (`registerHubArtifactRoutes`: CRUD, versions, export md/html/json + a self-contained dependency-free
  md→HTML renderer + sanitizer) + `ArtifactCanvas.tsx` (`Artifact*`/`MarkdownView`, version list [diff→WP3.5],
  export dropdown) mounted as `ChatShell` aside in `AssistantView` (Show/Hide toggle, collapsed default)
  + additive `lib/api.ts`. **`share.html` self-containment asserted** (R-UX13: no script/external
  link/img/@import, one inlined `<style>`, forced download, version-pinned, citations preserved,
  html-artifact scripts/`onclick`/`javascript:` stripped). Fence clean; brand-ui verified vs live library;
  raw hex only in the sanctioned `share.html`/`format=html` export style (CLAUDE.md exception; check-tokens
  nudge fires by design). 13 API + 9 web tests. Merged `--no-ff` → `feat/assistant-hub` **@ d6e0d19**.
  **[RECONCILIATION @ 1f820fd]** A concurrent-session edit was found UNCOMMITTED in the WP1.6 worktree
  (the agent correctly kept it out — it touches WP0.5's `hub/tools/builtins/artifacts.ts`): `artifacts.
  create/update` built-ins now append the discrete `artifact_created`/`artifact_updated` events (§1.3)
  via `ctx.repository.appendEvent`, making artifacts replayable from `hub_events` alone (**R-SES1** — the
  event-sourcing invariant WP1.R tests). Preserved by the orchestrator as coherent + gate-green + aligned
  (+2 tests). Combined isolated gate: typecheck 0 · shared **67** · api **2512** · web **1726**/5skip, 0 fail.
  Worktree removed. **This is the 3rd sound concurrent-session code edit** (WP1.2 routes, WP1.6 artifacts
  events) — reads as the owner improving the hub as it lands; all verified correct + kept. Owner should be
  aware a sibling session edits assistant-hub code in worktrees.

- 2026-07-17 — **WP1.4 DONE** · verdict PASS · NEW `hub/citations.ts` (§1.7 — `HubCitationLedger`
  single numbering point shared by the tool-exec wrapper + the deterministic `[n]` post-pass; seeded
  from prior `assistant_message.citations[]` via `reconstructCitationBaseline`) + `session-service`
  MCP server-grants v1 (`{server→all}`, ungranted absent from context — R-MCP1) + `index.ts` grant/
  citation wiring (all-scanned-granted, pooled sessions, skip-on-failure); web `SourcesPanel` + all
  MCP-depth rendering in `ConversationPane` (annotation cards R-MCP3, elicitation form/URL R-MCP4,
  progress/cancel R-MCP5, structured output R-MCP6, spill cards R-MCP7, server chips R-MCP11, inline
  `[n]` + Sources + session rail R-UX5). **Resolve-test PASS** (no orphan marker enters `citations[]`
  or renders; no cross-turn drift — 2-turn test locks A=[1], B=[2]). Clean 3-way merge (fully disjoint
  from WP1.6 — no `brand-ai-mock`/`api.ts` overlap). 14 API + 22 web tests. Merged `--no-ff` →
  `feat/assistant-hub` **@ a3f5f27**; gate: typecheck 0 · shared 67 · api **2526** · web **1748**/5skip.
  Worktree removed. **3 GAPS → WP1.R adjudicates (recorded, not blocking the showcase):**
  (1) **Elicitation transport (R-MCP4) incomplete** — full UI + policy built+tested, but there is NO
  elicitation event in the closed `HubEvent` union, no MCP-client handler, no response route (all
  outside WP1.4's fence). Live wiring needs an ADDITIVE shared elicitation event + turn-engine/MCP-client
  handling + a response route. WP1.4 correctly did NOT edit shared. (2) **Engine emission gap** — the
  WP1.1 engine auto-executes tools, so approval-request / progress / spill / annotation-on-part are
  rendered from synthesized parts in tests but NOT yet emitted by a live turn (a turn-engine seam;
  approval-gating matures with the WP2.3 autonomy dial). The **citation path IS fully live**. (3)
  WP1.3's tool_result-merge gap confirmed HARMLESS to R-UX5 (chips resolve via message-level
  `citations[]`, which reaches the UI intact). **B8 opened: WP1.7** (mission v1, Opus, solo — deps
  1.1+1.4 done; the flagship parallel-agent slice completing D-AH15).

- 2026-07-17 — **WP1.7 DONE — D-AH15 VERTICAL SHOWCASE COMPLETE** · verdict PASS · NEW `hub/missions/**`
  (planner: structured `HubMissionPlan` + hard-cap clamp; orchestrator: propose/edit/approve/stop +
  bounded-parallel pool + budget trip + **isolated** agent runner; synthesis: cite+re-number agent
  reports, partial-marked; board: pure replay reducer) + web `MissionPlanCard`/`MissionBoard`. Additive
  seams: 5 mission env knobs, `registerHubMissionRoutes` mount, `index.ts` construction + model seams,
  in-band `ConversationPane` render, mission stubs in `brand-ai-mock`. **Invariants PROVEN by test:**
  context isolation (a `PARENT_SECRET` marker seeded across parent turns + the ask is absent from every
  agent-facing string — D-AH9); budget-trip → clean stop + `mission_synthesis.partial` marked (cap $0.50,
  agents $1 → 1 report, 2 aborted); replay-inert (`reconstructMission(listEvents)`, no I/O — R-SES1);
  citation preservation through synthesis (agentRef stamping + global re-number, every `[n]` resolves);
  R-SES5 auto-title. Sound composition calls (`Plan*`+`Button` — `ApprovalCard` is tool-call-coupled;
  Rive `Persona` skipped). Additive `POST /sessions/:id/mission` propose route (mission creation, since
  `dispatchMessage` maps mission→chat). Shared/db untouched; no new dep; 17 API + 11 web tests. Merged
  `--no-ff` → `feat/assistant-hub` **@ a7f7c5d**; gate: typecheck 0 · shared 67 · api **2543** · web
  **1759**/5skip. Worktree removed. **[FOLLOW-UP → WP1.R]** the mission UI renders read-only from the
  event log, but wiring the propose route + `MissionHandlers` into `Composer`/`AssistantView` so a user
  can TRIGGER a mission is a small follow-up (those files weren't WP1.7-owned). **B9 opened: WP1.R**
  (Wave-1 adversarial review, Opus, read-only + probe-tests) — refutes replay/citation/domain-isolation/
  budget-race invariants + ADJUDICATES the accumulated gaps (elicitation transport R-MCP4, engine
  emission of approval/progress/spill, subscription cross-message continuity, `HubSession.model` credential
  binding, mission-UI trigger, tool_result-merge). Its findings → blockers → owning-WP fixes → re-verify,
  then Wave-1-close build+lint.

- 2026-07-17 — **WP1.R DONE (review)** · verdict PASS-with-findings · read-only + probes only
  (`hub-wp1r-review.test.ts`: 5 passing guards + 2 `.skip` repros) merged → `feat/assistant-hub`
  **@ a636095**, gate green. **Invariants: 4 HOLD, 1 partially refuted.** (1) Event-log reconstruction
  HOLDS; (2) Citation resolve-test HOLDS (LOW fallback edge); (3) Domain isolation HOLDS (runtime probe:
  0 rows in any testing/dock table during a mission+chat; dock = 4-line label change only); (4) Budget
  **PARTIALLY REFUTED (MEDIUM)**; (5) Both-theme/a11y HOLDS (LOW raw-button). See Blockers.

## Blockers (WP1.R findings)

**✅ RESOLVED 2026-07-18 — Wave-1 CLOSED (feat @ `45924bc`, full gate green):**
- BUG-4 (cost-cap), GAP-E (mission user-triggerable), LOW-a11y (SessionRail Button), LOW-cite/INV2
  (citation attribution) — fixes merged (`1.fix-api` + `1.fix-web`); INV2/INV4 probes un-skipped + passing.
- **GAP-A + GAP-B (HITL approval + MCP elicitation MUSTs): owner decided (2026-07-18) → FOLD INTO WP2.3**
  (option a). Built UI cards + WP0.5 policy shells kept; WP2.3 adds the live wiring (event union additions,
  turn-engine HITL interception, decision/response route, MCP-client elicitation handler). Not a Wave-1
  blocker anymore.
- GAP-C (subscription cross-message continuity) + GAP-D (`HubSession.model` credential binding): deferred
  to owner-acceptance / later wave (per WP1.R adjudication).

---

### Original WP1.R findings (historical — resolved above; Wave-1 close WAS gated on these)

**Bounded fixes the orchestrator is driving now (Batch B10-fix):**
- [ ] **BUG-4 (MEDIUM · WP1.7 `orchestrator.ts`)** — total-cost budget cap is INERT when
      `maxParallel ≥ agent-count` (common case): all agents launch in wave 1, the `cursor < spawned.length`
      guard never re-fires → cap never trips, `partial` never marked. Fix: check cumulative cost before
      EACH launch (incl. wave 1) + on completion; un-skip WP1.R's `INV4` repro as the guard.
- [ ] **GAP-E (BLOCKING-showcase · web)** — mission is read-only: `lib/api.ts` has no mission fns, nothing
      calls `POST /sessions/:id/mission` / approve / stop; `MissionHandlers` unwired in `Composer`/
      `AssistantView`. Fix: add mission client fns + wire propose/approve/stop so a user can run a mission.
- [ ] **LOW-a11y (web `SessionRail.tsx:108`)** — raw `<button>` (no `brand-ui-allow`) → use `@elabs-ai/components-ui`
      `Button`/`SidebarMenuButton`. **LOW-cite (WP1.7 `synthesis.ts`)** — deterministic-fallback path leaves
      an agent's malformed raw `[n]` un-remapped → possible wrong-agent attribution (every `[n]` still
      resolves). Un-skip WP1.R's `INV2` repro.

**OWNER DECISION REQUIRED (plan-scope gap — escalated 2026-07-17):**
- [ ] **GAP-A + GAP-B (BLOCKING MUSTs, shared root)** — elicitation transport (R-MCP4) + approval/HITL
      emission (R-UX1 approval state, R-MCP3) are non-functional at runtime: **no Wave-1 WP owned the
      turn-engine human-in-the-loop interception** (it fell between WP1.1 engine + WP1.4 cards). The UI
      cards + WP0.5 approval-policy exist but can't be driven live (engine auto-executes; no
      approval-requested emission, no `waiting_input`-for-decision, no elicitation event in the closed
      `HubEvent` union, no MCP-client handler, no decision/response route). Approval-gating also entangles
      with WP2.3's autonomy dial. **Options for the owner:** (a) build a focused HITL+elicitation fix WP
      now to close R-MCP3/4 + R-UX1-approval live before Wave-1 closes; or (b) formally re-grade those
      MUSTs to a later wave (owner sign-off), keeping the built UI/policy shells. Awaiting owner.

**Deferred (owner-acceptance / later-wave, per WP1.R adjudication — not Wave-1 blockers):**
- GAP-C subscription cross-message continuity (WP1.5; not a Wave-1 MUST; needs live sub).
- GAP-D `HubSession.model` credential binding (WP1.2; single-cred-per-kind works; recommend a paired
  `credentialId` later).
- GAP-F tool_result-merge `citationIds` drop — **verified HARMLESS** (no renderer consumes per-part ids).
- Engine emission of progress-bar / output-cap spill (later-wave; the approval half of GAP-B is the
  blocking part).
- Per-agent-budget enforcement inside the production agent runner (owner-acceptance; needs live provider).

## Owner-acceptance (assembled by WP 4.R; needs live credentials — never faked)

Everything below needs live credentials / a real MCP server / voice hardware / a human browser walk —
**never faked**. Walk script: [`owner-acceptance-walk.md`](./owner-acceptance-walk.md) (9 surfaces).

**Live provider inference**
- [ ] One real session per hub-eligible kind (`anthropic`/`openai`/`google`/`openai_compatible`/`ollama`) — real reply, exact tokens/cost, capability-gated UI per kind
- [ ] Per-message model switch mid-thread shows honest provider + cost basis (`$ est. · subscription`, D-AH17)
- [ ] `claude_subscription`: real sign-in, `queued` under the D-CS10 semaphore, exact tokens, shadow cost marked, limit-error → explicit retry-on-other-source (never silent)
- [ ] Real-model plan/report/synthesis/judge QUALITY (the generateObject/generateText glue is seed-proven; real-model quality is owner-acceptance)

**Research + MCP depth (real registered servers)**
- [ ] Research mode against a real search/fetch MCP server — inline `[n]` citations resolve end-to-end
- [ ] MCP elicitation round-trip against a real eliciting server (form + URL modes, `waiting_input`)
- [ ] Annotation-informed approvals, progress/cancel, structured output, 10K/25K output-cap spill, cross-server tool-name namespacing — against a real server

**Missions & topologies (live models)**
- [ ] A real mission ≥3 agents, mixed models — plan edit, per-agent steer, budget trip, synthesis
- [ ] Each topology live once: parallel · pipeline · debate · best_of_n (blind judge picks a real winner)
- [ ] Subscription-heavy fan-out respects the semaphore; board shows queueing honestly

**Composer / voice / GenUI**
- [ ] `SpeechInput` voice availability in the owner's browser (feature-detected; degrades to disabled-but-visible)
- [ ] A real model emits `present`/`prompt_user` GenUI (charts/forms/tables) that validate, render, round-trip
- [ ] Slash commands, regenerate/branch, `/mcp__server__prompt` argument forms driven live

**Knowledge / files / compaction**
- [ ] Compaction fidelity on a long real thread — constraints never silently dropped; markers expand
- [ ] Multimodal uploads pass through to a capable model; workspace promote-to-artifact; memory propose→save live

**Both-theme + keyboard browser walk (all 9 surfaces)**
- [ ] Chat/research · mission board+plan card (4 topologies) · agents/crews (per-tool grant picker) · projects · memory · usage+context-inspector (charts both themes) · audit (filter+deep-link) · artifacts+review (ChangeReview accept/reject, revert) · cross-cutting (SpeechInput degrade, SR announcements, reduced-motion)

**Hardening**
- [ ] Container restart mid-mission → orphan reconciliation to an honest interrupted terminal
- [ ] `POST /api/hub/maintenance/prune-hub` retention against real sessions/workspaces/files; Docker `/data/hub/**` on a fresh deploy
