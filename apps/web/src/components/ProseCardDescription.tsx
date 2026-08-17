import { forwardRef, type HTMLAttributes } from "react";
import { CardDescription, cn } from "@elabs-ai/components-ui";

/**
 * ProseCardDescription — a measure-capped `CardDescription` (finding 9 / D-IC9, upstream gap #5 —
 * see `roadmap/interface-craft/upstream-gaps.md`).
 *
 * `@elabs-ai/components-ui`'s `CardDescription` (`vendor card.tsx`) sets no `max-w`, so a description in a
 * full-width card runs to the container edge — measured 190ch worst case in this app (the
 * Compatibility "Not everything is automated" callout at 1600px). This wrapper leaves
 * `CardDescription`'s own small, muted, balanced-wrap body styling untouched and adds only a
 * ~68-character reading-width cap for GENUINE PROSE — a description that renders a table or other
 * dense/tabular content should stay on the plain `CardDescription` (tables and dense rows stay
 * full-width, this is prose only).
 *
 * `cn()` is tailwind-merge-based, so a caller-supplied `className` with its own `max-w-*` wins over
 * this default (e.g. an explicit `max-w-none` opt-out).
 *
 * Delete this wrapper when `@elabs-ai/components-ui`'s `CardDescription` caps its own measure by default (or
 * exposes a `prose`/measure variant) — see upstream-gaps.md #5's "Delete when".
 */
export const ProseCardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function ProseCardDescription({ className, ...props }, ref) {
    return <CardDescription ref={ref} className={cn("max-w-[68ch]", className)} {...props} />;
  },
);
