---
type: "Work Package Spec"
title: "WP 1.3 - orchestration cast (suite, collection, orchestrator, diff-compare, environment, database, credentials-vault, assistant)"
description: "Phase 1 of 02-plan.md. Ledger: STATUS.md. The eight entities that represent how work is grouped, driven, compared and stored - including the honest 'automatic execution' entity."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T01:50:00Z"
status: "final"
---
# WP 1.3 — orchestration cast

Phase 1 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Cast source: [`00-research.md`](./00-research.md) §5 (tiers 2–3).

**Depends on:** WP 0.1, WP 0.2, WP 0.3, and **WP 1.1** (the cast-module seam).
**Runs in parallel with WP 1.2.** After the seam, the two share **no file**: this WP owns
`src/entities/cast-orchestration.ts` and its own eight entity files, nothing else.
**Consumed by:** WP 1.4, Phase 2.

---

## Locked decisions this WP implements

- **D-IL2 / D-IL5 / D-IL6 / D-IL7 / D-IL9 / D-IL12** — as WP 1.1; read that spec's §2 preamble for
  the pattern (`Skill.tsx` is the reference implementation) and its §4 for the traps. Unchanged
  here, not repeated.
- **D-IL17** — `assistant` has a face and therefore declares `facing`, default `upstream`. The other
  seven are faceless and ignore the prop.
- **D-IL1** — `orchestrator` is where the temptation to draw a *flowchart* is strongest. It is an
  entity, a solid on a platform, not a diagram of a process. The process is Phase 2's job.

## The eight entities (`src/entities/`)

| id | Drawing (research §5) | Variants | Named ports | Suggested `entity` binding |
| --- | --- | --- | --- | --- |
| `suite` | **Rack of run tracks** — parallel lengths of WP 1.1's `run` track segment, stacked in a frame | *(none)* | `dispatch`, `collect` | `suites` |
| `collection` | Drawer / binder — a pulled-out drawer with dividers on the top face | `local` / `git-bound` | `hold`, `sync` | `collections` |
| `orchestrator` | **Geared conveyor hub** — the honest "automatic execution" entity (research §5): a hub with a drive gear feeding several outputs. Covers the suite worker pool and auto-grade-on-completion. **The app has no cron scheduler, so it must not read as a clock or a calendar** | *(none)* | `queue-in`, `dispatch`, `report-out` | `suite_runs` |
| `diff-compare` | Split pedestal — one plinth cleanly divided, the two halves offset so the *comparison* is the shape | `two-way` / `baseline` | `left-in`, `right-in`, `delta-out` | *(omit)* |
| `environment` | Terrarium / stage plate — a bounded plate with a low rim, the enclosure that a run happens *inside* | *(none)* | `host`, `bind` | `scenarios` |
| `database` | The **SQLite crate** — a stout ribbed crate, not the cliché stacked-discs cylinder | *(none)* | `read`, `write` | *(omit)* |
| `credentials-vault` | Key vault — a sealed housing with a lock plate; **never a drawn key or keyhole detailed enough to look like real material** | *(none)* | `issue`, `revoke` | *(omit)* |
| `assistant` | Docked companion robot — WP 1.1's/WP 0.3's agent silhouette **in a dock**, which is what distinguishes it from a free-standing `agent` | `dock` / `hub` | `ask-in`, `answer-out` | `assistant_threads` |

Rules on that table:

- **`environment` is a container, and that is the whole point.** Like WP 1.2's `scan` arch, it must
  read correctly with another entity placed *in* it. Render `environment` with an `agent` standing
  on it and look before declaring it done.
- **`suite` should reuse WP 1.1's `run` track**, since a suite is literally many runs. If `run`'s
  track shape is not extractable as a primitive, that is a finding to report — not a reason to draw
  a second, subtly different track. Coordinate through the ledger, not by editing WP 1.1's files.
- **`assistant` vs `agent` must be distinguishable at `s`.** If the only difference is a detail
  that vanishes at the small footprint, the drawing is wrong. Verify at `s` specifically.
- **`credentials-vault` and `database` carry no domain text.** No "SQLite", no key glyph borrowed
  from an icon set — `lucide-react` is for UI chrome, never for illustration interiors.
- **Bind `entity` only to a table an operator would recognise as this thing; omit rather than
  stretch.** Note `environment` binds to **`scenarios`**: RM-27 renamed Scenario → Environment in
  **UI labels only** and deliberately froze the wire, so `scenarios` is the correct, non-obvious
  binding and the label is the rename.
- Every entity: S/M/L × all five states, `<title>`/`<desc>` from the entry, one accent moment,
  composed from primitives only (a `<path>` fails the contract test).

## The eight-entity risk — sameness

This is the largest cast in the phase and five of the eight are, structurally, "a box on a
platform". Guard against a catalog where half the entries read identically at a glance:

- Before writing the fifth one, render everything built so far in one row at `m`/`idle` and look. If
  two are hard to tell apart, change a **silhouette** (proportion, tier count, opening, orientation)
  — not a color, which D-IL5/D-IL6 will not give you anyway.
- Put that row's screenshot in the done-line. It is the cheapest possible evidence of the one thing
  that is hard to test.

## Out of scope (explicitly)

WP 1.1's and WP 1.2's casts, the scaffold (WP 1.4), anything in `packages/shared`, the scene spec,
any change to `apps/web`, and any edit to `src/registry.ts` or `src/entities/index.ts` (the seam
means you do not need one; if you think you do, stop and report it rather than creating a conflict
with WP 1.2).

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, each command
   run with the worktree path pinned.
2. Eight entities at S/M/L × five states, no color literal, no `<path>`.
3. Each has a co-located `*.test.tsx` calling `contract-support.tsx`, asserting **against its
   registry entry**, plus at least one drawing-specific assertion.
4. **Files touched are only:** the eight entity files + tests, `cast-orchestration.ts`, and any new
   file in `primitives/` (plus `primitives/index.ts`). `src/registry.ts` and
   `src/entities/index.ts` are **untouched** — state this explicitly in the report.
5. **Teeth, performed and reported:** break each, watch it go red, restore — (a) a `#hex` in one new
   entity; (b) a port declared in an entry but not routed through `EntityRoot`; (c) a duplicate id
   against WP 1.1's cast.
6. `environment` renders correctly with an `agent` standing on it, and `assistant` is
   distinguishable from `agent` at `s` — both **verified by looking**, screenshots in the done-line.
7. The whole-cast sameness row (above), screenshotted.
8. Live walk by the implementing agent at `/illustrations`, **both themes**, screenshot of each.

## Ledger

Tick in [`STATUS.md`](./STATUS.md) with the gate result, the reuse decisions (`run` track,
`agent` silhouette), deviations and an explicit **"Not verified:"** tail. No front-page update is
owed unless this WP makes a sentence in the **`CLAUDE.md` §1** capability table false.
