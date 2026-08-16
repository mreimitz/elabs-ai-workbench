// Assistant Hub (WP2.6, R-GUI1–8) — the Declarative GenUI module barrel. ONE registry (the shared
// `HUB_GENUI_CATALOG`) → the prompt catalog (`compile-prompt.ts`), the flat JSON schema (`json-schema.ts`),
// the `present`/`prompt_user` emission tools + bounded repair loop (`present-tool.ts` + `repair.ts`), and
// the editable-surface snapshot contract (`update-surface.ts`). The validator itself lives in
// `packages/shared` (so the browser runs the exact same allowlist at render time — the security boundary).

export { compileGenuiCatalogPrompt } from "./compile-prompt.js";
export {
  compileGenuiNodeJsonSchema,
  compileGenuiToolJsonSchema,
  type GenuiJsonSchema,
} from "./json-schema.js";
export {
  createGenuiTools,
  GENUI_TOOL_NAMES,
  type CreateGenuiToolsOptions,
  type GenuiPresentModelResult,
} from "./present-tool.js";
export { GenuiRepairTracker, formatRepairHints, exhaustionModelMessage } from "./repair.js";
export {
  buildUpdateSurfaceTool,
  UPDATE_SURFACE_PARTIAL_WORDING,
  type BuildUpdateSurfaceToolInput,
  type UpdateSurfaceField,
} from "./update-surface.js";
