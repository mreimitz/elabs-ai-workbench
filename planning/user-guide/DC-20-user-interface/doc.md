---
type: "Documentation"
title: "The application shell & interface standards"
description: "The one shell, one grammar and one set of interface standards every view in the workbench is built from."
tags: ["documentation", "DC-20"]
timestamp: "2026-08-20T14:04:08Z"
status: "current"
---

# The application shell & interface standards

## Subject

The one shell, one grammar and one set of interface standards every view in the workbench is built from.

## Scope

**In:** The page and tab shells, the status vocabulary, the modal tiers, the form kit, the table recipe, icon affordances, the route-versus-dialog rule and the dashboard.

**Out:** Any single feature's own screens, which live in that feature's subject.

## Where the code lives

- `apps/web/src/components/`
- `apps/web/src/lib/table.tsx`
- `apps/web/src/styles/`

## Delivered increments

### RM-04 — Assistant Hub UX — rebuild onto the app shell grammar

Completed 2026-08-20. Roadmap item: [RM-04](/Roadmap/completed/RM-04-assistant-hub-ux/item.md).

**Shipped:** The Assistant Hub now uses the app's own shell grammar rather than its own: a workspace with a meta rail carrying Progress, Outputs and Context, a session switcher in the toolbar and a first-prompt choreography; a sortable, filterable Sessions table at its own route; a workforce section with directory, org-chart and usage tabs, agent and crew profile modals, and per-tool scan-cost visibility in Access; memory scoped to profile, project, agent and crew; and a navigation cut from six items to four with redirects from the old ones. Five retired views were deleted rather than left behind.

**Planned vs delivered:** Two mid-flight blockers changed the delivery: the reduced-motion path had hidden the greeting and starter chips on a fresh session, and memory was being injected globally with no scope filter — both were fixed inside the workstream rather than deferred. The end-to-end flows run green individually in a real browser but full-suite ordering was left to continuous integration.

**Known gaps:** The rendered both-theme visual walk was written as a script but never run, and the live walk needs a provider key, a registered MCP server, at least two crews and real spend. The merge of the feature branch into main is the owner's.

**Where the code lives:**

- `apps/web/src/features/hub/`
- `e2e/smoke.spec.ts`

### RM-15 — Interface Craft — write the six rules that were never written

Completed 2026-08-20. Roadmap item: [RM-15](/Roadmap/completed/RM-15-interface-craft/item.md).

**Shipped:** The six interface rules that had only ever been habits are now written, applied and asserted: every on-fill colour pair meets AA contrast, the semantic tokens are split so success no longer reads as the brand colour and the focus ring no longer reads as info, one delta convention, shell landmarks with a skip link and a single main element, semantic section headings, field errors associated with their inputs, one notification timing and one error voice, prose measure caps, truncation recovery and a single card elevation. Six CI guardrails and two edit-time hooks keep them from drifting.

**Planned vs delivered:** The acceptance re-run surfaced three new issues that had not been findings in the original review, so an unplanned work package 4.3 was added to fix them — a scan-not-found dead end, a toast colour regression and a low-contrast chip.

**Known gaps:** The work sits on the ui/interface-craft branch; the merge to main is the owner's. Residuals were listed honestly rather than fixed: data-gated live geometry, screen-reader announcements, the toast red-plate nuance and pre-existing follow-ups.

**Where the code lives:**

- `apps/web/src/guardrails/`
- `apps/web/src/styles/app.css`
- `apps/web/src/lib/delta.ts`

### RM-28 — Toolbar Reach — apply the standards already locked

Completed 2026-08-20. Roadmap item: [RM-28](/Roadmap/completed/RM-28-toolbar-reach/item.md).

**Shipped:** The toolbar standard the app had locked but never finished applying is now applied everywhere: one ViewToolbar contract (the competing TableToolbar and PageHeader components were deleted), one icon affordance — an IconButton whose tooltip and accessible name come from a single label, applied to roughly 129 controls — breadcrumb section labels, a scans list-first layout, a restored Settings theme control, off-navigation features surfaced as peer tabs and sections rather than new navigation items, and three real defects fixed. Four CI guardrails plus an edit-time hook stop the standard drifting again, and the route-versus-dialog rule was written down.

**Planned vs delivered:** Work package 4.4 applied the audit's D-5 theme-control finding directly and so superseded the originally planned 6.7. Three findings the auditor retracted during verification were deliberately not fixed. One project-manager touch-up outside a work package was needed to thread the lifted theme preference into the settings dialog.

**Known gaps:** Everything landed on the ui/toolbar-reach branch; main was never touched and nothing was pushed, so the merge is still the owner's. The measured acceptance walk covered layout geometry in both themes, but the run-console visuals, content-bearing rows, the live theme switch and icon hover at scale need a provider key and seeded data and were not verified. A carried-forward hazard remains: a modal that auto-focuses an IconButton opens its tooltip, which swallows the first Escape.

**Where the code lives:**

- `apps/web/src/components/IconButton.tsx`
- `apps/web/src/components/ViewToolbar.tsx`
- `.claude/rules/routes-vs-dialogs.md`
