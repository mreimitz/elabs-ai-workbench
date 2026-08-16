import type { AnswersSnapshot } from "@mcp-token-footprint/shared";
import {
  MetricCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  cn,
} from "@brand/ui";
import { ExpandableTable } from "./ExpandableTable";

/**
 * Qlik Answers (WP 5.3, D-QA10) — the CANONICAL renderer for a `Qlik.Snapshot`'s hypercube data.
 * This is the SHARED piece: WP 5.3's answer view (a snapshot block inset) and WP 5.4's SourcesPanel
 * `InsightRow` (the insight's data face) both render through here, so the data reads identically
 * wherever it appears.
 *
 * Contract (D-QA10):
 *   - a **1×1** matrix (one column, one row) → a `MetricCard`, the single value as the metric and its
 *     column label as the metric label;
 *   - **everything else** → a compact `@brand/ui` `Table*` inset, `columns` as headers and `rows` as
 *     cells, numeric columns right-aligned with `tabular-nums`;
 *   - `totalRows > rows.length` → an honest "Showing N of M rows" footer (the 50-row cap trimmed it);
 *   - **no `data`** → renders nothing (the caller — WP 5.4 — owns the title/reason/definition face).
 *
 * Bounds-safe throughout: an empty/ragged matrix never indexes past its arrays.
 */
export type AnswersSnapshotDataProps = {
  snapshot: AnswersSnapshot;
  /**
   * Visual density (layout only — never changes WHAT renders):
   *   - `"inset"` (default) — the answer-flow inline table, roomier scroll height;
   *   - `"panel"` — the tighter form for the SourcesPanel `InsightRow` (WP 5.4).
   */
  variant?: "inset" | "panel";
};

/** Locale number formatting that KEEPS decimals — measure values must not be rounded to integers. */
const CELL_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/** One matrix cell → its display string (numbers grouped + decimal-safe; empty → an em dash). */
function formatDataCell(value: string | number | undefined): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? CELL_NUMBER.format(value) : String(value);
  return value.length > 0 ? value : "—";
}

/** A column is numeric when every present cell in it is a number (so it right-aligns + `tabular-nums`). */
function computeNumericColumns(columns: string[], rows: (string | number)[][]): boolean[] {
  return columns.map((_col, ci) => {
    let sawNumber = false;
    for (const row of rows) {
      const cell = row[ci];
      if (cell === undefined || cell === null || cell === "") continue;
      if (typeof cell !== "number") return false;
      sawNumber = true;
    }
    return sawNumber;
  });
}

export function AnswersSnapshotData({ snapshot, variant = "inset" }: AnswersSnapshotDataProps) {
  const data = snapshot.data;
  // No hypercube → render nothing; the caller owns the snapshot's title/reason/definition face.
  if (!data) return null;

  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  if (columns.length === 0 || rows.length === 0) return null;

  // 1×1 → a single-value MetricCard (D-QA10). The measure label is the metric label.
  if (columns.length === 1 && rows.length === 1) {
    return (
      <MetricCard
        className="min-w-0"
        label={columns[0] ?? "Value"}
        value={<span className="tabular-nums">{formatDataCell(rows[0]?.[0])}</span>}
      />
    );
  }

  const numericColumns = computeNumericColumns(columns, rows);
  const totalRows = data.totalRows;
  const capped = typeof totalRows === "number" && totalRows > rows.length;
  const maxHeight = variant === "panel" ? "max-h-56" : "max-h-80";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ExpandableTable
        title={snapshot.title ?? "Data"}
        downloadName={snapshot.title}
        csv={{ columns, rows }}
        scrollClassName={cn("overflow-auto rounded-md border border-border bg-card", maxHeight)}
      >
        <Table className="text-caption">
          <TableHeader>
            <TableRow>
              {columns.map((column, ci) => (
                <TableHead
                  key={ci}
                  className={cn("h-auto px-2 py-1 align-top", numericColumns[ci] && "text-right")}
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, ri) => (
              <TableRow key={ri}>
                {columns.map((_column, ci) => (
                  <TableCell
                    key={ci}
                    className={cn(
                      "px-2 py-1 align-top",
                      numericColumns[ci] ? "text-right tabular-nums" : "min-w-0",
                    )}
                  >
                    {formatDataCell(row[ci])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ExpandableTable>
      {capped ? (
        <Text variant="meta" tone="muted" className="tabular-nums">
          Showing {rows.length} of {totalRows} rows
        </Text>
      ) : null}
    </div>
  );
}
