# 05 — Test Execution Modes (what access each test needs)

> Re-classifies the compatibility tests by **what access is required to run them**, independent of
> what they measure. This is the dimension that decides *when* each test can ship.
> Authoritative field: `execution_mode` in [`tests/test-catalog.json`](./tests/test-catalog.json).
> **As-of:** 2026-06-21.

## The hard constraint: we never have the server's source code

Every test here runs against a **black-box** MCP server — we observe only what the protocol exposes
(`tools/list`, `resources/list`, `prompts/list`, and the responses of `tools/call`). Nothing reads
the server's implementation. That immediately rules a class of checks **out of automated scope**
(see §5). The remaining tests fall into exactly three access tiers.

## The three modes

| Mode | What it needs | Maps to (existing app capability) | Ship phase |
|---|---|---|---|
| **`static_connection`** | Connected + `tools/list` / `resources/list` / `prompts/list`. **No execution.** | the **discovery scan** (`discoverTools`, `mcp_tool_scans`) — already shipped | **now** |
| **`single_tool_exec`** | Execute **one** tool once (`tools/call`) and read the request/response. **No multi-turn.** | the **tool playground** + runtime token accounting (`tool_executions`) — already in the expanded target | **now-ish** |
| **`live_session`** | A **multi-turn, monitored** agent session (cumulative context, many calls). | the **live-session monitoring** you're building | **BACKLOG** |

Key correction from the first cut: several tests I had filed under the "session" *subject* actually
only need a **single tool execution**, and one only needs the **static** scan. Only the genuinely
multi-turn tests are backlog. Net: **26 of 31 tests are runnable without a live session.**

## 1. `static_connection` — 24 tests (no execution, no source)

Run entirely from a discovery scan + the model dataset. This is the heatmap MVP.

**Server (9):** `server.toolCount.hardCap`, `server.toolCount.practical`, `server.toolCount.contextDerived`,
`server.footprint.windowShare`, `server.payload.requestSize`, `server.client.totalToolCap`,
`server.toolNames.unique`, `server.toolNames.namespacedLength`, `server.primitives.resourcesPrompts`.

**Environment / aggregate (3):** `env.toolCount.aggregateCap`, `env.footprint.aggregateWindowShare`,
`env.payload.aggregateRequestSize` — these **sum across all connected servers** and need the scans of
each server in the environment (still no execution, no source). They are the checks that actually gate
the 128/512/10k aggregate caps.

**Tool (11):** `tool.name.length`, `tool.name.pattern`, `tool.description.present`,
`tool.description.length`, `tool.description.tokenBudget`, `tool.schema.present`,
`tool.schema.propertyCount`, `tool.schema.nestingDepth`, `tool.schema.unsupportedKeywords`,
`tool.schema.enumSize`, `tool.definition.tokenSize`.

**Session-subject but static (1):** `session.cache.prefixEligibility` — the *eligibility* check
(is the tool+system prefix ≥ the model's min cacheable tokens?) is pure arithmetic on the scan; only
the realized cache *savings* needs a live session.

> All of these consume data the scan already produces (`TokenBreakdown`, tool list) + `all-models.json`
> + `cross-cutting-limits.json`. Zero side effects on the target server.

## 2. `single_tool_exec` — 2 tests (one `tools/call`, isolated)

Need exactly one execution to observe a real response. The playground + runtime accounting already
provide the plumbing; these are safe to run on read-only tools (respect tool `annotations`).

- `session.toolResult.size` — measure one tool's actual result tokens/bytes vs the cap / window share.
- `session.toolCall.latencyVsTimeout` — measure one tool's execution latency vs the host timeout.

> Caution: executing a tool can have side effects. Gate on `readOnlyHint`/`destructiveHint`
> annotations and confirm before non-read-only calls (the safety boundary already noted in
> `roadmap/08-expanded-target.md`). These two tests should default to **read-only tools only**.

## 3. `live_session` — 5 tests (multi-turn) → BACKLOG

Only observable across a running, monitored session with the model in the loop. File these against
the live-session monitoring feature.

- `session.context.highWater` — peak cumulative tokens vs window across the session.
- `session.turn.toolCallCount` — tool-call cycles per turn vs the model/SDK loop cap.
- `session.turn.parallelCallCount` — parallel calls the model emits in a turn.
- `session.cost.perTask` — full-task cost from the observed token mix × pricing.
- `session.rate.tpmHeadroom` — sustained token rate vs the TPM tier.

## 4. Proposed design-quality tests, by mode

The 8 stubs from the `mcp-builder` gap analysis ([`04-…`](./04-mcp-builder-skill-gap-analysis.md)),
placed in the same taxonomy (not yet in the catalog — pending your go-ahead):

| Proposed test | Mode | Note |
|---|---|---|
| `tool.annotations.coherent` | static_connection | annotations are in the tool definition |
| `tool.naming.convention` | static_connection | service-prefixed, action-verb, snake_case |
| `tool.description.quality` | static_connection | heuristic on description text (examples/when-to-use) |
| `tool.pagination.supported` | static_connection | detects `limit`/`offset`/`cursor` in the schema |
| `tool.output.dualFormat` | static_connection | detects a `response_format`/detail param in the schema |
| `server.transport.stdioHygiene` | static_connection | stdout contamination shows up as protocol errors at connect — observable, no source |
| `tool.output.truncationGuard` | single_tool_exec | confirm a real response is actually capped/truncated |
| `session.task.successRate` | live_session | the `mcp-builder` agent eval harness (effectiveness) |

So adding them keeps the balance heavily static: **6 more static, 1 single-exec, 1 live.**

## 5. Out of automated scope — needs source code (not runnable in ANY mode)

Recorded in the catalog under `excluded_from_automation`. These are real concerns the `mcp-builder`
skill raises, but a black-box client cannot verify them — flag for **manual review**, don't fake a test:

- OAuth 2.1 / token-audience validation / no token pass-through.
- Input sanitization / injection / path-traversal prevention (can't be inferred from a schema).
- PII minimization / data-collection scope.
- DNS-rebinding protection / cert validation (only the HTTPS scheme is observable from config).
- Secrets hardcoded in code.
- "Workflow, not endpoints" design intent (subjective; best inferred from the live effectiveness eval).

## 6. Implementation phasing (driven by the modes)

1. **Phase 1 — `static_connection` (21 tests).** Build the engine on the existing scan + dataset;
   ship the **Tool × Model** and **Server × Model** heatmaps. No execution, no new monitoring. This
   is the whole MVP and the bulk of the value.
2. **Phase 2 — `single_tool_exec` (2 tests, +1 proposed).** Hang result-size and latency checks off
   the existing tool playground; read-only-gated. Small increment, reuses `tool_executions`.
3. **Phase 3 — `live_session` (5 tests, +1 proposed).** Backlog against the live-session monitoring;
   this is where the `mcp-builder` eval harness plugs in to produce real success-rate + cost-per-task.

Filter the catalog by `execution_mode` to scope each phase:
`tests.filter(t => t.execution_mode === "static_connection")`.
