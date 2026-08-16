import type { ReactNode } from "react";
import { Heading, Text, cn } from "@brand/ui";

/**
 * ui-wave U6 (owner feedback) — the ONE section-card recipe for the project detail pane: a
 * `rounded-lg border bg-card p-4` surface with a `text-subtitle` title + one-line muted description
 * and optional right-aligned actions. Shared by `ProjectEditor` (Description / Instructions /
 * Memory) AND `PinnedFilesEditor` (which owns its section's "Add" action state) — pulled into its
 * own module rather than exported from either, so neither editor has to import the other just for
 * chrome. WHY a card per section: the pre-U6 pane was one undifferentiated form column ("dry",
 * "boring" — the owner's words); consistent cards give each concern a scannable boundary, the same
 * surface language the rest of the hub uses for grouped content.
 */
export function EditorSection(props: {
  title: ReactNode;
  /** One line, muted — what this section feeds (keep it short; detail belongs in placeholders). */
  description?: ReactNode;
  /** Right-aligned header action (e.g. the pinned-files "Add" button). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4",
        props.className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* level 3 keeps the outline Page (h1) → project name (h2) → section (h3); size fixes the
          visual rung at text-subtitle independently of the semantic level. */}
          <Heading level={3} size="subtitle">
            {props.title}
          </Heading>
          {props.description ? (
            <Text variant="caption" tone="muted">
              {props.description}
            </Text>
          ) : null}
        </div>
        {props.actions ?? null}
      </div>
      {props.children}
    </section>
  );
}
