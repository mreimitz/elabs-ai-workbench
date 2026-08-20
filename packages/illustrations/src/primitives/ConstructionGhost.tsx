// ==================================================================================================
// ConstructionGhost — the dashed echo (research 3.2)
// ==================================================================================================
// This primitive is where the style's hand-drawn charm actually comes from. NOT from wobble filters:
// a ghost is a clean 1 px dashed outline in `--illus-guide`, offset from the solid it echoes, the way
// a drafting sheet keeps the construction lines that led to the final object. Wobble looks cheap at
// small sizes and breaks under export; a construction layer survives both and says something true
// about the drawing.

import type { ReactElement } from "react";
import { type IsoBox, isoBoxCorners, polygonPoints } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_CONSTRUCTION } from "../line-system.js";

export type ConstructionGhostProps = {
  /** The footprint to echo, in units. */
  width: number;
  depth: number;
  cx?: number;
  cy?: number;
  /** The height the echo floats at, in units. */
  z?: number;
  /** How far the echo is nudged on screen, in px — the offset that makes it read as a trace. */
  dx?: number;
  dy?: number;
};

export function ConstructionGhost({
  width,
  depth,
  cx = 0,
  cy = 0,
  z = 0.7,
  dx = -7,
  dy = -5,
}: ConstructionGhostProps): ReactElement {
  const box: IsoBox = { cx, cy, w: width, d: depth, z0: z, h: 0 };
  const outline = isoBoxCorners(box).top.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  return (
    <polygon
      data-illus-primitive="construction-ghost"
      points={polygonPoints(outline)}
      fill="none"
      strokeWidth={ILLUS_STROKE_CONSTRUCTION}
      strokeDasharray={ILLUS_DASH.construction}
      style={{ stroke: "var(--illus-guide)" }}
    />
  );
}

ConstructionGhost.illusLayer = "detail" as const;
