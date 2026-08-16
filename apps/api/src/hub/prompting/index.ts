// Assistant Hub — prompt architecture, public surface (D-AH14 / execution-plan §1.8).
//
// This is the prompting sub-module's OWN entry (`hub/prompting/index.ts`) — NOT a `hub/` barrel
// (WP0.2 owns `apps/api/src/hub/`). The turn engine (WP1.1) imports the two assemblers +
// `HUB_PROMPT_VERSION` from here; the context inspector (WP4.1) imports `measureSections` +
// `HUB_PROMPT_SECTION_BUDGETS` to itemize the window by layer (R-SES7).

export { assembleSessionPrompt, assembleRolePrompt } from "./assemble.js";
export { HUB_PROMPT_VERSION, type HubPromptVersion } from "./version.js";
export { HUB_PROMPT_SECTION_BUDGETS, measureSections } from "./budgets.js";
export type {
  AssembledHubPrompt,
  HubGenuiCatalogInjection,
  HubOrchestrationInjection,
  HubPromptMemoryInjection,
  HubPromptMode,
  HubPromptProjectInjection,
  HubPromptSection,
  HubPromptSectionId,
  HubPromptSectionMeasurement,
  HubPromptSessionContext,
  HubPromptToolsInjection,
  HubRolePromptInput,
  HubRoleTemplateInjection,
  HubSessionPromptInput,
} from "./types.js";

// Individual layer modules — re-exported so the budget test and the context inspector can measure
// each section's STATIC frame directly (GenUI + orchestration expose `staticFrame()` for their
// marker-based frames; every other layer's `render()` with no injection IS its static frame).
export { citationsLayer } from "./layers/citations.js";
export { genuiLayer } from "./layers/genui.js";
export { identityLayer } from "./layers/identity.js";
export { memoryLayer } from "./layers/memory.js";
export { modeAddendumLayer, MODE_ADDENDA } from "./layers/mode-addenda.js";
export { orchestrationLayer } from "./layers/orchestration.js";
export { projectLayer } from "./layers/project.js";
export { roleTemplateLayer } from "./layers/role-template.js";
export { safetyLayer } from "./layers/safety.js";
export { selfCheckLayer } from "./layers/self-check.js";
export { sessionContextLayer } from "./layers/session-context.js";
export { toolsLayer } from "./layers/tools.js";
export { workingVisiblyLayer } from "./layers/working-visibly.js";
