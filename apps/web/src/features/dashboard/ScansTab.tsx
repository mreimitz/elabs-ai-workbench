import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { DataTable, type ColumnDef } from "@elabs-ai/components-data";
import { Badge, Button, Card, CardContent, CardHeader, MetricCard, Text } from "@elabs-ai/components-ui";
import { MetricGrid } from "@elabs-ai/components-charts";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileText,
  GitCompareArrows,
  History,
  Library,
  MessageSquare,
  Play,
  Server,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { StatusBadge, CountBadge } from "../../components/StatusBadge";
import { IconButton } from "../../components/IconButton";
import { SectionCardTitle } from "../../components/SectionCardTitle";
import {
  buildScanDeltaIndex,
  diffVsPreviousHref,
  ScanDeltaCell,
  scanDeltaFor,
} from "../scans/scanDelta";
import {
  actionsCol,
  clickableRowTableProps,
  col,
  navCol,
  RESPONSIVE_TABLE_SCROLL_CLASS,
  shouldPaginate,
} from "../../lib/table";
import { formatDateTime, formatNumber } from "../../lib/format";

type AttentionRow = { server: ServerConfig; latest?: ScanSummary };

/** A server whose latest successful footprint scan landed AFTER the last visit — a "change". */
type Mover = {
  scan: ScanSummary;
  /** Token Δ vs the previous successful same-server scan; `null` when this is the first successful scan. */
  delta: number | null;
  prevScanId: string | null;
  /** No prior successful scan to diff against — this footprint is brand-new since last visit. */
  isNew: boolean;
};

/**
 * ScansTab — the Dashboard's scan-centric content (WP 2.1 extraction). This is the pre-WP-2.1
 * `DashboardView` body, moved VERBATIM into the "Scans" tab of the new tab host — no visual
 * redesign here (see `DashboardView.tsx` for the tab shell + the shared loading gate).
 *
 * `lastVisitAt` is read/stamped by the HOST (`DashboardView`), not here: Radix `TabPanel` content
 * unmounts on every tab switch (see `TabPanel.tsx`), so a per-tab `useState(() => readLastVisit())`
 * would reset the "since your last visit" window to ~0 every time the user tabs away to Testing and
 * back — a real regression the pre-WP-2.1 single-mount `DashboardView` never had. Keeping the read
 * + the one-time "stamp now" in the host (which stays mounted across tab switches) preserves the
 * original one-read-per-page-visit semantics exactly.
 */
export function ScansTab(props: {
  servers: ServerConfig[];
  scans: ScanSummary[];
  onOpenScan: (scanId: string) => void;
  onOpenServer: (serverId: string) => void;
  /** Run a scan for a server inline (wired from App.tsx). The attention list uses this for its Scan CTA (F1/D3). */
  onRunScan?: (serverId: string) => void;
  /** The "since your last visit" reference epoch-ms, owned by `DashboardView` — see the doc above. */
  lastVisitAt: number | null;
}) {
  const navigate = useNavigate();
  const { lastVisitAt } = props;

  const latestSuccessfulByServer = latestScansByServer(props.scans, "success");
  const latestAnyByServer = latestScansByServer(props.scans);
  const rankedServers = Array.from(latestSuccessfulByServer.values()).sort(
    (a, b) => b.totalTokens - a.totalTokens,
  );
  // Shared 3.1 delta index (Δ vs previous successful same-server scan) — reused for the footprint
  // column, the "since last visit" summary, and the biggest-movers list. Fully client-side.
  const deltaIndex = useMemo(() => buildScanDeltaIndex(props.scans), [props.scans]);

  const topToolScan = rankedServers
    .filter((scan) => scan.largestToolName)
    .sort((a, b) => b.largestToolTokens - a.largestToolTokens)[0];
  // Full startup footprint = tools + resources + prompts (totalTokens is TOOLS-ONLY).
  const totalStartupTokens = rankedServers.reduce(
    (sum, scan) => sum + scan.totalTokens + scan.totalResourceTokens + scan.totalPromptTokens,
    0,
  );
  // Resource/prompt surface across the same latest successful scans (resources incl. templates).
  const totalResources = rankedServers.reduce(
    (sum, scan) => sum + scan.totalResources + scan.totalResourceTemplates,
    0,
  );
  const totalPrompts = rankedServers.reduce((sum, scan) => sum + scan.totalPrompts, 0);
  const totalResourceTokens = rankedServers.reduce(
    (sum, scan) => sum + scan.totalResourceTokens,
    0,
  );
  const totalPromptTokens = rankedServers.reduce((sum, scan) => sum + scan.totalPromptTokens, 0);
  const totalTools = rankedServers.reduce((sum, scan) => sum + scan.totalTools, 0);
  const unscannedServerCount = props.servers.filter(
    (server) => !latestAnyByServer.has(server.id),
  ).length;
  const failedLatestCount = Array.from(latestAnyByServer.values()).filter(
    (scan) => scan.status === "failed",
  ).length;
  const attentionCount = unscannedServerCount + failedLatestCount;
  // Servers absent from the footprint table because they have no successful scan yet (D3 footnote).
  const excludedFromFootprint = props.servers.length - rankedServers.length;
  const recentScans = props.scans.slice(0, 8);
  const attentionRows: AttentionRow[] = props.servers
    .map((server) => ({ server, latest: latestAnyByServer.get(server.id) }))
    .filter((row) => !row.latest || row.latest.status === "failed");

  // Change window: latest successful scans that landed AFTER the last visit (G1 "lead with change").
  const changedSinceVisit: Mover[] =
    lastVisitAt === null
      ? []
      : rankedServers
          .filter((scan) => Date.parse(scan.scannedAt) > lastVisitAt)
          .map((scan) => {
            const info = scanDeltaFor(deltaIndex, scan.id);
            return {
              scan,
              delta: info.deltaTokens,
              prevScanId: info.prevScanId,
              isNew: info.prevScanId === null,
            };
          });
  // Biggest movers = the change window ranked by |token Δ| (new first-scans sort last — no magnitude yet).
  const movers = [...changedSinceVisit]
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
    .slice(0, 6);
  const grewCount = changedSinceVisit.filter((m) => (m.delta ?? 0) > 0).length;
  const shrankCount = changedSinceVisit.filter((m) => (m.delta ?? 0) < 0).length;
  const newlyScannedCount = changedSinceVisit.filter((m) => m.isNew).length;
  const netTokenDelta = changedSinceVisit.reduce((sum, m) => sum + (m.delta ?? 0), 0);
  const lastVisitLabel = lastVisitAt === null ? null : formatVisitDate(lastVisitAt);
  const isFirstVisit = lastVisitAt === null;

  const hasData = rankedServers.length > 0;

  const rankedColumns: ColumnDef<ScanSummary>[] = [
    navCol<ScanSummary>({
      id: "server",
      header: "Server",
      value: (row) => row.serverName,
      onSelect: (row) => props.onOpenServer(row.serverId),
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
      // T10: "Tokens" alone reads as the full footprint the KPI above states ("Total startup
      // tokens … Tools + resources + prompts") — but this column is `totalTokens`, which is
      // TOOLS-ONLY (see the comment on `totalStartupTokens` above). Renamed so the two figures
      // can never be read as the same quantity: this column is the tool surface only; the KPI
      // is tools + resources + prompts. One definition per label.
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
          onClick={() => props.onOpenServer(row.serverId)}
          label={`Open ${row.serverName}`}
        >
          <ChevronRight aria-hidden />
        </IconButton>
      ),
    }),
  ];

  const recentColumns: ColumnDef<ScanSummary>[] = [
    navCol<ScanSummary>({
      id: "server",
      header: "Server",
      value: (row) => row.serverName,
      onSelect: (row) => props.onOpenScan(row.id),
      ariaLabel: (row) => `Open scan of ${row.serverName}`,
      cell: (row) => <span className="block truncate font-medium">{row.serverName}</span>,
    }),
    col<ScanSummary>({
      id: "status",
      header: "Status",
      value: (row) => row.status,
      // D4 (via D-TB11): success renders as quiet muted text so the column reads as "what needs me",
      // not an all-green wall of decoration — expressed as StatusBadge's `quiet` prop, not an inline
      // exception, so StatusBadge stays the one status-chip renderer app-wide (audit D-3).
      cell: (row) => <StatusBadge status={row.status} quiet />,
    }),
    col<ScanSummary>({
      // T10: same rename as the footprint table above — `totalTokens` is tools-only, so the
      // header says so instead of colliding with the "Total startup tokens" KPI's broader
      // (tools + resources + prompts) definition.
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
          onClick={() => props.onOpenScan(row.id)}
          label={`Open scan of ${row.serverName}`}
        >
          <ChevronRight aria-hidden />
        </IconButton>
      ),
    }),
  ];

  // Toolbar tweak 2026-07-11 (owner): the Dashboard renders NO toolbar at all — its only action
  // ("View servers") duplicated the sidebar nav item, so the whole ViewToolbar row was removed.

  return (
    // The same `gap-6` rhythm `PageShell`'s own body div used to provide when this was the whole
    // page — reproduced here since ScansTab now mounts inside a `TabPanelContent` body instead.
    <div className="flex flex-col gap-6">
      {/* G1: lead with change & attention — the two operator questions ("did anything change?",
          "what needs me?") sit ABOVE the fold; inventory KPIs drop below. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* "Since your last visit" — the honest change summary (says "no changes" plainly). */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <SectionCardTitle>Since your last visit</SectionCardTitle>
            {lastVisitLabel ? (
              <Text variant="meta" tone="muted" className="whitespace-nowrap">
                Last visit {lastVisitLabel}
              </Text>
            ) : null}
          </CardHeader>
          <CardContent>
            {isFirstVisit ? (
              <div className="flex items-start gap-2 py-1 text-meta text-muted-foreground">
                <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  Welcome. Footprint changes to your servers will show up here on your next visit.
                </span>
              </div>
            ) : changedSinceVisit.length === 0 ? (
              <div className="flex items-center gap-2 py-1 text-meta text-muted-foreground">
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success-text" />
                <span>No changes since {lastVisitLabel}.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline gap-2">
                  <Text className="text-kpi font-semibold tabular-nums">
                    {formatNumber(changedSinceVisit.length)}
                  </Text>
                  <Text tone="muted">
                    {changedSinceVisit.length === 1 ? "server changed" : "servers changed"}
                  </Text>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
                  {grewCount > 0 ? (
                    <span className="tabular-nums">{formatNumber(grewCount)} grew</span>
                  ) : null}
                  {shrankCount > 0 ? (
                    <span className="tabular-nums">{formatNumber(shrankCount)} shrank</span>
                  ) : null}
                  {newlyScannedCount > 0 ? (
                    <span className="tabular-nums">
                      {formatNumber(newlyScannedCount)} newly scanned
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-meta">
                  <Text variant="meta" tone="muted">
                    Net token change
                  </Text>
                  <ScanDeltaCell delta={netTokenDelta} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* F1/G1: attention queue — unscanned + failed-latest servers with inline continuations. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <SectionCardTitle>Needs attention</SectionCardTitle>
            <CountBadge value={attentionCount} tone="warning" />
          </CardHeader>
          <CardContent>
            {attentionRows.length === 0 ? (
              <div className="flex items-center gap-2 py-1 text-meta text-muted-foreground">
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success-text" />
                <span>All configured servers have a successful latest scan.</span>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {attentionRows.map((row) => (
                  <li
                    key={row.server.id}
                    className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Text className="truncate font-medium">{row.server.name}</Text>
                      <Text variant="meta" tone="muted" className="truncate">
                        {row.latest?.status === "failed" && row.latest.errorMessage
                          ? row.latest.errorMessage
                          : row.latest?.status === "failed"
                            ? "Latest scan failed"
                            : "No scan yet"}
                      </Text>
                    </div>
                    <StatusBadge status={row.latest ? row.latest.status : "unscanned"} />
                    <div className="flex items-center gap-1">
                      {props.onRunScan ? (
                        <Button size="sm" onClick={() => props.onRunScan?.(row.server.id)}>
                          <Play aria-hidden />
                          <span>Scan now</span>
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onOpenServer(row.server.id)}
                      >
                        <span>Open</span>
                        <ChevronRight aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Biggest movers — the change window ranked by |token Δ|, each with a one-click diff. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <SectionCardTitle>Biggest movers</SectionCardTitle>
          <Text variant="meta" tone="muted" className="whitespace-nowrap">
            Largest token change{" "}
            {lastVisitLabel ? `since ${lastVisitLabel}` : "since your last visit"}
          </Text>
        </CardHeader>
        <CardContent>
          {movers.length === 0 ? (
            <div className="flex items-center gap-2 py-1 text-meta text-muted-foreground">
              <History aria-hidden className="size-4 shrink-0" />
              <span>
                {isFirstVisit
                  ? "Run or re-scan a server, then revisit to see which footprints moved most."
                  : `No footprint changes since ${lastVisitLabel}.`}
              </span>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {movers.map((mover) => (
                <li
                  key={mover.scan.id}
                  className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Text className="truncate font-medium">{mover.scan.serverName}</Text>
                    <Text variant="meta" tone="muted" className="tabular-nums">
                      {formatNumber(mover.scan.totalTokens)} tokens ·{" "}
                      {formatDateTime(mover.scan.scannedAt)}
                    </Text>
                  </div>
                  {mover.isNew ? (
                    <Badge variant="secondary" className="gap-1">
                      <Sparkles aria-hidden className="size-3" />
                      New
                    </Badge>
                  ) : (
                    <ScanDeltaCell delta={mover.delta} />
                  )}
                  <div className="flex items-center gap-1">
                    {mover.prevScanId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          navigate(
                            diffVsPreviousHref(
                              mover.scan.serverId,
                              mover.scan.id,
                              mover.prevScanId as string,
                            ),
                          )
                        }
                      >
                        <GitCompareArrows aria-hidden />
                        <span>Diff</span>
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onOpenServer(mover.scan.serverId)}
                    >
                      <span>Open</span>
                      <ChevronRight aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Inventory KPIs — the static fleet totals, now BELOW the change & attention lead (G1).
          D2: one metric per card so each figure is legible and comparable at a glance. */}
      <MetricGrid columns={4}>
        <MetricCard
          icon={<Server aria-hidden />}
          label="Servers"
          value={formatNumber(props.servers.length)}
        />
        <MetricCard
          icon={<Database aria-hidden />}
          label="Total startup tokens"
          value={hasData ? formatNumber(totalStartupTokens) : "n/a"}
          description="Tools + resources + prompts, latest successful scans"
        />
        <MetricCard
          icon={<Library aria-hidden />}
          label="Resources"
          value={hasData ? formatNumber(totalResources) : "n/a"}
          description={
            hasData ? `${formatNumber(totalResourceTokens)} tokens` : "No completed scans"
          }
        />
        <MetricCard
          icon={<MessageSquare aria-hidden />}
          label="Prompts"
          value={hasData ? formatNumber(totalPrompts) : "n/a"}
          description={hasData ? `${formatNumber(totalPromptTokens)} tokens` : "No completed scans"}
        />
        <MetricCard
          icon={<AlertTriangle aria-hidden />}
          label="Unscanned"
          value={formatNumber(unscannedServerCount)}
          description="Servers with no scan yet"
        />
        <MetricCard
          icon={<XCircle aria-hidden />}
          label="Failed"
          value={formatNumber(failedLatestCount)}
          description="Servers whose latest scan failed"
        />
        <MetricCard
          icon={<Wrench aria-hidden />}
          label="Largest single tool"
          value={topToolScan ? formatNumber(topToolScan.largestToolTokens) : "n/a"}
          description={topToolScan?.largestToolName ?? "No completed scans"}
        />
        <MetricCard
          icon={<FileText aria-hidden />}
          label="Tools scanned"
          value={hasData ? formatNumber(totalTools) : "n/a"}
          description="Across latest successful scans"
        />
      </MetricGrid>

      <Card>
        <CardHeader>
          <SectionCardTitle>Latest server footprint</SectionCardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx). P0 mobile audit
              T4: RESPONSIVE_TABLE_SCROLL_CLASS keeps Δ vs previous / Largest tool / Last scan / Open
              server reachable below `lg` instead of silently clipped. */}
          <DataTable
            data={rankedServers}
            columns={rankedColumns}
            {...clickableRowTableProps(RESPONSIVE_TABLE_SCROLL_CLASS)}
            enablePagination={shouldPaginate(rankedServers.length, 10)}
            pageSize={10}
            initialView={{ sorting: [{ id: "tokens", desc: true }] }}
            emptyMessage="No completed scans yet."
          />
          {/* D3: the table lists only servers with a successful scan — name the excluded ones. */}
          {excludedFromFootprint > 0 ? (
            <Text variant="meta" tone="muted">
              {excludedFromFootprint === 1
                ? "1 server has no successful scan yet and is excluded above."
                : `${formatNumber(excludedFromFootprint)} servers have no successful scan yet and are excluded above.`}
            </Text>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionCardTitle>Recent scan activity</SectionCardTitle>
        </CardHeader>
        <CardContent>
          {/* ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx). P0 mobile audit T4. */}
          <DataTable
            data={recentScans}
            columns={recentColumns}
            {...clickableRowTableProps(RESPONSIVE_TABLE_SCROLL_CLASS)}
            emptyMessage="No scan activity yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Short, human date for the "since <date>" copy (e.g. "Jul 4"). */
function formatVisitDate(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(epochMs),
  );
}

function latestScansByServer(scans: ScanSummary[], status?: ScanSummary["status"]) {
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
