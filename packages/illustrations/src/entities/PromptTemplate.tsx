// ==================================================================================================
// PromptTemplate — a stencil plate (tier 2, entity `mcp_prompt_scans`)
// ==================================================================================================
// What an MCP server advertises through `prompts/list`: not a message, but the FORM a message is
// stamped from — a name, a set of arguments, and the shape they are poured into.
//
// THE ONE THING THIS DRAWING HAS TO DO is be visibly not the same object as WP 1.1's `prompt`, and
// the two are separated on the axis that reads fastest in isometric — POSTURE. `prompt` is a board
// raised on a display post: it stands up, it is 4.14 units tall at `m`, and it speaks. This lies
// FLAT on a ground pad at 1.24 units, and it has holes cut through it. A stencil is not a smaller
// speech bubble; it is a plate you put something else through. At a glance across a scene the two
// silhouettes have nothing in common, which is the test that matters.
//
// The holes are the argument slots — the parts of the form the caller fills — and one of them
// carries a filled block, the value being dropped in. That is the entity's single accent moment,
// and it is chosen deliberately: the accent goes on what MOVES, not on the plate that stays still.
//
// FACELESS (D-IL17): the cut windows name the `top` face outright, because a plate lying flat is
// read from above and has no front at all.

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
 * `fill-in` and `emit` are the two halves of what a template is for — arguments go in, a rendered
 * message comes out. `fill-in` is on the `top` side because a stencil is filled from above, which is
 * also what keeps it clear of `emit`; both carry an offset so the gallery's port overlay does not
 * stack them on the plain cardinals. 1.4 is inside the footprint at every size (`s`'s half-extent
 * is 2).
 */
export const promptTemplateMeta: IllustrationRegistryEntry = {
  id: "prompt-template",
  title: "Prompt Template",
  entity: "mcp_prompt_scans",
  tier: 2,
  keywords: ["prompt template", "stencil", "form", "arguments", "placeholder", "stamp", "plate"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "fill-in": { title: "Fill in", side: "top", offset: -1.4 },
    emit: { title: "Emit", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A prompt template: a stencil plate lying flat on a ground pad, argument slots cut through it and one of them filled — the form a prompt is stamped from, never the prompt itself.",
};

export type PromptTemplateProps = EntityComponentProps;

/** One tier: a plate lies on the bench. Standing it on a plinth would make it a sign. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const PLATE_WIDTH = 0.7;
/** Thin, and that is the whole silhouette argument against `prompt` — see the header. */
const PLATE_HEIGHT = 0.09;

function plateBox(footprint: number): IsoBox {
  const side = footprint * PLATE_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * PLATE_HEIGHT };
}

export function promptTemplateHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * PLATE_HEIGHT;
}

export function PromptTemplate({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: PromptTemplateProps): ReactElement {
  const footprint = footprintUnits(size);
  const plate = plateBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={promptTemplateMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={promptTemplateHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={plate.w} depth={plate.d} height={plate.h} z0={plate.z0} />
      <StencilCuts box={plate} accent={accent} />
    </EntityRoot>
  );
}

PromptTemplate.illusLayer = "structure" as const;
PromptTemplate.entityHeightUnits = promptTemplateHeightUnits;

/**
 * The plate's top face: three slots cut through it and four corner registration marks.
 *
 * The slots are drawn SUNKEN — the sunken surface token, outlined at the finest weight — because a
 * cut reads as a cut only if what shows through it is darker than the plate. Printing them in ink
 * instead would make this a page of text, which is `skill`'s drawing, and the two would collide.
 *
 * One slot carries a filled block: the argument that has been supplied. Exactly one, which is the
 * accent budget (D-IL6) and also the more truthful picture — a template with every slot filled is
 * no longer a template.
 */
function StencilCuts({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.16;
  const innerWidth = width - inset * 2;
  const slots = [0, 1, 2];
  const slotPitch = (height - inset * 2) / slots.length;
  const slotHeight = slotPitch * 0.54;
  const slotWidths = [1, 0.72, 0.86];
  const mark = Math.max(1.6, Math.min(width, height) * 0.05);
  /** The supplied argument sits inside the first slot, inset so the cut still reads around it. */
  const fillInset = Math.max(0.8, slotHeight * 0.22);

  return (
    <GlyphFrame face="top" box={box}>
      {slots.map((slot) => (
        <rect
          key={`slot-${slot}`}
          data-illus-mark="argument-slot"
          x={fmt(inset)}
          y={fmt(inset + slot * slotPitch + (slotPitch - slotHeight) / 2)}
          width={fmt(innerWidth * (slotWidths[slot] as number))}
          height={fmt(slotHeight)}
          rx={fmt(Math.min(2.4, slotHeight * 0.3))}
          strokeWidth={ILLUS_STROKE_DETAIL_FINE}
          style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink-muted)" }}
        />
      ))}
      <rect
        data-illus-mark="filled-argument"
        x={fmt(inset + fillInset)}
        y={fmt(inset + (slotPitch - slotHeight) / 2 + fillInset)}
        width={fmt(innerWidth * (slotWidths[0] as number) * 0.52 - fillInset * 2)}
        height={fmt(slotHeight - fillInset * 2)}
        rx={fmt(Math.min(1.8, (slotHeight - fillInset * 2) / 2))}
        style={{ fill: accent }}
      />
      {(
        [
          [inset * 0.42, inset * 0.42],
          [width - inset * 0.42 - mark, inset * 0.42],
          [inset * 0.42, height - inset * 0.42 - mark],
          [width - inset * 0.42 - mark, height - inset * 0.42 - mark],
        ] as const
      ).map(([x, y]) => (
        <rect
          key={`registration-${x}-${y}`}
          data-illus-mark="registration"
          x={fmt(x)}
          y={fmt(y)}
          width={fmt(mark)}
          height={fmt(mark)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}
