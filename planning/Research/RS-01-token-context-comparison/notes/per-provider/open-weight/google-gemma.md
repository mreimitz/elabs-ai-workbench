---
type: "Research Note"
title: "Google Gemma \u2014 Open-Weight Provider Profile"
description: "Group: Open-weight / client-managed"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Google Gemma — Open-Weight Provider Profile

> **Group:** Open-weight / client-managed
> **As of:** 2026-06-21
> **Models covered:** Gemma 4 31B Instruct, Gemma 4 12B Unified Instruct, Gemma 4 E4B Instruct

---

## Provider Summary

Google Gemma is the open-weight model family from Google DeepMind, built from the same research foundation as the proprietary Gemini models. Gemma 4 (released April 2, 2026) is the current generation and the first Gemma release under the Apache 2.0 license, making it freely usable for commercial applications.

**MCP / tool-calling posture:** Gemma 4 models do **not** speak the MCP wire protocol natively. They support function calling via a Gemma-native token format (`<|tool>declaration:...<tool|>` / `<|tool_call>call:...<tool_call|>`) injected by the HuggingFace chat template. MCP integration requires a serving-stack adapter (e.g. an MCP-to-OpenAI bridge in front of vLLM). Tool definitions count as input tokens. No deferred/lazy tool loading exists at the model level.

**Tokenizer:** SentencePiece BPE, 262,144-token vocabulary (shared architecture with Gemini). Public: yes — distributed with model weights on HuggingFace. Access: `AutoProcessor.from_pretrained()` via HuggingFace Transformers (≥5.5.0 for 31B/E4B; ≥5.10.1 for 12B Unified). Exact local counting is possible once weights are downloaded (license acceptance required).

**Skills:** No platform-level skills concept. All skill-like behavior is operator-implemented via system prompt or fine-tuning.

---

## Model Profiles

### Gemma 4 31B Instruct (`google/gemma-4-31B-it`)

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 262,144 tokens (256K) | High | config.json |
| Input + output shared pool | Yes | High | Model card |
| Max input | ≈ 262,144 (derived) | Medium | Derived |
| Max output default | Operator-set | Low | N/A (open-weight) |
| Max output max | Operator-set | Low | N/A (open-weight) |
| Extended context | None documented | High | Model card |
| Reasoning tokens as output | Yes (thinking mode) | Medium | Google Gemma docs |

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | SentencePiece BPE, 262K vocab | High | config.json |
| Tokenizer public | Yes (Apache 2.0) | High | HuggingFace |
| Tokenizer access | HF AutoProcessor (transformers ≥5.5.0) | High | HuggingFace |
| Count tokens method | Local tokenizer encode() | High | HF Transformers |
| Image token rule | 70–1120 tokens/image (configurable); default 280 | High | Model card |
| Audio token rule | N/A — 31B has no audio support | High | Model card |
| Chars/token estimate | ~4 | Medium | Tier-3 aggregator |

#### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | Yes | High | Gemma 4 native format |
| Native MCP | No | High | Requires serving-stack adapter |
| Parallel tool calls | Yes (in principle) | Medium | Multiple tool_responses per turn |
| Max tools (hard) | None documented | High | Context-budget limited |
| Max tools (practical) | ~20 | Low (Tier-4) | No published benchmark; general degradation pattern |
| Tool definition shape | `gemma4_function` (Gemma-native tokens) | High | Function calling guide |
| Tool defs count as input | Yes | High | Chat template injection |
| Tool search/deferral | No | Medium | Not supported |
| Max tool name length | Not documented | Low | — |

**Schema notes:** Tool declarations use the Gemma-native serialization (`<|tool>declaration:funcname{...}<tool|>`), not JSON. Complex nested schemas should be manually defined (documented caveat). The application must implement a custom parser for tool call responses.

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | High |
| Skills loading model | N/A | High |
| Prompt caching | No (vendor-managed); operator KV cache possible | Medium |
| Memory feature | No | High |

**System prompt:** Natively supported (new in Gemma 4). Tokens count as regular input.

#### Cost

| Field | Value | Notes |
|---|---|---|
| Input per MTok | null | Self-hosted compute |
| Output per MTok | null | Self-hosted compute |
| Cached input per MTok | null | Operator KV cache; not separately billed |
| Batch discount | null | N/A |
| Billing unit | compute | GPU/TPU operator cost |

#### Self-Host

| Field | Value | Confidence | Source |
|---|---|---|---|
| Weights URL | https://huggingface.co/google/gemma-4-31B-it | High | HuggingFace |
| License | Apache-2.0 | High | HuggingFace / Google |
| Param variants | 30.7B dense; also E2B, E4B, 12B, 26B A4B in family | High | Model card |
| Native context config (`max_position_embeddings`) | 262,144 | High | config.json |
| Max context documented | 262,144 (256K) | High | Model card |
| Serving frameworks | vLLM, SGLang, HF Transformers, llama.cpp/GGUF, Ollama, LM Studio, MLX, Keras, Vertex AI, GKE | High | HuggingFace |

**Framework tool-calling notes:** vLLM and SGLang expose an OpenAI-compatible API; the serving layer applies the Gemma 4 chat template. An MCP-to-OpenAI bridge (e.g. a proxy) is needed for MCP. The app must parse the Gemma-native `<|tool_call>` response format. Requires ~70GB VRAM at BF16; ~17.5GB at Q4_0.

---

### Gemma 4 12B Unified Instruct (`google/gemma-4-12B-it`)

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 262,144 tokens (256K) | High | config.json |
| Input + output shared pool | Yes | High | Model card |
| Max input | ≈ 262,144 (derived) | Medium | Derived |
| Max output default | Operator-set | Low | N/A (open-weight) |
| Max output max | Operator-set | Low | N/A (open-weight) |
| Extended context | None documented | High | Model card |
| Reasoning tokens as output | Yes (thinking mode) | Medium | Google Gemma docs |

#### Tokenization

| Field | Value | Confidence | Source |
|---|---|---|---|
| Tokenizer family | SentencePiece BPE, 262K vocab | High | config.json |
| Tokenizer public | Yes (Apache 2.0) | High | HuggingFace |
| Tokenizer access | HF AutoProcessor (transformers ≥5.10.1) | High | Function calling guide |
| Count tokens method | Local tokenizer encode() | High | HF Transformers |
| Image token rule | 70–1120 tokens/image; default 280 (encoder-free) | High | Model card + config.json |
| Audio token rule | 640 audio samples per token; max 30s audio | High | config.json |
| Chars/token estimate | ~4 | Medium | Tier-3 |

**Architecture note:** The 12B Unified model is encoder-free — raw image patches and audio waveforms are projected directly into the LLM embedding space via lightweight linear layers, with no separate encoder. This simplifies multimodal serving.

#### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | Yes | High | Same Gemma 4 native format |
| Native MCP | No | High | — |
| Parallel tool calls | Yes (in principle) | Medium | — |
| Max tools (hard) | None documented | High | — |
| Max tools (practical) | ~15 | Low (Tier-4) | Smaller than 31B; degrades sooner |
| Tool definition shape | `gemma4_function` | High | — |
| Tool defs count as input | Yes | High | — |
| Tool search/deferral | No | Medium | — |
| Max tool name length | Not documented | Low | — |

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | High |
| Prompt caching | No (vendor-managed); operator KV cache possible | Medium |
| Memory feature | No | High |

#### Cost

| Field | Value |
|---|---|
| Input per MTok | null (self-hosted compute) |
| Output per MTok | null (self-hosted compute) |
| Billing unit | compute |

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | https://huggingface.co/google/gemma-4-12B-it | High |
| License | Apache-2.0 | High |
| Param variants | 11.95B dense (unified encoder-free) | High |
| Native context config | 262,144 | High |
| Max context documented | 262,144 (256K) | High |
| Serving frameworks | vLLM, SGLang, HF Transformers (≥5.10.1), llama.cpp/GGUF, Ollama, LM Studio, MLX, Keras | High |

**Memory requirements:** ~26.7GB BF16; ~6.7GB Q4_0. More accessible for consumer hardware than 31B while retaining the full 256K context window.

---

### Gemma 4 E4B Instruct (`google/gemma-4-E4B-it`)

#### Context

| Field | Value | Confidence | Source |
|---|---|---|---|
| Context window | 131,072 tokens (128K) | High | config.json |
| Input + output shared pool | Yes | High | Model card |
| Max input | ≈ 131,072 (derived) | Medium | Derived |
| Max output default | Operator-set | Low | N/A |
| Max output max | Operator-set | Low | N/A |
| Extended context | None documented | High | Model card |
| Reasoning tokens as output | Yes (fully disableable on E2B/E4B) | Medium | Thinking docs |

#### Tokenization

| Field | Value | Confidence |
|---|---|---|
| Tokenizer family | SentencePiece BPE, 262K vocab | High |
| Tokenizer public | Yes (Apache 2.0) | High |
| Tokenizer access | HF AutoProcessor (transformers ≥5.5.0) | High |
| Count tokens method | Local tokenizer encode() | High |
| Image token rule | 70–1120 tokens/image; default 280 | High |
| Audio token rule | Dedicated encoder; max 30s; exact tokens/sec not documented | Medium |
| Chars/token estimate | ~4 | Medium |

#### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | Yes | High | Same Gemma 4 native format |
| Native MCP | No | High | — |
| Parallel tool calls | Yes (in principle) | Medium | — |
| Max tools (hard) | None documented | High | — |
| Max tools (practical) | ~10 | Low (Tier-4) | Small model + 128K window; accuracy degrades quickly with many tools |
| Tool definition shape | `gemma4_function` | High | — |
| Tool defs count as input | Yes | High | — |
| Tool search/deferral | No | Medium | — |
| Max tool name length | Not documented | Low | — |

**Schema notes:** Keep tool schemas minimal on E4B. Each declaration consumes budget on a 128K window. Recommend fewer than 10 tools with concise descriptions.

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | No | High |
| Prompt caching | No (vendor-managed); operator KV cache possible | Medium |
| Memory feature | No | High |

**Context budget warning:** At 128K, a system prompt + multiple tool definitions can represent a significant fraction of the window. Monitor total input token usage carefully for MCP-heavy sessions.

#### Cost

| Field | Value |
|---|---|
| Input per MTok | null (self-hosted compute) |
| Output per MTok | null (self-hosted compute) |
| Billing unit | compute |

**Mobile note:** Designed for on-device deployment. Memory as low as 2.5GB (mobile full, LiteRT-LM) or 4.5GB (Q4_0 server).

#### Self-Host

| Field | Value | Confidence |
|---|---|---|
| Weights URL | https://huggingface.co/google/gemma-4-E4B-it | High |
| License | Apache-2.0 | High |
| Param variants | 4.5B effective / 8B total (Per-Layer Embeddings) | High |
| Native context config | 131,072 | High |
| Max context documented | 131,072 (128K) | High |
| Serving frameworks | vLLM, HF Transformers, llama.cpp/GGUF, Ollama, LM Studio, LiteRT-LM (mobile), MLX, MediaPipe | High |

---

## Takeaways for the Recommender

### When to pick Gemma models

- **Budget-conscious deployments**: Open-weight + Apache 2.0 (Gemma 4) means zero per-token cost. Ideal when GPU budget is available but API spend is a concern.
- **Privacy / on-premises requirements**: Weights run fully on operator hardware; no data leaves the deployment environment.
- **Large context needs with reasonable hardware**: Both 31B and 12B offer 256K context windows — larger than many hosted providers — at operator-controlled compute cost.
- **Edge / mobile scenarios**: E4B with 128K context and 2.5–4.5GB memory footprint is the only production-ready edge LLM in this dataset.

### Footprint headroom

| Model | Context Window | Practical Tool Budget | Notes |
|---|---|---|---|
| Gemma 4 31B | 256K (262,144) | ~20 tools (Tier-4 est.) | Large window; strong reasoning |
| Gemma 4 12B | 256K (262,144) | ~15 tools (Tier-4 est.) | Same window, fewer params |
| Gemma 4 E4B | 128K (131,072) | ~10 tools (Tier-4 est.) | Edge/mobile; degrade sooner |

A typical MCP server with ~50 tools and moderate descriptions may consume 20,000–40,000 input tokens. For 31B/12B that is 8–15% of the 256K window — comfortable. For E4B that is 15–30% of the 128K window — tight, and model capability at scale is the primary constraint.

### Cost profile

All three models bill as self-hosted compute. There are no per-token costs. Total session cost is dominated by:
1. GPU/TPU hour cost for the operator's hardware
2. Token volume (drives compute time, not billing line items)
3. No separate reasoning-token surcharge

### Tool-calling caveats

- **No native MCP**: An adapter layer (MCP-to-OpenAI proxy) is required in all serving stacks.
- **Gemma-native format**: Tool declarations use a non-JSON serialization (`<|tool>declaration:...<tool|>`). Operators must ensure their serving stack applies the correct chat template and implement a custom parser for responses.
- **Smaller models degrade faster**: The ~10–15 tool practical limits for E4B and 12B are informed estimates (Tier-4); no Gemma-specific benchmark exists. Prefer 31B for tool-heavy MCP sessions.
- **No tool deferral**: All tools must be present at inference time; tool set size cannot be dynamically reduced mid-session at the model level.
- **Schema complexity**: Auto-generated Python function schemas may miss nested properties. For complex tools, manually define the JSON schema (documented caveat).

### Prompt caching

No Google-managed prompt caching for self-hosted Gemma. Operators can configure vLLM prefix caching or SGLang RadixAttention for KV cache reuse of static prefixes (system prompt + tool definitions). This can significantly reduce compute for multi-turn sessions.

### License note

- **Gemma 4** (all sizes): Apache 2.0 — OSI-approved, commercial use permitted without restrictions.
- **Gemma 1, 2, 3**: Custom "Gemma Terms of Use" — permits commercial use but includes a Prohibited Use Policy and requires license notice propagation. Not OSI open-source. (These models are not covered in this profile but users migrating from Gemma 3 should be aware of the license change.)

---

## Sources

- [Google AI for Developers — Gemma 4 Model Card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Google AI for Developers — Gemma 4 Overview](https://ai.google.dev/gemma/docs/core)
- [Google AI for Developers — Function calling with Gemma 4](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
- [Google AI for Developers — Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- [Google AI for Developers — Gemma 4 Apache 2.0 License](https://ai.google.dev/gemma/apache_2)
- [Google Blog — Gemma 4 Launch](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Google Blog — Introducing Gemma 4 12B Unified](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/)
- [HuggingFace — google/gemma-4-31B-it](https://huggingface.co/google/gemma-4-31B-it)
- [HuggingFace — google/gemma-4-12B-it](https://huggingface.co/google/gemma-4-12B-it)
- [HuggingFace — google/gemma-4-E4B-it](https://huggingface.co/google/gemma-4-E4B-it)
- [HuggingFace — config.json for gemma-4-31B-it](https://huggingface.co/google/gemma-4-31B-it/resolve/main/config.json)
- [HuggingFace — config.json for gemma-4-12B-it](https://huggingface.co/google/gemma-4-12B-it/resolve/main/config.json)
- [HuggingFace — config.json for gemma-4-E4B-it](https://huggingface.co/google/gemma-4-E4B-it/resolve/main/config.json)
- [HuggingFace Blog — Welcome Gemma 4](https://huggingface.co/blog/gemma4)

# Citations

None.
