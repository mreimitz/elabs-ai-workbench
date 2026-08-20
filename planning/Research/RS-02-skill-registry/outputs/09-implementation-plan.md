---
type: "Research Output"
title: "09 \u2014 Implementation plan (work packages)"
description: "Sequenced, contract-first, each WP ending green on pnpm typecheck && pnpm test && pnpm build."
tags: ["research", "RS-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 09 — Implementation plan (work packages)

Sequenced, contract-first, each WP ending green on `pnpm typecheck && pnpm test && pnpm build`.
WP IDs are also in machine-readable form at [`schema/work-packages.json`](./schema/work-packages.json).

## Phase 1 — Skill Registry & Inspector

### WP 1.0 — Contract & deps (foundation)
- Add shared **types** + **zod** ([`05`](./05-api-surface.md)) to `packages/shared`
  (`types.ts`, `schemas.ts`, `constants.ts`: `SKILL_MAX_FILE_BYTES` etc.). Build shared.
- Get owner sign-off + add API deps: `@fastify/multipart`, `fflate`, `diff`, (maybe `yaml`)
  ([`06`](./06-ingestion-and-github.md)). No web deps.
- **DoD:** shared builds; deps installed; typecheck green.

### WP 1.1 — DB schema & repository
- Add the five tables + indices ([`03`](./03-data-model.md)) to `db/schema.ts`; row types in
  `db/rows.ts`; `ensureColumn` migrations wired in `db/database.ts`.
- `skills/repository.ts`: skills/versions/files/blobs CRUD, `createVersion` transaction, blob GC,
  public/internal redaction (`hasAuth`), `SecretStore` for `github_auth_ref`.
- **DoD:** unit tests for `createVersion` (dedupe, tree_sha, GC) + redaction; green.

### WP 1.2 — Manifest parse + token accounting
- `skills/manifest.ts` `parseSkillManifest()` + spec validation ([`01`](../notes/01-agent-skills-format.md)).
- Wire `TokenCounter` for L1/L2/L3 subtotals + per-file counts.
- **DoD:** unit tests over valid/invalid/edge frontmatter and token levels; green.

### WP 1.3 — Ingestion (upload) + routes
- `skills/ingest-service.ts` upload path (fflate unzip, root locate, caps, single-skill guard).
- `skills/routes.ts` + `registerSkillRoutes` in `index.ts`: list/get/create(upload)/update/delete,
  versions list/get/add, files list, file content, raw. `apiUpload` client helper.
- **DoD:** API tests: upload zip → skill+v1; re-upload identical → `unchanged`; changed → v2; bad
  archive → 400. Green.

### WP 1.4 — GitHub import + pull
- `skills/git-service.ts`: probe (discover SKILL.md dirs), import (sparse shallow clone), pull
  (sha/tree change detection), PAT via ephemeral credential, temp-dir cleanup, network-policy-aware
  errors.
- Routes: `POST /probe`, `POST /skills` (github), `POST /:id/pull`.
- **DoD:** tests against a local fixture repo (file:// remote) for import + no-op pull + changed
  pull; green. (Public-internet clone verified manually.)

### WP 1.5 — Diff engine + routes
- `skills/diff-service.ts`: full-tree diff (added/removed/modified/renamed/unchanged), rollup + L1/2/3
  token deltas, manifest field diff; `diff` for line-count badges. Routes `GET /diff`, `GET /diff/file`.
- **DoD:** unit tests for rename detection, binary handling, rollups; green.

### WP 1.6 — Web: nav + registry + wizard
- `AppShell` `ViewKey` + nav item; `App.tsx` wiring + `selected-skill` persistence.
- `SkillsView` + `SkillRail` + `SkillWizard` (upload & GitHub-discovery flows).
- **DoD:** can register an uploaded and a GitHub skill end-to-end in the running app; both themes
  verified; typecheck/build green.

### WP 1.7 — Web: inspector (overview + files)
- `SkillInspector` (Overview: rendered SKILL.md + frontmatter + footprint MetricCards + security
  strip) and `SkillFileExplorer` (`FileTree` + `CodeEditor`/binary/markdown viewer, `ResizablePanel`).
- **DoD:** explore all files/subfolders of a real multi-folder skill; both themes; green.

### WP 1.8 — Web: versions + diff
- `Versions` tab (`DataTable` + Δtokens) and `SkillDiffView` (delta strip + manifest diff + full-tree
  change list + `DiffEditor`). "Pull latest" deep-links into Diff.
- **DoD:** import → pull a changed GitHub skill → see the deep diff; upload v2 → same; both themes;
  green.

### WP 1.9 — Hardening & docs
- Size/zip-bomb caps, error toasts, empty/loading states, security-surface polish, Docker `/data`
  volume note, README/CLAUDE.md capability-table update.
- **DoD:** full gate green; manual pass in `docker compose up`.

## Phase 2 — Scenario attachment

### WP 2.1 — Contract + persistence
- `AllowedSkill` + `allowedSkillSchema`; extend `Scenario`/`scenarioInputSchema`; `scenario_skills`
  table; `replaceSkills`/`listSkills`/`hydrate` in `scenario-repository.ts`. **DoD:** repo tests; green.

### WP 2.2 — Resolution + run-engine wiring
- `resolveAllowedSkills()`; inject L1 (always) +L2 (eager toggle) into the run; **(decision-gated)**
  optional `read_skill_file` bridge tool ([`08`](./08-scenario-attachment.md), [`10`](../notes/10-open-questions.md)).
- Token accounting includes attached-skill context. **DoD:** run-engine tests assert skill tokens are
  counted; green.

### WP 2.3 — Web scenario editor
- "Allowed skills" panel + `AddSkillModal` (pick skill → latest/pinned + eager). Live footprint
  includes skills. **DoD:** attach latest & pinned, run, see footprint; both themes; green.

## Dependency graph

```
1.0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9
                                   └── 1.6 needs 1.3; 1.7 needs 1.3; 1.8 needs 1.5
Phase 2: 2.1 → 2.2 → 2.3   (all require Phase 1 shipped + existing Testing subsystem)
```

## Estimated shape (not a commitment)

Phase 1 is ~8 backend + 3 web WPs; the backend (1.0–1.5) is the bulk and is highly test-covered
(matches the repo's API-test-first posture). Phase 2 is small because it clones `scenario_servers`.

## Risks / watch-items

- **YAML parsing** — decide dep vs minimal parser (WP 1.2 / [`10`](../notes/10-open-questions.md)).
- **Large binary assets in SQLite blobs** — mitigated by size caps; disk-backed blobs is the escape
  hatch ([`03`](./03-data-model.md)).
- **Private-repo auth & network policy** — clones must respect the environment's egress policy and
  fail loudly; PAT never leaves the API.
- **Run-engine fidelity for skills** — the A/B/C choice affects how "realistic" attached-skill runs
  are; ship A first, gate C on your call.
- **Monaco/DiffEditor bundle weight** — already a web dep (`@elabs-ai/components-editor` used by
  `ArtifactPreview`), so no new cost.

# Citations

None.
