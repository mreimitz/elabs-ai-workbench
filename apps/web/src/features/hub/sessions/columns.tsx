import type { ColumnDef } from "@brand/data";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Text,
} from "@brand/ui";
import type { HubSession, HubSessionMode } from "@mcp-token-footprint/shared";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, TriangleAlert } from "lucide-react";
import { StatusBadge } from "../../../components/StatusBadge";
import { IconButton } from "../../../components/IconButton";
import {
  formatCostUsd,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "../../../lib/format";
import { deriveRunStatusView } from "../../../lib/status";
import { actionsCol, col, navCol, rowMenuTriggerClass } from "../../../lib/table";

/** Sessions-table (WP1.4, D-HUX4) mode → label. Exhaustive over {@link HubSessionMode} — a future mode
 *  fails `pnpm typecheck` here until classified, mirroring `NewSessionDialog`'s own `MODE_COPY`. */
export const SESSION_MODE_LABELS: Record<HubSessionMode, string> = {
  auto: "Auto",
  chat: "Chat",
  research: "Research",
  mission: "Mission",
};

/** The "No project" facet/column bucket — a session with no `projectId`. Exported so `SessionsView`'s
 *  project facet options share the exact same sentinel. */
export const NO_PROJECT_VALUE = "__none__";

export type SessionColumnDeps = {
  /** `HubProject.id` → name, for the Project column (a bare id means nothing to a reader) — built
   *  once in `SessionsView` from its own `listHubProjects()` fetch and passed down here. */
  projectNameById: Map<string, string>;
  onOpen: (session: HubSession) => void;
  onRename: (session: HubSession) => void;
  onArchiveToggle: (session: HubSession) => void;
};

/**
 * The Sessions table's column set (WP1.4, D-HUX4 §7.2): title · status · mode · project · model ·
 * turns · tokens in/out · cost · updated · last error · a rename/archive overflow menu. Title is the
 * `navCol` semantic control and — ui-wave U7 (owner feedback) — the WHOLE row is the click target
 * (`SessionsView` spreads `clickableRowTableProps()` onto the DataTable; `@brand/data` DataTable has
 * no `onRowClick` — this is the house pattern, see `lib/table.tsx`); the overflow menu carries the
 * ONLY other row actions (rename, archive — P4: archive-only, no hard delete).
 */
export function buildSessionColumns(deps: SessionColumnDeps): ColumnDef<HubSession>[] {
  const { projectNameById, onOpen, onRename, onArchiveToggle } = deps;

  return [
    navCol<HubSession>({
      id: "title",
      header: "Title",
      value: (row) => row.title,
      onSelect: onOpen,
      ariaLabel: (row) => `Open ${row.title} in the workspace`,
      pin: "left",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 max-w-[18rem] truncate font-medium" title={row.title}>
            {row.title}
          </span>
          {row.archived ? (
            <Badge variant="outline" className="shrink-0">
              Archived
            </Badge>
          ) : null}
        </span>
      ),
    }),
    {
      id: "status",
      accessorFn: (row) => row.status,
      enableSorting: true,
      header: () => "Status",
      cell: ({ row }) => (
        <StatusBadge
          view={deriveRunStatusView({
            status: row.original.status,
            phase: row.original.phase,
            stopReasonCode: row.original.stopReasonCode,
          })}
        />
      ),
    },
    {
      id: "mode",
      accessorFn: (row) => row.mode,
      enableSorting: true,
      header: () => "Mode",
      cell: ({ row }) => <Badge variant="outline">{SESSION_MODE_LABELS[row.original.mode]}</Badge>,
    },
    {
      id: "project",
      accessorFn: (row) => (row.projectId ? (projectNameById.get(row.projectId) ?? "") : ""),
      enableSorting: true,
      header: () => "Project",
      cell: ({ row }) => {
        const name = row.original.projectId
          ? projectNameById.get(row.original.projectId)
          : undefined;
        return name ? (
          <span className="min-w-0 max-w-[10rem] truncate" title={name}>
            {name}
          </span>
        ) : (
          <Text variant="caption" tone="muted">
            —
          </Text>
        );
      },
    },
    col<HubSession>({
      id: "model",
      header: "Model",
      value: (row) => row.model,
      cell: (row) => (
        <span className="min-w-0 max-w-[12rem] truncate" title={row.model}>
          {row.model}
        </span>
      ),
    }),
    col<HubSession>({
      id: "turns",
      header: "Turns",
      numeric: true,
      value: (row) => row.turns ?? 0,
    }),
    col<HubSession>({
      id: "tokens",
      header: "Tokens",
      numeric: true,
      value: (row) => row.tokensIn + row.tokensOut,
      cell: (row) => `${formatNumber(row.tokensIn)} / ${formatNumber(row.tokensOut)}`,
    }),
    col<HubSession>({
      id: "cost",
      header: "Cost",
      numeric: true,
      value: (row) => row.costUsd,
      cell: (row) => formatCostUsd(row.costUsd),
    }),
    col<HubSession>({
      id: "updated",
      header: "Updated",
      value: (row) => row.updatedAt,
      cell: (row) => (
        <span
          title={formatDateTime(row.updatedAt)}
          className="whitespace-nowrap text-caption text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(row.updatedAt)}
        </span>
      ),
    }),
    {
      id: "lastError",
      accessorFn: (row) => row.lastError ?? "",
      enableSorting: false,
      header: () => "Last error",
      cell: ({ row }) => {
        const message = row.original.lastError;
        if (!message) {
          return (
            <Text variant="caption" tone="muted">
              —
            </Text>
          );
        }
        return (
          <span
            title={message}
            className="flex min-w-0 max-w-[14rem] items-center gap-1 text-caption text-muted-foreground"
          >
            <TriangleAlert aria-hidden className="size-3 shrink-0 text-destructive-text" />
            <span className="min-w-0 truncate">{message}</span>
          </span>
        );
      },
    },
    actionsCol<HubSession>({
      id: "actions",
      header: "Row actions",
      pin: true,
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* ui-wave U7 (owner feedback): quiet ghost trigger — no solid surface, revealed on
                row hover/focus (`rowMenuTriggerClass`); stopPropagation keeps the click out of the
                row-level navigation delegation. */}
            <IconButton
              variant="ghost"
              size="icon-sm"
              className={rowMenuTriggerClass}
              onClick={(event) => event.stopPropagation()}
              label={`More actions for ${row.title}`}
            >
              <MoreHorizontal aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onRename(row)}>
              <Pencil aria-hidden />
              <span>Rename…</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onArchiveToggle(row)}>
              {row.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              <span>{row.archived ? "Restore" : "Archive"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
  ];
}
