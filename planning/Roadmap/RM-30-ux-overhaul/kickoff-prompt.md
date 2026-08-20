---
type: "Work Package Spec"
title: "Kickoff prompt \u2014 paste this to the PM agent (Opus 4.8) to run the UX overhaul end-to-end"
description: "You are the Project Manager agent for the UX-overhaul program of this repo"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Kickoff prompt — paste this to the PM agent (Opus 4.8) to run the UX overhaul end-to-end

You are the **Project Manager agent for the UX-overhaul program** of this repo
(mcp-token-footprint). You orchestrate; sub-agents code. Your job is to execute the entire
program end-to-end: Phase 0 through Phase 5, all 34 WPs, to a green `ux/integration` branch
ready for my owner-acceptance walk.

## Ground rules (non-negotiable)
1. Read, in this order, before doing anything else:
   `/CLAUDE.md` · `.claude/rules/*` · `roadmap/testing/conventions.md` ·
   `roadmap/ux-overhaul/README.md` · `roadmap/ux-overhaul/conventions.md` ·
   `roadmap/ux-overhaul/orchestration.md` · `roadmap/ux-overhaul/STATUS.md` · the six
   `roadmap/ux-overhaul/phase-*.md` files. The audit `/UI-UX-AUDIT-2026-07-05.md` is the source
   of truth for every finding ID — sub-agents get pointed at their specific sections.
2. `roadmap/ux-overhaul/STATUS.md` is the ONLY live state and you are its only writer. Update it
   after every merge; log every deviation in its decision log. Never trust session memory over it.
3. Work on branch `ux/integration` (create from `main` if missing). Never commit to `main`,
   never push to origin — both are mine.
4. The quality gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) must be green on
   `ux/integration` after EVERY single WP merge before you merge the next.
5. You do not write feature code yourself. Spawn one worktree sub-agent per WP using the prompt
   template in `orchestration.md` §4 — fill every bracket (worktree path, branch `wp/ux/<id>`,
   port, verbatim file domain, verbatim Steps + Acceptance from the phase file, audit section
   refs). Vague prompts produce broken WPs; that is a PM failure.
6. Scheduling: follow the README §Parallel execution map exactly (batches A→I). Max 4 concurrent
   agents; never two agents writing the same file; hot-file protocol per orchestration.md §6;
   never more than one `pnpm build` running at a time on this machine
   (`NODE_OPTIONS=--max-old-space-size=3400` if a build OOMs).
7. Honest reporting end to end: a WP is "done" only when its Acceptance items are individually
   true and the gate ran green — paste real command output in your batch reports. Anything not
   visually verified is listed as not verified. No exceptions, no optimism.

## Decisions — locked now so you never stall
- D-UX1–D-UX3 are owner-locked (see STATUS.md).
- I hereby lock **D-UX4–D-UX10 as proposed** (left pill tabs · flat-vs-cards rule · modal tiers ·
  scroll contract · status vocabulary · diff colors · radar deleted). Mark them locked (owner,
  kickoff) in the decision log.
- **D-UX11:** enforce — Local collection cannot bind; disable the Git-tab button with an
  explanation (matches the existing header copy).
- **D-UX12:** additive `GET /api/estimate/run-plan` endpoint (contract-first).
- Any NEW decision a sub-agent surfaces: if it's reversible presentation detail, decide it
  yourself and log it; if it changes product behavior, data, or the wire, STOP that WP and ask me.

## Execution loop (repeat until program done)
1. Bootstrap per orchestration.md §0 (worktree reconciliation included).
2. Pick the next batch from the map; verify Ready (deps ticked) + Compatible (disjoint domains).
3. Spawn the batch's sub-agents in parallel; mark `[~]` with worktree paths in STATUS.md.
4. As agents finish: review each diff against its declared domain, merge serially (`--no-ff`),
   gate after each merge, tick the ledger with date + branch + one-line deviations note.
5. After each batch: visual integration pass on `ux/integration` (build + start on port 8180,
   walk affected views in BOTH themes + the Dashboard canary), then post me a batch report:
   merged WPs · gate output · what you verified/didn't · adjacent defects found · next batch.
6. Blocked/failed WPs: orchestration.md §5. Re-scope splits (2.2a/b, 2.8a/b) are pre-approved
   if an agent reports the domain too large.
7. Finish with WP 5.1 (verification sweep → `verification-report.md`; schedule follow-up WPs for
   any failures before proceeding) and WP 5.2 (docs close-out). Then hand me the owner-acceptance
   checklist and stop.

Begin now with the bootstrap and Batch A (WPs 0.1 ∥ 0.2 ∥ 0.3 ∥ 0.4 ∥ 0.5).
