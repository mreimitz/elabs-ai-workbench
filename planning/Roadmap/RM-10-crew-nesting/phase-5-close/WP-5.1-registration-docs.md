---
type: "Work Package Spec"
title: "WP 5.1 \u2014 CLAUDE.md registration + user guide + owner-acceptance seeding"
description: "Phase: 5 \u2014 Hardening & close \u00b7 Size: S \u00b7 Depends on: 5.R \u00b7 Model: Haiku"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.1 — `CLAUDE.md` registration + user guide + owner-acceptance seeding

**Phase:** 5 — Hardening & close · **Size:** S · **Depends on:** 5.R · **Model:** Haiku

## Objective

Register the crew-nesting plan in the project's north star and living documentation. Add the `STATUS.md` ledger to the root `CLAUDE.md` single-source-of-truth bullet list, add a north-star capability table row describing hierarchical/nested-crew execution, author a user guide (`user-guide/17-crew-nesting.md`) that explains how to create and author nested crews, describes the depth/budget caps and their defaults, and documents the execution trace model, and seed the STATUS.md **Owner acceptance** section with the concrete walks and live-app checks an owner must verify (live nested missions ≥2 levels, both-theme + keyboard walks, budget-exhaustion traces, cycle-rejection UX, transitive grant intersection).

## Why / references

This WP closes the crew-nesting plan by making the feature discoverable in the roadmap table and providing operators a working reference for nesting syntax, constraints, and observability. It implements D-CN2 (nested crews run as sub-missions with their own topology), D-CN3 (budget cascade), D-CN4 (cycle + depth guards), D-CN7 (event-sourced replay shows tree structure), and D-CN8 (UI branches on crew/agent kind). The user guide and owner-acceptance section ground the plan's contracts in real usage and validation.

- `README.md:21–43` (`../../roadmap/crew-nesting/README.md`) — the D-CN9 frozen scope and the plan's north-star framing.
- `README.md:172–180` (`../../roadmap/crew-nesting/README.md`) — owner-acceptance definition: live nested missions ≥ 2 levels, both-theme/keyboard walks, budget-exhaustion mid-tree, cycle-reject UX.
- `.claude/rules/assistant-operability.md` (`../../.claude/rules/assistant-operability.md`) — the CLAUDE.md registration pattern (manifest entry + SoT list).

## Design

1. **CLAUDE.md north-star row:** Add a new capability table row (after assistant-operability, before platform) with title "**Hierarchical crews — runtime-recursive saved-crew composition**" (or similar), status "✅ Built", and a link to `roadmap/crew-nesting/STATUS.md` (`./STATUS.md`). The row should note the key features: deterministic crew recursion bounded by `HUB_MISSION_MAX_DEPTH`, monotone budget cascade, cycle + depth guards at author and run time, event-sourced replay of the tree, and that the security boundary (D-CN9) is untouched.
2. **CLAUDE.md SoT list:** Add ``roadmap/crew-nesting/STATUS.md`` to the bullet list on line 24–43 (the "single source of truth for in-flight status" block), maintaining alphabetical order within the list.
3. **User guide `user-guide/17-crew-nesting.md`:** A ~500–800 word operator-grade doc (matching the style of `16-assistant-hub.md`) covering:
   - Opening paragraph: what nested crews are (saved-crew references, sub-mission execution, own topology per level).
   - "How to author a nested crew": reference the crew editor's new sub-crew add path (from WP 4.1), the cycle warning, the member kind disambiguation (agentId vs crewId), depth visual cues, and the max-depth check ("if you see a validation error, the nesting is too deep").
   - "Budget cascade + cost prediction": explain that child allocations are `min(requested, parentRemaining)`, costs roll up to the root, a parent-budget trip aborts in-flight children, and the additive `GET /api/estimate/run-plan` preview shows aggregate cost before launch.
   - "Execution & traces": describe how a mission board drill into a nested sub-mission opens a transient dialog (not a route), how the trace shows per-level cost/timing, and how a replay reconstructs the tree from events (R-SES1).
   - "Constraints & defaults": `HUB_MISSION_MAX_DEPTH` (default 2), `HUB_MISSION_MAX_TOTAL_AGENTS` (default 24), and how setting `MAX_DEPTH=1` disables nesting (the pre-crew-nesting behaviour).
   - "Troubleshooting": cycle detection, over-depth errors, and reading budget-exhaustion signals in the console.
4. **STATUS.md owner-acceptance section:** Pre-populate a detailed checklist of walks that require a live running app + provider credentials:
   - [ ] A nested mission (≥2 levels, e.g. COO → {Strategy (root agents), Intelligence → {Data Analyst, BI sub-crew}}) runs in both themes and is observable on the mission board as a tree.
   - [ ] Keyboard navigation (arrow keys, Tab, Enter) works on the org rail nested tree and mission-board nested drill.
   - [ ] Budget cascade: a root allocation of $5 splits correctly to child levels; a child budget trip mid-tree aborts in-flight siblings + reports accurately.
   - [ ] Cycle rejection: saving a crew with a crewId member that transitively reaches itself shows a clear error (author time); attempting to run such a crew (if the graph mutated) also rejects at run time.
   - [ ] Depth rejection: authoring a crew ≥ `HUB_MISSION_MAX_DEPTH+1` levels deep is rejected with a user-facing message.
   - [ ] Transitive grant intersection: a child crew with an `@read` Access on a server inside a parent with `@admin` access shows the child's `@read` intersection (not `@admin`), and the security model holds on full tree traversal.
   - [ ] The run report (JSON + Markdown) renders the hierarchical trace with per-level cost attribution.

## Files
- `CLAUDE.md` *(modify)* — add crew-nesting to the SoT bullet list (line ~24–43) and add a north-star capability row (in the current-state table, after assistant-operability).
- `user-guide/17-crew-nesting.md` *(create)* — operator guide to authoring and running nested crews.
- `roadmap/crew-nesting/STATUS.md` *(modify)* — populate the **Owner acceptance** section with the detailed checklist items and the `— accepted: ____` sign-off blanks.

## Acceptance
- [ ] CLAUDE.md SoT list includes the crew-nesting STATUS.md link in the correct alphabetical position.
- [ ] CLAUDE.md north-star table row added with accurate title, link, and feature summary (recursion, budget cascade, guards, event-sourced, frozen scope).
- [ ] `user-guide/17-crew-nesting.md` exists, is readable, covers authoring/constraints/execution/traces/troubleshooting, and matches the style/tone of `16-assistant-hub.md`.
- [ ] STATUS.md **Owner acceptance** section is seeded with 7+ concrete, verifiable checklist items (live app, both themes, keyboard, budget, cycle/depth guards, grants, reporting).
- [ ] All three files are correctly committed to the crew-nesting branch.
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes

This is a **docs + registration WP**, not a code change. It touches no contested hot files (`orchestrator.ts`, `topologies.ts`, `packages/shared`, etc.); can run solo or as part of a later batch. The WP validates that the shipped code (5.R-reviewed) is correctly registered in user-facing project docs and that owner-acceptance walks are clearly itemized for the owner to verify post-merge.
