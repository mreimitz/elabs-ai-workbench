---
type: "Status Ledger"
title: "Design system upgrade to 6.1 — work-package status ledger"
description: "Living state for the 4.1.0 → 6.1.0 @elabs-ai/components-* upgrade."
tags: ["roadmap", "RM-40"]
timestamp: "2026-11-06T10:05:00Z"
status: "active"
---
# Design system upgrade to 6.1 — work-package status ledger

A box is ticked **only** when its acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Branch: `chore/brand-ui-6.1`.

## Where the facts come from

- `npm view` of every used package at 4.1.0 and 6.1.0 (peer and dependency diffs).
- The per-package `CHANGELOG.md` files of the upstream checkout (read-only; it sits at 6.0.0) for
  4.2.0 → 6.0.0, and the GitHub release notes for 6.1.0 (patch-only except one new
  `DensityScatterChart` prop this app does not use).
- `pnpm typecheck` and `pnpm test` against the installed 6.1.0 — which found what the notes did not.

## Work packages

- [x] **1 — Re-pin.** All nine `@elabs-ai/components-*` entries (8 in `apps/web`, the CLI at the
  root) moved `4.1.0` → `6.1.0`, still exact. No new peer is required: `motion` is already a direct
  dep, `elkjs` is an optional peer only for `layoutFlowElk` (unused), `media-chrome` was dropped
  upstream in 5.5. — done 2026-11-06
- [x] **2 — Build breaks.** (a) `YAxis formatLargeNumbers` removed in 5.0 →
  `ContextCurves.tsx` drops it (compact is the default). (b) **Unannounced:** TanStack Table v9
  requires `TData extends RowData` (`Record<string, any> | any[]`); `col` / `actionsCol` / `navCol`,
  `EntityTable`, `EntityBrowser`, `EntityBrowserProps` and scans' `actionColumn` now declare
  `T extends object`. No call site changed. — done 2026-11-06
- [x] **3 — 6.x deprecations (removed in 7.0).** Flow `tone: "accent"` → `emphasis: "featured"`,
  `tone: "default"` → `tone: "neutral"` in the skill canvas (`node-kind-meta.tsx`,
  `SkillGraphCanvas.tsx` — a trace verdict still replaces the emphasis, as it replaced the accent),
  the mission topology graph (`topology-graph.ts`, `TopologyGraph.tsx`) and the org chart
  (`org-model.ts`). No other 6.x deprecation is used: no chart `height`, no `<Scatter trend>`, no
  `FloatingEdgeData`, no `FlowPlaceholderNode`, no direct TanStack `column.pin`. — done 2026-11-06
- [x] **4 — Upstream drift the tests caught.** `SectionCardTitle` copied `CardTitle`'s classes and
  had drifted (`leading-none` vs upstream `leading-(--card-title-leading)`); it now delegates to
  `CardTitle`'s new `as` prop. Stale literals updated: button `size-9`/`size-8` →
  `size-control`/`size-control-sm`, `CardDescription` `text-sm` → `text-body`, facet items
  `menuitem` → `menuitemcheckbox`, a 32px button height named `h-control-sm`. Guardrails:
  active-nav accepts the 5.x `bg-sidebar-indicator` token **and** now asserts that token is
  `var(--sidebar-primary)` in both shipped themes (mutation-probed: red when altered); dock-fade
  finds ChatShell in its hashed chunk and pins the new bottom-scrim class list (`app.css` selectors
  still match — they key on `aria-hidden` + `bg-gradient-to-t from-background`). — done 2026-11-06
- [x] **5 — Test harness.** `vitest.config.ts` inlines `/@elabs-ai\/components-/` (5.0 entry points
  `import "./index.css"`, which Node cannot load); `vitest.setup.ts` stubs `matchMedia` once, in the
  exact guarded shape ~20 suites already used locally. — done 2026-11-06
- [x] **6 — SideDock header reviewed, kept.** 5.0 gave `SideDock`'s header the shared `h-header`
  height and `items-center`, so two of the app's four header overrides now restate upstream. They
  stay: the one-main guardrail pins the dock header to `TopNav`'s height utility and still passes,
  and the padding overrides (`px-3 py-0`) still differ from upstream's `px-4`. — done 2026-11-06
- [x] **7 — Gate green + docs re-pinned.** Docs re-pinned (CLAUDE.md, README, CHANGELOG,
  `dependencies.md`, `brand-ui-only.md`). Gate EXIT=0: typecheck · tests shared 288 / illustrations
  1032 / cli 87 / api 3985 / web 4579 (+5 skipped), 0 failed · build · Biome 1968 files clean. Run with
  Homebrew git first on PATH: the system git is blocked by an unaccepted Xcode licence, which fails
  the data-pack provenance test for an environmental reason. — done 2026-11-06
- [ ] **8 — Owner acceptance: both-theme browser walk** of the skill canvas (featured gatekeepers /
  entry points), the mission topology and org chart, the dock header + transcript fade, a long
  `DataTable` (sort, pager, column picker) and a facet filter, and a code editor's line numbers.
  Not done — no browser was opened.
