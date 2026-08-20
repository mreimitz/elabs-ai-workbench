import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import type { FacetOption } from "@elabs-ai/components-data";
import { SearchInput } from "@elabs-ai/components-data";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatePanel,
} from "@elabs-ai/components-ui";
import { InlineError } from "../../components/InlineError";
import { ResultCount } from "../../components/ResultCount";
import { TabEmptyState } from "../../components/TabEmptyState";
import { ViewToolbar } from "../../components/ViewToolbar";
import { listServers, listSkills } from "../../lib/api";
import { type Loadable, loadableData, useLoadable } from "../../lib/loadable";
import type { DashboardRange } from "../dashboard/dashboard-range";
import { IssueDetail } from "./IssueDetail";
import { IssueFilters } from "./IssueFilters";
import { IssueTriageTable } from "./IssueTriageTable";
import {
  distinctAffectedEntityIds,
  EMPTY_ISSUE_FILTERS,
  filterFleetIssues,
  type FleetIssue,
  type IssueTriageFilters,
  matchesIssueQuery,
  sortFleetIssues,
} from "./issue-lib";

/** The `?issue=` URL key — the Issues tab's own deep-link param (namespaced alongside `?tab=` from
 *  the Dashboard host and Testing tab's `t*` control keys; no collision with either). */
const ISSUE_PARAM = "issue";

/**
 * IssuesFleetTab — the Dashboard's Issues tab (WP5.3; owner-directed redesign). A single FULL-WIDTH
 * triage table (`IssueTriageTable`, the same dense-table spirit as `RunsView`'s runs feed) instead
 * of the original `SplitPane` master-detail — the narrow left pane a two-pane split forced onto a
 * 9-column table caused real overflow (titles spilling, dates wrapping character-by-character; see
 * `IssueTriageTable.tsx`'s own doc). A row click opens `IssueDetail` in a `@elabs-ai/components-ui` `Sheet`
 * (a right-side slide-in drawer built on Radix Dialog — focus trap, Esc-close, and focus-return to
 * the row all come from Radix for free, no hand-rolled modal logic here) instead of a permanently
 * docked side pane.
 *
 * The Sheet's open/close is driven by the SAME `?issue=<id>` URL param the old master-detail already
 * used: a row's `navCol` click sets it (`setSelectedId`), the Sheet opens because `selected` resolves
 * to a real issue; closing the Sheet (✕ / Esc / overlay — all funnel through `onOpenChange`) clears
 * it. A deep-link landing on `?issue=<id>` (e.g. from a notification's `linkPath`) opens the Sheet on
 * mount for the same reason; an unresolvable/stale id self-clears via the existing effect below,
 * unchanged from the pre-redesign behavior.
 *
 * Data ownership: `issuesState`/`reloadIssues` come from the CALLER (`DashboardView`, via
 * `useFleetIssues`) so the tab strip can badge the open+regressed count before this tab is ever
 * opened (mirrors `ServersView`'s `useRatingIssues` page-level fetch). This component owns its own
 * catalog fetch (servers/skills, for the "Affected" chip labels) and the selection/filter UI state.
 *
 * D-4 (WP 2.1 toolbar-reach): the filter row is ONE `ViewToolbar` — `IssueFilters` + search in
 * `left`, the row count in `results` — so the Testing and Issues tabs share one filter-row shape.
 *
 * ── THE PAGE RANGE SCOPES THIS LIST (dashboard-bento WP 2.2, Defect 2) ───────────────────────────
 * Owner, 2026-08-20: *"If we introduce a new toolbar with filter on timeline this need to work for
 * Testing and issues as well."* So `range` — the Dashboard's ONE window, shared with the Overview
 * and Testing tabs — is folded into the filter as `lastSeenFrom`/`lastSeenTo`, the two bounds this
 * list already understood (they used to come from a `DateRangePicker` inside `IssueFilters`, private
 * to this tab and persisted nowhere).
 *
 * Two consequences, both deliberate:
 *   • The default view is now the trailing 7 days rather than all history. The `ResultCount` states
 *     "N of M issues" whenever the window (or a facet) is narrowing the list, so a shrunken list can
 *     never look like the whole fleet — and widening it is one control away, in the page toolbar.
 *   • The bounds are ISO-8601 INSTANTS, not `YYYY-MM-DD`. `filterFleetIssues` compares them
 *     lexically against `fleet.lastSeenAt` (itself an ISO instant), so a date-only upper bound
 *     silently excluded the whole of its own final day — every `2026-07-10T…` sorts after
 *     `"2026-07-10"`. Instants make the inclusive bound actually inclusive.
 *
 * The `bg-card`/`border-b`/gutter-bleed band this row used to sit in is gone with the same change:
 * the page host (`DashboardView`) owns the one command-bar surface now, and these controls are this
 * tab's own content (`planning/Roadmap/RM-30-ux-overhaul/toolbar-standard-2026-07-11.md`, D-TB2).
 */
export function IssuesFleetTab({
  range,
  issuesState,
  reloadIssues,
}: {
  /** The Dashboard's shared window — scopes the list by `fleet.lastSeenAt`. */
  range: DashboardRange;
  issuesState: Loadable<FleetIssue[]>;
  reloadIssues: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(ISSUE_PARAM);
  const setSelectedId = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set(ISSUE_PARAM, id);
        else next.delete(ISSUE_PARAM);
        return next;
      },
      { replace: true },
    );
  };

  const [filters, setFilters] = useState<IssueTriageFilters>(EMPTY_ISSUE_FILTERS);
  const [search, setSearch] = useState("");

  // Name resolution for the "Affected" chips — fetched ONCE (a small local-dev-tool catalog, same
  // recipe `useTestingCatalog` uses). A lookup failure degrades to raw ids (never blocks the tab).
  const { state: catalogState } = useLoadable(
    () => Promise.all([listServers(), listSkills()]),
    [],
  );
  const catalog = loadableData(catalogState);
  const servers = catalog?.[0] ?? [];
  const skills = catalog?.[1] ?? [];
  const entityNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const server of servers) map.set(server.id, server.name);
    for (const skill of skills) map.set(skill.id, skill.displayName);
    return map;
  }, [servers, skills]);
  const entityLabel = (id: string): string => entityNames.get(id) ?? id;

  const issues = loadableData(issuesState) ?? [];
  const entityOptions: FacetOption[] = useMemo(
    () => distinctAffectedEntityIds(issues).map((id) => ({ value: id, label: entityLabel(id) })),
    [issues, entityNames],
  );

  // The page range is ANDed onto the tab's own facets — one filter object, so the count badge, the
  // table and the (unfiltered) deep-link resolution below can never disagree about what is in scope.
  const scopedFilters = useMemo(
    () => ({ ...filters, lastSeenFrom: range.from, lastSeenTo: range.to }),
    [filters, range.from, range.to],
  );

  const visible = useMemo(
    () =>
      sortFleetIssues(
        filterFleetIssues(issues, scopedFilters).filter((issue) => matchesIssueQuery(issue, search)),
      ),
    [issues, scopedFilters, search],
  );

  const selected = issues.find((issue) => issue.id === selectedId) ?? null;

  // A deep-link (`?issue=` from a notification, or a stale selection after a filter narrows the list
  // out from under it) still resolves against the FULL unfiltered set above — filters only affect
  // which rows the LIST shows, never whether the detail can open a specific issue.
  useEffect(() => {
    if (selectedId && !issues.some((issue) => issue.id === selectedId) && issuesState.status === "data") {
      // The id doesn't (or no longer) resolve to a fleet issue — clear it so the detail pane falls
      // back to its empty state instead of silently showing nothing forever.
      setSelectedId(null);
    }
    // Deliberately keyed on `issuesState.status` only — re-checks once the list actually loads, not
    // on every filter/search keystroke (`issues`/`setSelectedId` are stable-enough for this purpose).
  }, [issuesState.status]);

  if (issuesState.status === "loading") {
    return <StatePanel kind="loading" title="Loading issues…" loadingLabel="Loading…" />;
  }
  if (issuesState.status === "error") {
    return (
      <InlineError title="Couldn’t load issues" detail={issuesState.error} onRetry={reloadIssues} />
    );
  }
  if (issues.length === 0) {
    return (
      <TabEmptyState
        icon={<ShieldCheck aria-hidden />}
        title="No fleet issues recorded"
        description="Recurring problems clustered across runs will file here automatically as suites and runs complete."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* dashboard-bento WP 2.2 — the FACET row, frame-light (the `bg-card` + `border-b` +
          gutter-bleed band it used to sit in was a second toolbar under the page's one toolbar).
          It sits flush with the page gutter, exactly like the Testing tab's own facet row, so the
          two tabs measure as the same row in the same place. */}
      <div className="shrink-0">
        <ViewToolbar
          left={
            <>
              <IssueFilters filters={filters} onChange={setFilters} entityOptions={entityOptions} />
              <div className="w-64 min-w-[10rem]">
                <SearchInput value={search} onValueChange={setSearch} placeholder="Filter issues…" />
              </div>
            </>
          }
          results={
            <ResultCount
              filteredCount={visible.length}
              totalCount={issues.length}
              noun={issues.length === 1 ? "issue" : "issues"}
            />
          }
        />
      </div>

      <div className="flex flex-col gap-3 pb-4">
        <IssueTriageTable
          issues={visible}
          selectedId={selectedId}
          onSelect={(issue) => setSelectedId(issue.id)}
          entityLabel={entityLabel}
        />
      </div>

      {/* The detail drawer (owner-directed redesign) — `IssueDetail` reused verbatim as the Sheet
          body; `open` derives from `selected` so a deep-link (`?issue=`) opens it on mount too. */}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <SheetHeader className="border-b border-border px-5 pb-4 pt-5 pr-12">
            <SheetTitle>Issue detail</SheetTitle>
            <SheetDescription className="min-w-0 truncate">
              {selected ? selected.title : "Select an issue to see its detail."}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {selected ? (
              <IssueDetail issue={selected} onChanged={reloadIssues} entityLabel={entityLabel} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
