/* GENERATED from packages/data/src/templates-data-app.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen data-app template (single source of truth: the Storybook story). */

/**
 * Data app template — the canonical full-screen data-app composition
 * (app-shell + DataTable with toolbar). This story is the single source of
 * truth: `pnpm gen:templates` derives the consumer template source
 * (`docs/playbooks/templates/data-app.tsx`) from it.
 * Verify across all three themes with globals=theme:<slug>.
 */
import { useState } from "react";
import {
  Badge,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@brand/ui";
import { AppIcon } from "@brand/icons";
import { ColumnPicker, DataTable, FilterBar, SearchInput, type ColumnDef } from "@brand/data";

type Status = "active" | "paused" | "error";

interface DataRow {
  id: string;
  name: string;
  status: Status;
  records: number;
  lastRun: string;
}

const statusVariant: Record<Status, "success" | "secondary" | "destructive"> = {
  active: "success",
  paused: "secondary",
  error: "destructive",
};

const columns: ColumnDef<DataRow>[] = [
  { accessorKey: "name", header: "Name" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  {
    accessorKey: "records",
    header: "Records",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.records.toLocaleString()}</span>
    ),
  },
  { accessorKey: "lastRun", header: "Last run" },
];

const sampleData: DataRow[] = [
  { id: "1", name: "Customer import", status: "active", records: 14200, lastRun: "2 min ago" },
  { id: "2", name: "Nightly sync", status: "active", records: 88541, lastRun: "6 h ago" },
  { id: "3", name: "Legacy migration", status: "paused", records: 3010, lastRun: "3 d ago" },
  { id: "4", name: "Partner feed", status: "error", records: 0, lastRun: "1 d ago" },
];

const nav = [
  { id: "data", label: "Data" },
  { id: "tables", label: "Tables" },
  { id: "home", label: "Home" },
  { id: "settings", label: "Settings" },
];

function DataAppTemplate() {
  const [active, setActive] = useState("data");
  const [search, setSearch] = useState("");
  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="px-3 py-2">
          <div className="flex items-center gap-2">
            <AppIcon height={20} aria-hidden />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              Data
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((n) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton
                      isActive={active === n.id}
                      tooltip={n.label}
                      onClick={() => setActive(n.id)}
                    >
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-body font-medium capitalize">{active}</h1>
        </header>
        <main className="p-6">
          <DataTable
            columns={columns}
            data={sampleData}
            enablePagination
            // Controlled global filter — the app owns `search` and passes it down.
            // Never mutate the filter inside `toolbar` (e.g. table.setGlobalFilter),
            // which sets state during render and loops ("Too many re-renders").
            globalFilter={search}
            onGlobalFilterChange={setSearch}
            toolbar={(table) => (
              <FilterBar actions={<ColumnPicker table={table} />}>
                <SearchInput value={search} onValueChange={setSearch} />
              </FilterBar>
            )}
          />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
