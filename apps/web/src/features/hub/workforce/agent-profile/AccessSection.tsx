import { useEffect, useMemo, useState } from "react";
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
  Button,
  Checkbox,
  Label,
  Spinner,
  Text,
} from "@brand/ui";
import { SearchInput } from "@brand/data";
import { AlertTriangle, Coins } from "lucide-react";
import { ApiError, apiGet, listServers } from "../../../../lib/api";
import { getErrorMessage } from "../../../../lib/errors";

/**
 * Assistant Hub UX WP2.3 · Access section (D-HUX7 — the centerpiece).
 *
 * The D-HUX7 upgrade of the old `ToolGrantPicker`: per registered MCP server a **tri-state** master
 * checkbox (none / some / all), **per-tool** checkboxes, a **per-server search**, **all / none**
 * quick actions, **live granted counts**, and — the point of the section — **every tool row shows
 * its scan-measured token cost** (the `totalTokens` of that tool's serialized definition from the
 * server's LATEST scan, `mcp_tool_scans`), with a **running footprint total** for the whole granted
 * set. Reuses the same scanned-tool surface the rest of the app measures, via the SAME endpoint the
 * old picker read (`GET /api/servers/:id/latest-scan` → `ScanDetail`) — no new API read is needed,
 * because that scan already carries per-tool `totalTokens`.
 *
 * Grant semantics (R-MCP1, preserved from `ToolGrantPicker`): a server ABSENT from `servers` grants
 * none of its tools; `"all"` means "every tool, including ones a future rescan adds"; a `string[]`
 * is an explicit allowlist. Unchecking a single tool while a server is `"all"` converts it to the
 * explicit "all-current-tools-minus-one" list rather than silently dropping the whole grant — and a
 * full explicit list is NOT auto-collapsed back to `"all"` (that would change the semantic from
 * "these specific tools" to "everything", R-MCP1).
 */

/** The hub built-ins a role may grant (mirrors `ToolGrantPicker`'s `HUB_BUILTIN_TOOLS`, minus the
 *  planner-only `mission.propose_plan`). These are in-process — they carry no scan-measured cost. */
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

type ScannedTool = { toolName: string; totalTokens: number };

type ServerState = {
  server: ServerConfig;
  scan: ScanDetail | null;
  tools: ScannedTool[];
};

function tokensLabel(tokens: number): string {
  return tokens.toLocaleString();
}

/** The set of tool names granted for a server (resolving `"all"` against the scanned tool list). */
function grantedToolNames(grant: HubServerToolGrant | undefined, tools: ScannedTool[]): string[] {
  if (grant === undefined) return [];
  if (grant === "all") return tools.map((t) => t.toolName);
  return grant;
}

function grantedTokensFor(grant: HubServerToolGrant | undefined, tools: ScannedTool[]): number {
  if (grant === undefined) return 0;
  const names = grant === "all" ? null : new Set(grant);
  return tools.reduce(
    (sum, tool) => (names === null || names.has(tool.toolName) ? sum + tool.totalTokens : sum),
    0,
  );
}

function serverCheckState(
  grant: HubServerToolGrant | undefined,
): boolean | "indeterminate" {
  if (grant === "all") return true;
  if (Array.isArray(grant) && grant.length > 0) return "indeterminate";
  return false;
}

function grantSummary(grant: HubServerToolGrant | undefined, toolCount: number): string {
  if (grant === undefined) return "No tools";
  if (grant === "all") return "All tools";
  return `${grant.length} / ${toolCount} tool${toolCount === 1 ? "" : "s"}`;
}

export function AccessSection({
  value,
  onChange,
  disabled,
}: {
  value: HubToolGrants;
  onChange: (next: HubToolGrants) => void;
  disabled?: boolean;
}) {
  const [servers, setServers] = useState<ServerState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-server tool-filter text (D-HUX7 "search"). Keyed by server id; empty = show all.
  const [queries, setQueries] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listServers();
        if (cancelled) return;
        const states = await Promise.all(
          list.map(async (server): Promise<ServerState> => {
            try {
              const scan = await apiGet<ScanDetail>(`/api/servers/${server.id}/latest-scan`);
              return {
                server,
                scan,
                tools: (scan.tools ?? []).map((t) => ({
                  toolName: t.toolName,
                  totalTokens: t.totalTokens ?? 0,
                })),
              };
            } catch (err) {
              // A 404 (never scanned) is expected — "all" is still grantable, individual tools + their
              // token cost just can't be enumerated. Any other failure degrades the same way (one broken
              // server must not blank the whole picker), which matches `ToolGrantPicker`'s posture.
              if (!(err instanceof ApiError) || err.status !== 404) {
                console.warn(`Could not load the latest scan for server ${server.id}`, err);
              }
              return { server, scan: null, tools: [] };
            }
          }),
        );
        if (!cancelled) setServers(states);
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

  const toggleServerAll = (serverId: string, checked: boolean): void => {
    setServerGrant(serverId, checked ? "all" : undefined);
  };

  const toggleOneTool = (
    serverId: string,
    tools: ScannedTool[],
    toolName: string,
    checked: boolean,
  ): void => {
    const current = value.servers[serverId];
    // Materialize "all" into an explicit list the moment a single tool is unchecked (R-MCP1), so the
    // grant remains a concrete set the user can further tune.
    const currentList =
      current === "all" ? tools.map((t) => t.toolName) : Array.isArray(current) ? current : [];
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

  // The running footprint total for the WHOLE granted set (D-HUX7) — sum of every granted MCP tool's
  // scan-measured `totalTokens`, plus the granted counts and a flag for granted servers with no scan
  // (whose token cost can't be counted, so the total isn't silently understated).
  const footprint = useMemo(() => {
    let tokens = 0;
    let mcpTools = 0;
    let serversWithGrants = 0;
    let unscannedGranted = 0;
    for (const { server, scan, tools } of servers) {
      const grant = value.servers[server.id];
      if (grant === undefined) continue;
      serversWithGrants += 1;
      tokens += grantedTokensFor(grant, tools);
      mcpTools += grantedToolNames(grant, tools).length;
      if (scan === null) unscannedGranted += 1;
    }
    return { tokens, mcpTools, serversWithGrants, unscannedGranted };
  }, [servers, value.servers]);

  return (
    <div className="flex flex-col gap-4">
      {/* Footprint total — the D-HUX7 "running footprint total for the granted set". */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Coins aria-hidden className="size-4 text-muted-foreground" />
          <Text className="font-medium">Granted footprint</Text>
        </div>
        <div className="flex items-baseline gap-1.5">
          <Text className="text-title font-semibold tabular-nums">{tokensLabel(footprint.tokens)}</Text>
          <Text variant="caption" tone="muted">
            tokens
          </Text>
        </div>
        <Text variant="caption" tone="muted" className="tabular-nums">
          {footprint.mcpTools} tool{footprint.mcpTools === 1 ? "" : "s"} across{" "}
          {footprint.serversWithGrants} server{footprint.serversWithGrants === 1 ? "" : "s"}
        </Text>
      </div>
      {footprint.unscannedGranted > 0 ? (
        <div className="flex items-start gap-2 text-caption text-muted-foreground">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {footprint.unscannedGranted} granted server
            {footprint.unscannedGranted === 1 ? " has" : "s have"} no scan yet — their token cost
            isn’t counted in the footprint. Run a scan from the Servers view to measure them.
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Text className="font-medium">MCP servers &amp; tools</Text>
        {loading ? (
          <div className="flex items-center gap-2 text-body text-muted-foreground">
            <Spinner className="size-4" aria-hidden />
            <span>Loading registered servers…</span>
          </div>
        ) : error ? (
          <Text variant="meta" className="text-destructive" role="alert">
            Couldn’t load servers: {error}
          </Text>
        ) : servers.length === 0 ? (
          <Text variant="caption" tone="muted">
            No MCP servers are registered yet. Add one from the Servers view to grant its tools here.
          </Text>
        ) : (
          <Accordion type="multiple" className="rounded-md border border-border px-2">
            {servers.map(({ server, scan, tools }) => {
              const grant = value.servers[server.id];
              const query = queries[server.id]?.trim().toLowerCase() ?? "";
              const grantedNames = new Set(grantedToolNames(grant, tools));
              const filteredTools = query
                ? tools.filter((tool) => tool.toolName.toLowerCase().includes(query))
                : tools;
              const serverTokens = grantedTokensFor(grant, tools);
              return (
                <AccordionItem key={server.id} value={server.id} className="last:border-b-0">
                  <div className="flex items-center gap-2 pe-1">
                    {/* The tri-state master lives BESIDE the trigger (a checkbox nested inside the
                        trigger button would be an invalid button-in-button). */}
                    <Checkbox
                      aria-label={`Grant all tools from ${server.name}`}
                      checked={serverCheckState(grant)}
                      disabled={disabled}
                      onCheckedChange={(next) => toggleServerAll(server.id, next === true)}
                    />
                    <AccordionTrigger className="min-w-0 flex-1 gap-2 hover:no-underline">
                      <span className="min-w-0 flex-1 truncate text-start font-medium">
                        {server.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {serverTokens > 0 ? (
                          <Text variant="caption" tone="muted" className="tabular-nums">
                            {tokensLabel(serverTokens)} tok
                          </Text>
                        ) : null}
                        <Badge variant={grant !== undefined ? "secondary" : "outline"}>
                          {grantSummary(grant, tools.length)}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                  </div>
                  <AccordionContent className="flex flex-col gap-2">
                    {tools.length === 0 ? (
                      <Text variant="caption" tone="muted" className="px-1.5">
                        {scan
                          ? "This server’s latest scan found no tools."
                          : "No scan yet — run a scan from the Servers view to grant individual tools. “All tools” still grants everything once one exists."}
                      </Text>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <SearchInput
                              value={queries[server.id] ?? ""}
                              onValueChange={(next) =>
                                setQueries((prev) => ({ ...prev, [server.id]: next }))
                              }
                              label={`Filter ${server.name} tools`}
                              placeholder="Filter tools…"
                            />
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              onClick={() => setServerGrant(server.id, "all")}
                            >
                              All
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled || grant === undefined}
                              onClick={() => setServerGrant(server.id, undefined)}
                            >
                              None
                            </Button>
                          </div>
                        </div>
                        {filteredTools.length === 0 ? (
                          <Text variant="caption" tone="muted" className="px-1.5">
                            No tools match “{queries[server.id]}”.
                          </Text>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {filteredTools.map((tool) => {
                              const fieldId = `agent-access-${server.id}-tool-${tool.toolName}`;
                              const checked = grantedNames.has(tool.toolName);
                              return (
                                <Label
                                  key={tool.toolName}
                                  htmlFor={fieldId}
                                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-normal hover:bg-muted"
                                >
                                  <Checkbox
                                    id={fieldId}
                                    // The visible label also carries the token-cost span; name the
                                    // control by the tool alone so AT announces "search", not
                                    // "search 120 tok".
                                    aria-label={tool.toolName}
                                    checked={checked}
                                    disabled={disabled}
                                    onCheckedChange={(next) =>
                                      toggleOneTool(server.id, tools, tool.toolName, next === true)
                                    }
                                  />
                                  <span className="min-w-0 flex-1 truncate">{tool.toolName}</span>
                                  <span className="shrink-0 tabular-nums text-caption text-muted-foreground">
                                    {tokensLabel(tool.totalTokens)} tok
                                  </span>
                                </Label>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Text className="font-medium">Built-in tools</Text>
        <Text variant="caption" tone="muted">
          In-process hub tools — always available, no scan-measured token cost.
        </Text>
        <div className="flex flex-col gap-0.5 rounded-md border border-border p-2">
          {HUB_BUILTIN_TOOLS.map((builtin) => {
            const fieldId = `agent-access-builtin-${builtin.name}`;
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
                <span className="min-w-0 flex-1 truncate">{builtin.label}</span>
                <span className="shrink-0 font-mono text-caption text-muted-foreground">
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
