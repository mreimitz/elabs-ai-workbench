// ==================================================================================================
// Owner / User — the person the bench belongs to (tier 3, abstract)
// ==================================================================================================
// The human in the loop: whoever registers a server, launches a run, reads a report and decides what
// happens next. Research 5 lists it in the tier-3 platform cast beside `assistant`.
//
// THE HARD PART IS THAT THREE OTHER ENTITIES ARE ALSO A STANDING FIGURE. `agent`, `validator` and
// `assistant` all draw one, so "a person" is not a silhouette — it is the silhouette the cast
// already has three of. What separates this one is what the figure is STANDING AT:
//
//   agent ......... two-tier plinth, antenna spike above the head
//   validator ..... two-tier plinth, shield held on the gaze face
//   assistant ..... flat pad, short figure, back panel rising ABOVE the head
//   owner ......... ONE low tier, full-height figure, and a wide CONSOLE in front of it
//
// The console is the whole idea. It is a separate ground-standing solid spanning most of the
// footprint at waist height, so at `s` — where a spike is a pixel and a shield is a smudge — the
// reading is still "somebody at a workstation", which none of the other three can be mistaken for.
//
// TWO THINGS THE "LOOK AT IT" LOOP CHANGED, RECORDED BECAUSE THE GATE CAUGHT NEITHER:
//
//   1. The console started at 0.22 of the footprint tall and 0.2 deep, and it BURIED the figure —
//      rendered, it read as two stacked boxes on a pad, not a person at a desk. It is now 0.13/0.13
//      and pushed further out, so the whole torso clears it.
//   2. It was drawn with `visor={false}`, on the theory that the owner should be the one face in the
//      catalog that is not a screen. That idea did not survive being looked at: without the visor
//      the head is an anonymous cube, and the drawing read as equipment. A shoulder yoke was tried
//      as a replacement human-tell and was worse — wide enough to read, it occluded the head. The
//      figure therefore keeps the shared visor, and the console carries the identity alone, which
//      is what the design claimed in the first place. Fighting a primitive into a shape it was not
//      built for is the mirror of "a primitive that abstracts nothing is a finding".
//
// IT HAS A FACE, so it declares `facing` and honours it (D-IL17): the console mounts on the GAZE
// side, which means the owner is looking AT the console, and in a left-to-right process scene both
// of them turn to meet the incoming work.

import type {
  IllustrationFacing,
  IllustrationRegistryEntry,
  IllustrationSize,
} from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame, resolveGlyphFace } from "../primitives/GlyphFrame.js";
import { IsoFigure, figureBoxes } from "../primitives/IsoFigure.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `report-in` -> `intent-out` is this entity's sentence, and it is the mirror of every worker in the
 * catalog: a validator takes a subject and emits a verdict, but the owner takes the REPORT and emits
 * the INTENT — the loop closes on a person. Both sit at the same 1.4-unit offset the rest of the
 * cast uses, clear of the plain cardinals, so the port overlay never stacks two dots on one point.
 *
 * `entity` is `null` — deliberately. The owner is not a row: this app is single-owner and has no
 * accounts table, and binding a drawing to a table that does not exist would be a lie the gallery
 * would repeat. (Team-server accounts are planned, not built; when they land, this gets a binding.)
 */
export const ownerMeta: IllustrationRegistryEntry = {
  id: "owner",
  title: "Owner / User",
  entity: null,
  tier: 3,
  keywords: ["owner", "user", "operator", "human", "person", "console", "workstation"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "report-in": { title: "Report in", side: "left", offset: -1.4 },
    "intent-out": { title: "Intent out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "The owner: a figure standing on a single low tier behind a wide console that spans the front of its pad, turned toward the work.",
};

export type OwnerProps = EntityComponentProps;

/** One tier, not the two every machine station stands on — the owner is at floor level with it. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales. The height and depth are
// the two numbers the "look at it" loop moved (see the header) — a taller console hides the figure.
const CONSOLE_SPAN = 0.66;
const CONSOLE_DEPTH = 0.13;
const CONSOLE_HEIGHT = 0.13;
const CONSOLE_OFFSET = 0.34;

/**
 * The console box, on the figure's gaze side.
 *
 * `facing` moves it between the two iso faces and CANNOT move the entity's height (the console is
 * well below the crown), so no connector anchored to `top` shifts when a scene turns the owner
 * around — the D-IL7 invariant the height function's own note is about.
 */
function consoleBox(footprint: number, facing: IllustrationFacing): IsoBox {
  const span = footprint * CONSOLE_SPAN;
  const depth = footprint * CONSOLE_DEPTH;
  const offset = footprint * CONSOLE_OFFSET;
  const onLeftFace = resolveGlyphFace("gaze", facing) === "left";
  return {
    cx: onLeftFace ? 0 : offset,
    cy: onLeftFace ? offset : 0,
    w: onLeftFace ? span : depth,
    d: onLeftFace ? depth : span,
    z0: FLOOR,
    h: footprint * CONSOLE_HEIGHT,
  };
}

/**
 * The FIGURE decides the height, not the console — the console tops out around waist height.
 *
 * LOAD-BEARING: `EntityRoot` anchors every port against this number, so it must not move for a
 * reason a connector is not meant to follow. It depends on the footprint alone; `facing` and `state`
 * cannot touch it.
 */
export function ownerHeightUnits(size: IllustrationSize): number {
  return figureBoxes(footprintUnits(size), FLOOR).crown;
}

/** Where the console's own top surface sits — exported so a scene can rest something on it later. */
export function ownerConsoleHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * CONSOLE_HEIGHT;
}

export function Owner({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: OwnerProps): ReactElement {
  const footprint = footprintUnits(size);
  const desk = consoleBox(footprint, facing);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={ownerMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={ownerHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      {/* The figure is painted BEFORE the console, so the console stands in front of it. */}
      <IsoFigure footprint={footprint} floor={FLOOR} />
      <IsoHousing
        width={desk.w}
        depth={desk.d}
        height={desk.h}
        cx={desk.cx}
        cy={desk.cy}
        z0={desk.z0}
      />
      <ConsoleStrip box={desk} accent={accent} />
    </EntityRoot>
  );
}

// Attached AFTER the function, not inside it — a function declaration cannot carry statics in its
// own body, and every entity in this package does it here, in this order.
Owner.illusLayer = "structure" as const;
Owner.entityHeightUnits = ownerHeightUnits;

/**
 * The lit strip along the console's TOP face: the entity's single accent moment (D-IL6).
 *
 * It is on the console rather than on the person for the same reason the assistant's indicator is on
 * its dock — `IsoFigure` deliberately spends no accent just by standing there, so two figures side by
 * side never cost two accents. What is lit here is the WORK, which is also the honest reading: the
 * owner is not the thing that is running.
 */
function ConsoleStrip({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = width * 0.12;
  const thickness = Math.max(2.2, height * 0.3);

  return (
    <GlyphFrame face="top" box={box}>
      <rect
        data-illus-mark="console-strip"
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
