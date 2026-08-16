# Skills — implementation plan (work packages)

Executable plan for the **Skill Registry & Inspector** feature and its **scenario attachment**,
driven by `/next-wp skills`. The design/research this plan implements lives in
[`../../research/skill-registry/`](../../research/skill-registry/) (read its `README.md` first);
every decision is locked in
[`../../research/skill-registry/10-open-questions.md`](../../research/skill-registry/10-open-questions.md).

Shared rules: [`conventions.md`](./conventions.md). Living state: [`STATUS.md`](./STATUS.md).

## What we're building

A new top-level **Skills** section (order **MCP → Skills → Testing**) to register Agent Skills by
uploading a `.zip`/`SKILL.md` or connecting a GitHub repo, **version** each skill, **pull latest**
from GitHub as a new version with a **deep full-tree diff**, inspect every file/subfolder, export a
version as `.zip`, and — Phase 2 — attach skills to test scenarios (latest or pinned) with faithful
token-footprint accounting.

## WP index

### Phase 1 — Skill Registry & Inspector
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.0 | Shared contract + API deps | — | M |
| 1.1 | DB schema + repository (blob store, createVersion, delete-guard, GC) | 1.0 | L |
| 1.2 | Manifest parse + token accounting (L1/L2/L3) | 1.1 | M |
| 1.3 | Upload ingestion + core routes + export | 1.2 | L |
| 1.4 | GitHub import + pull + upstream check | 1.3 | L |
| 1.5 | Diff engine + routes | 1.3 | M |
| 1.6 | Web: nav section + registry + add-skill wizard | 1.3, 1.4 | L |
| 1.7 | Web: inspector Overview + Files explorer + export/update badge | 1.3 | L |
| 1.8 | Web: Versions + Diff (DiffEditor) | 1.5, 1.7 | M |
| 1.9 | Hardening & docs | 1.6, 1.8 | M |

### Phase 2 — Scenario attachment
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Contract + persistence (`scenario_skills`, delete-guard) | Phase 1 | M |
| 2.2 | Resolution + run-engine wiring (L1 block + `read_skill_file` + eager) | 2.1 | L |
| 2.3 | Web scenario editor (Allowed skills + AddSkillModal) | 2.2 | M |

## Dependency graph

```
1.0 → 1.1 → 1.2 → 1.3 → 1.4 ─┐
                    │        ├→ 1.6 ─┐
                    ├→ 1.5 ──────────┼→ 1.8 → 1.9
                    └→ 1.7 ──────────┘
Phase 2 (needs Phase 1 shipped + existing Testing subsystem):
  2.1 → 2.2 → 2.3
```

## Recommended build order

1. **Backend spine, serial:** `1.0 → 1.1 → 1.2 → 1.3` (contract → storage → accounting → ingest+routes).
2. **Fan out (parallel-safe):** `1.4` (GitHub) ∥ `1.5` (diff) ∥ `1.7` (inspector web) — different files.
3. `1.6` (nav + registry + wizard) after `1.3`/`1.4`; then `1.8` (versions+diff web) after `1.5`+`1.7`.
4. `1.9` hardening.
5. Phase 2 `2.1 → 2.2 → 2.3`.

Parallel batches honor **minimal file overlap** (see each WP's **Files**); WPs touching
`packages/shared` or `apps/api/src/index.ts` are serialized to avoid collisions.

## Definition of done (every WP)

`pnpm typecheck && pnpm test && pnpm build` green from the repo root, plus the WP's **Acceptance**
checklist met. Contract-first, API runtime/secret boundary, `@brand/*`-only + two themes, kebab/Pascal
naming — see [`conventions.md`](./conventions.md).
