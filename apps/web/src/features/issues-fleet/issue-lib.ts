import {
  SEVERITY_RAMP,
  type SeverityRampStep,
  type SeverityRampTone,
} from "@mcp-token-footprint/shared";
import type {
  FixTarget,
  RatingIssue,
  RatingIssueFleet,
  RatingIssueLifecycle,
  RatingIssueSeverity,
  RootCauseBucket,
  RunFilter,
} from "@mcp-token-footprint/shared";

/**
 * Pure helpers for the fleet Issues tab (Observability WP5.3) — no React, no fetch, so every rule
 * here (which issues count as "fleet", the default sort, the filter predicate, the deep-link
 * RunFilter) is unit-testable directly against fixtures. Mirrors the style of
 * `features/dashboard/testing/dashboard-url-state.ts` and `metrics-derive.ts`.
 */

/** A {@link RatingIssue} that carries the WP5.1 fleet block — the ONLY issues this tab renders (a
 *  plain per-run auto-rating issue, filed against a single run and surfaced instead by
 *  `features/issues/IssuesPanel` on the server/skill detail view, has no `fleet` and is excluded). */
export type FleetIssue = RatingIssue & { fleet: RatingIssueFleet };

/** Narrows a `RatingIssue` to a {@link FleetIssue} — the tab's one admission rule. */
export function isFleetIssue(issue: RatingIssue): issue is FleetIssue {
  return issue.fleet != null;
}

/**
 * AI-assisted provenance (WP5.2, "Refine with AI") — read DEFENSIVELY. WP5.2 lands the `aiAssisted`
 * flag on the shared `RatingIssue` type in a PARALLEL batch that may not have merged yet at the time
 * this tab ships; a wire payload that doesn't (yet) carry the field simply reads `false` rather than
 * throwing or failing to compile. Once WP5.2's type lands, this keeps working unchanged (an actual
 * `boolean` flows straight through) — no follow-up edit required here.
 */
export function issueAiAssisted(issue: RatingIssue): boolean {
  const flagged = (issue as RatingIssue & { aiAssisted?: unknown }).aiAssisted;
  return flagged === true;
}

/** Sort priority: regressed first, then open, then resolved — ties broken by occurrence count
 *  (highest first). The triage list's DEFAULT order (a user can still click a column to re-sort). */
export function compareFleetIssues(a: FleetIssue, b: FleetIssue): number {
  const byLifecycle = lifecycleRank(a.fleet.lifecycle) - lifecycleRank(b.fleet.lifecycle);
  if (byLifecycle !== 0) return byLifecycle;
  return b.fleet.occurrenceCount - a.fleet.occurrenceCount;
}

function lifecycleRank(lifecycle: RatingIssueLifecycle): number {
  switch (lifecycle) {
    case "regressed":
      return 0;
    case "open":
      return 1;
    case "resolved":
      return 2;
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

export function sortFleetIssues(issues: readonly FleetIssue[]): FleetIssue[] {
  return [...issues].sort(compareFleetIssues);
}

/** The triage list's filter state. Empty arrays / absent dates impose no constraint (same convention
 *  as {@link RunFilter}). `entity` matches a server OR skill id present in `fleet.affected`. */
export type IssueTriageFilters = {
  lifecycle: RatingIssueLifecycle[];
  entity: string[];
  /** Inclusive lower/upper bound on `fleet.lastSeenAt` (ISO-8601 or `YYYY-MM-DD`). */
  lastSeenFrom?: string;
  lastSeenTo?: string;
};

export const EMPTY_ISSUE_FILTERS: IssueTriageFilters = { lifecycle: [], entity: [] };

/** Client-side filter predicate — the whole set is small enough (a local dev tool's fleet) that
 *  fetching once and filtering in the browser (the same recipe the Testing dashboard's small
 *  catalogs use) is simpler and more testable than round-tripping every facet change to the API. */
export function filterFleetIssues(
  issues: readonly FleetIssue[],
  filters: IssueTriageFilters,
): FleetIssue[] {
  return issues.filter((issue) => {
    if (filters.lifecycle.length > 0 && !filters.lifecycle.includes(issue.fleet.lifecycle)) {
      return false;
    }
    if (filters.entity.length > 0) {
      const affectedIds = [...issue.fleet.affected.servers, ...issue.fleet.affected.skills];
      if (!filters.entity.some((id) => affectedIds.includes(id))) return false;
    }
    if (filters.lastSeenFrom && issue.fleet.lastSeenAt < filters.lastSeenFrom) return false;
    if (filters.lastSeenTo && issue.fleet.lastSeenAt > filters.lastSeenTo) return false;
    return true;
  });
}

/** Free-text match over title/summary — case-insensitive substring (the triage list's search box). */
export function matchesIssueQuery(issue: FleetIssue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return issue.title.toLowerCase().includes(q) || issue.summary.toLowerCase().includes(q);
}

/**
 * The EXACT {@link RunFilter} that reproduces this issue's known scope: the dimensions it's known to
 * span (`fleet.affected`) ANDed with the observed window (`firstSeenAt`..`lastSeenAt`). Used for the
 * detail's "open in feed" action and the occurrences-over-time chart — the SAME filter object powers
 * both, so the chart and the feed link never disagree about what "this issue's runs" means. An
 * occurrence's rating is always stamped at/after its run's `startedAt` (rating runs post-completion),
 * so bounding by `lastSeenAt` is a safe (never-too-narrow) inclusive upper bound on `startedAt`.
 */
export function buildIssueRunFilter(issue: FleetIssue): RunFilter {
  const filter: RunFilter = {
    dateFrom: issue.fleet.firstSeenAt,
    dateTo: issue.fleet.lastSeenAt,
  };
  if (issue.fleet.affected.servers.length > 0) filter.serverId = issue.fleet.affected.servers;
  if (issue.fleet.affected.skills.length > 0) filter.skillId = issue.fleet.affected.skills;
  if (issue.fleet.affected.tests.length > 0) filter.testId = issue.fleet.affected.tests;
  if (issue.fleet.affected.models.length > 0) filter.model = issue.fleet.affected.models;
  return filter;
}

/** The distinct (server-or-skill) entity ids a set of fleet issues spans — the "Entity" facet's
 *  option universe (labels resolved by the caller, which knows server/skill display names). */
export function distinctAffectedEntityIds(issues: readonly FleetIssue[]): string[] {
  const ids = new Set<string>();
  for (const issue of issues) {
    for (const id of issue.fleet.affected.servers) ids.add(id);
    for (const id of issue.fleet.affected.skills) ids.add(id);
  }
  return [...ids];
}

/** The sparkline's raw series — oldest → newest daily counts, UNPADDED (a sparse trend of 1-2 points
 *  renders exactly those points, never zero-filled — the loading-states "honest with sparse data"
 *  rule). Empty (a brand-new cluster whose sweep hasn't derived a trend yet) returns `[]`. */
export function sparklineValues(issue: FleetIssue): number[] {
  return issue.fleet.trend.map((point) => point.count);
}

// ── Chip vocabulary — mirrors `features/issues/IssuesPanel.tsx`'s bucket/fixTarget maps EXACTLY (kept
// module-private there per its own doc comment) so one finding reads identically per-target and here. ──

export const BUCKET_LABELS: Record<RootCauseBucket, string> = {
  skill: "Skill",
  mcp_server: "MCP server",
  model_behavior: "Model behavior",
  test_setup: "Test setup",
  provider_infra: "Provider infra",
};

export type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

export const FIX_TARGET_META: Record<FixTarget, { label: string; variant: BadgeVariant }> = {
  skill: { label: "Fix in skill", variant: "info" },
  mcp_server: { label: "Fix in MCP server", variant: "warning" },
  none: { label: "No fix target", variant: "outline" },
};

// RM-37 WP 0.5 (action 8) — this map used to hand-write its own three tones, and Advisor's
// hand-written map called its OWN "high" a different chip (red `destructive` here and there too,
// by coincidence — nothing forced the two literals to agree). The TONE now comes from the one
// shared ramp (`@mcp-token-footprint/shared` `severity-ramp.ts`); this table only says which rung
// of that ramp a wire severity stands on. `low` used to render `secondary` (a filled neutral); the
// ramp's own `low` rung is `outline`, so that chip is now visually lighter than before — this is
// the whole point of collapsing four independent maps onto one ramp, not a regression.
const ISSUE_SEVERITY_RAMP_STEP: Record<RatingIssueSeverity, SeverityRampStep> = {
  high: "high",
  medium: "medium",
  low: "low",
};

export const SEVERITY_META: Record<
  RatingIssueSeverity,
  { label: string; variant: SeverityRampTone }
> = Object.fromEntries(
  Object.entries(ISSUE_SEVERITY_RAMP_STEP).map(([severity, step]) => [
    severity,
    { label: SEVERITY_RAMP[step].label, variant: SEVERITY_RAMP[step].variant },
  ]),
) as Record<RatingIssueSeverity, { label: string; variant: SeverityRampTone }>;
