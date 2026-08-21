import type { ReactNode } from "react";
import { cn, Text } from "@elabs-ai/components-ui";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import {
  STUDIO_COLLAPSED_RAIL_CLASS,
  STUDIO_CONTEXT_PANEL_CLASS,
  STUDIO_LEFT_RAIL_CLASS,
} from "./studio-layout";

// ── Skill Studio (RM-30 WP 7.1) — one collapsible rail, used on both sides ─────────────────────────
// Both the left rail (Files · Tools · Settings) and the right context panel are the same shape: a
// fixed-width column with a titled header + collapse control, which folds down to a slim vertical
// strip carrying only the re-open control. Fixed widths (not a resizable percentage split) are
// deliberate — the WP's acceptance is a WIDTH measurement, so the centre surface's share has to be
// arithmetic, not a persisted drag position.

export type StudioRailProps = {
  /** Which edge this rail sits on — decides the chevron glyphs and the border side. */
  side: "start" | "end";
  /** The rail's name, used in the header, the collapsed strip, and both control labels. */
  label: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Rendered at the tail of the header row (the left rail's tab strip lives in the BODY, not here). */
  headerExtra?: ReactNode;
  children: ReactNode;
  /** Test hook for the expanded column. */
  testId?: string;
};

export function StudioRail({
  side,
  label,
  collapsed,
  onCollapsedChange,
  headerExtra,
  children,
  testId,
}: StudioRailProps) {
  const OpenIcon = side === "start" ? PanelLeftOpen : PanelRightOpen;
  const CloseIcon = side === "start" ? PanelLeftClose : PanelRightClose;
  const edgeBorder = side === "start" ? "border-r" : "border-l";

  if (collapsed) {
    return (
      <div
        className={cn(
          "flex shrink-0 flex-col items-center gap-2 bg-card py-2",
          STUDIO_COLLAPSED_RAIL_CLASS,
          edgeBorder,
          "border-border",
        )}
        data-testid={testId ? `${testId}-collapsed` : undefined}
      >
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={`Show the ${label} panel`}
          onClick={() => onCollapsedChange(false)}
        >
          <OpenIcon aria-hidden />
        </IconButton>
        {/* The rail's name stays legible while collapsed, rotated into the strip. */}
        <span
          aria-hidden
          className="select-none whitespace-nowrap text-meta text-muted-foreground [writing-mode:vertical-rl]"
        >
          {label}
        </span>
      </div>
    );
  }

  return (
    <aside
      aria-label={label}
      className={cn(
        "flex min-h-0 shrink-0 flex-col overflow-hidden bg-card",
        side === "start" ? STUDIO_LEFT_RAIL_CLASS : STUDIO_CONTEXT_PANEL_CLASS,
        edgeBorder,
        "border-border",
      )}
      data-testid={testId}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <Text variant="meta" className="min-w-0 flex-1 truncate font-medium">
          {label}
        </Text>
        {headerExtra}
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={`Hide the ${label} panel`}
          onClick={() => onCollapsedChange(true)}
        >
          <CloseIcon aria-hidden />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </aside>
  );
}
