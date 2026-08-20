// ==================================================================================================
// IsoHousing + isoExtrude — the three-face solid, the part everything else is built from
// ==================================================================================================
// One box, three visible faces, painted back-to-front, lit by the FIXED rule: top is the sky plane,
// the left (+y) face catches ambient bounce, the right (+x) face is in shade. The three shades are
// not chosen here — they are `--illus-face-top/left/right`, derived once in `tokens.css` by mixing
// the surface toward the ink, which is what makes a solid read correctly in a theme nobody has drawn
// it in yet (D-IL5, D-IL15).

import type { ReactElement } from "react";
import {
  type IsoBox,
  type IsoFace,
  ISO_FACE_PAINT_ORDER,
  ISO_FACES,
  isoBoxCorners,
  polygonPoints,
} from "../iso-math.js";
import { ILLUS_STROKE_WEIGHTS, type IllusStrokeWeight } from "../line-system.js";

/**
 * A box's three visible faces as `points` attribute strings, in paint order (left, right, top).
 * Pure: this is the geometry half of the primitive, and `IsoPlatform` and `CalibrationCube` draw
 * themselves through it rather than repeating the corner arithmetic.
 */
export function isoExtrude(box: IsoBox): Record<IsoFace, string> {
  const corners = isoBoxCorners(box);
  return {
    left: polygonPoints(corners.left),
    right: polygonPoints(corners.right),
    top: polygonPoints(corners.top),
  };
}

/** The one place a face is bound to its shade. Nothing else in the package names a face token. */
const FACE_FILL: Record<IsoFace, string> = {
  top: "var(--illus-face-top)",
  left: "var(--illus-face-left)",
  right: "var(--illus-face-right)",
};

export type IsoHousingProps = {
  /** Extent along world x, in units. */
  width: number;
  /** Extent along world y, in units. */
  depth: number;
  /** Extent along world z, in units. */
  height: number;
  /** Centre of the footprint, in units. */
  cx?: number;
  cy?: number;
  /** The floor the solid stands on, in units above the ground plane. */
  z0?: number;
  /** A NAMED line weight from the line system — never a number, so the system stays closed. */
  weight?: IllusStrokeWeight;
  /** Draw only the top face's outline instead of the solid (used by the platform's top tier). */
  faces?: readonly IsoFace[];
};

export function IsoHousing({
  width,
  depth,
  height,
  cx = 0,
  cy = 0,
  z0 = 0,
  weight = "ink",
  faces = ISO_FACES,
}: IsoHousingProps): ReactElement {
  const box: IsoBox = { cx, cy, w: width, d: depth, z0, h: height };
  const points = isoExtrude(box);
  const strokeWidth = ILLUS_STROKE_WEIGHTS[weight];
  // Paint order is left, right, top — back to front. `faces` filters, it never reorders: a caller
  // asking for ["top", "left"] still gets the left face painted first.
  const painted = ISO_FACE_PAINT_ORDER.filter((face) => faces.includes(face));
  return (
    <g data-illus-primitive="iso-housing">
      {painted.map((face) => (
        <polygon
          key={face}
          data-illus-face={face}
          points={points[face]}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          style={{ fill: FACE_FILL[face], stroke: "var(--illus-ink)" }}
        />
      ))}
    </g>
  );
}

IsoHousing.illusLayer = "structure" as const;
