---
type: "Work Package Spec"
title: "WP 2.5 — Advisor: summary band, compact list, headline number, closed loop"
description: "Phase 2 of item.md. Ledger: STATUS.md. /advisor leads with what is recoverable and a sortable list instead of a 7,000 px card scroll; each card's saving becomes its headline; server-scoped reports show the recommendations that name the server; the suggested allowedTools list can be copied and applied to the environment; evidence is grouped and provenance moves to a tooltip."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.5 — Advisor: summary band, compact list, headline number, closed loop

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 2, 6 and 8 apply here).

## Scope

`/advisor` (`apps/web/src/features/advisor/AdvisorView.tsx`, `AdvisorPanel.tsx` — header line at
96–97, `RecommendationCard.tsx` — savings block 75–90, evidence list 111–130, the RM-36 name-list
parser `splitDetailNameLists` 216–260, `advisor-format.ts`, `advisor-evidence.ts` — the `scenario`
href at 54–55), the `/servers/:id` Advisor tab (the same `AdvisorPanel` with `scope: "server"`), the
dashboard `AdvisorTile` (WP 2.2 consumes the header recipe defined here), and the API:
`apps/api/src/advisor/rules/unused-tool-trim.ts:137`, `quality-validated-trim.ts:268`,
`skill-effect.ts:207` (`appliesTo`), `tool-overlap.ts`, `registry.ts:29–36`, `rules/shared.ts:162`
(provenance string), the wire type `AdvisorRecommendation` in `packages/shared/src/types.ts:7390`
(additive fields only), and the environment editor's "Servers & skills" tab
(`apps/web/src/features/testing/EnvironmentEditor.tsx:1014`) as the Apply target. **Out of scope:**
new rules or estimator changes (RM-34 owns the turn model), the tokenizer profile label (WP 0.7), the
glossary wording (WP 3.2 — tooltips here use its strings), the server Overview's Savings block
(WP 2.3 hosts it; this WP makes the server-scoped report it reads exist). **Continues:** RM-36 WP 1.1
(`/Roadmap/RM-36-ui-ux-audit-remediation/wp-1.1-advisor.md`) — its disclosure stays, its prose
parser is replaced by a structured field, the follow-up RM-36's STATUS recorded — and RM-01
(`/Roadmap/RM-01-advisor/conventions.md`): deterministic reports, every saving labelled an estimate
with a basis, at least one evidence ref per recommendation — all three invariants still hold. The
list is a `DataTable`, not RM-32's `EntityBrowser` (recommendations are not entities with a route).

## Target layout

**`/advisor`** (also the shape of the server Advisor tab, minus the scope select):

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Header (one row) | `ViewToolbar` | Scope `TitledSelectTrigger` (Whole fleet · MCP server · Environment) · sort (saving · severity · server) · filter chips (category, server) · `results` "16 recommendations · 28 data gaps ▾" (the gaps a disclosure listing each rule and its reason) · right: Export allowedTools ▾ | "Advisor v1 · generated …" (version → tooltip; time → meta) |
| 2. Summary band | `MetricCard` featured + `KpiStat`s inline | Headline = the largest single lever: "136,502 tokens / turn · trim 139 never-called tools · <server> in <environment>"; beside it: per-environment totals (one line each, never summed across environments) · by category (Trim · Overlap · Description bloat · Loading mode) · by server (3 servers) · "≈ $X / month at last-30-day volume (estimate)" per environment | The first card's 170-character lines as the first thing on the page |
| 3. Compact list | `DataTable`, 36 px rows, click expands inline | Severity chip · Title (untruncated, two lines) · Saving (right, `tabular-nums`, unit) · Target (server · environment) · Category · Evidence (n); default sort Saving desc | 16 stacked 440 px cards |
| 4. Expanded card | `RecommendationCard` at `max-w-prose` | Header: display-size number "136,502 tokens / turn" + share "91 % of <server>" + mode qualifier ("while tools load eagerly"; "one-off footprint" for deferred environments) + title line "<server> in <environment>"; body sentence; disclosures "Show 139 never-called tools" / "Keep these 7 (allowedTools)" as `Badge` chips; actions: **Apply to environment "<env>"…** (primary) · Copy allowedTools JSON · Export; Assumptions (collapsed); Evidence grouped "Servers (2) · Scans (2) · Tools (20)" as disclosures, names deduped; provenance line "latest scan Aug 21, 7:43 PM · o200k" with scan ids and the counting version in a tooltip; currency line | Nested "Estimated saving" panel; scan ids and "counting version 2" in prose; repeated evidence names; the flat 20-chip row |
| 5. Server scope | same list | `/advisor?scope=server&id=…` and the `/servers/:id` Advisor tab list every recommendation whose evidence names the server, grouped "From environments that load this server"; tool-overlap cards carry a co-load qualifier and drop to a data gap when no environment loads both servers | The overlap-only server tab; the recommendation that vanished under its own server |

Primary action: per card **Apply to environment…** (opens `EnvironmentEditor` on Servers & skills
with the server's allowed tools prefilled to the kept list; nothing is saved until the user saves);
page-level: Export. Loading: skeleton band + skeleton rows (one recipe, WP 3.3).

## Actions

1. **P1 — Server scope includes the recommendations that name the server.** WHERE: `/advisor?scope=server`, `/servers/:id` Advisor tab · `apps/api/src/advisor/rules/unused-tool-trim.ts:137`, `quality-validated-trim.ts:268`, `skill-effect.ts:207`. TARGET STATE: the three run-dependent rules apply to `scope.kind === "server"` by iterating the environments that include the server; the server report groups them "From environments that load this server"; a test asserts a server-scoped report contains every recommendation whose evidence names that server.
2. **P1 — Structured fields on the wire; delete the parser.** WHERE: `packages/shared/src/types.ts:7390` (`AdvisorRecommendation`), the trim rules' `detail` builders (`unused-tool-trim.ts:104–111`, `quality-validated-trim.ts:150–157`), `RecommendationCard.tsx:216–260`. TARGET STATE: additive optional fields `tools?: { neverCalled: string[]; suggestedAllowedTools: string[] }`, `target?: { serverId; serverName; scenarioId?; scenarioName? }`, `category`; `detail` keeps only prose; `splitDetailNameLists` and its tests are removed; the dashboard tile reads the same fields.
3. **P1 — Card header = the number.** WHERE: `RecommendationCard.tsx:40–90`; `features/dashboard/overview/tiles/AdvisorTile.tsx` (consumer). TARGET STATE: zone 4 header; `savings.value` + unit as display-size text with the share and the loading-mode qualifier derived from `savings.unit` (`tokens_per_turn` → "per turn while tools load eagerly", `tokens` → "one-off footprint"); the basis string's scan id and counting version render in a tooltip, the visible provenance is "latest scan <date> · <profile>".
4. **P1 — Summary band.** WHERE: `AdvisorPanel.tsx` above the list (new `AdvisorSummaryBand`). TARGET STATE: zone 2 computed client-side from the report: largest lever, per-environment totals, counts by category and server; no cross-environment sum.
5. **P1 — Compact sortable list with inline expansion.** WHERE: `AdvisorPanel.tsx:104–125`. TARGET STATE: zone 3 `DataTable`; sort and filter in the URL (`?sort=`, `?category=`, `?server=`); one card expanded at a time; `#<recommendationId>` expands and scrolls to a card (the link target WP 2.3's Savings block uses).
6. **P1 — Copy and Apply allowedTools.** WHERE: `RecommendationCard.tsx` actions; `features/testing/EnvironmentEditor.tsx:1014` ("Servers & skills"); `features/testing/EnvironmentsView.tsx`. TARGET STATE: "Copy allowedTools JSON" writes the kept names as a JSON array; "Apply to environment…" navigates to `/testing/environments?environment=<id>&tab=servers&allowedTools=<server>:<csv>` which opens the editor with that server's tool list prefilled and highlighted; the user confirms with Save; `advisor-evidence.ts:54–55` links Environment evidence to the same `?environment=<id>` selection.
7. **P2 — One card per environment × server.** WHERE: `apps/api/src/advisor/registry.ts:29–36`, the two trim rules. TARGET STATE: when both trims exist for one pair, the report carries one recommendation with two evidence lines ("across all n completed runs" · "across the n graded runs whose score held ≥ 0.5") and the conservative saving; the other id is dropped.
8. **P2 — Evidence grouped by kind, deduped.** WHERE: `RecommendationCard.tsx:111–130`, `advisor-evidence.ts`. TARGET STATE: "Servers (n) · Scans (n) · Tools (n)" disclosures; a tool named by two overlap pairs appears once; chip targets keep RM-36's ≥ 24 px size.
9. **P2 — Currency line.** WHERE: `apps/api/src/advisor/rules/shared.ts` (new helper), `providers/pricing.ts:163` (`resolvePrice`). TARGET STATE: trim and overlap cards carry "≈ $X / month at last-30-day volume (estimate)" = tokens per turn × median turns per run × runs in the last 30 days × the environment model's input price; omitted with a data gap when the model is unpriced.
10. **P2 — Overlap recommendations need co-load evidence.** WHERE: `apps/api/src/advisor/rules/tool-overlap.ts`. TARGET STATE: the card states which environments load both servers; when none does, the finding is emitted as insufficient data ("no environment loads both servers") rather than a recommendation.
11. **P2 — Data gaps explained inline.** WHERE: `AdvisorPanel.tsx:96–104`. TARGET STATE: the `results` count "28 data gaps" opens a disclosure listing rule label + reason from `insufficientData`.
12. **P2 — Glossary tooltips on first use.** WHERE: `RecommendationCard.tsx` prose, `AdvisorSummaryBand`. TARGET STATE: environment, eager/deferred, tokens per turn, allowedTools and data gap carry ⓘ tooltips ≤ 20 words from WP 3.2's glossary map.

## Acceptance

- [ ] At 1440×900 the first viewport of `/advisor` shows the summary band and ≥ 8 list rows; no card is expanded by default; the headline saving is the largest number on the page and appears once.
- [ ] `/advisor?scope=server&id=<the stage server>` and that server's Advisor tab list the "Trim n never-called tools" recommendation; the server-scope test passes.
- [ ] An expanded card: its first text is the saving with unit and share; body lines ≤ 90 characters; no scan id or "counting version" visible without hovering; evidence rendered as three grouped disclosures with no duplicate names.
- [ ] "Copy allowedTools JSON" puts a JSON array of the kept names on the clipboard; "Apply to environment…" opens the environment editor on Servers & skills with the list prefilled and nothing persisted until Save.
- [ ] For one environment × server pair only one trim card exists, carrying both evidence lines.
- [ ] The report payload carries `tools` and `target`; `splitDetailNameLists` no longer exists in `apps/web/src`.
- [ ] The dashboard's Top recommendation shows the same headline number as the `/advisor` card.
- [ ] Both themes verified by looking; gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** (4–5 days): server scope + structured fields M · band + list M · card header S · Copy/Apply S · merge/co-load/currency S.

## Sources

UX-15, EU-01, EU-11, EU-12, EU-31, PS-08, PS-09, PS-24, MK-06 (eager vs deferred qualifier), QA-40 (evidence-link half), UXC-29 (consumed), WT (walkthrough `/advisor` and `/servers/:id` Advisor notes); continues RM-36 WP 1.1 and its STATUS follow-up on the structured field.
