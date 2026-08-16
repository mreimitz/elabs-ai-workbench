# 12 Testing — the Inspector, designed against Chrome DevTools

> **Status:** design concept. Companion to `09-testing.md` (scope) and `10-testing-ui-concept.md`
> (run-console UI). This doc **reframes the right pane** of the Run Console (`10` §4–§5) as a
> **panelized, Chrome-DevTools-style Inspector**. It is the deep "what can we learn from DevTools"
> analysis the owner asked for, wired into the UI-design step. No production code; wireframes are
> schematic; everything maps to `@brand/*` and the six themes.

---

## 0. Why Chrome DevTools is the right reference

A Test **run** is, structurally, *a session of heterogeneous events unfolding over time*: model
requests, tool calls, tool results, context snapshots, errors, created artifacts. That is the **exact
shape** of a page load in Chrome DevTools — a stream of requests, scripts, timings, and stored
state. DevTools is twenty years of refinement on the problems we now have:

- **Heterogeneous events on one timeline** → Network waterfall.
- **Drill from a list row into exhaustive detail** → request → Headers/Payload/Response/Timing.
- **Stable at thousands of rows** → virtualized lists, throttled paint.
- **Expert density without noise** → quiet chrome, monospace numbers, filter chips, keyboard-first.
- **One mental model, many lenses** → tabs (Console / Network / Performance / Application) over the
  *same* underlying session.

So we don't invent an inspector vocabulary — we adopt one our users already know. The Tests surface
is **conversation (left) + Inspector (right)**; the right pane *is* our DevTools.

This doc keeps every metric and data source from `10` §4–§5 (KPI rail, context-window chart,
step/packet log, packet inspector). It **re-organizes** them from three stacked zones into
**named panels with a shared detail drawer**, and it **adds** the capabilities the DevTools lens
makes obvious and that `10` under-specified: a true **Network waterfall**, a streaming **Console**,
a **Performance/Token timeline**, and an **Application** panel for **responses + artifacts**
(documents created and downloaded).

---

## 1. Panel-by-panel analysis — steal / adapt / drop

| DevTools panel | What it nails | For us | Our panel |
| --- | --- | --- | --- |
| **Console** | chronological log; severity levels; filter + text search; *preserve log*; clear; group/expand; "x of y" | **steal** | **Console** — the live event stream (reasoning, tool one-liners, warnings, errors, raw JSON-RPC frames) |
| **Network** | request table **+ waterfall**; status/type/size/time columns; initiator links; row → Headers/Payload/Response/Timing; throttling; **HAR export** | **steal (centerpiece)** | **Network** — every `llm.*`/`tool.*`/`resource.*` packet on a time waterfall; row → Inspector drawer; export = run report |
| **Performance** | record → **flame chart** of spans over time; summary ring; main-thread track; markers | **adapt** | **Timeline** — turn/tool **spans** (Gantt) **+ the token thesis**: tokens-over-time and the context-window stacked area as tracks |
| **Memory** | heap snapshots; retainers | **adapt (as tokens)** | folded into **Timeline** — "memory" = the **context window**; snapshots = per-step `ContextSnapshot` |
| **Application** | storage / cache / **files / manifest** tree; preview; clear | **steal** | **Application** — browse **all responses** + **artifacts** (resources & documents created/downloaded); preview + download |
| **Sources** | files + breakpoints + scope | **drop breakpoints; keep "source"** | the **Raw / source** tab inside the drawer (read-only payloads, frozen config) |
| **Elements** | DOM tree + computed styles | **drop** | no analog |
| **Lighthouse** | run an audit → scored report | **defer (nice-to-have)** | optional **Audit** tab later: reuse `optimize.ts` to score a run (oversized schemas, recoverable tokens) |

**Cross-cutting DevTools patterns worth stealing wholesale** (these are the "muscle memory" that make
DevTools feel fast):

1. **Per-panel command bar** — filter chips + free-text search + a few toggles, always in the same
   spot (top of the panel).
2. **Preserve log** — a toggle that keeps events across turns/runs instead of clearing (vital for
   multi-turn runs and replay).
3. **The drawer (Esc)** — a secondary surface that opens *below/over* the active panel for detail,
   without leaving the panel. This is our **packet inspector**, promoted from a one-off `Sheet` to a
   first-class, always-available drawer.
4. **Selection sync / "initiator" deep-links** — selecting a Network row highlights it in the
   Console and on the Timeline, and cross-highlights the conversation tool-card on the left (the
   bi-directional link `10` §3 already wants).
5. **Timing tabs** — Headers / Payload / Response / Timing → our **Overview / Request / Response /
   Tokens / Timing / Raw**.
6. **Export** — DevTools exports a **HAR**; we export the **run report** (JSON / Markdown, reusing
   existing report routes). Same instinct: a portable, replayable artifact of the session.

---

## 2. The Inspector frame (right-pane v2)

The right pane becomes: a **persistent KPI summary strip** (the context-window thesis earns a fixed
readout DevTools doesn't have), a **panel tab strip**, the **active panel**, and a **detail drawer**
that opens from any panel. The conversation stays on the left exactly as in `10` §3.

```
┌─ right pane (Inspector) ───────────────────────────────────────────────────┐
│ Context 62% /200k   Tokens↑ 24,118   Tokens↓ 13,902   Tools 7   $0.21   ⟳   │ KPI strip (persistent)
├────────────────────────────────────────────────────────────────────────────┤
│ [ Console ] [ Network ] [ Timeline ] [ Application ]        ⌕  ▣ preserve  ⨉ │ panel tabs + shared toolbar
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                         ACTIVE PANEL (fills, virtualized)                  │
│                                                                            │
├──────────────────────────────────────────────────────────[ drawer ⌃/Esc ]─┤
│ Packet #7 · tool.result · read_file        ✓ 120ms  [Overview|Req|Resp|Tok|Raw]
│  …detail of the selected packet…                                           │
└────────────────────────────────────────────────────────────────────────────┘
```

- **KPI strip** = `MetricGrid` of compact `MetricCard`s (`@brand/charts`, now vendored), `tabular-nums`,
  context % first (Klipfolio "critical metric upper-left"). It survives panel switches so the budget
  is always in view.
- **Panel tabs** = `Tabs`/`TabsList` (`@brand/ui`). One shared **toolbar** to the right hosts the
  global search, *preserve-log*, and *clear* — same place on every panel (DevTools consistency).
- **Drawer** = a bottom (wide) / side (narrow) region toggled with `Esc`/`⌃`, not a modal — so you
  keep the panel context. Built from `Collapsible` + `Tabs` (both now in `@brand/ui`).

> **Reconciliation with `10`.** Nothing is lost: `10` Zone A (KPI rail) → the KPI strip; Zone B
> (context chart) → a track in **Timeline**; Zone C (step log) → **Network**; §5 packet inspector →
> the **drawer**. The change is *organization* (panels + drawer) over *stacking*, which is what lets
> the surface scale to four lenses without a wall of scrolling.

---

## 3. The panels

### 3.1 Console — the event stream

The chronological, human-readable narration of the run — what you watch while it streams. Distinct
from Network (structured rows): Console is **prose + one-liners + diagnostics**, like DevTools'
console is distinct from its network table.

Rows, newest-appended, virtualized:
- `llm` reasoning/output deltas (streamed text, dimmed while pending).
- `tool.call` / `tool.result` one-liners: `→ read_file {path:"q3-incidents.md"}` · `← 4,210 tok ✓ 120ms`.
- `context.event` notices (tool-result injection, native context management, **overflow**).
- **warnings/errors** (`isError` tool results, transport throws, guardrail trips) with a level glyph.
- optional **raw JSON-RPC frames** (`tools/call` request/response envelopes) behind a "Protocol"
  level filter — the MCP-Inspector capability we're surpassing.

DevTools steals: **level filter** (`All ▸ Errors ▸ Warnings ▸ Info ▸ Protocol`), **text search**,
**preserve log**, **clear**, **expand/collapse** a frame, and an **"errors (1)"** counter chip.

```
┌ Console ───────────────────────  [All▾] ⌕ "incident"   ▣ preserve  ⨉ ───┐
│ 12:01:42.118  user      Summarize the Q3 incident reports …             │
│ 12:01:42.too  ▸ llm.req claude-sonnet  6.2k↑  (tools: 6 offered)        │
│ 12:01:43.001  ⚙ tool    → read_file {path:"q3-incidents.md"}  fs-server │
│ 12:01:43.121  ⚙ tool    ← 4,210 tok  ✓ 120ms              [open ↗]       │
│ 12:01:44.560  ▸ llm.resp claude-sonnet  0.9k↓  finish: tool_calls       │
│ 12:01:48.880  ⚠ tool    ← search_web  isError: rate limited   [open ↗]  │
└─────────────────────────────────────────────────────────────────────────┘
```

`@brand`: a **virtualized list** (`@brand/data` `DataTable` in single-column "log" mode, or a
windowed list), `Badge`/`StatusBadge` for levels, `SearchInput` + `FilterBar`/`FacetFilter` for the
command bar, `CodeBlock` for an expanded raw frame, token-styled severity (`text-destructive-text`,
`text-warning`, `text-muted-foreground`). `[open ↗]` selects the packet → drawer + Network/Timeline.

### 3.2 Network — the request waterfall (the gantt timeline)

The heart of the DevTools borrow. Every packet as a **row with a time-positioned bar**: start offset
from run T0, segments for **queue → time-to-first-token → stream/exec → total**. This is the
"execution timeline gantt" the owner asked for — *when* each call happened and *how long*, not just
an ordered list.

Columns (DevTools Network parity): `#`, **type** icon (`llm.req`/`llm.resp`/`tool.call`/
`tool.result`/`resource`/`context`), **name** (model or tool·server), **status**, **tokens ↑/↓**,
**size** (bytes), **time** (duration), and the **waterfall** lane. A **cost-weight tint** on each bar
(Braintrust "weight by cost") makes the expensive call pop before you read it.

```
┌ Network ──────────────  [type▾][server▾][errors] ⌕   ▣ preserve  ⨉ ──────────┐
│ # type   name              status  tok↑  tok↓  size   time   waterfall 0──6s │
│ 5 ▢ llm  claude-sonnet     200     6.2k   —    24KB   1.1s   ▏▓▓▓░             │
│ 6 ⚙ call read_file·fs      ok       1.1k  —    1.2KB  0.1s   ▏  ▓              │
│ 7 ◧ res  read_file·fs      ok       —    4.2k  16KB   —      ▏  ▓▓▓▓▓  ← heavy │
│ 8 ▢ llm  claude-sonnet     200     0.9k  0.9k  6KB    1.4s   ▏     ▓▓▓▓        │
│ 9 ⚙ call search_web·srch   error    0.3k  —    —      2.0s   ▏        ▓▓▓▓▓▓▒  │
│ ▸ select a row → Inspector drawer (Overview/Request/Response/Tokens/Timing/Raw)│
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Component:** `@brand/data` `DataTable` (virtualized) for the columns; the **waterfall lane is a
  Gantt**. The **next `@brand/charts` ships a proper Gantt** (per owner) — design the lane to *that*
  component's API. **Interim (charts 1.0.0 has no Gantt):** a thin token-styled lane composed like
  `TokenViz` — a positioned `<div>`/`Progress` segment per row (`left = startMs/totalMs`,
  `width = durMs/totalMs`), tinted by cost via `--chart-1..5`. Swap to the upstream `Gantt` when it
  lands; **don't hand-roll a permanent charting widget** (library-first, `dependencies.md`).
- **Filters** mirror DevTools: type, server, errors-only (`FacetFilter`), name/payload search
  (`SearchInput`), `ColumnPicker`. Filters cascade.
- **Timing tab** in the drawer = DevTools' Timing breakdown (queue / TTFT / stream / total).

### 3.3 Timeline — Performance + Tokens

DevTools **Performance** = a flame chart of spans over time + a summary. Ours fuses that with the
**token thesis**, as stacked **tracks** sharing one time axis (turn/step index, or wall-clock):

1. **Spans track (Gantt/flame):** each **turn** is a lane; **tool calls** are spans within it
   (start+duration), shallow nesting for retries. Click a span → drawer (same selection as Network).
   Uses the forthcoming `@brand/charts` **Gantt**; interim = the composed lane from §3.2.
2. **Context-window track (the centerpiece, from `10` §4 Zone B):** a **stacked area** — system /
   tool-defs / history / tool-results / output — with a **limit line** at the model max and the
   **overflow marker**. Now buildable with `@brand/charts` **`AreaChart`** (stacked) +
   **`LiveLineChart`** for the streaming case (gap from `10` is **resolved** — charts is vendored).
3. **Token-rate track:** tokens ↑/↓ per step as `LiveLine`/`BarChart`, so spikes (a 4k tool result)
   are visible against time. Optional **`SankeyChart`** view — token *flow* from system→history→
   tools→output — as a secondary "where do tokens go" lens (charts ships `SankeyChart`).

```
┌ Timeline ─────────────────────────────────  turn �────●─ now  ⌕  ⨉ ──────────┐
│ spans   turn1 ▓▓▓   turn2 ▓▓ [read_file▪] turn3 ▓▓▓▓ [search_web▪ err] turn4  │
│ ──────────────────────────────────────────────────────────────────────────  │
│ context 200k┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ limit                                   │
│         ▟▓▓ output / ▒ results / ▓ history / ░ tool-defs / █ system           │
│ ──────────────────────────────────────────────────────────────────────────  │
│ tok/step  ▁▃▂█▂▁▅▂  (↑ sent  ↓ received)                                      │
└───────────────────────────────────────────────────────────────────────────────┘
```

`@brand`: `@brand/charts` `AreaChart` / `LiveLineChart` / `ComposedChart` / `BarChart` /
`SankeyChart`, `ChartLegend`, `ChartTooltip`; series **only** from `--chart-1..5`; a shared playhead
for replay (WP 3.7). Throttle to animation frames while streaming.

### 3.4 Application — responses & artifacts

DevTools **Application** browses what the page *produced and stored* (storage, cache, files,
manifest). Ours browses what the **run produced**: every **response**, and every **artifact** —
resources/documents **created or downloaded** during the run. This is the panel `10` did not have and
the owner explicitly wants ("documents which have been created and downloaded").

Two sections (left tree, right preview — DevTools' Application layout):

- **Responses** — a navigable tree of every `llm.resp` and `tool.result` payload (group by
  turn/tool), so you can read outputs without scrubbing the log. Preview = `CodeEditor` (read-only
  JSON, folding/search/copy — the Monaco viewer we shipped for the manual playground) for structured
  payloads; `Text`/markdown for prose.
- **Artifacts** — files/resources the run created or fetched: MCP **resources** read, documents the
  tools wrote, anything downloadable. Each: name, kind (`mime`), size, source tool/step, **Preview**
  (`CodeEditor`/image/markdown by type) and **Download** (`<a download>` via `Button asChild`).
  Cross-links to the producing packet.

```
┌ Application ───────────────────────────────────────────  ⌕  ⨉ ──────────────┐
│ Responses                    │  q3-summary.md          16.4 KB  text/markdown │
│  ▸ turn 2                     │  source: write_file · turn 3  [open packet ↗] │
│    read_file → result        │ ┌ preview (CodeEditor / markdown) ───────────┐ │
│  ▾ turn 3                     │ │ ## Q3 Incidents                            │ │
│    • write_file → q3-summary  │ │ - SEV-2: …                                 │ │
│  Artifacts                    │ │ …                                          │ │
│   📄 q3-summary.md   ⤓        │ └────────────────────────────────────────────┘ │
│   🖼 chart.png       ⤓        │                                  [ Download ⤓ ] │
└───────────────────────────────────────────────────────────────────────────────┘
```

`@brand`: `Tree`/`TreeNode` (`@brand/ui`) or `SplitPanel` (tree | preview), `Descriptions` for
metadata, `CodeEditor` (`@brand/editor`) for payload preview, `Badge` for mime/size, `Button asChild`
for download. Untrusted output is **never HTML-injected** — preview as code/text/image only
(`mcp-and-security.md`).

### 3.5 Inspector drawer — packet detail

The DevTools request-detail, promoted to a persistent drawer (open from Console/Network/Timeline,
toggle with `Esc`). Tabs reconcile DevTools' Headers/Payload/Response/Timing with our token thesis
(unchanged from `10` §5, plus **Timing**):

`Overview` (`Descriptions`: server/tool or model/params, status, duration, token summary per lens +
provider-actual + Δ, bytes) · `Request` (exact payload incl. **tools offered**; `CodeEditor` +
`TokenViz` system/tool-defs/history/output split) · `Response` (content + finish reason + reasoning
tokens) · `Tokens` (per-lens vs provider-actual incl. cached/reasoning) · **`Timing`** (queue / TTFT
/ stream / total — the DevTools Timing tab) · `Raw` (full JSON, read-only, copyable).

---

## 4. Cross-panel behaviour (the DevTools "feel")

- **One selection, all panels.** Selecting packet #7 anywhere highlights it in Console, Network,
  Timeline, opens the drawer, and cross-highlights the conversation tool-card (`10` §3). Selection is
  lifted to `RunConsole` (WP 3.3).
- **Shared toolbar.** Global `SearchInput`, **preserve-log** toggle, **clear**, **export** sit in the
  same place across panels.
- **Export = HAR analog.** The run report (JSON / Markdown, existing routes) is our portable session
  artifact; "Copy as …" on a packet copies its raw envelope.
- **Keyboard-first.** `[` `]` cycle packets; `Esc` toggles drawer; `/` focuses search; arrow-navigate
  the log; visible `ring-ring` focus; no `div`-as-button.
- **Replay.** The run-bar scrubber (`10` §7) drives a **playhead** across Timeline + truncates
  Console/Network/Application to the "as-of" step — DevTools' filmstrip/scrubbing instinct.

---

## 5. Component mapping & gap status (updated)

| Inspector surface | `@brand` component(s) | Status vs. `10` |
| --- | --- | --- |
| KPI strip | `MetricGrid` / `MetricCard` (`@brand/charts`) | **charts vendored** — upgrade from the `@brand/ui` `MetricCard` stand-in |
| Panel tabs + toolbar | `Tabs`, `SearchInput`, `FilterBar`, `FacetFilter`, `ColumnPicker` | available |
| Console stream | `DataTable` (log mode) / windowed list, `Badge`/`StatusBadge`, `CodeBlock` | available (virtualize) |
| Network table | `DataTable` (virtualized) | available |
| **Network waterfall / Timeline spans** | **`@brand/charts` Gantt (next release)** | **interim:** composed time-lane (TokenViz pattern); swap to upstream Gantt |
| Context-window stacked area | `@brand/charts` `AreaChart` / `LiveLineChart` / `ComposedChart` | **gap from `10` §4/§11 resolved** (charts vendored) |
| Token-rate / flow | `BarChart`, `LiveLine`, `SankeyChart`, `ChartLegend`, `ChartTooltip` | available |
| Application tree + preview | `Tree`/`TreeNode` or `SplitPanel`, `CodeEditor`, `Descriptions`, `Button asChild` | available (`@brand/editor` vendored) |
| Inspector drawer | `Collapsible` + `Tabs` + `Descriptions` + `CodeEditor`/`CodeBlock` + `TokenViz` | **`Collapsible` resolves `10` §11 #4** |
| Two-pane / panel splits | `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` | **gap from `10` §11 #2 resolved** (in `@brand/ui`) |
| Replay scrubber | range slider | **still a gap** (`10` §11 #3) — raise upstream |

**Net:** vendoring `@brand/charts`/`editor` + the `@brand/ui` `Resizable*`/`Collapsible` close **most**
of `10`'s gaps. Remaining true gaps: the **Gantt** (coming next charts release — design to it) and the
**range slider/scrubber** (raise upstream; replay-only).

---

## 6. Themes, accessibility, performance

- **Six themes.** All chart series come from `--chart-1..5`; verify the stacked area + waterfall tint
  read in `high-contrast` and `blueprint` (low-contrast fills fail there). Panels/headers on `bg-muted`,
  surfaces on `bg-card`, no raw colors (`styling-and-tokens.md`).
- **A11y.** Tabs + drawer keyboard-reachable; the log/table arrow-navigable; charts get text/`Descriptions`
  fallbacks for the numbers; icon-only controls carry `aria-label`.
- **Stable under load** (the hard requirement, `10` principle #5). Network/Console are the stress
  points: virtualize, no per-row `getBoundingClientRect`, throttle counters/charts to animation
  frames during streaming, and cap Console retention (preserve-log off by default trims old frames).

---

## 7. Work-package impact (phase-3-web-ui)

This reframing **re-scopes**, it doesn't restart — the data model (`RunStep`/`RunEvent`,
`ContextSnapshot`) and SSE transport are unchanged.

- **WP 3.3 (console shell)** — add the **panel tab strip** + **drawer** to the right pane; the
  resizable split now uses `@brand/ui` `ResizablePanelGroup` (gap closed).
- **WP 3.5 (KPI + chart)** — becomes the **persistent KPI strip** + the **Timeline** panel; build the
  context chart on `@brand/charts` `AreaChart`/`LiveLineChart` (no longer blocked).
- **WP 3.6 (step log + inspector)** — becomes the **Network** panel (table **+ waterfall**) + the
  **Inspector drawer**; add the **Console** panel here or split to a new WP (below).
- **NEW WP 3.9 — Application panel (responses & artifacts):** the responses tree + artifact
  preview/download. New surface; depends on run persistence (WP 1.6) capturing artifacts.
- **NEW WP 3.10 — Console panel:** the streaming event log with levels/preserve/clear and the raw
  JSON-RPC frame view.
- **WP 0.1 (vendor `@brand/charts`)** — **done** (charts 1.0.0 vendored). Track the **Gantt** in the
  next charts release for the waterfall/Timeline spans.

---

## 8. Open questions

1. **Wall-clock vs. step index** on the Network/Timeline X axis — DevTools is wall-clock; our token
   story is step-indexed. Propose: **wall-clock with step ticks**, toggle to step index.
2. **Console vs. Network overlap** — keep both (prose stream vs. structured rows, like DevTools) or
   collapse to one? Recommend keep both; they answer different questions.
3. **Artifact capture scope** — only MCP `resources` + tool-written files, or also "synthesize a
   download" from any structured response? Start with resources + explicit file outputs.
4. **Gantt dependency** — gate the waterfall/Timeline polish on the next `@brand/charts`, or ship the
   interim composed lane first? Recommend interim lane now, swap on release (no API churn for callers).
5. **Drawer placement** — bottom (DevTools default, good for wide) vs. right side (better on narrow).
   Propose bottom on wide, side/inline on narrow (<900px), mirroring `10` §12.3.
