---
type: "Roadmap Item"
title: "UX Overhaul — one shell, one grammar, every view"
description: "Turn the full UI/UX audit into one page shell, one tab shell, one status vocabulary, one modal system, one form kit and one table recipe applied to every view, and rebuild the Compare workspace on top of them."
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# UX Overhaul — one shell, one grammar, every view

## Goal

Turn the full UI/UX audit into one page shell, one tab shell, one status vocabulary, one modal system, one form kit and one table recipe applied to every view, and rebuild the Compare workspace on top of them.

## Why it matters

Every view had grown its own layout, status wording and table behavior, so the app read as several products sharing a sidebar.

## Milestones

- [ ] Phase 0 — the shells and the scroll contract.
- [ ] Phase 1 — status, modals and forms.
- [ ] Phase 2 — tables and master-detail.
- [ ] Phase 3 — workflow cross-links.
- [ ] Phase 4 — the Compare workspace rebuild.
- [ ] Phase 5 — verification.

## Linked research

- [RS-11](/Research/RS-11-testing-ui-concept/topic.md)

## Plan overview (from the original plan README)

Turns the full UI/UX audit (**`/UI-UX-AUDIT-2026-07-05.md` (`../../UI-UX-AUDIT-2026-07-05.md`)** —
the single source for every finding ID referenced below: S1–S22, D/SV/SC/C/T/K/CP/ST, F-tables,
G-walkthroughs, §H) into an executable work-package program for a **PM agent (Opus 4.8)**
orchestrating parallel worktree sub-agents.

**Read order for any agent entering this plan:**
1. `/CLAUDE.md` + `.claude/rules/*` (repo law — brand-ui only, contract-first, quality gate)
2. [`../testing/conventions.md`](../RM-26-testing/conventions.md) (stack ground truth, API layering)
3. [`conventions.md`](./conventions.md) (UX-program-specific rules: verification, shells, domains)
4. [`orchestration.md`](./orchestration.md) (PM only: scheduling, worktrees, merge protocol)
5. [`STATUS.md`](./STATUS.md) (**authoritative ledger** — the only live state)
6. The phase file for your WP (`phase-*.md`) + the audit sections it cites

## Mission

One design system, one page shell, one tab shell, one scroll contract, one status vocabulary,
one form grammar — applied to every view — plus the workflow layer (cross-links, intent fixes)
and the rebuilt Compare Workspace (§H). The audit's acceptance tests are this program's
definition of done (see `conventions.md` §Acceptance).

## Phase map

| Phase | Theme | WPs | Mode |
|---|---|---|---|
| 0 | P0 hotfixes (independent, tiny) | 0.1–0.5 | fully parallel |
| 1 | Foundations: shell + primitives (the critical path) | 1.1–1.6 | 2 batches |
| 2 | View migrations onto the foundations (fan-out) | 2.1–2.10 | 3 batches |
| 3 | Workflow & cross-links (S20/G fixes) | 3.1–3.5 | mostly parallel |
| 4 | Compare Workspace (§H) | 4.1–4.6 | pipeline |
| 5 | Verification, regression sweep, owner acceptance | 5.1–5.2 | serial, last |
| 6 | Owner-acceptance remediation (defined in STATUS.md, 2026-07-06) | 6.1–6.7 | 6.1 keystone → rest |
| 7 | Skill Studio — authoring rethink (audit SI1–SI8 + §I, D-UX17) | 7.1–7.6 | 7.1 ∥ 7.2 → 7.3 → (7.4 ∥ 7.6) → 7.5 |

## Parallel execution map (PM: schedule exactly this unless the ledger says otherwise)

```
Batch A  (Phase 0):        0.1 ∥ 0.2 ∥ 0.3 ∥ 0.4 ∥ 0.5          (5 tiny agents, disjoint files)
Batch B  (Phase 1 core):   1.1 ∥ 1.2 ∥ 1.5 ∥ 1.6                 (foundations, disjoint domains)
Batch C  (Phase 1 rest):   1.3 ∥ 1.4                              (both depend on 1.2)
Batch D  (Phase 2 wave 1): 2.1 ∥ 2.2 ∥ 2.7 ∥ 2.9                  (disjoint feature folders)
Batch E  (Phase 2 wave 2): 2.3 ∥ 2.5 ∥ 2.8 ∥ 2.10                 (disjoint feature folders)
Batch F  (Phase 2 wave 3): 2.4 → 2.6                              (both touch features/testing shared
                                                                   files + RunLauncher — SERIALIZE)
Batch G  (Phase 3):        3.1 ∥ 3.2 ∥ 3.5   then   3.3 ∥ 3.4
Batch H  (Phase 4):        4.1 → (4.2 ∥ 4.3) → 4.4 → (4.5 ∥ 4.6)
Batch I  (Phase 5):        5.1 → 5.2
```

Rules that generated this map (PM re-derives if scope changes): a WP may run in parallel with
another **only if** their declared file domains are disjoint **and** neither depends on the other.
`App.tsx`, `packages/shared/*`, `apps/web/src/styles/app.css`, and `apps/web/src/components/*`
are **shared hot files** — see `orchestration.md` §Hot-file protocol.

## Locked decisions (D-UX log — full log lives in STATUS.md)

- **D-UX1 (owner, 2026-07-05):** "New skill from server" becomes the 4th source in the Add-skill
  modal; the standalone detail-header button is removed (audit K6).
- **D-UX2 (owner, 2026-07-05):** Trigger-collisions panel moves to the bottom of the skills LIST
  column as a status footer; removed from the detail pane (audit K7).
- **D-UX3 (owner, 2026-07-05):** Run-compare gets a restored visible entry point and is rebuilt
  per §G13/§H; suites become comparable.
- **D-UX4–D-UX10 (proposed by audit, PM confirms with owner at kickoff):** tab style = left
  pill tabs everywhere (S4) · card-vs-flat rule per S21#4 · modal tiers per S17 · scroll contract
  per S22 · status vocabulary table per conventions.md · diff colors green/red (C4) · radar chart
  removed (T9f).

## Out of scope (do NOT let sub-agents drift here)

New runtime dependencies (owner-gated), `@elabs-ai/components-*` version bumps, API breaking changes (additive
only), the roadmap/ci · security-posture · advisor · team-server programs, dark/bright theme
token redesign (we *consume* tokens; upstream token gaps get reported, not hacked), and anything
in `apps/api` beyond the explicitly-listed additive endpoints in Phase 3/4 WPs.
