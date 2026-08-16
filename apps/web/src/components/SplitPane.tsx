import type { ReactNode } from "react";
import { Badge, ResizableHandle, ResizablePanel, Text, cn } from "@brand/ui";
import { AdaptivePanelGroup } from "./AdaptivePanelGroup";

/**
 * SplitPane / SplitPanePanel — the ONE two-pane recipe for split tabs (audit §S21.5).
 * =============================================================================================
 * Tools, Files and any master-detail tab share this: two resizable panes with a VISIBLE divider,
 * min-widths that stop either pane collapsing to a sliver, a stack-below-768px fallback, and — the
 * point of the recipe — an IDENTICAL panel header on both panes (title · count · search/actions)
 * so the two columns' headers line up on one baseline instead of each inventing its own chrome.
 *
 * The divider is the resize handle (`ResizableHandle withHandle`); dragging it re-sizes the panes,
 * and below the brand mobile breakpoint the split stacks into one readable column (via
 * `AdaptivePanelGroup`), each pane keeping its own scroll.
 *
 * COMPOSE the panes from `SplitPanePanel` so both headers are the same fixed-height row:
 *
 *   <SplitPane
 *     start={
 *       <SplitPanePanel title="Tool inventory" count={rows.length} tone="muted"
 *         search={<SearchInput value={q} onValueChange={setQ} placeholder="Filter tools…" />}>
 *         <DataTable … />
 *       </SplitPanePanel>
 *     }
 *     end={
 *       <SplitPanePanel title="Tool detail">
 *         <ToolDetailPanel … />
 *       </SplitPanePanel>
 *     }
 *     startSize={32} startMinSize={24} endMinSize={40}
 *   />
 *
 * PUBLIC API — SplitPane
 *   start / end   : ReactNode   — the two panes (normally each a `SplitPanePanel`).
 *   startSize?    : number      — START pane initial size, % (default 32).
 *   startMinSize? : number      — START pane min size, % (default 24).
 *   endMinSize?   : number      — END pane min size, % (default 40).
 *   className?    : string      — layout-only classes for the group (defaults to `h-full`).
 *   handleLabel?  : string      — a11y label for the resize handle.
 */
export interface SplitPaneProps {
  start: ReactNode;
  end: ReactNode;
  startSize?: number;
  startMinSize?: number;
  endMinSize?: number;
  className?: string;
  handleLabel?: string;
}

export function SplitPane({
  start,
  end,
  startSize = 32,
  startMinSize = 24,
  endMinSize = 40,
  className,
  handleLabel = "Resize panels",
}: SplitPaneProps) {
  return (
    <AdaptivePanelGroup
      className={cn(
        // Fill the pane's definite-height parent AND, if mounted as a flex child, grow to fill it —
        // `min-h-0` lets the group shrink so each pane's internal scroll (not the frame) takes the
        // overflow. Overflow is hidden here so ONLY the two `SplitPanePanel` bodies scroll.
        "h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-border",
        className,
      )}
    >
      <ResizablePanel defaultSize={startSize} minSize={startMinSize} className="min-h-0">
        {start}
      </ResizablePanel>
      {/* The visible divider = the drag handle. */}
      <ResizableHandle withHandle aria-label={handleLabel} className="cursor-col-resize" />
      <ResizablePanel defaultSize={100 - startSize} minSize={endMinSize} className="min-h-0">
        {end}
      </ResizablePanel>
    </AdaptivePanelGroup>
  );
}

/**
 * SplitPanePanel — one pane of a `SplitPane`: a fixed-height header row (title · count · search ·
 * actions) with a bottom border, then a body that fills and (by default) scrolls internally. Both
 * panes use it so their headers are the SAME height and align across the divider (audit §S21.5).
 *
 * PUBLIC API
 *   title      : ReactNode              — required. The pane name (a SECTION label, e.g. "Tool
 *                                         detail" — not the selected item's own title, to avoid
 *                                         duplicating an inner panel's identity header).
 *   count?     : number                 — rendered as a muted, value-neutral `Badge` after the title
 *                                         ("N", or "N / total" via `countTotal`).
 *   countTotal?: number                 — when set and ≠ count, the badge reads "count / total"
 *                                         (a filtered inventory).
 *   search?    : ReactNode              — a search control (e.g. `SearchInput`) laid out inline,
 *                                         growing to fill the header row.
 *   actions?   : ReactNode              — right-aligned header actions.
 *   tone?      : "plain" | "muted"      — pane surface: "muted" recesses it (an inventory list),
 *                                         "plain" is the card surface (a detail pane). Default plain.
 *   scroll?    : boolean                — default true: the body scrolls (`overflow-auto`). Pass
 *                                         false when the child owns its own scroll.
 *   className? / headerClassName? / bodyClassName? : string — layout-only escape hatches.
 *   children   : ReactNode              — the pane body.
 */
export interface SplitPanePanelProps {
  title: ReactNode;
  count?: number;
  countTotal?: number;
  search?: ReactNode;
  actions?: ReactNode;
  tone?: "plain" | "muted";
  scroll?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function SplitPanePanel({
  title,
  count,
  countTotal,
  search,
  actions,
  tone = "plain",
  scroll = true,
  className,
  headerClassName,
  bodyClassName,
  children,
}: SplitPanePanelProps) {
  const countLabel =
    count != null && countTotal != null && countTotal !== count
      ? `${count} / ${countTotal}`
      : count;
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        tone === "muted" ? "bg-muted/40" : "bg-card",
        className,
      )}
    >
      {/* Fixed-height header row — the SAME height on both panes so they align across the divider. */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b border-border px-3",
          headerClassName,
        )}
      >
        <Text className="shrink-0 font-medium">{title}</Text>
        {count != null ? (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {countLabel}
          </Badge>
        ) : null}
        {search != null ? (
          <div className="min-w-0 flex-1">{search}</div>
        ) : (
          <div className="flex-1" />
        )}
        {actions != null ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div
        className={cn(
          scroll ? "min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]" : "min-h-0 flex-1",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
