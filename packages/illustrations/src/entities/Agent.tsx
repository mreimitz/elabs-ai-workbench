// ==================================================================================================
// Agent — the LLM robot (tier 1, entity `runs`)
// ==================================================================================================
// This one is a REPRODUCTION, not a fresh design: `planning/Roadmap/RM-14-illustrations/examples/Agent.example.tsx`
// is the owner's exemplar and the proportions are its proportions, expressed as fractions of the
// footprint so the same robot exists at S, M and L. At `m` (footprint 6) every dimension evaluates
// to the exemplar's own number — torso 2.9 wide by 1.8 tall from z 1.2, neck 0.9 by 0.18 from 3.0,
// head 2.2 by 1.4 from 3.18, antenna base 4.58 and tip 5.35.
//
// WP 1.1 §3 moved the standing figure — torso, neck, head, visor — into `primitives/IsoFigure.tsx`,
// because `Validator` is the same silhouette carrying a shield, and D-IL12 forbids a reusable shape
// living inside one entity. The proportions above did not move an inch; `figureBoxes` is the old
// `agentBoxes` verbatim, sequential arithmetic and all, which is why the 5.35 assertion still holds
// exactly. What stayed here is what makes this entity THIS entity: the antenna and the chest plates.
//
// It is also the D-IL17 PROOF CASE. The visor and the chest rules mount on `face="gaze"`, which
// `GlyphFrame` resolves against the entity's `facing`: `upstream` (the default) puts them on the
// LEFT face, so in a left-to-right process scene the agent looks toward the incoming work.
// `McpServer` in this same folder deliberately does the opposite — it names a face outright, because
// a rack has no gaze — and the contract tests hold both halves of that.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits, project } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_DETAIL } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoFigure, figureBoxes } from "../primitives/IsoFigure.js";
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

/** The one proportion that is the AGENT's rather than the figure's: how far the mast rises. */
const ANTENNA_HEIGHT = 0.77 / 6;

type AgentBoxes = {
  readonly torso: IsoBox;
  /** The world z the antenna rises from, and the z of its tip. */
  readonly antennaBase: number;
  readonly antennaTip: number;
};

function agentBoxes(footprint: number): AgentBoxes {
  const { torso, crown } = figureBoxes(footprint, FLOOR);
  return { torso, antennaBase: crown, antennaTip: crown + footprint * ANTENNA_HEIGHT };
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
  const { torso, antennaBase, antennaTip } = agentBoxes(footprint);
  // The one accent moment (D-IL6) is the antenna LED, and `error` recolours it rather than adding a
  // second mark — exactly as the exemplar does.
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
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
      <IsoFigure footprint={footprint} floor={FLOOR} />
      <ChestPanel box={torso} />
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
