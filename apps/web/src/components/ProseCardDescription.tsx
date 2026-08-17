import { forwardRef, type HTMLAttributes } from "react";
import { CardDescription, cn } from "@elabs-ai/components-ui";

/**
 * ProseCardDescription — a measure-capped `CardDescription` (finding 9 / D-IC9, upstream gap #5 —
 * see `roadmap/interface-craft/upstream-gaps.md`).
 *
 * UPSTREAM GAP #5 IS CLOSED. `CardDescription` used to set no `max-w`, so a description in a
 * full-width card ran to the container edge — measured 190ch worst case in this app (the
 * Compatibility "Not everything is automated" callout at 1600px), which is why this wrapper
 * hand-rolled a `max-w-[68ch]` cap. Since v4 the component ships the cap itself as a first-class
 * `measure` prop (`max-w-prose`, ~65ch — verified with `brand-ui docs CardDescription`), so this
 * wrapper now just turns that prop on instead of stapling a class on top of the primitive.
 *
 * It is kept only as the named, discoverable "this description is genuine prose" call site. Prefer
 * `<CardDescription measure>` directly in new code; a description that renders a table or other
 * dense/tabular content stays on the plain `CardDescription` (tables and dense rows stay
 * full-width, the cap is for reading columns of prose only).
 *
 * `cn()` is tailwind-merge-based, so a caller-supplied `className` with its own `max-w-*` still
 * wins over the prop's default (e.g. an explicit `max-w-none` opt-out).
 */
export const ProseCardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function ProseCardDescription({ className, ...props }, ref) {
    return <CardDescription ref={ref} measure className={cn(className)} {...props} />;
  },
);
