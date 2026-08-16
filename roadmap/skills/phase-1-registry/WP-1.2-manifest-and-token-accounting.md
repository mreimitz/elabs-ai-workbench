# WP 1.2 — Manifest parse + token accounting (L1/L2/L3)

**Phase:** 1 · **Size:** M · **Depends on:** 1.1

## Objective
Parse + validate `SKILL.md` frontmatter and compute the three-level token footprint, so every
version stores a validated manifest and L1/L2/L3 + per-file token totals.

## Why / references
[`../../research/skill-registry/01-agent-skills-format.md`](../../research/skill-registry/01-agent-skills-format.md)
(frontmatter spec), `06` (validation + accounting), `11` (three levels), `schema/skill-manifest.schema.json`.
Reuse `apps/api/src/token-counting/` (`TokenCounter`, default `generic_o200k`).

## Files
- `apps/api/src/skills/manifest.ts` *(create)* — `parseSkillManifest(text): { manifest, valid,
  errors }` using `yaml`; validate name (regex/length/reserved words), description (≤1024, non-empty),
  optional-field caps; warn (not fail) when `name !== dir`. Store malformed versions with
  `manifest_valid = 0` + errors.
- `apps/api/src/skills/footprint.ts` *(create)* — `classifyFile(path)` → kind; `countLevels(files,
  manifest)` → `{ l1, l2, l3, total }` + per-file token totals (text only; binary 0).
- `apps/api/src/skills/manifest.test.ts`, `apps/api/src/skills/footprint.test.ts` *(create)*.

## Acceptance
- [ ] Valid frontmatter parses to the `SkillManifest` shape; invalid required fields yield
      `valid=false` + itemized errors **without** throwing (version still storable).
- [ ] L1 = name+description tokens; L2 = SKILL.md body tokens; L3 = sum of other text files; binary
      files contribute 0; totals match per-file sums.
- [ ] Kind classification: root `SKILL.md`→`skill_md`, `references/*`→`reference`, `scripts/*`→
      `script`, `assets/*`→`asset`, else `other`.
- [ ] Unit tests cover valid/invalid/edge frontmatter (missing body, no frontmatter, reserved word,
      name≠dir) and the three-level counts; repo gate green.

## Notes
Pure functions (no DB) so they're trivially testable; WP 1.3/1.4 wire them into `createVersion`
(backfilling `skill_versions` level columns + `skill_files.token_total`).
