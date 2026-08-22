// ==================================================================================================
// The scene engine (Phase 2) — one barrel, four work packages
// ==================================================================================================
// WP 2.1 (this): `spec-validate.ts` — every reason a spec cannot be drawn, as a list; `layout.ts` —
// bands, nodes, ports and a canvas, deterministically; `catalog.ts` — the seam between the two and
// the live registry.
//
// Still to come, and deliberately absent: `route.ts` (WP 2.2, the connector router), `Scene.tsx`
// (WP 2.3, the renderer), `export.ts` (WP 2.4). The layout's `endpoints` map is what 2.2 picks up.

export {
  ILLUSTRATION_SCENE_CATALOG,
  ILLUSTRATION_SCENE_REGISTRY,
  type SceneCatalog,
  sceneCatalogOf,
} from "./catalog.js";
export {
  ANNOTATION_CARD_UNITS,
  ANNOTATION_GAP_UNITS,
  ATTACH_GAP_UNITS,
  BAND_GAP_UNITS,
  CANVAS_MARGIN_UNITS,
  CYCLE_ENTRY_DEFAULT,
  CYCLE_EXIT_DEFAULT,
  FALLBACK_HEIGHT_UNITS,
  HUB_GAP_UNITS,
  ILLUSTRATION_CANVAS_ASPECT,
  LANE_GAP_UNITS,
  RING_GAP_UNITS,
  SCENE_PLACEMENTS,
  type LayoutSceneOptions,
  type SceneAnnotationLayout,
  type SceneBandLayout,
  type SceneCanvasLayout,
  type SceneLayout,
  type SceneNodeLayout,
  type ScenePlacement,
  type ScenePoint,
  type SceneRect,
  type SceneRingLayout,
  layoutScene,
  ringStationAngles,
  roundScene,
  rowCentres,
} from "./layout.js";
export {
  CYCLE_BAND_GATES,
  SCENE_ISSUE_CODES,
  SCENE_ROOT_PATH,
  type CycleBandGate,
  type SceneIssue,
  type SceneIssueCode,
  type SceneParseResult,
  formatScenePath,
  isRegistryVersionAhead,
  parseScene,
  splitEndpoint,
  validateScene,
} from "./spec-validate.js";
