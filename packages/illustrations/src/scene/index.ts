// ==================================================================================================
// The scene engine (Phase 2) — one barrel, four work packages
// ==================================================================================================
// WP 2.1: `spec-validate.ts` — every reason a spec cannot be drawn, as a list; `layout.ts` — bands,
// nodes, ports and a canvas, deterministically; `catalog.ts` — the seam between the two and the live
// registry.
//
// WP 2.2: `route.ts` — the layout's `endpoints` and the spec's connectors become orthogonal paths,
// filleted corners, nudged parallel runs and placed labels. Pure geometry: it emits numbers and path
// data, never an element and never a colour.
//
// Still to come, and deliberately absent: `Scene.tsx` (WP 2.3, the renderer) and `export.ts`
// (WP 2.4). The router's output is what 2.3 paints.

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
  CONNECTOR_CORNER_UNITS,
  CONNECTOR_NUDGE_UNITS,
  CONNECTOR_STUB_UNITS,
  LABEL_ADVANCE_RATIO,
  LABEL_ALONG_FRACTIONS,
  LABEL_LINE_RATIO,
  LABEL_NUDGE_LADDER,
  LABEL_NUDGE_UNITS,
  LABEL_PADDING_UNITS,
  ORTHO_DIRECTIONS,
  PORT_CENTRE_TOLERANCE_UNITS,
  PORT_MID_BAND_FRACTION,
  ROUTE_SHAPES,
  type OrthoDirection,
  type RouteShape,
  type RoutedConnector,
  type RoutedLabel,
  type SceneRouting,
  type UnresolvedConnector,
  arrivalDirection,
  connectorPathData,
  endpointDirectionsToward,
  labelBoxSize,
  portDirection,
  routeScene,
  routeShapeOf,
} from "./route.js";
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
