# Servers view — deep dive (the "smart layout" re-audit)

This doc corrects an under-call in the first pass. I graded the Servers view on **structural**
correctness — it reaches for `Tabs`, `SplitPanel`, `MetricCard`, `Descriptions`, `@elabs-ai/components-editor` — and
called it "the best surface." That was the wrong bar. The brief was a **smart layout**, and on
information-design + interaction the Servers view has real problems. The right components are present;
their **composition, density, and interaction** are not. Below: every issue (Manuel's list + the ones I
should have caught), each with **source evidence**, the **rubric**, and the **fix**.

Evidence is cited as `file:line`. Live measurements were taken on the 60-tool `mcp-acme-demo` server.
Severity: 🔴 High · 🟠 Medium · 🟡 Low.

Files: `features/servers/ServersView.tsx`, `features/scans/ToolDetailPanel.tsx`,
`features/scans/ToolPlayground.tsx`, `components/TokenViz.tsx`, `components/CodeBlock.tsx`.

---

## 1 · Overview tab — laid out as a single scrolling column of full-width cards

`ServersView.tsx:220-327`. The Overview is a vertical stack: one full-width **Attention** card → a
2-col row (Composition | Top contributors) → one full-width **Server profile** card. The KPI band
(`:189-210`) sits above the tabs and never changes. It wastes horizontal space, repeats nothing useful
twice, and renders **zero** charts despite being a token-analytics tool.

### 1.1 🔴 "Attention & optimization" — grouped per tool, not per finding type
**Observed (`:239-266`):** `recommendations` render as one flat `<ul>`; on the vendor server you get
`Split or trim acme_create_data_object`, `Split or trim acme_add_chart`, `Review the schema for
acme_add_chart`, `Review the schema for acme_create_data_object`, … — i.e. a per-tool list where the
**same finding type repeats** down the page. There is no grouping by *kind* of problem.
**Why it's wrong:** findings are the page's highest-value content (Tier: Act). A flat per-tool list
buries the pattern ("12 tools have oversized schemas") and makes the list as long as the tool count.
Rank/group by value, summarize, then drill. (`information-priority-and-emphasis.md` — Steps 1-4.)
**Fix:** group by **finding type** with a count + total recoverable per group (e.g. *Oversized schemas ·
12 tools · ≈1.8k recoverable*, *Missing/!thin descriptions · 3*, *>1000-token tools · 5*), each group
expandable to the offending tools. A `FacetFilter`/`Accordion` (or grouped `DataTable`) over the
findings. Lead with the group that recovers the most tokens.

### 1.2 🔴 Attention card is full-width for a narrow list — should sit beside Composition
**Observed:** the card spans the whole content width (`:225`) but its content is a single-column list of
short rows; the right ~50% is whitespace.
**Why it's wrong:** match space to information. A narrow list shouldn't reserve full width.
(`information-priority-and-emphasis.md`; `screen-layout-patterns.md`.)
**Fix:** two-column Overview — **Findings (left, ~60%)** next to **Composition + contributors (right,
~40%)**. See the proposed grid at the end of §1.

### 1.3 🔴 No charts / graphs anywhere on Overview
**Observed:** Composition is a single `SegmentedBar` (`:276`, a thin stacked bar from `TokenViz`); KPIs
are flat numbers; there is no trend, no per-tool distribution, no savings visualization.
**Why it's wrong:** this is a **token-cost analytics** product; the roadmap explicitly vendored
`@elabs-ai/components-charts` (`AreaChart`/`LiveLineChart`/`ComposedChart`/`MetricGrid` — `testing/STATUS.md` WP 0.1)
precisely so surfaces like this show cost, trend, and saving potential graphically.
**Fix:** use `@elabs-ai/components-charts`: a **scan-over-time trend** (total tokens across the last N scans), a
**savings/recoverable** visualization, and sparklines on the KPIs (§1.6). Keep `tabular-nums` for exact
values next to the chart.

### 1.4 🟠 "Footprint composition" — one thin bar in a half-empty card
**Observed (`:270-286`):** the card holds only a `SegmentedBar`; ~80% of the card is empty (visible on
both screenshots).
**Fix:** merge **Composition + Top contributors into one card** (see 1.5) and make the contributor bars
share the composition's stacked logic, so the card earns its height.

### 1.5 🟠 "Top token contributors" should live in the composition card, with shared stacked bars + a bottom legend
**Observed (`:288-307`):** a separate card with `RankedTokenList` (name + value + %). Two cards, two
legends' worth of chrome, for one idea ("where do the tokens go").
**Fix:** one **"Token distribution"** card: the server-wide stacked bar on top, the ranked contributors
below it **using the same Name/Description/Schema/Annotation stack per row** (so each tool's bar shows
*why* it's expensive, not just how much), and a **single shared legend pinned to the bottom** of the
card. This is one coherent object instead of two thin ones.

### 1.6 🟠 KPI cards are flat — no trend
**Observed (`:189-210`):** `MetricCard label/value/description`, no chart. "Recoverable" shows `0` noise
when nothing's recoverable.
**Fix:** `MetricCard` with a **micro-sparkline** of that metric across recent scans (the roadmap's own
KPI-rail concept, doc 10 §Zone A). Startup-tokens and Tools trend over scans is exactly the
"is this server getting heavier?" signal the tool exists to show. Hide "Recoverable" at 0.

### 1.7 🟠 "Server profile" — full-width sparse `Descriptions`, no neighbor
**Observed (`:310-326`):** `Descriptions columns={1}` (single column) in a full-width card; 7 short rows,
the right ~60% empty.
**Fix:** **half-width** (`Descriptions columns={2}` in a ~⅓ card) next to a **scan-trend / diff object**
showing the last 5-10 scans (total tokens, Δ vs previous, added/removed tools) — turning dead space into
the "how is this server changing" view (and a shortcut into Compare).

### Proposed Overview grid (smart layout)
```
┌ KPI band (collapses to a thin strip on Tools/Scans — see 2.3) ────────────────────┐
│ Startup tokens ▁▂▅▇  Tools ▃▃▄  Top-3 share  Recoverable(hide if 0)               │
├───────────────────────────────────────────┬───────────────────────────────────────┤
│ FINDINGS  (grouped by type, ~60%)          │ TOKEN DISTRIBUTION (~40%)             │
│  ▸ Oversized schemas · 12 tools · ≈1.8k    │  ▇▇▇▅▃ stacked composition           │
│  ▸ >1000-token tools · 5                    │  1 create_data_object ▇▇▇▅ 3,099     │
│  ▸ Thin/missing descriptions · 3            │  2 add_chart        ▇▇▇▃ 2,804       │
│     └ each expands to the tools             │  3 update_glossary  ▇▇▅  1,519       │
│                                             │  legend: ▇Schema ▇Desc ▇Name ▇Annot  │
├───────────────────────────────────────────┴───────────────────────────────────────┤
│ SERVER PROFILE (½)            │ SCAN TREND — last 8 runs (½)                        │
│ name/transport/url/auth …     │  tokens ▁▂▂▃▅▅▇ (line)  · Δ +1.2k vs prev · ↗ Compare│
└───────────────────────────────┴─────────────────────────────────────────────────────┘
```

---

## 2 · Tools tab

### 2.1 🔴 Master-detail split is NOT resizable
**Observed:** `SplitPanel startSize="380px"` (`ServersView.tsx:336-338`). Live DOM on the Tools tab:
**0 resize handles** (`[data-panel-resize-handle]/[role=separator]` count = 0). `SplitPanel` renders a
fixed 380px rail; the user can't widen the list to read long `vendor_*` names or widen the detail.
**Why it's wrong:** the run modal uses `ResizablePanelGroup` for the same master/detail need; the Tools
tab should too. Consistency + operator control. (`screen-layout-patterns.md` — master-detail.)
**Fix:** replace `SplitPanel` with `ResizablePanelGroup` + `ResizableHandle withHandle` (default ~32/68),
and **make the handle actually draggable** (see 4.1 — the project's handle currently renders with
`cursor:auto`).

### 2.2 🟠 Tool list is off-brand and "not smart"
**Observed:** each row is a stacked ghost `Button` (`:367-388`) with the tool name in **`font-mono`**
(live computed `ui-monospace, 14px` — the body font is Inter). Two stacked lines (name / tok / %).
List padding is symmetric in CSS (`ul` 6px, button 8px) but the Radix `ScrollArea` scrollbar overlays
the right gutter, so rows read tighter on the right than the left.
**Why it's wrong:** mono on every row is heavy and off the brand's sans body; a two-line ghost-button
stack is not a dense, scannable inventory; the scrollbar shouldn't eat the right padding.
(`principles.md` — calm, token-driven; `screen-layout-patterns.md` — list rows.)
**Fix:** a dense `DataTable` (or compact rows) — name in the **sans** body font (mono only for the
monospace *identifier* if desired, at `text-xs`), columns Tokens · % · issues, an optional **cost-weight
bar** cell (thin `Progress`, the roadmap's "weight by cost"), sortable. Reserve a scrollbar gutter
(`scrollbar-gutter: stable`) so left/right padding match.

### 2.3 🟠 KPI band stays full-size on Tools/Scans; should shrink (animated)
**Observed (`:144-217`):** the `SectionHeader` + KPI grid + `TabsList` are all in one `flex-none`
chrome block above the `TabsContent`. They render at full size on every tab, stealing ~⅓ of the viewport
from the Tools master-detail and the Scans table.
**Why it's wrong:** importance is contextual — on Tools/Scans the KPIs are reference, the work is below.
Give the work the room. (`information-priority-and-emphasis.md` — Steps 1-3.)
**Fix:** when `tab !== "overview"`, collapse the KPI band to a thin one-line strip (label: value ·
value · value) with a height transition (`<200ms`, `motion-reduce` safe). Full cards only on Overview.

---

## 3 · Tool detail panel (`ToolDetailPanel.tsx`)

### 3.1 🟠 Off-brand fonts throughout
**Observed:** tool name `font-mono text-base` (`:41`); instruction box raw `text-sm leading-relaxed`
(`:92`); param table raw `text-sm`/`text-xs` (`:138-148`). A mix of mono + ad-hoc Tailwind text sizes
rather than `@elabs-ai/components-*` `Text` variants / type tokens.
**Fix:** route all text through `Text` variants + the new density type tokens (see fix-plan P0.3); reserve
mono for true identifiers only.

### 3.2 🟠 Card header (name → tabs) is not sticky — it scrolls away
**Observed:** the whole panel is rendered inside `ScrollArea` (`ServersView.tsx:401-413`); live check:
the detail header has **no** sticky/fixed ancestor. On a long tool (params + raw JSON) the title + tab
control scroll off, so you lose context and the tab bar.
**Fix:** make the detail's header + `TabsList` a sticky region (`position: sticky; top:0`, token bg) so
identity and tabs stay put while only the tab *content* scrolls.

### 3.3 🟠 Chip placement is scattered
**Observed:** `% of scan` badge sits **next to the title** (`:42`); behavior chips (`read-only`,
`destructive`, …) sit **below the description** (`:45-51`), above the tabs — giving `read-only` visual
weight as if it were primary.
**Why it's wrong:** chips should cluster by role; a low-signal `read-only` hint shouldn't float above the
tab control competing with identity.
**Fix:** one metadata row directly under the title (behavior chips + share% together, quiet `secondary`
variants); don't interleave them with the description and the tab bar.

### 3.4 🟠 Instructions: no length cap, no expand, plain box
**Observed (`:87-95`):** the full `tool.description` is dumped into a `bg-muted` div with no clamp, no
"show more", no editor. Long descriptions blow out the card height.
**Fix:** clamp to ~4-6 lines with an **Expand** affordance that opens the full text in a `Dialog`; render
it with `@elabs-ai/components-editor` `CodeEditor` in **read-only view mode** (markdown/plaintext) so long instructions
get scroll + wrap, matching how the result JSON is already rendered.

### 3.5 🟠 Optimization is buried at the bottom of Breakdown
**Observed (`:97-117`):** suggestions render **after** Token budget **and** Instructions. The
savings/optimization list — the product's whole thesis — is last.
**Fix:** order Breakdown **Token budget → Optimization (recoverable) → Instructions**. Put the
actionable savings directly under the budget bar; push the raw description down.

### 3.6 🟡 The "Run" tab is pointless
**Observed (`:163-182`):** the entire `run` tab contains only an explanatory box + an **"Open run
console"** button — which does exactly what the **Run** button in the panel header already does (`:53-58`).
**Fix:** delete the `run` tab. Keep the single header **Run** button. (Tabs become Breakdown · Parameters
· Raw.)

### 3.7 🟠 Raw tab overflows and uses the plain CodeBlock, not the Monaco editor
**Observed (`:184-188`):** two `CodeBlock`s (`components/CodeBlock.tsx`, a `ScrollArea` + `<pre>`) for
input schema + tool JSON; they overflow the card and don't pad on the right. Meanwhile the **run modal
result already uses `@elabs-ai/components-editor` `CodeEditor`** (`ToolPlayground.tsx:277`) with folding.
**Fix:** render the Raw tab with `@elabs-ai/components-editor` `CodeEditor` (`language:"json"`, `readOnly`, `folding`)
— collapsible/expandable JSON nodes — plus an **Expand** button opening a larger editor in a `Dialog`.
Reuse the component the result panel already uses; retire `CodeBlock` here.

---

## 4 · Run tool modal (`ToolPlayground.tsx`)

### 4.1 🟠 Splitter present but inert; wrong default ratio
**Observed:** the modal uses `ResizablePanelGroup` + `ResizableHandle withHandle` at **45/55**
(`:151-243`). Live: the handle exists (`role=separator`) but computes **`cursor:auto`** — it doesn't
present or behave as a draggable resizer, which is why it reads as "not resizable."
**Fix:** make the handle actually resize (ensure the panel-resize CSS/`cursor:col-resize` and pointer
handling are active — same root cause as 2.1), and set the default to **⅓ Parameters / ⅔ Result**
(`defaultSize={33}` / `{67}`).

### 4.2 🟠 Parameters not sorted required → optional
**Observed:** `params.map(...)` in schema order (`:170`). Live order on `acme_create_data_object`:
`appId(req), dimensions(req), limit(opt), measures(req), sort(opt), stateName(opt)` — required and
optional interleaved. (Same in the Parameters tab, `ToolDetailPanel.tsx:135`.)
**Fix:** sort **required first, then optional** (stable within each group); optionally a subtle divider /
"Optional" subhead between the groups.

### 4.3 🟡 Footer reads as half-width (it isn't) — balance it
**Observed:** I measured the footer at **1366px in a 1368px dialog — it already spans full width**
(`:306-323`). It only *looks* like it stops at the parameters because the vertical resize divider runs
down to the footer edge and the right half is empty until there's a result.
**Fix (cosmetic):** stop the divider at the panel-group bottom (don't let it touch the footer), and give
the footer a balanced two-side layout — run action left, a result-KPIs placeholder/area right — so it
reads as one bar even before a result. (No width bug to fix; this is the visual seam.)

### 4.4 🟡 Redundant run affordance text
**Observed (`:309-313`):** a **"Run tool"** button next to a **"Executes on the live server."** label.
The label restates the button.
**Fix:** drop the label (or fold it into the button tooltip / the header description). The button verb is
enough.

---

## 5 · Cross-cutting in this area
- **Mono overuse** (tool names in lists, titles, params) reads as "code dump," not a branded data app —
  reserve mono for identifiers at small sizes; everything else via `Text` + type tokens.
- **Ad-hoc Tailwind text** (`text-sm`/`text-xs`/`leading-relaxed`) instead of `Text` variants is the
  "off-brand fonts everywhere" the user sees — it bypasses the type scale and won't move when the density
  tokens (fix-plan P0.3) change.
- **`@elabs-ai/components-editor` is already a dependency and already used** (result panel). Reusing it for Instructions
  (3.4) and Raw (3.7) is low-cost and on-brand.
- **`@elabs-ai/components-charts` is vendored** (`testing/STATUS.md` WP 0.1) and currently unused on these screens — the
  Overview is where it should first appear (1.3, 1.6, 1.7).

---

## What I got wrong in pass 1 (so the record is honest)
- I labeled the Servers hub / Tools master-detail / Run console "good" on the strength of their component
  choices and didn't audit composition/interaction. They are **structurally** on the right track but
  **not** a smart layout as shipped. This doc is the correction; the README verdict and fix plan are
  updated to match.
- Two of Manuel's specifics are *partly* mechanical-not-as-stated, and I've said so rather than just
  echoing them: the run-modal **handle exists** (but is inert) and the **footer is full-width** (but reads
  half). The fixes still stand; the framing is accurate.
