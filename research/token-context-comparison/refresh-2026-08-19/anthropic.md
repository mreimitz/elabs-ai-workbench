# Anthropic (Claude) — dataset refresh 2026-08-19

Previous research date: **2026-06-21**. New `as_of`: **2026-08-19**. `schema_version` unchanged (`1.0`).
File: `/tmp/tcc/data/saas/anthropic.json` (validates against `schema/model-entry.schema.json`).

**Headline:** the Anthropic roster turned over almost completely in the eight weeks since the last pass.
Three new GA models (**Fable 5**, **Sonnet 5**, **Opus 5**) and one limited-release model (**Mythos 5**)
shipped; **Opus 4.8** and **Sonnet 4.6** have been pushed into the docs' "Legacy models" section but are
still *Active* (not deprecated). Model count 3 → 7. No entry was deleted and no `id` was renamed.

---

## Models

### Validated (re-verified against live tier-1 docs)

| id | status | outcome |
|---|---|---|
| `claude-opus-4-8` | `ga` (unchanged) | Superseded by Opus 5 but **Active** in the deprecation table (retirement not sooner than 2027-05-28). 3 corrections applied (see table). |
| `claude-sonnet-4-6` | `ga` (unchanged) | Superseded by Sonnet 5 but **Active** (retirement not sooner than 2027-02-17). 2 material numeric corrections + tokenizer-generation correction. |
| `claude-haiku-4-5` | `ga` (unchanged) | Fully re-verified. Still the only 200k-window model. **Nearest retirement horizon of the roster: "not sooner than October 15, 2026."** |

### Added

| id | display name | release / GA | source |
|---|---|---|---|
| `claude-fable-5` | Claude Fable 5 | GA **2026-06-09**; withdrawn 2026-06-12 under US export controls; restored **2026-07-01** | [Introducing Fable 5 / Mythos 5](https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5), [Redeploying Fable 5](https://www.anthropic.com/news/redeploying-fable-5) |
| `claude-mythos-5` | Claude Mythos 5 | **2026-06-09**, limited release (Project Glasswing, approved US orgs); restored 2026-07-01 → `status: "preview"` | [Introducing Fable 5 / Mythos 5](https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5), [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| `claude-sonnet-5` | Claude Sonnet 5 | GA **2026-06-30** | [Introducing Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5), [release notes](https://platform.claude.com/docs/en/release-notes/overview) |
| `claude-opus-5` | Claude Opus 5 | GA **2026-07-24** | [Anthropic news](https://www.anthropic.com/news/claude-opus-5), [release notes](https://platform.claude.com/docs/en/release-notes/overview) |

### Retired / deprecated

**None in this file.** No entry in this dataset changed to deprecated or retired.

Note for the record — models retired at the vendor since the last pass are *not* in this dataset and were
not added: `claude-opus-4-1-20250805` (deprecated 2026-06-05, **retired 2026-08-05**) and
`claude-opus-4-20250514` (retired 2026-06-15). Source:
[model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).

**Deliberate decision on "superseded":** Opus 4.8 and Sonnet 4.6 keep `status: "ga"`. The schema's `status`
enum is `ga | preview | deprecated`, and the tier-1 deprecation table lists both as **Active** with
`Deprecated: N/A`. Writing `"deprecated"` would have contradicted the only tier-1 source on the question.
Supersession is recorded in each model's `notes` instead.

---

## Changed values

Only pre-existing models are listed (all four new models are net-new). "old" = value in
`data-orig/saas/anthropic.json` (as of 2026-06-21).

### Provenanced value changes (7)

| model | field | old | new | source URL | tier | confidence |
|---|---|---|---|---|---|---|
| `claude-sonnet-4-6` | `context.max_output_tokens_default` | `64000` | **`128000`** | https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-sizes-by-model | 1 | high |
| `claude-sonnet-4-6` | `context.max_input_tokens` (derived) | `936000` | **`872000`** | https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-sizes-by-model | 1 | medium |
| `claude-opus-4-8` | `tokenization.chars_per_token_estimate` | `3.5` | **`2.7`** (derived) | https://platform.claude.com/docs/en/about-claude/glossary | 1 | low |
| `claude-haiku-4-5` | `tokenization.chars_per_token_estimate` | `4.0` | **`3.5`** | https://platform.claude.com/docs/en/about-claude/glossary | 1 | low |
| `claude-opus-4-8` | `tokenization.image_token_rule` | "…max 4784 tokens for Opus 4.8 (high-res, max 2576px long edge)…" | restated to the doc's tier wording: "…high-resolution tier — max 2576px long edge, max 4784 visual tokens…" | https://platform.claude.com/docs/en/build-with-claude/vision | 1 | high→**medium** |
| `claude-sonnet-4-6` | `tokenization.image_token_rule` | "…max 1568 tokens for Sonnet 4.6 (standard res…)" | restated to the doc's tier wording ("standard tier — max 1568px long edge, max 1568 visual tokens") | https://platform.claude.com/docs/en/build-with-claude/vision | 1 | high |
| `claude-haiku-4-5` | `tokenization.image_token_rule` | "…max 1568 tokens (standard resolution…)" | restated to the doc's tier wording | https://platform.claude.com/docs/en/build-with-claude/vision | 1 | high |

### Provenance / confidence / tier changes on unchanged values (selected)

| model | field | change | source URL | tier |
|---|---|---|---|---|
| all 3 | `tools_mcp.max_tools_practical` | tier **4 → 1** (the 30–50 cliff is now stated verbatim by Anthropic's own tool-search doc, not only by practitioners); value 40 / 30 unchanged, confidence stays `medium` because the claim is behavioural | https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool | 1 |
| all 3 | `tools_mcp.max_tool_result_size` | source moved from `handle-tool-calls` (which documents no cap) to the Claude Code MCP doc, which **does** publish the binding client-layer cap: warn at 10,000 tokens, truncate at **25,000 tokens** (`MAX_MCP_OUTPUT_TOKENS`). Value stays `null` — that cap is client-layer, not model-API | https://code.claude.com/docs/en/mcp | 1 |
| Sonnet 4.6, Haiku 4.5 | `tools_mcp.max_connected_servers` | source moved to the Claude Code MCP doc, which states it "doesn't impose a fixed per-server tool cap; the practical limit is your context window budget". Value stays `null` | https://code.claude.com/docs/en/mcp | 1 |
| all 3 | `tools_mcp.strict_function_schema` | was `source_url: null`; now sourced. Value stays `false` (Anthropic's strict mode exists but has different, looser rules — the only documented keyword restriction is that `pattern`/regex is unsupported) | https://platform.claude.com/docs/en/build-with-claude/structured-outputs | 1 |
| all 3 | `context.*`, `skills_context.prompt_caching` | source URLs re-pointed to the pages that currently state the value (`#context-window-sizes-by-model`, `prompt-caching`) | (see file) | 1 |
| Opus 4.8, Sonnet 4.6 | `knowledge_cutoff` | confidence **high → medium**; value unchanged. The docs moved these models into a "Legacy models" section whose table did not render in any extraction of the overview page on 2026-08-19, so the value is carried forward, not re-read | https://platform.claude.com/docs/en/about-claude/models/overview | 1 |

### Corrections recorded in `notes` (no numeric field changed, but the prior text was wrong)

| model | what was wrong at 2026-06-21 | corrected statement | source |
|---|---|---|---|
| Opus 4.8, Sonnet 4.6 | "Previous turn thinking blocks are automatically stripped by the API and do not accumulate as input" | **Reversed.** "On newer models (Opus 4.5+, Sonnet 4.6+, Fable 5, Mythos 5), thinking blocks are **kept** and count as input tokens in subsequent turns." Only Opus <4.5, Sonnet <4.6 and **all Haiku** strip | https://platform.claude.com/docs/en/build-with-claude/context-windows |
| Opus 4.8 | "Adaptive thinking is always on" | **Reversed.** "On Claude Opus 4.8, requests run without thinking unless you set `thinking: {"type": "adaptive"}`" | https://www.anthropic.com/news/claude-opus-5 |
| Sonnet 4.6 | tokenizer described as "same newer tokenizer family as Opus 4.7+" | **Reversed.** "Claude Sonnet 4.6 and earlier models use the **previous** tokenizer" | https://platform.claude.com/docs/en/about-claude/pricing |
| Opus 4.8 (and all 4.7+) | newer tokenizer produces "up to 35% more tokens" | Now **"approximately 30% more tokens for the same text"** | https://platform.claude.com/docs/en/about-claude/pricing |
| all | MCP connector "Not yet available on Amazon Bedrock or Vertex AI" | **Microsoft Foundry added** (Hosted-on-Anthropic deployments, beta). Bedrock and Google Cloud still not listed | https://platform.claude.com/docs/en/agents-and-tools/mcp-connector |
| all | request-size note listed only 32 / 30 / 20 MB | Full current table: Messages + Token Counting **32 MB**, Message Batches **256 MB**, Files **500 MB**, Sessions/Agents/Environments 32 MB; Bedrock 20 MB, Google Cloud 30 MB; `413 request_too_large` | https://platform.claude.com/docs/en/api/overview#request-size-limits |
| all | task budgets "supported on Opus 4.8 and Opus 4.7 only" | Now **Opus 5, Fable 5, Mythos 5, Opus 4.8, Opus 4.7**; still not Sonnet 5 / Sonnet 4.6 / Haiku 4.5 | https://platform.claude.com/docs/en/build-with-claude/task-budgets |
| all | `input_examples` "adds ~20-200 tokens per tool" | Now documented as **~20–50 tokens simple, ~100–200 complex**, and unavailable on server tools | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools |
| Opus 4.8 | fast mode described as Opus-4.8-only research preview | Fast mode now covers **Opus 5 and Opus 4.8** at $10/$50 per MTok, Claude API only; **removed for Opus 4.7** (a `speed:"fast"` request errors), and Opus 4.6 silently runs at standard speed | https://platform.claude.com/docs/en/about-claude/pricing, https://platform.claude.com/docs/en/release-notes/overview |

### New facts captured that had no field at the last pass (recorded in `other_limits_notes` / `tool_schema_limits_notes`)

- **Programmatic tool calling** (`code_execution_20260120`): tool results from programmatic invocations **do not count toward input/output tokens at all**; Anthropic measured ~**38% fewer billed input tokens** on a 75-tool project-management agent benchmark with no accuracy change. Supported on Fable 5, Mythos 5, Opus 5, Opus 4.8/4.7/4.6/4.5, Sonnet 5/4.6/4.5 — **not Haiku 4.5**. This is now the strongest documented MCP-footprint mitigation after `defer_loading`.
- **Mid-conversation tool changes** (beta, `mid-conversation-tool-changes-2026-07-01`, from 2026-07-24): change the `tools` array mid-conversation **without invalidating the prompt cache**. Fable 5, Mythos 5, Opus 4.8, Opus 5 only.
- **Per-model minimum cacheable prompt length**: 512 tokens (Opus 5, Fable 5, Mythos 5) / 1,024 (Opus 4.8, Sonnet 5, Sonnet 4.6) / **4,096 (Haiku 4.5)** — a small MCP tool array may be *uncacheable* on Haiku.
- **Images/PDF pages per request**: up to **600** on 1M-window models, **100** on 200k-window models.
- **Tool-use system prompt overhead re-read for every model** (see table below).
- **Agent Skills field limits**: `name` ≤ 64 chars (lowercase/digits/hyphens, no XML, may not contain "anthropic"/"claude"), `description` ≤ **1024 chars**.
- **Deployment caveat on the 1M window**: Claude Code documents that Opus-family and Sonnet 5 sessions can be budgeted at **200K** on Amazon Bedrock, Google Cloud's Agent Platform and Microsoft Foundry, and that `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` holds native-1M models to 200K.

---

## MCP limits at a glance — Anthropic, 2026-08-19

| model | native_mcp | function_calling | max_tools_hard (+scope) | max_tools_practical | context window | tool-def token treatment |
|---|---|---|---|---|---|---|
| Claude Fable 5 | yes (connector beta `mcp-client-2025-11-20`) | yes | **null** — no per-request numeric cap published; binding ceilings are the **10,000-tool aggregate** catalog (all servers + built-ins, with `defer_loading`), the 30–50 selection cliff, the 1M window and 32 MB payload | ~40 (30–50 band, aggregate, empirical) | 1,000,000 | Billed as input. Injected tool-use system prompt **undocumented for this model** (absent from the per-model table) |
| Claude Mythos 5 (limited) | yes | yes | **null** — same aggregate 10,000 ceiling / 30–50 cliff / 1M window / 32 MB | ~40 (aggregate, empirical) | 1,000,000 | Billed as input. Injected overhead **undocumented for this model** |
| Claude Opus 5 | yes | yes | **null** — same; aggregate 10,000 with `defer_loading` | ~40 (aggregate, empirical) | 1,000,000 | Billed as input + **286 tok** (`auto`/`none`) or **406 tok** (`any`/`tool`) injected system prompt — lowest in the roster |
| Claude Sonnet 5 | yes | yes | **null** — same; aggregate 10,000, *medium confidence* (tool-search table omits Sonnet 5) | ~40 (aggregate, empirical) | 1,000,000 | Billed as input + **354 / 474 tok** injected system prompt |
| Claude Opus 4.8 | yes | yes | **null** — same; aggregate 10,000 | ~40 (aggregate, empirical) | 1,000,000 | Billed as input + **290 / 410 tok** injected system prompt |
| Claude Sonnet 4.6 | yes | yes | **null** — same; aggregate 10,000 | ~40 (aggregate, empirical) | 1,000,000 | Billed as input + **497 / 589 tok** injected system prompt |
| Claude Haiku 4.5 | yes | yes | **null** — same; aggregate 10,000 | **~30** (aggregate, empirical — lower because the 200k window is crossed sooner) | **200,000** | Billed as input + **496 / 588 tok** injected system prompt; **no programmatic tool calling** on this model |

Scope reminder, per `docs/02-mcp-limits-taxonomy.md`: **every number above is aggregate** (all connected MCP
servers + built-in tools in one request). Anthropic publishes **no per-MCP-server hard tool cap**. Reference
point from Anthropic's own doc: a 5-server setup (GitHub, Slack, Sentry, Grafana, Splunk) costs **~55k tokens**
in definitions before any work — 5.5% of a 1M window, **27.5% of Haiku 4.5's 200k window**. Tool search with
`defer_loading` cuts that by over 85%.

Client-layer cap worth carrying into the recommender: Claude Code warns above **10,000 tokens** of MCP tool
output and truncates at **25,000 tokens** by default (`MAX_MCP_OUTPUT_TOKENS`; per-tool override via the
`anthropic/maxResultSizeChars` annotation).

---

## Unresolved / undocumented

Fields left `null` (or at reduced confidence) for lack of a public source, and what was searched:

1. **`max_tools_hard` — all 7 models.** No API-enforced per-request tool-count cap is published. Searched:
   tool-use overview, define-tools, tool-reference, tool-search-tool, MCP connector, API overview. The
   tool-search page publishes only "Maximum deferred tools: 10,000 tools with `defer_loading: true` per
   request" and states no maximum for non-deferred tools. Recorded as `null` with the binding limits named
   (aggregate 10,000 catalog, 30–50 cliff, context window, 32 MB payload) — **not** as "no limit".
2. **`max_tool_description_len` — all 7.** No cap documented anywhere; the only guidance points the other way
   ("aim for at least 3–4 sentences"). Searched define-tools, tool-reference, structured-outputs.
3. **`max_tool_result_size` — all 7.** No model-API cap. The binding published cap is client-layer (Claude
   Code 25,000 tokens). Searched handle-tool-calls (silent on size), tool-reference, MCP connector, API overview.
4. **`max_parallel_tool_calls_count` — all 7.** Parallel tool use is supported with no numeric ceiling
   published. Searched parallel-tool-use, tool-reference.
5. **`tool_use_per_turn_limit` — all 7.** No per-turn tool-cycle cap in the API docs. Task budgets (beta) is
   explicitly *advisory* ("a soft hint, not a hard cap"); `max_tokens` is the only hard stop. Searched
   task-budgets, tool-use overview, handle-tool-calls.
6. **`max_connected_servers` — all 7.** No cap on the `mcp_servers` array. Claude Code says it "doesn't impose
   a fixed per-server tool cap; the practical limit is your context window budget". Searched MCP connector,
   Claude Code MCP doc.
7. **JSON Schema depth / property-count / enum-size / total-size limits — all 7.** The structured-outputs
   "JSON Schema limitations" section publishes exactly one restriction — `pattern` (regex) is not supported —
   and no numeric ceilings. Searched structured-outputs, strict-tool-use, define-tools, tool-reference.
8. **Tool-use system prompt overhead for Fable 5 and Mythos 5.** Both are absent from the per-model overhead
   table on the tool-use overview page (which does list Opus 5, Opus 4.8/4.7/4.6/4.5, Sonnet 5/4.6/4.5,
   Haiku 4.5 and retired models). Recorded as undocumented in `system_prompt_overhead_notes`.
9. **`knowledge_cutoff` for Mythos 5.** Not published — Mythos 5 is absent from the public models comparison
   table. Anthropic says it "shares Claude Fable 5's capabilities", which implies Jan 2026, but that is an
   inference; recorded `null`, confidence `low`.
10. **`knowledge_cutoff` for Opus 4.8 and Sonnet 4.6 — value carried forward, confidence lowered to `medium`.**
    Both models moved into the docs' "Legacy models" section; that table did not render in any of four
    extractions of the models-overview page on 2026-08-19. The deprecation table independently confirms both
    are still Active, but the cutoff dates themselves were **not re-read** at this refresh.
11. **`max_output_tokens_max` / knowledge cutoff / legacy specs generally for Opus 4.7, 4.6, 4.5 and Sonnet 4.5.**
    Not added as entries (out of the "current generation" roster) — flagged only so the gap is visible.
12. **`chars_per_token_estimate` — conflicting tier-1 sources.** The pricing page says "1 token is
    approximately 4 characters"; the glossary says "a token approximately represents 3.5 English characters".
    Both are tier 1. Resolved to the model-specific glossary figure (3.5 for the previous tokenizer) and a
    derived 2.7 for the 4.7+ tokenizer (3.5 ÷ 1.30); the 2.7–3.1 band and the conflict are recorded in `notes`.
    Confidence `low` throughout — `count_tokens` is the only accurate route.
13. **`tool_search_deferral` for Sonnet 5 — sources conflict.** Sonnet 5 is **absent** from the tool-search
    model-compatibility table, yet (a) the same page says only "Claude Opus 4.1 and earlier models don't
    support the tool search tool", (b) the Sonnet 5 release note says it has the "same tools as Claude
    Sonnet 4.6 except Priority Tier", and (c) Claude Code says tool search needs "Sonnet 4.5, Haiku 4.5,
    Opus 4.5, **and later models**". Recorded `true` at **medium** confidence with the conflict written into
    `notes`; `max_total_tools` for Sonnet 5 likewise dropped to medium confidence since 10,000 is conditional
    on tool search.
14. **Image resolution tier for Sonnet 5 / Fable 5 / Mythos 5 / Sonnet 4.6 / Opus 4.8.** The vision page gives
    a rule ("High-resolution | Claude 4.7 and later models") and names only Opus 5 and Haiku 4.5 explicitly.
    Tier assignment for the other models is read off the version rule, so those `image_token_rule` entries
    carry **medium** confidence where high-res is inferred.
15. **Memory-tool token accounting.** The memory tool is GA on all Claude 4+ models, but no rule is published
    for how much retrieved memory content costs in input tokens. Recorded qualitatively.
16. **One fetch anomaly, disclosed:** `https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8`
    (cited in the 2026-06-21 sources list) returned 200 but served "what's new in Claude Opus 5" content.
    It was therefore **dropped from the sources lists** and is not cited for any value. A statement it did
    carry — that Opus 4.8 "runs without thinking unless you set `thinking: {"type": "adaptive"}`" — is instead
    cited to https://www.anthropic.com/news/claude-opus-5, which states the same thing.
    Two URLs returned 404 and were abandoned: `.../about-claude/models/legacy-models` and
    `.../about-claude/models/migrating-to-claude-opus-5`.

---

## Sources (every URL opened in this task)

Tier 1 — Anthropic first-party documentation:
1. https://platform.claude.com/docs/en/about-claude/models/overview
2. https://platform.claude.com/docs/en/about-claude/pricing
3. https://platform.claude.com/docs/en/about-claude/model-deprecations
4. https://platform.claude.com/docs/en/about-claude/glossary
5. https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5
6. https://platform.claude.com/docs/en/build-with-claude/context-windows
7. https://platform.claude.com/docs/en/build-with-claude/context-windows#context-window-sizes-by-model
8. https://platform.claude.com/docs/en/build-with-claude/token-counting
9. https://platform.claude.com/docs/en/build-with-claude/vision
10. https://platform.claude.com/docs/en/build-with-claude/prompt-caching
11. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
12. https://platform.claude.com/docs/en/build-with-claude/task-budgets
13. https://platform.claude.com/docs/en/api/overview (cited with the `#request-size-limits` anchor)
14. https://platform.claude.com/docs/en/release-notes/overview
15. https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
16. https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
17. https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference
18. https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
19. https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use
20. https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
21. https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling
22. https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
23. https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
24. https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
25. https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
26. https://code.claude.com/docs/en/mcp
27. https://code.claude.com/docs/en/model-config
28. https://www.anthropic.com/news/claude-opus-5
29. https://www.anthropic.com/news/claude-sonnet-5
30. https://www.anthropic.com/news/redeploying-fable-5
31. https://www.anthropic.com/news/claude-opus-4-8
32. https://www.anthropic.com/news/claude-sonnet-4-6
33. https://www.anthropic.com/news/claude-haiku-4-5

Opened but **not cited** for any value (lead-generation only, or content did not match the URL):
34. https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8 — served Opus 5 content; dropped from all sources lists.
35. WebSearch result pages used only to locate the tier-1 URLs above (Axios/Fortune/9to5Mac coverage of the Opus 5 launch, artificialintelligence-news on Sonnet 5, and MCP-limits community threads). **No value in the dataset is sourced to any of them.**

Returned 404, abandoned: `.../about-claude/models/legacy-models`, `.../about-claude/models/migrating-to-claude-opus-5`.

---

## Validation

```
python3 -c "import json;json.load(open('/tmp/tcc/data/saas/anthropic.json'))"   # parses
jsonschema Draft202012Validator vs schema/model-entry.schema.json               # SCHEMA VALID
```
7 model entries · 301 provenanced fields · 33 distinct cited URLs, all opened in this task.

---

## Remediation 2026-08-19

Scope: the audit finding against `data/saas/anthropic.json`, plus same-class defects found while
fixing it. Every URL below was re-opened in this pass.

| Finding | What I did | New value | New source | Tier / confidence |
|---|---|---|---|---|
| **MINOR** — `claude-fable-5` `release_date.notes` asserted a 2026-06-12 withdrawal under US export controls and a 2026-07-01 restoration, but the cited platform.claude.com page says only that access "has been restored" | Kept `source_url` on the model-introduction page (it carries the recorded *value*, "Claude Fable 5 and Claude Mythos 5 both become available on June 9, 2026") and re-attributed the withdrawal/restoration claim in notes to the page that actually carries it — Anthropic's own news post, quoted verbatim: "On Friday, June 12, the US government applied export controls to our newest models, Claude Fable 5 and Claude Mythos 5"; access was "suspended … for all users"; "As of today, June 30, the export controls on Fable 5 and Mythos 5 have been lifted"; "Fable 5 will be available starting tomorrow, Wednesday, July 1, to users globally on the Claude Platform" | `2026-06-09` (unchanged) | notes now cite https://www.anthropic.com/news/redeploying-fable-5 (value still https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5) | 1 / high |
| **MINOR (sibling)** — `claude-mythos-5` `release_date.notes`, same problem, plus "restored … for approved US organizations" | Same re-attribution, now with the exact wording from the news post: "We have also restored access to Mythos 5 for a set of US organizations, following the US government's approval on June 26", plus the original-release scope ("only released to a small number of trusted Project Glasswing partners for use in defensive cybersecurity") | `2026-06-09` (unchanged) | notes now cite https://www.anthropic.com/news/redeploying-fable-5 | 1 / high |
| **Same class (self-found)** — `claude-fable-5` model-level `notes` repeated the withdrawal/restoration dates with no source | Appended the news-post URL inline | prose only | https://www.anthropic.com/news/redeploying-fable-5 | — |
| **Same class (self-found)** — banned absence phrasing: `provider.skills_concept.notes` and all 7 models' `skills_context.skills_context_cost_notes` said Anthropic "publishes no cap" on installed Skills | Rewritten per methodology §5 to "documents no numeric ceiling on the number of installed Skills; the binding limit is the context window — each installed Skill holds its name and description in context, and its full instructions load on invocation" | prose only | — | — |

Deterministic checks after the edits: all three files parse; all validate against
`schema/model-entry.schema.json`; no provenanced object is missing `as_of`; no banned
absence phrasing ("no limit / unlimited / no cap / doesn't apply") remains in any of the three files.

## Final fixes 2026-08-19

**MAJOR 2 — `claude-sonnet-5` `tools_mcp.max_total_tools = 10,000` was asserted from a page whose
model-compatibility table omits Sonnet 5.**

The value cited
<https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool>, which does state
under *Limits and best practices*:

> **Maximum deferred tools:** 10,000 tools with `defer_loading: true` per request

That ceiling is **conditional on tool search / `defer_loading`**, so it can only be claimed for a
model documented to support that feature. Re-reading the same page's model-compatibility table on
2026-08-19, the models listed are:

Claude Fable 5, Claude Mythos 5, Claude Opus 5, Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6,
Claude Sonnet 4.6, Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5.

**Claude Sonnet 5 is not among them.** This is the conflict the file already recorded under
`tool_search_deferral`; the numeric ceiling had not been brought into line with it (it sat at
`10000` / medium while the six sibling models sat at `10000` / high).

### Search for a page that does cover Sonnet 5

| Page | Covers Sonnet 5? | Carries the 10,000 figure? |
| --- | --- | --- |
| [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) | **no** (absent from compatibility table) | yes |
| [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) | yes — `claude-sonnet-5`, 1M context, 128k max output, adaptive thinking, Jan 2026 cutoff | **no** — no tool-search or tool-count row at all |
| [Migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide) | yes — "Claude Sonnet 5 supports the same set of features as Claude Sonnet 4.6, including the 1M token context window, adaptive thinking, prompt caching, batch processing, the Files API, PDF support, vision, and the full set of server-side and client-side tools"; also "Priority Tier is not available on Claude Sonnet 5" | **no** — never names the tool search tool, `defer_loading`, or any tool-count ceiling |

No page carries both. The migration guide is supportive of tool-search support *in general* but
cannot carry a specific numeric ceiling it does not mention.

### Resolution

| Field | Before | After | Why |
| --- | --- | --- | --- |
| `claude-sonnet-5` → `tools_mcp.max_total_tools` | `10000`, medium | **`null`, low** | Rule: a value may only be asserted for a model the cited page actually covers. Notes quote the 10,000 statement verbatim, list the ten models the compatibility table *does* name, quote the migration-guide wording, retain the countervailing "Claude Opus 4.1 and earlier models don't support the tool search tool" sentence, and name the binding limits: the documented 30–50-tool selection cliff, the 1M-token context window, the 32 MB request payload limit. Notes state the revert condition explicitly — if Anthropic adds Sonnet 5 to the table this returns to 10,000, scoped aggregate-per-request, never per server. |
| `claude-sonnet-5` → `tools_mcp.max_tools_hard` | notes cited "the documented AGGREGATE catalog ceiling of 10,000 tools with defer_loading (see max_total_tools)" as a binding limit | notes rewritten | That cross-reference now pointed at a null. Rewritten to bind on the 30–50 cliff, the context window and the 32 MB payload limit, with an explicit note that the 10,000 ceiling is deliberately not recorded for Sonnet 5. Value unchanged (`null`, medium). |

The six other Anthropic models keep `10000` / high — the compatibility table names each of them, so
their assertions are sound. `tool_search_deferral` for Sonnet 5 was left at `true` / medium: it rests
on independent tier-1 wording (the migration guide's "full set of server-side and client-side tools"
plus the page's own "Opus 4.1 and earlier" exclusion sentence), and its notes already record the
table omission in full. The distinction recorded is deliberate — the boolean has other tier-1
support; the specific 10,000 number does not.

No entry deleted, no id renamed; `as_of: "2026-08-19"` on both objects touched.

### Verification
- `python3 -c "import json;json.load(open('data/saas/anthropic.json'))"` → parses.
- Validates clean against `schema/model-entry.schema.json` (0 errors).
- Model-id list unchanged by this pass.

**Not verified:** whether Sonnet 5's omission from the compatibility table is a docs lag or a real
capability gap. Settling that needs a live API call with `defer_loading: true` against
`claude-sonnet-5`, which this pass did not have a key for. The dataset now records the omission as
an unknown rather than resolving it in Anthropic's favour.
