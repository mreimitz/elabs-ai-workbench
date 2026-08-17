# hub-fixes — Assistant Hub defect-fix workstream (master index)

Fixes the six verified root causes from the 2026-07-19 diagnosis of the Assistant Hub
([`analysis.md`](./analysis.md), evidence: full source read + live inspection of session
`oNiw1PCAmxc5_ietGD_0h` on the running instance). Runnable by the `next-wp` skill
(`/next-wp hub-fixes`). Ledger: [`STATUS.md`](./STATUS.md) · shared rules:
[`conventions.md`](./conventions.md) · orchestrator prompt: [`kickoff-prompt.md`](./kickoff-prompt.md).

## What this workstream delivers

1. MCP tools become genuinely callable in every hub session (RC1) and honestly displayed/scoped (RC3).
2. Mission subagents become real tool-using sessions with inherited grants, live transcripts, and real costs (RC2).
3. Answers render markdown + inline citation chips together, and the synthesis can use the GenUI components (RC4).
4. The mission board tells the truth about topology execution and gains the grid, the expand modal, and the per-agent live panel (RC6).
5. A grantable web capability exists (RC5), and sessions can route chat vs mission with a clarify step (RC7).

## Decisions (adopted 2026-07-19, owner planning session — revisit only before the affected WP starts)

| ID | Decision | Adopted default | Affects |
|---|---|---|---|
| D-HF1 | Tool-loading default + promotion | Default flips to `auto` (eager when the granted catalog fits `HUB_TOOL_EAGER_MAX_TOKENS`, else deferred). Deferred mode gets a real promotion path: `tool_search` hits become callable in later steps of the same turn. | WP 1.1, 1.4, 5.1 |
| D-HF2 | Native web search (revises D-AH10) | Yes: `web.search` / `web.fetch` built-ins backed by provider-native tools, grantable per session and per agent. MCP research servers stay first-class. | WP 5.1, 5.2 |
| D-HF3 | Debate semantics | Round-based debate becomes the default: parallel opening statements, then a rebuttal round with cross-visibility, then synthesis as resolver. | WP 4.4 (graph: 4.1) |
| D-HF4 | Synthesis path | Mission synthesis runs as a real turn of the parent session with GenUI tools available; `generateText` stays as fallback. | WP 3.2 |
| D-HF5 | Child grant inheritance | Effective child grants = plan grants ∩ parent session scope; an auto (unscoped) parent passes plan grants through unchanged. | WP 2.1, 2.3 |
| D-HF6 | HITL inside missions | Mission autonomy governs tool approval: `always_ask` queues every gated call to the board; `threshold`/`auto` gate destructive calls only (annotations can only tighten). | WP 2.5 |
| D-HF7 | Rollback seam for the agent runner | `HUB_AGENT_RUNNER=session|structured` env, default `session`; the old one-shot runner stays available one release. | WP 2.1 |

## Root causes → phases (details in [`analysis.md`](./analysis.md))

| RC | One-line cause | Fixed by |
|---|---|---|
| RC1 | Deferred loading default + zero promotion ⇒ no MCP tool ever callable (`registry.ts:69-71`, `tool-search.ts:8-11`, live `resident: []`) | Phase 1 (WP 1.1, 1.4) |
| RC2 | Agent runner is a tool-less one-shot `generateObject`; child sessions created scope-less; planner never sees the server catalog (`orchestrator.ts:381-391`, `:723-741`, `planner.ts:75-100`) | Phase 2 |
| RC3 | Context rail ignores `toolScope` (`routes.ts:1428-1462`); scope write-once; silent connection-failure grant drops (`index.ts:379-427`) | Phase 1 (WP 1.2, 1.3) |
| RC4 | Citation weaving bypasses Streamdown (`ConversationPane.tsx:918-921`); synthesis is a tool-less `generateText` (`synthesis.ts:306-319`) | Phase 3 |
| RC5 | No web tool anywhere by D-AH10; provider-native search unused (`providers/registry.ts:125-150`) | Phase 5 |
| RC6 | Debate drawn as generic chain; org-chart contradicts board; no expand/live/grid (`topology-graph.ts:109-131`, `MissionBoard.tsx:294`) | Phase 4 |
| RC7 | Mode fixed at creation; no chat-vs-mission routing or clarify step (`orchestrator.ts:177`, `capabilities.ts:89`) | Phase 6 |

## WP index

| WP | Title | Size | Model | Depends on |
|---|---|---|---|---|
| 0.1 | Eager-mode mitigation + scoped-session runbook | S | Sonnet | — |
| 1.1 | Deferred-tool promotion + `auto` loading policy | L | Opus | — |
| 1.2 | Scope plumbing honesty (persist, PATCH, grant-aware rail, builtins) | M | Sonnet | — |
| 1.3 | MCP connection status surfacing (events, chips, retry) | M | Sonnet | 1.2 |
| 1.4 | Tools prompt-budget compression | S | Sonnet | 1.1 |
| 2.1 | Turn-engine agent runner (children = real sessions) | L | Opus | 1.1, 1.2 |
| 2.2 | Planner server catalog + plan-card grant editing + role warnings | M | Opus | 1.2 |
| 2.3 | Grant inheritance rule + plan validation | S | Sonnet | 2.1 |
| 2.4 | Mission cost/budget integrity | M | Sonnet | 2.1 |
| 2.5 | Mission HITL approval policy | M | Opus | 2.1 |
| 3.1 | Markdown + inline citation chips together | M | Sonnet | — |
| 3.2 | Synthesis through the turn engine with GenUI | M | Opus | 2.1 |
| 4.1 | Truthful topology graphs (board + org-chart unified) | M | Sonnet | — |
| 4.2 | Mission agent grid + detail box | S | Sonnet | — |
| 4.3 | Expand modal + per-agent live session panel | L | Opus | 2.1, 4.1, 4.2 |
| 4.4 | Round-based debate (parallel openings + rebuttals) | M | Opus | 2.1, 4.1 |
| 5.1 | `web.search` / `web.fetch` built-ins (provider-native) | L | Opus | 1.1 |
| 5.2 | Research-server onboarding surfacing | S | Sonnet | 2.2 |
| 6.1 | `auto` session mode + chat-vs-mission clarify card | L | Opus | 2.1, 3.1 |
| 6.2 | Composer mode/autonomy clarity | S | Sonnet | 6.1 |
| 7.R | Adversarial review + owner-acceptance walk assembly | M | Opus | all above |

## Suggested build order (the orchestrator recomputes from Files sections; cap 4 parallel)

1. **Batch 1:** 0.1 · 1.1 · 1.2 · 3.1 (file-disjoint; 1.1 owns the engine seams this batch).
2. **Batch 2:** 1.3 · 1.4 · 4.1 · 4.2.
3. **Batch 3:** 2.1 **solo** (touches `orchestrator.ts` + `session-service.ts` + e2e stubs; nothing else runs beside it).
4. **Batch 4:** 2.2 · 2.3 · 3.1-follow-ups if any.
5. **Batch 5:** 2.4 · 2.5 · 5.2.
6. **Batch 6:** 3.2 · 4.3.
7. **Batch 7:** 4.4 · 5.1.
8. **Batch 8:** 6.1, then 6.2 · 7.R.

## Seam files (one owner per batch; orchestrator sequences merges)

- `apps/api/src/hub/turn-engine.ts` — 1.1 · 2.5 · 6.1
- `apps/api/src/hub/session-service.ts` — 1.1 · 2.1 · 3.2
- `apps/api/src/hub/missions/orchestrator.ts` — 2.1 · 2.3 · 2.4 · 2.5 · 3.2 · 4.4 · 6.1
- `apps/api/src/index.ts` (hub wiring block only) — 1.2 · 1.3
- `apps/web/src/features/hub/ConversationPane.tsx` — 3.1 · 6.1
- `apps/web/src/features/hub/MissionBoard.tsx` — 4.2 · 4.3 (4.1 must NOT touch it; its legend lives inside `TopologyGraph.tsx`)
- `packages/shared/src/{types,schemas}.ts` — additive only, every WP; first merger in a batch wins, others rebase.

## Out of scope

Team-server auth, provider additions, dock assistant changes (except none), re-opening shipped
assistant-hub decisions other than the explicit D-AH10 revision (D-HF2). No new runtime dependencies
without a decision note in this README.

## Owner-acceptance (live checks the gate cannot prove; assembled by WP 7.R)

- A scoped session calls a real `acme-demo` tool end-to-end (RC1/RC3 fix proof).
- A mission agent calls a real MCP tool and its live transcript streams in the expand modal.
- Both-theme (`light`/`dark`) walk of: rail Tools section, mission board grid, expand modal, clarify card.
- `web.search` behind a real provider key on at least one provider.
