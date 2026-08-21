import { SandboxTabsBar, SandboxTabsList, SandboxTabsTrigger } from "@elabs-ai/components-ai";
import { Tabs, cn } from "@elabs-ai/components-ui";
import { FileText, PanelTop, X } from "lucide-react";
import { IconButton } from "../../../../components/IconButton";
import { isContentDirty, type WorkEntry } from "../../workspace/workspace-model";
import { SKILL_MD } from "./file-ops";
import { baseNameOf } from "../../workspace/workspace-model";

// ── Skill Studio (RM-30 WP 7.4) — the centre surface's editor tabs ────────────────────────────────
// `SandboxTabs*` (`@elabs-ai/components-ai`) is the design system's own code-workspace tab bar — a flat,
// underlined strip rather than the recessed pill track a `TabsList` renders, which is what an editor
// file strip is supposed to look like. It is a thin skin over the same Radix `Tabs`, so keyboard
// behaviour (roving tabindex, arrows, Home/End) and the focus ring come along unchanged.
//
// SKILL.md is the first tab and is PINNED: it is the Flow | Code | Split surface the whole Studio is
// built around, and closing it would leave the workbench with nothing to show.
//
// Close is ONE control at the tail of the strip, acting on the active tab — not an × inside each
// trigger. A `TabsTrigger` renders a `<button>`, and a button inside a button is invalid markup with
// no accessible resolution; putting sibling close buttons inside the `tablist` instead would double
// every tab stop and fight Radix's roving focus. This is the same call, for the same reason, that
// `WorkspaceTree` already documents for its per-row actions.

/** One open editor tab. */
export type StudioFileTab = {
  path: string;
  /** The entry behind it, when the file is in the working tree (the pinned manifest has none). */
  entry?: WorkEntry;
};

export type StudioFileTabsProps = {
  /** The open FILE tabs, in open order — SKILL.md is added by this component and never listed here. */
  tabs: StudioFileTab[];
  /** The active tab's path (`SKILL.md` for the pinned manifest tab). */
  active: string;
  onSelect: (path: string) => void;
  /** Close one open file tab. Never called for `SKILL.md`. */
  onClose: (path: string) => void;
  /** True while the SKILL.md draft differs from the saved version — the pinned tab's own marker. */
  manifestDirty: boolean;
};

export function StudioFileTabs({
  tabs,
  active,
  onSelect,
  onClose,
  manifestDirty,
}: StudioFileTabsProps) {
  const closable = active !== SKILL_MD;

  return (
    <Tabs value={active} onValueChange={onSelect} className="shrink-0 gap-0">
      <SandboxTabsBar className="border-t-0 bg-card">
        <SandboxTabsList aria-label="Open files" className="min-w-0 flex-1 overflow-x-auto">
          <SandboxTabsTrigger value={SKILL_MD} className="gap-1.5 whitespace-nowrap">
            <PanelTop className="size-3.5" aria-hidden />
            <span className="font-mono">{SKILL_MD}</span>
            <TabMarker show={manifestDirty} label="unsaved" />
          </SandboxTabsTrigger>

          {tabs.map((tab) => (
            <SandboxTabsTrigger
              key={tab.path}
              value={tab.path}
              className="gap-1.5 whitespace-nowrap"
              title={tab.path}
            >
              <FileText className="size-3.5" aria-hidden />
              <span className="font-mono">{baseNameOf(tab.path)}</span>
              <TabMarker
                show={tab.entry !== undefined && isTabDirty(tab.entry)}
                label={tab.entry?.originalPath === null ? "new" : "unsaved"}
              />
            </SandboxTabsTrigger>
          ))}
        </SandboxTabsList>

        <div className="flex shrink-0 items-center px-1">
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={closable ? `Close ${baseNameOf(active)}` : "Close file"}
            disabledReason={closable ? undefined : "SKILL.md stays open — it is the skill itself."}
            disabled={!closable}
            onClick={() => onClose(active)}
          >
            <X aria-hidden />
          </IconButton>
        </div>
      </SandboxTabsBar>
    </Tabs>
  );
}

/** A file with unsaved content: a brand-new buffer, or a base file whose draft has moved. */
function isTabDirty(entry: WorkEntry): boolean {
  return entry.originalPath === null || isContentDirty(entry);
}

/** The unsaved marker. A dot alone would be colour-only, so it carries its meaning as text for
 *  assistive tech and reads in both themes off one semantic token. */
function TabMarker({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-warning")} />
      <span className="sr-only">({label})</span>
    </>
  );
}
