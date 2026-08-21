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
//
// WP 1.3 MOVED THE TRACK ITSELF into `primitives/IsoTrack.tsx`, and this file was refactored onto
// it. `suite` is "a rack of run tracks", so the lane, its proportions and its direction marks are a
// shape TWO entities draw, and D-IL12 is explicit that such a shape goes in `primitives/` rather
// than being copied. Nothing about the drawing changed: the proportions are the same numbers, the
// weight rule is the same rule, and the rendered markup is byte-identical to what this file emitted
// before the extraction.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { TRACK_LANE, IsoTrack, TrackMarks, trackLaneBox } from "../primitives/IsoTrack.js";
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

/** How far a repeated run's two lanes sit either side of the centre line, in fractions. */
const LANE_SPREAD = 0.21;

function laneBox(footprint: number, cy: number): IsoBox {
  return trackLaneBox(footprint, { cy, z0: FLOOR });
}

export function runHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * TRACK_LANE.height;
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
        <IsoTrack
          key={`lane-${cy}`}
          box={laneBox(footprint, cy)}
          weight={lane === 0 ? "ink" : "detail"}
        />
      ))}
      {centres.map((cy, lane) => (
        <TrackMarks
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
