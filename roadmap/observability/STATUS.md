# observability — work-package status ledger

Living state for the observability plan, read and updated by the `next-wp` skill (and the
`/next-wp` command). It picks the next open WPs whose dependencies are done, runs them with
parallel worktree sub-agents, and ticks a box only when that WP's Acceptance is met and the
quality gate is green.

**Legend:** `[ ]` open · `[x]` done. A trailing `status:` note marks `in progress` / `in review`.
Done lines record the date + branch: `… — done YYYY-MM-DD · wp/observability/<id>`.

⚠️ **Workstream gate (D-OB27/28):** [`roadmap/unified-sessions/`](../unified-sessions/STATUS.md)
Waves 1–3 run FIRST. WPs marked `owner-gated: unified-sessions Wave N merged` stay blocked until
the owner confirms that merge. Un-gated WPs (2.6) may run in the window if the repo is free.

⚠️ **Batching rules (bind the orchestrator):** exactly one migration-bearing WP in flight at a
time (1.2, 1.3, 1.4, 1.5, 1.6, 2.6, 2.7, 3.1, 3.3, 4.1, 4.3, 5.1); never batch two WPs whose
Files sections overlap (`packages/shared`, `testing/run-service.ts` + executors,
`db/database.ts`/`schema.ts`, the run-console component cluster are the known contested
surfaces). See `kickoff-prompt.md` for the cross-session contention override.

## Phase 1 — Backbone
- [x] WP 1.1 — RunFilter grammar + GET /api/runs filters — done 2026-07-16 · wp/observability/1.1
- [x] WP 1.2 — Metrics endpoints (runs + scans) + indexes — done 2026-07-16 · wp/observability/1.2
- [x] WP 1.3 — FTS5 search index + q= + reindex — done 2026-07-17 · wp/observability/1.3
- [x] WP 1.4 — Saved views CRUD — done 2026-07-17 · wp/observability/1.4
- [x] WP 1.5 — Feedback primitive (run_feedback) — done 2026-07-17 · wp/observability/1.5
- [x] WP 1.6 — Retention classes (pinned + prune) — done 2026-07-17 · wp/observability/1.6

## Phase 2 — Monitoring surfaces
- [x] WP 2.1 — Dashboard tabs restructure — done 2026-07-17 · wp/observability/2.1
- [x] WP 2.2 — Testing dashboard prebuilt panels + drill-down — done 2026-07-17 · wp/observability/2.2
- [x] WP 2.3 — Runs feed upgrade (filters, search, views, columns) — done 2026-07-17 · wp/observability/2.3
- [x] WP 2.4 — Sessions lens — done 2026-07-17 · wp/observability/2.4
- [x] WP 2.5 — Feedback UI (console + feed) — done 2026-07-17 · wp/observability/2.5
- [x] WP 2.6 — Pricing editor (DB + Settings UI) — done 2026-07-17 · wp/observability/2.6
- [x] WP 2.7 — Custom chart composer — done 2026-07-17 · wp/observability/2.7

## Phase 3 — Console depth
- [x] ⛩ gate LIFTED (unified-sessions Waves 1–5 merged, owner-confirmed) — 3.1/3.3/2.4 unblocked
- [x] WP 3.1 — parentStepId + spanKind + emitters — done 2026-07-17 · wp/observability/3.1 (probe emitter deferred — see log)
- [x] WP 3.2 — Tree StepLog + nested Gantt + per-step economics — done 2026-07-17 · wp/observability/3.2
- [x] WP 3.3 — Fork-from-step (rerun + lineage + Compare pre-seed) — done 2026-07-17 · wp/observability/3.3
- [x] WP 3.4 — In-run search + lenses — done 2026-07-17 · wp/observability/3.4

## Phase 4 — Watch rules
- [x] WP 4.1 — Rules engine core (on-terminal + actions) — done 2026-07-17 · wp/observability/4.1
- [x] WP 4.2 — Windowed rules + boot catch-up + historical preview — done 2026-07-17 · wp/observability/4.2
- [x] WP 4.3 — Notification center + webhook channel — done 2026-07-17 · wp/observability/4.3
- [x] WP 4.4 — Rules UI + promote-to-test button — done 2026-07-17 · wp/observability/4.4 (⚠ promote endpoint follow-up — see log)
- [x] WP 4.5 — Review queue lite — done 2026-07-17 · wp/observability/4.5

## Phase 5 — Fleet issues
- [x] WP 5.1 — Issue aggregation (registry extension + deterministic clustering) — done 2026-07-17 · wp/observability/5.1
- [x] WP 5.2 — LLM assist for clustering — done 2026-07-17 · wp/observability/5.2 (live=owner-acceptance)
- [x] WP 5.3 — Issues tab UI — done 2026-07-17 · wp/observability/5.3
- [x] WP 5.4 — Assistant issue loop — done 2026-07-17 · wp/observability/5.4 (live=owner-acceptance)
- [x] WP 5.5 — Scheduled digest report — done 2026-07-17 · wp/observability/5.5

## Decision log

- 2026-07-16 — Plan created from `research/langsmith-observability/` +
  `research/unified-run-sessions/`; owner locked D-OB1–D-OB26 (see README). Migration claims:
  none yet (verify next free `user_version` at first claim — check `db/database.ts` AND sibling
  ledgers incl. `roadmap/unified-sessions/`).
- 2026-07-16 — **Reconciliation (D-OB27/28):** a parallel owner session locked the session
  contract as `roadmap/unified-sessions/` (D-US1–15). Owner ruled D-US wins wholesale; Phase 0
  (WP 0.1–0.6) + WP 1.7 dropped from this plan — specs preserved in `_superseded/`. Gated WPs
  now reference unified-sessions waves; unified-sessions runs first.
- 2026-07-16 — **Batch 1 orchestration start.** Only **WP 2.6** eligible; every ⛩ WP gated on
  `roadmap/unified-sessions/` Wave 1, which has **not started** (no `feat/unified-sessions` branch;
  its STATUS shows no implementation). Migration head verified at **v30** in `db/database.ts`
  (v29 = `runs.cost_basis`, v30 = rating-issue occurrence evidence) — conventions §8's
  "v28 expected first" is **stale**; next free `user_version` is **v31**. Owner decisions
  (2026-07-16): **(a)** `user_version` **v31 reserved for WP 2.6**; unified-sessions Wave 1 takes
  **v32+**. **(b)** WP 2.6 is **HELD, not claimed** — a concurrent session is active on the
  contested surfaces it needs (`packages/shared`, `apps/api/src/db/{database,schema}.ts`). **No WP
  spawned this batch; nothing ticked.** WP 2.6 unblocks when that session clears those files; the
  ⛩ WPs unblock when the owner confirms unified-sessions Wave 1 merged.
- 2026-07-16 — **Recheck (migration conflict — CORRECTS the v31 reservation above).**
  `feat/unified-sessions-wp1.6` has committed **`version: 31`** ("v31 — Unified Sessions … WP1.6,
  D-US1/D-US2"; a `runs` table rebuild for session-lifecycle columns) on its branch. Per D-OB27/28
  (unified-sessions wins wholesale / runs first), **unified-sessions keeps v31**; **WP 2.6 now
  claims the next free `user_version` after unified-sessions Wave 1 merges (≥ v32, re-verified at
  spawn)**. `main` remains at v30 (unified-sessions not yet merged). WP 2.6 **still HELD** — the
  session is actively writing 2.6's contested surfaces (`packages/shared`, `db/{database,schema}.ts`;
  commits 3–5 min ago). **Owner confirmed (2026-07-16): 2.6 takes next free (≥ v32); v31 stays
  with unified-sessions.**
- 2026-07-16 — **⛩ GATE LIFTED.** Owner confirmed unified-sessions fully done; verified merged to
  `main` @ `d0f37c1` (Waves 1–5 incl. WP5.1 "full gate + seeded acceptance"). Migration head on
  main = **v31** (session-lifecycle); session-contract modules (`session-terminal.ts`,
  `session-capabilities.ts`, `session-contract.test.ts`) present. `pnpm typecheck` green on main
  (fork-base sanity). **Batch 1 = WP 1.1 (RunFilter grammar) SOLO** per the recommended build
  order — no migration (indexes deferred to 1.2); owns `packages/shared` + `testing/routes.ts` so
  it runs alone. WP 2.6 deferred to a later batch (would share `packages/shared`; next-free
  migration for it is **v32**). Spawned as an Opus worktree sub-agent.
- 2026-07-16 — **WP 1.1 MERGED to main** (`38d73eb`, merge of `wp/observability/1.1` @ `91784d9`;
  base `d0f37c1`, main unmoved so no rebase). Gate independently re-verified green in the worktree
  (typecheck · lint 860 files · test shared 48/api 2058/web 1068 · build) and typecheck re-run
  green on main post-merge. Surface: `packages/shared/{types,schemas,constants,index,run-filter,
  run-filter.test}.ts` + `apps/api/src/testing/{routes,run-repository}.ts` +
  `apps/api/test/runs-filter.test.ts`. **Wire additive-only confirmed** (zero deletions in shared
  wire; only a LOCAL repo type `RunFilter`→`ListRunsFilter` rename + Biome reflow). **No migration**
  (db files untouched). Accepted deviations: (a) grammar field is `scenarioId[]` not
  `environmentId[]` — honors the frozen scenario wire (D-T rename is UI-label only); (b) one
  additive export line in `shared/src/index.ts`; (c) `pinned`/`derived`/`feedback` are
  forward-compatible placeholders (no backing column yet — `pinned:true` matches nothing);
  (d) `hasError` SQL made NULL-safe. **Design-for-reuse:** pure `matchesRunFilter(run, filter)` in
  shared (no SQL) for the WP 4.1 watch-rule per-run path, cross-checked against the SQL builder by
  test. **→ WP 1.2 handoff:** deferred indexes noted in-code on `queryRuns` — `runs(started_at)`,
  `runs(status)`, `run_skills(skill_id)`, `run_grades(run_id,grader_id,created_at)`,
  `scenario_servers(server_id)` (+ `runs(scenario_id)`/`runs(suite_run_id,started_at)` already
  exist); and when WP 3.3 adds `derived_from_run_id`, the default-exclude branch must add
  `derived_from_run_id IS NULL`.
- 2026-07-16 — **WP 1.2 MERGED to main** (`904f855`, merge of `wp/observability/1.2` @ `491cbf5`;
  base `2ca1ac8`, main unmoved so no rebase). **Migration `user_version` v32 CLAIMED by WP 1.2**
  (index-only: `idx_runs_started_at`, `idx_runs_status_started`, `idx_mcp_scans_scanned_at` — added
  to BOTH `schema.ts` baseline and a v32 `up`; fresh + upgrade-from-v31 paths both tested green).
  ⇒ **Migration head is now v32; WP 2.6 will claim the next free (v33) when it runs** (supersedes
  the earlier "v32 reserved for 2.6"). Gate independently re-verified green in the worktree
  (typecheck · lint 865 · test api 2077/web 1068 · build) + typecheck green on main post-merge.
  **D-OB14 honesty test-enforced** (capability-split token/cost series; HONESTY GUARD forbids a
  null/blended class). **Perf:** p95 ≈ 326 ms (under orchestrator load; agent measured ≈ 62 ms
  isolated) for the 30-day day-bucket `groupBy=model` query @ 50k synthetic runs — under the 500 ms
  budget; no cache/rollup introduced (STOP condition not hit). `meanScore` parity with suite
  analytics proven by test. Version-lock literal bumps 31→32 in 6 existing tests (migrations +
  benchmarks-{contract,collections,suites} + rating-issues + skill-ide-server-binding) —
  mechanical, no assertion weakened. **Known duplication (flag for later consolidation):**
  `buildRunFilterWhere` is REPLICATED in `observability/metrics.ts` (the WP boundary forbade editing
  the module-private original in `run-repository.ts`; `shared` holds no SQL) — kept honest by a
  cross-check test against the shared `matchesRunFilter` predicate. A future WP (or the CI/`mcpfp`
  grammar reuse, D-OB25) should extract the SQL builder to `shared` so both consumers share one copy.
  **Interpreted measure semantics** (documented in-code): `questions` = Σ `runs.turns` over
  question-billed runs; `guardrailRate` = `outcome='stopped_guardrail'`; `errorRate` mirrors
  `hasError`; percentiles = in-process nearest-rank (UTC day buckets). Real-hardware perf is an
  owner-acceptance item.
- 2026-07-17 — **Batch 3 opened (first parallel batch): WP 1.3 (FTS5) ∥ WP 2.1 (dashboard tabs).**
  FTS5 preflight cleared by the orchestrator (`ENABLE_FTS5` in the bundled better-sqlite3; MATCH +
  snippet() verified) so 1.3 did not trip the STOP-and-ask. **WP 2.1 MERGED to main** (`1b62d13`,
  merge of `wp/observability/2.1` @ `1fe7518`; base `6637981`, main unmoved so no rebase).
  Web-only — all changes under `apps/web/src/features/dashboard/` (DashboardView→tab host +
  ScansTab/TestingTab + 3 test files, 25 tests); `App.tsx` untouched (`/dashboard` route was
  pre-registered). Gate re-verified green in the worktree (typecheck · lint 870 · test web
  1083/api 2077 · build) + typecheck green on main post-merge. Deep-link `?tab=` via
  `useSearchParams` (spec-permitted — the audit found NO existing tab-in-URL precedent; documented
  as a new convention). Correctness fix: since-last-visit state hoisted to the tab host (Radix
  unmounts inactive panels → would reset the window). Test-only `vi.mock` of `@brand/charts`
  `MetricGrid` (jsdom can't resolve the `@visx` deep path; mirrors the existing `RunConsole.test`
  precedent; production untouched, real build proves it). Byte-equivalence acceptance reinterpreted:
  `features/dashboard/` had ZERO pre-existing tests, so new smoke tests assert the moved cards/
  KPI-grid/tables render (no regression lock existed to preserve). **Owner-acceptance:** both-theme
  + keyboard/focus visual walk of the tabbed Dashboard. **WP 1.3 still running** (merges after,
  rebased on `1b62d13`).
- 2026-07-17 — **WP 1.3 MERGED to main** (`b23271a`, merge of `wp/observability/1.3` @ `49668bd`;
  base `6637981` → **rebased onto current main `0c37348`** since 2.1 landed first — clean, disjoint
  files). **Migration `user_version` v33 CLAIMED by WP 1.3** (`run_search` FTS5 virtual table +
  `run_search_map` docmap via a single `RUN_SEARCH_DDL`, in BOTH `schema.ts` baseline and the v33
  `up`; fresh + upgrade-from-v32 paths both tested; docmap FK-cascades on run delete). ⇒ **migration
  head now v33; WP 2.6 will claim v34 when it runs.** Gate re-verified green POST-REBASE in the
  worktree (typecheck · lint 873 · test api 2088/web 1083 · build) + typecheck green on main
  post-merge. **FTS5 preflight test-locked** (`ENABLE_FTS5` + functional MATCH/snippet). Search
  **p95 ≈ 256 ms** under orchestrator load (agent measured ≈ 55 ms isolated) @ 50k runs — under the
  1 s budget. Additive wire: `RunSummary.searchSnippet?` + `searchMatchKind?` (`SearchContentClass`),
  present only on a `q` hit; `SearchReindexResult`; the `q`→400 guard rewired at `testing/routes.ts`
  (the 1.2 metrics `q`-reject left intact — metrics-`q` out of scope); the WP 1.1 `q`→400 test
  CONVERTED to a positive test (not deleted). Version-lock literal bumps 32→33 in 6 tests.
  **Decisions to note:** `unicode61` tokenizer, prefix-safe quoted terms (injection-safe); TWO-QUERY
  read path (`snippet()` can't run in a joined/grouped subquery, so `q` filters via
  `id IN (SELECT run_id … MATCH)` and snippets are fetched in a second page-bounded MATCH);
  MCP-content-array-aware base64/binary skip; content-class interpretations (`error` = stopReason +
  failed-tool errors; `prompt` = opener + user_message steps; `rating` = grade reasoning/method/
  evidence; `meta` = test + environment + model). Backfill is marker-gated in `openDatabase` (not in
  the migration txn). **Known derived-state caveat:** a test/scenario CASCADE delete leaves inert
  orphan FTS rows (excluded by the runs join, reclaimed by reindex); the direct `DELETE /api/runs/:id`
  purges fully. **→ WP 3.4 (in-run search) is now unblocked** (consumes this index). Real-corpus
  FTS relevance is an owner-acceptance item.
- 2026-07-17 — **Batch 4 opened: WP 1.4 (saved views) ∥ WP 2.2 (testing dashboard, web-only).**
  **WP 1.4 MERGED to main** (`6cc91c4`, merge of `wp/observability/1.4` @ `99e883c`; base `ae4efb3`,
  main unmoved so no rebase). **Migration `user_version` v34 CLAIMED by WP 1.4** (`run_views` in
  `schema.ts` baseline + v34 `up`; fresh + upgrade-from-v33 paths tested; `UNIQUE COLLATE NOCASE`
  name backstop). ⇒ **migration head now v34; WP 2.6 will claim v35 when it runs.** Gate re-verified
  green in the worktree (typecheck · lint 875 · test api 2098/web 1083 · build) + typecheck on main
  post-merge. Additive wire: `RunView`/`RunViewInput`/`RunViewPatch`; `filter_json` re-validated
  through the shared `runFilterSchema` (never redeclared); presentation hints capped
  (`RUN_VIEW_NAME_MAX_LENGTH` 200, `RUN_VIEW_PRESENTATION_MAX_BYTES` 20 KB). CRUD registered inside
  the existing `registerObservabilityRoutes` (metrics/search logic untouched). Version-lock bumps
  33→34 in 6 tests. **Deviation noted (acceptable):** the acceptance-#2 "stored filter re-executes
  identically through GET /api/runs" test REPRODUCES that handler's 3 lines (same shared
  `parseRunFilter*` helpers + `RunRepository.queryRuns`) in its own Fastify `inject()` app rather
  than calling the production route — forced by the file boundary (can't touch `testing/routes.ts`);
  parity holds because the production route uses those exact shared helpers. UI for saved views
  lands in WP 2.3. **WP 2.2 still running** (web-only; merges after, rebased on `6cc91c4`).
- 2026-07-17 — **WP 2.2 MERGED to main** (`80429d3`, merge of `wp/observability/2.2` @ `bb410e0`;
  base `ae4efb3` → **rebased onto current main `64d0ede`** since 1.4 landed first — clean, disjoint
  files). Web-only — all under `apps/web/src/features/dashboard/testing/` (12 panel components +
  `metrics-derive`/`dashboard-url-state`/`use-testing-dashboard-data` helpers) + `lib/api.ts`
  (added `getRunMetrics`/`getScanMetrics`/`getMostExpensiveRuns`/`listServers`). Gate re-verified
  green POST-REBASE (typecheck · lint 900 · test api 2098/web 1160 · build). **No metrics-contract
  gap hit** — all 8 panels built from the existing 1.2/1.1 contract (the web-only constraint held;
  `shared`/`metrics.ts` untouched). **D-OB14 honesty test-enforced** (`metrics-derive.test.ts` +
  Tokens/Cost panel tests assert no blended/summed series ever renders). Accepted deviations:
  (a) `@brand/charts` v1.6.0 exposes NO per-datapoint/legend `onClick` (verified via `.d.ts` + the
  brand-ui MCP) → drill-down uses a keyboard-reachable paired `DrillList` (mirrors ScansTab's
  "Biggest movers" list) carrying the composed `RunFilter` URL, not a chart click; (b) capability
  class isn't a `RunFilter` dimension → Tokens/Cost panels show an honest non-interactive per-class
  legend + one panel-level "Open runs" drill; (c) live Radix-Select/DateRangePicker click
  interaction is NOT unit-tested (pre-existing jsdom gap — nothing in the repo drives a `@brand`
  Select through open+pick; URL↔state proven at the pure-fn + mount-with-params level instead).
  **⚠️ CROSS-WP GAP (follow-up candidate, not blocking):** the OPTIONAL per-grader `meanScore`
  selection — 1.2 design said "meanScore (+optional grader)", 2.2 design said "grader select
  defaulting to primary priority" — landed in NEITHER WP: the metrics endpoint exposes no `grader`
  request param, so the Score-trend panel has no picker (primary-priority meanScore only, which is
  honest). A tiny additive follow-up (1.2: accept `&grader=`; 2.2: add the Select) would close it;
  owner to decide whether to schedule. **Owner-acceptance:** both-theme + keyboard/focus visual
  walk of the 8-panel Testing dashboard + drill-down navigation.

- 2026-07-17 — **Batch 5: WP 1.6 (retention/pinned) MERGED to main** (`1953f31`, merge of
  `wp/observability/1.6` @ `2eba93d`; base `70f8ef4`, main unmoved so no rebase). **Migration
  `user_version` v35 CLAIMED** (`runs.pinned INTEGER NOT NULL DEFAULT 0` in `schema.ts` baseline
  via the v29 `ensureColumn` pattern; fresh + upgrade-from-v34 paths tested). ⇒ **head now v35; WP
  2.6 → v36 · WP 1.5 (Batch 6) → v36** (whichever runs first; re-verify at claim). Gate re-verified
  green (typecheck · lint 901 · test api 2114/web 1160 · build) + typecheck on main post-merge. Adds
  `POST/DELETE /api/runs/:id/pin`, `POST /api/maintenance/prune-runs` (policy, **defaults OFF**,
  pinned NEVER pruned, deletes via the full run-delete path incl. WP1.3 FTS purge), a Settings
  retention form (`@brand/ui`, a `text-xs`→`text-meta` violation fixed). **The WP1.1 `pinned`
  placeholder is now LIVE + consistent across all 3 predicate copies** (`run-repository`
  `buildRunFilterWhere`, the `metrics.ts` replica, shared `matchesRunFilter`) — the SQL-vs-predicate
  cross-check test proves the `true` branch. Additive wire (`RunSummary.pinned`, prune-policy type).
  Version-lock bumps 34→35 in 7 tests (one more than estimated — `run-views.test.ts`). **⚠️ KNOWN
  LIMITATION (accepted, follow-up candidate):** `idx_runs_pinned` is migration-ONLY — it can't go
  in `schema.ts` baseline (the unconditional `schema.exec` would throw "no such column: pinned"
  against a pre-v35 DB before migrations run), so a **FRESH install lacks the pinned index** (the
  column is present; pinned filter/prune falls back to a table scan). This is **performance-only**
  (correctness intact) and matches the pre-existing `idx_runs_suite_run` behavior. Proper fix is a
  platform-level post-migration "ensure-indexes" step that also runs on fresh DBs (would fix both
  indexes) — out of scope for this S-size WP; recommend as a Platform-hardening follow-up. **→
  Phase 1 backbone is now 6/6 WP-complete (only 1.5 remains → Batch 6). WP 4.1 (rules engine) is
  now dep-unblocked (needed 1.1+1.6).** Owner-acceptance: both-theme + keyboard walk of the Settings
  retention form.

- 2026-07-17 — **Batch 6: WP 1.5 (feedback primitive) MERGED to main** (`3093b29`, merge of
  `wp/observability/1.5` @ `5c1fef4`; base `f13e4fb`, main unmoved so no rebase). **Migration
  `user_version` v36 CLAIMED** (`run_feedback` + `idx_run_feedback_run_id`/`_run_key` in `schema.ts`
  baseline + v36 `up`, both paths tested). ⇒ **head now v36; WP 2.6 → v37 when it runs.**
  ⭐ **PHASE 1 BACKBONE COMPLETE (1.1–1.6 all merged).** Gate re-verified green (typecheck ·
  lint 903 · test api 2125/web 1160 · build) + typecheck on main post-merge. Adds `POST/GET/DELETE
  /api/runs/:id/feedback`; upsert per `(run_id, step_id, key, source='human')` enforced in APP CODE
  inside a txn (NOT a DB UNIQUE — SQLite `NULL != NULL` would admit duplicate run-level rows). The
  WP1.1 `feedback` RunFilter placeholder is now LIVE (correlated `EXISTS` subquery, consistent in
  run-repository + the `metrics.ts` replica; shared `matchesRunFilter` needed no change — WP1.1
  built the pure predicate correctly, it only lacked candidate data). Additive `RunSummary.feedback`
  (`{key,score}[]`, run-level, latest-per-key) wired into `queryRuns`/`listRuns`/`getSummary` but
  **deliberately excluded from `compareRuns`** (spec singles compare out). **STRICT SEPARATION
  (AR6/D-OB15) test-enforced:** a regression test asserts `computeSuiteAggregates`/`computeSuiteAnalytics`
  are BYTE-IDENTICAL (`JSON.stringify`) with vs without feedback rows, AND that `RunSummary.feedback`
  DOES reflect the write (non-vacuous). Version-lock bumps 35→36 in 7 tests. **Note:** the
  `feedbackRate` metrics MEASURE stays unwired (the WP allowlist covered only the `metrics.ts`
  predicate replica, not the aggregation measure — a tiny follow-up in a future metrics-touching WP).
  **WP 2.3 still running** (web-only; merges after, rebased on `3093b29`).
- 2026-07-17 — **WP 2.3 (runs feed upgrade) MERGED to main** (`d63492d`, merge of
  `wp/observability/2.3` @ `76683e3`; base `f13e4fb` → **rebased onto `4c7a1e5`** since 1.5 landed
  first — clean, disjoint). Web-only — the real feed is `apps/web/src/features/testing/RunsView.tsx`
  (`/testing/runs`) + the `runs/` cluster; new `RunFilterBar`/`RunSavedViews`/`RunColumnChooser`/
  `RunPreviewRow` + `run-filter-url`/`run-columns` helpers; `lib/api.ts` gained
  `queryRunsFiltered`/view-CRUD/`pinRun`. Gate re-verified green POST-REBASE (typecheck · lint 915 ·
  test api 2125/web 1227 · build). Filter bar ⇄ URL via the SHARED serialize helper (WP2.2
  dashboard drill-downs hydrate byte-for-byte); FTS `q` snippets; saved views (client presets +
  WP1.4 CRUD, restoring columns+sort); pin toggle (WP1.6). Accepted deviations: (a) **feedback-chip
  RENDER deferred to WP2.5** (labeled placeholder, never reads `RunSummary.feedback` — the `feedback`
  FILTER is fully wired); (b) column chooser composes `@brand` primitives (`DropdownMenu`+`Checkbox`+
  `Select`) not `@brand/data` `ColumnPicker` (which binds a TanStack table the hand-built feed
  doesn't use — a documented library-first gap, NOT a hand-rolled control); (c) suite member lists
  stay UNFILTERED by design (a suite row shows iff a member matches; drill-down preserved via an
  additive optional `visible` prop → `SuiteRunConsole`/`SuiteMembersTab` render byte-identically,
  tests untouched); (d) one jsdom/Radix Select-in-Popover flow was flaky → covered via the same
  Select in `RunColumnChooser.test` instead. **Owner-acceptance:** both-theme + keyboard walk of the
  feed (filter bar add/remove, saved-view apply/save, search snippets, pin toggle, column chooser)
  + a dashboard-drill-down→feed hydration spot-check.

- 2026-07-17 — **Batch 7: WP 2.5 (feedback UI) MERGED to main** (`168e7e7`, merge of
  `wp/observability/2.5` @ `286c050`; base `e260204`, main unmoved so no rebase). Web-only (no
  API/shared touched → WP1.5's separation test holds trivially). Gate re-verified green (typecheck ·
  lint 917 · test web 1263/api 2125 · build) + typecheck on main post-merge. Adds a tiny
  `FeedbackControl` (`@brand/ui` `Toggle` thumbs + `Popover` note), run-level thumbs+note in `RunBar`
  (editable live AND replay), per-turn thumbs in `ConversationPane` (ONE batched `listRunFeedback`
  per run, scoped to the real `llm_response` step id), feed chips (replacing the WP2.3 deferred
  placeholder in `RunPreviewRow`/`RunTableRow`), report-tab "Your feedback" line. **DELIBERATELY
  distinct from judge chips** (Toggle + `ThumbsUp/Down` vs `Badge`/`StatusBadge`; "Your verdict"
  copy — never reads as a grade, D-OB15). Deviation: additive web-local `TimelineAssistantTurn.stepId`
  (in `use-run-stream.ts`) for genuine step-scoped turn feedback (not shared, not the step-hierarchy
  internals WP3.1 owns). **Deferred:** the exported-report JSON/MD `humanFeedback` block (touches
  `reports/reports.ts` — a tiny API follow-up). **Owner-acceptance:** both-theme + keyboard walk of
  the thumbs/note/chips + the visual separation from grader verdicts. **WP 3.1 still running**
  (API-only; merges after, rebased on `168e7e7`).

- 2026-07-17 — **WP 3.1 (step hierarchy wire) MERGED to main** (`2c1e719`, merge of
  `wp/observability/3.1` @ `869f3768`; commits `58b1df5`+`be95dc1`; base `e260204` → **rebased onto
  `ab4e49a`** since 2.5 landed first — clean, disjoint). **Migration `user_version` v37 CLAIMED**
  (`run_steps.parent_step_id`/`span_kind` in `schema.ts` baseline + v37 `up`; index
  `idx_run_steps_parent_step_id` migration-ONLY per the WP1.6 footgun; both paths tested; old rows
  NULL→flat). ⇒ **head now v37; WP 2.6 → v38.** Gate re-verified green POST-REBASE (typecheck ·
  lint 918 · test api 2137/web 1263 · build) + typecheck on main post-merge. **Fully ADDITIVE wire**
  (zero deletions in shared; `SPAN_KINDS` = turn|tool_call|tool_io|rating|judge_call|probe|
  context_event; the `step` RunEvent carries them via `.passthrough()` so old events still parse).
  **Guardrails held:** no reordering (children take the next monotonic idx — the tree is a rendering
  of parent links), no change to grading/`assistantText` byte-identity (existing grading/suite/report
  tests stay green untouched), old-run flat replay tested. Parent links validated at persist
  (dangling/forward/cross-run → flat). **Emitters:** rating→judge_call span (grade-service, gated on
  in `index.ts`) and **tool_io child at the engine MCP sink** (`run-service.ts` — an ORCHESTRATOR-
  AUTHORIZED targeted additive edit after the agent correctly STOPped at the original "don't touch
  run-service" boundary; ENGINE-PATH ONLY by construction — the sink is only wired by the engine
  executor; `skill://` disclosure reads excluded; subscription/qlik assert NO child) — both live in
  production. **⚠️ PROBE EMITTER DEFERRED → OWNER ESCALATION:** the WP spec assumed compat probes
  emit run steps to nest under a `probe` parent, but `compatibility/runner.ts` is a **pure static
  evaluator with no run-step surface** and `POST /api/runs/:id/compatibility` only READS steps — so
  there is nothing to nest. The `probe` spanKind + wire + a persistence-level fixture remain, ready
  for a future surface. Production probe emission would require the compat runner to gain a
  step-emission path — a SEPARATE concern, out of scope for this additive-metadata WP. **Owner
  decision needed:** whether/when to give the compat runner a step surface (its own small WP), or
  drop `probe` from scope. **→ WP 3.2 (tree StepLog + nested Gantt + per-step economics) is now
  unblocked** (renders whatever hierarchy exists — rating+tool_io subtrees on real runs today).

- 2026-07-17 — **Batch 8 (first 3-way): WP 3.2 + WP 2.4 MERGED; WP 4.1 still running.** Both web,
  disjoint areas (3.2 = console cluster; 2.4 = feed lens + dashboard card), zero common files.
  **WP 3.2 (console tree)** MERGED (`aaa7448`, `wp/observability/3.2` @ `0b0d45c`; base `64d3036`,
  main unmoved so no rebase). Console-cluster-only; gate green (typecheck · lint 925 · test web
  1316/api 2137 · build). Collapsible step tree (`@brand/ui` `Tree`; rating+tool_io collapsed by
  default; FLAT runs byte-stable — separate early-return branch, flat DataTable untouched), nested
  RunGantt lanes, per-step economics chips (deltas from cumulative `stepKpis` + subtree rollups),
  hotspots strip (slowest/costliest/biggest-context-jump; duration-only when `tokens:'none'`). New
  pure helpers `step-tree.ts` (reparents `tool_io` after `dedupeToolSteps`; `dedupe-tool-steps.ts`
  left untouched for its other consumers) + `hotspots.ts`. **KpiRail EXTENDED** (appended
  HotspotsStrip + 3 optional props; the unified-sessions WP3.2 capability tile grid untouched) —
  **ZERO new `providerKind` forks** (grep-proof test, D-US4). Owner-acceptance a11y notes: Tree is
  NON-virtualized (jsdom can't measure — bounded `max-h` scroll; watch for runs with hundreds of
  nodes), `@brand/ui` `Tree` row-click selects+toggles together (library behavior), composed-JSX
  rows get no explicit `aria-label` (verbose text-content fallback).
  **WP 2.4 (sessions lens)** MERGED (`ef21237`, `wp/observability/2.4` @ rebased `67caa01`; base
  `64d3036` → **rebased onto `aaa7448`** since 3.2 landed first — clean, disjoint). Web-only, no
  shared/API change (used existing `RunSummary.{turns,phase,seen,durations,feedback}` + WP1.2
  metrics). Gate green (typecheck · lint 933 · test web 1322/api 2137 · build). A "Sessions" feed
  preset (`interactiveOnly`, session column set = env/kind/turns/active+waiting split/last-activity/
  phase+seen chips/feedback/basis-aware cost) + per-env p50/p95 mini-stat + a "Waiting for you"
  Dashboard KPI card (`phase:waiting_input`) deep-linking to the lens. Phase/`Ended` chips via
  `lib/status` (not re-derived); kind chip from the capability manifest (no `providerKind` fork);
  legacy runs degrade honestly (wall-only marked; last-activity = `endedAt ?? startedAt`, `(from
  start)` marked — no persisted last-event field). One defensive `SuiteMembersTab` `visible=` line
  keeps the suite console byte-identical under the widened column union. **Owner-acceptance:**
  both-theme + keyboard walk of the tree/Gantt/economics/hotspots (+ the a11y notes above) and the
  Sessions lens + Waiting-for-you card.

- 2026-07-17 — **WP 4.1 (rules engine core) MERGED to main** (`2d2d798`, `wp/observability/4.1` @
  rebased `375969e`; base `64d3036` → **rebased onto `dc89890`** since 3.2+2.4 landed first — clean,
  disjoint [4.1 API vs 3.2/2.4 web]). **Migration `user_version` v38 CLAIMED** (`watch_rules` +
  `watch_rule_events` audit + `watch_secrets` [AES-GCM webhook URL] + additive `tests.draft`, in
  schema.ts baseline + v38 up, both paths tested). ⇒ **head now v38; WP 2.6/2.7 → v39.** Gate
  re-verified green POST-REBASE (typecheck · lint 940 · test api 2158/web 1322 · build) + typecheck
  on main post-merge. Additive wire (rule/action/audit types). **Hook = `run-service.reviewRun`'s
  LAST step** (the SAME post-rating seam auto-rating uses): the skipped-path early-`return` became an
  `else` so BOTH paths fall through to a GUARDED `evaluateWatchRules` — **rating transitions
  byte-identical, executor loops untouched, a throwing rule can NEVER touch run completion** (verified
  by reading the full diff + the existing rating/run tests staying green). `watch?` is an additive
  optional constructor param. **Rules are strictly post-hoc OBSERVERS.** `matchesRunFilter` per-run
  predicate (no SQL) + DETERMINISTIC SHA-256(`ruleId:runId`) sampling (no RNG/clock). Closed action
  set (pin · add_to_collection · **promote_to_test** [draft, NO auto-run] · run_grader · webhook ·
  notify), each audited, failures isolated. **Webhook secret** encrypted out of `watch_rules`, never
  in responses/DB/logs, rotated on actions-update, cascade-dropped on rule delete (all tested vs a
  local receiver). `notify` INERT until WP4.3 (optional `notify` service left undefined in index.ts —
  4.3 wires the sink with NO engine change). Accepted deviations: (a) a 3rd v38 table `watch_secrets`
  (beyond the spec's 2) — directly serves the secret-isolation non-negotiable; (b) `promote_to_test`
  environment-binding via carrying the source test's shaping config (env binds at the RUN, not the
  test). **→ Phase 4 opens: WP 4.2 (windowed rules), 4.3 (notification center) now dep-unblocked.**
  Owner-acceptance: live webhook test-fire against a real receiver; promote-to-test on a real failed
  run.

- 2026-07-17 — **Batch 9: WP 4.2 (windowed rules) MERGED to main** (`498f07c`, `wp/observability/4.2`
  @ `9094e86`; base `a343ab9`, main unmoved so no rebase). **Migration `user_version` v39 CLAIMED**
  (`watch_rules.last_evaluated_at` additive nullable via `ensureColumn`; schema.ts baseline + v39 up;
  both paths tested). ⇒ **head now v39; WP 2.6/2.7/3.3/4.3/4.5 → v40+.** Gate re-verified green
  (typecheck · lint 942 · test api 2170/web 1375 · build) + typecheck on main post-merge. **DERIVED-ONCE
  honored:** `watch/engine.ts` `WatchWindowEvaluator` DELEGATES all measure math to WP1.2
  `computeRunMetrics` (`metrics.ts` UNTOUCHED) — grid-aligned windows (1h→hour, 6h/24h→day,
  7d→Monday-week) collapse to exactly one metrics bucket so the preview `===` the 1.2 point (percentile-
  safe). In-process singleton ticker (`watch/scheduler.ts`, ~5min) with an INJECTABLE clock + timer seam
  (tests fake time — zero real waits, zero leaked timers; shutdown-safe via `shutdown.ts`). **Boot
  catch-up (D-OB19):** missed windows evaluated on startup, notifications flagged `late:true`, a
  `window_catchup` audit row records the gap — never fabricates continuity. Cooldown dedupe (no re-fire
  while breached; recovery re-arms); windowed webhook secret never in the audit. `POST
  /api/watch-rules/preview` drives the WP4.4 chart. `notify` still inert until WP4.3 (accepted+audited).
  **Wire note (accepted):** the WP4.1 reserved `window?: unknown` placeholder (explicitly "RESERVED for
  WP4.2") is now given its real typed schema by its owning WP — the sanctioned reserved-field
  fulfillment, safe because no pre-4.2 rule carries a `window`. **→ WP 5.1 (issue aggregation) now
  dep-unblocked (needed 1.2+4.2); WP 4.4 (rules UI) now needs only 4.3+2.3.** Owner-acceptance: a live
  windowed-rule fire + boot-catch-up walk (needs runs accumulating over real time).

- 2026-07-17 — **WP 3.4 (in-run search + lenses) MERGED to main** (`974b12c`, `wp/observability/3.4`
  @ rebased `d2f40c9`; base `a343ab9` → **rebased onto `0637bd7`** since 4.2 landed first — clean,
  disjoint [3.4 web console vs 4.2 API]). Web console-cluster + `lib/api` only; gate re-verified green
  POST-REBASE (typecheck · lint 952 · test web 1414/api 2170 · build). **ONE `findMatch` primitive, TWO
  sources** (live in-memory step scan ALWAYS runs + a run-scoped WP1.3 FTS hit merged IN ADDITION for
  replay — never instead). Console-header search: highlight + prev/next (keyboard `n`/`p`) + count chip
  + Filtered-only/Show-all on the WP3.2 tree StepLog. Conversation·Steps·Turns lens switcher (segmented
  `@brand` `ToggleGroup` driving the EXISTING `leftView` state — deliberate, no layout re-architecture;
  Trace/Analytics/Report stay reachable). Turns lens = per-turn summary cards (prompt/reply first lines +
  duration/tokensΔ/tool-count/feedback chips). URL-persisted `?lens=&find=`. **Bug caught+fixed:** first
  version auto-navigated to chat when a match existed, overwriting a `?lens=turns` deep link — fixed with
  an explicit-nav gate (nav only on n/p/button, never a passive side effect). `<mark>` highlight uses
  `bg-primary/20` semantic tokens (established pattern, not a raw color / hand-rolled component; verified
  via brand-ui MCP that no `@brand` highlight component exists). Owner-acceptance: both-theme + keyboard
  walk (search nav, lens switch, Turns cards). **Phase 3 now 3/4 (only 3.3 fork-from-step remains).**

- 2026-07-17 — **Batch 10: WP 4.3 (notification center) MERGED to main** (`d1cf312`,
  `wp/observability/4.3` @ `4501415`; base `bbc38ee`, main unmoved so no rebase). **Migration
  `user_version` v40 CLAIMED** (`notifications` table; schema.ts baseline + v40 up, both paths tested).
  ⇒ **head now v40; WP 2.6/2.7/3.3/4.5/5.1 → v41+.** Gate re-verified green (typecheck · lint 960 ·
  test api 2192/web 1424 · build) + typecheck on main post-merge. **Wired the inert WP4.1 `notify`
  sink** via the index.ts seam (`watchActionServices.notify = notifySink`; ZERO `watch/engine.ts`
  change; the only `actions.ts` edit is `export`ing `postWebhook`) — so WP4.2 windowed notifies also
  land for free. Persistent bell in `AppShell` (composed from `@brand` `Popover`/`Badge`/`StatusBadge`
  — the `NavNotifications` composite lacks severity/read/link/late, so library-first compose; unread
  badge, severity tone, "while you were away" late chip, deep-link + mark-read/read-all) fed by a
  DEDICATED no-replay `GET /api/notifications/stream` (no existing app-level stream to piggyback).
  Webhook channel reuses WP4.1's `watch_secrets`/`resolveWebhookUrl` + `POST /api/watch-rules/:id/
  test-fire` (real local-receiver tested; secret never in response/audit; failures degrade to
  `ok:false`+HTTP200, never thrown). `prune-notifications` (read+old only). **QUIET by default:** zero
  toasts for EVERY severity (stricter than the spec's "info only" — quiet-by-default was the safer read
  of the ambiguity), badge only. Additive wire. Deviation: dropped a refresh-on-popover-open (race vs
  the live SSE push; single fetch-on-mount + live push). Owner-acceptance: both-theme + keyboard walk
  of the bell/popover; a live webhook test-fire against a real receiver. **→ WP 4.4 (rules UI) now
  dep-unblocked (needed 4.2+4.3+2.3).**

- 2026-07-17 — **Batch 11: WP 4.4 (rules UI) MERGED to main** (`c52b702`, `wp/observability/4.4` @
  `c51451a`; base `f6cb5b2`, main unmoved so no rebase — 5.1 still running). Web-only (shared/API
  untouched; `ApiError.issues` for inline zod is web-side). Gate re-verified green (typecheck · lint
  974 · test web 1483/api 2192/shared 49 · build) + typecheck on main post-merge. `features/watch/`
  routed view at **`/testing/observability/rules`** (matches the API webhook/notification `link` path)
  + a Settings "Watch rules" card (Testing pane; nav stays 4). RuleEditorDialog: Trigger step REUSES
  WP2.3 `RunFilterBar` (on-terminal) | windowed pickers bound to the 1.2 vocab; **Preview step GATES
  windowed Save until the `POST /preview` bar strip has rendered** (signature-invalidated on config
  change — tested); Actions checklist with per-action config incl. **write-only webhook secret** +
  test-fire. RuleAuditDialog (fire history), PromoteToTestMenu on RunBar. **⚠️ KNOWN GAP → API
  FOLLOW-UP (not blocking):** the console Promote-to-test calls `POST /api/runs/:id/promote-to-test`
  which **does NOT exist** — no WP built an on-demand "promote a past terminal run" endpoint (WP4.1's
  `promote_to_test` action only fires automatically on a NEW run matching a saved rule; it can't reach
  back into a past run). The web flow is built + STUBBED per this WP's own acceptance ("stubbed"); a
  small ADDITIVE API endpoint wrapping WP4.1's promote path is needed before the button works in
  production. **Recommend a tiny API follow-up WP** (or fold into the next API-touching batch). Owner-
  acceptance: both-theme + keyboard walk of the rules list/editor/audit + the console promote menu.

- 2026-07-17 — **WP 5.1 (issue aggregation) MERGED to main** (`fe4d68d`, `wp/observability/5.1` @
  rebased `54cc351`; base `f6cb5b2` → **rebased onto `4eeed32`** since 4.4 landed first — clean,
  disjoint [5.1 API vs 4.4 web]). **Migration `user_version` v41 CLAIMED** (additive fleet columns on
  the v26 `rating_issues`: `cluster_key`/`cluster_key_version`/`occurrences`/`affected_json`/
  `lifecycle`/`resolution_note`/`trend_json` + `rating_issue_occurrences.observed_at`; cluster index
  migration-only per the v35 footgun; both paths tested). ⇒ **head now v41; WP 2.6/2.7/3.3/4.5 → v42+.**
  ⭐ **PHASE 5 OPENS.** Gate re-verified green POST-REBASE (typecheck · lint 976 · test api 2203/web
  1483 · build) + typecheck on main post-merge. Versioned deterministic cluster key
  (`v1|bucket|fixTarget|tool|normalizedError`) + a TABLE-TESTED error normalizer (strips
  urls/uuids/opaque-ids/paths/numbers) in a distinct `sweep-v` digest namespace (can't trip the AR
  `hasOccurrence` pipeline). Sweep rides the 4.2 scheduler + `POST /api/issues/sweep`: new→open,
  existing→increment, **RESOLVED-reappears→`regressed` + exactly ONE notification** (auto-reopen via
  the 4.3 sink). `GET /api/issues(+/:id detail+linked runs+drafted fixes)`, `POST /api/issues/:id/
  {resolve,ignore,reopen}`, `POST /api/issues/rebuild` (proves DERIVED-ONCE — byte-identical
  reproduction). **NO LLM** (that's 5.2). **AR CONTRACT INTACT:** `issue-service.ts` UNCHANGED;
  hand-filed AR rating-issues keep `cluster_key`/`lifecycle` NULL and are excluded by the fleet filter;
  all existing rating-issues/grading/AR11 tests green. Deviations (noted): (a) `ignore`→`resolved` (the
  spec CHECK lacks an `ignored` state — a reappearing ignored cluster will regress+notify; a true mute
  needs an extra column → 5.3/owner); (b) `serverOrSkill` realized as the failing tool (finer,
  documented); (c) suite-clustering normalizer NOT extracted (different count-by-message semantics;
  `suites/` outside the file set; kept EXPORTED for a later WP). **→ WP 5.2 (LLM assist), 5.3 (issues
  UI), 5.5 (digest) now dep-unblocked.**

- 2026-07-17 — **Batch 12: WP 3.3 (fork-from-step) MERGED to main** (`76e00db`, `wp/observability/3.3`
  @ `b41488f`; base `78c3155`, main unmoved so no rebase). **Migration `user_version` v42 CLAIMED**
  (`runs.derived_from_run_id` + `fork_step_id` additive nullable; `idx_runs_derived_from` migration-only
  per the v35 footgun; both paths tested). ⇒ **head now v42; WP 2.6/2.7/4.5 → v43+.** Gate re-verified
  green (typecheck · lint 983 · test api 2222/web 1492 · build) + typecheck on main post-merge.
  **EXECUTOR SURGERY verified ADDITIVE + SAFE:** `RunService.rerun` → PURE `fork.ts` byte-exact prefix
  reconstruction → the EXISTING `start()` path with an optional `ForkSeed` threaded through
  `execute`/`resolve*`; `engine.ts` gains 2 GUARDED `EngineConfig` fields (`messagePrefix` prepends —
  byte-identical when absent; `temperature` fork-only) — **the three executor core loops are UNCHANGED**
  (the 2222 existing tests are the guardrail; overrides apply as `override ?? default` so non-fork runs
  are byte-identical). `POST /api/runs/:id/rerun {fromStepId?, overrides?}` validates (terminal;
  suite-member→409; model-resolves-for-kind; qlik whole-run-only→422 via the MANIFEST, not providerKind).
  RunFilter `derived` now LIVE + consistent across all 3 predicate copies (run-repository / metrics.ts
  replica / shared `matchesRunFilter`; default-EXCLUDES forks, "Show forks" chip; cross-check green);
  derived runs are NEVER suite members + absent from suite analytics. Estimate-first (`POST
  /api/estimate/run-plan`) before launch; ForkDialog + LineageBanner (both directions) + Compare-with-
  parent pre-seed. Deviations: (a) `temperature` override now genuinely wired into `streamText`
  (the engine previously ignored it) — fork-only + presence-guarded, existing runs unchanged; (b)
  mid-run fork delivered via a capability-gated fork-point SELECTOR in the dialog, not an inline
  per-step affordance in the 791-line StepLog (lower blast radius, same capability). Owner-acceptance:
  both-theme + keyboard walk of the fork dialog/banner/chip; a live fork against a real provider key.
  **→ WP 5.4 (assistant issue loop) now needs only 5.3.**
  **[ops note] the WP3.3 merge commit body dropped a few backtick-wrapped words to a zsh command-sub
  slip in `git merge -m`; code is correct, this ledger is authoritative. Orchestrator now uses
  backtick-free commit messages.]**

- 2026-07-17 — **Batch 13: WP 5.2 (LLM clustering assist) MERGED to main** (`668504e`,
  `wp/observability/5.2` @ `42d74dc`; base `a8c59f3`, main unmoved so no rebase — 5.3 still running).
  **MIGRATION AVOIDED (head stays v42):** merge-links + the separate cost ledger live in ONE
  `app_settings` JSON doc (`issue_assist_state`); `rating_issues` rows never touched (unmerge just drops
  a group). API+shared only. Gate re-verified green (typecheck · lint 985 · test api 2240/web 1492 ·
  build) + typecheck on main post-merge. Opt-in LLM pass over WP5.1 clusters via the CLI-first judge
  chain: merge near-dup issues (REVERSIBLE; deterministic keys keep accruing underneath), AI
  title/summary/suggested-priority (marked `aiAssisted` + model/ts; deterministic fallback retained;
  **priority NEVER auto-applies**). **OFF by default;** OWN `AsyncSemaphore`/`ISSUE_ASSIST_MAX_CONCURRENCY`
  (NOT the auto-rating gate — Q7); cost to a SEPARATE ledger (CLI cost 0 per AR13), never blended into
  grades (D-OB15/AR6). Refine endpoints wired only when the service is present; `maybeRunAfterSweep` in a
  guarded `onSweep` seam (sweep unaffected on assist error — isolation tested). **Deterministic clustering
  + AR per-run filing UNCHANGED** (`issue-clustering.ts`/`issue-service.ts` untouched; existing rating-
  issues/AR11 tests green). 18 new tests, ALL behind a FAKE judge. Deviation: LLM output shape realized
  as `{groups:[{issueIds,title,summary,suggestedPriority,rationale}]}` (per-group title; one prompt/parser
  for both endpoints — semantically equivalent). **OWNER-ACCEPTANCE (live):** real CLI/subscription or
  provider-key run — actual merge/title/priority quality + the real CLI→provider→skip fallback (stub-
  tested only in the gate). **WP 5.3 still running** (web; merges after, rebased on `668504e`).

- 2026-07-17 — **WP 5.3 (issues tab UI) MERGED to main** (`04e8dd6`, `wp/observability/5.3` @ rebased
  `ea6b848`; base `a8c59f3` → **rebased onto `7dc556b`** since 5.2 landed first — clean, disjoint [5.3
  web vs 5.2 API]). Web-only. Gate re-verified green POST-REBASE (typecheck · lint 1002 · test web
  1541/api 2222 · build) + typecheck on main post-merge. New `features/issues-fleet/` (kept SEPARATE
  from the existing per-target `features/issues/IssuesPanel`), mounted as the Dashboard's 3rd tab via
  WP2.1's commented mount point; tab badge = open+regressed count. Triage table (regressed-sorts-first;
  lifecycle chip via a new `lib/status.deriveIssueLifecycleView`; occurrences, `trend_json` sparkline
  honest-with-sparse-data, affected chips, bucket) + lifecycle/entity/date filters. Master-detail via
  `SplitPane` (the reusable primitive at embedded-tab scope — NOT AppShell `secondaryContent`, which is
  for top-level routed sections; documented) with summary/rationale, occurrences-over-time slice (reused
  shared `ChartPanel` blocks, not `RunsErrorRatePanel` directly — its controls lack a `skillId`
  dimension), linked-runs exact-RunFilter "open in feed", drafted-fixes copy section, lifecycle actions
  behind CONFIRM tiers, and an "Analyze with Assistant" mount INERT until WP5.4. Deviations: (a)
  `aiAssisted` rendered via a DEFENSIVE cast (5.2's field was parallel/absent in-base — renders once the
  field flows through); **integration seam to verify:** GET /api/issues must surface WP5.2's
  `app_settings` assist state (aiAssisted title/summary) for the mark to show live end-to-end — a small
  wire, owner-acceptance-adjacent (needs live LLM anyway). Owner-acceptance: both-theme + keyboard walk
  of the triage list/detail/lifecycle + a real populated fleet. **→ WP 5.4 now needs only itself (5.3 +
  3.3 + 4.1 all done).**

- 2026-07-17 — **Batch 14: WP 5.4 (assistant issue loop) MERGED to main** (`eae391f`,
  `wp/observability/5.4` @ `d60b55e`; base `1534e34`, main unmoved so no rebase — 5.5 still running).
  **SHARED-FREE + MIGRATION-FREE confirmed** (LATEST stays v42; verification-run links in an
  `app_settings` JSON doc `issue_verification_links`, the WP5.2 pattern; NO db/scheduler/reports/
  run-service touched). Gate re-verified green (typecheck · lint 1011 · test api 2264/web 1549 ·
  build) + typecheck on main post-merge. WP5.3's Analyze-with-Assistant button opens the dock with a
  prefilled issue-triage prompt (summary/cluster/linked-runs/fix-targets/drafted-fixes/affected). New
  READ tools `issues.get/list/linkedRuns`; one gated WRITE group `issues.update` + `tests.createDraft`
  (WP4.1 promote path) + a gated rerun ACTION tool (WP3.3) — **all GATED by the UNCHANGED D-AS4
  classifier, approval-only**. Prove-it: draft regression test / fork re-run land as normal runs; the
  issue detail shows Verification runs. Watch = WP5.1 auto-reopen (end-to-end tested: resolve→clean
  sweep keeps resolved→recurrence regresses + one notification). Owner-initiated only (no unattended
  analysis). Everything STUBBED (no real Agent SDK child/LLM/run). **Shared-free deviations (flag for a
  later consolidation when shared is next touched):** issue envelope is a web-side prompt not a shared
  `AssistantEntityKind`; the 3 action tools' scope-exemption is an apps/api-local predicate OR'd into
  `session-manager.handlePermission` (additive, approval-gating intact) not shared
  `SCOPE_EXEMPT_ACTION_TOOLS`; verification response types are api/web-local not shared. **OWNER-
  ACCEPTANCE (live):** real assistant sign-in + a real analyze→fix→approve→verify walk on a real issue.
  **WP 5.5 still running** (merges after, rebased on `eae391f`).

- 2026-07-17 — **WP 5.5 (scheduled digest) MERGED to main** (`7baa07d`, `wp/observability/5.5` @
  rebased `ebd229a`; base `1534e34` → **rebased onto `d651ad9`** since 5.4 landed first). **Migration
  `user_version` v43 CLAIMED** (`digest_reports` + `prune-digests`; both paths tested). ⇒ **head now
  v43; WP 2.6/2.7/4.5 → v44+.** ⭐ **PHASE 5 COMPLETE (5.1–5.5).** Gate re-verified green POST-REBASE
  (typecheck · lint 1017 · test api 2284/web 1549 · build) + typecheck on main post-merge. **ONE rebase
  conflict** (both 5.4 + 5.5 wired the composition root `index.ts`) — resolved by the orchestrator
  keeping BOTH service blocks (the 5.4 verification store + the 5.5 digest schedule); typecheck + all
  tests confirm the wiring. Digest composer (`reports/digest.ts`) = window-over-window briefing
  (headline runs/errorRate/cost-by-basis Δ, new/regressed/resolved issues top-5, movers by
  server/model/suite, notable runs, scan movers) — **DERIVED-ONCE** (delegates every number to WP1.2
  `computeRunMetrics`/`computeScanMetrics` + the WP5.1 issues registry; the composer only arranges +
  renders MD; honest empties, never padded). Rides the WP4.2 scheduler via an ADDITIVE `onDigest` hook
  (off|daily|weekly + hour; catch-up inherited → missed digest generates LATE + flagged); manual `POST
  /api/reports/digest/generate`. `digest_reports` + `GET :id/{json,markdown}` matches the report family +
  prune retention; delivered as a WP4.3 `info` notification deep-linking a routed read-only digest view.
  Owner-acceptance: both-theme walk of the digest view + Settings schedule card. **→ Only the 3
  independent Phase-2/4 migration leaves remain: WP 2.6 · 2.7 · 4.5.**

- 2026-07-17 — **Batch 15: WP 2.6 (pricing editor) MERGED to main** (`5a48e31`, `wp/observability/2.6`
  @ `94fd1f0`; base `b90e3c6`, main unmoved so no rebase). **Migration `user_version` v44 CLAIMED**
  (`model_pricing` seeded from `MODEL_PRICING` via `INSERT OR IGNORE seed:<model>`; both paths tested;
  seed parity proven). ⇒ **head now v44; WP 2.7/4.5 → v45+.** Gate re-verified green (typecheck · lint
  1020 · test api 2296/web 1557 · build) + typecheck on main post-merge. DB-backed pricing map (regex/
  exact match + effective dates), CRUD `/api/pricing` (regex compile-check → 400), Settings Pricing card
  (seed rows read-only, overridable by a newer user row). `resolvePricing` (exact>regex, newest
  `effective_from<=at`, code-table fallback+log) reaches EVERY cost site — including the frozen
  `engine.ts`/executor loops — via an installable PROCESS-GLOBAL `PricingResolver` seam consulted
  under-the-hood by `estimateCost` (code-table DEFAULT → existing tests byte-identical; **executor loops
  UNTOUCHED**). **MONEY INVARIANTS test-enforced:** seed parity (DB == code table exactly), **HISTORICAL
  COSTS NEVER RECOMPUTED** (a persisted run's `cost_usd` byte-identical after any pricing edit),
  precedence + future-dating (fake clock), unpriced guardrail unchanged. Design note: the process-global
  resolver seam is DI-via-singleton (the only way DB pricing reaches the do-not-touch loops); `provider`
  is a display/tiebreak only — resolution keys on model id. **Validation note:** one transient `fail 1`
  appeared in the FIRST full-parallel `pnpm test`; it did NOT reproduce across 4 subsequent re-runs (3×
  isolated api 2296/0 + 1 full green) — diagnosed as a perf/timing flake under parallel CPU load
  (pre-existing risk), NOT a pricing global-state ordering issue (the isolated api suite, same file order,
  is deterministically stable). Owner-acceptance: both-theme + keyboard walk of the Pricing card.
  **→ Only WP 2.7 + 4.5 remain.**

- 2026-07-17 — **Batch 16: WP 2.7 (custom chart composer) MERGED to main** (`5b8e70c`,
  `wp/observability/2.7` @ `755bfe5`; base `628e050`, main unmoved so no rebase). **Migration
  `user_version` v45 CLAIMED** (`dashboard_charts` table; both paths tested). ⇒ **head now v45; WP 4.5
  → v46.** Gate re-verified green (typecheck · lint 1033 · test api 2316/web 1612 · build) + typecheck on
  main post-merge (no flake this run). User-defined charts on the Testing tab: config = measure(s)
  [same-unit] + RunFilter + groupBy + bucket + chartType(line|bar|stacked) + source(runs|scans),
  zod-validated; CRUD `/api/dashboard-charts` with `position` ordering. Composer dialog REUSES the WP2.3
  `RunFilterBar` + WP2.2 chart panels/`metrics-derive` with a live `/api/metrics/*` preview; custom
  panels render under the prebuilt ones (edit/clone/delete/reorder). Chart-local filter composes with the
  global bar via **AND** (list intersection, range tightening, window wins). **HONESTY (D-OB14):**
  same-unit multi-measure only (mixed units → 400 via a shared `superRefine`) + capability-split enforced
  server-side; **NO client-side aggregation** (web only pivots what the metrics API returns). `metrics.ts`
  + executor loops untouched. Owner-acceptance: both-theme + keyboard walk of the composer + custom
  panels. **→ Only WP 4.5 (review queue lite) remains — the final WP.**

- 2026-07-17 — **Batch 17: WP 4.5 (review queue lite) MERGED to main** (`e28a52f`, `wp/observability/4.5`
  @ `3a9010c`; base `533bf0b`, main unmoved so no rebase). **Migration `user_version` v46 CLAIMED**
  (`review_rubrics` table; both paths tested). Gate re-verified green (typecheck · lint 1043 · test api
  2328/web 1635 · build) + typecheck on main post-merge. Keyboard-first review view
  (`/testing/runs/review`, j/k/Enter over a filtered run set) + rubric management
  (`/testing/observability/review-rubrics`) + a "Review these…" feed toolbar entry; progress derived (a
  run reviewed when every rubric key has a row). **SEPARATION (D-OB15/AR6):** every verdict writes THROUGH
  the WP1.5 `run_feedback` API (`putRunFeedback`, upsert per run/key/source=human) — grading/run-service/
  executors/session-contract UNTOUCHED; the WP1.5 byte-identical suite-aggregate separation test stays
  green. Kept LITE (no reservations/reviewer-states). Deviation: left-pane preview is a small read-only
  `RunStepsPreview` from `getRun` steps (plain REST), not the SSE `ConversationPane` (proportionate
  scope). Owner-acceptance: both-theme + keyboard walk of the review flow + rubric management.

═══════════════════════════════════════════════════════════════════════════════════════════════
## 🎉 WORKSTREAM COMPLETE — all 27 WPs (Phases 1–5) merged to `main` (2026-07-17)

Every WP is implemented, gate-green (`pnpm typecheck && test && build && lint`), and merged. Migrations
**v32→v46** claimed one-at-a-time, each fresh-DB + upgrade-path tested. `main` @ `e28a52f`.
Delivered (consuming the merged `roadmap/unified-sessions/` session contract, never redefining it):
- **Phase 1 backbone:** RunFilter grammar (1.1) · metrics endpoints + indexes (1.2) · FTS5 search (1.3) ·
  saved views (1.4) · human-feedback primitive (1.5) · retention/pinned (1.6).
- **Phase 2 monitoring:** dashboard tabs (2.1) · testing dashboard 8 panels + drill-down (2.2) · runs
  feed upgrade (2.3) · sessions lens (2.4) · feedback UI (2.5) · pricing editor (2.6) · custom chart
  composer (2.7).
- **Phase 3 console depth:** step hierarchy wire (3.1) · tree StepLog + Gantt + economics (3.2) ·
  fork-from-step (3.3) · in-run search + lenses (3.4).
- **Phase 4 watch rules:** rules engine core (4.1) · windowed rules + catch-up + preview (4.2) ·
  notification center + webhook (4.3) · rules UI + promote-to-test (4.4) · review queue lite (4.5).
- **Phase 5 fleet issues:** issue aggregation + clustering + lifecycle (5.1) · LLM assist (5.2) · issues
  tab UI (5.3) · assistant issue loop (5.4) · scheduled digest (5.5).

**Doctrine held throughout:** derived-never-authoritative; D-OB14 capability-split series (never blended);
D-OB15/AR6 human feedback never in grades; the session contract consumed not redefined; migrations
serialized (one in flight); additive-only wire; brand-ui only; no new deps.

**Follow-ups / known gaps recorded in the log above (none blocking):** the `probe` step-hierarchy
emitter (3.1 — compat runner has no step surface, owner-decision); the on-demand promote-to-test REST
endpoint (`POST /api/runs/:id/promote-to-test`) the 4.4 console button stubs; the `grader` param for
`meanScore` + its picker (1.2/2.2); the `feedbackRate` metrics measure (1.5); the report-export
`humanFeedback` block (2.5); the fresh-DB migration-only-index pattern (1.6, platform); the GET
/api/issues → `aiAssisted` surfacing seam (5.2↔5.3); the shared-free consolidations from 5.4
(AssistantEntityKind / SCOPE_EXEMPT_ACTION_TOOLS / verification types); the `buildRunFilterWhere`
duplication (1.2). A `2296→fail-1` transient perf/timing flake under full-parallel `pnpm test` was seen
once (2.6) and did not reproduce across re-runs.

**NOT pushed to origin (owner-gated).** **Owner-acceptance pending** (see below) — every UI WP's both-theme
+ keyboard walk, and all live-credential walks (LLM judge-chain assist 5.2, assistant fix loop 5.4,
webhook test-fire 4.3, real fork 3.3, real digest 5.5) — none claimed by an agent.
═══════════════════════════════════════════════════════════════════════════════════════════════

- 2026-07-17 — **POST-WORKSTREAM OWNER-REQUESTED FIX: needs-attention as a RunFilter property** (main
  `50e2d3e`, `wp/observability/needs-attention-filter` @ `490a9dd`; base `1c73e14`, direct descendant).
  During the owner's acceptance walk of `/testing/runs`, the dense table looked "gone" — it was buried
  under the uncapped **"Needs attention" `<Card>`** (a `unified-sessions` WP3.3 surface, `bbf7b8e`, NOT
  observability), which lists every run matching `waiting-on-you OR (unseen AND !running)`; because
  `seen` defaults `false` for ALL runs (incl. legacy history), the card balloons to ~everything (49/86)
  and dominates the feed. Owner directive: **table is the primary view; needs-attention becomes a
  filterable property.** Delivered (ADDITIVE, **NO migration** — uses existing status/phase/seen): a
  `needsAttention` `RunFilter` field (canonical rule once in shared `runNeedsAttention`; `matchesRunFilter`
  + the web `needs-attention.ts` consume it; the run-repository + `metrics.ts` SQL replicas are
  byte-identical, COALESCE-guarded for NULL-safe negation — 3-way cross-check green), a filter-bar
  "Needs attention" chip + a saved-view preset, and **`NeedsAttentionSection` deleted from the feed**
  (`SessionDurationStats` keeps the shared rule). Gate green (typecheck · lint 1041 · test api 2329/web
  1634 · build) + typecheck on main post-merge. Owner: hard-refresh `:8080`; the table is now the top
  content and "Needs attention" is a toggle/preset. Owner-acceptance: both-theme + keyboard walk of the
  new chip/preset. (Note: a candidate further fix — tightening the underlying `runNeedsAttention` rule so
  unseen-completed/legacy runs stop qualifying — touches the locked unified-sessions D-US2 `seen`
  contract and was deliberately NOT done; the rule's meaning is unchanged, only exposed as a filter.)

- 2026-07-17 — **OWNER-ACCEPTANCE FINDING #2 FIXED: Testing dashboard crash ("Invalid time value")**
  (main `370c8c2`, `wp/observability/testing-crash-fix` @ `b6f5cde`; base `f8bc01e`, direct descendant).
  Opening `/dashboard?tab=testing` crashed the WHOLE tab into the error boundary. Root cause (WP2.2):
  `@brand/charts` Line/Area/Composed/Scatter DEFAULT `xDataKey` to `"date"`, but `pivotToRows` carries
  the timestamp under `x` (a Date) with no `date` field — so `ScoreTrendPanel`/`ScansStripPanel`/
  `DurationPanel` (+ `CustomChartCanvas`'s line branch) read `row.date` → `undefined` →
  `new Date(undefined)` → Invalid Date → the axis' `toISOString()` threw. Fix: those charts now set
  `xDataKey="x"` (matching `RunsErrorRatePanel`, already correct); `pivotToRows` drops invalid-Date
  buckets (degrade, don't crash). Web-only, additive, no wire/DB/migration. Gate green (typecheck ·
  lint 1042 · test web 1643/api 2329 · build). **⚠️ GATE BLIND SPOT (systemic — see memory
  [[chart-tests-mock-brand-charts-as-noop]]):** the existing panel suites mock `@brand/charts` as inert
  no-ops (jsdom can't render `@visx`), so a chart-PROP bug like a missing `xDataKey` passes
  typecheck/test/build and only crashes in a real browser. The new `time-axis-charts.test.tsx` uses a
  FAITHFUL stub (defaults `xDataKey` to `"date"` + runs `new Date(row[xDataKey]).toISOString()`) that
  reproduces the crash — fail-before/pass-after verified. Recommend extending this faithful-stub pattern
  to the other chart panels. The `IssueOccurrencesPanel` chart is a categorical `BarChart` → does NOT
  share this crash (confirms Finding #1 is layout-only). Owner: hard-refresh `:8080`; the Testing tab
  now loads. **→ Finding #1 (Issues tab overflow/readability) redesign is next.**

- 2026-07-17 — **OWNER-ACCEPTANCE FINDING #1 FIXED: Issues tab redesign** (main `8489a3e`,
  `wp/observability/issues-redesign` @ `89b2ebf`; base `820a14e`, direct descendant). The WP5.3 Issues
  tab crammed a 9-column table into a master-detail `SplitPane` left pane → overflow (titles spilled,
  `First/Last seen` dates wrapped char-by-char, occurrences-chart x-axis had overlapping duplicate
  labels). **Owner chose (via AskUserQuestion): full-width table + detail drawer** (match the runs
  feed). Delivered: `SplitPane` removed → `IssueTriageTable` is FULL-WIDTH; a row click opens
  `IssueDetail` (reused verbatim) in a `@brand/ui` `Sheet` drawer (`side=right`; Radix focus-trap /
  Esc-close / focus-return), driven by the EXISTING `?issue=` deep-link (notification links preserved;
  stale id self-clears). Dates → `formatRelativeTime` + `whitespace-nowrap` + full timestamp on hover.
  Occurrences chart → a bucket-granularity-aware distinct tick label (hour for hour buckets, compact
  month+day otherwise), still a categorical `BarChart`. Web-only, no wire/DB/migration. Gate green
  (typecheck · lint 1043 · test web 1650/api 2329 · build). Deviation: plain non-virtualized `DataTable`
  (the self-scrolling virtualized recipe renders an empty `<tbody>` under jsdom) — same pattern
  `ScansTab` uses, wrapper clips rather than overflowing the page. Owner: hard-refresh
  `/dashboard?tab=issues`; the table is full-width and a row opens a detail drawer. Owner-acceptance:
  both-theme + keyboard walk of the table + drawer + the fixed chart.
- 2026-07-17 — **[cross-session note]** the concurrent (assistant-hub) session is mid **`@brand/*`
  v1.6.0→v1.9.0 upgrade** (memory [[brand-ui-v190-upgrade]], UNCOMMITTED at this point). All my
  observability fixes forked from committed `main` (v1.6.0) and use only v1.6.0-compatible `@brand`
  APIs; the upgrade is reportedly fully additive (zero removed exports), so no conflict expected when
  it lands. Re-verify the gate on `main` after that upgrade commits.

## Owner-acceptance (pending — grows as WPs land)

- Both-theme (`qlik-bright`/`qlik-dark`) + keyboard walks: Dashboard tabs, runs feed filter bar,
  rules UI, notification center, issues tab, review queue, pricing editor, sessions lens.
- Live walks needing real credentials/tenants: judge-chain LLM clustering assist (5.2);
  assistant issue loop (5.4); webhook test-fire to a real Slack endpoint.
- Data-quality spot-checks: FTS relevance on a real corpus; metrics drill-down counts match the
  runs feed; capability-split series render honestly for a mixed suite (API + CLI + qlik).
- Session-contract walks (End session, waiting, stall/expiry, seen) belong to
  `roadmap/unified-sessions/` — not duplicated here.
