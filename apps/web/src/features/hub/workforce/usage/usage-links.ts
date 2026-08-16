import type { HubUsageRow } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub UX WP2.6 (D-HUX10) — the ranked DataTable's per-row drill DESTINATION, pure and
 * React-free (mirrors `dashboard/testing/dashboard-url-state.ts`'s `drillDownFilter`/`drillDownHref`
 * style). Read this doc before changing a row's click behavior.
 *
 * WHY THIS ISN'T ONE UNIFORM "narrow + regroup" for every dimension
 * -------------------------------------------------------------------------------------------------
 * The concept wireframe (§7.3) describes clicking ANY row (an agent, a crew, …) as narrowing the
 * whole tab to that entity and regrouping by the next dimension. `GET /api/hub/usage/rollup`
 * (WP1.6, `apps/api/src/hub/routes.ts`'s `hubUsageRollupQuerySchema`, `.strict()`) only accepts
 * `groupBy` + `from`/`to` + **`projectId`** — there is no `agentId`/`crewId`/`modelId`/`mode` query
 * parameter to narrow by. So a `project` row is the ONLY one that can honestly narrow-and-regroup
 * in place (`{ kind: "narrow" }` below, consumed by `UsageTab.tsx` to set `?uProject=` and pick a
 * new `groupBy`). Pretending every dimension narrows — showing a breadcrumb chip the table doesn't
 * actually honor — would be exactly the kind of fabricated result this codebase's rules forbid.
 *
 * For every other dimension, the row IS the drill's leaf: it links to the one place that entity's
 * OWN detail already lives (or will, once the sibling WP lands) —
 *   • `agent`/`crew` → that entity's profile Usage sub-page (D-HUX6's `?settings=usage` node route,
 *     documented in `WorkforceView.tsx`'s frame-API doc; built by WP2.3/WP2.4 in a parallel worktree
 *     — this link is well-formed today even though that modal isn't mounted in THIS worktree, the
 *     same "correctly composed, not yet consumed" posture `dashboard-url-state.ts`'s own
 *     `drillDownHref` doc calls out).
 *   • `model`/`mode` → the Sessions table (`/assistant/sessions`, WP1.4), pre-filtered via query
 *     params. `SessionsView.tsx` reads `useSearchParams()` (wired in WP2.8) and applies these
 *     filters to the table facets (`mode`, `projectId`) — the drill link lands on Sessions
 *     FILTERED as intended (verified WP2.R).
 *   • the unattributed ("No agent"/"No crew"/"No project") bucket → Sessions, unfiltered — there is
 *     no session-table dimension for "unattributed", so this is honestly labeled as "open sessions",
 *     never "view filtered sessions".
 */

export type UsageDrillDestination =
  | { kind: "narrow"; projectId: string }
  | { kind: "profile"; href: string }
  | { kind: "sessions"; href: string; filtered: boolean };

/** `/assistant/agents/{agent|crew}/:id` stays on the Usage tab (`tab=usage`) and opens straight to
 *  the profile's own Usage sub-page (`settings=usage`) per `WorkforceView.tsx`'s documented scheme. */
function profileHref(kind: "agent" | "crew", id: string): string {
  return `/assistant/agents/${kind}/${encodeURIComponent(id)}?tab=usage&settings=usage`;
}

function sessionsHref(query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  return qs ? `/assistant/sessions?${qs}` : "/assistant/sessions";
}

export function drillDestinationFor(row: HubUsageRow): UsageDrillDestination {
  if (row.key === null) {
    // The unattributed bucket — no id, no facet to filter Sessions by.
    return { kind: "sessions", href: sessionsHref({}), filtered: false };
  }
  switch (row.groupBy) {
    case "project":
      return { kind: "narrow", projectId: row.key };
    case "agent":
      return { kind: "profile", href: profileHref("agent", row.key) };
    case "crew":
      return { kind: "profile", href: profileHref("crew", row.key) };
    case "model":
      return { kind: "sessions", href: sessionsHref({ model: row.key }), filtered: true };
    case "mode":
      return { kind: "sessions", href: sessionsHref({ mode: row.key }), filtered: true };
    default: {
      const exhaustive: never = row.groupBy;
      throw new Error(`Unhandled HubUsageGroupBy: ${String(exhaustive)}`);
    }
  }
}

/** The toolbar-level "View sessions" action for the CURRENT filter (date range + project narrow) —
 *  independent of any single row. Same forward-compatible-but-unconsumed posture as
 *  {@link drillDestinationFor}'s `sessions` links (see the module doc). */
export function sessionsHrefForFilter(filter: { projectId?: string }): string {
  return sessionsHref(filter.projectId ? { projectId: filter.projectId } : {});
}
