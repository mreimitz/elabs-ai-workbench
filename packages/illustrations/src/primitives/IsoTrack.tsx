// ==================================================================================================
// IsoTrack — the lane of track, and the direction marks printed on it (D-IL12)
// ==================================================================================================
// WP 1.3 asks `suite` to be "a rack of run tracks", and says outright that if `run`'s track shape is
// not extractable as a primitive that is a FINDING to report rather than a reason to draw a second,
// subtly different track. It was extractable, so here it is, and `Run` was refactored onto it.
//
// BE HONEST ABOUT WHAT MOVED, because "a primitive that abstracts nothing is also a finding" and
// this file is two thirds of one:
//
//   * `IsoTrack` — the lane SOLID — abstracts almost nothing. It is one `IsoHousing` call with the
//     box unpacked. It exists so that a caller says "a lane" rather than "a box that happens to be
//     lane-shaped", and so the two entities cannot drift on the weight rule (the leading lane
//     carries the silhouette in ink, the ones behind it are interior detail).
//   * `trackLaneBox` + {@link TRACK_LANE} — the PROPORTIONS — are the part that matters most for
//     `suite`. A suite that guessed its own lane depth would be a second track by the only measure
//     anybody can see.
//   * `TrackMarks` — the direction marks — is the genuinely shared drawing: three chevrons between
//     two sleeper rules, laid out inside the lane's top face, with exactly one of them lit. That is
//     the fifty lines `Suite` would otherwise have copied, and copying them is how "the same track,
//     but the chevrons are 2 px further apart on this one" happens.
//
// LAYERING, deliberately left alone. `TrackMarks` declares no `illusLayer`, so it lands in the
// default `structure` layer exactly where `Run`'s private `DirectionMarks` did — the marks are part
// of the solid they are printed on, and every other entity's face glyph (`Skill`'s manifest,
// `Validator`'s shield, `Model`'s die) sits in structure for the same reason. Declaring `detail`
// here would have been a silent visual change to a WP 1.1 entity this work package does not own.

import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE, type IllusStrokeWeight } from "../line-system.js";
import { GlyphFrame } from "./GlyphFrame.js";
import { IsoHousing } from "./IsoHousing.js";

/**
 * One lane's proportions, as fractions of the entity footprint so S/M/L are one drawing at three
 * scales. These are `Run`'s own numbers, moved rather than re-picked: at `m` they still evaluate to
 * a lane 5.04 units long, 1.8 deep and 0.78 tall, which is what `Run.test.tsx` pins.
 */
export const TRACK_LANE = { length: 0.84, depth: 0.3, height: 0.13 } as const;

export type TrackLaneOptions = {
  /** Centre of the lane across the flow, in units. Lanes stack by varying this. */
  cy?: number;
  /** Centre along the flow, in units. */
  cx?: number;
  /** The floor the lane sits on, in units above the ground plane. */
  z0?: number;
  /** Overrides, as fractions of the footprint — a shorter lane inside a frame, say. */
  length?: number;
  depth?: number;
  height?: number;
};

/** The box one lane occupies. The one place a lane's dimensions are decided. */
export function trackLaneBox(footprint: number, options: TrackLaneOptions = {}): IsoBox {
  const {
    cx = 0,
    cy = 0,
    z0 = 0,
    length = TRACK_LANE.length,
    depth = TRACK_LANE.depth,
    height = TRACK_LANE.height,
  } = options;
  return {
    cx,
    cy,
    w: footprint * length,
    d: footprint * depth,
    z0,
    h: footprint * height,
  };
}

export type IsoTrackProps = {
  box: IsoBox;
  /**
   * A NAMED line weight. The leading lane takes `ink` because it carries the silhouette; the lanes
   * behind it are interior edges of the same object and take `detail`.
   */
  weight?: IllusStrokeWeight;
};

export function IsoTrack({ box, weight = "ink" }: IsoTrackProps): ReactElement {
  return (
    <IsoHousing
      width={box.w}
      depth={box.d}
      height={box.h}
      cx={box.cx}
      cy={box.cy}
      z0={box.z0}
      weight={weight}
    />
  );
}

IsoTrack.illusLayer = "structure" as const;

export type TrackMarksProps = {
  /** The lane whose TOP face the marks are printed on. */
  box: IsoBox;
  /**
   * The paint for the LEADING chevron — the entity's accent moment (D-IL6) — or `undefined` for a
   * lane that is not the one carrying it. Every other chevron is ink-muted hardware either way, so
   * a drawing with six chevrons still spends exactly one accent.
   */
  accent?: string;
  /** How many chevrons the lane carries. Three reads as travel; one reads as an arrow. */
  chevrons?: number;
};

/**
 * Three chevrons along the lane's TOP face, pointing the way the work travels, plus the two sleeper
 * rules that make it read as track rather than as a plank.
 *
 * A chevron is a `<polygon>` — a shape element, not a `<path>` — because WP 0.3's contract test
 * forbids an entity authoring a path of its own, and a chevron does not need one.
 */
export function TrackMarks({ box, accent, chevrons = 3 }: TrackMarksProps): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const marks = Array.from({ length: Math.max(1, Math.round(chevrons)) }, (_, index) => index);
  const inset = Math.min(width, height) * 0.16;
  const chevronWidth = (width - inset * 2) / (marks.length + 1.2);
  const chevronHeight = (height - inset * 2) * 0.52;
  const top = inset + (height - inset * 2 - chevronHeight) / 2;
  const step = marks.length > 1 ? (width - inset * 2 - chevronWidth) / (marks.length - 1) : 0;
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
      {marks.map((chevron) => {
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
