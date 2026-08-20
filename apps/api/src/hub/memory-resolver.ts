// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP1.5, D-HUX11) — the MEMORY INJECTION RESOLVER: given a
// session, compute its EFFECTIVE memory stack across the four scopes `profile` · `project` · `crew` ·
// `agent` (migration v49). Two halves, deliberately separated so the ordering/conflict logic is a PURE,
// exhaustively-testable function with no DB:
//
//   1. {@link resolveEffectiveMemory} — the pure core. Takes the per-scope layers, orders them by
//      injection order (least → most specific: profile → project → crew → agent), and applies the
//      D-HUX11 conflict rule **most-specific-wins**: when the SAME statement (normalized content) is
//      asserted at two scopes, the more-specific scope's entry survives and the less-specific one is
//      recorded as `overridden` (transparently shown, never silently dropped). Archived/proposed entries
//      are excluded here too (defensive — the builder already filters to `active`).
//
//   2. {@link buildSessionEffectiveMemory} — the repository-backed adapter the context inspector calls.
//      Resolves the session's real owning entities (profile always; project from `session.projectId`;
//      crew from `session.crewId`; agent = an `agent`-kind mission-child's role, resolved from its
//      mission plan by index), fetches each scope's active memory, resolves each owner's display name for
//      tagging/linking, then hands the layers to the pure core. A MISSING entity (a dangling
//      project/crew/agent id) simply SKIPS that layer — never a thrown context read.
//
// v1 conflict definition (D-HUX11's "most-specific-wins, transparently shown"): two entries conflict
// when their content is byte-equal after whitespace/case normalization. The wire carries no explicit
// conflict-key field (frozen — WP0.1), and "same statement at two scopes" is the honest, deterministic
// v1 rule; richer conflict-warning UX is an owner-gated follow-up (README, open questions). This module
// NEVER mutates memory — it is a pure read/projection over the repository.
//
// SCOPE NOTE — this resolver is the SOURCE OF TRUTH for what the scoped stack IS. It is surfaced on the
// per-session context payload (`effectiveMemory`, `context-inspector.ts`) AND — as of WP2.0b (closing
// the WP1.R-B review finding) — it is what the turn engine's ACTUAL prompt injection reads too:
// `turn-engine.ts`'s `runHubTurn` calls {@link buildSessionEffectiveMemory} directly and injects its
// `entries`, not a flat `listMemory({status:"active"})` read. So a `project`/`crew`/`agent`-scoped row
// injects ONLY into sessions whose own project/crew/agent it belongs to — never into an unrelated
// session — and the injected text is provably the SAME stack the context payload shows
// (display/injection parity; see `hub-turn-engine-memory-injection.test.ts`). A `profile`-only DB
// (every legacy/old session, or any session before scoped-memory creation ships in WP2.7) injects the
// same CONTENT SET as the pre-WP2.0b flat read; note the resolver's own `createdAt`-ascending survivor
// order (this module) can reorder same-kind bullets relative to the old `updated_at DESC` read — an
// intentional, documented reorder (turn-engine.ts's injection comment), not data loss.

import type {
  HubEffectiveMemory,
  HubEffectiveMemoryEntry,
  HubEffectiveMemoryLayerSummary,
  HubEffectiveMemoryOverride,
  HubMemory,
  HubMemoryScope,
  HubSession,
} from "@mcp-token-footprint/shared";
import type { HubRepository } from "./repository.js";

// WP2.7 (planning/Roadmap/completed/RM-04-assistant-hub-ux/) — `HubEffectiveMemory`/`HubEffectiveMemoryEntry`/
// `HubEffectiveMemoryOverride`/`HubEffectiveMemoryLayerSummary` are now PROMOTED to
// `@mcp-token-footprint/shared` (imported above) — this module used to declare them locally (WP1.5,
// when the shared wire was frozen for that WP). Re-exported here so every existing importer of THIS
// module (`context-inspector.ts`, `turn-engine.ts`, the hub test suite) keeps working unchanged.
export type {
  HubEffectiveMemory,
  HubEffectiveMemoryEntry,
  HubEffectiveMemoryLayerSummary,
  HubEffectiveMemoryOverride,
};

/** Injection order = specificity rank, least → most specific. A more-specific scope OVERRIDES a
 *  less-specific one on conflict (most-specific-wins). NOTE this is deliberately NOT `HUB_MEMORY_SCOPES`'
 *  declaration order (`profile,project,agent,crew`) — D-HUX11 injects crew BEFORE agent. */
export const HUB_MEMORY_SCOPE_ORDER = ["profile", "project", "crew", "agent"] as const satisfies readonly HubMemoryScope[];

function scopeRank(scope: HubMemoryScope): number {
  const idx = HUB_MEMORY_SCOPE_ORDER.indexOf(scope);
  return idx < 0 ? 0 : idx;
}

/** One scope's contribution to a session's effective memory. `entries` are that scope's rows (the
 *  builder passes only `active`; the core still filters defensively). `scopeId` is `null` for `profile`. */
export type HubEffectiveMemoryLayerInput = {
  scope: HubMemoryScope;
  scopeId: string | null;
  /** The owning project/crew/agent display name (for the UI's tag + deep link). Absent for `profile`. */
  ownerName?: string;
  entries: readonly HubMemory[];
};

/** The conflict key: same statement asserted at two scopes ⇒ they conflict. Normalize whitespace + case
 *  so "Use bullets." and "use  bullets." collapse to one. */
function conflictKey(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

type Tagged = HubEffectiveMemoryEntry & { rank: number };

/** Deterministic "who wins a conflict" ordering: BEST comes LAST. Higher specificity wins; a
 *  specificity tie (impossible across distinct scopes, possible for same-scope duplicate content) breaks
 *  to the newer `createdAt`, then the larger `id` — fully deterministic, never input-order dependent. */
function compareForWinner(a: Tagged, b: Tagged): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/** Injection order for the FINAL surviving/overridden lists: least-specific first, then stable by
 *  `createdAt` (oldest first) then `id` within a scope. */
function compareForInjection(a: Tagged, b: Tagged): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Pure core: resolve the effective memory stack from its per-scope layers. Order = profile → project →
 * crew → agent; conflict rule = most-specific-wins on normalized-content collisions. Archived/proposed
 * entries are excluded. See the module doc for the full contract.
 */
export function resolveEffectiveMemory(
  layers: readonly HubEffectiveMemoryLayerInput[],
): HubEffectiveMemory {
  const orderedLayers = [...layers].sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));

  const tagged: Tagged[] = [];
  for (const layer of orderedLayers) {
    for (const m of layer.entries) {
      if (m.status !== "active") continue; // archived/proposed never inject
      tagged.push({
        id: m.id,
        kind: m.kind,
        content: m.content,
        source: m.source,
        status: m.status,
        scope: layer.scope,
        scopeId: layer.scopeId,
        ...(layer.ownerName ? { ownerName: layer.ownerName } : {}),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        rank: scopeRank(layer.scope),
      });
    }
  }

  // Group by conflict key; the highest-specificity entry in each group survives, the rest are overridden.
  const groups = new Map<string, Tagged[]>();
  for (const entry of tagged) {
    const key = conflictKey(entry.content);
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  const winnerById = new Map<string, Tagged>();
  const overriddenPairs: Array<{ loser: Tagged; winner: Tagged }> = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareForWinner);
    const winner = ordered[ordered.length - 1]!;
    winnerById.set(winner.id, winner);
    for (const candidate of group) {
      if (candidate.id !== winner.id) overriddenPairs.push({ loser: candidate, winner });
    }
  }

  const survivors = [...winnerById.values()].sort(compareForInjection);
  const entries = survivors.map(stripRank);

  const overridden: HubEffectiveMemoryOverride[] = overriddenPairs
    .sort((a, b) => compareForInjection(a.loser, b.loser))
    .map(({ loser, winner }) => ({
      ...stripRank(loser),
      overriddenByScope: winner.scope,
      overriddenById: winner.id,
    }));

  const layerSummaries: HubEffectiveMemoryLayerSummary[] = orderedLayers.map((layer) => ({
    scope: layer.scope,
    scopeId: layer.scopeId,
    ...(layer.ownerName ? { ownerName: layer.ownerName } : {}),
    activeCount: entries.filter((e) => e.scope === layer.scope && e.scopeId === layer.scopeId).length,
    overriddenCount: overridden.filter(
      (e) => e.scope === layer.scope && e.scopeId === layer.scopeId,
    ).length,
  }));

  return {
    order: orderedLayers.map((l) => l.scope),
    entries,
    overridden,
    layers: layerSummaries,
    totalActive: entries.length,
  };
}

function stripRank(entry: Tagged): HubEffectiveMemoryEntry {
  const { rank: _rank, ...rest } = entry;
  return rest;
}

/** An `agent`-kind (mission-child) session's role id, resolved from its mission plan BY INDEX
 *  (`agentSessionIds[i]` ↔ `plan.agents[i]`). A top-level chat/research/mission session, an ad-hoc
 *  planned agent with no library `roleId`, or any unresolvable mission ⇒ `undefined` (no agent layer).
 *  Read-only — never touches the mission orchestrator. */
export function resolveSessionAgentRoleId(
  repository: HubRepository,
  session: HubSession,
): string | undefined {
  if (session.kind !== "agent" || !session.missionId) return undefined;
  try {
    const mission = repository.getMission(session.missionId);
    const index = mission.agentSessionIds.indexOf(session.id);
    if (index < 0) return undefined;
    return mission.plan.agents[index]?.roleId ?? undefined;
  } catch {
    return undefined;
  }
}

/** Wrap a repository name lookup so a MISSING owning entity (dangling id) yields `undefined` — the layer
 *  is then skipped rather than throwing the whole context read. */
function tryOwnerName(get: () => string): string | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

/**
 * Repository-backed adapter: build a session's effective memory from its real owning entities. Profile is
 * always present; project/crew/agent layers are added only when the session HAS that entity AND the
 * entity still exists (a dangling id is skipped). Delegates the ordering/conflict logic to
 * {@link resolveEffectiveMemory}.
 */
export function buildSessionEffectiveMemory(
  repository: HubRepository,
  sessionId: string,
): HubEffectiveMemory {
  const session = repository.getSession(sessionId); // 404s if the session is unknown (repo contract)
  const layers: HubEffectiveMemoryLayerInput[] = [
    {
      scope: "profile",
      scopeId: null,
      entries: repository.listMemory({ status: "active", scope: "profile" }),
    },
  ];

  if (session.projectId) {
    const projectId = session.projectId;
    const ownerName = tryOwnerName(() => repository.getProject(projectId).name);
    if (ownerName !== undefined) {
      layers.push({
        scope: "project",
        scopeId: projectId,
        ownerName,
        entries: repository.listMemory({ status: "active", scope: "project", scopeId: projectId }),
      });
    }
  }

  if (session.crewId) {
    const crewId = session.crewId;
    const ownerName = tryOwnerName(() => repository.getCrew(crewId).name);
    if (ownerName !== undefined) {
      layers.push({
        scope: "crew",
        scopeId: crewId,
        ownerName,
        entries: repository.listMemory({ status: "active", scope: "crew", scopeId: crewId }),
      });
    }
  }

  const agentRoleId = resolveSessionAgentRoleId(repository, session);
  if (agentRoleId) {
    const ownerName = tryOwnerName(() => repository.getAgentRole(agentRoleId).name);
    if (ownerName !== undefined) {
      layers.push({
        scope: "agent",
        scopeId: agentRoleId,
        ownerName,
        entries: repository.listMemory({ status: "active", scope: "agent", scopeId: agentRoleId }),
      });
    }
  }

  return resolveEffectiveMemory(layers);
}
