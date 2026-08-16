import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@brand/ui";

/**
 * SectionCardTitle — a card title that is a REAL heading (D-IC5 / interface-review finding 6).
 * =============================================================================================
 *
 * WHY IT EXISTS
 *   `@brand/ui` `CardTitle` renders `<div className="text-title leading-none">` (vendor
 *   card.tsx:262) — it carries no heading semantics. Retiring the visible page H1 (D-TB1) left the
 *   busiest screens (Dashboard, Servers, Runs) with exactly ONE heading each — the `sr-only` h1 —
 *   so a card that titles a genuine section contributes nothing to the document outline and a
 *   screen-reader user has no way to move between sections. D-TB1 was amended (2026-07-25) to
 *   require a semantic `h2`/`h3` on every card that titles a real section; this wrapper supplies it.
 *
 * WHAT IT IS
 *   A thin wrapper that renders a real `<h2>`/`<h3>` (level via the `level` prop, → the tag AND its
 *   implicit `aria-level`) carrying the SAME `text-title` visual as `CardTitle`, so the outline
 *   gains a heading with zero visual change. Use it ONLY where a card titles a genuine section;
 *   decorative card titles keep `CardTitle`/`<div>`. Keep a single, non-skipping level order under
 *   the page's `h1` (sections sit at `h2`; a nested sub-section at `h3`).
 *
 * VENDOR BOUNDARY
 *   App-side override for upstream gap #3 (roadmap/interface-craft/upstream-gaps.md). The classes
 *   mirror `CardTitle` (vendor card.tsx:262) rather than composing it, because `CardTitle` is a bare
 *   `<div>` with no `as`/`asChild` seam to swap the tag. Delete this wrapper and pass `as`/`level`
 *   to `CardTitle` directly once `@brand/ui` `CardTitle` accepts a heading level upstream.
 *
 * Every visible element stays a semantic-token utility (`text-title`, `leading-none`); no raw
 * colour; `className` is layout-only. Reads correctly in both `qlik-bright` and `qlik-dark`.
 */

/** Heading level a section title may render at. Sections nest at most one level deep in this app,
 *  so `h2` (default) / `h3` cover every case today. */
export type SectionCardTitleLevel = 2 | 3;

export interface SectionCardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * Semantic heading level — drives the rendered `<h2>`/`<h3>` tag (and its implicit `aria-level`).
   * @default 2
   */
  level?: SectionCardTitleLevel;
}

export const SectionCardTitle = forwardRef<HTMLHeadingElement, SectionCardTitleProps>(
  function SectionCardTitle({ level = 2, className, ...props }, ref) {
    const Tag = `h${level}` as const;
    // Classes mirror `@brand/ui` CardTitle exactly (vendor card.tsx:262) — same look, real heading.
    return <Tag ref={ref} className={cn("text-title leading-none", className)} {...props} />;
  },
);
