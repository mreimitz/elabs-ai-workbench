import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  BoundTool,
  SkillDiff,
  SkillEditsResponse,
  SkillGraph,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatePanel,
  Text,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@elabs-ai/components-ui";
import type { Connection, Edge } from "@elabs-ai/components-flow";
import { CodeEditor, type CodeEditorProps } from "@elabs-ai/components-editor";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Columns2,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Terminal,
  Undo2,
  Workflow,
} from "lucide-react";
import { ApiError } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { READ_ONLY_OPTIONS } from "../../../lib/monaco";
import { AdaptivePanelGroup } from "../../../components/AdaptivePanelGroup";
import { IconButton } from "../../../components/IconButton";
import { DiscardChangesDialog } from "../../../components/UnsavedChangesGuard";
import { useBoundTools } from "../use-bound-tools";
import { getSkillFiles } from "../skills-inspector-api";
import { registerCodeIntel, type CodeIntelController } from "./code-intel";
import { findUnknownToolReferences, formatUnknownToolWarning } from "./code-intel/tool-references";
import "./code-intel/decorations.css";
import { CommandDialog } from "./CommandDialog";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import { ToolsPalette } from "./ToolsPalette";
import { layoutSkillLanes } from "./graph-layout";
import {
  buildFlow,
  ExplainerLegend,
  SkillGraphCanvas,
  type SkillCanvasNode,
} from "./SkillGraphCanvas";
import {
  applyPreviewOps,
  describeEditOp,
  isPreviewOnlyNodeId,
  isSectionNode,
} from "./use-edit-ops";
import { useSkillDraft } from "./use-skill-draft";
import { notifyError } from "../../../lib/notify";

// ── Skill IDE WP 9.2 (I10) — the unified editor shell: Flow | Code | Split ─────────────────────────
// "Show flow | Show code" as ONE surface, not two tabs. The WP 9.1 live draft (`useSkillDraft`) is the
// SINGLE canonical state — neither view owns it, so the two are ALWAYS in sync:
//   • Flow: canvas gestures compile to edit-ops → apply-preview → the draft text; the canvas renders the
//     draft's live projection (`draftGraph`) once the text has been touched directly, else a snappy
//     client-side op preview.
//   • Code: a full-document Monaco `CodeEditor` bound to `draft.content`; every keystroke writes back
//     through `draft.setContent`, which re-projects (debounced) — so the graph updates.
//   • Split: both side by side, resizable, with selection synced BOTH ways via anchors.
// One pending-changes bar drives 9.1's content-canonical save (intent log rides along) + Discard resets
// the draft to the base version. Monaco is NEVER double-mounted: the Code pane lives at ONE stable tree
// position across Code↔Split (the split centerpiece), so the model is shared, not recreated.

export type EditorMode = "flow" | "code" | "split";
const EDITOR_MODES: EditorMode[] = ["flow", "code", "split"];
const isEditorMode = (value: string | null): value is EditorMode =>
  value !== null && (EDITOR_MODES as string[]).includes(value);

/** Editable Monaco options: the shared read-only baseline with `readOnly` lifted, glyph margin on for
 *  WP 9.3's kind/annotation/breadcrumb gutter glyphs. */
const EDITABLE_OPTIONS = { ...READ_ONLY_OPTIONS, readOnly: false, glyphMargin: true };

/** How long a cursor move waits before it highlights the owning node (avoid thrash while scrubbing). */
const CURSOR_SYNC_DEBOUNCE_MS = 120;

type CodeEditorMount = NonNullable<CodeEditorProps["onMount"]>;
type MonacoEditor = Parameters<CodeEditorMount>[0];

/** The id of the smallest-span graph node whose anchor contains `line` (1-based), or undefined. The
 *  innermost owner is the most specific target; a node's own heading line maps back to itself. */
function owningNodeId(graph: SkillGraph, line: number): string | undefined {
  let best: { id: string; span: number; start: number } | undefined;
  for (const node of graph.nodes) {
    const { startLine, endLine } = node.anchor;
    if (line < startLine || line > endLine) continue;
    const span = endLine - startLine;
    if (!best || span < best.span || (span === best.span && startLine > best.start)) {
      best = { id: node.id, span, start: startLine };
    }
  }
  return best?.id;
}

const clampLine = (line: number, max: number): number =>
  Math.min(Math.max(line, 1), Math.max(max, 1));

export type UnifiedEditorProps = {
  skillId: string;
  versionId: string;
  /** Which mode to open in the FIRST time (no `?mode=` in the URL yet). Design host ⇒ "flow"; the Files
   *  tab's SKILL.md entry ⇒ "code". */
  defaultMode?: EditorMode;
  /** Bubbles the live-draft dirty state up (the inspector's unsaved-changes guard on tab/version switch). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called with the NEW version's id right after a save (the inspector refetches + repoints its picker). */
  onVersionSaved?: (newVersionId: string) => void;
  /** Deep-link into the Diff tab for (fromVersionId, toVersionId) — the save success view's "View diff". */
  onOpenDiff?: (fromVersionId: string, toVersionId: string) => void;
  /** Open the inline tool-runner Sheet for an ALREADY-RESOLVED bound tool (WP 8.5). */
  onTestTool?: (tool: BoundTool) => void;
  /** SI13 — a header-actions slot registrar. When supplied (the inspector, via `SkillDesignView`),
   *  the save cluster — the "N unsaved changes" chip · Discard · Save… (or the muted "No unsaved
   *  changes" note) — is registered INTO the inspector's page-header action row instead of rendering
   *  in the IDE toolbar, and is cleared (`null`) on unmount so it disappears with the Design surface.
   *  Omitted (a standalone host / tests) ⇒ the cluster renders inline in the toolbar as before. */
  onHeaderActionsChange?: (actions: ReactNode | null) => void;
};

/**
 * The unified Flow/Code editor surface (WP 9.2). Owns the WP 9.1 live-draft store and renders it as a
 * segmented Flow | Code | Split view over ONE document. Hosted by the Design tab (default "flow") and
 * opened for `SKILL.md` from the Files tab (default "code").
 */
export function UnifiedEditor({
  skillId,
  versionId,
  defaultMode = "flow",
  onDirtyChange,
  onVersionSaved,
  onOpenDiff,
  onTestTool,
  onHeaderActionsChange,
}: UnifiedEditorProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Mode lives in the URL so it survives tab switches (Radix unmounts inactive tab content) AND doubles
  // as the 9.4 problems-panel deep link (`?mode=code`). Absent ⇒ the host's default.
  const modeParam = searchParams.get("mode");
  const mode: EditorMode = isEditorMode(modeParam) ? modeParam : defaultMode;
  const setMode = useCallback(
    (next: EditorMode) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("mode", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const draft = useSkillDraft(skillId, versionId);
  const { edit, baseGraph: graph, treeSha, draftGraph, manualEdit, loading, error } = draft;

  const { boundTools, loading: boundToolsLoading } = useBoundTools(skillId, versionId);

  // WP 9.3 — the version's file paths drive code-mode relative-path (asset-ref) completion. A read-only
  // fetch; a failure degrades to no path suggestions (advisory tooling, never load-blocking).
  const [filePaths, setFilePaths] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setFilePaths([]);
    getSkillFiles(skillId, versionId)
      .then((files) => {
        if (!cancelled) setFilePaths(files.map((file) => file.path));
      })
      .catch(() => {
        /* no path completion — the rest of code-intel still works */
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [flowFilter, setFlowFilter] = useState<string>("__all__");
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addCommandOpen, setAddCommandOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardConfirming, setDiscardConfirming] = useState(false);

  // ── selection-sync plumbing (anchors, both ways) ─────────────────────────────────────────────────
  const editorRef = useRef<MonacoEditor | null>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  // Where the current selection came from — a canvas/external selection REVEALS the line in code; a
  // cursor-originated selection does NOT (the cursor is already there). Together with the "owner ===
  // current selection ⇒ no-op" guard in the cursor handler, this breaks the select→reveal→select loop.
  const selectionSourceRef = useRef<"canvas" | "cursor" | "external">("external");
  const selectedNodeIdRef = useRef<string | undefined>(undefined);
  selectedNodeIdRef.current = selectedNodeId;
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A pending EXACT line reveal from a `?line=` deep link, applied once the editor is mounted.
  const pendingRevealLineRef = useRef<number | null>(null);

  // Reset transient view state on every version switch (the draft store reloads the base itself).
  useEffect(() => {
    setSelectedNodeId(undefined);
    setFlowFilter("__all__");
  }, [skillId, versionId]);

  // Bubble the dirty flag up (inspector-level unsaved-changes guard).
  useEffect(() => {
    onDirtyChange?.(draft.dirty);
  }, [draft.dirty, onDirtyChange]);

  // beforeunload guard — warn before discarding unsaved input on a hard tab/window close.
  useEffect(() => {
    if (!draft.dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft.dirty]);

  // Insert-at-cursor plumbing (WP 8.3): the section-body editor registers "insert text at the caret";
  // the Tools palette drops a backticked reference where the author is typing.
  const insertRef = useRef<((text: string) => boolean) | null>(null);
  const [canInsert, setCanInsert] = useState(false);
  const registerInsert = useCallback((fn: ((text: string) => boolean) | null) => {
    insertRef.current = fn;
    setCanInsert(fn !== null);
  }, []);
  const handleInsertTool = useCallback((toolName: string) => {
    const ok = insertRef.current?.(`\`${toolName}\``) ?? false;
    if (ok) {
      toast.success("Reference inserted", {
        description: `Added \`${toolName}\` at the cursor — Save to keep it.`,
      });
    } else {
      notifyError("Nowhere to insert", {
        description: "Select a section, then click into its body editor first.",
      });
    }
  }, []);

  // ── the flow projection (one document, two views) ────────────────────────────────────────────────
  // The canvas renders the LIVE projection of the draft (`draftGraph`) once the text has been edited
  // directly (code mode) — so a code edit shows up on the canvas. Before any direct text edit, a snappy
  // client-side op preview keeps canvas gestures instant. Both are projections of the SAME draft.
  const previewGraph = useMemo(
    () => (graph ? applyPreviewOps(graph, edit.ops) : null),
    [graph, edit.ops],
  );
  const flowGraph = manualEdit ? (draftGraph ?? graph) : (previewGraph ?? graph);

  // Keep the anchor source for selection sync current (assigned during render; read in effects/handlers
  // after commit). Prefer the live projection so anchors line up with the code text as it is edited.
  const syncGraph = draftGraph ?? flowGraph;
  const syncGraphRef = useRef<SkillGraph | null>(null);
  syncGraphRef.current = syncGraph;

  const lanes = useMemo(() => (flowGraph ? layoutSkillLanes(flowGraph) : []), [flowGraph]);
  const showFlowPicker = lanes.length > 1;
  const visibleFlowId = flowFilter === "__all__" ? undefined : flowFilter;

  useEffect(() => {
    if (flowFilter !== "__all__" && !lanes.some((lane) => lane.flowId === flowFilter)) {
      setFlowFilter("__all__");
    }
  }, [lanes, flowFilter]);

  const {
    nodes: builtNodes,
    edges,
    droppedEdges,
  } = useMemo(
    () =>
      flowGraph
        ? buildFlow(flowGraph, undefined, visibleFlowId ? { visibleFlowId } : undefined)
        : { nodes: [] as SkillCanvasNode[], edges: [] as Edge[], droppedEdges: 0 },
    [flowGraph, visibleFlowId],
  );

  // Re-seed `selected` onto the freshly built nodes (a rebuild produces new node objects with no React
  // Flow `selected` flag). This is also how a CODE→canvas selection lands: setting `selectedNodeId`
  // re-seeds the flag here, and the canvas re-renders that node as selected.
  const nodes = useMemo(
    () => builtNodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [builtNodes, selectedNodeId],
  );

  const warnings = useMemo(() => {
    const source = draftGraph ?? graph;
    const list = source?.warnings ? [...source.warnings] : [];
    if (droppedEdges > 0) {
      list.push(
        `${droppedEdges} edge${droppedEdges === 1 ? "" : "s"} referenced a node that no longer exists and ${
          droppedEdges === 1 ? "was" : "were"
        } hidden.`,
      );
    }
    return list;
  }, [draftGraph, graph, droppedEdges]);

  // WP 7.5 — LIVE unknown-tool findings over the DRAFT text, validated against the bound servers'
  // scanned tool names (the same list + matcher the code decorations use, so an underlined token and
  // a listed problem can never disagree). Skipped while the list is loading or empty (no completed
  // scan → no basis to validate). Carried to the problems panel on its existing `warnings` channel —
  // `collectSkillProblems` recognizes the format, re-classifies each to the `tool` source with a line
  // pin, and drops it when the persisted diagnostics already report the same name. The projector
  // Alert above deliberately renders `warnings` only (these are not projector findings).
  const problemsWarnings = useMemo(() => {
    if (boundToolsLoading || boundTools.length === 0) return warnings;
    const live = findUnknownToolReferences(
      draft.content,
      boundTools.map((tool) => tool.toolName),
    ).map(formatUnknownToolWarning);
    return live.length > 0 ? [...warnings, ...live] : warnings;
  }, [warnings, draft.content, boundTools, boundToolsLoading]);

  const sections = useMemo(
    () =>
      graph ? graph.nodes.filter(isSectionNode).map((n) => ({ id: n.id, label: n.label })) : [],
    [graph],
  );

  const commandTokens = useMemo(() => {
    if (!graph) return [];
    const tokens: string[] = [];
    for (const node of graph.nodes) {
      if (node.kind === "entry_point" && node.trigger.type === "command")
        tokens.push(node.trigger.value);
    }
    return tokens;
  }, [graph]);

  const previewOnlyLabel =
    selectedNodeId && isPreviewOnlyNodeId(selectedNodeId)
      ? flowGraph?.nodes.find((n) => n.id === selectedNodeId)?.label
      : undefined;

  // ── canvas gesture handlers (gesture → typed op on the shared buffer; nothing mutates until Save) ──
  const addOp = edit.addOp;
  const handleSelectNode = useCallback((nodeId: string | undefined) => {
    selectionSourceRef.current = "canvas";
    setSelectedNodeId(nodeId);
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!graph) return;
      const source = graph.nodes.find((n) => n.id === connection.source);
      const target = graph.nodes.find((n) => n.id === connection.target);
      if (source && target && isSectionNode(source) && target.kind === "asset") {
        addOp({ op: "connect_asset", nodeId: source.id, path: target.path });
        toast.success("Connection staged", {
          description: `“${target.label}” will be referenced from “${source.label}” when you save.`,
        });
        return;
      }
      notifyError("Couldn’t create that connection", {
        description:
          "A connection runs from a section to an asset file — drag from a section node onto an asset.",
      });
    },
    [graph, addOp],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (!graph) return;
      for (const edge of deleted) {
        const source = graph.nodes.find((n) => n.id === edge.source);
        const target = graph.nodes.find((n) => n.id === edge.target);
        if (source && target && isSectionNode(source) && target.kind === "asset") {
          addOp({ op: "disconnect_asset", nodeId: source.id, path: target.path });
          toast.success("Disconnect staged", {
            description: `“${target.label}” will no longer be referenced from “${source.label}” after you save.`,
          });
        }
      }
    },
    [graph, addOp],
  );

  const handleToolDrop = useCallback(
    ({ server, tool, nodeId }: { server: string; tool: string; nodeId: string | null }) => {
      if (!graph) return;
      const target = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined;
      if (target && isSectionNode(target)) {
        addOp({ op: "add_tool_ref", nodeId: target.id, server, tool });
        toast.success("Tool reference staged", {
          description: `“${tool}” will be referenced from “${target.label}” when you save.`,
        });
        return;
      }
      notifyError("Drop onto a section", {
        description:
          "Drag a tool onto a section node to reference it — nothing else accepts a tool.",
      });
    },
    [graph, addOp],
  );

  // ── selection sync: node → line (reveal) ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editorMounted || mode === "flow") return;
    if (selectionSourceRef.current === "cursor") return; // the cursor is already there — no reveal
    if (!selectedNodeId) return;
    const editor = editorRef.current;
    const node = syncGraphRef.current?.nodes.find((n) => n.id === selectedNodeId);
    if (!editor || !node) return;
    const line = clampLine(
      node.anchor.startLine,
      editor.getModel()?.getLineCount() ?? node.anchor.startLine,
    );
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
  }, [selectedNodeId, editorMounted, mode]);

  // ── selection sync: cursor → node (highlight owning node, debounced) ─────────────────────────────
  const handleCursorLine = useCallback((line: number) => {
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = setTimeout(() => {
      const g = syncGraphRef.current;
      if (!g) return;
      const ownerId = owningNodeId(g, line);
      // No owner, or the owner is ALREADY selected ⇒ do nothing (this is what stops the feedback loop
      // when the reveal above moves the cursor onto the just-selected node's heading line).
      if (!ownerId || ownerId === selectedNodeIdRef.current) return;
      selectionSourceRef.current = "cursor";
      setSelectedNodeId(ownerId);
    }, CURSOR_SYNC_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    },
    [],
  );

  const handleEditorMountedChange = useCallback((mounted: boolean) => {
    setEditorMounted(mounted);
    if (!mounted) editorRef.current = null;
  }, []);

  const setEditorInstance = useCallback((editor: MonacoEditor | null) => {
    editorRef.current = editor;
  }, []);

  // ── problems-panel deep links (WP 9.4) — the same anchor plumbing 9.2's `?node=`/`?line=` use, but
  //    driven in-process (the panel is mounted inside this editor, so no URL round-trip is needed). ──
  // Node: select on the canvas → make a flow-visible mode so the selection actually shows.
  const goToNode = useCallback(
    (nodeId: string) => {
      selectionSourceRef.current = "external";
      setSelectedNodeId(nodeId);
      if (mode === "code") setMode("split");
    },
    [mode, setMode],
  );
  // Line: reveal it in the code editor → switch to code if we're on the bare flow canvas. When Monaco
  // isn't mounted yet (flow→code), defer through the same pending-reveal ref the mount effect drains.
  const goToLine = useCallback(
    (line: number) => {
      if (mode === "flow") setMode("code");
      const editor = editorRef.current;
      if (editor && editorMounted) {
        const target = clampLine(line, editor.getModel()?.getLineCount() ?? line);
        editor.revealLineInCenter(target);
        editor.setPosition({ lineNumber: target, column: 1 });
        editor.focus();
      } else {
        pendingRevealLineRef.current = line;
      }
    },
    [mode, editorMounted, setMode],
  );

  // Apply a pending `?line=` reveal once the editor is live.
  useEffect(() => {
    if (!editorMounted) return;
    const line = pendingRevealLineRef.current;
    if (line === null) return;
    pendingRevealLineRef.current = null;
    const editor = editorRef.current;
    if (!editor) return;
    const target = clampLine(line, editor.getModel()?.getLineCount() ?? line);
    editor.revealLineInCenter(target);
    editor.setPosition({ lineNumber: target, column: 1 });
    editor.focus();
  }, [editorMounted]);

  // ── deep links (?node= / ?line=) — one-shot navigation targets, then stripped from the URL ────────
  const nodeParam = searchParams.get("node");
  const lineParam = searchParams.get("line");
  useEffect(() => {
    if (nodeParam === null && lineParam === null) return;
    let switchToCode = false;
    if (nodeParam) {
      selectionSourceRef.current = "external";
      setSelectedNodeId(nodeParam);
    }
    if (lineParam) {
      const line = Number.parseInt(lineParam, 10);
      if (Number.isFinite(line) && line > 0) {
        switchToCode = true;
        pendingRevealLineRef.current = line;
        const owner = syncGraphRef.current ? owningNodeId(syncGraphRef.current, line) : undefined;
        if (owner) {
          selectionSourceRef.current = "external";
          setSelectedNodeId(owner);
        }
      }
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("node");
        params.delete("line");
        if (switchToCode && !isEditorMode(params.get("mode"))) params.set("mode", "code");
        if (switchToCode && params.get("mode") === "flow") params.set("mode", "code");
        return params;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeParam, lineParam]);

  // ── save ─────────────────────────────────────────────────────────────────────────────────────────
  // Switching to the new version immediately would reload the draft (base → null) and unmount the save
  // dialog before the user sees its success view; defer the switch until the dialog closes.
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const handleSaved = useCallback((version: SkillVersion) => setSavedVersionId(version.id), []);
  const handleSaveOpenChange = useCallback(
    (open: boolean) => {
      setSaveOpen(open);
      if (!open && savedVersionId) {
        onVersionSaved?.(savedVersionId);
        setSavedVersionId(null);
      }
    },
    [savedVersionId, onVersionSaved],
  );

  const pendingCount = manualEdit ? 1 : edit.ops.length;

  // ── SI13 — the save cluster (dirty chip · Discard · Save…) ───────────────────────────────────────
  // ONE definition serving two mounts: registered into the inspector's header action row when the
  // host wires `onHeaderActionsChange` (the Design tab), rendered inline in the IDE toolbar
  // otherwise. The three controls keep their exact handlers — the chip mirrors `pendingCount`,
  // Discard opens the same confirm, Save… opens the same `UnifiedSaveDialog` (both dialogs stay
  // mounted HERE). Null while the draft hasn't loaded, so the header never shows a stale state.
  const clusterInHeader = onHeaderActionsChange !== undefined;
  const saveCluster = useMemo<ReactNode>(() => {
    if (loading || error !== null || graph === null) return null;
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="design-save-cluster">
        {draft.dirty ? (
          <>
            <Badge variant="warning" className="tabular-nums">
              {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDiscardConfirming(true)}
              aria-label="Discard unsaved changes"
            >
              <Undo2 aria-hidden /> Discard
            </Button>
            <Button size="sm" onClick={() => setSaveOpen(true)}>
              <Save aria-hidden /> Save…
            </Button>
          </>
        ) : (
          <Text variant="meta" tone="muted" className="whitespace-nowrap">
            No unsaved changes
          </Text>
        )}
      </div>
    );
  }, [loading, error, graph, draft.dirty, pendingCount]);

  // Register the cluster into the host's header slot; clear it when this surface unmounts (tab
  // switch / version reload) so the header never advertises a draft that no longer exists.
  useEffect(() => {
    if (!onHeaderActionsChange) return;
    onHeaderActionsChange(saveCluster);
    return () => onHeaderActionsChange(null);
  }, [saveCluster, onHeaderActionsChange]);

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load the skill — switch versions or refresh the page to try again."
        description={error}
      />
    );
  }
  if (loading || graph === null || flowGraph === null) {
    return <StatePanel kind="loading" title="Loading…" loadingLabel="Projecting the skill…" />;
  }

  const flowVisible = mode !== "code";
  const graphEmpty = flowGraph.nodes.length === 0;

  const flowPane = (
    <FlowPane
      skillId={skillId}
      versionId={versionId}
      graph={graph}
      nodes={nodes}
      edges={edges}
      graphEmpty={graphEmpty}
      selectedNodeId={selectedNodeId}
      onSelectNode={handleSelectNode}
      onConnect={handleConnect}
      onEdgesDelete={handleEdgesDelete}
      onToolDrop={handleToolDrop}
      previewOnlyLabel={previewOnlyLabel}
      edit={edit}
      boundTools={boundTools}
      boundToolsLoading={boundToolsLoading}
      canInsert={canInsert}
      onInsertTool={handleInsertTool}
      onRegisterInsert={registerInsert}
      onTestTool={onTestTool}
    />
  );

  const codePane = (
    <CodePane
      value={draft.content}
      onChange={draft.setContent}
      path={`skill-ide://${skillId}/${versionId}/SKILL.md`}
      setEditor={setEditorInstance}
      onMountedChange={handleEditorMountedChange}
      onCursorLine={handleCursorLine}
      graph={draftGraph}
      boundTools={boundTools}
      filePaths={filePaths}
      onTestTool={onTestTool}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Toolbar: the segmented view control + (flow-only) picker/add actions + the ONE save bar. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="segmented"
            value={mode}
            onValueChange={(value) => {
              if (isEditorMode(value)) setMode(value);
            }}
            aria-label="Editor view"
          >
            <ToggleGroupItem value="flow" aria-label="Show flow">
              <Workflow className="size-4" aria-hidden /> Flow
            </ToggleGroupItem>
            <ToggleGroupItem value="code" aria-label="Show code">
              <Code2 className="size-4" aria-hidden /> Code
            </ToggleGroupItem>
            <ToggleGroupItem value="split" aria-label="Split view">
              <Columns2 className="size-4" aria-hidden /> Split
            </ToggleGroupItem>
          </ToggleGroup>

          {flowVisible && showFlowPicker ? (
            <div className="flex items-center gap-2">
              <Text variant="meta" tone="muted" as="span">
                Flow
              </Text>
              <Select value={flowFilter} onValueChange={setFlowFilter}>
                <SelectTrigger aria-label="Filter shown flow" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All flows</SelectItem>
                  {lanes.map((lane) => (
                    <SelectItem key={lane.flowId} value={lane.flowId}>
                      {lane.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {flowVisible ? (
            <>
              <ExplainerLegend />
              <Button variant="outline" size="sm" onClick={() => setAddCommandOpen(true)}>
                <Terminal aria-hidden /> Add command
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddSectionOpen(true)}>
                <Plus aria-hidden /> Add section
              </Button>
            </>
          ) : null}

          {/* SI13 — when the inspector hosts the save cluster in its page header, the toolbar
              doesn't repeat it; a standalone host keeps the inline cluster. */}
          {clusterInHeader ? null : saveCluster}
        </div>
      </div>

      {flowVisible ? (
        <Text variant="meta" tone="muted" className="shrink-0">
          Drag from a section node onto an asset to connect it, or drag a tool from the palette onto
          a section to reference it. Type in code to edit the document directly — both views stay in
          sync. Nothing changes until you save.
        </Text>
      ) : null}

      {warnings.length > 0 ? (
        <Alert variant="warning" className="shrink-0">
          <AlertTriangle />
          <AlertTitle>Projector warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Body. In flow mode the canvas fills the surface; otherwise a ResizablePanelGroup hosts the code
          pane at a STABLE tree position (key="code") so Monaco is never remounted between Code and Split —
          the model is shared. The flow panel + handle are added only in split mode. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === "flow" ? (
          flowPane
        ) : (
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="skill-unified-editor"
            className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
          >
            {mode === "split" ? (
              <ResizablePanel key="flow" id="unified-flow" order={1} defaultSize={50} minSize={25}>
                {flowPane}
              </ResizablePanel>
            ) : null}
            {mode === "split" ? <ResizableHandle key="handle" withHandle /> : null}
            <ResizablePanel
              key="code"
              id="unified-code"
              order={2}
              defaultSize={mode === "split" ? 50 : 100}
              minSize={25}
            >
              {codePane}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      {/* WP 9.4 — the unified problems panel, mounted ONCE below the body so it renders IDENTICALLY in
          Flow, Code, and Split. It reads the SAME live projection (`syncGraph`) + the live projector
          warnings the canvas/code decorations use — plus (WP 7.5) the live unknown-tool findings —
          and adds the persisted quality + tool findings. */}
      <ProblemsPanel
        skillId={skillId}
        versionId={versionId}
        graph={syncGraph}
        warnings={problemsWarnings}
        dirty={draft.dirty}
        onGoToNode={goToNode}
        onGoToLine={goToLine}
      />

      <AddSectionDialog
        open={addSectionOpen}
        onOpenChange={setAddSectionOpen}
        sections={sections}
        onAdd={(input) => edit.addOp({ op: "add_subroutine", ...input })}
      />

      <CommandDialog
        open={addCommandOpen}
        onOpenChange={setAddCommandOpen}
        mode="add"
        existingCommands={commandTokens}
        onSubmit={({ command, title, body }) =>
          edit.addOp({
            op: "add_command",
            command,
            ...(title ? { title } : {}),
            ...(body ? { body } : {}),
          })
        }
      />

      <UnifiedSaveDialog
        open={saveOpen}
        onOpenChange={handleSaveOpenChange}
        versionId={versionId}
        graph={graph}
        ops={edit.ops}
        manualEdit={manualEdit}
        baseTreeSha={treeSha ?? ""}
        save={draft.save}
        onReload={draft.reload}
        onDiscard={draft.reset}
        onSaved={handleSaved}
        onViewDiff={(fromId, toId) => onOpenDiff?.(fromId, toId)}
      />

      <DiscardChangesDialog
        open={discardConfirming}
        onConfirm={() => {
          draft.reset();
          setDiscardConfirming(false);
        }}
        onCancel={() => setDiscardConfirming(false)}
      />
    </div>
  );
}

// ── Flow pane: the three-pane canvas (palette | canvas | detail panel) — SI16 chrome ───────────────
// The two side panels live in an `AdaptivePanelGroup` (a `ResizablePanelGroup` that stacks below the
// brand mobile breakpoint): user-resizable with visible handles, and collapsible to a slim vertical
// rail. Sizes persist through the group's `autoSaveId` (react-resizable-panels' own localStorage
// layout); each panel's collapsed flag persists under its own key below. The canvas panel always
// takes the remaining space (`min-w-0`).

/** localStorage key prefix for one Design side panel's collapsed flag. */
const PANEL_COLLAPSED_STORE_PREFIX = "mcpfp.skill-ide.design.panel-collapsed:";
/** The react-resizable-panels `autoSaveId` under which the three-panel layout (sizes) persists. */
const PANEL_LAYOUT_AUTOSAVE_ID = "skill-ide-design-panels";
/** Collapsed size, in group percent — a slim icon rail (~36–48px on typical canvas widths). */
const PANEL_COLLAPSED_SIZE = 3;

/** Read one panel's persisted collapsed flag (missing/blocked storage ⇒ expanded). Exported for tests. */
export function readPanelCollapsed(panelKey: string): boolean {
  try {
    return window.localStorage.getItem(`${PANEL_COLLAPSED_STORE_PREFIX}${panelKey}`) === "1";
  } catch {
    return false;
  }
}

/** Persist one panel's collapsed flag (storage failures are ignored — view state only). Exported for tests. */
export function writePanelCollapsed(panelKey: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      `${PANEL_COLLAPSED_STORE_PREFIX}${panelKey}`,
      collapsed ? "1" : "0",
    );
  } catch {
    /* private mode / quota — the session state still works, it just won't persist */
  }
}

/** The slice of react-resizable-panels' imperative handle this chrome drives (typed locally — the
 *  full `ImperativePanelHandle` type isn't re-exported by `@elabs-ai/components-ui`). */
type PanelHandle = { collapse: () => void; expand: () => void; isCollapsed: () => boolean };

/**
 * One collapsible side panel's state: the persisted collapsed flag (source of truth for WHICH
 * content renders — full panel vs. slim rail) kept in lock-step with the `ResizablePanel`'s own
 * collapse state (restored on mount, driven on toggle, and synced back when a drag collapses or
 * re-expands the panel through the handle).
 */
function useCollapsibleSidePanel(panelKey: string) {
  const panelRef = useRef<PanelHandle | null>(null);
  const [collapsed, setCollapsedState] = useState<boolean>(() => readPanelCollapsed(panelKey));

  const setPanelRef = useCallback((handle: PanelHandle | null) => {
    panelRef.current = handle;
  }, []);

  /** Toggle from the chevron / rail — updates state, persists, and drives the panel size. */
  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      writePanelCollapsed(panelKey, next);
    },
    [panelKey],
  );

  // Keep the imperative panel in line with the flag: restores a persisted collapse on mount and
  // applies chevron/rail toggles. Drag-driven changes arrive already in sync (via onCollapse/onExpand
  // below), so this is a no-op for them. Guarded: react-resizable-panels' node/SSR build (what
  // vitest+jsdom resolves) strips its layout effects, so the imperative API throws "Panel size not
  // found" there — in a real browser the browser build is bundled and this never throws. The React
  // flag still swaps the panel CONTENT either way, so a caught failure only skips the size tween.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    try {
      if (collapsed && !panel.isCollapsed()) panel.collapse();
      else if (!collapsed && panel.isCollapsed()) panel.expand();
    } catch {
      /* imperative sizing unavailable (SSR build) — the collapsed flag still drives the content */
    }
  }, [collapsed]);

  // The panel collapsed/expanded through a HANDLE DRAG — sync + persist the flag.
  const onPanelCollapse = useCallback(() => {
    setCollapsedState(true);
    writePanelCollapsed(panelKey, true);
  }, [panelKey]);
  const onPanelExpand = useCallback(() => {
    setCollapsedState(false);
    writePanelCollapsed(panelKey, false);
  }, [panelKey]);

  return { collapsed, setCollapsed, setPanelRef, onPanelCollapse, onPanelExpand };
}

/** The collapsed state of a side panel: one full-height vertical tab (icon + rotated label) that
 *  reopens it. Keyboard-reachable; the whole rail is the target. */
function CollapsedPanelRail({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "start" | "end";
  onExpand: () => void;
}) {
  const Icon = side === "start" ? PanelLeftOpen : PanelRightOpen;
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-card">
      <Button
        variant="ghost"
        size="sm"
        className="flex h-full w-full flex-col items-center justify-start gap-2 rounded-none px-0 py-2"
        aria-label={`Expand the ${label} panel`}
        title={`Expand the ${label} panel`}
        onClick={onExpand}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="rotate-180 text-xs text-muted-foreground [writing-mode:vertical-rl]">
          {label}
        </span>
      </Button>
    </div>
  );
}

type FlowPaneProps = {
  skillId: string;
  versionId: string;
  graph: SkillGraph;
  nodes: SkillCanvasNode[];
  edges: Edge[];
  graphEmpty: boolean;
  selectedNodeId: string | undefined;
  onSelectNode: (nodeId: string | undefined) => void;
  onConnect: (connection: Connection) => void;
  onEdgesDelete: (edges: Edge[]) => void;
  onToolDrop: (payload: { server: string; tool: string; nodeId: string | null }) => void;
  previewOnlyLabel: string | undefined;
  edit: ReturnType<typeof useSkillDraft>["edit"];
  boundTools: BoundTool[];
  boundToolsLoading: boolean;
  canInsert: boolean;
  onInsertTool: (toolName: string) => void;
  onRegisterInsert: (fn: ((text: string) => boolean) | null) => void;
  onTestTool?: (tool: BoundTool) => void;
};

function FlowPane({
  skillId,
  versionId,
  graph,
  nodes,
  edges,
  graphEmpty,
  selectedNodeId,
  onSelectNode,
  onConnect,
  onEdgesDelete,
  onToolDrop,
  previewOnlyLabel,
  edit,
  boundTools,
  boundToolsLoading,
  canInsert,
  onInsertTool,
  onRegisterInsert,
  onTestTool,
}: FlowPaneProps) {
  const tools = useCollapsibleSidePanel("tools");
  const detail = useCollapsibleSidePanel("detail");

  return (
    <AdaptivePanelGroup
      autoSaveId={PANEL_LAYOUT_AUTOSAVE_ID}
      className="h-full min-h-0 overflow-hidden rounded-lg border border-border"
    >
      <ResizablePanel
        ref={tools.setPanelRef}
        id="design-tools"
        order={1}
        collapsible
        collapsedSize={PANEL_COLLAPSED_SIZE}
        defaultSize={20}
        minSize={14}
        maxSize={40}
        onCollapse={tools.onPanelCollapse}
        onExpand={tools.onPanelExpand}
        className="min-w-0"
      >
        {tools.collapsed ? (
          <CollapsedPanelRail
            label="Tools"
            side="start"
            onExpand={() => tools.setCollapsed(false)}
          />
        ) : (
          <ToolsPalette
            graph={graph}
            boundTools={boundTools}
            loading={boundToolsLoading}
            editMode
            canInsert={canInsert}
            onInsertTool={onInsertTool}
            onCollapse={() => tools.setCollapsed(true)}
          />
        )}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize the Tools panel" />

      {/* The canvas always takes the remaining space. */}
      <ResizablePanel
        id="design-canvas"
        order={2}
        defaultSize={54}
        minSize={30}
        className="min-w-0"
      >
        <div className="relative h-full w-full min-w-0">
          {graphEmpty ? (
            <StatePanel
              kind="empty"
              title="Nothing to design yet"
              description="No sections were found in this version's SKILL.md. Add a command or section, or switch to code and start typing."
            />
          ) : (
            <SkillGraphCanvas
              nodes={nodes}
              edges={edges}
              onSelectNode={onSelectNode}
              editable
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              onToolDrop={onToolDrop}
            />
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle aria-label="Resize the Node details panel" />
      <ResizablePanel
        ref={detail.setPanelRef}
        id="design-detail"
        order={3}
        collapsible
        collapsedSize={PANEL_COLLAPSED_SIZE}
        defaultSize={26}
        minSize={16}
        maxSize={45}
        onCollapse={detail.onPanelCollapse}
        onExpand={detail.onPanelExpand}
        className="min-w-0"
      >
        {detail.collapsed ? (
          <CollapsedPanelRail
            label="Node details"
            side="end"
            onExpand={() => detail.setCollapsed(false)}
          />
        ) : (
          <div className="relative h-full min-w-0">
            {/* The collapse chevron rides the InspectorPanel's own header row (layout-only overlay —
                the upstream panel header has no action slot). */}
            <IconButton
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 size-7"
              label="Collapse the Node details panel"
              onClick={() => detail.setCollapsed(true)}
            >
              <PanelRightClose aria-hidden />
            </IconButton>
            <NodeDetailPanel
              skillId={skillId}
              versionId={versionId}
              graph={graph}
              selectedNodeId={selectedNodeId}
              editMode
              edit={edit}
              previewOnlyLabel={previewOnlyLabel}
              boundTools={boundTools}
              onRegisterInsert={onRegisterInsert}
              onTestTool={onTestTool}
              width="100%"
            />
          </div>
        )}
      </ResizablePanel>
    </AdaptivePanelGroup>
  );
}

// ── Code pane: a full-document Monaco editor bound to the draft content ────────────────────────────

type CodePaneProps = {
  value: string;
  onChange: (value: string) => void;
  path: string;
  /** Publishes the mounted Monaco instance to the parent (selection sync reveals lines through it). */
  setEditor: (editor: MonacoEditor | null) => void;
  onMountedChange: (mounted: boolean) => void;
  /** Fired (raw) on every cursor move — the parent debounces + maps the line to the owning node. */
  onCursorLine: (line: number) => void;
  /** WP 9.3 — the draft's LIVE projection; drives kind/flow/ref decorations + construct-hover lookups. */
  graph: SkillGraph | null;
  /** WP 9.3 (+ 8.2) — bound tools for tool-name completion/hover (the construct hover defers to these). */
  boundTools: BoundTool[];
  /** WP 9.3 — the version's file paths, for relative-path asset-ref completion. */
  filePaths: string[];
  /** WP 8.5 — opens the inline tool runner from a bound-tool hover. */
  onTestTool?: (tool: BoundTool) => void;
};

function CodePane({
  value,
  onChange,
  path,
  setEditor,
  onMountedChange,
  onCursorLine,
  graph,
  boundTools,
  filePaths,
  onTestTool,
}: CodePaneProps) {
  const disposeRef = useRef<{ dispose: () => void } | null>(null);
  // WP 9.3 — the code-intel controller (decorations + construct hovers + snippets + WP 8.2 tool
  // providers). Registered ONCE in `onMount`, disposed ONCE on real unmount (dispose invariant).
  const codeIntelRef = useRef<CodeIntelController | null>(null);

  // Latest inputs the onMount registration reads (so a value that changed before mount is still seen);
  // the effects below push post-mount changes to the already-registered controller (no re-registration).
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const boundToolsRef = useRef(boundTools);
  boundToolsRef.current = boundTools;
  const filePathsRef = useRef(filePaths);
  filePathsRef.current = filePaths;
  const onTestToolRef = useRef(onTestTool);
  onTestToolRef.current = onTestTool;

  // Dispose the cursor listener + code-intel + release the editor ONLY on real unmount (Code→Flow).
  // Code↔Split keeps this component mounted at a stable tree position, so this never fires there → no
  // Monaco remount and no provider/decoration leak across mode toggles.
  useEffect(
    () => () => {
      disposeRef.current?.dispose();
      disposeRef.current = null;
      codeIntelRef.current?.dispose();
      codeIntelRef.current = null;
      setEditor(null);
      onMountedChange(false);
    },
    [setEditor, onMountedChange],
  );

  // Feed the LIVE projection / bound tools / file tree to the (already-registered) code-intel layer as
  // they change — decorations recompute from the in-memory graph, no per-keystroke fetch.
  useEffect(() => {
    codeIntelRef.current?.setGraph(graph);
  }, [graph]);
  useEffect(() => {
    codeIntelRef.current?.setBoundTools(boundTools);
  }, [boundTools]);
  useEffect(() => {
    codeIntelRef.current?.setFilePaths(filePaths);
  }, [filePaths]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Text variant="meta" tone="muted" className="font-mono">
          SKILL.md
        </Text>
        <Text variant="meta" tone="muted">
          Editing — save as a new version to persist
        </Text>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeEditor
          value={value}
          language="markdown"
          path={path}
          readOnly={false}
          height="100%"
          ariaLabel="Editing SKILL.md"
          options={EDITABLE_OPTIONS}
          onChange={onChange}
          onMount={(editor, monacoApi) => {
            setEditor(editor);
            disposeRef.current = editor.onDidChangeCursorPosition((event) =>
              onCursorLine(event.position.lineNumber),
            );
            codeIntelRef.current = registerCodeIntel(monacoApi, editor, {
              graph: graphRef.current,
              boundTools: boundToolsRef.current,
              filePaths: filePathsRef.current,
              ...(onTestToolRef.current ? { onTestTool: onTestToolRef.current } : {}),
            });
            onMountedChange(true);
          }}
        />
      </div>
    </div>
  );
}

// ── The single Save dialog (works for op-buffer AND direct-text edits — one save bar across modes) ──

type UnifiedSaveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  graph: SkillGraph;
  ops: ReturnType<typeof useSkillDraft>["edit"]["ops"];
  manualEdit: boolean;
  baseTreeSha: string;
  save: (note?: string) => Promise<SkillEditsResponse>;
  onReload: () => Promise<void>;
  onDiscard: () => void;
  onSaved: (version: SkillVersion) => void;
  onViewDiff: (fromVersionId: string, toVersionId: string) => void;
};

type SavedResult = { version: SkillVersion; diff: SkillDiff; warnings: string[] };
type SaveBanner = { status: 409 | 400 | "other"; message: string };

const DIFF_STATUS_LABEL: Record<string, string> = {
  added: "added",
  removed: "removed",
  modified: "modified",
  renamed: "renamed",
  unchanged: "unchanged",
};

function formatSigned(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value).toLocaleString();
  return `${value > 0 ? "+" : "−"}${abs}`;
}

function UnifiedSaveDialog({
  open,
  onOpenChange,
  versionId,
  graph,
  ops,
  manualEdit,
  save,
  onReload,
  onDiscard,
  onSaved,
  onViewDiff,
}: UnifiedSaveDialogProps) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [banner, setBanner] = useState<SaveBanner | null>(null);
  const [result, setResult] = useState<SavedResult | null>(null);

  useEffect(() => {
    if (open) {
      setNote("");
      setBanner(null);
      setResult(null);
    }
  }, [open]);

  // Both categories of pending change, listed together (text edits + staged graph/tree ops).
  const pendingLines = useMemo(() => {
    const lines: string[] = [];
    if (manualEdit) lines.push("Edited SKILL.md text directly");
    for (const op of ops) lines.push(describeEditOp(op, graph));
    return lines;
  }, [manualEdit, ops, graph]);

  const canSave = pendingLines.length > 0;

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      const response = await save(note.trim() || undefined);
      if ("unchanged" in response) {
        toast.info("Nothing to save", {
          description: "Those edits left SKILL.md identical to the current version.",
        });
        onDiscard();
        onOpenChange(false);
        return;
      }
      setResult({
        version: response.version,
        diff: response.diff,
        warnings: response.warnings ?? [],
      });
      toast.success(`Saved v${response.version.seq}`, {
        description: "Your edits are now a new immutable version.",
      });
      onSaved(response.version);
      onDiscard();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBanner({
          status: 409,
          message: getErrorMessage(err, "The version changed since you loaded it."),
        });
      } else if (err instanceof ApiError && err.status === 400) {
        setBanner({
          status: 400,
          message: getErrorMessage(err, "The server rejected these edits."),
        });
      } else {
        setBanner({
          status: "other",
          message: getErrorMessage(err, "The save request didn’t go through. Try again."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    try {
      await onReload();
      setBanner(null);
      toast.info("Reloaded", { description: "Your pending edits are kept — double-check them." });
    } catch (err) {
      setBanner({
        status: "other",
        message: getErrorMessage(err, "The reload didn’t go through. Try again."),
      });
    } finally {
      setReloading(false);
    }
  }

  const changedEntries = result ? result.diff.entries.filter((e) => e.status !== "unchanged") : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>{result ? "Saved" : "Save as new version"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Your draft was saved as a new immutable version — nothing was mutated in place."
              : "Review the pending changes, then save — this creates a new immutable version."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {result ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" aria-hidden />
                <Text>
                  Version v{result.version.seq} created
                  {result.version.note ? ` — “${result.version.note}”` : ""}.
                </Text>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <RollupTile
                  label="Files"
                  value={`+${result.diff.rollup.filesAdded} / ~${result.diff.rollup.filesModified} / −${result.diff.rollup.filesRemoved}`}
                />
                <RollupTile label="L2 · body Δ" value={formatSigned(result.diff.rollup.l2Delta)} />
                <RollupTile
                  label="Total tokens Δ"
                  value={formatSigned(result.diff.rollup.totalDelta)}
                />
                <RollupTile label="Bytes Δ" value={formatSigned(result.diff.rollup.bytesDelta)} />
              </div>

              {result.warnings.length > 0 ? (
                <Alert variant="warning">
                  <AlertTriangle />
                  <AlertTitle>Some ops were skipped</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Text variant="caption" tone="muted">
                  Changed files
                </Text>
                {changedEntries.length === 0 ? (
                  <Text variant="meta" tone="muted">
                    No files changed.
                  </Text>
                ) : (
                  <ScrollArea className="max-h-56 rounded-md border border-border">
                    <ul className="flex flex-col p-1">
                      {changedEntries.map((entry) => (
                        <li
                          key={`${entry.status}:${entry.path}`}
                          className="flex items-center gap-2 px-2 py-1.5"
                        >
                          <Badge variant="outline" className="shrink-0">
                            {DIFF_STATUS_LABEL[entry.status] ?? entry.status}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {entry.path}
                          </span>
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                            {entry.binary ? "binary" : `${formatSigned(entry.tokenDelta)} tok`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {banner ? (
                <Alert variant={banner.status === 400 ? "destructive" : "warning"}>
                  <AlertTriangle />
                  <AlertTitle>
                    {banner.status === 409
                      ? "Couldn’t save — this version changed since you loaded it"
                      : banner.status === 400
                        ? "Couldn’t save — these edits were rejected"
                        : "Couldn’t save this version"}
                  </AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    <span>{banner.message}</span>
                    {banner.status === 409 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => void handleReload()}
                        disabled={reloading}
                      >
                        {reloading ? <Spinner className="size-4" /> : <RefreshCw aria-hidden />}
                        <span>{reloading ? "Reloading…" : "Reload"}</span>
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unified-save-note">Note (optional)</Label>
                <Input
                  id="unified-save-note"
                  value={note}
                  placeholder="What changed, and why…"
                  spellCheck
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Text variant="caption" tone="muted">
                  {pendingLines.length} pending {pendingLines.length === 1 ? "change" : "changes"}
                </Text>
                {pendingLines.length === 0 ? (
                  <Text variant="meta" tone="muted">
                    Nothing staged yet.
                  </Text>
                ) : (
                  <ScrollArea className="max-h-56 rounded-md border border-border">
                    <ul className="flex flex-col gap-1 p-2">
                      {pendingLines.map((line, index) => (
                        <li key={index} className="text-sm">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          {result ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onViewDiff(versionId, result.version.id);
                  onOpenChange(false);
                }}
              >
                View full diff <ArrowRight aria-hidden />
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || !canSave}>
                {saving ? <Spinner className="size-4" /> : <Save aria-hidden />}
                <span>{saving ? "Saving…" : "Save version"}</span>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RollupTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-0.5 p-2.5">
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      <Text className="tabular-nums">{value}</Text>
    </Card>
  );
}

// ── Add-section dialog (moved here from SkillDesignView — the flow-mode "Add section" affordance) ───

function AddSectionDialog({
  open,
  onOpenChange,
  sections,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: { id: string; label: string }[];
  onAdd: (input: { afterNodeId: string | null; title: string; body?: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [afterNodeId, setAfterNodeId] = useState<string>("__end__");

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setAfterNodeId("__end__");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Add section</DialogTitle>
          <DialogDescription>
            Stages an `add_subroutine` op — a new `## ` heading is inserted into `SKILL.md` when you
            save.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-section-title">Title</Label>
            <Input
              id="add-section-title"
              value={title}
              placeholder="Handle errors…"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-section-body">Body (optional)</Label>
            <Textarea
              id="add-section-body"
              rows={5}
              value={body}
              placeholder="What should happen in this section…"
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>After</Label>
            <Select value={afterNodeId} onValueChange={setAfterNodeId}>
              <SelectTrigger aria-label="Insert after">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__end__">At the end of the document</SelectItem>
                {sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="flex-none border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              onAdd({
                afterNodeId: afterNodeId === "__end__" ? null : afterNodeId,
                title: title.trim(),
                ...(body.trim() ? { body: body.trim() } : {}),
              });
              onOpenChange(false);
            }}
          >
            <Plus aria-hidden /> Add section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
