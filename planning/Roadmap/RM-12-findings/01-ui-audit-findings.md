---
type: "Work Package Spec"
title: "UI Audit \u2014 Detailed Findings"
description: "Each finding: what was observed (with evidence), why it's wrong (rubric), the fix (exact"
tags: ["roadmap", "RM-12"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# UI Audit — Detailed Findings

Each finding: **what was observed** (with evidence), **why it's wrong** (rubric), **the fix** (exact
`@elabs-ai/components-*` component / token). Screens are in [`_screens/`](./_screens). IDs are referenced by the fix
plan in [`02-prioritized-fix-plan.md`](./02-prioritized-fix-plan.md).

Severity: 🔴 High · 🟠 Medium · 🟡 Low. Issue numbers refer to Manuel's six examples (see README).

---

## A. Global / cross-cutting

### G1 🔴 Type & density scale is B2C, not operator-dense — *issue #3*
**Observed (measured via computed styles):** base `body` = **16px / line-height 24px** (Inter); `h2`
page titles = 20px/600; KPI numerals = **24–36px** (Dashboard KPIs ~36px); Dashboard data-table row
height = **53px**; generous card padding throughout.
**Why it's wrong:** a professional surface is *dense by design* — the repo's own north star says
"calm, dense, operator-grade … `tabular-nums` everywhere." A 16px base with 24px line-height and 53px
rows is tuned for a marketing page. Density is the product here, not a defect to soften.
(`information-priority-and-emphasis.md`; `professional-vs-marketing.md` — "High, on purpose".)
**Fix:** add a **compact density scale** to the token layer (don't hand-tune per component): UI/body
text ~13px, table text ~12–13px, section headings ~14–15px, KPI numerals ~20–24px (not 36px),
table/list row height ~36–40px, line-height ~1.4, `tabular-nums` on every comparing number. Apply via
`@elabs-ai/components-tokens` + Tailwind v4 token overrides so all six themes inherit it. Pair with `brand-ui-theme`.

### G2 🔴 Consumer-register copy on every screen — *issue #5*
**Observed:** every page title carries an explanatory subtitle ("Identify which MCP servers and tool
definitions consume the most startup context.", "Before-and-after token footprint for one server.",
"Global scan history — audit, export, and investigation.", "Local token profile and runtime
information.") and most *sections* repeat the pattern ("Latest successful scan per server, ranked by
total startup tokens.", "Newest first.", "Ranked, actionable findings for this server.").
**Why it's wrong:** operators read this tool daily; they don't need each page narrated. Marketing
explains, tools label. (`professional-vs-marketing.md` — Copy: "Domain terms, terse, verb+object".)
**Fix:** delete page/section descriptive subtitles by default. Keep at most a single short helper line
where it genuinely aids first use (e.g., an empty state). Let the data and column headers carry meaning.

### G3 🟠 Single-level breadcrumb duplicates the page title
**Observed:** the topbar breadcrumb renders one disabled crumb equal to the page H1 ("Dashboard" /
"Scans" / "Compare" / "Settings"); only the Servers view adds a real second crumb (server name).
**Why it's wrong:** a breadcrumb communicates *path/depth*. A one-item breadcrumb that mirrors the
title below it is pure redundancy.
**Fix:** render the breadcrumb only when there's a real drill path (`MCP Servers ▸ <server> ▸ <tool>`,
`Scans ▸ <scan>`). On top-level views show nothing (or just the view name once). Don't print the H1 twice.

### G4 🔴 Settings / Theme information architecture is broken — *issue #6*
**Observed (`_screens/10-quick-settings-popover.png`, `11-settings.png`):** the top-right "Quick
settings" button opens a **modal titled "Settings"** whose entire body is (a) a **Theme** toggle —
which duplicates the theme button sitting immediately to its left — and (b) an **"Open Settings"**
button that navigates to the real Settings *view*. So: settings button → settings modal → "open
settings" → settings page. Separately, **theme** is settable in **two** chrome spots (the topbar toggle and the modal's dropdown —
`ThemeSwitcher` is rendered twice in `AppShell.tsx`, lines 182 + 199) but **not** on the Settings page
(`SettingsView.tsx` has no theme control). The visible theme controls surface only **System / Vendor
Bright / Vendor Dark** — the topbar toggle was observed cycling exactly those three, and the modal labels
itself "System, Vendor Bright, or Vendor Dark." The other shipped themes (`light`, `dark`, `blueprint`,
`high-contrast`) render when set directly but appear **unexposed** to a normal user (see open item H).
And **Settings** is a mid-list nav item, not pinned to the bottom.
**Why it's wrong:** three nested "settings" affordances for two real controls; a theme system that
hides half its themes; and a violation of the convention Manuel cited (profile/settings pinned to the
nav bottom, as in Linear/Slack/most consoles). (`enterprise-app-baseline.md` — settings modal &
theme switcher; `shell-and-navigation.md`.)
**Fix:**
- **Delete the Quick-settings modal entirely.**
- **Pin Settings to the bottom of the left nav** (a `SidebarFooter`/bottom group with the gear; add an
  "About/Runtime" item or fold runtime info into Settings). If/when a user identity exists, the profile
  menu goes here too. For now this single-owner tool just needs Settings pinned bottom-left.
- Put the **full 6-theme** switcher (a `Select`/segmented control listing all themes) **on the Settings
  page**, plus the new **density** toggle (G1). Keep **one** theme control total; the toolbar may keep a
  light/dark quick-toggle *only if* it still routes through the same 6-theme state — otherwise drop it.

### G5 🔴 Native `window.confirm()` for destructive delete — *issue #2*
**Observed:** `apps/web/src/App.tsx:324` — `if (window.confirm(\`Delete ${server.name}?\`)) …`.
**Why it's wrong:** the repo's hard rule is brand-ui-only; a native browser confirm is unthemed, breaks
the six-theme look, ignores focus/keyboard conventions, and is exactly the "smart component selection"
gap Manuel called out.
**Fix:** `@elabs-ai/components-ui` `AlertDialog` with a `destructive` confirm action and the server name in the body.

### G6 🟠 Two different treatments for "a list of things" — *issue #2*
**Observed:** Scan history (ScansView) and the Server registry (ServerRail) are hand-styled
`Card`/`button` row lists; the Scan-detail tools and the Servers list use `DataTable`. Same job, two
looks.
**Why it's wrong:** consistency is a pillar of the enterprise register; a list should be one pattern.
(`screen-layout-patterns.md` — "a searchable list with a count (not a hand-rolled stack of cards)".)
**Fix:** standardize both list surfaces on a dense `DataTable` (or one shared compact list row) with a
status/tokens column, `SearchInput`, optional `FilterBar`, and a count footer.

---

## B. Dashboard — `_screens/01-dashboard-light-full.png`

> Imports confirm the slop: `Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard,
> SectionHeader` + 4 `<Card>` blocks in `DashboardView.tsx`.

### D1 🔴 The per-server token ranking is shown three times — *issues #1, #4*
**Observed:** (1) KPI card "Highest footprint 22,436 / mcp-acme-demo", (2) "Portfolio footprint"
ranked **bar list** (vendor 22,436 / assets 628 / textops 296), (3) "Latest server footprint" **table**
(same three servers, same Tokens). Three encodings of one fact.
**Why it's wrong:** "say each thing in exactly one place." Redundancy with no added decision value is
the definition of a meaningless grid. (`information-priority-and-emphasis.md` — Step 4.)
**Fix:** keep **one** representation — the `DataTable` (it carries Tools / Largest tool / Last scan too)
— and delete the Portfolio bar list. If a hero "who's biggest" glance is wanted, let the table default-
sort by Tokens; don't also bar-chart it.

### D2 🟠 Five-KPI wall with low-value cards — *issue #4*
**Observed:** KPIs = Highest footprint · Latest scan (628) · Scan coverage (3/4) · Attention (1) ·
Largest tool. "Latest scan = tokens of the most recent scan" is a weak metric; "Attention 1 / 1
unscanned" duplicates the "Operational state" panel below it.
**Why it's wrong:** rank by value; a KPI rail is 3–4 *decision* metrics, not a row of whatever numbers
exist. (`information-priority-and-emphasis.md` — Steps 1–2; `screen-layout-patterns.md` — `MetricGrid`.)
**Fix:** trim to ~4 decision KPIs: **Servers**, **Total startup tokens (portfolio)**, **Unscanned /
failed**, **Largest single tool**. Drop "Latest scan". Use `MetricGrid` + `MetricCard` at the new
compact numeral size (G1).

### D3 🟠 Findings aren't actionable (no insight→action) — *issue #5*
**Observed:** "Operational state" lists the unscanned server (`mcp-powerbi-fabric`) but offers no way to
act; you must navigate to Servers and find it.
**Why it's wrong:** an attention item is **Tier: Act** — it must be interactive (what + why + a CTA).
(`information-priority-and-emphasis.md` — Step 3.)
**Fix:** make each operational-state row carry an inline **Scan** (and **Open**) action, so the
dashboard's one job — "what needs attention" — is one click, not a scavenger hunt.

### D4 🟡 Decorative title-row pills + pseudo-primary button — *issues #4, #5*
**Observed:** the title row has "4 servers" / "7 scans" pills (duplicating the Scan-coverage KPI) and a
green **"Servers"** button that is really a nav shortcut dressed as a primary action.
**Fix:** drop the pills (the KPI rail already states counts). If a primary action belongs on the
dashboard it's **"Add server"** or **"Run scan"**, not "go to the Servers tab"; otherwise remove it.

### D5 🟡 Density — KPI numerals ~36px, airy cards
Covered by G1; the Dashboard is the most oversized surface and should shrink most.

---

## C. MCP Servers — mostly good — `_screens/03b-servers-detail-light.png`, `04-tools-tab.png`

> The detail hub, Tools `SplitPanel`, and Run console are the app's best work. Findings here are polish.

### S1 🟠 The empty "Attention & optimization" card dominates the Overview — *issues #1, #4*
**Observed:** when a server has no issues, the Overview's hero is a large card reading "No issues found
/ Every tool has a description and a reasonable token budget," pushing the actually-useful Footprint
composition + Top contributors below the fold.
**Why it's wrong:** the Act tier earns hero space **when there's work to do**; an empty Act tier should
shrink, not headline. (`information-priority-and-emphasis.md` — Steps 1–3.)
**Fix:** when empty, collapse "Attention" to a single calm inline line (or a thin success `Badge`) and
**lead the Overview with composition + top contributors**. Give the hero back to findings only when
findings exist.

### S2 🟠 Server rail = heavy cards with four inline icon-buttons each — *issues #1, #2*
**Observed (`ServerRail.tsx` uses `Card`):** each registry entry is a bordered card showing name, auth
badge, URL, token count, transport, **and** four always-visible icon buttons (Edit / Test / Scan /
Delete).
**Why it's wrong:** four destructive-adjacent actions per row is visual noise and makes the rail loud;
the rail's job is *select a server*. (`screen-layout-patterns.md` — list rows; `principles.md` — calm.)
**Fix:** denser single/two-line rows (name + token/status column); keep at most the **primary** action
(Scan) inline; move Edit/Test/Delete into a hover or `⋯` overflow menu. Consider a `DataTable`-style
rail consistent with G6.

### S3 🟡 "Recoverable 0 · ~0.0%" KPI is noise at zero
**Fix:** hide or de-emphasize the Recoverable metric when it's zero; surface it only when there's
something recoverable to act on.

### S4 🟡 Header badge "none" is an ambiguous standalone token
**Observed:** the detail header reads `streamable_http  none  success` — "none" is the auth mode.
**Fix:** label it `No auth` (or `Auth: none`) so a lone "none" badge isn't cryptic.

### S5 🟡 Tools list vs scan-detail table are inconsistent encodings — *issue #2*
The Tools tab uses a custom ranked list; the Scan detail uses a `DataTable` for the same "tools of a
scan" concept. Align them (see G6) so the two most important data views match.

---

## D. Scans — `_screens/08-scans.png` (empty), `09-scan-detail.png` (selected)

> Selected, the detail is the app's **best** surface (dense sortable `DataTable` + export). Findings are
> about the master list and the empty state.

### SC1 🟠 Master-detail is two big cards with a huge empty detail — *issue #1*
**Observed:** left "Scan history" card + right "Select a scan" card; before selection the entire right
two-thirds is one empty bordered card.
**Why it's wrong:** master-detail should be a `SplitPanel`, and an empty pane shouldn't be a giant card.
(`screen-layout-patterns.md` — master-detail = `SplitPanel`; `StatePanel` for empties.)
**Fix:** `SplitPanel` (list `start`, detail `end`); replace the empty detail card with a compact
`StatePanel`/`EmptyState` that doesn't fill the viewport.

### SC2 🟠 Scan history has no search / filter / sort despite the promise — *issue #2*
**Observed:** the page subtitle says "audit, export, and investigation," and `ScansView.tsx` even
imports `FilterBar` + `SearchInput`, yet the history list is plain rows with none of them.
**Why it's wrong:** "a list needs search, filter, and a count — not just rows."
(`screen-layout-patterns.md`.)
**Fix:** add `SearchInput` (server/date) + `FilterBar`/`FacetFilter` (server, status) + sortable columns
— or render the history as a `DataTable` outright (preferred, per G6). A count footer ("7 scans") already
exists; keep it on the list.

### SC3 🟡 Redundant "Scan history / Newest first." heading inside a card
On a page already titled "Scans," the inner card repeats a heading + a "Newest first." subtitle. Drop the
inner heading; "newest first" becomes the table's default sort indicator.

---

## E. Compare — `_screens/07-compare.png`

> The clearest concentration of the slop pattern. Imports: `Card, CardContent, CardHeader, CardTitle,
> MetricCard, SectionHeader` + 4 `DataTable`s.

### C1 🟠 A hero "Selection" card wrapping three dropdowns — *issues #1, #5*
**Observed:** Server / Before / After are wrapped in a big card with its own "Selection" heading.
**Why it's wrong:** controls are chrome, not content; they don't need a hero card + heading.
**Fix:** a compact `FilterBar` toolbar row (`Server · Before · After`) above the results, no card, no
"Selection" heading.

### C2 🟠 Five KPI cards, most redundant — *issue #4*
**Observed:** Before tokens · After tokens · Delta tokens · Added tools · Removed tools. Before/After are
*inputs* (already shown in the dropdowns), and Added/Removed **duplicate the two tables below** (both 0).
**Why it's wrong:** rank by value; the only decision metric is the **delta**. (`information-priority…` —
Steps 1, 4.)
**Fix:** one Delta KPI (Δ tokens + Δ%); optionally a small added/removed count *as a chip on the table
header*, not as standalone cards.

### C3 🔴 2×2 grid of four big (mostly empty) table-cards — *issues #1, #4*
**Observed:** Largest increases / Largest decreases / Added tools / Removed tools — four `DataTable`s in
four cards, each with its own header, most showing "No increases." etc.
**Why it's wrong:** "one searchable list, not N tables." Four parallel tables force scrolling and waste
space, especially when empty. (`screen-layout-patterns.md`.)
**Fix:** **one** diff `DataTable`: columns Tool · Before · After · Δ · **Change** (added/removed/up/down),
with a `FacetFilter` on Change and a `SearchInput`. One list, one empty state, sortable by Δ — the whole
comparison in a single dense surface.

### C4 🟠 Cross-server / tool-level compare is missing — functionality + *issue #4*
**Observed:** the view only does **same-server scan-to-scan** diff; `CLAUDE.md` flags cross-server as
the north-star and notes "copy mentions it; logic is same-server only."
**Fix:** either build server-to-server + tool-level matching (per roadmap WP 3.8 spirit) or scope the
copy/labels so the screen doesn't promise more than it does.

### C5 🟡 Density / airy cards — covered by G1.

---

## F. Settings — `_screens/11-settings.png`

### SE1 🟠 Sparse two-card page; the most-used control (theme) isn't here — *issues #1, #6*
**Observed:** two cards (Token profile select · read-only runtime info) on an otherwise empty page; the
theme switcher is absent from Settings and lives only in the toolbar/modal; only 3 of 6 themes are
reachable anywhere in the UI.
**Why it's wrong:** Settings is where preferences live; theme + density are the headline preferences.
**Fix:** put the **6-theme switcher** + **density** toggle (G1) on this page; render runtime info as
`Descriptions` (it's nearly that already); the page now justifies its space.

### SE2 🟠 Redundant with the Quick-settings modal — see **G4** (delete the modal).

### SE3 🟡 The "generic_o200k" pill duplicates the combobox value right below it. Drop the pill.

---

## G. Things checked that are NOT problems (so effort isn't wasted)

- **Add-server wizard** — clean 3-step `Wizard`; keep as-is (`_screens/12-add-server-wizard.png`).
- **Run console** — correct large-Dialog + `ResizablePanelGroup` + token cost; keep
  (`_screens/06-run-console.png`).
- **Scan-detail table** — dense, sortable, exportable; this is the density target for the rest of the app.
- **light / dark / blueprint** — render correctly; theming tokens are sound.
- **Toaster / error boundary** — present and wired (`main.tsx`, `ErrorBoundary.tsx`).

## H. Open items to verify during fixes (not asserted as defects)
- **Theme exposure** — the modal's `ThemeSwitcher` dropdown couldn't be enumerated programmatically
  (the Radix menu closes on the next automated action). Confirm whether it lists all six themes or only
  the three the labels name. Either way the fix (G4 / P0.1) puts the full six on the Settings page.
- **High-contrast theme** rendered nearly identical to light when forced (primary changed, little else).
  Confirm `high-contrast` is genuinely high-contrast (thick borders, AAA contrast) — roadmap **WP 4.1**.
- **Dialog dismissal** — confirm `Dialog`/`AlertDialog` close on `Esc` and overlay click (standard Radix
  behavior; spot-check after the `AlertDialog` swap).
- **Keyboard/focus** on the new dense rows and the consolidated Compare table (visible `ring-ring`,
  arrow navigation).
