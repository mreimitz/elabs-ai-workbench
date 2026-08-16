import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Text,
  cn,
} from "@brand/ui";
import { FileOutput, Info, ListTodo, PanelRightClose } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { META_RAIL_WIDTH_PX } from "../lib/hub-ux";
import { ContextSection, type MetaRailContextProps } from "./ContextSection";
import { OutputsSection, type MetaRailOutputsProps } from "./OutputsSection";
import { ProgressSection, type MetaRailProgressProps } from "./ProgressSection";
import { RailSection } from "./RailSection";
import { useMetaRailNarrow } from "./use-meta-rail-narrow";

/**
 * Assistant Hub UX (WP1.2, D-HUX3) — the workspace's ONE meta rail: 360 px, `shrink-0`, own scroll;
 * stacked, individually collapsible sections **Progress · Outputs · Context** (the Cowork-panel
 * pattern the owner pointed at); one master show/hide toggle (`open`/`onOpenChange`, driven by a
 * `Toggle` the toolbar owns — WP1.1's territory, not rendered here); a `Sheet` fallback under
 * ~1100 px of content width. Replaces the artifact aside, the context aside, and the Files modal —
 * the three-way `activeAside` switch this retires lived in `AssistantView.tsx` (WP1.1 wires this
 * component into that view's `metaRail` slot at wave merge; see the WP1.2 handoff report for the
 * exact prop contract).
 *
 * Self-contained: every prop is already-resolved data (or a callback) — no `lib/api` calls, no
 * internal session fetching, so it renders deterministically from fixtures in isolation (unit tests
 * don't need to mock the network). `session`/`inspector`/etc. all move together as ONE `context`
 * bundle (mirrors the `progress`/`outputs` groupings) rather than a flat 20-prop interface.
 */
export type MetaRailSectionId = "progress" | "outputs" | "context";

export type MetaRailProps = {
  /** The master show/hide state (D-HUX3's "one master show/hide toggle in the toolbar"). Controlled
   *  — `AssistantView`'s toolbar `Toggle` owns this boolean and flips it via `onOpenChange`. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Override the rail's own viewport-width heuristic for the `Sheet` fallback (D-HUX3, "under
   *  ~1100 px of content width") — pass a real container-width measurement once the two-column
   *  workspace layout (WP1.1) can supply one. Omit to use `useMetaRailNarrow`'s default. */
  isNarrow?: boolean;
  /**
   * T3 fix — forwarded to the narrow `Sheet`'s Radix `onCloseAutoFocus`. This `Sheet` has no
   * `SheetTrigger` (it's driven externally via `open`/`onOpenChange`), so Radix's default close-focus
   * restoration has nothing sensible to return to and focus falls to `<body>`. Pass a handler that
   * calls `event.preventDefault()` and moves focus somewhere meaningful (the caller's composer).
   * Ignored in wide mode (there is no dialog to auto-focus).
   */
  onNarrowCloseAutoFocus?: (event: Event) => void;
  progress: MetaRailProgressProps;
  outputs: MetaRailOutputsProps;
  context: MetaRailContextProps;
  /** Per-section initial open/closed state (§8.3: "remembered per session mode — Progress matters
   *  most mid-mission, Context most in chat" is the caller's call; this just seeds it). Defaults:
   *  Progress + Context open, Outputs collapsed. */
  defaultOpenSections?: Partial<Record<MetaRailSectionId, boolean>>;
  className?: string;
};

export function MetaRail({
  open,
  onOpenChange,
  isNarrow: isNarrowProp,
  onNarrowCloseAutoFocus,
  progress,
  outputs,
  context,
  defaultOpenSections,
  className,
}: MetaRailProps) {
  const detectedNarrow = useMetaRailNarrow();
  const isNarrow = isNarrowProp ?? detectedNarrow;

  const [sectionOpen, setSectionOpen] = useState<Record<MetaRailSectionId, boolean>>({
    progress: defaultOpenSections?.progress ?? true,
    outputs: defaultOpenSections?.outputs ?? false,
    context: defaultOpenSections?.context ?? true,
  });
  const setSectionOpenFor = (id: MetaRailSectionId) => (next: boolean) =>
    setSectionOpen((prev) => ({ ...prev, [id]: next }));

  const progressCount = progress.tasks.length + (progress.missionBoard?.agents.length ?? 0);
  const outputsCount =
    outputs.artifacts.length + outputs.files.length + (outputs.snapshots?.length ?? 0);

  const body = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto">
      <RailSection
        id="progress"
        label="Progress"
        icon={<ListTodo aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        count={progressCount}
        open={sectionOpen.progress}
        onOpenChange={setSectionOpenFor("progress")}
      >
        <ProgressSection {...progress} />
      </RailSection>

      <RailSection
        id="outputs"
        label="Outputs"
        icon={<FileOutput aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        count={outputsCount}
        open={sectionOpen.outputs}
        onOpenChange={setSectionOpenFor("outputs")}
      >
        <OutputsSection {...outputs} />
      </RailSection>

      <RailSection
        id="context"
        label="Context"
        icon={<Info aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        open={sectionOpen.context}
        onOpenChange={setSectionOpenFor("context")}
      >
        <ContextSection {...context} />
      </RailSection>
    </div>
  );

  if (isNarrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-[360px] max-w-full flex-col gap-0 p-0"
          {...(onNarrowCloseAutoFocus ? { onCloseAutoFocus: onNarrowCloseAutoFocus } : {})}
        >
          <SheetHeader className="shrink-0 gap-1 border-border border-b p-4">
            <SheetTitle>Session</SheetTitle>
            <SheetDescription>Progress, outputs, and context for this session.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  // Wide mode ANIMATES open/closed rather than mounting/unmounting: the panel stays in the tree and
  // the OUTER wrapper transitions its width (META_RAIL_WIDTH_PX → 0) + opacity, clipping a
  // fixed-width INNER container so the sections never reflow mid-animation. When closed the wrapper
  // carries the `inert` attribute — it removes the subtree from both hit-testing and the tab order
  // (and is computed as hidden from assistive tech) in one attribute, so there's no separate
  // `aria-hidden`/`pointer-events-none` pair that can drift out of sync with `open`.
  return (
    <div
      className={cn(
        "flex h-full min-h-0 shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{ width: open ? META_RAIL_WIDTH_PX : 0 }}
      inert={!open}
      data-testid="meta-rail-wide"
    >
      <div
        className="flex h-full min-h-0 shrink-0 flex-col border-border border-l bg-card"
        style={{ width: META_RAIL_WIDTH_PX }}
        aria-label="Session meta rail"
      >
        {/* Header strip — the rail's own collapse control (replaces the toolbar toggle). Lives
            inside the fixed-width inner container so it clips cleanly during the collapse. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-4 py-2.5">
          <Text variant="meta" tone="muted" className="min-w-0 truncate uppercase tracking-wide">
            Session
          </Text>
          <IconButton
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            label="Hide the rail"
            className="shrink-0"
          >
            <PanelRightClose aria-hidden className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    </div>
  );
}

export type { MetaRailContextProps, MetaRailOutputsProps, MetaRailProgressProps };
export type { HubOutputFileEntry } from "./OutputsSection";
