// ==================================================================================================
// Environment — an open stage plate (tier 2, entity `scenarios`)
// ==================================================================================================
// What a run happens INSIDE: the model, the MCP servers, the skills and the guardrails a test is
// executed against. Research 5 calls it a "terrarium/stage plate", and this takes the stage.
//
// THE BINDING IS `scenarios`, AND THAT IS CORRECT rather than stale. RM-27 renamed Scenario ->
// Environment in UI LABELS ONLY and deliberately froze the wire — `scenarioId`, the `Scenario` type,
// `/api/scenarios` and the `/testing/scenarios` redirect all survive. So the table an operator now
// calls "environment" is still `scenarios`, and binding to `environments` would bind to nothing.
//
// IT IS A CONTAINER, AND THAT IS THE WHOLE POINT. Like WP 1.2's `scan` arch, this entity has to read
// correctly with ANOTHER entity standing in it, which is a harder constraint than it sounds: the
// obvious four-walled tray occludes whatever it holds, because the near walls paint over it. So the
// rim is asymmetric — two tall walls on the FAR sides, two low kerbs on the near ones — which is the
// same solution a theatre set uses, and for the same reason. Verified by looking, with an `agent`
// standing on the plate.
//
// FACELESS (D-IL17): the stage mark names the `top` face outright. An enclosure has no gaze.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `host` is what stands inside — it is on the TOP because that is literally where a hosted entity
 * goes. `bind` is what the environment is wired to (servers, skills, a model) and leaves from the
 * flank, because those are configuration rather than occupants.
 */
export const environmentMeta: IllustrationRegistryEntry = {
  id: "environment",
  title: "Environment",
  entity: "scenarios",
  tier: 2,
  keywords: [
    "environment",
    "scenario",
    "stage",
    "enclosure",
    "sandbox",
    "context",
    "configuration",
  ],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    host: { title: "Host", side: "top", offset: -1.4 },
    bind: { title: "Bind", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "An environment: a low stage plate with two tall far walls and two near kerbs, marked at its centre — the bounded enclosure a run happens inside.",
};

export type EnvironmentProps = EntityComponentProps;

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const PLATE_SIDE = 0.92;
const PLATE_HEIGHT = 0.08;
const WALL_THICKNESS = 0.07;
const WALL_HEIGHT = 0.38;
const KERB_HEIGHT = 0.09;

/** Where the plate's own surface sits, in units — what a hosted entity would stand on. */
export function environmentFloorUnits(size: IllustrationSize): number {
  return footprintUnits(size) * PLATE_HEIGHT;
}

/** The far walls decide the height; the near kerbs are deliberately far below them. */
export function environmentHeightUnits(size: IllustrationSize): number {
  return footprintUnits(size) * (PLATE_HEIGHT + WALL_HEIGHT);
}

function plateBox(footprint: number): IsoBox {
  const side = footprint * PLATE_SIDE;
  return { cx: 0, cy: 0, w: side, d: side, z0: 0, h: footprint * PLATE_HEIGHT };
}

export function Environment({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: EnvironmentProps): ReactElement {
  const footprint = footprintUnits(size);
  const plate = plateBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const floor = plate.z0 + plate.h;
  const edge = (footprint * PLATE_SIDE) / 2 - (footprint * WALL_THICKNESS) / 2;
  const span = footprint * PLATE_SIDE;
  const thickness = footprint * WALL_THICKNESS;

  return (
    <EntityRoot
      meta={environmentMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={environmentHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoHousing width={plate.w} depth={plate.d} height={plate.h} z0={plate.z0} />
      {/* The two FAR walls: full height, painted before anything that stands on the plate, so a
          hosted entity reads as being in front of them rather than behind. */}
      <IsoHousing
        width={thickness}
        depth={span}
        height={footprint * WALL_HEIGHT}
        cx={-edge}
        z0={floor}
      />
      <IsoHousing
        width={span - thickness}
        depth={thickness}
        height={footprint * WALL_HEIGHT}
        cx={thickness / 2}
        cy={-edge}
        z0={floor}
      />
      <StageMark box={plate} accent={accent} />
      {/* The two NEAR kerbs: a hand's width high, so the enclosure still closes without hiding its
          occupant. Painted last, because they are the closest thing to the viewer. */}
      <IsoHousing
        width={span - thickness}
        depth={thickness}
        height={footprint * KERB_HEIGHT}
        cx={-thickness / 2}
        cy={edge}
        z0={floor}
        weight="detail"
      />
      <IsoHousing
        width={thickness}
        depth={span}
        height={footprint * KERB_HEIGHT}
        cx={edge}
        z0={floor}
        weight="detail"
      />
    </EntityRoot>
  );
}

Environment.illusLayer = "structure" as const;
Environment.entityHeightUnits = environmentHeightUnits;

/**
 * The stage mark on the plate's TOP face: four corner brackets around the spot an occupant stands
 * on, and a centre pip that is the entity's single accent moment (D-IL6). The brackets are ink-muted
 * setting-out marks — the drafting equivalent of a chalk cross on a stage floor — so the enclosure
 * reads as prepared for something rather than as decorated.
 */
function StageMark({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.min(width, height) * 0.22;
  const arm = reach * 0.42;
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;

  return (
    <GlyphFrame face="top" box={box}>
      {corners.map(([sx, sy]) => (
        <g key={`bracket-${sx}-${sy}`} data-illus-mark="setting-out">
          <line
            x1={fmt(cx + sx * reach)}
            y1={fmt(cy + sy * reach)}
            x2={fmt(cx + sx * (reach - arm))}
            y2={fmt(cy + sy * reach)}
            strokeWidth={ILLUS_STROKE_DETAIL_FINE}
            style={{ stroke: "var(--illus-ink-muted)" }}
          />
          <line
            x1={fmt(cx + sx * reach)}
            y1={fmt(cy + sy * reach)}
            x2={fmt(cx + sx * reach)}
            y2={fmt(cy + sy * (reach - arm))}
            strokeWidth={ILLUS_STROKE_DETAIL_FINE}
            style={{ stroke: "var(--illus-ink-muted)" }}
          />
        </g>
      ))}
      <circle
        data-illus-mark="stage-pip"
        cx={fmt(cx)}
        cy={fmt(cy)}
        r={fmt(Math.max(2, reach * 0.2))}
        strokeWidth={ILLUS_STROKE_DETAIL}
        style={{ fill: accent, stroke: "var(--illus-paper)" }}
      />
    </GlyphFrame>
  );
}
