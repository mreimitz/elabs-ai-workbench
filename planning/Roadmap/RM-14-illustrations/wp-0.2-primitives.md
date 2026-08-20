---
type: "Work Package Spec"
title: "WP 0.2 - iso primitives: iso-math, stage, platform, housing, connectors, EntityRoot"
description: "Phase 0 of 02-plan.md. Ledger: STATUS.md. Ships the drawing vocabulary every entity is built from - the projection math, the drafting stage, the three-face solids, the six connector kinds and the entity wrapper."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-20T22:30:00Z"
status: "final"
---
# WP 0.2 — iso primitives

Phase 0 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Geometry: [`00-research.md`](./00-research.md) §3.1–§3.3.
Component shape: [`01-system-design.md`](./01-system-design.md) §2.

**Depends on:** WP 0.1 (package, tokens, shared contract).
**Consumed by:** WP 0.3 (the three pilot entities are composed **only** from these), all of Phase 1,
and the scene renderer in Phase 2.

This WP ships the **drawing vocabulary** — the parts every entity is assembled from. It ships no
entity and no registry entry. The test of success is that WP 0.3 can build `mcp-server`, `skill` and
`agent` without writing a single new `<path>`.

---

## Locked decisions this WP implements

- **D-IL2 / D-IL15** — true isometric (30°), quantized unit grid, three-face solids with the fixed
  lighting rule, drafting-paper stage, **clean paths — sketchiness comes from the construction
  layer, never from wobble filters**. Flat art maps onto faces exclusively via the three fixed
  transforms; circles become ellipses by the iso rule. All of it implemented **once**, in
  `iso-math.ts`; no component eyeballs a projection.
- **D-IL5 / D-IL6** — tokens only, no literals; primitives default **neutral** and accent is opt-in
  (`--illus-accent` is ~2–6% of a scene, roughly one accent moment per station).
- **D-IL7** — ports, not coordinates. `EntityRoot` plumbs named ports; connectors attach
  `nodeId.port → nodeId.port`.
- **D-IL8** — closed grammars: six connector kinds, five entity states.
- **D-IL16** — layered rendering. Primitives render into named layers (`stage · shadows · structure
  · detail · connectors · annotations · labels`); **z-order belongs to the layer, never to an
  individual object**. Leader lines elbow only at 90°/30°/150°.
- **D-IL17** — entities with a face declare `facing: "upstream" | "downstream"`, **default
  `upstream`**; the face panel mounts on the LEFT (+y) or RIGHT (+x) iso face. Faceless entities
  ignore the prop.

## Scope

### 1. `src/iso-math.ts` — first, and alone in its file

- Unit grid: **1 unit = 16 px** in the base viewBox. Quantized footprints **S 4×4 / M 6×6 / L 8×8**
  units (platform top face), height 1–4 units.
- True-iso projection (axes at exactly 30°, 120° apart). No 2:1 approximation, no vanishing point.
- The three fixed face transforms — **top**: `scaleY(0.866)`; **left**: shear −30°, `scaleY(0.866)`,
  rotate 30°; **right**: mirrored (shear 30°, `scaleY(0.866)`, rotate −30°).
- The iso-ellipse rule — top-facing: height = diameter × 0.577; side-facing: the same ellipse
  rotated ±30°.
- `CalibrationCube`: the 1-unit dimensional reference, rendered in the gallery and dev overlays.
- Pure functions, no React import, fully unit-tested against hand-computed values.

**Reuse, do not re-derive:** [`examples/Agent.example.tsx`](./examples/Agent.example.tsx) (233 lines)
is a working exemplar that already renders correctly in both themes, and
[`examples/agent-bright.png`](./examples/agent-bright.png) /
[`examples/agent-dark.png`](./examples/agent-dark.png) are its output. Lift its geometry; where this
spec and the exemplar disagree, **this spec wins** and the divergence is recorded in the done-line.

### 2. Primitives (`src/primitives/`)

One file per primitive, never inlined into an entity (D-IL12):

- `PaperStage` — drafting paper: grid, major gridlines, crosshairs, registration marks; grid on/off.
- `IsoPlatform` — 1–3 tiers, footprint S/M/L.
- `IsoHousing` + `isoExtrude` — the three-face solid; faces read `--illus-face-top/left/right`.
- `GlyphFrame` — mounts flat art onto a face via the fixed transforms (never ad-hoc `transform`).
- `ConstructionGhost` — the dashed echo (1 px dashed, `--illus-guide`).
- `StationHeader` — the numbered station caption block; **screen-aligned text, never skewed**.
- `Connector` — all six kinds of D-IL8 with their markers, per the
  [`01-system-design.md`](./01-system-design.md) §2.3 stroke table (`flow` ink-muted solid 2.5 ·
  `read` ink solid 2 · `write` accent dashed 2 · `publish` accent solid 2.5 · `loop` guide dashed 2 ·
  `signal` accent-2 dotted 1.5). Kind → token mapping lives here; a caller cannot pass a stroke or a
  color.
- `CalloutCard` / `PrincipleCard` — annotation cards with 90°/30°/150° leader elbows.
- `EntityRoot` — the wrapper every entity uses: applies the state (five states), emits
  `<title>`/`<desc>` from registry metadata for `role="img"`, exposes ports, accepts
  `size`/`state`/`variant`/`label`/`facing`.

Line system (research §3.2): ink 2 px round-join · detail 1.25–1.5 px · construction 1 px dashed.

### 3. The face-separation assertion

A **dev-mode** assertion measuring resolved face lightness and warning when adjacent faces fall
under the **≥ 20% relative separation floor** (D-IL15). Dev-mode only — it must not run, warn, or
cost anything in a production build. If it cannot be measured without a browser, implement it as a
unit test over the `color-mix` inputs and say so plainly rather than shipping a no-op.

### 4. Preview surface

A dev-only preview page inside `apps/web` behind the future `/illustrations` route stub — enough to
look at every primitive in both themes. **The real gallery is WP 0.3**; do not build it here, and do
not add the route to the manifest yet (see WP 0.3's gate note).

## Out of scope (explicitly)

Entities, registry entries, the gallery route proper, scene layout, the connector **router** (WP 2.2
does routing; this WP only draws a connector between two given points).

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root.
2. `iso-math` unit tests assert the projection, all three face transforms and the iso-ellipse rule
   against hand-computed values — not against the implementation's own output.
3. Every primitive renders in both themes without a color literal:
   `grep -rniE '#[0-9a-f]{3,8}\b|rgb\(|hsl\(' packages/illustrations/src` returns nothing.
4. `Connector` renders all six kinds; a seventh kind is a **type error**, not a runtime fallback.
5. `EntityRoot` emits `<title>` and `<desc>` and applies all five states.
6. **Teeth check, performed and reported:** break the 86.6% factor in one face transform and watch
   an `iso-math` test go red; break the face-separation floor and watch its assertion fire; restore
   both.
7. Both themes verified **by looking** at the preview surface, with a screenshot each in the
   done-line. A claim of "reads correctly in both themes" without a screenshot is not accepted.

## Ledger

Tick WP 0.2 in [`STATUS.md`](./STATUS.md) with the branch, the gate result, deviations from the
exemplar, and an explicit **"Not verified:"** tail.
