// ==================================================================================================
// Suite — a rack of run tracks (tier 2, entity `suites`)
// ==================================================================================================
// A saved mass-run: the test x environment x repetition matrix the app executes as one thing.
// Research 5 calls it a "rack of run tracks", and the drawing takes that literally — three of
// `run`'s own lanes, held between two end rails.
//
// IT REUSES `run`'s TRACK, and that is the point rather than a convenience. WP 1.3 asked the
// question outright: if the track shape is not extractable, drawing a second, subtly different one
// is forbidden and the gap is a finding. It was extractable, so `primitives/IsoTrack.tsx` now owns
// the lane, its proportions and its direction marks, `Run` was refactored onto it (byte-identically)
// and this entity draws the same lane three times. A suite IS many runs, so a suite that did not
// look like several runs would be lying about the domain.
//
// THE END RAILS ARE THE WHOLE DIFFERENCE from `run`, and they are load-bearing. Without them a
// three-lane suite is a repeated run with one more lane — the same silhouette at a glance, which is
// exactly the sameness WP 1.3 warns about across an eight-entity cast. The rails turn a flat
// stretch into a FRAME: something that holds runs rather than being one.
//
// FACELESS (D-IL17): the direction marks name the `top` face outright, as they do on `run`.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { IsoTrack, TrackMarks, trackLaneBox } from "../primitives/IsoTrack.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `dispatch` and `collect` sit on the SAME edge, at symmetric offsets, and that is deliberate. A
 * suite is not a stage in a pipeline that work passes through — it is the thing that OWNS its runs:
 * it hands members out and takes their results back. Drawing the return path as a separate far edge
 * would suggest the results go on somewhere else, which is not what a suite run does.
 */
export const suiteMeta: IllustrationRegistryEntry = {
  id: "suite",
  title: "Suite",
  entity: "suites",
  tier: 2,
  keywords: ["suite", "mass run", "matrix", "batch", "rack", "parallel", "benchmark"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    dispatch: { title: "Dispatch", side: "right", offset: 1.4 },
    collect: { title: "Collect", side: "right", offset: -1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A suite: three run tracks held between two end rails on a ground pad — the rack the members of a mass run are dispatched from and collected back into.",
};

export type SuiteProps = EntityComponentProps;

/** One tier: a rack sits on the ground, like the runs it holds. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const RAIL_OFFSET = 0.44;
const RAIL_WIDTH = 0.08;
const RAIL_DEPTH = 0.86;
const RAIL_HEIGHT = 0.34;

/** The lanes are `run`'s lane, shortened to fit between the rails and thinned so three fit. */
const LANE_LENGTH = 0.72;
const LANE_DEPTH = 0.16;
const LANE_HEIGHT = 0.1;
const LANE_SPREAD = 0.26;

/** Three lanes, from the far side to the near one — which is also back-to-front paint order. */
const LANE_CENTRES = [-LANE_SPREAD, 0, LANE_SPREAD] as const;

/** The middle lane carries the entity's one accent moment (D-IL6), so the light sits centred. */
const LIT_LANE = 1;

export function suiteHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * RAIL_HEIGHT;
}

export function Suite({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: SuiteProps): ReactElement {
  const footprint = footprintUnits(size);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const lane = (cy: number) =>
    trackLaneBox(footprint, {
      cy: footprint * cy,
      z0: FLOOR,
      length: LANE_LENGTH,
      depth: LANE_DEPTH,
      height: LANE_HEIGHT,
    });

  return (
    <EntityRoot
      meta={suiteMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={suiteHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      {/* The far rail first, the near one last: back-to-front, so the near rail closes the frame
          over the lane ends rather than being swallowed by them. */}
      <Rail footprint={footprint} cx={-RAIL_OFFSET} />
      {LANE_CENTRES.map((cy) => (
        <IsoTrack key={`lane-${cy}`} box={lane(cy)} weight={cy === 0 ? "ink" : "detail"} />
      ))}
      {LANE_CENTRES.map((cy, index) => (
        <TrackMarks
          key={`marks-${cy}`}
          box={lane(cy)}
          chevrons={2}
          accent={index === LIT_LANE ? accent : undefined}
        />
      ))}
      <Rail footprint={footprint} cx={RAIL_OFFSET} />
    </EntityRoot>
  );
}

Suite.illusLayer = "structure" as const;
Suite.entityHeightUnits = suiteHeightUnits;

/**
 * One end rail: an upright wall across the flow, standing taller than the lanes it frames. Plain
 * hardware — a rail carries no mark, because the entity's single accent moment belongs to the lit
 * chevron on the middle lane.
 */
function Rail({ footprint, cx }: { footprint: number; cx: number }): ReactElement {
  return (
    <IsoHousing
      width={footprint * RAIL_WIDTH}
      depth={footprint * RAIL_DEPTH}
      height={footprint * RAIL_HEIGHT}
      cx={footprint * cx}
      z0={FLOOR}
    />
  );
}
