---
type: "Status Ledger"
title: "Roadmap cleanup — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the roadmap-cleanup plan, read and updated by /next-wp roadmap-cleanup. A box is ticked only when its acceptance is met."
tags: ["roadmap", "RM-35"]
timestamp: "2026-08-21T00:00:00Z"
status: "active"
---
# Roadmap cleanup — work-package status ledger · **PRIORITY: HIGH**

Living state for the **roadmap-cleanup** plan. A box is ticked **only** when its acceptance is
met and — where the box touches code — the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · <evidence>`.

> Plan + the full review in [`item.md`](./item.md). Most boxes here are **not** engineering —
> they are retirements, decisions and ledger edits. Boxes marked **OWNER** cannot be done by an
> agent at all; they are walks of the running app.
>
> **Ordering rule:** Wave 1 (WP 1.1) should land before any Wave 2 sitting, because it is what
> turns ~90 scattered acceptance boxes into one runnable checklist.

## Wave 0 — free retirements and hygiene (no engineering)
- [ ] WP 0.1 — push `main` to `origin/main` (17 commits ahead; every "on local main, not pushed"
      workstream is currently unbacked, and `mcp-self-scan.yml` has never seen this code)
- [ ] WP 0.2 — retire RM-11 (`/complete-roadmap RM-11 --docu DC-11`) — 12/12 done, no
      owner-acceptance section, nothing blocks it
- [ ] WP 0.3 — RM-13 ledger hygiene: its 2 open boxes are per-batch process gates ("working tree
      clean", "no concurrent hub edits"), not work — convert to prose, then
      `/complete-roadmap RM-13 --docu DC-13`
- [ ] WP 0.4 — RM-03 ledger hygiene: 4 open boxes sit under a heading reading "historical —
      resolved above" (BUG-4, GAP-E, LOW-a11y, GAP-A+GAP-B); tick each with a pointer to where it
      was resolved, or move the block to prose. Does **not** retire RM-03 (WP 2.3 is real work)
- [ ] WP 0.5 — correct CLAUDE.md: the RM-20 row still says WP 1.3/1.4/Phase 2 are "deliberately
      not built" when all six WPs are done and the code is on `main`
      (`apps/api/src/security/skill-analyzer.ts`, `apps/web/src/features/security/SecurityDiffPanel.tsx`).
      README.md §11 and CHANGELOG.md are already correct — only CLAUDE.md drifted
- [ ] WP 0.6 — add the seven missing CLAUDE.md rows: RM-09, RM-11, RM-13, RM-16, RM-19, RM-32,
      RM-34 appear nowhere in the capability table or the ledger list

## Wave 0b — three parked decisions (owner, minutes each)
- [ ] **OWNER** D-1 — RM-17's Langfuse amendment (AM-OB1–14 + proposed WP 3.5 agent-graph lens):
      **lock** it and build 3.5, or **reject** it and drop the box. RM-17 has 28/29 done and **no
      owner-acceptance section** — rejecting retires it outright, the cheapest closure available
- [ ] **OWNER** D-2 — RM-06 Phase 5 (3 WPs, cross-links): build, or split to a new RM item so
      RM-06 can retire on its owner walk alone
- [ ] **OWNER** D-3 — RM-07 Phase 6 (2 WPs, judge calibration): build, or split to a new RM item
      so RM-07 can retire on its owner walk alone

## Wave 1 — the leverage batch
- [ ] WP 1.1 — **RM-18 WP 1.6**: one consolidated owner-acceptance checklist across all ledgers,
      grouped by prerequisite (browser · provider key · subscription · CI), with exact click-paths
      and expected outcomes. Pattern already proven twice —
      `RM-13-hub-fixes/owner-acceptance-walk.md` and
      `completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md`. Run via `/next-wp platform`

## Wave 2 — the owner-acceptance sittings (OWNER only — never agent-doable)
- [ ] **OWNER** WP 2.1 — Sitting A, browser only: RM-01 (1) · RM-05 (2) · RM-24 (2) · RM-27 (1) ·
      RM-32 (8) · RM-22 (7) · RM-20 (10). **Retires 7 items.** RM-20 and RM-22 carry judgement
      calls (false-positive rate on your own fleet; two read-boundary sign-offs), not just looking
- [ ] **OWNER** WP 2.2 — Sitting B, one provider key: RM-23 (4) · RM-07 (5) · RM-10 (9) ·
      RM-06 (7) · RM-26 WP 4.1. **Retires up to 4 items**, and these are the ones whose *quality*
      is genuinely unproven rather than merely unlooked-at
- [ ] **OWNER** WP 2.3 — Sitting C, Claude subscription sign-in: RM-09 (4) · RM-16 (7) ·
      RM-02 (22). **Retires 3 items.** RM-02's 22 boxes are four refinement rounds that each grew
      their own acceptance section
- [ ] **OWNER** WP 2.4 — Sitting D, a real pipeline: RM-08 (13). The blocking box is structural —
      the two gates in `examples/github-actions/` **have never executed**. Push `main` (WP 0.1) so
      `mcp-self-scan.yml` runs, or execute the examples in a throwaway repo with a service token
- [ ] WP 2.5 — retire every item its sitting cleared (`/complete-roadmap` per item, DC subject
      named). **Blocked:** RM-01 has no documentation subject — run `/new-docu` for an Advisor
      subject, or fold it into DC-11, before retiring it

## Wave 3 — the remaining engineering, in value order
- [ ] WP 3.1 — **RM-26 WP 4.4** end-to-end verification: a real run through the built Docker
      image. 1 WP, needs a provider key. Highest value per hour on this list — it exercises
      migrations, the encrypted-secret path, static serving and the run engine in one shot
- [ ] WP 3.2 — **RM-34 WP 2.1** re-measure the estimator band against recorded runs. 1 WP. Fixes
      a number the owner has already seen be wrong (RM-33 recorded the band bracketing a real run
      at $0.42–$1.59 against $0.80 billed, because the 8-turn ceiling dominates at 19 turns).
      **Check first** whether "agent D" still holds it — the in-progress marker looks stale
- [ ] WP 3.3 — **RM-30 Phase 7** Skill Studio: WP 7.1, 7.3, 7.4 then 7.7, 7.8, 7.9. Three batches,
      dependency chain `7.1 ∥ 7.2 → 7.3 → (7.4 ∥ 7.6) → 7.5`; round 2's 7.7–7.9 revise the same
      surface so they land after. Owner-directed rework of a surface the owner has already
      rejected; unblocks RM-30's 61 done WPs
- [ ] WP 3.4 — **RM-03 WP 2.3**: autonomy dial + hard budgets + steering + live HITL
      approval-gating + MCP elicitation. One box, two BLOCKING MUSTs (elicitation transport
      R-MCP4, the approval/HITL path). Unblocks RM-03's 18-box walk
- [ ] WP 3.5 — **RM-14 Phases 2–4** (10 WPs): scene spec layout engine + connector router +
      renderer (2.1–2.4), explain mode (3.1–3.3), assistant compose tools (4.1–4.3). Largest
      remaining build. **The risk to weigh:** 24 illustration components exist and nothing composes
      them — Phase 1 delivered breadth, Phase 2 is the load-bearing part

## Wave 4 — new work and the ledger-less items (owner's call)
- [ ] WP 4.1 — **RM-18** remaining 5 WPs (first-run seed, docs route, diagnostics bundle, upgrade
      harness, perf pass). **Recheck the stale "blocked on Benchmarks P1/P3" flags first** — both
      are done, exactly as RM-01's WP 2.1 flag was found stale on 2026-08-18
- [ ] WP 4.2 — **RM-25** team-server, 6 WPs. Its gate (RM-08 Phase 1) is met. Starting it revises
      the "single-owner local" scope in CLAUDE.md §1, so it is a product decision, not scheduling
- [ ] WP 4.3 — **RM-19** release: the code shipped (`scripts/release.sh` +
      `scripts/release/{README.md,run.sh,run.ps1}`) but the item is a stub with no ledger and
      DC-22 does not mention the bundle. Write the bundle into DC-22, then
      `/complete-roadmap RM-19 --docu DC-22 --no-ledger`
- [ ] WP 4.4 — **RM-12** and **RM-31**: both `archived` but still filed as live work. Retire with
      `--no-ledger`, or leave archived if the provenance is worth the clutter

## Decision log
_Entries: date · decision · rationale._

- **2026-08-21 · this review became an RM item rather than a loose file.** The request was a
  `roadmap-cleanup.md` beside `roadmap.md`. `planning/Roadmap/` permits exactly two loose files
  (`index.md`, `roadmap.md`) — `loose_files` in `okf.py`'s `rm` Domain — so the draft failed
  `pnpm okf:validate` with PROFILE027 + PROFILE018. Owner chose the generator path, which also
  makes the waves drivable by `/next-wp` instead of being prose nobody executes.
- **2026-08-21 · the roadmap is not blocked on engineering.** 13 of 28 items are code-complete
  and gate-green, held open only by owner-acceptance walks — roughly 90 checkboxes across 13
  files. Waves 0–2 take the active roadmap from 28 items to roughly 12 with **no feature work at
  all**. This is why Wave 1 (one consolidated checklist) outranks every engineering WP here.

## Owner acceptance (owner-only)
- [ ] The active roadmap lists only work that is genuinely live: every retirable item retired,
      every started-and-incomplete item either finished or explicitly parked with a named
      condition — accepted: ____
