import { columnDiff } from "./flow-derive";
import type { AlignedColumn, DisplayRow } from "./flow-types";

/**
 * Collapse consecutive all-unchanged `node` columns into a single `group` display row (audit §H4/F3
 * — "changes first"). The audited trace was ~85% unchanged rows (9 identical `acme_create_data_object`
 * cards in one turn ≈ 460px of no signal); collapsing lets the diff, not the noise, dominate the view.
 *
 * A column is collapsible only when it is a `kind: "node"` column whose {@link columnDiff} is
 * `"unchanged"` (every lane present, identical outcome — reusing the SAME classifier the cell tinting
 * and the divergence marker use, so a column can never be both "the divergence" and collapsed).
 * `preamble` and `turn-header` columns are never collapsible and always BREAK a run; a `changed` or
 * `gap` node column also breaks a run.
 *
 * - `changesOnly: false` (default view) — only MAXIMAL runs of length >= `minRun` (default 3) collapse;
 *   a run of 1–2 stays as ordinary columns (a 28px group row would cost more chrome than it saves).
 * - `changesOnly: true` — every maximal all-unchanged run collapses, however short (length >= 1).
 *
 * Group ids are stable + deterministic (`grp:<firstColumnId>:<lastColumnId>`) so a run's id is the same
 * regardless of `changesOnly` — the run's boundaries don't move, only the collapse threshold does — and
 * an expanded-group `Set<string>` in the renderer survives a `changesOnly` toggle without losing state.
 *
 * Pure + deterministic → unit-tested in `collapse.test.ts`.
 */
export function collapseColumns(
  columns: AlignedColumn[],
  options: { changesOnly: boolean; minRun?: number },
): DisplayRow[] {
  const minRun = options.minRun ?? 3;
  const threshold = options.changesOnly ? 1 : minRun;

  const rows: DisplayRow[] = [];
  let run: AlignedColumn[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length >= threshold) {
      rows.push(makeGroupRow(run));
    } else {
      for (const column of run) rows.push({ type: "column", column });
    }
    run = [];
  };

  for (const column of columns) {
    if (isCollapsible(column)) {
      run.push(column);
    } else {
      flushRun();
      rows.push({ type: "column", column });
    }
  }
  flushRun();

  return rows;
}

function isCollapsible(column: AlignedColumn): boolean {
  return column.kind === "node" && columnDiff(column.cells ?? []) === "unchanged";
}

function makeGroupRow(columns: AlignedColumn[]): DisplayRow {
  const first = columns[0]!;
  const last = columns[columns.length - 1]!;
  return { type: "group", id: `grp:${first.id}:${last.id}`, columns, count: columns.length };
}

/**
 * The id of the display-row group that contains `columnId`, or `null` when that column isn't inside a
 * collapsed group (either it's visible as its own `column` row, or it doesn't exist in `rows` at all).
 * Used to seed/extend the renderer's expanded-group set so a `?focus=` deep link into a would-be-
 * collapsed region still lands on a visible, scrolled-into-view cell.
 */
export function groupIdForColumn(rows: DisplayRow[], columnId: string): string | null {
  for (const row of rows) {
    if (row.type === "group" && row.columns.some((column) => column.id === columnId)) return row.id;
  }
  return null;
}
