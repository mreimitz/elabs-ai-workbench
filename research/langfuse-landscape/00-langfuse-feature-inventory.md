# 00 — Langfuse feature inventory (as of 2026-08-18)

What Langfuse actually is, feature by feature, from primary sources fetched 2026-08-18. This is
the evidence base for [`01-gap-analysis.md`](./01-gap-analysis.md). Facts below are sourced from
langfuse.com docs/changelog/pricing, github.com/langfuse, and clickhouse.com; the three most
load-bearing claims (acquisition, v4 GA, monitors) were independently re-verified.

## Headline context

- **Langfuse was acquired by ClickHouse, Inc. on 2026-01-16.** Core product stays 100% MIT
  open source, Langfuse Cloud continues as a standalone service, the founding team joined
  ClickHouse. Langfuse already ran entirely on ClickHouse, which is the stated rationale.
- **Langfuse v4 went GA 2026-08-17** ("up to 165× faster"; table loads seconds→milliseconds,
  dashboards ≥10× faster). Cloud becomes **v4-only on 2026-11-16** (legacy APIs/ingestion
  removed). Self-hosted v3 gets security patches through Jan 2027. v4 architecture: one
  denormalized, immutable, append-only **observations** table in ClickHouse; trace-level
  attributes (user_id, session_id, tags) are written onto every observation row by the SDKs
  (Python ≥4.7.0, JS/TS ≥5.4.0); `trace_id` is demoted from primary entity to correlation id;
  the observations table becomes the primary UI surface.
- Positioning: "open-source LLM engineering platform" — observability + prompt management +
  evaluation + metrics, cloud or self-hosted. Increasingly marketed as "Langfuse for Agents"
  (since Nov 2025).
- Scale signals (press page, 2026-08-18): 33.2k GitHub stars, 50M+ SDK installs/month, 6M+
  Docker pulls, "21 of Fortune 50 / 129 of Fortune 500"; named users incl. Ramp, Canva, Twilio,
  Khan Academy, Intuit, Merck. Only a $4M seed before the acquisition (YC W23, Berlin).

## 1. Tracing & data model

- **Model:** Traces (one request/operation) contain nested **observations** of types `span`,
  `generation` (LLM calls with model/usage/cost), `event`, plus agentic types added Aug 2025:
  **AGENT, TOOL, CHAIN, RETRIEVER**. Trace-level attributes: `user_id`, `session_id`, `tags`,
  `metadata`, `environment`, `release` (app version), `version` (component version).
- **Sessions** group related traces (multi-turn chat, agent workflows) with session-level
  scores and cost rollups. **Users** get per-user cost/usage attribution.
- **Environments** (Mar 2025): prod/staging/dev separation inside one project, filterable
  everywhere.
- **SDKs:** Python v4 and JS/TS v5, both **built on OpenTelemetry**; fully async ingestion;
  `@observe` decorator / context-manager APIs. Native **OTel endpoint** since Feb 2025 — any
  language ingests via standard OTLP; ~60% of Cloud observations already arrive as OTel.
  Trace sampling; SDK-side masking hooks (media-aware since Jun 2026).
- **Agent graph view:** auto-inferred whenever a trace contains agentic observation types
  (native for LangGraph). Two modes since Jul 2026: **Aggregated** (repeated steps collapsed
  into nodes with counters, loops as cycles — the agent's "shape") and **Expanded** (unrolled
  execution order).
- **Multimodal:** images/audio/video/documents; base64 auto-extracted to object storage and
  replaced by reference tokens, deduplicated by content hash.
- **MCP tracing** (docs page "MCP tracing"): W3C Trace Context propagated through the MCP tool
  call `_meta` field — client injects, server restores — so MCP client + server unify into one
  trace. Plus tool-call-level features: filter observations by tool calls, tool-call dashboard
  widgets (Dec 2025), tool calls accessible in evaluators (Jul 2026).
- Human touchpoints on traces: inline comments anchored to text selections (Jan 2026),
  @mentions/reactions (Nov 2025), **Corrected Outputs** (Jan 2026) — expert-fixed output
  versions captured on traces, positioned as fine-tuning data.

## 2. Dashboards & metrics

- Three curated dashboards (Latency / Cost / Usage) + **custom dashboards** (GA May 2025):
  line, bar, time-series, pie, histogram, pivot-table widgets; metrics count/latency/cost/
  scores; group-by user, model, time, trace name, session; chart→table drill-down. Any
  observations table can be flipped into a chart (Jul 2026). Project **Home is a customizable
  dashboard** (Jul 2026).
- **Dashboards as code** via public API, **CLI, and MCP server** (Jul 2026).
- **Metrics API v2**: `GET /api/public/v2/metrics` over views `observations` /
  `scores-numeric|categorical|boolean` with dimensions and aggregations (`sum_totalCost` etc.);
  high-cardinality dimensions banned from group-by; max 1,000 rows.
- **Pulse** (Jul 2026, v4-only): an outlier-surfacing chart strip above the observations table
  — count/cost/latency (p95 default), sqrt height scale to make outliers pop, adaptive buckets
  from 1 min to 1 week, click/drag a bucket to filter the table to it.

## 3. Search & filtering

- **Full-text search** over trace/observation inputs+outputs since May 2025, ClickHouse-native
  FTS on Cloud since May 2026; FTS across dataset items too.
- **Filter search bar** (Jun 2026): `field:value` grammar, implicit AND, comparison operators,
  wildcards, negation, `level:(ERROR OR WARNING)`, `metadata.region:eu` dot paths,
  `scores.accuracy:>0.8`, `has:endTime` null checks, aliases (`env`, `model`, `cost`, `ttft`,
  `tps`, …). **The whole query serializes into the URL** — filtered views are shareable links.
- **Saved/shared table views** since May 2025. "Ask AI" natural-language → drafted filters
  (Cloud-only beta, Jun 2026).

## 4. Single-trace debugging

- Trace tree with aggregated, color-coded latency/cost rollups per subtree; **timeline view**
  for latency debugging; peek view with keyboard navigation in tables; log-level filtering
  inside the trace view; large I/O payloads kept inspectable.
- **"Open in Playground"** on any generation — reopen exact messages/params, tweak, re-run,
  save result into prompt management.
- No trace-vs-trace comparison view (comparison exists only at dataset-run/experiment level).
  No in-trace text search (FTS is table-level).

## 5. Alerting & automations

- **Monitors & Alerts** (Jun 2026, requires v4): a metric = aggregation over observations or
  scores (numeric/categorical/boolean — boolean metric = share-true rate, e.g. hallucination
  rate); required ALERT threshold + optional WARNING threshold; lookback windows 1h/1d/1w;
  states UNKNOWN → OK / WARNING / ALERT / NO_DATA / PAUSED; no-data handling modes;
  renotification intervals for sustained conditions. **Channels: Slack, HMAC-signed webhook,
  GitHub Actions `workflow_dispatch`. Email is not a channel.** Plan limits: 2 (Hobby) / 20
  (Core) / 50 (Pro) / 100 (Enterprise).
- **Spend alerts** (Oct 2025): org-level cloud-bill thresholds.
- **Web Callouts** (Jun 2026): *manual*, per-trace/observation/session HTTP POST to
  admin-configured endpoints from the UI (attach a trace to a ticket, trigger a re-run).
  Langfuse has **no automatic filter→action rules** on matching traces (their own comparison
  page concedes LangSmith Engine's automated failure clustering as a LangSmith strength).
- **Prompt webhooks** (Jul 2025): notifications on prompt version/label changes (+ Slack).

## 6. Evaluation

- Methods: LLM-as-a-judge, **code evaluators** (May 2026 — deterministic Python/TS checks
  executed server-side on live observations), annotation queues, user feedback, scores via
  UI/SDK/API, external eval pipelines.
- **LLM-as-a-judge:** targets are **live observations** (observation-level since Feb 2026 —
  individual LLM calls, retrievals, tool calls; filterable by observation type, trace name,
  tags, metadata) and **experiment runs on datasets**. Trace-level evaluators are deprecated
  (sunset Nov 2026). Managed **evaluator library** (hallucination, context relevance,
  toxicity, helpfulness; partner-maintained by Ragas). Custom evaluators with variable
  mapping via JSONPath; tool calls accessible in evaluator prompts (Jul 2026); live preview on
  last-24h data; deterministic sampling, consistent across evaluators (Aug 2026); per-eval
  executions are themselves traced; evaluators manageable via API and MCP. Judge = any
  tool-calling model via LLM Connections.
- **Scores:** NUMERIC, CATEGORICAL, BOOLEAN, TEXT; attach to traces, observations, sessions,
  dataset runs. Scores API v3.
- **Annotation queues** since Oct 2024: assignments to users (Aug 2025), session items,
  keyboard shortcuts; plan-limited (1 / 3 / unlimited).
- **User feedback:** browser-side score ingestion with the public key only (Jun 2026) —
  frontend thumbs-up/down without exposing secrets.

## 7. Datasets & experiments

- Datasets from production traces/observations (single, batch, duplicate-across), CSV upload,
  API; folders; **JSON-schema enforcement on items** (Nov 2025); **item versioning**
  (Dec 2025) + experiments against historical dataset versions (Feb 2026); multimodal items
  (Jun 2026); FTS over items.
- **Experiments are a first-class top-level concept** (Apr 2026). Prompt experiments from the
  UI (pick prompt version + LLM connection + evaluators); Experiment Runner SDK; compare view
  with **baseline marking** for regression/improvement, inline annotation, filters. CI/CD:
  experiments in GitHub Actions (May 2026); **secure remote experiment triggers** — a UI
  button fires your own runner via signed headers (Jul 2026); experiments queryable via API +
  MCP.

## 8. Prompt management (their flagship)

- Auto-incremented versions with commit messages and side-by-side diffs. **Labels** (`latest`,
  `production`, arbitrary custom) — deploy/rollback = move a label; protected labels
  (Enterprise). Client-side SDK caching → zero-latency serving with fallback prompts.
  **Composability** (prompts referencing prompts), message placeholders, folders.
- **A/B testing:** label two variants, the app picks client-side, Langfuse tracks
  latency/cost/scores per version. Prompt-linked analytics per version. Webhooks on change;
  GitHub integration; n8n node.
- **Playground:** BYO provider keys (OpenAI/Anthropic/Vertex/AI Studio/Bedrock/custom
  OpenAI-compatible); tool calling + structured output; variables; **side-by-side multi-variant
  execution** (Jul 2025); open-from-generation; save-to-prompt-management.

## 9. Cost & token tracking

- Built-in maintained prices for OpenAI/Anthropic/Google with a **daily automated audit**
  against provider docs; **custom models UI-editable** with regex match patterns; user
  overrides beat built-ins.
- **Usage types:** `input`, `output`, `cached_tokens`, `cache_read_input_tokens`,
  `audio_tokens`, `image_tokens`, `reasoning_tokens`. **Pricing tiers** (Dec 2025):
  context-dependent prices (e.g. different rate above a 200k-token input threshold),
  condition-evaluated on usage/model params/metadata. Ingested (SDK-provided) costs take
  precedence over inferred ones.
- Cost dashboards, per-user/per-session attribution, spend alerts, Metrics-API aggregation.

## 10. Aggregate intelligence

- **Langfuse Assistant** (public beta Jun 2026, Cloud-only): natural-language Q&A over
  traces/observations/metrics, built on Langfuse's own MCP server tools.
- **Pulse** (see §2) surfaces outliers visually.
- **No automated failure clustering / issue detection shipped.** "Proactive issue detection —
  group interactions into recurring topics and failure modes" is an in-progress roadmap item.
  Also on the roadmap: **Langfuse Gateway** (model-access control plane, virtual keys) and
  agent-trajectory evals.

## 11. API, export & platform surface

- **Public API**: full CRUD on traces, observations, scores, prompts, datasets, projects;
  OpenAPI spec; Admin APIs for org/project management; Observations API v2 (cursor
  pagination, field selection, mandatory time filters); Metrics v2, Scores v3, Experiments
  API, annotation-queue API, data-retention API.
- **Langfuse CLI** (Feb 2026): "fully use Langfuse from the CLI, built for AI agents and
  power users."
- **Langfuse MCP server** (hosted in all regions + self-hostable, streamable HTTP,
  project-scoped keys): read+write tool families shipped incrementally — prompts (2025),
  observations+metrics+scores (May 2026), evaluators (Jun 2026), experiments (Jul 2026),
  dashboards (Jul 2026). Explicit clients: Claude Code, Codex, Cursor. Separate docs-MCP
  server + llms.txt + a published "Langfuse agent skill" playbook (May 2026).
- **Blob-storage exports**: scheduled (20-min/hourly/daily/weekly) exports of enriched
  observations + scores to S3/GCS/Azure as **Parquet (default)/CSV/JSON/JSONL**; gated to
  Pro+Teams add-on, Enterprise, and self-hosted. PostHog and Mixpanel integrations.
- ~100 integrations: LangChain/LangGraph, Vercel AI SDK, OpenAI Agents, Google ADK, Pydantic
  AI, CrewAI, LlamaIndex, LiteLLM, DSPy, AutoGen, Haystack, Semantic Kernel; gateways
  (LiteLLM, Helicone, OpenRouter, Portkey); no-code (Dify, Flowise, Langflow, OpenWebUI, n8n);
  voice (Pipecat, LiveKit); Amazon Bedrock AgentCore (Nov 2025).

## 12. Deployment, licensing, security, pricing

- **License:** MIT except `ee/` folders; June 2025 "open sourcing all product features" moved
  all remaining product features to MIT — OSS self-host has **feature parity with Cloud**.
  Commercial EE (license key): project-level RBAC, data-retention policies, audit logs, SSO
  *enforcement*, SCIM, UI customization.
- **Self-host architecture (heavy):** web + worker containers, **Postgres (OLTP) + ClickHouse
  (OLAP) + Redis + S3/blob storage all required**; Docker Compose (no HA), Helm/K8s,
  Terraform modules for AWS/Azure/GCP. Post-acquisition self-host pricing: free OSS vs
  Enterprise (bundled with ClickHouse commercial plans) — the old per-user self-host tier is
  gone.
- **Security/compliance:** SOC 2 Type II, ISO 27001, GDPR, HIPAA region; 4 cloud regions
  (US, EU, Japan, HIPAA-US). RBAC org roles + project-level overrides (paid). Audit logs
  (Enterprise/Teams). API keys are project-scoped.
- **Cloud pricing** (2026-08-18): unit = **1 trace + 1 observation + 1 score ingested**
  (platform-generated ones count too). Hobby $0 (50k units/mo, 30-day retention, 2 users);
  Core $29/mo (100k units incl., $8 per additional 100k, 90-day retention); Pro $199/mo
  (3-year retention, Teams add-on $300/mo for SSO-enforcement/project-RBAC/audit-logs/blob
  exports); Enterprise $2,499/mo. No seat-based pricing (explicit differentiator).

## Self-stated differentiators (their comparison pages)

MIT OSS with cloud-parity self-hosting (incl. air-gapped); open ClickHouse engine
(SQL-inspectable, same engine cloud and self-host); OTel-native, framework-agnostic (~100
integrations), spans exportable elsewhere; no seat fees, $8/100k-unit overage; API-first full
CRUD + scheduled blob exports. Conceded LangSmith advantages: zero-setup for LangChain apps,
managed agent deployment, **LangSmith Engine's automated failure clustering with proposed
fixes**.

## Known unknowns

Full observation-type enum beyond the seven confirmed; exact GitHub release dates (fetches
returned implausible dates); log-level enum beyond ERROR/WARNING; retention-config plan
gating; media size limits. None affect the gap analysis.

## Sources

Fetched 2026-08-18: langfuse.com/docs (+ per-feature pages: observability/data-model,
observability/features/{agent-graphs, multi-modality, filter-search-bar, full-text-search,
pulse, mcp-tracing, token-and-cost-tracking}, metrics/features/{custom-dashboards,
metrics-api, monitors}, evaluation/overview, evaluation/evaluation-methods/llm-as-a-judge,
evaluation/experiments/experiments-via-ui, prompt-management/*, api-and-data-platform/*
{export-to-blob-storage, mcp-server}, rbac, roadmap); langfuse.com/changelog (Sept 2024 →
Aug 2026, incl. 2026-08-17-langfuse-v4, 2026-06-19-langfuse-assistant-public-beta,
2026-06-17-web-callouts); langfuse.com/blog/2026-03-10-simplify-langfuse-for-scale;
langfuse.com/pricing, /pricing-self-host, /self-hosting, /security, /press/press,
/faq/all/langsmith-alternative; github.com/langfuse/langfuse;
clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability. Re-verified
directly: acquisition post, v4 changelog entry, monitors doc.
