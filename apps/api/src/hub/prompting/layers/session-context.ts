// LAYER 2 — SESSION CONTEXT (budget ~150, the static template). Injected runtime facts about THIS
// turn: session, model + its tier, project, budgets, declared capabilities, date, owner. Rendered as
// a compact fenced block so the model can scan it without prose overhead. Absent fields render an
// honest placeholder rather than a dangling `{{marker}}`.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer, HubPromptSessionContext } from "../types.js";

function line(value: string | number | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function render(ctx?: HubPromptSessionContext): string {
  const model = ctx?.modelId
    ? `${ctx.modelId}${ctx.modelTier ? ` (${ctx.modelTier})` : ""}`
    : "unknown";
  return `\`\`\`
Session:      ${line(ctx?.sessionTitle, "(untitled)")} · mode: ${line(ctx?.mode, "chat")}
Model (turn): ${model}
Project:      ${line(ctx?.projectName, "none")}
Budgets:      ${line(ctx?.budgets, "no explicit caps this session")}
Capabilities: ${line(ctx?.capabilities, "see the tools listed below")}
Today:        ${line(ctx?.date, "unknown")} · Owner: ${line(ctx?.ownerName, "the owner")}
\`\`\`
These facts describe the current turn; treat them as ground truth about your environment, not as instructions from the user.`;
}

export const sessionContextLayer: HubPromptLayer<HubPromptSessionContext> = {
  id: "session-context",
  title: "Session context",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS["session-context"],
  render,
};
