import type { ScanSummary } from "@mcp-token-footprint/shared";
import { scanDeltaFor, type ScanDeltaInfo } from "../../../scans/scanDelta";

/**
 * scan-tile-data — the scan-derived arithmetic the four WP 2.1 bento tiles share.
 * =============================================================================================
 * Every function here is LIFTED VERBATIM (behaviour-for-behaviour) out of
 * `features/dashboard/ScansTab.tsx`, which WP 2.2 retires. It lives in one module rather than being
 * copied into each tile for the reason the WP spells out: "do not invent a second, subtly different
 * footprint table". The same argument applies to the figures — `InventoryTile`, `LargestToolTile`
 * and `FootprintTableTile` must all total the SAME server population, or the bento would state three
 * mutually inconsistent inventories of one fleet.
 *
 * Nothing here fetches, and nothing here is stateful: it is pure arithmetic over the `scans` array
 * `App.tsx` already holds in memory, exactly as `ScansTab` did.
 */

/** Most points a tile sparkline draws. Beyond this the mini box stops resolving individual
 *  snapshots, so the newest window is shown and the accessible label names how many.
 *  (Copied from `ScansTab.tsx`.) */
export const SPARKLINE_POINTS = 24;

/**
 * The latest scan of each server, newest first — optionally narrowed to one status.
 * Copied verbatim from `ScansTab.tsx`.
 */
export function latestScansByServer(
  scans: ScanSummary[],
  status?: ScanSummary["status"],
): Map<string, ScanSummary> {
  const latest = new Map<string, ScanSummary>();
  const sortedScans = [...scans].sort(
    (left, right) => Date.parse(right.scannedAt) - Date.parse(left.scannedAt),
  );
  for (const scan of sortedScans) {
    if (status && scan.status !== status) continue;
    if (!latest.has(scan.serverId)) latest.set(scan.serverId, scan);
  }
  return latest;
}

/**
 * The latest SUCCESSFUL scan of every server, ranked by tool-token footprint (biggest first) — the
 * exact population `ScansTab`'s `rankedServers` totalled, and the rows its footprint table listed.
 */
export function rankedServerScans(scans: ScanSummary[]): ScanSummary[] {
  return Array.from(latestScansByServer(scans, "success").values()).sort(
    (a, b) => b.totalTokens - a.totalTokens,
  );
}

/** How each trend-bearing figure reads itself off ONE scan. Declared once so a figure's value, its
 *  Δ and its sparkline are guaranteed to measure the same quantity (the T10 discipline: never let
 *  two figures on one tile denote different things). Copied from `ScansTab.tsx`. */
export const resourceCountOf = (scan: ScanSummary): number =>
  scan.totalResources + scan.totalResourceTemplates;
export const promptCountOf = (scan: ScanSummary): number => scan.totalPrompts;
export const toolCountOf = (scan: ScanSummary): number => scan.totalTools;

/** What one inventory figure can honestly say about its own trend. Copied from `ScansTab.tsx`. */
export type TileTrend = {
  /** Δ between the figure's CURRENT value and the same total at each server's PREVIOUS successful
   *  scan — computed over the SAME server population the value totals, so the two can only ever be
   *  read as one comparison. A server whose latest successful scan is its FIRST contributes its
   *  whole figure (it measured as nothing before); `firstTimeServers` discloses that on the tile.
   *  `null` when NO server has an earlier successful scan at all — nothing has been compared, so
   *  the tile renders no delta rather than a fabricated one. */
  delta: number | null;
  /** How many servers in that population are being measured for the first time. */
  firstTimeServers: number;
  /** The figure's own value recomputed after every successful scan in the retained history, oldest →
   *  newest. Empty below two points — a sparkline needs a real series or nothing. */
  series: number[];
};

export type TrendInputs = {
  scans: ScanSummary[];
  /** The latest SUCCESSFUL scan of each server — the same set the figures total. */
  latestByServer: ScanSummary[];
  deltaIndex: Map<string, ScanDeltaInfo>;
  scanById: Map<string, ScanSummary>;
};

/**
 * Trend for ONE inventory figure, derived entirely from the scan history already in memory.
 * Copied verbatim from `ScansTab.tsx`; its reasoning, restated because it is load-bearing:
 *
 * **Δ covers the same population as the value.** `buildScanDeltaIndex` pairs every successful scan
 * with the PREVIOUS successful scan of the SAME server and names it in `prevScanId` — that pairing
 * is the app's one delta authority and is reused verbatim here. Every server the figure totals then
 * contributes `now − before`, where `before` is its previous successful scan or, for a server
 * measured for the first time, **zero**. Summing only the servers that happen to HAVE a previous
 * scan would leave the Δ and the value covering different populations: add and scan a server (this
 * product's core workflow, and the most common way a footprint grows) and a fleet that went
 * 100 → 590 tools would render "↓ 10, favorable". The zero baseline keeps the arithmetic closed —
 * value − Δ is always the fleet's previous measured total.
 *
 * What this does NOT reuse is the index's `deltaTokens` figure: that is tools-only, and hanging it
 * under a resource or prompt COUNT would recreate precisely the label/definition collision T10
 * removed. The pairing is shared; each figure measures its own quantity across it.
 *
 * **The series is the figure's own value, recomputed after every scan.** Walk successful scans of
 * the tracked servers oldest → newest, keep each server's latest figure, and emit the running fleet
 * total after each one — a server not yet scanned counting as 0, the same convention the Δ uses. So
 * the last point always equals the figure's current value, and adding a server shows up as the step
 * it is instead of erasing the series at the very moment it matters most.
 */
export function buildTileTrend(
  inputs: TrendInputs,
  figureOf: (scan: ScanSummary) => number,
): TileTrend {
  const { scans, latestByServer, deltaIndex, scanById } = inputs;

  let delta = 0;
  let comparedServers = 0;
  let firstTimeServers = 0;
  for (const scan of latestByServer) {
    const { prevScanId } = scanDeltaFor(deltaIndex, scan.id);
    const previous = prevScanId ? scanById.get(prevScanId) : undefined;
    if (previous) comparedServers += 1;
    else firstTimeServers += 1;
    delta += figureOf(scan) - (previous ? figureOf(previous) : 0);
  }

  const trackedIds = new Set(latestByServer.map((scan) => scan.serverId));
  const series: number[] = [];
  if (trackedIds.size > 0) {
    const history = scans
      .filter((scan) => scan.status === "success" && trackedIds.has(scan.serverId))
      .sort((left, right) => Date.parse(left.scannedAt) - Date.parse(right.scannedAt));
    const current = new Map<string, number>();
    for (const scan of history) {
      current.set(scan.serverId, figureOf(scan));
      let total = 0;
      for (const value of current.values()) total += value;
      series.push(total);
    }
  }

  return {
    delta: comparedServers > 0 ? delta : null,
    firstTimeServers,
    series: series.length >= 2 ? series.slice(-SPARKLINE_POINTS) : [],
  };
}
