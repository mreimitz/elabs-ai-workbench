# WP 1.1 — RunFilter grammar + structured filters on GET /api/runs

**Phase:** 1 — Backbone · **Size:** M · **Depends on:** — · **Model:** Opus
**Gate:** owner-gated — `roadmap/unified-sessions/` Wave 1 merged (consumes `stopReasonCode`, persisted `phase`, `capabilities_json`, `seen`, the duration split).

## Objective

One serializable filter object shared by the runs feed, saved views, chart drill-downs, watch
rules, and (later) the CLI — the keystone contract of the layer (concept O1.3, LangSmith's
UI ⇄ query-grammar round-trip).

## Design

- `packages/shared`: `RunFilter` type + zod schema. Fields (all optional, AND-combined):
  `status[]` (incl. the additive `ended`), `outcome[]`, `stopReasonCode[]`, `phase[]` (persisted phase, D-US1), `seen` (D-US2), `providerKind[]`, `model[]`,
  `serverId[]`, `environmentId[]` (wire name scenario), `suiteId`, `suiteRunId`, `testId[]`,
  `skillId[]`, `collectionId`, `interactiveOnly`, `pinned`, `derived` (fork lineage, default
  exclude — forward-compatible with 3.3), `scoreGte/Lte` (+ optional `grader`),
  `costUsdGte/Lte`, `tokensGte/Lte`, `durationMsGte/Lte` (active per D-US3), `dateFrom/To`,
  `feedback` (key/score presence — forward-compatible with 1.5), `q` (FTS, consumed in 1.3;
  until then rejected with a clear 400), `hasError`.
- Canonical serialization: `filter=` URL param carrying the JSON (zod-parsed), plus ergonomic
  aliases for common scalars. One helper in shared for parse/serialize so web URL state and API
  agree byte-for-byte.
- `GET /api/runs` accepts the filter + `sort`, `limit/offset`; SQL translation in the run
  repository with deliberate indexes deferred to 1.2 (note them). Unknown fields → 400 (zod).
- Suite-membership + skill joins reuse existing repository access paths; no new denormalization.

## Files

- `packages/shared/src/{types,schemas}.ts` (+ tests)
- `apps/api/src/testing/routes.ts`, `apps/api/src/testing/run-repository.ts` (+ tests)
- `apps/api/test/runs-filter.test.ts` (new)

## Acceptance

- [ ] Every filter field filters correctly against seeded fixtures (one test per field family,
      incl. combined AND semantics + date windows + score-with-grader).
- [ ] Round-trip: serialize → parse → identical object; malformed filter → 400 with zod detail.
- [ ] `q` present → clear "search not yet enabled" 400 (until 1.3 lands, then covered there).
- [ ] Existing `GET /api/runs` consumers unaffected (no filter = today's behavior, additive).
- [ ] Gate green.

## Notes

Owns `packages/shared` + `testing/routes.ts` for its batch — runs SOLO. Design for reuse: watch
rules (4.1) evaluate this same object server-side against a single run; keep the translation
layer factored so per-run predicate evaluation doesn't require SQL.
