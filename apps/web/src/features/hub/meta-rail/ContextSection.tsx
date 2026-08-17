import { useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Spinner,
  Text,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@elabs-ai/components-ui";
import type {
  HubContextHistoryLayer,
  HubContextInspector,
  HubContextMemoryLayer,
  HubContextToolsLayer,
  HubFile,
  HubProject,
  HubSession,
  HubSkillSessionUsage,
} from "@mcp-token-footprint/shared";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Folder,
  Info,
  KeyRound,
  Pin,
  RefreshCw,
  Server,
  Sparkles,
} from "lucide-react";
import { getHubSessionContext, hubSessionReportUrl, reconnectHubMcpServer } from "../../../lib/api";
import { useMcpAuthOptional } from "../../servers/McpAuthProvider";
import { formatBytes, formatNumber } from "../../../lib/format";
import { getErrorMessage } from "../../../lib/errors";
import { ManageToolScopeDialog } from "./ManageToolScopeDialog";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub UX (WP1.2, D-HUX3/D-HUX11) — the meta rail's CONTEXT section: the project block, a
 * plain read of the session's live surfaces (active MCP servers · available skills · memory &
 * history), and the (r4) **effective-memory** slot. Per owner feedback the token-heavy "context
 * window (est.)" + "prompt sections" blocks were dropped as noise — the inspector now feeds only the
 * servers/skills/memory lists below.
 *
 * `effectiveMemory` is typed `ReactNode` on purpose — WP1.2 has no memory-scopes data to render yet,
 * so this slot is a pure composition point, not a stub UI this WP would have to guess at and WP2.7
 * would have to rip out. WP2.7 fills it with `EffectiveMemoryStack` and wires `onManageMemory` to the
 * section's OWN header action (next to the "Effective memory" label) — §7.5's "Memory · manage" entry
 * point onto `ProfileMemoryDialog`.
 *
 * The component does NOT fetch its own data and does NOT wrap content in `@elabs-ai/components-ai`'s `ContextPanel`
 * (that owns its own width-animated collapse + a root/detail drill-in — chrome this rail's own
 * `RailSection` collapse already provides). It receives already-resolved props (self-contained,
 * testable with fixtures) and delegates "open a pinned file" / "manage skills" / "manage memory"
 * outward — the same "the rail lists, the caller shows" contract `OutputsSection` uses.
 *
 * hub-fixes WP1.2 (RC3 — kills the display-half bug + the write-once trap) is the ONE deliberate
 * exception to "does not fetch its own data": the Tools header now shows the REAL scope
 * (`inspector.tools.scopeMode`, falling back to deriving it from `session.toolScope` while the
 * inspector hasn't loaded/is stale) plus a "Manage tool scope" action that opens
 * {@link ManageToolScopeDialog} — a self-contained editor (it owns its own PATCH). This section can't
 * delegate that open/refresh outward the way `onManageSkills`/`onManageMemory` do because the WP that
 * would need to wire a callback through `AssistantView.tsx` is scoped to OTHER files; instead, on a
 * successful save the dialog's `onSaved` callback re-fetches `getHubSessionContext` once and this
 * section shows that fresher snapshot locally until the caller's own next natural refresh arrives
 * (mirrored by `savedInspector` below).
 */

export type MetaRailContextProps = {
  /** `null` ⇒ no session open (the section's own empty state). */
  session: HubSession | null;
  project: HubProject | null;
  /** Defaults to `true` (already loaded) — pass `false` while the caller's own fetch is in flight. */
  projectLoaded?: boolean;
  projectError?: string | null;
  pinnedFiles?: HubFile[];
  onOpenPinnedFile?: (file: HubFile) => void;
  /** The session's live context surfaces. `null` ⇒ not yet measured / unavailable: the servers &
   *  skills lists degrade to their own empty states, and memory & history is omitted. */
  inspector: HubContextInspector | null;
  /** Opens the session skills panel — rendered as a small ghost "Manage" action in the Skills header
   *  (mirrors the "Effective memory · Manage" pattern). Absent ⇒ no manage affordance there. */
  onManageSkills?: () => void;
  /** D-HUX11 — the session's effective memory stack (profile/project/crew/agent, injection order,
   *  each entry tagged + linked), fed by WP2.7. Absent while that WP hasn't landed yet. */
  effectiveMemory?: ReactNode;
  /** WP2.7 (D-HUX11, §7.5) — "Memory · manage" opens `ProfileMemoryDialog`. Rendered next to the
   *  "Effective memory" label (only when `effectiveMemory` is also supplied); absent ⇒ no manage
   *  affordance here (the honest not-yet-actionable degrade). */
  onManageMemory?: () => void;
};

export function ContextSection({
  session,
  project,
  projectLoaded = true,
  projectError = null,
  pinnedFiles = [],
  onOpenPinnedFile,
  inspector,
  onManageSkills,
  effectiveMemory,
  onManageMemory,
}: MetaRailContextProps) {
  const [manageToolScopeOpen, setManageToolScopeOpen] = useState(false);
  // hub-fixes WP1.2 (RC3) — a locally re-fetched inspector snapshot taken right after a scope save, so
  // the Tools header + list reflect the edit immediately instead of waiting for the caller's own next
  // natural refresh. Cleared whenever the caller hands this section a session/inspector of its own —
  // a fresher external read always wins.
  const [savedInspector, setSavedInspector] = useState<HubContextInspector | null>(null);
  useEffect(() => {
    setSavedInspector(null);
  }, [session?.id, inspector]);
  const effectiveInspector = savedInspector ?? inspector;

  // hub-fixes WP1.3 (RC3.4) — the error chip's Retry action: evict the server's cached MCP session
  // (`POST .../reconnect`), then re-fetch the inspector so the caller's next natural refresh isn't the
  // only way to see the local effect (mirrors `ManageToolScopeDialog`'s own `onSaved` re-fetch, right
  // below). The reconnect itself only EVICTS the cache — the server doesn't actually reopen until the
  // next turn — so the toast says that plainly rather than implying an instant fix.
  const mcpAuth = useMcpAuthOptional();
  const [retryingServerId, setRetryingServerId] = useState<string | null>(null);
  // Authenticate a server that failed with an auth error — opens the ServerWizard reauth window (the
  // sanctioned path), then evicts the cached session so the fresh token is used next turn. Absent the
  // provider (an isolated test) there's no authenticate affordance.
  const handleAuthenticate = async (serverId: string, serverName: string) => {
    if (!session || !mcpAuth) return;
    try {
      const result = await mcpAuth.requestReauth(serverId);
      if (!result.ok) return; // cancelled, or not a reauth-able (oauth-http) server
      await reconnectHubMcpServer(serverId);
      toast.success(`Authenticated ${serverName}`, {
        description: "It'll be used on your next message in this session.",
      });
      const fresh = await getHubSessionContext(session.id);
      setSavedInspector(fresh);
    } catch (error) {
      notifyError(`Couldn’t authenticate ${serverName}`, { description: getErrorMessage(error) });
    }
  };
  const handleRetry = async (serverId: string, serverName: string) => {
    if (!session) return;
    setRetryingServerId(serverId);
    try {
      await reconnectHubMcpServer(serverId);
      toast.success(`Reconnecting to ${serverName}…`, {
        description: "It will retry on your next message in this session.",
      });
      const fresh = await getHubSessionContext(session.id);
      setSavedInspector(fresh);
    } catch (error) {
      notifyError(`Couldn’t queue a reconnect for ${serverName}`, {
        description: getErrorMessage(error),
      });
    } finally {
      setRetryingServerId(null);
    }
  };

  if (!session) {
    return (
      <EmptyState
        icon={<Info aria-hidden />}
        title="No session open"
        description="Open or start a session to see its context."
      />
    );
  }

  // Prefer the server-confirmed `scopeMode` (an older cached payload may omit it); fall back to
  // deriving it from the session's own `toolScope` before the inspector has ever loaded.
  const scopeMode: "scoped" | "auto" =
    effectiveInspector?.tools.scopeMode ?? (session.toolScope ? "scoped" : "auto");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ProjectBlock
        projectId={session.projectId ?? null}
        project={project}
        loaded={projectLoaded}
        error={projectError}
        pinnedFiles={pinnedFiles}
        {...(onOpenPinnedFile ? { onOpenPinnedFile } : {})}
      />
      <ServersBlock
        servers={groupServers(effectiveInspector?.tools ?? null)}
        scopeMode={scopeMode}
        onManage={() => setManageToolScopeOpen(true)}
        retryingServerId={retryingServerId}
        onRetry={handleRetry}
        {...(mcpAuth ? { onAuthenticate: handleAuthenticate } : {})}
      />
      <SkillsBlock
        usage={effectiveInspector?.skills.usage ?? []}
        {...(onManageSkills ? { onManageSkills } : {})}
      />
      {effectiveInspector ? (
        <MemoryHistoryBlock memory={effectiveInspector.memory} history={effectiveInspector.history} />
      ) : null}
      {effectiveMemory ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <Text variant="meta" tone="muted" className="uppercase tracking-wide">
              Effective memory
            </Text>
            {onManageMemory ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-caption"
                onClick={onManageMemory}
              >
                Manage
              </Button>
            ) : null}
          </div>
          {effectiveMemory}
        </div>
      ) : null}

      {/* Full session-log export — the complete ordered transcript (every input + output), JSON or
        Markdown. Each item is an `<a href download>` target; the server sets Content-Disposition. */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="justify-between">
              <span className="flex items-center gap-2">
                <Download className="size-4" aria-hidden />
                Export session
              </span>
              <ChevronDown className="size-4 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem asChild>
              <a href={hubSessionReportUrl(session.id, "markdown")} download>
                Markdown (.md)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={hubSessionReportUrl(session.id, "json")} download>
                JSON (.json)
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ManageToolScopeDialog
        open={manageToolScopeOpen}
        onOpenChange={setManageToolScopeOpen}
        sessionId={session.id}
        initialScope={session.toolScope ?? null}
        onSaved={() => {
          void getHubSessionContext(session.id)
            .then(setSavedInspector)
            .catch(() => {
              // Best-effort refresh only — the dialog's own toast already confirmed the PATCH
              // succeeded; the rail simply keeps showing the pre-save snapshot until the caller's
              // next natural refresh.
            });
        }}
      />
    </div>
  );
}

// ── Project (refactor-only copy of SessionContextPanel.tsx's "Project" ContextPanelSection) ────────

function ProjectBlock({
  projectId,
  project,
  loaded,
  error,
  pinnedFiles,
  onOpenPinnedFile,
}: {
  projectId: string | null;
  project: HubProject | null;
  loaded: boolean;
  error: string | null;
  pinnedFiles: HubFile[];
  onOpenPinnedFile?: (file: HubFile) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Text variant="meta" tone="muted" className="uppercase tracking-wide">
        Project
      </Text>
      {!projectId ? (
        <EmptyState
          icon={<Folder aria-hidden />}
          title="No project"
          description="Assign this session to a project to inherit its instructions and pinned files."
        />
      ) : !loaded ? (
        <div className="flex items-center gap-2 py-1 text-body text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <span>Loading…</span>
        </div>
      ) : error ? (
        <Text variant="caption" className="text-destructive" role="alert">
          {error}
        </Text>
      ) : project ? (
        <div className="flex min-w-0 flex-col gap-3">
          <Text className="min-w-0 truncate font-medium" title={project.name}>
            {project.name}
          </Text>

          <div className="flex min-w-0 flex-col gap-1">
            <Text variant="caption" tone="muted" className="uppercase tracking-wide">
              Instructions
            </Text>
            <Text className="min-w-0 text-pretty whitespace-pre-wrap break-words">
              {project.instructions?.trim() || "No instructions set."}
            </Text>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Text variant="caption" tone="muted" className="uppercase tracking-wide">
              Pinned files
            </Text>
            {pinnedFiles.length === 0 ? (
              <Text variant="caption" tone="muted">
                None pinned yet.
              </Text>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {pinnedFiles.map((file) => (
                  <li key={file.id} className="min-w-0">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5"
                      disabled={!onOpenPinnedFile}
                      onClick={() => onOpenPinnedFile?.(file)}
                    >
                      <Pin aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-start">
                        {file.filename ?? file.id}
                      </span>
                      <Text variant="caption" tone="muted" className="shrink-0 tabular-nums">
                        {formatBytes(file.bytes)}
                      </Text>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Active MCP servers ─────────────────────────────────────────────────────────────────────────────

type ServerGroup = {
  serverId: string;
  serverName: string;
  count: number;
  /** hub-fixes WP1.3 (RC3.4) — the server's LAST KNOWN connection status (from `tools.serverStatuses`),
   *  absent when the session has never attempted this server (a pre-WP1.3 session, or before its first
   *  turn). `error` chips render with 0 tools since a dropped server has none resident/deferred. */
  status?: "connected" | "error";
  statusMessage?: string;
  /** A reauth-able auth failure — the row offers "Authenticate" (the ServerWizard reauth flow) instead
   *  of the cache-evicting "Retry". */
  authRequired?: boolean;
};

/** Collapse the granted tool layer (resident + deferred) into one row per MCP server, name-sorted —
 *  the section shows *which servers are connected*, not the token internals the inspector also carries.
 *  hub-fixes WP1.3 (RC3.4): a server that FAILED to open this turn has zero resident/deferred tools
 *  (`resolveHubMcpGrants` drops it from the catalog), so it would otherwise vanish from this list
 *  entirely — the silent-drop bug's UI-inventory half. Merging in every server the session has a KNOWN
 *  status for (even at `count: 0`) keeps a dropped server visible with its error chip + Retry. */
function groupServers(tools: HubContextToolsLayer | null): ServerGroup[] {
  if (!tools) return [];
  const byId = new Map<string, ServerGroup>();
  for (const item of [...tools.resident, ...tools.deferred]) {
    const existing = byId.get(item.serverId);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(item.serverId, { serverId: item.serverId, serverName: item.serverName, count: 1 });
    }
  }
  for (const outcome of tools.serverStatuses ?? []) {
    const existing = byId.get(outcome.serverId);
    if (existing) {
      existing.status = outcome.status;
      if (outcome.message !== undefined) existing.statusMessage = outcome.message;
      if (outcome.authRequired) existing.authRequired = true;
    } else {
      byId.set(outcome.serverId, {
        serverId: outcome.serverId,
        serverName: outcome.serverName,
        count: 0,
        status: outcome.status,
        ...(outcome.message !== undefined ? { statusMessage: outcome.message } : {}),
        ...(outcome.authRequired ? { authRequired: true } : {}),
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.serverName.localeCompare(b.serverName));
}

function ServersBlock({
  servers,
  scopeMode,
  onManage,
  retryingServerId,
  onRetry,
  onAuthenticate,
}: {
  servers: ServerGroup[];
  /** hub-fixes WP1.2 (RC3) — "scoped" (the session carries an explicit `toolScope`) vs "auto" (every
   *  reachable server, the pre-WP1.2 default) — the display half of the fix: this now reflects the
   *  session's REAL scope instead of always implying every server is granted. */
  scopeMode: "scoped" | "auto";
  /** Opens the tool-scope editor (the write-once-trap fix — scope is editable after create). */
  onManage: () => void;
  /** hub-fixes WP1.3 (RC3.4) — the serverId currently mid-retry (disables its Retry button + shows a
   *  spinner), or `null`. */
  retryingServerId?: string | null;
  /** hub-fixes WP1.3 (RC3.4) — the error chip's Retry action. Absent ⇒ no Retry button rendered (the
   *  honest not-yet-actionable degrade every other optional callback in this rail already uses). */
  onRetry?: (serverId: string, serverName: string) => void;
  /** The auth-failure "Authenticate" action (opens the ServerWizard reauth flow). Shown instead of Retry
   *  for a reauth-able server (`authRequired`); a cache-evicting Retry can't fix an auth failure. */
  onAuthenticate?: (serverId: string, serverName: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Text variant="meta" tone="muted" className="uppercase tracking-wide">
            Tools
          </Text>
          <Badge variant={scopeMode === "scoped" ? "secondary" : "outline"} className="shrink-0">
            {scopeMode === "scoped" ? "Scoped" : "Auto (all reachable)"}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto shrink-0 px-1.5 py-0.5 text-caption"
          aria-label="Manage tool scope"
          onClick={onManage}
        >
          Manage
        </Button>
      </div>
      {servers.length === 0 ? (
        <EmptyState
          icon={<Server aria-hidden />}
          title="No MCP servers"
          description="No MCP servers are connected to this session."
        />
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {servers.map((s) => (
            <li key={s.serverId} className="flex min-w-0 items-center justify-between gap-2">
              <Text className="min-w-0 truncate" title={s.serverName}>
                {s.serverName}
              </Text>
              <div className="flex shrink-0 items-center gap-1.5">
                {s.status === "error" ? (
                  <>
                    <ServerStatusChip status="error" message={s.statusMessage} />
                    {s.authRequired && onAuthenticate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto gap-1 px-1.5 py-0.5 text-caption"
                        aria-label={`Authenticate ${s.serverName}`}
                        onClick={() => onAuthenticate(s.serverId, s.serverName)}
                      >
                        <KeyRound aria-hidden className="size-3" />
                        <span>Authenticate</span>
                      </Button>
                    ) : onRetry ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto gap-1 px-1.5 py-0.5 text-caption"
                        aria-label={`Retry connecting to ${s.serverName}`}
                        disabled={retryingServerId === s.serverId}
                        onClick={() => onRetry(s.serverId, s.serverName)}
                      >
                        {retryingServerId === s.serverId ? (
                          <Spinner className="size-3" aria-hidden />
                        ) : (
                          <RefreshCw aria-hidden className="size-3" />
                        )}
                        <span>Retry</span>
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {s.status === "connected" ? <ServerStatusChip status="connected" /> : null}
                    <Text variant="caption" tone="muted" className="tabular-nums">
                      {s.count} {s.count === 1 ? "tool" : "tools"}
                    </Text>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** hub-fixes WP1.3 (RC3.4) — one granted server's connection chip. Color is never the only signal
 *  (brand-ui `Badge`'s own anti-pattern note) — each state pairs an icon + a distinct label. `error`
 *  wraps in a `Tooltip` carrying the short failure reason (when known); `connected` needs none. */
function ServerStatusChip({
  status,
  message,
}: {
  status: "connected" | "error";
  message?: string;
}) {
  if (status === "connected") {
    return (
      <Badge variant="success" className="shrink-0 gap-1">
        <CheckCircle2 aria-hidden className="size-3" />
        Connected
      </Badge>
    );
  }
  const badge = (
    <Badge variant="destructive" className="shrink-0 gap-1">
      <AlertTriangle aria-hidden className="size-3" />
      Unreachable
    </Badge>
  );
  if (!message) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">{badge}</span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

// ── Available skills ─────────────────────────────────────────────────────────────────────────────

function SkillsBlock({
  usage,
  onManageSkills,
}: {
  usage: HubSkillSessionUsage[];
  onManageSkills?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Text variant="meta" tone="muted" className="uppercase tracking-wide">
          Skills
        </Text>
        {onManageSkills ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-1.5 py-0.5 text-caption"
            aria-label="Manage skills"
            onClick={onManageSkills}
          >
            Manage
          </Button>
        ) : null}
      </div>
      {usage.length === 0 ? (
        <EmptyState
          icon={<Sparkles aria-hidden />}
          title="No skills"
          description="No skills are available in this session."
        />
      ) : (
        <ul className="flex min-w-0 flex-col gap-1">
          {usage.map((skill) => (
            <li key={skill.skillId} className="flex min-w-0 flex-col gap-0.5">
              <Text className="min-w-0 truncate" title={skill.name}>
                {skill.name}
              </Text>
              {!skill.invoked ? (
                <Text variant="caption" tone="muted">
                  not yet invoked
                </Text>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Memory & history (kept verbatim — Memory tok/items + History tok/messages) ─────────────────────

function MemoryHistoryBlock({
  memory,
  history,
}: {
  memory: HubContextMemoryLayer;
  history: HubContextHistoryLayer;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Text variant="meta" tone="muted" className="uppercase tracking-wide">
        Memory &amp; history
      </Text>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Text variant="caption" tone="muted">
            Memory
          </Text>
          <Text variant="caption" className="tabular-nums">
            {formatNumber(memory.tokens)} tok · {memory.itemCount} item
            {memory.itemCount === 1 ? "" : "s"}
          </Text>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Text variant="caption" tone="muted">
            History
          </Text>
          <Text variant="caption" className="tabular-nums">
            {formatNumber(history.tokens)} tok · {history.messageCount} message
            {history.messageCount === 1 ? "" : "s"}
          </Text>
        </div>
      </div>
    </div>
  );
}
