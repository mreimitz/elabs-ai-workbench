// ==================================================================================================
// A cast member — the pair the catalog is actually made of (WP 1.1)
// ==================================================================================================
// Until WP 1.1 `registry.ts` kept the two halves of a catalogued component in two hand-maintained
// places: an array of metas and a `Record` of components, each naming every entity. Two lists are
// two chances to forget — and, the reason this file exists, ONE shared file that every parallel work
// package has to append to. Three branches appending to one array is the collision `/next-wp`
// forbids, so the array is split into cast modules and this is the element type they hold.
//
// A cast member binds the entry and the drawing at the point they are authored, so they travel as
// one value. `registry.ts` then concatenates the cast modules and never names an entity at all.

import type { IllustrationRegistryEntry } from "@mcp-token-footprint/shared";
import type { IllustrationEntityComponent } from "./entity-props.js";

/**
 * One catalogued component: its registry entry, and the React component that draws it.
 *
 * The entry is DATA — portable to the API and the assistant, validated against the WP 0.1 zod
 * schema, and deliberately React-free (D-IL10). The component is React and stays in this package.
 * Pairing them here is what makes D-IL9's "no component ships without an entry" hold by
 * construction for anything that reaches a cast module, rather than only by the both-directions
 * assertion in `registry.test.ts`.
 */
export type IllustrationCastMember = {
  readonly meta: IllustrationRegistryEntry;
  readonly component: IllustrationEntityComponent;
};
