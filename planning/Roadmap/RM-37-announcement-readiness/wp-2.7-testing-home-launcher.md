---
type: "Work Package Spec"
title: "WP 2.7 — Testing home and launcher: outcome-first collections, tests and suites; suite hero = results; launcher says what will load"
description: "Phase 2 of item.md. Ledger: STATUS.md. Collection, test and suite rows carry last outcome, pass rate and cost instead of git state and config; the suite detail hero becomes results with config demoted to a line; the Review promo section goes; the suite-run Runs table header and rows come from one column model; the launcher shows what a run will load, leads step 3 with the forecast, has one cost cap, hides limits under Advanced and explains its terms; the compare workspace loses its 'Soon' tab."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.7 — Testing home and launcher: outcome-first collections, tests and suites; suite hero = results; launcher says what will load

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 1, 4, 6 and 8 apply here).

## Scope

`/testing/collections` and `/testing/collections/:collectionId`
(`apps/web/src/features/testing/collections/CollectionsView.tsx`, `CollectionDetail.tsx`,
`CollectionTests.tsx`, `CollectionSuites.tsx`, `CollectionGit.tsx`), `/testing/suites` and
`/testing/suites/:suiteId` (`testing/suites/SuitesView.tsx`, `SuiteDetail.tsx`, `SuiteKpiRail.tsx`), the
suite-run console's Runs tab at `/testing/suite-runs/:suiteRunId` (`suites/SuiteMembersTab.tsx`,
`TestGroupRow.tsx`, `FailureBuckets.tsx`), the run launcher (`/testing/runs/new`,
`testing/run-launcher/RunLauncher.tsx`) and the compare workspace's mode toggle (`/testing/runs/compare`,
`testing/compare/CompareBar.tsx`, `MetricsMode.tsx`, `compare-runs.ts`). Additive summary fields on the
collections, tests and suites endpoints are in scope. **Out of scope:** the runs feed and run console (WP
2.8), environments and credential health derivation (WP 2.9 — this WP consumes it), the Review nav entries and
rubric pages (WP 2.1), the first-run checklist and judge default (WP 1.3), the launcher's step-1 empty region
already scoped by RM-36
[`wp-2.2-consistency-density.md`](/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.2-consistency-density.md)
(P2-3), collection-detail tabs in the URL (WP 2.3 with server detail), the app-wide glossary (WP 3.2 — the
tooltip strings written here feed it), and the estimator's dollar floor itself
([`/Roadmap/RM-34-estimator-turn-model-calibrate/item.md`](/Roadmap/RM-34-estimator-turn-model-calibrate/item.md)).
**Continues** [`/Roadmap/RM-27-testing-ia/item.md`](/Roadmap/RM-27-testing-ia/item.md) and
[`/Roadmap/RM-26-testing/item.md`](/Roadmap/RM-26-testing/item.md).

## Target layout

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| **/testing/collections** 1. Toolbar | `ViewToolbar` | search · results "2 collections" · **+ New collection** (primary) | the "Review" promo section below the grid |
| 2. Cards (no grouping) | `EntityCard` | name · Local / Git chip; numbers "8 tests · 2 suites"; outcome "last run Jul 14 · 66.7 % pass · $3.16" (`BaseVerdictChip` when one applies); ⋯ (Run · Edit · Git · Delete) | "UNBOUND" group label; "not bound to a repository" as the card body; trash icon on the card face |
| **/testing/collections/:id** 3. Toolbar | `ViewToolbar` | search · results "8 tests" · + New test · **Run collection** (primary); tabs Tests · Suites · Git | — |
| 4. Tests table | `EntityTable`, 36 px rows | Name · Prompt (one line, 60 ch) · Last outcome · Pass rate (n runs) · Last run · Environments used · ⋯ (run · edit · delete) | Attachments "0" and Added profiles "none" columns (into the row's edit dialog); eight inline trash icons; the unlabeled sort control on the actions column |
| 5. Suites tab | `EntityTable` | Name · "2 tests × 1 environment" · Last outcome · Cost / run · Run (secondary) · Open → ⋯ | "· 1× reps · 3 parallel · no cap · 2 cells" config string; "cells" |
| 6. Git tab | `StatePanel` | for Local: the sentence only; for bound: sync state | the enabled "Bind to GitHub" button on Local |
| **/testing/suites/:id** 7. Hero | `KpiStat` ×4 | **Last run** (`BaseVerdictChip` + date) · **Pass rate** (sparkline, last 10 runs) · **Cost per run** · **Runs** | Repetitions · Parallel · Cost cap · Cells as hero numbers |
| 8. Config line | muted `Text` under the breadcrumb | "2 tests × 1 environment × 1 rep · 3 parallel · no cost cap · Edit" | the config card |
| 9. Members + runs | two compact lists; `EntityTable` 36 px | Tests / Environments; Recent runs: Started · Runs (n / n, "runs at launch" in the tooltip) · Outcome / pass · Cost · Duration · Open console | 32 px numerals per run row; "Grade —" on every row |
| 10. Header actions | `ViewToolbar` | **Run** (primary) · Edit · ⋯ (Delete) | Delete beside Run |
| **/testing/suite-runs/:id** 11. Runs tab | `RunsTableHead` + rows from **one** column list | the same `visible` column set drives header, `TestGroupRow` and member rows | the hand-rolled 9-cell row under a 13-column header |
| **Launcher** 12. Step 2 | two pickers sized to the step body | test = name + first line of its prompt; environment = name · servers as chips "<server> · 146 tools · 149k" · skills · model chip | fixed `h-64` boxes with room to spare |
| 13. Step 3 | sections in this order | (1) **What will load**: servers · tools allowed · skills · startup tokens; (2) **Forecast** (hero): "≈ 326k–1.04M tokens · up to $3.24 · from 51 past runs"; (3) one **Cost cap** with its scope note; (4) Repetitions; (5) **Advanced ▸** "Stops after 10 min idle · waits up to 10 min · no wall cap"; summary "1 test × 1 environment × 1 repetition = 1 run" | Stall timeout / Wait budget / Wall cap as hero `KpiStat`s above the estimate; the dollar floor; the second cap warning; the 51-word ⓘ |
| **/testing/runs/compare** 14. Mode toggle | `CompareBar` segmented control | Summary · Flow | the Metrics tab and its "Soon" badge |

Primary actions: **+ New collection**, **Run collection**, **Run** (suite), **Run** (launcher step 3, enabled
only when the summary line is valid).

## Actions

1. **Collections overview cards lead with outcome — P1.** WHAT: zones 1–2; default grouping `none`; delete the
   Review section. WHERE: `/testing/collections` · `CollectionsView.tsx:594-622` (`ReviewSection`),
   `collection-groups.ts`; `packages/shared/src/types.ts:1410` `Collection` gains an additive summary
   (`testCount`, `suiteCount`, `lastRun: {at, passRate, costUsd, outcome}`) from `GET /api/collections`.
   TARGET STATE: a card states tests · suites · last run · pass rate · cost; no "UNBOUND" heading; binding
   shows as a chip only when bound.
2. **Collection detail: tests and suites rows carry results — P1.** WHAT: zones 3–5. WHERE:
   `/testing/collections/:collectionId` · `CollectionTests.tsx:233-316` (columns), `CollectionSuites.tsx:305`;
   per-test and per-suite `lastRun` summaries from the tests/suites endpoints. TARGET STATE: every test row
   shows Last outcome, Pass rate (n) and Last run; every suite row shows Last outcome and Cost / run;
   Attachments and Added profiles are gone from the table; the actions column is not sortable.
3. **Suite detail hero = results; config demoted; Delete in ⋯ — P1.** WHAT: zones 7–10. WHERE:
   `/testing/suites/:suiteId` · `SuiteDetail.tsx:383-398` (hero `KpiStat`s Repetitions · Parallel · Cost cap ·
   Cells), `:341,395,456` ("cells"), `SuiteKpiRail.tsx:30-56`, `SuitesView.tsx:309,525`; a suite `runs`
   summary (last run, pass-rate series, mean cost) from `GET /api/suites/:id`. TARGET STATE: the first row of
   numbers is Last run · Pass rate · Cost per run · Runs; config is one muted line with Edit; Delete lives
   only in the ⋯ menu; the header "2 runs" and the per-run "10 / 10" carry the "at launch" tooltip.
4. **Suite-run Runs tab misalignment — P1.** WHAT: render `TestGroupRow` and member rows from the same
   `visible` column list the header uses (reuse `SessionColumnCells`). Root cause (QA-02): `TestGroupRow` is a
   hand-rolled fixed 9-cell row that does not gate on `visible`, while `RunsTableHead` renders the runs feed's
   column set (13 columns when the Sessions-lens columns are on) — the file's own comment at
   `SuiteMembersTab.tsx:12-20` names the hazard, and the feed's column preference leaks into this page
   (QA-16). WHERE: `/testing/suite-runs/:suiteRunId` Runs tab · `suites/SuiteMembersTab.tsx:12-20`,
   `suites/TestGroupRow.tsx`, `runs/SessionColumnCells.tsx`. Reproduced on suite runs `sPD1vAgi8QcT0uXieIoGg`
   and `q5CM4oDrL0r6YRKms4C-B`. TARGET STATE: header cell count == body cell count on every row, expanded or
   collapsed, pinned by a DOM test.
5. **Launcher step 2 says what will load — P1.** WHAT: zone 12. WHERE: `/testing/runs/new` step 2 ·
   `RunLauncher.tsx:744-866` (`ScrollArea` pickers at `h-64`), `:860` (environment row = name · credential ·
   model). TARGET STATE: each environment row lists its servers with tool count and startup tokens plus its
   skills; each test row shows the first line of its prompt; the pickers fill the step body.
6. **Launcher step 3 reordered: what loads → forecast → one cap → repetitions → Advanced — P1.** WHAT: zone
   13; the Forecast block renders the token band and "up to $X (upper bound)" with its basis line, no dollar
   floor; one Cost cap control with "applies to this run; the environment itself has no cap — set one there
   ▸", and the environment-cap warning is suppressed when a run cap is set; Effective limits collapse into one
   Advanced line; the summary pluralises. WHERE: `RunLauncher.tsx:897-1013` (Repetitions / Cost cap),
   `:1210-1231` (summary line), `:1307-1333` (Effective limits `KpiStat`s), `:1452-1467` (Estimated cost +
   59-word ⓘ). TARGET STATE: at 1440×900 the first thing above the fold in step 3 is "What will load", the
   second the forecast; no `KpiStat` named Stall timeout / Wait budget / Wall cap is visible without opening
   Advanced.
7. **Credential warning only when no run ever succeeded — P2.** WHAT: the "credential hasn't been verified"
   notice fires only for credentials with zero successful runs and no passed check. WHERE:
   `RunLauncher.tsx:1348-1384` (`unverifiedCount` from `getCredentialHealth`), consuming the server-side
   health WP 2.9 introduces. TARGET STATE: an environment with completed runs launches without the warning.
8. **Glossary tooltips on the launcher's terms — P2.** WHAT: one local `LAUNCHER_TERMS` map (suite, matrix,
   repetitions, cost cap, judge, variants, console, stall timeout, wait budget, wall cap, subscription
   concurrency) rendered as ⓘ tooltips ≤ 20 words where each term first appears; "judge" says where it is
   configured (Settings › Grading) or is dropped from step 1. WHERE: `RunLauncher.tsx` steps 1–3 copy,
   `:1320-1327`. TARGET STATE: no undefined term in the launcher; the map is the seed for WP 3.2's glossary.
9. **"cells" → "runs" on these surfaces — P2.** WHAT: say runs everywhere the suite tooltip already does ("2
   runs", "Runs 10 / 10", "1–5 runs per test × environment"). WHERE: `SuiteDetail.tsx:341,395,456`,
   `SuitesView.tsx:309,525`, `CollectionSuites.tsx:305`, `SuiteKpiRail.tsx:56`, `SuiteDeltas.tsx:208`,
   `SuiteScatter.tsx:142`, `RunLauncher.tsx:906,988`. TARGET STATE: the word "cell" appears only inside the
   suite editor's matrix explanation.
10. **Compare runs: Metrics mode removed until built; picker rows distinguishable — P1.** WHAT: drop Metrics
   from the segmented control and its "Soon" badge; `?mode=metrics` redirects to Summary; the Add-run picker
   rows carry start time and cost. WHERE: `/testing/runs/compare` · `compare/CompareBar.tsx:428-463`,
   `compare/MetricsMode.tsx`, `compare/compare-runs.ts` (`MODE_SOON`), the "+ Add run" popover at
   `compare/CompareBar.tsx:473-516`. TARGET STATE: no "Soon" or "coming soon" string renders anywhere under
   `/testing`; three runs of the same test on the same day are told apart in the picker.
11. **Suite-run "Analyze failures" disabled with a reason when nothing failed — P2.** WHERE:
   `/testing/suite-runs/:suiteRunId` Failure buckets · `suites/FailureBuckets.tsx:120,160`. TARGET STATE: at
   100 % pass the button is disabled with tooltip "No runs scored below 50 %".
12. **Git tab: no inert "Bind to GitHub" on Local — P3.** WHERE: `CollectionGit.tsx:39,147`. TARGET STATE: the
   Local collection's Git tab shows the sentence and no enabled button.

## Acceptance

- [ ] `/testing/collections` at 1440×900: each card shows test and suite counts and a last-run line; no group
      heading; no Review section below the grid.
- [ ] `/testing/collections/:id` Tests: columns are exactly Name · Prompt · Last outcome · Pass rate · Last
      run · Environments used · ⋯; the ⋯ header has no sort control. Suites: each row shows Last outcome and
      Cost / run; the string "cells" does not appear.
- [ ] `/testing/suites/:id`: the first row of numbers is Last run · Pass rate · Cost per run · Runs; Delete is
      only in ⋯; the config reads as one line.
- [ ] `/testing/suite-runs/:id` Runs tab on `sPD1vAgi8QcT0uXieIoGg`: every header cell sits over the matching
      value before and after expanding a test group; a DOM test asserts header cells == body cells per row.
- [ ] Launcher: step 2 environment rows name their servers, tool counts and startup tokens; step 3 shows What
      will load above the forecast, one cap control, and no hero limits; the summary reads "1 test × 1
      environment × 1 repetition = 1 run"; an environment with completed runs raises no credential warning.
- [ ] `/testing/runs/compare`: the mode toggle shows Summary · Flow; `?mode=metrics` lands on Summary; a grep
      for "Soon" / "coming soon" over non-test `.tsx` files under `apps/web/src` returns nothing.
- [ ] Both themes read correctly on every touched route.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** overall — actions 1–3 need additive summaries (M together); 4 is M (table model); 5–6 are M (launcher);
7–12 are S each.

## Sources

UX-24, UX-25 · EU-13, EU-15, EU-16, EU-30, EU-33 (launcher consequence; derivation in WP 2.9) · PO-13, PO-18
(promo cards; nav part in WP 2.1), PO-26 · PS-29 (Delete beside Run) · UXC-18, UXC-31 (Metrics mode), UXC-32
(launcher tooltips) · QA-02, QA-16 (column preference leak), QA-18 (suite-run part), QA-19, QA-32 (launcher
pluralisation), QA-38, QA-41 (collection tests table) · walkthrough `/testing/collections`, suite detail,
launcher and compare-workspace notes.
