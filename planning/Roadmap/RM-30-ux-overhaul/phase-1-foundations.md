---
type: "Work Package Spec"
title: "Phase 1 \u2014 Foundations (the critical path; everything in Phase 2+ builds on these)"
description: "Six WPs creating the shared shells/primitives in apps/web/src/components/ (+ lib/). These WPs"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 1 — Foundations (the critical path; everything in Phase 2+ builds on these)

Six WPs creating the shared shells/primitives in `apps/web/src/components/` (+ `lib/`). These WPs
do NOT migrate views (that's Phase 2) — but each must ship a working reference adoption on ONE
named view so the pattern is proven against the running app, not in theory.

**Batching:** 1.1 ∥ 1.2 ∥ 1.5 ∥ 1.6 (disjoint new files), then 1.3 ∥ 1.4 (depend on 1.2).
All Phase 1 WPs create NEW files in `apps/web/src/components/` — coordinate names via this spec
so parallel agents never collide.

---

## WP 1.1 — `StatusBadge` + status vocabulary (S3)
**Goal:** one component renders every state chip in the app from wire value → {label, tone} using
the table in `conventions.md` §3; value-aware count chips (zero = neutral).
**New files (domain):** `apps/web/src/components/StatusBadge.tsx`, `StatusBadge.test.tsx`,
`apps/web/src/lib/status.ts` (the mapping — exported, typed against shared constants where they
exist: `Grep "aborted\|stopped_guardrail" packages/shared/src` to find the canonical unions).
**Reference adoption:** the Scans list view only (both `success`/`failed` badges) — prove it, stop.
**Acceptance:** component matches the vocabulary table exactly (incl. `stopped_guardrail` →
"Stopped (guardrail)"); count-chip helper renders 0 as neutral; unit tests for the full mapping;
reference view uses it; both themes screenshot. Gate green.
**Size:** M.

## WP 1.2 — `PageShell` + `PageHeader` + scroll contract (S16 + S22)
**Goal:** the one page frame: fixed top bar (breadcrumb ALWAYS + global actions slot), fixed
PageHeader (real `h1` ~20px/600 · optional description line · actions right), content region as
the only scroll container (`flex-1 min-h-0 overflow-y-auto`), gutter token (32px x / 24px top,
16px below 1200px), width modes per audit §C archetypes (`full | centered | master-detail |
workbench`).
**New files (domain):** `apps/web/src/components/PageShell.tsx`, `PageHeader.tsx`, plus
minimal wiring in `apps/web/src/App.tsx` ONLY if the frame must mount at the layout level (hot
file — keep to a wrapper swap). Build on `@elabs-ai/components-ui` AppShell/PageShell/Breadcrumb primitives —
check their real APIs first (`pnpm exec brand-ui docs PageShell Breadcrumb AppShell`).
**Reference adoption:** Settings page (simple, document-archetype w/ sticky header exception) AND
Environments page (catalog archetype) — two archetypes proven.
**Acceptance:** on the two reference pages: breadcrumb present, title at identical x/y, content
scrolls internally (Environments) / body-scroll-with-sticky-header (Settings), no dead sea below
short content (empty region fills viewport). Audit §C acceptance quote holds between the two
pages: title does not move a pixel when navigating between them. Gate green.
**Size:** L. **This WP is the program's keystone — PM reviews its API before batch C spawns.**

## WP 1.3 — `TabPanel` + unified tab bar (S4 + S21) — depends on 1.2
**Goal:** one Tabs pattern: left-aligned pill tabs (the server-detail style), stable frame (strip
never moves between tabs), one strip→content offset, per-tab description+actions row, card-vs-flat
rule (flat for single-region content; cards only for multi-panel), shared `SplitPane` recipe
(panel header: title · count · search; visible divider; min-widths) and shared `TabEmptyState`
placement.
**New files (domain):** `apps/web/src/components/TabPanel.tsx`, `SplitPane.tsx`,
`TabEmptyState.tsx` (+ tests).
**Reference adoption:** MCP server detail (the worst offender: 6 tabs, 6 layouts, strip jumps
~200px between Overview and others — pin the header region to the compact stat strip for ALL tabs
incl. Overview, per S21#1).
**Acceptance:** on server detail: switching all 6 tabs moves NOTHING above the content region;
Resources/Prompts/Scans lose their label-repeating wrapper cards (flat tables); Tools uses
SplitPane with both columns' headers aligned; empty Prompts fills the viewport, empty state
centered. Both themes. Gate green.
**Size:** L.

## WP 1.4 — `TableToolbar` + DataTable defaults (S18 + S2/S15 mechanics) — depends on 1.2
**Goal:** one toolbar recipe (single 40px baseline row: search · filter dropdowns · result pills ·
spacer · view options; no label-above controls; active filters as removable chips row) AND shared
DataTable hardening defaults: pinned first/last columns helper, sticky header row inside scroll
regions, `pageCount≤1` hides pagination, no sort UI on action columns (empty header), row-click
navigation slot.
**Domain:** `apps/web/src/components/TableToolbar.tsx`, extensions in `apps/web/src/lib/table.tsx`
(verified path — the `col` helper lives here; extend, don't fork).
**Reference adoption:** Scans list view (search + Server/Status dashed chips today → real toolbar).
**Acceptance:** Scans list shows one aligned toolbar row; its table header sticks while the list
scrolls; single-page tables in the reference view hide pagination; `lib/table.tsx` exports the
pinning/sticky helpers with tests. Gate green.
**Size:** M–L.

## WP 1.5 — Modal system tiers (S17)
**Goal:** the four modal tiers as components: `ConfirmDialog` (sm) · `FormDialog` (md ~640px, no
internal scroll, standard footer Cancel|Primary bottom-right) · `WideDialog` (≥960px, left-rail
sections OR top tabs, sticky footer, dirty-state guard hook reused from the existing
discard-changes pattern) · full-screen `WorkbenchDialog` (playground-style). Section header,
"Advanced" collapsible group, and consequence-labeled primary button are part of the kit.
**New files (domain):** `apps/web/src/components/dialogs/` (new folder: `ConfirmDialog.tsx`,
`FormDialog.tsx`, `WideDialog.tsx`, `WorkbenchDialog.tsx`, `DialogSection.tsx` + tests). Build on
`@elabs-ai/components-ui` Dialog/Sheet/Wizard — real props via brand-ui docs.
**Reference adoption:** none (Phase 2 migrates the big modals) — instead ship a Storybook-style
demo route? NO — out of scope; prove via unit tests + one temporary usage behind the Skills
"Delete" confirm (already exists; upgrade it to `ConfirmDialog`).
**Acceptance:** all four tiers exported + documented in a header comment (when to use which, the
S17 decision rule ">8 fields → WideDialog"); delete-skill confirm uses ConfirmDialog; primary
action bottom-right in all tiers. Gate green.
**Size:** M.

## WP 1.6 — Form primitives (S19/S11/S12 kit)
**Goal:** the inputs Phase 2 swaps in everywhere: `SliderNumber` (slider+input, min/max/step,
"provider default" marker) · `BoundedNumber` (numeric input, placeholder for no-limit, unit
suffix) · `KeyValueEditor` (add/remove rows, optional secret masking) · `ListEditor` (one string
per row → array) · `TagInput` (chips from comma/Enter) · `SegmentedField` (label + segmented
control + help slot) · `useDependentField` (disabled-with-reason until prerequisite set).
**New files (domain):** `apps/web/src/components/form/` (new folder, one file per primitive +
tests). Compose from `@elabs-ai/components-ui` (Slider if it exists — CHECK via brand-ui docs; if brand-ui lacks a
Slider, report the upstream gap and build the keyboard-accessible fallback from primitives per
library-first.md escape rules, flagged for owner).
**Reference adoption:** none required; exhaustive unit tests instead (bounds clamping, step
rounding — kill the 0.30000 float artifact class with a decimals prop; dependent-field disabled
reasons).
**Acceptance:** all primitives typed, tested, keyboard-operable, both-theme rendering verified on
a scratch usage (delete before commit or keep behind tests). Gate green.
**Size:** L.
