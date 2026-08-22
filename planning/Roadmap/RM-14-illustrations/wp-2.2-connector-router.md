---
type: "Work Package Spec"
title: "WP 2.2 - connector router (orthogonal port-to-port paths, parallel-run nudging, corner radii, label placement with node-box collision avoidance)"
description: "Phase 2 of 02-plan.md. Ledger: STATUS.md. The pure geometry layer between WP 2.1's layout and WP 2.3's renderer: every connector in a SceneSpec becomes an orthogonal path with fixed corner radii and a placed label, deterministically, with no DOM measurement and no colour."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-22T13:05:00Z"
status: "final"
---
# WP 2.2 — connector router + labels

Phase 2 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Authoritative shape:
[`01-system-design.md`](./01-system-design.md) **§4 (layout engine second pass, lines 179–193)** —
read it before writing anything.

**Depends on:** WP 2.1, **complete and merged** (`wp/roadmap-cleanup/rm14-2.1`). Its
`packages/illustrations/src/scene/layout.ts` already resolves every endpoint a connector may name
to a canvas point, and its header says so in as many words:

> `endpoints` — "Every endpoint a connector may name — `nodeId.port` for a node,
> `bandId.entry`/`.exit` for a cycle band — already resolved to a canvas point. **This is WP 2.2's
> entire input from this file:** the router looks up two keys and draws between them, and never has
> to know what a band is."

Take that seam literally. The router reads `SceneLayout` and `IllustrationSceneSpec.connectors`.
It does **not** re-derive positions, and it does **not** learn what a band is.

**Blocks:** WP 2.3 (`<IllustrationScene>` renderer) and WP 2.4 (acceptance scene + export).

---

## 1. What this WP is, and what it deliberately is not

`route.ts` is **pure geometry**. In → a `SceneLayout` plus the spec's connectors. Out → for each
connector, an orthogonal polyline reduced to SVG path data, plus a label box placed clear of every
node. **No React, no SVG elements, no colour, no stroke width, no dash.**

That split is not tidiness, it is the acceptance surface: a pure function returning numbers can be
golden-tested to the byte, which is how WP 2.1 proved determinism and how this WP must prove it
too. The *painting* of a routed path — which `--illus-*` stroke, which dash from `ILLUS_DASH`,
which marker — belongs to WP 2.3's renderer, because that is the layer that emits elements.

> **The one thing you must not do:** give the router a `stroke`, `fill`, `color`, `className` or
> `opacity`. WP 2.1's schema is colour-free *by construction* and that is a structural rule of this
> workstream, not a style preference. The router's output type must be equally colour-free, so a
> future author cannot smuggle a colour through the geometry layer.

---

## 2. The routing rules

### 2.1 Orthogonal port-to-port

A path leaves its source endpoint and arrives at its target endpoint on **axis-aligned segments
only** — horizontal and vertical runs joined at 90° corners. No diagonals in the connector layer.

Isometric entities sit on a skewed grid; their *ports* do not. Ports resolve to plain canvas points
(see `SceneNodeLayout.ports`), so the router works in ordinary screen space. Do not import
`iso-math` projection into the router — if you find yourself needing it, the seam has been crossed.

**Departure and arrival direction.** A port carries no declared normal today, so derive it: compare
the port point to its owning node's `frame` and leave along the axis whose face the port sits
nearest. A port on the left half departs west, right half departs east, and a port materially above
or below the frame's vertical mid-band departs north or south respectively. Make the rule a named,
exported, unit-tested function — it is the single most re-read decision in this file, and the
renderer will want it for marker rotation.

**Route shapes.** Two endpoints and two departure directions admit a small, closed set of shapes.
Implement exactly these, in this precedence:

| Shape | When | Corners |
| --- | --- | --- |
| straight | endpoints already share an axis and directions agree | 0 |
| L | directions are perpendicular | 1 |
| Z (mid-split) | directions are opposing and facing each other | 2 |
| U (loop-back) | directions are opposing and facing away | 2 |

A `cycle` band's `entry`/`exit` endpoints are ordinary points on this list — the router does not
special-case them, and the `loop` connector kind is a *painting* concern, not a routing one.

### 2.2 Parallel-run nudging

Two connectors sharing a run risk drawing on top of each other and reading as one line. Where two
or more routed segments are collinear and overlapping, **offset them apart by a quantized step**
about the shared centre-line, ordered deterministically (sort by connector identity, never by
insertion order alone, or the same spec routes differently after a JSON round trip).

The nudge step is a named constant in the same style as WP 2.1's `*_UNITS` exports. Reuse the unit
grid — a nudge is not a free pixel value.

### 2.3 Corner radii

Corners are **fixed-radius**, one exported constant, clamped so a radius never exceeds half the
shorter of the two segments it joins (otherwise a short run inverts and the path self-crosses).
The clamp is not an edge case to note in a comment; it is a test case.

### 2.4 Label placement with collision avoidance

A connector's optional `label` is placed at the path midpoint, then moved clear of node boxes:

- Collide against **node `frame` rectangles only** — cheap, deterministic, and exactly what the
  system design specifies. **Do not** collide labels against other labels, against band frames, or
  against the paths themselves.
- **No measurement of rendered text.** There is no DOM here and there must be no `getBBox`. Derive
  the label box from character count against `ILLUS_TEXT.caption` (already exported from
  `line-system.ts`) with a documented advance-width ratio, stated as a constant with its reasoning.
  An approximate box is correct; a measured one is unbuildable in a pure function and would break
  determinism across environments.
- Displacement is **quantized and ordered**: try the candidate offsets in a fixed sequence
  (perpendicular one side, then the other, then along the path) and take the first that clears. If
  nothing clears, return the midpoint placement **and flag it** on the output rather than looping
  or inventing a position — a scene author needs to know a label is sitting on a box.

### 2.5 Determinism (the acceptance spine)

Same spec + same layout ⇒ **byte-identical** router output. Gate-enforce it the way WP 2.1 did, and
copy that file's discipline rather than inventing a new one:

- the same input routed twice is deep-equal;
- the input through a `JSON.parse(JSON.stringify(...))` round trip routes identically;
- a catalog whose port records are rebuilt in **reverse order** routes identically;
- a source guard bans `Math.random`, `Date`, `getBBox` and `getBoundingClientRect` from the
  router's own text.

Golden fixtures go beside WP 2.1's, in the same shape: `scene/golden/<name>.routes.json` for the
two existing fixtures (`self-learning-loop`, `run-turn-cycle`).

---

## 3. Files

| File | Change |
| --- | --- |
| `packages/illustrations/src/scene/route.ts` | **New.** The router: types, constants, the departure-direction rule, the four shapes, nudging, radii, label placement. |
| `packages/illustrations/src/scene/route.test.ts` | **New.** Unit + determinism + guard tests. |
| `packages/illustrations/src/scene/golden/*.routes.json` | **New.** One per existing fixture. |
| `packages/illustrations/src/scene/index.ts` | Export the new surface; update the header comment, which currently names `route.ts` as "still to come". |

**Do not touch** `packages/shared/**` — this WP needs no wire change and no schema change. The
connector contract (`from`, `to`, `kind`, `label`, optional `id`) already exists and is frozen by
WP 2.1. If you believe you need a schema field, stop and say so in your report instead of adding
one.

**Do not touch** `layout.ts` beyond reading it. If the endpoint seam turns out to be insufficient,
that is a finding worth reporting, not a licence to widen it mid-WP.

---

## 4. Rules that bind this WP

- **No new dependency.** The package's dependencies are `react` (peer) and
  `@mcp-token-footprint/shared`. Nothing else. A routing library is a hard no.
- **No colour, anywhere.** Enforced by the package-wide recursive scan that already exists — keep
  it green.
- **Gate from the repo root:** `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
- Note the harness fix that landed with the last batch: `packages/illustrations`' `test` script now
  rebuilds `packages/shared` first. Do not remove it — without it the suite reads a stale `dist`
  and can invent or hide failures.

---

## 5. Acceptance

- [ ] `route.ts` exists and is **pure**: no React import, no SVG element, no DOM API, and no
      colour, stroke-width or dash value anywhere in its output type or its body.
- [ ] Every connector in both existing fixtures routes to an orthogonal path — asserted by a test
      that walks each emitted segment and fails on any that is neither horizontal nor vertical.
- [ ] The four route shapes (straight · L · Z · U) are each covered by a test that pins the corner
      count and the turn points.
- [ ] The departure-direction rule is an exported, separately unit-tested function.
- [ ] Two overlapping collinear runs are nudged apart; a test asserts they no longer share a
      centre-line, and asserts the offset order is stable under input reordering.
- [ ] Corner radius is clamped to half the shorter joined segment; a short-run test proves the
      clamp bites and the path does not self-cross.
- [ ] A label whose midpoint lands inside a node `frame` is displaced clear of every node frame; a
      test constructs that collision and asserts the final box intersects no node frame.
- [ ] A label that cannot be cleared is returned at its midpoint **with an explicit flag**, and a
      test asserts the flag rather than an exception or a loop.
- [ ] Determinism: same input twice, JSON round trip, and reverse-ordered catalog all produce
      byte-identical output. Three separate assertions.
- [ ] A source guard fails on `Math.random`, `Date`, `getBBox` and `getBoundingClientRect` in the
      router's own text.
- [ ] Golden route files are committed for both fixtures and are regenerated by a documented
      command, not by hand.
- [ ] `scene/index.ts` exports the router and its header no longer calls `route.ts` "still to come".
- [ ] Gate green from the repo root, all four commands.

**Prove the teeth, do not assert them.** For at least three of the guards above — determinism, the
orthogonality walk, and the label-collision assertion — deliberately break the implementation,
watch the test go red, then restore it, and report exactly what you broke and what failed. A guard
nobody has seen fail is not yet a guard.

---

## 6. Out of scope

- Any React, any SVG element, any painted connector — that is WP 2.3.
- Annotation **leader lines** (the 90°/30°/150° iso-angle elbows, D-IL16). They are annotation
  furniture drawn by the renderer, not connectors, and they belong to WP 2.3.
- Marker/arrowhead geometry and per-kind dash selection — WP 2.3.
- Label *typography* beyond the approximate advance-width box — WP 2.3.
- Collision avoidance against other labels, band frames or paths. Explicitly excluded by the system
  design; adding it would make the router non-cheap and non-obvious for no stated gain.
- Any change to `packages/shared`, any migration, any new dependency.
