import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillEditOp, SkillFileNode } from "@mcp-token-footprint/shared";
import {
  baseNameOf,
  buildWorkingTree,
  collectFolders,
  deriveTreeOps,
  dirOf,
  isSkillMd,
  joinPath,
  type WorkEntry,
} from "./workspace-model";

/** A decoded upload ready to add to the working tree (produced by `decodeUpload`). */
export type PendingUpload =
  | { name: string; isBinary: true; base64: string }
  | { name: string; isBinary: false; text: string };

/** The result of a mutation: `null` on success, or a human-readable reason it was refused. */
export type MutationError = string | null;

export type WorkspaceController = {
  entries: WorkEntry[];
  /** Folder paths the user created that still hold no files (implicit folders aren't listed here). */
  emptyFolders: string[];
  /** The derived tree-op batch (empty ⇒ nothing to save). */
  ops: SkillEditOp[];
  dirty: boolean;
  entryByPath: (path: string) => WorkEntry | undefined;

  addFile: (dir: string, name: string) => MutationError;
  addFolder: (dir: string, name: string) => MutationError;
  addUploads: (dir: string, uploads: PendingUpload[]) => MutationError;
  renameFile: (path: string, name: string) => MutationError;
  renameFolder: (path: string, name: string) => MutationError;
  moveFile: (path: string, newDir: string) => MutationError;
  moveFolder: (path: string, newDir: string) => MutationError;
  deleteFile: (path: string) => void;
  deleteFolder: (path: string) => void;

  /** Seed a base file's fetched content the first time it's opened (for the dirty compare). */
  hydrate: (path: string, text: string) => void;
  /** Record an in-editor content edit against the file currently at `path`. */
  setText: (path: string, text: string) => void;
};

/**
 * The Files-tab workspace state (WP 3.2): an in-memory working tree of {@link WorkEntry} plus the set
 * of user-created empty folders (folders are implicit path prefixes server-side, so an empty one is
 * UI-only until a file lands in it). Every mutation guards path collisions + the SKILL.md invariant so
 * the UI never composes a batch the edits route would 400 on; {@link deriveTreeOps} turns the tree
 * into the op batch at save time. `reset` re-seeds from a fresh base (after a save creates a new
 * version, or when the inspector switches versions).
 */
export function useWorkspace(
  baseFiles: SkillFileNode[],
): WorkspaceController & { reset: (files: SkillFileNode[]) => void } {
  const [base, setBase] = useState<SkillFileNode[]>(baseFiles);
  const [entries, setEntries] = useState<WorkEntry[]>(() => buildWorkingTree(baseFiles));
  const [emptyFolderSet, setEmptyFolderSet] = useState<Set<string>>(new Set());
  const idRef = useRef(0);
  const nextId = useCallback(() => `w${(idRef.current += 1)}`, []);

  const reset = useCallback((files: SkillFileNode[]) => {
    setBase(files);
    setEntries(buildWorkingTree(files));
    setEmptyFolderSet(new Set());
  }, []);

  // Re-seed when the caller passes a different base file set (a version switch upstream).
  useEffect(() => {
    reset(baseFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFiles]);

  const entryByPath = useCallback(
    (path: string) => entries.find((entry) => entry.path === path),
    [entries],
  );

  // All occupied paths (files + every folder prefix) — a new/renamed/moved path may not collide.
  const occupied = useMemo(() => {
    const set = new Set<string>(entries.map((entry) => entry.path));
    for (const folder of collectFolders(entries, [...emptyFolderSet])) set.add(folder);
    return set;
  }, [entries, emptyFolderSet]);

  // Empty folders = user-created folders with no file under them (implicit ancestors of files drop off).
  const emptyFolders = useMemo(() => {
    const withFiles = new Set<string>();
    for (const entry of entries) {
      let dir = dirOf(entry.path);
      while (dir) {
        withFiles.add(dir);
        dir = dirOf(dir);
      }
    }
    return [...emptyFolderSet].filter((folder) => !withFiles.has(folder)).sort();
  }, [entries, emptyFolderSet]);

  const ops = useMemo(() => deriveTreeOps(base, entries), [base, entries]);

  // ── mutations ──────────────────────────────────────────────────────────────────────────────────

  const addFile = useCallback(
    (dir: string, name: string): MutationError => {
      const path = joinPath(dir, name.trim());
      if (occupied.has(path)) return `“${path}” already exists.`;
      setEntries((current) => [
        ...current,
        { id: nextId(), path, originalPath: null, isBinary: false, text: "" },
      ]);
      return null;
    },
    [occupied, nextId],
  );

  const addFolder = useCallback(
    (dir: string, name: string): MutationError => {
      const path = joinPath(dir, name.trim());
      if (occupied.has(path)) return `“${path}” already exists.`;
      setEmptyFolderSet((current) => new Set(current).add(path));
      return null;
    },
    [occupied],
  );

  const addUploads = useCallback(
    (dir: string, uploads: PendingUpload[]): MutationError => {
      const seen = new Set(occupied);
      const collisions: string[] = [];
      for (const upload of uploads) {
        const path = joinPath(dir, upload.name.trim());
        if (seen.has(path)) collisions.push(path);
        seen.add(path);
      }
      if (collisions.length > 0) return `Already exists: ${collisions.join(", ")}.`;
      setEntries((current) => [
        ...current,
        ...uploads.map((upload) =>
          upload.isBinary
            ? ({
                id: nextId(),
                path: joinPath(dir, upload.name.trim()),
                originalPath: null,
                isBinary: true,
                base64: upload.base64,
              } satisfies WorkEntry)
            : ({
                id: nextId(),
                path: joinPath(dir, upload.name.trim()),
                originalPath: null,
                isBinary: false,
                text: upload.text,
              } satisfies WorkEntry),
        ),
      ]);
      return null;
    },
    [occupied, nextId],
  );

  const renameFile = useCallback(
    (path: string, name: string): MutationError => {
      const entry = entries.find((e) => e.path === path);
      if (!entry) return "That file no longer exists.";
      if (isSkillMd(entry)) return "SKILL.md cannot be renamed.";
      const next = joinPath(dirOf(path), name.trim());
      if (next === path) return null;
      if (occupied.has(next)) return `“${next}” already exists.`;
      setEntries((current) => current.map((e) => (e.path === path ? { ...e, path: next } : e)));
      return null;
    },
    [entries, occupied],
  );

  const moveFile = useCallback(
    (path: string, newDir: string): MutationError => {
      const entry = entries.find((e) => e.path === path);
      if (!entry) return "That file no longer exists.";
      if (isSkillMd(entry)) return "SKILL.md cannot be moved.";
      const next = joinPath(newDir, baseNameOf(path));
      if (next === path) return null;
      if (occupied.has(next)) return `“${next}” already exists.`;
      setEntries((current) => current.map((e) => (e.path === path ? { ...e, path: next } : e)));
      return null;
    },
    [entries, occupied],
  );

  // Re-prefix every entry + empty folder under `from` to `to` (folder rename/move; SKILL.md sits at
  // the root so it can never be inside a moved folder).
  const reprefix = useCallback((from: string, to: string) => {
    const within = (p: string) => p === from || p.startsWith(`${from}/`);
    const swap = (p: string) => (p === from ? to : `${to}${p.slice(from.length)}`);
    setEntries((current) =>
      current.map((e) => (within(e.path) ? { ...e, path: swap(e.path) } : e)),
    );
    setEmptyFolderSet((current) => {
      const next = new Set<string>();
      for (const folder of current) next.add(within(folder) ? swap(folder) : folder);
      return next;
    });
  }, []);

  const renameFolder = useCallback(
    (path: string, name: string): MutationError => {
      const next = joinPath(dirOf(path), name.trim());
      if (next === path) return null;
      if (occupied.has(next)) return `“${next}” already exists.`;
      reprefix(path, next);
      return null;
    },
    [occupied, reprefix],
  );

  const moveFolder = useCallback(
    (path: string, newDir: string): MutationError => {
      const next = joinPath(newDir, baseNameOf(path));
      if (next === path) return null;
      if (next === path || next.startsWith(`${path}/`))
        return "A folder can’t be moved into itself.";
      if (occupied.has(next)) return `“${next}” already exists.`;
      reprefix(path, next);
      return null;
    },
    [occupied, reprefix],
  );

  const deleteFile = useCallback((path: string) => {
    setEntries((current) => current.filter((e) => e.path !== path || isSkillMd(e)));
  }, []);

  const deleteFolder = useCallback((path: string) => {
    const within = (p: string) => p === path || p.startsWith(`${path}/`);
    // SKILL.md lives at the root, so no folder deletion can ever drop it — but guard defensively.
    setEntries((current) => current.filter((e) => !within(e.path) || isSkillMd(e)));
    setEmptyFolderSet((current) => {
      const next = new Set<string>();
      for (const folder of current) if (!within(folder)) next.add(folder);
      return next;
    });
  }, []);

  const hydrate = useCallback((path: string, text: string) => {
    setEntries((current) =>
      current.map((e) =>
        e.path === path && e.baseText === undefined
          ? { ...e, baseText: text, text: e.text ?? text }
          : e,
      ),
    );
  }, []);

  const setText = useCallback((path: string, text: string) => {
    setEntries((current) => current.map((e) => (e.path === path ? { ...e, text } : e)));
  }, []);

  return {
    entries,
    emptyFolders,
    ops,
    dirty: ops.length > 0,
    entryByPath,
    addFile,
    addFolder,
    addUploads,
    renameFile,
    renameFolder,
    moveFile,
    moveFolder,
    deleteFile,
    deleteFolder,
    hydrate,
    setText,
    reset,
  };
}
