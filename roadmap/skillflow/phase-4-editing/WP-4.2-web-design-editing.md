# WP 4.2 — Web: Design-tab editing via `InspectorPanel` + save-as-new-version

**Phase:** 4 · **Size:** L · **Depends on:** 1.3, 4.1

## Objective
Make the Design tab an editor: select a node → edit its fields/section body in the detail panel
(`@brand/editor` for markdown), add/remove/reorder nodes and edge conditions, accumulate edit ops
locally, review the resulting `SKILL.md` diff, and save — creating a new immutable version through
WP 4.1.

## Why / references
D1/D5. Edits are **panel-driven ops**, not free-form canvas mutation — the op vocabulary keeps
round-tripping exact. Review-before-save reuses the existing `SkillDiffView` machinery (WP 1.8,
skills plan).

## Files
- `apps/web/src/features/skills/design/NodeDetailPanel.tsx` *(modify)* — editable mode: field
  editors per node kind (label, section body via `MarkdownEditor`/`CodeEditor`, edge condition,
  gate expectation, asset path picker fed by the version's file list); each change appends a typed
  edit op.
- `apps/web/src/features/skills/design/use-edit-ops.ts` *(create)* — local op buffer (`useState`),
  dirty state, unsaved-changes guard (warn before discarding — interaction rules), optimistic
  graph preview (apply ops client-side to the rendered graph only; the API remains authoritative).
- `apps/web/src/features/skills/design/SaveVersionDialog.tsx` *(create)* — `Dialog`: note field,
  op summary list, embedded diff preview from the WP 4.1 response flow (dry-run request or
  post-save diff — match the API contract), save → toast + inspector refreshes to the new version.
- `apps/web/src/features/skills/design/SkillDesignView.tsx` *(modify)* — edit-mode toggle (view
  stays default read-only), add-node affordance, Save/Discard bar; blank skills open straight into
  edit mode (their whole point).
- `apps/web/src/features/skills/skills-inspector-api.ts` *(modify)* — `postSkillEdits`.

## Acceptance
- [ ] Full loop on a **blank** skill: create (WP 1.2) → design nodes visually → save → version 2
      exists, Versions/Diff tabs show a clean, human-readable `SKILL.md` diff.
- [ ] Full loop on an **uploaded** skill with hand-written prose: edit one section, save, and the
      diff touches only that section (untouched-bytes property visible in the UI diff).
- [ ] Stale-anchor 409 (version changed underneath) surfaces as a clear conflict message with a
      reload path; unsaved-changes warned; no mutation without explicit save.
- [ ] `@brand/*` only, both themes, keyboard-reachable; repo gate green.

## Notes
⚠ OWNER-VERIFY: the Phase-4 owner acceptance item (visual edit → prose-preserving diff). Do not
add a canvas drag-to-draw-edges interaction in this WP unless it falls out of `@brand/flow` for
free — panel-driven ops are the contract; raise canvas-native editing as an upstream discussion.
