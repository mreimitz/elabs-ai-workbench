---
type: "Work Package Spec"
title: "WP 0.1 \u2014 Shared contract for crew nesting (crewId member, nesting fields, depth/total-agent constants, guarded agentId\u2026"
description: "Phase: 0 \u2014 Contract & foundation \u00b7 Size: M \u00b7 Depends on: \u2014 \u00b7 Model: Opus"
tags: ["roadmap", "RM-10"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 0.1 — Shared contract for crew nesting (`crewId` member, nesting fields, depth/total-agent constants, guarded `agentId` derefs)

**Phase:** 0 — Contract & foundation · **Size:** M · **Depends on:** — · **Model:** Opus

## Objective
Land the *entire* wire contract for hierarchical crews in `packages/shared` first (D-CN5, contract-first), so every downstream WP type-checks against one definition. Widen `HubCrewMember.agentId` to optional, add a mutually-exclusive `crewId` (with `.strict()` + a `.superRefine` so it can neither be silently stripped nor coexist with `agentId`), add the optional nesting fields on `HubAgentReport`/`HubMission`/`HubPlannedAgent` and the computed-on-read counts on `HubCrew`, and add the two aggregate-bound constants `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS` (D-CN10). Because the `agentId` widening is wire-additive but **type-breaking**, this WP also guards every `member.agentId` deref so `pnpm typecheck` stays green — with **no behavior change** (execution of a `crewId` member is WP 2.1).

## Why / references
- **D-CN5** — additive-only wire; `agentId`→optional; add `crewId?`; `.superRefine` "exactly one of `{agentId, crewId}`" (the `hubSkillAttachmentInputSchema` precedent); `.strict()` on the member; optional nesting fields on `HubAgentReport` (`subMissionId?`, `topology?`, `childReports?` via `z.lazy` — the `hubGenUiNodeSchema` precedent, `depth?`), `HubMission` (`parentMissionId?`, `depth?`), `crewId?` on `HubPlannedAgent`, and the crew-summary counts. The one required→optional widening (`agentId`) must guard every deref.
- **D-CN10** — ships with `HUB_MISSION_MAX_DEPTH` default **2** and `HUB_MISSION_MAX_TOTAL_AGENTS` default **24**; the *shared* validation-facing constants live here (env override is WP 0.3).
- **D-CN9** — do **not** touch `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope`; this is a pure contract widening, no scope vocabulary.
- Anchors (from `references.md` + the shared-contract map):
  - `types.ts` — `HubAgentReport:5479`, `HubCrewMember:5674`, `HubCrew:5686`, `HubPlannedAgent:5729`, `HubMission:5763`; `ServerType.memberCount:137` (the **computed-on-read count-field precedent**).
  - `schemas.ts` — `hubCrewMemberSchema:3432` (**plain stripping `z.object`, `agentId` required**), `hubAgentReportSchema:3343`, `hubPlannedAgentSchema:3482`, `hubMissionSchema:3509`, `hubCrewSchema:3443`; `hubSkillAttachmentInputSchema:3360` (`.strict().superRefine` precedent), `hubGenUiNodeSchema:3262` (`z.lazy` recursive-schema precedent), `agent_report` event `report: hubAgentReportSchema` `3987`.
  - `constants.ts` — hub validation-limits block `1747–1784` (the home for the two new caps; **no depth/total-agent constant exists today**).
  - Deref sites: `apps/api/src/hub/missions/topologies.ts:441` (`roleById.get(member.agentId)` in `instantiateCrewPlan`), `apps/api/src/hub/roster-scope.ts:34` (`add(member.agentId)`), plus the web sites enumerated below.

## Design
**Ordering (contract-first):** edit `types.ts` → `schemas.ts` → `constants.ts`, then the guard sites, then the test.

1. **`HubCrewMember` (types + schema).**
   - Type: `agentId?: string` (was required); add `crewId?: string`.
   - Schema (`hubCrewMemberSchema`): `agentId: z.string().optional()`, add `crewId: z.string().optional()`, add **`.strict()`** (stops the silent-strip trap — the member is a stripping `z.object` today, so a `crewId` would be dropped on write-then-read), and add a **`.superRefine`** that fails unless **exactly one** of `{agentId, crewId}` is present (`path: ["agentId"]` / `["crewId"]`, a clear message). Backward-compat: every stored `{agentId}` member has exactly one → passes; this is wire-additive, not a `/api/v2` break. Note `hubCrewSchema`/`hubCrewInputSchema`/`hubCrewPatchSchema` all reference `hubCrewMemberSchema`, so they inherit the exactly-one rule automatically — do **not** add member keys to the crew-level shapes.

2. **`HubAgentReport` (types + schema) — the recursive up-flow envelope.**
   - Type: add `subMissionId?: string`, `topology?: HubTopology`, `childReports?: HubAgentReport[]`, `depth?: number` (all optional — old reports still valid; additive response fields).
   - Schema: convert `hubAgentReportSchema` to the **`z.lazy` form with an explicit `z.ZodType<HubAgentReport>` annotation** (exactly like `hubGenUiNodeSchema:3262`) so `childReports: z.array(hubAgentReportSchema).optional()` self-references. Add `subMissionId: z.string().optional()`, `topology: hubTopologySchema.optional()`, `depth: z.number().int().optional()`. Verified safe: nothing calls `.shape`/`.extend`/`.pick`/`.partial` on `hubAgentReportSchema`, and the `agent_report` event (`report: hubAgentReportSchema`) keeps working since it stays the same exported `z.ZodType`.

3. **`HubPlannedAgent`** — add `crewId?: string` (type) + `crewId: z.string().optional()` (schema). Flat plan element gains the crew-ref marker; execution reads it in WP 2.1.

4. **`HubMission`** — add `parentMissionId?: string` + `depth?: number` (type) and `parentMissionId: z.string().optional()`, `depth: z.number().int().optional()` (schema). Response-only additive fields; `HubMissionPlan.agents` stays flat.

5. **`HubCrew` crew-summary counts (computed-on-read).** Add optional `memberCrewIds?: string[]`, `memberAgentCount?: number`, `memberCrewCount?: number`, `totalAgentCount?: number` to the `HubCrew` **type** and `hubCrewSchema` **read** shape only — the `ServerType.memberCount` precedent (computed on read, absent otherwise). **Do not** add them to `hubCrewInputSchema`/`hubCrewPatchSchema` (they stay `.strict()` write shapes). Population (recursive, cycle-safe) is WP 1.1; this WP only defines the fields.

6. **Constants.** In the hub validation-limits block of `constants.ts`, add `export const HUB_MISSION_MAX_DEPTH = 2;` (root + one nested level; `1` reproduces today's semantics — D-CN10) and `export const HUB_MISSION_MAX_TOTAL_AGENTS = 24;`, with a comment that WP 0.3 layers env overrides (`HUB_MISSION_MAX_DEPTH` / `HUB_MISSION_MAX_TOTAL_AGENTS`) on top via `config/env.ts` and that these are the shared validation-facing defaults.

7. **Guard every `member.agentId` deref (typecheck-green, no behavior change).** Under `agentId?: string`, any site passing it where a `string` is required breaks. Pattern: `const roleId = member.agentId; if (!roleId) continue/return;` (or an existing skip path), preserving today's agent-member behavior; a `crewId`-only member simply falls through unchanged here (its real handling is WP 2.1/4.x). Comparison sites (`member.agentId === x`) do **not** break and need no edit. Known breakers:
   - **api** — `topologies.ts:441` (`roleById.get(member.agentId)` — skip like the deleted-role path); `roster-scope.ts:34` (`add(member.agentId)` — guard the call).
   - **web** — `AuditView.tsx:395/397` (`map.get`/`map.set`), `OrgRail.tsx:185/450/457` (`ids.add`, `rolesById.get`, `agentId:` into a `{agentId:string}` drag payload), `DirectoryTab.tsx:147/159/161` (`ids.add`/`map.get`/`map.set`), `MembersSection.tsx:131/147/153` (`roleById.get`, `id={…}`, `.slice`), `BudgetsSection.tsx:46/58` (`roleById.get`, `id={…}`).
   - `hub-read-tools.ts:103` (`crew.members.map((m) => m.agentId)`) lands in a `Record<string, unknown>` and does **not** break typecheck — leave it; WP 1.1 owns real nested counts.
   - After editing, run `pnpm typecheck` and guard **any** additional site the compiler flags (`CrewCard.tsx:28` etc. are comparison-only and should be fine).

## Files
- `packages/shared/src/types.ts` *(modify)* — `HubCrewMember.agentId`→optional + `crewId?`; `crewId?` on `HubPlannedAgent`; `subMissionId?`/`topology?`/`childReports?`/`depth?` on `HubAgentReport`; `parentMissionId?`/`depth?` on `HubMission`; `memberCrewIds?`/`memberAgentCount?`/`memberCrewCount?`/`totalAgentCount?` on `HubCrew`.
- `packages/shared/src/schemas.ts` *(modify)* — `hubCrewMemberSchema`: `agentId` optional + `crewId` + `.strict()` + exactly-one `.superRefine`; `hubAgentReportSchema`→`z.lazy` typed self-ref + new optional fields; `crewId` on `hubPlannedAgentSchema`; `parentMissionId`/`depth` on `hubMissionSchema`; the four count fields on `hubCrewSchema` (read shape only).
- `packages/shared/src/constants.ts` *(modify)* — add `HUB_MISSION_MAX_DEPTH = 2` + `HUB_MISSION_MAX_TOTAL_AGENTS = 24` in the hub validation-limits block, documenting the WP 0.3 env override.
- `apps/api/src/hub/missions/topologies.ts` *(modify)* — guard `member.agentId` in `instantiateCrewPlan` (`:441`).
- `apps/api/src/hub/roster-scope.ts` *(modify)* — guard `add(member.agentId)` (`:34`).
- `apps/web/src/features/hub/AuditView.tsx` *(modify)* — guard `member.agentId` at the map get/set (`:395/:397`).
- `apps/web/src/features/hub/workforce/OrgRail.tsx` *(modify)* — guard the `ids.add`/`rolesById.get`/drag-payload sites (`:185/:450/:457`).
- `apps/web/src/features/hub/workforce/DirectoryTab.tsx` *(modify)* — guard the `ids.add`/`map.get`/`map.set` sites (`:147/:159/:161`).
- `apps/web/src/features/hub/workforce/crew-profile/MembersSection.tsx` *(modify)* — guard `roleById.get`/`id={…}`/`.slice` (`:131/:147/:153`).
- `apps/web/src/features/hub/workforce/crew-profile/BudgetsSection.tsx` *(modify)* — guard `roleById.get`/`id={…}` (`:46/:58`).
- `packages/shared/src/hub-contract.test.ts` *(modify)* — the exhaustive round-trip + reject cases (below).

## Acceptance
- [ ] `HubCrewMember.agentId` is optional and `crewId?: string` exists in **both** `types.ts` and `hubCrewMemberSchema`; the member schema is `.strict()` with an exactly-one-of `{agentId, crewId}` `.superRefine`.
- [ ] `hubAgentReportSchema` is the `z.lazy`/`z.ZodType<HubAgentReport>` form and `childReports?: HubAgentReport[]`, `subMissionId?`, `topology?`, `depth?` exist on both type and schema; nothing that consumes `hubAgentReportSchema` (incl. the `agent_report` event) regresses.
- [ ] `crewId?` on `HubPlannedAgent`; `parentMissionId?`/`depth?` on `HubMission`; `memberCrewIds?`/`memberAgentCount?`/`memberCrewCount?`/`totalAgentCount?` on `HubCrew` — all optional, added to type **and** schema (counts on the **read** `hubCrewSchema` only, **not** input/patch).
- [ ] `HUB_MISSION_MAX_DEPTH` (=2) and `HUB_MISSION_MAX_TOTAL_AGENTS` (=24) exported from `constants.ts`.
- [ ] `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope` are **unchanged** (D-CN9) — `assistant-scope.test.ts` green with no diff.
- [ ] New tests in `hub-contract.test.ts` prove: a legacy `{agentId}` member **validates**; a `{crewId}` member **validates and round-trips with `crewId` present** (parse → assert the field survived — no strip); `{agentId, crewId}` **rejects**; `{}` (neither) **rejects**; an unknown member key **rejects** (`.strict()`); a `HubAgentReport` with nested `childReports` round-trips (self-ref); `HubMission` with `parentMissionId`/`depth`, `HubPlannedAgent` with `crewId`, and `HubCrew` with the count fields each round-trip.
- [ ] `pnpm typecheck` is green with **no behavior change** at any guarded deref (agent-member rendering/resolution identical to `main`; `crewId` members are inert here).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **SOLO.** `packages/shared` is the contested hot file and this WP gates every other crew-nesting WP — run it alone (batch 1 in the README build order). It touches api + web guard sites, but only as type-preserving guards, so no other in-flight WP should be editing the same lines.
- **Additive & type-breaking, not wire-breaking:** every stored `{agentId}` payload still validates, so this stays on versionless `/api` (no `/api/v2`). The only cost is the compile-time widening, which the guards absorb.
- **No migration, no new dependency** — `crewId`/nesting fields ride the opaque `members_json`/`plan_json` blobs (the `skill_ids_json` precedent); the migration for mission lineage is WP 0.2, and env caps are WP 0.3.
- Do **not** populate the crew counts or execute a `crewId` member here — those are WP 1.1 (counts) and WP 2.1 (execution). This WP is purely the contract + typecheck-green guards.
