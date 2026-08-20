---
type: "Work Package Spec"
title: "WP 3.9 \u2014 Application panel (responses & artifacts)"
description: "Phase: 3 \u00b7 Size: L \u00b7 Depends on: 3.3, 1.6"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.9 — Application panel (responses & artifacts)

**Phase:** 3 · **Size:** L · **Depends on:** 3.3, 1.6

## Objective
The Inspector's **Application** panel (Chrome-DevTools "Application" analog): browse **every response**
produced in the run and the **artifacts** — resources/documents the run **created or downloaded**
(MCP resources read, files tools wrote, downloadable outputs). New surface; not in the original `10`.

## Why / references
UI concept [`../../12-testing-inspector-devtools.md`](../12-testing-inspector-devtools.md) **§3.4**
(Application panel wireframe) and **§1** (DevTools Application → responses + artifacts mapping). The
owner asked specifically for "documents which have been created and downloaded." Security:
`.claude/rules/mcp-and-security.md` — untrusted output is previewed read-only, never HTML-injected.

## Files (new)
- `apps/web/src/features/testing/ApplicationPanel.tsx`
- `apps/web/src/features/testing/ArtifactPreview.tsx`

## Design (UI §3.4)
- **Layout:** `SplitPanel` — left a `Tree`/`TreeNode` (`@elabs-ai/components-ui`) of **Responses** (grouped by
  turn/tool) and **Artifacts**; right a preview pane.
- **Responses:** each `llm.resp` / `tool.result` payload; preview structured JSON in the read-only
  `CodeEditor` (`@elabs-ai/components-editor`, folding/search/copy — the manual-playground viewer), prose/markdown
  as `Text`.
- **Artifacts:** name, kind (`mime`), size, producing tool/step; **Preview** by type
  (`CodeEditor` / image / markdown) and **Download** (`<a download>` via `Button asChild`). Cross-link
  to the producing packet (shared selection, §4).
- Empty/loading/error via `StatePanel`; `tabular-nums` for sizes.

## Data
Run persistence (WP 1.6) must capture artifacts (resource reads + tool-written files) alongside
`RunStep`s; add an `artifacts` collection to the run record (coordinate with 1.6 / 0.4).

## Acceptance
- Responses tree lists every response; selecting one previews it read-only.
- Artifacts list shows created/downloaded documents with preview + working Download.
- Untrusted payloads never HTML-injected; secrets already redacted server-side.
- Both themes correct; gate: typecheck + build green.
