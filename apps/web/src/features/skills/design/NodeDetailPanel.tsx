import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SKILL_FLOW_ID } from "@mcp-token-footprint/shared";
import type {
  BoundTool,
  SkillGraph,
  SkillGraphEdge,
  SkillGraphNode,
  ToolDiagnostic,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  Card,
  Descriptions,
  DescriptionsItem,
  Heading,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Text,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@brand/ui";
import { InspectorPanel } from "@brand/flow";
import { CodeEditor, type CodeEditorProps } from "@brand/editor";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  HelpCircle,
  Pencil,
  Play,
  Trash2,
  Wrench,
} from "lucide-react";
import { READ_ONLY_OPTIONS } from "../../../lib/monaco";
import { getErrorMessage } from "../../../lib/errors";
import { IconButton } from "../../../components/IconButton";
import {
  formatToolDiagnosticMessage,
  getSkillFile,
  getToolDiagnostics,
} from "../skills-inspector-api";
import { registerBoundToolProviders } from "../use-bound-tools";
import { explainerFor } from "./code-intel/explainers";
import { CommandDialog } from "./CommandDialog";
import { diagnosticsInRange, NODE_KIND_META } from "./node-kind-meta";
import { isSectionNode, type EditOpsController } from "./use-edit-ops";

// Skill IDE WP 5.2 — Monaco marker plumbing. `CodeEditor.onMount(editor, monacoApi)` exposes the full
// monaco namespace; deriving the two param types off the prop avoids a direct `monaco-editor` import.
// EVERY marker set here uses this single owner so a re-validate/unmount can clear exactly its own
// markers (never another feature's) with `setModelMarkers(model, TOOL_VALIDATION_MARKER_OWNER, [])`.
type CodeEditorMount = NonNullable<CodeEditorProps["onMount"]>;
type MonacoEditor = Parameters<CodeEditorMount>[0];
type MonacoApi = Parameters<CodeEditorMount>[1];
const TOOL_VALIDATION_MARKER_OWNER = "tool-validation";

/** The document-scope validation-scope annotation, mirrored from the API's `tool-validation.ts`
 *  `SCOPE_RE` so the panel reads/rewrites exactly what the validator parses. */
const SCOPE_RE = /^<!--\s*skillflow:servers\s+(.+?)\s*-->$/i;

/** The union of `skillflow:servers` server names declared anywhere in SKILL.md (trimmed, in order). */
function parseValidationScope(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = SCOPE_RE.exec(raw.trim());
    if (!match) continue;
    for (const name of (match[1] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/** An `entry_point` node whose trigger is a `/command` — mirrors the API's `isCommandEntry`. */
function isCommandEntry(
  node: SkillGraphNode,
): node is Extract<SkillGraphNode, { kind: "entry_point" }> {
  return node.kind === "entry_point" && node.trigger.type === "command";
}

export type NodeDetailPanelProps = {
  skillId: string;
  versionId: string;
  /** The RAW/authoritative graph — every op targets an id from THIS graph, never the preview. */
  graph: SkillGraph;
  selectedNodeId: string | undefined;
  /** Edit mode (WP 4.2): renders field editors below the read-only details. Off = pure view (WP 1.3). */
  editMode: boolean;
  /** Required when `editMode` — the op buffer the field editors append to. */
  edit?: EditOpsController;
  /** Set when `selectedNodeId` is a preview-only synthetic node (an unsaved `add_subroutine`) that
   *  doesn't exist in `graph` — renders a minimal "not saved yet" notice instead of the real panel. */
  previewOnlyLabel?: string;
  /** Skill IDE WP 8.3 — the bound servers' tools (lifted to the Design view so the palette + this
   *  panel share ONE fetch). Drives the section-body editor's Monaco completion/hover AND the
   *  `tool_ref` node's detail card (scan data + resolved/unbound state). Empty ⇒ unbound. */
  boundTools: BoundTool[];
  /** Skill IDE WP 8.3 — register (or clear, with `null`) an "insert text at the cursor" function for
   *  the currently-mounted section-body editor, so the Tools palette can insert a reference at the
   *  caret. Called with a real function on mount and `null` on unmount / when no body editor is shown. */
  onRegisterInsert?: (fn: ((text: string) => boolean) | null) => void;
  /** Skill IDE WP 8.3 — OPTIONAL "Test run" action on the `tool_ref` tool card (opens the WP 8.5
   *  runner). Hidden until WP 8.5 injects it — exactly like WP 8.2's hover `onTestTool` (no dead
   *  control). WP 8.3 supplies no caller, so the button never renders. */
  onTestTool?: (tool: BoundTool) => void;
  /** SI16 — forwarded to the underlying `InspectorPanel` width. The Design surface passes `"100%"`
   *  so the panel tracks its host `ResizablePanel`; omitted ⇒ the upstream default (`18rem`), which
   *  keeps the Trace tab and any fixed-width host exactly as before. */
  width?: string;
};

/** One line of an in/out edge list: the direction arrow, the other node's label, and its condition
 *  (an editable inline `Input` in edit mode when the edge carries a condition). */
function EdgeRow({
  arrow,
  label,
  edge,
  editMode,
  edit,
}: {
  arrow: string;
  label: string;
  edge: SkillGraphEdge;
  editMode: boolean;
  edit?: EditOpsController;
}) {
  const pending = edit?.opsForEdge(edge.id).find((op) => op.op === "set_edge_condition");
  const currentCondition =
    pending?.op === "set_edge_condition" ? pending.condition : edge.condition;
  const [value, setValue] = useState(currentCondition ?? "");

  useEffect(() => {
    setValue(currentCondition ?? "");
  }, [edge.id, currentCondition]);

  const canEdit = editMode && edge.condition !== undefined && !!edit;
  const disabled = canEdit && !edge.anchor;

  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-start gap-1.5">
        <Text variant="meta" tone="muted" className="shrink-0 font-mono">
          {arrow}
        </Text>
        <span className="min-w-0 flex-1">
          <Text className="truncate">{label}</Text>
          {!canEdit && edge.condition ? (
            <Text variant="meta" tone="muted" className="truncate">
              {edge.condition}
            </Text>
          ) : null}
        </span>
      </div>
      {canEdit && edge.condition !== undefined ? (
        <div className="flex items-center gap-1.5 ps-5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 flex-1">
                <Input
                  value={value}
                  disabled={disabled}
                  aria-label={`Condition for edge to ${label}`}
                  spellCheck={false}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !disabled &&
                      value.trim() &&
                      value !== currentCondition
                    ) {
                      edit?.addOp({
                        op: "set_edge_condition",
                        edgeId: edge.id,
                        condition: value.trim(),
                      });
                    }
                  }}
                />
              </span>
            </TooltipTrigger>
            {disabled ? (
              <TooltipContent>
                This edge has no anchor pinning its condition text — the server can't safely rewrite
                it.
              </TooltipContent>
            ) : null}
          </Tooltip>
          <IconButton
            variant="ghost"
            size="icon"
            label={`Apply condition for edge to ${label}`}
            disabled={disabled || !value.trim() || value === currentCondition}
            onClick={() =>
              edit?.addOp({ op: "set_edge_condition", edgeId: edge.id, condition: value.trim() })
            }
          >
            <Check aria-hidden />
          </IconButton>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The anchored `SKILL.md` excerpt for the selected node — read-only, same Monaco viewer pattern as
 * `SkillFileExplorer`. Renders from the already-fetched full-file text (shared with the edit-mode
 * body editor below), re-sliced per selection.
 */
function AnchoredExcerpt({ text, node }: { text: string; node: SkillGraphNode }) {
  const excerpt = useMemo(() => {
    const lines = text.split(/\r?\n/);
    // Anchors are 1-based, inclusive line numbers.
    const start = Math.max(1, node.anchor.startLine);
    const end = Math.min(lines.length, node.anchor.endLine);
    return lines.slice(start - 1, end).join("\n");
  }, [text, node.anchor.startLine, node.anchor.endLine]);

  return (
    <div className="h-48 min-h-0 overflow-hidden rounded-md border border-border">
      <CodeEditor
        value={excerpt}
        language="markdown"
        readOnly
        height="100%"
        ariaLabel={`SKILL.md excerpt for ${node.label}`}
        options={READ_ONLY_OPTIONS}
      />
    </div>
  );
}

/** The section BODY only (heading excluded) — exactly the span `update_section_body`'s `body` param
 *  replaces (server: heading through the next heading of ANY level). */
function sectionBodyText(text: string, node: SkillGraphNode): string {
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, node.anchor.startLine); // 0-based index right AFTER the heading line
  const end = Math.min(lines.length, node.anchor.endLine);
  return lines.slice(start, end).join("\n");
}

/** Editable section-body editor (edit mode): a non-read-only Monaco `CodeEditor` seeded from the
 *  current body (or a staged `update_section_body` op's body, if one is already pending) — "Apply"
 *  stages `update_section_body` with the FULL new body text. Only rendered for SECTION nodes.
 *  WP 5.2: paints warning markers for the tool-reference diagnostics anchored inside this section
 *  (mapped from SKILL.md lines to this body editor's local lines), and disposes them on re-validate /
 *  node switch / unmount by re-setting `[]` for the same owner. */
function SectionBodyEditor({
  text,
  node,
  diagnostics,
  boundTools,
  edit,
  onRegisterInsert,
  onTestTool,
}: {
  text: string;
  node: SkillGraphNode;
  diagnostics: ToolDiagnostic[];
  /** WP 8.2 — the bound servers' tools; drives Monaco completion/hover in this body editor. Empty
   *  (unbound skill) ⇒ no providers registered. */
  boundTools: BoundTool[];
  edit: EditOpsController;
  /** WP 8.3 — register/clear the insert-at-cursor function for the Tools palette (see the panel prop). */
  onRegisterInsert?: (fn: ((text: string) => boolean) | null) => void;
  /** WP 8.5 — when set, the hover popup's "Test this tool…" command-link opens the runner Sheet. */
  onTestTool?: (tool: BoundTool) => void;
}) {
  const pending = edit.opsForNode(node.id).find((op) => op.op === "update_section_body");
  const original = useMemo(() => sectionBodyText(text, node), [text, node]);
  const initial = pending?.op === "update_section_body" ? pending.body : original;
  const [value, setValue] = useState(initial);

  // Reseed only when the SELECTED node changes (not on every keystroke / op-buffer update) — mirrors
  // the rename/expectation editors below.
  useEffect(() => {
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const disabled = edit.isRemoved(node.id);
  const dirty = value !== original;

  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const [mounted, setMounted] = useState(false);

  // The section's diagnostics (a stable-identity slice) + the anchor start drive the marker effect.
  const sectionDiagnostics = useMemo(
    () => diagnosticsInRange(diagnostics, node.anchor.startLine, node.anchor.endLine),
    [diagnostics, node.anchor.startLine, node.anchor.endLine],
  );

  // Body Monaco line 1 == SKILL.md line `anchor.startLine + 1` (the heading is excluded from the body),
  // so a diagnostic on SKILL.md line D maps to body line `D - anchor.startLine`. Set on mount + on any
  // re-validate; the cleanup clears THIS owner's markers (dispose invariant) before each re-set and on
  // unmount / node switch.
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = sectionDiagnostics.map((diagnostic) => {
      const localLine =
        (diagnostic.anchor?.startLine ?? node.anchor.startLine) - node.anchor.startLine;
      const line = Math.min(Math.max(localLine, 1), model.getLineCount());
      return {
        severity: monacoApi.MarkerSeverity.Warning,
        message: formatToolDiagnosticMessage(diagnostic),
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
      };
    });
    monacoApi.editor.setModelMarkers(model, TOOL_VALIDATION_MARKER_OWNER, markers);
    return () => {
      const current = editor.getModel();
      if (current) monacoApi.editor.setModelMarkers(current, TOOL_VALIDATION_MARKER_OWNER, []);
    };
  }, [sectionDiagnostics, node.anchor.startLine, mounted]);

  // WP 8.2 — register the bound-tool completion + hover providers ONCE per mount (scoped to THIS
  // editor's model), disposing them on unmount / when the tool set changes. An unbound skill (no bound
  // tools) registers nothing — honest degradation. Keyed on `mounted` so it runs after `onMount`.
  // WP 8.5 — `onTestTool` (when provided) adds the hover's "Test this tool…" command-link.
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi || boundTools.length === 0) return;
    const providers = registerBoundToolProviders(
      monacoApi,
      editor,
      boundTools,
      onTestTool ? { onTestTool } : {},
    );
    return () => providers.dispose();
  }, [boundTools, mounted, onTestTool]);

  // WP 8.3 — expose an insert-at-cursor function to the Tools palette (through the panel). Registered
  // once the editor is mounted (and not while the section is marked for removal → read-only), cleared
  // on unmount / node switch so the palette never inserts into a stale or read-only editor. The insert
  // goes through Monaco's own change event → `onChange` → the local `value`, staged as
  // `update_section_body` only on Apply — nothing mutates until Save (I2).
  useEffect(() => {
    if (!mounted || !onRegisterInsert || disabled) return;
    onRegisterInsert((snippet: string) => {
      const current = editorRef.current;
      const selection = current?.getSelection();
      if (!current || !selection) return false;
      current.executeEdits("tools-palette-insert", [
        { range: selection, text: snippet, forceMoveMarkers: true },
      ]);
      current.focus();
      return true;
    });
    return () => onRegisterInsert(null);
  }, [mounted, onRegisterInsert, disabled]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Section body</Label>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !dirty}
          onClick={() => edit.addOp({ op: "update_section_body", nodeId: node.id, body: value })}
        >
          Apply
        </Button>
      </div>
      <div className="h-48 min-h-0 overflow-hidden rounded-md border border-border">
        <CodeEditor
          value={value}
          language="markdown"
          readOnly={disabled}
          height="100%"
          ariaLabel={`Edit body of ${node.label}`}
          onChange={setValue}
          onMount={(editor, monacoApi) => {
            editorRef.current = editor;
            monacoRef.current = monacoApi;
            setMounted(true);
          }}
        />
      </div>
    </div>
  );
}

/** WP 5.2 — the tool-reference diagnostics anchored inside the selected section, listed with their
 *  message + candidate fix. Renders in BOTH view and edit mode (the Monaco squiggle only shows in the
 *  edit-mode body editor, so this is how a viewer sees the same issue). Empty ⇒ renders nothing. */
function NodeDiagnosticsList({
  node,
  diagnostics,
}: { node: SkillGraphNode; diagnostics: ToolDiagnostic[] }) {
  const forNode = useMemo(
    () => diagnosticsInRange(diagnostics, node.anchor.startLine, node.anchor.endLine),
    [diagnostics, node.anchor.startLine, node.anchor.endLine],
  );
  if (forNode.length === 0) return null;
  return (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>
        {forNode.length} tool reference {forNode.length === 1 ? "issue" : "issues"}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {forNode.map((diagnostic, index) => (
            <li key={`${diagnostic.name}-${diagnostic.anchor?.startLine ?? index}`}>
              <Text variant="meta" as="span" className="break-words">
                {formatToolDiagnosticMessage(diagnostic)}
              </Text>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/**
 * WP 5.2 — the document-scope validation-scope editor: which registered MCP servers the tool-reference
 * validator (`<!-- skillflow:servers a,b -->`) is narrowed to (blank ⇒ all servers). Deviation note:
 * the WP spec named `set_annotation`, but that op only writes a SECTION-level `gatekeeper`/`gate`
 * comment — it cannot carry a document-scope `servers` list, and the op vocabulary + API are frozen
 * (out of this WP's surface). So — WITHOUT inventing a new op — this stages the existing
 * `update_section_body` op on the skill's FIRST section, rewriting/removing the scope comment at the
 * top of that section's body (parsed globally by the validator). Composes over any pending body edit
 * on that section so it never clobbers one.
 */
function ValidationScopeEditor({
  graph,
  text,
  edit,
}: {
  graph: SkillGraph;
  text: string;
  edit: EditOpsController;
}) {
  const currentScope = useMemo(() => parseValidationScope(text), [text]);
  const firstSection = useMemo(
    () =>
      [...graph.nodes]
        .filter(isSectionNode)
        .sort((a, b) => a.anchor.startLine - b.anchor.startLine)[0],
    [graph.nodes],
  );

  const [value, setValue] = useState(currentScope.join(", "));
  useEffect(() => {
    setValue(currentScope.join(", "));
  }, [currentScope]);

  const disabled = firstSection === undefined;
  const names = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const changed = names.join(", ") !== currentScope.join(", ");

  const apply = () => {
    if (!firstSection) return;
    const pending = edit.opsForNode(firstSection.id).find((op) => op.op === "update_section_body");
    const baseBody =
      pending?.op === "update_section_body" ? pending.body : sectionBodyText(text, firstSection);
    const stripped = baseBody.split(/\r?\n/).filter((line) => !SCOPE_RE.test(line.trim()));
    const scopeLine = names.length > 0 ? `<!-- skillflow:servers ${names.join(", ")} -->` : null;
    const bodyLines = scopeLine ? [scopeLine, ...stripped] : stripped;
    edit.addOp({ op: "update_section_body", nodeId: firstSection.id, body: bodyLines.join("\n") });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="validation-scope">Validation scope</Label>
      <Text variant="meta" tone="muted">
        Comma-separated registered server names to validate tool references against. Leave blank to
        check every server. Applies to the whole skill.
      </Text>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          id="validation-scope"
          value={value}
          disabled={disabled}
          placeholder="acme-cloud, github…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Validation scope servers"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button size="sm" variant="outline" disabled={disabled || !changed} onClick={apply}>
          Apply
        </Button>
      </div>
      {disabled ? (
        <Text variant="meta" tone="muted">
          Add a section before scoping validation — the annotation is written into the first
          section.
        </Text>
      ) : (
        <Text variant="meta" tone="muted">
          Currently scoped to: {currentScope.length > 0 ? currentScope.join(", ") : "all servers"}.
        </Text>
      )}
    </div>
  );
}

/**
 * Skill IDE WP 9.4 (I10.5) — the per-node "What is this?" teaching card: the node kind's explainer
 * (title + one-line rationale + guide anchor) resolved through the SINGLE `explainers.ts` registry — the
 * SAME source the code-mode hover, the canvas legend, and the problems panel read. There is no in-app
 * docs route yet, so the guide anchor surfaces as the repo path/anchor reference (like the Quality tab).
 */
function WhatIsThis({ kind }: { kind: SkillGraphNode["kind"] }) {
  const entry = explainerFor(kind);
  if (!entry) return null;
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-3"
      data-testid="what-is-this"
    >
      <div className="flex items-center gap-1.5">
        <HelpCircle aria-hidden className="size-4 text-muted-foreground" />
        <Text variant="caption" tone="muted">
          What is a {entry.title.toLowerCase()}?
        </Text>
      </div>
      <Text variant="meta" className="text-pretty">
        {entry.short}
      </Text>
      <code className="break-all text-xs text-muted-foreground">{entry.guideAnchor}</code>
    </div>
  );
}

/** Kind-specific fields: asset (path + file kind), validation gate (script + expectation), loop guard. */
function KindFields({ node }: { node: SkillGraphNode }) {
  if (node.kind === "asset") {
    return (
      <Descriptions columns={1} layout="horizontal">
        <DescriptionsItem label="Path">
          <span className="font-mono text-xs break-words">{node.path}</span>
        </DescriptionsItem>
        <DescriptionsItem label="File kind">{node.fileKind}</DescriptionsItem>
      </Descriptions>
    );
  }
  if (node.kind === "validation_gate") {
    return (
      <Descriptions columns={1} layout="horizontal">
        <DescriptionsItem label="Script">
          <span className="font-mono text-xs break-words">{node.script}</span>
        </DescriptionsItem>
        <DescriptionsItem label="Expectation">{node.expectation || "—"}</DescriptionsItem>
      </Descriptions>
    );
  }
  if (node.kind === "loop_guard") {
    return (
      <Descriptions columns={1} layout="horizontal">
        <DescriptionsItem label="Max iterations" numeric>
          {node.maxIterations ?? "—"}
        </DescriptionsItem>
      </Descriptions>
    );
  }
  return null;
}

/** rename_node editor — Input + Apply, section nodes only. */
function RenameEditor({ node, edit }: { node: SkillGraphNode; edit: EditOpsController }) {
  const pending = edit.opsForNode(node.id).find((op) => op.op === "rename_node");
  const initial = pending?.op === "rename_node" ? pending.label : node.label;
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const disabled = edit.isRemoved(node.id);
  // Unchanged relative to whichever value is currently "live" for this node: the pending op's label
  // if one is staged, else the node's own label.
  const unchanged = value.trim() === initial.trim();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`rename-${node.id}`}>Section title</Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={`rename-${node.id}`}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !disabled && value.trim() && !unchanged) {
              edit.addOp({ op: "rename_node", nodeId: node.id, label: value.trim() });
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !value.trim() || unchanged}
          onClick={() => edit.addOp({ op: "rename_node", nodeId: node.id, label: value.trim() })}
        >
          Rename
        </Button>
      </div>
    </div>
  );
}

/** set_gate_expectation editor — Textarea + Apply, validation_gate nodes only. */
function GateExpectationEditor({
  node,
  edit,
}: {
  node: Extract<SkillGraphNode, { kind: "validation_gate" }>;
  edit: EditOpsController;
}) {
  const pending = edit.opsForNode(node.id).find((op) => op.op === "set_gate_expectation");
  const initial = pending?.op === "set_gate_expectation" ? pending.expectation : node.expectation;
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const disabled = edit.isRemoved(node.id);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`expectation-${node.id}`}>Gate expectation</Label>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !value.trim() || value === node.expectation}
          onClick={() =>
            edit.addOp({ op: "set_gate_expectation", nodeId: node.id, expectation: value.trim() })
          }
        >
          Apply
        </Button>
      </div>
      <Textarea
        id={`expectation-${node.id}`}
        rows={3}
        value={value}
        disabled={disabled}
        placeholder="Exit code 0 and no lines matching ERROR…"
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

const ANNOTATION_KINDS = [
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "gate", label: "Validation gate" },
] as const;

/** set_annotation editor — kind Select + id Input, section nodes only. */
function AnnotationEditor({ node, edit }: { node: SkillGraphNode; edit: EditOpsController }) {
  const pending = edit.opsForNode(node.id).find((op) => op.op === "set_annotation");
  const initialKind = pending?.op === "set_annotation" ? pending.kind : "gatekeeper";
  const initialId = pending?.op === "set_annotation" ? pending.id : "";
  const [kind, setKind] = useState<"gatekeeper" | "gate">(initialKind);
  const [id, setId] = useState(initialId);

  useEffect(() => {
    setKind(initialKind);
    setId(initialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const disabled = edit.isRemoved(node.id);
  const trimmedId = id.trim();
  const idHasWhitespace = /\s/.test(trimmedId);

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Annotation</Label>
      <Text variant="meta" tone="muted">
        Force this section's kind with a stable id — the same id trace markers reference.
      </Text>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={kind} onValueChange={(value) => setKind(value as "gatekeeper" | "gate")}>
          <SelectTrigger className="w-40" disabled={disabled} aria-label="Annotation kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANNOTATION_KINDS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={id}
          disabled={disabled}
          placeholder="stable-id…"
          spellCheck={false}
          aria-label="Annotation id"
          aria-invalid={idHasWhitespace ? true : undefined}
          onChange={(event) => setId(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || trimmedId === "" || idHasWhitespace}
          onClick={() => edit.addOp({ op: "set_annotation", nodeId: node.id, kind, id: trimmedId })}
        >
          Apply
        </Button>
      </div>
      {idHasWhitespace ? (
        <Text variant="meta" className="text-destructive" role="alert">
          The id can't contain whitespace.
        </Text>
      ) : null}
    </div>
  );
}

/** remove_node control — destructive Button + confirm. Disabled (with a tooltip) for accessory
 *  kinds — removing them isn't a safe text deletion; the owning section's body must be edited
 *  instead (the server itself degrades an accessory `remove_node` to a warning + skip). */
function RemoveNodeControl({
  node,
  ownerLabel,
  edit,
}: {
  node: SkillGraphNode;
  ownerLabel: string | undefined;
  edit: EditOpsController;
}) {
  const [confirming, setConfirming] = useState(false);
  const removed = edit.isRemoved(node.id);
  const isSection = isSectionNode(node);

  if (removed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
        <Text variant="meta">Marked for removal.</Text>
        <Button size="sm" variant="outline" onClick={() => edit.discardNode(node.id)}>
          Undo
        </Button>
      </div>
    );
  }

  const button = (
    <Button
      variant="destructive"
      size="sm"
      disabled={!isSection}
      onClick={() => setConfirming(true)}
    >
      <Trash2 aria-hidden /> Remove
    </Button>
  );

  return (
    <>
      {isSection ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block">{button}</span>
          </TooltipTrigger>
          <TooltipContent>
            Removing this reference isn't a safe text edit — edit the body of
            {ownerLabel ? ` “${ownerLabel}”` : " its owning section"} instead.
          </TooltipContent>
        </Tooltip>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{node.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This stages a removal of the whole section (and its sub-tree) from `SKILL.md`. Nothing
              is deleted until you save — you can undo this before then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                edit.addOp({ op: "remove_node", nodeId: node.id });
                setConfirming(false);
              }}
            >
              Mark for removal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Command entry-point editor (WP 2.2): rename or delete a `/command` from its entry node's panel.
 * Rename opens the shared {@link CommandDialog}; delete is a destructive confirm that lists the flow's
 * sections. Both stage typed ops (`rename_command` / `delete_command`) — nothing mutates until save.
 * Deleting first drops any other staged op on this node so the batch can't compose a `delete_command`
 * + `rename_command` conflict the API would 400 on.
 */
function EntryPointCommandEditor({
  node,
  graph,
  edit,
}: {
  node: Extract<SkillGraphNode, { kind: "entry_point" }>;
  graph: SkillGraph;
  edit: EditOpsController;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const nodeOps = edit.opsForNode(node.id);
  const pendingRename = nodeOps.find((op) => op.op === "rename_command");
  const deleteStaged = nodeOps.some((op) => op.op === "delete_command");
  const currentCommand =
    pendingRename?.op === "rename_command" ? pendingRename.command : node.trigger.value;

  const flowId = node.flowId ?? node.id;
  const flowSections = graph.nodes
    .filter((n) => (n.flowId ?? DEFAULT_SKILL_FLOW_ID) === flowId && isSectionNode(n))
    .map((n) => n.label);
  const otherCommands = graph.nodes
    .filter(
      (n): n is Extract<SkillGraphNode, { kind: "entry_point" }> =>
        isCommandEntry(n) && n.id !== node.id,
    )
    .map((n) => n.trigger.value);

  if (deleteStaged) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
        <Text variant="meta">Command marked for deletion — its whole flow is removed on save.</Text>
        <Button size="sm" variant="outline" onClick={() => edit.discardNode(node.id)}>
          Undo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Command</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {currentCommand}
          </Badge>
          {pendingRename ? <Badge variant="warning">Rename staged</Badge> : null}
          <Button size="sm" variant="outline" onClick={() => setRenameOpen(true)}>
            <Pencil aria-hidden /> Rename
          </Button>
        </div>
      </div>

      <Button
        variant="destructive"
        size="sm"
        className="self-start"
        onClick={() => setDeleteConfirming(true)}
      >
        <Trash2 aria-hidden /> Delete command
      </Button>

      <CommandDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        mode="rename"
        initialCommand={currentCommand}
        existingCommands={otherCommands}
        onSubmit={({ command }) => edit.addOp({ op: "rename_command", nodeId: node.id, command })}
      />

      <AlertDialog open={deleteConfirming} onOpenChange={setDeleteConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{currentCommand}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This stages removal of the whole command flow
              {flowSections.length > 0
                ? ` and its ${flowSections.length} section${flowSections.length === 1 ? "" : "s"}`
                : ""}{" "}
              from `SKILL.md`. Shared assets and other flows are untouched. Nothing is deleted until
              you save — you can undo this before then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {flowSections.length > 0 ? (
            <ul className="max-h-40 list-disc overflow-y-auto pl-5">
              {flowSections.map((label, index) => (
                <li key={`${label}-${index}`}>
                  <Text variant="meta" as="span" className="break-words">
                    {label}
                  </Text>
                </li>
              ))}
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                edit.discardNode(node.id);
                edit.addOp({ op: "delete_command", nodeId: node.id });
                setDeleteConfirming(false);
              }}
            >
              Delete command
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Skill IDE WP 8.3 — the `tool_ref` node's detail card: the referenced tool's SCAN data (owning
 * server, description, schema params, definition token cost) from the bound-tools list, plus its
 * validation-overlay state. The honest minimum is RESOLVED vs UNBOUND from the bindings alone: a
 * `tool_ref` whose name is exposed by a bound + scanned server is "resolved" (the card shows its scan
 * data, a deep link to the server's tools page, and an OPTIONAL test-run action); one that isn't is
 * "unbound" (no scan data — bind/scan the server). The WP 5.1 diagnostics may later enrich this to
 * ok/stale/unknown, but resolved/unbound never lies. Read-only — never opens a connection.
 */
function ToolRefCard({
  node,
  boundTools,
  onTestTool,
}: {
  node: Extract<SkillGraphNode, { kind: "tool_ref" }>;
  boundTools: BoundTool[];
  onTestTool?: (tool: BoundTool) => void;
}) {
  const match = useMemo(
    () =>
      boundTools.find(
        (tool) =>
          tool.toolName === node.toolName &&
          (node.serverName === undefined || tool.serverName === node.serverName),
      ),
    [boundTools, node.toolName, node.serverName],
  );

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-sm" title={node.toolName}>
          {node.toolName}
        </span>
        {match ? (
          <Badge variant="secondary">Resolved</Badge>
        ) : (
          <Badge variant="warning">Unbound</Badge>
        )}
      </div>

      {match ? (
        <>
          <Descriptions columns={1} layout="horizontal">
            <DescriptionsItem label="Server">{match.serverName}</DescriptionsItem>
            {match.description ? (
              <DescriptionsItem label="Description">
                <span className="break-words">{match.description}</span>
              </DescriptionsItem>
            ) : null}
            <DescriptionsItem label="Definition cost" numeric>
              <span className="tabular-nums">{match.definitionTokens.toLocaleString()} tokens</span>
            </DescriptionsItem>
          </Descriptions>

          <div className="flex flex-col gap-1">
            <Text variant="caption" tone="muted">
              Parameters
            </Text>
            {match.schemaParams.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {match.schemaParams.map((param) => (
                  <li key={param.name} className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-xs break-words">{param.name}</span>
                    <Text variant="meta" tone="muted" as="span">
                      {param.type}
                      {param.required ? " · required" : ""}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : (
              <Text variant="meta" tone="muted">
                No parameters.
              </Text>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/servers/${match.serverId}`}>
                <ExternalLink aria-hidden /> Open server tools
              </Link>
            </Button>
            {/* WP 8.5 injects `onTestTool`; hidden until then (no dead control). */}
            {onTestTool ? (
              <Button size="sm" onClick={() => onTestTool(match)}>
                <Play aria-hidden /> Test run
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Text variant="meta" tone="muted">
            No bound, scanned server exposes “{node.toolName}”
            {node.serverName ? ` for “${node.serverName}”` : ""}. Bind the skill to the server that
            provides it (frontmatter `servers:`) and run a scan to see its schema, cost, and a test
            run.
          </Text>
          {/* WP 8.5 — the affordance stays visible but DISABLED when the binding is unresolved, with the
              reason, so a test run is never a broken run. Only rendered once WP 8.5 wires `onTestTool`. */}
          {onTestTool ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block self-start">
                  <Button size="sm" disabled aria-disabled>
                    <Play aria-hidden /> Test run
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Bind the skill to the server that provides this tool and run a scan — then it can be
                test-run here.
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/**
 * The Design tab's detail panel (WP 1.3, edit mode added in WP 4.2): `@brand/flow`'s `InspectorPanel`
 * shell, the selected node's kind/label/source, its kind-specific fields, its in/out edges, and the
 * anchored `SKILL.md` excerpt. In edit mode, section nodes ALSO get a rename field, an editable body,
 * an annotation control, and a remove button; validation gates get an editable expectation; edges
 * with a condition get an inline editable condition. Renders the panel's own empty-state hint when
 * nothing is selected — never a bespoke empty panel.
 */
export function NodeDetailPanel({
  skillId,
  versionId,
  graph,
  selectedNodeId,
  editMode,
  edit,
  previewOnlyLabel,
  boundTools,
  onRegisterInsert,
  onTestTool,
  width,
}: NodeDetailPanelProps) {
  const node = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId),
    [graph.nodes, selectedNodeId],
  );

  const [skillMdText, setSkillMdText] = useState<string | null>(null);
  const [skillMdError, setSkillMdError] = useState<string | null>(null);
  // WP 5.2 — the version's tool-reference diagnostics (read-only over persisted scans), fetched once
  // per (skillId, versionId). Drives the body-editor markers + the per-node issue list. A failure
  // degrades to "no diagnostics" (silent — this is an advisory overlay, not a load-blocking error).
  const [diagnostics, setDiagnostics] = useState<ToolDiagnostic[]>([]);
  // WP 8.2/8.3 — the bound servers' tools (Monaco completion/hover in the body editor + the tool_ref
  // detail card) are now fetched ONCE at the Design view and passed in as `boundTools`.

  // Fetched once per (skillId, versionId) — shared by the read-only excerpt AND the edit-mode body
  // editor, and NOT refetched on every node selection (deps below deliberately omit the node).
  useEffect(() => {
    let cancelled = false;
    setSkillMdText(null);
    setSkillMdError(null);
    getSkillFile(skillId, versionId, "SKILL.md")
      .then((content) => {
        if (!cancelled) setSkillMdText(content.isBinary ? "" : content.text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSkillMdError(getErrorMessage(err, "Couldn’t load SKILL.md"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  useEffect(() => {
    let cancelled = false;
    setDiagnostics([]);
    getToolDiagnostics(skillId, versionId)
      .then((report) => {
        if (!cancelled) setDiagnostics(report.diagnostics);
      })
      .catch(() => {
        if (!cancelled) setDiagnostics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const incoming: SkillGraphEdge[] = useMemo(
    () => (node ? graph.edges.filter((e) => e.to === node.id) : []),
    [graph.edges, node],
  );
  const outgoing: SkillGraphEdge[] = useMemo(
    () => (node ? graph.edges.filter((e) => e.from === node.id) : []),
    [graph.edges, node],
  );

  const meta = node ? NODE_KIND_META[node.kind] : undefined;
  const pendingCount = node && edit ? edit.opsForNode(node.id).length : 0;

  if (!node && previewOnlyLabel) {
    return (
      <InspectorPanel
        title="Node details"
        hasSelection
        selectionKey={selectedNodeId}
        emptyMessage="Select a node on the canvas to see its anchored SKILL.md excerpt and details."
        width={width}
      >
        <div className="flex flex-col gap-3">
          <Badge variant="outline">New section · preview</Badge>
          <Heading level={4} className="break-words">
            {previewOnlyLabel}
          </Heading>
          <Text variant="meta" tone="muted">
            This section only exists in the local preview — save this version to select and edit it
            further.
          </Text>
        </div>
      </InspectorPanel>
    );
  }

  return (
    <InspectorPanel
      title="Node details"
      hasSelection={!!node}
      selectionKey={node?.id}
      emptyMessage="Select a node on the canvas to see its anchored SKILL.md excerpt and details."
      width={width}
    >
      {node ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{meta?.label ?? node.kind}</Badge>
            <Badge variant="outline">
              {node.source === "annotated" ? "Annotated" : "Inferred"}
            </Badge>
            {pendingCount > 0 ? (
              <Badge variant="warning">
                {pendingCount} pending edit{pendingCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
          <Heading level={4} className="break-words">
            {node.label}
          </Heading>

          <KindFields node={node} />

          <WhatIsThis kind={node.kind} />

          {node.kind === "tool_ref" ? (
            <ToolRefCard node={node} boundTools={boundTools} onTestTool={onTestTool} />
          ) : null}

          <NodeDiagnosticsList node={node} diagnostics={diagnostics} />

          {editMode && edit ? (
            <div className="flex flex-col gap-4 rounded-lg border border-dashed border-border p-3">
              {isCommandEntry(node) ? (
                <EntryPointCommandEditor node={node} graph={graph} edit={edit} />
              ) : (
                <>
                  {isSectionNode(node) ? <RenameEditor node={node} edit={edit} /> : null}
                  {node.kind === "validation_gate" ? (
                    <GateExpectationEditor node={node} edit={edit} />
                  ) : null}
                  {isSectionNode(node) ? <AnnotationEditor node={node} edit={edit} /> : null}
                  {isSectionNode(node) && skillMdText !== null ? (
                    <ValidationScopeEditor graph={graph} text={skillMdText} edit={edit} />
                  ) : null}
                  {isSectionNode(node) ? (
                    skillMdError ? (
                      <StatePanel
                        kind="error"
                        title="Couldn’t load SKILL.md — refresh the page to try again."
                        description={skillMdError}
                        size="sm"
                      />
                    ) : skillMdText === null ? (
                      <StatePanel
                        kind="loading"
                        title="Loading…"
                        loadingLabel="Loading body…"
                        size="sm"
                      />
                    ) : (
                      <SectionBodyEditor
                        text={skillMdText}
                        node={node}
                        diagnostics={diagnostics}
                        boundTools={boundTools}
                        edit={edit}
                        onRegisterInsert={onRegisterInsert}
                        onTestTool={onTestTool}
                      />
                    )
                  ) : null}
                  <RemoveNodeControl
                    node={node}
                    ownerLabel={
                      incoming[0]
                        ? (nodesById.get(incoming[0].from)?.label ?? undefined)
                        : undefined
                    }
                    edit={edit}
                  />
                </>
              )}
            </div>
          ) : null}

          {(incoming.length > 0 || outgoing.length > 0) && (
            <div className="flex flex-col gap-2">
              <Text variant="caption" tone="muted">
                Edges
              </Text>
              <ul className="flex flex-col gap-2">
                {incoming.map((edgeItem) => (
                  <EdgeRow
                    key={edgeItem.id}
                    arrow="←"
                    label={nodesById.get(edgeItem.from)?.label ?? edgeItem.from}
                    edge={edgeItem}
                    editMode={editMode}
                    edit={edit}
                  />
                ))}
                {outgoing.map((edgeItem) => (
                  <EdgeRow
                    key={edgeItem.id}
                    arrow="→"
                    label={nodesById.get(edgeItem.to)?.label ?? edgeItem.to}
                    edge={edgeItem}
                    editMode={editMode}
                    edit={edit}
                  />
                ))}
              </ul>
            </div>
          )}

          {!editMode ? (
            <div className="flex flex-col gap-2">
              <Text variant="caption" tone="muted">
                SKILL.md excerpt · lines {node.anchor.startLine}–{node.anchor.endLine}
              </Text>
              {skillMdError ? (
                <StatePanel
                  kind="error"
                  title="Couldn’t load SKILL.md — refresh the page to try again."
                  description={skillMdError}
                  size="sm"
                />
              ) : skillMdText === null ? (
                <StatePanel
                  kind="loading"
                  title="Loading…"
                  loadingLabel="Loading excerpt…"
                  size="sm"
                />
              ) : (
                <AnchoredExcerpt text={skillMdText} node={node} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </InspectorPanel>
  );
}
