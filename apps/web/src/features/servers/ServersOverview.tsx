import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ScanSummary,
  SecurityFleetSummary,
  ServerConfig,
  ServerType,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { MoreHorizontal, Pencil, Play, Plus, Server, Tags, Trash2, Wifi } from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { ResultCount } from "../../components/ResultCount";
import { IconButton } from "../../components/IconButton";
import { StatusBadge } from "../../components/StatusBadge";
import {
  EntityBrowser,
  EntityCard,
  ViewModeToggle,
  useEntityBrowserState,
} from "../../components/entity-browser";
import { col } from "../../lib/table";
import { formatNumber, formatRelativeTime } from "../../lib/format";
import { loadableData, useLoadable } from "../../lib/loadable";
import { PostureScore } from "../security/PostureScore";
import { getSecurityFleetSummary } from "../security/security-api";
import { ServerTypeStatusBadge } from "./ServerTypeStatusBadge";
import { AUTH_LABELS, HEALTH_DOT_CLASS, deriveServerHealth } from "./server-status";
import { resolveServerType, serverTypeGroupBy, serverTypesById, typesInUse } from "./server-groups";

// The type-filter sentinels — kept distinct from any real type id (nanoids never collide with these).
const FILTER_ALL = "all";
const FILTER_UNTYPED = "untyped";

/**
 * The MCP Servers OVERVIEW (planning/Roadmap/RM-32-overview-detail, D-OD1).
 *
 * This replaces the 288px `ServerRail`: the fleet gets the whole window as a grouped card grid (or a
 * grouped table), and `/servers` renders it on a cold load instead of redirecting to whichever server
 * happened to sort first. Selecting one drills into `/servers/:serverId`, where switching servers is
 * a breadcrumb popover rather than a permanent column.
 *
 * Everything the rail carried is carried here: grouping by server type with an `Untyped` tail, the
 * type filter (whose options derive from the FULL fleet, not the search subset), the five health
 * states, the em-dash-not-zero rule for an unscanned server, and ONE fleet-wide security-posture
 * request for the whole grid (D-SP22 — never one request per card).
 */
export function ServersOverview(props: {
  /** Per-action busy predicate keyed by `action:entity` (e.g. `server:scan:<id>`). */
  isBusy: (key: string) => boolean;
  /** True until the app's first data fetch settles. */
  initialLoading?: boolean;
  servers: ServerConfig[];
  serverTypes: ServerType[];
  latestScansByServer: Map<string, ScanSummary>;
  onAddServer: () => void;
  onManageTypes: () => void;
  onDeleteServer: (server: ServerConfig) => void;
  onEditServer: (server: ServerConfig) => void;
  onRunScan: (serverId: string) => void;
  onTestServer: (serverId: string) => void;
}) {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);

  const typesById = useMemo(() => serverTypesById(props.serverTypes), [props.serverTypes]);

  // Security posture for the WHOLE fleet in ONE request (D-SP22). Not one request per card: forty
  // servers would mean forty requests every time the grid paints. Re-fetched when the latest-scan set
  // changes, so finishing a scan refreshes its badge without a page reload.
  const scanSignature = [...props.latestScansByServer]
    .map(([serverId, scan]) => `${serverId}:${scan.id}:${scan.status}`)
    .sort()
    .join("|");
  const { state: postureState } = useLoadable(() => getSecurityFleetSummary(), [scanSignature]);
  // A server with no `success` scan is ABSENT from the answer (never a zero-scored row), so this is a
  // lookup that can legitimately miss — see `PostureCell`.
  const postureByServer = useMemo(() => {
    const rows = loadableData(postureState) ?? [];
    return new Map(rows.map((row) => [row.serverId, row] as const));
  }, [postureState]);
  const postureSettled = postureState.status !== "loading";

  const sortedServers = useMemo(
    () => [...props.servers].sort((left, right) => left.name.localeCompare(right.name)),
    [props.servers],
  );

  // Filter options derive from the FULL fleet (not the search subset) so searching never removes a
  // filter choice. Only types actually in use appear, plus "Untyped" when some server has no (known)
  // type — and the whole control is hidden when there is nothing to group by.
  const inUse = useMemo(
    () => typesInUse(props.servers, props.serverTypes),
    [props.servers, props.serverTypes],
  );
  const hasUntyped = useMemo(
    () => props.servers.some((server) => resolveServerType(server, typesById) === null),
    [props.servers, typesById],
  );

  // Keep the selected filter valid if its type stops being in use (e.g. its last member is deleted).
  const effectiveFilter =
    typeFilter === FILTER_ALL ||
    (typeFilter === FILTER_UNTYPED && hasUntyped) ||
    inUse.some((type) => type.id === typeFilter)
      ? typeFilter
      : FILTER_ALL;

  const filtered = useMemo(() => {
    if (effectiveFilter === FILTER_ALL) return sortedServers;
    if (effectiveFilter === FILTER_UNTYPED) {
      return sortedServers.filter((server) => resolveServerType(server, typesById) === null);
    }
    return sortedServers.filter(
      (server) => resolveServerType(server, typesById)?.id === effectiveFilter,
    );
  }, [sortedServers, effectiveFilter, typesById]);

  const groupBys = useMemo(
    () =>
      inUse.length > 0
        ? [
            serverTypeGroupBy({
              serverTypes: props.serverTypes,
              servers: props.servers,
              renderBadge: (type) => <ServerTypeStatusBadge status={type.status} />,
            }),
          ]
        : [],
    [inUse.length, props.serverTypes, props.servers],
  );

  const state = useEntityBrowserState<ServerConfig>({ storageKey: "servers", groupBys });

  const endpointOf = (server: ServerConfig): string =>
    (server.transport === "stdio" ? server.command : server.url) ?? "";

  const columns = useMemo(
    () => [
      col<ServerConfig>({ id: "name", header: "Name", value: (server) => server.name }),
      col<ServerConfig>({
        id: "type",
        header: "Type",
        value: (server) => resolveServerType(server, typesById)?.name ?? "Untyped",
      }),
      col<ServerConfig>({
        id: "health",
        header: "Health",
        value: (server) => deriveServerHealth(props.latestScansByServer.get(server.id)).label,
        cell: (server) => (
          <StatusBadge view={deriveServerHealth(props.latestScansByServer.get(server.id)).view} />
        ),
      }),
      col<ServerConfig>({
        id: "tokens",
        header: "Startup tokens",
        numeric: true,
        value: (server) => {
          const scan = props.latestScansByServer.get(server.id);
          return scan?.status === "success" ? scan.totalTokens : -1;
        },
        cell: (server) => {
          const scan = props.latestScansByServer.get(server.id);
          // Only a SUCCESSFUL scan has a meaningful total — anything else is "—", never a "0" that
          // would read as a measured zero.
          return scan?.status === "success" ? formatNumber(scan.totalTokens) : "—";
        },
      }),
      col<ServerConfig>({
        id: "posture",
        header: "Posture",
        value: (server) => postureByServer.get(server.id)?.score.value ?? -1,
        cell: (server) => {
          const posture = postureByServer.get(server.id);
          return posture ? <PostureScore score={posture.score} variant="chip" /> : "—";
        },
      }),
      col<ServerConfig>({
        id: "transport",
        header: "Transport",
        value: (server) => (server.transport === "stdio" ? "stdio" : "http"),
      }),
      col<ServerConfig>({
        id: "auth",
        header: "Auth",
        value: (server) => AUTH_LABELS[server.authType],
      }),
      col<ServerConfig>({
        id: "endpoint",
        header: "Endpoint",
        value: endpointOf,
        cell: (server) => (
          <span className="block min-w-0 truncate font-mono" title={endpointOf(server)}>
            {endpointOf(server)}
          </span>
        ),
      }),
    ],
    [typesById, props.latestScansByServer, postureByServer],
  );

  return (
    <PageShell
      width="full"
      headerVariant="toolbar"
      header={
        <ViewToolbar
          info={
            props.servers.length > 0 ? (
              <p className="max-w-xs text-pretty">
                Every registered MCP server, grouped by type. Open one to see its tool surface, token
                footprint, scans and findings.
              </p>
            ) : undefined
          }
          left={
            props.servers.length > 0 ? (
              <>
                <div className="w-56 min-w-[10rem]">
                  <SearchInput
                    value={state.search}
                    onValueChange={state.setSearch}
                    placeholder="Search servers…"
                    label="Search servers"
                  />
                </div>
                {inUse.length > 0 ? (
                  <Select value={effectiveFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger aria-label="Filter servers by type" className="w-44">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_ALL}>All types</SelectItem>
                      {inUse.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                      {hasUntyped ? <SelectItem value={FILTER_UNTYPED}>Untyped</SelectItem> : null}
                    </SelectContent>
                  </Select>
                ) : null}
                {state.groupByOptions.length > 0 ? (
                  <Select value={state.groupById} onValueChange={state.setGroupById}>
                    <SelectTrigger aria-label="Group servers by" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {state.groupByOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label === "None" ? "No grouping" : `Group by ${option.label}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </>
            ) : undefined
          }
          results={
            props.servers.length > 0 ? (
              <ResultCount
                filteredCount={filtered.length}
                totalCount={props.servers.length}
                noun="servers"
              />
            ) : undefined
          }
          actions={
            <>
              {props.servers.length > 0 ? (
                <ViewModeToggle value={state.viewMode} onChange={state.setViewMode} />
              ) : null}
              <Button variant="outline" onClick={props.onManageTypes}>
                <Tags aria-hidden />
                <span>Manage types</span>
              </Button>
              <Button onClick={props.onAddServer}>
                <Plus aria-hidden />
                <span>Add server</span>
              </Button>
            </>
          }
        />
      }
    >
      {/* Breadcrumb-named page — keep an AT-only H1 now that the title block is gone (D-TB1). */}
      <Heading level={1} className="sr-only">
        MCP Servers
      </Heading>

      <EntityBrowser<ServerConfig>
        state={state}
        items={filtered}
        itemKey={(server) => server.id}
        searchText={(server) => `${server.name} ${endpointOf(server)}`}
        noun={["server", "servers"]}
        columns={columns}
        onOpen={(server) => navigate(`/servers/${server.id}`)}
        rowLabel={(server) => server.name}
        {...(props.initialLoading !== undefined ? { loading: props.initialLoading } : {})}
        renderCard={(server, hints) => (
          <ServerOverviewCard
            server={server}
            type={resolveServerType(server, typesById)}
            // P2-2 (RM-36 WP 2.2) — the group heading already reads `QLIK-SAAS · [Production] · 2`,
            // so repeating `[qlik-saas] [Production]` on every card inside it says nothing the
            // section header has not already said. When the grid is grouped BY TYPE the card drops
            // those two chips; ungrouped (or grouped by something else) it keeps them, because then
            // nothing else on screen states them.
            typeStatedByGroupHeading={state.groupById === "type"}
            latestScan={props.latestScansByServer.get(server.id)}
            posture={postureByServer.get(server.id)}
            postureSettled={postureSettled}
            scanBusy={props.isBusy(`server:scan:${server.id}`)}
            testBusy={props.isBusy(`server:test:${server.id}`)}
            virtualizeHint={hints.virtualizeHint}
            onOpen={() => navigate(`/servers/${server.id}`)}
            onRunScan={() => props.onRunScan(server.id)}
            onTestServer={() => props.onTestServer(server.id)}
            onEditServer={() => props.onEditServer(server)}
            onDeleteServer={() => props.onDeleteServer(server)}
          />
        )}
        empty={
          <EmptyState
            icon={<Server aria-hidden />}
            title="No servers yet"
            description="Add a local command or a URL-based MCP server to scan its tool surface and measure what it costs a model's context."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={props.onManageTypes}>
                  <Tags aria-hidden />
                  <span>Manage types</span>
                </Button>
                <Button onClick={props.onAddServer}>
                  <Plus aria-hidden />
                  <span>Add server</span>
                </Button>
              </div>
            }
          />
        }
      />
    </PageShell>
  );
}

function ServerOverviewCard(props: {
  server: ServerConfig;
  type: ServerType | null;
  /** P2-2 — true when the enclosing group heading already names this card's type + type status, so
   *  the card must not repeat them. */
  typeStatedByGroupHeading?: boolean;
  latestScan: ScanSummary | undefined;
  posture: SecurityFleetSummary | undefined;
  postureSettled: boolean;
  scanBusy: boolean;
  testBusy: boolean;
  virtualizeHint: boolean;
  onOpen: () => void;
  onRunScan: () => void;
  onTestServer: () => void;
  onEditServer: () => void;
  onDeleteServer: () => void;
}) {
  const { server, latestScan } = props;
  const health = deriveServerHealth(latestScan);
  const scanned = latestScan?.status === "success";
  const endpoint = (server.transport === "stdio" ? server.command : server.url) ?? "";

  return (
    <EntityCard
      title={server.name}
      href={`/servers/${server.id}`}
      onOpen={props.onOpen}
      virtualizeHint={props.virtualizeHint}
      /* P2-2 — the chips moved OFF the title row onto their own line below it. They used to sit in
         `status` (top-right, `shrink-0`), which squeezed the title: `mcp-assets` clipped to
         `mcp-ass…` at 81px against the 90px it needed — the name clipped exactly on the card whose
         name most needs reading, because `Scan failed` + `Medium risk` took the row. With only the
         per-card actions left up there, the title gets that width back. The RISK chip stays (it
         varies within a group); the type + type-status chips drop when the group heading already
         names them. */
      badges={
        <>
          {/* Health DOT: aria-labelled only when it's the sole cue (healthy/scanning have no chip);
              decorative when the labelled chip beside it carries the state. */}
          <span
            className={cn("size-2 shrink-0 rounded-full", HEALTH_DOT_CLASS[health.dotTone])}
            {...(health.showChip ? { "aria-hidden": true } : { role: "img", "aria-label": health.label })}
          />
          {health.showChip ? <StatusBadge view={health.view} className="shrink-0" /> : null}
          <PostureCell
            posture={props.posture}
            settled={props.postureSettled}
            healthChipShown={health.showChip}
          />
          {props.type && !props.typeStatedByGroupHeading ? (
            <>
              <Badge variant="outline">{props.type.name}</Badge>
              <ServerTypeStatusBadge status={props.type.status} />
            </>
          ) : null}
          <Text variant="meta" tone="muted">
            {server.transport === "stdio" ? "stdio" : "http"} · {AUTH_LABELS[server.authType]}
          </Text>
        </>
      }
      metrics={
        <>
          <Metric
            label="Startup tokens"
            value={scanned ? formatNumber(latestScan.totalTokens) : "—"}
          />
          <Metric label="Tools" value={scanned ? formatNumber(latestScan.totalTools) : "—"} />
          <Metric
            label="Last scan"
            value={latestScan ? formatRelativeTime(latestScan.scannedAt) : "Never"}
          />
        </>
      }
      meta={
        <Text variant="meta" tone="muted" className="min-w-0 truncate font-mono" title={endpoint}>
          {endpoint}
        </Text>
      }
      actions={
        <>
          <IconButton
            size="icon-sm"
            variant="ghost"
            label={`Scan ${server.name}`}
            disabled={props.scanBusy}
            disabledReason="A scan is already running for this server."
            onClick={props.onRunScan}
          >
            <Play aria-hidden />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="icon-sm" variant="ghost" label={`More actions for ${server.name}`}>
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={props.onEditServer}>
                <Pencil aria-hidden />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={props.testBusy} onSelect={props.onTestServer}>
                <Wifi aria-hidden />
                <span>Test connection</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={props.onDeleteServer}
              >
                <Trash2 aria-hidden />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <Text variant="meta" tone="muted" className="truncate">
        {props.label}
      </Text>
      <Text className="truncate tabular-nums">{props.value}</Text>
    </span>
  );
}

/**
 * One card's security-posture badge (D-SP22) — the BAND, with the score as its accessible detail.
 * Three states, and the third is the one worth being careful about:
 *   • a posture → the band chip, rendered by the same `PostureScore` the Security tab uses;
 *   • no posture, on a card that already carries a health chip ("Not scanned", "Scan failed") →
 *     nothing, because that chip has already said why there is no posture;
 *   • no posture otherwise → the muted em dash this surface already uses for a missing measurement.
 */
function PostureCell(props: {
  posture: SecurityFleetSummary | undefined;
  settled: boolean;
  healthChipShown: boolean;
}) {
  if (props.posture) return <PostureScore score={props.posture.score} variant="chip" />;
  if (!props.settled || props.healthChipShown) return null;
  return (
    <Text variant="caption" tone="muted" className="shrink-0">
      —
    </Text>
  );
}
