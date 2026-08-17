import type { ReactNode } from "react";
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Text, cn } from "@elabs-ai/components-ui";
import { ChevronDown } from "lucide-react";

/**
 * Assistant Hub UX (WP1.2, D-HUX3/D-HUX14) — one stacked, individually collapsible section of the
 * meta rail (Progress · Outputs · Context all compose this). Mirrors the collapsible-footer pattern
 * already proven in `features/skills/SkillRail.tsx`'s `TriggerCollisionsFooter` (a `Collapsible`
 * trigger row with a rotating chevron), generalized into the rail's shared section primitive.
 *
 * §8.3 rules this enforces: "a collapsed section keeps a count in its header" (the `count` badge
 * renders regardless of open state) and "rail content never assumes width: labels truncate" (the
 * label gets `min-w-0 truncate`; the whole trigger row is a flex row so the count/chevron never get
 * pushed off — the `min-w-0`/truncation contract WP1.2's acceptance bar asserts on).
 */
export type RailSectionProps = {
  /** Stable id — becomes the `CollapsibleContent`'s DOM id for `aria-controls`. */
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown as a badge next to the label — present whether the section is open OR collapsed. */
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
};

export function RailSection({
  id,
  label,
  icon,
  count,
  open,
  onOpenChange,
  children,
  className,
}: RailSectionProps) {
  const contentId = `meta-rail-section-${id}`;
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={cn("flex min-w-0 flex-col border-border border-b last:border-b-0", className)}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full min-w-0 justify-start gap-2 rounded-none px-3 py-2.5 text-left hover:bg-accent/60"
          aria-controls={contentId}
        >
          {icon}
          <Text
            variant="meta"
            tone="muted"
            as="span"
            className="min-w-0 flex-1 truncate font-medium uppercase tracking-wide"
            title={label}
          >
            {label}
          </Text>
          {count !== undefined && count > 0 ? (
            <Badge variant="outline" className="shrink-0 tabular-nums">
              {count}
            </Badge>
          ) : null}
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId}>
        <div className="min-w-0 px-3 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
