# WP 5.2 — research-server onboarding surfacing

**Phase:** 5 · **Size:** S · **Depends on:** 2.2 · **Model:** Sonnet · **Agent profile:** web

## Objective

When a session or a mission plan needs the web and neither `web.*` built-ins nor a research-capable
MCP server are available, the UI says so and offers the existing Tavily/Brave/Exa presets in one
click, instead of failing quietly.

## Why / evidence

`analysis.md` RC5: the presets exist (`researchServerPresets.ts:32-63`, wizard wiring
`ServerWizard.tsx:372-441`) and the research empty-state hint exists
(`ConversationPane.tsx:1614-1633`), but nothing surfaces at mission-planning time, and the hint
disappears once a transcript exists.

## Design

- Extend `hasResearchCapableServer` use: the mission plan card shows an inline notice when the
  planner wanted web capability but the catalog offers none ("No research server registered — add
  one" → deep link into the add-server wizard with the research preset tab preselected).
- The research-mode hint also renders (compact) when a research session HAS transcript but zero
  research-capable grants (today it only shows on empty transcripts).
- If WP 5.1 landed and the model supports `web.search`, these notices acknowledge it and only
  suggest MCP research servers as the pluralistic upgrade (multi-engine, custom sources).

## Files (exclusive)

- `apps/web/src/features/hub/MissionPlanCard.tsx` (notice; later batch than 2.2/2.3 edits), `ConversationPane.tsx` (hint condition; later batch than 3.1), `apps/web/src/features/servers/researchServerPresets.ts` (helper export only)
- Tests: notice/hint conditions matrix

## Acceptance

- [ ] Plan card notice renders exactly when catalog lacks web capability; deep link lands on the wizard's research presets.
- [ ] Research-session compact hint for non-empty transcripts; suppressed when web capability exists.
- [ ] Copy states plainly what is missing and what the preset needs (an API key) — no dark patterns.
- [ ] Both themes; gate green.
