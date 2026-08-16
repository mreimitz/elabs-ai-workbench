# WP 0.2 — Migration v54 + repository mission-tree lineage

**Phase:** 0 — Contract & foundation · **Size:** M · **Depends on:** 0.1 · **Model:** Opus

## Objective
Give `hub_missions` the structural lineage a runtime-recursive crew tree needs, implementing **D-CN6**: an additive migration **v54** adds three nullable columns — `parent_mission_id` (self-FK `ON DELETE CASCADE`), `depth` (`INTEGER NOT NULL DEFAULT 0`), `root_mission_id` (denormalised, for O(1) whole-tree rollup) — and the repository learns to write and read them (`createMission`/`toMission` + new `listChildMissions`/`getMissionTree`). The `members_json`/`plan_json` blobs need **no** migration (the `skill_ids_json` precedent). Every mission in a tree keeps `session_id = the root chat session`; the tree is expressed *only* by `parent_mission_id`, so the `kind:'chat'` propose gate and `hub_sessions.kind` are **not** relaxed (D-CN1/D-CN6).

## Why / references
- **D-CN6** — `v54` adds mission-tree lineage; blobs need no migration; session parent/child chain reused as-is; `session_id` stays the root chat session; re-confirm `v54` is still free at claim time.
- **D-CN5** — the wire additions (`parentMissionId?`, `depth?` on `HubMission`) are owned by WP 0.1 (this WP's dependency); `rootMissionId` is a DB-only denormalisation, **not** a wire field.
- **D-CN2** — sub-missions are materialised as child `hub_missions` rows level-by-level (this WP builds their storage substrate; the recursion engine that writes them is WP 2.1).
- `apps/api/src/db/database.ts` — `MIGRATIONS` array (head **v53** at `:1584`), `LATEST_SCHEMA_VERSION` auto-derive `:1597`, `applyMigrations` `:1611` (runs with `foreign_keys = OFF`, then `foreign_key_check`), `ensureColumn` `:1976`; v50/v52/v53 additive `ensureColumn` pattern `:1542–1592`; version-literal test-lock note `:438`.
- `apps/api/src/db/schema.ts` — `hub_missions` DDL `:1136–1152` (**no `parent_mission_id`/`depth`/`root_mission_id` today**).
- `apps/api/src/db/rows.ts` — `HubMissionRow` `:861–875`; `skill_ids_json` no-migration precedent `:763–766`.
- `apps/api/src/hub/repository.ts` — `HubMissionCreateInput` `:161`, `createMission` `:900`, `getMissionRow` `:1480` (`SELECT *`), `getMissionBySession` `:931`, `listMissions` `:942`, `updateMission` `:949`, `toMission` `:1666`.

## Design

**1 — Claim v54.** Re-confirm at claim time that **v54 is the next free `PRAGMA user_version`**: head of `MIGRATIONS` is `version: 53` (`database.ts:1584`) and no sibling `roadmap/*/STATUS.md` has taken v54. `LATEST_SCHEMA_VERSION` auto-derives from the last entry, so **append** (highest last) — never insert mid-array.

**2 — Fresh DDL (`schema.ts`).** Add the three columns to the `CREATE TABLE IF NOT EXISTS hub_missions` block, matching the existing column style:
```sql
parent_mission_id  TEXT REFERENCES hub_missions(id) ON DELETE CASCADE,
depth              INTEGER NOT NULL DEFAULT 0,
root_mission_id    TEXT,
```
No CHECK on any of them (the pinned scope: these need none). This is the **CHECK-in-baseline-only** discipline stated for form even though there is no CHECK to place.

**3 — Migration v54 (`database.ts`).** Append one `MIGRATIONS` entry, copying the v50/v52/v53 shape verbatim — a `hasTable("hub_missions")` guard (minimal migration-test fixtures below v47 lack the table) wrapping three `ensureColumn` calls:
```ts
ensureColumn(db, "hub_missions", "parent_mission_id", "TEXT REFERENCES hub_missions(id) ON DELETE CASCADE");
ensureColumn(db, "hub_missions", "depth", "INTEGER NOT NULL DEFAULT 0");
ensureColumn(db, "hub_missions", "root_mission_id", "TEXT");
```
SQLite `ALTER TABLE … ADD COLUMN` **permits** a self-referential FK column *provided its default is NULL* (it is — nullable, no default) and permits `NOT NULL` when a non-NULL default is given (`DEFAULT 0`). The migration runs under `foreign_keys = OFF`; existing rows get `parent_mission_id = NULL`, `depth = 0`, `root_mission_id = NULL`, so the `foreign_key_check` before commit finds no violation. Give the block a rationale comment in the v50/v52/v53 voice ("Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 54").

**4 — Row type (`rows.ts`).** Extend `HubMissionRow`: `parent_mission_id: string | null; depth: number; root_mission_id: string | null;`. `getMissionRow`/`listMissions`/`getMissionBySession` all do `SELECT *`, so they pick the columns up with no query change.

**5 — Repository create/read (`repository.ts`).**
- `HubMissionCreateInput` += `parentMissionId?: string; depth?: number; rootMissionId?: string;` — all optional; **every existing caller passes nothing** (they compile unchanged).
- `createMission`: the `id = nanoid()` is already minted before the INSERT. Extend the INSERT column list + `VALUES` + params:
  - `parent_mission_id = @parentMissionId` ← `input.parentMissionId ?? null`
  - `depth = @depth` ← `input.depth ?? 0`
  - `root_mission_id = @rootMissionId` ← `input.rootMissionId ?? id` — **a root mission (no `rootMissionId` given) self-references its own id**, so a later `WHERE root_mission_id = @root` returns the whole tree including its root. A child passes the parent's `rootMissionId` down (the recursion engine, WP 2.1, does this).
- `toMission`: surface **`parentMissionId: row.parent_mission_id ?? undefined`** and **`depth: row.depth`** onto the wire object (these fields exist on `HubMission` from WP 0.1). Do **not** put `rootMissionId` on the wire — per D-CN5 it is not a wire field; it stays DB-internal. (If, and only if, WP 0.1 already surfaced `rootMissionId` on `HubMission`, map it too; otherwise leave the shared type untouched — this WP is SOLO on `apps/api/src/db` and must not open a fresh `packages/shared` contract edit.)
- `updateMission` is **unchanged**: its `UPDATE` statement never lists the three lineage columns, so they are create-time-immutable and preserved (the map's "unchanged unless depth/parent become mutable — they should not").
- New read helpers:
  - `listChildMissions(parentMissionId: string): HubMission[]` → `SELECT * FROM hub_missions WHERE parent_mission_id = ? ORDER BY created_at` → `.map(toMission)` (direct children only).
  - `getMissionTree(rootMissionId: string): HubMission[]` → `SELECT * FROM hub_missions WHERE id = @root OR root_mission_id = @root ORDER BY depth, created_at` → `.map(toMission)`. The `id = @root OR` arm makes it return the root even for a legacy pre-v54 root whose `root_mission_id` is NULL; callers rebuild the tree from `parentMissionId`.

**6 — Cascade.** Because `parent_mission_id` carries `ON DELETE CASCADE`, deleting a parent mission row removes its subtree without touching siblings. The pre-existing `hub_missions.session_id → hub_sessions ON DELETE CASCADE` path is untouched: since all missions in a tree share `session_id = the root chat session`, deleting that session still cascades the entire tree.

**7 — Version-literal test locks.** Adding v54 changes `LATEST_SCHEMA_VERSION` from 53→54, breaking every hard-coded `53` assertion. **Grep `apps/api/test` for `user_version` / `auto-derived to 53` / `stamped at 53` and bump every one to 54**, appending `v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage` to each migration-list description string. Known files (verify exhaustively at claim time — a sibling plan may add more): `benchmarks-collections-contract.test.ts`, `benchmarks-contract.test.ts`, `benchmarks-suites-contract.test.ts`, `dashboard-charts.test.ts`, `hub-repository.test.ts`, `migrations.test.ts`, `notifications.test.ts`, `rating-issues.test.ts`, `run-views.test.ts`, `review-rubrics.test.ts`, `skill-ide-server-binding.test.ts`, `watch-windowed.test.ts`.

## Files
- `apps/api/src/db/schema.ts` *(modify)* — add `parent_mission_id`/`depth`/`root_mission_id` to the `hub_missions` `CREATE TABLE` (no CHECK).
- `apps/api/src/db/database.ts` *(modify)* — append `MIGRATIONS` entry `version: 54` (three `hasTable`-guarded `ensureColumn` calls); `LATEST_SCHEMA_VERSION` auto-derives to 54.
- `apps/api/src/db/rows.ts` *(modify)* — `HubMissionRow` += `parent_mission_id`/`depth`/`root_mission_id`.
- `apps/api/src/hub/repository.ts` *(modify)* — `HubMissionCreateInput` += `parentMissionId?`/`depth?`/`rootMissionId?`; `createMission` INSERT the three columns (root self-references its id); `toMission` maps `parentMissionId`+`depth`; add `listChildMissions` + `getMissionTree`; `updateMission` left untouched.
- `apps/api/test/hub-repository.test.ts` *(modify)* — new WP-0.2 coverage: v54 fresh-DB + v53→v54 upgrade paths, column presence, root/child create semantics, `listChildMissions`/`getMissionTree`, parent-mission cascade; bump its 53 locks.
- `apps/api/test/migrations.test.ts` *(modify)* — bump 53 locks to 54, append the v54 description.
- `apps/api/test/benchmarks-collections-contract.test.ts`, `apps/api/test/benchmarks-contract.test.ts`, `apps/api/test/benchmarks-suites-contract.test.ts`, `apps/api/test/dashboard-charts.test.ts`, `apps/api/test/notifications.test.ts`, `apps/api/test/rating-issues.test.ts`, `apps/api/test/run-views.test.ts`, `apps/api/test/review-rubrics.test.ts`, `apps/api/test/skill-ide-server-binding.test.ts`, `apps/api/test/watch-windowed.test.ts` *(modify)* — bump every `53` version-literal lock to `54` + append the v54 migration-list entry.

## Acceptance
- [ ] `v54` re-confirmed free at claim time (`database.ts` head is v53; no sibling `roadmap/*/STATUS.md` claims v54); the migration is **appended** last so `LATEST_SCHEMA_VERSION === 54`.
- [ ] A fresh DB stamps `user_version === 54` and `PRAGMA table_info(hub_missions)` contains `parent_mission_id`, `depth`, `root_mission_id`.
- [ ] The v54 migration is three `hasTable("hub_missions")`-guarded `ensureColumn` calls; re-running `applyMigrations` on a v54 DB is a no-op (version stays 54).
- [ ] A DB rebuilt at the pre-v54 `hub_missions` shape (no lineage columns), stamped `user_version = 53`, then `applyMigrations`'d, ends at 54 with the three columns present; a pre-existing (legacy) mission row survives and reads back via `toMission` with `parentMissionId === undefined`, `depth === 0` (migrated rows default to 0), and is returned by `getMissionTree(itsId)`.
- [ ] `createMission` with no lineage input → a root: DB row has `parent_mission_id IS NULL`, `depth = 0`, `root_mission_id = its own id`; `toMission` yields `parentMissionId === undefined`, `depth === 0`.
- [ ] `createMission` with `parentMissionId`/`depth`/`rootMissionId` persists all three; `toMission` surfaces `parentMissionId` and `depth`; `rootMissionId` is **not** added to the `HubMission` wire type by this WP.
- [ ] `listChildMissions(parentId)` returns only the direct children of `parentId`; `getMissionTree(rootId)` returns the whole tree including the root (ordered by `depth` then `created_at`).
- [ ] Deleting a parent mission row (`foreign_keys` ON) cascades to its subtree via `parent_mission_id ON DELETE CASCADE` (child rows gone, unrelated missions untouched); deleting the owning chat session still cascades every mission sharing its `session_id`.
- [ ] `updateMission` does not write `parent_mission_id`/`depth`/`root_mission_id` (they are create-time-immutable and preserved across an update).
- [ ] A repo-wide grep of `apps/api/test` for `user_version`/`53` version-literal locks leaves none asserting 53; each migration-list string carries the appended `v54 = hub_missions.parent_mission_id/depth/root_mission_id` entry.
- [ ] `hub_sessions.kind` and the `kind:'chat'` propose gate are untouched; no `packages/shared` contract edit is introduced by this WP (the wire fields come from WP 0.1).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **SOLO** — `apps/api/src/db/*` is a contested hot area (schema.ts + database.ts + rows.ts). Run this WP alone per the conventions checklist; it depends only on WP 0.1 (the contract) and is a prerequisite for 1.1 and 2.1, both of which land after it, so there is no concurrent writer to these files.
- **Additive-only, no wire edit:** every column is nullable/defaulted so existing rows and callers are valid; the only shared-type surface this WP consumes (`HubMission.parentMissionId?`/`depth?`) is added by WP 0.1 — do not open a second contract change here (D-CN5).
- **No new index:** the pinned scope is columns-only, and the map notes missions are rare enough that full scans are cheap (`listMissions` already scans); `listChildMissions`/`getMissionTree` follow suit. Do not add `idx_hub_missions_parent`/`_root` unless a later WP demonstrates a hot query.
- **No propose-gate relaxation (D-CN1/D-CN6):** this WP only provisions storage; sub-mission rows are created by the deterministic recursion engine in WP 2.1, never by an agent tool. Nothing here touches `orchestrator.ts` or `hub_sessions.kind`.
- The `rootMissionId ?? id` self-reference for roots is the load-bearing detail that makes `getMissionTree` a single indexed-equality scan later; keep it even though the root's own id is redundant.
