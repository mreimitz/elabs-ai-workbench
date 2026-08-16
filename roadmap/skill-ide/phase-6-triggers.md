# Phase 6 — Keywords & triggers (WP spec)

## WP 6.1 — Trigger-surface manager + cross-skill collision report
**Size:** M · **Depends on:** 1.2, 2.1

**Objective:** organize and manage the skill's trigger surface — keywords and /commands — and
surface cross-skill collisions across the whole registry (I7).

**Files:** API — `apps/api/src/skillflow/triggers.ts` (new): `getTriggerSurface(versionId)`
(description + frontmatter keywords + command entry points from the projected graph) and
`getTriggerCollisions()` (all skills' CURRENT versions: exact + normalized collisions on
keywords and command tokens — normalized = case/separator collapse via the compare helpers'
`normalizeName`; **the helpers do NOT do pluralization** (review 2026-07-04 finding 2) — if
plural folding is wanted, implement a documented trailing-`s`/`es` stem rule locally in
`triggers.ts`, or ship without it); routes end-hunk
`GET /api/skills/:id/versions/:vid/triggers`, `GET /api/skills/trigger-collisions`. Web — a
"Triggers" panel on the skill Overview tab (keywords chip editor staging `set_keywords`,
commands list linking to their Design-tab flows) + a collisions section on the Skills registry
view (each collision lists the skills, deep-links, severity by kind: command collision = error,
keyword overlap = warning). Tests `apps/api/test/skill-ide-triggers.test.ts`.

**Acceptance:** collision fixture (two skills sharing `/report` + one keyword) reported exactly
once with both skill ids; keyword edit round-trips through `set_keywords` into frontmatter; the
registry view renders the report (empty state when clean); both themes; gate green.
