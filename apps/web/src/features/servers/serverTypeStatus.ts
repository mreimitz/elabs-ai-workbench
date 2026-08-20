import type { ServerTypeStatus } from "@mcp-token-footprint/shared";
import { SERVER_TYPE_STATUSES } from "@mcp-token-footprint/shared";

/**
 * Human labels for a server type's lifecycle status (planning/Roadmap/completed/RM-21-server-types, D-ST1). Shared by the
 * wizard's type Select and the Manage-types form so option/select copy never drifts. The
 * `ServerTypeStatusBadge` owns the same vocabulary for its coloured chip — this is the plain-text
 * variant used inside `<Select>` options where a Badge would be the wrong element.
 */
export const SERVER_TYPE_STATUS_LABELS: Record<ServerTypeStatus, string> = {
  production: "Production",
  release_candidate: "Release candidate",
  beta: "Beta",
  deprecated: "Deprecated",
};

/** `<Select>` options over the four statuses, in "productionness" order (the constant's order). */
export const serverTypeStatusOptions: { value: ServerTypeStatus; label: string }[] =
  SERVER_TYPE_STATUSES.map((status) => ({ value: status, label: SERVER_TYPE_STATUS_LABELS[status] }));
