---
type: "Research Note"
title: "02 \u2014 MCP / Tool Limits Taxonomy"
description: "The number of tools is only one of several limits that govern whether an MCP server fits a model."
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 02 — MCP / Tool Limits Taxonomy

> The number of tools is only one of several limits that govern whether an MCP server fits a model.
> This catalogs every limit *type* we track, where each is enforced, and why it matters for the
> footprint/recommendation engine. Per-model values live in `data/**` under `tools_mcp`; the
> cross-provider table at the bottom is regenerated from that data.
> **As-of:** 2026-06-21.

## Why more than one number

"Will this MCP server work on model X?" is not answered by tool count alone. A server can fail or
degrade because a tool *name* is too long, the *request* is too big, a tool *result* blows the
window, or the *client* refuses to load more than N servers — none of which the tool count reveals.
Limits are enforced at **four different layers**, and the binding one is whichever is smallest:

| Layer | Who enforces | Examples |
|---|---|---|
| **Model API** | the provider's inference API | max tools/request, tool-name length, request payload size, parallel tool calls |
| **Client / host** | the app embedding the model | max connected MCP servers, max total tools shown, tool-use-per-turn cap (Claude Desktop/Code, ChatGPT, IDEs) |
| **MCP protocol** | the MCP spec / transport | message size, transport framing, pagination of `tools/list` |
| **Serving stack** (open-weight) | vLLM / SGLang / Ollama + the model's chat template | context length config, tool-call parser support — *no vendor tool-count cap; bounded by context* |

The recommender must reason over all four. For open-weight models the **model API layer has no
vendor limits at all** — the ceiling is `context_window ÷ avg tool-definition tokens`, set by the
operator's serving config.

## Scope: per-tool vs per-server vs aggregate (read this before trusting a count)

Orthogonal to the enforcement *layer* is the **scope** a limit applies to. Getting this wrong is the
easiest way to mis-state a limit:

| Scope | Spans | Where caps live |
|---|---|---|
| **per-tool** | one tool definition | name length, schema property/depth caps |
| **per-server** | one MCP server's tool set in isolation | nothing vendor-enforced — see below |
| **aggregate** | **ALL connected servers + built-in/model tools, combined in one request/session** | **almost every documented cap: OpenAI 128, Gemini 512, Claude 10k catalog, Cursor ~40, Claude Desktop ~100** |

**There is no documented per-MCP-server hard tool cap.** A single server can expose unbounded tools
(`tools/list` is cursor-paginated). The caps you've heard of are **aggregate** — they apply to the
*sum* across every connected server plus built-in tools, because they all land in one `tools` array /
context window. So:

- Claude's **10,000** is the *aggregate catalog* max (with tool search), **not** per server.
- A single server with 30 tools is fine against OpenAI's 128 — but **six** such servers (180 tools)
  bust it. The binding question is always the **sum**.
- The per-server "limit" is therefore a *budget-allocation* problem (how to split the aggregate
  budget across servers), handled by the recommender — not a hard test.

The test suite encodes this as a `scope` field; the count/footprint/request checks come in a
**per-server** single-server-upper-bound flavor and an **aggregate** (`ENV_AGGREGATE_*`) flavor that
sums across servers — the latter is the one that actually gates the 128/512/10k.

## The limit types we track

Each is a field under `tools_mcp` in the data files (Provenanced: `{value, confidence, source_url,
source_tier, as_of}`; `null` + notes when undocumented).

### Tool-count limits
- **`max_tools_hard`** — API-enforced max NUMBER of tools/functions accepted per request. The hard
  "max allowed." (e.g. OpenAI 128, Mistral 128, Grok 200.) `null` = no published cap.
- **`max_tools_practical`** — empirical point where tool-selection accuracy degrades (Tier-4;
  ~30–50 for frontier, lower for small models). The *useful* ceiling.
- **`max_total_tools`** *(client layer)* — aggregate cap across all connected servers in a host
  app (e.g. Claude Desktop showing ~100 tools).

### Per-tool shape limits
- **`max_tool_name_len`** — max characters in a tool/function name (e.g. OpenAI 64, pattern
  `^[a-zA-Z0-9_-]+$`). MCP tool names get namespaced by the client, which eats into this.
- **`max_tool_description_len`** — documented cap on a tool description length, if any.
- **`tool_schema_limits_notes`** — constraints on the input JSON Schema: max properties, nesting
  depth, enum size, unsupported keywords (`oneOf`/`anyOf`/`$ref`), etc.

### Payload / size limits
- **`max_request_size`** — max total request payload the API accepts (bytes/MB). Tool definitions
  count toward this *and* toward the token window — two separate ceilings. (e.g. Anthropic 32 MB.)
- **`max_tool_result_size`** — cap on a single tool RESULT/output returned to the model (tokens or
  bytes). A chatty tool can blow the window or get truncated regardless of tool count.

### Turn / concurrency limits
- **`max_parallel_tool_calls_count`** — max tool calls the model may emit simultaneously in one turn.
- **`tool_use_per_turn_limit`** — max tool-call↔result cycles before the model is forced to answer
  ("Claude reached its tool-use limit for this turn"). Caps multi-step agentic runs.

### Client / connection limits
- **`max_connected_servers`** *(client layer)* — cap on how many MCP servers a host app connects at
  once (Claude Desktop, ChatGPT, Cursor/VS Code, etc.).
- **`other_limits_notes`** — anything else: tool-call rate limits, connector/transport restrictions,
  OAuth scopes, pagination of `tools/list`.

## How the recommender uses these

- The **binding limit** = `min(max_tools_hard or ∞, max_tools_practical, floor(window ÷ avg_tool_tokens))`,
  then sanity-checked against `max_request_size` and `max_total_tools`.
- **Name-length** flags servers whose namespaced tool names would be rejected (common with long
  MCP prefixes on OpenAI's 64-char cap).
- **Tool-result size** + **per-turn limit** feed the *runtime* session model (cost/latency per task),
  not just the static footprint.
- For open-weight, surface the **derived** ceiling explicitly since no vendor number exists.

## Cross-provider values

> Filled from `data/**` after the limit-research pass; see the generated table in
> [`comparison/comparison-matrix.md`](../outputs/comparison/comparison-matrix.md) §"MCP / tool limits"
> and the merged [`comparison/all-models.json`](../outputs/comparison/all-models.json).
> Protocol- and client-layer findings (MCP spec, Claude Desktop/Code, ChatGPT, IDE hosts) are
> summarized in the "Protocol & client limits" section below.

### Model-API hard caps found (the "max tools allowed")

| Provider | Hard cap (tools/request) | Source tier | Binds before the window? |
|---|---|---|---|
| Google Gemini | **512** functionDeclarations | 1 | **Yes** — 512 binds long before the 1M-token window on tool-heavy servers |
| xAI Grok | **200** | 1 | rarely (1M window) |
| OpenAI | **128** | 1 | no (but strict-mode schema caps bind: 100 props, 5 levels) |
| Mistral | **128** | 1 | no (256K window) |
| GitHub Copilot (VS Code) | **128** | 2 | client-layer cap |
| M365 Copilot | **10 actions / declarative agent** | 1 | product-layer cap (also 4,096-token plugin I/O budget) |
| Anthropic | **none published** (~10k via tool-search `defer_loading`) | 1 | window/practical-count bind first |
| All open-weight | **none** (model layer) | — | context window always binds: `≈ window ÷ avg tool tokens` |

Takeaway: a hard tool-count cap exists for only ~half the roster, and it is the *binding* limit in
just two notable cases — **Gemini (512)** and **small-window open-weight like Phi-4 (16K window)**.
For everyone else the practical-count cliff (~30–50) or the context window is what bites first.

### Protocol & client limits (host/transport layer)

**MCP protocol (spec).** No hard message-size limit is enforced at the protocol level. `tools/list`
uses **cursor-based pagination**, so a server can publish unlimited tools across pages — the *client*
decides how many it forwards to the model. A `max_response_bytes` client capability is under active
discussion ([modelcontextprotocol#2211](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2211));
the 2026-07-28 spec adds `ttlMs`/`cacheScope` to list/read results. Net: the protocol never limits
you — the client and model do.

**Client / host caps (what operators actually hit).** These sit *above* the model and are often the
first wall:

| Host | Cap | Notes |
|---|---|---|
| **Cursor** | **~40 tools total** | beyond 40, tools are silently dropped from the model's view; keep < 35 |
| **Claude Desktop** | **~100 tools** shown (aggregate) | plus a per-turn "reached its tool-use limit" cycle cap |
| **Claude Code** | tool-search / `defer_loading` | `ENABLE_TOOL_SEARCH` defers definitions; catalog up to ~10k |
| **VS Code + GitHub Copilot** | **128 tools/request** | Agent mode only; virtual-tool clustering beyond that |
| **ChatGPT (OpenAI)** | **128-tool budget** | tools from all connectors aggregate into one 128 budget |

**Serving stack (open-weight).** vLLM / SGLang impose **no tool-count cap** — the binding limit is
`max_model_len` (default often **16K**, which *silently truncates* tool calls mid-generation) plus
KV-cache / GPU memory. Tool calling also requires a matching `--tool-call-parser` for the model.
For tool-heavy use, raise `--max-model-len` (e.g. 131072).

_Sources: [MCP spec — Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
[vLLM — Tool Calling](https://docs.vllm.ai/en/stable/features/tool_calling/),
[Cursor 40-tool limit](https://github.com/cursor/cursor/issues/3369)._

---

## Additional limit types (the less-obvious ones)

> Researched 2026-06-21. Provenance: Tier 1 = official provider/spec docs; Tier 2 = SDK source
> or count-token tooling; Tier 4 = community reports / GitHub issues.
> "Undocumented" = not found in any Tier 1–3 source after search.

### 1. MCP primitives beyond tools — resources & prompts

**Layer: MCP protocol (spec)**

MCP servers expose three first-class primitives: **tools**, **resources**, and **prompts**.
The spec imposes **no hard count or byte limit** on any of them — both `resources/list` and
`prompts/list` use cursor-based pagination (identical to `tools/list`), so a server can
publish arbitrarily many. The client decides how many to load and forward to the model.

**How they enter the context window:**

- **Resources** are data blobs (text or base64 binary) identified by URI. A resource does
  *not* consume context just by being listed. It only costs tokens when the *host* reads it
  via `resources/read` and injects the returned content into a message. The resource body
  arrives as a user-role message content block. Size is bounded by the resource's `size`
  field (informational only; no spec-enforced cap) and ultimately by the model's context
  window and any host-side truncation policy.
- **Prompts** are parameterized instruction templates. A prompt is retrieved via `prompts/get`
  and its `messages` array is inserted verbatim into the conversation. Token cost = serialized
  length of the returned messages. No per-prompt size cap exists in the spec.
- **Neither type is listed alongside tool definitions in the model's tool-schema injection.**
  They are injected by the *host* as ordinary message content, so they count as plain input
  tokens — not as "tool definition" tokens — and do not incur the structured-schema overhead
  that tool JSON does.

**Elicitation schema (flat-only constraint, new in 2025-06-18):** When a server issues an
`elicitation/create` request, the `requestedSchema` MUST be a flat object of primitive types
only (string, number, integer, boolean, enum). No nested objects, no arrays-of-objects, no
`$ref`. This is a hard spec constraint to keep client form-rendering tractable. Client
implementations SHOULD rate-limit elicitation requests (no numeric cap specified).

**Sampling (client feature): deprecated as of 2026-07-28 draft.** The sampling primitive
(server-initiated LLM completions) is scheduled for removal from the spec; new implementations
should integrate directly with provider APIs instead.

| Limit | Value | Layer | Tier | Source |
|---|---|---|---|---|
| `resources/list` count cap | none (paginated) | protocol | 1 | [MCP spec — Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources) |
| `prompts/list` count cap | none (paginated) | protocol | 1 | [MCP spec — Prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts) |
| Resource content byte cap | undocumented (host-enforced) | client | — | — |
| Prompt message size cap | undocumented (model window) | model-API | — | — |
| Elicitation schema — max nesting | flat objects only (no nested objects) | protocol | 1 | [MCP spec — Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation) |

**Why it matters:** resources injected into the context at runtime can dwarf the tool-definition
footprint. A single large file resource can consume tens of thousands of tokens. The
recommendation engine should model resource reads as a runtime token cost separate from the
static tool-definition footprint.

---

### 2. Tool-call timeouts

**Layer: client / SDK**

The MCP TypeScript SDK defines `DEFAULT_REQUEST_TIMEOUT_MSEC = 60_000` (60 s). This is the
per-request timeout for any JSON-RPC call including `tools/call`. The Python SDK historically
had no default timeout (see [python-sdk#1374](https://github.com/modelcontextprotocol/python-sdk/issues/1374)).

| Host / SDK | Default tool-call timeout | Configurable? | Tier | Source |
|---|---|---|---|---|
| **MCP TypeScript SDK v2** | 60 s (`DEFAULT_REQUEST_TIMEOUT_MSEC=60000`) | Yes (per-request option) | 1 | [TS SDK docs](https://ts.sdk.modelcontextprotocol.io/v2/variables/_modelcontextprotocol_server.index.DEFAULT_REQUEST_TIMEOUT_MSEC.html) |
| **MCP Python SDK** | no default | Yes | 4 | [python-sdk#1374](https://github.com/modelcontextprotocol/python-sdk/issues/1374) |
| **Claude Desktop** | ~60 s (hardcoded, ignores config) | No (as of 2026-06) | 4 | [claude-code#5221](https://github.com/anthropics/claude-code/issues/5221), [#22542](https://github.com/anthropics/claude-code/issues/22542) |
| **Claude Code CLI** | ~28 h default; overridable via `MCP_TOOL_TIMEOUT` env var or per-server `timeout` field in `.mcp.json` | Yes | 4 | [claude-code#47076](https://github.com/anthropics/claude-code/issues/47076) |
| **Cursor** | undocumented; community reports ~60 s | No (feature request open) | 4 | [forum.cursor.com/t/49149](https://forum.cursor.com/t/mcp-tool-calling-timeout/49149) |
| **VS Code + GitHub Copilot** | undocumented | undocumented | — | — |
| **M365 Copilot** | 45 s (plugin I/O budget) | No | 1 | Microsoft Learn — M365 Copilot plugin limits |

**Why it matters:** long-running tool calls (DB queries, web fetches) silently fail on
Claude Desktop after 60 s; Claude Code CLI is permissive by default but can be tightened.
The recommendation engine should flag servers with potentially slow tools when targeting
Claude Desktop.

---

### 3. Prompt-cache limits (directly affects caching tool definitions)

**Layer: model-API**

Caching tool definitions across turns is the primary cost-reduction lever for
tool-heavy sessions. Each provider's cache parameters constrain when it is effective.

#### Anthropic (Claude)

| Parameter | Value | Tier | Source |
|---|---|---|---|
| Max cache breakpoints per request | **4** (400 error if exceeded; 20-block lookback window) | 1 | [Anthropic — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Min cacheable tokens — Opus 4.x, Sonnet 4.x, Haiku 4.5+ | **1,024 tokens** | 1 | ibid |
| Min cacheable tokens — Haiku 3.x (older) | **2,048 tokens** | 1 | ibid |
| TTL options | **5 min** (default, free); **1 h** (opt-in, extra cost) | 1 | ibid |
| TTL ordering rule | Longer TTL entries MUST precede 5-min entries | 1 | ibid |
| Rate-limit interaction | Only **uncached** input tokens count toward ITPM | 1 | [Anthropic — Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |

#### OpenAI

| Parameter | Value | Tier | Source |
|---|---|---|---|
| Min cacheable tokens | **1,024 tokens** (automatic, no code changes) | 1 | [OpenAI — Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Cache granularity increment | **128-token increments** after the initial 1,024 | 1 | ibid |
| TTL — in-memory (most models) | 5–10 min inactivity; max 1 h | 1 | ibid |
| TTL — extended (gpt-5.x, gpt-4.1) | up to 24 h (default for gpt-5.5/gpt-5.5-pro) | 1 | ibid |
| Cache cost | no extra charge | 1 | ibid |
| Rate-limit interaction | Cached tokens still count toward TPM | 1 | ibid (FAQ §5) |
| `prompt_cache_key` overflow | Cache overflow at ~15 req/min per unique prefix+key | 1 | ibid |

#### Google Gemini

| Parameter | Value | Tier | Source |
|---|---|---|---|
| Min tokens — implicit caching (Gemini 2.5+) | **~2,048 tokens** (auto, no cost; 90% discount) | 1 | [Google — Gemini caching](https://ai.google.dev/gemini-api/docs/caching) |
| Min tokens — explicit caching (Gemini 2.0) | **2,048 tokens** | 1 | ibid |
| Min tokens — explicit caching (Gemini 3 / 3.1) | **4,096 tokens** | 1 | ibid |
| Discount rate — implicit (Gemini 2.5+) | 90% off input | 1 | ibid |
| Discount rate — explicit (Gemini 2.0) | 75% off input | 1 | ibid |
| Storage cost | implicit: none; explicit: charged per token-hour | 1 | ibid |

#### xAI, Mistral, Microsoft Copilot

Cache parameters for xAI Grok, Mistral, and Microsoft Copilot (direct API) are **undocumented** in Tier-1 sources as of 2026-06-21.

**Why it matters:** the minimum cacheable threshold (1,024 tokens for Anthropic/OpenAI) means
that very small tool sets (<10 tools) may not trigger caching at all. The 4-breakpoint limit on
Anthropic constrains where system-prompt, tool definitions, and conversation history can each
be independently cached.

---

### 4. Schema micro-limits (inside a single tool's inputSchema)

**Layer: model-API**

These constrain how complex a single tool definition can be, orthogonal to the
total-tools count limit.

#### OpenAI — strict mode (`strict: true`)

| Constraint | Value | Tier | Source |
|---|---|---|---|
| Max total object properties across entire schema | **100** | 1 | [OpenAI — Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) |
| Max nesting depth | **5 levels** | 1 | ibid |
| All properties must be in `required` | Yes (enforced) | 1 | ibid |
| `additionalProperties` must be `false` | Yes | 1 | ibid |
| Max enum values | undocumented (large enums add latency; no hard cap published) | — | community |
| Unsupported keywords | `oneOf` (use `anyOf` instead in non-strict schemas) | 1 | ibid |

#### Google Gemini — function declarations

| Constraint | Value | Tier | Source |
|---|---|---|---|
| Supported keywords | `type`, `nullable`, `required`, `format`, `description`, `properties`, `items`, `enum`, `anyOf`, `$ref`, `$defs` | 1 | [Google — Structured output](https://ai.google.dev/gemini-api/docs/structured-output) |
| Max schema size | undocumented; API rejects "very large or deeply nested schemas" — simplify if errors occur | 1 | ibid |
| Key order preservation | Maintained for Gemini 2.5+ | 1 | ibid |

#### Anthropic — tool inputSchema

| Constraint | Value | Tier | Source |
|---|---|---|---|
| Hard schema limits | none published | — | — |
| Compilation limit | "compiled grammar is too large" (400 error) — complex schemas with optional params, union types, nested objects compound grammar size non-linearly | 4 | [anthropic-sdk-python#1185](https://github.com/anthropics/anthropic-sdk-python/issues/1185) |
| Unsupported keywords | `recursive schemas`, numerical constraints (`minimum`/`maximum`), string length constraints, complex regex (in strict/structured output mode) | 4 | ibid |
| Compilation timeout | 180 s (server-side) | 4 | ibid |

**Why it matters:** a single very complex tool (deeply nested, many optional fields, large
unions) can trigger a 400 rejection on Anthropic or add significant latency on OpenAI, even
when the total tool count is within bounds. The recommender should surface schema-complexity
warnings per tool, not just count.

---

### 5. Rate-limit interaction with tool definitions

**Layer: model-API**

Tool / function definitions are serialized as input tokens in every request.
They count toward input-token rate limits regardless of whether the model calls those tools.

| Provider | Token billing | Rate-limit meter | Notes | Tier | Source |
|---|---|---|---|---|---|
| **Anthropic** | tool defs = input tokens | ITPM — but **only uncached input tokens count** | Prompt-caching large tool sets effectively raises usable ITPM throughput | 1 | [Anthropic — Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| **OpenAI** | tool defs = input tokens | TPM — **cached tokens still count** toward TPM | Use `prompt_cache_key` + extended caching to reduce latency but not rate-limit pressure | 1 | [OpenAI — Prompt caching FAQ](https://developers.openai.com/api/docs/guides/prompt-caching) |
| **Google Gemini** | tool defs = input tokens | RPM + TPM | Implicit caching (Gemini 2.5+) does not reduce rate-limit token count (undocumented) | 1 | [Google — Gemini API docs](https://ai.google.dev/gemini-api/docs/caching) |
| **All providers** | tiered RPM/TPM structure | Varies by account tier | A large tool set injected per-request multiplies token consumption proportionally — throttles throughput on lower tiers | 1 | provider rate-limit pages |

**Why it matters:** a server with 50 tools × 800 tokens/tool = 40,000 tokens injected per
request. At an Anthropic Tier-1 ITPM of 100k uncached tokens/min, that leaves only ~2.5
requests/min for actual user content — an unexpected throughput cliff.

---

### 6. Agentic loop / sequential-turn caps

**Layer: SDK / client**

These are framework-level safety rails, not model limits. They stop runaway loops.

| SDK / Framework | Default `max_turns` | Configurable? | Error / behavior | Tier | Source |
|---|---|---|---|---|---|
| **OpenAI Agents SDK** | **10** turns (each turn = one LLM invocation; tool executions don't count) | Yes (`max_turns=None` to disable) | Raises `MaxTurnsExceeded` | 1 | [OpenAI Agents SDK — Running agents](https://openai.github.io/openai-agents-python/running_agents/) |
| **Anthropic Agent SDK (Claude)** | **unlimited** by default (`max_turns` optional) | Yes; also `max_budget_usd` | Raises `error_max_turns` if set | 1 | [Claude Code Docs — Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop) |
| **Anthropic server-side guardrail** | ~10 iterations / ~20 tool calls (stop_reason = `pause_turn`) | No (server-enforced) | Abrupt halt — backend cost-control as of ~March 2026 | 4 | [Augment Code — Anthropic Agent SDK guide](https://www.augmentcode.com/guides/anthropic-agent-sdk-what-ships-vs-what-you-build) |
| **Claude Desktop (per-turn)** | undocumented; "reached its tool-use limit" message | No | Stops loop, prompts user | 4 | [startdebugging.net — reducing MCP tools](https://startdebugging.net/2026/05/how-to-reduce-the-number-of-mcp-tools-claude-loads/) |
| **Vercel AI SDK** | configurable `maxSteps` (no published default) | Yes | Depends on framework | 4 | [ai-sdk.dev — loop control](https://ai-sdk.dev/docs/agents/loop-control) |

**Why it matters:** the OpenAI Agents SDK default of 10 turns is low enough to surprise
developers building multi-step pipelines. The Anthropic ~20-tool-call server-side guardrail
is invisible and cannot be overridden — agents silently pause regardless of SDK config.

---

### 7. Other credible findings

#### 7a. `tool_choice` forcing constraints

Forcing tool use with `tool_choice: {type: "tool", name: "X"}` (Anthropic) or
`tool_choice: {"type": "function", "function": {"name": "X"}}` (OpenAI) still requires the
named tool to be present in the tools list for that request. No separate limit documented
beyond needing to stay under `max_tools`. Undocumented behavior: forcing a tool that does
not appear in the tools array returns a 400 on both providers.

#### 7b. Structured output + tools interaction (OpenAI)

When both `tools` and `response_format: {type: "json_schema"}` are present, OpenAI applies
strict-mode schema constraints to **both** — the response schema and the tool schemas each
independently count against the 100-property / 5-level-nesting ceiling. Using many tools
with complex schemas alongside a complex structured output schema can exhaust the budget.
Source: [OpenAI — Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) (Tier 1).

#### 7c. MCP `elicitation` flat-schema constraint (already covered in §1)

The elicitation `requestedSchema` is restricted to **flat objects with primitive-only
properties** (string, number, integer, boolean, enum). Nested objects, arrays of objects,
`$ref`, and `anyOf` are intentionally excluded by spec. This is a deliberate protocol
constraint, not a bug.
Source: [MCP spec — Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation) (Tier 1).

#### 7d. MCP `sampling` deprecation

The `sampling` client feature (server-initiated LLM completions) is **deprecated as of the
2026-07-28 draft spec** — new implementations should not adopt it; existing ones should
migrate to direct provider-API integration. No token or count limits ever applied since it
was a pass-through to the host's model.

#### 7e. OpenAI `prompt_cache_key` overflow threshold

Requests for the same prefix + `prompt_cache_key` combination that exceed **~15 requests/min**
overflow to additional machines, reducing cache hit rates. Relevant for high-throughput
tool-definition caching. Source: [OpenAI — Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) (Tier 1).

# Citations

None.
