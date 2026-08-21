// ==================================================================================================
// Orchestrator — a geared hub feeding several outputs (tier 2, entity `suite_runs`)
// ==================================================================================================
// The honest "automatic execution" entity. The app has NO cron scheduler: what actually runs by
// itself is the suite worker pool fanning members out, and auto-rating firing when a run reaches a
// terminal state. Research 5 picked the metaphor for exactly that reason and WP 1.3 repeats it as a
// constraint — this must not read as a clock or a calendar, because the app cannot do what a clock
// would promise.
//
// SO THE DRAWING IS MACHINERY, NOT TIME. The give-away of a clock is a circle with marks arranged
// around its rim; the give-away of a gear is teeth that stick OUT past the rim, a hub boss, and a
// keyway. This has eight teeth (not twelve), a boss with a keyway notch, and — the part that settles
// it — physical track stubs entering on one flank and leaving on the other. A clock has no queue.
//
// AND IT IS AN ENTITY, NOT A FLOWCHART (D-IL1). The temptation here is the strongest in the cast:
// "orchestration" invites drawing the process. The process is Phase 2's job, drawn with connectors
// between stations. This is the station.
//
// FACELESS (D-IL17): the drive gear names the `left` face outright. A hub has no gaze.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { IsoTrack, TrackMarks, trackLaneBox } from "../primitives/IsoTrack.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * Three ports for three genuinely different things: work waiting (`queue-in`), work handed to a
 * member (`dispatch`), and the roll-up that leaves once the members settle (`report-out`). The
 * report leaves from the TOP rather than a third flank, because it is not more work — it is what the
 * orchestration produced.
 */
export const orchestratorMeta: IllustrationRegistryEntry = {
  id: "orchestrator",
  title: "Orchestrator",
  entity: "suite_runs",
  tier: 2,
  keywords: [
    "orchestrator",
    "automation",
    "worker pool",
    "queue",
    "fan out",
    "drive",
    "gear",
    "auto rating",
  ],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "queue-in": { title: "Queue in", side: "left", offset: -1.4 },
    dispatch: { title: "Dispatch", side: "right", offset: 1.4 },
    "report-out": { title: "Report out", side: "top", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "An orchestrator: a drive hub with a toothed gear on its flank, one track stub feeding it and three leaving it — the worker pool that fans a mass run out and gathers it back.",
};

export type OrchestratorProps = EntityComponentProps;

const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const HUB_WIDTH = 0.34;
const HUB_HEIGHT = 0.52;

/** The stub lanes: one in on the far flank, three out on the near one. */
const STUB_LENGTH = 0.24;
const STUB_DEPTH = 0.11;
const STUB_HEIGHT = 0.07;
const STUB_REACH = 0.3;
const OUTPUT_SPREAD = 0.29;

/** Eight teeth, not twelve — the count is part of not reading as a dial. */
const GEAR_TEETH = 8;

function hubBox(footprint: number): IsoBox {
  const side = footprint * HUB_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * HUB_HEIGHT };
}

function stubBox(footprint: number, cx: number, cy: number): IsoBox {
  return trackLaneBox(footprint, {
    cx: footprint * cx,
    cy: footprint * cy,
    z0: FLOOR,
    length: STUB_LENGTH,
    depth: STUB_DEPTH,
    height: STUB_HEIGHT,
  });
}

export function orchestratorHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * HUB_HEIGHT;
}

export function Orchestrator({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: OrchestratorProps): ReactElement {
  const footprint = footprintUnits(size);
  const hub = hubBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const outputs = [-OUTPUT_SPREAD, 0, OUTPUT_SPREAD];

  return (
    <EntityRoot
      meta={orchestratorMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={orchestratorHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      {/* The queue stub is furthest back, so it is painted first. */}
      <IsoTrack box={stubBox(footprint, -STUB_REACH, 0)} weight="detail" />
      <TrackMarks box={stubBox(footprint, -STUB_REACH, 0)} chevrons={1} />
      <IsoHousing width={hub.w} depth={hub.d} height={hub.h} z0={hub.z0} />
      <DriveGear box={hub} accent={accent} />
      {outputs.map((cy) => (
        <IsoTrack key={`out-${cy}`} box={stubBox(footprint, STUB_REACH, cy)} weight="detail" />
      ))}
      {outputs.map((cy) => (
        <TrackMarks key={`out-marks-${cy}`} box={stubBox(footprint, STUB_REACH, cy)} chevrons={1} />
      ))}
    </EntityRoot>
  );
}

Orchestrator.illusLayer = "structure" as const;
Orchestrator.entityHeightUnits = orchestratorHeightUnits;

/**
 * The drive gear on the hub's LEFT face: a rim, eight teeth standing proud of it, and a hub boss
 * with a keyway. The boss is the entity's single accent moment (D-IL6) — the drive is what is
 * running, and lighting the teeth as well would turn one station into nine places for the eye.
 *
 * The teeth are `<polygon>`s computed from an angle, which is a shape element and not a `<path>`:
 * WP 0.3's contract test forbids an entity authoring a path, and a trapezoid does not need one. The
 * circle is drawn as a plain `<circle>` in flat face art — `GlyphFrame` puts it through the fixed
 * face transform, which is what turns it into the correct iso ellipse (D-IL15). No component here
 * ever computes an ellipse by hand.
 */
function DriveGear({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const cx = width / 2;
  const cy = height / 2;
  const rim = Math.min(width, height) * 0.32;
  const toothDepth = rim * 0.44;
  const boss = rim * 0.36;
  const teeth = Array.from({ length: GEAR_TEETH }, (_, index) => index);

  return (
    <GlyphFrame face="left" box={box}>
      {teeth.map((tooth) => {
        const angle = (tooth / GEAR_TEETH) * Math.PI * 2;
        const half = Math.PI / GEAR_TEETH / 2.2;
        const corners: readonly (readonly [number, number])[] = [
          [angle - half, rim * 0.94],
          [angle - half * 0.6, rim + toothDepth],
          [angle + half * 0.6, rim + toothDepth],
          [angle + half, rim * 0.94],
        ];
        return (
          <polygon
            key={`tooth-${tooth}`}
            data-illus-mark="gear-tooth"
            points={corners
              .map(
                ([theta, radius]) =>
                  `${fmt(cx + Math.cos(theta) * radius)},${fmt(cy + Math.sin(theta) * radius)}`,
              )
              .join(" ")}
            style={{ fill: "var(--illus-ink-muted)" }}
          />
        );
      })}
      <circle
        cx={fmt(cx)}
        cy={fmt(cy)}
        r={fmt(rim)}
        strokeWidth={ILLUS_STROKE_DETAIL}
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
      />
      <circle
        data-illus-mark="drive-boss"
        cx={fmt(cx)}
        cy={fmt(cy)}
        r={fmt(boss)}
        style={{ fill: accent }}
      />
      {/* The keyway: the notch that says this wheel is keyed to a shaft, i.e. driven. */}
      <rect
        data-illus-mark="keyway"
        x={fmt(cx - boss * 0.22)}
        y={fmt(cy - boss * 1.5)}
        width={fmt(boss * 0.44)}
        height={fmt(boss * 0.66)}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink-muted)" }}
      />
    </GlyphFrame>
  );
}
