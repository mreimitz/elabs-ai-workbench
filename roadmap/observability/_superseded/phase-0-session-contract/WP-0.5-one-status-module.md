# WP 0.5 — One status module (C4 vocabulary, every surface)

**Phase:** 0 — Session contract · **Size:** M · **Depends on:** 0.2 · **Model:** Sonnet

## Objective

Retire the split-brain status presentation (RunBar PHASE_LABEL vs `deriveStatusView` vs StepLog
mixing both). One derivation `(status, outcome, stopReasonCode, ratingState, lastPhase) →
{label, tone, spinner}` in `apps/web/src/lib/status.ts`, consumed by every surface (D-OB7).

## Design

- Implement the adopted C4 table verbatim: Queued (gray dashed) · Running (blue+spinner) ·
  "Waiting for you" (blue outline, no spinner) · "Reviewing…" (blue+spinner) · Completed incl.
  `session_ended` (green) · "Stopped — <reason>" from `stopReasonCode` (amber; the reason words:
  time limit / idle / turn limit / token limit / cost limit / question limit) · Context overflow
  (amber, BOTH surfaces) · "Stopped by you" (gray) · Failed (red) · Assertions failed (amber,
  both surfaces).
- `stopReasonCode` drives guardrail wording; `guardrailFromReason` string-sniffing is deleted.
  Runs without a code (pre-0.2) fall back to the humanized legacy derivation, clearly separated
  in the module.
- Adopt in: `RunBar.tsx`, runs list (`deriveStatusView` callers), `StepLog.tsx`,
  `SuiteRunConsole.tsx`, suite member rows, and the app-local `components/StatusBadge.tsx`
  (which becomes the single rendering component or is deleted if `@brand/ui` badge + module
  covers it — implementer decides, records it).
- Word/tone changes later must be one-file edits: the table is data, not scattered logic.

## Files

- `apps/web/src/lib/status.ts` (+ test)
- `apps/web/src/features/testing/RunBar.tsx`, `apps/web/src/features/testing/StepLog.tsx`,
  `apps/web/src/features/testing/SuiteRunConsole.tsx`, runs-list view(s) consuming status,
  `apps/web/src/components/StatusBadge.tsx`
- Snapshot/unit tests per surface

## Acceptance

- [ ] One table, one module: no surface derives its own label/tone for run states (grep-proof
      test for `PHASE_LABEL`/local mappings).
- [ ] `error` reads "Failed" and `aborted` reads "Stopped by you" on BOTH console and list;
      `context_overflow` amber on both; `stopped`→ same tone in suite and single-run consoles.
- [ ] `guardrailFromReason` removed; `maxRunDurationMs …` stops label correctly as "time limit"
      via `stopReasonCode`.
- [ ] Legacy runs (no code) still label sanely (fallback tested).
- [ ] Both-theme rendering unchanged in structure (visual walk = owner-acceptance).
- [ ] Gate green.

## Notes

Web-only — safe in parallel with WP 0.3 (api). Owns `lib/status.ts` + console cluster for its
batch. Do not restyle; this is a consolidation, not a redesign.
