---
type: "Work Package Spec"
title: "One-row toolbar standard — audit & plan · 2026-07-11"
description: "Status: PLANNED (report only — owner decision 2026-07-11; no code changed yet)."
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T14:03:58Z"
status: "final"
---

# One-row toolbar standard — audit & plan · 2026-07-11

**Status: PLANNED (report only — owner decision 2026-07-11; no code changed yet).**
Source: owner visual walk of the running app (http://localhost:8080/, dark) after the
run-console header redesign of the same day. The run console (`RunBar.tsx`) is the built
reference implementation of this standard; this doc extends it to every other view.

---

## 1. The standard (locked owner decisions, 2026-07-11)

**D-TB1 — Breadcrumb owns page identity, everywhere.** The AppShell breadcrumb is the single
place a page names itself and the single way "up". **In-page H1 title + description blocks are
removed on ALL views** (owner: "remove everywhere") — top-level lists and detail views alike.
Detail routes put the resolved entity identity in the breadcrumb leaf (the run console pattern:
`Runs / <test> · <model>`, via `components/route-crumb.tsx`). Descriptions that carry real
onboarding value move to an info tooltip on the toolbar; the rest are dropped.

> **D-TB1 (amended 2026-07-25, owner).** The breadcrumb owns page *identity*; it does **not**
> replace document *structure*. In-page H1 title/description blocks stay removed (the rule above is
> unchanged). But **every card or panel that titles a real section renders a semantic heading
> (`h2`/`h3`) carrying the `text-title` visual.** `CardTitle` as a bare `<div>`
> (`vendor card.tsx:260-264`) is **not** acceptable for section titles.
>
> Why the amendment: retiring the visible H1 removed the app's last real heading, so the live DOM on
> Runs, Servers and Dashboard returns exactly **one** heading each — the `sr-only` h1 — and the
> Dashboard's five visible sections carry no heading semantics at all (interface-review finding 6,
> 2026-07-25). D-TB1 was applied to the *visual* layer without giving the *semantic* layer a
> replacement. This clause supplies it. Toolbar-reach WP 1.2 deleted `PageHeader` on D-TB1's
> authority and did not cause this — it removed the last counterexample, which is why the standard
> now spells the semantic-heading obligation out. Restated as **D-IC5** in the interface-craft plan
> ([`roadmap/interface-craft/README.md`](/Roadmap/completed/RM-15-interface-craft/item.md)), which implements it
> (WP 1.1: a `SectionCardTitle` wrapper that renders `h2`/`h3` while keeping `text-title`; applied
> only where a card titles a genuine section — decorative card titles stay `div`).

**D-TB2 — Exactly ONE toolbar row per view.** Layout grammar (from `RunBar`):
`[status/context: StatusBadge · chips · truncating muted meta] ····· [right: actions]`.
Filters/search/pickers count as the left cluster of that same row. No second header row, no
floating controls on their own line, no stats strip masquerading as chrome (metrics are
content — KPI cards/summary strips live in the body, stated once).

**D-TB3 — Assistant entry points live ONLY in the Assistant dock.** All header/row "Analyze…"
/ "Explain…" buttons are removed app-wide (owner: "remove all"): Skills "Analyze recent runs",
Compatibility "Explain failures", the per-row "Analyze" in the Runs feed (`SuiteTableRows` /
`RunTableRow`). Precedent: the run console's "Analyze this run" removal (2026-07-11); the
pure prompt-builder helpers can be deleted with them (as `run-analyze.ts` was), except any the
dock's page-hooks still consume (`suite-run-analyze.ts` — verify before deleting).

**D-TB4 — One metric, one home.** A number may not appear in both a header strip and a tab
badge / body card. Where the current header strip duplicates tab badges (server detail:
"Tools 60" in both), the toolbar loses it and the tab badge / body keeps it.

Amends the WP 1.2 `PageHeader` contract: `PageShell` stays; `PageHeader`'s title/description
slots are retired in favour of a one-row toolbar slot. S16 ("title top=66 identical") is
superseded — the invariant becomes "toolbar row top identical on every view".

---

## 2. Per-view findings & target (visual walk 2026-07-11)

Severity: 🔴 worst offenders · 🟡 moderate · 🟢 light touch.

### 🔴 Skills detail — `features/skills/SkillInspector.tsx`
Current: skill name (duplicates breadcrumb leaf) + GitHub chip + **full description paragraph
(duplicated verbatim in the Frontmatter card below)** + version select + 4 buttons (Pull
latest · Publish to GitHub · Download .zip · **Analyze recent runs**) + tab strip.
Target one row: `[version Select] [GitHub chip] ····· [Pull latest] [Publish] [Download .zip]`.
Name → breadcrumb only. Description → Overview/Frontmatter only. Analyze → removed (D-TB3).

### 🔴 MCP Servers detail — `features/servers/ServersView.tsx`
Current: server name (duplicates breadcrumb) + transport/auth/status chips + URL row + right
cluster (Scan now + 3 icon buttons) + **stats strip row** (Startup tokens · Tools · Resources ·
Prompts · Top-3 share · Recoverable) + tab strip = 3–4 rows.
Target one row: `[StatusBadge (last scan)] [transport/auth chips] [URL, truncating meta] ·····
[Scan now] [edit/connectivity/report icons]`. Stats strip: Tools/Resources/Prompts counts
already live in the tab badges (D-TB4) — drop them; move Startup tokens / Top-3 share /
Recoverable into the Overview tab body (they are scan results, i.e. content).

### 🔴 Runs feed — `features/testing/RunsView.tsx` (+ `runs/RunTableRow.tsx`, `runs/SuiteTableRows.tsx`)
Current: H1 + description + Compare runs + New run; second row: search + Type/Status/
Environment/date filters + row count; **"Group by" floats on its own line right**; summary
strip; table with per-row **Analyze** + Open console + ⋯.
Target one row: `[search] [Type] [Status] [Environment] [date] [count] ····· [Group by]
[Compare runs] [New run]`. Title block gone; summary strip stays (content, shown once);
per-row Analyze removed (D-TB3) — row keeps Open console + ⋯.

### 🔴 Compatibility — `features/compatibility/CompatibilityView.tsx`
Current: H1 + description + **"Explain failures"** right; then a labeled two-row filter form
(Scan / Models / View / Server roll-up / Host client) + a count chip.
Target one row of compact controls: `[Scan select] [Models select] [View segmented]
[Roll-up segmented] [Host client select] [count chip]`. Labels become placeholder/aria (the
form-kit compact variant). Explain failures → removed (D-TB3).

### 🟡 Collections detail — `features/testing/collections/CollectionDetail.tsx`
Current: name (duplicates breadcrumb "Collections / Local") + long description + Run collection;
tab strip (Tests/Suites/Git); then ANOTHER row of helper text + New test; then a search row.
Target: one toolbar row `[binding chip (Local/git)] ····· [Run collection]` above the tab
strip; inside the Tests tab ONE row `[search] ····· [New test]`; helper sentences dropped.

### 🟡 Scans (master-detail) — `features/scans/ScansView.tsx`
Current: H1 + description (duplicate "Home / Scans"); detail pane repeats the breadcrumb leaf
verbatim ("barc-benchmark · Jul 11, 12:29") as a heading + profile/date meta + 4 actions
(Reduce footprint · Diff vs previous · Markdown · JSON) + KPI cards + tabs.
Target: list side keeps its single filter row (already good: search + Server/Status + count).
Detail pane one row: `[profile · date, muted meta] ····· [Reduce footprint] [Diff vs previous]
[export ▾ (Markdown/JSON merged)]`. Heading removed — identity is the breadcrumb leaf.
("Reduce footprint" opens the assistant? verify — if it is an assistant hook it falls under
D-TB3; if it is the advisor deep-link it stays.)

### 🟡 Compare scans — `features/compare/CompareView.tsx`
Current: H1 + description; then the A/B picker bar (already a decent one-row toolbar) + tabs.
Target: drop the H1 block; the A/B picker bar IS the toolbar (keep `Δ tokens` readout in it).

### 🟢 Collections list — `features/testing/collections/CollectionsView.tsx`
Current: H1 + description + Import + New collection. Target: one row `····· [Import]
[New collection]` (description → tooltip if kept at all).

### 🟢 Environments — `features/testing/EnvironmentsView.tsx`
Current: H1 + description + New environment. Target: one row `····· [New environment]`.

### 🟢 Dashboard — `features/dashboard/DashboardView.tsx`
Current: H1 + description + View servers. Target: one row `····· [View servers]` — or no
toolbar at all (View servers duplicates the sidebar's MCP Servers nav item; candidate for
removal). `/dashboard` keeps no breadcrumb (home root) — it is the one view whose identity is
the sidebar selection; acceptable.

Not re-audited here (already on the standard or separately specced): Run console (reference),
Compare Workspace (`compare-redesign-2026-07-11.md`), Settings (modal), suite-run console
(`SuiteRunConsoleRoute` — apply the same pass when touched).

---

## 3. Suggested work packages (unscheduled — not in STATUS.md yet)

| WP | Scope | Files (primary) |
| --- | --- | --- |
| TB.0 | Toolbar primitive: retire `PageHeader` title/desc in favour of a shared one-row `ViewToolbar` (left cluster / right actions, h-12, border-b, bg-card — the RunBar recipe); breadcrumb-leaf publishing via `route-crumb.tsx` for the remaining static-crumb detail routes | `components/PageHeader.tsx`, `components/PageShell.tsx`, `components/route-crumb.tsx` |
| TB.1 | Skills detail (🔴) | `features/skills/SkillInspector.tsx` |
| TB.2 | Servers detail (🔴) | `features/servers/ServersView.tsx` |
| TB.3 | Runs feed + row de-Analyze (🔴, D-TB3) | `features/testing/RunsView.tsx`, `runs/*` |
| TB.4 | Compatibility (🔴, D-TB3) | `features/compatibility/CompatibilityView.tsx` |
| TB.5 | Scans + Compare (🟡) | `features/scans/ScansView.tsx`, `features/compare/CompareView.tsx` |
| TB.6 | Collections list+detail (🟡) | `features/testing/collections/*` |
| TB.7 | Light sweep: Dashboard, Environments (🟢) + both-theme walk of all 9 | `features/dashboard/`, `features/testing/EnvironmentsView.tsx` |

Gate per WP: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` + both-theme visual
verification against the running app (not a mock). Acceptance for the whole pass: every view
shows breadcrumb → ONE toolbar row → content; no repeated identity; no assistant buttons
outside the dock; no metric stated twice (D-TB4).
