---
type: "Work Package Spec"
title: "WP 4.3 — Three existing illustrations placed into the first-run empty states; RM-14 Phases 2–4 deferred behind RM-18"
description: "Phase 4 of item.md. Ledger: STATUS.md. Renders the already-built mcp-server, skill and run illustrations in the /servers, dashboard, /skills and /testing/runs empty states as decorative content graphics, with size, theme, motion and bundle rules, and parks the ten open RM-14 work packages with a dated line."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 4.3 — Three existing illustrations placed into the first-run empty states; RM-14 Phases 2–4 deferred behind RM-18

Phase 4 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

`@mcp-token-footprint/illustrations` (`packages/illustrations/`, 24 registry entries, Phases 0–1 of
[`/Roadmap/RM-14-illustrations/STATUS.md`](/Roadmap/RM-14-illustrations/STATUS.md) done; already a
workspace dependency of `apps/web`, consumed today only by the hidden `/illustrations` gallery in
`apps/web/src/features/illustrations/`). Targets: the `/servers` empty state
(`apps/web/src/features/servers/ServersOverview.tsx:337-353`), the dashboard first-run state
(`apps/web/src/features/dashboard/overview/OverviewTab.tsx:161-173`), the `/skills` empty state
(`apps/web/src/features/skills/SkillsOverview.tsx:190-202`) and the `/testing/runs` empty state
(`apps/web/src/features/testing/RunsView.tsx:787-797`); the shared wrapper
`apps/web/src/components/TabEmptyState.tsx`. Out of scope: RM-14 Phase 2 scene engine, Phase 3 explain
mode, Phase 4 assistant composition (parked here), any new illustration, the empty-state copy rewrite
(wp-3.3), the Load-demo button on the same states (wp-1.1), the README tour entry for illustrations
(wp-0.7, MK-23). The gallery route stays as it is.

## Actions

1. **An `illustration` slot on the empty-state wrapper**: `TabEmptyState.tsx` gains an optional
   `illustration?: ReactNode` rendered above `StatePanel`; for views that use the design-system
   `EmptyState` directly (`/servers`, `/skills`, `/testing/runs`), add a local
   `apps/web/src/components/IllustratedEmptyState.tsx` that places the graphic above the unchanged
   `EmptyState` — check `pnpm exec brand-ui docs EmptyState` first (per `.claude/rules/dependencies.md`)
   and use its own slot if one exists instead of wrapping. The graphic is content, not chrome, so the
   brand-ui-only rule is not touched. **P1**
2. **Place `mcp-server`** (`findIllustrationComponent("mcp-server")`, variant `streamable-http`, state
   `idle`, size `m`) on the `/servers` empty state and the dashboard first-run state; **`skill`**
   (variant `plain`, `idle`, `m`) on `/skills`; **`run`** (variant `single`, `idle`, `m`) on
   `/testing/runs`. One graphic per state, centred above the title, title and description unchanged. **P1**
3. **Rendering rules**: `aria-hidden="true"` and no focusable element (decorative — the title carries
   the meaning); hidden below the `md` breakpoint via a wrapper class so narrow viewports keep today's
   layout; max height 160 px at `m` so the primary action stays in the first viewport at 1440×900;
   colours come from the package's `--illus-*` tokens (`packages/illustrations/src/tokens.css`), so
   both themes are covered by the existing token layer — verify by looking, not by assumption; no
   animation, so `prefers-reduced-motion` needs nothing. **P1**
4. **Bundle discipline**: the package is imported only inside the four lazy route chunks
   (`apps/web/src/App.tsx` `lazy()` boundaries for Dashboard, Servers, Skills, Runs); the `App.tsx` entry
   chunk must not grow. Record the per-chunk delta from `pnpm build` in the PR. **P1**
5. **Tests**: one test per empty state asserting the registry id rendered (a `data-illustration-id`
   attribute on the wrapper, mirroring the gallery's `data-illustration-card` at
   `IllustrationsGallery.tsx:277`) and its absence once data exists; an axe pass
   over each state; the four screenshots in both themes in the PR. **P1**
6. **Defer RM-14 Phases 2–4**: a dated line under the Phase 2 heading in
   `planning/Roadmap/RM-14-illustrations/STATUS.md`: "Phases 2–4 (10 WPs) parked 2026-08-22 by RM-37
   wp-4.3 behind RM-18 WP 1.1–1.3 (delivered via RM-37 wp-1.1/wp-1.4) and the Announcement milestone
   (wp-4.1); the three in-product placements are the only illustration work before the announcement."
   The same sentence goes into RM-14's decision log and the RM-35 milestone note from wp-4.1 references
   it. **P1**
7. **Demo-seed interplay**: with demo data loaded (wp-1.1) the four states disappear; Remove demo data
   brings them back — the RM-18 owner line "clean empty states" now includes the graphics. Note it in
   wp-4.1's acceptance walk. **P2**

## Acceptance

- [ ] The four empty states render their illustration at 1440×900 in **both** themes, verified on the
      running app; no horizontal scroll, no layout shift on load, primary action visible without scrolling.
- [ ] Below `md` the states render exactly as today (snapshot test).
- [ ] Each graphic is `aria-hidden`, adds no tab stop, and the axe pass reports no new violation.
- [ ] The `App.tsx` entry chunk size is unchanged; the four route chunks' deltas are recorded.
- [ ] Tests assert the three registry ids render on the right states and vanish once a server, skill or
      run exists.
- [ ] RM-14's ledger carries the parking line and the decision-log entry; no RM-14 Phase 2–4 WP is
      dispatched.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**S** — three already-built components, one slot, one wrapper, four placements and a ledger line; the
package's tokens and tests exist.

## Sources

PO-34 · walkthrough `/illustrations` note (24 components, used nowhere in the product UI) · MK-23
(README tour entry → wp-0.7) · RM-14 STATUS Phases 0–1 done, 2–4 open.
