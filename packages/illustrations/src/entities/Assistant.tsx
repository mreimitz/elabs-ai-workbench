// ==================================================================================================
// Assistant — a docked companion (tier 3, entity `assistant_threads`)
// ==================================================================================================
// The app's own assistant: the right-hand dock that operates the current page, and the full-page Hub
// it relabelled itself against. Research 5 calls it a "docked companion", and the DOCK is what makes
// it a different entity from `agent` rather than a second drawing of one.
//
// IT REUSES `IsoFigure`, which is why that primitive exists. WP 1.1 extracted the standing figure so
// `Validator` could carry a shield without copying a robot, and its header says outright that the
// extraction "pays forward — research 5's tier-3 cast is `assistant` and `owner/user`, which are the
// same silhouette again". This is that payment: the torso, neck, head and visor are the primitive's,
// unmodified, at a smaller scale.
//
// DISTINGUISHABLE FROM `agent` AT `s`, WHICH WAS THE HARD PART. WP 1.3 is explicit that if the only
// difference is a detail that vanishes at the small footprint, the drawing is wrong. So the
// difference is not a detail — it is three things, all of them silhouette:
//
//   1. The figure is SHORTER (68% of the footprint an `agent` figure gets), so it reads as a
//      companion rather than a peer.
//   2. It stands on a FLAT PAD, not the two-tier stepped plinth every upright station uses.
//   3. A BACK PANEL rises well above its head. At `m` the head crowns at 3.26 units and the panel
//      tops out at 4.56 — the drawing is a bust in a niche, where `agent` is a figure with an
//      antenna spike on a monument.
//
// Verified at `s` specifically, by rendering the two side by side and looking.
//
// IT HAS A FACE (D-IL17), so it declares `facing` and honours it — the visor rides `IsoFigure`'s
// `gaze` face. The `hub` variant's second panel sits on the far side opposite the default gaze, so
// the enclosure stays behind the companion rather than in front of it.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoFigure, figureHeightUnits } from "../primitives/IsoFigure.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `ask-in` and `answer-out` are the entity's whole sentence, and the two are deliberately on
 * opposite flanks: an assistant is asked something and answers, which is not the same shape as a
 * store that is read from and written to.
 */
export const assistantMeta: IllustrationRegistryEntry = {
  id: "assistant",
  title: "Assistant",
  entity: "assistant_threads",
  tier: 3,
  keywords: ["assistant", "companion", "dock", "hub", "chat", "thread", "co-pilot"],
  variants: ["dock", "hub"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "ask-in": { title: "Ask in", side: "left", offset: -1.4 },
    "answer-out": { title: "Answer out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "The assistant: a companion figure standing on a flat pad inside a back panel that rises above its head — one panel for the page dock, a second for the full workspace.",
};

export const ASSISTANT_VARIANTS = ["dock", "hub"] as const;
export type AssistantVariant = (typeof ASSISTANT_VARIANTS)[number];

export type AssistantProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): AssistantVariant {
  return ASSISTANT_VARIANTS.includes(variant as AssistantVariant)
    ? (variant as AssistantVariant)
    : "dock";
}

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const PAD_SIDE = 0.78;
const PAD_HEIGHT = 0.16;
const PANEL_SPAN = 0.62;
const PANEL_THICKNESS = 0.1;
const PANEL_HEIGHT = 0.6;

/**
 * How much of the footprint the figure gets. `agent` gives its figure the whole footprint; giving
 * this one 68% is the first of the three things that keep the two apart at `s`.
 */
const FIGURE_SCALE = 0.68;

function padBox(footprint: number): IsoBox {
  const side = footprint * PAD_SIDE;
  return { cx: 0, cy: 0, w: side, d: side, z0: 0, h: footprint * PAD_HEIGHT };
}

function panelBox(footprint: number, along: "x" | "y"): IsoBox {
  const offset = (footprint * PAD_SIDE) / 2 - (footprint * PANEL_THICKNESS) / 2;
  const span = footprint * PANEL_SPAN;
  const thickness = footprint * PANEL_THICKNESS;
  return {
    cx: along === "x" ? 0 : -offset,
    cy: along === "x" ? -offset : 0,
    w: along === "x" ? span : thickness,
    d: along === "x" ? thickness : span,
    z0: footprint * PAD_HEIGHT,
    h: footprint * PANEL_HEIGHT,
  };
}

/** Where the companion's own head reaches — below the panel, which is what makes it a niche. */
export function assistantCrownUnits(size: IllustrationSize): number {
  const footprint = footprintUnits(size);
  return figureHeightUnits(footprint * FIGURE_SCALE, footprint * PAD_HEIGHT);
}

/**
 * The PANEL decides the height, in both variants: `hub` adds a second panel of exactly the same
 * height rather than a taller one, so switching a scene between the two cannot move a connector
 * anchored to `top` (D-IL7).
 */
export function assistantHeightUnits(size: IllustrationSize): number {
  return footprintUnits(size) * (PAD_HEIGHT + PANEL_HEIGHT);
}

export function Assistant({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: AssistantProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const pad = padBox(footprint);
  const backPanel = panelBox(footprint, "x");
  const sidePanel = panelBox(footprint, "y");
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={assistantMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={assistantHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoHousing width={pad.w} depth={pad.d} height={pad.h} z0={pad.z0} />
      {/* Both panels are behind the figure, so they are painted before it. `hub` turns the single
          back panel into a corner — a wider presence for the workspace, the same height. */}
      {resolved === "hub" ? (
        <IsoHousing
          width={sidePanel.w}
          depth={sidePanel.d}
          height={sidePanel.h}
          cx={sidePanel.cx}
          cy={sidePanel.cy}
          z0={sidePanel.z0}
          weight="detail"
        />
      ) : null}
      <IsoHousing
        width={backPanel.w}
        depth={backPanel.d}
        height={backPanel.h}
        cx={backPanel.cx}
        cy={backPanel.cy}
        z0={backPanel.z0}
      />
      <DockIndicator box={backPanel} accent={accent} />
      <IsoFigure footprint={footprint * FIGURE_SCALE} floor={footprint * PAD_HEIGHT} />
    </EntityRoot>
  );
}

Assistant.illusLayer = "structure" as const;
Assistant.entityHeightUnits = assistantHeightUnits;

/**
 * The dock's live indicator, on the back panel's TOP face: one bar, and the entity's single accent
 * moment (D-IL6). It is on the panel rather than on the figure on purpose — `IsoFigure` deliberately
 * spends no accent just by standing there, so that two figures side by side do not cost two accents,
 * and an assistant's light belongs to the DOCK it is sitting in.
 */
function DockIndicator({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = width * 0.14;
  const thickness = Math.max(2.4, height * 0.34);

  return (
    <GlyphFrame face="top" box={box}>
      <rect
        data-illus-mark="dock-indicator"
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
