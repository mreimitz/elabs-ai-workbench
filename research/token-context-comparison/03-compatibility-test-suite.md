# 03 — MCP × Model Compatibility Test Suite

> A model-aware test suite that scores how well an MCP server (and each of its tools) will work on
> each LLM/model, producing a **compatibility heatmap**. It generalizes the app's existing
> tool checks (`optimize.ts`, `scan_events`) into per-model tests driven by the limit dataset in
> this folder. **This document is written to be picked up and implemented by a coding agent.**
>
> Machine-readable companion: [`tests/test-catalog.json`](./tests/test-catalog.json) (validated by
> [`tests/test-catalog.schema.json`](./tests/test-catalog.schema.json)). The catalog is the source of
> truth for the rules; this doc explains the framework and the human-facing copy.
> **As-of:** 2026-06-21.

## 1. Vision

For a given MCP server, show a grid: **rows = the server and its tools**, **columns = LLM models**
(Claude Opus 4.8, GPT-5.5, Gemini 3.5 Flash, Llama 4 Scout, Phi-4, …). Each cell is a
**green / amber / red** verdict — "this tool/server works well here / with caveats / not at all" —
backed by the specific tests that passed, warned, or failed, each with a fix. The same server is
green on a 1M-window model and red on Phi-4's 16K window; the heatmap makes that legible at a glance.

## 2. What it extends (don't rebuild)

| Existing | What it is | How the suite reuses it |
|---|---|---|
| `apps/web/src/lib/optimize.ts` | post-scan suggestions (`no-desc`, `long-desc`, `enum-*`, `no-schema`, `huge`) — `warn`/`info` | each becomes a **model-parameterized** test (e.g. `huge` → `SERVER_DEFINITION_FOOTPRINT` as a % of *that model's* window). The `extends_existing` field on each test names the link. |
| `scan_events` (`info`/`warning`/`error`) | discovery-time log | verdict→level mapping (`fail`→`error`, `warn`→`warning`) so results render in the same UI vocabulary |
| `mcp_tool_scans` (TokenBreakdown) | per-tool token counts already computed | the static tests consume these directly — no recount needed |
| `scenarios` / `tests` / `runs` / `run_steps` (Phase-3 harness) | live execution + per-step token instrumentation | the **session-level** tests read these tables; no new runner needed, just assertions over `run_steps` |
| `token-counting/provider-shapes.ts` | `toOpenAIStyleTool` / `toClaudeStyleTool` / `toRawMcpTool` | recount footprint in the **target model's tool shape** before the footprint tests |

## 3. Inputs (where each test gets its data)

Path namespaces (used in the catalog's `measured.inputs` and `threshold.source`):

- `tool.*` — the normalized tool + its `TokenBreakdown` (`mcp_tool_scans`).
- `scan.*` — server scan aggregate (`mcp_scans`: `total_tools`, `total_tokens`, `total_raw_bytes`, `tools[]`).
- `model.*` — the per-model object from [`data/**`](./data) (== `all-models.json[].detail`).
- `cross.*` — [`data/cross-cutting-limits.json`](./data/cross-cutting-limits.json) (protocol/client/SDK/provider limits).
- `session.*` — runtime data from `tool_executions` / `run_steps` (live session only).

So a **static** run needs only a scan + the bundled dataset; a **session** run additionally needs a
completed live run.

## 4. Test levels & data phases

- **Server level** — evaluate the whole tool set against a model (counts, total footprint, request
  size, client caps, name collisions, resources/prompts). Static.
- **Tool level** — evaluate one tool against a model (name length/pattern, description, schema
  micro-limits, per-tool token size). Static. This is the granular layer the heatmap drills into.
- **Session level** — things only observable from a live session: tool-result size, context
  high-water, calls-per-turn, parallelism, latency vs timeout, cache eligibility, cost/task, rate.
  Runtime (requires a run).

Catalog totals: **31 tests** — 8 server, 11 tool, 8 session, 4 environment (23 static, 8 runtime).
By scope: 13 per-tool, 8 per-server, 10 aggregate.

**Scope (separate from level).** Every test also declares a `scope` — `per_tool`, `per_server`, or
`aggregate` — describing what the measurement and limit span. This matters because **almost every
vendor cap is aggregate** (all connected servers + built-in tools combined: OpenAI 128, Gemini 512,
Claude 10k, Cursor 40), and **there is no documented per-server cap**. The count/footprint checks
therefore exist in two flavors: a `per_server` single-server upper bound, and an `aggregate`
`ENV_AGGREGATE_*` test that sums across all connected servers — the latter is what actually gates the
128/512/10k. See [`02-mcp-limits-taxonomy.md`](./02-mcp-limits-taxonomy.md) §"Scope".

## 5. Verdict, scoring & heatmap

**Verdict** per (test, subject, model): `pass | warn | fail | na`.
**Severity** (intrinsic weight): `blocker | high | medium | low`.

```
weights      = { blocker: 1.0, high: 0.7, medium: 0.4, low: 0.2 }
verdictValue = { pass: 1.0, warn: 0.5, fail: 0.0 }     // na excluded
cellScore    = 100 * Σ(weight · verdictValue) / Σ(weight)   over APPLICABLE tests
gate         = any blocker test with verdict=fail ⇒ cell is RED regardless of score
bands        = green: score ≥ 90 and no blocker fail
               amber: 60 ≤ score < 90, or any warn
               red:   score < 60, or any blocker fail
```

`na` tests are excluded from the denominator, so models are scored only on what actually applies to
them (a model with no documented name cap isn't penalized for the name tests). Keep `na` visible in
drill-down as "not applicable here," distinct from `pass`.

**Heatmap construction**

- **Server × Model view:** rows = servers (or one server's row), columns = models. Cell =
  server-level aggregate **plus** the rolled-up worst-or-average of its tool rows (configurable:
  worst-tool vs average-tool). Click → the failing/warning tests with fixes.
- **Tool × Model view:** rows = the server's tools, columns = models. Cell = tool-level aggregate.
  This is the detailed grid; it makes "tool X breaks on OpenAI strict mode" obvious.
- Column grouping by provider; allow pinning a "target client" (Cursor/Claude Desktop/…) to switch
  on the client-layer tests.

## 6. Applicability — which tests run per LLM/model

A test is only scored on a model when it actually applies. The catalog's `applies_to.rule` encodes how:

| Rule | Meaning | Example |
|---|---|---|
| `universal` | runs on every model | `SERVER_DEFINITION_FOOTPRINT`, `TOOL_DESCRIPTION_PRESENT` |
| `threshold_present` | runs only if `threshold.source` is non-null for that model, else `na` | `TOOL_NAME_LENGTH` (OpenAI/Anthropic only) |
| `computed_fallback` | universal, but the threshold is **derived** when the field is absent | `SERVER_TOOL_COUNT_CONTEXT` (window ÷ avg tool tokens) |
| `capability` | requires a capability flag to be true | `SESSION_CACHE_ELIGIBILITY` (needs `skills_context.prompt_caching`) |
| `client_configured` | needs a target host selected | `SERVER_CLIENT_TOOL_CAP` (Cursor 40) |

This is why the suite is model-specific by construction: the **same test resolves to a different
threshold (or to `na`) per model**, straight from the dataset. Example — `SERVER_TOOL_COUNT_HARD`
resolves to 512 on Gemini, 128 on OpenAI/Mistral, 200 on Grok, and `na` on Anthropic & open-weight
(which instead get `SERVER_TOOL_COUNT_CONTEXT`).

## 7. The catalog (human-readable)

Severity in brackets. Full machine detail (measured expression, threshold source, verdict bands,
references) is in `tests/test-catalog.json`.

### 7.1 Server-level tests

| Tech name | User-facing name | What it does | Recommendation |
|---|---|---|---|
| `server.toolCount.hardCap` [blocker] | Tool count within the model's hard limit | Total tools ≤ the model's API-enforced max tools/request (Gemini 512, OpenAI/Mistral 128, Grok 200). | Split the server, disable unused tools, or enable tool-search/deferral. |
| `server.toolCount.practical` [high] | Tool count within the reliable-selection range | Total tools ≤ the empirical degradation point (~30–50; lower for small models). | Gate tools per task; add a router/loader; keep the active set small. |
| `server.toolCount.contextDerived` [high] | Tools physically fit the context window | For uncapped models, derive max tools = window ÷ avg tool tokens (with output headroom) and check. | Trim per-tool size or raise serving context (`--max-model-len`). |
| `server.footprint.windowShare` [high] | Tool-definition footprint vs context window | Share of the window the tool definitions eat before any user message (warn ≥25%, fail ≥50%). | Trim definitions, pick a larger window, enable caching. |
| `server.payload.requestSize` [blocker] | Serialized tools fit the request size limit | Serialized payload ≤ request-size cap (Anthropic 32 MB, Gemini 100 MB, M365 4096-tok plugin). | Move bulky schema/examples out of the request. |
| `server.client.totalToolCap` [high] | Tool count within the host client's cap | Total tools ≤ the selected host's cap (Cursor ~40, Claude Desktop ~100, VS Code 128). | Keep Cursor < 35; use a tool-hub/proxy; disable idle servers. |
| `server.toolNames.unique` [blocker] | No duplicate tool names | No two tools share a name (incl. across namespaced servers). | Rename collisions; verify host namespacing. |
| `server.toolNames.namespacedLength` [high] | Namespaced tool names within length limit | Host-prefixed name (e.g. `mcp__srv__tool`) ≤ the model's name cap. | Shorten tool names / server handle; budget for the prefix. |
| `server.primitives.resourcesPrompts` [low] | Resources & prompts context impact | Flags that resources/prompts also land in the window as input tokens. | Account for read/template tokens; paginate/summarize reads. |

### 7.2 Tool-level tests

| Tech name | User-facing name | What it does | Recommendation |
|---|---|---|---|
| `tool.name.length` [blocker] | Tool name length | Name length ≤ the model's tool-name cap (OpenAI/Anthropic 64). | Rename to fit; remember the host prefix. |
| `tool.name.pattern` [blocker] | Tool name uses allowed characters | Name matches the required regex (`^[a-zA-Z0-9_-]+$`). | Replace spaces/dots with `_`/`-`. |
| `tool.description.present` [medium] | Tool has a description | Description is non-empty. | Add a one-line "what + when to use" — biggest selection-accuracy lever. |
| `tool.description.length` [high] | Description within length limit | Description ≤ the model's documented cap (OpenAI ~1024 chars). | Tighten; move examples into params/docs. |
| `tool.description.tokenBudget` [medium] | Description token cost is reasonable | Description token cost ≤ soft budget (warn 200, fail 500). | Shorten — paid on every call, every tool. |
| `tool.schema.present` [low] | Tool has a valid input schema | `inputSchema` is a usable object schema. | Declare a typed object schema; xAI rejects non-object roots. |
| `tool.schema.propertyCount` [high] | Schema property count within strict-mode limit | Total properties ≤ 100 (OpenAI strict). | Flatten/split; nest rare params under `options`. |
| `tool.schema.nestingDepth` [high] | Schema nesting depth within strict-mode limit | Max object depth ≤ 5 (OpenAI strict). | Flatten; reference shared shapes instead of inlining. |
| `tool.schema.unsupportedKeywords` [high] | Schema avoids unsupported keywords | No `oneOf`/`$ref` in OpenAI strict; provider-specific. | Rewrite unions as nullable fields or separate tools; inline `$ref`. |
| `tool.schema.enumSize` [low] | Enum value counts are reasonable | Largest enum ≤ soft cap (warn 100, fail 500). | Use free-form string + validation or a lookup tool. |
| `tool.definition.tokenSize` [high] | Single tool definition size | One tool's total tokens vs absolute + % of window. | Slim the heaviest tools first; split mega-tools. |

### 7.3 Session-level tests (require a live run)

| Tech name | User-facing name | What it does | Recommendation |
|---|---|---|---|
| `session.toolResult.size` [high] | Tool results fit the result-size limit | Measured tool-result tokens ≤ cap (M365 25 items / OpenAI ~512 KB) or window-share budget. | Paginate/filter/summarize chatty tools; cap rows. |
| `session.context.highWater` [blocker] | Session stays within the context window | Peak cumulative tokens (defs+history+results) < window. | Trim footprint/history; summarize results; bigger window; cache. |
| `session.turn.toolCallCount` [high] | Tool calls per turn within the loop cap | Tool-call cycles per turn ≤ model/SDK cap (Anthropic ~20 guardrail, OpenAI SDK 10). | Break chains into sub-tasks; raise SDK `max_turns` where allowed. |
| `session.turn.parallelCallCount` [medium] | Parallel tool calls within limit | Parallel calls in one turn ≤ any documented cap. | Disable parallel tool use or batch; check result ordering. |
| `session.toolCall.latencyVsTimeout` [high] | Tool latency within the host timeout | Tool exec latency ≤ host timeout (MCP 60 s, M365 45 s). | Make long tools async (job id + poll); stream; raise timeout. |
| `session.cache.prefixEligibility` [medium] | Tool prefix is cache-eligible | Static prefix ≥ the model's min cacheable tokens, caching on. | Put tools/system first + a breakpoint; on Anthropic cached tokens also skip the rate limit. |
| `session.cost.perTask` [low] | Estimated cost per task | $ per representative task from token mix × pricing. | Compare models; output is 3–5× input; reasoning bills as output. |
| `session.rate.tpmHeadroom` [medium] | Session throughput within rate limits | Token rate (incl. re-sent tool defs) ≤ TPM tier. | Cache the prefix (free of ITPM on Anthropic); raise tier; trim defs. |

## 8. Implementation notes (for the coding agent)

**Layering (match the existing 3-tier pattern).**

```
packages/shared/src/
  types.ts        + CompatibilityVerdict = "pass"|"warn"|"fail"|"na"
                  + CompatibilitySeverity = "blocker"|"high"|"medium"|"low"
                  + CompatibilityResult { testId, techName, level, subjectType:"server"|"tool"|"session",
                                          subjectId, modelId, verdict, score, measured, threshold,
                                          severity, message, recommendation }
                  + CompatibilityCell { modelId, score, band:"green"|"amber"|"red", results[] }
  constants.ts    + the catalog verdict/severity/weight constants (mirror tests/test-catalog.json)

apps/api/src/compatibility/
  catalog.ts      loads tests/test-catalog.json (bundle the dataset JSONs as assets:
                  all-models.json + cross-cutting-limits.json)
  evaluators.ts   pure functions per measured.expr (len, count_all_properties, max_nesting_depth,
                  count_duplicates, …) keyed by test id for the `computed`/`custom` ones
  resolve.ts      resolve threshold.source / measured.inputs against {tool, scan, model, cross, session}
  runner.ts       run(scan|tool|session, model) → CompatibilityResult[]; applies applies_to rule,
                  computes verdict via verdict_bands, score via scoring block
  service.ts      orchestration: build heatmap matrix over selected models
  routes.ts       endpoints (below)
  repository.ts   optional persistence (mcp_compatibility_results)
```

**Engine flow.** For each (model, subject): (1) filter catalog by `level`; (2) for each test resolve
`applies_to` → applicable or `na`; (3) compute `measured` via the evaluator; (4) resolve `threshold`
(read `source`, else `computed`/`fallback`); (5) map to a verdict via `verdict_bands`/`warn_at`/`fail_at`;
(6) aggregate to `cellScore` + `band` with the blocker gate. Most tests are data-driven; only the
handful with `threshold.computed` or `compare:"custom"` need a hand-written evaluator (their ids are
explicit in the catalog).

**Token recount in the model's shape.** Before footprint tests, recount each tool with the
matching provider shape via `toOpenAIStyleTool` / `toClaudeStyleTool` / `toRawMcpTool` so the share is
counted as that model actually sees it (`tool_definition_shape` in the dataset picks the adapter).

**API (indicative).**

```
GET /api/scans/:scanId/compatibility?models=claude-opus-4-8,gpt-5.5,…   → server+tool results per model
GET /api/scans/:scanId/heatmap?models=…&view=tool|server&client=cursor   → matrix for the grid
GET /api/tools/:toolScanId/compatibility?models=…                        → one tool across models
POST /api/runs/:runId/compatibility                                      → session-level results from a run
```

**Data model.** Static tests need no new tables (compute on read from `mcp_tool_scans` + bundled
dataset). To persist/trend, add `mcp_compatibility_results(id, scan_id, run_id?, model_id, subject_type,
subject_id, test_id, verdict, score, measured_json, severity, created_at)`. Session tests read
`run_steps`/`tool_executions`; add `cumulative_tokens` to `run_steps` if not already instrumented.

**Keeping it current.** The catalog and the limit dataset are the only things to update as models
change — no code changes for new thresholds. Re-running a provider's research refreshes `data/**`;
`python3 comparison/build_comparison.py` refreshes the merged view the engine reads.

## 9. Phasing

1. **Static MVP** — server + tool tests over an existing scan + dataset; ship the **Tool × Model**
   and **Server × Model** heatmaps. No live run required. Highest value, lowest effort.
2. **Session pack** — wire the 8 session tests onto the Phase-3 run harness (`run_steps`),
   add cost/task and context-highwater to run reports.
3. **Persistence & trends** — store results, show compatibility drift across scans over time.
4. **Recommendations panel** — surface the per-cell fixes as an actionable checklist (dedupe the
   recommendations across failing tests).

## 10. Open questions

- **Roll-up rule** for the server cell from its tool rows: worst-tool (conservative) vs
  average-tool (lenient) vs count-of-red — make it a UI toggle, default worst-tool.
- **Practical tool-count thresholds** are Tier-4 empirical; expose them as tunable settings.
- **Per-tool token recount** across all models for large servers is O(tools × models) — cache by
  `(toolHash, shape)` since shape (not model) determines the count.
- **Client targets** to ship first for the client-layer tests (Cursor, Claude Desktop, VS Code?).
