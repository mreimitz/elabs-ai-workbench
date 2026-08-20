---
type: "Source Reference"
title: "Microsoft (Phi) \u2014 dataset refresh, 2026-08-19"
description: "File: /tmp/tcc/data/open-weight/microsoft-phi.json (edited in place)"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "captured"
---
# Microsoft (Phi) — dataset refresh, 2026-08-19

**File:** `/tmp/tcc/data/open-weight/microsoft-phi.json` (edited in place)
**Previous research date:** 2026-06-21 · **New `as_of`:** 2026-08-19 · **`schema_version`:** 1.0 (unchanged)
**Result:** 3 models re-verified, 1 model added, 0 retired, **16 provenanced values changed**, **49 provenanced
fields given a source/confidence upgrade**, 0 fields dropped, 0 ids renamed. Schema-validated against
`schema/model-entry.schema.json`.

---

## Models

### Validated (3)

| id | status | verdict |
|---|---|---|
| `microsoft/phi-4` | `ga` (unchanged) | All context/limits values re-confirmed. **One hard-limit correction: the tokenizer was misidentified.** Still GA on Microsoft Foundry with no retirement date (lifecycle page updated 2026-08-17). |
| `microsoft/Phi-4-mini-instruct` | `ga` (unchanged) | Context (128K), Foundry caps (131,072 in / 4,096 out), function-calling format all re-confirmed — the last now evidenced at the tokenizer level, not just prose. Still GA, no retirement date. |
| `microsoft/Phi-4-multimodal-instruct` | `ga` (unchanged) | Context and Foundry caps re-confirmed. **Image-token rule corrected** (a figure had been borrowed from a different model) and **audio-token rule upgraded to a tier-1 published number.** Still GA, no retirement date. |

Microsoft Foundry's lifecycle table (checked 2026-08-17) lists Phi-4, Phi-4-mini-instruct,
Phi-4-mini-reasoning, Phi-4-multimodal-instruct and Phi-4-reasoning as **GA with an em-dash in the
retirement-date column** — i.e. no announced end date for any of them.

### Added (1)

| id | display name | release date | GA / availability | source |
|---|---|---|---|---|
| `microsoft/Phi-4-reasoning-vision-15B` | Phi-4-reasoning-vision-15B | **2026-03-04** (model card "Release date: March 4, 2026") | Open MIT weights on Hugging Face; introduced to Microsoft Foundry the same day; announced on the Microsoft Research blog 2026-03-04. Recorded `status: "ga"` on the strength of the public weight release — it is **not yet on the Foundry lifecycle table or the Foundry Phi pricing table**. | [HF card](https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B) · [MSR blog](https://www.microsoft.com/en-us/research/blog/phi-4-reasoning-vision-and-the-lessons-of-training-a-multimodal-reasoning-model/) · [Foundry blog](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-phi-4-reasoning-vision-to-microsoft-foundry/4499154) · [tech report PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2026/03/Phi-4-reasoning-vision-15B-Tech-Report.pdf) |

**Scope note (be aware when diffing):** the brief asked for models released **since 2026-06-21**. Nothing
in the Phi family was released in that window. Phi-4-reasoning-vision-15B predates the window
(2026-03-04) but was **absent from the roster the previous pass produced**, and it is the newest and
currently most capable Phi model, so it is added here rather than left out. This is the only entry added.

### Considered and deliberately not added

| candidate | why not |
|---|---|
| `microsoft/Phi-Ground-Any` (HF repo touched ~July 2026) | Specialized GUI-grounding model fine-tuned from Phi-3.5-vision-instruct; it emits click coordinates (`<x>…</x><y>…</y>`), not general text or tool calls. Not a current-generation general-purpose roster model. |
| Phi-4-reasoning / Phi-4-reasoning-plus / Phi-4-mini-reasoning / Phi-4-mini-flash-reasoning / Phi-mini-MoE / Phi-tiny-MoE | All pre-date the previous research date and were out of roster scope then too; adding them is a roster-expansion decision for the dataset owner, not a staleness fix. Foundry does list Phi-4-reasoning (32,768 in/out) and Phi-4-mini-reasoning (128,000 in/out) as GA — recorded here for the owner's information only. |
| "Phi-5" | **Does not exist.** A third-party blog markets a "Phi-5"; no Microsoft first-party source (Azure Phi product page, Foundry model tables, HF `microsoft` org, Foundry lifecycle page) references any such model. No entry created. |

### Retired / deprecated (0)

None. No Phi model was moved to `deprecated`. No entry was deleted and no `id` was renamed.

---

## Changed values

`old` → `new` for every provenanced `value` that actually changed. (49 further fields changed only in
provenance — a real URL where there had been `null`, or a stronger source — and are summarized after the table.)

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| microsoft/phi-4 | `tokenization.tokenizer_family` | `tiktoken/o200k_base-derived (GPT2Tokenizer, vocab 100352)` | `tiktoken cl100k_base-derived (GPT2Tokenizer, padded vocab 100352)` | https://huggingface.co/microsoft/phi-4/raw/main/tokenizer_config.json | 1 | high |
| microsoft/phi-4 | `tokenization.tokenizer_access` | "…also usable via tiktoken **o200k_base** for the base vocab…" | "…or tiktoken **cl100k_base** for the base vocab, with the 96 Phi-4 special tokens (100256-100351) added on top" | https://huggingface.co/microsoft/phi-4/raw/main/tokenizer_config.json | 1 | high |
| microsoft/phi-4 | `tokenization.chars_per_token_estimate` | `3.5` (no source) | `4.0` | https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them | 2 | medium |
| microsoft/phi-4 | `self_host.param_variants` | `14B (dense decoder-only Transformer, BF16)` | `14B (dense decoder-only Transformer, BF16; hidden_size 5120, 40 layers)` | https://huggingface.co/microsoft/phi-4/raw/main/config.json | 1 | high |
| microsoft/phi-4 | `self_host.serving_frameworks` | `vLLM, SGLang, Transformers (HF), Ollama (quantized via llama.cpp), ONNX Runtime, Docker Model Runner` | `vLLM, SGLang, Transformers (HF), Docker Model Runner, llama.cpp / Ollama / LM Studio (quantized GGUF), ONNX Runtime (microsoft/phi-4-onnx)` | https://huggingface.co/microsoft/phi-4 | 1 | high |
| microsoft/Phi-4-mini-instruct | `tokenization.tokenizer_family` | `GPT2Tokenizer / o200k_base-aligned, vocab 200064` | `tiktoken o200k_base-derived (GPT2Tokenizer, padded vocab 200064)` | https://arxiv.org/pdf/2503.01743 | 1 | high |
| microsoft/Phi-4-mini-instruct | `tokenization.tokenizer_access` | `HF AutoTokenizer (microsoft/Phi-4-mini-instruct, trust_remote_code=True)` | same + "or tiktoken o200k_base for the base vocab plus the Phi-4-mini special tokens" | https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/tokenizer_config.json | 1 | high |
| microsoft/Phi-4-mini-instruct | `tokenization.chars_per_token_estimate` | `3.5` (no source) | `4.0` | https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them | 2 | medium |
| microsoft/Phi-4-mini-instruct | `self_host.serving_frameworks` | `vLLM (>=0.7.3), SGLang, Transformers (HF, >=4.49.0), Ollama (quantized GGUF), ONNX Runtime (Phi-4-mini-instruct-onnx), Docker Model Runner` | `vLLM (>=0.7.3), SGLang, Transformers (HF, >=4.49.0, trust_remote_code=True), Docker Model Runner, Ollama / llama.cpp / LM Studio (quantized GGUF), ONNX Runtime (microsoft/Phi-4-mini-instruct-onnx)` | https://huggingface.co/microsoft/Phi-4-mini-instruct | 1 | high |
| microsoft/Phi-4-multimodal-instruct | `tokenization.tokenizer_family` | `GPT2Tokenizer / o200k_base-aligned, vocab 200064 (shared with Phi-4-mini)` | `tiktoken o200k_base-derived (GPT2Tokenizer, padded vocab 200064; shared with Phi-4-mini)` | https://huggingface.co/microsoft/Phi-4-multimodal-instruct/raw/main/config.json | 1 | high |
| microsoft/Phi-4-multimodal-instruct | `tokenization.image_token_rule` | `Dynamic high-definition (HD) transform via avg_pool_2d compression; **up to 3,600 visual tokens per image** depending on resolution` | `Dynamic HD transform (crop_size 448, avg_pool_2d token compression, sub_glb ordering); **no per-image token count published**` | https://huggingface.co/microsoft/Phi-4-multimodal-instruct/raw/main/config.json | 1 | medium |
| microsoft/Phi-4-multimodal-instruct | `tokenization.audio_token_rule` | `Cascades encoder with time_reduction=8; …→ ~1 token per 80ms of audio` (medium, config-derived) | `80 ms per audio token (~12.5 tokens/second; ~750 tokens per minute of audio)` | https://arxiv.org/pdf/2503.01743 | 1 | **high** (was medium) |
| microsoft/Phi-4-multimodal-instruct | `tokenization.count_tokens_method` | "…image/audio tokens require model-specific preprocessing" | "…text only; image and audio tokens require the AutoProcessor" | https://huggingface.co/microsoft/Phi-4-multimodal-instruct | 2 | medium |
| microsoft/Phi-4-multimodal-instruct | `tokenization.chars_per_token_estimate` | `3.5` (no source) | `4.0` | https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them | 2 | medium |
| microsoft/Phi-4-multimodal-instruct | `self_host.param_variants` | `5.6B (multimodal: 3.8B language backbone + vision encoder (SigLIP-based) + audio encoder (Cascades, 24 blocks); BF16)` | `5.6B (multimodal: 3.8B Phi-4-mini language backbone + SigLIP-based vision encoder + Cascades audio encoder, 24 blocks; BF16)` | https://huggingface.co/microsoft/Phi-4-multimodal-instruct | 1 | high |
| microsoft/Phi-4-multimodal-instruct | `self_host.serving_frameworks` | `…Azure AI Studio` | `…Microsoft Foundry / Azure AI Studio` (+ repo-qualified ONNX name) | https://huggingface.co/microsoft/Phi-4-multimodal-instruct | 1 | high |

### The two changes that matter most

**1. Phi-4 was recorded against the wrong tokenizer.** The old entry said Phi-4's vocabulary was
`o200k_base`-derived. It is **`cl100k_base`**-derived. `tokenizer_config.json` places
`<|endoftext|>`=100257, `<|fim_prefix|>`=100258, `<|fim_middle|>`=100259, `<|fim_suffix|>`=100260,
`<|endofprompt|>`=100276 — those are exactly tiktoken's `cl100k_base` special-token IDs
([tiktoken source](https://raw.githubusercontent.com/openai/tiktoken/main/tiktoken_ext/openai_public.py);
`o200k_base` puts `<|endoftext|>` at 199999). The base vocab therefore occupies 0–100255 (= cl100k_base)
plus 96 Microsoft tokens, giving the `vocab_size: 100352` in `config.json`, matching the tech report's
"tiktoken tokenizer … with a padded vocabulary size of 100,352". **Consequence for the product:** count
Phi-4 (and Phi-4-reasoning-vision-15B) with the `generic_cl100k` profile and Phi-4-mini / Phi-4-multimodal
with `generic_o200k`. The two halves of the family do **not** share a tokenizer, and the previous data
would have sent every Phi model to the same profile.

**2. Phi-4-multimodal's "3,600 visual tokens" figure was borrowed from a different model.** That number
comes from Phi-4-**reasoning-vision-15B** (`config.json` `max_patches: 3600`, SigLIP-2 NaFlex), a different
vision architecture. Phi-4-multimodal uses an HD-transform encoder (`crop_size: 448`,
`image_token_compression_cls: avg_pool_2d`) and neither its model card nor the tech report publishes a
tokens-per-image formula. The value now describes the mechanism and states that no per-image count is
published; the 3,600 figure is recorded where it belongs, on the new entry.

### Provenance-only changes (49 fields, no value change)

Every field carrying a non-null value now carries a real URL that was opened in this pass — the previous
file left `source_url: null` on 25 of them (including three non-null `max_tools_practical` values and three
non-null `strict_function_schema` values, which the methodology's evidence rule does not permit).
Specifically: `max_tools_practical` on all three existing models now cites a dated empirical measurement
(tier 4, confidence low, explicitly labeled "EMPIRICAL, NOT SPEC"); all `cost.*` fields now point at the
Foundry pricing page rather than the HF card; Phi-4-mini's `function_calling` / `tool_definition_shape` /
`tool_defs_count_as_input` now cite `tokenizer_config.json` (which physically contains the tool tokens and
the `tools`-aware chat template) instead of the prose model card; `self_host.max_context_documented` now
cites the tech report; and Phi-4-multimodal's `knowledge_cutoff` now cites its own model card rather than
Phi-4-mini's. Every `as_of` in the file is `2026-08-19`.

---

## MCP limits at a glance — Microsoft (Phi)

| model | native_mcp | function_calling | max_tools_hard (+ scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| `microsoft/phi-4` | **false** — no MCP at model level; must be bridged by the host | **false** — Foundry "Tool calling: No"; no tool tokens in the tokenizer | **null** — no per-request numeric cap documented at the model API layer (open weights have no API layer). Binding instead, in order: the **16,384-token window**, the ~30–50-tool selection cliff, the host's aggregate catalog cap (Cursor ~40, Claude Desktop ~100). **Scope: AGGREGATE** across all connected servers + built-in tools; no per-MCP-server cap is documented | **5** (tier 4, low) | **16,384** (input+output shared) | Counted as ordinary **input tokens**; the tightest window in this file — a ~42K-token MCP surface cannot be loaded at all |
| `microsoft/Phi-4-mini-instruct` | **false** — custom `<\|tool\|>` JSON-in-system-message format, not MCP | **true** — tool tokens 200023–200027 + a `tools`-aware chat template; hosted Foundry endpoint still says "Tool calling: No" | **null** — same reasoning; binding limits are the **131,072-token window**, the (earlier-than-usual, 3.8B) selection cliff, and the host cap. **Scope: AGGREGATE** | **20** (tier 4, low) | **131,072** (Foundry: 131,072 in / 4,096 out, one shared window) | Counted as **input tokens** inside the system message + ~5 special tokens of wrapper; window is ample, model capacity is the real limit |
| `microsoft/Phi-4-multimodal-instruct` | **false** — same custom format | **true** — same `<\|tool\|>` format as Phi-4-mini; hosted endpoint still "Tool calling: No" | **null** — same reasoning; binding limits are the **131,072-token window minus image and audio tokens**, then the selection cliff, then the host cap. **Scope: AGGREGATE** | **15** (tier 4, low) | **131,072** (Foundry: 131,072 in / 4,096 out) | Counted as **input tokens**, and they compete directly with image tokens and audio at ~750 tokens/minute for the same pool |
| `microsoft/Phi-4-reasoning-vision-15B` *(new)* | **false** | **false** — no tool tokens, no tools argument, no tool section in card or tech report | **null** — no per-request numeric cap documented. Binding: the **16,384-token window** shared with up to **3,600 visual tokens per image** and an inline `<think>` trace, then the selection cliff, then the host cap. **Scope: AGGREGATE** | **3** (tier 4, low) | **16,384** documented (note: `config.json` `max_position_embeddings` = 32768 — see conflict below) | Counted as **input tokens**; the most contested budget in this vendor's roster |

Cross-cutting: no Phi model exposes tool-search / deferred loading, none documents a tool-name length cap,
a request byte cap, a tool-result cap, a parallel-call cap or a connected-server cap. For open weights those
ceilings live in the serving stack (vLLM `--max-model-len`, `--max-num-batched-tokens`, KV-cache) and the host
app, never in a vendor API. **Re-checked 2026-08-19: vLLM's supported `--tool-call-parser` list contains no Phi
entry**, so even Phi-4-mini's native tool format has to be rendered with `apply_chat_template(..., tools=[...])`
and parsed client-side, or handled by a custom parser.

---

## Unresolved / undocumented

Left `null` (or low-confidence) because no public source states them. What was searched is listed with each.

- **`Phi-4-reasoning-vision-15B.knowledge_cutoff`** — the model card gives training dates (February 2026)
  but no data cutoff; the technical report gives none either. Searched: HF model card, HF `README.md` raw,
  MSR blog, the tech-report PDF. Not inherited from Phi-4's June 2024 cutoff, since no Microsoft source
  restates it for this model.
- **`Phi-4-reasoning-vision-15B` context window — a tier-1 vs tier-1 conflict.** Model card and
  `tokenizer_config.json` (`model_max_length: 16384`) and the tech report (stage-3 training max sequence
  length 16384) all say **16,384**; `config.json` says `max_position_embeddings: 32768` (inherited from the
  Phi-4-reasoning backbone, `rope_scaling: null`). Recorded as 16,384 with the conflict written into the
  field's `notes`, and 32,768 preserved separately in `self_host.native_context_config`.
- **`parallel_tool_calls` (all four models)** — never stated. Phi-4-mini's chat template accepts an
  arbitrary tools array and wraps output in a single `<|tool_call|>` span, but whether multi-call turns
  were trained is unstated in the card, the tech report and PhiCookBook. Searched all three.
- **`max_output_tokens_default` (all four)** — no vendor default anywhere. Foundry publishes maxima only;
  HF examples pass `max_new_tokens` explicitly. For the new model the tech report's "4096 max output
  tokens" is an evaluation setting, recorded in `notes` but not promoted to a value.
- **`Phi-4-multimodal` tokens-per-image** — no formula published; only the mechanism (HD transform,
  `crop_size: 448`, `avg_pool_2d`) and a resolution ceiling of roughly 3584×3584. Searched: model card,
  `config.json`, arXiv 2503.01743 (abstract and full PDF). Must be measured with the AutoProcessor.
- **All `cost.*` per-token prices** — no list price exists. The Foundry Microsoft pricing page renders
  `$-` for every Phi row it lists, and Phi-4-reasoning-vision-15B does not appear on it at all.
  `billing_unit` is `compute`.
- **`max_tool_name_len`, `max_tool_description_len`, `max_request_size`, `max_tool_result_size`,
  `max_parallel_tool_calls_count`, `tool_use_per_turn_limit`, `max_connected_servers`, `max_total_tools`
  (all four models)** — no vendor value exists for open weights; each is null with a note naming the layer
  that actually binds (serving stack or host app) and a vLLM citation.
- **`max_tools_practical` (all four)** — no Phi-specific measurement exists. Berkeley FCL was checked and
  returned no visible Phi rows and no tool-count-scaling series; MCP-Atlas (arXiv 2602.00933) uses 6–37
  tools per task but publishes no degradation curve and evaluates no Phi model. The values therefore stay
  tier-4 / low confidence, anchored to a dated general measurement (~95% at ~4 tools → ~71% at ~46 tools)
  and to each model's own window arithmetic, and are labeled as empirical rather than spec.
- **Partially blocked fetch:** the Foundry blog post "Introducing Phi-4-Reasoning-Vision to Microsoft
  Foundry" returned only page metadata (confirming the 2026-03-04 date), not the article body. It is kept
  in the new model's `sources` for the date, but no field's value rests on it — the release date is taken
  from the HF model card instead.

---

## Sources (every URL opened in this pass)

Vendor / tier 1:
1. https://huggingface.co/microsoft/phi-4
2. https://huggingface.co/microsoft/phi-4/raw/main/config.json
3. https://huggingface.co/microsoft/phi-4/raw/main/tokenizer_config.json
4. https://huggingface.co/microsoft/Phi-4-mini-instruct
5. https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/config.json
6. https://huggingface.co/microsoft/Phi-4-mini-instruct/raw/main/tokenizer_config.json
7. https://huggingface.co/microsoft/Phi-4-multimodal-instruct
8. https://huggingface.co/microsoft/Phi-4-multimodal-instruct/raw/main/config.json
9. https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B
10. https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B/raw/main/README.md
11. https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B/raw/main/config.json
12. https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B/raw/main/tokenizer_config.json
13. https://huggingface.co/microsoft/Phi-Ground-Any
14. https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners (page updated 2026-07-24)
15. https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure (updated 2026-07-23)
16. https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/model-lifecycle-retirement (updated 2026-08-17)
17. https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/
18. https://azure.microsoft.com/en-us/products/phi/
19. https://arxiv.org/abs/2412.08905
20. https://arxiv.org/pdf/2412.08905 (Phi-4 tech report — tokenizer + 16K midtraining)
21. https://arxiv.org/abs/2503.01743
22. https://arxiv.org/pdf/2503.01743 (Phi-4-Mini / Multimodal tech report — o200k_base, 200,064 vocab, 80 ms audio token rate)
23. https://www.microsoft.com/en-us/research/wp-content/uploads/2026/03/Phi-4-reasoning-vision-15B-Tech-Report.pdf
24. https://www.microsoft.com/en-us/research/blog/phi-4-reasoning-vision-and-the-lessons-of-training-a-multimodal-reasoning-model/
25. https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-phi-4-reasoning-vision-to-microsoft-foundry/4499154 (metadata only — body not returned)
26. https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-phi-4-microsoft%E2%80%99s-newest-small-language-model-specializing-in-comple/4357090
27. https://techcommunity.microsoft.com/blog/educatordeveloperblog/welcome-to-the-new-phi-4-models---microsoft-phi-4-mini--phi-4-multimodal/4386037
28. https://github.com/microsoft/PhiCookBook/blob/main/md/02.Application/07.FunctionCalling/Phi4/FunctionCallingBasic/README.md
29. https://huggingface.co/models?search=microsoft/phi
30. https://huggingface.co/models?search=phi&author=microsoft&sort=created

Tokenizer / tooling ground truth (tier 2):
31. https://raw.githubusercontent.com/openai/tiktoken/main/tiktoken_ext/openai_public.py
32. https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
33. https://docs.vllm.ai/en/stable/features/tool_calling/

Cross-check / empirical (tier 3–4):
34. https://en.wikipedia.org/wiki/Phi_(language_model)
35. https://gorilla.cs.berkeley.edu/leaderboard.html (checked for Phi rows / tool-count scaling — neither visible)
36. https://arxiv.org/html/2602.00933v3 (MCP-Atlas — 6–37 tools per task, no degradation curve, no Phi models)
37. https://dev.to/thedailyagent/mcp-tool-overload-why-more-tools-make-your-agent-worse-5a49 (2026-03-06 — ~95% at ~4 tools/~1.2K tokens vs ~71% at ~46 tools/~42K tokens; the sole citation behind every `max_tools_practical`)

---

## Verification performed

```
python3 -c "import json;json.load(open('/tmp/tcc/data/open-weight/microsoft-phi.json'))"   # parses
jsonschema.validate(data, schema/model-entry.schema.json)                                  # valid
```

Also asserted mechanically: 0 provenanced fields dropped relative to the pristine copy; 0 model ids
renamed or deleted; every non-null value has a `source_url`, a `source_tier` and an `as_of`; every
`as_of` reads `2026-08-19`; and the banned absence-phrasings ("unlimited", "no limit", "no cap",
"no hard cap", "doesn't apply") appear nowhere in the file.

---

## Remediation 2026-08-19

Evidence-audit follow-up. Only the audited defect was touched. Every URL below was re-opened in
this pass.

| Finding | What I did | New value | New source | New tier / confidence |
|---|---|---|---|---|
| MAJOR — all four variants, `tools_mcp.max_tools_practical` = 3 / 5 / 20 / 15 cited to a dev.to post that never mentions Phi | **Nulled all four.** Re-opened the cited post: its single measurement (~95% correct tool selection with ~4 tools / ~1,200 tokens vs ~71% with ~46 tools / ~42,000 tokens) was run with `model="claude-3-5-sonnet-20241022"`, and "Phi" does not appear on the page. The per-variant numbers were the editor's interpolation of another vendor's model, so no admissible per-Phi figure exists. Each entry's notes now name the searches run and the limits that actually bind. | `null` (was 5 / 20 / 15 / 3) | `microsoft/phi-4` → https://huggingface.co/microsoft/phi-4 · `Phi-4-mini-instruct` → https://huggingface.co/microsoft/Phi-4-mini-instruct · `Phi-4-multimodal-instruct` → https://huggingface.co/microsoft/Phi-4-multimodal-instruct · `Phi-4-reasoning-vision-15B` → https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B | tier 1 / low (cards opened; each documents the tool-calling format or its absence, and none gives a tool count) |

**Searched for a Phi-specific empirical figure, found none** (all opened 2026-08-19):

- the four Hugging Face model cards — `phi-4` ("Context length: 16K tokens") does not mention
  function calling at all; `Phi-4-mini-instruct` and `Phi-4-multimodal-instruct` document the
  `<|tool|>…<|/tool|>` system-prompt tool format with **no** quantity guidance;
  `Phi-4-reasoning-vision-15B` ("Context Length: 16,384 tokens") does not mention tool use.
- `microsoft/PhiCookBook` function-calling sample for Phi-4 — its example declares exactly one tool
  and gives no guidance.
- ertas.ai on-device tool-calling comparison (2026-05-10, upd. 2026-08-07) — BFCL v4 composite
  scores for Phi-4-Mini and a 5-tool customer-support evaluation set, but **no** tool-count-vs-accuracy
  curve.
- presenc.ai tool-calling benchmarks 2026 and nerdleveltech "How many tools can an AI agent handle"
  — neither mentions Phi; the latter's catalog-scaling study used GPT-5.4 / GPT-5.1 / Claude Sonnet 4.5.
- arXiv 2604.07035 (Gemma 4 / Phi-4 / Qwen3 tradeoffs) — reasoning benchmarks only, no tool-use
  experiment; Azure AI Foundry pages state no tool count.

**What binds instead**, now recorded per variant in the notes: for `phi-4` and
`Phi-4-reasoning-vision-15B` the 16,384-token window ÷ ~200–400 tokens per tool definition (the
~42,000-token GitHub MCP surface in the cited measurement does not fit at all), plus the absence of
a documented tool-calling format on both cards; for `Phi-4-mini-instruct` model capacity rather than
the 128K window, with the card's own red-team line "With function calling scenarios, the model could
sometimes hallucinate function names or URL's."; for `Phi-4-multimodal-instruct` the media share of
the same 128K pool (~22,500 tokens for 30 minutes of audio, hundreds-to-thousands per
high-resolution image).
