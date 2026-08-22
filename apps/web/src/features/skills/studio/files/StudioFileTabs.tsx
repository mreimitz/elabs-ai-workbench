import { useRef, type KeyboardEvent } from "react";
import { Button, cn } from "@elabs-ai/components-ui";
import { FileText, Workflow, X } from "lucide-react";
import { IconButton } from "../../../../components/IconButton";
import { isContentDirty, type WorkEntry } from "../../workspace/workspace-model";
import { SKILL_MD } from "./file-ops";
import { DESIGNER_TAB } from "./tab-model";
import { baseNameOf } from "../../workspace/workspace-model";

// ── Skill Studio (RM-30 WP 7.4, reworked by WP 7.9) — the centre surface's editor tabs ────────────
// RM-30 WP 7.9 (D-UX19 #2) put the DESIGNER in the pinned first slot and let every file — SKILL.md
// included — be an ordinary closable tab. The Designer is the visual composer, not a document, so it
// carries NO close control at all (not a disabled one) and the Delete shortcut below is inert on it;
// closing it would leave the workbench with nothing to fall back to. `SKILL.md` is now the
// manifest's SOURCE tab and closes like any other file — the Designer is what it hands back to.
//
// WHY THIS STRIP IS HAND-ROLLED AND NOT `SandboxTabs*`/Radix `Tabs` (owner decision, 2026-08-22)
//   Every file tab needs its own ×. A Radix `TabsTrigger` renders a `<button>`, and a button inside
//   a button is invalid markup with no accessible resolution — so with Radix the only close control
//   possible was ONE button at the tail of the strip acting on the active tab, which is what shipped
//   and what the owner overturned. The ONLY way to give each tab its own × is for that × to be a
//   real SIBLING of the tab, which means owning the tablist ourselves. The upstream design system
//   ships no closable-tab primitive (`brand-ui search tab` → `Tabs`/`TabsList`/`TabsTrigger` and the
//   `Sandbox*` skins over them, none of which take a per-tab action slot) — a genuine upstream gap,
//   composed here from `@elabs-ai/components-ui` primitives per `library-first.md` rather than
//   hand-rolled markup: the tab IS a `Button` and the × IS the app's `IconButton` (D-TB5). The
//   flat/underlined look is reproduced with the SAME semantic-token classes upstream's own
//   `SandboxTabsTrigger` composes onto `TabsTrigger` (`border-b-2`, `border-primary`,
//   `text-muted-foreground` → `text-foreground`), so nothing here invents a colour.
//
// WHAT WE THEREFORE OWN — the keyboard contract Radix used to provide (pinned by
// `StudioFileTabs.test.tsx`):
//   · ROVING TABINDEX — exactly ONE tab is in the page tab order (the active one, `tabIndex=0`);
//     every other tab is `-1`. The strip is 2 tab stops total no matter how many files are open:
//     the active tab, then its ×. A per-tab × in the tab order would make the strip grow a stop per
//     file, which is the "doubling" this is written to avoid.
//   · ArrowLeft / ArrowRight move (wrapping, like Radix's `loop`), Home / End jump to the ends.
//     Movement ACTIVATES, matching the automatic-activation behaviour of the Radix strip it
//     replaces, and focus is moved onto the target tab's own DOM node so the roving index follows.
//   · Delete on a focused tab closes it — the mouse-free equivalent of clicking its ×, and inert on
//     the pinned Designer tab.
//   · `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` are wired by hand; the
//     panels themselves are in `StudioShell` and take their ids from {@link studioTabPanelDomId}.

/** One open editor tab. */
export type StudioFileTab = {
  path: string;
  /** The entry behind it, when the file is in the working tree. */
  entry?: WorkEntry;
};

/** A working-tree path is not id-safe (slashes, dots, spaces); percent-encode it, then take `%` out
 *  of the way so the id stays a plain CSS/HTML identifier. */
const idSafe = (path: string): string => encodeURIComponent(path).replace(/%/g, "_");

/** The DOM id of `path`'s TAB — `aria-labelledby` for its panel. */
export const studioTabDomId = (path: string): string => `studio-tab-${idSafe(path)}`;
/** The DOM id of `path`'s PANEL — `aria-controls` for its tab. Owned by `StudioShell`. */
export const studioTabPanelDomId = (path: string): string => `studio-tabpanel-${idSafe(path)}`;

/** The pinned tab's visible label. */
export const DESIGNER_TAB_LABEL = "Designer";

export type StudioFileTabsProps = {
  /** The open FILE tabs, in open order — the Designer is added by this component and never listed. */
  tabs: StudioFileTab[];
  /** The active tab's path (`DESIGNER_TAB` for the pinned Designer). */
  active: string;
  onSelect: (path: string) => void;
  /** Close one open file tab. Never called for the Designer. */
  onClose: (path: string) => void;
  /** True while the SKILL.md draft differs from the saved version — the manifest tab's own marker.
   *  It is NOT held on a working-tree entry: the manifest is written by the draft's `content`, so
   *  its dirty state comes from the draft, not from `files`. */
  manifestDirty: boolean;
};

export function StudioFileTabs({
  tabs,
  active,
  onSelect,
  onClose,
  manifestDirty,
}: StudioFileTabsProps) {
  // Keyed by path so a re-order/rename can never focus the wrong element; the node is looked up at
  // key-press time, not cached across renders.
  const tabNodes = useRef(new Map<string, HTMLButtonElement>());

  const paths = [DESIGNER_TAB, ...tabs.map((tab) => tab.path)];
  // The active path is always in the list (`activeTab()` guarantees it), but if it somehow is not,
  // the FIRST tab holds the single tab stop rather than the strip becoming unreachable.
  const rovingIndex = Math.max(0, paths.indexOf(active));

  const move = (index: number) => {
    const path = paths[index];
    if (path === undefined) return;
    // Focus FIRST: the node already exists and keeps its identity across the re-render `onSelect`
    // triggers, so the roving `tabIndex` lands on an element that is already focused.
    tabNodes.current.get(path)?.focus();
    onSelect(path);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = paths.length - 1;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        move(index === last ? 0 : index + 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        move(index === 0 ? last : index - 1);
        return;
      case "Home":
        event.preventDefault();
        move(0);
        return;
      case "End":
        event.preventDefault();
        move(last);
        return;
      case "Delete": {
        const path = paths[index];
        if (path === undefined || path === DESIGNER_TAB) return; // the Designer tab is pinned
        event.preventDefault();
        onClose(path);
        return;
      }
      default:
    }
  };

  return (
    <div className="flex w-full shrink-0 items-center border-border border-b bg-card">
      <div
        role="tablist"
        aria-label="Open files"
        aria-orientation="horizontal"
        className="flex min-w-0 flex-1 items-center overflow-x-auto"
      >
        {paths.map((path, index) => {
          const tab = tabs.find((entry) => entry.path === path);
          const isDesigner = path === DESIGNER_TAB;
          const isManifest = path === SKILL_MD;
          const selected = path === active;
          const Icon = isDesigner ? Workflow : FileText;
          return (
            // `presentation` keeps the wrapper out of the accessibility tree, so the tablist still
            // owns the tab (and its ×) directly.
            <div
              key={path}
              role="presentation"
              className={cn(
                "flex shrink-0 items-center border-b-2",
                selected ? "border-primary" : "border-transparent",
              )}
            >
              <Button
                ref={(node) => {
                  if (node) tabNodes.current.set(path, node);
                  else tabNodes.current.delete(path);
                }}
                role="tab"
                id={studioTabDomId(path)}
                aria-selected={selected}
                aria-controls={studioTabPanelDomId(path)}
                tabIndex={index === rovingIndex ? 0 : -1}
                variant="ghost"
                size="sm"
                title={isDesigner ? undefined : path}
                className={cn(
                  "gap-1.5 whitespace-nowrap rounded-none",
                  isDesigner ? "pr-3" : "pr-1.5",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
                onClick={() => onSelect(path)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <Icon className="size-3.5" aria-hidden />
                {isDesigner ? (
                  <span>{DESIGNER_TAB_LABEL}</span>
                ) : (
                  <span className="font-mono">{baseNameOf(path)}</span>
                )}
                {/* The Designer carries no marker of its own: a canvas edit moves the SAME document
                    the SKILL.md tab marks, and the toolbar's one dirty count already names it. */}
                <TabMarker
                  show={
                    isDesigner
                      ? false
                      : isManifest
                        ? manifestDirty
                        : tab?.entry !== undefined && isTabDirty(tab.entry)
                  }
                  label={!isManifest && tab?.entry?.originalPath === null ? "new" : "unsaved"}
                />
              </Button>

              {/* The × is a real SIBLING of the tab, always visible (never hover-only), and only in
                  the page tab order for the ACTIVE tab — reach any other one by arrowing to it
                  first (which selects it), or press Delete on the focused tab. */}
              {isDesigner ? null : (
                <IconButton
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1 size-6 shrink-0"
                  tabIndex={selected ? 0 : -1}
                  label={`Close ${baseNameOf(path)}`}
                  onClick={() => onClose(path)}
                >
                  <X aria-hidden className="size-3.5" />
                </IconButton>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
