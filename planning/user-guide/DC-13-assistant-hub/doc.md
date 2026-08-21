---
type: "Documentation"
title: "Assistant Hub"
description: "The full-page, multi-model, multi-agent assistant: sessions, missions, crews, artifacts, memory and the workforce."
tags: ["documentation", "DC-13"]
timestamp: "2026-08-21T15:32:17Z"
status: "current"
---

# Assistant Hub

## Subject

The full-page, multi-model, multi-agent assistant: sessions, missions, crews, artifacts, memory and the workforce.

## Scope

**In:** Session modes, the mission harness, agents and crews including nesting, generative UI, artifacts, memory, projects and the audit timeline.

**Out:** The page-operating dock, which is its own subject.

## Where the code lives

- `apps/api/src/hub/`
- `apps/web/src/features/hub/`

## Delivered increments

### RM-04 — Assistant Hub UX — rebuild onto the app shell grammar

Completed 2026-08-20. Roadmap item: [RM-04](/Roadmap/completed/RM-04-assistant-hub-ux/item.md).

**Shipped:** The Assistant Hub now uses the app's own shell grammar rather than its own: a workspace with a meta rail carrying Progress, Outputs and Context, a session switcher in the toolbar and a first-prompt choreography; a sortable, filterable Sessions table at its own route; a workforce section with directory, org-chart and usage tabs, agent and crew profile modals, and per-tool scan-cost visibility in Access; memory scoped to profile, project, agent and crew; and a navigation cut from six items to four with redirects from the old ones. Five retired views were deleted rather than left behind.

**Planned vs delivered:** Two mid-flight blockers changed the delivery: the reduced-motion path had hidden the greeting and starter chips on a fresh session, and memory was being injected globally with no scope filter — both were fixed inside the workstream rather than deferred. The end-to-end flows run green individually in a real browser but full-suite ordering was left to continuous integration.

**Known gaps:** The rendered both-theme visual walk was written as a script but never run, and the live walk needs a provider key, a registered MCP server, at least two crews and real spend. The merge of the feature branch into main is the owner's.

**Where the code lives:**

- `apps/web/src/features/hub/`
- `e2e/smoke.spec.ts`

### RM-13 — Assistant Hub defect-fix workstream

Completed 2026-08-21. Roadmap item: [RM-13](/Roadmap/completed/RM-13-hub-fixes/item.md).

**Shipped:** The six verified root causes from the Assistant Hub diagnosis (analysis.md RC1-RC7), fixed across 21 work packages in seven phases. The headline defect: mission subagents could not actually call tools, so missions produced confident output from no evidence. Phase 1 made MCP true in main sessions - deferred-tool promotion plus an 'auto' loading policy so deferred MCP tools are built into the callable map and gated natively via ai@7 prepareStep/activeTools, scope plumbing made honest (persisted, PATCH-able, grant-aware rail), MCP connection status surfaced as events plus chips plus retry, and a tools prompt-budget compression pass. Phase 2 turned mission agents into REAL child hub sessions created with toolScope from the plan's tool grants and run through the turn engine, with a planner server catalog and least-privilege plan-card grant editing, a pure effectiveAgentGrants = plan grants intersect parent scope inheritance rule (D-HF5), real per-agent cost and token rollup, and a mission HITL approval policy (D-HF6). Phase 3 fixed rendering (markdown and inline citation chips together; synthesis through the turn engine with GenUI). Phase 4 rebuilt the mission board (truthful topology graphs, agent grid plus detail box, expand modal with per-agent live session panels, and round-based debate where round 1 runs all debaters in parallel on the bare brief). Phase 5 added provider-native web.search and web.fetch built-ins (D-HF2, revising D-AH10). Phase 6 added an 'auto' session mode routing chat-vs-mission per message. Phase 7 (WP 7.R) was an adversarial review that probed all seven invariants with forged plan JSON, hostile tool_search queries and an SSRF probe.

**Planned vs delivered:** D-HF2 revised the earlier D-AH10 decision: web.search and web.fetch became provider-native built-ins per provider kind rather than the originally planned approach. D-HF3 made debate round-based (parallel openings, then rebuttals) instead of sequential. D-HF4 routed synthesis through the turn engine. WP 2.1 had to run solo rather than in parallel because it rewrote the mission agent runner that other work packages depended on.

**Known gaps:** THE OWNER-ACCEPTANCE WALK WAS NEVER RUN. WP 7.R assembled owner-acceptance-walk.md as the one honest live checklist - 28 items with exact click-paths and expected outcomes, covering everything the gate could not prove: a live scoped-session vendor tool call, a live mission agent MCP call with a streaming transcript, a real failing-MCP path end-to-end, a real mission with a real provider key and a live MCP server proving real cost and budget enforcement, web.search behind a real provider key, and the full both-theme plus keyboard walk. Every one of those 28 boxes is still unticked, and the file states plainly: 'Nothing below is verified.' The gate proves engine behaviour against stubs and fakes only. This item was retired on 2026-08-21 by RM-35 WP 0.3 on the owner's written instruction, with its STATUS.md ledger clean; the unrun walk travels with it to Roadmap/completed/RM-13-hub-fixes/owner-acceptance-walk.md and remains the outstanding live verification. Separately, the WP4.4/4.1 hub-UI Playwright tests were recorded as flaky or broken on the local macOS box (pre-existing, verified against the pre-2.1 baseline).

**Where the code lives:**

- `apps/api/src/hub/ (tools/grants.ts, approval-policy.ts, session-service.ts, missions/) and apps/web/src/features/hub/`
