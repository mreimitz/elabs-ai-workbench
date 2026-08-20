// ==================================================================================================
// IsoPlatform — the stepped base every station stands on
// ==================================================================================================
// One to three tiers on a quantized S/M/L footprint. The platform is what makes a scene read as a
// set of STATIONS rather than a pile of boxes, and it is why two entities of the same size can be
// swapped without the layout moving: the outermost tier is exactly the registry footprint.
//
// DIVERGENCE FROM examples/Agent.example.tsx, recorded. The exemplar draws its `m` platform 5.6
// units wide, stepping to 4.2. The spec quantizes `m` at 6x6 (D-IL2), and the spec wins: tier one is
// the footprint exactly, and each tier above steps in by the exemplar's own 1.4-unit inset, so the
// silhouette is unchanged apart from being on the grid.

import type { IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { footprintUnits } from "../iso-math.js";
import { IsoHousing } from "./IsoHousing.js";

/** How far each tier steps in from the one below, in units — the exemplar's proportion, kept. */
export const PLATFORM_TIER_INSET = 1.4;

/** Tier heights, bottom first. A platform is a plinth, not a building: nothing here is tall. */
export const PLATFORM_TIER_HEIGHTS = [0.7, 0.5, 0.4] as const;

export const PLATFORM_MAX_TIERS = PLATFORM_TIER_HEIGHTS.length;

export type IsoPlatformProps = {
  /** 1-3. Out-of-range values are clamped rather than thrown: a scene never fails to draw. */
  tiers?: number;
  /** The quantized footprint of the BOTTOM tier (D-IL2). */
  footprint?: IllustrationSize;
  cx?: number;
  cy?: number;
  z0?: number;
};

/** The height of a platform, in units — what an entity needs to know to sit on top of one. */
export function platformHeight(tiers: number): number {
  const count = Math.min(PLATFORM_MAX_TIERS, Math.max(1, Math.round(tiers)));
  return PLATFORM_TIER_HEIGHTS.slice(0, count).reduce((total, height) => total + height, 0);
}

export function IsoPlatform({
  tiers = 2,
  footprint = "m",
  cx = 0,
  cy = 0,
  z0 = 0,
}: IsoPlatformProps): ReactElement {
  const count = Math.min(PLATFORM_MAX_TIERS, Math.max(1, Math.round(tiers)));
  const base = footprintUnits(footprint);
  let floor = z0;
  const drawn: ReactElement[] = [];
  for (let tier = 0; tier < count; tier += 1) {
    const size = base - tier * PLATFORM_TIER_INSET;
    const height = PLATFORM_TIER_HEIGHTS[tier] as number;
    drawn.push(
      <IsoHousing
        key={tier}
        width={size}
        depth={size}
        height={height}
        cx={cx}
        cy={cy}
        z0={floor}
        // The bottom tier carries the silhouette, so it takes the ink weight; the steps above it are
        // interior edges of the same object and take the detail weight.
        weight={tier === 0 ? "ink" : "detail"}
      />,
    );
    floor += height;
  }
  return (
    <g data-illus-primitive="iso-platform" data-illus-tiers={count}>
      {drawn}
    </g>
  );
}

IsoPlatform.illusLayer = "structure" as const;
