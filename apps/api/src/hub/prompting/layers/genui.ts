// LAYER 4 — GENERATIVE UI CONTRACT (budget ~450 static + injected catalog). The prompt side of the
// bounded Declarative GenUI capability (R-GUI1/2). Included ONLY when a compiled catalog is injected
// (the WP2.6 seam) — otherwise the model is never told about `present`, so it stays in plain
// markdown and chat turns stay lighter (Appendix B).
//
// Doc-04 §4 playbook applied here: compact typed signatures + notes, NOT JSON Schema (rule 2, the
// catalog is compiled by WP2.6); vocabulary clamp + legal fallback = plain markdown (rule 4); design
// rules = structure & data only, colors are runtime tokens (rule 13); streaming shell-first (rule
// 5); a WRONG/RIGHT contrastive pair (rule 3); bounded machine-hinted repair → markdown fallback
// (rule 7); silent emission (rule 9); dual-audience round-trip (rule 11).
//
// ⚠ SEAM FOR WP2.6: the `{{GENUI_CATALOG}}` marker is filled from `injection.catalogText`, which
// WP2.6's catalog compiler produces from the single zod registry (so prompt and validator can never
// disagree — R-GUI1). This layer NEVER hand-lists components. Keep the marker + the "Use ONLY
// components from the catalog above" clamp intact when editing.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubGenuiCatalogInjection, HubPromptLayer } from "../types.js";

const INTRO = `You may render rich UI inside a reply by calling \`present\` (and \`prompt_user\` when you need structured input back) — a flat, silent tool: emit the UI, say nothing else about it. Each component in the catalog reads as one typed signature "Use <Component>(spec) to <purpose> for the user", grouped with usage notes and anti-patterns. Available components:`;

const CATALOG_MARKER = "{{GENUI_CATALOG}}";

const RULES = `Rules (the renderer silently drops violations — follow them exactly):
1. Use ONLY components from the catalog above; unknown components and unknown props do not render. When nothing in the catalog fits, plain markdown IS the right answer — most turns need no \`present\` call at all.
2. Design rules — emit STRUCTURE and DATA, never style: no colors, no CSS, no pixel layout. Theming is the app's job (runtime tokens); a component that tries to pick colors is wrong by construction.
3. Stream shell-first: the root/container component first, its data-bearing children next, leaf values last — the user should see the shape immediately. Give every list item a stable \`$key\`.
4. Choose the component the content wants: tables for comparisons, charts for trends, forms for structured input, prose for anything conversational.
5. Text and title props are PLAIN text — no emoji or decorative unicode in any component string (the style contract applies inside widgets too).

WRONG — narrating tabular data as text: "Revenue was 42K in Jan, 48K in Feb, 55K in Mar…".
RIGHT — one \`present\` call with a Chart (or Table) spec, then one sentence of insight the chart itself cannot say.

If the renderer returns validation errors, fix EXACTLY the listed errors and re-emit ONCE; if it still fails, fall back to plain markdown and say so — never loop. Interactivity round-trips in two tiers: client-side interactions (filters, toggles) never reach you; a submitted form or a to-assistant action arrives as the user's next message carrying its \`formState\`. Never request passwords, keys, or secrets through a form.`;

function render(catalog?: HubGenuiCatalogInjection): string {
  const body = catalog?.catalogText?.trim()
    ? catalog.catalogText.trim()
    : "(no components registered — omit this section)";
  const versionNote = catalog?.specVersion ? `\n(catalog version: ${catalog.specVersion})` : "";
  return `${INTRO}\n\n${body}${versionNote}\n\n${RULES}`;
}

// Budget frame = the static prose WITHOUT an injected catalog (the marker stands in for it), so the
// authored contract is what is measured — the catalog's size is WP2.6's budget.
function staticFrame(): string {
  return `${INTRO}\n\n${CATALOG_MARKER}\n\n${RULES}`;
}

export const genuiLayer: HubPromptLayer<HubGenuiCatalogInjection> & {
  staticFrame(): string;
} = {
  id: "genui",
  title: "Generative UI contract",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS.genui,
  render,
  staticFrame,
};
