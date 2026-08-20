---
type: "Source Reference"
title: "Alibaba (Qwen) \u2014 dataset refresh, 2026-08-19"
description: "Vendor file: /tmp/tcc/data/open-weight/alibaba-qwen.json (group: openweight)."
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "captured"
---
# Alibaba (Qwen) — dataset refresh, 2026-08-19

Vendor file: `/tmp/tcc/data/open-weight/alibaba-qwen.json` (group: `open_weight`).
Previous research pass: 2026-06-21. This pass: **2026-08-19**. `schema_version` unchanged (`1.0`);
top-level `as_of` moved to `2026-08-19`. Schema-validated against
`/tmp/tcc/schema/model-entry.schema.json` (`jsonschema.validate` passes) and JSON-parse-checked.

**Headline:** Qwen shipped a whole new open-weight generation (**Qwen3.8**, August 2026) since the last
pass, and two things in the MCP block changed materially for *every* Qwen entry:

1. **A real, tier-1, documented MCP limit now exists** — Alibaba Model Studio's MCP reference caps a
   request at **"Maximum 10 MCP servers"** (aggregate scope, hosted Responses-API path, SSE transport
   only). At the last pass `max_connected_servers` was `null` for all three models.
2. **The tokenizer identity in the old file was wrong.** Every entry claimed a `~151,643`-token
   vocabulary; that figure comes from the Qwen1-era tokenization note for Qwen-7B. The
   Qwen3.5/3.6/3.8 generation ships `vocab_size 248320` (`tokenizer_class Qwen2Tokenizer`,
   33 special tokens at ids 248,044–248,076). Confirmed in three separate `config.json` files.

Pricing was also wrong in a way that mattered: the old numbers came from a tier-3 aggregator and were
**4–6× low** on input and **2.5–5× low** on output. Alibaba publishes a tier-1
"Text generation – Qwen (open source)" price table that lists every one of these model ids.

---

## Models

### Validated (3 — all pre-existing entries re-verified field-by-field)

| id | status | verdict |
|---|---|---|
| `Qwen/Qwen3.6-27B` | `ga` (unchanged) | Still published (Apache-2.0), still priced on Model Studio's open-source table, **not** on the decommissioning list. Superseded as dense lead by Qwen3.8-27B — recorded in `notes`, not in `status`. |
| `Qwen/Qwen3.6-35B-A3B` | `ga` (unchanged) | Same. Carries the only MCP-competency number Qwen publishes anywhere in this file (MCPMark 37.0). |
| `Qwen/Qwen3.5-35B-A3B` | `ga` (unchanged) | Two generations superseded but still published, still priced ($0.25/$2.0 — cheapest id in the file), still absent from the decommissioning list. |

### Added (2)

| id | released | GA | license | evidence |
|---|---|---|---|---|
| `Qwen/Qwen3.8-2.4T-A95B` (Qwen3.8-Max open weights) | **2026-08-12** (open weights) | GA | **custom `qwen3.8-max`** (source-available, *not* Apache-2.0) | Model card citation `month = August, year = 2026` (tier 1); day from [vLLM's day-0 support post, 2026-08-12](https://vllm.ai/blog/2026-08-12-qwen3.8) (tier 2). The priced hosted `qwen3.8-max` API launched earlier — OpenRouter shows **2026-08-03** creation (tier 3); that is the API, not the weights. |
| `Qwen/Qwen3.8-27B` | **2026-08-14** (approx.) | GA | Apache-2.0 | Model card citation `month = August, year = 2026` (tier 1); day is tier 4 ([orcarouter release tracker](https://www.orcarouter.ai/blog/qwen-3-8-27b-release-date): "shipped the open weights … on the evening of August 14, 2026"), corroborated by the HuggingFace org listing showing the repo "Updated 3–4 days ago" on 2026-08-19. |

2.4T total / 95B activated, 92 layers, 512 experts (10 routed + 1 shared) — the largest open-weight
Qwen to date; text-only, thinking always on. The 27B is dense, multimodal (text/image/video),
Apache-2.0. Note the **generation is licence-split**: the 27B stays Apache-2.0, the flagship does not.

### Retired / deprecated (0)

**No Qwen entry was retired, and none may be.** The schema's `status` enum is
`["ga","preview","deprecated"]`, and marking any of these `deprecated` would be unsourced:

- Alibaba's [model-decommissioning policy page](https://www.alibabacloud.com/help/en/model-studio/model-depreciation)
  schedules a large batch of **Qwen3-era** ids for retirement on **2026-10-10**
  (`qwen3-max`, `qwen3-max-preview`, `qwen3.6-max-preview`, `qwen3-coder-plus`, the `qwen3-vl-*` family,
  and the whole `qwen3-8b / 14b / 30b-a3b / 32b / 235b-a22b / next-80b-a3b` open-source block).
  **None of our three ids appears on it**, and no `qwen3.5-*` open-source id appears at all.
- All three remain purchasable on the tier-1 pricing table and downloadable under Apache-2.0.

Supersession is therefore recorded in each model's `notes` field (explicitly, with the superseding
model named), and `status` is left at `ga`. Nothing was deleted; no `id` was renamed.

### Considered and deliberately excluded (1)

`Qwen/Qwen-AgentWorld-35B-A3B` (June 2026, Apache-2.0, 262,144 ctx) appears in the Qwen HF org and is
new since the last pass, but it is a **world model**, not an MCP host: it "simulates agentic
environments … predicting the next environment state given an agent's action" across MCP, Search,
Terminal, SWE, Android, Web and OS domains, and does **not** perform tool calling itself. It cannot be
profiled on the "can this model host this MCP server?" axes, so it is out of roster.

Also checked and excluded: **Qwen3.7** (Max/Plus) is hosted-API-only — it appears on Model Studio's
model list and newly-released-models page (Qwen3.7-Max 2026-05-21, Qwen3.7-Plus 2026-06-01) but has no
open-weight HuggingFace release, so it does not belong in this open-weight file.

---

## Changed values

38 provenanced `value` changes (`as_of`/`source_url`/`notes`-only refreshes not listed; every one of
the file's **247** provenanced fields had `as_of` moved to 2026-08-19).

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| Qwen/Qwen3.6-27B | `tools_mcp.max_connected_servers` | null | 10 | https://www.alibabacloud.com/help/en/model-studio/mcp | 1 | high |
| Qwen/Qwen3.6-27B | `self_host.serving_frameworks` | vLLM (>=0.19.0), SGLang (>=0.5.10), KTransformers, HuggingFace Transfo… | vLLM (>= 0.19.0), SGLang (>= 0.5.10), HuggingFace Transformers, KTrans… | https://huggingface.co/Qwen/Qwen3.6-27B | 1 | high |
| Qwen/Qwen3.6-27B | `release_date` | 2026-04-22 | 2026-04 | https://huggingface.co/Qwen/Qwen3.6-27B | 1 | medium |
| Qwen/Qwen3.6-27B | `cost.output_per_mtok_usd` | 0.9 | 3.6 | https://www.alibabacloud.com/help/en/model-studio/model-pricing | 1 | high |
| Qwen/Qwen3.6-27B | `cost.input_per_mtok_usd` | 0.14 | 0.6 | https://www.alibabacloud.com/help/en/model-studio/model-pricing | 1 | high |
| Qwen/Qwen3.6-27B | `cost.batch_discount` | 50% off input and output for Batch Invocation (async) | null | https://www.alibabacloud.com/help/en/model-studio/batch-inference | 1 | high |
| Qwen/Qwen3.6-27B | `cost.cached_input_per_mtok_usd` | 0.05 | null | https://www.alibabacloud.com/help/en/model-studio/context-cache | 1 | high |
| Qwen/Qwen3.6-27B | `tokenization.tokenizer_family` | Qwen3 tiktoken BPE (vocab ~151,643 tokens) | Qwen3.5-generation byte-level BPE (tokenizer_class Qwen2Tokenizer), vo… | https://huggingface.co/Qwen/Qwen3.6-27B/raw/main/config.json | 1 | high |
| Qwen/Qwen3.6-27B | `tokenization.tokenizer_access` | HF AutoTokenizer (Qwen/Qwen3.6-27B) or tiktoken | HF AutoTokenizer.from_pretrained('Qwen/Qwen3.6-27B') | https://huggingface.co/Qwen/Qwen3.6-27B | 1 | high |
| Qwen/Qwen3.6-27B | `tokenization.chars_per_token_estimate` | 3.5 | null | https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md | 1 | low |
| Qwen/Qwen3.6-27B | `tokenization.image_token_rule` | Variable tile-based patching; number of tokens depends on image resolu… | Variable: the vision encoder patches an image into a resolution-depend… | https://www.alibabacloud.com/help/en/model-studio/vision | 1 | medium |
| Qwen/Qwen3.6-27B | `tokenization.count_tokens_method` | from transformers import AutoTokenizer; tok = AutoTokenizer.from_pretr… | from transformers import AutoTokenizer; tok = AutoTokenizer.from_pretr… | https://huggingface.co/Qwen/Qwen3.6-27B | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `tools_mcp.max_connected_servers` | null | 10 | https://www.alibabacloud.com/help/en/model-studio/mcp | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `self_host.param_variants` | 35B total parameters, 3B active (MoE: 256 experts, 8 routed + 1 shared… | 35B total / 3B activated MoE (256 experts, 8 activated per token) | https://huggingface.co/Qwen/Qwen3.6-35B-A3B | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `self_host.serving_frameworks` | vLLM (>=0.19.0), SGLang (>=0.5.10), KTransformers, HuggingFace Transfo… | vLLM (>= 0.19.0), SGLang (>= 0.5.10), HuggingFace Transformers, Ollama… | https://huggingface.co/Qwen/Qwen3.6-35B-A3B | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `release_date` | 2026-04-27 | 2026-04 | https://huggingface.co/Qwen/Qwen3.6-35B-A3B | 1 | medium |
| Qwen/Qwen3.6-35B-A3B | `cost.output_per_mtok_usd` | 0.9 | 2.25 | https://www.alibabacloud.com/help/en/model-studio/model-pricing | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `cost.input_per_mtok_usd` | 0.14 | 0.375 | https://www.alibabacloud.com/help/en/model-studio/model-pricing | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `cost.batch_discount` | 50% off for eligible models on DashScope Batch Invocation | null | https://www.alibabacloud.com/help/en/model-studio/batch-inference | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `cost.cached_input_per_mtok_usd` | 0.05 | null | https://www.alibabacloud.com/help/en/model-studio/context-cache | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `tokenization.tokenizer_family` | Qwen3 tiktoken BPE (vocab ~151,643 tokens) | Qwen3.5-generation byte-level BPE (tokenizer_class Qwen2Tokenizer), vo… | https://huggingface.co/Qwen/Qwen3.6-35B-A3B | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `tokenization.tokenizer_access` | HF AutoTokenizer (Qwen/Qwen3.6-35B-A3B) or tiktoken | HF AutoTokenizer.from_pretrained('Qwen/Qwen3.6-35B-A3B') | https://huggingface.co/Qwen/Qwen3.6-35B-A3B | 1 | high |
| Qwen/Qwen3.6-35B-A3B | `tokenization.chars_per_token_estimate` | 3.5 | null | https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md | 1 | low |
| Qwen/Qwen3.6-35B-A3B | `tokenization.image_token_rule` | Variable tile-based patching via vision encoder | Variable: the vision encoder patches an image into a resolution-depend… | https://www.alibabacloud.com/help/en/model-studio/vision | 1 | medium |
| Qwen/Qwen3.6-35B-A3B | `tokenization.count_tokens_method` | from transformers import AutoTokenizer; tok = AutoTokenizer.from_pretr… | from transformers import AutoTokenizer; tok = AutoTokenizer.from_pretr… | https://huggingface.co/Qwen/Qwen3.6-35B-A3B | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `tools_mcp.max_connected_servers` | null | 10 | https://www.alibabacloud.com/help/en/model-studio/mcp | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `self_host.param_variants` | 35B total parameters, 3B active (MoE: 256 experts, 8 routed + 1 shared… | 35B total / 3B activated MoE (256 experts, 8 activated per token); the… | https://huggingface.co/Qwen/Qwen3.5-35B-A3B/raw/main/config.json | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `self_host.serving_frameworks` | vLLM (main branch or >=nightly), SGLang (main branch), KTransformers, … | vLLM, SGLang, HuggingFace Transformers, Ollama (quantized GGUF) | https://docs.vllm.ai/projects/recipes/en/stable/Qwen/Qwen3.5.html | 2 | high |
| Qwen/Qwen3.5-35B-A3B | `release_date` | 2026-02-24 | 2026-02-16 | https://github.com/QwenLM/Qwen-Agent | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `cost.output_per_mtok_usd` | 0.4 | 2.0 | https://www.alibabacloud.com/help/en/model-studio/model-pricing | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `cost.input_per_mtok_usd` | 0.1 | 0.25 | https://www.alibabacloud.com/help/en/model-studio/model-pricing | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `cost.batch_discount` | 50% off for Batch Invocation (async); qwen3.5-flash supports batch | null | https://www.alibabacloud.com/help/en/model-studio/batch-inference | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `tokenization.tokenizer_family` | Qwen3 tiktoken BPE (vocab ~151,643 tokens) | Qwen3.5-generation byte-level BPE (tokenizer_class Qwen2Tokenizer), vo… | https://huggingface.co/Qwen/Qwen3.5-35B-A3B/raw/main/config.json | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `tokenization.tokenizer_access` | HF AutoTokenizer (Qwen/Qwen3.5-35B-A3B) or tiktoken | HF AutoTokenizer.from_pretrained('Qwen/Qwen3.5-35B-A3B') | https://huggingface.co/Qwen/Qwen3.5-35B-A3B | 1 | high |
| Qwen/Qwen3.5-35B-A3B | `tokenization.chars_per_token_estimate` | 3.5 | null | https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md | 1 | low |
| Qwen/Qwen3.5-35B-A3B | `tokenization.image_token_rule` | Variable tile-based patching via vision encoder | Variable: the vision encoder patches an image into a resolution-depend… | https://www.alibabacloud.com/help/en/model-studio/vision | 1 | medium |
| Qwen/Qwen3.5-35B-A3B | `tokenization.count_tokens_method` | from transformers import AutoTokenizer; tok = AutoTokenizer.from_pretr… | from transformers import AutoTokenizer; tok = AutoTokenizer.from_pretr… | https://huggingface.co/Qwen/Qwen3.5-35B-A3B | 1 | high |
| provider | `skills_concept` | Qwen-Agent plugin/tool system | Qwen-Agent tools/plugins + Qwen Code MCP servers (no packaged skill fo… | https://github.com/QwenLM/Qwen-Agent | 1 | high |

### The four changes that matter most

**1. `max_connected_servers`: `null` → `10` (all three existing models).** Tier 1, high confidence.
Model Studio's MCP reference states **"Maximum 10 MCP servers."** Scope is **aggregate per request**,
enforced at the **hosted-API layer** on the Responses API path only ("Available through the Responses
API only"; "Supports MCP servers using the SSE protocol"). It bounds *servers*, not *tools* — there is
still no documented per-request tool-count cap and still no per-MCP-server tool cap. Self-hosted
deployments and the Qwen-Agent / Qwen Code hosts are outside its scope.

**2. Tokenizer identity corrected on all three models.** `Qwen3 tiktoken BPE (vocab ~151,643 tokens)`
→ `Qwen3.5-generation byte-level BPE (tokenizer_class Qwen2Tokenizer), vocab_size 248,320`. The old
figure is Qwen-7B's ("151,643 regular tokens and 208 control tokens"), from the Qwen1 tokenization
note. Verified independently in `Qwen3.6-27B/config.json`, `Qwen3.5-35B-A3B/config.json` and
`Qwen3.8-27B/config.json` (all `vocab_size: 248320`, `model_type: qwen3_5*`) and in
`tokenizer_config.json` (33 added tokens, ids 248,044–248,076). Consequence for this product: any
`generic_o200k` / `cl100k` estimate of a Qwen tool-definition footprint is off by a different factor
than previously assumed, and `chars_per_token_estimate` was nulled rather than carried over
(the 3.5 figure was derived from the smaller vocabulary and does not transfer).

**3. Pricing corrected to tier 1 on all three models.** The old values came from
`pricepertoken.com` (tier 3) and were, in one case, the price of a *different* model. Alibaba's
pricing page has a dedicated **"Text generation – Qwen (open source)"** table, Singapore
(International) region:

| id | old in / out | new in / out (tier 1) |
|---|---|---|
| `qwen3.6-27b` | $0.14 / $0.90 | **$0.60 / $3.60** |
| `qwen3.6-35b-a3b` | $0.14 / $0.90 | **$0.375 / $2.25** |
| `qwen3.5-35b-a3b` | $0.10 / $0.40 | **$0.25 / $2.00** |

Output is priced identically for "Non-Thinking" and "Thinking" modes, which is the tier-1 evidence
that the `<think>` trace bills as ordinary output.

**4. `cached_input_per_mtok_usd` and `batch_discount` → `null` on all three models.** The previous
entries asserted DashScope context caching and a 50% batch discount applied. They do not, for these
ids. The [context-cache reference](https://www.alibabacloud.com/help/en/model-studio/context-cache)
prices explicit cache at 10% and implicit at 20% of input, but its supported lists cover only the
commercial `qwen3.7-max/plus`, `qwen3.6-max-preview/plus/flash` and `qwen3.5-plus/flash` tiers — no
open-source id. The [batch-inference page](https://www.alibabacloud.com/help/en/model-studio/batch-inference)
documents "50% of the real-time inference price" but its supported list is
`qwen-max / qwen-plus / qwen-flash / qwen-turbo` (Singapore) plus commercial 3.7/3.6/3.5 tiers — again
no open-source id. `skills_context.prompt_caching` stays `true` but is now sourced to **self-hosted
vLLM prefix caching** (tier 2, `--enable-prefix-caching` in vLLM's own Qwen recipe), with the hosted
situation spelled out in its notes.

### Per-model MCP nuance worth flagging

Model Studio's MCP page lists the **"Qwen3.6 open-source series (except qwen3.6-27b)"**. So
`Qwen/Qwen3.6-27B` — the dense flagship — is the one id in this file explicitly **excluded** from the
hosted native-MCP path. Its `native_mcp` stays `true` (Qwen-Agent / Qwen Code work fine against it)
but the note now says so plainly. `Qwen3.6-35B-A3B` and `Qwen3.5-35B-A3B` are eligible; neither
Qwen3.8 id is listed yet.

---

## MCP limits at a glance — Alibaba (Qwen)

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| `Qwen/Qwen3.8-2.4T-A95B` | ✅ via Qwen-Agent / Qwen Code (**not** on the hosted Responses-API MCP list) | ✅ (chat template `<tools>`/`<tool_call>`; vLLM `--tool-call-parser qwen3_coder`) | `null` — no per-request numeric cap documented. Binding instead: **10 MCP servers aggregate** (hosted path, N/A here), ~30–50 selection cliff, 262,144-token window | 40 (tier 4, low) | 262,144 native / 1,010,000 YaRN | Serialized into the chat template's `<tools>` block → **billed as input tokens**; folded into the system message for cache-prefix purposes |
| `Qwen/Qwen3.8-27B` | ✅ via Qwen-Agent / Qwen Code (**not** on the hosted list) | ✅ (same) | `null` — same; window is 262,144 | 40 (tier 4, low) | 262,144 native / **1,000,000** YaRN | same |
| `Qwen/Qwen3.6-27B` | ✅ framework only — **explicitly excluded** from the hosted Responses-API MCP path | ✅ (tier 1, Model Studio function-calling reference) | `null` — same; **10 MCP servers aggregate** applies to the hosted path for sibling ids | 40 (tier 4, low) | 262,144 native / 1,010,000 YaRN | same |
| `Qwen/Qwen3.6-35B-A3B` | ✅ **hosted native MCP** (Responses API, SSE) + Qwen-Agent / Qwen Code | ✅ | `null` — **10 MCP servers aggregate** binds first on the hosted path | 40 (tier 4, low) | 262,144 native / 1,010,000 YaRN | same |
| `Qwen/Qwen3.5-35B-A3B` | ✅ **hosted native MCP** (Responses API, SSE) + Qwen-Agent / Qwen Code | ✅ | `null` — same | 40 (tier 4, low) | 262,144 native / 1,010,000 YaRN | same |

Anti-trap note, applied verbatim in every entry: the absence of an OpenAI-style 128-tool cap is
recorded as **"no per-request numeric cap on the number of tools is documented"**, always paired with
the limits that *do* bind — the aggregate 10-MCP-server ceiling on the hosted path, the empirical
~30–50-tool selection cliff, and the 262,144-token window shared by tool definitions, prompt,
reasoning trace and answer.

### Other tool/MCP limits recorded (identical across all five entries unless noted)

| field | value | scope / layer | source tier |
|---|---|---|---|
| `parallel_tool_calls` | `true` (`parallel_tool_calls` request parameter) | model API | 1 |
| `max_parallel_tool_calls_count` | `null` — boolean switch, no numeric ceiling published | model API | 1 |
| `tool_definition_shape` | `openai_function` | model API | 1 |
| `tool_defs_count_as_input` | `true` — "the tool definition is included in the system message for cache calculation" | model API | 1 |
| `tool_search_deferral` | `false` — nearest facility is Qwen Code's static `includeTools`/`excludeTools` + `mcp.allowed`/`mcp.excluded` globs | client | 1 |
| `max_tool_name_len` | `null` — only a naming *recommendation* is published | per-tool | 1 |
| `max_tool_description_len` | `null` | per-tool | 1 |
| `max_request_size` | `null` — no byte cap; throughput governed by 600 RPM / 1M–5M TPM per open-source id | model API | 1 |
| `max_tool_result_size` | `null` — bounded by the window / `--max-model-len` | serving | 2 |
| `tool_use_per_turn_limit` | `null` — Qwen Code documents a 10-minute per-tool-call `timeout`, no cycle cap | client | 1 |
| `max_connected_servers` | **10** (hosted Responses API, SSE only) | **aggregate / hosted API** | 1 |
| `max_total_tools` | `null` — derived ceiling ≈ (262,144 − headroom) ÷ avg tool-def tokens | aggregate | 2 |
| `strict_function_schema` | `false` | model API | 1 |

---

## Unresolved / undocumented

Fields left `null` (or at low confidence) because no public source states them. Each carries a `notes`
field in the JSON explaining the same.

- **`<all models>.knowledge_cutoff`** — Qwen publishes no cutoff date for the 3.5, 3.6 or 3.8 series;
  no model card states one. Searched all five HF model cards and the Model Studio model pages.
- **`<all models>.tokenization.chars_per_token_estimate`** — deliberately nulled. The prior 3.5 came
  from the Qwen1 tokenization note describing a 151,643-vocab tokenizer, which is not this
  generation's tokenizer. No vendor characters-per-token figure exists for the 248,320-vocab
  tokenizer. Searched: Qwen tokenization note, HF `config.json`/`tokenizer_config.json`,
  qwen.readthedocs, Alibaba's token-counting material.
- **`<all models>.tokenization.image_token_rule`** (value kept, confidence `medium`) — no closed-form
  pixels-per-token formula. Alibaba's vision reference says only that "the total token count for all
  images and text must not exceed the model's maximum input" and that the number of images per request
  is "determined by the model's total token limit". No 28×28-patch constant is published for this
  generation. Searched the Model Studio vision docs and all model cards.
- **`Qwen3.8-*.cost.{input,output,cached_input}_per_mtok_usd` and `.batch_discount`** — `null`. There
  is **no `qwen3.8` row of any kind** on Alibaba Cloud Model Studio's pricing page as of 2026-08-19
  (its Qwen open-source table stops at `qwen3.6-*`/`qwen3.5-*`; its commercial tiers stop at
  `qwen3.7-max/plus`). Tier-3 for reference only, recorded in notes and *not* used as a value:
  OpenRouter lists the hosted `qwen3.8-max` endpoint at $2/M in, $6/M out. Per the tiered-evidence
  rule, pricing is a hard field requiring tier 1 → null.
- **`Qwen3.8-*.context.max_output_tokens_default`** — `null`. Qwen3.8 drops the per-query default that
  the 3.5/3.6 cards carried ("an output length of 32,768 tokens for most queries"); the 3.8 cards give
  only a maximum allocation. vLLM's launch post suggests `max_tokens=128_000` for agentic workflows,
  which is guidance, not a model default.
- **`max_tools_hard` (all models)** — `null` by evidence, not by omission: Model Studio's
  function-calling reference documents the `tools` array with no maximum, and self-hosted vLLM/SGLang
  enforce no tool count. Recorded as "no per-request numeric cap documented" with the binding limits
  named.
- **`max_tools_practical` = 40 (tier 4, low confidence, all models)** — no Qwen-specific published
  degradation point exists. Anchored on
  [arXiv 2606.17519](https://arxiv.org/abs/2606.17519) ("Scaling Enterprise Agent Routing", 2026-06-16:
  routing F1 drops 16–23 percentage points across three frontier models as a catalog scales from
  10 agents to 110 agents / 584 tools) and [MCP-Atlas](https://arxiv.org/html/2602.00933v1) (exposes
  only 10–25 tools per task by design). Searched additionally:
  [arXiv 2605.24660](https://arxiv.org/html/2605.24660v1) ("How Many Tools Should an LLM Agent See?" —
  evaluates Claude Sonnet 4.6, no Qwen), the BFCL V4 leaderboard and the MCP-Mark leaderboard.
- **Two leaderboards could not be read.** `https://gorilla.cs.berkeley.edu/leaderboard.html` returned
  only the page shell without the table, and `https://llm-stats.com/benchmarks/mcp-mark` returned a
  "Quick verification / confirm humanity" interstitial instead of the leaderboard. Neither is cited as
  a source anywhere in the file. `https://docs.vllm.ai/en/stable/features/automatic_prefix_caching/`
  also returned navigation only, so the prefix-caching claim is sourced to vLLM's Qwen recipe (which
  passes `--enable-prefix-caching` explicitly) instead. `https://qwen.ai/blog?id=qwen3.8` fetched but
  returned only metadata/keywords with no article body, so it is not cited as a source.
- **`Qwen3.8-27B` release day (2026-08-14)** — tier 4 only; tier 1 gives month precision.
  **`Qwen3.6-*` release dates were reduced to month precision** (`2026-04`) for the same reason: the
  previous day-precision values rested on a tier-3 aggregator page that was not re-opened in this
  pass, and no opened source fixes the day. This is a deliberate precision *reduction* in exchange for
  a tier-1 source, not a data loss through carelessness.
- **`Qwen3.8-27B` serving-framework floor** — vLLM's recipe says "vLLM 0.17.0+", which is *lower* than
  the ">= 0.19.0" the Qwen3.6 cards require. Recorded at `medium` confidence with the conflict noted;
  the cards' own advice ("use the latest framework versions") is the safe reading.
- **Audio**: the shared 248,320-token vocabulary reserves `<|audio_start|>`, `<|audio_end|>` and
  `<|audio_pad|>` ids, but no card claims audio input for these checkpoints (audio is the separate
  Qwen3-Omni / Qwen3.5-Omni line). `audio_token_rule` is `null` with that explanation, so a future
  reader does not mistake vocabulary reservations for capability.

---

## Sources

Every URL below was opened with WebFetch (or surfaced and then opened) during this task. Tier in
brackets. Entries marked *(blocked)* returned no usable content and are **not** cited in the JSON.

**Tier 1 — vendor primary (HuggingFace model cards & config, Qwen repos, Alibaba Cloud docs)**

1. https://huggingface.co/Qwen — org listing (newest repos, "updated N days ago")
2. https://huggingface.co/models?search=Qwen%2FQwen3.8 — Qwen3.8 repo enumeration
3. https://huggingface.co/Qwen/Qwen3.8-27B
4. https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/README.md
5. https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/config.json
6. https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/tokenizer_config.json
7. https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B
8. https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B/raw/main/README.md
9. https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B/raw/main/config.json
10. https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B/raw/main/tokenizer_config.json
11. https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B/raw/main/LICENSE
12. https://huggingface.co/Qwen/Qwen3.6-27B
13. https://huggingface.co/Qwen/Qwen3.6-27B/raw/main/config.json
14. https://huggingface.co/Qwen/Qwen3.6-35B-A3B
15. https://huggingface.co/Qwen/Qwen3.5-35B-A3B
16. https://huggingface.co/Qwen/Qwen3.5-35B-A3B/raw/main/config.json
17. https://huggingface.co/Qwen/Qwen-AgentWorld-35B-A3B — (roster-exclusion evidence)
18. https://github.com/QwenLM/Qwen-Agent
19. https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/mcp/
20. https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/
21. https://qwen.readthedocs.io/en/latest/framework/function_call.html
22. https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md — (Qwen1; the source of the corrected vocab claim)
23. https://www.alibabacloud.com/help/en/model-studio/models
24. https://www.alibabacloud.com/help/en/model-studio/model-pricing
25. https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling
26. https://www.alibabacloud.com/help/en/model-studio/mcp
27. https://www.alibabacloud.com/help/en/model-studio/context-cache
28. https://www.alibabacloud.com/help/en/model-studio/batch-inference
29. https://www.alibabacloud.com/help/en/model-studio/rate-limit
30. https://www.alibabacloud.com/help/en/model-studio/vision
31. https://www.alibabacloud.com/help/en/model-studio/model-depreciation
32. https://www.alibabacloud.com/help/en/model-studio/newly-released-models
33. https://qwen.ai/blog?id=qwen3.8 — *(fetched; returned metadata only, no article body — not cited)*

**Tier 2 — tooling ground truth (serving stack)**

34. https://recipes.vllm.ai/Qwen/Qwen3.8-27B
35. https://docs.vllm.ai/projects/recipes/en/stable/Qwen/Qwen3.5.html
36. https://vllm.ai/blog/2026-08-12-qwen3.8
37. https://docs.vllm.ai/en/stable/features/automatic_prefix_caching/ — *(blocked: navigation shell only — not cited)*

**Tier 3 — aggregators (cross-check only, never a sole source for a hard number)**

38. https://openrouter.ai/qwen/qwen3.8-max
39. https://llm-stats.com/benchmarks/mcp-mark — *(blocked: bot-verification interstitial — not cited)*

**Tier 4 — practitioner / empirical**

40. https://arxiv.org/abs/2606.17519 — Scaling Enterprise Agent Routing (tool-count degradation anchor)
41. https://arxiv.org/html/2602.00933v1 — MCP-Atlas benchmark (10–25 tools/task design point)
42. https://arxiv.org/html/2605.24660v1 — How Many Tools Should an LLM Agent See? (no Qwen coverage)
43. https://nerdleveltech.com/how-many-tools-can-an-ai-agent-handle — (no Qwen coverage; not cited)
44. https://www.orcarouter.ai/blog/qwen-3-8-27b-release-date — Qwen3.8-27B weights-drop date
45. https://gorilla.cs.berkeley.edu/leaderboard.html — *(blocked: table not rendered — not cited)*

**Distinct URLs opened: 45.** Distinct URLs cited as `source_url` in the JSON: **32** — verified
programmatically that every cited URL is one that was actually opened in this task (the *blocked* /
metadata-only / no-Qwen-coverage pages are excluded).

---

## Remediation 2026-08-19

Scope: fix only the audit findings against `data/open-weight/alibaba-qwen.json`, plus the same class
of defect found elsewhere in that file (a value cited to a vendor page whose supported-model list
does not cover the model id). Every URL below was re-opened in this remediation pass.

**The root defect.** Alibaba's Model Studio MCP reference is a *hosted-platform* page. Its
supported-model list reads verbatim: *"Qwen-Max: Qwen3.7-Max series; Qwen-Plus: Qwen3.7-Plus series,
Qwen3.6-Plus series, Qwen3.5-Plus series; Qwen-Flash: Qwen3.6-Flash series, Qwen3.5-Flash series;
**Qwen3.6 open-source series (except qwen3.6-27b)**; Qwen3.5 open-source series"*, together with
*"Maximum 10 MCP servers."*, *"Available through the Responses API only"* and *"Supports MCP servers
using the SSE protocol"*. It therefore **excludes `qwen3.6-27b` by name** and **contains no Qwen3.8
entry at all**. For open weights, MCP is a serving-stack / agent-framework property (Qwen-Agent,
Qwen Code), not a hosted-platform one — so the per-model evidence has moved to each model's own
HuggingFace card / chat template and to the Qwen-Agent MCP guide.

| Finding | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| **BLOCKER** — `Qwen3.6-27B` `native_mcp = true` cited to a page that excludes the id | Re-sourced to the model's own HF card, whose *Agentic Usage* section says *"We recommend using Qwen-Agent to quickly build Agent applications with Qwen3.6"* and ships the literal `tools = [{'mcpServers': {"filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", …]}}}]` example, plus *"Qwen Code is an open-source AI agent for the terminal, optimized for Qwen models"*. Notes now record that MCP here is a framework property and quote the Model Studio exclusion. | `true` (unchanged) | https://huggingface.co/Qwen/Qwen3.6-27B | tier 1 / **high** |
| **BLOCKER** — `Qwen3.6-27B` `max_connected_servers = 10` | **Nulled.** The 10-server cap is real but governs the hosted Responses-API path that carves this id out. Searched the model card, the Qwen-Agent MCP guide (only *"Avoid defining unnecessary services to reduce overhead"*) and the Qwen Code MCP docs — no server-count cap. Notes name the limits that do bind (262,144-token window, ~30–50-tool cliff, agent host). | `null` | https://www.alibabacloud.com/help/en/model-studio/mcp | tier 1 / medium |
| **BLOCKER** — `Qwen3.8-2.4T-A95B` + `Qwen3.8-27B` `max_connected_servers = 10` (high) | **Nulled** on both ids: the page states the cap but lists no Qwen3.8 model. Notes explain the Model Studio cap exists and does not list these ids, and name what was searched (card, README, `tokenizer_config.json`, vLLM recipe, Qwen-Agent guide). | `null` | https://www.alibabacloud.com/help/en/model-studio/mcp | tier 1 / medium |
| **MINOR** — Qwen3.8 ids `function_calling` cited to the Model Studio function-calling page (lists Qwen3.6/3.5/3/2.5, no Qwen3.8) | Re-sourced to each model's own `tokenizer_config.json`, whose `chat_template` takes a `tools` argument and renders *"# Tools\n\nYou have access to the following functions:\n\n\<tools\>"* with *"If you choose to call a function ONLY reply in the following format with NO suffix:\n\n\<tool_call\>"*. | `true` (unchanged) | https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/tokenizer_config.json · https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B/raw/main/tokenizer_config.json | tier 1 / **high** |
| **MINOR** — Qwen3.8 ids `parallel_tool_calls` same citation | Re-sourced to the same chat templates (the 27B template iterates `{%- for tool_call in message.tool_calls %}`, so >1 call per assistant turn is representable) and **downgraded to medium** — no Qwen3.8-specific vendor page states parallel tool calling or exposes the `parallel_tool_calls` switch for these ids. | `true` (unchanged) | same `tokenizer_config.json` URLs | tier 1 / **medium** (was high) |
| **MINOR** — all five models `max_total_tools = null` cited to a vLLM recipe **named for Qwen3.5** | Re-pointed each entry at **its own** vLLM recipe and **re-graded tier 2 → 4** (a serving-framework doc, not a vendor spec). Each recipe was opened and documents `--max-model-len 262144` (+ `--enable-auto-tool-choice --tool-call-parser qwen3_coder`, except the 3.5-35B page which shows only `--max-model-len`) with no numeric ceiling on tool count. | `null` (unchanged) | https://recipes.vllm.ai/Qwen/Qwen3.8-2.4T-A95B · /Qwen3.8-27B · /Qwen3.6-27B · /Qwen3.6-35B-A3B · /Qwen3.5-35B-A3B | tier **4** / medium |

**Same-class fixes made in the same file (not separately listed by the auditor):**

| Field | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| Qwen3.8 ×2 `native_mcp` | Same defect as the 3.6-27B blocker (cited to a page listing no Qwen3.8). Re-sourced to the **Qwen-Agent MCP guide** (`mcpServers` dict passed in `function_list`; *"Pass the MCP configuration when initializing your agent"*; no server/tool cap) and downgraded — that guide's worked example is configured for `qwen3-max`, so it evidences the framework path, not the id. Notes state the hosted Responses-API MCP route is unavailable for these ids. | `true` (unchanged) | https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/mcp/ | tier 1 / **medium** (was high) |
| Qwen3.8 ×2 `max_tools_hard` | Kept `null`, **downgraded high → medium**, re-pointed to each model's own HF card, notes naming everything searched and the limits that bind. | `null` | https://huggingface.co/Qwen/Qwen3.8-27B · …/Qwen3.8-2.4T-A95B | tier 1 / **medium** (was high) |
| Qwen3.8 ×2 `tool_defs_count_as_input`, `tool_definition_shape` | Re-sourced to each model's own chat template (renders `tools` into a system-message `<tools>` block; requires *"an inner \<function=…\>\</function\> block … nested within \<tool_call\>\</tool_call\>"*), with the Model Studio context-cache page demoted to corroboration + coverage caveat. | `true` / `openai_function` (unchanged) | same `tokenizer_config.json` URLs | tier 1 / high |
| Qwen3.6-27B `max_tools_hard`, `max_total_tools`, `other_limits_notes` | Removed the "Maximum 10 MCP servers" cap from this id's binding-limits prose and replaced it with the limits that actually bind. | `null` (unchanged) | — | — |
| Qwen3.8 ×2 `max_tool_name_len`, `max_tool_description_len`, `max_request_size`, `max_parallel_tool_calls_count`, `strict_function_schema`, `other_limits_notes` | All still cite Model Studio pages (values are `null`/`false` absence claims). Added an explicit **coverage caveat** to each: the page's supported-model list contains no Qwen3.8 entry, so it records the vendor's Qwen tool-calling contract generally, not a statement about the id. | unchanged | unchanged | unchanged |

Untouched and still correct: `Qwen3.6-35B-A3B` and `Qwen3.5-35B-A3B` keep `max_connected_servers = 10`
and `native_mcp = true` on the Model Studio MCP page — both **are** covered by *"Qwen3.6 open-source
series (except qwen3.6-27b)"* / *"Qwen3.5 open-source series"*.

**URLs opened in this remediation pass:** the Model Studio MCP reference; the Model Studio
function-calling reference; `huggingface.co/Qwen/Qwen3.6-27B` (+ its raw `README.md`);
`huggingface.co/Qwen/Qwen3.8-27B` and `/Qwen3.8-2.4T-A95B` (+ their raw `README.md` and
`tokenizer_config.json`); the Qwen-Agent MCP guide; the five `recipes.vllm.ai/Qwen/…` pages;
`docs.vllm.ai/en/latest/features/tool_calling/` *(TOC-only render — not cited)*.

**File parses:** `python3 -c "import json;json.load(open('data/open-weight/alibaba-qwen.json'))"` ✓.
No provenanced object in the file lacks `as_of`; no non-null value lacks a `source_url`; no
"unlimited / no limit / no cap / doesn't apply" phrasing remains.
