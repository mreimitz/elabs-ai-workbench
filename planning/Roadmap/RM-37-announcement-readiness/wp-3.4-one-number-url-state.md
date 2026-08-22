---
type: "Work Package Spec"
title: "WP 3.4 — One definition per number, and URL state everywhere"
description: "Phase 3 of item.md. Ledger: STATUS.md. Gives every figure that has two definitions today (cache share, startup tokens, latest scan, tool-call count, first-measured, issue counts, session counts, mission status) one definition owned by one module in packages/shared, makes the numbers render where they are shown, and closes the URL-state gaps (server-detail tab and tool, collection tab, skill version, hub session and project, compare swap, scans filter, environment and compatibility selections, dashboard range) plus the group-by, forks and column-preference controls."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 3.4 — One definition per number, and URL state everywhere

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** nothing. Phase 2 relayouts (wp-2.2 dashboard, wp-2.3 servers, wp-2.8 run console, wp-2.10 assistant) place these numbers; this WP decides what each number *is* and where the code that computes it lives, so the relayouts consume one function instead of re-deriving. Paths are relative to the repo root (`…/` = `apps/web/src/features/`).

## Scope

Rule: a quantity is computed in exactly one exported function, in `packages/shared`, consumed by the API, the web and the CLI; a surface may drill into it but never recompute it. Second rule (D-TB10 in the app's own rules): any selection a user can make and would expect to survive a reload or a shared link lives in the URL. Out of scope: the engine-side fix that leaves `tool_call` steps "running" (wp-2.8 / ENG-12), the session-list status rows that are completed missions (wp-2.10 / QA-04), the dashboard range presets and Issues default scope (wp-2.2).

## Actions

### 1. [P1] Cache share

**WHAT — two definitions today:** the run rail shows `cacheHitRate` = cache reads ÷ input tokens (`packages/shared/src/token-usage.ts:43–50`; 80.6% on the review run); Analytics › Overview shows `cachedPercent` = (cache reads + cache writes) ÷ input (`…/testing/analytics-derive.ts:173–174`; 88.7%) — the 8.1-point gap is the cache-*write* share, a 1.25× premium presented as "cached". **SINGLE DEFINITION:** cache share = cache reads ÷ input tokens, `null` (rendered "—") when the provider reports a merged figure. **OWNER:** `packages/shared/src/token-usage.ts` — `cacheHitRate` (exists) plus a new `cacheShares(usage)` returning `{ read, written }` for the secondary line. **TARGET STATE:** `cachedPercent` is deleted; the Analytics tile reads `cacheHitRate` as its headline with "read 80.6% · written 8.1%" beneath; rail, Analytics, reports and compare agree on a fixture run (test in `packages/shared/src/token-usage.test.ts` + a web test rendering both surfaces from one fixture).

### 2. [P1] Startup tokens

**WHAT — two definitions today:** `/servers` and `/servers/:id` use `ScanSummary.totalTokens`, which is tools only (`packages/shared/src/types.ts:277`; `…/servers/ServersView.tsx:632`, `…/servers/ServersOverview.tsx:176–184`); the dashboard tile and chart use tools + resources + prompts (`…/dashboard/overview/tiles/StartupCostTile.tsx:138`); the scan detail calls the same sum "Total footprint" (`…/scans/ScansView.tsx:611`); the advisor says "definition tokens". One server reads 149,338 on `/servers` and 152,933 on the dashboard. **SINGLE DEFINITION:** Startup tokens = `totalTokens + totalResourceTokens + totalPromptTokens` of the server's latest successful scan; Tool tokens = `totalTokens`. **OWNER:** `packages/shared/src/scan-figures.ts` (new) — `startupTokens(scan)`, `toolTokens(scan)`. **TARGET STATE:** every "Startup tokens" label (servers, dashboard, scan detail, environment editor, advisor evidence, server report, CLI) calls `startupTokens`; a tools-only figure is labelled "Tool tokens" (labels: wp-3.1 action 13); a tooltip on each Startup-tokens KPI states the composition.

### 3. [P1] Latest scan

**WHAT — two rules today:** `apps/web/src/App.tsx:597–606` picks the newest scan of any status, so a server whose latest scan failed reads "—" on `/servers` (`ServersOverview.tsx:178–184`) while the dashboard picks the newest *successful* scan (`…/dashboard/overview/tiles/scan-tile-data.ts:129`) and shows 628 for the same server. **SINGLE DEFINITION:** every measurement (tokens, tools, posture, Δ) comes from the latest *successful* scan; the latest scan of any status feeds only the status chip and the "last scan" date. **OWNER:** `packages/shared/src/scan-figures.ts` — `latestMeasuredScan(scans, serverId)` and `latestScan(scans, serverId)`, plus `latestScansByServer(scans, { measured })`. **TARGET STATE:** `App.tsx`, `ServersOverview`, `ServersView`, the dashboard tiles and `…/testing/EnvironmentsView.tsx:74` read the same two selectors; a card shows "Scan failed · 3h ago" *and* the last measured number, never "—" for a server that has a successful scan.

### 4. [P1] Tool-call count

**WHAT — two counts today:** the rail shows "Tool calls 13" from the engine's statistics (`…/testing/KpiRail.tsx:149` ← `kpis.toolCalls`); Analytics › Tools sums its per-tool rows to 17 (`…/testing/analytics-derive.ts:388–427`) because the four provider-executed `tool_search_tool_regex` calls are counted in one place only. **SINGLE DEFINITION:** tool calls = every `tool_call` step, including provider-executed tool search; those rows carry a "Provider-executed" chip instead of a server. **OWNER:** `packages/shared/src/run-figures.ts` (new) — `countToolCalls(steps)`, used by the engine statistics (`apps/api/src/testing/`) and by `analytics-derive.ts`. **TARGET STATE:** rail = Σ table on every run; a unit test builds a run with provider-executed calls and asserts equality.

### 5. [P1] First-measured

**WHAT — two rules today:** `…/dashboard/overview/overview-derive.ts:246, 264` marks a server first-measured when its series has one measured point *inside the selected range* ("Includes 2 servers measured for the first time" on the Startup-tokens tile); `…/dashboard/overview/tiles/scan-tile-data.ts:116–121` marks it when the latest scan has no previous successful scan at all ("Includes 1 server…" on Fleet inventory). **SINGLE DEFINITION:** first-measured = the server's latest successful scan has no earlier successful scan under the same counting version (the delta-index rule; window-independent). **OWNER:** `packages/shared/src/scan-figures.ts` — `isFirstMeasured(scan, deltaIndex)`. **TARGET STATE:** both derivations call it; the dashboard shows one provenance line under the hero chart (placement: wp-2.2) and the two tiles drop theirs.

### 6. [P1] Issue counts

**WHAT — three pipelines today:** "Needs you 14" = failed scans + regressed + open issues + unscanned servers, unscoped (`…/dashboard/overview/overview-derive.ts:639`); the Issues tab badge 12 = open + regressed, unscoped (`…/issues-fleet/use-fleet-issues.ts:33–35`); the Issues table 0 = open issues whose last occurrence falls inside the page range (`…/issues-fleet/IssuesFleetTab.tsx:135–138`); the Needs-you links (`overview-derive.ts:625`) drop `range=` on top. **SINGLE DEFINITION:** open issues = lifecycle `open` or `regressed`, never range-scoped; the page range scopes *occurrences* ("12 open · 0 seen in window") as an explicit facet; "Needs you" is a breakdown ("1 failed scan · 12 open issues · 1 unscanned"), never a sum. **OWNER:** `packages/shared/src/issue-figures.ts` (new) — `countOpenIssues(issues)`, `selectAttentionItems({ issues, scans, servers })`, `seenInRange(issues, range)`. **TARGET STATE:** tile, badge, table and the API count read the same functions (badge 12 = tile 12 = table 12); the tab's default scope and layout are wp-2.2.

### 7. [P2] Session counts and one mission status

**WHAT — today:** `/assistant/agents?tab=usage` reads "Sessions 99" (`…/hub/workforce/usage/UsageKpis.tsx:33` ← `apps/api/src/hub/usage.ts:157`, which counts agent sub-sessions) while `/assistant/sessions` reads "38 sessions" (56 with archived); one mission shows four states on one screen — breadcrumb "Failed", card "Complete", rail "Completed · partial · 2 of 5 agents reported", notification "finished and synthesized its results". **SINGLE DEFINITION:** sessions = top-level sessions a user started; agent sub-sessions are a separate figure ("99 incl. 61 agent sessions"); mission status = one derivation from `HubMissionStatus` (`packages/shared/src/types.ts:5290`) plus the agent outcomes, yielding one of Completed / Ended partially ({n} of {m} agents reported) / Failed. **OWNER:** `packages/shared/src/hub-figures.ts` (new) — `sessionCounts(sessions)` and `deriveMissionView(mission, agents)`; the usage payload (`packages/shared/src/types.ts:7106`) gains `agentSessions`. **TARGET STATE:** the breadcrumb chip, mission card, rail and notification text all render `deriveMissionView`; the Usage KPI labels its count.

### 8. [P2] Numbers render where they are shown

- **WHERE:** `/servers/:id` Tools tab — `…/servers/ServersView.tsx:350–377, 795–823` put a three-column `DataTable` in a 32% `SplitPane` (`apps/web/src/lib/table.tsx:15–57` gives numeric columns no `size`/`minSize`), so "Tokens" clips to "4,79" on first paint and re-lays out with a `%` column after filtering. **TARGET STATE:** explicit `size`/`minSize` (≈ 80 / 56 px, `whitespace-nowrap`, `tabular-nums`) for tokens and share, the name column flexes, `startSize` 40; one column layout on first paint and after filtering; a jsdom test asserts the rendered cell text equals `formatNumber(totalTokens)`.
- **WHERE:** `/dashboard` hero chart (`…/dashboard/overview/tiles/HeroFootprintTile.tsx` imports `XAxis` only): seven lines, no y-axis, no end-of-line values. **TARGET STATE:** value labels at each line end (server · startup tokens) or a y-axis, so the per-server figure is readable where it is plotted; the ranked table stays the canonical answer (wp-2.2).

### 9. [P1] URL-state gaps

**WHAT:** every selection below moves into the URL through `useSearchParams`, mirroring `…/scans/ScansView.tsx:119–126` (`?tab=`) and the existing `?session=` reader in `…/hub/AssistantView.tsx:161–165`. **WHERE / TARGET STATE:**

| Route | Today (state only) | Parameter(s) to add |
|---|---|---|
| `/servers/:id` | `…/servers/ServersView.tsx:118` `useState("overview")`; selecting a tool chip on Overview jumps to Tools without touching the URL | `?tab=` (overview · limits · tools · resources · prompts · scans · issues · advisor) and `?tool=<toolId>` |
| `/testing/collections/:id` | `…/testing/collections/CollectionDetail.tsx:48` `useState<DetailTab>("tests")` | `?tab=` (tests · suites · git) |
| `/skills/:id` | `…/skills/SkillInspector.tsx:119` `useState<SkillVersion \| null>` (`useSearchParams` already imported at `:112`); reload or Exit-from-Studio snaps back to Latest | `?version=<versionId>` (absent = latest) |
| `/assistant` | breadcrumb switcher `…/hub/AssistantView.tsx:304–308` sets state only, although `?session=` is already read | the switcher writes `?session=<id>` |
| `/assistant/projects` | selection held in `…/hub/projects/ProjectsView.tsx` state | `?project=<id>` |
| `/compare/scans` | swap `…/compare/CompareView.tsx:548–553` updates state, not the `scanA`/`scanB`/`serverA`/`serverB` params read at `:208–218`, so reload reverts and "A Earlier / B Later" lies | swap writes all four params; Earlier / Later computed from scan dates |
| `/scans` | `…/scans/ScansView.tsx:112–113` `serverFacet` / `statusFacet` in state | `?server=<id>&status=` (completed · failed · running; labels: wp-3.1 action 8) |
| `/testing/environments` | advisor evidence links land on the bare list; the Advice panel (`…/testing/EnvironmentsView.tsx:363`) is state only | `?environment=<id>` selects and highlights the row; `?advice=<id>` opens the panel |
| `/testing/compatibility` | cell sheet `…/compatibility/CompatibilityView.tsx:165` `selectedCell` in state | `?tool=<name>&model=<id>` |
| `/dashboard` | Needs-you links (`…/dashboard/overview/overview-derive.ts:625`) drop `range=`, so the Issues tab reverts to 7 days behind the issue sheet | every dashboard-internal link carries the current `range=`; `issue=<id>` opens the sheet regardless of range |

### 10. [P2] Dashboard range picker behaviour

**WHERE:** `…/dashboard/DashboardRangeControl.tsx:60` — choosing a preset applies it but leaves the popover open; the calendar walks into future months and future days are selectable. **TARGET STATE:** a preset closes the popover; dates after today are disabled and the calendar opens on the month that contains the range end. Presets themselves ("All time", "Since last run") are wp-2.2.

### 11. [P1] Group-by shows its value; "Show forks" says what it does

- **WHERE:** `…/servers/ServersOverview.tsx:262–269`, `…/testing/collections/CollectionsView.tsx:268–272`, `…/skills/SkillsOverview.tsx:136`, `…/testing/RunsView.tsx:873–876` — the trigger shows the placeholder "Group by…" whenever a grouping is active (only "No grouping" renders its label), also after reload. **TARGET STATE:** `SelectValue` gets an explicit child (`{GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label}`) in all four; a test renders each with an active grouping and asserts the trigger text.
- **WHERE:** `…/testing/RunsView.tsx:857–861` labels the toggle "Show forks" while `packages/shared/src/run-filter.ts:339–345` makes `derived: true` keep *only* forked runs, so the feed goes to "0 rows" on an instance without forks. **TARGET STATE:** a tri-state "Forks: hide / include / only" in the filter (`derived: undefined | "include" | "only"`, additive in `run-filter.ts`), default hide; the label always names the current state.

### 12. [P2] Column preferences: same popover, persisted, not leaked

**WHERE:** the runs-feed Columns popover closes after one checkbox toggle while the `/scans/:id` Columns popover stays open; the runs column choice (`…/testing/RunsView.tsx:250, 295–297` `columnsPreference`) does not survive navigating back but does leak into the suite-run Runs header (the misalignment itself is wp-2.7 / QA-02). **TARGET STATE:** one popover behaviour (stays open for multiple toggles); column preferences persisted in `localStorage` under a per-table key (`runs-feed`, `scan-detail`, `suite-run`); the suite-run table reads its own key.

## Acceptance

- [ ] `packages/shared/src/scan-figures.ts`, `run-figures.ts`, `issue-figures.ts`, `hub-figures.ts` exist with tests; `grep -rn "cachedPercent" apps packages` returns nothing; no file outside `packages/shared` computes a cache share, a startup total, a latest-scan pick, a tool-call count, a first-measured flag, an open-issue count or a session count (a guardrail, `one-number.guardrail.test.ts`, greps for the retired local derivations).
- [ ] On the review run the rail and Analytics show the same cache share and the same tool-call count.
- [ ] A server's Startup tokens read the same value on `/servers`, `/servers/:id`, the dashboard table and the advisor evidence; a server whose latest scan failed still shows its last measured value with a "Scan failed" chip.
- [ ] The two dashboard "measured for the first time" figures are one figure; the Issues badge, the Needs-you breakdown and the Issues table agree on the open-issue count under every range.
- [ ] `/assistant/agents?tab=usage` labels its session count; one mission renders one status in breadcrumb, card, rail and notification.
- [ ] `/servers/:id` Tools: the Tokens cell text equals `formatNumber(totalTokens)` on first paint (jsdom test) and the layout does not change after filtering.
- [ ] Reloading each URL in action 9 with its parameter restores the selection; a Playwright test covers `/servers/:id?tab=tools&tool=…`, `/skills/:id?version=…`, `/assistant?session=…`, `/compare/scans` after a swap, and `/dashboard?tab=issues&issue=…&range=30d`.
- [ ] The group-by trigger names the active grouping on all four views; the forks control names its state; the runs Columns popover stays open and the preference survives navigation.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

M (2–5 days). Actions 1–7 are S each but touch the API statistics, the web and the CLI; action 9 is one day for ten routes; actions 8, 10–12 are S.

## Sources

QA-05, QA-06, QA-07, QA-08, QA-09, QA-10 (definition part), QA-11, QA-16, QA-20, QA-22, QA-25 (URL part), QA-26 (b), QA-28, QA-29, QA-40, QA-42, UX-03 and ENG-13 (issue-count pipelines; dashboard scope is wp-2.2), UX-08, UX-12, UX-34 (session count), ENG-14, ENG-16, EU-10, EU-29, WT (walkthrough cross-cutting pattern 1: 14 / 12 / 0 issues, 80.6% / 88.7% cache, 13 vs 17 tool calls). Not re-filed: ENG-12 `tool_call` steps left running (wp-2.8), QA-04 session rows (wp-2.10), QA-02 suite-run table (wp-2.7), range presets (wp-2.2).
