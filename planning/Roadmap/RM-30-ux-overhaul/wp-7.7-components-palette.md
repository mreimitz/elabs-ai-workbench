---
type: "Work Package Spec"
title: "WP 7.7 - components palette (draggable skill components + collapsible MCP Servers section)"
description: "Phase 7 round 2 of the UX overhaul. Ledger: STATUS.md. Rebuilds ToolsPalette into a two-section Components palette so every skill component is created by drag-from-palette, and the MCP Servers section absorbs the binding chips."
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-22T11:10:00Z"
status: "final"
---
# WP 7.7 — Components palette

Phase 7 **round 2** of [`STATUS.md`](./STATUS.md) (the ledger line for this WP is authoritative for
scope; this file is its expansion). Round 1's specs are in
[`phase-7-skill-studio.md`](./phase-7-skill-studio.md) — **this WP is not in that file**, because
7.7–7.9 came out of the owner's 2026-07-06 hands-on session as the **D-UX19** model correction.

**Owner decision this implements — D-UX19 #3** (full text in the ledger's decision log,
2026-07-06): *"creation is drag-from-palette (Components panel per SI12: skill components +
collapsible MCP Servers section with add/remove)"*, plus SI17.

**Depends on:** WP 7.1 (Studio shell), 7.3 (settings panel + the one draft store), 7.4 (files in
the same draft) — **all three are merged on `main`**.
**Blocks:** WP 7.8 (edge grammar) and WP 7.9 — both own `use-edit-ops`, so they run *after* this,
never beside it.
**Size:** L.

---

## 1. Start from the rescued work — do not restart

A previous agent built most of this and died on an API session limit mid-task. Its work was
committed verbatim as **`0e8c5b5`** on branch **`worktree-agent-a1a9666d118515f90`** (worktree
`.claude/worktrees/agent-a1a9666d118515f90`). It is **unreviewed, ungated, and it does not
typecheck** — the agent's last recorded words were *"now let's typecheck to find the fallout"*.

It contains, against `main`:

| File | Change |
| --- | --- |
| `design/ComponentsPalette.tsx` | **new**, 835 lines — the palette itself |
| `design/skill-components.ts` | **new**, 467 lines — the component catalog/model |
| `design/ComponentValueDialog.tsx` | **new**, 103 lines |
| `design/use-server-binding.ts` | **new**, 149 lines |
| `design/ToolsPalette.tsx` | **deleted** (350 lines) |
| `design/ToolsPalette.render.test.tsx` | **deleted** (130 lines) |
| `design/SkillGraphCanvas.tsx` | +65/− — drop wiring |
| `design/UnifiedEditor.tsx` | ±360 — palette host |

**Your first task is to judge it, not to trust it.** Bring the branch into your worktree, run
`pnpm typecheck`, and read what it actually does against §2 below. Keep what is right, fix what is
broken, delete what is wrong. If a part of it is unsalvageable, say so explicitly in your report
with the reason — replacing it is allowed; silently reverting to `main` and rebuilding from zero
without saying so is not.

**Note the deletion:** `ToolsPalette.render.test.tsx` went with `ToolsPalette.tsx`. Whatever the
palette becomes must arrive with **its own tests**; a net loss of coverage on this surface is a
failure of this WP, not a side effect.

## 2. What the palette is

One panel, **two sections**, replacing `ToolsPalette`.

### Section 1 — skill components (draggable)

Nine draggable component kinds, each dragging onto the canvas to create a node:

`keyword` · `/command` · `section` · `sub-routine` · `gatekeeper` · `validation gate` ·
`loop guard` · `reference` · `asset`

- Drag-from-palette is the **creation** path. A drop lands a node through `use-edit-ops` on the
  **one draft** WP 7.3 established — never a direct file write, never an immediate version save.
- A component that needs a value on creation (a keyword's text, a `/command`'s name, a reference's
  target) collects it through `ComponentValueDialog` rather than dropping an unnamed placeholder.
- Kind metadata comes from the existing `node-kind-meta.tsx` where it already exists — do not
  fork a second vocabulary of node kinds.

### Section 2 — MCP Servers (collapsible)

- **Collapsible** section whose header carries the **add** affordance (bind a server).
- Each bound server is a row with a **hover-remove**; its tools render beneath it.
- This section **absorbs `BindingChips`** — the bind chips stop being a separate strip.
- Server/tool data comes from the existing binding path (`use-bound-tools.ts`,
  `bind-server-candidates.ts`, `SkillBindingsPanel` / `BindServerDialog`); reuse it, do not
  re-derive a second source of bound-tool truth.

### What this deletes

- The **"Add command"** and **"Add section"** toolbar buttons — creation is the palette now.
- The **Legend** button (SI17).

Deleting them is part of the acceptance, not optional cleanup: two creation paths for the same
thing is exactly what D-UX19 corrected.

## 3. Rules that bind this WP

- **brand-ui only** (`.claude/rules/brand-ui-only.md`) —
  every visible element is an `@elabs-ai/components-*` component; semantic tokens only, no raw
  colours; `className` is layout-only. Check real props with `pnpm exec brand-ui docs <Component>`,
  never memory.
- **Icon affordances (D-TB5)** — any icon-only control (the hover-remove, the collapse toggle, the
  add button) is an `IconButton` with one `label` driving both tooltip and `aria-label`. No native
  `title`. See `.claude/rules/icon-affordances.md`.
- **Both themes** — `light` and `dark` must both read correctly.
- **Keyboard** — drag-from-palette is a pointer gesture; it MUST have a keyboard-reachable
  equivalent (an activate-to-insert on the palette item is acceptable). A creation path reachable
  only by mouse is a regression, since the toolbar buttons this WP deletes were keyboard-reachable.
- The Studio surface is `apps/web/src/features/skills/**`. **Do not touch** `apps/api/**`,
  `packages/shared/**`, or any migration — this WP is web-only.

## 4. Acceptance

- [ ] `ToolsPalette.tsx` no longer exists; `ComponentsPalette` replaces it at every call site.
- [ ] Section 1 offers all **nine** component kinds and each one creates a node on the canvas via
      `use-edit-ops` against the single draft.
- [ ] A component needing a value collects it before the node exists (no unnamed placeholder nodes).
- [ ] Section 2 is collapsible, adds a server from its header, removes a server on hover, and lists
      that server's tools beneath it.
- [ ] `BindingChips` is absorbed — the separate chip strip is gone from the design surface.
- [ ] The "Add command", "Add section" and "Legend" toolbar buttons are gone.
- [ ] Every creation offered by the palette is reachable by keyboard, with a visible focus ring.
- [ ] New tests cover the palette's render, the drop-creates-a-node path, and the server
      section's add/remove — at least replacing the coverage `ToolsPalette.render.test.tsx` carried.
- [ ] Gate green from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## 5. Out of scope

- **Edge grammar / legal-edge rules** — that is WP 7.8, and it owns `use-edit-ops` after you.
- **Dropping Flow|Code|Split** — WP 7.9.
- **Node-position persistence and any migration** — WP 7.8 decision 5.
- Tightening `extractConditions` — WP 7.8.

## 6. Report honestly

Nobody has ever used the Skill Studio in a browser. Three WPs have shipped into it and every visual
claim on record is a headless measurement. If you do not open a browser, **say so** — do not
describe the palette as "verified" on the strength of a passing test.
