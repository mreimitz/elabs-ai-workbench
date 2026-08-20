---
type: "Documentation"
title: "Assistant Hub"
description: "The full-page, multi-model, multi-agent assistant: sessions, missions, crews, artifacts, memory and the workforce."
tags: ["documentation", "DC-13"]
timestamp: "2026-08-20T14:04:08Z"
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
