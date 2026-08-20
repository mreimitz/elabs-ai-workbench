import { DataTable, type ColumnDef } from "@elabs-ai/components-data";
import { shouldPaginate } from "../../lib/table";

const PAGE_SIZE = 25;

/**
 * One group's table (RM-32 D-OD3). `DataTable` has no row-grouping feature, so a grouped table is
 * one table PER GROUP under the shared `EntityGroupSection` header rather than a second table
 * implementation. The consequence is honest and stated: sorting is within-group. The `None` grouping
 * exists precisely so cross-row sorting is one click away.
 *
 * Row activation matches the grid (D-OD7) via `DataTable`'s own `onRowClick`, which already adds ONE
 * activation target per row (a visually-hidden button that is the row's keyboard tab stop) and
 * guards clicks that originate on a nested control or end a text-selection drag. That is why this
 * component does NOT also use the app's older `navCol` + `clickableRowTableProps` recipe: the two
 * mechanisms would give every row two activation paths, and a `navCol` cell inside an `onRowClick`
 * table fires both.
 */
export function EntityTable<T>(props: {
  items: T[];
  columns: ColumnDef<T>[];
  onOpen: (item: T) => void;
  rowLabel: (item: T) => string;
  /** Names the table for assistive tech — the group label, or the page's noun when ungrouped. */
  caption: string;
  loading?: boolean;
}) {
  return (
    <DataTable
      data={props.items}
      columns={props.columns}
      caption={props.caption}
      onRowClick={(row) => props.onOpen(row.original)}
      rowActionLabel={(row) => props.rowLabel(row.original)}
      rowClassName={() => "cursor-pointer"}
      enablePagination={shouldPaginate(props.items.length, PAGE_SIZE)}
      pageSize={PAGE_SIZE}
      {...(props.loading !== undefined ? { loading: props.loading } : {})}
    />
  );
}
