# Phase 7 — Skill Studio (audit SI1–SI8 + §I) — the authoring rethink

Source: audit `#### Skill IDE deep-dive` (SI1–SI8) + `## I. Skill Studio` (the spec — read it IN
FULL before any WP here). Owner-locked as **D-UX17**. Depends on Phase 6's WP 6.1 (PageShell
`fill` scroll mode) and honors **D-UX16** (centered full-width tab strips) for the Inspector side.

**Batching:** 7.1 ∥ 7.2 → 7.3 → (7.4 ∥ 7.6) → 7.5. All work in `apps/web/src/features/skills/**`
— WPs here declare disjoint SUBFOLDERS; the PM enforces per-file domains inside the feature.
Existing carry-forward to honor: the skill inspector's sub-tab selection is local state — the new
`/skills/:id/studio` route must carry mode/file/selection in the URL (closes that gap for skills).

---

## WP 7.1 — Studio register & shell (I1/I2, SI5)
**Domain:** NEW `features/skills/studio/` (StudioShell, toolbar, rail frame, route) + minimal
route line in App.tsx (hot file) + "Edit in Studio" entries in the inspector.
**Steps:** route `/skills/:id/studio?mode=&file=&sel=`; full-viewport workbench on PageShell
`fill` (6.1): slim toolbar `[← Exit][Flow|Code|Split][Problems n][dirty][Save as vN]`; left rail
(collapsible, tabs Files·Tools·Settings — content stubs mounting the EXISTING palette/tree
components); right context panel (collapsible, empty-collapsed by default — never a reserved
blank column); bottom Problems strip (existing component). Move the existing Flow/Code/Split
editor mount into the center surface. Inspector's Design tab is replaced by a read-only flow
preview + "Edit in Studio" (editing lives in Studio only). Exit with dirty draft → existing
discard guard.
**Acceptance:** center surface ≥60% viewport width at 1600×1000 with both rails open, more when
collapsed; toolbar never scrolls; URL round-trips mode/file/selection; Inspector shows no save
bars anywhere. Gate green; both themes.
**Size:** L.

## WP 7.2 — Canvas repair (SI4, closes K3 for real) — parallel with 7.1
**Domain:** `features/skills/design/` layout/node/edge files ONLY (the canvas internals — no
shell files).
**Steps:** set `sourcePosition: Position.Right` / `targetPosition: Position.Left` on every node
type (incl. tool-reference nodes); smoothstep edge type; increase rank separation; `fitView`
(padding ~0.15) on mount AND after auto-layout; minimum node label size at fit ≥11px (scale node
box, not just font); palette/legend must not overlay the canvas (dock or float-collapsed).
**Acceptance:** measured: all handles report left/right; no edge attaches top/bottom; first rank
fully visible on mount; the v4 skill's graph reads left→right without edge crossings through
nodes. Screenshots both themes. Gate green.
**Size:** S–M.

## WP 7.3 — Skill-settings panel + server binding UI + one draft store (I3/I7, SI1/SI3/SI8)
**Domain:** `features/skills/studio/settings/` (new) + a shared `studio/draft.ts` store +
Overview triggers card demotion (read-only) in `features/skills/`.
**Steps:** draft store spanning frontmatter+code+canvas (files join in 7.4): one dirty flag, one
`Save as vN` action (toolbar), version bump named on the button; settings panel fields: name ·
description · **servers** (picker over registered servers via existing servers API — show scan
status, inline "Scan now" for unscanned per SI1; bind/unbind writes `servers:` in the draft) ·
keywords chips · command entry points editor. Two-way sync with Code view via the existing
code↔flow sync engine. Overview's keyword editor + "Save as new version" button are REMOVED
(read-only summary + "Edit in Studio" link); the Tools palette empty state now says "Bind a
server in Settings →" and deep-links the rail tab.
**Acceptance:** audit §I8 first half: bind a server, add keyword + command, save exactly ONE new
version, YAML never hand-edited; Code view reflects each settings change live; Overview mutation-
free. Gate green; both themes.
**Size:** L.

## WP 7.4 — Editable files, multi-tab editor (I5, SI2) — after 7.3 (consumes the draft store)
**Domain:** `features/skills/studio/files/` (new) + the Files inspector tab (browse-only wiring).
**Steps:** Studio Files rail: tree (existing component) + editor TABS in the center surface; any
text file editable (shared editor instance); SKILL.md tab exposes Flow/Split modes, other files
Code only; new file → immediately editable buffer in the draft; binary → preview; delete/rename
flow through the draft (applied on save). Inspector Files tab: browse + read-only preview +
"Edit in Studio" (its Save…/Discard bar is deleted).
**Acceptance:** §I8 middle: create an L3 resource file, type content, reference it, save — one
version; L3 token card on Overview reflects it after save; read-only badge gone from Studio,
present in Inspector. Gate green; both themes.
**Size:** M–L.

## WP 7.5 — Tool-reference decoration pipeline (SI7) — after 7.4
**Domain:** `features/skills/studio/` editor decoration module + Quality-tab shared validation
util (read-only reuse of the existing scan-aware reference checker).
**Steps:** one decoration pass over the shared editor: known tool refs (bare AND backticked)
styled + hover tool-card (name · server · tokens · scan status); unknown/unresolvable refs get
warning underline wired into the Problems panel (same rule source as Quality's tool-reference
check); decorations identical in Code mode, Split mode, and every file tab.
**Acceptance:** in SKILL.md v4: `qlik_search`, `qlik_get_data_model`, `qlik_create_data_object`
decorated with correct hover cards; a nonsense ref underlined + listed in Problems; same result
in Split and in a second file. Gate green; both themes.
**Size:** M.

## WP 7.6 — Trace as a lens (I6, SI6) — after 7.2, parallel with 7.4
**Domain:** `features/skills/trace/` + the Studio toolbar's lens toggle + Inspector Trace tab
rewiring.
**Steps:** delete the bespoke trace page layout (the 242px void + floating legend + under-panel
canvas). Trace = overlay mode of the SAME canvas component: run picker + conformance chips
(value-aware, K4) in the toolbar row; nodes tinted by trace state; Evidence list in the right
context panel; legend docked inside that panel; Inspector Trace tab mounts the identical
component read-only at full height (PageShell fill).
**Acceptance:** zero dead vertical space above the canvas in both Inspector-Trace and Studio-lens;
evidence click focuses the matching node; legend never overlays the canvas; the all-unmatched
verdict line preserved. Gate green; both themes.
**Size:** M–L.

## Owner-acceptance addition (appended to the ledger walk)
- [ ] §I8 end-to-end: blank skill → bind server → reference 2 tools → keyword + command → create
  + fill one resource file → ONE save → flow reads left-to-right with side-attached edges →
  run a test → trace lens on the same canvas with no dead space.
