import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from "react";
import type { BoundTool, SkillGraph } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Heading,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import {
  Blocks,
  ChevronRight,
  CircleDashed,
  GripVertical,
  Hash,
  PanelLeftClose,
  Plus,
  Server,
  Settings2,
  Tags,
  Terminal,
  X,
} from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { ConfirmDialog } from "../../../components/dialogs";
import { useOptionalStudioDraft } from "../studio/draft";
import { BindServerDialog } from "./BindServerDialog";
import type { BindCandidate, BindTypeCandidate } from "./bind-server-candidates";
import type { BindingChip } from "./binding-display";
import { explainerFor } from "./code-intel/explainers";
import { NODE_KIND_META } from "./node-kind-meta";
import {
  COMPONENT_DRAG_MIME,
  isSkillComponentId,
  SKILL_COMPONENTS,
  TOOL_DRAG_MIME,
  type ComponentDragPayload,
  type SkillComponentId,
  type SkillComponentSpec,
  type ToolDragPayload,
} from "./skill-components";
import { isSectionNode } from "./use-edit-ops";
import { useSkillServerBinding } from "./use-server-binding";

// ── RM-30 WP 7.7 (SI12/SI17, D-UX19#3) — the components palette ───────────────────────────────────
// This replaces the Tools palette. D-UX19 corrected the authoring model to "creation is
// drag-from-palette", and this is that palette, in two sections:
//
//   1. COMPONENTS — the nine authorable skill components. Each row is draggable onto the canvas AND
//      carries an explicit "Add" button, because a palette you can only use with a mouse is not a
//      palette. Both routes call the SAME pure `resolveComponentPlacement`, so the keyboard path can
//      never mean something different from the drag path. Every row shows the teaching line from the
//      explainer registry — the same copy the canvas Legend popover carried before this WP deleted
//      its toolbar button, so the vocabulary moved rather than disappeared.
//
//   2. MCP SERVERS — a collapsible section that ABSORBS the bind chips: bind from the section
//      header, unbind from a per-server control that appears on hover/focus, and each server's tools
//      listed beneath it, draggable onto a section node exactly as before.
//
// Binding here stages on the ONE Studio draft (WP 7.3's store) — it never saves. That is deliberate:
// WP 7.3a's bind used to POST a new version on the spot (deviation D-UX18) and WP 7.3 closed it; a
// second surface that reopened it would be a regression, not a feature. The read behind both this
// section and the Settings panel is one shared hook (`use-server-binding.ts`), so the two cannot
// disagree about what is bound.

export { TOOL_DRAG_MIME, type ToolDragPayload };

export type ComponentsPaletteProps = {
  skillId: string;
  versionId: string;
  /** The AUTHORITATIVE graph — its `tool_ref` nodes define the "referenced" set for the footprint,
   *  and its nodes are what a keyboard placement resolves the current selection against. */
  graph: SkillGraph;
  /** The bound servers' tools (WP 8.2 read). `[]` ⇒ unbound (or no completed scan). */
  boundTools: BoundTool[];
  /** True while the bound-tools fetch is in flight (first load). */
  loading: boolean;
  /** Edit mode: enables drag, the Add buttons and binding. Off ⇒ the palette is a read-only
   *  inventory (still shows costs + the footprint readout). */
  editMode: boolean;
  /** True when a section-body editor is mounted (edit mode + a section selected) — gates
   *  insert-at-cursor. */
  canInsert: boolean;
  /** Insert a backticked reference to `toolName` at the active body editor's cursor (edit mode). */
  onInsertTool: (toolName: string) => void;
  /**
   * Place a component. `targetNodeId` is the canvas selection — the keyboard equivalent of the node
   * a drag would have been dropped on. The host resolves it through `resolveComponentPlacement`,
   * opens a picker when the component needs a value, and stages the ops; the palette itself never
   * touches the edit buffer.
   */
  onPlaceComponent: (component: SkillComponentId, targetNodeId: string | null) => void;
  /** The currently selected canvas node — the keyboard placement target. */
  selectedNodeId?: string | undefined;
  /** SI16 — when set, the header shows a collapse chevron and the palette fills its host panel. */
  onCollapse?: () => void;
  /** RM-30 WP 7.1 — fill the host's width without asking for a collapse chevron (the Studio rail
   *  owns its own). Defaults to "fluid when a collapse handler is supplied". */
  fluid?: boolean;
  /** Open the host's skill-settings surface (the Studio rail's Settings tab) — where a staged
   *  keyword or command is renamed. Omitted ⇒ the header shows no settings shortcut. */
  onOpenServerSettings?: () => void;
};

/** The tool names referenced by a `tool_ref` node anywhere in the graph (projected from SKILL.md). */
function referencedToolNames(graph: SkillGraph): Set<string> {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "tool_ref") names.add(node.toolName);
  }
  return names;
}

/** The glyph for a component row. Node-kind components reuse the canvas's own icon so the palette
 *  row and the node on the canvas are visibly the same thing; the two trigger kinds get their own. */
function componentGlyph(spec: SkillComponentSpec): ReactNode {
  switch (spec.id) {
    case "keyword":
      return <Hash />;
    case "command":
      return <Terminal />;
    case "section":
    case "subroutine":
      return NODE_KIND_META.subroutine.icon;
    case "gatekeeper":
      return NODE_KIND_META.gatekeeper.icon;
    case "validation_gate":
      return NODE_KIND_META.validation_gate.icon;
    case "loop_guard":
      return NODE_KIND_META.loop_guard.icon;
    case "tool_reference":
      return NODE_KIND_META.tool_ref.icon;
    case "asset":
      return NODE_KIND_META.asset.icon;
  }
}

/** The explainer's teaching line with markdown code ticks stripped — the registry is written for a
 *  Monaco hover (markdown); a palette row renders plain text. */
function teachingLine(explainerId: string): string {
  return (explainerFor(explainerId)?.short ?? "").replace(/`/g, "");
}

export function ComponentsPalette({
  skillId,
  versionId,
  graph,
  boundTools,
  loading,
  editMode,
  canInsert,
  onInsertTool,
  onPlaceComponent,
  selectedNodeId,
  onCollapse,
  fluid,
  onOpenServerSettings,
}: ComponentsPaletteProps) {
  const [query, setQuery] = useState("");
  const [serversOpen, setServersOpen] = useState(true);

  const studioDraft = useOptionalStudioDraft();
  const declaredServers = useMemo(
    () => studioDraft?.settings.servers ?? [],
    [studioDraft?.settings.servers],
  );

  const referenced = useMemo(() => referencedToolNames(graph), [graph]);

  // The section a keyboard placement would attach to — the SAME `isSectionNode` rule the placement
  // resolver applies, read once so every row's tooltip can name the target instead of guessing.
  const selectedSection = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId);
    return node && isSectionNode(node) ? node : null;
  }, [graph, selectedNodeId]);

  // Footprint = Σ definition tokens of tools that are BOTH referenced (a tool_ref node) AND resolved
  // (a bound tool). Each bound tool is unique per (server, tool) from its scan, so a tool referenced
  // from several sections is still counted once.
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

  const needle = query.trim().toLowerCase();
  const toolsByServer = useMemo(() => {
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
    for (const list of byServer.values()) list.sort((a, b) => a.toolName.localeCompare(b.toolName));
    return byServer;
  }, [boundTools, needle]);

  const matchCount = useMemo(
    () => [...toolsByServer.values()].reduce((sum, list) => sum + list.length, 0),
    [toolsByServer],
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 overflow-hidden bg-card p-3",
        (fluid ?? onCollapse !== undefined)
          ? "h-full w-full min-w-0"
          : "w-72 shrink-0 border-r border-border",
      )}
      data-testid="components-palette"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Blocks className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Heading level={4}>Components</Heading>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {onOpenServerSettings ? (
              <IconButton
                variant="ghost"
                size="icon"
                className="size-7"
                label="Open skill settings"
                onClick={onOpenServerSettings}
              >
                <Settings2 aria-hidden />
              </IconButton>
            ) : null}
            {onCollapse ? (
              <IconButton
                variant="ghost"
                size="icon"
                className="size-7"
                label="Collapse the Components panel"
                onClick={onCollapse}
              >
                <PanelLeftClose aria-hidden />
              </IconButton>
            ) : null}
          </div>
        </div>
        <Text variant="meta" tone="muted">
          Drag a component onto the flow — or select a node and use its ＋. Nothing changes until you
          save.
        </Text>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pe-1">
        <section className="flex flex-col gap-1.5" aria-label="Skill components">
          <ul className="flex flex-col gap-1.5">
            {SKILL_COMPONENTS.map((spec) => (
              <ComponentRow
                key={spec.id}
                spec={spec}
                editMode={editMode}
                selectedSectionLabel={selectedSection?.label ?? null}
                onPlace={() => onPlaceComponent(spec.id, selectedNodeId ?? null)}
              />
            ))}
          </ul>
        </section>

        <McpServersSection
          skillId={skillId}
          versionId={versionId}
          declaredServers={declaredServers}
          open={serversOpen}
          onOpenChange={setServersOpen}
          editMode={editMode}
          canBind={editMode && studioDraft !== null}
          onBind={(name) =>
            studioDraft?.stageSettingsEdit({ field: "servers", action: "bind", name })
          }
          onUnbind={(name) =>
            studioDraft?.stageSettingsEdit({ field: "servers", action: "unbind", name })
          }
          toolsByServer={toolsByServer}
          loading={loading}
          totalToolCount={boundTools.length}
          matchCount={matchCount}
          query={query}
          onQueryChange={setQuery}
          referenced={referenced}
          canInsert={canInsert}
          onInsertTool={onInsertTool}
          footprintTokens={footprintTokens}
          referencedResolvedCount={referencedResolvedCount}
        />
      </div>
    </div>
  );
}

/** One component row: the glyph, the label, the registry's teaching line, and the two placement
 *  affordances — an HTML5 drag (mouse) and an explicit Add button (keyboard). */
function ComponentRow({
  spec,
  editMode,
  selectedSectionLabel,
  onPlace,
}: {
  spec: SkillComponentSpec;
  editMode: boolean;
  selectedSectionLabel: string | null;
  onPlace: () => void;
}) {
  const handleDragStart = (event: DragEvent<HTMLLIElement>) => {
    const payload: ComponentDragPayload = { component: spec.id };
    event.dataTransfer.setData(COMPONENT_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  // The Add button is never disabled: the ONE rule that decides whether a placement is legal lives in
  // `resolveComponentPlacement`, and a second copy here — deciding what to grey out — is exactly how
  // the two would drift. What the label does instead is say, truthfully, what pressing it will do.
  const addLabel =
    spec.target === "document"
      ? `Add a ${spec.label} to the skill`
      : selectedSectionLabel !== null
        ? `Add a ${spec.label} to “${selectedSectionLabel}”`
        : `Add a ${spec.label} — select a section on the flow first`;

  const teaching = teachingLine(spec.explainerId);

  return (
    <li draggable={editMode} onDragStart={editMode ? handleDragStart : undefined}>
      <Card
        className={cn(
          "flex min-w-0 items-start gap-1.5 px-2 py-1.5",
          editMode && "cursor-grab active:cursor-grabbing",
        )}
      >
        {editMode ? (
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <span
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5"
          aria-hidden
        >
          {componentGlyph(spec)}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
              <Text as="span" variant="caption" className="min-w-0 truncate font-medium">
                {spec.label}
              </Text>
              <Text variant="meta" tone="muted" className="line-clamp-2 text-pretty">
                {teaching}
              </Text>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{teaching}</TooltipContent>
        </Tooltip>
        {editMode ? (
          <IconButton
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            label={addLabel}
            onClick={onPlace}
          >
            <Plus aria-hidden />
          </IconButton>
        ) : null}
      </Card>
    </li>
  );
}

type McpServersSectionProps = {
  skillId: string;
  versionId: string;
  declaredServers: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editMode: boolean;
  canBind: boolean;
  onBind: (name: string) => void;
  onUnbind: (name: string) => void;
  toolsByServer: Map<string, BoundTool[]>;
  loading: boolean;
  totalToolCount: number;
  matchCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  referenced: Set<string>;
  canInsert: boolean;
  onInsertTool: (toolName: string) => void;
  footprintTokens: number;
  referencedResolvedCount: number;
};

/** Section 2 — the bound MCP servers, each with its tools beneath. This is where WP 7.3a's bind
 *  chips ended up: bind from the header ＋, unbind from the per-server × that appears on hover or
 *  keyboard focus, and drag any tool onto a section node to reference it. */
function McpServersSection({
  skillId,
  versionId,
  declaredServers,
  open,
  onOpenChange,
  editMode,
  canBind,
  onBind,
  onUnbind,
  toolsByServer,
  loading,
  totalToolCount,
  matchCount,
  query,
  onQueryChange,
  referenced,
  canInsert,
  onInsertTool,
  footprintTokens,
  referencedResolvedCount,
}: McpServersSectionProps) {
  const [bindOpen, setBindOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<string | null>(null);

  const binding = useSkillServerBinding(skillId, versionId, declaredServers, bindOpen || open);

  const handleBind = useCallback(
    (candidate: BindCandidate) => {
      onBind(candidate.serverName);
      setBindOpen(false);
    },
    [onBind],
  );
  // Binding a TYPE writes the TYPE NAME into `servers:`; the API resolver maps it to the type's
  // representative member at read time (D-ST3). Same staged edit, different name.
  const handleBindType = useCallback(
    (candidate: BindTypeCandidate) => {
      onBind(candidate.typeName);
      setBindOpen(false);
    },
    [onBind],
  );

  // Every server group the bound tools landed in that no declared chip covers — rendered rather than
  // silently dropped, so a tool can never disappear because the chip model didn't expect its server.
  const chipServerNames = useMemo(() => {
    const names = new Set<string>();
    for (const chip of binding.chips) {
      names.add(chip.kind === "type" ? (chip.representativeName ?? chip.name) : chip.name);
    }
    return names;
  }, [binding.chips]);
  const orphanGroups = useMemo(
    () => [...toolsByServer.keys()].filter((name) => !chipServerNames.has(name)).sort(),
    [toolsByServer, chipServerNames],
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-0.5">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-1.5 px-1"
            data-testid="mcp-servers-toggle"
          >
            <ChevronRight
              className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
              aria-hidden
            />
            <Server className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">MCP Servers</span>
            <Badge variant="secondary" className="shrink-0 px-1 py-0">
              <Text as="span" variant="meta">
                {declaredServers.length}
              </Text>
            </Badge>
          </Button>
        </CollapsibleTrigger>
        {editMode ? (
          <IconButton
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            label="Bind a server…"
            disabled={!canBind}
            disabledReason="Open this skill in the Studio to bind a server."
            onClick={() => setBindOpen(true)}
            data-testid="palette-bind-server"
          >
            <Plus aria-hidden />
          </IconButton>
        ) : null}
      </div>

      <CollapsibleContent className="flex flex-col gap-2">
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
        ) : declaredServers.length === 0 ? (
          <StatePanel
            kind="empty"
            size="sm"
            title="Not bound to a server"
            description="Bind a registered MCP server to browse and reference its tools."
            actions={
              editMode ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canBind}
                  onClick={() => setBindOpen(true)}
                >
                  <Plus aria-hidden />
                  <span>Bind server…</span>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {totalToolCount > 0 ? (
              <SearchInput
                value={query}
                onValueChange={onQueryChange}
                label="Filter tools"
                placeholder="Filter tools…"
              />
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {binding.chips.map((chip) => (
                <ServerGroup
                  key={chip.name}
                  chip={chip}
                  tools={toolsByServer.get(serverGroupKey(chip)) ?? []}
                  editMode={editMode}
                  canUnbind={canBind}
                  onUnbind={() => setUnbindTarget(chip.name)}
                  referenced={referenced}
                  canInsert={canInsert}
                  onInsertTool={onInsertTool}
                  filtering={query.trim().length > 0}
                />
              ))}
              {orphanGroups.map((name) => (
                <ServerGroup
                  key={`orphan:${name}`}
                  chip={{ kind: "server", name, toolCount: toolsByServer.get(name)?.length ?? 0 }}
                  tools={toolsByServer.get(name) ?? []}
                  editMode={editMode}
                  canUnbind={false}
                  onUnbind={() => undefined}
                  referenced={referenced}
                  canInsert={canInsert}
                  onInsertTool={onInsertTool}
                  filtering={query.trim().length > 0}
                />
              ))}
            </ul>
            {totalToolCount === 0 ? (
              <Text variant="meta" tone="muted" className="text-pretty">
                No tools yet — the bound servers have no completed discovery scan (or no registered
                server matches their names). Bind again from ＋ to run one.
              </Text>
            ) : matchCount === 0 ? (
              <Text variant="meta" tone="muted">
                No bound tool matches “{query.trim()}”.
              </Text>
            ) : null}
          </>
        )}
      </CollapsibleContent>

      <BindServerDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        loading={binding.directoryLoading}
        error={binding.directoryError}
        candidates={binding.candidates}
        typeCandidates={binding.typeCandidates}
        blockedReason={canBind ? null : "Open this skill in the Studio to bind a server."}
        busyKey={null}
        onBind={handleBind}
        onBindType={handleBindType}
        onScan={binding.scan}
        scanningServerId={binding.scanningServerId}
      />

      <ConfirmDialog
        open={unbindTarget !== null}
        onOpenChange={(next) => {
          if (!next) setUnbindTarget(null);
        }}
        title={unbindTarget ? `Unbind “${unbindTarget}”?` : "Unbind"}
        description={
          unbindTarget
            ? `Removes “${unbindTarget}” from the draft’s servers: list. Tool references into this server will report as unknown until it is bound again. Nothing is saved until you save the draft.`
            : undefined
        }
        confirmLabel="Unbind"
        tone="destructive"
        onConfirm={() => {
          if (unbindTarget) onUnbind(unbindTarget);
          setUnbindTarget(null);
        }}
      />
    </Collapsible>
  );
}

/** Which bound-tools group a chip's tools land in — for a TYPE binding that is the resolved
 *  representative member's name, not the type name (the scan belongs to the member). */
function serverGroupKey(chip: BindingChip): string {
  return chip.kind === "type" ? (chip.representativeName ?? chip.name) : chip.name;
}

/** One bound server (or server type): a collapsible row with a hover/focus-revealed unbind, and its
 *  tools beneath. */
function ServerGroup({
  chip,
  tools,
  editMode,
  canUnbind,
  onUnbind,
  referenced,
  canInsert,
  onInsertTool,
  filtering,
}: {
  chip: BindingChip;
  tools: BoundTool[];
  editMode: boolean;
  canUnbind: boolean;
  onUnbind: () => void;
  referenced: Set<string>;
  canInsert: boolean;
  onInsertTool: (toolName: string) => void;
  /** True while a tool filter is active — an empty group then reads as "filtered out", not "no tools". */
  filtering: boolean;
}) {
  const [open, setOpen] = useState(true);
  const isType = chip.kind === "type";
  const label = isType ? (chip.typeName ?? chip.name) : chip.name;

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen} className="group/server flex flex-col">
        <div className="flex items-center gap-0.5">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-1.5 px-1">
              <ChevronRight
                className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
                aria-hidden
              />
              {isType ? (
                <Tags className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <Server className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <Text as="span" variant="code" className="min-w-0 truncate font-mono">
                {label}
              </Text>
              {chip.toolCount === null ? (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <Text
                  as="span"
                  variant="meta"
                  tone="muted"
                  className="shrink-0 tabular-nums font-normal"
                >
                  {chip.toolCount}
                </Text>
              )}
            </Button>
          </CollapsibleTrigger>
          {editMode ? (
            <IconButton
              variant="ghost"
              size="icon"
              className={cn(
                "size-6 shrink-0 opacity-0 transition-opacity",
                "group-hover/server:opacity-100 group-focus-within/server:opacity-100 focus-visible:opacity-100",
              )}
              label={isType ? `Unbind server type ${label}` : `Unbind server ${label}`}
              disabled={!canUnbind}
              disabledReason="Open this skill in the Studio to unbind a server."
              onClick={onUnbind}
            >
              <X aria-hidden />
            </IconButton>
          ) : null}
        </div>

        <CollapsibleContent>
          {tools.length === 0 ? (
            <Text variant="meta" tone="muted" className="ps-6 text-pretty">
              {filtering ? "No tool here matches the filter." : "No tools from the latest scan."}
            </Text>
          ) : (
            <ul className="flex flex-col gap-1.5 ps-4">
              {tools.map((tool) => (
                <ToolRow
                  key={`${tool.serverName}/${tool.toolName}`}
                  tool={tool}
                  referenced={referenced.has(tool.toolName)}
                  editMode={editMode}
                  canInsert={canInsert}
                  onInsertTool={onInsertTool}
                />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
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
  const handleDragStart = (event: DragEvent<HTMLLIElement>) => {
    const payload: ToolDragPayload = { server: tool.serverName, tool: tool.toolName };
    event.dataTransfer.setData(TOOL_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <li draggable={editMode} onDragStart={editMode ? handleDragStart : undefined}>
      <Card
        className={cn(
          "flex min-w-0 items-start gap-1.5 px-2 py-1.5",
          editMode && "cursor-grab active:cursor-grabbing",
        )}
      >
        {editMode ? (
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text as="span" variant="code" className="min-w-0 truncate font-mono" title={tool.toolName}>
            {tool.toolName}
          </Text>
          <div className="flex flex-wrap items-center gap-1">
            <Text variant="meta" tone="muted" as="span" className="tabular-nums">
              {tool.definitionTokens.toLocaleString()} tok
            </Text>
            {referenced ? (
              <Badge variant="secondary" className="px-1 py-0">
                <Text as="span" variant="meta">
                  In skill
                </Text>
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

/** Re-exported so a drop handler can validate an untrusted drag payload without importing the pure
 *  module twice. */
export { isSkillComponentId };
