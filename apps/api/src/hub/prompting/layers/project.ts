// LAYER 6b — PROJECT INSTRUCTIONS (budget ~70, framing only; the injected body is budget-capped by
// the turn engine). Present only when the session belongs to a project: the project's standing
// instructions + pinned context. Ordered AFTER memory per §1.8 so project scope refines profile.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer, HubPromptProjectInjection } from "../types.js";

const PREAMBLE = `This session belongs to a project. Its standing instructions and pinned context (they take precedence over general preferences for this work):`;

function render(project?: HubPromptProjectInjection): string {
  const body = project?.projectInstructionsAndPinned?.trim()
    ? project.projectInstructionsAndPinned.trim()
    : "(no project instructions)";
  return `${PREAMBLE}\n\n${body}`;
}

export const projectLayer: HubPromptLayer<HubPromptProjectInjection> = {
  id: "project",
  title: "Project instructions",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS.project,
  render,
};
