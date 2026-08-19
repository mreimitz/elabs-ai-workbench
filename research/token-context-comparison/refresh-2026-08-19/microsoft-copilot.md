# Microsoft Copilot — dataset refresh, 2026-08-19

Previous research pass: **2026-06-21**. This pass: **2026-08-19**.
File refreshed in place: `/tmp/tcc/data/saas/microsoft-copilot.json` (top-level `as_of` → `2026-08-19`,
`schema_version` unchanged at `1.0`).

**Headline:** Microsoft Copilot is no longer a three-surface vendor. Two MCP-native surfaces were
missing from the dataset (**Copilot Cowork**, GA 2026-06-16, and **Copilot Studio**, where MCP is GA),
Microsoft shipped its own frontier coding model (**MAI-Code-1.1-Flash**, 2026-08-11), and
**Microsoft 365 Copilot became multi-vendor** (Anthropic Claude selectable from 2026-06-16). Two
limits moved from Tier-2 GitHub-issue evidence to Tier-1 vendor docs, one new hard limit was found
(a 2,048-character model-facing description cap), and four unsourceable consumer context numbers
were removed.

---

## Models

### Validated (3 pre-existing entries, every field re-verified)

| id | status | verdict |
|---|---|---|
| `microsoft-365-copilot` | `ga` | Retained. Core MCP limits re-confirmed on pages updated 2026-07-13 / 2026-08-05 / 2026-08-10. Now multi-vendor-model. |
| `microsoft-copilot-consumer` | `ga` | Retained. Still no developer MCP or function-calling surface. Four context values removed for lack of Tier-1 evidence. |
| `github-copilot` | `ga` | Retained. 128-tool cap upgraded to Tier-1; 1M context confirmed; prompt caching confirmed present. |

### Added (3)

| id | display name | release / GA date | source |
|---|---|---|---|
| `microsoft-copilot-cowork` | Microsoft Copilot Cowork | GA **2026-06-16** worldwide | [Microsoft 365 Blog](https://www.microsoft.com/en-us/microsoft-365/blog/2026/06/16/copilot-cowork-is-now-generally-available/) |
| `microsoft-copilot-studio` | Microsoft Copilot Studio (agent platform) | MCP **GA** (blog announcement dated 2025-05-29); MCP docs page updated 2026-08-03 | [Microsoft Copilot Blog](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio/), [Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-components-to-agent) |
| `mai-code-1-1-flash` | MAI-Code-1.1-Flash | Released **2026-08-11**, GA in GitHub Copilot | [Microsoft AI model card (PDF)](https://microsoft.ai/pdf/MAI-Code-1.1-Flash-Model-Card.PDF), [Microsoft AI news](https://microsoft.ai/news/mai-code-1-1-flash-br-better-faster-at-a-quarter-of-the-cost/) |

Rationale for the two additions that are not strictly "released since 2026-06-21":

- **Copilot Cowork** GA'd on 2026-06-16 — five days *before* the previous pass's `as_of` — and was
  simply missed. It is the most MCP-relevant Microsoft surface after GitHub Copilot, and it carries
  the only vendor-published *skill* token budget anywhere in this vendor's docs.
- **Copilot Studio** existed before, but was represented only as a footnote inside other entries'
  `other_limits_notes`. Its limit profile (5 MB connector payload, 100 skills/agent, 500 knowledge
  sources/agent, no published tool cap) is materially different and belongs as a first-class entry.

### Retired / deprecated (0)

No model entry changed to `deprecated` or `retired`. Nothing was deleted and no `id` was renamed.
Two adjacent facts worth recording but **not** modelled as retirements:

- **MAI-Code-1-Flash** (released 2026-06-02) is superseded by MAI-Code-1.1-Flash. It never had an
  entry in this file, so none was created — only the current-generation model belongs in the roster.
  It is named in the new entry's notes.
- Consumer Copilot **features** retire on **2026-08-18**: Group Chat, Podcasts and consumer Deep
  Research ([Microsoft Support](https://support.microsoft.com/en-us/microsoft-365-copilot/learning/changes-microsoft-copilot-app)).
  These are features, not models, and are recorded in `tools_mcp.other_limits_notes`.

---

## Changed values

22 provenanced values changed. 86 `source_url`s were refreshed to pages that currently state the
value, 15 confidences and 6 source tiers were revised, 0 fields were dropped, and every one of the
125 pre-existing provenanced fields was retained.

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| *(provider)* | `skills_concept` | "Declarative agents + plugins (M365); agent mode + MCP (GitHub); no developer skills (Consumer)" | adds Cowork Skills + connectors, Copilot Studio agents+tools | https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development | 1 | high |
| microsoft-365-copilot | `tools_mcp.max_tool_description_len` | `null` | **2048** (characters) | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4 | 1 | medium |
| microsoft-365-copilot | `tools_mcp.max_connected_servers` | `null` | **10** (MCP servers / API plugins per declarative agent) | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.8 | 1 | high |
| microsoft-365-copilot | `tools_mcp.parallel_tool_calls` | `null` | **false** | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-architecture | 1 | medium |
| microsoft-365-copilot | `tokenization.tokenizer_family` | `"o200k_base"` | `"model-dependent (OpenAI GPT-5.x → o200k_base-family; Anthropic Claude → Anthropic tokenizer)"` | https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes | 1 | medium |
| microsoft-365-copilot | `tokenization.tokenizer_public` | `true` | `null` | https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes | 1 | low |
| microsoft-365-copilot | `tokenization.tokenizer_access` | "tiktoken (o200k_base, inherited from GPT-5)" | "model-dependent; use the upstream provider's tokenizer" | https://github.com/openai/tiktoken | 2 | medium |
| microsoft-365-copilot | `tokenization.count_tokens_method` | "tiktoken o200k_base (approximate)" | "approximate only — tiktoken o200k_base for the OpenAI path" | https://github.com/openai/tiktoken | 2 | low |
| microsoft-365-copilot | `skills_context.prompt_caching` | `false` | `null` | https://www.microsoft.com/en-us/microsoft-365-copilot/pricing | 1 | low |
| microsoft-365-copilot | `tools_mcp.tool_search_deferral` | `true` (medium, tier 1) | `true` — re-sourced to dynamic tool discovery | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-dynamic-tool-discovery | 1 | **high** (was medium) |
| microsoft-365-copilot | `tools_mcp.max_total_tools` | 10, sourced to manifest **1.7** | 10, sourced to manifest **1.8** (GA) | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.8 | 1 | high |
| microsoft-365-copilot | `cost.billing_unit` (notes) | Business ~$21, Enterprise ~$30 | Business add-on **$18.00**/user/mo yearly (promo to 2026-09-30); bundles $23.50 / $32.00; Enterprise **$30.00** yearly / $31.50 monthly | https://www.microsoft.com/en-us/microsoft-365-copilot/pricing · https://www.microsoft.com/en-us/microsoft-365-copilot/enterprise | 1 | high |
| microsoft-365-copilot | `release_date` | 2023-11-01 (medium) | 2023-11-01, confidence **low** — cited page opened and does not state a GA date | https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-overview | 1 | low |
| microsoft-copilot-consumer | `context.context_window_tokens` | **200000** | **`null`** | https://learn.microsoft.com/en-us/answers/questions/5447652/whats-token-limit-for-think-deeper-quick-response | 3 | low |
| microsoft-copilot-consumer | `context.max_input_tokens` | **200000** | **`null`** | same | 3 | low |
| microsoft-copilot-consumer | `context.max_output_tokens_default` | **100000** | **`null`** | same | 3 | low |
| microsoft-copilot-consumer | `context.max_output_tokens_max` | **100000** | **`null`** | same | 3 | low |
| microsoft-copilot-consumer | `tokenization.tokenizer_family` | `"o200k_base"` | `null` | https://www.microsoft.com/en-us/microsoft-copilot/for-individuals/features | 1 | low |
| microsoft-copilot-consumer | `tokenization.tokenizer_public` | `true` | `null` | same | 1 | low |
| microsoft-copilot-consumer | `tokenization.tokenizer_access` | "tiktoken (o200k_base…)" | `null` | https://github.com/openai/tiktoken | 2 | low |
| microsoft-copilot-consumer | `tokenization.count_tokens_method` | "tiktoken o200k_base (approximate)" | `null` | same | 2 | low |
| microsoft-copilot-consumer | `skills_context.prompt_caching` | `false` | `null` | https://www.microsoft.com/en-us/microsoft-copilot/for-individuals | 1 | low |
| microsoft-copilot-consumer | `skills_context.memory_feature` | `true` (medium) | `true` — vendor page quotes the feature verbatim | https://www.microsoft.com/en-us/microsoft-copilot/for-individuals/features | 1 | **high** (was medium) |
| microsoft-copilot-consumer | `release_date` | 2023-09-21 | **2023-11-15** (Bing Chat rebranded to Copilot, per the page actually opened) | https://en.wikipedia.org/wiki/Microsoft_Copilot | 3 | medium |
| microsoft-copilot-consumer | `cost.billing_unit` (notes) | free / M365 Personal-Family ~$9.99-12.99; "no usage cap on Think Deeper and Voice" | free / **Microsoft 365 Premium**; usage limits apply and differ by tier | https://www.microsoft.com/en-us/microsoft-copilot/for-individuals | 1 | high |
| github-copilot | `tools_mcp.max_tools_hard` | 128, **tier 2** (GitHub issue) | 128, **tier 1** — "A chat request can have a maximum of 128 tools enabled at a time" | https://code.visualstudio.com/docs/agents/run/tools | **1** (was 2) | high |
| github-copilot | `tools_mcp.max_total_tools` | 128, **tier 2** | 128, **tier 1** | same | **1** (was 2) | high |
| github-copilot | `tools_mcp.tool_search_deferral` | `true`, tier 2 (blog) | `true`, tier 1 — `github.copilot.chat.virtualTools.threshold` documented | same | **1** (was 2) | high |
| github-copilot | `context.extended_context` | 1000000 (medium) | 1000000 — "1 million token context window… available in Visual Studio Code and Copilot CLI only" | https://docs.github.com/en/copilot/reference/ai-models/supported-models | 1 | **high** (was medium) |
| github-copilot | `skills_context.prompt_caching` | `null` | **true** — billing table has `Cached input` + `Cache write` columns | https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing | 1 | **high** (was low) |
| github-copilot | `cost.input_per_mtok_usd` | `null` (low) | `null` (model-dependent) with verified per-model rates in notes | same | 1 | **high** (was low) |
| github-copilot | `cost.output_per_mtok_usd` | `null` (low) | `null` with verified per-model rates in notes | same | 1 | **high** (was low) |
| github-copilot | `cost.cached_input_per_mtok_usd` | `null` (low) | `null` with verified cached rates (GPT-5.5 $0.50 vs $5.00; MAI-Code-1.1-Flash $0.02 vs $0.20) | same | 1 | **high** (was low) |
| github-copilot | `cost.billing_unit` (notes) | "Business 1,900 credits, Enterprise 3,900 credits" | plan prices re-verified; **the per-plan credit allowances are no longer asserted** — the plans page states only "each plan comes with an allowance of GitHub AI Credits" | https://docs.github.com/en/copilot/get-started/plans | 1 | high |
| github-copilot | `tokenization.tokenizer_family` | "(o200k_base for GPT/o3; Claude; SentencePiece/BPE for Gemini)" | seven-vendor list incl. Microsoft MAI, Moonshot Kimi, xAI, Qwen | https://docs.github.com/en/copilot/reference/ai-models/model-comparison | 1 | medium |
| github-copilot | `tokenization.tokenizer_access` / `count_tokens_method` | prose naming Claude/Gemini APIs | generalised to "the provider's count-tokens API otherwise" | https://github.com/openai/tiktoken · billing page | 2 | medium |

Also rewritten but not value-changes: every `tool_schema_limits_notes`, `other_limits_notes`,
`skills_context_cost_notes`, `system_prompt_overhead_notes`, `multimodal_billing_notes` and model
`notes`/`sources` on all three pre-existing entries.

### Anti-trap compliance fix

The pre-existing file used **"Not applicable"** as the explanation for ~20 null tool/cost fields on
the M365 and consumer entries. That phrasing is banned by the methodology (it misrepresents a
missing *surface* as a missing *limit*). Every instance was rewritten to name what actually binds —
e.g. consumer Copilot now reads: *"Consumer Copilot publishes no developer tool-calling or MCP
surface, so there is no per-request numeric cap to record here. The limits that actually bind a
consumer session are Microsoft-managed and undocumented: per-feature usage limits that 'differ for
free and Microsoft 365 Premium users', and the undisclosed context window of whichever model the
Smart-mode router selects."* A scan of the final file returns **zero** occurrences of
`unlimited` / `no limit` / `no cap` / `doesn't apply` / `not applicable`.

Note the source-side trap this pass had to sidestep: the Microsoft 365 Copilot plugins page now
literally reads *"A plugin can include an unlimited number of functions or MCP tools."* That is
recorded in the data as **"the plugin manifest publishes no numeric cap on functions/MCP tools per
plugin"**, followed by the limits that do bind (10 actions/agent, the >10-function quality cliff,
the 4,096-token plugin budget).

---

## MCP limits at a glance — Microsoft Copilot, 2026-08-19

| model | native_mcp | function_calling | max_tools_hard (+ scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| `microsoft-365-copilot` | ✅ yes (declarative-agent plugins; MCP apps; federated connectors; MCP agents in Office apps) | ✅ yes | **no per-request tool-count cap published.** Binding aggregates: **10 actions (plugins/MCP servers) per declarative agent** (manifest 1.8, hard); **5** plugins always-injected, semantic matching above that; per-plugin quality cliff above 10 functions/tools | **10** functions/tools per plugin (vendor-published degradation point) | **not published**; the binding scope is the **4,096-token plugin I/O budget** (optimize to ~2,730) | ✅ counted — the 4,096-token limit "includes all context and response data" |
| `microsoft-copilot-cowork` | ✅ yes (`remoteMcpServer` connectors, JSON-RPC 2.0 over streamable HTTP) | ✅ yes | **no per-request tool-count cap published.** Binding: **10 connectors + 20 skills per app package**; **50** custom skills+plugins per user | **not published** for this surface | **not published**; input ceiling is **250,000 characters** per prompt | ✅ counted (inferred from the **SKILL.md < 5,000-token** body budget) |
| `microsoft-copilot-studio` | ✅ yes (MCP GA; servers as Power Platform custom connectors; generative orchestration required) | ✅ yes | **no per-request tool-count cap published.** Docs state MCP servers "count against the total number of tools an agent can host" and that concurrent MCP server instances per conversation are capped *without giving the number*. Hardest number on the path: **5 MB connector payload** (450 KB GCC) | **not published**; docs decline to describe degradation | **not published**; instructions capped at **8,000 characters** | ✅ counted (inferred; name/description quality is documented as decisive) |
| `github-copilot` | ✅ yes (VS Code, JetBrains, Xcode, Eclipse, Cursor, Windsurf, Copilot CLI, Copilot app, cloud agent) | ✅ yes | **128** — **AGGREGATE**, client/host layer (all MCP servers + built-in + extension tools in one chat request). Tier 1. | **13** (default built-ins cut 40→13; +2-5 pts on SWE-Lancer / SWEbench-Verified, −400 ms). Empirical. | model-dependent; **1M extended** on supported Claude / GPT-5.x / Kimi K3 models, **VS Code + Copilot CLI only** | ✅ counted and **billed** as input tokens (AI Credits) |
| `mai-code-1-1-flash` | ✅ via host only (reachable through GitHub Copilot) | ✅ yes ("agentic tool use", model card) | **no model-layer cap published.** Host cap binds: **128** aggregate in VS Code | **13** (inherited from host guidance; not measured on this model) | **256,000** — the only Tier-1 context window in this vendor's file | ✅ counted and billed ($0.20/1M input, $0.02 cached) |
| `microsoft-copilot-consumer` | ❌ no developer MCP surface | ❌ no developer function-calling surface | no developer tool surface exists, so there is no per-request cap to record; what binds is Microsoft-managed per-feature usage limits and the undisclosed routed-model window | — | **not published** (removed this pass; see below) | — |

**Scope reminder:** every number above is **aggregate** (all connected servers + built-in tools in
one request/agent) or **per package/agent**. Across all six entries there is still **no documented
per-MCP-server hard tool cap** for Microsoft Copilot.

---

## Unresolved / undocumented

Fields left `null` for lack of a public Tier-1 source, with what was searched:

- **`microsoft-copilot-consumer.context.context_window_tokens` / `max_input_tokens` /
  `max_output_tokens_default` / `max_output_tokens_max`** — the previous 200K/100K values rested on a
  single Microsoft Q&A thread answered by an **Independent Advisor (not a Microsoft employee)** on
  2025-07-10, quoting Azure AI Foundry specs for **o1 / o3-mini** — models that no longer back this
  surface — and the same thread contradicts itself elsewhere. I re-opened that thread to confirm. No
  Tier-1 Microsoft page publishes a consumer context window (checked the for-individuals page, the
  features page, and the Copilot app changes support article). Under the tiered-evidence rule these
  are now `null`.
- **`microsoft-copilot-consumer.tokenization.*`** — tokenizer identity is a hard field. Microsoft
  documents only that Smart mode uses "GPT-5's real-time router to choose the best response
  approach", which names no tokenizer and implies per-turn variation. Nulled.
- **`microsoft-365-copilot.context.*`** — Microsoft still publishes no raw context window for the
  product, and it is now ambiguous anyway (OpenAI *or* Anthropic per tenant/user choice). Searched
  the overview, architecture, plugins, manifest 1.8, whats-new and release-notes pages.
- **`microsoft-copilot-cowork.context.context_window_tokens`** — the Cowork FAQ enumerates the
  selectable models (GPT 5.5, GPT 5.6 variants, Claude Opus, Claude Sonnet, Claude Fable 5 preview)
  but publishes no window. The nearest published ceiling is 250,000 **characters** per prompt.
- **`microsoft-copilot-studio` — tool counts and server counts.** The tools-overview page states MCP
  servers "count against the total number of tools an agent can host" and that concurrent MCP server
  instances in one conversation are capped, but **publishes neither number**. Checked the quotas
  page (which gives 100 skills/agent, 500 knowledge sources/agent, 1,000 topics/agent, 5 MB connector
  payload — none of them a tool count), the MCP page and the billing page.
- **`mai-code-1-1-flash.tokenization.tokenizer_family`** — the official Microsoft AI model card gives
  context length, cutoff, modalities and architecture but names **no tokenizer**; there is no Hugging
  Face card and no downloadable weights. This matters: Microsoft claims "25% fewer tokens to complete
  a task" versus v1.0, so a generic 4-chars/token estimate is unusually unreliable here.
- **`mai-code-1-1-flash.context.max_output_tokens_*`** — not on the model card.
- **`*.max_tool_name_len`** on every surface — no Microsoft or GitHub page publishes one. M365's
  plugin manifest 2.4 constrains function names only by regex (`^[A-Za-z0-9_]+$`) under the 4,000-char
  manifest default.
- **`github-copilot` per-model context windows** — GitHub's supported-models and model-comparison
  pages list ~34 models with capability checkmarks but **no context-window column**. The only
  published proxy is the billing page's long-context threshold (e.g. GPT-5.5 `≤ 272K` vs `> 272K`).
- **GitHub Copilot per-plan AI-credit allowances** — the previously recorded 1,900 / 3,900 figures
  could not be re-confirmed; the plans page now says only "each plan comes with an allowance of
  GitHub AI Credits". The claim was withdrawn rather than carried forward unsourced.
- **Prompt-cache mechanics on GitHub Copilot** — caching is confirmed *present* (cached-input and
  cache-write pricing columns), but TTL, minimum cacheable prefix, and whether tool definitions sit
  in the cached prefix are all undocumented.
- **`microsoft-copilot-cowork.skills_context.skills_loading_model`** — the single most consequential
  gap found this pass. Microsoft publishes a SKILL.md budget (<5,000 tokens), 20 skills/package and
  50 skills+plugins/user, but never says whether skill bodies are always injected or progressively
  disclosed. If always-on, a fully loaded account is nominally ~250k tokens of skill text.
- **Microsoft Work IQ API MCP limits** — the extensibility overview (updated 2026-08-05) confirms
  Work IQ exposes Microsoft 365 data over both A2A and MCP, but publishes no tool, token or payload
  limit. Recorded in notes only.
- **Federated Copilot connectors (MCP-based)** — no numeric result, tool, timeout or payload limit is
  published; only governance numbers (12 categories, 50+ sources, 7-day admin review window).

**Fetch failure:** `neowin.net` returned HTTP 403. It was a Tier-4 lead for MAI-Code-1.1-Flash only,
and was fully superseded by the official Microsoft AI model card and news post — no data depends on it.

---

## Sources (every URL opened with WebFetch in this task — 45 distinct)

**Microsoft 365 Copilot extensibility (Tier 1)**
1. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview
2. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins
3. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins
4. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-architecture
5. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.8
6. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4
7. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-dynamic-tool-discovery
8. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/whats-new
9. https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/federated-connectors-overview
10. https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes
11. https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-overview

**Copilot Cowork (Tier 1)**
12. https://www.microsoft.com/en-us/microsoft-365/blog/2026/06/16/copilot-cowork-is-now-generally-available/
13. https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/
14. https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development
15. https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-manage-plugins
16. https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-faq

**Copilot Studio (Tier 1)**
17. https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-components-to-agent
18. https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/tools-overview
19. https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-quotas
20. https://learn.microsoft.com/en-us/microsoft-copilot-studio/billing-licensing
21. https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio/

**GitHub Copilot (Tier 1 docs / Tier 2 engineering blog + issue)**
22. https://docs.github.com/en/copilot/reference/ai-models/supported-models
23. https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/ai-models/supported-models
24. https://docs.github.com/en/copilot/reference/ai-models/model-comparison
25. https://docs.github.com/en/copilot/concepts/context/mcp
26. https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
27. https://docs.github.com/en/copilot/get-started/plans
28. https://github.blog/changelog/2026-06-04-larger-context-windows-and-configurable-reasoning-levels-for-github-copilot/
29. https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/
30. https://code.visualstudio.com/docs/agents/run/tools
31. https://code.visualstudio.com/docs/copilot/agents/agent-tools
32. https://github.com/microsoft/vscode/issues/290356

**Microsoft AI / MAI models (Tier 1)**
33. https://microsoft.ai/news/
34. https://microsoft.ai/news/introducingmai-code-1-flash/
35. https://microsoft.ai/news/mai-code-1-1-flash-br-better-faster-at-a-quarter-of-the-cost/
36. https://microsoft.ai/pdf/MAI-Code-1.1-Flash-Model-Card.PDF

**Pricing & consumer (Tier 1)**
37. https://www.microsoft.com/en-us/microsoft-365-copilot/pricing
38. https://www.microsoft.com/en-us/microsoft-365-copilot/enterprise
39. https://www.microsoft.com/en-us/microsoft-copilot/for-individuals
40. https://www.microsoft.com/en-us/microsoft-copilot/for-individuals/features
41. https://support.microsoft.com/en-us/microsoft-365-copilot/learning/changes-microsoft-copilot-app
42. https://techcommunity.microsoft.com/blog/microsoft365copilotblog/available-today-anthropic-claude-opus-5-in-microsoft-365-copilot/4540524

**Tooling & cross-check (Tier 2 / Tier 3)**
43. https://github.com/openai/tiktoken
44. https://learn.microsoft.com/en-us/answers/questions/5447652/whats-token-limit-for-think-deeper-quick-response *(Tier 3 — re-opened to confirm it is community-authored and cites retired models; used to justify removing four values)*
45. https://en.wikipedia.org/wiki/Microsoft_Copilot *(Tier 3 — consumer release date only)*

**Failed fetch:** https://www.neowin.net/news/microsoft-releases-mai-code-11-flash-coding-model-to-better-compete-with-chinese-models/ — HTTP 403. Not relied upon.

---

## Remediation 2026-08-19

Evidence-audit follow-up. Only the audited defects (and one same-class citation error found in the
same file) were touched. Every URL below was re-opened in this pass.

| Finding | What I did | New value | New source | New tier / confidence |
|---|---|---|---|---|
| MAJOR — `microsoft-365-copilot` `tools_mcp.max_connected_servers` = 10, cited to a page that never mentions MCP | Kept the 1–10 figure but restated the unit honestly and marked it derived. Re-opened the manifest page: `actions` is "A list of 1-10 objects that identify plugins that provide actions accessible to the declarative agent" and "The array must contain at least one and no more than 10 objects" — the words MCP / Model Context Protocol appear **nowhere** on it. The MCP bridge is a separate tier-1 page (`build-mcp-plugins`), where an MCP server is attached by adding an action ("Add an Action" → "Start with an MCP Server") backed by the `RemoteMCPServer` runtime; that page publishes no numeric limit. Notes now spell out the two-page inference. | `10`, `unit: "action (plugin) objects per declarative agent"`, `derived: true` | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.8 (+ https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins for the MCP-server↔action mapping) | tier 1 / **medium** (lowered from high) |
| MAJOR — `microsoft-365-copilot` `tools_mcp.max_total_tools` = 10 on the dataset's TOOL-COUNT axis | **Nulled.** The 10 was the same plugin-object cap, which made this surface read as a 10-tool ceiling against GitHub Copilot's 128 and Grok's 200. Re-opened the plugins overview, which states verbatim "A plugin can include an unlimited number of functions or MCP tools. All of a matched plugin's functions or tools are returned, even if only one is matched." — i.e. no per-request numeric tool-count cap is documented. Notes name the limits that do bind: 10 action/plugin objects per agent (now in `max_connected_servers`), the 5-plugin always-injected threshold above which semantic matching selects plugins (and a matched plugin brings all its tools), the 4,096-token plugin I/O budget, and the >10-functions quality cliff. | `null` (was `10`) | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins | tier 1 / low |
| Same-class cleanup — cross-references to the old unit | Rewrote `max_tools_hard.notes` (it pointed the 10-action ceiling at `max_total_tools`) and items (1) and (3) of `tool_schema_limits_notes` so the actions cap is described as plugin **objects** with the MCP-server reading flagged as derived, and the per-plugin tool count quoted from the source. | prose only | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins · https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.8 | tier 1 (unchanged) |
| Same-class defect found in this file — `mai-code-1-1-flash` `tools_mcp.max_tools_practical` = 13 cited to a GitHub **pricing** page | Re-opened `docs.github.com/.../copilot-billing/models-and-pricing`: it contains no tool count at all. Re-sourced to GitHub's engineering blog (2025-11-19), which states "we're rolling out a reduced toolset that trims the default 40 built-in tools down to 13 core ones". Notes now say what 13 actually is — the size of the **default built-in** toolset in VS Code, a product decision, not a measured degradation threshold, and not measured on MAI-Code-1.1-Flash (the same post notes Copilot Chat "can access hundreds of tools through the Model Context Protocol"). | `13` (unchanged value, honest citation) | https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/ | tier 4 / low (unchanged) |

**Checked and left alone:** `max_tools_practical` = 10 for `microsoft-365-copilot` — the cited page
does carry the claim verbatim ("Due to token window limits, the quality of the responses might
degrade if more than 10 functions or tools are included"). `microsoft-copilot-cowork`
`max_connected_servers` = 10 — the cited page does state "Maximum 10 connectors per package" and
requires "Exactly one of `plugin` or `remoteMcpServer`" per connector, so the MCP-connector unit
holds there.

---

## Final fixes 2026-08-19

Final-audit pass. One defect class, two fields, one model (`microsoft-365-copilot`). No entry was
deleted, no id renamed. Every URL below was re-opened in this pass.

**The defect (cross-vendor unit mismatch).** `tools_mcp.max_request_size` held `4096` with
`unit: "tokens"` while every other file records that field as a **byte** ceiling — Anthropic 32 MB,
Gemini 100 MB, OpenAI 512 MB, and `microsoft-copilot-studio` 5 MB in this same file. Any
`min()`/comparison the recommender runs over that field would have read Microsoft 365 Copilot as
roughly five orders of magnitude smaller than its peers. `tools_mcp.max_tool_result_size` had the
same shape: `25` with `unit: "items"` against OpenAI's 512 KB and `microsoft-copilot-cowork`'s
150 MiB per tool call — an item **count** competing in a **size** field, and it would have sorted as
the smallest tool-result cap in the roster.

**What I checked before nulling.** Microsoft publishes no byte/KB/MB request or response ceiling for
the Microsoft 365 Copilot plugin/MCP surface. Re-opened on 2026-08-19:

| Page | What it says about size |
|---|---|
| [declarative-agent-architecture](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-architecture) | Technical-limits table is expressed only in items, tokens and seconds: "Grounding record limit: 50 items", "Plugin response limit: 25 items - Constrains external API response sizes", "Token limit: 4,096* - Includes all context and response data", "Timeout limit: 45 seconds*", with "* Limits include external overhead such as network latency and Microsoft service processing. Optimize for about 66% of the technical limit." No byte/KB/MB figure anywhere. |
| [overview-plugins](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins) | No byte/KB/MB limit. Documents truncation instead: "The token window for inputs to and outputs from a plugin truncates large content." |
| [api-plugin-manifest-2.4](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api-plugin-manifest-2.4) | Character limits only (`name_for_human` 20, `description_for_model` 2048, `description_for_human` 100, general strings ~4K) plus "Implementations are free to impose their own practical limits on manifest length." No byte/KB/MB payload limit. |
| [plugin-mcp-apps-troubleshooting](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps-troubleshooting) | Advises "Ensure responses aren't excessively large" with no number. |

| Field | Before | After | Where the old figure went | Tier / confidence |
|---|---|---|---|---|
| `microsoft-365-copilot` `tools_mcp.max_request_size` | `4096`, `unit: "tokens"`, high | `null`, no unit | The 4,096 is a product-layer **token** budget for the plugin scope, quoted verbatim in the field's own `notes` (with the ~66% / ~2,730-token optimization guidance and the 45-second timeout), and already carried in `tool_schema_limits_notes` item (6) and in the `max_tools_hard` / `max_total_tools` notes. Nothing was lost — every injected tool definition, argument and result still competes inside it, and the notes say so. | tier 1 / **high → low** |
| `microsoft-365-copilot` `tools_mcp.max_tool_result_size` | `25`, `unit: "items"`, high | `null`, no unit | "Plugin response limit: 25 items" and "Grounding record limit: 50 items" are quoted verbatim in the field's `notes` and remain in `tool_schema_limits_notes` items (4) and (5); the notes also name the 4,096-token budget as the thing that actually truncates a chatty tool. | tier 1 / **high → low** |

**Same-class cleanup (prose only).** `max_tools_hard.notes` and `max_total_tools.notes` cross-referenced
the 4,096 figure by pointing at `max_request_size`; both now say the budget is documented in
`max_request_size.notes` and that the numeric field is null *because* it is this dataset's byte-payload
ceiling and Microsoft publishes no byte figure for this surface. `tool_schema_limits_notes` item (6)
now states explicitly that 4,096 is a **token** budget, not a byte payload ceiling.

**Checked and deliberately left alone.** `microsoft-copilot-studio.max_request_size` = 5 MB and
`microsoft-copilot-cowork.max_tool_result_size` = 150 MiB per tool call are genuine byte ceilings
and are correct in these fields. `microsoft-365-copilot.max_tools_practical` = 10 and
`max_connected_servers` = 10 (derived, plugin/action objects) were not in scope and were not touched.
The MCP-apps troubleshooting page's "Keep descriptions under 1,024 characters (text beyond is
ignored)" is a candidate value for `max_tool_description_len` but is outside this pass's scope and was
not written in.

### Cross-vendor consistency after the fix

Every non-null `max_request_size` and `max_tool_result_size` in all 11 files is now byte-scoped
(MB / KB / MiB). No token count and no item count remains in either field anywhere in the dataset.

### Validation

```
python3 -c "import json;json.load(open('/tmp/tcc/data/saas/microsoft-copilot.json'))"   # parses
jsonschema.validate(data, schema/model-entry.schema.json)                               # VALID
```
Re-run checks on the two edited objects: allowed provenanced keys only; no `unit` left on a null
value; `as_of` == 2026-08-19; `confidence` ∈ {high,medium,low}; `source_tier` ∈ {1,2,3,4};
anti-trap phrase scan ("unlimited / no limit / no cap / doesn't apply") — clean on both new notes.
