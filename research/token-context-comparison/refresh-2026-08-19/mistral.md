# Mistral AI — dataset refresh report

**File:** `/tmp/tcc/data/saas/mistral.json`
**Previous `as_of`:** 2026-06-21 → **new `as_of`:** 2026-08-19
**Schema:** `1.0` (unchanged); validated with `jsonschema` against `schema/model-entry.schema.json` — **valid**.
**Distinct public URLs opened in this pass:** 41 (all listed at the bottom; all 34 URLs cited inside the JSON are drawn from that set).

---

## Models

### Validated (3 of 3 — all pre-existing entries re-verified field by field)

| id | display name | version / API string | status | verdict |
|---|---|---|---|---|
| `mistral-medium-3-5` | Mistral Medium 3.5 | v26.04 / `mistral-medium-3-5-26-04` (alias `mistral-medium-latest`) | `ga` (unchanged) | Still the flagship generalist. Release date 2026-04-28, 256k context, $1.5/$7.5 all re-confirmed on the model card and the API pricing table. |
| `mistral-small-2603` | Mistral Small 4 | v26.03 / `mistral-small-2603` (alias `mistral-small-latest`) | `ga` (unchanged) | Release 2026-03-16, 256k, $0.15/$0.60 re-confirmed. Not touched by any announced retirement. |
| `mistral-large-2512` | Mistral Large 3 | v25.12 / `mistral-large-2512` (alias `mistral-large-latest`) | `ga` (unchanged) | Release 2025-12-02, 256k, $0.5/$1.5 re-confirmed. Still listed as a current generalist model on the models overview. |

### Added (0)

**No model was added.** Between 2026-06-21 and 2026-08-19 Mistral shipped, per its own changelog and newsroom:

| date | release | why it is not in this roster |
|---|---|---|
| 2026-06-23 | **Mistral OCR 4.0** (`mistral-ocr-4-0`) | document-intelligence model, not a generalist chat/tool-calling model |
| 2026-06-30 / 2026-07-02 | **Leanstral 1.5** (`labs-leanstral-1-5`) | Lean 4 formal-proof specialist; *already scheduled to retire 2026-09-30* |
| 2026-07-08 | **Robostral Navigate** | embodied-navigation research model, not on the chat API |
| 2026-07-16 | **Mistral OCR 4.1** (`mistral-ocr-4-1`) | OCR, as above |
| 2026-08-11 | **GLM-5.2 by Z.ai** made available on the platform | third-party open model *hosted* by Mistral, not a Mistral model — belongs to Z.ai if the roster ever covers it |

Deliberately **not** added: the unnamed "fat but sparse" frontier MoE that CEO Arthur Mensch said entered **early access in July 2026** with research/government/industry partners. It has no name, no parameter count, no licence terms, no context window and no API availability published ([TechTimes, 2026-07-06](https://www.techtimes.com/articles/319798/20260706/mistral-ai-targets-frontier-gap-open-weight-model-entering-july-early-access.htm), tier 4). Adding it would mean inventing every field. **Watch item for the next refresh** — a broader release was signalled for "later this summer".

### Retired / deprecated (0 in this file)

No entry changed `status`. For context, the retirements in flight touch models this file does not carry: **Mistral Small 3.2** (retired 2026-07-31), **Mistral Medium 3** and **Mistral Medium 3.1** (both retiring **2026-08-31**, replacement Mistral Medium 3.5), announced 2026-05-22 — per the [deprecation tracker](https://llmlatency.dev/deprecations/mistral) (tier 3). Mistral does not publish a single consolidated tier-1 deprecation table; the models overview only lists what is current. **Mistral Medium 3.1 still appears in the Known Limitations context table at 128k even though it retires in 12 days** — treat that table as lagging.

---

## Changed values

22 provenanced **values** changed; on top of that **90** `source_url`s were repointed to pages that currently state the claim, **9** confidences were re-graded, and every one of the **131** provenanced fields got a refreshed `as_of` and a substantive `notes` rewrite. Rows below are the value changes plus the three material prose-block corrections.

| model | field | old | new | source URL | tier | conf |
|---|---|---|---|---|---|---|
| *(provider)* | `skills_concept` | "Agents — pre-configured model instances…" | "Skills — versioned, reusable instruction bundles … loaded on demand by description match; plus Agents and Conversations" | https://docs.mistral.ai/getting-started/quickstarts/studio/create-skill | 1 | high |
| *(provider)* | `native_mcp_support` (notes/source only) | Connectors beta, generic | same value `true`, repointed + per-tool org/workspace enable-disable, connector-scoped API keys, partial GA | https://docs.mistral.ai/studio/connectors | 1 | high |
| all 3 | `skills_context.skills_loading_model` | `always_on` | `progressive_disclosure` | https://docs.mistral.ai/vibe/work/skills | 1 | high |
| all 3 | `skills_context.prompt_caching` | `false` | `true` | https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching | 1 | high |
| mistral-medium-3-5 | `cost.cached_input_per_mtok_usd` | `null` | `0.15` (derived: 10% of $1.5) | https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching | 1 | medium |
| mistral-small-2603 | `cost.cached_input_per_mtok_usd` | `null` | `0.015` (derived: 10% of $0.15) | https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching | 1 | medium |
| mistral-large-2512 | `cost.cached_input_per_mtok_usd` | `null` | `0.05` (derived: 10% of $0.5) | https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching | 1 | medium |
| all 3 | `tools_mcp.max_tools_practical` | `40` (source_url **null**) | `20` | https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026 | 4 | low |
| all 3 | `tokenization.chars_per_token_estimate` | `4.0` (source_url **null**) | `null` | https://mistral.ai/news/mistral-nemo/ | 1 | low |
| all 3 | `tokenization.count_tokens_method` | `MistralTokenizer.v3(); tok.encode(text)` | `MistralTokenizer.from_hf_hub(...); encode_chat_completion(...)` | https://mistralai.github.io/mistral-common/usage/tokenizers/ | 2 | high |
| all 3 | `tokenization.tokenizer_access` | "tokenizer downloadable from HF Hub via mistral-common[hf-hub]" | "…`MistralTokenizer.from_hf_hub("<hf-model-id>")` pulls the Tekken tokenizer from the HF Hub" | https://mistralai.github.io/mistral-common/usage/tokenizers/ | 2 | high |
| medium-3-5 & small-2603 | `context.reasoning_tokens_count_as_output` | `null`, "not documented as a reasoning model" / "billing not documented" | `null`, but re-sourced: **both models take a per-request `reasoning_effort` of `none`\|`high`** and emit a `ThinkChunk`; accounting still unpublished | https://docs.mistral.ai/studio-api/conversations/reasoning | 1 | low |
| mistral-large-2512 | `context.reasoning_tokens_count_as_output` | `null`, conf low, source **null** | `null`, conf **medium**, now sourced: Large 3 is absent from the `reasoning_effort` model list | https://docs.mistral.ai/studio-api/conversations/reasoning | 1 | medium |
| all 3 | `tokenization.audio_token_rule` | notes claimed "audio transcription listed as a feature on the model card" | **corrected** — no model card lists audio; official HF cards give text+image in / text out; audio lives on the separate Voxtral models | model card + HF card | 1 | medium |
| all 3 | `tokenization.image_token_rule` | `null`, "not published" | `null`, now evidenced: the Vision page carries the FAQ heading *"How many tokens correspond to an image…"* **with no answer**; only published image constraint is 20 MB/image | https://docs.mistral.ai/capabilities/vision | 1 | low |
| all 3 | `tools_mcp.other_limits_notes` | "Rate limits enforced **per API key** (not per workspace)" | **corrected** — "Rate limits are set at the **Organization** level … across all Workspaces"; three limit types (RPS, tokens/min, tokens/month) | https://docs.mistral.ai/deployment/ai-studio/tier | 1 | — |
| all 3 | `tools_mcp.tool_search_deferral` | `false`, source **null** | `false`, now sourced: the only tool-pruning that exists is **manual** (per-tool org/workspace toggles, Vibe `/connectors` picker, CLI `enabled_tools`/`disabled_tools` globs) | https://mistral.ai/news/more-control-over-connectors/ | 1 | medium |
| all 3 | `tools_mcp.max_tools_hard` (scope) | `128`, no scope stated | `128` **unchanged**, now explicitly scoped: aggregate across your functions + every Connector's tools + the built-in tools (web search, code interpreter, image generation, document library), all in one `tools` array | https://docs.mistral.ai/resources/known-limitations | 1 | high |
| mistral-large-2512 | `notes` (licence) | "Modified MIT" | **corrected → Apache 2.0** (model card and HF card agree) | https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12 | 1 | — |
| mistral-medium-3-5 | `notes` (architecture) | "675B/41B MoE" framing carried over loosely | **corrected → dense 128B**, text+image in / text out, `reasoning_effort` none\|high | https://huggingface.co/mistralai/Mistral-Medium-3.5-128B | 1 | — |
| all 3 | `context.max_output_tokens_default` / `_max` | `null`, source `https://docs.mistral.ai/api` ("query /models endpoint") | `null`, repointed to the chat endpoint reference which documents **no default and no maximum** for `max_tokens`, only "prompt + max_tokens ≤ context length" | https://docs.mistral.ai/api/endpoint/chat | 1 | low |
| all 3 | `sources[]` | included 2 URLs not re-opened (`/studio-api/agents/agents-api`, `/studio-api/batch-processing`, `news/vibe-remote-agents-…`) | rebuilt from the 31 URLs actually opened in this pass | — | — | — |

**Note on the two downgrades.** `max_tools_practical` 40→20 and `chars_per_token_estimate` 4.0→null are both consequences of the "an unsourced number is worse than a null" rule: each previously carried `source_url: null`. For tool count I substituted the strongest citable 2026 evidence I could open (BFCL-v3-derived: ~74–76% accuracy at 20+ tools for frontier models, "the production-deployment ceiling"; practitioner "safe zone … roughly 10–20 tools"). Neither source measures a Mistral model — that caveat is written into the field's `notes` and the confidence stays `low`. For chars-per-token no public figure for Tekken exists at all, so it became `null`.

---

## MCP limits at a glance — Mistral

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| Mistral Medium 3.5 | ✅ via Connectors (**Public Preview**) | ✅ | **128 / request — AGGREGATE** (your functions + all Connectors' tools + built-ins, one `tools` array) | ~20 (tier 4, empirical, not Mistral-measured) | 256,000 (input+output share it) | Billed as **input tokens**; descriptions consume the same 256k budget. Not deferred — every enabled tool is serialized into every request. Recoverable at 10% via `prompt_cache_key`. |
| Mistral Small 4 | ✅ (platform-level, same Connectors) | ✅ | **128 / request — AGGREGATE** | ~20 (tier 4) | 256,000 | identical |
| Mistral Large 3 | ✅ (platform-level, same Connectors) | ✅ | **128 / request — AGGREGATE** | ~20 (tier 4) | 256,000 | identical |

**Scope discipline (per `02-mcp-limits-taxonomy.md`).** Mistral publishes exactly one tool-count number and it is **aggregate, per request**. There is **no documented per-MCP-server tool ceiling** — `GET /v1/connectors/{id}/tools` paginates (default `page_size` 100) with no stated maximum, so a single server can publish arbitrarily many tools; what binds is the sum landing in one request against 128, and the token cost of that sum against 256k. Adjacent caps worth knowing: Connector **names** are capped at 64 chars (alphanumeric + `_` + `-`), and the Vibe CLI namespaces MCP tools as `{server_name}_{tool_name}`, so a long server alias inflates every tool name.

**What is *not* capped by a published number but still binds:** individual tool-result size, tool-call cycles per turn, simultaneous parallel tool calls, connector count per workspace, chat request payload bytes, tool name length, tool description length, JSON-Schema depth/property count. For all of these the binding constraints are the **128-tool aggregate cap**, the **256k shared window**, and the ~20-tool selection cliff.

---

## Unresolved / undocumented

Everything below is `null` in the file with the reasoning inline.

1. **`knowledge_cutoff` (all 3 models)** — searched the three docs model cards and the three official HF model cards (`Mistral-Medium-3.5-128B`, `Mistral-Small-4-119B-2603`, `Mistral-Large-3`). None states a training-data cutoff. Mistral has never published cutoffs for these families.
2. **`max_output_tokens_default` / `max_output_tokens_max` (all 3)** — the chat endpoint reference documents `max_tokens` with **no default and no maximum**, only "prompt + max_tokens cannot exceed the model's context length". The previously-recorded advice to "query the /models endpoint" is not corroborated by the current API reference, so I did not keep it as a claim.
3. **`image_token_rule` (all 3)** — the Vision capability page literally lists *"How many tokens correspond to an image and/or what is the maximum resolution?"*, *"What is the limit to the size of the image?"* and *"What's the maximum number images per request?"* as FAQ headings **with no answers rendered**. Only 20 MB/image (Known Limitations) is public. This is a first-party documentation gap, not a search failure.
4. **`chars_per_token_estimate` (all 3)** — no chars-per-token or bytes-per-token figure for Tekken anywhere: checked Mistral's tokenization deep-dive, the mistral-common docs and README, and the `toksuite/mistralai-tekken` card (which gives vocab 130,000 but no compression ratio). Mistral's only quantitative claim is relative (~30% better compression than the Llama 3 tokenizer on code/CN/IT/FR/DE/ES/RU; 2×/3× on KO/AR).
5. **`max_tool_name_len`, `max_tool_description_len`, `tool_schema_limits_notes` shape rules (all 3)** — Mistral's API reference documents the `tools` parameter but never publishes a Function-object schema with `maxLength`/`pattern`, nor any JSON-Schema depth/property/keyword restrictions. Searched the API reference index and the function-calling guide. The OpenAPI spec is offered as a download, which I did not fetch (would require a non-browser HTTP client).
6. **`max_request_size` (all 3)** — no byte/MB ceiling for `POST /v1/chat/completions`. The 512 MB figures in Known Limitations are for **file upload** and **batch files**, different endpoints; recording either as a chat request limit would be wrong.
7. **`max_tool_result_size`, `tool_use_per_turn_limit`, `max_parallel_tool_calls_count`, `max_connected_servers`, `max_total_tools` (all 3)** — searched Known Limitations, the chat endpoint reference, the Connectors API reference, connector management, and the Vibe CLI MCP page. None publishes a number.
8. **Reasoning-token accounting (`reasoning_tokens_count_as_output`, `reasoning_billed_as_output`)** — the Reasoning page confirms `reasoning_effort` exists on Medium 3.5 and Small 4 and warns of "increased token usage", but never says which meter thinking tokens land on, and there is no thinking-budget parameter or separate price line on the pricing pages. Left `null` rather than assuming output-priced.
9. **Prompt-cache TTL, and whether tool definitions specifically are cacheable** — the caching page gives the 64-token block size, the 10% price and the "compatible cached prefix" matching rule, but no TTL and no statement about tool arrays. A stable `tools` array at the head of a request *should* qualify as prefix, but that is inference, so it is flagged as such in `notes`, not recorded as fact.
10. **Numeric rate-limit values per tier** — the tier page states the three limit types and that limits are org-level, then directs you to Admin › Limits (authenticated) for the actual numbers. Not publicly retrievable.
11. **The unnamed July-2026 early-access frontier MoE** — no name, spec, licence or availability published (see Models § Added).
12. **Tier-1 consolidated deprecation table** — Mistral has no public per-model retirement calendar page I could open; retirement dates came from a tier-3 tracker and are reported as such, and are not used to change any `status` in this file.

---

## Sources (every URL opened in this task)

**Mistral first-party (tier 1)**
1. https://docs.mistral.ai/models
2. https://docs.mistral.ai/models/overview
3. https://docs.mistral.ai/resources/changelogs
4. https://docs.mistral.ai/resources/known-limitations
5. https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04
6. https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03
7. https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12
8. https://docs.mistral.ai/capabilities/function_calling
9. https://docs.mistral.ai/capabilities/connectors
10. https://docs.mistral.ai/capabilities/connectors/management
11. https://docs.mistral.ai/capabilities/vision
12. https://docs.mistral.ai/studio/connectors
13. https://docs.mistral.ai/studio/agents/introduction
14. https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching
15. https://docs.mistral.ai/studio-api/conversations/reasoning
16. https://docs.mistral.ai/api
17. https://docs.mistral.ai/api/endpoint/chat
18. https://docs.mistral.ai/api/endpoint/beta/connectors
19. https://docs.mistral.ai/deployment/ai-studio/tier
20. https://docs.mistral.ai/getting-started/quickstarts/studio/create-skill
21. https://docs.mistral.ai/vibe/work/skills
22. https://docs.mistral.ai/vibe/code/cli/mcp-servers
23. https://docs.mistral.ai/resources/cookbooks/concept-deep-dive-tokenization-readme
24. https://mistral.ai/pricing
25. https://mistral.ai/pricing/api
26. https://mistral.ai/news
27. https://mistral.ai/news/more-control-over-connectors/
28. https://mistral.ai/news/manage-prompts-and-skills-in-studio/
29. https://mistral.ai/news/regional-inference-open-models-new-compute/
30. https://mistral.ai/news/mistral-nemo/

**Official Hugging Face model cards (tier 1 for open weights)**
31. https://huggingface.co/mistralai/Mistral-Medium-3.5-128B
32. https://huggingface.co/mistralai/Mistral-Small-4-119B-2603
33. https://huggingface.co/mistralai/Mistral-Large-3

**Tooling ground truth (tier 2)**
34. https://github.com/mistralai/mistral-common
35. https://mistralai.github.io/mistral-common/
36. https://mistralai.github.io/mistral-common/usage/tokenizers/

**Aggregators (tier 3)**
37. https://huggingface.co/toksuite/mistralai-tekken
38. https://llmlatency.dev/deprecations/mistral

**Practitioner / empirical (tier 4)**
39. https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026
40. https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem
41. https://www.techtimes.com/articles/319798/20260706/mistral-ai-targets-frontier-gap-open-weight-model-entering-july-early-access.htm

**Fetch failures encountered:** two guessed newsroom URLs returned 404 (`mistral.ai/news/bringing-more-control-over-your-connectors`, `mistral.ai/news/prompts-and-skills-system-of-record`); I did not cite them and located the real slugs via search instead. No page I needed was blocked.

## Final fixes 2026-08-19

**MAJOR 3 — `tools_mcp.max_tools_practical = 20` was cited to a leaderboard containing no Mistral
model.**

All three models (`mistral-medium-3-5`, `mistral-small-2603`, `mistral-large-2512`) carried
`max_tools_practical = 20` at tier 4 / low confidence, citing
<https://presenc.ai/research/ai-agent-tool-calling-accuracy-benchmarks-2026>.

Re-opening that page on 2026-08-19, its BFCL-v3 leaderboard measures:

Claude Opus 4.7, GPT-5 Pro, Claude Sonnet 4.6, Gemini 2.5 Pro, GPT-5, Qwen 3 235B, Llama 4 405B,
Qwen 3 32B, Llama 4 70B, DeepSeek V4.

**No Mistral model appears anywhere on the page.** Its degradation band — "Accuracy degrades to
85-91 percent at 5 tools, then to 65-78 percent at 20+ tools", exemplified on Claude Opus 4.7 (96%
at 1 tool → 91% at 5 → 76% at 20+) — is evidence about those ten models only. The practitioner
write-up quoted alongside it (<https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem>, "safe
zone … at roughly 10-20 tools per reasoning context") likewise names no Mistral model. The previous
pass's own note admitted the figure was "not Mistral-specific" while still recording it as a Mistral
value — that is the over-claim.

### Search for a source that measured a Mistral model

- <https://docs.mistral.ai/capabilities/function_calling/> (tier 1, checked 2026-08-19) lists the
  function-calling models — "Mistral Large 3, Mistral Medium 3.5, Mistral Small 3.2, Mistral Small
  Creative, Ministral 3 14B, Ministral 3 8B, Ministral 3 3B" plus specialized and reasoning models —
  but publishes **no maximum or recommended tool count and no degradation threshold**.
- Searches for Mistral-specific tool-count-vs-accuracy measurements (BFCL and general) returned
  overall function-calling scores and model reviews, but nothing measuring how a Mistral model's
  tool-selection accuracy falls as the tool count grows.

Nothing found. Per the audit instruction ("null it unless you find an empirical source that actually
measured a Mistral model"), the value is nulled rather than kept at tier 4.

### Resolution

| Model | Field | Before | After |
| --- | --- | --- | --- |
| `mistral-medium-3-5` | `tools_mcp.max_tools_practical` | `20`, tier 4, low | **`null`, tier 1, low** |
| `mistral-small-2603` | `tools_mcp.max_tools_practical` | `20`, tier 4, low | **`null`, tier 1, low** |
| `mistral-large-2512` | `tools_mcp.max_tools_practical` | `20`, tier 4, low | **`null`, tier 1, low** |

`source_url` moved from the presenc.ai leaderboard to
<https://docs.mistral.ai/capabilities/function_calling/> — the null is now sourced to the tier-1
page that demonstrates Mistral publishes no such guidance, while the notes name presenc.ai, list the
ten models it actually measured, quote its figures, and state plainly that any cross-vendor
10–20-tool rule of thumb applied to Mistral is an unmeasured extrapolation.

Binding limits named in every note, unchanged and independently sourced:

- the documented **128-tool hard cap per request** (`max_tools_hard`, tier 1,
  <https://docs.mistral.ai/resources/known-limitations>), and
- the **256,000-token shared input+output context window** that every tool definition is billed into.

No entry deleted, no id renamed; `as_of: "2026-08-19"` on all three objects touched.

### Verification
- `python3 -c "import json;json.load(open('data/saas/mistral.json'))"` → parses.
- Validates clean against `schema/model-entry.schema.json` (0 errors).
- Model-id list unchanged by this pass.

**Not verified:** no Mistral tool-count degradation measurement exists to check against — the field
is now honestly unknown rather than borrowed from other vendors' models.
