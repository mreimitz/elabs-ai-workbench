import { type ComponentProps } from "react";
import { TabsList, cn } from "@brand/ui";

export type ScrollableTabsListProps = ComponentProps<typeof TabsList> & {
  /** Layout classes for the scroll container (e.g. `self-start` where the strip shouldn't stretch). */
  containerClassName?: string;
  /**
   * When true, render a FULL-WIDTH tab bar with CENTERED triggers: the scroll container spans the
   * content width (`w-full`) and the `@brand/ui` `TabsList` (recessed muted track) becomes
   * `w-full justify-center-safe`, so the track fills the row and the triggers sit centered within it.
   * `justify-center-safe` (`justify-content: safe center`) is visually identical to `justify-center`
   * while the triggers fit, but falls back to START alignment the moment they overflow — so the
   * horizontal-scroll-on-overflow box scrolls from the first trigger and nothing is clipped
   * unreachably (plain `justify-center` would center the overflow and strand the first trigger off
   * the left edge). Default false leaves behavior identical to a bare shrink-to-content `TabsList`
   * (back-compat for non-opting consumers).
   */
  fullWidth?: boolean;
};

/**
 * A `TabsList` that scrolls horizontally instead of clipping its triggers on narrow widths —
 * brand-ui's `TabsList` neither wraps nor scrolls, so a 5–6 tab strip is cut off inside a phone
 * viewport or a narrow pane/sheet. The list is wrapped in an `overflow-x-auto` box; on wide
 * viewports the triggers fit and nothing scrolls, so this is identical to a bare `TabsList` there.
 *
 * With `fullWidth`, the strip becomes a full-width bar (spanning the content width) with its
 * triggers centered — see the prop doc above.
 */
export function ScrollableTabsList({
  className,
  containerClassName,
  fullWidth = false,
  ...props
}: ScrollableTabsListProps) {
  return (
    <div className={cn("max-w-full overflow-x-auto", fullWidth && "w-full", containerClassName)}>
      <TabsList className={cn(fullWidth && "w-full justify-center-safe", className)} {...props} />
    </div>
  );
}
