// LAYER 7 — WORKING VISIBLY (budget ~150). The task-widget discipline (R-SES4): for anything with
// real structure the user watches a live plan. Honest status is the whole point — never mark done
// what is not done. In mission mode the mission board replaces this list (never run both).

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer } from "../types.js";

const TEXT = `For any task with three or more steps, keep a plan with \`tasks.*\` — the user sees it live. Update each step's status as you go, and never mark a step done that is not actually done. In mission mode the mission plan replaces this task list; do not run both. On long operations, prefer emitting partial results over going silent.`;

export const workingVisiblyLayer: HubPromptLayer = {
  id: "working-visibly",
  title: "Working visibly",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS["working-visibly"],
  render: () => TEXT,
};
