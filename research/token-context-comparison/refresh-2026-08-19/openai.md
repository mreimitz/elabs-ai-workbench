# OpenAI (GPT) — dataset refresh, 2026-08-19

File refreshed in place: `/tmp/tcc/data/saas/openai.json`
Previous research date: **2026-06-21** → new `as_of`: **2026-08-19**
Schema: unchanged (`schema_version` 1.0); validated with `jsonschema` against
`/tmp/tcc/schema/model-entry.schema.json`.

Roster went **3 → 6 models**. No entry was deleted; no `id` was renamed.

---

## Models

### Validated (3 pre-existing entries, every field re-checked)

| id | verdict | headline |
|---|---|---|
| `gpt-5.5` | validated, **superseded** | 1.05M ctx / 128K out / $5·$30 all confirmed on the model page. Now absent from the frontier list on `…/api/docs/models`; sits under "More models" on `…/models/all`. |
| `gpt-5.4` | validated, **superseded** | 1.05M ctx / 128K out / $2.50·$15 confirmed. Model page now additionally lists **Programmatic Tool Calling**. |
| `gpt-5.4-mini` | validated, **superseded** | 400K ctx / 128K out / $0.75·$4.50 confirmed. Only roster member below 1.05M context. |

None of the three carries a deprecation label or shutdown date on
<https://developers.openai.com/api/docs/deprecations>, so `status` stays `"ga"` for all three
(the schema's `status` enum offers only `ga` / `preview` / `deprecated` — there is no
"superseded" value). Supersession is recorded in each entry's `notes` instead, with the
`…/models`, `…/models/all` and `…/deprecations` URLs.

### Added (3)

| id | display | preview | GA | source |
|---|---|---|---|---|
| `gpt-5.6-sol` | GPT-5.6 Sol (alias `gpt-5.6`) | 2026-06-26 | **2026-07-09** | [changelog](https://developers.openai.com/api/docs/changelog), [launch post](https://openai.com/index/gpt-5-6/), [preview post](https://openai.com/index/previewing-gpt-5-6-sol/) |
| `gpt-5.6-terra` | GPT-5.6 Terra | 2026-06-26 | **2026-07-09** | same |
| `gpt-5.6-luna` | GPT-5.6 Luna | 2026-06-26 | **2026-07-09** | same |

All three: 1,050,000-token context, 128,000 max output, knowledge cutoff **2026-02-16**,
text+image in / text out, MCP · function calling · structured outputs · skills · tool search ·
computer use · hosted shell · apply patch, reasoning effort `none/low/medium/high/xhigh/**max**`
(`max` is new this generation).

### Retired / deprecated

**None in this vendor's roster.** For completeness, the deprecations page announces shutdowns for
models that were never in this dataset, and names the new GPT-5.6 tiers as their replacements:

- 2026-06-11 announcement, shutdown **2026-12-11**: `gpt-5-2025-08-07` → `gpt-5.6-sol`,
  `gpt-5-mini-2025-08-07` → `gpt-5.6-terra`, `gpt-5-nano-2025-08-07` → `gpt-5.6-luna`,
  `gpt-5-pro-2025-10-06` → `gpt-5.6-sol` with `reasoning.mode: pro`.
- 2026-04-22 announcement, shutdown **2026-07-23**: `gpt-5-chat-latest`, `gpt-5-codex`,
  `gpt-5.1-chat-latest`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.2-codex` → `gpt-5.6-sol`;
  `gpt-5.1-codex-mini` → `gpt-5.6-terra`.
- 2026-05-08 announcement, shutdown **2026-08-10**: `gpt-5.2-chat-latest`, `gpt-5.3-chat-latest`
  → `gpt-5.6-sol`.

Source: <https://developers.openai.com/api/docs/deprecations>

### Deliberately not added

`gpt-5.6-cyber`, `daybreak-red-latest`, `daybreak-blue-latest` (specialised cybersecurity /
safeguarded models), `gpt-image-2`, the `gpt-realtime-2.1*` family, `gpt-transcribe` /
`gpt-live-transcribe` / `gpt-realtime-whisper`, and `gpt-5.5-pro` / `gpt-5.4-pro`. These are
either single-modality/specialised models outside a "current generation general roster" or
reasoning-mode variants of entries already present. Listed on
<https://developers.openai.com/api/docs/models> and `…/models/all`.

---

## Changed values

Provenanced `value` changes on pre-existing entries (15 rows). `source_url` /`confidence`-only
refreshes are listed separately below.

| model | field | old | new | source URL | tier | conf |
|---|---|---|---|---|---|---|
| gpt-5.5 | `tools_mcp.max_tools_practical` | 40 | **20** | https://developers.openai.com/api/docs/guides/function-calling | 1 | medium |
| gpt-5.4 | `tools_mcp.max_tools_practical` | 40 | **20** | https://developers.openai.com/api/docs/guides/function-calling | 1 | medium |
| gpt-5.4-mini | `tools_mcp.max_tools_practical` | 40 | **20** | https://developers.openai.com/api/docs/guides/function-calling | 1 | medium |
| gpt-5.5 | `tools_mcp.max_tool_name_len` | 64 | **128** | https://developers.openai.com/api/docs/api-reference/responses/create | 1 | medium |
| gpt-5.4 | `tools_mcp.max_tool_name_len` | 64 | **128** | https://developers.openai.com/api/docs/api-reference/responses/create | 1 | medium |
| gpt-5.4-mini | `tools_mcp.max_tool_name_len` | 64 | **128** | https://developers.openai.com/api/docs/api-reference/responses/create | 1 | medium |
| gpt-5.5 | `tools_mcp.max_request_size` | null | **"512MB"** (image payload scope) | https://developers.openai.com/api/docs/guides/images-vision | 1 | low |
| gpt-5.4 | `tools_mcp.max_request_size` | null | **"512MB"** (image payload scope) | https://developers.openai.com/api/docs/guides/images-vision | 1 | low |
| gpt-5.4-mini | `tools_mcp.max_request_size` | null | **"512MB"** (image payload scope) | https://developers.openai.com/api/docs/guides/images-vision | 1 | low |
| gpt-5.5 | `tokenization.image_token_rule` | "85 base + 170 per 512×512 tile" | **32×32 patch-based**; low/high/original/auto, auto==original; ≤2,500 patches at high, ≤10,000 at original | https://developers.openai.com/api/docs/guides/images-vision | 1 | medium |
| gpt-5.4 | `tokenization.image_token_rule` | "85 base + 170 per 512×512 tile" | **32×32 patch-based**; **auto==high** on 5.4; ≤2,500 / ≤10,000 patches | https://developers.openai.com/api/docs/guides/images-vision | 1 | medium |
| gpt-5.4-mini | `tokenization.image_token_rule` | "85 base + 170 per 512×512 tile" | **32×32 patch-based** (family scheme assumed; no per-model row published) | https://developers.openai.com/api/docs/guides/images-vision | 1 | low |
| gpt-5.5 | `tokenization.count_tokens_method` | tiktoken + `include=['usage']` round-trip | **`POST /v1/responses/input_tokens`** (exact, accepts `tools`) + offline tiktoken | https://developers.openai.com/api/docs/guides/token-counting | 1 | high |
| gpt-5.4 | `tokenization.count_tokens_method` | same | same as above | https://developers.openai.com/api/docs/guides/token-counting | 1 | high |
| gpt-5.4-mini | `tokenization.count_tokens_method` | same | same as above | https://developers.openai.com/api/docs/guides/token-counting | 1 | high |

### Confidence / source-provenance changes (value unchanged)

| model(s) | field | change | new source URL | tier |
|---|---|---|---|---|
| all 3 | `tools_mcp.max_tool_description_len` (1024) | conf **medium → low** | https://community.openai.com/t/tool-calling-api-upgrade-1024-char-limit-is-limiting/951951 | 4 (was labelled 3) |
| gpt-5.5 | `release_date` (2026-04-24) | conf **high → medium**; source was an un-reopened community thread | https://developers.openai.com/api/docs/models/gpt-5.5 | 1 |
| gpt-5.4-mini | `skills_context.prompt_caching` (true) | note **corrected** — 24h extended retention is *not* confirmed for `gpt-5.4-mini` (the guide's extended-retention list omits it) | https://developers.openai.com/api/docs/guides/prompt-caching | 1 |
| all 3 | `tools_mcp.max_tools_hard`, `max_total_tools` (128) | source moved off the redirecting `platform.openai.com` URL | https://developers.openai.com/api/docs/assistants/deep-dive | 1 |
| all 3 | `tools_mcp.strict_function_schema` | source moved off `platform.openai.com/docs/guides/function-calling` | https://developers.openai.com/api/docs/guides/structured-outputs | 1 |
| all 3 | `tokenization.tokenizer_family` (o200k_base) | source moved from an issue thread to the mapping file itself | https://github.com/openai/tiktoken/blob/main/tiktoken/model.py | 2 |
| all 3 | `tokenization.chars_per_token_estimate` (4.0) | **source corrected** — the previously cited tiktoken cookbook does not state a ratio | https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them | 1 |
| all 3 | `tools_mcp.tool_use_per_turn_limit` (null) | was `source_url: null`; now points at a page that documents the loop as application-managed | https://developers.openai.com/api/docs/guides/agents | 1 |
| all 3 | `tools_mcp.tool_schema_limits_notes` | rewritten to record the **unresolved 100-vs-5,000 property conflict** | see Unresolved | 1/3 |
| all 3 | `tools_mcp.other_limits_notes` | rewritten: MCP tool fields (`defer_loading`, `allowed_callers`, `tunnel_id`), MCP RPM tiers, Programmatic Tool Calling | https://developers.openai.com/api/docs/guides/tools-connectors-mcp, `…/tools-programmatic-tool-calling` | 1 |
| all 3 | `skills_context.skills_context_cost_notes` | rewritten with documented ingest caps (50 MB zip / 500 files / 25 MB per file) and the "skill instructions are **user** prompt input" fact | https://developers.openai.com/api/docs/guides/tools-skills | 1 |
| all 3 | `notes` | rewritten to record supersession by GPT-5.6 | https://developers.openai.com/api/docs/models/all | 1 |
| provider | `native_mcp_support`, `skills_concept` | re-verified and rewritten | `…/tools-connectors-mcp`, `…/tools-skills` | 1 |

### Notable generation-level changes captured only in the new GPT-5.6 entries

- **Prompt caching model changed** for GPT-5.6+: 1,024-token strict minimum, **30-minute** default
  retention with explicit `prompt_cache_options.ttl`, cached input at 0.1×, and a **new 1.25×
  cache-write surcharge** (earlier models had none). Tool definitions, **tool ordering** and
  structured-output schemas are part of the cached prefix — directly relevant to MCP footprint
  stability. <https://developers.openai.com/api/docs/guides/prompt-caching>
- **Programmatic Tool Calling** (new 2026-07-09): the model writes JavaScript that runs in an
  isolated V8 runtime and orchestrates tools; documented as reducing intermediate tool output added
  to context. MCP tools opt in via `allowed_callers: ["programmatic"]`.
  <https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling>
- **Price cuts 2026-07-30**: Luna −80% ($1→$0.20 in, $6→$1.20 out), Terra −20% ($2.50→$2.00 in,
  $15→$12 out). Sol unchanged at $5/$30. Fast mode (~2.5× speed, 2× price) 2026-07-30, extended to
  >272K prompts 2026-08-05; Ultrafast (Sol, ~14×) limited preview 2026-08-13.
  <https://developers.openai.com/api/docs/changelog>
- **Terra carries the full 1.05M window**, unlike the previous generation's mini
  (`gpt-5.4-mini`, 400K) — a real planning change for tool-heavy MCP surfaces.

---

## MCP limits at a glance — OpenAI, 2026-08-19

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| gpt-5.6-sol | yes | yes | **128** — AGGREGATE (all connected MCP servers + built-in tools in one `tools` array) | 20 (vendor soft guidance) | 1,050,000 | billed as **input tokens**; counted exactly by `POST /v1/responses/input_tokens`; part of the cached prefix (1.25× on cache write) |
| gpt-5.6-terra | yes | yes | **128** — AGGREGATE | 20 | 1,050,000 | same |
| gpt-5.6-luna | yes | yes | **128** — AGGREGATE | 20 | 1,050,000 | same |
| gpt-5.5 | yes | yes | **128** — AGGREGATE | 20 | 1,050,000 | billed as input tokens; cached prefix, no cache-write surcharge |
| gpt-5.4 | yes | yes | **128** — AGGREGATE | 20 | 1,050,000 | same |
| gpt-5.4-mini | yes | yes | **128** — AGGREGATE | 20 | **400,000** | same; smallest window, so tool-def footprint bites first here |

Scope notes carried in the data:

- **There is no documented per-MCP-server tool cap.** The 128 is a per-request `tools`-array
  ceiling summed across every connected server plus built-in/hosted tools. Six 30-tool servers
  (180) are rejected; one 120-tool server is accepted.
- **No numeric cap on connected MCP servers** is documented for either the Responses API or
  ChatGPT. What binds instead: the 128-entry aggregate array, the context window the definitions
  are charged to, and MCP tool-call rate limits (200 RPM tier 1 / 1000 tiers 2–3 / 2000 tiers 4–5).
- **No per-request numeric cap on parallel tool calls** is documented (`parallel_tool_calls` is a
  boolean; only `false` — "exactly zero or one tool" — is specified). The binding limits are the
  128-entry array, the context window, and the RPM tiers.
- **No API-enforced tool-use-per-turn limit** is documented; the agent loop is application-managed
  (SDK sessions / Conversations API / manual history), bounded in practice by context and cost.
- **Escape hatch:** `tool_search` (gpt-5.4 and later) + the MCP tool's `defer_loading` move a large
  catalog out of the up-front array; no vendor page publishes a ceiling on how many tools may sit
  behind tool search. Recommended granularity is namespaces/servers, under ~10 functions each.

---

## Unresolved / undocumented

1. **Structured-Outputs schema size limits — conflicting sources, no current tier-1 OpenAI page.**
   OpenAI's Structured Outputs guide links to a "supported schemas" detail page that returns 404
   (`…/guides/structured-outputs-supported-schemas`). Microsoft Foundry's Azure OpenAI mirror
   (updated 2026-08-06) still says **100 object properties / 5 nesting levels**; an OpenAI
   community relay of an @OpenAIDevs post (2025-07-11) says the limits were **raised to 5,000
   properties, 120,000 chars per string, 1,000 enum values**. Recorded as an explicit conflict in
   `tool_schema_limits_notes` on every model; neither number is asserted as fact. Searched:
   developers.openai.com structured-outputs (+ `?api-mode=responses`), the 404 sub-page,
   `platform.openai.com` redirect, two web searches.
2. **`max_tool_description_len` (1024)** — still not on any OpenAI page. Both the Responses and
   Chat API references say the `description` field "has a maximum length" without printing it. The
   only public evidence is an API error string in a 2024 community thread. Kept at 1024 with
   confidence **low**, tier 4. Not re-confirmed against GPT-5.6.
3. **`max_tool_name_len`** — the Responses API reference states `minLength 1 / maxLength 128`, but
   the long-reported 64-char Chat-Completions cap could not be re-confirmed on any reachable
   OpenAI page (the function-calling guide no longer states a name length or pattern at all).
   Recorded as 128 with confidence **medium** and the discrepancy in `notes`. The
   `^[a-zA-Z0-9_-]+$` pattern likewise could not be re-sourced and is no longer asserted as a
   provenanced fact. Searched: function-calling guide, Responses + Chat API references, the
   `openai/openai-openapi` `openapi.yaml` (truncated before the FunctionTool schema), two web
   searches.
4. **`max_tool_result_size` (512KB)** — unchanged, still tier-4 and still explicitly undocumented
   ("I can't find anywhere within the documentation that states this limit exists"). Not
   re-confirmed for the Responses API or GPT-5.6.
5. **`max_request_size`** — no general JSON request-body byte cap is published. The 512 MB figure
   now recorded is scoped to **image payloads** (≤512 MB, ≤1,500 images per request) per the vision
   guide, and the `notes` say so; confidence **low**.
6. **Image token multiplier** — the vision guide gives patch counts (32×32 patches; ≤2,500 at
   `high`, ≤10,000 at `original` for 5.4/5.5) but does not publish the per-model multiplier that
   converts patches to tokens, so image token cost is not locally computable for any GPT-5.x model.
   `POST /v1/responses/input_tokens` is the only exact method.
7. **`max_output_tokens_default`** — null on all six models; no vendor page publishes a default,
   only the 128,000 maximum.
8. **GPT-5.6 Terra tier-5 rate limits** — Sol (15,000 RPM / 40M TPM) and Luna (30,000 RPM / 180M
   TPM) are on their model pages; Terra's were not visible in the fetched content.
9. **`gpt-5.6-cyber` specs** — listed on the models index but no model page was opened; not added.
10. **Programmatic Tool Calling limits** — no numeric limits on tool count, result size, program
    complexity or execution time are published.
11. **Tool-search ceiling** — neither OpenAI's nor Azure's tool-search page states how many tools
    may be registered behind `defer_loading`; only the "<10 functions per namespace" guidance.
12. **Prompt-cache retention for `gpt-5.4-mini`** — the extended-retention model list omits it, so
    24 h retention is *not* claimed (the prior entry asserted it; corrected).

---

## Sources (every URL opened in this task)

Tier 1 — OpenAI first-party:
1. https://developers.openai.com/api/docs/models
2. https://developers.openai.com/api/docs/models/all
3. https://developers.openai.com/api/docs/models/gpt-5.6-sol
4. https://developers.openai.com/api/docs/models/gpt-5.6-terra
5. https://developers.openai.com/api/docs/models/gpt-5.6-luna
6. https://developers.openai.com/api/docs/models/gpt-5.5
7. https://developers.openai.com/api/docs/models/gpt-5.4
8. https://developers.openai.com/api/docs/models/gpt-5.4-mini
9. https://developers.openai.com/api/docs/changelog
10. https://developers.openai.com/api/docs/deprecations
11. https://developers.openai.com/api/docs/guides/latest-model
12. https://developers.openai.com/api/docs/guides/function-calling
13. https://developers.openai.com/api/docs/guides/tools-connectors-mcp
14. https://developers.openai.com/api/docs/guides/tools-tool-search
15. https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling
16. https://developers.openai.com/api/docs/guides/tools-skills
17. https://developers.openai.com/api/docs/guides/token-counting
18. https://developers.openai.com/api/docs/guides/prompt-caching
19. https://developers.openai.com/api/docs/guides/images-vision
20. https://developers.openai.com/api/docs/guides/structured-outputs (also `?api-mode=responses`)
21. https://developers.openai.com/api/docs/guides/agents
22. https://developers.openai.com/api/docs/assistants/deep-dive
23. https://developers.openai.com/api/docs/api-reference/responses/create
24. https://developers.openai.com/api/docs/api-reference/chat/create
25. https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken
26. https://openai.com/api/pricing/
27. https://openai.com/index/gpt-5-6/
28. https://openai.com/index/previewing-gpt-5-6-sol/
29. https://cdn.openai.com/pdf/GPT_5_6_August_Updates.pdf
30. https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
31. https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta

Tier 2 — tokenizer ground truth:
32. https://github.com/openai/tiktoken
33. https://github.com/openai/tiktoken/blob/main/tiktoken/model.py
34. https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml (opened; truncated before the FunctionTool schema — inconclusive)

Tier 3 — cross-check:
35. https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs
36. https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/tool-search
37. https://community.openai.com/t/structured-outputs-limits-are-raised-to-support-larger-schemas/1313593

Tier 4 — practitioner evidence for the 128-tool cap and undocumented sizes:
38. https://github.com/code-yeongyu/oh-my-openagent/issues/2848
39. https://github.com/zed-industries/zed/issues/42393
40. https://community.openai.com/t/tool-calling-api-upgrade-1024-char-limit-is-limiting/951951
41. https://community.openai.com/t/submit-tool-output-in-function-call-size-limit/744943

Attempted and **not** usable (recorded for honesty, not cited in the data):
- https://platform.openai.com/docs/assistants/deep-dive — 302 → developers.openai.com (redirect only)
- https://platform.openai.com/docs/guides/structured-outputs — 302 → developers.openai.com (redirect only)
- https://developers.openai.com/api/docs/guides/structured-outputs-supported-schemas — 404

URLs that appeared in the 2026-06-21 file but were **not** re-opened in this pass have been
replaced as sources (tiktoken issue #464, the gpt-5.5 launch community thread, the "gpt-5.4 deep
dive" community thread, `platform.openai.com/docs/*`, the tiktoken cookbook as a chars-per-token
source). No URL is cited in the data that was not opened here.

---

## Remediation 2026-08-19

Scope: the audit findings against `data/saas/openai.json` (all 6 models identical on these
fields), plus same-class defects found while fixing them. Every URL below was re-opened in this
pass.

| Finding | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| **BLOCKER** — `tools_mcp.max_tools_hard` = 128 cited to the Assistants API deep-dive (wrong surface; page carries a shutdown banner for 2026-08-26) | Re-opened the current tier-1 surfaces: function-calling guide (no numeric cap; "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion"), Responses API reference (`tools` has **no** `maxItems`), Chat Completions reference (no count limit), tool-search guide (only "fewer than 10 functions" per namespace). No current tier-1 page states a tools-array cap → value **nulled**; notes name the binding limits (context window / tool defs billed as input tokens, the <20-function guidance, tool search + `defer_loading`) and record the tier-4 "array too long … maximum length 128" reports as observed-only, not spec | `null` | https://developers.openai.com/api/docs/guides/function-calling | 1 / low |
| **BLOCKER (sibling)** — `tools_mcp.max_total_tools` = 128, same citation | Same treatment; aggregate scope explained without asserting a number | `null` | https://developers.openai.com/api/docs/guides/function-calling | 1 / low |
| **MAJOR** — `tools_mcp.max_request_size` = string `"512MB"` with `unit: "bytes"`, cited to the images/vision guide | Made numeric with the correct unit and **narrowed the scope in notes**: the vision guide's verbatim "Up to 512 MB total payload size per request" (with "Up to 1500 individual image inputs per request") is documented for requests carrying image inputs; no general JSON body byte cap is documented for Chat Completions or Responses, and the note warns against reading it as comparable to Anthropic's 32 MB / Gemini's 100 MB general ceilings | `512` + `unit: "MB"` | https://developers.openai.com/api/docs/guides/images-vision | 1 / low |
| **MAJOR (sibling)** — `tools_mcp.max_tool_result_size` = string `"512KB"` | Made numeric with `unit: "KB"`; re-opened the forum thread, which reports the 512KB ceiling and whose own respondent says "I can't find anywhere within the documentation that states this limit exists". Notes state plainly that it is empirical and undocumented | `512` + `unit: "KB"` | https://community.openai.com/t/submit-tool-output-in-function-call-size-limit/744943 | 4 / low |
| **Same class (self-found)** — six other notes still asserted "the 128-entry aggregate tools array" as fact (`tool_search_deferral`, `max_parallel_tool_calls_count`, `max_connected_servers`, `other_limits_notes`, two model-level `notes`) | Rewritten to "the size of the (up-front / aggregate) tools array — no vendor-published numeric cap, see `max_tools_hard`" so no field re-imports the withdrawn 128 | prose only | — | — |
| Reviewed, left as-is | `max_tools_practical` = 20 (tier 1, medium — vendor's own soft guidance, notes say it is advice not a cap); `max_tool_description_len` = 1024 (tier 4, low, notes state it is an observed API error message and undocumented) | unchanged | — | — |

Pages opened for this remediation and **not** cited (recorded for honesty): the Assistants API
deep-dive (confirmed the banner "we've deprecated the Assistants API. It will shut down on
August 26, 2026" and the "up to 128 tools" per-Assistant wording — the reason the value was
withdrawn), the Responses API reference, the Chat Completions reference and the tool-search guide
(all checked for a `maxItems` on `tools`; none has one).
