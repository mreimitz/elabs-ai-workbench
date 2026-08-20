// ==================================================================================================
// The shared entity contract (system design 2.1)
// ==================================================================================================
// Every entity component takes the SAME five props, in the same order, with the same defaults. That
// uniformity is not tidiness: the gallery renders a states x sizes matrix for a component it has
// never heard of, and the scene renderer (WP 2.3) instantiates `node.component` from a registry id.
// Neither can do that if each entity invented its own prop names.
//
// A per-entity `variant` union NARROWS `variant` — it is the one prop an entity is allowed to make
// stricter, because the registry entry lists exactly which variants exist and the contract test
// holds the two together.

import type {
  IllustrationDetailLevel,
  IllustrationFacing,
  IllustrationSize,
  IllustrationState,
} from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import type { IllustrationLayer } from "../layers.js";

export type EntityComponentProps = {
  /** The quantized footprint (D-IL2). Default `m`. */
  size?: IllustrationSize;
  /** The closed state set (D-IL8). Default `idle`. */
  state?: IllustrationState;
  /** Which iso face a front panel mounts on (D-IL17). Default `upstream`; faceless entities ignore it. */
  facing?: IllustrationFacing;
  /** The cut-plane request (D-IL16). An entity with no cutaway ignores it rather than erroring. */
  detail?: IllustrationDetailLevel;
  /** A named alternate from the registry entry's `variants`. */
  variant?: string;
  /** Screen-aligned caption below the entity. Never skewed onto a face (D-IL2). */
  label?: string;
  /** The gallery's port overlay (D-IL7 made visible). */
  showPorts?: boolean;
  /** A stable id prefix, so the same entity emits the same bytes in two trees (the export path). */
  idPrefix?: string;
};

/**
 * What the registry stores against an id: the component itself, plus the one thing a caller cannot
 * work out from the registry entry alone — how TALL the drawing stands, which varies per entity and
 * per size and is what a viewBox (and every port anchor) is measured against.
 */
export type IllustrationEntityComponent = ((props: EntityComponentProps) => ReactElement) & {
  /** The paint layer this entity belongs to (D-IL16). Entities are structure. */
  illusLayer?: IllustrationLayer;
  /** Total height of the drawn solid, in grid units, at the given footprint. */
  entityHeightUnits: (size: IllustrationSize) => number;
};
