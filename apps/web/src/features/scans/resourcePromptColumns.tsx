import type { ReactNode } from "react";
import type { PromptScan, ResourceScan } from "@mcp-token-footprint/shared";
import type { ColumnDef } from "@brand/data";
import { Badge, Button, Text } from "@brand/ui";
import { Download, Play } from "lucide-react";
import { col } from "../../lib/table";
import { formatPercent } from "../../lib/format";

// Shared DataTable column shapes for a scan's resources/templates + prompts. Both the Scans detail
// (ScansView) and the Servers latest-scan tabs (ServersView) render the same tables, so the column
// defs live here once. Empty/loading states stay with each caller's StatePanel.
//
// These are factory functions: pass an optional handler to append a trailing action column ("Read"
// for resources, "Get" for prompts) that opens the execution dialog. Callers that omit the handler
// get the original read-only columns unchanged.

/** Trailing, non-sortable action column (right-aligned), only appended when a handler is given.
 *  `enabled` lets a row opt out of the button (e.g. resource templates can't be read directly). */
function actionColumn<T>(opts: {
  label: string;
  icon: ReactNode;
  onClick: (row: T) => void;
  enabled?: (row: T) => boolean;
}): ColumnDef<T> {
  return {
    id: "action",
    enableSorting: false,
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) =>
      opts.enabled && !opts.enabled(row.original) ? null : (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => opts.onClick(row.original)}>
            {opts.icon}
            <span>{opts.label}</span>
          </Button>
        </div>
      ),
  };
}

/** Resources/templates: Type · Resource (name ?? uri, mono) · MIME · Tokens · Share [· Read]. */
export function resourceColumns(
  onRead?: (resource: ResourceScan) => void,
): ColumnDef<ResourceScan>[] {
  const columns: ColumnDef<ResourceScan>[] = [
    col<ResourceScan>({
      id: "type",
      header: "Type",
      value: (row) => row.kind,
      cell: (row) => (
        <Badge variant="outline">{row.kind === "template" ? "Template" : "Resource"}</Badge>
      ),
    }),
    col<ResourceScan>({
      id: "resource",
      header: "Resource",
      value: (row) => row.name ?? row.uri,
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <Text className="truncate font-mono font-medium" title={row.name ?? row.uri}>
            {row.name ?? row.uri}
          </Text>
          {row.name ? (
            <Text variant="meta" tone="muted" className="truncate font-mono" title={row.uri}>
              {row.uri}
            </Text>
          ) : null}
        </div>
      ),
    }),
    col<ResourceScan>({ id: "mime", header: "MIME", value: (row) => row.mimeType ?? "—" }),
    col<ResourceScan>({
      id: "tokens",
      header: "Tokens",
      numeric: true,
      value: (row) => row.totalTokens,
    }),
    col<ResourceScan>({
      id: "share",
      header: "Share",
      numeric: true,
      value: (row) => row.contributionPercent,
      cell: (row) => formatPercent(row.contributionPercent),
    }),
  ];
  // Templates carry a uriTemplate, not a concrete uri — reading them requires argument expansion the
  // API does not support, so only offer "Read" for concrete resources (templates show no button).
  if (onRead) {
    columns.push(
      actionColumn<ResourceScan>({
        label: "Read",
        icon: <Download aria-hidden />,
        onClick: onRead,
        enabled: (row) => row.kind === "resource",
      }),
    );
  }
  return columns;
}

/** Prompts: Prompt (name, mono) · Tokens · Args · Share [· Get]. */
export function promptColumns(onGet?: (prompt: PromptScan) => void): ColumnDef<PromptScan>[] {
  const columns: ColumnDef<PromptScan>[] = [
    col<PromptScan>({
      id: "prompt",
      header: "Prompt",
      value: (row) => row.promptName,
      cell: (row) => (
        <Text className="truncate font-mono font-medium" title={row.promptName}>
          {row.promptName}
        </Text>
      ),
    }),
    col<PromptScan>({
      id: "tokens",
      header: "Tokens",
      numeric: true,
      value: (row) => row.totalTokens,
    }),
    col<PromptScan>({
      id: "args",
      header: "Args",
      numeric: true,
      value: (row) => row.argumentsTokens,
    }),
    col<PromptScan>({
      id: "share",
      header: "Share",
      numeric: true,
      value: (row) => row.contributionPercent,
      cell: (row) => formatPercent(row.contributionPercent),
    }),
  ];
  if (onGet) {
    columns.push(
      actionColumn<PromptScan>({ label: "Get", icon: <Play aria-hidden />, onClick: onGet }),
    );
  }
  return columns;
}
