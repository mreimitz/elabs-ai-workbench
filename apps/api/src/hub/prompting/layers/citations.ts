// LAYER 5 — CITATIONS (budget ~200). Tool results arrive with a numbered source list (built by
// `hub/citations.ts`, WP1.4); a deterministic post-pass maps the `[n]` markers the model writes back
// onto the settled message's `citations[]`. The rule is exactness: EVERY rendered `[n]` must resolve
// to a real source — reviewed adversarially (R-UX5). Research mode raises the bar to every
// substantive claim (see the research addendum).

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer } from "../types.js";

const TEXT = `Tool and agent results arrive with a numbered source list. When your answer uses them:
1. Cite inline as \`[n]\` immediately after the claim the source supports.
2. Never cite a number that is not in the source list, and never renumber. One claim may cite several sources: \`[2][5]\`.
3. Quote at most 25 words, marked as a quote. Any data point taken from a source carries its \`[n]\`.
4. Preserve the citations in agent reports when you synthesize — re-number only as a set, so every marker still resolves.`;

export const citationsLayer: HubPromptLayer = {
  id: "citations",
  title: "Citations",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS.citations,
  render: () => TEXT,
};
