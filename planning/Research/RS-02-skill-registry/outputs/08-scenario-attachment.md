---
type: "Research Output"
title: "08 \u2014 Phase 2: attach skills to scenarios"
description: "Mirrors the scenarioservers attachment exactly (02), adding"
tags: ["research", "RS-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 08 — Phase 2: attach skills to scenarios

Mirrors the `scenario_servers` attachment exactly ([`02`](../notes/02-current-architecture-map.md)), adding
the one thing servers lack today: **version selection** (auto-latest or pinned).

## Contract (`packages/shared`)

```ts
export type SkillVersionMode = 'latest' | 'pinned';

export type AllowedSkill = {
  skillId: string;
  versionMode: SkillVersionMode;
  pinnedVersionId?: string;      // required iff versionMode === 'pinned'
};

// extend Scenario:
//   allowedSkills: AllowedSkill[]
```

```ts
export const allowedSkillSchema = z.object({
  skillId: z.string().trim().min(1),
  versionMode: z.enum(['latest', 'pinned']),
  pinnedVersionId: z.string().trim().min(1).optional()
}).superRefine((v, ctx) => {
  if (v.versionMode === 'pinned' && !v.pinnedVersionId)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pinnedVersionId'],
                   message: 'Pin a version or choose latest' });
});
// scenarioInputSchema gains:  allowedSkills: z.array(allowedSkillSchema).default([])
```

## Persistence (`apps/api/src/testing/scenario-repository.ts`)

- Add a `replaceSkills(scenarioId, allowedSkills)` alongside `replaceServers()`, called in the same
  create/update `db.transaction`: clear `scenario_skills` for the scenario, re-insert rows.
- `hydrate()` fills `allowedSkills` from a `listSkills(scenarioId)` reading `scenario_skills`.
- FK `ON DELETE CASCADE` from both `scenarios` and `skills` keeps the join clean; pinning to a
  version that is later deleted cascades that row away (or, softer: fall back to latest — decision in
  [`10`](../notes/10-open-questions.md)).

## Version resolution (`scenario-service.ts`)

Add `resolveAllowedSkills(scenarioId): ResolvedSkill[]` next to `resolveAllowedTools()`:
```
for each allowedSkill:
  versionId = versionMode === 'pinned' ? pinnedVersionId : skill.currentVersionId
  load that SkillVersion + its files (manifest, L1/L2/L3 tokens, SKILL.md body, resource list)
```
`latest` resolves at **run time** (so a scenario tracking latest picks up a freshly pulled version);
`pinned` is reproducible forever. This is the versioning story servers don't have.

## Run-engine wiring — how an attached skill reaches the agent (DECIDED)

**Faithful default + optional eager toggle** (owner-approved; grounded in
[`11-skill-loading-in-real-products.md`](../notes/11-skill-loading-in-real-products.md), which shows every
real product uses L1-always + on-demand tool-read for L2/L3, never eager inlining). Per attached
skill, resolved to a concrete version (latest or pinned):

1. **L1 always** — build one `<available_skills>` block (the `skills-ref` XML shape:
   `name` + `description` + a `skill://<name>@<version>/SKILL.md` location) for all attached skills
   and prepend it to the run's system prompt. This is the real *always-on* context cost and is what
   the token accounting must show.
2. **L2/L3 via a read-only disclosure tool** — register a **`read_skill_file`** tool in the agent
   loop through the existing `tool-bridge.ts` mechanism, backed by the resolved version's files. It
   exposes `list_skill_files()` and `read_skill_file(path)` **only** — read-only, and it **never
   executes** `scripts/*`. Every call is metered (request/response tokens) exactly like MCP
   `tools/call`, so the run reports the **realized** disclosure cost, not a guess. This reproduces the
   real bash/`read_file` disclosure mechanism.
3. **Eager toggle (optional, per attachment)** — a checkbox that additionally inlines the full
   `SKILL.md` body into context up front (a deliberate worst-case comparison). **Off by default.**

The run engine already measures per-call token cost and persists full replay; the L1 block and any
eager L2 add to the `ContextSnapshot` accounting, and disclosure reads flow through the same
tool-call measurement path. **The app never executes skill scripts** — `read_skill_file` only returns
file *contents* to the model; it does not run anything (preserves the Phase-1 non-goal into Phase 2).

## Web UI (`features/testing/`)

- `ScenarioEditor.tsx`: add an **"Allowed skills"** panel beneath "Allowed servers & tools" (same
  right-rail layout), listing attached skills with a version chip ("latest" or "v3") and a live token
  footprint (L1 always-on tokens, +L2 if eager).
- `AddSkillModal.tsx` (clone of `AddServerModal.tsx`): **Step 1** pick a skill; **Step 2** choose
  **Latest** (default) or a specific version (from `GET /api/skills/:id/versions`) + the eager
  toggle. Confirm → append an `AllowedSkill`.
- The scenario's live footprint sum (already shown for servers) gains the attached-skills token
  contribution, so the editor shows total context cost of servers **+** skills before a run.

## Migration & backward-compat

- `scenario_skills` is additive; existing scenarios get an empty `allowedSkills` (default `[]`),
  runs behave unchanged. `scenarioInputSchema.allowedSkills` defaults to `[]`, so old web clients and
  API tests keep passing (additive-only rule, `CLAUDE.md` §5).

# Citations

None.
