import type { ComponentPropsWithoutRef } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  SelectTrigger,
  Text,
} from "@elabs-ai/components-ui";

/**
 * TitledSelectTrigger — the one recovery mechanism for a clipped `<Select>` value (D-IC10,
 * `planning/Roadmap/completed/RM-15-interface-craft/upstream-gaps.md` #4).
 * =============================================================================================
 *
 * WHY IT EXISTS
 *   `@elabs-ai/components-ui`'s `SelectTrigger` ships `[&>span]:line-clamp-1` (`vendor select.tsx:22`) with no
 *   `title`, so EVERY select in the app clips its selected value with no way to read the full
 *   text — including composed labels like `${server} · ${date} · ${n} tools`
 *   (interface review finding 10). This wrapper derives the trigger's `title` from one
 *   `selectedLabel` prop, so a call site cannot render a select without also wiring its
 *   recovery — the same "one prop, the recovery can't be forgotten" discipline as `IconButton`
 *   (D-TB5) and `AgentBriefPreview`.
 *
 * WHAT IT IS
 *   A thin wrapper around `@elabs-ai/components-ui`'s `SelectTrigger` that sets `title={selectedLabel}` on the
 *   trigger element (a native, zero-JS hover recovery reachable without a mouse via the OS
 *   tooltip). When `hoverCard` is set — for a genuinely USER-AUTHORED value (a name/description
 *   the operator typed, not a fixed short enum label) — it additionally wraps the trigger in a
 *   `HoverCard` carrying the full text, the same pattern as `AgentBriefPreview.tsx`. Most selects
 *   choose from a short, fixed vocabulary where the native `title` alone is enough; `hoverCard`
 *   is opt-in for the composed/user-authored cases.
 *
 * USAGE
 *   <Select value={serverId} onValueChange={setServerId}>
 *     <TitledSelectTrigger selectedLabel={selectedLabel}>
 *       <SelectValue placeholder="Choose a server…" />
 *     </TitledSelectTrigger>
 *     <SelectContent>…</SelectContent>
 *   </Select>
 *
 * Every visible element is `@elabs-ai/components-ui`; `className` stays layout-only. `hoverCard` needs the
 * app-root `TooltipProvider`/Radix portal root already mounted (same requirement as
 * `AgentBriefPreview`).
 */
export type TitledSelectTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof SelectTrigger>,
  "title"
> & {
  /**
   * The exact text the trigger is currently showing (what its `SelectValue`/children render) —
   * becomes the trigger's `title`. Pass `undefined` while nothing is selected yet; a placeholder
   * needs no recovery.
   */
  selectedLabel: string | undefined;
  /**
   * Also wrap the trigger in a `HoverCard` carrying the full `selectedLabel` — for a
   * user-authored value long/important enough to warrant more than the native tooltip (the
   * `AgentBriefPreview` pattern). Off by default.
   */
  hoverCard?: boolean;
};

export function TitledSelectTrigger({
  selectedLabel,
  hoverCard = false,
  children,
  ...props
}: TitledSelectTriggerProps) {
  const trigger = (
    <SelectTrigger title={selectedLabel} {...props}>
      {children}
    </SelectTrigger>
  );

  if (!hoverCard || !selectedLabel) return trigger;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="max-w-[min(24rem,90vw)]">
        <Text className="whitespace-pre-wrap break-words text-caption">{selectedLabel}</Text>
      </HoverCardContent>
    </HoverCard>
  );
}
