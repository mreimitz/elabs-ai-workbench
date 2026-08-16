# WP 1.7 — SSE cursor resume + ping event + client staleness watchdog

**Phase:** 1 — Backbone · **Size:** M · **Depends on:** 0.2 · **Model:** Opus

## Objective

Long sessions get robust streams (concept C5 / D-OB9): reconnects resume from a cursor instead
of re-shipping the world, late joiners past the 2000-event buffer get history from persistence,
and a silently dead socket is detected client-side.

## Design

- Server (`GET /api/runs/:id/stream`): set `id: <seq>` on every event; honor `Last-Event-ID` by
  replaying from that cursor — from the in-memory buffer when available, else from persisted
  `run_events` (the cursor predates the buffer), then continue live. Replace the `: ping`
  comment with an additive real event `{type:"ping", at}` every ~20 s (`ping` joins the
  RunEvent union — coordinate the one-line shared addition).
- Client (`use-run-stream.ts`, `lib/api.ts`): keep `seq` dedupe (now redundant but harmless);
  staleness watchdog — nothing received (including pings) for ~45 s → surface the existing
  "connection lost" banner proactively and force a reconnect (which now resumes by cursor).
- Suite consoles use the same stream plumbing — verify, don't fork.

## Files

- `apps/api/src/testing/routes.ts` (stream route), `apps/api/src/testing/run-manager.ts`
- `packages/shared/src/types.ts` (+schema) — `ping` event member (additive)
- `apps/web/src/features/testing/use-run-stream.ts`, `apps/web/src/lib/api.ts`
- Tests: server replay-from-cursor (buffer + DB paths), ping cadence, client watchdog
  (fake timers), dedupe unchanged

## Acceptance

- [ ] Reconnect with `Last-Event-ID` inside the buffer replays only the gap; cursor older than
      the buffer falls back to persisted events with no loss/duplication (seq-continuity test).
- [ ] Late join on a >2000-event run receives full history.
- [ ] Ping events flow; client banner fires at ~45 s of silence and recovers on resume.
- [ ] Replay-after-finish path unchanged.
- [ ] Gate green.

## Notes

Touches `testing/routes.ts` + `packages/shared` — never batch with 1.1 or 1.6. Do not change
the buffer size or persistence format; this WP is transport robustness only.
