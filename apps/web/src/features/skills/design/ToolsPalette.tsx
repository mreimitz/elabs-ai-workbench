import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BoundTool,
  ServerConfig,
  ServerType,
  SkillEditsResponse,
  SkillGraph,
  SkillServerBinding,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  Heading,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@brand/ui";
import { IconButton } from "../../../components/IconButton";
import { SearchInput } from "@brand/data";
import {
  CircleDashed,
  GripVertical,
  Link2,
  PanelLeftClose,
  Plus,
  Server,
  Tags,
  Wrench,
  X,
} from "lucide-react";
import { apiGet, apiPost, listServerTypes } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { ConfirmDialog } from "../../../components/dialogs";
import { ServerTypeStatusBadge } from "../../servers/ServerTypeStatusBadge";
import { fetchSkillBindings, getSkill, getSkillFile } from "../skills-inspector-api";
import {
  deriveBindCandidates,
  deriveBindTypeCandidates,
  type BindCandidate,
  type BindTypeCandidate,
} from "./bind-server-candidates";
import { buildBindingChips, type BindingChip } from "./binding-display";
import { useSkillBindingHost } from "./bind-server-context";
import { BindServerDialog, useServerDirectory } from "./BindServerDialog";
import {
  addFrontmatterServer,
  parseFrontmatterServers,
  removeFrontmatterServer,
} from "./frontmatter-servers";
import { notifyError } from "../../../lib/notify";

// Skill IDE WP 8.3 (I9.3) — the visual half of the tools surface. Per-server groups of the bound
// servers' tools (from the WP 8.2 `bound-tools` read — persisted scans only, never a live MCP call),
// filterable, each row showing the tool's DEFINITION token cost. The header sums the tool-surface
// footprint: Σ definition tokens of tools currently REFERENCED (a `tool_ref` node in the graph) AND
// RESOLVED (a bound tool). Two edit-mode affordances put a tool into the skill WITHOUT mutating
// anything until Save (I2): insert-at-cursor (a backticked reference into the active section-body
// editor, staged as `update_section_body` when applied) and drag-onto-a-section-node (staged as
// `add_tool_ref`). Everything here is read-only over scan data; the palette never opens a connection.
//
// Skill Studio WP 7.3a (audit SI1, D-UX17a) — the palette is ALSO where the skill↔server binding is
// managed, first-class instead of hand-edited YAML: bound-server chips (unbind behind a confirm) and
// a "Bind server…" picker over the REGISTERED servers. A bind/unbind edits the `servers:` list in
// the version's SKILL.md frontmatter (`frontmatter-servers.ts`, byte-preserving) and saves it through
// the SAME content-canonical route the editor's draft save uses (`POST /api/skills/:id/save-draft`,
// head-guarded 409), then hands the new version to the inspector via `onVersionSaved` — exactly the
// keyword-editor precedent. While the editor has UNSAVED draft changes the binding actions disable
// (the two save paths must not race); the guard state arrives via `SkillBindingHostContext`.

/** The dataTransfer MIME a palette-tool drag carries — read by `SkillGraphCanvas`'s drop handler to
 *  stage an `add_tool_ref` onto the section node the tool was dropped on. */
export const TOOL_DRAG_MIME = "application/x-mcp-tool";

/** The drag payload serialized into {@link TOOL_DRAG_MIME} on `dragstart`. */
export type ToolDragPayload = { server: string; tool: string };

export type ToolsPaletteProps = {
  /** The RAW/authoritative graph — its `tool_ref` nodes define the "referenced" set for the footprint. */
  graph: SkillGraph;
  /** The bound servers' tools (WP 8.2 read). `[]` ⇒ unbound (or no completed scan) → the empty state. */
  boundTools: BoundTool[];
  /** True while the bound-tools fetch is in flight (first load). */
  loading: boolean;
  /** Edit mode: enables drag-to-reference + insert-at-cursor. Off ⇒ the palette is read-only (still
   *  shows costs + the footprint readout). */
  editMode: boolean;
  /** True when a section-body editor is mounted (edit mode + a section selected) — gates insert-at-cursor. */
  canInsert: boolean;
  /** Insert a backticked reference to `toolName` at the active body editor's cursor (edit mode). */
  onInsertTool: (toolName: string) => void;
  /** SI16 — when set, the header shows a collapse chevron and the palette fills its host panel
   *  (fluid width) instead of pinning its own `w-72` column. Supplied by the Design surface's
   *  resizable panel chrome; omitted ⇒ the palette renders its classic fixed-width column. */
  onCollapse?: () => void;
};

/** The tool names referenced by a `tool_ref` node anywhere in the graph (projected from SKILL.md text). */
function referencedToolNames(graph: SkillGraph): Set<string> {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "tool_ref") names.add(node.toolName);
  }
  return names;
}

/** One server's group of bound tools (sorted by tool name), after the search filter. */
type ServerGroup = { serverName: string; tools: BoundTool[] };

export function ToolsPalette({
  graph,
  boundTools,
  loading,
  editMode,
  canInsert,
  onInsertTool,
  onCollapse,
}: ToolsPaletteProps) {
  const [query, setQuery] = useState("");

  const binding = useSkillBindingHost();
  const skillId = binding?.skillId;
  const versionId = binding?.versionId;

  // ── WP 7.3a: the declared binding list (the version's SAVED SKILL.md frontmatter `servers:`) ────
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillMdBinary, setSkillMdBinary] = useState(false);
  const [skillMdError, setSkillMdError] = useState<string | null>(null);
  useEffect(() => {
    if (!skillId || !versionId) return;
    let cancelled = false;
    setSkillMd(null);
    setSkillMdBinary(false);
    setSkillMdError(null);
    getSkillFile(skillId, versionId, "SKILL.md")
      .then((content) => {
        if (cancelled) return;
        if (content.isBinary) setSkillMdBinary(true);
        else setSkillMd(content.text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSkillMdError(getErrorMessage(err, "Couldn’t load SKILL.md"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const declaredServers = useMemo(
    () => (skillMd === null ? [] : parseFrontmatterServers(skillMd)),
    [skillMd],
  );

  /** serverName → resolved tool count (a chip with an entry here is registered + scanned). */
  const toolCountByServer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of boundTools) {
      counts.set(tool.serverName, (counts.get(tool.serverName) ?? 0) + 1);
    }
    return counts;
  }, [boundTools]);

  // ── Server-types WP 3.2 (A): the server-RESOLVED bindings (typeId/resolvedVia — WP 3.1) + the type
  // and server directories, so a TYPE-bound chip can name its type + lifecycle status + resolved
  // representative. Read-only, additive to the local frontmatter parse; a fetch failure degrades every
  // chip to the plain server rendering (never a fake type). Re-runs when the viewed version changes
  // (e.g. after a bind/unbind saves a new version).
  const [resolvedBindings, setResolvedBindings] = useState<SkillServerBinding[]>([]);
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [serverDirectory, setServerDirectory] = useState<ServerConfig[]>([]);
  useEffect(() => {
    if (!skillId || !versionId) return;
    let cancelled = false;
    Promise.all([
      fetchSkillBindings(skillId),
      listServerTypes(),
      apiGet<ServerConfig[]>("/api/servers"),
    ])
      .then(([bindingsList, typesList, serversList]) => {
        if (cancelled) return;
        setResolvedBindings(bindingsList);
        setServerTypes(typesList);
        setServerDirectory(serversList);
      })
      .catch(() => {
        // Honest degradation: no type metadata → plain server chips (never a guessed/fake type).
        if (cancelled) return;
        setResolvedBindings([]);
        setServerTypes([]);
        setServerDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const chips = useMemo(
    () =>
      buildBindingChips(
        declaredServers,
        resolvedBindings,
        serverTypes,
        serverDirectory,
        toolCountByServer,
      ),
    [declaredServers, resolvedBindings, serverTypes, serverDirectory, toolCountByServer],
  );

  // ── WP 7.3a: bind/unbind through the content-canonical save (head-guarded, dirty-guarded) ───────
  const [bindOpen, setBindOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<string | null>(null);
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const busyRef = useRef(false);

  const directory = useServerDirectory(bindOpen);
  const candidates = useMemo(
    () => deriveBindCandidates(directory.servers, directory.scans, declaredServers),
    [directory.servers, directory.scans, declaredServers],
  );
  // Server-types WP 3.2 (B): the "Types" section of the picker. The dialog's directory supplies
  // servers (with `typeId`) + scans for D-ST3 representative resolution; `serverTypes` is loaded above.
  const typeCandidates = useMemo(
    () =>
      deriveBindTypeCandidates(serverTypes, directory.servers, directory.scans, declaredServers),
    [serverTypes, directory.servers, directory.scans, declaredServers],
  );

  const canManageBindings = binding !== null && editMode;
  const blockedReason = !binding
    ? "Server binding isn’t available in this view."
    : binding.editorDirty
      ? "Save or discard your unsaved editor changes first — binding saves a new version of the saved SKILL.md."
      : skillMdBinary
        ? "SKILL.md is binary — its frontmatter can’t be edited."
        : skillMdError
          ? `SKILL.md couldn’t be loaded: ${skillMdError}`
          : null;

  /** Run one binding edit end-to-end: fresh reads → mutate frontmatter → save-draft → hand over. */
  async function applyBindingEdit(
    busyKey: string,
    mutate: (text: string) => string,
    note: string,
    successTitle: string,
  ): Promise<boolean> {
    if (!binding || busyRef.current) return false;
    busyRef.current = true;
    setBusyServer(busyKey);
    try {
      // Fresh reads at action time: the head must still be the viewed version (the save would 409
      // anyway — this just gives the clearer message), and the text must be current.
      const [skill, file] = await Promise.all([
        getSkill(binding.skillId),
        getSkillFile(binding.skillId, binding.versionId, "SKILL.md"),
      ]);
      if (skill.currentVersionId !== binding.versionId) {
        notifyError("Not the latest version", {
          description: "Bindings are edited on the latest version — switch to it and try again.",
        });
        return false;
      }
      if (file.isBinary) {
        notifyError("SKILL.md is binary", { description: "Its frontmatter can’t be edited." });
        return false;
      }
      const next = mutate(file.text);
      if (next === file.text) {
        toast.info("No change", { description: "The servers: list is already in that state." });
        setSkillMd(file.text);
        return true;
      }
      const response = await apiPost<SkillEditsResponse>(
        `/api/skills/${binding.skillId}/save-draft`,
        { baseVersionId: binding.versionId, content: next, treeOps: [], intentLog: [], note },
      );
      if ("unchanged" in response) {
        toast.info("No change", { description: "The edit left SKILL.md identical." });
        return true;
      }
      setSkillMd(next); // chips reflect the edit immediately, before the inspector switches versions
      toast.success(successTitle, {
        description: `Saved as v${response.version.seq} — the frontmatter servers: list was updated.`,
      });
      binding.onVersionSaved?.(response.version.id);
      return true;
    } catch (err) {
      notifyError("Couldn’t update the binding", {
        description: getErrorMessage(
          err,
          "The save was rejected — reload the skill and try again.",
        ),
      });
      return false;
    } finally {
      busyRef.current = false;
      setBusyServer(null);
    }
  }

  const handleBind = async (candidate: BindCandidate) => {
    const ok = await applyBindingEdit(
      candidate.serverId,
      (text) => addFrontmatterServer(text, candidate.serverName),
      `Bind server "${candidate.serverName}"`,
      "Server bound",
    );
    if (ok) setBindOpen(false);
  };

  // Server-types WP 3.2 (B): binding a TYPE writes the TYPE NAME into `servers:` (same save path as a
  // server) — the API resolver (WP 3.1) maps it to the type's representative member at read time. The
  // busy key is the typeId (distinct from any serverId), so one `busyServer` state drives both sections.
  const handleBindType = async (candidate: BindTypeCandidate) => {
    const ok = await applyBindingEdit(
      candidate.typeId,
      (text) => addFrontmatterServer(text, candidate.typeName),
      `Bind server type "${candidate.typeName}"`,
      "Server type bound",
    );
    if (ok) setBindOpen(false);
  };

  const handleUnbind = async (serverName: string) => {
    const ok = await applyBindingEdit(
      serverName,
      (text) => removeFrontmatterServer(text, serverName),
      `Unbind server "${serverName}"`,
      "Server unbound",
    );
    if (ok) setUnbindTarget(null);
  };

  const referenced = useMemo(() => referencedToolNames(graph), [graph]);

  // Footprint = Σ definition tokens of tools that are BOTH referenced (a tool_ref node) AND resolved
  // (a bound tool). Each bound tool is already unique per (server, tool) from its scan, so a tool
  // referenced from several sections is still counted once.
  const { footprintTokens, referencedResolvedCount } = useMemo(() => {
    let tokens = 0;
    let count = 0;
    for (const tool of boundTools) {
      if (referenced.has(tool.toolName)) {
        tokens += tool.definitionTokens;
        count += 1;
      }
    }
    return { footprintTokens: tokens, referencedResolvedCount: count };
  }, [boundTools, referenced]);

  const groups = useMemo<ServerGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    const byServer = new Map<string, BoundTool[]>();
    for (const tool of boundTools) {
      if (
        needle &&
        !tool.toolName.toLowerCase().includes(needle) &&
        !(tool.description ?? "").toLowerCase().includes(needle)
      ) {
        continue;
      }
      const list = byServer.get(tool.serverName) ?? [];
      list.push(tool);
      byServer.set(tool.serverName, list);
    }
    return [...byServer.entries()]
      .map(([serverName, tools]) => ({
        serverName,
        tools: [...tools].sort((a, b) => a.toolName.localeCompare(b.toolName)),
      }))
      .sort((a, b) => a.serverName.localeCompare(b.serverName));
  }, [boundTools, query]);

  const matchCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.tools.length, 0),
    [groups],
  );

  const bindAction = canManageBindings ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">
          <Button
            variant="outline"
            size="sm"
            disabled={blockedReason !== null || busyServer !== null}
            onClick={() => setBindOpen(true)}
          >
            <Link2 aria-hidden />
            <span>Bind server…</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {blockedReason ??
          "Pick a registered server — its name is written to the servers: frontmatter."}
      </TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <div
      className={`flex flex-col gap-3 overflow-hidden bg-card p-3 ${
        onCollapse ? "h-full w-full min-w-0" : "w-72 shrink-0 border-r border-border"
      }`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Heading level={4}>Tools</Heading>
          </div>
          {onCollapse ? (
            <IconButton
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              label="Collapse the Tools panel"
              onClick={onCollapse}
            >
              <PanelLeftClose aria-hidden />
            </IconButton>
          ) : null}
        </div>
        <Text variant="meta" tone="muted">
          Tools from the servers this skill is bound to, with their definition token cost.
          Scan-derived — never a live call.
        </Text>
      </div>

      {/* WP 7.3a + server-types WP 3.2 — the binding surface: declared bindings (server OR type chips)
          + the Bind server… action. A type chip names its type, lifecycle status, and the resolved
          representative member (or an honest "no representative yet" state). */}
      {binding ? (
        <div className="flex flex-col gap-1.5">
          <Text variant="caption" tone="muted" className="font-medium">
            Bound servers &amp; types
          </Text>
          {skillMd === null && !skillMdBinary && !skillMdError ? (
            <Text variant="meta" tone="muted">
              Loading…
            </Text>
          ) : chips.length === 0 ? (
            <Text variant="meta" tone="muted">
              None yet — the frontmatter `servers:` list is empty.
            </Text>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {chips.map((chip) =>
                chip.kind === "type" ? (
                  <TypeChip
                    key={chip.name}
                    chip={chip}
                    canUnbind={canManageBindings && blockedReason === null && busyServer === null}
                    onUnbind={() => setUnbindTarget(chip.name)}
                  />
                ) : (
                  <ServerChip
                    key={chip.name}
                    name={chip.name}
                    toolCount={chip.toolCount}
                    canUnbind={canManageBindings && blockedReason === null && busyServer === null}
                    onUnbind={() => setUnbindTarget(chip.name)}
                  />
                ),
              )}
            </ul>
          )}
          {bindAction ? <div className="flex">{bindAction}</div> : null}
        </div>
      ) : null}

      {/* Footprint readout — the referenced ∩ resolved token sum, labeled as scan-derived. */}
      <div className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/40 px-3 py-2">
        <Text variant="meta" tone="muted">
          Referenced tool-surface footprint
        </Text>
        <div className="flex items-baseline gap-1.5">
          <Text className="font-semibold tabular-nums" as="span">
            {footprintTokens.toLocaleString()}
          </Text>
          <Text variant="meta" tone="muted" as="span">
            tokens
          </Text>
        </div>
        <Text variant="meta" tone="muted">
          {referencedResolvedCount} referenced {referencedResolvedCount === 1 ? "tool" : "tools"}{" "}
          across the bound servers · scan-derived
        </Text>
      </div>

      {loading ? (
        <StatePanel
          kind="loading"
          title="Loading tools…"
          loadingLabel="Reading bound scans…"
          size="sm"
        />
      ) : boundTools.length === 0 ? (
        declaredServers.length === 0 ? (
          <StatePanel
            kind="empty"
            size="sm"
            title="Not bound to a server"
            description="Bind a registered MCP server to browse its tools here."
            actions={
              canManageBindings && blockedReason === null ? (
                <Button variant="outline" size="sm" onClick={() => setBindOpen(true)}>
                  <Link2 aria-hidden />
                  <span>Bind server…</span>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <StatePanel
            kind="empty"
            size="sm"
            title="No tools from the bound servers"
            description="The bound servers have no completed discovery scan (or no registered server matches their names). Tools appear after a scan — run one from the server's page."
          />
        )
      ) : (
        <>
          <SearchInput
            value={query}
            onValueChange={setQuery}
            label="Filter tools"
            placeholder="Filter tools…"
          />
          {matchCount === 0 ? (
            <StatePanel
              kind="empty"
              size="sm"
              title="No matching tools"
              description={`No bound tool matches “${query.trim()}”.`}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pe-1">
              {groups.map((group) => (
                <div key={group.serverName} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Server className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <Text variant="caption" tone="muted" className="truncate font-medium">
                      {group.serverName}
                    </Text>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {group.tools.map((tool) => (
                      <ToolRow
                        key={`${group.serverName}/${tool.toolName}`}
                        tool={tool}
                        referenced={referenced.has(tool.toolName)}
                        editMode={editMode}
                        canInsert={canInsert}
                        onInsertTool={onInsertTool}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <BindServerDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        loading={directory.loading}
        error={directory.error}
        candidates={candidates}
        typeCandidates={typeCandidates}
        blockedReason={blockedReason}
        busyKey={busyServer}
        onBind={(candidate) => void handleBind(candidate)}
        onBindType={(candidate) => void handleBindType(candidate)}
      />

      <ConfirmDialog
        open={unbindTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyServer === null) setUnbindTarget(null);
        }}
        title="Unbind server"
        description={
          unbindTarget !== null
            ? `Removes “${unbindTarget}” from the servers: list in SKILL.md frontmatter and saves a new immutable version. Tool references into this server will report as unknown until it's bound again.`
            : undefined
        }
        confirmLabel="Unbind & save"
        busy={busyServer !== null}
        onConfirm={() => {
          if (unbindTarget !== null) void handleUnbind(unbindTarget);
        }}
      />
    </div>
  );
}

/** One bound-server chip: the declared frontmatter name, its resolved tool count (or an honest
 *  "no tools yet" marker), and — when binding management is available — the unbind ×. */
function ServerChip({
  name,
  toolCount,
  canUnbind,
  onUnbind,
}: {
  name: string;
  /** Resolved tool count from the bound-tools read; null ⇒ unscanned or not a registered name. */
  toolCount: number | null;
  canUnbind: boolean;
  onUnbind: () => void;
}) {
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">
            <Badge variant="outline" className="max-w-full gap-1 pe-0.5">
              <Server className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate font-mono text-[11px]" title={name}>
                {name}
              </span>
              {toolCount === null ? (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {toolCount}
                </span>
              )}
              {canUnbind ? (
                <IconButton
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  label={`Unbind server ${name}`}
                  onClick={onUnbind}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {toolCount === null
            ? "No tools yet — the server has no completed scan, or no registered server matches this name."
            : `${toolCount} ${toolCount === 1 ? "tool" : "tools"} from the latest completed scan.`}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Server-types WP 3.2 (A) — one TYPE-bound chip: the declared type name (with a `Tags` glyph), the
 *  type's lifecycle status, and the resolved representative member — or an honest "no representative
 *  yet" state when no member has a completed scan. The representative is chosen by the API resolver
 *  (D-ST3); this chip only reports it, never guesses. Unbind removes the type name from `servers:`. */
function TypeChip({
  chip,
  canUnbind,
  onUnbind,
}: {
  chip: Extract<BindingChip, { kind: "type" }>;
  canUnbind: boolean;
  onUnbind: () => void;
}) {
  const label = chip.typeName ?? chip.name;
  const hasRep = chip.representativeId !== null;
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">
            <Badge variant="outline" className="max-w-full gap-1 pe-0.5">
              <Tags className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <Text as="span" variant="meta" className="min-w-0 truncate font-mono" title={label}>
                {label}
              </Text>
              <Text as="span" variant="meta" tone="muted" className="shrink-0">
                Type
              </Text>
              {chip.status ? <ServerTypeStatusBadge status={chip.status} /> : null}
              {hasRep && chip.toolCount !== null ? (
                <Text as="span" variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {chip.toolCount}
                </Text>
              ) : (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {canUnbind ? (
                <IconButton
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  label={`Unbind server type ${label}`}
                  onClick={onUnbind}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {hasRep
            ? `Server type — resolves to representative “${chip.representativeName ?? "a scanned member"}” (the member with the newest successful scan).${
                chip.toolCount !== null
                  ? ` ${chip.toolCount} ${chip.toolCount === 1 ? "tool" : "tools"} from its latest completed scan.`
                  : ""
              }`
            : "Server type — no representative yet: no member has a completed scan. Tools appear once a member is scanned."}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** One tool row: name + definition cost, an "In skill" badge when already referenced, and — in edit
 *  mode — a drag handle (drag onto a section node → `add_tool_ref`) plus an insert-at-cursor button. */
function ToolRow({
  tool,
  referenced,
  editMode,
  canInsert,
  onInsertTool,
}: {
  tool: BoundTool;
  referenced: boolean;
  editMode: boolean;
  canInsert: boolean;
  onInsertTool: (toolName: string) => void;
}) {
  const handleDragStart = (event: React.DragEvent<HTMLLIElement>) => {
    const payload: ToolDragPayload = { server: tool.serverName, tool: tool.toolName };
    event.dataTransfer.setData(TOOL_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <li draggable={editMode} onDragStart={editMode ? handleDragStart : undefined}>
      <Card
        className={`flex min-w-0 items-start gap-1.5 px-2 py-1.5 ${
          editMode ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        {editMode ? (
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 truncate font-mono text-xs" title={tool.toolName}>
            {tool.toolName}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <Text variant="meta" tone="muted" as="span" className="tabular-nums">
              {tool.definitionTokens.toLocaleString()} tok
            </Text>
            {referenced ? (
              <Badge variant="secondary" className="px-1 py-0 text-[10px] leading-4">
                In skill
              </Badge>
            ) : null}
          </div>
        </div>
        {editMode ? (
          <IconButton
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={!canInsert}
            disabledReason="Select a section in edit mode to insert a reference"
            label={`Insert a reference to ${tool.toolName} at the cursor`}
            onClick={() => onInsertTool(tool.toolName)}
          >
            <Plus aria-hidden />
          </IconButton>
        ) : null}
      </Card>
    </li>
  );
}
