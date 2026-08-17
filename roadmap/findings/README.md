# UI Audit — MCP Token Footprint

> **Historical record.** This document reports what was observed on the date in its title, against the pre-v4 `@brand/*` design system, when the kit shipped six themes (`qlik-bright`, `qlik-dark`, `light`, `dark`, `blueprint`, `high-contrast`). The project now runs `@elabs-ai/components-*` v4, which ships exactly two — `light` (default) and `dark`. Theme names and counts below are preserved as observed and are NOT current. See [`.claude/rules/styling-and-tokens.md`](../../.claude/rules/styling-and-tokens.md).

Enterprise-grade UI/UX evaluation of the running app at `http://127.0.0.1:8080/`, conducted with the
`brand-ui-enterprise` judgment framework and live browser inspection (visual + programmatic) of every
view, tab, modal, and flow.

- **Date:** 2026-06-20
- **Scope:** the shipped **footprint analyzer** — 5 views (Dashboard, MCP Servers, Scans, Compare,
  Settings) + Run console + Add-server wizard + Quick-settings modal. The planned agent **testing
  run-console** (roadmap docs 10/12, `testing/STATUS.md`) is **not built yet** and is *not* judged here.
- **Method:** agent-browser navigation + screenshots (`_screens/`) at 1440×900, computed-style/DOM
  probing, cross-theme checks (light, dark, blueprint, high-contrast), and source
  cross-reference in `apps/web/src` to name exact `@elabs-ai/components-*` fixes.
- **Docs:** this README (verdict + plan), [`01-ui-audit-findings.md`](./01-ui-audit-findings.md)
  (every finding, with evidence + the rubric + the fix), [`02-prioritized-fix-plan.md`](./02-prioritized-fix-plan.md)
  (phased, actionable work items), and [`03-servers-deep-dive.md`](./03-servers-deep-dive.md)
  (the Servers Overview / Tools / detail-panel / run-modal re-audit with a smart-layout redesign).

---

## The one-paragraph verdict

The **shell is right**; the **content register is wrong in places**. This is a professional operator
tool (per `CLAUDE.md` and the roadmap: *"calm, dense, operator-grade"*), and the app already proves it
can hit that bar — it reaches for the right primitives (`Tabs`, `SplitPanel`, `MetricCard`, `DataTable`,
`@elabs-ai/components-editor`). But on the **Servers** view those right components are composed into a layout that
isn't smart — full-width cards with 80% whitespace, no charts, a non-resizable split, a non-sticky detail
header, off-brand mono fonts, a pointless tab, and a run modal with an inert splitter. The genuinely
solid surfaces are narrower than pass 1 implied: the **Scan-detail `DataTable`** and the **Add-server
`Wizard`**. The Servers re-audit is its own doc — [`03-servers-deep-dive.md`](./03-servers-deep-dive.md). The problem is **category drift toward a consumer/marketing
register**, concentrated in **Dashboard**, **Compare**, **Settings**, **empty states**, and **global
type/density/copy**. That is what reads as "AI slop": redundant card grids that say the same thing
three times, a type scale and row height tuned for a B2C landing page rather than a data tool,
explanatory subtitles narrating every page, and a settings information-architecture that opens a
settings dialog from a settings button to reach the settings page.

**Good news:** still not a ground-up rebuild. The fixes are (1) a density/type-token pass, (2) a copy +
IA cleanup, (3) replacing two card-grid screens (Dashboard, Compare) with patterns the app already uses,
and (4) a **Servers re-layout** — two-column Overview with charts (`@elabs-ai/components-charts` is already vendored), a
resizable split, a sticky detail header, `@elabs-ai/components-editor` for instructions + raw JSON, grouped findings,
and the run-modal fixes in [`03-servers-deep-dive.md`](./03-servers-deep-dive.md). Most of it is
composition + tokens, not new capability.

---

## Manuel's 6 issues — verdict and where

| # | Your example | Verdict | Where it actually lives |
|---|---|---|---|
| 1 | Heavy AI-slop card design everywhere | **Confirmed, but localized** | Dashboard, Compare, Server rail, all empty states. 19 `<Card>` wrappers across 5 views; card-in-card on the server Overview. *Not* the Tools tab / scan-detail / run console. |
| 2 | Not a smart selection of brand-ui components | **Partly confirmed** | `window.confirm()` for delete (App.tsx:324) instead of `AlertDialog`; hand-styled list rows in Scan history + Server rail instead of `DataTable`; Compare uses 4 tables where 1 `DataTable` + `FacetFilter` belongs. But `SplitPanel`, `ResizablePanelGroup`, `Tabs`, `MetricCard`, `Wizard`, `DataTable` *are* used well elsewhere — it's **inconsistent application, not absence**. |
| 3 | Font too large for a dense enterprise app | **Confirmed** | Base body 16px / line-height 24px; H2 20px; KPI numerals 24–36px; Dashboard table rows **53px**. Tuned comfortable/B2C, not operator-dense. |
| 4 | Meaningless card grids, no concept | **Confirmed** | Dashboard shows the per-server token ranking **three times**; 5-KPI walls with low-value cards; Compare is a 2×2 grid of big (mostly empty) table-cards. |
| 5 | Designed like a B2C site, not a tool | **Confirmed (register, not shell)** | Descriptive marketing subtitle under every page title and most sections; airy hero rows; decorative pills/buttons; oversized empty states. The nav shell itself is tool-like. |
| 6 | Settings illogical; profile+settings belong bottom-left | **Confirmed exactly** | Top-bar "Quick settings" opens a **Settings modal** whose body is a Theme toggle (duplicating the adjacent theme button) + an **"Open Settings"** button that navigates to the Settings view. Theme lives only in the chrome (toolbar + modal), not on the Settings page, and the visible controls surface only **3 of the 6 themes**; Settings is a mid-list nav item, not pinned to the bottom. |

---

## Right components in play (quality varies)

> Honest correction to pass 1: the three **Servers** rows below (detail hub, Tools master-detail, Run
> console) have the *right bones* but are **not** a smart layout as shipped — full table in
> [`03-servers-deep-dive.md`](./03-servers-deep-dive.md). The unqualified keepers are **Scan detail**,
> the **Add-server wizard**, and **theming**.

| Surface | Why it's right | Screen |
|---|---|---|
| Server **detail hub** | Sticky `SectionHeader` + action `ButtonGroup` + `Tabs` (Overview/Tools/Scans) + `MetricCard` rail | `_screens/03b-servers-detail-light.png` |
| **Tools** master-detail | `SplitPanel` (tool list ↔ detail), compact ranked list with **token + %** decision signal, segmented composition bar, sub-`Tabs` (Breakdown/Parameters/Run/Raw) | `_screens/04-tools-tab.png` |
| **Run console** (Tool playground) | Large `Dialog`, params-left / result-right, `ResizablePanelGroup`, measures request/response token cost — textbook "promote a high-value task to its own surface" | `_screens/06-run-console.png` |
| **Scan detail** | Dense, sortable `DataTable` (Tool/Total/Schema/Desc/Bytes/Share) + `MetricCard`s + Markdown/JSON export | `_screens/09-scan-detail.png` |
| **Add-server wizard** | 3-step `Wizard` (Connection → Authentication → Review), transport toggle, test-before-save | `_screens/12-add-server-wizard.png` |
| **Theming** | Token-driven; light / dark / blueprint render cleanly | `_screens/02-dashboard-dark.png`, `_screens/13-servers-blueprint.png` |

---

## Severity snapshot

| Sev | Count | Theme |
|---|---|---|
| **High** | 6 | Settings/Theme IA (#6); type/density scale (#3); Dashboard redundancy (#4); Compare card-grid (#4); consumer copy (#5); `window.confirm` (#2) |
| **Medium** | 8 | KPI-wall trimming; insight→action; list treatments unified to `DataTable`; oversized empty states; server-rail noise; Scans search/filter; redundant breadcrumb; cross-server compare gap |
| **Low** | 6 | Decorative pills/buttons; duplicate badges/labels; "none" auth label; high-contrast theme differentiation; section-subtitle filler; KPI-at-zero hiding |

Full detail, evidence, and the exact `@elabs-ai/components-*` fix for each: [`01-ui-audit-findings.md`](./01-ui-audit-findings.md).
The **Servers** Overview / Tools / detail-panel / run-modal re-audit adds ~20 more findings (≈3 High / 11
Medium / 6 Low) — grouped findings, charts on Overview, resizable split, sticky detail header,
`@elabs-ai/components-editor` for instructions + raw JSON, optimization placement, Run-tab removal, run-modal splitter /
param-order / footer: [`03-servers-deep-dive.md`](./03-servers-deep-dive.md).

---

## Fix plan at a glance (full version in `02-prioritized-fix-plan.md`)

**P0 — register + IA (highest leverage, low effort, mostly global)**
1. Rebuild Settings/Theme IA — delete the Quick-settings modal, pin **Settings** (and About) to the
   **bottom of the left nav**, move the full **6-theme** switcher + a density toggle onto the Settings
   page, keep exactly one theme control. *(Issue #6)*
2. Replace `window.confirm()` delete with `@elabs-ai/components-ui` `AlertDialog` (destructive). *(Issue #2)*
3. Introduce a **denser type + spacing token scale** (UI text ~13px, table ~12–13px, KPI ~20–24px not
   36px, row height ~36–40px, line-height ~1.4). *(Issue #3)*
4. Strip consumer **copy**: remove page/section descriptive subtitles; show the breadcrumb only on real
   drill paths. *(Issues #5, #3)*

**P1 — replace the two slop screens with patterns the app already owns**
5. **Dashboard:** say each thing once — one server table (not table + bar list + KPI), a 3–4 metric
   decision KPI rail, and an inline **Scan** CTA on unscanned servers. *(Issues #1, #4)*
6. **Compare:** a `FilterBar` toolbar (Server · Before · After) + **one** diff `DataTable` with a
   Change column + `FacetFilter` + one Delta KPI — not 5 KPIs and a 2×2 table-card grid. *(Issues #1, #4)*
7. **Scans:** `SplitPanel`, add `SearchInput` + `FilterBar` to the history, shrink the empty detail. *(Issues #1, #2)*

**P1.5 — Servers smart-layout redesign (doc 03 — the part you called out)**
7a. **Overview → two columns + charts:** group findings by *type* (count + recoverable each); Findings (~60%) beside a merged Token-distribution card (stacked bar + per-tool stacked rows + one bottom legend, ~40%); Server profile to ½ width beside a `@elabs-ai/components-charts` scan-trend; KPI sparklines; collapse the KPI band to a strip on Tools/Scans.
7b. **Tools tab:** `ResizablePanelGroup` (resizable, default ~32/68) instead of the static `SplitPanel`; replace the mono ghost-button list with a dense **sans** `DataTable` + cost-weight bars; reserve a scrollbar gutter.
7c. **Tool detail:** sticky header + tabs; **Optimization directly under Token budget**; instructions clamped + Expand modal via `@elabs-ai/components-editor`; Raw tab on `@elabs-ai/components-editor` (folding + Expand), retire `CodeBlock`; tidy the chip row; **remove the redundant Run tab**.
7d. **Run modal:** make the splitter actually drag + default **⅓ ∶ ⅔**; sort params required→optional; balance the footer; drop the redundant button label.

**P2 — consistency + polish**
8. Server rail: denser rows, row actions into a hover/`⋯` menu; collapse the empty "Attention" hero. *(Issue #1)*
9. Unify both list surfaces on `DataTable`; align the Tools list with the scan-detail table. *(Issue #2)*
10. Six-theme + a11y pass (verify high-contrast is genuinely high-contrast) — this is roadmap **WP 4.1**.
11. Forward-looking: build the upcoming **testing run-console** from the *corrected* Servers patterns
    (doc 03) + the Scan-detail / Wizard surfaces — not the Dashboard/Compare card-grids or the as-shipped
    Servers layout.

---

## How this maps to the framework

- **Classification:** professional / operator → **calm** register. (`reference/professional-vs-marketing.md`)
- **Shell archetype:** **B — enterprise admin/console** (labeled sidebar + topnav + breadcrumb +
  secondary rail + detail). Correct; keep it. (`reference/shell-and-navigation.md`)
- **Baseline:** shell ✓, app icon + sidebar collapse ✓, ThemeProvider + switcher ⚠️ (only 3/6 themes
  exposed; lives in the wrong place), Toaster ✓, detail surfaces ✓ (`SplitPanel`/`Dialog`), settings
  modal ✗ (redundant/illogical — the one baseline miss). (`reference/enterprise-app-baseline.md`)
- **Screen layout & information priority:** the core misses are on Dashboard and Compare —
  *say-each-thing-once*, *rank by value*, *one searchable list not N tables*, *insight→action*.
  (`reference/screen-layout-patterns.md`, `reference/information-priority-and-emphasis.md`)
