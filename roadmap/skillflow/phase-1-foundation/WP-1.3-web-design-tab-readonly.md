# WP 1.3 — Web: Design tab — read-only canvas on `@elabs-ai/components-flow`

**Phase:** 1 · **Size:** L · **Depends on:** 1.1

## Objective
A fifth `SkillInspector` tab — **Design** — rendering the selected version's `SkillGraph` on
`@elabs-ai/components-flow`, read-only: pan/zoom, node selection, a legend for the five node kinds, and a detail
panel that shows the selected node's anchored `SKILL.md` excerpt. Works identically for uploaded,
GitHub, and blank skills (D1/D2).

## Why / references
D1 (inside the existing Skills UI — no new nav), D8 (`@elabs-ai/components-flow` is vendored + wired but
currently has **zero imports**; this WP is the first consumer). First visible deliverable / demo
checkpoint.

## Files
- `apps/web/src/styles/app.css` *(modify)* — add the `@source` directive for the `@elabs-ai/components-flow`
  dist (dependencies rule: every consumed `@elabs-ai/components-*` package needs one).
- `apps/web/src/features/skills/design/graph-layout.ts` *(create)* — deterministic layered layout
  of `SkillGraph` → node positions (document order top-to-bottom, branches fan out). No new layout
  dependency without owner approval — hand-rolled layering over the IR is fine at this scale.
- `apps/web/src/features/skills/design/SkillDesignView.tsx` *(create)* — `CanvasShell` +
  `nodeTypes={{ brand: FlowNode }}` + `FlowEdge`; kind → icon/`tone` mapping (design mode uses
  `default`/`accent` tones only); `Legend` (five kinds), `ZoomControls`; empty/invalid graph →
  `StatePanel` with the projector warnings.
- `apps/web/src/features/skills/design/NodeDetailPanel.tsx` *(create)* — `InspectorPanel` showing
  the selected node's kind, label, condition/asset/script fields, and the anchored markdown excerpt
  (read-only `@elabs-ai/components-editor` viewer, same pattern as `SkillFileExplorer`).
- `apps/web/src/features/skills/skills-inspector-api.ts` *(modify)* — `getSkillGraph(id, vid)`.
- `apps/web/src/features/skills/SkillInspector.tsx` *(modify)* — add the `design` tab (order:
  Overview · **Design** · Files · Versions · Diff); tab follows the existing version picker.

## Acceptance
- [ ] Design tab renders the graph for: an uploaded zero-annotation skill, a GitHub-imported
      skill, and a fresh blank skill (its scaffold graph) — all via the same route, no
      source-specific branches (D2).
- [ ] Node click → detail panel with the correct anchored excerpt; edges show routing-condition
      labels; warnings surfaced (toast or panel), never swallowed.
- [ ] Read-only: no mutation calls exist in this WP. Layout is deterministic (same graph → same
      positions).
- [ ] `@elabs-ai/components-*` only (first `@elabs-ai/components-flow` import + `@source` line), semantic tokens, both themes,
      keyboard-reachable node selection; repo gate green.

## Notes
Confirm `FlowNode`/`CanvasShell` props against the vendored `.d.ts` (or `pnpm exec brand-ui docs`) —
never guess. ⚠ OWNER-VERIFY: two-theme visual walk @ localhost:8080 (this is the Phase-1 owner
acceptance item).
