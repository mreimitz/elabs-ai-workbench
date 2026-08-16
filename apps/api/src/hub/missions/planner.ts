// Assistant Hub (roadmap/assistant-hub/, WP1.7, §1.4/§1.5 · D-AH6/D-AH9) — the mission PLANNER.
//
// The planner turn analyzes the user's prompt and proposes a team as a STRUCTURED `HubMissionPlan`
// (topology, per-agent role snapshot + brief + model + grants + budgets + rationale + cost estimate).
// It is deliberately a STRUCTURED-OUTPUT call behind a DI seam (`HubPlanner`), not a full streaming
// `runHubTurn`: the plan is a typed object, not a chat transcript, so a `generateObject`-style call
// (production) or a stubbed function (tests) is the right shape — no streaming/steering/tool-loop
// surface to reproduce. The mission-planner SYSTEM PROMPT is assembled here from the shared prompt
// architecture (`hub/prompting`, mode `mission-planner` + its LAYER-8 orchestration contract), so the
// planner is shown the same routing/decomposition/budget contract WP0.3 authored.
//
// `clampPlanToBudgets` is the HARD-CAP enforcer (D-AH9 — server-side, regardless of the model or the
// autonomy dial): it caps the agent count to the mission `maxAgents`, PRESERVES the plan's topology
// (all four executors — parallel/pipeline/debate/best_of_n — now exist, WP2.2; a value outside the
// enum falls back to `parallel`), pins the autonomy to the session dial, de-dupes agent keys, fills
// per-agent + mission budgets from the env defaults, and computes the cost estimate. The planner model
// can only ever PROPOSE within these caps; it can never widen them.

import type {
  HubAgentRole,
  HubAutonomyLevel,
  HubBudgets,
  HubCrew,
  HubCrewMember,
  HubEvent,
  HubMissionBudgets,
  HubMissionPlan,
  HubPlannedAgent,
  HubServerToolGrant,
  HubSession,
  HubTopology,
} from "@mcp-token-footprint/shared";
import {
  HUB_MISSION_MAX_DEPTH,
  HUB_MISSION_MAX_TOTAL_AGENTS,
  HUB_TOPOLOGIES,
  hubMissionPlanSchema,
} from "@mcp-token-footprint/shared";
import { generateObject, type LanguageModel } from "ai";
import { estimateCost, isModelPriced } from "../../providers/pricing.js";
import { assembleSessionPrompt } from "../prompting/index.js";
import type { HubMcpServerCatalog } from "../tools/index.js";
import {
  clampDebateRounds,
  plannedAgentNeedsConfiguration,
  summarizeCapabilitiesLine,
  summarizeServerCapability,
} from "./shared.js";
import { RESERVED_MODEL_TIERS } from "./roster.js";

/** The hard-cap + autonomy-threshold configuration a mission runs under (from `config/env.ts`). */
export type HubMissionCaps = {
  /** Max agents a mission may spawn (excess planned agents dropped). `HUB_MISSION_MAX_AGENTS`. */
  maxAgents: number;
  /** Max agents running concurrently; the rest queue. `HUB_MISSION_MAX_PARALLEL`. */
  maxParallel: number;
  /** Mission-wide total cost cap applied when the plan names none. `HUB_MISSION_DEFAULT_BUDGET_USD`. */
  defaultBudgetUsd: number;
  /**
   * The ABSOLUTE server-side ceiling on `budgets.maxCostUsd` (D-AH9 — total cost is a HARD cap, not a
   * dial): no plan/crew/edit may set a mission budget above this regardless of what it names, unlike
   * `defaultBudgetUsd` which only supplies a value when the plan names NONE. `HUB_MISSION_MAX_BUDGET_USD`.
   */
  maxBudgetUsd: number;
  /** `threshold` autonomy ceiling — auto-launch only at/under this agent count. `HUB_AUTONOMY_ASK_ABOVE_AGENTS`. */
  askAboveAgents: number;
  /** `threshold` autonomy ceiling — auto-launch only at/under this est. cost. `HUB_AUTONOMY_ASK_ABOVE_USD`. */
  askAboveUsd: number;
  /**
   * crew-nesting (D-CN3/D-CN10) — the max nesting depth a mission tree may reach (root = depth 1).
   * `HUB_MISSION_MAX_DEPTH`. Optional: production always populates it from `config/env.ts`; a reader
   * is responsible for its own `?? fallback`. Enforcement lands in WP 1.1 (author-time) / WP 2.1
   * (run-time), not here.
   */
  maxDepth?: number;
  /**
   * crew-nesting (D-CN3/D-CN10) — the transitive whole-tree leaf-agent ceiling, backstopping the
   * per-mission `maxAgents`. `HUB_MISSION_MAX_TOTAL_AGENTS`. Optional: production always populates it
   * from `config/env.ts`; a reader is responsible for its own `?? fallback`. Enforcement (the
   * whole-tree cascade check) lands in WP 2.2, not here.
   */
  maxTotalAgents?: number;
};

/**
 * hub-fixes WP2.2 (RC2.4) — ONE grantable MCP server, in the compact shape the planner is shown and the
 * plan card renders. Built from the parent session's REACHABLE catalog (the SAME source `resolveHubMcpGrants`
 * reads — scope-aware after WP1.2), so the planner may only ever hand out servers that actually exist +
 * are reachable, and a hallucinated server id is stripped at plan time ({@link clampGrantsToCatalog}).
 */
export type HubPlannerServerCatalogEntry = {
  /** The registered server id — the ONLY value a plan grant may reference. */
  id: string;
  /** Human-readable server name (for the planner's prose + the plan-card chips). */
  name: string;
  /** How many tools the server's latest scan exposes (0 ⇒ `"all"` still grants everything once scanned). */
  toolCount: number;
  /** A short "e.g. …" capability line from the first few tool names — orientation, not exhaustive. */
  capability: string;
};

export type HubPlannerServerCatalog = HubPlannerServerCatalogEntry[];

/**
 * hub-fixes WP2.2 (RC2.4) — project the reachable MCP catalog (`serverId → {serverName, tools}`, the
 * shape `resolveHubMcpGrants`/`buildHubContextMcpCatalogProvider` produce) into the compact planner
 * catalog. Sorted by name (then id) so the injected prompt + the card chips are deterministic.
 */
export function buildPlannerServerCatalog(
  mcpCatalog: ReadonlyMap<string, HubMcpServerCatalog>,
): HubPlannerServerCatalog {
  const entries: HubPlannerServerCatalogEntry[] = [];
  for (const [id, server] of mcpCatalog) {
    const toolNames = server.tools.map((t) => t.name);
    entries.push({
      id,
      name: server.serverName?.trim() || id,
      toolCount: toolNames.length,
      capability: summarizeServerCapability(toolNames),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return entries;
}

/** The prompt section injected into the planner turn (RC2.4): the grantable servers + the least-privilege
 *  contract. Appended by {@link buildMissionPlannerPrompt} only when the parent has reachable servers. */
function renderPlannerServerCatalog(catalog: HubPlannerServerCatalog): string {
  const lines = catalog.map((s) => {
    const count = `${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`;
    const cap = s.capability ? ` — ${s.capability}` : "";
    return `- \`${s.id}\` (${s.name}) · ${count}${cap}`;
  });
  return `## Grantable MCP servers

These are the MCP servers reachable from THIS session — the ONLY servers you may grant to agents. In each agent's tools, reference a server by its EXACT id below; never invent a server id or name (rule 1 still holds). Grant least privilege: name the SPECIFIC tools a narrow role needs, and use \`"all"\` only for a broad analyst role that must range over a server's whole surface. A role that needs no external tools is granted none.

${lines.join("\n")}`;
}

// ── Roster catalog (end-user UX pass — the session's Agents & Crews as a preferred pool) ──────────────

/** One saved role the session scoped in, in the compact shape the planner is shown. The planner reuses
 *  it by setting this `roleId` on a planned agent; the orchestrator then HYDRATES the real config from
 *  the library ({@link hydratePlannedAgentFromRole}). */
export type HubPlannerRosterRole = {
  roleId: string;
  name: string;
  target: string;
  capability: string;
};

/** One saved crew the session scoped in — a named team the planner may adopt wholesale (its topology +
 *  member roles, each referenceable by `roleId`). */
export type HubPlannerRosterCrew = {
  name: string;
  topology: HubTopology;
  members: Array<{ roleId: string; name: string }>;
};

export type HubPlannerRosterCatalog = {
  roles: HubPlannerRosterRole[];
  crews: HubPlannerRosterCrew[];
};

/** A short capability line for a saved role — its granted server ids + skill count (orientation, not
 *  exhaustive), mirroring {@link summarizeServerCapability}'s role for MCP servers. */
function summarizeRoleCapability(role: HubAgentRole): string {
  const servers = Object.keys(role.toolGrants?.servers ?? {});
  const parts: string[] = [];
  if (servers.length > 0) {
    parts.push(`servers: ${servers.slice(0, 3).join(", ")}${servers.length > 3 ? "…" : ""}`);
  }
  if (role.skills.length > 0) {
    parts.push(`${role.skills.length} skill${role.skills.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

/** Project the resolved roster ({@link HubAgentRole}s + resolved crews) into the compact planner catalog.
 *  Roles sorted by name for a deterministic prompt. */
export function buildPlannerRosterCatalog(args: {
  roles: readonly HubAgentRole[];
  crews: ReadonlyArray<{ crew: HubCrew; roles: readonly HubAgentRole[] }>;
}): HubPlannerRosterCatalog {
  const roleEntry = (role: HubAgentRole): HubPlannerRosterRole => ({
    roleId: role.id,
    name: role.name,
    target: role.target.trim(),
    capability: summarizeRoleCapability(role),
  });
  const roles = [...args.roles].sort((a, b) => a.name.localeCompare(b.name)).map(roleEntry);
  const crews = args.crews.map(({ crew, roles: members }) => ({
    name: crew.name,
    topology: crew.topology,
    members: members.map((r) => ({ roleId: r.id, name: r.name })),
  }));
  return { roles, crews };
}

/** The prompt section injected into the planner turn: the saved Agents & Crews the user scoped in, and
 *  the "prefer + reuse by roleId" contract. Appended by {@link buildMissionPlannerPrompt} only when the
 *  roster is non-empty. */
function renderPlannerRosterCatalog(catalog: HubPlannerRosterCatalog): string {
  const roleLine = (r: HubPlannerRosterRole): string => {
    const focus = r.target ? ` · focus: ${r.target}` : "";
    const cap = r.capability ? ` · ${r.capability}` : "";
    return `- roleId \`${r.roleId}\` — ${r.name}${focus}${cap}`;
  };
  const sections: string[] = [];
  if (catalog.roles.length > 0) {
    sections.push(`Saved agents:\n${catalog.roles.map(roleLine).join("\n")}`);
  }
  if (catalog.crews.length > 0) {
    const crewLines = catalog.crews.map((c) => {
      const members = c.members.map((m) => `roleId \`${m.roleId}\` (${m.name})`).join(", ");
      return `- Crew "${c.name}" (${c.topology}): ${members}`;
    });
    sections.push(`Saved crews:\n${crewLines.join("\n")}`);
  }
  return `## Preferred agents & crews

The user scoped these SAVED roles/crews into this session as a PREFERRED POOL. Prefer reusing them over inventing new roles. To reuse a saved role, set its EXACT \`roleId\` (below) on the planned agent — its real system prompt, model, tool grants, and skills are then applied automatically, so you need NOT reproduce them (a short \`brief\` for the task is enough). You MAY still add new roles, drop a listed one, or adopt a whole crew's topology when it fits the task better.

${sections.join("\n\n")}`;
}

/** The inputs a planner seam receives: the assembled mission-planner system prompt, the user's ask,
 *  and the model id to plan on (the parent session's model — the production seam builds it). */
export type HubPlannerInput = {
  systemPrompt: string;
  userText: string;
  model: string;
  /** model-identity WP4.2 (D-MI1) — the credential that owns `model` (the parent session's persisted
   *  pin). The planner call is a `generateObject`, so a subscription-pinned parent cannot run it —
   *  passing the credential lets the resolver refuse honestly instead of silently running the plan on a
   *  metered Anthropic key that merely shares the model NAME. Absent ⇒ the unchanged heuristic. */
  providerCredentialId?: string;
  /** assistant-hub v1-fixes (F7) — OPTIONAL read-only session context (latest mission digest + recent
   *  turns, built by {@link buildPlannerSessionContext}). Appended to the planner's prompt in a fenced
   *  block so follow-up plans build on prior results; the ask itself stays `userText`, verbatim. */
  context?: string;
};

/**
 * The planner DI seam (D-AH6): produce a structured `HubMissionPlan` from the assembled planner prompt
 * + the user's ask. Production wraps AI-SDK `generateObject` ({@link createStructuredPlanner}); tests
 * inject a deterministic stub. The service ALWAYS re-validates + clamps the returned plan
 * ({@link clampPlanToBudgets}) — a planner can never smuggle a plan past the hard caps.
 */
export type HubPlanner = (input: HubPlannerInput) => Promise<HubMissionPlan>;

/**
 * Assemble the mission-planner SYSTEM PROMPT (§1.8 mode `mission-planner` — identity → session context
 * → tools → citations → working-visibly → LAYER-8 orchestration contract → planner addendum → safety →
 * self-check). The orchestration LAYER is injected with the live caps + autonomy thresholds + model
 * roster so the planner routes within policy. Pure — no model call.
 */
export function buildMissionPlannerPrompt(args: {
  session: Pick<HubSession, "title" | "mode" | "model">;
  caps: HubMissionCaps;
  roster?: string;
  now?: string;
  /** hub-fixes WP2.2 (RC2.4) — the parent session's grantable MCP servers. When present + non-empty,
   *  a "Grantable MCP servers" section (server ids + least-privilege contract) is appended so the
   *  planner proposes REAL grants instead of the pre-fix "No MCP tools are granted" fallback that made
   *  rule 1 forbid inventing server names. Absent/empty ⇒ the prompt is unchanged (backward compatible;
   *  the propose-path wiring of this catalog into the orchestrator is WP2.3). */
  serverCatalog?: HubPlannerServerCatalog;
  /** End-user UX pass — the saved Agents & Crews the session scoped in (a PREFERRED POOL). When present
   *  + non-empty, a "Preferred agents & crews" section (roleIds + the prefer/reuse-by-roleId contract)
   *  is appended so the planner reuses saved roles instead of inventing a team from scratch. Absent/empty
   *  ⇒ the prompt is unchanged (backward compatible). */
  rosterCatalog?: HubPlannerRosterCatalog;
}): string {
  const { session, caps, roster, serverCatalog, rosterCatalog } = args;
  const assembled = assembleSessionPrompt({
    mode: "mission-planner",
    session: {
      sessionTitle: session.title,
      mode: session.mode,
      modelId: session.model,
      capabilities: summarizeCapabilitiesLine(),
      date: args.now ?? new Date().toISOString().slice(0, 10),
    },
    orchestration: {
      maxParallel: caps.maxParallel,
      maxAgents: caps.maxAgents,
      askAboveAgents: caps.askAboveAgents,
      askAboveUsd: `$${caps.askAboveUsd.toFixed(2)}`,
      ...(roster ? { modelRoster: roster } : {}),
    },
  });
  const sections = [assembled.text];
  if (serverCatalog && serverCatalog.length > 0) {
    sections.push(renderPlannerServerCatalog(serverCatalog));
  }
  if (rosterCatalog && (rosterCatalog.roles.length > 0 || rosterCatalog.crews.length > 0)) {
    sections.push(renderPlannerRosterCatalog(rosterCatalog));
  }
  return sections.join("\n\n");
}

/** Guard a planner-proposed topology to the closed enum (D-AH6), defaulting anything unrecognized to
 *  `parallel` — the always-safe fan-out. The four executors all exist post-WP2.2, so a valid value is
 *  preserved verbatim (no coercion to parallel). */
export function coerceTopology(topology: unknown): HubTopology {
  return (HUB_TOPOLOGIES as readonly string[]).includes(topology as string)
    ? (topology as HubTopology)
    : "parallel";
}

/**
 * hub-fixes WP2.4 (cost/budget integrity) — a rough per-agent TOKEN ENVELOPE for the estimate fallback
 * below: the role prompt + isolated brief + a typical tool-result round on the input side, and a
 * structured report on the output side. This is a ballpark, not a usage prediction — the planner model
 * is never asked to hit it, and a real agent may land well above or below it. It exists so the mission
 * estimate is never silently `0` just because the planner model omitted a per-agent figure (the
 * pre-fix bug: `analysis.md` — "mission costUsd / plan estimatedCostUsd 0 / 0").
 */
export const MISSION_AGENT_TOKEN_ENVELOPE = { inputTokens: 8_000, outputTokens: 1_500 } as const;

/**
 * hub-fixes WP2.4 — one agent's cost ESTIMATE: the planner model's own figure when it named a positive
 * one, else the token-envelope heuristic priced at the agent's own model rate (the existing cost basis,
 * {@link estimateCost} — the same pricing table the real run/synthesis/extraction costs are computed
 * from). An unpriced model (no pricing entry at all) still returns `0` here — an honest "we don't know",
 * not a fabricated number.
 */
export function estimateAgentCostUsd(agent: Pick<HubPlannedAgent, "model" | "estimatedCostUsd">): number {
  if (typeof agent.estimatedCostUsd === "number" && agent.estimatedCostUsd > 0) {
    return agent.estimatedCostUsd;
  }
  return estimateCost(agent.model, MISSION_AGENT_TOKEN_ENVELOPE);
}

/**
 * The plan's cost ESTIMATE (the autonomy-threshold input + the plan-card figure, always rendered there
 * with an "≈" — labeled as an estimate, never claimed exact): the planner model's own total when it named
 * a positive one, else the sum of each agent's {@link estimateAgentCostUsd} — so a plan whose model
 * skipped the figure (or an agent within it) still yields a real, non-zero number for every agent whose
 * model has a known price, rather than the pre-fix `0` (hub-fixes WP2.4).
 */
export function estimatePlanCostUsd(plan: HubMissionPlan): number {
  if (typeof plan.estimatedCostUsd === "number" && plan.estimatedCostUsd > 0) {
    return plan.estimatedCostUsd;
  }
  return plan.agents.reduce((sum, agent) => sum + estimateAgentCostUsd(agent), 0);
}

// ── Crew nesting (WP2.2 / D-CN3) — the whole-tree budget cascade ───────────────────────────────────────

/**
 * Crew nesting (WP2.2 / D-CN3) — THE monotone allocation primitive. A child subtree is handed
 * `min(childRequestedUsd, parentRemainingUsd)`, floored at 0. It takes **no `caps` argument** — so it is
 * STRUCTURALLY impossible for it to re-read an env ceiling below the root (the R1/R3b trap); the only bound
 * it can ever apply is the parent's own remaining pool. Threaded once per level: a `reservable` pool starts
 * at the parent's already-clamped `maxCostUsd` and is decremented by each child's allocation AT SPAWN (not
 * at settle), so `sum(child allocations) ≤ parentAllocation` holds regardless of parallelism — which is
 * what defeats the per-level amplification (N parallel children each reading the same live remaining could
 * otherwise each be handed the full remaining). A nested crew that NAMES no budget inherits the parent's
 * remaining (the caller passes `parentRemainingUsd` as the request), never a fresh env default.
 */
export function allocateChildBudget(childRequestedUsd: number, parentRemainingUsd: number): number {
  return Math.max(0, Math.min(childRequestedUsd, parentRemainingUsd));
}

/** Crew nesting (WP2.2) — a resolved saved crew (crew + its member roles), the shape the orchestrator's
 *  `resolveCrew` DI returns. Declared structurally so `planner.ts` need not import from `orchestrator.ts`
 *  (the dependency direction is orchestrator → planner). */
type ResolvedCrewForTree = { crew: HubCrew; roles: readonly HubAgentRole[] };

/** Crew nesting (WP2.2) — one child of a level in the resolved mission tree: either a LEAF agent (its own
 *  priced cost basis) or a nested CREW (its id + the budget it requests, if the member named one). */
type MissionTreeChild =
  | { kind: "leaf"; costUsd: number }
  | { kind: "crew"; crewId: string; requestedUsd: number | undefined };

/** The whole-tree summary the propose gate is computed over (D-CN3, closing R4/R1/R3): the leaf agents that
 *  will ACTUALLY run across the nested tree, the deepest crew level reached (root = 0), and a MONOTONE
 *  (allocation-bounded) cost estimate — never the root's direct-member view. */
export type MissionTreeSummary = {
  transitiveAgentCount: number;
  maxDepth: number;
  estimatedCostUsd: number;
};

/** Project a ROOT planned agent into a tree child (a leaf priced from its own model/estimate; a crew-ref
 *  carries its id + the member-named budget, if any). */
function plannedAgentToTreeChild(agent: HubPlannedAgent): MissionTreeChild {
  if (agent.crewId != null) {
    return { kind: "crew", crewId: agent.crewId, requestedUsd: agent.budgets?.maxCostUsd };
  }
  return { kind: "leaf", costUsd: estimateAgentCostUsd(agent) };
}

/** Project a nested crew MEMBER into a tree child. A deleted-role member (no matching role) resolves to
 *  `undefined` and is dropped — mirroring `instantiateCrewPlan`'s deleted-role skip, so the count reflects
 *  the agents that will actually run. A crew-ref carries the member-named budget (if any). */
function crewMemberToTreeChild(
  member: HubCrewMember,
  roles: readonly HubAgentRole[],
): MissionTreeChild | undefined {
  if (member.crewId != null) {
    return { kind: "crew", crewId: member.crewId, requestedUsd: member.budgets?.maxCostUsd };
  }
  const role = member.agentId ? roles.find((r) => r.id === member.agentId) : undefined;
  if (!role) return undefined; // a deleted role — skipped, never counted (instantiate-time parity)
  return { kind: "leaf", costUsd: estimateAgentCostUsd({ model: member.model ?? role.defaultModel }) };
}

/**
 * Crew nesting (WP2.2 / D-CN3, closing R4/R1/R3) — summarize the FULLY RESOLVED crew tree at propose time:
 * the transitive leaf-agent count, the deepest crew level reached, and a MONOTONE cost estimate. It walks
 * the resolved crew graph carrying a visited-set + depth counter (belt-and-suspenders with the WP1.1
 * author-time guard — a graph mutated after save can't slip a cycle/over-depth branch past here either) and
 * MIRRORS the run-time engine's own rejects so the count is "agents that WILL run": a crew-ref that is
 * over-depth (`childDepth >= maxDepth`), already on the path (a cycle), unresolvable, or handed a 0
 * allocation (its parent's pool was exhausted — R3c) contributes 0. The cost estimate subdivides the root
 * allocation with {@link allocateChildBudget} (a `reservable` pool per level), so it is itself monotone:
 * `estimatedCostUsd ≤ rootAllocationUsd` always, and NO env cap is re-read below the root — `rootAllocationUsd`
 * is the ALREADY-CLAMPED `plan.budgets.maxCostUsd` the caller passes in (= `min(rootRequested, caps.maxBudgetUsd)`),
 * so this function never touches `caps.maxBudgetUsd` / `caps.defaultBudgetUsd`.
 *
 * A FLAT mission (no `crewId` members) yields `transitiveAgentCount === plan.agents.length`, `maxDepth === 0`
 * and (when the budget covers the plan) `estimatedCostUsd === estimatePlanCostUsd` — so every flat propose
 * path is unchanged.
 */
export function summarizeMissionTree(
  root: {
    agents: readonly HubPlannedAgent[];
    /** The ALREADY-CLAMPED root mission budget (`plan.budgets.maxCostUsd` = `min(rootRequested,
     *  caps.maxBudgetUsd)`) — the whole-tree ceiling. Read here as-is; NEVER re-derived from `caps`. */
    rootAllocationUsd: number;
    resolveCrew: (crewId: string) => ResolvedCrewForTree | undefined;
  },
  caps: Pick<HubMissionCaps, "maxDepth" | "maxTotalAgents">,
): MissionTreeSummary {
  const maxDepth = caps.maxDepth ?? HUB_MISSION_MAX_DEPTH;
  const maxTotalAgents = caps.maxTotalAgents ?? HUB_MISSION_MAX_TOTAL_AGENTS;
  const acc: MissionTreeSummary = { transitiveAgentCount: 0, maxDepth: 0, estimatedCostUsd: 0 };

  const walk = (
    children: readonly MissionTreeChild[],
    allocationUsd: number,
    depth: number,
    visited: ReadonlySet<string>,
  ): void => {
    // `reservable` starts at this level's allocation and is decremented as each child (leaf or crew) is
    // handed its bounded slice — so `sum(child allocations) ≤ allocationUsd` at every node (the load-bearing
    // monotone invariant), and the leaf-cost sum for the whole tree ≤ the root allocation.
    let reservable = allocationUsd;
    for (const child of children) {
      // Bound the walk itself (resolveCrewRollup parity): a pathological diamond lattice can't spin the
      // count unbounded — once it crosses the ceiling, exceeding is all the propose gate needs to know.
      if (acc.transitiveAgentCount > maxTotalAgents) return;
      if (child.kind === "leaf") {
        const alloc = allocateChildBudget(child.costUsd, reservable);
        reservable -= alloc;
        acc.transitiveAgentCount += 1;
        acc.estimatedCostUsd += alloc;
        continue;
      }
      // A crew-ref — mirror the run-time engine's own rejects so the count is "agents that WILL run".
      const childDepth = depth + 1;
      if (childDepth >= maxDepth || visited.has(child.crewId)) continue; // over-depth / cycle → rejected → 0
      const resolved = root.resolveCrew(child.crewId);
      if (!resolved) continue; // unresolvable (deleted) → 0
      const alloc =
        child.requestedUsd !== undefined && child.requestedUsd > 0
          ? allocateChildBudget(child.requestedUsd, reservable)
          : Math.max(0, reservable); // names no budget ⇒ inherit the parent's remaining (never a fresh cap)
      reservable -= alloc;
      if (alloc <= 0) continue; // R3c — a 0-allocation sub-crew won't run, so it adds no agents/cost
      acc.maxDepth = Math.max(acc.maxDepth, childDepth);
      const nested = resolved.crew.members
        .map((m) => crewMemberToTreeChild(m, resolved.roles))
        .filter((c): c is MissionTreeChild => c !== undefined);
      walk(nested, alloc, childDepth, new Set([...visited, child.crewId]));
    }
  };

  walk(root.agents.map(plannedAgentToTreeChild), root.rootAllocationUsd, 0, new Set<string>());
  return acc;
}

/** hub-fixes WP2.2 (RC2.4) — the sentinel prefix that marks a SYSTEM-generated plan note (grant-strip /
 *  unconfigured-role) inside `plan.rationale`. Prior notes are stripped before fresh ones are appended so
 *  a re-clamp (edit → re-clamp) is idempotent instead of accumulating duplicates. */
const PLAN_CHECK_NOTE_PREFIX = "⚠ Plan check:";

/** Drop any previously-appended plan-check note lines from a rationale, returning the human/planner base. */
function stripPlanCheckNotes(rationale?: string): string {
  if (!rationale) return "";
  return rationale
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(PLAN_CHECK_NOTE_PREFIX))
    .join("\n")
    .trim();
}

/**
 * hub-fixes WP2.2 (RC2.4) — validate a plan's per-agent grants against the parent's REACHABLE server
 * catalog: strip every grant whose server id is not in the catalog (the planner may not smuggle a
 * hallucinated / unreachable server past the plan card), and record each strip LOUDLY as a `plan.rationale`
 * note — instead of `resolveMcpGrants`'s silent turn-time drop. Also surfaces any half-configured role
 * (placeholder instructions/target) as a note. Idempotent (prior notes are re-derived). Returns a NEW plan
 * + the per-agent removed ids (for tests / callers). Never throws.
 */
export function clampGrantsToCatalog(
  plan: HubMissionPlan,
  serverCatalog: HubPlannerServerCatalog,
): { plan: HubMissionPlan; removed: Record<string, string[]> } {
  const allowed = new Set(serverCatalog.map((s) => s.id));
  const removed: Record<string, string[]> = {};
  const agents = plan.agents.map((agent) => {
    const kept: Record<string, HubServerToolGrant> = {};
    const stripped: string[] = [];
    for (const [serverId, grant] of Object.entries(agent.toolGrants.servers ?? {})) {
      if (allowed.has(serverId)) kept[serverId] = grant;
      else stripped.push(serverId);
    }
    if (stripped.length === 0) return agent;
    removed[agent.key] = stripped;
    return { ...agent, toolGrants: { ...agent.toolGrants, servers: kept } };
  });

  const noteLines: string[] = [];
  for (const [key, ids] of Object.entries(removed)) {
    const label = agents.find((a) => a.key === key)?.name?.trim() || key;
    noteLines.push(
      `${PLAN_CHECK_NOTE_PREFIX} ${label} — removed ${ids.length === 1 ? "a grant" : "grants"} to ${ids
        .map((id) => `"${id}"`)
        .join(", ")} (not reachable from this session).`,
    );
  }
  const unconfigured = agents.filter((a) => plannedAgentNeedsConfiguration(a));
  if (unconfigured.length > 0) {
    const names = unconfigured.map((a) => a.name?.trim() || a.key).join(", ");
    noteLines.push(
      `${PLAN_CHECK_NOTE_PREFIX} ${unconfigured.length === 1 ? "1 role is" : `${unconfigured.length} roles are`} not fully configured (${names}) — finish the role profile before running.`,
    );
  }

  const base = stripPlanCheckNotes(plan.rationale);
  const rationale = [base, noteLines.join("\n")].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const { rationale: _prev, ...rest } = plan;
  const next: HubMissionPlan = { ...rest, agents, ...(rationale ? { rationale } : {}) };
  return { plan: next, removed };
}

/** The sentinel prefix for a SYSTEM-generated MODEL-substitution note. Distinct from
 *  {@link PLAN_CHECK_NOTE_PREFIX} on purpose: `stripPlanCheckNotes` (run by `clampGrantsToCatalog`)
 *  only strips the "Plan check" prefix, so a model note survives the subsequent clamp. */
const MODEL_CHECK_NOTE_PREFIX = "⚠ Model check:";

/** Drop any previously-appended model-check note lines (idempotency), returning the human/planner base. */
function stripModelCheckNotes(rationale?: string): string {
  if (!rationale) return "";
  return rationale
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(MODEL_CHECK_NOTE_PREFIX))
    .join("\n")
    .trim();
}

/**
 * The mission "balanced" guard (owner decision — auto-pick real models + a deterministic safety net):
 * ensure NO planned agent carries a non-resolvable model into a spawned child session. The planner is
 * SUPPOSED to emit a concrete model id (it is shown the live roster, `formatModelRoster`), but an LLM
 * can still return a bare TIER LABEL (`frontier`/`balanced`/… — {@link RESERVED_MODEL_TIERS}) or an
 * empty string; either one fails at model-resolution time ("The model `balanced` does not exist…").
 *
 * This replaces exactly those two cases with `fallbackModel` (the parent session's own, user-chosen,
 * known-good model) and records each substitution LOUDLY as a `⚠ Model check:` note the plan card
 * renders. It is deliberately CONSERVATIVE — an id it doesn't recognize but that is neither a tier
 * label nor empty (e.g. an off-roster `assistant|…|…` a user genuinely assigned) is left untouched, so
 * a legitimate provider-native id is never clobbered. Pure, idempotent, never throws. Runs BEFORE the
 * clamp so the note survives (the clamp's own strip only removes "Plan check" notes).
 *
 * model-identity WP6.1 (F12) — **the substitution now carries the pin with the model**, per the
 * pin-staleness rule (`topologies.ts` `pinForModel`). Substituting the parent session's model while
 * leaving the agent's own `providerCredentialId` alone silently re-routed a subscription-pinned parent's
 * agent to the metered twin — the same shape as F2. Since the substituted model IS the parent session's,
 * the credential that owns it is the parent session's pin: `fallbackProviderCredentialId` is applied,
 * and any pin the agent carried is dropped (it was authored for a tier label that names no real model,
 * so it cannot be honoured for a different one). Dropping lands on the heuristic, never a wrong
 * credential. Agents whose model is left untouched keep their pin untouched too.
 */
export function normalizePlannedModels(
  plan: HubMissionPlan,
  fallbackModel: string,
  fallbackProviderCredentialId?: string,
): { plan: HubMissionPlan; replaced: string[] } {
  const replaced: string[] = [];
  const agents = plan.agents.map((agent) => {
    const model = (agent.model ?? "").trim();
    if (model !== "" && !RESERVED_MODEL_TIERS.has(model.toLowerCase())) return agent;
    replaced.push(agent.name?.trim() || agent.key);
    const { providerCredentialId: _stale, ...rest } = agent;
    return {
      ...rest,
      model: fallbackModel,
      ...(fallbackProviderCredentialId ? { providerCredentialId: fallbackProviderCredentialId } : {}),
    };
  });
  if (replaced.length === 0) return { plan, replaced };

  const note = `${MODEL_CHECK_NOTE_PREFIX} ${
    replaced.length === 1 ? "1 agent had" : `${replaced.length} agents had`
  } no concrete model (${replaced.join(", ")}) — set to \`${fallbackModel}\`.`;
  const base = stripModelCheckNotes(plan.rationale);
  const rationale = [base, note].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const { rationale: _prev, ...rest } = plan;
  return { plan: { ...rest, agents, ...(rationale ? { rationale } : {}) }, replaced };
}

/** The sentinel prefix for a SYSTEM-generated PROVIDER-pin note. A THIRD distinct prefix, for the same
 *  reason {@link MODEL_CHECK_NOTE_PREFIX} is distinct from {@link PLAN_CHECK_NOTE_PREFIX}: each clamp
 *  strips only its OWN notes before re-deriving them, so running all three in sequence must not let one
 *  eat another's. (`clampPlannedCredentials` runs right after `normalizePlannedModels`, which is exactly
 *  where a shared prefix would have silently swallowed the model-check note.) */
const PROVIDER_CHECK_NOTE_PREFIX = "⚠ Provider check:";

/** Drop any previously-appended provider-check note lines (idempotency), returning the base. */
function stripProviderCheckNotes(rationale?: string): string {
  if (!rationale) return "";
  return rationale
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(PROVIDER_CHECK_NOTE_PREFIX))
    .join("\n")
    .trim();
}

/**
 * model-identity WP4.2 (D-MI1/D-MI9, blast-radius row 16) — the HALLUCINATION GUARD for a planner-emitted
 * `providerCredentialId`.
 *
 * `formatModelRoster` now shows a `pin=<credentialId>` for a model id that more than one credential
 * serves, so the planner can express "the subscription Sonnet" without the id ever being namespaced
 * (D-MI1 rejects the composite id; §3 freezes the canonical ids). Anything a model can copy, a model can
 * also invent — and an invented pin is materially worse than none: D-MI9 makes an unresolvable explicit
 * pin a **409 at turn time**, so a hallucinated nanoid would fail an agent that would otherwise have run
 * fine on the heuristic.
 *
 * So a pin not present in `knownCredentialIds` is STRIPPED (the agent falls back to the documented
 * absent-pin path: today's heuristic + a structured `log.warn`), mirroring exactly what
 * `clampGrantsToCatalog` does with an invented server id. A pin that IS known is passed through
 * untouched — validating it (exists · hub-eligible · not auth-broken) is the resolver's job at turn
 * time, not the planner's, and duplicating that check here would fork D-MI9's single refusal point.
 *
 * Pure, idempotent, never throws. An EMPTY `knownCredentialIds` set means "no roster was available"
 * (a failed/empty provider listing — `buildHubMissionModelRoster` returns undefined there), which must
 * not be read as "every pin is invented": the plan is returned untouched.
 */
export function clampPlannedCredentials(
  plan: HubMissionPlan,
  knownCredentialIds: ReadonlySet<string>,
): { plan: HubMissionPlan; stripped: string[] } {
  const stripped: string[] = [];
  if (knownCredentialIds.size === 0) return { plan, stripped };
  const agents = plan.agents.map((agent) => {
    const pin = agent.providerCredentialId?.trim();
    if (!pin || knownCredentialIds.has(pin)) return agent;
    stripped.push(agent.name?.trim() || agent.key);
    const { providerCredentialId: _dropped, ...rest } = agent;
    return rest;
  });
  if (stripped.length === 0) return { plan, stripped };

  const note = `${PROVIDER_CHECK_NOTE_PREFIX} ${
    stripped.length === 1 ? "1 agent named" : `${stripped.length} agents named`
  } a provider credential that does not exist (${stripped.join(", ")}) — the pin was dropped; ${
    stripped.length === 1 ? "it runs" : "they run"
  } on the default provider for the model.`;
  const base = stripProviderCheckNotes(plan.rationale);
  const rationale = [base, note].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const { rationale: _prev, ...rest } = plan;
  return { plan: { ...rest, agents, ...(rationale ? { rationale } : {}) }, stripped };
}

// ── model-identity WP6.1 (F6 / D-MI11) — the UNPRICED-BY-DESIGN path ────────────────────────────────

/** The sentinel prefix for a SYSTEM-generated PRICE-gap note. A fourth distinct prefix (alongside
 *  Plan / Model / Provider check) so no note's strip eats another's. */
const PRICE_CHECK_NOTE_PREFIX = "⚠ Price check:";

/** Drop any previously-appended price-check note lines (idempotency), returning the human/planner base. */
function stripPriceCheckNotes(rationale?: string): string {
  if (!rationale) return "";
  return rationale
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(PRICE_CHECK_NOTE_PREFIX))
    .join("\n")
    .trim();
}

/**
 * D-MI11's *"a subscription id with no published API price takes an explicit unpriced-by-design path
 * (surfaced as 'not priced', not a silent `$0`), so a cost cap is never silently inert."* WP1.3 added
 * the hand-authored price maps but never built this half, which WP5.R's F6 recorded.
 *
 * Why a silent `$0` is the dangerous outcome: `estimateAgentCostUsd` → `estimateCost` returns `0` for a
 * model with no pricing entry, and `shouldAutoApprove`'s `threshold` dial compares that figure against
 * `askAboveUsd`. So a mission whose agents are ALL unpriced sails under any ceiling and auto-launches —
 * the cap is not merely wrong, it is inapplicable, and nothing says so. (`isModelPriced` deliberately
 * separates this from a genuinely free local model, which is priced at an explicit `0`.)
 *
 * This makes the gap VISIBLE rather than inventing a number: the unpriced agents are named in a loud
 * `⚠ Price check:` note the plan card renders, and the caller passes `costEstimateComplete: false` to
 * {@link shouldAutoApprove}, which then ASKS instead of comparing against a meaningless total.
 *
 * Scope, honestly: this reads the ROOT plan's agents. A nested crew's members are instantiated at run
 * time (`runSubCrew`), so an unpriced model that only appears deeper in the tree is not named here.
 * Pure, idempotent, never throws.
 */
export function notePlanPricingGaps(plan: HubMissionPlan): {
  plan: HubMissionPlan;
  unpriced: string[];
} {
  const unpriced: string[] = [];
  for (const agent of plan.agents) {
    const model = (agent.model ?? "").trim();
    // A crew-ref carries a placeholder model that `normalizePlannedModels` backfills; skip the empty
    // string rather than reporting "" as an unpriced model.
    if (model === "" || isModelPriced(model)) continue;
    unpriced.push(agent.name?.trim() || agent.key);
  }
  if (unpriced.length === 0) {
    // Still strip a stale note from a previous pass (idempotency after the gap is closed).
    const base = stripPriceCheckNotes(plan.rationale);
    if (base === (plan.rationale ?? "").trim()) return { plan, unpriced };
    const { rationale: _prev, ...rest } = plan;
    return { plan: { ...rest, ...(base ? { rationale: base } : {}) }, unpriced };
  }

  const note = `${PRICE_CHECK_NOTE_PREFIX} ${
    unpriced.length === 1 ? "1 agent runs" : `${unpriced.length} agents run`
  } on a model with no published price (${unpriced.join(", ")}) — ${
    unpriced.length === 1 ? "its" : "their"
  } cost is NOT PRICED (not $0), so the estimate below excludes ${
    unpriced.length === 1 ? "it" : "them"
  } and the auto-approve cost threshold cannot apply to this mission.`;
  const base = stripPriceCheckNotes(plan.rationale);
  const rationale = [base, note].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const { rationale: _prev, ...rest } = plan;
  return { plan: { ...rest, ...(rationale ? { rationale } : {}) }, unpriced };
}

/**
 * HARD-CAP the plan (D-AH9), server-side, regardless of what the planner model returned or the autonomy
 * dial:
 *   • cap the agent count to `caps.maxAgents` (excess dropped — the widest fan-out is a hard cap);
 *   • PRESERVE the plan's topology (all four executors exist — WP2.2; an out-of-enum value → `parallel`);
 *   • pin autonomy to the session dial (the owner's setting wins over the planner's suggestion);
 *   • ensure agent `key`s are unique + stable (dedupe/re-key so the board can address each agent);
 *   • fill each agent's budgets from `perAgent` when unset, and the mission budgets (maxAgents/
 *     maxParallel/maxCostUsd) from the caps — clamping any planner value DOWN, never up;
 *   • cap `maxCostUsd` at `caps.maxBudgetUsd` — an ABSOLUTE ceiling (D-AH9: total cost is a hard cap),
 *     never just a default supplied when the plan names none;
 *   • when a `serverCatalog` is supplied (WP2.2, RC2.4): strip grants to unknown/unreachable servers +
 *     note half-configured roles, LOUDLY, via {@link clampGrantsToCatalog}. Absent ⇒ grants pass through
 *     unchanged (the pre-WP2.2 behavior; the propose-path catalog wiring in the orchestrator is WP2.3);
 *   • stamp the mission cost estimate.
 * Returns a NEW plan (never mutates the input). The result re-parses clean against the shared schema.
 */
export function clampPlanToBudgets(
  plan: HubMissionPlan,
  caps: HubMissionCaps,
  autonomy: HubAutonomyLevel,
  serverCatalog?: HubPlannerServerCatalog,
): HubMissionPlan {
  const perAgentDefault: HubBudgets | undefined = plan.budgets?.perAgent;

  const seenKeys = new Set<string>();
  const agents: HubPlannedAgent[] = plan.agents.slice(0, Math.max(1, caps.maxAgents)).map((agent, index) => {
    let key = (agent.key ?? "").trim() || `agent-${index + 1}`;
    while (seenKeys.has(key)) key = `${key}-${index + 1}`;
    seenKeys.add(key);
    const budgets = agent.budgets ?? perAgentDefault;
    return {
      ...agent,
      key,
      ...(budgets ? { budgets } : {}),
    };
  });

  const requestedCostUsd =
    plan.budgets?.maxCostUsd && plan.budgets.maxCostUsd > 0
      ? plan.budgets.maxCostUsd
      : caps.defaultBudgetUsd;

  const missionBudgets: HubMissionBudgets = {
    // The plan's own mission caps are clamped DOWN to the env hard caps (never up).
    maxAgents: Math.min(caps.maxAgents, plan.budgets?.maxAgents ?? caps.maxAgents),
    maxParallel: Math.min(caps.maxParallel, plan.budgets?.maxParallel ?? caps.maxParallel),
    // D-AH9 — total cost is a HARD cap: `maxBudgetUsd` is an ABSOLUTE ceiling, not just a fallback for
    // an unset value (that role is `defaultBudgetUsd`, above) — a plan/crew/edit naming an arbitrarily
    // large `maxCostUsd` is clamped down to it regardless.
    maxCostUsd: Math.min(requestedCostUsd, caps.maxBudgetUsd),
    ...(perAgentDefault ? { perAgent: perAgentDefault } : {}),
  };

  let clamped: HubMissionPlan = {
    topology: coerceTopology(plan.topology),
    autonomy,
    agents,
    ...(plan.rationale ? { rationale: plan.rationale } : {}),
    // hub-fixes WP4.4 (D-HF3) — carry a planner-proposed debate round count forward, clamped to 1..3 (a
    // value outside the range is coerced rather than rejected, and the re-parse below stays clean).
    ...(plan.debateRounds !== undefined ? { debateRounds: clampDebateRounds(plan.debateRounds) } : {}),
    budgets: missionBudgets,
  };
  // WP2.2 (RC2.4) — when the parent's reachable servers are known, strip grants to anything outside them
  // + surface half-configured roles, LOUDLY (into the rationale note the plan card renders).
  if (serverCatalog) {
    clamped = clampGrantsToCatalog(clamped, serverCatalog).plan;
  }
  clamped.estimatedCostUsd = estimatePlanCostUsd({ ...clamped, estimatedCostUsd: plan.estimatedCostUsd });
  // Re-validate: the clamp only ever narrows, but a defensive parse guarantees a wire-clean plan.
  return hubMissionPlanSchema.parse(clamped);
}

/**
 * Production planner (NOT gate-verified — no live provider): a `generateObject` structured-output call
 * over the shared `hubMissionPlanSchema`, so the tool's output shape and the wire contract can never
 * drift. The service re-clamps the result, so even a malformed/over-eager plan is bounded. `buildModel`
 * resolves the AI-SDK model for the planning model id (wired in index.ts over the provider store).
 */
export function createStructuredPlanner(deps: {
  /** model-identity WP4.2 — widened to take the credential that owns the model (D-MI1). Additive. */
  buildModel: (modelId: string, providerCredentialId?: string) => LanguageModel;
}): HubPlanner {
  return async ({ systemPrompt, userText, model, context, providerCredentialId }) => {
    const { object } = await generateObject({
      model: deps.buildModel(model, providerCredentialId),
      schema: hubMissionPlanSchema,
      system: systemPrompt,
      // v1-fixes (F7) — the ask stays verbatim first; the optional session context rides behind it in a
      // clearly-fenced read-only block (sharpens follow-up briefs, never redefines the task).
      prompt: context
        ? `${userText}\n\n<session_context>\nRead-only context from this session (previous mission digest + recent turns). Use it to sharpen agent briefs; the ask above remains the task.\n${context}\n</session_context>`
        : userText,
    });
    return object as HubMissionPlan;
  };
}

/**
 * assistant-hub v1-fixes (F7) — build the planner's compact, read-only session-context block: the LATEST
 * `mission_digest` (so a follow-up mission builds on what the previous agents actually found) plus the
 * last few conversation turns. Pure + hard-bounded; the CURRENT ask is excluded (it is the planner's
 * `userText` already, and prompt fidelity keeps it verbatim there).
 */
export function buildPlannerSessionContext(
  events: readonly HubEvent[],
  opts?: { currentAsk?: string; maxTurns?: number; maxChars?: number },
): string {
  const maxTurns = opts?.maxTurns ?? 6;
  const maxChars = opts?.maxChars ?? 2_400;
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const turns: string[] = [];
  let digest: string | undefined;
  for (const event of events) {
    if (event.type === "user_message" && event.text.trim()) {
      turns.push(`User: ${clip(event.text.trim(), 400)}`);
    } else if (event.type === "assistant_message") {
      const text = event.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim();
      if (text) turns.push(`Assistant: ${clip(text, 400)}`);
    } else if (event.type === "mission_digest") {
      digest = event.text; // latest wins — a session can have run several missions
    }
  }
  const ask = opts?.currentAsk?.trim();
  if (ask && turns.length > 0 && turns[turns.length - 1] === `User: ${clip(ask, 400)}`) turns.pop();
  const sections: string[] = [];
  if (digest) sections.push(clip(digest, 1_600));
  const recent = turns.slice(-maxTurns);
  if (recent.length > 0) sections.push(`Recent conversation:\n${recent.join("\n")}`);
  return clip(sections.join("\n\n"), maxChars);
}
