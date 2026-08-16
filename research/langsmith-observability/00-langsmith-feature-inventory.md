# 00 — LangSmith observability: feature inventory

Primary-source inventory, fetched 2026-07-16. Marketing claims are quoted as claims; everything
else comes from the docs or the changelog. This doc only describes LangSmith. The comparison
against this app is [`01-gap-analysis.md`](./01-gap-analysis.md).

LangSmith positions observability as four pillars: **Tracing**, **Monitoring & Dashboards**,
**Insights**, and a purpose-built storage layer (**SmithDB**). Around those sit alerts,
automation rules, online evaluation, human feedback tooling, cost tracking, and a new autonomous
layer (**LangSmith Engine**).

---

## 1. Data model (the vocabulary everything else uses)

| Concept | Definition |
|---|---|
| **Project** | Container for all traces of one application/service. Dashboards, alerts, rules, and evaluators are project-scoped. |
| **Trace** | A collection of runs for a single operation (one user request end to end). Hard cap: 25,000 runs per trace. |
| **Run** | A span: one unit of work (an LLM call, a prompt-format step, a retrieval call, a tool call). Runs nest into a tree. Typed (`llm`, `chain`, `tool`, `retriever`, …). |
| **Thread** | A sequence of traces forming one conversation, linked by `session_id` / `thread_id` / `conversation_id` metadata. Metadata must be on *all* runs (child runs too) or thread filtering/token math breaks. |
| **Feedback** | A `key` + score (continuous or categorical) attached to any run. Written by end users, annotators, or evaluators. The same primitive serves all three. |
| **Tags / metadata** | Arbitrary strings / key-value pairs on runs; the currency of filtering, grouping, and dashboards. Not propagated parent→child automatically. |

Two properties matter beyond the vocabulary itself:

- **Everything is one graph.** Cost, latency, tokens, errors, and feedback exist *per span* and
  roll up per trace and per thread. Any chart can drill to the exact span.
- **Enrichment is open.** Because feedback/tags/metadata are generic, every later feature
  (dashboards, alerts, rules, evals, insights) composes with them instead of defining its own
  dimension system.

## 2. Tracing & debugging one session

- **Trace tree view**: hierarchical run tree with per-span inputs/outputs, latency, token counts,
  cost, and error state; aggregated values on parents; the most granular cost/latency view.
- **Threads view** with three lenses and keyboard switching (M/T/D): **Messages** (chat-style,
  readable multi-turn), **Turns** (per-turn summary cards), **Details** (full run inspection).
  Announced as a first-class feature at Interrupt 2026 ("makes multi-turn traces readable at a
  glance").
- **Customizable trace previews** (changelog 2026-02-06): choose which input/output fields render
  in the tracing table, so the list view shows what matters for *your* app.
- **Open in Playground**: any LLM run can be reopened in the prompt playground with its exact
  messages/params, edited, and re-executed. This is the core "tweak and retry" debug loop.
- **Share a trace**: public share links for a single trace (revocable).
- **LangSmith Fetch CLI** (changelog 2025-12-10): pull full traces into a terminal/IDE/coding
  agent, so debugging can happen next to the code.
- **Multimodal + attachments**: images/audio/files attached to runs render in the trace view and
  are addressable from evaluator prompts (`{{attachment.file_name}}`).
- **Live/streaming traces**: traces are visible while the run is still executing.
- **In-trace filtering**: inside a large trace, filter the tree ("Filtered Only" / "Show All" /
  "Most relevant").

## 3. Search & filtering across sessions

- **Filter bar + filter shortcuts**: composable filters over name, run type, tags, metadata,
  input/output content, feedback keys/scores, latency, tokens, error state; operators `is`,
  `is not`, `contains`, `does not contain`, `is one of`, numeric `>` / `<`; negations.
- **Full-text search** over inputs/outputs (indexes the first 250 chars per field, partial
  keyword matching, stop-words excluded).
- **Key-path filters**: target nested JSON fields with dot notation (`documents.page_content`,
  output key `generations.message.kwargs.tool_calls.name = Plan`). Limits: 100 unique keys/run,
  250-char values.
- **Trace-level filters** ("advanced filters"): find child runs whose *root* matches a condition.
- **Tree filters**: find runs whose *children* match a condition (e.g. "traces that called tool X").
- **Saved views**: any filter combination saved per project, selectable from a dropdown.
- **Copy as query language**: the UI filter serializes to a query DSL
  (`and(eq(is_root, true), eq(feedback_score, 1))`) usable via API/SDK. UI and API share one
  filter grammar.
- **SmithDB** (Interrupt 2026): purpose-built storage for exactly these query shapes: random
  access, full-text, JSON key-path filtering, trajectory/tree-aware queries. Claim: "sub-second
  across millions of traces", "P50 trace-tree loads at 92 ms", "up to 15x faster".

## 4. Monitoring: dashboards, threads table, project stats

- **Prebuilt dashboard per project**, six sections: Traces (count, latency, error rate),
  LLM Calls, Cost & Tokens (total + per-trace, split by token type), Tools (top 5), Run Types
  (top 5), Feedback Scores (top 5 keys).
- **Custom dashboards**: any number of charts; each chart = metric + filters + optional
  group-by (tag / metadata / run name / run type, top-5 per group) or manually defined series;
  line or bar; multiple same-unit metrics overlaid (e.g. prompt vs completion tokens); a global
  dashboard-level group-by; dashboards linkable to projects as their default.
- **Threads table**: per-conversation row with first input, last output, start times, turn
  count, **P50/P99 latency**, token usage, cost, feedback; plus project-level aggregate stats
  (thread/trace counts, tokens, error rates).
- **Chart → runs drill-down**: every dashboard datapoint links back to the matching runs.

## 5. Alerts

- Threshold alerts on five metrics: **run count, cost, error count / error rate, feedback
  score (avg), latency (avg)**; aggregation avg/percentage/count over **5 or 15 min windows**;
  `>=` / `<=` comparisons.
- Alerts accept **filters** (e.g. only `llm` runs tagged `support_agent`).
- **Historical preview**: before saving, the UI shows which past datapoints would have fired at
  the chosen threshold (threshold tuning without alert spam).
- Channels: **PagerDuty**, **Dynatrace**, **webhooks** (custom URL + headers + body template;
  Slack via `chat.postMessage`). Auto-appended payload fields include project, rule id/name,
  metric value, threshold, timestamp. Test-fire before saving.

## 6. Automation rules

Rules = **filter + sampling rate (0–1) + action**, evaluated continuously on incoming runs:

| Action | Use |
|---|---|
| Add to annotation queue | Route matching runs to human review |
| Add to dataset | Turn production traces into eval/regression data |
| Trigger webhook | Push the run to an external system |
| Extend data retention | Keep interesting traces past the default retention |
| Run online evaluator | Attach LLM/code judgment (below) |

Rules can **backfill** ("apply to past runs") as a background job with progress in automation
logs. Canonical uses from the docs: "send all traces with negative feedback to an annotation
queue", "send 10% of all traces to human spot-check", "extend retention on all errored traces".

## 7. Online evaluation (auto-judging live traffic)

- **LLM-as-judge** and **code evaluators** attached to a project, run on live traces matching a
  filter, at a sampling rate, writing results back as **feedback scores**.
- Per-evaluator **spend limits** (weekly LLM cost cap per project/dataset).
- **Multimodal** evaluator prompts via attachments.
- **Thread-level (multi-turn) evaluators**: judge whole conversations, not just single runs.
- Running an evaluator auto-upgrades the trace to extended retention.

## 8. Human feedback & annotation

- **Feedback API**: user thumbs/scores from the product attach to runs as feedback.
- **Inline annotation**: score any run directly in the trace view.
- **Annotation queues**: named queues with instructions + **rubric** (feedback keys with
  descriptions, optional categorical levels), default target dataset, reviewer assignment,
  **reservations with expiry** (no double-grading), completion states ("Needs review" →
  "Needs others' review" → "Completed"), keyboard-driven review, and the ability to **edit a
  run's input/output into a corrected reference example** before sending it to a dataset.
- **Pairwise annotation queues** (changelog 2025-12-17): two runs side by side, A/B/Equal per
  rubric item, hotkeys, for subjective comparisons.

## 9. Insights (automatic trace clustering)

- Unsupervised **hierarchical categorization** of traces: "detect usage patterns, common agent
  behaviors, and failure modes, so you do not need to review thousands of traces manually".
- Two-model pipeline: a cheap **summarization model** writes a per-trace summary from a
  configurable mustache prompt (`{{run.inputs}}`, `{{run.outputs}}`, `{{run.error}}`,
  `{{run.feedback}}`, `{{all_thread_messages}}`), then a **thinking model** clusters summaries
  into categories/subcategories.
- Configurable **attributes** (string/number/boolean) extracted per trace; boolean attributes
  can pre-filter (e.g. only errored traces).
- Output: **executive summary** with key findings, percentages, and clickable example traces;
  per-category metrics (error rate, latency, cost, feedback); drill-down to traces.
- **Scheduled reports** (daily/weekly/cron, changelog 2026-02-17). Limits: ≤1,000 traces per
  report, ~30 min processing, ~$1–4 model cost per 1,000 threads. Plus/Enterprise only.

## 10. LangSmith Engine (beta) — autonomous issue loop

The newest layer, announced at Interrupt 2026, "closed loop" over production traces:

1. **Detects** recurring failure patterns by scanning traces (default every 6 h).
2. **Clusters** them into **Issues** with priority (low/medium/high) and a root-cause diagnosis.
3. **Proposes fixes**: concrete prompt/code changes; with a connected GitHub repo it can **open
   a PR** with the fix.
4. **Generates a custom evaluator** per issue and can deploy it as an online evaluator
   (regression tripwire), including retroactively over past runs.
5. **Generates ground-truth dataset examples** from the offending traces for offline testing.
6. **Reopens** resolved issues automatically if the pattern recurs.

Supporting pieces: an editable "agent overview" document that gives the Engine context; webhook
notifications per priority; per-issue linked traces; monthly cost tracking of the Engine itself.

## 11. Cost & token accounting

- Token capture via `usage_metadata` with **typed breakdowns**: input/output plus
  cache-read, cache-creation, text, image, audio, and **reasoning** token types.
- **Model pricing map**: prebuilt prices for OpenAI/Anthropic/Gemini models; custom entries with
  **regex match on model name**, provider match, **activation dates** (price changes don't
  rewrite history; already-logged traces keep their cost).
- Cost computed greedily most-specific-first (cache-read tokens priced separately from the
  remaining input, etc.); direct cost override fields for non-token pricing.
- Costs roll up **span → trace → thread → project**, and (changelog 2026-02-05) across the whole
  stack via custom cost metadata on any run ("track costs across your entire agent stack").
- **LLM Gateway** (Interrupt 2026): runtime layer adding spend limits at multiple levels,
  real-time cost rollups, PII/secret redaction, audit logging, integrated into traces.

## 12. Interop & data platform

- **OTel-native**: OTLP ingest endpoint with GenAI semantic-convention mapping (plus TraceLoop /
  OpenInference attribute support); hybrid fan-out (send to LangSmith *and* another OTel
  backend); export LangSmith-instrumented traces to any OTel collector; distributed tracing via
  header inject/extract.
- SDKs: Python, TypeScript, Go, Java; auto-instrumentation for LangChain/LangGraph, OpenAI,
  Anthropic, CrewAI, Vercel AI SDK (via OTel), etc.
- **Bulk export** of trace data to S3-compatible storage; **SDK trace querying** with the same
  filter grammar as the UI; retention tiers (base vs extended, auto-upgrade on rule/eval match);
  server-side ingest **sampling**.
- Self-hosted option (feature parity tracked in changelog; SmithDB self-hostable for data
  residency).
- **Experiment ergonomics** that leak into observability: pin a **baseline experiment** and every
  subsequent run auto-compares against it (changelog 2026-02-19).

---

## Sources

- https://www.langchain.com/langsmith/observability (marketing pillars, SmithDB claims)
- https://docs.langchain.com/langsmith/observability (docs landing: feature map)
- https://docs.langchain.com/langsmith/observability-concepts (data model)
- https://docs.langchain.com/langsmith/dashboards (prebuilt + custom dashboards)
- https://docs.langchain.com/langsmith/alerts (alert metrics, windows, channels, preview)
- https://docs.langchain.com/langsmith/rules (automation rules, backfill)
- https://docs.langchain.com/langsmith/online-evaluations (online judges, spend limits)
- https://docs.langchain.com/langsmith/threads (thread grouping, three views, thread metrics)
- https://docs.langchain.com/langsmith/filter-traces-in-application (filter grammar, FTS, tree filters, saved views)
- https://docs.langchain.com/langsmith/annotation-queues (queues, rubrics, reservations, pairwise)
- https://docs.langchain.com/langsmith/insights (clustering pipeline, scheduling, limits)
- https://docs.langchain.com/langsmith/engine (Engine lifecycle, PRs, evaluators, datasets)
- https://docs.langchain.com/langsmith/cost-tracking (token types, pricing map, rollups)
- https://docs.langchain.com/langsmith/trace-with-opentelemetry (OTLP ingest, semconv, fan-out)
- https://docs.langchain.com/langsmith/data-export · https://docs.langchain.com/langsmith/share-trace
- https://changelog.langchain.com/ (Fetch CLI 2025-12-10; pairwise queues 2025-12-17; unified cost view 2026-02-05; trace previews 2026-02-06; scheduled Insights 2026-02-17; baseline pinning 2026-02-19)
- https://www.langchain.com/blog/interrupt-2026-overview (Engine, SmithDB, Messages view, LLM Gateway)
