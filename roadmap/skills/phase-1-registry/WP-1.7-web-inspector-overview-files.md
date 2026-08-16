# WP 1.7 — Web: inspector Overview + Files explorer

**Phase:** 1 · **Size:** L · **Depends on:** 1.3

## Objective
Build the inspector's **Overview** (auto-surfaced rendered `SKILL.md` + frontmatter + token-footprint
metrics + security strip + export + update badge) and the **Files** tab (full `FileTree` explorer +
read-only viewer).

## Why / references
[`../../research/skill-registry/07-ui-plan.md`](../../research/skill-registry/07-ui-plan.md) §4
(Overview, Files), mockups `#1`,`#3`. Uses `FileTree`@ai, `CodeEditor`/`MarkdownEditor`@editor,
`MetricCard`@charts, existing `TokenViz`, `ResizablePanelGroup`/`Tabs`/`Breadcrumb`/`Badge`@ui.

## Files
- `apps/web/src/features/skills/SkillInspector.tsx` *(create)* — header (version picker: Latest /
  specific), `Tabs` (Overview | Files | Versions[placeholder→1.8] | Diff[placeholder→1.8]),
  "Pull latest"/"Download .zip"/update badge.
- `apps/web/src/features/skills/SkillOverview.tsx` *(create)* — rendered SKILL.md + frontmatter
  `Descriptions` + L1/L2/L3/total MetricCards + segmented bar + security strip (scripts / network refs
  / file+byte totals).
- `apps/web/src/features/skills/SkillFileExplorer.tsx` *(create)* — `FileTree` (flat list → nested in
  `useMemo`) + viewer (text → CodeEditor; markdown → rendered/raw; binary → size + download via
  `/raw`); `Breadcrumb`.
- `apps/web/src/features/skills/skills-inspector-api.ts` *(create, or extend `lib/api.ts` read-only
  helpers)* — versions/files/file/upstream/export wrappers **only if not already added in 1.6**
  (coordinate: read-only version/file/upstream/export helpers belong here to avoid touching `api.ts`).

## Acceptance
- [ ] Selecting a skill opens Overview on the **rendered SKILL.md** with frontmatter, the three-level
      token metrics + segmented bar, and the security strip; "Download .zip" downloads the version;
      an "update available" badge shows when `GET /:id/upstream` reports one (GitHub skills).
- [ ] Files tab shows the full tree incl. subfolders with per-file token chips; text files render in a
      read-only viewer, binary files show size + download, markdown toggles rendered/raw; breadcrumb
      tracks the path.
- [ ] `@brand/*` + tokens only; both themes correct; hooks clean; repo gate green.
- [ ] **Owner-verify (localhost:8080):** explore a real multi-folder skill; two-theme walk.

## Notes
To avoid colliding with WP 1.6 on `lib/api.ts`, put the inspector's **read-only** API helpers in
`skills-inspector-api.ts`. Versions/Diff tabs are placeholders here; WP 1.8 fills them. Can run in
parallel with 1.4/1.5 (backend) but **not** with 1.6/1.8 (web-file overlap on inspector files).
