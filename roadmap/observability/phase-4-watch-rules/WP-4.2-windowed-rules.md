# WP 4.2 — Windowed rules: trailing-window thresholds + boot catch-up + historical preview

**Phase:** 4 — Watch rules · **Size:** M · **Depends on:** 4.1, 1.2 · **Model:** Opus

## Objective

Threshold alerts over time windows (D-OB19): "error rate > 30% over 6h", "cost today > $5",
"p95 active duration > 10 min", "meanScore dropped below 0.6" — evaluated by an in-process
ticker that is honest about the app not always running, and previewable against history before
saving (the LangSmith preview pattern, required UI in 4.4).

## Design

- `window_json` on `watch_rules`: `{measure, grader?, groupBy?, bucket, window: "1h"|"6h"|
  "24h"|"7d", op: ">="|"<=", threshold, cooldown}`. Measures = the 1.2 metrics vocabulary
  (single source; no new math here).
- Ticker in `apps/api/src/watch/scheduler.ts`: interval evaluation (default every 5 min) of
  enabled windowed rules via `/api/metrics/runs` internals (call the service, not HTTP);
  threshold crossing → `notify` (+ other configured actions) with dedupe per `cooldown`
  (no re-fire while continuously breached).
- **Catch-up on boot (D-OB19):** persist `last_evaluated_at` per rule; on startup evaluate the
  missed windows since then and emit late notifications flagged `late: true` ("while you were
  away"). Never fabricate continuity; a gap is a gap and is visible in the audit log.
- Historical preview: `POST /api/watch-rules/preview` — given a window config, return the
  trailing N windows with each window's value + would-have-fired flag (drives the 4.4 UI chart).
- Shutdown-safe (hook the existing shutdown module); ticker is a singleton; all timers fake-able
  in tests.

## Files

- `apps/api/src/watch/{scheduler,engine}.ts`, `apps/api/src/index.ts` + `shutdown.ts` wiring
- `apps/api/src/db/` — `last_evaluated_at` lives on `watch_rules` (part of 4.1's table; if a
  column addition is needed, this WP claims its own migration)
- `packages/shared` (preview wire — additive)
- `apps/api/test/watch-windowed.test.ts` (fake timers: fire, cooldown, boot catch-up, late flag)

## Acceptance

- [ ] Windowed rule fires on a seeded breach and not on non-breach; cooldown suppresses
      re-fires while breached; recovery re-arms.
- [ ] Boot catch-up: simulated downtime evaluates missed windows, late notifications flagged;
      audit shows the gap.
- [ ] Preview returns correct per-window values + fired flags on fixtures (matches 1.2 numbers
      exactly).
- [ ] Ticker starts/stops cleanly with the app (shutdown test); zero timers leak in tests.
- [ ] Gate green (+ migration discipline if a column claim was needed).

## Notes

Measure math must delegate to the 1.2 service — a second aggregation path is an automatic
review reject (derived-once doctrine).
