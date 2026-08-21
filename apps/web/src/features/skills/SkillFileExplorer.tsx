import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BoundTool, SkillFileNode } from "@mcp-token-footprint/shared";
import { Button, ResizableHandle, ResizablePanel, StatePanel } from "@elabs-ai/components-ui";
import { PencilRuler } from "lucide-react";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { skillStudioPath } from "./studio/studio-url";
import { WorkspaceEditor } from "./workspace/WorkspaceEditor";
import { WorkspaceTree } from "./workspace/WorkspaceTree";
import { SKILL_MD, buildWorkingTree, type WorkEntry } from "./workspace/workspace-model";

// ── The Inspector's Files tab — BROWSE-ONLY (RM-30 WP 7.4) ────────────────────────────────────────
// This tab used to be a file-manager workspace with its own Discard / Save… bar, its own tree-op
// batch and its own version-creating save dialog. WP 7.1 moved authoring to the Skill Studio and
// left this bar in place deliberately, because until files became editable there it was the only
// way to change one. They are editable there now, so the bar is gone and this is what its name
// always said it was: an explorer.
//
// What remains: the same tree (read-only), the same Monaco preview (read-only), and one action —
// "Edit in Studio", deep-linked to the file being looked at (`?file=`) so an author lands on it.
// The server-bindings strip went with the save bar: it saved a new version too, and Overview
// already carries the read-only Servers card (WP 7.3).
//
// One consequence worth naming: the inspector can no longer hold a draft at all, so there is no
// unsaved state to guard on a tab switch, no `beforeunload` handler, and no way for it to race the
// Studio's save.

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
  /** Skill IDE WP 8.5 — open the inline tool-runner Sheet for an ALREADY-RESOLVED bound tool. Threaded
   *  to the SKILL.md preview's hover "Test this tool…" command-link (via {@link WorkspaceEditor}). */
  onTestTool?: (tool: BoundTool) => void;
};

/**
 * Files tab: browse the committed version's tree and read any text file. Nothing here mutates —
 * every change to a skill's files is made in the Studio, on the one draft, and lands as one new
 * immutable version.
 */
export function SkillFileExplorer({
  skillId,
  versionId,
  files,
  onTestTool,
}: SkillFileExplorerProps) {
  // The committed tree, as `WorkEntry`s so the shared tree + preview components can render it. It is
  // never mutated here; `hydrate` only fills in a file's fetched text for the preview.
  const [entries, setEntries] = useState<WorkEntry[]>(() => buildWorkingTree(files));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => defaultSelection(files));
  const [selectedIsFolder, setSelectedIsFolder] = useState(false);

  // A version switch re-seeds the tree and the selection.
  useEffect(() => {
    setEntries(buildWorkingTree(files));
    setSelectedId(defaultSelection(files));
    setSelectedIsFolder(false);
  }, [files]);

  const selectedEntry =
    selectedId !== undefined && !selectedIsFolder
      ? entries.find((entry) => entry.path === selectedId)
      : undefined;

  const hydrate = (path: string, text: string) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.path === path && entry.baseText === undefined
          ? { ...entry, baseText: text, text }
          : entry,
      ),
    );
  };

  // Deep-link the Studio AT the file being read. SKILL.md is the Studio's default surface, so
  // naming it would only strand a redundant param on an otherwise clean URL (D-TB10).
  const studioTo =
    selectedEntry && selectedEntry.path !== SKILL_MD
      ? skillStudioPath(skillId, { file: selectedEntry.path })
      : skillStudioPath(skillId);

  const editInStudio = (
    <Button asChild size="sm" variant="outline">
      <Link to={studioTo}>
        <PencilRuler aria-hidden /> Edit in Studio
      </Link>
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <AdaptivePanelGroup className="min-h-0 flex-1 rounded-lg border border-border">
        <ResizablePanel defaultSize={32} minSize={20}>
          <WorkspaceTree
            readOnly
            entries={entries}
            emptyFolders={[]}
            selectedId={selectedId}
            onSelect={(id, isFolder) => {
              setSelectedId(id);
              setSelectedIsFolder(isFolder);
            }}
            // Browse-only: `readOnly` hides every control that would call these. They stay required
            // so nothing silently loses a wired action if the flag is ever dropped again.
            onNewFile={() => {}}
            onNewFolder={() => {}}
            onUpload={() => {}}
            onRename={() => {}}
            onMove={() => {}}
            onDelete={() => {}}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={68} minSize={35}>
          <div className="flex h-full min-h-0 flex-col">
            {selectedEntry ? (
              <WorkspaceEditor
                key={selectedEntry.id}
                readOnly
                skillId={skillId}
                versionId={versionId}
                entry={selectedEntry}
                onHydrate={hydrate}
                // Never called in `readOnly` mode — the editor guards it — but the prop stays
                // required so a future editable host can't forget to wire it.
                onEdit={() => {}}
                onTestTool={onTestTool}
                headerActions={editInStudio}
              />
            ) : selectedIsFolder ? (
              <StatePanel
                kind="empty"
                title={selectedId || "Folder"}
                description="Folder selected. Pick a file to read it, or edit this skill in the Studio."
                actions={editInStudio}
              />
            ) : (
              <StatePanel
                kind="empty"
                title="No file selected"
                description="Pick a file from the tree to read it."
                actions={editInStudio}
              />
            )}
          </div>
        </ResizablePanel>
      </AdaptivePanelGroup>
    </div>
  );
}
