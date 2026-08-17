import type { ReactNode } from "react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  SectionHeader,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { ChevronRight } from "lucide-react";

/**
 * Shared furniture for the modal tier kit (WP 1.5 / audit §S17). Two building blocks used inside
 * `FormDialog` / `WideDialog` / `WorkbenchDialog` bodies:
 *
 *  - `DialogSection` — a labelled group of fields. Renders a real section heading (via the
 *    `@elabs-ai/components-ui` `SectionHeader`) so section labels are NOT the same size as field labels (the S17
 *    defect: "section labels are plain field labels"). Mandatory fields go in the first section.
 *  - `AdvancedGroup` — a collapsible "Advanced" group, collapsed by default, that shows a one-line
 *    summary of its non-default values while collapsed (S17: "advanced collapsed by default,
 *    summary of non-default advanced values when collapsed"). Keeps expert options visually
 *    separated from the mandatory ones.
 *
 * Both are layout-only compositions of `@elabs-ai/components-*` primitives — no raw colours, tokens throughout.
 */

export function DialogSection(props: {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions on the heading row (e.g. an "Add row" affordance). */
  actions?: ReactNode;
  /** A small eyebrow label above the title. */
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", props.className)}>
      <SectionHeader
        title={props.title}
        description={props.description}
        actions={props.actions}
        eyebrow={props.eyebrow}
      />
      <div className="flex flex-col gap-4">{props.children}</div>
    </section>
  );
}

export function AdvancedGroup(props: {
  /** Heading for the group; defaults to "Advanced". */
  label?: string;
  /**
   * One-line summary of the non-default values inside, shown ONLY while collapsed. Pass this so a
   * user can see at a glance whether any expert option is set without expanding the group.
   */
  summary?: ReactNode;
  /** Collapsed by default per S17; pass `true` to open on mount (e.g. when a value is non-default). */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const label = props.label ?? "Advanced";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-lg border border-border bg-muted/30", props.className)}
    >
      {/* CollapsibleTrigger is itself the interactive brand-ui element (Radix wires aria-expanded), so
          we style it directly rather than nesting a raw interactive element inside it. */}
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-start",
          "transition-colors hover:bg-muted/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <Text className="font-medium">{label}</Text>
        {!open && props.summary != null ? (
          <Text variant="meta" tone="muted" className="ms-auto min-w-0 truncate">
            {props.summary}
          </Text>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-4 py-4">
        <div className="flex flex-col gap-4">{props.children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
