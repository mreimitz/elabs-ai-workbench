import { HoverCard, HoverCardContent, HoverCardTrigger, Text, cn } from "@brand/ui";

/**
 * Assistant Hub — a compact preview of the prompt (brief) a mission agent received: two clamped lines
 * that reveal the FULL text in a hover popover (owner request). Mirrors `SourcesPanel`'s
 * `InlineCitationChip` HoverCard pattern (`@brand/ui` `HoverCard`, no provider needed); the trigger is
 * a `<span>` (not a raw `<button>`) with a native `title` fallback so the full text is reachable
 * without hover too. Plain-DOM only — the HoverCard content is not portalled, so it must NOT be used
 * inside a transformed/overflow-clipped React Flow canvas (the graph node shows the clamped preview
 * alone).
 */
export function AgentBriefPreview({ brief, className }: { brief: string; className?: string }) {
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          className={cn(
            "line-clamp-2 min-w-0 cursor-default break-words text-caption text-muted-foreground",
            className,
          )}
          title={brief}
        >
          {brief}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="max-h-64 w-80 max-w-[min(24rem,90vw)] overflow-auto"
      >
        <Text className="whitespace-pre-wrap break-words text-caption">{brief}</Text>
      </HoverCardContent>
    </HoverCard>
  );
}
