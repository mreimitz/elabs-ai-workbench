---
type: "Research Note"
title: "03 \u2014 Charts & visualization inventory across the compared tools"
description: "What Langfuse, LangSmith, Phoenix, Opik, Braintrust, and Weave actually draw \u2014 chart and"
tags: ["research", "RS-05"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 03 — Charts & visualization inventory across the compared tools

What Langfuse, LangSmith, Phoenix, Opik, Braintrust, and Weave actually *draw* — chart and
widget types per surface, distinctive visualization idioms, interaction grammar, and (for the
OSS tools) the charting libraries verified from their dependency manifests. Fetched
2026-08-18 from docs, changelogs, and — where open source — the repos themselves (widget-type
enums read from schema/source, not marketing). Purpose: feed the dashboard/chart WPs
(observability Phase 2), the console visualizations (Phase 3), the compare workspace, and the
proposed agent-graph WP. Workbench mapping at the bottom. [vendor claim]/[unverified] marked.

---

## 1. Langfuse

**Dashboard widgets** — authoritative enum from their Prisma schema (`DashboardWidgetChartType`):
`LINE_TIME_SERIES`, `AREA_TIME_SERIES`, `BAR_TIME_SERIES`, `HORIZONTAL_BAR`, `VERTICAL_BAR`,
`PIE`, `NUMBER`, `HISTOGRAM`, `PIVOT_TABLE` — nine types, the widest formal set of the six.
Widget = data source (traces / observations / scores-numeric|categorical|boolean) → metric
(count/latency/cost/scores + aggregation) → dimensions → filters → chart type. Grid is
drag/resize (react-grid-layout); widgets copy-paste across dashboards/projects/instances
(⌘V), export as versioned portable JSON, and download data as CSV per tile. Home is itself a
dashboard; three curated dashboards (Latency/Cost/Usage) fork copy-on-write when edited.

**"Chart any table":** the observations table toggles Table ⇄ Chart preserving
query/filters/time-range — Line/Area/Bars over time, "Ranked" horizontal top-lists, Pie,
Number; deep-linkable URL; "Add to dashboard" persists it as a widget.

**Pulse (outlier strip):** compact bar strip above the observations table; one bar per
adaptive time bucket (1 min → 1 week); **square-root height scale** so spikes pop while the
baseline stays readable; empty buckets render as gaps on a flat baseline; metrics
count/cost/latency (p95 default, p50 option). Click a bar → table narrows to that bucket;
drag across bars → wider range; browser Back restores; auto-disables when active filters
can't be represented in aggregates.

**Trace view:** tree ⇄ **timeline** toggle (latency bars, parallelism), color-coded
cost/latency rollups per subtree, observation search by type/id/name. **Agent graph:**
custom SVG renderer using **elkjs** layered layout + d3-zoom — Aggregated mode (same-name
steps merged into one node with a counter, loops as cycles, layout top-down) vs Expanded
(every call a node, loops unrolled into a DAG, layout left-right).

**Libraries (from `web/package.json`):** recharts ^3.8, elkjs ^0.11 + d3-selection/d3-zoom
(graph), @tanstack/react-table + react-virtual, react-grid-layout ^1.5.

## 2. LangSmith

**Prebuilt dashboard** per project, sectioned: Traces (count/latency/error rate), LLM Calls,
Cost & Tokens (by type), Tools (per-tool counts/errors/latency, top-5), Run Types, Feedback
Scores. **Custom dashboards** — six chart types: **Line, Stacked bar, KPI, Ranked bar,
Donut, Table**. Metrics include a **Ratio** type (numerator/denominator, each with its own
filter — error rate, LLM-run share); latency avg/p50/p99, TTFT, tokens, cost, feedback.
Group-by one attribute (top-5 default, cap 20) XOR multiple data series each with its own
filter; donut/ranked-bar/table don't support multi-series. Filter scopes: run-level,
trace-level (root), or **tree filter** (whole trace if any run matches).

**Trace views:** three lenses with hotkeys — Messages (trajectory blocks: response + tool
calls + results per turn, collapsed "Thought" blocks), Turns (per-turn cards), Details (run
tree with per-run tokens/latency; tool runs auto-expand, retriever runs render documents).
No node-link agent graph in the observability UI (graphing lives in LangGraph Studio).

**Experiments:** baseline compare with **red = regression / green = improvement** cell
coloring, per-column improved/regressed counts as clickable filters, char-level Diff mode,
score charts across experiments with metadata-driven x-axis labels.

**Insights (aggregate):** hierarchical categories with **distribution bars** per pattern
frequency + per-category metric rollups; click a category → filtered traces table.

**Libraries:** closed frontend — unknown.

## 3. Arize Phoenix

**Metrics dashboard** (preset, per project — no user-composable dashboards in Phoenix OSS):
traces over time, latency percentiles, cost in USD, top models by cost / by tokens, LLM/tool
span counts + error counts over time, average span/trace/session annotation scores, and the
most granular **token-type stacked bars** of the six: prompt split input/cache/audio;
completion split output/reasoning/audio.

**Trace view (from source):** `TraceTree` — collapsible tree **with embedded latency
`TimelineBar`s positioning spans temporally** (tree and waterfall merged into one control);
span rows show kind/status/latency/tokens/annotation chips. Sessions render as a chat-style
turn list with per-conversation token/latency. Historical note: Phoenix ≤v4 shipped a
three.js **3D UMAP embeddings point cloud** for clusters — since removed from the manifest.

**Experiments:** baseline marking; UI flags where a metric **flipped correct↔incorrect**
between baseline and comparison; repetitions for confidence.

**Libraries (from `js/app/package.json`):** recharts ^3.10, d3-format + d3-scale-chromatic,
@tanstack table/virtual, react-aria-components, Relay (GraphQL).

## 4. Comet Opik

**Dashboards** — deliberately narrow widget set: multi-project dashboards offer **Time
series** (line or bar; metrics incl. feedback scores, counts, p50/p90/p99 durations, tokens,
cost, failed guardrails, errors; breakdown by tags/name/model/provider/span-type/metadata;
Total vs time-bucketed toggle), **Single metric** (KPI card), **Markdown**; experiment
dashboards add **Metrics (line / bar / radar** — radar compares multiple feedback scores
across experiments radially, up to 10 experiments, 5 grouping levels**)** and
**Leaderboard** (ranked experiment table). **Legend-click → traces list filtered to that
group** is the drill-down grammar. A read-only per-project **Insights tab** ships stat cards
+ time-series (volume, errors, latency, cost, feedback, thread activity).

**Trace view:** execution tree; threads render as conversations. **Agent graphs are logged
as Mermaid definitions** (`_opik_graph_definition`, auto for LangGraph/Google ADK) and
rendered in-app with mermaid ^11.

**Diagnostics (aggregate):** issue list with severity + occurrence counts; issue detail
includes an **"occurrence over time" chart** since first detection + affected-trace samples.

**Libraries (from `apps/opik-frontend/package.json`):** recharts ^2.15 (incl. RadarChart),
mermaid ^11.4, @tanstack table/virtual, react-grid-layout ^1.5.

## 5. Braintrust

**Monitor dashboards:** three chart types — **Time series** (lines or stacked bars), **Top
list**, **Big number** — plus named presets (Spans, Latency, Total LLM cost, Token count,
TTFT). The power is in the measures: any **SQL expression + aggregator** (or a full SQL
aggregate like `100*sum(errors)/count(id)`), span filters, SQL group-by dimensions, unit
types for axes/tooltips. Interactions set the bar for the category: **click any datapoint →
logs/experiments filtered to that time range and series**, **brush-zoom** (drag horizontally,
double-click resets), LIVE auto-refresh, copy chart config, **open any chart in a SQL
sandbox**. Loop (their copilot) composes charts from natural language.

**Trace views:** Spans (tree with per-row duration/tokens/cost, cost propagated
child→parent), Thread (conversation with in-layout ⌘F search), and the standout **Timeline —
a Gantt whose bar length is scaled by a metric of your choice**: duration (default), total /
prompt / completion tokens, or estimated cost, color-coded by span type. Plus a **token
distribution view**: per-span stacked segments for uncached input / cache read / cache write
/ output with cache-hit-rate per span; a "cached tokens" mode flattens the tree to LLM spans
scaled by cached reads.

**Experiments:** List / Grid / **Summary** (large-type score cards with delta-vs-base +
improvement/regression click-filters) / **Summary table** (experiments as columns, scores as
rows, best/worst highlighted, **Comparison grade row = Improvement / Regression / Tradeoff /
Tie** over latency/cost/errors/load; PDF export); char-level diff sub-rows; **Pairwise card**
capturing head-to-head human preference into an aggregate score.

**Topics (aggregate):** default rendering is an **embeddings scatterplot colored by topic**
— hover a point for the trace's facet summary, click to open the trace, legend lists each
topic's share, expanded view has a **3D rotate/zoom toggle**; alternates: topic cards with
percentage + count on the logs page, on-demand "Cluster by" on any filtered subset, and a
Monitor "Topics" time-series (click a datapoint → those traces).

**Libraries:** closed — unknown.

## 6. W&B Weave

**Trace plots** (side pane over the traces table): default bar (cost/latency over time
bins), line (latency), **scatter (e.g. prompt vs completion tokens)**; custom plots limited
to scatter/line/bar; drag-zoom + double-click reset; **click a scatter point → open that
trace**; plots react to table filters.

**Trace view:** three-panel with a call tree (per-node cost/tokens/latency toggles) plus
alternate renderings: **flame graph** (execution depth × duration, frame-isolate to
sub-traces), **graph view** (op relationships), code-composition boxes — and **scrubber
strips** below the tree (Timeline / Peers / Siblings / Stack sliders) for rapid navigation
through large traces. Agents view adds conversation activity minimaps and multi-turn
timelines.

**Evals:** compare up to 6 objects side-by-side with "Diff only" filter and baseline
ordering; leaderboards as ranked tables; **Monitors page**: time-binned signal charts +
per-scorer pass/fail dashboards with histograms. Weave panels embed into W&B run workspaces
alongside training charts.

**Libraries:** closed UI — unknown.

---

## Cross-cutting patterns

1. **Recharts monoculture in OSS.** All three open-source tools chart with Recharts
   (Langfuse 3.8, Phoenix 3.10, Opik 2.15) on TanStack Table/Virtual, with
   react-grid-layout for dashboard grids. Node-link graphs diverge: Langfuse = custom
   ELK-layout SVG + d3-zoom; Opik = Mermaid; Phoenix = none (dropped its 3D embeddings
   cloud). Nobody uses @xyflow/react — we already own a stronger graph stack via SkillFlow.
2. **Widget-type sweet spot.** Langfuse proves 9 types is buildable; Braintrust proves 3
   types + a powerful measure/filter grammar beats more chart types; LangSmith's **Ratio
   metric** and Opik's **experiment radar** are the two type-level ideas worth having.
   Histogram + pivot (Langfuse) matter for score analytics.
3. **The universal drill-down grammar:** chart element → filtered table (Braintrust
   datapoint→logs, Opik legend→traces, Langfuse Pulse bar→table, LangSmith Insights
   category→traces). Brush-zoom in Braintrust/Weave. Everything URL-addressable in
   Langfuse. Any chart we ship without click-through-to-runs is below the 2026 bar.
4. **Distinctive idioms worth importing:** Langfuse's sqrt-scaled Pulse strip;
   Braintrust's **metric-scaled Gantt** (bars sized by tokens/cost, not just time) and
   stacked cache-segment bars; Phoenix's three-way token-part stacks (incl. reasoning);
   Weave's flame graph + scrubbers for very long traces; red/green
   regression/improvement cell coloring with clickable counts (LangSmith + Braintrust both).
5. **Aggregate-intelligence visuals:** distribution bars per category (LangSmith),
   occurrence-over-time per issue (Opik), embeddings scatter + topic cards (Braintrust).
   For our issues layer, Opik's occurrence sparkline + LangSmith's distribution bars are
   the cheap, deterministic-friendly choices; Braintrust's embedding scatter is the
   expensive showpiece we don't need.

## Mapping to the workbench

What we already have (keep, extend): per-turn context-composition and cost curves, KPI rail,
RunGantt, judge donuts + run-rating radar (Report tab), quality×cost scatter in suite
analytics, compatibility heatmap, TokenViz — nothing here embarrasses us per-run; the gaps
are fleet-level and interactional. Direct imports, routed to WPs (details in
[`04-roadmap-handoff.md`](../outputs/04-roadmap-handoff.md)):

- **WP-2.2 testing dashboard panels / WP-2.7 chart composer:** adopt the widget grammar
  source→metric→dimension→type; start with time-series/bar/area/number/ranked + histogram
  and pivot for scores; add a **Ratio** metric type; require chart→filtered-runs-feed
  click-through and URL addressability (both fit the existing routes rule).
- **Runs feed:** Pulse-style sqrt-scaled outlier strip (count/cost/p95) with
  bucket-click/drag filtering.
- **WP-3.2 console economics:** metric-scaled Gantt option (scale bars by tokens/cost) +
  cache-segment stacked bars per step; token-type stacks gain reasoning/cache-write once
  the usage taxonomy lands (pricing-editor amendment).
- **Agent graph WP (proposed):** aggregated vs expanded is the right two-mode spec;
  layout via our existing @xyflow/react rather than ELK/Mermaid.
- **Compare workspace / suite compare:** red/green delta cells with clickable
  regression/improvement counts; experiment radar for multi-grader comparison (we already
  ship a radar primitive in the Report tab); Braintrust's Improvement/Regression/
  **Tradeoff**/Tie grade row.
- **Issues layer (Phase 5):** per-issue occurrence-over-time sparkline + category
  distribution bars; skip embedding scatters.
- **Library note:** every visible element stays `@elabs-ai/components-*` (brand-charts) per
  the hard rule — the competitor Recharts monoculture maps cleanly onto equivalent brand
  chart parts; raise upstream gaps (histogram, pivot, radar variants, brushable time axis)
  via the library-first rule rather than hand-rolling.

## Sources

Verified against primary sources 2026-08-18 — Langfuse: web/package.json +
packages/shared/prisma/schema.prisma (widget enums, chart deps), web/src/features/
trace-graph-view/* (ELK renderer), docs (custom-dashboards, pulse, events-table-charts,
agent-graphs), changelogs (2025-03-19 trace view, 2024-06-12 timeline, 2025-06-30 histogram,
2025-07-01 pivot, 2026-07-28 Pulse), faq/dashboard-changes-in-v4. LangSmith:
docs.langchain.com/langsmith/{dashboards, view-traces, insights, compare-experiment-results},
langchain.com/blog (Insights). Phoenix: js/app/package.json (+ v4 tag for the removed
three.js cloud), arize.com/docs/phoenix (metrics, sessions, release notes 06.25.2025 cost /
07.09.2025 baselines), deepwiki.com/Arize-ai/phoenix (TraceTree/TimelineBar, code-derived).
Opik: apps/opik-frontend/package.json, comet.com/docs/opik (dashboards .md — widget
vocabulary verbatim, log_agent_graphs, diagnostics, production_monitoring), Dec-2025 release
blog. Braintrust: braintrust.dev/docs (observe/dashboards, observe/examine-traces,
observe/topics/review-insights, evaluate/compare-experiments, loop), blog/topics. Weave:
docs.wandb.ai/weave (trace-plots, trace-tree, comparison, leaderboards, monitors,
weave-in-workspaces). Closed-source chart libraries (LangSmith, Braintrust, Weave) unknown.

# Citations

None.
