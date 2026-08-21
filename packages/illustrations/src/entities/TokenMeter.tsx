// ==================================================================================================
// TokenMeter — a counter column (tier 2, no domain binding)
// ==================================================================================================
// The accounting column: how much of a context window, a cost cap or a definition budget has been
// taken. Research 5 calls it a "gauge/counter column", and the column is the point — a quantity
// drawn as a HEIGHT is the one shape that needs no legend, no axis and no number to be read.
//
// NO `entity` BINDING, deliberately, and WP 1.2 says so outright: this is accounting, not a table.
// There is no `token_meters` row anywhere in the schema, and binding it to `mcp_tool_scans` (which
// carries per-tool token counts) would answer "which illustration depicts a tool scan?" with a
// gauge. `entity` is nullable exactly so a component can decline, and `searchIllustrations` already
// handles the null.
//
// IT MUST NOT BECOME A CHART (D-IL1 — charts are `@elabs-ai/components-charts`). The guard rails
// are the ones D-IL6 already states: the READ-OFF MARK is the accent and the segments are ink. So
// there is one accent pointer and no second one, no axis, no scale text, no gridlines, and nothing
// here takes data — the level is a fixed property of the variant, because an illustration depicts a
// meter, it is not a meter.
//
// Both variants stand exactly as tall. `heightUnits` is what every port anchor is measured against
// (D-IL7), so a column that grew with its reading would move `measure-in` — the reading moves, the
// column does not, which is also how a real gauge works.
//
// FACELESS (D-IL17): the dial names the `left` face outright. A column has a read-off side, not a
// gaze.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_CONSTRUCTION } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `measure-in` is the one semantic port, and the asymmetry is honest: a meter is fed, it does not
 * feed. It sits at a 1.4-unit offset so the gallery's port overlay does not stack it on the plain
 * `left` cardinal; 1.4 is inside the footprint at every size (`s`'s half-extent is 2).
 */
export const tokenMeterMeta: IllustrationRegistryEntry = {
  id: "token-meter",
  title: "Token Meter",
  entity: null,
  tier: 2,
  keywords: ["token meter", "gauge", "budget", "spend", "context window", "cap", "accounting"],
  variants: ["budget", "spend"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "measure-in": { title: "Measure in", side: "left", offset: -1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A token meter: a segmented counter column with a read-off pointer on its dial — marking a ceiling on the budget variant and a consumed level on the spend one.",
};

export const TOKEN_METER_VARIANTS = ["budget", "spend"] as const;
export type TokenMeterVariant = (typeof TOKEN_METER_VARIANTS)[number];

export type TokenMeterProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): TokenMeterVariant {
  return TOKEN_METER_VARIANTS.includes(variant as TokenMeterVariant)
    ? (variant as TokenMeterVariant)
    : "budget";
}

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
/**
 * Slim enough that the column is read by its HEIGHT rather than its bulk, wide enough that the dial
 * on its front face is legible at `s` — where the face is only 20 px across. 0.26 was slimmer and
 * lost the pointer at the smallest tile; this was set by looking at the rendered sheet.
 */
const COLUMN_WIDTH = 0.32;
const SEGMENTS = 4;
const SEGMENT_HEIGHT = 0.15;

/**
 * Where each variant's pointer sits, as a share of the column's height. Not data — see the header:
 * these are the two things a meter is FOR, drawn once each.
 */
const LEVEL: Record<TokenMeterVariant, number> = { budget: 0.86, spend: 0.58 };

function columnBox(footprint: number): IsoBox {
  const side = footprint * COLUMN_WIDTH;
  return {
    cx: 0,
    cy: 0,
    w: side,
    d: side,
    z0: FLOOR,
    h: footprint * SEGMENT_HEIGHT * SEGMENTS,
  };
}

export function tokenMeterHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * SEGMENT_HEIGHT * SEGMENTS;
}

export function TokenMeter({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: TokenMeterProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const column = columnBox(footprint);
  const segmentHeight = footprint * SEGMENT_HEIGHT;
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={tokenMeterMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={tokenMeterHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      {/* The segments ARE the scale (D-IL6: the segments are ink). Stacking real solids rather than
          ruling lines onto one tall box is what keeps this a drawn object instead of a chart — the
          divisions are edges of the thing, seen in perspective, not marks printed on it. */}
      {Array.from({ length: SEGMENTS }, (_, segment) => (
        <IsoHousing
          key={`segment-${segment}`}
          width={column.w}
          depth={column.d}
          height={segmentHeight}
          z0={column.z0 + segment * segmentHeight}
          weight={segment === 0 ? "ink" : "detail"}
        />
      ))}
      <Dial box={column} variant={resolved} accent={accent} />
    </EntityRoot>
  );
}

TokenMeter.illusLayer = "structure" as const;
TokenMeter.entityHeightUnits = tokenMeterHeightUnits;

/**
 * The read-off face. Both variants carry the same accent pointer at their own level; what differs is
 * what the level MEANS, and the drawing says which:
 *
 *   `budget`  a dashed guide across the column — a limit, drawn in the construction vocabulary
 *             because a ceiling is a line you have not reached, not a quantity you hold.
 *   `spend`   a muted block from the base up to the level — a quantity, drawn as mass.
 *
 * The pointer is the entity's ONE accent moment (D-IL6) in both.
 */
function Dial({
  box,
  variant,
  accent,
}: {
  box: IsoBox;
  variant: TokenMeterVariant;
  accent: string;
}): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = width * 0.16;
  const level = height * (1 - LEVEL[variant]);
  const pointerWidth = width * 0.62;
  const pointerHeight = Math.max(5, height * 0.12);

  return (
    <GlyphFrame face="left" box={box}>
      {variant === "spend" ? (
        <rect
          data-illus-mark="consumed"
          x={fmt(inset)}
          y={fmt(level)}
          width={fmt(width - inset * 2)}
          height={fmt(height - level)}
          style={{ fill: "var(--illus-ink-muted)", fillOpacity: 0.8 }}
        />
      ) : (
        <line
          data-illus-mark="ceiling"
          x1={fmt(inset)}
          y1={fmt(level)}
          x2={fmt(width - inset)}
          y2={fmt(level)}
          strokeWidth={ILLUS_STROKE_CONSTRUCTION}
          strokeDasharray={ILLUS_DASH.construction}
          style={{ stroke: "var(--illus-guide)" }}
        />
      )}
      <polygon
        data-illus-mark="read-off"
        points={[
          [0, level - pointerHeight / 2],
          [pointerWidth, level],
          [0, level + pointerHeight / 2],
        ]
          .map(([x, y]) => `${fmt(x as number)},${fmt(y as number)}`)
          .join(" ")}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
