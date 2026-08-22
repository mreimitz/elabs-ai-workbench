---
type: "Work Package Spec"
title: "WP 2.2 — Dashboard Overview relayout, counters reconciled, range honesty"
description: "Phase 2 of item.md. Ledger: STATUS.md. Reorders the Overview bento so attention and the top saving lead, deletes the duplicated fleet total, makes the three issue counters one number, and makes the range control say what it scopes — with honest empty windows on the Testing tab."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.2 — Dashboard Overview relayout, counters reconciled, range honesty

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules file
from [`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 2, 4 and 6 are the ones this view breaks).

## Scope

`/dashboard` and its three tabs. Files: `apps/web/src/features/dashboard/overview/OverviewTab.tsx`
(tile order at 192–209), `overview/tiles/*.tsx`, `overview/overview-derive.ts` (attention list at
639), `overview/use-overview-data.ts`, `dashboard/DashboardView.tsx` (badge count at 157, range ⓘ
copy at 187), `dashboard/dashboard-range.ts` + `DashboardRangeControl.tsx` (presets),
`dashboard/TestingTab.tsx` + `dashboard/testing/KpiHeader.tsx` + `GuardrailStopsPanel.tsx`,
`issues-fleet/IssuesFleetTab.tsx` (range AND at 136) + `use-fleet-issues.ts`, and the scan-failure
reason mapping shared with `features/scans` (action 13). **Out of scope:** the advisor card's body and
the structured tool list on the wire (WP 2.5 — this WP consumes its header recipe), the issue title
template in `apps/api/src/grading/issue-clustering.ts` (WP 3.2 — this WP fixes the tile's allocation),
the canonical number helpers in `packages/shared` (WP 3.4 — if this WP lands first it adds the
helper there and 3.4 adopts it), the Testing tab's chart panels beyond the empty notice.
**Continues:** RM-36 WP 1.1 (`/Roadmap/RM-36-ui-ux-audit-remediation/wp-1.1-advisor.md`, the
disclosure the dashboard card still lacks) and the completed RM-11 bento
(`/Roadmap/completed/RM-11-dashboard-bento/STATUS.md`) whose tiles are rearranged, not rebuilt. The
dashboard uses `BentoGrid` tiles with `DataTable`s inside, not RM-32's `EntityBrowser`.

## Target layout

Overview tab — a 4-column `BentoGrid`, six tiles, in reading order, no number twice:

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 0. Page header | `DashboardRangeControl` + tabs | Presets 24h · 7d · 30d · 90d · All time · Since last run; calendar without future days; tabs Overview · Testing · Issues (count = open issues); ⓘ ≤ 20 words naming what the range scopes (runs and issue occurrences — scan tiles are window-independent) | The untrue "one window for the whole Dashboard" claim |
| 1. Left, 2 cols × 2 rows | `AttentionTile` (promoted) | Header "Needs you · 1 failed scan · 12 open issues · 1 unscanned" (breakdown line, no "14"); rows = `StatusBadge` kind chip · title `line-clamp-2` · single-line muted target · age ("failed 6 w ago · last success Jun 22"); failed-scan rows show the reason without host:port and a stale tone after 14 days; primary action per row = Open, "Scan now" behind the row's ⋯ menu; footer "Open all issues" | Title truncation; the bare "14" badge; the immediate Scan-now icon; the undated failure row |
| 2. Right top, 2 cols | `AdvisorTile` → `MetricCard` featured | The saving as the number ("≈ 136,502 tokens / turn · 91 % of the server"), one-line title, two disclosures "Show n never-called tools" / "Show n suggested allowedTools" (RM-36 WP 1.1 treatment), "See all n" | The inline 139-name list in the clamped detail |
| 3. Right middle, 2 cols | `InventoryTile` (absorbs `SurfaceMixTile` + `LargestToolTile`) | Four `KpiStat`s with `MetricDelta`: Servers · Tools (+45) · Resources (+69) · Prompts; a one-line mix bar "Tools 99 % · Resources 1 %"; meta "Largest tool: <name> 6,874" | The donut; the largest-tool progress-bar tile; the empty 4th column |
| 4. Full width | `HeroFootprintTile` (demoted, chart 200 px) | Headline "Fleet startup tokens 275,567" + `MetricDelta` "+17,780 vs previous scans"; y-axis or end-of-line values; one provenance line ("Includes 2 servers measured for the first time · 1 server has no successful scan yet") | `StartupCostTile` (duplicate number); two of the three provenance footnotes; the grey dotted series (use the 4th ramp colour) |
| 5. Full width | `MoversTile` + `FootprintTableTile` merged → "What changed" | `DataTable`, 32 px rows, sorted by Δ desc: Server · Startup tokens · Δ vs previous · Largest tool · Last scan · Posture · Open | The separate movers list; the "Tool tokens" label (one composition, action 11) |
| 6. Full width | `RecentScansTile` | 32 px rows: Server · Date · Status · Tokens (failed rows: the error excerpt) · Duration; scoped to the range or titled "Latest 8"; footer "All scans" → `/scans` | "0 tool tokens" on failures |

`PassRateTile` and `SpendByBasisTile` leave the Overview for the Testing tab's KPI header (D-TB4:
run KPIs are the Testing dashboard's job). No page-level primary action; Open is the row action.

**Testing tab:** KPI header Runs · Pass rate · Error rate · Active p95 · Cost (basis-marked); an
empty window renders ONE `StatePanel` notice — "No runs between Aug 14 and Aug 21 — last run Jul 17 ·
Show last 90 days · All time" — instead of six empty panels; rates with a 0 denominator read "—".

**Issues tab:** lifecycle first (Open + Regressed by default), the range an optional "Seen in
window" chip; columns Issue (title two lines, root-cause chip) · Lifecycle · Severity · Occurrences ·
Last seen · Affected; `TabEmptyState` "Show all n open issues" with the reason line when a filter
hides everything; `?issue=<id>` opens the drawer regardless of range.

## Actions

1. **P1 — Reorder and merge the tiles.** WHERE: `/dashboard` · `overview/OverviewTab.tsx:192–209`, `tiles/StartupCostTile.tsx` (delete), `tiles/SurfaceMixTile.tsx` + `tiles/LargestToolTile.tsx` (fold into `InventoryTile.tsx`), `tiles/MoversTile.tsx` + `tiles/FootprintTableTile.tsx` (merge), `tiles/PassRateTile.tsx` + `tiles/SpendByBasisTile.tsx` (move to `testing/KpiHeader.tsx`). TARGET STATE: the six-tile order in the table; `overview-contract.ts` sections unchanged.
2. **P1 — Attention rows carry the title, the date and a safe action.** WHERE: `tiles/AttentionTile.tsx:243` (`truncate` on the label) / `:259` (`line-clamp-2` on the detail), `overview-derive.ts:582–642`. TARGET STATE: title `line-clamp-2`, detail single line; the kind word (skill / model behavior / MCP server / scan) in the `StatusBadge`; age and last success per row; Open is the row's link, Scan-now sits in a ⋯ menu; failed-scan reasons render without host:port and carry the scan date; items older than 14 days use the muted "stale" tone.
3. **P1 — One issue count.** WHERE: `DashboardView.tsx:157` (`useFleetIssues().badgeCount`), `overview-derive.ts:639`, `issues-fleet/IssuesFleetTab.tsx:136`, `use-fleet-issues.ts`. TARGET STATE: one selector `selectAttentionIssues(issues)` feeds tile, badge and table; open + regressed issues are never range-scoped; the range scopes occurrences via an opt-in chip; the tile header shows the breakdown "n failed · n open · n unscanned".
4. **P1 — Range survives internal links and deep links bypass it.** WHERE: every `Link` built in `features/dashboard/**` and `issues-fleet/**`. TARGET STATE: `range=` is carried on every dashboard-internal link; `/dashboard?tab=issues&issue=<id>` opens the issue drawer under any range.
5. **P2 — Issues tab empty state with recovery.** WHERE: `issues-fleet/IssuesFleetTab.tsx` empty branch. TARGET STATE: `TabEmptyState` titled "No issues in this window", description "None were seen between <from> and <to>", one action "Show all n open issues" (clears the chip).
6. **P1 — Advisor tile = number first.** WHERE: `tiles/AdvisorTile.tsx:127–160`. TARGET STATE: a featured `MetricCard` whose value is the saving (tokens / turn) with the share as `description`; title on one line; the two disclosures from RM-36 WP 1.1 (share `RecommendationCard`'s sub-component until WP 2.5's structured field lands); "See all n" link.
7. **P2 — Hero chart readable and single-sourced.** WHERE: `tiles/HeroFootprintTile.tsx`. TARGET STATE: `MetricDelta` in the headline; a y-axis or end-of-line values per server; one provenance line; chart height 200 px; the dotted series uses a ramp colour in dark theme.
8. **P2 — Inventory fills its row.** WHERE: `tiles/InventoryTile.tsx`. TARGET STATE: four `KpiStat`s with `MetricDelta`, the mix bar and the largest-tool meta line; span 2; no empty 4th column; no tile more than half empty.
9. **P2 — "What changed" and "Recent scan activity" tables.** WHERE: merged `tiles/FootprintTableTile.tsx`, `tiles/RecentScansTile.tsx`. TARGET STATE: the column sets above; 32 px rows; failed scans show `StatusBadge` + error excerpt in the tokens cell; activity scoped to the range or titled "Latest 8"; footer link "All scans".
10. **P2 — Range control honesty.** WHERE: `dashboard-range.ts:48–87`, `DashboardRangeControl.tsx`, `DashboardView.tsx:187`. TARGET STATE: presets 90d / All time / Since last run added; a preset click closes the popover; future days disabled; ⓘ ≤ 20 words stating that scan tiles ignore the window.
11. **P2 — One startup-tokens composition on the page.** WHERE: hero, inventory, "What changed" table, `tiles/scan-tile-data.ts`. TARGET STATE: every figure is tools + resources + prompts from the latest **successful** scan (the scan's total footprint); one `firstMeasured` derivation in `use-overview-data.ts`; a tools-only figure is labelled "Tool tokens" or not shown.
12. **P2 — Testing tab empty window and zero rates.** WHERE: `dashboard/TestingTab.tsx`, `testing/KpiHeader.tsx:32–45`, `GuardrailStopsPanel.tsx:13–20`. TARGET STATE: "—" when the denominator is 0; panel subtitle "per stop reason"; the single notice with widen actions replaces six empty panels; cost tiles say "Subscription" never "$0.00".
13. **P2 — Failure reasons that name the fix.** WHERE: the scan-failure panel in `features/scans/ScansView.tsx` and `tiles/AttentionTile.tsx` (shared mapping in `features/scans`). TARGET STATE: 401/403/expired grant → "Sign-in needed" with a "Sign in again" action; when a later scan of the same server succeeded the panel says "Superseded by a successful scan at <time>" and links it; connection-refused keeps its three-sentence diagnosis.

## Acceptance

- [ ] At 1440×900 the first viewport of `/dashboard` contains Needs you (breakdown header, ≥ 5 rows with distinct readable titles), the top recommendation with its saving as the tile's largest text, and the fleet inventory; the fleet total string appears exactly once on the whole page.
- [ ] No Overview tile is more than half empty; row 2 has no empty column; the hero chart has a readable value axis.
- [ ] The Issues badge, the Needs-you open count and the Issues table row count are equal under 24h, 7d, 30d and All time.
- [ ] `/dashboard?tab=issues&issue=<id>` opens the issue drawer with the default range; following a Needs-you link keeps `range=` in the URL.
- [ ] The calendar cannot select a future day; a preset click closes the popover.
- [ ] Testing tab on a window with 0 runs: one notice, zero empty chart panels, "Error rate —".
- [ ] Recent scan activity: a failed scan row shows a status and an error excerpt, never "0".
- [ ] A failed-scan attention row shows its date and no host:port; its only inline action is Open.
- [ ] Both themes verified by looking; gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** (3–5 days): tile reorder + merges M · counters + range S · attention rows S · Testing/Issues tab states S.

## Sources

UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-07, PO-35, ENG-13, QA-08, QA-09, PS-01, PS-19, EU-07, EU-08, EU-10, EU-29, EU-31 (dashboard half), UXC-20 (tile side), UXC-24, UXC-25, UXC-26 (dashboard surfaces), WT (walkthrough `/dashboard`, `?tab=testing`, `?tab=issues` notes); continues RM-36 WP 1.1.
