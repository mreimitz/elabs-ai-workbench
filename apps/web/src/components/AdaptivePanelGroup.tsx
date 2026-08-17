import { type ComponentProps } from "react";
import { ResizablePanelGroup, useIsMobile } from "@elabs-ai/components-ui";

export type AdaptivePanelGroupProps = Omit<
  ComponentProps<typeof ResizablePanelGroup>,
  "direction"
> & {
  /**
   * The split axis on ≥768px viewports. Below the brand-ui mobile breakpoint the group always
   * stacks (`vertical`) so a master-detail split becomes a single readable column instead of two
   * sub-100px slivers. Defaults to `horizontal` (every current site is a horizontal desktop split).
   */
  desktopDirection?: "horizontal" | "vertical";
};

/**
 * A drop-in replacement for `ResizablePanelGroup` that flips a horizontal master-detail split to a
 * stacked single column below the brand-ui mobile breakpoint (`useIsMobile`, 768px). The children
 * (`ResizablePanel` / `ResizableHandle`) are unchanged — they read the active direction from the
 * panel-group context, so each pane keeps its own scroll and the resize handle re-orients itself;
 * only the axis and the width/height the percentage `minSize` floors apply to change. Purely
 * additive: on ≥768px it renders exactly the horizontal group it replaced.
 */
export function AdaptivePanelGroup({
  desktopDirection = "horizontal",
  ...props
}: AdaptivePanelGroupProps) {
  const isMobile = useIsMobile();
  return <ResizablePanelGroup direction={isMobile ? "vertical" : desktopDirection} {...props} />;
}
