---
type: "Research Note"
title: "Anthropic (Claude) \u2014 Provider Profile"
description: "Source: data/saas/anthropic.json"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Anthropic (Claude) — Provider Profile

**As of:** 2026-06-21  
**Source:** `data/saas/anthropic.json`  
**Models covered:** Claude Opus 4.8, Claude Sonnet 4.6, Claude Haiku 4.5

---

## Provider Summary

### MCP Posture — Native, first-party
Anthropic created and maintains the MCP specification. The Claude API exposes a first-party MCP connector (`mcp-client-2025-11-20` beta header) that connects directly to remote HTTP MCP servers from the Messages API — no separate MCP client needed. Supported on Claude API and Claude Platform on AWS; not yet on Amazon Bedrock or Vertex AI. Current MCP support is tools-only (prompts and resources from the MCP spec are not yet supported). Supports allowlisting, denylisting, and per-tool `defer_loading` configuration per MCP toolset.

### Skills Posture — Progressive disclosure, minimal startup cost
Anthropic's "Agent Skills" bundle instructions, code, and resources into filesystem directories (SKILL.md + scripts/references). Loading is three-level progressive disclosure:

| Level | When | Cost per skill |
|---|---|---|
| 1 — Metadata | Always, at startup | ~100 tokens (name+description YAML) |
| 2 — Instructions | When skill triggered (Claude reads SKILL.md via bash) | Up to ~5k tokens |
| 3 — Bundled files/scripts | As needed via bash | Effectively 0 (only output enters context) |

This means a large skill library has near-zero constant context overhead; only triggered skills consume context. Available on Claude API, claude.ai, Claude Code, Claude Platform on AWS, and Microsoft Foundry.

### Tokenizer Posture — Closed; use count_tokens API
Anthropic's tokenizer is proprietary and not publicly released. Exact counts require calling `POST /v1/messages/count_tokens` with the target model. This endpoint is free, supports all input types (tools, system prompts, images, PDFs, extended-thinking blocks), and is subject to per-tier RPM limits. **Important:** Opus 4.7 and later use a newer tokenizer that produces ~35% more tokens than older models for the same text. Always count with the exact target model ID.

---

## Model Profiles

### Claude Opus 4.8 (`claude-opus-4-8`)

**Released:** 2026-05-28 | **Status:** GA

#### Context
| Field | Value | Notes |
|---|---|---|
| Context window | 1,000,000 tokens | GA default; no beta header needed |
| Input + output shared | Yes | One pool |
| Max output (sync) | 128,000 tokens | |
| Max output (batch) | 300,000 tokens | `output-300k-2026-03-24` beta header |
| Extended context | N/A | 1M is the default |
| Reasoning tokens as output | Yes | Adaptive thinking always on; billed at output rate |
| Max images/request | 600 | API; 100 for 200k-window models |

#### Tokenization
| Field | Value |
|---|---|
| Tokenizer family | `claude` (proprietary BPE, newer generation from Opus 4.7) |
| Tokenizer public | No |
| Count method | `POST /v1/messages/count_tokens` with `model: "claude-opus-4-8"` |
| Image rule | `ceil(w/28) × ceil(h/28)` tokens; max 4784 tokens/image (2576px long edge) |
| Audio | Not supported |
| Chars/token estimate | ~3.5 (rough; newer tokenizer ~35% more tokens vs pre-4.7) |

#### Tools / MCP
| Field | Value | Notes |
|---|---|---|
| Function calling | Yes | |
| Native MCP | Yes | `mcp-client-2025-11-20` beta header |
| Parallel tool calls | Yes | Multiple tool_use blocks per turn |
| Max tools hard limit | None documented | No API-enforced cap published |
| Max tools practical | ~40 | Accuracy degrades past 30-50 without defer_loading |
| Tool definition shape | `anthropic_tool` | `{name, description, input_schema (JSON Schema)}` |
| Tool defs count as input | Yes | + 290 tokens system prompt overhead (auto/none) or 410 tokens (any/tool) |
| Tool search / defer_loading | Yes | Catalog up to 10,000 tools; >85% context reduction |
| Max tool name length | 64 chars | Regex `^[a-zA-Z0-9_-]{1,64}$` |

#### Skills / Context
| Field | Value |
|---|---|
| Skills supported | Yes |
| Skills loading model | Progressive disclosure (3 levels) |
| Prompt caching | Yes — cache read $0.50/MTok (0.1x base); 5-min write $6.25/MTok; 1-hr write $10/MTok |
| Memory feature | Yes (memory tool, server-side) |

**Skills context cost:** ~100 tokens/skill at startup; up to ~5k tokens when triggered; Level 3 resources never enter context (bash output only).  
**System prompt overhead:** 290 tokens (auto/none tool choice) or 410 tokens (any/tool). Not billed.

#### Cost
| Tier | $/MTok input | $/MTok output |
|---|---|---|
| Standard | $5.00 | $25.00 |
| Cached read | $0.50 | — |
| Batch | $2.50 | $12.50 |

---

### Claude Sonnet 4.6 (`claude-sonnet-4-6`)

**Released:** 2026-02-17 | **Status:** GA

#### Context
| Field | Value | Notes |
|---|---|---|
| Context window | 1,000,000 tokens | GA default |
| Input + output shared | Yes | |
| Max output (sync) | 64,000 tokens | |
| Max output (batch) | 300,000 tokens | `output-300k-2026-03-24` beta header |
| Extended context | N/A | 1M is default |
| Reasoning tokens as output | Yes | Supports extended thinking + adaptive thinking |

#### Tokenization
| Field | Value |
|---|---|
| Tokenizer family | `claude` (newer generation, same as Opus 4.7+) |
| Tokenizer public | No |
| Count method | `POST /v1/messages/count_tokens` with `model: "claude-sonnet-4-6"` |
| Image rule | `ceil(w/28) × ceil(h/28)` tokens; max 1568 tokens/image (standard res, 1568px long edge) |
| Audio | Not supported |
| Chars/token estimate | ~3.5 |

#### Tools / MCP
| Field | Value | Notes |
|---|---|---|
| Function calling | Yes | |
| Native MCP | Yes | Same as Opus 4.8 |
| Parallel tool calls | Yes | |
| Max tools hard limit | None documented | |
| Max tools practical | ~40 | |
| Tool definition shape | `anthropic_tool` | |
| Tool defs count as input | Yes | + 497 tokens system prompt overhead (auto/none) or 589 tokens (any/tool) |
| Tool search / defer_loading | Yes | |
| Max tool name length | 64 chars | |

#### Skills / Context
| Field | Value |
|---|---|
| Skills supported | Yes |
| Skills loading model | Progressive disclosure |
| Prompt caching | Yes — cache read $0.30/MTok; 5-min write $3.75/MTok; 1-hr write $6/MTok |
| Memory feature | Yes |

**Context awareness:** Sonnet 4.6 receives explicit token-budget information at conversation start and after each tool call. This helps it manage context over long sessions without guessing.

#### Cost
| Tier | $/MTok input | $/MTok output |
|---|---|---|
| Standard | $3.00 | $15.00 |
| Cached read | $0.30 | — |
| Batch | $1.50 | $7.50 |

---

### Claude Haiku 4.5 (`claude-haiku-4-5`)

**Released:** 2025-10-15 | **Status:** GA  
_API alias `claude-haiku-4-5` resolves to pinned snapshot `claude-haiku-4-5-20251001`_

#### Context
| Field | Value | Notes |
|---|---|---|
| Context window | 200,000 tokens | Smaller window than Opus/Sonnet 4.x |
| Input + output shared | Yes | |
| Max output (sync) | 64,000 tokens | |
| Max output (batch) | 64,000 tokens | Not included in 300k batch output beta |
| Extended context | None | 200k is fixed |
| Reasoning tokens as output | Yes | Supports extended thinking only (not adaptive thinking) |

#### Tokenization
| Field | Value |
|---|---|
| Tokenizer family | `claude` (proprietary BPE; pre-Opus 4.7 generation likely) |
| Tokenizer public | No |
| Count method | `POST /v1/messages/count_tokens` with `model: "claude-haiku-4-5"` |
| Image rule | `ceil(w/28) × ceil(h/28)` tokens; max 1568 tokens/image (standard res) |
| Audio | Not supported |
| Chars/token estimate | ~4.0 (pre-4.7 tokenizer generation likely) |

#### Tools / MCP
| Field | Value | Notes |
|---|---|---|
| Function calling | Yes | |
| Native MCP | Yes | |
| Parallel tool calls | Yes | |
| Max tools hard limit | None documented | |
| Max tools practical | ~30 | 200k window means tool defs consume higher % of context |
| Tool definition shape | `anthropic_tool` | |
| Tool defs count as input | Yes | + 496 tokens system prompt overhead (auto/none) or 588 tokens (any/tool) |
| Tool search / defer_loading | Yes | Especially recommended: 200k window makes footprint reduction critical |
| Max tool name length | 64 chars | |

#### Skills / Context
| Field | Value |
|---|---|
| Skills supported | Yes |
| Skills loading model | Progressive disclosure |
| Prompt caching | Yes — cache read $0.10/MTok; 5-min write $1.25/MTok; 1-hr write $2/MTok |
| Memory feature | Yes |

**Context sensitivity note:** With only 200k tokens, each Level 1 skill metadata block (~100 tokens) and Level 2 instruction load (~5k tokens) is proportionally more costly than on 1M-window models. Prefer deferred loading for MCP tools and triggered loading for skills.

#### Cost
| Tier | $/MTok input | $/MTok output |
|---|---|---|
| Standard | $1.00 | $5.00 |
| Cached read | $0.10 | — |
| Batch | $0.50 | $2.50 |

---

## Takeaways for the Recommender

### When to pick Claude models

**Opus 4.8** — Maximum capability, large context (1M), highest cost. Best for complex multi-step agentic tasks with many tools, large codebases, or long documents. Adaptive thinking always on.

**Sonnet 4.6** — Best price/performance for most production workloads. 1M context at 60% of Opus cost. Context-awareness feature makes it particularly reliable for long sessions. Supports full extended + adaptive thinking. Current default for Free/Pro claude.ai.

**Haiku 4.5** — Fastest and cheapest. Use for sub-agent orchestration, high-throughput classification, simple tool calls, or latency-sensitive chat. 200k window is the key constraint; tool/skill footprint management is critical.

### Footprint headroom

| Model | Window | 55k tool defs = % window | Remaining after 55k |
|---|---|---|---|
| Opus 4.8 | 1,000,000 | 5.5% | 945,000 tokens |
| Sonnet 4.6 | 1,000,000 | 5.5% | 945,000 tokens |
| Haiku 4.5 | 200,000 | 27.5% | 145,000 tokens |

A typical multi-server MCP setup (~55k tokens of tool definitions per Anthropic engineering docs) is negligible for Opus/Sonnet 4.x but consumes over a quarter of Haiku 4.5's window. **Defer_loading is strongly recommended for any Haiku 4.5 deployment with more than a handful of tools.**

### Cost profile (tool-heavy session estimate)

Assuming 50k input tokens (with 40k cached) + 5k output tokens per turn:

| Model | Uncached input | Cached input | Output | Turn total |
|---|---|---|---|---|
| Opus 4.8 | $0.05 | $0.02 | $0.125 | ~$0.195 |
| Sonnet 4.6 | $0.03 | $0.012 | $0.075 | ~$0.117 |
| Haiku 4.5 | $0.01 | $0.004 | $0.025 | ~$0.039 |

Prompt caching is the single most impactful cost lever: cached reads at 10% of base input price pay back after a single repeated turn on 5-minute cache writes.

### Key levers to recommend
1. **defer_loading + tool search** — eliminates >85% of tool-definition context on large MCP catalogs; essential for Haiku 4.5
2. **Prompt caching** — apply to tools array and system prompt; pays back after one cache read at 5-min duration
3. **Batch API** — 50% discount for non-interactive workloads
4. **Skills** — progressive disclosure means large skill libraries are free at startup; only triggered skills cost context

---

## MCP / tool limits

_Research pass: 2026-06-21. All values apply to the direct Claude API (api.anthropic.com) unless noted. Per-model values identical across Opus 4.8 / Sonnet 4.6 / Haiku 4.5 unless flagged._

| Limit type | Value | Layer | Confidence | Source |
|---|---|---|---|---|
| `max_tools_hard` | **null** — no published API-enforced count cap | Model API | medium | [Tool search docs (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| `max_tool_name_len` | **64 chars**, regex `^[a-zA-Z0-9_-]{1,64}$` | Model API | high | [Define tools (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) |
| `max_tool_description_len` | **null** — no documented cap | Model API | medium | [Define tools (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) |
| `max_request_size` | **32 MB** (direct API); Vertex AI 30 MB; Bedrock 20 MB | Model API | high | [API overview (Tier 1)](https://platform.claude.com/docs/en/api/overview#request-size-limits) |
| `max_tool_result_size` | **null** — no per-result cap; bounded by 32 MB request + context window | Model API | medium | [Handle tool calls (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) |
| `max_parallel_tool_calls_count` | **null** — supported, no fixed numeric cap; `disable_parallel_tool_use` flag available | Model API | medium | [Parallel tool use (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use) |
| `tool_use_per_turn_limit` | **null** — no documented API count cap; task budgets (advisory, Opus 4.7/4.8 only) are token budgets not turn counts | Client / API | low | [Task budgets (Tier 1)](https://platform.claude.com/docs/en/build-with-claude/task-budgets) |
| `max_connected_servers` | **null** — no documented hard cap on `mcp_servers` array; each server must be referenced by exactly one MCPToolset | Model API | low | [MCP connector (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) |
| `max_total_tools` | **10,000** with `defer_loading` + tool search (Tier-1 documented); ~30–50 practical without deferral; ~100 aggregate in Claude Desktop (Tier-4 community) | Model API / Client | high (API), low (Desktop) | [Tool search (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| `tool_schema_limits_notes` | JSON Schema for `input_schema`; `pattern` keyword **not** supported with `strict:true` (400 error); no max depth/properties documented | Model API | high | [Strict tool use (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use) |
| `other_limits_notes` | MCP requires HTTPS; only tool calls from MCP spec (not prompts/resources); tool search regex max 200 chars; Files API 500 MB/file; rate limits by tier (RPM+ITPM); cached input tokens exempt from ITPM for most models | Model API / MCP protocol | high | [API rate limits (Tier 1)](https://platform.claude.com/docs/en/api/rate-limits) |

### Notes on null values

- **`max_tools_hard`**: Anthropic deliberately has no per-request tool count cap. The tool search catalog supports 10,000 tools via `defer_loading`; without it, selection accuracy degrades at 30-50 tools (empirical, not a hard limit).
- **`max_tool_description_len`**: No cap in docs. Long descriptions consume input tokens proportionally — effectively bounded by the 32 MB request limit and context window.
- **`max_tool_result_size`**: No cap documented. Best practice is to filter tool results at the application layer before returning.
- **`max_parallel_tool_calls_count`**: Claude emits as many `tool_use` blocks per turn as the task requires, bounded by `max_tokens` per turn.
- **`tool_use_per_turn_limit`**: The "Claude reached its tool-use limit for this turn" message appears in the claude.ai consumer UI (client-side cap) but is not documented in the API. API consumers control multi-turn agentic behavior via their own loop and `max_tokens`.
- **`max_connected_servers`**: No hard cap on the `mcp_servers` array. The validation rule is structural (one MCPToolset per server), not a count cap.

---

## Sources

- [Models overview (Tier 1)](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Pricing (Tier 1)](https://platform.claude.com/docs/en/about-claude/pricing)
- [Context windows (Tier 1)](https://platform.claude.com/docs/en/build-with-claude/context-windows)
- [Token counting (Tier 2)](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Vision / image billing (Tier 1)](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Define tools — tool name schema (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [Tool search / defer_loading (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [MCP connector (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Agent Skills overview (Tier 1)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Claude Opus 4.8 announcement (Tier 1)](https://www.anthropic.com/news/claude-opus-4-8)
- [Claude Sonnet 4.6 announcement (Tier 1)](https://www.anthropic.com/news/claude-sonnet-4-6)
- [Claude Haiku 4.5 announcement (Tier 1)](https://www.anthropic.com/news/claude-haiku-4-5)

# Citations

None.
