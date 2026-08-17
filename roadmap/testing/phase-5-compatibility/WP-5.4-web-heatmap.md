# WP 5.4 — Web heatmap view

**Status:** ⬜ open.
**Depends:** WP 5.3.

## Goal
A `@elabs-ai/components-*`-only compatibility view: Server×Model and Tool×Model green/amber/red grids with a
cited drill-down, so "which model can host this server, and where it breaks" is legible at a glance.

## Deliverables
- `apps/web/src/features/compatibility/` — a new Testing-area view (nav entry in `AppShell`):
  - Model column picker (from `GET /api/compatibility/models`; group by provider; default set).
  - View toggle Server×Model / Tool×Model; roll-up toggle (worst-tool default / average-tool);
    optional host-client selector (Cursor/Claude Desktop/VS Code/…) for the client-layer tests.
  - The grid: cells coloured by band (use `--chart`/semantic tokens, not raw colour); `tabular-nums`
    scores; both themes (`light`/`dark`).
  - Cell drill-down (`Sheet`/`Dialog`): per failing/warning test — user-facing name, `failure_mode`,
    filled rationale, **evidence chips** (value + source link + confidence = "verified vs estimated"),
    and the recommendation. Dedupe recommendations across failing tests.
  - A "manual review" callout listing the 6 `excluded_from_automation` concerns (don't over-claim).
- `apps/web/src/lib/api.ts` — `getCompatibilityHeatmap`, `getCompatibilityModels` helpers.

## Acceptance
- Scan a real server → open the heatmap → a tool-heavy server reads red on Phi-4 / green on a
  1M-window model; drill-down shows cited evidence; renders correctly in both themes (owner verify
  @ http://localhost:8080). Typecheck + build green; brand-ui + token hooks clean.

## References
- `research/token-context-comparison/03-compatibility-test-suite.md` §5 (heatmap), §10 (roll-up).
- `roadmap/10-testing-ui-concept.md`, `roadmap/12-testing-inspector-devtools.md`, `conventions.md` (web).
