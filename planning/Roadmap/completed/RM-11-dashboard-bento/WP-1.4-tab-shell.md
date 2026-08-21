---
type: "Work Package Spec"
title: "WP 1.4 \u2014 The bento shell + Overview becomes the default tab"
description: "Compose the tiles from WP 1.2/1.3 into a BentoGrid and make Overview the tab the Dashboard lands"
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.4 — The bento shell + Overview becomes the default tab

Compose the tiles from WP 1.2/1.3 into a `BentoGrid` and make Overview the tab the Dashboard lands
on. **Depends on WP 1.1, 1.2, 1.3** — do not start until all three are merged.

## Files

- `apps/web/src/features/dashboard/overview/OverviewTab.tsx` (+ `.test.tsx`)
- `apps/web/src/features/dashboard/DashboardView.tsx` (+ its test) — add the tab, change the default
- `apps/web/src/features/dashboard/overview/overview-url-state.ts` (+ test) — the range control
- `packages/shared/src/assistant-route-manifest.ts` — only if the gate requires it (see below)

**Do NOT touch** the tiles, the hook, or `overview-contract.ts` — they are merged and owned elsewhere.

## The shell

Use **`BentoGrid` + `BentoGridItem` from `@elabs-ai/components-ui`** — they already exist and have
never been used in this app. Do NOT hand-roll a grid; `library-first.md` forbids it. Read the real
props from the package `.d.ts`. Known shape: `BentoGrid` is 1 col → 2 (`sm`) → 4 (`lg`),
`grid-auto-flow: dense`, `auto-rows-[14rem]`, and takes `spotlight?: boolean` (a cursor-following
gradient, **disabled under `prefers-reduced-motion`**). `BentoGridItem` takes
`size?: "sm"|"md"|"lg"|"hero"`, an explicit `span?: {col?, row?}` that clamps on narrow layouts,
`interactive?`, and `spotlight?`.

Tiles already declare their own `BentoGridItem` + size, so this WP composes them in order and owns
only the grid, the range control, and the states.

Layout (from the approved wireframe): hero footprint `hero` 2×2 · attention 1×2 · startup cost 1×1 ·
pass rate 1×1 · spend by basis 2×1 · surface mix 1×1 · movers 2×1 · advisor full-width.

**Turn the spotlight on** — it is the hover affordance the owner explicitly asked about, it ships
with the component, and it is motion-gated upstream.

## Tab wiring

- Add `overview` to `DASHBOARD_TABS` and make it `DEFAULT_TAB` (currently `scans`).
- The existing `?tab=` contract must keep working: `?tab=scans`, `?tab=testing`, `?tab=issues` all
  still resolve, and the **default stays OUT of the URL** (`/dashboard` remains the clean canonical
  link the sidebar points at). Scans/Testing/Issues keep their current behaviour untouched.
- The range control (24h / 7d / 30d) is URL-persisted like the Testing tab's, via `useSearchParams`
  with `{ replace: true }`.

## Assistant operability (`.claude/rules/assistant-operability.md`)

The Overview is a `?tab=` state on the existing `/dashboard` route, **not a new `<Route>`**, so
`ASSISTANT_ROUTE_MANIFEST` should need no new entry. **Verify** by running the
`assistant-route-operability` tests; if they bite, fix the manifest with a reasoned entry — never by
weakening the test.

## Hard requirements

1. **First-run:** when every section is empty, the bento must NOT render a grid of empty boxes. Show
   the hero's empty state plus one full-width "Add your first MCP server" CTA. Test it.
2. **Loading:** a layout-shaped skeleton sized like the eventual bento (`.claude/rules/loading-states.md`)
   — never a spinner that collapses the grid.
3. **Responsive:** no horizontal page scroll at 375 / 768 / 1400 px. Wide content scrolls inside its
   own container.
4. Both themes must read correctly.

## Acceptance
- [ ] `/dashboard` lands on Overview; `?tab=scans|testing|issues` still deep-link; default absent from the URL.
- [ ] Grid is `BentoGrid`/`BentoGridItem` — no hand-rolled grid, no new dependency.
- [ ] Spotlight enabled and inert under `prefers-reduced-motion` (assert the prop; upstream gates the motion).
- [ ] First-run renders the CTA, not a grid of empty boxes — tested.
- [ ] Layout-shaped loading skeleton, not a spinner.
- [ ] `assistant-route-operability` tests pass unchanged (or a reasoned manifest entry added).
- [ ] Scans / Testing / Issues tabs behave exactly as before.
- [ ] Gate green except the 2 pre-existing api failures noted below.
