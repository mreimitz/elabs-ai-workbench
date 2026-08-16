# WP 5.7 — Persistence, trends & recommendations panel

**Status:** ⬜ open.
**Depends:** WP 5.3 (static results), WP 5.4 (UI), WP 5.6 (session results).

## Goal
Persist compatibility results for trend/drift over scans, and surface a deduped, actionable
recommendations panel.

## Deliverables
- `mcp_compatibility_results(id, scan_id, run_id?, model_id, subject_type, subject_id, test_id,
  verdict, score, severity, measured_json, created_at)` (additive table per `conventions.md`); a
  repository + a "recompute/persist on scan" hook (or compute-on-read + opt-in persist).
- Compatibility **drift over scans** (same server over time): band/score deltas per model, reusing
  the scan-history machinery.
- **Recommendations panel**: roll the per-cell `recommendation` fields into a ranked, deduped
  checklist (one action even when several tests share it), with the "Inspect" CTA to the offending
  tool — mirrors `apps/web/src/lib/optimize.ts` `serverRecommendations`/`groupFindings` patterns,
  now model-aware.
- Optional: user-tunable practical-tool-count thresholds (Tier-4 empirical) as a setting.

## Acceptance
- Results persist + reload; a server's compatibility drift renders across scans; the recommendations
  panel dedupes across tests. Gate green.

## References
- `roadmap/03-data-model.md`, `apps/api/src/scans/*`, `apps/web/src/lib/optimize.ts`.
