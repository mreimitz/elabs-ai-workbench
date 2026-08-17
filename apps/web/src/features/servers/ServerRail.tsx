import { useCallback, useMemo, useState } from "react";
import type {
  ScanSummary,
  ServerAuthType,
  ServerConfig,
  ServerType,
} from "@mcp-token-footprint/shared";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { MoreHorizontal, Pencil, Play, Plus, Tags, Trash2, Wifi } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { StatusBadge } from "../../components/StatusBadge";
import type { StatusView } from "../../lib/status";
import { formatNumber } from "../../lib/format";
import { ServerTypeStatusBadge } from "./ServerTypeStatusBadge";

// ── Server health (T7 / audit: failure was colour-only, and a never-scanned server looked identical
// to a healthy one). Each server's latest scan resolves to ONE health state, rendered as a
// token-backed DOT (quick visual scan, aria-labelled when it's the sole cue) PLUS a StatusBadge chip
// for the attention states, so the state is never carried by colour alone and is always in the row's
// accessible name. Distinguishes never-scanned · last-scan-failed · auth-expired · healthy · scanning.
type HealthTone = "success" | "danger" | "warning" | "info" | "neutral";

type ServerHealth = {
  label: string;
  dotTone: HealthTone;
  /** Show the labelled chip (attention states); healthy/scanning carry only the aria-labelled dot. */
  showChip: boolean;
  view: StatusView;
};

/** Filled token dot per tone; never-scanned reads as a dashed hollow ring (not "just another colour"). */
const HEALTH_DOT_CLASS: Record<HealthTone, string> = {
  success: "bg-success",
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  neutral: "border border-dashed border-muted-foreground/60 bg-transparent",
};

function serverHealth(latestScan: ScanSummary | undefined): ServerHealth {
  const make = (
    label: string,
    tone: HealthTone,
    opts?: { dashed?: boolean; showChip?: boolean },
  ): ServerHealth => ({
    label,
    dotTone: tone,
    showChip: opts?.showChip ?? true,
    view: { kind: "chip", label, tone, spinner: tone === "info", dashed: opts?.dashed ?? false },
  });
  if (!latestScan) return make("Not scanned", "neutral", { dashed: true });
  if (latestScan.status === "running") return make("Scanning…", "info", { showChip: false });
  if (latestScan.status === "failed") {
    // `authRequired` is only ever set for an oauth-HTTP server whose token needs interactive sign-in.
    return latestScan.authRequired
      ? make("Auth expired", "warning")
      : make("Scan failed", "danger");
  }
  return make("Healthy", "success", { showChip: false });
}

const AUTH_LABELS: Record<ServerAuthType, string> = {
  none: "No auth",
  bearer: "Bearer",
  api_key: "API key",
  oauth: "OAuth",
  custom_headers: "Headers",
};

// The type-filter sentinels — kept distinct from any real type id (nanoids never collide with these).
const FILTER_ALL = "all";
const FILTER_UNTYPED = "untyped";

/** One server-rail section: a resolved type header (or the "Untyped" tail) plus its member rows. */
type RailGroup = {
  key: string;
  /** The resolved type, or `null` for the "Untyped" tail group. */
  type: ServerType | null;
  servers: ServerConfig[];
};

export function ServerRail(props: {
  /** Per-action busy predicate keyed by `action:entity` (e.g. `server:scan:<id>`). */
  isBusy: (key: string) => boolean;
  latestScansByServer: Map<string, ScanSummary>;
  selectedServerId: string | null;
  servers: ServerConfig[];
  /** Server types (roadmap/server-types) used to group + filter the rail. */
  serverTypes: ServerType[];
  onAddServer: () => void;
  /** Open the Manage-types surface (create/rename/restatus/delete). Reachable at empty-fleet. */
  onManageTypes: () => void;
  onDeleteServer: (server: ServerConfig) => void;
  onEditServer: (server: ServerConfig) => void;
  onRunScan: (serverId: string) => void;
  onSelectServer: (serverId: string) => void;
  onTestServer: (serverId: string) => void;
}) {
  const [search, setSearch] = useState("");
  // Type filter: "all" (default), "untyped", or a concrete type id. Local UI state only.
  const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);

  const typesById = useMemo(
    () => new Map(props.serverTypes.map((type) => [type.id, type] as const)),
    [props.serverTypes],
  );

  // A server's resolved type: its `typeId` only counts when it references a KNOWN type; a dangling
  // id (type deleted out from under it) reads as untyped, never crashes.
  const resolveType = useCallback(
    (server: ServerConfig): ServerType | null =>
      server.typeId ? (typesById.get(server.typeId) ?? null) : null,
    [typesById],
  );

  const sortedServers = useMemo(
    () => [...props.servers].sort((left, right) => left.name.localeCompare(right.name)),
    [props.servers],
  );

  // Filter options derive from the FULL fleet (not the search subset) so searching never removes a
  // filter choice. Only types actually in use appear, plus an "Untyped" option when some server has
  // no (known) type — and the whole control is hidden when there is nothing to group by.
  const usedTypeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const server of props.servers) {
      const type = resolveType(server);
      if (type) ids.add(type.id);
    }
    return ids;
  }, [props.servers, resolveType]);
  const typesInUse = useMemo(
    () => props.serverTypes.filter((type) => usedTypeIds.has(type.id)),
    [props.serverTypes, usedTypeIds],
  );
  const hasUntyped = useMemo(
    () => props.servers.some((server) => resolveType(server) === null),
    [props.servers, resolveType],
  );
  const showTypeFilter = typesInUse.length > 0;
  // Sections only appear when at least one type is in use; otherwise the rail degrades to today's
  // flat name-sorted list (a fleet with zero types has nothing to group).
  const grouped = typesInUse.length > 0;

  // Keep the selected filter valid if its type stops being in use (e.g. its last member is deleted).
  const effectiveFilter =
    typeFilter === FILTER_ALL ||
    (typeFilter === FILTER_UNTYPED && hasUntyped) ||
    usedTypeIds.has(typeFilter)
      ? typeFilter
      : FILTER_ALL;

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedServers;
    return sortedServers.filter((server) => {
      const endpoint = server.transport === "stdio" ? (server.command ?? "") : (server.url ?? "");
      return server.name.toLowerCase().includes(q) || endpoint.toLowerCase().includes(q);
    });
  }, [sortedServers, search]);

  // Apply the type filter on top of search.
  const visible = useMemo(() => {
    if (effectiveFilter === FILTER_ALL) return searched;
    if (effectiveFilter === FILTER_UNTYPED) {
      return searched.filter((server) => resolveType(server) === null);
    }
    return searched.filter((server) => resolveType(server)?.id === effectiveFilter);
  }, [searched, effectiveFilter, resolveType]);

  // Build the ordered sections: one per in-use type (API order = name asc), then an "Untyped" tail.
  // Empty sections are dropped so search/filter never leaves a bare header.
  const groups = useMemo<RailGroup[]>(() => {
    if (!grouped) return [];
    const byType = new Map<string, ServerConfig[]>();
    const untyped: ServerConfig[] = [];
    for (const server of visible) {
      const type = resolveType(server);
      if (type) {
        const bucket = byType.get(type.id);
        if (bucket) bucket.push(server);
        else byType.set(type.id, [server]);
      } else {
        untyped.push(server);
      }
    }
    const result: RailGroup[] = [];
    for (const type of typesInUse) {
      const servers = byType.get(type.id);
      if (servers && servers.length > 0) {
        result.push({ key: type.id, type, servers });
      }
    }
    if (untyped.length > 0) {
      result.push({ key: FILTER_UNTYPED, type: null, servers: untyped });
    }
    return result;
  }, [grouped, visible, typesInUse, resolveType]);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Text className="font-semibold leading-tight">Registry</Text>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {visible.length !== props.servers.length
              ? `${visible.length} of ${props.servers.length}`
              : `${props.servers.length} configured`}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Manage server types (roadmap/server-types WP 2.2) — reachable even at empty-fleet. */}
          <IconButton
            size="icon-sm"
            variant="ghost"
            label="Manage server types"
            onClick={props.onManageTypes}
          >
            <Tags aria-hidden />
          </IconButton>
          <IconButton
            size="icon-sm"
            variant="outline"
            label="Add MCP server"
            onClick={props.onAddServer}
          >
            <Plus aria-hidden />
          </IconButton>
        </div>
      </div>

      {props.servers.length > 0 ? (
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search servers…"
          aria-label="Search servers"
        />
      ) : null}

      {showTypeFilter ? (
        <Select value={effectiveFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="Filter servers by type" className="w-full">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FILTER_ALL}>All types</SelectItem>
            {typesInUse.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
            {hasUntyped ? <SelectItem value={FILTER_UNTYPED}>Untyped</SelectItem> : null}
          </SelectContent>
        </Select>
      ) : null}

      {sortedServers.length === 0 ? (
        <EmptyState
          title="No servers"
          description="Add a local command or URL-based MCP server."
          actions={
            <Button onClick={props.onAddServer}>
              <Plus aria-hidden />
              <span>Add server</span>
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <Text variant="caption" tone="muted" className="px-1">
          {search ? `No servers match “${search}”.` : "No servers match the selected type filter."}
        </Text>
      ) : grouped ? (
        <div className="flex min-w-0 flex-col gap-3">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.type ? group.type.name : "Untyped servers"}>
              <div className="mb-1 flex min-w-0 items-center gap-1.5 px-1">
                <Text
                  variant="meta"
                  tone="muted"
                  className="min-w-0 truncate font-semibold uppercase tracking-wide"
                >
                  {group.type ? group.type.name : "Untyped"}
                </Text>
                {group.type ? <ServerTypeStatusBadge status={group.type.status} /> : null}
                <Text variant="meta" tone="muted" className="ml-auto shrink-0 tabular-nums">
                  {formatNumber(group.servers.length)}
                </Text>
              </div>
              <ServerList
                servers={group.servers}
                isBusy={props.isBusy}
                latestScansByServer={props.latestScansByServer}
                selectedServerId={props.selectedServerId}
                onDeleteServer={props.onDeleteServer}
                onEditServer={props.onEditServer}
                onRunScan={props.onRunScan}
                onSelectServer={props.onSelectServer}
                onTestServer={props.onTestServer}
              />
            </section>
          ))}
        </div>
      ) : (
        <ServerList
          servers={visible}
          isBusy={props.isBusy}
          latestScansByServer={props.latestScansByServer}
          selectedServerId={props.selectedServerId}
          onDeleteServer={props.onDeleteServer}
          onEditServer={props.onEditServer}
          onRunScan={props.onRunScan}
          onSelectServer={props.onSelectServer}
          onTestServer={props.onTestServer}
        />
      )}
    </div>
  );
}

/** The `<ul>` of server rows — shared by the grouped sections and the flat (untyped-fleet) view. */
function ServerList(props: {
  servers: ServerConfig[];
  isBusy: (key: string) => boolean;
  latestScansByServer: Map<string, ScanSummary>;
  selectedServerId: string | null;
  onDeleteServer: (server: ServerConfig) => void;
  onEditServer: (server: ServerConfig) => void;
  onRunScan: (serverId: string) => void;
  onSelectServer: (serverId: string) => void;
  onTestServer: (serverId: string) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-0.5">
      {props.servers.map((server) => {
        const latestScan = props.latestScansByServer.get(server.id);
        const active = props.selectedServerId === server.id;
        const scanBusy = props.isBusy(`server:scan:${server.id}`);
        const testBusy = props.isBusy(`server:test:${server.id}`);
        // Only a SUCCESSFUL scan has a meaningful token total — a failed/never-scanned server shows
        // "—" (never a misleading "0"); its state is carried by the health dot + chip instead.
        const scanned = latestScan?.status === "success";
        const tokenLabel = scanned ? formatNumber(latestScan.totalTokens) : "—";
        const health = serverHealth(latestScan);
        return (
          <li
            key={server.id}
            aria-current={active ? "true" : undefined}
            className={cn(
              "group flex min-w-0 items-center gap-1 rounded-md pe-1 transition-colors",
              "hover:bg-accent/60",
              active && "bg-accent",
            )}
          >
            <Button
              variant="ghost"
              className={cn(
                "h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-md py-1.5 text-left hover:bg-transparent",
                active && "hover:bg-transparent",
              )}
              onClick={() => props.onSelectServer(server.id)}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {/* Health DOT: aria-labelled only when it's the sole cue (healthy/scanning have no
                      chip); decorative when the labelled chip on the right carries the state. */}
                  <span
                    className={cn("size-2 shrink-0 rounded-full", HEALTH_DOT_CLASS[health.dotTone])}
                    {...(health.showChip
                      ? { "aria-hidden": true }
                      : { role: "img", "aria-label": health.label })}
                  />
                  <Text className={cn("min-w-0 truncate font-medium", active && "text-primary")}>
                    {server.name}
                  </Text>
                </span>
                {health.showChip ? (
                  <StatusBadge view={health.view} className="shrink-0" />
                ) : (
                  <Text variant="caption" tone="muted" className="shrink-0 tabular-nums">
                    {tokenLabel}
                  </Text>
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Text variant="meta" tone="muted" className="shrink-0">
                  {server.transport === "stdio" ? "stdio" : "http"}
                </Text>
                <span className="text-muted-foreground/40" aria-hidden>
                  ·
                </span>
                <Text variant="meta" tone="muted" className="shrink-0">
                  {AUTH_LABELS[server.authType]}
                </Text>
                <span className="text-muted-foreground/40" aria-hidden>
                  ·
                </span>
                <Text variant="meta" tone="muted" className="min-w-0 truncate font-mono">
                  {server.transport === "stdio" ? server.command : server.url}
                </Text>
              </span>
            </Button>

            <IconButton
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              label={`Scan ${server.name}`}
              disabled={scanBusy}
              disabledReason="A scan is already running for this server."
              onClick={() => props.onRunScan(server.id)}
            >
              <Play aria-hidden />
            </IconButton>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-aria-[current=true]:opacity-100 data-[state=open]:opacity-100"
                  label={`More actions for ${server.name}`}
                >
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => props.onEditServer(server)}>
                  <Pencil aria-hidden />
                  <span>Edit</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={testBusy}
                  onSelect={() => props.onTestServer(server.id)}
                >
                  <Wifi aria-hidden />
                  <span>Test connection</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => props.onDeleteServer(server)}
                >
                  <Trash2 aria-hidden />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}
