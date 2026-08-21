---
type: "Work Package Spec"
title: "WP 1.2 - assets and knowledge cast (tool, resource, prompt-template, file, feedback-report, scan, token-meter)"
description: "Phase 1 of 02-plan.md. Ledger: STATUS.md. The seven entities that represent what the app measures and carries: a server's advertised surface, the artefacts around a run, and the accounting column."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T01:50:00Z"
status: "final"
---
# WP 1.2 — assets & knowledge cast

Phase 1 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Cast source: [`00-research.md`](./00-research.md) §5 (tier 2).

**Depends on:** WP 0.1, WP 0.2, WP 0.3, and **WP 1.1** — which lands the cast-module seam this WP
appends to. Starting before 1.1 means editing `src/registry.ts`, which WP 1.3 is also editing.
**Runs in parallel with WP 1.3.** After the seam, the two share **no file**: this WP owns
`src/entities/cast-assets.ts` and its own seven entity files, nothing else.
**Consumed by:** WP 1.4, Phase 2.

---

## Locked decisions this WP implements

- **D-IL2 / D-IL5 / D-IL6 / D-IL7 / D-IL9 / D-IL12** — as WP 1.1; read that spec's §2 preamble for
  the pattern (`Skill.tsx` is the reference implementation) and its §4 for the traps. They apply
  here unchanged and are not repeated.
- **D-IL16** — `scan` and `token-meter` are the two entities most likely to want a **`cutaway`**
  detail level. Declaring one is optional; declaring one and not implementing it is not — an entity
  without a cutaway must *ignore* the request, never error.

## The seven entities (`src/entities/`)

| id | Drawing (research §5, tier 2) | Variants | Named ports | Suggested `entity` binding |
| --- | --- | --- | --- | --- |
| `tool` | A small **socketed module** — the shape that plugs into `mcp-server`'s `bus` port. Reads as a part, not a machine | *(none)* | `plug`, `invoke-in`, `result-out` | `mcp_tool_scans` |
| `resource` | Labelled crate on the ground plane; a manifest card on the front face | *(none)* | `read-out` | `mcp_resource_scans` |
| `prompt-template` | A stencil/plate — the *form* a `prompt` is stamped from. Must be visibly **not** the same object as WP 1.1's `prompt` | *(none)* | `fill-in`, `emit` | `mcp_prompt_scans` |
| `file` | Sheet stack on a plinth | `single` / `stack` | `attach` | `test_attachments` |
| `feedback-report` | Document tray — a shallow open tray with sheets settled in it | *(none)* | `in`, `out` | `run_feedback` |
| `scan` | **Scanner arch** straddling the ground plane, so a server can stand under it | *(none)* | `subject-under`, `result-out` | `mcp_scans` |
| `token-meter` | Gauge/counter **column** — a vertical stack of segments with a read-off mark | `budget` / `spend` | `measure-in` | *(omit — accounting, not a table)* |

Rules on that table:

- **`scan` is an arch, and an arch is a hole.** It is the one drawing here that must read correctly
  with *another entity standing inside it* — Phase 2 will place `mcp-server` under it. Draw it so
  the opening is real at all three sizes; check by rendering `scan` and `mcp-server` in one `<svg>`
  and looking. If the arch cannot clear an `l` server, say so in the done-line: that is a footprint
  finding for the layout engine, not something to fudge by shrinking the server.
- **`tool` must plug into `mcp-server`.** Its `plug` port and `mcp-server`'s `bus` port are the same
  joint seen from two sides. They will be connected in Phase 2 — get the geometry honest now.
- **`token-meter` is the one entity whose whole job is a quantity**, and D-IL6 still applies: the
  read-off mark is the accent, the segments are ink. It must not become a chart —
  `@elabs-ai/components-charts` owns charts (D-IL1).
- **Bind `entity` only to a table an operator would recognise as this thing; omit rather than
  stretch.** Note `feedback-report`'s binding is a judgement call between `run_feedback`,
  `run_grades` and `suite_run_reports` — pick one, justify it in one line in the done-line, or omit.
- Every entity: S/M/L × all five states, `<title>`/`<desc>` from the entry, one accent moment,
  composed from primitives only (a `<path>` fails the contract test).

## The scale question — decide it and record it

Four of these seven (`tool`, `file`, `resource`, `prompt-template`) are things that *sit on or near*
a bigger machine. WP 0.3 established that S/M/L are quantized footprints (4×4 / 6×6 / 8×8), **not**
"small thing / big thing" — a `tool` at `l` is a large drawing of a small object, and that is
correct. Do not encode "a tool is smaller than a server" by clamping `tool` to `s`; that decision
belongs to the **scene** (Phase 2), which picks each node's size. If a scene needs a rule like "a
tool is drawn one tier below its host", record it as a Phase 2 finding — do not bake it into the
entity.

## New primitives

Two shapes here are plausibly reusable and therefore belong in `primitives/`, not inlined (D-IL12):

- the **arch** (`scan`), if anything else ever straddles the ground plane;
- the **sheet stack** (`file`, `feedback-report`, and already `skill`'s lamination).

`Skill.tsx` already laminates a slab by hand. If the sheet-stack primitive is real, **refactor
`Skill` onto it** and say so — otherwise there are two implementations of one idea and the second
one will drift. If after building it the shared shape turns out to be trivial, report that instead
of forcing an abstraction.

## Out of scope (explicitly)

WP 1.1's and WP 1.3's casts, the scaffold (WP 1.4), anything in `packages/shared`, the scene spec,
any change to `apps/web` (the gallery must pick these up for free — if it does not, that is a
finding to report), and any edit to `src/registry.ts` (the seam means you do not need one; if you
think you do, stop and report it rather than creating a conflict with WP 1.3).

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, each command
   run with the worktree path pinned.
2. Seven entities at S/M/L × five states, no color literal, no `<path>`.
3. Each has a co-located `*.test.tsx` calling `contract-support.tsx`, asserting **against its
   registry entry**, plus at least one drawing-specific assertion.
4. **Files touched are only:** the seven entity files + tests, `cast-assets.ts`, and any new file in
   `primitives/` (plus `primitives/index.ts` and `Skill.tsx` if the sheet-stack refactor happens).
   `src/registry.ts` and `src/entities/index.ts` are **untouched** — state this explicitly in the
   report; it is what makes the parallel run safe.
5. **Teeth, performed and reported:** break each, watch it go red, restore — (a) a `#hex` in one new
   entity; (b) a port declared in an entry but not routed through `EntityRoot`; (c) a duplicate id
   against WP 1.1's cast (proves the seam's uniqueness test bites across modules).
6. `scan` renders as a real arch with an `l` `mcp-server` under it — **verified by looking**, with
   the screenshot in the done-line.
7. Live walk by the implementing agent at `/illustrations`, **both themes**, screenshot of each.

## Ledger

Tick in [`STATUS.md`](./STATUS.md) with the gate result, the primitives decision, deviations and an
explicit **"Not verified:"** tail. No front-page update is owed unless this WP makes a sentence in
the **`CLAUDE.md` §1** capability table false.
