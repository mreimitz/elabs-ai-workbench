---
type: "Roadmap Item"
title: "Testing — the agent run engine and console"
description: "Drive MCP servers through a real LLM agent loop and measure it: token and context accounting, guardrails and pricing, full run persistence and replay, streaming and run control, the web console, and MCP-by-model compatibility."
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Testing — the agent run engine and console

## Goal

Drive MCP servers through a real LLM agent loop and measure it: token and context accounting, guardrails and pricing, full run persistence and replay, streaming and run control, the web console, and MCP-by-model compatibility.

## Why it matters

Static definition footprint says nothing about what a server costs or breaks once a model actually calls it.

## Milestones

- [ ] Phases 0-2 — the run engine, accounting, persistence and the API.
- [ ] Phase 3 — the web run console.
- [ ] Phase 4 — hardening, export and packaging.
- [ ] Phase 5 — MCP-by-model compatibility.

## Linked research

- [RS-11](/Research/RS-11-testing-ui-concept/topic.md)
- [RS-01](/Research/RS-01-token-context-comparison/topic.md)

## Plan overview (from the original plan README)

This folder is the **executable implementation plan** for the Testing feature: a live, locked,
instrumented agent-run harness on top of the MCP Token Footprint app. It expands the high-level plan
into one **self-contained spec per work package (WP)**, detailed enough for a coding agent (or a
human) to implement a single WP without needing the rest of the conversation.

## Read these first (in order)

1. [`../09-testing.md`](./09-testing-scope.md) — **scope**: the 16 locked product decisions.
2. [`../10-testing-ui-concept.md`](../../Research/RS-11-testing-ui-concept/notes/testing-ui-concept.md) — **UI concept**: wireframes
   + `@elabs-ai/components-*` component mapping. Phase 3 WPs reference its sections directly.
3. [`conventions.md`](./conventions.md) — **shared rules** every WP assumes (repo patterns,
   contract-first flow, security boundary, definition of done, how to work a WP). Each WP file stays
   focused by relying on this.
4. [`references.md`](./references.md) — **all external sources** (research + authoritative docs) and
   the internal cross-reference map. WP files cite these by name.

## How a coding agent should use this folder

For any WP: open its file → read the **Prerequisites** and the **References** it points to (scope
decision + UI section + external docs) → follow **Design** and **Implementation steps** → satisfy
**Acceptance** → run the gate in [`conventions.md`](./conventions.md) → self-review honestly. Do
**not** start a WP whose prerequisites are unmet.

## Work-package index

Each WP is `WP-<phase>.<n>`. Size: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ ≥1 week (relative).

### Phase 0 — Foundations (`phase-0-foundations/`)
| WP | Goal | Size | Depends |
| -- | ---- | ---- | ------- |
| [0.1](./phase-0-foundations/WP-0.1-vendor-brand-charts.md) | Vendor `@elabs-ai/components-charts` (owner-confirmed) | S | — |
| [0.2](./phase-0-foundations/WP-0.2-backend-dependencies.md) | Add AI SDK + provider adapters | S | — |
| [0.3](./phase-0-foundations/WP-0.3-shared-contract.md) | Shared types + zod + constants | M | — |
| [0.4](./phase-0-foundations/WP-0.4-database-schema.md) | New SQLite tables + row mappers | M | 0.3 |

### Phase 1 — Run engine, headless (`phase-1-run-engine/`)
| WP | Goal | Size | Depends |
| -- | ---- | ---- | ------- |
| [1.1](./phase-1-run-engine/WP-1.1-provider-credentials.md) | Encrypted provider credentials | M | 0.3, 0.4 |
| [1.2](./phase-1-run-engine/WP-1.2-persistent-mcp-session.md) | Persistent MCP session | M | — |
| [1.3](./phase-1-run-engine/WP-1.3-agent-loop-tool-bridge.md) | Agent loop + MCP tool bridge (Anthropic) | L | 1.1, 1.2, 0.3 |
| [1.4](./phase-1-run-engine/WP-1.4-token-context-accounting.md) | Token + context accounting | L | 1.3 |
| [1.5](./phase-1-run-engine/WP-1.5-guardrails-pricing.md) | Guardrails + pricing | M | 1.4 |
| [1.6](./phase-1-run-engine/WP-1.6-run-persistence.md) | Run persistence (full replay) | M | 1.4 |

### Phase 2 — Scenarios/Tests, streaming, providers (`phase-2-api/`)
| WP | Goal | Size | Depends |
| -- | ---- | ---- | ------- |
| [2.1](./phase-2-api/WP-2.1-scenario-test-crud.md) | Scenario & Test CRUD + attachments | L | 0.3, 0.4 |
| [2.2](./phase-2-api/WP-2.2-sse-streaming-run-control.md) | SSE streaming + run control | L | 1.3, 1.6, 2.1 |
| [2.3](./phase-2-api/WP-2.3-providers-escape-hatch.md) | OpenAI/Google/local/Ollama + native hook | M | 1.4 |
| [2.4](./phase-2-api/WP-2.4-api-test-suite.md) | API test suite | M | 2.2, 2.3 |

### Phase 3 — Web UI (`phase-3-web-ui/`)
| WP | Goal | Size | Depends |
| -- | ---- | ---- | ------- |
| [3.1](./phase-3-web-ui/WP-3.1-nav-client-sse.md) | Nav + view group + SSE client | M | 2.2 |
| [3.2](./phase-3-web-ui/WP-3.2-scenarios-tests-ui.md) | Scenarios & Tests authoring UI | L | 3.1, 2.1, 1.1 |
| [3.3](./phase-3-web-ui/WP-3.3-run-console-shell.md) | Run console shell + lifecycle | L | 3.1, 2.2 |
| [3.4](./phase-3-web-ui/WP-3.4-conversation-pane.md) | Conversation pane | M | 3.3 |
| [3.5](./phase-3-web-ui/WP-3.5-kpi-rail-context-chart.md) | KPI rail + context chart | L | 3.3, 0.1 |
| [3.6](./phase-3-web-ui/WP-3.6-step-log-packet-inspector.md) | Step log + packet inspector | L | 3.4, 3.5 |
| [3.7](./phase-3-web-ui/WP-3.7-replay.md) | Replay scrubber | M | 3.6 |
| [3.8](./phase-3-web-ui/WP-3.8-compare-matrix.md) | Compare (test × scenario) | M | 3.6, 2.2 |

### Phase 4 — Hardening & rollout (`phase-4-hardening/`)
| WP | Goal | Size | Depends |
| -- | ---- | ---- | ------- |
| [4.1](./phase-4-hardening/WP-4.1-theming-a11y.md) | Six-theme + a11y pass | M | Phase 3 |
| [4.2](./phase-4-hardening/WP-4.2-run-report-export.md) | Run report export | S | 1.6 |
| [4.3](./phase-4-hardening/WP-4.3-config-docs-docker.md) | Config, docs, Docker | S | Phase 0–2 |
| [4.4](./phase-4-hardening/WP-4.4-end-to-end-verification.md) | End-to-end verification | M | all |

## Dependency graph (abridged)

```
0.3 ─┬─ 0.4 ─┬─ 1.1 ─┐
     │       │       ├─ 1.3 ─ 1.4 ─┬─ 1.5
0.2 ─┘       └─ 1.2 ─┘             ├─ 1.6
                                   └─ 2.3
0.3 ─ 2.1 ─┐
1.3,1.6,2.1 ─ 2.2 ─ 2.4
0.1 ─────────────── 3.5
2.2 ─ 3.1 ─ 3.3 ─ 3.4 ─ 3.6 ─┬─ 3.7
                3.5 ─────────┘  └─ 3.8
Phase 3 ─ 4.1     1.6 ─ 4.2     all ─ 4.4
```

## Recommended build order — vertical slice first

Don't build phase-by-phase end to end. Prove the hardest integration (AI SDK ↔ MCP ↔ measurement ↔
SSE ↔ chart) with a thin slice, then go wide:

1. **WP 0.1–0.4** (foundations).
2. **WP 1.1–1.4 Anthropic-only**, minimal **2.1** (one scenario/test, no attachments), **2.2** (SSE).
3. **WP 3.1, 3.3, 3.5** — a single automated Anthropic run rendering live counters + the context
   chart. **This is the first demoable milestone.**
4. Then breadth: 1.5/1.6, 3.4/3.6 (inspector), 2.3 (providers), 2.4 (tests), 3.2 (authoring),
   3.7 (replay), 3.8 (compare), Phase 4.

## New API surface (additive, versionless `/api/*`)

```
GET/POST  /api/providers            PUT/DELETE /api/providers/:id
GET/POST  /api/scenarios            PUT/DELETE /api/scenarios/:id
GET/POST  /api/tests                PUT/DELETE /api/tests/:id
POST      /api/tests/:id/attachments
POST      /api/runs                 # {testId,scenarioId,mode} -> {runId,streamUrl}
GET(SSE)  /api/runs/:id/stream
POST      /api/runs/:id/turns       POST /api/runs/:id/stop
GET       /api/runs                 GET  /api/runs/:id
GET       /api/runs/compare?ids=…
```

## Owner actions that gate the start

1. Supply the `brand-charts-1.0.0` release tarball (WP 0.1).
2. Approve adding `ai` + `@ai-sdk/*` to the API (caret ranges, per repo convention) (WP 0.2).
3. Confirm a provider API key exists for the first vertical slice (Anthropic).

## Status & execution

Live state is tracked in [`STATUS.md`](./STATUS.md) — the per-WP ledger. Nothing is implemented yet
(every WP open); **0.1** and **0.2** are owner-gated (see above).

Drive the build with **`/next-wp testing`**: it reads `STATUS.md`, picks the next open,
dependency-unblocked WPs, runs up to 4 in parallel **git-worktree sub-agents**, validates each against
the WP's Acceptance + the quality gate, and ticks it off (or sends the agent back to refine). The
command lives at `.claude/commands/next-wp.md`.

`roadmap/11-testing-implementation-plan.md` is the one-page summary; **this folder supersedes it** for
execution detail.
