---
type: "Work Package Spec"
title: "WP 1.4 - contribution kit (scaffold, checklist, registry changelog and the version guard)"
description: "Phase 1 of 02-plan.md. Ledger: STATUS.md. Makes adding the 24th illustration a recipe rather than an act of imitation, and gives the REGISTRY_VERSION rule a test instead of a paragraph."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T13:20:00Z"
status: "final"
---
# WP 1.4 — contribution kit

Phase 1 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md) — **read the two dated amendments of 2026-08-21 first; this WP
exists to implement them.**

**Depends on:** WPs 1.1, 1.2, 1.3 (the catalog is **23** components and the cast-module seam is
closed — see the WP 1.3 tick and commit `a6af1f3`).
**Consumed by:** every future entity, and Phase 2's scene validator, which needs to trust that a
breaking entry change cannot ship silently.
**This is the last open box in Phase 1.** When it ticks, Phase 1 is complete.

---

## What the last three WPs proved you need

Three work packages added twenty entities by **reading a neighbour and copying its shape**. It
worked — but every one of them independently rediscovered the same handful of facts (attach
`illusLayer` + `entityHeightUnits` after the function; `resolveVariant` falls back rather than
throws; the census lives beside the cast module), and two of them independently found the same
structural leak. That is the cost this WP removes. It is not a nice-to-have: the catalog is now big
enough that "copy Skill.tsx" means copying whichever neighbour you happened to open.

## 1. `scripts/new-component.mjs` — the scaffold

`node packages/illustrations/scripts/new-component.mjs <Name> --cast <pilot|runtime|assets|orchestration> [--tier N]`
writes, in one transaction (all files or none):

- `src/entities/<Name>.tsx` — the full pattern with every required part present and marked `TODO`:
  the exported `*Meta` entry (id derived kebab-case from `<Name>`, the four cardinal ports, all five
  states, all three sizes, `since` set to the **current `REGISTRY_VERSION`**), the `*_VARIANTS`
  tuple + `resolveVariant` fallback, `*HeightUnits(size)`, the component rendering `<EntityRoot>`
  around `ConstructionGhost` + `IsoPlatform` and nothing else, then `illusLayer` and
  `entityHeightUnits` attached.
- `src/entities/<Name>.test.tsx` — calling `describeEntityContract` and nothing else, so the new
  component is under the D-IL12 checklist from its first commit.
- Appends the cast member to `src/entities/cast-<cast>.ts` **and** its id to
  `src/entities/cast-<cast>.test.ts` — the two files the seam says a new entity touches. It must
  **not** touch `src/registry.ts` or `src/entities/index.ts`; if it ever needs to, the seam has
  regressed and that is a finding.
- Appends a dated line to the registry changelog (§3).

The scaffold refuses, with a readable message, when: the id already exists in any cast module; the
cast name is not one of the four; `<Name>` is not PascalCase; or any target file would be
overwritten.

**No new dependency** (D-IL3). Plain Node, `node:fs`, string templates. It is a `.mjs` script beside
the existing ones and stays outside the package `tsconfig`, like `scripts/` already is — say so in
the done-line rather than quietly widening the tsconfig.

## 2. The checklist — `packages/illustrations/README.md`

The D-IL12 checklist as a document somebody can follow without reading three entities first:
footprint · ports · five states · both themes · accent budget · screen-aligned label ·
`<title>`/`<desc>` · co-located contract test. Write down the things Phase 1 learned the hard way,
each with the evidence:

- **`heightUnits` is load-bearing** — every port anchor measures against it, so two variants of one
  entity must not differ in height unless a connector is *meant* to move (the note at the top of
  `Skill.tsx`).
- **No `<path>`** — compose from primitives; a shape you cannot express is a new primitive, never an
  inline path.
- **A primitive that abstracts nothing is a finding** — WP 1.2 built the arch, found it was three
  `IsoHousing` calls with one caller, and published `scanClearance()` instead. Record that as the
  sanctioned outcome, not a failure.
- **Look at it.** Phase 1 changed five drawings *because somebody looked* — a token-meter pointer
  invisible at `s`, crate battens that did not read, a gear that read as a clock, comparison
  specimens too low at `m`. A green gate caught none of them.
- **The whole-cast row** — render everything at `m`/`idle` before declaring a new entity done; if it
  is hard to tell from a neighbour, change the **silhouette**, not the colour (D-IL5/D-IL6 will not
  give you a colour anyway).

## 3. The registry changelog + the version guard (the amendment, made real)

Per the dated amendment in [`decisions.md`](./decisions.md), **adding a component does not bump
`REGISTRY_VERSION`.** The growth record is a changelog, and the *number* moves only when an existing
entry's scene-visible contract breaks. Two deliverables:

**3a. `packages/illustrations/CHANGELOG.md`** — one section per registry version, one line per
entity added, seeded with the real history: `0.1.0` — the three pilots (WP 0.3), then the twenty of
WPs 1.1–1.3 grouped by cast. All 23 are `since: "0.1.0"`, which is correct and must not be
"fixed".

**3b. The guard, which is the point of this WP.** Today **nothing** would notice a breaking entry
change shipped without a bump — the rule is a doc comment. Make it a test:

- Check in `src/registry-contract.snapshot.json`: for every entry, only its **scene-visible**
  contract — `id`, sorted `ports` names, sorted `variants`, sorted `states`, sorted `sizes` — plus
  the `REGISTRY_VERSION` the snapshot was taken at. Deliberately **not** title/description/keywords/
  tier, which are cosmetic and would make the guard fire on non-events (the exact failure mode the
  amendment argues against).
- A test compares the live registry to the snapshot and classifies the diff:
  - **entry added** → fine, update the snapshot, no bump;
  - **entry's port/variant/state/size removed or renamed** → **fail** unless `REGISTRY_VERSION` is
    greater than the snapshot's;
  - **entry's port/variant/state/size added** → fine, no bump.
- The failure message must name the entity, the field and what disappeared, and say plainly that
  either the change is wrong or the version must move.

**Teeth are the acceptance here, not a nicety.** Prove it by breaking it three ways and reporting
the output: rename a port on an existing entity without bumping (must fail); do the same *with* a
bump (must pass); add a brand-new port to an existing entity without bumping (must pass — this is
the non-event the guard must stay quiet about).

## 4. The 24th component — the proof

Run the scaffold for one genuinely useful missing entity and ship it with **no hand-editing of the
scaffold's structural output** beyond drawing the thing. `owner/user` (research §5, tier 3) is the
obvious candidate — it reuses `IsoFigure`, so the drawing is small and the *scaffold* is what is
under test. Report exactly which files the scaffold wrote, which lines you changed by hand, and —
the actual claim — that the gallery listed **24** with no change to `apps/web` and no edit to
`registry.ts` or `entities/index.ts`.

If the scaffold's output needed structural hand-editing to pass the gate, **the scaffold is wrong**;
fix it and re-run, rather than patching the generated file.

## Out of scope (explicitly)

The scene spec, layout engine or renderer (Phase 2); explain mode; persistence; assistant tools; any
25th entity; any change to `packages/shared` (the version constant stays `0.1.0` — the amendment is
that it should NOT move); any change to `apps/web`.

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, path pinned on
   every command. Baselines: shared **250** · illustrations **794** · cli **87** · api **3601** ·
   web **349 files / 3752 passed / 5 skipped** · lint clean **1734** files. Only illustrations should
   move. **Known trap:** in a fresh worktree run `pnpm install` and
   `pnpm --filter @mcp-token-footprint/shared build` first, or illustrations' tests die with
   `ERR_MODULE_NOT_FOUND … shared/dist/index.js`.
2. The scaffold writes a component + test + cast member + census entry + changelog line, refuses a
   duplicate id and a bad cast name, and touches neither `registry.ts` nor `entities/index.ts`.
3. `packages/illustrations/README.md` carries the checklist, including the five Phase 1 lessons.
4. `CHANGELOG.md` seeded with the real 23-entity history under `0.1.0`.
5. The version guard exists and is **proven by all three breaks above**, with the exact output in
   the report.
6. The 24th component exists, was scaffolded not copied, and the gallery lists 24 with **no**
   `apps/web` change — verified by loading the page, not by inference.
7. Live walk at `/illustrations`, **both themes**, screenshots of each; the new entity sits in the
   whole-cast row without reading as a duplicate of a neighbour.

## Ledger + front page

Tick in [`STATUS.md`](./STATUS.md) with the gate result, the three guard breaks, deviations and an
explicit **"Not verified:"** tail. **This tick closes Phase 1**, so the same commit updates the
capability table in **`CLAUDE.md` §1** (the count moves 23 → 24 and the scaffold stops being "not
built") and adds a `CHANGELOG.md` entry at the repository root — each claim verified against the
running app or a passing test, never against this spec.
