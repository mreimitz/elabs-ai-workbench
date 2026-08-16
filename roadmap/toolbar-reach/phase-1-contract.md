# Phase 1 — Settle the contract · Batch B

Three parallel WPs. **This batch must fully merge before Phase 2 starts** (Batch C's whole point is applying
the settled contract). Batch B is **3 wide, not 4** — 1.1 is a cross-cutting refactor of the toolbar
primitives and nothing else may touch them while it runs. Domains are disjoint (1.1 = toolbar primitives +
their 3 consumers; 1.2 = PageHeader + its 3 consumers; 1.3 = a new file + a new rule). 1.2 and 1.3 only
*import* `ViewToolbar` — 1.1's changes to it are **additive** (new optional props), so merge order 1.1 → 1.2
→ 1.3 is clean.

---

## WP 1.1 — ViewToolbar absorbs TableToolbar; Environments → one row

- **Findings covered:** B-2 (Environments stacks two toolbars — **S2**), B-3 (`TableToolbar`'s contract is
  stale and contradicts D-TB2 — **S2 root cause**), C-5 (Environments count readout), C-8 (Environments
  pagination guard — the site 0.3 excluded), and locked decisions **D-TB6** (retire `TableToolbar`) +
  **D-TB7** (`ViewToolbar` owns left layout).
- **Domain (exact):**
  - `apps/web/src/components/ViewToolbar.tsx` (+ `components/ViewToolbar.test.tsx` — update for the new API)
  - `apps/web/src/components/TableToolbar.tsx` (**delete**) + `components/TableToolbar.test.tsx` (**delete**)
  - `apps/web/src/features/testing/EnvironmentsView.tsx`
  - `apps/web/src/features/scans/ScansView.tsx` (**only** the two `TableToolbar` call sites `:317` list-rail
    + `:518` detail-pane — migrate to `ViewToolbar`; do **not** touch the master-detail split, the
    `AdaptivePanelGroup`, or anything WP 4.2 owns)
  - `apps/web/src/features/compare/CompareView.tsx` (**only** the shared diff-table renderer `TableToolbar`
    at `:1069` used by the Tools/Resources/Prompts tabs; do **not** touch the `ScanCompareBar` region
    `:1–~200` — WP 2.3 owns that) + `components/`… nothing else
  - `apps/web/src/features/compare/CompareView.test.tsx` (update if the migration changes an assertion)
- **Depends:** 0.4 (shares `TableToolbar.tsx`) · **Size:** L · **solo within Batch B** · **Batch B** ·
  **Model:** opus, effort **high**.

**This is the keystone.** B-3 is the *root cause* the audit names for B-2 and C-1: `TableToolbar`'s docblock
(`:16-29`) still documents a pre-D-TB2 world (*"the primary action … belongs to the PageHeader"*; second-row
removable chips) — so a developer following it in good faith puts search in the table and the primary action
in the header, which is exactly what Environments does. **Two contracts for one row is the bug.** Delete
`TableToolbar`; make `ViewToolbar` the single toolbar contract.

### The `ViewToolbar` API change (owner-locked, D-TB6 + D-TB7)

`ViewToolbar` currently has `left` / `actions` / `info`. Expand it to absorb `TableToolbar`'s useful slots
and own its left layout:

1. **D-TB7 — own the left layout.** Render `left` inside `flex min-w-0 flex-wrap items-center gap-2`
   (currently `flex min-w-0 items-center gap-3`, no wrap). Consumers pass controls, not layout. Change the
   row wrapper's fixed `h-12` to `min-h-12` so a wrapping cluster can grow without clipping while still
   defaulting to the 12-unit height (the "toolbar row top identical" invariant holds — top edge unchanged).
2. **D-TB6 — absorb `results` + `activeFilters`.** Add:
   - `results?: ReactNode` — a count/summary, rendered at the **tail of the left cluster** as muted
     `tabular-nums` meta (the position `TableToolbar.results` had). Consumers pass the standard count Badge
     (C-5) or a `tabular-nums` span.
   - `activeFilters?: ActiveFilterChip[]` + `onClearAll?: () => void` — removable filter chips rendered
     **inline within the single wrapping row** (NOT a bordered/padded second header band — that is the
     D-TB2 violation). Move the `ActiveFilterChip` type out of `TableToolbar` (into `ViewToolbar.tsx`, or a
     tiny shared module) so `ScansView`'s import survives. Each chip removable; "Clear all" shown when ≥1.
   - **Consumers map** `TableToolbar.viewOptions` → `ViewToolbar.actions` (right-aligned view controls like
     `ColumnPicker`); `TableToolbar.search` + `filters` → `ViewToolbar.left`.
3. Update the **docblock** to describe `results`/`activeFilters`, the D-TB6 retirement of `TableToolbar`,
   and D-TB7 left-ownership. Keep the existing MINIMAL USAGE Environments example (it is the correct one)
   and note it is now literally implemented in `EnvironmentsView`.

### Migrate the three consumers

- **`EnvironmentsView.tsx` (the keystone example — B-2).** Today: a top `ViewToolbar` with **only** `actions`
  (one button, blank 48px band, `:292-308`); search + count in a **second** `TableToolbar` inside the
  DataTable's `toolbar` render-prop (`:361-372`), and a **bare** `enablePagination` at `:359`. Rebuild to
  **one** row, modelled on `ViewToolbar.tsx:55-61`'s own canonical example and on `AuditView.tsx:610-653` /
  `SessionsView.tsx:298-348` (the two reference implementations):
  `<ViewToolbar left={<SearchInput … />} results={<count Badge>} actions={<Button>New environment</Button>} />`.
  Remove the DataTable `toolbar` prop; set `enablePagination={shouldPaginate(scenarios.length, 25)}` (this
  is the C-8 Environments site — import `shouldPaginate` from `lib/table`). Use the standard count Badge for
  C-5 (`Badge variant="secondary" tabular-nums`, or `CountBadge` if that export exists in `StatusBadge.tsx`).
  The file's `:290` comment currently *claims* D-TB1/D-TB2 compliance — make it true.
- **`ScansView.tsx` (keep two toolbars, rebuild both from `ViewToolbar` — the audit says leave its
  master-detail split, `:301`).** List-rail (`:317`): `search` + 2 `FacetFilter`s + `results` + its
  `activeFilters`/`onClearAll` → `ViewToolbar left={<>{search}{facets}</>} results={…} activeFilters={…}
  onClearAll={…}`. Detail-pane (`:518`): `search` + `ColumnPicker` (viewOptions) → `ViewToolbar
  left={<SearchInput/>} actions={<ColumnPicker/>}`. **Do not** touch the split, the panels, the count text
  itself beyond re-slotting, or anything else in `ScansView` (WP 2.8 owns the count wording, WP 4.2 owns the
  IA).
- **`CompareView.tsx` (diff-table renderer only, `:1069`).** `search` + `filters` (FacetFilter + the
  hide-unchanged `Switch` label) → `ViewToolbar left={…}`; preserve its `className="shrink-0"` on the row
  and any results count. **Region boundary:** touch only the `renderDiffTable`-style helper (`~:895-1090`),
  not the `ScanCompareBar` region (owned by WP 2.3).

### Acceptance (checklist)
- [ ] `components/TableToolbar.tsx` **and** `TableToolbar.test.tsx` are deleted; grep shows **no** remaining
      `TableToolbar` import anywhere. `ActiveFilterChip` resolves from its new home.
- [ ] `ViewToolbar` has `results` + `activeFilters` + `onClearAll`; `left` renders inside
      `flex min-w-0 flex-wrap items-center gap-2`; `ViewToolbar.test.tsx` covers the new props.
- [ ] **Environments is ONE toolbar row.** On the running app, both themes: breadcrumb → one row
      (`[search] [count] ····· [New environment]`) → table. **Measured geometry:** the search input and the
      New-environment button share **one top edge and one height**; report the numbers. No second band. No
      "Page 1 of 1" when a single page of environments is shown.
- [ ] ScansView still shows its two per-region toolbars (list rail + detail pane), both now `ViewToolbar`,
      behaviour preserved (search, facets, count, removable chips + Clear all on the rail; search +
      ColumnPicker on the detail). Measured: each row's controls share one top + one height.
- [ ] CompareView's Tools/Resources/Prompts diff tables render their filter row through `ViewToolbar`; the
      `ScanCompareBar` region is byte-untouched.
- [ ] Gate green (`typecheck · test · build · lint`). The web build is run (PM runs the authoritative build
      at merge if the sandbox can't).

---

## WP 1.2 — Delete PageHeader

- **Findings covered:** B-1 (two page-frame idioms coexist; D-TB1 half-applied — **S2**), **D-TB8**
  (`PageHeader` is deleted, not deprecated).
- **Domain (exact):**
  - `apps/web/src/components/PageHeader.tsx` (**delete**)
  - `apps/web/src/components/PageShell.test.tsx` (remove the `import { PageHeader }` + the
    `describe("PageHeader")` block; its `PageShell` tests should pass a plain header node — a `Heading` or a
    `<div>` — instead of `<PageHeader/>`)
  - `apps/web/src/features/hub/workforce/WorkforceView.tsx` (+ `WorkforceView.test.tsx` if it breaks)
  - `apps/web/src/features/hub/projects/ProjectsView.tsx` (+ `ProjectsView.test.tsx` if it breaks)
  - `apps/web/src/features/testing/compare/CompareWorkspace.tsx` (no test file exists)
  - **Permitted, blast-radius only** (edit *only* if the WorkforceView conversion breaks them):
    `apps/web/src/features/hub/agents/AgentsView.test.tsx`,
    `apps/web/src/features/hub/workforce/DirectoryTab.test.tsx`
- **Depends:** — · **Size:** M · **parallel** · **Batch B** · **Model:** sonnet, effort **medium**.

D-TB1 (`toolbar-standard-2026-07-11.md:14`) removed in-page H1 title + description blocks on **all** views;
`PageHeader.tsx:17-21` even carries a retirement note. Three views still `import` it (verified — the other
grep hits are comment references): **Agents & Crews** (`WorkforceView.tsx:155`), **Projects**
(`ProjectsView.tsx:24`), **CompareWorkspace** (`:137`). The result is visible the moment you move between
sections — those three push content ~80px down with a 24px title + description while Runs/Scans/etc. have
none. **Deleting the file is the point** — while it compiles it will be reached for again.

**Fix — finish the migration (mirror the TB.x pattern exactly).** For each of the three, replace
`<PageShell … header={<PageHeader title={X} description={Y} actions={Z} />}>` with
`<PageShell … headerVariant="toolbar" header={<ViewToolbar info={Y} actions={Z} />}>` **and** add a
`<Heading level={1} className="sr-only">{X}</Heading>` at the top of the body (the sr-only H1 every TB.x
migration kept for AT). Concretely:

- **WorkforceView** ("Agents & Crews"): description → `info`; the existing **"+ New" `DropdownMenu` split
  button** (`:158-176`) → `actions` (preserved verbatim). `AgentsView.test.tsx`'s `openPageHeaderNewMenu()`
  finds the first "New" button in DOM order — the `ViewToolbar` actions still render in the `PageShell`
  header slot, so DOM order is preserved and the test should pass; edit it only if it doesn't.
- **ProjectsView** ("Projects"): description → `info`; no actions (the row is just the ⓘ). `ProjectLibraryPanel`
  below is out of this WP's domain (WP 2.5/2.8 own it).
- **CompareWorkspace** ("Compare runs"): the transitional/suite-branch `header` (`:135-141`) → `ViewToolbar
  info={description}`; the RUNS branch already uses its `headerVariant="toolbar"` compare bar — leave it.

### Acceptance (checklist)
- [ ] `components/PageHeader.tsx` is deleted; grep shows **no** `import { PageHeader }` and no
      `<PageHeader` JSX anywhere (comment mentions may remain). `PageShell.test.tsx` no longer imports it and
      its `PageShell` cases still pass.
- [ ] Agents & Crews, Projects, CompareWorkspace render breadcrumb → one `ViewToolbar` row (or an ⓘ-only
      row where there are no actions) → content, with **no** visible in-page H1 or description paragraph; an
      `sr-only` H1 remains for AT. Verified on the running app in both themes; content top now matches the
      no-title views (report the measured content-top before/after).
- [ ] The "+ New" split button on Agents & Crews still opens New agent / New crew (not a silent no-op).
- [ ] Gate green (`typecheck · test · build · lint`) including the hub test suites.

---

## WP 1.3 — IconButton primitive + D-TB5 rule (foundation only)

- **Findings covered:** D-7 (three hover-hint mechanisms for icon-only buttons — **S2**) — **foundation
  only**. This WP ships the primitive + the written rule. **No call-site conversion** — that is Phase 3.
- **Domain (exact):**
  - `apps/web/src/components/IconButton.tsx` (**new**) + `components/IconButton.test.tsx` (**new**)
  - `.claude/rules/icon-affordances.md` (**new** — writes down D-TB5)
  - `CLAUDE.md` (**§10 "Map of `.claude/`" only** — add the one-line pointer to the new rule; touch nothing
    else in the file)
- **Depends:** — · **Size:** M · **parallel** · **Batch B** · **Model:** opus, effort **medium**.

The a11y baseline is good (123/124 icon buttons named), but the *sighted mouse user* gets three behaviours:
Radix `Tooltip` (~14, styled/fast), bare `title` (~20, ~1.5s OS delay, not in `aria-describedby`), and
`aria-label`-only (~89, **nothing on hover**). Unlike C-1/B-2 there is **no written rule** to point at —
this is a gap to close. The primitive is *the only reliable way to keep ~124 call sites honest*.

**Ship `IconButton` — make the wrong thing impossible.** Compose it from `@brand/ui` `Button` +
`Tooltip`/`TooltipTrigger`/`TooltipContent`:
- **One `label` prop** produces **both** the tooltip text **and** the `aria-label` — they cannot diverge.
- An optional **`disabledReason` prop**: when disabled, the reason is shown in the tooltip **and** wired to
  `aria-describedby` (so it reaches assistive tech, closing D-6/D-7#4). (A disabled Radix trigger doesn't
  fire hover — wrap so the tooltip still shows on a disabled control, e.g. a focusable/hoverable wrapper;
  verify the `@brand/ui` Tooltip disabled-trigger pattern against the kit/`.d.ts`, don't guess.)
- Takes an icon child (a `lucide-react`/`@brand/icons` glyph) + the usual `Button` `variant`/`size`/`onClick`
  props. **No `title` escape hatch** — the prop does not exist on `IconButton`.
- Visible focus ring (inherited from `Button`); `size="icon"` default.

Write **`.claude/rules/icon-affordances.md`** stating **D-TB5** (README): every icon-only control carries a
Radix `Tooltip` whose text equals its `aria-label`; the native `title` attribute is never used for this;
disabled controls expose their reason via the tooltip + `aria-describedby`; enforced by `IconButton`
deriving both from one `label`. Add the one-line pointer to `CLAUDE.md` §10's rules map (the rules index).

### Acceptance (checklist)
- [ ] `IconButton` exists and renders a `@brand/ui` `Button` (icon child) with an `aria-label` **and** a
      Radix `Tooltip` whose content **equals** the `aria-label`, both derived from a single `label` prop.
      There is **no** `title` prop.
- [ ] `disabledReason` renders in the tooltip and is referenced by `aria-describedby`; the tooltip shows
      even when the button is disabled (verified in a test).
- [ ] `IconButton.test.tsx` asserts: tooltip text === aria-label; disabled + reason wired to
      `aria-describedby`; keyboard-focusable with a visible ring.
- [ ] `.claude/rules/icon-affordances.md` states D-TB5; `CLAUDE.md` §10 lists it. **No call sites converted**
      (that's Phase 3) — this WP is the foundation.
- [ ] Gate green.
