// ==================================================================================================
// FeedbackReport — a document tray (tier 1, entity `run_feedback`)
// ==================================================================================================
// Where what a run produced comes to rest and be judged. Research 5 calls it a "document tray", and
// a TRAY is the right word rather than a folder or a screen: a tray accumulates. Sheets land in it
// one at a time and stay there, which is exactly the shape of feedback on a fleet of runs.
//
// THE `entity` BINDING WAS A JUDGEMENT CALL, and WP 1.2 asks for it in one line. Three tables were
// candidates:
//
//   `run_grades`         already bound, by WP 1.1's `validator`. A grade is a VERDICT, and the
//                        entity that depicts verdicts is the shield agent that reaches them.
//   `suite_run_reports`  one composed document per suite run. A single report is a sheet, not a
//                        tray — the drawing would be over-promising a plural.
//   `run_feedback`       the human-feedback backbone: many entries, arriving over time, never
//                        blended into a grade. That is what a tray of settled sheets IS.
//
// So `run_feedback`, and the tie-breaker is the drawing rather than the name: this depicts the
// accumulation, and only one of the three tables accumulates.
//
// FACELESS (D-IL17): the top sheet's headline names the `top` face outright. A tray is read from
// above, and asking it to face downstream must leave it exactly where it is.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { IsoSheetStack, sheetStackBoxes } from "../primitives/IsoSheetStack.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `in` and `out` are the symmetric pair a tray actually has — work lands, a judgement leaves — and
 * they sit at a 1.4-unit offset either side so the gallery's port overlay does not stack them on the
 * plain `left`/`right` cardinals. 1.4 is inside the footprint at every size (`s`'s half-extent is 2).
 */
export const feedbackReportMeta: IllustrationRegistryEntry = {
  id: "feedback-report",
  title: "Feedback Report",
  entity: "run_feedback",
  tier: 1,
  keywords: ["feedback", "report", "tray", "review", "verdict", "rating", "findings"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    in: { title: "In", side: "left", offset: -1.4 },
    out: { title: "Out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A feedback report: a shallow open tray on a plinth with sheets settled in it, the topmost carrying its headline — where what a run produced comes to rest and be reviewed.",
};

export type FeedbackReportProps = EntityComponentProps;

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const TRAY_WIDTH = 0.66;
const TRAY_FLOOR_HEIGHT = 0.045;
const WALL_HEIGHT = 0.1;
const WALL_THICKNESS = 0.05;
/** How many sheets have settled in the tray, and how far each is nudged off the one below. */
const SHEETS = 3;
const SETTLE = 0.05;

function trayFloorBox(footprint: number): IsoBox {
  const side = footprint * TRAY_WIDTH;
  return {
    cx: 0,
    cy: 0,
    w: side,
    d: side,
    z0: FLOOR,
    h: footprint * TRAY_FLOOR_HEIGHT,
  };
}

/** The sheets sit ON the tray floor and stop short of the wall tops, so the rim still reads. */
function sheetSlabBox(footprint: number): IsoBox {
  const floor = trayFloorBox(footprint);
  const side = floor.w - footprint * WALL_THICKNESS * 2.6;
  return {
    cx: 0,
    cy: 0,
    w: side,
    d: side,
    z0: floor.z0 + floor.h,
    h: footprint * WALL_HEIGHT * 0.55,
  };
}

export function feedbackReportHeightUnits(size: IllustrationSize): number {
  const footprint = footprintUnits(size);
  return FLOOR + footprint * TRAY_FLOOR_HEIGHT + footprint * WALL_HEIGHT;
}

export function FeedbackReport({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: FeedbackReportProps): ReactElement {
  const footprint = footprintUnits(size);
  const floor = trayFloorBox(footprint);
  const slab = sheetSlabBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const top = sheetStackBoxes(slab, SHEETS, { staggerFraction: SETTLE }).top;

  return (
    <EntityRoot
      meta={feedbackReportMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={feedbackReportHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing
        width={floor.w}
        depth={floor.d}
        height={floor.h}
        z0={floor.z0}
        weight="detail"
      />
      {/* The tray is OPEN, so it is four walls rather than a lid — and the two at negative x and y
          are painted before the sheets while the two nearest the viewer are painted after, which is
          what puts the sheets INSIDE the tray instead of on top of it. Layer order cannot express
          that (all four walls and the sheets are structure); document order can, and `collectLayers`
          is stable within a layer precisely so back-to-front authoring survives. */}
      <TrayWall footprint={footprint} floor={floor} side="back" />
      <IsoSheetStack box={slab} sheets={SHEETS} staggerFraction={SETTLE} weight="detail" />
      <HeadlineSheet box={top} accent={accent} />
      <TrayWall footprint={footprint} floor={floor} side="front" />
    </EntityRoot>
  );
}

FeedbackReport.illusLayer = "structure" as const;
FeedbackReport.entityHeightUnits = feedbackReportHeightUnits;

/**
 * Two of the tray's four rim walls. `back` is the pair at negative x and y — the ones the sheets are
 * drawn in front of; `front` is the pair nearest the viewer, drawn last so the pile sits inside.
 */
function TrayWall({
  footprint,
  floor,
  side,
}: {
  footprint: number;
  floor: IsoBox;
  side: "back" | "front";
}): ReactElement {
  const thickness = footprint * WALL_THICKNESS;
  const height = footprint * WALL_HEIGHT;
  const z0 = floor.z0 + floor.h;
  const at = (floor.w - thickness) / 2;
  const sign = side === "back" ? -1 : 1;
  return (
    <g data-illus-mark={`tray-wall-${side}`}>
      <IsoHousing
        width={floor.w}
        depth={thickness}
        height={height}
        cy={sign * at}
        z0={z0}
        weight="detail"
      />
      <IsoHousing
        width={thickness}
        depth={floor.d}
        height={height}
        cx={sign * at}
        z0={z0}
        weight="detail"
      />
    </g>
  );
}

/**
 * The topmost sheet's face: a headline bar — the entity's ONE accent moment (D-IL6), because the
 * only thing anybody reads off a report at a glance is its verdict line — over two muted rules
 * standing in for the body. Text is never set on an iso face (D-IL2).
 */
function HeadlineSheet({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.18;
  const innerWidth = width - inset * 2;
  const headlineHeight = Math.max(2, (height - inset * 2) * 0.24);
  const ruleHeight = Math.max(1.1, headlineHeight * 0.36);
  const ruleGap = (height - inset * 2 - headlineHeight - ruleHeight * 2) / 3;

  return (
    <GlyphFrame face="top" box={box}>
      <rect
        data-illus-mark="headline"
        x={fmt(inset)}
        y={fmt(inset)}
        width={fmt(innerWidth * 0.54)}
        height={fmt(headlineHeight)}
        rx={fmt(headlineHeight / 2)}
        style={{ fill: accent }}
      />
      {[0, 1].map((rule) => (
        <rect
          key={`rule-${rule}`}
          x={fmt(inset)}
          y={fmt(inset + headlineHeight + ruleGap * (rule + 1) + ruleHeight * rule)}
          width={fmt(innerWidth * (rule === 0 ? 1 : 0.7))}
          height={fmt(ruleHeight)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}
