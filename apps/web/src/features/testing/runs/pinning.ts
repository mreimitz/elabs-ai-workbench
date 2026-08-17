import { cn } from "@elabs-ai/components-ui";

/**
 * Column-pinning classes for the Runs feed's genuinely-wide table (S2 · WP 2.4).
 * =============================================================================
 *
 * The 1.4 `lib/table.tsx` `pinnedCellClass` helper is the reference technique — `position: sticky`
 * on the cell plus a negative-margin "bleed" that eats brand-ui's `px-3` cell padding so the opaque
 * fill spans the full column and sibling cells scroll cleanly behind it. It works, and this mirrors
 * its exact geometry (@elabs-ai/components-ui `Table` cells are `px-3 py-2`, same as @elabs-ai/components-data's).
 *
 * The ONE thing it can't do for this feed: `pinnedCellClass` hard-codes `bg-card`. The Runs table has
 * THREE row surfaces (single/member runs on the card surface, suite summary rows tinted `bg-muted`,
 * group headers), and a pinned cell MUST be OPAQUE and MATCH its row — a `bg-card` patch over a
 * `bg-muted` row (or a semi-transparent `bg-muted/20`) lets the scrolled middle bleed through the
 * pinned column. So this variant takes the row's own solid background token. (Reported to the PM as
 * the 1.4 helper's one gap: `pinnedCellClass(side)` needs an optional `bg` param for tinted rows.)
 */

export type PinSide = "left" | "right";

/** Which surface a Runs-table row sits on — pins fill with the MATCHING opaque token. */
export type RowSurface = "card" | "muted";

const SURFACE_BG: Record<RowSurface, string> = {
  card: "bg-card",
  muted: "bg-muted",
};

/**
 * Sticky pinned-column cell. `side` picks the edge; `surface` the opaque fill (must equal the row's
 * background). Body cells sit at `z-20`; the pinned header corner at `z-30` so it clears both the
 * sticky header row (`z-10`) and pinned body cells while horizontally + vertically scrolling.
 */
export function pinCell(side: PinSide, surface: RowSurface, opts?: { header?: boolean }): string {
  const bg = SURFACE_BG[surface];
  if (opts?.header) {
    return cn("sticky", bg, side === "left" ? "left-0 -ml-3 pl-3" : "right-0 -mr-3 pr-3", "z-30");
  }
  return cn(
    "sticky",
    bg,
    // eat the surrounding cell padding so the opaque fill spans the full column height + width
    "-my-2 py-2",
    side === "left" ? "left-0 -ml-3 pl-3" : "right-0 -mr-3 pr-3",
    "z-20",
  );
}

/** A sticky top header cell (non-pinned). Pairs with `pinCell(side, surface, { header:true })` on the
 *  pinned Name/Actions header cells so the whole header row stays put while the body scrolls. */
export function stickyHeadClass(surface: RowSurface = "card"): string {
  return cn("sticky top-0 z-10", SURFACE_BG[surface]);
}
