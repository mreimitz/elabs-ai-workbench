import type { ReactNode } from "react";
import { Badge, Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@elabs-ai/components-ui";
import { Info, X } from "lucide-react";
import { IconButton } from "./IconButton";

/**
 * A single applied filter, rendered as a removable chip in the `ViewToolbar` left cluster.
 * (Moved here from the retired `TableToolbar` — D-TB6 — so its one consumer keeps working.)
 */
export interface ActiveFilterChip {
  /** Stable key for the chip. */
  id: string;
  /** Human label, e.g. "Status: Failed". Written label-in-value, not "Status = failed". */
  label: string;
  /** Remove just this filter. */
  onRemove: () => void;
}

/**
 * ViewToolbar — the ONE toolbar row every view mounts above its content (toolbar standard
 * 2026-07-11; the `RunBar` one-row grammar, generalised). The program keystone TB.0.
 * =============================================================================================
 *
 * WHAT IT IS
 *   A single presentational row — `[info] [left status/context/filters cluster] ····· [right actions]` —
 *   whose default height is 12 units. It is the built reference (`features/testing/RunBar.tsx`) lifted
 *   into a shared primitive so EVERY view renders the same toolbar grammar: breadcrumb names the page,
 *   this row carries its state + controls, the body carries content. As of D-TB6 (2026-07-25) it is the
 *   SINGLE toolbar contract — the old `TableToolbar` recipe is deleted and its `results`/`activeFilters`
 *   slots are folded in here.
 *
 * WHY (locked owner decisions, toolbar-standard-2026-07-11.md §1 + toolbar-reach D-TB6/D-TB7)
 *   • D-TB1 — the AppShell breadcrumb owns page identity; in-page H1 title + description blocks
 *     are removed on ALL views. A description worth keeping moves to THIS row's info (ⓘ) tooltip
 *     (`info`); the rest are dropped. `PageHeader` (title/description) is retired in its favour.
 *   • D-TB2 — exactly ONE toolbar row per view. Filters / search / pickers / status chips /
 *     truncating muted meta are the `left` cluster of that same row; the view's buttons are
 *     `actions`. No second header row, no floating controls, no stats strip as chrome (metrics
 *     are content — they live in the body, stated once, D-TB4).
 *   • D-TB3 — `actions` is NEVER an assistant "Analyze…"/"Explain…" hook; those live only in the
 *     Assistant dock.
 *   • D-TB6 — `TableToolbar` is retired. Its `results` (count/summary meta) and `activeFilters`
 *     (removable filter chips + "Clear all") slots move here; that component is deleted. Two
 *     contracts for one row was the root cause of the Environments double-toolbar (finding B-2).
 *   • D-TB7 — ViewToolbar OWNS the left layout. It renders `left` (with `results` + `activeFilters`)
 *     inside `flex min-w-0 flex-wrap items-center gap-2` ITSELF, so consumers pass controls, not
 *     layout. The row wrapper is `min-h-12` (not a fixed `h-12`) so a wrapping cluster grows without
 *     clipping while still defaulting to the 12-unit height — the "toolbar row top identical on every
 *     view" invariant holds (the row's top edge is unchanged).
 *
 * THE INVARIANT IT SERVES
 *   "The toolbar row top is identical on every view." This SUPERSEDES the old S16 contract
 *   ("the title top is identical on every route") now that the title block is gone: dropped into
 *   `PageShell`'s `headerVariant="toolbar"` slot, this row sits at the same x/y on every route.
 *
 * FRAME-LIGHT ON PURPOSE
 *   ViewToolbar owns ONLY the row rhythm — its height (`min-h-12`), item alignment, gaps, and the
 *   left-cluster wrapping. It does NOT own the border / background / horizontal gutter, so the SAME
 *   component drops cleanly into BOTH placements without double-framing:
 *     • `PageShell headerVariant="toolbar"` — the shell supplies `border-b`, `bg-card` (the RunBar
 *       "lift" above the content), and the gutter.
 *     • a detail-pane sub-header — the pane supplies its own frame; the toolbar just lays out the row.
 *
 * PUBLIC API
 *   left?         : ReactNode  — the status/context cluster: `StatusBadge`, chips, filters/search/
 *                                pickers, truncating muted meta. Rendered inside the `min-w-0
 *                                flex-wrap` cluster ViewToolbar owns, so it yields to the actions and
 *                                wraps rather than clipping; put `min-w-0 truncate` on a child that
 *                                must truncate. Pass controls, not a wrapper `<div>` (D-TB7).
 *   results?      : ReactNode  — a count/summary, rendered at the TAIL of the left cluster as muted
 *                                `tabular-nums` meta (the position `TableToolbar.results` had). Pass
 *                                the standard count `Badge` (C-5) or a `tabular-nums` span.
 *   activeFilters?: ActiveFilterChip[] — removable filter chips, rendered INLINE within the single
 *                                wrapping left row (never a bordered/padded second band — that is the
 *                                D-TB2 violation). Each chip is removable.
 *   onClearAll?   : () => void — clears every active filter at once; the "Clear all" button shows
 *                                only when there is ≥1 active chip.
 *   actions?      : ReactNode  — the view's action buttons / menu. Rendered `ml-auto shrink-0`, so it
 *                                pins right and never shrinks; primary action last (right-most). NEVER
 *                                an assistant "Analyze/Explain" hook (D-TB3). Right-aligned view
 *                                controls (e.g. `ColumnPicker`) also live here.
 *   info?         : ReactNode  — optional onboarding text (D-TB1), surfaced as an info (ⓘ) tooltip at
 *                                the head of the row — the single home for a description worth keeping.
 *   className?    : string     — layout-only escape hatch for the row wrapper.
 *
 * Every visible element is `@elabs-ai/components-ui` or a `lucide-react` glyph; semantic tokens only; `className`
 * is layout-only. The info tooltip needs the app-root `TooltipProvider` (already mounted).
 *
 * MINIMAL USAGE (literally what `EnvironmentsView` now does — the canonical B-2 fix)
 *   // (a) Top-level list — the shell frames the row (border-b + bg-card + gutter):
 *   <PageShell headerVariant="toolbar" header={
 *     <ViewToolbar
 *       left={<SearchInput … />}
 *       results={<Badge variant="secondary" className="tabular-nums">12 environments</Badge>}
 *       actions={<Button onClick={onNew}>New environment</Button>}
 *     />
 *   }>
 *     …content…
 *   </PageShell>
 *
 *   // (b) Detail pane — the pane owns its own frame; the toolbar just lays out its row:
 *   <ViewToolbar
 *     left={<Text variant="meta" tone="muted" className="min-w-0 truncate">{profile} · {date}</Text>}
 *     actions={<Button variant="outline" size="sm">Diff vs previous</Button>}
 *   />
 */
export type ViewToolbarProps = {
  left?: ReactNode;
  results?: ReactNode;
  activeFilters?: ActiveFilterChip[];
  onClearAll?: () => void;
  actions?: ReactNode;
  info?: ReactNode;
  className?: string;
};

export function ViewToolbar({
  left,
  results,
  activeFilters,
  onClearAll,
  actions,
  info,
  className,
}: ViewToolbarProps) {
  const hasActive = (activeFilters?.length ?? 0) > 0;
  const hasCluster = left != null || results != null || hasActive;
  return (
    <div className={cn("flex min-h-12 items-center gap-3", className)}>
      {/* The ⓘ onboarding tooltip (D-TB1) — the single home for a kept description. MATCHES the
          RunBar Locked-chip pattern: `TooltipTrigger` (a Radix button, base-reset by Tailwind) is
          the genuinely interactive, keyboard-focusable element with a visible focus ring + an
          `aria-label`; the `Info` glyph is decorative (`aria-hidden`). */}
      {info ? (
        <Tooltip>
          <TooltipTrigger
            aria-label="About this view"
            className="inline-flex shrink-0 cursor-default rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info aria-hidden className="size-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>{info}</TooltipContent>
        </Tooltip>
      ) : null}
      {/* The status/context/filters cluster — ViewToolbar OWNS this layout (D-TB7): `min-w-0` so it
          yields to the actions and lets a truncating child collapse; `flex-wrap` so search + facets +
          count + active-filter chips reflow onto one growing row rather than clipping or pushing the
          actions off-row. `results` sits at its tail; `activeFilters` render INLINE here (D-TB6) —
          never a bordered second band. */}
      {hasCluster ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {left}
          {results != null ? (
            <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground tabular-nums">
              {results}
            </div>
          ) : null}
          {hasActive ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilters?.map((chip) => (
                <Badge key={chip.id} variant="secondary" className="gap-1 pr-1">
                  <span className="truncate">{chip.label}</span>
                  <IconButton
                    variant="ghost"
                    className="size-4 rounded-sm text-muted-foreground hover:text-foreground"
                    onClick={chip.onRemove}
                    label={`Remove filter ${chip.label}`}
                  >
                    <X className="size-3" aria-hidden />
                  </IconButton>
                </Badge>
              ))}
              {onClearAll ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-muted-foreground"
                  onClick={onClearAll}
                >
                  Clear all
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* The view's actions: pinned right (`ml-auto`) and never shrinking (`shrink-0`). */}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
