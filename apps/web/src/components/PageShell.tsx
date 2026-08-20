import type { ReactNode } from "react";
import { cn } from "@elabs-ai/components-ui";

/**
 * PageShell — the ONE page frame every route mounts into (audit §S16 page-shell + §S22 scroll
 * contract; the program keystone). Phase 2 migrates ~10 views onto it, so this API is stable.
 * =============================================================================================
 *
 * WHAT IT GUARANTEES
 *   1. A viewport-filling column: an optional fixed `header` slot (never scrolls) above a content
 *      region that is the *only* scroll container and fills the remaining height exactly — so a
 *      single empty state (no dead sea below it) and a thousand rows both fill the viewport.
 *   2. One gutter token everywhere: 32px left/right + 24px top/bottom on desktop, 16px below
 *      1200px (`min-[1200px]:` breakpoint). Header and content share the horizontal gutter, so the
 *      title and the content align on the same left edge on every route.
 *   3. The page title sits at an identical x/y on every route (the `header` slot has the SAME
 *      padding on every archetype; only the CONTENT body honours `width`). Navigating between two
 *      PageShell routes must not move the title a single pixel at a given viewport width.
 *
 * MOUNTING (important)
 *   PageShell fills its parent with `h-full`, so its parent must be a definite-height, non-padding,
 *   non-scrolling box. In this app that is `AppShell`'s edge-to-edge `<main>` — App.tsx passes
 *   `fullBleed` for PageShell routes so `<main>` becomes `flex-1 min-h-0 overflow-hidden` (no
 *   padding, no scroll) and PageShell owns the gutter + scroll. Do NOT wrap PageShell in another
 *   padded/scrolling container.
 *
 * PUBLIC API
 *   header?          : ReactNode                 — the fixed page header, normally a `<PageHeader>`.
 *                                                  Omit for a header-less full-bleed body.
 *   headerVariant?   : "default" | "toolbar" (default "default") — see the header variants below.
 *   children         : ReactNode                 — the page content (the scroll region's contents).
 *   width?           : WidthMode  (default "full") — content-body max width; see the enum below.
 *   scroll?          : "content" | "body" | "fill"  (default "content") — see the scroll modes below.
 *   bodyGutter?      : "default" | "none" (default "default") — drop the content-region gutter (the
 *                                                  32/24px frame) so the body goes edge-to-edge. Only
 *                                                  honoured by `scroll="fill"` (a full-bleed workspace
 *                                                  like the Assistant chat, where the content supplies
 *                                                  its own padding / centred reading column). The
 *                                                  default keeps every existing route byte-identical.
 *   className?       : string                    — layout-only classes for the outer column.
 *   contentClassName?: string                    — layout-only classes for the content wrapper
 *                                                  (e.g. change the default `gap-6` stacking).
 *
 * HEADER VARIANT — `headerVariant` (compact command-bar header; compare-redesign D1)
 *   The fixed `header` slot keeps its position (never scrolls), horizontal gutter, and bottom border
 *   in EVERY variant — only its vertical rhythm and background change:
 *     • "default" (DEFAULT) — the title header: the full top/bottom gutter (`pt-4/6 pb-4`), no
 *                             background of its own. This is the S16 "title at an identical x/y on
 *                             every route" contract; every existing route renders BYTE-IDENTICALLY
 *                             to before (the default path is the same class string it always
 *                             produced — the toolbar variant's extras append `""` here).
 *     • "toolbar"           — a compact command-bar row (reduced `py-2` padding) carrying `bg-card`
 *                             so it reads as a distinct lifted surface above the content, for routes
 *                             whose header IS a control surface, not a title block. This is the slot
 *                             the shared one-row `ViewToolbar` (`components/ViewToolbar.tsx`, the
 *                             toolbar standard) is meant to host — as well as the Compare Workspace's
 *                             one-row workspace bar and the run console. Pair it with an `sr-only`
 *                             `<h1>` in the body so the breadcrumb-named page still has a heading.
 *                             Works with every `scroll` + `width` mode.
 *   The variant only changes the header's vertical padding + background; the body/scroll/width paths
 *   are untouched.
 *
 * WIDTH MODE — `width` (audit §C archetype width rules)
 *   The header is ALWAYS full-width-with-gutter (title pinned to the left gutter on every route);
 *   `width` constrains only the CONTENT body:
 *     • "full"          — no max width. Catalog pages (tables earn full-bleed): Runs, Environments,
 *                         Collections list, Compatibility. DEFAULT.
 *     • "centered"      — `mx-auto max-w-[1400px]`. Reading/config surfaces: Overview (Dashboard),
 *                         Composer (Compare, Run launcher) and Settings.
 *     • "master-detail" — full width. A detail pane reached by drilling in from a list. RM-32 removed
 *                         the fixed 288px sibling rail this used to sit beside (the list is now an
 *                         overview PAGE, and switching entities is a breadcrumb popover), so the mode
 *                         is now purely a record of the archetype. Servers / Scans detail.
 *     • "workbench"     — full width. Dense operator surfaces (Run console, Tool playground); the
 *                         320px side rail that stacks below content under 1200px is supplied by the
 *                         VIEW, not by PageShell.
 *   ("full", "master-detail" and "workbench" resolve to the same max-width today; they are distinct
 *   names so Phase 2 records archetype INTENT and the rule can diverge later without a rename.)
 *
 * SCROLL MODE — `scroll` (audit §S22)
 *   • "content" (DEFAULT) — the header is a fixed, non-scrolling row; the content region below is
 *                           the only scroll container (`flex-1 min-h-0 overflow-y-auto`). Use for
 *                           every archetype EXCEPT document pages. This is the contract that keeps
 *                           the title, and (with WP 1.4) sticky table headers, on screen at any
 *                           scroll depth.
 *   • "body"              — the whole page body scrolls while the header stays put via
 *                           `position: sticky`. The lone sanctioned exception, for Settings-style
 *                           document pages (audit §S22.4).
 *   • "fill"              — the content region FILLS the viewport height and does NOT scroll itself
 *                           (`flex-1 min-h-0 overflow-hidden`, a flex column). Instead its child (a
 *                           `TabPanel` body, a `SplitPane`'s two panes, a full-height `DataTable`)
 *                           owns the scroll INTERNALLY, so a fixed frame (header + any pinned strip)
 *                           stays put while only the inner region scrolls. Use for tabbed /
 *                           master-detail / table detail views where a compact stat strip + tab strip
 *                           must never scroll away with the rows (audit §S22; owner finding #1/#2).
 *                           The child must fill (`h-full` / `flex-1 min-h-0`) and own its own scroll
 *                           — PageShell provides the fixed, viewport-filling frame and the gutter,
 *                           nothing more. This is the mode server/scan/run/console detail adopt.
 *
 * MINIMAL USAGE
 *   // Catalog (default): header fixed, table scrolls internally.
 *   <PageShell header={<PageHeader title="Environments" description="Run targets…" actions={…} />}>
 *     <DataTable … />
 *   </PageShell>
 *
 *   // Document page: centered, body-scroll with a sticky header (the exception).
 *   <PageShell width="centered" scroll="body" header={<PageHeader title="Settings" … />}>
 *     …cards…
 *   </PageShell>
 */
export type PageShellWidth = "full" | "centered" | "master-detail" | "workbench";
export type PageShellScroll = "content" | "body" | "fill";
export type PageShellHeaderVariant = "default" | "toolbar";
export type PageShellBodyGutter = "default" | "none";

export type PageShellProps = {
  header?: ReactNode;
  headerVariant?: PageShellHeaderVariant;
  children: ReactNode;
  width?: PageShellWidth;
  scroll?: PageShellScroll;
  bodyGutter?: PageShellBodyGutter;
  className?: string;
  contentClassName?: string;
};

// One gutter token, shared by the header slot and the content region so they align on the same
// left edge. 16px below 1200px, 32px x / 24px y at ≥1200px.
const GUTTER_X = "px-4 min-[1200px]:px-8";
const GUTTER_TOP = "pt-4 min-[1200px]:pt-6";
const GUTTER_BOTTOM = "pb-4 min-[1200px]:pb-6";

// The header slot's vertical padding, by variant. "default" is byte-identical to the original inline
// `GUTTER_TOP, "pb-4"`; "toolbar" is a compact command-bar row. Only the vertical rhythm changes —
// the horizontal gutter, fixed position, and bottom border are shared by both variants.
const HEADER_PAD: Record<PageShellHeaderVariant, string> = {
  default: `${GUTTER_TOP} pb-4`,
  toolbar: "py-2",
};

// The header slot's background, by variant. "default" is the EMPTY string — appended to the header
// `cn(...)` it contributes nothing, so every existing (default) route's header class string is
// byte-identical to before. "toolbar" carries `bg-card` so a `ViewToolbar` dropped into the slot
// gets the RunBar "lift" above the content (a distinct surface, not flush with the body background).
const HEADER_BG: Record<PageShellHeaderVariant, string> = {
  default: "",
  toolbar: "bg-card",
};

const WIDTH_CLASS: Record<PageShellWidth, string> = {
  full: "",
  centered: "mx-auto max-w-[1400px]",
  "master-detail": "",
  workbench: "",
};

export function PageShell({
  header,
  headerVariant = "default",
  children,
  width = "full",
  scroll = "content",
  bodyGutter = "default",
  className,
  contentClassName,
}: PageShellProps) {
  // The header slot's vertical padding for this render. "default" resolves to the same class string
  // the shell always emitted, so every existing route is unchanged.
  const headerPad = HEADER_PAD[headerVariant];
  // The header slot's background for this render. "default" is "" (appends nothing → byte-identical
  // header for every existing route); "toolbar" adds `bg-card` so a ViewToolbar in the slot lifts.
  const headerBg = HEADER_BG[headerVariant];
  // The content body: shared horizontal gutter + width mode, laid out as a min-viewport-height
  // column so short content (an empty state) still fills the region — no dead sea — and a child
  // with `flex-1` can vertically centre itself.
  const body = (
    <div
      className={cn("flex min-h-full w-full flex-col gap-6", WIDTH_CLASS[width], contentClassName)}
    >
      {children}
    </div>
  );

  if (scroll === "fill") {
    // Viewport-filling frame with NO outer scroll: the content region fills the remaining height and
    // hides its own overflow, so its child (TabPanel / SplitPane / full-height table) is the single
    // internal scroll region and the header + any pinned strip inside never scroll away.
    // `bodyGutter="none"` drops the content-region frame entirely so a full-bleed workspace (the
    // Assistant chat) can go edge-to-edge and supply its own padding / centred reading column.
    const flush = bodyGutter === "none";
    return (
      <div className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}>
        {header ? (
          <div className={cn("shrink-0 border-b border-border", GUTTER_X, headerPad, headerBg)}>
            {header}
          </div>
        ) : null}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            !flush && GUTTER_X,
            !flush && GUTTER_TOP,
            !flush && GUTTER_BOTTOM,
          )}
        >
          <div
            className={cn(
              "flex min-h-0 w-full flex-1 flex-col",
              WIDTH_CLASS[width],
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  if (scroll === "body") {
    // Document-page exception (Settings): the whole column scrolls; the header sticks to the top.
    return (
      <div className={cn("h-full min-h-0 w-full overflow-y-auto bg-background", className)}>
        {header ? (
          <div
            className={cn(
              "sticky top-0 z-10 border-b border-border bg-background",
              GUTTER_X,
              headerPad,
              headerBg,
            )}
          >
            {header}
          </div>
        ) : null}
        <div className={cn(GUTTER_X, GUTTER_TOP, GUTTER_BOTTOM)}>{body}</div>
      </div>
    );
  }

  // Default: fixed header, the content region is the only scroll container and fills the viewport.
  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col bg-background", className)}>
      {header ? (
        <div className={cn("shrink-0 border-b border-border", GUTTER_X, headerPad, headerBg)}>
          {header}
        </div>
      ) : null}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", GUTTER_X, GUTTER_TOP, GUTTER_BOTTOM)}>
        {body}
      </div>
    </div>
  );
}
