---
type: "Work Package Spec"
title: "WP 1.1 - runtime cast (model, provider, validator, run, prompt) and the cast-module seam"
description: "Phase 1 of 02-plan.md. Ledger: STATUS.md. Five tier-1 entities that complete the agentic-loop cast, plus the one structural change that lets WP 1.2 and WP 1.3 then run in parallel without touching a shared file."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T01:50:00Z"
status: "final"
---
# WP 1.1 — runtime cast + the cast-module seam

Phase 1 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Cast source: [`00-research.md`](./00-research.md) §5 (tier 1).

**Depends on:** WP 0.1, WP 0.2, WP 0.3 — and on the owner having ticked the **Phase 0
acceptance box**, which the ledger makes a hard stop.
**Consumed by:** WP 1.2 and WP 1.3 (both build on the seam this WP lands), WP 1.4 (the scaffold
appends to the seam), Phase 2 (the scene renderer resolves `node.component` against the registry).

**This WP goes first in Phase 1 and the other two wait on it.** That is a deliberate change from
`02-plan.md`'s "1.x in parallel worktrees (entities are independent files)". The entity files are
independent; `src/registry.ts` and `src/entities/index.ts` are **not**, and three branches appending
to the same two files is exactly the collision `/next-wp` forbids. §1 below removes the shared file
from the picture, once, so that 1.2 ∥ 1.3 is then genuinely parallel.

---

## Locked decisions this WP implements

- **D-IL2** — quantized footprints, three-face solids, screen-aligned labels only.
- **D-IL5** — no color literal; `--illus-*` only.
- **D-IL6** — roughly **one accent moment per entity**. Five new entities must not add five new
  places for the eye to go.
- **D-IL7** — ports are named in the registry entry; a drawing never publishes a coordinate.
- **D-IL9** — no component ships without an entry.
- **D-IL12** — the checklist, as the co-located contract test calling `contract-support.tsx`.
- **D-IL17** — `validator` has a face, so it declares `facing` and honours it. `model`, `provider`,
  `run` and `prompt` are faceless and ignore the prop.

## 1. The cast-module seam (do this first, in its own commit)

Today `src/registry.ts` names each entity by hand and `src/entities/index.ts` re-exports each one.
Replace the hand-listing with three cast modules:

- `src/entities/cast-runtime.ts` — this WP's five, populated.
- `src/entities/cast-assets.ts` — **empty array, exported**, for WP 1.2.
- `src/entities/cast-orchestration.ts` — **empty array, exported**, for WP 1.3.

Each exports one `readonly IllustrationCastMember[]`, where a cast member is the pair the registry
already needs and currently keeps in two places:

```ts
export type IllustrationCastMember = {
  meta: IllustrationRegistryEntry;
  component: IllustrationEntityComponent;
};
```

The three pilots become a fourth module (`cast-pilot.ts`) rather than staying inline, so there is
**one** way to be in the catalog, not two. `registry.ts` then imports the four arrays, concatenates,
sorts and `.parse`s exactly as it does now — `ILLUSTRATION_REGISTRY` and `ILLUSTRATION_COMPONENTS`
keep their current public shape and are still derived from one list, so the both-directions test in
`registry.test.ts` still means what it means today.

**Acceptance for the seam specifically:** after it lands, adding an entity touches **its own file
and its own cast module, and nothing else**. Prove it by writing that sentence as a test — the
existing `registry.test.ts` already holds ids and components equal in both directions; add the
assertion that every cast member's `meta.id` is unique across all four modules, so two WPs that
independently pick the same id collide **loudly at load** instead of one silently winning the
`Record` key.

Keep the empty-array modules **committed and exported** even though they render nothing. An empty
module that already exists is what makes 1.2 and 1.3 conflict-free; a module each of them creates is
the same conflict moved one file over.

## 2. The five entities (`src/entities/`)

Follow `Skill.tsx` exactly as the pattern — it is the shortest of the three pilots and shows every
required part: an exported `*Meta` registry entry, an exported `*_VARIANTS` tuple with a
`resolveVariant` that **falls back rather than throws**, an exported `*HeightUnits(size)`, the
component rendering `<EntityRoot>` around primitives only, and `Component.illusLayer` +
`Component.entityHeightUnits` attached afterwards.

| id | Drawing (research §5, tier 1) | Variants | Named ports (beyond the four cardinals) | Suggested `entity` binding |
| --- | --- | --- | --- | --- |
| `model` | Chip/badge on a low plinth — the silicon the agent thinks with; contact rows on the top face | `hosted` / `local` | `context-in`, `tokens-out` | *(omit — `model_pricing` is pricing, not the model)* |
| `provider` | Neutral **logo-slot housing**: a blank cartouche on the front face, never a real vendor mark | *(none)* | `serves` | `provider_credentials` |
| `validator` | Shield agent — the `agent` silhouette carrying a shield glyph on its facing panel | `grader` / `guardrail` | `subject-in`, `verdict-out` | `run_grades` |
| `run` | Conveyor/track segment — a length of track on the ground plane with direction marks | `single` / `repeated` | `enter`, `exit` | `runs` |
| `prompt` | Speech bubble standing on a display plinth | `user` / `system` | `emit` | `tests` |

Rules on that table:

- **`provider` must stay logo-free.** A vendor mark is a color literal's cousin: it dates, it
  implies endorsement, and it cannot be themed. Draw the slot, not the logo.
- **Bind `entity` only to a table an operator would recognise as this thing**, and **omit it rather
  than stretch**. The field is optional and `searchIllustrations` already handles `undefined`.
- Port names are the semantic vocabulary connectors will attach to in Phase 2 (D-IL7). Prefer a name
  that reads in a sentence — `subject-in` → `verdict-out` — over a compass direction.
- Every entity: S/M/L × all five states, `<title>`/`<desc>` from the entry, one accent moment.

## 3. The `validator` reuse question — decide it, do not duck it

`validator` is "the `agent` robot plus a shield". Two honest options:

1. **A new primitive** in `primitives/` (D-IL12 forbids inlining a reusable shape into one entity),
   with `Agent` refactored to use it too.
2. **A `variant` on `agent`** — no new registry id at all.

Option 2 is cheaper and probably wrong: the registry is what the gallery, the scene validator and
the assistant search, and "validator" is a thing an operator names, not a costume the agent wears.
**Build option 1**, and record in the done-line what moved into `primitives/`. If the shared shape
turns out to be one `<polygon>` and nothing else, say so — a primitive that abstracts nothing is
also a finding.

## 4. Traps

- **`registry.test.ts` is where a bad entry surfaces, and it surfaces at MODULE LOAD.** `.parse`
  runs on first import, so a malformed entry fails the gallery, every entity test and the scene
  renderer at once, naming the field. That is intended — do not soften it to a filter.
- **The five states are not five colors.** Look at how `Skill.tsx` derives `accent` from `state`
  and how `EntityRoot` handles `dimmed`/`error`; states are handled by the root for you. An entity
  that re-implements state styling has duplicated `EntityRoot` and will drift from it.
- **`heightUnits` is load-bearing** (see the comment at the top of `Skill.tsx`): every port anchor is
  measured against it, so two variants of one entity must not differ in height unless you intend a
  connector to move when the variant flips.
- **No `<path>`.** WP 0.3's contract test asserts an entity's markup contains no `<path>` at all;
  compose from primitives. If a shape genuinely cannot be expressed, that is a **new primitive**,
  not a path.
- **`pnpm lint` does not check formatting** (`biome check --formatter-enabled=false`). Running
  `pnpm format` will reformat files this WP does not own — WP 0.3 did that and it was noise. Don't.

## Out of scope (explicitly)

The tier-2 and tier-3 casts (WP 1.2 / 1.3), the scaffold script and checklist (WP 1.4), anything in
`packages/shared` (the contract is closed — if an entity seems to need a schema change, that is a
finding to report, not an edit), the scene spec, and any gallery change beyond what the registry
gives for free. **The gallery must pick these up with no code change** — if it does not, say so;
that is a WP 1.4 defect discovered early, not something to patch here.

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, each command
   run with the worktree path pinned.
2. The seam: `cast-runtime.ts` populated, `cast-assets.ts` and `cast-orchestration.ts` committed and
   exported empty, `cast-pilot.ts` holding the three pilots, `registry.ts` deriving both exports from
   the concatenation, and duplicate ids failing a test.
3. All five entities render at S/M/L × five states with no color literal and no `<path>`.
4. Each has a co-located `*.test.tsx` calling `contract-support.tsx`, asserting **against its
   registry entry**, plus at least one assertion specific to that drawing.
5. `/illustrations` lists eight entities with **no change to `apps/web`** — reported as an
   observation, having actually loaded the page.
6. **Teeth, performed and reported:** break each of these, watch it go red, restore it —
   (a) give two cast members the same id; (b) put a `#hex` in one new entity; (c) declare a port in
   an entry that the drawing does not route through `EntityRoot`.
7. Live walk by the implementing agent, **both themes**, screenshot of each in the done-line. Note
   any entity that reads badly on the dark stage (WP 0.2 recorded a standing lighting flip there).

## Ledger

Tick in [`STATUS.md`](./STATUS.md) with the gate result, the seam's shape, deviations, and an
explicit **"Not verified:"** tail. **No front-page update is owed** — the capability table row
(which lives in **`CLAUDE.md` §1**, not `README.md`) already reads 🚧 Partially built and stays
accurate; update it only if this WP makes a sentence in it false.

## Note for the owner — an arithmetic discrepancy in the plan

`02-plan.md` lists 5 + 7 + 8 = **20** new entities across WPs 1.1–1.3. With the three pilots that is
a **23**-component catalog, so WP 1.4's "21st component proof" and `CLAUDE.md`'s "remaining ~17
entities" are both off. Nothing here depends on the number; it wants correcting before WP 1.4 is
written, and is left as an owner decision rather than a silent edit to a `status: final` document.
