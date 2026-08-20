// ==================================================================================================
// GlyphFrame — the ONLY way flat art gets onto a face (D-IL15)
// ==================================================================================================
// Draw a glyph as if it were on paper: plain screen-space pixels, x rightward, y down. Wrap it in a
// GlyphFrame naming a face, and it lands on that face correctly, in every scene, forever. There is
// no `transform` prop and no escape hatch — the moment one component eyeballs its own projection the
// system has two answers to the same question.
//
// Naming a BOX rather than a point is the normal case, because the corner a face's art hangs from is
// arithmetic (`faceOrigin`), not a judgement, and asking each caller to work it out is how "the same
// glyph, 3 px lower on this one entity" happens.
//
// D-IL17 lives here too: `face="gaze"` resolves against the entity's `facing`, so an entity's front
// panel follows the flow without the entity itself knowing which face that is.

import type { IllustrationFacing } from "@mcp-token-footprint/shared";
import type { ReactElement, ReactNode } from "react";
import {
  type IsoBox,
  type IsoFace,
  type IsoPoint,
  type ScreenPoint,
  faceExtent,
  faceOrigin,
  faceTransform,
  facingFace,
  projectPoint,
} from "../iso-math.js";
import { useEntityFrame } from "./entity-frame.js";

export type GlyphFace = IsoFace | "gaze";

export type GlyphFrameProps = {
  /** Which face to mount on. `gaze` follows the entity's `facing` (D-IL17). */
  face: GlyphFace;
  children?: ReactNode;
} & (
  | {
      /** The solid whose face the art sits on — the frame works out the corner itself. */
      box: IsoBox;
      at?: never;
    }
  | {
      /** An explicit world anchor, for art that is not hanging off a box corner. */
      at: IsoPoint;
      box?: never;
    }
);

/** Resolve `gaze` without a context, so a caller can reason about it in a test. */
export function resolveGlyphFace(face: GlyphFace, facing: IllustrationFacing): IsoFace {
  return face === "gaze" ? facingFace(facing) : face;
}

export function GlyphFrame({ face, box, at, children }: GlyphFrameProps): ReactElement {
  const frame = useEntityFrame();
  const resolved = resolveGlyphFace(face, frame.facing);
  const origin: ScreenPoint = box ? faceOrigin(box, resolved) : projectPoint(at as IsoPoint);
  const extent = box ? faceExtent(box, resolved) : undefined;
  return (
    <g
      data-illus-primitive="glyph-frame"
      data-illus-glyph-face={resolved}
      data-illus-glyph-width={extent ? extent.width : undefined}
      data-illus-glyph-height={extent ? extent.height : undefined}
      transform={faceTransform(resolved, origin)}
    >
      {children}
    </g>
  );
}

GlyphFrame.illusLayer = "detail" as const;
