# WP 1.2 — Metrics endpoints: /api/metrics/runs + /api/metrics/scans

**Phase:** 1 — Backbone · **Size:** L · **Depends on:** 1.1 · **Model:** Opus

## Objective

The time axis, at last: time-bucketed, group-able aggregates over runs and scans, computed on
demand (D-OB13), honest about mixed capabilities (D-OB14), consumed by the dashboard (2.2),
windowed rules (4.2), and issues (5.1).

## Design

- New `apps/api/src/observability/` feature module (`metrics.ts` + `routes.ts`), wired in
  `index.ts`. Endpoints:
  - `GET /api/metrics/runs?filter=<RunFilter>&from&to&bucket=hour|day|week&groupBy=model|
    provider|providerKind|server|environment|suite|test|skill|stopReasonCode&measures=…`
    Measures: `count`, `errorRate`, `guardrailRate`, `p50DurationMs`, `p95DurationMs`
    (active per D-US3's split, `activeDurationMs ?? totalDurationMs` fallback marked), `tokensIn`,
    `tokensOut`, `costUsd`, `questions`, `meanScore` (+optional `grader`), `feedbackRate`
    (null until 1.5 rows exist).
  - `GET /api/metrics/scans?...` — per-server footprint over time: `totalTokens`,
    tools/resources/prompts counts + token splits, scan `failureRate`, Δ vs previous.
- Capability classes read from the persisted `capabilities_json` (unified-sessions Wave 1).
- **Capability honesty (D-OB14):** token/cost measures return one series per
  `tokens`/`costBasis` class (`exact`, `estimated`, `questions`, `subscription_reference`),
  each labelled; the API never sums across classes. Empty slices omitted, never zero-filled.
- **Score selection** delegates to the existing `selectRunScore`/`PRIMARY_GRADER_PRIORITY`
  (import from suites analytics or extract shared helper — record which).
- Percentiles via SQL window functions or in-process over the bucket's rows (implementer
  measures both; document choice).
- MIGRATION (claim next free version): covering indexes for the hot predicates
  (`runs(created_at)`, `runs(status, created_at)`, provider/server/suite lookup columns as they
  exist — derive from the actual schema). No data change.
- Perf harness: seed script generating 50k synthetic runs (test-only, in-memory or temp DB);
  acceptance asserts p95 endpoint latency < 500 ms for a 30-day day-bucket grouped query.

## Files

- `apps/api/src/observability/{metrics,routes}.ts` (new) + `apps/api/src/index.ts`
- `packages/shared/src/{types,schemas}.ts` (response shapes — additive)
- `apps/api/src/db/database.ts` (index migration)
- `apps/api/test/metrics-runs.test.ts`, `metrics-scans.test.ts`, `metrics-perf.test.ts`

## Acceptance

- [ ] Bucketing, groupBy, every measure, and RunFilter composition each covered by fixture tests
      (incl. timezone-safe day buckets — document the bucketing timezone: UTC).
- [ ] Capability split verified: a mixed fixture (API + CLI + qlik runs) yields separate labelled
      series; no blended token/cost sum anywhere in the response.
- [ ] `meanScore` equals the suite-analytics selection on the same fixture.
- [ ] Perf test green at 50k runs; indexes claimed via migration + both paths tested.
- [ ] Numbers recomputable: repeated calls identical; no caching layer introduced.
- [ ] Gate green.

## Notes

If the perf target fails after honest index work, STOP: the owner-gated rollup-cache fallback
(D-OB13) becomes a new WP; do not build it preemptively.
