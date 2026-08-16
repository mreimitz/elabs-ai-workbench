# 01 — Information Structure Concept

> The comparison schema. Defines exactly what every provider subagent collects and where it goes,
> so 11 independent research tasks produce one consistent, machine-readable dataset.
> Pairs with the JSON Schema in [`schema/model-entry.schema.json`](./schema/model-entry.schema.json)
> and the blank [`schema/template.provider.json`](./schema/template.provider.json).

## 1. Design goals

- **Comparable:** identical fields for every model, SaaS or open-weight, so the recommendation
  engine can rank them on one axis at a time.
- **Machine-readable first:** JSON is the source of truth (matches the codebase's `*_json`
  conventions and is directly importable by `apps/api` / `packages/shared`). Markdown docs are a
  human-readable *projection* of the same facts, not a separate source.
- **Provenanced:** every factual field carries its source, tier, confidence, and as-of so the
  product can show "verified vs estimated" and so staleness is visible.
- **Maps to the existing model:** mirrors `04-token-counting-strategy.md` profiles and the
  `mcp_tool_scans` token-breakdown fields so a scan's footprint can be divided by a model's
  `context_window_tokens` directly.

## 2. File layout

```
token-context-comparison/
├─ 00-methodology.md
├─ 01-information-structure.md         ← this file
├─ README.md
├─ schema/
│   ├─ model-entry.schema.json         ← JSON Schema (validation)
│   └─ template.provider.json          ← blank file each subagent copies + fills
├─ data/
│   ├─ saas/                           ← anthropic.json, openai.json, google-gemini.json,
│   │                                    xai-grok.json, mistral.json, microsoft-copilot.json
│   └─ open-weight/                    ← meta-llama.json, deepseek.json, alibaba-qwen.json,
│                                        google-gemma.json, microsoft-phi.json
├─ docs/
│   ├─ saas/                           ← one .md per provider (human-readable write-up)
│   └─ open-weight/
└─ comparison/
    ├─ all-models.json                 ← merged index of every model (built by orchestrator)
    └─ comparison-matrix.md            ← cross-model tables, one per axis
```

One **provider file** = provider metadata + an array of its **3 latest models**.

## 3. The provenance pattern

Every factual field is a `Provenanced` object, not a bare value:

```json
{
  "value": 200000,
  "unit": "tokens",
  "source_url": "https://docs.claude.com/...",
  "source_tier": 1,
  "confidence": "high",
  "as_of": "2026-06-21",
  "derived": false,
  "notes": "GA window; 1M available via beta header — see extended_context"
}
```

Rules: `value` and `confidence` are always present. `value: null` means unknown — give a `notes`
reason, never guess. `source_tier ∈ {1,2,3,4}` (see methodology §4). `confidence ∈
{high, medium, low}`. `derived: true` when computed (e.g. `max_input = window − max_output`).
Bare booleans/strings are allowed only for non-factual descriptive fields (`notes`, enum labels).

## 4. Field dictionary

### 4.1 `provider` (object, once per file)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | slug, e.g. `anthropic`, `meta-llama` |
| `name` | string | display name |
| `group` | enum `saas` \| `open_weight` | which roster |
| `homepage` | url | |
| `api_docs_url` | url | Tier-1 API reference root |
| `tokenizer_docs_url` | url \| null | tokenizer / count-tokens docs |
| `native_mcp_support` | Provenanced(bool) | does the **platform** speak MCP natively |
| `skills_concept` | Provenanced(string) | provider's "skills" analog + how it loads (or `null`) |

### 4.2 `model[]` — identity

| Field | Type | Meaning |
|---|---|---|
| `id` | string | exact API model string (e.g. `claude-opus-4-8`) or HF repo id |
| `display_name` | string | e.g. `Claude Opus 4.8` |
| `family` | string | e.g. `Claude Opus`, `Llama 4` |
| `release_date` | Provenanced(date) | GA/release date |
| `status` | enum `ga`\|`preview`\|`deprecated` | |
| `knowledge_cutoff` | Provenanced(date) | training cutoff |
| `modalities` | string[] | `text`, `image`, `audio`, `video`, `pdf` |

### 4.3 `model.context` — **Axis 1 & 2**

| Field | Type | Meaning |
|---|---|---|
| `context_window_tokens` | Provenanced(int) | total window (GA) |
| `input_output_shared` | Provenanced(bool) | do input+output draw from one pool |
| `max_input_tokens` | Provenanced(int) | largest prompt (mark `derived` if computed) |
| `max_output_tokens_default` | Provenanced(int) | default completion cap |
| `max_output_tokens_max` | Provenanced(int) | max completion cap (note if param/beta-gated) |
| `extended_context` | Provenanced(int\|null) | beta/extended window (e.g. 1M); `null` if none |
| `reasoning_tokens_count_as_output` | Provenanced(bool\|null) | for reasoning models |

### 4.4 `model.tokenization` — **Axis 3**

| Field | Type | Meaning |
|---|---|---|
| `tokenizer_family` | Provenanced(string) | `o200k_base`, `cl100k_base`, `claude`, `gemini`, `sentencepiece/BPE`, HF id |
| `tokenizer_public` | Provenanced(bool) | can you run the exact tokenizer locally |
| `tokenizer_access` | Provenanced(string) | `tiktoken` \| HF repo \| `countTokens` API \| closed |
| `count_tokens_method` | Provenanced(string) | how to get an exact count (lib call / API endpoint) |
| `image_token_rule` | Provenanced(string\|null) | how images convert to tokens (tiles/patches) |
| `audio_token_rule` | Provenanced(string\|null) | tokens per second of audio, if any |
| `chars_per_token_estimate` | Provenanced(number\|null) | rough ratio for the `raw_json_rough` fallback |

### 4.5 `model.tools_mcp` — **Axis 5 (the core axis for this product)**

| Field | Type | Meaning |
|---|---|---|
| `function_calling` | Provenanced(bool) | native tool/function calling |
| `native_mcp` | Provenanced(bool) | model/endpoint accepts MCP directly (may inherit provider) |
| `parallel_tool_calls` | Provenanced(bool) | multiple tool calls per turn |
| `max_tools_hard` | Provenanced(int\|null) | API-enforced cap (e.g. OpenAI 128); `null` if none documented |
| `max_tools_practical` | Provenanced(int\|null) | empirical degradation point (Tier 4) |
| `tool_definition_shape` | Provenanced(string) | `openai_function` \| `anthropic_tool` \| `raw_mcp` \| `gemini_declaration` |
| `tool_defs_count_as_input` | Provenanced(bool) | ~always true; record the per-tool overhead if documented |
| `tool_search_deferral` | Provenanced(bool) | supports deferred/lazy tool loading |
| `max_tool_name_len` | Provenanced(int\|null) | char cap on tool name (e.g. OpenAI 64) |
| `max_tool_description_len` | Provenanced(int\|null) | char cap on a tool description |
| `max_request_size` | Provenanced(num\|null) | max request payload (set `unit`: MB/bytes) |
| `max_tool_result_size` | Provenanced(num\|null) | cap on a tool RESULT returned to the model |
| `max_parallel_tool_calls_count` | Provenanced(int\|null) | max simultaneous tool calls per turn |
| `tool_use_per_turn_limit` | Provenanced(int\|null) | max tool cycles before forced answer |
| `max_connected_servers` | Provenanced(int\|null) | client cap on connected MCP servers |
| `max_total_tools` | Provenanced(int\|null) | client aggregate cap across servers |
| `tool_schema_limits_notes` | string \| null | input-schema size / depth / keyword limits |
| `other_limits_notes` | string \| null | rate limits, transport, pagination, OAuth, etc. |

> See [`02-mcp-limits-taxonomy.md`](./02-mcp-limits-taxonomy.md) for what each limit means and which layer enforces it.

### 4.6 `model.skills_context` — **Axis 6**

| Field | Type | Meaning |
|---|---|---|
| `skills_supported` | Provenanced(bool) | does this model/platform expose a skills mechanism |
| `skills_loading_model` | Provenanced(string\|null) | `always_on` \| `progressive_disclosure` \| `tool_triggered` \| `n/a` |
| `skills_context_cost_notes` | string \| null | how skills consume context (system-prompt injection, tool stubs) |
| `system_prompt_overhead_notes` | string \| null | fixed system-prompt token cost, if known |
| `prompt_caching` | Provenanced(bool) | cache reuse of static prefix (tools/skills/system) |
| `memory_feature` | Provenanced(bool\|null) | persistent memory that adds to context |

### 4.7 `model.cost` — **Axis 4 & 7**

| Field | Type | Meaning |
|---|---|---|
| `input_per_mtok_usd` | Provenanced(number\|null) | USD / 1M input tokens (`null` + note for open-weight) |
| `output_per_mtok_usd` | Provenanced(number\|null) | USD / 1M output tokens |
| `cached_input_per_mtok_usd` | Provenanced(number\|null) | cached-read price |
| `batch_discount` | Provenanced(string\|null) | e.g. "50% off" |
| `billing_unit` | Provenanced(string) | `tokens` \| `characters` \| `compute` (self-host) |
| `multimodal_billing_notes` | string \| null | image/audio billing specifics |
| `reasoning_billed_as_output` | Provenanced(bool\|null) | are reasoning tokens charged at output rate |

### 4.8 `model.self_host` — **open-weight only** (`null` for SaaS)

| Field | Type | Meaning |
|---|---|---|
| `weights_url` | Provenanced(url) | HF / official repo |
| `license` | Provenanced(string) | e.g. `Llama 4 Community`, `Apache-2.0`, `MIT` |
| `param_variants` | Provenanced(string) | sizes / MoE active params |
| `native_context_config` | Provenanced(int) | window from `config.json` (`max_position_embeddings`) |
| `max_context_documented` | Provenanced(int) | extended via RoPE scaling, if documented |
| `serving_frameworks` | Provenanced(string) | vLLM / TGI / SGLang / Ollama support |
| `framework_tool_calling_notes` | string \| null | how tool-calling/MCP works when self-served |

### 4.9 Per-model tail

| Field | Type | Meaning |
|---|---|---|
| `notes` | string | anything important not captured above |
| `sources` | url[] | every source consulted for this model (bibliography) |

## 5. How this maps to the product

- `context_window_tokens` is the denominator for `mcp_scans.total_tokens` →
  **"% of window consumed by this server's tool definitions."**
- `tool_defs_count_as_input` + `tool_definition_shape` justify the existing
  `toOpenAIStyleTool` / `toClaudeStyleTool` adapters and tell the recommender which shape to count.
- `max_tools_practical` drives a **"tools loaded vs safe limit"** gauge per model.
- `input/output_per_mtok_usd` + `reasoning_billed_as_output` feed **cost-per-task / session** math.
- `prompt_caching` + `tool_search_deferral` are the levers the recommender can suggest to cut cost.

## 6. Markdown projection (`docs/<group>/<provider>.md`)

Each provider doc is generated from the same facts, in this fixed order so docs are comparable:
**Provider summary** (MCP/skills posture, tokenizer) → **per-model section** (one table per axis:
Context, Tokenization, Tools/MCP, Skills/context, Cost, [Self-host]) → **Provider takeaways for the
recommender** (when to pick, footprint headroom, cost profile) → **Sources**.
