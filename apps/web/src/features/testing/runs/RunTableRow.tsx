import { Fragment, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { RunGrade, RunSummary } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TableCell,
  TableRow,
  Text,
} from "@elabs-ai/components-ui";
import { ChevronDown, ChevronRight, MoreHorizontal, Pin, PinOff, RotateCcw } from "lucide-react";
import {
  formatCostUsd,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelativeTime,
} from "../../../lib/format";
import { IconButton } from "../../../components/IconButton";
import { StatusBadge } from "../../../components/StatusBadge";
import {
  SubscriptionCostMarker,
  isSubscriptionReference,
} from "../../../components/SubscriptionCostMarker";
import { BaseVerdictChip } from "../BaseVerdictChip";
import { FeedbackChips } from "../FeedbackControl";
import { GradeChip } from "../GradeChip";
import { runStatusBadgeView } from "../RunBar";
import { pinCell } from "./pinning";
import { RunPreviewRow } from "./RunPreviewRow";
import {
  ActiveDurationCell,
  LastActivityCell,
  SeenMarker,
  SessionKindChip,
  WaitingCell,
} from "./SessionColumnCells";
import {
  ALL_RUN_TABLE_COLUMNS,
  runTableColumnCount,
  type PreviewMode,
  type RunTableColumnKey,
} from "./run-columns";

/**
 * One standalone single run as an interactive-table `<TableRow>` (Runs feed · WP 2.4).
 *
 * Drill-in (T1): the WHOLE ROW opens the run console — mouse via the row `onClick`, keyboard via the
 * Name-cell ghost button (a real focusable control), so there is one obvious "open" for the most
 * common row type. The old "Replay"/"Open console" verb is gone; re-EXECUTION is the explicit
 * "Re-run…" item in the row's overflow menu, never the row's default gesture.
 *
 * Layout: Name (pinned left) · one Type tag (T3 — the "Single + mode" double-pill is dropped; mode
 * lives in the console header) · Environment · Status · Turns · Tools · Tokens · Cost · [Grade?] ·
 * Started · Duration · Actions (pinned right). Single runs sit on the `card` surface, so the pinned
 * cells fill with `bg-card` to match (see {@link pinCell}).
 */
export function RunTableRow({
  run,
  testName,
  scenarioName,
  scenarioModel,
  grades,
  showGrade,
  selected,
  onToggleSelected,
  onOpen,
  onRerun,
  visible,
  pinned,
  onTogglePinned,
  previewMode = "none",
  previewOpen = false,
  onTogglePreview,
}: {
  run: RunSummary;
  testName: string | undefined;
  scenarioName: string | undefined;
  /** The scenario's model string (Sessions lens Kind column, WP 2.4) — `undefined` when the
   *  scenario is unknown/deleted; the Kind chip then falls back to "—" unless the run carries a
   *  named-assistant `capabilities.identity` (D-US4 — capability-gated, not a `providerKind` fork). */
  scenarioModel?: string;
  grades: RunGrade[];
  showGrade: boolean;
  selected: boolean;
  onToggleSelected: (on: boolean) => void;
  onOpen: () => void;
  onRerun: () => void;
  /** Column visibility (Observability WP 2.3) — `undefined` shows every optional column. */
  visible?: Set<RunTableColumnKey>;
  /** Retention pin (WP 1.6 API, wired here by WP 2.3) — omit BOTH to hide the pin control entirely
   *  (used only by the one existing test that predates pinning; every real caller wires both). */
  pinned?: boolean;
  onTogglePinned?: (next: boolean) => void;
  /** The column chooser's "preview cell" content source; `"none"` (default) renders no disclosure. */
  previewMode?: PreviewMode;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}) {
  const show = (key: RunTableColumnKey) => visible === undefined || visible.has(key);
  const tokens = run.tokensIn + run.tokensOut;
  const checkboxId = `runs-row-${run.id}`;
  const name = testName ?? "Unknown test";
  // AR11 — review-aware: a terminal run still being rated reads "Reviewing…" (from the persisted
  // `ratingState` on the list payload — no stream/polling needed for a plain row). WP3.fix (D-US5) —
  // threads `stopReasonCode`/`phase` too, so the chip renders the LOCKED table's precise label/tone
  // (e.g. "Expired" gray, not "Stopped (guardrail)" amber).
  const statusView = runStatusBadgeView(
    run.status,
    run.outcome,
    run.ratingState,
    run.stopReasonCode,
    run.phase,
  );

  // The row `onClick` is a mouse convenience; keyboard open is the Name-cell ghost button (a real
  // focusable control). Interactive children (checkbox, menu, the name/Open buttons) stop propagation
  // on their OWN handler so they don't double-fire the open — kept off wrapper DOM nodes so the click
  // guard rides an accessible control rather than a bare div (a11y lint).
  const canPreview = previewMode !== "none" && onTogglePreview !== undefined;

  // Run rows are links, not buttons (P1) — the Name/Open controls used to be plain `<button>`s, so a
  // queue of 200 had no cmd-click, no copy-link, no middle-click to open a run in a new tab. Both are
  // now real anchors to the run console route. A PLAIN left click still defers to `onOpen()` (the
  // parent's existing open logic — e.g. RunsView's "test/environment still exists" guard), so that
  // behavior is unchanged; a modified click (⌘/Ctrl/Shift/middle button) is left to the browser's own
  // native anchor handling (new tab, background tab, "copy link", …), which a `<button>` could never
  // offer. `stopPropagation` always runs so the wrapping row's own `onClick` never double-fires.
  const runHref = `/testing/runs/${run.id}`;
  function handleOpenLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    const isPlainLeftClick =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!isPlainLeftClick) return; // let the browser open it natively (new tab, background tab, …)
    event.preventDefault();
    onOpen();
  }

  return (
    <Fragment>
      <TableRow
        data-state={selected ? "selected" : undefined}
        onClick={onOpen}
        className="cursor-pointer"
      >
        {/* Pinned-left identity cell: select + (expand-preview chevron, or a spacer) + name. */}
        <TableCell className={pinCell("left", "card")}>
          <div className="flex items-center gap-2">
            <Checkbox
              id={checkboxId}
              checked={selected}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={(value) => onToggleSelected(value === true)}
              aria-label={`Select ${name} for comparison`}
            />
            {canPreview ? (
              <IconButton
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePreview?.();
                }}
                aria-expanded={previewOpen}
                label={previewOpen ? `Collapse preview for ${name}` : `Expand preview for ${name}`}
              >
                {previewOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              </IconButton>
            ) : (
              <span className="size-8 shrink-0" aria-hidden />
            )}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 max-w-[16rem] flex-1 justify-start px-1.5 py-1 text-left font-medium"
            >
              <Link to={runHref} onClick={handleOpenLinkClick} aria-label={`Open ${name} run console`}>
                <span className="truncate">{name}</span>
              </Link>
            </Button>
          </div>
        </TableCell>
        {show("type") ? (
          <TableCell>
            <Badge variant="outline" className="font-normal">
              Single
            </Badge>
          </TableCell>
        ) : null}
        {show("environment") ? (
          <TableCell
            className="max-w-[12rem] truncate text-muted-foreground"
            title={scenarioName ?? "Unknown environment"}
          >
            {scenarioName ?? "Unknown environment"}
          </TableCell>
        ) : null}
        {/* Sessions lens (Observability WP 2.4) — additive, preset-only columns. */}
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
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge view={statusView} />
              {/* Observability WP 2.5 (D-OB15) — the feed's "chip in the row" (RUN-level only; a
                  read-only summary, distinct in shape/variant from the Grade cell's chips). */}
              <FeedbackChips feedback={run.feedback} />
            </div>
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
            {/* Claude subscription (WP 3.1, D-CS4) — a subscription run's cost is a shadow-price
                estimate; mark it "est." (marginal cost $0). Ordinary runs show the number alone. */}
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
          <TableCell>
            {/* AR6 (WP 3.2) — the base-rating verdict chip renders ALONGSIDE the expectation GradeChip,
                never inside it: two sibling chips, each its own dimension. Either may render nothing
                (GradeChip when the run has no expectation grade; BaseVerdictChip reads its own "Not
                rated" state), so the cell never goes visually empty when only one dimension has data. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <GradeChip latest={grades} />
              <BaseVerdictChip latest={grades} />
            </div>
          </TableCell>
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
          <div className="flex items-center justify-end gap-1">
            {onTogglePinned ? (
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePinned(!pinned);
                }}
                aria-pressed={pinned === true}
                label={pinned ? `Unpin ${name}` : `Pin ${name}`}
              >
                {pinned ? (
                  <Pin aria-hidden className="fill-current" />
                ) : (
                  <PinOff aria-hidden className="text-muted-foreground" />
                )}
              </IconButton>
            ) : null}
            {/* Deliberately NO `aria-label` here (unlike the Name-cell link) — its accessible name
                stays the plain visible text "Open", so the row doesn't carry two identically-named
                "Open <name> run console" controls for a screen-reader user. */}
            <Button asChild variant="outline" size="sm">
              <Link to={runHref} onClick={handleOpenLinkClick}>
                Open
              </Link>
            </Button>
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
                <DropdownMenuItem onSelect={onRerun}>
                  <RotateCcw aria-hidden />
                  <span>Re-run…</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
      {canPreview && previewOpen ? (
        <RunPreviewRow run={run} mode={previewMode} colSpan={colSpanFor(showGrade, visible)} />
      ) : null}
    </Fragment>
  );
}

/**
 * P0 mobile audit T4 (2026-07-25 critique) — one standalone run as a tappable `@elabs-ai/components-ui` Card, for
 * the Runs feed's mobile (< 768px) card list (`RunsView.tsx`'s `MobileRunCards`). Measured defect: at
 * 390px the desktop table's pinned Name/Actions columns kept their sticky geometry over a horizontal-
 * scroll region nobody could reach (the companion fix in `lib/table.tsx` addresses the OTHER wide
 * table on this surface, the dashboard/issues DataTables — this table is `@elabs-ai/components-ui` `Table`, not
 * `@elabs-ai/components-data` DataTable, so it gets a dedicated mobile layout instead), and multiple runs of the same
 * test read identically once every other column scrolled out of reach ("three consecutive rows read
 * 'barc-flights' with nothing to distinguish them"). This card renders the SAME primitives
 * `RunTableRow` uses (`runStatusBadgeView`, `GradeChip`, `BaseVerdictChip`, `formatCostUsd`) so a run
 * reads identically on either surface — five fields instead of eleven columns: name, status, grade,
 * cost, and a relative "started" time (the full timestamp is still reachable via `title`).
 *
 * Whole-card tap opens the run (mirrors the desktop row's whole-row click); the pin toggle and the
 * "…" re-run menu are real nested `<button>`s that stop their own click from bubbling to the card —
 * the same "card is a big button with a nested secondary action" pattern `AgentCard.tsx` already uses
 * (a real `<button>` can't nest another interactive control, so `role="button"` + `tabIndex` + a
 * manual Enter handler stand in; both nested controls stay independently Tab-reachable).
 */
export function RunSummaryCard({
  run,
  testName,
  grades,
  onOpen,
  onRerun,
  pinned,
  onTogglePinned,
}: {
  run: RunSummary;
  testName: string | undefined;
  grades: RunGrade[];
  onOpen: () => void;
  /** Omit to hide the "…" re-run menu entirely. */
  onRerun?: () => void;
  /** Omit BOTH (with `onTogglePinned`) to hide the pin toggle entirely. */
  pinned?: boolean;
  onTogglePinned?: (next: boolean) => void;
}) {
  const name = testName ?? "Unknown test";
  const statusView = runStatusBadgeView(
    run.status,
    run.outcome,
    run.ratingState,
    run.stopReasonCode,
    run.phase,
  );

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    // A portaled dropdown-menu item's click still bubbles up the REACT tree to this handler even
    // though its DOM lives under document.body (Radix portals content out; React does not) — see
    // AgentCard's identical guard. Don't also open the run for a click that landed in the menu.
    if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
    onOpen();
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Only react to Enter on the CARD ITSELF — a nested control's own keydown bubbles here too and
    // must not double-fire `onOpen`.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <Card
      interactive
      // biome-ignore lint/a11y/useSemanticElements: a real <button> can't contain the nested pin/menu
      // controls below — the same escape hatch AgentCard.tsx already uses; both nested controls stay
      // independently reachable via Tab.
      role="button"
      aria-label={`Open ${name} run console`}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-2 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <Text className="min-w-0 flex-1 truncate font-medium">{name}</Text>
        {onTogglePinned || onRerun ? (
          <div className="flex shrink-0 items-center gap-1">
            {onTogglePinned ? (
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePinned(!pinned);
                }}
                aria-pressed={pinned === true}
                label={pinned ? `Unpin ${name}` : `Pin ${name}`}
              >
                {pinned ? (
                  <Pin aria-hidden className="fill-current" />
                ) : (
                  <PinOff aria-hidden className="text-muted-foreground" />
                )}
              </IconButton>
            ) : null}
            {onRerun ? (
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
                  <DropdownMenuItem onSelect={onRerun}>
                    <RotateCcw aria-hidden />
                    <span>Re-run…</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge view={statusView} />
        <GradeChip latest={grades} />
        <BaseVerdictChip latest={grades} />
        <FeedbackChips feedback={run.feedback} />
      </div>
      <div className="flex items-center justify-between gap-2 text-meta text-muted-foreground">
        <span className="tabular-nums" title={formatDateTime(run.startedAt)}>
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums text-foreground">
          {isSubscriptionReference(run.costBasis) ? (
            <>
              <span>{formatCostUsd(run.costUsd)}</span>
              <SubscriptionCostMarker />
            </>
          ) : (
            formatCostUsd(run.costUsd)
          )}
        </span>
      </div>
    </Card>
  );
}

/** Total rendered column count for THIS row (Name + Actions + visible optional columns + Grade?) — used
 *  only for the injected preview sub-row's `colSpan` (must match however many `<TableCell>`s the row
 *  above actually rendered). `visible === undefined` ⇒ every RECOGNIZED column shows (today's shape,
 *  now including the Sessions-lens-only columns, WP 2.4 — `show()` above treats `undefined` the same
 *  way, so this must too or the injected preview row's `colSpan` under-counts). */
function colSpanFor(showGrade: boolean, visible: Set<RunTableColumnKey> | undefined): number {
  return runTableColumnCount(showGrade, visible === undefined ? ALL_RUN_TABLE_COLUMNS : [...visible]);
}
