# WP 2.1 — Contract + persistence (`scenario_skills`, delete-guard)

**Phase:** 2 · **Size:** M · **Depends on:** 1.1, 1.3

## Objective
Let a scenario attach skills (latest or pinned) by mirroring `scenario_servers`, and enforce the
block-delete guard so a pinned version can't be deleted out from under a scenario.

## Why / references
[`../../research/skill-registry/08-scenario-attachment.md`](../../research/skill-registry/08-scenario-attachment.md)
(contract + persistence), `10` Q6 (block delete). Mirror `apps/api/src/testing/scenario-repository.ts`
(`replaceServers`/`hydrate`) and the existing `scenario_servers` join.

## Files
- `apps/api/src/db/schema.ts` *(modify)* — `scenario_skills` table (from `03`) + index.
- `packages/shared/src/{types,schemas}.ts` *(modify)* — extend `Scenario`/`ScenarioInput` with
  `allowedSkills: AllowedSkill[]`; `scenarioInputSchema` gains `allowedSkills` (default `[]`).
  (`AllowedSkill`/`allowedSkillSchema` already exist from WP 1.0.)
- `apps/api/src/testing/scenario-repository.ts` *(modify)* — `replaceSkills()` in the create/update
  transaction; `listSkills()`; `hydrate()` fills `allowedSkills`.
- `apps/api/src/skills/repository.ts` *(modify)* — `versionPinnedBy(versionId)` now reads
  `scenario_skills`; `deleteVersion`/`deleteSkill` throw a 409 when pinned (block-delete).
- `apps/api/test/scenario-skills.test.ts` *(create)*.

## Acceptance
- [ ] `scenario_skills` created idempotently; scenario create/update persists `allowedSkills`;
      `hydrate` returns them; existing scenarios default to `[]` (no regression to scenario tests).
- [ ] Deleting a version pinned by a scenario → 409 with a clear message; deleting an unpinned version
      / a `latest`-mode attachment's skill behaves per cascade rules.
- [ ] Contract additive only (old clients/tests still pass); repo gate green with the new test.

## Notes
Touches `packages/shared` + `scenario-repository.ts` + `skills/repository.ts` — run **solo** (shared
+ cross-domain files). Run-engine wiring is WP 2.2; UI is WP 2.3.
