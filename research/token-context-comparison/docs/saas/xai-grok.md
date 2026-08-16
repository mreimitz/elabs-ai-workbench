# xAI (Grok) — Provider Summary

**As-of:** 2026-06-21 | **Source tier:** 1 (docs.x.ai) | **Group:** SaaS

## Provider Posture

| Axis | Summary |
|---|---|
| MCP | **Native support confirmed.** Remote MCP Tools available via Responses API and xAI SDK (GA Nov 2025). xAI manages the server-side MCP connection. Billed token-based only — no per-invocation MCP fee. |
| Skills | **None at API level.** xAI does not expose packaged skill bundles or progressive-disclosure context injection via the developer API. The Grok Build product has a Skills/Plugins/Marketplaces section but that is a Grok Build CLI concept, not an API primitive. |
| Tokenizer | **Closed, proprietary.** A Tokenizer Playground exists in the console but no public library, HF repo, or count_tokens API is documented. Local estimation must use `raw_json_rough` fallback. |
| Function calling | Full OpenAI-compatible function calling. Up to **200 tools per request** (hard limit). Parallel tool calls on by default. Tool definitions billed as input tokens. |
| Prompt caching | Automatic (no explicit markup needed). Cached input price: **$0.20/1M** vs $1.25/1M standard (grok-4.3) — ~84% savings. Use `x-grok-conv-id` header for best cache-hit rates. |

---

## Models

Three current API models (as of 2026-06-21):

| Model | API ID | Status | Context | Input $/1M | Output $/1M |
|---|---|---|---|---|---|
| Grok 4.3 | `grok-4.3` | GA | 1,000,000 | $1.25 | $2.50 |
| Grok 4.20 Multi-Agent | `grok-4.20-multi-agent-0309` | Preview (beta) | 1,000,000 | $1.25 | $2.50 |
| Grok Build 0.1 | `grok-build-0.1` | Preview (early access) | 256,000 | $1.00 | $2.00 |

---

## Per-Model Sections

### Grok 4.3 (`grok-4.3`)

Current flagship model. Absorbs many legacy aliases: `grok-4`, `grok-4-latest`, `grok-4-fast`, `grok-3`, `grok-3-latest`, and more. Released ~May 2026.

#### Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Context window | 1,000,000 tokens | high | Confirmed on model card |
| Input/output shared | true (assumed) | medium | OpenAI-compatible convention; not explicitly stated |
| Max input | not documented | low | — |
| Max output (default) | not documented | low | — |
| Max output (max) | not documented | low | Bounded by 1M shared pool |
| Extended context | none | high | No beta/extended window beyond 1M |
| Reasoning tokens = output | true | high | Billed at output rate per pricing docs |

> **Note on "Grok 4 Fast ~2M context":** Methodology hints referenced a 2M context window for a fast variant. This is NOT confirmed by current docs as of 2026-06-21. The `grok-4-fast` alias now resolves to `grok-4.3` with a 1M window.

#### Tokenization

| Field | Value | Confidence |
|---|---|---|
| Tokenizer family | xai-grok (closed, proprietary) | low |
| Tokenizer public | false | medium |
| Tokenizer access | closed (console Tokenizer Playground only) | medium |
| count_tokens method | none (no API endpoint) | low |
| Image token rule | undocumented | low |
| Audio token rule | n/a (no audio support) | high |
| Chars/token estimate | ~4 (rough) | low |

#### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | true | high | OpenAI-compatible |
| Native MCP | true | high | Remote MCP Tools via Responses API / xAI SDK (Nov 2025 GA) |
| Parallel tool calls | true | high | Default; disable with `parallel_tool_calls: false` |
| Max tools (hard) | 200 | high | Per function calling schema docs |
| Max tools (practical) | ~40 | low | Community estimate; no Grok-specific empirical data |
| Tool definition shape | `openai_function` | high | Standard `{type, name, description, parameters}` |
| Tool defs count as input | true | high | Injected into context; xAI warns about context overhead |
| Tool search / deferral | false | medium | No progressive-disclosure; `allowed_tools` filters MCP tools statically |
| Max tool name length | undocumented | low | — |

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | false | high |
| Prompt caching | true | high |
| Memory feature | false | medium |

- Cached input: **$0.20/1M** (automatic when consecutive requests share starting messages)
- Use `x-grok-conv-id` header or `prompt_cache_key` to maximize cache hits
- Context Compaction API available (May 2026) to shrink long conversations — not persistent memory

#### Cost

| Field | Value | Confidence |
|---|---|---|
| Input (standard) | $1.25 / 1M | high |
| Input (cached) | $0.20 / 1M | high |
| Output | $2.50 / 1M | high |
| Reasoning tokens | $2.50 / 1M (output rate) | high |
| Batch discount | 20%–50% off all token types | high |
| Priority surcharge | 2× standard rates | high |
| Billing unit | tokens | high |
| Higher-context pricing | above 200K tokens (exact rate not published) | medium |

---

### Grok 4.20 Multi-Agent (`grok-4.20-multi-agent-0309`)

Beta multi-agent research model. Orchestrates 4 or 16 parallel agents. Released 2026-03-10.

#### Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Context window | 1,000,000 tokens | high | Per pricing table |
| Max input | not documented | low | — |
| Max output | **not supported** | high | `max_tokens` parameter explicitly unsupported |
| Extended context | none | high | — |
| Reasoning tokens = output | true | high | All sub-agent reasoning billed at output rate |

#### Tokenization

Same closed tokenizer as grok-4.3. No public access.

#### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling (client-side) | **false** | high | Custom function tools NOT supported |
| Native MCP | true | high | Remote MCP Tools supported |
| Built-in tools | true | high | `web_search`, `x_search`, `code_execution` |
| Parallel tool calls | true | high | Sub-agents run in parallel |
| Max tools (hard) | not documented | low | No custom function tools accepted |
| Tool definition shape | openai_function (server-side only) | high | — |
| Chat Completions API | **not supported** | high | Responses API only |

> **Critical for footprint tool:** Client-side function calling is NOT available. Only Remote MCP tools and built-in server-side tools work. The `reasoning.effort` parameter controls agent count, not reasoning depth (contrast with grok-4.3).

#### Skills / Context

| Field | Value | Confidence |
|---|---|---|
| Skills supported | false | high |
| Prompt caching | null (unconfirmed) | low |

Prompt caching applicability for multi-agent beta not explicitly documented, though the pricing table shows $0.20/1M cached rate.

#### Cost

| Field | Value | Notes |
|---|---|---|
| Input | $1.25 / 1M | All sub-agent input tokens |
| Output | $2.50 / 1M | All sub-agent output + reasoning tokens |
| Cached input | $0.20 / 1M | — |
| Built-in tool calls | $5 / 1k calls (web/x/code), $2.50/1k (collections) | Per-invocation on top of token cost |
| Agent count | 4 (low/medium effort) or 16 (high/xhigh effort) | 16-agent requests use significantly more tokens |

---

### Grok Build 0.1 (`grok-build-0.1`)

Early-access fast coding model for agentic coding. Released 2026-05-19.

#### Context

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Context window | 256,000 tokens | high | Model card confirmed |
| Max input | not documented | low | — |
| Max output | not documented | low | — |
| Extended context | none | high | — |
| Reasoning tokens = output | true | medium | Reasoning capability listed; platform-wide billing applies |

#### Tokenization

Same closed tokenizer as grok-4.3. No public access.

> **Footprint impact:** At 256K context, tool definitions consume a proportionally much larger share of the window than on grok-4.3 (1M). A 55K-token MCP server footprint = ~21% of this model's window vs only ~5.5% of grok-4.3's window.

#### Tools / MCP

| Field | Value | Confidence | Notes |
|---|---|---|---|
| Function calling | true | high | Full OpenAI-compatible |
| Native MCP | true | medium | Supported via Responses API (no explicit exclusion) |
| Parallel tool calls | true | medium | Platform default |
| Max tools (hard) | 200 | medium | Same platform limit |
| Max tools (practical) | ~40 | low | 256K window makes this more binding |
| Tool definition shape | `openai_function` | high | — |
| Tool defs count as input | true | high | — |

#### Skills / Context

| Field | Value |
|---|---|
| Skills supported | false |
| Prompt caching | true |
| Memory feature | false |

#### Cost

| Field | Value | Confidence |
|---|---|---|
| Input (standard) | $1.00 / 1M | high |
| Input (cached) | $0.20 / 1M | high |
| Output | $2.00 / 1M | high |
| Batch discount | 20%–50% | medium |
| Higher-context pricing | above 200K tokens | medium |

---

## Takeaways for the Recommender

### When to recommend xAI Grok

1. **Large-context tasks (grok-4.3):** 1M token window at $1.25/1M input is competitive. Suitable for loading large MCP server footprints without burning the majority of the context budget.

2. **Deep multi-agent research (grok-4.20-multi-agent):** Unique parallel-agent architecture for research workflows. However, NOT usable for arbitrary function-calling MCP servers — only Remote MCP and built-in server-side tools supported.

3. **Agentic coding (grok-build-0.1):** Purpose-built for coding workflows at lower price ($1/$2 per 1M). Smaller 256K context requires careful tool loading discipline.

### Footprint headroom

| Model | Window | 55K-token MCP server | Headroom |
|---|---|---|---|
| grok-4.3 | 1,000,000 | 5.5% | High — can host very large tool suites |
| grok-4.20-multi-agent | 1,000,000 | 5.5% | High — but custom function tools not supported |
| grok-build-0.1 | 256,000 | 21.5% | Moderate — tool budget discipline needed |

### Cost profile

- Reasoning tokens billed as output on all models — significant cost multiplier for high-effort reasoning.
- Prompt caching (automatic, $0.20/1M) makes repeated tool-heavy sessions much cheaper — static tool definitions cache well.
- Batch API (20–50% off) viable for offline scan/analysis workloads.
- No tool-search deferral — full tool suite loaded per request. `allowed_tools` on Remote MCP offers static filtering.

### Key constraints for the footprint tool

- **Tokenizer is closed** — no local count-tokens method. Use `raw_json_rough` fallback (4 chars/token estimate). Counts will be approximate.
- **Max output undocumented** — cannot derive max_input from window − max_output formula.
- **No empirical max_tools_practical** — 200 hard limit documented, ~40 practical estimate (Tier 4, not Grok-specific).
- **Multi-agent model does not support client-side tools** — cannot be used with typical MCP function-calling patterns via footprint tool recommendations.
- **Higher-context pricing above 200K** — exact rates not published; sessions exceeding 200K tokens cost more than base rate.

---

## MCP / tool limits

> Researched 2026-06-21. Confidence: high = documented explicitly; low = not published (null). Source tier 1 = official xAI docs. All three models share the same function-calling infrastructure except where noted.

### Cross-model limit summary

| Limit | grok-4.3 | grok-4.20-multi-agent | grok-build-0.1 | Source | Notes |
|---|---|---|---|---|---|
| `max_tools_hard` | **200** | null (n/a) | **200** | [Function Calling docs](https://docs.x.ai/developers/tools/function-calling) — "Unique identifier (max 200 tools per request)" | Multi-agent does not accept custom function tools; the 200-cap applies only to function-calling-capable models. |
| `max_tool_name_len` | null | null | null | Not documented | No character limit published. Unlike OpenAI's 64-char cap, xAI publishes no equivalent. Remote MCP tool names are namespaced as `{server_label}.{tool_name}` in responses. |
| `max_tool_description_len` | null | null | null | Not documented | Description is a required field with no length constraint stated. Effectively bounded by context window. |
| `max_request_size` | null | null | null | Not documented | No byte/MB payload cap published anywhere in xAI docs. Bounded by context window in practice. |
| `max_tool_result_size` | null | null | null | Not documented | No cap stated. Server-side tool outputs (MCP, web_search) consumed internally; client-side function results are unbounded strings limited by context window. |
| `max_parallel_tool_calls_count` | null | null | null | Not documented | Model "can request multiple tool calls in a single response" — no numeric ceiling stated. Disable all parallelism with `parallel_tool_calls: false`. |
| `tool_use_per_turn_limit` | null (configurable via `max_turns`) | null | null (configurable via `max_turns`) | [Tool Usage Details](https://docs.x.ai/developers/tools/tool-usage-details) | `max_turns` parameter controls server-side agentic loop turns per request. Global server default cap exists but exact number is undisclosed. |
| `max_connected_servers` | null | null | null | Not documented | No cap on simultaneous Remote MCP server connections. Example shows 3 servers concurrently with no limit stated. Only indirect ceiling: all server tool defs count toward the 200-tool hard cap and the context window. |
| `max_total_tools` | null | null | null | Not documented | No separate aggregate limit. The 200-tool per-request cap is the de-facto ceiling when mixing function tools and MCP server tools. |

### Per-model notes

**grok-4.3 and grok-build-0.1** share the same tool-limit surface:
- **200 tools/request** hard cap (Tier-1 confirmed from function-calling schema table, last updated June 17, 2026).
- Parameters root must be `{"type": "object"}` — non-object root triggers a `400` error identifying the offending tool.
- Remote MCP tool names appear as `{server_label}.{tool_name}` in output (e.g., `deepwiki.search_repository`). No documented cap on combined name length.
- `max_turns` parameter controls the agentic server-side loop; default global cap undisclosed; client-side tool calls are "checkpoints" that reset the turn counter.
- Remote MCP: Streaming HTTP and SSE transports only. OpenAI Responses API `require_approval` and `connector_id` not supported on xAI.

**grok-4.20-multi-agent:**
- Custom function tools (client-side) **not supported** — the 200-tool cap from function calling does not apply.
- Only Remote MCP tools and built-in server-side tools (`web_search`, `x_search`, `code_execution`) are accepted.
- Multiple sub-agents (4 or 16) execute tool calls in parallel with no documented concurrency cap.
- `max_tokens` parameter explicitly unsupported on this model.

### Schema constraints (all models)

| Constraint | Status | Detail |
|---|---|---|
| Parameters root type | **Enforced** | Must be `"type": "object"`; any other root type → `400` error |
| Nesting depth limit | Not documented | No published max depth |
| Property count limit | Not documented | No published max |
| Enum size limit | Not documented | No published max |
| `anyOf` / `oneOf` / `$ref` | Not documented | Not listed as unsupported; standard JSON Schema subset assumed |
| Tool name pattern | Not documented | No regex constraint published (contrast with OpenAI `^[a-zA-Z0-9_-]+$`) |

---

## Sources

- [Models | xAI Docs](https://docs.x.ai/developers/models)
- [Grok 4.3 model page](https://docs.x.ai/developers/models/grok-4.3)
- [Grok Build 0.1 model page](https://docs.x.ai/developers/models/grok-build-0.1)
- [Pricing | xAI Docs](https://docs.x.ai/developers/pricing)
- [Function Calling | xAI Docs](https://docs.x.ai/developers/tools/function-calling)
- [Remote MCP Tools | xAI Docs](https://docs.x.ai/developers/tools/remote-mcp)
- [Tool Usage Details | xAI Docs](https://docs.x.ai/developers/tools/tool-usage-details)
- [Advanced Usage | xAI Docs](https://docs.x.ai/developers/tools/advanced-usage)
- [Reasoning | xAI Docs](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [Multi Agent | xAI Docs](https://docs.x.ai/developers/model-capabilities/text/multi-agent)
- [Prompt Caching | xAI Docs](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)
- [Prompt Caching Usage & Pricing](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing)
- [Rate Limits | xAI Docs](https://docs.x.ai/developers/rate-limits)
- [Release Notes | xAI Docs](https://docs.x.ai/developers/release-notes)
