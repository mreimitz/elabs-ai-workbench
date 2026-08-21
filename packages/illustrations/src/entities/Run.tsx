// ==================================================================================================
// Run — a length of track (tier 1, entity `runs`)
// ==================================================================================================
// One session of work, from prompt to terminal state. Research 5 calls it a "conveyor/track
// segment", and the metaphor earns its place: a run is the only tier-1 entity that is a STRETCH
// rather than a thing standing still, and drawing it flat on the ground with direction marks is what
// makes a scene read left-to-right without a caption saying so.
//
// It is the flattest component in the catalog on purpose. `agent` stands 5.35 units tall at `m`;
// this stands under 1.5. That contrast is the drawing doing its job — a run is what MOVES between
// the stations, not another station — and it is why the entity keeps a one-tier plinth rather than
// the two-tier one every upright entity uses: a track sits on the ground, and a track on a monument
// is a track nobody would walk on.
//
// FACELESS (D-IL17): the direction marks name the `top` face outright, so asking a run to face
// downstream leaves it exactly where it is. Which way the work flows is the CONNECTORS' job, and a
// track that silently re-pointed itself would contradict them.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `enter` and `exit` are the only two ports a scene should normally attach to — work goes on at one
 * end and comes off at the other — and they sit at a 1.4-unit offset so the gallery's port overlay
 * does not stack them on the plain `left`/`right` cardinals.
 */
export const runMeta: IllustrationRegistryEntry = {
  id: "run",
  title: "Run",
  entity: "runs",
  tier: 1,
  keywords: ["run", "session", "track", "conveyor", "execution", "trajectory", "repetition"],
  variants: ["single", "repeated"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    enter: { title: "Enter", side: "left", offset: -1.4 },
    exit: { title: "Exit", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A run: a length of track on a ground pad, its top face carrying direction marks — one lane for a single session, two for a repeated one.",
};

export const RUN_VARIANTS = ["single", "repeated"] as const;
export type RunVariant = (typeof RUN_VARIANTS)[number];

export type RunProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): RunVariant {
  return RUN_VARIANTS.includes(variant as RunVariant) ? (variant as RunVariant) : "single";
}

/** One tier: a ground pad, not a plinth. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const LANE_LENGTH = 0.84;
const LANE_DEPTH = 0.3;
const LANE_HEIGHT = 0.13;
/** How far a repeated run's two lanes sit either side of the centre line, in fractions. */
const LANE_SPREAD = 0.21;

function laneBox(footprint: number, cy: number): IsoBox {
  return {
    cx: 0,
    cy,
    w: footprint * LANE_LENGTH,
    d: footprint * LANE_DEPTH,
    z0: FLOOR,
    h: footprint * LANE_HEIGHT,
  };
}

export function runHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * LANE_HEIGHT;
}

export function Run({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: RunProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  // A repeated run is two lanes, not a taller one: repetition happens SIDEWAYS, so the declared
  // height (and therefore every port anchor, D-IL7) is identical for both variants.
  const centres =
    resolved === "repeated" ? [-footprint * LANE_SPREAD, footprint * LANE_SPREAD] : [0];

  return (
    <EntityRoot
      meta={runMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={runHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      {centres.map((cy, lane) => (
        <IsoHousing
          key={`lane-${cy}`}
          width={footprint * LANE_LENGTH}
          depth={footprint * LANE_DEPTH}
          height={footprint * LANE_HEIGHT}
          cy={cy}
          z0={FLOOR}
          weight={lane === 0 ? "ink" : "detail"}
        />
      ))}
      {centres.map((cy, lane) => (
        <DirectionMarks
          key={`marks-${cy}`}
          box={laneBox(footprint, cy)}
          // Exactly one lit chevron in the whole entity, on the leading lane (D-IL6). A repeated run
          // drawing two lit chevrons would spend two accent moments on one station.
          accent={lane === 0 ? accent : undefined}
        />
      ))}
    </EntityRoot>
  );
}

Run.illusLayer = "structure" as const;
Run.entityHeightUnits = runHeightUnits;

/**
 * Three chevrons along the lane's TOP face, pointing the way the work travels, plus the two sleeper
 * rules that make it read as track rather than as a plank. The leading chevron is the entity's
 * accent moment when `accent` is given; without it every mark is ink-muted hardware.
 *
 * A chevron is a `<polygon>` — a shape element, not a `<path>` — because WP 0.3's contract test
 * forbids an entity authoring a path of its own, and a chevron does not need one.
 */
function DirectionMarks({ box, accent }: { box: IsoBox; accent?: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.16;
  const chevrons = [0, 1, 2];
  const chevronWidth = (width - inset * 2) / (chevrons.length + 1.2);
  const chevronHeight = (height - inset * 2) * 0.52;
  const top = inset + (height - inset * 2 - chevronHeight) / 2;
  const step = (width - inset * 2 - chevronWidth) / (chevrons.length - 1);
  const thickness = Math.max(1.6, chevronHeight * 0.34);

  return (
    <GlyphFrame face="top" box={box}>
      {(["near", "far"] as const).map((rule) => (
        <line
          key={`sleeper-${rule}`}
          x1={fmt(inset)}
          y1={fmt(rule === "near" ? inset * 0.7 : height - inset * 0.7)}
          x2={fmt(width - inset)}
          y2={fmt(rule === "near" ? inset * 0.7 : height - inset * 0.7)}
          strokeWidth={ILLUS_STROKE_DETAIL_FINE}
          style={{ stroke: "var(--illus-ink-muted)" }}
        />
      ))}
      {chevrons.map((chevron) => {
        const x = inset + chevron * step;
        return (
          <polygon
            key={`chevron-${chevron}`}
            data-illus-mark="direction"
            points={[
              [x, top],
              [x + chevronWidth, top + chevronHeight / 2],
              [x, top + chevronHeight],
              [x + thickness, top + chevronHeight / 2],
            ]
              .map(([px, py]) => `${fmt(px as number)},${fmt(py as number)}`)
              .join(" ")}
            style={{
              fill: accent !== undefined && chevron === 0 ? accent : "var(--illus-ink-muted)",
            }}
          />
        );
      })}
    </GlyphFrame>
  );
}
