// Assistant Hub (WP2.6, R-GUI1–8) — the web declarative-GenUI renderer barrel: the allowlisted registry,
// the recursive node renderer, the transcript entry (`GenUiPart`), the recovery card, and the two-tier
// interactivity state hook. The catalog/validator/URL-check itself is the shared `HUB_GENUI_CATALOG`
// (imported from `@mcp-token-footprint/shared`) — the SAME registry the API compiled the prompt + JSON
// schema from (R-GUI1), so the render-time allowlist can never disagree with what the model was told.

export { GenUiPart, type GenUiPartProps } from "./GenUiPart.js";
export { GenUiNode } from "./GenUiNode.js";
export { GenuiRecoveryCard } from "./RecoveryCard.js";
export { GENUI_RENDERERS, GENUI_RENDERER_IDS } from "./registry.js";
export {
  useGenuiWidgetState,
  type GenuiRenderContext,
  type GenuiWidgetHandlers,
  type GenuiWidgetState,
} from "./use-genui-state.js";
