# WP 5.5 — Scheduled digest report

**Phase:** 5 — Fleet issues · **Size:** M · **Depends on:** 5.1, 4.3 · **Model:** Sonnet

## Objective

The "since your last visit" idea, persisted and scheduled (D-OB22): a daily/weekly digest —
new/regressed issues, movers (cost/error/score by entity), notable runs — delivered as a
notification and stored as a report artifact (MD + JSON) in the reports family.

## Design

- Composer in `apps/api/src/reports/` (house pattern: JSON structure + markdown renderer, like
  `server-report-markdown.ts`): window-over-window comparison from `/api/metrics/*` services +
  the issues registry — sections: headline counts (runs, error rate Δ, cost by basis Δ),
  new/regressed/resolved issues (top 5 + link paths), movers (server/model/suite with biggest
  error-rate and cost swings), notable runs (top cost, guardrail stops), scans movers (reuse
  scan delta logic server-side or metrics/scans Δ). Honest empties ("no changes") — never
  padded.
- Scheduling: rides the 4.2 scheduler — settings: off | daily | weekly (+ hour); catch-up
  semantics inherited (a missed digest generates late, flagged). Manual
  `POST /api/reports/digest/generate?window=…` for on-demand.
- Persistence: digest rows (MIGRATION — claim next free version: `digest_reports(id, window_from,
  window_to, generated_at, late, json)`) + `GET /api/reports/digest/:id/{json,markdown}`
  endpoints matching the existing report route family; retention via maintenance prune.
- Delivery: a notification (severity info, deep link to a simple digest view — a routed
  read-only page rendering the markdown via the existing report render path, cf.
  `features/reports/`).

## Files

- `apps/api/src/reports/{digest,digest-markdown}.ts` + routes (+ tests)
- `apps/api/src/watch/scheduler.ts` (registration), `apps/api/src/db/{database,schema,rows,
  maintenance}.ts` (migration + prune)
- `packages/shared` (digest wire — additive)
- `apps/web/src/features/reports/` digest view + Settings schedule control
- Tests: composition on fixtures (incl. honest-empty), schedule + late flag, MD/JSON parity,
  prune

## Acceptance

- [ ] Digest JSON + MD generated from a seeded window match hand-computed expectations; empty
      window says so plainly.
- [ ] Scheduled + manual generation both work (fake timers); late digests flagged.
- [ ] Notification links to the rendered digest; endpoints follow the report family contract.
- [ ] Migration claimed + both paths tested; both-theme walk of the digest view =
      owner-acceptance. Gate green.

## Notes

Every number delegates to the metrics/issues services (derived-once); the composer only
arranges. Keep the markdown terse — it is a briefing, not a dashboard dump.
