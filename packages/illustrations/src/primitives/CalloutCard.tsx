// ==================================================================================================
// CalloutCard — an annotation that points at something (D-IL16)
// ==================================================================================================
// A screen-aligned card plus a LEADER, and the leader is the part with a rule attached: it elbows
// only on the three isometric axes (30 / 90 / 150), never freehand, so a callout reads as part of the
// drafting rather than as a sticker applied afterwards. `isoLeaderPoints` is where that is enforced;
// this component only decides which edge of the card the line leaves from.
//
// Text does not wrap. A caller supplies pre-broken lines, because wrapping means measuring rendered
// text, and measurement means the same spec renders differently in two browsers — which D-IL10's
// determinism rule rules out.

import type { ReactElement } from "react";
import { type ScreenPoint, fmt, isoLeaderPath } from "../iso-math.js";
import { ILLUS_STROKE_CONSTRUCTION, ILLUS_STROKE_DETAIL, ILLUS_TEXT } from "../line-system.js";

export const CARD_PADDING = 12;
export const CARD_LINE_HEIGHT = 16;
export const CARD_TITLE_HEIGHT = 20;
export const CARD_DEFAULT_WIDTH = 210;
export const CARD_RADIUS = 8;

export type CalloutCardProps = {
  /** The card's top-left corner, in px. */
  at: ScreenPoint;
  title: string;
  /** Pre-broken body lines. */
  lines?: readonly string[];
  width?: number;
  /** What the card points at. Omit for a card with no leader. */
  anchor?: ScreenPoint;
};

/** The card's height, so a caller can lay several out without rendering them first. */
export function calloutCardHeight(lines: readonly string[] = []): number {
  return CARD_PADDING * 2 + CARD_TITLE_HEIGHT + lines.length * CARD_LINE_HEIGHT;
}

export function CalloutCard({
  at,
  title,
  lines = [],
  width = CARD_DEFAULT_WIDTH,
  anchor,
}: CalloutCardProps): ReactElement {
  const height = calloutCardHeight(lines);
  // The leader leaves from whichever vertical edge faces the thing being pointed at.
  const attach: ScreenPoint | null = anchor
    ? {
        x: anchor.x < at.x ? at.x : at.x + width,
        y: at.y + height / 2,
      }
    : null;
  return (
    <g data-illus-primitive="callout-card">
      {anchor && attach ? (
        <path
          data-illus-mark="leader"
          d={isoLeaderPath(anchor, attach)}
          fill="none"
          strokeWidth={ILLUS_STROKE_CONSTRUCTION}
          strokeDasharray="3 3"
          style={{ stroke: "var(--illus-ink-muted)" }}
        />
      ) : null}
      {anchor ? (
        <circle
          cx={fmt(anchor.x)}
          cy={fmt(anchor.y)}
          r={2.6}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ) : null}
      <rect
        x={fmt(at.x)}
        y={fmt(at.y)}
        width={width}
        height={height}
        rx={CARD_RADIUS}
        strokeWidth={ILLUS_STROKE_DETAIL}
        style={{ fill: "var(--illus-surface)", stroke: "var(--illus-guide)" }}
      />
      <text
        x={fmt(at.x + CARD_PADDING)}
        y={fmt(at.y + CARD_PADDING + 12)}
        fontSize={ILLUS_TEXT.label}
        fontWeight={600}
        style={{ fill: "var(--illus-ink)" }}
      >
        {title}
      </text>
      {lines.map((line, index) => (
        <text
          key={line}
          x={fmt(at.x + CARD_PADDING)}
          y={fmt(at.y + CARD_PADDING + CARD_TITLE_HEIGHT + 11 + index * CARD_LINE_HEIGHT)}
          fontSize={ILLUS_TEXT.caption}
          style={{ fill: "var(--illus-ink-muted)" }}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

CalloutCard.illusLayer = "annotations" as const;
