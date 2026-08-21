import { useMemo } from "react";
import type { SkillFileNode } from "@mcp-token-footprint/shared";
import { StatePanel, Tabs, TabsContent, TabsTrigger } from "@elabs-ai/components-ui";
import { ScrollableTabsList } from "../../../components/ScrollableTabsList";
import { WorkspaceTree } from "../workspace/WorkspaceTree";
import { buildWorkingTree } from "../workspace/workspace-model";
import { SkillSettingsPanel } from "./settings/SkillSettingsPanel";
import { isStudioRail, type StudioRail as StudioLeftRailTab } from "./studio-url";

// ── Skill Studio (RM-30 WP 7.1) — the left rail's three tabs ──────────────────────────────────────
//   • Files    — the existing `WorkspaceTree`, browse-only (WP 7.4 makes it the editable multi-tab
//                workspace and wires create/rename/move/delete through the draft store).
//   • Tools    — the editor's OWN live Tools palette, PORTALLED into this rail rather
//                than mounted a second time here. That matters: the palette carries insert-at-cursor
//                and drag-to-reference against the live draft, which a second instance could not.
//                (WP 7.7 rebuilds it as the components palette.)
//   • Settings — RM-30 WP 7.3: the full settings panel — name · description · servers · keywords ·
//                command entry points — writing to the ONE Studio draft.

export type { StudioLeftRailTab };
export { isStudioRail as isStudioLeftRailTab };

export type StudioLeftRailProps = {
  skillId: string;
  versionId: string;
  /** True when `versionId` is the skill's head — settings are edited on the latest version only. */
  isHeadVersion: boolean;
  tab: StudioLeftRailTab;
  onTabChange: (tab: StudioLeftRailTab) => void;
  /** The version's committed file list (`null` while it loads). */
  files: SkillFileNode[] | null;
  /** The file the centre surface has open — the Studio's `?file=` param. */
  selectedFile: string;
  onSelectFile: (path: string) => void;
  /** Mount point for the editor's live Tools palette, which is PORTALLED in (see
   *  `StudioContextPanel` for why): pass the setter from a `useState`. It goes `null` whenever the
   *  Tools tab isn't the active one, because Radix unmounts inactive tab content — and the editor
   *  then simply renders no palette. */
  toolsContainerRef: (node: HTMLDivElement | null) => void;
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
  toolsContainerRef,
}: StudioLeftRailProps) {
  const entries = useMemo(() => (files ? buildWorkingTree(files) : []), [files]);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isStudioRail(value)) onTabChange(value);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* A rail is narrow by design: the three triggers share its width evenly (layout-only
          overrides — `flex-1` + a tighter inline gutter), and the strip still scrolls rather than
          clipping unreachably if a future label is longer than the share. Measured at the shipped
          184px rail: the default `px-3` triggers overflowed and "Settings" was cut mid-word. */}
      <ScrollableTabsList
        fullWidth
        containerClassName="shrink-0 px-2 pt-2"
        className="[&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1.5"
      >
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </ScrollableTabsList>

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
        <div ref={toolsContainerRef} className="flex min-h-0 flex-1 flex-col" />
      </TabsContent>

      <TabsContent value="settings" className="flex min-h-0 flex-1 flex-col">
        <SkillSettingsPanel
          skillId={skillId}
          versionId={versionId}
          isHeadVersion={isHeadVersion}
        />
      </TabsContent>
    </Tabs>
  );
}
