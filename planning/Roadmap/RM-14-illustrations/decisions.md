---
type: "Decision"
title: "Illustrations \u2014 locked decisions (D-IL1 \u2026 D-IL17)"
description: "These are settled. An agent picking up a WP builds within them; changing one requires an"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T13:10:00Z"
status: "accepted"
---
# Illustrations — locked decisions (D-IL1 … D-IL17)

> These are settled. An agent picking up a WP builds within them; changing one requires an
> owner amendment (inline blockquote, dated), never a silent deviation. Rationale lives in
> [`00-research.md`](./00-research.md) and [`01-system-design.md`](./01-system-design.md).

### D-IL1 — Purpose: explanatory illustration, not diagramming
The system produces **staged explanatory scenes** of app processes and entities. It is not a
charting library (`@elabs-ai/components-charts`), not an interactive canvas for user data (`@elabs-ai/components-flow`),
and not the flat marketing-hero style. If a feature needs users to *edit* diagrams of their
own data, that is a different workstream.

### D-IL2 — Visual language: isometric "3D blueprint"
True isometric (30°) axonometric projection, quantized unit grid (1 unit = 16 px; footprints
S 4×4 / M 6×6 / L 8×8), three-face solids with the fixed lighting rule (top lightest → right
darkest), drafting-paper stage (grid, crosshairs, dashed construction ghosts), clean paths —
sketchiness comes from the construction layer, never wobble filters. Labels are always
screen-aligned, never skewed onto iso faces.

### D-IL3 — Technology: React 19 + inline SVG, zero new runtime deps
Components are React components rendering inline SVG. Peer dep `react`; workspace dep
`@mcp-token-footprint/shared`. No canvas/WebGL, no Lottie, no animation or icon libraries.

### D-IL4 — Location: `packages/illustrations`
A workspace package `@mcp-token-footprint/illustrations`, wired like `packages/shared`
(exports with `types → src`, `default → dist`; own `build`/`typecheck`/`test`). Only
`apps/web` consumes it. It may graduate upstream to `@elabs-ai/components-*` later; that is an owner call
and out of scope here.

### D-IL5 — Color: the `--illus-*` indirection layer, no literals ever
Components consume only the closed `--illus-*` token set; exactly one file
(`src/tokens.css`) binds those to `@elabs-ai/components-tokens` semantic variables (the mapping table in
research §3.4). Face shading is derived via `color-mix(in oklch, …)`, never hand-picked.
No color literal anywhere in the package (`check-tokens` already polices `packages/*/src`).
A missing semantic token is raised upstream per `library-first.md`, not hardcoded around.

### D-IL6 — Accent discipline
`--illus-accent` (= `--primary`) is the single hero accent, ~2–6% of any scene, roughly one
accent moment per station. Primitives default neutral; accent is opt-in. Text is never set in
accent on paper; informational text uses ink tokens only.

### D-IL7 — Ports, not coordinates
Every entity component declares named ports in its registry entry; connectors attach
`nodeId.port → nodeId.port`. Explicit coordinates exist only as a per-node layout override,
never as connector endpoints.

### D-IL8 — Closed grammars
Connector kinds (`flow · read · write · publish · loop · signal`), entity states
(`idle · active · highlight · dimmed · error`), annotation kinds, and canvas formats are
closed sets mapped to tokens in the package. Scene specs cannot express raw styles; the sets
grow only through the contribution process (D-IL12).

### D-IL9 — The registry is the single catalog
`registry.ts` (zod-typed entries: id, entity binding, tier, keywords, variants, states,
ports, sizes, since, description) is consumed by the gallery, the scene renderer/validator,
the assistant tools, and the scaffold. No component ships without an entry;
`REGISTRY_VERSION` is stamped into every authored scene spec (flag-don't-break, like
`counting_version`).

### D-IL10 — The scene spec is the only composition path
`SceneSpec` types + zod live in **`packages/shared`** (contract-first; the API validates
specs without importing React). Assistant composition, explain-mode walkthroughs, exports,
and any future canvas authoring all emit/consume this one spec. Required `title` + `summary`
make the text alternative schema-enforced. Rendering is deterministic: same spec + theme +
registry version ⇒ same SVG.

### D-IL11 — Explain mode is a step player
Ordered `steps[]` (focus sets + captions) drive `highlight`/`dimmed` states; keyboard `←/→`
and `Esc`; captions in an `aria-live` region; all motion behind `prefers-reduced-motion`;
export default is motionless. In-repo explainer specs (scan pipeline, run engine, skill loop)
are authored files reviewed like code; the DB scene library is for assistant/owner-composed
scenes only.

### D-IL12 — Growth process is mandatory
New component = registry entry + scaffold (`new <Name>`) + primitives-only construction +
the illustration checklist (footprint · ports · 5 states · both themes · accent budget ·
screen-aligned label · `<title>/<desc>`) + co-located contract test + `REGISTRY_VERSION`
bump. New primitives go into `primitives/`, never inlined into one entity.

> **Amendment, 2026-08-21 — `REGISTRY_VERSION` does NOT bump when a component is added.**
> D-IL12 above lists a "`REGISTRY_VERSION` bump" as part of shipping a new component. That
> contradicts the constant's own contract in
> `packages/shared/src/illustration-registry.ts` (repository root, outside this bundle)
> — *"Bumped when an ENTRY's contract moves in a way that could change how an existing scene
> renders … ADDING a component, a variant or a port is additive and leaves this alone."* Phase 1
> surfaced the contradiction (WPs 1.1–1.3 shipped 20 components and, correctly, bumped nothing).
>
> **The constant's rule wins, and D-IL12's clause is struck.** The reason is what the version is
> *for*: D-IL9 makes it a **flag-don't-break compatibility marker** stamped into every authored
> scene, the same job `TOKEN_COUNTING_VERSION` does for a scan. Adding an entity **cannot**
> invalidate an authored scene — no scene can reference an id that did not exist when it was
> written. A version that bumped on every addition would flag every stored scene after every work
> package for a change provably incapable of affecting it, and a flag that fires on non-events is a
> flag people learn to ignore. That is exactly how `counting_version` would be ruined if it moved
> whenever a new server was registered.
>
> So, concretely:
> - **Bump** when an existing entry's scene-visible contract moves — an id or port **renamed or
>   removed**, a variant/state/size **dropped**, a footprint **re-sized**. Those can break a scene
>   that already resolves against them.
> - **Do not bump** for anything additive (a new component, variant, port or state) or cosmetic
>   (title, description, keywords, tier).
> - `since` on an entry records the version the entity was **born under**, which is what makes the
>   useful question answerable: *a scene stamped version V can resolve any entity whose
>   `since <= V`.* All 23 of today's entries are legitimately `since: "0.1.0"`.
> - **The growth record moves to the registry CHANGELOG, not the number.** WP 1.4 owns it, and owes
>   the rule **teeth** — today nothing would notice a breaking entry change shipped without a bump.
>   A checked-in snapshot of each entry's scene-visible contract, compared on every run, turns this
>   amendment from a paragraph into a red test.
>
> `REGISTRY_VERSION` therefore stays **`0.1.0`** after Phase 1. Owner-delegated decision
> (2026-08-21, "do as you think best"), recorded here rather than made silently in code.

> **Amendment, 2026-08-21 — the Phase 1 catalog is 23 components, not 20.**
> [`02-plan.md`](./02-plan.md) WP 1.4 asks for a "scaffold-only **21st** component proof", and
> `CLAUDE.md` §1 described "the remaining ~17 entities". Both were arithmetic slips: WPs 1.1–1.3
> add **5 + 7 + 8 = 20** entities to the **3** Phase 0 pilots, so the catalog holds **23** and the
> scaffold proof is the **24th** component. Corrected in `02-plan.md`; `CLAUDE.md` §1 was corrected
> when WPs 1.2/1.3 were ticked. Owner-delegated (2026-08-21).

### D-IL13 — Assistant integration follows the assistant workstream's rules
Tools live in `apps/api/src/assistant/tools/` on the in-process MCP server;
`illustrations_registry` and `illustrations_compose_scene` are read tools;
`illustrations_save_scene` is a write tool and approval-gated per D-AS4. Preview navigation
goes through the addressable-view registry (`assistant-ui-registry.ts`) — an `illustration`
view is added there, both sides re-validating, per the established safety boundary.

### D-IL14 — Boundaries with existing rules
Illustrations are **content graphics**, not UI controls — they don't violate
`brand-ui-only.md`; all surrounding chrome (gallery, dialogs, buttons, toolbars) is
`@elabs-ai/components-*`. The repo-root `illustrations/` folder is an **export output** only; the package
is the source of truth. `apps/api` never imports the illustrations package (runtime boundary
unchanged). Both themes (`light`, `dark`) must render correctly — verified by
looking, in the gallery; `blueprint` is not re-added.

### D-IL15 — Drafting calibration (owner reference, 2026-07-12)
Adopted from architectural iso-drafting practice
([nuviraspace.com/isometric-architecture-illustration](https://nuviraspace.com/isometric-architecture-illustration/)):
**true isometric** (not 2:1), with flat art mapped onto faces exclusively via the three fixed
transforms (top: scaleY 86.6% · left: shear −30°/scaleY 86.6%/rotate 30° · right: mirrored)
and circles via the iso-ellipse rule (0.577 height, ±30°) — all implemented once in
`iso-math.ts`. Three-face light model at calibrated ratios (top ≈ 100% / left ≈ 75–80% /
right ≈ 55–60% of surface lightness) with a **≥ 20% lightness-separation floor** between
adjacent faces, asserted in dev mode. A **1-unit calibration cube** primitive is the standing
dimensional reference in the gallery and dev overlays; grid before drawing, always.

### D-IL16 — Layered rendering, leader angles, detail levels
The scene renderer paints a **fixed layer order** (stage → shadows → structure → detail →
connectors → annotations → labels); z-order belongs to layers, never to individual objects.
Annotation leader lines elbow only at **90°/30°/150°**. Entities may declare **detail
levels** (`silhouette`/`standard`/`cutaway` — the cut-plane principle) as registry variants;
explain-mode steps may set them, and the step player uses **phased opacity** (current 100% /
visited ~60% / unvisited ~30%). Components without a cutaway ignore the request rather than
erroring.

### D-IL17 — Gaze meets the flow (owner feedback, 2026-07-12)
Entities with a face/front (agents, validators, assistants, …) declare a
`facing: "upstream" | "downstream"` orientation — the face panel mounts on the LEFT (+y) or
RIGHT (+x) iso face respectively. **Default is `upstream`**: in a left-to-right process
scene a character looks toward the incoming work, not away from it (matching the owner's
reference image). The scene layout engine may set `facing` per node from connector
direction; faceless entities ignore the prop. Proven in the exemplar
(`examples/Agent.example.tsx`, the "facing: downstream" preview tile).

# Citations

None.
