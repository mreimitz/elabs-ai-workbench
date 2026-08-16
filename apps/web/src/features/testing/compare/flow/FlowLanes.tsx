import { useEffect, useRef, useState } from "react";
import { Button, Text, cn } from "@brand/ui";
import { ChevronsUpDown, Flag } from "lucide-react";
import { StatusBadge } from "../../../../components/StatusBadge";
import { runStatusBadgeView } from "../../RunBar";
import { runChipLabel } from "../compare-runs";
import { RunLetterBadge } from "../RunLetterBadge";
import { LaneCell } from "./LaneCell";
import { ResultSection } from "./ResultSection";
import { groupIdForColumn } from "./collapse";
import { columnCellDiffs, columnDiff, heatLevel } from "./flow-derive";
import {
  parseFocusToken,
  type AlignedColumn,
  type ColumnDiff,
  type DisplayRow,
  type FlowLane,
  type FlowNode,
} from "./flow-types";

/** The column-roll-up → the gutter rail colour (D-UX9). */
const COLUMN_RAIL: Record<ColumnDiff, string> = {
  unchanged: "bg-border",
  changed: "bg-warning",
  gap: "bg-primary",
};

/**
 * The aligned-lanes diff (audit §H4). Rendered as ONE CSS-grid table — the gutter + one column per
 * run — so vertical scroll is inherently synchronized (the lanes are locked columns of one grid, not
 * separate scroll panes). Rows are the aligned columns (session preamble, per-turn `Turn N` separators,
 * LCS-aligned step columns) — collapsed, per WP-4/F3, into `rows`: consecutive all-unchanged step
 * columns render as one `── N identical steps ──` row until expanded ({@link groupIdForColumn},
 * `flow/collapse.ts`). A divergence banner is injected at the first column where the runs split; each
 * step cell carries its D-UX9 add/remove/changed tint. The divergence column is by definition never
 * `unchanged`, so it is never eligible for collapse — it can't hide inside a collapsed group.
 */
export function FlowLanes({
  lanes,
  rows,
  baselineIdx,
  divergenceId,
  maxTokens,
  costLens,
  skillsLens,
  focus,
  onFocus,
}: {
  lanes: FlowLane[];
  rows: DisplayRow[];
  baselineIdx: number;
  divergenceId: string | null;
  maxTokens: number;
  costLens: boolean;
  skillsLens: boolean;
  focus: string | null;
  onFocus: (token: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const parsedFocus = parseFocusToken(focus);

  // Which collapsed groups are currently expanded. Seeded from an incoming `?focus=` so a deep link
  // into a would-be-collapsed region starts revealed (F3 acceptance — focus auto-expand).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    if (!parsedFocus) return new Set();
    const groupId = groupIdForColumn(rows, parsedFocus.columnId);
    return groupId ? new Set([groupId]) : new Set();
  });

  // A focus token can also arrive/change AFTER mount (a verdict-band reason jump, a shared link
  // opened while already on this page, or `rows` re-deriving under a `Changes only` toggle) — keep
  // its containing group expanded whenever that happens.
  useEffect(() => {
    if (!parsedFocus) return;
    const groupId = groupIdForColumn(rows, parsedFocus.columnId);
    if (!groupId) return;
    setExpandedGroups((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
  }, [parsedFocus?.columnId, rows]);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Honor an incoming focus token (from a verdict-band reason / a shared link): scroll the focused
  // column into view. The drill-loop drawer itself lands in WP 4.4. Depends on `expandedGroups` too
  // so the scroll re-runs once a just-expanded group has actually rendered its member columns.
  useEffect(() => {
    if (!parsedFocus || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-col-id="${parsedFocus.columnId}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [parsedFocus?.columnId, expandedGroups]);

  const gridTemplateColumns = `2.25rem repeat(${lanes.length}, minmax(15rem, 1fr))`;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="w-full">
        {/* Lane header — sticky, one card per run (letter · identity · outcome). z-20: above the
            sticky-left gutter/label elements below (z-10) where a scrolled-down + scrolled-right
            position would otherwise make them fight for the same top-left corner. */}
        <div
          className="sticky top-0 z-20 grid gap-2 border-b border-border bg-background pb-2"
          style={{ gridTemplateColumns }}
        >
          <div aria-hidden />
          {lanes.map((lane) => (
            <div
              key={lane.letter}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5",
                lane.isBaseline && "border-primary/60",
              )}
            >
              <RunLetterBadge
                letter={lane.letter}
                color={lane.color}
                baseline={lane.isBaseline}
                size="md"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <Text variant="caption" className="min-w-0 truncate font-medium">
                  {runChipLabel(lane.run)}
                </Text>
                <div className="flex items-center gap-1.5">
                  {/* WP3.fix (D-US5) — the run's OWN precise locked-table chip. */}
                  <StatusBadge
                    view={runStatusBadgeView(
                      lane.run.run.status,
                      lane.run.run.outcome,
                      lane.run.run.ratingState,
                      lane.run.run.stopReasonCode,
                      lane.run.run.phase,
                    )}
                  />
                  {lane.isBaseline && (
                    <Text variant="caption" tone="muted">
                      baseline
                    </Text>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* The aligned rows — a `column` renders as before; a `group` collapses a run of consecutive
            all-unchanged steps (WP-4/F3) until expanded. */}
        <div className="flex flex-col gap-1.5 pt-2">
          {rows.map((row) =>
            row.type === "group" ? (
              <GroupRow
                key={row.id}
                row={row}
                expanded={expandedGroups.has(row.id)}
                onToggle={() => toggleGroup(row.id)}
                lanes={lanes}
                baselineIdx={baselineIdx}
                gridTemplateColumns={gridTemplateColumns}
                divergenceId={divergenceId}
                maxTokens={maxTokens}
                costLens={costLens}
                skillsLens={skillsLens}
                focus={parsedFocus}
                onFocus={onFocus}
              />
            ) : (
              <ColumnRow
                key={row.column.id}
                col={row.column}
                lanes={lanes}
                baselineIdx={baselineIdx}
                gridTemplateColumns={gridTemplateColumns}
                divergenceId={divergenceId}
                maxTokens={maxTokens}
                costLens={costLens}
                skillsLens={skillsLens}
                focus={parsedFocus}
                onFocus={onFocus}
              />
            ),
          )}
        </div>

        {/* The common Result section (WP-7 · §3.2·7): the final answer per lane, always aligned under
            the lanes and NEVER subject to "Changes only" collapse (it renders from `lanes`, not the
            collapsed `rows`). Appended after the aligned rows + any terminal block. */}
        <ResultSection lanes={lanes} gridTemplateColumns={gridTemplateColumns} />
      </div>
    </div>
  );
}

function ColumnRow({
  col,
  lanes,
  baselineIdx,
  gridTemplateColumns,
  divergenceId,
  maxTokens,
  costLens,
  skillsLens,
  focus,
  onFocus,
}: {
  col: AlignedColumn;
  lanes: FlowLane[];
  baselineIdx: number;
  gridTemplateColumns: string;
  divergenceId: string | null;
  maxTokens: number;
  costLens: boolean;
  skillsLens: boolean;
  focus: { letter: string; columnId: string } | null;
  onFocus: (token: string | null) => void;
}) {
  const isDivergence = col.id === divergenceId;

  // Turn separator — spans every lane. The gutter cell and the "Turn N" label are sticky-left so
  // they stay readable when the pane is horizontally scrolled (fixes F5): `left-9` on the label
  // offsets it past the 2.25rem rail column so it lands right after the pinned rail instead of
  // sticking to the viewport's true left edge (which would sit under/behind the rail).
  if (col.kind === "turn-header") {
    return (
      <>
        {isDivergence && <DivergenceBanner gridTemplateColumns={gridTemplateColumns} />}
        <div className="grid items-center gap-2 pt-1" style={{ gridTemplateColumns }}>
          <div aria-hidden className="sticky left-0 z-10 bg-background" />
          <div className="col-span-full flex items-center gap-2" style={{ gridColumn: "2 / -1" }}>
            <Text
              variant="meta"
              className="sticky left-9 z-10 shrink-0 bg-background pr-2 font-semibold"
            >
              Turn {col.turnIndex + 1}
            </Text>
            <div className="h-px flex-1 bg-border" />
            {col.present?.map((there, i) =>
              there ? null : (
                <Text key={lanes[i]!.letter} variant="caption" tone="muted">
                  {lanes[i]!.letter} did not reach this turn
                </Text>
              ),
            )}
          </div>
        </div>
      </>
    );
  }

  const cells = col.cells ?? [];
  const diffs = columnCellDiffs(cells, baselineIdx);
  const rollUp = columnDiff(cells);
  const changedPeers: Array<{ letter: string; node: FlowNode }> | undefined =
    rollUp === "changed"
      ? cells.flatMap((node, i) => (node ? [{ letter: lanes[i]!.letter, node }] : []))
      : undefined;

  return (
    <>
      {isDivergence && <DivergenceBanner gridTemplateColumns={gridTemplateColumns} />}
      <div className="grid items-stretch gap-2" style={{ gridTemplateColumns }}>
        {/* Gutter rail — column-level diff colour + a divergence flag. Sticky-left so it never
            clips on h-scroll (fixes F5). */}
        <div className="sticky left-0 z-10 flex items-center justify-center bg-background">
          {isDivergence ? (
            <Flag aria-hidden className="size-4 text-primary" />
          ) : (
            <div className={cn("h-full w-1 rounded-full", COLUMN_RAIL[rollUp])} />
          )}
        </div>
        {cells.map((node, i) => {
          const columnId = col.id;
          const focused = focus?.columnId === columnId && focus.letter === lanes[i]!.letter;
          return (
            <LaneCell
              key={lanes[i]!.letter}
              node={node}
              diff={diffs[i]!}
              columnId={columnId}
              letter={lanes[i]!.letter}
              focused={focused}
              heat={heatLevel(node?.tokens, maxTokens)}
              costLens={costLens}
              skillsLens={skillsLens}
              changedPeers={changedPeers}
              onFocus={onFocus}
            />
          );
        })}
      </div>
    </>
  );
}

/**
 * A collapsed run of consecutive all-unchanged step columns (WP-4/F3). Collapsed: one ~28px full-width
 * row — `── N identical steps ──` — sticky-left gutter-aligned like the turn-header row, so h-scroll
 * doesn't clip it. Expanded: the member columns render exactly as ordinary `ColumnRow`s (same grid,
 * same diff tints, same focus/scroll wiring), plus a trailing "Collapse" affordance. The toggle is a
 * real `Button` (a real `<button>` under the hood, not a div) so it's keyboard-reachable with visible
 * focus — never a div-as-button.
 */
function GroupRow({
  row,
  expanded,
  onToggle,
  lanes,
  baselineIdx,
  gridTemplateColumns,
  divergenceId,
  maxTokens,
  costLens,
  skillsLens,
  focus,
  onFocus,
}: {
  row: Extract<DisplayRow, { type: "group" }>;
  expanded: boolean;
  onToggle: () => void;
  lanes: FlowLane[];
  baselineIdx: number;
  gridTemplateColumns: string;
  divergenceId: string | null;
  maxTokens: number;
  costLens: boolean;
  skillsLens: boolean;
  focus: { letter: string; columnId: string } | null;
  onFocus: (token: string | null) => void;
}) {
  const label = `${row.count} identical step${row.count === 1 ? "" : "s"}`;

  if (!expanded) {
    return (
      <div className="grid items-center gap-2" style={{ gridTemplateColumns }}>
        <div aria-hidden className="sticky left-0 z-10 bg-background" />
        <div style={{ gridColumn: "2 / -1" }}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-expanded={false}
            className="flex h-7 w-full min-w-0 items-center justify-center gap-2 px-2"
          >
            <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <Text variant="caption" tone="muted" className="shrink-0">
              {label}
            </Text>
            <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border/60 p-1.5">
      {row.columns.map((col) => (
        <ColumnRow
          key={col.id}
          col={col}
          lanes={lanes}
          baselineIdx={baselineIdx}
          gridTemplateColumns={gridTemplateColumns}
          divergenceId={divergenceId}
          maxTokens={maxTokens}
          costLens={costLens}
          skillsLens={skillsLens}
          focus={focus}
          onFocus={onFocus}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggle}
        aria-expanded={true}
        className="flex h-7 w-full items-center justify-center gap-2 px-2 text-muted-foreground"
      >
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
        <Text variant="caption" tone="muted">
          Collapse {label}
        </Text>
      </Button>
    </div>
  );
}

function DivergenceBanner({ gridTemplateColumns }: { gridTemplateColumns: string }) {
  // Sticky-left gutter flag + label (fixes F5 — "Runs diverge here" was seen clipped mid-word,
  // e.g. "ge here", once h-scrolled). The label is anchored right after the rail (`left-9`, the
  // rail's 2.25rem width) rather than centered, so it always reads in full regardless of scroll.
  return (
    <div className="grid items-center gap-2 pt-1" style={{ gridTemplateColumns }}>
      <div className="sticky left-0 z-10 flex items-center justify-center bg-background">
        <Flag aria-hidden className="size-4 text-primary" />
      </div>
      <div className="flex items-center gap-2" style={{ gridColumn: "2 / -1" }}>
        <Text
          variant="caption"
          className="sticky left-9 z-10 shrink-0 bg-background pr-2 font-semibold text-primary"
        >
          Runs diverge here
        </Text>
        <div className="h-px flex-1 bg-primary/40" />
      </div>
    </div>
  );
}
