---
type: "Work Package Spec"
title: "UX-overhaul conventions \u2014 every sub-agent reads this before coding"
description: "Layered ON TOP of ../testing/conventions.md (stack, gate,"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# UX-overhaul conventions — every sub-agent reads this before coding

Layered ON TOP of [`../testing/conventions.md`](../RM-26-testing/conventions.md) (stack, gate,
contract-first, API layering) and `.claude/rules/*` (brand-ui only, tokens, secrets). If this file
contradicts a WP spec, this file wins; if it contradicts `/CLAUDE.md`, CLAUDE.md wins.

## 1 · The gate (unchanged, non-negotiable)

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

All four green from the repo root before a WP is reportable as done. Web build is memory-hungry:
if the machine is constrained, `NODE_OPTIONS=--max-old-space-size=3400 pnpm build`. **Never run
two `pnpm build`s concurrently on one machine** — coordinate via the PM (orchestration.md §Build
slots).

## 2 · Visual verification protocol (UI WPs)

"Done" claims about pixels require looking at real pixels — never a mock, never "should now".

- Reference instance: `http://localhost:8080` (the owner's running container) is READ-ONLY
  context. For your own changes, serve your worktree: `pnpm build`, then
  `PORT=<your assigned port> DATA_DIR=$(pwd)/data-wt pnpm start` — copy `data/app.sqlite` and
  `data/mcp-secret.key` from the repo's `data/` into `data-wt/` first (never point a worktree at
  the live `data/`; the API writes to its DB). Ports are assigned per agent in your task prompt
  (8181, 8182, …). If you cannot run the app, say so in your report — the PM verifies on the
  integration branch instead. Do not claim visual results you did not see.
- Check **both themes** (`light`, `dark` — switch in Settings) for every visible
  change, and **two widths** (≥1500px and ~1100px) for layout WPs.
- Screenshot evidence: save to the worktree's `/.wp-evidence/<wp-id>/*.png` (git-ignored is fine;
  they're for the PM's review message, not for commit).

## 3 · Shell contracts (the acceptance bar for anything visual)

These restate the audit's acceptance tests. Every migrated view must pass all four:

1. **Page shell (S16):** title in the same position on every route (target: one PageHeader
   component, H1 ~20px/600, breadcrumb in the top bar on every route, actions right); one gutter
   token; container width per archetype (audit §C).
2. **Tab shell (S21):** the region above a tab strip is identical for every tab (the strip never
   moves); one strip→content offset; tab content never repeats the tab's label as a heading; flat
   content for single-region tabs, cards only for multi-panel compositions; shared split-pane and
   empty-state recipes.
3. **Scroll contract (S22):** shell fixed (top bar + page header + tab strip never scroll); the
   content region is the only scroll container and fills the viewport; sticky table headers +
   toolbars inside scroll regions; empty states vertically centered. Exception: Settings-style
   document pages may body-scroll with a sticky header.
4. **Status vocabulary (S3):** all state chips render through the shared `StatusBadge` (WP 1.1)
   with this mapping — never a raw string:

| Wire value(s) | Label | Tone |
|---|---|---|
| success, completed, complete, ok | Completed | green outline |
| failed, error | Failed | red filled |
| aborted | Aborted | gray outline |
| stopped_guardrail | Stopped (guardrail) | amber outline |
| running/streaming | Running | blue outline + spinner |
| unscanned/pending | Pending | gray dashed |
| N/A | — | plain text, no chip |
Counts color by VALUE: a zero renders neutral, never red/green.

## 4 · File-domain discipline (what keeps parallelism safe)

- Your WP declares a **file domain** (folders/files you may create or modify). Stay inside it.
  Reading anything is fine; writing outside the domain is a WP failure — report BLOCKED instead
  (orchestration.md §Blocked protocol) so the PM can re-scope.
- **Hot files** (`apps/web/src/App.tsx`, `packages/shared/src/*`, `apps/web/src/styles/app.css`,
  `apps/web/src/components/*`, `apps/web/src/lib/*`): only touch them if your WP explicitly lists
  them, and keep edits minimal + append-oriented (new route lines, new exports) to reduce merge
  conflicts.
- **Never edit `roadmap/ux-overhaul/STATUS.md`** — the PM is its single writer.
- Path names in WP specs marked `(verify)` are educated hints: confirm with `Glob`/`Grep` before
  editing; if reality differs, follow reality and note the correction in your report.

## 5 · Component & code rules for this program

- Every new visual element = `@elabs-ai/components-*` (check the real API: `pnpm exec brand-ui docs <Component>`
  or the brand-ui MCP server; never guess props). New shared compositions live in
  `apps/web/src/components/` (PascalCase) and are the ONLY sanctioned place for cross-feature UI.
- Semantic tokens only; `className` = layout only; both themes always.
- Forms follow S19: dependent fields disabled-with-reason until prerequisites; every numeric input
  carries `min/max/step`; sliders+input for bounded scales; no raw-JSON textarea where a
  structured editor is specified.
- Copy rules: sentence case; no raw snake_case leaking to UI; consequences on the button
  ("Save as new version"); every "—" empty value that has an enablement path gets a hint/link.
- Tests: web tests colocated `*.test.ts(x)` where the feature already has them; don't introduce a
  new test framework; API changes follow the existing node-test patterns.

## 6 · Honest reporting (verbatim requirement for the final agent message)

Report: (1) what you changed (files), (2) gate result — paste the actual final line of each
command, (3) what you visually verified (theme × width × view) with evidence paths, (4) what you
did NOT verify, (5) any domain corrections or discovered adjacent defects (do not fix them —
list them for the PM).
