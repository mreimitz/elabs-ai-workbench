import { StatePanel, Tabs, TabsContent, TabsList, TabsTrigger } from "@elabs-ai/components-ui";
import { useStudioDraft } from "./draft";
import { StudioFilesRail } from "./files/StudioFilesRail";
import { SkillSettingsPanel } from "./settings/SkillSettingsPanel";
import { isStudioRail, type StudioRail as StudioLeftRailTab } from "./studio-url";

// ── Skill Studio (RM-30 WP 7.1) — the left rail's three tabs ──────────────────────────────────────
//   • Files      — RM-30 WP 7.4: the EDITABLE workspace tree. Create · upload · rename · move ·
//                  delete all stage on the ONE Studio draft and are applied by the one save. Since
//                  WP 7.9 it also lists SKILL.md as an ordinary, openable source file.
//   • Components — RM-30 WP 7.7: the editor's OWN live components palette, PORTALLED into this rail
//                  rather than mounted a second time here. That matters: the palette stages
//                  component placements, insert-at-cursor and drag-to-reference against the live
//                  draft, which a second instance could not.
//   • Settings   — RM-30 WP 7.3: the full settings panel — name · description · servers · keywords ·
//                  command entry points — writing to the ONE Studio draft.
//
// ── WHY THE TABS ARE STACKED (RM-30 WP 7.9, paying WP 7.7's recorded debt) ────────────────────────
// WP 7.7 renamed the panel to "Components" and had to leave its TAB reading "Tools", because the
// longer label does not fit a three-way split of the rail: measured in Chromium at 1600×1000, the
// label needs ~78px against ~49px of room, and both alternatives were worse (a scrolling strip cut
// "Settings" off; `truncate` clipped a centered trigger at BOTH ends, into "omponer").
//
// The fix is the rail's, and it is NOT a wider rail. The rail cannot afford width: WP 7.1's
// acceptance is that the centre surface holds ≥60% of a 1600×1000 viewport with both rails open, and
// at the shipped `w-56`/`w-56` it clears that with 16px to spare — so any horizontal split of three
// labels is arithmetically out of reach no matter what the rail is widened to.
//
// Stacking costs nothing horizontally and gives every trigger the rail's FULL inner width (~168px
// against the ~78px "Components" needs), so all three labels render unclipped and un-truncated. The
// list is a real vertical Radix tablist (`orientation="vertical"`), so it announces itself as one and
// Up/Down move between the tabs — the keyboard contract follows the visual change rather than
// contradicting it. Everything below is layout-only class work on the design system's own `TabsList`
// / `TabsTrigger`; no colour, no type role, no second component.

export type { StudioLeftRailTab };
export { isStudioRail as isStudioLeftRailTab };

export type StudioLeftRailProps = {
  skillId: string;
  versionId: string;
  /** True when `versionId` is the skill's head — settings are edited on the latest version only. */
  isHeadVersion: boolean;
  tab: StudioLeftRailTab;
  onTabChange: (tab: StudioLeftRailTab) => void;
  /** The file the centre surface has open — the Studio's `?file=` param, or `undefined` while the
   *  Designer (which is not a file) is showing. */
  selectedFile: string | undefined;
  onSelectFile: (path: string) => void;
  /** A path (a file, or a folder and everything under it) was renamed or moved in the draft. */
  onPathMoved: (from: string, to: string) => void;
  /** Mount point for the editor's live components palette, which is PORTALLED in (see
   *  `StudioContextPanel` for why): pass the setter from a `useState`. It goes `null` whenever the
   *  Components tab isn't the active one, because Radix unmounts inactive tab content — and the
   *  editor then simply renders no palette. */
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
      orientation="vertical"
      value={tab}
      onValueChange={(value) => {
        if (isStudioRail(value)) onTabChange(value);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Layout-only overrides on the design system's own recessed track: a column that spans the
          rail, with each trigger stretched to its full width and its label left-aligned like the
          file rows underneath it. `h-auto` releases the strip's horizontal `h-9`, and
          `overflow-x-visible` releases the horizontal-scroll box a column has no use for. */}
      <TabsList className="mx-2 mt-2 h-auto w-auto shrink-0 flex-col items-stretch gap-0.5 overflow-x-visible">
        <TabsTrigger value="files" className="w-full justify-start">
          Files
        </TabsTrigger>
        <TabsTrigger value="components" className="w-full justify-start">
          Components
        </TabsTrigger>
        <TabsTrigger value="settings" className="w-full justify-start">
          Settings
        </TabsTrigger>
      </TabsList>

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

      <TabsContent value="components" className="flex min-h-0 flex-1 flex-col">
        <div ref={toolsContainerRef} className="flex min-h-0 flex-1 flex-col" />
      </TabsContent>

      <TabsContent value="settings" className="flex min-h-0 flex-1 flex-col">
        <SkillSettingsPanel skillId={skillId} versionId={versionId} isHeadVersion={isHeadVersion} />
      </TabsContent>
    </Tabs>
  );
}
