---
type: "Work Package Spec"
title: "Illustrations \u2014 system design"
description: "Research & visual language: 00-research.md \u00b7 plan"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Illustrations — system design

> Research & visual language: [`00-research.md`](./00-research.md) · plan:
> [`02-plan.md`](./02-plan.md) · locked decisions: [`decisions.md`](./decisions.md) ·
> **authoritative ledger:** [`STATUS.md`](./STATUS.md)

## 1. Package architecture

A new workspace package, wired exactly like `packages/shared` (name/exports/scripts template):

```
packages/illustrations/                      @mcp-token-footprint/illustrations
├── package.json          type:module; exports "." / "./registry" / "./scene" / "./tokens.css"
│                         types → ./src/*.ts, default → ./dist/*.js; build/typecheck/test scripts
├── src/
│   ├── tokens.css        the --illus-* mapping layer (the ONLY file that references brand-ui vars)
│   ├── primitives/       IsoPlatform, IsoHousing, GlyphFrame, ConstructionGhost, PaperStage,
│   │                     StationHeader, Connector, CalloutCard, PrincipleCard, iso-math.ts
│   ├── entities/         one file per entity: McpServer.tsx, Skill.tsx, Agent.tsx, …
│   ├── registry.ts       machine-readable manifest of every entity component (zod-typed)
│   ├── scene/
│   │   ├── spec.ts       SceneSpec types + zod schemas (single source of truth for scenes)
│   │   ├── layout.ts     band/lane layout engine + explicit-coordinate override
│   │   ├── route.ts      connector router (port → port orthogonal paths, label placement)
│   │   ├── Scene.tsx     <IllustrationScene spec/> deterministic renderer
│   │   └── explain.tsx   <ExplainScene spec/> step player (spotlight/dim/captions)
│   ├── export.ts         serialize a rendered scene → standalone SVG (theme values resolved)
│   └── index.ts
└── scripts/
    └── new-component.mjs scaffold: pnpm --filter @mcp-token-footprint/illustrations new <Name>
```

Wiring: `pnpm-workspace.yaml` already globs `packages/*`; root `build`/`typecheck` are
`pnpm -r --sort`, so the package is picked up with **zero root edits**. `apps/web` adds the
`workspace:*` dep. `apps/api` never depends on it (runtime boundary untouched) — the API only
ever stores/validates **scene specs** (JSON), whose zod schemas live in `packages/shared` so
both sides can validate without the API importing React (contract-first rule).

> Split of responsibilities: **`packages/shared`** owns `SceneSpec`/`RegistryEntry` *types +
> zod* (the wire contract — assistant tools and scene persistence validate against it);
> **`packages/illustrations`** owns rendering (React/SVG), the primitives, and re-exports the
> shared types. Same pattern as every other feature: shared first, then consumers.

Dependencies: `react` (peer, v19), `@mcp-token-footprint/shared` (workspace). **Nothing else.**

## 2. Component model

### 2.1 Anatomy & contract

Every entity component composes primitives — never freehand paths for structure:

```tsx
export function McpServer({ size = "m", state = "idle", variant = "stdio", label }: EntityProps) {
  return (
    <EntityRoot meta={mcpServerMeta} size={size} state={state} label={label}>
      <IsoPlatform tiers={2} footprint={size} />
      <IsoHousing kind="rack" />          {/* 3-face solid, faces from --illus-face-* */}
      <RackDetail leds slots={3} />        {/* detail layer, 1.5px strokes */}
      {variant === "streamable_http" && <AntennaGlyph />}
      <ConstructionGhost />                {/* dashed echo, --illus-guide */}
    </EntityRoot>
  );
}
```

Shared `EntityProps`: `size: "s" | "m" | "l"` (quantized footprints, research §3.1),
`state: "idle" | "active" | "highlight" | "dimmed" | "error"`, `variant` (per-entity enum),
`label?: string` (screen-aligned, outside the iso body). `EntityRoot` applies the state class,
the a11y `<title>/<desc>` from registry metadata, and exposes **ports**.

### 2.2 Ports

Ports are named anchor points in the component's local box, declared in the registry entry
(not measured from the DOM — determinism): `top`, `bottom`, `left`, `right` always;
semantic extras per entity (`Skill`: `version-out`; `McpServer`: `bus`; `Agent`: `context-in`,
`result-out`). The router resolves `nodeId.port` → canvas coordinates via the layout engine.

### 2.3 Connector kinds (closed set, token-mapped)

| kind | meaning | stroke | marker |
| --- | --- | --- | --- |
| `flow` | process order | `--illus-ink-muted`, solid 2.5 | ink arrow |
| `read` | consumes/loads from | `--illus-ink`, solid 2 | ink arrow |
| `write` | produces/feeds into | `--illus-accent`, dashed 2 | accent arrow |
| `publish` | new version / promotion | `--illus-accent`, solid 2.5 | accent arrow |
| `loop` | cycle/repeat | `--illus-guide`, dashed 2 | ink arrow |
| `signal` | events/particles | `--illus-accent-2`, dotted 1.5 | none (particles) |

This closed set is the visual grammar that made the rebuilt agentic-loop diagram legible
(read = ink, write-back = green); scenes cannot invent ad-hoc connector styles.

## 3. The registry (the "asset repository" backbone)

`registry.ts` exports `ILLUSTRATION_REGISTRY: RegistryEntry[]` — zod-typed in shared:

```ts
type RegistryEntry = {
  id: "mcp-server";                 // kebab-case, stable, referenced by scene specs
  title: "MCP Server";
  entity: "mcp_servers";            // binding to the domain model (nullable for abstract)
  tier: 1 | 2 | 3;
  keywords: ["server", "tools", "stdio", "http"];   // assistant retrieval
  variants: ["stdio", "streamable_http"];
  states: ["idle", "active", "highlight", "dimmed", "error"];
  ports: { top: PortDef; bottom: PortDef; bus: PortDef; /* … */ };
  sizes: ["s", "m", "l"];
  since: "0.1.0";                   // registry version the component appeared in
  description: string;              // one-liner; doubles as the a11y <desc>
};
```

Consumed by: the **gallery route** (renders everything live), the **scene renderer**
(validates every `node.component` id + port refs), the **assistant tools** (searchable
catalog), and the **scaffold script** (refuses to create a component without an entry).
The registry carries a package-level `REGISTRY_VERSION`; scene specs record the version they
were authored against, so a scene can be flagged (not broken) when a referenced component's
contract changes — the same "counting_version" discipline used for token counting.

## 4. Scene spec (the declarative composition layer)

Types + zod in `packages/shared` (`illustration-scene.ts`), renderer in the package. Shape:

```jsonc
{
  "version": 1,
  "registryVersion": "0.3.0",
  "id": "self-learning-agentic-loop",
  "title": "Self-Learning Agentic Loop",
  "summary": "Six steps sharing one MCP server + Skill …",   // a11y text alternative
  "canvas": { "format": "hero_wide", "stage": "paper" },      // 16:9 | ultra | square; grid on/off
  "bands": [                                                   // vertical composition
    { "id": "process", "kind": "lane" },                       // auto-distributed stations
    { "id": "shared",  "kind": "hub"  },                       // centered shared entities
    { "id": "notes",   "kind": "annotations" }
  ],
  "nodes": [
    { "id": "agent",   "component": "agent",      "band": "process", "seq": 1,
      "title": "Primary LLM", "caption": "Accesses the shared MCP server + Skill" },
    { "id": "hub-mcp", "component": "mcp-server", "band": "shared" },
    { "id": "hub-skill", "component": "skill", "band": "shared", "variant": "versioned",
      "state": "active" }
    // … steps 2–6
  ],
  "connectors": [
    { "from": "hub-mcp.bus",      "to": "agent.context-in",  "kind": "read",
      "label": "provides MCP tools + current Skill" },
    { "from": "feedback.result-out", "to": "hub-skill.top",  "kind": "write" },
    { "from": "enhance.result-out",  "to": "hub-skill.version-out", "kind": "publish" },
    { "from": "repeat.top", "to": "agent.top", "kind": "loop", "label": "next cycle" }
  ],
  "annotations": [
    { "kind": "principle-card", "band": "notes", "align": "start",
      "title": "The loop principle", "items": ["Execute with context", "…"] }
  ],
  "steps": [                                                   // optional → explain mode
    { "focus": ["agent", "hub-mcp", "hub-skill"], "connectors": ["c1"],
      "caption": "The agent loads the current Skill and MCP tools…" }
  ]
}
```

Design rules baked into the schema: nodes reference **registry ids** (validated), connectors
reference **ports** (validated), colors/strokes are **not expressible** (kind → token mapping
only — a spec physically cannot go off-brand), and `title`/`summary` are required (a11y is
schema-enforced). The spec is versionable, diffable, and storable — everything downstream
(assistant, explain mode, a future canvas editor) **emits or consumes this spec**; there is
no second composition path.

### Layout engine

Deterministic two-pass: (1) bands stack vertically per canvas format; `lane` bands distribute
stations horizontally by `seq` with quantized gaps; `hub` bands center their nodes as one
group; explicit `{x,y}` on a node overrides (escape hatch). (2) The router draws orthogonal
port-to-port paths with fixed corner radii, nudging parallel runs apart, and places labels at
path midpoints with collision avoidance against node boxes only (cheap, deterministic — no
force simulation, no measurement of rendered text). Annotation **leader lines** elbow only at
90°/30°/150° (the iso angle set) — never freehand curves — so callouts read as part of the
drafting, not decoration.

The renderer paints in a **fixed layer order**, borrowed from architectural iso practice
(grid → structure → entourage → annotation): `stage` (paper grid, registration marks) →
`shadows` → `structure` (platforms, housings) → `detail` (glyphs, LEDs, ghosts) →
`connectors` → `annotations` (cards, leaders) → `labels` (screen-aligned text). Z-order is a
property of the layer, never of individual objects — that, plus band layout, is what keeps
any two scenes composed from the same components looking like the same hand drew them.

## 5. Surfaces in the app

### 5.1 Gallery — the asset repository (`/illustrations`)

A routed view (react-router, PageShell/AppShell grammar like every other view): a filterable
grid of registry entries rendered **live** (real components, current theme — flipping the
Settings theme re-skins the whole gallery, which *is* the acceptance test for token
derivation). Detail view per component: sizes/variants/states matrix, port map overlay, the
registry entry, a copy-paste scene-spec snippet. A second tab lists **saved scenes**.
All UI chrome is `@elabs-ai/components-*` (the illustrations themselves are content, not controls).

### 5.2 Explain mode (in-app process documentation)

`<ExplainScene spec>` = scene + step player: step list drives `highlight`/`dimmed` states and
an `aria-live` caption; keyboard `←/→`/`Esc`; `prefers-reduced-motion` collapses transitions.
Two devices from architectural drafting carry over: (1) the **cut-plane principle** — where
you cut determines what the drawing communicates — becomes per-node **detail levels**
(`silhouette` → `standard` → `cutaway`, e.g. an MCP server opening to show its tool modules,
a skill opening to its file tree) that a step may set, so one scene explains at several
depths without a second illustration; (2) **phased opacity** — steps already visited settle
to an intermediate dim (100% current / ~60% visited / ~30% unvisited) so the player reads as
progress through a process, not a slideshow. Cutaway variants are declared in the registry
like any variant; components without one simply ignore the request.
Embedded at real surfaces via a lightweight `ProcessExplainer` entry point (a `@elabs-ai/components-ui`
Dialog/Sheet hosting the scene): first candidates — *how a scan works* (Servers), *how a run
executes* (Testing runs), *the skill feedback loop* (Skills), matching the owner's stated
"explain app-internal processes" mode. Specs for these ship as **authored files in the repo**
(reviewed like code), not DB rows.

### 5.3 Scene library (persistence, additive)

For assistant-composed and owner-authored scenes: one new table `illustration_scenes`
(`id, slug, title, spec_json, registry_version, created_at, updated_at`) via the standard
versioned migration; CRUD under `/api/illustrations/scenes*` (zod-validated against the shared
schema). Additive-only; no existing wire shape changes.

### 5.4 Assistant composition (natural language → scene)

Follows the established assistant-tools pattern (`apps/api/src/assistant/tools/*`, in-process
MCP `createSdkMcpServer`, D-AS precedents):

- `illustrations_registry` (read) — list/search registry entries (ids, keywords, ports,
  variants) so the model composes strictly from what exists.
- `illustrations_compose_scene` (read → preview) — takes a draft spec, validates against the
  shared zod schema + registry, returns errors or a normalized spec + a deep link to a preview
  route (`/illustrations/preview?draft=…` via the existing addressable-view registry pattern
  in `packages/shared/src/assistant-ui-registry.ts`, extended with an `illustration` view).
- `illustrations_save_scene` (write) — persists to the scene library; **write-gated** exactly
  like other assistant writes (D-AS4: approval-gated by default).

The flow the owner asked for: *describe a workflow in chat → assistant queries the registry →
emits a spec → preview renders in the dock/page → approve → saved to the library.* Validation
is server-side and schema-hard; a hallucinated component id is a validation error, never a
broken drawing.

### 5.5 Export

`export.ts` serializes a mounted scene to a standalone SVG with computed token values baked in
(and optional PNG rasterization server-side later). Exports land where the current one-offs
live (`illustrations/` at repo root stays as an **output** folder; the package is the source
of truth). This replaces hand-drawing deck graphics: author a spec, export both themes.

## 6. The growth process (how components get added forever)

1. **Propose**: add a registry entry stub (id, entity binding, tier, keywords, ports,
   metaphor one-liner). The registry diff *is* the proposal.
2. **Scaffold**: `pnpm --filter @mcp-token-footprint/illustrations new <Name>` — generates the
   component file composing `EntityRoot` + primitives, a co-located test (registry entry ↔
   component contract: ports exist, states render, no color literals), and a gallery-visible
   entry (automatic — gallery reads the registry).
3. **Design within the system**: primitives only; new *shapes* go into `primitives/` (a new
   glyph is fine; a new one-off platform is a smell — extend `IsoPlatform`).
4. **Check**: the illustration checklist (quantized footprint · ports declared · all 5 states ·
   both themes eyeballed in the gallery · accent ≤ one moment · label screen-aligned ·
   `<title>/<desc>` present) + the standard gate. `check-tokens` already polices color
   literals in `packages/*/src`.
5. **Version**: bump `REGISTRY_VERSION` (minor for additive), note in the registry changelog.

Same loop for new **connector kinds** and **annotation kinds** — closed sets that only grow
through this process, keeping the grammar coherent.

## 7. Non-goals

- **Not a user-facing diagram editor** (that would be `@elabs-ai/components-flow` territory; a canvas
  *authoring* mode may layer on later but always emits the scene spec).
- **Not charting** (`@elabs-ai/components-charts`) and **not the marketing hero style** (the flat
  product-UI-theater language stays separate).
- **No third theme** and no re-adding `blueprint`; the system adapts to whatever the app's
  theme list is.
- **No new runtime dependencies**; no icon libraries inside illustrations (glyphs are
  system-drawn primitives, keeping the family coherent).
