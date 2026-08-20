import { useMemo } from "react";
import { ChevronRight, Table2 } from "lucide-react";
import { DataTable, type ColumnDef } from "@elabs-ai/components-data";
import { BentoGridItem, Text } from "@elabs-ai/components-ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { IconButton } from "../../../../components/IconButton";
import { SectionCardTitle } from "../../../../components/SectionCardTitle";
import { formatDateTime, formatNumber } from "../../../../lib/format";
import {
  actionsCol,
  clickableRowTableProps,
  col,
  navCol,
  RESPONSIVE_TABLE_SCROLL_CLASS,
  shouldPaginate,
} from "../../../../lib/table";
import { buildScanDeltaIndex, ScanDeltaCell, scanDeltaFor } from "../../../scans/scanDelta";
import { rankedServerScans } from "./scan-tile-data";

/**
 * FootprintTableTile — "Latest server footprint" as a full-width bento tile (dashboard-bento WP 2.1).
 * =============================================================================================
 * Owner feedback 2026-08-20: *"the two tables can be at the bottom end of the bento with full width
 * grid size."* This is `ScansTab.tsx`'s footprint `Card` moved onto the bento — the SAME rows, the
 * SAME seven columns, the SAME whole-row click, pagination and responsive horizontal scroll. The
 * column definitions and the `lib/table` recipe are reused rather than re-derived, because a second,
 * subtly different footprint table is exactly the drift this WP forbids.
 *
 * Preserved verbatim from `ScansTab`, and each for a reason worth restating:
 *
 * • **"Tool tokens", never a bare "Tokens" (T10).** `ScanSummary.totalTokens` is TOOLS-ONLY, while
 *   the Overview's `StartupCostTile` headline is tools + resources + prompts. Two different
 *   quantities under one label is the collision T10 removed; the header names its scope so the two
 *   can never be read as the same number.
 * • **Δ vs previous comes from the app's ONE delta authority** (`buildScanDeltaIndex` — successful
 *   scans only, so a footprint is never diffed against a 0-tool failed scan). A server on its first
 *   successful scan renders an em dash, not a zero.
 * • **The excluded-servers footnote (D3).** The table lists only servers WITH a successful scan, so
 *   it names how many are missing rather than letting the fleet look smaller than it is. That is the
 *   only reason this tile takes `servers` at all.
 *
 * ── SIZING: WHY THERE IS A ROW SPAN ──────────────────────────────────────────────────────────────
 * `BentoGrid` is `auto-rows-[14rem]` and `BentoGridItem` is `overflow-hidden`, so a full-width tile
 * left at one row is a 224 px box — about three table rows before the rest is silently clipped. The
 * tile therefore claims a second row as soon as it has more than three rows to show, and the table
 * body is a bounded scroll region inside it either way, so content is never cut off. `col: 4` (the
 * full width the owner asked for) is unconditional; only the height responds to the data, so a
 * two-server fleet does not get a half-empty 29 rem box.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour;
 * reads in both themes.
 */
export type FootprintTableTileProps = {
  /** The app's server catalog — used ONLY for the "excluded from this table" footnote. */
  servers: ServerConfig[];
  /** The app's scan list — already in memory in `App.tsx`. */
  scans: ScanSummary[];
  /** Drill into a server. Wired from the Dashboard host. */
  onOpenServer: (serverId: string) => void;
};

/** More rows than this and the tile claims a second bento row (see "SIZING" above). */
const ROWS_BEFORE_SECOND_BENTO_ROW = 3;

/** One page of the footprint table, matching `ScansTab`'s page size exactly. */
const PAGE_SIZE = 10;

export function FootprintTableTile({ servers, scans, onOpenServer }: FootprintTableTileProps) {
  const rows = useMemo(() => rankedServerScans(scans), [scans]);
  const deltaIndex = useMemo(() => buildScanDeltaIndex(scans), [scans]);

  const columns: ColumnDef<ScanSummary>[] = useMemo(
    () => [
      navCol<ScanSummary>({
        id: "server",
        header: "Server",
        value: (row) => row.serverName,
        onSelect: (row) => onOpenServer(row.serverId),
        ariaLabel: (row) => `Open ${row.serverName}`,
        cell: (row) => <span className="block truncate font-medium">{row.serverName}</span>,
      }),
      col<ScanSummary>({
        id: "tools",
        header: "Tools",
        numeric: true,
        value: (row) => row.totalTools,
      }),
      col<ScanSummary>({
        // T10 — tools-only, and the header says so. See the module doc.
        id: "tokens",
        header: "Tool tokens",
        numeric: true,
        value: (row) => row.totalTokens,
      }),
      col<ScanSummary>({
        id: "delta",
        header: "Δ vs previous",
        numeric: true,
        value: (row) => scanDeltaFor(deltaIndex, row.id).deltaTokens ?? 0,
        cell: (row) => <ScanDeltaCell delta={scanDeltaFor(deltaIndex, row.id).deltaTokens} />,
      }),
      col<ScanSummary>({
        id: "largest",
        header: "Largest tool",
        value: (row) => row.largestToolName ?? "n/a",
      }),
      col<ScanSummary>({
        id: "lastScan",
        header: "Last scan",
        value: (row) => row.scannedAt,
        cell: (row) => formatDateTime(row.scannedAt),
      }),
      actionsCol<ScanSummary>({
        id: "open",
        header: "Open server",
        cell: (row) => (
          <IconButton
            variant="ghost"
            size="icon"
            onClick={() => onOpenServer(row.serverId)}
            label={`Open ${row.serverName}`}
          >
            <ChevronRight aria-hidden />
          </IconButton>
        ),
      }),
    ],
    [deltaIndex, onOpenServer],
  );

  // No successful scan anywhere — the bento must never render an empty box. The Overview's own
  // "nothing measured yet" panel owns that story.
  if (rows.length === 0) return null;

  const excluded = servers.length - rows.length;

  return (
    <BentoGridItem
      span={{ col: 4, row: rows.length > ROWS_BEFORE_SECOND_BENTO_ROW ? 2 : 1 }}
      className="gap-3 p-4"
    >
      <header className="flex min-w-0 items-center gap-2">
        <Table2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <SectionCardTitle className="min-w-0 truncate">Latest server footprint</SectionCardTitle>
      </header>
      {/* Bounded scroll region: the bento row height is fixed and the tile clips, so the BODY
          scrolls rather than the content being silently cut (`loading-states`/S22 scroll contract). */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {/* Whole-row click target (ui-wave U7) + `RESPONSIVE_TABLE_SCROLL_CLASS`, which keeps
            Δ vs previous / Largest tool / Last scan / Open server reachable below `lg` instead of
            silently clipped (P0 mobile audit T4). */}
        <DataTable
          data={rows}
          columns={columns}
          {...clickableRowTableProps(RESPONSIVE_TABLE_SCROLL_CLASS)}
          enablePagination={shouldPaginate(rows.length, PAGE_SIZE)}
          pageSize={PAGE_SIZE}
          initialView={{ sorting: [{ id: "tokens", desc: true }] }}
          emptyMessage="No completed scans yet."
        />
        {/* D3: the table lists only servers with a successful scan — name the excluded ones. */}
        {excluded > 0 ? (
          <Text variant="meta" tone="muted">
            {excluded === 1
              ? "1 server has no successful scan yet and is excluded above."
              : `${formatNumber(excluded)} servers have no successful scan yet and are excluded above.`}
          </Text>
        ) : null}
      </div>
    </BentoGridItem>
  );
}
