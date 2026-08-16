import type { ScanSummary } from "@mcp-token-footprint/shared";
import { cn, Text } from "@brand/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import { deltaTextTone } from "../../lib/delta";
import { formatNumber } from "../../lib/format";

/** What a scan changed versus the PREVIOUS successful same-server scan.
 *  `deltaTokens`/`prevScanId` are `null` when this is the server's first successful scan (nothing
 *  earlier to diff against). */
export type ScanDeltaInfo = {
  deltaTokens: number | null;
  prevScanId: string | null;
};

const NO_DELTA: ScanDeltaInfo = { deltaTokens: null, prevScanId: null };

/**
 * Index EVERY successful scan → its Δ (token) and the id of the PREVIOUS successful scan of the
 * SAME server (by scan time). Like-for-like: only successful scans participate, so a Δ never
 * compares a real footprint against a 0-tool failed scan. Fully client-side from the `/api/scans`
 * history (WP 3.1 — no API work: `ScanSummary` already carries `serverId`/`scannedAt`/`status`/
 * `totalTokens`). Non-successful scans get no entry (they have no meaningful footprint to diff).
 */
export function buildScanDeltaIndex(scans: ScanSummary[]): Map<string, ScanDeltaInfo> {
  const byServer = new Map<string, ScanSummary[]>();
  for (const scan of scans) {
    if (scan.status !== "success") continue;
    const bucket = byServer.get(scan.serverId) ?? [];
    bucket.push(scan);
    byServer.set(scan.serverId, bucket);
  }
  const index = new Map<string, ScanDeltaInfo>();
  for (const bucket of byServer.values()) {
    // oldest → newest, so each scan's predecessor is the row immediately before it.
    const sorted = [...bucket].sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
    for (let i = 0; i < sorted.length; i++) {
      const scan = sorted[i];
      if (!scan) continue;
      const prev = i > 0 ? sorted[i - 1] : undefined;
      index.set(scan.id, {
        deltaTokens: prev ? scan.totalTokens - prev.totalTokens : null,
        prevScanId: prev ? prev.id : null,
      });
    }
  }
  return index;
}

/** Read one scan's delta info (safe default for scans absent from the index). */
export function scanDeltaFor(index: Map<string, ScanDeltaInfo>, scanId: string): ScanDeltaInfo {
  return index.get(scanId) ?? NO_DELTA;
}

/** The compare deep-link that opens THIS scan diffed against its previous successful same-server
 *  scan: A = the earlier (baseline) scan, B = this (later) scan — so Δ reads as growth-since. */
export function diffVsPreviousHref(serverId: string, scanId: string, prevScanId: string): string {
  const params = new URLSearchParams({
    serverA: serverId,
    serverB: serverId,
    scanA: prevScanId,
    scanB: scanId,
  });
  return `/compare/scans?${params.toString()}`;
}

/**
 * A signed, tone-coded token delta cell (`Δ vs previous`), shared by the Scans list and the
 * server-detail Scans tab. Growth is amber (a magnitude warning — MORE tokens is worse), shrink is
 * green; a first-ever scan renders a muted em dash. The tone comes from the ONE delta authority
 * (`lib/delta.ts`, D-IC3 reaffirming D-UX9) — this cell was the reference the whole app converged
 * onto. Digits are `tabular-nums` so a column of them lines up.
 */
export function ScanDeltaCell({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <Text variant="meta" tone="muted">
        —
      </Text>
    );
  }
  if (delta === 0) {
    return <span className="tabular-nums text-muted-foreground">0</span>;
  }
  const grew = delta > 0;
  // More tokens is worse → the shared authority colours a positive Δ amber, a negative Δ green.
  return (
    <span
      className={cn(
        "inline-flex items-center justify-end gap-1 tabular-nums",
        deltaTextTone(delta, false),
      )}
    >
      {grew ? (
        <ArrowUp aria-hidden className="size-3" />
      ) : (
        <ArrowDown aria-hidden className="size-3" />
      )}
      {`${grew ? "+" : ""}${formatNumber(delta)}`}
    </span>
  );
}
