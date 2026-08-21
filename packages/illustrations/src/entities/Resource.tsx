// ==================================================================================================
// Resource — a labelled crate (tier 2, entity `mcp_resource_scans`)
// ==================================================================================================
// The other half of an MCP server's advertised surface: the documents, files and blobs it offers
// through `resources/list`. Research 5 calls it a "labeled crate", and the two halves of that phrase
// are the whole drawing — a CRATE, because a resource is content sitting somewhere waiting to be
// read rather than a machine doing anything, and LABELLED, because the only thing a scan actually
// learns about one is its manifest: a URI, a name, a MIME type.
//
// It stands on a ONE-tier pad, not the two-tier plinth a station gets. A crate is on the ground next
// to the machine, not raised on a monument, and the tier count is the cheapest way the vocabulary
// has of saying so — the same reason `run` and `tool` take one tier and `mcp-server` takes two.
//
// FACELESS (D-IL17): the shipping label names the `left` face outright. A crate has a labelled side,
// not a gaze, so a request to face downstream leaves it exactly where it is.

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
 * `read-out` is the one semantic port, and the asymmetry is the point: nothing flows INTO a
 * resource. It is read. The port sits at a 1.4-unit offset so the gallery's overlay does not stack
 * it on the plain `right` cardinal; 1.4 is inside the footprint at every size (`s`'s half-extent
 * is 2).
 */
export const resourceMeta: IllustrationRegistryEntry = {
  id: "resource",
  title: "Resource",
  entity: "mcp_resource_scans",
  tier: 2,
  keywords: ["resource", "crate", "manifest", "uri", "content", "document", "read"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "read-out": { title: "Read out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A resource: a battened crate on a ground pad, a manifest card fixed to its front face — the content an MCP server offers to be read rather than called.",
};

export type ResourceProps = EntityComponentProps;

/** One tier: a crate stands on the ground beside the machine, not on a plinth. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const CRATE_WIDTH = 0.56;
const CRATE_HEIGHT = 0.28;

function crateBox(footprint: number): IsoBox {
  const side = footprint * CRATE_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * CRATE_HEIGHT };
}

export function resourceHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * CRATE_HEIGHT;
}

export function Resource({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ResourceProps): ReactElement {
  const footprint = footprintUnits(size);
  const crate = crateBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={resourceMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={resourceHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={crate.w} depth={crate.d} height={crate.h} z0={crate.z0} />
      <ManifestCard box={crate} accent={accent} />
    </EntityRoot>
  );
}

Resource.illusLayer = "structure" as const;
Resource.entityHeightUnits = resourceHeightUnits;

/**
 * The crate's front face: two corner battens (the boards a crate is braced with) and, between them,
 * the manifest card. The card carries a URI chip — the entity's ONE accent moment (D-IL6), because
 * a resource IS its URI — over two muted rules standing in for the name and the MIME type. Text is
 * never set on an iso face (D-IL2); a drafting elevation shows a hatched block, not lettering.
 */
function ManifestCard({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const battenWidth = width * 0.11;
  const cardX = battenWidth * 1.9;
  const cardWidth = width - cardX * 2;
  const cardInset = Math.min(cardWidth, height) * 0.14;
  const cardY = height * 0.16;
  const cardHeight = height - cardY * 2;
  const chipHeight = Math.max(2.2, cardHeight * 0.22);
  const ruleHeight = Math.max(1.2, chipHeight * 0.4);
  const ruleGap = (cardHeight - cardInset * 2 - chipHeight - ruleHeight * 2) / 3;

  return (
    <GlyphFrame face="left" box={box}>
      {(["near", "far"] as const).map((side) => (
        <rect
          key={`batten-${side}`}
          x={fmt(side === "near" ? 0 : width - battenWidth)}
          y={0}
          width={fmt(battenWidth)}
          height={fmt(height)}
          style={{ fill: "var(--illus-ink-muted)", fillOpacity: 0.6 }}
        />
      ))}
      <rect
        data-illus-mark="manifest-card"
        x={fmt(cardX)}
        y={fmt(cardY)}
        width={fmt(cardWidth)}
        height={fmt(cardHeight)}
        rx={fmt(Math.min(3, cardHeight * 0.12))}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        style={{ fill: "var(--illus-surface)", stroke: "var(--illus-ink)" }}
      />
      <rect
        x={fmt(cardX + cardInset)}
        y={fmt(cardY + cardInset)}
        width={fmt((cardWidth - cardInset * 2) * 0.66)}
        height={fmt(chipHeight)}
        rx={fmt(chipHeight / 2)}
        style={{ fill: accent }}
      />
      {[0, 1].map((rule) => (
        <rect
          key={`rule-${rule}`}
          x={fmt(cardX + cardInset)}
          y={fmt(cardY + cardInset + chipHeight + ruleGap * (rule + 1) + ruleHeight * rule)}
          width={fmt((cardWidth - cardInset * 2) * (rule === 0 ? 1 : 0.58))}
          height={fmt(ruleHeight)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}
