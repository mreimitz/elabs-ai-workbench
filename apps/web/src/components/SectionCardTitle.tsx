import { forwardRef, type HTMLAttributes } from "react";
import { CardTitle } from "@elabs-ai/components-ui";

/**
 * SectionCardTitle — a card title that is a REAL heading (D-IC5 / interface-review finding 6).
 * =============================================================================================
 *
 * WHY IT EXISTS
 *   A plain `@elabs-ai/components-ui` `CardTitle` renders a `<div>` with no heading semantics. Retiring
 *   the visible page H1 (D-TB1) left the busiest screens (Dashboard, Servers, Runs) with exactly ONE
 *   heading each — the `sr-only` h1 — so a card that titles a genuine section contributes nothing to
 *   the document outline and a screen-reader user has no way to move between sections. D-TB1 was
 *   amended (2026-07-25) to require a semantic `h2`/`h3` on every card that titles a real section.
 *
 * WHAT IT IS
 *   A thin wrapper over `CardTitle`'s own `as` prop (added upstream for exactly this gap, #328):
 *   `level` picks the `<h2>`/`<h3>` tag (and its implicit `aria-level`) and the visual is
 *   `CardTitle`'s, BY CONSTRUCTION. Until design-system 6.x this file copied `CardTitle`'s classes
 *   (upstream gap #3 in planning/Roadmap/completed/RM-15-interface-craft/upstream-gaps.md), and the
 *   copy drifted the moment upstream changed its line-height token — which is why it now delegates.
 *   It stays as a wrapper only so the many call sites keep a narrow `level: 2 | 3` contract.
 *   Use it ONLY where a card titles a genuine section; decorative titles keep plain `CardTitle`.
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
  function SectionCardTitle({ level = 2, ...props }, ref) {
    return <CardTitle ref={ref} as={level === 3 ? "h3" : "h2"} {...props} />;
  },
);
