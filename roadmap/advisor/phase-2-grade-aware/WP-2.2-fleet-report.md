# WP 2.2 — Fleet report export

**Phase:** 2 · **Size:** M · **Depends on:** 1.2 (richer with 2.1)

## Objective
An on-demand aggregate report (servers + drift, scenario costs, suite grades, posture summary when
available) exported JSON/Markdown through the existing reports family.

## Files
- `apps/api/src/reports/*` (add the fleet report), `apps/api/src/advisor/service.ts`

## Acceptance
- [ ] `GET /api/reports/fleet/{json,markdown}` renders from real persisted data, stamped
      `ADVISOR_VERSION`.
- [ ] Sections with no data say so explicitly.
- [ ] Gate green.
