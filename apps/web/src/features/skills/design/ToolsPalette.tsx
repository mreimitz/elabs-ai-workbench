import { useMemo, useState } from "react";
import type { BoundTool, SkillGraph } from "@mcp-token-footprint/shared";
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
} from "@elabs-ai/components-ui";
import { IconButton } from "../../../components/IconButton";
import { SearchInput } from "@elabs-ai/components-data";
import { GripVertical, Link2, PanelLeftClose, Plus, Server, Wrench } from "lucide-react";
import { useOptionalStudioDraft } from "../studio/draft";

// Skill IDE WP 8.3 (I9.3) — the visual half of the tools surface. Per-server groups of the bound
// servers' tools (from the WP 8.2 `bound-tools` read — persisted scans only, never a live MCP call),
// filterable, each row showing the tool's DEFINITION token cost. The header sums the tool-surface
// footprint: Σ definition tokens of tools currently REFERENCED (a `tool_ref` node in the graph) AND
// RESOLVED (a bound tool). Two edit-mode affordances put a tool into the skill WITHOUT mutating
// anything until Save (I2): insert-at-cursor (a backticked reference into the active section-body
// editor, staged as `update_section_body` when applied) and drag-onto-a-section-node (staged as
// `add_tool_ref`). Everything here is read-only over scan data; the palette never opens a connection.
//
// Skill Studio WP 7.3a put the skill↔server BINDING surface in here too (chips + a "Bind server…"
// picker), because the Design tab was where an author already was. RM-30 WP 7.3 moved it into the
// Studio's ONE settings panel per SI3 ("all frontmatter concepts in one panel") and — the part that
// mattered — off the immediate-save path deviation D-UX18 flagged: a bind now stages on the shared
// draft and lands with everything else on one "Save as vN". What is left here is a READ of the
// draft's declared servers, so the empty state can tell "not bound to anything" apart from "bound,
// but nothing scanned" and deep-link the first case to Settings.

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
  /**
   * RM-30 WP 7.1 — fill the host's width instead of pinning the classic `w-72` column, WITHOUT
   * asking for a collapse chevron. Until now the two travelled together on `onCollapse`, which is
   * wrong for a host that owns the collapse control itself: the Skill Studio's left rail has its own
   * header chevron, and a second one inside the palette would be the same affordance twice — but a
   * palette that keeps pinning 288px inside a 184px rail clips its own text.
   *
   * Defaults to "fluid when a collapse handler is supplied", so every existing call site is
   * unchanged.
   */
  fluid?: boolean;
  /** RM-30 WP 7.3 — open the host's server-binding surface (the Studio rail's Settings tab). It is
   *  the "not bound to a server" empty state's only action. Omitted ⇒ that state offers none. */
  onOpenServerSettings?: () => void;
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
  fluid,
  onOpenServerSettings,
}: ToolsPaletteProps) {
  const [query, setQuery] = useState("");

  // ── RM-30 WP 7.3 — the palette is about TOOLS again ──────────────────────────────────────────
  // WP 7.3a put the whole skill-server binding surface in here (chips + a picker + unbind), because
  // the Design tab was where an author already was. SI3 says all frontmatter is edited in ONE
  // settings panel, and WP 7.3 built it — so the surface moved there, where it writes to the shared
  // draft instead of saving a new version on the spot. What is left here is the read: which servers
  // the LIVE draft declares, so the empty state can tell the two "no tools" cases apart.
  const studioDraft = useOptionalStudioDraft();
  const declaredServers = studioDraft?.settings.servers ?? [];

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

  return (
    <div
      className={`flex flex-col gap-3 overflow-hidden bg-card p-3 ${
        (fluid ?? onCollapse !== undefined)
          ? "h-full w-full min-w-0"
          : "w-72 shrink-0 border-r border-border"
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
              // RM-30 WP 7.3 — the action is a DEEP LINK to the rail's Settings tab, where binding
              // now lives, rather than a second picker inside the palette. The host wires it; with
              // no host (a bare mount, a test) the state is honest and simply offers nothing.
              onOpenServerSettings ? (
                <Button variant="outline" size="sm" onClick={onOpenServerSettings}>
                  <Link2 aria-hidden />
                  <span>Bind a server in Settings →</span>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <StatePanel
            kind="empty"
            size="sm"
            title="No tools from the bound servers"
            description="The bound servers have no completed discovery scan (or no registered server matches their names). Tools appear after a scan — run one from Settings, or from the server's page."
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
    </div>
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
