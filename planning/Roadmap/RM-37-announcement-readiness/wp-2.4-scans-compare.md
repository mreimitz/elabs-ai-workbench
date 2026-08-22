---
type: "Work Package Spec"
title: "WP 2.4 — De-rail Scans, posture in the scan strip, Compare with Δ as the result"
description: "Phase 2 of item.md. Ledger: STATUS.md. /scans becomes an EntityBrowser table and /scans/:id a full-width detail with a breadcrumb switcher; the Security tab's second KPI strip folds into the scan strip; /compare/scans gets a one-row header whose result is the Δ, a summary band with a verdict sentence, and neutral Added/Removed colours."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.4 — De-rail Scans, posture in the scan strip, Compare with Δ as the result

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 4, 6, 7 and 8 apply here).

## Scope

`/scans` and `/scans/:id` (`apps/web/src/features/scans/ScansView.tsx` — status filter options
62–64, history columns 272–340, the `AdaptivePanelGroup` master-detail at 478–560, "All scans" back
control 530–543, KPI strip 609–631, tabs 636–646), the Security tab (`features/security/SecurityPanel.tsx`
— four `MetricCard`s at 173–176 and the loaded strip; `SecurityDiffPanel.tsx:153–166` diff line,
`ScoreDelta` 221–231; `PostureScore.tsx`), and `/compare/scans` (`features/compare/CompareView.tsx` —
`CHANGE_META` 80–90, URL prefill 208–218, `swapSides` 547–560, `ScanCompareBar` 712–788,
`DeltaSummary` 919–934, `DiffTable` badges 1133–1147). Reuses `components/BreadcrumbEntitySwitcher.tsx`
(pattern: `features/servers/ServerBreadcrumbSwitcher.tsx`) and `components/entity-browser/*`.
**Out of scope:** the posture rule, the risk band and severity words (WP 0.5 — this WP shows
"Posture 15/100" and lets 0.5 decide the band), the nav demotion of Scans (WP 2.1; the route stays),
the scan-failure reason mapping (WP 2.2 action 13; consumed here), the Compare **runs** workspace
(WP 2.7/2.8), token-profile labels in the compare warning (WP 3.1). **Continues:** RM-32
(`/Roadmap/RM-32-overview-detail/item.md`) — the de-rail precedent of WP 2.1/2.2/2.3 and the WP 1.2
breadcrumb switcher, applied to the one list that still carries a rail — and RM-20 WP 2.1
(`/Roadmap/RM-20-security-posture/wp-2.1-security-ui.md`), whose strip is folded. No RM-36 WP touched
these routes.

## Target layout

**A. `/scans`** — `EntityBrowser` in table mode, `PageShell width="full"`, no rail:

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Toolbar (one row) | `ViewToolbar` | search · Server filter · Status filter (labels = `StatusBadge` vocabulary; `?server=` `?status=` in the URL) · `results` "105 scans · 4 failed" · right: "Compare scans" (secondary) | The second filter row; the "Success / Running" filter words |
| 2. Table | `EntityTable` / `DataTable`, 32 px rows | Server · Date · Status (text variant) · Startup tokens · Δ vs previous · Tools · Largest tool · Duration; default sort Date desc; failed rows show the error excerpt in the tokens cell; row click → `/scans/:id` | The 390 px master-detail rail; full-colour Completed/Failed pills |

No primary action (scans start from a server); the page's result is the list.

**B. `/scans/:id`** — full width, breadcrumb `Scans › <server> ▾ › <date> ▾`:

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Breadcrumb | `BreadcrumbEntitySwitcher` | This server's scans (date · status · tokens), "All scans" as the section crumb | The "← All scans" control duplicating the breadcrumb |
| 2. Header | `ViewToolbar` | left: `StatusBadge` · meta "profile o200k · 12 s"; right: Diff vs previous · Export ▾ | Columns (moves into the tab toolbar) |
| 3. KPI strip (pinned, one row) | five `MetricCard`s | Total footprint (+Δ vs previous as `MetricDelta`, link "Diff") · Tools · Resources · Posture 15/100 · Largest tool (name middle-truncated, value on the second line) | Avg tokens/tool (→ Tools tooltip); the Security tab's own strip |
| 4. Tabs (`?tab=`) | `TabPanel` | Tools · Resources · Security — Prompts only when > 0 | — |
| 5. Security tab | one chip row + `DataTable` | "4 errors · 3 warnings · 17 info" chips and the baseline picker on one row; diff line "<baseline score or 'not scored'> → 15 · +n better / −n worse" only when both scores exist; table worst-first: Severity 80 · Rule ≥ 160 · Where (mono, middle-truncated) 220 · What was found (flex) · Evidence 110 | Posture / Errors / Warnings / Info tiles; the three-line Rule column |
| 6. Failed scan | `StatePanel` | Reason mapped per WP 2.2 action 13 ("Sign-in needed → Sign in again", supersession note) | "Couldn't complete the scan. Unauthorized" with generic actions |

Primary action: **Diff vs previous** (secondary tone — a comparison, not a mutation).

**C. `/compare/scans`** — `PageShell headerVariant="toolbar"`:

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Header (one row) | `ScanCompareBar` with two `TitledSelectTrigger` pairs | "A <server · scan> ▸ B <server · scan>" (Latest quick-picks), swap, type filter; `results` slot = **Δ tokens +17,780 · 13.5 %** as the row's largest element | The two-row header; the Δ as a small far-right chip |
| 2. Summary band | `KpiStat`s inline | A tokens · B tokens · Δ (`MetricDelta`) · added · removed · matched; cross-server: "Only in B" · "Only in A" · shared, plus the verdict sentence "B shares 60 of A's 77 tools (2 with schema differences); 17 only in A; −15,662 tokens (−24.3 %)" | Inference from three badges |
| 3. Tabs + table toolbar | `TabPanel` + `ViewToolbar` | Tools · Resources · Prompts; search · Change filter · "Changes only" (off by default cross-server) · counts; ⓘ tooltips on "eligible" and "Fuzzy" | — |
| 4. Diff table | `DataTable` | Tool · Before · After · Δ (`MetricDelta`) · Change (Added = info tone, Removed = neutral outline, Increased/Decreased = `MetricDelta` tone) · Match (cross-server) · Definition (tools) | Green "success" on Added (it adds tokens); red on Removed |

No primary action (a composer); Export stays in the header.

## Actions

1. **P1 — `/scans` as a table, no rail.** WHERE: `/scans` · `ScansView.tsx:478–560` (`AdaptivePanelGroup` branch), 272–340 (columns). TARGET STATE: zone A; the list mode renders `EntityBrowser` (table mode only — scans have no card recipe); the master-detail branch is deleted; `?server=`/`?status=` persist in the URL.
2. **P1 — Filter labels from the status vocabulary.** WHERE: `ScansView.tsx:62–64`. TARGET STATE: options read Completed / Failed / Running via `deriveStatusView` labels; the `results` count says "105 scans · 4 failed".
3. **P1 — Full-width detail with a breadcrumb switcher.** WHERE: `/scans/:id` · `ScansView.tsx` detail branch, new `features/scans/ScanBreadcrumbSwitcher.tsx` after `ServerBreadcrumbSwitcher.tsx`. TARGET STATE: zone B1–B2; the switcher lists this server's scans with date, status and tokens; "← All scans" removed.
4. **P1 — Posture folded into the scan strip.** WHERE: `ScansView.tsx:609–631`; `SecurityPanel.tsx:173–176` and its loaded counterpart. TARGET STATE: zone B3 (five cards, Posture replaces Avg tokens/tool; Largest tool two-line); the Security tab renders no second strip, only the chip row.
5. **P1 — Security findings table first.** WHERE: `SecurityPanel.tsx` table columns. TARGET STATE: zone B5 widths; worst-first default sort; the chip row and baseline picker share one row.
6. **P2 — Baseline diff line correctness.** WHERE: `SecurityDiffPanel.tsx:153–166`, `ScoreDelta` 221–231; baseline options. TARGET STATE: a baseline without a score renders "not scored" and no delta; "+n better" appears only when both scores exist and the sign matches the added/resolved counts; baseline options carry seconds or the scan id so two scans in one minute are distinguishable.
7. **P1 — Compare header: one row, Δ as the result.** WHERE: `/compare/scans` · `CompareView.tsx:712–788`, `919–934`. TARGET STATE: zone C1; `ScanSide` uses `TitledSelectTrigger` with content-sized widths; `DeltaSummary` renders in the `results` slot as a `MetricDelta`-toned badge at `text-lg`; the row never wraps at 1440.
8. **P1 — Summary band and cross-server verdict.** WHERE: `CompareView.tsx` below the bar (new `CompareSummaryBand`). TARGET STATE: zone C2; same-server wording added/removed/matched; cross-server wording Only in A / Only in B / shared plus the verdict sentence built from `comparison.matched`, `onlyInA`, `onlyInB`, `totalsDeltaTokens`.
9. **P2 — Neutral Added/Removed, `MetricDelta` for matched rows.** WHERE: `CompareView.tsx:80–90` (`CHANGE_META`), 1133–1147 (count badges), Δ column. TARGET STATE: Added = info, Removed = neutral outline, counts badges match; Increased/Decreased via `MetricDelta` with `higherIsBetter=false`.
10. **P2 — Swap writes the URL; Earlier/Later from dates; "Changes only" off cross-server.** WHERE: `CompareView.tsx:547–560`, 208–218, `DiffTable` state 962–979. TARGET STATE: swap updates `scanA`/`scanB` (reload keeps the order); the A/B headings derive from `scannedAt`; `hideUnchanged` defaults to false when `!comparison.sameServer`.
11. **P2 — Tooltips for "eligible" and "Fuzzy".** WHERE: `ScanSide` eligible count (`CompareView.tsx:793–805`), fuzzy control 443–463. TARGET STATE: ⓘ ≤ 20 words each ("scans that completed successfully and can be compared"; "how loosely tool names are matched across servers").

## Acceptance

- [ ] `/scans` at 1440×900: no rail; one toolbar row (no wrapped filter row); the table header sits within 140 px of the content top; ≥ 15 rows visible; `?status=failed` survives a reload.
- [ ] `/scans/<id>`: the first viewport shows the breadcrumb switcher, one KPI row of five cards including Posture, and the Tools table header; no "← All scans" control; the Largest-tool card's `scrollWidth` equals its `clientWidth`.
- [ ] `/scans/<id>?tab=security`: the findings table header is above y = 450 px; exactly one chip row above it and no second KPI strip; the Rule column measures ≥ 160 px.
- [ ] With a baseline selected, both scores render (or "not scored"); no "+n better" appears on a diff that added findings and resolved none.
- [ ] `/compare/scans` at 1440: the header is one row; the Δ badge is the right-most element and the largest number on the page; the summary band sits directly under it; Added rows carry no success tone.
- [ ] Cross-server compare: the verdict sentence renders; badges read "Only in A" / "Only in B"; "Changes only" is off; swapping then reloading preserves the swapped order and relabels Earlier/Later.
- [ ] Both themes verified by looking; gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** (3–4 days): de-rail + switcher M · strip/security S · compare header/band S · colours/URL/tooltips S.

## Sources

UX-16, UX-17, UX-18, EU-24, QA-20, QA-21, QA-25 (scans part), PO-17 (route kept; nav in WP 2.1), UXC-15 (filter labels, consumed), WT (walkthrough `/scans`, `/scans/:id`, `/compare/scans` notes); continues RM-32 WP 1.2 / 2.1, RM-20 WP 2.1.
