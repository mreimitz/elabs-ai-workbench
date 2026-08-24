import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CompatibilityTestReport,
  RunFilter,
  RunMetricsResponse,
  PromptScan,
  ResourceScan,
  ScanDetail,
  ScanSummary,
  ServerConfig,
  ServerType,
  ToolFindingsReport,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { DataTable, SearchInput, type ColumnDef } from "@elabs-ai/components-data";
import { AreaChart, Area, Grid, Sparkline, XAxis, ChartTooltip } from "@elabs-ai/components-charts";
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  toast,
} from "@elabs-ai/components-ui";
import {
  Box,
  FileText,
  GitCompareArrows,
  MoreHorizontal,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  Wand2,
  Wifi,
} from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { SplitPane, SplitPanePanel } from "../../components/SplitPane";
import { TabPanel, TabPanelContent } from "../../components/TabPanel";
import { TabEmptyState } from "../../components/TabEmptyState";
import { TokenDistribution, type ContributorRow } from "../../components/TokenViz";
import { IconButton } from "../../components/IconButton";
import { AdvisorPanel } from "../advisor/AdvisorPanel";
import { advisorReportHref } from "../advisor/advisor-format";
import { SectionCardTitle } from "../../components/SectionCardTitle";
import { serverHealth } from "../../lib/optimize";
import {
  actionsCol,
  clickableRowTableProps,
  col,
  navCol,
  rowMenuTriggerClass,
  shouldPaginate,
} from "../../lib/table";
import { KpiStat } from "../../components/KpiStat";
import { InlineError } from "../../components/InlineError";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmDialog } from "../../components/dialogs";
import { loadableData, useLoadable } from "../../lib/loadable";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { promptColumns, resourceColumns } from "../scans/resourcePromptColumns";
import { apiDelete, getRunMetrics, getServerTests, getToolFindings } from "../../lib/api";
import { PromptGetDialog, ResourceReadDialog } from "../scans/ResourcePromptRun";
import { ToolDetailPanel } from "../scans/ToolDetailPanel";
import {
  buildScanDeltaIndex,
  diffVsPreviousHref,
  ScanDeltaCell,
  scanDeltaFor,
} from "../scans/scanDelta";
import { ServerFindings, ServerTestsTab } from "../compatibility/CompatibilityTests";
import { IssuesPanel } from "../issues/IssuesPanel";
import { OpenIssuesCard } from "../issues/OpenIssuesCard";
import { useRatingIssues } from "../issues/use-rating-issues";
import { activityBars } from "./activity-bars";
import { ServerTypeStatusBadge } from "./ServerTypeStatusBadge";
import { ServerBreadcrumbSwitcher } from "./ServerBreadcrumbSwitcher";
import { useSetBreadcrumbSlot } from "../../components/breadcrumb-slot";
import { notifyError } from "../../lib/notify";

type ToolRow = { tool: ToolScan };

export function ServersView(props: {
  /** Per-action busy predicate keyed by `action:entity` (e.g. `server:scan:<id>`). */
  isBusy: (key: string) => boolean;
  /** True until the app's first data fetch settles — show loading, not "no server selected". */
  initialLoading?: boolean;
  latestScan: ScanDetail | null;
  scanHistory: ScanSummary[];
  selectedServer: ServerConfig | null;
  /** The whole fleet — feeds the breadcrumb-leaf server switcher (RM-32 D-OD5), nothing else. */
  servers: ServerConfig[];
  /** Latest scan per server — the switcher rows' health chips. */
  latestScansByServer: Map<string, ScanSummary>;
  /** Server types (planning/Roadmap/completed/RM-21-server-types) — resolves the selected server's type for the toolbar +
   *  profile badges. Defaults to none. */
  serverTypes?: ServerType[];
  onAddServer: () => void;
  onEditServer: (server: ServerConfig) => void;
  onExportReport: (scan: ScanDetail) => void;
  onRunScan: (serverId: string) => void;
  onTestServer: (serverId: string) => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const server = props.selectedServer;
  const latestScan = props.latestScan;

  // SV8: scan delete. `DELETE /api/scans/:id` is owned here; deleted rows hide optimistically until the
  // app's next data refresh (the parent owns `scanHistory`), so the table reflects the delete at once.
  const [pendingDeleteScan, setPendingDeleteScan] = useState<ScanSummary | null>(null);
  const [deletingScan, setDeletingScan] = useState(false);
  const [deletedScanIds, setDeletedScanIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setDeletedScanIds(new Set());
  }, [props.selectedServer?.id]);

  // Resource read / prompt get consoles — targeted row + open flag.
  const [readResource, setReadResource] = useState<ResourceScan | null>(null);
  const [readOpen, setReadOpen] = useState(false);
  const [getPrompt, setGetPrompt] = useState<PromptScan | null>(null);
  const [getOpen, setGetOpen] = useState(false);
  // #13 fix: tool selection is SCOPED to this server's latest scan (not a global lifted state that
  // could point at a different server's tool). Keyed by tool id within `latestScan`, reset when the
  // scan changes — so `ToolDetailPanel`'s Run always targets THIS server.
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedToolId(null);
  }, [latestScan?.id]);
  const selectTool = (tool: ToolScan) => setSelectedToolId(tool.id);

  const resourceCols = useMemo(
    () =>
      resourceColumns((resource) => {
        setReadResource(resource);
        setReadOpen(true);
      }),
    [],
  );
  const promptCols = useMemo(
    () =>
      promptColumns((prompt) => {
        setGetPrompt(prompt);
        setGetOpen(true);
      }),
    [],
  );

  const tools = useMemo(() => latestScan?.tools ?? [], [latestScan]);
  const resources = useMemo(() => latestScan?.resources ?? [], [latestScan]);
  const prompts = useMemo(() => latestScan?.prompts ?? [], [latestScan]);
  const health = useMemo(() => serverHealth(latestScan), [latestScan]);
  const toolsByName = useMemo(() => new Map(tools.map((t) => [t.toolName, t] as const)), [tools]);

  // Tool-level findings (one engine run) power BOTH the Overview findings and the Issues column.
  // Modeled as loading | error | data so a fetch FAILURE reads as "couldn't load findings" (with a
  // retry), NOT as "no issues" — the previous `catch(() => setToolFindings(null))` conflated the two.
  const scanId = latestScan?.id ?? null;
  const { state: findingsState, reload: reloadFindings } = useLoadable<ToolFindingsReport>(
    () => getToolFindings(scanId as string),
    [scanId],
    { enabled: scanId !== null },
  );
  const toolFindings = loadableData(findingsState) ?? null;

  // SV7: the Tests tab count — server-level compatibility test entries applied to this scan (the same
  // set the Tests tab renders). Undefined while loading so the strip shows no count until it's known.
  const { state: serverTestsState } = useLoadable<CompatibilityTestReport>(
    () => getServerTests(scanId as string),
    [scanId],
    { enabled: scanId !== null },
  );
  const testsCount = loadableData(serverTestsState)?.entries.length;

  // Rating issues (auto-learning loop) — fetched at PAGE level (not inside the tab) so the tab strip
  // can badge the open count before the Issues tab is ever opened. `openCount` stays undefined while
  // loading, so the strip shows no count until it's known (same contract as `testsCount`).
  const {
    state: issuesState,
    reload: reloadIssues,
    openCount: openIssuesCount,
  } = useRatingIssues("mcp_server", server?.id ?? null);

  // Oldest → newest scan trend over the last N runs (successful scans carry token totals).
  const trend = useMemo(() => {
    return [...props.scanHistory]
      .filter((s) => s.status === "success")
      .sort((a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime())
      .slice(-8)
      .map((s) => ({ date: new Date(s.scannedAt), tokens: s.totalTokens, tools: s.totalTools }));
  }, [props.scanHistory]);
  const trendDelta = useMemo(() => {
    if (trend.length < 2) return null;
    const last = trend[trend.length - 1]?.tokens ?? 0;
    const prev = trend[trend.length - 2]?.tokens ?? 0;
    return last - prev;
  }, [trend]);

  // ── The KPI row's two activity bars ──────────────────────────────────────────────────────────
  // "Updates" comes from the scan history the page ALREADY holds — one bar per day, so a server
  // scanned twice on Tuesday reads as a taller Tuesday rather than two bars. "Usage" is the only
  // new request on this page: run counts filtered to this server. Both are counts, so an empty day
  // is genuinely 0 and zero-filling is the honest fill (unlike the level series elsewhere).
  const scanActivity = useMemo(
    () => activityBars(props.scanHistory.map((scan) => ({ at: scan.scannedAt, count: 1 }))),
    [props.scanHistory],
  );

  const runFilter = useMemo<RunFilter>(
    () => (server?.id ? { serverId: [server.id] } : {}),
    [server?.id],
  );
  const { state: runMetricsState } = useLoadable<RunMetricsResponse>(
    () => getRunMetrics({ filter: runFilter, bucket: "day", measures: ["count"] }),
    [runFilter],
    { enabled: server?.id != null },
  );
  const runActivity = useMemo(() => {
    const points = loadableData(runMetricsState)?.series.find((s) => s.measure === "count")?.points;
    return activityBars((points ?? []).map((p) => ({ at: p.bucketStart, count: p.value })));
  }, [runMetricsState]);

  const contributorRows: ContributorRow[] = useMemo(
    () =>
      [...tools]
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 8)
        .map((tool) => ({
          id: tool.id,
          label: tool.toolName,
          total: tool.totalTokens,
          percent: tool.contributionPercent,
          split: {
            name: tool.nameTokens,
            description: tool.descriptionTokens,
            schema: tool.schemaTokens,
            annotations: tool.annotationsTokens,
          },
        })),
    [tools],
  );

  const toolRows: ToolRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? tools.filter(
          (t) =>
            t.toolName.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
        )
      : tools;
    return base.map((tool) => ({ tool }));
  }, [tools, search]);

  const visibleScanHistory = useMemo(
    () => props.scanHistory.filter((s) => !deletedScanIds.has(s.id)),
    [props.scanHistory, deletedScanIds],
  );
  // Δ vs the previous successful scan of this server (WP 3.1 / G3) — from the FULL history so a
  // deleted-then-refreshed row can't skew the pairing. Powers the Δ column + "Diff vs previous".
  const scanDeltaIndex = useMemo(() => buildScanDeltaIndex(props.scanHistory), [props.scanHistory]);

  async function performScanDelete() {
    if (!pendingDeleteScan) return;
    const id = pendingDeleteScan.id;
    setDeletingScan(true);
    try {
      await apiDelete(`/api/scans/${id}`);
      setDeletedScanIds((prev) => new Set(prev).add(id));
      setPendingDeleteScan(null);
      toast.success("Scan deleted");
    } catch (err) {
      notifyError("Couldn’t delete the scan. Try again.", { description: getErrorMessage(err) });
    } finally {
      setDeletingScan(false);
    }
  }

  // RM-32 D-OD5 — the breadcrumb LEAF is the server switcher, replacing the deleted 288px rail.
  // Memoized per `breadcrumb-slot.tsx`'s contract: an unmemoized node re-fires the slot effect on
  // every render, which on a page that re-renders per streamed scan event would thrash the shell.
  const breadcrumbSwitcher = useMemo(
    () => (
      <ServerBreadcrumbSwitcher
        servers={props.servers}
        serverTypes={props.serverTypes ?? []}
        latestScansByServer={props.latestScansByServer}
        activeServer={server}
        onCreate={props.onAddServer}
      />
    ),
    [props.servers, props.serverTypes, props.latestScansByServer, server, props.onAddServer],
  );
  useSetBreadcrumbSlot(breadcrumbSwitcher);

  if (!server) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md">
          {props.initialLoading ? (
            <StatePanel kind="loading" title="Loading servers…" loadingLabel="Loading…" />
          ) : (
            // RM-32 D-OD1: `/servers` no longer redirects to the first server, so this branch now
            // means one specific thing — the URL names a server that isn't in the registry. Say that,
            // and give a way back, rather than the old "nothing selected" copy (which described a
            // state that can no longer happen).
            <StatePanel
              kind="error"
              title="Server not found"
              description="This server isn’t in the registry — it may have been deleted, or the address may be mistyped."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => navigate("/servers")}>
                    All servers
                  </Button>
                  <Button onClick={props.onAddServer}>Add server</Button>
                </div>
              }
            />
          )}
        </div>
      </div>
    );
  }

  const endpoint =
    server.transport === "stdio"
      ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
      : server.url;
  const selectedTool = tools.find((t) => t.id === selectedToolId) ?? latestScan?.tools[0] ?? null;
  const busyScan = props.isBusy(`server:scan:${server.id}`);
  const busyTest = props.isBusy(`server:test:${server.id}`);
  const authLabel = server.authType === "none" ? "No auth" : server.authType;
  // The selected server's resolved type (planning/Roadmap/completed/RM-21-server-types). A dangling `typeId` (its type was
  // deleted out from under it) resolves to null and reads as Untyped — never a crash.
  const serverType = server.typeId
    ? ((props.serverTypes ?? []).find((type) => type.id === server.typeId) ?? null)
    : null;
  const showRecoverable = !!health && health.recoverable > 0;

  function inspectToolById(toolId: string) {
    const tool = tools.find((t) => t.id === toolId);
    if (tool) {
      selectTool(tool);
      setTab("tools");
    }
  }

  // Jump from a finding's affected-tool link straight to that tool's detail (Tools tab → select).
  function openToolByName(toolName: string) {
    const tool = tools.find((t) => t.toolName === toolName);
    if (tool) {
      selectTool(tool);
      setTab("tools");
    }
  }

  // SV4: PRIORITY columns only (name + tokens + share) so the narrow inventory pane never clips the
  // numbers; single-line truncating rows (no reserved second line); the issues/cost-weight signals
  // live in the detail panel + Overview, not this narrow list.
  const toolColumns: ColumnDef<ToolRow>[] = [
    navCol<ToolRow>({
      id: "name",
      header: "Tool",
      value: (row) => row.tool.toolName,
      onSelect: (row) => selectTool(row.tool),
      isActive: (row) => selectedTool?.id === row.tool.id,
      ariaLabel: (row) => `Inspect ${row.tool.toolName}`,
      cell: (row) => (
        <span className="w-full truncate font-mono" title={row.tool.toolName}>
          {row.tool.toolName}
        </span>
      ),
    }),
    col<ToolRow>({
      id: "tokens",
      header: "Tokens",
      numeric: true,
      value: (row) => row.tool.totalTokens,
    }),
    col<ToolRow>({
      id: "share",
      header: "%",
      numeric: true,
      value: (row) => row.tool.contributionPercent,
      cell: (row) => formatPercent(row.tool.contributionPercent),
    }),
  ];

  // SV8: rows open the scan; the actions column deletes with a confirm. Name column doubles as the
  // full-cell click target (navCol) — DataTable has no onRowClick.
  const historyColumns: ColumnDef<ScanSummary>[] = [
    navCol<ScanSummary>({
      id: "date",
      header: "Date",
      value: (row) => row.scannedAt,
      onSelect: (row) => navigate(`/scans/${row.id}`),
      ariaLabel: (row) => `Open scan from ${formatDateTime(row.scannedAt)}`,
      cell: (row) => <span className="truncate tabular-nums">{formatDateTime(row.scannedAt)}</span>,
    }),
    col<ScanSummary>({
      id: "status",
      header: "Status",
      value: (row) => row.status,
      cell: (row) => <StatusBadge status={row.status} />,
    }),
    col<ScanSummary>({
      id: "tools",
      header: "Tools",
      numeric: true,
      value: (row) => row.totalTools,
    }),
    col<ScanSummary>({
      id: "tokens",
      header: "Tokens",
      numeric: true,
      value: (row) => row.totalTokens,
    }),
    // G3/S20: "did it grow since last time?" answered in-place — Δ vs this server's previous
    // successful scan (null / em dash for its first scan).
    col<ScanSummary>({
      id: "delta",
      header: "Δ vs previous",
      numeric: true,
      value: (row) => scanDeltaFor(scanDeltaIndex, row.id).deltaTokens ?? Number.NEGATIVE_INFINITY,
      cell: (row) => <ScanDeltaCell delta={scanDeltaFor(scanDeltaIndex, row.id).deltaTokens} />,
    }),
    col<ScanSummary>({
      id: "largest",
      header: "Largest tool",
      value: (row) => row.largestToolName ?? "n/a",
    }),
    actionsCol<ScanSummary>({
      header: "Actions",
      cell: (row) => {
        const prevScanId = scanDeltaFor(scanDeltaIndex, row.id).prevScanId;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* ui-wave U7 (owner feedback): quiet ghost trigger, revealed on row hover/focus;
                  stopPropagation keeps the click out of the row-level navigation delegation. */}
              <IconButton
                size="icon-sm"
                variant="ghost"
                className={rowMenuTriggerClass}
                onClick={(event) => event.stopPropagation()}
                label={`Actions for scan ${formatDateTime(row.scannedAt)}`}
              >
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/scans/${row.id}`)}>
                <FileText aria-hidden />
                <span>Open scan</span>
              </DropdownMenuItem>
              {/* G3: one click to a pre-filled diff of this scan vs its previous successful scan.
                  Absent for a first-ever scan (nothing earlier to diff against). */}
              {prevScanId ? (
                <DropdownMenuItem
                  onSelect={() => navigate(diffVsPreviousHref(row.serverId, row.id, prevScanId))}
                >
                  <GitCompareArrows aria-hidden />
                  <span>Diff vs previous</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setPendingDeleteScan(row)}
              >
                <Trash2 aria-hidden />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ];

  return (
    // TB.2 — the server-detail view mounts the app-level PageShell (width="master-detail") with the
    // shared ONE-row `ViewToolbar` in the `headerVariant="toolbar"` slot (toolbar standard 2026-07-11).
    // D-TB1: the server NAME is gone from the page — the AppShell breadcrumb leaf (App.tsx) owns page
    // identity; a body `sr-only` <h1> keeps the page a named heading for assistive tech. The 288px
    // RM-32 WP 2.1 — there is no longer a 288px list rail beside this pane: the fleet lives on the
    // `/servers` overview and switching servers is the breadcrumb-leaf popover this view contributes.
    // `width="master-detail"` is kept as the recorded ARCHETYPE (it resolves to full width, same as
    // "full"), so the intent stays legible even though the sibling structure is gone.
    // WP 6.1 — `scroll="fill"`: the content region fills the viewport and does NOT scroll itself, so
    // the toolbar row + tab strip stay FIXED and ONLY the active tab's body scrolls. The fill mode
    // lays the content body out as a height-filling flex column, so the single flex child (the
    // TabPanel, `flex-1 min-h-0`) owns its own scroll (audit §S22).
    <PageShell
      width="master-detail"
      scroll="fill"
      headerVariant="toolbar"
      header={
        <ViewToolbar
          // Left cluster (D-TB2): last-scan StatusBadge · transport/auth chips · the endpoint as a
          // truncating muted meta. Never wraps — the endpoint child collapses (`min-w-0 truncate`).
          left={
            <>
              {/* SV6: this badge is the LAST SCAN outcome, not live health — the tooltip says so, so
                  a green "Completed" can't be misread as "server reachable right now". */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <StatusBadge status={latestScan ? latestScan.status : "unscanned"} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {latestScan
                    ? `Last scan · ${latestScan.status} — reflects the last scan, not live connectivity.`
                    : "This server has not been scanned yet."}
                </TooltipContent>
              </Tooltip>
              {/* Transport / auth / type NAME are plain facts, not states, so they read as labelled
                  text rather than chips. Six outline badges in a row made the strip look like a
                  status readout in which nothing was actually a status — and the same six facts were
                  then repeated in the page body. Only the two real STATES keep a badge: the last
                  scan's outcome above, and the server type's lifecycle below. */}
              <ToolbarFact label="Transport">{server.transport}</ToolbarFact>
              <ToolbarFact label="Auth">{authLabel}</ToolbarFact>
              {serverType ? (
                <ToolbarFact label="Type">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{serverType.name}</span>
                    <ServerTypeStatusBadge status={serverType.status} />
                  </span>
                </ToolbarFact>
              ) : null}
              {/* Stated only when there ARE secrets. "none" is the ordinary case and says nothing;
                  "this server holds credentials" is worth a glance. Values are never shown. */}
              {server.hasEnvSecrets || server.hasHeaderSecrets ? (
                <ToolbarFact label="Secrets">
                  {[server.hasEnvSecrets ? "env" : null, server.hasHeaderSecrets ? "headers" : null]
                    .filter(Boolean)
                    .join(", ")}
                </ToolbarFact>
              ) : null}
              <Text variant="meta" tone="muted" className="min-w-0 truncate font-mono">
                {endpoint || "No endpoint configured."}
              </Text>
            </>
          }
          actions={
            // S6: Scan — the app's single most important action — is a LABELLED primary button;
            // the rest (edit / test / report) stay as icon buttons with tooltips.
            <>
              <Button disabled={busyScan} onClick={() => props.onRunScan(server.id)}>
                <Play aria-hidden />
                <span>{busyScan ? "Scanning…" : "Scan now"}</span>
              </Button>
              <ButtonGroup>
                <IconButton
                  variant="outline"
                  size="icon"
                  label="Edit server"
                  onClick={() => props.onEditServer(server)}
                >
                  <Pencil aria-hidden />
                </IconButton>
                <IconButton
                  variant="outline"
                  size="icon"
                  label="Test connection"
                  disabled={busyTest}
                  disabledReason="Testing…"
                  onClick={() => props.onTestServer(server.id)}
                >
                  <Wifi aria-hidden />
                </IconButton>
                <IconButton
                  variant="outline"
                  size="icon"
                  label="Export report"
                  disabled={!latestScan || latestScan.status !== "success"}
                  disabledReason="Run a successful scan first to export a report."
                  onClick={() => latestScan && props.onExportReport(latestScan)}
                >
                  <FileText aria-hidden />
                </IconButton>
              </ButtonGroup>
            </>
          }
        />
      }
    >
      {/* D-TB1 — the breadcrumb (Servers › <name>) names the page; keep the H1 for AT only. */}
      <Heading level={1} className="sr-only">
        {server.name}
      </Heading>
      <TabPanel
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          {
            value: "tests",
            label: "Tests",
            disabled: !latestScan,
            count: latestScan ? testsCount : undefined,
          },
          { value: "tools", label: "Tools", count: latestScan ? latestScan.totalTools : undefined },
          {
            value: "resources",
            label: "Resources",
            count: latestScan ? resources.length : undefined,
          },
          { value: "prompts", label: "Prompts", count: latestScan ? prompts.length : undefined },
          { value: "scans", label: "Scans", count: visibleScanHistory.length },
          {
            value: "issues",
            label: "Issues",
            // Open-count badge only when > 0 — a clean server's Issues tab carries no number.
            count: openIssuesCount && openIssuesCount > 0 ? openIssuesCount : undefined,
          },
          // Advisor (planning/Roadmap/RM-01-advisor/ WP 1.3) — the inline recommendation panel for THIS server.
          // Deliberately un-counted: a count would force the report to be fetched on every server
          // page load just to badge a tab nobody opened.
          { value: "advisor", label: "Advisor" },
        ]}
      >
        {/* ── TESTS — server-level compatibility tests × models (flat) ── */}
        <TabPanelContent value="tests">
          {latestScan ? (
            <ServerTestsTab scanId={latestScan.id} onOpenTool={openToolByName} />
          ) : (
            <NoScan onRunScan={() => props.onRunScan(server.id)} />
          )}
        </TabPanelContent>

        {/* ── OVERVIEW — multi-panel composition, so cards are allowed ── */}
        <TabPanelContent value="overview">
          {!latestScan ? (
            <NoScan onRunScan={() => props.onRunScan(server.id)} />
          ) : (
            <div className="flex flex-col gap-4 pb-1">
              {/* D-TB4 — the scan-result headline metrics, stated ONCE here in the Overview body as
                  content (they were the removed chrome stat strip). Tools/Resources/Prompts counts are
                  NOT restated — they already live in the tab badges; Recoverable is stated only here
                  (its former Findings-card badge was dropped so no number appears twice).

                  The connection facts are NOT restated here. They live in the page toolbar, once —
                  an earlier pass put them on a second line of this block and the result said
                  transport, auth, type and URL twice on one screen. What this row adds beside the
                  figures is the two things the toolbar cannot carry: when the server was last
                  touched, and how much it has actually been used. */}
              <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-md border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <KpiStat label="Startup tokens" value={formatNumber(latestScan.totalTokens)} />
                  <KpiStat
                    label="Top 3 share"
                    value={health ? formatPercent(health.topShare) : "—"}
                  />
                  {showRecoverable ? (
                    <KpiStat label="Recoverable" value={formatNumber(health!.recoverable)} />
                  ) : null}
                </div>
                {/* The three figures above are the headline; these three are context, so they sit at
                    the INLINE rung. A timestamp rendered at the 32px KPI size out-shouted every
                    number beside it — it is the least urgent thing in the row. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <MiniBars
                    emptyLabel="none yet"
                    label="Runs"
                    total={runActivity.total}
                    values={runActivity.values}
                  />
                  <MiniBars
                    emptyLabel="none yet"
                    label="Scans"
                    total={scanActivity.total}
                    values={scanActivity.values}
                  />
                  <KpiStat
                    label="Updated"
                    orientation="inline"
                    value={formatDateTime(server.updatedAt)}
                  />
                </div>
              </div>

              {/* The two time series, side by side and FIRST — token footprint over scans, and open
                  issues over days. Both are `h-44`, so the row has one height and no card is stretched
                  to match a neighbour. */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="flex min-w-0 flex-col">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <SectionCardTitle>Scan trend</SectionCardTitle>
                        <CardDescription>
                          Total startup tokens across recent successful scans.
                        </CardDescription>
                      </div>
                      {trendDelta != null ? (
                        <Badge
                          variant={
                            trendDelta > 0 ? "warning" : trendDelta < 0 ? "success" : "secondary"
                          }
                          className="tabular-nums"
                        >
                          {trendDelta >= 0 ? "+" : "−"}
                          {formatNumber(Math.abs(trendDelta))} vs prev
                        </Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col">
                    {trend.length > 1 ? (
                      <div className="min-h-44 w-full min-w-0 flex-1">
                        <AreaChart
                          data={trend}
                          xDataKey="date"
                          aspectRatio="auto"
                          className="h-full w-full"
                          accessibleLabel="Startup tokens across recent scans"
                        >
                          <Grid horizontal />
                          <Area
                            dataKey="tokens"
                            stroke="var(--chart-1)"
                            fill="var(--chart-1)"
                            fillOpacity={0.25}
                          />
                          <XAxis />
                          <ChartTooltip />
                        </AreaChart>
                      </div>
                    ) : (
                      <StatePanel
                        kind="empty"
                        title="Not enough history"
                        description="Run at least two scans to chart this server's token trend."
                      />
                    )}
                  </CardContent>
                </Card>

                <OpenIssuesCard onReload={reloadIssues} state={issuesState} />
              </div>

              {/* Findings (~60%) beside Token distribution (~40%) — ONE test-driven findings surface
                  (server-level tests + tool-level tests aggregated across tools, with tool links). */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <Card className="flex min-w-0 flex-col lg:col-span-3">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <SectionCardTitle>Findings</SectionCardTitle>
                        <CardDescription>
                          What breaks across models and where to recover tokens — most severe first.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setTab("tests")}>
                          View all tests
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col">
                    {findingsState.status === "error" ? (
                      <InlineError
                        title="Couldn’t load findings"
                        detail={findingsState.error}
                        onRetry={reloadFindings}
                      />
                    ) : (
                      <ServerFindings
                        scanId={latestScan.id}
                        toolFindings={toolFindings?.byTest ?? []}
                        toolsByName={toolsByName}
                        onOpenTool={openToolByName}
                      />
                    )}
                  </CardContent>
                </Card>

                <Card className="min-w-0 lg:col-span-2">
                  <CardHeader>
                    <SectionCardTitle>Token distribution</SectionCardTitle>
                    <CardDescription>
                      Where startup tokens go — by surface, and by part of a tool definition.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {health ? (
                      <TokenDistribution
                        facets={health.composition}
                        onSelect={inspectToolById}
                        rows={contributorRows}
                        surface={{
                          // `ScanSummary.totalTokens` is TOOLS ONLY (see its type comment) — the
                          // other two surfaces carry their own totals, so this is a real three-way
                          // split rather than a whole re-cut into parts.
                          tools: latestScan.totalTokens,
                          resources: latestScan.totalResourceTokens,
                          prompts: latestScan.totalPromptTokens,
                        }}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabPanelContent>

        {/* ── TOOLS — two-pane split (shared SplitPane recipe, S21.5) ──── */}
        <TabPanelContent value="tools" scroll={false}>
          {!latestScan ? (
            <NoScan onRunScan={() => props.onRunScan(server.id)} />
          ) : (
            <SplitPane
              handleLabel="Resize tool list and detail panels"
              startSize={32}
              startMinSize={22}
              endMinSize={40}
              start={
                <SplitPanePanel
                  title="Tool inventory"
                  count={toolRows.length}
                  countTotal={tools.length}
                  tone="muted"
                  bodyClassName="p-2"
                  search={
                    <SearchInput
                      value={search}
                      onValueChange={setSearch}
                      placeholder="Filter tools…"
                    />
                  }
                >
                  {/* ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx). */}
                  <DataTable
                    data={toolRows}
                    columns={toolColumns}
                    {...clickableRowTableProps()}
                    emptyMessage={search ? `No tools match “${search}”.` : "No tools in this scan."}
                  />
                </SplitPanePanel>
              }
              end={
                <SplitPanePanel title="Tool detail" bodyClassName="p-4">
                  {selectedTool ? (
                    <ToolDetailPanel
                      tool={selectedTool}
                      serverId={server.id}
                      tokenProfile={latestScan.tokenProfile}
                    />
                  ) : (
                    <StatePanel
                      kind="empty"
                      title="Select a tool"
                      description="Pick a tool from the list to inspect its breakdown, parameters, and run it."
                    />
                  )}
                </SplitPanePanel>
              }
            />
          )}
        </TabPanelContent>

        {/* ── RESOURCES — flat table (no lone wrapper card, S21.4) ────── */}
        <TabPanelContent
          value="resources"
          description="Resources and templates exposed by this server (definition footprint only)."
        >
          {!latestScan ? (
            <NoScan onRunScan={() => props.onRunScan(server.id)} />
          ) : resources.length === 0 ? (
            <TabEmptyState
              icon={<Box aria-hidden />}
              title="No resources"
              description="This server exposes no MCP resources."
            />
          ) : (
            <DataTable
              data={resources}
              columns={resourceCols}
              enablePagination={shouldPaginate(resources.length, 25)}
              pageSize={25}
              initialView={{ sorting: [{ id: "tokens", desc: true }] }}
              emptyMessage="No resources in this scan."
            />
          )}
        </TabPanelContent>

        {/* ── PROMPTS — flat table (no lone wrapper card, S21.4) ───────── */}
        <TabPanelContent
          value="prompts"
          description="Prompt definitions exposed by this server (definition footprint only)."
        >
          {!latestScan ? (
            <NoScan onRunScan={() => props.onRunScan(server.id)} />
          ) : prompts.length === 0 ? (
            <TabEmptyState
              icon={<FileText aria-hidden />}
              title="No prompts"
              description="This server exposes no MCP prompts."
            />
          ) : (
            <DataTable
              data={prompts}
              columns={promptCols}
              enablePagination={shouldPaginate(prompts.length, 25)}
              pageSize={25}
              initialView={{ sorting: [{ id: "tokens", desc: true }] }}
              emptyMessage="No prompts in this scan."
            />
          )}
        </TabPanelContent>

        {/* ── SCANS — flat table (no lone wrapper card, S21.4). SV8: rows open the scan, row menu deletes. ── */}
        <TabPanelContent
          value="scans"
          description="Recent scans for this server — open one for its full breakdown."
        >
          {/* ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx). */}
          <DataTable
            data={visibleScanHistory}
            columns={historyColumns}
            {...clickableRowTableProps()}
            enablePagination={shouldPaginate(visibleScanHistory.length, 25)}
            pageSize={25}
            emptyMessage="No scans recorded for this server."
          />
        </TabPanelContent>

        {/* ── ISSUES — deduplicated rating issues filed against this server (auto-learning loop) ── */}
        <TabPanelContent
          value="issues"
          description="Distinct problems that run ratings filed against this server, deduplicated across runs — resolve one here; it re-opens automatically if seen again."
        >
          <IssuesPanel
            targetKind="mcp_server"
            targetId={server.id}
            targetName={server.name}
            state={issuesState}
            onReload={reloadIssues}
          />
        </TabPanelContent>

        {/* ── ADVISOR — evidenced recommendations scoped to THIS server (advisor WP 1.3). ── */}
        <TabPanelContent
          value="advisor"
          description="Deterministic recommendations derived from this server's scans. Savings are estimates; nothing here is applied automatically."
        >
          <AdvisorPanel
            query={{ scope: "server", id: server.id }}
            scopeLabel={server.name}
            fullReportHref={advisorReportHref({ scope: "server", id: server.id })}
          />
        </TabPanelContent>
      </TabPanel>

      {/* resource read / prompt get consoles — keyed to the latest scan's server + token profile */}
      {latestScan && readResource ? (
        <ResourceReadDialog
          open={readOpen}
          onOpenChange={setReadOpen}
          serverId={server.id}
          uri={readResource.uri}
          tokenProfile={latestScan.tokenProfile}
        />
      ) : null}
      {latestScan && getPrompt ? (
        <PromptGetDialog
          open={getOpen}
          onOpenChange={setGetOpen}
          serverId={server.id}
          promptName={getPrompt.promptName}
          args={getPrompt.arguments}
          tokenProfile={latestScan.tokenProfile}
        />
      ) : null}

      {/* SV8: delete a scan behind a Tier-1 confirm (DELETE /api/scans/:id). */}
      <ConfirmDialog
        open={pendingDeleteScan !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteScan(null);
        }}
        tone="destructive"
        title="Delete this scan?"
        description={
          pendingDeleteScan
            ? `This permanently removes the scan from ${formatDateTime(pendingDeleteScan.scannedAt)}. This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete scan"
        busy={deletingScan}
        onConfirm={() => void performScanDelete()}
      />
    </PageShell>
  );
}

function NoScan({ onRunScan }: { onRunScan: () => void }) {
  return (
    <TabEmptyState
      title="No scan yet"
      description="Run a scan to collect this server's tools and token footprint."
      actions={<Button onClick={onRunScan}>Run scan</Button>}
    />
  );
}

/**
 * One `Label value` pair in the page toolbar.
 *
 * The toolbar used to state these as outline `Badge`s — six chips in a row, none of which was a
 * status. A chip reads as "this is a state worth noticing"; a transport name is not. The two real
 * states next to them (the last scan's outcome, the server type's lifecycle) keep their badges, and
 * now stand out because everything around them stopped shouting.
 */
function ToolbarFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <Text as="span" variant="meta" tone="muted">
        {label}
      </Text>
      <Text as="span" variant="meta" className="min-w-0 truncate">
        {children}
      </Text>
    </span>
  );
}

/**
 * A labelled count with a bar-per-day sparkline under it — the KPI row's "how much has this server
 * actually been used / re-measured" pair. Renders an honest empty state rather than a flat baseline,
 * because a row of zero-height bars and "never happened" look identical.
 */
function MiniBars({
  label,
  values,
  total,
  emptyLabel,
}: {
  label: string;
  values: number[];
  total: number;
  emptyLabel: string;
}) {
  if (values.length === 0) {
    return <KpiStat label={label} orientation="inline" value={emptyLabel} />;
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <KpiStat label={label} orientation="inline" value={formatNumber(total)} />
      <Sparkline
        className="h-6 w-24 shrink-0"
        label={`${label} over time, in ${values.length} equal slices of this server's history`}
        values={values}
        variant="bar"
      />
    </div>
  );
}
