---
type: "Research Note"
title: "10 Testing \u2014 UI Concept (run console)"
description: "Status: design concept. Companion to 09-testing.md (scope). This is a written concept"
tags: ["research", "RS-11"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 10 Testing — UI Concept (run console)

> **Status:** design concept. Companion to `09-testing.md` (scope). This is a written concept
> with wireframes, mapped to the `@elabs-ai/components-*` design system and the six themes. No production code.
> Wireframes are schematic — they show structure and hierarchy, not final pixels.

## 0. What we're designing

The **Run Console**: the locked, instrumented session a user lands on when they run a Test against a
Scenario. Left = the conversation. Right = real-time monitoring (counters + context-window chart)
over a detailed, inspectable step/packet log. Same surface serves a **live run** and a **replay** of
a saved run.

This concept also sketches the **pre-run** state, the **packet inspector**, and the **compare**
(test × scenario) surface.

## 1. Design principles (from the research)

These are lifted from how the best 2026 tools (MLflow, Braintrust, Langfuse) and chat apps (Claude,
Linear, T3 Chat) actually behave — see Sources in chat.

1. **One pane, no context-switching.** Fuse the trace/log and the live metrics in the *same* right
   rail. Don't make the user flip between a "chat" view and a separate "metrics" board.
2. **Make the agent legible.** Every model decision and tool call is visible inline: reasoning,
   tool name, arguments, result, status, tokens, latency.
3. **Critical metric, upper-left.** The context-window gauge and token counters sit top-right-rail,
   read first. 6–8 KPIs, not 50.
4. **Weight by cost.** Scale/tint each step in the log by its token cost so the expensive step pops
   *before* you read it (Braintrust's timeline trick).
5. **Stable under load.** The log must stay smooth at 50+ steps with deep nesting — virtualized,
   no layout thrash. This is a hard requirement, not a nice-to-have.
6. **Estimate vs. actual, side by side.** Show provider-actual usage as truth and the estimator
   lens(es) next to it, with the delta — the whole point of this product.
7. **Calm, dense, operator-grade.** `tabular-nums` everywhere numbers compare; quiet surfaces;
   correct in all six themes.

## 2. Top-level frame

The console takes the full content width (the app sidebar collapses to icons or hides while a run is
open — a run wants horizontal room). A persistent **run-bar** spans the top; a resizable two-pane
split sits below (~58% conversation / ~42% monitoring).

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Tests   ● LOCKED   Test "Summarize Q3 incidents"   Scenario: Prod-Claude ▸ claude-sonnet │  run-bar
│ Mode Automated   ⟳ Running 00:42   Turns 4/20 ▰▰▱▱   Tokens 38k/100k ▰▰▰▱   $0.21/$1 ▰▱   │
│                                                                              [ ■ Stop ]     │
├──────────────────────────────────────────────────┬─────────────────────────────────────────┤
│ CONVERSATION                                       │ MONITORING                              │
│                                                    │ ┌─ KPI rail ──────────────────────────┐ │
│  ┌ user ──────────────────────────────────────┐   │ │ Context     Tokens↑   Tokens↓  Tools│ │
│  │ Summarize the Q3 incident reports and rank …│   │ │ 62% /200k    24,118    13,902    7  │ │
│  │ 📎 q3-incidents.md                          │   │ │ Turns 4/20   Cost $0.21   TTFT 0.9s │ │
│  └─────────────────────────────────────────────┘   │ └─────────────────────────────────────┘ │
│                                                    │ ┌─ Context window ────────────[⤢]─────┐ │
│  ┌ assistant ──────────────────────────────────┐   │ │ tok                           ┄ limit│ │
│  │ ▸ Thinking (1,204 tok)                      │   │ │200k┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │
│  │ I'll start by reading the incident file …   │   │ │       ▟▓▓ history                    │ │
│  │                                             │   │ │     ▟▓▓▓▓ tool results               │ │
│  │ ┌ 🔧 read_file · fs-server     ✓ 120ms ┐   │   │ │   ▟▓▓▓▓▓▓ tool defs                  │ │
│  │ │ args {path:"q3-incidents.md"}   1.1k↑ │   │   │ │  ▓▓▓▓▓▓▓▓ system            ● now    │ │
│  │ │ ▸ result  4,210 tok      [ Inspect ↗ ]│   │   │ └─────────────────────────────────────┘ │
│  │ └───────────────────────────────────────┘   │   │ ┌─ Step / packet log ──────[ filter ]─┐ │
│  │ Based on the file there were 3 SEV-2 …      │   │ │ #  type       label    tok    ⏱      │ │
│  └─────────────────────────────────────────────┘   │ │ 5  ▢ llm.req  claude  6.2k    —      │ │
│                                                    │ │ 6  🔧 tool     read_f 1.1k   120ms   │ │
│  ┌ composer (interactive mode only) ───────────┐   │ │ 7  ◧ tool.res  read_f 4.2k    —   ▓▓ │ │← cost-
│  │ Message…                         📎  [ Send ]│   │ │ 8  ▢ llm.resp  claude 0.9k   1.4s    │ │  weighted
│  └─────────────────────────────────────────────┘   │ │ ▸ select a row → packet inspector    │ │
│                                                    │ └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────┴─────────────────────────────────────────┘
```

**Run-bar** carries identity (test, scenario, model), **mode** chip, **status** (with elapsed),
the three **guardrail meters** (turns / token / spend) as compact bars, and the **Stop** control.
A `● LOCKED` badge signals the config is frozen. In **replay**, the Stop control is replaced by a
**scrubber** + Export (see §7).

## 3. Left pane — conversation

A clean, dense chat column. Components from `@elabs-ai/components-ui` (no hand-rolled bubbles).

- **User turn** — `Card` (muted surface), text, and attachment chips (`Badge` with a file glyph).
- **Assistant turn** — streamed `Text`; a collapsible **Thinking** disclosure (muted, token-count
  `Badge`); inline **tool-call cards**.
- **Tool-call card** — the key composite. Header: tool name, server `Badge`, `StatusBadge`
  (pending / running / ok / error), duration, and a token chip (`1.1k↑` request / `4,210` result).
  Expands to show **arguments** and **result** in `CodeBlock`. An **`Inspect ↗`** `Button`
  cross-links to the matching packet in the right-pane log (bi-directional highlight — selecting a
  packet on the right scrolls/aces its card on the left).

```
┌ 🔧 read_file · fs-server                       ✓ ok · 120 ms ┐
│ arguments                                              1.1k ↑ │
│  { "path": "q3-incidents.md" }                                │
│ ▸ result (structured)                       4,210 tok  [Inspect ↗]
└──────────────────────────────────────────────────────────────┘
```

- **Composer** (interactive mode) — `Textarea` + attachment `Button` + send `Button`. In
  **automated** mode it's replaced by a quiet note: *"Automated run — input is locked."*
- **States** — pre-run uses `StatePanel`/`EmptyState` (§6); mid-run errors render an `Alert`
  inline at the point of failure; a context overflow drops a destructive `Alert` ("Context window
  exceeded at step 31") and stops the stream.

## 4. Right pane — monitoring (three stacked zones)

> **Reframed (2026-06-20):** the right pane is re-organized as a **Chrome-DevTools-style Inspector** —
> a persistent KPI strip + panel tabs (**Console / Network / Timeline / Application**) + a detail
> **drawer** — in [`12-testing-inspector-devtools.md`](../../../Roadmap/RM-26-testing/12-testing-inspector-devtools.md). It keeps
> every metric/data source below; the zones map onto panels (A → KPI strip, B → Timeline, C → Network,
> §5 → drawer) and add a true Network **waterfall**, a **Console** stream, and an **Application**
> (responses + artifacts) panel. Read doc 12 alongside this section.

### Zone A — KPI counter rail

A compact grid of `MetricCard`s (the existing `TokenViz` composition extends naturally), 3-up,
`tabular-nums`, live-updating. Each card may carry a micro-sparkline of its own trend.

```
┌ Context ───────┐ ┌ Tokens ↑ ──────┐ ┌ Tokens ↓ ──────┐
│ 62%            │ │ 24,118         │ │ 13,902         │
│ 124k / 200,000 │ │ +6,210 last    │ │ +902 last      │
└────────────────┘ └────────────────┘ └────────────────┘
┌ Tool calls ────┐ ┌ Turns ─────────┐ ┌ Est. cost ─────┐
│ 7              │ │ 4 / 20         │ │ $0.21          │
│ 1 error        │ │ ▰▰▱▱ guardrail │ │ of $1.00 cap   │
└────────────────┘ └────────────────┘ └────────────────┘
```

Headline metric is **Context** (utilization % of the model's max), top-left. `Tokens ↑/↓` carry the
provider-actual numbers with a small "est. Δ" affordance when an estimator lens diverges.

### Zone B — Context-window timeline (the centerpiece)

A live **stacked-area line chart**: X = run progress (turn/step), Y = tokens, with a horizontal
**limit line** at the model's context max. The stack shows **composition** — system prompt / tool
definitions / conversation history / tool results / current output — so you see *what* is eating the
budget, not just that it's filling. Series colors come from `--chart-1..5` (theme-aware).

Overlaid **event markers**: tool-result injections, any **native context-management** action the
provider performs (surfaced, per scope decision #3), and the **overflow point** (destructive token)
if the run hits the wall. Hover → composition breakdown tooltip. In replay, a **playhead** tracks
the scrubber.

```
tokens
200k ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ← model limit
                                  ╭──────────
                          ╭───────╯   ▒ output
              ╭───────────╯ ▒▒▒▒▒▒▒▒  ▓ tool results
      ╭───────╯ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ▒ history
  ╭───╯ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ▓ tool defs
  █████████████████████████████████  █ system
  └─turn1──turn2──turn3──turn4──▲────────────
                    tool-result ┘   ● now
```

> **Component gap:** `@elabs-ai/components-charts` exists upstream but **is not vendored** (`dependencies.md`).
> This chart, the KPI sparklines, and the compare overlays (§8) all need it. Resolve by vendoring
> `@elabs-ai/components-charts` (owner-gated) or, if it can't render a streaming stacked-area cleanly, compose a
> constrained renderer the way `TokenViz` is built from `Progress`/`MetricCard`. **Raise upstream —
> do not hand-roll a charting lib.**

### Zone C — Step / packet log ("inspect every package")

A **virtualized** `DataTable` (`@elabs-ai/components-data`) of every step in order. Columns: `#`, type (icon for
`llm.req` / `llm.resp` / `tool.call` / `tool.result` / `context.event`), label (model or tool),
status, tokens (↑/↓), duration, and a **cost-weight** bar cell (a thin `Progress` tinted by relative
cost — the "weight by cost" principle). A `FilterBar` + `FacetFilter` filter by type / server /
status (errors only); `SearchInput` searches names and payloads; `ColumnPicker` toggles columns.
Filters cascade. Selecting a row opens the **packet inspector** (§5) and highlights the linked
tool-card on the left.

## 5. Packet inspector

Opens as a `Sheet` from the right (over the monitoring pane) — or inline-expands the row on narrow
widths. It's the "see in detail" surface. `Tabs` across the top; `Descriptions` for metadata;
`CodeBlock` for payloads; a `TokenViz` for the per-lens token split.

```
┌ Packet #7 · tool.result · read_file                   ✓ ok · 120 ms · ✕ ┐
│ [ Overview ][ Request ][ Response ][ Tokens ][ Raw ]                      │
│                                                                          │
│ Overview                                                                 │
│   Server      fs-server (stdio)              Tool    read_file           │
│   Status      success                        Bytes   16.4 KB            │
│   Tokens      4,210 (o200k) · 4,180 actual · Δ +30                       │
│                                                                          │
│ Result (structured)                                                      │
│  ┌ CodeBlock — JSON, copyable ─────────────────────────────────────────┐ │
│  │ { "content": [ { "type": "text", "text": "## Q3 Incidents …" } ] }   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Tab contents:

- **Overview** — `Descriptions`: server/tool or model/params, status, duration, stop/finish reason,
  token summary (all active profiles + provider-actual + delta), bytes.
- **Request** — the *exact* payload sent to the model (messages, **tools offered**, params) for an
  `llm.req`, or the tool arguments for a `tool.call`. `CodeBlock` JSON, plus a `TokenViz` breakdown
  (system / tool defs / history / output) so prompt bloat is attributable — directly on-thesis.
- **Response** — content/structured output, finish reason, and **reasoning tokens** if the model
  returns them. `CodeBlock`.
- **Tokens** — per-lens table (`generic_o200k`, `generic_cl100k`, `raw_json_rough`) vs.
  **provider-actual** (input / output / cached / reasoning), with bytes. The estimate-vs-actual
  delta is highlighted.
- **Raw** — full raw JSON envelope, copyable (untrusted output is rendered read-only in `CodeBlock`,
  never as HTML; honors the secret-redaction rules).

## 6. Pre-run state

Before a run starts, the left pane shows the **resolved, frozen config** so the user confirms the
harness before spending tokens — `StatePanel`/`EmptyState` with the two launch actions.

```
┌ CONVERSATION — not started ─────────────────────────────────┐
│                     ▢  Ready to run                         │
│   Test       Summarize Q3 incidents   (1 prompt · 1 file)   │
│   Scenario   Prod-Claude · claude-sonnet · temp 0.2         │
│   Tools      6 of 14 allowed            Profiles  o200k, actual │
│   Guardrails 20 turns · 100k tokens · $1.00 cap             │
│                                                             │
│            [ ▷ Run automated ]   [ 💬 Run interactive ]      │
└─────────────────────────────────────────────────────────────┘
```

The right pane shows the **static footprint** the scenario will start with (system + selected tool
defs) on the context chart as turn 0 — reusing the app's existing scan/token machinery — so you see
the baseline budget before the model says a word.

## 7. Run lifecycle & replay

**Live states** (surfaced via `StatusBadge` in the run-bar + `Alert`/`toast`):
`Ready → Running → {Completed | Stopped (guardrail: turns|tokens|spend) | context_overflow | Error |
Aborted}`. The tripped guardrail meter turns destructive and names itself.

**Replay** — a saved run reopens the *same* console, read-only, with a **timeline scrubber** in the
run-bar. Scrubbing sets an "as-of" step: the context chart playhead moves, the log scrolls/highlights
to that step, and the conversation truncates to what existed then. `Export` offers the JSON / Markdown
report (reusing existing report routes).

```
run-bar (replay):   ◀ Runs   Test … · Scenario …   ⏮ ⏯ ⏭  ├──────●────────┤ step 18/47   [ Export ▾ ]
```

> **Component gap:** a **range slider / scrubber** isn't in the listed `@elabs-ai/components-ui` set, and neither
> is a **resizable split-pane**. Both are small, reusable primitives — raise upstream rather than
> bolting on ad-hoc.

## 8. Compare — test × scenario (secondary surface)

The benchmark payoff (scope decision #5). A `DataTable` of runs of **one test across scenarios**,
plus an **overlay** of each run's context curve (small multiples or a single overlaid chart).

```
┌ Compare · "Summarize Q3 incidents" across scenarios ─────────────────────────────┐
│ Scenario       Model          Tok↑    Tok↓   Tools  Peak ctx   Cost    Outcome    │
│ Prod-Claude    claude-sonnet   24.1k   13.9k    7      62%      $0.21   ✓ ok       │
│ Prod-GPT       gpt-…           22.8k   15.1k    9      71%      $0.34   ✓ ok       │
│ Local-Llama    llama-…         31.4k   12.2k    7      98% !    $0.00   ⚠ overflow │
│ ───────────────────────────────────────────────────────────────────────────────  │
│ [ overlay context curves ]   each row → open that run in the console              │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## 9. Component & token mapping

| Surface | `@elabs-ai/components-*` component(s) | Notes |
| --- | --- | --- |
| Run-bar identity / status | `StatusBadge`, `Badge`, `Text` | `● LOCKED` = `StatusBadge` |
| Guardrail meters | `Progress` ×3 | destructive token when tripped |
| Stop / launch / export | `Button` (`destructive`, `default`) | Stop confirms if mid-stream |
| Two-pane split | `div` + flex + resizer | **gap:** no split-pane primitive |
| Conversation turns | `Card`, `Heading`/`Text` | no bespoke bubbles |
| Thinking disclosure | collapsible (`Button` + region) | confirm if `@elabs-ai/components-*` ships Collapsible/Accordion |
| Tool-call card | `Card` + `StatusBadge` + `Badge` + `CodeBlock` + `Button` | cross-links to packet |
| Composer | `Textarea` + `Button` | disabled note in automated mode |
| KPI rail | `MetricCard` / `TokenViz` | `tabular-nums` |
| Context chart, sparklines, overlays | **`@elabs-ai/components-charts`** | **gap: not vendored** — vendor or compose |
| Step/packet log | `DataTable`, `FilterBar`, `FacetFilter`, `SearchInput`, `ColumnPicker` | virtualized; cost-weight via `Progress` cell |
| Event rail on timeline | `Timeline*` | injections / native-ctx / overflow |
| Packet inspector | `Sheet` + `Tabs` + `Descriptions` + `CodeBlock` + `TokenViz` | read-only payloads |
| Pre-run / empties | `StatePanel`, `EmptyState` | shows frozen config |
| Errors / overflow | `Alert`, `ErrorState`, `toast` | never silent |
| Replay scrubber | range slider | **gap:** not in listed set |

**Tokens:** `bg-background` (app), `bg-card` (panes), `bg-muted` (rails/headers), `border-border`,
`text-foreground` / `text-muted-foreground`, `bg-primary text-primary-foreground` (primary actions),
the **destructive** token (Stop, overflow, errors), `--chart-1..5` (all series, theme-aware),
`ring-ring` (focus). `tabular-nums` on every comparing number; `text-balance`/`pretty` on headings.
No raw hex/rgb, no palette colors — per `styling-and-tokens.md`.

## 10. Theming & accessibility

- **Two themes**: `light` (default) and `dark` — the reference themes the library ships. (This
  document was written when the kit shipped six; that set shrank to two, and `blueprint` /
  `high-contrast` no longer exist.) Chart series **must** come from `--chart-1..12` (defined per
  theme) — verify the stacked-area reads in BOTH themes, where low-contrast fills can fail.
- **Keyboard**: every control reachable; visible focus (`ring-ring`); the log is arrow-navigable and
  the inspector opens on Enter. No `div`-as-button.
- **Density without noise**: the right rail is information-dense, so lean on whitespace, `tabular-nums`,
  and quiet surfaces rather than color to separate zones.
- **Stable under load** (principle #5): the log is the stress point — virtualize, avoid per-frame
  `getBoundingClientRect`, and throttle counter/chart updates to animation frames during streaming.

## 11. Component gaps to raise upstream (library-first)

> **Update (2026-06-20):** most of these gaps are now **closed** — `@elabs-ai/components-charts` and `@elabs-ai/components-editor`
> are vendored, and `@elabs-ai/components-ui` ships `ResizablePanelGroup` (split-pane) and `Collapsible`
> (disclosure). Remaining true gaps: a **Gantt** for the Network waterfall / Timeline spans (coming
> in the next `@elabs-ai/components-charts` release — design to it; interim composed lane) and the **range slider /
> scrubber** for replay. See [`12-testing-inspector-devtools.md`](../../../Roadmap/RM-26-testing/12-testing-inspector-devtools.md) §5.

1. **`@elabs-ai/components-charts`** — the context-window stacked-area + limit line + event markers, KPI sparklines,
   and compare overlays. The largest gap; gates the centerpiece. Vendor it or compose a constrained
   renderer (owner-gated). **→ resolved: vendored (`AreaChart`/`LiveLineChart`/`ComposedChart`/`MetricGrid`).**
2. **Resizable split-pane** — the console's core layout.
3. **Range slider / timeline scrubber** — replay.
4. **Collapsible / disclosure** — Thinking sections and expandable rows (confirm it isn't already in
   `@elabs-ai/components-ui`).
5. **Cost-weighted row treatment** — compose from `Progress`; promote to a `@elabs-ai/components-data` cell variant
   if it proves reusable.

## 12. Open questions for this UI

1. **Live transport** mirrors the scope doc's open item — SSE feeds the streaming panes; confirm.
2. **Log default grain** — one row per step (llm/tool) vs. nested sub-rows for retries. Recommend flat
   rows with a retry `Badge`, grouped under the parent turn, to keep the virtualized list fast.
3. **Mobile / narrow** — the two-pane console assumes a wide viewport. Propose: stack panes with a
   monitoring/conversation toggle below ~900px; confirm whether narrow is even in scope (operator
   tool, likely desktop-only).
4. **How much of the static footprint** to pre-render at turn 0 vs. compute lazily.

# Citations

None.
