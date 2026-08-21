// ==================================================================================================
// DiffCompare — a split pedestal (tier 2, no entity binding)
// ==================================================================================================
// Comparison, as a shape. The app compares in several places — scan against scan, server against
// server, run against run, suite against suite — and none of them is a table an operator would name,
// so this entity binds to NO table. WP 1.3 is explicit that a binding is omitted rather than
// stretched, and `mcp_scans` would have made this "the scan comparison" when it is not.
//
// THE SPLIT IS THE ENTITY. Research 5 calls it a "split pedestal", and the drawing takes the split
// seriously enough to skip `IsoPlatform` altogether: the plinth every other station stands ON is
// here the thing being drawn, cut in two along the flow and the halves staggered so that the gap
// between them is the first thing the eye finds. A comparison drawn as two objects sitting on one
// plinth would be two objects; drawn as one plinth in two pieces, it is a comparison.
//
// THE VARIANT IS THE OTHER HALF'S SHAPE, not its colour (D-IL5/D-IL6 would not have given a colour
// anyway). `two-way` sets two like-for-like specimens against each other — a scan against a scan.
// `baseline` flattens the far one into a datum plate: a reference to measure against rather than a
// peer to weigh. Both variants stand exactly as tall, so the `delta-out` anchor cannot move when a
// scene switches between them (D-IL7).
//
// FACELESS (D-IL17): the delta mark names the `top` face outright. A pedestal has no gaze.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * The two subjects arrive on the two iso FACES the ports are already named for — `left-in` on the
 * left face, `right-in` on the right — so a scene never has to explain which is which; the geometry
 * says it. The delta leaves from the TOP, because it is not a third subject travelling on: it is
 * what the comparison produced.
 */
export const diffCompareMeta: IllustrationRegistryEntry = {
  id: "diff-compare",
  title: "Diff / Compare",
  entity: null,
  tier: 2,
  keywords: ["diff", "compare", "delta", "baseline", "side by side", "regression", "pedestal"],
  variants: ["two-way", "baseline"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "left-in": { title: "Left subject in", side: "left", offset: -1.4 },
    "right-in": { title: "Right subject in", side: "right", offset: -1.4 },
    "delta-out": { title: "Delta out", side: "top", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A comparison: one pedestal cut in two and staggered, a specimen standing on each half — or a flat datum plate on the far half when one side is the baseline.",
};

export const DIFF_COMPARE_VARIANTS = ["two-way", "baseline"] as const;
export type DiffCompareVariant = (typeof DIFF_COMPARE_VARIANTS)[number];

export type DiffCompareProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): DiffCompareVariant {
  return DIFF_COMPARE_VARIANTS.includes(variant as DiffCompareVariant)
    ? (variant as DiffCompareVariant)
    : "two-way";
}

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const HALF_WIDTH = 0.88;
const HALF_DEPTH = 0.38;
const HALF_HEIGHT = 0.34;
/** How far each half sits from the centre line, and how far it is staggered along the flow. */
const HALF_SPREAD = 0.24;
const HALF_STAGGER = 0.06;

const SPECIMEN_WIDTH = 0.26;
const SPECIMEN_DEPTH = 0.24;
const SPECIMEN_HEIGHT = 0.22;
/** The baseline datum: wider, and barely off the plinth — a reference, not a peer. */
const DATUM_WIDTH = 0.46;
const DATUM_HEIGHT = 0.05;

type Side = "far" | "near";

const SIGN: Record<Side, number> = { far: -1, near: 1 };

function halfBox(footprint: number, side: Side): IsoBox {
  return {
    cx: footprint * HALF_STAGGER * SIGN[side],
    cy: footprint * HALF_SPREAD * SIGN[side],
    w: footprint * HALF_WIDTH,
    d: footprint * HALF_DEPTH,
    z0: 0,
    h: footprint * HALF_HEIGHT,
  };
}

function specimenBox(footprint: number, side: Side, datum: boolean): IsoBox {
  const half = halfBox(footprint, side);
  return {
    cx: half.cx,
    cy: half.cy,
    w: footprint * (datum ? DATUM_WIDTH : SPECIMEN_WIDTH),
    d: footprint * SPECIMEN_DEPTH,
    z0: half.z0 + half.h,
    h: footprint * (datum ? DATUM_HEIGHT : SPECIMEN_HEIGHT),
  };
}

/**
 * The NEAR specimen decides the height, and it is a full block in both variants. That is what keeps
 * `baseline` and `two-way` exactly as tall: flattening the far half into a datum changes the
 * drawing, never the anchor.
 */
export function diffCompareHeightUnits(size: IllustrationSize): number {
  const footprint = footprintUnits(size);
  return footprint * (HALF_HEIGHT + SPECIMEN_HEIGHT);
}

export function DiffCompare({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: DiffCompareProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const datum = resolved === "baseline";
  const farSpecimen = specimenBox(footprint, "far", datum);
  const nearSpecimen = specimenBox(footprint, "near", false);

  return (
    <EntityRoot
      meta={diffCompareMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={diffCompareHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      {/* Back to front: the far half and everything on it, then the near half and its specimen. */}
      <Half box={halfBox(footprint, "far")} />
      <IsoHousing
        width={farSpecimen.w}
        depth={farSpecimen.d}
        height={farSpecimen.h}
        cx={farSpecimen.cx}
        cy={farSpecimen.cy}
        z0={farSpecimen.z0}
        weight="detail"
      />
      {datum ? <DatumRules box={farSpecimen} /> : null}
      <Half box={halfBox(footprint, "near")} />
      <IsoHousing
        width={nearSpecimen.w}
        depth={nearSpecimen.d}
        height={nearSpecimen.h}
        cx={nearSpecimen.cx}
        cy={nearSpecimen.cy}
        z0={nearSpecimen.z0}
        weight="detail"
      />
      <DeltaMark box={nearSpecimen} accent={accent} />
    </EntityRoot>
  );
}

DiffCompare.illusLayer = "structure" as const;
DiffCompare.entityHeightUnits = diffCompareHeightUnits;

/** One half of the cut plinth. Plain: the interest is in the gap between the two, not in either. */
function Half({ box }: { box: IsoBox }): ReactElement {
  return (
    <IsoHousing
      width={box.w}
      depth={box.d}
      height={box.h}
      cx={box.cx}
      cy={box.cy}
      z0={box.z0}
    />
  );
}

/**
 * The datum plate's graduation rules, on its TOP face — the marks that make a flat plate read as a
 * reference surface rather than as a squashed specimen. Ink-muted throughout: a baseline is what you
 * measure against, and the thing worth looking at is the delta on the other half.
 */
function DatumRules({ box }: { box: IsoBox }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.14;
  const rules = [0, 1, 2, 3, 4];
  const step = (width - inset * 2) / (rules.length - 1);

  return (
    <GlyphFrame face="top" box={box}>
      {rules.map((rule) => (
        <line
          key={`rule-${rule}`}
          x1={fmt(inset + rule * step)}
          y1={fmt(inset)}
          x2={fmt(inset + rule * step)}
          y2={fmt(inset + (height - inset * 2) * (rule % 2 === 0 ? 1 : 0.5))}
          strokeWidth={ILLUS_STROKE_DETAIL_FINE}
          style={{ stroke: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}

/**
 * The delta: a triangle on the near specimen's TOP face, and the entity's single accent moment
 * (D-IL6). A triangle is the one mark that means "difference" without borrowing a glyph from an icon
 * set, and it is a `<polygon>` rather than a `<path>` — WP 0.3's contract test forbids an entity
 * authoring a path of its own.
 */
function DeltaMark({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const side = Math.min(width, height) * 0.52;
  const cx = width / 2;
  const cy = height / 2;

  return (
    <GlyphFrame face="top" box={box}>
      <polygon
        data-illus-mark="delta"
        points={[
          [cx, cy - side / 2],
          [cx + side / 2, cy + side / 2],
          [cx - side / 2, cy + side / 2],
        ]
          .map(([x, y]) => `${fmt(x as number)},${fmt(y as number)}`)
          .join(" ")}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
