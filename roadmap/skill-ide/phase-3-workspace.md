# Phase 3 — Workspace: files & folders (WP specs)

## WP 3.1 — Tree edit ops → new version
**Size:** L · **Depends on:** — (independent of Phase 1; serialize vs WP 1.1 on `packages/shared`) · API

**Objective:** file/folder management as tree-level edit ops producing a new immutable version —
create folders and subfolders, create/rename/move/delete/edit files (I3).

**Files:** `apps/api/src/skillflow/tree-ops.ts` (new), `apps/api/src/skillflow/routes.ts`
(extend `POST …/versions/:vid/edits` to accept tree ops alongside text ops in ONE batch — one
save, one version); tests `apps/api/test/skill-ide-tree-ops.test.ts`.

**Semantics:** `add_file { path, content(base64|utf8), kind? }` (caps enforced — reuse
`SKILL_MAX_*`), `update_file { path, content }`, `rename_file { from, to }` (move = rename with
a different dir prefix), `delete_file { path }`. Guards: `SKILL.md` cannot be deleted/renamed;
path traversal refused; duplicate/target-exists → 400; folders are implicit path prefixes
(an `add_file` under a new prefix creates the "folder"); renaming a folder = batch of
`rename_file` ops the UI composes. Footprint recount + kind reclassification via the existing
ingest building blocks; blobs deduped as always. Text ops and tree ops in one batch apply
text-first (SKILL.md), then tree — one `createVersion`.

**Acceptance:** every op round-trips (new version, untouched files' blob shas identical);
SKILL.md guard + caps + traversal tests; mixed text+tree batch produces one version; diff
(WP 1.5 skills plan) labels adds/removes/renames correctly (rename detection via blob sha
already exists — verify); gate green.

## WP 3.2 — Files tab → file manager
**Size:** L · **Depends on:** 3.1 · Web-only

**Objective:** the read-only file explorer becomes a workspace: folder tree with create
folder/subfolder, new file, upload file, rename, move (dialog with folder picker), delete
(confirm), and Monaco editing of text files — all staged as tree ops and saved through the
existing Save dialog as one new version.

**Files:** `apps/web/src/features/skills/SkillFileExplorer.tsx` (evolves), small
`workspace/`-scoped components as needed, `skills-inspector-api.ts` (edits body already
supports the batch — extend the client type), reuse `use-edit-ops` buffer (extended for tree
ops) + `SaveVersionDialog`.

**Acceptance:** live loop: create folder → create file in it → edit content → move a file →
delete a file → one Save → new version whose file tree reflects all of it and the diff is
correct; SKILL.md rename/delete affordances absent; binary files view-only; unsaved-changes
guards; both themes; gate green + smoke screenshots.

**Implementation notes (verified 2026-07-04 — see also [`references.md`](./references.md)):**

- **`@elabs-ai/components-ui` ships `Tree`** (`TreeNode<T>`, `TreeProps` with selection + `virtualize` +
  async `loadChildren`) **and `useTreeKeyboard`** — compose these for the folder tree. Do NOT
  hand-roll a tree; this is not an upstream gap.
- Text editing = `CodeEditor` from `@elabs-ai/components-editor` (already used in `NodeDetailPanel`), language
  inferred from extension; binary detection comes from the API's file metadata (`isBinary` runs
  server-side — don't re-detect client-side).
- Folder rename/move = a client-composed batch of `rename_file` ops (one per contained file) —
  preview the batch in the Save dialog as a single logical action with the per-file list
  expandable.
- Also closes the 3.1 follow-up (ledger note): wire env ingest caps (`SKILL_MAX_*` from
  `config/env.ts`) into the edits route in place of `DEFAULT_INGEST_CAPS` + one test proving an
  env override caps a tree op.
