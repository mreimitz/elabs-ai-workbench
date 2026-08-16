import type { DateRange, DateRangePreset } from "@brand/ui";
import { DateRangePicker } from "@brand/ui";
import { FacetFilter, type FacetOption } from "@brand/data";
import type { RatingIssueLifecycle } from "@mcp-token-footprint/shared";
import { RATING_ISSUE_LIFECYCLES } from "@mcp-token-footprint/shared";
import type { IssueTriageFilters } from "./issue-lib";

const LIFECYCLE_OPTIONS: FacetOption[] = RATING_ISSUE_LIFECYCLES.map((l) => ({
  value: l,
  label: l.charAt(0).toUpperCase() + l.slice(1),
}));

const DATE_PRESETS: DateRangePreset[] = [
  { label: "Last 7 days", getRange: () => ({ from: daysAgo(6), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: daysAgo(29), to: new Date() }) },
  { label: "Last 90 days", getRange: () => ({ from: daysAgo(89), to: new Date() }) },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function isoDateOnlyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The triage list's filter row (WP5.3 spec §Design: "Filters: lifecycle, entity, date") — the SAME
 * control vocabulary as the Testing dashboard's `FilterControls` recipe (`FacetFilter` per
 * dimension + a `DateRangePicker`, all label-in-control — D-4), at a much smaller scale (three
 * controls, not the Testing tab's full control bar). This component renders only the controls; the
 * caller (`IssuesFleetTab`) is the one that wraps them in the shared one-row `ViewToolbar` band
 * (WP 2.1 — previously that wrap didn't exist, so despite matching vocabulary the two tabs read as
 * different row shapes: Issues split chips + search across two `p-4` rows). A pure controlled view:
 * `filters`/`onChange` round-trip through the caller, same as `FilterControls`.
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
  const dateValue: DateRange | undefined =
    filters.lastSeenFrom || filters.lastSeenTo
      ? {
          from: filters.lastSeenFrom ? new Date(filters.lastSeenFrom) : undefined,
          to: filters.lastSeenTo ? new Date(filters.lastSeenTo) : undefined,
        }
      : undefined;

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
      <DateRangePicker
        value={dateValue}
        onValueChange={(range) =>
          onChange({
            ...filters,
            lastSeenFrom: range?.from ? isoDateOnlyLocal(range.from) : undefined,
            lastSeenTo: range?.to ? isoDateOnlyLocal(range.to) : range?.from ? isoDateOnlyLocal(range.from) : undefined,
          })
        }
        presets={DATE_PRESETS}
        placeholder="Last seen"
      />
    </div>
  );
}
