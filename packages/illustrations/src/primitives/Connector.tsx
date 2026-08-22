// ==================================================================================================
// Connector — the six kinds, and the only place their strokes are decided (D-IL8)
// ==================================================================================================
// A caller says WHAT a line means. It cannot say what the line looks like: there is no `stroke`, no
// `color`, no `strokeWidth` and no `dash` prop on this component, and `kind` is the closed union
// from `packages/shared`, so a seventh kind is a compile error rather than a silent fallback. That
// is the mechanism behind "a scene spec physically cannot go off-brand" — the grammar is enforced by
// the type system at the one place the grammar is used.
//
// The table below is 01-system-design.md section 2.3, transcribed once:
//
//   flow     process order            ink-muted, solid 2.5   ink arrow
//   read     consumes / loads from    ink,       solid 2     ink arrow
//   write    produces / feeds into    accent,    dashed 2    accent arrow
//   publish  new version / promotion  accent,    solid 2.5   accent arrow
//   loop     cycle / repeat           guide,     dashed 2    ink arrow
//   signal   events / particles       accent-2,  dotted 1.5  none (particles)
//
// This WP DRAWS a connector between two given points. It does not ROUTE one — port resolution and
// orthogonal routing are WP 2.2's, and putting a router here would mean writing it twice.

import type { IllustrationConnectorKind } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type ScreenPoint, fmt, polygonPoints, polylinePath } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_TEXT } from "../line-system.js";

export type ArrowHead = "ink" | "accent" | "none";

export type ConnectorStyle = {
  /** The `--illus-*` token the line is stroked with. */
  readonly stroke: string;
  readonly width: number;
  readonly dash: string | undefined;
  readonly arrow: ArrowHead;
  /** Dotted lines paint their dots with a round cap; everything else uses a butt cap. */
  readonly round: boolean;
};

/**
 * `Record<IllustrationConnectorKind, ...>` is doing real work: if `packages/shared` ever grows a
 * seventh kind, THIS table stops compiling until somebody decides what the new kind looks like. A
 * lookup with a `default:` branch would have absorbed it silently.
 *
 * EXPORTED since WP 2.3, and exported rather than copied for one reason: the scene renderer paints a
 * connector from `RoutedConnector.d` — the router's filleted path — instead of from this component,
 * because rebuilding that path as a sharp polyline would throw away the corner radii WP 2.2 measured
 * and clamped. It still has to know what a `write` looks like, and the only honest way for it to know
 * is to read THIS table. A second copy of the six rows is precisely the drift D-IL8 exists to stop —
 * `Connector.test.tsx` already keeps one deliberate hand-transcribed copy as a guard, and a THIRD
 * would turn that guard into noise. `connector-style-single-source.test.ts` fails on a second
 * declaration anywhere in `src/`.
 */
export const CONNECTOR_STYLE: Record<IllustrationConnectorKind, ConnectorStyle> = {
  flow: {
    stroke: "var(--illus-ink-muted)",
    width: 2.5,
    dash: undefined,
    arrow: "ink",
    round: false,
  },
  read: { stroke: "var(--illus-ink)", width: 2, dash: undefined, arrow: "ink", round: false },
  write: {
    stroke: "var(--illus-accent)",
    width: 2,
    dash: ILLUS_DASH.dashed,
    arrow: "accent",
    round: false,
  },
  publish: {
    stroke: "var(--illus-accent)",
    width: 2.5,
    dash: undefined,
    arrow: "accent",
    round: false,
  },
  loop: {
    stroke: "var(--illus-guide)",
    width: 2,
    dash: ILLUS_DASH.dashed,
    arrow: "ink",
    round: false,
  },
  signal: {
    stroke: "var(--illus-accent-2)",
    width: 1.5,
    dash: ILLUS_DASH.dotted,
    arrow: "none",
    round: true,
  },
};

/** The two arrowhead fills. Exported alongside {@link CONNECTOR_STYLE}, for the same reason. */
export const CONNECTOR_ARROW_FILL: Record<Exclude<ArrowHead, "none">, string> = {
  ink: "var(--illus-ink)",
  accent: "var(--illus-accent)",
};

/** Arrowhead geometry, in px. Drawn as a polygon rather than an SVG `marker` on purpose — see below. */
const ARROW_LENGTH = 10;
const ARROW_HALF_WIDTH = 4.2;

/**
 * How far short of the tip a line stops so its stroke does not poke out past the narrowing sides of
 * the arrowhead. Exported because the scene renderer draws the router's path and therefore has to
 * apply the same trim itself; a second, slightly different number would show as a visible spur.
 */
export const CONNECTOR_ARROW_TRIM = ARROW_LENGTH * 0.75;

/**
 * The three points of the head, given its tip and the direction the line arrives from.
 *
 * A `<marker>` would need an id, and an id inside a component is either duplicated (invalid markup
 * when two connectors of the same kind appear) or generated (which breaks "same props, same SVG").
 * A polygon has neither problem, and the arithmetic is four lines.
 */
export function arrowHeadPoints(tip: ScreenPoint, from: ScreenPoint): readonly ScreenPoint[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = tip.x - ux * ARROW_LENGTH;
  const baseY = tip.y - uy * ARROW_LENGTH;
  return [
    tip,
    { x: baseX - uy * ARROW_HALF_WIDTH, y: baseY + ux * ARROW_HALF_WIDTH },
    { x: baseX + uy * ARROW_HALF_WIDTH, y: baseY - ux * ARROW_HALF_WIDTH },
  ];
}

export type ConnectorProps = {
  /** What the line MEANS. The only thing a caller may say about it (D-IL8). */
  kind: IllustrationConnectorKind;
  from: ScreenPoint;
  to: ScreenPoint;
  /** Intermediate points, if the caller has already routed the line. WP 2.2 owns the router. */
  waypoints?: readonly ScreenPoint[];
  /** Screen-aligned, placed at the path's midpoint, knocked out of the line behind it. */
  label?: string;
};

export function Connector({ kind, from, to, waypoints = [], label }: ConnectorProps): ReactElement {
  const style = CONNECTOR_STYLE[kind];
  const points: ScreenPoint[] = [from, ...waypoints, to];
  const penultimate = points[points.length - 2] as ScreenPoint;
  // The line stops short of the tip so the stroke does not poke through the arrowhead's point.
  const head = style.arrow === "none" ? null : arrowHeadPoints(to, penultimate);
  const drawnTo = head ? shortenTowards(to, penultimate, CONNECTOR_ARROW_TRIM) : to;
  const drawn = [...points.slice(0, -1), drawnTo];
  const mid = midpoint(points);

  return (
    <g data-illus-primitive="connector" data-illus-connector={kind}>
      <path
        d={polylinePath(drawn)}
        fill="none"
        strokeWidth={style.width}
        strokeLinejoin="round"
        strokeLinecap={style.round ? "round" : "butt"}
        strokeDasharray={style.dash}
        style={{ stroke: style.stroke }}
      />
      {head && style.arrow !== "none" ? (
        <polygon points={polygonPoints(head)} style={{ fill: CONNECTOR_ARROW_FILL[style.arrow] }} />
      ) : null}
      {label ? (
        <text
          x={fmt(mid.x)}
          y={fmt(mid.y - 7)}
          fontSize={ILLUS_TEXT.caption}
          textAnchor="middle"
          // Painting the stroke first knocks a paper-coloured gap out of the line behind the words,
          // which is how a drafting sheet labels a run without a filled box getting in the way.
          paintOrder="stroke"
          strokeWidth={3.5}
          strokeLinejoin="round"
          style={{ fill: "var(--illus-ink)", stroke: "var(--illus-paper)" }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

Connector.illusLayer = "connectors" as const;

function shortenTowards(point: ScreenPoint, towards: ScreenPoint, by: number): ScreenPoint {
  const dx = point.x - towards.x;
  const dy = point.y - towards.y;
  const length = Math.hypot(dx, dy);
  if (length <= by || length === 0) return point;
  return { x: point.x - (dx / length) * by, y: point.y - (dy / length) * by };
}

/** The midpoint by ARC LENGTH, so a label on an elbowed run sits where the eye expects it. */
function midpoint(points: readonly ScreenPoint[]): ScreenPoint {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as ScreenPoint;
    const b = points[i] as ScreenPoint;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i] as number;
    if (remaining <= length || i === lengths.length - 1) {
      const a = points[i] as ScreenPoint;
      const b = points[i + 1] as ScreenPoint;
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return points[0] as ScreenPoint;
}
