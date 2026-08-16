<!--
  FALLBACK NOTICE (D-AS21, Assistant Refinement R1 / WP R1.2):
  This is NOT Anthropic's real `skill-creator` skill. That skill could not be vendored into this
  offline build environment (it is not present in this repo, in ~/.claude/skills, or anywhere else
  on disk in the environment this WP was built in). This file is a DISTILLED, hand-written
  skill-authoring reference that captures the same essentials — progressive disclosure, frontmatter
  hygiene, one-skill-one-capability, deterministic scripts — so the Assistant still has *something*
  concrete to read before editing a skill. It is read-only, bundled as static content in the API's
  Docker image (`apps/api/resources/skill-authoring/`), and NEVER executed (Bash is disabled for the
  Assistant regardless). The owner should swap this directory for the real `skill-creator` skill
  (SKILL.md + `references/`) whenever it's obtainable — nothing else in the wiring needs to change,
  since the session only ever reads this directory's *path*, not its specific contents.
-->
---
name: skill-creator
description: >-
  Best-practice reference for authoring or editing an Agent Skill's SKILL.md and its files. Use
  this before proposing any edit to a skill: read it, read every file under references/, then read
  the target skill's own SKILL.md and full file tree before changing anything.
---

# Skill-creator (distilled fallback reference)

This is a compact checklist for authoring or editing an [Agent Skill](https://agentskills.io) — a
`SKILL.md` file, optionally accompanied by supporting files (`references/`, `scripts/`, `assets/`).
Read `references/best-practices.md` in this same directory for the fuller checklist; this file is
the entry point (L1).

## Before you touch anything

1. Read the skill's **current** `SKILL.md` in full — its frontmatter (`name`, `description`, and
   any `keywords`/`license`/`compatibility` fields) and its body.
2. Read **every file** in the skill's tree, including everything under `references/`,
   `scripts/`, and `assets/` — not just the ones that look relevant. A reference file that's never
   read is a reference file whose content you might silently contradict.
3. Only then propose or make an edit.

## The core model: progressive disclosure

A skill loads in three levels, and every token you push down a level is a token every *unrelated*
conversation never pays:

- **L1 — name + description.** Always in context (every skill's L1 is loaded so the model can
  decide which skill to use). Keep it lean: a router line, not a summary of the whole skill.
- **L2 — the `SKILL.md` body.** Loads only when the skill actually triggers. This is a briefing —
  what to do, when, and pointers to L3 — not a manual. Push detail out to `references/`.
- **L3 — referenced files.** Load only when a specific step needs them. This is where the bulk of
  domain detail, scripts, and templates belong.

## SKILL.md frontmatter

- `name`: lowercase, hyphenated, matches the skill's directory name. No reserved words
  (`anthropic`, `claude`).
- `description`: written **for the router, not the reader** — state *when* to use the skill (real
  trigger phrases a user would say), not just what it does. This is the single highest-leverage
  line in the whole skill.
- Keep both fields honest and specific; a generic description ("a powerful helper for X") gives
  the router nothing to match on.

## Body structure (L2)

- Treat the body as a short briefing: what the skill does, the decision points, and pointers to
  `references/*` for depth. If a section only matters for one narrow case, it likely belongs in a
  reference file instead.
- Every relative reference (a link to a `references/`/`scripts/`/`assets/` file) must actually
  resolve to a real file in the tree — a broken reference is worse than no reference.
- Don't leave unused files lying around — every file under the skill's root should be reachable
  from something the body (or a reference it points to) actually mentions.

## Scripts

- If the skill ships a script, its purpose, inputs, and outputs should be documented (in the body
  or in a reference file) — don't rely on the model reverse-engineering what a script does from its
  source alone.
- Prefer deterministic scripts for anything mechanical (parsing, transforming, validating) over
  asking the model to do it free-form — it's cheaper and more reliable.

## One skill, one capability

- A skill should do one coherent thing well. If you find yourself writing "and also handles X" for
  an unrelated X, that's usually a sign it should be a second skill, not a bigger one.

## Portability

- Only `name` and `description` are universal across every runtime a skill might run in. Don't
  assume a specific loading strategy, execution capability (e.g. that scripts can run), or model
  strength beyond what the frontmatter promises.

## In this app specifically

This workspace has its own, fuller authoring guide with enforcement-linked rule ids (referenced by
the Skill IDE's quality engine): `docs/skill-authoring.md` in the app's repository. It is not
mounted into this read-only reference directory, but the same practices summarized above are
covered there in more depth, each tagged `[enforced]` / `[measured]` / `[convention]` /
`[planned]` depending on whether the app's own Quality engine machine-checks it.
