---
type: "Work Package Spec"
title: "WP 3.6 \u2014 Step log + packet inspector"
description: "Phase: 3 \u00b7 Size: L \u00b7 Depends on: 3.4, 3.5"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.6 — Step log + packet inspector

**Phase:** 3 · **Size:** L · **Depends on:** 3.4, 3.5

## Objective
The right-pane bottom zone: a virtualized, filterable step/packet log, and the detail inspector to
"select and inspect every package."

## Why / references
UI concept [`../10-…ui-concept.md`](/Research/RS-11-testing-ui-concept/notes/testing-ui-concept.md) **§4 Zone C** (step-log wireframe)
and **§5** (packet inspector wireframe + tabs). Design lessons:
[`../references.md`](../references.md) → *MLflow — best UI* (click a span → detail panel; stable under
load) and *Braintrust* (scale rows by cost so the expensive step pops); *MCP Inspector* (raw JSON
request/response inspection — the prior art we extend).

> **Reframed (doc 12):** the step log becomes the **Network** panel (table **+ waterfall**) and the
> packet inspector becomes the shared **Inspector drawer**
> ([`../../12-testing-inspector-devtools.md`](../12-testing-inspector-devtools.md) §3.2, §3.5). The
> streaming **Console** stream splits out to **WP 3.10**. The waterfall + Timeline spans target the
> forthcoming `@elabs-ai/components-charts` **Gantt** (interim: a composed time-lane à la `TokenViz`).

## Files (new)
- `apps/web/src/features/testing/StepLog.tsx`
- `apps/web/src/features/testing/PacketInspector.tsx`

## Design — step log (UI §4 Zone C)
- **Virtualized** `@elabs-ai/components-data` `DataTable` of `RunStep`s in order. Columns: `#`, type icon
  (`llm.req`/`llm.resp`/`tool.call`/`tool.result`/`context.event`), label (model or tool), status,
  tokens ↑/↓, duration, and a **cost-weight** cell (a thin `Progress` tinted by relative cost — the
  Braintrust "weight by cost" idea).
- Filters: `FilterBar` + `FacetFilter` (type / server / errors-only), `SearchInput` (names + payloads),
  `ColumnPicker`. Filters cascade.
- Selecting a row sets shared selection (lifted to `RunConsole`) → opens the inspector + cross-
  highlights the left tool-card (WP 3.4). **Must stay smooth at 50+ steps** (virtualize; no per-row
  `getBoundingClientRect`).

## Design — packet inspector (UI §5)
A `Sheet` from the right (inline-expand on narrow widths). `Tabs`: **Overview** (`Descriptions`:
server/tool or model/params, status, duration, token summary per lens + actual + delta, bytes),
**Request** (exact payload sent incl. *tools offered*; `CodeBlock` + a `TokenViz` system/tool-defs/
history/output split), **Response** (content + finish reason + reasoning tokens), **Tokens** (per-lens
table vs provider-actual incl. cached/reasoning), **Raw** (full JSON, copyable, read-only).

## Acceptance
- Log stays smooth at 50+ steps (stress: rapid scroll + expand/collapse).
- Selecting a row opens the inspector and cross-highlights the left tool card; the reverse works too.
- Tokens tab shows estimator-vs-actual delta; Request tab attributes prompt composition.
- Raw payloads render read-only (untrusted output never HTML-injected); secrets already redacted
  server-side.
- Both themes correct; gate: typecheck + build green.
