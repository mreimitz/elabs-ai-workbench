---
type: "Work Package Spec"
title: "WP 4.1 \u2014 Two-theme + accessibility pass"
description: "Phase: 4 \u00b7 Size: M \u00b7 Depends on: Phase 3"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 4.1 — Two-theme + accessibility pass

**Phase:** 4 · **Size:** M · **Depends on:** Phase 3

## Objective
Make every new surface read correctly in both themes (light, dark) and meet the repo's a11y bar, with the log
verified stable under load.

## Why / references
`.claude/rules/styling-and-tokens.md` (two themes, tokens only),
`.claude/rules/interaction-guidelines.md` (focus, keyboard, virtualization), UI concept
[`../10-…ui-concept.md`](../../../Research/RS-11-testing-ui-concept/notes/testing-ui-concept.md) §10.

## Scope / checklist
- **Themes:** verify `light` and `dark` by
  looking at the running app. Special attention: the context chart's `--chart-1..5` fills and the
  overflow/destructive markers in BOTH themes. No raw colors anywhere
  (`check-tokens` clean).
- **Keyboard:** the step log is arrow-navigable; the inspector opens on Enter; the scrubber is
  keyboard-operable; composer send on ⌘/Ctrl+Enter. Visible focus (`ring-ring`) on every control;
  no `div`-as-button.
- **Density without noise:** whitespace + `tabular-nums` separate the dense right rail, not color.
- **Stability under load:** with a 50+ step run, rapidly expand/collapse the log and the inspector —
  no virtualized rendering defects, no layout thrash. Throttle live chart/counter updates to animation
  frames.
- **Content handling:** long tool names / payloads truncate/`line-clamp`/`break-words`; flex children
  carry `min-w-0`; every list has a real empty state (`EmptyState`).

## Acceptance
- A reviewer walks both themes (light, dark) for every Testing surface with zero raw-color/contrast issues.
- Keyboard-only operation of a full run + inspect + replay works.
- The 50+ step stress test is smooth.
- Gate: typecheck + build green.
