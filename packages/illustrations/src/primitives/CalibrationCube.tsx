// ==================================================================================================
// CalibrationCube — the standing dimensional reference (D-IL15)
// ==================================================================================================
// One unit, cubed, with its height dimensioned. It renders in the gallery and in dev overlays for a
// single reason: components drawn by eye over months drift in scale, and there is no way to notice
// that from inside one component. A cube on the same sheet makes the drift visible immediately.
//
// The geometry is `isoExtrude`'s, not its own — the reference has to be built the same way as the
// things it is measuring, or it stops being a reference.

import type { ReactElement } from "react";
import { ISO_UNIT, fmt, project } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_CONSTRUCTION, ILLUS_TEXT } from "../line-system.js";
import { IsoHousing } from "./IsoHousing.js";

export type CalibrationCubeProps = {
  cx?: number;
  cy?: number;
  z0?: number;
  /** Show the dimension line and its "1u = 16 px" caption. */
  dimensioned?: boolean;
};

export function CalibrationCube({
  cx = 0,
  cy = 0,
  z0 = 0,
  dimensioned = true,
}: CalibrationCubeProps): ReactElement {
  // The right-hand corner of the cube, top and bottom, is where the dimension line hangs.
  const top = project(cx + 0.5, cy - 0.5, z0 + 1);
  const bottom = project(cx + 0.5, cy - 0.5, z0);
  const lineX = top.x + 9;
  return (
    <g data-illus-primitive="calibration-cube">
      <IsoHousing width={1} depth={1} height={1} cx={cx} cy={cy} z0={z0} weight="detail" />
      {dimensioned ? (
        <>
          <path
            d={`M ${fmt(top.x)} ${fmt(top.y)} H ${fmt(lineX)} M ${fmt(bottom.x)} ${fmt(bottom.y)} H ${fmt(lineX)} M ${fmt(lineX)} ${fmt(top.y)} V ${fmt(bottom.y)}`}
            fill="none"
            strokeWidth={ILLUS_STROKE_CONSTRUCTION}
            strokeDasharray={ILLUS_DASH.construction}
            style={{ stroke: "var(--illus-guide)" }}
          />
          <text
            x={lineX + 5}
            y={(top.y + bottom.y) / 2 + 3.5}
            fontSize={ILLUS_TEXT.port}
            style={{ fill: "var(--illus-ink-muted)" }}
          >
            {`1u = ${ISO_UNIT} px`}
          </text>
        </>
      ) : null}
    </g>
  );
}

CalibrationCube.illusLayer = "structure" as const;
