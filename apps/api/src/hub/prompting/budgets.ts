// Assistant Hub — per-section token budgets + measurement (D-AH14 / R-SES7).
//
// The targets are the ones written into `planning/Roadmap/RM-03-assistant-hub/system-prompt-draft.md` (the "~N
// tokens" annotations on each `[LAYER]`). For layers that carry a runtime injection (session
// context, tools, GenUI catalog, memory, project, orchestration roster) the budget covers ONLY the
// AUTHORED STATIC FRAME — the injected content is variable and budget-capped by its own owner (the
// tool registry, the GenUI compiler, the memory/project truncation in the turn engine). Measuring
// the static frame is the dogfood contract: our prose stays lean; injected content is metered
// separately in the context inspector.
//
// A section over budget FAILS THE GATE (see `test/hub-prompting.test.ts`). Bumping a number here is
// a deliberate, reviewed act — a bloated system prompt is the tax every single turn pays.

import type { TokenCounter } from "../../token-counting/types.js";
import type { HubPromptSection, HubPromptSectionId, HubPromptSectionMeasurement } from "./types.js";

export const HUB_PROMPT_SECTION_BUDGETS: Record<HubPromptSectionId, number> = {
  identity: 120,
  "session-context": 150,
  // WP1.4 (hub-fixes, analysis.md RC1): the tool registry's `formatToolListText` compresses deferred
  // mode to one summary line per SERVER (not per tool — see `hub/tools/registry.ts`), so this budget
  // covers the whole rendered section (header + list + rules), not just an authored static frame. A
  // synthetic 5-server/280-tool catalog (the RC1 defect session's shape) measures ~544 tokens with the
  // app's default counter; 700 keeps honest headroom above that without re-opening the door to an
  // unbounded per-tool list. Raised from 400 (measured ~6,000 for the old one-line-per-tool list).
  tools: 700,
  genui: 450,
  citations: 200,
  // LAYER 6 is "injected, budget-capped" in the draft (no fixed number). These cover only the
  // authored framing prose; the injected memory/project bodies are capped by the turn engine.
  memory: 90,
  project: 70,
  "working-visibly": 150,
  // assistant-hub v1-fixes (F5) — the style contract (no emoji/slop by default), in EVERY prompt.
  style: 90,
  orchestration: 900,
  "mode-addendum": 150,
  // Appendix A static template (no number in the draft — set to the measured frame + headroom).
  "role-template": 240,
  safety: 200,
  "self-check": 80,
};

/**
 * Measure every section against its budget with the app's OWN {@link TokenCounter}. The turn engine
 * passes the session's configured counter (default `generic_o200k`); the budget test passes the same
 * so "what we assert" and "what the inspector shows" are computed identically (R-SES7). Each section
 * body is counted once (no double-encode).
 */
export async function measureSections(
  sections: HubPromptSection[],
  counter: TokenCounter,
): Promise<HubPromptSectionMeasurement[]> {
  return Promise.all(
    sections.map(async (section) => {
      const tokens = await counter.countText(section.text);
      return {
        id: section.id,
        title: section.title,
        tokens,
        budgetTokens: section.budgetTokens,
        withinBudget: tokens <= section.budgetTokens,
      } satisfies HubPromptSectionMeasurement;
    }),
  );
}
