---
type: "Work Package Spec"
title: "WP 2.3 - the <IllustrationScene> renderer (deterministic SVG from a validated spec, fixed layer order, accessible title/desc, annotation cards, dev-only accent-ratio warning)"
description: "Phase 2 of 02-plan.md. Ledger: STATUS.md. The first thing in this workstream that draws a scene: layoutScene + routeScene + the 24-component catalog become one SVG element, byte-identical for the same spec, with no geometry of its own and no colour literal anywhere."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-22T20:30:00Z"
status: "final"
---
# WP 2.3 — `<IllustrationScene>` renderer + annotations

Phase 2 of [`02-plan.md`](./02-plan.md) (§WP 2.3). Ledger: [`STATUS.md`](./STATUS.md). Locked
decisions: [`decisions.md`](./decisions.md).

**Depends on** WP 2.1 (`layout.ts`, `spec-validate.ts`, `catalog.ts` — merged) and WP 2.2
(`route.ts` — merged). **Blocks** WP 2.4 (the acceptance scene + standalone export), which is the
owner-visible milestone of the whole phase.

**This is the load-bearing WP of the item.** Twenty-four components exist and *nothing composes
them*; two pure-geometry layers exist and *nothing paints them*. After this WP a `SceneSpec` becomes
a picture.

---

## 1. Where every premise below was read

Read at `main` @ `01a87fe`. A premise that does not cite a file is not a premise.

| Fact | Read at |
| --- | --- |
| `Scene.tsx` is this WP's job and is deliberately absent | `packages/illustrations/src/scene/index.ts:12-13` |
| The layout the renderer consumes | `scene/layout.ts:174-188` (`SceneLayout`), `:111-128` (`SceneNodeLayout`: `origin`, `frame`, `ports`), `:141-151` (bands), `:153-160` (annotations), `:162-172` (`SceneCanvasLayout`, incl. a ready-made `viewBox` string) |
| The routing the renderer consumes | `scene/route.ts:165-206` (`RoutedConnector`: `d`, `points`, `kind`, `shape`, `doublesBack`), `:147-163` (`RoutedLabel`: `anchor`, `box`, `collides`), `:208-220` (`UnresolvedConnector`, `SceneRouting`) |
| The catalog seam — entry + height, nothing else | `scene/catalog.ts:16-27` (`SceneCatalog`, `ILLUSTRATION_SCENE_CATALOG`) |
| Every entity takes the **same** props, and the scene renderer is named as a reason | `src/entities/entity-props.ts:1-10`, `:22-39` (`EntityComponentProps`), `:46-53` (`IllustrationEntityComponent`, `entityHeightUnits`) |
| The fixed paint order, and that z-order belongs to the layer | `src/layers.tsx:21-33` (`ILLUSTRATION_LAYERS`, `DEFAULT_ILLUSTRATION_LAYER`) |
| Validation already exists and returns path-tagged issues | `scene/spec-validate.ts` (`validateScene`, `parseScene`, `SceneIssue`, `SCENE_ISSUE_CODES`) |
| Connector kinds are a closed six | `packages/shared/src/illustration-registry.ts:69-77` (`flow`, `read`, `write`, `publish`, `loop`, `signal`) |
| Annotation kinds are a closed two | `packages/shared/src/illustration-scene.ts:99-103` (`callout`, `principle-card`) |
| Canvas formats are a closed three, and a stage is `paper`/`plain` | `illustration-scene.ts:72-87` |
| Both version stamps a stored scene carries | `illustration-scene.ts:65-70` (`ILLUSTRATION_SCENE_SPEC_VERSION`) + `ILLUSTRATION_REGISTRY_VERSION` |
| The package has **no** brand-ui dependency — only `react` (peer) and `shared` | `packages/illustrations/package.json` |
| Tests render with `renderToStaticMarkup`, no DOM, no jsdom | `src/test-support.tsx:5-14` |
| An entity's contract test asserts its markup contains **no `<path>` at all** | WP 0.3's shipped pattern, per `STATUS.md` |

---

## 2. What it does

One component:

```tsx
<IllustrationScene spec={spec} />
```

It validates, lays out, routes, and paints — and it computes **no geometry of its own**. Every
number it draws with came out of `layoutScene` or `routeScene`. That is the seam the two previous
WPs were built to create, and widening it here would put a third, quietly different answer in the
package.

### Paint order (D-IL16)

Exactly `ILLUSTRATION_LAYERS`, in order: `stage → shadows → structure → detail → connectors →
annotations → labels`. Use the shipped `<Layer>` mechanism (`layers.tsx`); do not order by JSX
position and do not give any element its own z-index. A scene author cannot lift one node above
another, and that is the point.

### The stage

`canvas.stage === "paper"` draws the drafting sheet — grid and registration marks; `"plain"` is the
same stage with the grid off (`illustration-scene.ts:80-87`). Both are `--illus-*` tokens.

### Entities

Each `SceneNodeLayout` instantiates its component from the catalog and is translated to `origin`.
Pass exactly the contract props — `size`, `state`, `facing`, `detail`, `variant`, and `label` where
the spec carries a caption. **Pass `idPrefix` derived from the node id**, because `entity-props.ts`
says that is what makes the same entity emit the same bytes in two trees — the export path in WP 2.4
depends on it, and a random or index-derived prefix would break determinism the moment a spec is
reordered.

### Connectors

`RoutedConnector.d` is the path. The renderer chooses the **stroke treatment per `kind`** — the
closed six — from `--illus-*` tokens, and an arrowhead where the kind carries direction. Two honesty
rules, both non-negotiable:

- **`doublesBack === true`** means the router could not honour the ports with its four shapes
  (`route.ts:190-206`). Draw it anyway — the best-effort path — and surface it through the dev
  warning (below). **Never drop it silently**, and never invent a different path to hide it.
- **`SceneRouting.unresolved`** names connectors whose endpoints the layout could not resolve. These
  have no geometry, so they cannot be drawn; they must be reported through the dev warning and the
  issue channel, not swallowed.

### Labels

`RoutedLabel.anchor` is where text is centred; the renderer sets its own baseline. `collides === true`
means no candidate placement cleared every node frame and the label is sitting on a box
(`route.ts:157-162`). Render it — the author needs to see it — and count it in the dev warning.
Labels are **screen-aligned**, never skewed onto a face (D-IL2).

### Annotation cards

`callout` and `principle-card`, drawn in SVG from primitives and `--illus-*` tokens — **not** from
`@elabs-ai/components-*`. The package has no such dependency and must not gain one: illustrations are
content graphics, not UI controls (D-IL14). Leader lines elbow only at **90° / 30° / 150°** (D-IL16).

### Accessibility

`role="img"` on the root `<svg>`, with `<title>` = `spec.title` and `<desc>` = `spec.summary`, wired
by `aria-labelledby`/`aria-describedby` to stable ids derived from the scene id. Both fields are
**required** by the schema precisely so an inaccessible scene cannot be authored (WP 2.1's structural
rule); do not add a fallback that lets an empty one through.

### The dev-only accent-ratio warning (D-IL6)

`--illus-accent` is the single hero accent at roughly **2–6%** of a scene. In development only,
compute the accented proportion from the scene's own declared parts (accent-carrying nodes,
connectors and annotations against the total) and `console.warn` when it falls outside the band.

- **Dev only** — gated on `process.env.NODE_ENV !== "production"`, never shipped in a production
  bundle.
- **Never throws**, never blocks a render, never appears in the rendered markup.
- The same channel reports `doublesBack` connectors, `unresolved` connectors and colliding labels —
  one warning path, so an author has one place to look.

### An invalid spec

`validateScene` already returns path-tagged issues. The renderer must render a **visible, accessible
failure** — an in-SVG notice carrying the issue list, still `role="img"` with a title saying the
scene could not be drawn. It must not render a blank canvas, must not throw, and must not draw a
partial scene that looks complete.

---

## 3. Determinism (gate-enforced, the same way WP 2.1 and 2.2 were)

Same spec + same catalog ⇒ **byte-identical markup**. Prove it three ways, as the two previous WPs
did:

1. Render twice, compare the strings.
2. Render, JSON round-trip the spec, render again, compare.
3. Render against a catalog whose entries are rebuilt in **reverse order**, compare.

Plus the source guard the engine already carries: **no `Math.random`, no `Date`** in the renderer's
own text. Any id it emits is derived from the scene and node ids, never from a counter, an index
alone, or React's `useId`.

---

## 4. Files

**Add:**

- `packages/illustrations/src/scene/Scene.tsx` — the renderer
- `packages/illustrations/src/scene/Scene.test.tsx` — determinism, layer order, a11y, kinds, honesty
- `packages/illustrations/src/scene/annotations.tsx` — the two card kinds (if it does not fit cleanly
  inside `Scene.tsx`; one file either way, not a folder of one-offs)
- fixtures under `scene/fixtures/` as needed, following the shipped pattern

**Modify:**

- `packages/illustrations/src/scene/index.ts` — export the renderer; **update the header comment**,
  which currently says `Scene.tsx` is absent
- `packages/illustrations/src/index.ts` — the package barrel
- `packages/illustrations/CHANGELOG.md` — the growth record (`REGISTRY_VERSION` does **not** move;
  see the 2026-08-21 amendment to D-IL12 in `decisions.md:88-102` — this adds no component and
  changes no entry's contract)

**Do not touch** (another agent holds them this batch): `apps/**`, `packages/shared/**`. If the
renderer genuinely needs a shared type that does not exist, **stop and report it** rather than
widening the wire — that is what the previous batch's two wrong specs cost.

---

## 5. Non-goals

- **No export.** Standalone SVG with resolved theme values is WP 2.4.
- **No gallery integration.** The Scenes tab is WP 2.4; `apps/web` is a zero-line diff here.
- **No explain mode**, no step player, no phased opacity (Phase 3).
- **No persistence**, no route, no migration, no API (WP 3.3).
- **No new component, no new primitive, no new variant, no new port.** If a scene needs something
  the 24-entry catalog lacks, that is a finding to report, not a component to invent — the WP 2.1
  exemplar `examples/run-flow.scene.json` is deliberately a **negative** fixture for exactly this
  reason, and no component was invented to make it pass.
- **No colour literal, no `@elabs-ai/components-*` import, no new dependency.**

---

## 6. Acceptance

1. `<IllustrationScene spec={…} />` renders a complete SVG for a valid spec: stage, entities in
   their laid-out positions, connectors on the routed paths, labels at the routed anchors, annotation
   cards.
2. **Layer order is `ILLUSTRATION_LAYERS`**, asserted by reading the emitted markup — not by
   inspecting the JSX.
3. **Determinism**: all three comparisons above pass, and the `Math.random`/`Date` source guard
   covers the new file. Break the id derivation and watch a determinism test go red.
4. **`role="img"` + `<title>`/`<desc>`** from `spec.title`/`spec.summary`, correctly associated,
   asserted on the markup.
5. **No colour literal anywhere** — the package-wide recursive scan that WP 0.1 shipped stays green,
   and the new files are inside its reach.
6. **Every connector kind renders distinguishably** (all six), and distinguishably by more than hue
   alone — pattern or terminal, not colour only. A reader who cannot separate two hues must still be
   able to separate a `read` from a `write`.
7. **`doublesBack` is drawn and reported, never dropped**; **`unresolved` is reported, never
   swallowed**; **`collides` labels render and are counted**. Each asserted with a fixture that
   produces the condition.
8. **The accent warning fires outside 2–6% and is silent inside it**, is dev-only, throws nothing,
   and contributes nothing to the markup.
9. **An invalid spec renders a visible, accessible failure** carrying the validator's issues — not a
   blank canvas, not a throw, not a plausible-looking partial scene.
10. **No `apps/**` or `packages/shared/**` diff.** No new dependency. `REGISTRY_VERSION` unchanged,
    and the checked-in `registry-contract.snapshot.json` still passes.
11. **Gate green**: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` from the repo root.
12. **Report what was not verified.** Nothing in Phase 2 has been rendered in a browser or looked at
    in either theme across WPs 2.1 and 2.2. If this WP does not open one either, say so plainly —
    "the markup is asserted" is a different claim from "the picture reads", and only the first will
    be true.
