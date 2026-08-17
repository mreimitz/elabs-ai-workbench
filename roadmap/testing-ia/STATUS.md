# Testing IA consolidation — work-package status ledger · **PRIORITY: HIGH**

Living state for the **testing-ia** plan, read and updated by `/next-wp testing-ia`. A box is
ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines record date + branch: `… — done <YYYY-MM-DD> ·
wp/testing-ia/<id>`.

> ## ✅ COMPLETE — 2026-07-05 (code); owner-acceptance walk pending
> All **11 WPs** (1.1 · 1.2 · 2.1 · 2.2 · **2.3 inserted** · 3.0 · 3.1 · 3.2 · 3.3 · 3.4 · 4.1 · 4.2)
> are built and merged to **local `main` only (NOT pushed to origin)**. Full gate green after every
> merge — final: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green, **697 API tests**.
> Migration **v16** (D-T6). Executed in 6 batches via worktree sub-agents; merges rebased/validated
> one at a time; two mid-flight structural corrections (serialize 2.1→2.2; insert 2.3 for the missing
> membership contract) + one App.tsx-ownership refinement are in the Decision log.
> **Owner-acceptance (the live two-theme / a11y / redirect / click-through walk) is NOT done** — I have
> no provider key and did not run the app live; it stays unchecked in the Owner-acceptance section
> below. Origin push + a PR are owner-gated (not done).

> Plan + decisions in [`README.md`](./README.md); decision record in
> [`../testing/ia-restructure-handover.md`](../testing/ia-restructure-handover.md). **Execute in
> parallel:** follow the batch map in README §Parallel execution map (batch 1: 1.1 ∥ 1.2 ·
> batch 2: 2.1 ∥ 2.2 ∥ 3.0 · batch 3: 3.1 ∥ 3.2 ∥ 4.1 · then 3.3 → 3.4 → 4.2 solo) — one
> worktree sub-agent per WP, never two agents on the same file. **Kickoff (owner):** lock
> D-T4–D-T7 in the decision log below and claim the migration `user_version` (D-T6; Benchmarks
> holds v13–v15 — check sibling ledgers for later claims).

## Phase 1 — Contract & data foundations
- [x] WP 1.1 — shared contract: optional repo binding, `isDefault`, inline run-plan types/zod — done 2026-07-05 · wp/testing-ia/1.1
- [x] WP 1.2 — migration vNEXT: nullable repo columns, Local seed, member backfill (+ D-T5 columns) — done 2026-07-05 · wp/testing-ia/1.2 (v16)

## Phase 2 — API
- [x] WP 2.1 — collections git-decouple: local CRUD, bind-later, unbound sync → 400, Local guarantees — done 2026-07-05 · wp/testing-ia/2.1 _(also widened `Collection`/`CollectionRow` nullable + `REPO_NOT_BOUND` guard + `httpError` code; 9 new tests; reserved-name enforced after 1 refine)_
- [x] WP 2.2 — inline-plan suite runs: one endpoint (suite · collection · adhoc) → orchestrator — done 2026-07-05 · wp/testing-ia/2.2 _(POST /api/run-plans; `startPlanRun` single engine, `startSuiteRun` delegates; SuiteRun.suiteId→optional + 2 minimal web `?? ""` guards; 8 new tests)_
- [x] WP 2.3 — **collection membership write+read** (orchestrator-inserted): additive `collectionId` on `testInputSchema`+`suiteInputSchema` (create→Local default · update=move · absent-on-update preserves) AND surfaced on hydrated `Test`/`Suite` (read side, the piece 3.1 filters on); on-disk git file shapes unchanged — done 2026-07-05 · wp/testing-ia/2.3 _(9 tests; 1 refine for read-side)_

## Phase 3 — Web IA
- [x] WP 3.0 — IA shell: nav 7→4 + Setup group, route moves + redirects — done 2026-07-05 · wp/testing-ia/3.0 _(live-app redirect/theme walk = owner WP 4.2)_
- [x] WP 3.1 — collections as the test home: tabs (Tests · Suites · Git), Local pinned, bind-repo UI — done 2026-07-05 · wp/testing-ia/3.1 _(TestsView→collections/CollectionTests + TestEditor re-homed; CollectionDetail Tabs Tests·Suites·Git; Local pinned/undeletable; App.tsx edit = only the dead TestsView import; SuitesView untouched (client-side filter); live/theme walk = owner WP 4.2)_
- [x] WP 3.2 — unified Runs surface: single + suite runs feed (summary → members → drill), Compare tab — done 2026-07-05 · wp/testing-ia/3.2 _(RunsView/CompareRunsView edited IN PLACE, no App.tsx/lib-api edit; new `runs/` feed folder + `runs-api.ts` + 5 web tests; live SSE/theme walk = owner WP 4.2)_
- [x] WP 3.3 — run launcher: run-a-suite · interactive session · run-a-collection · Save as suite — done 2026-07-05 · wp/testing-ia/3.3 _(RunLauncher two-path dialog + 4 entry points; 1×1→lightweight `/testing/runs/new`, ≥2→`/api/run-plans`; source collection when selection==full set else adhoc; Save-as-suite lands in entry collection; consolidated 3.2's inline NewRunCard into the launcher; live/theme walk = owner WP 4.2)_
- [x] WP 3.4 — Environments rename sweep (UI labels only) — done 2026-07-05 · wp/testing-ia/3.4 _(22 files; ScenariosView→EnvironmentsView + ScenarioEditor→EnvironmentEditor renames; all visible "Scenario(s)"→"Environment(s)"; wire frozen — `scenarioId`/`Scenario` type/`/api/scenarios`/`/testing/scenarios` redirect + column/chart data keys all kept; residual `grep` = identifiers only; live two-theme read = owner WP 4.2)_

## Phase 4 — Verification & docs
- [x] WP 4.1 — E2E + upgrade proofs: migration fixture, offline git-sync green, plan equivalence — done 2026-07-05 · wp/testing-ia/4.1 _(2 new E2E files: comprehensive pre-v16→v16 upgrade + data preservation, local-collection lifecycle + file:// bind, source suite≡adhoc plan equivalence; defensive explicit-membership seeding; tests-only)_
- [x] WP 4.2 — docs close-out: CLAUDE.md row, ledger, owner-acceptance walk — done 2026-07-05 (orchestrator; docs-only close-out on `main`) _(CLAUDE.md capability row → ✅ Built with owner-acceptance explicitly pending; this ledger finalized; handover pointer freshened. The owner-acceptance walk below is UNCHECKED — not run live)_

## Decision log
_Entries: date · decision · rationale._

- 2026-07-04 · **D-T1 locked (PM):** Q4 = (A) extended — data models untouched;
  Scenario→Environment is a UI-label rename only. Rationale: preserves suite-matrix/single-run
  reuse; wire rename would be breaking (additive-only rule).
- 2026-07-04 · **D-T2 locked (PM):** nav end-state Collections · Runs · Compatibility + Setup ›
  Environments; all removed routes redirect; consoles never break.
- 2026-07-04 · **D-T3 locked (PM, per owner addendum):** one execution engine — suite ·
  collection · adhoc are plans run as suite-runs via the existing orchestrator; "Save as suite"
  bridges interactive → repeatable.
- 2026-07-05 · **D-T4 locked (owner, kickoff):** Local collection = reserved name `"Local"`,
  `is_default` flag, **undeletable**, **never repo-bound**; deleting any other collection
  **reassigns** its tests/suites to Local (app-level, transactional — today's FK is
  `ON DELETE SET NULL`, so the reassign is explicit). No test/suite may end up collection-less.
- 2026-07-05 · **D-T5 locked (owner, kickoff):** ad-hoc/collection plan persistence = snapshot
  the plan on the `suite_runs` row (`source: 'suite'|'collection'|'adhoc'` + plan JSON;
  `suite_id` becomes **nullable**). **No** auto-created Suite rows for ad-hoc/collection runs —
  Suites stay purely user-authored. Folded into WP 1.2's single migration.
- 2026-07-05 · **D-T6 locked (owner, kickoff):** migration `user_version = 16`. Verified:
  `LATEST_SCHEMA_VERSION` derives from the last `MIGRATIONS` entry = **15** (Benchmarks reserved
  v13–v15, left "v16+" free); no sibling `roadmap/*/STATUS.md` decision log claims v16. WP 1.2
  appends the `version: 16` migration.
- 2026-07-05 · **D-T7 locked (owner, kickoff):** Suites nav = launcher-first + a Suites tab on
  the collection; **no top-level Suites nav item.** Owner re-validates placement at final
  acceptance (WP 4.2 walk).
- 2026-07-05 · **WP 1.1 accepted deviations (validated OK):** (a) the READ-side `Collection`
  repo fields stay non-null `string` for now — widening them to nullable breaks 24 non-null
  consumer sites in `apps/api/src/collections/git-sync.ts`, which a shared-only WP can't touch
  without redding the gate. Deferred to **WP 2.1** (which owns `collections/*` + adds the
  `REPO_NOT_BOUND` null-guard). (b) `isDefault?` is optional (a required field breaks the API
  redactor before the `is_default` column exists). Both additive-safe; the write-side
  (`CollectionInput` + `collectionInputSchema` optional group) fully supports unbound collections.
- 2026-07-05 · **WP 1.2 note:** `database.ts` hard-codes `LOCAL_COLLECTION_NAME = "Local"` with a
  TODO (couldn't import the unbuilt sibling 1.1 branch). Now that 1.1 is merged, **WP 2.1**
  reconciles it to the shared `DEFAULT_COLLECTION_NAME`. Also: `applyMigrations` now toggles
  `foreign_keys` OFF/ON + runs `foreign_key_check` for ANY migrating DB (required for the v16
  parent-table rebuild to preserve membership) — covered by the full 667-test gate.
- 2026-07-05 · **Batch-map amendment (orchestrator) — REAL file coupling found:** WP 2.1 and WP
  2.2 each perform an **atomic cross-layer nullability change** that BOTH touch
  `packages/shared/src/types.ts` (2.1: `Collection` repo fields → nullable; 2.2: `SuiteRun.suiteId`
  → optional) AND `apps/api/src/db/rows.ts` (2.1: `CollectionRow`; 2.2: `SuiteRunRow` source/
  plan_json/nullable suite_id). The README batch-2 map ("2.1 ∥ 2.2 ∥ 3.0 — disjoint") under-specified
  these two shared files. Resolution: **serialize 2.1 → 2.2** (no two agents on the same file), run
  **3.0 in parallel with 2.1** (web shell — disjoint). 2.1's scope is amended to own the `Collection`/
  `CollectionRow` widening + git-sync `REPO_NOT_BOUND` guard; 2.2's to own `SuiteRun`/`SuiteRunRow`.
- 2026-07-05 · **Inserted WP 2.3 (orchestrator) — missing membership-write contract:** discovered
  at batch-3 prep that `Test.collectionId` exists on the type but is `Omit`-ted from
  `TestInput`/`SuiteInput` — the ONLY way a test/suite gets a `collection_id` today is git-sync
  import; there is NO interactive create-in / move-between-collection write path. WP 3.1
  ("create/edit/move between collections") and WP 3.3 ("Save as suite → lands in the collection")
  both depend on it. Fix = a small additive API WP: `collectionId?` on `testInputSchema` +
  `suiteInputSchema`; the create/update services persist it (absent-on-create → resolve to Local's
  id so nothing is ever collection-less; an update with a new id is the "move"); the on-disk git
  file schemas are UNCHANGED (membership stays local identity, per the benchmarks design). Sits in
  Phase 2 (contract-first, before the web WPs); disjoint from 3.2 (web) + 4.1 (api-tests), so it
  co-runs with them; **WP 3.1 is gated on 2.3.**
- 2026-07-05 · **Batch-3 map refinement (orchestrator) — hidden `App.tsx` coupling:** the README
  claims 3.1 ∥ 3.2 ∥ 4.1 are file-disjoint, but `apps/web/src/App.tsx` still imports `TestsView`
  (dead after 3.0's redirect) and imports+renders `RunsView`/`CompareRunsView`. **Physically
  moving** those files (as the 3.1/3.2 specs suggest) would force `App.tsx` import-path edits in
  BOTH WPs → a collision + a breach of the "only WP 3.0 edits App.tsx" rule. Resolution to keep
  3-way parallelism: **WP 3.1 is the sole batch-3 editor of `App.tsx`** (only to delete the dead
  `TestsView` import when it re-homes that view under `collections/`); **WP 3.2 owns
  `RunsView`/`CompareRunsView`/`compare-*` IN PLACE (no physical move) and makes ZERO `App.tsx`
  edits** (new suite-run-feed components go in `features/testing/runs/`). 3.1 owns
  `apps/web/src/lib/api.ts`; 3.2 uses a feature-local `runs-api.ts`; 4.1 is `apps/api/test/` only —
  all disjoint.
- 2026-07-05 · **Deviation logged (orchestrator):** `roadmap/testing/conventions.md` §"Web
  conventions" still says *"No router. View switch is `activeView: ViewKey`"* — this is **stale**.
  The app uses **`react-router-dom` v7** (`apps/web/src/App.tsx` imports `Navigate, Route,
  Routes`; deep-linkable routes + `Navigate replace` redirects). The phase-3 WP specs correctly
  assume the router; web agents are briefed to follow the phase-3 specs + real `App.tsx`, **not**
  the stale `activeView` line. (Docs fix deferred to WP 4.2 or an owner doc pass — not in scope
  for a code WP.)

## Acceptance follow-ups
- [x] **Suite management gap (D-T7 re-validated by owner 2026-07-05):** the collection "Suites" tab
  (WP 3.1) shipped **read-only** (Run + Open only) — no create/edit/delete — so with no top-level
  Suites nav there was NO way to manage suites (owner found it via the launcher's "No suites yet"
  empty state). Owner chose **collection-tab manager** (not a top-level Suites nav — D-T7 upheld).
  Fixed 2026-07-05 · `fix/testing-ia/collection-suites-manage`: `CollectionSuites` is now a full
  manager (New/Edit/Delete via `SuiteEditor` + `AlertDialog` confirm, new suites scoped to the
  collection; Run + Open retained). Gate green (697 tests). Live click-through = owner walk.
- [x] **Runs view = card chaos + "No member runs recorded" bug (owner 2026-07-05):** WP 3.2's feed
  was an unfilterable card list, and suite runs showed no members. Root cause: `toRunSummary` never
  emitted `suiteRunId`/`repetition`, so `/api/runs` couldn't nest members. Fixed 2026-07-05 ·
  `fix/testing-ia/runs-table`: (1) mapper now emits `suiteRunId`/`repetition` (members nest);
  (2) RunsView rebuilt as a **sortable / searchable / facet-filtered** table (composed from
  `@elabs-ai/components-ui Table*` — DataTable has no row-expansion — + `@elabs-ai/components-data` SearchInput/FacetFilter +
  `@elabs-ai/components-ui DateRangePicker` on the right) with **expandable suite rows** (KPI rail + member runs
  drilling to the run console), Group-by None/Type/Day, Compare-selected + live streaming retained.
  Gate green (727 tests on the combined tree w/ concurrent skill-ide). Live two-theme walk = owner.

## Owner acceptance (owner-only)
- [ ] Walk the running app (both themes): nav 4 + Setup; 4 redirects; collection-as-home flow;
      launcher path 1 (suite) + path 2 (interactive + Save as suite); run-a-collection; Runs
      feed summary → member list → drill into session; rename spot-check — accepted: ____
