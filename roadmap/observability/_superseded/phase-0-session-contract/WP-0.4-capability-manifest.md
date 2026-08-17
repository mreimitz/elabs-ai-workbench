# WP 0.4 — Capability manifest (static per kind, persisted per run)

**Phase:** 0 — Session contract · **Size:** M · **Depends on:** 0.3 · **Model:** Sonnet

## Objective

Every run carries a persisted `SessionCapabilities` manifest (D-OB6) so the UI and the metrics
layer render what a run *can do* instead of forking on `providerKind`, and replay never needs
the credential. Fix the estimated-tokens redaction bug along the way.

## Design

- New `apps/api/src/testing/session-capabilities.ts`: static table per provider kind (concept
  C3 values — engine kinds: `{liveText:true, liveReasoning:"raw", toolCalls:true,
  contextWindow:true, tokens:"exact", costBasis:"api_exact", followUps:true, askUser:true}`;
  `claude_subscription`: `{liveReasoning:"none", contextWindow:false,
  costBasis:"subscription_reference", tokens:"exact", …}`; `vendor_assistant`:
  `{toolCalls:false, tokens:"estimated", costBasis:"questions", liveReasoning:"structured",
  identity: {...}}`). Structure allows later per-model overrides without wire change.
- Run-service stamps the manifest at run start: emits the `capabilities` RunEvent (0.1) and
  persists it to a JSON column on `runs` (MIGRATION — claim next free version). Replay serves
  it from the row.
- Estimated-tokens fix: the persistence redaction heuristic that strips `estimatedTokens`
  (vendor-assistant STATUS §599-603 finding) is corrected so the flag survives — the manifest plus
  this flag replace the web's credential-based kind re-derivation (`use-run-stream.ts`).
- Backfill for existing rows: derive manifest from the run's provider kind at read time when the
  column is null (no data rewrite).

## Files

- `apps/api/src/testing/session-capabilities.ts` (new) + test
- `apps/api/src/testing/{run-service,run-repository}.ts`
- `apps/api/src/db/{database,schema,rows}.ts` (JSON column migration)
- `apps/api/test/` — stamp/persist/replay tests, redaction regression test

## Acceptance

- [ ] Every new run persists + emits a manifest matching its kind's static table (test per kind).
- [ ] Replay of a new run returns the manifest without touching credentials; pre-migration rows
      get the read-time derivation.
- [ ] `estimatedTokens` survives persistence (regression test).
- [ ] No UI change in this WP (consumers: 0.6, 1.2, 2.x, 3.2).
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Touches run-service (contested) — serialize after 0.3, before web batches. Keep the static
table boring and complete; per-model detection is explicitly out (D-OB6, hybrid rejected).
