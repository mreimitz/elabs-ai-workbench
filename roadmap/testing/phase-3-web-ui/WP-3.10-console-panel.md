# WP 3.10 — Console panel (event stream)

**Phase:** 3 · **Size:** M · **Depends on:** 3.3, 2.2

## Objective
The Inspector's **Console** panel (Chrome-DevTools "Console" analog): the live, chronological,
human-readable event stream — reasoning/output deltas, tool call/result one-liners, warnings/errors,
and (behind a filter) raw JSON-RPC protocol frames. Distinct from the structured **Network** table
(WP 3.6); this is the "watch it run" narration.

## Why / references
UI concept [`../../12-testing-inspector-devtools.md`](../../12-testing-inspector-devtools.md) **§3.1**
(Console wireframe) and **§1** (DevTools Console patterns: levels, filter, preserve-log, clear). Prior
art: [`../references.md`](../references.md) → *MCP Inspector* (raw request/response frames we surpass).

## Files (new)
- `apps/web/src/features/testing/ConsolePanel.tsx`

## Design (UI §3.1)
- **Virtualized** append-only log (windowed list / `@elabs-ai/components-data` `DataTable` in single-column mode) —
  **must stay smooth at 50+ events** (no per-row `getBoundingClientRect`; throttle to animation
  frames while streaming).
- **Levels:** `All ▸ Errors ▸ Warnings ▸ Info ▸ Protocol`; severity via tokens
  (`text-destructive-text` / `text-warning` / `text-muted-foreground`), `Badge`/`StatusBadge` glyphs;
  an "errors (n)" counter chip.
- **Command bar:** `SearchInput` (text), `FilterBar`/`FacetFilter` (level/type), **preserve-log**
  toggle, **clear**. Expand a row → raw frame in `CodeBlock`.
- Selecting an event sets shared selection (lifted to `RunConsole`) → opens the drawer (WP 3.6) and
  cross-highlights Network/Timeline + the left tool-card (WP 3.4).

## Acceptance
- Streams live during a run; level filter + search + preserve-log + clear work; errors counter ticks.
- Stays smooth at 50+ events (stress: rapid stream + scroll).
- Selecting an event cross-highlights Network/Timeline and the conversation tool-card.
- Raw frames read-only; secrets redacted server-side. Both themes correct; gate: typecheck + build green.
