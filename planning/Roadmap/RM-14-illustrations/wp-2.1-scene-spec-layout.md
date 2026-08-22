---
type: "Work Package Spec"
title: "WP 2.1 - scene spec + layout engine (SceneSpec zod in shared, band/lane/hub/cycle layout, validator, golden tests)"
description: "Phase 2 of 02-plan.md. Ledger: STATUS.md. The declarative composition layer: one zod SceneSpec in packages/shared, a deterministic band layout engine in packages/illustrations, and a validator that refuses a spec naming an id, port or kind the registry does not have."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-22T11:12:00Z"
status: "final"
---
# WP 2.1 — scene spec + layout

Phase 2 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). The authoritative shape is
[`01-system-design.md`](./01-system-design.md) **§4 (Scene spec) and its "Layout engine"
subsection** — read both before writing anything.

**Depends on:** Phase 0 + Phase 1, **complete**. The catalog is **24 components**, the registry is
validated at module load, `REGISTRY_VERSION` is `0.1.0`, and
`packages/illustrations/src/registry-contract.snapshot.json`
pins every entry's scene-visible contract (id · ports · variants · states · sizes).

**Blocks:** WP 2.2 (connector router), 2.3 (renderer), 2.4 (acceptance scene) — and everything in
Phases 3–4, because explain mode and the assistant compose tools both emit or consume this spec.

**Why this is the load-bearing WP:** Phase 1 delivered breadth — 24 components and nothing that
composes them. This is the piece that turns a component catalog into an illustration system.

---

## 1. The split of responsibilities (D-IL, §2 of the system design)

- **`packages/shared`** owns the `SceneSpec` **types + zod schemas** — one file,
  `src/illustration-scene.ts`. Shared owns the contract because the API will one day store and
  validate scene JSON (Phase 3's `illustration_scenes`) and the assistant will emit it (Phase 4);
  neither may import the illustrations package.
- **`packages/illustrations`** owns the **layout engine** and the renderer. Suggested home:
  `src/scene/spec-validate.ts` + `src/scene/layout.ts` (the system design names `spec.ts` /
  `layout.ts`; place them under a `scene/` folder so Phase 2's four WPs do not fight over one
  directory).

`packages/shared` must **not** gain a dependency on `packages/illustrations` in either direction
that did not already exist. If the validator needs registry facts, it lives on the illustrations
side and takes the registry as input.

## 2. The schema

Model it on §4's JSONC block. Required top level: `version`, `registryVersion`, `id`, `title`,
`summary`, `canvas`, `bands`, `nodes`; optional `connectors`, `annotations`, `steps`.

Three rules are **structural, not stylistic** — they are why the spec exists at all, and each one
must be impossible to violate rather than merely discouraged:

1. **Colour and stroke are not expressible.** There is no colour field anywhere in the schema. A
   connector carries a `kind`; the kind maps to a token downstream. A spec physically cannot go
   off-brand. Do not add a `color`, `stroke`, `className` or `style` field "for flexibility".
2. **`title` and `summary` are required.** They are the `role="img"` text alternative — a11y is
   schema-enforced, so an inaccessible scene cannot be authored.
3. **Nodes name registry ids and connectors name ports.** Both are validated (see §4).

Band kinds — **four**, not three:

| kind | behaviour |
| --- | --- |
| `lane` | stations distributed horizontally by `seq`, quantized gaps |
| `hub` | nodes centred as one group (the shared entities every station reaches) |
| `cycle` | **ring** of stations with `stations`, `direction` (`cw`/`ccw`), entry/exit gaps and a `counter` label |
| `annotations` | annotation cards, no nodes |

The `cycle` kind is **not optional** and is not an invention of this spec file — it was discovered
by the run-flow exemplar, whose own `$comment` records that *"the lane/hub grammar cannot express
an execution loop"*. A `cycle` band exposes `entry` and `exit` as connector endpoints on the band
itself (`loop.entry`, `loop.exit` in the exemplar), not on any one station.

## 3. The layout engine

Deterministic, **two-pass**, per §4's "Layout engine":

1. Bands stack vertically per canvas format; `lane` distributes by `seq` with quantized gaps;
   `hub` centres its nodes as one group; `cycle` places `stations` around a ring in `direction`
   with the entry/exit gaps; an explicit `{x,y}` on a node **overrides** (the escape hatch).
2. Pass 2 — port-to-port routing — is **WP 2.2, not this WP**. Emit resolved node boxes and port
   coordinates so 2.2 has something to route between; do not write the router here.

**Determinism is the acceptance criterion, not a nice-to-have.** Same spec + same canvas format ⇒
byte-identical layout output. No DOM measurement, no `Math.random`, no `Date`, no iteration over
an unordered `Set`/object whose insertion order could change. The golden tests exist to catch
exactly this.

Also honour `attach` (a node pinned to another node rather than sequenced — `plan-card` attached to
`agent`, `context` attached to `loop-append` in the exemplar) and the existing `iso-math.ts`
unit/height conventions (`entityHeightUnits`) rather than inventing a second geometry.

## 4. The validator

`validateScene(spec, registry)` returns **a list of errors, not a throw**, each naming the offending
path (`nodes[3].component`, `connectors[5].from`). It must reject:

- a `component` that is not a registry id;
- a port that the named component does not expose (check against the entry's `ports`);
- a `variant`/`state`/`size` the entry does not declare;
- a `band` reference that names no band; a `connectors` endpoint naming no node (or, for a `cycle`
  band, neither `entry` nor `exit`);
- a `steps[].focus` / `steps[].connectors` id that resolves to nothing;
- a `registryVersion` **major/minor** ahead of the package's own `REGISTRY_VERSION` (flag-don't-break
  per the dated 2026-08-21 amendment to D-IL12 — adding a component does not bump the version, so a
  spec authored against an older version stays valid).

## 5. Fixtures — and one trap, already verified

Golden tests are spec fixture ⇒ stable layout snapshot.

⚠ **[`examples/run-flow.scene.json`](./examples/run-flow.scene.json) will NOT validate today, and
that is correct.** It names **nine components that do not exist** in the 24-entry registry:
`person` · `plan-card` · `station-decide` · `station-tool-call` · `station-observe` ·
`station-append` · `context-stack` · `summarizer` · `answer-card`. (Verified against
`registry-contract.snapshot.json` — the 24 ids are `agent · assistant · collection ·
credentials-vault · database · diff-compare · environment · feedback-report · file · mcp-server ·
model · orchestrator · owner · prompt · prompt-template · provider · resource · run · scan · skill ·
suite · token-meter · tool · validator`.)

So use it as the **band-grammar reference and as a validator NEGATIVE fixture** — a test that
asserts the validator reports exactly those nine unknown-component errors is worth more than a
green snapshot. **Do not** add nine components to make it pass: that is a separate work package's
job, and inventing them here would ship untested entities through the back door. Write your
positive golden fixtures from ids that exist.

WP 2.4's acceptance scene (Self-Learning Agentic Loop) uses `agent`, `mcp-server` and `skill`,
which all exist — a small positive fixture in that shape is the right primary golden test.

## 6. Rules that bind this WP

- Contract-first: the schema lands in `packages/shared` **first**, then the engine consumes it.
- `packages/illustrations` is **token-only** — the closed `--illus-*` layer, zero colour literals,
  enforced by the existing recursive package-wide scan. Do not weaken that scan.
- No new runtime dependency. No layout library, no graph library, no force simulation.
- Kebab-case files, co-located `name.test.ts`.

## 7. Acceptance

- [ ] `SceneSpec` types + zod live in `packages/shared/src/illustration-scene.ts` and are exported;
      colour/stroke are not expressible anywhere in the schema; `title` + `summary` are required.
- [ ] Four band kinds are modelled — `lane`, `hub`, `cycle`, `annotations` — and `cycle` carries
      `stations`, `direction`, entry/exit and a `counter`.
- [ ] The layout engine resolves bands to node boxes + port coordinates deterministically, honours
      `seq`, `attach` and explicit `{x,y}` override, and does no DOM measurement.
- [ ] `validateScene` returns path-tagged errors for every case in §4 and never throws on bad input.
- [ ] Golden tests: at least two positive fixtures (one including a `cycle` band) snapshot a stable
      layout, and the same spec run twice produces identical output.
- [ ] A negative test asserts `run-flow.scene.json` reports exactly its nine unknown components.
- [ ] `REGISTRY_VERSION` is **unchanged** and the registry-contract snapshot is untouched — this WP
      adds no entity.
- [ ] Gate green from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## 8. Out of scope

- The connector **router** (WP 2.2), the `<IllustrationScene>` **renderer** (WP 2.3), the acceptance
  scene + SVG export (WP 2.4).
- Explain mode / step player (Phase 3), scene persistence + migration (WP 3.3), assistant tools
  (Phase 4).
- Any new illustration component.
