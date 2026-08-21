// ==================================================================================================
// Database — the crate on skids (tier 3, no entity binding)
// ==================================================================================================
// Where everything the app measures ends up: one SQLite file. Research 5 names the metaphor and
// rules out the alternative in the same breath — "the SQLite crate", NOT the cliché stacked-discs
// cylinder, which depicts a spinning platter nothing here has and which every diagram tool draws
// identically.
//
// NO DOMAIN TEXT (WP 1.3). There is no "SQLite" lettering, no table glyph and no borrowed icon: the
// crate says storage by being a crate. Lettering on an iso face is also forbidden outright by D-IL2
// — labels are screen-aligned or they do not exist — so a named crate would have broken two rules to
// say something the caption already says.
//
// NO ENTITY BINDING. The database is not a table; it is what the tables are IN, so `entity` is null
// rather than stretched to whichever table seemed representative.
//
// THE SKIDS AND THE OVERHANGING LID are what keep it out of the "box on a platform" pile that five
// of WP 1.3's eight entities would otherwise have joined. They give a profile no other component in
// the catalog has: a gap of daylight underneath, and a top wider than the body it sits on.
//
// FACELESS (D-IL17): the ribs and the seal name their faces outright. A crate has no gaze.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, type IsoFace, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `read` and `write` are the only two things anything ever does to it, and they are drawn as two
 * separate ports rather than one bus because the distinction is the interesting one in every scene
 * this will appear in — the runtime boundary is about who may write, not who may reach.
 */
export const databaseMeta: IllustrationRegistryEntry = {
  id: "database",
  title: "Database",
  entity: null,
  tier: 3,
  keywords: ["database", "storage", "persistence", "crate", "sqlite", "records", "archive"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    read: { title: "Read", side: "right", offset: 1.4 },
    write: { title: "Write", side: "left", offset: -1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "The datastore: a stout ribbed crate standing on two skids under an overhanging lid, sealed with a single band — one file, holding everything the app has measured.",
};

export type DatabaseProps = EntityComponentProps;

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const SKID_WIDTH = 0.72;
const SKID_DEPTH = 0.08;
const SKID_HEIGHT = 0.06;
const SKID_SPREAD = 0.24;

const BODY_SIDE = 0.66;
const BODY_HEIGHT = 0.34;

const LID_SIDE = 0.74;
const LID_HEIGHT = 0.1;

/** How many vertical battens wrap each visible flank. */
const RIBS = 4;

function bodyBox(footprint: number): IsoBox {
  const side = footprint * BODY_SIDE;
  return {
    cx: 0,
    cy: 0,
    w: side,
    d: side,
    z0: footprint * SKID_HEIGHT,
    h: footprint * BODY_HEIGHT,
  };
}

function lidBox(footprint: number): IsoBox {
  const body = bodyBox(footprint);
  const side = footprint * LID_SIDE;
  return { cx: 0, cy: 0, w: side, d: side, z0: body.z0 + body.h, h: footprint * LID_HEIGHT };
}

export function databaseHeightUnits(size: IllustrationSize): number {
  return footprintUnits(size) * (SKID_HEIGHT + BODY_HEIGHT + LID_HEIGHT);
}

export function Database({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: DatabaseProps): ReactElement {
  const footprint = footprintUnits(size);
  const body = bodyBox(footprint);
  const lid = lidBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={databaseMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={databaseHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      {/* Back to front: the far skid, the near skid, then the crate that stands on both. The skids
          are what leave a gap of daylight under the body, which is most of the silhouette. */}
      {[-SKID_SPREAD, SKID_SPREAD].map((cy) => (
        <IsoHousing
          key={`skid-${cy}`}
          width={footprint * SKID_WIDTH}
          depth={footprint * SKID_DEPTH}
          height={footprint * SKID_HEIGHT}
          cy={footprint * cy}
          weight="detail"
        />
      ))}
      <IsoHousing width={body.w} depth={body.d} height={body.h} z0={body.z0} />
      {(["left", "right"] as const).map((face) => (
        <Ribs key={`ribs-${face}`} box={body} face={face} />
      ))}
      <IsoHousing width={lid.w} depth={lid.d} height={lid.h} z0={lid.z0} />
      <SealBand box={lid} accent={accent} />
    </EntityRoot>
  );
}

Database.illusLayer = "structure" as const;
Database.entityHeightUnits = databaseHeightUnits;

/**
 * The battens down one flank: four vertical rules between a top and a bottom rail. Ink-muted
 * hardware on both visible faces, because a crate that is ribbed on one side and smooth on the other
 * reads as a box with a decoration on it.
 */
function Ribs({ box, face }: { box: IsoBox; face: IsoFace }): ReactElement {
  const { width, height } = faceExtent(box, face);
  const inset = Math.min(width, height) * 0.11;
  const battens = Array.from({ length: RIBS }, (_, index) => index);
  const step = (width - inset * 2) / (RIBS - 1);
  const thickness = Math.max(1.4, step * 0.16);

  return (
    <GlyphFrame face={face} box={box}>
      {(["top", "bottom"] as const).map((rail) => (
        <line
          key={`rail-${rail}`}
          x1={fmt(inset)}
          y1={fmt(rail === "top" ? inset : height - inset)}
          x2={fmt(width - inset)}
          y2={fmt(rail === "top" ? inset : height - inset)}
          strokeWidth={ILLUS_STROKE_DETAIL_FINE}
          style={{ stroke: "var(--illus-ink-muted)" }}
        />
      ))}
      {battens.map((batten) => (
        <rect
          key={`batten-${batten}`}
          data-illus-mark="rib"
          x={fmt(inset + batten * step - thickness / 2)}
          y={fmt(inset)}
          width={fmt(thickness)}
          height={fmt(height - inset * 2)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}

/**
 * The seal band across the lid's TOP face — the entity's single accent moment (D-IL6). A crate is
 * either sealed or it is open, so one band says the one thing worth saying about a datastore at a
 * glance, and it says it without a lock, a label or a word.
 */
function SealBand({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.1;
  const thickness = Math.max(3, height * 0.14);

  return (
    <GlyphFrame face="top" box={box}>
      <rect
        data-illus-mark="seal"
        x={fmt(inset)}
        y={fmt(height / 2 - thickness / 2)}
        width={fmt(width - inset * 2)}
        height={fmt(thickness)}
        rx={fmt(thickness / 2)}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
