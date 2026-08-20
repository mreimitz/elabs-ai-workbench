---
type: "Work Package Spec"
title: "Testing section \u2014 Information-Architecture rethink \u00b7 HANDOVER for PM"
description: "Status: DECISION-COMPLETE (2026-07-04) \u2014 Q4 was settled by PM review the same day (see"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Testing section — Information-Architecture rethink · HANDOVER for PM

> Status: **DECISION-COMPLETE (2026-07-04)** — Q4 was settled by PM review the same day (see
> [PM decisions](#pm-decisions-2026-07-04--q4-settled) below). This doc is now the **decision
> record**; the executable implementation plan lives at [`../testing-ia/`](../RM-27-testing-ia/)
> (ledger: [`STATUS.md`](../RM-27-testing-ia/STATUS.md), driven by `/next-wp testing-ia` with parallel
> worktree sub-agents). **Update 2026-07-05: the testing-ia plan is now BUILT** — all 11 WPs merged
> to local `main`, gate green (697 API tests, migration v16); the live-app owner-acceptance walk is the
> only pending item (see the ledger's Owner-acceptance section). Everything referenced here is already
> built & merged on `main` (Testing + Benchmarks); this is a pure IA/UX rethink.

## Context (why this exists)
Reviewing the running app (`localhost:8080/testing/*`), the owner flagged that the **Testing
section's information architecture is muddy**: it exposes 7 top-level nav items — **Scenarios ·
Tests · Runs · Suites · Collections · Compare runs · Compatibility** — and several of these
concepts overlap in ways that aren't obvious to a user. The owner wants to **rethink how the
Testing section is structured** and will take the topic to a product manager. This document records
the owner's concerns, the decisions already made, the one question deferred to the PM, and enough
current-state context to make that discussion productive.

## Current model (as-is — what these entities actually are)
| Entity | Is | Key relationships |
| --- | --- | --- |
| **Scenario** | The *environment*: provider + model + params + system prompt + `allowedServers` (MCP servers/tools) + `allowedSkills` + guardrails + tool-loading mode | **Reused** by single runs and by every suite's matrix (`suite_scenarios`). *(Corrected 2026-07-04: the Compatibility feature consumes **runs/scans** — `POST /api/runs/:runId/compatibility` — not scenarios directly; `apps/web/src/features/compatibility/` has no `scenarioId` reference. Reuse via Compatibility is indirect, through runs.)* |
| **Test** | The *task*: `userPrompt` + `expectations` (insight/value/referenceLogic/answerable) + category/difficulty/tags + attachments | Optionally in **≤1 collection** (`tests.collection_id`, nullable) |
| **Run** | One execution = `test × scenario` (`{testId, scenarioId, mode}`) | Child of a suite run via `suite_run_id` (nullable) |
| **Suite** | A saved *run-plan*: ordered tests × scenarios × repetitions (+ ± skill variants, cost cap, quality×cost analytics) | Own `suite_tests` + `suite_scenarios`; optionally in a collection |
| **Collection** | A *git-backed sharing container* for tests + suites | **Requires a git repo today** (`repoUrl` is a required URL + branch + encrypted PAT); members via `collection_id` |

Two facts that constrain any restructure:
- **A Collection cannot exist without a git repo today** (`collectionInputSchema.repoUrl` is required).
- **A Scenario is reused across runs, suites, AND compatibility** — it is not 1:1 with a suite.

## The owner's concerns (verbatim intent)
1. The Testing section has too many separate, overlapping entities/nav items — feels
   un-consolidated ("seems like we haven't merged Tests, Runs, Suites, Collections").
2. **Tests should be organized in Test Collections**, not a flat list.
3. The old flat **"Tests" could simply be a collection**.
4. **Runs should be able to run an entire collection OR a specific test within a collection.**
5. **Suites are fine as a separate entity** (distinct from collections — keep them).
6. **Suites and Scenarios might be mergeable** — "don't see the value of having this separated."
   → **OPEN — deferred to the PM (Q4 below).**

## Decisions locked (owner-approved 2026-07-04)
- **Q1 — Collections replace the flat "Tests" nav.** Every test lives in a collection; a default
  **"Local"** collection holds loose/uncollected tests; the standalone Tests nav goes away.
- **Q2 — Decouple Collections from git.** A collection is a folder of tests/suites that can exist
  **purely locally**; "Bind to a git repo" becomes an optional action on it (git-sync stays exactly
  as built, just gated on a bound repo).
- **Q3 — "Run a collection" reuses the existing Suite mass-run engine.** Running a collection
  spins up a suite-run over that collection's tests → the matrix grid, KPI rail, cost cap, and
  analytics come for free; no parallel execution path. (A single-test run stays the lightweight
  `test × scenario` path.)

## Q4: Suites ↔ Scenarios — **DECIDED 2026-07-04: (A), extended ("A-plus", see PM decisions)**
The owner questioned the value of Scenarios and Suites being separate. Three framings; the owner
deferred the choice to the PM:

- **(A) Just de-clutter the nav** *(recommended)* — keep both data models (preserves "same test,
  N models" + Compatibility reuse of environments) but stop surfacing **Scenarios** as a top-level
  nav item; manage it inline where you launch a run/suite.
- **(B) Fold the environment into the suite** — no reusable Scenario entity; each suite/run
  re-specifies its own model + server + skills. Simpler mentally, but **loses cross-suite and
  Compatibility reuse** of environments (and would need Compatibility rethought).
- **(C) Unify Scenario + Suite as one "Benchmark" concept** — a single entity bundling environment
  + tests + run-plan. Biggest change; needs careful scoping.

**Recommendation: (A).** A Scenario is genuinely reused (single runs, suite matrix axis; via runs
also Compatibility); merging the data models would break that reuse. The pain the owner is reacting
to reads as **nav clutter**, best solved by IA consolidation, not a data-model merge. But this is a
product call — hence the handover.

## PM decisions (2026-07-04) — Q4 settled

Q4 = **(A), extended**: keep both data models, but go further than "hide the nav item" — the real
defect is that the nav mirrors DB tables instead of the user's workflow, mixes entities with views,
and one entity name actively misleads. Rationale for rejecting (B)/(C): (B) breaks the
"same test × N environments" suite matrix and environment reuse across single runs; (C) is a
data-model rewrite to solve a presentation problem. Suites and Scenarios only *feel* mergeable
because both are "pre-run setup" surfaced as sibling nav items; fixing the presentation dissolves
the itch. Locked decisions (numbering continues the owner's Q1–Q3):

- **Q4a — Rename Scenario → "Environment", UI labels only.** "Scenario" reads as a *task* and
  collides head-on with "Test" (visible in the run list, where the scenario name — e.g.
  "Banking Analyst – the vendor" — is the primary label and reads like a test name). API routes, shared
  type names, and DB tables keep `scenario` naming (versionless-API additive-only rule; a wire
  rename would be breaking). ~20–30 user-visible label sites in `apps/web/src`; the string
  "Environment" is collision-free in the testing UI (verified 2026-07-04).
- **Q4b — Testing nav collapses 7 items → 4, grouped by workflow.**
  **Collections** (the test home per Q1, with Run actions per Q3, and **Suites managed as a tab on
  a collection** — the Suite entity stays per owner concern #5 and is *elevated* as the repeatable
  execution host per the owner addendum below; it stops costing top-level nav because the **Run
  launcher** becomes its primary surface) · **Runs** (one results feed for single runs AND suite
  runs; **"Compare runs" folds in as a tab/mode** — it is a view over runs, not an entity;
  multi-select in the list → compare) · **Compatibility** (stays) · **Environments** (renamed
  Scenarios, under a "Setup" separator — kept visible rather than buried, because suite launch and
  single runs pick from it).
- **Q4c — Every removed route redirects.** `/testing/tests`, `/testing/compare`,
  `/testing/scenarios`, `/testing/suites` get `Navigate replace` redirects (pattern already in
  `apps/web/src/App.tsx`); deep links that must never break: `/testing/runs/:runId`,
  `/testing/suite-runs/:suiteRunId`, `/testing/suites/:suiteId`.
- **Q4d — "New run" launcher, two paths.** The deeper newcomer problem is *sequencing* (creds →
  environment → test → run before any value). One "Run" entry point with two paths (shaped by the
  owner addendum below): **(1) Run a suite** — pick a saved suite → automated, repeatable
  execution; **(2) Interactive session** — configure tests + environment(s) (pick-or-create
  inline) → run now, with a **"Save as suite"** bridge so a good ad-hoc configuration becomes
  repeatable. "Run a collection" (Q3) is path 1 with the plan built from the collection's tests.
- **Execution directive:** implement via `/next-wp testing-ia` — the plan is sliced so up to 4
  worktree sub-agents run **in parallel** wherever WPs touch disjoint files; see the parallel
  batch map in [`../testing-ia/README.md`](../RM-27-testing-ia/item.md).

## Owner addendum (2026-07-04, after the PM decisions) — Runs logic + results view

Owner input, recorded near-verbatim and folded into Q4b/Q4d above and the plan's WP specs:

1. **Suites host repeatable execution.** Today a new run only picks Test × Scenario. Putting the
   Suite "in the middle" — as the place where a specific configuration is set up — makes runs
   **repeatable executables**. Keep Suites; when running something, choose either **an entire
   suite, automated**, or **an interactive session** where tests/scenarios are configured ad hoc.
2. **The Runs result view must adopt multi-test suite runs**: a **summary**, a **list** of the
   member executions, and **drill into the individual session**.

PM synthesis (one execution concept, no parallel engines — Q3's spirit): *every multi-test
execution is a suite-run; a Suite is the saved plan; an interactive session is an unsaved plan;
"Save as suite" bridges the two; "run a collection" is a plan built from a collection's tests.*
The suite-run drill-down console already exists (`/testing/suite-runs/:suiteRunId`, Benchmarks
build) — the gap is the unified **Runs feed** (suite runs as summary rows → member list → per-
session drill) plus the launcher. Nav placement of Suites (launcher-first + collection tab, no
top-level item) is PM interpretation — **owner re-validates at kickoff (D-T7)**.

## Rough shape of the DECIDED work (Q1–Q3), for sizing only — do NOT build yet
Cross-cutting Testing + Benchmarks data-model + IA change, medium-large blast radius:
- **Schema/migration:** make `collections.repo_url`/`branch`/`pat` **nullable** (local collection);
  seed/guarantee a default **"Local"** collection; likely make `tests.collection_id` effectively
  always-set (default → Local). (`apps/api/src/db/schema.ts` + a new `user_version` migration —
  next free number after **v15**.)
- **API:** `collectionInputSchema` — `repoUrl` optional; git-sync routes (`/sync`,`/status`,
  `/resolve`) reject when no repo is bound (honest 400); a "run a collection" path that builds a
  suite-run from a collection's tests (reuse `apps/api/src/suites/orchestrator.ts`).
- **Web IA:** fold **Tests** into **Collections** (`apps/web/src/features/testing/collections/*`
  becomes the test home; `TestsView`/`TestEditor` re-parented under a collection); add "Run" on a
  collection and on a single test; consolidate the Testing nav in
  `apps/web/src/components/AppShell.tsx`. Scenarios' nav treatment depends on **Q4**.
- **Contract-first discipline** applies (types/zod in `packages/shared` → API → web).
- **Owner-gated flags:** any new runtime dep, `@elabs-ai/components-*` bump, weakening a hook/guardrail, or a
  breaking (non-additive) API change → STOP + ask. The git-decoupling touches the sync trust model
  — keep the PAT/SSRF/no-force-push discipline intact.

## Next steps
1. ~~PM decides Q4~~ — **done 2026-07-04** (see PM decisions above; Q1–Q3 re-validated unchanged).
2. ~~Turn this into a full implementation plan~~ — **done**: [`roadmap/testing-ia/`](../RM-27-testing-ia/)
   (README = plan + parallel batch map, phase files = WP specs with Files/Acceptance,
   [`STATUS.md`](../RM-27-testing-ia/STATUS.md) = authoritative ledger).
3. **Execute:** `/next-wp testing-ia` — parallel worktree sub-agents per batch, validate against
   each WP's Acceptance + the quality gate, tick the ledger. Owner locks D-T4–D-T6 at kickoff.

## Verification (when the decided work is eventually built)
- Migration brings an existing DB forward (git-bound collections keep working; a new default
  "Local" collection appears; loose tests land in it) — mirror `apps/api/test/migrations.test.ts`.
- A **local (no-repo) collection** can be created, hold tests, and be run; binding a repo later
  enables sync unchanged (the offline `file://` bare-repo E2E from the Benchmarks build still passes).
- "Run a collection" produces a suite-run with the matrix/KPIs (reuses the seeded-suite E2E path).
- Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
