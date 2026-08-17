# WP 1.2 — Blank-skill creation (API `source:'blank'` + wizard third source)

**Phase:** 1 · **Size:** M · **Depends on:** — *(independent of 1.0/1.1)*

## Objective
Let users create a **completely empty skill** from the existing add-skill wizard: a third source
option (**Blank**, next to Upload and GitHub) that takes name + description and registers a
minimal, spec-valid `SKILL.md` scaffold as version 1 — immediately inspectable and, once WP 1.3
lands, immediately designable.

## Why / references
D3. The wizard (`SkillWizard`, skills WP 1.6) and the ingest path (`SkillIngestService`, skills
WP 1.3) already exist — this WP adds a source, not a pipeline. Scaffold must satisfy the manifest
rules in [`../../../research/skill-registry/01-agent-skills-format.md`](../../../research/skill-registry/01-agent-skills-format.md).

## Files
- `packages/shared/src/{types,schemas}.ts` *(modify)* — extend the create-skill body with
  `source: 'blank'` + `{ name, displayName?, description }` (additive union member).
- `apps/api/src/skills/scaffold.ts` *(create)* — `buildBlankSkillTree(name, description)`: a
  one-file tree containing a minimal valid `SKILL.md` (frontmatter `name` + `description`, a short
  starter body with an empty "Steps" section) — deterministic, no timestamps in content.
- `apps/api/src/skills/routes.ts` *(modify)* — `POST /api/skills` accepts `source:'blank'` and
  routes the scaffold tree through the **existing** `SkillIngestService.createVersion` path
  (manifest validation, caps, token footprint, blob store all apply unchanged).
- `apps/web/src/features/skills/SkillWizard.tsx` *(modify)* — third source card ("Blank skill"),
  step 2 = name/description form (existing `@elabs-ai/components-ui` Form primitives), review step shows the
  scaffold summary; on create, open the inspector as for other sources.
- `apps/web/src/lib/api.ts` *(modify)* — create helper for the blank body (plain JSON, no
  multipart).
- `apps/api/test/skills-blank.test.ts` *(create)* — create → version 1 exists, manifest valid,
  L1/L2 tokens counted, slug collision handled like other sources; scaffold re-ingests cleanly.

## Acceptance
- [ ] `POST /api/skills` with `source:'blank'` creates a skill whose version 1 is a valid,
      manifest-clean `SKILL.md`; footprint/caps/GC behavior identical to upload ingestion.
- [ ] Wizard shows three sources; blank flow round-trips end-to-end (create → inspector opens);
      `@elabs-ai/components-*` only, both themes.
- [ ] `skills.source_type` handling: reuse `'upload'` semantics for storage (`source_kind`)
      with `imported_from:'upload'` and `source_ref:'blank'` — **no** schema `CHECK` change, or, if
      a `'blank'` enum value is added, it lands via an additive migration; either way documented in
      the WP completion note.
- [ ] Repo gate green.

## Notes
Touches `packages/shared` + `apps/api/src/skills/routes.ts` — serialize against WP 1.0 (shared) but
otherwise parallel-safe with WP 1.1 (different modules). ⚠ OWNER-VERIFY: wizard visual walk, both
themes @ localhost:8080.
