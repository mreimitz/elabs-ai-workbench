# WP 1.3 — Upload ingestion + core routes + export

**Phase:** 1 · **Size:** L · **Depends on:** 1.2

## Objective
Ingest uploads (`.zip` or a lone `SKILL.md`) into a first version, and expose the core Skills API
(list/get/create/update/delete, versions, files, file content, raw, export `.zip`). This is the
vertical slice that makes the feature real on the backend.

## Why / references
[`../../research/skill-registry/06-ingestion-and-github.md`](../../research/skill-registry/06-ingestion-and-github.md)
(upload path, caps), `05` (routes + `apiUpload`), `10` (accept both `.zip` and bare `SKILL.md`;
export). Mirror `apps/api/src/servers/routes.ts` registration + `index.ts` wiring.

## Files
- `apps/api/src/skills/ingest-service.ts` *(create)* — `ingestUpload(buffer, filename)`: unzip with
  `fflate` (enforce `SKILL_MAX_FILES`/`_FILE_BYTES`/`_TOTAL_BYTES`), locate the dir containing
  `SKILL.md` (root or nested one level; reject multi-`SKILL.md` archives), or accept a lone
  `SKILL.md`; rebase paths; call `parseSkillManifest` + `countLevels`; `repo.createVersion`.
  `exportVersionZip(versionId)`: rebuild a `.zip` from blobs with `fflate.zipSync`.
- `apps/api/src/skills/routes.ts` *(create)* — `registerSkillRoutes(app, repo, ingest)`:
  `GET/POST/GET:id/PUT:id/DELETE:id /api/skills`; `GET /:id/versions`, `POST /:id/versions`
  (multipart), `GET /:id/versions/:vid`, `GET /:id/versions/:vid/files`, `GET
  /:id/versions/:vid/file?path=`, `GET /:id/versions/:vid/raw?path=`, `GET
  /:id/versions/:vid/export`. Register `@fastify/multipart` with the size cap.
- `apps/api/src/index.ts` *(modify)* — construct `SkillRepository` + ingest service; register routes.
- `apps/api/test/skills-upload.test.ts` *(create)*.

## Acceptance
- [ ] `POST /api/skills` multipart with a `.zip` → 201 `Skill` + v1; a lone `SKILL.md` upload also
      works; re-uploading identical bytes → `{ unchanged: true }`; changed upload → v2.
- [ ] Oversized archive / too many files / no `SKILL.md` / multi-skill archive → 400 with a clear
      message (no partial rows).
- [ ] Files list + file content endpoints return the tree and text/binary correctly; `export` streams
      a valid `.zip` that round-trips (unzips to the same tree).
- [ ] Routes registered in `index.ts`; `ZodError→400` via the central handler; secrets never
      returned. Keyless API test covers create/version/files/export; repo gate green.

## Notes
Temp files under `DATA_DIR/tmp/<nanoid>/`, cleaned in `finally`. GitHub creation (`source:"github"`)
and `pull`/`upstream` land in WP 1.4 (this WP leaves the `create` route's github branch as a stub
that 501s or is added by 1.4 — coordinate: 1.4 owns the github routes, 1.3 owns upload + shared
routes). Diff routes are WP 1.5.
