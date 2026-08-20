---
type: "Work Package Spec"
title: "WP 0.1 \u2014 Vendor @elabs-ai/components-charts"
description: "Phase: 0 \u00b7 Size: S \u00b7 Depends on: \u2014 \u00b7 Owner action: supply the tarball."
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 0.1 — Vendor `@elabs-ai/components-charts`

**Phase:** 0 · **Size:** S · **Depends on:** — · **Owner action:** supply the tarball.

## Objective
Make charting available to the web app the same way the other `@elabs-ai/components-*` packages are, so the
context-window chart (WP 3.5), KPI sparklines, and compare overlays (WP 3.8) can be built. Owner has
confirmed vendoring is a given.

## Why / references
`@elabs-ai/components-charts` exists upstream but is **not** vendored today (`.claude/rules/dependencies.md`). UI
concept §4 Zone B and §11 (component gaps) require it. Charting must come from `@elabs-ai/components-*`, not a
third-party lib (`brand-ui-only.md`). See [`../references.md`](../references.md) → *LogRocket* for why
a real charting layer (vs. hand-rolled SVG) matters for streaming data.

## Files
- `vendor/brand/brand-charts-1.0.0.tgz` *(new — owner supplies)*
- `apps/web/package.json` *(modify — add the `file:` dep)*
- `apps/web/src/styles/app.css` *(modify — add `@source` so Tailwind scans the dist)*

## Design / implementation steps
1. Place the release tarball at `vendor/brand/brand-charts-1.0.0.tgz` (same origin as the existing
   `brand-ui-1.0.0.tgz` etc.).
2. Add to `apps/web/package.json` dependencies, mirroring the existing entries exactly:
   ```json
   "@elabs-ai/components-charts": "file:../../vendor/brand/brand-charts-1.0.0.tgz"
   ```
3. In `apps/web/src/styles/app.css`, next to the existing `@source` directives for `@elabs-ai/components-ui`,
   `@elabs-ai/components-data`, `@elabs-ai/components-icons`, add:
   ```css
   @source "../../node_modules/@elabs-ai/components-charts/dist";
   ```
   (Match the relative path style already used for the others — confirm against the file.)
4. `pnpm install` from the repo root.
5. Confirm the package's chart primitives + props via its `.d.ts` and
   `vendor/brand-ui-agent-kit/` before WP 3.5 — **never guess props** (`library-first.md`).

## Acceptance
- A throwaway chart (e.g. a `LineChart`/area component from `@elabs-ai/components-charts`) renders on a scratch
  view using only `--chart-1..5` tokens, and reads correctly in both themes (light, dark).
- `pnpm typecheck && pnpm build` green; no raw-color lint warnings from `check-tokens`.
- Revert the scratch view before merging (this WP only wires the dependency).

## Risks
- If `@elabs-ai/components-charts` can't render a **streaming stacked-area with a horizontal limit line** cleanly,
  record it here and fall back (WP 3.5) to composing a constrained renderer the way
  `apps/web/src/components/TokenViz.tsx` is built from `Progress`/`MetricCard`. Decide in WP 3.5, not
  here.
