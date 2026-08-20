---
type: "Research Note"
title: "Microsoft Copilot \u2014 Provider Summary"
description: "Data file: data/saas/microsoft-copilot.json"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Microsoft Copilot — Provider Summary

> **As-of date:** 2026-06-21  
> **Data file:** `data/saas/microsoft-copilot.json`  
> **Source authority:** Microsoft Learn (Tier 1), GitHub Docs (Tier 1), Microsoft Official Blog (Tier 1)

---

## Provider Overview

Microsoft Copilot is a **product-layer umbrella**, not a single model. It encompasses several distinct surfaces that share the "Copilot" brand but differ substantially in their underlying models, extensibility, billing, and relevance to MCP tool orchestration.

### The critical distinction: product limits vs. raw model limits

Every "limit" in this file is **product-level**, not a raw API limit. Microsoft routes Copilot requests to underlying OpenAI GPT models (GPT-5 family, o3/o3-mini) and its own MAI models (MAI-Code-1 at Build 2026). The product layer adds its own caps — plugin context windows, per-turn grounding budgets, file size limits — that are often far more restrictive than the underlying model's raw context window.

Where a number traces back to the underlying OpenAI/MAI model spec, this is called out in the `notes` field with `source_tier` lowered accordingly.

### Three surfaces profiled

| Surface | ID | Underlying model(s) | MCP native | Billing |
|---|---|---|---|---|
| Microsoft 365 Copilot | `microsoft-365-copilot` | GPT-5 family (via Microsoft) | Yes (declarative agent plugins) | Per-seat ($21–$30/user/month) |
| Microsoft Copilot (Consumer) | `microsoft-copilot-consumer` | GPT-5 + o3 (real-time routing) | No | Free / M365 subscription |
| GitHub Copilot | `github-copilot` | Model picker: GPT-5, Claude, Gemini, MAI-Code-1 | Yes (VS Code MCP servers, GA) | AI Credits / per-token (June 2026+) |

---

## Surface 1: Microsoft 365 Copilot

**Work AI assistant embedded in Microsoft 365 apps (Word, Excel, Teams, Outlook, etc.)**

### Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `context_window_tokens` | null | low | Not published. Plugin context window = 4,096 tokens (includes all overhead); optimize to ~2,730. Full per-prompt window not disclosed. |
| `max_input_tokens` | null | low | Not published. Product applies document/grounding caps rather than raw token limits. |
| `max_output_tokens_max` | null | low | Not published. Plugin response truncated by 4,096-token plugin window. |
| `extended_context` | null | low | No documented extended-context mode. |
| `input_output_shared` | null | low | Not documented. |

### Tokenization

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `tokenizer_family` | o200k_base (inherited) | medium | Inherited from underlying OpenAI GPT-5 family. Microsoft does not publish tokenizer details. |
| `tokenizer_public` | true | medium | tiktoken o200k_base is public. |
| `tokenizer_access` | tiktoken (approximate) | medium | No M365 Copilot-native count-tokens API. |
| `count_tokens_method` | tiktoken o200k_base | low | Approximate only. |
| `chars_per_token_estimate` | ~4 | medium | Standard English estimate for o200k_base. |

### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `function_calling` | true | high | Plugins (MCP or OpenAPI) in declarative agents. |
| `native_mcp` | **true** | high | GA: MCP servers as plugins in declarative agents. Build via M365 Agents Toolkit or Copilot Studio. |
| `parallel_tool_calls` | null | low | Architecture docs: sequential processing only in declarative agents. |
| `max_tools_hard` | null | low | No hard numeric cap published. |
| `max_tools_practical` | **10 functions/plugin** | medium | Microsoft documents quality degradation with >10 functions per plugin (Tier-1 source). |
| `tool_definition_shape` | raw_mcp or openai_function | high | Supports both MCP server tools and OpenAPI-based REST API plugins. |
| `tool_defs_count_as_input` | true | high | Plugin definitions inject into 4,096-token window. |
| `tool_search_deferral` | true (semantic matching) | medium | For >5 plugins: semantic matching defers injection. For ≤5: always-injected. |

**Documented plugin limits (Tier 1, Microsoft Learn):**
- Plugin response limit: 25 items
- Plugin context (all context + response data): 4,096 tokens — optimize to ~2,730 (~66%)
- Quality degrades with >10 functions per plugin
- Sequential, not parallel tool calls
- Grounding record limit: 50 items per turn
- Timeout: 45 seconds

### Skills / Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `skills_supported` | true | high | Declarative agents = skills analog. |
| `skills_loading_model` | always_on (≤5 plugins) / semantic-match (>5) | medium | Hybrid model depending on plugin count. |
| `memory_feature` | true | medium | Microsoft Graph grounding (email, calendar, docs, meetings) + Work IQ (GA June 16, 2026). |
| `prompt_caching` | false | low | Not exposed at M365 product layer. |

### Cost

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `billing_unit` | **per_seat_monthly** | high | Add-on license: ~$21/user/month (Business, promotional) or ~$30/user/month (Enterprise, annual). Requires qualifying M365 base plan. |
| `input_per_mtok_usd` | null | high | Not applicable — seat-licensed. |
| `output_per_mtok_usd` | null | high | Not applicable — seat-licensed. |

---

## Surface 2: Microsoft Copilot (Consumer)

**Free/bundled AI assistant at copilot.microsoft.com; also on Windows, Edge, mobile**

### Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `context_window_tokens` | 200,000 | **low** | Community-sourced (Independent Advisor citing Azure AI Foundry reasoning docs for o3/o3-mini). Not official Microsoft consumer product spec. |
| `max_input_tokens` | 200,000 | **low** | Same source. |
| `max_output_tokens_max` | 100,000 | **low** | Same community source. Applies to Think Deeper and Quick Response modes. |

> **Important caveat:** Microsoft does not publish official token limits for the consumer Copilot product. The 200K/100K numbers are cited from an OpenAI Azure AI Foundry reasoning-model spec page, not a Copilot-specific limit. The actual product limit may differ. Confidence is low.

### Model routing

Consumer Copilot uses **real-time model routing** (introduced with GPT-5 in late 2025):
- **Smart mode (Quick Response):** fast-path via GPT-5 high-throughput or GPT-4o-mini variant
- **Think Deeper:** o3/o3-mini reasoning model (unlimited use as of Feb 2025)
- **Voice mode:** o1/o3 family (unlimited as of Feb 2025)

The page on GPT-5 in Copilot notes: *"GPT-5 in Copilot has since been upgraded to newer OpenAI models"* — implying continuous model upgrades with no versioned model pinning.

### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `function_calling` | false | medium | No developer tool-calling surface. Built-in tools (Bing search, DALL-E 3, file analysis) are Microsoft-managed and not developer-extensible. |
| `native_mcp` | **false** | medium | No MCP support in consumer product. |

**Not relevant for MCP Token Footprint.** This surface has no developer tool extensibility and should be excluded from recommender scoring.

### Cost

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `billing_unit` | **free_or_subscription** | high | Free with Microsoft account (ad-supported). Also included in Microsoft 365 Personal (~$9.99/month) and Home (~$12.99/month). Think Deeper and Voice are free/unlimited since Feb 2025. |

---

## Surface 3: GitHub Copilot

**Developer tool (IDE / CLI / web) with model picker and native MCP support**

### Context

Context window depends on the model selected. Documented options (as of 2026-06):

| Model | Context Window | Source |
|---|---|---|
| GPT-4o | 128,000 tokens | Community/aggregator reports |
| o3 / o3-mini | 200,000 tokens | Azure AI Foundry reasoning docs |
| Claude Sonnet 4.6 | up to 1,000,000 tokens | GitHub Docs (extended context) |
| Gemini 3.1 Pro / Flash | up to 1,000,000 tokens | GitHub Docs (extended context) |
| MAI-Code-1 | not published | Build 2026 announcement (private preview) |

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `context_window_tokens` | null (model-dependent) | low | No single value; see table above. |
| `extended_context` | 1,000,000 | medium | Supported for Claude and Gemini models. User selects default vs. extended in model picker. |
| `max_input_tokens` | null | low | Community reports: ~60% of context window (Copilot reserves ~40% for output). |

### Tokenization

Model-dependent:
- OpenAI models (GPT-5, o3): `o200k_base` via tiktoken
- Anthropic Claude: closed tokenizer, use `count_tokens` API
- Google Gemini: SentencePiece-based, use `countTokens` API
- MAI-Code-1: unknown

### Tools / MCP — THE KEY SURFACE FOR THIS PROJECT

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `function_calling` | **true** | high | Agent mode in VS Code, JetBrains, Xcode, CLI. |
| `native_mcp` | **true** | high | GA in VS Code 1.99+ (early 2026). Local and remote MCP servers. GitHub MCP Server hosted by GitHub. |
| `tool_definition_shape` | raw_mcp | high | GitHub Copilot consumes MCP tool schemas natively; model re-serializes internally. |
| `tool_defs_count_as_input` | **true** | high | MCP tool definitions are injected as input tokens every turn. Core footprint concern. |
| `max_tools_hard` | null | low | Not documented. Underlying model limits may apply (GPT-5 family: 128 tools/request). |
| `max_tools_practical` | null | low | Not studied specifically. Community reports: context fills quickly with many MCP servers. |
| `tool_search_deferral` | **false** | medium | No deferred MCP tool loading documented. All configured MCP tools loaded per session (always-on). |

**Context headroom concern:** Community GitHub discussions report that Copilot reserves ~40% of the context window for output even with minimal input. This means for a 128K GPT-4o session, only ~77K tokens are available for tool definitions + user prompt + code context.

### Skills / Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `skills_supported` | true | high | MCP servers are the skills mechanism. |
| `skills_loading_model` | always_on | medium | All configured MCP tools loaded per session, no deferral. |
| `memory_feature` | false | medium | No cross-session memory. Per-session context only. |
| `prompt_caching` | null | low | Not documented. May be applied internally by GitHub for static context. |

### Cost (as of June 1, 2026 — AI Credits billing)

| Field | Value | Confidence | Notes |
|---|---|---|---|
| `billing_unit` | **ai_credits_per_token** | high | 1 AI credit = $0.01 USD. Per-token rates vary by model. |
| `input_per_mtok_usd` | null | low | Model-dependent; see docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing. |
| `output_per_mtok_usd` | null | low | Model-dependent. |

**Plan allowances (as of 2026-06):**

| Plan | Monthly price | AI Credits included | Notes |
|---|---|---|---|
| Copilot Free | $0 | Limited | Basic usage |
| Copilot Pro | $10/month | Monthly allowance | Standard |
| Copilot Pro+ | $39/month | Higher allowance | Premium models |
| Copilot Max | ~$100/month AI credits | Highest | Priority access |
| Copilot Business | $19/user/month | 1,900/user ($19 equiv.) | Org plan |
| Copilot Enterprise | $39/user/month | 3,900/user ($39 equiv.) | Enterprise (GH Enterprise Cloud) |

MCP tool definition tokens consumed per turn count toward the AI Credits budget. High-footprint MCP servers will materially increase per-interaction cost.

---

## Takeaways for the Recommender

### 1. Microsoft 365 Copilot — avoid for MCP-heavy workloads

The documented 4,096-token plugin context window is the dominant constraint. With overhead (~33% reserved per Microsoft guidance), only ~2,730 tokens are usable for plugin definitions + responses. A single medium-complexity MCP server with 10 tools can exhaust this budget. The recommender should **flag M365 Copilot as unsuitable** if MCP server footprint exceeds ~1,500–2,000 tokens, and note the 10-function practical limit.

### 2. Consumer Copilot — not applicable

No developer tool/MCP surface. Exclude from recommender scoring for MCP footprint use case.

### 3. GitHub Copilot — the most relevant Microsoft surface

- Native MCP is GA and well-documented
- Context window varies 128K (GPT-4o default) to 1M (Claude/Gemini extended)
- **Tool definitions are always-on (no deferral)** — this means every MCP tool in every configured server consumes input tokens on every turn, unlike Claude Code's `ENABLE_TOOL_SEARCH`/`defer_loading`
- AI Credits billing (June 2026) makes tool-definition token overhead directly cost-relevant
- The ~40% output reservation means practical input headroom is ~60% of the nominal window
- For footprint analysis: use the selected model's native tokenizer (tiktoken for GPT models, count_tokens for Claude, countTokens for Gemini)
- **No prompt caching** documented for MCP tool definitions in GitHub Copilot — no discount on repeat-turn tool injection

### 4. MAI-Thinking-1 (announced Build 2026)

Microsoft's first in-house reasoning model: 35B active parameters, 256K context window, private preview on Microsoft Foundry. Not yet available in GitHub Copilot's model picker. When it reaches GA, it would be a relevant entry: competitive with Claude/Gemini at lower token cost per Microsoft's benchmarks.

---

## Sources

- [Build plugins from an MCP server for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins)
- [Plugins for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins)
- [Declarative Agents for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-declarative-agent)
- [Declarative agent architecture](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-architecture)
- [License Options for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-licensing)
- [About Model Context Protocol (MCP) — GitHub Copilot](https://docs.github.com/en/copilot/concepts/context/mcp)
- [Extending GitHub Copilot Chat with MCP servers](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp)
- [Supported AI models in GitHub Copilot](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [GitHub Copilot Plans](https://docs.github.com/en/copilot/get-started/plans)
- [GitHub Copilot is moving to usage-based billing — community discussion](https://github.com/orgs/community/discussions/192948)
- [Context window filling discussion](https://github.com/orgs/community/discussions/186340)
- [~40% context reserved for output discussion](https://github.com/orgs/community/discussions/188691)
- [What's new with GPT-5 in Copilot](https://www.microsoft.com/en-us/microsoft-copilot/for-individuals/do-more-with-ai/general-ai/whats-new-with-gpt-5-in-copilot)
- [Token limit Q&A for Think Deeper / Quick Response (community, references Azure AI Foundry reasoning docs)](https://learn.microsoft.com/en-us/answers/questions/5447652/whats-token-limit-for-think-deeper-quick-response)
- [Microsoft Build 2026: Be yourself at work (MAI-Thinking-1, MAI-Code-1 announcements)](https://blogs.microsoft.com/blog/2026/06/02/microsoft-build-2026-be-yourself-at-work/)
- [Microsoft 365 Copilot pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing)
- [Add MCP apps to declarative agents](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps)
- [Enhance GitHub Copilot agent mode with MCP](https://docs.github.com/en/copilot/tutorials/enhance-agent-mode-with-mcp)

---

## MCP / tool limits

> Research pass: 2026-06-21. Layer column: **Product** = enforced by Microsoft/GitHub product layer; **Client** = VS Code host layer; **Model** = underlying model API. Many limits here are product/plugin-level, not raw model limits. Confidence noted per row.

### Microsoft 365 Copilot (`microsoft-365-copilot`)

| Limit | Value | Unit | Layer | Confidence | Source |
|---|---|---|---|---|---|
| `max_total_tools` (actions per agent) | **1–10** | actions (plugins/MCP servers) | Product | high | [Declarative agent manifest v1.7](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.7) — `actions` array "must contain at least one and no more than 10 objects" |
| Always-injected plugins (≤5) / semantic-matched (>5) | 5 threshold | plugins | Product | high | [Plugins overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins) |
| `max_tools_practical` (per plugin) | **10** | functions | Product | medium | Microsoft: quality degrades with >10 functions/plugin due to token window |
| `max_tools_hard` | null | — | Product | low | No hard per-request function count cap published; max_total_tools (10 actions) is the binding aggregate |
| `max_request_size` (plugin I/O token budget) | **4,096** | tokens | Product | high | [Declarative agent architecture](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-architecture) — includes all context + response data; optimize to ~2,730 (~66%) |
| `max_tool_result_size` (plugin response) | **25** | items | Product | high | Same source — "Plugin response limit: 25 items" |
| Grounding record limit | 50 | items | Product | high | Same source |
| Turn timeout | 45 | seconds | Product | high | Same source (includes network latency + processing) |
| `max_parallel_tool_calls_count` | **1** (sequential only) | — | Product | medium | Architecture doc: "grounding and calls to external tools happen sequentially" — no parallel calls |
| `tool_use_per_turn_limit` | null | — | Product | low | Not published; 45-second timeout is the indirect bound |
| `max_connected_servers` | null (effective max = 10 via actions limit) | — | Product | low | Not a separate limit; the 10-action manifest cap is binding |
| `max_tool_name_len` | null | chars | Product | low | Not published; manifest string default = 4,000 chars |
| `max_tool_description_len` | null | chars | Product | low | Not published; manifest string default = 4,000 chars |
| `tool_search_deferral` | true (semantic matching >5 plugins) | — | Product | medium | Tier 1 |
| Conversation starters cap | 12 | items | Product | high | Manifest v1.7: "array can't contain more than 12 objects" |
| Agent name max | 100 | chars | Product | high | Manifest v1.7 schema |
| Agent description max | 1,000 | chars | Product | high | Manifest v1.7 schema |
| Agent instructions max | 8,000 | chars | Product | high | Manifest v1.7 schema; also Copilot Studio web app limit |
| Manifest string default | 4,000 | chars | Product | high | Manifest v1.7 schema |

**Key design constraints for M365 Copilot:**
- The **4,096-token plugin I/O window** (optimize to ~2,730 usable) is the dominant MCP limit. A single medium-complexity MCP server with verbose tool descriptions can exhaust it.
- The **10-action maximum per declarative agent** effectively caps the number of MCP servers at 10.
- **Sequential-only processing**: no chained operations, no looped plans. Single grounding operation + external tool call per turn.
- Plugin functions are unlimited per plugin manifest, but all matched-plugin functions are injected even if only one matched — consuming tokens for every function in the plugin.

---

### Microsoft Copilot Consumer (`microsoft-copilot-consumer`)

| Limit | Value | Unit | Layer | Confidence | Source |
|---|---|---|---|---|---|
| `max_tools_hard` | null (N/A) | — | — | low | No developer tool surface; not applicable |
| `max_total_tools` | null (N/A) | — | — | low | No developer tool surface; not applicable |
| `max_request_size` | null (N/A) | — | — | low | No API plugin surface |
| `max_tool_result_size` | null (N/A) | — | — | low | No developer tool surface |
| `max_parallel_tool_calls_count` | null (N/A) | — | — | low | Not applicable |
| `max_connected_servers` | null (N/A) | — | — | low | No MCP support |

**Consumer Copilot has no developer tool/MCP surface.** All tool limit fields are null/not-applicable. Exclude from MCP Token Footprint recommender scoring.

---

### GitHub Copilot (`github-copilot`)

| Limit | Value | Unit | Layer | Confidence | Source |
|---|---|---|---|---|---|
| `max_tools_hard` | **128** | tools per request | Client (VS Code) | high | [VS Code issue #290356](https://github.com/microsoft/vscode/issues/290356); [vscode-copilot-release #13065](https://github.com/microsoft/vscode-copilot-release/issues/13065); [#251588](https://github.com/microsoft/vscode/issues/251588); [#253539](https://github.com/microsoft/vscode/issues/253539) — error: "You may not include more than 128 tools in your request" |
| `max_total_tools` | **128** | tools per request (all servers combined) | Client (VS Code) | high | Same as max_tools_hard; cumulative across all connected MCP servers |
| `max_tools_practical` | **13** (core set) | tools | Client | medium | [GitHub blog Nov 2025](https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/) — built-in toolset trimmed from ~40 to 13 core tools; 2–5pp improvement on SWE-bench benchmarks |
| `tool_search_deferral` | **true** (virtual tools) | — | Client | high | Same source — embedding-guided tool clustering + virtual tool stubs; `github.copilot.chat.virtualTools.threshold` setting |
| `max_connected_servers` | null (no cap; 128-tool limit is binding) | — | Client | low | No published server count cap; 128-tool total request limit is the constraint |
| `max_tool_name_len` | null | chars | Client/Model | low | Not published at Copilot layer; underlying model caps apply (e.g., OpenAI 64 chars) |
| `max_tool_description_len` | null | chars | Client/Model | low | Not published at Copilot layer |
| `max_request_size` | null | — | Client/Model | low | Model context window is the binding constraint; varies by selected model |
| `max_tool_result_size` | null | — | Client/Model | low | Tool results count as input tokens; model context window is binding |
| `max_parallel_tool_calls_count` | null | — | Client/Model | low | Sequential in practice; may be model-dependent |
| `tool_use_per_turn_limit` | null | — | Client | low | Not published; context window indirectly bounds multi-step runs |

**Key design constraints for GitHub Copilot:**
- The **128-tool request cap** is the primary MCP limit at the VS Code client layer. It applies regardless of the selected model's native tool capacity.
- **Virtual tools** (embedding-guided clustering, `github.copilot.chat.virtualTools.threshold`) group large tool sets into stub entries, enabling more than 128 tools to be "available" without exceeding the request cap. Setting the threshold above 128 has no effect.
- **All configured MCP tools are always-on** by default (no lazy loading): tool definitions consume input tokens on every turn. Virtual tools mitigates this by deferring non-core tools.
- **13 core built-in tools** is the GitHub-recommended practical baseline. Each additional MCP server's tools add to the token footprint and push toward the 128 hard cap.
- Under **AI Credits billing** (June 2026+), MCP tool-definition tokens per turn directly translate to per-interaction cost. High-footprint MCP servers are measurably more expensive.
- The **~40% output reservation** (community-reported) means only ~60% of the nominal model context window is available for input (tool defs + user prompt + code context).
- **No separate max_connected_servers cap**: users can connect many MCP servers but total active tools across all servers must stay ≤ 128 at request time.

**Virtual tools threshold setting:** `github.copilot.chat.virtualTools.threshold` (integer). When an MCP server registers more tools than this threshold, VS Code defers them behind activate_* stub virtual tools. Setting this value above 128 has no practical effect since the API cap remains 128.

**Embedding-guided tool routing (Nov 2025 rollout):** Achieves 94.5% Tool Use Coverage vs. 69% for static tool lists. Reduces average response latency by ~400ms by pre-selecting semantically relevant tool groups before model requests.

---

### Cross-surface comparison

| Limit | M365 Copilot | Consumer Copilot | GitHub Copilot |
|---|---|---|---|
| MCP support | Yes (declarative agent plugins) | No | Yes (VS Code native) |
| Max MCP servers / actions | **10** (manifest hard limit) | N/A | No cap (128-tool request limit is binding) |
| Max tools per request | null (product-level) | N/A | **128** (VS Code client hard cap) |
| Plugin/tool context budget | **4,096 tokens** (I/O) | N/A | Selected model window (~60% usable) |
| Plugin response limit | **25 items** | N/A | null (model window) |
| Parallel tool calls | Sequential only | N/A | null (likely sequential) |
| Tool search / deferral | Semantic matching (>5 plugins) | N/A | Virtual tools (embedding clustering) |
| Practical tool count | **10 functions/plugin** | N/A | **13** core (GitHub recommendation) |
| Turn timeout | 45 seconds | N/A | null |
| Layer of limits | Product | N/A | Client (VS Code) |

# Citations

None.
