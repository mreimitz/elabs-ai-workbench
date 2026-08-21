// ==================================================================================================
// IsoSheetStack — a slab divided into sheets, the shape three entities were about to draw twice
// ==================================================================================================
// WP 1.2 §"New primitives" named two candidates and asked for a DECISION rather than a reflex. This
// one is real, and the evidence is that it already existed: `Skill.tsx` laminated its slab by hand
// before WP 1.2, and `file` and `feedback-report` both need the same thing. Three callers of the
// same arithmetic is exactly the case D-IL12 has in mind — "a shape that lives inside one entity is
// a shape the next entity redraws slightly differently".
//
// What actually moved here is the arithmetic, not a polygon: a slab of a FIXED total height is
// divided into `sheets` layers with air between them, so that laminating a slab NEVER changes how
// tall it stands. That invariant is load-bearing (D-IL7): `heightUnits` is what every port anchor is
// measured against, so a `versioned` skill and a `plain` one must be the same height or a connector
// in a scene jumps when somebody switches the variant. Getting that right once, here, is the point.
//
// The one thing the three callers disagree about is STAGGER, so it is a parameter:
//
//   • a bound document (`skill`) is laminated — every sheet flush with the one below it;
//   • a pile of attachments (`file`) is fanned — each sheet nudged along the ground axes;
//   • sheets settled in a tray (`feedback-report`) are somewhere between.
//
// Stagger moves a sheet's CENTRE, never its height, so a fanned stack and a flush one still stand
// exactly as tall — the invariant above survives the parameter that was most likely to break it.

import type { ReactElement } from "react";
import type { IsoBox } from "../iso-math.js";
import type { IllusStrokeWeight } from "../line-system.js";
import { IsoHousing } from "./IsoHousing.js";

/** The share of a laminated slab's height that is air between its sheets. `Skill`'s own number. */
export const SHEET_STACK_GAP_FRACTION = 0.22;

export type SheetStackOptions = {
  /** Air between sheets, as a share of the slab's total height. */
  gapFraction?: number;
  /**
   * How far each sheet is nudged from the one below it, as a share of the slab's width. Applied
   * along BOTH ground axes, so a fanned pile leans toward the viewer the way a real one does.
   * `0` (the default) is a flush lamination.
   */
  staggerFraction?: number;
};

export type SheetStackGeometry = {
  /** Every sheet, bottom first. Same length as the requested count, never empty. */
  readonly sheets: readonly IsoBox[];
  /** The topmost sheet — the one a caller prints its glyph on. */
  readonly top: IsoBox;
};

/**
 * Divide `slab` into `count` sheets. PURE, and exported separately from the component because the
 * callers need the top sheet's box to mount flat art on (a manifest, a clip, a verdict bar), and
 * asking each of them to re-derive it is how the glyph ends up 3 px off on one entity.
 *
 * The arithmetic is deliberately written in the order `Skill.tsx` wrote it — total minus the gaps,
 * divided by the count; each sheet's floor stepped by `sheetHeight + gap` — because float addition
 * is not associative and re-associating it would move a drawing that is already pinned by a test.
 */
export function sheetStackBoxes(
  slab: IsoBox,
  count: number,
  { gapFraction = SHEET_STACK_GAP_FRACTION, staggerFraction = 0 }: SheetStackOptions = {},
): SheetStackGeometry {
  const sheets = Math.max(1, Math.round(count));
  const gap = sheets > 1 ? (slab.h * gapFraction) / (sheets - 1) : 0;
  const sheetHeight = (slab.h - gap * (sheets - 1)) / sheets;
  const stagger = slab.w * staggerFraction;
  const boxes = Array.from({ length: sheets }, (_, sheet) => ({
    cx: slab.cx + stagger * sheet,
    cy: slab.cy + stagger * sheet,
    w: slab.w,
    d: slab.d,
    z0: slab.z0 + sheet * (sheetHeight + gap),
    h: sheetHeight,
  }));
  return { sheets: boxes, top: boxes[sheets - 1] as IsoBox };
}

export type IsoSheetStackProps = SheetStackOptions & {
  /** The whole slab: its footprint, its floor and its TOTAL height, however many sheets it holds. */
  box: IsoBox;
  /** How many sheets to divide it into. Below 1 is clamped, never thrown — a scene always draws. */
  sheets: number;
  /** The weight of the bottom sheet, which carries the silhouette. */
  weight?: IllusStrokeWeight;
};

export function IsoSheetStack({
  box,
  sheets,
  weight = "ink",
  gapFraction,
  staggerFraction,
}: IsoSheetStackProps): ReactElement {
  const boxes = sheetStackBoxes(box, sheets, { gapFraction, staggerFraction }).sheets;
  return (
    <g data-illus-primitive="iso-sheet-stack" data-illus-sheets={boxes.length}>
      {boxes.map((sheet, index) => (
        <IsoHousing
          key={`sheet-${sheet.z0}`}
          width={sheet.w}
          depth={sheet.d}
          height={sheet.h}
          cx={sheet.cx}
          cy={sheet.cy}
          z0={sheet.z0}
          // The bottom sheet carries the silhouette; the ones above it are interior laminations.
          weight={index === 0 ? weight : "detail"}
        />
      ))}
    </g>
  );
}

IsoSheetStack.illusLayer = "structure" as const;
