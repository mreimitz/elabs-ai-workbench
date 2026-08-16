# WP 4.3 — Notification center + webhook channel

**Phase:** 4 — Watch rules · **Size:** M · **Depends on:** 4.1 · **Model:** Sonnet

## Objective

Where rule/alert output lands (D-OB19): a persistent in-app notification center (bell in the
app shell, SSE-pushed, deep-linking) and the one external channel — a generic webhook with
secret-store URL, templated JSON, and a test-fire button.

## Design

- MIGRATION (claim next free version): `notifications(id, at, severity, title, body,
  link_path NULL, rule_id NULL, run_id NULL, read INTEGER DEFAULT 0, late INTEGER DEFAULT 0)`.
- API: `GET /api/notifications` (filter unread/severity/date, paged), `POST .../:id/read`,
  `POST .../read-all`, retention (prune read > N days via maintenance). A lightweight SSE feed
  (`GET /api/notifications/stream`) or piggyback on an existing app-level stream — implementer
  verifies what exists and documents the choice.
- The 4.1 `notify` action writes here (unblock the inert seam); severities `info|warning|
  critical`; `link_path` carries an app route (a RunFilter deep link, a run console, an issue).
- Webhook channel: config UI stores the URL via the existing secret store; payload = templated
  JSON body + always-appended fields (rule id/name, metric value + threshold when windowed,
  run id when on-terminal, timestamp, late flag); `POST /api/watch-rules/:id/test-fire` sends a
  sample payload.
- Bell UI in the AppShell header: unread count badge, popover list (severity tone, relative
  time, "while you were away" chip for `late`), click → deep link + mark read; "mark all read".
  Follows brand-ui popover/badge patterns; both themes.

## Files

- `apps/api/src/watch/{notifications,webhook}.ts` + routes (+ tests incl. local receiver)
- `apps/api/src/db/{database,schema,rows,maintenance}.ts` (migration + prune)
- `packages/shared/src/{types,schemas}.ts`
- `apps/web/src/components/AppShell.tsx` (bell mount) + `features/notifications/` popover
  (+ tests), `apps/web/src/lib/api.ts`

## Acceptance

- [ ] notify action → persisted notification → appears in the bell (stubbed stream) with
      correct severity/tone/link; read state round-trips; read-all works.
- [ ] Late notifications render the away chip.
- [ ] Webhook: secret never leaves the API; test-fire hits the local receiver with the
      documented payload; failures audited, never thrown into the caller.
- [ ] Prune policy removes only read+old rows.
- [ ] Migration claimed + both paths tested; both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Migration-bearing — serialize. Keep the bell quiet: no toasts for `info`, badge only
(conventions §11).
