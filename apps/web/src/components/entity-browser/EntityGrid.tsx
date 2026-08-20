import type { ReactNode } from "react";
import { Card, Skeleton } from "@elabs-ai/components-ui";

/** Above this many cards in one group, cards get the `content-visibility` hint (see `EntityCard`). */
const VIRTUALIZE_HINT_THRESHOLD = 24;

/**
 * The card grid (RM-32 D-OD8). `brand-ui` ships no card-grid component — `BentoGrid` is a marketing
 * spotlight grid and `Gallery` is image-only — so the sanctioned pattern is a CSS grid of `Card`, the
 * same one the Hub's workforce directory uses.
 *
 * No `role="list"`: the cards are not `listitem`s (each is an interactive `Card` with its own inner
 * controls), and a list role over non-list children is worse than no role at all. Grouped views are
 * already named by `EntityGroupSection`'s `<section aria-label>`.
 */
export function EntityGrid(props: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
      {props.children}
    </div>
  );
}

export function shouldHintVirtualize(itemCount: number): boolean {
  return itemCount > VIRTUALIZE_HINT_THRESHOLD;
}

/**
 * Layout-shaped placeholders for the first paint (loading-states: `loading` means "no content yet",
 * so it renders a skeleton sized like the eventual card, never a spinner that collapses the grid).
 */
export function EntityGridSkeleton(props: { count?: number }) {
  const count = props.count ?? 6;
  return (
    <div
      aria-hidden
      className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4"
      data-testid="entity-grid-skeleton"
    >
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Card>
      ))}
    </div>
  );
}
