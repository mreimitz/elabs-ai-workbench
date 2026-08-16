# WP 0.6 — Console session affordances (End session · queued/waiting · budget + Extend)

**Phase:** 0 — Session contract · **Size:** M · **Depends on:** 0.3, 0.5 · **Model:** Sonnet

## Objective

Make the new lifecycle visible and drivable from the run console: interactive sessions can END
successfully, queued/waiting states read honestly, the time budget is never a surprise, and the
deadline warning offers one-click extension (concept C1/C2 UI).

## Design

- **End session** button (interactive runs, all kinds, gated on `capabilities.followUps`):
  calls the finalize path from 0.2/0.3 → terminal `completed`/`session_ended`; confirm dialog
  (existing dialog tiers); disabled with reason for suite members.
- **Budget display**: RunBar shows `elapsed / budget` (active time per D-OB5; wall in tooltip);
  "no limit" renders plainly. Data from the run detail + kpi events.
- **Deadline countdown chip**: on `phase: deadline_warning`, a countdown chip with one-click
  **"+15 min"** calling `POST /api/runs/:id/extend`; extension confirmations appear in the step
  log (the audited `context_event` from 0.3 renders like other context events).
- **Queued/waiting presentation**: RunBar + composer area render `queued` (with position detail
  when present) and `waiting_input` ("Waiting for you") from the status module (0.5); the
  QuestionPrompt/composer gating moves to `capabilities.followUps`/`askUser` (fixes the known
  gating drift between QuestionPrompt and ConversationPane).
- Live + replay: all affordances degrade correctly in replay (buttons hidden, phases render
  from history).

## Files

- `apps/web/src/features/testing/RunBar.tsx`, `RunConsole.tsx`, `Composer.tsx`,
  `QuestionPrompt` (its file), `ConversationPane.tsx` (gating only), `StepLog.tsx`
  (context_event rendering if needed)
- `apps/web/src/lib/api.ts` (extend + end-session calls)
- Component tests per affordance (fake stream states)

## Acceptance

- [ ] End session on a live interactive run (stubbed stream) finalizes and the console + list
      both read "Completed" (status module).
- [ ] Budget renders `mm:ss / mm:ss`, updates live, honest about "no limit".
- [ ] `deadline_warning` → countdown chip → Extend calls the API, chip updates, audit event
      visible; suite-member run shows no Extend.
- [ ] Queued and waiting_input states render per C4 on RunBar and composer; QuestionPrompt gates
      on capabilities, not kind.
- [ ] Replay renders phases historically; no live-only affordance leaks into replay.
- [ ] Both-theme + keyboard = owner-acceptance (listed in STATUS). Gate green.

## Notes

Owns the console cluster for its batch (parallel with 0.4 API work is fine). Uses only
capabilities + phase/status wire — zero `providerKind` checks may be added (D-OB6).
