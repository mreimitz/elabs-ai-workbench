---
type: "Work Package Spec"
title: "WP 6.12 (AM-OB13) — send this run to a webhook, by hand"
description: "A per-run and per-suite-run manual webhook send reusing the shipped watch-rule webhook configuration, so an interesting run can be pushed to a ticket or a channel without waiting for a rule to fire."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.12 (AM-OB13) — send this run to a webhook, by hand

## Verification finding

**No manual per-run send exists. One rule-scoped test-fire exists, and it deliberately sends fake
data. The webhook destination is not addressable outside a rule.**

What exists — `POST /api/watch-rules/:id/test-fire`
(`apps/api/src/watch/webhook.ts:24-46`): it looks up the rule, finds its `webhook` action, resolves the
URL via `resolveWebhookUrl(secretRef)`, posts, and records a `test_fire` audit event. **The payload is
hard-coded sample data** — `id: "sample-run"`, `link: "/testing/runs/sample-run"`, `sample: true`
(`sampleTestFireBody`, `:79-94`). Wired at `apps/api/src/index.ts:1505-1507`; client
`testFireWatchRule` (`apps/web/src/lib/api.ts:1676-1677`); the button renders only when the rule has a
webhook action (`apps/web/src/features/watch/RuleAuditDialog.tsx:63`, `:93-99`).

`postWebhook` (`apps/api/src/watch/actions.ts:173-195`) has exactly **three** call sites — the two rule
executors (`:163`, `:235`) and that test-fire (`webhook.ts:43`). The word `webhook` appears in no API
module outside `apps/api/src/watch/*` (plus wiring and DDL), and in no web feature outside
`apps/web/src/features/watch/*` (plus a Settings link to the rules page at
`SettingsView.tsx:915,922`).

**The destination is only expressible inside a rule.** There is no webhook-destination table, no
Settings destination UI, no named-channel concept. A destination is a `watch_secrets` row whose primary
key is the `secretRef` embedded in **one rule's** `actions_json`, with
`rule_id NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE`
(`apps/api/src/db/schema.ts:862-868`). Minting happens only inside `prepareActions` during rule
create/update (`apps/api/src/watch/repository.ts:239-262`); `resolveWebhookUrl` (`:229-235`) looks up
by `ref` alone, so a manual send *could* resolve a ref if it knew one — but a ref is only ever surfaced
attached to a rule, is deliberately dropped on rule duplication for security
(`apps/web/src/features/watch/rule-form.ts:117-121`), and deleting the rule deletes the destination.

**A defect this item should fix while it is here:** the existing payloads carry **bare relative
paths**, not URLs — `link: \`/testing/runs/${ctx.runId}\`` (`actions.ts:160`) and
`link: "/testing/observability/rules"` (`:232`); notifications reuse the same two paths
(`apps/api/src/watch/notifications.ts:236`, `:249`). No origin is ever prepended and there is no
`APP_BASE_URL`-style variable in play. **A webhook receiver — a Slack message, a ticket — gets a
string it cannot click.** For a rule-fired notification that is merely poor; for a manual "send this to
the ticket" it defeats the entire purpose.

Where a real link would come from: the console route `/testing/runs/:runId`
(`apps/web/src/App.tsx:1432`) which carries a Report tab (`RunConsole.tsx:135`, panel `:1033`), the
suite-run console `/testing/suite-runs/:suiteRunId` (`App.tsx:1438`), and the machine-readable report
endpoints `GET /api/reports/run/:id/{json,markdown}` (`apps/api/src/reports/routes.ts:164`, `:169`)
and `GET /api/reports/suite-run/:id/{json,markdown}` (`:182`, `:195`).

**Verdict: NOT BUILT.**

## Goal

Afterwards an operator looking at an interesting run — a failure worth a ticket, a result worth showing
someone — can push it to their webhook from the console in one action, and what lands on the other end
contains a link that actually opens the run. Today the only way to get a run out of the bench is to
copy the URL out of the address bar by hand.

## Scope

- **`POST /api/runs/:id/send-to-webhook`** and **`POST /api/suite-runs/:id/send-to-webhook`**, each
  taking the destination (see below) and posting a **real** payload for that run — the same
  `WatchRunSummaryView` shape the rule path builds (`actions.ts:20-30`), never
  `sampleTestFireBody`'s fake row. Reuse `postWebhook` (`actions.ts:173-195`) unchanged: one attempt,
  the 10 s `WATCH_WEBHOOK_TIMEOUT_MS` bound, the same scrubbed errors, the same "the URL never enters a
  result" discipline.
- **Destination: reuse a rule's, do not build a registry.** The recommended shape is a picker of
  existing rules that have a webhook action — "send using <rule name>'s webhook". That needs **no new
  table, no new migration and no new secret path**, and it keeps every destination URL inside the one
  encrypted store that already has a lifecycle (rotate on rule update, cascade-delete on rule delete).
  A standalone destination table is the alternative; it is more work, needs a migration, and duplicates
  the secret lifecycle. **Record whichever is chosen in the decision log.**
  ⚠ If the picker route is taken, note that `watch_secrets.rule_id` cascades — sending "via rule X"
  breaks silently when rule X is deleted, so the failure must read as "that destination no longer
  exists", not as a generic post failure.
- **Fix the link.** Introduce one place that turns an app path into an absolute URL for outbound
  payloads, and route the manual send **and** the two existing rule payloads (`actions.ts:160`, `:232`)
  and the two notification links (`notifications.ts:236`, `:249`) through it, so there is one answer to
  "what URL do we tell the outside world". The origin has to come from configuration; the app has no
  such variable today, so **adding one is part of this WP** — with an honest fallback that keeps
  emitting the relative path rather than fabricating a wrong origin.
- **Include the report link** alongside the console link, since "attach this to a ticket" usually means
  the report: `GET /api/reports/run/:id/markdown` is the artifact a human reads.
- **UI:** an action in the run console's bar (beside the shipped Promote-to-test menu at
  `RunBar.tsx:479`) and its suite-run equivalent, opening a small dialog — destination picker, a
  preview of what will be sent, send. This is a transient task with a start and an end, so it is a
  **dialog, not a route** (`.claude/rules/routes-vs-dialogs.md`).
- **Audit it.** Record the send as an event the way `test_fire` is recorded
  (`rules.recordEvent(id, undefined, "test_fire", result)` — `webhook.ts:41`, `:44`), so "did this go
  out, and did it succeed" is answerable after the fact.

## Files

Add:

- `apps/api/src/watch/manual-send.ts`
- `apps/api/test/watch-manual-send.test.ts`
- `apps/web/src/features/watch/SendToWebhookDialog.tsx`
- `apps/web/src/features/watch/SendToWebhookDialog.test.tsx`
- an outbound-link helper beside the webhook code (one file, one function)

Modify:

- `apps/api/src/watch/actions.ts` (route the two existing `link` values through the helper)
- `apps/api/src/watch/notifications.ts` (same, for `:236` and `:249`)
- `apps/api/src/watch/repository.ts` (only if a destination lookup by rule is added)
- `apps/api/src/index.ts` (route registration)
- `apps/api/src/config/env.ts` + `.env.example` (the base-URL variable)
- `apps/web/src/features/testing/RunBar.tsx` — ⚠ **contended with AM-OB2**, which also adds to this bar
- `apps/web/src/lib/api.ts`
- the suite-run console's action bar
- `apps/api/test/watch-rules.test.ts` (link-shape assertions move)

Untouched on purpose: `apps/api/src/db/**` on the recommended path, `packages/shared/src/constants.ts`
(no new vocabulary).

## Non-goals

- **No webhook destination registry, no named channels, no per-destination settings UI** on the
  recommended path.
- No request signing and no retry — this reuses `postWebhook`'s existing semantics deliberately. Adding
  signing is a real improvement but it belongs to the whole webhook channel, not to this one caller,
  and doing it here would give two callers different guarantees.
- No new integration (no Slack-specific formatting, no ticket-system API). It posts JSON to a URL.
- No bulk send, no send-from-the-feed for a selection. One run, or one suite run, at a time.
- No change to `sampleTestFireBody` — the rule test-fire keeps sending sample data on purpose, because
  its job is to prove the plumbing without implying real data was shared.

## Dependencies

- Depends on shipped WP 4.3 (the webhook channel, its encrypted `watch_secrets` store and
  `postWebhook`) — done.
- ⚠ Shares `apps/web/src/features/testing/RunBar.tsx` with **AM-OB2** (which adds the corrected-answer
  affordance there). Do not batch those two.
- No dependency on another Phase 6 item's output. This is the smallest genuinely-unbuilt item in the
  phase — the amendment calls it "day-scale" and that reads as accurate.

## Migration

**None** on the recommended path — it reuses the existing `watch_secrets` rows through the existing
`resolveWebhookUrl`. `apps/api/src/db/{database,schema}.ts` must be a zero-line diff and no
`user_version` is claimed.

⚠ Choosing a standalone destination table instead **does** need a migration, and would make this a
migration-bearing WP that cannot run alongside AM-OB6. That is the main reason to prefer the picker.

## Acceptance

1. `POST /api/runs/:id/send-to-webhook` posts a payload describing **that run** — not
   `sampleTestFireBody`'s `"sample-run"` — and the suite-run endpoint does the same for a suite run.
2. The payload's links are **absolute and openable** when a base URL is configured, and fall back to
   today's relative path when it is not — never a fabricated origin. Asserted by tests for both states.
3. The two existing rule payloads (`actions.ts:160`, `:232`) and the two notification links
   (`notifications.ts:236`, `:249`) go through the **same** helper — pinned by a source-walk test so a
   second link-building path cannot reappear.
4. The webhook URL never appears in a response, an error, a log line or an audit row — the existing
   `scrub()` discipline (`actions.ts:257-259`) is preserved, asserted by seeding a recognisable URL and
   grepping every returned and persisted surface.
5. A destination whose backing rule has been deleted produces a readable "that destination no longer
   exists" error, not a generic failure.
6. Every send is recorded as an audit event with its outcome, visible where `test_fire` events are
   visible.
7. The console action opens a **dialog** (not a route), previews what will be sent, and is reachable by
   keyboard with a visible focus ring; the icon affordance's tooltip text equals its `aria-label`
   (D-TB5).
8. No test performs a real outbound request — the receiver is a local stub (conventions §12).
9. No `user_version` claimed on the recommended path; `apps/api/src/db/**` a zero-line diff.
10. Both themes and a keyboard pass over the new action and dialog — or recorded as an owner-acceptance
    line rather than claimed. A live send to a real endpoint is **owner-acceptance**.
11. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
