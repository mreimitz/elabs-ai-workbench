// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.1, R-UX6/R-UX8) — `GET /api/hub/usage` aggregates. Pure
// rollups over `HubRepository.listSessions()`/`listMissions()` (the running per-session/per-mission
// totals the turn engine + mission orchestrator already accumulate as they go — never re-derived from
// replaying the event log). Kept as a standalone module (not inlined in `hub/routes.ts`, which the
// route handler itself stays a thin call into) so the aggregation logic is unit-testable without
// spinning up Fastify.

import type {
  HubMission,
  HubPlanAcceptanceMetric,
  HubSession,
  HubUsageAggregates,
  HubUsageBucket,
  HubUsageGroupBy,
  HubUsageMissionSummary,
  HubUsageProviderCredentialBucket,
  HubUsageRow,
  HubUsageSummary,
  ProviderCredential,
  ProviderKind,
} from "@mcp-token-footprint/shared";
import { providerKindBilling, providerKindLabel } from "@mcp-token-footprint/shared";
import type { HubRepository } from "./repository.js";

export type HubUsageQuery = { from?: string; to?: string; projectId?: string };

// --- Provider attribution (model-identity WP3.3, D-MI10) -------------------------------------------
//
// How ONE session's spend is attributed to a provider. This used to be a `(modelId: string) =>
// string | undefined` callback that both call sites satisfied with `hub/routes.ts`'s
// `inferHubModelKind`, plus a local `Record<string, string>` label map here. Two defects fell out of
// that, and only widening the input fixes them:
//
//   1. `inferHubModelKind` returns `HubAiSdkModelKind | undefined` — a union that STRUCTURALLY excludes
//      `claude_subscription`. Subscription spend could therefore only ever bucket as "Anthropic", in
//      the one report an operator would open to catch exactly that mis-billing. Swapping the label map
//      alone would have LOOKED fixed while leaving the key domain (and so the bug) untouched.
//   2. A model id says nothing about WHICH credential ran the turn, so two keys of the same kind were
//      indistinguishable — and "which key is being billed" is the question that surfaced this bug.
//
// The resolver now takes the SESSION, so it can read the persisted `provider_credential_id`
// (migration v55, D-MI1/D-MI2) — the credential that actually ran the turn. The model-name heuristic
// serves NULL rows ONLY (a pre-v55 session, or one whose credential was deleted — `ON DELETE SET
// NULL`), and those rows are flagged `unpinned` rather than silently blended with measured ones.

/** The provider attribution for one session. `undefined` from a resolver ⇒ nothing could be resolved
 *  at all (⇒ the "Other" bucket) — the same meaning the old callback's `undefined` carried. */
export type HubUsageProviderAttribution = {
  /** The provider kind that billed the turn. */
  kind?: ProviderKind;
  /** The credential the session is PINNED to. Absent/`null` ⇒ `kind` came from the name heuristic. */
  credentialId?: string | null;
  /** That credential's operator-facing label (`ProviderCredential.label` — never a secret). */
  credentialLabel?: string;
};

export type HubUsageProviderResolver = (
  session: HubSession,
) => HubUsageProviderAttribution | undefined;

/** The slice of `ProviderRepository` the resolver needs — structural, so `usage.ts` stays unit-testable
 *  without a database (and cannot reach a decrypted secret: `list()` returns REDACTED credentials). */
export type HubUsageCredentialLookup = { list: () => readonly ProviderCredential[] };

/**
 * The production {@link HubUsageProviderResolver}: persisted credential first, model-name heuristic
 * only for a NULL column.
 *
 * A pinned id that resolves to no row degrades to the heuristic and reports as UNPINNED — the same
 * "set-but-unresolvable ⇒ legacy path" semantic D-MI1 gives the turn resolver, so a deleted credential
 * never invents a phantom bucket. `list()` is read once, lazily, and memoized for the request.
 */
export function createHubUsageProviderResolver(
  credentials: HubUsageCredentialLookup,
  inferKindFromModelId: (modelId: string) => ProviderKind | undefined,
): HubUsageProviderResolver {
  let byId: Map<string, ProviderCredential> | undefined;
  const lookup = (id: string): ProviderCredential | undefined => {
    if (!byId) byId = new Map(credentials.list().map((credential) => [credential.id, credential]));
    return byId.get(id);
  };
  return (session) => {
    const pinnedId = session.providerCredentialId ?? null;
    if (pinnedId) {
      const credential = lookup(pinnedId);
      if (credential) {
        return {
          kind: credential.kind,
          credentialId: credential.id,
          credentialLabel: credential.label,
        };
      }
      // Fall through to the heuristic — never fabricate a credential bucket for an id that is gone.
    }
    const kind = inferKindFromModelId(session.model);
    return kind ? { kind } : undefined;
  };
}

/** The `byProvider` (kind roll-up) key/label for one attribution — always via the D-MI6 registry, which
 *  is exhaustive over `ProviderKind` and therefore CAN express `claude_subscription` ("Anthropic CLI"). */
function providerKindBucket(attribution: HubUsageProviderAttribution | undefined): {
  key: string;
  label: string;
} {
  const kind = attribution?.kind;
  return kind ? { key: kind, label: providerKindLabel(kind) } : { key: "other", label: "Other" };
}

/** The per-credential bucket key. A pinned bucket keys on the credential id; an unpinned one keys on
 *  its heuristic kind, namespaced so it can never collide with a credential nanoid. */
function providerCredentialBucketKey(attribution: HubUsageProviderAttribution | undefined): string {
  const credentialId = attribution?.credentialId ?? null;
  return credentialId ? `credential:${credentialId}` : `unpinned:${attribution?.kind ?? "other"}`;
}

/** The per-credential bucket LABEL: the operator's own name for the key when pinned (that is the thing
 *  being billed), or an explicitly-marked "not pinned" bucket when the attribution is a guess. */
function providerCredentialBucketLabel(
  attribution: HubUsageProviderAttribution | undefined,
): string {
  const kindLabel = attribution?.kind ? providerKindLabel(attribution.kind) : "Other";
  if (attribution?.credentialId) return attribution.credentialLabel?.trim() || kindLabel;
  return `${kindLabel} (not pinned)`;
}

const MODE_LABELS: Record<HubSession["mode"], string> = {
  auto: "Auto",
  chat: "Chat",
  research: "Research",
  mission: "Mission",
};

export function buildHubUsageAggregates(
  repository: HubRepository,
  query: HubUsageQuery,
  /** model-identity WP3.3 (D-MI10) — widened from `(modelId: string)` to take the SESSION, so it can
   *  read the persisted `provider_credential_id`. See {@link createHubUsageProviderResolver}. */
  resolveProvider: HubUsageProviderResolver,
): HubUsageAggregates {
  // WP1.6 fix (worktask 1 — "make projectId actually filter"): a naive SQL `WHERE project_id = X`
  // silently drops every mission-agent child's spend from a project-filtered view — an agent child's
  // OWN `project_id` column is never set at spawn time (missions/orchestrator.ts's `createSession`
  // call), even though its real spend belongs to whatever project its parent mission ran under. Fetch
  // every session unfiltered, then match `projectId` against the EFFECTIVE project (the session's own,
  // or — for an `agent`-kind child — its parent's).
  const allSessions = repository.listSessions();
  const sessionById = new Map(allSessions.map((s) => [s.id, s]));
  const effectiveProjectId = (s: HubSession): string | null | undefined =>
    s.kind === "agent" ? (sessionById.get(s.parentSessionId ?? "")?.projectId ?? null) : s.projectId;
  const inRange = (iso: string) => (!query.from || iso >= query.from) && (!query.to || iso <= query.to);
  const matchesProject = (s: HubSession) => !query.projectId || effectiveProjectId(s) === query.projectId;
  const sessions = allSessions.filter((s) => inRange(s.createdAt) && matchesProject(s));

  const totals = sessions.reduce(
    (acc, s) => ({
      sessions: acc.sessions + 1,
      costUsd: acc.costUsd + s.costUsd,
      tokensIn: acc.tokensIn + s.tokensIn,
      tokensOut: acc.tokensOut + s.tokensOut,
    }),
    { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
  );

  // byModel/byProvider/byProviderCredential: EVERY session (top-level + mission-agent children) — an
  // agent's spend is real spend, even on a model its parent session never itself runs.
  const byModel = sortByCostDesc(
    bucketSessions(sessions, (s) => s.model, (s) => s.model),
  );
  // Resolved ONCE per session (the resolver may hit the credential store) and reused by both provider
  // rollups, so the kind bucket and the credential bucket can never disagree about the same session.
  const attributions = new Map<string, HubUsageProviderAttribution | undefined>();
  const attributionFor = (s: HubSession): HubUsageProviderAttribution | undefined => {
    if (!attributions.has(s.id)) attributions.set(s.id, resolveProvider(s));
    return attributions.get(s.id);
  };
  const byProvider = sortByCostDesc(
    bucketSessions(
      sessions,
      (s) => providerKindBucket(attributionFor(s)).key,
      (s) => providerKindBucket(attributionFor(s)).label,
    ),
  );
  const byProviderCredential = bucketProviderCredentials(sessions, attributionFor);

  // byMode/byDay: top-level (`kind:"chat"`) sessions only — an agent child's `mode` column is always
  // `"chat"` regardless of its actual role (see the wire type's own doc), so folding it in here would
  // mislabel a mission agent's spend as ordinary chat use.
  const topLevel = sessions.filter((s) => s.kind === "chat");
  const byMode = sortByCostDesc(
    bucketSessions(topLevel, (s) => s.mode, (s) => MODE_LABELS[s.mode] ?? s.mode),
  );
  const byDay = bucketSessions(
    topLevel,
    (s) => s.createdAt.slice(0, 10),
    (s) => s.createdAt.slice(0, 10),
  ).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Missions + the R-UX6 plan-acceptance signal (sessionById built above, reused here).
  const missions: HubUsageMissionSummary[] = [];
  let approvedMissions = 0;
  let uneditedApprovals = 0;
  for (const mission of repository.listMissions()) {
    if (!inRange(mission.createdAt)) continue;
    const parentSession = sessionById.get(mission.sessionId);
    if (query.projectId && parentSession?.projectId !== query.projectId) continue;

    const approved = mission.status !== "proposed"; // reached at least the approve step
    let approvedUnedited: boolean | undefined;
    if (approved) {
      approvedMissions += 1;
      const edited = repository
        .listEvents(mission.sessionId)
        .some((e) => e.type === "plan_updated" && e.missionId === mission.id);
      approvedUnedited = !edited;
      if (approvedUnedited) uneditedApprovals += 1;
    }

    missions.push({
      missionId: mission.id,
      sessionId: mission.sessionId,
      sessionTitle: parentSession?.title ?? "(deleted session)",
      topology: mission.topology,
      status: mission.status,
      agentCount: mission.agentSessionIds.length,
      costUsd: mission.costUsd ?? 0,
      createdAt: mission.createdAt,
      startedAt: mission.startedAt ?? null,
      endedAt: mission.endedAt ?? null,
      ...(approvedUnedited !== undefined ? { approvedUnedited } : {}),
    });
  }
  missions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const planAcceptance: HubPlanAcceptanceMetric = {
    approvedMissions,
    uneditedApprovals,
    uneditedPercent:
      approvedMissions > 0 ? Math.round((uneditedApprovals / approvedMissions) * 1000) / 10 : 0,
  };

  return {
    range: {
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    },
    totals,
    byModel,
    byProvider,
    byProviderCredential,
    byMode,
    byDay,
    missions,
    planAcceptance,
  };
}

function bucketSessions(
  sessions: readonly HubSession[],
  keyFor: (s: HubSession) => string,
  labelFor: (s: HubSession) => string,
): HubUsageBucket[] {
  const buckets = new Map<string, HubUsageBucket>();
  for (const s of sessions) {
    const key = keyFor(s);
    const existing = buckets.get(key);
    if (existing) {
      existing.sessions += 1;
      existing.costUsd += s.costUsd;
      existing.tokensIn += s.tokensIn;
      existing.tokensOut += s.tokensOut;
    } else {
      buckets.set(key, {
        key,
        label: labelFor(s),
        sessions: 1,
        costUsd: s.costUsd,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
      });
    }
  }
  return Array.from(buckets.values());
}

function sortByCostDesc(buckets: HubUsageBucket[]): HubUsageBucket[] {
  return buckets.sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * model-identity WP3.3 (D-MI10) — the PER-CREDENTIAL provider rollup. Deliberately its own loop rather
 * than a `bucketSessions` call: each bucket carries the credential identity (`providerKind`/
 * `credentialId`/`billing`/`unpinned`) that makes it answer "which key is being billed", which the
 * generic key/label bucketer has nowhere to put. Every session lands in exactly one bucket, so
 * `sum(byProviderCredential[].costUsd) === totals.costUsd` holds by construction — and each bucket
 * rolls up into exactly one `byProvider` kind bucket (both read the SAME memoized attribution).
 */
function bucketProviderCredentials(
  sessions: readonly HubSession[],
  attributionFor: (s: HubSession) => HubUsageProviderAttribution | undefined,
): HubUsageProviderCredentialBucket[] {
  const buckets = new Map<string, HubUsageProviderCredentialBucket>();
  for (const s of sessions) {
    const attribution = attributionFor(s);
    const key = providerCredentialBucketKey(attribution);
    const existing = buckets.get(key);
    if (existing) {
      existing.sessions += 1;
      existing.costUsd += s.costUsd;
      existing.tokensIn += s.tokensIn;
      existing.tokensOut += s.tokensOut;
      continue;
    }
    const kind = attribution?.kind ?? null;
    const credentialId = attribution?.credentialId ?? null;
    buckets.set(key, {
      key,
      label: providerCredentialBucketLabel(attribution),
      providerKind: kind,
      credentialId,
      billing: kind ? providerKindBilling(kind) : null,
      unpinned: credentialId === null,
      sessions: 1,
      costUsd: s.costUsd,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
    });
  }
  return Array.from(buckets.values()).sort((a, b) => b.costUsd - a.costUsd);
}

// --- Workforce Usage tab (WP1.6, D-HUX10) — group-by rollups + per-entity summaries ----------------
//
// `GET /api/hub/usage/rollup` groups EVERY session (top-level + mission-agent children) under one
// {@link HubUsageGroupBy} dimension; `GET /api/hub/usage/summary` gives one entity (an agent/crew/
// project/model/mode value) its rolling totals + a zero-filled daily strip. Both share the same
// ATTRIBUTION logic below, which is the crux of D-HUX10's "never a silently short total": a mission-
// agent child (`kind:"agent"`) carries none of `mode`/`crewId`/`projectId` on its own row (`mode` is
// forced to `"chat"`, `crewId`/`projectId` are simply never copied at spawn time — see
// `missions/orchestrator.ts`'s `createSession` call), even though its REAL spend belongs to whatever
// mode/crew/project its parent mission ran under. Resolving the EFFECTIVE value from the parent (one
// hop — hub sessions are never nested more than chat/research/mission -> agent) keeps that spend
// attributed instead of it silently falling into "unattributed" for a merely mechanical reason. `agent`
// attribution is different in kind: it identifies which LIBRARY role (if any) a session ran AS, via the
// mission's plan (`agentSessionIds[i]` <-> `plan.agents[i].roleId`, positional by construction — see the
// orchestrator's own `spawned = plan.agents.map(...)`) — a top-level session was never "run as" a role,
// and an ad-hoc planned agent (no `roleId`) isn't a library entity either, so both land in the explicit
// "No agent" bucket, same as an agent/crew/project session that resolves to nothing.

const UNATTRIBUTED_LABELS: Partial<Record<HubUsageGroupBy, string>> = {
  agent: "No agent",
  crew: "No crew",
  project: "No project",
};

type HubUsageAttributionContext = {
  effectiveMode: (s: HubSession) => HubSession["mode"];
  effectiveCrewId: (s: HubSession) => string | undefined;
  effectiveProjectId: (s: HubSession) => string | undefined;
  ownerRoleId: (s: HubSession) => string | undefined;
};

/** `agentSessionId -> roleId` for every mission-agent child, positional per `HubMission.agentSessionIds`
 *  <-> `plan.agents` (see the file-level note). `undefined` for an ad-hoc planned agent (no `roleId`). */
function buildAgentSessionRoleMap(missions: readonly HubMission[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const mission of missions) {
    mission.agentSessionIds.forEach((sessionId, index) => {
      map.set(sessionId, mission.plan.agents[index]?.roleId);
    });
  }
  return map;
}

function buildAttributionContext(
  repository: HubRepository,
  sessions: readonly HubSession[],
): HubUsageAttributionContext {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const parentOf = (s: HubSession): HubSession | undefined =>
    s.kind === "agent" && s.parentSessionId ? byId.get(s.parentSessionId) : undefined;
  const roleBySessionId = buildAgentSessionRoleMap(repository.listMissions());
  return {
    effectiveMode: (s) => (s.kind === "agent" ? (parentOf(s)?.mode ?? s.mode) : s.mode),
    effectiveCrewId: (s) =>
      (s.kind === "agent" ? parentOf(s)?.crewId : s.crewId) ?? undefined,
    effectiveProjectId: (s) =>
      (s.kind === "agent" ? parentOf(s)?.projectId : s.projectId) ?? undefined,
    ownerRoleId: (s) => (s.kind === "agent" ? roleBySessionId.get(s.id) : undefined),
  };
}

/** Resolves the grouping KEY for one session under `groupBy`; `undefined` ⇒ the explicit unattributed
 *  bucket (only possible for `agent`/`crew`/`project` — `model`/`mode` always resolve). */
function keyResolverFor(
  groupBy: HubUsageGroupBy,
  ctx: HubUsageAttributionContext,
): (s: HubSession) => string | undefined {
  switch (groupBy) {
    case "agent":
      return ctx.ownerRoleId;
    case "crew":
      return ctx.effectiveCrewId;
    case "project":
      return ctx.effectiveProjectId;
    case "model":
      return (s) => s.model;
    case "mode":
      return ctx.effectiveMode;
    default: {
      const exhaustive: never = groupBy;
      throw new Error(`Unhandled HubUsageGroupBy: ${String(exhaustive)}`);
    }
  }
}

/** Resolves a KEY (already a non-null grouping value) to its display label. Looks up the real entity
 *  where one exists (agent role / crew / project) but never throws on a stale reference — a session may
 *  point at a role/crew/project that was since deleted; it still reconciles into the total, just with a
 *  "(deleted …)" label rather than a 404 that would break the whole rollup. */
function labelResolverFor(repository: HubRepository, groupBy: HubUsageGroupBy): (key: string) => string {
  switch (groupBy) {
    case "agent": {
      const byId = new Map(repository.listAgentRoles({ includeArchived: true }).map((r) => [r.id, r]));
      return (key) => {
        const role = byId.get(key);
        return role ? (role.displayName ?? role.name) : "(deleted agent)";
      };
    }
    case "crew": {
      const byId = new Map(repository.listCrews().map((c) => [c.id, c]));
      return (key) => byId.get(key)?.name ?? "(deleted crew)";
    }
    case "project": {
      const byId = new Map(repository.listProjects({ includeArchived: true }).map((p) => [p.id, p]));
      return (key) => byId.get(key)?.name ?? "(deleted project)";
    }
    case "model":
      return (key) => key;
    case "mode":
      return (key) => (MODE_LABELS as Record<string, string>)[key] ?? key;
    default: {
      const exhaustive: never = groupBy;
      throw new Error(`Unhandled HubUsageGroupBy: ${String(exhaustive)}`);
    }
  }
}

/** `GET /api/hub/usage/rollup` (D-HUX10): one row per `groupBy` entity, `from`/`to`/`projectId`
 *  filtered EXACTLY like `buildHubUsageAggregates` (including the same effective-projectId fix), plus —
 *  for `agent`/`crew`/`project` — an explicit `key:null, unattributed:true` row so the rollup's own
 *  total is never silently short. `sum(rows[].{sessions,costUsd,tokensIn,tokensOut}) === totals` derived
 *  from the SAME filtered session set always holds by construction (every session lands in exactly one
 *  row) — see `hub-usage-rollup.test.ts` for the invariant proof across all five dimensions. */
export function buildHubUsageRollup(
  repository: HubRepository,
  groupBy: HubUsageGroupBy,
  query: HubUsageQuery,
): HubUsageRow[] {
  const allSessions = repository.listSessions();
  const ctx = buildAttributionContext(repository, allSessions);
  const inRange = (iso: string) => (!query.from || iso >= query.from) && (!query.to || iso <= query.to);
  const matchesProject = (s: HubSession) => !query.projectId || ctx.effectiveProjectId(s) === query.projectId;
  const sessions = allSessions.filter((s) => inRange(s.createdAt) && matchesProject(s));

  const keyFor = keyResolverFor(groupBy, ctx);
  const labelFor = labelResolverFor(repository, groupBy);

  const buckets = new Map<string, HubUsageRow>();
  let unattributed: HubUsageRow | undefined;
  for (const s of sessions) {
    const key = keyFor(s);
    if (key === undefined) {
      if (!unattributed) {
        unattributed = {
          groupBy,
          key: null,
          label: UNATTRIBUTED_LABELS[groupBy] ?? "Unattributed",
          unattributed: true,
          sessions: 0,
          costUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
        };
      }
      unattributed.sessions += 1;
      unattributed.costUsd += s.costUsd;
      unattributed.tokensIn += s.tokensIn;
      unattributed.tokensOut += s.tokensOut;
      continue;
    }
    const existing = buckets.get(key);
    if (existing) {
      existing.sessions += 1;
      existing.costUsd += s.costUsd;
      existing.tokensIn += s.tokensIn;
      existing.tokensOut += s.tokensOut;
    } else {
      buckets.set(key, {
        groupBy,
        key,
        label: labelFor(key),
        sessions: 1,
        costUsd: s.costUsd,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
      });
    }
  }

  const rows = Array.from(buckets.values());
  if (unattributed) rows.push(unattributed);
  return rows.sort((a, b) => b.costUsd - a.costUsd);
}

const DEFAULT_USAGE_SUMMARY_STRIP_DAYS = 30;

/** `days` consecutive `YYYY-MM-DD` dates ending on `end` (inclusive), oldest → newest — the zero-filled
 *  daily strip's x-axis, so the sparkline is evenly spaced even on a day with no sessions at all. */
function dailyStripDates(days: number, end: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** `GET /api/hub/usage/summary` (D-HUX10): one entity's rolling totals + a zero-filled daily strip over
 *  the trailing `days` window (default 30 — the workforce card sparkline's window; the profile Usage
 *  sub-page may request a wider one). `totals` is the reduction over the EXACT SAME filtered session set
 *  `strip` buckets by day, so `sum(strip[].{sessions,costUsd,tokensIn,tokensOut}) === totals` holds by
 *  construction — see `hub-usage-summary.test.ts`. Throws (404, via the repository's own `getX`) for an
 *  unknown `agent`/`crew`/`project` id; `model`/`mode` have no backing entity to 404 on — an id with zero
 *  matching sessions just returns an all-zero summary. */
export function buildHubUsageSummary(
  repository: HubRepository,
  groupBy: HubUsageGroupBy,
  id: string,
  options: { days?: number } = {},
): HubUsageSummary {
  const days = Math.max(1, options.days ?? DEFAULT_USAGE_SUMMARY_STRIP_DAYS);
  const label = resolveEntityLabel(repository, groupBy, id);

  const allSessions = repository.listSessions();
  const ctx = buildAttributionContext(repository, allSessions);
  const belongsToEntity = keyMatcherFor(groupBy, id, ctx);

  const dates = dailyStripDates(days);
  const windowStart = dates[0] ?? "";
  const inWindow = (iso: string) => iso.slice(0, 10) >= windowStart;

  const matching = allSessions.filter((s) => belongsToEntity(s) && inWindow(s.createdAt));

  const totals = matching.reduce(
    (acc, s) => ({
      sessions: acc.sessions + 1,
      costUsd: acc.costUsd + s.costUsd,
      tokensIn: acc.tokensIn + s.tokensIn,
      tokensOut: acc.tokensOut + s.tokensOut,
    }),
    { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
  );

  const byDate = new Map<string, HubUsageBucket>(
    dates.map((date) => [date, { key: date, label: date, sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 }]),
  );
  for (const s of matching) {
    const bucket = byDate.get(s.createdAt.slice(0, 10));
    if (!bucket) continue; // in-window by construction; guard kept for defensiveness only
    bucket.sessions += 1;
    bucket.costUsd += s.costUsd;
    bucket.tokensIn += s.tokensIn;
    bucket.tokensOut += s.tokensOut;
  }

  return { groupBy, id, label, totals, strip: dates.map((date) => byDate.get(date) as HubUsageBucket) };
}

/** Whether a session belongs to entity `id` under `groupBy` — the summary's counterpart to
 *  `keyResolverFor`, just pre-bound to one target key instead of returning it for bucketing. */
function keyMatcherFor(
  groupBy: HubUsageGroupBy,
  id: string,
  ctx: HubUsageAttributionContext,
): (s: HubSession) => boolean {
  const keyFor = keyResolverFor(groupBy, ctx);
  return (s) => keyFor(s) === id;
}

/** The entity label for a per-entity summary. Unlike `labelResolverFor` (which tolerates a stale
 *  reference inside a rollup so one deleted entity never breaks the whole table), this DIRECTLY calls the
 *  repository's own `getX` for `agent`/`crew`/`project` and lets its 404 propagate — a summary requested
 *  for an id that was never real (or has since been deleted) is a genuine client error, not something to
 *  paper over with a placeholder label. */
function resolveEntityLabel(repository: HubRepository, groupBy: HubUsageGroupBy, id: string): string {
  switch (groupBy) {
    case "agent": {
      const role = repository.getAgentRole(id);
      return role.displayName ?? role.name;
    }
    case "crew":
      return repository.getCrew(id).name;
    case "project":
      return repository.getProject(id).name;
    case "model":
      return id;
    case "mode":
      return (MODE_LABELS as Record<string, string>)[id] ?? id;
    default: {
      const exhaustive: never = groupBy;
      throw new Error(`Unhandled HubUsageGroupBy: ${String(exhaustive)}`);
    }
  }
}
