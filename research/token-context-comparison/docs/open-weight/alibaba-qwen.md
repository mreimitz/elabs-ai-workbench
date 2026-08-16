# Alibaba (Qwen) — Open-Weight Provider Profile

> **As-of date:** 2026-06-21  
> **Group:** open_weight  
> **Canonical data file:** `data/open-weight/alibaba-qwen.json`

---

## Provider Summary

Alibaba's Qwen series is one of the most capable open-weight model families as of mid-2026, notable for:

- **Strong tool-use and agentic ability** — Qwen3.5 introduced BFCL-V4, TAU2-Bench, MCPMark, and BrowseComp benchmarks showing competitive function-calling versus larger proprietary models.
- **MCP support via Qwen-Agent** — The official [Qwen-Agent](https://github.com/QwenLM/Qwen-Agent) framework accepts MCP server configurations directly (`mcpServers` key in `function_list`), translating them to OpenAI-compatible function-calling format.
- **Tokenizer: public tiktoken BPE** — All Qwen3/3.5/3.6 models share the same tiktoken-based BPE tokenizer (~151,643 vocabulary) accessible via `AutoTokenizer` from HuggingFace. This makes exact local token counting straightforward.
- **262K native / ~1M extended context** — All current Qwen3.x models have 262,144 native context, extendable to 1,010,000 tokens via YaRN RoPE scaling with config changes.
- **Thinking-by-default** — Models generate `<think>...</think>` reasoning blocks before responses; these count as output tokens and are billed at the output rate.
- **Hosted API: Alibaba Cloud Model Studio / DashScope** — Provides an OpenAI-compatible endpoint. The hosted model IDs differ from the open-weight HF IDs (e.g., `qwen3.5-flash` corresponds to Qwen3.5-35B-A3B open weights).
- **Apache-2.0 license** for all models profiled — commercial use and redistribution permitted.

---

## Models Profiled

| Model | Type | Released | HF Repo |
|---|---|---|---|
| Qwen3.6-27B | Dense, multimodal | 2026-04-22 | `Qwen/Qwen3.6-27B` |
| Qwen3.6-35B-A3B | MoE 35B/3B active, multimodal | 2026-04-27 | `Qwen/Qwen3.6-35B-A3B` |
| Qwen3.5-35B-A3B | MoE 35B/3B active, multimodal | 2026-02-24 | `Qwen/Qwen3.5-35B-A3B` |

---

## Model 1: Qwen3.6-27B

### Context (Axis 1 & 2)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window (GA) | 262,144 tokens | High | HF model card (Tier 1) |
| Input + output shared pool | Yes | High | Architecture (Tier 1) |
| Max input (derived) | ~180,224 tokens | Medium | Derived: window − max_output |
| Max output (default) | 32,768 tokens | High | HF model card (Tier 1) |
| Max output (max) | 81,920 tokens | High | HF model card (Tier 1) |
| Extended context (YaRN) | 1,010,000 tokens | High | HF model card (Tier 1) |
| Reasoning tokens count as output | Yes | High | HF model card (Tier 1) |

**Extended context note:** Requires modifying `rope_parameters` in `config.json` (`rope_type: yarn, factor: 4.0, original_max_position_embeddings: 262144`) or passing CLI overrides to vLLM (`--max-model-len 1010000 VLLM_ALLOW_LONG_MAX_MODEL_LEN=1`) or SGLang. Static YaRN may degrade performance on shorter texts — only enable when needed.

### Tokenization (Axis 3)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | Qwen3 tiktoken BPE (~151,643 vocab) | High | HF repo tokenizer.json (Tier 1/2) |
| Tokenizer public | Yes | High | HF repo (Tier 2) |
| Tokenizer access | `AutoTokenizer.from_pretrained("Qwen/Qwen3.6-27B")` | High | HF (Tier 2) |
| Count tokens method | `len(tok.encode(text))` | High | HF (Tier 2) |
| Image token rule | Variable tile-based patching | Medium | HF model card (Tier 1) |
| Audio token rule | N/A (audio not supported) | High | — |
| Chars/token estimate | ~3.5 (English); ~1.5 (Chinese) | Medium | Qwen tokenizer notes (Tier 3) |

### Tools / MCP (Axis 5)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | Yes | High | HF model card (Tier 1) |
| Native MCP | Yes (via Qwen-Agent) | High | HF model card (Tier 1) |
| Parallel tool calls | Yes | Medium | API behavior (Tier 1) |
| Max tools (hard cap) | None documented | Medium | No source |
| Max tools (practical) | ~40 (estimated) | Low | Community consensus (Tier 4) |
| Tool definition shape | `openai_function` | High | HF model card (Tier 1) |
| Tool defs count as input | Yes | High | DashScope pricing (Tier 1) |
| Tool search / deferral | No | Medium | No documented feature |
| Max tool name length | Not documented | Low | — |

**Framework tool-calling notes:** vLLM requires `--enable-auto-tool-choice --tool-call-parser qwen3_coder`. SGLang requires `--tool-call-parser qwen3_coder`. Qwen-Agent translates MCP tool configs to function-call format automatically. Thinking mode (default on) generates `<think>` blocks — these appear before tool calls and count toward output tokens.

### Skills / Context (Axis 6)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Skills concept | No formal skills system | High | — |
| Loading model | N/A | High | — |
| Prompt caching | Yes (DashScope context cache; vLLM prefix cache) | High | DashScope pricing (Tier 1) |
| Memory feature | No (external only via Qwen-Agent) | Medium | — |

**Skills context notes:** No packaged skills marketplace. Qwen-Agent provides tool/plugin injection per session — tools are injected as input tokens at session start. For the footprint tool: all MCP tool definitions count as input tokens via the standard OpenAI function format.

### Cost (Axis 4 & 7)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input (hosted API) | ~$0.14 / 1M tokens | Medium | Aggregator pricepertoken.com (Tier 3) |
| Output (hosted API) | ~$0.90 / 1M tokens | Medium | Aggregator pricepertoken.com (Tier 3) |
| Cached input | ~$0.05 / 1M tokens | Medium | Aggregator (Tier 3) |
| Batch discount | 50% off (DashScope policy) | High | DashScope pricing (Tier 1) |
| Billing unit | Tokens (hosted) / Compute (self-host) | High | DashScope pricing (Tier 1) |
| Reasoning billed as output | Yes | High | DashScope pricing (Tier 1) |

**Cost note:** Qwen3.6-27B was not on the official Alibaba Cloud pricing page as of 2026-06-21. Prices above are third-party aggregator estimates for the Qwen API endpoint; verify at [alibabacloud.com/help/en/model-studio/model-pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing).

### Self-Host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | `https://huggingface.co/Qwen/Qwen3.6-27B` | High | HF (Tier 1) |
| License | Apache-2.0 | High | HF model card (Tier 1) |
| Param variants | 27B dense (single size) | High | HF model card (Tier 1) |
| Native context config | 262,144 tokens | High | HF model card (Tier 1) |
| Max context (YaRN) | 1,010,000 tokens | High | HF model card (Tier 1) |
| Serving frameworks | vLLM ≥0.19.0, SGLang ≥0.5.10, KTransformers, HF Transformers, Ollama (GGUF) | High | HF model card (Tier 1) |

---

## Model 2: Qwen3.6-35B-A3B

### Context (Axis 1 & 2)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window (GA) | 262,144 tokens | High | HF model card (Tier 1) |
| Max output (default) | 32,768 tokens | High | HF model card (Tier 1) |
| Max output (max) | 81,920 tokens | High | HF model card (Tier 1) |
| Extended context (YaRN) | 1,010,000 tokens | High | HF model card (Tier 1) |
| Reasoning tokens count as output | Yes | High | HF model card (Tier 1) |

### Tokenization (Axis 3)

Same tokenizer as Qwen3.6-27B: Qwen3 tiktoken BPE (~151,643 vocab), public via HF `AutoTokenizer`.

### Tools / MCP (Axis 5)

Same as Qwen3.6-27B. MCPMark benchmark score of 37.0 reported (GitHub MCP v0.30.3 test harness).

### Skills / Context (Axis 6)

Same as Qwen3.6-27B — no formal skills system; tools via Qwen-Agent; DashScope context caching available.

### Cost (Axis 4 & 7)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input (hosted API) | $0.14 / 1M tokens | Medium | pricepertoken.com (Tier 3) |
| Output (hosted API) | $0.90 / 1M tokens | Medium | pricepertoken.com (Tier 3) |
| Cached input | $0.05 / 1M tokens | Medium | pricepertoken.com (Tier 3) |
| Reasoning billed as output | Yes | High | DashScope pricing (Tier 1) |

### Self-Host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | `https://huggingface.co/Qwen/Qwen3.6-35B-A3B` | High | HF (Tier 1) |
| License | Apache-2.0 | High | HF model card (Tier 1) |
| Param variants | 35B total / 3B active (MoE: 256 experts, 8+1 activated) | High | HF model card (Tier 1) |
| Native context config | 262,144 tokens | High | HF model card (Tier 1) |
| Max context (YaRN) | 1,010,000 tokens | High | HF model card (Tier 1) |
| Serving frameworks | vLLM ≥0.19.0, SGLang ≥0.5.10, KTransformers, HF Transformers, Ollama | High | HF model card (Tier 1) |

**MoE efficiency note:** Only 3B parameters are activated per token despite 35B total. This makes Qwen3.6-35B-A3B highly efficient on memory and throughput compared to a 35B dense model, while delivering near-27B-dense performance on most benchmarks.

---

## Model 3: Qwen3.5-35B-A3B

### Context (Axis 1 & 2)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window (GA) | 262,144 tokens | High | HF model card (Tier 1) |
| Max output (default) | 32,768 tokens | High | HF model card (Tier 1) |
| Max output (max) | 81,920 tokens | High | HF model card (Tier 1) |
| Extended context (YaRN) | 1,010,000 tokens | High | HF model card (Tier 1) |
| Reasoning tokens count as output | Yes | High | HF model card (Tier 1) |

### Tokenization (Axis 3)

Same tokenizer as Qwen3.6 series.

### Tools / MCP (Axis 5)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | Yes | High | BFCL-V4: 67.3 (Tier 1) |
| Native MCP | Yes (Qwen-Agent) | High | HF model card (Tier 1) |
| Parallel tool calls | Yes | Medium | API behavior (Tier 1) |
| Max tools (hard) | None documented | Medium | — |
| Max tools (practical) | ~40 | Low | Community (Tier 4) |
| Tool definition shape | `openai_function` | High | HF model card (Tier 1) |

**Agentic benchmarks:** TAU2-Bench 81.2, BFCL-V4 67.3, BrowseComp 61.0, WideSearch 57.1 — among the strongest tool-use results in the open-weight category.

### Cost (Axis 4 & 7)

| Field | Value | Confidence | Source |
|---|---|---|---|
| Input (hosted API — qwen3.5-flash) | $0.10 / 1M tokens | High | DashScope pricing (Tier 1) |
| Output (hosted API — qwen3.5-flash) | $0.40 / 1M tokens | High | DashScope pricing (Tier 1) |
| Cached input | Not separately published | Low | DashScope pricing (Tier 1) |
| Batch discount | 50% off (Batch Invocation) | High | DashScope pricing (Tier 1) |
| Reasoning billed as output | Yes | High | DashScope pricing (Tier 1) |

**Hosted API mapping:** The HF model card states: "Qwen3.5-Flash is the hosted version corresponding to Qwen3.5-35B-A3B with more production features, e.g., 1M context length by default." Use model ID `qwen3.5-flash` on DashScope.

### Self-Host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | `https://huggingface.co/Qwen/Qwen3.5-35B-A3B` | High | HF (Tier 1) |
| License | Apache-2.0 | High | HF model card (Tier 1) |
| Param variants | 35B total / 3B active MoE; family also has 122B-A10B, 27B, 7B, 4B, etc. | High | HF model card (Tier 1) |
| Native context config | 262,144 tokens | High | HF model card (Tier 1) |
| Max context (YaRN) | 1,010,000 tokens | High | HF model card (Tier 1) |
| Serving frameworks | vLLM (main branch), SGLang (main branch), KTransformers, HF Transformers, Ollama | High | HF model card (Tier 1) |

---

## Takeaways for the Recommender

### When to recommend Qwen3.6-27B

- Need a **dense model** that minimizes KV-cache memory overhead for long-context agentic sessions
- Strong **coding + agentic** work: SWE-bench Verified 77.2, Terminal-Bench 59.3 — competitive with much larger models
- Sessions requiring **Thinking Preservation** across turns (reduces redundant CoT tokens in multi-turn flows)
- When the 256K window is the primary use case and YaRN extension is not needed

### When to recommend Qwen3.6-35B-A3B or Qwen3.5-35B-A3B

- **Cost-efficient self-hosting**: MoE with 3B active params means much lower GPU memory per forward pass than a 35B dense model
- **Qwen3.5-35B-A3B** specifically if you want the cheapest capable hosted API: qwen3.5-flash at $0.10/$0.40 per M tokens is one of the most affordable options in the open-weight hosted category
- **Qwen3.6-35B-A3B** for improved agentic coding vs. Qwen3.5 predecessor (Qwen3.6 MCPMark 37.0 vs. 27.0; SWE-bench 73.4 vs. 69.2)

### Footprint headroom

All three models have a **262K native context** (~2× larger than most SaaS models at standard pricing). A typical MCP server with 50 tools at ~300 tokens/tool definition = ~15,000 tokens footprint ≈ **5.7% of the 262K window**. With YaRN extension to 1M tokens, even a 200-tool server is a small fraction of the available window. However, **practical tool accuracy degrades before the window fills** — the ~40-tool practical estimate is the operative constraint, not the context window.

### Cost profile

- **Self-hosted**: compute cost only; no per-token billing. Efficient for high-volume agentic workloads.
- **Hosted (DashScope)**: reasoning tokens (CoT) are billed at the output rate — for Thinking-mode sessions this can 2–5× the effective output token cost. Use non-thinking mode (`enable_thinking: false`) for latency-sensitive or cost-sensitive tasks where reasoning adds no value.
- **Prompt caching** available on DashScope (context-cache discount) and natively in vLLM/SGLang (prefix KV cache) — recommended for static tool-definition prefixes.

### Tool-calling format note

All three models expose an **OpenAI-compatible function-calling interface** via vLLM/SGLang and DashScope. The MCP Token Footprint tool's existing `toOpenAIStyleTool` adapter applies directly. No separate shape adapter required. Tool definition JSON is billed as input tokens on DashScope.

### Null / low-confidence fields

- `knowledge_cutoff`: Not officially published for any Qwen3.x model. Left null.
- `max_tools_practical`: Community consensus estimate (~40); no Qwen-specific empirical study found.
- `Qwen3.6-27B / Qwen3.6-35B-A3B hosted prices`: Not on official DashScope pricing page as of 2026-06-21; aggregator estimates used (Tier 3), marked medium confidence.
- `image_token_rule`: Tile-based patching confirmed but exact formula not published; use AutoProcessor for accurate counts.
- `max_tool_name_len`: Not documented.

---

## Sources

1. [Qwen/Qwen3.6-27B HuggingFace model card](https://huggingface.co/Qwen/Qwen3.6-27B) — Tier 1
2. [Qwen/Qwen3.6-35B-A3B HuggingFace model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) — Tier 1
3. [Qwen/Qwen3.5-35B-A3B HuggingFace model card](https://huggingface.co/Qwen/Qwen3.5-35B-A3B) — Tier 1
4. [Alibaba Cloud Model Studio — Model invocation pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) — Tier 1 (Last Updated: Apr 01, 2026)
5. [Qwen-Agent GitHub repository](https://github.com/QwenLM/Qwen-Agent) — Tier 1
6. [Qwen tokenization notes](https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md) — Tier 1
7. [QwenLM/Qwen3 GitHub — Knowledge cutoff discussion #1093](https://github.com/QwenLM/Qwen3/discussions/1093) — Tier 1
8. [pricepertoken.com — Qwen3.6 35B A3B](https://pricepertoken.com/pricing-page/model/qwen-qwen3.6-35b-a3b) — Tier 3 (updated 2026-06-20)
9. [qwen.ai blog: Qwen3.6-27B](https://qwen.ai/blog?id=qwen3.6-27b) — Tier 1
10. [qwen.ai blog: Qwen3.6-35B-A3B](https://qwen.ai/blog?id=qwen3.6-35b-a3b) — Tier 1
11. [qwen.ai blog: Qwen3.5](https://qwen.ai/blog?id=qwen3.5) — Tier 1
