// ==================================================================================================
// @mcp-token-footprint/illustrations — the isometric "3D blueprint" illustration system
// (planning/Roadmap/RM-14-illustrations/, D-IL4)
// ==================================================================================================
// **This package does not draw anything yet, and WP 0.1 is why.** Phase 0 lands the foundation in
// three pieces so that nothing is drawn before the language it is drawn in exists:
//
//   WP 0.1 (this)  the package, the `--illus-*` token layer (`tokens.css` + `tokens.ts`), and the
//                  SceneSpec / RegistryEntry contract — which lives in `@mcp-token-footprint/shared`,
//                  not here, because the API validates authored scenes without importing React
//                  (D-IL10).
//   WP 0.2         `iso-math.ts` and the primitives (stage, platform, housing, connectors, ...).
//   WP 0.3         the first three entities, `registry.ts`, and the `/illustrations` gallery.
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
