---
type: "Work Package Spec"
title: "SkillFlow plan \u2014 conventions (every WP assumes these)"
description: "Shared rules for all SkillFlow work packages. These mirror the repo rules (CLAUDE.md,"
tags: ["roadmap", "RM-23"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# SkillFlow plan — conventions (every WP assumes these)

Shared rules for all SkillFlow work packages. These mirror the repo rules (`CLAUDE.md`,
`.claude/rules/`) and the Skills/Testing plans' conventions; deviations are called out per WP.
The locked decisions (D1–D8) live in [`00-architecture.md`](./00-architecture.md) — cite them
instead of re-arguing them.

## Quality gate (definition of done)
`pnpm typecheck && pnpm test && pnpm build && pnpm lint` must pass from the repo root (Biome,
`biome.json`; the root `.github/workflows/ci.yml` runs the same set). A WP is done only when the
gate is green **and** its Acceptance checklist is met.

## Contract-first
All SkillFlow wire shapes land in `packages/shared` **first** (`types.ts`, `schemas.ts`,
`constants.ts`, re-exported from `index.ts`), then the API, then the web. WP 1.0 owns the whole
SkillFlow contract (graph IR, trace vocabulary, session-trace shape) so later WPs never reshape
it — later additions are **additive** fields only. Versionless `/api` routes, additive only.

## Never-execute invariant (D4 — non-negotiable)
No WP introduces any path that executes skill content: no script runner, no sandbox, no "evaluate
gate" endpoint. Gate outcomes come **only** from observed evidence — `run_steps` payloads of the
session the skill was attached to (via scenarios), or ingested external session events. Any WP that
touches `apps/api/src/testing/` must preserve and re-assert the WP 2.2 (skills plan) read-only
tests.

## Projection & alignment are deterministic
`apps/api/src/skillflow/` is pure text/data analysis — **no model calls, no network, no
filesystem** beyond the DB-stored blobs. Both the projector and the aligner are stamped
(`projector_version`, `aligner_version`, mirroring `counting_version`) so results from different
algorithm versions are never silently compared. Same input → same output; property-test with
synthetic fixtures.

## Storage model
Reuse the content-addressed skill store untouched. New persistence is additive:
`run_skills` (which resolved skill version a run exercised) and `session_traces` /
`session_trace_events` (Phase 3 uploads). Schema via `CREATE TABLE IF NOT EXISTS` in
`db/schema.ts` + additive `ensureColumn` migrations in `db/database.ts`; row types in `db/rows.ts`;
`nanoid()` ids; multi-table writes in `db.transaction(...)`. Graphs and alignments are **derived
data** — cacheable, never authoritative (recomputable from `SKILL.md` + events at any time).

## Round-trip editing rules (Phase 4)
Edits rewrite only the anchored region they target; all other bytes of `SKILL.md` (and every other
file) are preserved exactly. The result is submitted as a **new immutable version** through the
existing ingest path — never an in-place blob mutation. Annotations are HTML comments inside
`SKILL.md`; **no side-car files**. After a round-trip, re-projecting the new version must yield the
edited graph (round-trip property test).

## Ingestion caps (Phase 3)
External session uploads enforce size caps like skill ingestion does (`SESSION_MAX_BYTES`,
`SESSION_MAX_EVENTS`, env-overridable with shared-constant defaults). Session logs may contain
secrets — treat them like run payloads: store redacted, never echo credentials, and apply the
existing redaction discipline before persistence.

## UI rules
`@elabs-ai/components-*` components only (enforced by `enforce-brand-ui` hook). The canvas is **`@elabs-ai/components-flow`**
(already vendored + wired as a `file:` dep — first feature to import it; add the matching
`@source` line for `@elabs-ai/components-flow` dist in `apps/web/src/styles/app.css` when the first import
lands). Conversation panes reuse the existing testing-console `@elabs-ai/components-ai` components; markdown
editing reuses `@elabs-ai/components-editor`. Semantic oklch tokens only — trace verdicts use `FlowNode`
`tone="success"/"destructive"` and semantic utilities, no raw colors (`check-tokens` hook). Two
themes (`light` + `dark`) — every canvas state (default, success, fracture, dimmed,
selected) must read correctly in both. Design/Trace are `Tabs` values inside `SkillInspector`;
state is `useState` + `localStorage`; API via the existing `apiGet/apiPost/…` helpers; feedback via
`pushToast`.

## Naming / tests
TS files kebab-case; React components PascalCase; co-locate tests as `name.test.ts` under
`apps/api/test/` (runner glob). Projection/alignment tests are fixture-driven (checked-in sample
`SKILL.md`s spanning: zero-annotation upload, GitHub-style skill, annotated skill, blank scaffold —
D2 demands the zero-annotation cases pass). Honest reporting: lead with what you did **not** verify;
visual claims cite the running app at `localhost:8080`, both themes.

## Reference
Architecture + locked decisions: [`00-architecture.md`](./00-architecture.md). Existing plans this
one builds on: [`../skills/`](/Roadmap/RM-24-skills/) (registry, attachment, never-execute invariant),
[`../testing/`](/Roadmap/RM-26-testing/) (run engine, `run_steps`, console UI). Skill-format ground truth:
[`../../research/skill-registry/01-agent-skills-format.md`](/Research/RS-02-skill-registry/notes/01-agent-skills-format.md).
