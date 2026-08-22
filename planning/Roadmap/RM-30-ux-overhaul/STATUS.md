---
type: "Status Ledger"
title: "UX Overhaul \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Living state for the ux-overhaul plan (source: /UI-UX-AUDIT-2026-07-05.md)."
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-22T11:10:00Z"
status: "active"
---
# UX Overhaul — work-package status ledger · **PRIORITY: HIGH**

Living state for the **ux-overhaul** plan (source: `/UI-UX-AUDIT-2026-07-05.md` (`../../UI-UX-AUDIT-2026-07-05.md`)).
Read and updated **only by the PM agent** (see [`orchestration.md`](./orchestration.md)); sub-agents
never edit this file. A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green on `ux/integration` after merge.

**Legend:** `[ ]` open · `[~]` in-flight (agent spawned; note worktree) · `[x]` done — record date +
branch: `… — done <YYYY-MM-DD> · wp/ux/<id>`. Base branch: `ux/integration` (owner merges to `main`).

**Batch map:** README §Parallel execution map. **Domains:** the phase files are authoritative for
each WP's file domain — the Domain column here is the collision-check shorthand the PM schedules by.

## Phase 0 — P0 hotfixes ([`phase-0-hotfixes.md`](./phase-0-hotfixes.md)) — all parallel — ✅ BATCH A COMPLETE
- [x] WP 0.1 — radar overflow containment (T9a) — done 2026-07-05 · wp/ux/0.1 · `CompareRunsView.tsx` wrapper `max-w-xs overflow-hidden`; radar 576→320px; agent-verified both themes×both widths, no bleed
- [x] WP 0.2 — false "Run completed" toast (S13/T6a) — done 2026-07-05 · wp/ux/0.2 · replay no longer arms the announce gate (`stepAnnounceGate` reducer + 7 tests); Toaster `offset=64` one-liner; behavior locked by unit tests (no live run in seed DB)
- [x] WP 0.3 — route-parent redirects (C1) — done 2026-07-05 · wp/ux/0.3 · `/compare`→`/compare/scans`, `/testing`→`/testing/collections`; servers/scans/skills already had real parent views; app-verified
- [x] WP 0.4 — streamed-text join (T6e) — done 2026-07-05 · wp/ux/0.4 · **API-side per D-UX13**: `joinTextBlocks` in run-service (persisted) + text-block-`id` boundary in engine (live); wire unchanged; 5 new tests
- [x] WP 0.5 — heatmap contrast tokens (S5/CP1) — done 2026-07-05 · wp/ux/0.5 · `-foreground`→`-text` on-tint tokens in `compatibility/meta.ts`; agent-verified both themes × Server×Model + Tool×Model; no upstream gap

## Phase 1 — Foundations ([`phase-1-foundations.md`](./phase-1-foundations.md))
- [x] WP 1.1 — StatusBadge + vocabulary (S3) — done 2026-07-05 · wp/ux/1.1 · `StatusBadge`+`CountBadge`+`lib/status.ts` (18 tests, safe unknown-value fallback closing 0.1's crash finding); ScansView adopt; PM-verified both themes on live Scans (Failed red-fill + Completed green-outline)
- [x] WP 1.2 — PageShell/PageHeader + scroll contract (S16+S22) — done 2026-07-05 · wp/ux/1.2 · **keystone, API approved**: `width: full|centered|master-detail|workbench`, `scroll: content|body`; Settings(body-scroll) + Environments(content-scroll) adopt; App.tsx fullBleed+breadcrumb; title x/y identical (measured); PM-verified both themes
- [x] WP 1.3 — TabPanel + tab unification (S4+S21) — done 2026-07-05 · wp/ux/1.3 · `TabPanel`/`TabPanelContent`/`SplitPane`/`SplitPanePanel`/`TabEmptyState` (10 tests); server-detail rebuilt — **strip stable at 213px across all 6 tabs both themes (measured)**; PM-verified both themes. Server-detail stays on SectionHeader (full PageShell migration → WP 2.2). Removed the offending MetricCard grid (2 sparklines, data retained in trend chart)
- [x] WP 1.4 — TableToolbar + DataTable defaults (S18+S2/S15) — done 2026-07-05 · wp/ux/1.4 · `TableToolbar` + additive `lib/table.tsx` helpers (`navCol`/`actionsCol`/`pinnedCellClass`/`stickyScrollTableProps`/`shouldPaginate`) (19 tests); Scans-list adopt; agent-verified 18 scans + sticky header both themes; PM-verified toolbar shell both themes
- [x] WP 1.5 — Modal tiers (S17) — done 2026-07-05 · wp/ux/1.5 · `dialogs/` 4 tiers (Confirm/Form/Wide/Workbench) + DialogSection/AdvancedGroup + S17 rule doc (20 tests); skill-delete→ConfirmDialog (**lives in App.tsx**, agent followed reality); PM-verified ConfirmDialog both themes
- [x] WP 1.6 — Form primitives (S19/S11/S12) — done 2026-07-05 · wp/ux/1.6 · `form/` 7 primitives + numeric helper (47 tests); no brand-ui Slider gap (Slider+NumberInput exist); jsdom+token-verified (pixel deferred to Phase 2 wiring)

## Phase 2 — View migrations ([`phase-2-view-migrations.md`](./phase-2-view-migrations.md)) — all depend on 1.1–1.6 ✅
- [x] WP 2.1 — Dashboard (D1–D4) — done 2026-07-05 · wp/ux/2.1 · title "Dashboard"; 8 single-metric KPIs; "Needs attention" list (StatusBadge+Scan-now+Open); **Δ-vs-previous column** (client-computed, not deferred); unscanned footnote; PM added /dashboard to PageShell set; PM-verified both themes
- [x] WP 2.2 — Servers area (SV1–SV9, F10) — done 2026-07-05 · wp/ux/2.2 · SV1-8/S6/S14/F10 (D-UX15: SV5 ResourcePromptRun + SV6 ToolRunner); delete→ConfirmDialog; deep-link OK; SV9 → done in 2.9; **PageShell master-detail deferred → 2.2b**; agent-verified both themes×widths
- [x] WP 2.2b — Servers PageShell master-detail adoption — done 2026-07-05 · wp/ux/2.2b · ServersView SectionHeader→PageShell width=master-detail; **title top=66 identical to Settings/Dashboard/Skills** (S16); rail preserved, tabs unchanged; PM marked /servers + /servers/ (D-UX14). Finding: SkillInspector still uses SectionHeader (h2, no h1) → Phase 5 sweep
- [x] WP 2.3 — Scans + Compare-scans (SC1–3, C2–5, F7) — done 2026-07-05 · wp/ux/2.3 · master-detail PageShell (in-view split); SC1-3 (SC3 crumb timestamp by PM); C2-5 (green/red diff D-UX9); **zero-diff→"No differences" empty state**; F7 Latest+swap; PM marked /scans+/scans/+/compare/scans; agent-verified both themes×widths
- [x] WP 2.7 — Environments editor rework (T10, F3, S19) — done 2026-07-05 · wp/ux/2.7 · WideDialog two-column + footprint rail; all F3 rows (Slider/Bounded/Segmented/dependent-field); round-trip no-diff (unit+live); agent-verified both themes×widths; SliderNumber default-marker clip fixed by PM foundation touch-up
- [x] WP 2.9 — Compatibility (CP2–5) — done 2026-07-05 · wp/ux/2.9 · sticky header+first-col (DOM-proven under overflow); ModelPicker (CP3); legend tooltips; StatusBadge severity; SV9 passive legend; PM added /testing/compatibility + Home breadcrumb; PM-verified both themes. S20 tool deep-link partial → 3.3 (needs ?tool= param)
- [x] WP 2.5 — Run console (T6b–f, F9, S8) — done 2026-07-05 · wp/ux/2.5 · Locked chip (T6b); S8 metric de-triplication + no sparklines; Analytics turn-axis bars (T6c); tool-JSON `overflow-x-auto` (T6d); review-mode open-at-top + jump-to-top (T6f); rail stacks <1200px. **Acceptance (no-rail-shift + open-at-top on run 9JThX…) NOT live-verified — no provider key; → owner-acceptance walk.** Structurally verified + gate green
- [x] WP 2.8 — Skills post-update (K1–K11, D-UX1/D-UX2) — done 2026-07-05 · wp/ux/2.8 · K6/K7 owner-locked exact (4th source tile + ScaffoldFromServerWizard; collisions→list footer); K1/K2/K5/K8/K9/K10 done; K3 horizontal layout+docked legend (minor RF fit residual); **K4 code-complete, trace visuals need live run → owner-acceptance**; K11 closed by PM marking /skills (D-UX14 rail variant **verified working** both themes); PM-verified both themes
- [x] WP 2.10 — Settings + ThemeSwitcher (ST1–4, F0/F2) — done 2026-07-05 · wp/ux/2.10 · top-bar Theme control + demoted icon Refresh (F0); System-first mirror (ST1/ST2); judge Model credential-filtered combobox (F2/S19); Storage&maintenance card behind ConfirmDialogs (ST4); composed a controlled DropdownMenu (raw brand-ui ThemeSwitcher is uncontrolled); PM-verified both themes + from-anywhere switch
- [x] WP 2.4 — Runs feed (T1–4, S2, G8 grouping) — done 2026-07-05 · wp/ux/2.4 · PageShell feed; row-click Open/Re-run (T1); rollup badge (T2); one Type tag (T3/S9); toolbar+group-by test/env+totals strip (T4/G8); **pinning HELD** (S2). PM marked /testing/runs + applied 3 shell fixes from findings: AppShell `min-w-0`, RunBar S3 vocabulary, (1.4 pin bg-token param → close-out). Suite checkboxes → 4.6 seam (`?suiteRunIds=`)
- [x] WP 2.6 — Collections + test editor + launcher (T5, T7, T8, D-UX11) — done 2026-07-05 · wp/ux/2.6 · **D-UX11 Local can't bind (disabled+explained)**; T7 (collection breadcrumb name wired by PM, badge dupe dropped, tooltip); TestEditor→WideDialog 4 sections + chip pressed-state + TagInput/Segmented/JSON-escape (T8/F5); launcher list-search+"N of M"+BoundedNumber cost-cap+disabled-with-reason at 771px (T5/F4); RunLauncher props backward-compat. PM marked /testing/collections + wired collection-name breadcrumb (collections state); PM-verified both themes. G7 cost estimate → WP 3.5

## Phase 3 — Workflow & cross-links ([`phase-3-workflows.md`](./phase-3-workflows.md)) — Phase 2 ✅
- [x] WP 3.1 — scan Δ + diff-vs-previous (G3) — done 2026-07-05 · wp/ux/3.1 · **no API change** (client Δ from ScanSummary); Δ column + "Diff vs previous" pre-filled `/compare/scans?serverA&scanA&scanB` on Scans list/detail/server-tab; **amber-growth/green-shrink per D-UX9** (WP text said red; D-UX9 wins); Δ-math exact (22,436→45,264). Domain expanded to ServersView (Scans-tab, D-UX13-style, no conflict); agent both themes. 1100px master-sliver clip = pre-existing S1/S2
- [x] WP 3.2 — console review mode + cross-rep links (G9/S20/G12) — done 2026-07-05 · wp/ux/3.2 · turn index rail, context jump-to-turn, error-card→chat+trace, Chat↔Trace anchors, grade-"—"→Settings link; **agent SEEDED run 9JThX… + live-verified error→failed create_data_object both themes** (closes the owner-only gap for this WP). brand-ui gaps: BarChart no per-bar onClick, @elabs-ai/components-ai AgentStep li (chat anchor at turn granularity)
- [x] WP 3.5 — launcher cost preview (G7, D-UX12) — done 2026-07-05 · wp/ux/3.5 · additive `GET /api/estimate/run-plan` (contract-first, +9 api tests); launcher "≈ tokens · $ range (estimate)" + unpriced label + uncapped warn; 2×2×2 live-verified both themes; RunLauncher props unchanged
- [x] WP 3.3 — skills usage panel + test-this-skill (G11/S20) — done 2026-07-06 · wp/ux/3.3 · additive `GET /api/skills/:id/usage` (+3 tests); Overview usage panel (env chips + recent runs + honest zero state); "Test this skill…" pre-seeds launcher via additive `RunLauncherIntent {kind:"environments"}` (backward-compat); instructive Trace empty-state; agent both themes
- [x] WP 3.4 — operational dashboard (G1) — done 2026-07-06 · wp/ux/3.4 · "Since your last visit" deltas (localStorage stamp + 3.1 helper) + evolved attention queue (inline failed-scan errors) + biggest-movers (one-click Diff); honest "No changes since <date>"; inventory KPIs below; agent both themes×widths

## Phase 4 — Compare Workspace ([`phase-4-compare-workspace.md`](./phase-4-compare-workspace.md)) — depends 2.4✅, 2.5✅
- [x] WP 4.1 — workspace shell (H2/H3, T9b/d/g) — done 2026-07-06 · wp/ux/4.1 · `compare/` folder (CompareWorkspace/CompareBar/VerdictBand/RunLetterBadge/useCompareState/compare-runs + mode stubs); Ⓐ/Ⓑ/Ⓒ sole identity; URL round-trip (add/remove no-scroll, reload restores); **radar deleted (D-UX10)**; live-verified both themes. Runs "Compare" = header button (not literal tab; PageShell catalog). Mode props: `RunModeProps{runs,baselineId,data,focus,onFocus}`
- [x] WP 4.2 — Summary mode (T9e–h, G13.3–4) — done 2026-07-06 · wp/ux/4.2 · Δ-matrix (value+Δ%, absolute↔per-turn, honest peak-context, Quality→grades), H3 verdict sentences (token-slice), grouped delta-bar panel + Date-x context curves; **aborted pair→⚠ no fake winner** (neutral Δ on abnormal), completed pair→recommendation; **deleted compare-derive/curve (D-UX10 done)**; live both themes×widths (+16 tests). Verdict renders in SummaryMode (shell hardcodes null; deriveVerdict ready if band-pinning wanted)
- [x] WP 4.3 — Flow mode: trace diff + lenses (H4) — done 2026-07-06 · wp/ux/4.3 · LCS step-align (turn anchors + tool:name:args) via console `buildTimeline` (3.2, `GET /api/runs/:id`); divergence marker, gap tints, changed-outcome amber+popover, event blocks, Tools/Skills/Cost lenses; grid-locked synced scroll; live both themes (2- & 3-lane, +8 tests). Spec fix: data source is `GET /api/runs/:id` not the turns POST
- [~] WP 4.4 — step drawer + lossless drill loop (H5) · Depends 4.2✅, 4.3✅ · Domain: compare/* (drawer + focus wiring) + console back-pill · Size M–L · **solo** · **Batch H r3** · wt-ux-4.4
- [x] WP 4.5 — change markers + next-steps cards (H6/H7) — done 2026-07-06 · wp/ux/4.5 · scan-change (scan-timeline **proxy** — RunDetail has NO scanId, agent verified + adapted) + skill-version + loading markers → pre-filled diffs; 4 next-step rules (deferred-win→env, failing-tool→playground, unused-skill→trace, export-baseline); verdict reasons now focus Flow (closes 4.4 gap); live both themes (+14 tests)
- [x] WP 4.6 — suite compare (G13.6, T9c) — done 2026-07-06 · wp/ux/4.6 · verdict strip (pass-rate/mean-grade/cost deltas) + test×env grid (green/red, errored=red cell, no ✓-on-ties) + **cell→member-run drill** (opens run workspace); client-side MD export; web-only; live both themes (+9 tests). PM fixed a merge-interaction (4.5 made CompareData.scans required → 4.6 test mock)

## Phase 4 — ✅ COMPLETE (all 6 WPs). Compare Workspace rebuilt per audit §H; radar deleted (D-UX10).

## Phase 5 — Acceptance ([`phase-5-acceptance.md`](./phase-5-acceptance.md))
- [x] WP 5.1 — program verification sweep → [`verification-report.md`](./verification-report.md) — done 2026-07-06 · wp/ux/5.1 · 5 PASS / 2 PASS-caveat / 2 PARTIAL; gate green; 4 small failures found → **WP 5.1a** scheduled before 5.2; owner-acceptance items (no provider key) confirmed
- [x] WP 5.1a — verification follow-ups — done 2026-07-06 · wp/ux/5.1a · S16 breadcrumbs on all top-level roots (Dashboard=home, no crumb); Compatibility + Skills-detail promoted to PageHeader (page h1); S3 step chips routed through `deriveStatusView` ("ok"→Completed/"error"→Failed). Accepted-minor (logged, not fixed): Skills Overview renders the SKILL.md body `#` as a 2nd h1 (K1 markdown-hierarchy consequence — page-title h1 is correct); `/servers` empty-state (0 servers) has no h1 (transient, auto-selects when servers exist)
- [x] WP 5.2 — docs close-out — done 2026-07-06 · PM-run · CLAUDE.md capability row added; UI-UX-AUDIT top addendum ("✅ Implemented 2026-07-06 … owner-acceptance pending"); ledger finalized; owner-acceptance checklist handed off. **Owner acceptance walk itself is unchecked below — the owner runs it live.**

## Phase 6 — Owner-acceptance remediation (2026-07-06) — the owner's live walk on REAL data found 8 defects the seeded/structural verification missed (esp. scroll-under-real-overflow, which 5.1 flagged as unable-to-force-at-seed-size)
- [x] WP 6.1 — done 2026-07-06 · **Scroll contract + tab strip (FOUNDATIONAL keystone)** · PageShell `scroll="fill"` mode (content region `min-h-0 flex-1 overflow-hidden flex-col`, fills viewport, NO outer scroll — inner owns scroll) + TabPanel **full-width bar, centered tabs (D-UX16)** + body inner-scroll + SplitPane pane inner-scroll · Domain: components/PageShell,TabPanel,SplitPane (+ScrollableTabsList) + ref-adopt ServersView server-detail · fixes #1,#6(tabs),#5/#1/#2(scroll root) · **Batch J r1**
- [x] WP 6.2 — done 2026-07-06 · wp/ux/6.2 · Scans master-detail inner-scroll (list-pane + detail-table each scroll internally, frame fixed — CDP-measured under 61-tool/45-scan overflow); scan-detail tabs → full-width centered TabPanel · Scans + scan-detail scroll/split (#2) · SplitPane list-left/table-right each scroll internally, frame fills viewport; scan-detail tabs · Depends 6.1 · Domain: features/scans · **Batch J r2**
- [x] WP 6.3 — done 2026-07-06 · wp/ux/6.3 · Runs table fills-to-bottom + sticky-header internal scroll (toolbar/totals fixed, measured); console tabs → full-width centered TabPanel, streaming contract preserved · Runs table fills to bottom (#5) + Run console scroll (#6) · table fills available height & scrolls internally (not whole-panel) · Depends 6.1 · Domain: features/testing RunsView + RunConsole · **Batch J r2**
- [x] WP 6.4 — done 2026-07-06 · wp/ux/6.4 · Scans-compare boxes→compact ScanCompareBar (letter chips + swap + Latest + inline Δ); scroll=fill (fixed bar, inner table scroll); tabs centered; ?serverA/scanA/scanB preserved · Scans-compare rebuilt on the runs CompareBar pattern (#3) · drop the two big selector boxes; compact bar like /testing/runs/compare · Depends 6.1 · Domain: features/compare/CompareView · **Batch J r2**
- [x] WP 6.5 — done 2026-07-06 · wp/ux/6.5 · Skills Usage → its own tab (environments + runs DataTable + Test-this-skill + zero state); Overview leads with L1/L2/L3 footprint again · Skills: Usage → its own tab (#4) · move usage panel out of Overview into a "Usage" tab listing the runs the skill was used in · Depends 6.1 (TabPanel stable) · Domain: features/skills · **Batch J r2**
- [x] WP 6.6 — done 2026-07-06 · Environments editable (#7) · WideDialog dirty-guard misfires — adding a skill instantly prompts "discard"; fix false-dirty + make properly editable · Domain: features/testing/EnvironmentEditor · **Batch J r1**
- [x] WP 6.7 — done 2026-07-06 · Remove the Settings theme mirror (#8) · theme now lives in the top bar; drop the duplicate Settings control (overrides ST2 "keep a mirror") · Domain: features/settings · **Batch J r1**

## Phase 7 — Skill Studio ([`phase-7-skill-studio.md`](./phase-7-skill-studio.md)) — owner-directed rethink of the shipped Skill IDE (audit SI1–SI8 + §I; D-UX17). Depends 6.1. Batch: 7.1 ∥ 7.2 → 7.3 → (7.4 ∥ 7.6) → 7.5
- [x] WP 7.1 — Studio register & shell — **done 2026-08-21 · `wp/roadmap-cleanup/rm30-7.1` (6 commits, merged) · 20 files · +41 tests.** NEW `features/skills/studio/` (`StudioShell` · `StudioLeftRail` · `StudioContextPanel` · `SkillStudioView` · `SkillFlowPreview` + pure `studio-url.ts`/`studio-layout.ts`), one `<Route path="/skills/:skillId/studio">` and one `ASSISTANT_ROUTE_MANIFEST` entry (`surface: "skill"`, `pin: "skill"`, not addressable). The Inspector's Design tab is a read-only preview + "Edit in Studio"; the SI13 header save cluster and the WP 4.2 dirty-nav guard are deleted.
      **Measured in a real browser at 1600×1000, both themes** (the builder served its own build on `:8188` against an ISOLATED database copy — the live `data/` was never opened): centre **977px = 61.1%** with both rails open, 1128px (70.5%) with the context panel collapsed, 1278px (79.9%) with both; the Exit button sits at y=59 in every state and the page never scrolls in either axis. `?mode=` observed on the live URL after clicking Split.
      **⚠️ Acceptance item "Inspector shows no save bars anywhere" is PARTIAL, and the orchestrator ACCEPTED the partial deliberately.** Seven of nine inspector tabs carry zero save/discard controls and the header cluster is gone; **Overview's "Save as new version" and Files' "Discard / Save…" remain**. Deleting them now would remove the only way to edit a skill's keywords and files, because their replacements are WP 7.3 (the settings panel + draft store) and WP 7.4 (editable files in the Studio) — both of which name those exact deletions as their own steps. Meeting the letter of 7.1's acceptance would have been a functional regression, so the debt is recorded on 7.3 and 7.4 instead of hidden here.
      **Domain correction, declared by the builder rather than buried:** "move the editor mount into the centre" cannot be done without opt-in props on the editor, so five files outside the declared domain were touched **additively and default-off** — `design/{UnifiedEditor,ProblemsPanel,SkillDesignView,ToolsPalette}.tsx` and `workspace/WorkspaceTree.tsx`. Every existing mount renders what it did before.
      **Three defects the browser found that the test suite could not** — worth reading before the next Studio WP: (1) **two of everything** — the editor's own three-pane surface plus the Studio rails gave a Tools palette and a details panel each; fixed by PORTALLING the editor's side panels into the rails, because the obvious host-state approach loops (`Maximum update depth exceeded`); (2) **the centre missed its own bar and the tests said pass** — rail widths were declared in px assuming a 16px root, but the design system's root is ~13.125px, so `w-60` paints at 197px and both-rails-open measured **937px = 58.6%**; `studio-layout.ts` now derives every px from the rem in its own Tailwind class names; (3) the brand `ScrollArea` sizes its Radix viewport to CONTENT, not container, so the file tree overflowed its rail with hard clipping — **the third instance of this upstream bug in this repo** (ProblemsPanel SI15, now WorkspaceTree) and worth raising upstream.
      **Teeth:** eleven mutation probes, each turning the suite red (context panel default-open, `?sel=` not written / not seeded, `?file=` not written, problems rendered twice, mode toggle duplicated, flow panels not hosted, exit ignoring dirty, the inspector re-hosting the save cluster, an editable Files rail, over-wide rails). The first pass had a hole — `?sel=` was tested only in the read direction — and the builder rewrote the canvas stub to honour both halves. **The orchestrator re-probed independently**: forcing `requestExit` past its dirty check turns the suite red, reverted after. Gate green on `main` after the merge: shared 269 · illustrations 834 · cli 87 · api 3678 · web **363 files / 3984** · build · lint.
      **Not verified:** **no human has used it** — every visual claim is a headless-Chromium screenshot plus `getBoundingClientRect`. No screen reader was driven (labels/roles/focus rings were checked programmatically, and a live tab-through reported a focus ring at every stop). The Studio was never exercised **against a bound MCP server**, so the Tools palette was only ever seen empty. **No save was ever completed** — only the dirty→discard path. `?file=` round-trips and drives the rail but does not yet change the centre; that is WP 7.4.
      **One thing for the owner's eye:** the Design tab now offers "Edit in Studio" twice (page header + the preview's own). Both are defensible — one always present, one contextual — but it is a judgement call · Domain: NEW features/skills/studio/ (+App.tsx route line) · Size L
- [x] WP 7.2 — Canvas repair (SI4) — done 2026-07-06 · **direct-tree (no branch; Cowork PM session, .git outside mount)** · Root cause: `@elabs-ai/components-flow` FlowNode HARDCODES top/bottom handles (upstream gap — raise: FlowNode should honor source/targetPosition; FlowEdge needs smoothstep) → app wrapper now owns LEFT target/RIGHT source handles + smoothstep `SkillFlowEdge` + `resolveFitViewport` (zoom clamp ≥11px labels, start-anchored fit so rank 1 never clips) + accessories moved to owner's next column; 19 layout tests · typecheck/lint green, 373→387 web tests green (sharded, 45s VM cap) · **visual walk pending (owner)**
- [x] WP 7.3 — Skill-settings panel + one draft store — **done 2026-08-21 · `wp/roadmap-cleanup/rm30-7.3` (4 commits, merged `36f04a9`) · 25 files (+2,741 / −1,023) · +13 mutation probes.**
      A skill's name, description, **bound servers**, trigger keywords and `/command` entry points are edited by form controls in ONE left-rail panel, and the author never types YAML. Everything writes **one draft**: the Code view reflects each change as it is made, one dirty count spans settings + canvas + hand-typed edits, and one button — labelled **"Save as v5"**, naming the version it will create — turns the lot into a single new immutable version (a test asserts **exactly one** `save-draft` POST).
      **D-UX18 is CLOSED**: binding a server no longer saves a version the instant you click Bind — it stages on the same draft. The picker also gained the half SI1 was missing: a registered server with no scan offers **"Scan now"** inline.
      **7.1's inherited debt is PAID**: Overview is mutation-free — its keyword editor and "Save as new version" button are gone, and its Servers card is a report with an "Edit in Studio" link. The Tools palette is about tools again ("Bind a server in Settings →", deep-linking `?rail=settings`).
      **A real corruption bug in the SHIPPED 7.3a engine was found and fixed:** a block-scalar value (`description: >`) was classified as a plain scalar, so rewriting it would have replaced the `>` and orphaned the folded lines beneath. Now refused like every other shape the engine will not touch — caught by a test, not by inspection.
      **Probes: 13, and two were honest misses first** — #2 passed because another op in the batch masked it (a frontmatter-only save test was added, then it went red), and #13 passed because the probe froze a pre-load empty document. The orchestrator re-probed independently: stripping the settings transform out of `save()` turns **2 tests red**; reverted.
      **Merge conflict resolved by hand, both sides kept:** RM-36 WP 2.2's `max-h-full` on the Servers tile (its P2-5 content-sizing fix) landed on `main` while this branch was open, and the merged file carries it *with* this WP's read-only comment, with a note saying why.
      Gate green on `main` after the merge: shared 269 · illustrations 834 · cli 87 · api **3700** · web **369 files / 4068** · build · lint.
      **Declared domain corrections** (additive, each behind existing tests): `design/frontmatter-servers.ts` generalized (its 45 existing tests unchanged as the regression proof), `design/use-skill-draft.ts` gained an optional save transform, `UnifiedEditor` consumes the shared draft via context, `ToolsPalette` lost its binding block, `BindServerDialog` gained optional `onScan`, `SkillBindingsPanel` gained `readOnly`.
      **Deliberately left for 7.7:** the editor toolbar keeps its own "Add command"/"Add section" buttons — they stage the SAME ops on the SAME draft, so there is no split brain, and 7.7 names their removal as its own step.
      **Not verified: no browser was opened.** No visual check in **either theme**, and no keyboard/focus pass over the panel, the picker, the chip editor or the command rows — every UI claim is jsdom. **No save against a live API and no real bound MCP server**: the picker, the chips, the tool counts and "Scan now" met only mocks, and `POST /api/servers/:id/scan` has never actually run from the Studio. Long-description wrapping, the panel at the shipped ~184px rail width, and how it reads with many servers or keywords are unmeasured · Domain: studio/settings + draft store · Size L
- [x] WP 7.3a — **Server-binding UI in ToolsPalette (SI1 closed)** — done 2026-07-06 · direct-tree · bound-server chips + × (ConfirmDialog) + "Bind server…" picker (registered servers · transport · scan StatusBadge · disabled already-bound/ambiguous); hand-YAML empty-state instruction DELETED; pure `frontmatter-servers.ts` (45 tests, byte-exact round-trip) + `bind-server-candidates` (5) · **Deviation D-UX18:** bind/unbind saves an immediate new version via the SAME `POST /api/skills/:id/save-draft` path the editor uses (no `set_servers` op exists in the shared zod op vocabulary; shared/ out of session scope) with dirty-guard so the two save paths can't race — re-point at the 7.3 draft store when it lands · typecheck/tests/lint green · **visual + live-bind walk pending (owner)**
- [x] WP 7.4 — Editable files + multi-tab editor — **done 2026-08-21 · `wp/roadmap-cleanup/rm30-7.4` (`d1de0e0` · `0c1d31d` · `71367a2`, merged) · 15 mutation probes, all red · no wire change, no `packages/shared` change, no migration, no new dependency.**
      Files join **the same one draft** WP 7.3 built (`files` / `fileOps` / `manifestDirty` fold into `dirty`, the pending-lines summary, `save` and `reset`), so a file change and a manifest change are one dirty count and one "Save as vN" producing one new immutable version — proved end to end by driving the real route: New file in `references/` → type into it → reference it from SKILL.md in Code view → "2 unsaved changes" → **exactly one** `save-draft` POST whose `treeOps` carries the typed bytes. The centre gained tabs (SKILL.md's tab **cannot be closed**; Flow/Split are disabled on a plain file tab, which the toolbar now says), and the Studio's Files rail is editable.
      **7.1's second inherited debt is PAID**: the Inspector's Files tab is browse-only, its Discard/Save… bar is deleted, and `SaveWorkspaceDialog.tsx` is **deleted** — with a guardrail row moved from the ratchet list to a new *"deleted, must stay deleted"* check, so recreating it goes red. `SkillFileExplorer` shrank 509 → ~160 lines.
      **One scope call beyond the spec's letter, flagged for the owner:** the builder also **deleted** the server-bindings strip from the Inspector's Files tab rather than making it read-only, because it was a THIRD save path onto the same skill (it POSTed `save-draft` itself) and Overview already carries WP 7.3's read-only Servers card. Defensible, but it is judgement, not the spec.
      **A second UX call worth overturning if you disagree:** closing a tab is ONE control at the end of the strip acting on the active tab, not an × per tab — a `TabsTrigger` renders a `<button>`, a button inside a button is invalid markup with no accessible resolution, and sibling close buttons inside the `tablist` would double every tab stop and fight Radix's roving focus (the same reasoning `WorkspaceTree` already documents for its per-row actions).
      **Teeth: 15 probes, every one red**, incl. re-adding a `Save…` to the Inspector Files tab, restoring `readOnly` on the Studio rail, recreating the deleted dialog, and making SKILL.md's tab closable. **Two fixture weaknesses were found by probing rather than assumed away**: the SKILL.md-filter test now first asserts the raw derivation *would* have emitted the op (otherwise the filter passes over an input it never sees), and the mode-toggle tests had to switch back to the manifest **before** pressing "Show code", because a Radix single ToggleGroup deselects on a click of the already-selected value — the original ordering silently never changed the mode. The orchestrator re-probed independently: dropping the SKILL.md filter from `studioFileOps` turns **3 tests red**; reverted.
      Gate green on `main` after the merge: shared 279 · illustrations 834 · cli 87 · api **3729** · web **373 files / 4138** · build · lint.
      **Not verified — no browser was opened.** The tab strip, its unsaved dot, the disabled Flow/Split, the "Read-only" badge and the file editor pane have **never been seen rendered**, in either theme, and there was no keyboard or screen-reader pass. **No save has ever been completed against a live API**, and the Studio still has never met a bound MCP server (unchanged since 7.1). Binary preview and file upload reach unchanged code but no test here covers them. **One design bet that jsdom cannot test**: the SKILL.md pane is `hidden`, not unmounted, while a file tab is active — Monaco's `automaticLayout` and xyflow's ResizeObserver *should* re-measure when it returns; that is reasoning, not evidence, and the fix is local to one `div` if it is wrong. The L3 token card on Overview reflecting a new resource file after save is **also unverified** — the `add_file` demonstrably reaches the save payload, but the recomputation is the existing route's and no test here asserts the card
- [x] WP 7.6 — Trace as a lens (SI6) — done 2026-07-06 · direct-tree · dead-space root cause = the 8-row Legend inside the `items-end` toolbar row (inflated it to the measured 242px) → legend now docked (collapsed) inside the Evidence pane; ONE compact toolbar row (picker · K4 chips · verdict, byte-preserved); flex lens layout (canvas flex-1 min-w-0 + 352px Evidence pane w/ own scroll — canvas can no longer run beneath it); NEW evidence→canvas focus (click centers cited node, pan-only) via `TraceFocusNode` in the canvas children slot — **SkillGraphCanvas unchanged**; 14 new tests · all 45 web test files / 387 tests + lint green · **visual walk pending (owner)**
- [x] WP 7.5 — Tool-reference decorations (SI7) — done 2026-07-06 · direct-tree · pure matcher `code-intel/tool-references.ts` (bare AND backticked known refs, frontmatter/fence-aware, longest-match; unknown-toollike = backticked-only, conservative); decorations split graph/text — text set recomputes per keystroke AND on async bound-tools arrival (the flakiness root cause); bare known refs get full hover cards; backticked-unknown → warning underline + live Problems rows (existing warnings channel, deduped vs persisted diagnostics); 49 tests · typecheck/tests/lint green (documented deliberate divergence: web flags any backticked toollike span, API validator requires a context word) · **live Monaco visual pending (owner)**
- [ ] Owner-acceptance addition: §I8 end-to-end walk (blank skill → bind → reference → configure → resource file → one save → LR flow → trace lens, no YAML by hand)

### Phase 7 — owner corrections (2026-08-22, RM-35 roadmap-cleanup pass)

Two judgement calls made by the WP 7.1/7.4 builders were put to the owner and **overturned**. Both
landed on `wp/roadmap-cleanup/ux-corrections` (`7328e7d` · `f0c97b3`, merged), gate green
(typecheck · shared 279 · illustrations 834 · cli 87 · api 3729 · web **374 files / 4149** · build ·
lint), and both were mutation-probed by the orchestrator, not taken on trust.

- **An × on EVERY file tab** (was: one close control at the end of the strip acting on the active
  tab). The builder's objection was real — a Radix `TabsTrigger` renders a `<button>`, and a button
  inside a button is invalid markup with no accessible resolution — so the owner chose the harder
  option and the strip **no longer uses Radix Tabs**: it owns its own `role="tablist"` wiring,
  roving tabindex, Arrow/Home/End movement and `Delete`-to-close, with a new 11-test suite pinning
  all of it (*"the strip is TWO tab stops however many files are open"*, *"a key the strip does not
  own is left alone"*). SKILL.md still has **no ×** and Delete on it is inert. **Probe:** making the
  manifest tab ordinary turns **3 tests red**.
- **One "Edit in Studio", not two.** The page-header link is gone; the contextual one inside the
  read-only flow preview stays. **Probe:** duplicating the preview's own link turns the
  exactly-one-link assertion red.

**Neither was seen in a browser.** jsdom has no layout and does not open Radix tooltips — the
keyboard behaviour is asserted, not walked.

### Phase 7 round 2 (2026-07-06, Cowork PM) — owner hands-on found SI9–SI17 + the **D-UX19 model correction**
- [x] WP 7.R2a — **"Show node" app crash (SI14, P0) + Problems scroll (SI15)** — done 2026-07-06 · direct-tree · root cause: identity-unstable `onSelectionChange` → xyflow's selection listener re-announced a one-commit-stale selection on every parent render → controlled-state ping-pong → React #185. Stable callback via ref + `FocusSeededSelection` pan-into-view; Problems body real internal scroll (old `ScrollArea max-h-*` NEVER worked — Radix %-height vs auto-height root, **upstream brand-ui bug**, same latent pattern in UnifiedEditor save dialog + ExplainerLegend); 14 tests, regression proven failing-on-old-logic
- [x] WP 7.R2b — **Tool-name IntelliSense (SI9)** — done 2026-07-06 · direct-tree · `code-intel/tool-completions.ts` (pure context + mapper + provider: ≥3-char tool-shaped prefix, fires only when a bound tool matches; backticked insert; lazy bound-tools read; backtick context deferred to WP 8.2's provider to avoid double suggestions); 35 tests · live popup pends owner
- [x] WP 7.R2c — **Panels resizable/collapsible (SI16) + session-local node drag (SI10) + save cluster → header (SI13) + "v5 · v5" fix** — done 2026-07-06 · direct-tree · ResizablePanelGroup, persisted sizes/collapse; `nodesDraggable` + override map keyed skill|version|geometry-signature (never dirties the draft, never re-fits); header slot via `onHeaderActionsChange`; `formatVersionLabel` de-dupe · 18 tests · **features/skills 199/199 · web shards 454 green · typecheck + Biome clean** · resize feel/themes pend owner. Known: same label dupe in SkillDiffView pickers (helper exported, 1-liner); vitest resolves react-resizable-panels' SSR build (`resolve.conditions:["browser"]` would fix repo-wide)
- [ ] WP 7.7 — **Components palette** (SI12/SI17, D-UX19#3): section 1 = draggable skill components (keyword · /command · section · sub-routine · gatekeeper · validation gate · loop guard · reference · asset); section 2 = collapsible **MCP Servers** (add on section header, hover-remove per server, tools beneath — absorbs the bind chips); kills the "Add command"/"Add section" toolbar buttons AND the Legend button · Domain: ToolsPalette rebuild + canvas drop wiring + use-edit-ops · Size L
- [ ] WP 7.8 — **Edge grammar + entry-point flows** (SI11, SI10-persistence, D-UX19#1): legal edges express the LLM's reading order (keyword→skill · /command→section(s) · section→sub-routine/gatekeeper/reference/asset · gate→branches); flows render EFFECTIVE use per entry (sections/tools/references/templates actually read); connect-errors become guidance; decide node-position persistence · Domain: graph model (use-edit-ops, flow derivation, api flow extraction review) · Size XL · **short design doc → owner approval BEFORE build** · **DESIGN DOC WRITTEN AND APPROVED 2026-08-22** — [`wp-7.8-edge-grammar-design.md`](./wp-7.8-edge-grammar-design.md) (`wp/roadmap-cleanup/rm30-7.8-design`, merged). All six recommended decisions accepted as written; the seventh settled as **old traces degrade with a visible notice**. So the gate this WP carried is CLEARED and it is **ready to build** — after 7.7, not beside it: both touch `use-edit-ops`. **Two constraints ride along:** the build MAY take one migration (app-side box positions, decision 5 — chosen because a position comment would live in the metered `l2_body_tokens` body and inflate the very cost this app measures) and MUST ship the Auto-arrange reset that goes with it. **The branch question is ANSWERED (2026-08-22), and it changes the answer:** the investigation the owner asked for ran the real projector over all five registered skills, and the entire corpus yields **one** unresolved branch — which is a **mis-parse**, not a branch (two narrative sentences beginning "If the answer is complete after one query…" became two condition labels on one edge). Conditionals are frequent but are intra-step rules, not routing; only three phrases in the whole corpus name a destination and none of them sits in a gatekeeper section. So the defect is a **false positive**, not a missing resolution: **tighten `extractConditions` inside WP 7.8** so prose stops becoming branch labels, and leave *Branch* defined-but-unused until an author has a real decision point. **Not its own work package.** Evidence, method and the sample-size warning (five skills, one author, one domain) are in the design doc.
- [ ] WP 7.9 — **Designer=visual vs Files=source** (D-UX19#2): Design drops Flow|Code|Split (pure visual composer); Files becomes the editable source register (absorbs WP 7.4); one draft across both; SkillDiffView label fix rides along · Depends 7.7+7.8 · Size L–XL

> **Phase 7 session note (2026-07-06, Cowork PM):** 7.2 · 7.3a · 7.5 · 7.6 executed by four parallel
> sub-agents **directly on the working tree** (owner-approved: .git lies outside the session mount —
> owner commits). Domains kept strictly disjoint from in-flight 6.1/6.5–6.7. Gates run in-sandbox:
> shared/api/web typecheck clean · all 45 web test files / 387 tests green · Biome clean (559 files).
> **`pnpm build` NOT run** (macOS-installed node_modules can't build in the Linux VM) — run the full
> gate on the host before committing. Remaining Phase 7: 7.1 (Studio shell), 7.3-full (settings
> panel + draft store), 7.4 (editable files) — blocked on 6.5 finishing (SkillInspector/Overview) +
> App.tsx availability. Env notes for future sessions: 45s bash cap → shard vitest; agents added
> linux-arm64 binaries (rollup/esbuild/biome) into node_modules — harmless to the host.

## 🎉 PROGRAM COMPLETE (Phases 0–5 implementation) — 2026-07-06 (Phase 6 remediation in progress after owner acceptance walk; Phase 7: 7.2/7.3a/7.5/7.6 shipped, 7.1/7.3/7.4 open)
All 34 WPs (Phases 0–5) built + merged on `ux/integration`; gate green after every merge (final: web **254** tests / API **867** / typecheck · build · lint clean). One shell · one tab shell · one scroll contract · one status vocabulary · one modal system · one form kit, applied to every view; workflow cross-links; Compare Workspace rebuilt per §H (radar deleted). **Remaining = owner's:** the live owner-acceptance walk (below) and the `ux/integration → main` merge. `main` never touched by this program; nothing pushed to origin.

## Owner-acceptance (live, by the owner — mirrors phase-5 checklist)
- [ ] Two-theme walk · keyboard pass · shell walks · compare-workspace decision walk · sign-off + merge to main
- [ ] **Provider-key-only checks (couldn't verify without a key — do on the live instance):**
  - WP 2.5: on run `9JThXmPbkW2zh8JeINxGy`, expanding EVERY tool call never moves the KPI rail; the console opens at turn 1 for finished runs; Analytics turn-axis reads correctly with data.
  - WP 2.8 K4: Trace value-aware chips + one-line all-unmatched verdict + docked legend render correctly once a trace is loaded.
  - WP 2.7 / 2.10: the ENABLED credential-filtered model roster (F2/S19) with a real provider key.
  - WP 3.5 (later): launcher cost preview with live pricing.

## Carry-forward findings (PM routes each into the owning Phase 2+ WP prompt)
_Adjacent defects surfaced by earlier WPs; do NOT lose these — fold into the named WP._
- **→ WP 2.2 (servers):** `ScanStatusBadge.tsx` still used by Servers + Dashboard (raw lowercase status) → migrate to `StatusBadge`, then delete the component (also affects 2.1). · Server-detail **deep-link gap**: `/servers/:id` did not select that server (defaulted to first) — verify/fix routing. · Server-detail full **PageShell** migration (1.3 left it on SectionHeader). · Server-detail header icon-only actions (S6).
- **→ WP 2.3 (scans):** adopt `shouldPaginate` on the scan-detail pane tables (still show "Page 1 of 1"); pre-existing raw `text-lg`(L253)/`text-sm`(L284) utilities in ScansView → tokens; S8 count duplication (PageHeader "N scans" badge vs TableToolbar filtered count) — keep one. · **Scans is master-detail → adopt PageShell width="master-detail" via the new AppShell fullBleed+secondaryContent variant (D-UX14); mark /scans in the PageShell set (report to PM).** · NOTE 2.2 already touched ResourcePromptRun.tsx (SV5) — you fork after 2.2 merges, build on it.
- **→ KNOWN LIMITATION (beyond program scope; report to owner):** deep-link-to-SUB-ELEMENT. ServersView (tool), EnvironmentsView, and the Skill inspector (sub-tab) key their selection off LOCAL `useState`, not the URL. So cross-links (2.9 S20 "what to do" tool links, 4.5 next-step cards) land on the right SURFACE but can't pre-open the exact tool/scenario/sub-tab. A `?tool=`/`?tab=`/`?scenario=` URL-param refactor of those three views would close it — a routing follow-up, not a UX-overhaul WP. (Surfaces resolve; sub-element pre-focus is the gap.)
- **→ OWNER (not a UX WP):** (a) stdio server Edit sends `env: {}` when no rows — if the API treats env as authoritative-replace, an edit could clear stored env vars (2.2 finding; confirm update semantics). (b) per-model max-output caps aren't in the web contract (`AvailableModel` has only contextWindow) — expose them? additive-contract question (2.7). (c) failed-scan Overview renders full Findings/Token-distribution/Scan-trend for a scan that listed no tools — reads oddly (2.2, pre-existing).
- **→ WP 2.4 (runs):** STRESS-TEST the 1.4 `pinnedCellClass` bg-bleed pinning on a genuinely overflowing wide table (Name+Actions, no h-scroll at 1500px). If it fails on real overflow, that's the real `@elabs-ai/components-data` upstream gap (no `getIsPinned`/`onRowClick`) → report for owner.
- **→ WP 2.4/2.6 (suites):** `features/testing/suites/SuiteMatrix.tsx` has the same `bg-<state>/N text-<state>-foreground` contrast bug WP 0.5 fixed (use `-text` on-tint tokens).
- **→ WP 2.5 (console) / broad:** Toaster/header overlap only partially cleared by 0.2's `offset=64` (RunBar controls) — reassess per-surface.
- **→ Phase 2 test infra (any web WP):** add a shared `matchMedia` stub to `vitest.setup.ts` (1.3 stubbed locally; needed by anything reaching `useIsMobile`/`AdaptivePanelGroup`/`SplitPane`).
- **Upstream brand-ui gaps to report at close-out:** `@elabs-ai/components-data` DataTable lacks native column-pinning + row-click slot; (from 0.5) confirmed on-tint `-text` tokens exist (no gap there); `@elabs-ai/components-ui` Combobox has no `disabled` prop (2.7/2.10 used a disabled Input workaround); `@elabs-ai/components-ui` ThemeSwitcher is uncontrolled (2.10 composed a DropdownMenu).
- **→ WP 5.1 (Phase 5 sweep):** `SkillInspector.tsx` header uses `SectionHeader` (renders `<h2>`), so the Skills detail page has no `<h1>` — inconsistent with every other PageShell route (2.2b finding, S16 semantic). Small follow-up: swap to `PageHeader`.

## Decision log
_Entries: date · decision · rationale. PM appends; owner locks D-UX marked (owner)._

- 2026-07-05 · **D-UX1 (owner):** "New skill from server" = 4th source in Add-skill modal; remove
  the standalone detail-header button. (Audit K6; owner-directed in audit session.)
- 2026-07-05 · **D-UX2 (owner):** Trigger-collisions panel relocates to the skills-LIST footer;
  out of the detail pane. (Audit K7; owner-directed.)
- 2026-07-05 · **D-UX3 (owner):** run-compare gets a visible entry (Compare tab on Runs) and is
  rebuilt per §G13/§H; suites become comparable. (Owner-directed.)
- 2026-07-05 · **D-UX4 (owner, kickoff):** tab style = left pill tabs app-wide (server-detail style);
  centered gray band retired. **LOCKED.**
- 2026-07-05 · **D-UX5 (owner, kickoff):** card-vs-flat rule per audit S21#4 — flat single-region tab
  content; cards only for multi-panel compositions. **LOCKED.**
- 2026-07-05 · **D-UX6 (owner, kickoff):** modal tiers per audit S17 (Confirm · Form ≤6 fields · Wide
  sectioned/tabbed · Workbench). **LOCKED.**
- 2026-07-05 · **D-UX7 (owner, kickoff):** scroll contract per audit S22; Settings = the sole
  body-scroll archetype. **LOCKED.**
- 2026-07-05 · **D-UX8 (owner, kickoff):** status vocabulary per conventions.md §3 table. **LOCKED.**
- 2026-07-05 · **D-UX9 (owner, kickoff):** diff semantics green=added/red=removed; magnitude-red only on
  summary deltas (audit C4). **LOCKED.**
- 2026-07-05 · **D-UX10 (owner, kickoff):** the efficiency radar is deleted, not fixed (audit T9f);
  WP 0.1 merely contains it until Phase 4 deletes the page. **LOCKED.**
- 2026-07-05 · **D-UX11 (owner, kickoff):** Local collection Git tab — **enforce "cannot bind"**:
  disable the Git-tab bind button with an explanation matching the existing header copy. **LOCKED.**
- 2026-07-05 · **D-UX12 (owner, kickoff):** launcher cost preview data path — **additive
  `GET /api/estimate/run-plan` endpoint** (contract-first: shared types+zod → API → web). **LOCKED.**
- 2026-07-05 · **D-UX14 (PM, reversible):** AppShell gains a **`fullBleed + secondaryContent`** variant
  (rail preserved + edge-to-edge main) so master-detail views (Servers/Scans) mount **PageShell
  width="master-detail"** per 1.2's design — the missing piece behind 2.2's finding that fullBleed
  dropped the ServerRail. Additive, no current caller sets both (no regression). Servers PageShell
  master-detail adoption is a **Batch-E follow-up (WP 2.2b)**; Scans (2.3) adopts it from the start.
- 2026-07-06 · **D-UX16 (owner, acceptance walk):** tab strip = **full-width bar with CENTERED tabs** —
  **overrides D-UX4** (left pills). Applies to every tabbed view (server/scan detail, run console, skills).
- 2026-07-06 · **D-UX17 (owner):** the Skill IDE is rethought as **two registers** per audit §I —
  Inspector (read/analyze, zero edit surfaces) vs **Studio** (`/skills/:id/studio`, full-viewport
  authoring workbench). Locked specifics: (a) server binding gets first-class UI (picker, never
  hand-YAML — SI1); (b) all text files editable in Studio, Inspector Files browse-only (SI2);
  (c) ALL frontmatter concepts (servers/keywords/commands/name/desc) edited in ONE settings panel
  (SI3); (d) flow canvas = LR ranks with side handles (SI4); (e) trace = overlay lens on the same
  canvas, bespoke trace layout deleted (SI6); (f) one draft, one "Save as vN" (SI8). Findings +
  spec: audit "Skill IDE deep-dive" + §I; WPs: phase-7-skill-studio.md.
- 2026-07-06 · **D-UX19 (owner, hands-on session):** the Skill IDE's authoring model is corrected —
  **supersedes D-UX17's Flow|Code|Split** and parts of §I: (1) flows are ENTRY-POINT-centric
  (keywords trigger the whole skill; /commands point at sections; a flow shows what the LLM would
  effectively read from that entry — sections, tools, references, templates in use); nodes model
  effective use, not raw markdown decomposition; (2) **Designer = visual, Files = source** — the
  mode switch dies, both edit one draft; (3) creation is drag-from-palette (Components panel per
  SI12: skill components + collapsible MCP Servers section with add/remove); (4) everything the
  Anthropic skill spec supports must be authorable. Full text: audit "D-UX19" block. WPs 7.7–7.9.
- 2026-07-06 · **Owner acceptance findings (8) → Phase 6:** #1 server-detail whole-content scrolls + tab
  strip not full-width/centered · #2 scans: whole content scrolls (should be split panes each inner-scroll,
  frame fills) + scan-detail tab strip · #3 scans-compare wastes space with 2 boxes → use runs-compare bar ·
  #4 skills Usage should be its own tab (with the runs), not the first Overview element · #5 runs table
  should fill to bottom, not whole-panel scroll · #6 run-console tab strip · #7 environments not editable
  (dirty-guard fires "discard" on adding a skill) · #8 theme control duplicated (top bar + Settings) → drop
  the Settings mirror. Root cause of #1/#2/#5/#6-scroll: PageShell content region is `overflow-y-auto`
  (whole body scrolls) instead of a viewport-filling `overflow-hidden` frame with inner-owned scroll.
- 2026-07-05 · **D-UX15 (PM, reversible):** WP 2.2 domain **expanded** to `features/scans/ResourcePromptRun.tsx`
  (SV5 resource-read terminal error) + `components/ToolRunner.tsx` (SV6 playground) — the findings
  genuinely live there and can't be fixed from features/servers. No concurrent conflict (no wave-D WP
  touches them; 2.3/2.8 fork after 2.2 merges). Accepted; improves the shared ToolRunner (Skill IDE too).
- 2026-07-05 · **D-UX13 (PM, reversible):** WP 0.4 domain **widened** to `apps/api/src/testing/run-service.ts`
  + `engine.ts`. Agent diagnosed the "Let me begin!Now let me search" glue as originating at the API
  source (AI SDK v7 `StepResult.text` = `...join("")`), destroyed before persistence — unfixable in the
  declared web domain. Fix = boundary-preserving `join("\n\n")` over `step.content` text blocks
  (persisted path) + `\n\n` prefix on a new text-block `id` in the live stream. **Wire contract
  unchanged** (`assistantText` stays a string; no API shape/schema change); no sibling Phase-0 WP
  touches these files → merge-safe. PM-decided (correctness/presentation fidelity, not product/wire change).

## Phase 6b — Owner re-walk round 2 (2026-07-06) — tab strip "centered" landed as shrink-to-content (no full-width bar) + 2 more — **ALL DONE, gate green, PM-verified on integrated build**
- [x] WP 6.8 — done 2026-07-06 · Tab strip TRULY full-width bar + centered tabs (#1/#3/#4/#6) · ScrollableTabsList gains additive `fullWidth` prop (container `w-full` + TabsList `w-full justify-center-safe` — full-width track, centered triggers, overflow still scrolls without clipping via `safe center`) + TabPanel opts in (removed the 6.1 `mx-auto w-max` shrink-to-content override) · Domain: components/ScrollableTabsList + TabPanel · **Batch K** · PM-measured on :8085 integrated build: server-detail track 895=col 895 (gaps 223/223), both themes
- [x] WP 6.9 — done 2026-07-06 · Tool-detail header + inner tabs (#2) · ToolDetailPanel uses `<ScrollableTabsList fullWidth>` (dropped `self-start`) + sticky header pinned flush with negative inset `-top-4` (gapAbove 13.1px→0), bled to pane edges `-mx-4 px-4`, opaque `bg-card` + bottom border (masks scrolled rows) · Domain: features/scans/ToolDetailPanel · **Batch K** · PM-measured: inner strip 472=pane 472 (gaps 86/86); scrolled 128px → header gapAbove=0, header L/R == pane L/R (edge-to-edge), both themes
- [x] WP 6.10 — done 2026-07-06 · WideDialog balanced fixed height (#5) · `max-h-[85vh]` → stable `h-[min(85vh,760px)]` (content-independent; header/footer fixed, middle section scrolls internally — no jump between sections) · Domain: components/dialogs/WideDialog · **Batch K** · agent-measured: 691px identical across all 4 test-editor sections, both themes

**Merge order (as planned):** 6.8 → 6.9 (consumes `fullWidth`) → 6.10. Full gate green on the integrated `ux/integration` after all three: typecheck 3/3 Done · test 867/867 · build ✓ · lint clean (563 files).

**PM re-verification (integrated build, :8085, real big-schema fixture DB, both themes) — findings 1–6:**
- #1 server-detail tabs: full-width bar 895=895, centered (223/223) ✅
- #2 tool-detail: header clean (no dark-panel/padding bleed on scroll — gapAbove=0, edge-to-edge) + inner tabs full-width 472=472, centered (86/86) ✅
- #3 scans-detail tabs: full-width 730=730, centered (244/244) ✅
- #4 compare tabs: full-width 1132=1132, centered (445/445) ✅
- #5 WideDialog: stable 691px across sections (agent-verified; TestEditor/EnvironmentEditor both `nav="rail"`) ✅
- #6 run-console tabs: **same TabPanel code path as #1/#3/#4** (structurally covered by the shared `fullWidth` fix) — **not rendered live** (run console needs a provider key; owner-acceptance)

## Phase 6 — Toolbar standard (D-TB1–D-TB4) · **PRIORITY: HIGH** (2026-07-11)

New program layered on the completed Phases 0–5 (a **distinct** section from "Phase 6 — Owner-acceptance
remediation" above; disambiguated by the D-TB suffix, placed at EOF). Source: owner visual walk
2026-07-11 → [`toolbar-standard-2026-07-11.md`](./toolbar-standard-2026-07-11.md) — **that doc's
per-view findings + WP table are the authoritative spec.** One row per view:
`[status/context left] ····· [actions right]`, the `RunBar.tsx` (`../../apps/web/src/features/testing/RunBar.tsx`)
recipe (the reference implementation, already committed on `main`). Base branch:
**`toolbar/integration`** (from `main`; `ux/integration` is an ancestor of `main` → fully merged/stale,
so per the kickoff rule a new branch is cut). Owner merges `toolbar/integration → main`; nothing pushed.

**Legend/format:** identical to the phases above (`[ ]` open · `[~]` in-flight (note worktree) · `[x]`
done — `… — done <YYYY-MM-DD> · wp/tb/<id>`). Gate `pnpm typecheck && pnpm test && pnpm build && pnpm lint`
green on `toolbar/integration` after every merge before the next.

- [x] TB.0 — ViewToolbar primitive + PageShell toolbar bg-card + route-crumb confirm — done 2026-07-11 · wp/tb/0 · new `components/ViewToolbar.tsx` (owner-approved 4-prop API `left`/`actions`/`info`/`className`; frame-light `h-12`; ⓘ tooltip = RunBar Locked-chip pattern) + 5-case test; PageShell `headerVariant="toolbar"` gains `bg-card` via a `HEADER_BG` map (default `""` → **byte-identical** existing routes); PageHeader docblock-only retirement note; route-crumb already supports leaf publishing (no change). **PM touch-up:** `headerBg` was applied to the fill+body branches but MISSED the default content-scroll branch (the one top-level toolbar lists use) → added; committed on the branch before merge. Gate GREEN on integration (typecheck 3/3 · API 1477 pass + web suite · build ✓ 22.9s · lint 717). No live consumer yet → first visual verification is Batch 1 (PM integration walk).
- [x] TB.1 — Skills detail (🔴) — done 2026-07-11 · wp/tb/1 · PageHeader→`ViewToolbar` (`headerVariant="toolbar"` + `scroll="fill"`); left = version Select + GitHub source chip; actions = Pull latest / Publish / Download .zip; in-page H1 + description dropped (sr-only h1 kept for AT), "Analyze recent runs" removed, `skill-analyze.{ts,test.ts}` deleted (no dead imports). **Corrected:** this view imported `PageShell` from `@elabs-ai/components-ui` (no toolbar slot) → switched to the local frame. Gate green on integration. **Visual: PM PASS 2026-07-11** (verification agent, both themes × 1500/1100, seeded echo server + real scan) — breadcrumb→one row→content, no H1/desc, no hooks; `scroll="fill"` tabbed layout fills correctly.
- [x] TB.2 — Servers detail (🔴) — done 2026-07-11 · wp/tb/2 · PageHeader→`ViewToolbar` (master-detail, `scroll="fill"`); left = last-scan StatusBadge + transport/auth chips + endpoint truncating meta; actions = Scan now + edit/connectivity/report icons; in-page name dropped (sr-only h1 kept); **D-TB4** stats strip removed (Tools/Res/Prompts stay in tab badges; Startup/Top-3/Recoverable moved to Overview body, Recoverable de-duped); **D-TB3** server-debug hook removed, `server-analyze.{ts,test.ts}` deleted. Gate green on integration. **Visual: PM PASS 2026-07-11** — one row (StatusBadge+chips+URL ····· Scan now+icons); stats strip gone, counts in tab badges, Startup/Top-3 in Overview body (D-TB4); Scan-now balanced in h-12 (default size reads fine, no follow-up).
- [x] TB.3 — Runs feed + row de-Analyze (🔴, D-TB3) — done 2026-07-11 · wp/tb/3 · PageHeader + in-body TableToolbar → ONE `ViewToolbar` (`left` = search + Type/Status/Environment facets + date + count; `actions` = Group by [compact Select] + Compare runs + New run); sr-only h1; **summary strip + compare bar kept in the body**; active-filter-chips 2nd row + "Clear all" dropped (each control keeps its own clear, per D-TB2). **D-TB3:** per-row Analyze removed (`SuiteTableRows`); runs Compare-Workspace hook removed by ceasing to pass `explainAvailable`/`onExplain` (CompareBar layout untouched — compare-redesign territory); `suite-run-analyze.{ts,test.ts}` + `compare-analyze.{ts,test.ts}` deleted. Batch-2 gate green. **Visual → final sweep** — ⚠ densest row (~1350px for no shrink; stays ONE line, search collapses at 1100px — VERIFY 1100px in the sweep).
- [x] TB.4 — Compatibility (🔴, D-TB3) — done 2026-07-11 · wp/tb/4 · PageHeader→`ViewToolbar` one row of compact filters `[Scan][Models][View][Roll-up][Host client][count]` (labels→aria/placeholder, `Select` primitives composed since `SelectField` forces a visible label); description→ⓘ `info` tooltip; legend moved into body above the heatmap; sr-only h1; **D-TB3** "Explain failures" removed, `compatibility-analyze.{ts,test.ts}` deleted; also switched `@elabs-ai/components-ui` PageShell→local. Gate green on integration. **Visual: PM PASS 2026-07-11** — one filter row + ⓘ tooltip; **1100px FITS (no clip/overflow)** — tight but legible (Scan/Host-client truncate). Keyboard: all controls focusable w/ visible ring. Minor (non-blocking): tab order non-linear (Radix Select portal artifact); heavy label truncation at 1100px.
- [x] TB.5 — Scans + Compare-scans (🟡) — done 2026-07-11 · wp/tb/5 · **Scans detail:** sub-header `<Heading>` (dup of breadcrumb leaf) removed → `ViewToolbar` inside the TabPanel header (detail-pane placement, since Scans uses an in-view AdaptivePanelGroup not the AppShell rail): `left` = `{profile · date}` muted-truncate; `actions` = Diff vs previous + **export ▾ (Markdown/JSON merged into one DropdownMenu)**; KPI grid kept; list filter row untouched; top "Scans" H1 dropped + sr-only h1. **D-TB3** "Reduce footprint" removed, `scan-analyze.{ts,test.ts}` deleted. **Compare-scans:** H1/description block dropped; WP 6.4 `ScanCompareBar` moved into the `headerVariant="toolbar"` slot (card self-frame stripped so the slot frames it), Δ-tokens + pickers intact; sr-only h1. Batch-2 gate green. **Visual → final sweep.**
- [x] TB.6 — Collections list+detail (🟡) — done 2026-07-11 · wp/tb/6 · **Detail:** name + both descriptions removed (sr-only h1 kept); ONE `ViewToolbar` row `[binding chip (Local/Git-bound/local-only)] ····· [Delete] [Run collection]` (Delete kept as secondary action — real destructive control, not a hook); Tests tab → ONE row `[search] ····· [New test]`, helper sentence dropped. **List:** H1/description → ONE row `····· [Import] [New collection]`, list description → ⓘ `info` tooltip; sr-only h1. No assistant hooks in this area. Batch-2 gate green. **Visual → final sweep.** (Suites/Git tabs already had single action rows — left as-is.)
- [x] TB.3a — Runs feed ≤1100px toolbar width fix (follow-up from the final sweep) — done 2026-07-11 · wp/tb/3a · left filter cluster wrapped in a hidden-scrollbar `overflow-x-auto` container + search floored `w-56 min-w-[7rem] shrink` → below fit width the row scrolls as ONE line instead of the search collapsing to icon-width and clipping the "Type" facet (D-TB2 preserved). **Re-verified 1100/1280/1500 both themes** (agent screenshots): 1100px = one row, NO overlap, Type/Status/Environment legible, date+count reachable by scroll, actions intact; 1280/1500 fit with no scroll. Layout-only (+13/-4). Gate green. Minor residual (noted): hidden scrollbar means date-picker/count at ≤1100px reached by focus-autoscroll/trackpad (keyboard-reachable — acceptable).
- [x] TB.7 — Light sweep (Dashboard, Environments 🟢) — done 2026-07-11 · wp/tb/7 · both PageHeader→`ViewToolbar` in the `headerVariant="toolbar"` slot; **Environments** `····· [New environment]` (description dropped — EmptyState explains it; sr-only h1); **Dashboard** `····· [View servers]` (kept), `width="centered"`, sr-only h1 for the home root (no breadcrumb by design), **both loading + loaded branches** migrated; KPI/attention/movers body untouched. **Final full gate GREEN** (typecheck · web 722 · API 1480 · build ✓ 21.9s · lint 706). **Visual → final sweep.** (The full both-theme walk of all 9 views + run console runs as the FINAL verification sweep → `verification-report.md`.)

**Batch map:** TB.0 (solo keystone, after API sign-off) → **Batch 1** [TB.1 ∥ TB.2 ∥ TB.4] → **Batch 2**
[TB.3 ∥ TB.5 ∥ TB.6] → **Batch 3** [TB.7 + verification walk]. Max 3 concurrent; disjoint file domains.

### 🎉 TOOLBAR STANDARD COMPLETE — 2026-07-11 (all 8 WPs TB.0–TB.7 + TB.3a follow-up)
All merged on **`toolbar/integration`** (cut from `main`; `main` never touched, nothing pushed). **Final gate GREEN
after every merge** (final: typecheck 3/3 · **API 1480 pass · web 722 pass / 5 skip** · build ✓ ~22s · lint clean/706).
Two live visual sweeps (built app, seeded, Playwright, both themes) → **PASS on all 10 toolbar surfaces in both
themes**; the one defect found (Runs ≤1100px facet clip) fixed + re-verified (TB.3a). Full report:
[`verification-report.md`](./verification-report.md) "Toolbar standard" section. **Every view: breadcrumb → ONE
`ViewToolbar` row → content; no in-page H1/description; no assistant hooks outside the dock (6 orphaned builder files
deleted); no metric stated twice.** **Remaining = owner's:** the owner-acceptance walk (live run-console `RunBar` on a
real run + dense-content pixels on the owner's real data — both need a provider key / the live container) and the
`toolbar/integration → main` merge. Two adjacent non-toolbar findings flagged for the owner (empty committed seed DB;
orphaned run-event rows aborting the migration on a fresh boot) — see verification-report + decision log.

**Decision log (toolbar standard) — appends to the main decision log above:**
- 2026-07-11 · **D-TB1–D-TB4 (owner, LOCKED)** — see `toolbar-standard-2026-07-11.md` §1: (1) breadcrumb
  owns page identity → in-page H1 title + description blocks removed on ALL views; (2) exactly ONE
  toolbar row per view (`[left] ····· [right]`, RunBar recipe); (3) assistant entry points ONLY in
  the dock; (4) one metric, one home (no number in both a header strip and a tab badge/body card).
- 2026-07-11 · **PM (reversible):** base branch = a NEW `toolbar/integration` cut from `main`.
  `git log main..ux/integration` is empty (ux/integration is an ancestor of main → merged/stale);
  the kickoff rule "ux/integration if unmerged, else create toolbar/integration" → new branch.
- 2026-07-11 · **PM — open item resolved (plan §2 Scans):** "Reduce footprint" is an **assistant hook**
  (`ScansView.tsx:404` → `buildScanAnalyzeRequest`, gated on `assistant.authConfigured`, Sparkles icon),
  NOT the advisor deep-link → removed per D-TB3 in TB.5.
- 2026-07-11 · **PM — D-TB3 sweep found an extra hook:** `ServersView.tsx:549` `buildServerDebugRequest`
  (server-debug assistant entry) → removed in TB.2 per D-TB3 "any other header/row assistant hook found";
  `server-analyze.ts` (+test) orphaned → deleted with it.
- 2026-07-11 · **PM — verified (resolves plan's "verify before deleting"):** `suite-run-analyze.ts`'s ONLY
  consumer is the Runs-feed row Analyze (`SuiteTableRows.tsx:276`), NOT a dock page-hook → deletable in TB.3.
- 2026-07-11 · **PM — breadcrumb leaves already resolved:** servers/scans/skills/collections detail leaves
  are built from App-held state in `App.tsx:750-823`; run console uses `route-crumb`. No in-scope detail
  route has a generic leaf → TB.0's route-crumb work is *confirming* leaves still name each page once the
  in-page H1 is removed, not adding publishers. (Only `/testing/suite-runs/` leaf is generic — out of scope.)
- 2026-07-11 · **OWNER DECIDED — Compare Workspace hook:** "Remove it now" — D-TB3 "remove all" wins over
  the plan's scope-out. The narrow hook removal (`CompareWorkspace.tsx:128` + `compare-analyze.ts` if
  orphaned) is folded into **TB.3** (domain expanded); the Workspace's layout is untouched (its own spec owns that).
- 2026-07-11 · **OWNER APPROVED — ViewToolbar API:** "Approve as proposed" — 4 props (`left`/`actions`/`info`/
  `className`), frame-light row owning `h-12` (no self border/bg/px), composed into PageShell's
  `headerVariant="toolbar"` slot (+`bg-card` added there) and detail-pane sub-headers; `info`→ⓘ tooltip;
  `PageHeader` retained during migration so the gate stays green after every merge. TB.0 builds exactly this.
- 2026-07-11 · **PM (reversible) — Batch gate mode (concurrent-build OOM mitigation, sanctioned by
  orchestration.md §1.4):** Batch view-WP agents run `typecheck · test · lint` only and **skip `pnpm build` +
  the live app** (3 concurrent web builds OOM this machine — memory `parallel-build-oom`). The PM runs the
  AUTHORITATIVE `pnpm build` at each merge on `toolbar/integration` and a single both-theme visual walk per
  batch there (conventions.md §2 permits PM-side visual verification when the agent cannot run the app).
- 2026-07-11 · **PM — TB.0 merged, gate green.** Batch 1 spawned: TB.1 (wt-tb-1) ∥ TB.2 (wt-tb-2) ∥
  TB.4 (wt-tb-4) — disjoint domains (skills / servers / compatibility).
- 2026-07-11 · **PM — FINDING (resolved), `@elabs-ai/components-ui` vs local PageShell:** two views (SkillInspector,
  CompatibilityView) imported `PageShell` from `@elabs-ai/components-ui` — which has NO `headerVariant="toolbar"` slot —
  instead of the local `components/PageShell` the toolbar standard needs. Both switched to the local frame
  in TB.1/TB.4 (an import line, in-domain). **Audited post-merge: every other feature view already imports
  the LOCAL PageShell**, so Batch 2/3 are unaffected. `ServerReportView` uses `@elabs-ai/components-ui` PageShell
  `width="lg"` (a report/print special case, out of scope) — leave it.
- 2026-07-11 · **PM — Batch 1 merged, gate green** (web 719 · API 1477 · build ✓ · lint 712). TB.1/TB.2/TB.4
  ticked; live both-theme visual walk delegated to a Batch-1 verification agent (kickoff per-WP acceptance +
  the flagged TB.4 ~1100px one-row clip risk + TB.1 `scroll="fill"` change).
- 2026-07-11 · **PM — Batch 1 visual PASS** (verification agent, 17 PNGs in `wt-tb-verify1/.wp-evidence/tb-batch1/`).
  All 3 views PASS both themes × 1500/1100. TB.4 **1100px FITS** (no clip). Minor non-blocking: Compatibility
  keyboard tab order non-linear (Radix Select portal artifact); heavy 1100px label truncation. **Held for owner-acceptance,
  not fixed** (presentation polish, not a standard violation).

**⚠ Adjacent findings surfaced during Batch-1 verification (OUTSIDE the toolbar program — for the OWNER, NOT fixed here):**
- **Committed `data/app.sqlite` is essentially EMPTY** (0 servers/scans/runs; predates the Skills table). The rich
  reference data (barc-benchmark, 60-tool heatmaps, etc.) lives ONLY in the owner's running container volume, not in
  the repo snapshot. Consequence for THIS program: PM-side visual passes against the repo DB are data-poor — the
  verification agent created a real echo-server scan + uploaded a real SKILL.md to verify structure. **Dense-content
  pixel checks (60-tool heatmap rows, long Top-3 bars, the Overview "Recoverable" metric) are deferred to the owner's
  live instance (owner-acceptance).**
- **Migration FK-integrity abort on a fresh boot:** the DB carries **33 orphaned `run_events`/`run_steps` rows** (parent
  `runs` deleted); the current migration's FK-integrity check ABORTS on them, so a fresh build rejects that DB until the
  orphans are pruned. Reported by the verification agent (had to delete them to boot the built API). **Unrelated to the
  toolbar WPs; not fixed** (touches data/migrations → owner call). Owner should confirm whether their live DB is affected.
