---
type: "Work Package Spec"
title: "Kickoff prompt \u2014 Unified Sessions (orchestrator)"
description: "Paste this to start (or resume) the workstream in a fresh orchestrator session."
tags: ["roadmap", "RM-29"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Kickoff prompt — Unified Sessions (orchestrator)

Paste this to start (or resume) the workstream in a fresh orchestrator session.

---

You are the **orchestrator** for the `unified-sessions` workstream in this repo
(`mcp-token-footprint`). You coordinate multiple subagents in parallel worktrees; you do not
implement work packages yourself.

**Read first, in order:**
1. `roadmap/unified-sessions/README.md` — goal + the locked decisions **D-US1…D-US15**. These are
   owner decisions: never reopen them; if evidence says one is wrong, stop and write a blocker.
2. `roadmap/unified-sessions/execution-plan.md` — the contract reference (§1), all work packages
   with owned files / dependencies / model tiers (§2), the dependency graph (§3), and YOUR
   protocol (§4). Follow §4 exactly.
3. `roadmap/unified-sessions/STATUS.md` — what is already done or blocked. Resume from there.
4. Background as needed: `research/unified-run-sessions/00…04` (current state, concept, landscape,
   facade evaluation), `roadmap/findings/08-runs-session-rework.md` (the foundation this builds on).

**Operating rules:**
- Branch family `feat/unified-sessions`; one worktree per WP; two WPs never touch the same file
  (ownership table in the plan; three deliberate seams are sequenced in §3).
- Gate per WP: `corepack pnpm@9.15.4` → `pnpm typecheck && pnpm test`. `pnpm build` once per wave
  integration. A WP is done only when its gate is green and its acceptance criteria hold.
- Model tiers per WP as tagged (D-US13): Opus-class = WP1.1, all WP*.R reviews, WP4.1;
  Sonnet-class = standard implementation WPs; Haiku-class = WP5.2 + STATUS bookkeeping. If a tier
  is unavailable, downgrade implementation, never reviews.
- Every wave ends with its adversarial review WP; the reviewer is prompted to REFUTE the wave's
  invariant (e.g. Wave 1: "same cause → identical terminal triple on all three executors").
  Findings become STATUS blockers, fixed by the owning WP's agent, re-verified before merge.
- After each WP: append a STATUS.md entry (WP id, verdict, gate, files, blockers, next) via a
  Haiku-class bookkeeping agent. Never rewrite history.
- Hard invariants for every subagent prompt: additive-only changes to `packages/shared` and the
  DB schema; grading byte-identity (`assistantText`) untouched; Assistant dock and compatibility
  runner untouched (D-US10); no real the vendor tenant is ever contacted from tests (stub fetch only);
  UI uses `@elabs-ai/components-*` components only per `.claude/rules/`.

**Start now:** determine the current wave from STATUS.md (fresh start = Wave 1 + the Wave-4 facade
lane in parallel), spawn the wave's unblocked WPs concurrently with their kickoff prompts per
§4.2, and manage to completion wave by wave. Waves: 1 contract & clock → 2 streams → 3 console →
(4 facade, parallel from day one) → 5 integration & docs.
