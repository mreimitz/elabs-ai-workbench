# WP 1.0 — Shared contract + API dependencies

**Phase:** 1 · **Size:** M · **Depends on:** —

## Objective
Define **every wire shape** for Skills in `packages/shared` before any API/web work (contract-first),
and add the owner-approved API dependencies. This is the single source of truth both ends import, so
no later WP reshapes the contract.

## Why / references
[`../../research/skill-registry/05-api-surface.md`](../../research/skill-registry/05-api-surface.md)
(types + zod), `03` (data model), `10` (decisions: deps approved). Mirror the existing style in
`packages/shared/src/{types,schemas,constants}.ts` (discriminated unions, `z.enum`, `.default`,
`superRefine`).

## Files
- `packages/shared/src/constants.ts` *(modify)* — `SKILL_SOURCE_TYPES`, `SKILL_FILE_KINDS`,
  `SKILL_VERSION_MODES`, size-cap constants (`SKILL_MAX_FILE_BYTES`, `SKILL_MAX_TOTAL_BYTES`,
  `SKILL_MAX_FILES`).
- `packages/shared/src/types.ts` *(modify)* — `SkillSourceType`, `SkillManifest`, `Skill`,
  `SkillTokenFootprint`, `SkillVersion`, `SkillFileNode`, `SkillFileContent`, `SkillDiffEntry`,
  `SkillDiff`, `SkillRepoProbe`, `AllowedSkill`, `SkillVersionMode` (per `05`/`08`).
- `packages/shared/src/schemas.ts` *(modify)* — `githubImportSchema`, `uploadImportSchema`,
  `skillImportSchema` (discriminatedUnion on `source`), `skillUpdateSchema`, `skillRepoProbeSchema`,
  `allowedSkillSchema` (with `superRefine`: pinned ⇒ `pinnedVersionId`).
- `packages/shared/src/index.ts` *(modify — re-export)*.
- `apps/api/package.json` *(modify)* — add `@fastify/multipart`, `fflate`, `diff`, `yaml`
  (+ `@types/diff` dev). `pnpm install`.

## Acceptance
- [ ] All Skills types + zod schemas exist in `packages/shared` and are re-exported from `index.ts`;
      `AllowedSkill`/`SkillVersionMode` present for Phase 2.
- [ ] Zod ↔ TS parity: each `*Input`/`*Schema` matches its type; `allowedSkillSchema` rejects
      `versionMode:"pinned"` without `pinnedVersionId`.
- [ ] The four deps are in `apps/api/package.json` and installed; lockfile updated.
- [ ] `pnpm --filter @mcp-token-footprint/shared build` green; repo gate
      `pnpm typecheck && pnpm test && pnpm build` green.

## Notes
No API/web behavior yet — pure contract + deps. Keep `Skill` redacted (`hasAuth` boolean, never the
PAT). Additive only; do not touch server/scenario shapes here (Phase 2 extends `Scenario` in WP 2.1).
