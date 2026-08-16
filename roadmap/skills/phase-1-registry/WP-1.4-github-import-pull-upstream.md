# WP 1.4 — GitHub import + pull + upstream check

**Phase:** 1 · **Size:** L · **Depends on:** 1.3

## Objective
Register skills from a GitHub repo (public or private), create a new version on "pull latest" when
the tree changed, and answer an "is there an update" check for the badge.

## Why / references
[`../../research/skill-registry/06-ingestion-and-github.md`](../../research/skill-registry/06-ingestion-and-github.md)
(git CLI probe/import/pull, PAT via `SecretStore`), `04` (change detection), `10` (private+public;
on-open/manual update check). Reuse `SecretStore`; respect the environment network policy.

## Files
- `apps/api/src/skills/git-service.ts` *(create)* — `probe(repoUrl, ref, auth?)`: shallow sparse
  clone to a temp dir, discover all `SKILL.md` dirs → `SkillRepoProbe.candidates`, resolve HEAD sha,
  cleanup. `importSkill(input)`: clone the chosen `subpath`, read files, `repo.create` +
  `createVersion` (record repo/ref/subpath/last_sha; PAT encrypted). `pull(skillId)`: re-clone
  tracked ref, `{ unchanged: true }` if sha/tree match else new version. `upstream(skillId)`:
  `git ls-remote` (no clone) → `{ hasUpdate, upstreamSha }`. Ephemeral credential for the PAT (no
  token on disk); temp-dir cleanup in `finally`.
- `apps/api/src/skills/routes.ts` *(modify)* — `POST /api/skills/probe`; github branch of
  `POST /api/skills`; `POST /:id/pull`; `GET /:id/upstream`.
- `apps/api/test/skills-github.test.ts` *(create)* — against a local `file://` fixture repo.

## Acceptance
- [ ] `POST /api/skills/probe` on a fixture repo returns all `SKILL.md` candidates (monorepo aware) +
      commit sha; auth-required repo reports `requiresAuth`.
- [ ] `POST /api/skills` (github, chosen subpath) creates a skill bound to `(repo, ref, subpath)` with
      v1; the PAT is stored encrypted and never returned (`hasAuth` only).
- [ ] `POST /:id/pull` on an unchanged fixture → `{ unchanged: true }`; after a fixture commit that
      touches the subpath → a new version with the new sha.
- [ ] `GET /:id/upstream` reports `hasUpdate:false` when in sync and `true` (with sha) after an
      upstream commit, using `ls-remote` (no full clone).
- [ ] Keyless/offline test via `file://` remote; network-policy failure surfaces a clear error; repo
      gate green.

## Notes
Shares `skills/routes.ts` with WP 1.3 — **do not run 1.3 and 1.4 in parallel** (same file). Uses
`git` CLI via `node:child_process` (no new dep). One skill per subpath (Q3).
