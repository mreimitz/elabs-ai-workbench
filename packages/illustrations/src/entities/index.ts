// The cast (D-IL9). One file per entity, each exporting its component, its registry meta and its
// height function — and each listed in exactly ONE cast module, which is what `registry.ts`
// concatenates into the catalog.
//
// This file names no entity, on purpose (WP 1.1). It used to re-export each one by hand, which made
// it the second file every new component had to touch; the cast modules now re-export their own
// members, so adding an entity is its own file plus its own cast module and nothing else. Whatever
// each entity exports — `Skill`, `skillMeta`, `skillHeightUnits`, `SKILL_VARIANTS`, … — still
// reaches the package's public surface through here, exactly as before.

export * from "./cast-assets.js";
export * from "./cast-orchestration.js";
export * from "./cast-pilot.js";
export * from "./cast-runtime.js";
export { entityViewBox } from "./entity-viewbox.js";
export type { EntityViewBox } from "./entity-viewbox.js";
export type { EntityComponentProps, IllustrationEntityComponent } from "./entity-props.js";
export type { IllustrationCastMember } from "./cast-member.js";
