import { useEffect, useState } from "react";
import type {
  HubServerToolGrant,
  HubToolGrants,
  ScanDetail,
  ServerConfig,
} from "@mcp-token-footprint/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Checkbox,
  Label,
  Spinner,
  Text,
} from "@elabs-ai/components-ui";
import { apiGet, ApiError, listServers } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";

/**
 * Assistant Hub (WP2.1, D-AH7 "MCP servers AND individual tools") — the full grant picker: per
 * registered MCP server, grant `"all"` its tools or an explicit tool-name allowlist (from that
 * server's LATEST scan — the same scanned tool surface the rest of the app measures), plus the
 * in-process hub built-ins (`HubToolGrants.builtins`). A server absent from `servers` grants none of
 * its tools (R-MCP1's ABSENT-means-NONE convention, `HubToolGrants`'s own doc) — this picker just
 * mirrors that convention in the UI: no entry until the user grants something.
 *
 * Mirrors `apps/api/src/hub/tools/builtins/index.ts`'s `ALL_BUILTINS` MINUS the planner-only
 * `mission.propose_plan` (a role's own grant list isn't the place to hand-grant the planner tool —
 * mission mode grants it automatically). If that registry ever changes, update this list to match.
 */
const HUB_BUILTIN_TOOLS: { name: string; label: string }[] = [
  { name: "files.list", label: "List workspace files" },
  { name: "files.read", label: "Read a workspace file" },
  { name: "files.write", label: "Write a workspace file" },
  { name: "files.edit", label: "Edit a workspace file" },
  { name: "artifacts.create", label: "Create an artifact" },
  { name: "artifacts.update", label: "Update an artifact" },
  { name: "memory.propose_save", label: "Propose a memory save" },
  { name: "tasks.create", label: "Create a task" },
  { name: "tasks.update", label: "Update a task" },
  { name: "tasks.list", label: "List tasks" },
];

function grantedToolCount(grant: HubServerToolGrant | undefined, toolCount: number): number {
  if (grant === undefined) return 0;
  if (grant === "all") return toolCount;
  return grant.length;
}

function grantSummary(grant: HubServerToolGrant | undefined, toolCount: number): string {
  if (grant === undefined) return "No tools granted";
  if (grant === "all") return "All tools";
  return `${grant.length} tool${grant.length === 1 ? "" : "s"}`;
}

export function ToolGrantPicker({
  idPrefix,
  value,
  onChange,
  disabled,
  allowedServerIds,
}: {
  idPrefix: string;
  value: HubToolGrants;
  onChange: (next: HubToolGrants) => void;
  disabled?: boolean;
  /** hub-fixes WP2.2 (RC2.4) — constrain the picker to a specific set of server ids (e.g. a mission
   *  plan's grantable catalog). Absent ⇒ every registered server is offered (the default). */
  allowedServerIds?: readonly string[];
}) {
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [scans, setScans] = useState<Record<string, ScanDetail | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listServers();
        if (cancelled) return;
        setServers(list);
        const entries = await Promise.all(
          list.map(async (server): Promise<[string, ScanDetail | null]> => {
            try {
              const scan = await apiGet<ScanDetail>(`/api/servers/${server.id}/latest-scan`);
              return [server.id, scan];
            } catch (err) {
              // A 404 (never scanned yet) is expected — "all" is still grantable, individual tools
              // just can't be enumerated until a scan exists. Any OTHER failure is tolerated the same
              // way (best-effort picker), since one broken server must not blank the whole picker.
              if (!(err instanceof ApiError) || err.status !== 404) {
                console.warn(`Could not load the latest scan for server ${server.id}`, err);
              }
              return [server.id, null];
            }
          }),
        );
        if (!cancelled) setScans(Object.fromEntries(entries));
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setServerGrant = (serverId: string, grant: HubServerToolGrant | undefined): void => {
    const nextServers = { ...value.servers };
    if (grant === undefined) delete nextServers[serverId];
    else nextServers[serverId] = grant;
    onChange({ ...value, servers: nextServers });
  };

  const toggleAllTools = (serverId: string, checked: boolean): void => {
    setServerGrant(serverId, checked ? "all" : undefined);
  };

  const toggleOneTool = (serverId: string, toolName: string, checked: boolean): void => {
    const current = value.servers[serverId];
    const currentList = Array.isArray(current) ? current : [];
    const nextList = checked
      ? [...new Set([...currentList, toolName])]
      : currentList.filter((name) => name !== toolName);
    setServerGrant(serverId, nextList.length > 0 ? nextList : undefined);
  };

  const toggleBuiltin = (name: string, checked: boolean): void => {
    const next = checked
      ? [...new Set([...value.builtins, name])]
      : value.builtins.filter((builtin) => builtin !== name);
    onChange({ ...value, builtins: next });
  };

  // WP2.2 (RC2.4) — when a catalog constraint is supplied, only offer those servers (a mission agent may
  // only be granted servers reachable from the parent session). Absent ⇒ every registered server.
  const allowed = allowedServerIds ? new Set(allowedServerIds) : null;
  const visibleServers = allowed ? servers.filter((server) => allowed.has(server.id)) : servers;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Text variant="body" className="font-medium">
          MCP servers
        </Text>
        {loading ? (
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Spinner className="size-4" aria-hidden />
            <span>Loading registered servers…</span>
          </div>
        ) : error ? (
          <Text variant="meta" className="text-destructive" role="alert">
            Couldn’t load servers: {error}
          </Text>
        ) : visibleServers.length === 0 ? (
          <Text variant="caption" tone="muted">
            {allowed
              ? "No MCP servers are reachable from this session to grant here."
              : "No MCP servers are registered yet. Add one from the Servers view to grant its tools here."}
          </Text>
        ) : (
          <Accordion type="multiple" className="rounded-md border border-border px-2">
            {visibleServers.map((server) => {
              const scan = scans[server.id] ?? null;
              const tools = scan?.tools ?? [];
              const grant = value.servers[server.id];
              const allChecked = grant === "all";
              return (
                <AccordionItem key={server.id} value={server.id} className="last:border-b-0">
                  <AccordionTrigger className="gap-2 hover:no-underline">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="min-w-0 truncate font-medium">{server.name}</span>
                    </span>
                    <Badge
                      variant={grantedToolCount(grant, tools.length) > 0 ? "secondary" : "outline"}
                      className="mr-2 shrink-0"
                    >
                      {grantSummary(grant, tools.length)}
                    </Badge>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-2">
                    <Label
                      htmlFor={`${idPrefix}-server-${server.id}-all`}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-medium hover:bg-muted"
                    >
                      <Checkbox
                        id={`${idPrefix}-server-${server.id}-all`}
                        checked={allChecked}
                        disabled={disabled}
                        onCheckedChange={(next) => toggleAllTools(server.id, next === true)}
                      />
                      <span>All tools</span>
                    </Label>
                    {tools.length === 0 ? (
                      <Text variant="caption" tone="muted" className="px-1.5">
                        {scan
                          ? "This server's latest scan found no tools."
                          : "No scan yet — run a scan from the Servers view to grant individual tools. “All tools” still grants everything once one exists."}
                      </Text>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {tools.map((tool) => {
                          const fieldId = `${idPrefix}-server-${server.id}-tool-${tool.toolName}`;
                          const checked =
                            allChecked || (Array.isArray(grant) && grant.includes(tool.toolName));
                          return (
                            <Label
                              key={tool.id}
                              htmlFor={fieldId}
                              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-normal hover:bg-muted"
                            >
                              <Checkbox
                                id={fieldId}
                                checked={checked}
                                disabled={disabled || allChecked}
                                onCheckedChange={(next) =>
                                  toggleOneTool(server.id, tool.toolName, next === true)
                                }
                              />
                              <span className="min-w-0 truncate">{tool.toolName}</span>
                            </Label>
                          );
                        })}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Text variant="body" className="font-medium">
          Built-in tools
        </Text>
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
          {HUB_BUILTIN_TOOLS.map((builtin) => {
            const fieldId = `${idPrefix}-builtin-${builtin.name}`;
            const checked = value.builtins.includes(builtin.name);
            return (
              <Label
                key={builtin.name}
                htmlFor={fieldId}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-normal hover:bg-muted"
              >
                <Checkbox
                  id={fieldId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) => toggleBuiltin(builtin.name, next === true)}
                />
                <span className="min-w-0 truncate">{builtin.label}</span>
                <span className="ml-auto shrink-0 font-mono text-caption text-muted-foreground">
                  {builtin.name}
                </span>
              </Label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
