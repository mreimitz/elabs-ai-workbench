---
type: "Work Package Spec"
title: "WP 1.8 \u2014 Web: Versions + Diff (DiffEditor)"
description: "Phase: 1 \u00b7 Size: M \u00b7 Depends on: 1.5, 1.7"
tags: ["roadmap", "RM-24"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.8 — Web: Versions + Diff (DiffEditor)

**Phase:** 1 · **Size:** M · **Depends on:** 1.5, 1.7

## Objective
Fill the inspector's **Versions** tab (history table + Δtokens, compare selection) and **Diff** tab
(delta strip + manifest diff + full-tree change list + Monaco `DiffEditor`), plus wire "Pull latest"
to deep-link into the diff.

## Why / references
`../../research/skill-registry/07-ui-plan.md` (`../../research/skill-registry/07-ui-plan.md`) §4
(Versions, Diff), mockups `#4`,`#5`,`#7`. Uses `DataTable`@data, `DiffEditor`@editor, `FileTree`@ai,
`Badge`/semantic tokens.

## Files
- `apps/web/src/features/skills/SkillVersions.tsx` *(create)* — `DataTable` of versions (seq, label,
  source ref, imported_from, date, total tokens, Δ vs prev); select two → Compare.
- `apps/web/src/features/skills/SkillDiffView.tsx` *(create)* — A/B pickers; delta strip (files +
  L1/L2/L3/total token deltas) + manifest field diff; full-tree change list with status badges +
  per-file token deltas; `DiffEditor` for a selected modified text file; added/removed → single pane;
  binary → "binary changed".
- `apps/web/src/features/skills/SkillInspector.tsx` *(modify)* — mount the two tabs; "Pull latest"
  (GitHub) → on new version, open Diff(prev→new).

## Acceptance
- [ ] Versions tab lists the full history with correct Δtokens; selecting two versions opens the Diff.
- [ ] Diff tab shows the rollup delta strip, manifest field diff, and the walkable full-tree change
      list (added/removed/renamed/modified across all subfolders); selecting a modified text file
      renders a side-by-side `DiffEditor`; binary/added/removed handled.
- [ ] "Pull latest" on a GitHub skill that changed lands on the Diff(prev→new); an uploaded v2 shows
      the same deep diff.
- [ ] `@elabs-ai/components-*` + tokens; both themes; hooks clean; repo gate green.
- [ ] **Owner-verify (localhost:8080):** pull a changed GitHub skill → deep diff; two-theme walk.

## Notes
Modifies `SkillInspector.tsx` from 1.7 — **do not parallel with 1.7**. Reuses the read-only API
helpers from 1.7 + the diff endpoints from 1.5.
