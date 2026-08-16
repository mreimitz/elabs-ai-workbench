# WP 4.1 — Graph-edit → SKILL.md round-trip engine (anchors, new immutable version)

**Phase:** 4 · **Size:** L · **Depends on:** 1.1

## Objective
The write half of Design Mode, API-side: apply a set of graph-level edit operations to a version's
`SKILL.md` **through the anchors**, preserving all untouched prose byte-for-byte, and submit the
result as a **new immutable version** via the existing ingest path.

## Why / references
D5 (SKILL.md source of truth; editing = new version; meaningful git diffs; no side-car files).
Reuses `SkillIngestService.createVersion` (footprint, manifest validation, `tree_sha` no-op dedupe)
and the existing diff engine for review.

## Files
- `apps/api/src/skillflow/edit-ops.ts` *(create)* — the edit-operation vocabulary (shared-typed in
  WP 1.0 style, additive to `packages/shared`): `rename_node`, `update_section_body`,
  `add_subroutine`, `remove_node`, `reorder`, `set_edge_condition`, `add_asset_ref`,
  `set_gate_expectation`, `set_annotation`. Each op targets a node/edge **id + anchor**.
- `apps/api/src/skillflow/roundtrip.ts` *(create)* — `applyEditOps(skillMd, files, graph, ops) →
  { skillMd', warnings }`: anchor-scoped splicing only; a stale anchor (markdown changed since the
  graph was projected — compare `tree_sha`) → 409, never a best-effort guess; structure the parser
  can't express in plain markdown → `<!-- skillflow:… -->` annotations (D2), never a format change.
- `apps/api/src/skillflow/routes.ts` *(modify)* —
  `POST /api/skills/:id/versions/:vid/edits` → apply ops → run the modified tree through
  `SkillIngestService.createVersion` (`imported_from:'upload'`, `source_ref:'skillflow-edit'`,
  `note` from the request) → return the new `SkillVersion` + the WP 1.5 diff vs. the base version.
- `apps/api/test/skillflow-roundtrip.test.ts` *(create)* — the **round-trip property**: for each
  fixture, project → apply ops → re-project the new version → the edited graph matches the intent
  AND every byte outside the edited anchors is identical; stale-anchor 409; dedupe (empty op list →
  `unchanged`, no version spam); manifest stays valid after every op class.

## Acceptance
- [ ] All op classes implemented with anchor-scoped edits; untouched-bytes property holds on every
      fixture (including hand-written prose between sections).
- [ ] Result is a real new version through the existing ingest path — footprint/diff/GitHub-pull
      semantics unaffected; no in-place blob mutation anywhere.
- [ ] Stale-anchor concurrency guard (base `tree_sha` precondition) returns 409; no-op returns
      `unchanged`.
- [ ] Repo gate green.

## Notes
GitHub-sourced skills: an edit creates a local version on top of the imported history (allowed —
versions already interleave uploads and pulls); pushing back upstream is explicitly out of scope.
