// ==================================================================================================
// registry.ts — the single catalog (D-IL9)
// ==================================================================================================
// WP 0.1 shipped the SHAPE of a catalog entry, in `@mcp-token-footprint/shared`, and no entries. This
// is the catalog itself: the first three, validated against that shape at module load, plus the one
// thing the shape cannot carry — which React component draws each id.
//
// WHY THE COMPONENT MAP IS SEPARATE. `illustrationRegistryEntrySchema` is `.strict()` and lives in a
// package that must not import React (D-IL10: the API validates authored scene specs without a
// renderer). So the ENTRY is data, portable to the API and the assistant; the COMPONENT is a second
// map, keyed by the same id, and `registry.test.ts` asserts the two agree in both directions. A
// component with no entry cannot ship, and an entry with no component cannot render — which is
// D-IL9 stated as two tests instead of a promise.
//
// WHY IT VALIDATES AT LOAD. `.parse` runs when this module is first imported — by the gallery, by a
// test, later by the scene renderer. A malformed entry therefore fails LOUDLY at startup naming the
// field, instead of rendering a component the catalog quietly dropped.

import {
  ILLUSTRATION_REGISTRY_VERSION,
  type IllustrationRegistryEntry,
  type IllustrationSize,
  illustrationRegistrySchema,
} from "@mcp-token-footprint/shared";
import { Agent, agentMeta } from "./entities/Agent.js";
import { McpServer, mcpServerMeta } from "./entities/McpServer.js";
import { Skill, skillMeta } from "./entities/Skill.js";
import type { IllustrationEntityComponent } from "./entities/entity-props.js";
import { entityViewBox, type EntityViewBox } from "./entities/entity-viewbox.js";

/**
 * The catalog's version, stamped into every authored scene spec so a scene is FLAGGED rather than
 * silently broken when a component's contract moves (D-IL9). It is the shared constant re-exported
 * under the name the plan uses, not a second copy — one value, two names, so they cannot drift.
 * (WP 0.1 named the shared one `ILLUSTRATION_REGISTRY_VERSION` because `packages/shared` re-exports
 * everything flat from one `index.ts`, where a bare `REGISTRY_VERSION` would collide.)
 */
export const REGISTRY_VERSION = ILLUSTRATION_REGISTRY_VERSION;

/**
 * Every entry, ordered by tier and then by title — the order the gallery lists them in, so the core
 * cast reads first and the long tail sorts alphabetically behind it.
 */
export const ILLUSTRATION_REGISTRY: readonly IllustrationRegistryEntry[] =
  illustrationRegistrySchema.parse(
    [mcpServerMeta, skillMeta, agentMeta].sort(
      (left, right) => left.tier - right.tier || left.title.localeCompare(right.title),
    ),
  );

/** The component that draws each id. Keys are held equal to the registry's ids by the contract test. */
export const ILLUSTRATION_COMPONENTS: Readonly<Record<string, IllustrationEntityComponent>> = {
  [mcpServerMeta.id]: McpServer,
  [skillMeta.id]: Skill,
  [agentMeta.id]: Agent,
};

/** The entry for an id, or `undefined` — a lookup, never a throw, so a stale scene can be reported. */
export function findIllustration(id: string): IllustrationRegistryEntry | undefined {
  return ILLUSTRATION_REGISTRY.find((entry) => entry.id === id);
}

/** The component for an id, or `undefined`. Same contract as {@link findIllustration}. */
export function findIllustrationComponent(id: string): IllustrationEntityComponent | undefined {
  return ILLUSTRATION_COMPONENTS[id];
}

/**
 * The frame to draw `id` at `size` through, when it is drawn alone. Entities render a `<g>` around
 * the world origin (WP 0.2), so somebody has to supply the `<svg>` — and every caller that does
 * should get the SAME crop, which is what routing it through the registry buys.
 */
export function illustrationViewBox(id: string, size: IllustrationSize): EntityViewBox | undefined {
  const component = ILLUSTRATION_COMPONENTS[id];
  if (component === undefined) return undefined;
  return entityViewBox(size, component.entityHeightUnits(size));
}

/**
 * Free-text search over the catalog, matching id, title, entity binding and keywords. The gallery's
 * search box and (from WP 4.1) the assistant's `illustrations_registry` tool are the same question
 * asked twice, so they get one answer here rather than two slightly different ones.
 */
export function searchIllustrations(
  query: string,
  entries: readonly IllustrationRegistryEntry[] = ILLUSTRATION_REGISTRY,
): readonly IllustrationRegistryEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter((entry) =>
    [entry.id, entry.title, entry.entity ?? "", entry.description, ...entry.keywords]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}
