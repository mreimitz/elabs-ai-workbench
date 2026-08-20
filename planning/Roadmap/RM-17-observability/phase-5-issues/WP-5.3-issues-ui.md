---
type: "Work Package Spec"
title: "WP 5.3 \u2014 Issues tab UI"
description: "Phase: 5 \u2014 Fleet issues \u00b7 Size: L \u00b7 Depends on: 5.1, 2.2 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.3 — Issues tab UI

**Phase:** 5 — Fleet issues · **Size:** L · **Depends on:** 5.1, 2.2 · **Model:** Sonnet

## Objective

Issues become visible and workable: the Dashboard's third tab (D-OB11) with a triage list and a
detail view — occurrences, trend, affected entities, linked runs, the drafted fixes forensics
already produces, and lifecycle actions.

## Design

- **Issues tab** (mount point left in 2.1): triage table — title (AI-assisted mark when 5.2
  ran), lifecycle chip (open amber · regressed red · resolved green/muted), occurrences,
  trend sparkline (from `trend_json`), first/last seen, affected chips (server/skill/model),
  bucket chip. Filters: lifecycle, entity, date; default sort: regressed first, then
  occurrences.
- **Detail** (master-detail via the AppShell secondaryContent variant, like Servers/Scans):
  summary + rationale; metrics slice (occurrences over time — reuse the 2.2 panel component
  against the issue's runs via RunFilter); linked runs table (RunFilter deep-link "open in
  feed"); **drafted fixes** section rendering the forensics fix targets + drafted fix text with
  copy buttons; lifecycle actions (Resolve w/ note · Ignore · Reopen) via confirm tiers;
  "Analyze with Assistant" button mount (inert until 5.4 — hidden if assistant disabled).
- **Dashboard integration:** the Scans tab's "Since your last visit" pattern extends with an
  issues line ("2 new issues, 1 regressed since Jul 12") on the Testing tab header or the
  Issues tab badge (count of open+regressed); notification deep links land on the detail.

## Files

- `apps/web/src/features/issues-fleet/` (new: table, detail, sparkline, fix section) mounted
  from `features/dashboard/` tab host (naming: verify against existing `features/issues/`
  [rating IssuesPanel] — do not collide; extend it if extension is cleaner, record the choice)
- `apps/web/src/lib/api.ts` (issues calls)
- Component tests: list rendering/filtering/sorting, detail sections from fixtures, lifecycle
  action round-trip, deep-link handling

## Acceptance

- [ ] List + detail render the 5.1 fixtures fully (every field surfaced somewhere); regressed
      sorts first; sparkline honest with sparse data.
- [ ] Lifecycle actions round-trip and re-render; resolve requires the confirm tier.
- [ ] Linked-runs "open in feed" carries the exact RunFilter; notification deep link opens the
      right issue.
- [ ] AI-assisted provenance visibly marked (5.2 fixtures).
- [ ] Both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Reuse the existing rating-issues UI vocabulary where it exists (`features/issues/IssuesPanel`)
— one issues concept in the UI too (D-OB20's naming decision applies to labels).
