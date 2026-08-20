---
type: "Research Note"
title: "DeepSeek \u2014 Open-Weight Provider Summary"
description: "As of: 2026-06-21. Data file: data/open-weight/deepseek.json."
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# DeepSeek — Open-Weight Provider Summary

> As of: 2026-06-21. Data file: `data/open-weight/deepseek.json`.

## Provider Summary

DeepSeek is a Chinese AI lab that open-sources its frontier models under the MIT License and also
runs a hosted API. The three models covered here are the two current GA models (**V4-Pro** and
**V4-Flash**, both released 2026-04-24) and the previous generation (**V3.2**, released 2025-12-01)
which remains widely self-hosted.

Key posture for the MCP Token Footprint recommendation engine:

- **No native MCP support** in the API or the model weights. Function calling uses the OpenAI
  function format, which the footprint tool's `toOpenAIStyleTool` adapter already handles.
- **Tokenizer is public**: `vocab_size=129280`, accessible via HF AutoTokenizer or the
  offline `deepseek_tokenizer.zip` package. Enables exact local token counting.
- **Disk-based KV-cache (context caching) is on by default** — tool definitions and system
  prompts in repeated sessions benefit automatically, with up to 98-99% input price reduction on
  cache hits.
- **Thinking/CoT tokens are billed as output.** Both V4-Pro and V4-Flash support three reasoning
  effort modes (Non-think / Think High / Think Max). The 384K max_output cap covers thinking +
  final response combined — relevant for budgeting agentic sessions with large tool outputs.
- **V4's 1M context window** is a major upgrade from V3.2's 160K, making footprint headroom
  much less of a constraint for self-hosters willing to run a 284B+ MoE model.

---

## Models

### 1. DeepSeek-V4-Pro

**API name:** `deepseek-v4-pro` | **HF:** `deepseek-ai/DeepSeek-V4-Pro` | **Released:** 2026-04-24

#### Context

| Field | Value | Confidence |
|---|---|---|
| Context window | 1,048,576 tokens (1M) | high |
| Input + output shared | Yes | high |
| Max input (derived) | ~655K tokens | medium |
| Max output (default) | Not documented separately | low |
| Max output (max) | 393,216 tokens (384K) | high |
| Extended context | None (1M is standard) | high |
| Reasoning tokens count as output | Yes | high |

#### Tokenization

| Field | Value | Confidence |
|---|---|---|
| Tokenizer family | DeepSeek BPE (encoding_dsv4), vocab_size=129280 | high |
| Tokenizer public | Yes | high |
| Access method | HF AutoTokenizer (`deepseek-ai/DeepSeek-V4-Pro`) + encoding_dsv4 scripts | high |
| Count tokens method | `AutoTokenizer.encode(text)` or offline `deepseek_tokenizer.zip` | high |
| Image token rule | N/A (text-only) | high |
| Audio token rule | N/A | high |
| Chars/token estimate | ~3.3 (EN); ~1.7 (ZH) | medium |

#### Tools / MCP

| Field | Value | Confidence |
|---|---|---|
| Function calling | Yes | high |
| Native MCP | No | high |
| Parallel tool calls | Yes | high |
| Max tools (hard) | None documented | medium |
| Max tools (practical) | ~30 (estimate) | low |
| Tool definition shape | `openai_function` | high |
| Tool defs count as input | Yes | high |
| Tool search/deferral | No | medium |
| Tool name length limit | Not documented | low |
| Tool schema notes | Strict mode (beta): supports object, string, number, integer, boolean, array, enum, anyOf, $ref/$def. minLength/maxLength/minItems/maxItems not supported in strict mode. |

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | high |
| Skills loading model | N/A | high |
| Prompt caching | Yes (disk KV-cache, auto, default-on) | high |
| Memory feature | No | high |

System prompt and tool definition tokens are eligible for cache hits. In thinking-mode tool-call
turns, `reasoning_content` must be passed back to the API in subsequent requests — this adds input
token overhead in multi-turn agentic sessions.

#### Cost (Hosted API)

| Field | Value | Confidence |
|---|---|---|
| Input (cache miss) | $0.435 / 1M tokens | high |
| Input (cache hit) | $0.003625 / 1M tokens (>99% off) | high |
| Output (incl. thinking) | $0.87 / 1M tokens | high |
| Cached output | N/A | — |
| Batch discount | None documented | high |
| Reasoning billed as output | Yes, at $0.87/1M | high |

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro | high |
| License | MIT | high |
| Param variants | 1.6T total / 49B active (MoE), FP4+FP8 mixed | high |
| Native context config | 1,048,576 (config.json `max_position_embeddings`) | high |
| Max context documented | 1,048,576 (1M) | high |
| Serving frameworks | vLLM, SGLang (recommended), Transformers, Docker Model Runner | high |

**Framework tool calling notes:** OpenAI-compatible tool calling works out of the box with
vLLM/SGLang. MCP protocol requires an adapter layer. In thinking mode with tool calls,
`reasoning_content` must be passed back in all subsequent turns.

---

### 2. DeepSeek-V4-Flash

**API name:** `deepseek-v4-flash` | **HF:** `deepseek-ai/DeepSeek-V4-Flash` | **Released:** 2026-04-24

Lighter MoE variant (284B/13B active vs V4-Pro's 1.6T/49B). Previously the model backing both
`deepseek-chat` (non-thinking) and `deepseek-reasoner` (thinking) API aliases — both deprecated
2026-07-24.

#### Context

| Field | Value | Confidence |
|---|---|---|
| Context window | 1,048,576 tokens (1M) | high |
| Input + output shared | Yes | high |
| Max input (derived) | ~655K tokens | medium |
| Max output (default) | Not documented | low |
| Max output (max) | 393,216 tokens (384K) | high |
| Extended context | None | high |
| Reasoning tokens count as output | Yes | high |

#### Tokenization

Identical tokenizer to V4-Pro: DeepSeek BPE, vocab_size=129280, encoding_dsv4. HF AutoTokenizer
accessible at `deepseek-ai/DeepSeek-V4-Flash` (shared tokenizer with Pro).

#### Tools / MCP

Same as V4-Pro: `openai_function` shape, parallel tool calls, no hard limit, no deferral. Same
strict mode beta support.

#### Skills / Context

Same as V4-Pro: no skills, disk KV-cache on by default.

#### Cost (Hosted API)

| Field | Value | Confidence |
|---|---|---|
| Input (cache miss) | $0.14 / 1M tokens | high |
| Input (cache hit) | $0.0028 / 1M tokens (~98% off) | high |
| Output (incl. thinking) | $0.28 / 1M tokens | high |
| Reasoning billed as output | Yes, at $0.28/1M | high |

V4-Flash is the cheapest frontier-class API as of 2026-06-21.

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash | high |
| License | MIT | high |
| Param variants | 284B total / 13B active (MoE), FP4+FP8 mixed | high |
| Native context config | 1,048,576 (config.json) | high |
| Serving frameworks | vLLM, SGLang, Transformers, Ollama (quantized) | high |

More accessible for self-hosting than V4-Pro due to smaller size (284B vs 1.6T).

---

### 3. DeepSeek-V3.2

**HF:** `deepseek-ai/DeepSeek-V3.2` | **Released:** 2025-12-01

No longer a distinct hosted API endpoint (replaced by V4-Flash). Included as a widely self-hosted
model and a relevant baseline for the 160K context generation.

#### Context

| Field | Value | Confidence |
|---|---|---|
| Context window | 163,840 tokens (~160K) | high |
| Input + output shared | Yes | high |
| Max input | Not separately documented | low |
| Max output (default) | Not separately documented | low |
| Max output (max) | Not separately documented (deployment-set) | low |
| Extended context | None | high |
| Reasoning tokens count as output | Yes | high |

Note: When this model was the backend for the hosted `deepseek-chat` API, context was capped at
64K with 8K output (non-thinking) and 32K CoT + 8K output (deepseek-reasoner). Those were API
limits, not model limits. Native self-hosted context is 160K.

#### Tokenization

DeepSeek BPE (encoding_dsv32), vocab_size=129280 — same vocab as V4. HF AutoTokenizer at
`deepseek-ai/DeepSeek-V3.2`.

#### Tools / MCP

`openai_function` shape, parallel tool calls, no hard limit. **First DeepSeek model with thinking
integrated into tool-use.** V3.2-Speciale variant does NOT support tool calls.

#### Skills / Context

No skills. Disk KV-cache on (when using third-party or self-hosted with supported framework).

#### Cost (Self-Hosted)

| Field | Value | Confidence |
|---|---|---|
| Input per MTok | Compute cost (no per-token fee) | high |
| Output per MTok | Compute cost | high |
| Cached input | N/A (per-token API not offered) | high |
| Reasoning billed as output | Yes (when on third-party APIs) | high |

No distinct hosted pricing endpoint from DeepSeek as of 2026-06-21.

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | https://huggingface.co/deepseek-ai/DeepSeek-V3.2 | high |
| License | MIT | high |
| Param variants | 671B total / 37B active (MoE), FP8 | high |
| Native context config | 163,840 (config.json `max_position_embeddings`) | high |
| Max context documented | 163,840 (~160K) | high |
| Serving frameworks | vLLM, SGLang, Transformers, Ollama (quantized) | high |

---

## Takeaways for the Recommender

**When to pick DeepSeek (open-weight):**

- **Best-in-class context footroom at open-weight price:** V4-Flash/Pro with a 1M window means
  even a heavy MCP server (e.g., 100K tokens of tool definitions) consumes only ~10% of the
  context budget — a non-issue.
- **Cheapest hosted API for tool-heavy workloads:** V4-Flash at $0.14/1M input + $0.28/1M output
  is the lowest frontier pricing. With automatic disk caching, repeated tool-definition prefixes
  drop to $0.0028/1M — nearly free for stable MCP setups.
- **Public tokenizer = exact footprint counts:** `vocab_size=129280` tokenizer is freely available
  via HF and the offline zip. The footprint tool can count tool definitions precisely without an
  API round-trip.
- **MIT license** — no commercial restrictions on self-hosting.

**Footprint headroom (key numbers):**

| Model | Context | Practical tool budget (at 2K tokens/tool, 30 tools) |
|---|---|---|
| V4-Pro | 1,048,576 | 60K tokens tool defs = 5.7% of window |
| V4-Flash | 1,048,576 | 60K tokens tool defs = 5.7% of window |
| V3.2 (self-hosted) | 163,840 | 60K tokens tool defs = 36.6% of window — more constrained |

**Cost profile for MCP sessions:**

- Tool definitions are prime disk-cache candidates (static prefix). After the first 2-3 requests,
  cache hit rate for tool defs is typically high, dropping effective input cost by 98-99%.
- Reasoning/CoT output is the expensive direction. V4-Pro thinking at $0.87/1M output. Budget
  high-effort reasoning separately.
- No batch API — no async discount path.

**Caveats / low-confidence fields:**

- `knowledge_cutoff`: not documented for any model.
- `max_output_tokens_default`: not documented; assume server-default or same as max.
- `max_tools_practical` (~30): estimate only; no DeepSeek-specific empirical study found.
- `max_tool_name_len`: not documented.
- V3.2 max_output: deployment-configurable; not stated in model card.

---

## Sources

| Tier | URL |
|---|---|
| 1 | https://api-docs.deepseek.com/quick_start/pricing |
| 1 | https://api-docs.deepseek.com/news/news260424 |
| 1 | https://api-docs.deepseek.com/news/news251201 |
| 1 | https://api-docs.deepseek.com/guides/tool_calls |
| 1 | https://api-docs.deepseek.com/guides/kv_cache |
| 1 | https://api-docs.deepseek.com/guides/thinking_mode |
| 1 | https://api-docs.deepseek.com/quick_start/token_usage |
| 1 | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro |
| 1 | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/config.json |
| 1 | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash |
| 1 | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/blob/main/config.json |
| 1 | https://huggingface.co/deepseek-ai/DeepSeek-V3.2 |
| 1 | https://huggingface.co/deepseek-ai/DeepSeek-V3.2/blob/main/config.json |

# Citations

None.
