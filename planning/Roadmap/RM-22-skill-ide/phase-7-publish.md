---
type: "Work Package Spec"
title: "Phase 7 \u2014 Publish to GitHub (WP specs)"
description: "Size: L \u00b7 Depends on: \u2014 \u00b7 API"
tags: ["roadmap", "RM-22"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 7 — Publish to GitHub (WP specs)

## WP 7.1 — API: create GitHub repo from a version + initial push + bind as source
**Size:** L · **Depends on:** — · API

**Objective:** "create a GitHub repo based on a skill" (I6): one call creates the repo, pushes
the version tree as the initial commit, and optionally binds it as the skill's GitHub source so
pull/upstream work immediately.

**Files:** `apps/api/src/skills/git-service.ts` (extend `SkillGitService` — the PAT discipline
lives there) or a sibling `publish-service.ts` composing it; routes:
`POST /api/skills/:id/versions/:vid/publish-github` (body: `PublishToGithubInput`); tests
`apps/api/test/skill-ide-publish.test.ts` (offline: a local `file://` bare repo standing in for
the created remote — mirror the WP 1.4 skills-plan test approach; the repo-creation REST call
mocked/injected).

**Mechanics:** create repo via GitHub REST (`POST /user/repos`, PAT bearer; name validated;
`private` flag honored) → materialize version tree in a temp dir → `git init -b main`, commit
("Initial commit from <skill> <version_label>"), push via the argv-only credential helper →
optional bind: set the skill's github fields (`repo_url`, `ref: main`, `subpath: ''`, encrypted
PAT) exactly as import does. Refusals: repo exists / non-empty remote → 409; no force-push
anywhere; temp dir always cleaned; every error `redactUrl`-ed. The PAT may come from the
request (then optionally persisted encrypted on bind) or from the skill's stored auth.

**Acceptance:** offline test: publish → bare repo contains exactly the version tree (compare
file lists + a content hash), bind round-trips (pull sees no upstream change), 409 on
second publish to the same target, PAT never appears in any error/log (assert on captured
logs); gate green. NOTE: live GitHub REST path unverifiable offline — document it.

## WP 7.2 — UI: Publish-to-GitHub wizard
**Size:** M · **Depends on:** 7.1 · Web-only

**Objective:** a "Publish to GitHub" action on the skill inspector (version-scoped): dialog
with repo name (prefilled from slug), private toggle, PAT field (password-type, never echoed;
notes it will be stored encrypted only if binding), bind-as-source toggle → progress state →
success with the repo URL (real link) or a clear error.

**Files:** `apps/web/src/features/skills/PublishGithubDialog.tsx` (new), `SkillInspector.tsx`
(action button next to Download/Pull), `skills-inspector-api.ts`.

**Acceptance:** form validation (name pattern), busy/disabled semantics per interaction rules,
409/4xx surfaced inline, success links out; a bound skill's inspector immediately shows the
GitHub source badge/pull affordances (existing UI); both themes; gate green. Live end-to-end
publish is owner-acceptance (needs a real PAT).

**Implementation notes (verified 2026-07-04):** the API side is DONE (WP 7.1):
`POST /api/skills/:id/versions/:vid/publish-github` with `PublishToGithubInput` (shared, landed
in 1.1); refusal matrix already mapped (no-token 400, already-bound/non-empty-remote 409, REST
errors 409/401/502, all redacted) — the wizard only renders those inline, it adds no client
logic. PAT field: `type="password"`, never prefilled, `autocomplete="off"`, note that it is
stored encrypted only when bind-as-source is on. On success, refetch the skill so the existing
GitHub source badge + pull affordances appear without navigation.
