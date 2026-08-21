import { useMemo } from "react";
import type { BoundTool, SkillFileNode, SkillGraph } from "@mcp-token-footprint/shared";
import {
  ScrollArea,
  StatePanel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@elabs-ai/components-ui";
import { ToolsPalette } from "../design/ToolsPalette";
import { SkillBindingsPanel } from "../SkillBindingsPanel";
import { WorkspaceTree } from "../workspace/WorkspaceTree";
import { buildWorkingTree } from "../workspace/workspace-model";

// ── Skill Studio (RM-30 WP 7.1) — the left rail's three tabs ──────────────────────────────────────
// The shell is what this WP delivers; the tab CONTENTS mount the components that already exist, and
// the later work packages replace them in place:
//   • Files    — the existing `WorkspaceTree`, browse-only (WP 7.4 makes it the editable multi-tab
//                workspace and wires create/rename/move/delete through the draft store).
//   • Tools    — the existing `ToolsPalette`, read-only (WP 7.7 rebuilds it as the components
//                palette with a collapsible MCP-servers section).
//   • Settings — the existing `SkillBindingsPanel` (WP 7.3 grows the full settings panel: name,
//                description, servers, keywords, command entry points, on one draft store).
// Nothing here writes to the editor's draft, so the Studio still has exactly ONE save path.

export type StudioLeftRailTab = "files" | "tools" | "settings";

export const STUDIO_LEFT_RAIL_TABS: readonly StudioLeftRailTab[] = ["files", "tools", "settings"];

export function isStudioLeftRailTab(value: string): value is StudioLeftRailTab {
  return (STUDIO_LEFT_RAIL_TABS as readonly string[]).includes(value);
}

export type StudioLeftRailProps = {
  skillId: string;
  versionId: string;
  /** True when `versionId` is the skill's head — bindings are edited on the latest version only. */
  isHeadVersion: boolean;
  tab: StudioLeftRailTab;
  onTabChange: (tab: StudioLeftRailTab) => void;
  /** The version's committed file list (`null` while it loads). */
  files: SkillFileNode[] | null;
  /** The file the centre surface has open — the Studio's `?file=` param. */
  selectedFile: string;
  onSelectFile: (path: string) => void;
  /** The version's projected graph, for the palette's "referenced" set (`null` while it loads). */
  graph: SkillGraph | null;
  boundTools: BoundTool[];
  boundToolsLoading: boolean;
  /** A bind/unbind lands a new immutable version — the Studio re-points onto it. */
  onVersionSaved: (newVersionId: string) => void;
  /** Set while the editor draft is dirty: binding and editing must never race for the save path. */
  bindingBlockedReason: string | null;
};

export function StudioLeftRail({
  skillId,
  versionId,
  isHeadVersion,
  tab,
  onTabChange,
  files,
  selectedFile,
  onSelectFile,
  graph,
  boundTools,
  boundToolsLoading,
  onVersionSaved,
  bindingBlockedReason,
}: StudioLeftRailProps) {
  const entries = useMemo(() => (files ? buildWorkingTree(files) : []), [files]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isStudioLeftRailTab(value)) onTabChange(value);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="mx-2 mt-2 shrink-0">
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="files" className="flex min-h-0 flex-1 flex-col">
        {files === null ? (
          <StatePanel kind="loading" title="Loading files…" loadingLabel="Loading files…" />
        ) : (
          <WorkspaceTree
            readOnly
            entries={entries}
            emptyFolders={[]}
            selectedId={selectedFile}
            onSelect={(id, isFolder) => {
              if (!isFolder) onSelectFile(id);
            }}
            // Browse-only in WP 7.1: `readOnly` hides every control that would call these, and
            // WP 7.4 replaces them with real draft operations rather than adding them here.
            onNewFile={() => {}}
            onNewFolder={() => {}}
            onUpload={() => {}}
            onRename={() => {}}
            onMove={() => {}}
            onDelete={() => {}}
          />
        )}
      </TabsContent>

      <TabsContent value="tools" className="flex min-h-0 flex-1 flex-col">
        {graph === null ? (
          <StatePanel kind="loading" title="Loading tools…" loadingLabel="Loading tools…" />
        ) : (
          <ToolsPalette
            graph={graph}
            boundTools={boundTools}
            loading={boundToolsLoading}
            editMode={false}
            canInsert={false}
            onInsertTool={() => {}}
          />
        )}
      </TabsContent>

      <TabsContent value="settings" className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3">
            <SkillBindingsPanel
              skillId={skillId}
              versionId={versionId}
              isHeadVersion={isHeadVersion}
              blockedReason={bindingBlockedReason}
              onVersionSaved={onVersionSaved}
            />
            <Text variant="meta" tone="muted" className="text-pretty">
              Name, description, keywords and command entry points move here next — for now they are
              edited in the document itself.
            </Text>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
