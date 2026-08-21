// ==================================================================================================
// IsoFigure — the standing figure: torso, neck, head, visor (D-IL12)
// ==================================================================================================
// WP 1.1 §3 asked a question outright rather than letting it be decided by whichever was cheaper:
// is `validator` a new component that happens to look like `agent` plus a shield, or a variant of
// `agent`? It is a new component — "validator" is a thing an operator NAMES, and the registry is
// what the gallery, the scene validator and the assistant search, so it needs its own id. Which
// makes the robot itself a shape TWO entities draw, and D-IL12 is explicit that a reusable shape
// goes in `primitives/` and is never inlined into one entity.
//
// So this is the figure, and `Agent` was refactored onto it. What actually moved is worth being
// honest about, because "a primitive that abstracts nothing is also a finding": three stacked
// solids whose proportions are the owner exemplar's, the sequential arithmetic that stacks them
// (which is load-bearing — see `figureBoxes`), and the visor, which is the only piece with any real
// drawing in it. That is a genuine shared shape rather than one polygon: about fifty lines that
// `Validator` would otherwise have copied, plus the guarantee that the two figures cannot drift
// apart at the shoulders. It also pays forward — research 5's tier-3 cast is `assistant` and
// `owner/user`, which are the same silhouette again.
//
// What did NOT move: the antenna (the agent's, and the agent's alone), the chest plates, and the
// shield. An entity's identity is what it carries, not that it stands upright.
//
// The eye colour is read from the entity frame rather than passed in, so a figure inside ANY entity
// answers `error` the same way without that entity remembering to wire it.

import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { GlyphFrame } from "./GlyphFrame.js";
import { IsoHousing } from "./IsoHousing.js";
import { useEntityFrame } from "./entity-frame.js";

/**
 * The owner exemplar's proportions (`planning/Roadmap/RM-14-illustrations/examples/Agent.example.tsx`),
 * as fractions of the footprint so the same figure exists at S, M and L. At `m` (footprint 6) every
 * one evaluates to the exemplar's own number: torso 2.9 wide by 1.8 tall from z 1.2, neck 0.9 by
 * 0.18 from 3.0, head 2.2 by 1.4 from 3.18.
 */
export const FIGURE_PROPORTIONS = {
  torsoWidth: 2.9 / 6,
  torsoHeight: 1.8 / 6,
  neckWidth: 0.9 / 6,
  neckHeight: 0.18 / 6,
  headWidth: 2.2 / 6,
  headHeight: 1.4 / 6,
} as const;

export type FigureBoxes = {
  readonly torso: IsoBox;
  readonly neck: IsoBox;
  readonly head: IsoBox;
  /** The world z of the top of the head — where an antenna starts, or where the figure ends. */
  readonly crown: number;
};

/**
 * The three solids, stacked from `floor`. The arithmetic is SEQUENTIAL — each box's `z0` is the
 * previous box's `z0 + h` — and deliberately not folded into one sum: the exemplar's 5.35-unit
 * antenna tip is pinned to three decimal places by `Agent.test.tsx`, and float addition is not
 * associative, so re-associating this would move it.
 */
export function figureBoxes(footprint: number, floor: number): FigureBoxes {
  const torsoSide = footprint * FIGURE_PROPORTIONS.torsoWidth;
  const torsoHeight = footprint * FIGURE_PROPORTIONS.torsoHeight;
  const neckSide = footprint * FIGURE_PROPORTIONS.neckWidth;
  const neckHeight = footprint * FIGURE_PROPORTIONS.neckHeight;
  const headSide = footprint * FIGURE_PROPORTIONS.headWidth;
  const headHeight = footprint * FIGURE_PROPORTIONS.headHeight;
  const torso: IsoBox = { cx: 0, cy: 0, w: torsoSide, d: torsoSide, z0: floor, h: torsoHeight };
  const neck: IsoBox = {
    cx: 0,
    cy: 0,
    w: neckSide,
    d: neckSide,
    z0: floor + torsoHeight,
    h: neckHeight,
  };
  const head: IsoBox = {
    cx: 0,
    cy: 0,
    w: headSide,
    d: headSide,
    z0: neck.z0 + neckHeight,
    h: headHeight,
  };
  return { torso, neck, head, crown: head.z0 + headHeight };
}

/** How tall a figure standing on `floor` reaches, in units. */
export function figureHeightUnits(footprint: number, floor: number): number {
  return figureBoxes(footprint, floor).crown;
}

export type IsoFigureProps = {
  /** The entity's footprint, in units — every proportion is a fraction of it. */
  footprint: number;
  /** The z the figure stands on: normally the top of its plinth. */
  floor: number;
  /** Draw the visor on the gaze face (D-IL17). Off for a figure that carries its face elsewhere. */
  visor?: boolean;
};

export function IsoFigure({ footprint, floor, visor = true }: IsoFigureProps): ReactElement {
  const { torso, neck, head } = figureBoxes(footprint, floor);
  const { state } = useEntityFrame();
  // The eyes are INK, not accent: a figure's accent moment belongs to what it carries (the agent's
  // antenna LED, the validator's verdict mark), and two figures side by side must not spend two
  // accents just by standing there (D-IL6). `error` is the one recolour.
  const eye = state === "error" ? "var(--illus-error)" : "var(--illus-ink)";
  return (
    <g data-illus-primitive="iso-figure">
      <IsoHousing width={torso.w} depth={torso.d} height={torso.h} z0={torso.z0} />
      <IsoHousing width={neck.w} depth={neck.d} height={neck.h} z0={neck.z0} weight="detail-fine" />
      <IsoHousing width={head.w} depth={head.d} height={head.h} z0={head.z0} />
      {visor ? <Visor box={head} eye={eye} /> : null}
    </g>
  );
}

IsoFigure.illusLayer = "structure" as const;

/**
 * The visor and its two eyes, on the GAZE face of the head (D-IL17).
 *
 * `faceExtent` is asked for the LEFT face even though the art may land on the right one: every box
 * the figure draws is square (`w === d`), and for a square box the two side faces have identical
 * on-screen extents. `GlyphFrame` resolves which face the art actually mounts on; the extent is only
 * used to lay the art out inside it.
 */
function Visor({ box, eye }: { box: IsoBox; eye: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const visorWidth = width * 0.78;
  const visorHeight = height * 0.58;
  const x = (width - visorWidth) / 2;
  const y = (height - visorHeight) / 2;
  const pupil = Math.min(visorWidth, visorHeight) * 0.19;
  return (
    <GlyphFrame face="gaze" box={box}>
      <rect
        x={fmt(x)}
        y={fmt(y)}
        width={fmt(visorWidth)}
        height={fmt(visorHeight)}
        rx={fmt(Math.min(4, visorHeight / 3))}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
      />
      <circle
        cx={fmt(x + visorWidth * 0.31)}
        cy={fmt(y + visorHeight / 2)}
        r={fmt(pupil)}
        style={{ fill: eye }}
      />
      <circle
        cx={fmt(x + visorWidth * 0.69)}
        cy={fmt(y + visorHeight / 2)}
        r={fmt(pupil)}
        style={{ fill: eye }}
      />
    </GlyphFrame>
  );
}
