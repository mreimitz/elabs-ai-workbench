# brand-ui — upstream issue list

Every UI limitation this project hit that should be **standard functionality in `@brand/*`**, with the
workaround we were forced to build locally. Compiled 2026-08-01 against **brand-ui v1.9.0** (vendored,
`vendor/brand/`) from: the app source (`apps/web/src/`), the recorded upstream-gap ledgers
([`roadmap/interface-craft/upstream-gaps.md`](../roadmap/interface-craft/upstream-gaps.md),
[`roadmap/assistant-hub/brand-ui-upstream-prompt.md`](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)),
the per-plan `STATUS.md` gap notes, and the two UI audits in [`/docs`](.).

**Ground rule this project ran under:** `.claude/rules/brand-ui-only.md` — every visible element is a
`@brand/*` component, no hand-rolling, no second kit. Every item below is therefore a place where that
rule *couldn't* be honoured cleanly, or was honoured only by building a wrapper the library should own.

**70 open issues** (originally 73; the 3 `@brand/flow` items were verified fixed upstream).

**Rough scale of the workaround surface:** 40 local components in `apps/web/src/components/`
(21 of them pure gap-fillers), a 900-line in-repo `@brand/ai` test double, a 352-line app-side token
override sheet, and ~99 test files that mock a `@brand/*` package because it can't render.

Severity: **P0** = blocked or shipped a defect · **P1** = forced a durable local wrapper ·
**P2** = friction/polish.

---

## Table of contents

| § | Package | Issues |
| --- | --- | --- |
| [1](#1-brandai--the-ai-composer-and-message-surface) | `@brand/ai` | 14 |
| [2](#2-branddata--datatable) | `@brand/data` | 7 |
| [3](#3-brandcharts) | `@brand/charts` | 6 |
| [4](#4-brandtokens--theming--type--density) | `@brand/tokens` | 7 |
| [5](#5-brandui--app-chrome--layout-standards) | `@brand/ui` (chrome) | 9 |
| [6](#6-brandui--component-api-seams) | `@brand/ui` (API seams) | 13 |
| [7](#7-brandui--missing-form--input-primitives) | `@brand/ui` (forms) | 8 |
| [8](#8-brandflow--all-fixed-upstream-do-not-file) | `@brand/flow` | ~~3~~ → **0** (fixed upstream) |
| [9](#9-build-packaging--testability) | build / DX | 6 |

> **→ To hand this to a coding agent in the brand-ui repo, use
> [`brand-ui-handover/`](./brand-ui-handover/00-README.md)** — 6 self-contained, batched prompts with
> upstream paths, inlined evidence and per-item acceptance criteria. This file is the reference index;
> that pack is the executable form.
>
> **Verification status (2026-08-01):** all code claims re-checked against v1.9.0 source. Three items
> were found **stale and corrected**: the entire `@brand/flow` section (fixed upstream), TOK-4 (the
> hierarchy defect was ours, not theirs), and DATA-7 (measured, not literal). AI-1 and DATA-5 were
> sharpened. **Measured values** (contrast ratios, character/column counts) are from 2026-06/07 audits
> and were **not** re-measured.

---

# 1. `@brand/ai` — the AI composer and message surface

This is the single worst-affected package. We shipped two production composers (the App-assistant dock
and the full-page Assistant Hub) and had to bypass the library's own top-level wrapper for both.

### AI-1 · `Composer` passes `<ArrowUp>` as children, overriding the send-state icon — **the Stop button is invisible** — P0
Re-verified at v1.9.0. `PromptInputSubmit` is **correct**: right `aria-label={isGenerating ? "Stop" :
"Submit"}`, right click routing to `onStop`, right `type` switching, and a full four-state icon machine
(`prompt-input.tsx:1136-1170`). The bug is **entirely `Composer`'s call site** — it forwards `status` and
`onStop` properly, then passes a static `<ArrowUp>` as `children`, and `children ?? Icon` means the child
wins (`composer.tsx:125-127`). Net effect: the button *behaves* as Stop but **always looks like Send**.
Sighted users get no signal that a turn is running or that the button now stops it; screen-reader users
are announced correctly — which is likely why it survived an a11y audit. This is the "missing stop/start
button in the AI composer". **Fix is a one-line deletion.**
- **Workaround:** abandoned the `Composer` wrapper entirely; re-composed its identical two-tone frame
  (status strip + recessed `PromptInput` well) from the underlying `PromptInput*` primitives in **both**
  composers, purely to restore `ready → ArrowUp` / `submitted → Spinner` / `streaming → stop square`.
- **Ask:** `Composer` must forward `sendStatus` through to `PromptInputSubmit` and never hardcode
  children. Ship the send-state machine as the wrapper's contract, not something callers rebuild.

### AI-2 · No Send↔Stop state contract for a running turn — P0
Beyond the icon bug, there is no library answer to the actual interaction question: *what does the
primary action do while a turn is streaming?* We had to design and test it ourselves — a single merged
control that is **Stop** while running + composer empty, and flips to **Send** (queueing a follow-up)
the moment text is typed.
- **Evidence:** [`Composer.tsx:438-447`](../apps/web/src/features/hub/Composer.tsx#L438-L447),
  [`Composer.test.tsx:164-216`](../apps/web/src/features/hub/Composer.test.tsx#L164-L216)
- **Ask:** ship `PromptInput` with a first-class `onStop` + merged-action contract (or an explicit
  documented two-button variant), including the aria-label flip. Every consumer will otherwise re-derive
  it differently.

### AI-3 · `PromptInput`'s Enter handler submits **while the button shows Stop** — P1
Enter routes to submit regardless of send status, so a second Enter mid-turn queues a message and
mis-buckets the running turn's late events. Every consumer must add its own guard.
- **Evidence:** [`AssistantComposer.tsx:91-96`](../apps/web/src/features/assistant/AssistantComposer.tsx#L91-L96)
- **Ask:** gate the built-in Enter handler on `sendStatus`.

### AI-4 · `PromptInputButton` isn't a `Button`, so it falls outside every button standard — P1
It can't take the app's `IconButton` treatment (tooltip == `aria-label`), so the speech-input control
is the **one** icon-only control in the whole app still carrying a bare native `title` — invisible to
assistive tech, ~1.5 s OS delay, unstyled.
- **Evidence:** [`toolbar-reach/verification-report.md:158`](../roadmap/toolbar-reach/verification-report.md)
- **Ask:** compose `PromptInputButton` from `@brand/ui` `Button` and give it a `label`-driven tooltip.

### AI-5 · `MessageBranch*` is uncontrolled — `defaultBranch` is read once, at mount — P1
There is no controlled mode, so switching branches from outside the component is impossible; we remount
via `key` to force it.
- **Evidence:** [`hub/ConversationPane.tsx:1380`](../apps/web/src/features/hub/ConversationPane.tsx#L1380)
- **Ask:** controlled + uncontrolled modes (the `ChangeReview` pattern the library already ships).

### AI-6 · `PromptInputCommandItem` (cmdk) spreads props **before** its own `id`/`role`/`aria-selected` — P1
Those three attributes can't be set from outside, so `aria-activedescendant` wiring for an `@`-mention
popup can only be done by reading the committed DOM back positionally after render.
- **Evidence:** [`MentionEditor.tsx:55-67`](../apps/web/src/features/hub/MentionEditor.tsx#L55-L67)
- **Ask:** spread consumer props last, or expose an explicit `id` prop per item.

### AI-7 · No mention-capable input — P1
No `@`-mention/inline-chip editor exists anywhere in `@brand/*`, so we shipped an owner-approved
`contentEditable` **`brand-ui-allow` escape hatch** — the only one of its kind in the app.
- **Evidence:** [`MentionEditor.tsx:523`](../apps/web/src/features/hub/MentionEditor.tsx#L523) (523 lines + a 190-line test)
- **Ask:** a `MentionInput` / `PromptInputMention` primitive with a chip model and serialization.

### AI-8 · No model-emittable in-message `Form` — P1
An assistant that asks structured questions needs a form inside a message bubble. Nothing ships.
- **Ask (already filed in detail):** `MessageForm` + zod `FormSpec`, deliberately shaped to also serve
  **MCP elicitation `requestedSchema`** (spec 2025-11-25) so one renderer covers both.
- **Spec:** [`brand-ui-upstream-prompt.md` §A](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)

### AI-9 · No model-emittable in-message `Table` — P1
`@brand/data`'s `DataTable` is app chrome, not message content. There is no lightweight, never-throws,
streaming-tolerant table for LLM output.
- **Ask:** `MessageTable` + `TableSpec` (column formats, graceful truncation notice, never throws).
- **Spec:** [`brand-ui-upstream-prompt.md` §B](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)

### AI-10 · No part-grouping engine for reasoning/tool traces — P2
Collapsing adjacent reasoning/tool parts into groups (with status roll-up and stable identity across
streaming re-renders) is re-implemented per consumer.
- **Ask:** `GroupedParts` + `groupPartByType`, with `display: "inline" | "standalone"` so approval cards
  can never fold into a thinking accordion. [§C](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)

### AI-11 · No message edit-in-place — P2 · [§D](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)
### AI-12 · No per-message feedback control — P2 · [§E](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)
### AI-13 · No selection/quote toolbar over transcript text — P2 · [§F](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)
### AI-14 · `Suggestion(s)` has no streaming trailing-loader — P2 · [§G](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)

> AI-8…AI-14 were already written up as a coding-agent brief for the brand-ui monorepo
> ([`brand-ui-upstream-prompt.md`](../roadmap/assistant-hub/brand-ui-upstream-prompt.md)) — that document
> is the ready-to-execute version of these seven.

---

# 2. `@brand/data` — DataTable

`DataTable` owns its entire `<table>`/`<thead>`/`<th>`/`<td>`/`<tr>` render and exposes almost no seams
into it. Four of the six items below are the *same root cause*.

### DATA-1 · Inner scroll box is hardcoded `overflow-hidden` — **columns are silently deleted** — P0
Below `lg` this doesn't merely block scrolling, it **clips columns out of existence with no visual hint**.
Measured: the Issues triage table lost **8 of 9 columns** at 390 px; the dashboard footprint table lost
*Δ vs previous* / *Largest tool* / *Last scan* / *Open server* the same way. `DataTableProps`'
`className`/`rest` reach only the **outer** wrapper.
- **Evidence:** [`lib/table.tsx:172-200`](../apps/web/src/lib/table.tsx#L172-L200) (P0 mobile audit T4)
- **Workaround:** a Tailwind arbitrary-variant descendant selector reaching the vendor's own internal
  div (`[&>div:first-child]:overflow-x-auto!`), with `:first-child` scoping so pagination controls aren't
  hit, and a `!` because both rules land in the same stylesheet.
- **Ask:** a `scrollClassName` prop (or just `overflow-x-auto` by default below a breakpoint).

### DATA-2 · No column pinning — P1
No `getIsPinned`, no pinned cell styling. Pinning has to be expressed from **inside the cell content**,
which means every pinned cell fakes its own sticky geometry and background fill.
- **Evidence:** [`lib/table.tsx:223-236`](../apps/web/src/lib/table.tsx#L223-L236) `pinnedCellClass()`
- **Follow-on bug it caused:** the original hardcoded `bg-card` fill painted an opaque white pill over
  the library's own zebra rows; we now thread a `bg` param through every column helper.

### DATA-3 · No `onRowClick` / no row class hook — P1
Making a row a click target requires a wrapper-level delegated click listener that finds the `<tr>`,
guards against interactive descendants and text-selection drags, then re-dispatches onto a hidden
`data-row-nav` button so the click target can't drift from the visible one.
- **Evidence:** [`lib/table.tsx:243-268`](../apps/web/src/lib/table.tsx#L243-L268) `delegateRowNavClick`

### DATA-4 · No `caption` prop and no per-column head-cell hook (`scope="col"`) — P1
Neither a real `<caption>` nor `scope="col"` can be handed to the component as a prop, so the table has
no accessible name and no column-header association. `scope` has **no passthrough seam at all** — we
reach the rendered `<th>`s directly via ref.
- **Evidence:** [`lib/table.tsx:330-345`](../apps/web/src/lib/table.tsx#L330-L345)

### DATA-5 · Renders "Page 1 of 1" with disabled Previous/Next for a single page — P2
Dead chrome on every short table. We ship a `shouldPaginate()` helper + unit test purely to gate
`enablePagination` on `rowCount > pageSize` — and one call site still forgot it (audit finding C-8).
**Update (v1.9.0):** upstream now *warns* about this in the console (`data-table.tsx:283-299`) but still
renders it (`:682`). The diagnosis exists upstream; the fix doesn't.
- **Evidence:** [`lib/table.tsx:322-327`](../apps/web/src/lib/table.tsx#L322-L327)

### DATA-6 · No row expansion — P1
The unified Runs feed needs suite rows that expand to member runs. `DataTable` can't, so that entire
view was rebuilt on raw `@brand/ui` `Table*` + `@brand/data` `SearchInput`/`FacetFilter` — losing
virtualization and every `DataTable` affordance.
- **Evidence:** [`testing-ia/STATUS.md:138`](../roadmap/testing-ia/STATUS.md)

### DATA-7 · `FacetFilter` and `@brand/ui` form controls don't share a control height — P2
A guaranteed height/baseline mismatch on **every** mixed toolbar row. Residual of audit finding C-1
("three control heights, three top edges, 11 px of scatter, in the app's most-seen row"). ⚠️ **The
`h-26`/`h-30` figures were *rendered* measurements, not literal classes — a grep of v1.9.0 source finds
neither.** The misalignment is real; the cause may be padding/border/line-height. Re-measure before filing.
- **Ask:** a shared, density-aware control-height token consumed by both packages.
- **Evidence:** [`toolbar-reach/verification-report.md:62-64`](../roadmap/toolbar-reach/verification-report.md)
- **Ask:** one shared control-height token across `@brand/ui` and `@brand/data`.

---

# 3. `@brand/charts`

### CHART-1 · No per-datapoint or per-legend-item `onClick` — **charts cannot drill down** — P0
Bar/Line/Area expose hover tooltips only. Every analytics chart in this app is a dead end as a click
surface, which is fatal for an observability product.
- **Evidence:** [`DrillList.tsx:5-14`](../apps/web/src/features/dashboard/testing/DrillList.tsx#L5-L14),
  [`ContextChart.tsx:360-365`](../apps/web/src/features/testing/ContextChart.tsx#L360-L365)
- **Workaround:** a `DrillList` component — a keyboard-reachable `<ul>` of rows rendered *underneath*
  every chart — plus a separate "Jump to turn" button strip under the context bar chart. Two parallel
  UIs for one interaction.
- **Ask:** `onDatapointClick` / `onLegendClick` on the chart families.

### CHART-2 · `LineChart`/`AreaChart` x is a **hard time scale** — a string x throws — P0
`x: "Turn 3"` → `RangeError: Invalid time value`, a full render crash. There is no categorical mode for
line/area (only `BarChart` is categorical).
- **Evidence:** [`ContextCurves.tsx:15-18`](../apps/web/src/features/testing/compare/matrix/ContextCurves.tsx#L15-L18)
- **Workaround:** emit **synthetic `Date` values** that carry no calendar meaning, and label the real
  turn only in the tooltip.
- **Ask:** an `xScale: "time" | "band" | "linear"` prop.

### CHART-3 · `XAxis` has no tick formatter, and **silently drops duplicate tick labels** — P0
It always formats ticks through a month+day `Intl.DateTimeFormat`. Because CHART-2 forced synthetic
dates, every tick formatted identically and the axis **collapsed to one dead tick**.
- **Evidence:** [`ContextCurves.tsx:20-28`](../apps/web/src/features/testing/compare/matrix/ContextCurves.tsx#L20-L28)
- **Workaround:** re-space the synthetic x-values a **full day apart** so the day-of-month coincidentally
  equals the turn number. That is the only lever the library exposes.
- **Ask:** `tickFormat` / `tickValues` on `XAxis`.

### CHART-4 · `Gantt` is calendar/day-granular only — P1
Zoom clamps to `[2, 200]` px/day, so a seconds-wide run timeline can't be expressed at all. The run
Gantt was dropped.
- **Ask:** a time-unit-agnostic scale (or at least sub-day units).

### CHART-5 · Charts cannot render under jsdom — P0 for correctness
`@visx/*` doesn't resolve/render in jsdom, so **33 test files mock `@brand/charts` as a no-op**. The
consequence is that chart-prop bugs pass the quality gate — we shipped a missing-`xDataKey` crash that
every test was blind to.
- **Evidence:** 33 files with `vi.mock("@brand/charts")`; `apps/web/src/features/servers/ServersView.qlik-answers.test.tsx:28`
- **Ask:** ship an official `@brand/charts/test` double, or an SSR-safe render path.

### CHART-6 · `@visx/*` declares React 16–18 peers against a React-19 library — P2
Every `pnpm install` prints peer warnings. Cosmetic but permanent.

---

# 4. `@brand/tokens` — theming, type & density

The app carries a **352-line `app.css`** that is overwhelmingly compensation for this package.

### TOK-1 · Role ⇄ foreground fill pairs fail WCAG AA — P0
Five pairs measured below 4.5:1 at their rendered 11–13 px sizes: `qlik-bright` `--primary` 4.31,
`--success` 4.31, `--info` 3.76; `qlik-dark` `--destructive` 3.02. Each theme was clearly tuned
independently with no shared on-fill check — dark had already solved four of five and simply never got
the same treatment for `--destructive-foreground`.
- **Evidence:** [`upstream-gaps.md §1`](../roadmap/interface-craft/upstream-gaps.md)
- **Workaround:** an `@theme` override block + a `tokens-contrast.test.ts` gate asserting all 5 pairs × 2 themes.

### TOK-2 · Byte-identical semantic tokens — P0
`--primary === --success` and `--ring === --info`, **in both themes**. A focus ring is indistinguishable
from an "Info"/"Running" chip; an action is indistinguishable from a success, by colour alone.
- **Evidence:** [`upstream-gaps.md §2`](../roadmap/interface-craft/upstream-gaps.md), [`app.css:309-344`](../apps/web/src/styles/app.css#L309-L344)

### TOK-3 · **No `--shadow-*` tokens at all** — every Tailwind `shadow-*` utility is a transparent no-op — P0
`getComputedStyle(:root).getPropertyValue('--shadow-2xl')` → `""`. In Tailwind v4 that resolves to
`--tw-shadow: 0 0 #0000`, so `shadow-sm`/`-md`/`-lg`/`-xl`/`-2xl` **add a class and paint nothing**.
Combined with near-identical surface fills (`qlik-bright` `--card` L1.0 vs `--background` L0.985 — a 1.5%
gap), a "card" reads as a flat outlined box. Discovered as a live defect: the Hub composer's card
was invisible.
- **Workaround:** a bespoke per-theme `--composer-elevation` token with a hand-tuned two-layer
  `box-shadow`, applied via **inline style** because className shadows can't work.
- **Evidence:** [`app.css:323-327`](../apps/web/src/styles/app.css#L323-L327), [`Composer.tsx:460-468`](../apps/web/src/features/hub/Composer.tsx#L460-L468)
- **Ask:** an elevation token ramp per theme.

### TOK-4 · Type is not density-aware — ⚠️ **CORRECTED: mostly not a library defect** — P2
**The original "no typographic hierarchy" claim was wrong and is retracted.** Re-verified at v1.9.0: the
shipped scale is well-formed — `--text-display: 1.875rem` (30px) / `--text-title: 1.25rem` (20px) /
`--text-body: 0.875rem` (14px) / `--text-kpi: 2rem` (32px), a **2.14× display:body ratio** with tuned
per-role weights and letter-spacing (`tokens/src/themes.css` ~L1075). The 18px-h1 / 15px-title flattening
was **our own earlier compact override**, self-inflicted — not upstream.

What *is* real: type is not density-aware while `--spacing` is, so `[data-density="compact"]` rescales
boxes but not text. That is an **explicit, documented upstream decision** ("Type is deliberately NOT
density-aware (07 §E.4): compact tables want tighter spacing, same readable text"), with sound reasoning.
- **Workaround:** we redeclare 11 role tokens + 8 raw Tailwind steps under `[data-density="compact"]`.
- **Ask:** an *opt-in* density-aware type layer — **or a reasoned decline**, which is a perfectly good
  outcome. We are disagreeing with a deliberate decision, not reporting a bug.

### TOK-5 · Stock `density.css` "compact" isn't compact enough for an operator console — P2
`--spacing: 0.222rem` still reads as a marketing page; we redeclare `0.205rem` so padding-driven rows
land at 36–40 px. — [`app.css:88`](../apps/web/src/styles/app.css#L88)

### TOK-6 · Inter ships with no font-smoothing rule — P2
`@brand` ships the Inter `@font-face` but never sets `-webkit-font-smoothing`, so on WebKit/Blink the UI
subpixel-renders noticeably bolder than designed. Every consumer must add the same global rule.
- **Evidence:** [`app.css:22-27`](../apps/web/src/styles/app.css#L22-L27)

### TOK-7 · No way to restrict the exposed theme set — P2
`THEMES`/`THEME_META` are all-or-nothing. To expose only `qlik-bright` + `qlik-dark` we filter the
switcher, guard `localStorage` pre-mount in `main.tsx`, **and** run a `useEffect` safety net in Settings
to coerce a persisted `blueprint` back. Three defenses for one config need.
- **Ask:** an `allowedThemes` option on `ThemeProvider`.

---

# 5. `@brand/ui` — app chrome & layout standards

> This section is the "**missing standardized toolbars**" item. It is the largest structural gap: the
> library ships shell furniture but no *grammar* for what goes in a view, so every view invented its own
> — and we then had to run a whole remediation plan
> ([`roadmap/toolbar-reach/`](../roadmap/toolbar-reach/README.md)) to converge them.

### CHROME-1 · **No standardized view toolbar** — P0
There is no component for the single most repeated row in any operator app: *state + context + filters
on the left, actions on the right*. The consequences we measured across ~40 routes:
- **six** different filter-chip idioms (`FacetFilter` chip · `FilterChip` split button · `Badge` + ghost ✕
  · hand-rolled `Badge` + ✕ · `ToggleGroup` segmented · `Label` + `Checkbox`) — audit C-2
- **five** different renderings of a result count, including *absent* — audit C-5
- three control heights and three top edges in the app's most-seen filter row — audit C-1
- views stacking **two** toolbars, the top one nearly empty — audit B-2
- **Workaround:** a locally-owned [`ViewToolbar.tsx`](../apps/web/src/components/ViewToolbar.tsx)
  (~200 lines of contract + docblock) that every view must now mount, plus a
  [`ResultCount`](../apps/web/src/components/ResultCount.tsx) primitive, plus a retired predecessor
  (`TableToolbar`) that had to be deleted because *two contracts for one row was itself the bug*.
- **Ask:** a `ViewToolbar` in `@brand/ui` with `info` / status / filter-chip / results / actions slots,
  one height, and one filter-chip component.

### CHROME-2 · `PageShell` has no toolbar header variant and no scroll contract — P1
`@brand/ui`'s `PageShell` has no `headerVariant="toolbar"` slot, so we maintain a **local `PageShell`**
that every feature view imports instead. Two views accidentally imported the real one and silently lost
their toolbar — exactly the kind of drift a library should make impossible.
- **Evidence:** [`ux-overhaul/STATUS.md:284-290`](../roadmap/ux-overhaul/STATUS.md), [`components/PageShell.tsx`](../apps/web/src/components/PageShell.tsx)

### CHROME-3 · No modal tier system — P1
`Dialog`/`AlertDialog`/`Sheet` are primitives with no guidance on size, scroll ownership, footer order,
section headings, or dirty-state handling — so dialogs diverged into "512 px scroll tubes". We built a
**four-tier kit**: `ConfirmDialog` (AlertDialog, focus on the safe action) · `FormDialog` (≤6 fields,
640 px, no internal scroll) · `WideDialog` (≥960 px, left-rail or tabs, fixed header/footer, only the
section scrolls) · `WorkbenchDialog` (95vw × 90vh), plus `DialogSection`/`AdvancedGroup` and a shared
unsaved-changes guard.
- **Evidence:** [`components/dialogs/`](../apps/web/src/components/dialogs/) (5 components + 5 test files)
- **Ask:** ship the tiers, or at least a `size` + `scroll` contract and a `dirty`/discard-guard prop.

### CHROME-4 · `TabsList` neither wraps nor scrolls — it clips — P1
A 5–6 tab strip is simply cut off inside a phone viewport or a narrow pane/sheet, with no scroll and no
hint. Naïve `justify-center` makes it worse (it strands the *first* trigger off the left edge).
- **Workaround:** [`ScrollableTabsList.tsx`](../apps/web/src/components/ScrollableTabsList.tsx) —
  `overflow-x-auto` wrapper + `justify-center-safe`.

### CHROME-5 · `ChatShell`'s built-in header slot is a hardcoded `h-12` — P1
It can't be made to line up with the app's own `h-14` `TopNav`, so the assistant dock's header renders
**outside** `ChatShell` entirely just to match the adjacent top bar. `ChatShell` also hardcodes
`bg-background`, needing a `bg-transparent` override to sit on the sidebar surface.
- **Evidence:** [`AssistantDock.tsx:607-612`](../apps/web/src/features/assistant/AssistantDock.tsx#L607-L612)

### CHROME-6 · `ResizableHandle` requires a `ResizablePanelGroup`, which **cannot width-transition** — P1
A right-hand dock that both animates open/closed (like the left `Sidebar`) *and* is resizable is
impossible. This forced the app's only structural `brand-ui-allow` escape hatch: a hand-rolled
`role="separator"` with full pointer-capture drag + `aria-valuenow/min/max` + keyboard resize.
- **Evidence:** [`AppShell.tsx:913-940`](../apps/web/src/components/AppShell.tsx#L913-L940)
- **Ask:** a standalone resize handle, or a transitionable panel group.

### CHROME-7 · `ThemeSwitcher` is uncontrolled — P1
No controlled mode and no "System / follow OS" preference, so it can't be driven from a lifted
preference key. We compose a `DropdownMenu` `ThemeMenu` instead, which is what keeps the Settings
mirror in sync, survives reload, and enforces TOK-7's theme filtering.
- **Evidence:** [`AppShell.tsx:993-1000`](../apps/web/src/components/AppShell.tsx#L993-L1000)
- **Ask:** `value`/`onValueChange` + a `system` preference.

### CHROME-8 · No adaptive split-pane / master-detail primitive — P2
`SplitPane` and `AdaptivePanelGroup` are local: `ResizablePanelGroup` has no responsive collapse to a
single column, so narrow-width behaviour is hand-built per surface.
- **Evidence:** [`SplitPane.tsx`](../apps/web/src/components/SplitPane.tsx), [`AdaptivePanelGroup.tsx`](../apps/web/src/components/AdaptivePanelGroup.tsx)

### CHROME-9 · `Toaster` spreads `...props` **after** its own `toastOptions` — P1
Passing `toastOptions` therefore **replaces the library's wholesale**, so every consumer must re-declare
`description`/`action`/`cancel` from scratch. Compounding it: sonner's `richColors` palette is hardcoded
and theme-agnostic — its error plate measured **4.35:1 in `qlik-bright` (below AA)** — so `richColors`
had to be dropped and all four toast types re-mapped onto semantic tokens by hand.
- **Evidence:** [`main.tsx:70-100`](../apps/web/src/main.tsx#L70-L100)
- **Ask:** merge `toastOptions` instead of replacing, and make the type plates token-driven.

---

# 6. `@brand/ui` — component API seams

A recurring shape: the component renders the right thing but exposes no seam to fix its semantics.

### API-1 · `CardTitle` has no `as`/`level` — the app has **no document outline** — P0 (a11y)
It renders `<div className="text-title">`, never a heading. A card titling a real section contributes no
`h2`/`h3`, so live DOM on Runs/Servers/Dashboard returned **one heading each** (the `sr-only` h1) — a
screen-reader user cannot move between sections.
- **Workaround:** [`SectionCardTitle.tsx`](../apps/web/src/components/SectionCardTitle.tsx)
- **Ask:** `as` / `level` on `CardTitle`. — [`upstream-gaps.md §3`](../roadmap/interface-craft/upstream-gaps.md)

### API-2 · `AlertTitle` hardcodes `<h5>` with no `as`/`asChild` — P1
Its type signature even mismatches (`forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>`).
- **Workaround:** [`AlertHeading.tsx`](../apps/web/src/components/AlertHeading.tsx) + [`InlineError.tsx`](../apps/web/src/components/InlineError.tsx)

### API-3 · `SelectTrigger` clips its value with **no recovery path** — P1
It ships `[&>span]:line-clamp-1` and no `title`, so *every* select in the app truncates with no way to
read the full text — worst on composed labels like `${server} · ${date} · ${n} tools`, where the
discriminating token is the one that gets cut (audit C-4).
- **Workaround:** [`TitledSelectTrigger.tsx`](../apps/web/src/components/TitledSelectTrigger.tsx) — requires
  `selectedLabel` so a call site *cannot forget it*.
- **Ask:** a default `title`, or expose the selected label. — [`upstream-gaps.md §4`](../roadmap/interface-craft/upstream-gaps.md)

### API-4 · `CardDescription` has no measure cap — P1
No `max-w`, so prose in a full-width card runs edge to edge — **measured 190 characters per line**.
- **Workaround:** [`ProseCardDescription.tsx`](../apps/web/src/components/ProseCardDescription.tsx) (`max-w-[68ch]`)
- **Ask:** cap prose components by default, or ship a `prose` variant. — [`upstream-gaps.md §5`](../roadmap/interface-craft/upstream-gaps.md)

### API-5 · `CardDescription` **silently drops its own `text-muted-foreground`** — P1 (bug)
A `tailwind-merge` interaction with `text-wrap-balance` removes it — reproducible with **zero** wrapper
or `className` involvement: `cn("text-sm text-muted-foreground text-wrap-balance")` →
`"text-sm text-wrap-balance"`. Every `CardDescription` in every consuming app renders at default
foreground instead of muted.
- **Evidence:** [`upstream-gaps.md §6`](../roadmap/interface-craft/upstream-gaps.md)

### API-6 · `Combobox` has no `disabled` prop — P1
We shipped a **disabled `Input` standing in for a disabled `Combobox`** — visibly a different control.
- **Evidence:** [`ux-overhaul/STATUS.md:122`](../roadmap/ux-overhaul/STATUS.md)

### API-7 · `Combobox` has no `aria-label`/`aria-labelledby`/`id` passthrough and doesn't spread props — P1
`ComboboxProps` is closed to `{options, value, onValueChange, placeholder, searchPlaceholder, emptyText,
className}`. The trigger's accessible name is the *selected value*, and a wrapping `<label>` would
clobber it — so the control's **purpose** can never be announced.
- **Workaround:** wrap in a `role="group"` labelled "Session switcher".
- **Evidence:** [`owner-acceptance-walk.md` Appendix 2](../roadmap/assistant-hub-ux/owner-acceptance-walk.md)

### API-8 · `Checkbox` has **no indeterminate glyph** — P1 (a11y)
`checked="indeterminate"` correctly emits `aria-checked="mixed"`, but the drawn mark is **visually
identical to checked**. A tri-state "select all tools" master checkbox is unreadable sighted.
- **Workaround:** an adjacent "N / M tools" badge to disambiguate.
- **Evidence:** [`owner-acceptance-walk.md` Appendix 1](../roadmap/assistant-hub-ux/owner-acceptance-walk.md)

### API-9 · `Slider` doesn't forward props to its hardcoded thumb — P1 (a11y)
`aria-valuetext` (e.g. "step 3 of 12" on a replay scrubber) can only be set via a scoped ref-effect that
reaches into the rendered Radix thumb.
- **Evidence:** [`testing/STATUS.md:51`](../roadmap/testing/STATUS.md)

### API-10 · `Progress` has no destructive/tripped variant — P1
A guardrail meter that has been exceeded can't be shown as such; we signal it with a `text-destructive`
**label** beside a still-normal-coloured bar.
- **Evidence:** [`testing/STATUS.md:41`](../roadmap/testing/STATUS.md)

### API-11 · `StatusBadge` is a closed 7-state enum with no density mode — P1
It can't express states this app genuinely has (gray-outline `aborted`, amber-outline
`stopped_guardrail`, dashed `pending`), and it has no `quiet` mode — a dense list needs *success* to read
as muted text rather than an all-green wall of chips.
- **Workaround:** [`components/StatusBadge.tsx`](../apps/web/src/components/StatusBadge.tsx) — recomposed
  from `Badge` + tone tokens, mirroring how the library composes its own.
- **Ask:** open the state vocabulary (accept a `{label, tone}`), add `quiet`.

### API-12 · `Tree`'s interactive label can't right-align accessories — P1
Per-file token badges had to be dropped from the skill workspace explorer.
- **Evidence:** [`skill-ide/STATUS.md:29`](../roadmap/skill-ide/STATUS.md)

### API-13 · No `IconButton` primitive (tooltip == `aria-label`) — P1
The library ships `Button size="icon"` and `Tooltip` separately, so the app drifted into **three**
hover-hint mechanisms across ~124 icon buttons: ~14 Radix `Tooltip`, ~20 bare native `title` (invisible
to AT), ~89 `aria-label`-only with **nothing on hover** (audit D-7).
- **Workaround:** [`IconButton.tsx`](../apps/web/src/components/IconButton.tsx) — derives tooltip **and**
  `aria-label` from **one `label` prop** so they cannot diverge, plus a focusable wrapper `<span>` so a
  disabled button (which carries `pointer-events-none`) still shows its `disabledReason` tooltip and
  `aria-describedby`. Backed by a repo rule and a lint hook.
- **Ask:** ship it. Note our version deliberately has **no `asChild`** — worth designing for.
  See [`.claude/rules/icon-affordances.md`](../.claude/rules/icon-affordances.md).

---

# 7. `@brand/ui` — missing form & input primitives

The library covers `Input`/`Select`/`Checkbox`/`Switch`/`Textarea` and stops. Everything a real
configuration UI needs above that we built. All six live in
[`apps/web/src/components/form/`](../apps/web/src/components/form/), each with its own test file.

| # | Missing primitive | What it replaced | Ref |
| --- | --- | --- | --- |
| **FORM-1** | `TagInput` — chips committed on Enter/comma, paste splits on commas, backspace removes last | free-text blobs | [`TagInput.tsx`](../apps/web/src/components/form/TagInput.tsx) |
| **FORM-2** | `KeyValueEditor` — key/value rows with per-row secret masking + reveal | a raw **`Env JSON` textarea** | [`KeyValueEditor.tsx`](../apps/web/src/components/form/KeyValueEditor.tsx) |
| **FORM-3** | `ListEditor` — one string per row → `string[]` | a raw **`Args JSON` textarea** | [`ListEditor.tsx`](../apps/web/src/components/form/ListEditor.tsx) |
| **FORM-4** | `SliderNumber` — slider + synced numeric input, with an explicit "provider default" (`null`) state | `−/+` steppers on 0–1 floats (temperature, top-p) | [`SliderNumber.tsx`](../apps/web/src/components/form/SliderNumber.tsx) |
| **FORM-5** | `BoundedNumber` — bounded numeric where **empty is a real state** ("No limit"), clamped on blur not per-keystroke | a stepper you increment away from ∞ | [`BoundedNumber.tsx`](../apps/web/src/components/form/BoundedNumber.tsx) |
| **FORM-6** | `SegmentedField` — label + segmented control with **sticky** selection (Radix `ToggleGroup` emits `""` when you click the active segment, silently clearing it) | dropdowns for ordered 3-value scales | [`SegmentedField.tsx`](../apps/web/src/components/form/SegmentedField.tsx) |

### FORM-7 · No free-text-plus-suggestions input — P1
No `@brand` equivalent of a `<datalist>`-backed input (a valid custom value *plus* a suggestion roster).
Forced a `brand-ui-allow` native `<datalist>`.
- **Evidence:** [`RuleEditorDialog.tsx:606-618`](../apps/web/src/features/watch/RuleEditorDialog.tsx#L606-L618)

### FORM-8 · No `FieldRow` / label+control+help+error row — P1
Field composition (clickable label, help text, inline error next to the field, `aria-describedby` wiring)
is left to consumers. — [`FieldRow.tsx`](../apps/web/src/components/FieldRow.tsx), [`InlineError.tsx`](../apps/web/src/components/InlineError.tsx)

> **Bonus a11y bug worth fixing in the library:** `NumberInput` clamping *per keystroke* fights anyone
> typing a long token budget. Our wrapper clamps **on blur only** — the library should too.

---

# 8. `@brand/flow` — ✅ ALL FIXED UPSTREAM (do not file)

> **Re-verified against v1.9.0 source on 2026-08-01: all three prior gaps are closed.** They were
> recorded against v1.6.0 and fixed in the interim. **Our app still carries the workarounds — they are
> now dead code and should be deleted** (a cleanup task on our side, not a brand-ui issue).

| Was | Status at v1.9.0 | Evidence |
| --- | --- | --- |
| ~~`FlowNode` hardcodes top/bottom handles, ignores `sourcePosition`/`targetPosition`~~ | **Fixed** — takes a `handles?: FlowNodeHandles` config for all four sides (`FLOW_ALL_SIDE_HANDLES`) and honors `sourcePosition`/`targetPosition` | `flow/src/flow-node/flow-node.tsx:15-110` |
| ~~No smoothstep `FlowEdge`~~ | **Fixed** — ships | `flow/src/flow-edge/`, `flow/src/flow-smart-edge/` |
| ~~No group/background/lane primitive~~ | **Fixed** — ships | `flow/src/flow-group-node/` |

**Local cleanup now possible:** the app-side LEFT-target/RIGHT-source node wrapper, the local
`SkillFlowEdge`, and the absolutely-positioned lane boxes can all be replaced with the shipped
components.

---

# 9. Build, packaging & testability

### DX-1 · **99 test files mock a `@brand/*` package** — P0
33 mock `@brand/charts`; 66 mock `@brand/ai` / `@brand/flow` / `@brand/editor`. We maintain a
**900-line hand-written `@brand/ai` test double** in-repo
([`brand-ai-mock.tsx`](../apps/web/src/features/hub/test-support/brand-ai-mock.tsx)) that has to
faithfully reproduce library internals — including its *uncontrolled* `MessageBranch` semantics — or
tests lie. This mock is a permanent maintenance liability that will silently drift on every version bump.
- **Ask:** ship official test doubles (`@brand/ai/test`, `@brand/charts/test`) as part of the package.

### DX-2 · Components need undocumented jsdom polyfills — P1
Radix `Dialog` reads `matchMedia` + `ResizeObserver`; cmdk touches `ResizeObserver` +
`Element.scrollIntoView`. None ship a documented test setup, so every consumer rediscovers them.
- **Evidence:** [`vitest.setup.ts:5-17`](../apps/web/vitest.setup.ts#L5-L17)
- **Ask:** publish a `@brand/ui/test-setup` entry.

### DX-3 · `@brand/editor`'s `?worker` imports break Vite's dev prebundle — P1
`pnpm dev` fails outright; we verify visual work through Docker or `vite preview` of a production build
instead. Losing HMR on a UI project is a significant tax.

### DX-4 · The bundle is memory-hungry enough to OOM the build — P1
Monaco + Milkdown + Mermaid together require `NODE_OPTIONS=--max-old-space-size=3400` on a constrained
machine, and the parallel workspace build gets SIGTERMed under load (we run
`-r --workspace-concurrency=1`).
- **Ask:** finer-grained entry points so a consumer that only wants `CodeEditor` doesn't pull Milkdown + Mermaid.

### DX-5 · No published packages — P2
`@brand/*` is consumed as **release tarballs in `vendor/`** wired via `file:`. Every upgrade is a manual
`gh release download` + re-pin + reinstall, and there is no semver range or changelog diff to review.

### DX-6 · Vendored source is the only reliable API reference — P2
Several findings above were only resolvable by reading `vendor/brand/*.tgz` contents or
`node_modules/@brand/*/src/`. `.d.ts` + manifest describe the surface but not behaviour (hardcoded
children, prop-spread order, internal DOM structure) — which is exactly where these bugs live.

---

## Appendix — explicitly *not* upstream issues

Recorded so they aren't re-filed. From
[`interface-craft/conventions.md §6`](../roadmap/interface-craft/conventions.md): raising `active:scale`,
icon-size normalization, concentric radius, `text-base sm:text-sm`, logical-property conversion. Also
**not** gaps: `@brand/ui` `Tree` for file explorers (correct, use it), `Charts/AutoChart` and
`AI/ChangeReview` (the two components explicitly cited as the *quality bar* the AI-8…AI-14 asks should
match), and `@brand/tokens`' `-text` on-tint tokens (verified to exist and pass).

---

## Suggested triage

**Fix first — these shipped visible defects:**
AI-1 (stop button invisible — a one-line fix) · DATA-1 (columns silently deleted) · CHART-1/2/3
(no drill-down, crash on string x, collapsed axis) · TOK-1/2/3 (AA failures, indistinguishable semantic
roles, no shadow tokens) · API-1 (no document outline) · API-5 (`CardDescription` drops its own muted
colour — reproducible in one line).

**Highest leverage as new components:**
CHROME-1 `ViewToolbar` (kills six chip idioms + five count idioms + three toolbar heights at once) ·
API-13 `IconButton` (kills three hover-hint mechanisms across ~124 controls) · CHROME-3 dialog tiers ·
FORM-1…6 (the whole form kit) · AI-8/AI-9 (`MessageForm`/`MessageTable`).

**Cheapest wins:** DATA-5 (single-page pagination) · TOK-6 (font-smoothing) · TOK-7 (`allowedThemes`) ·
API-2/API-3/API-4 (add `as` / `title` / `max-w`) · CHROME-9 (merge `toastOptions`).
