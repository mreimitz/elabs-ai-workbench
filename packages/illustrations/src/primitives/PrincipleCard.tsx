// ==================================================================================================
// PrincipleCard — the standing note beside a scene (D-IL16, annotations layer)
// ==================================================================================================
// The "here is what this drawing is saying" block: a title and a short list of principles, on the
// paper's own sunken surface. Unlike a CalloutCard it points at nothing — it belongs to the WHOLE
// scene, so giving it a leader would be a lie about what it annotates.
//
// The bullet is an iso lozenge rather than a dot: a flattened diamond at the ellipse ratio, so even
// the list markers belong to the same projection as everything else on the sheet.

import type { ReactElement } from "react";
import { ISO_ELLIPSE_RATIO, type ScreenPoint, fmt } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_TEXT } from "../line-system.js";
import { CARD_LINE_HEIGHT, CARD_PADDING, CARD_RADIUS, CARD_TITLE_HEIGHT } from "./CalloutCard.js";

export const PRINCIPLE_CARD_DEFAULT_WIDTH = 240;

/** Vertical space each principle takes, in px — roomier than a callout's body lines. */
export const PRINCIPLE_LINE_HEIGHT = CARD_LINE_HEIGHT + 4;

const BULLET_INDENT = 14;
const BULLET_HALF_WIDTH = 4;

export type PrincipleCardProps = {
  at: ScreenPoint;
  title: string;
  items: readonly string[];
  width?: number;
  /** Tint the title with the hero accent. Opt-in, once per scene at most (D-IL6). */
  accent?: boolean;
};

export function principleCardHeight(items: readonly string[]): number {
  return CARD_PADDING * 2 + CARD_TITLE_HEIGHT + items.length * PRINCIPLE_LINE_HEIGHT;
}

export function PrincipleCard({
  at,
  title,
  items,
  width = PRINCIPLE_CARD_DEFAULT_WIDTH,
  accent = false,
}: PrincipleCardProps): ReactElement {
  const height = principleCardHeight(items);
  return (
    <g data-illus-primitive="principle-card">
      <rect
        x={fmt(at.x)}
        y={fmt(at.y)}
        width={width}
        height={height}
        rx={CARD_RADIUS}
        strokeWidth={ILLUS_STROKE_DETAIL}
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-guide)" }}
      />
      <text
        x={fmt(at.x + CARD_PADDING)}
        y={fmt(at.y + CARD_PADDING + 12)}
        fontSize={ILLUS_TEXT.label}
        fontWeight={700}
        style={{ fill: accent ? "var(--illus-accent)" : "var(--illus-ink)" }}
      >
        {title}
      </text>
      {items.map((item, index) => {
        const baseline =
          at.y + CARD_PADDING + CARD_TITLE_HEIGHT + 11 + index * PRINCIPLE_LINE_HEIGHT;
        const bulletX = at.x + CARD_PADDING + BULLET_HALF_WIDTH;
        const bulletY = baseline - 4;
        const half = BULLET_HALF_WIDTH;
        const drop = half * ISO_ELLIPSE_RATIO;
        return (
          <g key={item}>
            <polygon
              points={`${fmt(bulletX - half)},${fmt(bulletY)} ${fmt(bulletX)},${fmt(bulletY - drop)} ${fmt(bulletX + half)},${fmt(bulletY)} ${fmt(bulletX)},${fmt(bulletY + drop)}`}
              style={{ fill: "var(--illus-ink-muted)" }}
            />
            <text
              x={fmt(at.x + CARD_PADDING + BULLET_INDENT)}
              y={fmt(baseline)}
              fontSize={ILLUS_TEXT.caption}
              style={{ fill: "var(--illus-ink)" }}
            >
              {item}
            </text>
          </g>
        );
      })}
    </g>
  );
}

PrincipleCard.illusLayer = "annotations" as const;
