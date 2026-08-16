import type { ReactNode } from "react";
import { StatePanel, cn } from "@brand/ui";

/**
 * TabEmptyState — the ONE empty-state placement for a tab's content region (audit §S21.6 / §S22).
 * =============================================================================================
 * A tab that has nothing to show fills its content region and centres a single `StatePanel` in it
 * — no dead sea of background below a short panel, no wrapper card that exists only to hold the
 * message. It is meant to be the direct child of a flat (scroll="content") `TabPanelContent` body
 * so it inherits that region's full height (`h-full`) and centres both axes.
 *
 * WHY A SHARED COMPONENT
 *   The audit found the same empty state rendered five different ways (inside a card, top-aligned,
 *   mid-viewport, sm vs default sizing). This pins one recipe: same component, same centred
 *   placement, same vertical rhythm, on the flat surface — so every tab's "nothing here" reads
 *   identically and the viewport is always filled.
 *
 * PUBLIC API (a thin, typed pass-through to `StatePanel kind="empty"` + the centring frame)
 *   title        : ReactNode              — required. The headline ("No prompts").
 *   description? : ReactNode              — one muted line under the title.
 *   icon?        : ReactNode              — optional glyph above the title (lucide / @brand/icons).
 *   actions?     : ReactNode              — optional primary/secondary buttons (e.g. "Run scan").
 *   size?        : "sm" | "md" | "lg"     — StatePanel size. Default "md".
 *   className?   : string                 — layout-only classes for the centring frame.
 *
 * USAGE
 *   <TabPanelContent value="prompts" description="Prompt definitions exposed by this server.">
 *     {prompts.length === 0
 *       ? <TabEmptyState icon={<FileText aria-hidden />} title="No prompts"
 *           description="This server exposes no MCP prompts." />
 *       : <DataTable … />}
 *   </TabPanelContent>
 */
export interface TabEmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function TabEmptyState({
  title,
  description,
  icon,
  actions,
  size = "md",
  className,
}: TabEmptyStateProps) {
  return (
    <div className={cn("flex h-full min-h-full w-full items-center justify-center p-6", className)}>
      <StatePanel
        kind="empty"
        size={size}
        icon={icon}
        title={title}
        description={description}
        actions={actions}
        className="max-w-md"
      />
    </div>
  );
}
