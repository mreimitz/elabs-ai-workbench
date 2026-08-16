# Skill Registry & Inspector — Research and Integration Plan

Research and a concrete wiring plan for a new **Skills** capability in the MCP Token Footprint app:
register [Agent Skills](https://agentskills.io) (upload a `.zip`/skill file **or** connect a GitHub
repo), **version** each skill, **pull the latest version** from GitHub and see it as a new version
with a **deep, full-tree "what changed" diff**, inspect every file and subfolder through a
**full file explorer**, and — in a second step — **attach skills to test scenarios** exactly like
MCP servers are attached today (pick a skill, auto-latest or pin a specific version).

**As-of:** 2026-07-01 · **Status:** **Phase 1 shipped** (registry + inspector) · Phase 2 (scenario
attachment) not built yet · **Owner:** m.reimitz

> **Phase 1 is built and behind the gate** (WP 1.0–1.9): the shared contract, DB schema + repo,
> manifest/token accounting, upload + GitHub ingestion (with env-configurable size/zip-bomb caps
> enforced on **both** ingestion paths), the full-tree diff engine, and the whole web registry +
> inspector (rail, add-skill wizard, overview with security surface, file explorer, versions, diff).
> The live plan/ledger is [`../../roadmap/skills/STATUS.md`](../../roadmap/skills/STATUS.md).
> **Phase 2 — attaching skills to test scenarios ([`08-scenario-attachment.md`](./08-scenario-attachment.md),
> `roadmap/skills/phase-2-attachment/`) — is NOT built yet.** The docs below still describe the full
> two-phase target.

> This mirrors the existing MCP-server subsystem. Where a decision is "do what servers do," the
> doc points at the exact file/line in the current codebase so implementation is copy-and-adapt.

## Read in this order

1. [`00-goals-and-scope.md`](./00-goals-and-scope.md) — the request decomposed into concrete
   requirements, the two delivery phases, non-goals, and the "why this fits the product" argument
   (skills are a *token-footprint* surface, not just files).
2. [`01-agent-skills-format.md`](./01-agent-skills-format.md) — ground truth on the Agent Skills
   format: `SKILL.md` frontmatter schema, folder layout, packaging (`.zip` / folder / GitHub
   monorepo), and where "version" actually lives. Sourced from Anthropic + agentskills.io.
3. [`02-current-architecture-map.md`](./02-current-architecture-map.md) — how MCP servers work
   today end-to-end (DB → repo → routes → shared contract → web → scenario attachment), with exact
   file/line anchors. This is the template we clone.
4. [`03-data-model.md`](./03-data-model.md) — the new tables (`skills`, `skill_versions`,
   `skill_blobs`, `skill_files`, `scenario_skills`), DDL, the content-addressed blob store, and how
   migrations are applied.
5. [`04-versioning-and-diff.md`](./04-versioning-and-diff.md) — the version model (uploaded vs
   GitHub), change detection, the full-tree diff algorithm, rename detection, and the token-delta
   "what changed" comparison.
6. [`05-api-surface.md`](./05-api-surface.md) — the new `/api/skills*` routes, request/response
   shapes, and the shared types + zod schemas to add first (contract-first).
7. [`06-ingestion-and-github.md`](./06-ingestion-and-github.md) — the ingestion pipeline: zip/file
   parsing, GitHub import + "pull latest" via the `git` CLI, validation, security posture, and how
   skill credentials are encrypted with the existing `SecretStore`.
8. [`07-ui-plan.md`](./07-ui-plan.md) — the **Skills** side-menu item, `SkillsView` + `SkillRail`,
   the add-skill wizard, and the **enterprise-grade inspector** (rendered `SKILL.md` + `FileTree`
   explorer + `DiffEditor` full-tree diff + version picker), composed entirely from `@brand/*`.
9. [`08-scenario-attachment.md`](./08-scenario-attachment.md) — Phase 2: `scenario_skills`,
   `AllowedSkill`, the `AddSkillModal` picker, run-engine wiring, and the token-footprint accounting
   for an attached skill.
10. [`09-implementation-plan.md`](./09-implementation-plan.md) — sequenced work packages, the three
    new runtime dependencies and why, the quality gate, and a definition of done per WP.
11. [`10-open-questions.md`](./10-open-questions.md) — the decisions that need your call before or
    during build (chief among them: what "attaching a skill to a scenario" should actually feed the
    agent under test).
12. [`schema/`](./schema/) — machine-readable artifacts: the parsed-manifest JSON schema and the
    work-package ledger.

## The one-paragraph summary

A **Skill** is a logical entity with an ordered list of immutable **versions**. A version is a
content-addressed snapshot of a folder tree (every file stored once by `sha256` in a blob table;
versions just map `path → blob`). Uploading a new `.zip` or pulling a GitHub repo produces a new
version *only if the tree hash changed*; the diff between any two versions is a cheap map compare
(added / removed / renamed / modified) plus a Monaco `DiffEditor` for per-file line diffs, walkable
across the **entire folder structure**. Because the app already exists to measure *context token
cost*, every version and every file also carries a **token footprint** (Level 1 metadata / Level 2
`SKILL.md` body / Level 3 resources) computed with the existing `TokenCounter` — so the inspector
answers "what does this skill cost the model, and what changed," not merely "what files are in it."
The whole thing reuses the MCP-server subsystem's shape: same `nanoid` IDs, same repo/service/route
layering, same `SecretStore` encryption, same `@brand/*`-only UI, same scenario join-table
attachment pattern.
