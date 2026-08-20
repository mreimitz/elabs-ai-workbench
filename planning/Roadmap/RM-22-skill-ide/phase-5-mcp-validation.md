---
type: "Work Package Spec"
title: "Phase 5 \u2014 MCP-aware smart validation (WP specs)"
description: "Size: L \u00b7 Depends on: 1.2 \u00b7 API"
tags: ["roadmap", "RM-22"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 5 — MCP-aware smart validation (WP specs)

## WP 5.1 — Tool-reference extraction + validation vs latest MCP scans
**Size:** L · **Depends on:** 1.2 · API

**Objective:** the killer integration (I5): skill text referencing MCP tools is validated
against the latest persisted scans of registered servers — no live MCP calls.

**Files:** `apps/api/src/skillflow/tool-validation.ts` (new), routes end-hunk
`GET /api/skills/:id/versions/:vid/tool-diagnostics`; tests
`apps/api/test/skill-ide-tool-validation.test.ts`.

**Mechanics:** extraction — backtick-quoted identifiers that look like tool names
(`snake_case`/`kebab-case`/`namespaced:tool`), plus explicit `<!-- skillflow:servers a,b -->`
scope annotation parsing; candidate set — per registered server, its LATEST completed scan's
`mcp_tool_scans` names (via existing repositories); matching — exact → normalized → fuzzy,
REUSING the compare feature's existing matching helpers (`apps/api/src/compare/` — do not
re-implement); diagnostics — `unknown_tool` (no match anywhere, with top-3 candidates),
`stale_tool` (matched in an older scan of a scoped server but absent from its latest scan).
Anchored to the line of the reference. Deterministic; stamped `TOOL_VALIDATION_VERSION`.
Extraction must be conservative (identifier shape + context words like "tool"/"call"/backticks)
— false positives are worse than misses; document the heuristic.

**Acceptance:** fixture test seeds two fake servers + scans (repository level): a skill
referencing a real tool (clean), an unknown tool (diagnostic + candidates), and a tool present
in scan N−1 but not N (stale). Scope annotation narrows the server set. No MCP connection is
opened (assert by construction — the module imports no MCP client). Gate green.

**Implementation notes (verified 2026-07-04 — see also [`references.md`](./references.md)):**

- **Register `servers` in `annotations.ts`** — the parser warns on unknown `skillflow:*`
  keywords today, so an unregistered scope annotation would warn on every projection. Grammar:
  `<!-- skillflow:servers a,b -->` (comma list of server names; trim + case-insensitive match
  against registered server names).
- **Extraction (conservative, documented):** backticked identifiers matching
  `/^[a-z0-9]+([_-][a-z0-9]+)+$/i` or `server:tool` form, accepted only with a context signal —
  the same or adjacent line contains "tool"/"call"/"invoke"/"use", OR the identifier already
  appears as a projector-extracted tool-call name. Single bare words never match (false
  positives are worse than misses).
- **Matching reuse:** candidates per server from `ScanRepository.getLatestForServer(serverId)`
  (`mcp_tool_scans.tool_name`); bands: exact equality → `'exact'`; `normalizeName` equality →
  `'normalized'`; `similarity ≥ DEFAULT_COMPARE_THRESHOLD` (0.6, shared constants) → `'fuzzy'`;
  top-3 candidates by score. Import from `apps/api/src/compare/matching.ts` — no local copies.
- **Stale lookup:** per scoped server, walk its scan history (existing repository access) —
  matched (exact/normalized) in any older completed scan but absent from the latest ⇒
  `stale_tool`. Servers with zero completed scans are skipped and reported in the response
  (`unscannedServers: [...]`) rather than producing false `unknown_tool`s.

## WP 5.2 — Editor markers + canvas tool badges + scope config
**Size:** M · **Depends on:** 5.1 · Web-only

**Objective:** surface diagnostics where authors work: Monaco markers in every SKILL.md editing
surface, badges on canvas nodes whose section carries a diagnostic, and a small scope editor.

**Files:** `apps/web/src/features/skills/design/{NodeDetailPanel.tsx, SkillGraphCanvas.tsx}`
(badges via node subtitle/Badge — tone warning), the Monaco marker wiring where SKILL.md is
edited (body editor in NodeDetailPanel; Files-tab editor — 3.2 lands in the wave before this
WP, so integrate it), `skills-inspector-api.ts`. The diagnostics section in the Quality tab is
**WP 4.3's job** (4.3 merges after this WP — review 2026-07-04 finding 1).

**Acceptance:** live: a skill referencing a nonexistent tool shows a warning badge on the
section node + a Monaco squiggle with the candidate list in the hover/panel; scope annotation
editable via the panel (stages `set_annotation`); both themes; gate green + smoke screenshot.

**Implementation notes (verified 2026-07-04):** `CodeEditor` exposes the full Monaco namespace
via `onMount(editor, monacoApi)` — set markers with
`monacoApi.editor.setModelMarkers(editor.getModel(), "tool-validation", markers)`
(severity `Warning`, marker range from the diagnostic's anchored line, message = diagnostic +
top candidates); clear by setting `[]` for the same owner on re-validate/unmount.
`@elabs-ai/components-editor/monaco-environment` is already imported once in `main.tsx` — never import it a
second time. Canvas badges reuse the node subtitle/`Badge` pattern from `node-kind-meta.tsx`.
