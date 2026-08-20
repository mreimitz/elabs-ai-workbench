// Assistant operability (planning/Roadmap/RM-05-assistant-operability/, WP 3.1) — the Hub READ toolset:
// `hub_agents_list` / `hub_crews_list` / `hub_usage_summary`. Backs the route-keyed `agents`/`hub`
// starter chips added in WP 2.1 (analysis-only surfaces mirroring the existing `compatibility`
// precedent — NOT new `ASSISTANT_ENTITY_KINDS`, see D-AO3) so those chips are actually answerable
// instead of dead-ending on a tool the agent doesn't have.
//
// Same one-import-one-spread pattern as `issue-loop-tools.ts`/`action-tools.ts`: THREE tools, all
// READS (auto-allowed — their bare names are in `read-tool-names.ts`'s ASSISTANT_READ_TOOL_NAMES),
// no writes, no side effects, no scope-map change (D-AO3 — do not touch SCOPE_WRITE_TOOLS/
// ASSISTANT_ENTITY_KINDS/deriveAssistantScope).
//
//   - hub_agents_list   — the agent-role library (`hub_agents`, HubRepository.listAgentRoles):
//                         "rank my agents by token & cost", "which agents/crews haven't been used
//                         lately", "compare two agents' setup". Drops each role's full systemPrompt
//                         (can be long free text) — everything else useful for ranking/comparison
//                         (model, tool/skill grant shape, budgets, archived/created/updated) stays.
//   - hub_crews_list    — the saved crews (`hub_crews`, HubRepository.listCrews): "summarize how my
//                         crews have been used recently".
//   - hub_usage_summary — the assistant usage/spend rollup: "break down my assistant spend this week
//                         by model & mode", "summarize my recent sessions". Backed by
//                         `buildHubUsageAggregates` (hub/usage.ts) — the SAME aggregation
//                         `GET /api/hub/usage` returns (totals + byModel/byProvider/
//                         byProviderCredential/byMode/byDay +
//                         missions + the R-UX6 plan-acceptance signal), filtered by optional
//                         from/to/projectId. NOTE: despite the tool's name (chosen to match the WP
//                         brief's "hub_usage_summary" and the `hub` starter chip's "summarize
//                         spend/sessions" framing), this is deliberately NOT `buildHubUsageSummary`
//                         (usage.ts's OTHER export) — that sibling answers "how has ONE agent/crew/
//                         project/model/mode been used" and *requires* a `groupBy` + a specific
//                         entity `id`, which the chip's open-ended "break down my spend" questions
//                         don't supply. The aggregate rollup is what actually answers them.
//
// Backed by the SAME `HubRepository` instance the hub routes already construct (`index.ts`'s
// `hubRepository`) — reused, not recreated, like every other read tool's dependency.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { z } from "zod";
import { resolveCrewRollup } from "../../hub/missions/crew-resolution.js";
import { inferHubModelKind } from "../../hub/routes.js";
import type { HubRepository } from "../../hub/repository.js";
import { buildHubUsageAggregates, createHubUsageProviderResolver } from "../../hub/usage.js";
import type { ProviderRepository } from "../../providers/repository.js";
import { boundText, jsonResult, safeTool, truncate, truncateFields } from "./util.js";

/** The dependencies the Hub read tools need — existing instances, reused not recreated. */
export interface HubReadToolDeps {
  hub: HubRepository;
  /**
   * model-identity WP3.3 (D-MI10) — the provider-credential store, so `hub_usage_summary` attributes
   * spend to the credential a session is actually PINNED to (`hub_sessions.provider_credential_id`)
   * instead of re-guessing the provider from the model name. Without it the dock would keep answering
   * "Anthropic" for subscription spend — the same laundering `GET /api/hub/usage` used to do. `list()`
   * returns REDACTED credentials (ids/labels/kinds, never a key), so nothing secret enters a tool result.
   */
  providers: ProviderRepository;
}

// ── Compaction defaults (mirror the rest of the toolset's discipline: cap + explicit truncated marker) ──
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const MAX_TEXT_CHARS = 600;

const limitSchema = z.number().int().positive().max(MAX_LIST_LIMIT).optional();

/** Project one agent role into a compact, agent-legible summary: drops the (potentially long)
 *  `systemPrompt` free text, bounds `description`/`target`/`expectedOutcome`, and reduces the tool
 *  grants to their shape (server ids + per-server tool count, or "all") rather than every allowed
 *  tool name — enough to rank/compare agents without spending tokens on prompt bodies. Exported so the
 *  sibling Hub WRITE tools (`hub-write-tools.ts`, WP 5.1) echo a created/updated role back in the SAME
 *  compact shape (INCLUDING its `id`, so the agent can chain create → collect ids → create a crew). */
export function summarizeAgentRole(role: HubAgentRole): Record<string, unknown> {
  return {
    id: role.id,
    name: role.name,
    ...(role.displayName ? { displayName: role.displayName } : {}),
    ...(role.description ? { description: boundText(role.description, MAX_TEXT_CHARS) } : {}),
    ...(role.icon ? { icon: role.icon } : {}),
    defaultModel: role.defaultModel,
    target: boundText(role.target, MAX_TEXT_CHARS),
    expectedOutcome: boundText(role.expectedOutcome, MAX_TEXT_CHARS),
    toolGrants: {
      servers: Object.keys(role.toolGrants.servers),
      serverToolCounts: Object.fromEntries(
        Object.entries(role.toolGrants.servers).map(([serverId, grant]) => [
          serverId,
          grant === "all" ? "all" : grant.length,
        ]),
      ),
      builtins: role.toolGrants.builtins,
    },
    skillIds: role.skills.map((s) => s.skillId),
    skillCount: role.skills.length,
    ...(role.budgets ? { budgets: role.budgets } : {}),
    archived: Boolean(role.archivedAt),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/** Project one saved crew into a compact summary — the member roles + topology, not each member's
 *  full per-member overrides (system-prompt override, tool grants, …), which duplicate the role
 *  library's own detail (call hub_agents_list for that). Exported for the sibling Hub WRITE tools
 *  (`hub-write-tools.ts`, WP 5.1) to echo a created/updated crew back in this compact shape (with `id`
 *  and `memberAgentIds`, so a crew referencing freshly-created agents is verifiable in one step).
 *
 *  Crew nesting (WP1.1, D-CN5/D-CN8): `agentId` is now optional (a member is EITHER an agent role OR a
 *  nested `crewId`), so `memberAgentIds` is derived with a `flatMap` type-guard to stay `string[]` — for
 *  a legacy `{agentId}`-only crew it is byte-identical to the old `.map(m => m.agentId)`. Added per-kind
 *  counts (`memberAgentCount`/`memberCrewCount`) + the nested-crew ids (`memberCrewIds`); the recursive
 *  `totalAgentCount` is spread ONLY when the caller passes it (`hub_crews_list` resolves it over a
 *  once-built crew Map — the write tools don't yet, that's WP1.2's job). `memberCount` (all members) is
 *  unchanged. */
export function summarizeCrew(
  crew: HubCrew,
  opts?: { totalAgentCount?: number },
): Record<string, unknown> {
  const memberAgentIds = crew.members.flatMap((m) => (m.agentId ? [m.agentId] : []));
  const memberCrewIds = crew.members.flatMap((m) => (m.crewId ? [m.crewId] : []));
  return {
    id: crew.id,
    name: crew.name,
    ...(crew.description ? { description: boundText(crew.description, MAX_TEXT_CHARS) } : {}),
    ...(crew.color ? { color: crew.color } : {}),
    ...(crew.icon ? { icon: crew.icon } : {}),
    topology: crew.topology,
    memberCount: crew.members.length,
    memberAgentIds,
    memberCrewIds,
    memberAgentCount: memberAgentIds.length,
    memberCrewCount: memberCrewIds.length,
    ...(opts?.totalAgentCount !== undefined ? { totalAgentCount: opts.totalAgentCount } : {}),
    createdAt: crew.createdAt,
    updatedAt: crew.updatedAt,
  };
}

/**
 * Build the Hub read toolset's raw tool definitions (pre-`createSdkMcpServer`). Exported separately
 * so tests can call `.handler(args, {})` on one definition directly, mirroring every other toolset
 * module (`buildIssueLoopToolDefinitions`, `buildActionToolDefinitions`, …).
 */
export function buildHubReadToolDefinitions(deps: HubReadToolDeps) {
  return [
    // ── hub_agents_list ──────────────────────────────────────────────────────────────────────────
    tool(
      "hub_agents_list",
      "List the Assistant Hub's agent-role library (the reusable agent definitions behind Agents & " +
        "Crews) — name, model, tool/skill grant shape, budgets, archived state. Use this to rank " +
        "agents, find stale/unused ones, or gather two agents' setups to compare. Compact summaries " +
        "only (full system prompts are omitted) — for usage/spend per agent, follow up with " +
        "hub_usage_summary.",
      {
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived agent roles too. Defaults to active-only."),
        limit: limitSchema,
      },
      async (args) =>
        safeTool(() => {
          const roles = deps.hub.listAgentRoles({ includeArchived: args.includeArchived ?? false });
          const capped = truncate(roles, args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            agents: capped.items.map(summarizeAgentRole),
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    // ── hub_crews_list ───────────────────────────────────────────────────────────────────────────
    tool(
      "hub_crews_list",
      "List the Assistant Hub's saved crews (named teams of agent roles AND/OR nested sub-crews + a " +
        "topology — parallel/pipeline/debate/best-of-N) — name, topology, direct member agent/crew " +
        "ids (memberAgentIds/memberCrewIds), and the recursive totalAgentCount across any nested " +
        "crews, e.g. a crew with 1 direct agent + 1 nested crew of 2 agents reports 1 agent, 1 crew " +
        "(3 total). Use this to summarize how crews — including nested ones — are set up before " +
        "reasoning about their recent usage (hub_usage_summary, groupable by crew via the workforce " +
        "Usage tab's own view).",
      { limit: limitSchema },
      async (args) =>
        safeTool(() => {
          const crews = deps.hub.listCrews();
          // Build the crew Map ONCE (WP1.1) so every crew's recursive rollup resolves nested `crewId`
          // members without re-listing per crew — the default `maxTotalAgents` cap is a display safety
          // bound, not the authoritative runtime cap (that's WP2.1's).
          const crewsById = new Map(crews.map((crew) => [crew.id, crew] as const));
          const capped = truncate(crews, args.limit ?? DEFAULT_LIST_LIMIT);
          return jsonResult({
            crews: capped.items.map((crew) =>
              summarizeCrew(crew, {
                totalAgentCount: resolveCrewRollup({ crew, crewsById }).totalAgentCount,
              }),
            ),
            total: capped.total,
            truncated: capped.truncated,
          });
        }),
    ),

    // ── hub_usage_summary ────────────────────────────────────────────────────────────────────────
    tool(
      "hub_usage_summary",
      "Get the Assistant Hub's usage/spend rollup: totals (sessions/cost/tokens) plus breakdowns by " +
        "model, provider, provider CREDENTIAL (`byProviderCredential` — which specific key was billed; " +
        "a bucket flagged `unpinned:true` was attributed by model name, not recorded), session mode, " +
        "and day, the recent missions list, and the R-UX6 " +
        "plan-acceptance signal (how often a proposed mission plan was approved unedited). Optionally " +
        "scoped to a date range (from/to, ISO-8601) and/or one project. Use this for 'break down my " +
        "assistant spend', 'summarize my recent sessions', or 'how much am I spending on missions'.",
      {
        from: z.string().trim().min(1).optional().describe("ISO-8601 inclusive lower bound on createdAt."),
        to: z.string().trim().min(1).optional().describe("ISO-8601 inclusive upper bound on createdAt."),
        projectId: z.string().trim().min(1).optional().describe("Scope to one Hub project."),
      },
      async (args) =>
        safeTool(() => {
          const summary = buildHubUsageAggregates(
            deps.hub,
            {
              ...(args.from ? { from: args.from } : {}),
              ...(args.to ? { to: args.to } : {}),
              ...(args.projectId ? { projectId: args.projectId } : {}),
            },
            // model-identity WP3.3 (D-MI10) — the SAME resolver `GET /api/hub/usage` uses, so the dock
            // and the Usage view can never report different provider labels for the same spend.
            createHubUsageProviderResolver(deps.providers, inferHubModelKind),
          );
          return jsonResult(
            truncateFields(
              summary,
              ["byModel", "byProvider", "byProviderCredential", "byMode", "byDay", "missions"],
              DEFAULT_LIST_LIMIT,
            ),
          );
        }),
    ),
  ];
}
