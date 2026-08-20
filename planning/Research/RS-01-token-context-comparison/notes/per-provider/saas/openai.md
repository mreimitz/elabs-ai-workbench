---
type: "Research Note"
title: "OpenAI (GPT) \u2014 Token Context Comparison"
description: "As-of: 2026-06-21 | Group: SaaS | Research subagent: openai"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# OpenAI (GPT) — Token Context Comparison

> **As-of:** 2026-06-21 | **Group:** SaaS | **Research subagent:** openai  
> All numbers sourced from Tier-1 docs unless noted. Verify on updates.

---

## Provider Summary

OpenAI's current API flagship is the **GPT-5.x family** (GPT-5.5 / GPT-5.4 / GPT-5.4 mini / GPT-5.4 nano). The platform offers first-class MCP support via the **Responses API**, which accepts remote MCP servers as a native tool type. All three selected models support function calling, native MCP, parallel tool calls, prompt caching (automatic, no opt-in), and a **Skills** mechanism for packaging reusable instruction bundles into hosted environments.

**Tokenizer:** `o200k_base` (BPE) via `tiktoken`, open-source and reproducible locally — the most tool-friendly tokenizer situation of any major provider.

**Tool hard cap:** 128 tools per request (API-enforced). **Tool search deferral** (`tool_search`) is available on GPT-5.5, GPT-5.4, and GPT-5.4 mini — allows deferred lazy loading of large tool surfaces, a key mitigation for MCP-heavy sessions. GPT-5.4 nano does NOT support tool search.

---

## Models

### 1. GPT-5.5 (`gpt-5.5`)

**Newest frontier model. GA 2026-04-24. Snapshot: `gpt-5.5-2026-04-23`.**

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 1,050,000 tokens | high | [model page](https://developers.openai.com/api/docs/models/gpt-5.5) |
| Input + output shared | yes | high | model page |
| Max input (derived) | ~922,000 tokens | medium | derived: 1,050,000 − 128,000 |
| Max output (max) | 128,000 tokens | high | model page |
| Max output (default) | not documented separately | low | — |
| Extended context | none beyond 1,050,000 | high | model page |
| Reasoning tokens count as output | yes | high | model page |

> Note: Prompts >272K input tokens trigger a surcharge: 2× input + 1.5× output for the full session.

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | `o200k_base` | high | [tiktoken #464](https://github.com/openai/tiktoken/issues/464) |
| Tokenizer public | yes | high | [tiktoken](https://github.com/openai/tiktoken) |
| Tokenizer access | `tiktoken` (PyPI) | high | tiktoken |
| Count tokens method | `tiktoken.encoding_for_model('gpt-5.5')` or Responses API `include=['usage']` | high | [token-counting guide](https://developers.openai.com/api/docs/guides/token-counting) |
| Image token rule | Low-res: 85 tokens; High-res: 85 + 170/tile (512×512) | medium | [images guide](https://developers.openai.com/api/docs/guides/images-vision) |
| Audio token rule | n/a — audio not supported | high | model page |
| Chars/token estimate | ~4.0 (rough, English prose) | medium | tiktoken cookbook |

#### Tools / MCP

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | yes | high | model page |
| Native MCP | yes (Responses API) | high | model page |
| Parallel tool calls | yes | high | [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) |
| Max tools (hard) | 128 per request | high | [community / error report](https://github.com/code-yeongyu/oh-my-openagent/issues/2848) |
| Max tools (practical) | ~40 (Tier-4 empirical) | medium | community / Berkeley FCL |
| Tool definition shape | `openai_function` | high | function-calling guide |
| Tool defs count as input | yes | high | [token-counting guide](https://developers.openai.com/api/docs/guides/token-counting) |
| Tool search / deferral | yes | high | [tool-search guide](https://developers.openai.com/api/docs/guides/tools-tool-search) |
| Max tool name length | 64 chars | medium | function-calling guide |

#### Skills / Agentic Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Skills supported | yes | high | [skills guide](https://developers.openai.com/api/docs/guides/tools-skills) |
| Skills loading model | `tool_triggered` | high | skills guide |
| Prompt caching | yes — automatic, ≥1024 tokens | high | [caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Cache retention | Extended (24h default); in-memory NOT supported for gpt-5.5 | high | caching guide |
| Memory feature (API) | no | high | agents guide |

Skills context cost: Each skill's stub (name + description + path) is injected into the hidden system prompt as input tokens. Full skill instructions load on demand when the model triggers the skill. System prompt overhead is undocumented — measure via `Responses.create(include=['usage'], stream=False)`.

#### Cost

| Metric | Value | Confidence | Source |
|---|---|---|---|
| Input / 1M tokens | $5.00 | high | [pricing](https://openai.com/api/pricing/) |
| Output / 1M tokens | $30.00 | high | pricing |
| Cached input / 1M | $0.50 | high | pricing |
| Batch discount | 50% off input + output | high | pricing |
| Billing unit | tokens | high | pricing |
| Reasoning billed as output | yes | high | model page |

---

### 2. GPT-5.4 (`gpt-5.4`)

**Current default API flagship. GA ~2026-03-05. Snapshot: `gpt-5.4-2026-03-05`.**

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 1,050,000 tokens | high | [model page](https://developers.openai.com/api/docs/models/gpt-5.4) |
| Input + output shared | yes | high | model page |
| Max input (derived) | ~922,000 tokens | medium | derived |
| Max output (max) | 128,000 tokens | high | model page |
| Max output (default) | not documented separately | low | — |
| Extended context | none beyond 1,050,000 | high | model page |
| Reasoning tokens count as output | yes | high | model page |

> Same surcharge as gpt-5.5: >272K tokens → 2× input / 1.5× output for full session.

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | `o200k_base` | high | tiktoken #464 |
| Tokenizer public | yes | high | tiktoken |
| Tokenizer access | `tiktoken` | high | tiktoken |
| Count tokens method | `tiktoken.encoding_for_model('gpt-5.4')` or Responses API | high | token-counting guide |
| Image token rule | Low-res: 85; High-res: 85 + 170/tile | medium | images guide |
| Audio token rule | n/a | high | model page |
| Chars/token estimate | ~4.0 | medium | tiktoken cookbook |

#### Tools / MCP

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | yes | high | model page |
| Native MCP | yes | high | model page |
| Parallel tool calls | yes | high | function-calling guide |
| Max tools (hard) | 128 | high | community error report |
| Max tools (practical) | ~40 | medium | community / Berkeley FCL |
| Tool definition shape | `openai_function` | high | function-calling guide |
| Tool defs count as input | yes | high | token-counting guide |
| Tool search / deferral | yes | high | tool-search guide |
| Max tool name length | 64 chars | medium | function-calling guide |

#### Skills / Agentic Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Skills supported | yes | high | model page |
| Skills loading model | `tool_triggered` | high | skills guide |
| Prompt caching | yes — automatic, ≥1024 tokens | high | caching guide |
| Cache retention | Extended (up to 24h) | high | caching guide |
| Memory feature (API) | no | high | agents guide |

#### Cost

| Metric | Value | Confidence | Source |
|---|---|---|---|
| Input / 1M tokens | $2.50 | high | pricing |
| Output / 1M tokens | $15.00 | high | pricing |
| Cached input / 1M | $0.25 | high | pricing |
| Batch discount | 50% off | high | pricing |
| Reasoning billed as output | yes | high | model page |

---

### 3. GPT-5.4 mini (`gpt-5.4-mini`)

**High-volume / lower-cost mini model. GA ~2026-03-17. Snapshot: `gpt-5.4-mini-2026-03-17`.**

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 400,000 tokens | high | [model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| Input + output shared | yes | high | model page |
| Max input (derived) | ~272,000 tokens | medium | derived |
| Max output (max) | 128,000 tokens | high | model page |
| Max output (default) | not documented separately | low | — |
| Extended context | none beyond 400,000 | high | model page |
| Reasoning tokens count as output | yes | high | model page |

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | `o200k_base` | high | tiktoken #464 |
| Tokenizer public | yes | high | tiktoken |
| Tokenizer access | `tiktoken` | high | tiktoken |
| Count tokens method | `tiktoken.encoding_for_model('gpt-5.4-mini')` or Responses API | high | token-counting guide |
| Image token rule | Low-res: 85; High-res: 85 + 170/tile | medium | images guide |
| Audio token rule | n/a | high | model page |
| Chars/token estimate | ~4.0 | medium | tiktoken cookbook |

#### Tools / MCP

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | yes | high | model page |
| Native MCP | yes | high | model page |
| Parallel tool calls | yes | high | function-calling guide |
| Max tools (hard) | 128 | high | community error report |
| Max tools (practical) | ~40 | medium | community |
| Tool definition shape | `openai_function` | high | function-calling guide |
| Tool defs count as input | yes | high | token-counting guide |
| Tool search / deferral | yes | high | model page |
| Max tool name length | 64 chars | medium | function-calling guide |

#### Skills / Agentic Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Skills supported | yes | high | model page |
| Skills loading model | `tool_triggered` | high | skills guide |
| Prompt caching | yes — automatic, ≥1024 tokens | high | caching guide |
| Cache retention | Extended (up to 24h) | high | caching guide |
| Memory feature (API) | no | high | agents guide |

#### Cost

| Metric | Value | Confidence | Source |
|---|---|---|---|
| Input / 1M tokens | $0.75 | high | pricing |
| Output / 1M tokens | $4.50 | high | pricing |
| Cached input / 1M | $0.075 | high | pricing |
| Batch discount | 50% off | high | pricing |
| Reasoning billed as output | yes | high | model page |

---

## Takeaways for the Recommender

### When to pick OpenAI GPT-5.x

- **Best tokenizer ergonomics:** `o200k_base` via `tiktoken` is public, local, fast, and deterministic — the footprint tool can count tokens for any tool definition without an API call.
- **Largest context headroom (flagship):** Both gpt-5.5 and gpt-5.4 offer 1,050,000 tokens. A typical MCP server with 50 tools at ~300 tokens each (~15K tokens of tool definitions) is only ~1.4% of the window.
- **Native MCP:** First-class support via Responses API — tool definitions arrive as structured MCP tool objects, not raw JSON injection.
- **Tool search deferral:** The `tool_search` feature (gpt-5.5 / gpt-5.4 / gpt-5.4-mini) pairs well with large MCP servers: register 200+ tools, let the model fetch only what it needs. Key mitigation for the 128-tool hard cap.
- **Automatic prompt caching:** Tool definitions and system prompts in static prefix are cached automatically with up to 90% discount — critical for multi-turn MCP sessions where the same tool list is sent repeatedly.

### Footprint headroom

| Model | Window | 50-tool server (~15K toks) | % window |
|---|---|---|---|
| gpt-5.5 | 1,050,000 | ~15,000 | ~1.4% |
| gpt-5.4 | 1,050,000 | ~15,000 | ~1.4% |
| gpt-5.4-mini | 400,000 | ~15,000 | ~3.75% |

### Cost profile

- **gpt-5.5:** Premium frontier ($5/$30 per 1M). Reasoning at xhigh effort can generate many output tokens → cost amplification. Cached input only $0.50/1M.
- **gpt-5.4:** Best value flagship ($2.50/$15). Recommended for production agentic workloads.
- **gpt-5.4-mini:** Cheapest with tool search support ($0.75/$4.50). Ideal for classification, sub-agents, high-volume tool dispatch.
- **Batch API** saves 50% on both input and output for non-real-time pipelines.

### Watch-outs

- **128-tool hard cap:** API will error if >128 tools passed. Use tool_search for large MCP servers.
- **>272K surcharge:** Sessions with long context (many prior turns + large tool defs) hitting >272K input tokens are charged at 2× input rate — model the cumulative session cost.
- **Context window tiers:** gpt-5.4-mini/nano have 400K windows vs 1,050K for gpt-5.4/5.5. For MCP servers with many large tool definitions, prefer gpt-5.4 or gpt-5.5.
- **No audio on flagship text models:** gpt-5.5/5.4/5.4-mini do not accept audio input.
- **Memory is product-only:** The ChatGPT memory feature does not exist in the raw API — agents must implement memory via external storage.

---

## MCP / tool limits

> All three models share identical tool/MCP limits at the API layer. Limits sourced 2026-06-21.

| Limit | Value | Confidence | Source |
|---|---|---|---|
| `max_tools_hard` | **128** per request | high (Tier-1) | [Assistants deep-dive](https://platform.openai.com/docs/assistants/deep-dive) — "up to 128 tools" |
| `max_tool_name_len` | **64** chars; pattern `^[a-zA-Z0-9_-]+$` | high (Tier-1) | [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) |
| `max_tool_description_len` | **1024** characters | medium (Tier-3) | [community / API error reports](https://community.openai.com/t/tool-calling-api-upgrade-1024-char-limit-is-limiting/951951) |
| `max_request_size` | **null** — not published | low | No official docs; effective ceiling = context window tokens |
| `max_tool_result_size` | **~512 KB** (community-reported) | low (Tier-4) | [community report](https://community.openai.com/t/submit-tool-output-in-function-call-size-limit/744943) |
| `max_parallel_tool_calls_count` | **null** — no numeric cap | medium (Tier-1) | `parallel_tool_calls` is boolean only; no documented max count |
| `tool_use_per_turn_limit` | **null** — no API cap | medium | Agents SDK defaults 20 max_turns; not API-enforced |
| `max_connected_servers` | **null** — no hard cap | low (Tier-1) | [ChatGPT MCP help article](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta): multiple apps in single prompt supported |
| `max_total_tools` | **128** (same as hard cap) | high (Tier-1) | Tools from all MCP servers aggregate to single 128-tool budget |
| Strict mode: `additionalProperties` | Must be `false` on all objects | high (Tier-1) | [structured-outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) |
| Strict mode: `required` | All properties must be listed | high (Tier-1) | structured-outputs guide |
| Strict mode: `anyOf` | Only nullable patterns (`anyOf: [{type:X},{type:null}]`) | high (Tier-1) | structured-outputs guide |
| Strict mode: `oneOf` / `$ref` | Not supported or problematic in strict mode | high (Tier-1) | structured-outputs guide |
| Strict mode: max properties | 100 object properties total | medium (Tier-2) | community / structured-outputs docs |
| Strict mode: nesting depth | 5 levels max | medium (Tier-2) | community / structured-outputs docs |
| Strict mode: `pattern`/`format`/`minimum` | Accepted but NOT enforced by model | high (Tier-1) | structured-outputs guide |

### Notes

- **128-tool cap source upgraded:** Previously sourced from a Tier-4 GitHub issue. Now sourced from `platform.openai.com/docs/assistants/deep-dive` (Tier-1), which explicitly states "up to 128 tools."
- **Name-length warning for MCP namespacing:** When MCP clients prefix tool names (e.g. `server_toolname`), the server prefix consumes characters from the 64-char budget. Long server names + long tool names can exceed 64 chars and cause API errors.
- **Description-length workaround:** If tool descriptions exceed 1024 chars, move the detail into the system prompt. The API cap is on the `description` field only.
- **No connector server count cap:** Neither the Responses API nor ChatGPT publishes a hard limit on the number of connected MCP servers. The binding constraint is the 128-tool aggregate — connect as many servers as needed, as long as total exposed tools ≤ 128 (or use `allowed_tools` to filter).
- **tool_search deferral** (`tool_search`) is the primary mitigation for the 128-tool cap: register large tool surfaces, let the model lazily load only relevant tools at runtime. Available on gpt-5.5, gpt-5.4, gpt-5.4-mini; NOT on gpt-5.4-nano.

---

## Low-Confidence / Unknown Fields

| Field | Model(s) | Reason |
|---|---|---|
| `max_output_tokens_default` | all 3 | Not separately documented; only max is published |
| `max_tools_practical` | all 3 | Tier-4 empirical; varies by task and tool description quality |
| `max_request_size` | all 3 | No byte-size limit published for function calling; effective limit is context window |
| `max_tool_result_size` | all 3 | Community-reported 512KB; not in official API reference |
| `max_parallel_tool_calls_count` | all 3 | No numeric cap documented; boolean only |
| `tool_use_per_turn_limit` | all 3 | No API-enforced limit; SDK-level default only |
| `max_connected_servers` | all 3 | No hard cap documented |
| `max_tool_description_len` | all 3 | 1024-char limit confirmed via API error responses, not on official docs page |
| Image token rule | all 3 | Medium confidence; standard GPT-4o formula assumed for GPT-5.x |

---

## Sources

- [GPT-5.5 model page](https://developers.openai.com/api/docs/models/gpt-5.5)
- [GPT-5.4 model page](https://developers.openai.com/api/docs/models/gpt-5.4)
- [GPT-5.4 mini model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [GPT-5.4 nano model page](https://developers.openai.com/api/docs/models/gpt-5.4-nano) (cross-reference)
- [OpenAI API Pricing](https://openai.com/api/pricing/)
- [OpenAI Models overview](https://developers.openai.com/api/docs/models)
- [Function calling guide](https://developers.openai.com/api/docs/guides/function-calling)
- [MCP and Connectors guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Tool search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)
- [Skills guide](https://developers.openai.com/api/docs/guides/tools-skills)
- [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Token counting guide](https://developers.openai.com/api/docs/guides/token-counting)
- [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)
- [Introducing GPT-5.5](https://openai.com/index/introducing-gpt-5-5/)
- [Introducing GPT-5.4](https://openai.com/index/introducing-gpt-5-4/)
- [tiktoken (GitHub)](https://github.com/openai/tiktoken)
- [tiktoken — GPT-5.x o200k_base issue #464](https://github.com/openai/tiktoken/issues/464)
- [128-tool limit GitHub issue](https://github.com/code-yeongyu/oh-my-openagent/issues/2848)
- [GPT-5.4 deep dive: tool search (OpenAI community)](https://community.openai.com/t/gpt-5-4-deep-dive-pricing-context-limits-and-tool-search-explained/1375800)

# Citations

None.
