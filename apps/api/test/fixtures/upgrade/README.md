# Upgrade-path fixture databases

Committed SQLite files that `apps/api/test/upgrade-fixtures.test.ts` opens, migrates through the
real open path, and asserts invariants against. They run inside `pnpm test` — there is no separate
command and no opt-in flag.

Generator: [`apps/api/scripts/build-upgrade-fixtures.ts`](../../../scripts/build-upgrade-fixtures.ts)

```bash
pnpm --filter @mcp-token-footprint/api run fixtures:upgrade
```

---

## Why these exist

`apps/api/test/migrations.test.ts` already covers *what each migration step does*, in detail. But
every "old database" in it is **simulated by rewinding a new one**: create at the latest shape from
`schema.ts`, drop a table/column/index, re-stamp `PRAGMA user_version` backwards.

That has one blind spot no extra assertion can close. The "old" shape is **re-derived from today's
`schema.ts` on every test run**, so both sides of any comparison move together — a rewind test can
never notice that the baseline schema and the migration chain have drifted apart. It is also
structurally unable to represent a table today's schema has never heard of (the v10-era
`session_traces` pair that v12 drops), or a `CHECK`/`DEFAULT` that used to be different.

The files here are **frozen binaries**. They never re-derive from anything. Add a column to
`schema.ts` without a matching migration step and the harness's migrated-vs-fresh comparison goes red
against every fixture that carries that table.

That is not theoretical: writing these fixtures found a live defect in migration **v5**
(`run_feedback` ended up referencing a dropped `run_steps_old` on any database still below v5,
making the whole human-feedback surface unwritable). See the note at `widenRunStepsTypeCheck` in
`apps/api/src/db/database.ts`.

---

## Provenance — read this before trusting a fixture

These are **not archaeologically recovered** databases, and the generator says so at the top of the
file. This repository's git history was squashed: the earliest commit already carries
`LATEST_SCHEMA_VERSION = 55`, so no pre-v55 `schema.ts` survives anywhere in it.

The DDL is **authored**, as frozen strings inside the generator, from three records the repository
does carry:

1. the pre-versioning snapshot the project already wrote down as `OLD_SCHEMA_SQL` in
   `apps/api/test/migrations.test.ts`;
2. each migration's own `CREATE TABLE` / `ADD COLUMN` text in `apps/api/src/db/database.ts` — a table
   introduced by migration *vN* is reproduced from *vN*'s body, which **is** the historical record
   for it;
3. for tables no migration has touched since their era, the current `schema.ts` text, copied in as
   frozen text.

The generator deliberately does **not** import `schemaSql` for the authored fixtures — importing it
would recreate exactly the rewind blind spot these files close. The one exception is
`v61-at-capture.sqlite`, which is *captured* from the app's own open path and then frozen; that is
stated in its entry below.

---

## The fixtures

| File | `user_version` | What it buys |
| --- | --- | --- |
| `v00-preversioning.sqlite` | 0 | The real historical starting point — a database from before `PRAGMA user_version` existed, carrying the v10-era `session_traces` / `session_trace_events` tables that v12 drops. Exercises the **entire** v1→latest chain against real rows: v5's `run_steps` rebuild, v12's drop, v23/v28's `provider_credentials` rebuilds, v27's `rating_state` backfill, v31's `runs` rebuild, v44's pricing seed, v59's three-way cache backfill. |
| `v12-pre-v13.sqlite` | 12 | The item's own named case. `tests` has none of the graded columns; neither `run_grades` nor `app_settings` exists yet. Built from the v0 base plus an authored replay of migrations v1–v12. |
| `v15-pre-v16.sqlite` | 15 | The v16 **double table rebuild** — a git-bound collection with a member test *and* a member suite, plus an old-shape (`NOT NULL suite_id`) `suite_runs` row, so "did the rebuild blank membership?" is a real question. Also the only fixture carrying base-rating `run_grades`, so v27's backfill has to answer `rated` as well as `skipped`. |
| `v50-pre-v51.sqlite` | 50 | Migration v51's `hub_sessions` rebuild — the one rebuild that copies its columns **by name** from a live intersection, with two `ALTER`-appended columns (v49 `archived_at`, v50 `tool_scope_json`) sitting out of baseline order, a self-referencing parent/child session pair, and a child `hub_events` table. |
| `v55-pre-v56.sqlite` | 55 | The chain's only **destructive** step (v56 deletes a retired-kind credential together with its environments and runs, narrows the `kind` CHECK, and `DROP COLUMN`s two columns) plus v57's deep-link rewrite. Neither is reachable from a pre-versioning fixture: both act on tables and values that only exist from v23 / v40 onward. |
| `v61-at-capture.sqlite` | 61 | **Captured, not authored** — and, since RM-30 WP 7.8's v62 landed, exactly the self-renewal this row predicted: it is now the **pre-v62** fixture, and its `EXPECTATIONS` entry is pinned to the literal `v61-at-capture` (it no longer follows `LATEST_SCHEMA_VERSION` around) and asserts what v62 did to it — a new, EMPTY `skill_box_positions` and nothing else. `schemaSql` + `applyMigrations` were run once at generation time and the result frozen. It carries **every** table, so the migrated-vs-fresh comparison sees a `schema.ts` change on *any* table, not only the handful an old fixture happens to contain — which matters, because v5 and v31 rebuild `run_steps`/`runs` *from today's `schemaSql`*, and therefore mask column drift on those two tables for every fixture that passes through them. It is also self-renewing: the moment a migration lands, this file sits below the new latest and becomes a free pre-v*NEXT* fixture. |
| `v62-at-capture.sqlite` | 62 | **Captured, not authored.** `schemaSql` + `applyMigrations` were run once at generation time and the result frozen. It carries **every** table, so the migrated-vs-fresh comparison sees a `schema.ts` change on *any* table, not only the handful an old fixture happens to contain — which matters, because v5 and v31 rebuild `run_steps`/`runs` *from today's `schemaSql`*, and therefore mask column drift on those two tables for every fixture that passes through them. It is also self-renewing: the moment a migration lands, this file sits below the new latest and becomes a free pre-v*NEXT* fixture. |

Every version **not** listed is a deliberate skip, not an omission: each is a purely additive
`ensureColumn` or `CREATE TABLE/INDEX IF NOT EXISTS`, and every one of them is executed by
`v00-preversioning.sqlite` on its way from 0 to latest.

## Two of the fixtures are deliberately minimal

`v50-pre-v51` and `v55-pre-v56` carry only the tables their target migrations act on; `schemaSql`
creates the rest when the database is opened. That is a pattern the migration code explicitly
supports — the "a MINIMAL migration-test fixture may not have created X" guards scattered through
`MIGRATIONS` exist for exactly it.

It has one sharp edge worth knowing before you add another minimal fixture: **several indexes live
only in a migration and never in `schema.ts`** — `idx_tests_extkey` / `idx_suites_extkey` (v15),
`idx_runs_suite_run` (v19), `idx_runs_pinned` (v35), `idx_run_steps_parent_step_id` (v37),
`idx_rating_issues_cluster` (v41), `idx_runs_derived_from` (v42). That is deliberate (`schemaSql`
runs its `CREATE INDEX` statements *before* the migration that adds the column they index). A fixture
stamped **above** those versions must therefore bring those tables *and their indexes* with it,
exactly as a real database of that vintage would — otherwise the harness reports a missing index that
no real user could ever hit. The shared late-era DDL block in the generator does this.

---

## Nothing here is a secret

No row is ever copied from `data/app.sqlite`. Every value that occupies a secret-shaped column
(`*_encrypted`, `tokens_json`, `code_verifier`, `token_hash`, `api_key`, `encrypted_value`) is the
single inert literal `fixture-placeholder-not-a-secret`, and the harness asserts that — it walks
every table in every fixture and fails if any such column holds anything else.

---

## Regenerating

```bash
pnpm --filter @mcp-token-footprint/api run fixtures:upgrade
git status                    # should be clean — the files are byte-deterministic
```

Every id, timestamp and payload in the generator is a literal, the page size is pinned to 512 bytes,
and each file is `VACUUM`ed before its `user_version` is stamped, so two runs produce byte-identical
files. (Verified: `shasum -a 256 *.sqlite` before and after a regeneration matched exactly.)

> **Do not regenerate an existing fixture to make a failing migration pass.** A fixture is frozen
> evidence of a shape that was on disk; rewriting it to match new code turns the harness back into
> the rewind test it was built to replace. If a fixture goes red, either the migration is wrong or
> the fixture was wrong about history — decide which, and say so in the change.

## Adding a fixture for a new migration

1. Add a `FixtureSpec` entry to `apps/api/scripts/build-upgrade-fixtures.ts`: a name of the form
   `vNN-<what-it-proves>`, the `user_version` to stamp, a one-line `why`, and a `build` that lays
   down the era DDL and seeds **rows in the tables your migration touches** — the rows are the point,
   an empty schema proves almost nothing.
2. Run the generator and commit the `.sqlite` file.
3. Add a matching entry to `EXPECTATIONS` in `apps/api/test/upgrade-fixtures.test.ts`. The harness
   **fails if a fixture has no entry**, so this step cannot be skipped. Declare any
   `droppedTables` / `droppedColumns` / `rewrittenColumns` / `deletedRows` your migration causes —
   each of those is an exemption on the record, and a `alsoProve` callback should assert what the value
   *became*, so an exemption never becomes a place to hide a mutation.
4. Add the row to the table above.

After a migration lands, also re-run the generator once: it emits a new `v<LATEST>-at-capture.sqlite`
for the new latest version. Commit it and **keep the old one** — the previous at-capture file is now
a genuine pre-v*NEW* fixture.

---

## What the harness asserts, per fixture

1. the file is stamped at the version its name claims, and below `LATEST_SCHEMA_VERSION`;
2. after the open path, `user_version` is `LATEST_SCHEMA_VERSION`;
3. `PRAGMA foreign_key_check` is empty and `PRAGMA integrity_check` returns `ok`;
4. no table loses a row, except where a deliberate deletion is declared — and there the count is
   pinned **exactly**, so a destructive migration's blast radius is an asserted number;
5. every probed row is still findable by id with **every** pre-migration column value intact;
6. the migrated schema matches a freshly created one — table set, per-table columns (by name:
   type · nullability · default · pk), per-table `CHECK` constraints, per-table foreign keys, and the
   full index set;
7. `ScanRepository` and `RunRepository` can read the result without throwing;
8. running the whole open path a **second** time changes neither the schema nor any row count.

The schema comparison in (6) is **structural, not textual**, on purpose: `ensureColumn` uses
`ALTER TABLE … ADD COLUMN`, which appends to the persisted `CREATE TABLE` statement, while
`schema.ts` declares the same column in the middle surrounded by comments. Comparing raw
`sqlite_master.sql` would fail on every upgrade path for a reason that is not a defect. Column
**order** is the one thing allowed to differ.
