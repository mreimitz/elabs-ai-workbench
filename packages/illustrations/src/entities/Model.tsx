// ==================================================================================================
// Model — the chip the agent thinks with (tier 1, no domain binding)
// ==================================================================================================
// A processor package on a low plinth: a flat solid whose TOP face carries the contact rows and one
// accent die. Research 5 calls it "the chip/badge variant of agent", and the difference from `agent`
// is the point — an agent is a character with a gaze, a model is a part you socket into one.
//
// NO `entity` BINDING, deliberately. WP 1.1's table suggests omitting it, and the reason is worth
// keeping: the only table that looks like it fits is `model_pricing`, and that is PRICING — a
// per-model rate card, not the model. Binding this drawing to it would make the assistant's catalog
// search answer "which illustration depicts a model?" with a row about dollars. `entity` is nullable
// precisely so a component can decline, and `searchIllustrations` already handles the null.
//
// Both variants are the same solid at the same height. `heightUnits` is what every port anchor is
// measured against (D-IL7), so a variant that grew would silently move `tokens-out`; what changes
// between `hosted` and `local` is the small companion block on the plinth, which is always shorter
// than the chip and therefore never the tallest thing here.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `context-in` and `tokens-out` are the semantic pair a scene actually draws to and from — what goes
 * into a model is context, what comes out is tokens. Both sit clear of the plain `left`/`right`
 * cardinals by an offset, so the gallery's port overlay does not stack two dots on one point. The
 * offset is 1.4 units, which is inside the footprint at every size (the smallest, `s`, has a
 * half-extent of 2).
 */
export const modelMeta: IllustrationRegistryEntry = {
  id: "model",
  title: "Model",
  entity: null,
  tier: 1,
  keywords: ["model", "chip", "inference", "context window", "weights", "hosted", "on-device"],
  variants: ["hosted", "local"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "context-in": { title: "Context in", side: "left", offset: -1.4 },
    "tokens-out": { title: "Tokens out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A model: a processor package on a low plinth, contact rows and a lit die on its top face, with a companion block that says whether it is served remotely or runs on the machine.",
};

export const MODEL_VARIANTS = ["hosted", "local"] as const;
export type ModelVariant = (typeof MODEL_VARIANTS)[number];

export type ModelProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): ModelVariant {
  return MODEL_VARIANTS.includes(variant as ModelVariant) ? (variant as ModelVariant) : "hosted";
}

/** One tier, because a chip sits on a board rather than on a monument. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const CHIP_WIDTH = 0.56;
const CHIP_HEIGHT = 0.17;

/** Where the companion block stands: outside the chip's half-extent, inside the plinth's. */
const COMPANION_OFFSET = 0.34;
const COMPANION_WIDTH = { hosted: 0.22, local: 0.16 } as const;
const COMPANION_HEIGHT = { hosted: 0.06, local: 0.14 } as const;

function chipBox(footprint: number): IsoBox {
  const side = footprint * CHIP_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * CHIP_HEIGHT };
}

export function modelHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * CHIP_HEIGHT;
}

export function Model({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ModelProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const chip = chipBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={modelMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={modelHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={chip.w} depth={chip.d} height={chip.h} z0={chip.z0} />
      <Companion footprint={footprint} variant={resolved} />
      <ChipFace box={chip} accent={accent} />
    </EntityRoot>
  );
}

Model.illusLayer = "structure" as const;
Model.entityHeightUnits = modelHeightUnits;

/**
 * The package's printed top: a lit die in the middle (the entity's ONE accent moment, D-IL6) with a
 * row of contacts above and below it. The contacts are ink-muted hardware — lighting them too would
 * turn one station into eleven places for the eye to go.
 *
 * A model is FACELESS, so this names the `top` face outright rather than `gaze` (D-IL17): a chip has
 * no front, and a request to face downstream must leave it exactly where it is.
 */
function ChipFace({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.12;
  const die = Math.min(width, height) * 0.34;
  const carrier = die * 1.62;
  const padWidth = width * 0.15;
  const padHeight = Math.max(2, height * 0.085);
  const pads = [0, 1, 2, 3];
  const padGap = (width - inset * 2 - padWidth) / (pads.length - 1);

  return (
    <GlyphFrame face="top" box={box}>
      {/* The carrier the die is seated in — one thin frame, drawn CLOSE to the die. Drawn out at the
          package's own edge instead it would run parallel to the contact rows at a similar spacing,
          and the whole top face would read as a dashed border rather than as a chip. */}
      <rect
        x={fmt((width - carrier) / 2)}
        y={fmt((height - carrier) / 2)}
        width={fmt(carrier)}
        height={fmt(carrier)}
        rx={fmt(carrier * 0.08)}
        fill="none"
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        style={{ stroke: "var(--illus-ink-muted)" }}
      />
      <rect
        x={fmt((width - die) / 2)}
        y={fmt((height - die) / 2)}
        width={fmt(die)}
        height={fmt(die)}
        rx={fmt(die * 0.12)}
        style={{ fill: accent }}
      />
      {pads.flatMap((pad) =>
        (["north", "south"] as const).map((row) => (
          <rect
            key={`pad-${row}-${pad}`}
            x={fmt(inset + pad * padGap)}
            y={fmt(row === "north" ? inset : height - inset - padHeight)}
            width={fmt(padWidth)}
            height={fmt(padHeight)}
            rx={fmt(padHeight / 2)}
            style={{ fill: "var(--illus-ink-muted)" }}
          />
        )),
      )}
    </GlyphFrame>
  );
}

/**
 * The one thing the variant changes: a low, wide patch plate for `hosted` (the model is served from
 * somewhere else and this is the socket it arrives through), or a taller storage block for `local`
 * (the weights are on the machine). Both are shorter than the chip, so neither moves the entity's
 * declared height and neither moves a port.
 */
function Companion({
  footprint,
  variant,
}: {
  footprint: number;
  variant: ModelVariant;
}): ReactElement {
  const side = footprint * COMPANION_WIDTH[variant];
  const at = footprint * COMPANION_OFFSET;
  return (
    <IsoHousing
      width={side}
      depth={side}
      height={footprint * COMPANION_HEIGHT[variant]}
      cx={at}
      cy={at}
      z0={FLOOR}
      weight="detail"
    />
  );
}
