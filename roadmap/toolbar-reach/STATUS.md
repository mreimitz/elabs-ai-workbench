# Toolbar Reach — work-package status ledger · **PRIORITY: HIGH**

Living state for the **toolbar-reach** plan (source:
[`/docs/UI-UX-AUDIT-2026-07-25.md`](../../docs/UI-UX-AUDIT-2026-07-25.md)). Read and updated **only by the
PM/owner** (via `/next-wp toolbar-reach`); sub-agents never edit this file. A box is ticked **only** when
the WP's Acceptance is met and the gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green
on `ui/toolbar-reach` after merge — validated by the PM, not taken on the agent's word.

**Legend:** `[ ]` open · `[~]` in-flight (agent spawned; note worktree) · `[x]` done — record date +
branch: `… — done <YYYY-MM-DD> · wp/toolbar-reach/<id>`. Base branch: **`ui/toolbar-reach`** (cut from
`main`; owner decides the merge to `main`).

**Batch map:** README §Parallel execution map (A→B→C→D→E→F). **Domains:** the phase files are authoritative
for each WP's file domain — the collision check the PM schedules by.

## Phase 0 — Defects ([`phase-0-defects.md`](./phase-0-defects.md)) — Batch A · 4 parallel
- [x] WP 0.1 — Run-console switcher merge (A-1) — done 2026-07-25 · wp/toolbar-reach/0.1 · two switchers merged into ONE `TabPanel` strip (Chat·Steps·Turns·Trace[=`raw`]·Analytics·Report); `ToggleGroup`+`:815` ternary deleted; exported `LEFT_VIEW_TABS` + pure `coerceLeftView`/`paneToLeftView` seams + invariant tests (tabs-set===panels-set; no off-strip `leftView`). Live console visual = owner-acceptance (provider key).
- [x] WP 0.2 — New-run entry + re-run row (A-2, A-3) — done 2026-07-25 · wp/toolbar-reach/0.2 · param-less `/testing/runs/new` → launcher (`?launch=1`); ⌘K fixed; `Re-run` folded into RunBar cluster; `LineageBanner` self-collapses. **PM-ratified** narrow `RunConsole.tsx` expansion (additive `reRunAction?` prop — RunBar only renders inside RunConsole; different region than 0.1, clean auto-merge). Live visual = owner-acceptance.
- [x] WP 0.3 — Pagination guard sweep (C-8, 5 of 6 sites) — done 2026-07-25 · wp/toolbar-reach/0.3 · `shouldPaginate(...)` at CollectionTests/SkillVersions/ScaffoldFromServerWizard/ServersView(Resources+Prompts); Environments left for 1.1; agent's stray out-of-domain doc dropped at integration.
- [x] WP 0.4 — Correct the record — done 2026-07-25 · wp/toolbar-reach/0.4 · `verification-report.md:176` D-TB2 sign-off corrected (records the Environments/Dashboard inaccuracy + fixing WPs); `TableToolbar.tsx` docblock marked superseded by D-TB6 (docblock-only, no code change).

**Batch A closed 2026-07-25** — all 4 merged to `ui/toolbar-reach` (tip after merge); full gate GREEN (typecheck · API 3058 / web 2621 tests · lint 1384 · build 24.5s). Two process notes: (1) Agent-tool worktree isolation forks from `main` — for Batches B+ the base-reset (`git checkout -B wp/toolbar-reach/<id> <tip-SHA>`) is baked into the initial dispatch so it self-corrects in the isolated worktree. (2) 0.2↔0.1 shared `RunConsole.tsx` (unavoidable — RunBar renders only inside RunConsole); ratified, auto-merged clean.

## Phase 1 — Settle the contract ([`phase-1-contract.md`](./phase-1-contract.md)) — Batch B · 3 parallel · enter after A merged
- [x] WP 1.1 — ViewToolbar absorbs TableToolbar; Environments → one row (B-2, B-3, C-5, C-8, D-TB6/7) — done 2026-07-25 · wp/toolbar-reach/1.1 · `TableToolbar`(+test) **deleted**; `ViewToolbar` gained `results`/`activeFilters`/`onClearAll` + D-TB7 flex-wrap `left` (`min-h-12`); `ActiveFilterChip` moved to ViewToolbar; Environments → ONE row (search + count Badge + New; in-table toolbar removed; `shouldPaginate`); ScansView keeps its 2 per-region ViewToolbars (activeFilters preserved); CompareView `DiffTable` migrated, `ScanCompareBar` byte-untouched. **Measured-geometry (Environments one-row, both themes) = owner-acceptance (final walk).**
- [x] WP 1.2 — Delete PageHeader (B-1, D-TB8) — done 2026-07-25 · wp/toolbar-reach/1.2 · `PageHeader` **deleted**; WorkforceView/ProjectsView/CompareWorkspace → `ViewToolbar info` + sr-only h1 (Projects = ⓘ-only row); "+ New" split button preserved; `PageShell.test` PageHeader block removed; blast-radius tests (Agents/Projects/Workforce + PM's `OrgChartTab.test`) wrapped in `TooltipProvider`. Live visual = owner-acceptance.
- [x] WP 1.3 — IconButton primitive + D-TB5 rule (D-7 foundation) — done 2026-07-25 · wp/toolbar-reach/1.3 · `IconButton` (one `label` → tooltip **and** aria-label; **no** `title` prop; `disabledReason` → tooltip + `aria-describedby` via the SkillBindingsPanel wrapper-span pattern) + `.claude/rules/icon-affordances.md` (D-TB5) + CLAUDE.md §10 pointer. No call sites converted (Phase 3 does that).

**Batch B closed 2026-07-25** — merged to `ui/toolbar-reach`; full gate GREEN (typecheck · API 3058 / web 2625 · lint 1383 · build 25.2s). `TableToolbar` + `PageHeader` are gone; `ViewToolbar` is the single toolbar contract; `IconButton` foundation ready for Phase 3. One PM integration touch-up (OrgChartTab.test TooltipProvider wrap, owner-ratified). Base for Batch C is the post-merge tip.

## Phase 2 — Apply it ([`phase-2-apply.md`](./phase-2-apply.md))
### Batch C · 4 parallel · enter after 1.1 + 1.2 merged
- [x] WP 2.1 — Dashboard filter bar + KPI grid (C-1, C-5, D-2, D-4) — done 2026-07-25 · wp/toolbar-reach/2.1 · `FilterControls` `SelectField`→bare `Select`+`aria-label` in ONE `ViewToolbar` row (C-1 label-above cause removed; `ml-auto` gone); count Badge (C-5); KPI 5-col grid at `lg` (D-2); Issues tab → one filter band matching Testing (D-4). **Owner-acceptance/upstream:** a residual ~2px top diff remains — `@elabs-ai/components-data` `FacetFilter` `h-26` vs `@elabs-ai/components-ui` `Select`/`DatePicker` `h-30` (vendored inconsistency, out of plan domain; the *diagnosed* label-above cause is fixed). Measured-geometry (both themes) = owner-acceptance.
- [x] WP 2.2 — Compatibility toolbar + one-subject lead (C-3, C-10) — done 2026-07-25 · wp/toolbar-reach/2.2 · six controls reflow via `ViewToolbar`'s own D-TB7 layout (no hand-rolled wrapper); host-client `SelectValue placeholder="Host client"` + "Host client: none" empty state (never bare "None"); scan label `<server> · <date>` + full detail in `title`; ModelPicker `w-44`→`w-56`; single subject leads with **Tool × Model**; legend left-aligned to hug the grid. Drift honestly reported (legend was partly fixed 2026-07-11; agent changed `justify-end`→left). Live widths/themes = owner-acceptance.
- [x] WP 2.3 — Scan-compare bar name-first (C-4) — done 2026-07-25 · wp/toolbar-reach/2.3 · `ScanCompareBar` `ScanSide`: server name FIRST (explicit `SelectValue` child overriding Radix's full-node projection that caused the clip); type/env → secondary `Badge` OUTSIDE the select; `title` = full value; `w-40`→`w-56`. `DiffTable` region byte-untouched (verified). Live measured = owner-acceptance.
- [x] WP 2.4 — Usage toolbar + SelectField fence (C-1 part 4, C-2, D-TB9) — done 2026-07-25 · wp/toolbar-reach/2.4 · `UsageToolbar` `SelectField`→bare `Select`+`aria-label`; hand-rolled `Badge`+✕ chip retired (C-2); `SelectField.tsx` D-TB9 fence docblock (no code change — survives for forms). Live themes = owner-acceptance.

**Batch C closed 2026-07-25** — merged to `ui/toolbar-reach`; gate GREEN (typecheck · web 2629 · API 0-fail-in-isolation [1 perf flake under concurrent load] · lint 1384 · build 42s). **Carry-forward for the owner-acceptance walk + a potential upstream `@elabs-ai/components-*` report:** `@elabs-ai/components-data` `FacetFilter` renders `h-26` while `@elabs-ai/components-ui` `Select`/`DatePicker`/etc. render `h-30` — every mixed toolbar row (Dashboard, Audit, Sessions, Scans) has a ~2px top/4px height residual not fixable without touching vendored packages. The plan removes the *diagnosed* 9px label-above cause; this residual is the vendored floor.
### Batch D · 4 parallel · enter after C merged
- [x] WP 2.5 — Collections + state discipline (C-7 all incl. monospace, D-8) — done 2026-07-25 · wp/toolbar-reach/2.5 · action column reserves width (Open aligns via Delete-or-`aria-hidden` placeholder); near-empty bar → search + count (non-empty) / ⓘ-in-EmptyState (empty); `not bound to a repository` → body face (bound paths keep `font-mono`); 404 → `StatePanel kind="empty"` + "Back to collections", not the pink `ErrorState` (D-8). First collections test coverage (7). Live themes = owner-acceptance.
- [x] WP 2.6 — StatusBadge quiet variant (D-3, D-TB11) — done 2026-07-25 · wp/toolbar-reach/2.6 · `StatusBadge` gained `quiet` (quiet+success → muted text; every other tone → chip — single rendering authority preserved); `ScansTab` inline `<Text>` exception → `<StatusBadge quiet>`; attention queue still a chip; `ScansView` untouched. 34 targeted tests. Live themes = owner-acceptance.
- [x] WP 2.7 — Breadcrumb section labels (B-4; C-9 CLOSED — D-UX16 stands) — done 2026-07-25 · wp/toolbar-reach/2.7 · depth-1 roots → sidebar SECTION label (`MCP > Scans`, `Testing > Runs`, `Setup > Environments`, `Skills > Skills`, …) reused from `AppShell` `SidebarGroupLabel`; detail routes + retracted Assistant-peer IA unchanged; `TabPanel` untouched. App tests 27. Notes (non-blocking): `/skills → "Skills > Skills"` (collapsible later if wanted); `/testing/environments` sits in the "Setup" sidebar group (pre-existing). Live themes = owner-acceptance.
- [x] WP 2.8 — Consistency sweep (C-5 rem, D-9, D-10) — done 2026-07-25 · wp/toolbar-reach/2.8 · count readouts → standard `Badge` (`ScansView` count-only, `ReviewView`); Projects "Show archived" `Switch`→`Checkbox` (control-first + test asserts `checkbox`); D-10 `title` on clamped descriptions — skill-frontmatter already had it (`SkillOverview.tsx`), agent-card added via **PM touch-up** at `AgentCard.tsx:232` (clamp lives there, not `DirectoryTab` — domain widened, owner-ratified). Live themes = owner-acceptance.

**Batch D closed 2026-07-25** — merged to `ui/toolbar-reach`; gate GREEN (typecheck · web 2656 · API 3058/3058 · lint 1386 · build 23.6s). One PM touch-up (AgentCard `title`). 15 of 23 WPs done (Batches A–D). Base for Batch E is the post-merge tip.

## Phase 3 — Icon affordances at scale ([`phase-3-affordances.md`](./phase-3-affordances.md)) — Batch E · 4 parallel · enter after 1.3 merged (runs after D, not overlapped)
- [x] WP 3.1 — Shared chrome + form kit (components/** + notifications + ExpandableTable) — done 2026-07-25 · wp/toolbar-reach/3.1 · 14 shared controls → `IconButton` (form-kit ListEditor/KeyValueEditor/TagInput/SliderNumber, AppShell dock/theme, NotificationBell, ExpandableTable, ViewToolbar chip-remove). **Found + fixed a real primitive-level hazard:** a Radix Dialog auto-focusing an `IconButton` opens its tooltip, which eats the first Escape — fixed the one instance (`onOpenAutoFocus` preventDefault); **flagged as a follow-up** (any modal whose first-focusable is an IconButton).
- [x] WP 3.2 — Servers + Scans + Compare + Reports icon buttons — done 2026-07-25 · wp/toolbar-reach/3.2 · 9 controls → `IconButton` (servers/compare, `disabledReason` wired); replaced 4 hand-rolled Tooltip scaffolds; verified `DropdownMenuTrigger asChild`∘`IconButton` composes. `scans/**`+`reports/**` had **zero** icon-only controls (exhaustively confirmed).
- [x] WP 3.3 — Testing (+ watch + review) icon buttons — done 2026-07-25 · wp/toolbar-reach/3.3 · 43 controls → `IconButton`; smart carve-outs (3 controls whose tooltip carries a longer explanation than the aria-label left as manual Tooltips); caught 4 ternary-masked chevron toggles. **PM correction at integration:** 3.3 over-converted the text-bearing CompareBar "Export" split-button to icon-only — restored the visible label, moved the disabled reason off native `title` onto a themed Radix tooltip + `aria-describedby` (audit D-6/D-7).
- [x] WP 3.4 — Hub + Skills + Compatibility + Assistant + Dashboard + Issues + Settings icon buttons — done 2026-07-25 · wp/toolbar-reach/3.4 · ~63 controls → `IconButton` across 8 dirs; the app's **one** missing accessible name (`EffectiveMemoryStack:151`, the 124th button) fixed; SkillInspector gear/Pull/Push + SkillRail add-skill unified; ~30 test `TooltipProvider` wraps. (Spawned nested agents mid-run into its OWN worktree; PM redirected → consolidated + finished solo; main tree never touched.)

**Batch E closed 2026-07-25** — merged to `ui/toolbar-reach`; gate GREEN (typecheck · web 2657 · lint 1386 · build 25s; API untouched). **PM integration fixes:** restored the CompareBar Export label; 6 cross-domain `TooltipProvider` test wraps (3.1's shared-primitive `ExpandableTable` fan-out into 3.2/3.3/3.4-domain tests — none could see the break, forked pre-3.1). **Carry-forward for owner-acceptance / upstream:** (1) the IconButton-in-Dialog Escape hazard (primitive-level; 1 fixed, others may lurk); (2) `Composer.tsx:541` `SpeechInput` keeps a bare native `title` — it's a `@elabs-ai/components-ai` `PromptInputButton`, not a `<Button>`, so out of Phase 3 + the 4.1 hook's reach (an upstream fix); (3) `agents/CrewEditor.tsx`/`CrewLibraryPanel.tsx` look like dead code. 19 of 23 WPs done.

## Phase 4 — Guardrails and acceptance ([`phase-4-guardrails.md`](./phase-4-guardrails.md)) — Batch F · enter after E merged
- [x] WP 4.2 — Scans IA — list-first (D-1) — done 2026-07-25 · wp/toolbar-reach/4.2 · **approach (a)**: `/scans` renders the full-width history; `/scans/:id` transitions to master-detail (URL-driven via `useParams`, no App.tsx change); the empty "800px of nothing" detail pane on arrival is deleted; `Δ vs previous` reads full-width in the list and folds out in the narrow switcher rail; deep-link lands in detail immediately with a loading/stale guard. Live measured geometry (both themes) = owner-acceptance.
- [x] WP 4.3 — Surface off-nav features (B-6) — done 2026-07-25 · wp/toolbar-reach/4.3 · Suites → a `Runs | Suites` peer-tab in the Runs feed (mounts existing `SuitesView`, `?feed=suites` bookmarkable); Review/Rubrics → a "Review" section in Collections (Open review / Manage rubrics cards). **No new nav items, no App.tsx change**; A-2 `?launch=1` byte-preserved; each surface renders with zero query params (D-TB10). Pre-existing flag (out of domain): editing a suite from the embedded tab round-trips to Collections. Live themes = owner-acceptance.
- [x] WP 4.4 — Settings theme control + route rule (D-5 applied — supersedes WP 6.7; B-5, D-TB10) — done 2026-07-25 · wp/toolbar-reach/4.4 · working theme `Select` in Settings General (System · Bright · Dark, only allowed themes); `.claude/rules/routes-vs-dialogs.md` (D-TB10) + CLAUDE.md §10 pointer. **PM App.tsx touch-up** threaded the lifted `useThemePreference` into `SettingsDialog` so it stays in lockstep with the top-bar control (the agent surfaced the gap + set up the optional props; the wiring was outside its domain). Live theme switch = owner-acceptance.
- [x] WP 4.1 — Guardrails (ran LAST, solo) — done 2026-07-25 · wp/toolbar-reach/4.1 · **four guardrails, each demonstrated to FAIL on the injected pre-fix pattern then reverted:** (1) a scan-test failing on a bare `enablePagination` (C-8); (2) a test failing if `SelectField` is imported by a `*Toolbar*`/`*Filter*` module (D-TB9); (3) `.claude/hooks/no-title-on-icon-button.mjs` (registered additively in `settings.json`) rejecting `title=` on a text-less `<Button>`/`<IconButton>` — verified it does NOT false-positive on component `title` props / text-bearing buttons / `PromptInputButton` / the `brand-ui-allow` escape hatch / non-web + test files (D-TB5); (4) a test asserting `PageHeader` + `TableToolbar` are gone and unimported (D-TB6/D-TB8). 4 new test files (23 tests). No existing tests edited.

**Batch F closed 2026-07-25** — merged to `ui/toolbar-reach`; **full gate GREEN on the complete plan** (typecheck · API 3058/3058 · web 272 files / 2688 pass · lint 1392 · build 26s). One PM App.tsx touch-up (theme-sync wiring).

---

## 🎉 PROGRAM COMPLETE — all 23 WPs (Batches A–F) — 2026-07-25
All merged on **`ui/toolbar-reach`** (cut from `main`; `main` never touched, nothing pushed). Gate GREEN
after every batch integration (final: typecheck · API **3058** · web **2688** / 272 files · lint **1392** ·
build ✓ ~26s). What shipped: the 3 real defects fixed (A-1/A-2/A-3); the toolbar contract SETTLED
(`TableToolbar` + `PageHeader` deleted, `ViewToolbar` the single contract, D-TB6/7/8); the standard APPLIED
(Dashboard/Compatibility/Compare/Usage/Environments/Scans one-row + measured-fix targets); one icon
affordance mechanism (`IconButton` + D-TB5, ~129 controls converted, the 1 missing name fixed); Collections
state discipline; `StatusBadge quiet`; breadcrumb section labels; Scans list-first; off-nav features
surfaced; the Settings theme control restored (D-5); and **guardrails so this can't drift a THIRD time.**
Owner decisions D-TB5–D-TB11 locked; C-9 kept-closed (D-UX16), D-5 applied (supersedes 6.7). **Remaining =
the owner's:** the live/measured owner-acceptance walk (below) + the `ui/toolbar-reach → main` merge.

### Owner-acceptance walk (PM-as-owner) — DONE 2026-07-25 → [`verification-report.md`](./verification-report.md)
**Live measured-geometry pass** (Playwright + Chrome, fresh `ui/toolbar-reach` build on `:8085`, 1515×811,
BOTH themes). Signed off on measured numbers: **B-2 Environments** one row (search+New = 57/30 IDENTICAL);
**C-1 Dashboard filter** 11px→**1px** scatter (residual = the vendored FacetFilter `h-26` floor); **B-1**
Agents&Crews h1 is sr-only (no visible title); **B-4** crumbs `MCP›Scans`/`Testing›Runs`; **D-1** `/scans`
full-width on arrival, no split/empty-card. The rest structurally verified + gate-green. **Owner-pending**
(needs a provider key / seeded data): run-console visuals (A-1/2/3), content-bearing rows (Compatibility/
Compare/Usage/KPI), live theme switch, icon-hover at scale. Carry-forward for the owner / upstream `@elabs-ai/components-*`:
- **IconButton-in-Dialog Escape hazard** — a modal auto-focusing an `IconButton` opens its tooltip, which
  eats the first Escape (1 instance fixed in 3.1; others may exist — needs a live modal sweep or a
  primitive-level fix).
- **`@elabs-ai/components-data` `FacetFilter` `h-26` vs `@elabs-ai/components-ui` `h-30`** — a ~2px residual on every mixed toolbar row
  (the diagnosed label-above cause IS fixed; this is the vendored floor). Upstream `@elabs-ai/components-*` report.
- **`Composer.tsx:541` `SpeechInput`** keeps a bare native `title` — a `@elabs-ai/components-ai` `PromptInputButton`, not a
  `<Button>`, so outside Phase 3 + the 4.1 hook. Upstream fix.
- `agents/CrewEditor.tsx` / `CrewLibraryPanel.tsx` look like dead code (owner cleanup call).
- `/skills → "Skills > Skills"` breadcrumb redundancy (collapsible, one-liner) + `/testing/environments` sits
  in the "Setup" sidebar group (pre-existing) + editing a suite from the embedded Runs tab round-trips to
  Collections (pre-existing SuitesView flow).

<!-- One line per WP. Seed every WP open; never pre-tick. The PM ticks a box only on a validated,
     gate-green merge, appending the date + branch and a one-line what-shipped note. -->
