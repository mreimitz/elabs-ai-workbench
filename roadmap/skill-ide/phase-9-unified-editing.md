# Phase 9 — Unified Flow/Code editing + education layer (WP specs) · locked decision I10

> Owner-locked 2026-07-04. Runs AFTER Phase 8 (recommended waves: W10 `9.1` → W11 `9.2 ∥ 9.3`
> → W12 `9.4`). Architecture: **one document, two live views** — see I10. 9.1 migrates the
> staged-op UX that 2.2/3.2 ship; those WPs proceed unchanged in W3–W6.

## Parity matrix (the tested contract — every row must work in BOTH modes)

| Operation | Flow gesture | Code idiom (+ assist) |
|---|---|---|
| Create /command flow | Toolbar → Add command dialog | Type `## /name` (snippet `/cmd`) |
| Rename /command | Entry-node panel → rename | Edit the heading token |
| Delete /command flow | Entry-node panel → delete (confirm) | Delete the section range (decoration shows flow extent) |
| Edit section body | Node panel Monaco | Edit in place |
| Set keywords | Triggers panel (6.1) chip editor | Edit frontmatter `keywords:` (snippet) |
| Connect asset | Drag section→asset | Type relative path reference (completion from file tree) |
| Reference a tool | Drag from Tools palette (8.3) | Backticked name (completion from bound scans, 8.2) |
| Add gatekeeper w/ breadcrumb | Node panel → convert + inject sentence | Snippet `gate` (heading + branches + marker line) |
| Pin an id / scope servers | Node panel annotation editor | `<!-- skillflow:… -->` (snippet + hover) |
| File create/rename/move/delete | Files tree (3.2) | n/a (tree-level) — visible in both via pending-changes bar |

## WP 9.1 — Live-draft engine: apply-preview, project-preview, save, migration
**Size:** L · **Depends on:** 1.2, 2.1, 3.1 · API + Web state core

**Objective:** the I10 foundation — one canonical draft, both views live, op audit preserved.

**Files:** API — two stateless, pure endpoints (nothing persisted, no auth to skill state
beyond read): `POST /api/skillflow/apply-preview` (`{ content, ops }` → `{ content′,
warnings }` — wraps the SAME `roundtrip.ts` splice engine; refuses ops whose anchors don't
resolve against `content` with the existing 409 semantics as a 400-with-reason here) and
`POST /api/skillflow/project-preview` (`{ content }` → `{ graph, warnings }` — wraps the
projector; stamped with `SKILLFLOW_PROJECTOR_VERSION`). Web — `use-skill-draft.ts`: the draft
store (content + pending tree ops + op **intent log**), canvas interactions call apply-preview
then update the draft; code edits update it directly; project-preview debounced ~300 ms with
last-good-projection retention; **save** = new-version request `{ baseVersionId, content,
treeOps, intentLog }` (409 when head moved; intent log lands in version metadata); unsaved
guards. **Migration:** `use-edit-ops` consumers (NodeDetailPanel, SaveVersionDialog, 2.2/3.2
surfaces) move onto the draft store — the buffer API remains as the interaction layer that
feeds apply-preview, so panel code changes stay mechanical.

**Acceptance:** property test API-side: for every existing op fixture, apply-preview equals the
persisted-path splice byte-for-byte; project-preview equals persisted projection for all
fixtures; web: canvas edit → code view shows it immediately; code edit → canvas re-projects;
save produces one version whose diff matches the draft and whose metadata carries the intent
log; stale base → 409 surfaced; the 2.2/3.2 flows still pass their acceptance on top of the
draft store; gate green.

## WP 9.2 — Unified editor shell: mode toggle, split view, selection sync
**Size:** L · **Depends on:** 9.1, 1.3 · Web-only

**Objective:** "Show flow | Show code" as one surface, not two tabs.

**Files:** `design/UnifiedEditor.tsx` — segmented control (Flow | Code | Split), Flow = the
existing canvas, Code = full-document `CodeEditor` on the draft, Split = side-by-side
(resizable); **selection sync via anchors both ways** (node click → cursor + reveal at
`anchor.startLine`, cursor move → highlight owning node, debounced); one pending-changes bar +
Save/Discard across modes (tree changes listed alongside); Design tab hosts the surface;
Files tab's SKILL.md entry opens it (other files keep the plain editor). Deep links
(`?mode=code&line=…` / `?node=…`) for problems-panel navigation (9.4).

**Acceptance:** live walk: edit in flow → switch → the exact text change is there → edit text →
switch → graph updated; split view syncs selection live; mode/split state survives tab
switches; no double-mount of Monaco (single model shared); keyboard reachable; both themes;
gate green + smoke screenshots.

## WP 9.3 — Code-mode intelligence: decorations, construct hovers, snippets
**Size:** L · **Depends on:** 9.1 · Web-only (reads existing endpoints)

**Objective:** the code editor understands SKILL.md as a language and teaches it (I10.5's
code half + parity assists).

**Files:** `design/code-intel/` — a Monaco wiring module registered via `CodeEditor`
`onMount`: **decorations** from the live projection (gutter icon per heading = its node kind,
flow-extent line tinting per `flowId`, annotation/breadcrumb line markers, asset/tool
reference underlines); **hovers** for every construct (frontmatter keys, annotations,
breadcrumb markers, headings→kind, tool/asset refs) rendering the explainer registry entry
(9.4) + guide anchor link — tool hovers defer to 8.2's provider when bound; **completions/
snippets**: section template, `/command` scaffold, gatekeeper-with-breadcrumb block,
`skillflow:*` annotation forms, frontmatter `keywords:`/`servers:` blocks, relative-path
completion for asset refs (from the version's file tree). All providers disposed on unmount;
all content sourced from the draft's live projection — no server round-trip per keystroke
beyond the debounced previews.

**Acceptance:** fixture walk in code mode: every construct in the `multi-command` +
`annotated` fixtures shows its decoration + hover; each snippet inserts text that projects to
the intended node kind (asserted via project-preview); no provider leaks across remounts;
both themes; gate green + smoke screenshots.

## WP 9.4 — Education layer: explainer registry + unified problems panel
**Size:** M · **Depends on:** 9.1 (4.1/5.1 aggregated when present) · shared + Web

**Objective:** the IDE explains itself identically in both modes (I10.5).

**Files:** `packages/shared` (or web-local if no API need): the **explainer registry** — one
entry per element (6 node kinds + `tool_ref`, edge kinds, frontmatter keys, annotation
keywords, breadcrumb marker, asset/tool reference): `{ id, title, short, guideAnchor }`,
content aligned 1:1 with `docs/skill-authoring.md` anchors (test: every registry
`guideAnchor` resolves to a real heading). Web — `NodeDetailPanel` "What is this?" section per
kind; a canvas **legend** popover (all kinds with explainers); the **unified problems panel**:
aggregates live projector warnings (always) + quality findings (when 4.3 merged) + tool
diagnostics (when 5.1 merged) into one list rendered identically in Flow and Code modes, each
item deep-linking the node (flow), the line (code, via 9.2 deep links), and the guide anchor.
Empty states educate ("No problems — here's what we check…").

**Acceptance:** every registry entry renders in panel + legend + code hover (9.3 consumes the
same registry — asserted single source); problems panel shows a seeded projector warning in
both modes with working triple deep links; registry↔guide anchor test green; both themes;
gate green.
