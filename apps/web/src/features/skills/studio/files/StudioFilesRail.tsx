import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudioDraft } from "../draft";
import { WorkspaceTree } from "../../workspace/WorkspaceTree";
import {
  DeleteDialog,
  MoveDialog,
  NameDialog,
  UploadDialog,
} from "../../workspace/WorkspaceDialogs";
import { baseNameOf, collectFolders, dirOf, joinPath } from "../../workspace/workspace-model";

// ── Skill Studio (RM-30 WP 7.4) — the Files rail, now EDITABLE ─────────────────────────────────────
// WP 7.1 mounted the workspace tree here `readOnly`, because the Studio had nowhere to stage a file
// change. It does now: every mutation below writes the Studio's ONE draft (`draft.files`), so a new
// file, a rename and a hand-typed edit to SKILL.md are the same unsaved change, with the same count
// and the same "Save as vN" button — one new immutable version, never one per file.
//
// The dialogs are the workspace's own (`workspace/WorkspaceDialogs.tsx`), reused verbatim: they
// already validate a path segment before composing an op, so the rail cannot compose a batch the
// save route would reject. Nothing here is applied to the stored version until the author saves.

type NameMode =
  | { kind: "new-file"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename-file"; path: string }
  | { kind: "rename-folder"; path: string };

export type StudioFilesRailProps = {
  /** The file the centre surface has open — the Studio's `?file=` param. `undefined` when the
   *  Designer is showing: the Designer is not a file, so NOTHING in the tree is selected, and the
   *  rename/move/delete controls are correctly disabled rather than aimed at a path that is not a
   *  file. */
  selectedFile: string | undefined;
  /** Open a file in the centre surface (and, for anything but the manifest, as an editor tab). */
  onSelectFile: (path: string) => void;
  /** A path (a file, or a folder and everything under it) moved — the caller re-homes its open tabs
   *  and, when the file it was showing was inside, the `?file=` param. */
  onPathMoved: (from: string, to: string) => void;
};

export function StudioFilesRail({ selectedFile, onSelectFile, onPathMoved }: StudioFilesRailProps) {
  const draft = useStudioDraft();
  const files = draft.files;

  // A FOLDER selection is rail-local: it never goes in the URL (a folder isn't something the centre
  // surface can open), but the tree's toolbar needs it to know where "New file" should land. A file
  // selection is the URL's `?file=`, so the two are kept in one derived value with the folder
  // winning only until the open file changes underneath it.
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  useEffect(() => {
    setSelectedFolder(null);
  }, [selectedFile]);
  const selectedId = selectedFolder ?? selectedFile;

  const [nameMode, setNameMode] = useState<NameMode | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ path: string; isFolder: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    path: string;
    isFolder: boolean;
    fileCount: number;
  } | null>(null);
  const [uploadDir, setUploadDir] = useState<string | null>(null);

  const allFolders = useMemo(
    () => [...collectFolders(files.entries, files.emptyFolders)].sort(),
    [files.entries, files.emptyFolders],
  );

  /** Rename and move both come down to "this path became that path" — one place applies it to the
   *  working tree and, on success, tells the caller so the open tabs follow it. */
  const applyMoved = useCallback(
    (from: string, to: string, apply: () => string | null): string | null => {
      const error = apply();
      if (error) return error;
      if (to !== from) onPathMoved(from, to);
      return null;
    },
    [onPathMoved],
  );

  const applyName = useCallback(
    (name: string): string | null => {
      if (!nameMode) return null;
      switch (nameMode.kind) {
        case "new-file": {
          const path = joinPath(nameMode.dir, name.trim());
          const error = files.addFile(nameMode.dir, name);
          if (error) return error;
          // I5 — a new file is an EDITABLE BUFFER immediately: it opens in the centre surface as its
          // own tab, rather than a tree row the author then has to find and click.
          onSelectFile(path);
          return null;
        }
        case "new-folder": {
          const path = joinPath(nameMode.dir, name.trim());
          const error = files.addFolder(nameMode.dir, name);
          if (error) return error;
          setSelectedFolder(path);
          return null;
        }
        case "rename-file": {
          const to = joinPath(dirOf(nameMode.path), name.trim());
          return applyMoved(nameMode.path, to, () => files.renameFile(nameMode.path, name));
        }
        case "rename-folder": {
          const to = joinPath(dirOf(nameMode.path), name.trim());
          return applyMoved(nameMode.path, to, () => files.renameFolder(nameMode.path, name));
        }
      }
    },
    [nameMode, files, onSelectFile, applyMoved],
  );

  const applyMove = useCallback(
    (newDir: string): string | null => {
      if (!moveTarget) return null;
      const to = joinPath(newDir, baseNameOf(moveTarget.path));
      return applyMoved(moveTarget.path, to, () =>
        moveTarget.isFolder
          ? files.moveFolder(moveTarget.path, newDir)
          : files.moveFile(moveTarget.path, newDir),
      );
    },
    [moveTarget, files, applyMoved],
  );

  const requestDelete = useCallback(
    (path: string, isFolder: boolean) => {
      const fileCount = isFolder
        ? files.entries.filter((entry) => entry.path === path || entry.path.startsWith(`${path}/`))
            .length
        : 0;
      setDeleteTarget({ path, isFolder, fileCount });
    },
    [files.entries],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.isFolder) files.deleteFolder(deleteTarget.path);
    else files.deleteFile(deleteTarget.path);
    setSelectedFolder(null);
  }, [deleteTarget, files]);

  const dialogContextDir = nameMode && "dir" in nameMode ? nameMode.dir : undefined;

  return (
    <>
      <WorkspaceTree
        entries={files.entries}
        emptyFolders={files.emptyFolders}
        selectedId={selectedId}
        onSelect={(id, isFolder) => {
          if (isFolder) setSelectedFolder(id);
          else {
            setSelectedFolder(null);
            onSelectFile(id);
          }
        }}
        onNewFile={(dir) => setNameMode({ kind: "new-file", dir })}
        onNewFolder={(dir) => setNameMode({ kind: "new-folder", dir })}
        onUpload={(dir) => setUploadDir(dir)}
        onRename={(path, isFolder) =>
          setNameMode(isFolder ? { kind: "rename-folder", path } : { kind: "rename-file", path })
        }
        onMove={(path, isFolder) => setMoveTarget({ path, isFolder })}
        onDelete={requestDelete}
      />

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
          onSubmit={(uploads) => files.addUploads(uploadDir, uploads)}
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
    </>
  );
}

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
