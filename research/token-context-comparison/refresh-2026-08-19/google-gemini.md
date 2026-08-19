# Google (Gemini) — dataset refresh, 2026-08-19

Previous revision: **2026-06-21**. File refreshed in place: `/tmp/tcc/data/saas/google-gemini.json`
(top-level `as_of` → `2026-08-19`, `schema_version` unchanged at `1.0`; validates against
`schema/model-entry.schema.json`).

Headline: **three new GA models shipped in the eight-week gap** (3.6 Flash and 3.5 Flash-Lite on
2026-07-21, 3.7 Flash on 2026-08-13), **Gemini 3.1 Flash-Lite is now deprecated** with a
2027-05-07 shutdown, **MCP has graduated from an experimental SDK client to a documented API tool
type** (with a large caveat), and **Google now has a real Agent Skills construct**. The
512-declaration aggregate ceiling is unchanged — and still undocumented by Google.

---

## Models

### Validated (pre-existing entries re-verified) — 3

| id | status | what was re-confirmed |
|---|---|---|
| `gemini-3.5-flash` | `ga` (unchanged) | 1,048,576 / 65,536; release May 19 2026; knowledge cutoff January 2025; $1.50 / $9.00 / $0.15 cached; batch 50%. No shutdown date. |
| `gemini-3.1-flash-lite` | **`ga` → `deprecated`** | 1,048,576 / 65,536; release May 7 2026; $0.25 (audio $0.50) / $1.50 / $0.025 cached. Shutdown **2027-05-07**, replacement `gemini-3.5-flash-lite`. |
| `gemini-2.5-pro` | `ga` (unchanged) | 1,048,576 / 65,536; release June 17 2025; cutoff January 2025; $1.25→$2.50 and $10.00→$15.00 across the 200k boundary; cache storage $4.50/1M/hr. No shutdown date. |

### Added — 3

| id | release | GA date | source |
|---|---|---|---|
| `gemini-3.7-flash` | August 2026 | **2026-08-13** ("gemini-3.7-flash generally available") | [release notes](https://ai.google.dev/gemini-api/docs/changelog), [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash), [DeepMind model card](https://deepmind.google/models/model-cards/gemini-3-7-flash/) |
| `gemini-3.6-flash` | July 21, 2026 | **2026-07-21** | [release notes](https://ai.google.dev/gemini-api/docs/changelog), [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [model card PDF](https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-3-6-Flash-Model-Card.pdf) |
| `gemini-3.5-flash-lite` | July 21, 2026 | **2026-07-21** | [release notes](https://ai.google.dev/gemini-api/docs/changelog), [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [model card PDF](https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-3-5-Flash-Lite-Model-Card.pdf) |

All three: 1,048,576 input / 65,536 output, text+image+video+audio+PDF in, text out, Thinking,
function calling, caching, batch, the full built-in tool set. 3.7 and 3.6 Flash share an
**introductory price card that doubles on 2027-01-01** ($0.75/$3.75 → $1.50/$7.50).

### Retired / superseded — 1

- `gemini-3.1-flash-lite` → `status: "deprecated"`. The model-versions table on
  [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
  now gives it shutdown date **May 7, 2027** and names `gemini-3.5-flash-lite` as the recommended
  replacement. Entry kept in full, id unchanged.

### Deliberately NOT added

- `gemini-3.1-pro-preview` — still `preview`, released **2026-02-19** (before this refresh window),
  no shutdown date, $2.00/$12.00 with the same >200k tier. It is the only Pro-class Gemini 3 model
  and Gemini 3.5 Pro has still not shipped; a reviewer may want it added as a `preview` entry, but
  it falls outside "released or brought to GA since 2026-06-21".
- Non-text-generation variants on the models page (Nano Banana 2 / 2 Lite / Pro image models, Veo,
  Lyria, TTS/Live, Robotics ER 2, Embedding 2, Computer Use, Deep Research, Antigravity agent).

---

## Changed values

27 provenanced values changed (excluding pure `as_of` refreshes). Provenance-only refreshes
(same value, new `source_url`/`confidence`/`tier`) are listed separately below.

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| provider | `skills_concept` | "Gems (Google AI Studio) and system_instruction parameter (API)" | "Agent Skills (SKILL.md, agent/CLI layer) + Gems (consumer product) + system_instruction (API)" | https://ai.google.dev/gemini-api/docs/coding-agents | 1 | high |
| `gemini-3.1-flash-lite` | `status` | `ga` | `deprecated` | https://ai.google.dev/gemini-api/docs/deprecations | 1 | high |
| `gemini-3.1-flash-lite` | `knowledge_cutoff` | `2025-01` | `null` | *(none — see Unresolved)* | — | low |
| `gemini-3.1-flash-lite` | `cost.batch_discount` | batch input $0.125/1M text/image/video, output $0.75/1M | + audio batch input $0.25/1M | https://ai.google.dev/gemini-api/docs/pricing | 1 | high |
| `gemini-3.1-flash-lite` | `tokenization.count_tokens_method` | Python + REST only | + JS SDK form | https://ai.google.dev/gemini-api/docs/tokens | 2 | high |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `context.input_output_shared` | `true` | `false` | model page (per model) | 1 | medium |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `tools_mcp.max_tool_name_len` | `null` | `64` (characters) | https://github.com/Yeachan-Heo/oh-my-claudecode/issues/235 | 4 | medium |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `tools_mcp.max_tools_practical` | `null` | `20` (active tools) | https://ai.google.dev/gemini-api/docs/function-calling | 1 | medium |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `tools_mcp.tool_use_per_turn_limit` | `null` | `10` (SDK automatic-FC remote calls) | https://github.com/googleapis/python-genai | 1 | medium |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `skills_context.skills_supported` | `false` | `true` | https://ai.google.dev/gemini-api/docs/coding-agents | 1 | medium |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `skills_context.skills_loading_model` | `"n/a"` | `"progressive_disclosure"` | https://geminicli.com/docs/cli/skills/ | 1 | medium |
| 3.5-flash / 3.1-flash-lite / 2.5-pro | `tokenization.image_token_rule` | "cropped/scaled into 768x768 tiles" | "tiled into 768x768 pixel tiles" (matches current doc wording) | https://ai.google.dev/gemini-api/docs/tokens | 1 | high |
| `gemini-2.5-pro` | `tokenization.count_tokens_method` | Python + REST only | + JS SDK form | https://ai.google.dev/gemini-api/docs/tokens | 2 | high |

### Why the notable ones changed

- **`input_output_shared` true → false (all models).** The 2026-06 revision asserted a single
  shared pool. Google publishes two separate rows per model — "Input token limit: 1,048,576" and
  "Output token limit: 65,536" — and the Gemini 3 guide says "1 million token input context window
  and up to 64k tokens of output". Nothing in the docs describes output drawing down the input
  budget. Recorded `false` at **medium** confidence because Google never states the relationship
  explicitly either way; the [long-context page](https://ai.google.dev/gemini-api/docs/long-context)
  was checked and is silent on it.
- **`max_tool_name_len` null → 64.** Still absent from every Google doc page, but the API's own
  400 response states it verbatim: *"Invalid function name. Must start with a letter or an
  underscore. Must be alphanumeric (a-z, A-Z, 0-9), underscores (_), dots (.), colons (:), or
  dashes (-), with a maximum length of 64."* Tier 4 / medium because it is a practitioner-reported
  error string. This is the per-tool limit MCP servers actually trip, because hosts namespace tool
  names — Gemini CLI prefixes `mcp_{serverName}_{toolName}` and truncates over 63 chars.
- **`max_tools_practical` null → 20.** Google's function-calling best practices now state
  *"Tool Selection: Keep active set to 10-20 tools maximum."* Recorded at the top of the band,
  medium confidence, flagged as vendor advice rather than a measured cliff.
- **`tool_use_per_turn_limit` null → 10.** SDK-layer, not model-API: the google-genai SDK's
  automatic function calling defaults to a maximum of 10 remote calls per request (configurable,
  disable-able). Scoped explicitly in the notes.
- **`skills_supported` false → true.** Google now ships **Agent Skills** (SKILL.md bundles,
  official Apache-2.0 library `google-gemini/gemini-skills`, publicised 2026-03-25). Scoped in the
  notes: they are an **agent/CLI-layer** construct (Gemini CLI, Antigravity) — `generateContent`
  and the Interactions API do not accept a skill object, so an API-only caller still has only
  `system_instruction`.

### Provenance-only refreshes (value unchanged)

- `max_tools_hard` / `max_total_tools` (**512**) — confidence **downgraded high → medium** on every
  model. Re-checked 2026-08-19: no tier-1 Google page states the number. Value retained because the
  API's own proto-validation error states it verbatim; conflict with a tier-4 claim of 128 recorded
  in the notes.
- `native_mcp` — source moved from the SDK repo to
  [interactions-overview](https://ai.google.dev/gemini-api/docs/interactions-overview) /
  [antigravity-agent](https://ai.google.dev/gemini-api/docs/antigravity-agent) (2.5 Pro keeps the
  SDK source, since no server-side path exists for it). Confidence stays medium.
- `gemini-3.5-flash.knowledge_cutoff` (2025-01) — the model page dropped its knowledge-cutoff row;
  source moved to [What's new in Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5),
  which still states "January 2025".
- `release_date` on all three existing models — source moved to the model-versions table on the
  deprecations page, which now carries exact dates (May 19 2026 / May 7 2026 / June 17 2025).
- `reasoning_tokens_count_as_output`, `prompt_caching`, `tool_search_deferral`,
  `strict_function_schema` — repointed to pages that currently state the fact
  (tokens / caching / interactions-api reference / function-calling).

---

## MCP limits at a glance — Google Gemini, 2026-08-19

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| `gemini-3.7-flash` | yes — server-side via the Antigravity managed agent (preview); client-side SDK otherwise | yes | **512** functionDeclarations — **aggregate** (all MCP servers + custom functions in one request) | 20 (vendor advisory 10–20) | 1,048,576 in / 65,536 out | billed as input; broken out as `total_tool_use_tokens` in usage |
| `gemini-3.6-flash` | yes — client-side SDK (experimental); remote MCP "coming soon" for Gemini 3 | yes | **512**, aggregate | 20 | 1,048,576 / 65,536 | as above |
| `gemini-3.5-flash` | yes — client-side SDK (experimental) | yes | **512**, aggregate | 20 | 1,048,576 / 65,536 | as above |
| `gemini-3.5-flash-lite` | yes — client-side SDK (experimental) | yes | **512**, aggregate | 20 | 1,048,576 / 65,536 | as above |
| `gemini-3.1-flash-lite` *(deprecated, shutdown 2027-05-07)* | yes — client-side SDK (experimental) | yes | **512**, aggregate | 20 | 1,048,576 / 65,536 | as above |
| `gemini-2.5-pro` | yes — client-side SDK (experimental) only; no documented remote-MCP path | yes | **512**, aggregate | 20 | 1,048,576 / 65,536 | as above; **crossing 200k doubles the input rate** |

Other limits that bind, same for every model:

- **per-tool:** function name ≤ **64 characters**, charset `[A-Za-z0-9_.:-]`, must start with a
  letter or underscore. Gemini CLI namespaces MCP tools as `mcp_{serverName}_{toolName}` and
  truncates names over 63 chars.
- **per-request payload:** **100 MB** inline (50 MB for PDFs); Files API for anything larger.
- **client layer:** Gemini CLI drops MCP tools past roughly **100** aggregate tools
  ([issue #21823](https://github.com/google-gemini/gemini-cli/issues/21823), closed); default
  per-server request timeout 600,000 ms.
- **schema:** OpenAPI subset only; *"For `any` mode, the API may reject very large or deeply nested
  schemas"* — no numeric depth/property cap published.
- **there is no documented per-MCP-server tool cap** — a server's ceiling is only its share of the
  512 aggregate budget.

### The MCP status change, stated precisely

MCP moved from "experimental SDK client only" to a documented API tool type, but is **not** yet
usable server-side from a plain Gemini 3 call:

1. The [function-calling page](https://ai.google.dev/gemini-api/docs/function-calling) now carries a
   *"Remote MCP (Model Context Protocol)"* section, and the
   [Interactions API reference](https://ai.google.dev/api/interactions-api) defines a tool of type
   `mcp_server` with `url` / `headers` / `name` / `allowed_tools`.
2. But the [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
   Limitations section says verbatim: **"Remote MCP: Gemini 3 does not support remote MCP, this is
   coming soon."**
3. The one live server-side path is the **Antigravity managed agent** (preview, default model
   `gemini-3.7-flash`, [announced 2026-07-07](https://blog.google/innovation-and-ai/technology/developers-tools/expanding-managed-agents-gemini-api/)).
4. For direct model calls, MCP is still client-side via google-genai, where *"Built-in MCP support
   is an experimental feature"* — tools only, no resources or prompts.
5. Transport constraint: *"Remote MCP only works with Streamable HTTP servers. SSE (Server-Sent
   Events) servers are not supported"*; server names must be lowercase alphanumeric and
   *"should not include the `-` character. Use `snake_case` server names instead."*

Google also now runs its own public MCP server over its docs (`gemini-api-docs-mcp.dev`, exposing
`search_documentation`).

### Other platform changes worth flagging to the recommender

- **Interactions API GA (June 2026)** is now the recommended surface. Tools are *interaction-scoped*
  and must be re-sent every interaction, so a large MCP tool block is re-billed each turn unless
  implicit caching hits. It does **not** support explicit caching, the Batch API, or Python
  automatic function calling.
- **Token accounting gained `total_tool_use_tokens`** (plus `total_thought_tokens`,
  `total_cached_tokens`) — an MCP server's definition footprint is now directly measurable from a
  live response, not just via `countTokens`.
- **`temperature` / `top_p` / `top_k` deprecated 2026-07-21**; `thinking_budget` → `thinking_level`.
- **Minimum cacheable prompt**: 4,096 tokens for Gemini 3.7 / 3.6 / 3.5 Flash, 2,048 for Gemini 2.5
  Flash/Pro — a small tool block will not be cached at all.

---

## Unresolved / undocumented

Fields left `null` (or held at reduced confidence) because no public source states them:

- **`gemini-3.1-flash-lite.knowledge_cutoff` → null.** The 2026-06 value (`2025-01`) cited the
  ai.google.dev model page, which no longer carries a knowledge-cutoff row for any Gemini 3.x model.
  Searched: the model page, the DeepMind model card (published 3 March 2026 — no cutoff stated), the
  Gemini 3 developer guide, the release notes. Not publicly documented, so nulled rather than
  carried forward unsourced. (3.7/3.6 Flash and 3.5 Flash-Lite *do* have it — "March 2026" — on
  their DeepMind cards; 3.5 Flash has it on its what's-new page; 2.5 Pro still has the row on its
  model page.)
- **`max_tools_hard` / `max_total_tools` = 512 — no tier-1 source.** Per the dataset's tiered-evidence
  rule this is a HARD limit that should carry tier-1 vendor documentation. Google publishes none:
  checked the function-calling page, the Interactions API reference, the Gemini 3 guide, the
  generate-content and caching API references, and the Agent Platform quotas page. Value retained on
  the strength of the API's own verbatim proto-validation error, confidence downgraded to **medium**
  and the gap recorded in the field notes. A reviewer who reads the tier rule strictly may want this
  nulled.
- **`max_tool_description_len`** — no character or token cap documented anywhere; `description` is an
  untyped optional string in both the function-calling docs and the Interactions API reference.
- **`max_tool_result_size`** — no per-`functionResponse` byte or token cap documented.
- **`max_parallel_tool_calls_count`** — parallel calling documented, no numeric cap published.
- **`max_connected_servers`** — no cap at the API layer; the Interactions API reference sets none on
  how many `mcp_server` tools an interaction may carry.
- **`max_output_tokens_default`** — Google documents one output limit, not a default/max pair.
- **`memory_feature`** — no cross-session memory product; `previous_interaction_id` is per-conversation
  session state, not durable memory.
- **Per-model rate limits removed.** The 2026-06 revision carried RPM/TPM/RPD figures. The
  [rate-limits page](https://ai.google.dev/gemini-api/docs/rate-limits) no longer publishes them —
  it now says limits "can be viewed in Google AI Studio" (only Batch enqueued-token quotas remain
  tabulated). The stale numbers were removed from `other_limits_notes` rather than restated.
- **Minimum cacheable prompt for Flash-Lite models** — the caching page tabulates Gemini 3.7/3.6/3.5
  Flash (4,096) and Gemini 2.5 Flash/Pro (2,048) but has no Flash-Lite row.
- **`gemini-2.5-pro` knowledge cutoff cross-check** — Google's model page states "January 2025";
  cross-checked against Oracle OCI's Gemini 2.5 Pro page (tier 3), which agrees. The DeepMind model
  card URL for 2.5 Pro returns 404.
- **No Gemini-specific empirical tool-count degradation data exists.** The most recent public study
  (Superhuman, June 2026: 584-tool / 110-agent catalog, flat-routing F1 58.2% at 51 tools → 42.1% at
  584) tested GPT-5.4, GPT-5.1 and Claude Sonnet 4.5 only. That same round-up asserts a Gemini
  ceiling of "128 function declarations per request", which conflicts with the verbatim Gemini error
  string of 512 and reads as a transcription of OpenAI's cap — conflict recorded in the field notes,
  higher-quality source preferred.
- **Vertex / Gemini Enterprise Agent Platform pages** (`docs.cloud.google.com/...` function-calling
  reference, model quotas, per-model spec pages) rendered as navigation-only through WebFetch, so no
  numbers could be quoted from them. Nothing in the file depends on them.

---

## Sources (every URL opened in this pass)

**Google — Gemini API docs (tier 1)**
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/changelog
- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/tokens
- https://ai.google.dev/gemini-api/docs/function-calling
- https://ai.google.dev/gemini-api/docs/function-calling?example=meeting
- https://ai.google.dev/gemini-api/docs/tools
- https://ai.google.dev/gemini-api/docs/caching
- https://ai.google.dev/gemini-api/docs/file-input-methods
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/long-context
- https://ai.google.dev/gemini-api/docs/gemini-3
- https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5
- https://ai.google.dev/gemini-api/docs/latest-model
- https://ai.google.dev/gemini-api/docs/interactions-overview
- https://ai.google.dev/gemini-api/docs/antigravity-agent
- https://ai.google.dev/gemini-api/docs/custom-agents
- https://ai.google.dev/gemini-api/docs/coding-agents
- https://ai.google.dev/api/interactions-api
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/api/caching

**Google — model cards / blogs (tier 1)**
- https://deepmind.google/models/model-cards/gemini-3-7-flash/
- https://deepmind.google/models/model-cards/gemini-3-5-flash/
- https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/
- https://deepmind.google/models/model-cards/gemini-2-5-pro/ *(404 — no current 2.5 Pro card)*
- https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-3-6-Flash-Model-Card.pdf
- https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-3-5-Flash-Lite-Model-Card.pdf
- https://blog.google/innovation-and-ai/technology/developers-tools/expanding-managed-agents-gemini-api/
- https://developers.googleblog.com/closing-the-knowledge-gap-with-agent-skills/

**Google — SDK / CLI / skills (tier 1–2)**
- https://github.com/googleapis/python-genai
- https://github.com/google-gemini/gemini-skills
- https://geminicli.com/docs/tools/mcp-server/
- https://geminicli.com/docs/cli/skills/

**Google Cloud (fetched, navigation-only content — nothing quoted)**
- https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling *(302)*
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/function-calling
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-pro
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-7-flash

**Tier 3–4 (cross-check / empirical only)**
- https://github.com/google-gemini/gemini-cli/issues/19083 — verbatim 512-declaration API error
- https://github.com/google-gemini/gemini-cli/issues/21823 — ~100-tool client-layer ceiling
- https://github.com/Yeachan-Heo/oh-my-claudecode/issues/235 — verbatim 64-char function-name error
- https://nerdleveltech.com/how-many-tools-can-an-ai-agent-handle — 2026 tool-count study (no Gemini data; conflicting 128 claim)
- https://docs.oracle.com/en-us/iaas/Content/generative-ai/google-gemini-2-5-pro.htm — 2.5 Pro cutoff cross-check

---

## Remediation 2026-08-19

Scope: the audit findings against `data/saas/google-gemini.json` (all 6 models), plus same-class
defects found while fixing them. Every URL below was re-opened in this pass.

| Finding | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| **BLOCKER** — `tools_mcp.max_tools_hard` = 512 recorded at **tier 2** citing a GitHub issue (tier 4 under methodology §4), for a HARD limit | Searched for Google's own statement: opened the Gemini API function-calling docs (no numeric cap; only "Keep active set to 10-20 tools maximum"), the Interactions API overview, the Live API tools page, the Vertex REST `FunctionDeclaration` reference and the Gemini Enterprise / Vertex function-calling reference — **none publishes a maximum count**. Kept 512 but **re-graded to tier 4 / medium**, with notes stating it is an observed API rejection ("At most 512 function declarations can be specified", issue opened 2026-02-14, closed "not planned") and **unconfirmed by vendor docs**. Notes also record the one tier-1 count Google does publish, on a different surface: Firebase AI Logic's "The maximum number of function declarations that you can provide with the request is 128" (presented there as a Firebase AI Logic SDK constraint), and tell the reader to treat 128 as the conservative planning number and 512 as the observed raw-API rejection point | `512` (unchanged) | https://github.com/google-gemini/gemini-cli/issues/19083 | **4** / medium |
| **BLOCKER (sibling)** — `tools_mcp.max_total_tools` = 512, same citation/tier | Same treatment, aggregate scope restated | `512` | https://github.com/google-gemini/gemini-cli/issues/19083 | **4** / medium |
| **MAJOR** — `tools_mcp.max_tool_name_len` = 64 sourced to an unrelated third-party repo issue (`Yeachan-Heo/oh-my-claudecode#235`), tier 4, for an API-enforced shape limit | Re-sourced to Google's own `FunctionDeclaration` reference: "The name of the function to call. Must start with a letter or an underscore. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a max length of 64." Corroborated on the Vertex AI REST `FunctionDeclaration` reference ("…underscores, dots and dashes, with a maximum length of 64"), quoted in notes | `64` + `unit: "characters"` | https://firebase.google.com/docs/reference/js/vertexai.functiondeclaration | **1** / **high** |
| **MINOR** — `gemini-3.7-flash` `tools_mcp.native_mcp` = true cited to the Antigravity agent page (managed-agent scope only) | Re-sourced to the Gemini API function-calling docs, which define the `mcp_server` tool type and state "Interactions API supports connecting to remote MCP servers…" — and where **gemini-3.7-flash is the model in every remote-MCP example** (Python/JS/REST). Notes state the scope explicitly: Streamable HTTP only ("SSE (Server-Sent Events) servers are not supported"), snake_case server names, the contradicting Interactions-overview limitation "Gemini 3 does not support remote MCP, this is coming soon", the experimental client-side SDK path, and that Antigravity is a separate product surface | `true` | https://ai.google.dev/gemini-api/docs/function-calling | 1 / medium |
| **Same class (self-found)** — the other 5 models' `native_mcp` = true cited pages that do not carry the claim: 4 models cited the Interactions overview (which actually says Gemini 3 does **not** support remote MCP) and `gemini-2.5-pro` cited the `googleapis/python-genai` **GitHub repo** at tier 1 | All 5 re-sourced to Google's published Gen AI SDK documentation site, which states "Built-in MCP support is an experimental feature" and shows an MCP `ClientSession` passed as `tools=[session]` (example model `gemini-2.5-flash`) — the client-side path that actually makes the value true. Notes carry the remote-MCP limitation quote and its URL | `true` | https://googleapis.github.io/python-genai/ | 1 / medium |
| **Same class (self-found)** — `tool_use_per_turn_limit` = 10 cited to the `googleapis/python-genai` GitHub repo | Source re-pointed to the same published SDK docs site, which states "by default the SDK will perform automatic function calling until the remote calls exceed the maximum remote call for automatic function calling (default to 10 times)". Value and SDK-layer scope unchanged | `10` | https://googleapis.github.io/python-genai/ | 1 / medium |
| **Same class (self-found)** — three notes (`max_tools_practical`, `tool_use_per_turn_limit`, `max_connected_servers`) described 512 as a settled cap | Each now says "an observed API rejection, tier 4 — see `max_tools_hard`" | prose only | — | — |

Pages opened and **not** used as the recorded source (honesty record): Gemini API function-calling
docs (checked for a declaration-count cap — none), Interactions API overview, Live API tools page,
Firebase AI Logic function-calling (the 128 figure, different surface — quoted in notes only),
Vertex AI REST `FunctionDeclaration` (corroborates the 64-char name cap; its clean URL 404s and only
resolved with a query parameter, so the Firebase reference is cited instead), Gemini Enterprise /
Vertex function-calling reference (rendered nav-only).
