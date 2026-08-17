import { useMemo, useState } from "react";
import type { RunSummary } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusIcon,
  Switch,
  Text,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import {
  AlertTriangle,
  Anchor,
  ChevronDown,
  Clock,
  Cpu,
  Download,
  FileJson,
  GitCompareArrows,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { StatusBadge } from "../../../components/StatusBadge";
import { runStatusBadgeStatus, runStatusBadgeView } from "../RunBar";
import { RunLetterBadge } from "./RunLetterBadge";
import { buildComparisonJson, buildComparisonMarkdown } from "./next-steps/compare-export";
import { downloadText } from "./next-steps/NextSteps";
import {
  MAX_COMPARE_RUNS,
  MODE_SOON,
  RUN_COMPARE_MODES,
  relativeTime,
  type CompareCaveat,
  type CompareData,
  type CompareMode,
  type WorkspaceRun,
} from "./compare-runs";

const MODE_LABEL: Record<(typeof RUN_COMPARE_MODES)[number], string> = {
  summary: "Summary",
  flow: "Flow",
  metrics: "Metrics",
};

/**
 * The compare bar (audit §H2; compare-redesign §3.1 C1/C2) — the workspace's ONE command row. It is
 * a pure control surface: every action is a callback the workspace turns into URL state (so nothing
 * here scrolls or navigates directly). It is mounted in the {@link PageShell} `headerVariant="toolbar"`
 * slot, so it must stay compact — one row that wraps to at most two rows below ~1200px (§3.5).
 *
 * Layout (left → right, `ml-auto` splits the two clusters so the right one wraps as a unit):
 *   LEFT   test picker · compact run chips · [+ Add run] · caveat chip (⚠ n)
 *   RIGHT  Summary|Flow|Metrics toggle · "Δ vs Ⓐ" baseline suffix · Export split · Explain (✦)
 *
 * Compaction vs. the old 4-row bar: each run chip is now a POPOVER — the letter badge + truncated
 * environment + a status dot in the row, with the model, wall-clock, "Set as baseline" and remove ×
 * moved into the popover. That kills the chip wrapping, the dedicated baseline row + its explainer
 * prose (baseline is set from the chip; the bar only shows "Δ vs Ⓐ"), and the informational caveat
 * band (now a chip + popover). Change markers moved OUT of the bar into scrollable content (the
 * workspace's "What changed" strip) — the bar is chrome, markers are content.
 *
 * Run identity is the letter + colour ({@link RunLetterBadge}) everywhere.
 */
export function CompareBar({
  runs,
  data,
  testId,
  baseline,
  mode,
  caveats,
  modeControlsDisabled = false,
  explainAvailable = false,
  onExplain,
  onSelectTest,
  onAddRun,
  onRemoveRun,
  onSetBaseline,
  onModeChange,
}: {
  runs: WorkspaceRun[];
  data: CompareData;
  /** The single test the set shares, or `null` when the set spans multiple tests. */
  testId: string | null;
  baseline: string | null;
  mode: CompareMode;
  /** The comparability caveats (H3 / T9h) — surfaced as a `⚠ n` chip + popover, not a pinned band. */
  caveats: CompareCaveat[];
  /** Suite mode (from the `?suiteRunIds=` seam) disables the run-mode controls. */
  modeControlsDisabled?: boolean;
  /** Whether the "Explain diff" (✦) action can run (≥2 runs + assistant auth configured). */
  explainAvailable?: boolean;
  /** Open the assistant on this comparison (owned by the workspace; the bar just triggers it). */
  onExplain?: () => void;
  onSelectTest: (testId: string) => void;
  onAddRun: (runId: string) => void;
  onRemoveRun: (runId: string) => void;
  onSetBaseline: (runId: string) => void;
  onModeChange: (mode: CompareMode) => void;
}) {
  // Tests that actually have ≥1 run — the only ones worth offering.
  const runsByTest = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of data.runs) map.set(run.testId, (map.get(run.testId) ?? 0) + 1);
    return map;
  }, [data.runs]);

  const testOptions = useMemo(
    () =>
      [...data.testsById.values()]
        .filter((test) => runsByTest.has(test.id))
        .map((test) => ({
          value: test.id,
          label: `${test.name} · ${runsByTest.get(test.id)} run${runsByTest.get(test.id) === 1 ? "" : "s"}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data.testsById, runsByTest],
  );

  const atCap = runs.length >= MAX_COMPARE_RUNS;
  const canSetBaseline = runs.length >= 2;
  const baselineRun = runs.find((run) => run.isBaseline);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {/* LEFT cluster — test picker · chips · add · caveat. Wraps within itself only if very narrow. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="w-56 shrink-0">
          <Select value={testId ?? ""} onValueChange={onSelectTest}>
            <SelectTrigger aria-label="Test" size="sm" className="w-full">
              <SelectValue placeholder="Select a test…" />
            </SelectTrigger>
            <SelectContent>
              {testOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {runs.length > 0 ? <div className="h-6 w-px shrink-0 bg-border" aria-hidden /> : null}

        <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
          {runs.map((run) => (
            <li key={run.id}>
              <RunChip
                run={run}
                canSetBaseline={canSetBaseline}
                onSetBaseline={() => onSetBaseline(run.id)}
                onRemove={() => onRemoveRun(run.id)}
              />
            </li>
          ))}
        </ul>

        <AddRunPopover
          data={data}
          testId={testId}
          selectedIds={new Set(runs.map((run) => run.id))}
          disabled={atCap}
          onAddRun={onAddRun}
        />

        {caveats.length > 0 ? <CaveatChip caveats={caveats} /> : null}
      </div>

      {/* RIGHT cluster — mode toggle · baseline suffix · export · explain. Wraps as one unit <1200px. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <ModeToggle mode={mode} disabled={modeControlsDisabled} onModeChange={onModeChange} />
        {baselineRun && runs.length >= 2 ? (
          <Text
            variant="meta"
            tone="muted"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap"
            title={`Every Δ is measured against ${baselineRun.letter} · ${baselineRun.scenarioName}`}
          >
            <span>Δ vs</span>
            <RunLetterBadge letter={baselineRun.letter} color={baselineRun.color} baseline />
          </Text>
        ) : null}
        <ExportMenu runs={runs} disabled={runs.length < 2} />
        {explainAvailable && onExplain ? (
          <Button variant="outline" size="sm" onClick={onExplain}>
            <Sparkles aria-hidden />
            <span>Explain</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One compact run chip: a popover trigger showing the letter badge + truncated environment + a status
 * dot; the popover carries the model, wall-clock, "Set as baseline" and remove ×. The trigger is a
 * real `Button` (keyboard reachable, visible focus); its `aria-label` names the run + status.
 */
function RunChip({
  run,
  canSetBaseline,
  onSetBaseline,
  onRemove,
}: {
  run: WorkspaceRun;
  canSetBaseline: boolean;
  onSetBaseline: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  // WP3.fix (D-US5) — the run's OWN precise locked-table chip (label + tone), threading
  // `stopReasonCode`/`phase` too (AR11 review-awareness carries through unchanged).
  const statusView = runStatusBadgeView(
    run.run.status,
    run.run.outcome,
    run.run.ratingState,
    run.run.stopReasonCode,
    run.run.phase,
  );
  const statusLabel = statusView.kind === "chip" ? statusView.label : "—";
  // The trigger's decorative dot (`StatusIcon`, aria-hidden) is `@elabs-ai/components-ui`'s closed 7-state enum —
  // it structurally can't express the locked table's full vocabulary, so it stays on the coarse
  // bucket; the adjacent `aria-label` + the popover's full chip below carry the precise state.
  const coarseStatus = runStatusBadgeStatus(run.run.status, run.run.outcome, run.run.ratingState);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 max-w-[10rem] gap-1.5 px-1.5 font-normal",
            run.isBaseline && "ring-1 ring-primary",
          )}
          aria-label={`Run ${run.letter}, ${run.scenarioName}${run.isBaseline ? " (baseline)" : ""}, ${statusLabel}. Open run details`}
        >
          <RunLetterBadge letter={run.letter} color={run.color} baseline={run.isBaseline} />
          <span className="min-w-0 flex-1 truncate text-left">{run.scenarioName}</span>
          <StatusIcon status={coarseStatus} className="size-3.5 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-start gap-2 border-b border-border p-3">
          <RunLetterBadge
            letter={run.letter}
            color={run.color}
            baseline={run.isBaseline}
            size="md"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Text className="truncate font-medium" title={run.scenarioName}>
              {run.scenarioName}
            </Text>
            <StatusBadge view={statusView} className="w-fit" />
          </div>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-1.5">
            <Cpu aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <Text variant="meta" tone="muted" className="truncate" title={run.model}>
              {run.model}
            </Text>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <Text variant="meta" tone="muted" className="tabular-nums">
              {relativeTime(run.run.startedAt)}
            </Text>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 border-t border-border p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start font-normal"
            disabled={run.isBaseline || !canSetBaseline}
            onClick={() => {
              onSetBaseline();
              setOpen(false);
            }}
          >
            <Anchor aria-hidden />
            <span>{run.isBaseline ? "Baseline" : "Set as baseline"}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start font-normal text-destructive"
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
          >
            <X aria-hidden />
            <span>Remove from comparison</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The comparability-caveats chip (§3.1 C2) — `⚠ n` in the bar; the popover lists the sentences.
 *  Replaces the old permanent 65px warning band for informational caveats. */
function CaveatChip({ caveats }: { caveats: CompareCaveat[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 font-normal"
          aria-label={`${caveats.length} comparability caveat${caveats.length === 1 ? "" : "s"} — these runs are not directly comparable`}
        >
          <AlertTriangle aria-hidden className="size-3.5 text-warning" />
          <span className="tabular-nums">{caveats.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
          <Text className="font-medium">Not directly comparable</Text>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {caveats.map((caveat, index) => (
            <li key={`${caveat.kind}-${index}`}>
              <Text variant="meta" className="text-pretty">
                {caveat.text}
              </Text>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The Export split (§3.1) — a menu button offering the Markdown + JSON client-side comparison
 *  reports (reuses the pure builders in `next-steps/compare-export`). Disabled below two runs. */
function ExportMenu({ runs, disabled }: { runs: WorkspaceRun[]; disabled: boolean }) {
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportMarkdown = () =>
    downloadText(
      `run-comparison-${stamp()}.md`,
      "text/markdown",
      buildComparisonMarkdown(runs, null),
    );
  const exportJson = () =>
    downloadText(
      `run-comparison-${stamp()}.json`,
      "application/json",
      buildComparisonJson(runs, null),
    );

  // The trigger keeps its visible "Export" label + chevron (it is a text-bearing action, not an
  // icon-only control — D-TB5 only mandates IconButton for icon-only). D-6/D-7: the disabled REASON
  // moves off the weak, AT-invisible native `title` onto a themed Radix tooltip (Radix wires
  // aria-describedby when it opens on focus); the focusable wrapper span makes it reachable while the
  // button is disabled (pointer-events-none), mirroring IconButton's own disabled-trigger pattern.
  const triggerContent = (
    <>
      <Download aria-hidden />
      <span>Export</span>
      <ChevronDown aria-hidden className="opacity-70" />
    </>
  );
  return (
    <DropdownMenu>
      {disabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The wrapper span IS the actual Radix trigger; a DYNAMIC `tabIndex` (not a bare literal)
                makes it keyboard/SR-focusable so the disabled button's reason tooltip is reachable —
                the exact pattern the IconButton primitive uses. */}
            <span
              tabIndex={disabled ? 0 : undefined}
              className="inline-flex cursor-not-allowed rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Button variant="outline" size="sm" disabled tabIndex={-1} className="pointer-events-none">
                {triggerContent}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Add a second run to export a comparison</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {triggerContent}
          </Button>
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportMarkdown}>
          <Download aria-hidden />
          <span>Markdown (.md)</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportJson}>
          <FileJson aria-hidden />
          <span>JSON (.json)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Summary|Flow|Metrics segmented control — `@elabs-ai/components-ui` `ToggleGroup` (single-select, sticky).
 *  A `soon` mode (D2 — {@link MODE_SOON}) stays fully clickable; a small muted `Badge` beside its
 *  label sets the expectation before the click, so its honest "coming soon" content is a confirmation
 *  rather than a surprise. */
function ModeToggle({
  mode,
  disabled,
  onModeChange,
}: {
  mode: CompareMode;
  disabled: boolean;
  onModeChange: (mode: CompareMode) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      disabled={disabled}
      aria-label="Comparison mode"
      onValueChange={(next) => {
        // Clicking the active segment emits "" — keep the selection sticky (always one mode).
        if (next && (RUN_COMPARE_MODES as readonly string[]).includes(next))
          onModeChange(next as CompareMode);
      }}
      className="w-fit"
    >
      {RUN_COMPARE_MODES.map((value) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={MODE_SOON[value] ? `${MODE_LABEL[value]} (coming soon)` : MODE_LABEL[value]}
        >
          <span className="flex items-center gap-1.5">
            {MODE_LABEL[value]}
            {MODE_SOON[value] ? (
              <Badge variant="outline" className="font-normal">
                Soon
              </Badge>
            ) : null}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The "+ Add run" filterable popover — same-test runs by default, other tests behind a toggle. */
function AddRunPopover({
  data,
  testId,
  selectedIds,
  disabled,
  onAddRun,
}: {
  data: CompareData;
  testId: string | null;
  selectedIds: Set<string>;
  disabled: boolean;
  onAddRun: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [includeOtherTests, setIncludeOtherTests] = useState(testId == null);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.runs]
      .filter((run) => !selectedIds.has(run.id))
      .filter((run) => includeOtherTests || testId == null || run.testId === testId)
      .filter((run) => (q ? matchesQuery(run, data, q) : true))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }, [data, testId, selectedIds, includeOtherTests, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          title={disabled ? `Up to ${MAX_COMPARE_RUNS} runs` : undefined}
        >
          <Plus aria-hidden />
          <span>Add run</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Filter runs…"
            label="Filter runs to add"
          />
          <label className="flex items-center gap-2">
            <Switch
              checked={includeOtherTests}
              onCheckedChange={setIncludeOtherTests}
              disabled={testId == null}
            />
            <Text variant="meta" tone="muted">
              {testId == null ? "Showing runs from all tests" : "Include runs from other tests"}
            </Text>
          </label>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {candidates.length === 0 ? (
            <li className="px-2 py-6 text-center">
              <Text variant="meta" tone="muted">
                No more runs to add.
              </Text>
            </li>
          ) : (
            candidates.map((run) => {
              const crossTest = testId != null && run.testId !== testId;
              return (
                <li key={run.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full items-center justify-start gap-2 px-2 py-1.5 text-left font-normal"
                    onClick={() => {
                      onAddRun(run.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <GitCompareArrows
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Text className="truncate font-medium">
                        {data.scenariosById.get(run.scenarioId)?.name ?? "Unknown environment"}
                      </Text>
                      <Text variant="meta" tone="muted" className="truncate tabular-nums">
                        {data.scenariosById.get(run.scenarioId)?.model ?? "—"} ·{" "}
                        {relativeTime(run.startedAt)}
                        {crossTest
                          ? ` · ${data.testsById.get(run.testId)?.name ?? "other test"}`
                          : ""}
                      </Text>
                    </span>
                    {crossTest ? (
                      <Badge variant="warning" className="shrink-0 font-normal">
                        other test
                      </Badge>
                    ) : null}
                    <StatusBadge
                      view={runStatusBadgeView(
                        run.status,
                        run.outcome,
                        run.ratingState,
                        run.stopReasonCode,
                        run.phase,
                      )}
                    />
                  </Button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function matchesQuery(run: RunSummary, data: CompareData, q: string): boolean {
  const scenario = data.scenariosById.get(run.scenarioId);
  const test = data.testsById.get(run.testId);
  const haystack = [scenario?.name, scenario?.model, test?.name, run.status, run.outcome]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
