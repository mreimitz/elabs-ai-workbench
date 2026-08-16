# Kickoff prompt — paste to the PM agent (Opus 4.8) to run the Toolbar-standard program

You are the **Project Manager agent for the Toolbar-standard program** of this repo
(mcp-token-footprint). You orchestrate; worktree sub-agents code. Your job: execute
`roadmap/ux-overhaul/toolbar-standard-2026-07-11.md` end-to-end — WPs TB.0 through TB.7 — to a
green integration branch ready for my owner-acceptance walk.

## Ground rules (non-negotiable)
1. Read, in this order, before doing anything else: `/CLAUDE.md` · `.claude/rules/*` (especially
   `brand-ui-only.md`, `styling-and-tokens.md`, `quality-gates.md`) ·
   `roadmap/ux-overhaul/conventions.md` · `roadmap/ux-overhaul/orchestration.md` ·
   `roadmap/ux-overhaul/STATUS.md` · **`roadmap/ux-overhaul/toolbar-standard-2026-07-11.md`**
   (the plan — its per-view findings + WP table are the spec) — and the built reference
   implementation: `apps/web/src/features/testing/RunBar.tsx`,
   `apps/web/src/components/route-crumb.tsx`, and the run-console breadcrumb block in
   `apps/web/src/App.tsx`. Sub-agents must match that recipe, not invent a new one.
2. **First action — secure the reference implementation.** The 2026-07-11 run-console header
   redesign may exist only as uncommitted working-tree changes (RunBar.tsx, RunConsole.tsx,
   RunConsoleRoute.tsx, App.tsx, components/route-crumb.tsx; run-analyze.ts + its test deleted).
   `git status` first; if uncommitted, commit them as the program's first commit on the
   integration branch with the gate green. If already committed, proceed.
3. Ledger: append a new section **"Phase 6 — Toolbar standard (D-TB1–D-TB4)"** to
   `roadmap/ux-overhaul/STATUS.md` with one line per WP (TB.0–TB.7, legend + format identical to
   the existing phases). STATUS.md is the ONLY live state and you are its only writer; update it
   after every merge; log deviations in the decision log. Never trust session memory over it.
4. Branch: work on `ux/integration` if it exists and is unmerged, otherwise create
   `toolbar/integration` from the current default branch head. Never commit to `main`, never push
   to origin — both are mine.
5. The quality gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) must be green on
   the integration branch after EVERY WP merge before you merge the next.
6. You do not write feature code yourself. One worktree sub-agent per WP via the prompt template
   in `orchestration.md` §4 — fill every bracket (worktree path, branch `wp/tb/<id>`, port 8181+n,
   verbatim file domain from the plan's WP table, the plan's per-view Target as Steps, Acceptance
   below). Max 3 concurrent; never two agents in the same file; only one `pnpm build` at a time
   (`NODE_OPTIONS=--max-old-space-size=3400` if it OOMs).
7. Honest reporting: a WP is done only when each Acceptance item is individually true and the
   gate ran green — paste real command output. Anything not visually verified is listed as not
   verified. No optimism.

## Decisions — locked by the owner 2026-07-11 (do not re-litigate)
- **D-TB1** — breadcrumb owns page identity; in-page H1 title + description blocks are removed on
  ALL views (lists and details). Detail routes publish their resolved identity to the breadcrumb
  leaf via `components/route-crumb.tsx`. Valuable descriptions → info tooltip on the toolbar.
- **D-TB2** — exactly ONE toolbar row per view: `[status/context left] ····· [actions right]`,
  the RunBar recipe (h-12 · border-b · bg-card · truncating muted meta · shrink-0 actions).
- **D-TB3** — assistant entry points live ONLY in the Assistant dock: remove Skills "Analyze
  recent runs", Compatibility "Explain failures", per-row "Analyze" in the Runs feed, and any
  other header/row assistant hook found. Delete orphaned prompt-builder helpers + their tests
  (as run-analyze.ts was) — but VERIFY `suite-run-analyze.ts` isn't consumed by the dock's
  page-hooks before deleting it.
- **D-TB4** — one metric, one home: a number never appears in both a header strip and a tab
  badge / body card (server detail's stats strip is the named offender).
- Open item to verify (flagged in the plan §2 Scans): whether "Reduce footprint" is an assistant
  hook (→ remove per D-TB3) or an advisor deep-link (→ keep). Check the code, decide, log it.
- Any NEW decision: reversible presentation detail → decide yourself and log it; anything
  touching product behavior, data, or the wire → STOP that WP and ask me.

## Execution order
- **TB.0 first, alone** (keystone): the shared one-row `ViewToolbar` primitive replacing
  `PageHeader`'s title/description usage + `route-crumb` publishing for the remaining
  static-crumb detail routes (server / scan / skill / collection names are already in App.tsx
  breadcrumbs — extend only where the leaf is still generic). Get my API sign-off on the
  `ViewToolbar` props before spawning Batch 1 — post the proposed signature and WAIT.
- **Batch 1 (parallel):** TB.1 Skills detail · TB.2 Servers detail · TB.4 Compatibility.
- **Batch 2 (parallel):** TB.3 Runs feed · TB.5 Scans + Compare · TB.6 Collections.
- **Batch 3:** TB.7 light sweep (Dashboard, Environments) + the full-app verification walk.

## Per-WP acceptance (in addition to each view's Target in the plan §2)
- The view renders: breadcrumb → ONE toolbar row → content. No in-page H1/description.
- No identity, metric, or action stated twice on the screen (D-TB1/D-TB4).
- No assistant buttons outside the dock (D-TB3).
- Both themes (`qlik-bright` default + `qlik-dark`) verified against the RUNNING app on the
  agent's assigned port — screenshots into `.wp-evidence/tb-<id>/`, never a mock.
- Keyboard: every remaining toolbar control reachable with visible focus.
- Gate green; existing tests updated honestly (assertions on removed headers/buttons are
  updated to the new contract, never deleted to pass).

## Finish
Final verification sweep: walk all 9 views + run console in both themes on the integration
branch, append results to `roadmap/ux-overhaul/verification-report.md` (new "Toolbar standard"
section), tick the ledger, then hand me: merged WP list · gate output · what you verified /
didn't · the owner-acceptance checklist. Then stop.

Begin now with ground-rule 2 (secure the reference implementation), then the ledger section,
then TB.0.
