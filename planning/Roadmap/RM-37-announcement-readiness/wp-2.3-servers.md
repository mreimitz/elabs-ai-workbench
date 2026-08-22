---
type: "Work Package Spec"
title: "WP 2.3 — Servers overview recipe v2 and server-detail relayout"
description: "Phase 2 of item.md. Ledger: STATUS.md. One card/table recipe for /servers that reads identity → state → startup tokens → meta; server detail with one status word, a six-stat KPI strip, tabs and the selected tool in the URL, an unclipped Tools pane, an issue card that leads with its title, and 'Tests' renamed 'Model limits'."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.3 — Servers overview recipe v2 and server-detail relayout

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 2, 3, 4, 5 and 7 apply here).

## Scope

`/servers` (`apps/web/src/features/servers/ServersOverview.tsx` — columns 156–218, group-by Select
262–269, `ServerOverviewCard` 361–486; `components/entity-browser/EntityCard.tsx` + `EntityTable.tsx`;
`features/servers/server-status.ts`) and `/servers/:id` (`features/servers/ServersView.tsx` — tab
state 118, tool columns 350–377, header 483–575, tabs 581–610, KPI strip 631–640, Findings 645–677,
Tools pane 792–845, Scans history columns 381–424; `features/issues/IssuesPanel.tsx`;
`features/security/PostureScore.tsx` chip variant), plus name resolution on the API edge
(`apps/api/src/grading/error-forensics.ts:188–202`). **Out of scope:** the posture rule and the band
until it is accepted (WP 0.5 — this WP only places the chip), severity words and the limit-language
ramp (WP 0.5 / WP 3.2 — this WP places the findings, 0.5 names them), the Advisor tab's content and
the server-scope fix (WP 2.5; this WP only hosts the Savings block), transport/auth label maps (WP 3.1
owns the map; this WP consumes it, adding it if 3.1 has not landed), the add-server wizard (WP 1.2).
**Continues:** RM-32 WP 2.1 (`/Roadmap/RM-32-overview-detail/wp-2.1-servers.md`) — the `EntityBrowser`
overview this recipe revises; its D-OD3 "one table per group" is the constraint the table fix
replaces — and RM-36 WP 2.2 P2-2 (`/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.2-consistency-density.md`:
group-heading chips dropped from cards, the clipped card name) — already scoped there, not re-filed.

## Target layout

**A. `/servers` card** (`EntityCard` slots, top to bottom):

| Zone | Slot / component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Identity | `title` + `badges` + `actions` | Name (wraps to 2 lines, never truncated) · type chip (`ServerTypeStatusBadge`; omitted under a type group heading per RM-36) · ⋯ menu: Scan now · Edit · Check connection · Export report · Delete | The ▷ scan icon (kept only for never-scanned servers) |
| 2. State | `status` → one `StatusBadge` | Scanned · Not scanned · Scan failed · Sign-in needed · Scanning… — one chip, one colour | The health dot beside a chip; the posture chip's loud slot |
| 3. Primary number | `metrics` → one `KpiStat` (stack, 32 px) | "Startup tokens 149,338" + `MetricDelta` vs the previous successful scan | Tools and Last scan as equal-weight numbers |
| 4. Meta | `meta` line, muted, truncates last | "146 tools · scanned 3 h ago · posture 15/100" (`PostureScore variant="chip"`, info tone unless an error-class finding; band per WP 0.5) · "HTTP · OAuth" | "Healthy" wording; mixed date formats (relative < 7 days, absolute after) |
| 5. Footer | `description` mono | Endpoint, middle-truncated | — |

Default `groupById = none` (type stays a chip); 3-up at 1440; sort Startup tokens desc; skeleton cards
while loading. **Table view** — one `DataTable` (group header rows inside it, or ungrouped by
default) with shared fixed widths: Name · Type · Status · Startup tokens (right, `tabular-nums`) · Δ ·
Tools · Posture · Last scan · Transport · Auth · ⋯ (Scan · Edit · Check connection). Primary action
of the page: "+ Add server" (toolbar, right-most); the group-by trigger shows its value.

**B. `/servers/:id`** (`PageShell headerVariant="toolbar"`, tabs in `?tab=`, tool in `?tool=`):

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Header | `ViewToolbar` | left: one `StatusBadge` · type + lifecycle chips · meta "HTTP · OAuth · last scan 3 h ago, completed" · URL middle-truncated (copy on click); right: **Scan now** (primary) · ⋯ (Edit · Check connection · Export report), all `IconButton`s with tooltips | The bare "Completed" chip next to "Healthy"; raw `streamable_http` |
| 2. Tab strip | `TabPanel` | Overview · Model limits (n) · Tools (n) · Resources · Prompts · Scans (n) · Issues (n) · Advisor — counts only when > 0; Resources/Prompts hidden when both are 0 | The "Tests" label (third meaning of "test") |
| 3. Overview KPI strip | six `KpiStat`s, one row | Startup tokens (+Δ) · Recoverable · Tools · Posture 49/100 · Open issues 6 · Top-3 share 15 % | A three-stat strip using 25 % of its width |
| 4. Savings block | `Card` with two `KpiStat`s inline | "Remove 139 never-called tools −136,502 / turn (3 runs in <environment>)" · "Slim 66 heavy definitions −16,246" — each a link to its advisor card | Two unrelated "saving" numbers one click apart |
| 5. Findings (3/5) · Token distribution (2/5) | `Card`s | Findings: three shown, "Show all n"; each finding a disclosure; chips capped at one row + count; names phrased as the problem (wording per WP 0.5); "View all checks" → Model limits. Distribution: top 10 sticky + "All 77" | "5 Blocker" on a healthy server; chip walls; a blank right column on scroll |
| 6. Tools tab | `SplitPane` | Inventory 40 %: Tool · Tokens (right, `tabular-nums`, `minSize` 80) · % — one column layout on first paint and after filtering; detail fills its height, Run as the pane's primary action right of the tool name, instructions `max-w-prose` | The clipped Tokens cell; the layout that changes once the filter is used |
| 7. Scans tab | `DataTable` | Date · Status · Tools · Tokens · Δ vs previous · Largest tool · ⋯; failed rows: `StatusBadge` + error excerpt in the Tokens cell | "0 tools · 0 tokens" on a failure |
| 8. Issues tab | `IssuesPanel` cards | Summary line "6 open · 2 high · 4 medium"; card = title (one line, never truncated) → meta chips (lifecycle · severity · root cause · fix target · seen n× · last seen) → Draft fix → "Occurrences (2) — last: <error>" collapsed with "Show sent parameters" → Resolve · Export in the card header; server **names**, run links "run name · date" | Four chips before the title; expanded JSON per occurrence; ids as labels; Resolve at the card bottom |

## Actions

1. **P1 — Card recipe v2.** WHERE: `/servers` · `ServersOverview.tsx:361–486` (`ServerOverviewCard`, `Metric`), `server-status.ts:46–52`. TARGET STATE: zones A1–A5; one `StatusBadge` per card (labels Scanned / Not scanned / Scan failed / Sign-in needed / Scanning…), no dot beside a chip; Startup tokens as the only large number with `MetricDelta`; tools + last scan + posture chip on the meta line; one date format rule.
2. **P2 — Ungrouped by default; the group-by trigger shows its value.** WHERE: `ServersOverview.tsx:151` (`useEntityBrowserState`), `:262–269`; shared fix for `skills/SkillsOverview.tsx:129–136` and `testing/collections/CollectionsView.tsx:265–272`. TARGET STATE: `groupById` defaults to `none`; `SelectValue` renders "Group by Type" when active, "No grouping" otherwise.
3. **P2 — One aligned table.** WHERE: `components/entity-browser/EntityTable.tsx` (one `DataTable` per group today). TARGET STATE: a single `DataTable` with group header rows or explicit shared column widths; column set B; sort Startup tokens desc; an actions column.
4. **P1 — Tabs and the selected tool in the URL.** WHERE: `ServersView.tsx:118` (`useState("overview")`), tool selection; mirror `features/scans/ScansView.tsx:115–126`. TARGET STATE: `?tab=` and `?tool=` via `useSearchParams`; Overview tool chips and "View all checks" set them; reload returns to the same tab and tool.
5. **P2 — Header recomposed.** WHERE: `ServersView.tsx:488–575`. TARGET STATE: zone B1; the last-scan status folds into the meta string; transport via the shared `TRANSPORT_LABELS`; Edit / Check connection / Export report routed through `components/IconButton.tsx` so hover shows the tooltip equal to the `aria-label`.
6. **P1 — Six-stat KPI strip.** WHERE: `ServersView.tsx:631–640`. TARGET STATE: zone B3, one row at 1440; Δ vs previous from `scanDeltaFor`; Open issues from the Issues tab's count; Posture from the fleet posture summary.
7. **P1 — Savings block.** WHERE: Overview body under the strip (`ServersView.tsx` after 640). TARGET STATE: zone B4; reads the server-scoped advisor report (needs WP 2.5's server-scope fix); each lever links to `/advisor?scope=server&id=…#<recommendationId>`; absent when the report has no savings.
8. **P2 — Findings capped and phrased as problems.** WHERE: `ServersView.tsx:645–677`, `ServerFindings`. TARGET STATE: three findings + "Show all n"; each header a disclosure; chips one row + "+n"; "View all tests" → "View all checks"; the severity word and finding name come from WP 0.5's vocabulary.
9. **P2 — "Tests" tab becomes "Model limits".** WHERE: `ServersView.tsx:587–591`, `ServerTestsTab`. TARGET STATE: label "Model limits", counts only when > 0, dataset date shown in the tab body (WP 2.9 owns thresholds).
10. **P1 — Tools pane never clips the number.** WHERE: `ServersView.tsx:350–377` (no `size`/`minSize` on `tokens`/`share`), `:797–801` (`startSize={32}`). TARGET STATE: `tokens` `minSize` 80 with `whitespace-nowrap`, `share` 56, name column flexes; `startSize` 40; one column layout regardless of the filter; a jsdom test asserts the rendered cell text equals `formatNumber(totalTokens)`.
11. **P2 — Scans tab failure rows.** WHERE: `ServersView.tsx:381–424` (`historyColumns`). TARGET STATE: a failed scan renders its status and error excerpt in the Tokens cell and "—" for Tools; never "0".
12. **P1 — Issue card: title first, occurrences collapsed, names not ids.** WHERE: `features/issues/IssuesPanel.tsx:190–290`; `apps/api/src/grading/error-forensics.ts:188–202` (`on ${step.serverId}`). TARGET STATE: zone B8; the forensics description carries the server name; occurrence links read "<run name> · <date>"; the summary chips are plain counts (or working filters), never inert chip-styled text.
13. **P3 — Scan-now confirmation on a fresh OAuth server.** WHERE: `ServersView.tsx:538–541`. TARGET STATE: a confirm when the server uses OAuth and the last scan is < 24 h old.

## Acceptance

- [ ] `/servers` at 1440×900: ungrouped by default, 3 cards per row, ≥ 6 cards in the first viewport; every card shows exactly one state chip, one 32 px number with a Δ, and no health dot beside a chip; no card name is truncated.
- [ ] Table view: one header row; the "Startup tokens" header has one x-position for all rows; Tools, Last scan and ⋯ columns present.
- [ ] With grouping active on `/servers`, `/skills` and `/testing/collections` the trigger reads "Group by <x>", not "Group by…".
- [ ] `/servers/<id>?tab=tools&tool=<toolId>` reloads to that tab with that tool selected; the tab strip contains "Model limits" and no "Tests".
- [ ] Header: exactly one status chip; no "Completed" chip beside a health word; hovering each header icon for 1 s shows a tooltip whose text equals its `aria-label`.
- [ ] Overview first viewport: six KPI stats on one row including Open issues and Posture; the Savings block with two levers; Findings shows ≤ 3 expanded and a "Show all n" control.
- [ ] Tools tab on first paint: every Tokens cell's `scrollWidth` equals its `clientWidth`; the jsdom text test passes.
- [ ] Scans tab: no failed row shows "0" under Tools or Tokens.
- [ ] Issues tab: the first text in each card is its title; occurrences are collapsed; no 21-character id appears in any description or link label; Resolve sits in the card header.
- [ ] Both themes verified by looking; gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** (4–5 days): card + table recipe M · header/strip/savings S · URL tabs S · Tools pane S · Issues card + API names S.

## Sources

UX-08, UX-09, UX-10, UX-11, UX-12, UX-13, UX-14, PO-15 (tab rename), PS-07, PS-12, PS-29, EU-11, QA-07, QA-10 (servers part), QA-12, QA-22, QA-23, QA-24, ENG-16, UXC-08, UXC-10 (server parts), UXC-22 (placement only), WT (walkthrough `/servers`, `/servers/:id` notes); continues RM-32 WP 2.1, RM-36 WP 2.2 P2-2.
