import { useEffect, useMemo, useState } from "react";
import type {
  CompatibilityCell,
  CompatibilityHeatmap,
  CompatibilityModelRef,
  ScanSummary,
} from "@mcp-token-footprint/shared";
import { useNavigate } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from "@brand/ui";
import { Info, LayoutGrid, Wrench } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { pinnedCellClass } from "../../lib/table";
import {
  getCompatibilityHeatmap,
  getCompatibilityModels,
  type CompatibilityModelOption,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime, formatNumber } from "../../lib/format";
import { CompatibilityCellSheet } from "./CompatibilityCellSheet";
import { ModelPicker } from "./ModelPicker";
import {
  BAND_META,
  BAND_TOOLTIP,
  CLIENT_OPTIONS,
  HATCH_STYLE,
  MANUAL_REVIEW_CONCERNS,
} from "./meta";

// Persisted (localStorage) per the app's state convention — model column selection survives reloads.
const MODELS_STORAGE_KEY = "mcp-token-footprint.compatibility-models";
const NO_CLIENT = "__none__";

type HeatmapView = "server" | "tool";
type Rollup = "worst-tool" | "average-tool";

type SelectedCell = {
  cell: CompatibilityCell;
  subjectLabel: string;
  model: CompatibilityModelRef | null;
};

export function CompatibilityView(props: { scans: ScanSummary[] }) {
  const navigate = useNavigate();
  const successScans = useMemo(
    () => [...props.scans].filter((scan) => scan.status === "success").sort(byNewest),
    [props.scans],
  );

  // ── Model roster (column picker) ──────────────────────────────────────────────────────────────
  const [models, setModels] = useState<CompatibilityModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // Empty selection = "use the server's default column set" (omit `models` from the request).
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(() => readStoredModels());

  useEffect(() => {
    let active = true;
    getCompatibilityModels()
      .then((payload) => {
        if (!active) return;
        setModels(payload.models);
        setModelsError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setModelsError(getErrorMessage(cause, "Couldn’t load models."));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Best-effort persistence (localStorage can throw — Safari private mode / quota exceeded); an
    // unguarded throw here would propagate out of the effect and unmount the whole view via the
    // error boundary, so a failure here must stay silent. The paired read (readStoredModels below)
    // is already guarded the same way.
    try {
      window.localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(selectedModelIds));
    } catch {
      // ignore — the in-memory selection still applies for this session.
    }
  }, [selectedModelIds]);

  // FacetFilter is a flat multi-select; carry the provider into each label so columns read grouped.
  const modelOptions = useMemo(
    () =>
      [...models]
        .sort(
          (a, b) =>
            a.providerName.localeCompare(b.providerName) ||
            a.displayName.localeCompare(b.displayName),
        )
        .map((model) => ({
          value: model.id,
          label: `${model.providerName} · ${model.displayName}`,
        })),
    [models],
  );

  // Drop any persisted id no longer in the roster (keeps the request well-formed).
  useEffect(() => {
    if (models.length === 0 || selectedModelIds.length === 0) return;
    const valid = new Set(models.map((model) => model.id));
    setSelectedModelIds((current) => {
      const filtered = current.filter((id) => valid.has(id));
      return filtered.length === current.length ? current : filtered;
    });
  }, [models, selectedModelIds.length]);

  // ── Scan + toggles ────────────────────────────────────────────────────────────────────────────
  const [scanId, setScanId] = useState("");
  // A compatibility scan is always scoped to exactly ONE server, so the "server" view's grid is
  // structurally always a single row (`buildHeatmap` in the API emits exactly one server row).
  // Lead with the view that actually has content (C-10) — Tool × Model, one row per tool.
  const [view, setView] = useState<HeatmapView>("tool");
  const [rollup, setRollup] = useState<Rollup>("worst-tool");
  const [client, setClient] = useState<string>(NO_CLIENT);

  useEffect(() => {
    setScanId((current) =>
      current && successScans.some((scan) => scan.id === current)
        ? current
        : (successScans[0]?.id ?? ""),
    );
  }, [successScans]);

  // ── Heatmap fetch ─────────────────────────────────────────────────────────────────────────────
  const [heatmap, setHeatmap] = useState<CompatibilityHeatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  useEffect(() => {
    if (!scanId) {
      setHeatmap(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    // Drop any open cell selection — the sheet's cell belongs to the heatmap we're replacing.
    setSelectedCell(null);
    getCompatibilityHeatmap(scanId, {
      models: selectedModelIds,
      view,
      rollup,
      client: client === NO_CLIENT ? undefined : client,
    })
      .then((result) => {
        if (!active) return;
        setHeatmap(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setHeatmap(null);
        setError(getErrorMessage(cause, "Couldn’t load the heatmap."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [scanId, selectedModelIds, view, rollup, client]);

  const scanOptions = successScans.map((scan) => ({ value: scan.id, label: scanLabel(scan) }));
  // The trigger's `title` recovers the detail the shortened option label drops (D-10 recovery for
  // truncating/shortened text) — full server + timestamp + tool count on hover.
  const selectedScan = successScans.find((scan) => scan.id === scanId) ?? null;
  const modelById = useMemo(() => {
    const map = new Map<string, CompatibilityModelRef>();
    if (heatmap) for (const model of heatmap.models) map.set(model.id, model);
    return map;
  }, [heatmap]);

  // The server behind the selected scan — the home of every tool's breakdown (Tools tab). Lets the
  // cell drawer's "what to do" affected tools link back to where they're fixed (S20).
  const activeServerId = useMemo(
    () => successScans.find((scan) => scan.id === scanId)?.serverId ?? null,
    [successScans, scanId],
  );
  const openTool = activeServerId ? () => navigate(`/servers/${activeServerId}`) : undefined;

  return (
    <PageShell
      headerVariant="toolbar"
      width="full"
      header={
        <ViewToolbar
          info={
            <p className="max-w-xs text-pretty">
              Which models can host this server, and where it breaks. A band + score per (subject ×
              model); click a cell for the cited evidence and the fix.
            </p>
          }
          left={
            <>
              {/* Compact controls: the field label is the control's accessible name (aria-label) +
                  placeholder — no visible label row (toolbar standard D-TB2). */}
              <Select value={scanId} onValueChange={setScanId}>
                <SelectTrigger
                  aria-label="Scan"
                  className="w-56 min-w-0"
                  title={selectedScan ? scanTitle(selectedScan) : undefined}
                >
                  <SelectValue placeholder="Scan…" />
                </SelectTrigger>
                <SelectContent>
                  {scanOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Models — ModelPicker owns its own labelled trigger (CP3). Its Button is `w-full`,
                  so bound the width here to keep it compact in the row (C-3: widened from w-44 so
                  "N models · Default set" has room and doesn't clip mid-word). */}
              {modelsError ? (
                <Text variant="meta" tone="muted" className="min-w-0 truncate">
                  {`${modelsError} Try again.`}
                </Text>
              ) : (
                <div className="w-56 shrink-0">
                  <ModelPicker
                    options={modelOptions}
                    selected={selectedModelIds}
                    onSelectedChange={setSelectedModelIds}
                    defaultCount={
                      selectedModelIds.length === 0 ? heatmap?.models.length : undefined
                    }
                  />
                </div>
              )}

              {/* View — segmented; the aria-label carries the now-invisible field label. Tool ×
                  Model leads (matches the default, C-10) since a scan is always ONE server, so
                  Server × Model is structurally always a single row. */}
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="View"
                value={view}
                onValueChange={(value) => value && setView(value as HeatmapView)}
                className="shrink-0"
              >
                <ToggleGroupItem value="tool">
                  <Wrench aria-hidden />
                  <span>Tool × Model</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="server">
                  <LayoutGrid aria-hidden />
                  <span>Server × Model</span>
                </ToggleGroupItem>
              </ToggleGroup>

              {/* Server roll-up — segmented. */}
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Server roll-up"
                value={rollup}
                onValueChange={(value) => value && setRollup(value as Rollup)}
                className="shrink-0"
              >
                <ToggleGroupItem value="worst-tool">Worst tool</ToggleGroupItem>
                <ToggleGroupItem value="average-tool">Average</ToggleGroupItem>
              </ToggleGroup>

              {/* Host client (optional) — "none" is the default; its option label names the FIELD
                  ("Host client: none"), never a bare "None" that only the aria-label explained
                  (C-3). */}
              <Select value={client} onValueChange={setClient}>
                <SelectTrigger aria-label="Host client" className="w-44 min-w-0">
                  <SelectValue placeholder="Host client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>Host client: none</SelectItem>
                  {CLIENT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Count chip — how many successful scans are available to pick from. */}
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {formatNumber(successScans.length)} scans
              </Badge>
            </>
          }
        />
      }
    >
      {/* The breadcrumb (Home / Compatibility) names the page; keep an H1 for AT only (D-TB1). */}
      <Heading level={1} className="sr-only">
        MCP × Model compatibility
      </Heading>

      {loading ? (
        <StatePanel kind="loading" title="Building heatmap…" loadingLabel="Building heatmap…" />
      ) : error ? (
        <StatePanel
          kind="error"
          title="Couldn’t load the heatmap."
          description={`${error} Try again.`}
        />
      ) : !scanId ? (
        <StatePanel
          kind="empty"
          title="No successful scan yet"
          description="Scan an MCP server, then come back to see which models can host it."
        />
      ) : heatmap && heatmap.rows.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-3">
          {/* The colour key sits with the grid it explains (content beside the heatmap, not header
              chrome — D-TB2). Left-aligned (not `justify-end`) so it tracks the grid's own left
              edge rather than the full row width — with few model columns selected the table can
              be much narrower than the row, and a right-pinned legend then floats detached from it
              (C-10). The onboarding sentence lives in the toolbar ⓘ tooltip. */}
          <div className="flex">
            <Legend />
          </div>
          <HeatmapGrid
            heatmap={heatmap}
            onSelectCell={(cell, subjectLabel) =>
              setSelectedCell({ cell, subjectLabel, model: modelById.get(cell.modelId) ?? null })
            }
          />
        </div>
      ) : (
        <StatePanel
          kind="empty"
          title={view === "tool" ? "This scan has no tools" : "Nothing to score"}
          description="This scan produced no rows for the selected view."
        />
      )}

      <ManualReviewCallout />

      <CompatibilityCellSheet
        cell={selectedCell?.cell ?? null}
        subjectLabel={selectedCell?.subjectLabel ?? ""}
        model={selectedCell?.model ?? null}
        onOpenTool={openTool}
        onClose={() => setSelectedCell(null)}
      />
    </PageShell>
  );
}

function HeatmapGrid({
  heatmap,
  onSelectCell,
}: {
  heatmap: CompatibilityHeatmap;
  onSelectCell: (cell: CompatibilityCell, subjectLabel: string) => void;
}) {
  // CP2 — the heatmap must keep its model-column headers AND the subject/tool first column visible
  // while 60 tool rows scroll. @brand/ui `Table` owns its scroll wrapper (`relative w-full
  // overflow-auto`) but exposes no height cap, so `[&>div]` targets that wrapper to bound it into a
  // single both-axis scroll box; `position: sticky` then resolves against it. The header row sticks
  // top, the first column sticks left, and the corner cell sticks to both (higher z so it clears
  // both bands). `pinnedCellClass` supplies the left-edge padding bleed + opaque `bg-card` fill.
  // The model column headers carry the human name ("Claude Opus 4.8"); cell + row-header accessible
  // names reuse it (never the raw id "claude-opus-4-8") so a cell's spoken name matches its visible
  // column header — WCAG 2.5.3 Label-in-Name.
  const modelLabel = (id: string): string =>
    heatmap.models.find((model) => model.id === id)?.displayName ?? id;
  const subjectNoun = heatmap.view === "tool" ? "tool" : "subject";
  return (
    <div className="overflow-hidden rounded-md border border-border [&>div]:max-h-[70vh]">
      <Table>
        {/* A programmatic name for the grid (AT only) — a screen-reader lands on the table and hears
            what it is + how it's laid out before navigating the cells. */}
        <TableCaption className="sr-only">
          {`MCP × model compatibility — one row per ${subjectNoun}, one column per model. Each cell is that pairing's band and 0–100 score; activate a cell for the cited evidence and the fix.`}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead
              scope="col"
              className={cn(
                pinnedCellClass("left", { header: true }),
                "top-0 min-w-48 align-bottom",
              )}
            >
              {heatmap.view === "tool" ? "Tool" : "Subject"}
            </TableHead>
            {heatmap.models.map((model) => (
              <TableHead
                key={model.id}
                scope="col"
                className="sticky top-0 z-10 min-w-28 bg-card text-center align-bottom"
              >
                <span className="block truncate font-medium" title={model.displayName}>
                  {model.displayName}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {heatmap.rows.map((row) => (
            <TableRow key={`${row.subjectType}:${row.subjectId}`}>
              {/* The subject/tool name is the ROW header (`th scope="row"`) so each data cell is
                  associated with both its model column and its subject row for AT. */}
              <TableHead
                scope="row"
                className={cn(
                  pinnedCellClass("left"),
                  "min-w-48 max-w-72 truncate font-medium text-foreground",
                )}
              >
                <span title={row.label}>{row.label}</span>
              </TableHead>
              {row.cells.map((cell) => (
                <HeatCell
                  key={cell.modelId}
                  cell={cell}
                  subjectLabel={row.label}
                  modelLabel={modelLabel(cell.modelId)}
                  onSelect={onSelectCell}
                />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HeatCell({
  cell,
  subjectLabel,
  modelLabel,
  onSelect,
}: {
  cell: CompatibilityCell;
  subjectLabel: string;
  /** The model's human display name — used in the accessible name (never the raw id). */
  modelLabel: string;
  onSelect: (cell: CompatibilityCell, subjectLabel: string) => void;
}) {
  const band = BAND_META[cell.band];
  const Glyph = band.glyph;
  const concerns = cell.results.filter((r) => r.verdict === "fail" || r.verdict === "warn").length;
  // A blocker-level failure gates the cell to red REGARDLESS of score (a high 95 can still be red).
  // Surface it as a corner marker so the cell explains itself instead of looking like an anomaly.
  const blockerOverride =
    cell.band === "red" &&
    cell.results.some((r) => r.verdict === "fail" && r.severity === "blocker");
  const scoreSpoken = cell.score === null ? "not scored" : String(cell.score);
  // @brand/ui Button is the interactive control (keyboard + focus); the band surface is a child
  // layout <span>. The glyph + hatch make the band legible without colour (colour-blind / greyscale
  // safe); the accessible name decodes the band + uses the model's DISPLAY name (Label-in-Name).
  return (
    <TableCell className="p-1 text-center">
      <Button
        variant="ghost"
        onClick={() => onSelect(cell, subjectLabel)}
        aria-label={`${subjectLabel} on ${modelLabel}: ${band.srLabel}, score ${scoreSpoken}, ${concerns} concern${
          concerns === 1 ? "" : "s"
        }${blockerOverride ? ", gated to below floor by a blocker-level failure" : ""}`}
        className="h-auto w-full p-0"
      >
        <span
          className={cn(
            "relative flex w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md px-2 py-2.5",
            band.cell,
          )}
        >
          {band.hatch ? (
            <span
              aria-hidden
              style={HATCH_STYLE}
              className="pointer-events-none absolute inset-0 opacity-40"
            />
          ) : null}
          {blockerOverride ? (
            <span
              aria-hidden
              className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[0.55rem] border-t-[0.55rem] border-l-transparent border-t-destructive"
            />
          ) : null}
          <span className="relative flex items-center gap-1">
            <Glyph aria-hidden className="size-3 shrink-0" />
            <span className="font-semibold tabular-nums">
              {cell.score === null ? "—" : cell.score}
            </span>
          </span>
          {concerns > 0 ? (
            <span className="relative tabular-nums opacity-80">
              {concerns} {concerns === 1 ? "issue" : "issues"}
            </span>
          ) : null}
        </span>
      </Button>
    </TableCell>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(["green", "amber", "red", "untested"] as const).map((band) => {
        const meta = BAND_META[band];
        const Glyph = meta.glyph;
        return (
          <Tooltip key={band}>
            {/* A real (Radix) button trigger so the band's explanation is reachable by keyboard —
                focus opens the tooltip, not mouse-hover only. Flat/ghost styling: it reads as a
                legend key, not a command; cursor-help signals "hover/focus for meaning". */}
            <TooltipTrigger className="flex cursor-help items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
              {/* The swatch mirrors the cell: the band tint + its glyph (so the legend decodes the
                  per-cell mark), hatched for the untested band. */}
              <span
                aria-hidden
                className={cn(
                  "relative flex size-4 items-center justify-center overflow-hidden rounded",
                  meta.cell,
                )}
              >
                {meta.hatch ? (
                  <span
                    style={HATCH_STYLE}
                    className="pointer-events-none absolute inset-0 opacity-40"
                  />
                ) : null}
                <Glyph className="relative size-2.5" />
              </span>
              <Text as="span" variant="meta" tone="muted">
                {meta.label}
              </Text>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <p className="font-medium">{meta.label}</p>
              <p className="text-pretty">{BAND_TOOLTIP[band]}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
      <IconButton
        variant="ghost"
        size="icon-sm"
        className="size-6 text-muted-foreground"
        label="Bands are model-relative: each score is compared against that model's own practical limits, so the same score can be amber for one model and red for another."
      >
        <Info aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  );
}

function ManualReviewCallout() {
  return (
    <Alert variant="info">
      <Info aria-hidden />
      <AlertTitle>Not everything is automated</AlertTitle>
      <AlertDescription>
        {/* Finding 9 / D-IC9 — this prose ran to 190ch/line at 1600px with no measure cap. Genuine
            prose only (the ul below is a short list of concerns, not a table), so the whole block
            gets the ~68ch reading-width cap. */}
        <div className="flex max-w-[68ch] flex-col gap-2">
          <Text variant="body" tone="muted">
            This heatmap scores what a static tool surface + a model dataset can tell us. Six
            security and design concerns still need a human review — the grid does not cover them.
          </Text>
          <Accordion type="single" collapsible>
            <AccordionItem value="manual-review">
              <AccordionTrigger>
                {MANUAL_REVIEW_CONCERNS.length} concerns out of automated scope
              </AccordionTrigger>
              <AccordionContent>
                <ul className="flex flex-col gap-2">
                  {MANUAL_REVIEW_CONCERNS.map((concern) => (
                    <li key={concern.title} className="flex flex-col gap-0.5">
                      <Text as="span" className="font-medium">
                        {concern.title}
                      </Text>
                      <Text variant="meta" tone="muted">
                        {concern.detail}
                      </Text>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// C-3: the option label used to be `<server> · <full date+time> · <N> tools` — in the trigger's
// w-56 box that truncated MID-DATE (`qlik-mreimitz · Jul 21,…`), cutting off the one thing that
// distinguishes scans of the same server. Shorten to `<server> · <date>` (date only, no time) so
// it fits without clipping a token; the dropped time + tool count are recoverable via `scanTitle`
// on the trigger (hover), not lost.
function scanLabel(scan: ScanSummary): string {
  return `${scan.serverName} · ${formatShortDate(scan.scannedAt)}`;
}

/** Full detail for the scan-select trigger's `title` — the hover recovery for the shortened label. */
function scanTitle(scan: ScanSummary): string {
  return `${scan.serverName} · ${formatDateTime(scan.scannedAt)} · ${formatNumber(scan.totalTools)} tools`;
}

/** Date only (no time), e.g. "Jul 21, 2026" — `formatDateTime`'s `dateStyle` half, split out so the
 * scan-select option label can drop the time without a local Intl call scattered inline. */
function formatShortDate(value: string | undefined): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function byNewest(a: ScanSummary, b: ScanSummary): number {
  return Date.parse(b.scannedAt) - Date.parse(a.scannedAt);
}

function readStoredModels(): string[] {
  try {
    const raw = window.localStorage.getItem(MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}
