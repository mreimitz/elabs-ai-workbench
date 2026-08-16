import type { ServerTypeStatus } from "@mcp-token-footprint/shared";
import { Badge } from "@brand/ui";

// The lifecycle-status chip for a server TYPE (roadmap/server-types, D-ST1). This is a distinct
// vocabulary from the app's process-status chip (`components/StatusBadge` over `lib/status`, which
// maps scan/run outcomes) — production/RC/beta/deprecated describe a fleet's maturity, not a run's
// result — so it composes the `@brand/ui` `Badge` with its built-in tone variants directly rather
// than routing through that closed process-status table. No raw colours: the variant carries the
// tone in both themes. Reused by the servers rail headers (WP 2.1) and later the toolbar/profile +
// Manage-types surfaces (WP 2.2).

type ServerTypeStatusVariant = "success" | "info" | "warning" | "secondary";

const STATUS_META: Record<
  ServerTypeStatus,
  { label: string; variant: ServerTypeStatusVariant }
> = {
  // green — the current production fleet
  production: { label: "Production", variant: "success" },
  // blue — near-ready, informational
  release_candidate: { label: "Release candidate", variant: "info" },
  // amber — caution, not fully baked
  beta: { label: "Beta", variant: "warning" },
  // muted — de-emphasized / on the way out
  deprecated: { label: "Deprecated", variant: "secondary" },
};

export function ServerTypeStatusBadge(props: { status: ServerTypeStatus; className?: string }) {
  const meta = STATUS_META[props.status];
  return (
    <Badge variant={meta.variant} className={props.className}>
      {meta.label}
    </Badge>
  );
}
