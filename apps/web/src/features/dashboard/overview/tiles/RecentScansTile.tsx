import { useMemo } from "react";
import { ChevronRight, History } from "lucide-react";
import { DataTable, type ColumnDef } from "@elabs-ai/components-data";
import { BentoGridItem } from "@elabs-ai/components-ui";
import type { ScanSummary } from "@mcp-token-footprint/shared";
import { IconButton } from "../../../../components/IconButton";
import { SectionCardTitle } from "../../../../components/SectionCardTitle";
import { StatusBadge } from "../../../../components/StatusBadge";
import { formatDateTime } from "../../../../lib/format";
import {
  actionsCol,
  clickableRowTableProps,
  col,
  navCol,
  RESPONSIVE_TABLE_SCROLL_CLASS,
} from "../../../../lib/table";

/**
 * RecentScansTile — "Recent scan activity" as a full-width bento tile (dashboard-bento WP 2.1).
 * =============================================================================================
 * Owner feedback 2026-08-20: *"the two tables can be at the bottom end of the bento with full width
 * grid size."* This is `ScansTab.tsx`'s recent-activity `Card` moved onto the bento — the SAME eight
 * most-recent scans, the SAME five columns, the SAME whole-row click and responsive horizontal
 * scroll, built from the same `lib/table` recipe rather than a second hand-rolled table.
 *
 * Preserved verbatim from `ScansTab`, and worth restating:
 *
 * • **Failures are not filtered out.** This is the ACTIVITY feed (`scans` as given, newest first),
 *   not the footprint population — a failed scan is the most interesting row on it. That is also why
 *   it carries a Status column and the footprint table does not.
 * • **Quiet success (D-TB11 / audit D-3).** `StatusBadge quiet` renders a *success* row as plain
 *   muted text and everything else as a real tone-filled chip, so the column reads as "what needs
 *   me" instead of an all-green wall of decoration. The `quiet` PROP is the mechanism — never an
 *   inline `<Text>` exception — so `StatusBadge` stays the app's one status-chip renderer.
 * • **"Tool tokens", never a bare "Tokens" (T10).** `totalTokens` is tools-only; the Overview's
 *   `StartupCostTile` headline is tools + resources + prompts. The header names its scope so the two
 *   figures can never be read as the same quantity.
 *
 * ── SIZING ───────────────────────────────────────────────────────────────────────────────────────
 * Same reasoning as `FootprintTableTile`: `BentoGrid` rows are a fixed 14 rem and `BentoGridItem`
 * clips, so `col: 4` (the full width the owner asked for) is unconditional while the tile claims a
 * second row only once it has more than three rows to show — and the table body is a bounded scroll
 * region either way, so nothing is ever silently cut. This feed is capped at eight rows and needs no
 * pagination (`ScansTab` had none here either); the footprint table keeps its own.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour;
 * reads in both themes.
 */
export type RecentScansTileProps = {
  /** The app's scan list, newest first — already in memory in `App.tsx`. */
  scans: ScanSummary[];
  /** Open one scan's detail. Wired from the Dashboard host. */
  onOpenScan: (scanId: string) => void;
};

/** How many scans the activity feed shows — `ScansTab.tsx`'s `props.scans.slice(0, 8)`. */
const RECENT_LIMIT = 8;

/** More rows than this and the tile claims a second bento row (see "SIZING" above). */
const ROWS_BEFORE_SECOND_BENTO_ROW = 3;

export function RecentScansTile({ scans, onOpenScan }: RecentScansTileProps) {
  const rows = useMemo(() => scans.slice(0, RECENT_LIMIT), [scans]);

  const columns: ColumnDef<ScanSummary>[] = useMemo(
    () => [
      navCol<ScanSummary>({
        id: "server",
        header: "Server",
        value: (row) => row.serverName,
        onSelect: (row) => onOpenScan(row.id),
        ariaLabel: (row) => `Open scan of ${row.serverName}`,
        cell: (row) => <span className="block truncate font-medium">{row.serverName}</span>,
      }),
      col<ScanSummary>({
        id: "status",
        header: "Status",
        value: (row) => row.status,
        // D-TB11 (via D4): success reads as quiet muted text; every other tone keeps its chip.
        cell: (row) => <StatusBadge status={row.status} quiet />,
      }),
      col<ScanSummary>({
        // T10 — tools-only, and the header says so. See the module doc.
        id: "tokens",
        header: "Tool tokens",
        numeric: true,
        value: (row) => row.totalTokens,
      }),
      col<ScanSummary>({
        id: "date",
        header: "Date",
        value: (row) => row.scannedAt,
        cell: (row) => formatDateTime(row.scannedAt),
      }),
      actionsCol<ScanSummary>({
        id: "open",
        header: "Open scan",
        cell: (row) => (
          <IconButton
            variant="ghost"
            size="icon"
            onClick={() => onOpenScan(row.id)}
            label={`Open scan of ${row.serverName}`}
          >
            <ChevronRight aria-hidden />
          </IconButton>
        ),
      }),
    ],
    [onOpenScan],
  );

  // No scan activity at all — the bento must never render an empty box.
  if (rows.length === 0) return null;

  return (
    <BentoGridItem
      span={{ col: 4, row: rows.length > ROWS_BEFORE_SECOND_BENTO_ROW ? 2 : 1 }}
      className="gap-3 p-4"
    >
      <header className="flex min-w-0 items-center gap-2">
        <History aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <SectionCardTitle className="min-w-0 truncate">Recent scan activity</SectionCardTitle>
      </header>
      {/* Bounded scroll region — the bento row height is fixed and the tile clips, so the BODY
          scrolls rather than the content being silently cut (S22 scroll contract). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Whole-row click target (ui-wave U7) + `RESPONSIVE_TABLE_SCROLL_CLASS` (P0 mobile audit T4). */}
        <DataTable
          data={rows}
          columns={columns}
          {...clickableRowTableProps(RESPONSIVE_TABLE_SCROLL_CLASS)}
          emptyMessage="No scan activity yet."
        />
      </div>
    </BentoGridItem>
  );
}
