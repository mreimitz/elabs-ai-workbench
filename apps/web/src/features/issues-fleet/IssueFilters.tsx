import { FacetFilter, type FacetOption } from "@elabs-ai/components-data";
import type { RatingIssueLifecycle } from "@mcp-token-footprint/shared";
import { RATING_ISSUE_LIFECYCLES } from "@mcp-token-footprint/shared";
import type { IssueTriageFilters } from "./issue-lib";

const LIFECYCLE_OPTIONS: FacetOption[] = RATING_ISSUE_LIFECYCLES.map((l) => ({
  value: l,
  label: l.charAt(0).toUpperCase() + l.slice(1),
}));

/**
 * The triage list's facet row (WP5.3 spec §Design: "Filters: lifecycle, entity, date") — the SAME
 * control vocabulary as the Testing tab's `FilterControls` recipe (`FacetFilter` per dimension, all
 * label-in-control — D-4), at a much smaller scale. This component renders only the controls; the
 * caller (`IssuesFleetTab`) lays them out in the shared one-row `ViewToolbar`. A pure controlled
 * view: `filters`/`onChange` round-trip through the caller, same as `FilterControls`.
 *
 * ── THE DATE FILTER MOVED OUT (dashboard-bento WP 2.2, Defect 2) ─────────────────────────────────
 * "date" used to be a third control here — a `DateRangePicker` writing `lastSeenFrom`/`lastSeenTo`,
 * unpersisted and independent of every other window on the page. Owner, 2026-08-20: *"If we
 * introduce a new toolbar with filter on timeline this need to work for Testing and issues as
 * well."* Those two bounds are now supplied by the Dashboard's ONE page-level range
 * (`features/dashboard/dashboard-range.ts`), which `IssuesFleetTab` folds into the filter it
 * evaluates — so this row keeps only the facets that are genuinely the issue list's own.
 */
export function IssueFilters({
  filters,
  onChange,
  entityOptions,
}: {
  filters: IssueTriageFilters;
  onChange: (next: IssueTriageFilters) => void;
  entityOptions: FacetOption[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FacetFilter
        title="Lifecycle"
        options={LIFECYCLE_OPTIONS}
        selected={filters.lifecycle}
        onSelectedChange={(values) =>
          onChange({ ...filters, lifecycle: values as RatingIssueLifecycle[] })
        }
      />
      <FacetFilter
        title="Entity"
        options={entityOptions}
        selected={filters.entity}
        onSelectedChange={(values) => onChange({ ...filters, entity: values })}
      />
    </div>
  );
}
