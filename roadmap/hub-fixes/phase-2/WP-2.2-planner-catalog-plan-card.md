# WP 2.2 — planner server catalog + plan-card grant editing + role warnings

**Phase:** 2 · **Size:** M · **Depends on:** 1.2 · **Model:** Opus · **Agent profile:** API prompt + web

## Objective

Prompt-planned missions propose real grants: the planner sees the parent session's reachable
servers and hands them out per agent; the plan card shows and edits per-agent grants before
approval; half-configured crew roles get a visible warning instead of silently running.

## Why / evidence

`analysis.md` RC2.4: `buildMissionPlannerPrompt` passes no tools/catalog (`planner.ts:75-100`), so
the planner's own prompt says "No MCP tools are granted" and rule 1 forbids inventing server names;
the e2e stub proves the resulting `servers: {}`. The live crew plan carried grants but the card
showed only text; roles ran with "Finish configuring this agent's instructions in its profile"
placeholders and "Not yet configured" targets.

## Design

- **Planner injection:** build a compact catalog from the parent's effective grants (same source as
  `resolveHubMcpGrants`, scope-aware after WP 1.2): per server `id`, `name`, tool count, and a
  short capability line. Inject as the planner prompt's tools section; instruct: grants may only
  reference these ids, prefer least privilege (name specific tools for narrow roles, `"all"` for
  broad analyst roles).
- **Validation:** plan clamp rejects/strips grants whose server id is not in the catalog
  (`resolveMcpGrants` already skips unknown ids silently — make it loud at plan time).
- **Plan card:** per-agent chips listing granted servers ("qlik-mreimitz · all" / "3 tools");
  an edit affordance per agent (reuse `ToolGrantPicker` constrained to the parent catalog);
  a warning badge per agent whose `systemPrompt`/`target`/`expectedOutcome` contains the
  "Finish configuring" / "Not yet configured" placeholder strings (exported const in
  `missions/shared.ts` so the check is not a magic string), with copy telling the owner to finish
  the role profile.
- **Wire:** plan edits already round-trip via the existing plan PATCH; grants ride the existing
  `toolGrants` field (no shared change expected; verify).

## Files (exclusive)

- `apps/api/src/hub/missions/planner.ts`, `missions/shared.ts`, `missions/routes.ts` (plan clamp)
- `apps/web/src/features/hub/MissionPlanCard.tsx` (+ test)
- Tests: planner-prompt snapshot with catalog; clamp rejects unknown ids; card chips/edit/warning

## Acceptance

- [ ] Planner prompt contains exactly the parent's grantable servers; stub plan proposes non-empty grants for a data question.
- [ ] Unknown server id in a proposed plan is stripped with a visible plan note (not silently kept).
- [ ] Card: chips render; editing grants persists to the plan; unconfigured-role warning shows for placeholder strings; both themes.
- [ ] Least-privilege instruction present (prompt snapshot).
- [ ] Gate green.
