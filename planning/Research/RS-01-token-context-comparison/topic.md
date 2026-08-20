---
type: "Research Topic"
title: "Token & Context Comparison — LLM Baseline Dataset"
description: "Establish a per-model baseline of context limits, tokenization, tool/MCP behavior, skills handling and token-cost accounting for the leading LLMs, and turn it into an executable MCP x model compatibility test suite."
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Token & Context Comparison — LLM Baseline Dataset

## Objective

Establish a per-model baseline of context limits, tokenization, tool/MCP behavior, skills handling and token-cost accounting for the leading LLMs, and turn it into an executable MCP x model compatibility test suite.

## Why now / what it feeds

It is the ground truth the workbench's token-counting adapters, compatibility heatmap and advisor recommendations are built on.

## Scope

**In:** Six SaaS and five open-weight providers, latest three models each; MCP and tool limit taxonomy; the 31-test compatibility catalog; impact and per-model severity; the app's own test/check architecture.

**Out:** Provider pricing negotiation, non-MCP agent frameworks, and any limit that cannot be evidenced from vendor documentation.

## Deliverable

A machine-readable per-model dataset plus a comparison matrix, a test catalog and a severity model consumed by the compatibility feature.

## Success criteria

Every documented limit is traceable to a vendor source, the catalog validates against its schema, and the compatibility feature can resolve a verdict per model without further research.

## Overview (from the original topic README)

A per-model baseline of context limits, tokenization, tool/MCP behavior, skills handling, and
token-cost accounting for the top LLMs — the ground truth the **MCP Token Footprint**
recommendation engine, token-counting adapters, and session/cost analysis build on.

**As-of:** 2026-06-21 · **Scope:** 6 SaaS + 5 open-weight providers, latest 3 models each.

## Read in this order

1. [`00-methodology.md`](./notes/00-methodology.md) — how we compare, source hierarchy, definitions, the seven axes.
2. [`01-information-structure.md`](./notes/01-information-structure.md) — the schema concept + full field dictionary.
3. [`02-mcp-limits-taxonomy.md`](./notes/02-mcp-limits-taxonomy.md) — every MCP/tool **limit type**, which of the 4 layers enforces it, and the less-obvious "rumored" ones (resources/prompts, timeouts, cache breakpoints, schema micro-limits, rate-limit interaction, agent-loop caps).
4. [`03-compatibility-test-suite.md`](./outputs/03-compatibility-test-suite.md) — the **MCP × Model compatibility test suite**: 31 server/tool/session/environment tests (8 server · 11 tool · 8 session · 4 environment), verdict+scoring, the heatmap design, and implementation notes for a coding agent. Machine-readable in [`tests/test-catalog.json`](./outputs/tests/test-catalog.json).
5. [`04-mcp-builder-skill-gap-analysis.md`](./outputs/04-mcp-builder-skill-gap-analysis.md) — review of the external `mcp-builder` skill: what it covers that our suite would miss (design-quality + agentic-effectiveness) and what to borrow.
6. [`05-test-execution-modes.md`](./outputs/05-test-execution-modes.md) — the **access taxonomy**: which tests run `static_connection` (no execution) vs `single_tool_exec` vs `live_session` (backlog), plus what's out of scope without source code.
7. [`06-impact-and-model-severity.md`](./outputs/06-impact-and-model-severity.md) — the **impact + per-model severity** layer: what breaks on non-compliance, and how severe that is for each LLM/model, resolved from the dataset with rationale + evidence (a test can be a hard no-go on one model, advisory on another).
8. [`schema/`](./outputs/schema/) — `model-entry.schema.json` (validation) + `template.provider.json` (blank).
9. [`data/`](./outputs/data/) — structured source of truth: one JSON per provider, plus [`data/cross-cutting-limits.json`](./outputs/data/cross-cutting-limits.json) for protocol/client/SDK-level limits that aren't per-model.
10. [`docs/`](./notes/per-provider/) — human-readable write-up per provider.
11. [`comparison/`](./outputs/comparison/) — `all-models.json` (merged) + `comparison-matrix.md` (cross-model tables, incl. §3 tools + §3b extended limits).
12. [`tests/`](./outputs/tests/) — `test-catalog.json` (31 tests + impact/severity) + `test-catalog.schema.json` + `resolve_model_severity.py` (reference resolver; ported to TS in `apps/api/src/compatibility/resolve.ts`).

## Roster

**SaaS:** Anthropic (Claude) · OpenAI (GPT) · Google (Gemini) · xAI (Grok) · Mistral · Microsoft (Copilot)

**Open-weight (client-managed / self-hosted):** Meta (Llama) · DeepSeek · Alibaba (Qwen) · Google (Gemma) · Microsoft (Phi)

## The seven comparison axes

1. Context window · 2. Max input / output · 3. Tokenization · 4. Token-consumption accounting ·
5. MCP / tools (max tools, how tool defs hit the window) · 6. Skills & their context contribution ·
7. Limits & cost.

## How it feeds the product

| Dataset field | Product use |
|---|---|
| `context.context_window_tokens` | denominator for `mcp_scans.total_tokens` → % of window a server consumes |
| `tools_mcp.tool_definition_shape` | which adapter (`toOpenAIStyleTool` / `toClaudeStyleTool` / raw) to count with |
| `tools_mcp.max_tools_practical` | "tools loaded vs safe limit" gauge in the recommender |
| `cost.*` + `reasoning_billed_as_output` | cost-per-task / session-cost projections |
| `skills_context.prompt_caching`, `tools_mcp.tool_search_deferral` | levers the recommender suggests to cut footprint |

## Provenance & trust

Every factual field carries `{value, source_url, source_tier (1–4), confidence (high/medium/low),
as_of}`. Unknowns are explicit `null` with a reason — never guessed. Frontier specs change monthly;
re-run a provider's subagent to refresh its file.

## Status

- [x] Methodology · [x] Information structure · [x] Schema + template
- [x] SaaS provider data (6) · [x] Open-weight provider data (5) — 33 models total
- [x] Comparison matrix + merged dataset (`comparison/`) · [x] QA pass (`comparison/QA-report.md`)
- [x] MCP/tool **limits taxonomy** (`02-mcp-limits-taxonomy.md`) — hard caps chased + extended & cross-cutting limit types captured (`data/cross-cutting-limits.json`)
- [x] **Compatibility test suite** (`03-compatibility-test-suite.md` + `tests/test-catalog.json`) — 31 model-aware tests for the server/tool/session/environment heatmap, schema-validated, all dataset paths resolve. Engine built in `apps/api/src/compatibility/` (static MVP) — see `roadmap/testing/phase-5-compatibility/`.

**QA verdict (2026-06-21):** all 11 files pass JSON-Schema validation; group/self-host consistency
clean; enums valid. Independent Tier-1 spot-check of headline numbers: **5 PASS, 1 FLAG, 0 errors
needing correction** (Anthropic 1M confirmed GA; Gemma 4 confirmed Apache-2.0; OpenAI/DeepSeek/Mistral
prices confirmed; model existence confirmed). See [`comparison/QA-report.md`](./outputs/comparison/QA-report.md).

## Selection notes (read before trusting a single row)

- **Gemini:** the file lists the latest *GA* models. The current flagship **Gemini 3.1 Pro is
  preview-only** on the Developer API (the GA Pro is 2.5 Pro). Add a preview entry if your use case
  needs the flagship.
- **xAI Grok:** `grok-4-fast` (the old 2M-context model) was retired 2026-05-15 and now aliases to
  `grok-4.3` (1M). The "2M window" seen on aggregators no longer reflects a live model.
- **Anthropic:** 1M context is GA and flat-rate for Opus 4.8 / Sonnet 4.6 (200K only on some
  private-cloud surfaces); Haiku 4.5 is 200K.
- **Provenance gap:** ~39 medium/high-confidence fields carry a model-level `sources[]` array but no
  per-field `source_url`. Values are sourced; a per-field provenance sweep is a nice-to-have follow-up.

## Refreshing

Per-provider data is point-in-time. To refresh one provider, re-run its research against the
template, overwrite `data/<group>/<provider>.json`, then run `python3 comparison/build_comparison.py`
to regenerate the matrix and merged dataset.
