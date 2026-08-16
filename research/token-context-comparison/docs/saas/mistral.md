# Mistral AI — SaaS Provider Profile

> **As of:** 2026-06-21 | **Group:** SaaS (La Plateforme / Studio hosted API)
> **API docs:** https://docs.mistral.ai/ | **Pricing:** https://mistral.ai/pricing

---

## Provider Summary

Mistral AI offers a hosted API ("La Plateforme" / Studio) with three tiers of current generalist models: a small, cost-optimised hybrid reasoning model; a large frontier model; and a frontier multimodal model optimised for agentic/coding work. All three share a 256k-token context window.

**MCP posture:** Native MCP support via **Connectors** (beta, 2026). Any MCP-compatible server can be registered as a Connector by URL; the platform manages transport server-side. Tools are exposed to the model and discovered on demand — no local MCP transport needed. This is meaningfully different from "function calling with an MCP adapter": the API natively speaks MCP.

**Tokenizer:** Mistral's open-source **Tekken** tokenizer (V3, tiktoken-based BPE). Available via `pip install mistral-common` (Apache-2.0). Exact counts reproducible locally — the best story of any closed-API provider after OpenAI's tiktoken.

**Skills analog:** The **Agents API** lets developers pre-configure a model with a system prompt, tools, and completion params, then reference it by `agent_id` in Conversations. The **Conversations API** stores turn history server-side by default. This is Mistral's "skills" concept.

**No prompt caching** documented as of 2026-06-21. **Batch API** available with 50% discount.

---

## Model Index

| Model | API string | Released | Context | Input $/1M | Output $/1M |
|---|---|---|---|---|---|
| Mistral Medium 3.5 | `mistral-medium-3-5` / `mistral-medium-latest` | 2026-04-28 | 256k | $1.50 | $7.50 |
| Mistral Small 4 | `mistral-small-2603` / `mistral-small-latest` | 2026-03-16 | 256k | $0.15 | $0.60 |
| Mistral Large 3 | `mistral-large-2512` / `mistral-large-latest` | 2025-12-02 | 256k | $0.50 | $1.50 |

---

## Per-Model Profiles

### Mistral Medium 3.5 (`mistral-medium-3-5`)

Released 2026-04-28. Frontier-class multimodal model optimised for agentic and coding tasks. Also available as open weights (Modified MIT). 

**Axis 1 & 2 — Context**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 256,000 tokens | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) |
| Input + output shared pool | Yes | High | Known Limitations |
| Max input (separate cap) | Not published | Low | — |
| Max output default | Not published; query /models | Low | [API docs](https://docs.mistral.ai/api) |
| Max output max | Bounded by 256k window minus input | Low | API docs |
| Extended/beta context | None documented | High | Known Limitations |
| Reasoning tokens as output | N/A (not a reasoning model) | Low | — |

**Axis 3 — Tokenization**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | Tekken (V3-Tekken, tiktoken BPE) | High | [Tokenization deep dive](https://docs.mistral.ai/resources/cookbooks/concept-deep-dive-tokenization-readme) |
| Tokenizer public | Yes (Apache-2.0) | High | [mistral-common](https://github.com/mistralai/mistral-common) |
| Access method | `pip install mistral-common` + HF Hub | High | GitHub |
| Count method | `MistralTokenizer.v3().encode(text)` | High | GitHub |
| Image token rule | Not published | Low | — |
| Audio token rule | Not published | Low | — |
| ~chars/token (rough) | ~4 | Low | Industry estimate |

**Axis 5 — Tools / MCP**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | Yes | High | [Model card](https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04) |
| Native MCP | Yes (Connectors, beta) | High | [Connectors](https://docs.mistral.ai/capabilities/connectors) |
| Parallel tool calls | Yes | High | [Function calling](https://docs.mistral.ai/capabilities/function_calling) |
| Max tools — hard | 128 | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) |
| Max tools — practical | ~40 (community estimate) | Low | Tier-4 practitioner reports |
| Tool definition shape | `openai_function` | High | Function calling docs |
| Tool defs count as input | Yes | High | Known Limitations |
| Tool search / deferral | No | Medium | Not documented |
| Max tool name length | Not published | Low | — |

**Axis 6 — Skills / Context**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Skills supported | Yes (Agents API) | High | [Agents docs](https://docs.mistral.ai/studio-api/agents/agents-api) |
| Loading model | always_on | High | Agents docs |
| Skills context cost | System prompt + tool defs injected as input tokens at conversation start | — | — |
| Prompt caching | No | Medium | Not documented |
| Memory feature | Yes (Conversations API, server-side) | High | Agents docs |

**Axis 4 & 7 — Cost**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input | $1.50 / 1M tokens | High | [Model card](https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04) |
| Output | $7.50 / 1M tokens | High | Model card |
| Cached input | N/A (no caching) | High | — |
| Batch discount | 50% off | High | [Batch docs](https://docs.mistral.ai/studio-api/batch-processing) |
| Billing unit | tokens | High | Model card |

---

### Mistral Small 4 (`mistral-small-2603`)

Released 2026-03-16. Hybrid MoE model: 119B total params / 6.5B active. Unifies instruct, reasoning, and coding. Excellent cost/perf ratio.

**Axis 1 & 2 — Context**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 256,000 tokens | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) |
| Input + output shared pool | Yes | High | Known Limitations |
| Max input (separate cap) | Not published | Low | — |
| Max output default | Not published; query /models | Low | API docs |
| Max output max | Bounded by 256k window | Low | API docs |
| Extended/beta context | None documented | High | Known Limitations |
| Reasoning tokens as output | Not documented (hybrid model) | Low | — |

**Axis 3 — Tokenization**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | Tekken (V3-Tekken, tiktoken BPE) | High | Tokenization deep dive |
| Tokenizer public | Yes (Apache-2.0) | High | mistral-common |
| Access method | `pip install mistral-common` + HF Hub | High | GitHub |
| Count method | `MistralTokenizer.v3().encode(text)` | High | GitHub |
| Image token rule | Not published | Low | — |
| Audio token rule | Not published | Low | — |
| ~chars/token (rough) | ~4 | Low | Industry estimate |

**Axis 5 — Tools / MCP**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | Yes | High | Model card |
| Native MCP | Yes (Connectors, beta) | High | Connectors docs |
| Parallel tool calls | Yes | High | Function calling docs |
| Max tools — hard | 128 | High | Known Limitations |
| Max tools — practical | ~40 (community estimate) | Low | Tier-4 |
| Tool definition shape | `openai_function` | High | Function calling docs |
| Tool defs count as input | Yes | High | Known Limitations |
| Tool search / deferral | No | Medium | Not documented |

**Axis 6 — Skills / Context**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Skills supported | Yes (Agents API) | High | Agents docs |
| Loading model | always_on | High | Agents docs |
| Prompt caching | No | Medium | Not documented |
| Memory feature | Yes (Conversations API) | High | Agents docs |

**Axis 4 & 7 — Cost**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input | $0.15 / 1M tokens | High | [Model card](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03) |
| Output | $0.60 / 1M tokens | High | Model card |
| Cached input | N/A | High | — |
| Batch discount | 50% off | High | Batch docs |
| Billing unit | tokens | High | Model card |

---

### Mistral Large 3 (`mistral-large-2512`)

Released 2025-12-02. 675B-param granular MoE (41B active). General-purpose frontier multimodal model. Canonical example in function calling docs (`mistral-large-latest`).

**Axis 1 & 2 — Context**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 256,000 tokens | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) |
| Input + output shared pool | Yes | High | Known Limitations |
| Max input (separate cap) | Not published | Low | — |
| Max output default | Not published; query /models | Low | API docs |
| Max output max | Bounded by 256k window | Low | API docs |
| Extended/beta context | None documented | High | Known Limitations |
| Reasoning tokens as output | N/A | Low | — |

**Axis 3 — Tokenization**

Same Tekken V3 tokenizer as all current Mistral models. See Medium 3.5 table.

**Axis 5 — Tools / MCP**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | Yes | High | Function calling docs (canonical example) |
| Native MCP | Yes (Connectors, beta) | High | Connectors docs |
| Parallel tool calls | Yes | High | Function calling docs |
| Max tools — hard | 128 | High | Known Limitations |
| Max tools — practical | ~40 (community estimate) | Low | Tier-4 |
| Tool definition shape | `openai_function` | High | Function calling docs |
| Tool defs count as input | Yes | High | Known Limitations |
| Tool search / deferral | No | Medium | Not documented |

**Axis 6 — Skills / Context**

Same Agents / Conversations model as above.

**Axis 4 & 7 — Cost**

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input | $0.50 / 1M tokens | High | [Model card](https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12) |
| Output | $1.50 / 1M tokens | High | Model card |
| Cached input | N/A | High | — |
| Batch discount | 50% off | High | Batch docs |
| Billing unit | tokens | High | Model card |

---

## Takeaways for the Recommender

### When to pick Mistral

- **Mistral Small 4** is the best pure cost/performance pick among all current SaaS providers at $0.15/$0.60 per 1M tokens. For MCP footprint work where tool definitions are a significant fraction of input spend, this is the lowest-cost option that still has a 256k window and native MCP.
- **Mistral Large 3** sits at $0.50/$1.50 — a middle ground. It is the proven general-purpose frontier model and the canonical example in Mistral's own function calling docs.
- **Mistral Medium 3.5** is the highest-capability option ($1.50/$7.50) — appropriate for agentic and coding tasks where output quality justifies the premium.

### Footprint headroom

All three models share a uniform **256k context window with no separately published input or output cap**. The practical rule is: input + output ≤ 256k tokens. For MCP footprint analysis:
- 256k ÷ 55k (large MCP server) = 4.6× headroom — comfortable for most servers.
- 256k ÷ 128k (max tools × avg tool def) = ~2× headroom at the hard 128-tool limit.
- No prompt caching means every request pays full input price for tool definitions. This makes batch processing (50% discount) the primary cost mitigation lever.

### Tool-use profile

- **Hard limit 128 tools** (Tier-1 documented). This matches OpenAI's cap and is the highest explicitly published cap in the SaaS group.
- **Tool shape = `openai_function`**: Mistral uses OpenAI-style `{type: "function", function: {...}}` JSON. The existing `toOpenAIStyleTool` adapter is directly applicable.
- **Native MCP via Connectors (beta)**: This is the most operationally convenient MCP story among current providers. You register an MCP server URL once; the platform handles transport and tool discovery. No client-side MCP plumbing needed. Beta status means the interface may change.
- **No tool search / deferral**: All registered tools are loaded into context. With 128 tools × ~300 tokens/def ≈ 38,400 tokens of tool overhead at the hard limit — about 15% of the 256k window.
- **Parallel tool calls enabled by default**: efficient for multi-step agentic sessions.

### Cost profile

- No prompt caching = no discount on repeated tool definitions across sessions.
- Batch API (50% off) is the primary cost lever — ideal for offline analysis, not interactive sessions.
- Output is 4-5× input price for Medium 3.5; 3× for Large 3; 4× for Small 4.
- Session cost for tool-heavy agentic work: budget ~$0.15-1.50/1M input tokens for tool defs, $0.60-7.50/1M for model outputs.

### Known null / low-confidence fields

- `max_output_tokens_default` and `max_output_tokens_max`: not published per model. Query the `/models` endpoint for the authoritative per-model values.
- `knowledge_cutoff`: not published for any of the three models.
- Image and audio token billing rules: not documented.
- `max_tools_practical`: community estimate only; no Mistral-specific empirical study found.
- Reasoning token billing for Mistral Small 4 (hybrid model): not explicitly documented.
- Prompt caching: confirmed absent as of 2026-06-21, but watch changelogs.

---

## Sources

- [Mistral Models Overview](https://docs.mistral.ai/models/overview)
- [Mistral Medium 3.5 model card](https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04)
- [Mistral Small 4 model card](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03)
- [Mistral Large 3 model card](https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12)
- [Known Limitations](https://docs.mistral.ai/resources/known-limitations) — context windows and max tools
- [Function Calling docs](https://docs.mistral.ai/capabilities/function_calling) — tool shape, parallel calls
- [Connectors (MCP)](https://docs.mistral.ai/capabilities/connectors) — native MCP support
- [Connectors Management](https://docs.mistral.ai/capabilities/connectors/management) — Connector lifecycle
- [Agents & Conversations API](https://docs.mistral.ai/studio-api/agents/agents-api) — skills/agents
- [Batch Processing](https://docs.mistral.ai/studio-api/batch-processing) — 50% batch discount
- [Tokenization deep dive](https://docs.mistral.ai/resources/cookbooks/concept-deep-dive-tokenization-readme) — Tekken tokenizer
- [mistral-common GitHub](https://github.com/mistralai/mistral-common) — open-source tokenizer
- [mistral.ai pricing](https://mistral.ai/pricing) — pricing page
- [Mistral Medium 3.5 announcement](https://mistral.ai/news/vibe-remote-agents-mistral-medium-3-5)
- [Mistral Large 3 announcement](https://mistral.ai/news/mistral-3)

---

## MCP / tool limits

> **As of:** 2026-06-21. All three models share identical API-layer limits (platform-level caps, not model-specific). Sources: [Known Limitations](https://docs.mistral.ai/resources/known-limitations), [Connectors Management](https://docs.mistral.ai/capabilities/connectors/management), [API reference](https://docs.mistral.ai/api/endpoint/chat).

| Limit | Value | Confidence | Source | Notes |
|---|---|---|---|---|
| `max_tools_hard` | **128** | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) | "Maximum number of tools per request: 128." Applies to all three models. |
| `max_tools_practical` | ~40 | Low | Tier-4 (community) | No Mistral-specific empirical study. General practitioner consensus ~30–50 tools before accuracy degradation. |
| `max_tool_name_len` | Not published | Low | — | No character cap on function/tool names in API spec. Connector *registry* names have a 64-char cap (alphanumeric+underscore+dash) but that applies to the server-registration name, not the tool function name itself. |
| `max_tool_description_len` | Not published | Low | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) | No hard char/token limit. Descriptions count against the 256k token budget (documented). |
| `max_request_size` | Not published | Low | — | No byte/MB cap for POST /v1/chat/completions. File upload endpoint has 512 MB cap (separate endpoint). Effective ceiling is the 256k token window. |
| `max_tool_result_size` | Not published | Low | — | No per-result size cap. Tool results (role: "tool" messages) count against the shared 256k context window. |
| `max_parallel_tool_calls_count` | Not published (boolean flag) | Low | [API reference](https://docs.mistral.ai/api/endpoint/chat) | `parallel_tool_calls` is a boolean (default: true). No numeric cap documented. Known Limitations: "may return calls in any order." |
| `tool_use_per_turn_limit` | Not published | Low | — | No documented loop cap per turn or per agentic session. Docs show example loop with no stated bound. |
| `max_connected_servers` | Not published | Low | [Connectors Management](https://docs.mistral.ai/capabilities/connectors/management) | No cap on registered Connectors (MCP servers) per workspace or per conversation. Connector list uses cursor pagination, implying potentially large counts. |
| `max_total_tools` | Not published separately | Low | — | No aggregate-across-connectors cap distinct from `max_tools_hard` (128). All connector tools count toward that limit. |
| Connector name pattern | 64 chars, `[a-zA-Z0-9_-]+` | High | [Connectors Management](https://docs.mistral.ai/capabilities/connectors/management) | This is the Connector (MCP server) *registry* name, not the individual tool function name. Unique within a Workspace. |
| Tool definition shape | `openai_function` | High | [Function Calling](https://docs.mistral.ai/capabilities/function_calling) | `{type: "function", function: {name, description, parameters}}` — OpenAI-compatible JSON. |
| Tool defs count as input | Yes | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) | "Tool descriptions are included in the token count." |
| Connectors status | **Beta** | High | [Connectors](https://docs.mistral.ai/capabilities/connectors) | Interface may change. Transport managed server-side; no local MCP plumbing needed. |
| Rate limits | Per API key; RPM + TPM enforced | High | [Known Limitations](https://docs.mistral.ai/resources/known-limitations) | Returns 429 on breach. Check `X-RateLimit-Remaining` header. Batch API exempt from real-time limits. |
| Prompt caching | `prompt_cache_key` param available | Medium | [API reference](https://docs.mistral.ai/api/endpoint/chat) | Cached tokens billed at 10% of input price per API spec. Was not prominently documented at time of initial `prompt_caching: false` capture — verify on current pricing page. |
