import { Button, Checkbox, TableHead, TableRow, cn } from "@elabs-ai/components-ui";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { RunTableColumnKey } from "./run-columns";
import type { SortDir, SortKey } from "./runs-table-model";
import { pinCell, stickyHeadClass } from "./pinning";

/** The active sort + its setter. Absent ⇒ a plain (non-sortable) header — the suite-console Runs tab
 *  renders a few dozen rows grouped by test, so it doesn't need column sorting. */
export type RunsSort = { sortKey: SortKey; sortDir: SortDir; onSort: (key: SortKey) => void };

/** A select-all control for the pinned Name header (Runs feed only). Absent ⇒ no header checkbox —
 *  the suite-console Runs tab has no bulk-select. `checked` carries the tri-state (indeterminate). */
export type RunsSelectAll = {
  checked: boolean | "indeterminate";
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean;
};

/**
 * The shared Runs-table header row — the single source of the column set + order (keep in sync with
 * {@link import("./runs-table-model").runsColumnCount}):
 *   Name(+select+expand, pinned left) · Type · Environment · [Kind · Active · Waiting · Last activity ·
 *   Seen — Sessions lens, WP 2.4] · Status · Turns · Tools · Tokens · Cost · [Grade?] · Started ·
 *   Duration · Actions(pinned right).
 * Used by BOTH the unified Runs feed (with `sort`, so headers are sortable) and the suite-run console's
 * Runs tab (without `sort`, plain labels — that caller passes an explicit `visible` restricted to the
 * base 9 columns, so the Sessions-only columns never render there; see `SuiteMembersTab`). The Grade
 * column is dropped when nothing in view is graded.
 */
export function RunsTableHead({
  showGrade,
  sort,
  selectAll,
  visible,
}: {
  showGrade: boolean;
  sort?: RunsSort;
  selectAll?: RunsSelectAll;
  /**
   * Column visibility (Observability WP 2.3's column chooser) — `undefined` shows every optional
   * column (today's behavior, unchanged). Only `RunsView` (the unified Runs feed) ever passes a real
   * set; the suite-run console's Runs tab (`SuiteMembersTab`) calls this with `showGrade` alone.
   */
  visible?: Set<RunTableColumnKey>;
}) {
  const show = (key: RunTableColumnKey) => visible === undefined || visible.has(key);
  return (
    <TableRow>
      <TableHead className={cn(stickyHeadClass("card"), pinCell("left", "card", { header: true }))}>
        <div className="flex items-center gap-2">
          {selectAll ? (
            <Checkbox
              aria-label="Select all runs"
              checked={selectAll.checked}
              disabled={selectAll.disabled}
              onCheckedChange={(value) => selectAll.onCheckedChange(value === true)}
            />
          ) : null}
          <HeadLabel label="Name" columnKey="name" sort={sort} />
        </div>
      </TableHead>
      {show("type") ? <ColHead label="Type" columnKey="type" sort={sort} /> : null}
      {show("environment") ? <ColHead label="Environment" columnKey="environment" sort={sort} /> : null}
      {/* Sessions lens (Observability WP 2.4) — additive, preset-only columns; not sortable via the
          general `SortKey` machinery (no matching `TopRowVM` field), so plain (non-sort-button)
          headers via {@link PlainColHead}. */}
      {show("kind") ? <PlainColHead label="Kind" /> : null}
      {show("activeDuration") ? <PlainColHead label="Active" numeric /> : null}
      {show("waiting") ? <PlainColHead label="Waiting" numeric /> : null}
      {show("lastActivity") ? <PlainColHead label="Last activity" /> : null}
      {show("seen") ? <PlainColHead label="Seen" /> : null}
      {show("status") ? <ColHead label="Status" columnKey="status" sort={sort} /> : null}
      {show("turns") ? <ColHead label="Turns" columnKey="turns" numeric sort={sort} /> : null}
      {show("tools") ? <ColHead label="Tools" columnKey="tools" numeric sort={sort} /> : null}
      {show("tokens") ? <ColHead label="Tokens" columnKey="tokens" numeric sort={sort} /> : null}
      {/* RM-33 — a PLAIN head, not a `ColHead`: `cacheHitRate` is derived per row from the wire
          fields and the runs repository has no sort expression for it, so `SortKey` (correctly) has
          no such member. Rendering a sort control that silently does nothing would be worse than
          rendering none. */}
      {show("cacheHitRate") ? (
        <TableHead className={cn(stickyHeadClass("card"), "whitespace-nowrap", "text-right")}>
          Cache hit
        </TableHead>
      ) : null}
      {show("cost") ? <ColHead label="Cost" columnKey="cost" numeric sort={sort} /> : null}
      {showGrade ? <ColHead label="Grade" columnKey="grade" sort={sort} /> : null}
      {show("started") ? <ColHead label="Started" columnKey="started" sort={sort} /> : null}
      {show("duration") ? <ColHead label="Duration" columnKey="duration" numeric sort={sort} /> : null}
      <TableHead
        className={cn(
          stickyHeadClass("card"),
          pinCell("right", "card", { header: true }),
          "text-right",
        )}
      >
        Actions
      </TableHead>
    </TableRow>
  );
}

/** A non-pinned header cell that sticks to the top of the scroll region (S22); sortable iff `sort` is set. */
function ColHead({
  label,
  columnKey,
  numeric,
  sort,
}: {
  label: string;
  columnKey: SortKey;
  numeric?: boolean;
  sort?: RunsSort;
}) {
  const active = sort?.sortKey === columnKey;
  return (
    <TableHead
      className={cn(stickyHeadClass("card"), "whitespace-nowrap", numeric && "text-right")}
      aria-sort={sort && active ? (sort.sortDir === "asc" ? "ascending" : "descending") : undefined}
    >
      <HeadLabel label={label} columnKey={columnKey} numeric={numeric} sort={sort} />
    </TableHead>
  );
}

/** A non-sortable, non-pinned header cell (Sessions lens columns, WP 2.4 — no matching `SortKey`/
 *  `TopRowVM` field exists for these yet, so no sort button; still sticks to the scroll region, S22). */
function PlainColHead({ label, numeric }: { label: string; numeric?: boolean }) {
  return (
    <TableHead className={cn(stickyHeadClass("card"), "whitespace-nowrap", numeric && "text-right")}>
      <span className={cn("font-medium", numeric && "block text-right")}>{label}</span>
    </TableHead>
  );
}

/** The header label — a sort button when `sort` is set, else a plain (numeric-aligned) text label. */
function HeadLabel({
  label,
  columnKey,
  numeric,
  sort,
}: {
  label: string;
  columnKey: SortKey;
  numeric?: boolean;
  sort?: RunsSort;
}) {
  if (!sort) {
    return <span className={cn("font-medium", numeric && "block text-right")}>{label}</span>;
  }
  const active = sort.sortKey === columnKey;
  const Icon = !active ? ArrowUpDown : sort.sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => sort.onSort(columnKey)}
      className={cn(
        "-my-1 h-8 gap-1 px-2 font-medium",
        numeric ? "w-full justify-end" : "justify-start",
      )}
    >
      <span>{label}</span>
      <Icon aria-hidden className={cn("size-3.5", active ? "opacity-90" : "opacity-40")} />
    </Button>
  );
}
