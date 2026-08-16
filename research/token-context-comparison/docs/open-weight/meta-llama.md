# Meta Llama — Open-Weight Provider Profile

> **Provider:** Meta Llama | **Group:** Open-Weight  
> **As of:** 2026-06-21 | **Models covered:** Llama 4 Scout, Llama 4 Maverick, Llama 4 Behemoth  
> **Source:** `data/open-weight/meta-llama.json`

---

## Provider Summary

Meta Llama 4 (released April 5, 2025) is Meta's flagship open-weight model family. Two models — Scout and Maverick — are publicly available as downloadable weights on HuggingFace under the Llama 4 Community License. A third, Behemoth, was announced at launch but has not been released as of 2026-06-21.

**MCP posture:** The Llama 4 models do NOT natively speak the MCP protocol. MCP integration is a serving-layer concern: vLLM and SGLang expose an OpenAI-compatible API with function-calling support, and MCP tool definitions can be serialized as OpenAI function JSON to reach the model. The tool-calling parser for Llama 4 in vLLM is `llama4_pythonic`.

**Skills concept:** None. No first-party skills/extensions system. Agent frameworks (llama-stack, LangChain, LlamaIndex) can implement skill-like patterns externally.

**Tokenizer:** All Llama 4 models share a tiktoken-based BPE tokenizer with ~200,000 base vocabulary tokens + 2,048 special tokens. Uses the O200K_PATTERN regex (same pattern as OpenAI's o200k_base). Tokenizer is public (gated HuggingFace repo, requires license acceptance). This makes local token counting straightforward via HF `AutoTokenizer` or the official `tokenizer.py`.

---

## Models

### 1. Llama 4 Scout (17B×16E)

**HF ID:** `meta-llama/Llama-4-Scout-17B-16E-Instruct`  
**Status:** GA | **Released:** 2025-04-05 | **Knowledge cutoff:** August 2024

#### Context Window

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 10,485,760 tokens (10M) | High | HF model card |
| Input + output shared | Yes | High | HF blog |
| Max input tokens | ~10,469,376 (derived) | Medium | Derived |
| Max output (hosted providers) | 16,384 tokens | Medium | Aggregators (Tier 3) |
| Max output (self-hosted) | Deployment-defined | — | — |
| Extended context | None (10M IS the max) | High | HF blog |
| Base model context | 256,000 tokens | High | HF blog |
| Reasoning tokens | N/A | High | — |

> The 10M context is architecturally real (iRoPE: interleaved NoPE + chunked RoPE + attention temperature tuning) but practically constrained by GPU memory. 8×H100 achieves ~1M, 8×H200 ~3.6M; full 10M requires multi-node deployment.

#### Tokenization

| Field | Value | Confidence |
|---|---|---|
| Tokenizer family | tiktoken BPE, O200K pattern, ~200K vocab | High |
| Tokenizer public | Yes (gated HF repo) | High |
| Access method | `AutoTokenizer.from_pretrained('meta-llama/Llama-4-Scout-17B-16E-Instruct')` | High |
| Count tokens method | HF AutoTokenizer or official `tokenizer.py` | High |
| Image token rule | Tile-based (560×560px tiles → patch tokens) | Medium |
| Audio tokens | Not supported | High |
| Chars/token estimate | ~3.5 (English) | Medium |

#### Tools / MCP

| Field | Value | Confidence |
|---|---|---|
| Function calling | Yes | High |
| Native MCP | No | High |
| Parallel tool calls | Yes (improvement over Llama 3) | High |
| Max tools hard limit | None documented | High |
| Max tools practical | Unknown (Tier 4 empirical; ~30–50 general guidance) | Low |
| Tool definition shape | Llama4 pythonic; OpenAI function JSON via vLLM/SGLang endpoint | High |
| Tool defs count as input | Yes | High |
| Tool search/deferral | No (serving-layer responsibility) | High |
| Max tool name length | Not documented | Low |

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | High |
| Skills loading model | N/A | High |
| Prompt caching | Yes (via vLLM prefix cache / SGLang RadixAttention) | Medium |
| Memory feature | No | High |
| System prompt overhead | Operator-controlled; no platform injection | High |

> System prompt tokens count against the 10M context window. Meta provides a reference system prompt (~170 tokens) in the model card.

#### Cost

| Field | Value |
|---|---|
| Billing unit | Compute (self-hosted GPU) |
| Input price | No vendor price. Tier-3 ref: Groq ~$0.11/M, DeepInfra ~$0.08/M |
| Output price | No vendor price. Tier-3 ref: Groq ~$0.34/M, DeepInfra ~$0.30/M |
| Cached input | No vendor price (prefix caching via serving stack) |
| Batch discount | None (vLLM continuous batching improves throughput, no token discount) |

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | `https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct` | High |
| License | Llama 4 Community License | High |
| Params | 17B active / 109B total (MoE: 16 experts) | High |
| Config `max_position_embeddings` | 10,485,760 | High |
| Max context documented | 10,485,760 (10M) | High |
| Quantization | BF16 (released); on-the-fly int4 (fits single H100) | High |
| Serving frameworks | vLLM (v0.8.3+, recommended), SGLang, TGI (maintenance), HF Transformers | High |

**Tool-calling / MCP when self-served:**
```bash
vllm serve meta-llama/Llama-4-Scout-17B-16E-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser llama4_pythonic \
  --chat-template examples/tool_chat_template_llama4_pythonic.jinja \
  --tensor-parallel-size 8 \
  --max-model-len 1000000
```
The resulting OpenAI-compatible `/v1/chat/completions` endpoint accepts function-call definitions (including MCP tools serialized as OpenAI functions). MCP protocol bridging must be done by the caller or an agent framework.

---

### 2. Llama 4 Maverick (17B×128E)

**HF ID:** `meta-llama/Llama-4-Maverick-17B-128E-Instruct`  
**Status:** GA | **Released:** 2025-04-05 | **Knowledge cutoff:** August 2024

#### Context Window

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 1,048,576 tokens (1M) | High | HF model card |
| Input + output shared | Yes | High | HF blog |
| Max input tokens | ~1,032,192 (derived) | Medium | Derived |
| Max output (hosted providers) | 16,384 tokens | Medium | Aggregators (Tier 3) |
| Max output (self-hosted) | Deployment-defined | — | — |
| Extended context | None (1M IS the max) | High | HF blog |
| Base model context | 256,000 tokens | High | HF blog |
| Practical on 8×H100 | ~430,000 tokens | High | vLLM blog |
| Practical on 8×H200 | 1,000,000 tokens | High | vLLM blog |

#### Tokenization

| Field | Value | Confidence |
|---|---|---|
| Tokenizer family | Same as Scout: tiktoken BPE, O200K pattern, ~200K vocab | High |
| Tokenizer public | Yes (gated HF repo) | High |
| Access | `AutoTokenizer.from_pretrained('meta-llama/Llama-4-Maverick-17B-128E-Instruct')` | High |
| Image tokens | Tile-based (same as Scout) | Medium |
| Audio tokens | Not supported | High |

#### Tools / MCP

Same as Scout: function calling Yes, native MCP No, parallel tool calls Yes, no hard tool limit, llama4_pythonic format, tool defs count as input. See Scout table above.

#### Skills / Context

Same as Scout: no skills, no memory. Prompt caching via vLLM/SGLang serving stack. System prompt overhead operator-controlled.

#### Cost

| Field | Value |
|---|---|
| Billing unit | Compute (self-hosted GPU) |
| Input price | No vendor price. Tier-3 ref: Groq ~$0.50/M, Fireworks/DeepInfra ~$0.15/M |
| Output price | No vendor price. Tier-3 ref: Groq ~$0.77/M, Fireworks/DeepInfra ~$0.60/M |

> Maverick is more expensive than Scout at hosted inference providers due to larger model size.

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | `https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct` | High |
| License | Llama 4 Community License | High |
| Params | 17B active / 400B total (MoE: 128 experts, alternating MoE+dense layers) | High |
| Config `max_position_embeddings` | 1,048,576 | Medium |
| Max context documented | 1,048,576 (1M) | High |
| Quantization | BF16 + FP8 quantized weights (fits single H100 DGX host at FP8) | High |
| Serving frameworks | vLLM (v0.8.3+, recommended), SGLang, TGI (maintenance), HF Transformers | High |

**Notes:** Co-distilled from Llama 4 Behemoth. FP8 quantized checkpoint recommended for production. On 8×H100, practical context is ~430K; full 1M requires 8×H200. Tool calling setup same as Scout with `llama4_pythonic` parser.

---

### 3. Llama 4 Behemoth (288B×16E)

**HF ID:** Not yet published  
**Status:** PREVIEW (announced but weights not released) | **Announced:** 2025-04-05 | **Weights status:** Unreleased as of 2026-06-21

> **Important:** Behemoth weights have NOT been publicly released. Meta described it as "still training" at the April 2025 launch. As of 2026-06-21 no weights are available on HuggingFace or llama.com. The model is used internally as a teacher for Scout/Maverick codistillation. All fields below are low-confidence or null unless sourced from the launch announcement.

#### Context Window

| Field | Value | Confidence |
|---|---|---|
| Context window | Unknown — not documented | Low |
| Max input / output | Not documented | Low |
| Base model context | Not documented | Low |

#### Tokenization

| Field | Value | Confidence |
|---|---|---|
| Tokenizer family | Inferred: tiktoken BPE O200K pattern (family tokenizer) | Medium |
| Tokenizer public | No (weights unreleased) | High |
| Count tokens method | Use Llama 4 Scout/Maverick tokenizer as proxy | Medium |

#### Tools / MCP

| Field | Value | Confidence |
|---|---|---|
| Function calling | Expected Yes (family consistency) | Low |
| Native MCP | Expected No | Medium |
| All other tool fields | Unknown — weights unreleased | Low |

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | None — not released | High |
| License | Expected Llama 4 Community License | Medium |
| Params | 288B active / ~2T total (announced) | Medium |
| Serving frameworks | N/A — not released | High |

---

## Takeaways for the Recommender

### When to pick Llama 4 Scout

- **Largest open-weight context window available:** 10M token native context (iRoPE architecture). For MCP servers with very large tool footprints or long-running sessions, Scout's window is essentially unlimited for practical purposes.
- **Footprint headroom:** Tool definitions at 100K tokens would be ~1% of the 10M window (vs. ~40% of a 256K window). The recommender should flag Scout as having essentially no footprint concern for any realistic MCP server.
- **Single-GPU deployable:** On-the-fly int4 quantization fits a single H100. Accessible to individual developers and small teams.
- **Practical limit on 8×H100:** ~1M tokens (still enormous). Recommend planning deployments around 1M unless multi-node is available.

### When to pick Llama 4 Maverick

- **Best capability:footprint ratio** for 1M-context workloads. Co-distilled from Behemoth, so stronger on benchmarks than Scout.
- **FP8 on single DGX host:** A single 8×H100 server runs Maverick at full 1M context (FP8). Practical production target.
- **Higher hosted inference cost** than Scout (~4–5× input price on Groq). For high-volume use cases, self-hosting is more cost-effective.

### When NOT to pick Llama 4 Behemoth

- Do not plan production systems around Behemoth until weights are publicly released. All specs are unconfirmed. The model is only useful as a reference for what Meta's internal capability ceiling looks like.

### Tool-calling / MCP architecture notes

- **No native MCP.** To use Llama 4 with MCP-based tools: serialize MCP tool definitions as OpenAI function JSON, serve via vLLM with `--tool-call-parser llama4_pythonic`, and the endpoint accepts them transparently.
- **Parallel tool calls are supported** (Llama 4 improvement over Llama 3). Multi-tool agentic workflows are practical.
- **No hard tool count limit.** With 10M+ context, tool definition footprint is rarely the binding constraint (compare: 55K tokens of tool defs = 0.5% of Scout's window).
- **Prefix caching matters for sessions:** vLLM prefix caching or SGLang RadixAttention can eliminate repeated tool-definition token cost across turns. Critical for high-turn agentic sessions.

### Cost profile

- **Self-hosted compute only.** No vendor per-token pricing.
- **Scout is cheapest** to host (single H100 int4) and cheapest at hosted APIs (~$0.11/M input on Groq).
- **Maverick costs 4–5× more** at hosted APIs but offers better benchmark performance.
- For token-cost estimation in the MCP footprint tool, use the family tokenizer (tiktoken BPE, O200K pattern) directly — it is public and produces exact counts.

### Tokenizer note for MCP footprint tool

Both Scout and Maverick use the **same tokenizer** (`tokenizer.py` in the llama-models repo). You can count tokens locally using `AutoTokenizer.from_pretrained('meta-llama/Llama-4-Scout-17B-16E-Instruct')` (requires HF login and license acceptance). The O200K_PATTERN means tool JSON serializations tokenize very similarly to GPT-4o output — slightly different from `o200k_base` due to special tokens but close enough for rough estimates.

---

## Sources

1. [Llama 4 HF Model Card (Maverick)](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E) — official specs table, license, release date, knowledge cutoff
2. [Llama 4 Scout HF Model Card](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct) — Instruct model
3. [Welcome Llama 4 — HuggingFace Blog](https://huggingface.co/blog/llama4-release) — architecture details (iRoPE, chunked attention, NoPE), context lengths, tokenizer
4. [Llama 4 in vLLM — vLLM Blog](https://blog.vllm.ai/2025/04/05/llama4.html) — serving configs, practical context limits per hardware
5. [Meta AI Blog — Llama 4 Launch](https://ai.meta.com/blog/llama-4-multimodal-intelligence/) — Behemoth announcement, Scout/Maverick overview
6. [meta-llama/llama-models tokenizer.py](https://github.com/meta-llama/llama-models/blob/main/models/llama4/tokenizer.py) — tiktoken BPE, O200K_PATTERN, vocab size, special tokens
7. [vLLM Tool Calling Docs](https://docs.vllm.ai/en/latest/features/tool_calling/) — llama4_pythonic parser, parallel tool calls
8. [llama.com — Llama 4 Models](https://www.llama.com/models/llama-4/) — product overview
9. [llm-stats.com — Llama 4 Scout](https://llm-stats.com/models/llama-4-scout) — Tier-3 aggregator: max output 16,384, hosted pricing
10. [OpenRouter — Llama 4 Maverick](https://openrouter.ai/meta-llama/llama-4-maverick) — Tier-3: max output, pricing
11. [Behemoth status — Serenities AI](https://serenitiesai.com/articles/llama-4-behemoth-maverick-scout-review-2026) — Tier-3: Behemoth unreleased as of 2026
12. [HF Discussion — Max Output Tokens](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct/discussions/46) — community discussion on undocumented max output
13. [HF Discussion — config.json comparison](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct/discussions/42) — Scout config.json max_position_embeddings
14. [tokencost.app — Scout vs Maverick pricing](https://tokencost.app/blog/llama-4-scout-vs-maverick-api-pricing) — Tier-3: hosted inference pricing reference
