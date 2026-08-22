// ==================================================================================================
// SceneCatalog — the two questions the layout engine asks the registry, and nothing else
// ==================================================================================================
// The engine needs exactly two facts about a component: its registry ENTRY (for ports, variants and
// which sizes it is drawn at) and how TALL it stands at a size. The second one is not in the entry:
// `entityHeightUnits` is a static on the React component, because it is a property of the drawing.
//
// So this file is the seam. `layout.ts` takes a `SceneCatalog` and stays pure and React-free — a test
// hands it three fixture entries and gets a layout without loading twenty-four components — while
// this module, and only this module, binds the live catalog. That is the same split `registry.ts`
// already makes between the entry (data, portable to the API) and the component (React, stays here).

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import { ILLUSTRATION_REGISTRY, findIllustration, findIllustrationComponent } from "../registry.js";

export type SceneCatalog = {
  /** The registry entry for a component id, or `undefined` — a lookup, never a throw. */
  entry(id: string): IllustrationRegistryEntry | undefined;
  /** How tall the component stands at `size`, in grid units, or `undefined` if it is not catalogued. */
  heightUnits(id: string, size: IllustrationSize): number | undefined;
};

/** The live catalog: the twenty-four components this package publishes. */
export const ILLUSTRATION_SCENE_CATALOG: SceneCatalog = {
  entry: (id) => findIllustration(id),
  heightUnits: (id, size) => findIllustrationComponent(id)?.entityHeightUnits(size),
};

/**
 * A catalog over an arbitrary entry list, for tests and for any caller validating a spec against a
 * catalog that is not this build's. `heightUnits` falls back to the live component when the id is one
 * this package draws, so a fixture can borrow real geometry without restating it.
 */
export function sceneCatalogOf(entries: readonly IllustrationRegistryEntry[]): SceneCatalog {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    entry: (id) => byId.get(id),
    heightUnits: (id, size) =>
      byId.has(id) ? findIllustrationComponent(id)?.entityHeightUnits(size) : undefined,
  };
}

/** The entries the live catalog holds, re-exported so a caller needs one import for both halves. */
export const ILLUSTRATION_SCENE_REGISTRY: readonly IllustrationRegistryEntry[] =
  ILLUSTRATION_REGISTRY;
