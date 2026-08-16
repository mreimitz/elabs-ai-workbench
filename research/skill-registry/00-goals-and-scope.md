# 00 — Goals & Scope

## The request, decomposed

From the brief, verbatim intent → concrete requirements:

| # | Requirement (from the ask) | Concrete deliverable |
|---|---|---|
| R1 | "register skills … on the same level and as a new side menu" as MCP servers | New top-level **Skills** nav item + `SkillsView`, peer to Servers/Scans/Compare. |
| R2 | "add a new skill by uploading a zip or skill file" | Upload ingestion: `.zip` archive **or** a single `SKILL.md`/file; parse, validate, store as v1. |
| R3 | "or by pointing to a GitHub repo" | GitHub import: repo URL + branch + optional subpath; discover `SKILL.md`; store as v1. |
| R4 | "versioning per skill" | `skill_versions`: an ordered, immutable history per skill. |
| R5 | "pull … the latest version … see that as a new version" | GitHub "Pull latest": fetch repo, create a new version iff the tree changed. |
| R6 | "including a deep what-changed comparison … must work for uploaded skills and GitHub skills" | Full-tree diff (added/removed/renamed/modified) + per-file line diff + token deltas, for **both** source types. |
| R7 | "automatically show the skill.md file as a subscription" | The inspector's default view is the **rendered `SKILL.md`** + its parsed frontmatter (interpreted as "summary/description surfaced automatically"; see note). |
| R8 | "full file explorer … inspect all content and subfolders" | `FileTree`-based explorer over the whole version tree + a file viewer (text + binary handling). |
| R9 | "diff comparison … along the full folder structure" | Diff is tree-wide and walkable, not just `SKILL.md`. |
| R10 | "enterprise-grade skill inspector" | Token-footprint metrics, frontmatter validation, security surfacing (scripts/external URLs), audit-friendly version history. |
| R11 (Phase 2) | "attachable to a scenario … just as the MCP servers currently are. Select a skill (auto latest or a specific version)" | `scenario_skills` join + `AllowedSkill { skillId, versionMode }`, an `AddSkillModal` picker, run-engine wiring. |

> **Note on R7 ("subscription").** We read "subscription" as "show the `SKILL.md` as the skill's
> auto-surfaced summary/description" — i.e., the inspector opens on the rendered `SKILL.md` and its
> `name`/`description` frontmatter without the user hunting for it. If instead you meant a literal
> *subscribe-to-updates* feature (notify me when the GitHub source changes), that's a small additive
> extension of the "Pull latest" machinery — tracked as an open question in
> [`10-open-questions.md`](./10-open-questions.md).

## Two delivery phases

- **Phase 1 — Skill Registry & Inspector (R1–R10).** Self-contained. Register, version, pull, diff,
  explore, footprint. Ships independent of the Testing subsystem.
- **Phase 2 — Scenario attachment (R11).** Depends on Phase 1 + the existing Testing subsystem
  (`scenarios`, run engine). Mirrors `scenario_servers`.

The user explicitly framed attachment as "a second step," so Phase 1 is the priority and Phase 2 is
designed but sequenced after.

## Why this belongs in *this* app (not a generic file manager)

The product's north star is **measuring the model-context token cost of things you attach to an
agent** (`CLAUDE.md` §1). Agent Skills are exactly such a thing, and the format is explicitly built
around **progressive disclosure** with three token-cost levels (Level 1 metadata always loaded,
Level 2 `SKILL.md` body on trigger, Level 3 resources on demand — see
[`01-agent-skills-format.md`](./01-agent-skills-format.md)). The existing research dataset already
lists **"Skills & their context contribution"** as comparison axis 6
(`research/token-context-comparison/README.md`).

So the Skills feature is a natural sibling of the MCP-server scanner: instead of "how many tokens do
this server's tool definitions cost," it answers "how many tokens does this skill cost at each
disclosure level, and how did that change between versions." We reuse the `TokenCounter`
(`apps/api/src/token-counting/`) and the same footprint/delta UI vocabulary (`TokenViz`, MetricCards,
diff badges). This keeps the feature on-brand and avoids reinventing accounting.

## Non-goals (Phase 1)

- **We do not execute skills.** The app inspects, footprints, and diffs skills. It never runs a
  skill's scripts. (Phase 2 *attachment* feeds skill context to the agent-under-test; even there the
  app does not execute skill scripts on the host — see [`08`](./08-scenario-attachment.md).)
- **No skill authoring/editing UI.** Skills are imported read-only snapshots. (Editing could come
  later; the content-addressed store makes it easy to add.)
- **No cross-surface sync** (claude.ai / API upload). Out of scope; this is a local inspector.
- **No auto-polling of GitHub** in Phase 1 — "pull latest" is user-initiated (auto-watch is an open
  question).

## Constraints inherited from the codebase (`CLAUDE.md`)

- **Contract-first:** types + zod in `packages/shared` first, then API, then web.
- **Runtime boundary:** only `apps/api` touches the network, the filesystem, `git`, and decrypted
  secrets. The web UI receives redacted data only.
- **`@brand/*`-only UI**, two themes (`qlik-bright` / `qlik-dark`), semantic tokens, no raw colors
  (enforced by hooks).
- **pnpm workspace, ESM, strict TS**, `better-sqlite3`, Fastify 5, `nanoid`, additive `/api` routes.
- **Quality gate:** `pnpm typecheck && pnpm test && pnpm build` must stay green.
