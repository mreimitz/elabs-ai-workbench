// ==================================================================================================
// Agent — the LLM robot (tier 1, entity `runs`)
// ==================================================================================================
// This one is a REPRODUCTION, not a fresh design: `planning/Roadmap/RM-14-illustrations/examples/Agent.example.tsx`
// is the owner's exemplar and the proportions below are its proportions, expressed as fractions of
// the footprint so the same robot exists at S, M and L. At `m` (footprint 6) every dimension
// evaluates to the exemplar's own number — torso 2.9 wide by 1.8 tall from z 1.2, neck 0.9 by 0.18
// from 3.0, head 2.2 by 1.4 from 3.18, antenna base 4.58 and tip 5.35.
//
// It is also the D-IL17 PROOF CASE. The face panel and the chest rules mount on `face="gaze"`, which
// `GlyphFrame` resolves against the entity's `facing`: `upstream` (the default) puts them on the
// LEFT face, so in a left-to-right process scene the agent looks toward the incoming work.
// `McpServer` in this same folder deliberately does the opposite — it names a face outright, because
// a rack has no gaze — and the contract tests hold both halves of that.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits, project } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * DEVIATION FROM THE EXEMPLAR, recorded rather than applied silently: the exemplar's `agentMeta`
 * declares `variants: ["upstream", "downstream"]`. Those are not variants in the shipped contract —
 * they are the two values of `facing`, which WP 0.1 made a first-class closed vocabulary
 * (`ILLUSTRATION_FACINGS`) and a first-class prop (D-IL17). Listing them here as well would give the
 * catalog two ways to say one thing, and D-IL8 closes grammars precisely so that cannot happen. The
 * agent therefore declares NO variants, and the gallery renders both facings for every entity —
 * which is a better proof anyway, since it shows the faceless entities ignoring the prop.
 */
export const agentMeta: IllustrationRegistryEntry = {
  id: "agent",
  title: "Agent / LLM",
  entity: "runs",
  tier: 1,
  keywords: ["agent", "llm", "model", "robot", "primary llm", "assistant", "run"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    "context-in": { title: "Context in", side: "left" },
    "result-out": { title: "Result out", side: "right" },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "An LLM agent: a robot on a two-tier plinth, its face panel mounted on the gaze side and its antenna LED carrying the run status.",
};

export type AgentProps = EntityComponentProps;

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// The exemplar's proportions, over its `m` footprint of 6 units.
const TORSO_WIDTH = 2.9 / 6;
const TORSO_HEIGHT = 1.8 / 6;
const NECK_WIDTH = 0.9 / 6;
const NECK_HEIGHT = 0.18 / 6;
const HEAD_WIDTH = 2.2 / 6;
const HEAD_HEIGHT = 1.4 / 6;
const ANTENNA_HEIGHT = 0.77 / 6;

type AgentBoxes = {
  readonly torso: IsoBox;
  readonly neck: IsoBox;
  readonly head: IsoBox;
  /** The world z the antenna rises from, and the z of its tip. */
  readonly antennaBase: number;
  readonly antennaTip: number;
};

function agentBoxes(footprint: number): AgentBoxes {
  const torsoSide = footprint * TORSO_WIDTH;
  const torsoHeight = footprint * TORSO_HEIGHT;
  const neckSide = footprint * NECK_WIDTH;
  const neckHeight = footprint * NECK_HEIGHT;
  const headSide = footprint * HEAD_WIDTH;
  const headHeight = footprint * HEAD_HEIGHT;
  const torso: IsoBox = { cx: 0, cy: 0, w: torsoSide, d: torsoSide, z0: FLOOR, h: torsoHeight };
  const neck: IsoBox = {
    cx: 0,
    cy: 0,
    w: neckSide,
    d: neckSide,
    z0: FLOOR + torsoHeight,
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
  const antennaBase = head.z0 + headHeight;
  return { torso, neck, head, antennaBase, antennaTip: antennaBase + footprint * ANTENNA_HEIGHT };
}

/**
 * The antenna TIP, not the head — the exemplar anchors the agent's `top` port there, and the port is
 * where a loop or an annotation attaches, which is above the mast rather than under it.
 */
export function agentHeightUnits(size: IllustrationSize): number {
  return agentBoxes(footprintUnits(size)).antennaTip;
}

export function Agent({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: AgentProps): ReactElement {
  const footprint = footprintUnits(size);
  const { torso, neck, head, antennaBase, antennaTip } = agentBoxes(footprint);
  // The one accent moment (D-IL6) is the antenna LED, and `error` recolours it rather than adding a
  // second mark — exactly as the exemplar does.
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const eye = state === "error" ? "var(--illus-error)" : "var(--illus-ink)";
  const base = project(0, 0, antennaBase);
  const tip = project(0, 0, antennaTip);

  return (
    <EntityRoot
      meta={agentMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={antennaTip}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={torso.w} depth={torso.d} height={torso.h} z0={torso.z0} />
      <IsoHousing width={neck.w} depth={neck.d} height={neck.h} z0={neck.z0} weight="detail-fine" />
      <IsoHousing width={head.w} depth={head.d} height={head.h} z0={head.z0} />
      <ChestPanel box={torso} />
      <FacePanel box={head} eye={eye} />
      <g data-illus-mark="antenna">
        <line
          x1={fmt(base.x)}
          y1={fmt(base.y)}
          x2={fmt(tip.x)}
          y2={fmt(tip.y)}
          strokeWidth={ILLUS_STROKE_DETAIL}
          strokeLinecap="round"
          style={{ stroke: "var(--illus-ink)" }}
        />
        <circle cx={fmt(tip.x)} cy={fmt(tip.y)} r={3.6} style={{ fill: accent }} />
        {state === "active" ? (
          <circle
            data-illus-mark="antenna-active"
            cx={fmt(tip.x)}
            cy={fmt(tip.y)}
            r={8}
            fill="none"
            strokeWidth={ILLUS_STROKE_DETAIL}
            opacity={0.55}
            style={{ stroke: "var(--illus-accent)" }}
          />
        ) : null}
        {state === "error" ? (
          <circle
            data-illus-mark="antenna-error"
            cx={fmt(tip.x)}
            cy={fmt(tip.y)}
            r={8}
            fill="none"
            strokeWidth={ILLUS_STROKE_DETAIL}
            strokeDasharray={ILLUS_DASH.construction}
            opacity={0.7}
            style={{ stroke: "var(--illus-error)" }}
          />
        ) : null}
      </g>
    </EntityRoot>
  );
}

Agent.illusLayer = "structure" as const;
Agent.entityHeightUnits = agentHeightUnits;

/**
 * The visor and its two eyes, on the GAZE face of the head (D-IL17).
 *
 * `faceExtent` is asked for the LEFT face even though the art may land on the right one: every box
 * this entity draws is square (`w === d`), and for a square box the two side faces have identical
 * on-screen extents. `GlyphFrame` resolves which face the art actually mounts on; the extent is only
 * used to lay the art out inside it.
 */
function FacePanel({ box, eye }: { box: IsoBox; eye: string }): ReactElement {
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

/** Two rules across the chest, on the same gaze face — the exemplar's plate detail. */
function ChestPanel({ box }: { box: IsoBox }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = width * 0.18;
  const barHeight = Math.max(1.4, height * 0.055);
  return (
    <GlyphFrame face="gaze" box={box}>
      {[0, 1].map((row) => (
        <rect
          key={`plate-${row}`}
          x={fmt(inset)}
          y={fmt(height * (row === 0 ? 0.34 : 0.52))}
          width={fmt((width - inset * 2) * (row === 0 ? 1 : 0.66))}
          height={fmt(barHeight)}
          rx={fmt(barHeight / 2)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}
