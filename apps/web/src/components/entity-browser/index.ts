/**
 * The EntityBrowser kit (planning/Roadmap/RM-32-overview-detail) — the one import surface. An
 * overview page composes: `useEntityBrowserState` (its toolbar controls) + `EntityBrowser` (the
 * body) + `EntityCard` (its own card composition) + `ViewModeToggle` (the toolbar's mode switch).
 */
export { EntityBrowser } from "./EntityBrowser";
export { EntityCard } from "./EntityCard";
export { EntityGrid, EntityGridSkeleton, shouldHintVirtualize } from "./EntityGrid";
export { EntityGroupSection } from "./EntityGroupSection";
export { EntityTable } from "./EntityTable";
export { ViewModeToggle } from "./ViewModeToggle";
export { useEntityBrowserState } from "./use-entity-browser-state";
export { buildEntityGroups, filterEntities } from "./group";
export {
  GROUP_BY_NONE,
  type EntityBrowserProps,
  type EntityBrowserState,
  type EntityGroup,
  type EntityGroupAssignment,
  type EntityGroupBy,
  type EntityViewMode,
} from "./types";
