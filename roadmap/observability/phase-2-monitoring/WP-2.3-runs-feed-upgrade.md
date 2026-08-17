# WP 2.3 — Runs feed upgrade: filter bar, search, saved views, columns

**Phase:** 2 — Monitoring surfaces · **Size:** L · **Depends on:** 1.3, 1.4 · **Model:** Sonnet

## Objective

The runs feed becomes the query surface the backbone deserves: a composable filter bar bound to
RunFilter, a full-text search box with snippets, saved views, URL-persisted state (deep links
from the dashboard land here), a column chooser, and a configurable preview cell.

## Design

- Filter bar (follow `TableToolbar` + `FilterBar` patterns from `@elabs-ai/components-data`): chips per active
  RunFilter field; add-filter flow covering status/outcome/stopReasonCode/kind/model/server/
  environment/suite/skill/date/score/cost/duration/pinned/interactive/feedback. State ⇄ URL via
  the shared serialize helper — a dashboard drill-down URL must hydrate the bar exactly.
- Search box: RunFilter `q`; results show `snippet()` matches (from 1.3) in an expandable
  preview line under the row; match-kind chip (prompt/tool/error/rating).
- Saved views: dropdown (default views: All · Failures · Guardrail stops · Waiting for you (`phase: waiting_input`) ·
  Pinned — defined client-side as presets, not DB rows) + save-current / update / delete via 1.4
  CRUD; a view also restores columns + sort.
- Column chooser + preview cell: persisted per view (`columns_json`); preview cell options: last
  assistant text · stopReason · error · cost · feedback chips (the LangSmith customizable
  trace-preview idea).
- Row affordances: pin toggle (1.6), feedback chips render-only (interaction lands in 2.5).
- Suite drill-down flow (summary → member → session) preserved untouched.

## Files

- Runs feed view + components under `apps/web/src/features/testing/` (locate the actual feed
  file at claim time — Testing IA renamed surfaces; verify against the running routes)
- `apps/web/src/lib/api.ts` (filter/search/views calls), `apps/web/src/lib/table.tsx` (column
  chooser helper if generic)
- Component tests: bar↔URL round-trip, saved-view apply/save, search rendering, column chooser

## Acceptance

- [ ] Every RunFilter field settable + removable from the bar; URL round-trip byte-stable;
      dashboard drill-down links hydrate correctly (fixture link test).
- [ ] Search returns snippeted rows (fixtures); clearing `q` restores the filtered list.
- [ ] Saved views: apply/save/update/delete round-trip incl. columns + sort; presets work
      without DB rows.
- [ ] Pin toggle round-trips; pinned filter chip works.
- [ ] No regression to suite summary→member→drill navigation (existing tests pass).
- [ ] Both-theme + keyboard walk = owner-acceptance. Gate green.

## Notes

Owns the runs-feed area for its batch (do not batch with 2.4/2.5). Keep the bar generic enough
for the rules UI (4.4) to embed the same filter-builder component.
