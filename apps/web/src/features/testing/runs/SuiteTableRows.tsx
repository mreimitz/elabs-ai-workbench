import { Fragment, type ReactNode } from "react";
import type {
  RunPlanSource,
  RunStatus,
  RunSummary,
  Scenario,
  Test,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  StatusBadge as BrandStatusBadge,
  TableCell,
  TableRow,
  Text,
} from "@elabs-ai/components-ui";
import { IconButton } from "../../../components/IconButton";
import { StatusBadge as AppStatusBadge } from "../../../components/StatusBadge";
import { CLOSED_BADGE_STATUS_TONE } from "../../../lib/status";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Layers,
  MoreHorizontal,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import {
  formatCostUsd,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "../../../lib/format";
import {
  SubscriptionCostMarker,
  isSubscriptionReference,
} from "../../../components/SubscriptionCostMarker";
import { formatGradePercent, SCORE_TONE_TO_BRAND, scoreTone } from "../grade-format";
import { runStatusBadgeStatus, runStatusBadgeView } from "../RunBar";
import { SuiteKpiRail } from "../suites/SuiteKpiRail";
import { suiteStatusBadge } from "../suites/SuiteRunConsole";
import { useSuiteStream } from "../suites/use-suite-stream";
import type { RunTableColumnKey } from "./run-columns";
import type { FeedSuiteItem } from "./runs-api";
import { pinCell } from "./pinning";
import {
  ActiveDurationCell,
  LastActivityCell,
  SeenMarker,
  SessionKindChip,
  WaitingCell,
} from "./SessionColumnCells";

/** Terminal suite statuses — a run in one of these no longer streams (mirrors the suite console). */
const TERMINAL_SUITE_STATUSES = new Set(["completed", "capped", "stopped", "error"]);

/** Source → a badge label + variant. A pre-`source` (legacy) suite run reads as a plain "Suite". */
function sourceBadge(source: RunPlanSource | undefined): {
  label: string;
  variant: "secondary" | "outline";
} {
  switch (source) {
    case "collection":
      return { label: "Collection", variant: "outline" };
    case "adhoc":
      return { label: "Ad-hoc", variant: "outline" };
    default:
      return { label: "Suite", variant: "secondary" };
  }
}

/** A human title for the summary row: the saved suite name, else a source-derived label. Exported so
 *  the Runs-table view-model derivation names the suite row identically to what it renders. */
export function suiteDisplayName(item: FeedSuiteItem): string {
  if (item.suiteName) return item.suiteName;
  switch (item.suiteRun.source) {
    case "collection":
      return "Collection run";
    case "adhoc":
      return "Interactive session";
    default:
      return "Suite run";
  }
}

/** `N test(s) × M environment(s) × R rep(s)` — the matrix shape, pluralized. */
function matrixShape(item: FeedSuiteItem): string {
  const t = `${item.testCount} test${item.testCount === 1 ? "" : "s"}`;
  const e = `${item.environmentCount} environment${item.environmentCount === 1 ? "" : "s"}`;
  const r = `${item.repetitions} rep${item.repetitions === 1 ? "" : "s"}`;
  return `${t} × ${e} × ${r}`;
}

/** True when a member run's derived status reads as a failure (drives the "· N error" rollup, T2). */
function memberFailed(status: RunStatus, outcome: RunSummary["outcome"]): boolean {
  return runStatusBadgeStatus(status, outcome) === "failed";
}

export type SuiteTableRowsProps = {
  item: FeedSuiteItem;
  testsById: Map<string, Test>;
  scenariosById: Map<string, Scenario>;
  /** Number of table columns (Grade dropped when nothing in view is graded) — for the injected rows. */
  colSpan: number;
  /** Whether the Grade column is shown (S9) — the suite summary shows its pass rate there. */
  showGrade: boolean;
  /** The scroll container's visible width (px). The expanded KPI rail is pinned to it so it reads at
   *  VIEWPORT width even when the table overflows horizontally (T2). `undefined` ⇒ natural width. */
  viewportWidth?: number;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Open the full suite-run console (`/testing/suite-runs/:id`) — also the summary row's click. */
  onOpenConsole: () => void;
  /** Re-run this suite through the launcher (only offered for a saved `source:'suite'` run). */
  onRun?: () => void;
  /** Drill into a member's single run console (`/testing/runs/:runId`). */
  onOpenRun: (runId: string) => void;
  selectedRunIds: Set<string>;
  onToggleRunSelected: (runId: string, on: boolean) => void;
  /** Suite-level compare selection (feeds WP 4.6 suite-compare) — the summary row's own checkbox. */
  suiteSelected: boolean;
  onToggleSuiteSelected: (on: boolean) => void;
  /** Column visibility (Observability WP 2.3) — `undefined` shows every optional column. */
  visible?: Set<RunTableColumnKey>;
};

/**
 * One suite run as a collapsible group of interactive-table rows (Runs feed · WP 2.4): a summary
 * `<TableRow>` on the `muted` surface (checkbox · chevron · name · source · N environments · status +
 * "· N error" rollup · rolled-up turns/tools/tokens/cost · [pass rate?] · started · duration · actions)
 * that, when expanded, injects the suite's KPI rail (pinned to the VIEWPORT width so it never clips on
 * a wide table, T2) then the member run rows. Name + Actions are pinned (left/right) with `muted` fills
 * matching the summary row so the middle scrolls cleanly behind them. Returns a fragment of
 * `<TableRow>`s so it slots straight into the shared `<TableBody>` and keeps column alignment.
 *
 * Streaming discipline (loading-states rule): a run non-terminal at load subscribes to its live SSE
 * stream; status + aggregates BUILD UP (a `Skeleton` reserves the metric cells before the first
 * aggregate); the "live" hint shows ONLY on a genuine pre-terminal drop, never as a terminal error.
 */
export function SuiteTableRows({
  item,
  testsById,
  scenariosById,
  colSpan,
  showGrade,
  viewportWidth,
  expanded,
  onToggleExpand,
  onOpenConsole,
  onRun,
  onOpenRun,
  selectedRunIds,
  onToggleRunSelected,
  suiteSelected,
  onToggleSuiteSelected,
  visible,
}: SuiteTableRowsProps) {
  const show = (key: RunTableColumnKey) => visible === undefined || visible.has(key);
  const { suiteRun } = item;
  const persistedTerminal = TERMINAL_SUITE_STATUSES.has(suiteRun.status);
  const stream = useSuiteStream(persistedTerminal ? null : suiteRun.id);

  const status = stream.status ?? suiteRun.status;
  const aggregates = stream.aggregates ?? suiteRun.aggregates ?? null;
  const effectiveTerminal = TERMINAL_SUITE_STATUSES.has(status);
  // AR11 — review-aware summary chip: prefer the live stream's rating events, else the persisted
  // `ratingState` (a plain list row shows "Reviewing…" with no stream at all).
  const badge = suiteStatusBadge(status, stream.ratingState ?? suiteRun.ratingState);
  const src = sourceBadge(suiteRun.source);
  const name = suiteDisplayName(item);

  // Pre-first-aggregate on a still-live run ⇒ reserve the metric cells with a placeholder, not a collapse.
  const metricsPending = !effectiveTerminal && aggregates === null && item.members.length === 0;

  // Outcome rollup (T2): a finished suite reads green "Completed" but may hide failed members — surface
  // the count inline ("Completed · 1 error") so the green badge never contradicts a red member below.
  const errorCount = item.members.reduce(
    (n, m) => n + (memberFailed(m.status, m.outcome) ? 1 : 0),
    0,
  );
  const badgeLabel =
    effectiveTerminal && errorCount > 0
      ? `${badge.label} · ${errorCount} error${errorCount === 1 ? "" : "s"}`
      : badge.label;

  const passRate = aggregates?.passRateAt05 ?? null;
  const turns = item.members.reduce((sum, m) => sum + m.turns, 0);
  const tools = item.members.reduce((sum, m) => sum + m.toolCalls, 0);
  const tokens =
    aggregates?.totalTokens ?? item.members.reduce((sum, m) => sum + m.tokensIn + m.tokensOut, 0);
  const totalCostUsd = aggregates
    ? aggregates.execCostUsd + aggregates.judgeCostUsd
    : item.members.reduce((sum, m) => sum + m.costUsd, 0);
  // Claude subscription (WP 3.1, D-CS4) — mark the suite-aggregate cost "est." when any member run
  // contributed a subscription shadow-price cost (its total is then partly a reference estimate).
  const hasSubscriptionMember = item.members.some((m) => isSubscriptionReference(m.costBasis));
  const durationMs = suiteRun.endedAt
    ? Math.max(0, Date.parse(suiteRun.endedAt) - Date.parse(suiteRun.startedAt))
    : null;

  // The pinned KPI-rail wrapper: constrain to the viewport so wide tables don't push the cards off-screen.
  const railWidth = viewportWidth ? { width: `${viewportWidth}px` } : undefined;

  return (
    <Fragment>
      {/* Summary row — the whole row opens the suite console. */}
      <TableRow className="cursor-pointer bg-muted" onClick={onOpenConsole}>
        {/* Pinned-left identity cell: suite-compare select + expand chevron + name. */}
        <TableCell className={pinCell("left", "muted")}>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={suiteSelected}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={(value) => onToggleSuiteSelected(value === true)}
              aria-label={`Select ${name} for suite comparison`}
            />
            <IconButton
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
              aria-expanded={expanded}
              label={expanded ? `Collapse ${name}` : `Expand ${name}`}
            >
              {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            </IconButton>
            <div className="min-w-0 max-w-[16rem]">
              <div className="flex min-w-0 items-center gap-2">
                <Layers aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">{name}</span>
                {stream.error && !effectiveTerminal ? (
                  <span
                    className="flex shrink-0 items-center gap-1 text-muted-foreground"
                    title={stream.error}
                  >
                    <WifiOff aria-hidden className="size-3.5" />
                    <Text variant="meta" tone="muted">
                      Live
                    </Text>
                  </span>
                ) : null}
              </div>
              <Text variant="meta" tone="muted" className="block truncate tabular-nums">
                {matrixShape(item)}
              </Text>
            </div>
          </div>
        </TableCell>
        {show("type") ? (
          <TableCell>
            <Badge variant={src.variant} className="font-normal">
              {src.label}
            </Badge>
          </TableCell>
        ) : null}
        {show("environment") ? (
          <TableCell className="text-muted-foreground tabular-nums">
            {item.environmentCount} environment{item.environmentCount === 1 ? "" : "s"}
          </TableCell>
        ) : null}
        {/* Sessions lens (Observability WP 2.4) — a suite run is a MATRIX, not one session: Kind/
            active/waiting/seen have no single honest value at this aggregate level, so they render a
            plain dash here (real values still show on each expanded member row below). Last activity
            IS meaningful at the suite level (its own `endedAt`/`startedAt`), so that one is real. */}
        {show("kind") ? <TableCell className="text-muted-foreground">—</TableCell> : null}
        {show("activeDuration") ? (
          <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
        ) : null}
        {show("waiting") ? (
          <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
        ) : null}
        {show("lastActivity") ? (
          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
            <LastActivityCell run={suiteRun} />
          </TableCell>
        ) : null}
        {show("seen") ? <TableCell className="text-muted-foreground">—</TableCell> : null}
        {show("status") ? (
          <TableCell>
            {/* P2-1 (RM-36 WP 2.2) — ONE encoding per column. This row used to render `@elabs-ai/
                components-ui`'s own closed-enum `StatusBadge` (which draws a leading state icon)
                while every child run row below it rendered the app-local one (no icon), so a single
                Status column carried two visual encodings in adjacent rows and read as two meanings.
                The parent/child distinction is already carried by the indent + the expander. The
                suite's own status VOCABULARY and tone are unchanged — `suiteStatusBadge` and its
                tests are untouched; only the chip technology moves onto the shared renderer, via the
                same `CLOSED_BADGE_STATUS_TONE` bridge `SuiteRunConsole`'s header already uses. */}
            <AppStatusBadge
              view={{
                kind: "chip",
                label: badgeLabel,
                tone: CLOSED_BADGE_STATUS_TONE[badge.status],
                spinner: badge.status === "running",
                dashed: badge.status === "pending",
              }}
            />
          </TableCell>
        ) : null}
        {show("turns") ? <MetricCell pending={metricsPending}>{formatNumber(turns)}</MetricCell> : null}
        {show("tools") ? <MetricCell pending={metricsPending}>{formatNumber(tools)}</MetricCell> : null}
        {show("tokens") ? <MetricCell pending={metricsPending}>{formatNumber(tokens)}</MetricCell> : null}
        {show("cost") ? (
          <MetricCell pending={metricsPending}>
            {hasSubscriptionMember ? (
              <span className="inline-flex items-center justify-end gap-1.5">
                <span>{formatCostUsd(totalCostUsd)}</span>
                <SubscriptionCostMarker />
              </span>
            ) : (
              formatCostUsd(totalCostUsd)
            )}
          </MetricCell>
        ) : null}
        {showGrade ? (
          <TableCell>
            {/* P2-1 — ONE encoding per column. The pass rate used to be plain muted text directly
                above child rows whose Grade cell renders CHIPS (`GradeChip`/`BaseVerdictChip`), so
                the same column spoke twice. The number and its meaning are unchanged (same
                `formatPercent`, same "pass" suffix); it now renders on the SAME chip technology and
                the SAME `scoreTone` thresholds `GradeChip` uses, so parent and child read as one
                measure. A suite with no graded members still reads as an em dash, never a red 0. */}
            {passRate === null ? (
              <Text variant="meta" tone="muted" className="tabular-nums">
                —
              </Text>
            ) : (
              <BrandStatusBadge
                status={SCORE_TONE_TO_BRAND[scoreTone(passRate)]}
                size="sm"
                hideIcon
                className="tabular-nums"
              >
                {formatPercent(passRate * 100)} pass
              </BrandStatusBadge>
            )}
          </TableCell>
        ) : null}
        {show("started") ? (
          <TableCell>
            <Text variant="meta" tone="muted" className="whitespace-nowrap tabular-nums">
              {formatDateTime(suiteRun.startedAt)}
            </Text>
          </TableCell>
        ) : null}
        {show("duration") ? (
          <TableCell className="text-right tabular-nums">
            {durationMs === null ? "—" : formatDuration(durationMs)}
          </TableCell>
        ) : null}
        <TableCell className={pinCell("right", "muted")}>
          <div className="flex items-center justify-end gap-1">
            {/* P2-1 — ONE verb per column. This read "Open console" directly above child rows
                whose action reads "Open", for the same gesture (drill into that row's console).
                Same button variant/size as the run rows, so the column has one shape and one word. */}
            <Button
              variant="outline"
              size="sm"
              aria-label={`Open ${name} suite console`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenConsole();
              }}
            >
              Open
            </Button>
            {onRun ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => event.stopPropagation()}
                    label={`More actions for ${name}`}
                  >
                    <MoreHorizontal aria-hidden />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onRun}>
                    <RotateCcw aria-hidden />
                    <span>Re-run suite…</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded: the suite's KPI rail (pinned to the viewport width), then the member run rows. */}
      {expanded ? (
        <Fragment>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="bg-muted/40 p-0">
              <div className="sticky left-0 p-4" style={railWidth}>
                <SuiteKpiRail
                  aggregates={aggregates}
                  costCapUsd={suiteRun.configSnapshot.aggregateCostCapUsd}
                />
              </div>
            </TableCell>
          </TableRow>
          {item.members.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="bg-muted/20 px-0 pb-4 pt-0">
                <div className="sticky left-0 px-4" style={railWidth}>
                  <Text variant="meta" tone="muted">
                    {effectiveTerminal
                      ? "No member runs were recorded for this run."
                      : "Member runs appear here as the matrix executes — open the console for the live matrix."}
                  </Text>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            item.members.map((run) => (
              <MemberRow
                key={run.id}
                run={run}
                testName={testsById.get(run.testId)?.name}
                scenarioName={scenariosById.get(run.scenarioId)?.name}
                scenarioModel={scenariosById.get(run.scenarioId)?.model}
                showGrade={showGrade}
                selected={selectedRunIds.has(run.id)}
                onToggleSelected={(on) => onToggleRunSelected(run.id, on)}
                onOpen={() => onOpenRun(run.id)}
                visible={visible}
              />
            ))
          )}
        </Fragment>
      ) : null}
    </Fragment>
  );
}

/** One member run's OWN status chip — the locked table (D-US5), review-aware (AR11 — "Reviewing…"
 *  until its rating settles). Renders via the app-local `StatusBadge` (not the suite summary row's
 *  closed-enum rollup badge above, which stays a coarser aggregate by design, WP3.R). */
function MemberStatusBadge({ run }: { run: RunSummary }) {
  const view = runStatusBadgeView(
    run.status,
    run.outcome,
    run.ratingState,
    run.stopReasonCode,
    run.phase,
  );
  return <AppStatusBadge view={view} />;
}

/** A right-aligned numeric metric cell that shows a placeholder while a live run has no aggregate yet.
 *  Exported so the suite-run console's per-test group rows render metrics identically to the feed. */
export function MetricCell({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <TableCell className="text-right tabular-nums">
      {pending ? <Skeleton className="ml-auto h-4 w-10" /> : children}
    </TableCell>
  );
}

/**
 * One member run of an expanded suite — an indented, selectable `<TableRow>` that drills to its
 * console (whole-row click). Sits on the `card` surface so the pinned Name/Actions cells match.
 * Exported + reused verbatim by the suite-run console's Runs tab (grouped by test) so the two
 * member-run surfaces stay pixel-identical.
 *
 * `primaryScore` is OPTIONAL: when omitted (the Runs feed, which doesn't fetch member grades) the
 * Grade cell stays an empty spacer; when provided (the console, which has each member's score) it
 * renders the score (or "—" for an ungraded member) — so passing nothing preserves the feed's
 * behavior exactly.
 */
export function MemberRow({
  run,
  testName,
  scenarioName,
  scenarioModel,
  showGrade,
  primaryScore,
  selected,
  onToggleSelected,
  onOpen,
  visible,
}: {
  run: RunSummary;
  testName: string | undefined;
  scenarioName: string | undefined;
  /** The member's scenario model string (Sessions lens Kind column, WP 2.4) — see `RunTableRow`'s
   *  identical prop; omitted by `TestGroupRow`'s reuse (its Kind column never shows there — see
   *  `SuiteMembersTab`'s explicit `visible`), so the Kind chip degrades to "—" for that caller. */
  scenarioModel?: string;
  showGrade: boolean;
  primaryScore?: number | null;
  selected: boolean;
  onToggleSelected: (on: boolean) => void;
  onOpen: () => void;
  /** Column visibility (Observability WP 2.3) — `undefined` shows every optional column (the
   *  suite-run console's `TestGroupRow` reuse, unaffected). */
  visible?: Set<RunTableColumnKey>;
}) {
  const show = (key: RunTableColumnKey) => visible === undefined || visible.has(key);
  const tokens = run.tokensIn + run.tokensOut;
  const checkboxId = `runs-member-${run.id}`;
  const name = testName ?? "Unknown test";
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      onClick={onOpen}
      className="cursor-pointer bg-card"
    >
      {/* Pinned-left identity cell: select + (chevron spacer) + indented member name. */}
      <TableCell className={pinCell("left", "card")}>
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(value) => onToggleSelected(value === true)}
            aria-label={`Select ${name} for comparison`}
          />
          <span className="size-8 shrink-0" aria-hidden />
          <div className="flex min-w-0 max-w-[16rem] items-center gap-1.5 pl-3">
            <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{name}</span>
            {typeof run.repetition === "number" ? (
              <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                rep {run.repetition}
              </Text>
            ) : null}
          </div>
        </div>
      </TableCell>
      {show("type") ? (
        <TableCell>
          <Badge variant="outline" className="font-normal">
            Member
          </Badge>
        </TableCell>
      ) : null}
      {show("environment") ? (
        <TableCell className="max-w-[12rem] truncate text-muted-foreground">
          {scenarioName ?? "Unknown environment"}
        </TableCell>
      ) : null}
      {/* Sessions lens (Observability WP 2.4) — a member run IS one real session, so these render the
          same real cells `RunTableRow` does (via the shared `SessionColumnCells`). */}
      {show("kind") ? (
        <TableCell>
          <SessionKindChip capabilities={run.capabilities} model={scenarioModel} />
        </TableCell>
      ) : null}
      {show("activeDuration") ? (
        <TableCell className="text-right tabular-nums">
          <ActiveDurationCell run={run} />
        </TableCell>
      ) : null}
      {show("waiting") ? (
        <TableCell className="text-right tabular-nums">
          <WaitingCell run={run} />
        </TableCell>
      ) : null}
      {show("lastActivity") ? (
        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
          <LastActivityCell run={run} />
        </TableCell>
      ) : null}
      {show("seen") ? (
        <TableCell>
          <SeenMarker seen={run.seen} />
        </TableCell>
      ) : null}
      {show("status") ? (
        <TableCell>
          <MemberStatusBadge run={run} />
        </TableCell>
      ) : null}
      {show("turns") ? (
        <TableCell className="text-right tabular-nums">{formatNumber(run.turns)}</TableCell>
      ) : null}
      {show("tools") ? (
        <TableCell className="text-right tabular-nums">{formatNumber(run.toolCalls)}</TableCell>
      ) : null}
      {show("tokens") ? (
        <TableCell className="text-right tabular-nums">{formatNumber(tokens)}</TableCell>
      ) : null}
      {show("cost") ? (
        <TableCell className="text-right tabular-nums">
          {/* Claude subscription (WP 3.1, D-CS4) — a subscription member run's cost is a shadow-price
              estimate; mark it "est." (marginal cost $0). */}
          {isSubscriptionReference(run.costBasis) ? (
            <span className="inline-flex items-center justify-end gap-1.5">
              <span>{formatCostUsd(run.costUsd)}</span>
              <SubscriptionCostMarker />
            </span>
          ) : (
            formatCostUsd(run.costUsd)
          )}
        </TableCell>
      ) : null}
      {showGrade ? (
        primaryScore === undefined ? (
          <TableCell aria-hidden />
        ) : (
          <TableCell>
            {/* P2-1 — the same ONE encoding the suite summary row and the standalone run row use:
                a score is a chip toned by `scoreTone`, an absent score is an em dash. */}
            {primaryScore === null ? (
              <Text variant="meta" tone="muted" className="tabular-nums">
                —
              </Text>
            ) : (
              <BrandStatusBadge
                status={SCORE_TONE_TO_BRAND[scoreTone(primaryScore)]}
                size="sm"
                hideIcon
                className="tabular-nums"
              >
                {formatGradePercent(primaryScore)}
              </BrandStatusBadge>
            )}
          </TableCell>
        )
      ) : null}
      {show("started") ? (
        <TableCell>
          <Text variant="meta" tone="muted" className="whitespace-nowrap tabular-nums">
            {formatDateTime(run.startedAt)}
          </Text>
        </TableCell>
      ) : null}
      {show("duration") ? (
        <TableCell className="text-right tabular-nums">
          {run.durationMs != null ? formatDuration(run.durationMs) : "—"}
        </TableCell>
      ) : null}
      <TableCell className={pinCell("right", "card")}>
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            Open
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
