# Meta (Llama / Muse) — dataset refresh, 2026-08-19

Vendor file: `/tmp/tcc/data/open-weight/meta-llama.json` (edited in place).
Previous research pass: 2026-06-21. Top-level `as_of` bumped to **2026-08-19**; `schema_version` unchanged (`1.0`).
Validated with `jsonschema` against `/tmp/tcc/schema/model-entry.schema.json` — **VALID**.

## Headline

The Llama line has not moved since April 2025, but **Meta has**. Between the last pass and today the
vendor shipped an entirely new model family under Meta Superintelligence Labs:

- **Muse Spark 1.1** (2026-07-09) on the new paid **Meta Model API**, then **Muse Spark 1.2** (2026-08-05),
  closed-weight, 1M context, OpenAI-SDK compatible, parallel function calling — and the first Meta model
  whose *own* launch material mentions MCP servers.
- **Muse Glimmer 30B** (2026-08-10) — Meta's **first open-weight model since Llama 4**, the first under a
  plain **Apache-2.0** licence with an **ungated** repo, distilled from Muse Spark, explicitly built for
  agentic tool use, and running on a single consumer GPU.

For an MCP-footprint tool the important inversion: Muse Glimmer's window is **131,072 tokens**, not
Llama 4 Scout's nominal 10M. Tool-definition footprint, tool-result size and the reasoning channel now
compete for a normal-sized budget again, and Muse Glimmer's **ATEM XML** tool shape has a different token
cost than the OpenAI function JSON most footprint tooling assumes.

## Models

### Validated (3 pre-existing entries, every field re-checked)

| id | status | outcome |
|---|---|---|
| `meta-llama/Llama-4-Scout-17B-16E-Instruct` | `ga` (unchanged) | 10M context, 2024-08 cutoff, 2025-04-05 release all re-confirmed on the model card. Sources re-pointed from the Maverick card / HF discussion threads to Scout's own card and to vLLM's doc source on `main`. |
| `meta-llama/Llama-4-Maverick-17B-128E-Instruct` | `ga` (unchanged) | 1M context, 2024-08 cutoff, 2025-04-05 release re-confirmed. Two values **downgraded to null** (see change table) because their sources no longer state them. |
| `meta-llama/Llama-4-Behemoth-288B-16E` | `preview` → **`deprecated`** | See "Retired". |

No Meta Llama model has been withdrawn: the `meta-llama` HuggingFace org still lists all 70 repos, and
neither Scout nor Maverick carries a deprecation notice. Both are, however, now **previous-generation** —
Meta has published no new Llama model since 2025-04-05.

### Added (2)

| id | display name | release | GA / availability | source |
|---|---|---|---|---|
| `meta-models/Muse-Glimmer-30B` | Muse Glimmer 30B | **2026-08-10** | `ga` — open weights, Apache-2.0, ungated HF repo, day-0 vLLM/Intel/AMD/Unsloth enablement | [HF model card](https://huggingface.co/meta-models/Muse-Glimmer-30B) (states "August 2026"); exact day fixed by [SiliconANGLE 2026-08-10](https://siliconangle.com/2026/08/10/meta-releases-open-source-muse-glimmer-model-30b-parameters/), [vLLM PR #51655](https://github.com/vllm-project/vllm/pull/51655) and the [Intel day-0 blog](https://huggingface.co/blog/MatrixYao/muse-glimmer-day0), all dated 2026-08-10 |
| `muse-spark-1.2` | Muse Spark 1.2 (Meta Model API) | **2026-08-05** | `preview` — Meta Model API is a **public preview** (1.1 launched US-developer-only with $20 free credits); no GA declaration found | [Meta AI Research launch post](https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2); context window from [Meta's own model page](https://developer.meta.com/ai/models/muse-spark/) |

**Scope note on `muse-spark-1.2`.** This is a *closed-weight, hosted, paid* model recorded in a file whose
`provider.group` is `open_weight`. It is here because the dataset has no `data/saas/meta.json`, and omitting
it would hide Meta's actual current-generation flagship — and the only Meta model with first-party MCP
wording — from the recommender. Consumers filtering this file by group should exclude id `muse-spark-1.2`.
This is flagged in the entry's own `notes`.

Not added as separate entries: **Muse Spark 1.0** (2026-04-08) and **Muse Spark 1.1** (2026-07-09) are
superseded points on the same line and are recorded in `muse-spark-1.2`'s lineage notes; **Muse Code** is an
agent harness (a terminal coding agent powered by Muse Spark 1.2), not a model.

### Retired / superseded (1)

| id | old status | new status | why |
|---|---|---|---|
| `meta-llama/Llama-4-Behemoth-288B-16E` | `preview` | **`deprecated`** | Announced 2025-04-05 as "still training"; 16 months later the weights have never been published. Re-verified 2026-08-19: the [`meta-llama` HF org](https://huggingface.co/meta-llama) lists 70 models and contains **no Behemoth repository**, and nothing newer than the April 2025 Llama 4 pair. A [2026 retrospective](https://codersera.com/blog/llama-4-complete-guide-2026/) records it as never shipped, never formally cancelled, and effectively abandoned after Muse Spark launched in April 2026. Entry retained in full (never deleted, id unchanged); every field beyond announcement-level architecture stays null. |

## Changed values

Only rows where the **`value`** itself changed. (Many more fields had `as_of`, `source_url`, `source_tier`,
`confidence` or `notes` refreshed without a value change — e.g. every Llama 4 `tools_mcp` source was
re-pointed from the rendered vLLM docs site to the doc source on `main`, where the Llama 4 line is still
present verbatim; and both Llama 4 `prompt_caching` entries moved off a tier-3 blog onto that tier-2 source.)

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| _provider_ | `skills_concept` | `null` | `"Muse Code bundled skills (/plan, /grill, /goal) — agent-harness level only"` | https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2 | 1 | medium |
| Llama 4 Maverick | `context.max_output_tokens_max` | `16384` | **`null`** | https://openrouter.ai/meta-llama/llama-4-maverick | 3 | low |
| Llama 4 Maverick | `context.max_input_tokens` | `1032192` (derived) | **`null`** | https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct | 1 | low |
| Llama 4 Scout | `tokenization.tokenizer_family` | `"…~200K base tokens + 2048 special tokens"` | `"…~200K base tokens + 2,048 special tokens"` (wording only) | https://github.com/meta-llama/llama-models/blob/main/models/llama4/tokenizer.py | 1 | high |
| Llama 4 Maverick | `tokenization.tokenizer_family` | same wording change | same | https://github.com/meta-llama/llama-models/blob/main/models/llama4/tokenizer.py | 1 | high |
| Llama 4 Scout | `tools_mcp.tool_definition_shape` | `"llama4_pythonic (Llama chat-template tool format); …"` | `"llama4_pythonic (Llama 4 chat-template tool syntax); OpenAI function JSON when served behind a vLLM/SGLang OpenAI-compatible endpoint"` | https://github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md | 2 | high |
| Llama 4 Maverick | `tools_mcp.tool_definition_shape` | same | same (re-worded to match the doc on `main`) | https://github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md | 2 | high |
| Llama 4 Scout | `self_host.param_variants` | `"17B active parameters / 109B total …"` | tightened wording, same facts (17B active / 109B total, 16 experts, BF16 + int4) | https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct | 1 | high |
| Llama 4 Maverick | `self_host.param_variants` | `"17B active parameters / 400B total …"` | tightened wording, same facts (17B active / 400B total, 128 experts, BF16 + FP8) | https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct | 1 | high |
| Llama 4 Scout | `self_host.serving_frameworks` | `"… TGI (HF, maintenance mode) …"` | `"… TGI (maintenance mode) …"` (wording only) | https://blog.vllm.ai/2025/04/05/llama4.html | 1 | high |
| Llama 4 Behemoth | `status` (not a provenanced value) | `preview` | `deprecated` | https://huggingface.co/meta-llama | 1 | high |

**Why two Maverick values became `null`.** The prior pass derived `max_input_tokens` from a `max_output_tokens_max`
of 16,384. On 2026-08-19 no source I could open still publishes that figure for Maverick: OpenRouter's
Maverick page no longer shows a max-output row (its Scout page still shows 16,384, so Scout keeps the value),
Groq's Maverick model card publishes only a 128K context window and no completion cap, and Meta has never
documented one. Per the dataset's own rule — an unsourced number is worse than a null — both were nulled with
notes pointing at the limit that actually binds (the serving stack's `--max-model-len`, or the hosted
endpoint's context cap).

**Notable non-value corrections worth a reviewer's eye:**

- `provider.api_docs_url` moved from `https://www.llama.com/docs/overview` to
  `https://developer.meta.com/ai/docs/overview/` — `llama.com/docs/overview` and `llama.com/models/llama-4`
  now return **302** to `developer.meta.com/ai/…`.
- Both Llama 4 `context_window_tokens` and `native_context_config` are now marked **`derived: true`**: the
  exact integers (10,485,760 and 1,048,576) come from expanding the model cards' "10M"/"1M", because
  `config.json` in both repos is **gated and returns HTTP 401 anonymously** (verified today). The prior pass
  cited HF discussion threads for those integers; those citations were replaced.
- Both Llama 4 entries gained a hosted-reality note: **Groq serves Scout and Maverick at 128K**, and
  OpenRouter advertises 1,310,720 for Scout — i.e. the headline 10M/1M are self-hosted, multi-node ceilings,
  not what a caller gets.

## MCP limits at a glance — Meta

| model | native_mcp | function_calling | max_tools_hard (+ scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| Llama 4 Scout 17Bx16E | **false** — bridged by the serving/agent layer | true (`llama4_pythonic`) | `null` — no per-request numeric cap documented at any layer (open weights have no vendor API to enforce one). Binding, all **AGGREGATE**: the shared window (10M documented; 1.31M on OpenRouter; **128K on Groq**), `--max-model-len`, host-app tool budget (Cursor ~40 / Claude Desktop ~100), and the tool-selection cliff. **No documented per-MCP-server cap.** | `null` — no model-specific published degradation point | 10,485,760 (shared in+out; derived from card's "10M") | Serialized into the prompt by the chat template → **input tokens** |
| Llama 4 Maverick 17Bx128E | **false** — same | true (`llama4_pythonic`) | `null` — same shape; window is 1M documented / **128K on Groq** | `null` — same | 1,048,576 (shared; derived from card's "1M") | **input tokens** |
| Llama 4 Behemoth 288Bx16E | **false** (family-consistent) | `null` — never released | `null` — never released, no serving stack, no API layer | `null` | `null` — never documented | n/a — never released |
| **Muse Glimmer 30B** *(new)* | **false** — emits **ATEM XML** (`<atem:function_calls>` / `<atem:invoke>` / `<atem:parameter>`), an MCP host must still translate `tools/list`. MCP-shaped *training* is real (benchmarked on **MCP-Atlas**, τ³-Bench, DeepSearch QA, SWE-Bench; "scaffold compatibility" with OpenClaw / Hermes Agent) | **true** — headline capability | `null` — Meta's own cookbook states there is *no explicit guidance on maximum tool count or schema size*. Binding, all **AGGREGATE**: the **131,072-token** window shared by tool defs + reasoning channel + answer, `--max-model-len`, host-app budget, selection cliff. **No documented per-MCP-server cap.** | `null` — nothing model-specific published | **131,072** (community RoPE extension to 262,144 reported by Unsloth; tier-3, not vendor-documented) | Rendered into the prompt by the channel-scoped chat template → **input tokens**; ATEM XML framing costs differently from OpenAI function JSON for the same MCP tool |
| **Muse Spark 1.2** *(new, closed-weight)* | **false (medium confidence)** — Meta's tier-1 wording is that the model "zero-shot generalizes to new native tools, **MCP servers**, and custom skills"; that is generalization to tools *sourced from* MCP servers, not a request-level MCP connector. No `mcp` tool type or server-URL parameter documented. Flip to true if Meta documents one. | **true** — parallel function calling, OpenAI-SDK compatible at `https://api.meta.ai/v1` | `null` — none published; Meta's docs body is client-side rendered and unreadable, so *medium* not high. Binding, **AGGREGATE**: the 1,048,576-token window, undocumented request-size/rate limits, host-app budget. **No documented per-MCP-server cap.** | `null` | 1,048,576 | OpenAI function JSON in the request body → **input tokens**, billed at the input rate; a cache-read tier (~88% off, tier-3) would apply to a stable tool-definition prefix |

## Unresolved / undocumented

Fields left `null` for lack of a public source, and what was searched:

1. **`muse-spark-1.2` — every tool-shape limit** (`max_tool_name_len`, `max_tool_description_len`,
   `max_request_size`, `max_tool_result_size`, `max_parallel_tool_calls_count`, `tool_use_per_turn_limit`,
   `strict_function_schema`, `tool_schema_limits_notes`). Meta's tool-calling reference exists at
   `dev.meta.ai/docs/features/tool-calling` and `ai.developer.meta.com/docs/features/tool-calling`, but both
   render their body **client-side**: fetching returns only `<meta>` tags. Also tried `dev.meta.ai/docs/models/`,
   `dev.meta.ai/docs/overview/`, `developer.meta.com/ai/docs/overview/`,
   `developer.meta.com/ai/resources/blog/build-with-muse-spark/` — same result. Fell back to Meta's own
   `meta-models/meta-model-cookbook` GitHub repo (readable, tier 1), which documents the base URL, the key
   format and a function-calling recipe but **no limits**. Independent guides corroborate that the API is
   "documented sparsely, with no detailed model card."
2. **`muse-spark-1.2` — pricing** (`input_per_mtok_usd`, `output_per_mtok_usd`, `cached_input_per_mtok_usd`).
   **Null by policy, not by ignorance**: pricing is a tier-1-required field and Meta's pricing page is part of
   the same unreadable client-side docs. The tier-3/4 consensus — **$1.25/M in, $4.25/M out, $0.15/M cache
   read** — is recorded in each field's `notes` (OpenRouter, LLMReference, two independent developer guides,
   all mutually consistent).
3. **`muse-spark-1.2` — `max_output_tokens_max`, `knowledge_cutoff`, tokenizer identity, `input_output_shared`,
   `reasoning_billed_as_output`, `param_variants`.** No model card exists for any Muse Spark version; OpenRouter's
   1.2 page lists no max-output row. Deliberately did **not** infer the tokenizer from the distilled sibling
   Muse Glimmer (202,048-vocab BPE) — noted as suggestive, recorded as null.
4. **`meta-llama/Llama-4-Maverick` — `max_output_tokens_max` and the derived `max_input_tokens`.** Searched
   OpenRouter, Groq's model card, llm-stats (metadata only, body not returned) and Meta's card. Nulled; see above.
5. **`max_tools_practical` on all five entries.** No vendor or aggregator publishes a Meta-specific
   tool-selection degradation point. The circulating "~30–50 aggregate tools" figure is generic practitioner
   folklore; no source I opened states it for a Meta model, so it is recorded in `notes` as context and **not**
   as a value.
6. **Muse Glimmer — `max_output_tokens_max`, `max_tool_name_len`, schema limits.** Meta's OSS cookbook
   explicitly says it gives "no explicit guidance on token counting for tool definitions, maximum tool count,
   or schema size limits." The vLLM recipe's `--max-model-len 131072` is the operative bound and is recorded.
7. **Llama 4 `config.json` values.** Both repos are gated; `config.json` returns **HTTP 401** anonymously, so
   `native_context_config` / `context_window_tokens` are marked `derived: true` from the model cards' "10M"/"1M"
   rather than read from the file.
8. **Behemoth — everything.** Weights were never published; no repo exists on the `meta-llama` org.

## Notable Muse Glimmer operational findings (recorded in `other_limits_notes`)

- vLLM requires **both** `--tool-call-parser muse_glimmer` **and** `--reasoning-parser muse_glimmer`
  (vLLM ≥ 0.27.0): "the model does not emit JSON tool calls and does not wrap reasoning in tags."
  Omit either and tool calls are left unparsed in `content`.
- `tool_choice="required"` and **named tool choice are unsupported** — the parser sets
  `supports_required_and_named = False` so JSON guided decoding is deliberately not applied. You cannot force
  a specific tool, and tool arguments are not constrained-decoded.
- The correct stop set is `[<|eot|>, <|end_of_text|>]`; stopping on `<|eom|>` **collapses multi-tool turns**.
- An `<atem:invoke>` echoed inside a `to=self` reasoning block or a `to=user` answer is **not** a real call;
  the parser strips non-routed spans.
- As of 2026-08-19 the `muse_glimmer` parser was **not yet in vLLM's `tool_calling.md` on `main`** (enablement
  PR #51655 still open) — pin a build that contains it.
- Reasoning strength is set **in the system prompt** (`Reasoning strength: low|medium|high|xhigh`), so the
  system prompt is also the reasoning-budget control and trades directly against tool-definition headroom.

## Sources (every URL opened in this task)

**Meta first-party (tier 1)**
- https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/
- https://ai.meta.com/blog/introducing-muse-spark-msl/
- https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2
- https://developer.meta.com/ai/models/muse-glimmer/
- https://developer.meta.com/ai/models/muse-spark/
- https://developer.meta.com/ai/models/llama-4/ *(metadata only — client-side rendered)*
- https://developer.meta.com/ai/docs/overview/ *(metadata only)*
- https://developer.meta.com/ai/resources/blog/build-with-muse-spark/ *(metadata only)*
- https://dev.meta.ai/docs/overview/ *(metadata only)*
- https://dev.meta.ai/docs/models/ *(metadata only)*
- https://dev.meta.ai/docs/features/tool-calling *(metadata only)*
- https://ai.developer.meta.com/docs/features/tool-calling *(metadata only)*
- https://ai.developer.meta.com/docs/muse-glimmer/vllm *(metadata only)*
- https://www.llama.com/docs/overview *(302 → developer.meta.com/ai/docs/overview/)*
- https://www.llama.com/models/llama-4/ *(302 → developer.meta.com/ai/models/llama-4/)*
- https://github.com/meta-models/meta-oss-cookbook
- https://github.com/meta-models/meta-oss-cookbook/blob/main/agentic-fundamentals/README.md
- https://github.com/meta-models/meta-model-cookbook

**HuggingFace model cards / config (tier 1)**
- https://huggingface.co/meta-models/Muse-Glimmer-30B
- https://huggingface.co/meta-models/Muse-Glimmer-30B/blob/main/config.json
- https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF
- https://huggingface.co/meta-llama
- https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct
- https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct
- https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct/blob/main/config.json *(HTTP 401 — gated)*
- https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct/blob/main/config.json *(HTTP 401 — gated)*
- https://huggingface.co/blog/state-of-open-models-summer-2026
- https://huggingface.co/blog/MatrixYao/muse-glimmer-day0

**Serving-stack ground truth (tier 2)**
- https://github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md
- https://docs.vllm.ai/en/latest/features/tool_calling/
- https://docs.vllm.ai/en/stable/features/tool_calling/
- https://recipes.vllm.ai/meta-models/Muse-Glimmer-30B
- https://github.com/vllm-project/vllm/pull/51655

**Aggregators / hosts (tier 3)**
- https://openrouter.ai/meta/muse-spark-1.1
- https://openrouter.ai/meta/muse-spark-1.2
- https://openrouter.ai/meta-llama/llama-4-scout
- https://openrouter.ai/meta-llama/llama-4-maverick
- https://console.groq.com/docs/model/meta-llama/llama-4-scout-17b-16e-instruct
- https://console.groq.com/docs/model/meta-llama/llama-4-maverick-17b-128e-instruct
- https://llm-stats.com/models/llama-4-maverick *(metadata only)*
- https://www.llmreference.com/model/muse-spark-1.1/meta-model-api
- https://unsloth.ai/docs/models/muse-glimmer
- https://en.wikipedia.org/wiki/Muse_Spark

**Practitioner / press (tier 3–4, used only for dates and empirical context)**
- https://siliconangle.com/2026/08/10/meta-releases-open-source-muse-glimmer-model-30b-parameters/
- https://codersera.com/blog/llama-4-complete-guide-2026/
- https://www.datacamp.com/blog/muse-spark-1-1
- https://www.developersdigest.tech/blog/meta-muse-spark-1-1-developer-guide-2026

**46 distinct URLs fetched** (≈38 returned readable content; the rest returned metadata-only bodies, a 302, or a
gated 401 — each is labelled above and the consequence is reflected in a `null` + `notes` in the data file).

---

## Remediation 2026-08-19

Scope: fix only the audit findings against `data/open-weight/meta-llama.json`, plus the same class of
defect elsewhere in that file (a value cited to a page that does not discuss the model, and
serving-framework docs graded as tier 2). Every URL below was re-opened in this pass.

**The replacement source for Llama 4.** `meta-llama/llama-models` → `models/llama4/prompt_format.md`
is Meta's own model repository and is the complete tool contract Meta publishes for Llama 4:
*"All available functions can be provided either in the system message or in the user message"*,
introduced by *"Here is a list of functions in JSON format that you can invoke:"*, with pythonic
output `[func_name(param1=value1, param2=value2)]` (example: `[get_weather(city="San Francisco"),
get_weather(city="Seattle")]`), an alternative `<function=name>{…}</function>` form, and the sentence
*"The output supports multiple, and parallel tool calls natively"*. **It contains no reference to MCP.**

| Finding | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| **MAJOR** — Scout / Maverick / Behemoth `native_mcp = false` (high) cited to the Muse Spark launch post, which never mentions Llama 4 | Re-sourced to Meta's own Llama 4 prompt-format specification. Notes now argue from that page: it is the whole published tool interface for these ids and defines no MCP client, transport, connector or `mcp` tool type, so an MCP host must translate `tools/list` into JSON function definitions itself (scope: aggregate, never per server). Behemoth set to **medium** — it was never released and has no id-specific docs, so the value is inherited from the family spec. | `false` (unchanged) | https://github.com/meta-llama/llama-models/blob/main/models/llama4/prompt_format.md | tier 1 / **high** (Scout, Maverick) · **medium** (Behemoth) |
| **MAJOR** — `meta-models/Muse-Glimmer-30B` `native_mcp = false` (high) cited to a cookbook README with no MCP content | Re-sourced to the **model card**, and set the value to what that card supports: MCP-Atlas (Public) **75.5** (vs Gemma4-31B 54.2, Qwen3.6-27B 62.5), *"reliable tool use"* handling *"a wide range of function calls, invoking tools with precise schemas throughout extended workflows"*, and *"Muse Glimmer works across OpenClaw, Hermes Agent, and other agentic orchestration patterns"* under **Scaffold Compatibility**. That is a benchmark score on MCP-sourced tool tasks plus external-scaffold compatibility — not an in-model MCP client; the model emits ATEM blocks, not MCP messages. Downgraded to **medium** because the card never explicitly denies MCP. | `false` (unchanged) | https://huggingface.co/meta-models/Muse-Glimmer-30B | tier 1 / **medium** (was high) |
| **MINOR** — `muse-spark-1.2` `status = "preview"` unsupported by either cited page | Set to **`ga`**. Meta AI Research, 2026-08-05: *"Muse Spark 1.2 is available today in Muse Code and in Meta Model API with expanded global access."* Added a note to the model recording that what is preview/beta is the **platform**, not the model — the same post says *"Muse Code (beta)"* and the Muse Spark 1.1 post calls the Meta Model API *"in public preview"*. | `"ga"` (was `"preview"`) | https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2 | tier 1 / — |
| **MINOR** — Scout + Maverick `max_tools_hard` on a tier-2 vLLM GitHub doc at high confidence; neighbouring fields missing `as_of` | Moved `max_tools_hard` to the Meta prompt-format spec (which states no maximum) and **downgraded high → medium** (absence claim). Re-graded the vLLM tool-calling doc **tier 2 → 4** wherever it is still cited (`max_request_size`, `max_tool_result_size`, `max_total_tools`, `strict_function_schema`) with a note that it is a serving-framework doc, not a vendor spec. Stamped `as_of: "2026-08-19"` on every one. | `null` (unchanged) | https://github.com/meta-llama/llama-models/blob/main/models/llama4/prompt_format.md (hard cap) · https://github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md (serving-stack fields) | tier 1 / **medium** · tier **4** / medium |
| **Validator** — ~22 provenanced objects without `as_of`, 7 non-null values without `source_url` | Stamped `as_of: "2026-08-19"` on **every** provenanced object in the file (final sweep: 0 remaining). Resolved all 7 unsourced values: the four `chars_per_token_estimate = 3.5` entries were **nulled** (see below); Behemoth's `tool_defs_count_as_input`, `tool_search_deferral` and `strict_function_schema` were sourced to the Meta prompt-format spec. | see below | see below | see below |

**Same-class fixes made in the same file:**

| Field | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| Scout / Maverick `function_calling`, `parallel_tool_calls`, `tool_definition_shape`, `tool_search_deferral`, `tool_defs_count_as_input` | These are hard-limit-class fields that were resting on a serving-framework doc (or, for `tool_defs_count_as_input`, a third-party HuggingFace blog). Re-sourced to Meta's own prompt-format spec, quoting it. `tool_search_deferral` set to **medium** (absence claim). | `true` / `true` / unchanged / `false` / `true` | https://github.com/meta-llama/llama-models/blob/main/models/llama4/prompt_format.md | tier 1 / high (medium for `tool_search_deferral`) |
| Scout / Maverick `max_tool_name_len`, `max_tool_description_len`, `max_parallel_tool_calls_count` | Sourced the absence to the Meta spec and rewrote notes to name what binds instead (token budget; long namespaced MCP names cost tokens rather than being rejected; the parser is the risk, not an API error). | `null` (unchanged) | same | tier 1 / low |
| Scout / Maverick `tool_use_per_turn_limit`, `max_connected_servers` | Kept `null` (host-layer properties; Meta hosts no API for these weights). Sourced the absence to Meta's own prompt-format spec — the complete published tool contract, which says nothing about loop length and never mentions MCP at all — and rewrote the notes to name what was searched and what binds instead (the context window filling with tool results; the aggregate footprint of all connected servers). | `null` (unchanged) | https://github.com/meta-llama/llama-models/blob/main/models/llama4/prompt_format.md | tier 1 / low |
| `chars_per_token_estimate` on Scout, Maverick, Behemoth (`3.5`, tier 3, **no source**) and Muse-Glimmer (`3.5`, tier 3, no source) | **Nulled all four.** Meta publishes no characters-per-token figure: `models/llama4/tokenizer.py` builds a `tiktoken.Encoding` over the `O200K_PATTERN` regex with `num_reserved_special_tokens = 2048` and states no ratio (its only char constants are encoding guards, `TIKTOKEN_MAX_ENCODE_CHARS = 400_000` / `MAX_NO_WHITESPACES_CHARS = 25_000`). Muse Glimmer's tokenizer is public and ungated, so a 200K-class guess is indefensible against a 131,072-token window. | `null` (was `3.5`) | https://github.com/meta-llama/llama-models/blob/main/models/llama4/tokenizer.py · https://huggingface.co/meta-models/Muse-Glimmer-30B | tier 1 / low |
| Behemoth `max_request_size`, `max_tool_result_size`, `max_total_tools` | Citation moved from `docs.vllm.ai/en/stable/features/tool_calling/` (not readable in this pass) to the vLLM tool-calling doc actually opened, and **re-graded tier 2 → 4**. | `null` (unchanged) | https://github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md | tier **4** / medium |
| Muse-Glimmer `max_request_size`, `max_tool_result_size`, `max_total_tools`, `strict_function_schema`, `max_connected_servers` | Re-graded the vLLM recipe and the vLLM enablement PR **tier 2 → 4**. Recipe re-opened: `--max-model-len 131072`, `--tool-call-parser muse_glimmer` + `--reasoning-parser muse_glimmer`, no numeric ceilings; its only size warning is *"a tight budget can truncate before the final channel closes, returning empty content with finish_reason: stop"*. `max_connected_servers` sourced to the model card (host-layer property). | `null` / `false` (unchanged) | https://recipes.vllm.ai/meta-models/Muse-Glimmer-30B · https://github.com/vllm-project/vllm/pull/51655 · https://huggingface.co/meta-models/Muse-Glimmer-30B | tier **4** / medium · tier 1 / low |
| `muse-spark-1.2` fields citing `meta-models/meta-model-cookbook` | Added a coverage caveat to each: that repository documents **muse-spark-1.1** (*"1,048,576-token context window; the preview is free"*, *"drop-in compatible with the OpenAI SDK"*) and names no 1.2-specific tool limits. `tool_definition_shape` high → **medium**; `max_tools_hard` medium → **low**. | unchanged | https://github.com/meta-models/meta-model-cookbook | tier 1 / medium · low |

Left as-is and verified correct: the Muse-Glimmer ATEM fields (`tool_definition_shape`,
`parallel_tool_calls`, `tool_defs_count_as_input`, `max_tools_hard`) genuinely rest on the
`meta-oss-cookbook` agentic-fundamentals README, which was re-opened and does document
*"When Muse Glimmer calls a tool, it emits an ATEM block"*, the `<atem:function_calls>` /
`<atem:invoke>` / `<atem:parameter>` structure and *"It separates the reasoning block and each
non-final parallel tool call."* — it just has no MCP content, which is why only `native_mcp` moved.
The provider-level `native_mcp_support` keeps the Muse Spark post, which does contain the sentence it
quotes (*"It zero-shot generalizes to new native tools, MCP servers, and custom skills."*).

**URLs opened in this remediation pass:** `github.com/meta-llama/llama-models/.../llama4/prompt_format.md`
and `.../llama4/tokenizer.py`; `ai.meta.com/blog/introducing-muse-spark-meta-model-api/`;
`research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2`;
`huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct`;
`huggingface.co/meta-models/Muse-Glimmer-30B`;
`github.com/meta-models/meta-oss-cookbook/blob/main/agentic-fundamentals/README.md`;
`github.com/meta-models/meta-model-cookbook`; `recipes.vllm.ai/meta-models/Muse-Glimmer-30B`;
`github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md`;
`developer.meta.com/ai/docs/model-cards-and-prompt-formats/llama4/` *(client-rendered, empty body — not cited)*;
`docs.vllm.ai/en/latest/features/tool_calling/` *(TOC-only render — not cited)*.

**File parses:** `python3 -c "import json;json.load(open('data/open-weight/meta-llama.json'))"` ✓.
Zero provenanced objects without `as_of`; zero non-null values without a `source_url`; no
"unlimited / no limit / no cap / doesn't apply" phrasing remains.
