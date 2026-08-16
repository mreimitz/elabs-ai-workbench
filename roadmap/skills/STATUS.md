# Skills — work-package status ledger

Living state for the **Skills** plan, read and updated by `/next-wp skills`. It picks the next
**open** WPs whose **dependencies are done**, runs them with parallel worktree sub-agents, and ticks
a box **only** when that WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build`) is green.

**Legend:** `[ ]` open · `[x]` done. A trailing `status:` note marks `in progress` / `in review` /
`blocked`. Done lines record date + branch: `… — done <YYYY-MM-DD> · wp/skills/<id>`.

> All decisions are locked — see
> [`../../research/skill-registry/10-open-questions.md`](../../research/skill-registry/10-open-questions.md).
> Recommended first slice: `1.0 → 1.1 → 1.2 → 1.3`, then fan out `1.4 ∥ 1.5 ∥ 1.7`, then `1.6 → 1.8
> → 1.9`, then Phase 2 `2.1 → 2.2 → 2.3`.

## Phase 1 — Skill Registry & Inspector
- [x] WP 1.0 — shared contract + API deps — done 2026-07-01 · wp/skills/1.0 (a2dd6ea, merge 2d6ec4d). All Skills types+zod+constants in `packages/shared` (redacted `Skill`, `AllowedSkill`/`SkillVersionMode` for Phase 2); deps `@fastify/multipart@10`, `fflate`, `diff@5` (+`@types/diff`), `yaml`. Gate green (typecheck · 243 tests · build). `diff` pinned to 5.x so `@types/diff` stays meaningful (diff@7+ bundles types).
- [x] WP 1.1 — DB schema + repository — done 2026-07-01 · wp/skills/1.1 (8862d04, merge). `skills`/`skill_versions`/`skill_blobs`/`skill_files` + indices (per `03`); `SkillRepository` with content-addressed blob store, `createVersion` (dedupe + `tree_sha` no-op), public/internal redaction (`hasAuth`), delete-guard hook + blob GC. Gate green (typecheck · 251 tests · build). Test at `apps/api/test/` to match the runner glob; token_total=0 (WP 1.2/1.3 backfill).
- [x] WP 1.2 — manifest parse + token accounting — done 2026-07-01 · wp/skills/1.2 (903a843, merge). `manifest.ts` (`parseSkillManifest`: yaml + full spec validation, never throws, itemized errors) + `footprint.ts` (`classifyFile` + `countLevels` L1/L2/L3 via `TokenCounter`). Additive `SkillFileKind` alias in shared. Gate green (typecheck · 280 tests · build). 29 new tests.
- [x] WP 1.3 — upload ingestion + core routes + export — done 2026-07-01 · wp/skills/1.3 (83784b2, merge). `SkillIngestService` (fflate unzip, caps/zip-bomb guard, root-locate, lone-SKILL.md, `createVersion` footprint backfill) + `exportVersionZip`; `registerSkillRoutes` (CRUD/versions/files/file/raw/export) wired in `index.ts`. GitHub branch of `POST /api/skills` = documented 501 stub (WP 1.4). Gate green (typecheck · 292 tests · build). 12 new tests.
- [x] WP 1.4 — GitHub import + pull + upstream check — done 2026-07-01 · wp/skills/1.4 (ac4d2c8, merge). `SkillGitService` (probe/importSkill/pull/upstream via `git` CLI — shallow blobless sparse clone; ephemeral `x-access-token` PAT credential in argv only, never on disk; `redactUrl` on all errors; tmp cleaned) + github routes (`/probe`, `source:github`, `/:id/pull`, `/:id/upstream`). Gate green (typecheck · 297 tests · build). 5 offline `file://` tests. NOTE: live private-repo 401 path unverified (offline env).
- [x] WP 1.5 — diff engine + routes — done 2026-07-01 · wp/skills/1.5 (b643ed4, merge). `SkillDiffService.diffVersions` (full-tree add/remove/modify/rename via blob-sha, per-level token rollup deltas, manifest field diff) + `fileDiff` + `getDiffFileMap`; `GET /diff`, `GET /diff/file` (validation + cross-skill guard). Gate green (typecheck · 303 tests · build). 6 tests. NOTE: `+adds/−dels` not on `SkillDiffEntry` (WP 1.0 contract) — `lineDelta` helper exported; WP 1.8 derives or shows via Monaco diff.
- [x] WP 1.6 — web: nav section + registry + add-skill wizard — done 2026-07-01 · wp/skills/1.6 (408e0f3, merge). Skills `SidebarGroup` (MCP→Skills→Testing); `SkillsView` + `SkillRail` (search, source badge, version count, pull/delete) + `SkillWizard` (3-step: source → upload `FileUpload` / github probe+pick → review); `App.tsx` wiring + CRUD; `lib/api.ts` helpers + `apiUpload` multipart. `@brand/*` only (real `FileUpload`, no raw input), hooks clean, gate green (303 tests · build). ⚠ OWNER-VERIFY: live visual + two themes + round trips @ localhost:8080.
- [x] WP 1.7 — web: inspector Overview + Files explorer — done 2026-07-01 · wp/skills/1.7 (merge). `SkillInspector` (tabs + version picker + Download .zip + defensive update badge), `SkillOverview` (rendered SKILL.md + frontmatter + L1/L2/L3 MetricCards + SegmentedBar + security strip), `SkillFileExplorer` (`FileTree` + read-only CodeEditor/markdown viewer + breadcrumb), `skills-inspector-api` (read-only helpers, no `lib/api.ts` collision). `@brand/*` only, props verified vs `.d.ts`, hooks clean, gate green (297 tests · build). ⚠ OWNER-VERIFY: live visual + two themes @ localhost:8080 (not reachable until WP 1.6 wires it).
- [x] WP 1.8 — web: Versions + Diff — done 2026-07-01 · wp/skills/1.8 (f06f999, merge). `SkillVersions` (history `DataTable` + client Δtokens + two-row compare) + `SkillDiffView` (rollup delta strip, manifest diff, walkable full-tree change list, Monaco `DiffEditor` for modified/renamed text, single-pane added/removed, binary note); `SkillInspector` tabs wired + Pull-latest deep-links into Diff. `@brand/*` + semantic tokens, hooks clean, gate green (303 tests · build). ⚠ OWNER-VERIFY: live visual + two themes @ localhost:8080.
- [x] WP 1.9 — hardening & docs — done 2026-07-01 · wp/skills/1.9 (a11281f, merge). Shared `caps.ts` applied to BOTH ingest paths — **fixed a real gap: the GitHub checkout enforced no size/count caps**; `SKILL_MAX_*` env-overridable (+ multipart limit); web states/security strip verified present (no redesign); docs (CLAUDE.md capability table + subsection, research README, `.env.example`). Gate green (305 tests · build). 2 new git-cap tests. ⚠ OWNER-VERIFY: `docker compose up --build` + two-theme walk. **Phase 1 complete.**

## Phase 2 — Scenario attachment
- [x] WP 2.1 — contract + persistence (scenario_skills) — done 2026-07-01 · wp/skills/2.1 (e31252b, merge). `scenario_skills` table; `Scenario.allowedSkills` (additive `.default([])`); `replaceSkills`/`listSkills`/`hydrate` in scenario-repository; `versionPinnedBy`/`skillPinnedBy` → 409 block-delete of a pinned version (Q6). Minimal `ScenarioEditor` pass-through (UI in 2.3). Gate green (311 tests); additive contract holds.
- [x] WP 2.2 — resolution + run-engine wiring — done 2026-07-01 · wp/skills/2.2 (4cd5ed3, merge). `resolveAllowedSkills` (latest@runtime / pinned); `skill-context.ts` (`<available_skills>` L1 block + eager body inline; read-only `read_skill_file`/`list_skill_files` metered like MCP calls, path-traversal refused, **NO script execution**); `run-service` injects block + registers tools + folds skills tokens into `ContextSnapshot`. Gate green (322 tests). Read-only invariant confirmed + tested. Eager plumbed; dormant until WP 2.3 adds the `eager` field.
- [x] WP 2.3 — web scenario editor (allowed skills) + eager end-to-end — done 2026-07-01 · wp/skills/2.3 (e2e325d+ed3d98c, merge). `AllowedSkill.eager` end-to-end (shared type/zod → `scenario_skills.eager` column + `ensureColumn` → persistence → `resolveAllowedSkills` → `run-service` `eagerIds` → inlined SKILL.md body, round-trip tested); `AddSkillModal` (pick skill → latest/pinned + eager) + `ScenarioEditor` Allowed-skills panel with live footprint (L1 always, +L2 eager). `@brand/*` only, hooks clean, gate green (323 tests). ⚠ OWNER-VERIFY: live visual + two themes + a real run @ localhost:8080. **Phase 2 complete — plan done.**

## Owner acceptance (deferred visual / a11y — owner-only, not subagent-doable)

The Skills web surfaces are merged and gate-green; a sub-agent could not verify the live two-theme
(`qlik-bright`/`qlik-dark`) visual + a11y walk against the running app. This tracks the **owner
sign-off** separately — tick with a date when accepted.

> **Rule:** a new phase must **not** open while a prior phase still has unresolved owner-acceptance
> items here. Close (or explicitly waive, with a note) before starting the next phase.

- [ ] Phase 1 (WP 1.6–1.9) — two-theme visual + a11y walk of the Skills registry, add-skill wizard,
      inspector (Overview / Files / Versions / Diff), and `docker compose up --build` round-trips
      @ localhost:8080 — accepted: ____
- [ ] Phase 2 (WP 2.3) — two-theme visual walk of the scenario Allowed-skills editor + a real run
      exercising an attached skill (latest / pinned / eager) @ localhost:8080 — accepted: ____
