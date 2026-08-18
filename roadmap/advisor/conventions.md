# Advisor — shared conventions

Rules every advisor WP assumes. Read this plus your WP spec before touching code.

## Quality gate (definition of done)

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

Green from the repo root, plus every Acceptance item in the WP spec. See
[`.claude/rules/quality-gates.md`](../../.claude/rules/quality-gates.md).

## Contract-first

Wire shapes land in `packages/shared` first (`types.ts` + zod in `schemas.ts` + any constant in
`constants.ts`), then `apps/api`, then `apps/web`. Versionless `/api`, additive fields only.

## Runtime boundary

The advisor is a **read model** over data the app already persists (`mcp_scans` /
`mcp_tool_scans`, `runs` / `run_steps`, `scenarios` / `scenario_servers`, and later
`run_grades` / suite runs). Rules run in `apps/api`; the web layer only renders typed responses.
**No schema migration is expected** — if a WP genuinely needs one, claim it in the plan's
Decision log first (README invariant).

## Advisor invariants (from `README.md`)

1. **Suggestions, never actions.** The app never auto-applies a recommendation. Each card links
   the scans/runs/grades it came from and states its assumptions.
2. **Versioned + deterministic.** Every report is stamped `ADVISOR_VERSION`; grade-aware rules
   additionally record `GRADING_VERSION` and the suite-run ids they read. Same inputs must produce
   byte-identical output (stable ordering, stable dedup keys) — mirrors `TOKEN_COUNTING_VERSION`
   discipline: results computed under different versions are never silently compared.
3. **Honest gaps.** Insufficient data produces an explicit "not enough data" state naming what is
   missing — never a guess, never a zero passed off as a measurement.
4. **Estimates are labeled.** Savings are estimates, marked as such, and reproducible by hand from
   the cited inputs.

## UI rules (WP 1.3, 2.2)

`@elabs-ai/components-*` only (`.claude/rules/brand-ui-only.md`), semantic oklch tokens, both
themes (`light`/`dark`), `IconButton` for icon-only controls (D-TB5), routes vs dialogs per
D-TB10. A new `<Route>` **must** get an `ASSISTANT_ROUTE_MANIFEST` entry
(`.claude/rules/assistant-operability.md`) or `pnpm test` fails.

## Naming

TS files kebab-case, React components PascalCase, tests co-located as `name.test.ts` (api tests
live in `apps/api/test/`). Advisor API code lives in `apps/api/src/advisor/`, web in
`apps/web/src/features/advisor/`.
