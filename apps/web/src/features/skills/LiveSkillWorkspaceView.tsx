import { useEffect, useMemo, useState } from "react";
import type {
  AssistantWorkspaceChangeKind,
  AssistantWorkspaceFileNode,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Card,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  StatePanel,
  Text,
  Tree,
  type TreeNode,
} from "@brand/ui";
import { CodeEditor, DiffEditor } from "@brand/editor";
import { FileCode2, FileText, Folder, Sparkles } from "lucide-react";
import { ApiError, getAssistantWorkspaceFile } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { READ_ONLY_OPTIONS, languageFor } from "../../lib/monaco";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { InlineError } from "../../components/InlineError";
import { getSkillFile } from "./skills-inspector-api";

// WP R1.4 (D-AS22) — the Files tab's LIVE mode: a READ-ONLY review surface over the assistant's
// server-side skill workspace while it has this skill open (see `use-live-skill-workspace.ts`). No
// editing controls, no commit button here — the single commit stays the dock's gated
// `skills_commit_workspace` approval; this view only REFLECTS it. Deliberately a separate component
// from `SkillFileExplorer` (the committed-version, locally-staged-edit workspace) rather than a mode
// bolted onto it — the two have almost nothing in common (one stages local edits into a save dialog,
// this one is a passive mirror of a live, agent-driven filesystem) and mixing them risked exactly the
// "half-loaded state" `.claude/rules/loading-states.md` warns against.

/** One live tree node's change badge, mirroring `SkillDiffView.STATUS_META`'s vocabulary (kept
 *  independent since a live change kind is a narrower two-value set, not the five-value diff status). */
const CHANGE_BADGE: Record<
  AssistantWorkspaceChangeKind,
  { label: string; variant: "success" | "warning" }
> = {
  created: { label: "new", variant: "success" },
  modified: { label: "edited", variant: "warning" },
};

type LiveNode =
  | { type: "folder"; path: string; name: string; children: LiveNode[] }
  | { type: "file"; path: string; name: string; file: AssistantWorkspaceFileNode };

function buildLiveNodes(files: AssistantWorkspaceFileNode[]): LiveNode[] {
  const folders = new Map<string, Extract<LiveNode, { type: "folder" }>>();
  const roots: LiveNode[] = [];

  const ensureFolder = (path: string): Extract<LiveNode, { type: "folder" }> => {
    const existing = folders.get(path);
    if (existing) return existing;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const folder: LiveNode = { type: "folder", path, name, children: [] };
    folders.set(path, folder);
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parentPath) ensureFolder(parentPath).children.push(folder);
    else roots.push(folder);
    return folder;
  };

  for (const file of files) {
    const parentPath = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    const leaf: LiveNode = { type: "file", path: file.path, name, file };
    if (parentPath) ensureFolder(parentPath).children.push(leaf);
    else roots.push(leaf);
  }

  const sortNodes = (nodes: LiveNode[]): void => {
    nodes.sort((a, b) =>
      a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name),
    );
    for (const node of nodes) if (node.type === "folder") sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

function collectFolderIds(nodes: LiveNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      acc.push(node.path);
      collectFolderIds(node.children, acc);
    }
  }
  return acc;
}

function toTreeNodes(
  nodes: LiveNode[],
  changedPaths: ReadonlyMap<string, AssistantWorkspaceChangeKind>,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.type === "folder") {
      return {
        id: node.path,
        label: <span className="truncate">{node.name}</span>,
        icon: <Folder className="size-4 text-muted-foreground" />,
        children: toTreeNodes(node.children, changedPaths),
      };
    }
    const changeKind = changedPaths.get(node.path);
    const badge = changeKind ? CHANGE_BADGE[changeKind] : undefined;
    return {
      id: node.path,
      label: (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="min-w-0 truncate">{node.name}</span>
          {badge ? (
            <Badge variant={badge.variant} className="shrink-0">
              {badge.label}
            </Badge>
          ) : null}
        </span>
      ),
      icon: node.file.isBinary ? (
        <FileCode2 className="size-4 text-muted-foreground" />
      ) : (
        <FileText className={`size-4 ${badge ? "text-warning" : "text-muted-foreground"}`} />
      ),
    };
  });
}

export type LiveSkillWorkspaceViewProps = {
  threadId: string;
  skillId: string;
  /** The diff base — the committed version the live workspace opened from (or the caller's honest
   *  fallback when that wasn't observed live — see `use-live-skill-workspace.ts`'s module doc). */
  baseVersionId: string;
  files: AssistantWorkspaceFileNode[];
  changedPaths: ReadonlyMap<string, AssistantWorkspaceChangeKind>;
  selectedPath: string | undefined;
  onSelectPath: (path: string) => void;
  /**
   * Bumped once per debounced change-settle (the hook's `autoOpenNonce`) — folded into the diff pane's
   * `key` so a REPEAT edit to the file that's already selected still forces a refetch. Without this, the
   * pane's effect (keyed on thread/skill/base/path — none of which change on a repeat edit) would keep
   * showing the stale pre-edit content until the user navigated away and back.
   */
  changeNonce: number;
};

/** The left pane: a read-only live file tree, badged with what the agent has touched this session. */
function LiveTree({
  files,
  changedPaths,
  selectedPath,
  onSelectPath,
}: {
  files: AssistantWorkspaceFileNode[];
  changedPaths: ReadonlyMap<string, AssistantWorkspaceChangeKind>;
  selectedPath: string | undefined;
  onSelectPath: (path: string) => void;
}) {
  const nodes = useMemo(() => buildLiveNodes(files), [files]);
  const treeNodes = useMemo(() => toTreeNodes(nodes, changedPaths), [nodes, changedPaths]);
  const folderIds = useMemo(() => collectFolderIds(nodes), [nodes]);
  const folderSet = useMemo(() => new Set(folderIds), [folderIds]);

  if (files.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No files yet"
        description="The live workspace hasn’t materialized any files."
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <Tree
          nodes={treeNodes}
          defaultExpandedIds={folderIds}
          selectedIds={selectedPath ? [selectedPath] : []}
          onSelectionChange={(ids) => {
            const id = ids[0];
            if (id && !folderSet.has(id)) onSelectPath(id);
          }}
        />
      </div>
    </ScrollArea>
  );
}

/** The right pane: the selected file's live content diffed against its base-version content. */
function LiveFileDiffPane({
  threadId,
  skillId,
  baseVersionId,
  path,
  changeKind,
}: {
  threadId: string;
  skillId: string;
  baseVersionId: string;
  path: string;
  changeKind: AssistantWorkspaceChangeKind | undefined;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "binary" }
    | { status: "added"; text: string }
    | { status: "diff"; fromText: string; toText: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    async function load(): Promise<void> {
      const live = await getAssistantWorkspaceFile(threadId, skillId, path);
      if (live.isBinary) {
        if (!cancelled) setState({ status: "binary" });
        return;
      }
      try {
        const base = await getSkillFile(skillId, baseVersionId, path);
        if (cancelled) return;
        if (base.isBinary) {
          setState({ status: "binary" });
        } else {
          setState({ status: "diff", fromText: base.text, toText: live.text });
        }
      } catch (err) {
        if (cancelled) return;
        // The path doesn't exist in the base version — a newly created file (or, for a late-subscriber
        // fallback base, a version that simply predates it). Either way: nothing to diff against.
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "added", text: live.text });
        } else {
          throw err;
        }
      }
    }

    load().catch((err: unknown) => {
      if (!cancelled)
        setState({
          status: "error",
          message: getErrorMessage(err, "Couldn’t load the live file"),
        });
    });

    return () => {
      cancelled = true;
    };
  }, [threadId, skillId, baseVersionId, path]);

  const language = languageFor(path);

  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading…" loadingLabel="Loading the live file…" />;
  }
  if (state.status === "error") {
    return (
      <InlineError
        title="Couldn’t load the live file — select another file, then reselect this one to try again."
        detail={state.message}
      />
    );
  }
  if (state.status === "binary") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <FileCode2 className="size-10 text-muted-foreground" aria-hidden />
        <Text>Binary file</Text>
        <Text variant="meta" tone="muted">
          {path}
        </Text>
      </div>
    );
  }
  if (state.status === "added") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border px-3 py-2">
          <Text variant="meta" tone="muted" className="truncate font-mono">
            Added · {path}
          </Text>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor
            value={state.text}
            language={language}
            readOnly
            height="100%"
            ariaLabel={`Added ${path}`}
            options={READ_ONLY_OPTIONS}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Text variant="meta" tone="muted" className="min-w-0 flex-1 truncate font-mono">
          {path}
        </Text>
        {changeKind ? (
          <Badge variant={CHANGE_BADGE[changeKind].variant} className="shrink-0">
            {CHANGE_BADGE[changeKind].label}
          </Badge>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffEditor
          original={state.fromText}
          modified={state.toText}
          language={language}
          readOnly
          height="100%"
          options={READ_ONLY_OPTIONS}
        />
      </div>
    </div>
  );
}

export function LiveSkillWorkspaceView({
  threadId,
  skillId,
  baseVersionId,
  files,
  changedPaths,
  selectedPath,
  onSelectPath,
  changeNonce,
}: LiveSkillWorkspaceViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Card className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
        <Text variant="meta">
          The assistant has this skill open — showing its live, uncommitted files.
        </Text>
      </Card>
      <AdaptivePanelGroup className="min-h-0 flex-1 rounded-lg border border-border">
        <ResizablePanel defaultSize={32} minSize={20}>
          <LiveTree
            files={files}
            changedPaths={changedPaths}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={68} minSize={35}>
          {selectedPath ? (
            <LiveFileDiffPane
              key={`${selectedPath}:${changeNonce}`}
              threadId={threadId}
              skillId={skillId}
              baseVersionId={baseVersionId}
              path={selectedPath}
              changeKind={changedPaths.get(selectedPath)}
            />
          ) : (
            <StatePanel
              kind="empty"
              title="No file selected"
              description="Pick a file from the tree to see it."
            />
          )}
        </ResizablePanel>
      </AdaptivePanelGroup>
    </div>
  );
}
