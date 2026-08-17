// Assistant Hub (WP0.5, §1.6, R-MCP1) — tool-grant resolution. `HubToolGrants` (WP0.1) is the wire
// shape: `{ servers: Record<serverId, "all" | toolName[]>, builtins: string[] }`. A server ABSENT
// from `servers` — or a tool absent from its allowlist — grants none of it: the resolved catalog
// simply never contains it, so an ungranted tool is absent from model context ENTIRELY, never merely
// blocked at call time (R-MCP1's exact wording). Same ABSENT-means-NONE rule for `builtins`.
import type { HubAgentRole, HubServerToolGrant, HubToolGrants } from "@mcp-token-footprint/shared";
import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";
import { ALL_BUILTINS } from "./builtins/index.js";
import type { HubMcpCatalogEntry } from "./mcp-bridge.js";
import type { HubBuiltinTool } from "./types.js";

/** The full tool catalog one MCP server exposes (from its latest scan — the caller supplies this;
 *  this module has no scan/DB access of its own). */
export type HubMcpServerCatalog = { serverName?: string; tools: NormalizedToolDefinition[] };

/**
 * Filter a session/role's granted MCP servers down to the actually-callable tool catalog. A server id
 * in `grants.servers` that isn't in `catalogByServer` (e.g. deleted, or never scanned) silently yields
 * no entries for that server — never an error at resolution time; the model simply never sees it.
 */
export function resolveMcpGrants(
  grants: HubToolGrants,
  catalogByServer: ReadonlyMap<string, HubMcpServerCatalog>,
): HubMcpCatalogEntry[] {
  const entries: HubMcpCatalogEntry[] = [];
  for (const [serverId, grant] of Object.entries(grants.servers)) {
    const server = catalogByServer.get(serverId);
    if (!server) continue;
    const allowedNames = grant === "all" ? null : new Set(grant);
    for (const def of server.tools) {
      if (allowedNames && !allowedNames.has(def.name)) continue;
      entries.push({ serverId, serverName: server.serverName, def });
    }
  }
  return entries;
}

/**
 * Filter the built-in catalog down to the ones `grants.builtins` names. `available` defaults to the
 * full {@link ALL_BUILTINS} catalog; a caller building a restricted role (e.g. a critic that shouldn't
 * get `artifacts.create`) passes a narrower `grants.builtins` list — see `builtins/index.ts`'s
 * `DEFAULT_CHAT_BUILTIN_NAMES` for the "grant every standard built-in" convenience default.
 */
export function resolveBuiltinGrants(
  grants: HubToolGrants,
  available: readonly HubBuiltinTool[] = ALL_BUILTINS,
): HubBuiltinTool[] {
  const allowed = new Set(grants.builtins);
  return available.filter((tool) => allowed.has(tool.name));
}

/**
 * hub-fixes WP2.3 (D-HF5) — the ONE documented rule for what a mission agent may actually touch:
 * EFFECTIVE child grants = the plan's per-agent grants ∩ the parent session's own scope. A `null`
 * parent (the session's "auto"/unscoped default — every reachable server) passes the plan's grants
 * through UNCHANGED: there is nothing to bound them against. A SCOPED parent bounds every server + the
 * built-ins list:
 *   • a server present in `planGrants` but ABSENT from `parentScope.servers` is DROPPED entirely (never
 *     even an empty allowlist — the same absent-means-none rule this module's header documents, R-MCP1);
 *   • `"all" ∩ "all" = "all"`; `"all" ∩ list = list`; `list ∩ "all" = list`; `list ∩ list` = the SET
 *     INTERSECTION of tool names (only a tool name present in BOTH survives);
 *   • `builtins` intersect the SAME way, EXCEPT an EMPTY parent `builtins` list means "the parent scope
 *     didn't restrict built-ins" (the app-wide convention an explicit empty list is never "grant zero" —
 *     see `index.ts`'s `resolveHubMcpGrants`, RC3.5) — so the plan's own builtins pass through unchanged.
 * Pure; never mutates either input. Applied by the mission orchestrator at child `createSession` (the
 * WP2.1 spawn seam) so a scoped parent session can never have an agent escalate beyond it via a crew
 * role's own Access tab.
 *
 * Crew nesting (WP2.3 / D-CN9) — this composes TRANSITIVELY down a nested crew tree, because the
 * drop-if-absent + set-intersection above is ASSOCIATIVE:
 *   effectiveAgentGrants(L2, effectiveAgentGrants(L1, L0)) === effectiveAgentGrants(L2, L1 ∩ L0) === L2 ∩ L1 ∩ L0.
 * So a level-N agent's effective grants are the intersection of EVERY ancestor's grants down the path — a
 * nested plan can only ever NARROW, never re-widen (the R6 escalation). The transitivity holds ONLY if the
 * enclosing crew-ref slot's ALREADY-effective grants (`L1 ∩ L0 …`) are threaded as the nested `parentScope`.
 * The hazard (D-CN6): every sub-mission keeps `session_id` = the ROOT chat session, so re-deriving the nested
 * `parentScope` from `getSession(subMission.sessionId).toolScope` would read L0 and RE-WIDEN a narrowed nested
 * spawn back to level-0. The orchestrator therefore threads an INJECTED `parentScope` at each level
 * (`runMissionLevel`), never re-reading the session below the root — see `orchestrator.subCrewParentScope`.
 */
export function effectiveAgentGrants(planGrants: HubToolGrants, parentScope: HubToolGrants | null): HubToolGrants {
  if (parentScope === null) return planGrants;

  const servers: Record<string, HubServerToolGrant> = {};
  for (const [serverId, planGrant] of Object.entries(planGrants.servers)) {
    const parentGrant = parentScope.servers[serverId];
    if (parentGrant === undefined) continue; // outside the parent's scope — dropped entirely
    servers[serverId] = intersectServerGrant(planGrant, parentGrant);
  }

  const parentBuiltins = parentScope.builtins;
  const builtins =
    parentBuiltins.length === 0
      ? planGrants.builtins // absent-parent-builtins ⇒ the plan's own choice passes through
      : planGrants.builtins.filter((name) => parentBuiltins.includes(name));

  return { servers, builtins };
}

/** One server's grant ∩ the parent's grant for that SAME server (both already confirmed present). */
function intersectServerGrant(planGrant: HubServerToolGrant, parentGrant: HubServerToolGrant): HubServerToolGrant {
  if (planGrant === "all" && parentGrant === "all") return "all";
  if (planGrant === "all") return parentGrant; // bounded by the parent's own (narrower) allowlist
  if (parentGrant === "all") return planGrant; // the plan's own (narrower) allowlist stands as-is
  const parentSet = new Set(parentGrant);
  return planGrant.filter((name) => parentSet.has(name));
}

/** One server's grant ∪ another grant for that SAME server. The dual of {@link intersectServerGrant}:
 *  `"all"` on EITHER side wins; otherwise the SET UNION of tool names (a tool granted by either survives). */
export function unionServerGrant(a: HubServerToolGrant, b: HubServerToolGrant): HubServerToolGrant {
  if (a === "all" || b === "all") return "all";
  return [...new Set([...a, ...b])];
}

/**
 * hub-fixes (Defect 1a) — UNION the server grants of a mission session's ROSTER (its scoped-in saved
 * roles + crew member roles) INTO the session's own tool scope, so a server a reused server-bound role
 * needs is REACHABLE from the session. Every reachability read — the planner's grantable-server catalog,
 * the plan-grant clamp ({@link resolveMcpGrants}'s catalog source), and the child-spawn intersection
 * ({@link effectiveAgentGrants}) — reads `session.toolScope`; without this union, scoping a Acme-connected
 * role into a mission whose session had no server attached silently stripped the role's server at plan
 * time and the agent ran tool-less. A `null` scope (the "auto"/unscoped default — already every reachable
 * server) is returned UNCHANGED (nothing to widen). Built-ins are untouched. Pure; never mutates inputs;
 * returns the SAME reference when nothing was added, a NEW object when a server was unioned in.
 */
export function unionRosterServerGrantsIntoScope(
  scope: HubToolGrants,
  rosterRoles: readonly HubAgentRole[],
): HubToolGrants {
  const servers: Record<string, HubServerToolGrant> = { ...scope.servers };
  let changed = false;
  for (const role of rosterRoles) {
    for (const [serverId, grant] of Object.entries(role.toolGrants.servers)) {
      const existing = servers[serverId];
      const next = existing === undefined ? grant : unionServerGrant(existing, grant);
      if (next !== existing) {
        servers[serverId] = next;
        changed = true;
      }
    }
  }
  return changed ? { servers, builtins: scope.builtins } : scope;
}
