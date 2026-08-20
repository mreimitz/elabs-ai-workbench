import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ScanSummary, ServerConfig, ServerType } from "@mcp-token-footprint/shared";
import { Text } from "@elabs-ai/components-ui";
import {
  BreadcrumbEntitySwitcher,
  type BreadcrumbSwitcherGroup,
} from "../../components/BreadcrumbEntitySwitcher";
import { StatusBadge } from "../../components/StatusBadge";
import { ServerTypeStatusBadge } from "./ServerTypeStatusBadge";
import { deriveServerHealth } from "./server-status";
import { resolveServerType, serverTypesById, typesInUse } from "./server-groups";

/**
 * The server detail page's breadcrumb leaf (RM-32 D-OD5): `Home › MCP Servers › [barc-benchmark ▾]`.
 *
 * Grouped the SAME way the overview is (by server type, `Untyped` last), so the popover and the page
 * it came from present the fleet identically — switching surfaces never re-sorts the world.
 */
export function ServerBreadcrumbSwitcher(props: {
  servers: ServerConfig[];
  serverTypes: ServerType[];
  latestScansByServer: Map<string, ScanSummary>;
  activeServer: ServerConfig | null;
  onCreate: () => void;
}) {
  const navigate = useNavigate();

  const groups = useMemo<BreadcrumbSwitcherGroup[]>(() => {
    const typesById = serverTypesById(props.serverTypes);
    const sorted = [...props.servers].sort((left, right) => left.name.localeCompare(right.name));
    const rowOf = (server: ServerConfig) => {
      const health = deriveServerHealth(props.latestScansByServer.get(server.id));
      const endpoint = (server.transport === "stdio" ? server.command : server.url) ?? "";
      return {
        id: server.id,
        label: server.name,
        badge: <StatusBadge view={health.view} className="shrink-0" />,
        meta: (
          <Text variant="meta" tone="muted" className="min-w-0 truncate font-mono">
            {endpoint}
          </Text>
        ),
      };
    };

    const inUse = typesInUse(props.servers, props.serverTypes);
    // A fleet with no types at all has nothing to group by — render it flat rather than under one
    // meaningless "Untyped" header.
    if (inUse.length === 0) {
      return [{ key: "all", label: "", items: sorted.map(rowOf) }];
    }

    const groupsByType: BreadcrumbSwitcherGroup[] = [];
    for (const type of inUse) {
      const members = sorted.filter((server) => resolveServerType(server, typesById)?.id === type.id);
      if (members.length === 0) continue;
      groupsByType.push({
        key: type.id,
        label: type.name,
        badge: <ServerTypeStatusBadge status={type.status} />,
        items: members.map(rowOf),
      });
    }
    const untyped = sorted.filter((server) => resolveServerType(server, typesById) === null);
    if (untyped.length > 0) {
      groupsByType.push({ key: "untyped", label: "Untyped", items: untyped.map(rowOf) });
    }
    return groupsByType;
  }, [props.servers, props.serverTypes, props.latestScansByServer]);

  const activeHealth = props.activeServer
    ? deriveServerHealth(props.latestScansByServer.get(props.activeServer.id))
    : null;

  return (
    <BreadcrumbEntitySwitcher
      groups={groups}
      activeId={props.activeServer?.id ?? null}
      switchLabel="Switch server"
      noun={["server", "servers"]}
      onSelect={(id) => navigate(`/servers/${id}`)}
      onCreate={props.onCreate}
      createLabel="New server"
      onViewAll={() => navigate("/servers")}
      {...(props.activeServer ? { triggerLabel: props.activeServer.name } : {})}
      {...(activeHealth ? { triggerBadge: <StatusBadge view={activeHealth.view} /> } : {})}
    />
  );
}
