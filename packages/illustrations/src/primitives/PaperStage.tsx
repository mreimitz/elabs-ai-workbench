// ==================================================================================================
// PaperStage — the drafting paper everything is drawn on
// ==================================================================================================
// Grid before drawing, always (research 3.1). The stage carries the minor grid at one iso unit, a
// major line every four, a centre crosshair and corner registration marks. It is the bottom layer of
// every scene and it is what makes the style read as DRAFTING rather than as flat illustration.
//
// The grid pattern needs an id, and that id has to be unique per INSTANCE — not merely per grid
// geometry. `url(#id)` resolves to the FIRST matching element in document order, so several stages
// sharing one id do not merely produce invalid markup: every one of them paints the first stage's
// grid, and the pattern's phase is computed per stage from its own centre. On a page of same-sized
// stages the phases coincide and nothing shows; on a page of DIFFERENT sizes — which is exactly what
// the gallery's size matrix is for — the majority draw their grid out of registration with their own
// crosshair and registration marks.
//
// `useId` is React's own answer, and it costs the package nothing it had: an id is stable for a
// given position in a tree, so the same stage still renders the same bytes twice and determinism
// (D-IL10) holds. What it deliberately does NOT promise is that one stage emits the same id in two
// different trees — and it never could, because that promise is the defect.

import { type ReactElement, useId } from "react";
import { ISO_UNIT, fmt } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_CONSTRUCTION, ILLUS_STROKE_DETAIL } from "../line-system.js";

export type PaperStageProps = {
  /** The stage rectangle, in px. */
  width: number;
  height: number;
  x?: number;
  y?: number;
  /** Minor gridlines. Off leaves the paper plain (the scene spec's `stage: "plain"`). */
  grid?: boolean;
  /** How many minor cells make a major one. */
  majorEvery?: number;
  /** The centre crosshair — the drawing's own origin mark. */
  crosshair?: boolean;
  /** Corner registration marks, the way a reprographic sheet carries them. */
  registration?: boolean;
  /** One grid cell, in px. Defaults to one iso unit. */
  cell?: number;
};

/** Length of a registration mark's arms, in px. */
const REGISTRATION_ARM = 9;

export function PaperStage({
  width,
  height,
  x = 0,
  y = 0,
  grid = true,
  majorEvery = 4,
  crosshair = true,
  registration = true,
  cell = ISO_UNIT,
}: PaperStageProps): ReactElement {
  // The instance half comes from React, the geometry half stays because it is what makes the markup
  // readable — `illus-paper-grid-_R_1_-c16-m4` still says which grid it defines. The filter keeps
  // only the characters an SVG id and a `url(#…)` reference take unescaped; on React 19 it removes
  // nothing, which is the point — it is a floor, not a rewrite, so two ids that differ cannot be
  // flattened into one by the sanitiser itself. The leading run is `illus`, never hexadecimal, so no
  // id here can be mistaken for a color literal by the package's no-literals guard.
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const patternId = `illus-paper-grid-${instance}-c${fmt(cell)}-m${majorEvery}`.replace(/\./g, "p");
  const majorCell = cell * majorEvery;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const marks: ReactElement[] = [];
  if (registration) {
    const corners: readonly (readonly [number, number])[] = [
      [x + REGISTRATION_ARM + 3, y + REGISTRATION_ARM + 3],
      [x + width - REGISTRATION_ARM - 3, y + REGISTRATION_ARM + 3],
      [x + REGISTRATION_ARM + 3, y + height - REGISTRATION_ARM - 3],
      [x + width - REGISTRATION_ARM - 3, y + height - REGISTRATION_ARM - 3],
    ];
    for (const [mx, my] of corners) {
      marks.push(
        <path
          key={`registration-${fmt(mx)}-${fmt(my)}`}
          d={`M ${fmt(mx - REGISTRATION_ARM)} ${fmt(my)} H ${fmt(mx + REGISTRATION_ARM)} M ${fmt(mx)} ${fmt(my - REGISTRATION_ARM)} V ${fmt(my + REGISTRATION_ARM)}`}
          fill="none"
          strokeWidth={ILLUS_STROKE_DETAIL}
          style={{ stroke: "var(--illus-guide)" }}
        />,
      );
    }
  }

  return (
    <g data-illus-primitive="paper-stage">
      <rect x={x} y={y} width={width} height={height} style={{ fill: "var(--illus-paper)" }} />
      {grid ? (
        <>
          <defs>
            <pattern
              id={patternId}
              width={cell}
              height={cell}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${fmt(cx % cell)} ${fmt(cy % cell)})`}
            >
              <path
                d={`M ${fmt(cell)} 0 L 0 0 0 ${fmt(cell)}`}
                fill="none"
                strokeWidth={ILLUS_STROKE_CONSTRUCTION}
                style={{ stroke: "var(--illus-grid)" }}
              />
            </pattern>
            <pattern
              id={`${patternId}-major`}
              width={majorCell}
              height={majorCell}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${fmt(cx % majorCell)} ${fmt(cy % majorCell)})`}
            >
              <path
                d={`M ${fmt(majorCell)} 0 L 0 0 0 ${fmt(majorCell)}`}
                fill="none"
                strokeWidth={ILLUS_STROKE_CONSTRUCTION}
                style={{ stroke: "var(--illus-grid-major)" }}
              />
            </pattern>
          </defs>
          <rect x={x} y={y} width={width} height={height} fill={`url(#${patternId})`} />
          <rect x={x} y={y} width={width} height={height} fill={`url(#${patternId}-major)`} />
        </>
      ) : null}
      {crosshair ? (
        <path
          data-illus-mark="crosshair"
          d={`M ${fmt(cx - 14)} ${fmt(cy)} H ${fmt(cx + 14)} M ${fmt(cx)} ${fmt(cy - 14)} V ${fmt(cy + 14)}`}
          fill="none"
          strokeWidth={ILLUS_STROKE_CONSTRUCTION}
          strokeDasharray={ILLUS_DASH.construction}
          style={{ stroke: "var(--illus-guide)" }}
        />
      ) : null}
      {marks}
    </g>
  );
}

PaperStage.illusLayer = "stage" as const;
