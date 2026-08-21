// ==================================================================================================
// registry.ts — the single catalog (D-IL9)
// ==================================================================================================
// WP 0.1 shipped the SHAPE of a catalog entry, in `@mcp-token-footprint/shared`, and no entries. WP
// 0.3 shipped the first three. This is the catalog itself: every entry the package publishes,
// validated against that shape at module load, plus the one thing the shape cannot carry — which
// React component draws each id.
//
// WHY THE COMPONENT MAP IS SEPARATE. `illustrationRegistryEntrySchema` is `.strict()` and lives in a
// package that must not import React (D-IL10: the API validates authored scene specs without a
// renderer). So the ENTRY is data, portable to the API and the assistant; the COMPONENT is a second
// map, keyed by the same id, and `registry.test.ts` asserts the two agree in both directions. A
// component with no entry cannot ship, and an entry with no component cannot render — which is
// D-IL9 stated as two tests instead of a promise.
//
// WHY IT NAMES NO ENTITY (WP 1.1). Both exports are derived from ONE list, and that list is the
// concatenation of the four CAST MODULES in `entities/`. This file therefore does not change when a
// component is added: the entity's own file and its own cast module are the whole edit. That is not
// tidiness — `registry.ts` and `entities/index.ts` were the two files every Phase 1 work package
// would otherwise have had to append to, which is exactly the collision parallel worktrees cannot
// survive. `castIdCollisions` below is the other half of the same idea: two work packages that
// independently pick the same id collide LOUDLY at load, naming both modules, instead of one
// silently winning a `Record` key.
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
import { ILLUSTRATION_ASSETS_CAST } from "./entities/cast-assets.js";
import type { IllustrationCastMember } from "./entities/cast-member.js";
import { ILLUSTRATION_ORCHESTRATION_CAST } from "./entities/cast-orchestration.js";
import { ILLUSTRATION_PILOT_CAST } from "./entities/cast-pilot.js";
import { ILLUSTRATION_RUNTIME_CAST } from "./entities/cast-runtime.js";
import type { IllustrationEntityComponent } from "./entities/entity-props.js";
import { type EntityViewBox, entityViewBox } from "./entities/entity-viewbox.js";

/**
 * The catalog's version, stamped into every authored scene spec so a scene is FLAGGED rather than
 * silently broken when a component's contract moves (D-IL9). It is the shared constant re-exported
 * under the name the plan uses, not a second copy — one value, two names, so they cannot drift.
 * (WP 0.1 named the shared one `ILLUSTRATION_REGISTRY_VERSION` because `packages/shared` re-exports
 * everything flat from one `index.ts`, where a bare `REGISTRY_VERSION` would collide.)
 *
 * It does NOT move when a component is added. The shared constant's own docs say so: adding a
 * component, a variant or a port is additive and leaves the version alone; it is bumped only when an
 * existing entry's contract moves in a way that could change how an already-authored scene renders.
 * WP 1.1 adds five components and therefore leaves it at `0.1.0` — which is also why every entry
 * below, new or not, carries `since: "0.1.0"`.
 */
export const REGISTRY_VERSION = ILLUSTRATION_REGISTRY_VERSION;

/**
 * The four cast modules, keyed by the name that appears in a collision message. The key exists to
 * make a duplicate id say WHICH two work packages picked it, which is the whole difference between
 * "an illustration id appears exactly once" and a message somebody can act on.
 */
export const ILLUSTRATION_CAST_MODULES: Readonly<
  Record<string, readonly IllustrationCastMember[]>
> = {
  pilot: ILLUSTRATION_PILOT_CAST,
  runtime: ILLUSTRATION_RUNTIME_CAST,
  assets: ILLUSTRATION_ASSETS_CAST,
  orchestration: ILLUSTRATION_ORCHESTRATION_CAST,
};

/**
 * Every id claimed by more than one cast member, with the modules that claimed it — `[]` when the
 * cast is clean. Pure and exported so `registry.test.ts` can watch it find a collision that does not
 * exist in the shipped catalog; {@link assertCastIdsUnique} is what turns it into a thrown error.
 */
export function castIdCollisions(
  modules: Readonly<Record<string, readonly IllustrationCastMember[]>>,
): readonly { id: string; modules: readonly string[] }[] {
  const claimants = new Map<string, string[]>();
  for (const [name, cast] of Object.entries(modules)) {
    for (const member of cast) {
      const seen = claimants.get(member.meta.id);
      if (seen) seen.push(name);
      else claimants.set(member.meta.id, [name]);
    }
  }
  return [...claimants]
    .filter(([, names]) => names.length > 1)
    .map(([id, names]) => ({ id, modules: names }));
}

/**
 * Throw if two cast members share an id. Called at module load, BEFORE the schema parse, because
 * `illustrationRegistrySchema` also rejects a duplicate id but can only say that one appeared twice
 * — it cannot say that `runtime` and `orchestration` both claimed `run`, which is the sentence a
 * work package actually needs.
 */
export function assertCastIdsUnique(
  modules: Readonly<Record<string, readonly IllustrationCastMember[]>>,
): void {
  const collisions = castIdCollisions(modules);
  if (collisions.length === 0) return;
  const detail = collisions
    .map(({ id, modules: names }) => `"${id}" is claimed by ${names.join(" and ")}`)
    .join("; ");
  throw new Error(
    `two illustration cast members share an id: ${detail}. An id is the catalog's primary key ` +
      "(D-IL9) — rename one of them rather than letting a component silently drop out.",
  );
}

assertCastIdsUnique(ILLUSTRATION_CAST_MODULES);

/** Every catalogued component, in the order the cast modules are declared above. */
const ILLUSTRATION_CAST: readonly IllustrationCastMember[] =
  Object.values(ILLUSTRATION_CAST_MODULES).flat();

/**
 * Every entry, ordered by tier and then by title — the order the gallery lists them in, so the core
 * cast reads first and the long tail sorts alphabetically behind it.
 */
export const ILLUSTRATION_REGISTRY: readonly IllustrationRegistryEntry[] =
  illustrationRegistrySchema.parse(
    ILLUSTRATION_CAST.map((member) => member.meta).sort(
      (left, right) => left.tier - right.tier || left.title.localeCompare(right.title),
    ),
  );

/** The component that draws each id. Keys are held equal to the registry's ids by the contract test. */
export const ILLUSTRATION_COMPONENTS: Readonly<Record<string, IllustrationEntityComponent>> =
  Object.fromEntries(ILLUSTRATION_CAST.map((member) => [member.meta.id, member.component]));

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
