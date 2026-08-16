import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BoundTool,
  SkillDiff,
  SkillFileNode,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  ResizableHandle,
  ResizablePanel,
  Spinner,
  StatePanel,
  Text,
} from "@brand/ui";
import { Save, Undo2 } from "lucide-react";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { InlineError } from "../../components/InlineError";
import { DiscardChangesDialog } from "../../components/UnsavedChangesGuard";
import { getErrorMessage } from "../../lib/errors";
import { SkillBindingsPanel } from "./SkillBindingsPanel";
import { getSkillFiles, getSkillVersion } from "./skills-inspector-api";
import { WorkspaceEditor } from "./workspace/WorkspaceEditor";
import { WorkspaceTree } from "./workspace/WorkspaceTree";
import { DeleteDialog, MoveDialog, NameDialog, UploadDialog } from "./workspace/WorkspaceDialogs";
import { SaveWorkspaceDialog } from "./workspace/SaveWorkspaceDialog";
import { useWorkspace } from "./workspace/use-workspace";
import { baseNameOf, collectFolders } from "./workspace/workspace-model";
import { notifyError } from "../../lib/notify";

// ── name-dialog modes ────────────────────────────────────────────────────────────────────────────
type NameMode =
  | { kind: "new-file"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename-file"; path: string }
  | { kind: "rename-folder"; path: string };

/** Choose a sensible initial selection: SKILL.md, else the first text file, else the first file. */
function defaultSelection(files: SkillFileNode[]): string | undefined {
  return (
    files.find((f) => f.isSkillMd)?.path ?? files.find((f) => !f.isBinary)?.path ?? files[0]?.path
  );
}

export type SkillFileExplorerProps = {
  skillId: string;
  versionId: string;
  files: SkillFileNode[];
  /**
   * Whether `versionId` is the skill's CURRENT (head) version — threaded from the inspector so the
   * bindings strip knows whether its chips are editable (bindings save from the head only).
   */
  isHeadVersion: boolean;
  /**
   * Called with the NEW version's id right after the workspace saves (WP 4.3 — closes the WP 3.2
   * follow-up). The workspace re-bases itself onto the new version locally, but it can't drive the
   * inspector's version picker (that's the parent's state); this lets the parent refetch the skill +
   * version list and switch the active selection, so the picker stops naming the previous version.
   */
  onVersionSaved?: (newVersionId: string) => void;
  /** Skill IDE WP 8.5 — open the inline tool-runner Sheet for an ALREADY-RESOLVED bound tool. Threaded
   *  to the SKILL.md editor's hover "Test this tool…" command-link (via {@link WorkspaceEditor}). */
  onTestTool?: (tool: BoundTool) => void;
};

/**
 * Files tab (Skill IDE WP 3.2): a file-manager WORKSPACE. The left pane is an interactive tree with a
 * selection toolbar (new file/folder, upload, rename, move, delete); the right pane edits resource text
 * files in Monaco (binary files are view-only; SKILL.md is a READ-ONLY preview — K8, authoring lives on
 * the Design tab). Every change is staged in an in-memory working tree and saved as ONE new immutable
 * version via the existing edits route (mixed tree-op batch → `createVersion`) — a single dirty indicator.
 *
 * Self-contained: it fetches the version's `treeSha` (needed as the edits `baseTreeSha`) and, after a
 * save, RE-BASES itself onto the new version (refetches its file list). It receives redacted data only
 * and never touches secrets/MCP. Note: it can't drive the inspector's version picker (that's the
 * parent's state), so after a save the picker still names the previous version until the parent
 * reloads — the workspace itself correctly reflects the new version.
 */
export function SkillFileExplorer({
  skillId,
  versionId,
  files,
  isHeadVersion,
  onVersionSaved,
  onTestTool,
}: SkillFileExplorerProps) {
  // The base the workspace edits against — starts at the prop version, and advances after each save.
  const [baseVersionId, setBaseVersionId] = useState(versionId);
  const [baseFiles, setBaseFiles] = useState<SkillFileNode[]>(files);
  const [baseTreeSha, setBaseTreeSha] = useState<string | null>(null);
  const [treeShaError, setTreeShaError] = useState<string | null>(null);

  const ws = useWorkspace(baseFiles);

  const [selectedId, setSelectedId] = useState<string | undefined>(() => defaultSelection(files));
  const [selectedIsFolder, setSelectedIsFolder] = useState(false);

  // Dialog state.
  const [nameMode, setNameMode] = useState<NameMode | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ path: string; isFolder: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    path: string;
    isFolder: boolean;
    fileCount: number;
  } | null>(null);
  const [uploadDir, setUploadDir] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // When the parent switches versions, re-base onto the new prop version and reset selection.
  useEffect(() => {
    setBaseVersionId(versionId);
    setBaseFiles(files);
    setSelectedId(defaultSelection(files));
    setSelectedIsFolder(false);
  }, [versionId, files]);

  // Fetch the base version's `treeSha` (the edits route needs it as `baseTreeSha`).
  const loadTreeSha = useCallback(async () => {
    setTreeShaError(null);
    const version = await getSkillVersion(skillId, baseVersionId);
    setBaseTreeSha(version.treeSha);
  }, [skillId, baseVersionId]);

  useEffect(() => {
    let cancelled = false;
    setBaseTreeSha(null);
    loadTreeSha().catch((err: unknown) => {
      if (!cancelled) setTreeShaError(getErrorMessage(err, "Couldn’t load version metadata"));
    });
    return () => {
      cancelled = true;
    };
  }, [loadTreeSha]);

  // Warn on a hard browser unload while there are unsaved working-tree changes.
  useEffect(() => {
    if (!ws.dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [ws.dirty]);

  const allFolders = useMemo(
    () => [...collectFolders(ws.entries, ws.emptyFolders)].sort(),
    [ws.entries, ws.emptyFolders],
  );

  const selectedEntry = selectedId && !selectedIsFolder ? ws.entryByPath(selectedId) : undefined;

  // Keep the selection valid as the tree changes (a deleted/renamed selection falls back to a file).
  useEffect(() => {
    if (selectedId === undefined) return;
    const stillValid = selectedIsFolder
      ? collectFolders(ws.entries, ws.emptyFolders).has(selectedId)
      : ws.entryByPath(selectedId) !== undefined;
    if (!stillValid) {
      const fallback =
        ws.entries.find((e) => e.path === "SKILL.md")?.path ??
        ws.entries.find((e) => !e.isBinary)?.path ??
        ws.entries[0]?.path;
      setSelectedId(fallback);
      setSelectedIsFolder(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.entries, ws.emptyFolders]);

  // ── action wiring (toolbar → dialogs → workspace mutations) ──────────────────────────────────

  const applyName = useCallback(
    (name: string): string | null => {
      if (!nameMode) return null;
      switch (nameMode.kind) {
        case "new-file": {
          const err = ws.addFile(nameMode.dir, name);
          if (!err) {
            const path = nameMode.dir ? `${nameMode.dir}/${name.trim()}` : name.trim();
            setSelectedId(path);
            setSelectedIsFolder(false);
          }
          return err;
        }
        case "new-folder": {
          const err = ws.addFolder(nameMode.dir, name);
          if (!err) {
            const path = nameMode.dir ? `${nameMode.dir}/${name.trim()}` : name.trim();
            setSelectedId(path);
            setSelectedIsFolder(true);
          }
          return err;
        }
        case "rename-file": {
          const err = ws.renameFile(nameMode.path, name);
          if (!err) {
            const path = dirName(nameMode.path, name.trim());
            setSelectedId(path);
            setSelectedIsFolder(false);
          }
          return err;
        }
        case "rename-folder": {
          const err = ws.renameFolder(nameMode.path, name);
          if (!err) {
            const path = dirName(nameMode.path, name.trim());
            setSelectedId(path);
            setSelectedIsFolder(true);
          }
          return err;
        }
      }
    },
    [nameMode, ws],
  );

  const applyMove = useCallback(
    (newDir: string): string | null => {
      if (!moveTarget) return null;
      const err = moveTarget.isFolder
        ? ws.moveFolder(moveTarget.path, newDir)
        : ws.moveFile(moveTarget.path, newDir);
      if (!err) {
        const path = newDir
          ? `${newDir}/${baseNameOf(moveTarget.path)}`
          : baseNameOf(moveTarget.path);
        setSelectedId(path);
        setSelectedIsFolder(moveTarget.isFolder);
      }
      return err;
    },
    [moveTarget, ws],
  );

  const onDelete = useCallback(
    (path: string, isFolder: boolean) => {
      const fileCount = isFolder
        ? ws.entries.filter((e) => e.path === path || e.path.startsWith(`${path}/`)).length
        : 0;
      setDeleteTarget({ path, isFolder, fileCount });
    },
    [ws.entries],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.isFolder) ws.deleteFolder(deleteTarget.path);
    else ws.deleteFile(deleteTarget.path);
    if (selectedId === deleteTarget.path || selectedId?.startsWith(`${deleteTarget.path}/`)) {
      setSelectedId(undefined);
      setSelectedIsFolder(false);
    }
  }, [deleteTarget, ws, selectedId]);

  const handleSaved = useCallback(
    async (version: SkillVersion, _diff: SkillDiff) => {
      setBaseVersionId(version.id);
      setBaseTreeSha(version.treeSha);
      try {
        const newFiles = await getSkillFiles(skillId, version.id);
        setBaseFiles(newFiles);
        setSelectedId(defaultSelection(newFiles));
        setSelectedIsFolder(false);
      } catch (err) {
        notifyError("Saved, but couldn’t reload files", {
          description: getErrorMessage(err, "Reopen the Files tab to see the new version."),
        });
      }
      // Let the inspector refetch the skill + version list and point its picker at the new version
      // (WP 3.2 follow-up). The parent then re-passes fresh `versionId`/`files`, re-basing this
      // workspace onto the same version — harmless, and it keeps the header picker in sync.
      onVersionSaved?.(version.id);
    },
    [skillId, onVersionSaved],
  );

  const confirmDiscard = useCallback(() => {
    ws.reset(baseFiles);
    setSelectedId(defaultSelection(baseFiles));
    setSelectedIsFolder(false);
    setDiscardOpen(false);
  }, [ws, baseFiles]);

  if (treeShaError) {
    return (
      <InlineError
        title="Couldn’t load the version"
        detail={treeShaError}
        onRetry={() => void loadTreeSha()}
      />
    );
  }

  const dialogContextDir = nameMode && "dir" in nameMode ? nameMode.dir : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Save / discard bar */}
      <Card className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {ws.dirty ? (
            <Badge variant="warning">
              {ws.ops.length} unsaved {ws.ops.length === 1 ? "change" : "changes"}
            </Badge>
          ) : (
            <Text variant="meta" tone="muted">
              No unsaved changes
            </Text>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDiscardOpen(true)}
            disabled={!ws.dirty}
          >
            <Undo2 className="size-4" /> Discard
          </Button>
          <Button
            size="sm"
            onClick={() => setSaveOpen(true)}
            disabled={!ws.dirty || baseTreeSha === null}
          >
            {baseTreeSha === null ? <Spinner className="size-4" /> : <Save className="size-4" />}{" "}
            Save…
          </Button>
        </div>
      </Card>

      {/* Server bindings — the SAME binding surface as Overview, kept compact. Unavailable while the
          workspace has unsaved file edits: a bind/unbind forks a new version FROM the committed
          SKILL.md, which must not race the workspace's own save (mirrors the palette's editor-dirty
          guard). It targets the workspace's current base version. */}
      <Card className="shrink-0 px-3 py-2">
        <SkillBindingsPanel
          skillId={skillId}
          versionId={baseVersionId}
          isHeadVersion={isHeadVersion}
          blockedReason={
            ws.dirty ? "Save or discard your file edits first — binding saves a new version." : null
          }
          onVersionSaved={(id) => onVersionSaved?.(id)}
        />
      </Card>

      <AdaptivePanelGroup className="min-h-0 flex-1 rounded-lg border border-border">
        <ResizablePanel defaultSize={32} minSize={20}>
          <WorkspaceTree
            entries={ws.entries}
            emptyFolders={ws.emptyFolders}
            selectedId={selectedId}
            onSelect={(id, isFolder) => {
              setSelectedId(id);
              setSelectedIsFolder(isFolder);
            }}
            onNewFile={(dir) => setNameMode({ kind: "new-file", dir })}
            onNewFolder={(dir) => setNameMode({ kind: "new-folder", dir })}
            onUpload={(dir) => setUploadDir(dir)}
            onRename={(path, isFolder) =>
              setNameMode(
                isFolder ? { kind: "rename-folder", path } : { kind: "rename-file", path },
              )
            }
            onMove={(path, isFolder) => setMoveTarget({ path, isFolder })}
            onDelete={onDelete}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={68} minSize={35}>
          <div className="flex h-full min-h-0 flex-col">
            {selectedEntry ? (
              // O1/O2 (2026-07-06 owner): Files is the single editor. EVERY text file — including
              // SKILL.md — opens editable in the same Monaco `WorkspaceEditor` (SKILL.md additionally
              // gets bound-tool completions/hovers + tool-validation markers). Edits stage into the one
              // working tree (multi-file draft) and save as ONE new version. The old read-only SKILL.md
              // preview + "Edit in Design" affordance are gone (Design tab hidden per O2b).
              <WorkspaceEditor
                key={selectedEntry.id}
                skillId={skillId}
                versionId={baseVersionId}
                entry={selectedEntry}
                onHydrate={ws.hydrate}
                onEdit={ws.setText}
                onTestTool={onTestTool}
              />
            ) : selectedIsFolder ? (
              <StatePanel
                kind="empty"
                title={selectedId || "Folder"}
                description="Folder selected. Use the toolbar to add a file here, or pick a file to edit."
              />
            ) : (
              <StatePanel
                kind="empty"
                title="No file selected"
                description="Pick a file from the tree to edit it."
              />
            )}
          </div>
        </ResizablePanel>
      </AdaptivePanelGroup>

      {/* Dialogs */}
      <NameDialog
        open={nameMode !== null}
        onOpenChange={(open) => !open && setNameMode(null)}
        title={nameDialogTitle(nameMode)}
        label={
          nameMode?.kind === "new-folder" || nameMode?.kind === "rename-folder"
            ? "Folder name"
            : "File name"
        }
        contextPath={dialogContextDir}
        initialValue={nameMode && "path" in nameMode ? baseNameOf(nameMode.path) : ""}
        submitLabel={nameMode?.kind.startsWith("rename") ? "Rename" : "Create"}
        placeholder={nameMode?.kind === "new-file" ? "notes.md…" : "name…"}
        onSubmit={applyName}
      />

      {moveTarget ? (
        <MoveDialog
          open
          onOpenChange={(open) => !open && setMoveTarget(null)}
          sourcePath={moveTarget.path}
          isFolder={moveTarget.isFolder}
          folderOptions={allFolders}
          onSubmit={applyMove}
        />
      ) : null}

      {uploadDir !== null ? (
        <UploadDialog
          open
          onOpenChange={(open) => !open && setUploadDir(null)}
          destination={uploadDir}
          onSubmit={(uploads) => ws.addUploads(uploadDir, uploads)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          path={deleteTarget.path}
          isFolder={deleteTarget.isFolder}
          fileCount={deleteTarget.fileCount}
          onConfirm={confirmDelete}
        />
      ) : null}

      {baseTreeSha !== null ? (
        <SaveWorkspaceDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          skillId={skillId}
          versionId={baseVersionId}
          baseTreeSha={baseTreeSha}
          ops={ws.ops}
          emptyFolders={ws.emptyFolders}
          onSaved={handleSaved}
          onReload={loadTreeSha}
        />
      ) : null}

      <DiscardChangesDialog
        open={discardOpen}
        onConfirm={confirmDiscard}
        onCancel={() => setDiscardOpen(false)}
      />
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────────────────────

function nameDialogTitle(mode: NameMode | null): string {
  switch (mode?.kind) {
    case "new-file":
      return "New file";
    case "new-folder":
      return "New folder";
    case "rename-file":
      return "Rename file";
    case "rename-folder":
      return "Rename folder";
    default:
      return "";
  }
}

/** Re-home a path's final segment onto a new name, keeping its directory prefix. */
function dirName(path: string, name: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? name : `${path.slice(0, idx)}/${name}`;
}
