# Phase 1 — Contract & data foundations (WP specs)

## WP 1.1 — Shared contract: optional repo binding, `isDefault`, inline run-plan
**Size:** M · **Depends on:** — · shared-only (batch 1, parallel-safe with 1.2)

**Objective:** all wire shapes for this workstream, additive, in one place — so API and web WPs
never touch `packages/shared` again (keeps later batches parallel-safe).

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`,
`packages/shared/src/constants.ts`.

**Semantics:**
- `collectionInputSchema` (`schemas.ts` ~line 391): repo binding becomes an **optional group** —
  either `repoUrl` + `repoPath` + `branch` all present, or none (`z.refine`); `pat` only valid
  with a binding. `Collection` type gains `isDefault: boolean` and nullable repo fields;
  redaction unchanged (PAT write-only).
- New **run-plan** input (name it `runPlanInputSchema`): `{ source: 'suite'|'collection'|'adhoc',
  suiteId? , collectionId?, testIds?, scenarioIds (min 1), repetitions?, costCap?, … }` mirroring
  the existing suite-run knobs — discriminated so exactly one source shape validates. Response
  types reuse the existing suite-run shapes (additive fields only, e.g. `source` on the
  suite-run summary).
- Constants: reserved default-collection name (`"Local"`), typed error code for unbound git
  sync (e.g. `REPO_NOT_BOUND`).

**Acceptance:** typecheck green across all packages with **zero** API/web behavior changes;
old collection payloads (full binding) still validate; a binding-less payload validates; mixed
partial binding fails; run-plan schema round-trips all three sources; gate green.

## WP 1.2 — Migration vNEXT: nullable repo columns, Local seed, member backfill
**Size:** M · **Depends on:** — (claim the migration number per D-T6; if D-T5 is accepted,
include its columns here — one migration, not two) · API-only (batch 1)

**Objective:** bring an existing DB forward: local collections possible, a default "Local"
collection guaranteed, no member left collection-less.

**Files:** `apps/api/src/db/schema.ts`, `apps/api/src/db/database.ts`,
`apps/api/test/migrations.test.ts`.

**Semantics:** make `collections.repo_url`/`repo_path`/`branch` nullable + add `is_default`
(0/1, exactly one row enforced app-level); seed/guarantee "Local" idempotently on startup
(fresh DB and upgraded DB both end with it); backfill `tests.collection_id IS NULL` → Local and
`suites.collection_id IS NULL` → Local. If D-T5 accepted: `suite_runs.suite_id` nullable +
`source` + `plan_json` columns in the same migration. Fresh-DB path stamps
`LATEST_SCHEMA_VERSION` as today.

**Acceptance:** migration test with a pre-vNEXT fixture proves: git-bound collections keep all
fields; Local appears exactly once (also after a second startup); loose tests/suites land in
Local; fresh DB equals upgraded DB shape (mirror the existing pattern in
`apps/api/test/migrations.test.ts`); gate green.
