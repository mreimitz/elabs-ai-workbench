# Microsoft Phi — Open-Weight Provider Profile

> **Group:** open_weight | **As of:** 2026-06-21 | **Source JSON:** `data/open-weight/microsoft-phi.json`

## Provider Summary

Microsoft Phi is a family of small language models (SLMs) designed for edge, mobile, and latency-constrained environments. The Phi-4 generation (released Dec 2024 – Feb 2025) covers three distinct points in the capability-footprint tradeoff: a 14B text-focused reasoning model (Phi-4), a 3.8B multilingual model with native function calling (Phi-4-mini), and a 5.6B multimodal model handling text+vision+audio (Phi-4-multimodal).

**MCP/Tools posture:** Phi-4 (base) does not support function calling (Azure Foundry: "Tool calling: No"). Phi-4-mini and Phi-4-multimodal both document a custom function-calling format injecting JSON tool definitions in the system prompt via `<|tool|>` tokens. No native MCP protocol at model level — MCP requires serving-stack wrappers.

**Tokenizer:** Phi-4 uses a tiktoken o200k_base-derived tokenizer (GPT2Tokenizer class, vocab 100352) — countable locally with `tiktoken` or HF `AutoTokenizer`. Phi-4-mini and Phi-4-multimodal use a 200K-vocabulary tokenizer aligned to `Xenova/gpt-4o` (o200k_base extended with Phi-4-specific special tokens including tool call tokens).

**Key differentiator for MCP footprint:** Phi-4 has a **16K context window** — the smallest in this open-weight comparison. A typical MCP server's tool definitions can consume 30-100% of this window. Phi-4-mini and Phi-4-multimodal extend to **128K** via LongRoPE, providing far more headroom, but their small parameter counts mean tool-selection reliability degrades earlier than larger models.

---

## Models

### 1. Phi-4 (`microsoft/phi-4`)

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | **16,384 tokens** | high | [config.json](https://huggingface.co/microsoft/phi-4/raw/main/config.json) |
| Input/output shared pool | true | high | [MS Foundry docs](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners) |
| Max input tokens | 16,384 | high | MS Foundry docs |
| Max output tokens (max) | 16,384 | high | MS Foundry docs |
| Extended context | null (none documented) | high | config.json (rope_scaling=null) |
| Reasoning tokens | N/A (not a reasoning model) | high | HF model card |

**Note:** Native config: `max_position_embeddings=16384`, `rope_scaling=null`, `rope_theta=250000`. No LongRoPE extension. This is a hard ceiling for the model.

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | tiktoken o200k_base-derived (GPT2Tokenizer, vocab 100352) | high | [tokenizer_config.json](https://huggingface.co/microsoft/phi-4/raw/main/tokenizer_config.json) |
| Tokenizer public | true | high | HF model card |
| Tokenizer access | `AutoTokenizer.from_pretrained("microsoft/phi-4")` | high | HF model card |
| Count method | `len(AutoTokenizer.from_pretrained("microsoft/phi-4").encode(text))` | high | HF |
| Image tokens | N/A (text-only) | high | HF model card |
| Audio tokens | N/A (text-only) | high | HF model card |
| Chars/token estimate | ~3.5 (English, rough) | medium | Tier-3 estimate |

#### Tools / MCP

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | **false** | medium | [MS Foundry docs](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners) (Tool calling: No) |
| Native MCP | false | high | HF model card |
| Parallel tool calls | null (undocumented) | low | — |
| Max tools (hard) | null | high | HF model card |
| Max tools (practical) | ~5 (Tier-4 estimate) | low | Tier-4; 16K window is the real constraint |
| Tool definition shape | openai_function (via serving stack, not native) | medium | vLLM/OpenAI-compat |
| Tool defs count as input | true | high | general principle |
| Tool search deferral | false | high | HF model card |

**CRITICAL:** At 16K total, even 3-5 verbose MCP tool definitions (200-500 tokens each) can consume 15-50% of the window, leaving little headroom for user messages and output. Phi-4 is not recommended for any MCP workload with non-trivial tool footprints.

#### Skills / Context

| Field | Value |
|---|---|
| Skills supported | false |
| Prompt caching | false at model level (operator can enable vLLM prefix caching) |
| Memory feature | false |
| System prompt overhead | Minimal special tokens (`<\|im_start\|>`, `<\|im_sep\|>`, `<\|im_end\|>`) |

#### Cost (Self-host)

| Field | Value | Notes |
|---|---|---|
| Input price | null (compute) | Open weights; Azure Foundry serverless: $- (free tier as of 2026-06-21) |
| Output price | null (compute) | Same |
| Billing unit | compute | GPU/cloud operator cost |

#### Self-host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | https://huggingface.co/microsoft/phi-4 | high | HF |
| License | **MIT** | high | HF model card |
| Parameters | 14B dense decoder-only Transformer (BF16) | high | HF model card |
| Native context (config.json) | **16,384** (`max_position_embeddings`) | high | config.json |
| Max documented context | **16,384** | high | HF model card |
| Serving frameworks | vLLM, SGLang, HF Transformers, Ollama (GGUF), ONNX Runtime, Docker Model Runner | high | HF model card |

---

### 2. Phi-4-mini-instruct (`microsoft/Phi-4-mini-instruct`)

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | **131,072 tokens (128K)** | high | [config.json](https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/config.json) |
| Input/output shared pool | true | high | [MS Foundry docs](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners) |
| Max input tokens | 131,072 | high | MS Foundry docs |
| Max output tokens (max) | **4,096** (Azure Foundry; self-hosted: operator-set) | high | MS Foundry docs |
| Extended context | null (128K is the native max) | high | config.json |
| Reasoning tokens | N/A | high | HF model card |

**Note:** LongRoPE scaling from `original_max_position_embeddings=4096` to `max_position_embeddings=131072` via longrope scaling factors.

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | GPT2Tokenizer / o200k_base-aligned, vocab 200,064 | high | [tokenizer_config.json](https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/tokenizer_config.json) |
| Tokenizer public | true | high | HF model card |
| Tokenizer access | `AutoTokenizer.from_pretrained("microsoft/Phi-4-mini-instruct", trust_remote_code=True)` | high | HF |
| Count method | HF AutoTokenizer as above | high | HF |
| Image tokens | N/A (text-only) | high | HF model card |
| Audio tokens | N/A (text-only) | high | HF model card |
| Chars/token estimate | ~3.5 (English) | medium | Tier-3 |

#### Tools / MCP

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | **true** | high | [HF model card](https://huggingface.co/microsoft/Phi-4-mini-instruct) |
| Native MCP | false | high | HF model card |
| Parallel tool calls | null (undocumented) | low | — |
| Max tools (hard) | null | high | HF model card |
| Max tools (practical) | ~20 (Tier-4 estimate) | low | Tier-4 |
| Tool definition shape | `phi4_mini_tool_format` — JSON array in system prompt wrapped by `<\|tool\|>...<\|/tool\|>` | high | HF model card + tokenizer_config.json |
| Tool defs count as input | true | high | general + model card |
| Tool search deferral | false | high | HF model card |

**Tool format example:**
```
<|system|>You are a helpful assistant.<|tool|>[{"name": "get_weather", "description": "...", "parameters": {...}}]<|/tool|><|end|>
<|user|>What's the weather in Paris?<|end|><|assistant|>
```

**Caution:** Model card red-team testing notes the model can "hallucinate function names or URLs" in function-calling scenarios. 3.8B parameter count limits reliable selection from large tool sets.

#### Skills / Context

| Field | Value |
|---|---|
| Skills supported | false |
| Prompt caching | false at model level (vLLM prefix caching can reuse static system prompt + tool defs KV-cache) |
| Memory feature | false |
| System prompt overhead | `<\|system\|>...<\|tool\|>[JSON]<\|/tool\|><\|end\|>` — tool JSON counts as input tokens |

#### Cost (Self-host)

| Field | Value | Notes |
|---|---|---|
| Input price | null (compute) | Azure Foundry: $- (free tier as of 2026-06-21) |
| Output price | null (compute) | Same |
| Billing unit | compute | GPU/cloud operator cost |

#### Self-host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | https://huggingface.co/microsoft/Phi-4-mini-instruct | high | HF |
| License | **MIT** | high | HF model card |
| Parameters | 3.8B dense decoder-only (BF16; 200K vocab, GQA, shared embeddings) | high | HF model card |
| Native context (config.json) | **131,072** (`max_position_embeddings`; LongRoPE from 4,096) | high | config.json |
| Max documented context | **131,072 (128K)** | high | HF model card |
| Serving frameworks | vLLM (>=0.7.3), SGLang, HF Transformers (>=4.49.0), Ollama (GGUF), ONNX Runtime, Docker Model Runner | high | HF model card |

**Serving note:** Requires `trust_remote_code=True` and `flash_attn==2.7.4.post1` for GPU serving.

---

### 3. Phi-4-multimodal-instruct (`microsoft/Phi-4-multimodal-instruct`)

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | **131,072 tokens (128K)** | high | [config.json](https://huggingface.co/microsoft/Phi-4-multimodal-instruct/raw/main/config.json) |
| Input/output shared pool | true | high | [MS Foundry docs](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners) |
| Max input tokens | 131,072 (text + image + audio combined) | high | MS Foundry docs |
| Max output tokens (max) | **4,096** (Azure Foundry) | high | MS Foundry docs |
| Extended context | null (128K native max) | high | config.json |
| Reasoning tokens | N/A | high | HF model card |

**IMPORTANT:** Image and audio tokens consume from the same 128K shared pool as text and tool definitions. High-res images can consume hundreds to thousands of tokens.

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | GPT2Tokenizer / o200k_base-aligned, vocab 200,064 (shared with Phi-4-mini) | high | config.json |
| Tokenizer public | true | high | HF model card |
| Tokenizer access | `AutoTokenizer.from_pretrained("microsoft/Phi-4-multimodal-instruct", trust_remote_code=True)` | high | HF |
| Image token rule | Dynamic HD transform (avg_pool_2d), up to ~3,600 visual tokens/image depending on resolution | medium | config.json (`embd_layer.image_embd_layer`) |
| Audio token rule | ~12-13 tokens/second of audio (Cascades encoder, time_reduction=8, 80-dim mel) | medium | config.json (`audio_processor.config`) |
| Chars/token estimate | ~3.5 for text tokens | medium | Tier-3 |

#### Tools / MCP

| Field | Value | Confidence | Source |
|---|---|---|---|
| Function calling | **true** (in model; Azure Foundry hosted: No) | high | HF model card |
| Native MCP | false | high | HF model card |
| Max tools (hard) | null | high | HF model card |
| Max tools (practical) | ~15 (Tier-4 estimate) | low | Tier-4; reduced by image/audio token consumption |
| Tool definition shape | `phi4_mini_tool_format` (same as Phi-4-mini) | high | HF model card |
| Tool defs count as input | true | high | general + model card |
| Tool search deferral | false | high | HF model card |

**MCP footprint note:** Tool definitions + image tokens + audio tokens all share the 128K budget. A multimodal session with tool use must budget: (tool defs tokens) + (image tokens per request) + (audio tokens per request) + (conversation history) + (output). This requires careful per-session capacity planning.

#### Skills / Context

| Field | Value |
|---|---|
| Skills supported | false |
| Prompt caching | false at model level (vLLM prefix caching limited — image/audio breaks prefix cache) |
| Memory feature | false |
| System prompt overhead | Same `<\|system\|>/<\|tool\|>` template as Phi-4-mini; multimodal adds `<\|image_N\|>` and `<\|audio_N\|>` placeholders |

#### Cost (Self-host)

| Field | Value | Notes |
|---|---|---|
| Input price | null (compute) | Azure Foundry: $- (free tier). Two SKUs: text+image and audio, both $- as of 2026-06-21 |
| Output price | null (compute) | Same |
| Billing unit | compute | GPU/cloud operator cost; multimodal tokens increase per-request compute |
| Multimodal billing | Image tokens (HD transform, up to ~3,600/image) + audio tokens (~12-13/sec) increase compute cost | — |

#### Self-host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | https://huggingface.co/microsoft/Phi-4-multimodal-instruct | high | HF |
| License | **MIT** | high | HF model card |
| Parameters | 5.6B (3.8B language backbone + vision encoder + audio encoder; vision LoRA r=256, speech LoRA r=320) | high | HF model card + config.json |
| Native context (config.json) | **131,072** (LongRoPE from 4,096) | high | config.json |
| Max documented context | **131,072 (128K)** | high | HF model card |
| Serving frameworks | vLLM (>=0.7.3), HF Transformers (>=4.48.2, trust_remote_code=True), ONNX Runtime, Azure AI Studio | high | HF model card |

**Serving notes:** Requires `trust_remote_code=True` (custom `modeling_phi4mm.py`), `flash_attention_2` (hardcoded in config), and Python 3.10. Tested on A100/A6000/H100.

---

## Takeaways for the Recommender

### When to use Phi models

**Phi-4 (14B, 16K window):**
- Use for latency-constrained pure-text tasks where no MCP tools are needed, or tool footprint is extremely minimal (1-2 small tool definitions, under 2K tokens total).
- **Do not use** for any MCP server with more than ~5 tools or verbose tool schemas. The 16K window means even a modest MCP server footprint (10-20 tools at 200 tokens each = 2-4K tokens) consumes 12-25% of the window before any user message.
- Best GPU memory profile: fits in 28-32GB VRAM at BF16 (14B × 2 bytes); quantized to Q4 fits in ~8GB.

**Phi-4-mini-instruct (3.8B, 128K window):**
- The best Phi choice for MCP/tool use. Officially supports function calling. 128K window means tool definitions rarely constrain the session.
- However, 3.8B parameters means tool-selection accuracy degrades with large tool sets. Recommend capping loaded MCP tools at ~15-20 for reliable results.
- Edge/device deployment: fits in ~4GB VRAM at BF16, ~2GB quantized.
- **Caution:** Hallucination of function names/URLs was observed in red-team testing.

**Phi-4-multimodal-instruct (5.6B, 128K window):**
- The right choice when the use case requires vision (images) or audio alongside tool calls. Same 128K window as mini, with shared budget for all modalities.
- Each image can consume hundreds to thousands of tokens — budget carefully.
- For text-only MCP use, Phi-4-mini is preferred (simpler serving, no trust_remote_code requirement, slightly fewer parameters).

### Context window headroom (MCP footprint)

| Model | Window | Available for tools/context after minimal overhead |
|---|---|---|
| Phi-4 | 16K | ~15,000 tokens — **extremely tight; 1-2 MCP servers max** |
| Phi-4-mini | 128K | ~127,000 tokens — **comfortable for most MCP servers** |
| Phi-4-multimodal | 128K | ~127,000 tokens (text-only); reduced by image/audio tokens |

### Cost profile

All three models are open-weight (MIT license). Cost is entirely operator compute. Azure AI Foundry serverless pricing shows "$-" (free tier) as of 2026-06-21, making them free to evaluate before committing to self-hosted infrastructure.

### Tokenizer for the footprint tool

- **Phi-4:** `AutoTokenizer.from_pretrained("microsoft/phi-4")` — or approximate with `tiktoken.get_encoding("o200k_base")` (base vocab is identical).
- **Phi-4-mini / Phi-4-multimodal:** `AutoTokenizer.from_pretrained("microsoft/Phi-4-mini-instruct", trust_remote_code=True)` — 200K vocab; o200k_base base with Phi-4-specific tool-call tokens.

---

## Sources

1. [microsoft/phi-4 — HuggingFace Model Card](https://huggingface.co/microsoft/phi-4)
2. [microsoft/phi-4 — config.json](https://huggingface.co/microsoft/phi-4/raw/main/config.json)
3. [microsoft/phi-4 — tokenizer_config.json](https://huggingface.co/microsoft/phi-4/raw/main/tokenizer_config.json)
4. [microsoft/Phi-4-mini-instruct — HuggingFace Model Card](https://huggingface.co/microsoft/Phi-4-mini-instruct)
5. [microsoft/Phi-4-mini-instruct — config.json](https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/config.json)
6. [microsoft/Phi-4-mini-instruct — tokenizer_config.json](https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/tokenizer_config.json)
7. [microsoft/Phi-4-multimodal-instruct — HuggingFace Model Card](https://huggingface.co/microsoft/Phi-4-multimodal-instruct)
8. [microsoft/Phi-4-multimodal-instruct — config.json](https://huggingface.co/microsoft/Phi-4-multimodal-instruct/raw/main/config.json)
9. [Microsoft Foundry — models-from-partners (Tier-1, Phi capabilities table)](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners) — updated 2026-06-08
10. [Azure AI Foundry Models Pricing — Microsoft models](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/)
11. [Phi-4 Technical Report (arXiv 2412.08905)](https://arxiv.org/abs/2412.08905)
12. [Phi-4-mini Technical Report (arXiv 2503.01743)](https://arxiv.org/abs/2503.01743)
13. [Microsoft Blog: Introducing Phi-4](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-phi-4-microsoft%E2%80%99s-newest-small-language-model-specializing-in-comple/4357090)
14. [Microsoft Blog: Phi-4-mini and Phi-4-multimodal](https://techcommunity.microsoft.com/blog/educatordeveloperblog/welcome-to-the-new-phi-4-models---microsoft-phi-4-mini--phi-4-multimodal/4386037)
15. [PhiCookBook — Function Calling with Phi-4-mini](https://github.com/microsoft/PhiCookBook/blob/main/md/02.Application/07.FunctionCalling/Phi4/FunctionCallingBasic/README.md)
