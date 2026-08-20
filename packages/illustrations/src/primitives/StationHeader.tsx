// ==================================================================================================
// StationHeader — the numbered caption block above a station
// ==================================================================================================
// Screen-aligned, ALWAYS. Isometric text is illegible at small sizes and fails accessibility outright,
// so no label in this system is ever skewed onto a face (D-IL2, research 3.1). The number chip is
// what turns a row of entities into a numbered process, and it is the natural place for a station's
// one accent moment — which is why `accent` is opt-in rather than the default (D-IL6).

import type { ReactElement } from "react";
import { type ScreenPoint, fmt } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_TEXT } from "../line-system.js";

export type StationHeaderProps = {
  /** Where the block sits: the chip's centre, with the text running to its right. */
  at: ScreenPoint;
  /** The station number. Omit for an unnumbered caption. */
  seq?: number;
  title: string;
  caption?: string;
  /** Fill the chip with the hero accent. One per station, at most (D-IL6). */
  accent?: boolean;
};

const CHIP_RADIUS = 11;
const TEXT_GAP = 9;

export function StationHeader({
  at,
  seq,
  title,
  caption,
  accent = false,
}: StationHeaderProps): ReactElement {
  const textX = seq === undefined ? at.x : at.x + CHIP_RADIUS + TEXT_GAP;
  return (
    <g data-illus-primitive="station-header">
      {seq === undefined ? null : (
        <>
          <circle
            cx={fmt(at.x)}
            cy={fmt(at.y)}
            r={CHIP_RADIUS}
            strokeWidth={ILLUS_STROKE_DETAIL}
            style={{
              fill: accent ? "var(--illus-accent)" : "var(--illus-surface)",
              stroke: accent ? "var(--illus-accent)" : "var(--illus-ink)",
            }}
          />
          <text
            x={fmt(at.x)}
            y={fmt(at.y + 4.5)}
            fontSize={ILLUS_TEXT.caption}
            fontWeight={700}
            textAnchor="middle"
            style={{ fill: accent ? "var(--illus-accent-contrast)" : "var(--illus-ink)" }}
          >
            {seq}
          </text>
        </>
      )}
      <text
        x={fmt(textX)}
        y={fmt(at.y + 1)}
        fontSize={ILLUS_TEXT.station}
        fontWeight={600}
        style={{ fill: "var(--illus-ink)" }}
      >
        {title}
      </text>
      {caption ? (
        <text
          x={fmt(textX)}
          y={fmt(at.y + 17)}
          fontSize={ILLUS_TEXT.caption}
          style={{ fill: "var(--illus-ink-muted)" }}
        >
          {caption}
        </text>
      ) : null}
    </g>
  );
}

StationHeader.illusLayer = "labels" as const;
