// ==================================================================================================
// entityViewBox — the frame an entity is looked at through
// ==================================================================================================
// An entity renders a `<g>` around the world origin, not an `<svg>` (WP 0.2's one structural
// divergence from the exemplar), because it has to be placeable inside a scene. Somebody still has
// to supply the frame when it is drawn ALONE — the gallery tile, the detail matrix, a future
// single-entity export — and if each of them eyeballed a viewBox they would each crop it slightly
// differently.
//
// So the frame is computed, once, from the two numbers that actually decide it: the footprint and
// the drawn height. Everything else is a margin, and the margins are named for what they hold —
// the ground shadow, the port labels, the screen-aligned caption — rather than being magic numbers.

import type { IllustrationSize } from "@mcp-token-footprint/shared";
import { ISO_KX, ISO_KY, ISO_UNIT, footprintUnits } from "../iso-math.js";

/** Room above the solid for an antenna, a port dot and its label. In px. */
const HEAD_ROOM = 34;

/** Room below the ground for the shadow, the front port labels and the caption. In px. */
const FOOT_ROOM = 56;

/**
 * Room to either side for a port label that hangs off the widest point. In px, and measured rather
 * than guessed: the longest port name in the pilot cast is `version-out`, which sits on the right
 * side at an offset, starts 8 px past its dot and runs about 58 px at the port type size. 34 px
 * clipped it to "version-c"; 52 clears it with room for a slightly longer name.
 */
const SIDE_ROOM = 52;

export type EntityViewBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The four numbers as an SVG `viewBox` attribute. */
  readonly viewBox: string;
};

/**
 * The box that contains an entity of `size` standing `heightUnits` tall, plus its shadow, its port
 * labels and its caption. `extraHeadUnits` is for the parts that stick out ABOVE the solid and are
 * therefore invisible to the footprint/height pair — an antenna, a raised annotation.
 */
export function entityViewBox(
  size: IllustrationSize,
  heightUnits: number,
  extraHeadUnits = 0,
): EntityViewBox {
  const footprint = footprintUnits(size);
  // The widest on-screen point is the footprint's left/right corner, at footprint * KX. The
  // `highlight` spot is the widest thing `EntityRoot` paints and it still lands inside that: its
  // semi-major axis is halfWidth * 1.95 / 2, i.e. 0.975 of the corner. So the corner is the bound.
  const halfWidth = footprint * ISO_KX;
  const top = -(heightUnits + extraHeadUnits) * ISO_UNIT - HEAD_ROOM;
  // The front corner of the footprint, which is where the ground shadow and the caption sit under.
  const bottom = footprint * ISO_KY + FOOT_ROOM;
  const x = -(halfWidth + SIDE_ROOM);
  const width = 2 * (halfWidth + SIDE_ROOM);
  return {
    x,
    y: top,
    width,
    height: bottom - top,
    viewBox: `${x} ${top} ${width} ${bottom - top}`,
  };
}
