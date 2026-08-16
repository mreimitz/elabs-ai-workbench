# References

External sources and internal cross-references. WP files cite these by name (e.g. "see *AI SDK —
Loop Control*" or "see *Braintrust — token usage*").

## Authoritative technical docs (implementers will need these)

### Run engine — Vercel AI SDK
- **AI SDK — Tool Calling** — `streamText`/`generateText` with `tools`, multi-step loops, `onStepFinish`, `usage`: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- **AI SDK — Agents / Loop Control** — `stopWhen`, `stepCountIs(n)` (default 20), `hasToolCall(name)`, step control: https://ai-sdk.dev/docs/agents/loop-control
- **AI SDK 5 announcement** — current major, streaming + tool-call parts, provider metadata: https://vercel.com/blog/ai-sdk-5
- **AI SDK — dynamic prompt caching (Anthropic)** — passing `cache_control` via `providerOptions`: https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching
- Provider packages: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` (docs index at https://ai-sdk.dev/providers).

### MCP — TypeScript SDK
- **MCP TypeScript SDK (repo)** — `Client`, transports, `listTools`/`callTool`: https://github.com/modelcontextprotocol/typescript-sdk
- **MCP client guide** — `docs/client.md`: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md
- **MCP SDKs index**: https://modelcontextprotocol.io/docs/sdk
- **MCP Inspector** — the reference debugging UI we are surpassing (prior art for packet inspection): https://modelcontextprotocol.io/docs/tools/inspector
- ⚠️ `callTool` error model: a tool that runs but fails resolves with `result.isError === true`; a
  transport/request failure **throws**. Handle both (WP 1.3).

### Token & context accounting
- **OpenTelemetry GenAI semantic conventions** — `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, cache/reasoning attributes; our `run_steps` mirror these names:
  https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ (registry:
  https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- **Anthropic prompt caching** — `cache_read_input_tokens` / `cache_creation_input_tokens` usage
  fields: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

### Streaming transport
- **Fastify SSE via `reply.raw`** — set `text/event-stream`, `no-cache`, `keep-alive`, write
  `data: …\n\n`: https://github.com/fastify/sse and pattern notes at
  https://lirantal.com/blog/avoid-fastify-reply-raw-and-reply-hijack-despite-being-a-powerful-http-streams-tool
  (we implement on `reply.raw`; no new dependency).

## Research sources (informed the scope + UI; cite for rationale)

### SOTA chat UI
- IntuitionLabs — Conversational AI UI comparison 2025: https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025
- TheFrontKit — AI Chat UI best practices 2026: https://thefrontkit.com/blogs/ai-chat-ui-best-practices
- Open WebUI review (polished self-hosted chat): https://sider.ai/blog/ai-tools/open-webui-review-the-most-capable-self-hosted-ai-chat-interface-in-2025

### Observability / session logging / inspectors
- MLflow — *LLM Observability with the Best UI* (2026): unify trace + metrics in one pane; span
  detail panels; stable rendering under load: https://mlflow.org/articles/llm-observability-with-the-best-ui-a-2026-engineers-guide/
- Braintrust — *How to track LLM token usage* (2026): the three-level model (per-call prompt/
  completion split, context-window utilization %, per-step attribution); provider usage fields;
  estimator-vs-actual; oversized tool schemas inflate prompt tokens: https://www.braintrust.dev/articles/how-to-track-llm-token-usage-2026
- Confident AI — Top LLM observability tools: https://www.confident-ai.com/knowledge-base/compare/top-7-llm-observability-tools

### Developer-tooling / inspector UX (the right-pane reference)
- **Chrome DevTools** — the inspector vocabulary we adopt for the Run Console right pane (Console,
  Network waterfall, Performance flame/timeline, Application storage/files): overview
  https://developer.chrome.com/docs/devtools ; Network features (waterfall, timing, HAR)
  https://developer.chrome.com/docs/devtools/network ; Performance
  https://developer.chrome.com/docs/devtools/performance . Mapped to our Inspector in
  [`../12-testing-inspector-devtools.md`](../12-testing-inspector-devtools.md).

### Real-time monitoring / context window
- LogRocket — Best React chart libraries 2026 (Recharts default; canvas for high-frequency):
  https://blog.logrocket.com/best-react-chart-libraries-2026/
- Klipfolio — KPI dashboard best practices (critical metric upper-left; 5–10 KPIs): https://www.klipfolio.com/resources/dashboard-examples/executive/kpi-dashboard
- growth-onomics — Real-time KPI dashboards: https://growth-onomics.com/ultimate-guide-to-real-time-kpi-dashboards/
- Comet — Context window explained: https://www.comet.com/site/blog/context-window/

## Internal cross-reference map

| Topic | Internal doc | WPs |
| ----- | ------------ | --- |
| Product decisions (16) | [`../09-testing.md`](../09-testing.md) §1 | all |
| Run console layout / run-bar | [`../10-…ui-concept.md`](../10-testing-ui-concept.md) §2 | 3.3 |
| Conversation pane / tool cards | UI §3 | 3.4 |
| KPI rail + context chart | UI §4 (Zones A,B) | 3.5 |
| Step log + packet inspector | UI §4 Zone C, §5 | 3.6 |
| Pre-run / lifecycle / replay | UI §6, §7 | 3.3, 3.7 |
| Compare matrix | UI §8 | 3.8 |
| Component & token mapping | UI §9, §10 | 3.* |
| Component gaps | UI §11 | 0.1, 3.3, 3.7 |
| DevTools-inspired Inspector (right pane) | [`../12-…`](../12-testing-inspector-devtools.md) + UI §4–§5 | 3.3, 3.5, 3.6, 3.9, 3.10 |
| Data model sketch | [`../09-…md`](../09-testing.md) §8 | 0.4 |
| Existing data model | [`../03-data-model.md`](../03-data-model.md) | 0.4 |
| Token strategy | [`../04-token-counting-strategy.md`](../04-token-counting-strategy.md) | 1.4 |
| Security rules | `.claude/rules/mcp-and-security.md` | 1.1, 1.6 |
