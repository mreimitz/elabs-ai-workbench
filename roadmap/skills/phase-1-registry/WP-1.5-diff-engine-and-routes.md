# WP 1.5 — Diff engine + routes

**Phase:** 1 · **Size:** M · **Depends on:** 1.3

## Objective
Compute the full-tree "what changed" diff between two versions — added/removed/renamed/modified,
token deltas per level, manifest field diff — and serve both file contents for the visual diff.

## Why / references
[`../../research/skill-registry/04-versioning-and-diff.md`](../../research/skill-registry/04-versioning-and-diff.md)
(algorithm, rename detection, token deltas, manifest diff), `05` (`GET /diff`, `GET /diff/file`).
Use `diff`/jsdiff only for the `+adds/−dels` line-count badges; the visual diff is client-side (WP 1.8).

## Files
- `apps/api/src/skills/diff-service.ts` *(create)* — `diffVersions(fromId, toId): SkillDiff`:
  path→blob_sha map compare (added/removed/modified/unchanged), rename detection (same blob_sha,
  moved path), per-entry token deltas, rollup (files + L1/L2/L3/total deltas + bytesDelta), manifest
  field diff. `fileDiff(fromId, toId, path)` → both `SkillFileContent`s. Binary → status only.
- `apps/api/src/skills/routes.ts` *(modify)* — `GET /api/skills/:id/diff?from=&to=`,
  `GET /api/skills/:id/diff/file?from=&to=&path=`.
- `apps/api/src/skills/diff-service.test.ts` *(create)*.

## Acceptance
- [ ] Added/removed/modified/unchanged correctly classified from blob-sha maps; a moved identical file
      is reported as `renamed` (from→to), removed from added/removed.
- [ ] Rollup token deltas per level (L1/L2/L3/total) and file counts are correct; manifest field diff
      lists changed frontmatter fields (before/after).
- [ ] Binary modified files report `binary` with no line diff; text files carry `+adds/−dels`.
- [ ] `GET /diff` and `GET /diff/file` return the documented shapes; unit tests cover rename, binary,
      rollups; repo gate green.

## Notes
Shares `skills/routes.ts` with 1.3/1.4 — serialize the route edit (do not diff-parallel with 1.4).
Diffs are computed on demand (not stored). Works identically for uploaded and GitHub skills (both are
`skill_files` maps by diff time).
