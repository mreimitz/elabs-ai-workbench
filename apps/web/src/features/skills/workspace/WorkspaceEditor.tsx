import { useEffect, useMemo, useRef, useState } from "react";
import type { BoundTool, ToolDiagnostic } from "@mcp-token-footprint/shared";
import { Badge, Button, StatePanel, Text } from "@elabs-ai/components-ui";
import { CodeEditor, type CodeEditorProps } from "@elabs-ai/components-editor";
import { Download, FileWarning } from "lucide-react";
import { getErrorMessage } from "../../../lib/errors";
import { formatBytes } from "../../../lib/format";
import { READ_ONLY_OPTIONS, extOf, languageFor } from "../../../lib/monaco";
import {
  formatToolDiagnosticMessage,
  getSkillFile,
  getToolDiagnostics,
  skillRawUrl,
} from "../skills-inspector-api";
import { registerBoundToolProviders, useBoundTools } from "../use-bound-tools";
import type { WorkEntry } from "./workspace-model";
import { isContentDirty } from "./workspace-model";

// Editable Monaco options: the shared read-only baseline with `readOnly` lifted (folding/search, no
// minimap, soft-wrap). Defined here — not in lib/monaco.ts — since editing is this WP's surface.
const EDITABLE_OPTIONS = { ...READ_ONLY_OPTIONS, readOnly: false };

// Skill IDE WP 5.2 — Monaco marker plumbing for the SKILL.md file view ONLY. Deriving the two
// `onMount` param types off the `CodeEditor` prop avoids a direct `monaco-editor` import. All markers
// use this single owner so a re-validate / file switch / unmount clears exactly its own markers.
type CodeEditorMount = NonNullable<CodeEditorProps["onMount"]>;
type MonacoEditor = Parameters<CodeEditorMount>[0];
type MonacoApi = Parameters<CodeEditorMount>[1];
const TOOL_VALIDATION_MARKER_OWNER = "tool-validation";
/** The one file whose backticked tool references WP 5.1 validates — markers are for it alone. */
const SKILL_MD_PATH = "SKILL.md";

function isMarkdown(path: string): boolean {
  const ext = extOf(path);
  return ext === "md" || ext === "markdown";
}

function languageOf(path: string): string {
  return isMarkdown(path) ? "markdown" : languageFor(path);
}

export type WorkspaceEditorProps = {
  skillId: string;
  versionId: string;
  entry: WorkEntry;
  /** Seed a base file's fetched content into the working tree (first open, for the dirty compare). */
  onHydrate: (path: string, text: string) => void;
  /** Record an in-editor edit. */
  onEdit: (path: string, text: string) => void;
  /** Skill IDE WP 8.5 — when set, the SKILL.md hover popup's "Test this tool…" command-link opens the
   *  runner Sheet (only meaningful for the SKILL.md editor, where tool references live). */
  onTestTool?: (tool: BoundTool) => void;
};

/**
 * The workspace's right pane (WP 3.2): text files open in an EDITABLE Monaco `CodeEditor`; binary
 * files are view-only (download for a base file, a size note for a freshly uploaded one). A base text
 * file's content is fetched once and hydrated into the working tree so edits can be diffed against it;
 * an added file renders its in-memory draft directly. Keyed by `entry.id` upstream, so switching files
 * gives a fresh editor instance (no cross-file undo bleed).
 */
export function WorkspaceEditor({
  skillId,
  versionId,
  entry,
  onHydrate,
  onEdit,
  onTestTool,
}: WorkspaceEditorProps) {
  const isAdded = entry.originalPath === null;
  const needsFetch = !isAdded && !entry.isBinary && entry.baseText === undefined;
  // WP 5.2 — mark tool-reference diagnostics only in the SKILL.md editor (WP 5.1 validates SKILL.md's
  // references; other files carry none). This entry is SKILL.md when its (real) path is `SKILL.md`.
  const isSkillMd = entry.path === SKILL_MD_PATH;

  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(needsFetch);
  const [diagnostics, setDiagnostics] = useState<ToolDiagnostic[]>([]);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const [mounted, setMounted] = useState(false);
  // WP 8.2 — bound-tool completion/hover, SKILL.md only (the file where tool references live). Fetched
  // only for SKILL.md; unbound skill ⇒ `[]` ⇒ no providers. Read-only over persisted scans.
  const { boundTools } = useBoundTools(skillId, versionId, isSkillMd);

  // Fetch + hydrate a base text file's content the first time it opens (once per entry.id remount).
  useEffect(() => {
    if (!needsFetch) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    setError(null);
    // The base file lives under its ORIGINAL path in the stored version.
    getSkillFile(skillId, versionId, entry.originalPath as string)
      .then((content) => {
        if (cancelled) return;
        if (content.isBinary) {
          // Server metadata says text but content came back binary — treat as unreadable text.
          setError("This file is not editable as text.");
        } else {
          onHydrate(entry.path, content.text);
        }
        setFetching(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(err, "Couldn’t load file"));
        setFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // WP 5.2 — fetch the version's tool-reference diagnostics only for the SKILL.md file. Read-only over
  // persisted scans (no MCP call); a failure degrades to "no markers" (advisory overlay, not blocking).
  useEffect(() => {
    if (!isSkillMd) {
      setDiagnostics([]);
      return;
    }
    let cancelled = false;
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
  }, [skillId, versionId, isSkillMd]);

  // A diagnostic's `anchor.startLine` is a 1-based SKILL.md line — this editor shows the whole file, so
  // it maps straight onto the Monaco line. Set on mount + on every re-validate; the cleanup clears THIS
  // owner's markers (dispose invariant) before each re-set and on unmount / file switch.
  const skillMdDiagnostics = useMemo(
    () => (isSkillMd ? diagnostics : []),
    [isSkillMd, diagnostics],
  );
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = skillMdDiagnostics
      .filter((diagnostic) => diagnostic.anchor !== undefined)
      .map((diagnostic) => {
        const line = Math.min(Math.max(diagnostic.anchor?.startLine ?? 1, 1), model.getLineCount());
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
  }, [skillMdDiagnostics, mounted]);

  // WP 8.2 — register the bound-tool completion + hover providers for the SKILL.md editor ONCE per
  // mount (scoped to THIS model), disposing on unmount / when the tool set changes. `isSkillMd` gates
  // it (other files carry no tool references); an unbound skill registers nothing (honest degradation).
  // WP 8.5 — `onTestTool` (when provided) adds the hover's "Test this tool…" command-link.
  useEffect(() => {
    const editor = editorRef.current;
    const monacoApi = monacoRef.current;
    if (!editor || !monacoApi || !isSkillMd || boundTools.length === 0) return;
    const providers = registerBoundToolProviders(
      monacoApi,
      editor,
      boundTools,
      onTestTool ? { onTestTool } : {},
    );
    return () => providers.dispose();
  }, [boundTools, isSkillMd, mounted, onTestTool]);

  // Binary → view-only. A base binary can be downloaded from the stored version; a freshly uploaded
  // binary has no server URL yet (it's saved on the next version), so just note its presence.
  if (entry.isBinary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <FileWarning className="size-10 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <Text>Binary file — view only</Text>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {isAdded ? "New file · saved on the next version" : formatBytes(entry.base?.size ?? 0)}
          </Text>
        </div>
        {!isAdded ? (
          <Button asChild variant="outline" size="sm">
            <a href={skillRawUrl(skillId, versionId, entry.originalPath as string)} download>
              <Download className="size-4" /> Download
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load file — select another file, then reselect this one to try again."
        description={error}
      />
    );
  }
  if (fetching || entry.text === undefined) {
    return <StatePanel kind="loading" title="Loading…" loadingLabel="Loading file…" />;
  }

  const dirty = isAdded || isContentDirty(entry);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* O3 — same `h-11` as the file-tree toolbar so the two column headers align exactly. */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          {isAdded ? (
            <Badge variant="secondary">New</Badge>
          ) : dirty ? (
            <Badge variant="warning">Modified</Badge>
          ) : null}
          <Text variant="meta" tone="muted" className="truncate font-mono">
            {entry.path}
          </Text>
        </div>
        <Text variant="meta" tone="muted" className="shrink-0">
          Editing — save as a new version to persist
        </Text>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeEditor
          key={entry.id}
          value={entry.text}
          language={languageOf(entry.path)}
          path={entry.path}
          readOnly={false}
          height="100%"
          ariaLabel={`Editing ${entry.path}`}
          options={EDITABLE_OPTIONS}
          onChange={(value) => onEdit(entry.path, value)}
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
