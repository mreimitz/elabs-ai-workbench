---
type: "Work Package Spec"
title: "Skill IDE \u2014 code-reality index (verified 2026-07-04)"
description: "Facts an executing agent would otherwise have to rediscover (or worse, guess). Everything below"
tags: ["roadmap", "RM-22"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Skill IDE — code-reality index (verified 2026-07-04)

Facts an executing agent would otherwise have to rediscover (or worse, guess). Everything below
was **verified against the working tree on 2026-07-04** (post WP 1.1/1.2/3.1/7.1). If code has
moved since, trust the code and update this file. Per-WP algorithmic notes live inline in the
`phase-*.md` files; this is the shared inventory.

## Layout & canvas (WP 1.3, 2.2)

- `apps/web/src/features/skills/design/graph-layout.ts` (141 lines) — **hand-rolled
  deterministic layered layout, no layout dependency** (owner-gated to add one). Constants:
  `COLUMN_WIDTH = 260`, `ROW_HEIGHT = 140`, `SIDE_ROW_STEP = 88`, main column at `x = 0`.
- Ordering = document order: `anchor.startLine`, tie-broken by node id (`byDocumentOrder`).
- **Section vs accessory is decided by "has an outgoing edge"**, not by `kind` alone
  (annotated section-level gates would be under-counted otherwise). Accessories sit in side
  columns at their owner's row (owner = first edge pointing at them, `buildOwnerMap`).
  Orphans fall back to the main-column tail; layout never throws.
- Canvas: `SkillGraphCanvas.tsx` (277) wraps `@elabs-ai/components-flow`; node styling meta in
  `node-kind-meta.tsx`; detail panel `NodeDetailPanel.tsx` (663) already embeds
  `CodeEditor` from `@elabs-ai/components-editor` (read-only anchored excerpt + editable section body).

## Edit-ops machinery (WP 2.1, 2.2, 3.2)

- `apps/api/src/skillflow/edit-ops.ts` (263) — `validateEditOps`; the ten IDE ops
  (`add_command` … `delete_file`) are **live 400-stubs naming their implementing WP**; the
  file-op cases were replaced by WP 3.1, the command/keyword/asset cases are 2.1's to replace.
- `apps/api/src/skillflow/roundtrip.ts` (615) — the anchored-splice application engine
  (byte-exactness outside spans, stale-anchor 409, one `createVersion` per batch). Node anchors
  carry `startLine`/`endLine`.
- `apps/api/src/skillflow/annotations.ts` (90) — grammar: `<!-- skillflow:KEYWORD id=X -->` on
  its own line **directly above a heading**; known keywords today: `gatekeeper`, `gate`,
  `command`. **Unknown keywords produce a warning** — WP 5.1 must REGISTER `servers` here or
  every scope annotation will warn.
- `apps/web/src/features/skills/design/use-edit-ops.ts` (233) — `useEditOps(): EditOpsController`:
  append-ordered `ops` buffer, `hasPending`, per-node/per-edge pending queries, staged-removal
  conflicts are silent no-ops, client-side preview apply (`PREVIEW_NODE_PREFIX = "preview:new:"`).
  Its header says "NEVER canvas drag-to-draw" — that guards *freehand* drawing; Skill IDE I2's
  constrained drag-to-connect (staging `connect_asset`) supersedes it for WP 2.2. **Update the
  comment in 2.2**, don't treat it as a blocker.
- `yaml@^2.9.0` is already an `apps/api` dependency (for `set_keywords` frontmatter work — no
  new-dependency approval needed).

## Matching & scan data (WP 5.1, 6.1)

- `apps/api/src/compare/matching.ts` — reuse, don't re-implement: `normalizeName` (lowercase +
  strip all non-alphanumerics — **no pluralization**), `tokenize` (camelCase + boundary split),
  `similarity` (Jaccard over token sets), `matchTools(aTools, bTools, threshold)`.
  `DEFAULT_COMPARE_THRESHOLD = 0.6` (`packages/shared/src/constants.ts:31`).
- `apps/api/src/scans/repository.ts` — `ScanRepository.getLatestForServer(serverId)` exists
  (used by scan routes); use the repository's existing per-server scan history access for the
  stale (N−1) lookup rather than new SQL where possible.
- `mcp_tool_scans` columns relevant to validation/quality: `tool_name`, `description`,
  `input_schema_json`, `annotations_json`, `raw_tool_json`, per-facet token counts.

## Component library (WP 1.3, 3.2, 5.2, 7.2)

- **`@elabs-ai/components-ui` ships `Tree`** (`TreeNode<T>` with `children`, `TreeProps` incl. `virtualize`,
  async `loadChildren`, selection) **plus `useTreeKeyboard`** — the 3.2 file manager composes
  these; do NOT hand-roll a tree (library-first rule satisfied, no upstream gap).
- **`@elabs-ai/components-editor` `CodeEditor`** props (from the `.d.ts`): `value/language`, `options`
  (raw Monaco construction options), `contextMenu: "brand" | "monaco" | "none"`, and
  **`onMount(editor, monacoApi)`** exposing the full `monaco` namespace + a ref to
  `IStandaloneCodeEditor`. Markers for WP 5.2 =
  `monacoApi.editor.setModelMarkers(editor.getModel(), "tool-validation", markers)`; clear on
  unmount/re-validate. `@elabs-ai/components-editor/monaco-environment` is already imported once at
  `apps/web/src/main.tsx:8` — do not import it again.
- Skill inspector tab order today: overview · design · trace · files · versions · diff
  (`SkillInspector.tsx` ~line 366). Quality (4.3) inserts after trace.

## Test infrastructure

- Skillflow fixtures (`apps/api/test/fixtures/skillflow/skills/`): `annotated`,
  `blank-scaffold`, `github-style` (has real frontmatter — good `set_keywords` case),
  `multi-command` (11 nodes / 9 edges / 3 flows, from WP 1.2), `zero-annotation` (the
  regression-lock fixture).
- Playwright: `@playwright/test@1.56.0` root devDep, `e2e/smoke.spec.ts`, `pnpm test:e2e`
  (builds first). Smoke screenshots in acceptances are runnable today; e2e failures are not
  part of the four-command gate.
- `isBinary(bytes)` is exported from `apps/api/src/skills/repository.ts:731` (3.2 reuses the
  API's binary flag; don't re-detect client-side).
- Publish (7.2): `PublishToGithubInput` landed in shared (WP 1.1); `SkillPublishService`
  (`apps/api/src/skills/publish-service.ts`) takes an injectable `createRepo` — offline tests
  use `file://` bare repos (pattern to copy for any new git-touching test).
