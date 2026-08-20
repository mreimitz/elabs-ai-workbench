---
type: "Source Reference"
title: "xAI (Grok) \u2014 dataset refresh 2026-08-19"
description: "File: /tmp/tcc/data/saas/xai-grok.json \u00b7 Previous asof: 2026-06-21 \u00b7 New asof: 2026-08-19"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "captured"
---
# xAI (Grok) — dataset refresh 2026-08-19

**File:** `/tmp/tcc/data/saas/xai-grok.json` · **Previous `as_of`:** 2026-06-21 · **New `as_of`:** 2026-08-19
**Roster:** 3 → 5 model entries (2 added, 0 deleted, 0 renamed)

The xAI roster moved twice inside the refresh window: **Grok 4.5** (GA 2026-07-08) and **Grok 4.6**
(GA 2026-08-12) both landed after the last snapshot. The headline consequence for MCP work is
counter-intuitive: the new flagships have a **smaller** context window than the model they replace
(500k vs grok-4.3's 1M) at **higher** prices ($2/$6 vs $1.25/$2.50 per 1M), while the documented
**200-tool aggregate per-request cap is unchanged**. grok-4.3 therefore remains the best xAI host for
a large MCP tool surface, and is now also the only Grok model with a batch discount.

---

## Models

### Validated (3 pre-existing entries, all re-verified field by field)

| id | status before → after | verdict |
|---|---|---|
| `grok-4.3` | ga → ga | Still fully documented: own model card, pricing row, Tier 0–4 rate-limit row, **no deprecation banner**. Superseded as flagship but not retired. 1M context and $1.25/$2.50 confirmed. |
| `grok-4.20-multi-agent-0309` | preview → preview | Still explicitly **beta** ("This feature is currently in beta. The API interface and behavior may change as we iterate."). Still the only xAI model that refuses client-side function calling — Remote MCP is its only custom-tool route. No 4.5/4.6 multi-agent variant exists. |
| `grok-build-0.1` | preview → **ga** | No early-access banner remains on the model card; present in the standard pricing and Tier 0–4 rate-limit tables; named in the May-15 retirement guide as the production replacement for the retired `grok-code-fast-1`. xAI publishes no literal "GA" label — this is a judgement from three tier-1 signals, recorded in the entry's `notes`. |

### Added (2)

| id | release / GA date | source | window | price in/cached/out (short ctx) |
|---|---|---|---|---|
| `grok-4.6` | **2026-08-12** — "Grok 4.6, SpaceXAI's frontier model for coding, agentic tasks, and knowledge work, is now available on the xAI API." | [release notes](https://docs.x.ai/developers/release-notes) | 500,000 | $2.00 / $0.50 / $6.00 (long ctx ≥200k: $4 / $1 / $12) |
| `grok-4.5` | **2026-07-08** — "Grok 4.5 … is now available on the xAI API." (EU console 2026-07-17) | [release notes](https://docs.x.ai/developers/release-notes) | 500,000 | $2.00 / $0.30 / $6.00 (long ctx ≥200k: $4 / $0.60 / $12) |

`grok-4.6` is the only Grok model with a published knowledge cutoff: *"The knowledge cut-off date of
Grok 4.6 is February 1, 2026."*

### Retired / deprecated (0)

No model in this file was retired in the window. The only retirement xAI documents is the
**2026-05-15** event (grok-3, grok-4-0709, grok-4-fast-\*, grok-4-1-fast-\*, grok-code-fast-1,
grok-imagine-image-pro), which predates the previous snapshot and affects **no id in this file** —
grok-4.3 and grok-build-0.1 were the *replacements* in that migration.
Two additional priced ids (`grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`) appear in the
pricing and rate-limit tables but are pre-window (March 2026) and outside the "current generation"
roster, so they were **not** added; flagged here for the reviewer.

---

## Changed values

Provenanced fields whose **value** changed on pre-existing entries: **12**.
Fields whose confidence changed but value did not: **14**. `source_url` refreshed on **63** fields;
`as_of` refreshed on **every** provenanced field in the file.

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| grok-4.3 | `cost.batch_discount` | `"20%-50% off"` | `"20% off"` | https://docs.x.ai/developers/pricing | 1 | high |
| grok-4.20-multi-agent-0309 | `cost.batch_discount` | `"20%-50% off"` | `"20% off"` | https://docs.x.ai/developers/pricing | 1 | high |
| grok-build-0.1 | `cost.batch_discount` | `"20%-50% off"` | `"not eligible"` | https://docs.x.ai/developers/pricing | 1 | high |
| grok-4.3 | `tools_mcp.max_total_tools` | `null` | `200` (aggregate, derived) | https://docs.x.ai/developers/tools/function-calling | 1 | high |
| grok-build-0.1 | `tools_mcp.max_total_tools` | `null` | `200` (aggregate, derived) | https://docs.x.ai/developers/tools/function-calling | 1 | high |
| grok-4.20-multi-agent-0309 | `tools_mcp.max_tools_practical` | `null` | `40` (empirical, derived) | https://nerdleveltech.com/how-many-tools-can-an-ai-agent-handle | 4 | low |
| grok-4.20-multi-agent-0309 | `skills_context.prompt_caching` | `null` | `true` | https://docs.x.ai/developers/pricing | 1 | medium |
| grok-4.3 | `knowledge_cutoff` | `"2024-11-01"` | `null` | https://docs.x.ai/developers/models | 1 | low |
| grok-4.20-multi-agent-0309 | `knowledge_cutoff` | `"2024-11-01"` | `null` | https://docs.x.ai/developers/models | 1 | low |
| grok-4.3 | `tokenization.chars_per_token_estimate` | `4` | `null` | (none — unsourced) | — | low |
| grok-4.20-multi-agent-0309 | `tokenization.chars_per_token_estimate` | `4` | `null` | (none — unsourced) | — | low |
| grok-build-0.1 | `tokenization.chars_per_token_estimate` | `4` | `null` | (none — unsourced) | — | low |
| grok-build-0.1 | `status` | `preview` | `ga` | https://docs.x.ai/developers/migration/may-15-retirement + https://docs.x.ai/developers/models/grok-build-0.1 | 1 | — |

**Why the three nulls.** The models page **no longer contains** the sentence "The knowledge cut-off
date of Grok 3 and Grok 4 is November, 2024" that sourced the old value; it now documents a cutoff for
grok-4.6 only. Carrying a number whose cited page no longer states it would be an unsourced number, so
it is nulled with a note. `chars_per_token_estimate = 4` was a generic heuristic with `source_url:
null` in the old file; I searched docs.x.ai and OpenAI's token-counting guide for a citable ratio and
found none applicable to Grok, so it is nulled with a pointer to the dataset's `raw_json_rough`
(bytes/4) floor.

### Confidence-only changes (value unchanged)

| model | field | old → new | why |
|---|---|---|---|
| grok-4.3 | `release_date` | medium → **low** | The release-notes page no longer shows a grok-4.3 launch entry; only the May-15 retirement guide (which names grok-4.3 as the replacement) constrains the date. |
| grok-4.20-multi-agent-0309 | `release_date` | high → **medium** | The "March 10: Grok 4.20 and Grok 4.20 Multi-agent are live" line is no longer surfaced on the release-notes page; the `-0309` id and continued pricing presence corroborate it. |
| grok-build-0.1 | `release_date` | high → **medium** | Same reason — the May 19 "early access" line is no longer surfaced. |
| grok-4.3, grok-build-0.1 | `tools_mcp.max_total_tools` | low → **high** | Now recorded as the 200-tool aggregate rather than "not documented". |
| grok-build-0.1 | `skills_context.prompt_caching` | medium → **high** | Pricing table publishes a $0.20/1M cached-input rate for the model. |
| grok-build-0.1 | `cost.reasoning_billed_as_output` | high → **medium** | The reasoning-capabilities page enumerates `reasoning_effort` support for grok-4.6 / grok-4.5 / grok-4.20-multi-agent only; grok-build-0.1 is not restated. |
| grok-4.20-multi-agent-0309 | `tools_mcp.tool_use_per_turn_limit` | low → **medium** | `max_turns` semantics are now explicitly documented (limits assistant turns, not tool calls). |
| grok-4.20-multi-agent-0309 | `tokenization.image_token_rule` | high → **low** | Downgraded: absence of an image modality in the multi-agent docs is not a positive statement of text-only. |

### Notes-level corrections that carry real operational weight

- **Rate limits were wrong, not just stale.** grok-4.3 was recorded as "1,800 RPM / 10M TPM"; the
  rate-limits page publishes **37 RPS / 10M TPM at Tier 0** (→ 208 RPS / 85M TPM at Tier 4).
  `grok-4.20-multi-agent-0309` was recorded as "same as grok-4.3"; it is in fact **9 RPS / 2.5M TPM at
  Tier 0** — the tightest in the roster. grok-4.6 / grok-4.5: **150 RPS / 50M TPM** at Tier 0.
- **Context Compaction is opt-in, not automatic** (previous notes said automatic). It is an explicit
  `POST /v1/responses/compact` / `chat.compact()` call.
- **Tool schema root rule widened.** Function-calling docs now allow *"A root `anyOf` or `oneOf` … when
  every branch is itself an object"*; a scalar/array root, or an `anyOf`/`oneOf` with a non-object
  branch, is still "rejected with a `400` error".
- **New server-side tool fees** since the last snapshot: `attachment_search` $10/1k calls,
  `collections_search` $2.50/1k calls (alongside web_search / x_search / code_execution at $5/1k).
  **Remote MCP tools remain token-billed only** — *"you will not be charged for the tool invocation but
  will be charged for any tokens used."*
- **Priority processing** (`service_tier: "priority"`, June 2026) bills **2x** on all token types.
- **Long-context pricing** re-rates the *entire* request once the prompt reaches 200k, and *"Long
  context pricing applies when total prompt tokens (including cached tokens) exceed the model's long
  context threshold"* — i.e. cached tokens count toward the threshold.
- **Reasoning cannot be disabled on grok-4.6/4.5** (`reasoning_effort` defaults to `high`; `xhigh` is
  grok-4.6+ only). grok-4.3 still accepts effort `none`.
- **`grok-build-latest` now aliases grok-4.5**, not grok-build-0.1.

---

## MCP limits at a glance — xAI (Grok), 2026-08-19

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| `grok-4.6` | yes (Responses API / xAI SDK / Speech-to-Speech; Streaming HTTP + SSE only) | yes | **200 per request — AGGREGATE** (custom functions + built-in server-side tools + all connected MCP servers' tools). No per-MCP-server cap is documented. | ~40 (empirical, tier 4, low) | 500,000 | Injected as input tokens; without `allowed_tools` "all tool definitions exposed by the MCP server are automatically injected into the model's context". Billed at $2.00/1M ($0.50 cached; $4/$1 above 200k). |
| `grok-4.5` | yes (medium confidence — docs write MCP examples against 4.6) | yes | **200 per request — AGGREGATE** | ~40 (empirical, tier 4, low) | 500,000 | Same; $2.00/1M ($0.30 cached; $4/$0.60 above 200k). |
| `grok-4.3` | yes | yes | **200 per request — AGGREGATE** | ~40 (empirical, tier 4, low) | **1,000,000** | Same; cheapest at $1.25/1M ($0.20 cached; $2.50/$0.40 above 200k). Best xAI host for a large tool surface. |
| `grok-4.20-multi-agent-0309` (beta) | yes — **the only route to custom tools** | **no** (client-side function calling and custom tools unsupported) | **not documented for this variant** — the 200-cap lives in the function-calling docs, which this variant does not use. What binds: the 1M window, the aggregate definition footprint across connected servers, and 9 RPS / 2.5M TPM. | ~40 (empirical, tier 4, low) | 1,000,000 | Same, but paid repeatedly: "All tokens consumed by both the leader agent and sub-agents are billed, including input tokens, output tokens, and reasoning tokens" across 4 or 16 sub-agents. |
| `grok-build-0.1` | yes (medium confidence) | yes | **200 per request — AGGREGATE** | ~40 (empirical, tier 4, low) | 256,000 | Same; $1.00/1M ($0.20 cached). Smallest window — the same 200-tool allowance eats ~4x the context share it does on grok-4.3. |

**Scope note (dataset rule 4):** every published xAI tool number is **aggregate per request**. xAI
documents no per-MCP-server tool cap and no numeric cap on how many MCP servers you may connect in one
request (the docs' own example wires three). What binds a multi-server setup is the shared 200-tool
allowance, the context window, and the tokens-per-minute rate limit. `allowed_tools` is the documented
mitigation: *"Reduce context overhead by limiting tool definitions the model needs to consider."*
There is no tool-search / deferred-loading mechanism on any xAI model — `allowed_tools` is a static
per-request allow-list, not progressive disclosure.

---

## Unresolved / undocumented

Fields left `null` for lack of a public source, and what was searched:

1. **`max_output_tokens_default` / `max_output_tokens_max` — all 5 models.** No model card, pricing
   page or API-reference page publishes a default or maximum completion length. Searched docs.x.ai
   model cards, the API reference index (Chat/Images/Videos/Voice/Models/Files/Batches families) and
   two attempted deep links to the chat-completion endpoint page (both 404). For
   `grok-4.20-multi-agent-0309` the docs positively state `max_tokens` is *not supported*.
2. **`max_input_tokens` — all 5 models.** Not published and **not derivable**, since no max-output
   figure exists to subtract from the window. Left `derived: false`.
3. **Tokenizer identity, `tokenizer_public`, `count_tokens_method`, `chars_per_token_estimate`.** xAI
   publishes no tokenizer name, no HF repo, no tiktoken base and no count-tokens endpoint. Searched
   docs.x.ai plus a targeted web search for an xAI count-tokens endpoint — nothing. The console
   Tokenizer Playground remains interactive-only. `chars_per_token_estimate` nulled rather than
   carrying an unsourced `4`.
4. **`image_token_rule` — all image-capable models.** The image-understanding page publishes only
   *"Maximum image size: `20MiB`"* and *"Supported image file types: `jpg/jpeg` or `png`"*, plus a
   statement that no per-request numeric cap on image count is documented. No tile/patch → token
   formula exists, so per-image cost must be measured empirically.
5. **`max_request_size` — all 5 models.** No byte/MB payload ceiling anywhere. Checked the API
   reference, function-calling, remote-MCP, tools-overview and rate-limits pages. The only published
   payload ceiling is the 20MiB per-image limit.
6. **`max_tool_name_len` / `max_tool_description_len`.** No character limits documented; xAI publishes
   no analogue to OpenAI's 64-char function-name cap, even though Remote MCP names carry a
   `<server_label>.` prefix.
7. **`max_tool_result_size`, `max_parallel_tool_calls_count`, `max_connected_servers`.** No numeric
   limits published for any of the three.
8. **`tool_use_per_turn_limit` — the `max_turns` global default.** Documented to exist but **not
   numerically published**: *"If `max_turns` is not specified, the server applies a global default
   cap."* This is the single most useful undocumented number for agent-loop planning on xAI.
9. **`knowledge_cutoff` for grok-4.5, grok-4.3, grok-4.20-multi-agent-0309, grok-build-0.1.** Only
   grok-4.6 has a published cutoff. The former Grok 3/4 "November, 2024" sentence has been removed from
   the models page.
10. **grok-4.5 / grok-build-0.1 `native_mcp` and `parallel_tool_calls` are medium confidence.** MCP and
    parallel calling are documented as API-surface features with no per-model exclusion, but the
    current Remote MCP page writes all examples against grok-4.6 and neither model card names MCP.
11. **grok-build-0.1 GA status.** xAI publishes no explicit GA/beta label for it; the `ga` status is
    inferred from three tier-1 signals (no early-access banner, full pricing + Tier 0–4 rate-limit
    rows, named as the retirement replacement for grok-code-fast-1) and this inference is stated in the
    entry's `notes`.
12. **Grok Bot (launched 2026-08-11).** Documented as a product surface ("A durable AI teammate with a
    name, a job, its own conversation, and working context that develops over time"). Its docs publish
    no model id, no context/token limits and no MCP statement, so it is **not** added as a model entry;
    it is recorded in the provider-level `skills_concept` notes.

**Fetches that failed** (recorded per the research-discipline rule): three docs.x.ai deep links
returned 404 — `/developers/model-capabilities/image/image-understanding`,
`/developers/model-capabilities/image/understanding` and
`/developers/api-reference/chat/create-chat-completion`. The correct image page
(`/model-capabilities/images/understanding`) was located via search and read. No substitute for the
chat-completion parameter page was found, which is why the output-token fields stay null. No
`curl`/`wget`/`python` HTTP was used at any point.

---

## Sources (every URL opened in this task)

**Tier 1 — xAI vendor documentation**
- https://docs.x.ai/developers/models
- https://docs.x.ai/developers/models/grok-4.6
- https://docs.x.ai/developers/models/grok-4.5
- https://docs.x.ai/developers/models/grok-4.3
- https://docs.x.ai/developers/models/grok-build-0.1
- https://docs.x.ai/developers/release-notes
- https://docs.x.ai/developers/pricing
- https://docs.x.ai/developers/rate-limits
- https://docs.x.ai/developers/api-reference
- https://docs.x.ai/developers/tools/function-calling
- https://docs.x.ai/developers/tools/remote-mcp
- https://docs.x.ai/developers/tools/tool-usage-details
- https://docs.x.ai/developers/tools/advanced-usage
- https://docs.x.ai/developers/tools/overview
- https://docs.x.ai/developers/model-capabilities/text/multi-agent
- https://docs.x.ai/developers/model-capabilities/text/reasoning
- https://docs.x.ai/developers/model-capabilities/images/understanding
- https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing
- https://docs.x.ai/developers/advanced-api-usage/context-compaction
- https://docs.x.ai/developers/migration/may-15-retirement
- https://docs.x.ai/build/features/skills-plugins-marketplaces
- https://docs.x.ai/grok-bot/bots

**Tier 4 — practitioner (used only for `max_tools_practical`, labelled empirical)**
- https://nerdleveltech.com/how-many-tools-can-an-ai-agent-handle

**Opened but not usable as a source (recorded for completeness)**
- https://developers.openai.com/api/docs/guides/token-counting — opened while looking for a citable
  characters-per-token rule of thumb; it publishes none, which is why
  `chars_per_token_estimate` is now `null`.

## Final fixes 2026-08-19

**MAJOR 1 — the "200 tools per request" figure was asserted for three models its source does not cover.**

`grok-4.5`, `grok-4.3` and `grok-build-0.1` each carried
`tools_mcp.max_tools_hard = 200` and `tools_mcp.max_total_tools = 200` at **tier 1 / confidence
HIGH** with no scope caveat, all citing
<https://docs.x.ai/developers/tools/function-calling>. Two of those (grok-4.5, grok-build-0.1) had
the figure **newly added** by the previous pass, so that pass widened the over-claim rather than
narrowing it.

### What xAI actually documents (all pages re-read 2026-08-19)

| Page | Tool-count statement | Models named |
| --- | --- | --- |
| [Function calling](https://docs.x.ai/developers/tools/function-calling) — Tool Schema Reference, `name` field | "Unique identifier (max 200 tools per request)" — no model qualification | **grok-4.6 only** |
| [REST API reference → chat/responses](https://docs.x.ai/developers/rest-api-reference/inference/chat) — `tools` request parameter | "A list of tools the model may call in JSON-schema. Currently, only functions and web search are supported as tools. **A max of 128 tools are supported.**" — no model qualification | grok-4.6, grok-4.20-0309-reasoning, `latest` |
| [Models index](https://docs.x.ai/developers/models) | none | Grok 4.6 (plus Voice / Imagine APIs) |
| [grok-4.6](https://docs.x.ai/developers/models/grok-4.6) | none | — |
| [grok-4.5](https://docs.x.ai/developers/models/grok-4.5) | none (confirms function calling, 500,000-token window) | — |
| [grok-4.3](https://docs.x.ai/developers/models/grok-4.3) | none (confirms function calling, 1,000,000-token window) | — |
| [Tools overview](https://docs.x.ai/developers/tools/overview) | none | grok-4.6 only |
| [Remote MCP tools](https://docs.x.ai/developers/tools/remote-mcp) | none | grok-4.6 only |
| `https://docs.x.ai/developers/error-reference` | — | **404 on 2026-08-19** |

The decisive finding: **the 200 figure is not corroborated as an API-wide platform limit.** The one
place xAI attaches a number to the `tools` array itself — the REST API reference — documents a
*different, lower* number (128), equally unqualified by model. No per-model page carries any
tool-count cap at all, and there is no error reference to arbitrate.

### Resolution

Per the methodology rule ("a value may only be asserted for a model the cited page actually
covers"), this falls in the second branch of the audit instruction: the 200 figure is evidenced only
on a page that names grok-4.6.

| Model | Field | Before | After | Why |
| --- | --- | --- | --- | --- |
| `grok-4.6` | `max_tools_hard` | 200, **high** | **200, medium** | Only model the citing page names, so the value stands. Confidence lowered high → medium and the 200-vs-128 tier-1 doc conflict quoted in notes; scope restated as aggregate-per-request (custom functions + built-in server-side tools + all connected Remote MCP servers), no per-server cap documented. |
| `grok-4.6` | `max_total_tools` | 200, **high** | **200, medium** | Same, `derived: true` retained. |
| `grok-4.5` | `max_tools_hard`, `max_total_tools` | 200, **high** | **null, low** | Page names grok-4.6 only; the grok-4.5 model page states no tool cap. Binding limits named in notes: 500k context window, aggregate MCP definition footprint, per-tier rate limits. |
| `grok-4.3` | `max_tools_hard`, `max_total_tools` | 200, **high** | **null, low** | Same; binding limit is the 1M window (so the selection cliff bites before the window does). |
| `grok-build-0.1` | `max_tools_hard`, `max_total_tools` | 200, **high** | **null, low** | Same; binding limit is the 256k window — the tightest in the roster. |

Every null names the binding limits and records that **128, not 200, is the safer planning ceiling**
(the lower of the two unqualified platform numbers). `grok-4.20-multi-agent-0309` already carried
`null` for both fields and was left untouched. No entry was deleted and no id renamed;
`as_of: "2026-08-19"` is stamped on every object touched.

### Verification
- `python3 -c "import json;json.load(open('data/saas/xai-grok.json'))"` → parses.
- Validates clean against `schema/model-entry.schema.json` (0 errors).
- Model-id list unchanged by this pass.

**Not verified:** whether the 200-vs-128 discrepancy is a docs lag or two genuinely different
enforcement paths (function-calling guide vs. Responses API) — that would need a live API call with
an xAI key, which this pass did not have. The conflict is recorded in notes rather than resolved.
