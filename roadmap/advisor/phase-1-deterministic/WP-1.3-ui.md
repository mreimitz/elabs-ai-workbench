# WP 1.3 — Advisor view + server/scenario panels

**Phase:** 1 · **Size:** M · **Depends on:** 1.2

## Objective
Surface recommendations: a dedicated Advisor view with evidence drill-through, plus inline panels
on server and scenario detail.

## Files
- `apps/web/src/features/advisor/*` (new)
- `apps/web/src/App.tsx` (route)
- `packages/shared/src/assistant-route-manifest.ts` (manifest entry — required, gated by `pnpm test`)
- server/scenario detail views (inline panel)
- `apps/web/src/lib/api.ts` (client call)

## Acceptance
- [ ] Recommendation cards show severity, estimated savings **labeled as estimates**, assumptions,
      and evidence links that resolve to the real scan/run/tool.
- [ ] "Not enough data" renders as an honest `EmptyState`, never an empty list passed off as "all
      good".
- [ ] `@elabs-ai/components-*` only, semantic tokens, keyboard reachable, visible focus.
- [ ] `ASSISTANT_ROUTE_MANIFEST` entry added; `assistant-route-operability` test green.
- [ ] Gate green. **Owner must verify** the two-theme visual walk @ localhost:8080 (not
      subagent-doable).
