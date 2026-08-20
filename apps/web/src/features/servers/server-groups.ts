import type { ReactNode } from "react";
import type { ServerConfig, ServerType } from "@mcp-token-footprint/shared";
import type { EntityGroupBy } from "../../components/entity-browser";

/**
 * Grouping the fleet by SERVER TYPE (RM-32 D-OD6) — the dimension the registry already models
 * (planning/Roadmap/completed/RM-21-server-types) and the one the deleted rail grouped by, so the
 * overview's sections are the sections operators already know.
 *
 * A server's type only counts when its `typeId` references a KNOWN type: a dangling id (its type
 * deleted out from under it) resolves as untyped rather than crashing or inventing a group.
 */
export function resolveServerType(
  server: ServerConfig,
  typesById: Map<string, ServerType>,
): ServerType | null {
  return server.typeId ? (typesById.get(server.typeId) ?? null) : null;
}

export function serverTypesById(serverTypes: ServerType[]): Map<string, ServerType> {
  return new Map(serverTypes.map((type) => [type.id, type] as const));
}

/** The type ids actually in use by the given fleet, in the API's order (name ascending). */
export function typesInUse(servers: ServerConfig[], serverTypes: ServerType[]): ServerType[] {
  const typesById = serverTypesById(serverTypes);
  const used = new Set<string>();
  for (const server of servers) {
    const type = resolveServerType(server, typesById);
    if (type) used.add(type.id);
  }
  return serverTypes.filter((type) => used.has(type.id));
}

export function serverTypeGroupBy(params: {
  serverTypes: ServerType[];
  /** Rendered beside a group's label — the type's lifecycle status chip. */
  renderBadge?: (type: ServerType) => ReactNode;
  /** The fleet, used only to fix the group ORDER to the types actually in use. */
  servers: ServerConfig[];
}): EntityGroupBy<ServerConfig> {
  const typesById = serverTypesById(params.serverTypes);
  return {
    id: "type",
    label: "Type",
    fallbackLabel: "Untyped",
    groupOrder: typesInUse(params.servers, params.serverTypes).map((type) => type.id),
    groupOf: (server) => {
      const type = resolveServerType(server, typesById);
      if (!type) return null;
      const badge = params.renderBadge?.(type);
      return {
        key: type.id,
        label: type.name,
        ...(badge !== undefined ? { badge } : {}),
      };
    },
  };
}
