# Playbook — Data app / admin console

Tool-first table surface for browsing and operating on records: search,
facets, column control, row + bulk actions. Template source: `templates/data-app.tsx` (generated from this Storybook story by `pnpm gen:templates`).

## Building blocks

| Layer   | Components                                                   | From          |
| ------- | ------------------------------------------------------------ | ------------- |
| Shell   | `SidebarProvider` + `Sidebar` + `SidebarInset`               | `@brand/ui`   |
| Table   | `DataTable` (TanStack-backed)                                | `@brand/data` |
| Toolbar | `FilterBar` + `SearchInput` + `FacetFilter` + `ColumnPicker` | `@brand/data` |
| Detail  | `Dialog` (row detail) · `DropdownMenu` (row actions)         | `@brand/ui`   |
| Guard   | `AlertDialog` for destructive/bulk actions                   | `@brand/ui`   |
| States  | `Skeleton` · `EmptyState` · `Badge` (status)                 | `@brand/ui`   |

## Wiring diagram

```
state: search · facetSelections[] · (rows = data filtered by facets)
SidebarInset > main
└── DataTable columns={columns} data={rows} enablePagination
    └── toolbar={(table) => (
          FilterBar actions={<ColumnPicker table={table} />}
          ├── SearchInput  value={search}            ← global filter
          └── FacetFilter  selected={…} ×N           ← controlled, filters rows
        )}
```

Key fact: **`FacetFilter` is controlled** — it does not talk to the table.
Hold selections in state and filter the `data` array you pass in (the
template shows this). `SearchInput` drives the table's global filter via
`globalFilter` / `onGlobalFilterChange` on `DataTable`.

## Columns (the six starter renderers)

```tsx
const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" }, // text
  {
    accessorKey: "status",
    header: "Status", // badge
    cell: ({ row }) => (
      <Badge variant={variantFor[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  {
    accessorKey: "count",
    header: "Records", // numeric
    cell: ({ row }) => <span className="tabular-nums">{row.original.count.toLocaleString()}</span>,
  },
  {
    accessorKey: "createdAt",
    header: "Created", // date
    cell: ({ row }) =>
      new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(row.original.createdAt),
  },
  {
    accessorKey: "message",
    header: "Message", // truncated
    cell: ({ row }) => <span className="block max-w-[40ch] truncate">{row.original.message}</span>,
  },
  {
    id: "actions",
    header: "", // row actions
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Row actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => view(row.original)}>View</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => askDelete(row.original)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];
```

Dates/numbers always via `Intl.*` — never hardcoded formats.

## Bulk actions

Checkbox column (`id: "select"`) → read `table.getSelectedRowModel().rows`
in the toolbar → destructive bulk action goes behind `AlertDialog` listing
what will happen. Never fire destructive actions immediately.

## Server-side pagination

Client-side is the default and fine to ~10k rows. Beyond that pass
`manualPagination` (+ `pageCount` / `rowCount`) and refetch on page change;
`manualSorting` / `manualFiltering` exist for the same opt-in. For very long
client-side lists, `DataTable` supports row virtualization instead of
pagination (don't enable both — virtualization wins).

## Decisions you own

Entity fields + column types · which columns get facets · row actions ·
client vs. server pagination (data size) · detail view (Dialog now; keep it
one decision) · theme.

## Decisions already made — don't re-make

TanStack wiring (DataTable owns it) · toolbar layout (`FilterBar` slots) ·
status colors (`Badge` variants) · empty/loading states · column visibility
(`ColumnPicker`).

## Common mistakes

- Wiring `FacetFilter` to `table.getColumn(...)` — it's controlled; filter
  the data array instead.
- Calling `table.setGlobalFilter()` inside the `toolbar` render prop — loops;
  use the `globalFilter` prop on `DataTable`.
- A `<div onClick>` row action instead of a real `<button>`/menu item.
- Pagination + virtualization both enabled.
