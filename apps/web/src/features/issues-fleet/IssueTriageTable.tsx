import { Sparkles } from "lucide-react";
import { DataTable, type ColumnDef } from "@brand/data";
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@brand/ui";
import { StatusBadge } from "../../components/StatusBadge";
import { deriveIssueLifecycleView } from "../../lib/status";
import { formatDateTime, formatNumber, formatRelativeTime } from "../../lib/format";
import { clickableRowTableProps, col, navCol, RESPONSIVE_TABLE_SCROLL_CLASS } from "../../lib/table";
import { BUCKET_LABELS, type FleetIssue, issueAiAssisted, sparklineValues } from "./issue-lib";
import { IssueSparkline } from "./IssueSparkline";

/**
 * The triage table (WP5.3 spec §Design; owner-directed redesign — a FULL-WIDTH dense table, no
 * longer crammed into a `SplitPane`'s narrow left column; see `IssuesFleetTab.tsx`) — one row per
 * fleet issue: title (+ an AI-assisted mark when WP5.2's judge-refined a title/summary), lifecycle
 * chip, occurrence count, trend sparkline, first/last seen, affected-entity chips, and its
 * root-cause bucket. Rows arrive PRE-SORTED (`sortFleetIssues` — regressed first, then occurrence
 * count) and PRE-FILTERED by the caller; this component is purely presentational + selection.
 *
 * Two presentation fixes ride along with the width change: the Issue title cell now has a hard
 * `max-width` (not just `min-w-0`) so a long title always truncates to an ellipsis instead of
 * forcing the column — and the whole table — wider than its box (a `min-w-0 truncate` span alone
 * doesn't cap a `<td>`'s content width under the browser's table auto-layout, since `truncate`'s
 * `white-space: nowrap` reports its FULL un-wrapped width as the column's min-content width); and
 * the First/Last seen cells are `whitespace-nowrap` with a compact `formatRelativeTime` label (the
 * full absolute timestamp still on hover via `title=`) instead of the long `formatDateTime` string
 * that used to wrap character-by-character in a cramped column ("Jul 13, 202" / "7:2" / "PM").
 *
 * The table itself is the plain (non-virtualized) `@brand/data` `DataTable` `ScansTab`/`ServersView`
 * already use for a full-width inventory. P0 mobile audit T4 (2026-07-25 critique): below `lg` its
 * inner scroll box is now `overflow-x-auto` (`RESPONSIVE_TABLE_SCROLL_CLASS`, `lib/table.tsx`) instead
 * of `overflow-hidden`, so all 9 columns — including the two pinned ones — stay reachable by a
 * horizontal swipe at a phone width (measured: 8 of 9 columns were silently gone at 390px before this
 * fix, not scrollable, just clipped). At `lg` and up the wrapper still clips rather than pushes the
 * PAGE wider (unchanged); the tab's shared `TabPanelContent` body (the default `scroll` — see
 * `IssuesFleetTab.tsx`/`DashboardView.tsx`) is the one vertical (and, per the CSS overflow-computed-
 * value rule, effective horizontal) scroll region at that width, matching every other simple
 * full-width `DataTable` tab in this app. (Row-virtualization via
 * `stickyScrollTableProps()` — the recipe `ScansView`/`CompareView` use for a self-scrolling table —
 * was tried here first, but its scroll box measures a zero height under jsdom/vitest, so
 * `@tanstack/react-virtual` renders an EMPTY `<tbody>` in tests; reverted in favor of this simpler,
 * test-safe recipe.)
 */
export function IssueTriageTable({
  issues,
  selectedId,
  onSelect,
  entityLabel,
}: {
  issues: FleetIssue[];
  selectedId: string | null;
  onSelect: (issue: FleetIssue) => void;
  /** Resolves a server/skill id to a display name (falls back to the raw id — see `IssuesFleetTab`). */
  entityLabel: (id: string) => string;
}) {
  // Only show the Trend column if at least one issue has trend data.
  const hasTrendData = issues.some((issue) => sparklineValues(issue).length > 0);

  const columns: ColumnDef<FleetIssue>[] = [
    navCol<FleetIssue>({
      id: "title",
      header: "Issue",
      value: (row) => row.title,
      onSelect,
      isActive: (row) => row.id === selectedId,
      ariaLabel: (row) => `Open ${row.title}`,
      pin: "left",
      cell: (row) => (
        <span className="flex min-w-0 max-w-[28rem] items-center gap-1.5">
          {issueAiAssisted(row) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0" data-testid="ai-assisted-mark">
                  <Sparkles aria-hidden className="size-3.5 text-info" />
                </span>
              </TooltipTrigger>
              <TooltipContent>AI-refined title/summary (WP5.2)</TooltipContent>
            </Tooltip>
          ) : null}
          <span className="min-w-0 truncate" title={row.title}>
            {row.title}
          </span>
        </span>
      ),
    }),
    {
      id: "lifecycle",
      accessorFn: (row) => row.fleet.lifecycle,
      enableSorting: true,
      header: () => "Lifecycle",
      cell: ({ row }) => (
        <StatusBadge view={deriveIssueLifecycleView(row.original.fleet.lifecycle)} />
      ),
    },
    col<FleetIssue>({
      id: "occurrences",
      header: "Occurrences",
      numeric: true,
      value: (row) => row.fleet.occurrenceCount,
    }),
    ...(hasTrendData
      ? [
          {
            id: "trend",
            enableSorting: false,
            header: () => "Trend",
            cell: ({ row }: { row: { original: FleetIssue } }) => <IssueSparkline issue={row.original} />,
          } as ColumnDef<FleetIssue>,
        ]
      : []),
    col<FleetIssue>({
      id: "firstSeen",
      header: "First seen",
      value: (row) => row.fleet.firstSeenAt,
      cell: (row) => (
        <span
          className="whitespace-nowrap tabular-nums"
          title={formatDateTime(row.fleet.firstSeenAt)}
        >
          {formatRelativeTime(row.fleet.firstSeenAt)}
        </span>
      ),
    }),
    col<FleetIssue>({
      id: "lastSeen",
      header: "Last seen",
      value: (row) => row.fleet.lastSeenAt,
      cell: (row) => (
        <span
          className="whitespace-nowrap tabular-nums"
          title={formatDateTime(row.fleet.lastSeenAt)}
        >
          {formatRelativeTime(row.fleet.lastSeenAt)}
        </span>
      ),
    }),
    {
      id: "affected",
      enableSorting: false,
      header: () => "Affected",
      cell: ({ row }) => {
        const ids = [...row.original.fleet.affected.servers, ...row.original.fleet.affected.skills];
        if (ids.length === 0) {
          // a11y (critique 2026-07-25T20-00-10Z item 4): the dash alone was `aria-hidden`, so the
          // cell announced as EMPTY to assistive tech. Keep the same visible dash (no visual change)
          // but give the cell a real accessible representation: the punctuation stays hidden (a bare
          // "—" reads poorly/inconsistently across screen readers), and "None" takes its place.
          return (
            <span className="text-caption text-muted-foreground">
              <span aria-hidden="true">—</span>
              <span className="sr-only">None</span>
            </span>
          );
        }
        return (
          <div className="flex max-w-[16rem] flex-wrap items-center gap-1">
            {ids.map((id) => (
              <Badge key={id} variant="outline" className="max-w-[8rem] truncate">
                {entityLabel(id)}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: "bucket",
      accessorFn: (row) => row.bucket,
      enableSorting: true,
      header: () => "Bucket",
      cell: ({ row }) => <Badge variant="outline">{BUCKET_LABELS[row.original.bucket]}</Badge>,
    },
    // right-pinned so the count is reachable when the table scrolls horizontally.
    col<FleetIssue>({
      id: "timesSeen",
      header: "Seen",
      numeric: true,
      value: (row) => row.timesSeen,
      pin: "right",
      cell: (row) => <>{formatNumber(row.timesSeen)}×</>,
    }),
  ];

  return (
    // ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx).
    <DataTable
      data={issues}
      columns={columns}
      {...clickableRowTableProps(RESPONSIVE_TABLE_SCROLL_CLASS)}
      emptyMessage="No issues match the current filters."
    />
  );
}
