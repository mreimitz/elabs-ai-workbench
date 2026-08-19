# Google (Gemma) — dataset refresh, 2026-08-19

**File:** `data/open-weight/google-gemma.json` (edited in place)
**Previous research date:** 2026-06-21 · **This pass:** 2026-08-19
**Top-level `as_of`** bumped 2026-06-21 → 2026-08-19. `schema_version` unchanged (`1.0`).
Validated against `schema/model-entry.schema.json` — 0 errors. 149 provenanced fields; every
non-null value carries a source URL that was opened in this pass; every null carries a `notes`
explaining the absence.

---

## Models

### Validated (3 of 3 — all re-verified field by field, none retired)

| id | status | verdict |
|---|---|---|
| `google/gemma-4-31B-it` | `ga` (unchanged) | Re-verified against the Gemma 4 model card, HF card, `config.json`, function-calling guide, thinking guide, technical report. Still the flagship dense variant; no successor. |
| `google/gemma-4-12B-it` | `ga` (unchanged) | Re-verified. **Release date corrected** (see table). Still the most recent Gemma release of any kind. |
| `google/gemma-4-E4B-it` | `ga` (unchanged) | Re-verified. Two corrections (modalities, audio token rule). |

### Added — none

No Gemma model was released or brought to GA between 2026-06-21 and 2026-08-19.

- The official [Gemma releases page](https://ai.google.dev/gemma/docs/releases) shows nothing after
  **2026-06-03 — "Release of Gemma 4 12B Unified"**, which is already in the roster (its date was wrong
  and is now fixed).
- A Tier-4 report describes a **2026-07-15 weight/config refresh** of the existing Gemma 4 collection
  (Flash Attention 4 on Hopper: +25–70% prefill throughput, up to −31% TTFT; tool-calling reliability
  gains — 31B +10.1pp on Tau2 Telecom, E4B +8% on Tau2 Airline; vision default settled at 280 soft
  tokens with a 1120 max; chat-template polish). It explicitly says **no new models and no "Gemma 4.1"**.
  The official releases page does **not** list this refresh — recorded as a conflict in the 31B `notes`,
  and used to change **no** hard value.

### Roster gaps deliberately NOT filled (flagged for the owner)

These exist and are current-generation, but all predate 2026-06-21, so they fall outside this refresh's
add-scope and outside the methodology's "latest 3 models each" roster rule. Recommend an owner decision:

| Model | Released | Why it may belong |
|---|---|---|
| `google/gemma-4-26B-A4B-it` | 2026-04-02 | Flagship **MoE** (25.2B total / 3.8B active, 8-of-128 experts + 1 shared), 256K window, text+image, Apache 2.0. Architecturally distinct from every roster entry. `config.json` verified this pass: `max_position_embeddings=262144`, `vocab_size=262144`, `vision_soft_tokens_per_image=280`, `audio_config: null`. |
| `google/gemma-4-E2B-it` | 2026-04-02 | Smallest edge variant (2.3B effective / 5.1B with embeddings), 128K, text+image+audio. |
| `google/diffusiongemma-26B-A4B-it` | 2026-06-10 | Text-diffusion model on Gemma 4 foundations, 256K, 25.2B/3.8B, Apache 2.0, cutoff Jan 2025, **native structured tool use**. Generates 15–20 tokens per forward pass (>1100 tok/s at low batch). Would need its own token-accounting treatment. |

### Retired / deprecated — none

No Gemma 4 entry moved to `deprecated`. No entry was deleted and no `id` was renamed.

---

## Changed values

Value changes only (source-URL-only and `as_of`-only refreshes are summarised below the table).

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| gemma-4-12B-it | `release_date` | `2026-04-02` | `2026-06-03` | https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/ | 1 | high |
| gemma-4-31B-it | `tools_mcp.max_tools_practical` | `20` (source_url `null`) | `15` | https://lushbinary.com/blog/build-ai-agent-gemma-4-function-calling-mcp-tool-use/ | 4 | low |
| gemma-4-12B-it | `tools_mcp.max_tools_practical` | `15` (source_url `null`) | `12` | https://lushbinary.com/blog/build-ai-agent-gemma-4-function-calling-mcp-tool-use/ | 4 | low |
| gemma-4-E4B-it | `tools_mcp.max_tools_practical` | `10` (source_url `null`) | `10` (unchanged value, now sourced) | https://lushbinary.com/blog/build-ai-agent-gemma-4-function-calling-mcp-tool-use/ | 4 | low |
| gemma-4-31B-it | `tokenization.tokenizer_access` | `HF AutoTokenizer / HuggingFace Transformers (transformers>=5.5.0)` | `HF AutoProcessor / AutoTokenizer (latest Transformers; >=5.10.1 required for function calling)` | https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 | 1 | high |
| gemma-4-12B-it | `tokenization.tokenizer_access` | `HF AutoProcessor / HuggingFace Transformers (>=5.10.1 for 12B Unified)` | `HF AutoProcessor / AutoTokenizer (latest Transformers; >=5.10.1 required for function calling)` | https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 | 1 | high |
| gemma-4-E4B-it | `tokenization.tokenizer_access` | `HF AutoProcessor / HuggingFace Transformers (>=5.5.0)` | `HF AutoProcessor / AutoTokenizer (latest Transformers; >=5.10.1 required for function calling)` | https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 | 1 | high |
| gemma-4-E4B-it | `tokenization.audio_token_rule` | `Dedicated audio encoder; max 30 seconds audio; audio_samples_per_token and output_proj_dims in config.json` | `Dedicated audio encoder (12 layers, hidden_size 1024); audio input capped at 30 seconds; no tokens-per-second or samples-per-token figure published` | https://huggingface.co/google/gemma-4-E4B-it/resolve/main/config.json | 1 | medium |
| gemma-4-E4B-it | `modalities` | `["text","image","audio"]` | `["text","image","video","audio"]` | https://huggingface.co/google/gemma-4-E4B-it + https://ai.google.dev/gemma/docs/core | 1 | high |
| gemma-4-31B-it | `self_host.serving_frameworks` | `vLLM, SGLang, HuggingFace Transformers (>=5.5.0), llama.cpp (GGUF), Ollama, LM Studio, MLX, Keras, Vertex AI, Cloud GKE` | same list, with `vLLM (with the gemma4 tool/reasoning parsers)` and `Transformers (latest; >=5.10.1 for function calling)` | https://huggingface.co/google/gemma-4-31B-it | 1 | high |
| gemma-4-12B-it | `self_host.serving_frameworks` | `vLLM, SGLang, HuggingFace Transformers (>=5.10.1), llama.cpp (GGUF), Ollama, LM Studio, MLX, Keras` | same list + `Google AI Edge Gallery`, with the gemma4 parsers and the Transformers restatement | https://huggingface.co/google/gemma-4-12B-it | 1 | high |
| gemma-4-E4B-it | `self_host.serving_frameworks` | `vLLM, HuggingFace Transformers, llama.cpp (GGUF), Ollama, LM Studio, LiteRT-LM (mobile), MLX, MediaPipe` | same list, with the gemma4 parsers and the Transformers restatement | https://huggingface.co/google/gemma-4-E4B-it | 1 | high |

**Count: 10 provenanced fields changed value** (the E4B `max_tools_practical` row kept its value and
only gained a source, so it is not in that 10), plus 1 non-provenanced field (`modalities` on E4B).

### Source-URL corrections (35 fields, values unchanged)

| what | old | new | why |
|---|---|---|---|
| `max_request_size`, `max_tool_result_size`, `max_total_tools`, `max_connected_servers` (×3 models) | https://docs.vllm.ai/en/stable/features/tool_calling/ | https://docs.vllm.ai/projects/recipes/en/stable/Google/Gemma4.html | The generic vLLM tool-calling page was opened this pass and **lists no Gemma/gemma4 parser at all** (it lists Hermes, Mistral, Llama, Granite, Qwen, DeepSeek, FunctionGemma, …). It was the wrong citation. The vLLM **Gemma 4 recipe** does document the parser and the serving limits. |
| `chars_per_token_estimate` (×3) | https://huggingface.co/docs/transformers/model_doc/gemma4 | https://huggingface.co/docs/transformers/en/model_doc/gemma4 | Canonical locale-qualified URL that actually resolves; also marked `derived: true` since Google publishes no chars/token ratio. |
| `max_tools_practical` (×3), `max_tool_name_len` (×3), `max_tool_description_len` (×3), `max_parallel_tool_calls_count` (×3), `tool_use_per_turn_limit` (×3), `strict_function_schema` (×3) | `null` | tier-1 function-calling guide / tier-2 vLLM recipe | Methodology rule: an unsourced number is worse than a null. Every one of these now cites the page whose absence-of-a-limit was actually verified. |
| `tokenizer_access` (31B, E4B) | HF model card | Gemma 4 function-calling guide | The HF cards no longer pin a floor Transformers version; the function-calling guide does (`>=5.10.1`). |
| 12B `release_date` | Gemma 4 family launch post | 12B launch post | The April family post does not mention the 12B at all. |

### Non-value edits applied everywhere

- `as_of` refreshed to `2026-08-19` on all 149 provenanced fields (every one was re-checked).
- `as_of` **added** to 8 field types that previously lacked it (`max_tool_description_len`,
  `max_request_size`, `max_tool_result_size`, `max_parallel_tool_calls_count`,
  `tool_use_per_turn_limit`, `max_connected_servers`, `max_total_tools`, `strict_function_schema`).
- `notes` added or rewritten on ~90 fields, in particular: every `null` now says what was searched;
  every tool-limit field now states its **scope** (per-tool / per-server / aggregate) per
  `docs/02-mcp-limits-taxonomy.md`; anti-trap phrasing removed (the old `other_limits_notes` opened
  with "imposes NO tool count/size caps" and several cost notes said "N/A" — both now name the limits
  that *do* bind).
- `derived: true` set on `chars_per_token_estimate` (×3) and `max_tools_practical` (×3).
- `sources` arrays expanded on all three models (31B 7→16, 12B 6→14, E4B 5→15).
- No field was deleted, no key renamed, no entry reordered, no `id` changed.

---

## MCP limits at a glance — Google Gemma (all open-weight, as of 2026-08-19)

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| gemma-4-31B-it | **no** (T1) | **yes**, native (T1) | **no per-request numeric cap documented** — scope would be *aggregate*; the limits that bind are the served `--max-model-len` (vLLM recipe suggests **8192–32768** for this variant), the 262144 architectural window, the ~10–15-tool selection cliff, and host caps (Cursor ~40, Claude Desktop ~100) | **15** (T4, low, derived) | **262144** (256K), `config.json` verified | Authored as OpenAI-style JSON, re-serialized by the chat template into `<\|tool>declaration:…<tool\|>`; **counts as input tokens**. Count the *templated* form, not the raw JSON. |
| gemma-4-12B-it | **no** (T1) | **yes**, native (T1) | same — no per-request numeric cap; aggregate scope; served window + selection cliff + host caps bind | **12** (T4, low, derived) | **262144** (256K), `config.json` verified | same; window is also shared with image soft tokens (280 default) and audio tokens (640 samples/token) |
| gemma-4-E4B-it | **no** (T1) | **yes**, native (T1) | same — no per-request numeric cap; aggregate scope. Here the served window can reach the full **131072** (vLLM recipe permits it for E2B/E4B), so *tool-selection accuracy*, not context, is the binding limit | **10** (T4, low, derived) | **131072** (128K), `config.json` verified | same; on a 128K window the templated tool block is ~2× the budget share it takes on the 256K variants |

**There is no documented per-MCP-server tool cap at any Gemma layer** — no vendor API exists to enforce one.
The binding ceiling is `(served --max-model-len − output/thinking headroom) ÷ avg templated tool-declaration tokens`,
then the practitioner selection cliff, then whatever the agent host caps.

**Serving prerequisites (vLLM, verified this pass):** `--tool-call-parser gemma4`,
`--reasoning-parser gemma4`, `--chat-template examples/tool_chat_template_gemma4.jinja` — all three, or
tool calls return as raw control tokens. Two open vLLM defects against that parser are recorded in
`other_limits_notes` (control-token leakage into streamed `tool_calls`; pad tokens under concurrency).

**Family-wide, unchanged and re-verified:** `tool_search_deferral: false` (no deferred/lazy tool loading
exists — the whole tool set is paid for on every request), `tool_defs_count_as_input: true`,
`strict_function_schema: false`, `skills_supported: false`, `prompt_caching: false` (vendor-level;
operator KV/prefix caching is the substitute), `memory_feature: false`, `billing_unit: compute`.

---

## Unresolved / undocumented

Fields left `null` (or low-confidence) for lack of a public source, with what was searched:

1. **`max_tools_hard` (all 3)** — searched the Gemma 4 function-calling guide, the model card, all three
   HF cards, the Gemma 4 technical report (arXiv 2607.02770) and the Gemma docs capability index. No
   numeric per-request tool cap is published anywhere, and no vendor-operated API exists that could
   enforce one. Correctly `null`; the binding limits are named in `notes`.
2. **`max_tools_practical` (all 3)** — no Gemma-specific tool-count-versus-accuracy curve exists. The
   Gemma 4 technical report contains **no** such experiment. The Berkeley Function Calling Leaderboard
   page was opened and carries no per-tool-count breakdown for Gemma 4. The only opened numeric guidance
   is a Tier-4 blog ("keep tool definitions under 10–15"), which does not differentiate by variant — so
   all three numbers are Tier-4, `low`, `derived`, and should be treated as a band, not a measurement.
3. **`max_tool_name_len`, `max_tool_description_len` (all 3)** — no character, token or pattern rule is
   published for tool names or descriptions. Confirmed absent from the function-calling guide, model card,
   HF cards and the technical report.
4. **`max_request_size`, `max_tool_result_size`, `max_parallel_tool_calls_count`,
   `tool_use_per_turn_limit`, `max_connected_servers`, `max_total_tools` (all 3)** — no numbers exist at
   the model layer for an open-weight model. Sourced to the vLLM Gemma 4 recipe / the function-calling
   guide as the pages where their absence and the real (serving/host-layer) ceilings were verified.
5. **`max_output_tokens_default`, `max_output_tokens_max` (all 3)** — absent from the model card, HF cards
   and `config.json`. Set by the serving framework. The vLLM recipe's instruction to raise
   `--max-model-len` *and* `max_tokens` when thinking is on confirms there is no model-side default.
6. **E4B audio → token conversion** — E4B's `config.json` has **no** `audio_samples_per_token` key (the
   12B does, `=640`). Only the encoder shape (12 layers, hidden 1024) and the 30-second cap are public,
   so E4B audio context cost cannot be derived from documentation; it must be measured with the processor.
   The previous entry asserted the key existed — corrected.
7. **`chars_per_token_estimate` (all 3)** — Google publishes no chars-per-token ratio. 4.0 is a Tier-3
   estimate, now marked `derived: true`.
8. **All `cost.*` fields** — Google sells no Gemma inference product, so no per-token price, cached-input
   price or batch discount exists to record. `billing_unit: compute` stands. Third-party/Vertex hosts price
   per token, but that is a property of the host, not of Gemma, and is deliberately not recorded.
9. **Memory-footprint figures** (~70GB/17.5GB for 31B, ~26.7GB/6.7GB for 12B, 2.5GB/17.9GB/4.5GB for E4B)
   — carried over from the 2026-06-21 pass and **not restated** on any page opened on 2026-08-19. Flagged
   as indicative inside the relevant `notes` rather than silently kept as fact.
10. **E4B thinking-disable behaviour** — the prior pass claimed E2B/E4B can disable thinking fully while
    larger models still emit empty thought blocks. The thinking guide as opened on 2026-08-19 does not
    state this. Flagged as unconfirmed in `notes`; the boolean value was not changed.
11. **2026-07-15 weight refresh** — Tier 4 only; the official releases page does not list it. Recorded as
    a conflict; no hard value changed on its basis.

### Source conflicts recorded (not silently resolved)

- **31B modalities.** The Gemma 4 model card table lists the 31B as *Text, Image*; the 31B HF card says
  video is supported via frame sequences. `modalities` keeps `video` and the conflict is written into the
  31B `notes`. (For E4B, the model card, the HF card *and* `docs/core` all support video → changed.)
- **Transformers Gemma4 doc context table.** That page currently renders a garbled per-variant context
  table (it swaps E4B with the 256K models). Every context value in this file was read directly from each
  model's `config.json` instead; the discrepancy is noted on the 12B entry.
- **vLLM tool-calling index vs. Gemma 4 recipe.** The generic index lists no Gemma parser; the Gemma 4
  recipe documents `--tool-call-parser gemma4`. Higher-specificity page preferred; citations moved.

---

## Sources (every URL opened in this pass)

**Tier 1 — Google / Hugging Face model cards, official docs, technical report**
1. https://ai.google.dev/gemma/docs/core/model_card_4
2. https://ai.google.dev/gemma/docs/core
3. https://ai.google.dev/gemma/docs
4. https://ai.google.dev/gemma/docs/releases
5. https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4
6. https://ai.google.dev/gemma/docs/capabilities/thinking
7. https://ai.google.dev/gemma/docs/mtp/overview
8. https://ai.google.dev/gemma/apache_2
9. https://ai.google.dev/gemma/docs/diffusiongemma/model_card
10. https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
11. https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/
12. https://blog.google/innovation-and-ai/technology/ai/google-ai-updates-july-2026/
13. https://deepmind.google/models/gemma/
14. https://huggingface.co/google/gemma-4-31B-it
15. https://huggingface.co/google/gemma-4-31B-it/resolve/main/config.json
16. https://huggingface.co/google/gemma-4-12B-it
17. https://huggingface.co/google/gemma-4-12B-it/resolve/main/config.json
18. https://huggingface.co/google/gemma-4-E4B-it
19. https://huggingface.co/google/gemma-4-E4B-it/resolve/main/config.json
20. https://huggingface.co/google/gemma-4-26B-A4B-it
21. https://huggingface.co/google/gemma-4-26B-A4B-it/resolve/main/config.json
22. https://arxiv.org/pdf/2607.02770 (Gemma 4 Technical Report, Gemma Team / Google DeepMind, 2026-06-19)

**Tier 2 — tooling ground truth**
23. https://huggingface.co/docs/transformers/en/model_doc/gemma4
24. https://docs.vllm.ai/projects/recipes/en/stable/Google/Gemma4.html
25. https://docs.vllm.ai/en/stable/features/tool_calling/ (opened; confirmed it does **not** cover Gemma)

**Tier 3/4 — cross-check and empirical only**
26. https://gorilla.cs.berkeley.edu/leaderboard.html (opened; no Gemma-4 tool-count data)
27. https://lushbinary.com/blog/build-ai-agent-gemma-4-function-calling-mcp-tool-use/ (2026-04-05)
28. https://www.ertas.ai/blog/on-device-tool-calling-2026-qwen3-gemma4-phi4 (2026-05-10, upd. 2026-08-07)
29. https://explainx.ai/blog/gemma-4-updates-flash-attention-tool-calling-july-2026 (2026-07-15 refresh)
30. https://dev.to/megberts/which-gemma-4-variant-should-power-your-mcp-agent-4gkn (2026-05-16)
31. https://en.wikipedia.org/wiki/Gemma_(language_model) (opened; stale — no Gemma 4 coverage, unused)

---

## Remediation 2026-08-19

Evidence-audit follow-up. Only the audited defects (and same-class errors in the same file) were
touched; the rest of the refresh pass is unchanged. Every URL below was re-opened in this pass.

| Finding | What I did | New value | New source | New tier / confidence |
|---|---|---|---|---|
| MAJOR — `google/gemma-4-E4B-it` `modalities`: "video" ADDED this pass (regression) | Reverted to the model card's per-variant Dense Models table row. The table gives E4B as "Text, Image, Audio"; video appears only in family-level prose ("All models support image inputs and can process videos as frames"), i.e. frame-by-frame image input, not a listed native modality. Rewrote the entry's "Two corrections this pass: modalities gained video…" note to record the revert. | `["text","image","audio"]` (was `["text","image","video","audio"]`) | https://ai.google.dev/gemma/docs/core/model_card_4 | tier 1 (modalities is a non-provenanced array; evidence recorded in the entry notes) |
| MINOR — `gemma-4-31B-it` `modalities` stale `["text","image","video"]` | Corrected from the same per-variant table: 31B row reads "Text, Image"; audio is explicitly scoped to "E2B, E4B, and 12B Unified only". Confirmed independently on the HF card ("Supported Modalities: Text, Image"). Replaced the old note that said "modalities keeps video and the conflict is recorded here". | `["text","image"]` | https://ai.google.dev/gemma/docs/core/model_card_4 · https://huggingface.co/google/gemma-4-31B-it | tier 1 |
| MINOR — `gemma-4-12B-it` `modalities` stale `["text","image","video","audio"]` | Corrected from the per-variant table: 12B Unified row reads "Text, Image, Audio". Added a note recording the correction. | `["text","image","audio"]` | https://ai.google.dev/gemma/docs/core/model_card_4 | tier 1 |
| MAJOR — all three models, `tools_mcp.max_tools_practical` = 15 / 12 / 10 invented per-variant ranking | Carried the single band the source actually states, identically for all three variants. Re-opened the blog: its only figure is "Keep tool definitions under 10-15 for best accuracy. More tools = more confusion about which to call." — no per-variant numbers (12 appears nowhere). Value = top of the stated band; notes quote the band verbatim, say the conservative reading is 10, mark `derived: true`, and state that Google publishes no tool-count-vs-accuracy curve (function-calling guide, prompt-formatting page and the technical report all checked). | `15` for **all three** (was 15 / 12 / 10) | https://lushbinary.com/blog/build-ai-agent-gemma-4-function-calling-mcp-tool-use/ | tier 4 / low (unchanged tier; empirical, stated in notes) |
| MINOR — all three models, `tools_mcp.parallel_tool_calls` = true (tier 1, medium) inferred from an example | Nulled. Re-opened the cited Gemma 4 function-calling page: it makes **no** statement about parallel / simultaneous / multiple-per-turn tool calls — the boolean had been inferred from the `tool_responses` list example. Also re-read the Gemma 4 prompt-formatting page and the model card: same result. The only explicit statement found anywhere is tier 4 ("Gemma 4 can generate multiple tool calls in a single turn, but reliability decreases with more than 3 parallel calls"), recorded in the notes but not promoted to a value, since a capability boolean needs tier 1. | `null` | https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 (tier-1 page that does **not** state it) · tier-4 counter-evidence quoted in notes | tier 1 / low |

**Not changed:** the 60-second video-frame caps in `tokenization.image_token_rule` and
`cost.multimodal_billing_notes` — these describe frame-based video *handling*, which is consistent
with video being image input rather than a native modality, and were not part of the audit.
