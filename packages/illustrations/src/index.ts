// ==================================================================================================
// @mcp-token-footprint/illustrations — the isometric "3D blueprint" illustration system
// (planning/Roadmap/RM-14-illustrations/, D-IL4)
// ==================================================================================================
// Phase 0 lands the foundation in three pieces so that nothing is drawn before the language it is
// drawn in exists:
//
//   WP 0.1  the package, the `--illus-*` token layer (`tokens.css` + `tokens.ts`), and the
//           SceneSpec / RegistryEntry contract — which lives in `@mcp-token-footprint/shared`, not
//           here, because the API validates authored scenes without importing React (D-IL10).
//   WP 0.2  (this) `iso-math.ts`, the layer order, and the primitives: stage, platform, housing,
//           glyph frame, ghost, calibration cube, station header, connectors, annotation cards and
//           the `EntityRoot` wrapper. It ships NO entity and NO registry entry: the test of success
//           is that WP 0.3 can build three entities without writing a single new `<path>`.
//   WP 0.3  the first three entities (`entities/`), `registry.ts` — the catalog, validated against
//           WP 0.1's schema at module load — and the `/illustrations` gallery route in `apps/web`.
//
// The runtime rules that hold across all of it (D-IL3): React 19 + inline SVG, `react` as a PEER
// dependency, `@mcp-token-footprint/shared` as the only workspace dependency, and ZERO new runtime
// dependencies — no canvas, no WebGL, no animation library, no drawing helper. Only `apps/web`
// consumes this package; `apps/api` never imports it (D-IL14).
//
// Illustrations are CONTENT GRAPHICS, not UI controls, so they do not conflict with
// `.claude/rules/brand-ui-only.md`: every piece of chrome around them — the gallery page, dialogs,
// buttons, toolbars — is `@elabs-ai/components-*`.

export * from "./tokens.js";
export * from "./iso-math.js";
export * from "./line-system.js";
export * from "./layers.js";
export * from "./primitives/index.js";
export * from "./scene/index.js";
export * from "./entities/index.js";
export {
  ILLUSTRATION_COMPONENTS,
  ILLUSTRATION_REGISTRY,
  REGISTRY_VERSION,
  findIllustration,
  findIllustrationComponent,
  illustrationViewBox,
  searchIllustrations,
} from "./registry.js";
export {
  FACE_ADJACENCIES,
  assertFaceSeparation,
  createProbeResolver,
  measureFaceSeparation,
  parseLightness,
  relativeSeparation,
  srgbLightness,
} from "./dev/face-separation.js";
export type {
  FaceSeparationOptions,
  FaceSeparationPair,
  FaceSeparationReport,
} from "./dev/face-separation.js";
export { useFaceSeparation } from "./dev/use-face-separation.js";
export { PRIMITIVE_SHEET_SIZE, PrimitivesSheet } from "./preview/PrimitivesSheet.js";
export type { PrimitivesSheetProps } from "./preview/PrimitivesSheet.js";
