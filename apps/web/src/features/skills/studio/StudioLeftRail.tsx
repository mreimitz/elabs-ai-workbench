import { StatePanel, Tabs, TabsContent, TabsTrigger } from "@elabs-ai/components-ui";
import { ScrollableTabsList } from "../../../components/ScrollableTabsList";
import { useStudioDraft } from "./draft";
import { StudioFilesRail } from "./files/StudioFilesRail";
import { SkillSettingsPanel } from "./settings/SkillSettingsPanel";
import { isStudioRail, type StudioRail as StudioLeftRailTab } from "./studio-url";

// ── Skill Studio (RM-30 WP 7.1) — the left rail's three tabs ──────────────────────────────────────
//   • Files    — RM-30 WP 7.4: the EDITABLE workspace tree. Create · upload · rename · move · delete
//                all stage on the ONE Studio draft and are applied by the one save.
//   • Tools    — RM-30 WP 7.7: the editor's OWN live COMPONENTS palette, PORTALLED into this rail
//                rather than mounted a second time here. That matters: the palette stages component
//                placements, insert-at-cursor and drag-to-reference against the live draft, which a
//                second instance could not. The tab label still says "Tools" while the panel inside
//                is headed "Components" — see the note on the tab strip below for why.
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
  /** The file the centre surface has open — the Studio's `?file=` param. */
  selectedFile: string;
  onSelectFile: (path: string) => void;
  /** A path (a file, or a folder and everything under it) was renamed or moved in the draft. */
  onPathMoved: (from: string, to: string) => void;
  /** Mount point for the editor's live components palette, which is PORTALLED in (see
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
  selectedFile,
  onSelectFile,
  onPathMoved,
  toolsContainerRef,
}: StudioLeftRailProps) {
  // The working tree IS the draft's — the rail and the centre surface must never hold two copies of
  // "which files exist and what is in them".
  const draft = useStudioDraft();

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
          184px rail: the default `px-3` triggers overflowed and "Settings" was cut mid-word.

          RM-30 WP 7.7 note — the tab still reads "Tools" while the panel inside it is headed
          "Components". That mismatch is deliberate for now, and it is the SHORTER of two evils: the
          label was renamed and reverted after looking at it in a browser at 1600×1000. "Components"
          does not fit a three-way split of 184px (~49px of text room against ~78px needed) — the
          labels overlapped into "FilesComponentsSettings", and adding `truncate` only made it worse,
          because the centered trigger clips both ends ("omponer") instead of showing an ellipsis.
          Fixing it properly means changing the rail's width or its tab layout, which belongs to the
          rail's owner (WP 7.9 reworks this surface), not to the palette WP. */}
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
        {draft.loading ? (
          <StatePanel kind="loading" title="Loading files…" loadingLabel="Loading files…" />
        ) : (
          <StudioFilesRail
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            onPathMoved={onPathMoved}
          />
        )}
      </TabsContent>

      <TabsContent value="tools" className="flex min-h-0 flex-1 flex-col">
        <div ref={toolsContainerRef} className="flex min-h-0 flex-1 flex-col" />
      </TabsContent>

      <TabsContent value="settings" className="flex min-h-0 flex-1 flex-col">
        <SkillSettingsPanel skillId={skillId} versionId={versionId} isHeadVersion={isHeadVersion} />
      </TabsContent>
    </Tabs>
  );
}
