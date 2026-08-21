# `@mcp-token-footprint/illustrations`

Theme-token-driven isometric "3D blueprint" illustrations for the app's own entities — MCP servers,
skills, agents, runs, suites, and the rest of the cast. Every drawing is composed from a small set of
primitives, painted only in `--illus-*` tokens, and catalogued in a registry the gallery, the scene
renderer and (later) the assistant all read.

Browse the whole catalog in the running app at **`/illustrations`** — a live grid in the current
theme, a detail dialog with the states × sizes × variants × facing matrix, a port overlay, and a
Primitives tab.

Plan, locked decisions **D-IL1–D-IL17** and the ledger:
[`planning/Roadmap/RM-14-illustrations/`](../../planning/Roadmap/RM-14-illustrations/).

---

## Adding a component

```bash
node packages/illustrations/scripts/new-component.mjs Owner --cast orchestration --tier 3
```

Options: `--cast <pilot|runtime|assets|orchestration>` (required) · `--tier 1|2|3` (default `3`) ·
`--entity <snake_case>` (the domain table it depicts, default none) · `--variants a,b` · `--dry-run`.

It writes **five files, or none of them**:

| File | What it gets |
| --- | --- |
| `src/entities/<Name>.tsx` | the component, its `*Meta` registry entry, its height function |
| `src/entities/<Name>.test.tsx` | the D-IL12 checklist, executed (`describeEntityContract`) |
| `src/entities/cast-<cast>.ts` | the re-export, the import and the cast member |
| `src/entities/cast-<cast>.test.ts` | the new id, in the module's own census |
| `CHANGELOG.md` | one dated line |

It refuses a duplicate id, an unknown cast, a non-PascalCase name, a single named variant, and any
target file that already exists.

**It does not touch `src/registry.ts` or `src/entities/index.ts`, and it never should.** Those name
no entity on purpose — that is WP 1.1's cast-module seam, and it is what lets two work packages add
entities in parallel worktrees without sharing a file. If the scaffold ever *needs* to reach into
either of them, the seam has regressed: **report it as a finding**, don't add the line.

Then **draw the thing**, and walk the checklist below before you call it done.

---

## The checklist (D-IL12)

Every one of these is either asserted by `describeEntityContract` or is a thing only a person can
check. The ones marked 👁 are the second kind — a green gate says nothing about them.

- [ ] **Footprint.** The entity draws at `s`, `m` and `l`, and each is a genuinely different
      scale — not one drawing in a bigger box. The quantized footprints (D-IL2) are what make two
      entities of the same size interchangeable inside a scene.
- [ ] **Ports.** Named for what a connector is attaching to (`context-in`, `result-out`), never
      left as the four cardinals the scaffold hands you. A port is the entity's sentence. An entity
      with no ports cannot take part in a scene at all (D-IL7).
- [ ] **Five states.** `idle` · `active` · `highlight` · `dimmed` · `error`, all implemented.
      `EntityRoot` gives you the shared affordances; add your own accent on top, never a new set.
- [ ] 👁 **Both themes.** `light` and `dark`, verified **by looking** at a rendered page (D-IL14).
- [ ] **Accent budget.** One accent moment (D-IL6). Two figures standing side by side must not cost
      two accents just by standing there.
- [ ] **Screen-aligned label.** The label is drawn flat, never skewed onto an iso face (D-IL2).
- [ ] **`<title>` / `<desc>`.** Free from `EntityRoot`, but the `description` you write **is** the
      `<desc>` — it is read aloud. Describe the drawing, not the feature.
- [ ] **Co-located contract test.** `<Name>.test.tsx` beside `<Name>.tsx`, calling
      `describeEntityContract`, plus whatever is specific to this drawing.

### The five things Phase 1 learned the hard way

Twenty entities were added by reading a neighbour and copying its shape. These are what that cost.

1. **`heightUnits` is load-bearing.** Every port anchor measures against it, so **two variants of one
   entity must not differ in height unless a connector is *meant* to move.** `Skill.tsx` says so at
   the top of the file for exactly this reason, and `Assistant.tsx` gives its `hub` variant a second
   panel of *the same* height rather than a taller one, so switching a scene between the two cannot
   drag a `top` connector with it.

2. **No `<path>` — compose from primitives.** Each entity's contract test asserts its rendered
   markup contains no `<path>` at all, at every size × variant. A shape you cannot express from
   `src/primitives/` is a **new primitive**, never an inline path. (The only things in the package
   that emit a `<path>` are stage furniture — `PaperStage`'s grid, `CalibrationCube`'s dimension
   line — and an entity draws neither.)

3. **A primitive that abstracts nothing is a finding — and reporting it is the sanctioned outcome.**
   WP 1.2 built the scan arch, found it was three `IsoHousing` calls with exactly one caller, and
   published `scanClearance()` instead. That was the right answer, not a failure to deliver. The
   opposite case is just as real: WP 1.3 checked whether the run track was extractable, found ~50
   lines and a set of proportions that would otherwise drift, extracted `IsoTrack`, and verified the
   `Run` refactor rendered **byte-identical** across every size × state × variant before committing.
   Do the check; write down which way it came out.

4. 👁 **Look at it.** Phase 1 changed five drawings **because somebody rendered them and looked** —
   a token-meter pointer invisible at `s`, crate battens that did not read, a gear whose teeth were
   shallow enough to read as a clock face, comparison specimens sitting too low at `m`. **A green
   gate caught none of them.** Build the preview (`pnpm --filter @mcp-token-footprint/illustrations
   preview`, or open `/illustrations` in the running app) and use your eyes.

5. 👁 **The whole-cast row.** Before declaring a new entity done, render **everything** at `m`/`idle`
   side by side. If it is hard to tell yours from a neighbour, change the **silhouette** — not the
   colour. D-IL5/D-IL6 will not give you a colour anyway. When `assistant` had to be distinguishable
   from `agent` at `s`, the answer was three silhouette differences (shorter figure, flat pad instead
   of a stepped plinth, a back panel rising above the head), each asserted in the test at the small
   footprint specifically.

---

## `REGISTRY_VERSION` — and why adding a component does not move it

`ILLUSTRATION_REGISTRY_VERSION` (in `packages/shared/src/illustration-registry.ts`) is a
**flag-don't-break compatibility marker**, stamped into every authored scene spec, doing for scenes
what `TOKEN_COUNTING_VERSION` does for scans. Adding an entity cannot invalidate a saved scene — no
scene can reference an id that did not exist when it was written — so **an addition leaves the number
alone**, and the growth record goes in [`CHANGELOG.md`](./CHANGELOG.md) instead.

It moves only when an **existing** entry's scene-visible contract breaks: an id or port renamed or
removed, a variant/state/size dropped, a footprint re-sized.

That rule has teeth. `src/registry-contract.snapshot.json` holds every entry's id, ports, variants,
states and sizes — deliberately *not* title, description, keywords or tier, which are cosmetic — and
`src/registry-contract.test.ts` fails the gate when one of them **loses or renames** a member while
the version stands still. It stays quiet for anything additive.

When you have added an entity (or a port, or a variant), refresh the snapshot:

```bash
ILLUS_UPDATE_REGISTRY_SNAPSHOT=1 pnpm --filter @mcp-token-footprint/illustrations test
```

That flag **refuses to write** while an unbumped breaking change is outstanding — otherwise the guard
would be silenceable by re-running it, which is not a guard.

See D-IL12 and its amendment of 2026-08-21 in
[`planning/Roadmap/RM-14-illustrations/decisions.md`](../../planning/Roadmap/RM-14-illustrations/decisions.md).

---

## Layout

```
src/
├── iso-math.ts        the projection, the three face transforms, the iso-ellipse rule (D-IL15)
├── layers.ts(x)       the fixed paint order (D-IL16) — z-order belongs to the layer, never an object
├── line-system.ts     stroke weights, dashes, text sizes
├── tokens.ts(x)       the closed `--illus-*` token layer; `tokens.css` is the ONE mapping file
├── primitives/        the shapes entities are built from — new shared shapes go HERE
├── entities/          one file per component, plus the four `cast-*.ts` modules and their censuses
├── registry.ts        the catalog, derived from the cast modules — it names no entity
├── dev/               dev-mode assertions (the face-separation floor)
└── preview/           the primitives sheet the preview scripts render
scripts/
├── new-component.mjs  the scaffold (above)
├── build-preview.ts   render the primitives sheet to standalone HTML, one file per theme
└── screenshot-preview.ts  put those two pages through a real headless browser
```

`scripts/` sits **outside** the package's `tsconfig.json` `include` — deliberately, so tooling never
becomes part of the shipped type surface. `new-component.mjs` is plain Node with no dependencies
(D-IL3), which is also why it reads the entity sources rather than importing the registry.

## Rules that apply here

Illustrations are **content graphics**, not UI controls, so they do not violate
[`brand-ui-only.md`](../../.claude/rules/brand-ui-only.md) — but every piece of chrome around them
(the gallery, its dialogs, buttons and toolbars) is `@elabs-ai/components-*`. The repo-root
`illustrations/` folder is **export output only**; this package is the source of truth. `apps/api`
never imports it.
