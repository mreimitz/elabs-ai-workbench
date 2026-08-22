// ==================================================================================================
// routeScene — connectors become orthogonal paths and placed labels (WP 2.2, system design §4)
// ==================================================================================================
// This is pass TWO of the two the design describes: "the router draws orthogonal port-to-port paths
// with fixed corner radii, nudging parallel runs apart, and places labels at path midpoints with
// collision avoidance against node boxes only (cheap, deterministic — no force simulation, no
// measurement of rendered text)".
//
// ── IT IS PURE GEOMETRY, AND THAT IS THE POINT ────────────────────────────────────────────────────
// In: a `SceneLayout` and the spec's connectors. Out: numbers — a polyline, its path data, a label
// box. There is NO React here, no SVG element, no colour, no stroke weight and no dash. Painting a
// routed path — which `--illus-*` stroke it takes, which `ILLUS_DASH` its kind maps to, which marker
// sits on its head — is WP 2.3's job, because that is the layer that emits elements. The split is
// not tidiness: a pure function returning numbers can be golden-tested to the byte, which is how
// WP 2.1 proved determinism and how this file proves it too.
//
// A future author must not be able to smuggle paint through the geometry layer, so no output type
// below carries a `stroke`, `fill`, `color`, `className` or `opacity`. `kind` is carried, because it
// is the AUTHOR'S meaning copied verbatim from the spec (D-IL8) — the renderer maps meaning to
// pixels, and a scene still physically cannot express a style.
//
// ── WHAT IT READS, AND THE ONE THING IT MUST NOT LEARN ────────────────────────────────────────────
// `layout.endpoints` already resolves every `nodeId.port` and every `bandId.entry`/`.exit` to a
// canvas point, so this file looks up two keys and draws between them and NEVER LEARNS WHAT A BAND
// IS — that is the seam WP 2.1's header draws, and it is about band structure, not about the map.
// `layout.nodes` is read for three things only: a port's owning component (to ask the catalog for
// its declared side), its FRAME (the fallback departure rule), and the boxes a label must keep
// clear of. It also takes the same `SceneCatalog` the layout engine takes, because a port's side is
// a fact about the COMPONENT, held in the registry entry, not about the box drawn for it.
//
// No position is re-derived, and `iso-math`'s projection is deliberately not imported — ports
// resolve to plain screen points, so the router works in ordinary screen space.
//
// ── IT NEVER THROWS ───────────────────────────────────────────────────────────────────────────────
// Same discipline as `layout.ts`: a connector naming an endpoint the layout does not have is
// reported in {@link SceneRouting.unresolved} rather than crashing a preview.
//
// ── DETERMINISM IS THE ACCEPTANCE CRITERION ───────────────────────────────────────────────────────
// Same layout and same connectors ⇒ byte-identical output. Four rules keep it, and `route.test.ts`
// greps this file for the ways of breaking them:
//
//   • no clock and no randomness;
//   • no DOM measurement — in particular a label's box is COMPUTED from its character count, never
//     measured with `getBBox`. An approximate box is correct here; a measured one is unbuildable in
//     a pure function and would differ between a browser and a test runner;
//   • parallel runs are ordered by connector IDENTITY, not by their position in the array, so the
//     same spec routes the same way after a JSON round trip or an editor reshuffle;
//   • every emitted number goes through `roundScene`, so float noise cannot make two runs disagree.

import type {
  IllustrationConnectorKind,
  IllustrationPortSide,
  IllustrationSceneConnector,
} from "@mcp-token-footprint/shared";
import { ISO_UNIT } from "../iso-math.js";
import { ILLUS_TEXT } from "../line-system.js";
import type { SceneCatalog } from "./catalog.js";
import type { SceneLayout, SceneNodeLayout, ScenePoint, SceneRect } from "./layout.js";
import { roundScene } from "./layout.js";
import { splitEndpoint } from "./spec-validate.js";

// -- The dials -------------------------------------------------------------------------------------
// In GRID UNITS wherever they are a distance, exactly as WP 2.1's `*_UNITS` dials are, so the whole
// connector layer scales with `ISO_UNIT` and a nudge is never a free pixel value.

/** Fixed corner radius, clamped per corner — see {@link connectorPathData}. */
export const CONNECTOR_CORNER_UNITS = 0.5;

/** The quantized step two collinear, overlapping runs are pushed apart by. */
export const CONNECTOR_NUDGE_UNITS = 1;

/** How far beyond the further endpoint a `u` route's crossbar sits, so the loop-back has room. */
export const CONNECTOR_STUB_UNITS = 2;

/**
 * The middle half of a node's frame height. A port inside this band is read as sitting on a vertical
 * face (west/east); only a port materially above or below it departs north or south.
 */
export const PORT_MID_BAND_FRACTION = 0.25;

/**
 * How close to the frame's vertical centre line a port must be to count as standing ON it. An
 * entity's view box is symmetric about the point the entity stands on, so a port on that line is the
 * ground port and its only sensible outward direction is down — see {@link framePortDirection}.
 */
export const PORT_CENTRE_TOLERANCE_UNITS = 0.25;

/**
 * Mean advance width of a caption character, as a fraction of the type size.
 *
 * A humanist sans at mixed case averages ~0.5 em per character; 0.55 is taken deliberately on the
 * generous side, because the only failure that matters here is an UNDER-estimate — a box smaller
 * than the text it stands for would report "clear" for a label that visibly overlaps a station. An
 * over-estimate merely displaces a label slightly further than it strictly needed.
 */
export const LABEL_ADVANCE_RATIO = 0.55;

/** Line box height as a fraction of the type size — the usual single-line leading. */
export const LABEL_LINE_RATIO = 1.35;

/** Quiet space around the glyphs, inside the label's box. */
export const LABEL_PADDING_UNITS = 0.25;

/** The quantized step a label is displaced by, perpendicular to the path. */
export const LABEL_NUDGE_UNITS = 1;

/**
 * Where along the path a label may sit: the midpoint first, then outward in steps of 0.08,
 * alternating sides. Sliding along the line is the LAST resort (§2.4) but it has to be fine enough
 * to find the gaps between stations — a node's frame carries its shadow and its caption, so two
 * neighbouring stations in a lane leave a clear channel only a few dozen units wide.
 */
export const LABEL_ALONG_FRACTIONS: readonly number[] = [
  0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82,
];

/** Perpendicular displacement ladder, in {@link LABEL_NUDGE_UNITS}: none, one side, then the other. */
export const LABEL_NUDGE_LADDER: readonly number[] = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];

// -- Output shapes ---------------------------------------------------------------------------------

/** The four screen directions. A connector layer has no diagonals (§2.1). */
export const ORTHO_DIRECTIONS = ["north", "east", "south", "west"] as const;
export type OrthoDirection = (typeof ORTHO_DIRECTIONS)[number];

/**
 * The closed set of route shapes. Two endpoints and two directions admit exactly these:
 *
 * | shape      | when                                              | corners |
 * | ---------- | ------------------------------------------------- | ------- |
 * | `straight` | travel directions agree and the endpoints line up | 0       |
 * | `l`        | travel directions are perpendicular               | 1       |
 * | `z`        | travel directions agree, endpoints offset         | 2       |
 * | `u`        | travel directions oppose (the ports face away)    | 2       |
 *
 * "Travel direction" is what the LINE does, not where a port faces: it leaves along the source
 * port's outward normal and arrives along the OPPOSITE of the target port's. So two ports facing
 * each other (source east, target west) both travel east — that is the `z`. Two ports facing the
 * same way both travel against each other — that is the `u` hairpin.
 *
 * A `cycle` band's `entry`/`exit` are ordinary points on this list; nothing here special-cases them,
 * and the `loop` connector KIND is a painting concern, not a routing one.
 */
export const ROUTE_SHAPES = ["straight", "l", "z", "u"] as const;
export type RouteShape = (typeof ROUTE_SHAPES)[number];

export type RoutedLabel = {
  readonly text: string;
  /** Where the text is centred. The renderer sets its own baseline from this. */
  readonly anchor: ScenePoint;
  /** The approximate box the text occupies, derived from its character count (never measured). */
  readonly box: SceneRect;
  /** How far along the path (0–1) the anchor sits, after displacement. */
  readonly along: number;
  /** Perpendicular displacement applied, in canvas units. Positive is left of travel. */
  readonly offset: number;
  /**
   * TRUE means no candidate placement cleared every node frame, so the label is back at its
   * midpoint and IS sitting on a box. A scene author needs to know that; looping or inventing a
   * position would hide it.
   */
  readonly collides: boolean;
};

export type RoutedConnector = {
  /** Its position in `spec.connectors`. */
  readonly index: number;
  readonly id: string | null;
  /**
   * What the nudge order sorts on: the connector's `id` when it has one, otherwise its endpoints.
   * Never the array position alone — a spec that is re-serialized or reordered in an editor must
   * route identically.
   */
  readonly identity: string;
  readonly from: string;
  readonly to: string;
  readonly kind: IllustrationConnectorKind;
  readonly shape: RouteShape;
  /** The source port's outward normal — the direction the line leaves along. */
  readonly fromDirection: OrthoDirection;
  /** The target port's outward normal. The line ARRIVES along the opposite of this. */
  readonly toDirection: OrthoDirection;
  /** Start, corners, end. Consecutive points always differ on exactly one axis. */
  readonly points: readonly ScenePoint[];
  readonly corners: number;
  /** The polyline as SVG path data, corners rounded and clamped. */
  readonly d: string;
  /** The perpendicular offset applied to this route's free run by parallel-run nudging. */
  readonly nudge: number;
  /**
   * TRUE when the first run does not travel along `fromDirection`, or the last does not arrive
   * along the opposite of `toDirection` — the line leaves or lands against its own port.
   *
   * The four shapes above are complete over DIRECTION PAIRS but not over POSITIONS: a port facing
   * east whose partner sits to the west has no 1- or 2-corner orthogonal path that honours it, and
   * the closed set has no fifth shape to fall back to. Reporting it beats hiding it.
   *
   * This field is deliberately NOT in WP 2.2's spec; it is the sibling of {@link
   * RoutedLabel.collides}, kept on the same reasoning — a scene author needs to know when the
   * drawing could not honour what the spec asked for. The remaining cases are real geometry the
   * closed set cannot express, and what to do about them (a fifth shape, or better port choices in
   * the scene) belongs to the acceptance scene in WP 2.4, not here.
   */
  readonly doublesBack: boolean;
  readonly label: RoutedLabel | null;
};

export type UnresolvedConnector = {
  readonly index: number;
  readonly id: string | null;
  readonly from: string;
  readonly to: string;
  /** The endpoint keys the layout could not resolve. */
  readonly missing: readonly string[];
};

export type SceneRouting = {
  readonly routes: readonly RoutedConnector[];
  readonly unresolved: readonly UnresolvedConnector[];
};

// -- Small geometry --------------------------------------------------------------------------------

const VECTORS: Record<OrthoDirection, ScenePoint> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

const OPPOSITES: Record<OrthoDirection, OrthoDirection> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east",
};

/** The direction a line travels when it arrives at a port whose outward normal is `direction`. */
export function arrivalDirection(direction: OrthoDirection): OrthoDirection {
  return OPPOSITES[direction];
}

function isHorizontal(direction: OrthoDirection): boolean {
  return direction === "east" || direction === "west";
}

function roundPoint(point: ScenePoint): ScenePoint {
  return { x: roundScene(point.x), y: roundScene(point.y) };
}

/** How far `to` lies beyond `from` in `direction`. Negative means it is behind. */
function advance(from: ScenePoint, to: ScenePoint, direction: OrthoDirection): number {
  const vector = VECTORS[direction];
  return (to.x - from.x) * vector.x + (to.y - from.y) * vector.y;
}

function samePoint(left: ScenePoint, right: ScenePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function overlaps(left: SceneRect, right: SceneRect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

// -- The departure rule ----------------------------------------------------------------------------
//
// The single most re-read decision in this file, and WP 2.3 wants it too, for marker rotation. It is
// THREE rules in strict precedence, and the router takes the first that can answer:
//
//   1. `portSideDirection` — the side the CATALOG declares for that port. This is the answer
//      whenever the endpoint names a catalogued node port, which is nearly always;
//   2. `framePortDirection` — geometry, for a port the catalog does not describe;
//   3. `endpointDirectionsToward` — for an endpoint with no owning box at all, which is exactly
//      what a `cycle` band's `entry`/`exit` gate is.
//
// Rule 1 exists because the registry already answers this question and says so in as many words:
// `ILLUSTRATION_PORT_SIDES` is documented as "the coarse attachment hint the connector router
// needs". Rule 2 was this file's first cut, written on the belief that no declared normal existed;
// measured against the catalog over both fixtures it agreed on 89 of 93 ports, and all four
// disagreements were the same kind of port — a ground port carried off the frame's centre by an
// `offset`. It is DEMOTED rather than deleted, because rule 3 cannot serve a port that has a box:
// a scene may name a component the catalog never heard of, which the layout still gives a fallback
// box and no port records at all.

/**
 * The declared side of a port, as a screen direction. This map is the whole of rule 1.
 *
 * The four sides name ISOMETRIC faces, but each projects to an unambiguous screen direction under
 * the fixed projection in `iso-math.ts`: `top` (z = height) rises, `bottom` (z = 0) is the ground
 * the entity stands on, and the two ground faces (+y, +x) project down-LEFT and down-RIGHT with the
 * horizontal component dominant (`ISO_KX` about 13.86 against `ISO_KY` = 8). The mapping is
 * arithmetic, not taste — and the router still never imports the projection itself.
 */
export const PORT_SIDE_DIRECTIONS: Record<IllustrationPortSide, OrthoDirection> = {
  top: "north",
  bottom: "south",
  left: "west",
  right: "east",
};

/** Rule 1: where a line leaves a port whose side the catalog declares. */
export function portSideDirection(side: IllustrationPortSide): OrthoDirection {
  return PORT_SIDE_DIRECTIONS[side];
}

/**
 * Rule 2 — the fallback for a port that has a box but no catalogued side. Derived from where the
 * point sits inside its owning node's `frame`:
 *
 *   1. materially above or below the frame's vertical mid-band (the middle
 *      {@link PORT_MID_BAND_FRACTION} either side of centre) gives north or south;
 *   2. otherwise on the frame's vertical centre line, within
 *      {@link PORT_CENTRE_TOLERANCE_UNITS}, gives south. An entity's view box is symmetric about
 *      the point the entity STANDS on, so a port on that line is the ground port and down is the
 *      only direction it can face;
 *   3. otherwise the left half departs west and the right half departs east.
 *
 * ── WHAT A BOX PROVABLY CANNOT TELL YOU ───────────────────────────────────────────────────────────
 * Clause 2 is not a tie-break for tidiness, it is the whole reason a ground port works at all here:
 * that port sits at the frame's centre on BOTH axes, so clauses 1 and 3 are blind to it. And it
 * still does not rescue a ground port carried off the centre line by an `offset`, which is exactly
 * the residue that made rule 1 necessary. Do not promote this back to primary.
 */
export function framePortDirection(point: ScenePoint, frame: SceneRect): OrthoDirection {
  const dy = point.y - (frame.y + frame.height / 2);
  if (Math.abs(dy) > frame.height * PORT_MID_BAND_FRACTION) return dy < 0 ? "north" : "south";
  const dx = point.x - (frame.x + frame.width / 2);
  if (Math.abs(dx) <= PORT_CENTRE_TOLERANCE_UNITS * ISO_UNIT) return "south";
  return dx < 0 ? "west" : "east";
}

/**
 * The directions an endpoint with NO owning box may face, best first.
 *
 * A `cycle` band's gate is a bare point: it has no frame, so it has no faces, and the only thing it
 * can be oriented by is the endpoint at the other end of the line. It faces toward that point — on
 * the axis of greatest separation first, then on the other, so the caller can fall to the second
 * when the first would make the line leave backwards. An endpoint aligned on one axis offers only
 * one candidate, because "toward" has no meaning on the axis with no separation.
 */
export function endpointDirectionsToward(
  point: ScenePoint,
  other: ScenePoint,
): readonly OrthoDirection[] {
  const dx = other.x - point.x;
  const dy = other.y - point.y;
  const horizontal: OrthoDirection = dx >= 0 ? "east" : "west";
  const vertical: OrthoDirection = dy >= 0 ? "south" : "north";
  if (dx === 0 && dy === 0) return ["east"];
  if (dx === 0) return [vertical];
  if (dy === 0) return [horizontal];
  return Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];
}

// -- The four shapes -------------------------------------------------------------------------------

/** Which of the four shapes a direction pair and a pair of points call for (see {@link ROUTE_SHAPES}). */
export function routeShapeOf(
  exit: OrthoDirection,
  enter: OrthoDirection,
  from: ScenePoint,
  to: ScenePoint,
): RouteShape {
  if (exit === OPPOSITES[enter]) return "u";
  if (exit !== enter) return "l";
  const offset = isHorizontal(exit) ? to.y - from.y : to.x - from.x;
  return offset === 0 ? "straight" : "z";
}

/** The polyline for a shape, before nudging and before rounding. */
function shapePoints(
  shape: RouteShape,
  exit: OrthoDirection,
  from: ScenePoint,
  to: ScenePoint,
): ScenePoint[] {
  const horizontal = isHorizontal(exit);
  switch (shape) {
    case "straight":
      return [from, to];
    case "l":
      return [from, horizontal ? { x: to.x, y: from.y } : { x: from.x, y: to.y }, to];
    case "z": {
      if (horizontal) {
        const split = (from.x + to.x) / 2;
        return [from, { x: split, y: from.y }, { x: split, y: to.y }, to];
      }
      const split = (from.y + to.y) / 2;
      return [from, { x: from.x, y: split }, { x: to.x, y: split }, to];
    }
    case "u": {
      const stub = CONNECTOR_STUB_UNITS * ISO_UNIT;
      const sign = horizontal ? VECTORS[exit].x : VECTORS[exit].y;
      if (horizontal) {
        const bar = sign > 0 ? Math.max(from.x, to.x) + stub : Math.min(from.x, to.x) - stub;
        return [from, { x: bar, y: from.y }, { x: bar, y: to.y }, to];
      }
      const bar = sign > 0 ? Math.max(from.y, to.y) + stub : Math.min(from.y, to.y) - stub;
      return [from, { x: from.x, y: bar }, { x: to.x, y: bar }, to];
    }
  }
}

/**
 * Whether a shape can be drawn without leaving or landing against its own port. `u` always can —
 * that is what the hairpin is for — which is why the frameless-endpoint search below can always
 * settle on something honest when a gate has a free choice.
 */
function shapeIsFeasible(
  shape: RouteShape,
  exit: OrthoDirection,
  enter: OrthoDirection,
  from: ScenePoint,
  to: ScenePoint,
): boolean {
  switch (shape) {
    case "u":
      return true;
    case "straight":
      return advance(from, to, exit) >= 0;
    case "z":
      return advance(from, to, exit) > 0;
    case "l":
      return advance(from, to, exit) >= 0 && advance(from, to, enter) >= 0;
  }
}

// -- Path data -------------------------------------------------------------------------------------

/**
 * The polyline as SVG path data, every corner filleted at {@link CONNECTOR_CORNER_UNITS}.
 *
 * The radius is CLAMPED to half the shorter of the two runs a corner joins. That is not an edge
 * case worth a comment, it is the property that keeps the path from self-crossing: a fillet longer
 * than its own run would start before the previous corner ended, and the arc would reverse. Half
 * each also means two corners sharing one short run can never eat into each other.
 */
export function connectorPathData(points: readonly ScenePoint[], radius: number): string {
  const first = points[0];
  if (first === undefined) return "";
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  let data = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (previous === undefined || corner === undefined || next === undefined) continue;

    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const clamped = roundScene(Math.min(radius, inLength / 2, outLength / 2));
    if (clamped <= 0) {
      data += ` L ${corner.x} ${corner.y}`;
      continue;
    }

    const inUnit = {
      x: inLength === 0 ? 0 : (corner.x - previous.x) / inLength,
      y: inLength === 0 ? 0 : (corner.y - previous.y) / inLength,
    };
    const outUnit = {
      x: outLength === 0 ? 0 : (next.x - corner.x) / outLength,
      y: outLength === 0 ? 0 : (next.y - corner.y) / outLength,
    };
    const start = roundPoint({
      x: corner.x - inUnit.x * clamped,
      y: corner.y - inUnit.y * clamped,
    });
    const end = roundPoint({
      x: corner.x + outUnit.x * clamped,
      y: corner.y + outUnit.y * clamped,
    });
    // SVG's y grows downward, so a positive cross product is a clockwise turn on screen, which is
    // the sweep flag's positive direction.
    const sweep = inUnit.x * outUnit.y - inUnit.y * outUnit.x > 0 ? 1 : 0;
    data += ` L ${start.x} ${start.y} A ${clamped} ${clamped} 0 0 ${sweep} ${end.x} ${end.y}`;
  }

  const last = points[points.length - 1];
  return last === undefined ? data : `${data} L ${last.x} ${last.y}`;
}

// -- Labels ----------------------------------------------------------------------------------------

/**
 * The box a caption occupies, from its CHARACTER COUNT — never from a measurement.
 *
 * There is no DOM in a pure function and there must be no `getBBox`: a box that depended on a font
 * having loaded would differ between a browser and a test runner, and determinism is the acceptance
 * criterion. See {@link LABEL_ADVANCE_RATIO} for why the approximation errs generously.
 */
export function labelBoxSize(text: string): { readonly width: number; readonly height: number } {
  const padding = LABEL_PADDING_UNITS * ISO_UNIT;
  return {
    width: text.length * LABEL_ADVANCE_RATIO * ILLUS_TEXT.caption + 2 * padding,
    height: ILLUS_TEXT.caption * LABEL_LINE_RATIO + 2 * padding,
  };
}

type PathWalk = {
  readonly point: ScenePoint;
  /** Unit vector of the run the point sits on. */
  readonly direction: ScenePoint;
};

/** The point at `fraction` of the polyline's length, and the direction of the run it lands on. */
function walkPath(points: readonly ScenePoint[], fraction: number): PathWalk | undefined {
  const first = points[0];
  if (first === undefined) return undefined;
  if (points.length === 1) return { point: first, direction: { x: 1, y: 0 } };

  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = a === undefined || b === undefined ? 0 : Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return { point: first, direction: { x: 1, y: 0 } };

  let remaining = total * fraction;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) continue;
    if (remaining <= length || index === lengths.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, Math.max(0, remaining / length));
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        direction:
          length === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
      };
    }
    remaining -= length;
  }
  return undefined;
}

function labelAt(text: string, walk: PathWalk, offset: number): RoutedLabel {
  // Left of travel, in a y-down space: rotate the run's direction a quarter turn counter-clockwise.
  const perpendicular = { x: walk.direction.y, y: -walk.direction.x };
  const anchor = roundPoint({
    x: walk.point.x + perpendicular.x * offset,
    y: walk.point.y + perpendicular.y * offset,
  });
  const size = labelBoxSize(text);
  return {
    text,
    anchor,
    box: {
      x: roundScene(anchor.x - size.width / 2),
      y: roundScene(anchor.y - size.height / 2),
      width: roundScene(size.width),
      height: roundScene(size.height),
    },
    along: 0,
    offset: roundScene(offset),
    collides: false,
  };
}

/**
 * A label at the path midpoint, then moved clear of the node boxes.
 *
 * Candidates are tried in a FIXED sequence — the midpoint first, then perpendicular one side and
 * the other in quantized steps, then further along the path and the same ladder again — and the
 * first that clears every node frame wins. If nothing clears, the midpoint placement comes back with
 * {@link RoutedLabel.collides} set rather than the router looping or inventing a position.
 *
 * Collision is against node `frame` rectangles ONLY: not other labels, not band frames, not the
 * paths. That is what the system design specifies, and it is what keeps this cheap and obvious.
 */
function placeLabel(
  text: string,
  points: readonly ScenePoint[],
  frames: readonly SceneRect[],
): RoutedLabel | null {
  const step = LABEL_NUDGE_UNITS * ISO_UNIT;
  let fallback: RoutedLabel | null = null;

  for (const fraction of LABEL_ALONG_FRACTIONS) {
    const walk = walkPath(points, fraction);
    if (walk === undefined) continue;
    for (const rung of LABEL_NUDGE_LADDER) {
      const candidate = { ...labelAt(text, walk, rung * step), along: fraction };
      fallback ??= candidate;
      if (!frames.some((frame) => overlaps(candidate.box, frame))) return candidate;
    }
  }
  return fallback === null ? null : { ...fallback, collides: true };
}

// -- Parallel-run nudging --------------------------------------------------------------------------

/**
 * Which run of a route may be pushed sideways: the middle one of a `z` or a `u`, and nothing else.
 *
 * A run touching an endpoint is PINNED — moving it perpendicular would pull the line off its port —
 * so an `l` and a `straight` have no free run at all and two of them lying on top of each other stay
 * on top of each other. That is a property of attaching to ports, not a gap: the router only moves
 * what it owns. A `z` and a `u` each have exactly one free run, which is why one `nudge` per route
 * is an exact description.
 */
function freeRunOf(points: readonly ScenePoint[]): { readonly axis: "x" | "y" } | undefined {
  if (points.length !== 4) return undefined;
  const a = points[1];
  const b = points[2];
  if (a === undefined || b === undefined) return undefined;
  if (a.x === b.x && a.y !== b.y) return { axis: "x" };
  if (a.y === b.y && a.x !== b.x) return { axis: "y" };
  return undefined;
}

type Draft = {
  readonly connector: IllustrationSceneConnector;
  readonly index: number;
  readonly identity: string;
  readonly shape: RouteShape;
  readonly fromDirection: OrthoDirection;
  readonly toDirection: OrthoDirection;
  points: ScenePoint[];
  nudge: number;
};

type Run = {
  readonly draft: Draft;
  /** The axis the run is pushed ALONG when nudged (perpendicular to the run itself). */
  readonly axis: "x" | "y";
  /** Where the run sits on that axis. */
  readonly line: number;
  /** Its extent along its own direction. */
  readonly min: number;
  readonly max: number;
};

/**
 * Push collinear, overlapping free runs apart by a quantized step about their shared centre line.
 *
 * Two connectors drawn on top of each other read as one line, which is a lie about how many things
 * are happening. Grouping is by (axis, line); within a group the runs are swept into overlapping
 * CLUSTERS — two runs on the same line that never overlap need no separation — and each cluster is
 * spread symmetrically about the line it shared.
 *
 * The spread order is by connector IDENTITY, with the array position only as the last tie-break
 * between two connectors that are indistinguishable anyway. Ordering by position alone would make
 * the same spec route differently after an editor reshuffled its connectors.
 */
function nudgeParallelRuns(drafts: readonly Draft[]): void {
  const groups = new Map<string, Run[]>();
  for (const draft of drafts) {
    const free = freeRunOf(draft.points);
    const a = draft.points[1];
    const b = draft.points[2];
    if (free === undefined || a === undefined || b === undefined) continue;
    const line = free.axis === "x" ? a.x : a.y;
    const from = free.axis === "x" ? a.y : a.x;
    const to = free.axis === "x" ? b.y : b.x;
    const key = `${free.axis}@${roundScene(line)}`;
    const run: Run = {
      draft,
      axis: free.axis,
      line,
      min: Math.min(from, to),
      max: Math.max(from, to),
    };
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [run]);
    else existing.push(run);
  }

  const step = CONNECTOR_NUDGE_UNITS * ISO_UNIT;
  // Sorted so the sweep itself does not depend on the order the groups were discovered in.
  for (const key of [...groups.keys()].sort()) {
    const runs = groups.get(key) ?? [];
    if (runs.length < 2) continue;
    const ordered = [...runs].sort(
      (left, right) =>
        left.min - right.min || left.max - right.max || compareIdentity(left.draft, right.draft),
    );

    let cluster: Run[] = [];
    let reach = Number.NEGATIVE_INFINITY;
    const flush = (): void => {
      if (cluster.length > 1) spreadCluster(cluster, step);
      cluster = [];
    };
    for (const run of ordered) {
      if (cluster.length > 0 && run.min >= reach) flush();
      cluster.push(run);
      reach = Math.max(reach, run.max);
    }
    flush();
  }
}

function compareIdentity(left: Draft, right: Draft): number {
  if (left.identity !== right.identity) return left.identity < right.identity ? -1 : 1;
  return left.index - right.index;
}

function spreadCluster(cluster: readonly Run[], step: number): void {
  const ordered = [...cluster].sort((left, right) => compareIdentity(left.draft, right.draft));
  const centre = (ordered.length - 1) / 2;
  for (const [position, run] of ordered.entries()) {
    const offset = (position - centre) * step;
    if (offset === 0) continue;
    run.draft.nudge = offset;
    const a = run.draft.points[1];
    const b = run.draft.points[2];
    if (a === undefined || b === undefined) continue;
    run.draft.points[1] =
      run.axis === "x" ? { x: a.x + offset, y: a.y } : { x: a.x, y: a.y + offset };
    run.draft.points[2] =
      run.axis === "x" ? { x: b.x + offset, y: b.y } : { x: b.x, y: b.y + offset };
  }
}

// -- The router ------------------------------------------------------------------------------------

export type RouteSceneOptions = {
  /**
   * The same catalog `layoutScene` takes, and for the same reason: a port's declared side is a fact
   * about the COMPONENT, held in its registry entry, not a fact about the box the layout drew for
   * it. Taking it here does not teach the router what a band is — the one thing WP 2.1's seam
   * actually forbids — it only lets rule 1 of the departure rule ask the question the registry was
   * already documented as answering.
   */
  readonly catalog: SceneCatalog;
};

/**
 * The declared side of `endpoint`'s port, or `undefined` when nothing in the catalog describes it —
 * an endpoint that names no node (a cycle band's gate), a node drawing a component the catalog
 * never heard of, or a port name the component does not declare.
 */
function declaredSideOf(
  endpoint: string,
  nodes: ReadonlyMap<string, SceneNodeLayout>,
  catalog: SceneCatalog,
): IllustrationPortSide | undefined {
  const split = splitEndpoint(endpoint);
  if (split === undefined) return undefined;
  const node = nodes.get(split.owner);
  if (node === undefined) return undefined;
  return catalog.entry(node.component)?.ports[split.member]?.side;
}

function frameOf(endpoint: string, nodes: ReadonlyMap<string, SceneNodeLayout>): SceneRect | null {
  const split = splitEndpoint(endpoint);
  if (split === undefined) return null;
  return nodes.get(split.owner)?.frame ?? null;
}

/** The departure rule's three-way precedence, in one place — see the section header above. */
function directionCandidates(
  point: ScenePoint,
  other: ScenePoint,
  side: IllustrationPortSide | undefined,
  frame: SceneRect | null,
): readonly OrthoDirection[] {
  if (side !== undefined) return [portSideDirection(side)];
  if (frame !== null) return [framePortDirection(point, frame)];
  return endpointDirectionsToward(point, other);
}

function dedupe(points: readonly ScenePoint[]): ScenePoint[] {
  const kept: ScenePoint[] = [];
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (previous !== undefined && samePoint(previous, point)) continue;
    kept.push(point);
  }
  return kept;
}

function travelOf(from: ScenePoint, to: ScenePoint): OrthoDirection | null {
  if (from.x === to.x && from.y !== to.y) return to.y > from.y ? "south" : "north";
  if (from.y === to.y && from.x !== to.x) return to.x > from.x ? "east" : "west";
  return null;
}

/**
 * Every connector in a spec, routed against a laid-out scene.
 *
 * Deterministic, DOM-free, colour-free and non-throwing — see the header for why each of those is
 * an acceptance property rather than a preference.
 */
export function routeScene(
  layout: SceneLayout,
  connectors: readonly IllustrationSceneConnector[],
  options: RouteSceneOptions,
): SceneRouting {
  const { catalog } = options;
  const nodes = new Map<string, SceneNodeLayout>();
  for (const node of layout.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
  const frames = layout.nodes.map((node) => node.frame);

  const drafts: Draft[] = [];
  const unresolved: UnresolvedConnector[] = [];

  for (const [index, connector] of connectors.entries()) {
    const from = layout.endpoints[connector.from];
    const to = layout.endpoints[connector.to];
    if (from === undefined || to === undefined) {
      unresolved.push({
        index,
        id: connector.id ?? null,
        from: connector.from,
        to: connector.to,
        missing: [
          ...(from === undefined ? [connector.from] : []),
          ...(to === undefined ? [connector.to] : []),
        ],
      });
      continue;
    }

    const fromCandidates = directionCandidates(
      from,
      to,
      declaredSideOf(connector.from, nodes, catalog),
      frameOf(connector.from, nodes),
    );
    const toCandidates = directionCandidates(
      to,
      from,
      declaredSideOf(connector.to, nodes, catalog),
      frameOf(connector.to, nodes),
    );

    // A node port has exactly one candidate, so this is a single pass for it. A frameless gate has
    // two, and takes the first pair that does not make the line leave or land against itself.
    let chosen: { exit: OrthoDirection; normal: OrthoDirection; shape: RouteShape } | undefined;
    let settled = false;
    for (const exit of fromCandidates) {
      for (const normal of toCandidates) {
        const enter = arrivalDirection(normal);
        const shape = routeShapeOf(exit, enter, from, to);
        chosen ??= { exit, normal, shape };
        if (shapeIsFeasible(shape, exit, enter, from, to)) {
          chosen = { exit, normal, shape };
          settled = true;
          break;
        }
      }
      if (settled) break;
    }
    if (chosen === undefined) continue;

    drafts.push({
      connector,
      index,
      identity: connector.id ?? `${connector.from}->${connector.to}`,
      shape: chosen.shape,
      fromDirection: chosen.exit,
      toDirection: chosen.normal,
      points: shapePoints(chosen.shape, chosen.exit, from, to),
      nudge: 0,
    });
  }

  nudgeParallelRuns(drafts);

  const radius = CONNECTOR_CORNER_UNITS * ISO_UNIT;
  const routes: RoutedConnector[] = drafts.map((draft) => {
    const points = dedupe(draft.points.map(roundPoint));
    const first = points[0];
    const second = points[1];
    const lastButOne = points[points.length - 2];
    const last = points[points.length - 1];
    const leaves = first === undefined || second === undefined ? null : travelOf(first, second);
    const lands =
      lastButOne === undefined || last === undefined ? null : travelOf(lastButOne, last);
    return {
      index: draft.index,
      id: draft.connector.id ?? null,
      identity: draft.identity,
      from: draft.connector.from,
      to: draft.connector.to,
      kind: draft.connector.kind,
      shape: draft.shape,
      fromDirection: draft.fromDirection,
      toDirection: draft.toDirection,
      points,
      corners: Math.max(0, points.length - 2),
      d: connectorPathData(points, radius),
      nudge: roundScene(draft.nudge),
      doublesBack: leaves !== draft.fromDirection || lands !== arrivalDirection(draft.toDirection),
      label:
        draft.connector.label === undefined
          ? null
          : placeLabel(draft.connector.label, points, frames),
    };
  });

  return { routes, unresolved };
}
