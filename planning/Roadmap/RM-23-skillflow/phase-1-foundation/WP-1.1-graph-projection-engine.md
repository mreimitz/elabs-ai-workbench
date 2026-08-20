---
type: "Work Package Spec"
title: "WP 1.1 \u2014 SKILL.md \u2192 graph projection engine + graph route"
description: "Phase: 1 \u00b7 Size: L \u00b7 Depends on: 1.0"
tags: ["roadmap", "RM-23"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.1 — SKILL.md → graph projection engine + graph route

**Phase:** 1 · **Size:** L · **Depends on:** 1.0

## Objective
A deterministic, inference-first projector that turns **any** stored skill version — uploaded,
GitHub-imported, or blank — into a `SkillGraph`, plus the route that serves it:
`GET /api/skills/:id/versions/:vid/graph`.

## Why / references
D2 (universal projection — zero-annotation skills must render a useful graph), D5 (graph is a
projection, anchors back into markdown), D7/D8. [`../00-architecture.md`](../00-architecture.md)
§"Graph projection".

## Files
- `apps/api/src/skillflow/projector.ts` *(create)* — `projectSkillGraph(skillMd: string, files:
  SkillFileNode[]): SkillGraph`. Pure function: markdown structure analysis (headings → subroutine
  nodes + document-order edges; relative-path refs resolved against the version's file list → asset
  nodes; script refs + exit-code/verification language → validation-gate nodes; explicit branch
  language → gatekeeper nodes with condition edges; repeat/retry language → loop-guard hints).
  Every node anchored (`headingPath` + line range). Unresolvable refs → `warnings`, never throws.
- `apps/api/src/skillflow/annotations.ts` *(create)* — parse `<!-- skillflow:… -->` HTML comments
  and merge them over the inferred graph (`source: 'annotated'` wins over `'inferred'` per node).
- `apps/api/src/skillflow/routes.ts` *(create)* — `registerSkillflowRoutes`:
  `GET /api/skills/:id/versions/:vid/graph` → load SKILL.md blob + file list via the existing
  `SkillRepository`, project, stamp `projectorVersion`. 404 on unknown skill/version; a version
  with an invalid/missing SKILL.md returns an empty graph + warnings (not a 500).
- `apps/api/src/index.ts` *(modify)* — wire `registerSkillflowRoutes`.
- `apps/api/test/skillflow-projector.test.ts` *(create)* — fixture-driven: (a) a real-world-style
  skill with **zero annotations** (upload case — must produce subroutines/assets/gates from
  inference alone), (b) a GitHub-style skill with references/scripts, (c) an annotated skill
  (annotations refine, prose preserved), (d) the blank scaffold, (e) determinism (same input →
  deep-equal output), (f) anchor correctness (every anchor's line range contains its heading).

## Acceptance
- [ ] All fixture classes above project to non-empty, correctly-anchored graphs; zero-annotation
      fixtures yield at least subroutine + asset nodes (D2).
- [ ] Pure + deterministic: no model calls, no network, no fs — inputs come from the repository
      layer only; response stamped with `projectorVersion` (mirrors `counting_version`).
- [ ] Invalid SKILL.md degrades to empty-graph-plus-warnings; route contract validated with the
      WP 1.0 zod schemas; repo gate green.

## Notes
New `apps/api/src/skillflow/` module — no file overlap with 1.2, safe in parallel with it.
Touches `apps/api/src/index.ts` (one wiring line) — serialize against other index.ts WPs.
