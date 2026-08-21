import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollArea, Text, Tree, type TreeNode } from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import {
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoveRight,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import type { WorkEntry } from "./workspace-model";
import { dirOf, isContentDirty, isSkillMd } from "./workspace-model";

// ── the workspace tree (interactive) ────────────────────────────────────────────────────────────
// Built on `@elabs-ai/components-ui` `Tree` (roving-tabindex keyboard nav + single selection + expand/collapse) —
// chosen over the display-only `@elabs-ai/components-ai` FileTree because the workspace tree is INTERACTIVE. Per-
// node actions live in a toolbar that acts on the current SELECTION (a `Tree` row is a div, and its
// label span doesn't stretch, so a reliably right-aligned per-row action menu isn't available — the
// selection toolbar is the accessible, un-conflicting affordance).

type WorkNode =
  | { type: "folder"; path: string; name: string; children: WorkNode[]; empty: boolean }
  | { type: "file"; path: string; name: string; entry: WorkEntry };

/** Build the nested folder/file structure from the working tree + user-created empty folders. */
function buildNodes(entries: WorkEntry[], emptyFolders: string[]): WorkNode[] {
  const folders = new Map<string, Extract<WorkNode, { type: "folder" }>>();
  const roots: WorkNode[] = [];

  const ensureFolder = (path: string): Extract<WorkNode, { type: "folder" }> => {
    const existing = folders.get(path);
    if (existing) return existing;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const folder = { type: "folder" as const, path, name, children: [], empty: false };
    folders.set(path, folder);
    const parent = dirOf(path);
    if (parent) ensureFolder(parent).children.push(folder);
    else roots.push(folder);
    return folder;
  };

  for (const folder of emptyFolders) ensureFolder(folder).empty = true;
  for (const entry of entries) {
    const parent = dirOf(entry.path);
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const leaf: WorkNode = { type: "file", path: entry.path, name, entry };
    if (parent) ensureFolder(parent).children.push(leaf);
    else roots.push(leaf);
  }

  // A folder that ends up with children is no longer "empty".
  for (const folder of folders.values()) if (folder.children.length > 0) folder.empty = false;
  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: WorkNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) if (node.type === "folder") sortNodes(node.children);
}

function collectFolderIds(nodes: WorkNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      acc.push(node.path);
      collectFolderIds(node.children, acc);
    }
  }
  return acc;
}

/** A tinted file icon that signals a file's working-tree status (new / modified / carried over). */
function fileIcon(entry: WorkEntry): ReactNode {
  if (entry.isBinary) return <FileCode2 className="size-4 text-muted-foreground" />;
  const tone =
    entry.originalPath === null
      ? "text-primary"
      : isContentDirty(entry)
        ? "text-warning"
        : "text-muted-foreground";
  return <FileText className={`size-4 ${tone}`} />;
}

/** Map the nested WorkNodes to `@elabs-ai/components-ui` `TreeNode`s (id = path; folders carry children). */
function toTreeNodes(nodes: WorkNode[]): TreeNode[] {
  return nodes.map((node) =>
    node.type === "folder"
      ? {
          id: node.path,
          label: <span className="truncate">{node.name}</span>,
          icon: <Folder className="size-4 text-muted-foreground" />,
          children: toTreeNodes(node.children),
        }
      : {
          id: node.path,
          label: <span className="truncate">{node.name}</span>,
          icon: fileIcon(node.entry),
        },
  );
}

export type WorkspaceTreeProps = {
  entries: WorkEntry[];
  emptyFolders: string[];
  /** The selected node id (a file or folder path), or undefined. */
  selectedId: string | undefined;
  /** Selection changed — `isFolder` tells the caller which pane to show. */
  onSelect: (id: string, isFolder: boolean) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onUpload: (dir: string) => void;
  onRename: (path: string, isFolder: boolean) => void;
  onMove: (path: string, isFolder: boolean) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  /** RM-30 WP 7.1 — browse-only: hide the mutation toolbar (new/upload/rename/move/delete) and render
   *  just search + the tree. Used by the Skill Studio's Files rail, which browses a COMMITTED version
   *  (the editable multi-tab workspace lands in WP 7.4). The handlers above stay required so nothing
   *  silently loses a wired action when the flag is dropped again. */
  readOnly?: boolean;
};

/** The left pane: a toolbar (acting on the selection), a search box, and the interactive file tree. */
export function WorkspaceTree({
  entries,
  emptyFolders,
  selectedId,
  onSelect,
  onNewFile,
  onNewFolder,
  onUpload,
  onRename,
  onMove,
  onDelete,
  readOnly = false,
}: WorkspaceTreeProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { entries, emptyFolders };
    return {
      entries: entries.filter((entry) => entry.path.toLowerCase().includes(q)),
      emptyFolders: emptyFolders.filter((folder) => folder.toLowerCase().includes(q)),
    };
  }, [entries, emptyFolders, query]);

  const nodes = useMemo(() => buildNodes(filtered.entries, filtered.emptyFolders), [filtered]);
  const treeNodes = useMemo(() => toTreeNodes(nodes), [nodes]);
  const folderIds = useMemo(() => collectFolderIds(nodes), [nodes]);

  // Re-expand when the tree changes (a search or a create reveals results); user collapses persist
  // until the next structural change.
  const [expanded, setExpanded] = useState<string[]>(folderIds);
  useEffect(() => {
    setExpanded(folderIds);
  }, [folderIds]);

  const folderSet = useMemo(() => new Set(folderIds), [folderIds]);
  const selectedIsFolder = selectedId !== undefined && folderSet.has(selectedId);
  const selectedEntry =
    selectedId !== undefined ? entries.find((e) => e.path === selectedId) : undefined;
  const selectedIsSkillMd = selectedEntry ? isSkillMd(selectedEntry) : false;
  const hasSelection = selectedId !== undefined;

  // New/Upload target: the selected folder, or the parent folder of the selected file, else root.
  const targetDir = selectedIsFolder ? (selectedId ?? "") : selectedId ? dirOf(selectedId) : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* O3 — shared toolbar height (`h-11`) so the tree toolbar and the open-file header align. */}
      {readOnly ? null : (
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2">
        <ToolbarButton label="New file" onClick={() => onNewFile(targetDir)}>
          <FilePlus2 className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="New folder" onClick={() => onNewFolder(targetDir)}>
          <FolderPlus className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Upload files" onClick={() => onUpload(targetDir)}>
          <Upload className="size-4" aria-hidden />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolbarButton
          label={selectedIsSkillMd ? "SKILL.md can’t be renamed" : "Rename"}
          disabled={!hasSelection || selectedIsSkillMd}
          onClick={() => selectedId && onRename(selectedId, selectedIsFolder)}
        >
          <Pencil className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label={selectedIsSkillMd ? "SKILL.md can’t be moved" : "Move"}
          disabled={!hasSelection || selectedIsSkillMd}
          onClick={() => selectedId && onMove(selectedId, selectedIsFolder)}
        >
          <MoveRight className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label={selectedIsSkillMd ? "SKILL.md can’t be deleted" : "Delete"}
          disabled={!hasSelection || selectedIsSkillMd}
          onClick={() => selectedId && onDelete(selectedId, selectedIsFolder)}
        >
          <Trash2 className="size-4" aria-hidden />
        </ToolbarButton>
      </div>
      )}

      <div className="shrink-0 border-b border-border p-2">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Search files…" />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {treeNodes.length === 0 ? (
            <Text variant="meta" tone="muted" className="px-2 py-1">
              {query ? `No files match “${query}”.` : "No files."}
            </Text>
          ) : (
            <Tree
              nodes={treeNodes}
              selectionMode="single"
              selectedIds={selectedId ? [selectedId] : []}
              expandedIds={expanded}
              onExpandedChange={setExpanded}
              onSelectionChange={(ids) => {
                const id = ids[0];
                if (id !== undefined) onSelect(id, folderSet.has(id));
              }}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <IconButton variant="ghost" size="icon" onClick={onClick} disabled={disabled} label={label}>
      {children}
    </IconButton>
  );
}
