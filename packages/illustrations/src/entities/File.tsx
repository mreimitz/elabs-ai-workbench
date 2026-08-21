// ==================================================================================================
// File — a sheet stack on a plinth (tier 2, entity `test_attachments`)
// ==================================================================================================
// What a test carries with it: the images and documents attached to a prompt, metered into the run's
// context like everything else. Research 5 calls it a "sheet stack", and WP 1.2 gives it two
// variants — `single` for one attachment, `stack` for several.
//
// It is drawn on WP 1.2's `IsoSheetStack` primitive, and so is `skill`. The two are the same shape
// and must not be the same picture, so they differ on the one parameter that primitive exposes:
//
//   `skill`  a BOUND document — sheets flush, laminated, a manifest printed on the top one.
//   `file`   a PILE — sheets fanned along both ground axes, a clip across the top and a folded
//            corner. Nobody laminates their attachments.
//
// Both variants stand exactly as tall, which is load-bearing rather than tidy: `heightUnits` is what
// every port anchor is measured against (D-IL7), so a `single` file and a `stack` must be the same
// height or `attach` would jump in a scene the moment somebody added a second attachment. The
// primitive divides a FIXED slab into sheets for exactly that reason.
//
// FACELESS (D-IL17): the clip names the `top` face outright. A pile of paper is read from above.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { IsoSheetStack, sheetStackBoxes } from "../primitives/IsoSheetStack.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `attach` is the one semantic port, and it is on the `top` side rather than the `right` side every
 * other outgoing port in the catalog uses. That is deliberate: a file does not SEND anything, it is
 * carried — the joint is where a clip bites the top edge, not where a data flow leaves. The 1.8-unit
 * offset keeps it clear of the plain `top` cardinal in the gallery's overlay, and stays inside the
 * footprint at every size (`s`'s half-extent is 2).
 */
export const fileMeta: IllustrationRegistryEntry = {
  id: "file",
  title: "File",
  entity: "test_attachments",
  tier: 2,
  keywords: ["file", "attachment", "sheet", "upload", "document", "multimodal", "pile"],
  variants: ["single", "stack"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    attach: { title: "Attach", side: "top", offset: 1.8 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A file: sheets on a plinth under a clip, one on the single variant and a fanned pile on the stack one — what a test carries into a run alongside its prompt.",
};

export const FILE_VARIANTS = ["single", "stack"] as const;
export type FileVariant = (typeof FILE_VARIANTS)[number];

export type FileProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): FileVariant {
  return FILE_VARIANTS.includes(variant as FileVariant) ? (variant as FileVariant) : "single";
}

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const SLAB_WIDTH = 0.58;
const SLAB_HEIGHT = 0.14;

/** How many sheets each variant divides the slab into. */
const SHEETS: Record<FileVariant, number> = { single: 1, stack: 4 };

/** How far each sheet is nudged from the one below it, as a share of the slab's width. */
const FAN = 0.075;

function slabBox(footprint: number): IsoBox {
  const side = footprint * SLAB_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * SLAB_HEIGHT };
}

export function fileHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * SLAB_HEIGHT;
}

export function File({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: FileProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const slab = slabBox(footprint);
  const sheets = SHEETS[resolved];
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  // The clip is printed on whichever sheet ends up on top, which the fan moves — so the top box is
  // read back from the primitive rather than recomputed here.
  const top = sheetStackBoxes(slab, sheets, { staggerFraction: FAN }).top;

  return (
    <EntityRoot
      meta={fileMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={fileHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoSheetStack box={slab} sheets={sheets} staggerFraction={FAN} />
      <ClippedSheet box={top} accent={accent} />
    </EntityRoot>
  );
}

File.illusLayer = "structure" as const;
File.entityHeightUnits = fileHeightUnits;

/**
 * The top sheet's face: a folded corner, one body rule, and the clip across the leading edge. The
 * clip is the entity's ONE accent moment (D-IL6) — it is what makes a sheet an ATTACHMENT rather
 * than a page, which is the whole distinction between this entity and `skill`.
 */
function ClippedSheet({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.16;
  const fold = Math.min(width, height) * 0.26;
  const clipWidth = Math.max(2.4, Math.min(width, height) * 0.09);
  const clipHeight = height * 0.4;
  const ruleHeight = Math.max(1.2, Math.min(width, height) * 0.055);

  return (
    <GlyphFrame face="top" box={box}>
      {/* The dog-ear: a triangle at the far corner, the only mark that says "paper" on its own. */}
      <polygon
        data-illus-mark="corner-fold"
        points={[
          [width - fold, 0],
          [width, fold],
          [width - fold, fold],
        ]
          .map(([x, y]) => `${fmt(x as number)},${fmt(y as number)}`)
          .join(" ")}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        strokeLinejoin="round"
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink-muted)" }}
      />
      <rect
        x={fmt(inset)}
        y={fmt(height - inset - ruleHeight)}
        width={fmt((width - inset * 2) * 0.62)}
        height={fmt(ruleHeight)}
        style={{ fill: "var(--illus-ink-muted)" }}
      />
      <rect
        data-illus-mark="clip"
        x={fmt(inset)}
        y={fmt(height * 0.5 - clipHeight / 2)}
        width={fmt(clipWidth)}
        height={fmt(clipHeight)}
        rx={fmt(clipWidth / 2)}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
