# WP 1.1 — DB schema + repository (blob store, createVersion, delete-guard, GC)

**Phase:** 1 · **Size:** L · **Depends on:** 1.0

## Objective
Persist skills with the content-addressed blob model and a `createVersion` routine shared by upload
and GitHub ingestion, plus the public/internal redaction split and blob GC.

## Why / references
[`../../research/skill-registry/03-data-model.md`](../../research/skill-registry/03-data-model.md)
(DDL, invariants), `04` (createVersion routine, tree_sha), `conventions.md` (storage, secret
boundary). Mirror `apps/api/src/servers/repository.ts` + `db/database.ts` migration helpers.

## Files
- `apps/api/src/db/schema.ts` *(modify)* — `skills`, `skill_versions`, `skill_blobs`, `skill_files`
  tables + indices (exact DDL in `03`). (Leave `scenario_skills` to WP 2.1.)
- `apps/api/src/db/database.ts` *(modify)* — `ensureColumn` migrations for any additive columns.
- `apps/api/src/db/rows.ts` *(modify)* — row types for the new tables.
- `apps/api/src/skills/repository.ts` *(create)* — `SkillRepository(db, secrets)`:
  `list/getPublic/getInternal/create/update/delete`, `listVersions/getVersion`, `listFiles`,
  `getFileContent(versionId, path)`, `createVersion(skillId, files, meta)` (blob upsert, tree_sha,
  no-op when unchanged), `deleteVersion` + `deleteSkill` (block-delete hook + GC), `nanoid` ids,
  PAT via `SecretStore`, public redaction (`hasAuth`).
- `apps/api/src/skills/repository.test.ts` *(create)*.

## Acceptance
- [ ] Tables + indices created idempotently on boot; FK cascade skill→versions→files; round-trip test
      passes (insert skill+version+files, reload equal).
- [ ] `createVersion` dedupes blobs (identical file across versions stores one `skill_blobs` row) and
      returns `{ unchanged: true }` when `tree_sha` matches the current version.
- [ ] `getPublic`/`list` never expose the PAT (only `hasAuth`); `getInternal` decrypts for API use.
- [ ] Deleting a skill/version cascades files and GCs orphan blobs (no orphan `skill_blobs` remain);
      a `versionPinnedBy(versionId)` helper exists for the WP 2.1 delete-guard (returns [] in Phase 1).
- [ ] Repo gate green; `repository.test.ts` covers dedupe, tree_sha no-op, redaction, GC.

## Notes
Enforce `foreign_keys` pragma (already set in `openDatabase`). Binary detection (NUL byte / invalid
UTF-8) sets `is_binary`; token counting is WP 1.2 (store 0 here, backfilled by the ingest path).
