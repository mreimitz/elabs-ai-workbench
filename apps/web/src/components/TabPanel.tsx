import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsTrigger, Text, cn } from "@brand/ui";
import { ScrollableTabsList } from "./ScrollableTabsList";

/**
 * TabPanel — the ONE tab-shell contract for every detail page (audit §S4 tab-bar + §S21 tab-shell
 * + §S22 scroll). Servers, Scans, Skills, Collections and the console all live in tabs; this is as
 * load-bearing as `PageShell`, so the API is stable and Phase 2 migrates the other tab surfaces
 * onto it.
 * =============================================================================================
 *
 * WHAT IT GUARANTEES (the six tab-shell rules)
 *   1. STABLE FRAME — everything above the tab strip (`header` + the strip itself) renders
 *      identically for EVERY tab and is pinned (`shrink-0`, never scrolls). Switching tabs moves
 *      NOTHING above the content region: the strip stays at one y so the control you just clicked
 *      never jumps away. (Fixes the ~200px jump the audit measured on server detail.)
 *   2. ONE STRIP→CONTENT OFFSET — a single 16px gap between the strip and the content region on
 *      every tab (`gap-4` on the column).
 *   3. FULL-WIDTH CENTERED TAB BAR (D-UX16) — the strip is a full-width row (`w-full`) with the
 *      `@brand/ui` `TabsList` (recessed muted track) CENTERED in it; it stays pinned and horizontally
 *      scrolls (never clips) when the tabs exceed the width. (Superseded the earlier left-aligned
 *      shrink-to-content pills after owner acceptance.)
 *   4. PER-TAB DESCRIPTION + ACTIONS on one row directly under the strip (owned by
 *      `TabPanelContent`, not here) — absorbs "View all tests", "+ New suite", legends, etc.
 *   5. CARD-VS-FLAT — the CALLER passes flat content for single-region tabs (a bare table/list/
 *      canvas: density wins inside an already-carded detail context) and cards only for multi-panel
 *      compositions (Overview-style). A lone full-width card around one table is banned.
 *   6. SHARED SPLIT-PANE + EMPTY-STATE — use `SplitPane`/`SplitPanePanel` (two-pane tabs) and
 *      `TabEmptyState` (empty tabs) so those recipes never diverge per tab.
 *
 * MOUNTING
 *   TabPanel fills its parent (`h-full min-h-0`), so its parent must be a definite-height,
 *   non-scrolling flex box (on server detail: the detail view's `flex h-full min-h-0 flex-col`
 *   under `PageShell`). It owns the strip + the per-tab content region; it does NOT render the page
 *   title — keep the WP-1.2 `PageShell`/`PageHeader` above it (or, on a legacy detail view, its
 *   existing `SectionHeader`) and feed the compact identity/stat strip in via `header`.
 *
 * PUBLIC API
 *   value          : string                  — the active tab value (controlled).
 *   onValueChange  : (value) => void         — tab-change handler.
 *   header?        : ReactNode               — the STABLE frame above the strip (identity +
 *                                              compact stat strip). Rendered on every tab, pinned.
 *                                              Keep it identical across tabs — that is the contract.
 *   tabs           : TabPanelTab[]           — the strip: `{ value, label, count?, disabled? }`.
 *                                              `count` renders as a muted, value-neutral suffix
 *                                              (a 0 reads neutral, never red/green — §S3).
 *   children       : ReactNode               — the `TabPanelContent` nodes (one per tab).
 *   className?     : string                  — layout-only classes for the outer column.
 *   tabsListClassName? : string              — layout-only classes for the strip.
 *
 * MINIMAL USAGE
 *   <TabPanel value={tab} onValueChange={setTab}
 *     header={<><SectionHeader … /><CompactStatStrip … /></>}
 *     tabs={[{ value: "overview", label: "Overview" },
 *            { value: "tools", label: "Tools", count: scan?.totalTools }]}>
 *     <TabPanelContent value="overview">…cards…</TabPanelContent>
 *     <TabPanelContent value="tools" scroll={false}><SplitPane … /></TabPanelContent>
 *   </TabPanel>
 */
export interface TabPanelTab {
  value: string;
  label: ReactNode;
  /** Optional count suffix (e.g. tool inventory size). Rendered muted + value-neutral (0 = neutral). */
  count?: number;
  disabled?: boolean;
}

export interface TabPanelProps {
  value: string;
  onValueChange: (value: string) => void;
  header?: ReactNode;
  tabs: TabPanelTab[];
  children: ReactNode;
  className?: string;
  tabsListClassName?: string;
}

export function TabPanel({
  value,
  onValueChange,
  header,
  tabs,
  children,
  className,
  tabsListClassName,
}: TabPanelProps) {
  return (
    // `gap-4` here is the ONE strip→content offset (16px), applied on every tab.
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={cn("flex h-full min-h-0 flex-col gap-4", className)}
    >
      {/* ── STABLE FRAME — identical for every tab; pinned, never scrolls ── */}
      <div className="flex shrink-0 flex-col gap-4">
        {header}
        {/* D-UX16 (owner re-walk, WP 6.8): a TRULY full-width tab BAR with the triggers CENTERED
            within it — the `fullWidth` prop makes the scroll container `w-full` and the `@brand/ui`
            recessed track `w-full justify-center-safe`, so the bar spans the content width and the
            triggers sit centered (not a shrink-to-content pill group floating in empty space). The
            container's `overflow-x-auto` still scrolls horizontally when the tabs exceed the width
            (`safe` centering falls back to start-alignment on overflow, so nothing is clipped). */}
        <ScrollableTabsList fullWidth className={tabsListClassName}>
          {tabs.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} disabled={entry.disabled}>
              {entry.label}
              {entry.count != null ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground">{entry.count}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </ScrollableTabsList>
      </div>

      {/* Only the active TabPanelContent renders (Radix), and it takes the flex-1 content region. */}
      {children}
    </Tabs>
  );
}

/**
 * TabPanelContent — one tab's content region under the shared strip (audit §S21.2/.3/.4, §S22).
 * ---------------------------------------------------------------------------------------------
 * Renders (top → bottom): an optional per-tab description + actions row (rule 4), then the tab
 * body. The description row is pinned (`shrink-0`) above the body so it stays visible while the
 * body scrolls; the body is the tab's only scroll container in the default `scroll="content"`
 * mode — matching `PageShell`'s content contract, one level down.
 *
 * CARD-VS-FLAT (rule 5) is the caller's job: pass a bare table/list for a single-region tab, or a
 * grid of `Card`s for a multi-panel (Overview) tab. Do NOT wrap a single table in a lone card.
 *
 * NEVER re-title with the tab's own label (rule 3): the tab strip already says which tab this is.
 * Use `description` for the muted one-liner and `actions` for the right-aligned controls.
 *
 * PUBLIC API
 *   value        : string          — matches a `TabPanelTab.value`.
 *   description? : ReactNode        — one muted line directly under the strip.
 *   actions?     : ReactNode        — right-aligned per-tab actions on that same row.
 *   scroll?      : boolean          — default true: the body is the tab's scroll container
 *                                     (`overflow-y-auto`). Pass `false` for a tab whose child
 *                                     owns its own scroll (a `SplitPane`, a full-height canvas).
 *   className?   : string           — layout-only classes for the content region.
 *   bodyClassName? : string         — layout-only classes for the body wrapper (e.g. change the
 *                                     default `gap` when stacking cards).
 *   children     : ReactNode        — the tab body.
 */
export interface TabPanelContentProps {
  value: string;
  description?: ReactNode;
  actions?: ReactNode;
  scroll?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function TabPanelContent({
  value,
  description,
  actions,
  scroll = true,
  className,
  bodyClassName,
  children,
}: TabPanelContentProps) {
  const hasHeaderRow = description != null || actions != null;
  return (
    <TabsContent
      value={value}
      // `mt-0` cancels the brand default top margin — the column `gap-4` is the sole strip→content
      // offset. The active content owns the whole remaining height (`flex-1 min-h-0`).
      className={cn(
        "mt-0 flex min-h-0 flex-1 flex-col gap-3 focus-visible:outline-none",
        className,
      )}
    >
      {hasHeaderRow ? (
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          {description != null ? (
            <Text tone="muted" className="min-w-0 text-pretty">
              {description}
            </Text>
          ) : (
            <span />
          )}
          {actions != null ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          scroll ? "min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" : "min-h-0 flex-1",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </TabsContent>
  );
}
