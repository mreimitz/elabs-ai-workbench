# 02 — Alternatives landscape: Phoenix · Opik · Braintrust · Weave

First-pass landscape scan of the four owner-selected Langfuse alternatives, as of 2026-08-18,
from primary sources (docs, changelogs, pricing pages, repos — full list at bottom). Depth is
deliberately one notch below [`00-langfuse-feature-inventory.md`](./00-langfuse-feature-inventory.md);
per-tool deep-dive folders can follow where warranted. Each profile ends with **"read for us"**
— what it validates, what to steal, what to watch. The cross-tool matrix and the landscape
synthesis are at the bottom. Vendor-marketing assertions are marked [vendor claim].

---

## 1. Arize Phoenix — the architectural sibling

**Identity.** Open-source "AI observability platform": tracing, evals, datasets/experiments,
prompts, playground. ~11k GitHub stars; `arize-phoenix` at ~2.25M PyPI downloads/month; very
fast release cadence (v11 Jun 2025 → v19 Aug 2026). The free foundation under the commercial
**Arize AX** platform — the Phoenix/AX split matters everywhere below.

**Architecture & deployment.** The anti-Langfuse: **a single Docker container** with SQLite or
Postgres, notebook/terminal/container modes, air-gapped capable, Helm for K8s. **License is
Elastic License 2.0, not Apache/MIT** — no offering Phoenix as a hosted service; and the new
PXI assistant ships in the container but is explicitly *not* open source. Standalone "Phoenix
Cloud" has quietly disappeared from Arize's pricing page — the paid path is Arize AX (free
25k spans/mo → Pro $50/mo → Enterprise).

**Tracing.** OTel-based via their own **OpenInference** semantic conventions + 30+
self-maintained instrumentors (incl. Claude Agent SDK, Vercel AI SDK, LangGraph, CrewAI).
Sessions via `session.id`/`user.id` attributes with a chat-style session view and searchable
message content. Annotations at span/trace/session level + a span-notes API. **Agent graph
view is an AX feature, not Phoenix.** Standout: **`openinference-instrumentation-mcp`** —
generates no telemetry of its own, it *propagates OTel context across the MCP client↔server
boundary* so both sides land in one hierarchical trace. The only tool in this scan with a
dedicated MCP context-propagation instrumentor (Langfuse does the same trick via `_meta`
by hand).

**Dashboards/alerts.** One prebuilt per-project metrics dashboard (traces, latency
percentiles, cost in USD, top models, token breakdown incl. reasoning/cache/audio, annotation
scores). **No custom dashboards, no alerts, no webhooks in Phoenix** — docs point to AX for
both. No saved views found.

**Evaluation.** `arize-phoenix-evals` (Py+TS): LLM-judge via forced tool-calling with
explanations; executors handle rate limits/concurrency; eval runs are themselves traced.
Built-in evaluator library incl. **Tool Selection / Tool Invocation / Tool Response Handling**
(agent-tool evals, benchmarked [vendor claim: F1 ≥ 85% on golden datasets]). **v16 (May 2026):
sandboxed code evaluators authored in the UI, executed server-side.** No online auto-eval
rules on incoming traffic; no annotation queues (annotations UI/API only).

**Datasets/experiments.** Auto-versioned datasets, splits, labels, experiment repetitions,
resume-interrupted-experiments, REST coverage. Playground-over-dataset auto-creates an
experiment. No pytest/GitHub Action found.

**Prompts/playground.** Versioned prompts with environment tags carrying model config + tools
+ response format; playground with up to 4 side-by-side variants; all playground runs traced;
**Span Replay** — any traced LLM call reopens in the playground with modifications.

**Aggregate intelligence.** **PXI** (May–Jun 2026): embedded AI engineering agent — trace
debugging against a failure-mode checklist, bulk span annotation, authoring LLM/code
evaluators conversationally, prompt co-authoring with diffs, playground control; BYO keys;
admin-toggleable; closed source. No clustering/issue detection in Phoenix.

**MCP surface.** Built-in **remote MCP server at `/mcp` on every Phoenix instance** ("the
primary way to connect going forward") exposing traces/sessions, datasets/experiments,
prompts to Claude Code/Cursor; legacy stdio package in maintenance mode.

**Read for us.** The closest existence proof for our deployment thesis: local-first, one
container, embedded DB, evals + traces + prompts in one box — and it wins mindshare partly
*by attacking Langfuse's infra weight*, which validates our positioning. Steal: Span Replay's
exact "reopen this step with modifications" interaction (our fork-from-step WP); the
`/mcp`-endpoint-on-every-instance pattern (stronger than a separate server binary); their
agent-tool evaluator trio maps well onto our tool-hygiene grader family. Watch: ELv2 +
closed-source PXI show the OSS-with-asterisks drift; also note their agent-graph and
alerting are deliberately held back for the paid tier — features we can ship free.

---

## 2. Comet Opik — the OSS feature maximalist

**Identity.** "Debug, evaluate, and monitor LLM applications, RAG systems, and agentic
workflows." **Apache-2.0, full platform** — the cleanest license in this scan. ~21k stars,
`opik` at ~3.4M PyPI downloads/month, near-daily releases; "40M+ traces/day" [vendor claim];
logos incl. Uber, Netflix [vendor claim].

**Architecture & deployment.** The heavy end: docker-compose via `opik.sh` running **Java
(Dropwizard) + Python (Flask) backends, React front, ClickHouse, MySQL, Redis, MinIO,
Zookeeper** (+ optional guardrails service, GPU recommended). Helm for prod. Comet-hosted
cloud: free 25k spans/mo → **Pro $19/mo** (100k spans incl., $5/100k overage) → Enterprise
(RBAC/SSO/guardrails/compliance).

**Tracing.** `@track` decorator (Py) / TS SDK / native OTel ingest (http, not gRPC); 60+
integrations. **Threads** as first-class conversations (thread-scoped search, feedback,
eval, annotation queues). Attachments with multimodal support; LLM-judge scoring of trace
attachments (Jun 2026). No dedicated MCP instrumentation — MCP calls appear via framework
integrations only.

**Dashboards/alerts.** Default project dashboard + **custom dashboards (beta Dec 2025)**:
metric widgets (tokens, cost, feedback scores, duration percentiles, failed-guardrail
counts), statistic cards, experiment radar charts, markdown, multi-project widgets (Aug 2026).
**Alerts (Opik 2.0):** 10 event types (trace errors, feedback-score thresholds, guardrail
triggers, cost/latency thresholds, prompt lifecycle, experiment finished) → **native Slack,
native PagerDuty, generic webhooks**.

**Evaluation.** The broadest built-in metric shelf in this scan: ~30 heuristic metrics
(BLEU/ROUGE/BERTScore/Levenshtein/readability/sentiment…) + LLM-judge metrics (hallucination,
moderation, G-Eval, **LLM Juries** (ensemble judging), **Trajectory Accuracy, Agent Task
Completion, Agent Tool Correctness**, conversation-level metrics incl. User Frustration and
Knowledge Retention). **Online evaluation rules** score incoming production traces (LLM-judge
or code), span-level and thread-level, with **per-evaluation LLM-judge spend budgets**
(Jul 2026) and traced scoring runs. Annotation queues for traces/threads with SME invite
links and multi-reviewer independent scores. `evaluate()` + pytest `llm_unit` integration.

**Prompts/playground/optimizer.** Versioned prompt library (tag-based deployment labels
only); playground with datasets and metrics inline. The differentiator: **Opik Agent
Optimizer** — six algorithms (MetaPrompt, Hierarchical Reflective root-cause, few-shot
Bayesian, evolutionary multi-objective, GEPA, parameter search) that optimize prompts *and*
**MCP tool signatures / function-calling schemas**, including automated cost+latency
multi-objective optimization (Dec 2025).

**Guardrails.** PII (NER) + topic restriction + custom, as a separate (GPU-hungry,
self-host-only) service; cloud gates guardrails to Enterprise.

**Aggregate intelligence.** "Opik Assist"/**Ollie**: automated trace analysis (latency/token/
error/quality patterns), explain-this-cell, exposed via their MCP server (`ask_ollie`,
`run_experiment` are cloud-only tools). No clustering/issue registry.

**MCP surface.** `opik-mcp` server (hosted HTTP+OAuth or local stdio) for Claude Code/Cursor/
VS Code: read/list/write traces, scores, prompts, test suites + the Ollie tools.

**Read for us.** The proof that an Apache-2.0 tool can ship the *entire* surface — alerts,
guardrails, annotation queues, online rules, custom dashboards — without a paid gate
(enterprise buys auth/compliance, not features): the model our free-local posture implies.
Two direct hits on our roadmap: (1) **the optimizer treats MCP tool definitions as an
optimizable artifact** — the nearest thing anywhere to our Advisor/closed-loop ambitions,
and it goes further than our drafted-fixes concept by *searching* fix space against a metric;
worth a deep-dive before Advisor is specced. (2) Per-evaluator spend budgets confirm our
cost-cap instincts at judge granularity. Watch: their agent-eval metric names (Trajectory
Accuracy, Tool Correctness) are converging on our grader vocabulary — good news for concept
validation, bad news for uniqueness of the *names*.

---

## 3. Braintrust — the eval-first commercial benchmark

**Identity.** Closed-source, eval-first, now marketed as "the active observability platform
for agents" with pillars Observe/Evaluate/**Discover**. **Series B $80M at $800M valuation
(Feb 2026, Iconiq)**; customers incl. Notion, Zapier, Vercel, Dropbox, Coursera. The most
instructive competitor for where the category's *intelligence* layer is going.

**Architecture & deployment.** SaaS (US + EU data planes) or **hybrid**: self-hosted data
plane (API, Postgres, Redis, object storage, **Brainstore** — their Rust-over-object-storage
trace DB [vendor claim: sub-second over millions of traces]) in your VPC with a
Braintrust-managed control plane. Pricing: Starter $0 (1 GB processed, 10k scores, 14-day
retention) → **Pro $249/mo** (5 GB, 50k scores, 30-day) → Enterprise; units = GB processed +
per-1k scores.

**Tracing/search.** Typed spans (`eval|task|llm|function|tool|score|classifier`); 6 SDK
languages + OTel GenAI conventions; auto conversation-threading; thread + timeline views;
attachments incl. audio/video. Query layer: **SQL everywhere** (BTQL now legacy) — filters,
custom columns, custom chart measures, alert conditions, even the MCP server exposes
`sql_query`. Full-text search on Brainstore; saved views with permalinks; live tail.

**Alerts/automations.** Log alerts (SQL-filter-triggered, webhook + Slack), environment
alerts, spend alerts, retention automations (Enterprise), automation audit logging; online
scoring with sampling, span/trace/**session-group** scope, and **rewind** (re-score history
from a timestamp).

**Evaluation.** `Eval()` SDK + open-source **autoevals** scorer library; classifiers as
first-class categorical evaluators → filterable columns; **pairwise scoring** in experiment
diff mode (Jul 2026); multi-reviewer human review with weighted categorical scores,
conditional score display, assignments; trials; hill-climbing; turnkey **GitHub eval Action**
posting results on PRs. Experiments: baseline-marked diffs, comparison grade labels
(improvement/regression/tradeoff/tie), summary-table across all experiments.

**Prompts/playground/Loop.** Prompts/tools/scorers are all versioned, invokable **functions**
with environments (dev/staging/prod); playgrounds run multi-task side-by-side against shared
datasets with scorers live, support agent chains and **MCP servers configured in prompts**;
real-time collaborative. **Loop** (AI copilot, GA Nov 2025): NL log analysis, SQL generation,
dataset/scorer generation, prompt optimization, failure-pattern clustering on demand — with
confirmation-gated actions.

**Aggregate intelligence — the headline.** **Topics** (GA 2026-06-01, on every plan): a
continuously updated pipeline — facet extraction (LLM) → embedding clustering
(UMAP+HDBSCAN+c-TF-IDF) → classification into built-in facets (Task / Sentiment / **Issues**,
the latter capturing failure modes like hallucinations and tool-call failures) + custom
facets; classifications become SQL-queryable fields that feed datasets, online scoring,
experiments; daily Slack digest.
This is the shipped version of what LangSmith Engine promises and Langfuse only roadmaps.

**Cost/gateway.** Per-span cost incl. cached/reasoning; spend alerts; `estimated_cost()` in
SQL. The AI proxy grew into a full **AI Gateway** (free beta): 100+ models, encrypted
caching, provider failover, load balancing, workload-identity federation.

**MCP surface.** `api.braintrust.dev/mcp` (OAuth): docs search, object resolution, SQL
queries, experiment summaries with baseline compare, permalinks, "pattern management".

**Read for us.** The strongest external validation of our two biggest bets: (1) **the
closed loop is the product** — their whole pitch is production→eval→fix→CI, i.e. the loop we
own end-to-end locally; (2) **Topics ≈ our planned fleet-issues layer** — their
facet→cluster→classify→queryable-field pipeline is a concrete architecture reference for
D-OB's deterministic clustering + LLM-assist design (ours can be cheaper: forensics buckets
are already structured, no embedding step needed to start). Also instructive: SQL as *the*
universal grammar (filters=alerts=charts=MCP) argues for our RunFilter grammar being one
shared module everywhere, which D-OB already locks. Steal: comparison grade labels
(improvement/regression/**tradeoff**/tie) for our compare workspace verdict sentences;
rewind-style re-rating after judge-prompt changes; pairwise mode for the compare workspace.

---

## 4. W&B Weave — the agent-native session model

**Identity.** Closed-source SaaS (SDKs Apache-2.0), owned by **CoreWeave** (May 2025).
Positioning: "observability and continuous improvement for production agents" — "sessions,
turns, steps, tools, and sub-agents as first-class concepts" [vendor claim]. Tightly coupled
to W&B Models, W&B Inference (hosted open models), and CoreWeave ARIA.

**Architecture & deployment.** Multi-tenant SaaS (**North America only**, shared ClickHouse
cluster), Dedicated Cloud (region of choice), or Self-Managed under a W&B Server license —
requiring **K8s + Altinity ClickHouse Operator + Keeper + S3**. Pricing: Free 1 GB
ingest/mo; Pro from $60/mo with 1.5 GB incl., then **$0.10/MB** overage (=$100/GB — an order
of magnitude above Braintrust's $3–4/GB; verified twice on the pricing page); Enterprise
custom.

**Tracing — the interesting part.** Ops (versioned functions) → Calls (≈spans) → Traces →
**Threads** (turn = top-level call; thread UI with chat pane) → **Agents view** (GA Jun
2026): an OTel-GenAI-conformant hierarchy **Agent → Conversation (groups turns across
separate OTel traces) → Turn → chat/execute_tool spans → nested sub-agents**, with activity
minimaps, multi-turn timelines, token metrics. OTel ingest maps GenAI, OpenInference,
OpenLLMetry, Vercel-AI-SDK, Logfire conventions. MCP: autopatches FastMCP server *and*
client (tools/resources/prompts traced on both sides) but **no cross-boundary trace
stitching** (Phoenix/Langfuse do that part).

**Dashboards/alerts.** Trace plots (auto cost/latency charts + custom plot builder) over the
calls table; monitors page with time-binned score charts + scorer pass/fail dashboard; Weave
panels embed in W&B workspaces. **Automations**: monitor-metric or op-activity triggers with
rolling windows → Slack/webhook.

**Evaluation.** `Evaluation` framework + imperative **EvaluationLogger**; leaderboards;
**Monitors** = online LLM-judge evals sampled over production calls, configured in the UI;
**13 built-in Signals** (GA 2026): 7 quality classifiers (hallucination, user frustration,
jailbreak, lazy responses, forgetfulness…) + **6 error root-cause buckets** (network, rate
limit, oversized request, app bug…), auto-scoring *every* production trace on CoreWeave GPUs
with no external judge key. Guardrails via inline `apply_scorer`. Feedback (reactions/notes),
annotation scorers, **annotation queues** with shareable simplified annotator UI. No turnkey
CI action found.

**Prompts/playground.** Versioned prompt objects with tags/aliases as deployment labels;
playground with W&B Inference catalog + custom endpoints, saved models, in-playground
LLM-judge evals, video input. No Loop-style copilot in Weave itself — the story is the W&B
MCP server + **ARIA** (CoreWeave's autonomous research agent, preview Jun 2026, built on
Weave).

**Read for us.** Two direct validations: (1) their Agent→Conversation→Turn→Tool hierarchy is
the *productized* version of what unified-sessions (D-US) + D-OB step hierarchy specify —
independent confirmation that turn/step/sub-agent first-classing is where agent
observability landed in 2026 (our Hub missions with nested crews already model deeper
nesting than Weave renders); (2) their **error root-cause Signals are a thinner version of
our shipped error-forensics buckets** — we classify with drafted fixes, they classify only;
we're ahead on substance, behind on the "runs automatically over *everything* with zero
config" packaging (ours does run on every terminal run — mandatory auto-rating — so the
packaging gap is presentation, not machinery). Steal: the conversation-level grouping across
traces for our sessions table; per-scorer pass/fail dashboard as a cheap D-OB widget. Watch:
$0.10/MB ingest pricing shows how much headroom "local and free" has as a differentiator.

---

## Cross-tool matrix

Columns: **WB** = this app (✅ built · 🔜 planned · ❌ absent), then Langfuse (LF), LangSmith
(LS, from the 2026-07 research), Phoenix (PX — AX-only features marked ✗→AX), Opik (OP),
Braintrust (BT), Weave (WV). Cells compress; profiles above are authoritative. *(WB column
corrected 2026-08-19 against the authoritative ledgers: the observability, unified-sessions,
and advisor workstreams are **built**, not planned — the CLAUDE.md summary rows lagged.)*

| Capability | WB | LF | LS | PX | OP | BT | WV |
|---|---|---|---|---|---|---|---|
| License / self-host | ✅ local-first, source-open repo | MIT (EE extras) | closed, self-host paid | ELv2, 1 container | Apache-2.0, heavy stack | closed, hybrid VPC | closed, K8s+CH |
| Runs fully offline/air-gapped | ✅ | ✅ (heavy) | ❌ | ✅ | ✅ (heavy) | ❌ (control plane) | ❌ |
| Metrics over time / custom dashboards | ✅ built 2026-07 | ✅ | ✅ | ⚠️ preset only (✗→AX) | ✅ (beta) | ✅ | ⚠️ plots |
| FTS + filter grammar + saved views | ✅ built 2026-07 | ✅ (URL-serialized) | ✅ | ⚠️ partial | ✅ OQL | ✅ SQL | ⚠️ views, no DSL |
| Alerts / watch rules | ✅ built 2026-07 | ✅ (no email) | ✅ | ❌ (✗→AX) | ✅ (+PagerDuty) | ✅ | ✅ |
| Filter→action automation rules | ✅ rules + promote-to-test built | ❌ manual callouts | ✅ | ❌ | ⚠️ online-eval rules | ✅ | ⚠️ |
| Trace hierarchy + per-step cost | ✅ built 2026-07 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agent graph over a run | ❌ (net-new) | ✅ 2 modes | ✅ | ✗→AX | ❌ | ❌ | ✅ agents view |
| Fork / re-run from a step | ✅ built 2026-07 | ✅ playground | ✅ | ✅ span replay | ❌ | ✅ | ✅ |
| Sessions/threads as first-class | ✅ built 2026-07 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ deepest |
| Mandatory auto-quality on every run | ✅ | ❌ opt-in | ❌ opt-in | ❌ | ❌ opt-in | ❌ opt-in | ⚠️ signals (all traces, cloud GPU) |
| Error root-cause + drafted fixes | ✅ | ❌ | ⚠️ Engine | ❌ | ❌ | ⚠️ Loop on demand | ⚠️ buckets only |
| Failure clustering / issues registry | ✅ registry + fleet layer built | ❌ roadmap | ✅ Engine | ❌ | ❌ | ✅ Topics | ⚠️ signals |
| Embedded AI assistant over the data | ✅ (+write, gated) | ⚠️ cloud beta | ✅ | ⚠️ PXI (closed) | ⚠️ Ollie | ✅ Loop | ⚠️ via MCP/ARIA |
| Human annotation queues | ✅ review-queue lite built | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Datasets/experiments with baselines | ✅ collections/suites | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Runnable regression tests in-product | ✅ (we run the agent) | ❌ external runner | ⚠️ | ⚠️ | ⚠️ | ⚠️ remote evals | ⚠️ |
| Prompt mgmt w/ labels & A/B | ⚠️ skills play this role | ✅ flagship | ✅ | ✅ | ⚠️ tags | ✅ functions+envs | ✅ |
| Prompt/agent optimizer | ⚠️ Advisor P1–2 built (evidenced recs, no search) | ❌ | ❌ | ❌ | ✅ 6 algos, MCP tools | ⚠️ Loop | ❌ |
| Guardrails (inline blocking) | n/a (bench) | ❌ | ⚠️ | ❌ (✗→AX) | ✅ | ❌ | ✅ |
| Cost tracking + custom pricing UI | ✅ pricing editor built (token-type gaps → AM-OB6) | ✅ tiered+audited | ✅ | ✅ | ✅ | ✅ | ✅ API |
| Pre-run cost/context preview | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Context-composition / window science | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP server surface scanning + token footprint | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP × model compatibility matrix | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Skill registry / inspector / IDE | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tool defs as optimizable artifact | ⚠️ Advisor recommends trims; no schema search | ❌ | ❌ | ❌ | ✅ optimizer | ❌ | ❌ |
| MCP tracing of user apps | n/a (we are the harness) | ✅ `_meta` | ⚠️ | ✅ instrumentor | ⚠️ via frameworks | ⚠️ | ⚠️ both sides, unstitched |
| **Exposes an MCP server over itself** | ❌ **(net-new)** | ✅ | ✅ | ✅ `/mcp` built-in | ✅ | ✅ | ✅ |
| CLI for agents/CI | 🔜 mcpfp | ✅ | ✅ | ✅ | ✅ | ✅ bt | ⚠️ |
| OTel ingest/export | ❌ by design | ✅ native | ✅ | ✅ native | ✅ | ✅ | ✅ |
| Scheduled data exports | ❌ | ✅ Parquet | ✅ | ⚠️ API | ⚠️ export cmd | ✅ S3 | ⚠️ API |

## Reading the landscape

1. **Three features are now table stakes across every tool — and we lack exactly one of
   them.** (a) An embedded AI assistant over the product's own data (Langfuse Assistant, PXI,
   Ollie, Loop, ARIA) — **we shipped ours first-class**, with approval-gated writes and an
   operability gate none of them have. (b) Metrics-over-time + alerts — **built (2026-07-17)**.
   (c) **An MCP server over the product** — all six competitors ship one; we don't. For the
   product whose subject matter *is* MCP, this is the single most glaring row in the matrix
   (G10 in [`01-gap-analysis.md`](./01-gap-analysis.md)).
2. **Nobody is in our lane.** No tool measures tool-definition footprint, scans/diffs server
   surfaces, checks model-limit compatibility, inspects skills, or previews cost before a
   run. The five bottom-left ✅-only-us rows are the moat, unchanged after examining six
   platforms. The closest approaches come from opposite directions: Opik's optimizer treats
   MCP tool schemas as tunable (post-hoc, metric-driven), Phoenix/Langfuse propagate trace
   context across the MCP boundary (runtime, not static).
3. **The intelligence layer is the 2026 battleground, and our raw material is ahead of our
   packaging.** Braintrust Topics and LangSmith Engine ship clustering; Weave ships
   root-cause classifiers; Langfuse ships none of it (roadmap). We already *persist* forensics
   buckets + fix targets + a rating-issues registry on every run — deeper input than any of
   them — but have no fleet view. the built issues layer (Phase 5, 2026-07-17) lands us ahead of everyone except
   Braintrust/LangSmith, and the drafted-fix→re-run-proof loop is unique.
4. **Two deployment poles, and we sit at the good one.** Phoenix (1 container) proves the
   local-first pole wins developer adoption; Langfuse/Opik/Weave show the cluster-weight
   pole; Braintrust splits the difference with hybrid. Our one-container/SQLite posture is
   Phoenix-class with a cleaner story (no ELv2, no closed-source assistant inside).
5. **Convergent vocabulary, divergent semantics.** "Trajectory accuracy", "tool correctness",
   "agent graphs", "turns/steps" are appearing everywhere — the D-US/D-OB contracts should
   deliberately align *names* with the OTel GenAI / emerging usage (turn, tool call, session)
   so our exports and docs read natively to people arriving from these tools.
6. **Deep-dive candidates for the next pass** (in value order): Braintrust Topics pipeline
   internals (for evolving the built issues layer); Opik Agent Optimizer (before extending the
   built Advisor — P1–2 shipped 2026-08-18 — toward optimizer-style search); Weave's
   Agents-view data contract (for evolving the shipped sessions contract); Phoenix `/mcp`
   server tool inventory (before implementing `roadmap/ci/` WP M.1).

## Sources

Fetched 2026-08-18. Phoenix: github.com/Arize-ai/phoenix (README, LICENSE, releases),
arize.com/docs/phoenix (release-notes, llm-evals, running-pre-tested-evals, metrics,
setup-sessions, mcp-tracing + 04.18.2025 release note, coding-agents, prompts/playground,
self-hosting, pxi, langfuse-alternative FAQ), arize.com/blog/meet-pxi, phoenix.arize.com/pricing,
arize.com/docs/ax (agents, guardrails), pypistats.org. Opik: github.com/comet-ml/opik (README,
releases), comet.com/docs/opik (changelog, self-host/architecture, production/{dashboards,
alerts, guardrails, production_monitoring}, evaluation/{metrics, annotation_queues,
manage_datasets}, testing/pytest_integration, prompt_engineering, python-sdk-reference,
tracing/opentelemetry, mcp-server, agent_optimization), comet.com/site/pricing,
comet.com/site/products/opik (+ langfuse-vs-opik), opik product-release blogs Oct/Dec 2025.
Braintrust: braintrust.dev/docs (release-notes, btql, self-hosting, loop, observe/{topics,
alerts, view-logs}, guides/{monitor, logs/score, human-review, evals, playgrounds, proxy,
automations}, deploy/{prompts, gateway}, platform/datasets, foundations, instrument,
integrations/opentelemetry, reference/mcp, security), braintrust.dev/pricing, /blog/{loop,
topics-ga}, /articles/langfuse-vs-braintrust, /customers, siliconangle.com (Series B,
2026-02-17). Weave: docs.wandb.ai/weave (tracing, threads, trace-agents, otel, costs,
feedback, annotation-queues, querying-calls, trace-plots, evaluation/{monitors,
custom-monitors, guardrails, automations, evaluation_logger}, core-types/evaluations,
tools/{playground, saved-views, comparison}, platform + weave-self-managed, release-notes),
docs.wandb.ai/inference (+ models, usage-limits), docs.wandb.ai/platform/mcp-server,
wandb.ai/site/{weave, pricing, security}, coreweave.com/news (ARIA, 2026-06-29), CoreWeave/W&B
press release Jun 2025.
