# Assistant Hub UX — STATUS

**Workstream:** rebuild the Assistant Hub onto the shell grammar + purpose-built surfaces
(workspace meta rail, sessions table, HR-grade workforce section, scoped memory, usage drill).
**Decisions:** D-HUX1…16 locked 2026-07-18 (see [README.md](./README.md)). **Spec:**
[`assistant-hub-ui-concept.html`](./assistant-hub-ui-concept.html) (r4).
**Branch:** `feat/assistant-hub-ux` (cut from `main` at kickoff).
**Plan:** [`execution-plan.md`](./execution-plan.md) — 24 WPs across Waves 0–4.

> This ledger is **authoritative** for in-flight state. Checklist ticks + append-only log; never
> rewrite history. A Haiku-class bookkeeping agent appends one entry per WP completion/blocker.

## Checklist

### Wave 0 — Contracts & unblockers (∥×4) — ✅ COMPLETE (merged @ `26abe21`)
- [x] WP0.1 Wire contract (memory scope, identity, color, usage shapes) — Opus
- [x] WP0.2 Shell registry + full-bleed mounts for /assistant/* — Sonnet
- [x] WP0.3 Fix silent "Create role" no-op (+ loud validation) — Sonnet
- [x] WP0.4 hub-ux constants module (rail widths, colors, motion, grid) — Haiku

### Wave 1 — Workspace + backend lanes (∥ up to 7) — ✅ COMPLETE (merged @ `feat/assistant-hub-ux`)
- [x] WP1.1 Workspace shell & toolbar (PageShell toolbar, switcher, no frames) — Sonnet
- [x] WP1.2 Meta rail (Progress · Outputs · Context, master toggle, Sheet) — Sonnet
- [x] WP1.3 Chat canvas + first-prompt choreography (reduced-motion safe; WP1.R-A fixed) — Sonnet
- [x] WP1.4 Sessions page (/assistant/sessions table + stats) — Sonnet
- [x] WP1.5 API memory scopes (migration, resolver, effective stack) — Opus
- [x] WP1.6 API usage attribution (group-by, no-agent bucket, reconciliation) — Sonnet
- [x] WP1.7 API identity & crew color (displayName, avatar, chart-N) — Sonnet
- [x] WP1.R Wave review (BLOCKED→fixed): A resolved; B/C tracked; D–J cleared — Opus
- [x] WP1.0s + WP1.8-integ — schema substrate v49 + slot-wiring (orchestrator-inserted)

### Wave 2 — Workforce (∥ up to 7 after 2.1 frame) — ✅ COMPLETE (merged @ `feat/assistant-hub-ux`)
- [x] WP2.0b turn-engine scoped-memory injection (WP1.R-B fix) — Sonnet
- [x] WP2.1 Workforce frame & org rail (tabs, scopes, URL scheme; `h-[46rem]` deleted) — Sonnet
- [x] WP2.2 Directory tab (agent/crew cards, interactions, quick-create) — Sonnet
- [x] WP2.3 Agent profile modal (8 sections; Access w/ per-tool scan costs; no new shared) — Opus
- [x] WP2.4 Crew profile modal (color picker, members, topology/memory slots) — Sonnet
- [x] WP2.5 Org chart tab (@brand/flow, topology-true edges + reusable CrewTopologyGraph) — Opus
- [x] WP2.6 Usage tab (group-by, drill, URL state; resolved rolling-vs-lifetime) — Sonnet
- [x] WP2.7 Memory surfaces (ScopedMemoryList, ProfileMemoryDialog, EffectiveMemoryStack + shared type) — Sonnet
- [x] WP2.8-integ wiring (tab slots + quick-create + Topology + Memory + SessionsView URL filter) — Opus
- [x] WP2.R Wave review: PASS (seeded org via real API; all invariants held; 2 minor + 2 WP4.2 items) — Opus

### Wave 3 — Consolidation (∥×4) — ✅ COMPLETE (merged @ `feat/assistant-hub-ux`)
- [x] WP3.1 Nav 6→4 + legacy redirects + breadcrumbs — Sonnet
- [x] WP3.2 Audit upgrade (toolbar grammar, sticky day groups, agent+crew links) — Sonnet
- [x] WP3.3 Projects detail polish (descriptions, files table, sessions link; `h-[46rem]` deleted) — Sonnet
- [x] WP3.4 Retirement sweep (deleted MemoryView/UsageView/SessionRail/SessionContextPanel/WorkspaceFilesPanel + dead ConversationHeader) — Sonnet
- [x] WP2.R-B follow-up: AgentCard single-click select fix + dead `.text` removed (merged) — Sonnet
- [x] WP3.R Wave review: PASS (all consolidation invariants held; 2 minor D1/H1 fixed inline) — Opus

### Wave 4 — Hardening & docs (4.1 ∥ 4.2 ∥ 4.3 → 4.4) — ✅ COMPLETE (merged @ `feat/assistant-hub-ux`)
- [x] WP4.1 e2e hub flows (stub model server; choreography+reduced-motion, meta rail, sessions, workforce, drill) — Sonnet (individually green in real Chromium; full-suite ordering = CI)
- [x] WP4.2 Visual/a11y pass + owner-acceptance-walk.md — Opus (code fixes + gap docs + walk script done; **rendered both-theme visual walk = the Owner-acceptance line, owner-pending**)
- [x] WP4.3 Docs (user-guide 16, CLAUDE.md row, CHANGELOG, stale comments) — Haiku
- [x] WP4.4 Integration train (full gate incl. build + lint; seeded-org invariants re-covered by the green suite) — orchestrator

## Owner-acceptance (pending, end of workstream)
- Live walk per `owner-acceptance-walk.md` (WP4.2): both themes, keyboard, reduced motion,
  a real session with a provider key (choreography + meta rail live), workforce with a real
  registered MCP server (Access token costs), org chart with ≥2 crews, usage drill on real spend.
- Owner merges `feat/assistant-hub-ux → main`.

## Blockers

- **[WP1.R-A · BLOCKER · ✅ RESOLVED]** WP1.3 reduced-motion hid the greeting + starter chips for a fresh
  session. Fixed (`wp/1.3` @ `c4d98d33`, merged): `prefersReducedMotion` now sets `animate=false` ONLY;
  dock-state is driven purely by the one-time latch. Reduced-motion fresh session keeps greeting + interactive
  starters (`aria-hidden="false"`); history session still instant-docks; non-reduced-motion glide unchanged
  (dedicated test). Verified on the integration branch (EmptySessionIntro 13/13, +4 tests).
- **[WP1.R-B · MAJOR · ✅ RESOLVED (WP2.0b)]** `turn-engine.ts` injected memory flat-global (no scope filter).
  Fixed in Wave 2 as **WP2.0b** (`wp/2.0b` @ `f1534611`, merged → `feat/ahux-w2` @ `03fec22`): injection now
  calls `buildSessionEffectiveMemory(...)` (WP1.5's resolver, same as the Context panel) → the resolved
  most-specific-wins session-scoped stack. 8 tests prove no cross-session leak (project/crew/agent) + old
  profile-only sessions byte-identical (one noted harmless same-kind reorder) + most-specific-wins + display/
  injection parity. Nuance carried to WP2.7: `context-inspector.ts`'s *promptSections* memory-token measurement
  still uses flat `listMemory` (zero effect until scoped-memory UI exists).
- **[WP1.R-C · DEFERRED → WP4.2 · ✅ RESOLVED (WP4.2)]** Floating docked composer (`bottom-6` overlay) cleared the
  transcript with a fixed `h-40` spacer, but the composer height is variable (multi-line/attachments/running Stop)
  — a tall composer could obscure the last message. Fixed: `EmptySessionIntro` now measures the composer wrap via a
  `ResizeObserver` (initial synchronous read + on every resize) and reports the height up; `AssistantView` turns it
  into `composerClearancePx(height)` and passes it to `ConversationPane`'s `composerInset`, which now accepts
  `boolean | number` — a `number` reserves the MEASURED clearance, `true` keeps the old `h-40` fallback until first
  measure / where no ResizeObserver exists (jsdom). New constants + `composerClearancePx` in `lib/hub-ux.ts`
  (+ unit tests); `EmptySessionIntro` height-reporting test (controllable RO mock). Rendered both-theme verify that
  the last message clears at any composer height is in `owner-acceptance-walk.md` §1b (owner-pending).
- **[note · Wave 2/3]** WP1.R (target F) found the 3× `h-[46rem]` fixed frames D-HUX1 targets still exist in
  `MemoryView.tsx`, `projects/ProjectsView.tsx`, `agents/AgentsView.tsx` — correctly out of Wave-1 scope; MUST be
  deleted at WP2.1 (Agents ✅ done), WP3.3 (Projects), WP3.4 (Memory) and checked at those waves' reviews.
- **[WP2.R-B · MINOR · ✅ RESOLVED (WP2.2)]** `AgentCard` single-click select no-op → FIXED (`wp/2.2` @ `b427d58`,
  merged): guard narrowed to `event.target.closest('[role="menu"]')` (Radix's stable ARIA) so card content
  selects but ⋯-menu/portal clicks don't; dead `crewAccentClasses.text` removed. Tests: content-selects,
  menu-never-selects, open unchanged.
- **[WP2.R-C · MINOR · optional WP2.3]** Access footprint under scan-drift: an orphan allowlist tool (removed/
  renamed on rescan) inflates the granted tool COUNT while contributing 0 tokens, with no "not in latest scan"
  warning + no checkbox to remove it. Owner-gated honesty polish.
- **[WP2.R · → WP4.2 · ✅ RESOLVED / DOCUMENTED (WP4.2)]** (a) Org-chart NODE keyboard parity — FIXED: two capture
  handlers on the canvas wrapper (`OrgChartTab.tsx`) sync selection on node focus (→ inspector, mirrors mouse click)
  and open the focused node's profile on Enter/Space (mirrors the mouse double-click), resolving the node id from
  React Flow's stable `.react-flow__node[data-id]` DOM (no canvas geometry, so it's unit-testable — jsdom can't
  render `@brand/flow`); `nodesFocusable` set explicit; inspector empty-prompt updated to name the Enter affordance.
  New pure exports `orgNodeIdFromEventTarget` + `isOrgNodeActivateKey` with tests asserting model/nav (agent→agent
  profile, crew→crew profile, lane→nowhere), not geometry. SkillFlow untouched. (b) Tri-state Access Checkbox
  indeterminate GLYPH — DOCUMENTED as a brand-ui gap (aria `mixed` correct; the "N / M tools" badge disambiguates;
  no upstream change here). See `owner-acceptance-walk.md` Gaps appendix + §3b/§4a for the rendered both-theme walk.
- **[WP2.R · → WP4.1]** e2e workforce flow (quick-create → profile → grant tool → org chart → usage drill)
  authored + selectors verified, but not committed (sandbox lacks Chromium/build); hand to WP4.1.

## Log

- 2026-07-18 — Workstream created from the owner-approved UI concept r4 (interactive audit +
  four review rounds, same day). Decisions D-HUX1…16 locked. Plan authored (24 WPs, Waves 0–4,
  peak parallelism 7). No implementation started. Known input bugs recorded in README (silent
  create-role no-op; autonomy clipping; rail truncation).
- 2026-07-18 — Pre-flight decisions P1–P4 locked in owner Q&A (base branch = `main`, avatar =
  existing icon + color ring (no new wire field), `/assistant/memory` → `/assistant?memory=profile`,
  sessions lifecycle = archive only). Plan + kickoff updated; **no open owner decisions remain —
  the orchestrator can run the entire plan autonomously** up to the final owner-acceptance walk
  and the `feat/assistant-hub-ux → main` merge.
- 2026-07-18 — **Orchestrator run started.** Preflight P1 PASS: `main` (HEAD `d481f38`) contains
  `apps/web/src/features/hub/`, `apps/web/src/components/PageShell.tsx`, `apps/web/src/lib/status.ts`.
  Cut `feat/assistant-hub-ux` from `main` @ `d481f38`; per-wave integration branch `feat/ahux-w0`.
  **Wave 0 dispatched** (4 parallel subagents, isolated worktrees off `d481f38`): WP0.1 wire
  contract (Opus), WP0.2 shell registry (Sonnet), WP0.3 create-role fix (Sonnet), WP0.4 hub-ux
  constants (Haiku). Owned-file sets disjoint. Awaiting completions → per-WP gate re-verify + merge.
- 2026-07-18 — **WP0.1 DONE** (`wp/0.1` @ `103b7df`, merged). Verdict: PASS. Gate: typecheck
  green · shared 74/74 (7 new backward-compat tests 23–29) · lint clean. Files: `packages/shared/src/{types,schemas,constants}.ts` + `hub-contract.test.ts` (additive, +459/−1). Shared is now
  **FROZEN additive-only**. Import surface for Wave 1: vocabularies `HUB_MEMORY_SCOPES`/`HUB_CREW_COLORS`(chart-1…5)/`HUB_USAGE_GROUP_BYS`; types `HubMemoryScope`,`HubCrewColor`,`HubUsageGroupBy`,`HubUsageRow`(key:null+unattributed=no-agent bucket),`HubUsageSummary`; additive fields `HubMemory.scope/scopeId`, `HubAgentRole.displayName` (avatar=existing `icon`, P2), `HubCrew.color`, `HubSession.turns/lastError/archived` (+ patches); memory events carry `scope?/scopeId?`. Blockers: none.
- 2026-07-18 — **WP0.2 DONE** (`wp/0.2` @ `4ce8b31`, merged). Verdict: PASS. Gate (run SERIALLY):
  typecheck green · api 2765/2765 · web 1956 pass · lint clean · EXIT 0. Files: `apps/web/src/App.tsx`
  + `App.test.ts` (+86/−6). Registered all six current `/assistant/*` routes full-bleed in
  `PAGESHELL_EXACT_ROUTES` (D-HUX1); extracted testable `isPageShellRoute()`; no restyle/frame-deletion/nav
  change (correctly deferred to Waves 1/3). Confirmed the perf-budget failures are pure concurrency artifacts.
- 2026-07-18 — **WP0.3 DONE** (`wp/0.3` @ `2564d39`, merged). Verdict: PASS. Gate: typecheck green ·
  web 394/394 (incl. new regression) · lint clean. Files: `hub/agents/RoleEditor.tsx` + `RoleLibraryPanel.test.tsx`.
  Root cause: Create button `disabled={saving||!dirty}` — a fresh draft is non-dirty → button disabled →
  silent no-op. Fix: dirty-gate applies only when editing (`!!role && !dirty`); pristine Create now fires
  `validate()` → inline "Name is required." + toast on failure. Pure front-end; no wire/API change.
- 2026-07-18 — **WP0.4 DONE** (`wp/0.4` @ `fce7b80`, merged). Verdict: PASS. Gate: typecheck green ·
  19 new unit tests · lint clean. File: NEW `apps/web/src/features/hub/lib/hub-ux.ts` (+test). Exports
  (single source, no scattered magic numbers): `META_RAIL_WIDTH_PX=360`, `META_RAIL_SHEET_BREAKPOINT_PX=1100`;
  `CREW_COLORS`/`CREW_COLOR_KEYS`/`crewAccentClasses()` (chart-1…5 accents via `var(--chart-N)`);
  `canvasGridBackgroundStyle()` (1px dots/14px cell/`var(--canvas-grid)`); choreography `CHOREOGRAPHY_DURATION_MS=240`,
  `choreographyTransitionClass()` (transform + `motion-reduce:transition-none`). `--canvas-grid` + `--chart-1…5`
  verified present in `@brand/tokens` (all 4 themes). Blockers: none.
- 2026-07-18 — **WAVE 0 MERGED → `feat/assistant-hub-ux` @ `26abe21`.** Authoritative integration gate
  (serial, unloaded): `pnpm typecheck` green · `pnpm test` = web 1976 pass/5 skip + **api 2765/2765** ·
  `pnpm lint` clean · `pnpm build` all packages ✓. No `.R` review for Wave 0 (unblockers). **Wave 1 opening.**
- 2026-07-18 — **WAVE 1 dispatched** (integration branch `feat/ahux-w1`). Orchestrator seam decisions:
  (a) the hub API is a monolith (`hub/routes.ts` ~2300 lines + `repository.ts`) and two WPs both add a
  DB migration → to avoid a migration-version collision + monolith conflicts, a **schema-substrate
  sub-WP (WP1.0s)** landed ALL Wave-1 additive columns in ONE migration first; DB/API WPs then run
  parallel with disjoint section-ownership. (b) AssistantView slots (`metaRail`/`emptyIntro`) are exposed
  by WP1.1 as optional props (typechecks standalone) and wired to WP1.2/1.3's components at integration.
  **WP1.0s DONE** (`wp/1.0s` @ `3e62e6c`, merged → `feat/ahux-w1` @ `83f2d85`): migration **v49**
  (`hub_memory.scope`+`scope_id`, `hub_agents.display_name`, `hub_crews.color`, `hub_sessions.archived_at`;
  baseline CHECKs; 12 version-lock test files bumped 48→49). Gate: full suite green (api 2767/2767, web 1976,
  build+lint); v49 fresh/upgrade/idempotent tests pass (re-verified on integ branch). Wire untouched.
  **Round 1 (∥, web, from `8a12bc9`):** WP1.1 workspace shell, WP1.2 meta rail, WP1.3 chat canvas — running.
  **Round 2 (∥, DB/API, from `83f2d85`):** WP1.4 sessions page, WP1.5 memory scopes (Opus), WP1.6 usage,
  WP1.7 identity — running. 7 agents in flight.
- 2026-07-19 — **All 7 Wave-1 WPs DONE + merged into `feat/ahux-w1`** (all 7 branches merged with ZERO
  conflicts — section-ownership held). Per-WP: **WP1.1** (`c4b94e7`) PageShell-toolbar rebuild, no fixed
  frames, autonomy-clip fixed, SessionSwitcher, slot contract (`metaRail`/`emptyIntro`/`chatCanvas`, working
  defaults). **WP1.2** (`5b27fbe`) meta rail (Progress/Outputs/Context, master toggle, Sheet fallback; copied
  panel content — no sibling edits; 48 tests). **WP1.3** (`abd6b2e`) dot-grid canvas + centered intro +
  one-time dock choreography. **WP1.4** (`ff56cf1`) `/assistant/sessions` DataTable + session-list stat
  projection (turns/lastError derived, tri-state includeArchived, archive-only PATCH). **WP1.5** (`7b9d3b5`,
  Opus) scoped-memory resolver (order profile→project→crew→agent, most-specific-wins, transparent overridden;
  16+13 tests) + `effectiveMemory` on the context payload. **WP1.6** (`a3fad53`) usage rollups + no-agent
  bucket + reconciliation invariant; fixed a real projectId filter bug. **WP1.7** (`45f5259`) identity/color
  CRUD passthrough + loud validation + null-handling. **Wiring** (`2623861`, WP1.8-integ, Opus) wired the
  real MetaRail/ChatCanvas/EmptySessionIntro into AssistantView (single-composer-host glide) + rehomed the
  context-window gauge into the Context section + light read-only effectiveMemory list.
  **Wave-1 integration gate GREEN** (`feat/ahux-w1` @ `5d67d7e`, serial): typecheck 3/3 · test shared 74 +
  **api 2825/2825** (2 `metrics-perf`/`search-perf` failures were concurrent-load flakes — pass isolated
  p95 49ms/327ms) + web 2075/220 files · build ✓ · lint clean (1259). One integration fix by orchestrator:
  `HubSession.seen` required in 2 meta-rail test fixtures (stale-dist masked it in isolation).
  **WP1.R (Opus adversarial review) dispatched** with the accumulated suspected-defect list: (A) WP1.3
  reduced-motion may HIDE greeting/starters content — a11y; (B) WP1.5 memory exposed-but-not-injected in
  turn-engine — intent check; (C) WP1.8 floating-composer `h-40` clearance estimate; (D) resolver order;
  (E) usage reconciliation; (F) no r1 frames/overflow; (G) old `?session`/`?message` deep links; (H) gauge
  rehomed; (I) status vocab/EmptyState; (J) Combobox a11y name. Merge to `feat/assistant-hub-ux` gated on
  the review passing. Known deferred: `effectiveMemory` type → promote to shared (additive) in WP2.7;
  scoped-memory turn-engine injection = follow-up; usage `summary.totals` rolling-vs-lifetime → WP2.6;
  meta-rail Outputs heavier file flows → Wave-3 retirement decision.
- 2026-07-19 — **WP1.R (Opus adversarial review) verdict: BLOCKED** (`wp/1.R`, read-only, typecheck green).
  CONFIRMED blocker **A** (WP1.3 reduced-motion hides content) → routed to WP1.3 for fix. CONFIRMED gap **B**
  (turn-engine flat-global memory injection) → tracked, gates WP2.7. **C** (floating-composer clearance) →
  deferred to WP4.2. **CLEARED:** D (resolver order/conflict), E (usage reconciliation, all 5 group-bys +
  no-agent bucket), F (Wave-1 frames dead; 3× `h-[46rem]` correctly deferred to WP2.1/3.3/3.4), G (old
  `?session`/`?message` deep links resolve), H (context gauge rehomed + rendered), I (status vocab/EmptyState
  code-level), J (Combobox DOES have an accessible name — WP1.1's claim refuted; only a minor purpose-label
  polish → WP4.2). See Blockers. Wave-1 merge held pending A's fix + re-verify.
- 2026-07-19 — **WP1.R-A FIXED** (`wp/1.3` @ `c4d98d33`) + merged. **Final Wave-1 gate GREEN** on `feat/ahux-w1`
  @ `fe9bc6a`: typecheck 3/3 · web 2079 pass/5 skip (220 files) · api 2825/2825 · lint clean (1259) · build ✓.
  **WAVE 1 MERGED → `feat/assistant-hub-ux`.** Open items carried forward: B (turn-engine injection, gates WP2.7),
  C (composer clearance → WP4.2), the 3× `h-[46rem]` frames (WP2.1/3.3/3.4), Combobox purpose-label polish (WP4.2).
  **Wave 2 (Workforce) opening.**
- 2026-07-19 — **WAVE 2 (Workforce) — WP2.0b + WP2.1 then all 6 Round-2 WPs DONE + merged into `feat/ahux-w2`.**
  WP2.0b (`f1534611`) fixed WP1.R-B (scoped memory injection, no cross-session leak). WP2.1 (`f9bc232`) the
  workforce frame + org rail + node routes (deleted the `AgentsView` `h-[46rem]` frame). Round-2: WP2.2 Directory
  (`1a0e75f`), WP2.3 Agent profile (`44b7174`; reused ScanDetail — NO new shared; relocated nothing), WP2.4 Crew
  profile (`6f19866`), WP2.5 Org chart (`0c8e2c1`; reusable `CrewTopologyGraph`+edge-builder, SkillFlow untouched),
  WP2.6 Usage (`5fbbfa9`; charts Date-x/xDataKey correct; resolved the rolling-vs-lifetime flag), WP2.7 Memory
  (`9a6659d`; `effectiveMemory` promoted to shared, backward-compat proven). **Orchestrator-resolved merge
  conflicts:** `getHubUsageSummary` unified to ONE object-param signature across 2.2/2.4/2.6 (+2 callers +1 test);
  `AgentsView.tsx`/`.test.tsx` unioned the two modal slots. Integration typecheck green; workforce tests 235/235.
  **WP2.8-integ wiring dispatched** (Opus, from `feat/ahux-w2` @ `8cedeaf`): tab slots (directory/org/usage) +
  quick-create + Topology←`CrewTopologyGraph` + Memory←`ScopedMemoryList` + SessionsView URL-filter (WP2.6
  usage→sessions drill gap) + node-route remount check → then WP2.R. Deferred: tri-state Checkbox indeterminate
  glyph (brand-ui gap, WP4.2); node-route remount (WP2.8 verify); `context-inspector` promptSections memory-token
  count still flat (minor, post-WP2.0b).
- 2026-07-19 — **WP2.8-integ DONE** (`67544e4`, merged) + **WP2.R PASS**. Wiring: all 3 tab slots + quick-create
  (+New, loud) + Topology←`CrewTopologyGraph` + Memory←`ScopedMemoryList` + `SessionsView` URL-filter (closes the
  usage→sessions drill); node-route remount proven impossible (one fiber; regression test). WP2.R seeded the full
  org via the REAL API (6 active + 1 archived agents, 2 crews pipeline+debate, multi-crew Carol, unassigned Grace)
  and re-proved every invariant: color-accent rule (`.text` field dead), topology edges incl. no-orphan debate,
  usage `sum(rows)==total` across all 5 group-bys + no-agent bucket, quick-create loud-fail, node-route no-remount.
  Verdict PASS; findings = 2 MINOR (WP2.R-B AgentCard single-click, WP2.R-C Access scan-drift) + 2 → WP4.2
  (org-chart node keyboard, tri-state glyph) + e2e → WP4.1 (all in Blockers). **Wave-2 gate GREEN**
  (`feat/ahux-w2` @ `ba96b5b`, serial): typecheck 3/3 · shared 76 + api 2839/2839 + web 2358/250 files ·
  lint 1330 · build ✓. **WAVE 2 MERGED → `feat/assistant-hub-ux`.** Wave 3 (Consolidation) opening.
- 2026-07-19 — **WAVE 3 (Consolidation) — all 4 WPs DONE + merged into `feat/ahux-w3`** (+ WP2.R-B AgentCard fix).
  WP3.1 (`89fec42`) nav 6→4 (Assistant+Sessions child · Agents & Crews · Projects · Audit) + `/assistant/memory`→
  `?memory=profile` + `/assistant/usage`→`agents?tab=usage` + breadcrumbs. WP3.2 (`8f8eb2c`) audit toolbar grammar +
  sticky day-groups + agent/crew enrichment (name-match, no roleId/crewId on the projection — disclosed) + StatusBadge
  outcomes + one EmptyState + error-retry. WP3.3 (`72b99cb`) projects Descriptions + files DataTable + sessions link +
  deleted the `ProjectsView` `h-[46rem]`. WP3.4 (`f55c55c`) retired MemoryView/UsageView/SessionRail + the absorbed
  `SessionContextPanel`/`WorkspaceFilesPanel` + dead `ConversationHeader` (all grep-proofed zero live imports; bundle
  has no deleted-view chunks). Merge conflict: AuditView.tsx (WP3.4 comment-fixed the OLD view; WP3.2 rewrote it) →
  resolved to WP3.2's rewrite. **Wave-3 gate GREEN** (`feat/ahux-w3` @ `6d12615`, serial): typecheck 3/3 · shared 76 +
  api 2839/2839 + web 2355/247 files · lint 1322 · build ✓ (all 3× `h-[46rem]` now gone). **WP3.R (Opus) dispatched.**
  New minor flags for WP3.R/owner: WP3.1 `isPathActive` prefix-match lights "Assistant" on sibling pages (pre-existing);
  WP3.2 audit name-match identity; residual stale prose comments referencing deleted files (harmless → WP4.3 docs).
- 2026-07-19 — **WP3.R (Opus) verdict: PASS.** Every consolidation invariant held — nav 6→4, full legacy
  redirect matrix (targets consume the params: memory→ProfileMemoryDialog, usage→Usage tab, project→sessions
  `?projectId`), status-vocab conformance (all through StatusBadge/lib/status; the old UsageView MISSION_STATUS_VARIANT
  gone), cross-links resolve, retirement complete (zero live imports of the 6 deleted files; no dead-view chunks),
  all 3× `h-[46rem]` gone. **2 MINOR defects fixed inline by orchestrator** (`842fc64`): **D1** DirectoryTab stacked
  a 2nd EmptyState on a deleted-crew `?scope=crew:<id>` (D-HUX14 single-EmptyState) — gated + regression test; **H1**
  `isNavItemActive` added so the Assistant parent no longer prefix-lights sibling sections (exactly one active nav
  item) — regression test. Re-verified: typecheck green, DirectoryTab+AppShell 29/29, lint clean. **WAVE 3 MERGED →
  `feat/assistant-hub-ux`.** New follow-ups: stale prose comments (`usage-links.ts:26-30`, `AuditView.tsx:88`) →
  WP4.3 docs; OutputsSection dropped WorkspaceFilesPanel's heavier actions (delete-upload / promote-tree-file /
  browse-raw-tree / attach-MCP-resource — conscious D-HUX3 reduction) → **owner-confirm**; memory redirect shows the
  provider "not configured" EmptyState when no provider credential exists (memory is provider-independent — inherited
  WP1.1 gating) → LOW note. **Wave 4 (Hardening & docs) opening.**
- 2026-07-19 — **WP4.2 (Visual/a11y pass) — code fixes + gap docs + walk script DONE (`wp/4.2`); rendered
  both-theme visual walk is OWNER-pending (sandbox has no Chromium — no screenshots taken).** (A) **WP1.R-C
  RESOLVED** — dynamic composer clearance (ResizeObserver in `EmptySessionIntro` → `composerClearancePx` →
  `ConversationPane.composerInset: boolean|number`; `lib/hub-ux.ts` constants; +tests). (B) **WP2.R org-chart
  node keyboard parity RESOLVED** — focus→inspector + Enter/Space→open-profile via `.react-flow__node[data-id]`
  capture handlers (`OrgChartTab.tsx`; new pure `orgNodeIdFromEventTarget`/`isOrgNodeActivateKey` + model/nav
  tests; SkillFlow untouched). (C) **brand-ui gaps documented** — tri-state Access `Checkbox` indeterminate glyph
  (badge disambiguates; no upstream change) + `Combobox` no trigger purpose-label passthrough (confirmed against
  vendored source: 8 props, no aria passthrough) → added a non-clobbering `role="group" aria-label="Session
  switcher"` wrapper in `SessionSwitcher.tsx` (+ regression test); both raised as upstream asks in the walk's Gaps
  appendix. (D) **Static a11y sweep** of the hub surfaces: NO raw colors (crew accents `--chart-1…5` + dot grid
  `--canvas-grid` are token-backed oklch, present in qlik-bright + qlik-dark); NO div-as-button (AgentCard is a
  documented `role="button"` w/ tabIndex+onKeyDown+aria-label; all other clickables are Button/RadioGroup/
  Checkbox+Label); forms use FieldRow/Label + `id` association, autocomplete, ellipsis placeholders. One LOW note
  routed: AgentCard `role="button"` activates on Enter only, not Space (pre-existing; Directory was WP2.R PASS).
  (E) **`owner-acceptance-walk.md` authored** — per-surface click/expect × both themes × keyboard × reduced-motion
  × decoration-minimal, with the 🔑/🔌 provider-key/MCP-server-gated items called out + a Gaps appendix + a sign-off
  checklist. Gate: `pnpm typecheck` green · affected web suites green (hub-ux 24, EmptySessionIntro 15, OrgChartTab
  13, SessionSwitcher 7, AssistantView 19) · full `pnpm test` + `pnpm lint` at commit. Additive wire only (no
  shared/API change). **Owner-pending: the rendered both-theme + keyboard + reduced-motion walk itself** (that IS
  the Owner-acceptance line — see above).
- 2026-07-19 — **WAVE 4 (Hardening & docs) COMPLETE + WP4.4 integration train (orchestrator).** WP4.1 (`5a89c4a`)
  e2e hub flows (choreography+reduced-motion regression, meta rail, sessions→workspace, workforce quick-create→
  grant→org/usage, usage-drill→filtered sessions) — each passed individually in real Chromium; full-suite ordering
  left to CI (2 credential-pool/timing flakes, non-reproduced in isolation); e2e-only, no product source. WP4.2
  (`f5bfa25`) the two deferred a11y fixes (composer clearance via ResizeObserver-measured `composerInset`; org-chart
  node keyboard parity) + brand-ui gap docs (tri-state glyph, Combobox `role=group` label) + `owner-acceptance-walk.md`.
  WP4.3 (`ae45cdb`) user-guide 16 + CLAUDE.md Assistant-Hub row + CHANGELOG + 2 stale comments. All merged into
  `feat/ahux-w4`; only conflict-free merges. **FINAL FULL GATE GREEN** (`feat/ahux-w4` @ `37e5bb3`, serial):
  typecheck 3/3 · `pnpm test` = shared 76 + **api 2839/2839** + web 2367/247 files · `pnpm lint` clean (1322) ·
  `pnpm build` all packages ✓. WP2.R's seeded-org invariants (usage reconciliation across all 5 group-bys +
  no-agent bucket, topology-true edges, memory resolver order) are UNCHANGED in Wave 4 (only e2e + web a11y wiring +
  docs moved) and remain re-covered by the passing suite (`hub-usage-rollup`/`topology-edges`/`hub-memory-resolver`
  tests). **WAVE 4 MERGED → `feat/assistant-hub-ux`. WORKSTREAM COMPLETE — all 24 WPs (+ orchestrator-inserted
  WP1.0s/WP1.8/WP2.0b/WP2.8 + review fixes) done; 4 wave reviews passed.** Remaining = OWNER-ACCEPTANCE only:
  the rendered both-theme + keyboard + reduced-motion + decoration-minimal walk per `owner-acceptance-walk.md` (no
  Chromium in the agent sandbox), the provider-key/real-MCP-server-gated live checks, then the owner merges
  `feat/assistant-hub-ux → main`. New owner-acceptance note (WP4.1 e2e finding): the meta rail renders as an
  always-open, click-blocking Sheet below ~1460px viewport — verify the narrow-mode default-closed behavior / the
  ~1100px `Sheet` breakpoint on the live app (possible follow-up). Open non-blocking follow-ups remain in Blockers
  (WP2.R-C Access scan-drift = owner-gated; tri-state glyph + Combobox label = brand-ui upstream; AgentCard Space
  activation = LOW; OutputsSection heavier-file-actions reduction = owner-confirm).
