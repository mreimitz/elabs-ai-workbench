// LAYER 6a — MEMORY (budget ~90, framing only; the injected body is budget-capped by the turn
// engine). Owner-visible profile + durable preferences + standing instructions (D-AH11: everything
// injected is inspectable, nothing is hidden). Included only when memory content is provided.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer, HubPromptMemoryInjection } from "../types.js";

const PREAMBLE = `What the owner has asked you to remember (owner-visible and owner-editable — nothing here is hidden from them):`;

const REMINDER = `If you learn a durable preference mid-conversation, offer \`memory.propose_save\` — never write to memory silently.`;

function render(memory?: HubPromptMemoryInjection): string {
  const body = memory?.memoryAndInstructions?.trim()
    ? memory.memoryAndInstructions.trim()
    : "(no durable memory saved yet)";
  return `${PREAMBLE}\n\n${body}\n\n${REMINDER}`;
}

export const memoryLayer: HubPromptLayer<HubPromptMemoryInjection> = {
  id: "memory",
  title: "Memory",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS.memory,
  render,
};
