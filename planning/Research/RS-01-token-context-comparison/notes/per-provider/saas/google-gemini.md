---
type: "Research Note"
title: "Google Gemini \u2014 Token & Context Comparison"
description: "Provider: Google (Gemini Developer API)"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Google Gemini — Token & Context Comparison

**Provider:** Google (Gemini Developer API)
**Group:** SaaS
**As of:** 2026-06-21
**API docs:** https://ai.google.dev/gemini-api/docs
**Source data:** `data/saas/google-gemini.json`

---

## Provider Summary

Google's Gemini Developer API provides three active GA text-generation models as of June 2026: **Gemini 3.5 Flash** (flagship for agentic/coding workloads), **Gemini 3.1 Flash-Lite** (cheapest stable model, high-volume tasks), and **Gemini 2.5 Pro** (deep reasoning/STEM). All three share a 1,048,576-token (1M) context window as the standard GA offering.

**MCP posture:** The `google-genai` Python and JavaScript SDKs include experimental MCP client support that connects to MCP servers, calls `list_tools`, and exposes function declarations to the model. Only tool calling is supported — resources and prompts are not yet exposed. The Deep Research API feature also supports MCP in preview. Marked medium-confidence because this is labeled experimental in the SDK.

**Tokenizer:** Proprietary Gemini tokenizer (closed, not publicly released). Exact counts require the `countTokens` API endpoint. Rule of thumb: ~4 characters per token; 100 tokens ~ 60-80 English words. Billing is per token (not per character — Gemini transitioned from early per-character billing when it launched commercial pricing in 2024).

**Skills/Gems:** No first-class "skills" programming concept in the Developer API. Gems (Google AI Studio) let users configure persistent system instructions in the consumer product but are not exposed as a programmatic API construct. System instructions are passed via `system_instruction` and billed as input tokens per request.

---

## Models

### 1. Gemini 3.5 Flash (`gemini-3.5-flash`)

**Status:** GA (Stable) | **Released:** May 2026 | **Knowledge cutoff:** January 2025

#### Context (Axis 1 & 2)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 1,048,576 tokens | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) |
| Input/output shared pool | Yes | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Max input tokens | 1,048,576 | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) |
| Max output tokens (max) | 65,536 | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) |
| Max output tokens (default) | Not documented separately | low | — |
| Extended context | None beyond 1M | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) |
| Reasoning tokens count as output | Yes | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |

#### Tokenization (Axis 3)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | Gemini (proprietary) | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Tokenizer public | No | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Tokenizer access | `countTokens` API | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Count method | `client.models.count_tokens(model='gemini-3.5-flash', contents=...)` | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Chars/token estimate | ~4 | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Image token rule | <=384px both dims = 258 tokens; larger → 768×768 tiles @ 258 tokens each | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Audio token rule | 32 tokens/second | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Video token rule | 263 tokens/second | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |

#### Tools / MCP (Axis 5)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | Yes | high | [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| Native MCP | Yes (experimental SDK) | medium | [python-genai](https://github.com/googleapis/python-genai) |
| Parallel tool calls | Yes | high | [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| Max tools (hard limit) | None documented | medium | [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| Max tools (practical) | Not documented | low | — |
| Tool definition shape | `gemini_declaration` (functionDeclarations[]) | high | [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| Tool defs count as input | Yes | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Tool search/deferral | No | medium | — |
| Max tool name length | Not documented | low | — |

#### Skills / Context (Axis 6)

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Skills supported | No (no API-level skills) | medium | Gems exist in AI Studio consumer product only |
| Skills loading model | n/a | medium | — |
| Prompt caching | Yes | high | Cached read: $0.15/1M; storage: $1.00/1M tokens/hr |
| Memory feature | None documented | low | — |

#### Cost (Axis 7)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input (standard, text/image/video) | $1.50 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Input (audio) | $1.00 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Output (incl. thinking) | $9.00 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Cached input read | $0.15 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Batch discount | 50% off (input $0.75, output $4.50 / 1M) | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Billing unit | tokens | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Reasoning billed as output | Yes | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Long-context price tier | None (flat rate) | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |

---

### 2. Gemini 3.1 Flash-Lite (`gemini-3.1-flash-lite`)

**Status:** GA (Stable) | **Released:** May 2026 | **Knowledge cutoff:** January 2025

#### Context (Axis 1 & 2)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 1,048,576 tokens | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) |
| Input/output shared pool | Yes | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Max input tokens | 1,048,576 | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) |
| Max output tokens (max) | 65,536 | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) |
| Extended context | None beyond 1M | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) |
| Reasoning tokens count as output | Yes | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |

#### Tokenization (Axis 3)

Same tokenizer family and rules as Gemini 3.5 Flash — see above. `countTokens` API endpoint available for `gemini-3.1-flash-lite`.

#### Tools / MCP (Axis 5)

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | Yes | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) |
| Native MCP | Yes (experimental SDK) | medium | Same as 3.5 Flash |
| Parallel tool calls | Yes | high | [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| Max tools (hard limit) | None documented | medium | — |
| Max tools (practical) | Not documented | low | Lite model; accuracy may degrade at fewer tools than Pro-class |
| Tool definition shape | `gemini_declaration` | high | [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| Tool defs count as input | Yes | high | — |
| Tool search/deferral | No | medium | — |

#### Skills / Context (Axis 6)

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | medium |
| Prompt caching | Yes | high |
| Memory feature | None documented | low |

Cached read: $0.025/1M (text/image/video), $0.05/1M (audio). Cache storage: $1.00/1M tokens/hr.

#### Cost (Axis 7)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input (text/image/video) | $0.25 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Input (audio) | $0.50 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Output (incl. thinking) | $1.50 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Cached input read | $0.025 / 1M (text/image/video) | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Batch discount | 50% off (input $0.125, output $0.75 / 1M) | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Billing unit | tokens | high | — |
| Reasoning billed as output | Yes | high | — |
| Long-context price tier | None (flat rate) | high | — |

---

### 3. Gemini 2.5 Pro (`gemini-2.5-pro`)

**Status:** GA (Stable) | **Released:** June 2025 | **Knowledge cutoff:** January 2025

#### Context (Axis 1 & 2)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 1,048,576 tokens | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) |
| Input/output shared pool | Yes | high | [Token docs](https://ai.google.dev/gemini-api/docs/tokens) |
| Max input tokens | 1,048,576 | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) |
| Max output tokens (max) | 65,536 | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) |
| Extended context | None beyond 1M | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) |
| Reasoning tokens count as output | Yes | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |

#### Tokenization (Axis 3)

Same tokenizer family and rules as other Gemini models — `countTokens` API, ~4 chars/token, 258 tokens/image tile, 32 tokens/sec audio, 263 tokens/sec video.

#### Tools / MCP (Axis 5)

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | Yes | high | [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) |
| Native MCP | Yes (experimental SDK) | medium | Same as 3.5 Flash |
| Parallel tool calls | Yes | high | — |
| Max tools (hard limit) | None documented | medium | — |
| Max tools (practical) | Not documented | low | 1M window gives significant headroom |
| Tool definition shape | `gemini_declaration` | high | — |
| Tool defs count as input | Yes | high | — |
| Tool search/deferral | No | medium | — |
| Long-context pricing note | Tool defs + system prompt crossing 200K triggers 2x input price | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |

#### Skills / Context (Axis 6)

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | medium |
| Prompt caching | Yes | high |
| Memory feature | None documented | low |

Cached reads: $0.125/1M (<=200K prompts), $0.25/1M (>200K). Cache storage: $4.50/1M tokens/hr (3.6x more expensive than Flash models).

#### Cost (Axis 7)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input (<=200K tokens) | $1.25 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Input (>200K tokens) | $2.50 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Output (incl. thinking, <=200K) | $10.00 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Output (incl. thinking, >200K) | $15.00 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Cached input read (<=200K) | $0.125 / 1M tokens | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Batch discount | 50% off (input $0.625/1M <=200K, $1.25/1M >200K) | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Billing unit | tokens | high | — |
| Reasoning billed as output | Yes | high | — |
| Long-context price tier | 200K token threshold; doubles input price above | high | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |

---

## Takeaways for the Recommender

### When to recommend Gemini

1. **Largest context window for MCP-heavy sessions.** All three GA models have 1M token windows — the largest of any SaaS provider roster. Even a server with 55K tokens of tool definitions consumes only ~5.2% of the window, leaving massive headroom for tool call outputs and multi-turn history.

2. **Tool footprint measurement requires the countTokens API.** The tokenizer is closed; callers must round-trip to `countTokens` with the full request (system instruction + tool declarations + history) to get exact token counts. The ~4 chars/token heuristic provides a usable fallback for the `raw_json_rough` profile.

3. **Gemini 3.5 Flash is the value choice for agentic sessions.** At $1.50/$9.00 per 1M in/out, it is designed for sub-agent deployment and multi-step workflows. No long-context price penalty, and thinking tokens are supported.

4. **Gemini 3.1 Flash-Lite is the cost-floor model.** At $0.25/$1.50 per 1M, it is the cheapest option. 1M context window means even heavy tool loads do not cause context exhaustion. Best for high-volume, lightweight agentic tasks (routing, classification, extraction).

5. **Gemini 2.5 Pro has a 200K long-context price cliff.** When the total prompt (system instruction + tool definitions + conversation history) exceeds 200K tokens, input price doubles to $2.50/1M and output price rises from $10 to $15/1M. For MCP sessions with many tool definitions, this cliff is a real budget risk. Context caching is highly recommended to keep the effective prompt size below 200K in repeated sessions, but cache storage is also 4.5x more expensive than Flash models ($4.50 vs $1.00/1M tokens/hr).

6. **No hard tool count limit documented.** Google has not published an API-enforced cap on `functionDeclarations`. The effective limit is the 1M context window. Tool accuracy degradation at high tool counts has not been benchmarked publicly for Gemini.

7. **Native MCP is experimental but present.** The `google-genai` SDK supports connecting directly to MCP servers (Python and JS). Only tool calling is exposed — resources and prompts are not. For production use, converting MCP tool definitions to `functionDeclarations` and passing them directly is more stable.

8. **Prompt caching is the key cost mitigation for tool-heavy sessions.** System instructions and tool definitions can be cached. Flash/Flash-Lite cache storage is $1.00/1M tokens/hr; minimum TTL is 5 minutes. For sessions where the same MCP server's tool definitions are re-used, caching pays off quickly at scale.

### Low-confidence fields to revisit
- `max_tools_practical`: No Gemini-specific empirical benchmark found. General 30-50 tool limit from Berkeley FCL work (non-Gemini) is the only proxy.
- `max_tool_name_len`: Not documented.
- `max_output_tokens_default`: Google does not distinguish a default vs. max output cap; the single documented limit is 65,536.
- MCP SDK support confidence is medium — marked experimental by Google; behavior may change.

---

## MCP / tool limits

> Researched 2026-06-21. All three GA models share the same API-layer proto constraints (limits are enforced at the serving layer, not per-model-family).

| Limit | Value | Confidence | Source / notes |
|---|---|---|---|
| **max_tools_hard** (functionDeclarations per request) | **512** | high | Live API error: HTTP 400 `INVALID_ARGUMENT` "At most 512 function declarations can be specified." Confirmed via Gemini CLI issue #19083 (Feb 2026). Not yet stated on the official function-calling doc page but enforced as a proto validation. |
| **max_tools_practical** (accuracy degrades) | Not published | low | Official best-practices page recommends keeping active tool set to **10–20 tools** for accuracy. No Gemini-specific empirical benchmark. General FCL-work guidance (30–50) is the best proxy. |
| **max_total_tools** (aggregate across all servers) | 512 | high | Same as max_tools_hard — the cap applies across all `Tool.functionDeclarations[]` in a single request, i.e. the sum of all tools from all connected MCP servers. |
| **max_tool_name_len** | Not documented | low | No official character limit. Best practices: "use descriptive names without spaces, periods, or dashes" (use underscores or camelCase). No max length published — unlike OpenAI's documented 64-char cap. |
| **max_tool_description_len** | Not documented | low | No official character or token limit. Descriptions count toward input tokens (1M window is the effective ceiling). Best practice: be clear and provide examples; no hard length limit. |
| **max_request_size** (inline data payload) | **100 MB** | high | Official file-input-methods doc (updated 2026-05-18): inline data max 100 MB per request; PDFs limited to 50 MB. External URLs: 100 MB. Files API: up to 2 GB per file. For text+tool payloads the 1M token window is the binding ceiling long before 100 MB is reached. |
| **max_tool_result_size** | Not documented | low | No per-`functionResponse` size cap published in bytes or tokens. Gemini 3 supports multimodal content in function responses (PNG/JPEG/WEBP images, PDF, text/plain inline). All tool results count toward the shared 1M token window. |
| **max_parallel_tool_calls_count** | Not documented (unbounded) | medium | Parallel function calling fully supported — model can emit multiple function calls in one turn. No published numeric limit. Results returned out of order and matched by the unique `id` field (Gemini 3 always returns a unique id per call). |
| **tool_use_per_turn_limit** | Not documented | low | No published hard cap on sequential tool-call/result cycles within a session. Compositional (sequential) calling supported natively in Gemini 3 and via the Python SDK automatic function calling loop. No "reached tool-use limit" error analogous to Claude's documented per-turn cap. |
| **max_connected_servers** (SDK MCP) | Not documented | low | No limit on MCP server connections in the experimental google-genai SDK client. The 512 total functionDeclarations is the practical binding constraint across all servers. |

### Schema constraints (tool_schema_limits_notes)

Parameters use an **OpenAPI subset** only. Supported keywords (Gemini 2.5+ and Gemini 3 series, as of Nov 2025 schema update):

- **Supported:** `type`, `nullable`, `required`, `format`, `description`, `properties`, `items`, `enum`, `anyOf`, `$ref`, `minItems`, `maxItems`, `minimum`, `maximum`
- **NOT supported in pre-2.5 models:** `anyOf`, `oneOf`, `$ref`, `default`, `optional`
- **ANY mode caveat:** The API may reject very large or deeply nested schemas when using `ANY` function-calling mode. Official mitigation: shorten property names, reduce nesting depth, or reduce function declarations count.
- **No documented hard nesting depth or property count.** One community report mentions a depth-32 limit but this is not confirmed in official docs.
- Source: [Function calling — Notes and limitations](https://ai.google.dev/gemini-api/docs/function-calling), [API schema reference](https://ai.google.dev/api/caching#FunctionDeclaration)

### Other limits / rate limits

| Aspect | Gemini 3.5 Flash | Gemini 3.1 Flash-Lite | Gemini 2.5 Pro |
|---|---|---|---|
| RPM (paid tier) | 2,000 | 4,000 | 1,000 |
| TPM (paid tier) | 4M | 4M | 2M |
| Long-context pricing cliff | None | None | >200K tokens: input 2×, output 1.5× |
| Cache storage cost | $1.00/1M tokens/hr | $1.00/1M tokens/hr | $4.50/1M tokens/hr |
| Source | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) |

**Key implications for the recommender:**
- The **512 functionDeclarations hard cap** is the first practical ceiling for MCP-heavy sessions (not the 1M token window). A large MCP ecosystem with 20+ servers can easily exceed 512 tools total.
- Gemini 2.5 Pro has a **200K token pricing cliff** — large tool definition blocks (e.g., 200 tools × ~250 tokens each = 50K tokens) combined with system instructions and history can cross this threshold, doubling input cost.
- **Context caching** is the primary cost mitigation: cache static tool declarations once, pay $1.00/1M/hr (Flash) or $4.50/1M/hr (Pro).
- The 512 cap should be surfaced as a `max_tools_hard` constraint in the recommender; any MCP server set totalling >512 functions will fail immediately with HTTP 400.

---

## Sources

- [Gemini API — All Models](https://ai.google.dev/gemini-api/docs/models) — Tier 1
- [Gemini 3.5 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) — Tier 1
- [Gemini 3.1 Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) — Tier 1
- [Gemini 2.5 Pro model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) — Tier 1
- [Gemini 3.1 Pro Preview model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) — Tier 1 (preview, not selected as 3rd GA model)
- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing) — Tier 1
- [Understand and Count Tokens](https://ai.google.dev/gemini-api/docs/tokens) — Tier 1
- [Function Calling Guide](https://ai.google.dev/gemini-api/docs/function-calling) — Tier 1
- [Context Caching](https://ai.google.dev/gemini-api/docs/caching) — Tier 1
- [google-genai Python SDK (GitHub)](https://github.com/googleapis/python-genai) — Tier 1 (MCP experimental support)
- [Gemini SDK — FastMCP Integration](https://gofastmcp.com/integrations/gemini) — Tier 3
- [Google Gemini Deep Research MCP Updates 2026](https://blockchain.news/ainews/google-gemini-api-deep-research-updates-mcp-support-native-charts-and-max-mode-quality-boost-2026-analysis) — Tier 3

# Citations

None.
