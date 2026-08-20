// ==================================================================================================
// The entity frame — what an entity's own parts may read from the wrapper around them
// ==================================================================================================
// `EntityRoot` puts the entity's size, state, variant and facing into context so that a primitive
// several levels down (a `GlyphFrame` on the gaze face, a detail that only appears in the `cutaway`
// level) can respond without every entity prop-drilling it. It is deliberately small and READ-ONLY:
// nothing here lets a child change the frame, because that would be a child deciding its own z-order
// or its own state, and both belong to the wrapper (D-IL16, D-IL8).
//
// The defaults matter. A primitive rendered on its own — in the gallery, in a test, in a preview
// tile — must still draw, so the context has a real default rather than throwing on a missing
// provider. `facing` defaults to `upstream`, exactly as D-IL17 requires.

import { createContext, useContext } from "react";
import type {
  IllustrationDetailLevel,
  IllustrationFacing,
  IllustrationSize,
  IllustrationState,
} from "@mcp-token-footprint/shared";

export type EntityFrame = {
  readonly size: IllustrationSize;
  readonly state: IllustrationState;
  readonly facing: IllustrationFacing;
  readonly detail: IllustrationDetailLevel;
  readonly variant: string | undefined;
  /** The footprint of the entity's bottom tier, in units — what a child needs to place itself. */
  readonly footprint: number;
  /** How tall the entity is, in units, for port and annotation anchoring. */
  readonly heightUnits: number;
};

export const DEFAULT_ENTITY_FRAME: EntityFrame = {
  size: "m",
  state: "idle",
  facing: "upstream",
  detail: "standard",
  variant: undefined,
  footprint: 6,
  heightUnits: 3,
};

export const EntityFrameContext = createContext<EntityFrame>(DEFAULT_ENTITY_FRAME);

export function useEntityFrame(): EntityFrame {
  return useContext(EntityFrameContext);
}
