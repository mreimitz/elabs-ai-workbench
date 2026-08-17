// Assistant operability (roadmap/assistant-operability/, WP 5.1, D-AO7) — the Hub WRITE toolset:
// `hub_agent_create` / `hub_agent_update` / `hub_crew_create` / `hub_crew_update`. These let the dock
// CREATE and EDIT agent roles + saved crews from the (deliberately unpinned) `/assistant/agents` page —
// the owner-hit symptom D-AO7 fixes ("create the crew and the agents" was refused because that page is
// unpinned, so the general app-data write tools hard-deny, AND no agent/crew write tools existed).
//
// PERMISSION MODEL — the EXACT `mcp_tool_call` / `rating_issue_file` precedent (see `action-tools.ts`):
//   - `write`-classified. None of the four names is a WP 1.2 read (they are NOT in
//     `read-tool-names.ts` — adding them there would auto-allow a write, a security hole), a `ui_*`
//     navigation tool, or a delete (no `create`/`update` verb trips the `DESTRUCTIVE_VERB` net), so the
//     classifier's fail-safe default fallthrough puts each in `write` → APPROVAL-GATED (D-AS4). The
//     owner sees the tool + its arguments before it runs; auto-accept ON may auto-allow like any other
//     create/update, but a delete would always ask (there is no Hub delete tool here — D-AO7 is
//     create/update ONLY; deleting an agent/crew stays a UI action, per D-AS4's "deletes always ask").
//   - scope-EXEMPT. Their bare names are added to `SCOPE_EXEMPT_ACTION_TOOLS`
//     (`packages/shared/src/assistant-scope.ts`), so the per-message page-scope hard-deny in
//     `session-manager.ts` (`!isScopeExemptActionTool(bare) && …`) is SKIPPED for them — they are
//     reachable from the unpinned Hub dock (the whole reason they exist), while STILL flowing through
//     the normal approval / auto-accept round-trip below. `ASSISTANT_HUB_WRITE_TOOL_NAMES` is kept
//     part of that shared exempt set by a test (`assistant-scope.test.ts`), mirroring
//     `ASSISTANT_ACTION_WRITE_TOOL_NAMES`.
//
// These are NOT new `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` entries (D-AO3 / D-AO7 — the frozen
// page-scope security vocabulary stays untouched): agents/crews are operated via scope-exempt ACTION
// tools, the low-risk "upgrade path" D-AO3 deferred, not by widening the scoped-entity map.
//
// NO reinvented validation: each tool's model-facing arg schema is the SAME shared route schema the
// `POST/PATCH /api/hub/agents|crews` handlers use (`hubAgentRoleInputSchema` / `hubAgentRolePatchSchema`
// / `hubCrewInputSchema` / `hubCrewPatchSchema`, spread by `.shape`), re-`.parse()`d inside the handler
// (applies the schemas' `.strict()` + field refinements), then delegated to the SAME `HubRepository`
// methods (`create/updateAgentRole`, `create/updateCrew`) — reused, not recreated, exactly like every
// other tool's dependency. A repository throw (a 404 on update, a bad model id, an invalid crew member)
// degrades to a clean `isError` result via `safeTool`, never an uncaught crash. Every success echoes
// the compact entity summary (WITH its `id`) via `hub-read-tools.ts`'s `summarizeAgentRole`/
// `summarizeCrew`, so the agent can chain: create N agents → collect their ids → create a crew that
// references them.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  hubAgentRoleInputSchema,
  hubAgentRolePatchSchema,
  hubCrewInputSchema,
  hubCrewPatchSchema,
} from "@mcp-token-footprint/shared";
import type { HubCrew } from "@mcp-token-footprint/shared";
import { z } from "zod";
import {
  assertCrewMemberCredentials,
  resolveExplicitHubCredential,
} from "../../hub/credential-guard.js";
import { resolveCrewRollup } from "../../hub/missions/crew-resolution.js";
import type { HubRepository } from "../../hub/repository.js";
import type { ProviderRepository } from "../../providers/repository.js";
import { summarizeAgentRole, summarizeCrew } from "./hub-read-tools.js";
import { jsonResult, safeTool } from "./util.js";

/** Crew nesting (WP1.2, D-CN5) — build the crew Map ONCE from every persisted crew (which, after a
 *  create/update, already includes the just-written row) and resolve `crew`'s recursive agent-count
 *  rollup over it, exactly as `hub_crews_list` does (`hub-read-tools.ts`). Shared by both
 *  `hub_crew_create`/`hub_crew_update` so their echoed summary carries the SAME `totalAgentCount` a
 *  subsequent `hub_crews_list` call would report for the same crew. */
function summarizeCrewWithRollup(hub: HubRepository, crew: HubCrew): Record<string, unknown> {
  const crewsById = new Map(hub.listCrews().map((c) => [c.id, c] as const));
  return summarizeCrew(crew, { totalAgentCount: resolveCrewRollup({ crew, crewsById }).totalAgentCount });
}

/**
 * The Hub WRITE tools' bare names — the gated, SCOPE-EXEMPT set (D-AO7). Exported so the scope-exempt
 * consistency test (`assistant-scope.test.ts`) can assert `SCOPE_EXEMPT_ACTION_TOOLS` set-equals
 * `ASSISTANT_ACTION_WRITE_TOOL_NAMES ∪ ASSISTANT_HUB_WRITE_TOOL_NAMES` without restating the strings,
 * mirroring `ASSISTANT_ACTION_WRITE_TOOL_NAMES` in `action-tools.ts`.
 */
export const ASSISTANT_HUB_WRITE_TOOL_NAMES = [
  "hub_agent_create",
  "hub_agent_update",
  "hub_crew_create",
  "hub_crew_update",
] as const;

/** The dependencies the Hub write tools need — the existing `HubRepository`, reused not recreated
 *  (the SAME instance `index.ts` already constructs for the Hub routes + the Hub READ tools), plus
 *  (model-identity WP6.1 / F5) the `ProviderRepository` the shared credential guard validates against.
 *  The read tools already take the same pair. */
export interface HubWriteToolDeps {
  hub: HubRepository;
  providers: ProviderRepository;
}

/**
 * Build the Hub write toolset's raw tool definitions (pre-`createSdkMcpServer`). Exported separately so
 * tests can call `.handler(args, {})` on one definition directly, mirroring every other toolset module
 * (`buildActionToolDefinitions`, `buildHubReadToolDefinitions`, …).
 */
export function buildHubWriteToolDefinitions(deps: HubWriteToolDeps) {
  return [
    // ── hub_agent_create ─────────────────────────────────────────────────────────────────────────
    tool(
      "hub_agent_create",
      "Create a new Assistant Hub agent role (a reusable agent definition in the Agents & Crews " +
        "library): name, systemPrompt, defaultModel, target, expectedOutcome, and optional " +
        "displayName/description/icon/toolGrants/skills/budgets. This WRITES to your Hub, so it is " +
        "approval-gated — the owner sees the fields before it saves. Returns the created role INCLUDING " +
        "its id, so you can create several agents and then reference their ids in hub_crew_create.",
      hubAgentRoleInputSchema.shape,
      async (args) =>
        safeTool(() => {
          const input = hubAgentRoleInputSchema.parse(args); // re-apply .strict() + field refinements
          // model-identity WP6.1 (F5) — the SAME guard `POST /api/hub/agents` runs. Without it this
          // tool wrote an unvalidated pin: an auth-broken credential was accepted
          // silently, and an unknown id died on the FK as a raw SQLITE_CONSTRAINT rather than D-MI9's
          // 409. `safeTool` turns the typed throw into a clean `isError` result for the model.
          if (input.providerCredentialId !== undefined) {
            resolveExplicitHubCredential(
              deps.providers,
              input.providerCredentialId,
              input.defaultModel,
            );
          }
          const role = deps.hub.createAgentRole(input);
          return jsonResult(summarizeAgentRole(role));
        }),
    ),

    // ── hub_agent_update ─────────────────────────────────────────────────────────────────────────
    tool(
      "hub_agent_update",
      "Update an existing Assistant Hub agent role by id. Every field is optional — send only what " +
        "changes (a null clears displayName/description/icon/budgets back to their default; `archived` " +
        "true/false toggles archival). Get the agentId from hub_agents_list. Approval-gated (a write). " +
        "An unknown agentId comes back as an error, not a crash. Returns the updated role.",
      { agentId: z.string().min(1), ...hubAgentRolePatchSchema.shape },
      async (args) =>
        safeTool(() => {
          const { agentId, ...rest } = args;
          const patch = hubAgentRolePatchSchema.parse(rest); // re-apply .strict() + field refinements
          // Same three-way convention as `PATCH /api/hub/agents/:id` (model-identity WP6.1 / F5):
          // ABSENT ⇒ unchanged, nothing validated; `null` ⇒ a deliberate unpin, never a 409; an id ⇒
          // validated against the POST-patch model.
          if (patch.providerCredentialId !== undefined && patch.providerCredentialId !== null) {
            const current = deps.hub.getAgentRole(agentId); // typed 404 if unknown
            resolveExplicitHubCredential(
              deps.providers,
              patch.providerCredentialId,
              patch.defaultModel ?? current.defaultModel,
            );
          }
          const role = deps.hub.updateAgentRole(agentId, patch); // typed 404 if unknown
          return jsonResult(summarizeAgentRole(role));
        }),
    ),

    // ── hub_crew_create ──────────────────────────────────────────────────────────────────────────
    tool(
      "hub_crew_create",
      "Create a new Assistant Hub crew (a named team of agent roles + a topology — parallel/pipeline/" +
        "debate/best-of-N): name, topology, members (each referencing EXACTLY ONE of an existing " +
        "agentId, e.g. one returned by hub_agent_create, OR another crew's crewId to nest it as a " +
        "sub-crew, e.g. one returned by hub_crew_create), and optional description/color/icon. A " +
        "cyclic, over-depth, or missing crewId member comes back as a clean error naming the offending " +
        "crew, not a crash. Approval-gated (a write). Returns the created crew INCLUDING its id, " +
        "memberAgentIds/memberCrewIds, and the recursive totalAgentCount across any nested crews — so " +
        "you can create sub-crews and reference their ids in a parent crew, the same way you'd create " +
        "agents and reference their ids in hub_crew_create.",
      hubCrewInputSchema.shape,
      async (args) =>
        safeTool(() => {
          const input = hubCrewInputSchema.parse(args); // re-apply .strict() + field refinements
          // model-identity WP6.1 (F5) — the fifth write binding: crew-member pins.
          assertCrewMemberCredentials(deps.providers, deps.hub, input.members);
          const crew = deps.hub.createCrew(input);
          return jsonResult(summarizeCrewWithRollup(deps.hub, crew));
        }),
    ),

    // ── hub_crew_update ──────────────────────────────────────────────────────────────────────────
    tool(
      "hub_crew_update",
      "Update an existing Assistant Hub crew by id. Every field is optional — send only what changes " +
        "(a null clears description/color/icon; members REPLACES the whole roster — each member " +
        "referencing EXACTLY ONE of an existing agentId OR another crew's crewId to nest it as a " +
        "sub-crew). Get the crewId from hub_crews_list. Approval-gated (a write). An unknown crewId " +
        "comes back as an error, not a crash; so does a members replacement that would create a " +
        "cyclic, over-depth, or missing crewId reference — the error names the offending crew. " +
        "Returns the updated crew, INCLUDING memberAgentIds/memberCrewIds and the recursive " +
        "totalAgentCount across any nested crews.",
      { crewId: z.string().min(1), ...hubCrewPatchSchema.shape },
      async (args) =>
        safeTool(() => {
          const { crewId, ...rest } = args;
          const patch = hubCrewPatchSchema.parse(rest); // re-apply .strict() + field refinements
          // A `members` patch replaces the whole roster ⇒ every pin in it is a fresh write; absent
          // `members` validates nothing (model-identity WP6.1 / F5).
          assertCrewMemberCredentials(deps.providers, deps.hub, patch.members);
          const crew = deps.hub.updateCrew(crewId, patch); // typed 404 if unknown
          return jsonResult(summarizeCrewWithRollup(deps.hub, crew));
        }),
    ),
  ];
}
