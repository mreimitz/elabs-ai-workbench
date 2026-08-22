# UX Overhaul — one shell, one grammar, every view

## Concepts

* [Compare Workspace — layout & design audit + redesign concept](compare-redesign-2026-07-11.md) - 2026-07-11 · Audited live at http://localhost:8080/testing/runs/compare?ids=…&mode=flow|summary|metrics
* [Handover prompt — Compare Workspace redesign (paste verbatim to the orchestrating agent)](compare-redesign-handover-prompt.md) - You are the orchestrator for the Compare Workspace redesign in mcp-token-footprint. You run
* [UX-overhaul conventions — every sub-agent reads this before coding](conventions.md) - Layered ON TOP of ../testing/conventions.md (stack, gate,
* [UX Overhaul — one shell, one grammar, every view](item.md) - Turn the full UI/UX audit into one page shell, one tab shell, one status vocabulary, one modal system, one form kit and one table recipe applied to every view, and rebuild the Compare workspace on top of them.
* [Kickoff prompt — paste this to the PM agent (Opus 4.8) to run the UX overhaul end-to-end](kickoff-prompt.md) - You are the Project Manager agent for the UX-overhaul program of this repo
* [Orchestration playbook — for the PM agent (Opus 4.8) ONLY](orchestration.md) - You are the project manager for the UX-overhaul program. You do not write feature code yourself;
* [Phase 0 — P0 hotfixes (5 WPs, all parallel, all small)](phase-0-hotfixes.md) - Independent, surgical fixes for the audit's P0 breakages. No foundations required. Each WP is one
* [Phase 1 — Foundations (the critical path; everything in Phase 2+ builds on these)](phase-1-foundations.md) - Six WPs creating the shared shells/primitives in apps/web/src/components/ (+ lib/). These WPs
* [Phase 2 — View migrations (fan-out; every WP depends on ALL of Phase 1)](phase-2-view-migrations.md) - Each WP migrates one feature area onto the Phase-1 foundations AND fixes that area's per-view
* [Phase 3 — Workflow & cross-links (S20 + G-walkthrough fixes)](phase-3-workflows.md) - Turns destination-screens into journeys. Mostly web; two WPs add ADDITIVE API fields (contract
* [Phase 4 — Compare Workspace (audit §H, G13, T9) — pipeline](phase-4-compare-workspace.md) - Rebuilds /testing/runs/compare as the workspace specified in audit §H. Read §H IN FULL before
* [Phase 5 — Verification, regression sweep, owner acceptance (serial, last)](phase-5-acceptance.md) - Domain: read-only + .wp-evidence/5.1/ + test files only.
* [Phase 7 — Skill Studio (audit SI1–SI8 + §I) — the authoring rethink](phase-7-skill-studio.md) - Source: audit Skill IDE deep-dive (SI1–SI8) + I. Skill Studio (the spec — read it IN
* [UX Overhaul — work-package status ledger · PRIORITY: HIGH](STATUS.md) - Living state for the ux-overhaul plan (source: /UI-UX-AUDIT-2026-07-05.md).
* [Kickoff prompt — paste to the PM agent (Opus 4.8) to run the Toolbar-standard program](toolbar-kickoff-prompt.md) - You are the Project Manager agent for the Toolbar-standard program of this repo
* [One-row toolbar standard — audit & plan · 2026-07-11](toolbar-standard-2026-07-11.md) - Status: PLANNED (report only — owner decision 2026-07-11; no code changed yet).
* [UX Overhaul — Program-wide verification report (WP 5.1)](verification-report.md) - Branch: wp/ux/5.1 (forked from ux/integration; Phases 0–4 all merged)
* [WP 7.7 - components palette (draggable skill components + collapsible MCP Servers section)](wp-7.7-components-palette.md) - Phase 7 round 2 of the UX overhaul. Ledger: STATUS.md. Rebuilds ToolsPalette into a two-section Components palette so every skill component is created by drag-from-palette, and the MCP Servers section absorbs the binding chips.
* [WP 7.8 design — edge grammar + entry-point flows (for owner approval)](wp-7.8-edge-grammar-design.md) - The five decisions WP 7.8 needs signed off before any code is written: what a connection means, how an entry point's effective reading list is derived, what a refused connection says, where box positions live, and what this breaks.
* [WP 7.8 build - edge grammar + entry-point flows (five edge kinds, reachability flows with always/maybe-read token figures, guided connect refusals, app-side box positions)](wp-7.8-edge-grammar.md) - The build spec for WP 7.8, derived from the owner-approved design doc. Four ordered pieces: the edge kind on the wire and in the projector, reachability-derived entry-point flows with token figures, the connection grammar and its guidance, and per-skill box-position persistence with Auto-arrange.
