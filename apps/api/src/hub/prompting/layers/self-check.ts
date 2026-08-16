// FINAL SELF-CHECK (budget ~80). The doc-04 §4 closing mechanical checklist (playbook rule 6): a
// short, verifiable list the model runs before ending a turn. Kept terse on purpose — it is a
// checklist, not prose.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer } from "../types.js";

const TEXT = `Before finishing a turn, verify: every \`[n]\` resolves to a real source · every \`present\` call uses only catalog components, each list item with a stable \`$key\` · the task list / mission board reflects reality · anything unverified is labeled · budgets respected.`;

export const selfCheckLayer: HubPromptLayer = {
  id: "self-check",
  title: "Self-check",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS["self-check"],
  render: () => TEXT,
};
