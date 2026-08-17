import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@elabs-ai/components-ui";

/**
 * AlertHeading — an alert title that renders at the CORRECT heading level for its context.
 * ================================================================================================
 *
 * WHY IT EXISTS
 *   `@elabs-ai/components-ui`'s `AlertTitle` (vendor `alert.tsx`) always renders a literal `<h5>`, regardless of
 *   where the alert sits in the page. Design critique 2026-07-25T20-00-10Z (item 2 of T9) measured
 *   H1→H5 jumps wherever a destructive/failure alert sits directly under a page's `<h1>`/`<h2>` — a
 *   failed-scan or report surface with no intervening h2/h3/h4 in between. Mirrors the same fix
 *   `SectionCardTitle.tsx` already applied to `@elabs-ai/components-ui` `CardTitle` (D-IC5).
 *
 * WHAT IT IS
 *   A thin wrapper that renders a real `<h1>`–`<h6>` (via the `level` prop) carrying the SAME visual
 *   as `AlertTitle` (`mb-1 font-medium leading-none tracking-tight`), so the outline gains a correctly
 *   nested heading with zero visual change. Default `level` is 5 — matching `AlertTitle`'s own `<h5>`
 *   — so an unannotated call site renders identically to before; pass the level that continues the
 *   surrounding page's outline (e.g. `level={2}` for an alert that IS a page's main content, `level={3}`
 *   nested under a card's own `h2`).
 *
 * VENDOR BOUNDARY
 *   App-side override for an upstream gap: `AlertTitle` has no `as`/`asChild` seam to swap its tag
 *   (`forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>` hardcodes `<h5>`), so this
 *   mirrors its classes rather than composing it — same pattern as `SectionCardTitle.tsx`. Do NOT edit
 *   the vendored `AlertTitle`; delete this wrapper and pass `level` to `AlertTitle` directly once
 *   `@elabs-ai/components-ui` accepts a heading level upstream.
 *
 * Every visible element stays a semantic-token utility (no raw colour); `className` is layout-only.
 * Reads correctly in both `light` and `dark` (same tokens `AlertTitle` uses).
 */

/** Heading level an alert title may render at. */
export type AlertHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface AlertHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * Semantic heading level — drives the rendered `<h1>`–`<h6>` tag (and its implicit `aria-level`).
   * @default 5 — matches `@elabs-ai/components-ui` AlertTitle's own hardcoded `<h5>`.
   */
  level?: AlertHeadingLevel;
}

export const AlertHeading = forwardRef<HTMLHeadingElement, AlertHeadingProps>(
  function AlertHeading({ level = 5, className, ...props }, ref) {
    const Tag = `h${level}` as const;
    // Classes mirror `@elabs-ai/components-ui` AlertTitle exactly (vendor alert.tsx) — same look, correct level.
    return (
      <Tag ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
    );
  },
);
