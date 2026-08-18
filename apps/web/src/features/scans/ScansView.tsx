import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  PromptScan,
  ResourceScan,
  ScanDetail,
  ScanSummary,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { ColumnPicker, DataTable, FacetFilter, SearchInput } from "@elabs-ai/components-data";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  MetricCard,
  ResizableHandle,
  ResizablePanel,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@elabs-ai/components-ui";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  Download,
  FileText,
  GitCompareArrows,
  Play,
} from "lucide-react";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { PageShell } from "../../components/PageShell";
import { ResultCount } from "../../components/ResultCount";
import { ViewToolbar } from "../../components/ViewToolbar";
import type { ActiveFilterChip } from "../../components/ViewToolbar";
import { TabPanel, TabPanelContent } from "../../components/TabPanel";
import { TabEmptyState } from "../../components/TabEmptyState";
import { clickableRowTableProps, col, navCol, stickyScrollTableProps } from "../../lib/table";
import { StatusBadge } from "../../components/StatusBadge";
import { formatBytes, formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { promptColumns, resourceColumns } from "./resourcePromptColumns";
import { PromptGetDialog, ResourceReadDialog } from "./ResourcePromptRun";
import { ToolDetailPanel } from "./ToolDetailPanel";
import { buildScanDeltaIndex, diffVsPreviousHref, ScanDeltaCell, scanDeltaFor } from "./scanDelta";

const STATUS_OPTIONS = [
  { label: "Success", value: "success" },
  { label: "Failed", value: "failed" },
  { label: "Running", value: "running" },
];

export function ScansView(props: {
  scans: ScanSummary[];
  selectedScan: ScanDetail | null;
  /**
   * interface-craft WP 4.3 FIX 1 (P0) — a settled failure loading the deep-linked `/scans/:scanId`
   * (App.tsx sets it). When set, the detail-pane fallback renders a TERMINAL error StatePanel +
   * "Back to scans" instead of the infinite loading pane. `null` = loading or loaded.
   */
  scanLoadError?: string | null;
  onLoadScan: (scanId: string) => void;
}) {
  const { selectedScan, scanLoadError, onLoadScan } = props;
  const navigate = useNavigate();
  // WP 4.2 (D-1) — Scans is a LIST-FIRST surface: you arrive at scan *history*, not a pre-selected
  // scan. So the view has two modes, driven by the URL (deep-linkable, matching App.tsx routing):
  //   • `/scans`        → `scanId` undefined → the history list is FULL-WIDTH (no empty detail pane
  //     squeezed beside a cramped rail; the Δ-vs-previous column finally has room to read).
  //   • `/scans/:scanId`→ `scanId` set → master-detail: the list narrows into a switcher rail and the
  //     selected scan's detail fills the pane. `useParams` (not `selectedScan != null`) is the mode
  //     signal so a fresh deep-link lands in detail mode immediately — no flash of the full-width list
  //     while `App.tsx` fetches the detail — and a mid-flight rail switch never shows a stale scan.
  const { scanId } = useParams<{ scanId: string }>();
  const inDetail = scanId != null;
  // Δ-vs-previous-successful-scan index (WP 3.1 / G3): keyed by scan id → { deltaTokens, prevScanId }.
  // Client-computed from the full history — powers both the Δ column and the "Diff vs previous"
  // deep link into Compare. Recomputes only when the scan list changes.
  const deltaIndex = useMemo(() => buildScanDeltaIndex(props.scans), [props.scans]);
  const openDiffVsPrevious = (scan: ScanSummary) => {
    const { prevScanId } = scanDeltaFor(deltaIndex, scan.id);
    if (!prevScanId) return;
    navigate(diffVsPreviousHref(scan.serverId, scan.id, prevScanId));
  };
  // #13 fix: tool selection is SCOPED to the displayed scan (not a global lifted state that could
  // point at another server's tool). It lives here, keyed by tool id within the current scan, and
  // resets when the scan changes — so `ToolDetailPanel`'s Run always targets THIS scan's server.
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedToolId(null);
  }, [selectedScan?.id]);
  const selectedTool: ToolScan | null =
    selectedScan?.tools.find((tool) => tool.id === selectedToolId) ??
    selectedScan?.tools[0] ??
    null;
  const onSelectTool = (tool: ToolScan) => setSelectedToolId(tool.id);
  const [historySearch, setHistorySearch] = useState("");
  const [serverFacet, setServerFacet] = useState<string[]>([]);
  const [statusFacet, setStatusFacet] = useState<string[]>([]);
  const [toolSearch, setToolSearch] = useState("");
  const [detailTab, setDetailTab] = useState("tools");
  const [sheetOpen, setSheetOpen] = useState(false);
  // Resource read / prompt get consoles — targeted row + open flag.
  const [readResource, setReadResource] = useState<ResourceScan | null>(null);
  const [readOpen, setReadOpen] = useState(false);
  const [getPrompt, setGetPrompt] = useState<PromptScan | null>(null);
  const [getOpen, setGetOpen] = useState(false);

  // `?tool=<toolName>` — the deep link an advisor `tool_scan` evidence ref resolves to (advisor
  // WP 1.3), so a citation of a TOOL lands on that tool rather than merely on its scan. Runs after
  // the reset effect above (declaration order), so a fresh scan's reset can't cancel it. Keyed to
  // the scan id + the param: closing the sheet does NOT re-open it, because neither dep changed.
  const [toolLinkParams] = useSearchParams();
  const deepLinkedToolName = toolLinkParams.get("tool");
  // Resolve FIRST, then react to the resolved id — not to the `selectedScan` object. A refetch that
  // produces an equivalent scan yields the same tool id, so the sheet is not re-opened behind a user
  // who just closed it. No match → null → nothing happens (a stale/renamed tool name must not open
  // an empty sheet).
  const deepLinkedToolId = useMemo(() => {
    if (!deepLinkedToolName || !selectedScan) return null;
    return selectedScan.tools.find((tool) => tool.toolName === deepLinkedToolName)?.id ?? null;
  }, [deepLinkedToolName, selectedScan]);
  useEffect(() => {
    if (!deepLinkedToolId) return;
    setSelectedToolId(deepLinkedToolId);
    setSheetOpen(true);
  }, [deepLinkedToolId]);

  function openTool(tool: ToolScan) {
    onSelectTool(tool);
    setSheetOpen(true);
  }

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

  // Facet option lists derive from the data so they only show servers that exist.
  const serverOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const scan of props.scans) names.set(scan.serverName, scan.serverName);
    return [...names.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  }, [props.scans]);

  const filteredScans = useMemo(() => {
    return props.scans.filter((scan) => {
      if (serverFacet.length > 0 && !serverFacet.includes(scan.serverName)) return false;
      if (statusFacet.length > 0 && !statusFacet.includes(scan.status)) return false;
      return true;
    });
  }, [props.scans, serverFacet, statusFacet]);

  // The text search was previously applied ONLY inside DataTable's `globalFilter`, so the
  // ResultCount (fed `filteredScans`) never saw it and announced the unfiltered total over a
  // filtered/empty table. Apply the same search here so the count and the table show ONE set —
  // matching the "Search server or date…" placeholder (server name · formatted date · status).
  const searchedScans = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return filteredScans;
    return filteredScans.filter(
      (scan) =>
        scan.serverName.toLowerCase().includes(q) ||
        formatDateTime(scan.scannedAt).toLowerCase().includes(q) ||
        scan.status.toLowerCase().includes(q),
    );
  }, [filteredScans, historySearch]);

  // Applied filters render as removable chips inline in the ViewToolbar left cluster (D-TB6).
  const activeFilters = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];
    for (const name of serverFacet) {
      chips.push({
        id: `server:${name}`,
        label: `Server: ${name}`,
        onRemove: () => setServerFacet((prev) => prev.filter((value) => value !== name)),
      });
    }
    for (const status of statusFacet) {
      const label = STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
      chips.push({
        id: `status:${status}`,
        label: `Status: ${label}`,
        onRemove: () => setStatusFacet((prev) => prev.filter((value) => value !== status)),
      });
    }
    return chips;
  }, [serverFacet, statusFacet]);

  const clearAllFilters = () => {
    setServerFacet([]);
    setStatusFacet([]);
  };

  const historyColumns = useMemo(
    () => [
      navCol<ScanSummary>({
        id: "server",
        header: "Server",
        value: (row) => `${row.serverName} ${formatDateTime(row.scannedAt)}`,
        onSelect: (row) => onLoadScan(row.id),
        isActive: (row) => selectedScan?.id === row.id,
        ariaLabel: (row) => `Open scan of ${row.serverName}`,
        // The narrow master list folds the scan date AND the absolute token total into a muted
        // subline so the row stays compact and the panel holds the Δ column + diff action without
        // clipping (G3: the row's question is *relative* — "did it grow?" — so Δ leads and the
        // absolute count rides along in the subline rather than owning a column). The standalone
        // "date" column below stays hidden purely to drive the newest-first default sort.
        cell: (row) => (
          <>
            <span className="w-full truncate font-medium">{row.serverName}</span>
            <span className="w-full truncate text-caption font-normal text-muted-foreground tabular-nums">
              {formatDateTime(row.scannedAt)}
              {row.status === "success" ? ` · ${formatNumber(row.totalTokens)} tok` : ""}
            </span>
          </>
        ),
      }),
      col<ScanSummary>({
        id: "status",
        header: "Status",
        value: (row) => row.status,
        cell: (row) => <StatusBadge status={row.status} />,
      }),
      // G3/S20: "did it grow since last time?" answered in-place — Δ vs the previous successful
      // scan of THIS server (em dash for a first scan; sorts numerically on the signed value).
      // The Δ value doubles as the row-level "Diff vs previous" action: clicking it opens a
      // PRE-FILLED Compare of this scan vs its previous successful same-server scan (one click from
      // any row). This keeps the narrow master uncluttered — no separate action column to clip —
      // while the detail header carries an explicitly *labelled* "Diff vs previous" button too.
      col<ScanSummary>({
        id: "delta",
        header: "Δ vs previous",
        numeric: true,
        value: (row) => scanDeltaFor(deltaIndex, row.id).deltaTokens ?? Number.NEGATIVE_INFINITY,
        cell: (row) => {
          const { deltaTokens, prevScanId } = scanDeltaFor(deltaIndex, row.id);
          if (!prevScanId) return <ScanDeltaCell delta={deltaTokens} />;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-auto justify-end px-1 py-0.5"
                  onClick={() => navigate(diffVsPreviousHref(row.serverId, row.id, prevScanId))}
                  aria-label={`Diff ${row.serverName} scan vs previous`}
                >
                  <ScanDeltaCell delta={deltaTokens} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Diff vs previous scan</TooltipContent>
            </Tooltip>
          );
        },
      }),
      col<ScanSummary>({
        id: "date",
        header: "Date",
        value: (row) => row.scannedAt,
        cell: (row) => (
          <Text variant="meta" tone="muted" className="tabular-nums">
            {formatDateTime(row.scannedAt)}
          </Text>
        ),
      }),
    ],
    [onLoadScan, selectedScan?.id, deltaIndex, navigate],
  );

  // Full-word headers (SC2 — no "Desc" abbreviation); the extra token facets Name + Annotations
  // exist in the data model, so they are real columns hidden by default and revealed through the
  // column picker (see `initialView.columnVisibility` on the table below).
  const toolColumns = [
    col<ToolScan>({
      id: "tool",
      header: "Tool",
      value: (row) => row.toolName,
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto justify-start px-1 py-0.5 font-mono font-medium"
          onClick={() => openTool(row)}
        >
          <span className="truncate">{row.toolName}</span>
        </Button>
      ),
    }),
    col<ToolScan>({ id: "total", header: "Total", numeric: true, value: (row) => row.totalTokens }),
    col<ToolScan>({ id: "name", header: "Name", numeric: true, value: (row) => row.nameTokens }),
    col<ToolScan>({
      id: "schema",
      header: "Schema",
      numeric: true,
      value: (row) => row.schemaTokens,
    }),
    col<ToolScan>({
      id: "description",
      header: "Description",
      numeric: true,
      value: (row) => row.descriptionTokens,
    }),
    col<ToolScan>({
      id: "annotations",
      header: "Annotations",
      numeric: true,
      value: (row) => row.annotationsTokens,
    }),
    col<ToolScan>({
      id: "bytes",
      header: "Bytes",
      numeric: true,
      value: (row) => row.rawBytes,
      cell: (row) => formatBytes(row.rawBytes),
    }),
    col<ToolScan>({
      id: "share",
      header: "Share",
      numeric: true,
      value: (row) => row.contributionPercent,
      cell: (row) => formatPercent(row.contributionPercent),
    }),
  ];

  // WP 4.2 (D-1) — column visibility keys off the mode. In the FULL-WIDTH list (arrival), the
  // Δ-vs-previous column is shown and finally has room to read — the audit's whole point. In the
  // narrow switcher rail (detail mode) it is hidden: the rail's job is "pick another scan", and the
  // Δ-vs-previous story for the OPEN scan is already carried by the detail header's explicit "Diff vs
  // previous" button, so folding Δ out keeps the rail from collapsing/wrapping. (`date` stays hidden
  // in both modes — it exists only to drive the newest-first default sort.) The list table remounts
  // when the mode flips (its parent structure changes), so `initialView` re-applies cleanly.
  const historyColumnVisibility: Record<string, boolean> = inDetail
    ? { date: false, delta: false }
    : { date: false };

  // The scan-history list — the ONE shared surface, rendered full-width in list mode and inside the
  // switcher rail in detail mode. Extracted to a local element so both modes render the identical
  // toolbar + table (no duplication, one source of truth for the filter/search/count row).
  const historyPanel = (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* The ONE toolbar row (D-TB6/D-TB7 · ViewToolbar): search · filter dropdowns · result
          count on a single baseline, applied filters as removable chips inline. Lifted out of
          the DataTable so it stays fixed while the virtualized body scrolls and fills the panel. */}
      <ViewToolbar
        left={
          <>
            <SearchInput
              value={historySearch}
              onValueChange={setHistorySearch}
              placeholder="Search server or date…"
              label="Search scans"
            />
            <FacetFilter
              title="Server"
              options={serverOptions}
              selected={serverFacet}
              onSelectedChange={setServerFacet}
            />
            <FacetFilter
              title="Status"
              options={STATUS_OPTIONS}
              selected={statusFacet}
              onSelectedChange={setStatusFacet}
            />
          </>
        }
        results={
          <ResultCount>
            {searchedScans.length === props.scans.length
              ? `${props.scans.length} ${props.scans.length === 1 ? "scan" : "scans"}`
              : `${searchedScans.length} of ${props.scans.length} scans`}
          </ResultCount>
        }
        activeFilters={activeFilters}
        onClearAll={clearAllFilters}
      />
      {/* ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx) — the
          helper folds the layout classes in, since the spread's className would otherwise
          override the prop. */}
      <DataTable
        data={searchedScans}
        columns={historyColumns}
        {...clickableRowTableProps("min-h-0 flex-1")}
        {...stickyScrollTableProps()}
        initialView={{
          sorting: [{ id: "date", desc: true }],
          columnVisibility: historyColumnVisibility,
        }}
        emptyMessage={
          props.scans.length === 0 ? "No scans yet." : "No scans match the current filter."
        }
      />
    </div>
  );

  return (
    // WP 6.1 keystone → WP 6.2 (owner finding #2): `scroll="fill"` makes the content region FILL the
    // viewport and NOT scroll itself, so the page header stays fixed while its single child owns the
    // scroll INTERNALLY (audit §S22). WP 4.2 (D-1): that child is now mode-aware — a full-width list
    // frame with no selection, an `AdaptivePanelGroup` master-detail once a scan is picked. Both keep
    // the same `scroll="fill"` contract (outer frame fixed, inner region scrolls); the #28 responsive
    // AdaptivePanelGroup work is preserved for detail mode.
    <PageShell width="master-detail" scroll="fill">
      {/* D-TB1 — the breadcrumb (Home / Scans) names the page; keep an H1 for AT only. The list
          side's filter row and the detail pane's ViewToolbar are the per-region toolbars. */}
      <Heading level={1} className="sr-only">
        Scans
      </Heading>
      {inDetail ? (
        <AdaptivePanelGroup className="min-h-0 flex-1 items-stretch overflow-hidden rounded-md border border-border">
          {/* master (switcher rail): searchable / filterable / sortable scan history */}
          <ResizablePanel
            defaultSize={33}
            minSize={24}
            maxSize={45}
            className="flex min-h-0 min-w-0 flex-col"
          >
            {historyPanel}
          </ResizablePanel>

          <ResizableHandle withHandle aria-label="Resize scan history and detail panels" />

          {/* detail: selected scan. Gated on an id match so a deep-link (or a mid-flight rail switch)
              shows a loading pane rather than a flash of the wrong/empty scan while App.tsx fetches. */}
          <ResizablePanel defaultSize={67} minSize={40} className="flex min-h-0 min-w-0 flex-col">
            {selectedScan && selectedScan.id === scanId ? (
              selectedScan.status === "failed" ? (
                // A FAILED scan has no real footprint — never render `Total 0 / Tools 0 / Avg 0` KPIs
                // and a tab strip over fabricated zeros. Suppress both; hoist the diagnostic alert with
                // the real error and a way forward (T7 / audit "failed states are the least-finished
                // surface"). `App.tsx` already surfaces a failure toast; this is the resting detail.
                <FailedScanDetail scan={selectedScan} onNavigate={navigate} />
              ) : (
                // WP 6.2 (owner finding #2): the detail pane is a fill flex column — the identity header
                // + KPI grid + tab strip are the FIXED frame (TabPanel's pinned `header` + strip), and
                // ONLY the active Tools/Resources/Prompts table scrolls INTERNALLY (sticky header via
                // `stickyScrollTableProps`, `maxBodyHeight:100%`). The old SC-era "whole detail pane
                // scrolls as one block" (which carried the KPIs + strip off-screen) is gone.
                <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
                  <TabPanel
                    value={detailTab}
                    onValueChange={setDetailTab}
                    header={
                      <>
                        {/* TB.5 — the ONE detail-pane toolbar row (toolbar standard 2026-07-11). D-TB1:
                        the scan identity ("serverName · date") is the breadcrumb leaf (App.tsx), so
                        the removed `<Heading>` no longer repeats it — the row carries only the
                        {profile · date} muted meta on the left. D-TB3: "Reduce footprint" (the
                        assistant hook) is gone — run analysis lives only in the Assistant dock. The
                        Markdown + JSON buttons are merged into ONE export ▾ menu. ViewToolbar is
                        frame-light: the TabPanel pinned header supplies the frame. WP 4.2 (D-1): a
                        "← All scans" back control deselects (navigates to `/scans`) so the operator
                        returns to the full-width history — the explicit deselect the master-detail
                        mode needs (the browser Back also works, since selection is URL-driven). */}
                        <ViewToolbar
                          left={
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="-ml-1 shrink-0"
                                onClick={() => navigate("/scans")}
                              >
                                <ArrowLeft aria-hidden />
                                <span>All scans</span>
                              </Button>
                              <Text variant="meta" tone="muted" className="min-w-0 truncate">
                                {selectedScan.tokenProfile} ·{" "}
                                {formatDateTime(selectedScan.scannedAt)}
                              </Text>
                            </>
                          }
                          actions={
                            <>
                              {(() => {
                                const prevScanId = scanDeltaFor(
                                  deltaIndex,
                                  selectedScan.id,
                                ).prevScanId;
                                return prevScanId ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      navigate(
                                        diffVsPreviousHref(
                                          selectedScan.serverId,
                                          selectedScan.id,
                                          prevScanId,
                                        ),
                                      )
                                    }
                                  >
                                    <GitCompareArrows aria-hidden />
                                    <span>Diff vs previous</span>
                                  </Button>
                                ) : null;
                              })()}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    <Download aria-hidden />
                                    <span>Export</span>
                                    <ChevronDown aria-hidden className="size-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <a href={`/api/reports/scan/${selectedScan.id}/markdown`}>
                                      Markdown
                                    </a>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem asChild>
                                    <a
                                      href={`/api/reports/scan/${selectedScan.id}/json`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      JSON
                                    </a>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          }
                        />

                        {/* 2-up until the viewport is wide enough that the detail pane (a fraction of it
                        in the master-detail split) can hold four cards without cramping/clipping at
                        ~1100. This grid is part of TabPanel's PINNED header — it never scrolls away. */}
                        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
                          <MetricCard
                            label="Total footprint"
                            value={formatNumber(
                              selectedScan.totalTokens +
                                selectedScan.totalResourceTokens +
                                selectedScan.totalPromptTokens,
                            )}
                            description="Tools + resources + prompts"
                          />
                          <MetricCard label="Tools" value={formatNumber(selectedScan.totalTools)} />
                          <MetricCard
                            label="Avg tokens/tool"
                            value={formatNumber(selectedScan.averageTokensPerTool)}
                          />
                          <MetricCard
                            label="Largest tool"
                            value={
                              <span className="block truncate pr-4 font-mono text-body">
                                {selectedScan.largestToolName ?? "n/a"}
                              </span>
                            }
                          />
                        </div>
                      </>
                    }
                    tabs={[
                      { value: "tools", label: "Tools", count: selectedScan.tools.length },
                      {
                        value: "resources",
                        label: "Resources",
                        count: selectedScan.resources.length,
                      },
                      { value: "prompts", label: "Prompts", count: selectedScan.prompts.length },
                    ]}
                  >
                    {/* Tools / Resources / Prompts — the full definition footprint for this scan. Each
                    table owns its OWN internal scroll (scroll={false} on the content region → the
                    sticky-header DataTable is the scroll container), so the KPI grid + tab strip
                    above stay fixed while rows scroll. */}
                    <TabPanelContent
                      value="tools"
                      scroll={false}
                      bodyClassName="flex min-h-0 flex-col"
                    >
                      <DataTable
                        className="min-h-0 flex-1"
                        data={selectedScan.tools}
                        columns={toolColumns}
                        {...stickyScrollTableProps()}
                        globalFilter={toolSearch}
                        onGlobalFilterChange={setToolSearch}
                        initialView={{
                          sorting: [{ id: "total", desc: true }],
                          // Name + Annotations are the extra token facets: real columns, hidden by
                          // default, revealed via the column picker (SC2).
                          columnVisibility: { name: false, annotations: false },
                        }}
                        emptyMessage="No tools match the current filter."
                        toolbar={(table) => (
                          <ViewToolbar
                            left={
                              <SearchInput
                                value={toolSearch}
                                onValueChange={setToolSearch}
                                placeholder="Filter tools…"
                                label="Filter tools"
                              />
                            }
                            actions={<ColumnPicker table={table} label="Columns" />}
                          />
                        )}
                      />
                    </TabPanelContent>

                    <TabPanelContent
                      value="resources"
                      scroll={false}
                      bodyClassName="flex min-h-0 flex-col"
                    >
                      {selectedScan.resources.length === 0 ? (
                        <TabEmptyState
                          size="sm"
                          icon={<Box aria-hidden />}
                          title="No resources"
                          description="This server exposes no MCP resources."
                        />
                      ) : (
                        <DataTable
                          className="min-h-0 flex-1"
                          data={selectedScan.resources}
                          columns={resourceCols}
                          {...stickyScrollTableProps()}
                          initialView={{ sorting: [{ id: "tokens", desc: true }] }}
                          emptyMessage="No resources in this scan."
                        />
                      )}
                    </TabPanelContent>

                    <TabPanelContent
                      value="prompts"
                      scroll={false}
                      bodyClassName="flex min-h-0 flex-col"
                    >
                      {selectedScan.prompts.length === 0 ? (
                        <TabEmptyState
                          size="sm"
                          icon={<FileText aria-hidden />}
                          title="No prompts"
                          description="This server exposes no MCP prompts."
                        />
                      ) : (
                        <DataTable
                          className="min-h-0 flex-1"
                          data={selectedScan.prompts}
                          columns={promptCols}
                          {...stickyScrollTableProps()}
                          initialView={{ sorting: [{ id: "tokens", desc: true }] }}
                          emptyMessage="No prompts in this scan."
                        />
                      )}
                    </TabPanelContent>
                  </TabPanel>
                </div>
              )
            ) : scanLoadError ? (
              // interface-craft WP 4.3 FIX 1 (P0): a SETTLED failure loading the deep-linked scan
              // (missing/deleted scan, transport error). Before, this branch always rendered the
              // loading pane below — so a 404 spun forever. Now a terminal error StatePanel with a
              // way out, mirroring RunConsoleRoute's `/testing/runs/:runId` error state. Respects
              // .claude/rules/loading-states.md: no infinite spinner on a settled failure.
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <StatePanel
                  kind="error"
                  size="sm"
                  title="Couldn’t open the scan."
                  description={scanLoadError}
                  actions={
                    <Button variant="outline" size="sm" onClick={() => navigate("/scans")}>
                      Back to scans
                    </Button>
                  }
                />
              </div>
            ) : (
              // WP 4.2 (D-1): detail mode only mounts for a real `/scans/:scanId`, so the old "No scan
              // selected" empty state (the audit's "800px of nothing") is gone. This is a transient
              // LOADING pane — shown only while App.tsx fetches the deep-linked scan (or during a rail
              // switch before the new detail resolves), never the resting state of an empty pane.
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <StatePanel
                  kind="loading"
                  size="sm"
                  title="Loading scan…"
                  description="Fetching this scan's tool footprint."
                />
              </div>
            )}
          </ResizablePanel>
        </AdaptivePanelGroup>
      ) : (
        // List mode (`/scans`): the history is FULL-WIDTH. No detail pane, no resize handle — the
        // list finally reads at a comfortable width and its Δ-vs-previous column has room. Same
        // `scroll="fill"` contract: the bordered frame fills the region and the list scrolls inside it.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          {historyPanel}
        </div>
      )}

      {/* tool detail slides in */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Tool detail</SheetTitle>
            <SheetDescription>Token breakdown for the selected tool.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {selectedTool ? (
              <ToolDetailPanel
                tool={selectedTool}
                serverId={selectedScan?.serverId}
                tokenProfile={selectedScan?.tokenProfile}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* resource read / prompt get consoles */}
      {selectedScan && readResource ? (
        <ResourceReadDialog
          open={readOpen}
          onOpenChange={setReadOpen}
          serverId={selectedScan.serverId}
          uri={readResource.uri}
          tokenProfile={selectedScan.tokenProfile}
        />
      ) : null}
      {selectedScan && getPrompt ? (
        <PromptGetDialog
          open={getOpen}
          onOpenChange={setGetOpen}
          serverId={selectedScan.serverId}
          promptName={getPrompt.promptName}
          args={getPrompt.arguments}
          tokenProfile={selectedScan.tokenProfile}
        />
      ) : null}
    </PageShell>
  );
}

/**
 * Detail pane for a FAILED scan (T7 / audit "failed states are the least-finished surface"). A failed
 * scan carries no tool footprint, so this NEVER renders `Total 0 / Tools 0 / Avg 0` KPIs and a tab
 * strip over fabricated zeros — it hoists the real diagnostic and offers a way forward. Recovery lives
 * on the server page (which hosts BOTH the Scan control and the connection/auth settings): an auth
 * failure leads with "Sign in and rescan", any other failure with "Scan again". `authRequired` is only
 * ever set for an oauth-HTTP server whose token needs interactive sign-in.
 */
function FailedScanDetail({
  scan,
  onNavigate,
}: {
  scan: ScanDetail;
  onNavigate: (to: string) => void;
}) {
  const serverPath = `/servers/${scan.serverId}`;
  const authExpired = Boolean(scan.authRequired);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4">
      <ViewToolbar
        left={
          <>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 shrink-0"
              onClick={() => onNavigate("/scans")}
            >
              <ArrowLeft aria-hidden />
              <span>All scans</span>
            </Button>
            <Text variant="meta" tone="muted" className="min-w-0 truncate">
              {scan.serverName} · {formatDateTime(scan.scannedAt)}
            </Text>
          </>
        }
      />
      <Alert variant="destructive">
        <AlertTitle>
          {authExpired
            ? "Couldn’t finish the scan — the server needs sign-in."
            : "Couldn’t complete the scan."}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{scan.errorMessage ?? "No further detail was recorded."}</span>
          {authExpired ? (
            <span>
              The server’s OAuth session expired. Sign in again on the server, then run a new scan.
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => onNavigate(serverPath)}>
              <Play aria-hidden />
              <span>{authExpired ? "Sign in and rescan" : "Scan again"}</span>
            </Button>
            <Button variant="link" className="h-auto p-0" onClick={() => onNavigate(serverPath)}>
              Edit connection settings
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
