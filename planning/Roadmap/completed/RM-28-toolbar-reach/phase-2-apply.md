---
type: "Work Package Spec"
title: "Phase 2 \u2014 Apply the settled contract \u00b7 Batches C & D"
description: "Eight WPs. Batch C (2.1\u20132.4) enters after 1.1 + 1.2 merged; Batch D (2.5\u20132.8) enters after C merged."
tags: ["roadmap", "RM-28"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 2 — Apply the settled contract · Batches C & D

Eight WPs. **Batch C (2.1–2.4)** enters after 1.1 + 1.2 merged; **Batch D (2.5–2.8)** enters after C merged.
All of these *apply* the now-settled `ViewToolbar` contract (D-TB6/D-TB7 from 1.1), the `IconButton`/D-TB5
foundation is NOT required here (that's Phase 3). Every WP with a toolbar reports **measured geometry** (one
top edge, one height for every control in the row) in both themes — see [`conventions.md`](./conventions.md) §2.

Two intra-plan corrections the PM made while scaffolding (grounded in current source):
- **All of C-7 is WP 2.5** (the "not bound to a repository" monospace-prose text lives in
  `features/testing/collections/CollectionsView.tsx`/`CollectionGit.tsx` — 2.5's domain — so 2.8 cannot reach
  it). 2.8 drops C-7; it keeps C-5-remainder, D-9, D-10.
- **2.1's domain includes `features/dashboard/testing/**`** (the D-2 KPI cards live in
  `dashboard/testing/KpiHeader.tsx` + `WaitingForYouCard.tsx`, not just `FilterControls.tsx`).

---

# Batch C — enter after 1.1 + 1.2 merged

## WP 2.1 — Dashboard filter bar + KPI grid

- **Findings covered:** C-1 (Dashboard Testing filter bar — three heights, three baselines — **S2**;
  the finding the owner raised), C-5 (missing count badge on the Dashboard), D-2 (KPI row orphan — **S3**),
  D-4 (Dashboard tabs pad/filter differently — **S3**).
- **Domain (exact):**
  - `apps/web/src/features/dashboard/testing/**` (`FilterControls.tsx`, `KpiHeader.tsx`,
    `WaitingForYouCard.tsx` + their `*.test.tsx`)
  - `apps/web/src/features/dashboard/TestingTab.tsx`
  - `apps/web/src/features/issues-fleet/IssuesFleetTab.tsx` + `IssuesFleetTab.test.tsx`
  - `apps/web/src/features/issues-fleet/IssueFilters.tsx`
  - **Do NOT touch** `features/dashboard/ScansTab.tsx` (WP 2.6 owns it).
- **Depends:** 1.1, 1.2 · **Size:** M · **parallel** · **Batch C** · **Model:** sonnet, effort **medium**.

**C-1 is the finding the owner screenshotted.** Measured in the live DOM: `Date range` top=117 h=30,
facets top=119 h=26, `Suite`/`Group by` top=126 h=30 — **three heights, three top edges, 11px of scatter**.
The cause is one component: `components/SelectField.tsx:12-27` is a **label-above** stack, so dropped into an
`items-center` row the two stacked fields centre on the *combined* label+control height and sit ~9px below
the chips. This is banned twice in the codebase (`TableToolbar.tsx:17-18`, `CompatibilityView.tsx:221-222`)
and was already fixed once in a sibling view — `DirectoryTab.tsx:222-226` records replacing `SelectField`
*"because the old `SelectField` floated a 'Sort' label ABOVE the control, breaking the row's baseline."*
**Read that comment before starting.**

**Fix:**
1. Replace **both** `SelectField`s (`Suite`, `Group by`) in `FilterControls.tsx` with a bare `Select` +
   `SelectTrigger aria-label="Suite"` / `aria-label="Group by"`, exactly as `RunsView.tsx:662-676` already
   does for the *same* "Group by" concept (D-TB9).
2. Wrap the row in `ViewToolbar` — `left` = date + facets, `actions` = Group by. That deletes the `ml-auto`
   on the element and gives the row the `h-12`/`bg-card`/gutter framing every other top row has (the row
   currently has none).
3. Add the missing count badge (C-5) — standard `Badge variant="secondary" tabular-nums` (or `CountBadge`).
4. **D-2:** the KPI row shows five single-metric cards in a four-column grid, orphaning `Waiting for you` on
   row two at quarter width. Fix in `KpiHeader.tsx`: either a five-column grid at this width **or** promote
   `Waiting for you` (the only actionable card) into the "Needs attention" panel. Pick the cleaner in both
   themes and record which you chose + why.
5. **D-4:** one filter-row shape across the Testing and Issues tabs. `IssueFilters.tsx:33-37` claims it
   *"mirrors the Testing dashboard's FilterControls recipe"* — it doesn't (Issues splits chips + search over
   two `p-4` rows, `IssuesFleetTab.tsx:150-159`), and Issues is the better of the two for being
   all-label-in-control. Take **Issues' control vocabulary** and **Testing's single-`ViewToolbar`-row layout**
   and apply it to both. (ScansTab is out of domain — its filter shape, if any, is left to a later pass.)

### Acceptance (checklist)
- [ ] **Measured:** on the running Dashboard Testing tab, every control in the filter row — date range,
      each facet, Suite, Group by — shares **one top edge and one height** (report the numbers; the C-1
      scatter of 11px is now 0). Both themes.
- [ ] The filter row is wrapped in `ViewToolbar` (bg-card + border-b + gutter, `left`=date+facets,
      `actions`=Group by); no `SelectField` remains in `FilterControls.tsx` (grep-clean); no `ml-auto` on a
      control.
- [ ] A count badge is present on the Dashboard (C-5) using the standard Badge treatment.
- [ ] The KPI grid no longer orphans a card (D-2) — state the chosen layout.
- [ ] Testing and Issues tabs share one filter-row shape (D-4) — measured identical in both, both themes.
- [ ] Gate green + updated `FilterControls`/`IssuesFleetTab` tests.

## WP 2.2 — Compatibility toolbar + one-subject lead

- **Findings covered:** C-3 (Compatibility toolbar: six bare controls, one meaningless — **S2**),
  C-10 (one data row in an 800px viewport — **S4**).
- **Domain (exact):** `apps/web/src/features/compatibility/**` (`CompatibilityView.tsx` + siblings + tests).
- **Depends:** 1.1, 1.2 · **Size:** M · **parallel** · **Batch C** · **Model:** sonnet, effort **medium**.

**C-3.** `CompatibilityView.tsx:212-306` spreads six controls as **bare siblings** (a fragment) into
`ViewToolbar left` — no wrapper, no `flex-wrap`, no overflow strategy; below ~1300px they collide. **Note:**
after WP 1.1, `ViewToolbar` owns `left` layout (D-TB7: `flex min-w-0 flex-wrap items-center gap-2`), so
passing the six controls into `left` now wraps correctly **by default** — confirm that's what happens and
don't re-add a hand-rolled wrapper. The remaining C-3 problems:
- The host-client `Select` (`:296`) renders visible text **"None"** — meaningless. Give it
  `<SelectValue placeholder="Host client" />` and render the empty state as **"Host client: none"**, not
  "None". (Its `aria-label="Host client"` already tells AT users more than sighted ones — invert that.)
- The scan select reads `acme-demo · Jul 21,…` truncated mid-date → shorten its option label to
  `<server> · <date>` (or widen it). The model picker reads `5 models · De…` — give it room or a cleaner label.

**C-10.** The Server × Model heatmap renders a single subject row then ~470px of empty page, with the
Green/Amber/Red legend floating top-right detached from the grid. With **one** subject, **lead with Tool ×
Model** (the view that has content) and move the legend **adjacent to the grid** it explains.

### Acceptance (checklist)
- [ ] The six filter controls sit in `ViewToolbar left` and **wrap** cleanly at ≤1300px (no collision, no
      horizontal page clip) — verified at 1500/1280/1100px, both themes.
- [ ] The host-client select shows a **"Host client"** placeholder and an empty state reading "Host client:
      none" (never a bare "None"); scan + model selects are legible (no mid-word truncation of the
      discriminating token).
- [ ] With a single subject, the view leads with a content-bearing grid (Tool × Model) and the legend sits
      next to the grid.
- [ ] Gate green + tests.

## WP 2.3 — Scan-compare bar name-first

- **Findings covered:** C-4 (Compare bar: the discriminating token is the one truncated — **S2**).
- **Domain (exact):** `apps/web/src/features/compare/CompareView.tsx` — **the `ScanCompareBar` region only**
  (the A/B server-picker bar, defined *inside* `CompareView.tsx`; grep for the letter-chip / swap / `Server
  A`/`Server B` block). **Do NOT** touch the diff-table renderer region (`~:895-1090`, WP 1.1's territory,
  already merged) beyond what the bar needs. (+ `CompareView.test.tsx` if a bar assertion changes.)
- **Depends:** 1.1, 1.2 · **Size:** M · **parallel** · **Batch C** · **Model:** sonnet, effort **medium**.

The Server A / Server B selects hold `acme-demo · acme-saas · Production` (38 chars) in a **131px** box —
measured `scrollWidth` 129 vs 131px client width, fully clipped. What renders is `· acme-saas · Pro…`: the
leading separator + type/environment, with **the server name — the only thing that distinguishes A from B —
cut off.** Neither select carries a `title`, so no hover recovery. Eleven controls sit in this one row.

**Fix:**
- Put the **server name first** and let the rest go: `acme-demo`, with type/environment as a secondary
  `Badge` **outside** the select.
- Add `title` with the full value for hover recovery. *(D-TB5 carve-out: `title` is banned on a **text-less
  `<Button>`**; a truncating value control like this select uses `title` for recovery, per D-10 — this is
  correct, not a D-TB5 violation.)*
- Widen the select to `w-56` — there is room, the row ends at x≈1490.

### Acceptance (checklist)
- [ ] On the running compare-scans bar, each server select shows the **server name** first (not clipped to
      `· acme-saas · Pro…`); type/environment is a `Badge` outside the select; a `title` carries the full
      value. Measured: the select is `w-56` and the name is fully visible for the seed data. Both themes.
- [ ] The diff-table region and the `Δ tokens` readout are untouched; the bar still reads as one row.
- [ ] Gate green + tests.

## WP 2.4 — Usage toolbar + SelectField fence

- **Findings covered:** C-1 (part 4 — the other remaining `SelectField`-in-a-toolbar), C-2 (retire the
  hand-rolled Usage badge — the file's own chip idiom), **D-TB9** (label-above banned in toolbars).
- **Domain (exact):**
  - `apps/web/src/features/hub/workforce/usage/UsageToolbar.tsx` (+ its test if present)
  - `apps/web/src/components/SelectField.tsx` (**docblock comment only** — the D-TB9 fence note; no code change)
- **Depends:** 1.1 · **Size:** S · **parallel** · **Batch C** · **Model:** haiku, effort **low**.

C-1's step 4: `UsageToolbar.tsx:95,104` is the *other* remaining `SelectField`-in-a-toolbar and has the
identical baseline-scatter defect. Fixing the Dashboard (2.1) and not this just moves the inconsistency.

**Fix:**
- Replace the two `SelectField`s (`:95`, `:104`) with bare `Select` + `SelectTrigger aria-label="…"`, per the
  `RunsView.tsx:662-676` precedent (D-TB9).
- Retire the hand-rolled `Badge` + ✕ filter chip (`:132-146`, C-2) in favour of the standard idiom (a
  `FacetFilter` if multi-select, or drop the chip and rely on the select's own state) — match how
  Sessions/Audit render filters. Keep it one row.
- Add the **D-TB9 fence note** to `SelectField.tsx`'s docblock: *label-above stack — for **dialogs and form
  bodies** only; importing this into a toolbar module is banned (D-TB9) and a lint failure (WP 4.1). Toolbar
  single-selects use bare `Select` + `SelectTrigger aria-label`.* (No behavioural change — `SelectField`
  survives for forms.)

### Acceptance (checklist)
- [ ] `UsageToolbar` has **no** `SelectField` (grep-clean); its selects are bare `Select` + `aria-label`;
      controls share one top + one height (measured, both themes).
- [ ] The hand-rolled Usage filter badge is gone; filtering uses the standard idiom, one row.
- [ ] `SelectField.tsx`'s docblock carries the D-TB9 fence note; the component still works in forms
      (its other ~20 consumers are untouched).
- [ ] Gate green.

---

# Batch D — enter after Batch C merged

## WP 2.5 — Collections + state discipline

- **Findings covered:** C-7 (Collections: empty toolbar, ragged action alignment, **and** the monospace-prose
  "not bound to a repository" — **S3**), D-8 (two error/empty-state treatments — **S3**).
- **Domain (exact):** `apps/web/src/features/testing/collections/**` (`CollectionsView.tsx`,
  `CollectionDetail.tsx`, `CollectionGit.tsx`, `CollectionTests.tsx`, … + their tests). **Note:** WP 0.3
  already guarded `CollectionTests.tsx:404` pagination (merged) and WP 4.3 will later add a Review/Rubrics
  section to `CollectionsView.tsx` — this WP forks after 0.3, and 4.3 forks after this; no parallel overlap.
- **Depends:** 1.1 · **Size:** M · **parallel** · **Batch D** · **Model:** sonnet, effort **medium**.

**C-7 (three parts, all in this domain):**
1. **Ragged action alignment.** In the collections list, `Local` has no delete affordance (correct — it's
   undeletable) so its `Open` button sits at x≈1447 while `BARC-Benchmark`'s sits at x≈1413 — a ragged right
   edge. **Reserve the action-column width** whether or not the delete button renders (a disabled/invisible
   placeholder, or make the action cluster a fixed-width grid cell). The `Open` buttons must align.
2. **Empty toolbar.** The bar carries a lone ⓘ + two right-aligned buttons — 48px for a tooltip. Move the ⓘ
   content into the empty-state card and drop the bar, **or** put a search field in it once collections
   exceed a handful (use the `ViewToolbar` `info`/`left`/`actions` grammar; don't leave a near-empty band).
3. **Monospace prose.** `not bound to a repository` (in `CollectionsView.tsx` / `CollectionGit.tsx`) renders
   in the **monospace** face — code font for prose. Set it in the **body face** (drop `font-mono`).

**D-8.** `ErrorState` renders a full-width pink band with a left accent bar; empty states render a centred
dashed card. On a bad collection id you get the pink band; on Compare-with-nothing-selected you get the
dashed card. Both are "there's nothing here yet," styled as different severities. **Reserve the pink
`ErrorState` for genuine failures** (fetch failed, connection refused). "Nothing selected / not found" is an
**empty state** — dashed card + the action that resolves it. Apply within this domain (the bad-collection-id
case); note any out-of-domain instance for a later WP rather than reaching across.

### Acceptance (checklist)
- [ ] In the collections list, every row's `Open` button aligns to the same x whether or not the row has a
      delete button (measured, both themes).
- [ ] The near-empty collections bar is resolved (ⓘ moved to the empty-state card and bar dropped, or a
      search field added) — no 48px band holding only a tooltip.
- [ ] `not bound to a repository` renders in the body face (no `font-mono`).
- [ ] A not-found collection renders an **empty state** (dashed card + resolving action), not the pink
      `ErrorState`; genuine failures still use `ErrorState`. Verified on the running app, both themes.
- [ ] Gate green + tests.

## WP 2.6 — StatusBadge quiet variant

- **Findings covered:** D-3 (same status, two renderings, two screens — **S3**), **D-TB11** (status density
  is a variant, not an exception).
- **Domain (exact):**
  - `apps/web/src/components/StatusBadge.tsx` (+ `StatusBadge.test.tsx`)
  - `apps/web/src/features/dashboard/ScansTab.tsx` (+ `ScansTab.test.tsx`)
- **Depends:** — · **Size:** M · **parallel** · **Batch D** · **Model:** sonnet, effort **medium**.

`ScansTab.tsx:214-228` renders a *successful* scan as muted `<Text>Completed</Text>` and everything else as
`<StatusBadge>` — the D4 decision (*"a success renders as quiet muted text so the column reads as 'what needs
me', not an all-green wall"*), and that reasoning is **good and preserved**. But it collides with
`StatusBadge.tsx:12-16`'s claim that *"**every** state chip renders through here so one concept has one
rendering"* — and within `ScansTab` alone a success is muted text in the activity table (`:220`) and a chip
in the attention queue (`:353`). **`ScansView.tsx:190` renders the same status as a green chip
unconditionally — that is the *correct* rendering, leave it (and it's out of this WP's domain).**

**Fix (D-TB11):** give `StatusBadge` a **`quiet` prop** — success-in-a-dense-list renders as quiet muted
text through the *same* component, so `StatusBadge` stays the single rendering authority. Convert
`ScansTab.tsx`'s inline `<Text>Completed</Text>` exception to `<StatusBadge quiet …/>`. One component, one
concept, two densities.

### Acceptance (checklist)
- [ ] `StatusBadge` has a `quiet` prop; `quiet` success renders as muted text (D4's look) while non-success
      still renders as the tone-filled chip; `StatusBadge.test.tsx` covers `quiet`.
- [ ] `ScansTab.tsx` no longer renders a raw `<Text>` status exception — every status in it routes through
      `StatusBadge` (grep-clean); the activity table still reads "what needs me" (success is quiet), the
      attention queue still shows chips. Both themes on the running app.
- [ ] `ScansView.tsx` is untouched.
- [ ] Gate green.

## WP 2.7 — Breadcrumb section labels (C-9 closed by owner)

- **Findings covered:** B-4 ("Home" is a synthetic crumb serving a layout constraint — **S3**).
  **C-9 is closed as won't-do** — see below.
- **Domain (exact):**
  - `apps/web/src/App.tsx` (the breadcrumb builder, `~:910-1030`) (+ `App.test.ts` if a crumb assertion changes)
- **Depends:** — · **Size:** S · **parallel** · **Batch D** · **Model:** sonnet, effort **low**.

**C-9 — CLOSED, won't-do (owner decision 2026-07-25). D-UX16 stands.** The audit (S4 polish) wanted tab
strips left-aligned, but that reverses the locked owner decision **D-UX16** (live acceptance walk 2026-07-06:
*"tab strip = full-width bar with CENTERED tabs"*, `TabPanel.tsx:98-103`). The owner confirmed on 2026-07-25:
**keep centered tabs.** **Do NOT touch `TabPanel.tsx`** — this WP is B-4 only.

**B-4 (the narrow, safe change).** The breadcrumb rule is two-tier: detail routes get `[<parent list>,
<entity>]`; depth-1 list roots get `["Home", <label>]`. "Home" is synthetic — it exists only to reach the
**≥2-crumb depth** the top bar renders at (`App.tsx:955`), and there is no "Home" page (`/` → `/dashboard`,
which has no breadcrumb by design). **Fix:** replace the synthetic "Home" crumb with the **sidebar section
label** the sidebar already uses — `Testing > Runs`, `MCP > Scans`, `Skills > …`. Do **not** restructure the
hierarchy. **Do NOT** resurrect the retracted "Agents/Projects/Audit should say Assistant" finding —
`AppShell.tsx:167-170` shows the team fixed a bug in the *opposite* direction; those are sidebar peers, and
the breadcrumbs mirror the IA correctly.

### Acceptance (checklist)
- [ ] Depth-1 list roots show a section-label breadcrumb (`Testing > Runs`, `MCP > Scans`, `Skills > …`)
      instead of `Home > …`; detail routes and the retracted-finding IA are unchanged. Verified on the
      running app, both themes.
- [ ] `TabPanel.tsx` is untouched (C-9 closed — D-UX16 stands).
- [ ] Gate green + `App` tests.

## WP 2.8 — Consistency sweep

- **Findings covered:** C-5 (remainder — the non-Badge count renderings), D-9 (two controls for "Show
  archived" — **S3**), D-10 (long descriptions truncate with no recovery — **S4**). *(C-7's monospace part
  moved to WP 2.5 — see the batch note.)*
- **Domain (exact):**
  - `apps/web/src/features/scans/ScansView.tsx` — **the count readout only** (`:331`'s `<span tabular-nums>`
    → the standard count Badge). Forks after 1.1's ScansView toolbar migration; touch only the count element.
  - `apps/web/src/features/review/ReviewView.tsx` — the "Run n of N" count → standard Badge (C-5).
  - `apps/web/src/features/hub/projects/ProjectLibraryPanel.tsx` (+ `ProjectLibraryPanel.test.tsx`) — D-9.
  - `apps/web/src/features/hub/workforce/DirectoryTab.tsx` — D-10 (agent-card description recovery).
  - `apps/web/src/features/skills/SkillInspector.tsx` — **the frontmatter Description clamp only** (D-10).
- **Depends:** 1.1 (shares ScansView with the 1.1 migration — sequential, forks after 1.1 merges) ·
  **Size:** S · **parallel** · **Batch D** · **Model:** sonnet, effort **low**.

- **C-5 (remainder).** The count Badge (`Badge variant="secondary" tabular-nums`) is the majority and most
  legible rendering; standardise the stragglers on it: `ScansView.tsx:331` (`<span tabular-nums>`),
  `ReviewView.tsx` ("Run n of N" `Text variant="meta"`). (The Dashboard count was added in 2.1;
  Environments in 1.1.) Use `CountBadge` if that export exists in `StatusBadge.tsx`.
- **D-9.** Four surfaces implement "Show archived"; three use a `Checkbox`, `ProjectLibraryPanel.tsx:299`
  (rendered by `ProjectsView`) uses a **`Switch`** and inverts label order. Semantically the checkbox is
  right (it filters a list, it doesn't toggle a system state). Make Projects a `Checkbox` matching
  Sessions/RoleLibraryPanel/ScopedMemoryList. **`ProjectLibraryPanel.test.tsx:345` asserts the `switch` role
  — the test moves with the control** (update it to `checkbox`).
- **D-10.** Agent cards clamp descriptions at ~2 lines with no recovery (`DirectoryTab.tsx`); same in the
  Skills frontmatter Description panel (`SkillInspector.tsx`). Add `title` on the clamped element **at
  minimum** (better: expand on click). *(D-TB5 carve-out: these are clamped **text** elements, not text-less
  `<Button>`s — `title` for recovery is correct.)*

### Acceptance (checklist)
- [ ] `ScansView.tsx:331` and `ReviewView.tsx`'s counts render through the standard count Badge (C-5);
      grep shows no stray `<span className="tabular-nums">`-as-count in these two.
- [ ] Projects' "Show archived" is a `Checkbox` (label order matching the other three surfaces);
      `ProjectLibraryPanel.test.tsx` asserts `checkbox`, not `switch`, and passes.
- [ ] Clamped agent-card and skill-frontmatter descriptions carry a `title` (or expand-on-click) so the
      distinguishing text is recoverable. Verified on the running app.
- [ ] ScansView changes are the **count readout only** (no toolbar/IA edits — 1.1/4.2 own those).
- [ ] Gate green + updated tests.
