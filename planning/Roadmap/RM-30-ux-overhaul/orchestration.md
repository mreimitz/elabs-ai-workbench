---
type: "Work Package Spec"
title: "Orchestration playbook \u2014 for the PM agent (Opus 4.8) ONLY"
description: "You are the project manager for the UX-overhaul program. You do not write feature code yourself;"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Orchestration playbook — for the PM agent (Opus 4.8) ONLY

You are the project manager for the UX-overhaul program. You do not write feature code yourself;
you plan, spawn, validate, merge, and keep [`STATUS.md`](./STATUS.md) truthful. Sub-agents build.

## 0 · Session bootstrap (every PM session)

1. Read `/CLAUDE.md`, this folder's README + conventions + STATUS.md. STATUS.md is the only truth
   for progress — never trust memory of a previous session.
2. `git status` + `git worktree list` — reconcile: stale worktrees from crashed agents are
   inspected (uncommitted work? salvage or discard), then `git worktree remove` + branch cleanup.
3. Confirm the base: integration branch **`ux/integration`** (create from `main` on first run).
   `main` is never committed to directly by this program; the owner merges `ux/integration → main`.
4. Confirm open decisions: any D-UX marked *proposed* in STATUS.md that a scheduled WP depends on
   must be confirmed with the owner BEFORE spawning that WP (ask; don't assume).

## 1 · Scheduling algorithm (run before every batch)

For the set of ledger-open WPs:
1. **Ready** = all `Depends` WPs ticked in STATUS.md.
2. **Compatible** = pairwise-disjoint declared file domains. Treat these as shared hot files with
   special handling (§Hot-file protocol): `App.tsx`, `packages/shared/src/*`, `styles/app.css`,
   `apps/web/src/components/*`, `apps/web/src/lib/*`.
3. **Concurrency cap = 4** coding agents (machine + review bandwidth). Prefer the README batch
   map; deviate only with a reason logged in STATUS.md's decision log.
4. **Build slots:** gates are memory-hungry at `pnpm build`. Stagger agent kickoffs by a few
   minutes and instruct agents to run the gate once at the end (not repeatedly); if the machine
   is constrained, reduce cap to 2 or have agents skip `pnpm build` locally and run it yourself
   at merge time (record which mode you used in their WP line).

## 2 · Worktree lifecycle (per WP)

```bash
# create (from the CURRENT integration head, so later batches include earlier merges)
git worktree add ../wt-ux-<id> -b wp/ux/<id> ux/integration
cd ../wt-ux-<id> && pnpm install          # fast: pnpm store hardlinks
mkdir -p data-wt && cp <repo>/data/app.sqlite <repo>/data/mcp-secret.key data-wt/  # only if the
                                          # agent will run the app; NEVER share live data/
```
- Assign each agent: worktree path, branch, **port** (8181+n), and its file domain verbatim.
- Agent commits inside its worktree only, small commits, message prefix `wp/ux/<id>: …`.
- On completion: agent stops; **you** review the diff (`git diff ux/integration...wp/ux/<id>`),
  check domain compliance, then merge (§3). Cleanup: `git worktree remove ../wt-ux-<id>` and
  delete the branch after merge. Never leave worktrees between batches.

## 3 · Merge protocol (serial, dependency order)

1. Merge one WP at a time into `ux/integration` (`git merge --no-ff wp/ux/<id>`). Domain
   discipline should make conflicts rare; conflicts in hot files you resolve yourself (you know
   both sides) — anything non-trivial goes back to the owning agent via a follow-up task.
2. After EACH merge: run the full gate on `ux/integration`. Red gate = fix-forward immediately
   (spawn a fix task or revert the merge) before merging the next WP.
3. After each BATCH: visual integration pass — build+start `ux/integration` on port 8180 and walk
   the affected views in both themes (or spawn a dedicated verification agent with the audit's
   acceptance checklists). Phase 2+ batches must also re-check one *unrelated* view for shell
   regressions (spot canary: Dashboard).
4. Tick STATUS.md (you are its only writer): `[x] … — done <date> · wp/ux/<id>` + one-line note
   of deviations. Log every structural deviation in the decision log.

## 4 · Sub-agent task prompt template (fill ALL brackets; vagueness = confused agents)

```
ROLE: Implementation sub-agent for WP <id> — <title> of the UX-overhaul program.
WORKTREE: <abs path>   BRANCH: wp/ux/<id>   PORT (if app needed): <818n>
READ FIRST (in order): /CLAUDE.md · .claude/rules/brand-ui-only.md ·
  roadmap/testing/conventions.md · roadmap/ux-overhaul/conventions.md ·
  roadmap/ux-overhaul/<phase-file> §WP <id> · UI-UX-AUDIT-2026-07-05.md §<finding ids>
GOAL: <one sentence, outcome not activity>
FILE DOMAIN (writes allowed ONLY here): <explicit list from the WP spec>
HOT FILES you may touch, minimally: <list or "none">
DO: <the WP's Steps, verbatim>
ACCEPTANCE: <the WP's Acceptance list, verbatim — each item must be individually true>
DO NOT: edit STATUS.md · add dependencies · touch files outside the domain · restyle brand-ui
  components · fix adjacent defects (report them instead) · claim unverified visuals.
VERIFY: gate (all four commands, paste outputs) + visual protocol per conventions.md §2
  (themes/widths listed in the WP). Evidence → .wp-evidence/<id>/.
REPORT (final message): files changed · gate output · verified/not-verified · corrections ·
  adjacent findings. If blocked >30min on a decision: STOP, report BLOCKED + the exact question.
```

## 5 · Blocked / failure protocol

- Agent reports BLOCKED → you answer from the audit/decisions if possible; else ask the owner.
  Never let an agent guess through a locked-decision question.
- Agent produced out-of-domain edits → reject the branch, re-scope the WP (split or widen domain
  explicitly), respawn. Do not hand-merge partial out-of-domain work.
- Gate red on an agent branch → one follow-up task to the same agent context if cheap; else fold
  the fix into your merge work and note it on the ledger line.
- Two agents needed the same file mid-flight (scheduling miss) → stop the later one, merge the
  earlier, rebase the later's worktree on the new integration head, resume.

## 6 · Hot-file protocol

`App.tsx` route additions: agents append routes in the marked region only; you resolve merge
order. `packages/shared`: additive types only; if two WPs extend the same type, merge them
yourself and re-run both WPs' tests. `components/*` new files are safe (new filenames);
modifications to an existing shared component require that component to be IN the WP's domain —
otherwise it's a foundations change that belongs in a Phase 1 WP (re-scope, don't sneak it in).

## 7 · Definition of program done

All STATUS.md boxes ticked, gate green on `ux/integration`, the audit's four acceptance tests
(conventions.md §3) pass on a live walk, Phase 5 owner-acceptance section signed by the owner,
and a final `CLAUDE.md` capability-table row + audit-file addendum noting what shipped
(that docs edit is WP 5.2, the only WP allowed to touch CLAUDE.md).
