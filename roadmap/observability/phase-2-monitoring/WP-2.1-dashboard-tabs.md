# WP 2.1 — Dashboard → tabs restructure (Scans | Testing)

**Phase:** 2 — Monitoring surfaces · **Size:** M · **Depends on:** 1.2 · **Model:** Sonnet

## Objective

The Dashboard becomes the observability home (D-OB11) without losing what it does today: the
current scan-centric content moves intact under a **Scans** tab; a **Testing** tab shell (filled
by 2.2) appears beside it. Nav stays 4 items. The **Issues** tab arrives in 5.3 — leave a
commented mount point, render nothing.

## Design

- Tabs via the established `TabPanel` grammar + `ScrollableTabsList`; deep-linkable
  (`/?tab=testing` or route segment — follow the existing routed-tabs pattern used elsewhere;
  record the choice). Default tab: Scans (today's behavior preserved for muscle memory).
- `DashboardView.tsx` content (since-last-visit, needs-attention, movers, KPI grid, tables)
  moves verbatim into the Scans tab (extract to `features/dashboard/ScansTab.tsx`); no visual
  redesign in this WP.
- Testing tab: `TestingTab.tsx` shell — PageShell-consistent frame, date-range + filter-bar
  placeholder region, `TabEmptyState` while 2.2 is unbuilt.
- Breadcrumb/H1 semantics preserved (D-TB1 sr-only heading pattern).

## Files

- `apps/web/src/features/dashboard/DashboardView.tsx` (becomes the tab host),
  `apps/web/src/features/dashboard/{ScansTab,TestingTab}.tsx` (new)
- `apps/web/src/App.tsx` (route/tab wiring if routed tabs)
- Existing dashboard tests updated + tab smoke tests

## Acceptance

- [ ] Scans tab renders today's dashboard byte-equivalently (existing tests pass against it).
- [ ] Tabs deep-linkable + restore on reload; keyboard tab-strip behavior per TabPanel contract.
- [ ] Testing tab shell renders its empty state; no dead controls.
- [ ] Both-theme walk = owner-acceptance. Gate green.

## Notes

Pure restructure — resist improving the scan cards here. Owns the dashboard feature folder for
its batch.
