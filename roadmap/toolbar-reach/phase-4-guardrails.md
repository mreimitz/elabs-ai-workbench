# Phase 4 — Guardrails and acceptance · Batch F

**4.2 · 4.3 · 4.4 run parallel (3 wide); then 4.1 runs solo, last.** Enter after Batch E merged. Domains are
disjoint (scans / runs+collections / settings+rules), and 4.1 touches only hooks + new tests + settings.

**4.2 and 4.3 are the only genuinely open design questions in the plan** — that is why they run last, at
opus/high effort. Everything before them applies a decided standard; these two decide something. **4.1 is
written last on purpose:** several of its tests would fail until the earlier phases land — that failure is the
guardrail proving it works.

---

## WP 4.2 — Scans IA: list-first

- **Findings covered:** D-1 (Scans: a 390px rail beside 800px of nothing — **S2**).
- **Domain (exact):** `apps/web/src/features/scans/ScansView.tsx` (+ a co-located component if the split
  extraction warrants it, and its test). Forks after 1.1 (toolbar), 2.8 (count), 3.2 (icons) — so it builds
  on the settled ScansView. **If the redesign needs an App.tsx route change, report it** (the audit's fix is
  internal to ScansView's own in-view `AdaptivePanelGroup`, so it likely doesn't).
- **Depends:** 1.1 · **Size:** L · **solo-ish** (parallel with 4.3/4.4, disjoint) · **Batch F** · **Model:**
  opus, effort **high**.

Scans is a **list-first** surface: you arrive to scan *history*, not to a pre-selected scan. Servers and
Skills are correctly master-detail (you pick a known entity); Scans isn't — yet it's squeezed into a narrow
master rail where the `Δ vs previous` header wraps onto two lines and the timestamp collapses under the
server name, while the detail pane (55% of the window) holds an empty-state card. **The most valuable column
is the least readable.**

**This is an open design decision — pick one and justify it in the report:**
- **(a)** Make the list **full-width until a scan is picked**, then transition to master-detail (the list
  narrows into the rail and the detail pane appears). This matches the "you arrive at history" mental model.
- **(b)** Widen the rail and drop the `Δ vs previous` column into a **sparkline** so it reads at rail width.

**(a) is the audit's lead recommendation** and the stronger fit; choose it unless (b) proves materially
simpler with equal clarity. Keep the settled `ViewToolbar` list-rail filter row, the scan-detail toolbar,
`shouldPaginate`, and the scroll contract intact.

### Acceptance (checklist)
- [ ] On the running Scans view with no scan selected, the list is readable at a comfortable width (either
      full-width, or a rail wide enough that server name + timestamp + Δ don't collapse/wrap) — measured, both
      themes. The empty detail pane no longer sits beside a cramped rail.
- [ ] Selecting a scan transitions to the detail view (master-detail) without breaking the scroll contract or
      the toolbars; deselect/back returns to the list. Deep-linking `/scans/:id` still lands on that scan.
- [ ] The chosen approach (a or b) is recorded with a one-paragraph justification.
- [ ] Gate green + tests.

---

## WP 4.3 — Surface off-nav features

- **Findings covered:** B-6 (15 nav destinations for ~40 routes — **S3**).
- **Domain (exact):** `apps/web/src/features/testing/RunsView.tsx`,
  `apps/web/src/features/testing/collections/CollectionsView.tsx` + their tests. **If embedding an existing
  view (SuitesView / ReviewView / RubricsView) needs a light prop on that view or an App.tsx redirect, report
  it** rather than reaching across — the PM will widen the Domain if the embed genuinely requires it.
- **Depends:** 1.1 · **Size:** L · **parallel** (disjoint from 4.2/4.4) · **Batch F** · **Model:** opus,
  effort **high**.

`WatchRulesView`, `RubricsView`, `ReviewView`, `CompareWorkspace`, `SuitesView` and both consoles have **no
nav entry**. Some is deliberate and commented (`App.tsx:1205-1210` — watch rules + rubrics are reached from
Settings → Testing). But **Suites is a first-class concept in the data model, reachable only by drilling
through a run**, and **Review has a toolbar button on Runs and nothing else**. *"If an operator can't find a
feature without knowing its URL, it isn't shipped."*

**Fix — no new nav items** (the 4-item Testing section is a hard-won simplification). Surface them **where the
work is:**
- A **"Suites" tab** in the Runs feed (`RunsView`) — the runs feed is where suite runs already surface.
- **Review / Rubrics as a section** in Collections (`CollectionsView`) — the test home.

Keep the deliberate Settings→Testing entries; this is additive discoverability, not a nav restructure. Every
surfaced route must still render usefully with **zero query params** (D-TB10).

### Acceptance (checklist)
- [ ] Suites are reachable from the Runs feed (a "Suites" tab or equivalent in-feed surface) **without**
      knowing the URL; the 4-item Testing nav is unchanged (no new nav items).
- [ ] Review / Rubrics are reachable from Collections without knowing the URL.
- [ ] Each surfaced destination renders usefully with no query params (D-TB10); deep links still work.
- [ ] Verified on the running app, both themes; gate green + tests.

---

## WP 4.4 — Settings theme control + route-vs-dialog rule

- **Findings covered:** D-5 (Settings hosts a pointer instead of a setting — **S3**), B-5 (two entry
  mechanisms for the same task — **S3**), **D-TB10** (route vs dialog, written down).
- **Domain (exact):**
  - `apps/web/src/features/settings/SettingsView.tsx`
  - `.claude/rules/routes-vs-dialogs.md` (**new** — writes down D-TB10)
  - `CLAUDE.md` (**§10 rules map only** — the one-line pointer to the new rule)
- **Depends:** — · **Size:** S · **parallel** (disjoint from 4.2/4.3) · **Batch F** · **Model:** sonnet,
  effort **low**.

**B-5 / D-TB10 (no conflict — just write it down).** Creating a run is a wizard dialog; creating a collection
is a dialog; but `/testing/runs/new`, `/testing/runs/compare`, `/testing/runs/review` are *routes*. There's no
visible rule for which task gets a URL and which gets a modal (and A-2 was the consequence). Write the rule in
`.claude/rules/routes-vs-dialogs.md`: **anything an operator would bookmark, deep-link or share is a route;
anything transient is a dialog; every route renders something useful with zero query params.** Add the
CLAUDE.md §10 pointer. (A-2's fix already made `/testing/runs/new` obey it — this WP records the rule.)

**D-5 — CONFIRMED, apply it (owner decision 2026-07-25, supersedes WP 6.7).** The audit wants the theme
control **in Settings as well** as the top bar (*"Two entry points to one preference is fine; a signpost is
not"*) — today the General pane just reads *"Theme … is switched from the top bar."* This reverses ux-overhaul
**WP 6.7** (2026-07-06: *"remove the Settings theme mirror"*), and the owner confirmed on 2026-07-25 to bring
it back. **Add a real theme `Select` to the General pane** — options **System · Bright · Dark**, wired to the
same `ThemeProvider`/`useTheme` the top-bar control uses so it switches the live theme — **keep the top-bar
shortcut** (two entry points, one preference). Update the `SettingsView.tsx:550` comment (which currently
asserts "theme stays SOLELY in the top bar (WP 6.7)") to record the D-5 supersession. Do **not** re-add the
filtered-out `blueprint` theme — the switcher exposes only `light`/`dark` (+ System), per
`lib/theme.ts` `ALLOWED_THEMES`.

### Acceptance (checklist)
- [ ] `.claude/rules/routes-vs-dialogs.md` states D-TB10; `CLAUDE.md` §10 lists it.
- [ ] A working theme `Select` sits in Settings General (System / Bright / Dark) and switches the live theme;
      the top-bar control is retained and stays in sync; only the two allowed themes (+ System) are offered.
      Verified on the running app in both themes. The `:550` comment is updated to record the D-5 supersession.
- [ ] Gate green + tests.

---

## WP 4.1 — Guardrails (runs LAST, solo)

- **Findings covered:** — (the audit's §F guardrail block: *"so this doesn't drift a third time."*)
- **Domain (exact):**
  - `.claude/hooks/**` (a new hook + its registration) and `.claude/settings.json` (register the hook, per
    the existing `enforce-brand-ui` pattern)
  - `apps/web/src/**/*.test.*` — **NEW test files only** (do not edit existing tests owned by other WPs)
  - `apps/web/src/lib/table.test.tsx` (the pagination guardrail test may live here)
- **Depends:** 4.2, 4.3, 4.4 (and, in effect, every prior phase — the tests assert the earlier work landed) ·
  **Size:** M · **solo** · **Batch F, last** · **Model:** opus, effort **medium**.

This WP exists **because this is the second time** the same drift happened. Ship four guardrails; several
would have **failed** before the earlier phases landed — that's the point (write them last, when they pass):

1. **A test that fails on a bare `enablePagination`.** Assert (by scanning `apps/web/src` source, or via a
   lint-style test) that every `enablePagination` is `shouldPaginate(...)`-guarded — no bare
   `enablePagination`/`enablePagination={true}` on a `DataTable`. (This is the C-8 drift.)
2. **A test that fails if `SelectField` is imported by any module matching `*Toolbar*` or `*Filter*`**
   (D-TB9 — label-above controls banned in toolbars). Scan imports of `components/SelectField` and fail on a
   toolbar/filter-module importer.
3. **An `enforce-brand-ui`-style hook rejecting `title=` on a `<Button>` (or `IconButton`) with no text
   child** (D-TB5). Model it on `.claude/hooks/enforce-brand-ui.mjs`; register in `.claude/settings.json`.
   Allow `title` on text-bearing elements (the D-10 recovery carve-out).
4. **A test asserting `PageHeader` and `TableToolbar` no longer exist** (D-TB6/D-TB8) — fail if either
   `components/PageHeader.tsx` or `components/TableToolbar.tsx` is present, or if anything imports them.

### Acceptance (checklist)
- [ ] All four guardrails exist and are green on the current tree (because the earlier phases landed).
- [ ] Each guardrail **provably fails on the pre-fix pattern** — demonstrate by temporarily introducing the
      bad pattern (a bare `enablePagination`, a `SelectField` import in a `*Toolbar*` file, a `title` on a
      text-less `<Button>`, a stub `PageHeader.tsx`) and showing the test/hook flags it, then revert. Record
      the demonstration in the report.
- [ ] The hook is registered and does not false-positive on legitimate `title` (text-bearing elements) or on
      non-web files.
- [ ] `apps/web/src/**` edits are **new test files + `lib/table.test.tsx` only** (no edits to tests other
      WPs own).
- [ ] Gate green (`typecheck · test · build · lint`).
