---
type: "Work Package Spec"
title: "WP 5.4 \u2014 Assistant issue loop: analyze \u2192 fix draft \u2192 regression test \u2192 watch"
description: "Phase: 5 \u2014 Fleet issues \u00b7 Size: M \u00b7 Depends on: 5.3, 3.3, 4.1 \u00b7 Model: Opus"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.4 — Assistant issue loop: analyze → fix draft → regression test → watch

**Phase:** 5 — Fleet issues · **Size:** M · **Depends on:** 5.3, 3.3, 4.1 · **Model:** Opus

## Objective

Close the loop LangSmith Engine only points at (D-OB20, owner-initiated only): from an issue,
hand the Assistant everything it needs to draft the fix (via the existing approval-gated write
protocol), propose the regression test, prove it with a fork re-run, and leave the issue
watching for recurrence.

## Design

- **"Analyze with Assistant"** (5.3's button): opens the existing dock with an issue context
  envelope — issue summary, cluster key parts, top linked-run ids, forensics fix targets +
  drafted fixes, affected skill/server ids. Follows the established page-hook pattern
  (`assistant/context-envelope.ts` + starters); a new starter template "triage this issue".
- **New assistant read tools** (extend the read-tool registry): `issues.get`, `issues.list`,
  `issues.linkedRuns` — read-only, same registration pattern as the existing 23.
- **Write paths reuse what exists, unchanged:** skill edits go through the materialized
  workspace → approval → new immutable version (D-AS4); MCP-server config changes remain
  suggestions in chat (no new write tool). One new gated write tool:
  `issues.update` (lifecycle/note) and `tests.createDraft` (the 4.1 promote-to-test path,
  parameterized) — both approval-gated like other writes.
- **Prove-it flow:** the assistant proposes: draft regression test (via `tests.createDraft`
  into a chosen collection) and/or a fork re-run of a linked run with the fixed skill version
  (calls the 3.3 rerun endpoint via a gated action tool). Results land as normal runs; the
  issue detail shows "verification runs" (link issue↔run with a `verification` mark on the
  link table).
- **Watch:** nothing new to build — 5.1's auto-reopen IS the watch; the WP verifies the loop
  end-to-end in tests (fix merged → sweep clean → later recurrence reopens + notifies).

## Files

- `apps/api/src/assistant/{context-envelope,starters}.ts`, `apps/api/src/assistant/tools/`
  (new read + gated write/action tools, registry wiring)
- `apps/api/src/grading/issue-*` (verification-run link mark)
- `apps/web/src/features/issues-fleet/` (button wiring, verification-runs section),
  assistant dock starter surface
- Tests: envelope content, tool registration + permission classification (write tools gated),
  createDraft/rerun tool paths against stubbed services, verification link rendering,
  end-to-end reopen scenario (stubbed)

## Acceptance

- [ ] Button opens the dock with the documented envelope (fixture assert); starter present.
- [ ] New read tools return registry data; write/action tools classified as gated (permission
      classifier tests) and execute only on approval — D-AS4 protocol untouched.
- [ ] Draft test + fork verification flow works against stubs; verification runs render on the
      issue.
- [ ] Regression scenario: resolved issue + recurring cluster key ⇒ regressed + notification
      (integration test with 5.1).
- [ ] Gate green.

## Notes

**Owner-gated for live validation** (real assistant sign-in + a real fix walk) — listed under
owner-acceptance. Scope discipline: no scheduled/unattended analysis (D-OB20); if the owner
later wants the watchtower, that is a new decision, not scope creep here.
