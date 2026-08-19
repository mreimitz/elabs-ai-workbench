# DeepSeek — refresh report

**Vendor:** DeepSeek (`open_weight` group) · **File:** `/tmp/tcc/data/open-weight/deepseek.json`
**Previous research date:** 2026-06-21 · **This refresh:** 2026-08-19
**Result:** 5 model entries (2 added, 3 pre-existing re-verified and all 3 re-statused), `as_of` bumped to 2026-08-19, `schema_version` unchanged (1.0), JSON Schema validation passes.

---

## 1. Models

### Validated (pre-existing, re-verified field by field) — 3

| id | old status | new status | why |
|---|---|---|---|
| `deepseek-ai/DeepSeek-V4-Pro` | ga | **deprecated** | This is the **April 2026 preview** checkpoint (its HF card still says "We present a preview version of DeepSeek-V4 series"). Superseded 2026-08-13 by the GA checkpoint, which took over the hosted `deepseek-v4-pro` id. Weights remain published under MIT. |
| `deepseek-ai/DeepSeek-V4-Flash` | ga | **deprecated** | Preview checkpoint, superseded 2026-07-31: changelog states "the `deepseek-v4-flash` model has been updated to DeepSeek-V4-Flash-0731". Weights remain published under MIT. |
| `deepseek-ai/DeepSeek-V3.2` | ga | **deprecated** | Has no first-party hosted endpoint any more — the Models & Pricing page lists only `deepseek-v4-flash` and `deepseek-v4-pro`. Self-host-only legacy generation; weights still MIT and downloadable. (Judgement call: the schema `status` enum offers only ga/preview/deprecated, so "deprecated" is used for "superseded / no longer served".) |

No entry was deleted and no `id` was renamed.

### Added — 2

| id | display name | release / GA date | source |
|---|---|---|---|
| `deepseek-ai/DeepSeek-V4-Pro-0813` | DeepSeek-V4-Pro-0813 | **GA 2026-08-13** (app, web "Expert Mode", API; hosted id unchanged: `deepseek-v4-pro`) | [news260813](https://api-docs.deepseek.com/news/news260813/), [changelog](https://api-docs.deepseek.com/updates/), [HF card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813) |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | DeepSeek-V4-Flash-0731 | **released 2026-07-31** (public-beta API; hosted id unchanged: `deepseek-v4-flash`) | [changelog](https://api-docs.deepseek.com/updates/), [HF card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731) |

### Considered and deliberately NOT added

- `deepseek-ai/DeepSeek-V4-Pro-DSpark` / `deepseek-ai/DeepSeek-V4-Flash-DSpark` — both cards state verbatim: *"is not a new model. It is the same checkpoint with an additional speculative decoding module attached."* Recorded inside `self_host` on the corresponding entries instead of as roster models.
- `deepseek-chat` / `deepseek-reasoner` — legacy **aliases**, not models, and *"fully retired and inaccessible after Jul 24th, 2026, 15:59 (UTC Time)"* ([news260424](https://api-docs.deepseek.com/news/news260424/)). They are gone from the pricing page; recorded in the notes of the entries they used to route to.
- `DeepSeek-V3.2-Speciale` — a variant of an existing entry, captured in that entry's `self_host.weights_url` notes and `tool_schema_limits_notes` (it does **not** support tool calling).

### Retired

None removed. Three entries moved `ga → deprecated` (see table above).

---

## 2. Vendor-level facts that changed since 2026-06-21

These are the substantive findings; several land on the newly added GA entries rather than showing up as an in-place value diff.

1. **A hard tool cap now exists and is documented.** The Chat Completions reference states *"A max of 128 functions are supported."* `max_tools_hard` moves from `null` to **128** for the hosted API. **Scope: AGGREGATE** — it counts every function in one request's `tools` array (all connected MCP servers + host/built-in tools combined), not per MCP server.
2. **Tool-name cap now documented:** *"Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64."* `max_tool_name_len` `null → 64` (per-tool scope). MCP namespacing (`server__tool`) eats into this.
3. **Repricing 2026-08-16 16:00 UTC → peak/off-peak.** Off-peak is 50% of peak; peak hours are 01:00–04:00 and 06:00–10:00 UTC. Peak list rates are ~2–3× the old flat rates.
4. **Not MCP-native — now explicitly, not just by absence.** The Responses API compatibility table marks the `mcp` built-in tool "Ignored"; the Anthropic-compatible endpoint marks `mcp_servers` "Ignored" and `mcp_tool_use`/`mcp_tool_result` "Not Supported".
5. **Strict function-schema mode exists** (beta) — the old entries recorded `strict_function_schema: false`; corrected to `true` on the hosted GA entries with the real keyword subset recorded.
6. **Agentic cost trap, newly documented:** for any request carrying `tools`, the previous turn's `reasoning_content` **must** be echoed back in full or the API returns 400. Thinking-mode tool loops therefore re-pay for their own chain of thought as input on every step.
7. **Reasoning effort is now a 3-level knob:** `low` / `high` / `max`, default `high`; `medium` and `xhigh` are mapped to `high`.
8. **Concurrency limits published:** 500 (`deepseek-v4-pro`) / 2500 (`deepseek-v4-flash`) per account across all keys; connection closed if inference has not started within 10 minutes.

---

## 3. Changed values (pre-existing entries only)

24 provenanced fields changed value; a further 57 were re-sourced/re-scored (URL, tier or confidence) without a value change. Every field's `as_of` is now 2026-08-19.

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| DeepSeek-V4-Pro (preview) | status | ga | deprecated | https://api-docs.deepseek.com/news/news260813/ | 1 | — |
| DeepSeek-V4-Pro (preview) | context.max_input_tokens | 671744 | null | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro | 1 | low |
| DeepSeek-V4-Pro (preview) | context.max_output_tokens_max | 393216 | null | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro | 1 | low |
| DeepSeek-V4-Pro (preview) | cost.input_per_mtok_usd | 0.435 | null | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Pro (preview) | cost.output_per_mtok_usd | 0.87 | null | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Pro (preview) | cost.cached_input_per_mtok_usd | 0.003625 | null | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Pro (preview) | cost.billing_unit | tokens | compute | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Pro (preview) | tools_mcp.max_tools_practical | 30 | null | https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026 | 4 | low |
| DeepSeek-V4-Pro (preview) | tools_mcp.strict_function_schema | false | null | https://api-docs.deepseek.com/guides/tool_calls | 1 | low |
| DeepSeek-V4-Pro (preview) | tokenization.tokenizer_access | "HF AutoTokenizer (…V4-Pro) + encoding_dsv4 Python scripts in repo" | "HF AutoTokenizer + the repo's encoding_dsv4 encoding scripts" | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro | 1 | high |
| DeepSeek-V4-Pro (preview) | tokenization.count_tokens_method | AutoTokenizer OR deepseek_tokenizer.zip | AutoTokenizer / repo encoding scripts / `usage.prompt_tokens` | https://api-docs.deepseek.com/quick_start/token_usage | 1 | high |
| DeepSeek-V4-Flash (preview) | status | ga | deprecated | https://api-docs.deepseek.com/updates/ | 1 | — |
| DeepSeek-V4-Flash (preview) | context.max_input_tokens | 655360 | null | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash | 1 | low |
| DeepSeek-V4-Flash (preview) | context.max_output_tokens_max | 393216 | null | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash | 1 | low |
| DeepSeek-V4-Flash (preview) | cost.input_per_mtok_usd | 0.14 | null | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Flash (preview) | cost.output_per_mtok_usd | 0.28 | null | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Flash (preview) | cost.cached_input_per_mtok_usd | 0.0028 | null | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Flash (preview) | cost.billing_unit | tokens | compute | https://api-docs.deepseek.com/quick_start/pricing | 1 | high |
| DeepSeek-V4-Flash (preview) | tools_mcp.max_tools_practical | 30 | null | https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026 | 4 | low |
| DeepSeek-V4-Flash (preview) | tools_mcp.strict_function_schema | false | null | https://api-docs.deepseek.com/guides/tool_calls | 1 | low |
| DeepSeek-V4-Flash (preview) | tokenization.tokenizer_access | "HF AutoTokenizer (…V4-Flash) + encoding_dsv4 Python scripts" | "HF AutoTokenizer + the repo's encoding_dsv4 encoding scripts" | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash | 1 | high |
| DeepSeek-V4-Flash (preview) | tokenization.count_tokens_method | AutoTokenizer OR deepseek_tokenizer.zip | AutoTokenizer / repo encoding scripts / `usage.prompt_tokens` | https://api-docs.deepseek.com/quick_start/token_usage | 1 | high |
| DeepSeek-V3.2 | status | ga | deprecated | https://api-docs.deepseek.com/quick_start/pricing | 1 | — |
| DeepSeek-V3.2 | tools_mcp.max_tools_practical | 30 | null | https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026 | 4 | low |
| DeepSeek-V3.2 | tools_mcp.strict_function_schema | false | null | https://api-docs.deepseek.com/guides/tool_calls | 1 | low |
| DeepSeek-V3.2 | self_host.param_variants | "671B total / 37B active (MoE). FP8 quantized weights." | "671B total / 37B active (MoE); FP8 weights" (+ 685B card-headline conflict recorded) | https://huggingface.co/deepseek-ai/DeepSeek-V3.2/blob/main/config.json | 1 | medium |
| DeepSeek-V3.2 | self_host.serving_frameworks | "vLLM, SGLang, Transformers HF pipeline, Ollama (quantized variants)" | "vLLM, SGLang, Transformers" | https://huggingface.co/deepseek-ai/DeepSeek-V3.2 | 1 | high |

Notable **re-sourced-only** corrections (value unchanged, evidence replaced):

| model | field | what changed |
|---|---|---|
| provider | `native_mcp_support` | value stays `false`, but the note now cites two explicit vendor compatibility tables ("mcp" → Ignored; `mcp_servers` → Ignored) instead of the absence of a mention. |
| all | `tool_defs_count_as_input` | note now states honestly that DeepSeek never says this in one sentence — it follows from the OpenAI-compatible `usage` object plus the KV-cache guide. |
| all | `prompt_caching` | old note claimed the KV-cache guide documents tool-definition caching and cache pricing; it documents neither. Rewritten to what the page actually says (best-effort prefix units, cleared "within a few hours to a few days", `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, **no published minimum cacheable prefix**). |
| all | `max_request_size`, `max_tool_result_size` | were sourced to vLLM docs (tier 2); now sourced to DeepSeek's own Rate Limit & Isolation page (tier 1), which publishes concurrency + a 10-minute inference-start keep-alive and no byte cap. |
| V4 preview entries | `context.*`, `self_host.*` | every config-derived number re-read from the live `config.json` on 2026-08-19. |

Also fixed: the old `DeepSeek-V4-Pro.context.max_input_tokens` was internally inconsistent — value `671744` with a note deriving `655360`. The GA entry now carries the correct derivation (1048576 − 393216 = **655360**).

---

## 4. MCP limits at a glance — DeepSeek

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| **DeepSeek-V4-Pro-0813** (ga) | false — `mcp` built-in Ignored on Responses API; `mcp_servers` Ignored on /anthropic | true (OpenAI functions, Responses API functions, Anthropic tool blocks) | **128 — AGGREGATE** (all servers + host tools in one `tools` array); hosted-API layer only | 20 (tier 4, low — V4 measured 89%/81%/57% at 1/5/20+ tools) | 1,048,576 (1M); 393,216 max output | Serialized `tools` billed as `prompt_tokens`; cacheable only as part of a matching prefix (cache hit $0.044/1M peak vs $1.32/1M miss) |
| **DeepSeek-V4-Flash-0731** (ga) | false — same compatibility tables | true | **128 — AGGREGATE**, hosted-API layer | 20 (tier 4, low) | 1,048,576 (1M); 393,216 max output | Same; cache hit $0.014/1M peak vs $0.44/1M miss |
| **DeepSeek-V4-Pro** (preview, deprecated) | false | true (self-host, OpenAI-compatible) | null — no vendor-published per-request numeric cap binds these weights; the hosted 128 does not follow the checkpoint. Binding: serving-stack `--max-model-len` and the 1M window | null — no measurement for this checkpoint | 1,048,576 (config.json) | Input tokens; prefix caching depends on the serving framework |
| **DeepSeek-V4-Flash** (preview, deprecated) | false | true (self-host) | null — same as above | null | 1,048,576 (config.json) | Input tokens; serving-framework prefix cache |
| **DeepSeek-V3.2** (deprecated, self-host only) | false | true (first DeepSeek model with thinking-in-tool-use; **Speciale variant cannot call tools**) | null — no first-party hosted endpoint, so no vendor cap; binding limit is the 160K window | null | **163,840 (160K)** — tool definitions cost ~6.4× more as a share of the window than on V4 | Input tokens; serving-framework prefix cache |

**Scope reminder:** every number above that binds is *aggregate* (one request's whole `tools` array). There is no documented per-MCP-server tool cap anywhere in DeepSeek's docs — a server's ceiling is its share of the 128-function budget and of the context window.

---

## 5. Unresolved / undocumented

| field | models | what I searched | why it stays null |
|---|---|---|---|
| `knowledge_cutoff` | all 5 | HF cards (Pro-0813, Flash-0731, both previews, V3.2), api-docs changelog, news260424 / news260731 / news260813 | Never published by DeepSeek in any tier-1 source. |
| `max_tools_practical` | V4 previews, V3.2 | Berkeley Function-Calling Leaderboard (opened — the page I could reach carries methodology, not a tool-count sweep, and no DeepSeek rows), MCPAtlas coverage in the V4 report, practitioner guides | The only DeepSeek-specific sweep found (tier 4) measures **V4**; nothing measures the preview checkpoints or V3.2, so no number was carried over. Previous `30` had no DeepSeek evidence at all. |
| `max_tools_practical` (GA models) | V4-Pro-0813, V4-Flash-0731 | as above | Populated at **20** but tier 4 / low confidence: the source reports family-level "DeepSeek V4" figures, not per-snapshot ones. Empirical, not spec. |
| `max_output_tokens_default` | GA models | Chat Completions reference, Models & Pricing, thinking-mode guide | Only the MAXIMUM (384K) is published; the reference defers the range/default to docs that do not state it. |
| `max_tool_description_len` | all | Chat Completions reference | Field documented with no length constraint. Binding limits recorded instead (128-function aggregate cap, context window). |
| `max_request_size`, `max_tool_result_size` | all | Rate Limit & Isolation, Chat Completions reference | DeepSeek publishes concurrency and a keep-alive rule only — no byte cap. |
| `max_parallel_tool_calls_count` | all | Responses API guide, Anthropic-compat guide | Responses API ignores `max_tool_calls` and always enables parallel tool calling; no numeric ceiling is published. |
| minimum cacheable prefix (KV cache) | all | KV-cache guide | Not stated; only "best-effort" prefix units and a "few hours to a few days" lifetime. Recorded in `prompt_caching.notes`. |
| V3.2 release announcement | V3.2 | api-docs changelog | The live changelog reaches back only to the 2026-04-24 V4 entry; `news251201` could not be re-opened this pass, so `release_date.confidence` was lowered `high → medium` and re-sourced to the HF card. |

### Recorded source conflicts

- **V4-Pro parameter count:** HF `DeepSeek-V4-Pro-0813` model-size metadata reads **1.7T** vs the sibling `DeepSeek-V4-Pro-DSpark` card's **1.6T total / 49B activated** for the same architecture. Delta = the bundled DSpark speculative-decoding module. Recorded 1.6T/49B; conflict noted in `param_variants.notes`.
- **V4-Flash parameter count:** `DeepSeek-V4-Flash-0731` card headlines **304B** vs **284B / 13B activated** on the DSpark card and the changelog's "architecture and size unchanged from Preview". Recorded 284B/13B; conflict noted.
- **V3.2 parameter count:** V3.2 card headlines **685B** (checkpoint incl. MTP module) vs 671B/37B in the V4 report's comparison table. Recorded 671B/37B; conflict noted.
- **Pricing:** a tier-4 HuggingFace community post ("DeepSeek V4 GA: Architecture…") lists peak/off-peak rates at the *old* flat levels (Flash $0.14/$0.28). The tier-1 Models & Pricing page shows the post-2026-08-16 rates used here. Peak *windows* agree (09:00–12:00 & 14:00–18:00 Beijing = 01:00–04:00 & 06:00–10:00 UTC); only the price levels differ. Tier 1 wins.

---

## 6. Sources (every URL opened in this pass)

**DeepSeek official (tier 1)**
- https://api-docs.deepseek.com/updates/
- https://api-docs.deepseek.com/news/news260813/
- https://api-docs.deepseek.com/news/news260731/
- https://api-docs.deepseek.com/news/news260424/
- https://api-docs.deepseek.com/quick_start/pricing (and `/quick_start/pricing/`)
- https://api-docs.deepseek.com/quick_start/token_usage
- https://api-docs.deepseek.com/quick_start/rate_limit/
- https://api-docs.deepseek.com/api/create-chat-completion
- https://api-docs.deepseek.com/guides/tool_calls
- https://api-docs.deepseek.com/guides/responses_api/
- https://api-docs.deepseek.com/guides/anthropic_api
- https://api-docs.deepseek.com/guides/thinking_mode
- https://api-docs.deepseek.com/guides/kv_cache

**Hugging Face model cards / configs (tier 1)**
- https://huggingface.co/deepseek-ai
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813/blob/main/config.json
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731/blob/main/config.json
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/config.json
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/blob/main/config.json
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark
- https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-DSpark
- https://huggingface.co/deepseek-ai/DeepSeek-V3.2
- https://huggingface.co/deepseek-ai/DeepSeek-V3.2/blob/main/config.json

**Tier 3/4 (cross-check and empirical only)**
- https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026 — *only* source for `max_tools_practical`
- https://huggingface.co/blog/ResterChed/deepseek-v4-flash-official-release
- https://huggingface.co/blog/ResterChed/deepseek-v4-ga-architecture — pricing figures rejected in favour of tier 1
- https://huggingface.co/blog/deepseekv4
- https://lushbinary.com/blog/deepseek-v4-ai-agents-function-calling-mcp-guide/ — corroborates the 128-function cap and MCP-via-adapter
- https://techjacksolutions.com/ai-tools/deepseek/deepseek-v4-coding-and-agentic-workflows/ — checked, contains no tool-count data
- https://gorilla.cs.berkeley.edu/leaderboard.html — checked, no tool-count sweep reachable, no DeepSeek rows

**Note on blocked/limited fetches:** no fetch was hard-blocked. `https://gorilla.cs.berkeley.edu/leaderboard.html` returned framework/methodology text without the leaderboard table or a tool-count sweep, which is why the ~30–50-tool community figure could not be sourced and `max_tools_practical` was re-based on the presenc.ai measurement instead.

---

## 7. Validation

```
python3 -c "import json;json.load(open('/tmp/tcc/data/open-weight/deepseek.json'))"   # parses
jsonschema.validate(data, schema/model-entry.schema.json)                             # VALID
```
Additional automated checks run: every provenanced object carries only allowed keys; every non-null value carries a `source_url`; `confidence` ∈ {high,medium,low}; `source_tier` ∈ {1,2,3,4}; anti-trap phrase scan for "unlimited / no limit / no cap / doesn't apply" — clean.

---

## Remediation 2026-08-19

Scope: the audit findings re-opened against DeepSeek's own pricing page, changelog, release
posts and Hugging Face cards on 2026-08-19. Every URL below was opened in this pass and
contains the claim it is cited for. No model entry was deleted and no id was renamed.

| # | Finding | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|---|
| 1 | **cost.\*** on `DeepSeek-V4-Pro-0813` and `DeepSeek-V4-Flash-0731` recorded the peak-hour half of a two-tier clock schedule with no peak/off-peak dimension in the schema, so a cross-vendor comparison shows DeepSeek at 2× its typical rate for most of the day | **Decision recorded explicitly:** keep the **PEAK** rate as the value, because that is the base list rate the Models & Pricing page publishes and derives the other tier from (verbatim: *"Off-peak rates are half of the peak rates"*). Rewrote the notes on **all six** peak-bearing cost fields to carry the **full two-tier schedule** — both sets of numbers, the exact UTC windows, the hours-per-day split and the effective date — and lowered `confidence` to **medium** on all six to signal that one number cannot represent a clock-based rate. Also propagated both tiers into `cost.batch_discount`, `cost.reasoning_billed_as_output` and `skills_context.prompt_caching` notes (their values are not prices, so their confidence is unchanged) | Values unchanged (peak): Pro `input 1.32` / `output 3.96` / `cached_input 0.044`; Flash `input 0.44` / `output 1.32` / `cached_input 0.014`. Notes now state the off-peak halves (Pro 0.66 / 1.98 / 0.022; Flash 0.22 / 0.66 / 0.007), the windows **01:00–04:00 and 06:00–10:00 UTC (7 of 24 hours; every other hour is off-peak at exactly half)**, and that the schedule took effect **16:00 UTC on 2026-08-16** | https://api-docs.deepseek.com/quick_start/pricing (table + *"Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC (all other hours are off-peak)"*, *"Off-peak rates are half of the peak rates"*); https://api-docs.deepseek.com/updates/ (2026-08-13: *"we will adopt peak/off-peak pricing, with off-peak prices set at half of the peak-hour prices"*, effective *"16:00 (UTC Time) on August 16, 2026"*) | Tier 1 / **high → medium** on the six price fields |
| 2 | `DeepSeek-V4-Flash-0731.self_host.param_variants` recorded **284B total / 13B active** sourced to the **sibling** `DeepSeek-V4-Flash-DSpark` card, while the model's own card headlines **304B params** | Re-pointed the value at the model's **own primary card** and moved every sibling/announcement figure into the notes as an unresolved conflict, with a stated reading (architecture figure vs shipped-checkpoint total incl. embeddings + the bundled next-token-prediction/DSpark module) so a reader can reconstruct both. `source_url` moved off the sibling card | `"304B params total (MoE); FP4 experts + FP8 elsewhere"` — notes retain *"DeepSeek-V4-Flash with 284B parameters (13B activated)"* (DSpark card, whose own header reads 165B params), the 2026-04-24 post's *"DeepSeek-V4-Flash: 284B total / 13B active params"*, and the 2026-07-31 changelog's *"keeps the same model architecture and size as DeepSeek-V4-Flash-Preview"*; ~13B activated per token is named for MoE serving math | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731 (header *"304B params"*); corroborating detail from .../blob/main/config.json; conflict sources https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-DSpark, https://api-docs.deepseek.com/news/news260424/, https://api-docs.deepseek.com/updates/ | Tier 1 / **medium** (two tier-1 DeepSeek surfaces disagree) |
| 3 | `DeepSeek-V4-Pro-0813.self_host.param_variants` recorded **1.6T total / 49B active** while the repo metadata reads **1.7T** | Same treatment: value now agrees with the model's own card header; the 1.6T/49B figure is preserved in notes as the conflict, with the same architecture-vs-checkpoint reading and the activated count named for serving math | `"1.7T params total (MoE); FP4 experts + FP8 elsewhere"` — notes retain *"DeepSeek-V4-Pro with 1.6T parameters (49B activated)"* (DSpark card) and *"DeepSeek-V4-Pro: 1.6T total / 49B active params"* (2026-04-24 post), plus verified config.json architecture (61 layers, 384 routed experts, 6/token, 1 shared, fp8 e4m3 + `expert_dtype: fp4`, `num_nextn_predict_layers: 1`, DSpark block) | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813 (header *"1.7T params"*); .../blob/main/config.json; conflict sources https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark, https://api-docs.deepseek.com/news/news260424/ | Tier 1 / **high → medium** |
| 4 | Re-verify the three retired ids carry a **source** for retirement/supersession | `DeepSeek-V4-Pro` and `DeepSeek-V4-Flash` (April previews): supersession is now quoted and URL-cited inside `release_date.notes` from the **successors' own model cards** and the changelog, instead of resting on unsourced prose; successor card URLs added to each entry's `sources[]` | Values unchanged (`2026-04-24`, status `deprecated`). Notes now quote *"DeepSeek-V4-Pro-0813 is the official release of DeepSeek-V4-Pro, superseding the preview version"* and *"DeepSeek-V4-Flash-0731 is the official release of DeepSeek-V4-Flash, superseding the preview version"*, plus the changelog's "model name unchanged" statements and the pricing page's two-model roster | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813, https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731, https://api-docs.deepseek.com/updates/, https://api-docs.deepseek.com/quick_start/pricing | Tier 1 / high (unchanged) |
| 5 | Same-class defect found while doing #4: `DeepSeek-V3.2.release_date` had been downgraded to **medium** on the false claim that *"the api-docs changelog visible on 2026-08-19 only goes back to the 2026-04-24 V4 entry, so the original news251201 announcement could not be re-opened"* | Re-opened both pages. The changelog carries entries from **2024-05-17** onward including **2025-12-01**, and `news251201` opens normally. Corrected the note, re-pointed `source_url` to the announcement, restored confidence, and added the alias-retirement evidence for the `deprecated` status | `"2025-12-01"`, confidence **medium → high**. Notes now quote *"Both `deepseek-chat` and `deepseek-reasoner` have been upgraded to DeepSeek-V3.2"* (2025-12-01) and *"deepseek-chat & deepseek-reasoner will be fully retired and inaccessible after Jul 24th, 2026, 15:59 (UTC Time)"* (2026-04-24) | https://api-docs.deepseek.com/news/news251201/ (primary); https://api-docs.deepseek.com/updates/; https://api-docs.deepseek.com/news/news260424/; https://api-docs.deepseek.com/quick_start/pricing | Tier 1 / **medium → high** |
| 6 | Consistency sweep (same class as #2/#3) | `DeepSeek-V4-Flash-0731.self_host.serving_frameworks.notes` still read *"At 284B/13B active…"*, contradicting the corrected value; rewritten to the 304B checkpoint total with the activated figure attributed | notes only | https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731 | Tier 1 / high (unchanged) |

**`as_of` sweep:** every provenanced object in the file carries `"as_of": "2026-08-19"` (automated check: 0 exceptions).

**Not changed, and why:** the peak values themselves — both tiers were re-read on the vendor
pricing page this pass and the recorded numbers are correct as *peak* rates; the schema has no
place to store the second tier, so the fix is representational (documented decision + full
schedule in notes + medium confidence), not numeric. No off-peak value was invented into a
value field, and no averaged/blended rate was fabricated.

### Validation (post-remediation)

```
python3 -c "import json;json.load(open('/tmp/tcc/data/open-weight/deepseek.json'))"   # parses
jsonschema.validate(data, schema/model-entry.schema.json)                             # VALID
```
Re-run checks: provenanced objects carry only allowed keys; every non-null value has a
`source_url`; `as_of` == 2026-08-19 everywhere; anti-trap phrase scan ("unlimited / no limit /
no cap / doesn't apply") — clean.

---

## Final fixes 2026-08-19

Final-audit pass. Two defect classes on the two live checkpoints
(`deepseek-ai/DeepSeek-V4-Pro-0813`, `deepseek-ai/DeepSeek-V4-Flash-0731`); four `tools_mcp` fields
per checkpoint. No entry deleted, no id renamed, no figure invented. Every URL below was re-opened
in this pass.

### 1. Scope — hosted-API caps attached to open-weight ids

**The defect.** `max_tools_hard` = 128, `max_total_tools` = 128 and `max_tool_name_len` = 64 sat at
**tier 1 / HIGH confidence** on two **Hugging Face weight ids**. The cited text is real, but it
governs DeepSeek's **hosted API**, not the weights a user self-hosts.

**Verification.** Re-opened
[api-docs.deepseek.com/api/create-chat-completion](https://api-docs.deepseek.com/api/create-chat-completion).
It states "A max of 128 functions are supported." and that the function name "Must be a-z, A-Z, 0-9,
or contain underscores and dashes, with a maximum length of 64." Decisively, its `model` parameter
enumerates only hosted aliases — "Possible values: [`deepseek-v4-flash`, `deepseek-v4-pro`]" — not
`deepseek-ai/DeepSeek-V4-Pro-0813` or `deepseek-ai/DeepSeek-V4-Flash-0731`. The aliases currently
resolve to these checkpoints (already evidenced in this file's retired-preview entries), so the caps
**do** bind a caller of `api.deepseek.com`, and do **not** bind a self-hosted deployment of the same
weights, where the serving stack (`--tool-call-parser`, `--max-model-len`, KV cache) and the context
window consumed by serialized tool definitions are what bind.

**The fix.** Figures kept (they are tier-1 accurate for the hosted route and a real portability
constraint), enforcement layer stated explicitly at the top of every one of the six notes, and
**confidence lowered `high` → `low`** on all six — the signal that the value does not bind the
open-weight id it is recorded against, so the recommender must not treat it as binding for
self-hosting.

| Field (both checkpoints) | Value | Before | After | Notes now state |
|---|---|---|---|---|
| `max_tools_hard` | `128` (kept) | tier 1 / high | tier 1 / **low** | Enforced by the hosted API (model-API layer); the page's `model` enum quoted; AGGREGATE scope across all servers + built-ins; what binds self-hosting instead (served window ÷ avg tool-definition tokens, the accuracy cliff, host caps ~40/~100) |
| `max_total_tools` | `128` (kept) | tier 1 / high | tier 1 / **low** | Same rule recorded as the sum-across-servers budget; for self-hosted weights the ceiling is ≈ (served window − output/reasoning headroom) ÷ avg tool-definition tokens, set by the operator |
| `max_tool_name_len` | `64` (kept) | tier 1 / high | tier 1 / **low** | Validated by the hosted endpoint's request parser, not by the weights; vLLM/SGLang impose no such name rule; still a real **portability** risk because MCP clients namespace tool names and a long server prefix pushes a legal name past 64 |

**Convention match.** This is how the rest of the open-weight roster phrases it: the retired
DeepSeek preview ids in this same file already say "the hosted API's 128-function aggregate cap is
not enforced against this checkpoint"; Qwen's entries say "The hosted 'Maximum 10 MCP servers'
Responses-API cap does not cover this id"; Llama, Gemma and Phi record no vendor cap at all because
there is no vendor API layer to enforce one. DeepSeek is the only open-weight file that carries a
non-null hard cap, which is why the deviation is spelled out in every note rather than left implicit.

### 2. Attribution — `max_tools_practical` = 20 applied identically to Pro and Flash

**The defect.** The value came from a benchmark round-up that reports a **single undifferentiated
leaderboard entry, "DeepSeek V4"** (89% single-tool, 81% at 5 tools, 57% at 20+), and was then
applied identically to both checkpoints as if measured on each.

**The fix.** Value `20` kept on both at **tier 4 / low confidence** (unchanged), with the notes
rewritten to say exactly that: the source gives one family-level entry, does not separate Pro from
Flash, does not name a checkpoint (`-0813` / `-0731`), and does not state the serving stack, context
length or harness. The same figure is therefore recorded identically on both **as a family-level
number**, not split into invented per-variant values — the same correction convention already
applied to Gemma's three variants and Phi's four in this dataset. Directionality is called out per
checkpoint: for **Pro** a blended family figure is if anything pessimistic; for **Flash** it is if
anything **optimistic**, so the note says to treat 20 as an upper bound there. The alternative
offered — nulling the weaker of the two — is recorded in Flash's note as considered and rejected,
because the source's entry covers the whole V4 generation rather than Pro alone, so nulling Flash
would imply the measurement was Pro-specific when it is not.

**`as_of` sweep:** all eight edited objects carry `"as_of": "2026-08-19"`.

### Validation (post-fix)

```
python3 -c "import json;json.load(open('/tmp/tcc/data/open-weight/deepseek.json'))"   # parses
jsonschema.validate(data, schema/model-entry.schema.json)                             # VALID
```
Re-run checks on the eight edited objects: allowed provenanced keys only; every non-null value
carries a `source_url`; `confidence` ∈ {high,medium,low}; `source_tier` ∈ {1,2,3,4}; `as_of` ==
2026-08-19; anti-trap phrase scan ("unlimited / no limit / no cap / doesn't apply") — clean.
