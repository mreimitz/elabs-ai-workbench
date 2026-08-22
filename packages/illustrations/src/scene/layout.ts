// ==================================================================================================
// layoutScene — a spec becomes boxes and port coordinates (WP 2.1, system design §4 "Layout engine")
// ==================================================================================================
// This is pass ONE of the two the design describes: bands stack vertically, a `lane` distributes its
// stations by `seq` at a quantized pitch, a `hub` centres its nodes as one group, a `cycle` rings its
// stations in a travel direction with entry and exit gaps, and an explicit `{x, y}` on a node opts it
// out of all of that. Pass TWO — orthogonal port-to-port routing with label placement — is **WP 2.2**
// and is deliberately not here. What this file owes 2.2 is somewhere to route BETWEEN, which is why
// it emits `endpoints`: every `nodeId.port` and `bandId.entry`/`.exit` a connector can name, already
// resolved to a canvas coordinate.
//
// ── DETERMINISM IS THE ACCEPTANCE CRITERION, NOT A NICETY ──────────────────────────────────────────
// The same spec and the same catalog produce byte-identical output. That is enforced by four rules
// this file keeps, and by `layout.test.ts`, which greps this directory for the ways of breaking them:
//
//   • no DOM measurement — nothing here reads `document`, a `getBoundingClientRect` or a font metric.
//     A node's box comes from `entityViewBox`, which is arithmetic over its footprint and height;
//   • no `Math.random`, no `Date`, no `performance.now`;
//   • no iteration over an unordered collection. Arrays are walked in declaration order, and the one
//     place a `Record` is read — a registry entry's `ports` — its keys are SORTED first, so the
//     emitted order cannot depend on how the entry happened to be built;
//   • every emitted number goes through {@link roundScene}, so float noise in the last places cannot
//     make two runs of the same input disagree byte for byte.
//
// ── IT NEVER THROWS ───────────────────────────────────────────────────────────────────────────────
// A spec that `validateScene` has rejected still lays out — with fallback metrics for a component the
// catalog does not have, and `placement: "unbanded"` for a node with nowhere to go. A preview that
// renders a scene with one wrong id, and shows the error beside it, is worth more than a blank page.
//
// Geometry comes from `iso-math.ts` and `entity-viewbox.ts` — the same unit grid, the same
// projection, the same `entityHeightUnits` every entity is drawn against. There is no second
// geometry in this package and this file does not start one.

import type {
  IllustrationCanvasFormat,
  IllustrationDetailLevel,
  IllustrationFacing,
  IllustrationSceneAnnotation,
  IllustrationSceneBand,
  IllustrationSceneCycleBand,
  IllustrationSceneNode,
  IllustrationSceneSpec,
  IllustrationSize,
  IllustrationState,
} from "@mcp-token-footprint/shared";
import { ILLUSTRATION_NODE_DEFAULTS } from "@mcp-token-footprint/shared";
import { type EntityViewBox, entityViewBox } from "../entities/entity-viewbox.js";
import {
  ISO_UNIT,
  type ScreenPoint,
  footprintUnits,
  portAnchor,
  projectPoint,
} from "../iso-math.js";
import type { SceneCatalog } from "./catalog.js";

// -- The dials -------------------------------------------------------------------------------------
// All of them in GRID UNITS, never pixels, so the whole composition scales with `ISO_UNIT` and a
// station can be swapped for another of the same size without the layout moving (D-IL2).

/** Clear grid units between two stations in a `lane`. */
export const LANE_GAP_UNITS = 4;
/** Clear grid units between two nodes in a `hub` — tighter, because a hub reads as one group. */
export const HUB_GAP_UNITS = 3;
/** Clear grid units between two stations measured along a `cycle` ring. */
export const RING_GAP_UNITS = 3;
/** Vertical grid units between one band's bottom and the next band's top. */
export const BAND_GAP_UNITS = 4;
/** Vertical grid units between a node and the node pinned to it with `attach`. */
export const ATTACH_GAP_UNITS = 2;
/** Grid units of quiet paper around everything before the canvas is fitted to its aspect. */
export const CANVAS_MARGIN_UNITS = 4;
/** The slot an annotation card occupies, in grid units. */
export const ANNOTATION_CARD_UNITS = { width: 22, height: 10 } as const;
/** Clear grid units between two annotation cards. */
export const ANNOTATION_GAP_UNITS = 3;
/** What a node stands at when the catalog has never heard of its component. */
export const FALLBACK_HEIGHT_UNITS = 3;

/** Where a cycle band's flow enters and leaves when the spec does not say (degrees, clockwise). */
export const CYCLE_ENTRY_DEFAULT = { angle: 180, gap: 30 } as const;
export const CYCLE_EXIT_DEFAULT = { angle: 0, gap: 30 } as const;

/**
 * The three canvas formats as ASPECTS, not pixel sizes. A scene picks a shape; how many pixels it is
 * painted at is the renderer's call (WP 2.3) and a viewer's zoom, so fixing a pixel size here would
 * be inventing a number nothing needs. `ultra` is 7:3, the exact triple nearest the 21:9 banner.
 */
export const ILLUSTRATION_CANVAS_ASPECT: Record<IllustrationCanvasFormat, number> = {
  hero_wide: 16 / 9,
  ultra: 7 / 3,
  square: 1,
};

const DEG = Math.PI / 180;

// -- Output shapes ---------------------------------------------------------------------------------

export type ScenePoint = { readonly x: number; readonly y: number };
export type SceneRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** How a node got its place. `unbanded` means the spec gave it none — see the header. */
export const SCENE_PLACEMENTS = ["row", "ring", "attached", "explicit", "unbanded"] as const;
export type ScenePlacement = (typeof SCENE_PLACEMENTS)[number];

export type SceneNodeLayout = {
  readonly id: string;
  readonly component: string;
  readonly band: string | null;
  readonly placement: ScenePlacement;
  readonly size: IllustrationSize;
  readonly state: IllustrationState;
  readonly detail: IllustrationDetailLevel;
  readonly facing: IllustrationFacing;
  readonly variant: string | null;
  readonly heightUnits: number;
  /** Where the entity's own `<g>` origin — its ground point at the world origin — lands. */
  readonly origin: ScenePoint;
  /** The entity's whole drawing, shadow and caption included, in canvas coordinates. */
  readonly frame: SceneRect;
  /** Every declared port, in canvas coordinates, keys in sorted order (see the header). */
  readonly ports: Readonly<Record<string, ScenePoint>>;
};

export type SceneRingLayout = {
  readonly centre: ScenePoint;
  readonly radius: number;
  readonly direction: "cw" | "ccw";
  readonly counter: string | null;
  readonly entry: ScenePoint;
  readonly exit: ScenePoint;
  /** The angle each station slot sits at, in degrees clockwise from screen-east. */
  readonly stationAngles: readonly number[];
};

export type SceneBandLayout = {
  readonly id: string;
  readonly kind: IllustrationSceneBand["kind"];
  readonly title: string | null;
  /** The band's row on the canvas, tall enough for everything it distributes. */
  readonly frame: SceneRect;
  /** The y its stations stand on — a station's origin, not the top of its box. */
  readonly baseline: number;
  readonly nodeIds: readonly string[];
  readonly ring?: SceneRingLayout;
};

export type SceneAnnotationLayout = {
  /** Its index in `spec.annotations`, which is its identity — annotations carry no id. */
  readonly index: number;
  readonly kind: IllustrationSceneAnnotation["kind"];
  readonly band: string | null;
  readonly align: "start" | "center" | "end";
  readonly frame: SceneRect;
};

export type SceneCanvasLayout = {
  readonly format: IllustrationCanvasFormat;
  readonly stage: IllustrationSceneSpec["canvas"]["stage"];
  readonly aspect: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The four numbers as an SVG `viewBox` attribute. */
  readonly viewBox: string;
};

export type SceneLayout = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly canvas: SceneCanvasLayout;
  readonly bands: readonly SceneBandLayout[];
  readonly nodes: readonly SceneNodeLayout[];
  readonly annotations: readonly SceneAnnotationLayout[];
  /**
   * Every endpoint a connector may name — `nodeId.port` for a node, `bandId.entry`/`.exit` for a
   * cycle band — already resolved to a canvas point. This is WP 2.2's entire input from this file:
   * the router looks up two keys and draws between them, and never has to know what a band is.
   */
  readonly endpoints: Readonly<Record<string, ScenePoint>>;
};

// -- Numbers ---------------------------------------------------------------------------------------

/**
 * Round to `dp` decimals, normalizing `-0` to `0`. Same discipline as `iso-math`'s `fmt`, which
 * returns a string for an attribute; this returns a number, because a layout is compared as JSON.
 */
export function roundScene(value: number, dp = 3): number {
  const rounded = Number(value.toFixed(dp));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundPoint(point: ScenePoint): ScenePoint {
  return { x: roundScene(point.x), y: roundScene(point.y) };
}

function roundRect(rect: SceneRect): SceneRect {
  return {
    x: roundScene(rect.x),
    y: roundScene(rect.y),
    width: roundScene(rect.width),
    height: roundScene(rect.height),
  };
}

// -- Rows ------------------------------------------------------------------------------------------

/**
 * The centre of each slot in a row of `count` slots, in grid units, centred on x = 0.
 *
 * The PITCH is a whole number of grid units by construction — the slot is the widest member rounded
 * UP to a unit, the gap is an integer constant — which is the quantization the design asks for: swap
 * a station for another of the same size and nothing in the row moves. An even-count row lands on a
 * half-unit overall, which is centring, not a quantization failure.
 */
export function rowCentres(count: number, slotUnits: number, gapUnits: number): number[] {
  if (count <= 0) return [];
  const pitch = slotUnits + gapUnits;
  const total = count * slotUnits + (count - 1) * gapUnits;
  const start = -total / 2 + slotUnits / 2;
  return Array.from({ length: count }, (_, index) => start + index * pitch);
}

// -- Rings -----------------------------------------------------------------------------------------

/** How far `to` is from `from` travelling in `sign`'s direction, in degrees, always in [0, 360). */
function travel(fromDeg: number, toDeg: number, sign: 1 | -1): number {
  return (((sign * (toDeg - fromDeg)) % 360) + 360) % 360;
}

function ringPoint(centre: ScenePoint, radius: number, angleDeg: number): ScenePoint {
  return {
    x: centre.x + radius * Math.cos(angleDeg * DEG),
    y: centre.y + radius * Math.sin(angleDeg * DEG),
  };
}

/**
 * Where each station sits on the ring, in degrees clockwise from screen-east (SVG's y points down,
 * so a growing angle IS clockwise).
 *
 * Stations are spread over the arc that remains once the entry and exit gaps are removed, walked in
 * the band's travel direction from just past the entry gap. A station that would land in the exit gap
 * is pushed past it — so the two crossings stay clear of the drawing, which is what the gaps are for.
 * Positions are `(k + 1) / (count + 1)` of the available arc, keeping the first and last stations off
 * the gap edges rather than jammed against them.
 */
export function ringStationAngles(
  count: number,
  direction: "cw" | "ccw",
  entry: { angle: number; gap: number },
  exit: { angle: number; gap: number },
): number[] {
  if (count <= 0) return [];
  const sign: 1 | -1 = direction === "cw" ? 1 : -1;
  // Degenerate gaps (an author asking for more clearance than a circle has) fall back to none, which
  // still draws a readable ring rather than collapsing every station onto one angle.
  const usable = 360 - entry.gap - exit.gap;
  const entryGap = usable > 0 ? entry.gap : 0;
  const exitGap = usable > 0 ? exit.gap : 0;
  const available = usable > 0 ? usable : 360;

  const start = entry.angle + sign * (entryGap / 2);
  const exitGapStart = travel(start, exit.angle - sign * (exitGap / 2), sign);

  return Array.from({ length: count }, (_, index) => {
    const distance = (available * (index + 1)) / (count + 1);
    const shifted = distance >= exitGapStart ? distance + exitGap : distance;
    return (((start + sign * shifted) % 360) + 360) % 360;
  });
}

// -- Node metrics ----------------------------------------------------------------------------------

type NodeMetrics = {
  readonly size: IllustrationSize;
  readonly heightUnits: number;
  readonly frame: EntityViewBox;
  readonly ports: Readonly<Record<string, ScreenPoint>>;
};

function resolveSize(node: IllustrationSceneNode, catalog: SceneCatalog): IllustrationSize {
  const entry = catalog.entry(node.component);
  if (node.size !== undefined) return node.size;
  if (entry === undefined) return "m";
  return entry.sizes.includes("m") ? "m" : (entry.sizes[0] ?? "m");
}

function measure(node: IllustrationSceneNode, catalog: SceneCatalog): NodeMetrics {
  const size = resolveSize(node, catalog);
  const heightUnits = catalog.heightUnits(node.component, size) ?? FALLBACK_HEIGHT_UNITS;
  const frame = entityViewBox(size, heightUnits);
  const entry = catalog.entry(node.component);
  const ports: Record<string, ScreenPoint> = {};
  if (entry !== undefined) {
    // SORTED, not insertion order — see the determinism note in the header.
    for (const name of Object.keys(entry.ports).sort()) {
      const port = entry.ports[name];
      if (port === undefined) continue;
      ports[name] = projectPoint(portAnchor(port, footprintUnits(size), heightUnits));
    }
  }
  return { size, heightUnits, frame, ports };
}

/** How far a node's drawing reaches above and below the point it stands on. */
function reach(metrics: NodeMetrics): { above: number; below: number } {
  return { above: -metrics.frame.y, below: metrics.frame.y + metrics.frame.height };
}

function slotUnitsFor(members: readonly NodeMetrics[]): number {
  const widest = members.reduce((max, member) => Math.max(max, member.frame.width), 0);
  return Math.max(1, Math.ceil(widest / ISO_UNIT));
}

// -- Bounding box ----------------------------------------------------------------------------------

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function grow(bounds: Bounds, rect: SceneRect): void {
  bounds.minX = Math.min(bounds.minX, rect.x);
  bounds.minY = Math.min(bounds.minY, rect.y);
  bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width);
  bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height);
}

/** Grow `bounds` to `aspect` about its own centre, so the fit never crops what it was given. */
function fitToAspect(bounds: Bounds, aspect: number): SceneRect {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const centreX = bounds.minX + width / 2;
  const centreY = bounds.minY + height / 2;
  const fitted =
    width / height < aspect
      ? { width: height * aspect, height }
      : { width, height: width / aspect };
  return {
    x: centreX - fitted.width / 2,
    y: centreY - fitted.height / 2,
    width: fitted.width,
    height: fitted.height,
  };
}

// -- The engine ------------------------------------------------------------------------------------

export type LayoutSceneOptions = {
  readonly catalog: SceneCatalog;
};

type Placed = {
  readonly node: IllustrationSceneNode;
  readonly metrics: NodeMetrics;
  origin: ScenePoint | null;
  placement: ScenePlacement;
};

/**
 * Resolve a spec to node boxes, port coordinates, band rows and a canvas — deterministically, with
 * no DOM and no throw. See the header for what pass two (WP 2.2) picks up from here.
 */
export function layoutScene(spec: IllustrationSceneSpec, options: LayoutSceneOptions): SceneLayout {
  const { catalog } = options;

  const placed: Placed[] = spec.nodes.map((node) => ({
    node,
    metrics: measure(node, catalog),
    origin: null,
    placement: "unbanded",
  }));
  const byId = new Map<string, Placed>();
  for (const item of placed) if (!byId.has(item.node.id)) byId.set(item.node.id, item);

  const bandIds = new Set(spec.bands.map((band) => band.id));
  /** Declaration order, precomputed, so the `seq` tie-break is a lookup rather than a linear scan. */
  const declarationOrder = new Map(placed.map((item, index) => [item, index] as const));
  const isSequenced = (item: Placed): boolean =>
    item.node.at === undefined && item.node.attach === undefined;

  // ── Bands: heights first (they are horizontal-independent), then baselines, then member origins.
  const bands: SceneBandLayout[] = [];
  let cursorY = 0;

  // Annotations are grouped by the band they name; the empty key holds the ones that name none,
  // which get their own trailing row rather than being silently dropped.
  type AnnotationDraft = {
    readonly annotation: IllustrationSceneAnnotation;
    readonly index: number;
  };
  const UNBANDED_ANNOTATIONS = "";
  const annotationsByBand = new Map<string, AnnotationDraft[]>();
  for (const [index, annotation] of (spec.annotations ?? []).entries()) {
    const key = annotation.band ?? UNBANDED_ANNOTATIONS;
    const list = annotationsByBand.get(key);
    if (list === undefined) annotationsByBand.set(key, [{ annotation, index }]);
    else list.push({ annotation, index });
  }
  /** Band id -> the y a card row starts at, filled during the height pass, used by the width pass. */
  const annotationRowY = new Map<string, number>();

  const layOutRow = (members: Placed[], baseline: number, gapUnits: number): void => {
    const centres = rowCentres(
      members.length,
      slotUnitsFor(members.map((member) => member.metrics)),
      gapUnits,
    );
    for (const [index, member] of members.entries()) {
      member.origin = { x: (centres[index] ?? 0) * ISO_UNIT, y: baseline };
      member.placement = "row";
    }
  };

  for (const band of spec.bands) {
    const members = placed.filter((item) => item.node.band === band.id && isSequenced(item));
    if (band.kind === "lane" || band.kind === "cycle") {
      // A total comparator: `seq` first, declaration order as the tie-break, so two stations sharing
      // a `seq` still land in a fixed order rather than one decided by the sort implementation.
      members.sort((left, right) => {
        const leftSeq = left.node.seq ?? Number.POSITIVE_INFINITY;
        const rightSeq = right.node.seq ?? Number.POSITIVE_INFINITY;
        if (leftSeq !== rightSeq) return leftSeq - rightSeq;
        return (declarationOrder.get(left) ?? 0) - (declarationOrder.get(right) ?? 0);
      });
    }

    const cards = annotationsByBand.get(band.id) ?? [];
    const cardsHeight =
      cards.length === 0 ? 0 : (ANNOTATION_CARD_UNITS.height + BAND_GAP_UNITS) * ISO_UNIT;

    if (band.kind === "cycle") {
      const ring = layOutRing(band, members, cursorY);
      bands.push({
        id: band.id,
        kind: band.kind,
        title: band.title ?? null,
        frame: roundRect({
          x: ring.centre.x - ring.radius - ring.halfWidth,
          y: cursorY,
          width: 2 * (ring.radius + ring.halfWidth),
          height: ring.height + cardsHeight,
        }),
        baseline: roundScene(ring.centre.y),
        nodeIds: members.map((member) => member.node.id),
        ring: {
          centre: roundPoint(ring.centre),
          radius: roundScene(ring.radius),
          direction: band.direction,
          counter: band.counter ?? null,
          entry: roundPoint(ring.entry),
          exit: roundPoint(ring.exit),
          stationAngles: ring.angles.map((angle) => roundScene(angle)),
        },
      });
      if (cards.length > 0) annotationRowY.set(band.id, cursorY + ring.height);
      cursorY += ring.height + cardsHeight + BAND_GAP_UNITS * ISO_UNIT;
      continue;
    }

    const reaches = members.map((member) => reach(member.metrics));
    const above = reaches.reduce((max, item) => Math.max(max, item.above), 0);
    const below = reaches.reduce((max, item) => Math.max(max, item.below), 0);
    const baseline = cursorY + above;
    layOutRow(members, baseline, band.kind === "lane" ? LANE_GAP_UNITS : HUB_GAP_UNITS);

    const width = members.reduce((sum, member) => Math.max(sum, member.metrics.frame.width), 0);
    const span =
      members.length === 0
        ? width
        : (slotUnitsFor(members.map((member) => member.metrics)) * members.length +
            (band.kind === "lane" ? LANE_GAP_UNITS : HUB_GAP_UNITS) * (members.length - 1)) *
          ISO_UNIT;

    bands.push({
      id: band.id,
      kind: band.kind,
      title: band.title ?? null,
      frame: roundRect({
        x: -span / 2,
        y: cursorY,
        width: span,
        height: above + below + cardsHeight,
      }),
      baseline: roundScene(baseline),
      nodeIds: members.map((member) => member.node.id),
    });
    if (cards.length > 0) annotationRowY.set(band.id, cursorY + above + below);
    cursorY += above + below + cardsHeight + BAND_GAP_UNITS * ISO_UNIT;
  }

  // ── Nodes the bands did not claim: an explicit `at`, a trailing row for the truly unbanded.
  for (const item of placed) {
    if (item.node.at === undefined) continue;
    item.origin = { x: item.node.at.x * ISO_UNIT, y: item.node.at.y * ISO_UNIT };
    item.placement = "explicit";
  }

  const unbanded = placed.filter(
    (item) => item.origin === null && isSequenced(item) && !bandIds.has(item.node.band ?? ""),
  );
  if (unbanded.length > 0) {
    const reaches = unbanded.map((member) => reach(member.metrics));
    const above = reaches.reduce((max, item) => Math.max(max, item.above), 0);
    const below = reaches.reduce((max, item) => Math.max(max, item.below), 0);
    layOutRow(unbanded, cursorY + above, HUB_GAP_UNITS);
    for (const item of unbanded) item.placement = "unbanded";
    cursorY += above + below + BAND_GAP_UNITS * ISO_UNIT;
  }

  // An annotation that names no band still gets a row, at the foot of the drawing.
  const looseCards = annotationsByBand.get(UNBANDED_ANNOTATIONS);
  if (looseCards !== undefined && looseCards.length > 0) {
    annotationRowY.set(UNBANDED_ANNOTATIONS, cursorY);
    cursorY += (ANNOTATION_CARD_UNITS.height + BAND_GAP_UNITS * 2) * ISO_UNIT;
  }

  // ── Pinned nodes, resolved iteratively so a chain resolves and a circle simply stops.
  const stackBottom = new Map<string, number>();
  for (let pass = 0; pass < placed.length; pass += 1) {
    let progressed = false;
    for (const item of placed) {
      if (item.origin !== null || item.node.attach === undefined) continue;
      const anchor = byId.get(item.node.attach);
      if (anchor === undefined || anchor.origin === null) continue;
      const anchorBottom =
        stackBottom.get(item.node.attach) ??
        anchor.origin.y + anchor.metrics.frame.y + anchor.metrics.frame.height;
      const top = anchorBottom + ATTACH_GAP_UNITS * ISO_UNIT;
      item.origin = { x: anchor.origin.x, y: top - item.metrics.frame.y };
      item.placement = "attached";
      stackBottom.set(item.node.attach, top + item.metrics.frame.height);
      progressed = true;
    }
    if (!progressed) break;
  }

  // ── Emit nodes.
  const endpoints: Record<string, ScenePoint> = {};
  const nodes: SceneNodeLayout[] = placed.map((item) => {
    const origin = item.origin ?? { x: 0, y: cursorY };
    const ports: Record<string, ScenePoint> = {};
    for (const [name, offset] of Object.entries(item.metrics.ports)) {
      const point = roundPoint({ x: origin.x + offset.x, y: origin.y + offset.y });
      ports[name] = point;
      endpoints[`${item.node.id}.${name}`] = point;
    }
    return {
      id: item.node.id,
      component: item.node.component,
      band: item.node.band ?? null,
      placement: item.placement,
      size: item.metrics.size,
      state: item.node.state ?? ILLUSTRATION_NODE_DEFAULTS.state,
      detail: item.node.detail ?? ILLUSTRATION_NODE_DEFAULTS.detail,
      facing: item.node.facing ?? ILLUSTRATION_NODE_DEFAULTS.facing,
      variant: item.node.variant ?? null,
      heightUnits: item.metrics.heightUnits,
      origin: roundPoint(origin),
      frame: roundRect({
        x: origin.x + item.metrics.frame.x,
        y: origin.y + item.metrics.frame.y,
        width: item.metrics.frame.width,
        height: item.metrics.frame.height,
      }),
      ports,
    };
  });

  for (const band of bands) {
    if (band.ring === undefined) continue;
    endpoints[`${band.id}.entry`] = band.ring.entry;
    endpoints[`${band.id}.exit`] = band.ring.exit;
  }

  // ── The width pass: annotation cards need to know how wide the drawing turned out to be, which is
  // only knowable once every node has a box. Heights were settled above, so nothing moves vertically.
  const contentHalfWidth = Math.max(
    nodes.reduce(
      (max, node) =>
        Math.max(max, Math.abs(node.frame.x), Math.abs(node.frame.x + node.frame.width)),
      0,
    ),
    (ANNOTATION_CARD_UNITS.width / 2) * ISO_UNIT,
  );
  const annotations: SceneAnnotationLayout[] = [];
  for (const [bandId, cards] of annotationsByBand) {
    const rowY = annotationRowY.get(bandId);
    if (rowY === undefined) continue;
    const cardWidth = ANNOTATION_CARD_UNITS.width * ISO_UNIT;
    const cardHeight = ANNOTATION_CARD_UNITS.height * ISO_UNIT;
    const gap = ANNOTATION_GAP_UNITS * ISO_UNIT;
    const groups: Record<"start" | "center" | "end", AnnotationDraft[]> = {
      start: [],
      center: [],
      end: [],
    };
    for (const card of cards) groups[card.annotation.align ?? "start"].push(card);
    for (const align of ["start", "center", "end"] as const) {
      const group = groups[align];
      const run = group.length * cardWidth + Math.max(0, group.length - 1) * gap;
      const left =
        align === "start" ? -contentHalfWidth : align === "end" ? contentHalfWidth - run : -run / 2;
      for (const [position, card] of group.entries()) {
        annotations.push({
          index: card.index,
          kind: card.annotation.kind,
          band: card.annotation.band ?? null,
          align,
          frame: roundRect({
            x: left + position * (cardWidth + gap),
            y: rowY + BAND_GAP_UNITS * ISO_UNIT,
            width: cardWidth,
            height: cardHeight,
          }),
        });
      }
    }
  }
  annotations.sort((left, right) => left.index - right.index);

  // A band's frame is settled before the width pass, because heights are horizontal-independent — so
  // grow it now to cover the cards it holds. Without this an `annotations` band, which has no nodes
  // at all, reports a zero-width frame while visibly holding two cards.
  const framedBands: SceneBandLayout[] = bands.map((band) => {
    const cards = annotations.filter((card) => card.band === band.id);
    if (cards.length === 0) return band;
    const left = cards.reduce((min, card) => Math.min(min, card.frame.x), band.frame.x);
    const right = cards.reduce(
      (max, card) => Math.max(max, card.frame.x + card.frame.width),
      band.frame.x + band.frame.width,
    );
    return { ...band, frame: roundRect({ ...band.frame, x: left, width: right - left }) };
  });

  // ── The canvas: everything, plus a margin, grown to the format's aspect.
  const bounds = emptyBounds();
  for (const node of nodes) grow(bounds, node.frame);
  for (const band of framedBands) grow(bounds, band.frame);
  for (const annotation of annotations) grow(bounds, annotation.frame);
  if (!Number.isFinite(bounds.minX)) {
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = ISO_UNIT;
    bounds.maxY = ISO_UNIT;
  }
  const margin = CANVAS_MARGIN_UNITS * ISO_UNIT;
  bounds.minX -= margin;
  bounds.minY -= margin;
  bounds.maxX += margin;
  bounds.maxY += margin;
  const aspect = ILLUSTRATION_CANVAS_ASPECT[spec.canvas.format];
  const fitted = fitToAspect(bounds, aspect);
  const canvasRect = roundRect(fitted);

  return {
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    canvas: {
      format: spec.canvas.format,
      stage: spec.canvas.stage,
      aspect: roundScene(aspect, 6),
      x: canvasRect.x,
      y: canvasRect.y,
      width: canvasRect.width,
      height: canvasRect.height,
      viewBox: `${canvasRect.x} ${canvasRect.y} ${canvasRect.width} ${canvasRect.height}`,
    },
    bands: framedBands,
    nodes,
    annotations,
    endpoints,
  };
}

// -- The ring, in one place ------------------------------------------------------------------------

type RingGeometry = {
  readonly centre: ScenePoint;
  readonly radius: number;
  readonly halfWidth: number;
  readonly height: number;
  readonly entry: ScenePoint;
  readonly exit: ScenePoint;
  readonly angles: readonly number[];
};

function layOutRing(
  band: IllustrationSceneCycleBand,
  members: Placed[],
  top: number,
): RingGeometry {
  const metrics = members.map((member) => member.metrics);
  // A ring is drawn for the slots the band DECLARES, even if fewer nodes reference it — a cycle band
  // is a shape the author asked for, and shrinking it silently would hide the mismatch the validator
  // reports as `cycle-station-count`.
  const count = Math.max(band.stations, members.length);
  const slotUnits = slotUnitsFor(metrics);
  // Enough circumference for every slot plus its gap; never smaller than one slot, so a two-station
  // ring is still a ring rather than two overlapping boxes.
  const radiusUnits = Math.max(
    slotUnits,
    Math.ceil((count * (slotUnits + RING_GAP_UNITS)) / (2 * Math.PI)),
  );
  const radius = radiusUnits * ISO_UNIT;

  const reaches = metrics.map(reach);
  const above = reaches.reduce((max, item) => Math.max(max, item.above), 0);
  const below = reaches.reduce((max, item) => Math.max(max, item.below), 0);
  const halfWidth = metrics.reduce((max, item) => Math.max(max, item.frame.width / 2), 0);
  const centre: ScenePoint = { x: 0, y: top + radius + above };
  const height = 2 * radius + above + below;

  const entry = {
    angle: band.entry?.angle ?? CYCLE_ENTRY_DEFAULT.angle,
    gap: band.entry?.gap ?? CYCLE_ENTRY_DEFAULT.gap,
  };
  const exit = {
    angle: band.exit?.angle ?? CYCLE_EXIT_DEFAULT.angle,
    gap: band.exit?.gap ?? CYCLE_EXIT_DEFAULT.gap,
  };
  const angles = ringStationAngles(count, band.direction, entry, exit);

  for (const [index, member] of members.entries()) {
    const angle = angles[index] ?? 0;
    member.origin = ringPoint(centre, radius, angle);
    member.placement = "ring";
  }

  return {
    centre,
    radius,
    halfWidth,
    height,
    entry: ringPoint(centre, radius, entry.angle),
    exit: ringPoint(centre, radius, exit.angle),
    angles,
  };
}
