// ==================================================================================================
// iso-math — the projection, ONCE (D-IL2 / D-IL15, research 3.1)
// ==================================================================================================
// Every coordinate in this package comes from this file. No component eyeballs a projection, no
// component writes its own `transform`, and no component decides how big a unit is. That is the
// whole point of the drafting-calibration decision: errors at grid level compound with no recovery
// path, so the grid is constructed first and everything snaps to it.
//
// **Pure functions. No React import.** WP 0.2's spec asks for both this file and a `CalibrationCube`
// under the same heading; the cube is a React component, so its GEOMETRY lives here
// (`isoBoxCorners`) and its rendering lives in `primitives/CalibrationCube.tsx`. Keeping React out
// is the constraint that actually matters — it is what lets the export path, a future layout engine
// and the tests share this math without dragging a renderer along.
//
// Determinism (same inputs => same output) is a hard requirement: no randomness, no clock, no DOM
// measurement. Numbers are rounded through `fmt` before they reach an attribute so that two runs
// produce byte-identical SVG.

import type {
  IllustrationFacing,
  IllustrationPortDef,
  IllustrationSize,
} from "@mcp-token-footprint/shared";

// -- The unit grid ---------------------------------------------------------------------------------

/** 1 iso unit = 16 px in the base viewBox (D-IL2). Every dimension in the package is a multiple. */
export const ISO_UNIT = 16;

/** True isometric: the two horizontal axes sit at exactly 30 degrees, 120 degrees apart. */
export const ISO_AXIS_ANGLE_DEG = 30;

const DEG = Math.PI / 180;

/** cos 30 = sqrt(3)/2. The horizontal component of one unit along either ground axis. */
export const ISO_COS30 = Math.cos(ISO_AXIS_ANGLE_DEG * DEG);

/**
 * sin 30 = 1/2, written EXACTLY rather than as `Math.sin(Math.PI / 6)`, which returns
 * 0.49999999999999994. The float error is meaningless on screen but it turns every hand-computed
 * assertion into an approximate one for no reason. `iso-math.test.ts` pins the two against each
 * other so this shortcut can never quietly become a different number.
 */
export const ISO_SIN30 = 0.5;

/** Screen pixels per unit along a ground axis: horizontal 13.856..., vertical 8. */
export const ISO_KX = ISO_COS30 * ISO_UNIT;
export const ISO_KY = ISO_SIN30 * ISO_UNIT;

/**
 * The 86.6% factor (D-IL15). It is the vertical-scale step of the three fixed face recipes below,
 * and it is load-bearing: change it and every face transform stops agreeing with `project`, which
 * is exactly what `iso-math.test.ts` measures.
 */
export const ISO_FACE_SCALE_Y = ISO_COS30;

/** tan 30 = 0.57735...: how far a ground axis falls per pixel it travels sideways. */
export const ISO_TAN30 = Math.tan(ISO_AXIS_ANGLE_DEG * DEG);

/**
 * The iso-ellipse rule (research 3.1): a circle drawn on any face projects to an ellipse whose minor
 * axis is 0.577 of its major axis. It is the same tangent — an ellipse is what a circle looks like
 * once one of its axes has fallen away at 30 degrees.
 */
export const ISO_ELLIPSE_RATIO = ISO_TAN30;

/**
 * The quantized footprints (D-IL2): S 4x4, M 6x6, L 8x8 units on the platform top face. Quantization
 * is what makes two components interchangeable inside a scene.
 */
export const ISO_FOOTPRINT_UNITS: Record<IllustrationSize, number> = { s: 4, m: 6, l: 8 };

/** Heights are 1-4 units. A solid outside that range is a scale error, not a style choice. */
export const ISO_HEIGHT_UNITS_MIN = 1;
export const ISO_HEIGHT_UNITS_MAX = 4;

export function footprintUnits(size: IllustrationSize): number {
  return ISO_FOOTPRINT_UNITS[size];
}

export function clampHeightUnits(units: number): number {
  return Math.min(ISO_HEIGHT_UNITS_MAX, Math.max(ISO_HEIGHT_UNITS_MIN, units));
}

// -- Points ----------------------------------------------------------------------------------------

/** A point in the world, in iso units: x and y run along the ground axes, z is up. */
export type IsoPoint = readonly [x: number, y: number, z: number];

/** A point in the rendered SVG, in pixels. */
export type ScreenPoint = { readonly x: number; readonly y: number };

export const SCREEN_ORIGIN: ScreenPoint = { x: 0, y: 0 };

/**
 * The projection. Everything else in this file is a consequence of these two lines.
 *
 *   screen x = (x - y) * KX          the two ground axes splay left and right at 30 degrees
 *   screen y = (x + y) * KY - z * U  both ground axes fall as they recede; z is straight up
 *
 * No vanishing point: this is axonometric, so any component can be placed anywhere in a scene
 * without being re-projected, which is what keeps compositions modular.
 */
export function project(x: number, y: number, z = 0): ScreenPoint {
  return { x: (x - y) * ISO_KX, y: (x + y) * ISO_KY - z * ISO_UNIT };
}

export function projectPoint(point: IsoPoint): ScreenPoint {
  return project(point[0], point[1], point[2]);
}

export function translateScreen(point: ScreenPoint, dx: number, dy: number): ScreenPoint {
  return { x: point.x + dx, y: point.y + dy };
}

// -- Number formatting (determinism) ---------------------------------------------------------------

/**
 * Round to `dp` decimals and drop the trailing zeros, so `13.856406460551018` becomes `13.856`.
 * `-0` is normalized to `0`: it renders identically but would make two byte-comparisons of the same
 * drawing disagree.
 */
export function fmt(value: number, dp = 3): string {
  const rounded = Number(value.toFixed(dp));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** `x,y x,y ...` for a `points` attribute. */
export function polygonPoints(points: readonly ScreenPoint[]): string {
  return points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ");
}

/** `M x y L x y ...` for a `d` attribute. */
export function polylinePath(points: readonly ScreenPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`)
    .join(" ");
}

// -- The three fixed face transforms (D-IL15) ------------------------------------------------------

/** The three visible faces of a solid, named for where they sit on screen. */
export type IsoFace = "top" | "left" | "right";

/**
 * The faces in LIGHTING order — top lightest, then left, then right darkest (D-IL2). This is the
 * order the separation floor is measured along, and the order a catalogue lists them in.
 */
export const ISO_FACES: readonly IsoFace[] = ["top", "left", "right"];

/**
 * The faces in PAINT order, which is a different question and a different answer: back to front,
 * so the top face covers the two side faces where they meet rather than the other way round. A
 * solid painted in lighting order looks like three separate quadrilaterals.
 */
export const ISO_FACE_PAINT_ORDER: readonly IsoFace[] = ["left", "right", "top"];

/** An SVG transform matrix, in SVG's own order: `matrix(a b c d e f)`. */
export type IsoMatrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * The three recipes, exactly as research 3.1 states them: shear, then scale vertically by 86.6%,
 * then rotate. Flat, screen-space art goes through one of these and lands on a face; there is no
 * fourth recipe and no ad-hoc `transform` anywhere in the package.
 *
 * DIVERGENCE FROM THE SPEC TEXT, recorded rather than silently applied. The spec writes the recipes
 * as "top: scaleY(0.866); left: shear -30, scaleY(0.866), rotate 30; right: mirrored". Two things
 * differ here, both forced by SVG rather than chosen:
 *
 *   1. `top` is NOT scaleY alone. A bare vertical squash leaves art axis-aligned; the top face is a
 *      rhombus, so the recipe needs its shear and rotation like the other two. The scale STEP is the
 *      0.866 the spec names, and it is the same 0.866 on all three faces.
 *   2. The shear SIGNS are the opposite of the spec's. SVG's y axis points DOWN, while the drafting
 *      recipe the spec quotes is written for a y-up design tool, which flips the sense of a shear.
 *
 * Neither is a judgement call, and neither is trusted on argument: `iso-math.test.ts` checks that
 * each matrix reproduces `project` exactly on the face it claims — the strongest available statement
 * that the recipe and the projection are the same geometry.
 */
const FACE_RECIPE: Record<IsoFace, { readonly rotateDeg: number; readonly shearDeg: number }> = {
  top: { rotateDeg: 30, shearDeg: -30 },
  left: { rotateDeg: 30, shearDeg: 30 },
  right: { rotateDeg: -30, shearDeg: -30 },
};

/** Matrix product in SVG's convention: `apply(multiply(m, n), p) === apply(m, apply(n, p))`. */
export function multiplyMatrix(m: IsoMatrix, n: IsoMatrix): IsoMatrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: IsoMatrix, x: number, y: number): ScreenPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * The matrix that mounts flat art onto `face`, with the art's own origin placed at `origin`
 * (a SCREEN point, normally `projectPoint` of the face corner the art hangs from).
 *
 * Art coordinates are plain screen pixels before the transform: x runs rightward across the face as
 * viewed, y runs down it. That is what makes a glyph drawn in a rectangle usable on any face.
 */
export function faceMatrix(face: IsoFace, origin: ScreenPoint = SCREEN_ORIGIN): IsoMatrix {
  const { rotateDeg, shearDeg } = FACE_RECIPE[face];
  const cos = Math.cos(rotateDeg * DEG);
  const sin = Math.sin(rotateDeg * DEG);
  const rotate: IsoMatrix = [cos, sin, -sin, cos, 0, 0];
  const shear: IsoMatrix = [1, 0, Math.tan(shearDeg * DEG), 1, 0, 0];
  const scaleY: IsoMatrix = [1, 0, 0, ISO_FACE_SCALE_Y, 0, 0];
  const translate: IsoMatrix = [1, 0, 0, 1, origin.x, origin.y];
  return multiplyMatrix(translate, multiplyMatrix(rotate, multiplyMatrix(shear, scaleY)));
}

/** The same thing as an attribute value. Rounded, so the same props always emit the same bytes. */
export function faceTransform(face: IsoFace, origin: ScreenPoint = SCREEN_ORIGIN): string {
  const m = faceMatrix(face, origin);
  return `matrix(${m.map((value) => fmt(value, 4)).join(" ")})`;
}

// -- The iso-ellipse rule --------------------------------------------------------------------------

/**
 * How far an ellipse on each face is rotated, in degrees, when it is written as an SVG ellipse whose
 * `rx` is its MAJOR axis (horizontal before rotation).
 *
 * DIVERGENCE FROM THE SPEC TEXT, recorded. The spec says a side-facing circle is "the same ellipse
 * rotated +/-30". That describes the MINOR axis, which in isometric drafting always lies along the
 * face's normal — and the face normals do sit at +/-30. Expressed as a rotation of a horizontal-major
 * ellipse, which is what an SVG author actually writes, the same ellipse is rotated -/+60. Same
 * ellipse, different half of it named; the test derives the angle from `faceMatrix` rather than
 * taking either number on trust.
 */
export const ISO_ELLIPSE_ROTATION: Record<IsoFace, number> = { top: 0, left: 60, right: -60 };

export type IsoEllipse = {
  /** Semi-major axis, in px: half the ellipse's own width before rotation. */
  readonly rx: number;
  /** Semi-minor axis: `rx * 0.577`. */
  readonly ry: number;
  /** Degrees to rotate about the ellipse's centre. */
  readonly rotate: number;
};

/**
 * A circle of the given on-screen `width`, lying flat on `face`. Passing the width (rather than the
 * face-local diameter) is deliberate: a component author is sizing a dial they can see, and the
 * face-local pre-image is never the interesting number.
 */
export function isoEllipse(face: IsoFace, width: number): IsoEllipse {
  const rx = width / 2;
  return { rx, ry: rx * ISO_ELLIPSE_RATIO, rotate: ISO_ELLIPSE_ROTATION[face] };
}

// -- Solids ----------------------------------------------------------------------------------------

/** A box on the unit grid: a footprint centred on (cx, cy), rising from z0 by `h`. */
export type IsoBox = {
  readonly cx: number;
  readonly cy: number;
  /** Extent along world x, in units. */
  readonly w: number;
  /** Extent along world y, in units. */
  readonly d: number;
  readonly z0: number;
  readonly h: number;
};

/**
 * The three visible faces of a box, as screen polygons, in the order they must be painted:
 * left (+y) behind, right (+x) next, top last. Back-to-front painting is what makes a solid read as
 * a solid without any depth buffer.
 */
export function isoBoxCorners(box: IsoBox): Record<IsoFace, readonly ScreenPoint[]> {
  const { cx, cy, w, d, z0, h } = box;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - d / 2;
  const y1 = cy + d / 2;
  const zt = z0 + h;
  return {
    left: [project(x0, y1, zt), project(x1, y1, zt), project(x1, y1, z0), project(x0, y1, z0)],
    right: [project(x1, y0, zt), project(x1, y1, zt), project(x1, y1, z0), project(x1, y0, z0)],
    top: [project(x0, y0, zt), project(x1, y0, zt), project(x1, y1, zt), project(x0, y1, zt)],
  };
}

/**
 * The screen point of the corner a face's flat art hangs from — its top-left as VIEWED — so that
 * `GlyphFrame` can say "put this glyph on the left face" and get a usable origin without the caller
 * doing any projection.
 *
 * left  (+y): the corner at (x0, y1, zt) — art then runs along +x and downward.
 * right (+x): the corner at (x1, y1, zt) — art runs along -y (rightward as viewed) and downward.
 * top   (+z): the corner at (x0, y0, zt) — art runs along +x and +y.
 */
export function faceOrigin(box: IsoBox, face: IsoFace): ScreenPoint {
  const { cx, cy, w, d, z0, h } = box;
  const zt = z0 + h;
  if (face === "left") return project(cx - w / 2, cy + d / 2, zt);
  if (face === "right") return project(cx + w / 2, cy + d / 2, zt);
  return project(cx - w / 2, cy - d / 2, zt);
}

/** The on-screen size of a face, in px, so art can be laid out inside it without guessing. */
export function faceExtent(box: IsoBox, face: IsoFace): { width: number; height: number } {
  if (face === "top") return { width: box.w * ISO_UNIT, height: box.d * ISO_UNIT };
  const along = face === "left" ? box.w : box.d;
  return { width: along * ISO_UNIT, height: box.h * ISO_UNIT };
}

// -- Ports (D-IL7): a named side, never a coordinate -----------------------------------------------

/**
 * Resolve a registry port declaration to a world point. The registry stores a SIDE and an optional
 * offset along it — never a coordinate — so this is the one place the two meet, and a component can
 * be redrawn without a scene's connectors moving.
 *
 * `offset` runs in grid units along the named side: along +x for `top`/`bottom`/`left`, and along -y
 * for `right` (which is the same "rightward as viewed" direction the face transform uses).
 */
export function portAnchor(
  port: IllustrationPortDef,
  footprint: number,
  heightUnits: number,
): IsoPoint {
  const half = footprint / 2;
  const offset = port.offset ?? 0;
  switch (port.side) {
    case "top":
      return [offset, 0, heightUnits];
    case "bottom":
      return [offset, 0, 0];
    case "left":
      return [offset, half, heightUnits / 2];
    // `0 - 0` is negative zero, which renders identically but breaks byte comparison.
    case "right":
      return [half, offset === 0 ? 0 : -offset, heightUnits / 2];
  }
}

// -- Gaze (D-IL17) ---------------------------------------------------------------------------------

/**
 * Which face an entity's front panel mounts on. `upstream` (the default) puts it on the LEFT (+y)
 * face, so that in a left-to-right process scene a character looks toward the incoming work.
 */
export function facingFace(facing: IllustrationFacing): IsoFace {
  return facing === "upstream" ? "left" : "right";
}

// -- Leader lines (D-IL16) -------------------------------------------------------------------------

/**
 * The only directions an annotation leader may travel: the three isometric axes as they appear on
 * screen. 30 and 150 are the two ground axes; 90 is straight up. A leader that runs at any other
 * angle reads as decoration stuck onto the drawing rather than part of the drafting.
 */
export const ISO_LEADER_ANGLES_DEG: readonly number[] = [30, 90, 150];

/**
 * A two-segment elbow from `from` to `to`: one leg along a ground axis (30 or 150, whichever heads
 * toward the target), then one straight up or down. Both legs are in `ISO_LEADER_ANGLES_DEG` by
 * construction, and the path lands exactly on `to` — there is no rounding slack and no third leg.
 *
 * The ground leg descends or climbs with the target rather than always descending. Always descending
 * is what a first cut does, and it sends a leader to a card ABOVE its anchor on a long detour below
 * both — technically at the right angles, and visibly wrong.
 */
export function isoLeaderPoints(from: ScreenPoint, to: ScreenPoint): readonly ScreenPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1e-9) return [from, to];
  // The ground leg covers the whole horizontal distance; the vertical leg takes what is left.
  const rise = dy < 0 ? -1 : 1;
  const bend: ScreenPoint = { x: to.x, y: from.y + rise * Math.abs(dx) * ISO_TAN30 };
  if (Math.abs(bend.y - to.y) < 1e-9) return [from, to];
  return [from, bend, to];
}

export function isoLeaderPath(from: ScreenPoint, to: ScreenPoint): string {
  return polylinePath(isoLeaderPoints(from, to));
}
