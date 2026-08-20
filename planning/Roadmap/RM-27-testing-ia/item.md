---
type: "Roadmap Item"
title: "Testing IA consolidation — Collections as the test home"
description: "Consolidate the Testing information architecture: Collections become the home for tests, one run engine serves suite, collection and ad-hoc plans, the runs feed unifies with compare folded in, and the navigation drops from seven items to four."
tags: ["roadmap", "RM-27"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Testing IA consolidation — Collections as the test home

## Goal

Consolidate the Testing information architecture: Collections become the home for tests, one run engine serves suite, collection and ad-hoc plans, the runs feed unifies with compare folded in, and the navigation drops from seven items to four.

## Why it matters

The Testing area had grown seven navigation entries and three ways to start a run, none of which agreed with the others.

## Milestones

- [ ] Phase 1 — Collections as the home.
- [ ] Phase 2 — one run engine and membership.
- [ ] Phase 3 — the unified runs feed.
- [ ] Phase 4 — the launcher, the rename and the navigation.

## Linked research

- [RS-11](/Research/RS-11-testing-ui-concept/topic.md)

## Plan overview (from the original plan README)

> ## ✅ SHIPPED — 2026-07-05 (code complete; owner-acceptance walk pending)
> All 11 WPs (1.1–4.2, incl. the inserted **2.3** membership WP) are built and merged to **local
> `main` only** (not pushed to origin), gate green after every merge (697 API tests, migration
> **v16**). The tables below are the delivered design; per-WP done-lines + the mid-flight structural
> corrections are in [`STATUS.md`](./STATUS.md) (authoritative). The live-app owner-acceptance walk
> (both themes / a11y / redirects / click-through) is **not done** — no provider key; tracked in the
> ledger's Owner-acceptance section.

Decision record: [`../testing/ia-restructure-handover.md`](/Roadmap/RM-26-testing/ia-restructure-handover.md)
(owner Q1–Q3 + PM Q4a–Q4d + owner addendum, all 2026-07-04). Living state:
[`STATUS.md`](./STATUS.md) (driven by `/next-wp testing-ia`). Shared rules:
[`conventions.md`](./conventions.md) (thin — mostly points at
[`../testing/conventions.md`](/Roadmap/RM-26-testing/conventions.md)).

## What we're building

1. **Collections become the test home** (Q1/Q2): every test lives in a collection; a default,
   undeletable **"Local"** collection absorbs loose tests/suites; the git binding becomes
   **optional** (a local collection can bind a repo later; git-sync unchanged once bound).
2. **One execution concept** (Q3 + owner addendum): every multi-test execution is a **suite-run
   over a plan** (tests × environments × repetitions). A **Suite is the saved, repeatable plan**;
   an **interactive session is an unsaved plan**; **"Save as suite"** bridges them; **"run a
   collection"** is a plan built from the collection's tests. No second engine — everything goes
   through `apps/api/src/suites/orchestrator.ts`.
3. **Runs = one results surface**: the feed shows single runs AND suite runs (summary row →
   member list → drill into the per-session console, which already exists at
   `/testing/suite-runs/:suiteRunId`); **Compare runs folds in** as a tab/mode of Runs.
4. **Nav 7 → 4** (Q4b): Collections · Runs · Compatibility + a "Setup" group holding
   **Environments** (Scenario renamed in **UI labels only** — wire/DB keep `scenario`). Every
   removed route redirects (Q4c); deep-linked consoles never break.
5. **Run launcher** (Q4d): one "Run" entry, two paths — run a suite (automated) or an
   interactive session (pick-or-create tests + environments inline).

## Decisions

**Locked (PM, 2026-07-04):**

- **D-T1** — Q4 = (A) extended: Scenario/Suite data models untouched; Scenario→Environment is a
  UI-label rename only (additive-wire rule; ~20–30 label sites; "Environment" is collision-free).
- **D-T2** — Nav end-state per Q4b + redirect table per Q4c (see WP 3.0).
- **D-T3** — One execution engine: inline plans (adhoc/collection) run as suite-runs through the
  existing orchestrator; "Save as suite" reuses existing suites CRUD.

**To lock at kickoff (owner):**

- **D-T4** — Local collection semantics. Recommendation: reserved name "Local", `is_default`
  flag, undeletable, cannot bind a repo; deleting any other collection reassigns members to Local
  (today's FK is `ON DELETE SET NULL` — app-level reassign keeps the "every test has a
  collection" invariant).
- **D-T5** — Ad-hoc plan persistence. Recommendation: snapshot the plan on the `suite_runs` row
  (`source: 'suite'|'collection'|'adhoc'` + plan JSON; `suite_id` becomes nullable) and create
  **no** Suite row for ad-hoc runs — Suites stay purely user-authored. Fold into WP 1.2's
  migration if accepted.
- **D-T6** — Migration number: claim the next free `user_version` at kickoff via the
  cross-workstream decision-log convention (Benchmarks holds v13–v15; check sibling ledgers).
- **D-T7** — Owner re-validates Suites nav placement (launcher-first + collection tab, no
  top-level item) — PM interpretation of the addendum.

## WP index

### Phase 1 — Contract & data foundations
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Shared contract: optional repo binding, `isDefault`, inline run-plan types/zod (additive) | — | M |
| 1.2 | Migration vNEXT: nullable repo columns, seed Local, backfill members, D-T5 columns | — | M |

### Phase 2 — API
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Collections git-decouple: local CRUD, bind-later, unbound sync → 400, Local guarantees | 1.1, 1.2 | M |
| 2.2 | Inline-plan suite runs: one endpoint for suite/collection/adhoc plans → orchestrator | 1.1, 1.2 | L |

### Phase 3 — Web IA
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.0 | IA shell: nav 7→4 + Setup group, route moves + redirects (solo owner of App.tsx/AppShell.tsx) | — | M |
| 3.1 | Collections as the test home: detail tabs (Tests · Suites · Git), Local pinned, bind-repo UI | 3.0, 2.1 | L |
| 3.2 | Unified Runs surface: single + suite runs feed (summary → members → drill), Compare as tab | 3.0, 2.2 | L |
| 3.3 | Run launcher: run-a-suite · interactive session · run-a-collection · Save as suite | 2.2, 3.1, 3.2 | L |
| 3.4 | Environments rename sweep (UI labels only; solo — cross-cutting) | 3.1, 3.2, 3.3 | M |

### Phase 4 — Verification & docs
| WP | Title | Depends on | Size |
|---|---|---|---|
| 4.1 | E2E + upgrade proofs: migration fixture, offline git-sync still green, inline-plan E2E | 2.1, 2.2 | M |
| 4.2 | Docs close-out: CLAUDE.md capability row, owner-acceptance walk (themes/a11y/redirects) | all | S |

## Parallel execution map (for `/next-wp testing-ia`, max 4 agents)

WPs declare **Files** so the orchestrator can verify overlap; never co-run two WPs listed with
the same file. Recommended batches:

| Batch | Run in parallel | Why safe |
|---|---|---|
| 1 | **1.1 ∥ 1.2** | `packages/shared` vs `apps/api/src/db` — disjoint |
| 2 | **2.1 ∥ 2.2 ∥ 3.0** | `apps/api/src/collections/*` vs `apps/api/src/suites/* + index.ts` vs `apps/web` shell — disjoint |
| 3 | **3.1 ∥ 3.2 ∥ 4.1** | collections feature vs runs feature (feature-local api files) vs `apps/api/test` — disjoint |
| 4 | **3.3** (solo) | integrates into 3.1 + 3.2 surfaces |
| 5 | **3.4** (solo) | mechanical cross-cutting label sweep — renames last so it sweeps 3.3's UI too |
| 6 | **4.2** (solo) | close-out after everything is verified |

## Invariants

- **Additive wire changes only** — `scenario` naming stays in routes/types/DB; no `/api/v2`.
- **One execution engine** — no mass-run path outside the suite orchestrator.
- **Every removed route redirects**; `/testing/runs/:runId`, `/testing/suite-runs/:suiteRunId`,
  `/testing/suites/:suiteId` never break.
- **Git-sync trust model intact** — PAT write-only/encrypted, SSRF guards, no force-push;
  unbound collections get an honest 400, not a silent no-op.
- **brand-ui only, semantic tokens, both themes** (`light`, `dark`) — per repo rules.

## Definition of done (every WP)

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root + the WP's
Acceptance; ledger discipline per [`STATUS.md`](./STATUS.md).
