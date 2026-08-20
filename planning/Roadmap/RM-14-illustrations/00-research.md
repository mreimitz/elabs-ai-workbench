---
type: "Work Package Spec"
title: "Illustrations \u2014 research: a theme-token-driven \"3D blueprint\" illustration system"
description: "Workstream front door: README.md \u00b7 system design"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Illustrations — research: a theme-token-driven "3D blueprint" illustration system

> Workstream front door: [`README.md`](./item.md) · system design:
> [`01-system-design.md`](./01-system-design.md) · plan: [`02-plan.md`](./02-plan.md) ·
> locked decisions: [`decisions.md`](./decisions.md) · **authoritative ledger:**
> [`STATUS.md`](./STATUS.md)

## 1. Problem & goal

The app explains complex, multi-actor processes — a discovery scan, an agentic test run, a
suite matrix, the skill feedback loop, the assistant's edit-approve cycle. Today those are
explained with text, tables, and the occasional hand-made graphic (the owner's
"Self-Learning Agentic Loop" reference image). Every new graphic is a one-off: new colors, new
shapes, no reuse, no theme awareness, no way to keep it consistent as the app grows.

**Goal:** a first-class illustration design system —

1. a **component library** of illustration assets for the app's core entities (LLMs, agents,
   MCP servers, skills, runs, suites, files, …) in one recognizable visual language,
2. **colors derived from the live theme** (`light` / `dark`) so every asset renders
   correctly in both, automatically, forever,
3. an **asset repository** in the app to browse what exists,
4. a **growth process** so new components are added the same way every time, and
5. a **composition logic**: describe a workflow → reuse the components to visualize it —
   declaratively (scene spec), conversationally (assistant), and as in-app **explain-mode**
   walkthroughs of the app's own internals.

This is *explanatory* graphics — staged scenes that tell a process story — not charting
(that's `@elabs-ai/components-charts`) and not user-data diagramming (that's `@elabs-ai/components-flow`).

## 2. Deconstructing the reference image (what the style *is*)

The owner's reference ("Self-Learning Agentic Loop", isometric sketch on paper) works because
of a small number of repeatable devices. Naming them tells us exactly what the primitive
library must contain:

| Device in the reference | What it is, generically | System primitive |
| --- | --- | --- |
| Robots/servers sit on stepped pedestals | An **isometric platform** that gives any entity a "stage" and physical presence | `IsoPlatform` (1–3 tiers, footprint S/M/L) |
| Rounded device housings (robot heads, server racks) | An **extruded rounded solid** with 3 visible faces | `IsoHousing` / `isoExtrude()` |
| Puzzle piece, shield, infinity, doc sheets | A **glyph payload** riding on a platform — the entity's identity | `GlyphFrame` + per-entity glyph |
| Dashed outlines echoing each object | **Construction ghosts** — the "drafted, in-progress" feel | `ConstructionGhost` |
| Paper grid, corner crosshairs, edge ticks | The **drafting-paper stage** | `PaperStage` (grid + registration marks) |
| Numbered chips + title + caption per station | A **process station header** | `StationHeader` |
| Chevron arrows, dashed return loop | **Connectors with kinds** (flow vs. loop vs. read/write) | `Connector` (kind → stroke/marker/dash) |
| "The Loop Principle" card, note card | **Annotation cards** | `CalloutCard`, `PrincipleCard` |
| One warm accent (orange) against neutral paper | **Single hero accent** discipline | accent token, ratio rule |

Two structural flaws in the reference are also instructive: the MCP/Skill objects were drawn
*twice* (once under step 1, once under step 5) instead of being one shared node, and the
accent color wasn't brand-derived. Both are exactly what a *system* fixes: **entities are
instances** (one node, many connectors) and **color comes from tokens**.

## 3. Visual language specification ("3D blueprint")

### 3.1 Geometry

- **True isometric projection** (axes at exactly 30° from horizontal, 120° apart — not the
  crisper-but-dishonest 2:1 pixel approximation). True iso is chosen because everything else
  in the system derives from its math: flat glyph art maps onto faces with three fixed
  transforms (**top**: scaleY 86.6%; **left**: shear −30°, scaleY 86.6%, rotate 30°;
  **right**: shear 30°, scaleY 86.6%, rotate −30° — cos 30° = 0.866), and circles become
  ellipses by rule (top-facing: height = diameter × 0.577 (= tan 30°); side-facing: same
  ellipse rotated ±30°). One set of helpers in `iso-math.ts` implements all of it; no
  component ever eyeballs a projection. No vanishing-point perspective — axonometric keeps
  compositions modular: any component can be placed anywhere without re-projection.
- **Grid before drawing.** The unit grid is constructed first and everything snaps to it;
  errors at grid level compound with no recovery path (the drafting-discipline lesson from
  architectural iso illustration). A **1-unit calibration cube** primitive renders in the
  gallery and in dev overlays as the fixed dimensional reference — every component is sized
  against it, which prevents the scale creep that appears when components are drawn by eye
  over time.
- A shared **iso unit grid**: 1 unit = 16 px in the base viewBox. Component footprints are
  quantized: S = 4×4 units, M = 6×6, L = 8×8 (platform top face), height 1–4 units. Quantized
  footprints are what make components interchangeable inside scenes.
- **Labels and text are always screen-aligned** (never skewed onto iso faces). Isometric text
  is illegible at small sizes and fails accessibility; the reference image does the same.
- Every component declares **named ports** (attachment points in its own coordinate space:
  `top`, `bottom`, `left`, `right`, plus semantic ones like `bus`). Connectors attach to
  ports, never to raw coordinates — this is what lets a scene re-layout without redrawing.

### 3.2 Line system

- **Ink stroke** (component silhouettes): 2 px, round joins. **Detail stroke** (inner lines,
  face edges): 1.25–1.5 px. **Construction stroke** (ghosts, guides): 1 px dashed.
- Sketchiness comes from the *construction layer* (dashes, crosshairs, ghost outlines, hatch
  ticks), **not** from wobbly paths. Wobble filters look cheap at small sizes, break at scale,
  and cost render time. The reference's charm survives with clean paths + drafting marks.

### 3.3 Faces & depth (how "3D" happens without 3D)

Each solid renders 3 faces with the standard **three-face light model** of technical iso
illustration — and the values are *calibrated ratios*, not vibes: **top ≈ 100%** of the base
surface lightness (sky plane), **left ≈ 75–80%** (ambient bounce), **right ≈ 55–60%**
(shade face), with a hard floor of **≥ 20% relative lightness separation between adjacent
faces** so depth survives print/export and low-quality screens. Derived, never hand-picked:

```css
--illus-face-top:   var(--illus-surface);
--illus-face-left:  color-mix(in oklch, var(--illus-surface), var(--illus-ink) 12%);
--illus-face-right: color-mix(in oklch, var(--illus-surface), var(--illus-ink) 24%);
```

Because `@elabs-ai/components-tokens` colors are **oklch** (perceptually even), mixing toward the ink color
produces consistent, theme-correct shading in *both* themes: in `light` faces darken;
in `dark` (light ink on dark surface) they lighten — which is exactly how physical
lighting should flip on a dark stage. The exact mix percentages are tuned once, per theme if
needed, inside `tokens.css` to hit the ratio targets; a dev-mode assertion in the gallery
measures resolved face lightness and warns when adjacent faces fall under the 20% separation
floor. Ground shadows are a skewed ellipse of `--illus-ink` at ~7% alpha. (`color-mix()` is
Baseline-supported in all evergreen browsers; the app already requires a modern browser. The
PNG/SVG *export* path resolves computed values, so exports never depend on browser support.)

### 3.4 Color: derivation, not palette

**No component ever contains a color literal.** Components consume a small closed set of
`--illus-*` custom properties; a single mapping file binds those to `@elabs-ai/components-tokens` semantic
variables. This indirection is the entire "derive from the current theme" logic — and it means
a future third theme gets the whole illustration library for free.

| Illustration token | Bound to (`@elabs-ai/components-tokens`) | Role |
| --- | --- | --- |
| `--illus-paper` | `--background` | drafting-paper stage |
| `--illus-grid` | `--grid-line` (fallback `--canvas-grid`) | paper grid |
| `--illus-grid-major` | `--grid-line-major` | major gridlines |
| `--illus-ink` | `--foreground` | silhouettes, primary linework |
| `--illus-ink-muted` | `--muted-foreground` | captions, secondary linework |
| `--illus-guide` | `--rule` (fallback `--border`) | construction dashes, crosshairs |
| `--illus-surface` | `--card` | solid top faces (left/right derived via `color-mix`) |
| `--illus-surface-sunken` | `--surface-muted` | inset panels, tray wells |
| `--illus-accent` | `--primary` | **the** hero accent (the vendor green in both themes) |
| `--illus-accent-contrast` | `--primary-foreground` | glyphs on accent fills |
| `--illus-accent-2` | `--chart-3` | rare secondary accent (particles, one connector kind) |
| `--illus-ok / -warn / -error` | `--success / --warning / --destructive` | entity state chips |
| `--illus-shadow` | `--foreground` @ ~7% alpha | ground shadows |

**Accent discipline** (inherited from the reference and from brand practice): 70–85% of any
scene is paper/surface, 8–15% ink, and the hero accent covers roughly **2–6%** — one accent
moment per station (a shield check, a puzzle fill, a write-back arrow). The single most common
failure mode of generated illustration is accent overuse; the primitives default to neutral
and require opting *in* to accent.

The vendored tokens even ship a `--decoration` dial and `--bp-*` (blueprint hatch/grid)
tokens; the app filters the `blueprint` *theme* out deliberately, and this system does **not**
re-add it — but where a `--bp-*`/`--rule`/`--grid-line` token exists in the two shipped
themes, the mapping prefers it over improvising.

### 3.5 States & motion

Entities support a small closed state set: `idle` (default), `active` (accent edge glow /
accent status dot), `highlight` (explain-mode spotlight), `dimmed` (explain-mode background),
`error` (`--illus-error` dot). Motion is reserved for meaning: connector flow (dash offset),
status pulse — always behind `prefers-reduced-motion`, always optional (`animation: 'none'`
must be the export default).

## 4. Why React + inline SVG (technology decision, argued)

| Option | Verdict | Why |
| --- | --- | --- |
| **React components rendering inline SVG** | ✅ chosen | CSS custom properties cascade into inline SVG → theme adaptation is *free and live* (no re-render on theme switch). DOM = real a11y (`role="img"`, `<title>/<desc>`, focusable steps). Props → variants/states. Tree-shakeable. Deterministic export by serializing with resolved values. |
| Static `.svg` asset files | ❌ | Can't read theme vars when used via `<img>`; inlining them at build loses variants/ports/states; two-theme means duplicated assets that drift. |
| Canvas/WebGL | ❌ | No CSS var theming, no DOM a11y, massive overkill for staged flat-shaded iso art. |
| Lottie/animation formats | ❌ | Baked colors, new runtime dep, authoring tool lock-in — violates the dependency rules. |
| Hand-authored per-scene SVG (status quo, `illustrations/` folder) | ❌ as source | Exactly the one-off problem this workstream removes. Stays as an *export target* only. |

React 19 is already the app's UI runtime; the package needs **zero new runtime dependencies**
(react as a peer, zod for the scene spec — both already in the workspace).

## 5. Entity catalog (grounded in the real domain model)

From `apps/api/src/db/schema.ts` + `packages/shared`: the actual entities users deal with.
Priority tiers drive the build order (Phase 1 WPs):

**Tier 1 — the agentic-loop cast (needed to reproduce the reference scene):**
`Agent/LLM` (robot on platform), `Model` (chip/badge variant of agent), `Provider`
(anthropic/openai/google/ollama/vendor_assistant as neutral logo-slot housing), `McpServer`
(server rack; `stdio` vs `streamable_http` variants — plug vs antenna), `Tool` (small socketed
module on the server), `Skill` (puzzle chip; version stack variant `vN`), `Prompt` (speech
bubble on a display), `Validator/Grader` (shield agent), `Run/Session` (conveyor/track
segment), `Feedback/Report` (document tray).

**Tier 2 — orchestration & accounting:**
`Suite` (rack of run tracks), `Collection` (drawer/binder), `Orchestrator/Automation` (the
"automatic execution" entity — geared conveyor hub; covers the suite worker-pool and
auto-grade-on-completion; the app has no cron scheduler, so this is the honest metaphor),
`TokenMeter` (gauge/counter column), `Scan` (scanner arch over a server), `Diff/Compare`
(split pedestal), `File/Attachment` (sheet stack), `Resource` (labeled crate), `Environment/
Scenario` (terrarium/stage plate).

**Tier 3 — platform cast:** `Assistant` (docked companion robot), `Owner/User`, `Database/
Storage` (the SQLite crate), `Credentials/Secrets` (key vault), `VendorAssistant Assistant`,
`GitHub/Repo` (for skill sync), `Guardrail` (barrier), `Cost` (coin/meter).

The catalog is **open**: the registry (see system design §3) is the machine-readable list, and
the growth process (§7 there) is how it extends. This doc only fixes the *tiers*.

## 6. Prior art (what we borrow, what we reject)

- **Isometric icon grids** (isoflow-style network diagrams, classic technical-marketing iso
  art): borrow the quantized footprint idea and platform metaphor; reject their fixed palettes.
- **IBM Carbon pictograms / process illustrations**: borrow the governance model — a spec'd
  grid, a contribution checklist, a reviewed registry; reject the flat 2D language (we're
  committed to the owner's 3D blueprint look).
- **unDraw-style single-var theming**: proves CSS-var recoloring works at scale; we generalize
  from 1 accent var to a ~14-token semantic layer.
- **The app's own `@elabs-ai/components-*` system**: `ThemeProvider`/`data-theme` switching, oklch semantic
  tokens, the two-theme discipline, `check-tokens` enforcement (which **already covers
  `packages/*/src`** — the hook filters on `/src/` + `.tsx?`, so the new package is born
  policed). The illustration layer is deliberately shaped like a miniature of that system.
- **Architectural isometric drafting practice** (owner-supplied reference:
  [nuviraspace.com/isometric-architecture-illustration](https://nuviraspace.com/isometric-architecture-illustration/)):
  the discipline this system's *layout logic* borrows wholesale — grid calibrated before any
  drawing; a fixed symbol library where every element ships in three face orientations
  (top/left/right via the 86.6%-shear transforms); the three-face value-ratio light model
  (100/78/55, ≥20% separation); a locked **layer order** (grid → structure → entourage →
  annotation); leader lines that elbow only at 90°/30°/150°, never freehand; a 1-unit
  calibration object against scale creep; and the **cut-plane principle** — *where you cut
  determines what the drawing communicates* (structural vs. spatial vs. systems), which maps
  directly onto our explain-mode detail levels (silhouette → standard → cutaway). We reject
  its BIM/CMYK/print pipeline specifics; we keep its layout discipline. (flat product-UI theater): related
  but explicitly *not* this language; that skill stays for marketing heroes. This system is
  the app-native, isometric, entity-centric language. No shared code.

## 7. Interactivity & accessibility research

- **Static role**: every rendered scene/component gets `role="img"` + `<title>`/`<desc>`;
  the scene spec carries `title` and `summary` fields so the text alternative is authored
  data, not an afterthought.
- **Explain mode** is a *step player*, not free animation: ordered steps, each declaring the
  set of nodes/connectors to spotlight (others drop to `dimmed`), a caption, and optional
  auto-advance. Keyboard: `←/→` steps, `Esc` exits; captions live in a real DOM region
  (`aria-live="polite"`). This doubles as the in-app internal-process documentation mode the
  owner asked for (scan pipeline, run engine, suite matrix walkthroughs).
- **Contrast rule**: informational text always uses `--illus-ink`/`--illus-ink-muted` (both
  are theme foregrounds with guaranteed contrast); accent is never a text color on paper.
- **Reduced motion**: all motion behind `prefers-reduced-motion: reduce` → static states.

## 8. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **Visual drift** — components added over time stop looking like one family | Primitives-first (components compose `IsoPlatform`/`IsoHousing`/… rather than drawing freehand); quantized footprints; contribution checklist; golden screenshots in both themes (visual-regression WP). |
| **Scope creep into a diagram editor** | Non-goal locked in decisions: scenes are *authored explanations*, not a user diagramming feature. `@elabs-ai/components-flow` remains the interactive-canvas tool. |
| **Accent overuse / off-ratio scenes** | Primitives default neutral; scene renderer counts accent-bearing elements and warns in dev; checklist gate. |
| **Token gaps** (e.g. no dedicated illustration tokens upstream) | The `--illus-*` mapping file is the single place that absorbs gaps; a real gap is raised upstream per `library-first.md`, not hardcoded around. |
| **Isometric legibility at small sizes** | S footprint defines the minimum; labels screen-aligned; gallery previews at real embed sizes. |
| **Build weight** | Pure SVG/React, zero deps, per-entity modules (tree-shaking); no filters/textures; budget asserted in the hardening WP. |
| **`color-mix()` in very old browsers** | Modern-browser app; static fallback values compiled into the mapping file's fallback chain; exports resolve values ahead of time. |

## 9. What "done" looks like (acceptance narrative)

The owner opens **Illustrations** in the app and browses the asset repository: every core
entity rendered live, switchable between `light`/`dark`, each with its ports,
variants, and states documented. They paste a scene spec (or ask the Assistant: *"visualize
how a suite run flows through the orchestrator into grading"*) and get the composed scene in
the app's own visual language — the Self-Learning Agentic Loop reference rebuilt as a spec is
the canonical test, **with one shared MCP+Skill node** that steps 1, 4, and 5 genuinely
connect to. A new entity component is added by one scaffold command + a registry entry and
appears in the gallery automatically. An explain-mode scene embedded on the Testing page
walks a new user through a run, step by step, in both themes, keyboard-only.
